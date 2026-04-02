/**
 * ToolSearch 工具 — 延迟工具 Schema 发现机制
 *
 * 对齐官方 ToolSearchTool：
 * - deferred 工具启动时只注册名称，不加载完整 schema
 * - 模型通过 ToolSearch 按需获取完整 schema 定义
 * - 支持 select: 直接选择和关键词搜索两种查询模式
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';

export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch';

export interface ToolSearchInput {
  query: string;
  max_results?: number;
}

export interface ToolSearchResult extends ToolResult {
  matches: string[];
  query: string;
  total_deferred_tools: number;
}

export class ToolSearchTool extends BaseTool<ToolSearchInput, ToolSearchResult> {
  name = TOOL_SEARCH_TOOL_NAME;
  description = '';

  /** 所有 deferred 工具定义（由 ConversationLoop 初始化时注入） */
  static deferredTools: ToolDefinition[] = [];

  /** 所有工具定义（含非 deferred，用于 select: 容错） */
  static allTools: ToolDefinition[] = [];

  get dynamicDescription(): string {
    const hint = 'Deferred tools appear by name in <available-deferred-tools> messages.';
    return `Fetches full schema definitions for deferred tools so they can be called.

${hint} Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of this prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms`;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    };
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.dynamicDescription,
      inputSchema: this.getInputSchema(),
    };
  }

  async execute(input: ToolSearchInput): Promise<ToolSearchResult> {
    const { query, max_results = 5 } = input;
    const deferred = ToolSearchTool.deferredTools;
    const all = ToolSearchTool.allTools;

    const selectMatch = query.match(/^select:(.+)$/i);
    if (selectMatch) {
      return this.handleSelect(selectMatch[1], deferred, all, query);
    }

    return this.handleKeywordSearch(query, max_results, deferred, all);
  }

  private handleSelect(
    requested: string,
    deferred: ToolDefinition[],
    all: ToolDefinition[],
    query: string,
  ): ToolSearchResult {
    const names = requested.split(',').map(s => s.trim()).filter(Boolean);
    const found: ToolDefinition[] = [];
    const missing: string[] = [];

    for (const name of names) {
      const tool =
        deferred.find(t => t.name === name) ??
        all.find(t => t.name === name);
      if (tool && !found.some(f => f.name === tool.name)) {
        found.push(tool);
      } else if (!tool) {
        missing.push(name);
      }
    }

    if (found.length === 0) {
      return {
        success: true,
        output: 'No matching deferred tools found.',
        matches: [],
        query,
        total_deferred_tools: deferred.length,
      };
    }

    const functionsBlock = this.formatFunctionsBlock(found);
    return {
      success: true,
      output: functionsBlock,
      matches: found.map(t => t.name),
      query,
      total_deferred_tools: deferred.length,
    };
  }

  private handleKeywordSearch(
    query: string,
    maxResults: number,
    deferred: ToolDefinition[],
    all: ToolDefinition[],
  ): ToolSearchResult {
    const queryLower = query.toLowerCase().trim();

    // 精确匹配工具名
    const exactMatch =
      deferred.find(t => t.name.toLowerCase() === queryLower) ??
      all.find(t => t.name.toLowerCase() === queryLower);
    if (exactMatch) {
      const functionsBlock = this.formatFunctionsBlock([exactMatch]);
      return {
        success: true,
        output: functionsBlock,
        matches: [exactMatch.name],
        query,
        total_deferred_tools: deferred.length,
      };
    }

    // MCP 工具前缀匹配
    if (queryLower.startsWith('mcp__') && queryLower.length > 5) {
      const prefixMatches = deferred
        .filter(t => t.name.toLowerCase().startsWith(queryLower))
        .slice(0, maxResults);
      if (prefixMatches.length > 0) {
        const functionsBlock = this.formatFunctionsBlock(prefixMatches);
        return {
          success: true,
          output: functionsBlock,
          matches: prefixMatches.map(t => t.name),
          query,
          total_deferred_tools: deferred.length,
        };
      }
    }

    const queryTerms = queryLower.split(/\s+/).filter(term => term.length > 0);

    // 分离必须项（+前缀）和可选项
    const requiredTerms: string[] = [];
    const optionalTerms: string[] = [];
    for (const term of queryTerms) {
      if (term.startsWith('+') && term.length > 1) {
        requiredTerms.push(term.slice(1));
      } else {
        optionalTerms.push(term);
      }
    }
    const allScoringTerms = requiredTerms.length > 0
      ? [...requiredTerms, ...optionalTerms]
      : queryTerms;

    // 候选过滤（必须项全匹配）
    let candidates = deferred;
    if (requiredTerms.length > 0) {
      candidates = deferred.filter(tool => {
        const parts = this.parseToolName(tool.name);
        const desc = tool.description.toLowerCase();
        const hint = (tool.searchHint || '').toLowerCase();
        return requiredTerms.every(term =>
          parts.some(p => p.includes(term)) ||
          desc.includes(term) ||
          hint.includes(term)
        );
      });
    }

    // 评分
    const scored = candidates.map(tool => {
      const parts = this.parseToolName(tool.name);
      const isMcp = tool.name.startsWith('mcp__');
      const desc = tool.description.toLowerCase();
      const hint = (tool.searchHint || '').toLowerCase();

      let score = 0;
      for (const term of allScoringTerms) {
        if (parts.includes(term)) {
          score += isMcp ? 12 : 10;
        } else if (parts.some(p => p.includes(term))) {
          score += isMcp ? 6 : 5;
        }
        if (hint && hint.includes(term)) {
          score += 4;
        }
        if (desc.includes(term)) {
          score += 2;
        }
      }

      return { tool, score };
    });

    const matches = scored
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.tool);

    if (matches.length === 0) {
      return {
        success: true,
        output: 'No matching deferred tools found.',
        matches: [],
        query,
        total_deferred_tools: deferred.length,
      };
    }

    const functionsBlock = this.formatFunctionsBlock(matches);
    return {
      success: true,
      output: functionsBlock,
      matches: matches.map(t => t.name),
      query,
      total_deferred_tools: deferred.length,
    };
  }

  private parseToolName(name: string): string[] {
    if (name.startsWith('mcp__')) {
      return name.replace(/^mcp__/, '').toLowerCase().split('__').flatMap(p => p.split('_')).filter(Boolean);
    }
    return name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  private formatFunctionsBlock(tools: ToolDefinition[]): string {
    const lines = tools.map(tool => {
      const entry = {
        description: tool.description,
        name: tool.name,
        parameters: tool.inputSchema,
      };
      return `<function>${JSON.stringify(entry)}</function>`;
    });
    return `<functions>\n${lines.join('\n')}\n</functions>`;
  }
}
