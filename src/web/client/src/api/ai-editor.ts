/**
 * AI Editor API 客户端
 * 为 CodeEditor 提供所有 AI 增强功能的 API 调用接口
 */

// ============================================================================
// 类型定义
// ============================================================================

/**
 * AI Hover 请求参数
 */
export interface AIHoverRequest {
  /** 文件路径 */
  filePath: string;
  /** 符号名称 */
  symbolName: string;
  /** 符号类型（如 function, class, interface, variable 等） */
  symbolKind?: string;
  /** 代码上下文（悬停位置周围的代码） */
  codeContext: string;
  /** 行号 */
  line?: number;
  /** 列号 */
  column?: number;
  /** 语言 */
  language?: string;
  /** 类型签名（如果 TypeScript 已经推断出来） */
  typeSignature?: string;
}

/**
 * AI Hover 返回结果
 */
export interface AIHoverResult {
  /** 是否成功 */
  success: boolean;
  /** 简短描述 */
  brief?: string;
  /** 详细说明 */
  detail?: string;
  /** 参数说明 */
  params?: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  /** 返回值说明 */
  returns?: {
    type: string;
    description: string;
  };
  /** 使用示例 */
  examples?: string[];
  /** 相关链接 */
  seeAlso?: string[];
  /** 注意事项 */
  notes?: string[];
  /** 错误信息 */
  error?: string;
  /** 是否来自缓存 */
  fromCache?: boolean;
}

/**
 * AI 导游步骤
 */
export interface TourStep {
  type: 'file' | 'function' | 'class' | 'block';
  name: string;
  line: number;
  endLine?: number;
  description: string;
  importance: 'high' | 'medium' | 'low';
}

/**
 * AI 导游响应
 */
export interface TourResponse {
  success: boolean;
  data?: {
    steps: TourStep[];
  };
  error?: string;
}

/**
 * Ask AI 请求
 */
export interface AskAIRequest {
  code: string;
  question: string;
  filePath?: string;
  context?: {
    language?: string;
  };
}

/**
 * Ask AI 响应
 */
export interface AskAIResponse {
  success: boolean;
  answer?: string;
  error?: string;
}

/**
 * 代码热力图数据
 */
export interface HeatmapData {
  line: number;
  complexity: number; // 0-100
  reason: string;
}

/**
 * 热力图请求
 */
export interface HeatmapRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * 热力图响应
 */
export interface HeatmapResponse {
  success: boolean;
  heatmap: HeatmapData[];
  fromCache?: boolean;
  error?: string;
}

/**
 * 重构建议
 */
export interface RefactorSuggestion {
  line: number;
  endLine: number;
  type: 'extract' | 'simplify' | 'rename' | 'unused' | 'duplicate' | 'performance' | 'safety';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * 重构建议请求
 */
export interface RefactorRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * 重构建议响应
 */
export interface RefactorResponse {
  success: boolean;
  suggestions: RefactorSuggestion[];
  fromCache?: boolean;
  error?: string;
}

/**
 * AI 气泡
 */
export interface AIBubble {
  line: number;
  message: string;
  type: 'info' | 'warning' | 'tip';
}

/**
 * AI 气泡请求
 */
export interface BubblesRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * AI 气泡响应
 */
export interface BubblesResponse {
  success: boolean;
  bubbles: AIBubble[];
  fromCache?: boolean;
  error?: string;
}

/**
 * 路径补全请求
 */
export interface CompletePathRequest {
  filePath: string;
  prefix: string;
  root?: string;
}

/**
 * 路径补全响应
 */
export interface CompletePathResponse {
  success: boolean;
  items: Array<{
    label: string;
    kind: 'file' | 'folder';
    detail?: string;
  }>;
  error?: string;
}

/**
 * AI Inline 补全请求
 */
export interface InlineCompleteRequest {
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
  currentLine: string;
  cursorColumn: number;
}

/**
 * AI Inline 补全响应
 */
export interface InlineCompleteResponse {
  success: boolean;
  completion?: string;
  fromCache?: boolean;
  error?: string;
}

/**
 * Intent-to-Code 请求
 */
export interface IntentToCodeRequest {
  filePath: string;
  code: string;
  intent: string;
  language: string;
  mode: 'rewrite' | 'generate';
}

/**
 * Intent-to-Code 响应
 */
export interface IntentToCodeResponse {
  success: boolean;
  code?: string;
  explanation?: string;
  error?: string;
  fromCache?: boolean;
}

/**
 * Code Review Issue
 */
export interface CodeReviewIssue {
  line: number;
  endLine: number;
  type: 'bug' | 'performance' | 'security' | 'style';
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

/**
 * Code Review 请求
 */
export interface CodeReviewRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Code Review 响应
 */
export interface CodeReviewResponse {
  success: boolean;
  issues: CodeReviewIssue[];
  summary?: string;
  fromCache?: boolean;
  error?: string;
}

/**
 * Test Generator 请求
 */
export interface GenerateTestRequest {
  filePath: string;
  code: string;
  functionName: string;
  language: string;
  framework?: string;
}

/**
 * Test Generator 响应
 */
export interface GenerateTestResponse {
  success: boolean;
  testCode?: string;
  testFramework?: string;
  testCount?: number;
  explanation?: string;
  fromCache?: boolean;
  error?: string;
}

/**
 * Code Conversation Message
 */
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Code Conversation 请求
 */
export interface CodeConversationRequest {
  filePath: string;
  language: string;
  codeContext: string;
  cursorLine?: number;
  messages: ConversationMessage[];
  question: string;
}

/**
 * Code Conversation 响应
 */
export interface CodeConversationResponse {
  success: boolean;
  answer?: string;
  error?: string;
}

/**
 * Smart Diff Change
 */
export interface SmartDiffChange {
  type: 'added' | 'removed' | 'modified';
  description: string;
  risk?: string;
}

/**
 * Smart Diff 请求
 */
export interface SmartDiffRequest {
  filePath: string;
  language: string;
  originalContent: string;
  modifiedContent: string;
}

/**
 * Smart Diff 响应
 */
export interface SmartDiffResponse {
  success: boolean;
  analysis?: {
    summary: string;
    impact: 'safe' | 'warning' | 'danger';
    changes: SmartDiffChange[];
    warnings: string[];
  };
  fromCache?: boolean;
  error?: string;
}

/**
 * Dead Code Item
 */
export interface DeadCodeItem {
  line: number;
  endLine: number;
  type: 'unused' | 'unreachable' | 'redundant' | 'suspicious';
  name: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Dead Code 请求
 */
export interface DeadCodeRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Dead Code 响应
 */
export interface DeadCodeResponse {
  success: boolean;
  deadCode: DeadCodeItem[];
  summary?: string;
  fromCache?: boolean;
  error?: string;
}

// ============================================================================
// 第三批 AI 功能类型定义
// ============================================================================

/**
 * Time Machine Commit
 */
export interface TimeMachineCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

/**
 * Time Machine Key Change
 */
export interface TimeMachineKeyChange {
  date: string;
  description: string;
}

/**
 * Time Machine 请求
 */
export interface TimeMachineRequest {
  filePath: string;
  content: string;
  language: string;
  selectedCode?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Time Machine 响应
 */
export interface TimeMachineResponse {
  success: boolean;
  history?: {
    commits: TimeMachineCommit[];
    story: string;
    keyChanges: TimeMachineKeyChange[];
  };
  fromCache?: boolean;
  error?: string;
}

/**
 * Pattern Location
 */
export interface PatternLocation {
  line: number;
  endLine: number;
}

/**
 * Detected Pattern
 */
export interface DetectedPattern {
  type: 'duplicate' | 'similar-logic' | 'extract-candidate' | 'design-pattern';
  name: string;
  locations: PatternLocation[];
  description: string;
  suggestion: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * Pattern Detector 请求
 */
export interface PatternDetectorRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Pattern Detector 响应
 */
export interface PatternDetectorResponse {
  success: boolean;
  patterns: DetectedPattern[];
  summary?: string;
  fromCache?: boolean;
  error?: string;
}

/**
 * API Doc Param
 */
export interface ApiDocParam {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
}

/**
 * API Doc Result
 */
export interface ApiDocResult {
  name: string;
  package: string;
  brief: string;
  params?: ApiDocParam[];
  returns?: {
    type: string;
    description: string;
  };
  examples: string[];
  pitfalls: string[];
  seeAlso: string[];
}

/**
 * API Doc 请求
 */
export interface ApiDocRequest {
  symbolName: string;
  packageName?: string;
  language: string;
  codeContext: string;
}

/**
 * API Doc 响应
 */
export interface ApiDocResponse {
  success: boolean;
  doc?: ApiDocResult;
  fromCache?: boolean;
  error?: string;
}

// ============================================================================
// API 调用函数
// ============================================================================

/**
 * AI Hover API - 复用自 blueprint.ts
 */
export const aiHoverApi = {
  /**
   * 生成 AI Hover 文档
   */
  generate: async (request: AIHoverRequest): Promise<AIHoverResult> => {
    const response = await fetch('/api/ai-hover/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      return {
        success: false,
        error: error.error || `HTTP ${response.status}`,
      };
    }

    return response.json();
  },

  /**
   * 清空缓存
   */
  clearCache: async (): Promise<{ success: boolean; message: string }> => {
    const response = await fetch('/api/ai-hover/clear-cache', {
      method: 'POST',
    });
    return response.json();
  },
};

/**
 * AI Tour API - 代码导游
 */
export const aiTourApi = {
  /**
   * 生成代码导游步骤
   */
  generate: async (filePath: string, content: string): Promise<TourResponse> => {
    try {
      const response = await fetch('/api/ai-editor/tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, content }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Ask API - 选中代码提问
 */
export const aiAskApi = {
  /**
   * 提交代码问题
   */
  ask: async (request: AskAIRequest): Promise<AskAIResponse> => {
    try {
      const response = await fetch('/api/ai-editor/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Heatmap API - 代码复杂度热力图
 */
export const aiHeatmapApi = {
  /**
   * 分析代码复杂度热力图
   */
  analyze: async (request: HeatmapRequest): Promise<HeatmapResponse> => {
    try {
      const response = await fetch('/api/ai-editor/heatmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          heatmap: [],
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        heatmap: [],
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Refactor API - 重构建议
 */
export const aiRefactorApi = {
  /**
   * 分析重构建议
   */
  analyze: async (request: RefactorRequest): Promise<RefactorResponse> => {
    try {
      const response = await fetch('/api/ai-editor/refactor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          suggestions: [],
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        suggestions: [],
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Bubbles API - AI 代码气泡注释
 */
export const aiBubblesApi = {
  /**
   * 生成 AI 代码气泡
   */
  generate: async (request: BubblesRequest): Promise<BubblesResponse> => {
    try {
      const response = await fetch('/api/ai-editor/bubbles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          bubbles: [],
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        bubbles: [],
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Complete API - 自动代码补全
 */
export const aiCompleteApi = {
  /**
   * 路径补全（import 路径）
   */
  completePath: async (request: CompletePathRequest): Promise<CompletePathResponse> => {
    try {
      const response = await fetch('/api/ai-editor/complete-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return { success: false, items: [], error: error.error || `HTTP ${response.status}` };
      }

      return response.json();
    } catch (err: any) {
      return { success: false, items: [], error: err.message || 'Network error' };
    }
  },

  /**
   * AI Inline 补全（Ghost Text）
   */
  inlineComplete: async (request: InlineCompleteRequest): Promise<InlineCompleteResponse> => {
    try {
      const response = await fetch('/api/ai-editor/inline-complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return { success: false, error: error.error || `HTTP ${response.status}` };
      }

      return response.json();
    } catch (err: any) {
      return { success: false, error: err.message || 'Network error' };
    }
  },
};

/**
 * AI Intent-to-Code API - 意图编程
 */
export const aiIntentApi = {
  /**
   * 执行意图编程
   */
  execute: async (request: IntentToCodeRequest): Promise<IntentToCodeResponse> => {
    try {
      const response = await fetch('/api/ai-editor/intent-to-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Code Review API - 代码审查
 */
export const aiCodeReviewApi = {
  /**
   * 分析代码问题
   */
  analyze: async (request: CodeReviewRequest): Promise<CodeReviewResponse> => {
    try {
      const response = await fetch('/api/ai-editor/code-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          issues: [],
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        issues: [],
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Test Generator API - 测试生成
 */
export const aiTestGenApi = {
  /**
   * 生成测试代码
   */
  generate: async (request: GenerateTestRequest): Promise<GenerateTestResponse> => {
    try {
      const response = await fetch('/api/ai-editor/generate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Code Conversation API - 多轮代码对话
 */
export const aiConversationApi = {
  /**
   * 发送对话消息
   */
  chat: async (request: CodeConversationRequest): Promise<CodeConversationResponse> => {
    try {
      const response = await fetch('/api/ai-editor/conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Smart Diff API - 语义 Diff 分析
 */
export const aiSmartDiffApi = {
  /**
   * 分析代码改动
   */
  analyze: async (request: SmartDiffRequest): Promise<SmartDiffResponse> => {
    try {
      const response = await fetch('/api/ai-editor/smart-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Dead Code API - 死代码检测
 */
export const aiDeadCodeApi = {
  /**
   * 分析死代码
   */
  analyze: async (request: DeadCodeRequest): Promise<DeadCodeResponse> => {
    try {
      const response = await fetch('/api/ai-editor/dead-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          deadCode: [],
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        deadCode: [],
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Time Machine API - 代码时光机
 */
export const aiTimeMachineApi = {
  /**
   * 分析代码历史演变
   */
  analyze: async (request: TimeMachineRequest): Promise<TimeMachineResponse> => {
    try {
      const response = await fetch('/api/ai-editor/time-machine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI Pattern Detector API - 模式检测器
 */
export const aiPatternApi = {
  /**
   * 检测代码模式
   */
  detect: async (request: PatternDetectorRequest): Promise<PatternDetectorResponse> => {
    try {
      const response = await fetch('/api/ai-editor/detect-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          patterns: [],
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        patterns: [],
        error: err.message || 'Network error',
      };
    }
  },
};

/**
 * AI API Doc API - API 文档叠加
 */
export const aiApiDocApi = {
  /**
   * 查询 API 文档
   */
  lookup: async (request: ApiDocRequest): Promise<ApiDocResponse> => {
    try {
      const response = await fetch('/api/ai-editor/api-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        return {
          success: false,
          error: error.error || `HTTP ${response.status}`,
        };
      }

      return response.json();
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error',
      };
    }
  },
};

// ============================================================================
// 统一导出
// ============================================================================

export const aiEditorApi = {
  hover: aiHoverApi,
  tour: aiTourApi,
  ask: aiAskApi,
  heatmap: aiHeatmapApi,
  refactor: aiRefactorApi,
  bubbles: aiBubblesApi,
  complete: aiCompleteApi,
  intent: aiIntentApi,
  codeReview: aiCodeReviewApi,
  testGen: aiTestGenApi,
  conversation: aiConversationApi,
  smartDiff: aiSmartDiffApi,
  deadCode: aiDeadCodeApi,
  timeMachine: aiTimeMachineApi,
  pattern: aiPatternApi,
  apiDoc: aiApiDocApi,
};

export default aiEditorApi;
