/**
 * PlannerSession - Multi-turn 对话会话管理
 *
 * 核心思想：维护一个持续的对话 session，让 AI 保持上下文
 *
 * 优势：
 * 1. 减少 API 调用次数（8次 → 4次）
 * 2. Token 消耗大幅减少（不需要每次重复发送上下文）
 * 3. AI 有完整记忆，理解更准确
 * 4. 支持流式渲染
 */

import { EventEmitter } from 'events';
import type { Message, ToolDefinition } from '../types/index.js';
import { ClaudeClient, getDefaultClient } from '../core/client.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 流式事件类型 */
export interface SessionStreamEvent {
  type: 'text' | 'thinking' | 'tool_start' | 'tool_delta' | 'tool_result' | 'done' | 'error';
  text?: string;
  thinking?: string;
  toolName?: string;
  toolInput?: string;
  result?: any;
  error?: string;
}

/** 会话配置 */
export interface PlannerSessionConfig {
  /** 最大历史消息数（超过后压缩） */
  maxHistoryLength: number;
  /** 是否启用调试日志 */
  debug: boolean;
}

const DEFAULT_CONFIG: PlannerSessionConfig = {
  maxHistoryLength: 20,
  debug: false,
};

/** System Prompt - 定义 AI 的角色和行为 */
const PLANNER_SYSTEM_PROMPT = `你是一个专业的需求分析和项目规划助手。

在整个对话过程中，你需要：
1. 理解用户的项目需求
2. 提取关键信息（功能、约束、技术偏好）
3. 基于上下文生成针对性的问题
4. 最终生成结构化的项目蓝图

重要规则：
- 你必须使用 submit_data 工具返回结构化数据
- 不要输出纯文本，始终通过工具返回
- 记住之前的对话内容，不要重复询问已知信息
- 回答要简洁，不要啰嗦`;

// ============================================================================
// PlannerSession 类
// ============================================================================

export class PlannerSession extends EventEmitter {
  private client: ClaudeClient;
  private messages: Message[] = [];
  private config: PlannerSessionConfig;

  constructor(client?: ClaudeClient, config?: Partial<PlannerSessionConfig>) {
    super();
    this.client = client || getDefaultClient();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --------------------------------------------------------------------------
  // 核心方法：流式交互
  // --------------------------------------------------------------------------

  /**
   * 与 AI 进行流式交互
   *
   * @param instruction 指令（AI 已有上下文，不需要包含历史）
   * @param schema 期望返回的数据结构（用于定义工具）
   * @param options 选项
   */
  async *interact<T>(
    instruction: string,
    schema: Record<string, any>,
    options?: {
      /** 自定义系统提示词（追加到默认提示词后） */
      additionalPrompt?: string;
    }
  ): AsyncGenerator<SessionStreamEvent, T | null, unknown> {
    // 1. 添加用户消息到历史
    this.messages.push({
      role: 'user',
      content: instruction,
    });

    // 2. 构建工具定义
    const tool: ToolDefinition = {
      name: 'submit_data',
      description: '提交结构化数据',
      inputSchema: {
        type: 'object',
        properties: schema,
        required: Object.keys(schema),
      },
    };

    // 3. 构建系统提示词
    const systemPrompt = options?.additionalPrompt
      ? `${PLANNER_SYSTEM_PROMPT}\n\n${options.additionalPrompt}`
      : PLANNER_SYSTEM_PROMPT;

    // 4. 流式调用 API
    let toolInputJson = '';
    let hasToolUse = false;
    let fullText = '';

    if (this.config.debug) {
      console.log('[PlannerSession] Starting streaming interaction...');
      console.log('[PlannerSession] Message history length:', this.messages.length);
      console.log('[PlannerSession] Instruction:', instruction.slice(0, 200));
    }

    try {
      for await (const event of this.client.createMessageStream(
        this.messages,
        [tool],
        systemPrompt,
        {
          enableThinking: false,
          toolChoice: { type: 'tool', name: 'submit_data' },
        }
      )) {
        // 处理不同类型的事件
        if (event.type === 'text' && event.text) {
          fullText += event.text;
          yield { type: 'text', text: event.text };
        } else if (event.type === 'thinking' && event.thinking) {
          yield { type: 'thinking', thinking: event.thinking };
        } else if (event.type === 'tool_use_start') {
          hasToolUse = true;
          yield { type: 'tool_start', toolName: event.name };
        } else if (event.type === 'tool_use_delta' && event.input) {
          toolInputJson += event.input;
          yield { type: 'tool_delta', toolInput: event.input };
        } else if (event.type === 'stop') {
          yield { type: 'done' };
        } else if (event.type === 'error') {
          yield { type: 'error', error: event.error };
        }
      }

      // 5. 解析结果
      let result: T | null = null;

      if (hasToolUse && toolInputJson) {
        try {
          result = JSON.parse(toolInputJson) as T;

          // 添加 AI 响应到历史（包含工具调用）
          this.messages.push({
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool_' + Date.now(),
                name: 'submit_data',
                input: result,
              },
            ],
          });

          // 添加工具结果（让对话可以继续）
          this.messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tool_' + Date.now(),
                content: 'OK',
              },
            ],
          });

          yield { type: 'tool_result', result };
        } catch (e) {
          console.error('[PlannerSession] JSON parsing failed:', e);
          yield { type: 'error', error: 'JSON parsing failed' };
        }
      } else if (fullText) {
        // AI 没有调用工具，尝试从文本中解析
        const parsed = this.tryParseJSON<T>(fullText);
        if (parsed) {
          result = parsed;
          this.messages.push({
            role: 'assistant',
            content: fullText,
          });
        }
      }

      // 6. 检查是否需要压缩历史
      this.compressIfNeeded();

      return result;
    } catch (error: any) {
      console.error('[PlannerSession] Interaction failed:', error);
      yield { type: 'error', error: error.message };
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // 便捷方法：特定场景的交互
  // --------------------------------------------------------------------------

  /**
   * 分析用户输入 - Greeting 阶段
   * 合并：提取关键词 + 生成问题（原来2次调用，现在1次）
   */
  async *analyzeUserInput(userInput: string): AsyncGenerator<SessionStreamEvent, {
    projectGoal: string;
    coreFeatures: string[];
    keywords: string[];
    complexity: 'simple' | 'moderate' | 'complex';
    questions: string[];
  } | null, unknown> {
    const schema = {
      projectGoal: {
        type: 'string',
        description: '项目目标（一句话总结）',
      },
      coreFeatures: {
        type: 'array',
        items: { type: 'string' },
        description: '可能的核心功能列表（2-5个）',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '用于搜索代码库的关键词（英文，2-5个）',
      },
      complexity: {
        type: 'string',
        enum: ['simple', 'moderate', 'complex'],
        description: '需求复杂度',
      },
      questions: {
        type: 'array',
        items: { type: 'string' },
        description: '针对性的追问问题（2-3个）',
      },
    };

    const instruction = `用户描述了他想要构建的功能：
"${userInput}"

请分析并返回：
1. 项目目标（一句话总结）
2. 可能的核心功能列表（2-5个）
3. 用于搜索代码库的关键词（英文，如 auth, login, user）
4. 需求复杂度判断
5. 针对性的追问问题（2-3个，基于需求特点）`;

    return yield* this.interact(instruction, schema);
  }

  /**
   * 提取需求细节 - Requirements/Clarification 阶段
   */
  async *extractRequirements(userAnswer: string): AsyncGenerator<SessionStreamEvent, {
    newFeatures: string[];
    constraints: string[];
    needsClarification: boolean;
    clarificationQuestions: string[];
  } | null, unknown> {
    const schema = {
      newFeatures: {
        type: 'array',
        items: { type: 'string' },
        description: '新提到或确认的功能',
      },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: '技术约束或限制',
      },
      needsClarification: {
        type: 'boolean',
        description: '是否还需要进一步澄清',
      },
      clarificationQuestions: {
        type: 'array',
        items: { type: 'string' },
        description: '如果需要澄清，问什么问题',
      },
    };

    const instruction = `用户回答了需求确认问题：
"${userAnswer}"

基于之前的对话上下文，请提取：
1. 新提到或确认的功能
2. 技术约束或限制
3. 是否还需要进一步澄清
4. 如果需要澄清，应该问什么问题`;

    return yield* this.interact(instruction, schema);
  }

  /**
   * 推荐技术栈
   */
  async *suggestTechStack(existingTech?: Record<string, unknown>): AsyncGenerator<SessionStreamEvent, {
    language: string;
    framework?: string;
    packageManager: string;
    testFramework: string;
    buildTool?: string;
    additionalTools: string[];
    reasoning: string;
  } | null, unknown> {
    const schema = {
      language: {
        type: 'string',
        description: '推荐的编程语言',
      },
      framework: {
        type: 'string',
        description: '推荐的框架（可选）',
      },
      packageManager: {
        type: 'string',
        description: '包管理器',
      },
      testFramework: {
        type: 'string',
        description: '测试框架',
      },
      buildTool: {
        type: 'string',
        description: '构建工具（可选）',
      },
      additionalTools: {
        type: 'array',
        items: { type: 'string' },
        description: '其他推荐工具',
      },
      reasoning: {
        type: 'string',
        description: '推荐理由（一句话）',
      },
    };

    const existingInfo = existingTech
      ? `\n\n已检测到的现有技术栈：\n${JSON.stringify(existingTech, null, 2)}`
      : '';

    const instruction = `基于之前收集的需求，请推荐合适的技术栈。${existingInfo}

如果已有技术栈，优先沿用；如果是新项目，基于需求特点推荐。`;

    return yield* this.interact(instruction, schema);
  }

  /**
   * 生成完整蓝图
   */
  async *generateBlueprint(): AsyncGenerator<SessionStreamEvent, {
    name: string;
    description: string;
    modules: Array<{
      name: string;
      description: string;
      type: string;
      responsibilities: string[];
    }>;
    businessProcesses: Array<{
      name: string;
      steps: string[];
    }>;
  } | null, unknown> {
    const schema = {
      name: {
        type: 'string',
        description: '项目名称',
      },
      description: {
        type: 'string',
        description: '项目描述（2-3句话）',
      },
      modules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['frontend', 'backend', 'database', 'service', 'shared'] },
            responsibilities: { type: 'array', items: { type: 'string' } },
          },
        },
        description: '模块划分',
      },
      businessProcesses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            steps: { type: 'array', items: { type: 'string' } },
          },
        },
        description: '业务流程',
      },
    };

    const instruction = `基于我们整个对话中收集的需求、约束和技术栈，请生成完整的项目蓝图。

包括：
1. 项目名称和描述
2. 模块划分（前端、后端、数据库、服务等）
3. 业务流程（主要用户操作流程）`;

    return yield* this.interact(instruction, schema);
  }

  /**
   * 解析用户的修改请求
   */
  async *parseModification(modification: string): AsyncGenerator<SessionStreamEvent, {
    type: 'add_feature' | 'remove_feature' | 'modify_tech' | 'add_constraint' | 'other';
    target?: string;
    newValue?: string;
    message: string;
  } | null, unknown> {
    const schema = {
      type: {
        type: 'string',
        enum: ['add_feature', 'remove_feature', 'modify_tech', 'add_constraint', 'other'],
        description: '修改类型',
      },
      target: {
        type: 'string',
        description: '修改目标（可选）',
      },
      newValue: {
        type: 'string',
        description: '新值（可选）',
      },
      message: {
        type: 'string',
        description: '修改说明',
      },
    };

    const instruction = `用户请求修改：
"${modification}"

请分析这是什么类型的修改，并提取关键信息。`;

    return yield* this.interact(instruction, schema);
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  /**
   * 压缩历史消息（保留关键信息）
   */
  private compressIfNeeded(): void {
    if (this.messages.length <= this.config.maxHistoryLength) {
      return;
    }

    if (this.config.debug) {
      console.log('[PlannerSession] Compressing history, current length:', this.messages.length);
    }

    // 保留最近的消息，压缩早期的
    const keepRecent = Math.floor(this.config.maxHistoryLength * 0.6);
    const recentMessages = this.messages.slice(-keepRecent);

    // 早期消息生成摘要
    const earlyMessages = this.messages.slice(0, -keepRecent);
    const summary = this.summarizeMessages(earlyMessages);

    // 用摘要替换早期消息
    this.messages = [
      {
        role: 'user',
        content: `[对话历史摘要]\n${summary}`,
      },
      ...recentMessages,
    ];

    if (this.config.debug) {
      console.log('[PlannerSession] Length after compression:', this.messages.length);
    }
  }

  /**
   * 生成消息摘要
   */
  private summarizeMessages(messages: Message[]): string {
    const points: string[] = [];

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        // 提取关键信息
        if (msg.role === 'user' && msg.content.length < 200) {
          points.push(`用户: ${msg.content}`);
        }
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && block.input) {
            // 提取工具调用的关键结果
            const input = block.input as any;
            if (input.projectGoal) {
              points.push(`目标: ${input.projectGoal}`);
            }
            if (input.coreFeatures?.length) {
              points.push(`功能: ${input.coreFeatures.join(', ')}`);
            }
          }
        }
      }
    }

    return points.join('\n');
  }

  /**
   * 尝试从文本中解析 JSON
   */
  private tryParseJSON<T>(text: string): T | null {
    // 尝试直接解析
    try {
      return JSON.parse(text);
    } catch {
      // 尝试提取 JSON 块
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch {
          // 忽略
        }
      }

      // 尝试提取 {} 块
      const braceMatch = text.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch {
          // 忽略
        }
      }
    }
    return null;
  }

  /**
   * 获取当前消息历史长度
   */
  getHistoryLength(): number {
    return this.messages.length;
  }

  /**
   * 清空会话
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * 添加上下文信息（如代码库分析结果）
   */
  addContext(context: string): void {
    this.messages.push({
      role: 'user',
      content: `[上下文信息]\n${context}`,
    });
  }
}
