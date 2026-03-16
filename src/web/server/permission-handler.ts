/**
 * WebUI 权限处理器
 * 处理敏感工具操作的权限确认
 *
 * v2.1.3 新功能：
 * - 可点击的目标选择器，允许用户选择权限设置保存的位置
 * - 支持 This project / All projects / Shared with team / Session only
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PermissionMode } from '../../types/index.js';

/**
 * 权限保存目标类型
 */
export type PermissionDestination = 'project' | 'global' | 'team' | 'session';

/**
 * 权限请求
 */
export interface PermissionRequest {
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

/**
 * 权限响应（扩展版）
 */
export interface PermissionResponse {
  requestId: string;
  approved: boolean;
  remember?: boolean; // 是否记住此次决定
  scope?: 'once' | 'session' | 'always'; // 记忆范围
  destination?: PermissionDestination; // v2.1.3: 保存目标
}

/**
 * 待处理的权限请求
 */
interface PendingRequest {
  request: PermissionRequest;
  resolve: (approved: boolean) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * 权限配置
 */
export interface PermissionConfig {
  mode: PermissionMode;
  timeout: number; // 超时时间（毫秒），默认 60000
  bypassTools?: string[]; // 绕过权限检查的工具列表
  alwaysAllow?: string[]; // 总是允许的工具列表
  alwaysDeny?: string[]; // 总是拒绝的工具列表
}

/**
 * 权限处理器
 *
 * 职责：
 * 1. 判断工具是否需要权限确认
 * 2. 创建权限请求并等待用户响应
 * 3. 管理权限决策的记忆（会话级别）
 * 4. 处理超时和错误情况
 */
export class PermissionHandler {
  private pendingRequests = new Map<string, PendingRequest>();
  private sessionMemory = new Map<string, boolean>(); // 会话级别的权限记忆
  private config: PermissionConfig;

  // 需要权限确认的工具列表
  private static readonly SENSITIVE_TOOLS = new Set([
    'Write',
    'Edit',
    'MultiEdit',
    'Bash',
    'NotebookEdit',
    // TaskStop merged into TaskOutput action=stop — checked dynamically below
  ]);

  // 危险的 Bash 命令模式
  private static readonly DANGEROUS_BASH_PATTERNS = [
    /^\s*rm\s+/i,
    /^\s*sudo\s+/i,
    /^\s*chmod\s+/i,
    /^\s*chown\s+/i,
    /^\s*mv\s+.*\//i, // 移动到其他目录
    /^\s*dd\s+/i,
    /^\s*mkfs\s+/i,
    /^\s*format\s+/i,
    />\s*\/dev\//i,
  ];

  constructor(config?: Partial<PermissionConfig>) {
    this.config = {
      mode: config?.mode || 'default',
      timeout: config?.timeout || 60000, // 默认 60 秒超时
      bypassTools: config?.bypassTools || [],
      alwaysAllow: config?.alwaysAllow || [],
      alwaysDeny: config?.alwaysDeny || [],
    };
  }

  /**
   * 检查工具是否需要权限确认
   */
  needsPermission(tool: string, args: unknown): boolean {
    // 模式检查
    if (this.config.mode === 'bypassPermissions') {
      return false;
    }

    if (this.config.mode === 'plan') {
      // 计划模式下所有操作都需要确认
      return true;
    }

    // 检查配置的绕过列表
    if (this.config.bypassTools?.includes(tool)) {
      return false;
    }

    // 检查总是允许列表
    if (this.config.alwaysAllow?.includes(tool)) {
      return false;
    }

    // 检查总是拒绝列表（虽然会被拒绝，但仍然需要权限流程）
    if (this.config.alwaysDeny?.includes(tool)) {
      return true;
    }

    // acceptEdits 模式：自动允许文件编辑
    if (this.config.mode === 'acceptEdits') {
      if (['Write', 'Edit', 'MultiEdit'].includes(tool)) {
        return false;
      }
    }

    // TaskOutput action=stop needs permission (merged from TaskStop)
    if (tool === 'TaskOutput') {
      const taskArgs = args as Record<string, unknown>;
      return taskArgs?.action === 'stop';
    }

    // 检查工具是否在敏感列表中
    if (!PermissionHandler.SENSITIVE_TOOLS.has(tool)) {
      return false;
    }

    // 特殊处理 Bash 命令
    if (tool === 'Bash') {
      return this.isBashCommandDangerous(args);
    }

    // 其他敏感工具默认需要权限
    return true;
  }

  /**
   * 判断 Bash 命令是否危险
   */
  private isBashCommandDangerous(args: unknown): boolean {
    const argsObj = args as Record<string, unknown>;
    const command = argsObj.command as string;

    if (!command) {
      return false;
    }

    // 检查是否匹配危险模式
    for (const pattern of PermissionHandler.DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return true;
      }
    }

    // 检查是否有管道到危险位置
    if (command.includes('>') && command.includes('/')) {
      return true;
    }

    return false;
  }

  /**
   * 创建权限请求
   */
  createRequest(tool: string, args: unknown): PermissionRequest {
    const requestId = this.generateRequestId();
    const argsObj = args as Record<string, unknown>;

    // 生成描述
    const description = this.generateDescription(tool, argsObj);

    // 评估风险级别
    const riskLevel = this.assessRiskLevel(tool, argsObj);

    return {
      requestId,
      tool,
      args: argsObj,
      description,
      riskLevel,
      timestamp: Date.now(),
    };
  }

  /**
   * 生成权限请求描述
   */
  private generateDescription(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case 'Write':
        return `Create/overwrite file: ${args.file_path}`;

      case 'Edit':
        return `Edit file: ${args.file_path}`;

      case 'MultiEdit':
        const edits = args.edits as Array<{ file_path: string }> || [];
        return `Batch edit ${edits.length} files`;

      case 'Bash':
        const command = args.command as string;
        const truncated = command.length > 50 ? command.slice(0, 50) + '...' : command;
        return `Execute command: ${truncated}`;

      case 'NotebookEdit':
        return `Edit Notebook: ${args.notebook_path}`;

      case 'TaskOutput':
        if (args.action === 'stop') {
          return `Kill process: ${args.task_id}`;
        }
        return `Get task output: ${args.task_id}`;

      default:
        return `Execute ${tool}`;
    }
  }

  /**
   * 评估风险级别
   */
  private assessRiskLevel(tool: string, args: Record<string, unknown>): 'low' | 'medium' | 'high' {
    // Bash 命令风险评估
    if (tool === 'Bash') {
      const command = args.command as string;
      if (!command) return 'low';

      // 高风险命令
      if (/^\s*(rm|sudo|chmod|chown|dd|mkfs|format)/i.test(command)) {
        return 'high';
      }

      // 中风险命令
      if (/^\s*(mv|cp|curl|wget|git\s+push)/i.test(command)) {
        return 'medium';
      }

      return 'low';
    }

    // TaskOutput action=stop
    if (tool === 'TaskOutput') {
      const taskArgs = args as Record<string, unknown>;
      if (taskArgs?.action === 'stop') return 'medium';
      return 'low';
    }

    // 批量编辑
    if (tool === 'MultiEdit') {
      const edits = args.edits as Array<unknown> || [];
      return edits.length > 5 ? 'high' : 'medium';
    }

    // 文件写入
    if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') {
      return 'medium';
    }

    return 'low';
  }

  /**
   * 请求权限并等待响应
   *
   * 这个方法整合了创建请求、注册、等待响应的完整流程
   * 避免了分离 registerRequest 和 waitForResponse 导致的 Promise 处理问题
   *
   * @param tool 工具名称
   * @param args 工具参数
   * @param onRequestCreated 可选回调，当请求创建后调用（用于发送到前端）
   * @returns Promise<boolean> 当用户批准时返回 true，拒绝时返回 false
   * @throws Error 当超时或取消时抛出错误
   */
  async requestPermission(
    tool: string,
    args: unknown,
    onRequestCreated?: (request: PermissionRequest) => void
  ): Promise<boolean> {
    // 1. 创建权限请求
    const request = this.createRequest(tool, args);

    // 2. 通知外部（例如发送到前端）
    if (onRequestCreated) {
      onRequestCreated(request);
    }

    // 3. 创建 Promise 并设置超时
    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.requestId);
        reject(new Error('Permission request timed out'));
      }, this.config.timeout);

      // 4. 保存请求和 Promise 控制函数
      this.pendingRequests.set(request.requestId, {
        request,
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * @deprecated 使用 requestPermission 替代
   * 保留此方法用于向后兼容
   */
  async waitForResponse(requestId: string): Promise<boolean> {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      throw new Error(`Permission request not found: ${requestId}`);
    }

    // 返回现有的 Promise（通过创建一个新的 Promise 来包装）
    return new Promise<boolean>((resolve, reject) => {
      // 替换现有的 resolve/reject
      const originalResolve = pending.resolve;
      const originalReject = pending.reject;

      pending.resolve = (value: boolean) => {
        originalResolve(value);
        resolve(value);
      };

      pending.reject = (error: Error) => {
        originalReject(error);
        reject(error);
      };
    });
  }

  /**
   * @deprecated 使用 requestPermission 替代
   * 保留此方法用于向后兼容
   */
  registerRequest(request: PermissionRequest): void {
    // 创建一个永不解析的 Promise（仅用于占位）
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(request.requestId);
    }, this.config.timeout);

    this.pendingRequests.set(request.requestId, {
      request,
      resolve: () => {
        console.warn('[PermissionHandler] resolve called but no associated Promise');
      },
      reject: () => {
        console.warn('[PermissionHandler] reject called but no associated Promise');
      },
      timeout,
    });
  }

  /**
   * 处理用户响应
   */
  handleResponse(
    requestId: string,
    approved: boolean,
    remember?: boolean,
    scope?: 'once' | 'session' | 'always',
    destination?: PermissionDestination
  ): void {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      console.warn(`[PermissionHandler] Pending permission request not found: ${requestId}`);
      return;
    }

    // 清除超时
    clearTimeout(pending.timeout);

    // 记忆决策
    if (remember && scope === 'session') {
      const key = this.getMemoryKey(pending.request.tool, pending.request.args);
      this.sessionMemory.set(key, approved);
    }

    // v2.1.3: 根据目标保存权限规则
    if (remember && destination && destination !== 'session') {
      this.savePermissionToDestination(pending.request.tool, pending.request.args, approved, destination);
    }

    // 解析 Promise
    pending.resolve(approved);

    // 清理
    this.pendingRequests.delete(requestId);
  }

  /**
   * v2.1.3: 将权限规则保存到指定目标
   */
  private savePermissionToDestination(
    tool: string,
    args: Record<string, unknown>,
    approved: boolean,
    destination: PermissionDestination
  ): void {
    try {
      // 获取配置文件路径
      const configPath = this.getConfigPathForDestination(destination);
      if (!configPath) {
        console.warn(`[PermissionHandler] Invalid destination: ${destination}`);
        return;
      }

      // 读取现有配置
      let config: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf-8');
          config = JSON.parse(content);
        } catch (e) {
          console.warn(`[PermissionHandler] Failed to parse config at ${configPath}:`, e);
          config = {};
        }
      }

      // 确保 permissions 对象存在
      if (!config.permissions) {
        config.permissions = {};
      }
      const permissions = config.permissions as Record<string, unknown>;

      // 确保 allow/deny 数组存在
      if (!permissions.allow) {
        permissions.allow = [];
      }
      if (!permissions.deny) {
        permissions.deny = [];
      }

      const allowList = permissions.allow as string[];
      const denyList = permissions.deny as string[];

      // 生成权限规则
      const rule = this.generatePermissionRule(tool, args);

      // 添加到适当的列表
      if (approved) {
        // 从 deny 列表移除（如果存在）
        const denyIndex = denyList.indexOf(rule);
        if (denyIndex !== -1) {
          denyList.splice(denyIndex, 1);
        }
        // 添加到 allow 列表（如果不存在）
        if (!allowList.includes(rule)) {
          allowList.push(rule);
        }
      } else {
        // 从 allow 列表移除（如果存在）
        const allowIndex = allowList.indexOf(rule);
        if (allowIndex !== -1) {
          allowList.splice(allowIndex, 1);
        }
        // 添加到 deny 列表（如果不存在）
        if (!denyList.includes(rule)) {
          denyList.push(rule);
        }
      }

      // 确保目录存在
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 保存配置
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

      console.log(`[PermissionHandler] Permission rule saved to ${destination}: ${rule} (${approved ? 'allow' : 'deny'})`);

      // 如果是 team 目标，确保 .gitignore 不忽略 settings.local.json
      if (destination === 'team') {
        this.ensureLocalSettingsInGitignore(configDir);
      }
    } catch (error) {
      console.error(`[PermissionHandler] Failed to save permission to ${destination}:`, error);
    }
  }

  /**
   * 获取目标对应的配置文件路径
   */
  private getConfigPathForDestination(destination: PermissionDestination): string | null {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const cwd = process.cwd();

    switch (destination) {
      case 'project':
        // .axon/settings.json - 项目配置，团队共享
        return path.join(cwd, '.axon', 'settings.json');

      case 'global':
        // ~/.axon/settings.json - 全局配置
        return path.join(homeDir, '.axon', 'settings.json');

      case 'team':
        // .axon/settings.local.json - 本地配置，机器特定
        return path.join(cwd, '.axon', 'settings.local.json');

      case 'session':
        // 仅会话，不保存
        return null;

      default:
        return null;
    }
  }

  /**
   * 生成权限规则字符串
   */
  private generatePermissionRule(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case 'Bash': {
        const command = args.command as string;
        if (!command) return `Bash()`;

        const normalizedCmd = command.trim().replace(/\\\r?\n\s*/g, ' ').replace(/\s+/g, ' ');

        // v2.1.59: 复合命令（包含 &&, ||, ; 等）保存完整命令字符串作为精确匹配规则
        if (/(?:&&|\|\||;|\|)/.test(normalizedCmd)) {
          return `Bash(${normalizedCmd})`;
        }

        // 提取命令名称和主要参数
        const parts = normalizedCmd.split(/\s+/);
        const cmdName = parts[0] || '';

        // 对于常见命令，生成更精确的规则
        if (['npm', 'yarn', 'pnpm', 'git', 'node', 'python', 'pip'].includes(cmdName)) {
          const subCmd = parts[1] || '';
          if (subCmd) {
            return `Bash(${cmdName} ${subCmd}:*)`;
          }
        }

        return `Bash(${cmdName}:*)`;
      }

      case 'Write':
      case 'Edit':
      case 'NotebookEdit': {
        const filePath = (args.file_path || args.notebook_path) as string;
        if (!filePath) return `${tool}()`;

        // 提取文件扩展名生成规则
        const ext = path.extname(filePath);
        if (ext) {
          return `${tool}(*${ext})`;
        }

        return `${tool}(${filePath})`;
      }

      case 'MultiEdit': {
        return `MultiEdit(*)`;
      }

      case 'TaskOutput': {
        return `TaskOutput(*)`;
      }

      default:
        return `${tool}(*)`;
    }
  }

  /**
   * 确保 .gitignore 包含 settings.local.json
   */
  private ensureLocalSettingsInGitignore(claudeDir: string): void {
    const projectRoot = path.dirname(claudeDir);
    const gitignorePath = path.join(projectRoot, '.gitignore');

    try {
      let content = '';
      if (fs.existsSync(gitignorePath)) {
        content = fs.readFileSync(gitignorePath, 'utf-8');
      }

      const pattern = '.axon/settings.local.json';

      if (!content.includes(pattern)) {
        const addition = `\n# Axon local settings (machine-specific)\n${pattern}\n`;
        fs.writeFileSync(gitignorePath, content + addition, 'utf-8');
        console.log(`[PermissionHandler] Added ${pattern} to .gitignore`);
      }
    } catch (error) {
      // 忽略 .gitignore 更新失败
      console.warn(`[PermissionHandler] Failed to update .gitignore:`, error);
    }
  }

  /**
   * 检查是否已有会话级别的权限记忆
   */
  checkSessionMemory(tool: string, args: unknown): boolean | null {
    const key = this.getMemoryKey(tool, args as Record<string, unknown>);
    const remembered = this.sessionMemory.get(key);
    return remembered !== undefined ? remembered : null;
  }

  /**
   * 生成记忆键
   */
  private getMemoryKey(tool: string, args: Record<string, unknown>): string {
    switch (tool) {
      case 'Write':
      case 'Edit':
      case 'NotebookEdit':
        // 按文件路径记忆
        return `${tool}:${args.file_path}`;

      case 'Bash':
        // 按命令主体记忆（第一个单词）
        const command = args.command as string;
        const cmdName = command.trim().split(/\s+/)[0];
        return `Bash:${cmdName}`;

      case 'MultiEdit':
        // 批量编辑不记忆（每次都需要确认）
        return `${tool}:${Date.now()}`;

      default:
        return `${tool}:*`;
    }
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * 取消所有待处理的请求
   */
  cancelAll(): void {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Permission request cancelled'));
    });
    this.pendingRequests.clear();
  }

  /**
   * 取消特定请求
   */
  cancelRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Permission request cancelled'));
      this.pendingRequests.delete(requestId);
    }
  }

  /**
   * 清除会话记忆
   */
  clearSessionMemory(): void {
    this.sessionMemory.clear();
  }

  /**
   * 更新配置
   * 当切换到 bypassPermissions 模式时，自动批准所有待处理的权限请求
   */
  updateConfig(config: Partial<PermissionConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };

    // 切换到 bypassPermissions 模式时，自动批准所有待处理的权限请求
    // 避免对话循环阻塞在等待用户响应的 Promise 上
    if (config.mode === 'bypassPermissions') {
      this.approveAllPending();
    }
  }

  /**
   * 自动批准所有待处理的权限请求
   */
  private approveAllPending(): void {
    if (this.pendingRequests.size === 0) return;
    console.log(`[PermissionHandler] bypassPermissions mode activated, auto-approving ${this.pendingRequests.size} pending requests`);
    this.pendingRequests.forEach((pending, requestId) => {
      clearTimeout(pending.timeout);
      pending.resolve(true);
      this.pendingRequests.delete(requestId);
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): PermissionConfig {
    return { ...this.config };
  }

  /**
   * 获取待处理请求数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 获取所有待处理的权限请求（用于会话切换时重发到前端）
   */
  getPendingRequests(): PermissionRequest[] {
    return Array.from(this.pendingRequests.values()).map(p => p.request);
  }
}
