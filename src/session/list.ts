/**
 * 增强的会话列表功能
 * 提供高级搜索、过滤、排序、批量操作和多格式导出
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SessionData, SessionMetadata } from './index.js';
import { loadSession, deleteSession, listSessions as baseListSessions } from './index.js';

// 会话存储目录
const SESSION_DIR = process.env.AXON_SESSION_DIR || path.join(os.homedir(), '.axon', 'sessions');

// ==================== 类型定义 ====================

export interface SessionFilter {
  model?: string | string[];
  dateFrom?: Date;
  dateTo?: Date;
  minMessages?: number;
  maxMessages?: number;
  minCost?: number;
  maxCost?: number;
  workingDirectory?: string;
  tags?: string[];
  hasParent?: boolean;
  hasBranches?: boolean;
}

export interface SessionListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'messageCount' | 'cost';
  sortOrder?: 'asc' | 'desc';
  filter?: SessionFilter;
}

export interface SessionSummary {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  model: string;
  cost?: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  tags?: string[];
  workingDirectory: string;
  hasParent: boolean;
  hasBranches: boolean;
  branchCount: number;
}

export interface SessionDetails extends SessionSummary {
  summary?: string;
  parentId?: string;
  forkPoint?: number;
  branches?: string[];
  forkName?: string;
  mergedFrom?: string[];
  firstMessagePreview?: string;
  lastMessagePreview?: string;
  toolUsageStats: {
    [toolName: string]: number;
  };
  messageRoleStats: {
    user: number;
    assistant: number;
  };
  averageMessageLength: number;
  duration: number; // 会话持续时间（毫秒）
}

export interface ListSessionsResult {
  sessions: SessionSummary[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface ExportOptions {
  format?: 'json' | 'md' | 'html';
  includeMessages?: boolean;
  includeMetadata?: boolean;
  prettyPrint?: boolean;
}

// ==================== 缓存机制 ====================

interface CacheEntry {
  data: SessionSummary[];
  timestamp: number;
}

const sessionCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60000; // 1分钟缓存

function getCacheKey(options: SessionListOptions): string {
  return JSON.stringify(options);
}

function getCachedSessions(options: SessionListOptions): SessionSummary[] | null {
  const key = getCacheKey(options);
  const entry = sessionCache.get(key);

  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }

  sessionCache.delete(key);
  return null;
}

function setCachedSessions(options: SessionListOptions, data: SessionSummary[]): void {
  const key = getCacheKey(options);
  sessionCache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

export function clearSessionCache(): void {
  sessionCache.clear();
}

// ==================== 核心功能 ====================

/**
 * 扫描所有会话文件并构建摘要
 */
function scanAllSessions(): SessionSummary[] {
  if (!fs.existsSync(SESSION_DIR)) {
    return [];
  }

  const files = fs.readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json'));
  const sessions: SessionSummary[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(SESSION_DIR, file), 'utf-8');
      const session = JSON.parse(content) as SessionData;

      const summary: SessionSummary = {
        id: session.metadata.id,
        name: session.metadata.name,
        createdAt: session.metadata.createdAt,
        updatedAt: session.metadata.updatedAt,
        messageCount: session.metadata.messageCount,
        model: session.metadata.model,
        cost: session.metadata.cost,
        tokenUsage: session.metadata.tokenUsage,
        tags: session.metadata.tags,
        workingDirectory: session.metadata.workingDirectory,
        hasParent: !!session.metadata.parentId,
        hasBranches: !!(session.metadata.branches && session.metadata.branches.length > 0),
        branchCount: session.metadata.branches?.length || 0,
      };

      sessions.push(summary);
    } catch {
      // 忽略无法解析的文件
    }
  }

  return sessions;
}

/**
 * 应用过滤条件
 */
function applyFilters(sessions: SessionSummary[], filter?: SessionFilter): SessionSummary[] {
  if (!filter) {
    return sessions;
  }

  return sessions.filter((session) => {
    // 模型过滤
    if (filter.model) {
      const models = Array.isArray(filter.model) ? filter.model : [filter.model];
      if (!models.some(m => session.model.includes(m))) {
        return false;
      }
    }

    // 日期范围过滤
    if (filter.dateFrom && session.createdAt < filter.dateFrom.getTime()) {
      return false;
    }
    if (filter.dateTo && session.createdAt > filter.dateTo.getTime()) {
      return false;
    }

    // 消息数量过滤
    if (filter.minMessages !== undefined && session.messageCount < filter.minMessages) {
      return false;
    }
    if (filter.maxMessages !== undefined && session.messageCount > filter.maxMessages) {
      return false;
    }

    // 成本过滤
    if (filter.minCost !== undefined && (session.cost ?? 0) < filter.minCost) {
      return false;
    }
    if (filter.maxCost !== undefined && (session.cost ?? 0) > filter.maxCost) {
      return false;
    }

    // 工作目录过滤
    if (filter.workingDirectory && !session.workingDirectory.includes(filter.workingDirectory)) {
      return false;
    }

    // 标签过滤
    if (filter.tags && filter.tags.length > 0) {
      if (!session.tags || !filter.tags.every(tag => session.tags?.includes(tag))) {
        return false;
      }
    }

    // 父会话过滤
    if (filter.hasParent !== undefined && session.hasParent !== filter.hasParent) {
      return false;
    }

    // 分支过滤
    if (filter.hasBranches !== undefined && session.hasBranches !== filter.hasBranches) {
      return false;
    }

    return true;
  });
}

/**
 * 应用搜索
 */
function applySearch(sessions: SessionSummary[], search?: string): SessionSummary[] {
  if (!search) {
    return sessions;
  }

  const searchLower = search.toLowerCase();
  return sessions.filter((session) => {
    return (
      session.id.toLowerCase().includes(searchLower) ||
      session.name?.toLowerCase().includes(searchLower) ||
      session.workingDirectory.toLowerCase().includes(searchLower) ||
      session.model.toLowerCase().includes(searchLower) ||
      session.tags?.some(tag => tag.toLowerCase().includes(searchLower))
    );
  });
}

/**
 * 应用排序
 */
function applySorting(
  sessions: SessionSummary[],
  sortBy: SessionListOptions['sortBy'] = 'updatedAt',
  sortOrder: SessionListOptions['sortOrder'] = 'desc'
): SessionSummary[] {
  const sorted = [...sessions].sort((a, b) => {
    let aVal: number;
    let bVal: number;

    switch (sortBy) {
      case 'createdAt':
        aVal = a.createdAt;
        bVal = b.createdAt;
        break;
      case 'updatedAt':
        aVal = a.updatedAt;
        bVal = b.updatedAt;
        break;
      case 'messageCount':
        aVal = a.messageCount;
        bVal = b.messageCount;
        break;
      case 'cost':
        aVal = a.cost ?? 0;
        bVal = b.cost ?? 0;
        break;
      default:
        aVal = a.updatedAt;
        bVal = b.updatedAt;
    }

    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
  });

  return sorted;
}

/**
 * 增强的会话列表功能
 */
export function listSessionsEnhanced(options: SessionListOptions = {}): ListSessionsResult {
  const {
    limit = 20,
    offset = 0,
    search,
    sortBy = 'updatedAt',
    sortOrder = 'desc',
    filter,
  } = options;

  // 检查缓存
  const cached = getCachedSessions(options);
  if (cached) {
    const total = cached.length;
    const paginatedSessions = cached.slice(offset, offset + limit);
    return {
      sessions: paginatedSessions,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  }

  // 扫描所有会话
  let sessions = scanAllSessions();

  // 应用过滤
  sessions = applyFilters(sessions, filter);

  // 应用搜索
  sessions = applySearch(sessions, search);

  // 应用排序
  sessions = applySorting(sessions, sortBy, sortOrder);

  // 缓存结果
  setCachedSessions(options, sessions);

  // 分页
  const total = sessions.length;
  const paginatedSessions = sessions.slice(offset, offset + limit);

  return {
    sessions: paginatedSessions,
    total,
    offset,
    limit,
    hasMore: offset + limit < total,
  };
}

/**
 * 获取会话详细信息
 */
export function getSessionDetails(id: string): SessionDetails | null {
  const session = loadSession(id);
  if (!session) {
    return null;
  }

  // 计算工具使用统计
  const toolUsageStats: { [toolName: string]: number } = {};
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let totalMessageLength = 0;

  for (const message of session.messages) {
    if (message.role === 'user') {
      userMessageCount++;
    } else if (message.role === 'assistant') {
      assistantMessageCount++;
    }

    // 计算消息长度
    if (typeof message.content === 'string') {
      totalMessageLength += message.content.length;
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          totalMessageLength += block.text.length;
        } else if (block.type === 'tool_use') {
          const toolName = block.name || 'unknown';
          toolUsageStats[toolName] = (toolUsageStats[toolName] || 0) + 1;
        }
      }
    }
  }

  // 获取第一条和最后一条消息预览
  const firstMessage = session.messages[0];
  const lastMessage = session.messages[session.messages.length - 1];

  const getMessagePreview = (message: typeof firstMessage): string => {
    let text = '';
    if (typeof message?.content === 'string') {
      text = message.content;
    } else if (Array.isArray(message?.content)) {
      const textBlock = message.content.find(b => b.type === 'text');
      text = textBlock && 'text' in textBlock ? ((textBlock as any).text || '') : '';
    }
    // v2.1.33: 剥离 XML 标记以显示干净的预览
    text = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 100);
  };

  const details: SessionDetails = {
    id: session.metadata.id,
    name: session.metadata.name,
    createdAt: session.metadata.createdAt,
    updatedAt: session.metadata.updatedAt,
    messageCount: session.metadata.messageCount,
    model: session.metadata.model,
    cost: session.metadata.cost,
    tokenUsage: session.metadata.tokenUsage,
    tags: session.metadata.tags,
    workingDirectory: session.metadata.workingDirectory,
    hasParent: !!session.metadata.parentId,
    hasBranches: !!(session.metadata.branches && session.metadata.branches.length > 0),
    branchCount: session.metadata.branches?.length || 0,
    summary: session.metadata.summary,
    parentId: session.metadata.parentId,
    forkPoint: session.metadata.forkPoint,
    branches: session.metadata.branches,
    forkName: session.metadata.forkName,
    mergedFrom: session.metadata.mergedFrom,
    firstMessagePreview: getMessagePreview(firstMessage),
    lastMessagePreview: getMessagePreview(lastMessage),
    toolUsageStats,
    messageRoleStats: {
      user: userMessageCount,
      assistant: assistantMessageCount,
    },
    averageMessageLength: session.messages.length > 0 ? totalMessageLength / session.messages.length : 0,
    duration: session.metadata.updatedAt - session.metadata.createdAt,
  };

  return details;
}

/**
 * 搜索会话
 */
export function searchSessions(query: string, options: Omit<SessionListOptions, 'search'> = {}): SessionSummary[] {
  const result = listSessionsEnhanced({
    ...options,
    search: query,
    limit: 1000, // 搜索时不限制结果
  });
  return result.sessions;
}

/**
 * 批量删除会话（增强版，支持 dryRun）
 */
export function bulkDeleteSessionsEnhanced(
  ids: string[],
  options: { dryRun?: boolean } = {}
): { deleted: string[]; failed: string[] } {
  const result = {
    deleted: [] as string[],
    failed: [] as string[],
  };

  for (const id of ids) {
    if (options.dryRun) {
      // 仅检查会话是否存在
      const session = loadSession(id);
      if (session) {
        result.deleted.push(id);
      } else {
        result.failed.push(id);
      }
    } else {
      if (deleteSession(id)) {
        result.deleted.push(id);
        clearSessionCache();
      } else {
        result.failed.push(id);
      }
    }
  }

  return result;
}

/**
 * 批量导出会话
 */
export function bulkExportSessions(
  ids: string[],
  format: 'json' | 'md' | 'html' = 'json'
): Map<string, string> {
  const exports = new Map<string, string>();

  for (const id of ids) {
    try {
      const exported = exportSession(id, format);
      if (exported) {
        exports.set(id, exported);
      }
    } catch (err) {
      console.error(`Failed to export session ${id}:`, err);
    }
  }

  return exports;
}

/**
 * 导出单个会话
 */
export function exportSession(
  id: string,
  format: 'json' | 'md' | 'html' = 'json',
  options: ExportOptions = {}
): string | null {
  const session = loadSession(id);
  if (!session) {
    return null;
  }

  const {
    includeMessages = true,
    includeMetadata = true,
    prettyPrint = true,
  } = options;

  switch (format) {
    case 'json':
      return exportToJSON(session, { includeMessages, includeMetadata, prettyPrint });
    case 'md':
      return exportToMarkdown(session, { includeMessages, includeMetadata });
    case 'html':
      return exportToHTML(session, { includeMessages, includeMetadata });
    default:
      return null;
  }
}

/**
 * 导出为 JSON
 */
function exportToJSON(
  session: SessionData,
  options: { includeMessages?: boolean; includeMetadata?: boolean; prettyPrint?: boolean }
): string {
  const data: any = {};

  if (options.includeMetadata) {
    data.metadata = session.metadata;
  }

  if (options.includeMessages) {
    data.messages = session.messages;
  }

  if (session.systemPrompt) {
    data.systemPrompt = session.systemPrompt;
  }

  return options.prettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

/**
 * 导出为 Markdown
 */
function exportToMarkdown(
  session: SessionData,
  options: { includeMessages?: boolean; includeMetadata?: boolean }
): string {
  const lines: string[] = [];

  // 标题
  lines.push(`# ${session.metadata.name || session.metadata.id}`);
  lines.push('');

  // 元数据
  if (options.includeMetadata) {
    lines.push('## Metadata');
    lines.push('');
    lines.push(`- **ID:** ${session.metadata.id}`);
    lines.push(`- **Created:** ${new Date(session.metadata.createdAt).toISOString()}`);
    lines.push(`- **Updated:** ${new Date(session.metadata.updatedAt).toISOString()}`);
    lines.push(`- **Model:** ${session.metadata.model}`);
    lines.push(`- **Messages:** ${session.metadata.messageCount}`);
    lines.push(`- **Working Directory:** ${session.metadata.workingDirectory}`);

    if (session.metadata.cost) {
      lines.push(`- **Cost:** $${session.metadata.cost.toFixed(4)}`);
    }

    lines.push(`- **Tokens:** ${session.metadata.tokenUsage.total} (${session.metadata.tokenUsage.input} in / ${session.metadata.tokenUsage.output} out)`);

    if (session.metadata.tags && session.metadata.tags.length > 0) {
      lines.push(`- **Tags:** ${session.metadata.tags.join(', ')}`);
    }

    if (session.metadata.parentId) {
      lines.push(`- **Parent Session:** ${session.metadata.parentId}`);
      lines.push(`- **Fork Point:** Message #${session.metadata.forkPoint}`);
    }

    if (session.metadata.branches && session.metadata.branches.length > 0) {
      lines.push(`- **Branches:** ${session.metadata.branches.length}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 消息
  if (options.includeMessages) {
    lines.push('## Conversation');
    lines.push('');

    for (let i = 0; i < session.messages.length; i++) {
      const message = session.messages[i];
      const role = message.role === 'user' ? 'User' : 'Assistant';

      lines.push(`### Message ${i + 1}: ${role}`);
      lines.push('');

      if (typeof message.content === 'string') {
        lines.push(message.content);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            lines.push(block.text);
          } else if (block.type === 'tool_use') {
            lines.push(`**Tool:** ${block.name}`);
            lines.push('```json');
            lines.push(JSON.stringify(block.input, null, 2));
            lines.push('```');
          } else if (block.type === 'tool_result') {
            lines.push('**Tool Result:**');
            lines.push('```');
            const content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content, null, 2);
            lines.push(content);
            lines.push('```');
          }
        }
      }

      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * 导出为 HTML
 */
function exportToHTML(
  session: SessionData,
  options: { includeMessages?: boolean; includeMetadata?: boolean }
): string {
  const lines: string[] = [];

  // HTML 头部
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push(`  <title>${session.metadata.name || session.metadata.id}</title>`);
  lines.push('  <style>');
  lines.push('    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 20px; line-height: 1.6; color: #333; }');
  lines.push('    h1 { border-bottom: 2px solid #007acc; padding-bottom: 10px; }');
  lines.push('    h2 { color: #007acc; margin-top: 30px; }');
  lines.push('    h3 { color: #555; }');
  lines.push('    .metadata { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }');
  lines.push('    .metadata ul { list-style: none; padding: 0; }');
  lines.push('    .metadata li { padding: 5px 0; }');
  lines.push('    .metadata strong { color: #007acc; }');
  lines.push('    .message { margin: 20px 0; padding: 15px; border-radius: 5px; }');
  lines.push('    .user-message { background: #e3f2fd; border-left: 4px solid #2196f3; }');
  lines.push('    .assistant-message { background: #f3e5f5; border-left: 4px solid #9c27b0; }');
  lines.push('    .tool-use { background: #fff3e0; padding: 10px; border-radius: 3px; margin: 10px 0; }');
  lines.push('    .tool-result { background: #e8f5e9; padding: 10px; border-radius: 3px; margin: 10px 0; }');
  lines.push('    pre { background: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto; }');
  lines.push('    code { font-family: "Courier New", monospace; }');
  lines.push('    .tag { display: inline-block; background: #007acc; color: white; padding: 2px 8px; border-radius: 3px; margin: 2px; font-size: 0.85em; }');
  lines.push('  </style>');
  lines.push('</head>');
  lines.push('<body>');

  // 标题
  lines.push(`  <h1>${escapeHtml(session.metadata.name || session.metadata.id)}</h1>`);

  // 元数据
  if (options.includeMetadata) {
    lines.push('  <div class="metadata">');
    lines.push('    <h2>Session Information</h2>');
    lines.push('    <ul>');
    lines.push(`      <li><strong>ID:</strong> ${escapeHtml(session.metadata.id)}</li>`);
    lines.push(`      <li><strong>Created:</strong> ${new Date(session.metadata.createdAt).toLocaleString()}</li>`);
    lines.push(`      <li><strong>Updated:</strong> ${new Date(session.metadata.updatedAt).toLocaleString()}</li>`);
    lines.push(`      <li><strong>Model:</strong> ${escapeHtml(session.metadata.model)}</li>`);
    lines.push(`      <li><strong>Messages:</strong> ${session.metadata.messageCount}</li>`);
    lines.push(`      <li><strong>Working Directory:</strong> <code>${escapeHtml(session.metadata.workingDirectory)}</code></li>`);

    if (session.metadata.cost) {
      lines.push(`      <li><strong>Cost:</strong> $${session.metadata.cost.toFixed(4)}</li>`);
    }

    lines.push(`      <li><strong>Tokens:</strong> ${session.metadata.tokenUsage.total} (${session.metadata.tokenUsage.input} in / ${session.metadata.tokenUsage.output} out)</li>`);

    if (session.metadata.tags && session.metadata.tags.length > 0) {
      lines.push('      <li><strong>Tags:</strong>');
      for (const tag of session.metadata.tags) {
        lines.push(`        <span class="tag">${escapeHtml(tag)}</span>`);
      }
      lines.push('      </li>');
    }

    lines.push('    </ul>');
    lines.push('  </div>');
  }

  // 消息
  if (options.includeMessages) {
    lines.push('  <h2>Conversation</h2>');

    for (let i = 0; i < session.messages.length; i++) {
      const message = session.messages[i];
      const messageClass = message.role === 'user' ? 'user-message' : 'assistant-message';
      const role = message.role === 'user' ? 'User' : 'Assistant';

      lines.push(`  <div class="message ${messageClass}">`);
      lines.push(`    <h3>Message ${i + 1}: ${role}</h3>`);

      if (typeof message.content === 'string') {
        lines.push(`    <p>${escapeHtml(message.content).replace(/\n/g, '<br>')}</p>`);
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            lines.push(`    <p>${escapeHtml(block.text).replace(/\n/g, '<br>')}</p>`);
          } else if (block.type === 'tool_use') {
            lines.push('    <div class="tool-use">');
            lines.push(`      <strong>Tool:</strong> ${escapeHtml(block.name || 'unknown')}`);
            lines.push('      <pre><code>' + escapeHtml(JSON.stringify(block.input, null, 2)) + '</code></pre>');
            lines.push('    </div>');
          } else if (block.type === 'tool_result') {
            lines.push('    <div class="tool-result">');
            lines.push('      <strong>Tool Result:</strong>');
            const content = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content, null, 2);
            lines.push('      <pre><code>' + escapeHtml(content) + '</code></pre>');
            lines.push('    </div>');
          }
        }
      }

      lines.push('  </div>');
    }
  }

  // HTML 尾部
  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * 导出多个会话为单个文件
 */
export function exportMultipleSessions(
  ids: string[],
  format: 'json' | 'md' | 'html' = 'json'
): string | null {
  if (ids.length === 0) {
    return null;
  }

  if (format === 'json') {
    const sessions = ids.map(id => loadSession(id)).filter(Boolean);
    return JSON.stringify(sessions, null, 2);
  }

  const exports = ids
    .map(id => exportSession(id, format, { includeMessages: true, includeMetadata: true }))
    .filter(Boolean);

  if (format === 'html') {
    // 合并 HTML 文档
    const header = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Multiple Sessions Export</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 1200px; margin: 40px auto; padding: 20px; }
    .session-container { margin-bottom: 60px; border: 2px solid #ddd; padding: 20px; border-radius: 8px; }
  </style>
</head>
<body>
  <h1>Exported Sessions (${ids.length})</h1>
`;

    const footer = `</body></html>`;

    const bodies = exports.map(html => {
      if (!html) return '';
      // 提取 body 内容
      const match = html.match(/<body>([\s\S]*)<\/body>/);
      return match ? `<div class="session-container">${match[1]}</div>` : '';
    });

    return header + bodies.join('\n') + footer;
  }

  // Markdown - 简单连接
  return exports.join('\n\n---\n\n');
}

/**
 * 获取会话统计
 */
export function getListStatistics(sessions?: SessionSummary[]): {
  totalSessions: number;
  totalMessages: number;
  totalCost: number;
  totalTokens: number;
  averageCost: number;
  averageMessages: number;
  averageTokens: number;
  modelDistribution: { [model: string]: number };
  tagDistribution: { [tag: string]: number };
  oldestSession?: SessionSummary;
  newestSession?: SessionSummary;
  mostActiveSession?: SessionSummary;
} {
  if (!sessions) {
    sessions = scanAllSessions();
  }

  const stats = {
    totalSessions: sessions.length,
    totalMessages: 0,
    totalCost: 0,
    totalTokens: 0,
    averageCost: 0,
    averageMessages: 0,
    averageTokens: 0,
    modelDistribution: {} as { [model: string]: number },
    tagDistribution: {} as { [tag: string]: number },
    oldestSession: undefined as SessionSummary | undefined,
    newestSession: undefined as SessionSummary | undefined,
    mostActiveSession: undefined as SessionSummary | undefined,
  };

  if (sessions.length === 0) {
    return stats;
  }

  let oldestTime = Infinity;
  let newestTime = 0;
  let mostMessages = 0;

  for (const session of sessions) {
    stats.totalMessages += session.messageCount;
    stats.totalCost += session.cost ?? 0;
    stats.totalTokens += session.tokenUsage.total;

    // 模型分布
    stats.modelDistribution[session.model] = (stats.modelDistribution[session.model] || 0) + 1;

    // 标签分布
    if (session.tags) {
      for (const tag of session.tags) {
        stats.tagDistribution[tag] = (stats.tagDistribution[tag] || 0) + 1;
      }
    }

    // 最旧会话
    if (session.createdAt < oldestTime) {
      oldestTime = session.createdAt;
      stats.oldestSession = session;
    }

    // 最新会话
    if (session.updatedAt > newestTime) {
      newestTime = session.updatedAt;
      stats.newestSession = session;
    }

    // 最活跃会话
    if (session.messageCount > mostMessages) {
      mostMessages = session.messageCount;
      stats.mostActiveSession = session;
    }
  }

  stats.averageCost = stats.totalCost / sessions.length;
  stats.averageMessages = stats.totalMessages / sessions.length;
  stats.averageTokens = stats.totalTokens / sessions.length;

  return stats;
}

/**
 * 生成会话报告
 */
export function generateSessionReport(options: {
  filter?: SessionFilter;
  format?: 'text' | 'json';
} = {}): string {
  const { filter, format = 'text' } = options;

  const allSessions = scanAllSessions();
  const filteredSessions = filter ? applyFilters(allSessions, filter) : allSessions;
  const stats = getListStatistics(filteredSessions);

  if (format === 'json') {
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      filter,
      statistics: stats,
      sessions: filteredSessions,
    }, null, 2);
  }

  // 文本格式报告
  const lines: string[] = [];
  lines.push('='.repeat(60));
  lines.push('SESSION REPORT');
  lines.push('='.repeat(60));
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  if (filter) {
    lines.push('Filter Applied:');
    lines.push(JSON.stringify(filter, null, 2));
    lines.push('');
  }

  lines.push('Statistics:');
  lines.push(`  Total Sessions: ${stats.totalSessions}`);
  lines.push(`  Total Messages: ${stats.totalMessages}`);
  lines.push(`  Total Tokens: ${stats.totalTokens.toLocaleString()}`);
  lines.push(`  Total Cost: $${stats.totalCost.toFixed(4)}`);
  lines.push('');
  lines.push(`  Average Messages per Session: ${stats.averageMessages.toFixed(2)}`);
  lines.push(`  Average Tokens per Session: ${stats.averageTokens.toFixed(2)}`);
  lines.push(`  Average Cost per Session: $${stats.averageCost.toFixed(4)}`);
  lines.push('');

  lines.push('Model Distribution:');
  for (const [model, count] of Object.entries(stats.modelDistribution)) {
    const percentage = ((count / stats.totalSessions) * 100).toFixed(1);
    lines.push(`  ${model}: ${count} (${percentage}%)`);
  }
  lines.push('');

  if (Object.keys(stats.tagDistribution).length > 0) {
    lines.push('Tag Distribution:');
    const sortedTags = Object.entries(stats.tagDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [tag, count] of sortedTags) {
      lines.push(`  ${tag}: ${count}`);
    }
    lines.push('');
  }

  if (stats.oldestSession) {
    lines.push('Oldest Session:');
    lines.push(`  ID: ${stats.oldestSession.id}`);
    lines.push(`  Created: ${new Date(stats.oldestSession.createdAt).toISOString()}`);
    lines.push('');
  }

  if (stats.newestSession) {
    lines.push('Newest Session:');
    lines.push(`  ID: ${stats.newestSession.id}`);
    lines.push(`  Updated: ${new Date(stats.newestSession.updatedAt).toISOString()}`);
    lines.push('');
  }

  if (stats.mostActiveSession) {
    lines.push('Most Active Session:');
    lines.push(`  ID: ${stats.mostActiveSession.id}`);
    lines.push(`  Messages: ${stats.mostActiveSession.messageCount}`);
    lines.push('');
  }

  lines.push('='.repeat(60));

  return lines.join('\n');
}

/**
 * 归档会话（移动到归档目录）
 */
export function archiveSession(id: string): boolean {
  const session = loadSession(id);
  if (!session) {
    return false;
  }

  const archiveDir = path.join(SESSION_DIR, 'archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  const sourcePath = path.join(SESSION_DIR, `${id}.json`);
  const targetPath = path.join(archiveDir, `${id}.json`);

  try {
    fs.renameSync(sourcePath, targetPath);
    clearSessionCache();
    return true;
  } catch (err) {
    console.error(`Failed to archive session ${id}:`, err);
    return false;
  }
}

/**
 * 批量归档会话
 */
export function bulkArchiveSessions(ids: string[]): { archived: string[]; failed: string[] } {
  const result = {
    archived: [] as string[],
    failed: [] as string[],
  };

  for (const id of ids) {
    if (archiveSession(id)) {
      result.archived.push(id);
    } else {
      result.failed.push(id);
    }
  }

  return result;
}
