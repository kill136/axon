/**
 * RealtimeCoordinator - 蜂群架构 v9.0 实时协调器
 *
 * v9.0: LeadAgent 持久大脑模式
 * - 所有任务执行由 LeadAgent 接管
 * - Coordinator 作为 WebUI 接口层，负责事件转发和状态管理
 * - 保留暂停/取消/冲突管理等控制功能
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import type {
  ExecutionPlan,
  SmartTask,
  TaskResult,
  TaskStatus,
  ExecutionStatus,
  ExecutionIssue,
  SwarmConfig,
  SwarmEvent,
  SwarmEventType,
  AutonomousWorker,
  FileChange,
  WorkerDecision,
  ExecutionState,
  SerializableTaskResult,
  SerializableExecutionIssue,
  SerializableExecutionPlan,
  SerializableSmartTask,
  PendingConflict,
  HumanDecisionRequest,
  HumanDecisionResult,
  TechStack,
  Blueprint,
  SwarmMemory,
  SwarmAPI,
} from './types.js';
import type { AutonomousWorkerExecutor } from './autonomous-worker.js';
import { LeadAgent } from './lead-agent.js';
import type { LeadAgentConfig } from './types.js';

// ============================================================================
// v8.4: 蜂群广播更新类型
// ============================================================================

/**
 * 蜂群广播更新
 * 当 SwarmMemory 有重要变化时，广播给所有活跃的 Worker
 */
export interface SwarmBroadcastUpdate {
  /** 更新类型 */
  type: 'api_registered' | 'task_completed' | 'memory_updated';
  /** 更新摘要（简短描述） */
  summary: string;
  /** 详细内容（可选） */
  details?: {
    /** 新注册的 API */
    apis?: SwarmAPI[];
    /** 完成的任务 */
    completedTask?: {
      id: string;
      name: string;
      category: string;
      summary: string;
    };
  };
  /** 时间戳 */
  timestamp: Date;
}

// v3.0: 状态持久化已移至蓝图文件（通过 state:changed 事件）
// 执行状态版本号（用于兼容性检查）
const EXECUTION_STATE_VERSION = '2.0.0';

// ============================================================================
// 执行结果类型
// ============================================================================

/**
 * 整体执行结果
 */
export interface ExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 计划 ID */
  planId: string;
  /** 蓝图 ID */
  blueprintId: string;
  /** 所有任务结果 */
  taskResults: Map<string, TaskResult>;
  /** 总耗时（毫秒）*/
  totalDuration: number;
  /** 总成本（美元）*/
  totalCost: number;
  /** 成功任务数 */
  completedCount: number;
  /** 失败任务数 */
  failedCount: number;
  /** 跳过任务数 */
  skippedCount: number;
  /** 问题列表 */
  issues: ExecutionIssue[];
  /** v10.0: LeadAgent 的完整文本输出（对齐 TaskTool 模式） */
  rawResponse?: string;
  /** 取消原因（如果被取消）*/
  cancelReason?: string;
}

/**
 * 任务执行器接口
 * 协调器不关心任务如何执行，只关心结果
 */
export interface TaskExecutor {
  execute(task: SmartTask, workerId: string): Promise<TaskResult>;
  /**
   * v5.7: 中止指定 Worker 的任务执行
   * 超时时调用此方法来停止 Worker
   * @param workerId 要中止的 Worker ID
   */
  abort?(workerId: string): void;
}

// ============================================================================
// 默认配置（从 DEFAULT_SWARM_CONFIG 继承）
// ============================================================================

const getDefaultConfig = (): SwarmConfig => ({
  maxWorkers: 5,
  workerTimeout: 1800000,  // 30分钟（Worker 执行 + Reviewer 审查，opus 审查需要更长时间）
  defaultModel: 'sonnet',
  complexTaskModel: 'opus',
  simpleTaskModel: 'sonnet',
  autoTest: true,
  testTimeout: 60000,
  maxRetries: 3,
  skipOnFailure: true,
  useGitBranches: true,
  autoMerge: true,
  maxCost: 10,
  costWarningThreshold: 0.8,
});

/**
 * 扩展配置：控制并行组失败时的行为
 */
export interface ExtendedSwarmConfig extends SwarmConfig {
  /** 当一个并行组有任务失败时，是否停止后续组的执行 (默认: true) */
  stopOnGroupFailure?: boolean;

  /** v4.0: 技术栈信息 */
  techStack?: TechStack;
}

// ============================================================================
// RealtimeCoordinator 实现
// ============================================================================

export class RealtimeCoordinator extends EventEmitter {
  private config: SwarmConfig & { stopOnGroupFailure?: boolean };
  private taskExecutor: TaskExecutor | null = null;

  // 执行状态
  private currentPlan: ExecutionPlan | null = null;
  private taskResults: Map<string, TaskResult> = new Map();
  private activeWorkers: Map<string, AutonomousWorker> = new Map();
  private issues: ExecutionIssue[] = [];

  // 🐝 冲突状态管理
  private pendingConflicts: Map<string, PendingConflict> = new Map();
  private conflictResolvers: Map<string, (decision: HumanDecisionRequest) => void> = new Map();

  // 控制标志
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private pauseResolve: (() => void) | null = null;
  private isExecuting: boolean = false;  // v2.3: 跟踪执行循环是否真的在运行

  // v8.2: 任务执行锁 - 防止同一任务被多个 Worker 同时执行
  private executingTaskIds: Set<string> = new Set();

  // v8.4: 活跃的 Worker Executor 实例（用于广播更新）
  private activeWorkerExecutors: Map<string, AutonomousWorkerExecutor> = new Map();

  // 任务修改队列（运行时修改）
  private taskModifications: Map<string, { newDescription?: string; skip?: boolean }> = new Map();

  // v9.1: LeadAgent 实例引用（用于重试时的插嘴通信）
  private currentLeadAgent: LeadAgent | null = null;

  // 统计信息
  private startTime: Date | null = null;
  private currentCost: number = 0;

  // 持久化相关
  private projectPath: string = '';
  private currentGroupIndex: number = 0;
  private autoSaveEnabled: boolean = true;

  // v4.0: 蓝图引用（用于集成验证时获取 API 契约）
  private currentBlueprint: Blueprint | null = null;

  // v12.1: TaskPlan 引用（优先于 currentBlueprint 传递给 LeadAgent）
  private currentTaskPlan: any | null = null;

  // v5.0: 蜂群共享记忆
  private swarmMemory: SwarmMemory | null = null;

  constructor(config?: Partial<SwarmConfig> & { stopOnGroupFailure?: boolean }) {
    super();
    this.config = { ...getDefaultConfig(), stopOnGroupFailure: true, ...config };
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 设置任务执行器
   * 协调器本身不执行任务，需要外部提供执行器
   */
  setTaskExecutor(executor: TaskExecutor): void {
    this.taskExecutor = executor;
  }

  /**
   * v4.0: 设置蓝图引用
   * 用于集成验证时获取 API 契约
   */
  setBlueprint(blueprint: Blueprint): void {
    this.currentBlueprint = blueprint;
    if (blueprint.apiContract) {
      console.log(`[RealtimeCoordinator] Blueprint contains API contract: ${blueprint.apiContract.endpoints.length} endpoints`);
    }
    // v5.0: 初始化或恢复共享记忆
    this.swarmMemory = blueprint.swarmMemory || this.initSwarmMemory();
  }

  /**
   * v12.1: 设置 TaskPlan（优先于 Blueprint 传递给 LeadAgent）
   */
  setTaskPlan(taskPlan: any): void {
    this.currentTaskPlan = taskPlan;
  }

  /**
   * v5.0: 获取蜂群共享记忆
   */
  getSwarmMemory(): SwarmMemory | null {
    return this.swarmMemory;
  }

  /**
   * v5.0: 获取精简的共享记忆文本（用于注入 Worker Prompt）
   */
  getCompactMemoryText(): string {
    if (!this.swarmMemory || !this.currentPlan) {
      return '';
    }

    const memory = this.swarmMemory;
    const lines: string[] = ['## 蜂群共享记忆'];

    // 进度概览
    lines.push(`进度: ${memory.overview}`);

    // API 列表（最多显示 10 个）
    if (memory.apis.length > 0) {
      const apiList = memory.apis
        .slice(0, 10)
        .map(a => `${a.method} ${a.path}`)
        .join(', ');
      const extra = memory.apis.length > 10 ? ` (+${memory.apis.length - 10})` : '';
      lines.push(`API: ${apiList}${extra}`);
    }

    // 已完成任务（最多显示 5 个）
    if (memory.completedTasks.length > 0) {
      lines.push('已完成:');
      memory.completedTasks.slice(-5).forEach(t => {
        lines.push(`- ${t.taskName}: ${t.summary.slice(0, 30)}`);
      });
    }

    // 蓝图路径提示
    if (this.currentBlueprint) {
      const blueprintPath = `.blueprint/${this.currentBlueprint.id}.json`;
      lines.push(`\n详情: Read("${blueprintPath}") 查看完整蓝图和记忆`);
    }

    return lines.join('\n');
  }

  /**
   * v5.0: 初始化共享记忆
   */
  private initSwarmMemory(): SwarmMemory {
    return {
      overview: '0/0 完成',
      apis: [],
      completedTasks: [],
      updatedAt: new Date(),
    };
  }

  // ============================================================================
  // v8.4: Worker 实例管理和广播机制
  // ============================================================================

  /**
   * v8.4: 注册活跃的 Worker Executor 实例
   * 在 RealTaskExecutor 中创建 Worker 时调用
   */
  registerWorkerExecutor(workerId: string, executor: AutonomousWorkerExecutor): void {
    this.activeWorkerExecutors.set(workerId, executor);
    console.log(`[RealtimeCoordinator] Worker registered: ${workerId} (active: ${this.activeWorkerExecutors.size})`);
  }

  /**
   * v8.4: 注销 Worker Executor 实例
   * 在 Worker 完成或失败时调用
   */
  unregisterWorkerExecutor(workerId: string): void {
    this.activeWorkerExecutors.delete(workerId);
    console.log(`[RealtimeCoordinator] Worker unregistered: ${workerId} (active: ${this.activeWorkerExecutors.size})`);
  }

  /**
   * v8.4: 广播更新到所有活跃的 Worker
   * 使用 Worker 的 interject 机制注入系统消息
   */
  broadcastToActiveWorkers(update: SwarmBroadcastUpdate): void {
    if (this.activeWorkerExecutors.size === 0) {
      return;
    }

    // 构建广播消息
    const message = this.buildBroadcastMessage(update);

    console.log(`[RealtimeCoordinator] Broadcasting update to ${this.activeWorkerExecutors.size} active Workers: ${update.summary}`);

    // 向所有活跃的 Worker 注入消息
    for (const [workerId, executor] of this.activeWorkerExecutors) {
      try {
        // 使用 interject 机制注入消息（如果 Worker 正在执行）
        if (executor.isExecuting()) {
          const success = executor.interject(message);
          if (success) {
            console.log(`[RealtimeCoordinator] Broadcasted update to Worker ${workerId}`);
          }
        }
      } catch (error) {
        console.error(`[RealtimeCoordinator] Broadcasting to Worker ${workerId} failed:`, error);
      }
    }

    // 发射广播事件（供 UI 显示）
    this.emitEvent('swarm:broadcast', {
      update,
      workerCount: this.activeWorkerExecutors.size,
    });
  }

  /**
   * v8.4: 构建广播消息文本
   */
  private buildBroadcastMessage(update: SwarmBroadcastUpdate): string {
    let message = `[蜂群更新] ${update.summary}`;

    if (update.details?.apis?.length) {
      const apiList = update.details.apis
        .map(a => `${a.method} ${a.path}`)
        .join(', ');
      message += `\n新 API: ${apiList}`;
    }

    if (update.details?.completedTask) {
      const task = update.details.completedTask;
      message += `\n已完成: ${task.name} (${task.category})`;
      if (task.summary) {
        message += ` - ${task.summary}`;
      }
    }

    return message;
  }

  /**
   * 开始执行计划
   * @param plan 执行计划
   * @param projectPath 项目路径（用于持久化）
   */
  async start(plan: ExecutionPlan, projectPath?: string, options?: { isResume?: boolean }): Promise<ExecutionResult> {
    // 设置项目路径
    if (projectPath) {
      this.projectPath = projectPath;
    }

    // v9.0: LeadAgent 持久大脑模式（唯一执行路径）
    if (!this.currentBlueprint) {
      throw new Error('LeadAgent 模式需要蓝图或任务计划，请先调用 setBlueprint()');
    }
    return this.startWithLeadAgent(plan, options?.isResume);
  }

  /**
   * v9.0: 使用 LeadAgent 持久大脑模式执行
   * LeadAgent 接管整个执行过程：探索、规划、执行、审查
   */
  private async startWithLeadAgent(plan: ExecutionPlan, isResume?: boolean): Promise<ExecutionResult> {
    if (!this.currentBlueprint) {
      throw new Error('LeadAgent 模式需要蓝图或任务计划，请先调用 setBlueprint()');
    }

    if (isResume) {
      // 恢复模式：不调用 reset()，保留通过 restoreFromState() 恢复的状态
      // 只更新必要的字段
      this.currentPlan = plan;
      if (!this.startTime) {
        this.startTime = new Date();
      }
      this.isExecuting = true;
      // 确保暂停状态被清除
      this.isPaused = false;
      this.isCancelled = false;

      // 恢复模式下发送 plan:resumed 事件而不是 plan:started
      this.emitEvent('plan:resumed', {
        planId: plan.id,
        blueprintId: plan.blueprintId,
        totalTasks: plan.tasks.length,
        completedTasks: plan.tasks.filter(t => t.status === 'completed').length,
        mode: 'lead-agent',
        isResume: true,
      });
    } else {
      // 全新启动：重置所有状态
      this.reset();
      this.currentPlan = plan;
      this.startTime = new Date();
      this.isExecuting = true;

      // 发送计划开始事件
      this.emitEvent('plan:started', {
        planId: plan.id,
        blueprintId: plan.blueprintId,
        totalTasks: plan.tasks.length,
        mode: 'lead-agent',
      });
    }

    // 创建 LeadAgent（v12.1: TaskPlan 优先，确保 LeadAgent 收到完整任务列表）
    const leadAgentConfig: LeadAgentConfig = {
      blueprint: this.currentTaskPlan || this.currentBlueprint,
      executionPlan: plan,
      projectPath: this.projectPath,
      model: this.config.leadAgentModel || 'sonnet',
      maxTurns: this.config.leadAgentMaxTurns || 200,
      swarmConfig: this.config,
      isResume,
      onEvent: (event) => {
        // 转发 LeadAgent 事件到 WebSocket
        this.emitEvent(event.type, event.data);
      },
      // 认证透传：避免子 agent 走 initAuth() 拿到错误的认证
      apiKey: this.config.apiKey,
      authToken: this.config.authToken,
      baseUrl: this.config.baseUrl,
    };

    const leadAgent = new LeadAgent(leadAgentConfig);
    this.currentLeadAgent = leadAgent;

    // 转发 LeadAgent 的 system_prompt 事件（供前端查看提示词）
    leadAgent.on('lead:system_prompt', (data: { systemPrompt: string }) => {
      this.emit('lead:system_prompt', {
        ...data,
        blueprintId: this.currentBlueprint?.id,
      });
    });

    // 转发 LeadAgent 的流式事件（不经过 emitEvent，避免 eventLog 膨胀）
    leadAgent.on('lead:stream', (data) => {
      this.emit('lead:stream', {
        ...data,
        blueprintId: this.currentBlueprint?.id,
      });
    });

    // 转发 LeadAgent 的阶段事件（lead:event 是包装后的事件）
    leadAgent.on('lead:event', (event) => {
      this.emit('lead:event', {
        ...event,
        blueprintId: this.currentBlueprint?.id,
      });
    });

    // v9.0 fix: 转发 Worker 的流式事件（DispatchWorkerTool → LeadAgent → Coordinator → WebSocket）
    leadAgent.on('worker:stream', (data: any) => {
      this.emit('worker:stream', {
        ...data,
        blueprintId: this.currentBlueprint?.id,
      });
    });

    // v9.1: 转发 E2E 完成事件（LeadAgent ↔ E2E Agent 双向通信）
    leadAgent.on('lead:e2e_completed', (data: any) => {
      this.emit('lead:e2e_completed', {
        ...data,
        blueprintId: this.currentBlueprint?.id,
      });
    });

    // v9.0: 监听 LeadAgent 的任务计划更新事件 → 更新 currentPlan → 广播给前端
    leadAgent.on('task:plan_update', (update: import('./types.js').TaskPlanUpdateInput) => {
      if (!this.currentPlan) return;

      const { action, taskId } = update;

      switch (action) {
        case 'start_task': {
          // 更新任务状态为 running
          const task = this.currentPlan.tasks.find(t => t.id === taskId);
          if (task) {
            task.status = 'running';
            task.executionMode = update.executionMode || 'lead-agent';
            task.startedAt = new Date();
            // 广播 swarm:task_update 给前端
            this.emit('task:status_changed', {
              blueprintId: this.currentBlueprint?.id,
              taskId,
              updates: { status: 'running', executionMode: task.executionMode, startedAt: task.startedAt.toISOString() },
            });
          }
          break;
        }
        case 'complete_task': {
          const task = this.currentPlan.tasks.find(t => t.id === taskId);
          if (task) {
            task.status = 'completed';
            task.completedAt = new Date();
            this.emit('task:status_changed', {
              blueprintId: this.currentBlueprint?.id,
              taskId,
              updates: { status: 'completed', completedAt: task.completedAt.toISOString(), summary: update.summary },
            });
          }
          break;
        }
        case 'fail_task': {
          const task = this.currentPlan.tasks.find(t => t.id === taskId);
          if (task) {
            task.status = 'failed';
            task.completedAt = new Date();
            this.emit('task:status_changed', {
              blueprintId: this.currentBlueprint?.id,
              taskId,
              updates: { status: 'failed', completedAt: task.completedAt.toISOString(), error: update.error },
            });
          }
          break;
        }
        case 'skip_task': {
          const task = this.currentPlan.tasks.find(t => t.id === taskId);
          if (task) {
            task.status = 'skipped';
            this.emit('task:status_changed', {
              blueprintId: this.currentBlueprint?.id,
              taskId,
              updates: { status: 'skipped', skipReason: update.reason },
            });
          }
          break;
        }
        case 'add_task': {
          // 动态添加新任务到执行计划
          const newTask: SmartTask = {
            id: taskId,
            name: update.name || `动态任务: ${taskId}`,
            description: update.description || '',
            type: (update.type as SmartTask['type']) || 'code',
            complexity: (update.complexity as SmartTask['complexity']) || 'moderate',
            category: 'other',
            blueprintId: this.currentPlan.blueprintId,
            files: update.files || [],
            dependencies: update.dependencies || [],
            needsTest: false,
            estimatedMinutes: 10,
            status: 'pending',
            executionMode: 'lead-agent',
          };
          this.currentPlan.tasks.push(newTask);

          // 添加到最后一个并行组（或新建一组）
          if (this.currentPlan.parallelGroups.length > 0) {
            this.currentPlan.parallelGroups[this.currentPlan.parallelGroups.length - 1].push(taskId);
          } else {
            this.currentPlan.parallelGroups.push([taskId]);
          }

          // 广播新任务添加事件
          this.emit('task:status_changed', {
            blueprintId: this.currentBlueprint?.id,
            taskId,
            action: 'add',
            task: newTask,
          });
          break;
        }
      }

      // 自动保存执行状态
      if (this.autoSaveEnabled && this.projectPath) {
        this.saveExecutionState();
      }
    });

    try {
      const result = await leadAgent.run();

      // 合并 taskResults
      for (const [taskId, taskResult] of result.taskResults) {
        this.taskResults.set(taskId, taskResult);
      }

      // v9.1 fix: 清理孤儿 "running" 任务
      // LeadAgent 可能因 maxTurns 耗尽或主动退出，导致部分任务卡在 running 状态
      if (this.currentPlan) {
        for (const task of this.currentPlan.tasks) {
          if (task.status === 'running') {
            const hasResult = result.taskResults.has(task.id);
            if (!hasResult) {
              console.log(`[RealtimeCoordinator] Cleaning up orphan task: ${task.id} (${task.name}) - LeadAgent has ended but task is still running`);
              task.status = 'failed';
              task.result = { success: false, changes: [], decisions: [], error: 'LeadAgent 执行结束，任务未完成' };
              task.completedAt = new Date();
              result.failedTasks.push(task.id);

              // 通知前端更新任务状态
              this.emit('task:status_changed', {
                blueprintId: this.currentBlueprint?.id,
                taskId: task.id,
                updates: {
                  status: 'failed',
                  error: 'LeadAgent 执行结束，任务未完成',
                  completedAt: new Date().toISOString(),
                },
              });
            }
          }
        }
      }

      // 转换 LeadAgent 结果为 ExecutionResult
      const executionResult: ExecutionResult = {
        success: result.success,
        planId: plan.id,
        blueprintId: plan.blueprintId,
        taskResults: this.taskResults,
        totalDuration: result.durationMs,
        totalCost: result.estimatedCost,
        completedCount: result.completedTasks.length,
        failedCount: result.failedTasks.length,
        skippedCount: 0,
        issues: this.issues,
        rawResponse: result.rawResponse,  // v10.0: 传递 LeadAgent 完整输出给 Planner
      };

      // 发送完成事件
      this.emitEvent('plan:completed', {
        planId: plan.id,
        success: result.success,
        completedCount: result.completedTasks.length,
        failedCount: result.failedTasks.length,
        duration: result.durationMs,
        mode: 'lead-agent',
      });

      this.isExecuting = false;
      return executionResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.emitEvent('plan:failed' as SwarmEventType, {
        planId: plan.id,
        error: errorMsg,
        mode: 'lead-agent',
      });

      this.isExecuting = false;

      return {
        success: false,
        planId: plan.id,
        blueprintId: plan.blueprintId,
        taskResults: new Map(),
        totalDuration: Date.now() - (this.startTime?.getTime() || Date.now()),
        totalCost: 0,
        completedCount: 0,
        failedCount: 0,
        skippedCount: 0,
        issues: [{
          id: uuidv4(),
          taskId: 'lead-agent',
          type: 'error',
          description: `LeadAgent 执行失败: ${errorMsg}`,
          timestamp: new Date(),
          resolved: false,
        }],
      };
    }
  }

  /**
   * v3.0: 从当前状态继续执行
   * v9.0: LeadAgent 模式下不支持，LeadAgent 自行管理执行流程
   */
  async continueExecution(): Promise<ExecutionResult> {
    console.warn('[RealtimeCoordinator] LeadAgent mode does not support continueExecution, please restart execution');
    return this.buildResult(false, 'LeadAgent 模式不支持 continueExecution');
  }

  /**
   * 暂停执行
   */
  pause(): void {
    if (!this.isPaused && !this.isCancelled) {
      this.isPaused = true;
      // v9.1: 在 LeadAgent 模式下，暂停 = 中止 LeadAgent + 保存状态
      // 恢复时通过 unpause() 以 isResume 模式重启
      if (this.currentLeadAgent) {
        console.log('[RealtimeCoordinator] Pausing execution: aborting LeadAgent and saving state');
        this.currentLeadAgent.stop();
        // 将正在运行的任务重置为 pending（避免卡在 running 状态）
        if (this.currentPlan) {
          for (const task of this.currentPlan.tasks) {
            if (task.status === 'running') {
              task.status = 'pending';
              task.startedAt = undefined;
              this.emit('task:status_changed', {
                blueprintId: this.currentBlueprint?.id,
                taskId: task.id,
                updates: { status: 'pending' },
              });
            }
          }
        }
        if (this.autoSaveEnabled && this.projectPath) {
          this.saveExecutionState();
        }
      }
      this.emitEvent('plan:paused', {
        planId: this.currentPlan?.id,
        status: this.getStatus(),
      });
    }
  }

  /**
   * 取消暂停，继续执行（暂停后调用）
   * v9.1: 在 LeadAgent 模式下，返回 true 表示需要调用方以 isResume 模式重启执行
   */
  unpause(): boolean {
    if (this.isPaused) {
      this.isPaused = false;
      if (this.pauseResolve) {
        this.pauseResolve();
        this.pauseResolve = null;
      }
      this.emitEvent('plan:unpaused', {
        planId: this.currentPlan?.id,
        status: this.getStatus(),
      });
      // v9.1: 如果 LeadAgent 已被中止，返回 true 告诉调用方需要重启
      if (!this.isExecuting && this.currentPlan) {
        return true;  // 需要 isResume 重启
      }
    }
    return false;
  }

  /**
   * 取消执行
   * v9.1: 在 LeadAgent 模式下，直接中止 LeadAgent 的 ConversationLoop
   */
  cancel(): void {
    if (!this.isCancelled) {
      this.isCancelled = true;
      // 如果处于暂停状态，解除暂停让主循环退出
      if (this.pauseResolve) {
        this.pauseResolve();
        this.pauseResolve = null;
      }
      // v9.1: 中止 LeadAgent 的 ConversationLoop
      if (this.currentLeadAgent) {
        console.log('[RealtimeCoordinator] Canceling execution: aborting LeadAgent');
        this.currentLeadAgent.stop();
      }
      this.emitEvent('plan:cancelled', {
        planId: this.currentPlan?.id,
        status: this.getStatus(),
      });
    }
  }

  /**
   * 获取暂停状态
   */
  get paused(): boolean {
    return this.isPaused;
  }

  /**
   * 检查执行是否还在活跃状态
   * 用于判断会话是否为"僵尸"状态（completedAt 未设置但执行已结束）
   * v2.3: 使用 isExecuting 标志而不是推断
   */
  isActive(): boolean {
    // 如果没有计划，肯定不活跃
    if (!this.currentPlan) {
      return false;
    }

    // 如果被取消了，不活跃
    if (this.isCancelled) {
      return false;
    }

    // 如果处于暂停状态，认为是活跃的（等待恢复）
    if (this.isPaused) {
      return true;
    }

    // v2.3: 使用 isExecuting 标志来判断执行循环是否真的在运行
    // 这解决了"僵尸会话"问题：执行循环退出但 completedTasks < totalTasks
    return this.isExecuting;
  }

  /**
   * v2.3: 检查是否处于僵尸状态
   * 僵尸状态：有未完成的任务，但执行循环已停止
   */
  isZombie(): boolean {
    if (!this.currentPlan || this.isCancelled) {
      return false;
    }

    // 如果正在执行或暂停，不是僵尸
    if (this.isExecuting || this.isPaused) {
      return false;
    }

    // 检查是否有未完成的任务
    const completedTasks = Array.from(this.taskResults.values()).length;
    const totalTasks = this.currentPlan.tasks.length;

    // 有未完成的任务但执行循环已停止 = 僵尸状态
    return completedTasks < totalTasks;
  }

  /**
   * 运行时修改任务描述
   * 下次执行该任务时生效
   */
  modifyTask(taskId: string, newDescription: string): void {
    const existing = this.taskModifications.get(taskId) || {};
    this.taskModifications.set(taskId, { ...existing, newDescription });
    this.emitEvent('task:modified', {
      taskId,
      newDescription,
    });
  }

  /**
   * v3.8: 跳过失败的任务
   * 将任务标记为跳过，然后检查是否可以继续执行下一组
   * @param taskId 要跳过的任务 ID
   * @returns 是否成功跳过
   */
  skipTask(taskId: string): boolean {
    if (!this.currentPlan) {
      console.warn('[RealtimeCoordinator] Cannot skip task: no execution plan');
      return false;
    }

    const task = this.currentPlan.tasks.find(t => t.id === taskId);
    if (!task) {
      console.warn(`[RealtimeCoordinator] Cannot skip task: task ${taskId} not found`);
      return false;
    }

    // 🔧 修复：使用与 getTasksWithStatus 相同的状态推断逻辑
    const result = this.taskResults.get(taskId);
    let actualStatus: TaskStatus = task.status || 'pending';
    if (result) {
      if (result.error === '任务被跳过') {
        actualStatus = 'skipped';
      } else {
        actualStatus = result.success ? 'completed' : 'failed';
      }
    }

    // 只能跳过失败或待执行的任务
    if (actualStatus !== 'failed' && actualStatus !== 'pending') {
      console.warn(`[RealtimeCoordinator] Cannot skip task: task ${taskId} status is ${actualStatus}`);
      return false;
    }

    console.log(`[RealtimeCoordinator] Skipping task: ${task.name} (${taskId})`;

    // 更新任务状态
    task.status = 'skipped';
    task.completedAt = new Date();

    // 标记为跳过
    this.taskModifications.set(taskId, {
      ...this.taskModifications.get(taskId),
      skip: true,
    });

    // 记录跳过结果
    this.taskResults.set(taskId, {
      success: false,
      changes: [],
      decisions: [],
      error: '任务被跳过',
    });

    // 发送任务跳过事件
    this.emitEvent('task:skipped', {
      taskId,
      taskName: task.name,
    });

    // 发送进度更新
    this.emitProgressUpdate();

    // 保存状态
    if (this.autoSaveEnabled && this.projectPath) {
      this.saveExecutionState();
    }

    return true;
  }

  /**
   * v9.1: LeadAgent 模式下的任务重试
   * - 如果 LeadAgent 正在执行：通过插嘴机制注入重试指令，返回 true
   * - 如果 LeadAgent 已结束：重置任务状态，返回 false（调用方负责重启执行）
   */
  async retryTask(taskId: string): Promise<boolean> {
    if (!this.currentPlan) {
      console.warn('[RealtimeCoordinator] Cannot retry task: no execution plan');
      return false;
    }

    const task = this.currentPlan.tasks.find(t => t.id === taskId);
    if (!task) {
      console.warn(`[RealtimeCoordinator] Cannot retry task: task ${taskId} not found`);
      return false;
    }

    if (task.status !== 'failed') {
      console.warn(`[RealtimeCoordinator] Cannot retry task: task ${taskId} status is ${task.status}, not failed`);
      return false;
    }

    console.log(`[RealtimeCoordinator] Retrying task: ${task.name} (${taskId})`);

    // 重置任务状态
    task.status = 'pending';
    task.completedAt = undefined;
    task.result = undefined;

    // 从 taskResults 中移除
    this.taskResults.delete(taskId);

    // 通知前端状态变更
    this.emit('task:status_changed', {
      blueprintId: this.currentBlueprint?.id,
      taskId,
      updates: { status: 'pending' },
    });

    // 如果 LeadAgent 正在执行，通过插嘴机制通知
    if (this.isExecuting && this.currentLeadAgent) {
      const loop = this.currentLeadAgent.getLoop();
      if (loop) {
        const session = loop.getSession();
        session.addMessage({
          role: 'user',
          content: `[系统通知] 用户请求重试失败的任务 "${task.name}" (${taskId})。该任务状态已重置为 pending，请重新执行此任务。`,
        });
        console.log(`[RealtimeCoordinator] Injected retry instruction to running LeadAgent: ${taskId}`);

        if (this.autoSaveEnabled && this.projectPath) {
          this.saveExecutionState();
        }
        return true;
      }
    }

    // LeadAgent 未在执行中，保存状态，返回 false 让调用方重启执行
    console.log(`[RealtimeCoordinator] LeadAgent is not executing, caller needs to restart execution`);
    if (this.autoSaveEnabled && this.projectPath) {
      this.saveExecutionState();
    }
    return false;
  }

  /**
   * 获取当前执行状态
   */
  getStatus(): ExecutionStatus {
    const plan = this.currentPlan;
    if (!plan) {
      return {
        planId: '',
        blueprintId: '',
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        runningTasks: 0,
        activeWorkers: 0,
        startedAt: new Date(),
        currentCost: 0,
        estimatedTotalCost: 0,
        issues: [],
      };
    }

    const completedTasks = Array.from(this.taskResults.values()).filter(r => r.success).length;
    const failedTasks = Array.from(this.taskResults.values()).filter(r => !r.success).length;
    const runningTasks = this.activeWorkers.size;

    // 估算剩余成本
    const remainingTasks = plan.tasks.length - completedTasks - failedTasks;
    const avgCostPerTask = completedTasks > 0 ? this.currentCost / completedTasks : plan.estimatedCost / plan.tasks.length;
    const estimatedTotalCost = this.currentCost + (remainingTasks * avgCostPerTask);

    // 估算完成时间
    const elapsed = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    const avgTimePerTask = completedTasks > 0 ? elapsed / completedTasks : 60000;
    const estimatedRemainingTime = remainingTasks * avgTimePerTask;
    const estimatedCompletion = new Date(Date.now() + estimatedRemainingTime);

    return {
      planId: plan.id,
      blueprintId: plan.blueprintId,
      totalTasks: plan.tasks.length,
      completedTasks,
      failedTasks,
      runningTasks,
      activeWorkers: this.activeWorkers.size,
      startedAt: this.startTime || new Date(),
      estimatedCompletion,
      currentCost: this.currentCost,
      estimatedTotalCost,
      issues: this.issues,
    };
  }

  /**
   * v9.2: 获取当前 LeadAgent 实例（用于插嘴功能）
   */
  getLeadAgent(): LeadAgent | null {
    return this.currentLeadAgent;
  }

  /**
   * 获取 Agent 调试信息（探针功能）
   * @param agentType 'lead' | 'worker' | 'e2e'
   * @param workerId 当 agentType 为 'worker' 时，指定 Worker ID
   */
  getAgentDebugInfo(agentType: string, workerId?: string): { systemPrompt: string; messages: unknown[]; tools: unknown[]; model: string; messageCount: number; agentType: string; workerId?: string; taskId?: string | null } | null {
    if (agentType === 'lead') {
      return this.currentLeadAgent?.getDebugInfo() || null;
    }

    if (agentType === 'worker' && workerId) {
      const executor = this.activeWorkerExecutors.get(workerId);
      return executor?.getDebugInfo() || null;
    }

    // worker 但未指定 ID：返回第一个活跃的 Worker
    if (agentType === 'worker') {
      for (const [, executor] of this.activeWorkerExecutors) {
        if (executor.isExecuting()) {
          return executor.getDebugInfo();
        }
      }
      return null;
    }

    // e2e: 目前 E2ETestAgent 由 LeadAgent 通过 TriggerE2ETest 工具调用
    // 需要从 TriggerE2ETestTool 获取当前 Agent 实例
    // 这里返回 null，后续如果需要可以扩展
    return null;
  }

  /**
   * 获取所有活跃 Agent 的列表（探针功能 - 用于前端选择器）
   */
  getActiveAgents(): Array<{ agentType: string; id: string; label: string; taskId?: string }> {
    const agents: Array<{ agentType: string; id: string; label: string; taskId?: string }> = [];

    // LeadAgent
    if (this.currentLeadAgent) {
      agents.push({
        agentType: 'lead',
        id: 'lead-agent',
        label: 'LeadAgent (首席开发者)',
      });
    }

    // Workers
    for (const [workerId, executor] of this.activeWorkerExecutors) {
      if (executor.isExecuting()) {
        agents.push({
          agentType: 'worker',
          id: workerId,
          label: `Worker ${workerId}`,
          taskId: executor.getCurrentTaskId() || undefined,
        });
      }
    }

    return agents;
  }

  /**
   * 获取带有运行时状态的任务列表
   * 用于前端显示实时任务状态
   */
  getTasksWithStatus(): Array<SmartTask & {
    workerId?: string;
    error?: string;
    result?: TaskResult;
  }> {
    if (!this.currentPlan) {
      return [];
    }

    return this.currentPlan.tasks.map(task => {
      const result = this.taskResults.get(task.id);
      const activeWorker = Array.from(this.activeWorkers.entries()).find(
        ([_, worker]) => worker.currentTaskId === task.id
      );
      // 🔧 v8.3: 检查任务是否正在执行中（有执行锁）
      const isExecuting = this.executingTaskIds.has(task.id);

      // 🔧 v8.3: 修复刷新后执行中任务显示失败的问题
      // 优先级：
      // 1. 如果任务正在执行（有活跃 Worker 或执行锁），强制使用 running 状态
      // 2. 如果有 result，使用 result 的成功/失败状态
      // 3. 否则使用 task.status
      // 4. 如果都没有，默认为 pending
      let finalStatus: TaskStatus = task.status || 'pending';

      // 如果有活跃 Worker 或执行锁，强制使用 running 状态（忽略旧的 taskResults）
      if (activeWorker || isExecuting) {
        finalStatus = 'running';
      } else if (result) {
        if (result.error === '任务被跳过') {
          finalStatus = 'skipped';
        } else {
          finalStatus = result.success ? 'completed' : 'failed';
        }
      }

      return {
        ...task,
        status: finalStatus,
        workerId: activeWorker?.[0] || task.workerId,
        // 🔧 v8.3: 正在执行的任务不显示旧的错误
        error: (activeWorker || isExecuting) ? undefined : result?.error,
        result: (activeWorker || isExecuting) ? undefined : result,
      };
    });
  }

  /**
   * 获取当前执行计划
   */
  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  // ============================================================================
  // 私有方法 - 辅助函数
  // ============================================================================

  /**
   * 重置状态
   */
  private reset(): void {
    this.currentPlan = null;
    this.taskResults.clear();
    this.activeWorkers.clear();
    this.issues = [];
    this.isPaused = false;
    this.isCancelled = false;
    this.pauseResolve = null;
    this.taskModifications.clear();
    this.executingTaskIds.clear();
    this.activeWorkerExecutors.clear();
    this.currentLeadAgent = null;
    this.startTime = null;
    this.currentCost = 0;
  }

  /**
   * 构建执行结果
   */
  private buildResult(success: boolean, cancelReason?: string): ExecutionResult {
    const plan = this.currentPlan!;
    const duration = this.startTime ? Date.now() - this.startTime.getTime() : 0;

    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    this.taskResults.forEach((result, taskId) => {
      if (result.success) {
        completedCount++;
      } else if (result.error === '任务被跳过') {
        skippedCount++;
      } else {
        failedCount++;
      }
    });

    return {
      success,
      planId: plan.id,
      blueprintId: plan.blueprintId,
      taskResults: this.taskResults,
      totalDuration: duration,
      totalCost: this.currentCost,
      completedCount,
      failedCount,
      skippedCount,
      issues: this.issues,
      cancelReason,
    };
  }

  // ============================================================================
  // 私有方法 - 事件发送
  // ============================================================================

  /**
   * 发送蜂群事件
   */
  private emitEvent(type: SwarmEventType | string, data: Record<string, unknown>): void {
    const event: SwarmEvent = {
      type: type as SwarmEventType,
      timestamp: new Date(),
      data,
    };
    this.emit('swarm:event', event);
    this.emit(type, data);
  }

  /**
   * 发送进度更新事件
   */
  private emitProgressUpdate(): void {
    const status = this.getStatus();
    this.emitEvent('progress:update', {
      ...status,
      isPaused: this.isPaused,
      isCancelled: this.isCancelled,
    });
  }

  // ============================================================================
  // 持久化方法
  // ============================================================================

  /**
   * 设置项目路径（用于持久化）
   */
  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath;
  }

  /**
   * 启用/禁用自动保存
   */
  setAutoSave(enabled: boolean): void {
    this.autoSaveEnabled = enabled;
  }

  /**
   * 通知状态变化（v3.0 重构：不再写文件，改为事件通知）
   * 外部监听 'state:changed' 事件来保存状态到蓝图文件
   */
  saveExecutionState(): void {
    if (!this.currentPlan) {
      return;
    }

    try {
      const state = this.buildExecutionState();
      // v3.0: 发出状态变化事件，由外部决定如何持久化
      this.emitEvent('state:changed', { state });
    } catch (error) {
      console.error('[RealtimeCoordinator] Building execution state failed:', error);
    }
  }

  /**
   * @deprecated v3.0: 状态现在保存在蓝图文件中，不再使用独立的 execution-state.json
   */
  loadExecutionState(_projectPath?: string): ExecutionState | null {
    console.warn('[RealtimeCoordinator] loadExecutionState is deprecated, please use lastExecutionPlan in blueprint file');
    return null;
  }

  /**
   * @deprecated v3.0: 状态现在保存在蓝图文件中
   */
  deleteExecutionState(_projectPath?: string): void {
    // 不再需要删除文件，状态保存在蓝图中
  }

  /**
   * @deprecated v3.0: 状态现在保存在蓝图文件中
   */
  hasExecutionState(_projectPath?: string): boolean {
    return false;
  }

  /**
   * @deprecated v3.0: 使用蓝图文件中的 lastExecutionPlan
   */
  static loadStateFromProject(_projectPath: string): ExecutionState | null {
    console.warn('[RealtimeCoordinator] loadStateFromProject is deprecated, please use blueprint file');
    return null;
  }

  /**
   * @deprecated v3.0: 使用蓝图文件中的 lastExecutionPlan
   */
  static hasRecoverableState(_projectPath: string): boolean {
    return false;
  }

  /**
   * 构建可序列化的执行状态对象
   * 包含完整的 ExecutionPlan，支持重启后恢复
   */
  private buildExecutionState(): ExecutionState {
    const plan = this.currentPlan!;

    // 序列化 ExecutionPlan
    const serializablePlan: SerializableExecutionPlan = {
      id: plan.id,
      blueprintId: plan.blueprintId,
      tasks: plan.tasks.map(task => this.serializeTask(task)),
      parallelGroups: plan.parallelGroups,
      estimatedCost: plan.estimatedCost,
      estimatedMinutes: plan.estimatedMinutes,
      autoDecisions: plan.autoDecisions,
      status: plan.status,
      createdAt: plan.createdAt.toISOString(),
      startedAt: plan.startedAt?.toISOString(),
      completedAt: plan.completedAt?.toISOString(),
    };

    // 分类任务状态
    const completedTaskIds: string[] = [];
    const failedTaskIds: string[] = [];
    const skippedTaskIds: string[] = [];

    this.taskResults.forEach((result, taskId) => {
      if (result.success) {
        completedTaskIds.push(taskId);
      } else if (result.error === '任务被跳过') {
        skippedTaskIds.push(taskId);
      } else {
        failedTaskIds.push(taskId);
      }
    });

    // 序列化任务结果
    const taskResults: SerializableTaskResult[] = [];
    this.taskResults.forEach((result, taskId) => {
      taskResults.push({
        taskId,
        success: result.success,
        changes: result.changes,
        testsRan: result.testsRan,
        testsPassed: result.testsPassed,
        error: result.error,
        decisions: result.decisions.map(d => ({
          type: d.type,
          description: d.description,
          timestamp: d.timestamp.toISOString(),
        })),
      });
    });

    // 序列化问题列表
    const issues: SerializableExecutionIssue[] = this.issues.map(issue => ({
      id: issue.id,
      taskId: issue.taskId,
      type: issue.type,
      description: issue.description,
      timestamp: issue.timestamp.toISOString(),
      resolved: issue.resolved,
      resolution: issue.resolution,
    }));

    // 序列化任务修改
    const taskModifications: { taskId: string; newDescription?: string; skip?: boolean }[] = [];
    this.taskModifications.forEach((mod, taskId) => {
      taskModifications.push({ taskId, ...mod });
    });

    return {
      plan: serializablePlan,
      projectPath: this.projectPath,
      currentGroupIndex: this.currentGroupIndex,
      completedTaskIds,
      failedTaskIds,
      skippedTaskIds,
      taskResults,
      issues,
      taskModifications,
      currentCost: this.currentCost,
      startedAt: this.startTime?.toISOString() || new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      pausedAt: this.isPaused ? new Date().toISOString() : undefined,
      isPaused: this.isPaused,
      isCancelled: this.isCancelled,
      version: EXECUTION_STATE_VERSION,
    };
  }

  /**
   * 序列化单个任务
   */
  private serializeTask(task: SmartTask): SerializableSmartTask {
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      type: task.type,
      complexity: task.complexity,
      blueprintId: task.blueprintId,
      moduleId: task.moduleId,
      files: task.files,
      dependencies: task.dependencies,
      needsTest: task.needsTest,
      estimatedMinutes: task.estimatedMinutes,
      status: task.status,
      workerId: task.workerId,
      startedAt: task.startedAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    };
  }

  /**
   * 从保存的状态恢复（包含完整的 ExecutionPlan）
   * v2.2: 改为 public，支持外部恢复会话
   */
  public restoreFromState(state: ExecutionState): void {
    // 反序列化 ExecutionPlan
    const plan = this.deserializePlan(state.plan);

    // 设置基础状态
    this.currentPlan = plan;
    this.projectPath = state.projectPath;
    this.currentGroupIndex = state.currentGroupIndex;
    this.currentCost = state.currentCost;
    this.startTime = new Date(state.startedAt);
    this.isPaused = state.isPaused;
    this.isCancelled = state.isCancelled;

    // 恢复任务结果
    this.taskResults.clear();
    for (const result of state.taskResults) {
      this.taskResults.set(result.taskId, {
        success: result.success,
        changes: result.changes,
        testsRan: result.testsRan,
        testsPassed: result.testsPassed,
        error: result.error,
        decisions: result.decisions.map(d => ({
          type: d.type as any,
          description: d.description,
          timestamp: new Date(d.timestamp),
        })),
      });

      // 同步更新任务状态
      const task = plan.tasks.find(t => t.id === result.taskId);
      if (task) {
        task.status = result.success ? 'completed' : (result.error === '任务被跳过' ? 'skipped' : 'failed');
      }
    }

    // 恢复问题列表
    this.issues = state.issues.map(issue => ({
      id: issue.id,
      taskId: issue.taskId,
      type: issue.type,
      description: issue.description,
      timestamp: new Date(issue.timestamp),
      resolved: issue.resolved,
      resolution: issue.resolution,
    }));

    // 恢复任务修改
    this.taskModifications.clear();
    for (const mod of state.taskModifications) {
      this.taskModifications.set(mod.taskId, {
        newDescription: mod.newDescription,
        skip: mod.skip,
      });
    }

    console.log(`[RealtimeCoordinator] State restored: completed ${state.completedTaskIds.length} tasks, failed ${state.failedTaskIds.length}, skipped ${state.skippedTaskIds.length}`);
  }

  /**
   * 反序列化 ExecutionPlan
   */
  private deserializePlan(serialized: SerializableExecutionPlan): ExecutionPlan {
    // 反序列化任务并过滤掉无效任务
    const tasks = serialized.tasks
      .map(task => this.deserializeTask(task))
      .filter((task): task is SmartTask => task !== null);

    // 如果过滤后任务数量变化，需要同步更新并行组
    const validTaskIds = new Set(tasks.map(t => t.id));
    const parallelGroups = serialized.parallelGroups
      .map(group => group.filter(taskId => validTaskIds.has(taskId)))
      .filter(group => group.length > 0);

    if (tasks.length !== serialized.tasks.length) {
      console.warn(`[RealtimeCoordinator] Filtered ${serialized.tasks.length - tasks.length} invalid tasks`);
    }

    return {
      id: serialized.id,
      blueprintId: serialized.blueprintId,
      tasks,
      parallelGroups,
      estimatedCost: serialized.estimatedCost,
      estimatedMinutes: serialized.estimatedMinutes,
      autoDecisions: serialized.autoDecisions || [],
      status: serialized.status,
      createdAt: new Date(serialized.createdAt),
      startedAt: serialized.startedAt ? new Date(serialized.startedAt) : undefined,
      completedAt: serialized.completedAt ? new Date(serialized.completedAt) : undefined,
    };
  }

  /**
   * 反序列化单个任务
   * 添加防御性检查，确保必要字段存在
   */
  private deserializeTask(serialized: SerializableSmartTask): SmartTask | null {
    // 防御性检查：确保必要字段存在
    if (!serialized.name) {
      console.warn(`[RealtimeCoordinator] Task ${serialized.id} missing name field, skipping`);
      return null;
    }

    return {
      id: serialized.id,
      name: serialized.name,
      description: serialized.description || serialized.name,
      type: serialized.type || 'code',
      complexity: serialized.complexity || 'simple',
      blueprintId: serialized.blueprintId,
      moduleId: serialized.moduleId,
      files: Array.isArray(serialized.files) ? serialized.files : [],
      dependencies: serialized.dependencies || [],
      needsTest: serialized.needsTest ?? true,
      estimatedMinutes: serialized.estimatedMinutes || 5,
      status: serialized.status || 'pending',
      workerId: serialized.workerId,
      startedAt: serialized.startedAt ? new Date(serialized.startedAt) : undefined,
      completedAt: serialized.completedAt ? new Date(serialized.completedAt) : undefined,
    };
  }

  // ============================================================================
  // 🐝 冲突管理方法
  // ============================================================================

  /**
   * 注册一个待处理的冲突
   * 返回一个 Promise，当用户做出决策时 resolve
   */
  registerConflict(conflict: PendingConflict): Promise<HumanDecisionRequest> {
    return new Promise((resolve) => {
      // 保存冲突和解决回调
      this.pendingConflicts.set(conflict.id, conflict);
      this.conflictResolvers.set(conflict.id, resolve);

      // 发送冲突事件通知前端
      this.emitEvent('conflict:needs_human', {
        conflict: this.serializeConflict(conflict),
      });

      console.log(`[Coordinator] 🔴 Conflict registered: ${conflict.id}, waiting for manual intervention...`);
    });
  }

  /**
   * 处理用户的冲突决策
   */
  resolveConflict(decision: HumanDecisionRequest): HumanDecisionResult {
    const conflict = this.pendingConflicts.get(decision.conflictId);
    const resolver = this.conflictResolvers.get(decision.conflictId);

    if (!conflict || !resolver) {
      return {
        success: false,
        conflictId: decision.conflictId,
        message: `冲突 ${decision.conflictId} 不存在或已解决`,
      };
    }

    // 更新冲突状态
    conflict.status = 'resolved';
    this.pendingConflicts.delete(decision.conflictId);
    this.conflictResolvers.delete(decision.conflictId);

    // 调用解决回调，继续执行流程
    resolver(decision);

    // 发送冲突已解决事件
    this.emitEvent('conflict:resolved', {
      conflictId: decision.conflictId,
      decision: decision.decision,
    });

    console.log(`[Coordinator] ✅ Conflict resolved: ${decision.conflictId}, decision: ${decision.decision}`);

    return {
      success: true,
      conflictId: decision.conflictId,
      message: '冲突已解决',
    };
  }

  /**
   * 获取所有待处理的冲突
   */
  getPendingConflicts(): PendingConflict[] {
    return Array.from(this.pendingConflicts.values());
  }

  /**
   * 获取指定冲突
   */
  getConflict(conflictId: string): PendingConflict | undefined {
    return this.pendingConflicts.get(conflictId);
  }

  /**
   * 序列化冲突（用于发送给前端）
   */
  private serializeConflict(conflict: PendingConflict): Record<string, unknown> {
    return {
      id: conflict.id,
      workerId: conflict.workerId,
      taskId: conflict.taskId,
      taskName: conflict.taskName,
      branchName: conflict.branchName,
      files: conflict.files,
      timestamp: conflict.timestamp.toISOString(),
      status: conflict.status,
    };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建实时协调器实例
 */
export function createRealtimeCoordinator(config?: Partial<SwarmConfig>): RealtimeCoordinator {
  return new RealtimeCoordinator(config);
}

/**
 * 创建模拟任务执行器（用于测试）
 */
export function createMockTaskExecutor(
  delayMs: number = 100,
  successRate: number = 0.9
): TaskExecutor {
  return {
    async execute(task: SmartTask, workerId: string): Promise<TaskResult> {
      // 模拟执行延迟
      await new Promise(resolve => setTimeout(resolve, delayMs));

      // 根据成功率决定是否成功
      const success = Math.random() < successRate;

      const decisions: WorkerDecision[] = [
        {
          type: 'strategy',
          description: `Worker ${workerId} 执行策略：直接实现`,
          timestamp: new Date(),
        },
      ];

      if (success) {
        const changes: FileChange[] = task.files.map(file => ({
          filePath: file,
          type: 'modify' as const,
          content: `// 模拟生成的代码 for ${task.name}`,
        }));

        return {
          success: true,
          changes,
          testsRan: task.needsTest,
          testsPassed: true,
          decisions,
        };
      } else {
        return {
          success: false,
          changes: [],
          error: '模拟执行失败',
          decisions,
        };
      }
    },
  };
}
