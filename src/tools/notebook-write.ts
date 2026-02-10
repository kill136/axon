/**
 * NotebookWrite 工具
 *
 * 让 agent 管理自己的两个笔记本：
 * - experience: 跨项目经验
 * - project: 项目知识
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getNotebookManager, type NotebookType } from '../memory/notebook.js';

export interface NotebookWriteInput {
  /** 笔记本类型 */
  notebook: NotebookType;
  /** 写入内容（完整替换）。传空字符串表示读取当前内容。 */
  content: string;
}

export class NotebookWriteTool extends BaseTool<NotebookWriteInput, ToolResult> {
  name = 'NotebookWrite';
  description = `Manage your personal notebooks to persist memories and work experience across conversations.

## MANDATORY AUTO-TRIGGER RULES
You MUST call this tool IMMEDIATELY (in the same response, before any text reply) when:
1. User shares personal info (name, role, preferences, contact) → write to experience
2. User explicitly asks you to remember something → write to experience or project
3. You discover a project gotcha not covered in CLAUDE.md → write to project

Saying "I'll remember" without calling this tool is a LIE — conversation memory is ephemeral. Only notebook writes persist.

## Two Notebooks
- **experience**: Cross-project knowledge — user info, work patterns, lessons learned. (~4K tokens max)
- **project**: Things YOU discovered about this project that are NOT in CLAUDE.md — gotchas, hidden dependencies, operational tips. (~8K tokens max)

## IMPORTANT: project notebook vs CLAUDE.md
CLAUDE.md contains the user's project instructions and documentation. Do NOT duplicate its content into project notebook.
Only write things you discovered during work that CLAUDE.md does not cover:
- "改 types.ts 后要同步改 attachments.ts"
- "session.sessionId 是 getter 不是方法，别用 getId()"
- "compress() 有逻辑 bug，CORE 分支不可达"

## Guidelines
- Write in markdown, keep it concise
- Add dates for time-sensitive info: "偏好 React (2026-02)"
- Record patterns, not volatile facts (facts go stale, patterns don't)
- When new info contradicts your notes, update the notes
- Stay within token budgets — prune stale content when needed

## Reading
Pass empty string as content to read the current notebook.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        notebook: {
          type: 'string',
          enum: ['experience', 'project'],
          description: 'Which notebook to read/write',
        },
        content: {
          type: 'string',
          description: 'Full content to write (replaces existing). Empty string to read.',
        },
      },
      required: ['notebook', 'content'],
    };
  }

  async execute(input: NotebookWriteInput): Promise<ToolResult> {
    const manager = getNotebookManager();
    if (!manager) {
      return this.error('NotebookManager 未初始化。');
    }

    const { notebook, content } = input;

    // 验证笔记本类型
    if (!['experience', 'project'].includes(notebook)) {
      return this.error(`无效的笔记本类型: ${notebook}。可选: experience, project`);
    }

    // 读取模式
    if (!content || content.trim() === '') {
      const existing = manager.read(notebook);
      if (!existing.trim()) {
        return this.success(`[${notebook}] 笔记本为空。`);
      }
      return this.success(existing);
    }

    // 写入模式
    const result = manager.write(notebook, content);
    if (!result.success) {
      return this.error(result.error!);
    }

    return this.success(
      `✓ 已更新 ${notebook} 笔记本 (${result.tokens} tokens)\n路径: ${result.path}`
    );
  }
}
