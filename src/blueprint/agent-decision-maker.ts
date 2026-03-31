/**
 * AgentDecisionMaker - 用 AI Agent 替代硬编码决策
 *
 * 核心理念：
 * - 用 AI 理解上下文，而不是硬编码的正则表达式/关键词匹配
 *
 * 功能：
 * 1. 任务成功判定 - 从非结构化文本中理解执行结果
 * 2. 错误诊断 - 分析错误原因，决定重试策略
 *
 * 已移除的"过度设计"：
 * - 模型选择：任务分解时已确定 complexity，直接映射即可
 * - 成本预估：应该是执行后统计，不是拍脑袋预估
 * - 复杂度评估：任务分解时已确定，不需要 AI 再评估
 */

import type { ConversationClient } from '../web/server/runtime/types.js';
import { ConversationLoop } from '../core/loop.js';
import type { SmartTask, TaskComplexity, Blueprint } from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/** 模型类型 */
export type ModelType = 'opus' | 'sonnet' | 'haiku';

/** API 契约判断结果 */
export interface APIContractDecision {
  needsContract: boolean;
  reason: string;
  frontendModules?: string[];
  backendModules?: string[];
}

/** 任务成功判定结果 */
export interface TaskVerdictDecision {
  verdict: 'passed' | 'failed' | 'needs_revision';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  issues?: string[];
  suggestions?: string[];
}

/** 复杂度评估结果 */
export interface ComplexityDecision {
  complexity: TaskComplexity;
  reason: string;
  factors: {
    codeChanges: 'minimal' | 'moderate' | 'extensive';
    integrationPoints: number;
    testingRequired: boolean;
    architecturalImpact: 'none' | 'low' | 'medium' | 'high';
  };
}

/** 错误诊断结果 */
export interface ErrorDiagnosisDecision {
  errorType: 'timeout' | 'api_error' | 'code_error' | 'environment' | 'unknown';
  rootCause: string;
  shouldRetry: boolean;
  retryStrategy?: 'immediate' | 'with_fix' | 'different_approach';
  suggestedFix?: string;
}

// ============================================================================
// AgentDecisionMaker 类
// ============================================================================

export class AgentDecisionMaker {
  private client: ConversationClient;
  private debug: boolean;

  constructor(client: ConversationClient, debug: boolean = false) {
    this.client = client;
    this.debug = debug;
  }

  // --------------------------------------------------------------------------
  // 1. API 契约判断 - 替代正则表达式匹配
  // --------------------------------------------------------------------------

  /**
   * 判断项目是否需要生成 API 契约
   * 替代: smart-planner.ts:1519-1529 的正则表达式判断
   */
  async decideAPIContract(
    blueprint: Blueprint,
    projectContext?: string
  ): Promise<APIContractDecision> {
    const prompt = `分析以下项目蓝图，判断是否需要生成前后端 API 契约。

## 项目蓝图
${JSON.stringify(blueprint, null, 2)}

${projectContext ? `## 项目上下文\n${projectContext}` : ''}

## 判断标准
1. 是否是前后端分离架构
2. 是否有需要通过 HTTP/WebSocket 通信的模块
3. 是否有独立的 API 服务层

## 返回格式（JSON）
{
  "needsContract": true/false,
  "reason": "判断理由",
  "frontendModules": ["前端模块名称列表，如果有"],
  "backendModules": ["后端模块名称列表，如果有"]
}

只返回 JSON，不要其他文字。`;

    const result = await this.askAgent<APIContractDecision>(prompt, 'haiku');
    return result || {
      needsContract: false,
      reason: 'Agent 无法判断，默认不需要',
    };
  }

  // --------------------------------------------------------------------------
  // 2. 任务成功判定 - 替代 includes('passed') 字符串匹配
  // --------------------------------------------------------------------------

  /**
   * 判断任务是否成功完成
   * 替代: task-reviewer.ts:608-614 的关键词匹配
   */
  async decideTaskVerdict(
    task: SmartTask,
    executionOutput: string,
    expectedOutcome?: string
  ): Promise<TaskVerdictDecision> {
    const prompt = `分析以下任务执行结果，判断任务是否成功完成。

## 任务信息
- 任务ID: ${task.id}
- 任务描述: ${task.description}
- 任务类型: ${task.type}
- 是否需要测试: ${task.needsTest ? '是' : '否'}

${expectedOutcome ? `## 期望结果\n${expectedOutcome}` : ''}

## 执行输出
${executionOutput.substring(0, 5000)}${executionOutput.length > 5000 ? '\n...(输出被截断)' : ''}

## 判断标准
1. 任务目标是否达成
2. 是否有错误或异常
3. 输出是否符合预期
4. 是否需要进一步修改

## 返回格式（JSON）
{
  "verdict": "passed" | "failed" | "needs_revision",
  "confidence": "high" | "medium" | "low",
  "reasoning": "详细判断理由",
  "issues": ["发现的问题列表，如果有"],
  "suggestions": ["改进建议，如果有"]
}

只返回 JSON，不要其他文字。`;

    const result = await this.askAgent<TaskVerdictDecision>(prompt, 'sonnet');
    return result || {
      verdict: 'needs_revision',
      confidence: 'low',
      reasoning: 'Agent 无法判断，需要人工审查',
    };
  }

  /**
   * 从非结构化文本中解析任务审查结果
   * 用于当 Reviewer 返回的响应无法解析为 JSON 时，让 AI 重新理解文本含义
   *
   * 这比简单的关键词匹配（如 includes('passed')）更可靠，因为：
   * - "这个任务没有 passed 所需验收标准" 不会被误判为通过
   * - AI 能理解复杂的语义和上下文
   */
  async askAgentForVerdict(reviewerResponse: string): Promise<TaskVerdictDecision | null> {
    const prompt = `分析以下审查员的响应文本，提取任务审查结论。

## 审查员原始响应
${reviewerResponse.substring(0, 3000)}${reviewerResponse.length > 3000 ? '\n...(内容被截断)' : ''}

## 你的任务
仔细阅读上述文本，判断审查员的最终结论是：
- **passed**: 任务成功完成，验收通过
- **failed**: 任务失败，存在严重问题
- **needs_revision**: 任务部分完成，需要修改

## 注意事项
- 关注审查员的**最终结论**，而不是中间讨论
- 如果文本中提到"通过"但同时列出了必须修复的问题，应判断为 needs_revision
- 如果无法确定，选择 needs_revision

## 返回格式（JSON）
{
  "verdict": "passed" | "failed" | "needs_revision",
  "confidence": "high" | "medium" | "low",
  "reasoning": "你的判断依据",
  "issues": ["从原文中提取的问题列表，如果有"],
  "suggestions": ["从原文中提取的建议，如果有"]
}

只返回 JSON，不要其他文字。`;

    return await this.askAgent<TaskVerdictDecision>(prompt, 'haiku');
  }

  // --------------------------------------------------------------------------
  // 3. 复杂度评估（保留但不常用，任务分解时已确定）
  // --------------------------------------------------------------------------

  /**
   * 分析任务实际复杂度
   * 替代: 各处硬编码的 complexity 判断
   */
  async decideComplexity(
    taskDescription: string,
    codeContext?: string
  ): Promise<ComplexityDecision> {
    const prompt = `分析以下任务的实际复杂度。

## 任务描述
${taskDescription}

${codeContext ? `## 相关代码上下文\n${codeContext.substring(0, 3000)}` : ''}

## 复杂度级别
- **trivial**: 单行修改、配置调整、注释添加
- **simple**: 单文件内的小功能、简单 bug 修复
- **moderate**: 多文件协调、中等功能、需要测试
- **complex**: 架构变更、跨模块重构、复杂算法

## 返回格式（JSON）
{
  "complexity": "trivial" | "simple" | "moderate" | "complex",
  "reason": "判断理由",
  "factors": {
    "codeChanges": "minimal" | "moderate" | "extensive",
    "integrationPoints": 涉及的集成点数量,
    "testingRequired": true/false,
    "architecturalImpact": "none" | "low" | "medium" | "high"
  }
}

只返回 JSON，不要其他文字。`;

    const result = await this.askAgent<ComplexityDecision>(prompt, 'haiku');
    return result || {
      complexity: 'moderate',
      reason: 'Agent 无法判断，使用中等复杂度',
      factors: {
        codeChanges: 'moderate',
        integrationPoints: 1,
        testingRequired: true,
        architecturalImpact: 'low',
      },
    };
  }

  // --------------------------------------------------------------------------
  // 5. 错误诊断 - 替代 includes('超时') 关键词匹配
  // --------------------------------------------------------------------------

  /**
   * 诊断错误原因，决定重试策略
   * 替代: realtime-coordinator.ts:1284 的关键词匹配
   */
  async diagnoseError(
    errorMessage: string,
    taskContext?: {
      taskDescription?: string;
      executionHistory?: string[];
      retryCount?: number;
    }
  ): Promise<ErrorDiagnosisDecision> {
    const prompt = `分析以下错误，诊断原因并给出重试建议。

## 错误信息
${errorMessage}

${taskContext?.taskDescription ? `## 任务描述\n${taskContext.taskDescription}` : ''}
${taskContext?.executionHistory?.length ? `## 执行历史\n${taskContext.executionHistory.join('\n')}` : ''}
${taskContext?.retryCount !== undefined ? `## 已重试次数: ${taskContext.retryCount}` : ''}

## 错误类型
- **timeout**: 执行超时
- **api_error**: API 调用失败
- **code_error**: 代码逻辑错误
- **environment**: 环境配置问题
- **unknown**: 无法确定

## 返回格式（JSON）
{
  "errorType": "timeout" | "api_error" | "code_error" | "environment" | "unknown",
  "rootCause": "根本原因分析",
  "shouldRetry": true/false,
  "retryStrategy": "immediate" | "with_fix" | "different_approach",
  "suggestedFix": "建议的修复方案，如果有"
}

只返回 JSON，不要其他文字。`;

    const result = await this.askAgent<ErrorDiagnosisDecision>(prompt, 'haiku');
    return result || {
      errorType: 'unknown',
      rootCause: 'Agent 无法诊断',
      shouldRetry: false,
    };
  }

  // --------------------------------------------------------------------------
  // 6. 对话阶段判断 - 替代固定的状态机
  // --------------------------------------------------------------------------

  /**
   * 判断对话应该进入哪个阶段
   * 替代: smart-planner.ts 中固定的 switch-case 状态机
   */
  async decideNextDialogPhase(
    currentPhase: string,
    collectedInfo: Record<string, any>,
    userInput: string
  ): Promise<{
    nextPhase: string;
    response: string;
    missingInfo?: string[];
  }> {
    const prompt = `作为需求分析助手，根据当前收集的信息，决定下一步应该做什么。

## 当前阶段
${currentPhase}

## 已收集信息
${JSON.stringify(collectedInfo, null, 2)}

## 用户最新输入
${userInput}

## 可用阶段
- greeting: 初次问候，了解项目大概
- requirements: 收集核心需求
- clarification: 澄清模糊点
- tech_choice: 确认技术选型
- confirmation: 确认蓝图
- done: 完成

## 判断原则
1. 如果核心需求已清晰，可以跳过不必要的阶段
2. 如果用户提供了足够信息，直接进入下一步
3. 如果有关键信息缺失，停留在当前阶段追问

## 返回格式（JSON）
{
  "nextPhase": "下一阶段名称",
  "response": "给用户的回复",
  "missingInfo": ["缺失的关键信息，如果有"]
}

只返回 JSON，不要其他文字。`;

    const result = await this.askAgent<{
      nextPhase: string;
      response: string;
      missingInfo?: string[];
    }>(prompt, 'sonnet');

    return result || {
      nextPhase: currentPhase,
      response: '请继续描述您的需求。',
    };
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  /**
   * 调用 Agent 获取决策结果
   * v5.5: 支持工具能力，让蜂王能用 Bash/Read/Grep 等工具来分析代码做决策
   * v5.7: 添加重试机制，网络抖动时自动重试
   * @param prompt 提示词
   * @param model 模型选择
   * @param useTools 是否启用工具（默认 false，快速决策场景不需要工具）
   * @param projectPath 项目路径（使用工具时需要）
   */
  private async askAgent<T>(
    prompt: string,
    model: ModelType,
    useTools: boolean = false,
    projectPath?: string
  ): Promise<T | null> {
    const MAX_RETRIES = 3;
    const INITIAL_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (this.debug) {
          console.log(`[AgentDecisionMaker] Asking ${model} (tools=${useTools}, attempt=${attempt}/${MAX_RETRIES}):`, prompt.substring(0, 200));
        }

        const systemPrompt = `你是一个专业的技术决策助手。
${useTools ? '你可以使用工具来分析代码、检查文件，获取更准确的信息来做决策。' : ''}
你的最终回答必须是有效的 JSON 格式，不要包含任何其他文字。`;

        let text: string;

        if (useTools && projectPath) {
          // v5.5: 使用 ConversationLoop，赋予蜂王工具能力
          const loop = new ConversationLoop({
            model,
            maxTurns: 5,  // 蜂王决策不需要太多轮
            verbose: false,
            permissionMode: 'bypassPermissions',
            workingDir: projectPath,
            systemPrompt,
            isSubAgent: true,
            allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'LS'],  // 只读工具 + Bash
          });

          text = await loop.processMessage(prompt);
        } else {
          // 快速决策模式：直接调用 API，不使用工具
          const response = await this.client.createMessage(
            [{ role: 'user', content: prompt }],
            undefined,
            systemPrompt
          );
          text = this.extractTextFromResponse(response);
        }

        const json = this.extractJSON(text);

        if (this.debug) {
          console.log('[AgentDecisionMaker] Response:', json);
        }

        return json as T;
      } catch (error: any) {
        const isRetryable = this.isRetryableError(error);
        console.error(`[AgentDecisionMaker] Error (attempt ${attempt}/${MAX_RETRIES}, retryable=${isRetryable}):`, error.message);

        if (!isRetryable || attempt === MAX_RETRIES) {
          // 不可重试的错误，或已达到最大重试次数
          return null;
        }

        // 指数退避等待
        const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[AgentDecisionMaker] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }

  /**
   * 判断错误是否可重试
   * 网络错误、超时、5xx 服务器错误可以重试
   * 4xx 客户端错误（如 401、400）不重试
   */
  private isRetryableError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';

    // 网络相关错误
    if (message.includes('connection') ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('socket') ||
        message.includes('etimedout')) {
      return true;
    }

    // HTTP 5xx 错误
    if (message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('overloaded') ||
        message.includes('rate limit')) {
      return true;
    }

    // HTTP 4xx 错误不重试
    if (message.includes('400') ||
        message.includes('401') ||
        message.includes('403') ||
        message.includes('404') ||
        message.includes('invalid') ||
        message.includes('unauthorized')) {
      return false;
    }

    // 默认重试（乐观策略）
    return true;
  }

  /**
   * 从响应中提取文本
   */
  private extractTextFromResponse(response: any): string {
    if (typeof response === 'string') return response;
    if (response?.content) {
      if (Array.isArray(response.content)) {
        return response.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');
      }
      return String(response.content);
    }
    return JSON.stringify(response);
  }

  /**
   * 从文本中提取 JSON
   */
  private extractJSON(text: string): any {
    // 尝试直接解析
    try {
      return JSON.parse(text);
    } catch {
      // 尝试提取 JSON 块
      const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
      }

      // 尝试提取 {} 或 [] 包裹的内容
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        return JSON.parse(objectMatch[0]);
      }

      const arrayMatch = text.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        return JSON.parse(arrayMatch[0]);
      }

      throw new Error('Unable to extract JSON from response');
    }
  }
}

// ============================================================================
// 导出单例
// ============================================================================

let defaultInstance: AgentDecisionMaker | null = null;

export function getAgentDecisionMaker(client?: ConversationClient, debug: boolean = false): AgentDecisionMaker {
  if (!defaultInstance) {
    if (!client) {
      throw new Error('[AgentDecisionMaker] No client provided and no existing instance. Call with a ConversationClient first.');
    }
    defaultInstance = new AgentDecisionMaker(client, debug);
  }
  return defaultInstance;
}

export function resetAgentDecisionMaker(): void {
  defaultInstance = null;
}
