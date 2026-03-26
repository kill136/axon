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
import { t } from '../i18n/index.js';

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
1. User shares personal info (name, role, preferences, contact) → write to profile
2. User explicitly asks you to remember something → write to experience or project
3. You discover a project gotcha not covered in AXON.md → write to project

Saying "I'll remember" without calling this tool is a LIE — conversation memory is ephemeral. Only notebook writes persist.

## Three Notebooks
- **profile**: Stable personal info — name, role, contact, preferences, background. (~2K tokens max)
  Prefer this structure: Basic Info / Stable Preferences / Communication Style / Working Style / Decision Signals / Values & Motivations / Do Not Assume / Open Questions
  Prefer compact bullets such as: \`- Prefers concise Chinese replies [updated: 2026-03-21; evidence: user stated directly]\`
- **experience**: Cross-project knowledge — work patterns, lessons learned, anti-patterns. (~4K tokens max)
- **project**: Things YOU discovered about this project that are NOT in AXON.md — gotchas, hidden dependencies, operational tips. (~8K tokens max)

## IMPORTANT: project notebook vs AXON.md
AXON.md contains the user's project instructions and documentation. Do NOT duplicate its content into project notebook.
Only write things you discovered during work that AXON.md does not cover:
- "After changing types.ts, also update attachments.ts"
- "session.sessionId is a getter not a method, don't use getId()"
- "compress() has a logic bug, CORE branch is unreachable"

## Guidelines
- Write in markdown, keep it concise
- Add dates for time-sensitive info: "Prefers React (2026-02)"
- Record patterns, not volatile facts (facts go stale, patterns don't)
- When new info contradicts your notes, update or replace the old note instead of keeping both
- Stay within token budgets — prune stale content when needed

## Reading
Pass empty string as content to read the current notebook.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        notebook: {
          type: 'string',
          enum: ['profile', 'experience', 'project'],
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
      return this.error('NotebookManager not initialized.');
    }

    const { notebook, content } = input;

    // 验证笔记本类型
    if (!['profile', 'experience', 'project'].includes(notebook)) {
      return this.error(`Invalid notebook type: ${notebook}. Options: profile, experience, project`);
    }

    // 读取模式
    if (!content || content.trim() === '') {
      const existing = manager.read(notebook);
      if (!existing.trim()) {
        return this.success(`[${notebook}] Notebook is empty.`);
      }
      return this.success(existing);
    }

    // 写入模式
    const result = manager.write(notebook, content);
    if (!result.success) {
      return this.error(result.error!);
    }

    return this.success(
      `\u2713 Updated ${notebook} notebook (${result.tokens} tokens)\nPath: ${result.path}`
    );
  }
}
