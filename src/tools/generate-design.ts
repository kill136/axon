/**
 * GenerateDesign 工具 - Chat Tab 主 Agent 专用
 *
 * v10.0: 使用 Gemini 生成 UI 设计图
 *
 * 设计理念：
 * - 主 Agent 在需求收集过程中，可以调用此工具为用户生成可视化 UI 预览
 * - 工具注册到全局 ToolRegistry（提供 schema）
 * - 实际执行由 ConversationManager.executeTool() 拦截处理
 *   （调用 geminiImageService.generateDesign()）
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

export interface GenerateDesignInput {
  projectName: string;
  projectDescription: string;
  requirements: string[];
  constraints?: string[];
  techStack?: Record<string, string | undefined>;
  style?: 'modern' | 'minimal' | 'corporate' | 'creative';
}

/**
 * GenerateDesign 工具
 * 主 Agent 专用，调用 Gemini 生成 UI 设计图
 */
export class GenerateDesignTool extends BaseTool<GenerateDesignInput, ToolResult> {
  name = 'GenerateDesign';
  description = `使用 AI 生成项目的 UI 设计图/界面原型图，不仅仅限于这些种类的图片

## 使用时机
当你与用户讨论项目需求时，可以调用此工具生成可视化的 UI 设计预览，帮助用户直观理解项目外观。

## 参数说明
- projectName: 项目名称
- projectDescription: 项目描述
- requirements: 核心需求列表（功能点）
- constraints: 约束条件（可选）
- techStack: 技术栈信息（可选）
- style: 设计风格（可选，默认 modern）
  - modern: 现代扁平化设计
  - minimal: 极简主义
  - corporate: 企业级专业风格
  - creative: 创意大胆风格

## 注意
- 需要配置 GEMINI_API_KEY 环境变量
- 生成的设计图会发送给用户在聊天中预览
- 可以在需求收集阶段多次调用，帮助用户确认 UI 方向`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: '项目名称',
        },
        projectDescription: {
          type: 'string',
          description: '项目描述',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: '核心需求列表（功能点）',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: '约束条件（可选）',
        },
        techStack: {
          type: 'object',
          description: '技术栈信息（可选）',
        },
        style: {
          type: 'string',
          enum: ['modern', 'minimal', 'corporate', 'creative'],
          description: '设计风格（可选，默认 modern）',
        },
      },
      required: ['projectName', 'projectDescription', 'requirements'],
    };
  }

  async execute(_input: GenerateDesignInput): Promise<ToolResult> {
    // 实际执行由 ConversationManager.executeTool() 拦截处理
    // 这里仅作为 fallback（CLI 模式或未被拦截时）
    return {
      success: false,
      output: 'GenerateDesign 工具需要通过 Web 聊天界面使用。请在 Chat Tab 中调用。',
    };
  }
}
