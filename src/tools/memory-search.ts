/**
 * MemorySearch 工具
 * AI 可调用的长期记忆搜索工具
 */

import { z } from 'zod';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getMemorySearchManager } from '../memory/memory-search.js';
import { t } from '../i18n/index.js';

/**
 * 格式化时间差
 */
function formatAge(ms: number): string {
  const hours = ms / 3600000;
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  return `${Math.round(days / 30)}mo`;
}

/**
 * MemorySearch 工具输入
 */
export interface MemorySearchInput {
  query: string;
  source?: 'all' | 'memory' | 'session';
  maxResults?: number;
}

/**
 * MemorySearch 工具
 */
export class MemorySearchTool extends BaseTool<MemorySearchInput, ToolResult> {
  name = 'MemorySearch';
  
  description = `Search long-term memory for relevant past knowledge, session history, and project patterns.

Use this tool when:
- You need to recall past decisions, patterns, or lessons from previous sessions
- Looking for historical context about a file, function, or topic
- The current notebook doesn't contain the information you need

Returns search results with source attribution (file path, line numbers, timestamps) to help you judge relevance and freshness.

IMPORTANT: This searches a supplementary long-term memory layer. The primary source of knowledge is still the notebook (experience.md + project.md), which is always fully loaded. Only use this tool when notebook doesn't have what you need.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keywords (supports Chinese and English)',
        },
        source: {
          type: 'string',
          enum: ['all', 'memory', 'session'],
          description: 'Filter by source type (default: all)',
        },
        maxResults: {
          type: 'number',
          minimum: 1,
          maximum: 20,
          description: 'Maximum results (default: 8)',
        },
      },
      required: ['query'],
    };
  }

  async execute(input: MemorySearchInput): Promise<ToolResult> {
    const manager = getMemorySearchManager();
    if (!manager) {
      return this.error(t('memorySearch.notInitialized'));
    }

    const results = manager.search(input.query, {
      source: input.source,
      maxResults: input.maxResults,
    });

    if (results.length === 0) {
      return this.success(t('memorySearch.noResults'));
    }

    // 格式化结果，包含来源标注
    const formatted = results
      .map((r, i) => {
        const ageStr = formatAge(r.age);
        return (
          `[${i + 1}] (score: ${r.score.toFixed(3)}, ${ageStr} ago, ${r.source})\n` +
          `    File: ${r.path}:${r.startLine}-${r.endLine}\n` +
          `    ${r.snippet}`
        );
      })
      .join('\n\n');

    return this.success(`Found ${results.length} memories:\n\n${formatted}`);
  }
}
