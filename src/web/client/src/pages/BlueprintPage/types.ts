/**
 * BlueprintPage 类型定义
 *
 * 注意：从后端 src/blueprint/types.ts 复用核心类型定义
 * 但前端需要处理 JSON 序列化后的数据（Date → string）
 */

// ============================================================================
// 蓝图相关类型（前端版本 - Date 转为 string）
// ============================================================================

/**
 * 蓝图状态
 */
export type BlueprintStatus =
  | 'draft'        // 草稿：正在与用户对话完善中
  | 'review'       // 审核：等待用户确认签字
  | 'approved'     // 已批准：用户已签字确认，可以开始执行
  | 'executing'    // 执行中：任务树正在执行
  | 'completed'    // 已完成：所有任务都已完成
  | 'paused'       // 已暂停：用户暂停了执行
  | 'modified'     // 已修改：执行中用户修改了蓝图，需要重新规划
  | 'failed'       // 已失败：执行失败
  | 'cancelled';   // 已取消：用户取消了执行

/**
 * 业务流程定义（As-Is/To-Be）
 */
export interface BusinessProcess {
  id: string;
  name: string;
  description: string;
  type: 'as-is' | 'to-be';  // 现状 vs 目标
  steps: ProcessStep[];
  actors: string[];          // 参与角色
  inputs: string[];          // 输入
  outputs: string[];         // 输出
}

/**
 * 流程步骤
 */
export interface ProcessStep {
  id: string;
  order: number;
  name: string;
  description: string;
  actor: string;             // 执行角色
  systemAction?: string;     // 系统动作
  userAction?: string;       // 用户动作
  conditions?: string[];     // 前置条件
  outcomes?: string[];       // 产出
}

/**
 * 系统模块定义
 */
export interface SystemModule {
  id: string;
  name: string;
  description: string;
  type: 'frontend' | 'backend' | 'database' | 'service' | 'infrastructure' | 'other';
  responsibilities: string[];  // 职责
  dependencies: string[];      // 依赖的其他模块 ID
  interfaces: ModuleInterface[];  // 对外接口
  techStack?: string[];        // 技术栈
}

/**
 * 模块接口
 */
export interface ModuleInterface {
  id: string;
  name: string;
  type: 'api' | 'event' | 'message' | 'file' | 'other';
  direction: 'in' | 'out' | 'both';
  description: string;
  schema?: Record<string, any>;  // 接口契约
}

/**
 * 非功能性要求
 */
export interface NonFunctionalRequirement {
  id: string;
  category: 'performance' | 'security' | 'scalability' | 'availability' | 'maintainability' | 'usability' | 'other';
  name: string;
  description: string;
  metric?: string;           // 量化指标
  priority: 'must' | 'should' | 'could' | 'wont';  // MoSCoW
}

/**
 * 蓝图变更记录
 */
export interface BlueprintChange {
  id: string;
  timestamp: string;  // 前端使用 string（从 JSON 接收）
  type: 'create' | 'update' | 'approve' | 'reject' | 'pause' | 'resume';
  description: string;
  previousVersion?: string;
  changes?: Record<string, any>;  // diff
  author: 'user' | 'agent';
}

/**
 * 项目蓝图（前端版本）
 */
export interface Blueprint {
  id: string;
  name: string;
  description: string;
  version: string;
  status: BlueprintStatus;

  // 核心内容
  businessProcesses: BusinessProcess[];   // 业务流程
  modules: SystemModule[];                // 系统模块
  nfrs: NonFunctionalRequirement[];       // 非功能性要求

  // 元数据（前端使用 string 而非 Date）
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;

  // 蓝图来源
  source?: 'requirement' | 'codebase';

  // 变更历史
  changeHistory: BlueprintChange[];

  // 关联的任务树
  taskTreeId?: string;
}

// ============================================================================
// 组件内部状态类型
// ============================================================================

/**
 * 蓝图列表查询参数
 */
export interface BlueprintQueryParams {
  status?: BlueprintStatus;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 蓝图列表项（简化版，用于列表展示）
 */
export interface BlueprintListItem {
  id: string;
  name: string;
  description: string;
  version: string;
  status: BlueprintStatus;
  createdAt: string;
  updatedAt: string;
  moduleCount: number;          // 模块数量
  processCount: number;         // 流程数量
  nfrCount: number;             // 非功能要求数量
  requirementCount: number;     // 需求数量
  constraintCount: number;      // 约束数量
  source?: 'requirement' | 'codebase';  // 蓝图来源
  projectPath?: string;         // 关联的项目路径
}

/**
 * 蓝图列表响应
 */
export interface BlueprintListResponse {
  success: boolean;
  data: BlueprintListItem[];  // 使用简化版类型
  total: number;
  message?: string;
}

/**
 * 蓝图详情响应
 */
export interface BlueprintDetailResponse {
  success: boolean;
  data: Blueprint;
  message?: string;
}

/**
 * 状态过滤选项
 */
export const BLUEPRINT_STATUS_OPTIONS: Array<{ value: BlueprintStatus | 'all'; labelKey: string }> = [
  { value: 'all', labelKey: 'blueprint.statusAll' },
  { value: 'draft', labelKey: 'blueprint.statusDraft' },
  { value: 'review', labelKey: 'blueprint.statusReview' },
  { value: 'approved', labelKey: 'blueprint.statusApproved' },
  { value: 'executing', labelKey: 'blueprint.statusExecuting' },
  { value: 'completed', labelKey: 'blueprint.statusCompleted' },
  { value: 'paused', labelKey: 'blueprint.statusPaused' },
  { value: 'modified', labelKey: 'blueprint.statusModified' },
  { value: 'failed', labelKey: 'blueprint.statusFailed' },
  { value: 'cancelled', labelKey: 'blueprint.statusCancelled' },
];

/**
 * 状态标签颜色映射
 */
export const BLUEPRINT_STATUS_COLORS: Record<BlueprintStatus, string> = {
  draft: '#6b7280',        // 灰色
  review: '#f59e0b',       // 橙色
  approved: '#3b82f6',     // 蓝色
  executing: '#22c55e',    // 绿色
  completed: '#10b981',    // 绿色
  paused: '#f97316',       // 橙色
  modified: '#8b5cf6',     // 紫色
  failed: '#ef4444',       // 红色
  cancelled: '#9ca3af',    // 浅灰色
};

/**
 * 状态图标映射
 */
export const BLUEPRINT_STATUS_ICONS: Record<BlueprintStatus, string> = {
  draft: '📝',
  review: '👀',
  approved: '✅',
  executing: '⚙️',
  completed: '🎉',
  paused: '⏸️',
  modified: '🔄',
  failed: '❌',
  cancelled: '🚫',
};
