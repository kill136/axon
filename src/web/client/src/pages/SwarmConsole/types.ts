/**
 * SwarmConsole 类型定义 - v2.0 完整版
 *
 * v2.0 核心变化：
 * - 移除 Queen 概念，使用 RealtimeCoordinator 直接调度
 * - Worker 自治，自主决策是否需要测试
 * - Git 并发：每个 Worker 一个分支，自动合并
 * - 成本估算和实时追踪
 * - ExecutionPlan 执行计划可视化
 */

// ============= 基础类型 =============

/**
 * v5.0: 蜂群共享记忆（SwarmMemory）
 * 用于 Worker 之间共享上下文信息
 */
export interface SwarmMemory {
  /** 任务进度概览（一行文本） */
  overview: string;
  /** 已注册的 API 列表（从后端任务 summary 中自动提取） */
  apis: string[];
  /** 已完成任务的摘要 */
  completedTasks: Array<{
    taskId: string;
    taskName: string;
    summary: string;
  }>;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * 蓝图（v2.0 完整版）
 */
export interface Blueprint {
  id: string;
  name: string;
  description: string;
  version?: string;
  projectPath: string;
  requirements: string[];
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'paused' | 'failed';

  // v2.0: 模块信息
  modules?: BlueprintModule[];

  // v2.0: 技术栈
  techStack?: {
    language: string;
    framework?: string;
    packageManager: string;
    testFramework?: string;
    buildTool?: string;
  };

  // v2.0: 约束
  constraints?: string[];

  // v5.0: 蜂群共享记忆
  swarmMemory?: SwarmMemory | null;

  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

/**
 * 蓝图模块
 */
export interface BlueprintModule {
  id: string;
  name: string;
  description: string;
  type: 'frontend' | 'backend' | 'database' | 'service' | 'shared' | 'other';
  files?: string[];
  dependencies?: string[];
}

// ============= 执行计划类型（v2.0 新增）=============

/**
 * 执行计划 - 由 SmartPlanner 生成
 */
export interface ExecutionPlan {
  id: string;
  blueprintId: string;

  // 任务列表
  tasks: PlanTask[];

  // 并行组（哪些任务可以同时执行）
  parallelGroups: string[][];

  // 预估
  estimatedCost: number;      // 美元
  estimatedMinutes: number;

  // AI做的决策（透明给用户看）
  autoDecisions: PlanDecision[];

  // 状态
  status: 'ready' | 'executing' | 'completed' | 'failed' | 'paused';

  // 时间戳
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * 计划中的任务（包含运行时状态）
 */
export interface PlanTask {
  id: string;
  name: string;
  description: string;
  type: 'code' | 'config' | 'test' | 'refactor' | 'docs' | 'integrate';
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  files: string[];
  dependencies: string[];
  needsTest: boolean;
  estimatedMinutes: number;

  // 运行时状态（执行时更新）
  status?: 'pending' | 'running' | 'reviewing' | 'completed' | 'failed' | 'skipped';
  workerId?: string;           // 执行该任务的 Worker ID
  startedAt?: string;          // 开始时间
  completedAt?: string;        // 完成时间
  error?: string;              // 错误信息
  result?: {                   // 执行结果
    success: boolean;
    testsRan?: boolean;
    testsPassed?: boolean;
    error?: string;
  };
}

/**
 * 规划决策
 */
export interface PlanDecision {
  type: 'task_split' | 'parallel' | 'dependency' | 'tech_choice' | 'other';
  description: string;
  reasoning?: string;
}

// ============= Git 并发类型（v2.0 新增）=============

/**
 * Git 分支状态
 */
export interface GitBranchStatus {
  branchName: string;
  workerId: string;
  status: 'active' | 'merged' | 'conflict' | 'pending';
  commits: number;
  filesChanged: number;
  lastCommitAt?: string;
  conflictFiles?: string[];
}

/**
 * 合并结果
 */
export interface MergeResult {
  success: boolean;
  workerId: string;
  branchName: string;
  autoResolved: boolean;
  needsHumanReview: boolean;
  conflictFiles?: string[];
  mergedAt?: string;
}

// ============= 成本追踪类型（v2.0 新增）=============

/**
 * 成本估算
 */
export interface CostEstimate {
  totalEstimated: number;       // 预估总成本（美元）
  currentSpent: number;         // 当前已花费
  remainingEstimated: number;   // 剩余预估
  breakdown: {
    model: string;
    tasks: number;
    cost: number;
  }[];
}

/**
 * 任务节点 - v2.0 与后端完全一致
 */
export interface TaskNode {
  id: string;
  name: string;
  description: string;
  type: 'code' | 'config' | 'test' | 'refactor' | 'docs' | 'integrate';
  // v2.0: 状态与后端一致
  status: 'pending' | 'running' | 'reviewing' | 'completed' | 'failed' | 'skipped';
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  workerId?: string;
  children: TaskNode[];
  // v2.0 新增字段
  needsTest?: boolean;
  estimatedMinutes?: number;
  // 直接的 error 字段（用于实时更新）
  error?: string;
  result?: {
    success: boolean;
    testsRan?: boolean;
    testsPassed?: boolean;
    error?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * 任务树
 */
export interface TaskTree {
  id: string;
  blueprintId: string;
  root: TaskNode;
  stats: Stats;
  createdAt: string;
  updatedAt: string;
}

/**
 * 统计信息
 */
export interface Stats {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  progressPercentage: number;
}

/**
 * 自治 Worker - v2.0 核心
 *
 * v2.0 变化：
 * - 移除 tddPhase，Worker 自主决策
 * - 状态简化为 idle/working/waiting/error
 * - 新增 currentAction 展示当前操作
 * - 新增 decisions 展示自主决策记录
 */
export interface WorkerAgent {
  id: string;
  // v2.0: 简化状态
  status: 'idle' | 'working' | 'waiting' | 'error';
  currentTaskId?: string;
  currentTaskName?: string;

  // v2.0: Git 分支信息
  branchName?: string;
  branchStatus?: 'active' | 'merged' | 'conflict';
  commits?: number;

  progress: number; // 0-100

  // v2.0: 决策记录（Worker 自主做的决策）
  decisions?: WorkerDecision[];

  // v2.0: 当前动作（替代旧的 tddPhase）
  // v2.0 新增: 'explore'（探索代码库）、'analyze'（分析目标文件）
  currentAction?: {
    type: 'read' | 'write' | 'edit' | 'run_test' | 'install_dep' | 'git' | 'think' | 'explore' | 'analyze';
    description: string;
    startedAt: string;
  };

  // v2.0: 模型使用
  modelUsed?: 'opus' | 'sonnet' | 'haiku';

  errorCount: number;
  createdAt: string;
  lastActiveAt: string;
}

/**
 * Worker 决策记录
 */
export interface WorkerDecision {
  type: 'strategy' | 'skip_test' | 'add_test' | 'install_dep' | 'retry' | 'other';
  description: string;
  timestamp: string;
}

// ============= WebSocket 消息类型 =============

// 客户端 → 服务端消息 - v2.0
export type SwarmClientMessage =
  | { type: 'swarm:subscribe'; payload: { blueprintId: string } }
  | { type: 'swarm:unsubscribe'; payload: { blueprintId: string } }
  | { type: 'swarm:pause'; payload: { blueprintId: string } }
  | { type: 'swarm:resume'; payload: { blueprintId: string } }
  | { type: 'swarm:cancel'; payload: { blueprintId: string } }
  | { type: 'swarm:stop'; payload: { blueprintId: string } }
  // v2.0: Worker 控制消息
  | { type: 'worker:pause'; payload: { workerId: string } }
  | { type: 'worker:resume'; payload: { workerId: string } }
  | { type: 'worker:terminate'; payload: { workerId: string } }
  // v2.1: 任务重试消息
  | { type: 'task:retry'; payload: { blueprintId: string; taskId: string } }
  // v3.8: 任务跳过消息
  | { type: 'task:skip'; payload: { blueprintId: string; taskId: string } }
  // v4.2: AskUserQuestion 响应消息（支持 E2E Agent 和 Worker）
  | { type: 'swarm:ask_response'; payload: { blueprintId: string; requestId: string; answers: Record<string, string>; cancelled?: boolean; workerId?: string } }
  // v4.4: 用户插嘴
  | { type: 'task:interject'; payload: { blueprintId: string; taskId: string; message: string } }
  // v9.2: LeadAgent 插嘴
  | { type: 'lead:interject'; payload: { blueprintId: string; message: string } }
  // Agent 探针调试（蜂群模式）
  | { type: 'swarm:debug_agent'; payload: { blueprintId: string; agentType: 'lead' | 'worker' | 'e2e'; workerId?: string } }
  | { type: 'swarm:debug_agent_list'; payload: { blueprintId: string } }
  | { type: 'ping' };

// 服务端 → 客户端消息
export type SwarmServerMessage =
  | { type: 'swarm:state'; payload: SwarmStatePayload }
  | { type: 'swarm:task_update'; payload: TaskUpdatePayload }
  | { type: 'swarm:worker_update'; payload: WorkerUpdatePayload }
  | { type: 'swarm:completed'; payload: SwarmCompletedPayload }
  | { type: 'swarm:error'; payload: SwarmErrorPayload }
  | { type: 'swarm:paused'; payload: SwarmControlPayload }
  | { type: 'swarm:resumed'; payload: SwarmControlPayload }
  | { type: 'swarm:stats_update'; payload: StatsUpdatePayload }
  | { type: 'swarm:memory_update'; payload: SwarmMemoryUpdatePayload }
  | { type: 'swarm:planner_update'; payload: PlannerUpdatePayload }
  | { type: 'swarm:worker_log'; payload: WorkerLogPayload }
  | { type: 'swarm:worker_stream'; payload: WorkerStreamPayload }
  | { type: 'swarm:verification_update'; payload: VerificationUpdatePayload }
  | { type: 'conflict:needs_human'; payload: ConflictNeedsHumanPayload }
  | { type: 'conflict:resolved'; payload: ConflictResolvedPayload }
  | { type: 'swarm:ask_user'; payload: AskUserPayload }
  | { type: 'task:interject_success'; payload: InterjectSuccessPayload }
  | { type: 'task:interject_failed'; payload: InterjectFailedPayload }
  // v9.0: LeadAgent 事件
  | { type: 'swarm:lead_stream'; payload: LeadStreamPayload }
  | { type: 'swarm:lead_event'; payload: LeadEventPayload }
  // v9.0: LeadAgent System Prompt
  | { type: 'swarm:lead_system_prompt'; payload: { systemPrompt: string } }
  // v9.2: LeadAgent 插嘴响应
  | { type: 'lead:interject_success'; payload: LeadInterjectSuccessPayload }
  | { type: 'lead:interject_failed'; payload: LeadInterjectFailedPayload }
  // Agent 探针调试响应
  | { type: 'swarm:debug_agent_response'; payload: any }
  | { type: 'swarm:debug_agent_list_response'; payload: { blueprintId: string; agents: Array<{ agentType: string; id: string; label: string; taskId?: string }> } }
  // 连接确认
  | { type: 'connected'; payload?: any }
  | { type: 'pong' };

// ============= v4.5 新增：用户插嘴响应类型 =============

/**
 * 插嘴成功 Payload
 */
export interface InterjectSuccessPayload {
  blueprintId: string;
  taskId: string;
  success: true;
  message: string;
  timestamp: string;
}

/**
 * 插嘴失败 Payload
 */
export interface InterjectFailedPayload {
  blueprintId: string;
  taskId: string;
  success: false;
  error: string;
  timestamp: string;
}

// ============= v9.2 新增：LeadAgent 插嘴响应类型 =============

export interface LeadInterjectSuccessPayload {
  blueprintId: string;
  success: true;
  message: string;
  timestamp: string;
}

export interface LeadInterjectFailedPayload {
  blueprintId: string;
  success: false;
  error: string;
  timestamp: string;
}

// ============= v2.1 新增：Worker 日志类型 =============

/**
 * Worker 日志条目
 */
export interface WorkerLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  type: 'tool' | 'decision' | 'status' | 'output' | 'error';
  message: string;
  details?: any;
}

/**
 * Worker 日志消息 Payload
 */
export interface WorkerLogPayload {
  workerId: string;
  taskId?: string;
  log: WorkerLogEntry;
}

/**
 * v2.1 新增：Worker 流式输出 Payload
 * 用于实时显示 Claude 的思考和输出
 */
export interface WorkerStreamPayload {
  workerId: string;
  taskId?: string;
  streamType: 'thinking' | 'text' | 'tool_start' | 'tool_end' | 'system_prompt';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: string;
  toolError?: string;
  timestamp: string;
  /** v4.6 新增：Agent 的 System Prompt */
  systemPrompt?: string;
  /** v4.6 新增：Agent 类型 */
  agentType?: 'worker' | 'e2e' | 'reviewer';
}

// ============= WebSocket Payload 类型 =============

export interface SwarmStatePayload {
  blueprint: Blueprint;
  taskTree: TaskTree | null;
  workers: WorkerAgent[];
  stats: Stats | null;

  // v2.0: 执行计划
  executionPlan?: ExecutionPlan | null;

  // v2.0: Git 分支状态
  gitBranches?: GitBranchStatus[];

  // v2.0: 成本追踪
  costEstimate?: CostEstimate | null;

  // v9.2: LeadAgent 状态（刷新浏览器后恢复）
  leadAgent?: {
    phase: LeadAgentPhase;
    stream: LeadStreamBlock[];
    events: Array<{ type: string; data: Record<string, unknown>; timestamp: string }>;
    systemPrompt?: string;
    lastUpdated: string;
  } | null;
}

export interface TaskUpdatePayload {
  taskId: string;
  updates: Partial<TaskNode>;
}

export interface WorkerUpdatePayload {
  workerId: string;
  updates: Partial<WorkerAgent>;
}

export interface SwarmCompletedPayload {
  blueprintId: string;
  stats: Stats;
  completedAt: string;
}

export interface SwarmErrorPayload {
  blueprintId: string;
  error: string;
  timestamp: string;
}

export interface SwarmControlPayload {
  blueprintId: string;
  success: boolean;
  message?: string;
  timestamp: string;
}

export interface StatsUpdatePayload {
  blueprintId: string;
  stats: Stats;
}

/**
 * v5.0 新增：蜂群共享记忆更新 Payload
 */
export interface SwarmMemoryUpdatePayload {
  blueprintId: string;
  swarmMemory: SwarmMemory;
}

/**
 * v2.0 新增：Planner 状态更新 Payload
 */
export interface PlannerUpdatePayload {
  phase: 'idle' | 'exploring' | 'explored' | 'decomposing' | 'ready';
  message: string;
  requirements?: string[];
  exploration?: {
    relevantFiles?: string[];
    codebaseStructure?: string;
    existingPatterns?: string[];
    suggestedApproach?: string;
  };
}

// ============= 状态类型 =============

export type SwarmConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SwarmState {
  blueprint: Blueprint | null;
  taskTree: TaskTree | null;
  workers: WorkerAgent[];
  stats: Stats | null;
  status: SwarmConnectionStatus;
  error: string | null;

  // v2.0: 执行计划
  executionPlan: ExecutionPlan | null;

  // v2.0: Git 分支状态
  gitBranches: GitBranchStatus[];

  // v2.0: 成本追踪
  costEstimate: CostEstimate | null;

  // v2.0: Planner 状态（Agent 模式探索/分解）
  plannerState: {
    phase: 'idle' | 'exploring' | 'explored' | 'decomposing' | 'ready';
    message: string;
    exploration?: PlannerUpdatePayload['exploration'];
  };

  // v2.1: 任务日志（按任务 ID 存储）
  taskLogs: Record<string, WorkerLogEntry[]>;

  // v2.1: 任务流式内容（实时显示思考和输出，按任务 ID 存储）
  taskStreams: Record<string, TaskStreamContent>;

  // v3.4: 验收测试状态
  verification: VerificationState;

  // v3.5: 冲突状态
  conflicts: ConflictState;

  // v4.2: AskUserQuestion 对话框状态
  askUserDialog: AskUserDialogState;

  // v4.5: 用户插嘴状态（反馈消息）
  interjectStatus: InterjectStatus | null;

  // v9.0: LeadAgent 持久大脑状态
  leadAgent: LeadAgentState;

  // v9.2: LeadAgent 插嘴状态
  leadInterjectStatus: LeadInterjectStatus | null;
}

/**
 * v4.5: 用户插嘴状态
 */
export interface InterjectStatus {
  taskId: string;
  success: boolean;
  message: string;
  timestamp: string;
}

/**
 * v9.2: LeadAgent 插嘴状态
 */
export interface LeadInterjectStatus {
  success: boolean;
  message: string;
  timestamp: string;
}

/**
 * v2.1 新增：流式内容块（参考 App.tsx 的消息结构）
 */
export type StreamContentBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input?: any; result?: string; error?: string; status: 'running' | 'completed' | 'error' };

/**
 * v2.1 新增：任务流式内容
 * 类似聊天界面的消息结构，content 数组按顺序存储内容块
 */
export interface TaskStreamContent {
  /** 内容块数组（思考、文本、工具按顺序排列） */
  content: StreamContentBlock[];
  /** 最后更新时间 */
  lastUpdated: string;
  /** v4.6 新增：Agent 的 System Prompt（用于透明展示 Agent 指令） */
  systemPrompt?: string;
  /** v4.6 新增：Agent 类型（worker / e2e / reviewer） */
  agentType?: 'worker' | 'e2e' | 'reviewer';
}

// ============= Hook 返回类型 =============

// v2.0: WebSocket Hook 返回类型
export interface UseSwarmWebSocketReturn {
  connected: boolean;
  status: SwarmConnectionStatus;
  lastPongTime: number | null;
  subscribe: (blueprintId: string) => void;
  unsubscribe: (blueprintId: string) => void;
  pauseSwarm: (blueprintId: string) => void;
  resumeSwarm: (blueprintId: string) => void;
  cancelSwarm: (blueprintId: string) => void;
  // v2.0: 新增控制函数
  stopSwarm: (blueprintId: string) => void;
  pauseWorker: (workerId: string) => void;
  resumeWorker: (workerId: string) => void;
  terminateWorker: (workerId: string) => void;
  // v2.1: 任务重试
  retryTask: (blueprintId: string, taskId: string) => void;
  // v3.8: 任务跳过
  skipTask: (blueprintId: string, taskId: string) => void;
  // v4.2: AskUserQuestion 响应（支持 Worker）
  sendAskUserResponse: (
    blueprintId: string,
    requestId: string,
    answers: Record<string, string>,
    cancelled?: boolean,
    workerId?: string
  ) => void;
  // v4.4: 用户插嘴
  interjectTask: (blueprintId: string, taskId: string, message: string) => void;
  // v9.2: LeadAgent 插嘴
  interjectLead: (blueprintId: string, message: string) => void;
  // v9.3: 恢复卡死的 LeadAgent 执行
  resumeLead: (blueprintId: string) => void;
}

export interface UseSwarmStateReturn {
  state: SwarmState;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
  // v2.1: 任务重试
  retryTask: (blueprintId: string, taskId: string) => void;
  // v3.8: 任务跳过
  skipTask: (blueprintId: string, taskId: string) => void;
  // v3.8: 取消执行
  cancelSwarm: (blueprintId: string) => void;
  // v4.0: 历史日志管理
  loadTaskHistoryLogs: (taskId: string) => Promise<{
    success: boolean;
    executions?: Array<{
      id: string;
      taskId: string;
      taskName: string;
      attempt: number;
      status: string;
      startedAt: string;
      completedAt?: string;
      error?: string;
    }>;
    totalLogs?: number;
    totalStreams?: number;
    error?: string;
  }>;
  clearTaskLogs: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  // v4.2: AskUserQuestion 响应
  sendAskUserResponse: (requestId: string, answers: Record<string, string>, cancelled?: boolean) => void;
  // v4.4: 用户插嘴
  interjectTask: (taskId: string, message: string) => void;
  // v9.2: LeadAgent 插嘴
  interjectLead: (message: string) => void;
  // v9.3: 恢复卡死的 LeadAgent
  resumeLead: () => void;
}

// ============= v4.2 新增：AskUserQuestion 对话框类型 =============

/**
 * AskUserQuestion 问题选项
 */
export interface AskUserQuestionOption {
  label: string;
  description: string;
}

/**
 * AskUserQuestion 问题
 */
export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

/**
 * AskUserQuestion 对话框状态
 */
export interface AskUserDialogState {
  /** 是否显示对话框 */
  visible: boolean;
  /** 请求 ID（用于响应） */
  requestId: string | null;
  /** 问题列表 */
  questions: AskUserQuestionItem[];
  /** E2E 任务 ID（用于关联） */
  e2eTaskId?: string;
  /** v4.2: Worker ID（如果是 Worker 发起的请求） */
  workerId?: string;
  /** v4.2: 任务 ID（如果是 Worker 发起的请求） */
  taskId?: string;
}

/**
 * AskUser WebSocket Payload
 */
export interface AskUserPayload {
  requestId: string;
  questions: AskUserQuestionItem[];
  e2eTaskId?: string;
  /** v4.2: Worker ID（如果是 Worker 发起的请求） */
  workerId?: string;
  /** v4.2: 任务 ID（如果是 Worker 发起的请求） */
  taskId?: string;
}

// ============= v3.4 新增：验收测试类型 =============

export type VerificationStatus = 'idle' | 'checking_env' | 'running_tests' | 'fixing' | 'passed' | 'failed';

export interface VerificationState {
  status: VerificationStatus;
  /** v4.1: E2E 测试任务 ID，用于显示流式日志 */
  e2eTaskId?: string;
  result?: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    testOutput: string;
    failures: { name: string; error: string }[];
    fixAttempts: { description: string; success: boolean }[];
    envIssues: string[];
    startedAt: string;
    completedAt?: string;
  };
}

export interface VerificationUpdatePayload {
  blueprintId: string;
  status: VerificationStatus;
  result?: VerificationState['result'];
  error?: string;
  // v4.1: E2E 测试任务 ID（用于显示流式日志）
  e2eTaskId?: string;
}

// ============= 🐝 冲突类型（v2.1 新增）=============

/**
 * 冲突文件
 */
export interface ConflictFile {
  path: string;
  oursContent: string;
  theirsContent: string;
  baseContent?: string;
  suggestedMerge?: string;
  conflictType: 'append' | 'modify' | 'delete' | 'unknown';
}

/**
 * 待处理冲突
 */
export interface PendingConflict {
  id: string;
  workerId: string;
  taskId: string;
  taskName: string;
  branchName: string;
  files: ConflictFile[];
  timestamp: string;
  status: 'pending' | 'resolving' | 'resolved';
}

/**
 * 冲突决策类型
 */
export type ConflictDecision =
  | 'use_suggested'
  | 'use_ours'
  | 'use_theirs'
  | 'use_both'
  | 'custom';

/**
 * 冲突状态
 */
export interface ConflictState {
  conflicts: PendingConflict[];
  resolvingId: string | null;
}

// ============= v3.5 冲突 WebSocket Payload 类型 =============

/**
 * 冲突需要人工处理 Payload
 */
export interface ConflictNeedsHumanPayload {
  conflict: PendingConflict;
}

/**
 * 冲突已解决 Payload
 */
export interface ConflictResolvedPayload {
  conflictId: string;
  success: boolean;
  message?: string;
}

// ============= v9.0: LeadAgent 持久大脑类型 =============

/**
 * LeadAgent 阶段
 */
export type LeadAgentPhase =
  | 'idle'          // 未启动
  | 'started'       // 刚启动
  | 'exploring'     // 探索代码库
  | 'planning'      // 制定计划
  | 'executing'     // 执行中（自己做或派发Worker）
  | 'reviewing'     // 审查Worker结果
  | 'completed'     // 全部完成
  | 'failed';       // 执行失败

/**
 * LeadAgent 流式内容块
 */
export type LeadStreamBlock =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input?: any; result?: string; error?: string; status: 'running' | 'completed' | 'error' };

/**
 * LeadAgent 状态
 */
export interface LeadAgentState {
  /** 当前阶段 */
  phase: LeadAgentPhase;
  /** 流式内容（LeadAgent 的实时输出） */
  stream: LeadStreamBlock[];
  /** 阶段事件历史 */
  events: Array<{
    type: string;
    data: Record<string, unknown>;
    timestamp: string;
  }>;
  /** LeadAgent 的 System Prompt */
  systemPrompt?: string;
  /** 最后更新时间 */
  lastUpdated: string;
}

/**
 * LeadAgent 流式输出 Payload
 */
export interface LeadStreamPayload {
  streamType: 'text' | 'tool_start' | 'tool_end';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: string;
  toolError?: string;
}

/**
 * LeadAgent 阶段事件 Payload
 */
export interface LeadEventPayload {
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
}
