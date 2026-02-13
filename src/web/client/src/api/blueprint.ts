/**
 * Blueprint API 封装层 - v2.0 简化版
 *
 * 核心 API：
 * - 蓝图 CRUD 操作
 * - 执行控制
 * - 任务树管理
 * - 文件操作
 */

// ============================================================================
// 类型定义
// ============================================================================

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * 蓝图列表项
 */
export interface BlueprintListItem {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'paused' | 'failed';
  createdAt: string;
  updatedAt: string;
  moduleCount: number;
  requirementCount: number;
  projectPath?: string;
}

/**
 * 蓝图详情（v2.0 简化版）
 */
export interface Blueprint {
  id: string;
  name: string;
  description: string;
  projectPath: string;
  requirements: string[];
  techStack: {
    language: string;
    framework?: string;
    packageManager: string;
    testFramework?: string;
    buildTool?: string;
  };
  modules: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    files?: string[];
    dependencies?: string[];
  }>;
  constraints: string[];
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'paused' | 'failed';
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
}

/**
 * 创建蓝图请求
 */
export interface CreateBlueprintRequest {
  name: string;
  description?: string;
  projectPath: string;
  requirements?: string[];
  techStack?: {
    language?: string;
    framework?: string;
    packageManager?: string;
    testFramework?: string;
  };
  constraints?: string[];
}

// ============================================================================
// API 封装
// ============================================================================

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  const result: ApiResponse<T> = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'API request failed');
  }

  return result.data as T;
}

/**
 * Blueprint API 封装
 */
export const blueprintApi = {
  /**
   * 获取所有蓝图列表
   */
  getBlueprints: async (projectPath?: string): Promise<BlueprintListItem[]> => {
    const url = projectPath
      ? `/api/blueprint/blueprints?projectPath=${encodeURIComponent(projectPath)}`
      : '/api/blueprint/blueprints';
    const response = await fetch(url);
    return handleResponse<BlueprintListItem[]>(response);
  },

  /**
   * 获取单个蓝图详情
   */
  getBlueprint: async (id: string): Promise<Blueprint> => {
    const response = await fetch(`/api/blueprint/blueprints/${id}`);
    return handleResponse<Blueprint>(response);
  },

  /**
   * 创建新蓝图
   */
  createBlueprint: async (data: CreateBlueprintRequest): Promise<Blueprint> => {
    const response = await fetch('/api/blueprint/blueprints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return handleResponse<Blueprint>(response);
  },

  /**
   * 删除蓝图
   */
  deleteBlueprint: async (id: string): Promise<void> => {
    const response = await fetch(`/api/blueprint/blueprints/${id}`, {
      method: 'DELETE',
    });
    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || '删除蓝图失败');
    }
  },

  /**
   * 执行蓝图
   */
  executeBlueprint: async (id: string): Promise<{
    executionId: string;
    planId: string;
    totalTasks: number;
    estimatedMinutes: number;
    estimatedCost: number;
  }> => {
    const response = await fetch(`/api/blueprint/blueprints/${id}/execute`, {
      method: 'POST',
    });
    // v12.1: 处理 409 冲突（项目已有活跃蓝图正在执行）
    if (response.status === 409) {
      const result = await response.json();
      throw new Error(result.error || '项目已有活跃蓝图正在执行');
    }
    return handleResponse(response);
  },
};

/**
 * 执行控制 API
 */
export const executionApi = {
  /**
   * 获取执行状态
   */
  getStatus: async (executionId: string): Promise<{
    planId: string;
    blueprintId: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    runningTasks: number;
    activeWorkers: number;
    startedAt: string;
    estimatedCompletion?: string;
    currentCost: number;
    estimatedTotalCost: number;
    isCompleted: boolean;
  }> => {
    const response = await fetch(`/api/blueprint/execution/${executionId}/status`);
    return handleResponse(response);
  },

  /**
   * 暂停执行
   */
  pause: async (executionId: string): Promise<void> => {
    const response = await fetch(`/api/blueprint/execution/${executionId}/pause`, {
      method: 'POST',
    });
    await handleResponse(response);
  },

  /**
   * 恢复执行
   */
  resume: async (executionId: string): Promise<void> => {
    const response = await fetch(`/api/blueprint/execution/${executionId}/resume`, {
      method: 'POST',
    });
    await handleResponse(response);
  },

  /**
   * 取消执行
   */
  cancel: async (executionId: string): Promise<void> => {
    const response = await fetch(`/api/blueprint/execution/${executionId}/cancel`, {
      method: 'POST',
    });
    await handleResponse(response);
  },
};

/**
 * 任务树 API 封装
 */
export const taskTreeApi = {
  /**
   * 获取任务树
   */
  getTaskTree: async (id: string): Promise<any> => {
    const response = await fetch(`/api/blueprint/task-trees/${id}`);
    return handleResponse(response);
  },

  /**
   * 获取任务树统计
   */
  getTaskTreeStats: async (id: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    runningTasks: number;
    failedTasks: number;
    skippedTasks: number;
    progressPercentage: number;
  }> => {
    const response = await fetch(`/api/blueprint/task-trees/${id}/stats`);
    return handleResponse(response);
  },

  /**
   * 更新任务状态
   */
  updateTaskStatus: async (treeId: string, taskId: string, status: string): Promise<any> => {
    const response = await fetch(`/api/blueprint/task-trees/${treeId}/tasks/${taskId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    return handleResponse(response);
  },
};

/**
 * 协调器 API 封装（v2.0 完整版）
 */
export const coordinatorApi = {
  /**
   * 获取所有 Worker
   */
  getWorkers: async (): Promise<any[]> => {
    const response = await fetch('/api/blueprint/coordinator/workers');
    return handleResponse(response);
  },

  /**
   * 获取仪表板数据
   */
  getDashboard: async (): Promise<{
    workers: {
      total: number;
      active: number;
      idle: number;
    };
    tasks: {
      total: number;
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
  }> => {
    const response = await fetch('/api/blueprint/coordinator/dashboard');
    return handleResponse(response);
  },

  /**
   * 停止/暂停
   */
  stop: async (): Promise<void> => {
    const response = await fetch('/api/blueprint/coordinator/stop', {
      method: 'POST',
    });
    await handleResponse(response);
  },

  /**
   * 启动/恢复执行
   * 返回执行会话信息
   * - started: 新创建的执行
   * - resumed: 从内存中恢复的暂停会话
   * - recovered: 从文件状态恢复的中断执行
   */
  resume: async (blueprintId: string): Promise<{
    started?: boolean;
    resumed?: boolean;
    recovered?: boolean;
    blueprintId: string;
    executionId: string;
    planId?: string;
    totalTasks?: number;
    parallelGroups?: number;
    estimatedMinutes?: number;
    estimatedCost?: number;
    message?: string;
  }> => {
    const response = await fetch('/api/blueprint/coordinator/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprintId }),
    });
    return handleResponse(response);
  },

  /**
   * 启动蓝图执行（新建执行会话）
   * 本质上和 resume 调用相同的后端接口，后端自动判断是新建还是恢复
   */
  startExecution: async (blueprintId: string): Promise<{
    started?: boolean;
    resumed?: boolean;
    recovered?: boolean;
    blueprintId: string;
    executionId: string;
    planId?: string;
    totalTasks?: number;
    parallelGroups?: number;
    estimatedMinutes?: number;
    estimatedCost?: number;
    message?: string;
  }> => {
    const response = await fetch('/api/blueprint/coordinator/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blueprintId }),
    });
    return handleResponse(response);
  },

  // ============ v2.0 新增接口 ============

  /**
   * 获取执行计划
   */
  getExecutionPlan: async (blueprintId: string): Promise<{
    id: string;
    blueprintId: string;
    tasks: any[];
    parallelGroups: string[][];
    estimatedCost: number;
    estimatedMinutes: number;
    autoDecisions: any[];
    status: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  } | null> => {
    const response = await fetch(`/api/blueprint/coordinator/plan/${blueprintId}`);
    return handleResponse(response);
  },

  /**
   * 获取 Git 分支状态
   */
  getGitBranches: async (blueprintId: string): Promise<Array<{
    branchName: string;
    workerId: string;
    status: 'active' | 'merged' | 'conflict' | 'pending';
    commits: number;
    filesChanged: number;
    lastCommitAt?: string;
    conflictFiles?: string[];
  }>> => {
    const response = await fetch(`/api/blueprint/coordinator/git-branches/${blueprintId}`);
    return handleResponse(response);
  },

  /**
   * 获取成本估算
   */
  getCostEstimate: async (blueprintId: string): Promise<{
    totalEstimated: number;
    currentSpent: number;
    remainingEstimated: number;
    breakdown: Array<{
      model: string;
      tasks: number;
      cost: number;
    }>;
  }> => {
    const response = await fetch(`/api/blueprint/coordinator/cost/${blueprintId}`);
    return handleResponse(response);
  },

  /**
   * 手动触发合并
   */
  triggerMerge: async (workerId: string): Promise<{
    success: boolean;
    branchName: string;
    autoResolved: boolean;
    needsHumanReview: boolean;
    conflictFiles?: string[];
  }> => {
    const response = await fetch('/api/blueprint/coordinator/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId }),
    });
    return handleResponse(response);
  },

  /**
   * 获取 Worker 决策历史
   */
  getWorkerDecisions: async (workerId: string): Promise<Array<{
    type: string;
    description: string;
    timestamp: string;
  }>> => {
    const response = await fetch(`/api/blueprint/coordinator/workers/${workerId}/decisions`);
    return handleResponse(response);
  },

  // ============ v2.1 恢复功能 ============

  /**
   * 检查蓝图是否有可恢复的执行状态
   */
  getRecoverableState: async (blueprintId: string): Promise<{
    hasRecoverableState: boolean;
    projectPath?: string;
    stateDetails?: {
      planId: string;
      completedTasks: number;
      failedTasks: number;
      skippedTasks: number;
      totalTasks: number;
      currentGroupIndex: number;
      totalGroups: number;
      lastUpdatedAt: string;
      isPaused: boolean;
      currentCost: number;
    };
  }> => {
    const response = await fetch(`/api/blueprint/coordinator/recoverable/${blueprintId}`);
    return handleResponse(response);
  },

  /**
   * 恢复蓝图的执行
   */
  recoverExecution: async (blueprintId: string): Promise<{
    executionId: string;
    blueprintId: string;
    message: string;
  }> => {
    const response = await fetch(`/api/blueprint/coordinator/recover/${blueprintId}`, {
      method: 'POST',
    });
    return handleResponse(response);
  },

  // ============ v3.4 验收测试 ============

  /**
   * 启动 E2E 端到端验收测试
   * 需要浏览器 MCP 扩展支持
   */
  startE2EVerification: async (
    blueprintId: string,
    config?: {
      similarityThreshold?: number;
      autoFix?: boolean;
      maxFixAttempts?: number;
    }
  ): Promise<{ success: boolean; message?: string; hint?: string; error?: string }> => {
    const response = await fetch(`/api/blueprint/execution/${blueprintId}/verify-e2e`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config || {}),
    });
    return handleResponse(response);
  },

  /**
   * 获取验收测试状态
   */
  getVerificationStatus: async (blueprintId: string): Promise<{
    status: 'idle' | 'checking_env' | 'running_tests' | 'fixing' | 'passed' | 'failed';
    result?: {
      status: string;
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
  }> => {
    const response = await fetch(`/api/blueprint/execution/${blueprintId}/verification`);
    return handleResponse(response);
  },

  // ============ v2.1 日志功能 ============

  /**
   * 获取 Worker 执行日志
   */
  getWorkerLogs: async (workerId: string, limit: number = 50): Promise<Array<{
    id: string;
    timestamp: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    type: 'tool' | 'decision' | 'status' | 'output' | 'error';
    message: string;
    details?: any;
  }>> => {
    const response = await fetch(`/api/blueprint/coordinator/workers/${workerId}/logs?limit=${limit}`);
    return handleResponse(response);
  },

  /**
   * 通过任务 ID 获取关联的 Worker 执行日志
   */
  getTaskLogs: async (taskId: string, limit: number = 50): Promise<{
    logs: Array<{
      id: string;
      timestamp: string;
      level: 'info' | 'warn' | 'error' | 'debug';
      type: 'tool' | 'decision' | 'status' | 'output' | 'error';
      message: string;
      details?: any;
    }>;
    workerId?: string;
  }> => {
    const response = await fetch(`/api/blueprint/coordinator/tasks/${taskId}/logs?limit=${limit}`);
    const result = await handleResponse<{ logs?: any[]; workerId?: string }>(response);
    // API 返回的是 data 数组而非对象
    if (Array.isArray(result)) {
      return { logs: result };
    }
    return { logs: result.logs || result || [], workerId: result.workerId };
  },

  // ============ v3.5 冲突解决 ============

  /**
   * 获取所有待处理冲突
   */
  getConflicts: async (): Promise<Array<{
    id: string;
    workerId: string;
    taskId: string;
    taskName: string;
    branchName: string;
    files: Array<{
      path: string;
      oursContent: string;
      theirsContent: string;
      baseContent?: string;
      suggestedMerge?: string;
      conflictType: 'append' | 'modify' | 'delete' | 'unknown';
    }>;
    timestamp: string;
    status: 'pending' | 'resolving' | 'resolved';
  }>> => {
    const response = await fetch('/api/blueprint/coordinator/conflicts');
    return handleResponse(response);
  },

  /**
   * 获取单个冲突详情
   */
  getConflict: async (conflictId: string): Promise<{
    id: string;
    workerId: string;
    taskId: string;
    taskName: string;
    branchName: string;
    files: Array<{
      path: string;
      oursContent: string;
      theirsContent: string;
      baseContent?: string;
      suggestedMerge?: string;
      conflictType: 'append' | 'modify' | 'delete' | 'unknown';
    }>;
    timestamp: string;
    status: 'pending' | 'resolving' | 'resolved';
  }> => {
    const response = await fetch(`/api/blueprint/coordinator/conflicts/${conflictId}`);
    return handleResponse(response);
  },

  /**
   * 解决冲突
   */
  resolveConflict: async (
    conflictId: string,
    decision: 'use_suggested' | 'use_ours' | 'use_theirs' | 'use_both' | 'custom',
    customContents?: Record<string, string>
  ): Promise<{
    success: boolean;
    message?: string;
  }> => {
    const response = await fetch(`/api/blueprint/coordinator/conflicts/${conflictId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, customContents }),
    });
    return handleResponse(response);
  },
};

/**
 * 文件操作 API
 */
export const fileApi = {
  /**
   * 读取文件内容
   */
  getContent: async (path: string): Promise<{
    path: string;
    content: string;
    language: string;
    size: number;
    modifiedAt: string;
  }> => {
    const response = await fetch(`/api/blueprint/file-content?path=${encodeURIComponent(path)}`);
    return handleResponse(response);
  },

  /**
   * 保存文件内容
   */
  saveContent: async (path: string, content: string): Promise<{
    path: string;
    size: number;
    modifiedAt: string;
  }> => {
    const response = await fetch('/api/blueprint/file-content', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    return handleResponse(response);
  },
};

/**
 * 代码库分析 API（简化版）
 */
export const codebaseApi = {
  /**
   * 获取文件树
   */
  getFileTree: async (root: string = 'src'): Promise<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: any[];
  }> => {
    const response = await fetch(`/api/blueprint/file-tree?root=${encodeURIComponent(root)}`);
    return handleResponse(response);
  },

  /**
   * 分析节点
   */
  analyzeNode: async (path: string): Promise<{
    path: string;
    name: string;
    type: string;
    summary: string;
    description: string;
  }> => {
    const response = await fetch('/api/blueprint/analyze-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return handleResponse(response);
  },
};

/**
 * 项目管理 API
 */
export const projectApi = {
  /**
   * 获取最近打开的项目
   */
  getRecentProjects: async (): Promise<Array<{
    id: string;
    path: string;
    name: string;
    lastOpenedAt: string;
  }>> => {
    const response = await fetch('/api/blueprint/projects');
    return handleResponse(response);
  },

  /**
   * 打开项目
   */
  openProject: async (projectPath: string): Promise<{
    id: string;
    path: string;
    name: string;
    lastOpenedAt: string;
    blueprint: { id: string; name: string; status: string } | null;
  }> => {
    const response = await fetch('/api/blueprint/projects/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectPath }),
    });
    return handleResponse(response);
  },

  /**
   * 获取当前工作目录
   */
  getCurrentWorkingDirectory: async (): Promise<{ path: string; name: string }> => {
    const response = await fetch('/api/blueprint/projects/cwd');
    return handleResponse(response);
  },
};

// ============================================================================
// 对话 API - v2.0 蓝图创建对话流程
// ============================================================================

/**
 * 对话消息
 */
export interface DialogMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * 对话状态
 */
export interface DialogState {
  sessionId: string;
  projectPath?: string;
  phase: 'greeting' | 'requirements' | 'clarification' | 'tech_choice' | 'confirmation' | 'done';
  messages: DialogMessage[];
  isComplete: boolean;
  collectedRequirements?: string[];
  collectedConstraints?: string[];
  techStack?: {
    language?: string;
    framework?: string;
    packageManager?: string;
    testFramework?: string;
    buildTool?: string;
    additionalTools?: string[];
  };
}

/**
 * 对话 API
 */
export const dialogApi = {
  /**
   * 开始新的对话会话
   */
  startDialog: async (projectPath: string): Promise<DialogState> => {
    const response = await fetch('/api/blueprint/dialog/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath }),
    });
    const result = await handleResponse(response);
    return {
      ...result,
      sessionId: result.sessionId,
    };
  },

  /**
   * 发送消息继续对话
   */
  sendMessage: async (sessionId: string, input: string): Promise<DialogState> => {
    const response = await fetch(`/api/blueprint/dialog/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    const result = await handleResponse(response);
    return {
      ...result,
      sessionId,
    };
  },

  /**
   * 获取对话状态
   */
  getDialogState: async (sessionId: string): Promise<DialogState> => {
    const response = await fetch(`/api/blueprint/dialog/${sessionId}`);
    const result = await handleResponse(response);
    return {
      ...result,
      sessionId,
    };
  },

  /**
   * 确认对话并生成蓝图
   */
  confirmAndGenerateBlueprint: async (sessionId: string): Promise<Blueprint> => {
    const response = await fetch(`/api/blueprint/dialog/${sessionId}/confirm`, {
      method: 'POST',
    });
    return handleResponse(response);
  },

  /**
   * 取消对话
   */
  cancelDialog: async (sessionId: string): Promise<{ success: boolean }> => {
    const response = await fetch(`/api/blueprint/dialog/${sessionId}`, {
      method: 'DELETE',
    });
    return handleResponse(response);
  },

  /**
   * 获取所有活跃的对话会话
   */
  getActiveSessions: async (): Promise<Array<{
    sessionId: string;
    projectPath: string;
    phase: string;
    isComplete: boolean;
  }>> => {
    const response = await fetch('/api/blueprint/dialog/sessions');
    return handleResponse(response);
  },
};

// ============================================================================
// 文件树和分析相关类型
// ============================================================================

/**
 * 文件树节点
 */
export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  extension?: string;
}

/**
 * 节点分析结果
 */
export interface NodeAnalysis {
  path: string;
  name: string;
  type: string;
  summary: string;
  description: string;
}

/**
 * 文件内容
 */
export interface FileContent {
  path: string;
  content: string;
  language: string;
  size: number;
  modifiedAt: string;
}

/**
 * 符号分析结果
 */
export interface SymbolAnalysis {
  name: string;
  kind: string;
  description: string;
  signature?: string;
  documentation?: string;
}

/**
 * 最近的项目
 */
export interface RecentProject {
  id: string;
  path: string;
  name: string;
  lastOpenedAt: string;
}

// ============================================================================
// 文件操作 API
// ============================================================================

/**
 * 文件操作 API
 */
export const fileOperationApi = {
  /**
   * 创建文件
   */
  createFile: async (path: string, content: string = ''): Promise<{ success: boolean; path: string }> => {
    const response = await fetch('/api/blueprint/file-operation/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    return handleResponse(response);
  },

  /**
   * 创建目录
   */
  createDirectory: async (path: string): Promise<{ success: boolean; path: string }> => {
    const response = await fetch('/api/blueprint/file-operation/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return handleResponse(response);
  },

  /**
   * 删除文件或目录
   */
  delete: async (path: string): Promise<{ success: boolean }> => {
    const response = await fetch('/api/blueprint/file-operation/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    return handleResponse(response);
  },

  /**
   * 重命名文件或目录
   */
  rename: async (oldPath: string, newPath: string): Promise<{ success: boolean; path: string }> => {
    const response = await fetch('/api/blueprint/file-operation/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath }),
    });
    return handleResponse(response);
  },

  /**
   * 复制文件或目录
   */
  copy: async (sourcePath: string, destPath: string): Promise<{ success: boolean; path: string }> => {
    const response = await fetch('/api/blueprint/file-operation/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, destPath }),
    });
    return handleResponse(response);
  },

  /**
   * 移动文件或目录
   */
  move: async (sourcePath: string, destPath: string): Promise<{ success: boolean; path: string }> => {
    const response = await fetch('/api/blueprint/file-operation/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, destPath }),
    });
    return handleResponse(response);
  },
};

// ============================================================================
// AI Hover API
// ============================================================================

/**
 * AI Hover 结果
 */
export interface AIHoverResult {
  success: boolean;
  brief?: string;
  detail?: string;
  params?: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  returns?: {
    type: string;
    description: string;
  };
  examples?: string[];
  seeAlso?: string[];
  notes?: string[];
  error?: string;
  fromCache?: boolean;
}

/**
 * AI Hover API
 */
export const aiHoverApi = {
  /**
   * 生成 AI 悬浮提示
   */
  generate: async (params: {
    filePath: string;
    symbolName: string;
    codeContext: string;
    line?: number;
    column?: number;
    language?: string;
    symbolKind?: string;
    typeSignature?: string;
  }): Promise<AIHoverResult> => {
    const response = await fetch('/api/ai-hover/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return handleResponse(response);
  },

  /**
   * 清空缓存
   */
  clearCache: async (): Promise<{ success: boolean; message: string }> => {
    const response = await fetch('/api/ai-hover/clear-cache', {
      method: 'POST',
    });
    return handleResponse(response);
  },

  /**
   * 获取缓存状态
   */
  getCacheStats: async (): Promise<{ size: number; maxSize: number; ttl: string }> => {
    const response = await fetch('/api/ai-hover/cache-stats');
    return handleResponse(response);
  },
};

// ============================================================================
// v4.0: 执行日志 API
// ============================================================================

export interface WorkerLog {
  id: string;
  blueprintId: string;
  taskId: string;
  workerId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  type: 'tool' | 'decision' | 'status' | 'output' | 'error';
  message: string;
  details?: any;
}

export interface WorkerStream {
  id: string;
  blueprintId: string;
  taskId: string;
  workerId: string;
  timestamp: string;
  streamType: 'thinking' | 'text' | 'tool_start' | 'tool_end';
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolResult?: string;
  toolError?: string;
}

export interface TaskExecution {
  id: string;
  blueprintId: string;
  taskId: string;
  taskName: string;
  workerId: string;
  attempt: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
  reviewFeedback?: any;
}

export interface TaskLogsResponse {
  taskId: string;
  executions: TaskExecution[];
  logs: WorkerLog[];
  streams: WorkerStream[];
  totalLogs: number;
  totalStreams: number;
}

export interface LogsStatsResponse {
  totalExecutions: number;
  totalLogs: number;
  totalStreams: number;
  dbSizeBytes: number;
  dbSizeMB: string;
}

/**
 * 执行日志 API
 */
export const logsApi = {
  /**
   * 获取任务执行日志
   */
  getTaskLogs: async (
    taskId: string,
    options?: { limit?: number; offset?: number; since?: string; until?: string }
  ): Promise<TaskLogsResponse> => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    if (options?.since) params.set('since', options.since);
    if (options?.until) params.set('until', options.until);

    const url = `/api/blueprint/logs/task/${taskId}${params.toString() ? `?${params}` : ''}`;
    const response = await fetch(url);
    return handleResponse(response);
  },

  /**
   * 获取蓝图所有执行日志
   */
  getBlueprintLogs: async (
    blueprintId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ blueprintId: string; executions: TaskExecution[]; logs: WorkerLog[]; totalExecutions: number; totalLogs: number }> => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());

    const url = `/api/blueprint/logs/blueprint/${blueprintId}${params.toString() ? `?${params}` : ''}`;
    const response = await fetch(url);
    return handleResponse(response);
  },

  /**
   * 清空任务日志
   */
  clearTaskLogs: async (
    taskId: string,
    keepLatest: boolean = false
  ): Promise<{ taskId: string; deletedCount: number }> => {
    const url = `/api/blueprint/logs/task/${taskId}?keepLatest=${keepLatest}`;
    const response = await fetch(url, { method: 'DELETE' });
    return handleResponse(response);
  },

  /**
   * 获取日志统计信息
   */
  getStats: async (): Promise<LogsStatsResponse> => {
    const response = await fetch('/api/blueprint/logs/stats');
    return handleResponse(response);
  },

  /**
   * 手动触发日志清理
   */
  cleanup: async (): Promise<{ deletedCount: number; message: string }> => {
    const response = await fetch('/api/blueprint/logs/cleanup', { method: 'POST' });
    return handleResponse(response);
  },
};
