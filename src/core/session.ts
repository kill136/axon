/**
 * 会话管理
 * 处理对话历史和状态
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Message, SessionState, TodoItem, SessionConfig } from '../types/index.js';
import { GitUtils, type GitInfo } from '../git/index.js';

// 会话版本号
const SESSION_VERSION = '2.0';

/**
 * 原子文件写入（对齐官方 fL 函数）
 * 1. 写入临时文件 ${path}.tmp.${pid}.${timestamp}
 * 2. renameSync 原子替换目标文件
 * 3. rename 失败则降级为直接写入
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const tmpFile = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    // 保留原文件权限
    let mode: number | undefined;
    try {
      mode = fs.statSync(filePath).mode;
    } catch { /* 文件不存在，用默认权限 */ }

    fs.writeFileSync(tmpFile, content, { encoding: 'utf-8', flush: true });

    if (mode !== undefined) {
      fs.chmodSync(tmpFile, mode);
    }

    fs.renameSync(tmpFile, filePath);
  } catch {
    // rename 失败（Windows 上目标被锁定时可能发生），降级为直接写
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    fs.writeFileSync(filePath, content, { encoding: 'utf-8', flush: true });
  }
}

// v2.1.27: 全局会话 ID 追踪
let _currentSessionId: string | null = null;

/**
 * 获取当前全局会话 ID
 */
export function getCurrentSessionId(): string | null {
  return _currentSessionId;
}

/**
 * 设置当前全局会话 ID
 */
export function setCurrentSessionId(sessionId: string | null): void {
  _currentSessionId = sessionId;
}

export class Session {
  private state: SessionState;
  private messages: Message[] = [];
  private configDir: string;
  private originalCwd: string; // T153: 追踪原始工作目录
  private gitInfo?: GitInfo;
  private customTitle?: string;
  private isLocked: boolean = false; // T157: 会话锁定状态
  private lockFile?: string; // T157: 锁文件路径
  private agentValue?: string; // v2.1.32: 保存 --agent 值供 resume 复用

  /**
   * Session 构造函数
   *
   * @param cwd - 工作目录，默认为 process.cwd()
   *
   * @example
   * const session = new Session('/path/to/project');
   * const session2 = new Session(); // 使用当前工作目录
   */
  constructor(cwd: string = process.cwd()) {
    // 从环境变量读取配置目录
    this.configDir =
      process.env.CLAUDE_CONFIG_DIR ||
      path.join(os.homedir(), '.claude');

    this.originalCwd = cwd;

    // 从环境变量读取 Session ID，或生成新 ID
    const sessionId = process.env.CLAUDE_CODE_SESSION_ID || randomUUID();

    // 初始化 Session 状态
    this.state = {
      sessionId,
      cwd,
      originalCwd: cwd, // T153: 添加原始目录字段
      startTime: Date.now(),
      totalCostUSD: 0,
      totalAPIDuration: 0,
      totalAPIDurationWithoutRetries: 0, // T143: 区分重试前后的时间
      totalToolDuration: 0, // T143: 工具执行时间统计
      totalLinesAdded: 0, // 代码修改统计：添加的行数
      totalLinesRemoved: 0, // 代码修改统计：删除的行数
      modelUsage: {},
      alwaysAllowedTools: [], // 会话级权限：总是允许的工具列表
      todos: [],
    };

    // 从环境变量读取父会话 ID（用于 fork）
    if (process.env.CLAUDE_CODE_PARENT_SESSION_ID) {
      (this.state as any).parentId = process.env.CLAUDE_CODE_PARENT_SESSION_ID;
    }

    // 确保配置目录存在
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * 异步初始化 Git 信息
   * 应该在创建 Session 后立即调用
   */
  async initializeGitInfo(): Promise<void> {
    try {
      this.gitInfo = await GitUtils.getGitInfo(this.state.cwd) || undefined;
    } catch (error) {
      // Git 信息获取失败不影响 session 创建
      this.gitInfo = undefined;
    }
  }

  /**
   * 获取 Git 信息
   */
  getGitInfo(): GitInfo | undefined {
    return this.gitInfo;
  }

  /**
   * 获取 Git 分支名 (兼容旧代码)
   */
  getGitBranch(): string | undefined {
    return this.gitInfo?.branchName;
  }

  /**
   * 获取格式化的 Git 状态文本
   */
  getFormattedGitStatus(): string | undefined {
    if (!this.gitInfo) {
      return undefined;
    }
    return GitUtils.formatGitStatus(this.gitInfo);
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  get cwd(): string {
    return this.state.cwd;
  }

  setCwd(cwd: string): void {
    this.state.cwd = cwd;
    process.chdir(cwd);
  }

  /**
   * 仅设置工作目录（不改变进程目录）
   * 用于 WebUI 场景，避免 process.chdir 影响其他请求
   */
  setWorkingDirectory(cwd: string): void {
    this.state.cwd = cwd;
  }

  /**
   * 获取访问令牌（从环境变量）
   */
  getAccessToken(): string | undefined {
    return process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN;
  }

  /**
   * 获取 SSE 端口（从环境变量）
   */
  getSsePort(): number | undefined {
    const port = process.env.CLAUDE_CODE_SSE_PORT;
    return port ? parseInt(port, 10) : undefined;
  }

  /**
   * 是否跳过提示历史（从环境变量）
   */
  shouldSkipPromptHistory(): boolean {
    return process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY === 'true' ||
           process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY === '1';
  }

  /**
   * 获取停止后延迟退出时间（从环境变量，单位：ms）
   */
  getExitAfterStopDelay(): number | undefined {
    const delay = process.env.CLAUDE_CODE_EXIT_AFTER_STOP_DELAY;
    return delay ? parseInt(delay, 10) : undefined;
  }

  /**
   * 获取父会话 ID（从 state 或环境变量）
   */
  getParentSessionId(): string | undefined {
    return (this.state as any).parentId || process.env.CLAUDE_CODE_PARENT_SESSION_ID;
  }

  /**
   * v2.1.32: 获取 agent 值（供 --resume 复用）
   */
  getAgent(): string | undefined {
    return this.agentValue;
  }

  /**
   * v2.1.32: 设置 agent 值
   */
  setAgent(agent: string | undefined): void {
    this.agentValue = agent;
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * 设置消息列表（用于压缩后更新会话状态）
   * 对齐官方实现：压缩后直接替换整个消息列表
   * @param messages 新的消息列表
   */
  setMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  clearMessages(): void {
    this.messages = [];
  }

  /**
   * 获取最后一次压缩的边界标记 UUID
   * 用于增量压缩（只压缩新消息，不重复压缩已压缩的内容）
   * @returns 最后一次压缩的 UUID，如果没有则返回 undefined
   */
  getLastCompactedUuid(): string | undefined {
    return this.state.lastCompactedUuid;
  }

  /**
   * 设置最后一次压缩的边界标记 UUID
   * 压缩成功后调用，记录压缩点以便下次增量压缩
   * @param uuid 边界标记的 UUID
   */
  setLastCompactedUuid(uuid: string): void {
    this.state.lastCompactedUuid = uuid;
  }

  getTodos(): TodoItem[] {
    return [...this.state.todos];
  }

  setTodos(todos: TodoItem[]): void {
    this.state.todos = [...todos];
  }

  /**
   * T151/T152: 更新详细的使用统计
   */
  updateUsage(
    model: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      thinkingTokens?: number;
      webSearchRequests?: number;
    },
    cost: number,
    duration: number,
    durationWithoutRetries?: number
  ): void {
    // 初始化模型使用统计
    if (!this.state.modelUsage[model]) {
      this.state.modelUsage[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        thinkingTokens: 0,
        webSearchRequests: 0,
        requests: 0,
        costUSD: 0,
        contextWindow: this.getContextWindow(model),
      };
    }

    // 更新统计
    const stats = this.state.modelUsage[model];
    stats.inputTokens += usage.inputTokens;
    stats.outputTokens += usage.outputTokens;
    stats.cacheReadInputTokens = (stats.cacheReadInputTokens || 0) + (usage.cacheReadInputTokens || 0);
    stats.cacheCreationInputTokens = (stats.cacheCreationInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
    stats.thinkingTokens = (stats.thinkingTokens || 0) + (usage.thinkingTokens || 0);
    stats.webSearchRequests = (stats.webSearchRequests || 0) + (usage.webSearchRequests || 0);
    stats.requests = (stats.requests || 0) + 1; // 增加请求计数
    stats.costUSD += cost;

    // 更新总计
    this.state.totalCostUSD += cost;
    this.state.totalAPIDuration += duration;
    if (durationWithoutRetries !== undefined) {
      this.state.totalAPIDurationWithoutRetries =
        (this.state.totalAPIDurationWithoutRetries || 0) + durationWithoutRetries;
    }
  }

  /**
   * T143: 更新工具执行时间
   */
  updateToolDuration(duration: number): void {
    this.state.totalToolDuration = (this.state.totalToolDuration || 0) + duration;
  }

  /**
   * 更新成本（对应官方的 MT0 函数）
   */
  updateCost(
    costUSD: number,
    modelUsage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      thinkingTokens?: number;
    },
    model: string
  ): void {
    // 初始化模型使用统计
    if (!this.state.modelUsage[model]) {
      this.state.modelUsage[model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        thinkingTokens: 0,
        webSearchRequests: 0,
        requests: 0,
        costUSD: 0,
        contextWindow: this.getContextWindow(model),
      };
    }

    // 更新统计
    const stats = this.state.modelUsage[model];
    stats.inputTokens += modelUsage.inputTokens;
    stats.outputTokens += modelUsage.outputTokens;
    stats.cacheReadInputTokens = (stats.cacheReadInputTokens || 0) + (modelUsage.cacheReadTokens || 0);
    stats.cacheCreationInputTokens = (stats.cacheCreationInputTokens || 0) + (modelUsage.cacheWriteTokens || 0);
    stats.thinkingTokens = (stats.thinkingTokens || 0) + (modelUsage.thinkingTokens || 0);
    stats.requests = (stats.requests || 0) + 1;
    stats.costUSD += costUSD;

    // 更新总成本
    this.state.totalCostUSD += costUSD;
  }

  /**
   * 更新 API 时长（对应官方的 OT0 函数）
   */
  updateAPIDuration(duration: number, durationWithoutRetries?: number): void {
    this.state.totalAPIDuration += duration;
    if (durationWithoutRetries !== undefined) {
      this.state.totalAPIDurationWithoutRetries =
        (this.state.totalAPIDurationWithoutRetries || 0) + durationWithoutRetries;
    }
  }

  /**
   * 更新代码修改统计（对应官方的 mF1 函数）
   */
  updateCodeChanges(linesAdded: number, linesRemoved: number): void {
    this.state.totalLinesAdded = (this.state.totalLinesAdded || 0) + linesAdded;
    this.state.totalLinesRemoved = (this.state.totalLinesRemoved || 0) + linesRemoved;
  }

  /**
   * 追踪工具执行时长
   */
  async trackToolExecution<T>(
    toolName: string,
    execute: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      return await execute();
    } finally {
      const duration = Date.now() - start;
      this.updateToolDuration(duration);
    }
  }

  /**
   * 获取模型的上下文窗口大小
   */
  private getContextWindow(model: string): number {
    if (model.includes('opus-4')) return 200000;
    if (model.includes('sonnet-4')) return 200000;
    if (model.includes('haiku-4')) return 200000;
    if (model.includes('sonnet-3.7')) return 200000;
    if (model.includes('sonnet-3.5')) return 200000;
    if (model.includes('opus-3')) return 200000;
    if (model.includes('haiku')) return 200000;
    return 200000; // 默认值
  }

  /**
   * T151/T152: 获取详细统计信息
   */
  getStats(): {
    duration: number;
    totalCost: string;
    messageCount: number;
    modelUsage: Record<string, import('../types/index.js').ModelUsageStats>;
    totalTokens: number;
    totalToolDuration: number;
  } {
    // 计算总 token 数
    let totalTokens = 0;
    for (const stats of Object.values(this.state.modelUsage)) {
      totalTokens += stats.inputTokens + stats.outputTokens;
    }

    return {
      duration: Date.now() - this.state.startTime,
      totalCost: `$${this.state.totalCostUSD.toFixed(4)}`,
      messageCount: this.messages.length,
      modelUsage: { ...this.state.modelUsage },
      totalTokens,
      totalToolDuration: this.state.totalToolDuration || 0,
    };
  }

  /**
   * 获取会话摘要
   */
  getSessionSummary(): string {
    const duration = Date.now() - this.state.startTime;
    const durationSeconds = Math.floor(duration / 1000);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = durationSeconds % 60;

    const linesAdded = this.state.totalLinesAdded || 0;
    const linesRemoved = this.state.totalLinesRemoved || 0;

    // 格式化模型使用统计
    let modelUsageStr = '';
    for (const [model, stats] of Object.entries(this.state.modelUsage)) {
      const totalTokens = stats.inputTokens + stats.outputTokens;
      modelUsageStr += `\n  ${model}:`;
      modelUsageStr += `\n    - Requests: ${stats.requests || 0}`;
      modelUsageStr += `\n    - Total Tokens: ${totalTokens.toLocaleString()}`;
      modelUsageStr += `\n    - Input: ${stats.inputTokens.toLocaleString()}`;
      modelUsageStr += `\n    - Output: ${stats.outputTokens.toLocaleString()}`;
      if (stats.thinkingTokens) {
        modelUsageStr += `\n    - Thinking: ${stats.thinkingTokens.toLocaleString()}`;
      }
      if (stats.cacheReadInputTokens) {
        modelUsageStr += `\n    - Cache Read: ${stats.cacheReadInputTokens.toLocaleString()}`;
      }
      if (stats.cacheCreationInputTokens) {
        modelUsageStr += `\n    - Cache Write: ${stats.cacheCreationInputTokens.toLocaleString()}`;
      }
      modelUsageStr += `\n    - Cost: $${stats.costUSD.toFixed(4)}`;
    }

    return `
会话摘要:
────────────────────────────────────────
总成本:            $${this.state.totalCostUSD.toFixed(4)}
API 总时长:        ${this.state.totalAPIDuration}ms
API 时长(无重试):  ${this.state.totalAPIDurationWithoutRetries || 0}ms
工具执行时长:      ${this.state.totalToolDuration || 0}ms
会话总时长:        ${minutes}m ${seconds}s
代码修改:          +${linesAdded} -${linesRemoved} (${linesAdded + linesRemoved} 行总变化)
消息数量:          ${this.messages.length}
${modelUsageStr ? '\n模型使用统计:' + modelUsageStr : ''}
────────────────────────────────────────
`;
  }

  // 设置自定义标题
  setCustomTitle(title: string): void {
    this.customTitle = title;
  }

  // 获取第一条用户消息作为摘要
  getFirstPrompt(): string | undefined {
    const firstUserMessage = this.messages.find(m => m.role === 'user');
    if (firstUserMessage && typeof firstUserMessage.content === 'string') {
      return firstUserMessage.content.slice(0, 100);
    }
    return undefined;
  }

  /**
   * 保存会话到文件
   * 使用原子写入（tmp+rename）防止半写文件，使用排他锁防止并发写入
   */
  save(): string {
    const sessionFile = path.join(this.configDir, 'sessions', `${this.state.sessionId}.json`);
    const sessionDir = path.dirname(sessionFile);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    this.acquireLock();

    try {
      const data = {
        version: SESSION_VERSION,
        state: this.state,
        messages: this.messages,
        metadata: {
          gitInfo: this.gitInfo,
          gitBranch: this.gitInfo?.branchName,
          gitStatus: this.gitInfo?.isClean ? 'clean' : 'dirty',
          gitDefaultBranch: this.gitInfo?.defaultBranch,
          gitCommitHash: this.gitInfo?.commitHash,
          customTitle: this.customTitle,
          firstPrompt: this.getFirstPrompt(),
          projectPath: this.state.cwd,
          created: this.state.startTime,
          modified: Date.now(),
          messageCount: this.messages.length,
          agent: this.agentValue,
        },
      };

      const content = JSON.stringify(data, null, 2);
      atomicWriteFileSync(sessionFile, content);
      return sessionFile;
    } finally {
      this.releaseLock();
    }
  }

  /**
   * T147: 从文件加载会话（修复元数据恢复 bug）
   */
  static load(sessionId: string): Session | null {
    // T145: 支持 CLAUDE_CONFIG_DIR 环境变量
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const sessionFile = path.join(configDir, 'sessions', `${sessionId}.json`);

    if (!fs.existsSync(sessionFile)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      // T157: 版本兼容性检查
      if (data.version && data.version !== SESSION_VERSION) {
        console.warn(`Session ${sessionId} has version ${data.version}, current version is ${SESSION_VERSION}`);
        // 可以在这里进行版本迁移
      }

      const session = new Session(data.state.cwd);
      session.state = data.state;
      session.messages = data.messages || [];

      // T147: 修复 bug - 恢复元数据
      if (data.metadata) {
        session.gitInfo = data.metadata.gitInfo;
        session.customTitle = data.metadata.customTitle;
        // v2.1.32: 恢复 agent 值
        session.agentValue = data.metadata.agent;
      }

      return session;
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * T148: 列出所有会话
   */
  static listSessions(): Array<{ id: string; startTime: number; cwd: string }> {
    // T145: 支持 CLAUDE_CONFIG_DIR 环境变量
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const sessionsDir = path.join(configDir, 'sessions');

    if (!fs.existsSync(sessionsDir)) {
      return [];
    }

    return fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
          return {
            id: data.state.sessionId,
            startTime: data.state.startTime,
            cwd: data.state.cwd,
          };
        } catch {
          return null;
        }
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * T149: 清理过期会话（默认 30 天）
   */
  static cleanupExpiredSessions(maxAgeDays: number = 30): number {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const sessionsDir = path.join(configDir, 'sessions');

    if (!fs.existsSync(sessionsDir)) {
      return 0;
    }

    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let cleaned = 0;

    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(sessionsDir, file);

      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // 使用最后修改时间（metadata.modified 或文件的 mtime）
        const modifiedTime = data.metadata?.modified || fs.statSync(filePath).mtimeMs;

        if (modifiedTime < cutoffTime) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (error) {
        // 如果文件损坏，也删除它
        try {
          fs.unlinkSync(filePath);
          cleaned++;
        } catch {
          // 忽略删除失败
        }
      }
    }

    return cleaned;
  }

  /**
   * 获取排他锁（防止并发修改）
   * 使用 'wx' flag 原子创建锁文件，写入 PID 用于僵尸锁检测
   */
  private acquireLock(): void {
    if (this.isLocked) {
      return;
    }

    this.lockFile = path.join(this.configDir, 'sessions', `.${this.state.sessionId}.lock`);

    // 尝试原子创建锁文件（wx = 排他写，文件已存在则抛 EEXIST）
    try {
      fs.writeFileSync(this.lockFile, `${process.pid}\n${Date.now()}`, { flag: 'wx' });
      this.isLocked = true;
      return;
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      // 锁文件已存在，检查是否为僵尸锁
    }

    // 读取已有锁文件，检查持锁进程是否存活
    try {
      const lockData = fs.readFileSync(this.lockFile, 'utf-8');
      const [pidStr, timeStr] = lockData.split('\n');
      const lockPid = parseInt(pidStr, 10);
      const lockTime = parseInt(timeStr, 10);

      // 检查持锁进程是否还活着
      let processAlive = false;
      if (!isNaN(lockPid)) {
        try {
          process.kill(lockPid, 0); // signal 0 不发送信号，仅检查进程是否存在
          processAlive = true;
        } catch {
          // 进程不存在，这是僵尸锁
        }
      }

      if (processAlive) {
        // 进程存活：检查锁是否超过 2 小时（对齐官方 STUCK_RUN_MS）
        const LOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
        if (!isNaN(lockTime) && Date.now() - lockTime > LOCK_TIMEOUT_MS) {
          // 超时，强制接管
          fs.unlinkSync(this.lockFile);
        } else {
          throw new Error(`Session ${this.state.sessionId} is locked by PID ${lockPid}`);
        }
      } else {
        // 僵尸锁，删除后重新获取
        fs.unlinkSync(this.lockFile);
      }
    } catch (err: any) {
      // 如果是我们自己抛的"is locked by PID"错误，直接抛出
      if (err.message?.includes('is locked by PID')) throw err;
      // 其他错误（读取锁文件失败等），尝试清理后继续
      try { fs.unlinkSync(this.lockFile); } catch { /* ignore */ }
    }

    // 重新尝试创建锁文件
    try {
      fs.writeFileSync(this.lockFile, `${process.pid}\n${Date.now()}`, { flag: 'wx' });
      this.isLocked = true;
    } catch (err: any) {
      // 再次 EEXIST 说明有竞态，放弃
      if (err.code === 'EEXIST') {
        throw new Error(`Session ${this.state.sessionId} is locked by another process (race condition)`);
      }
      throw err;
    }
  }

  /**
   * 释放锁
   * 验证锁文件中的 PID 是自己的才删除，防止误删其他进程的锁
   */
  private releaseLock(): void {
    if (!this.isLocked || !this.lockFile) {
      return;
    }

    try {
      if (fs.existsSync(this.lockFile)) {
        // 验证是自己的锁再删
        const lockData = fs.readFileSync(this.lockFile, 'utf-8');
        const lockPid = parseInt(lockData.split('\n')[0], 10);
        if (lockPid === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      }
    } catch {
      // 释放锁失败不应阻塞正常流程
    }

    this.isLocked = false;
    this.lockFile = undefined;
  }

  /**
   * T153: 获取原始工作目录
   */
  getOriginalCwd(): string {
    return this.originalCwd;
  }

  /**
   * 检查工具是否在会话允许列表中
   */
  isToolAlwaysAllowed(toolName: string): boolean {
    return this.state.alwaysAllowedTools?.includes(toolName) || false;
  }

  /**
   * 将工具添加到会话允许列表中
   */
  addAlwaysAllowedTool(toolName: string): void {
    if (!this.state.alwaysAllowedTools) {
      this.state.alwaysAllowedTools = [];
    }

    if (!this.state.alwaysAllowedTools.includes(toolName)) {
      this.state.alwaysAllowedTools.push(toolName);
    }
  }

  /**
   * 从会话允许列表中移除工具
   */
  removeAlwaysAllowedTool(toolName: string): void {
    if (!this.state.alwaysAllowedTools) {
      return;
    }

    this.state.alwaysAllowedTools = this.state.alwaysAllowedTools.filter(
      (tool) => tool !== toolName
    );
  }

  /**
   * 清空会话允许列表
   */
  clearAlwaysAllowedTools(): void {
    this.state.alwaysAllowedTools = [];
  }

  /**
   * 获取会话允许的工具列表
   */
  getAllowedTools(): string[] {
    return [...(this.state.alwaysAllowedTools || [])];
  }
}
