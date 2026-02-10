/**
 * TmuxBackend - Tmux 会话管理
 * 官方 v2.1.33 agent teams 的 tmux 后端
 *
 * 负责为 teammate agents 创建和管理 tmux 窗格（pane）
 * 对应官方 KvA 类
 *
 * v2.1.33 修复:
 * - 修复 teammate sessions 的消息发送/接收
 * - 改进 createTeammatePaneWithLeader 布局（leader 30%, teammates 70%）
 * - 添加 sendCommandToPane 异步方法
 * - 添加窗格标题和颜色支持
 */

import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import type { TeamMember } from './types.js';

const execAsync = promisify(execCb);

// ============================================================================
// Tmux 工具函数
// ============================================================================

/**
 * 执行 tmux 命令（异步），返回 stdout
 * 对应官方 dh() 函数
 */
async function tmuxExec(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const cmd = 'tmux ' + args.map(a => {
      // 只在包含空格或特殊字符时加引号
      if (a.includes(' ') || a.includes('"') || a.includes("'")) {
        return `"${a.replace(/"/g, '\\"')}"`;
      }
      return a;
    }).join(' ');
    const { stdout, stderr } = await execAsync(cmd);
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.trim() ?? '',
      stderr: error.stderr?.trim() ?? '',
      code: error.code ?? 1,
    };
  }
}

/**
 * 执行 tmux 命令（同步）
 * 对应官方 bj() 函数
 */
function tmuxExecSync(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const cmd = 'tmux ' + args.join(' ');
    const stdout = execSync(cmd, { stdio: 'pipe' }).toString().trim();
    return { stdout, stderr: '', code: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString().trim() ?? '',
      stderr: error.stderr?.toString().trim() ?? '',
      code: error.status ?? 1,
    };
  }
}

/**
 * 检查 tmux 是否可用
 */
export function isTmuxAvailable(): boolean {
  try {
    execSync('which tmux', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 检查当前是否在 tmux 会话中
 * 对应官方 ph() 函数
 */
export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/**
 * 获取当前 tmux 会话名称
 */
export function getCurrentTmuxSession(): string | null {
  if (!isInsideTmux()) return null;

  try {
    const result = execSync('tmux display-message -p "#S"', { stdio: 'pipe' }).toString().trim();
    return result;
  } catch {
    return null;
  }
}

/**
 * 获取当前 tmux pane ID
 */
export function getCurrentPaneId(): string | null {
  if (!isInsideTmux()) return null;

  try {
    const result = execSync('tmux display-message -p "#{pane_id}"', { stdio: 'pipe' }).toString().trim();
    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// 颜色映射（tmux 256-color）
// ============================================================================

/**
 * 将十六进制颜色转换为最接近的 tmux 颜色名称
 * 对应官方 Wx4() 函数
 */
function hexToTmuxColor(hex: string): string {
  const colorMap: Record<string, string> = {
    '#FF6B6B': 'red',
    '#4ECDC4': 'cyan',
    '#45B7D1': 'blue',
    '#96CEB4': 'green',
    '#FFEAA7': 'yellow',
    '#DDA0DD': 'magenta',
    '#98D8C8': 'cyan',
    '#F7DC6F': 'yellow',
    '#BB8FCE': 'magenta',
    '#85C1E9': 'blue',
    '#82E0AA': 'green',
    '#F8C471': 'yellow',
  };
  return colorMap[hex] || 'default';
}

// ============================================================================
// TmuxBackend 类
// ============================================================================

/**
 * Tmux 后端
 * 管理 teammate agents 的 tmux 窗格
 *
 * v2.1.33: 改进了消息发送/接收和窗格管理
 * - sendCommandToPane: 异步发送命令到指定窗格
 * - createTeammatePaneWithLeader: leader 30% + teammates 70% 布局
 * - 窗格标题和边框颜色支持
 */
export class TmuxBackend {
  private sessionName: string;
  private panes: Map<string, string> = new Map(); // memberName -> paneId
  private leaderPaneId: string | null = null;
  private isExternal: boolean = false;

  constructor(sessionName: string) {
    this.sessionName = sessionName;
  }

  /**
   * 创建外部 swarm session（在新 tmux 窗口中运行）
   * 对应官方 createExternalSwarmSession
   */
  async createExternalSwarmSession(): Promise<boolean> {
    if (!isTmuxAvailable()) {
      throw new Error('tmux is not available on this system');
    }

    try {
      execSync(`tmux new-session -d -s "${this.sessionName}" -x 200 -y 50`, { stdio: 'pipe' });
      this.isExternal = true;
      return true;
    } catch (error) {
      if (String(error).includes('duplicate session')) {
        this.isExternal = true;
        return true;
      }
      throw error;
    }
  }

  /**
   * 在当前 tmux session 中创建 swarm（使用已有 session）
   */
  async createInternalSwarmSession(): Promise<boolean> {
    if (!isInsideTmux()) {
      throw new Error('Not inside a tmux session');
    }

    this.sessionName = getCurrentTmuxSession() || this.sessionName;
    this.leaderPaneId = getCurrentPaneId();
    this.isExternal = false;
    return true;
  }

  /**
   * v2.1.33: 向指定窗格发送命令
   * 对应官方 sendCommandToPane(A, q, K) 方法
   */
  async sendCommandToPane(paneId: string, command: string, sync: boolean = false): Promise<void> {
    const args = ['send-keys', '-t', paneId, command, 'Enter'];
    const result = sync ? tmuxExecSync(args) : await tmuxExec(args);
    if (result.code !== 0) {
      throw new Error(`Failed to send command to pane ${paneId}: ${result.stderr}`);
    }
  }

  /**
   * v2.1.33: 创建 teammate 窗格（带 leader 布局）
   * 对应官方 createTeammatePaneWithLeader(A, q) 方法
   *
   * 第一个 teammate: leader 30% + teammate 70% (水平分割)
   * 后续 teammates: 在右侧纵向分割
   */
  async createTeammatePaneWithLeader(
    command: string,
    workingDir: string,
  ): Promise<{ paneId: string; isFirstTeammate: boolean }> {
    if (!this.leaderPaneId) {
      this.leaderPaneId = getCurrentPaneId();
    }

    if (!this.leaderPaneId) {
      throw new Error('Could not determine current tmux pane/window');
    }

    const currentWindowTarget = await this.getCurrentWindowTarget();
    if (!currentWindowTarget) {
      throw new Error('Could not determine current tmux window');
    }

    const paneCount = await this.getCurrentWindowPaneCount(currentWindowTarget);
    if (paneCount === null) {
      throw new Error('Could not determine pane count for current window');
    }

    const isFirstTeammate = paneCount === 1;
    let newPaneId: string;

    if (isFirstTeammate) {
      const result = await tmuxExec([
        'split-window', '-t', this.leaderPaneId, '-h', '-l', '70%',
        '-P', '-F', '#{pane_id}', '-c', workingDir,
      ]);
      if (result.code !== 0) {
        throw new Error(`Failed to create first teammate pane: ${result.stderr}`);
      }
      newPaneId = result.stdout.trim();
    } else {
      const lastTeammatePaneId = this.getLastTeammatePaneId();
      const targetPane = lastTeammatePaneId || this.leaderPaneId;

      const result = await tmuxExec([
        'split-window', '-t', targetPane, '-v',
        '-P', '-F', '#{pane_id}', '-c', workingDir,
      ]);
      if (result.code !== 0) {
        throw new Error(`Failed to create teammate pane: ${result.stderr}`);
      }
      newPaneId = result.stdout.trim();
    }

    if (command) {
      await this.sendCommandToPane(newPaneId, command);
    }

    return { paneId: newPaneId, isFirstTeammate };
  }

  private getLastTeammatePaneId(): string | null {
    const paneIds = Array.from(this.panes.values());
    return paneIds.length > 0 ? paneIds[paneIds.length - 1] : null;
  }

  private async getCurrentWindowTarget(): Promise<string | null> {
    const result = await tmuxExec(['display-message', '-p', '#{window_id}']);
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  }

  private async getCurrentWindowPaneCount(windowTarget: string): Promise<number | null> {
    const result = await tmuxExec(['list-panes', '-t', windowTarget, '-F', '#{pane_id}']);
    if (result.code !== 0) return null;
    const panes = result.stdout.split('\n').filter(Boolean);
    return panes.length;
  }

  /**
   * v2.1.33: 设置窗格边框颜色
   * 对应官方 setPaneBorderColor(A, q, K) 方法
   */
  async setPaneBorderColor(paneId: string, color: string): Promise<void> {
    const tmuxColor = hexToTmuxColor(color);
    await tmuxExec(['select-pane', '-t', paneId, '-P', `bg=default,fg=${tmuxColor}`]);
    await tmuxExec(['set-option', '-p', '-t', paneId, 'pane-border-style', `fg=${tmuxColor}`]);
    await tmuxExec(['set-option', '-p', '-t', paneId, 'pane-active-border-style', `fg=${tmuxColor}`]);
  }

  /**
   * v2.1.33: 设置窗格标题
   */
  async setPaneTitle(paneId: string, title: string): Promise<void> {
    await tmuxExec(['select-pane', '-t', paneId, '-T', title]);
  }

  /**
   * 为 teammate 创建新的 tmux pane
   * v2.1.33: 内部使用 createTeammatePaneWithLeader
   */
  async spawnTeammate(
    memberName: string,
    command: string,
    workingDir: string,
  ): Promise<string> {
    if (!isTmuxAvailable()) {
      throw new Error('tmux is not available');
    }

    try {
      const { paneId } = await this.createTeammatePaneWithLeader(command, workingDir);
      this.panes.set(memberName, paneId);

      await this.setPaneTitle(paneId, memberName);
      await this.rebalancePanesWithLeader();

      return paneId;
    } catch (error) {
      throw new Error(`Failed to spawn teammate "${memberName}": ${error}`);
    }
  }

  /**
   * v2.1.33: 重新平衡窗格布局（带 leader）
   * 对应官方 rebalancePanesWithLeader(A) 方法
   *
   * leader 在左侧 30%，teammates 在右侧平均分布
   */
  async rebalancePanesWithLeader(): Promise<void> {
    const currentWindowTarget = await this.getCurrentWindowTarget();
    if (!currentWindowTarget) return;

    const result = await tmuxExec(['list-panes', '-t', currentWindowTarget, '-F', '#{pane_id}']);
    if (result.code !== 0) return;

    const allPanes = result.stdout.split('\n').filter(Boolean);
    if (allPanes.length <= 2) return;

    await tmuxExec(['select-layout', '-t', currentWindowTarget, 'main-vertical']);

    if (this.leaderPaneId) {
      await tmuxExec(['resize-pane', '-t', this.leaderPaneId, '-x', '30%']);
    }
  }

  /**
   * 重新平衡窗格布局（兼容旧接口）
   */
  rebalancePanes(): void {
    this.rebalancePanesWithLeader().catch(() => {});
  }

  async killTeammate(memberName: string): Promise<boolean> {
    const paneId = this.panes.get(memberName);
    if (!paneId) return false;

    try {
      await tmuxExec(['kill-pane', '-t', paneId]);
      this.panes.delete(memberName);
      await this.rebalancePanesWithLeader();
      return true;
    } catch {
      this.panes.delete(memberName);
      return false;
    }
  }

  async killAllTeammates(): Promise<void> {
    for (const [name] of this.panes) {
      await this.killTeammate(name);
    }
  }

  async destroySession(): Promise<boolean> {
    try {
      await this.killAllTeammates();
      if (this.isExternal) {
        await tmuxExec(['kill-session', '-t', this.sessionName]);
      }
      return true;
    } catch {
      return false;
    }
  }

  getSessionName(): string {
    return this.sessionName;
  }

  getLeaderPaneId(): string | null {
    return this.leaderPaneId;
  }

  getPanes(): Map<string, string> {
    return new Map(this.panes);
  }

  listPanes(): Array<{ paneId: string; memberName: string }> {
    const result: Array<{ paneId: string; memberName: string }> = [];
    for (const [memberName, paneId] of this.panes) {
      result.push({ paneId, memberName });
    }
    return result;
  }

  sendKeys(paneId: string, keys: string): void {
    this.sendCommandToPane(paneId, keys, true).catch(() => {});
  }

  static buildTeammateCommand(options: {
    teamName: string;
    memberName: string;
    taskListId: string;
    workingDir: string;
    model?: string;
    prompt?: string;
  }): string {
    const args: string[] = ['npx', 'claude-code'];

    const env: string[] = [
      `CLAUDE_CODE_TEAM_NAME="${options.teamName}"`,
      `CLAUDE_CODE_AGENT_NAME="${options.memberName}"`,
      `CLAUDE_CODE_AGENT_ROLE="teammate"`,
      `CLAUDE_CODE_TASK_LIST_ID="${options.taskListId}"`,
      `CLAUDE_CODE_ENABLE_AGENT_TEAMS="true"`,
    ];

    if (options.model) {
      args.push('-m', options.model);
    }

    if (options.prompt) {
      args.push('-p', `"${options.prompt.replace(/"/g, '\\"')}"`);
    }

    return `${env.join(' ')} ${args.join(' ')}`;
  }
}

// ============================================================================
// 全局 TmuxBackend 实例管理
// ============================================================================

let activeTmuxBackend: TmuxBackend | null = null;

export function getTmuxBackend(sessionName?: string): TmuxBackend {
  if (!activeTmuxBackend && sessionName) {
    activeTmuxBackend = new TmuxBackend(sessionName);
  }
  if (!activeTmuxBackend) {
    throw new Error('No active TmuxBackend. Call createTmuxBackend() first.');
  }
  return activeTmuxBackend;
}

export function createTmuxBackend(sessionName: string): TmuxBackend {
  activeTmuxBackend = new TmuxBackend(sessionName);
  return activeTmuxBackend;
}

export async function destroyTmuxBackend(): Promise<void> {
  if (activeTmuxBackend) {
    await activeTmuxBackend.destroySession();
    activeTmuxBackend = null;
  }
}
