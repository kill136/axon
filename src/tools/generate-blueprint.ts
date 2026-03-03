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
  // 全景蓝图字段（Agent 扫描代码库后填充）
  modules?: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    rootPath?: string;
    responsibilities?: string[];
    dependencies?: string[];
  }>;
  businessProcesses?: Array<{
    id: string;
    name: string;
    type?: string;
    description: string;
    steps?: string[];
  }>;
  nfrs?: Array<{
    name: string;
    category: string;
    description: string;
  }>;
}

/**
 * GenerateBlueprint 工具
 * 主 Agent 专用，将对话需求结构化为项目蓝图
 */
export class GenerateBlueprintTool extends BaseTool<GenerateBlueprintInput, ToolResult> {
  name = 'GenerateBlueprint';
  description = `Structure conversation requirements or codebase analysis results into a project blueprint

## Two Modes

### Mode 1: Requirements Blueprint (New Project)
After the user describes requirements, fill in name/description/requirements/techStack/brief to generate a blueprint.

### Mode 2: Panoramic Blueprint (Existing Project)
When the user requests analysis of an existing codebase, first use Glob/Grep/Read to explore the project structure, then fill in modules/businessProcesses/nfrs to generate a panoramic blueprint.

## Parameters
- name: Project name
- description: Project description (1-3 sentences)
- requirements: Core requirements list (for requirements blueprint)
- techStack: Tech stack
- constraints: Constraints (optional)
- brief: **Most important parameter** — your in-depth understanding of the requirements/project
- modules: Identified system modules (for panoramic blueprint)
- businessProcesses: Identified business processes (for panoramic blueprint)
- nfrs: Non-functional requirements (for panoramic blueprint)

## Notes
- Requirements blueprint: Ensure user requirements are fully understood before calling
- Panoramic blueprint: Must use tools to thoroughly explore the codebase before calling
- Generated blueprints are saved and can be viewed on the blueprint page`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name',
        },
        description: {
          type: 'string',
          description: 'Project description (1-3 sentences summarizing the project goal)',
        },
        requirements: {
          type: 'array',
          items: { type: 'string' },
          description: 'Core requirements list (one feature per item)',
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
          description: 'Tech stack selection',
        },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Constraints (optional)',
        },
        brief: {
          type: 'string',
          description: 'Key context brief: design decisions, user preferences, exclusions, tech selection rationale, etc. (passed to execution engine)',
        },
        modules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string', description: 'frontend|backend|service|database|infrastructure|shared|other' },
              description: { type: 'string' },
              rootPath: { type: 'string' },
              responsibilities: { type: 'array', items: { type: 'string' } },
              dependencies: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'name', 'type', 'description'],
          },
          description: 'For panoramic blueprint: identified system modules list',
        },
        businessProcesses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string', description: 'core|support|management' },
              description: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'name', 'description'],
          },
          description: 'For panoramic blueprint: identified business processes list',
        },
        nfrs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              category: { type: 'string', description: 'performance|security|reliability|scalability|maintainability|usability' },
              description: { type: 'string' },
            },
            required: ['name', 'category', 'description'],
          },
          description: 'For panoramic blueprint: non-functional requirements list',
        },
      },
      required: ['name', 'description', 'brief'],
    };
  }

  async execute(_input: GenerateBlueprintInput): Promise<ToolResult> {
    // 实际执行由 ConversationManager.executeTool() 拦截处理
    // 这里仅作为 fallback（CLI 模式或未被拦截时）
    return {
      success: false,
      output: 'GenerateBlueprint tool must be used through the Web chat interface. Please invoke it in the Chat Tab.',
    };
  }
}
