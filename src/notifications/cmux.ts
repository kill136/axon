/**
 * cmux 集成模块
 * 
 * 检测当前是否在 cmux 终端内运行，并通过 OSC 777 序列或 CLI 发送通知、
 * 更新侧边栏状态/进度/日志。
 * 
 * cmux 是一款 macOS 原生 AI 编程终端：https://github.com/manaflow-ai/cmux
 * 
 * 检测方式：
 *   1. 环境变量 CMUX_WORKSPACE_ID + CMUX_SURFACE_ID（最可靠）
 *   2. Unix socket /tmp/cmux.sock 存在
 *   3. cmux CLI 可用（PATH 中存在 cmux 命令）
 */

import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';

// ============================================================================
// 检测
// ============================================================================

let _detected: boolean | null = null;
let _socketPath: string | null = null;
let _hasCli: boolean | null = null;

/**
 * 获取 cmux socket 路径
 */
function getSocketPath(): string {
  return process.env.CMUX_SOCKET_PATH || '/tmp/cmux.sock';
}

/**
 * 检测是否在 cmux 环境中运行
 */
export function isCmuxAvailable(): boolean {
  if (_detected !== null) return _detected;

  // macOS only — cmux 是 macOS 原生应用
  if (os.platform() !== 'darwin') {
    _detected = false;
    return false;
  }

  // 方式 1: 环境变量（最可靠，cmux 终端内自动设置）
  if (process.env.CMUX_WORKSPACE_ID && process.env.CMUX_SURFACE_ID) {
    _detected = true;
    _socketPath = getSocketPath();
    return true;
  }

  // 方式 2: Socket 文件存在
  const sockPath = getSocketPath();
  try {
    if (fs.existsSync(sockPath) && fs.statSync(sockPath).isSocket()) {
      _detected = true;
      _socketPath = sockPath;
      return true;
    }
  } catch {
    // ignore
  }

  _detected = false;
  return false;
}

/**
 * 检测 cmux CLI 是否可用
 */
function hasCmuxCli(): boolean {
  if (_hasCli !== null) return _hasCli;
  try {
    execFileSync('which', ['cmux'], { stdio: 'ignore', timeout: 2000 });
    _hasCli = true;
  } catch {
    _hasCli = false;
  }
  return _hasCli;
}

/**
 * 重置检测缓存（用于测试）
 */
export function resetDetectionCache(): void {
  _detected = null;
  _socketPath = null;
  _hasCli = null;
}

// ============================================================================
// 通知
// ============================================================================

export interface CmuxNotifyOptions {
  title: string;
  body: string;
  subtitle?: string;
}

/**
 * 通过 OSC 777 终端转义序列发送通知（最轻量，不需要 CLI）
 */
function notifyViaOSC777(options: CmuxNotifyOptions): void {
  // OSC 777 格式: \e]777;notify;title;body\a
  const title = options.title.replace(/[;\x07\x1b]/g, ' ');
  const body = options.body.replace(/[;\x07\x1b]/g, ' ');
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

/**
 * 通过 cmux CLI 发送通知（支持 subtitle）
 */
function notifyViaCli(options: CmuxNotifyOptions): void {
  const args = ['notify', '--title', options.title, '--body', options.body];
  if (options.subtitle) {
    args.push('--subtitle', options.subtitle);
  }
  execFile('cmux', args, { timeout: 5000 }, () => {
    // fire-and-forget
  });
}

/**
 * 通过 Unix socket 发送 JSON-RPC 请求
 */
function sendSocketRpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!_socketPath) {
      reject(new Error('cmux socket path not available'));
      return;
    }

    const client = net.createConnection({ path: _socketPath }, () => {
      const payload = JSON.stringify({
        id: `axon-${Date.now()}`,
        method,
        params,
      }) + '\n';
      client.write(payload);
    });

    let data = '';
    client.on('data', (chunk) => {
      data += chunk.toString();
      // 响应以换行结束
      if (data.includes('\n')) {
        client.end();
        try {
          resolve(JSON.parse(data.trim()));
        } catch {
          resolve(data);
        }
      }
    });

    client.on('error', (err) => {
      reject(err);
    });

    // 超时
    client.setTimeout(5000, () => {
      client.destroy();
      reject(new Error('cmux socket timeout'));
    });
  });
}

/**
 * 通过 socket 发送通知
 */
function notifyViaSocket(options: CmuxNotifyOptions): void {
  const params: Record<string, string> = {
    title: options.title,
    body: options.body,
  };
  if (options.subtitle) {
    params.subtitle = options.subtitle;
  }
  sendSocketRpc('notification.create', params).catch(() => {
    // fallback to OSC 777
    notifyViaOSC777(options);
  });
}

/**
 * 发送 cmux 通知（自动选择最佳通道）
 * 
 * 优先级：CLI > Socket > OSC 777
 */
export function cmuxNotify(options: CmuxNotifyOptions): void {
  if (!isCmuxAvailable()) return;

  if (hasCmuxCli()) {
    notifyViaCli(options);
  } else if (_socketPath) {
    notifyViaSocket(options);
  } else {
    notifyViaOSC777(options);
  }
}

// ============================================================================
// 侧边栏状态 API
// ============================================================================

export interface CmuxStatusOptions {
  key: string;
  value: string;
  icon?: string;
  color?: string;
}

/**
 * 设置侧边栏状态标签
 */
export function cmuxSetStatus(options: CmuxStatusOptions): void {
  if (!isCmuxAvailable()) return;

  if (hasCmuxCli()) {
    const args = ['set-status', options.key, options.value];
    if (options.icon) args.push('--icon', options.icon);
    if (options.color) args.push('--color', options.color);
    execFile('cmux', args, { timeout: 5000 }, () => {});
  } else if (_socketPath) {
    sendSocketRpc('sidebar.set_status', {
      key: options.key,
      value: options.value,
      icon: options.icon,
      color: options.color,
    }).catch(() => {});
  }
}

/**
 * 清除侧边栏状态标签
 */
export function cmuxClearStatus(key: string): void {
  if (!isCmuxAvailable()) return;

  if (hasCmuxCli()) {
    execFile('cmux', ['clear-status', key], { timeout: 5000 }, () => {});
  } else if (_socketPath) {
    sendSocketRpc('sidebar.clear_status', { key }).catch(() => {});
  }
}

// ============================================================================
// 侧边栏进度条
// ============================================================================

/**
 * 设置侧边栏进度条（0.0 - 1.0）
 */
export function cmuxSetProgress(value: number, label?: string): void {
  if (!isCmuxAvailable()) return;

  const clamped = Math.max(0, Math.min(1, value));

  if (hasCmuxCli()) {
    const args = ['set-progress', String(clamped)];
    if (label) args.push('--label', label);
    execFile('cmux', args, { timeout: 5000 }, () => {});
  } else if (_socketPath) {
    sendSocketRpc('sidebar.set_progress', { value: clamped, label }).catch(() => {});
  }
}

/**
 * 清除侧边栏进度条
 */
export function cmuxClearProgress(): void {
  if (!isCmuxAvailable()) return;

  if (hasCmuxCli()) {
    execFile('cmux', ['clear-progress'], { timeout: 5000 }, () => {});
  } else if (_socketPath) {
    sendSocketRpc('sidebar.clear_progress', {}).catch(() => {});
  }
}

// ============================================================================
// 侧边栏日志
// ============================================================================

export type CmuxLogLevel = 'info' | 'progress' | 'success' | 'warning' | 'error';

/**
 * 追加侧边栏日志条目
 */
export function cmuxLog(message: string, level: CmuxLogLevel = 'info', source?: string): void {
  if (!isCmuxAvailable()) return;

  if (hasCmuxCli()) {
    const args = ['log', '--level', level];
    if (source) args.push('--source', source);
    args.push('--', message);
    execFile('cmux', args, { timeout: 5000 }, () => {});
  } else if (_socketPath) {
    sendSocketRpc('sidebar.log', { message, level, source }).catch(() => {});
  }
}

/**
 * 清除侧边栏日志
 */
export function cmuxClearLog(): void {
  if (!isCmuxAvailable()) return;

  if (hasCmuxCli()) {
    execFile('cmux', ['clear-log'], { timeout: 5000 }, () => {});
  } else if (_socketPath) {
    sendSocketRpc('sidebar.clear_log', {}).catch(() => {});
  }
}

// ============================================================================
// 高级 Axon 集成 — 将 Axon 事件桥接到 cmux
// ============================================================================

/**
 * Axon→cmux 事件桥接器
 * 
 * 在关键生命周期事件发生时自动调用 cmux API：
 * - Agent 等待用户输入 → 通知 + 状态
 * - 任务完成 → 通知 + 日志
 * - 工具执行 → 进度条
 * - 错误 → 通知 + 日志
 */
export class CmuxBridge {
  private toolCount = 0;
  private totalTools = 0;
  private enabled: boolean;

  constructor() {
    this.enabled = isCmuxAvailable();
  }

  /**
   * Agent 开始处理用户消息
   */
  onThinking(sessionName?: string): void {
    if (!this.enabled) return;
    cmuxSetStatus({
      key: 'axon',
      value: 'thinking',
      icon: 'brain',
      color: '#7c3aed',
    });
    this.toolCount = 0;
    this.totalTools = 0;
  }

  /**
   * 开始执行工具
   */
  onToolStart(toolName: string, totalExpected?: number): void {
    if (!this.enabled) return;
    this.toolCount++;
    if (totalExpected) this.totalTools = totalExpected;

    cmuxSetStatus({
      key: 'axon',
      value: toolName,
      icon: 'hammer',
      color: '#2563eb',
    });

    if (this.totalTools > 0) {
      cmuxSetProgress(this.toolCount / this.totalTools, `${toolName} (${this.toolCount}/${this.totalTools})`);
    }
  }

  /**
   * 工具执行完成
   */
  onToolComplete(toolName: string, success: boolean): void {
    if (!this.enabled) return;
    cmuxLog(
      `${toolName} ${success ? 'done' : 'failed'}`,
      success ? 'success' : 'error',
      'axon'
    );
  }

  /**
   * Agent 等待用户输入
   */
  onWaitingForInput(question?: string): void {
    if (!this.enabled) return;

    cmuxNotify({
      title: 'Axon',
      subtitle: 'Waiting for input',
      body: question || 'Agent needs your attention',
    });

    cmuxSetStatus({
      key: 'axon',
      value: 'waiting',
      icon: 'bell',
      color: '#f59e0b',
    });

    cmuxClearProgress();
  }

  /**
   * Agent 请求权限
   */
  onPermissionRequest(toolName: string, action: string): void {
    if (!this.enabled) return;

    cmuxNotify({
      title: 'Axon — Permission',
      subtitle: toolName,
      body: `Wants to: ${action}`,
    });

    cmuxSetStatus({
      key: 'axon',
      value: 'permission',
      icon: 'shield',
      color: '#ef4444',
    });
  }

  /**
   * 消息/任务完成
   */
  onComplete(summary?: string): void {
    if (!this.enabled) return;

    cmuxNotify({
      title: 'Axon',
      body: summary || 'Task complete',
    });

    cmuxSetStatus({
      key: 'axon',
      value: 'idle',
      icon: 'checkmark',
      color: '#22c55e',
    });

    cmuxClearProgress();
    cmuxLog(summary || 'Task complete', 'success', 'axon');
  }

  /**
   * 错误发生
   */
  onError(error: string): void {
    if (!this.enabled) return;

    cmuxNotify({
      title: 'Axon — Error',
      body: error,
    });

    cmuxSetStatus({
      key: 'axon',
      value: 'error',
      icon: 'xmark',
      color: '#ef4444',
    });

    cmuxLog(error, 'error', 'axon');
  }

  /**
   * 会话结束 — 清理侧边栏状态
   */
  onSessionEnd(): void {
    if (!this.enabled) return;
    cmuxClearStatus('axon');
    cmuxClearProgress();
  }
}

// 全局单例
let _bridge: CmuxBridge | null = null;

/**
 * 获取全局 CmuxBridge 实例
 */
export function getCmuxBridge(): CmuxBridge {
  if (!_bridge) {
    _bridge = new CmuxBridge();
  }
  return _bridge;
}
