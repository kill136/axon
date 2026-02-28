// 消息类型
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: number;
  content: ChatContent[];
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  attachments?: Array<{
    name: string;
    type: string;
  }>;
  /** 对齐官方 compact_boundary：标记此消息为压缩边界（UI 渲染分隔线） */
  isCompactBoundary?: boolean;
  /** 对齐官方 isCompactSummary：标记此消息为压缩摘要内容 */
  isCompactSummary?: boolean;
  /** 对齐官方 isVisibleInTranscriptOnly：仅在 transcript 模式下可见 */
  isVisibleInTranscriptOnly?: boolean;
}

export type ChatContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: MediaSource; fileName?: string; url?: string }
  | { type: 'document'; source: MediaSource; fileName?: string }  // PDF 和其他文档
  | ({ type: 'tool_use' } & ToolUse)
  | { type: 'thinking'; text: string }
    | {
      type: 'blueprint';
      blueprintId: string;
      name: string;
      moduleCount: number;
      processCount: number;
      nfrCount: number;
    }
    | {
      type: 'impact_analysis';
      data: {
        risk: {
          overallLevel: 'low' | 'medium' | 'high' | 'critical';
          breakingChanges: number;
          highRiskFiles: number;
          summary: string;
        };
        impact: {
          additions: Array<{ path: string; changeType: string; riskLevel: string; reason: string }>;
          modifications: Array<{ path: string; changeType: string; riskLevel: string; reason: string }>;
          deletions: Array<{ path: string; changeType: string; riskLevel: string; reason: string }>;
          byModule: Array<{ moduleName: string; modulePath: string; overallRisk: string; requiresReview: boolean }>;
          interfaceChanges: Array<{ interfaceName: string; changeType: string; breakingChange: boolean }>;
        };
        safetyBoundary: {
          allowedPaths: Array<{ path: string; operations: Array<'read' | 'write' | 'delete'> }>;
          readOnlyPaths: string[];
          forbiddenPaths: Array<{ path: string; reason: string }>;
          requireReviewPaths: Array<{ path: string; reason: string }>;
        };
        regressionScope: {
          mustRun: Array<{ testPath: string; reason: string }>;
          shouldRun: Array<{ testPath: string; reason: string }>;
          allExisting: string[];
          estimatedDuration: number;
        };
        recommendations: string[];
      };
    }
    | {
      type: 'dev_progress';
      data: {
        phase: 'idle' | 'analyzing_codebase' | 'analyzing_requirement' | 'generating_blueprint' | 'awaiting_approval' | 'executing' | 'validating' | 'cycle_review' | 'completed' | 'failed' | 'paused';
        percentage: number;
        currentTask?: string;
        tasksCompleted: number;
        tasksTotal: number;
        status?: 'running' | 'paused' | 'error';
      };
    }
    | {
      type: 'regression_result';
      data: {
        passed: boolean;
        failureReason?: string;
        failedTests?: string[];
        recommendations?: string[];
        duration?: number;
        newTests?: { total: number; passed: number; failed: number };
        regressionTests?: { total: number; passed: number; failed: number };
      };
    }
    | {
      type: 'cycle_review';
      data: {
        score: number;
        summary: string;
        issues?: Array<{ category: string; severity: string; description: string; suggestion?: string }>;
        recommendations?: string[];
        rollbackSuggestion?: { recommended: boolean; targetCheckpoint?: string; reason?: string };
      };
    }
    | {
      type: 'notebook_output';
      data: NotebookOutputData;
    }
    | {
      type: 'design_image';
      imageUrl: string;
      title?: string;
      style?: string;
      generatedText?: string;
    };

// ============ Jupyter Notebook 输出类型 ============

/**
 * Notebook 输出数据
 */
export interface NotebookOutputData {
  /** 文件路径 */
  filePath: string;
  /** 单元格列表 */
  cells: NotebookCellData[];
  /** 元数据 */
  metadata?: {
    kernelspec?: {
      name: string;
      displayName: string;
      language?: string;
    };
    languageInfo?: {
      name: string;
      version?: string;
    };
  };
}

/**
 * Notebook 单元格数据
 */
export interface NotebookCellData {
  /** 单元格索引 */
  index: number;
  /** 单元格类型 */
  cellType: 'code' | 'markdown' | 'raw';
  /** 源代码 */
  source: string;
  /** 执行计数 */
  executionCount?: number | null;
  /** 输出列表 */
  outputs?: NotebookCellOutput[];
}

/**
 * Notebook 单元格输出
 */
export interface NotebookCellOutput {
  /** 输出类型 */
  outputType: 'execute_result' | 'display_data' | 'stream' | 'error';
  /** 执行计数 */
  executionCount?: number;
  /** MIME bundle 数据 */
  data?: NotebookMimeBundle;
  /** 流名称 */
  streamName?: 'stdout' | 'stderr';
  /** 流文本 */
  text?: string;
  /** 错误名称 */
  ename?: string;
  /** 错误值 */
  evalue?: string;
  /** 错误回溯 */
  traceback?: string[];
}

/**
 * MIME Bundle 数据
 */
export interface NotebookMimeBundle {
  'text/plain'?: string;
  'text/html'?: string;
  'text/markdown'?: string;
  'text/latex'?: string;
  'image/png'?: string;
  'image/jpeg'?: string;
  'image/gif'?: string;
  'image/svg+xml'?: string;
  'application/json'?: any;
  'application/vnd.plotly.v1+json'?: any;
  [mimeType: string]: any;
}

// 媒体源（图片和文档通用）
export interface MediaSource {
  type: 'base64';
  media_type: string;
  data: string;
}

// 兼容旧代码
export type ImageSource = MediaSource;

export type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: any;
}

// 工具相关
export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  result?: ToolResult;
  /** 工具分类（用于 UI 状态显示）：code/search/read/web/agent/other */
  toolCategory?: string;
  /** 子 agent 工具调用（Task / ScheduleTask 使用） */
  subagentToolCalls?: SubagentToolCall[];
  /** 工具调用计数（Task / ScheduleTask 使用） */
  toolUseCount?: number;
  /** 最后执行的工具信息（Task / ScheduleTask 使用） */
  lastToolInfo?: string;
  /** Bash 前台执行时的实时流式输出 */
  streamingOutput?: string;
  /** 定时任务倒计时信息（仅 ScheduleTask 使用） */
  scheduleCountdown?: {
    triggerAt: number;
    remainingMs: number;
    phase: 'countdown' | 'executing' | 'done';
    taskName: string;
  };
}

// 子 agent 工具调用
export interface SubagentToolCall {
  id: string;
  name: string;
  input?: unknown;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

// 会话相关
export interface Session {
  id: string;
  name: string;
  updatedAt: number;
  messageCount: number;
  createdAt?: number;
  model?: string;
  cost?: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  tags?: string[];
  workingDirectory?: string;
  projectPath?: string;
}

/** App 暴露给 Root 的会话操作接口 */
export interface SessionActions {
  selectSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  newSession: () => void;
  searchSessions: (query: string) => void;
  exportSession: (id: string, format?: 'json' | 'md') => void;
  importSession: (content: string) => void;
}

// 斜杠命令
export interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  category?: 'general' | 'session' | 'config' | 'utility' | 'integration' | 'auth' | 'development' | 'skill';
}

// 权限请求
export interface PermissionRequest {
  requestId: string;
  tool: string;
  args: unknown;
  description: string;
  riskLevel: 'low' | 'medium' | 'high';
  /** v2.1.28: 是否需要管理员权限 */
  isElevated?: boolean;
  /** v2.1.28: 管理员权限原因 */
  elevationReason?: string;
}

// 用户问题
export interface UserQuestion {
  requestId: string;
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  timeout?: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

// 附件类型: image 直接传递给模型, file 保存为临时文件传路径
// 保留 pdf/docx/xlsx/pptx/text 向后兼容
export type AttachmentType = 'image' | 'file' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'text';

// 附件
export interface Attachment {
  id: string;
  name: string;
  type: AttachmentType;
  mimeType: string;
  data: string;
}

// WebSocket 消息类型
export type WSMessageType =
  | 'connected'
  | 'message_start'
  | 'text_delta'
  | 'thinking_start'
  | 'thinking_delta'
  | 'tool_use_start'
  | 'tool_result'
  | 'message_complete'
  | 'error'
  | 'status'
  | 'permission_request'
  | 'user_question'
  | 'session_list_response'
  | 'session_switched'
  | 'session_created'
  | 'session_deleted'
  | 'session_renamed'
  | 'history'
  | 'pong'
  | 'session_new_ready'
  // 子 agent 相关消息类型
  | 'task_status'
  | 'subagent_tool_start'
  | 'subagent_tool_end'
  // 定时任务倒计时/闹钟
  | 'schedule_countdown'
  | 'schedule_alarm'
  // 持续开发相关消息类型
  | 'continuous_dev:ack'
  | 'continuous_dev:status_update'
  | 'continuous_dev:progress_update'
  | 'continuous_dev:approval_required'
  | 'continuous_dev:regression_failed'
  | 'continuous_dev:regression_passed'
  | 'continuous_dev:cycle_review_started'
  | 'continuous_dev:cycle_review_completed'
  | 'continuous_dev:cycle_reset'
  | 'continuous_dev:flow_failed'
  | 'continuous_dev:flow_stopped'
  | 'continuous_dev:flow_paused'
  | 'continuous_dev:flow_resumed'
  | 'continuous_dev:flow_started'
  | 'continuous_dev:phase_changed'
  | 'continuous_dev:task_completed'
  | 'continuous_dev:task_failed'
  | 'continuous_dev:paused'
  | 'continuous_dev:resumed'
  | 'continuous_dev:stopped'
  | 'continuous_dev:completed'
  // 设计图生成
  | 'design_image_generated'
  // 探针调试消息
  | 'debug_messages_response'
  // 定时任务实时更新
  | 'schedule:task_created'
  | 'schedule:task_updated'
  | 'schedule:task_deleted';

export interface WSMessage {
  type: WSMessageType | string;  // 允许扩展类型
  payload?: unknown;
}

/**
 * Git Merge Status
 * 用于 MergeView 组件显示合并/变基冲突状态
 */
export interface GitMergeStatus {
  inProgress: boolean;
  type: 'merge' | 'rebase' | 'cherry-pick' | null;
  conflicts: string[];
  currentBranch: string;
  targetBranch?: string;
}

/**
 * Git File History Commit
 * 用于 FileHistoryView 组件显示文件修改历史
 */
export interface GitFileHistoryCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  diff?: string;
}

/**
 * Git Blame Line
 * 用于 BlameView 组件显示文件的每行追溯信息
 */
export interface GitBlameLine {
  lineNumber: number;
  commit: string;
  author: string;
  date: string;
  content: string;
}
