/**
 * GenerateBlueprint 工具 - Chat Tab 主 Agent 专用
 *
 * v10.0: 将对话中收集的需求结构化为项目蓝图
 *
 * 设计理念：
 * - 主 Agent 通过自然对话收集需求后，调用此工具生成 Blueprint
 * - 工具注册到全局 ToolRegistry（提供 schema）
 * - 实际执行由 ConversationManager.executeTool() 拦截处理
 *   （同 Task/AskUserQuestion 模式）
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

export interface GenerateBlueprintInput {
  name: string;
  description: string;
  requirements: string[];
  techStack?: {
    language?: string;
    framework?: string;
    database?: string;
    styling?: string;
    testing?: string;
    [key: string]: string | undefined;
  };
  constraints?: string[];
  brief: string;
}

/**
 * GenerateBlueprint 工具
 * 主 Agent 专用，将对话需求结构化为项目蓝图
 */
export class GenerateBlueprintTool extends BaseTool<GenerateBlueprintInput, ToolResult> {
  name = 'GenerateBlueprint';
  description = `将对话中收集的需求结构化为项目蓝图

## 使用时机
一些比较大的需求改动才使用这工具，比如创建新的项目，普通的小改动，请使用PlanMode工具，当你与用户充分讨论了项目需求后，调用此工具生成结构化蓝图。

## 参数说明
- name: 项目名称
- description: 项目描述（1-3句话）
- requirements: 核心需求列表（每条一个功能点）
- techStack: 技术栈（language, framework, database 等）
- constraints: 约束条件（可选）
- brief: **最重要的参数** — 你对需求的深度理解，会传递给执行引擎

## 注意
- 在调用前确保已充分了解用户需求
- brief 写清楚：设计决策、用户偏好、排除项、技术选型理由
- 生成后蓝图会保存，用户可在蓝图页面查看`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '项目名称',
        },
        description: {
          type: 'string',
          description: '项目描述（1-3句话概括项目目标）',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: '核心需求列表（每条一个功能点）',
        },
        techStack: {
          type: 'object',
          properties: {
            language: { type: 'string' },
            framework: { type: 'string' },
            database: { type: 'string' },
            styling: { type: 'string' },
            testing: { type: 'string' },
          },
          description: '技术栈选择',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: '约束条件（可选）',
        },
        brief: {
          type: 'string',
          description: '关键上下文简报：设计决策、用户偏好、排除项、技术选型理由等（传递给执行引擎）',
        },
      },
      required: ['name', 'description', 'requirements', 'brief'],
    };
  }

  async execute(_input: GenerateBlueprintInput): Promise<ToolResult> {
    // 实际执行由 ConversationManager.executeTool() 拦截处理
    // 这里仅作为 fallback（CLI 模式或未被拦截时）
    return {
      success: false,
      output: 'GenerateBlueprint 工具需要通过 Web 聊天界面使用。请在 Chat Tab 中调用。',
    };
  }
}
