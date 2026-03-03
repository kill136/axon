/**
 * SubmitE2EResult 工具 - E2E 测试 Agent 专用
 *
 * 设计理念：
 * - 用工具调用替代文本解析，100% 保证结构化输出
 * - E2E Agent 通过此工具提交测试结果
 * - 支持详细的测试步骤记录和设计图对比结果
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

// 测试步骤结果
export interface E2EStepResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  description?: string;
  error?: string;
  screenshotPath?: string;
  designComparison?: {
    designPath: string;
    similarityScore: number;
    passed: boolean;
    differences?: string[];
  };
}

// E2E 测试结果输入类型
export interface SubmitE2EResultInput {
  success: boolean;
  summary: string;
  steps: E2EStepResult[];
  totalDuration?: number;
  fixAttempts?: Array<{
    description: string;
    success: boolean;
  }>;
  environmentIssues?: string[];
  recommendations?: string[];
}

/**
 * SubmitE2EResult 工具
 * E2E 测试 Agent 专用，用于提交测试结果
 */
export class SubmitE2EResultTool extends BaseTool<SubmitE2EResultInput, ToolResult> {
  name = 'SubmitE2EResult';
  description = `Submit E2E test results (E2E test Agent exclusive tool)

## When to Use
After completing all tests, you must call this tool to submit test conclusions.

## Parameters
- success: Whether overall test succeeded (all critical steps passed)
- summary: Test summary (concise description of test results)
- steps: Test step results array
  - name: Step name
  - status: "passed" | "failed" | "skipped"
  - description: Step description (optional)
  - error: Failure reason (optional)
  - screenshotPath: Screenshot path (optional)
  - designComparison: Design comparison result (optional)
- totalDuration: Total test duration (milliseconds, optional)
- fixAttempts: Fix attempt records (optional)
- environmentIssues: Environment issue list (optional)
- recommendations: Improvement suggestions (optional)

## Example
{
  "success": true,
  "summary": "All 5 test steps passed, page matches design",
  "steps": [
    { "name": "Homepage load", "status": "passed" },
    { "name": "User login", "status": "passed" },
    { "name": "Navigate to settings", "status": "passed" }
  ],
  "totalDuration": 45000
}`;

  // 存储测试结果（会被 E2ETestAgent 读取）
  private static lastE2EResult: SubmitE2EResultInput | null = null;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether overall test succeeded',
        },
        summary: {
          type: 'string',
          description: 'Test summary (1-3 concise sentences)',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Step name' },
              status: {
                type: 'string',
                enum: ['passed', 'failed', 'skipped'],
                description: 'Step status',
              },
              description: { type: 'string', description: 'Step description' },
              error: { type: 'string', description: 'Failure reason' },
              screenshotPath: { type: 'string', description: 'Screenshot path' },
              designComparison: {
                type: 'object',
                properties: {
                  designPath: { type: 'string' },
                  similarityScore: { type: 'number' },
                  passed: { type: 'boolean' },
                  differences: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            required: ['name', 'status'],
          },
          description: 'Test step results list',
        },
        totalDuration: {
          type: 'number',
          description: 'Total test duration (milliseconds)',
        },
        fixAttempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              success: { type: 'boolean' },
            },
          },
          description: 'Fix attempt records',
        },
        environmentIssues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment issue list',
        },
        recommendations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Improvement suggestions',
        },
      },
      required: ['success', 'summary', 'steps'],
    };
  }

  async execute(input: SubmitE2EResultInput): Promise<ToolResult> {
    // 保存测试结果
    SubmitE2EResultTool.lastE2EResult = input;

    // 计算统计
    const passedSteps = input.steps.filter(s => s.status === 'passed').length;
    const failedSteps = input.steps.filter(s => s.status === 'failed').length;
    const skippedSteps = input.steps.filter(s => s.status === 'skipped').length;

    const emoji = input.success ? '✅' : '❌';

    const output = `${emoji} E2E test results submitted

Summary: ${input.summary}

Step statistics:
- Passed: ${passedSteps}
- Failed: ${failedSteps}
- Skipped: ${skippedSteps}

${input.totalDuration ? `Total duration: ${Math.round(input.totalDuration / 1000)}s` : ''}
${input.fixAttempts?.length ? `Fix attempts: ${input.fixAttempts.length}` : ''}
${input.environmentIssues?.length ? `Environment issues: ${input.environmentIssues.length}` : ''}

Test flow completed.`;

    return {
      success: true,
      output,
      data: input,
    };
  }

  /**
   * 获取最后一次测试结果
   * 供 E2ETestAgent 调用
   */
  static getLastE2EResult(): SubmitE2EResultInput | null {
    return SubmitE2EResultTool.lastE2EResult;
  }

  /**
   * 清除测试结果
   * 每次新测试开始前调用
   */
  static clearE2EResult(): void {
    SubmitE2EResultTool.lastE2EResult = null;
  }
}
