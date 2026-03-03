/**
 * SubmitReview 工具 - Reviewer 专用工具
 *
 * 设计理念：
 * - 用工具调用替代文本解析，100% 保证结构化输出
 * - 工具的输入 schema 就是审查结果的类型定义
 * - 避免复杂的 JSON 提取和解析逻辑
 *
 * v6.0: 根本解决 Reviewer 返回格式不规范的问题
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

// 审查结果输入类型
export interface SubmitReviewInput {
  verdict: 'passed' | 'failed' | 'needs_revision';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  verified?: string[];
  issues?: string[];
  suggestions?: string[];
}

/**
 * SubmitReview 工具
 * Reviewer Agent 专用，用于提交审查结果
 */
export class SubmitReviewTool extends BaseTool<SubmitReviewInput, ToolResult> {
  name = 'SubmitReview';
  description = `Submit task review results (Reviewer exclusive tool)

## When to Use
After completing task verification, you must call this tool to submit review conclusions.

## Parameters
- verdict: Review conclusion
  - "passed": Task successfully completed, code meets requirements
  - "failed": Task failed, serious issues exist
  - "needs_revision": Task partially completed, modifications needed
- confidence: Confidence level
  - "high": You have fully verified (e.g., checked Git commits and core files)
  - "medium": Based on partial verification
  - "low": Insufficient information, more verification needed
- reasoning: Judgment rationale (concise and clear)
- verified: What you actually verified (optional)
- issues: List of discovered issues (should be provided when verdict is failed or needs_revision)
- suggestions: Improvement suggestions (recommended when verdict is needs_revision)

## Example
{
  "verdict": "passed",
  "confidence": "high",
  "reasoning": "Git commits verified, health check service implementation is correct",
  "verified": ["Git commit status", "src/services/health.ts code quality"],
  "issues": [],
  "suggestions": []
}`;

  // 存储审查结果（会被 Reviewer 读取）
  private static lastReviewResult: SubmitReviewInput | null = null;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        verdict: {
          type: 'string',
          enum: ['passed', 'failed', 'needs_revision'],
          description: 'Review verdict: passed=approved, failed=rejected, needs_revision=needs modification',
        },
        confidence: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Confidence level: high=highly confident, medium=moderately confident, low=low confidence',
        },
        reasoning: {
          type: 'string',
          description: 'Judgment rationale (concise and clear, 1-2 sentences)',
        },
        verified: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of actually verified items (e.g., Git commit status, core file code quality)',
        },
        issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of discovered issues (required for failed or needs_revision)',
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Improvement suggestions (recommended for needs_revision)',
        },
      },
      required: ['verdict', 'confidence', 'reasoning'],
    };
  }

  async execute(input: SubmitReviewInput): Promise<ToolResult> {
    // 保存审查结果
    SubmitReviewTool.lastReviewResult = input;

    // 返回确认信息
    const emoji = input.verdict === 'passed' ? '✅' :
                  input.verdict === 'failed' ? '❌' : '⚠️';

    const output = `${emoji} Review results submitted

Verdict: ${input.verdict}
Confidence: ${input.confidence}
Reasoning: ${input.reasoning}
${input.verified?.length ? `Verified: ${input.verified.join(', ')}` : ''}
${input.issues?.length ? `Issues: ${input.issues.length}` : ''}
${input.suggestions?.length ? `Suggestions: ${input.suggestions.length}` : ''}

Review process completed.`;

    return {
      success: true,
      output,
      data: input,
    };
  }

  /**
   * 获取最后一次审查结果
   * 供 TaskReviewer 调用
   */
  static getLastReviewResult(): SubmitReviewInput | null {
    return SubmitReviewTool.lastReviewResult;
  }

  /**
   * 清除审查结果
   * 每次新审查开始前调用
   */
  static clearReviewResult(): void {
    SubmitReviewTool.lastReviewResult = null;
  }
}
