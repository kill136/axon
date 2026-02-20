/**
 * WebSocket 处理器
 * 处理实时双向通信
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { ConversationManager } from './conversation.js';
import { isSlashCommand, executeSlashCommand } from './slash-commands.js';
import { initializeSkills, getAllSkills, findSkill } from '../../tools/skill.js';
import { runWithCwd } from '../../core/cwd-context.js';
import { apiManager } from './api-manager.js';
import { authManager } from './auth-manager.js';
import { oauthManager } from './oauth-manager.js';
import { CheckpointManager } from './checkpoint-manager.js';
import type { ClientMessage, ServerMessage, Attachment, AgentDebugPayload } from '../shared/types.js';
import { changeLocale, getCurrentLocale } from '../../i18n/index.js';
import { configManager } from '../../config/index.js';
import { promptSnippetsManager, type PromptSnippetCreateInput, type PromptSnippetUpdateInput } from './prompt-snippets.js';
// 导入蓝图存储和执行管理器（用于 WebSocket 订阅）
import { blueprintStore, executionEventEmitter, executionManager, activeWorkers } from './routes/blueprint-api.js';
// v4.5: 导入 Worker 类型
import type { AutonomousWorkerExecutor } from '../../blueprint/autonomous-worker.js';
// v4.0: 导入 SQLite 日志存储
import { getSwarmLogDB, type WorkerLog, type WorkerStream } from './database/swarm-logs.js';
// v4.9: 导入共享 E2E Agent 注册表
import { registerE2EAgent, unregisterE2EAgent, getE2EAgent } from '../../blueprint/e2e-agent-registry.js';
// 终端管理器
import { TerminalManager } from './terminal-manager.js';
// Git 管理器
import { GitManager } from './git-manager.js';
// Git WebSocket 处理函数
import {
  handleGitGetStatus,
  handleGitGetLog,
  handleGitGetBranches,
  handleGitGetStashes,
  handleGitStage,
  handleGitUnstage,
  handleGitCommit,
  handleGitPush,
  handleGitPull,
  handleGitCheckout,
  handleGitCreateBranch,
  handleGitDeleteBranch,
  handleGitStashSave,
  handleGitStashPop,
  handleGitStashDrop,
  handleGitStashApply,
  handleGitGetDiff,
  handleGitSmartCommit,
  handleGitSmartReview,
  handleGitExplainCommit,
} from './websocket-git-handlers.js';

// ============================================================================
// 旧蓝图系统已被移除，以下是类型占位符和空函数
// 新架构使用 SmartPlanner，蜂群相关功能将在 /api/blueprint/planning 中实现
// ============================================================================

// 类型占位符（用于保持代码兼容性）
interface WorkerAgent {
  id: string;
  taskId?: string;
  status: string;
  queenId?: string;
  tddCycle?: any;
  history?: any[];
}

interface QueenAgent {
  id: string;
  blueprintId: string;
  taskTreeId: string;
  status: string;
}

interface TimelineEvent {
  id: string;
  type: string;
  timestamp: Date;
  message: string;
  description?: string;
  data?: any;
}

interface TaskNode {
  id: string;
  name: string;
  description: string;
  status: string;
  dependencies: string[];
  children?: TaskNode[];
  agentId?: string;
  codeArtifacts?: any[];
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
}

// 空的事件发射器占位符
const createEmptyEventEmitter = () => ({
  on: (_event: string, _handler: (...args: any[]) => void) => {},
  emit: (_event: string, ..._args: any[]) => {},
  off: (_event: string, _handler: (...args: any[]) => void) => {},
});

// 空的管理器占位符（旧蓝图系统已移除）
const agentCoordinator = {
  ...createEmptyEventEmitter(),
  getQueen: (): QueenAgent | null => null,
  getWorkers: (): WorkerAgent[] => [],
  getWorker: (_id: string): WorkerAgent | null => null,
  getTimeline: (): TimelineEvent[] => [],
  startMainLoop: () => {},
  stopMainLoop: () => {},
  workerFailTask: (_workerId: string, _reason: string) => {},
};

const blueprintManager = {
  ...createEmptyEventEmitter(),
  // 使用真正的 blueprintStore 获取蓝图
  getBlueprint: (id: string): any => blueprintStore.get(id),
  saveBlueprint: (blueprint: any) => blueprintStore.save(blueprint),
};

const taskTreeManager = {
  ...createEmptyEventEmitter(),
  getTaskTree: (_id: string): any => null,
  findTask: (_root: any, _taskId: string): TaskNode | null => null,
  generateFromBlueprint: (_blueprint: any): any => null,
  markAllTasksAsPassed: (_taskTree: any) => {},
};

// 持续开发编排器占位符（旧系统已移除）
interface ContinuousDevOrchestrator {
  on: (event: string, handler: (...args: any[]) => void) => void;
  getState: () => { phase: string; message?: string };
  getProgress: () => any;
  pause: () => void;
  resume: () => void;
  processRequirement: (requirement: string) => Promise<{ success: boolean; error?: string }>;
  approveAndExecute: () => Promise<void>;
}

const createContinuousDevOrchestrator = (_config: any): ContinuousDevOrchestrator => ({
  on: () => {},
  getState: () => ({ phase: 'idle', message: '持续开发功能已迁移到新架构' }),
  getProgress: () => ({ percentage: 0 }),
  pause: () => {},
  resume: () => {},
  processRequirement: async () => ({ success: false, error: '功能已迁移到新的 SmartPlanner 架构' }),
  approveAndExecute: async () => {},
});

// 持续开发编排器实例管理：sessionId -> Orchestrator
const orchestrators = new Map<string, ContinuousDevOrchestrator>();

// v4.9: E2E Agent 注册已迁移到共享模块 e2e-agent-registry.ts
// 通过 registerE2EAgent/unregisterE2EAgent/getE2EAgent 访问

// v4.8: E2E 测试状态存储，用于刷新浏览器后恢复上下文
// blueprintId -> { status, message, e2eTaskId, result? }
interface E2ETestState {
  status: string;
  message?: string;
  e2eTaskId: string;
  result?: any;
}
const activeE2EState = new Map<string, E2ETestState>();

// v9.2: LeadAgent 状态存储，用于刷新浏览器后恢复上下文
// blueprintId -> { phase, stream, events, systemPrompt, lastUpdated }
interface LeadAgentPersistState {
  phase: string;
  stream: Array<
    | { type: 'text'; text: string }
    | { type: 'tool'; id: string; name: string; input?: any; result?: string; error?: string; status: 'running' | 'completed' | 'error' }
  >;
  events: Array<{ type: string; data: Record<string, unknown>; timestamp: string }>;
  systemPrompt?: string;
  lastUpdated: string;
}
const activeLeadAgentState = new Map<string, LeadAgentPersistState>();

interface ClientConnection {
  id: string;
  ws: WebSocket;
  sessionId: string;
  model: string;
  isAlive: boolean;
  swarmSubscriptions: Set<string>; // 订阅的 blueprint IDs
  projectPath?: string; // 当前选择的项目路径
  permissionMode?: string; // 客户端级别的权限模式（跨会话持久化）
}

// 全局检查点管理器实例（惰性初始化，避免模块加载时的副作用日志）
let _checkpointManager: CheckpointManager | null = null;
function getCheckpointManager(): CheckpointManager {
  if (!_checkpointManager) {
    _checkpointManager = new CheckpointManager();
  }
  return _checkpointManager;
}

// 全局终端管理器实例
const terminalManager = new TerminalManager();
// 客户端终端映射：clientId -> Set of terminalIds
const clientTerminals = new Map<string, Set<string>>();

// 全局 WebSocket 客户端连接池（用于跨模块广播消息）
const wsClients = new Map<string, ClientConnection>();

/**
 * 广播消息给所有连接的 WebSocket 客户端
 * 用于从 Bash 工具等模块向前端推送实时消息
 */
export function broadcastMessage(message: any): void {
  const messageStr = JSON.stringify(message);
  wsClients.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

export function setupWebSocket(
  wss: WebSocketServer,
  conversationManager: ConversationManager
): void {
  const clients = wsClients; // 使用全局 Map

  // 订阅管理：blueprintId -> Set of client IDs
  const swarmSubscriptions = new Map<string, Set<string>>();

  // 心跳检测
  const heartbeatInterval = setInterval(() => {
    clients.forEach((client, id) => {
      if (!client.isAlive) {
        client.ws.terminate();
        clients.delete(id);
        // 清理订阅
        cleanupClientSubscriptions(id);
        return;
      }
      client.isAlive = false;
      client.ws.ping();
    });
  }, 30000);

  // 清理客户端订阅
  const cleanupClientSubscriptions = (clientId: string) => {
    swarmSubscriptions.forEach((subscribers, blueprintId) => {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        swarmSubscriptions.delete(blueprintId);
      }
    });
  };

  // v5.0: thinking/text 流式内容聚合缓冲区（避免碎片化存储到 SQLite）
  // key: `${workerId}:${taskId}`, value: 聚合的内容
  const streamBuffers = new Map<string, {
    type: 'thinking' | 'text';
    content: string;
    timestamp: string;
    blueprintId: string;
    taskId: string;
    workerId: string;
  }>();

  // 刷新指定任务的缓冲区到 SQLite（任务完成时调用）
  const flushStreamBuffer = (workerId: string, taskId: string) => {
    const bufferKey = `${workerId}:${taskId}`;
    const buffer = streamBuffers.get(bufferKey);
    if (buffer && buffer.content.trim()) {
      (async () => {
        try {
          const logDB = await getSwarmLogDB();
          logDB.insertStream({
            id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            blueprintId: buffer.blueprintId,
            taskId: buffer.taskId,
            workerId: buffer.workerId,
            timestamp: buffer.timestamp,
            streamType: buffer.type,
            content: buffer.content,
          });
        } catch (err) {
          console.error('[SwarmLogDB] 刷新缓冲区失败:', err);
        }
      })();
    }
    streamBuffers.delete(bufferKey);
  };

  // 广播消息给订阅了特定 blueprint 的客户端
  const broadcastToSubscribers = (blueprintId: string, message: any) => {
    const subscribers = swarmSubscriptions.get(blueprintId);
    if (!subscribers || subscribers.size === 0) return;

    const messageStr = JSON.stringify(message);
    subscribers.forEach(clientId => {
      const client = clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    });
  };

  // ============================================================================
  // 监听 AgentCoordinator 事件
  // ============================================================================

  // Queen 初始化
  agentCoordinator.on('queen:initialized', (queen: QueenAgent) => {
    console.log(`[Swarm] Queen initialized: ${queen.id} for blueprint ${queen.blueprintId}`);

    const blueprint = blueprintManager.getBlueprint(queen.blueprintId);
    const taskTree = taskTreeManager.getTaskTree(queen.taskTreeId);

    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:state',
      payload: {
        blueprint: blueprint ? serializeBlueprint(blueprint) : null,
        taskTree: taskTree ? serializeTaskTree(taskTree) : null,
        queen: serializeQueen(queen),
        workers: [],
        timeline: agentCoordinator.getTimeline().map(serializeTimelineEvent),
        stats: taskTree?.stats || null,
      },
    });
  });

  // Worker 创建
  agentCoordinator.on('worker:created', (worker: WorkerAgent) => {
    console.log(`[Swarm] Worker created: ${worker.id}`);

    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: worker.id,
        updates: serializeWorker(worker),
      },
    });
  });

  // Worker 状态更新（TDD 各阶段状态变化）
  agentCoordinator.on('worker:status-updated', ({ worker }: { worker: WorkerAgent }) => {
    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: worker.id,
        updates: serializeWorker(worker),
      },
    });
  });

  // Worker 任务完成
  agentCoordinator.on('worker:task-completed', ({ workerId, taskId }: { workerId: string; taskId: string }) => {
    console.log(`[Swarm] Worker ${workerId} completed task ${taskId}`);

    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    const worker = agentCoordinator.getWorker(workerId);
    if (!worker) return;

    // 发送 Worker 更新
    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: worker.id,
        updates: serializeWorker(worker),
      },
    });

    // 发送任务更新
    const taskTree = taskTreeManager.getTaskTree(queen.taskTreeId);
    if (taskTree) {
      const task = taskTreeManager.findTask(taskTree.root, taskId);
      if (task) {
        // 发送通用任务更新
        broadcastToSubscribers(queen.blueprintId, {
          type: 'swarm:task_update',
          payload: {
            taskId: task.id,
            updates: serializeTaskNode(task),
          },
        });

        // 发送任务完成通知
        broadcastToSubscribers(queen.blueprintId, {
          type: 'swarm:task_completed',
          payload: {
            taskId: task.id,
            taskTitle: task.name,
            workerId: workerId,
            status: 'passed' as const,
            result: task.description,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  });

  // Worker 任务失败
  agentCoordinator.on('worker:task-failed', ({ workerId, taskId, error }: { workerId: string; taskId: string; error: string }) => {
    console.log(`[Swarm] Worker ${workerId} failed task ${taskId}: ${error}`);

    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    const worker = agentCoordinator.getWorker(workerId);
    if (!worker) return;

    // 发送 Worker 更新
    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: worker.id,
        updates: serializeWorker(worker),
      },
    });

    // 发送任务更新
    const taskTree = taskTreeManager.getTaskTree(queen.taskTreeId);
    if (taskTree) {
      const task = taskTreeManager.findTask(taskTree.root, taskId);
      if (task) {
        // 发送通用任务更新
        broadcastToSubscribers(queen.blueprintId, {
          type: 'swarm:task_update',
          payload: {
            taskId: task.id,
            updates: serializeTaskNode(task),
          },
        });

        // 发送任务失败通知
        broadcastToSubscribers(queen.blueprintId, {
          type: 'swarm:task_completed',
          payload: {
            taskId: task.id,
            taskTitle: task.name,
            workerId: workerId,
            status: 'failed' as const,
            error: error,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }
  });

  // 时间线事件
  agentCoordinator.on('timeline:event', (event: TimelineEvent) => {
    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:timeline_event',
      payload: serializeTimelineEvent(event),
    });
  });

  // ============================================================================
  // 监听 TaskTreeManager 事件 - 任务状态实时更新
  // ============================================================================

  // 任务状态变更 - 这是关键！确保中间状态（coding、testing等）也能实时推送到前端
  taskTreeManager.on('task:status-changed', (data: {
    treeId: string;
    taskId: string;
    previousStatus: string;
    newStatus: string;
    task: TaskNode;
  }) => {
    console.log(`[Swarm] Task status changed: ${data.taskId} ${data.previousStatus} -> ${data.newStatus}`);

    const queen = agentCoordinator.getQueen();
    if (!queen || queen.taskTreeId !== data.treeId) return;

    // 发送任务更新
    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:task_update',
      payload: {
        taskId: data.taskId,
        updates: serializeTaskNode(data.task),
      },
    });

    // 同时更新统计信息
    const taskTree = taskTreeManager.getTaskTree(data.treeId);
    if (taskTree) {
      broadcastToSubscribers(queen.blueprintId, {
        type: 'swarm:stats_update',
        payload: {
          stats: {
            totalTasks: taskTree.stats.totalTasks,
            pendingTasks: taskTree.stats.pendingTasks,
            runningTasks: taskTree.stats.runningTasks,
            passedTasks: taskTree.stats.passedTasks,
            failedTasks: taskTree.stats.failedTasks,
            blockedTasks: taskTree.stats.blockedTasks || 0,
            progressPercentage: taskTree.stats.progressPercentage,
          },
        },
      });
    }
  });

  // 执行完成
  agentCoordinator.on('execution:completed', () => {
    console.log('[Swarm] Execution completed');

    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    const taskTree = taskTreeManager.getTaskTree(queen.taskTreeId);

    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:completed',
      payload: {
        blueprintId: queen.blueprintId,
        stats: taskTree?.stats || {
          totalTasks: 0,
          pendingTasks: 0,
          runningTasks: 0,
          passedTasks: 0,
          failedTasks: 0,
          blockedTasks: 0,
          progressPercentage: 0,
        },
        completedAt: new Date().toISOString(),
      },
    });
  });

  // Queen 错误
  agentCoordinator.on('queen:error', ({ error }: { error: any }) => {
    console.error('[Swarm] Queen error:', error);

    const queen = agentCoordinator.getQueen();
    if (!queen) return;

    // 更新蓝图状态为失败
    const blueprint = blueprintManager.getBlueprint(queen.blueprintId);
    if (blueprint) {
      blueprint.status = 'failed';
      blueprintManager.saveBlueprint(blueprint);
      console.log(`[Swarm] Blueprint ${queen.blueprintId} status updated to 'failed'`);
    }

    broadcastToSubscribers(queen.blueprintId, {
      type: 'swarm:error',
      payload: {
        blueprintId: queen.blueprintId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ============================================================================
  // 监听 BlueprintManager 事件
  // ============================================================================

  // 广播给所有客户端
  const broadcastToAllClients = (message: any) => {
    const messageStr = JSON.stringify(message);
    clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    });
  };

  // 蓝图创建
  blueprintManager.on('blueprint:created', (blueprint) => {
    console.log(`[Blueprint] Created: ${blueprint.id}`);
    broadcastToAllClients({
      type: 'blueprint:created',
      payload: {
        blueprint: serializeBlueprint(blueprint),
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图更新
  blueprintManager.on('blueprint:updated', (blueprint) => {
    console.log(`[Blueprint] Updated: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:updated',
      payload: {
        blueprintId: blueprint.id,
        blueprint: serializeBlueprint(blueprint),
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图提交审核
  blueprintManager.on('blueprint:submitted', (blueprint) => {
    console.log(`[Blueprint] Submitted for review: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:status_changed',
      payload: {
        blueprintId: blueprint.id,
        oldStatus: 'draft',
        newStatus: 'review',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图批准
  blueprintManager.on('blueprint:approved', (blueprint) => {
    console.log(`[Blueprint] Approved: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:status_changed',
      payload: {
        blueprintId: blueprint.id,
        oldStatus: 'review',
        newStatus: 'approved',
        approvedBy: blueprint.approvedBy,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图拒绝
  blueprintManager.on('blueprint:rejected', (blueprint, reason) => {
    console.log(`[Blueprint] Rejected: ${blueprint.id}, reason: ${reason}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:rejected',
      payload: {
        blueprintId: blueprint.id,
        reason: reason || 'No reason provided',
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图开始执行
  blueprintManager.on('blueprint:execution-started', (blueprint) => {
    console.log(`[Blueprint] Execution started: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:execution_started',
      payload: {
        blueprintId: blueprint.id,
        taskTreeId: blueprint.taskTreeId,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图暂停
  blueprintManager.on('blueprint:paused', (blueprint) => {
    console.log(`[Blueprint] Paused: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:paused',
      payload: {
        blueprintId: blueprint.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图恢复
  blueprintManager.on('blueprint:resumed', (blueprint) => {
    console.log(`[Blueprint] Resumed: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:resumed',
      payload: {
        blueprintId: blueprint.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图完成
  blueprintManager.on('blueprint:completed', (blueprint) => {
    console.log(`[Blueprint] Completed: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:completed',
      payload: {
        blueprintId: blueprint.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图修改（执行期间）
  blueprintManager.on('blueprint:modified', (blueprint, modifications) => {
    console.log(`[Blueprint] Modified during execution: ${blueprint.id}`);
    broadcastToSubscribers(blueprint.id, {
      type: 'blueprint:modified',
      payload: {
        blueprintId: blueprint.id,
        modifications,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // 蓝图删除
  blueprintManager.on('blueprint:deleted', (blueprintId) => {
    console.log(`[Blueprint] Deleted: ${blueprintId}`);
    broadcastToAllClients({
      type: 'blueprint:deleted',
      payload: {
        blueprintId,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ============================================================================
  // 监听 RealtimeCoordinator 执行事件 (v2.0 新架构)
  // ============================================================================

  // Worker 状态更新
  executionEventEmitter.on('worker:update', (data: { blueprintId: string; workerId: string; updates: any }) => {
    console.log(`[Swarm v2.0] Worker update: ${data.workerId} for blueprint ${data.blueprintId}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: data.workerId,
        updates: data.updates,
      },
    });
  });

  // 任务状态更新（含 v9.0 动态新增任务支持）
  executionEventEmitter.on('task:update', (data: { blueprintId: string; taskId: string; updates: any; action?: string; task?: any }) => {
    const errorInfo = data.updates?.error ? ` error="${data.updates.error}"` : '';
    const actionInfo = data.action === 'add' ? ' [NEW]' : '';
    console.log(`[Swarm v2.0] Task update${actionInfo}: ${data.taskId} status=${data.updates?.status}${errorInfo}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:task_update',
      payload: {
        taskId: data.taskId,
        updates: data.updates,
        // v9.0: 动态新增任务时携带完整任务数据
        ...(data.action === 'add' ? { action: 'add', task: data.task } : {}),
      },
    });
  });

  // 🔧 任务进入代码审查状态
  executionEventEmitter.on('task:reviewing', (data: { blueprintId: string; taskId: string }) => {
    console.log(`[Swarm v2.0] Task reviewing: ${data.taskId}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:task_update',
      payload: {
        taskId: data.taskId,
        updates: { status: 'reviewing' },
      },
    });
  });

  // 统计信息更新
  executionEventEmitter.on('stats:update', (data: { blueprintId: string; stats: any }) => {
    console.log(`[Swarm v2.0] Stats update: ${data.stats.completedTasks}/${data.stats.totalTasks} completed`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:stats_update',
      payload: {
        stats: data.stats,
      },
    });
  });

  // v5.0: 蜂群共享记忆更新
  executionEventEmitter.on('swarm:memory_update', (data: { blueprintId: string; swarmMemory: any }) => {
    console.log(`[Swarm v5.0] Memory update: ${data.swarmMemory?.completedTasks?.length || 0} completed tasks, ${data.swarmMemory?.apis?.length || 0} APIs`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:memory_update',
      payload: {
        blueprintId: data.blueprintId,
        swarmMemory: data.swarmMemory,
      },
    });
  });

  // 执行失败
  executionEventEmitter.on('execution:failed', (data: { blueprintId: string; error: string; groupIndex?: number; failedCount?: number }) => {
    console.error(`[Swarm v2.0] Execution failed: ${data.error}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:error',
      payload: {
        error: data.error,
        groupIndex: data.groupIndex,
        failedCount: data.failedCount,
      },
    });
  });

  // 通用蜂群事件
  executionEventEmitter.on('swarm:event', (data: { blueprintId: string; event: any }) => {
    console.log(`[Swarm v2.0] Event: ${data.event.type}`);
    // 根据事件类型转发
    if (data.event.type === 'plan:resumed') {
      // 恢复执行：发送 swarm:resumed 事件，不清空前端的任务树状态
      console.log(`[Swarm v9.1] Plan resumed: ${data.event.data.completedTasks}/${data.event.data.totalTasks} tasks completed`);
      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:resumed',
        payload: {
          blueprintId: data.blueprintId,
          totalTasks: data.event.data.totalTasks,
          completedTasks: data.event.data.completedTasks,
          isResume: true,
        },
      });
    } else if (data.event.type === 'plan:started') {
      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:state',
        payload: {
          blueprint: blueprintManager.getBlueprint(data.blueprintId),
          workers: [],
          stats: {
            totalTasks: data.event.data.totalTasks || 0,
            pendingTasks: data.event.data.totalTasks || 0,
            runningTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            progressPercentage: 0,
          },
        },
      });
    } else if (data.event.type === 'plan:completed') {
      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:completed',
        payload: {
          success: data.event.data.success,
          totalCost: data.event.data.totalCost,
        },
      });
    } else if (data.event.type === 'conflict:needs_human') {
      // 🐝 冲突需要人工干预
      console.log(`[Swarm v2.0] Conflict needs human intervention: ${data.event.data.conflict?.id}`);
      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:conflict',
        payload: {
          action: 'needs_human',
          conflict: data.event.data.conflict,
        },
      });
    } else if (data.event.type === 'conflict:resolved') {
      // 🐝 冲突已解决
      console.log(`[Swarm v2.0] Conflict resolved: ${data.event.data.conflictId}`);
      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:conflict',
        payload: {
          action: 'resolved',
          conflictId: data.event.data.conflictId,
          decision: data.event.data.decision,
        },
      });
    }
  });

  // ============================================================================
  // v9.0: LeadAgent System Prompt 事件（供前端查看提示词）
  // ============================================================================

  executionEventEmitter.on('lead:system_prompt', (data: {
    blueprintId: string;
    systemPrompt: string;
  }) => {
    // v9.2: 持久化 systemPrompt
    const existingState = activeLeadAgentState.get(data.blueprintId);
    if (existingState) {
      existingState.systemPrompt = data.systemPrompt;
    } else {
      activeLeadAgentState.set(data.blueprintId, {
        phase: 'idle',
        stream: [],
        events: [],
        systemPrompt: data.systemPrompt,
        lastUpdated: new Date().toISOString(),
      });
    }

    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:lead_system_prompt',
      payload: {
        systemPrompt: data.systemPrompt,
      },
    });
  });

  // ============================================================================
  // v9.0: LeadAgent 流式输出事件
  // ============================================================================

  executionEventEmitter.on('lead:stream', (data: {
    blueprintId: string;
    streamType: 'text' | 'tool_start' | 'tool_end';
    content?: string;
    toolName?: string;
    toolInput?: any;
    toolResult?: string;
    toolError?: string;
  }) => {
    // v9.2: 持久化 stream blocks（复用前端相同逻辑）
    let leadState = activeLeadAgentState.get(data.blueprintId);
    if (!leadState) {
      leadState = { phase: 'idle', stream: [], events: [], lastUpdated: new Date().toISOString() };
      activeLeadAgentState.set(data.blueprintId, leadState);
    }
    switch (data.streamType) {
      case 'text':
        if (data.content) {
          const last = leadState.stream[leadState.stream.length - 1];
          if (last?.type === 'text') {
            last.text += data.content;
          } else {
            leadState.stream.push({ type: 'text', text: data.content });
          }
        }
        break;
      case 'tool_start': {
        let found = false;
        for (let i = leadState.stream.length - 1; i >= 0; i--) {
          const block = leadState.stream[i];
          if (block.type === 'tool' && block.status === 'running' && block.name === data.toolName) {
            if (data.toolInput !== undefined) {
              (block as any).input = data.toolInput;
            }
            found = true;
            break;
          }
        }
        if (!found) {
          leadState.stream.push({
            type: 'tool',
            id: `lead-tool-${Date.now()}`,
            name: data.toolName || 'unknown',
            input: data.toolInput,
            status: 'running',
          });
        }
        break;
      }
      case 'tool_end':
        for (let i = leadState.stream.length - 1; i >= 0; i--) {
          const block = leadState.stream[i];
          if (block.type === 'tool' && block.status === 'running' && block.name === data.toolName) {
            (block as any).input = data.toolInput ?? (block as any).input;
            (block as any).status = data.toolError ? 'error' : 'completed';
            (block as any).result = data.toolResult;
            (block as any).error = data.toolError;
            break;
          }
        }
        break;
    }
    // 限制 stream 数量，与前端保持一致
    if (leadState.stream.length > 200) {
      leadState.stream = leadState.stream.slice(-200);
    }
    leadState.lastUpdated = new Date().toISOString();

    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:lead_stream',
      payload: {
        streamType: data.streamType,
        content: data.content,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolResult: data.toolResult,
        toolError: data.toolError,
      },
    });
  });

  // ============================================================================
  // v9.0: LeadAgent 阶段事件
  // ============================================================================

  executionEventEmitter.on('lead:event', (data: {
    blueprintId: string;
    eventType: string;
    data: Record<string, unknown>;
    timestamp: string;
  }) => {
    console.log(`[Swarm v9.0] LeadAgent event: ${data.eventType}`);

    // v9.2: 持久化 LeadAgent 阶段事件（复用前端相同的 phase 映射逻辑）
    let leadState = activeLeadAgentState.get(data.blueprintId);
    if (!leadState) {
      leadState = { phase: 'idle', stream: [], events: [], lastUpdated: new Date().toISOString() };
      activeLeadAgentState.set(data.blueprintId, leadState);
    }
    switch (data.eventType) {
      case 'lead:started': leadState.phase = 'started'; break;
      case 'lead:exploring': leadState.phase = 'exploring'; break;
      case 'lead:planning': leadState.phase = 'planning'; break;
      case 'lead:executing':
      case 'lead:dispatch': leadState.phase = 'executing'; break;
      case 'lead:reviewing': leadState.phase = 'reviewing'; break;
      case 'lead:completed': {
        const completedData = data.data as any;
        if (completedData?.pendingTasks > 0) {
          // v9.3: 有未完成任务时保持执行状态，不标记为已完成
          leadState.phase = 'executing';
        } else {
          leadState.phase = completedData?.success === false ? 'failed' : 'completed';
        }
        break;
      }
    }
    leadState.events.push({
      type: data.eventType,
      data: data.data,
      timestamp: data.timestamp,
    });
    if (leadState.events.length > 100) {
      leadState.events = leadState.events.slice(-100);
    }
    leadState.lastUpdated = data.timestamp || new Date().toISOString();

    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:lead_event',
      payload: {
        eventType: data.eventType,
        data: data.data,
        timestamp: data.timestamp,
      },
    });
  });

  // ============================================================================
  // v9.1: LeadAgent E2E 完成事件 → 通知 Planner Agent（聊天 Tab）
  // ============================================================================

  executionEventEmitter.on('lead:e2e_completed', (data: {
    blueprintId: string;
    success: boolean;
    summary: string;
  }) => {
    console.log(`[Swarm v9.1] LeadAgent E2E completed: ${data.success ? 'PASSED' : 'FAILED'}`);

    // 1. 通知蜂群订阅者（SwarmConsole）
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:lead_event',
      payload: {
        eventType: 'lead:e2e_completed',
        data: {
          success: data.success,
          summary: data.summary,
        },
        timestamp: new Date().toISOString(),
      },
    });

    // 2. 通知所有聊天 Tab（Planner Agent）— 双向通信闭环
    broadcastToAllClients({
      type: 'execution:report',
      payload: {
        blueprintId: data.blueprintId,
        status: data.success ? 'completed' : 'e2e_failed',
        summary: data.summary,
        message: data.success
          ? `项目执行完成，E2E 端到端测试全部通过。\n\n${data.summary}`
          : `项目开发任务已完成，但 E2E 测试存在失败。LeadAgent 正在处理...\n\n${data.summary}`,
        timestamp: new Date().toISOString(),
      },
    });
  });

  // ============================================================================
  // v2.0 新增：Planner 探索事件（Agent 模式探索代码库）
  // ============================================================================

  // 规划器开始探索代码库
  executionEventEmitter.on('planner:exploring', (data: { blueprintId: string; requirements: string[] }) => {
    console.log(`[Swarm v2.0] Planner exploring codebase for blueprint ${data.blueprintId}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:planner_update',
      payload: {
        phase: 'exploring',
        message: '正在探索代码库结构...',
        requirements: data.requirements,
      },
    });
  });

  // 规划器探索完成
  executionEventEmitter.on('planner:explored', (data: { blueprintId: string; exploration: any }) => {
    // CodebaseExploration 类型使用 discoveredModules，不是 relevantFiles
    const moduleCount = data.exploration?.discoveredModules?.length || 0;
    console.log(`[Swarm v2.0] Planner explored codebase: found ${moduleCount} modules`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:planner_update',
      payload: {
        phase: 'explored',
        message: `代码库探索完成，发现 ${moduleCount} 个模块`,
        exploration: data.exploration,
      },
    });
  });

  // 规划器开始分解任务
  executionEventEmitter.on('planner:decomposing', (data: { blueprintId: string }) => {
    console.log(`[Swarm v2.0] Planner decomposing tasks for blueprint ${data.blueprintId}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:planner_update',
      payload: {
        phase: 'decomposing',
        message: '正在分解任务...',
      },
    });
  });

  // ============================================================================
  // v2.0 新增：Worker 分析事件（策略决策前的 Agent 模式分析）
  // ============================================================================

  // Worker 开始分析目标文件
  executionEventEmitter.on('worker:analyzing', (data: { blueprintId: string; workerId: string; task: any }) => {
    console.log(`[Swarm v2.0] Worker ${data.workerId} analyzing files for task ${data.task?.name || data.task?.id}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: data.workerId,
        updates: {
          currentAction: {
            type: 'analyze',
            description: `分析目标文件: ${data.task?.files?.slice(0, 2).join(', ') || '未知'}${data.task?.files?.length > 2 ? '...' : ''}`,
            startedAt: new Date().toISOString(),
          },
        },
      },
    });
  });

  // Worker 分析完成
  executionEventEmitter.on('worker:analyzed', (data: { blueprintId: string; workerId: string; task: any; analysis: any }) => {
    // FileAnalysis 接口: targetFiles, fileSummaries, dependencies, suggestions, observations
    const filesAnalyzed = data.analysis?.fileSummaries?.length || data.analysis?.targetFiles?.length || 0;
    console.log(`[Swarm v2.0] Worker ${data.workerId} analyzed ${filesAnalyzed} files`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: data.workerId,
        updates: {
          currentAction: {
            type: 'think',
            description: '基于分析结果决策执行策略...',
            startedAt: new Date().toISOString(),
          },
          // 分析结果摘要
          lastAnalysis: {
            filesAnalyzed,
            suggestions: data.analysis?.suggestions || [],
            observations: data.analysis?.observations || [],
          },
        },
      },
    });
  });

  // Worker 策略决策完成
  executionEventEmitter.on('worker:strategy_decided', (data: { blueprintId: string; workerId: string; strategy: any }) => {
    // ExecutionStrategy 接口: shouldWriteTests, testReason, steps, estimatedMinutes, model
    const shouldWriteTests = data.strategy?.shouldWriteTests ?? false;
    const testReason = data.strategy?.testReason || '未指定';
    const steps = data.strategy?.steps || [];
    console.log(`[Swarm v2.0] Worker ${data.workerId} decided strategy: shouldWriteTests=${shouldWriteTests}, steps=${steps.length}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:worker_update',
      payload: {
        workerId: data.workerId,
        updates: {
          decisions: [{
            type: 'strategy',
            description: `测试: ${shouldWriteTests ? '需要' : '跳过'} (${testReason}), 步骤数: ${steps.length}`,
            timestamp: new Date().toISOString(),
          }],
        },
      },
    });
  });

  // ============================================================================
  // v2.1 新增：Worker 日志事件（实时推送执行日志到前端）
  // ============================================================================

  executionEventEmitter.on('worker:log', (data: {
    blueprintId: string;
    workerId: string;
    taskId?: string;
    log: {
      id: string;
      timestamp: string;
      level: 'info' | 'warn' | 'error' | 'debug';
      type: 'tool' | 'decision' | 'status' | 'output' | 'error';
      message: string;
      details?: any;
    };
  }) => {
    console.log(`[Swarm v2.1] Worker log: ${data.workerId} - ${data.log.message.slice(0, 50)}`);

    // v4.0: 存储到 SQLite
    if (data.taskId) {
      (async () => {
        try {
          const logDB = await getSwarmLogDB();
          logDB.insertLog({
            id: data.log.id,
            blueprintId: data.blueprintId,
            taskId: data.taskId,
            workerId: data.workerId,
            timestamp: data.log.timestamp,
            level: data.log.level,
            type: data.log.type,
            message: data.log.message,
            details: data.log.details,
          });
        } catch (err) {
          console.error('[SwarmLogDB] 存储日志失败:', err);
        }
      })();
    }

    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:worker_log',
      payload: {
        workerId: data.workerId,
        taskId: data.taskId,
        log: data.log,
      },
    });
  });

  // ============================================================================
  // v4.2 新增：Worker AskUserQuestion 请求事件
  // ============================================================================

  executionEventEmitter.on('worker:ask_request', (data: {
    blueprintId: string;
    workerId: string;
    taskId: string;
    requestId: string;
    questions: any[];
  }) => {
    console.log(`[Swarm v4.2] Worker ${data.workerId} AskUserQuestion request: ${data.requestId}`);

    // 广播给订阅的客户端
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:ask_user',
      payload: {
        requestId: data.requestId,
        questions: data.questions,
        workerId: data.workerId,
        taskId: data.taskId,
      },
    });
  });

  // ============================================================================
  // v2.1 新增：Worker 流式输出事件（实时推送 Claude 的思考和输出）
  // ============================================================================

  executionEventEmitter.on('worker:stream', (data: {
    blueprintId: string;
    workerId: string;
    taskId?: string;
    streamType: 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'system_prompt';
    content?: string;
    toolName?: string;
    toolInput?: any;
    toolResult?: string;
    toolError?: string;
    // v4.6: System Prompt 透明展示
    systemPrompt?: string;
    agentType?: 'worker' | 'e2e' | 'reviewer';
  }) => {
    console.log(`[Swarm v2.1] Worker stream: workerId=${data.workerId}, taskId=${data.taskId}, streamType=${data.streamType}`);
    const timestamp = new Date().toISOString();

    // v5.0: 存储所有 stream 类型到 SQLite（修复历史日志加载为空的问题）
    // thinking/text 使用缓冲区聚合后再写入，避免碎片化
    if (data.taskId) {
      (async () => {
      try {
        const logDB = await getSwarmLogDB();
        const bufferKey = `${data.workerId}:${data.taskId}`;

        if (data.streamType === 'thinking' || data.streamType === 'text') {
          // 聚合 thinking/text 碎片到缓冲区
          if (!streamBuffers.has(bufferKey)) {
            streamBuffers.set(bufferKey, { type: data.streamType, content: '', timestamp, blueprintId: data.blueprintId, taskId: data.taskId, workerId: data.workerId });
          }
          const buffer = streamBuffers.get(bufferKey)!;

          // 如果类型变化了（thinking→text 或反过来），先刷新旧缓冲区
          if (buffer.type !== data.streamType) {
            if (buffer.content.trim()) {
              logDB.insertStream({
                id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                blueprintId: buffer.blueprintId,
                taskId: buffer.taskId,
                workerId: buffer.workerId,
                timestamp: buffer.timestamp,
                streamType: buffer.type,
                content: buffer.content,
              });
            }
            // 重置为新类型
            buffer.type = data.streamType;
            buffer.content = data.content || '';
            buffer.timestamp = timestamp;
          } else {
            buffer.content += data.content || '';
          }
        } else {
          // tool_start/tool_end/system_prompt: 先刷新缓冲区，再立即写入
          const buffer = streamBuffers.get(bufferKey);
          if (buffer && buffer.content.trim()) {
            logDB.insertStream({
              id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              blueprintId: buffer.blueprintId,
              taskId: buffer.taskId,
              workerId: buffer.workerId,
              timestamp: buffer.timestamp,
              streamType: buffer.type,
              content: buffer.content,
            });
            buffer.content = '';
          }

          // 写入 tool/system_prompt 记录
          logDB.insertStream({
            id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            blueprintId: data.blueprintId,
            taskId: data.taskId,
            workerId: data.workerId,
            timestamp,
            streamType: data.streamType,
            content: data.streamType === 'system_prompt' ? data.systemPrompt : data.content,
            toolName: data.toolName,
            toolInput: data.toolInput,
            toolResult: data.toolResult,
            toolError: data.toolError,
          });
        }
      } catch (err) {
        console.error('[SwarmLogDB] 存储流失败:', err);
      }
      })();
    }

    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:worker_stream',
      payload: {
        workerId: data.workerId,
        taskId: data.taskId,
        streamType: data.streamType,
        content: data.content,
        toolName: data.toolName,
        toolInput: data.toolInput,
        toolResult: data.toolResult,
        toolError: data.toolError,
        timestamp,
        // v4.6: System Prompt 透明展示
        systemPrompt: data.systemPrompt,
        agentType: data.agentType,
      },
    });
  });

  // v3.4: 验收测试状态更新
  executionEventEmitter.on('verification:update', (data: {
    blueprintId: string;
    status: string;
    result?: any;
    error?: string;
  }) => {
    console.log(`[Swarm v3.4] Verification update: ${data.blueprintId} - ${data.status}`);
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:verification_update',
      payload: {
        blueprintId: data.blueprintId,
        status: data.status,
        result: data.result,
        error: data.error,
      },
    });
  });

  // ============================================================================
  // v4.0: E2E 端到端验收测试事件
  // ============================================================================

  executionEventEmitter.on('e2e:start_request', async (data: {
    blueprintId: string;
    blueprint: any;
    config: {
      similarityThreshold?: number;
      autoFix?: boolean;
      maxFixAttempts?: number;
    };
  }) => {
    console.log(`[Swarm E2E] Starting E2E test for blueprint ${data.blueprintId}`);

    // E2E 测试使用特殊任务 ID，用于在 Worker 面板显示流式日志
    const e2eTaskId = `e2e-test-${Date.now()}`;
    const e2eWorkerId = `e2e-worker`;

    // v4.8: 保存 E2E 测试状态，用于刷新浏览器后恢复
    activeE2EState.set(data.blueprintId, {
      status: 'checking_env',
      message: '正在检查测试环境...',
      e2eTaskId,
    });

    // 通知前端开始 E2E 测试，包含任务 ID
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:verification_update',
      payload: {
        status: 'checking_env',
        message: '正在检查测试环境...',
        e2eTaskId, // 前端可以用这个 ID 显示流式日志
      },
    });

    // 清空之前的 E2E 流式内容
    broadcastToSubscribers(data.blueprintId, {
      type: 'swarm:task_reset',
      payload: { taskId: e2eTaskId },
    });

    try {
      // 动态导入 E2ETestAgent
      const { createE2ETestAgent } = await import('../../blueprint/e2e-test-agent.js');

      const agent = createE2ETestAgent({
        model: 'opus',
        similarityThreshold: data.config.similarityThreshold || 80,
      });

      // v4.9: 创建后立即注册到共享注册表，支持用户插嘴
      // 之前只在 ask:request 回调中注册，导致 Agent 未发出提问时插嘴找不到
      registerE2EAgent(data.blueprintId, agent);

      // 监听 Agent 事件（仅服务端日志，不发送到前端）
      agent.on('log', (msg: string) => {
        console.log(`[E2E Agent] ${msg}`);
        // v4.3: 不再发送冗余日志到前端，只保留服务端调试输出
      });

      // v4.1: 监听 Agent 流式事件（文本、工具调用）
      agent.on('stream:text', (streamData: { content: string }) => {
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:worker_stream',
          payload: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'text',
            content: streamData.content,
            timestamp: new Date().toISOString(),
          },
        });
      });

      agent.on('stream:tool_start', (streamData: { toolName: string; toolInput: any }) => {
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:worker_stream',
          payload: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'tool_start',
            toolName: streamData.toolName,
            toolInput: streamData.toolInput,
            timestamp: new Date().toISOString(),
          },
        });
      });

      agent.on('stream:tool_end', (streamData: { toolName: string; toolResult?: string; toolError?: string }) => {
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:worker_stream',
          payload: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'tool_end',
            toolName: streamData.toolName,
            toolResult: streamData.toolResult,
            toolError: streamData.toolError,
            timestamp: new Date().toISOString(),
          },
        });
      });

      // v4.6: 监听 E2E Agent System Prompt 事件（透明展示 Agent 指令）
      agent.on('stream:system_prompt', (streamData: { agentType: string; systemPrompt: string; blueprintId: string; blueprintName: string }) => {
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:worker_stream',
          payload: {
            workerId: e2eWorkerId,
            taskId: e2eTaskId,
            streamType: 'system_prompt',
            systemPrompt: streamData.systemPrompt,
            agentType: 'e2e',
            timestamp: new Date().toISOString(),
          },
        });
      });

      agent.on('step:start', (stepData: any) => {
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:verification_update',
          payload: {
            status: 'running_tests',
            message: `执行测试步骤: ${stepData.stepName || stepData.step}`,
            currentStep: stepData,
            e2eTaskId,
          },
        });
      });

      agent.on('step:complete', (stepData: any) => {
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:verification_update',
          payload: {
            status: 'running_tests',
            message: `步骤完成: ${stepData.stepName || stepData.step}`,
            stepResult: stepData,
            e2eTaskId,
          },
        });
      });

      // v4.2: 监听 AskUserQuestion 请求事件
      agent.on('ask:request', (askData: { requestId: string; questions: any[] }) => {
        console.log(`[E2E Agent] AskUserQuestion request: ${askData.requestId}`);
        broadcastToSubscribers(data.blueprintId, {
          type: 'swarm:ask_user',
          payload: {
            requestId: askData.requestId,
            questions: askData.questions,
            e2eTaskId,
          },
        });

        // v4.9: agent 已在创建时注册到共享注册表，此处无需重复注册
      });

      // 构建测试上下文
      const context = {
        blueprint: data.blueprint,
        projectPath: data.blueprint.projectPath,
        techStack: data.blueprint.techStack || { language: 'typescript', packageManager: 'npm' },
        designImages: data.blueprint.designImages || [],
        appUrl: 'http://localhost:3000',
      };

      // 通知前端开始运行测试
      // v4.8: 更新 E2E 测试状态
      activeE2EState.set(data.blueprintId, {
        status: 'running_tests',
        message: '正在执行 E2E 浏览器测试...',
        e2eTaskId,
      });
      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:verification_update',
        payload: {
          status: 'running_tests',
          message: '正在执行 E2E 浏览器测试...',
          e2eTaskId,
        },
      });

      // 执行 E2E 测试
      const result = await agent.execute(context);

      // 通知前端测试完成
      const finalStatus = result.success ? 'passed' : 'failed';
      const finalMessage = result.success ? 'E2E 测试全部通过' : `E2E 测试失败: ${result.summary || '部分步骤未通过'}`;

      // 修复：传递完整的测试统计数据（前端期望 passedTests/failedTests/skippedTests）
      const finalResult = {
        success: result.success,
        steps: result.steps,
        summary: result.summary,
        // 添加测试统计数据（映射 Steps -> Tests 命名）
        totalTests: result.steps?.length || 0,
        passedTests: result.passedSteps || 0,
        failedTests: result.failedSteps || 0,
        skippedTests: result.skippedSteps || 0,
        // 保留原始字段名（兼容）
        passedSteps: result.passedSteps || 0,
        failedSteps: result.failedSteps || 0,
        skippedSteps: result.skippedSteps || 0,
        // 失败详情
        failures: result.steps?.filter((s: any) => s.status === 'failed').map((s: any) => ({
          name: s.name,
          error: s.error || '未知错误',
        })) || [],
        // 修复尝试
        fixAttempts: result.fixAttempts || [],
      };

      // v4.8: 更新 E2E 测试状态（测试完成后保留结果，不立即删除）
      activeE2EState.set(data.blueprintId, {
        status: finalStatus,
        message: finalMessage,
        e2eTaskId,
        result: finalResult,
      });

      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:verification_update',
        payload: {
          status: finalStatus,
          message: finalMessage,
          result: finalResult,
          e2eTaskId,
        },
      });

      console.log(`[Swarm E2E] E2E test completed: ${result.success ? 'PASSED' : 'FAILED'}`);

      // v4.9: 清理 agent 引用（使用共享注册表）
      unregisterE2EAgent(data.blueprintId);
    } catch (error: any) {
      console.error(`[Swarm E2E] E2E test error:`, error);

      // v4.8: 更新 E2E 测试状态（失败）
      activeE2EState.set(data.blueprintId, {
        status: 'failed',
        message: `E2E 测试执行失败: ${error.message}`,
        e2eTaskId,
      });

      broadcastToSubscribers(data.blueprintId, {
        type: 'swarm:verification_update',
        payload: {
          status: 'failed',
          message: `E2E 测试执行失败: ${error.message}`,
          error: error.message,
          e2eTaskId,
        },
      });

      // v4.9: 清理 agent 引用（使用共享注册表）
      unregisterE2EAgent(data.blueprintId);
    }
  });

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws: WebSocket) => {
    const clientId = randomUUID();
    const sessionId = randomUUID();

    const client: ClientConnection = {
      id: clientId,
      ws,
      sessionId,
      model: 'opus',
      isAlive: true,
      swarmSubscriptions: new Set<string>(),
    };

    clients.set(clientId, client);

    console.log(`[WebSocket] 客户端连接: ${clientId}`);

    // 发送连接确认
    sendMessage(ws, {
      type: 'connected',
      payload: {
        sessionId,
        model: client.model,
      },
    });

    // 推送当前权限模式
    const permConfig = conversationManager.getPermissionConfig(sessionId);
    if (permConfig) {
      sendMessage(ws, {
        type: 'permission_config_update',
        payload: {
          mode: permConfig.mode,
          bypassTools: permConfig.bypassTools,
          alwaysAllow: permConfig.alwaysAllow,
          alwaysDeny: permConfig.alwaysDeny,
        },
      } as any);
    }

    // 推送已加载的 skills 列表（供前端斜杠命令补全使用）
    // initializeSkills 内部使用 getCurrentCwd()，需要在 runWithCwd 上下文中执行
    const skillsCwd = client.projectPath || process.cwd();
    runWithCwd(skillsCwd, () => {
      initializeSkills().then(() => {
        const allSkills = getAllSkills().filter(s => s.userInvocable !== false);

        // 按 base name（冒号后面的部分）去重，后出现的覆盖先出现的（高优先级 source 后加载）
        // 推送给前端时用完整 skillName（供执行时精确匹配），但用 baseName 作为显示名
        const deduped = new Map<string, { name: string; description: string; argumentHint?: string }>();
        for (const s of allSkills) {
          const baseName = s.skillName.includes(':') ? s.skillName.split(':').pop()! : s.skillName;
          deduped.set(baseName, {
            name: baseName,
            description: s.description || '',
            argumentHint: s.argumentHint,
          });
        }
        const skills = Array.from(deduped.values());

        if (skills.length > 0) {
          sendMessage(ws, {
            type: 'skills_list',
            payload: { skills },
          } as any);
        }
      }).catch((err) => {
        console.error('[WebSocket] Skills 加载失败:', err);
      });
    });

    // 处理心跳
    ws.on('pong', () => {
      client.isAlive = true;
    });

    // 处理消息
    ws.on('message', async (data: Buffer) => {
      try {
        const message: ClientMessage = JSON.parse(data.toString());
        await handleClientMessage(client, message, conversationManager, swarmSubscriptions);
      } catch (error) {
        console.error('[WebSocket] 消息处理错误:', error);
        sendMessage(ws, {
          type: 'error',
          payload: {
            message: error instanceof Error ? error.message : '未知错误',
          },
        });
      }
    });

    // 处理关闭
    ws.on('close', () => {
      console.log(`[WebSocket] 客户端断开: ${clientId}`);
      // 清理订阅
      cleanupClientSubscriptions(clientId);
      // 清理终端会话
      const terminals = clientTerminals.get(clientId);
      if (terminals) {
        for (const termId of terminals) {
          terminalManager.destroy(termId);
        }
        clientTerminals.delete(clientId);
      }
      clients.delete(clientId);
    });

    // 处理错误
    ws.on('error', (error) => {
      console.error(`[WebSocket] 客户端错误 ${clientId}:`, error);
      clients.delete(clientId);
    });
  });
}

/**
 * 发送消息到客户端
 */
function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    // 记录丢弃的消息类型，便于排查消息丢失问题
    const sessionId = ('payload' in message ? (message.payload as any)?.sessionId : '') || '';
    console.warn(`[WebSocket] 消息被丢弃 (ws.readyState=${ws.readyState}): type=${message.type}, session=${sessionId}`);
  }
}

/**
 * 处理客户端消息
 */
async function handleClientMessage(
  client: ClientConnection,
  message: ClientMessage,
  conversationManager: ConversationManager,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  switch (message.type) {
    case 'ping':
      sendMessage(ws, { type: 'pong' });
      break;

    case 'chat':
      // 确保会话关联 WebSocket
      conversationManager.setWebSocket(client.sessionId, ws);
      // 如果消息中包含 projectPath，更新 client.projectPath
      if (message.payload.projectPath !== undefined) {
        client.projectPath = message.payload.projectPath;
      }
      await handleChatMessage(client, message.payload.content, message.payload.attachments || message.payload.images, conversationManager);
      break;

    case 'cancel':
      conversationManager.cancel(client.sessionId);
      sendMessage(ws, {
        type: 'status',
        payload: { status: 'idle', message: '已取消' },
      });
      break;

    case 'get_history':
      const history = conversationManager.getHistory(client.sessionId);
      sendMessage(ws, {
        type: 'history',
        payload: { messages: history },
      });
      break;

    case 'clear_history':
      conversationManager.clearHistory(client.sessionId);
      sendMessage(ws, {
        type: 'history',
        payload: { messages: [] },
      });
      break;

    case 'set_model':
      client.model = message.payload.model;
      conversationManager.setModel(client.sessionId, message.payload.model);
      break;

    case 'set_language':
      try {
        const lang = message.payload.language;
        await changeLocale(lang);
        // 持久化到 ~/.claude/settings.json
        configManager.save({ language: lang });
        sendMessage(ws, {
          type: 'language_changed',
          payload: { language: getCurrentLocale() },
        } as any);
      } catch (err) {
        console.error('[WebSocket] set_language failed:', err);
      }
      break;

    case 'permission_response':
      conversationManager.handlePermissionResponse(
        client.sessionId,
        message.payload.requestId,
        message.payload.approved,
        message.payload.remember,
        message.payload.scope,
        message.payload.destination
      );
      break;

    case 'permission_config':
      // 关键修复：同时保存到 client 级别，确保跨会话持久化
      if (message.payload?.mode) {
        client.permissionMode = message.payload.mode;
      }
      conversationManager.updatePermissionConfig(client.sessionId, message.payload);
      // 回传更新后的权限配置给客户端
      {
        const updatedConfig = conversationManager.getPermissionConfig(client.sessionId);
        if (updatedConfig) {
          sendMessage(client.ws, {
            type: 'permission_config_update',
            payload: {
              mode: updatedConfig.mode,
              bypassTools: updatedConfig.bypassTools,
              alwaysAllow: updatedConfig.alwaysAllow,
              alwaysDeny: updatedConfig.alwaysDeny,
            },
          } as any);
        }
      }
      break;

    case 'user_answer':
      conversationManager.handleUserAnswer(
        client.sessionId,
        message.payload.requestId,
        message.payload.answer
      );
      break;

    case 'slash_command':
      await handleSlashCommand(client, message.payload.command, conversationManager);
      break;

    case 'session_list':
      await handleSessionList(client, message.payload, conversationManager);
      break;

    case 'session_create':
      await handleSessionCreate(client, message.payload, conversationManager);
      break;

    case 'session_new':
      // 官方规范：创建新的临时会话（不立即持久化）
      // 会话只有在发送第一条消息后才会真正创建
      await handleSessionNew(client, message.payload, conversationManager);
      break;

    case 'session_switch':
      await handleSessionSwitch(client, message.payload.sessionId, conversationManager);
      break;

    case 'session_delete':
      await handleSessionDelete(client, message.payload.sessionId, conversationManager);
      break;

    case 'session_rename':
      await handleSessionRename(client, message.payload.sessionId, message.payload.name, conversationManager);
      break;

    case 'rewind_preview':
      await handleRewindPreview(client, message.payload, conversationManager);
      break;

    case 'rewind_execute':
      await handleRewindExecute(client, message.payload, conversationManager);
      break;

    // Git 操作
    case 'git:get_status':
      await handleGitGetStatus(client, conversationManager);
      break;

    case 'git:get_log':
      await handleGitGetLog(client, message.payload?.limit, conversationManager);
      break;

    case 'git:get_branches':
      await handleGitGetBranches(client, conversationManager);
      break;

    case 'git:get_stashes':
      await handleGitGetStashes(client, conversationManager);
      break;

    case 'git:stage':
      await handleGitStage(client, message.payload.files, conversationManager);
      break;

    case 'git:unstage':
      await handleGitUnstage(client, message.payload.files, conversationManager);
      break;

    case 'git:commit':
      await handleGitCommit(client, message.payload.message, conversationManager, message.payload.autoStage);
      break;

    case 'git:push':
      await handleGitPush(client, conversationManager);
      break;

    case 'git:pull':
      await handleGitPull(client, conversationManager);
      break;

    case 'git:checkout':
      await handleGitCheckout(client, message.payload.branch, conversationManager);
      break;

    case 'git:create_branch':
      await handleGitCreateBranch(client, message.payload.name, conversationManager);
      break;

    case 'git:delete_branch':
      await handleGitDeleteBranch(client, message.payload.name, conversationManager);
      break;

    case 'git:stash_save':
      await handleGitStashSave(client, message.payload?.message, conversationManager);
      break;

    case 'git:stash_pop':
      await handleGitStashPop(client, message.payload?.index, conversationManager);
      break;

    case 'git:stash_drop':
      await handleGitStashDrop(client, message.payload.index, conversationManager);
      break;

    case 'git:stash_apply':
      await handleGitStashApply(client, message.payload.index, conversationManager);
      break;

    case 'git:get_diff':
      await handleGitGetDiff(client, message.payload?.file, conversationManager);
      break;

    case 'git:smart_commit':
      await handleGitSmartCommit(client, conversationManager);
      break;

    case 'git:smart_review':
      await handleGitSmartReview(client, conversationManager);
      break;

    case 'git:explain_commit':
      await handleGitExplainCommit(client, message.payload.hash, conversationManager);
      break;

    case 'session_export':
      await handleSessionExport(client, message.payload.sessionId, message.payload.format, conversationManager);
      break;

    case 'session_resume':
      await handleSessionResume(client, message.payload.sessionId, conversationManager);
      break;

    case 'task_list':
      await handleTaskList(client, message.payload, conversationManager);
      break;

    case 'task_cancel':
      await handleTaskCancel(client, message.payload.taskId, conversationManager);
      break;

    case 'task_output':
      await handleTaskOutput(client, message.payload.taskId, conversationManager);
      break;

    case 'tool_filter_update':
      await handleToolFilterUpdate(client, message.payload, conversationManager);
      break;

    case 'tool_list_get':
      await handleToolListGet(client, conversationManager);
      break;

    case 'system_prompt_update':
      await handleSystemPromptUpdate(client, message.payload.config, conversationManager);
      break;

    case 'system_prompt_get':
      await handleSystemPromptGet(client, conversationManager);
      break;

    // ========== 提示词片段管理 ==========
    case 'prompt_snippets_list':
      handlePromptSnippetsList(client);
      break;

    case 'prompt_snippets_create':
      handlePromptSnippetsCreate(client, message.payload);
      break;

    case 'prompt_snippets_update':
      handlePromptSnippetsUpdate(client, message.payload.id, message.payload);
      break;

    case 'prompt_snippets_delete':
      handlePromptSnippetsDelete(client, message.payload.id);
      break;

    case 'prompt_snippets_toggle':
      handlePromptSnippetsToggle(client, message.payload.id);
      break;

    case 'prompt_snippets_reorder':
      handlePromptSnippetsReorder(client, message.payload.orders);
      break;

    case 'debug_get_messages':
      await handleDebugGetMessages(client, conversationManager);
      break;

    case 'mcp_list':
      await handleMcpList(client, conversationManager);
      break;

    case 'mcp_add':
      await handleMcpAdd(client, message.payload, conversationManager);
      break;

    case 'mcp_remove':
      await handleMcpRemove(client, message.payload, conversationManager);
      break;

    case 'mcp_toggle':
      await handleMcpToggle(client, message.payload, conversationManager);
      break;

    case 'api_status':
      await handleApiStatus(client);
      break;

    case 'api_test':
      await handleApiTest(client);
      break;

    case 'api_models':
      await handleApiModels(client);
      break;

    case 'api_provider':
      await handleApiProvider(client);
      break;

    case 'api_token_status':
      await handleApiTokenStatus(client);
      break;

    case 'checkpoint_create':
      await handleCheckpointCreate(client, message.payload, conversationManager);
      break;

    case 'checkpoint_list':
      await handleCheckpointList(client, message.payload, conversationManager);
      break;

    case 'checkpoint_restore':
      await handleCheckpointRestore(client, message.payload.checkpointId, message.payload.dryRun, conversationManager);
      break;

    case 'checkpoint_delete':
      await handleCheckpointDelete(client, message.payload.checkpointId, conversationManager);
      break;

    case 'checkpoint_diff':
      await handleCheckpointDiff(client, message.payload.checkpointId, conversationManager);
      break;

    case 'checkpoint_clear':
      await handleCheckpointClear(client, conversationManager);
      break;

    case 'doctor_run':
      await handleDoctorRun(client, message.payload);
      break;

    case 'plugin_list':
      await handlePluginList(client, conversationManager);
      break;

    case 'plugin_discover':
      await handlePluginDiscover(client, conversationManager);
      break;

    case 'plugin_info':
      await handlePluginInfo(client, message.payload.name, conversationManager);
      break;

    case 'plugin_enable':
      await handlePluginEnable(client, message.payload.name, conversationManager);
      break;

    case 'plugin_disable':
      await handlePluginDisable(client, message.payload.name, conversationManager);
      break;

    case 'plugin_install':
      await handlePluginInstall(client, message.payload, conversationManager);
      break;

    case 'plugin_uninstall':
      await handlePluginUninstall(client, message.payload.name, conversationManager);
      break;

    case 'auth_status':
      await handleAuthStatus(client);
      break;

    case 'auth_set_key':
      await handleAuthSetKey(client, message.payload);
      break;

    case 'auth_clear':
      await handleAuthClear(client);
      break;

    case 'auth_validate':
      await handleAuthValidate(client, message.payload);
      break;

    // ========== OAuth 相关消息 ==========
    case 'oauth_login':
      await handleOAuthLogin(client, message.payload);
      break;

    case 'oauth_refresh':
      await handleOAuthRefresh(client, message.payload);
      break;

    case 'oauth_status':
      await handleOAuthStatus(client);
      break;

    case 'oauth_logout':
      await handleOAuthLogout(client);
      break;

    case 'oauth_get_auth_url':
      await handleOAuthGetAuthUrl(client, message.payload);
      break;

    // ========== 蜂群相关消息 ==========
    case 'swarm:subscribe':
      await handleSwarmSubscribe(client, message.payload.blueprintId, swarmSubscriptions);
      break;

    case 'swarm:unsubscribe':
      await handleSwarmUnsubscribe(client, message.payload.blueprintId, swarmSubscriptions);
      break;

    case 'swarm:pause':
      await handleSwarmPause(client, message.payload.blueprintId, swarmSubscriptions);
      break;

    case 'swarm:resume':
      await handleSwarmResume(client, message.payload.blueprintId, swarmSubscriptions);
      break;

    case 'swarm:stop':
      await handleSwarmStop(client, message.payload.blueprintId, swarmSubscriptions);
      break;

    case 'worker:pause':
      await handleWorkerPause(client, (message.payload as any).workerId, swarmSubscriptions);
      break;

    case 'worker:resume':
      await handleWorkerResume(client, (message.payload as any).workerId, swarmSubscriptions);
      break;

    case 'worker:terminate':
      await handleWorkerTerminate(client, (message.payload as any).workerId, swarmSubscriptions);
      break;

    // v2.1: 任务重试
    case 'task:retry':
      await handleTaskRetry(client, (message.payload as any).blueprintId, (message.payload as any).taskId, swarmSubscriptions);
      break;

    // v3.8: 任务跳过
    case 'task:skip':
      await handleTaskSkip(client, (message.payload as any).blueprintId, (message.payload as any).taskId, swarmSubscriptions);
      break;

    // v4.4: 用户插嘴 - 向正在执行的任务发送消息
    case 'task:interject':
      await handleTaskInterject(
        client,
        (message.payload as any).blueprintId,
        (message.payload as any).taskId,
        (message.payload as any).message
      );
      break;

    // v9.2: LeadAgent 插嘴 - 向正在执行的 LeadAgent 发送消息
    case 'lead:interject':
      await handleLeadInterject(
        client,
        (message.payload as any).blueprintId,
        (message.payload as any).message
      );
      break;

    // v9.4: 恢复 LeadAgent 执行（死任务恢复）
    case 'swarm:resume_lead':
      await handleResumeLead(client, (message.payload as any).blueprintId, swarmSubscriptions);
      break;

    // v3.8: 取消执行
    case 'swarm:cancel':
      await handleSwarmCancel(client, (message.payload as any).blueprintId, swarmSubscriptions);
      break;

    // v4.2: E2E Agent AskUserQuestion 响应
    case 'swarm:ask_response':
      await handleAskUserResponse(client, message.payload as any);
      break;

    // Agent 探针调试（蜂群模式）
    case 'swarm:debug_agent':
      await handleSwarmDebugAgent(client, message.payload as any);
      break;

    case 'swarm:debug_agent_list':
      await handleSwarmDebugAgentList(client, message.payload as any);
      break;

    // ========== 持续开发相关消息 ==========
    case 'continuous_dev:start':
      await handleContinuousDevStart(client, message.payload as any, conversationManager);
      break;

    case 'continuous_dev:status':
      await handleContinuousDevStatus(client);
      break;

    case 'continuous_dev:pause':
      await handleContinuousDevPause(client);
      break;

    case 'continuous_dev:resume':
      await handleContinuousDevResume(client);
      break;

    case 'continuous_dev:rollback':
      await handleContinuousDevRollback(client, message.payload as any);
      break;

    case 'continuous_dev:approve':
      await handleContinuousDevApprove(client);
      break;

    // ========== 终端消息 ==========
    case 'terminal:create': {
      const termPayload = (message as any).payload || {};
      const termId = `term-${client.id}-${Date.now()}`;
      const created = terminalManager.create(termId, {
        cols: termPayload.cols || 80,
        rows: termPayload.rows || 24,
        cwd: termPayload.cwd || client.projectPath || process.cwd(),
        onData: (data: string) => {
          sendMessage(client.ws, {
            type: 'terminal:output',
            payload: { terminalId: termId, data },
          });
        },
        onExit: (exitCode: number) => {
          sendMessage(client.ws, {
            type: 'terminal:exit',
            payload: { terminalId: termId, exitCode },
          });
          // 清理映射
          const terms = clientTerminals.get(client.id);
          if (terms) {
            terms.delete(termId);
            if (terms.size === 0) clientTerminals.delete(client.id);
          }
        },
      });

      if (created) {
        // 记录映射
        if (!clientTerminals.has(client.id)) {
          clientTerminals.set(client.id, new Set());
        }
        clientTerminals.get(client.id)!.add(termId);

        sendMessage(client.ws, {
          type: 'terminal:created',
          payload: { terminalId: termId },
        });
      } else {
        sendMessage(client.ws, {
          type: 'error',
          payload: { message: '创建终端失败' },
        });
      }
      break;
    }

    case 'terminal:input': {
      const inputPayload = (message as any).payload;
      if (inputPayload?.terminalId && inputPayload?.data) {
        terminalManager.write(inputPayload.terminalId, inputPayload.data);
      }
      break;
    }

    case 'terminal:resize': {
      const resizePayload = (message as any).payload;
      if (resizePayload?.terminalId && resizePayload?.cols && resizePayload?.rows) {
        terminalManager.resize(resizePayload.terminalId, resizePayload.cols, resizePayload.rows);
      }
      break;
    }

    case 'terminal:destroy': {
      const destroyPayload = (message as any).payload;
      if (destroyPayload?.terminalId) {
        terminalManager.destroy(destroyPayload.terminalId);
        const terms = clientTerminals.get(client.id);
        if (terms) {
          terms.delete(destroyPayload.terminalId);
          if (terms.size === 0) clientTerminals.delete(client.id);
        }
      }
      break;
    }

    default:
      console.warn('[WebSocket] 未知消息类型:', (message as any).type);
  }
}

/**
 * 媒体附件信息（仅图片，直接传递给 Claude API）
 */
interface MediaAttachment {
  data: string;
  mimeType: string;
  type: 'image';
}

/**
 * 文件附件信息（非图片类型，保存为临时文件后传路径给模型）
 */
interface FileAttachment {
  name: string;
  data: string;  // base64 数据
  mimeType: string;
}

/**
 * 处理聊天消息
 */
async function handleChatMessage(
  client: ClientConnection,
  content: string,
  attachments: Attachment[] | string[] | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, model, projectPath } = client;
  let { sessionId } = client;

  console.log(`[WebSocket] handleChatMessage - sessionId: ${sessionId}, projectPath: ${projectPath || 'undefined'}`);

  // 检查是否为斜杠命令
  if (isSlashCommand(content)) {
    await handleSlashCommand(client, content, conversationManager);
    return;
  }

  // 确保会话存在于 sessionManager 中（处理临时会话 ID 的情况）
  const sessionManager = conversationManager.getSessionManager();
  let isFirstMessage = false;
  let existingSession = sessionManager.loadSessionById(sessionId);

  if (!existingSession) {
    // 当前 sessionId 是临时的（WebSocket 连接时生成的），需要创建持久化会话
    // 官方规范：使用第一条消息的前50个字符作为会话标题
    const firstPrompt = content.substring(0, 50);
    console.log(`[WebSocket] 临时会话 ${sessionId}，创建持久化会话，标题: ${firstPrompt}, projectPath: ${client.projectPath || 'global'}`);
    const newSession = sessionManager.createSession({
      name: firstPrompt,  // 使用 firstPrompt 作为会话标题
      model: model,
      tags: ['webui'],
      projectPath: client.projectPath,  // 传递项目路径
    });
    // 更新 client 的 sessionId
    client.sessionId = newSession.metadata.id;
    sessionId = newSession.metadata.id;
    isFirstMessage = true;
    console.log(`[WebSocket] 已创建持久化会话: ${sessionId}`);

    // 通知客户端新会话已创建
    sendMessage(ws, {
      type: 'session_created',
      payload: {
        sessionId: newSession.metadata.id,
        name: newSession.metadata.name,
        model: newSession.metadata.model,
        createdAt: newSession.metadata.createdAt,
      },
    });

    // 关键修复：新会话创建后需要设置 WebSocket
    // 之前 setWebSocket 调用时会话还不存在，所以这里需要再次设置
    conversationManager.setWebSocket(sessionId, ws);
  } else {
    // 检查是否是第一条消息（会话存在但没有消息）
    isFirstMessage = (existingSession.metadata.messageCount === 0);

    // 如果是第一条消息且会话标题是默认的（包含"WebUI 会话"），更新为 firstPrompt
    if (isFirstMessage && existingSession.metadata.name?.includes('WebUI 会话')) {
      const firstPrompt = content.substring(0, 50);
      sessionManager.renameSession(sessionId, firstPrompt);
      console.log(`[WebSocket] 更新会话标题为 firstPrompt: ${firstPrompt}`);
    }
  }

  const messageId = randomUUID();

  // 处理附件：图片直接传递给 Claude API，其他文件保存为临时文件传路径
  let mediaAttachments: MediaAttachment[] | undefined;
  let fileAttachments: FileAttachment[] | undefined;
  let enhancedContent = content;

  if (attachments && Array.isArray(attachments)) {
    if (attachments.length > 0 && typeof attachments[0] === 'object') {
      const typedAttachments = attachments as Attachment[];

      // 提取图片附件（直接传递给 Claude API）
      mediaAttachments = typedAttachments
        .filter(att => att.type === 'image')
        .map(att => ({
          data: att.data,
          mimeType: att.mimeType || 'image/png',
          type: 'image' as const,
        }));

      // 所有非图片附件统一保存为临时文件（包括 pdf/docx/xlsx/pptx/text/file 等任意格式）
      fileAttachments = typedAttachments
        .filter(att => att.type !== 'image')
        .map(att => ({
          name: att.name,
          data: att.data,
          mimeType: att.mimeType || 'application/octet-stream',
        }));
    } else {
      // 旧格式：直接是 base64 字符串数组（默认图片 png）
      mediaAttachments = (attachments as string[]).map(data => ({
        data,
        mimeType: 'image/png',
        type: 'image' as const,
      }));
    }
  }

  // 处理非图片文件附件：保存到临时目录，将文件路径告知模型
  if (fileAttachments && fileAttachments.length > 0) {
    const processedFiles: string[] = [];
    for (const file of fileAttachments) {
      try {
        const fileInfo = await processFileAttachment(file);
        if (fileInfo) {
          processedFiles.push(fileInfo);
        }
      } catch (error) {
        console.error(`[WebSocket] 处理文件附件失败: ${file.name}`, error);
        processedFiles.push(`[附件: ${file.name}]\n（处理失败: ${error instanceof Error ? error.message : '未知错误'}）`);
      }
    }
    if (processedFiles.length > 0) {
      enhancedContent = processedFiles.join('\n\n') + (enhancedContent ? '\n\n' + enhancedContent : '');
    }
  }

  // 捕获当前 sessionId（闭包），用于标记所有流式消息
  // 这样即使用户在对话过程中切换了会话，客户端也能区分消息来源
  const chatSessionId = sessionId;

  // 动态获取当前活跃的 WebSocket 连接
  // 关键修复：页面刷新后旧 ws 闭包引用失效，需从 ConversationManager 获取最新的 ws
  // 这样即使用户刷新页面，流式消息也能发送到新的 WebSocket 连接
  const getActiveWs = (): WebSocket => {
    return conversationManager.getWebSocket(chatSessionId) || ws;
  };

  // 始终发送流式消息到 WebSocket，不做服务端门控
  // 客户端已有基于 sessionId 的会话隔离过滤（useMessageHandler），
  // 服务端门控（isActiveSession）会导致用户切换会话或刷新页面时消息永久丢失，
  // 而 streamingContent 只累积 thinking/text，工具调用等事件无法恢复
  sendMessage(getActiveWs(), {
    type: 'message_start',
    payload: { messageId, sessionId: chatSessionId },
  });

  sendMessage(getActiveWs(), {
    type: 'status',
    payload: { status: 'thinking', sessionId: chatSessionId },
  });

  try {
    // 调用对话管理器，传入流式回调（媒体附件包含 mimeType 和类型）
    // 所有回调使用 getActiveWs() 动态获取 WebSocket，确保刷新后消息仍能送达
    await conversationManager.chat(chatSessionId, enhancedContent, mediaAttachments, model, {
      onThinkingStart: () => {
        sendMessage(getActiveWs(), {
          type: 'thinking_start',
          payload: { messageId, sessionId: chatSessionId },
        });
      },

      onThinkingDelta: (text: string) => {
        sendMessage(getActiveWs(), {
          type: 'thinking_delta',
          payload: { messageId, text, sessionId: chatSessionId },
        });
      },

      onThinkingComplete: () => {
        sendMessage(getActiveWs(), {
          type: 'thinking_complete',
          payload: { messageId, sessionId: chatSessionId },
        });
      },

      onTextDelta: (text: string) => {
        sendMessage(getActiveWs(), {
          type: 'text_delta',
          payload: { messageId, text, sessionId: chatSessionId },
        });
      },

      onToolUseStart: (toolUseId: string, toolName: string, input: unknown) => {
        sendMessage(getActiveWs(), {
          type: 'tool_use_start',
          payload: { messageId, toolUseId, toolName, input, sessionId: chatSessionId },
        });
        sendMessage(getActiveWs(), {
          type: 'status',
          payload: { status: 'tool_executing', message: `执行 ${toolName}...`, sessionId: chatSessionId },
        });
      },

      onToolUseDelta: (toolUseId: string, partialJson: string) => {
        sendMessage(getActiveWs(), {
          type: 'tool_use_delta',
          payload: { toolUseId, partialJson, sessionId: chatSessionId },
        });
      },

      onToolResult: (toolUseId: string, success: boolean, output?: string, error?: string, data?: unknown) => {
        sendMessage(getActiveWs(), {
          type: 'tool_result',
          payload: {
            toolUseId,
            success,
            output,
            error,
            data: data as any, // 工具特定的结构化数据
            defaultCollapsed: true, // 结果默认折叠
            sessionId: chatSessionId,
          },
        });
      },

      onPermissionRequest: (request: any) => {
        sendMessage(getActiveWs(), {
          type: 'permission_request',
          payload: { ...request, sessionId: chatSessionId },
        });
      },

      onComplete: async (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => {
        // 保存会话到磁盘（确保 messageCount 正确更新）
        await conversationManager.persistSession(chatSessionId);

        // 检查是否需要重发 history（页面刷新导致客户端丢失了流式上下文）
        // 如果需要，发送完整 history 替代 message_complete，确保客户端显示完整对话
        if (conversationManager.consumeHistoryResendFlag(chatSessionId)) {
          console.log(`[WebSocket] 会话 ${chatSessionId} 处理完成，重发 history（页面刷新恢复）`);
          const updatedHistory = conversationManager.getHistory(chatSessionId);
          sendMessage(getActiveWs(), {
            type: 'history',
            payload: { messages: updatedHistory },
          });
        } else {
          sendMessage(getActiveWs(), {
            type: 'message_complete',
            payload: {
              messageId,
              stopReason: (stopReason || 'end_turn') as 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use',
              usage,
              sessionId: chatSessionId,
            },
          });
        }
        sendMessage(getActiveWs(), {
          type: 'status',
          payload: { status: 'idle', sessionId: chatSessionId },
        });
      },

      onError: (error: Error) => {
        // 页面刷新恢复：错误时也需要重发 history 确保客户端状态一致
        if (conversationManager.consumeHistoryResendFlag(chatSessionId)) {
          const updatedHistory = conversationManager.getHistory(chatSessionId);
          sendMessage(getActiveWs(), {
            type: 'history',
            payload: { messages: updatedHistory },
          });
        }
        sendMessage(getActiveWs(), {
          type: 'error',
          payload: { message: error.message, sessionId: chatSessionId },
        });
        sendMessage(getActiveWs(), {
          type: 'status',
          payload: { status: 'idle', sessionId: chatSessionId },
        });
      },

      onContextUpdate: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => {
        sendMessage(getActiveWs(), {
          type: 'context_update',
          payload: { ...usage, sessionId: chatSessionId },
        });
      },

      onContextCompact: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => {
        sendMessage(getActiveWs(), {
          type: 'context_compact',
          payload: {
            phase,
            ...info,
            sessionId: chatSessionId,
          },
        });
        // 压缩开始时，通知前端状态变更
        if (phase === 'start') {
          sendMessage(getActiveWs(), {
            type: 'status',
            payload: { status: 'thinking', message: '正在压缩上下文...', sessionId: chatSessionId },
          });
        }
      },
    }, client.projectPath, getActiveWs(), client.permissionMode);  // 传入动态 ws 和权限模式，确保跨会话持久化
  } catch (error) {
    console.error('[WebSocket] 聊天处理错误:', error);
    sendMessage(getActiveWs(), {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '处理失败', sessionId: chatSessionId },
    });
    sendMessage(getActiveWs(), {
      type: 'status',
      payload: { status: 'idle', sessionId: chatSessionId },
    });
  }
}

/**
 * 处理斜杠命令
 */
async function handleSlashCommand(
  client: ClientConnection,
  command: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, sessionId, model, projectPath } = client;

  try {
    // 获取当前工作目录（优先使用项目路径）
    const cwd = projectPath || process.cwd();

    // 执行斜杠命令
    const result = await executeSlashCommand(command, {
      conversationManager,
      ws,
      sessionId,
      cwd,
      model,
    });

    console.log(`[WebSocket] handleSlashCommand result: success=${result.success}, message=${result.message?.substring(0, 60)}`);

    // 如果内置命令未找到，尝试作为 skill 执行
    if (!result.success && result.message?.startsWith('未知命令:')) {
      const trimmed = command.trim();
      const parts = trimmed.slice(1).split(/\s+/);
      const skillName = parts[0];
      const skillArgs = parts.slice(1).join(' ');

      console.log(`[WebSocket] 尝试查找 skill: ${skillName}`);

      // 确保 skills 已加载（需要 runWithCwd 上下文，因为 initializeSkills 内部使用 getCurrentCwd）
      const skill = await runWithCwd(cwd, async () => {
        await initializeSkills();
        return findSkill(skillName);
      });

      console.log(`[WebSocket] findSkill(${skillName}): ${skill ? 'FOUND' : 'NOT FOUND'}`);
      if (skill) {
        // 找到 skill，将其内容作为消息发送给 AI
        let skillContent = skill.markdownContent;
        // 替换 $ARGUMENTS 占位符
        if (skillArgs) {
          skillContent = skillContent.replace(/\$ARGUMENTS/g, skillArgs);
        }
        const messageContent = `[Skill: ${skill.skillName}]\n\n${skillContent}`;
        console.log(`[WebSocket] 执行 skill ${skill.skillName}, 内容长度: ${skillContent.length}`);
        await handleChatMessage(client, messageContent, undefined, conversationManager);
        return;
      }
    }

    // /resume <id> 成功后需要切换会话
    if (result.data?.switchToSessionId) {
      await handleSessionSwitch(client, result.data.switchToSessionId, conversationManager);
      return;
    }

    // 发送命令执行结果（包含 dialogType）
    sendMessage(ws, {
      type: 'slash_command_result',
      payload: {
        command,
        success: result.success,
        message: result.message,
        data: result.data,
        action: result.action,
        dialogType: result.dialogType,
      },
    });

    // 如果命令要求清除历史
    if (result.action === 'clear') {
      sendMessage(ws, {
        type: 'history',
        payload: { messages: [] },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 斜杠命令执行错误:', error);
    sendMessage(ws, {
      type: 'slash_command_result',
      payload: {
        command,
        success: false,
        message: error instanceof Error ? error.message : '命令执行失败',
      },
    });
  }
}

/**
 * 处理会话列表请求
 */
async function handleSessionList(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const limit = payload?.limit || 20;
    const offset = payload?.offset || 0;
    const search = payload?.search;
    // 支持按项目路径过滤，undefined 表示不过滤，null 表示只获取全局会话
    const projectPath = payload?.projectPath;

    const allSessions = conversationManager.listPersistedSessions({
      limit: limit + 50, // 获取更多以便过滤后仍有足够数量
      offset,
      search,
      projectPath,
    });

    // 对齐官方：过滤掉没有任何内容标识的空会话
    // 官方 CLI 通过 firstPrompt/customTitle 判断，我们用 name/summary/messageCount
    // 不再仅依赖 messageCount > 0，避免强制重启后 WAL 未 checkpoint 导致会话消失
    const sessions = allSessions.filter(s =>
      s.messageCount > 0 || s.name || s.summary
    ).slice(0, limit);

    sendMessage(ws, {
      type: 'session_list_response',
      payload: {
        sessions: sessions.map(s => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          model: s.model,
          cost: s.cost,
          tokenUsage: s.tokenUsage,
          tags: s.tags,
          workingDirectory: s.workingDirectory,
          projectPath: s.projectPath,
        })),
        total: sessions.length,
        offset,
        limit,
        hasMore: false,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取会话列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取会话列表失败',
      },
    });
  }
}

/**
 * 处理创建会话请求
 */
async function handleSessionCreate(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const { name, model, tags, projectPath } = payload;
    const sessionManager = conversationManager.getSessionManager();

    const newSession = sessionManager.createSession({
      name: name || `WebUI 会话 - ${new Date().toLocaleString('zh-CN')}`,
      model: model || 'opus',
      tags: tags || ['webui'],
      projectPath,
    });

    // 更新客户端会话状态
    client.sessionId = newSession.metadata.id;
    client.model = model || 'opus';
    client.projectPath = projectPath;

    sendMessage(ws, {
      type: 'session_created',
      payload: {
        sessionId: newSession.metadata.id,
        name: newSession.metadata.name,
        model: newSession.metadata.model,
        createdAt: newSession.metadata.createdAt,
        projectPath: newSession.metadata.projectPath,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 创建会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '创建会话失败',
      },
    });
  }
}

/**
 * 处理新建临时会话请求（官方规范）
 * 生成临时 sessionId，但不立即创建持久化会话
 * 会话只有在发送第一条消息后才会真正创建
 */
async function handleSessionNew(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    // 保存当前会话（如果有的话）
    await conversationManager.persistSession(client.sessionId);

    // 生成新的临时 sessionId（使用 crypto 生成 UUID）
    const tempSessionId = randomUUID();
    const model = payload?.model || client.model || 'opus';
    const projectPath = payload?.projectPath;

    // 更新 client 的 sessionId、model 和 projectPath
    client.sessionId = tempSessionId;
    client.model = model;
    client.projectPath = projectPath;

    // 清空内存中的会话状态（如果存在）
    // 不创建持久化会话，等待用户发送第一条消息时再创建

    console.log(`[WebSocket] 新建临时会话: ${tempSessionId}, model: ${model}, projectPath: ${projectPath || 'global'}`);

    // 通知客户端新会话已就绪
    sendMessage(ws, {
      type: 'session_new_ready',
      payload: {
        sessionId: tempSessionId,
        model: model,
        projectPath,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 新建临时会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '新建会话失败',
      },
    });
  }
}

/**
 * 处理切换会话请求
 */
async function handleSessionSwitch(
  client: ClientConnection,
  sessionId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    // 提前更新 ws：如果目标会话已在内存中（正在处理），立即将其 ws 指向新连接
    // 这样在 await resumeSession() 期间，流式回调就能通过 getActiveWs() 获取到新 ws，
    // 避免消息发送到已关闭的旧连接而丢失
    conversationManager.setWebSocket(sessionId, ws);

    // 保存当前会话
    await conversationManager.persistSession(client.sessionId);

    // 恢复目标会话（传入客户端权限模式，确保 YOLO 等模式跨会话持久化）
    const success = await conversationManager.resumeSession(sessionId, client.permissionMode);

    if (success) {
      // 更新客户端会话ID
      client.sessionId = sessionId;

      // 恢复后再次更新 ws（resumeSession 可能从磁盘新建了 SessionState）
      conversationManager.setWebSocket(sessionId, ws);

      // 更新客户端项目路径（从会话元数据中获取）
      const sessionManager = conversationManager.getSessionManager();
      const sessionData = sessionManager.loadSessionById(sessionId);
      if (sessionData?.metadata?.projectPath) {
        client.projectPath = sessionData.metadata.projectPath;
      }

      // 获取会话历史（使用 getLiveHistory：处理中时从 messages 实时构建，确保工具调用中间 turn 不丢失）
      const history = conversationManager.getLiveHistory(sessionId);
      console.log(`[WebSocket] handleSessionSwitch: sessionId=${sessionId}, history.length=${history.length}, isProcessing=${conversationManager.isSessionProcessing(sessionId)}`);

      sendMessage(ws, {
        type: 'session_switched',
        payload: { sessionId, projectPath: client.projectPath },
      });

      sendMessage(ws, {
        type: 'history',
        payload: { messages: history },
      });

      // 同步权限配置到客户端（刷新后客户端 permissionMode 会重置为 'default'，需要从服务端恢复）
      const permConfig = conversationManager.getPermissionConfig(sessionId);
      if (permConfig) {
        sendMessage(ws, {
          type: 'permission_config_update',
          payload: {
            mode: permConfig.mode,
            bypassTools: permConfig.bypassTools,
            alwaysAllow: permConfig.alwaysAllow,
            alwaysDeny: permConfig.alwaysDeny,
          },
        } as any);
      }

      // 如果会话正在处理中（如页面刷新），恢复流式状态
      // 补发 message_start + 已累积的内容，让客户端立即显示已生成的内容
      const isProcessing = conversationManager.isSessionProcessing(sessionId);
      if (isProcessing) {
        const resumeMessageId = `resume-${Date.now()}`;
        // 补发 message_start，客户端收到后会创建 currentMessageRef
        sendMessage(ws, {
          type: 'message_start',
          payload: { messageId: resumeMessageId, sessionId },
        });

        // 获取已累积的流式中间内容，补发给客户端
        // 这样用户刷新后能立即看到 API 已经生成的内容，而不是空气泡
        const streamingContent = conversationManager.getStreamingContent(sessionId);
        if (streamingContent) {
          // 补发 thinking 内容（如果有）
          if (streamingContent.thinkingText) {
            sendMessage(ws, {
              type: 'thinking_start',
              payload: { messageId: resumeMessageId, sessionId },
            });
            sendMessage(ws, {
              type: 'thinking_delta',
              payload: { messageId: resumeMessageId, text: streamingContent.thinkingText, sessionId },
            });
            // 如果已有 text 内容，说明 thinking 已经结束
            if (streamingContent.textContent) {
              sendMessage(ws, {
                type: 'thinking_complete',
                payload: { messageId: resumeMessageId, sessionId },
              });
            }
          }
          // 补发 text 内容（如果有）
          if (streamingContent.textContent) {
            sendMessage(ws, {
              type: 'text_delta',
              payload: { messageId: resumeMessageId, text: streamingContent.textContent, sessionId },
            });
          }
        }

        sendMessage(ws, {
          type: 'status',
          payload: { status: 'streaming', message: '对话处理中...', sessionId },
        });

        // 重发待处理的权限请求和用户问题
        // 会话正在处理中且被阻塞在等待用户响应时，切换回来后需要重新弹出对话框
        const pendingPermissions = conversationManager.getPendingPermissionRequests(sessionId);
        for (const req of pendingPermissions) {
          sendMessage(ws, {
            type: 'permission_request',
            payload: { ...req, sessionId },
          });
          console.log(`[WebSocket] 重发待处理权限请求: ${req.tool} (${req.requestId})`);
        }

        const pendingQuestions = conversationManager.getPendingUserQuestions(sessionId);
        for (const q of pendingQuestions) {
          sendMessage(ws, {
            type: 'user_question',
            payload: { ...q, sessionId },
          } as any);
          console.log(`[WebSocket] 重发待处理用户问题: ${q.header} (${q.requestId})`);
        }
      } else if (conversationManager.needsContinuation(sessionId)) {
        // SelfEvolve 重启等场景：工具结果已保存但模型还没来得及继续回复
        // 自动触发对话继续，让模型接着上次中断的地方回复
        console.log(`[WebSocket] 会话 ${sessionId} 需要继续对话（最后一条是 tool_result），自动触发`);

        const continueMessageId = randomUUID();
        const chatSessionId = sessionId;
        const getActiveWs = (): WebSocket => {
          return conversationManager.getWebSocket(chatSessionId) || ws;
        };

        sendMessage(getActiveWs(), {
          type: 'message_start',
          payload: { messageId: continueMessageId, sessionId: chatSessionId },
        });
        sendMessage(getActiveWs(), {
          type: 'status',
          payload: { status: 'thinking', sessionId: chatSessionId },
        });

        // 异步触发，不阻塞 handleSessionSwitch 返回
        conversationManager.continueAfterRestore(chatSessionId, {
          onThinkingStart: () => {
            sendMessage(getActiveWs(), {
              type: 'thinking_start',
              payload: { messageId: continueMessageId, sessionId: chatSessionId },
            });
          },
          onThinkingDelta: (text: string) => {
            sendMessage(getActiveWs(), {
              type: 'thinking_delta',
              payload: { messageId: continueMessageId, text, sessionId: chatSessionId },
            });
          },
          onThinkingComplete: () => {
            sendMessage(getActiveWs(), {
              type: 'thinking_complete',
              payload: { messageId: continueMessageId, sessionId: chatSessionId },
            });
          },
          onTextDelta: (text: string) => {
            sendMessage(getActiveWs(), {
              type: 'text_delta',
              payload: { messageId: continueMessageId, text, sessionId: chatSessionId },
            });
          },
          onToolUseStart: (toolUseId: string, toolName: string, input: unknown) => {
            sendMessage(getActiveWs(), {
              type: 'tool_use_start',
              payload: { messageId: continueMessageId, toolUseId, toolName, input, sessionId: chatSessionId },
            });
            sendMessage(getActiveWs(), {
              type: 'status',
              payload: { status: 'tool_executing', message: `执行 ${toolName}...`, sessionId: chatSessionId },
            });
          },
          onToolUseDelta: (toolUseId: string, partialJson: string) => {
            sendMessage(getActiveWs(), {
              type: 'tool_use_delta',
              payload: { toolUseId, partialJson, sessionId: chatSessionId },
            });
          },
          onToolResult: (toolUseId: string, success: boolean, output?: string, error?: string, data?: unknown) => {
            sendMessage(getActiveWs(), {
              type: 'tool_result',
              payload: {
                toolUseId,
                success,
                output,
                error,
                data: data as any,
                defaultCollapsed: true,
                sessionId: chatSessionId,
              },
            });
          },
          onPermissionRequest: (request: any) => {
            sendMessage(getActiveWs(), {
              type: 'permission_request',
              payload: { ...request, sessionId: chatSessionId },
            });
          },
          onComplete: async (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => {
            await conversationManager.persistSession(chatSessionId);
            sendMessage(getActiveWs(), {
              type: 'message_complete',
              payload: {
                messageId: continueMessageId,
                stopReason: (stopReason || 'end_turn') as 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use',
                usage,
                sessionId: chatSessionId,
              },
            });
            sendMessage(getActiveWs(), {
              type: 'status',
              payload: { status: 'idle', sessionId: chatSessionId },
            });
          },
          onError: (error: Error) => {
            sendMessage(getActiveWs(), {
              type: 'error',
              payload: { message: error.message, sessionId: chatSessionId },
            });
            sendMessage(getActiveWs(), {
              type: 'status',
              payload: { status: 'idle', sessionId: chatSessionId },
            });
          },
          onContextUpdate: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => {
            sendMessage(getActiveWs(), {
              type: 'context_update',
              payload: { ...usage, sessionId: chatSessionId },
            });
          },
          onContextCompact: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => {
            sendMessage(getActiveWs(), {
              type: 'context_compact',
              payload: { phase, ...info, sessionId: chatSessionId },
            });
            if (phase === 'start') {
              sendMessage(getActiveWs(), {
                type: 'status',
                payload: { status: 'thinking', message: '正在压缩上下文...', sessionId: chatSessionId },
              });
            }
          },
        }).catch((err) => {
          console.error(`[WebSocket] 自动继续对话失败:`, err);
          sendMessage(getActiveWs(), {
            type: 'error',
            payload: { message: '自动继续对话失败: ' + (err instanceof Error ? err.message : String(err)), sessionId: chatSessionId },
          });
          sendMessage(getActiveWs(), {
            type: 'status',
            payload: { status: 'idle', sessionId: chatSessionId },
          });
        });
      }
    } else {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '会话不存在或加载失败',
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 切换会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '切换会话失败',
      },
    });
  }
}

/**
 * 处理删除会话请求
 */
async function handleSessionDelete(
  client: ClientConnection,
  sessionId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const success = conversationManager.deletePersistedSession(sessionId);

    sendMessage(ws, {
      type: 'session_deleted',
      payload: {
        sessionId,
        success,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 删除会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '删除会话失败',
      },
    });
  }
}

/**
 * 处理重命名会话请求
 */
async function handleSessionRename(
  client: ClientConnection,
  sessionId: string,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const success = conversationManager.renamePersistedSession(sessionId, name);

    sendMessage(ws, {
      type: 'session_renamed',
      payload: {
        sessionId,
        name,
        success,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 重命名会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '重命名会话失败',
      },
    });
  }
}

/**
 * 处理导出会话请求
 */
async function handleSessionExport(
  client: ClientConnection,
  sessionId: string,
  format: 'json' | 'md' | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const exportFormat = format || 'json';
    const content = conversationManager.exportPersistedSession(sessionId, exportFormat);

    if (content) {
      sendMessage(ws, {
        type: 'session_exported',
        payload: {
          sessionId,
          content,
          format: exportFormat,
        },
      });
    } else {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '会话不存在或导出失败',
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 导出会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '导出会话失败',
      },
    });
  }
}

/**
 * 处理恢复会话请求
 */
async function handleSessionResume(
  client: ClientConnection,
  sessionId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const success = await conversationManager.resumeSession(sessionId, client.permissionMode);

    if (success) {
      client.sessionId = sessionId;

      // 重要：更新会话的 WebSocket 连接，确保 UserInteractionHandler 和 TaskManager 使用新连接
      conversationManager.setWebSocket(sessionId, ws);

      const history = conversationManager.getHistory(sessionId);

      sendMessage(ws, {
        type: 'session_switched',
        payload: { sessionId },
      });

      sendMessage(ws, {
        type: 'history',
        payload: { messages: history },
      });
    } else {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '会话不存在或恢复失败',
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 恢复会话失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '恢复会话失败',
      },
    });
  }
}

/**
 * 处理工具过滤更新请求
 */
async function handleToolFilterUpdate(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, sessionId } = client;

  try {
    const { config } = payload;

    if (!config || !config.mode) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '无效的工具过滤配置',
        },
      });
      return;
    }

    conversationManager.updateToolFilter(sessionId, config);

    sendMessage(ws, {
      type: 'tool_filter_updated',
      payload: {
        success: true,
        config,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 更新工具过滤配置失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '更新工具过滤配置失败',
      },
    });
  }
}

/**
 * 处理获取工具列表请求
 */
async function handleToolListGet(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, sessionId } = client;

  try {
    const tools = conversationManager.getAvailableTools(sessionId);

    // 获取当前会话的工具过滤配置
    const config = conversationManager.getToolFilterConfig(sessionId);

    sendMessage(ws, {
      type: 'tool_list_response',
      payload: {
        tools,
        config,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取工具列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取工具列表失败',
      },
    });
  }
}

/**
 * 处理系统提示更新请求
 */
async function handleSystemPromptUpdate(
  client: ClientConnection,
  config: import('../shared/types.js').SystemPromptConfig,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const success = conversationManager.updateSystemPrompt(client.sessionId, config);

    if (success) {
      // 获取更新后的完整提示
      const result = await conversationManager.getSystemPrompt(client.sessionId);
      sendMessage(ws, {
        type: 'system_prompt_response',
        payload: result,
      });
    } else {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '更新系统提示失败',
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 更新系统提示失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '更新系统提示失败',
      },
    });
  }
}

/**
 * 处理获取系统提示请求
 */
async function handleSystemPromptGet(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const result = await conversationManager.getSystemPrompt(client.sessionId);

    sendMessage(ws, {
      type: 'system_prompt_response',
      payload: result,
    });
  } catch (error) {
    console.error('[WebSocket] 获取系统提示失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取系统提示失败',
      },
    });
  }
}


// ============================================================================
// Prompt Snippets 处理函数
// ============================================================================

function handlePromptSnippetsList(client: ClientConnection): void {
  const { ws } = client;
  try {
    const snippets = promptSnippetsManager.list();
    sendMessage(ws, {
      type: 'prompt_snippets_response',
      payload: { snippets },
    });
  } catch (error) {
    sendMessage(ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '获取提示词片段失败' },
    });
  }
}

function handlePromptSnippetsCreate(client: ClientConnection, input: PromptSnippetCreateInput): void {
  const { ws } = client;
  try {
    const snippet = promptSnippetsManager.create(input);
    sendMessage(ws, {
      type: 'prompt_snippets_response',
      payload: { snippets: promptSnippetsManager.list(), created: snippet },
    });
  } catch (error) {
    sendMessage(ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '创建提示词片段失败' },
    });
  }
}

function handlePromptSnippetsUpdate(client: ClientConnection, id: string, input: PromptSnippetUpdateInput): void {
  const { ws } = client;
  try {
    const updated = promptSnippetsManager.update(id, input);
    if (!updated) {
      sendMessage(ws, { type: 'error', payload: { message: `片段 ${id} 不存在` } });
      return;
    }
    sendMessage(ws, {
      type: 'prompt_snippets_response',
      payload: { snippets: promptSnippetsManager.list(), updated },
    });
  } catch (error) {
    sendMessage(ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '更新提示词片段失败' },
    });
  }
}

function handlePromptSnippetsDelete(client: ClientConnection, id: string): void {
  const { ws } = client;
  try {
    const success = promptSnippetsManager.delete(id);
    if (!success) {
      sendMessage(ws, { type: 'error', payload: { message: `片段 ${id} 不存在` } });
      return;
    }
    sendMessage(ws, {
      type: 'prompt_snippets_response',
      payload: { snippets: promptSnippetsManager.list(), deleted: id },
    });
  } catch (error) {
    sendMessage(ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '删除提示词片段失败' },
    });
  }
}

function handlePromptSnippetsToggle(client: ClientConnection, id: string): void {
  const { ws } = client;
  try {
    const toggled = promptSnippetsManager.toggle(id);
    if (!toggled) {
      sendMessage(ws, { type: 'error', payload: { message: `片段 ${id} 不存在` } });
      return;
    }
    sendMessage(ws, {
      type: 'prompt_snippets_response',
      payload: { snippets: promptSnippetsManager.list(), toggled },
    });
  } catch (error) {
    sendMessage(ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '切换提示词片段失败' },
    });
  }
}

function handlePromptSnippetsReorder(client: ClientConnection, orders: Array<{ id: string; priority: number }>): void {
  const { ws } = client;
  try {
    for (const { id, priority } of orders) {
      promptSnippetsManager.update(id, { priority });
    }
    sendMessage(ws, {
      type: 'prompt_snippets_response',
      payload: { snippets: promptSnippetsManager.list() },
    });
  } catch (error) {
    sendMessage(ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '排序提示词片段失败' },
    });
  }
}


/**
 * 处理调试消息请求（探针功能）
 */
async function handleDebugGetMessages(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const result = await conversationManager.getDebugMessages(client.sessionId);

    sendMessage(ws, {
      type: 'debug_messages_response',
      payload: result,
    });
  } catch (error) {
    console.error('[WebSocket] 获取调试消息失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取调试消息失败',
      },
    });
  }
}

/**
 * 处理任务列表请求
 */
async function handleTaskList(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, sessionId } = client;

  try {
    const taskManager = conversationManager.getTaskManager(sessionId);
    if (!taskManager) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '任务管理器未初始化',
        },
      });
      return;
    }

    const statusFilter = payload?.statusFilter;
    const includeCompleted = payload?.includeCompleted !== false;

    let tasks = taskManager.listTasks();

    // 过滤任务
    if (statusFilter) {
      tasks = tasks.filter(t => t.status === statusFilter);
    }

    if (!includeCompleted) {
      tasks = tasks.filter(t => t.status !== 'completed');
    }

    // 转换为任务摘要
    const taskSummaries = tasks.map(task => ({
      id: task.id,
      description: task.description,
      agentType: task.agentType,
      status: task.status,
      startTime: task.startTime.getTime(),
      endTime: task.endTime?.getTime(),
      progress: task.progress,
    }));

    sendMessage(ws, {
      type: 'task_list_response',
      payload: {
        tasks: taskSummaries,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取任务列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取任务列表失败',
      },
    });
  }
}

/**
 * 处理取消任务请求
 */
async function handleTaskCancel(
  client: ClientConnection,
  taskId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, sessionId } = client;

  try {
    const taskManager = conversationManager.getTaskManager(sessionId);
    if (!taskManager) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '任务管理器未初始化',
        },
      });
      return;
    }

    const success = taskManager.cancelTask(taskId);

    sendMessage(ws, {
      type: 'task_cancelled',
      payload: {
        taskId,
        success,
      },
    });

    // 如果成功取消，发送状态更新
    if (success) {
      const task = taskManager.getTask(taskId);
      if (task) {
        sendMessage(ws, {
          type: 'task_status',
          payload: {
            taskId: task.id,
            status: task.status,
            error: task.error,
          },
        });
      }
    }
  } catch (error) {
    console.error('[WebSocket] 取消任务失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '取消任务失败',
      },
    });
  }
}

/**
 * 处理任务输出请求
 */
async function handleTaskOutput(
  client: ClientConnection,
  taskId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws, sessionId } = client;

  try {
    const taskManager = conversationManager.getTaskManager(sessionId);
    if (!taskManager) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '任务管理器未初始化',
        },
      });
      return;
    }

    const task = taskManager.getTask(taskId);
    if (!task) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: `任务 ${taskId} 不存在`,
        },
      });
      return;
    }

    const output = taskManager.getTaskOutput(taskId);

    sendMessage(ws, {
      type: 'task_output_response',
      payload: {
        taskId: task.id,
        output,
        status: task.status,
        error: task.error,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取任务输出失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取任务输出失败',
      },
    });
  }
}

/**
 * 处理获取API状态请求
 */
async function handleApiStatus(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const status = await apiManager.getStatus();

    sendMessage(ws, {
      type: 'api_status_response',
      payload: status,
    });
  } catch (error) {
    console.error('[WebSocket] 获取API状态失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取API状态失败',
      },
    });
  }
}

/**
 * 处理API连接测试请求
 */
async function handleApiTest(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const result = await apiManager.testConnection();

    sendMessage(ws, {
      type: 'api_test_response',
      payload: result,
    });
  } catch (error) {
    console.error('[WebSocket] API测试失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'API测试失败',
      },
    });
  }
}

/**
 * 处理获取模型列表请求
 */
async function handleApiModels(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const models = await apiManager.getAvailableModels();

    sendMessage(ws, {
      type: 'api_models_response',
      payload: { models },
    });
  } catch (error) {
    console.error('[WebSocket] 获取模型列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取模型列表失败',
      },
    });
  }
}

/**
 * 处理获取Provider信息请求
 */
async function handleApiProvider(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const info = apiManager.getProviderInfo();

    sendMessage(ws, {
      type: 'api_provider_response',
      payload: info,
    });
  } catch (error) {
    console.error('[WebSocket] 获取Provider信息失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取Provider信息失败',
      },
    });
  }
}

/**
 * 处理获取Token状态请求
 */
async function handleApiTokenStatus(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const status = apiManager.getTokenStatus();

    sendMessage(ws, {
      type: 'api_token_status_response',
      payload: status,
    });
  } catch (error) {
    console.error('[WebSocket] 获取Token状态失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取Token状态失败',
      },
    });
  }
}

/**
 * 处理 MCP 服务器列表请求
 */
async function handleMcpList(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const servers = conversationManager.listMcpServers();

    sendMessage(ws, {
      type: 'mcp_list_response',
      payload: {
        servers,
        total: servers.length,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取 MCP 服务器列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取 MCP 服务器列表失败',
      },
    });
  }
}

/**
 * 处理 MCP 服务器添加请求
 */
async function handleMcpAdd(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const { server } = payload;

    if (!server || !server.name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '无效的 MCP 服务器配置：缺少名称',
        },
      });
      return;
    }

    const success = await conversationManager.addMcpServer(server.name, server);

    if (success) {
      sendMessage(ws, {
        type: 'mcp_server_added',
        payload: {
          success: true,
          name: server.name,
          server,
        },
      });

      // 同时发送更新后的列表
      const servers = conversationManager.listMcpServers();
      sendMessage(ws, {
        type: 'mcp_list_response',
        payload: {
          servers,
          total: servers.length,
        },
      });
    } else {
      sendMessage(ws, {
        type: 'mcp_server_added',
        payload: {
          success: false,
          name: server.name,
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 添加 MCP 服务器失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '添加 MCP 服务器失败',
      },
    });
  }
}

/**
 * 处理 MCP 服务器删除请求
 */
async function handleMcpRemove(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const { name } = payload;

    if (!name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少服务器名称',
        },
      });
      return;
    }

    const success = await conversationManager.removeMcpServer(name);

    sendMessage(ws, {
      type: 'mcp_server_removed',
      payload: {
        success,
        name,
      },
    });

    if (success) {
      // 同时发送更新后的列表
      const servers = conversationManager.listMcpServers();
      sendMessage(ws, {
        type: 'mcp_list_response',
        payload: {
          servers,
          total: servers.length,
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 删除 MCP 服务器失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '删除 MCP 服务器失败',
      },
    });
  }
}

/**
 * 处理 MCP 服务器切换请求
 */
async function handleMcpToggle(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const { name, enabled } = payload;

    if (!name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少服务器名称',
        },
      });
      return;
    }

    const result = await conversationManager.toggleMcpServer(name, enabled);

    sendMessage(ws, {
      type: 'mcp_server_toggled',
      payload: {
        success: result.success,
        name,
        enabled: result.enabled,
      },
    });

    if (result.success) {
      // 同时发送更新后的列表
      const servers = conversationManager.listMcpServers();
      sendMessage(ws, {
        type: 'mcp_list_response',
        payload: {
          servers,
          total: servers.length,
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 切换 MCP 服务器失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '切换 MCP 服务器失败',
      },
    });
  }
}

/**
 * 处理系统诊断请求
 */
async function handleDoctorRun(
  client: ClientConnection,
  payload?: { verbose?: boolean; includeSystemInfo?: boolean }
): Promise<void> {
  const { ws } = client;

  try {
    const { runDiagnostics, formatDoctorReport } = await import('./doctor.js');

    const options = {
      verbose: payload?.verbose || false,
      includeSystemInfo: payload?.includeSystemInfo ?? true,
    };

    const report = await runDiagnostics(options);
    const formattedText = formatDoctorReport(report, options.verbose);

    sendMessage(ws, {
      type: 'doctor_result',
      payload: {
        report: {
          ...report,
          timestamp: report.timestamp.getTime(),
        },
        formattedText,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 运行诊断失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '运行诊断失败',
      },
    });
  }
}

// ============ 检查点相关处理函数 ============

/**
 * 处理创建检查点请求
 */
async function handleCheckpointCreate(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const { description, filePaths, workingDirectory, tags } = payload;

    if (!description || !filePaths || filePaths.length === 0) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '创建检查点需要提供描述和文件列表',
        },
      });
      return;
    }

    const checkpoint = await getCheckpointManager().createCheckpoint(
      description,
      filePaths,
      workingDirectory,
      { tags }
    );

    console.log(`[WebSocket] 创建检查点: ${checkpoint.id} (${checkpoint.files.length} 个文件)`);

    sendMessage(ws, {
      type: 'checkpoint_created',
      payload: {
        checkpointId: checkpoint.id,
        timestamp: checkpoint.timestamp.getTime(),
        description: checkpoint.description,
        fileCount: checkpoint.files.length,
        totalSize: checkpoint.files.reduce((sum, f) => sum + f.size, 0),
      },
    });
  } catch (error) {
    console.error('[WebSocket] 创建检查点失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '创建检查点失败',
      },
    });
  }
}

/**
 * 处理检查点列表请求
 */
async function handleCheckpointList(
  client: ClientConnection,
  payload: any,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const limit = payload?.limit;
    const sortBy = payload?.sortBy || 'timestamp';
    const sortOrder = payload?.sortOrder || 'desc';

    const checkpoints = getCheckpointManager().listCheckpoints({
      limit,
      sortBy,
      sortOrder,
    });

    const stats = getCheckpointManager().getStats();

    const checkpointSummaries = checkpoints.map(cp => ({
      id: cp.id,
      timestamp: cp.timestamp.getTime(),
      description: cp.description,
      fileCount: cp.files.length,
      totalSize: cp.files.reduce((sum, f) => sum + f.size, 0),
      workingDirectory: cp.workingDirectory,
      tags: cp.metadata?.tags,
    }));

    sendMessage(ws, {
      type: 'checkpoint_list_response',
      payload: {
        checkpoints: checkpointSummaries,
        total: checkpointSummaries.length,
        stats: {
          totalFiles: stats.totalFiles,
          totalSize: stats.totalSize,
          oldest: stats.oldest?.getTime(),
          newest: stats.newest?.getTime(),
        },
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取检查点列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取检查点列表失败',
      },
    });
  }
}

/**
 * 处理恢复检查点请求
 */
async function handleCheckpointRestore(
  client: ClientConnection,
  checkpointId: string,
  dryRun: boolean | undefined,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!checkpointId) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少检查点 ID',
        },
      });
      return;
    }

    const result = await getCheckpointManager().restoreCheckpoint(checkpointId, {
      dryRun: dryRun || false,
      skipBackup: false,
    });

    console.log(
      `[WebSocket] ${dryRun ? '模拟' : ''}恢复检查点: ${checkpointId} ` +
      `(成功: ${result.restored.length}, 失败: ${result.failed.length})`
    );

    sendMessage(ws, {
      type: 'checkpoint_restored',
      payload: {
        checkpointId,
        success: result.success,
        restored: result.restored,
        failed: result.failed,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 恢复检查点失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '恢复检查点失败',
      },
    });
  }
}

/**
 * 处理删除检查点请求
 */
async function handleCheckpointDelete(
  client: ClientConnection,
  checkpointId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!checkpointId) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少检查点 ID',
        },
      });
      return;
    }

    const success = getCheckpointManager().deleteCheckpoint(checkpointId);

    console.log(`[WebSocket] 删除检查点: ${checkpointId} (${success ? '成功' : '失败'})`);

    sendMessage(ws, {
      type: 'checkpoint_deleted',
      payload: {
        checkpointId,
        success,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 删除检查点失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '删除检查点失败',
      },
    });
  }
}

/**
 * 处理检查点差异请求
 */
async function handleCheckpointDiff(
  client: ClientConnection,
  checkpointId: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!checkpointId) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少检查点 ID',
        },
      });
      return;
    }

    const diffs = await getCheckpointManager().diffCheckpoint(checkpointId);

    const stats = {
      added: diffs.filter(d => d.type === 'added').length,
      removed: diffs.filter(d => d.type === 'removed').length,
      modified: diffs.filter(d => d.type === 'modified').length,
      unchanged: diffs.filter(d => d.type === 'unchanged').length,
    };

    console.log(
      `[WebSocket] 比较检查点: ${checkpointId} ` +
      `(添加: ${stats.added}, 删除: ${stats.removed}, 修改: ${stats.modified}, 未变: ${stats.unchanged})`
    );

    sendMessage(ws, {
      type: 'checkpoint_diff_response',
      payload: {
        checkpointId,
        diffs,
        stats,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 比较检查点失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '比较检查点失败',
      },
    });
  }
}

/**
 * 处理清除所有检查点请求
 */
async function handleCheckpointClear(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const count = getCheckpointManager().clearCheckpoints();

    console.log(`[WebSocket] 清除所有检查点: ${count} 个`);

    sendMessage(ws, {
      type: 'checkpoint_cleared',
      payload: {
        count,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 清除检查点失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '清除检查点失败',
      },
    });
  }
}

// ============ 插件相关处理函数 ============

/**
 * 处理插件列表请求
 */
async function handlePluginList(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const plugins = await conversationManager.listPlugins();

    sendMessage(ws, {
      type: 'plugin_list_response',
      payload: {
        plugins,
        total: plugins.length,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取插件列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取插件列表失败',
      },
    });
  }
}

/**
 * 处理插件发现请求（获取 marketplace + 可用插件列表）
 */
async function handlePluginDiscover(
  client: ClientConnection,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const data = await conversationManager.discoverMarketplacePlugins();

    sendMessage(ws, {
      type: 'plugin_discover_response',
      payload: data,
    });
  } catch (error) {
    console.error('[WebSocket] 获取插件市场数据失败:', error);
    sendMessage(ws, {
      type: 'plugin_discover_response',
      payload: {
        marketplaces: [],
        availablePlugins: [],
      },
    });
  }
}

/**
 * 处理插件详情请求
 */
async function handlePluginInfo(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少插件名称',
        },
      });
      return;
    }

    const plugin = await conversationManager.getPluginInfo(name);

    sendMessage(ws, {
      type: 'plugin_info_response',
      payload: {
        plugin,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取插件详情失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取插件详情失败',
      },
    });
  }
}

/**
 * 处理启用插件请求
 */
async function handlePluginEnable(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少插件名称',
        },
      });
      return;
    }

    const success = await conversationManager.enablePlugin(name);

    sendMessage(ws, {
      type: 'plugin_enabled',
      payload: {
        name,
        success,
      },
    });

    // 发送更新后的插件列表
    if (success) {
      const plugins = await conversationManager.listPlugins();
      sendMessage(ws, {
        type: 'plugin_list_response',
        payload: {
          plugins,
          total: plugins.length,
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 启用插件失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '启用插件失败',
      },
    });
  }
}

/**
 * 处理禁用插件请求
 */
async function handlePluginDisable(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少插件名称',
        },
      });
      return;
    }

    const success = await conversationManager.disablePlugin(name);

    sendMessage(ws, {
      type: 'plugin_disabled',
      payload: {
        name,
        success,
      },
    });

    // 发送更新后的插件列表
    if (success) {
      const plugins = await conversationManager.listPlugins();
      sendMessage(ws, {
        type: 'plugin_list_response',
        payload: {
          plugins,
          total: plugins.length,
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 禁用插件失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '禁用插件失败',
      },
    });
  }
}

/**
 * 处理卸载插件请求
 */
/**
 * 处理插件安装
 */
async function handlePluginInstall(
  client: ClientConnection,
  payload: { pluginId?: string; pluginPath?: string },
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    const pluginPath = payload.pluginPath || payload.pluginId;

    if (!pluginPath) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少插件路径或ID',
        },
      });
      return;
    }

    const totalSteps = 4;

    // Step 1: 验证插件
    sendMessage(ws, {
      type: 'plugin_progress',
      payload: { pluginId: pluginPath, step: 1, totalSteps, message: 'Resolving plugin...' },
    });

    // Step 2: 下载/获取插件
    sendMessage(ws, {
      type: 'plugin_progress',
      payload: { pluginId: pluginPath, step: 2, totalSteps, message: 'Downloading plugin...' },
    });

    const result = await conversationManager.installPlugin(pluginPath);

    if (result.success) {
      // Step 3: 安装完成
      sendMessage(ws, {
        type: 'plugin_progress',
        payload: { pluginId: pluginPath, step: 3, totalSteps, message: 'Loading plugin...' },
      });

      // Step 4: 完成
      sendMessage(ws, {
        type: 'plugin_progress',
        payload: { pluginId: pluginPath, step: 4, totalSteps, message: 'Done' },
      });

      sendMessage(ws, {
        type: 'plugin_installed',
        payload: {
          success: true,
          plugin: result.plugin,
        },
      });

      // 发送更新后的插件列表
      const plugins = await conversationManager.listPlugins();
      sendMessage(ws, {
        type: 'plugin_list',
        payload: { plugins },
      });
    } else {
      sendMessage(ws, {
        type: 'plugin_installed',
        payload: {
          success: false,
          error: result.error || '插件安装失败',
        },
      });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[WebSocket] 安装插件失败:', errorMsg);

    sendMessage(ws, {
      type: 'error',
      payload: {
        message: `安装插件失败: ${errorMsg}`,
      },
    });
  }
}

async function handlePluginUninstall(
  client: ClientConnection,
  name: string,
  conversationManager: ConversationManager
): Promise<void> {
  const { ws } = client;

  try {
    if (!name) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少插件名称',
        },
      });
      return;
    }

    const success = await conversationManager.uninstallPlugin(name);

    sendMessage(ws, {
      type: 'plugin_uninstalled',
      payload: {
        name,
        success,
      },
    });

    // 发送更新后的插件列表
    if (success) {
      const plugins = await conversationManager.listPlugins();
      sendMessage(ws, {
        type: 'plugin_list_response',
        payload: {
          plugins,
          total: plugins.length,
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 卸载插件失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '卸载插件失败',
      },
    });
  }
}

// ============ 认证相关处理函数 ============

/**
 * 处理获取认证状态请求
 */
async function handleAuthStatus(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const status = authManager.getAuthStatus();

    sendMessage(ws, {
      type: 'auth_status_response',
      payload: {
        status,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取认证状态失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取认证状态失败',
      },
    });
  }
}

/**
 * 处理设置API密钥请求
 */
async function handleAuthSetKey(
  client: ClientConnection,
  payload: any
): Promise<void> {
  const { ws } = client;

  try {
    const { apiKey } = payload;

    if (!apiKey || typeof apiKey !== 'string') {
      sendMessage(ws, {
        type: 'auth_key_set',
        payload: {
          success: false,
          message: '无效的 API 密钥',
        },
      });
      return;
    }

    const success = authManager.setApiKey(apiKey);

    if (success) {
      sendMessage(ws, {
        type: 'auth_key_set',
        payload: {
          success: true,
          message: 'API 密钥已设置',
        },
      });

      // 同时发送更新后的状态
      const status = authManager.getAuthStatus();
      sendMessage(ws, {
        type: 'auth_status_response',
        payload: {
          status,
        },
      });
    } else {
      sendMessage(ws, {
        type: 'auth_key_set',
        payload: {
          success: false,
          message: '设置 API 密钥失败',
        },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 设置 API 密钥失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '设置 API 密钥失败',
      },
    });
  }
}

/**
 * 处理清除认证请求
 */
async function handleAuthClear(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    authManager.clearAuth();

    sendMessage(ws, {
      type: 'auth_cleared',
      payload: {
        success: true,
      },
    });

    // 同时发送更新后的状态
    const status = authManager.getAuthStatus();
    sendMessage(ws, {
      type: 'auth_status_response',
      payload: {
        status,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 清除认证失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '清除认证失败',
      },
    });
  }
}

/**
 * 处理验证API密钥请求
 */
async function handleAuthValidate(
  client: ClientConnection,
  payload: any
): Promise<void> {
  const { ws } = client;

  try {
    const { apiKey } = payload;

    if (!apiKey || typeof apiKey !== 'string') {
      sendMessage(ws, {
        type: 'auth_validated',
        payload: {
          valid: false,
          message: '无效的 API 密钥格式',
        },
      });
      return;
    }

    const valid = await authManager.validateApiKey(apiKey);

    sendMessage(ws, {
      type: 'auth_validated',
      payload: {
        valid,
        message: valid ? 'API 密钥有效' : 'API 密钥无效',
      },
    });
  } catch (error) {
    console.error('[WebSocket] 验证 API 密钥失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '验证 API 密钥失败',
      },
    });
  }
}

// ============================================================================
// OAuth 相关处理函数
// ============================================================================

/**
 * 处理 OAuth 登录请求（授权码交换）
 */
async function handleOAuthLogin(
  client: ClientConnection,
  payload: any
): Promise<void> {
  const { ws } = client;

  try {
    const { code, redirectUri } = payload;

    if (!code || typeof code !== 'string') {
      sendMessage(ws, {
        type: 'oauth_login_response',
        payload: {
          success: false,
          message: '无效的授权码',
        },
      });
      return;
    }

    if (!redirectUri || typeof redirectUri !== 'string') {
      sendMessage(ws, {
        type: 'oauth_login_response',
        payload: {
          success: false,
          message: '无效的回调 URI',
        },
      });
      return;
    }

    console.log('[WebSocket] 正在交换授权码获取 token...');

    // 使用授权码交换 token
    const token = await oauthManager.exchangeCodeForToken(code, redirectUri);

    sendMessage(ws, {
      type: 'oauth_login_response',
      payload: {
        success: true,
        token,
        message: 'OAuth 登录成功',
      },
    });

    console.log('[WebSocket] OAuth 登录成功');
  } catch (error) {
    console.error('[WebSocket] OAuth 登录失败:', error);
    sendMessage(ws, {
      type: 'oauth_login_response',
      payload: {
        success: false,
        message: error instanceof Error ? error.message : 'OAuth 登录失败',
      },
    });
  }
}

/**
 * 处理 OAuth token 刷新请求
 */
async function handleOAuthRefresh(
  client: ClientConnection,
  payload: any
): Promise<void> {
  const { ws } = client;

  try {
    const { refreshToken } = payload || {};

    console.log('[WebSocket] 正在刷新 OAuth token...');

    // 刷新 token（如果没有提供 refreshToken，从配置读取）
    const token = await oauthManager.refreshToken(refreshToken);

    sendMessage(ws, {
      type: 'oauth_refresh_response',
      payload: {
        success: true,
        token,
        message: 'Token 刷新成功',
      },
    });

    console.log('[WebSocket] OAuth token 刷新成功');
  } catch (error) {
    console.error('[WebSocket] OAuth token 刷新失败:', error);
    sendMessage(ws, {
      type: 'oauth_refresh_response',
      payload: {
        success: false,
        message: error instanceof Error ? error.message : 'Token 刷新失败',
      },
    });
  }
}

/**
 * 处理 OAuth 状态查询请求
 */
async function handleOAuthStatus(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    const config = oauthManager.getOAuthConfig();

    if (!config) {
      sendMessage(ws, {
        type: 'oauth_status_response',
        payload: {
          authenticated: false,
          expired: true,
        },
      });
      return;
    }

    const expired = oauthManager.isTokenExpired();

    sendMessage(ws, {
      type: 'oauth_status_response',
      payload: {
        authenticated: true,
        expired,
        expiresAt: config.expiresAt,
        scopes: config.scopes,
        subscriptionInfo: {
          subscriptionType: config.subscriptionType || 'free',
          rateLimitTier: config.rateLimitTier || 'standard',
          organizationRole: config.organizationRole,
          workspaceRole: config.workspaceRole,
          organizationName: config.organizationName,
          displayName: config.displayName,
          hasExtraUsageEnabled: config.hasExtraUsageEnabled,
        },
      },
    });
  } catch (error) {
    console.error('[WebSocket] 获取 OAuth 状态失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取 OAuth 状态失败',
      },
    });
  }
}

/**
 * 处理 OAuth 登出请求
 */
async function handleOAuthLogout(
  client: ClientConnection
): Promise<void> {
  const { ws } = client;

  try {
    oauthManager.logout();

    sendMessage(ws, {
      type: 'oauth_logout_response',
      payload: {
        success: true,
      },
    });

    console.log('[WebSocket] OAuth 登出成功');
  } catch (error) {
    console.error('[WebSocket] OAuth 登出失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'OAuth 登出失败',
      },
    });
  }
}

/**
 * 处理获取 OAuth 授权 URL 请求
 */
async function handleOAuthGetAuthUrl(
  client: ClientConnection,
  payload: any
): Promise<void> {
  const { ws } = client;

  try {
    const { redirectUri, state } = payload;

    if (!redirectUri || typeof redirectUri !== 'string') {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '无效的回调 URI',
        },
      });
      return;
    }

    const url = oauthManager.generateAuthUrl(redirectUri, state);

    sendMessage(ws, {
      type: 'oauth_auth_url_response',
      payload: {
        url,
      },
    });
  } catch (error) {
    console.error('[WebSocket] 生成 OAuth 授权 URL 失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '生成授权 URL 失败',
      },
    });
  }
}

/**
 * 处理 Office 文档（docx/xlsx/pptx）
 * 对齐官方 document-skills 的实现方式
 *
 * 官网处理方式：
 * 1. 将文档保存到临时目录
 * 2. 在消息中告诉 Claude 有这些文档及其路径
 * 3. Claude 根据需要调用 document-skills 来处理文档
 *
 * 这样的好处是：
 * - Skills 提供完整的文档处理能力（创建、编辑、分析）
 * - Claude 可以根据上下文决定如何处理
 * - 不需要在服务器端实现复杂的解析逻辑
 */
/**
 * 处理非图片文件附件：保存到临时目录，返回文件路径信息
 * 支持任意格式文件
 */
async function processFileAttachment(file: FileAttachment): Promise<string> {
  const { name, data, mimeType } = file;
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  try {
    // 创建临时目录（如果不存在）
    const tempDir = path.join(os.tmpdir(), 'claude-code-uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 生成唯一文件名（避免冲突）
    const timestamp = Date.now();
    const safeFileName = name.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fff]/g, '_');
    const tempFilePath = path.join(tempDir, timestamp + '_' + safeFileName);

    // 将 base64 数据解码并保存到临时文件
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(tempFilePath, buffer);

    console.log('[WebSocket] 文件附件已保存到临时文件: ' + tempFilePath);

    // 根据 MIME 类型或扩展名给出提示
    const ext = path.extname(name).toLowerCase();
    let hint = '';

    // 对已知的文档类型给出 Skill 提示
    const skillMap: Record<string, string> = {
      '.docx': 'document-skills:docx',
      '.xlsx': 'document-skills:xlsx',
      '.pptx': 'document-skills:pptx',
      '.pdf': 'document-skills:pdf',
    };

    if (skillMap[ext]) {
      hint = '\n可使用 Skill: ' + skillMap[ext] + ' 处理此文件';
    } else if (mimeType.startsWith('text/') || /^\.(txt|md|json|js|ts|tsx|jsx|py|java|c|cpp|h|css|html|xml|yaml|yml|sh|bat|sql|log|csv|tsv|ini|cfg|conf|toml|rs|go|rb|php|swift|kt|scala|r|m|pl|lua|hs|ex|exs|clj|dart|vue|svelte)$/i.test(ext)) {
      hint = '\n这是文本文件，可使用 Read 工具直接读取内容';
    }

    return '[附件: ' + name + ']\nMIME: ' + mimeType + '\n文件路径: ' + tempFilePath + hint;
  } catch (error) {
    console.error('[WebSocket] 保存文件附件失败: ' + name, error);
    throw new Error('保存文件附件失败: ' + (error instanceof Error ? error.message : '未知错误'));
  }
}

// ============================================================================
// 蜂群相关处理函数
// ============================================================================

/**
 * 处理蜂群订阅请求
 */
async function handleSwarmSubscribe(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws, id: clientId } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: {
          message: '缺少 blueprintId',
        },
      });
      return;
    }

    // 添加订阅
    if (!swarmSubscriptions.has(blueprintId)) {
      swarmSubscriptions.set(blueprintId, new Set());
    }
    swarmSubscriptions.get(blueprintId)!.add(clientId);
    client.swarmSubscriptions.add(blueprintId);

    console.log(`[Swarm] 客户端 ${clientId} 订阅 blueprint ${blueprintId}`);

    // 发送当前状态
    let blueprint = blueprintManager.getBlueprint(blueprintId);
    if (!blueprint) {
      // v12.1: TaskPlan 模式的 tp- 临时蓝图不存入 BlueprintStore，
      // 但 executionManager 中有活跃 session，从 session 构造最小蓝图对象
      const session = executionManager.getSessionByBlueprint(blueprintId);
      if (session) {
        blueprint = {
          id: blueprintId,
          name: session.blueprintName || 'TaskPlan 执行',
          description: '',
          status: session.completedAt ? 'completed' : 'executing',
          projectPath: session.projectPath,
          createdAt: session.startedAt,
          updatedAt: new Date(),
        };
        console.log(`[Swarm] tp- 临时蓝图 ${blueprintId} 从 executionManager session 恢复`);
      } else {
        sendMessage(ws, {
          type: 'swarm:error',
          payload: {
            blueprintId,
            error: 'Blueprint 不存在',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }

    // v2.0: 不再使用任务树和蜂王，改用 ExecutionPlan 和自治 Worker
    // 获取当前活跃的 Workers（如果有）
    const workers = agentCoordinator.getWorkers?.() || [];
    const activeWorkers = workers.filter((w: any) => w.blueprintId === blueprintId);

    // v2.0: 获取执行计划和实时状态
    let executionPlanData = null;
    let statsData = null;
    let costEstimateData = null;

    const session = executionManager.getSessionByBlueprint(blueprintId);
    if (session) {
      // 活跃 session：从 coordinator 获取实时数据
      const plan = session.plan;
      const status = session.coordinator.getStatus() as any;
      const tasksWithStatus = session.coordinator.getTasksWithStatus();
      // v2.2: 获取 issues，将错误信息附加到对应任务
      const issues = status?.issues || [];
      const issuesByTask = new Map<string, string>();
      for (const issue of issues) {
        if (issue.type === 'error' && !issue.resolved && issue.taskId) {
          issuesByTask.set(issue.taskId, issue.description);
        }
      }

      // 序列化任务
      const serializedTasks = tasksWithStatus.map((task: any) => {
        // v2.2: 检查是否有未解决的 issue 错误
        const issueError = issuesByTask.get(task.id);
        return {
          ...task,
          startedAt: task.startedAt instanceof Date ? task.startedAt.toISOString() : task.startedAt,
          completedAt: task.completedAt instanceof Date ? task.completedAt.toISOString() : task.completedAt,
          // v2.2: 优先使用 issue 中的错误信息
          error: issueError || task.error,
          result: task.result ? {
            success: task.result.success,
            testsRan: task.result.testsRan,
            testsPassed: task.result.testsPassed,
            error: task.result.error || issueError,
          } : (issueError ? { success: false, error: issueError } : undefined),
        };
      });

      // 推断计划状态
      const inferredStatus = status
        ? (status.completedTasks === status.totalTasks && status.totalTasks > 0 ? 'completed' :
           status.failedTasks > 0 ? 'failed' :
           status.runningTasks > 0 ? 'executing' : 'ready')
        : 'ready';

      executionPlanData = {
        id: plan.id,
        blueprintId: plan.blueprintId,
        tasks: serializedTasks,
        parallelGroups: plan.parallelGroups || [],
        estimatedCost: plan.estimatedCost || 0,
        estimatedMinutes: plan.estimatedMinutes || 0,
        autoDecisions: plan.autoDecisions || [],
        status: inferredStatus,
        createdAt: session.startedAt.toISOString(),
        startedAt: session.startedAt.toISOString(),
        completedAt: session.completedAt?.toISOString(),
      };

      // 计算统计数据
      if (status) {
        statsData = {
          totalTasks: status.totalTasks,
          pendingTasks: status.totalTasks - status.completedTasks - status.failedTasks - status.runningTasks,
          runningTasks: status.runningTasks,
          completedTasks: status.completedTasks,
          failedTasks: status.failedTasks,
          skippedTasks: 0,
          progressPercentage: status.totalTasks > 0
            ? Math.round((status.completedTasks / status.totalTasks) * 100)
            : 0,
        };

        costEstimateData = {
          totalEstimated: status.estimatedTotalCost || plan.estimatedCost || 0,
          currentSpent: status.currentCost || 0,
          remainingEstimated: (status.estimatedTotalCost || 0) - (status.currentCost || 0),
          breakdown: [],
        };
      }
    } else {
      // v2.1: 无活跃 session 时，从蓝图的 lastExecutionPlan 读取历史数据
      if (blueprint.lastExecutionPlan) {
        executionPlanData = blueprint.lastExecutionPlan;
        // 从历史计划中计算统计数据
        const tasks = blueprint.lastExecutionPlan.tasks || [];
        const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
        const failedTasks = tasks.filter((t: any) => t.status === 'failed').length;
        const runningTasks = tasks.filter((t: any) => t.status === 'running').length;
        statsData = {
          totalTasks: tasks.length,
          pendingTasks: tasks.length - completedTasks - failedTasks - runningTasks,
          runningTasks,
          completedTasks,
          failedTasks,
          skippedTasks: tasks.filter((t: any) => t.status === 'skipped').length,
          progressPercentage: tasks.length > 0
            ? Math.round((completedTasks / tasks.length) * 100)
            : 0,
        };
        costEstimateData = {
          totalEstimated: blueprint.lastExecutionPlan.estimatedCost || 0,
          currentSpent: 0,
          remainingEstimated: 0,
          breakdown: [],
        };
      }
    }

    // v4.8: 获取当前 E2E 测试状态（用于刷新浏览器后恢复）
    const e2eState = activeE2EState.get(blueprintId);
    let verificationData = null;
    if (e2eState) {
      verificationData = {
        status: e2eState.status,
        e2eTaskId: e2eState.e2eTaskId,
        result: e2eState.result,
      };
      console.log(`[Swarm] 恢复 E2E 测试状态: ${e2eState.status}, taskId=${e2eState.e2eTaskId}`);
    }

    // v9.2: 获取当前 LeadAgent 状态（用于刷新浏览器后恢复）
    const leadAgentPersist = activeLeadAgentState.get(blueprintId);
    let leadAgentData = null;
    if (leadAgentPersist && leadAgentPersist.phase !== 'idle') {
      leadAgentData = {
        phase: leadAgentPersist.phase,
        stream: leadAgentPersist.stream,
        events: leadAgentPersist.events,
        systemPrompt: leadAgentPersist.systemPrompt,
        lastUpdated: leadAgentPersist.lastUpdated,
      };
      console.log(`[Swarm] 恢复 LeadAgent 状态: phase=${leadAgentPersist.phase}, stream=${leadAgentPersist.stream.length} blocks, events=${leadAgentPersist.events.length}`);
    }

    // v2.0: 构建完整的响应
    sendMessage(ws, {
      type: 'swarm:state',
      payload: {
        blueprint: serializeBlueprint(blueprint),
        // v2.0: 任务树已废弃，改用 ExecutionPlan
        taskTree: null,
        // v2.0: 蜂王已废弃，Worker 自治
        queen: null,
        // v2.0: 自治 Worker 列表
        workers: activeWorkers.map(serializeWorker),
        // v2.0: 统计数据
        stats: statsData,
        // v2.0 核心字段：执行计划（现在包含实时状态）
        executionPlan: executionPlanData,
        gitBranches: [],     // 串行执行模式，不使用独立分支
        costEstimate: costEstimateData,
        // v4.8: E2E 验收测试状态（用于刷新浏览器后恢复上下文）
        verification: verificationData,
        // v9.2: LeadAgent 状态（用于刷新浏览器后恢复上下文）
        leadAgent: leadAgentData,
      },
    });
  } catch (error) {
    console.error('[Swarm] 订阅失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '订阅失败',
      },
    });
  }
}

/**
 * 处理蜂群取消订阅请求
 */
async function handleSwarmUnsubscribe(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { id: clientId } = client;

  try {
    if (!blueprintId) {
      return;
    }

    // 移除订阅
    const subscribers = swarmSubscriptions.get(blueprintId);
    if (subscribers) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        swarmSubscriptions.delete(blueprintId);
      }
    }
    client.swarmSubscriptions.delete(blueprintId);

    console.log(`[Swarm] 客户端 ${clientId} 取消订阅 blueprint ${blueprintId}`);
  } catch (error) {
    console.error('[Swarm] 取消订阅失败:', error);
  }
}

// ============================================================================
// 序列化函数（将后端类型转换为前端类型）
// ============================================================================

/**
 * 序列化 Blueprint（V2.0）
 * 处理 createdAt/updatedAt 可能是 Date 或 string 的情况
 */
function serializeBlueprint(blueprint: any): any {
  const toISOString = (value: Date | string | undefined): string => {
    if (!value) return new Date().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    return new Date().toISOString();
  };

  return {
    id: blueprint.id,
    name: blueprint.name,
    description: blueprint.description,
    requirement: blueprint.requirement,
    createdAt: toISOString(blueprint.createdAt),
    updatedAt: toISOString(blueprint.updatedAt),
    status: mapBlueprintStatus(blueprint.status),
    // v5.0: 蜂群共享记忆（用于前端可视化）
    swarmMemory: blueprint.swarmMemory || null,
  };
}

/**
 * 映射 Blueprint 状态
 */
function mapBlueprintStatus(status: string): 'pending' | 'running' | 'paused' | 'completed' | 'failed' {
  switch (status) {
    case 'draft':
    case 'pending':
    case 'approved':
    case 'review':
      return 'pending';
    case 'executing':
      return 'running';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'modified':
      return 'paused'; // 修改后的蓝图暂停执行
    default:
      return 'pending';
  }
}

/**
 * 序列化 TaskTree
 */
function serializeTaskTree(taskTree: any): any {
  return {
    id: taskTree.id,
    blueprintId: taskTree.blueprintId,
    root: serializeTaskNode(taskTree.root),
    stats: taskTree.stats,
    createdAt: taskTree.createdAt?.toISOString() || new Date().toISOString(),
    updatedAt: (taskTree.completedAt || taskTree.startedAt || taskTree.createdAt)?.toISOString() || new Date().toISOString(),
  };
}

/**
 * 序列化 TaskNode
 */
function serializeTaskNode(task: TaskNode): any {
  const createdAt = task.createdAt instanceof Date
    ? task.createdAt.toISOString()
    : (task.createdAt || new Date().toISOString());
  const updatedAt = task.completedAt instanceof Date
    ? task.completedAt.toISOString()
    : (task.startedAt instanceof Date ? task.startedAt.toISOString() : createdAt);

  return {
    id: task.id,
    title: task.name,
    description: task.description,
    status: mapTaskStatus(task.status),
    assignedTo: task.agentId || null,
    dependencies: task.dependencies,
    children: (task.children || []).map(serializeTaskNode),
    result: (task.codeArtifacts?.length || 0) > 0 ? 'Code artifacts generated' : undefined,
    error: task.status === 'test_failed' || task.status === 'rejected' ? 'Task failed' : undefined,
    createdAt,
    updatedAt,
  };
}

/**
 * 映射任务状态
 */
function mapTaskStatus(status: string): 'pending' | 'running' | 'passed' | 'failed' | 'blocked' {
  switch (status) {
    case 'pending':
      return 'pending';
    // 运行中的状态
    case 'running':
    case 'test_writing':
    case 'coding':
    case 'testing':
    case 'implementing':
    case 'review':
      return 'running';
    // 成功状态
    case 'passed':
    case 'approved':
      return 'passed';
    // 失败状态
    case 'failed':
    case 'test_failed':
    case 'rejected':
    case 'cancelled':
      return 'failed';
    case 'blocked':
      return 'blocked';
    default:
      console.warn(`[WebSocket] Unknown task status: ${status}, defaulting to 'pending'`);
      return 'pending';
  }
}

/**
 * 序列化 Queen
 */
function serializeQueen(queen: QueenAgent): any {
  return {
    id: queen.id,
    blueprintId: queen.blueprintId,
    status: mapQueenStatus(queen.status),
    currentAction: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 映射 Queen 状态
 */
function mapQueenStatus(status: string): 'idle' | 'planning' | 'coordinating' | 'monitoring' {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'coordinating':
      return 'coordinating';
    case 'paused':
      return 'idle';
    default:
      return 'monitoring';
  }
}

/**
 * 序列化 Worker
 */
function serializeWorker(worker: WorkerAgent): any {
  // 获取任务信息
  const queen = agentCoordinator.getQueen();
  let taskTitle = null;
  if (queen && worker.taskId) {
    const taskTree = taskTreeManager.getTaskTree(queen.taskTreeId);
    if (taskTree) {
      const task = taskTreeManager.findTask(taskTree.root, worker.taskId);
      if (task) {
        taskTitle = task.name;
      }
    }
  }

  // 计算进度
  const progress = calculateWorkerProgress(worker);

  // 序列化 TDD 循环状态
  const tddCycle = worker.tddCycle ? {
    phase: mapTDDPhase(worker.tddCycle.phase),
    iteration: worker.tddCycle.iteration,
    testWritten: worker.tddCycle.testWritten,
    codeWritten: worker.tddCycle.codeWritten,
    testPassed: worker.tddCycle.testPassed,
  } : null;

  return {
    id: worker.id,
    blueprintId: queen?.blueprintId || '',
    name: `Worker ${worker.id.substring(0, 8)}`,
    status: mapWorkerStatus(worker.status),
    // 添加详细状态，前端可以用来显示更精确的状态信息
    detailedStatus: worker.status,
    currentTaskId: worker.taskId || null,
    currentTaskTitle: taskTitle,
    progress,
    tddCycle,
    logs: worker.history.map(h => `[${h.type}] ${h.description}`),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 映射 TDD 阶段到前端格式
 */
function mapTDDPhase(phase: string): string {
  // 统一映射 TDD 阶段名称
  const phaseMap: Record<string, string> = {
    'write_test': 'write_test',
    'run_test_red': 'run_test_red',
    'implement': 'write_code',      // 后端使用 implement，前端使用 write_code
    'write_code': 'write_code',
    'run_test_green': 'run_test_green',
    'refactor': 'refactor',
    'done': 'done',
  };
  return phaseMap[phase] || 'write_test';
}

/**
 * 映射 Worker 状态
 */
function mapWorkerStatus(status: string): 'idle' | 'working' | 'paused' | 'completed' | 'failed' {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'test_writing':
    case 'coding':
    case 'testing':
    case 'implementing':
      return 'working';
    case 'waiting':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      console.warn(`[WebSocket] Unknown worker status: ${status}, defaulting to 'idle'`);
      return 'idle';
  }
}

/**
 * 计算 Worker 进度
 */
function calculateWorkerProgress(worker: WorkerAgent): number {
  const cycle = worker.tddCycle;
  if (!cycle) return 0;

  // 基于 TDD 循环阶段计算进度
  const phaseProgress: Record<string, number> = {
    'write_test': 20,
    'run_test_red': 40,
    'implement': 60,
    'run_test_green': 80,
    'refactor': 90,
    'done': 100,
  };

  return phaseProgress[cycle.phase] || 0;
}

/**
 * 序列化时间线事件
 */
function serializeTimelineEvent(event: TimelineEvent): any {
  return {
    id: event.id,
    timestamp: event.timestamp.toISOString(),
    type: mapTimelineEventType(event.type),
    actor: event.data?.workerId || event.data?.queenId || 'system',
    message: event.description,
    data: event.data,
  };
}

/**
 * 映射时间线事件类型
 */
function mapTimelineEventType(type: string): string {
  const typeMap: Record<string, string> = {
    'task_start': 'task_start',
    'task_complete': 'task_complete',
    'test_fail': 'task_fail',
    'test_pass': 'task_complete',
    'worker_created': 'worker_start',
    'rollback': 'system',
  };

  return typeMap[type] || 'system';
}

// ============================================================================
// 蜂群控制处理函数
// ============================================================================

/**
 * 广播消息给指定蓝图的订阅者
 */
function broadcastToBlueprint(
  blueprintId: string,
  message: any,
  swarmSubscriptions: Map<string, Set<string>>,
  clients: Map<string, ClientConnection>
): void {
  const subscribers = swarmSubscriptions.get(blueprintId);
  if (!subscribers || subscribers.size === 0) return;

  const messageStr = JSON.stringify(message);
  subscribers.forEach(clientId => {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageStr);
    }
  });
}

/**
 * 处理蜂群暂停请求
 */
async function handleSwarmPause(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    // 停止协调器主循环（暂停）
    agentCoordinator.stopMainLoop();

    console.log(`[Swarm] 蜂群暂停: ${blueprintId}`);

    // 发送暂停确认
    sendMessage(ws, {
      type: 'swarm:paused',
      payload: {
        blueprintId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });

    // 广播给所有订阅者
    const queen = agentCoordinator.getQueen();
    if (queen && queen.blueprintId === blueprintId) {
      sendMessage(ws, {
        type: 'swarm:queen_update',
        payload: {
          queenId: queen.id,
          updates: { status: 'idle' },
        },
      });
    }
  } catch (error) {
    console.error('[Swarm] 暂停失败:', error);
    sendMessage(ws, {
      type: 'swarm:error',
      payload: {
        blueprintId,
        error: error instanceof Error ? error.message : '暂停失败',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * 处理蜂群恢复请求
 */
async function handleSwarmResume(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    // 恢复协调器主循环
    agentCoordinator.startMainLoop();

    console.log(`[Swarm] 蜂群恢复: ${blueprintId}`);

    // 发送恢复确认
    sendMessage(ws, {
      type: 'swarm:resumed',
      payload: {
        blueprintId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });

    // 广播给所有订阅者
    const queen = agentCoordinator.getQueen();
    if (queen && queen.blueprintId === blueprintId) {
      sendMessage(ws, {
        type: 'swarm:queen_update',
        payload: {
          queenId: queen.id,
          updates: { status: 'coordinating' },
        },
      });
    }
  } catch (error) {
    console.error('[Swarm] 恢复失败:', error);
    sendMessage(ws, {
      type: 'swarm:error',
      payload: {
        blueprintId,
        error: error instanceof Error ? error.message : '恢复失败',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * v9.4: 恢复 LeadAgent 执行（死任务恢复）
 * 当 LeadAgent 已退出但仍有 pending 任务时，用户从前端触发恢复
 */
async function handleResumeLead(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    console.log(`[Swarm v9.4] 恢复 LeadAgent 执行: ${blueprintId}`);

    // 清除旧的 LeadAgent 状态（让前端从 idle 开始重新追踪）
    activeLeadAgentState.delete(blueprintId);

    // 调用 executionManager 恢复执行
    const result = await executionManager.resumeLeadAgent(blueprintId);

    if (result.success) {
      sendMessage(ws, {
        type: 'swarm:resumed',
        payload: {
          blueprintId,
          success: true,
          timestamp: new Date().toISOString(),
        },
      });

      // 广播给所有订阅者
      const broadcastFn = (msg: any) => {
        const subscribers = swarmSubscriptions.get(blueprintId);
        if (!subscribers) return;
        for (const subscriberId of subscribers) {
          // 通过 client map 找到 ws 并发送
          // 简化：使用 broadcastToSubscribers
        }
      };
    } else {
      sendMessage(ws, {
        type: 'swarm:error',
        payload: {
          blueprintId,
          error: result.error || '恢复失败',
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('[Swarm v9.4] 恢复 LeadAgent 失败:', error);
    sendMessage(ws, {
      type: 'swarm:error',
      payload: {
        blueprintId,
        error: error instanceof Error ? error.message : '恢复 LeadAgent 失败',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * 处理蜂群停止请求
 */
async function handleSwarmStop(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    // 停止协调器主循环
    agentCoordinator.stopMainLoop();

    console.log(`[Swarm] 蜂群停止: ${blueprintId}`);

    // 发送停止确认
    sendMessage(ws, {
      type: 'swarm:stopped',
      payload: {
        blueprintId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Swarm] 停止失败:', error);
    sendMessage(ws, {
      type: 'swarm:error',
      payload: {
        blueprintId,
        error: error instanceof Error ? error.message : '停止失败',
        timestamp: new Date().toISOString(),
      },
    });
  }
}

/**
 * 处理 Worker 暂停请求
 */
async function handleWorkerPause(
  client: ClientConnection,
  workerId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!workerId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 workerId' },
      });
      return;
    }

    const worker = agentCoordinator.getWorker(workerId);
    if (!worker) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: 'Worker 不存在' },
      });
      return;
    }

    // 注意：当前 AgentCoordinator 没有暂停单个 Worker 的方法
    // 这里发送状态更新通知前端
    console.log(`[Swarm] Worker 暂停: ${workerId}`);

    sendMessage(ws, {
      type: 'worker:paused',
      payload: {
        workerId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });

    // 发送 Worker 状态更新
    sendMessage(ws, {
      type: 'swarm:worker_update',
      payload: {
        workerId,
        updates: { status: 'paused' },
      },
    });
  } catch (error) {
    console.error('[Swarm] Worker 暂停失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Worker 暂停失败',
      },
    });
  }
}

/**
 * 处理 Worker 恢复请求
 */
async function handleWorkerResume(
  client: ClientConnection,
  workerId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!workerId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 workerId' },
      });
      return;
    }

    const worker = agentCoordinator.getWorker(workerId);
    if (!worker) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: 'Worker 不存在' },
      });
      return;
    }

    console.log(`[Swarm] Worker 恢复: ${workerId}`);

    sendMessage(ws, {
      type: 'worker:resumed',
      payload: {
        workerId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });

    // 发送 Worker 状态更新
    sendMessage(ws, {
      type: 'swarm:worker_update',
      payload: {
        workerId,
        updates: { status: 'working' },
      },
    });
  } catch (error) {
    console.error('[Swarm] Worker 恢复失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Worker 恢复失败',
      },
    });
  }
}

/**
 * 处理 Worker 终止请求
 */
async function handleWorkerTerminate(
  client: ClientConnection,
  workerId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!workerId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 workerId' },
      });
      return;
    }

    const worker = agentCoordinator.getWorker(workerId);
    if (!worker) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: 'Worker 不存在' },
      });
      return;
    }

    const queen = agentCoordinator.getQueen();

    // 标记 Worker 任务失败
    if (worker.taskId) {
      agentCoordinator.workerFailTask(workerId, '用户终止');
    }

    console.log(`[Swarm] Worker 终止: ${workerId}`);

    sendMessage(ws, {
      type: 'worker:terminated',
      payload: {
        workerId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });

    // 发送 Worker 移除通知
    sendMessage(ws, {
      type: 'worker:removed',
      payload: {
        workerId,
        blueprintId: queen?.blueprintId || '',
        reason: '用户终止',
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Swarm] Worker 终止失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Worker 终止失败',
      },
    });
  }
}

/**
 * v2.1: 处理任务重试请求
 */
async function handleTaskRetry(
  client: ClientConnection,
  blueprintId: string,
  taskId: string,
  _swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    if (!taskId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 taskId' },
      });
      return;
    }

    console.log(`[Swarm] 重试任务: ${taskId} (blueprint: ${blueprintId})`);

    // 调用 executionManager 的重试方法
    const result = await executionManager.retryTask(blueprintId, taskId);

    if (result.success) {
      sendMessage(ws, {
        type: 'task:retry_success',
        payload: {
          blueprintId,
          taskId,
          success: true,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      sendMessage(ws, {
        type: 'task:retry_failed',
        payload: {
          blueprintId,
          taskId,
          success: false,
          error: result.error || '重试失败',
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('[Swarm] 任务重试失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '任务重试失败',
      },
    });
  }
}

/**
 * v3.8: 处理任务跳过请求
 */
async function handleTaskSkip(
  client: ClientConnection,
  blueprintId: string,
  taskId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId || !taskId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId 或 taskId' },
      });
      return;
    }

    // 获取执行会话
    const session = executionManager.getSessionByBlueprint(blueprintId);
    if (!session) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '找不到执行会话' },
      });
      return;
    }

    // 调用跳过方法
    const success = session.coordinator.skipTask(taskId);

    if (success) {
      sendMessage(ws, {
        type: 'task:skip_success',
        payload: {
          blueprintId,
          taskId,
          success: true,
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      sendMessage(ws, {
        type: 'task:skip_failed',
        payload: {
          blueprintId,
          taskId,
          success: false,
          error: '跳过失败',
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('[Swarm] 任务跳过失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '任务跳过失败',
      },
    });
  }
}

/**
 * v4.4: 处理用户插嘴请求
 * 用户可以在任务执行过程中向 Worker 发送消息/指令
 */
async function handleTaskInterject(
  client: ClientConnection,
  blueprintId: string,
  taskId: string,
  message: string
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId || !taskId || !message) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少必要参数: blueprintId, taskId, message' },
      });
      return;
    }

    console.log(`[Interject] 用户插嘴: blueprintId=${blueprintId}, taskId=${taskId}, message=${message.substring(0, 50)}...`);

    // v4.5: 首先检查是否是 E2E 测试任务
    if (taskId.startsWith('e2e-test')) {
      const e2eAgent = getE2EAgent(blueprintId);
      if (e2eAgent && typeof e2eAgent.interject === 'function') {
        const success = e2eAgent.interject(message);
        if (success) {
          console.log(`[Interject] 消息已发送到 E2E Agent`);
          sendMessage(ws, {
            type: 'task:interject_success',
            payload: {
              blueprintId,
              taskId,
              success: true,
              message: '消息已发送，E2E Agent 将在下一轮对话中处理',
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          console.warn(`[Interject] E2E Agent 插嘴失败`);
          sendMessage(ws, {
            type: 'task:interject_failed',
            payload: {
              blueprintId,
              taskId,
              success: false,
              error: 'E2E Agent 插嘴失败，测试可能已完成或尚未开始',
              timestamp: new Date().toISOString(),
            },
          });
        }
        return;
      } else {
        console.warn(`[Interject] 找不到活跃的 E2E Agent`);
        sendMessage(ws, {
          type: 'task:interject_failed',
          payload: {
            blueprintId,
            taskId,
            success: false,
            error: '找不到正在运行的 E2E 测试，测试可能已完成或尚未开始',
            timestamp: new Date().toISOString(),
          },
        });
        return;
      }
    }

    // 查找正在执行该任务的 Worker
    let targetWorker: AutonomousWorkerExecutor | null = null;
    for (const [key, worker] of activeWorkers.entries()) {
      // v4.5: 使用 getCurrentTaskId() 方法获取当前任务 ID
      if (key.startsWith(`${blueprintId}:`) && worker.getCurrentTaskId() === taskId) {
        targetWorker = worker;
        break;
      }
    }

    if (!targetWorker) {
      console.warn(`[Interject] 找不到执行任务 ${taskId} 的 Worker`);
      sendMessage(ws, {
        type: 'task:interject_failed',
        payload: {
          blueprintId,
          taskId,
          success: false,
          error: '找不到执行该任务的 Worker，任务可能已完成或尚未开始',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // 调用 Worker 的插嘴方法
    if (typeof targetWorker.interject === 'function') {
      targetWorker.interject(message);
      console.log(`[Interject] 消息已发送到 Worker`);

      sendMessage(ws, {
        type: 'task:interject_success',
        payload: {
          blueprintId,
          taskId,
          success: true,
          message: '消息已发送，Worker 将在下一轮对话中处理',
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      console.warn(`[Interject] Worker 不支持 interject 方法`);
      sendMessage(ws, {
        type: 'task:interject_failed',
        payload: {
          blueprintId,
          taskId,
          success: false,
          error: 'Worker 不支持插嘴功能',
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('[Interject] 处理插嘴失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '处理插嘴失败',
      },
    });
  }
}

/**
 * v9.2: 处理 LeadAgent 插嘴请求
 */
async function handleLeadInterject(
  client: ClientConnection,
  blueprintId: string,
  message: string
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId || !message) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少必要参数: blueprintId, message' },
      });
      return;
    }

    console.log(`[LeadInterject] 用户向 LeadAgent 插嘴: blueprintId=${blueprintId}, message=${message.substring(0, 50)}...`);

    // 通过 executionManager 获取当前执行会话
    const session = executionManager.getSessionByBlueprint(blueprintId);
    if (!session) {
      sendMessage(ws, {
        type: 'lead:interject_failed',
        payload: {
          blueprintId,
          success: false as const,
          error: '找不到活跃的执行会话，LeadAgent 可能尚未启动',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // 获取 coordinator 中的 LeadAgent 实例
    const leadAgent = session.coordinator.getLeadAgent();
    if (!leadAgent) {
      sendMessage(ws, {
        type: 'lead:interject_failed',
        payload: {
          blueprintId,
          success: false as const,
          error: '找不到活跃的 LeadAgent，可能已完成或尚未启动',
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    // 调用 LeadAgent 的插嘴方法
    const success = leadAgent.interject(message);
    if (success) {
      console.log(`[LeadInterject] 消息已发送到 LeadAgent`);
      sendMessage(ws, {
        type: 'lead:interject_success',
        payload: {
          blueprintId,
          success: true as const,
          message: '消息已发送，LeadAgent 将在下一轮对话中处理',
          timestamp: new Date().toISOString(),
        },
      });
    } else {
      sendMessage(ws, {
        type: 'lead:interject_failed',
        payload: {
          blueprintId,
          success: false as const,
          error: 'LeadAgent 插嘴失败，可能未在执行中',
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error('[LeadInterject] 处理 LeadAgent 插嘴失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '处理 LeadAgent 插嘴失败',
      },
    });
  }
}

/**
 * v3.8: 处理取消执行请求
 */
/**
 * 处理 Agent 探针请求（蜂群模式）
 * 返回指定 Agent 的系统提示词、消息体、工具列表等调试信息
 */
async function handleSwarmDebugAgent(
  client: ClientConnection,
  payload: { blueprintId: string; agentType: 'lead' | 'worker' | 'e2e'; workerId?: string }
): Promise<void> {
  const { ws } = client;

  try {
    const { blueprintId, agentType, workerId } = payload as { blueprintId: string; agentType: 'lead' | 'worker' | 'e2e'; workerId?: string };

    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    const session = executionManager.getSessionByBlueprint(blueprintId);
    if (!session) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '找不到执行会话' },
      });
      return;
    }

    const debugInfo = session.coordinator.getAgentDebugInfo(agentType, workerId);

    if (!debugInfo) {
      sendMessage(ws, {
        type: 'swarm:debug_agent_response',
        payload: {
          agentType,
          workerId,
          systemPrompt: `(${agentType} Agent 当前未在执行)`,
          messages: [],
          tools: [],
          model: 'unknown',
          messageCount: 0,
        },
      });
      return;
    }

    sendMessage(ws, {
      type: 'swarm:debug_agent_response',
      payload: debugInfo as AgentDebugPayload,
    });
  } catch (error) {
    console.error('[Swarm] 获取 Agent 调试信息失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取 Agent 调试信息失败',
      },
    });
  }
}

/**
 * 处理 Agent 列表请求（探针功能 - 获取当前活跃的 Agent 列表）
 */
async function handleSwarmDebugAgentList(
  client: ClientConnection,
  payload: { blueprintId: string }
): Promise<void> {
  const { ws } = client;

  try {
    const { blueprintId } = payload;

    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    const session = executionManager.getSessionByBlueprint(blueprintId);
    if (!session) {
      sendMessage(ws, {
        type: 'swarm:debug_agent_list_response',
        payload: { blueprintId, agents: [] },
      });
      return;
    }

    const agents = session.coordinator.getActiveAgents();

    sendMessage(ws, {
      type: 'swarm:debug_agent_list_response',
      payload: { blueprintId, agents },
    });
  } catch (error) {
    console.error('[Swarm] 获取活跃 Agent 列表失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '获取 Agent 列表失败',
      },
    });
  }
}

async function handleSwarmCancel(
  client: ClientConnection,
  blueprintId: string,
  swarmSubscriptions: Map<string, Set<string>>
): Promise<void> {
  const { ws } = client;

  try {
    if (!blueprintId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId' },
      });
      return;
    }

    // 获取执行会话
    const session = executionManager.getSessionByBlueprint(blueprintId);
    if (!session) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '找不到执行会话' },
      });
      return;
    }

    // 调用取消方法
    session.coordinator.cancel();

    console.log(`[Swarm] 执行已取消: ${blueprintId}`);

    sendMessage(ws, {
      type: 'swarm:cancelled',
      payload: {
        blueprintId,
        success: true,
        timestamp: new Date().toISOString(),
      },
    });

    // 更新蓝图状态
    const blueprint = blueprintStore.get(blueprintId);
    if (blueprint) {
      blueprint.status = 'cancelled';
      blueprintStore.save(blueprint);
    }
  } catch (error) {
    console.error('[Swarm] 取消执行失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '取消执行失败',
      },
    });
  }
}

/**
 * v4.2: 处理 E2E Agent / Worker AskUserQuestion 响应
 * 支持两种场景：
 * 1. E2E Agent - 使用共享注册表 (e2e-agent-registry)
 * 2. Worker - 使用 activeWorkers Map（payload 中有 workerId）
 */
async function handleAskUserResponse(
  client: ClientConnection,
  payload: {
    blueprintId: string;
    requestId: string;
    answers: Record<string, string>;
    cancelled?: boolean;
    workerId?: string; // v4.2: 可选，用于区分 Worker 和 E2E Agent
  }
): Promise<void> {
  const { ws } = client;

  try {
    const { blueprintId, requestId, answers, cancelled, workerId } = payload;

    if (!blueprintId || !requestId) {
      sendMessage(ws, {
        type: 'error',
        payload: { message: '缺少 blueprintId 或 requestId' },
      });
      return;
    }

    // v4.2: 根据是否有 workerId 区分 Worker 和 E2E Agent
    if (workerId) {
      // Worker 响应
      const workerKey = `${blueprintId}:${workerId}`;
      const worker = activeWorkers.get(workerKey);
      if (!worker) {
        console.warn(`[Worker] No active worker found: ${workerKey}`);
        sendMessage(ws, {
          type: 'error',
          payload: { message: `找不到活动的 Worker: ${workerId}` },
        });
        return;
      }

      // 调用 worker 的 resolveAskUser 方法
      worker.resolveAskUser(requestId, {
        answers: answers || {},
        cancelled: cancelled || false,
      });

      console.log(`[Worker] AskUserQuestion response received: ${requestId}`, answers);

      // 清理 Worker 引用（可选，但建议保留到任务完成）
      // activeWorkers.delete(workerKey);
    } else {
      // E2E Agent 响应（原有逻辑）
      const agent = getE2EAgent(blueprintId);
      if (!agent) {
        console.warn(`[E2E Agent] No active agent found for blueprint: ${blueprintId}`);
        sendMessage(ws, {
          type: 'error',
          payload: { message: '找不到活动的 E2E Agent' },
        });
        return;
      }

      // 调用 agent 的 resolveAskUser 方法
      agent.resolveAskUser(requestId, {
        answers: answers || {},
        cancelled: cancelled || false,
      });

      console.log(`[E2E Agent] AskUserQuestion response received: ${requestId}`, answers);
    }

    sendMessage(ws, {
      type: 'swarm:ask_response_ack',
      payload: {
        requestId,
        success: true,
      },
    });
  } catch (error) {
    console.error('[AskUser] 处理 AskUserQuestion 响应失败:', error);
    sendMessage(ws, {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : '处理响应失败',
      },
    });
  }
}

// ============================================================================
// 持续开发流程处理
// ============================================================================

/**
 * 获取或创建编排器
 */
function getOrchestrator(sessionId: string, cwd: string): ContinuousDevOrchestrator {
  let orchestrator = orchestrators.get(sessionId);
  if (!orchestrator) {
    console.log(`[ContinuousDev] 为会话 ${sessionId} 创建新编排器`);
    
    // 创建新编排器
    orchestrator = createContinuousDevOrchestrator({
      projectRoot: cwd,
      phases: {
        codebaseAnalysis: true,
        impactAnalysis: true,
        regressionTesting: true,
        cycleReset: true,
      },
      // 使用默认配置，但可以从环境或用户配置读取
    });
    
    orchestrators.set(sessionId, orchestrator);
    
    // 设置事件监听器，转发给客户端
    // 注意：这里需要拿到 client 实例，但 client 是在调用 handleContinuousDevStart 时传入的
    // 为了简化，我们在 setupOrchestratorListeners 中处理
  }
  return orchestrator;
}

/**
 * 设置编排器事件监听
 */
function setupOrchestratorListeners(orchestrator: ContinuousDevOrchestrator, client: ClientConnection) {
  // 避免重复绑定：检查是否已经绑定过该客户端
  // 这里简化处理：总是重新绑定（EventEmitter 会累积，实际应用应管理监听器引用）
  // 更好的做法是每个 session 一个 orchestrator，事件绑定一次
  
  if ((orchestrator as any)._hasBoundListeners) return;
  (orchestrator as any)._hasBoundListeners = true;
  
  const sendEvent = (type: string, data?: any) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      sendMessage(client.ws, {
        type: `continuous_dev:${type}` as any, // 动态类型，前端需对应处理
        payload: data
      });
    }
  };

  // 阶段变更
  orchestrator.on('phase_changed', (data) => {
    sendEvent('phase_changed', data);
    sendEvent('status_update', orchestrator.getState());
  });

  // 流程开始
  orchestrator.on('flow_started', (data) => sendEvent('flow_started', data));
  
  // 阶段开始/完成
  orchestrator.on('phase_started', (data) => sendEvent('phase_started', data));
  orchestrator.on('phase_completed', (data) => sendEvent('phase_completed', data));
  
  // 需要审批
  orchestrator.on('approval_required', (data) => sendEvent('approval_required', data));
  
  // 任务更新
  orchestrator.on('task_completed', (data) => sendEvent('task_completed', data));
  orchestrator.on('task_failed', (data) => sendEvent('task_failed', data));
  
  // 回归测试
  orchestrator.on('regression_passed', (data) => sendEvent('regression_passed', data));
  orchestrator.on('regression_failed', (data) => sendEvent('regression_failed', data));
  
  // 周期重置
  orchestrator.on('cycle_reset', (data) => sendEvent('cycle_reset', data));
  orchestrator.on('cycle_review_started', (data) => sendEvent('cycle_review_started', data));
  orchestrator.on('cycle_review_completed', (data) => sendEvent('cycle_review_completed', data));
  
  // 错误和完成
  orchestrator.on('flow_failed', (data) => sendEvent('flow_failed', data));
  orchestrator.on('flow_stopped', () => sendEvent('flow_stopped'));
  orchestrator.on('flow_paused', () => sendEvent('flow_paused'));
  orchestrator.on('flow_resumed', () => sendEvent('flow_resumed'));
}

/**
 * 处理启动开发流程
 */
async function handleContinuousDevStart(
  client: ClientConnection,
  payload: { requirement: string },
  conversationManager: ConversationManager
): Promise<void> {
  const { sessionId } = client;
  const session = conversationManager.getSessionManager().loadSessionById(sessionId);
  
  // 获取工作目录
  // 注意：这里假设 ConversationManager 有方法获取 cwd，或者从 session Metadata 获取
  // 实际项目中可能可以通过 conversationManager.getContext(sessionId).cwd 获取
  // 这里暂时使用 process.cwd()，实际应从会话上下文获取
  const cwd = process.cwd(); 

  const orchestrator = getOrchestrator(sessionId, cwd);
  setupOrchestratorListeners(orchestrator, client);
  
  // 检查是否空闲
  const state = orchestrator.getState();
  if (state.phase !== 'idle' && state.phase !== 'completed' && state.phase !== 'failed') {
    sendMessage(client.ws, {
      type: 'error',
      payload: { message: `当前已有开发任务正在进行中 (状态: ${state.phase})，请先等待完成或取消。` }
    });
    return;
  }

  // 启动流程
  // processRequirement 是异步的，但我们不 await 它，让它在后台运行
  // 错误通过事件发送
  orchestrator.processRequirement(payload.requirement)
    .then(result => {
      if (!result.success && !result.error?.includes('需要人工审批')) {
        // 如果不是等待审批的"失败"（其实是暂停），则发送错误
        // (processRequirement 内部已经 emit flow_failed)
      }
    })
    .catch(error => {
      console.error('[ContinuousDev] 流程异常:', error);
      // 内部应该已经捕捉并 emit 事件
    });
    
  // 立即发送响应
  sendMessage(client.ws, {
    type: 'continuous_dev:ack',
    payload: { message: '开发流程已启动' }
  });
}

/**
 * 处理获取状态
 */
async function handleContinuousDevStatus(client: ClientConnection): Promise<void> {
  const orchestrator = orchestrators.get(client.sessionId);
  if (!orchestrator) {
    sendMessage(client.ws, {
      type: 'continuous_dev:status_update',
      payload: { phase: 'idle', message: '无活跃流程' }
    });
    return;
  }
  
  sendMessage(client.ws, {
    type: 'continuous_dev:status_update',
    payload: orchestrator.getState()
  });
  
  // 同时发送进度
  sendMessage(client.ws, {
    type: 'continuous_dev:progress_update',
    payload: orchestrator.getProgress()
  });
}

/**
 * 处理暂停
 */
async function handleContinuousDevPause(client: ClientConnection): Promise<void> {
  const orchestrator = orchestrators.get(client.sessionId);
  if (orchestrator) {
    orchestrator.pause();
    sendMessage(client.ws, {
      type: 'continuous_dev:paused',
      payload: { success: true }
    });
  }
}

/**
 * 处理恢复
 */
async function handleContinuousDevResume(client: ClientConnection): Promise<void> {
  const orchestrator = orchestrators.get(client.sessionId);
  if (orchestrator) {
    orchestrator.resume();
    sendMessage(client.ws, {
      type: 'continuous_dev:resumed',
      payload: { success: true }
    });
  }
}

/**
 * 处理批准执行
 */
async function handleContinuousDevApprove(client: ClientConnection): Promise<void> {
  const orchestrator = orchestrators.get(client.sessionId);
  if (orchestrator) {
    try {
      await orchestrator.approveAndExecute();
      sendMessage(client.ws, {
        type: 'continuous_dev:approved',
        payload: { success: true }
      });
    } catch (error) {
      sendMessage(client.ws, {
        type: 'error',
        payload: { message: error instanceof Error ? error.message : '批准失败' }
      });
    }
  }
}

/**
 * 处理回滚
 */
async function handleContinuousDevRollback(
  client: ClientConnection,
  payload: { checkpointId?: string }
): Promise<void> {
  // 目前编排器还未完全公开回滚 API，这里作为预留接口
  // 实际实现需要调用 checkpointManager 和 orchestrator 的重置逻辑
  sendMessage(client.ws, {
    type: 'error',
    payload: { message: '回滚功能正在开发中' }
  });
}

// ============================================================================
// Rewind 功能处理
// ============================================================================

/**
 * 处理回滚预览请求
 */
async function handleRewindPreview(
  client: ClientConnection,
  payload: { messageId: string; option: 'code' | 'conversation' | 'both' },
  conversationManager: ConversationManager
): Promise<void> {
  try {
    const preview = conversationManager.getRewindPreview(
      client.sessionId,
      payload.messageId,
      payload.option
    );

    sendMessage(client.ws, {
      type: 'rewind_preview',
      payload: {
        success: true,
        preview,
      },
    });
  } catch (error) {
    sendMessage(client.ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '获取预览失败' },
    });
  }
}

/**
 * 处理回滚执行请求
 */
async function handleRewindExecute(
  client: ClientConnection,
  payload: { messageId: string; option: 'code' | 'conversation' | 'both' },
  conversationManager: ConversationManager
): Promise<void> {
  try {
    console.log(`[WebSocket] 执行回滚: sessionId=${client.sessionId}, messageId=${payload.messageId}, option=${payload.option}`);

    const result = await conversationManager.rewind(
      client.sessionId,
      payload.messageId,
      payload.option
    );

    if (result.success) {
      // 回滚成功，发送更新后的历史记录
      const history = conversationManager.getHistory(client.sessionId);
      sendMessage(client.ws, {
        type: 'rewind_success',
        payload: {
          success: true,
          result,
          messages: history,
        },
      });
    } else {
      sendMessage(client.ws, {
        type: 'error',
        payload: { message: result.error || '回滚失败' },
      });
    }
  } catch (error) {
    console.error('[WebSocket] 回滚执行失败:', error);
    sendMessage(client.ws, {
      type: 'error',
      payload: { message: error instanceof Error ? error.message : '回滚失败' },
    });
  }
}
