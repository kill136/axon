/**
 * 网络模块
 * 提供代理、超时、重试等网络功能 + Agent 间去中心化通信系统
 */

// ======== 原有网络基础设施导出 (向后兼容) ========

// 代理支持
export type { ProxyConfig, ProxyAgentOptions, MTLSConfig } from './proxy.js';
export {
  getProxyFromEnv,
  parseProxyUrl,
  shouldBypassProxy,
  createProxyAgent,
  getProxyInfo,
  loadMTLSConfig,
} from './proxy.js';

// 超时和取消
export type { TimeoutConfig } from './timeout.js';
export {
  DEFAULT_TIMEOUTS,
  createTimeoutSignal,
  combineSignals,
  withTimeout,
  cancelableDelay,
  TimeoutError,
  AbortError,
  isTimeoutError,
  isAbortError,
} from './timeout.js';

// 全局 fetch 代理
export { setupGlobalFetchProxy } from './global-proxy.js';

// 重试策略
export type { RetryConfig } from './retry.js';
export {
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  withRetry,
  retry,
} from './retry.js';

// ======== Agent Network (AI Agent 间通信) ========

/**
 * Agent Network — AI Agent 间去中心化通信系统
 *
 * 使用:
 *   const network = new AgentNetwork();
 *   await network.start(config, cwd);
 *   network.on('agent:found', agent => ...);
 *   network.on('message', entry => ...);
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type {
  NetworkConfig,
  AgentIdentity,
  AgentMessage,
  DiscoveredAgent,
  AuditLogEntry,
  NetworkStatus,
  DelegatedTask,
  AgentGroup,
} from './types.js';
import { AgentMethod } from './types.js';
import { IdentityManager, computeFingerprint } from './identity.js';
import { AgentDiscovery } from './discovery.js';
import { AgentTransport, type AgentConnection } from './transport.js';
import { PermissionManager } from './permission.js';
import { AuditLog } from './audit-log.js';
import { AgentRouter } from './router.js';
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  verifyMessage,
  isRequest,
  isResponse,
  isNotification,
  AgentErrorCode,
} from './protocol.js';

// Re-export types
export type {
  NetworkConfig,
  AgentIdentity,
  AgentMessage,
  DiscoveredAgent,
  AuditLogEntry,
  NetworkStatus,
  NetworkServerMessage,
  NetworkClientMessage,
  DelegatedTask,
  DelegatedTaskStatus,
  AgentGroup,
} from './types.js';
export { DEFAULT_NETWORK_CONFIG, PROTOCOL_VERSION } from './types.js';
export { AgentMethod } from './types.js';

export class AgentNetwork extends EventEmitter {
  /** 单例引用，供 NetworkTool 等无法直接访问 Express app 的模块使用 */
  static instance: AgentNetwork | null = null;

  private identityManager = new IdentityManager();
  private discovery = new AgentDiscovery();
  private transport!: AgentTransport;
  private permissionManager!: PermissionManager;
  private auditLog = new AuditLog();
  private router!: AgentRouter;
  private config!: NetworkConfig;
  private started = false;

  // 等待响应的 pending 请求
  private pendingRequests = new Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  // 委派任务的活跃追踪
  private activeTasks = new Map<string, DelegatedTask>();

  /**
   * 启动 Agent Network
   */
  async start(config: NetworkConfig, cwd: string = process.cwd(), version: string = ''): Promise<void> {
    if (this.started) return;
    this.config = config;

    // 1. 初始化身份
    await this.identityManager.initialize(config, cwd);

    // 填充 exposedTools
    try {
      const { toolRegistry } = await import('../tools/base.js');
      this.identityManager.identity.exposedTools = toolRegistry.getAll().map(t => t.name);
    } catch {
      // tools module may not be loaded yet
    }

    // 2. 初始化权限
    this.permissionManager = new PermissionManager(this.identityManager);

    // 3. 初始化审计日志
    await this.auditLog.initialize();

    // 4. 初始化传输层
    this.transport = new AgentTransport(this.identityManager, this.permissionManager);
    const actualPort = await this.transport.listen(config.port);

    // 更新身份的 endpoint 和 version
    // 使用 LAN IP 地址而非 hostname，因为 hostname 在跨机器时无法 DNS 解析
    const identity = this.identityManager.identity;
    const lanIp = this.getLanIpAddress();
    identity.endpoint = `${lanIp}:${actualPort}`;
    identity.version = version;

    // 5. 初始化路由
    this.router = new AgentRouter(this.discovery);

    // 6. 注册事件
    this.setupDiscoveryEvents();
    this.setupTransportEvents();

    // 7. 启动发现
    await this.discovery.start(identity, actualPort, config.advertise);

    // 8. 清理过期离线消息
    this.auditLog.cleanupExpired();

    this.started = true;
    AgentNetwork.instance = this;

    console.log(`[AgentNetwork] Started on port ${actualPort}, agentId=${identity.agentId.slice(0, 8)}...`);
  }

  /**
   * 停止 Agent Network
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // 取消所有 pending 请求
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Network stopped'));
    }
    this.pendingRequests.clear();

    await this.discovery.stop();
    await this.transport.stop();
    this.auditLog.close();
    this.started = false;
    AgentNetwork.instance = null;
  }

  // ===== 公共 API =====

  get identity(): AgentIdentity {
    return this.identityManager.identity;
  }

  getStatus(): NetworkStatus {
    return {
      enabled: this.started,
      identity: this.started ? this.identityManager.identity : null,
      agents: this.discovery.getDiscoveredAgents(),
      groups: this.started ? this.auditLog.getGroups() : [],
      port: this.transport?.port || this.config?.port || 7860,
      addresses: this.getLanAddresses(),
    };
  }

  getDiscoveredAgents(): DiscoveredAgent[] {
    return this.discovery.getDiscoveredAgents();
  }

  getRouter(): AgentRouter {
    return this.router;
  }

  getAuditLog(filter?: { agentId?: string; taskId?: string; limit?: number; offset?: number }): AuditLogEntry[] {
    return this.auditLog.query(filter);
  }

  /**
   * 发送请求并等待响应
   */
  async sendRequest(agentId: string, method: string, params?: unknown, taskId?: string): Promise<unknown> {
    const conn = await this.ensureConnection(agentId);

    const msg = createRequest(
      method,
      params,
      this.identityManager.agentId,
      agentId,
      this.identityManager.agentPrivateKey,
      taskId,
    );

    // 记录审计
    const agentInfo = this.discovery.getAgent(agentId);
    this.auditLog.log({
      timestamp: Date.now(),
      direction: 'outbound',
      fromAgentId: this.identityManager.agentId,
      fromName: this.identityManager.identity.name,
      toAgentId: agentId,
      toName: agentInfo?.name || agentId.slice(0, 8),
      messageType: 'query',
      method,
      summary: `Request: ${method}`,
      success: true,
      taskId,
      payload: JSON.stringify(msg),
    });
    this.emit('message:sent', msg);

    // 发送并等待响应
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(msg.id!);
        reject(new Error(`Request ${method} to ${agentId.slice(0, 8)} timed out`));
      }, 30_000);

      this.pendingRequests.set(msg.id!, { resolve, reject, timeout });

      const sent = this.transport.sendTo(agentId, msg);
      if (!sent) {
        clearTimeout(timeout);
        this.pendingRequests.delete(msg.id!);
        // 离线消息队列
        this.auditLog.enqueueMessage(agentId, msg);
        reject(new Error(`Agent ${agentId.slice(0, 8)} is not connected, message queued`));
      }
    });
  }

  /**
   * 发送通知（无需响应）
   */
  sendNotification(agentId: string, method: string, params?: unknown, taskId?: string): boolean {
    const msg = createNotification(
      method,
      params,
      this.identityManager.agentId,
      agentId,
      this.identityManager.agentPrivateKey,
      taskId,
    );

    const agentInfo = this.discovery.getAgent(agentId);
    this.auditLog.log({
      timestamp: Date.now(),
      direction: 'outbound',
      fromAgentId: this.identityManager.agentId,
      fromName: this.identityManager.identity.name,
      toAgentId: agentId,
      toName: agentInfo?.name || agentId.slice(0, 8),
      messageType: 'notify',
      method,
      summary: `Notify: ${method}`,
      success: true,
      taskId,
    });

    const sent = this.transport.sendTo(agentId, msg);
    if (!sent) {
      this.auditLog.enqueueMessage(agentId, msg);
    }
    return sent;
  }

  /**
   * 广播通知给所有已连接的 Agent
   */
  broadcastNotification(method: string, params?: unknown): void {
    const msg = createNotification(
      method,
      params,
      this.identityManager.agentId,
      '*',
      this.identityManager.agentPrivateKey,
    );
    this.transport.broadcast(msg);
  }

  /**
   * 信任管理
   */
  trustAgent(agentId: string): void {
    const agent = this.discovery.getAgent(agentId);
    if (agent) {
      this.permissionManager.trustAgent(agentId, agent.name, agent.ownerFingerprint);
      this.discovery.updateAgent(agentId, { trustLevel: 'known' });
    }
  }

  untrustAgent(agentId: string): void {
    this.permissionManager.untrustAgent(agentId);
    this.discovery.updateAgent(agentId, { trustLevel: 'unknown' });
  }

  kickAgent(agentId: string): void {
    const conn = this.transport.getConnection(agentId);
    if (conn) conn.close();
    this.discovery.removeAgent(agentId);
  }

  /**
   * 手动连接 Agent（mDNS 发现不可靠时的备选方案）
   * 尝试 WebSocket 连接到指定 endpoint，握手成功后加入发现列表
   */
  async connectManually(endpoint: string): Promise<DiscoveredAgent> {
    const conn = await this.transport.connect(endpoint);
    if (!conn.identity) {
      throw new Error('Handshake failed: no identity received');
    }

    // 将连接信息加入发现列表
    const agent = this.discovery.addManual(
      endpoint,
      conn.identity.agentId,
      conn.identity.name,
    );

    // 用握手后获得的完整身份更新
    this.discovery.updateAgent(conn.identity.agentId, {
      trustLevel: conn.trustLevel,
      identity: conn.identity,
      online: true,
      lastSeenAt: Date.now(),
    });

    return this.discovery.getAgent(conn.identity.agentId) || agent;
  }

  // ===== 群组管理 =====

  createGroup(name: string, members: string[]): AgentGroup {
    return this.auditLog.createGroup(name, members);
  }

  getGroups(): AgentGroup[] {
    return this.auditLog.getGroups();
  }

  updateGroup(id: string, updates: { name?: string; members?: string[] }): void {
    this.auditLog.updateGroup(id, updates);
  }

  deleteGroup(id: string): void {
    this.auditLog.deleteGroup(id);
  }

  // ===== 委派任务管理 =====

  getActiveTasks(): DelegatedTask[] {
    return Array.from(this.activeTasks.values());
  }

  getTask(taskId: string): DelegatedTask | undefined {
    return this.activeTasks.get(taskId);
  }

  /**
   * 标记委派任务为执行中
   */
  markTaskRunning(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;
    task.status = 'running';
    this.sendNotification(task.fromAgentId, AgentMethod.Progress, {
      taskId,
      status: 'running',
      progress: 0,
    }, taskId);
  }

  /**
   * 上报任务进度
   */
  reportTaskProgress(taskId: string, progress: number, message?: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;
    this.sendNotification(task.fromAgentId, AgentMethod.Progress, {
      taskId,
      status: 'running',
      progress,
      message,
    }, taskId);
  }

  /**
   * 标记委派任务完成并通知委派方
   */
  completeTask(taskId: string, result: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;

    this.sendNotification(task.fromAgentId, AgentMethod.Progress, {
      taskId,
      status: 'completed',
      progress: 100,
      result,
    }, taskId);

    // 审计
    this.auditLog.log({
      timestamp: Date.now(),
      direction: 'outbound',
      fromAgentId: this.identityManager.agentId,
      fromName: this.identityManager.identity.name,
      toAgentId: task.fromAgentId,
      toName: task.fromName,
      messageType: 'task',
      method: 'task.completed',
      summary: `Task completed: ${task.description.slice(0, 80)}`,
      success: true,
      taskId,
    });

    this.emit('task:completed', task);
  }

  /**
   * 标记委派任务失败并通知委派方
   */
  failTask(taskId: string, error: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) return;

    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;

    this.sendNotification(task.fromAgentId, AgentMethod.Progress, {
      taskId,
      status: 'failed',
      error,
    }, taskId);

    // 审计
    this.auditLog.log({
      timestamp: Date.now(),
      direction: 'outbound',
      fromAgentId: this.identityManager.agentId,
      fromName: this.identityManager.identity.name,
      toAgentId: task.fromAgentId,
      toName: task.fromName,
      messageType: 'task',
      method: 'task.failed',
      summary: `Task failed: ${task.description.slice(0, 80)}`,
      success: false,
      error,
      taskId,
    });

    this.emit('task:failed', task);
  }

  // ===== 事件设置 =====

  private setupDiscoveryEvents(): void {
    this.discovery.on('found', (agent: DiscoveredAgent) => {
      this.emit('agent:found', agent);
      // 自动尝试连接
      this.tryConnect(agent);
    });

    this.discovery.on('lost', (agentId: string) => {
      this.emit('agent:lost', agentId);
    });

    this.discovery.on('updated', (agent: DiscoveredAgent) => {
      this.emit('agent:updated', agent);
    });
  }

  private setupTransportEvents(): void {
    this.transport.on('connection', (conn: AgentConnection) => {
      if (conn.identity) {
        // 更新发现列表中的信任等级
        this.discovery.updateAgent(conn.agentId, {
          trustLevel: conn.trustLevel,
          identity: conn.identity,
          online: true,
          lastSeenAt: Date.now(),
        });

        // 发送离线消息队列
        this.drainPendingMessages(conn.agentId);

        this.emit('agent:connected', conn.agentId);
      }
    });

    this.transport.on('message', (msg: AgentMessage, conn: AgentConnection) => {
      this.handleInboundMessage(msg, conn);
    });

    this.transport.on('disconnect', (agentId: string) => {
      this.discovery.updateAgent(agentId, { online: false });
      this.emit('agent:disconnected', agentId);
    });
  }

  // ===== 消息处理 =====

  private handleInboundMessage(msg: AgentMessage, conn: AgentConnection): void {
    // 验证签名（使用握手时缓存的 PEM 公钥，避免每条消息重建）
    if (conn.identity && conn.cachedPem) {
      if (!verifyMessage(msg, conn.cachedPem)) {
        console.warn(`[AgentNetwork] Invalid signature from ${conn.agentId.slice(0, 8)}`);
        return;
      }
    }

    if (isResponse(msg)) {
      // 处理响应
      this.handleResponse(msg, conn);
    } else if (isRequest(msg)) {
      // 处理请求
      this.handleRequest(msg, conn);
    } else if (isNotification(msg)) {
      // 处理通知
      this.handleNotificationMessage(msg, conn);
    }
  }

  private handleResponse(msg: AgentMessage, conn: AgentConnection): void {
    const pending = this.pendingRequests.get(msg.id!);
    if (!pending) return; // 无对应请求，忽略

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(msg.id!);

    // 校验：合法响应必须有 result 或 error
    const hasResult = msg.result !== undefined;
    const hasError = msg.error !== undefined;
    if (!hasResult && !hasError) {
      // 畸形响应 — 按错误处理而非静默 resolve(undefined)
      pending.reject(new Error('Malformed response: missing both result and error'));
      return;
    }

    // 审计
    this.auditLog.log({
      timestamp: Date.now(),
      direction: 'inbound',
      fromAgentId: conn.agentId,
      fromName: conn.identity?.name || conn.agentId.slice(0, 8),
      toAgentId: this.identityManager.agentId,
      toName: this.identityManager.identity.name,
      messageType: 'response',
      method: 'response',
      summary: hasError ? `Error: ${msg.error.message}` : 'Response received',
      success: !hasError,
      error: msg.error?.message,
      taskId: msg._meta.taskId,
    });

    if (hasError) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleRequest(msg: AgentMessage, conn: AgentConnection): void {
    const method = msg.method!;

    // 权限检查
    const permResult = this.permissionManager.checkPermission(conn.agentId, conn.trustLevel, method);

    // 审计
    const entry = this.auditLog.log({
      timestamp: Date.now(),
      direction: 'inbound',
      fromAgentId: conn.agentId,
      fromName: conn.identity?.name || conn.agentId.slice(0, 8),
      toAgentId: this.identityManager.agentId,
      toName: this.identityManager.identity.name,
      messageType: 'query',
      method,
      summary: `Request: ${method}`,
      success: permResult.allowed,
      error: permResult.reason,
      taskId: msg._meta.taskId,
      payload: JSON.stringify(msg),
    });

    this.emit('message', entry);

    if (!permResult.allowed) {
      // 发送权限拒绝
      const errorResp = createErrorResponse(
        msg.id!,
        AgentErrorCode.PermissionDenied,
        permResult.reason || 'Permission denied',
        this.identityManager.agentId,
        conn.agentId,
        this.identityManager.agentPrivateKey,
      );
      conn.send(errorResp);

      // 通知前端有未信任 Agent 的请求
      if (conn.trustLevel === 'unknown') {
        const agent = this.discovery.getAgent(conn.agentId);
        if (agent) {
          this.emit('trust_request', agent);
        }
      }
      return;
    }

    // 处理内置方法
    this.processRequest(method, msg, conn);
  }

  private handleNotificationMessage(msg: AgentMessage, conn: AgentConnection): void {
    const entry = this.auditLog.log({
      timestamp: Date.now(),
      direction: 'inbound',
      fromAgentId: conn.agentId,
      fromName: conn.identity?.name || conn.agentId.slice(0, 8),
      toAgentId: this.identityManager.agentId,
      toName: this.identityManager.identity.name,
      messageType: 'notify',
      method: msg.method || 'unknown',
      summary: `Notification: ${msg.method}`,
      success: true,
      taskId: msg._meta.taskId,
    });

    this.emit('message', entry);
  }

  /**
   * 处理内置方法请求
   */
  private async processRequest(method: string, msg: AgentMessage, conn: AgentConnection): Promise<void> {
    let result: unknown;

    switch (method) {
      case AgentMethod.Ping:
        result = { pong: true, timestamp: Date.now() };
        break;

      case AgentMethod.GetIdentity:
        result = this.identityManager.identity;
        break;

      case AgentMethod.ListTools:
        result = { tools: this.identityManager.identity.exposedTools };
        break;

      case AgentMethod.CallTool: {
        const { toolName, toolInput } = (msg.params as any) || {};
        if (!toolName) {
          result = { error: 'Missing toolName parameter' };
          break;
        }

        // 安全检查: 只允许调用 exposedTools 白名单中的工具
        const exposedTools = this.identityManager.identity.exposedTools;
        if (!exposedTools.includes(toolName)) {
          result = { error: `Tool "${toolName}" is not exposed. Available tools: ${exposedTools.join(', ')}` };

          // 审计记录被拒绝的工具调用
          this.auditLog.log({
            timestamp: Date.now(),
            direction: 'inbound',
            fromAgentId: conn.agentId,
            fromName: conn.identity?.name || conn.agentId.slice(0, 8),
            toAgentId: this.identityManager.agentId,
            toName: this.identityManager.identity.name,
            messageType: 'query',
            method: `${method}:${toolName}`,
            summary: `Blocked: tool "${toolName}" not in exposedTools whitelist`,
            success: false,
            error: `Tool not exposed`,
            taskId: msg._meta.taskId,
          });
          break;
        }

        // 安全禁令: 即使在白名单中，也绝不允许远程调用 Bash/Write/Edit
        const REMOTE_BLOCKED_TOOLS = ['Bash', 'Write', 'Edit', 'SelfEvolve'];
        if (REMOTE_BLOCKED_TOOLS.includes(toolName)) {
          result = { error: `Tool "${toolName}" is blocked for remote execution (security policy)` };
          break;
        }

        try {
          const { toolRegistry } = await import('../tools/base.js');
          const tool = toolRegistry.get(toolName);
          if (!tool) {
            result = { error: `Tool "${toolName}" not found in registry` };
            break;
          }
          const toolResult = await tool.execute(toolInput || {});
          result = { toolName, result: toolResult };
        } catch (err: any) {
          result = { error: `Tool execution failed: ${err.message}` };
        }
        break;
      }

      case AgentMethod.DelegateTask: {
        const { description, context, attachments } = (msg.params as any) || {};
        if (!description) {
          result = { error: 'Missing task description' };
          break;
        }

        const taskId = msg._meta.taskId || crypto.randomUUID();

        // 构建完整上下文
        let fullContext = `Task: ${description}`;
        if (context) fullContext += `\nContext: ${context}`;
        if (attachments && Array.isArray(attachments)) {
          for (const att of attachments) {
            if (att.type === 'file' && att.content) {
              fullContext += `\n\n--- ${att.filename || 'attachment'} ---\n${att.content}`;
            } else if (att.type === 'error' && att.content) {
              fullContext += `\n\nError log:\n${att.content}`;
            } else if (att.type === 'output' && att.content) {
              fullContext += `\n\nOutput:\n${att.content}`;
            }
          }
        }

        // 记录任务到活跃任务表
        this.activeTasks.set(taskId, {
          taskId,
          fromAgentId: conn.agentId,
          fromName: conn.identity?.name || conn.agentId.slice(0, 8),
          description,
          fullContext,
          status: 'accepted',
          createdAt: Date.now(),
        });

        // 发送进度通知: 已接受
        this.sendNotification(conn.agentId, AgentMethod.Progress, {
          taskId,
          status: 'accepted',
          description,
        }, taskId);

        // 发射事件让上层（Web Server）创建对话来执行任务
        // 上层监听 'task:delegated' 事件，创建新会话执行任务，完成后调用 completeTask()
        this.emit('task:delegated', {
          taskId,
          fromAgentId: conn.agentId,
          fromName: conn.identity?.name || conn.agentId.slice(0, 8),
          description,
          fullContext,
          attachments,
        });

        result = {
          taskId,
          status: 'accepted',
          message: 'Task accepted and queued for execution. Progress notifications will follow.',
        };
        break;
      }

      default:
        // 未知方法 → 转发给事件监听器
        this.emit('request', { method, params: msg.params, msg, conn });
        return;
    }

    const resp = createResponse(
      msg.id!,
      result,
      this.identityManager.agentId,
      conn.agentId,
      this.identityManager.agentPrivateKey,
      msg._meta.taskId,
    );
    conn.send(resp);
  }

  // ===== 辅助方法 =====

  /**
   * 确保与目标 Agent 的连接
   */
  private async ensureConnection(agentId: string): Promise<AgentConnection> {
    const existing = this.transport.getConnection(agentId);
    if (existing && existing.isAlive) return existing;

    // 从发现列表获取 endpoint
    const agent = this.discovery.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId.slice(0, 8)} not found`);
    }

    return this.transport.connect(agent.endpoint);
  }

  /**
   * 尝试连接发现的 Agent
   */
  private async tryConnect(agent: DiscoveredAgent): Promise<void> {
    try {
      await this.transport.connect(agent.endpoint);
    } catch (err) {
      console.warn(`[AgentNetwork] Failed to connect to ${agent.name} at ${agent.endpoint}:`, err instanceof Error ? err.message : err);
    }
  }

  /**
   * 发送离线消息队列
   */
  private drainPendingMessages(agentId: string): void {
    const pending = this.auditLog.getPendingMessages(agentId);
    for (const pm of pending) {
      const sent = this.transport.sendTo(agentId, pm.message);
      if (sent) {
        this.auditLog.removePendingMessage(pm.id);
      } else {
        this.auditLog.incrementRetry(pm.id);
      }
    }
  }

  /**
   * 获取本机所有 LAN IPv4 地址
   */
  private getLanAddresses(): string[] {
    const addresses: string[] = [];
    try {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      for (const [, addrs] of Object.entries(interfaces)) {
        if (!addrs) continue;
        for (const addr of addrs as any[]) {
          if (!addr.internal && addr.family === 'IPv4') {
            addresses.push(addr.address);
          }
        }
      }
    } catch {
      // ignore
    }
    return addresses;
  }

  /**
   * 获取本机最佳 LAN IP 地址
   * 优先选择常见的私有网段 (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
   * 如果没有找到，回退到 os.hostname()
   */
  private getLanIpAddress(): string {
    const addresses = this.getLanAddresses();
    if (addresses.length === 0) {
      const os = require('os');
      return os.hostname();
    }
    // 优先选择常见私有网段
    const preferred = addresses.find(a =>
      a.startsWith('192.168.') || a.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(a)
    );
    return preferred || addresses[0];
  }
}
