/**
 * Blueprint 工具 - 蜂群架构 v3.0 串行执行版
 *
 * 简化的蓝图管理接口：
 * - plan: 开始需求对话并生成蓝图
 * - execute: 执行蓝图
 * - status: 查看执行状态
 * - pause: 暂停执行
 * - resume: 恢复执行
 * - cancel: 取消执行
 *
 * 核心组件：
 * - SmartPlanner: 需求对话、蓝图生成、任务分解
 * - RealtimeCoordinator: 执行协调
 * - AutonomousWorkerExecutor: Worker执行
 * - TaskQueue: 串行任务队列
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import {
  SmartPlanner,
  smartPlanner,
  RealtimeCoordinator,
  createRealtimeCoordinator,
  AutonomousWorkerExecutor,
  createAutonomousWorker,
  type Blueprint,
  type ExecutionPlan,
  type ExecutionStatus,
  type DialogState,
  type SmartTask,
  type TaskResult,
  type SwarmConfig,
  type TechStack,
  DEFAULT_SWARM_CONFIG,
} from '../blueprint/index.js';

// ============================================================================
// 输入类型定义
// ============================================================================

/**
 * Blueprint 工具输入参数
 */
export interface BlueprintToolInput {
  /** 操作类型 */
  action:
    | 'plan'      // 开始需求对话并生成蓝图
    | 'execute'   // 执行蓝图
    | 'status'    // 查看执行状态
    | 'pause'     // 暂停执行
    | 'resume'    // 恢复执行
    | 'cancel';   // 取消执行

  // ---- plan 阶段参数 ----

  /** 项目路径（plan时使用，默认为当前目录） */
  projectPath?: string;

  /** 用户输入（plan对话时使用） */
  userInput?: string;

  /** 会话ID（继续已有对话时使用） */
  sessionId?: string;

  // ---- execute 阶段参数 ----

  /** 蓝图ID（execute时使用） */
  blueprintId?: string;

  /** 执行计划ID（execute时使用，如果已有计划） */
  planId?: string;

  /** 蜂群配置（可选，覆盖默认配置） */
  config?: Partial<SwarmConfig>;
}

// ============================================================================
// 执行状态管理器（单例）
// ============================================================================

/**
 * 执行状态管理器
 * 管理当前执行的协调器、蓝图和计划
 */
class ExecutionStateManager {
  // 当前协调器
  private coordinator: RealtimeCoordinator | null = null;
  // 当前蓝图
  private currentBlueprint: Blueprint | null = null;
  // 当前执行计划
  private currentPlan: ExecutionPlan | null = null;
  // 当前对话状态
  private currentDialogState: DialogState | null = null;
  // 当前会话ID
  private currentSessionId: string | null = null;

  // 规划器实例
  private planner: SmartPlanner = smartPlanner;

  /**
   * 获取或创建协调器
   */
  getOrCreateCoordinator(config?: Partial<SwarmConfig>): RealtimeCoordinator {
    if (!this.coordinator) {
      this.coordinator = createRealtimeCoordinator(config);

      // 设置任务执行器
      const worker = createAutonomousWorker(config);
      this.coordinator.setTaskExecutor({
        async execute(task: SmartTask, workerId: string): Promise<TaskResult> {
          // 获取当前蓝图的上下文
          const blueprint = executionState.getCurrentBlueprint();
          if (!blueprint) {
            throw new Error('没有活跃的蓝图');
          }

          // 构建 Worker 上下文
          // 确保 config 是完整的 SwarmConfig 类型
          const fullConfig: SwarmConfig = { ...DEFAULT_SWARM_CONFIG, ...config };
          const context: import('../blueprint/index.js').WorkerContext = {
            projectPath: blueprint.projectPath,
            techStack: blueprint.techStack,
            config: fullConfig,
            constraints: blueprint.constraints,
          };

          // 执行任务
          return worker.execute(task, context);
        },
      });
    }
    return this.coordinator;
  }

  /**
   * 获取规划器
   */
  getPlanner(): SmartPlanner {
    return this.planner;
  }

  /**
   * 设置当前蓝图
   */
  setCurrentBlueprint(blueprint: Blueprint): void {
    this.currentBlueprint = blueprint;
  }

  /**
   * 获取当前蓝图
   */
  getCurrentBlueprint(): Blueprint | null {
    return this.currentBlueprint;
  }

  /**
   * 设置当前执行计划
   */
  setCurrentPlan(plan: ExecutionPlan): void {
    this.currentPlan = plan;
  }

  /**
   * 获取当前执行计划
   */
  getCurrentPlan(): ExecutionPlan | null {
    return this.currentPlan;
  }

  /**
   * 设置对话状态
   */
  setDialogState(sessionId: string, state: DialogState): void {
    this.currentSessionId = sessionId;
    this.currentDialogState = state;
  }

  /**
   * 获取对话状态
   */
  getDialogState(): { sessionId: string; state: DialogState } | null {
    if (this.currentSessionId && this.currentDialogState) {
      return {
        sessionId: this.currentSessionId,
        state: this.currentDialogState,
      };
    }
    return null;
  }

  /**
   * 获取协调器（如果存在）
   */
  getCoordinator(): RealtimeCoordinator | null {
    return this.coordinator;
  }

  /**
   * 重置执行状态
   */
  reset(): void {
    this.coordinator = null;
    this.currentPlan = null;
  }

  /**
   * 清除对话状态
   */
  clearDialogState(): void {
    this.currentSessionId = null;
    this.currentDialogState = null;
  }
}

// 全局执行状态管理器
const executionState = new ExecutionStateManager();

// ============================================================================
// Blueprint 工具实现
// ============================================================================

export class BlueprintTool extends BaseTool<BlueprintToolInput, ToolResult> {
  name = 'Blueprint';
  description = `蜂群架构 v2.0 - 智能项目规划与执行工具

核心功能：
1. plan - 开始需求对话，智能生成蓝图和执行计划
2. execute - 启动自治 Worker 并行执行任务
3. status - 实时查看执行状态和进度
4. pause - 暂停执行（可随时恢复）
5. resume - 恢复暂停的执行
6. cancel - 取消执行

使用流程：
1. 调用 plan 开始需求对话
2. 回答几个关键问题（约2-3轮对话）
3. 确认后自动生成蓝图和任务分解
4. 调用 execute 开始执行
5. 使用 status 监控进度

蜂群特性：
- 自治 Worker：无需逐步批准，自主决策
- 智能测试：AI 判断是否需要测试
- Git 并发：分支代替文件锁
- 自动重试：失败任务自动修复重试`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'execute', 'status', 'pause', 'resume', 'cancel'],
          description: '要执行的操作',
        },
        projectPath: {
          type: 'string',
          description: '项目路径（plan时使用，默认为当前目录）',
        },
        userInput: {
          type: 'string',
          description: '用户输入（plan对话时使用）',
        },
        sessionId: {
          type: 'string',
          description: '会话ID（继续已有对话时使用）',
        },
        blueprintId: {
          type: 'string',
          description: '蓝图ID（execute时使用）',
        },
        planId: {
          type: 'string',
          description: '执行计划ID（execute时使用）',
        },
        config: {
          type: 'object',
          description: '蜂群配置（可选）',
          properties: {
            maxWorkers: { type: 'number', description: '最大并发Worker数' },
            maxRetries: { type: 'number', description: '最大重试次数' },
            autoTest: { type: 'boolean', description: '是否自动判断测试需求' },
            maxCost: { type: 'number', description: '最大成本限制（美元）' },
          },
        },
      },
      required: ['action'],
    };
  }

  async execute(input: BlueprintToolInput): Promise<ToolResult> {
    try {
      switch (input.action) {
        case 'plan':
          return await this.handlePlan(input);
        case 'execute':
          return await this.handleExecute(input);
        case 'status':
          return this.handleStatus();
        case 'pause':
          return this.handlePause();
        case 'resume':
          return this.handleResume();
        case 'cancel':
          return this.handleCancel();
        default:
          return { success: false, error: t('blueprint.unknownAction', { action: String(input.action) }) };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // --------------------------------------------------------------------------
  // plan: 需求对话和蓝图生成
  // --------------------------------------------------------------------------

  /**
   * 处理 plan 操作
   * 支持开始新对话或继续已有对话
   */
  private async handlePlan(input: BlueprintToolInput): Promise<ToolResult> {
    const planner = executionState.getPlanner();
    const projectPath = input.projectPath || getCurrentCwd();

    // 检查是否有进行中的对话
    const existingDialog = executionState.getDialogState();

    // 如果有用户输入，处理对话
    if (input.userInput) {
      // 如果有进行中的对话，继续对话
      if (existingDialog) {
        const updatedState = await planner.processUserInput(
          input.userInput,
          existingDialog.state
        );
        executionState.setDialogState(existingDialog.sessionId, updatedState);

        // 检查对话是否完成
        if (updatedState.isComplete) {
          return await this.finalizeBlueprint(updatedState, projectPath);
        }

        // 返回最新的助手回复
        const lastMessage = updatedState.messages[updatedState.messages.length - 1];
        return {
          success: true,
          output: this.formatDialogResponse(updatedState, lastMessage.content),
        };
      }

      // 没有进行中的对话，开始新对话
      const newState = await planner.startDialog(projectPath);
      const sessionId = this.generateSessionId();
      executionState.setDialogState(sessionId, newState);

      // 立即处理用户输入
      const updatedState = await planner.processUserInput(input.userInput, newState);
      executionState.setDialogState(sessionId, updatedState);

      const lastMessage = updatedState.messages[updatedState.messages.length - 1];
      return {
        success: true,
        output: this.formatDialogResponse(updatedState, lastMessage.content),
      };
    }

    // 没有用户输入，开始新对话
    const state = await planner.startDialog(projectPath);
    const sessionId = this.generateSessionId();
    executionState.setDialogState(sessionId, state);

    // 返回问候语
    const greetingMessage = state.messages[0];
    return {
      success: true,
      output: this.formatDialogResponse(state, greetingMessage.content),
    };
  }

  /**
   * 完成蓝图生成
   */
  private async finalizeBlueprint(
    state: DialogState,
    projectPath: string
  ): Promise<ToolResult> {
    const planner = executionState.getPlanner();

    try {
      // 生成蓝图
      const blueprint = await planner.generateBlueprint(state);
      executionState.setCurrentBlueprint(blueprint);

      // v9.0: 不再预生成 ExecutionPlan
      // LeadAgent 自己负责探索代码库和规划任务
      // 创建空壳计划供 CLI 模式使用
      const plan = {
        id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        blueprintId: blueprint.id,
        tasks: [] as any[],
        parallelGroups: [] as string[][],
        estimatedMinutes: 0,
        estimatedCost: 0,
        autoDecisions: [] as any[],
        status: 'ready' as const,
        createdAt: new Date(),
      };
      executionState.setCurrentPlan(plan);

      // 清除对话状态
      executionState.clearDialogState();

      // 格式化输出
      const lines: string[] = [];
      lines.push(t('blueprint.generated'));
      lines.push('');
      lines.push('========================================');
      lines.push(t('blueprint.name', { name: blueprint.name }));
      lines.push(t('blueprint.id', { id: blueprint.id }));
      lines.push(t('blueprint.projectPath', { path: blueprint.projectPath }));
      lines.push('');
      lines.push(t('blueprint.requirementsList'));
      blueprint.requirements.forEach((req, i) => {
        lines.push(`  ${i + 1}. ${req}`);
      });
      lines.push('');
      lines.push(t('blueprint.techStack'));
      lines.push(t('blueprint.language', { language: blueprint.techStack.language }));
      if (blueprint.techStack.framework) {
        lines.push(t('blueprint.framework', { framework: blueprint.techStack.framework }));
      }
      lines.push(t('blueprint.packageManager', { packageManager: blueprint.techStack.packageManager }));
      if (blueprint.techStack.testFramework) {
        lines.push(t('blueprint.testFramework', { testFramework: blueprint.techStack.testFramework }));
      }
      lines.push('');
      lines.push(t('blueprint.modules'));
      blueprint.modules.forEach((mod) => {
        lines.push(`  - ${mod.name} (${mod.type}): ${mod.description}`);
      });
      if (blueprint.apiContract) {
        lines.push('');
        lines.push(t('blueprint.apiContract', { count: blueprint.apiContract.endpoints.length }));
      }
      lines.push('');
      lines.push('========================================');
      lines.push('');
      lines.push(t('blueprint.nextStep'));

      return {
        success: true,
        output: lines.join('\n'),
      };
    } catch (error: any) {
      return {
        success: false,
        error: t('blueprint.generateFailed', { error: error.message }),
      };
    }
  }

  /**
   * 格式化对话响应
   */
  private formatDialogResponse(state: DialogState, message: string): string {
    const lines: string[] = [];
    lines.push(t('blueprint.dialogPhase', { phase: this.translatePhase(state.phase) }));
    lines.push('');
    lines.push(message);

    // 如果已收集到需求，显示摘要
    if (state.collectedRequirements.length > 0) {
      lines.push('');
      lines.push(t('blueprint.collectedRequirements'));
      state.collectedRequirements.forEach((req, i) => {
        lines.push(`${i + 1}. ${req}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * 翻译对话阶段
   */
  private translatePhase(phase: string): string {
    const phaseKeys: Record<string, string> = {
      greeting: 'blueprint.phaseGreeting',
      requirements: 'blueprint.phaseRequirements',
      clarification: 'blueprint.phaseClarification',
      tech_choice: 'blueprint.phaseTechChoice',
      confirmation: 'blueprint.phaseConfirmation',
      done: 'blueprint.phaseDone',
    };
    const key = phaseKeys[phase];
    return key ? t(key as any) : phase;
  }

  /**
   * 生成会话ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // --------------------------------------------------------------------------
  // execute: 执行蓝图
  // --------------------------------------------------------------------------

  /**
   * 处理 execute 操作
   */
  private async handleExecute(input: BlueprintToolInput): Promise<ToolResult> {
    // 获取执行计划
    const plan = executionState.getCurrentPlan();
    if (!plan) {
      return {
        success: false,
        error: t('blueprint.noPlan'),
      };
    }

    // 获取蓝图
    const blueprint = executionState.getCurrentBlueprint();
    if (!blueprint) {
      return {
        success: false,
        error: t('blueprint.noBlueprint'),
      };
    }

    // 获取协调器
    const coordinator = executionState.getOrCreateCoordinator(input.config);

    // 启动执行（异步，不等待完成）
    const lines: string[] = [];
    lines.push(t('blueprint.executeStarted'));
    lines.push('');
    lines.push(t('blueprint.blueprintLabel', { name: blueprint.name }));
    lines.push(t('blueprint.planId', { id: plan.id }));
    lines.push(t('blueprint.taskCount', { count: plan.tasks.length }));
    lines.push(t('blueprint.maxWorkers', { count: input.config?.maxWorkers || DEFAULT_SWARM_CONFIG.maxWorkers }));
    lines.push('');
    lines.push(t('blueprint.executingTasks'));
    lines.push('');
    lines.push(t('blueprint.monitorCommands'));
    lines.push(t('blueprint.monitorStatus'));
    lines.push(t('blueprint.monitorPause'));
    lines.push(t('blueprint.monitorCancel'));

    // 异步启动执行
    coordinator.start(plan).then((result) => {
      // 执行完成后的回调（可以添加日志或通知）
      console.log(`[Blueprint] 执行完成: success=${result.success}, completed=${result.completedCount}, failed=${result.failedCount}`);
    }).catch((error) => {
      console.error(`[Blueprint] 执行出错: ${error.message}`);
    });

    return {
      success: true,
      output: lines.join('\n'),
    };
  }

  // --------------------------------------------------------------------------
  // status: 查看执行状态
  // --------------------------------------------------------------------------

  /**
   * 处理 status 操作
   */
  private handleStatus(): ToolResult {
    const coordinator = executionState.getCoordinator();
    const blueprint = executionState.getCurrentBlueprint();
    const plan = executionState.getCurrentPlan();
    const dialogState = executionState.getDialogState();

    const lines: string[] = [];
    lines.push('========================================');
    lines.push(t('blueprint.statusTitle'));
    lines.push('========================================');
    lines.push('');

    // 对话状态
    if (dialogState) {
      lines.push(t('blueprint.dialogInProgress'));
      lines.push(t('blueprint.statusPhase', { phase: this.translatePhase(dialogState.state.phase) }));
      lines.push(t('blueprint.statusRequirements', { count: dialogState.state.collectedRequirements.length }));
      lines.push('');
    }

    // 蓝图信息
    if (blueprint) {
      lines.push(t('blueprint.currentBlueprint'));
      lines.push(t('blueprint.statusName', { name: blueprint.name }));
      lines.push(t('blueprint.statusId', { id: blueprint.id }));
      lines.push(t('blueprint.statusState', { status: blueprint.status }));
      lines.push(t('blueprint.statusModules', { count: blueprint.modules.length }));
      lines.push('');
    } else {
      lines.push(t('blueprint.noBlueprint2'));
      lines.push('');
    }

    // 执行计划信息
    if (plan) {
      lines.push(t('blueprint.executionPlan'));
      lines.push(t('blueprint.statusPlanId', { id: plan.id }));
      lines.push(t('blueprint.statusTotalTasks', { count: plan.tasks.length }));
      lines.push(t('blueprint.statusPlanState', { status: plan.status }));
      lines.push('');
    }

    // 执行状态
    if (coordinator) {
      const status = coordinator.getStatus();
      lines.push(t('blueprint.executionStatus'));
      lines.push(t('blueprint.completedTasks', { completed: status.completedTasks, total: status.totalTasks }));
      lines.push(t('blueprint.failedTasks', { count: status.failedTasks }));
      lines.push(t('blueprint.runningTasks', { count: status.runningTasks }));
      lines.push(t('blueprint.activeWorkers', { count: status.activeWorkers }));
      lines.push('');
      lines.push(t('blueprint.costAndTime'));
      lines.push(t('blueprint.currentCost', { cost: status.currentCost.toFixed(4) }));
      lines.push(t('blueprint.estimatedCost', { cost: status.estimatedTotalCost.toFixed(4) }));
      if (status.estimatedCompletion) {
        lines.push(t('blueprint.estimatedCompletion', { time: status.estimatedCompletion.toLocaleString() }));
      }

      // 进度条
      const progress = status.totalTasks > 0
        ? Math.round((status.completedTasks / status.totalTasks) * 100)
        : 0;
      const progressBar = this.renderProgressBar(progress);
      lines.push('');
      lines.push(t('blueprint.progress', { bar: progressBar, percent: progress }));

      // 问题列表
      if (status.issues.length > 0) {
        lines.push('');
        lines.push(t('blueprint.issues'));
        status.issues.slice(0, 5).forEach((issue) => {
          const icon = issue.resolved ? t('blueprint.issueResolved') : t('blueprint.issuePending');
          lines.push(`  ${icon} ${issue.type}: ${issue.description}`);
        });
        if (status.issues.length > 5) {
          lines.push(t('blueprint.moreIssues', { count: status.issues.length - 5 }));
        }
      }
    } else {
      lines.push(t('blueprint.notStarted'));
    }

    lines.push('');
    lines.push('========================================');

    return {
      success: true,
      output: lines.join('\n'),
    };
  }

  /**
   * 渲染进度条
   */
  private renderProgressBar(percent: number): string {
    const width = 20;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
  }

  // --------------------------------------------------------------------------
  // pause: 暂停执行
  // --------------------------------------------------------------------------

  /**
   * 处理 pause 操作
   */
  private handlePause(): ToolResult {
    const coordinator = executionState.getCoordinator();

    if (!coordinator) {
      return {
        success: false,
        error: t('blueprint.noExecution'),
      };
    }

    coordinator.pause();

    return {
      success: true,
      output: t('blueprint.paused'),
    };
  }

  // --------------------------------------------------------------------------
  // resume: 恢复执行
  // --------------------------------------------------------------------------

  /**
   * 处理 resume 操作
   */
  private handleResume(): ToolResult {
    const coordinator = executionState.getCoordinator();

    if (!coordinator) {
      return {
        success: false,
        error: t('blueprint.noResumable'),
      };
    }

    coordinator.unpause();

    return {
      success: true,
      output: t('blueprint.resumed'),
    };
  }

  // --------------------------------------------------------------------------
  // cancel: 取消执行
  // --------------------------------------------------------------------------

  /**
   * 处理 cancel 操作
   */
  private handleCancel(): ToolResult {
    const coordinator = executionState.getCoordinator();

    if (!coordinator) {
      return {
        success: false,
        error: t('blueprint.noExecution'),
      };
    }

    coordinator.cancel();

    // 重置执行状态
    executionState.reset();

    return {
      success: true,
      output: t('blueprint.cancelled'),
    };
  }
}
