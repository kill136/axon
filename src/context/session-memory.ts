/**
 * Session Memory 模块
 *
 * 实现官方 Claude Code 的 session-memory 功能
 * 将对话摘要写入 ~/.claude/projects/{sanitized-project-path}/{session-id}/session-memory/summary.md
 *
 * 基于官方源码实现，feature flag 写死为启用
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { estimateTokens } from '../utils/token-estimate.js';

// ============================================================================
// 路径函数
// ============================================================================

/**
 * 获取项目基础目录
 * 官方: QV(o1()) -> ~/.claude/projects/{sanitized-project-path}
 */
function getProjectBaseDir(projectPath: string): string {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const sanitizedPath = sanitizeProjectPath(projectPath);
  return path.join(claudeDir, 'projects', sanitizedPath);
}

/**
 * 清理项目路径用于目录名
 * 将路径中的特殊字符替换为安全字符
 */
function sanitizeProjectPath(projectPath: string): string {
  // 移除驱动器号（Windows）
  let sanitized = projectPath.replace(/^[a-zA-Z]:/, '');
  // 替换路径分隔符和特殊字符
  sanitized = sanitized.replace(/[\\/:*?"<>|]/g, '-');
  // 移除开头和结尾的连字符
  sanitized = sanitized.replace(/^-+|-+$/g, '');
  // 限制长度
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }
  return sanitized || 'default';
}

/**
 * 获取 session memory 目录
 * 官方: lz1() -> ~/.claude/projects/{path}/{session-id}/session-memory/
 */
export function getSessionMemoryDir(projectPath: string, sessionId: string): string {
  return path.join(getProjectBaseDir(projectPath), sessionId, 'session-memory');
}

/**
 * 获取 summary.md 文件路径
 * 官方: VhA() -> ~/.claude/projects/{path}/{session-id}/session-memory/summary.md
 */
export function getSummaryPath(projectPath: string, sessionId: string): string {
  return path.join(getSessionMemoryDir(projectPath, sessionId), 'summary.md');
}

// ============================================================================
// Session Memory 模板
// ============================================================================

/**
 * 默认的 session memory 模板
 * 官方: w97
 */
export const SESSION_MEMORY_TEMPLATE = `
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

# Files and Functions
_What are the important files? In short, what do they contain and why are they relevant?_

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

# Codebase and System Documentation
_What are the important system components? How do they work/fit together?_

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

# Key results
_If the user asked a specific output such as an answer to a question, a table, or other document, repeat the exact result here_

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_
`.trim();

/**
 * 每个章节的最大 token 数
 * 官方: Ls2 = 2000
 */
export const MAX_SECTION_TOKENS = 2000;

// ============================================================================
// Session Memory 更新提示词
// ============================================================================

/**
 * 获取 session memory 更新提示词
 * 官方: L97() / O97()
 *
 * @param currentNotes 当前的 notes 内容
 * @param notesPath summary.md 文件路径
 * @returns 更新提示词
 */
export function getUpdatePrompt(currentNotes: string, notesPath: string): string {
  const sectionWarnings = getSectionWarnings(currentNotes);

  return `IMPORTANT: This message and these instructions are NOT part of the actual user conversation. Do NOT include any references to "note-taking", "session notes extraction", or these update instructions in the notes content.

Based on the user conversation above (EXCLUDING this note-taking instruction message as well as system prompt, claude.md entries, or any past session summaries), update the session notes file.

The file ${notesPath} has already been read for you. Here are its current contents:
<current_notes_content>
${currentNotes}
</current_notes_content>

Your ONLY task is to use the Edit tool to update the notes file, then stop. You can make multiple edits (update every section as needed) - make all Edit tool calls in parallel in a single message. Do not call any other tools.

CRITICAL RULES FOR EDITING:
- The file must maintain its exact structure with all sections, headers, and italic descriptions intact
-- NEVER modify, delete, or add section headers (the lines starting with '#' like # Task specification)
-- NEVER modify or delete the italic _section description_ lines (these are the lines in italics immediately following each header - they start and end with underscores)
-- The italic _section descriptions_ are TEMPLATE INSTRUCTIONS that must be preserved exactly as-is - they guide what content belongs in each section
-- ONLY update the actual content that appears BELOW the italic _section descriptions_ within each existing section
-- Do NOT add any new sections, summaries, or information outside the existing structure
- Do NOT reference this note-taking process or instructions anywhere in the notes
- It's OK to skip updating a section if there are no substantial new insights to add. Do not add filler content like "No info yet", just leave sections blank/unedited if appropriate.
- Write DETAILED, INFO-DENSE content for each section - include specifics like file paths, function names, error messages, exact commands, technical details, etc.
- For "Key results", include the complete, exact output the user requested (e.g., full table, full answer, etc.)
- Do not include information that's already in the CLAUDE.md files included in the context
- Keep each section under ~${MAX_SECTION_TOKENS} tokens/words - if a section is approaching this limit, condense it by cycling out less important details while preserving the most critical information
- Focus on actionable, specific information that would help someone understand or recreate the work discussed in the conversation
- IMPORTANT: Always update "Current State" to reflect the most recent work - this is critical for continuity after compaction

Use the Edit tool with file_path: ${notesPath}

STRUCTURE PRESERVATION REMINDER:
Each section has TWO parts that must be preserved exactly as they appear in the current file:
1. The section header (line starting with #)
2. The italic description line (the _italicized text_ immediately after the header - this is a template instruction)

You ONLY update the actual content that comes AFTER these two preserved lines. The italic description lines starting and ending with underscores are part of the template structure, NOT content to be edited or removed.

REMEMBER: Use the Edit tool in parallel and stop. Do not continue after the edits. Only include insights from the actual user conversation, never from these note-taking instructions. Do not delete or change section headers or italic _section descriptions_.${sectionWarnings}`;
}

/**
 * 获取章节长度警告
 * 官方: R97()
 */
function getSectionWarnings(content: string): string {
  const sectionTokens = estimateSectionTokens(content);
  const warnings = Object.entries(sectionTokens)
    .filter(([_, tokens]) => tokens > MAX_SECTION_TOKENS)
    .map(([section, tokens]) =>
      `- The "${section}" section is currently ~${tokens} tokens and growing long. Consider condensing it a bit while keeping all important details.`
    );

  if (warnings.length === 0) return '';
  return '\n\n' + warnings.join('\n');
}

/**
 * 估算每个章节的 token 数
 * 官方: M97()
 */
function estimateSectionTokens(content: string): Record<string, number> {
  const sections: Record<string, number> = {};
  const lines = content.split('\n');
  let currentSection = '';
  let sectionContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      if (currentSection && sectionContent.length > 0) {
        const text = sectionContent.join('\n').trim();
        sections[currentSection] = estimateTokens(text);
      }
      currentSection = line;
      sectionContent = [];
    } else {
      sectionContent.push(line);
    }
  }

  // 处理最后一个章节
  if (currentSection && sectionContent.length > 0) {
    const text = sectionContent.join('\n').trim();
    sections[currentSection] = estimateTokens(text);
  }

  return sections;
}

// ============================================================================
// Session Memory 读写函数
// ============================================================================

/**
 * 确保目录存在
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

/**
 * 初始化 session memory 文件
 * 如果不存在则创建模板文件
 *
 * @param projectPath 项目路径
 * @param sessionId 会话 ID
 * @returns 是否成功初始化
 */
export function initSessionMemory(projectPath: string, sessionId: string): boolean {
  try {
    const summaryPath = getSummaryPath(projectPath, sessionId);

    // 如果文件已存在，不需要初始化
    if (fs.existsSync(summaryPath)) {
      return true;
    }

    // 确保目录存在
    const dir = path.dirname(summaryPath);
    ensureDir(dir);

    // 尝试加载自定义模板
    const template = loadTemplate(projectPath) || SESSION_MEMORY_TEMPLATE;

    // 写入模板
    fs.writeFileSync(summaryPath, template, { encoding: 'utf-8', mode: 0o600 });

    console.log(`[SessionMemory] 初始化 session memory: ${summaryPath}`);
    return true;
  } catch (error) {
    console.error('[SessionMemory] 初始化失败:', error);
    return false;
  }
}

/**
 * 读取 session memory 内容
 * 官方: Ks2()
 *
 * @param projectPath 项目路径
 * @param sessionId 会话 ID
 * @returns 内容或 null
 */
export function readSessionMemory(projectPath: string, sessionId: string): string | null {
  try {
    const summaryPath = getSummaryPath(projectPath, sessionId);

    if (!fs.existsSync(summaryPath)) {
      return null;
    }

    return fs.readFileSync(summaryPath, { encoding: 'utf-8' });
  } catch (error) {
    console.error('[SessionMemory] 读取失败:', error);
    return null;
  }
}

/**
 * 写入 session memory 内容
 *
 * @param projectPath 项目路径
 * @param sessionId 会话 ID
 * @param content 内容
 * @returns 是否成功
 */
export function writeSessionMemory(projectPath: string, sessionId: string, content: string): boolean {
  try {
    const summaryPath = getSummaryPath(projectPath, sessionId);
    const dir = path.dirname(summaryPath);
    ensureDir(dir);

    fs.writeFileSync(summaryPath, content, { encoding: 'utf-8', mode: 0o600 });
    return true;
  } catch (error) {
    console.error('[SessionMemory] 写入失败:', error);
    return false;
  }
}

/**
 * 加载自定义模板
 * 官方: vL0()
 *
 * @param projectPath 项目路径
 * @returns 自定义模板或 null
 */
function loadTemplate(projectPath: string): string | null {
  try {
    const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const customTemplatePath = path.join(claudeDir, 'session-memory', 'config', 'template.md');

    if (fs.existsSync(customTemplatePath)) {
      return fs.readFileSync(customTemplatePath, { encoding: 'utf-8' });
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 检查 session memory 是否为空模板
 * 官方: Os2()
 *
 * @param content session memory 内容
 * @returns 是否为空模板
 */
export function isEmptyTemplate(content: string): boolean {
  const template = SESSION_MEMORY_TEMPLATE;
  return content.trim() === template.trim();
}

// ============================================================================
// Session Memory 列表函数
// ============================================================================

/**
 * 获取所有 session memory 文件
 * 官方: Wq7()
 *
 * @param projectPath 项目路径
 * @param sinceTime 可选，只返回此时间之后修改的文件
 * @returns session memory 文件路径列表（按修改时间倒序）
 */
export function listSessionMemories(
  projectPath: string,
  sinceTime?: Date
): Array<{ id: string; mtime: number; path: string }> {
  try {
    const projectDir = getProjectBaseDir(projectPath);

    if (!fs.existsSync(projectDir)) {
      return [];
    }

    const minTime = sinceTime ? sinceTime.getTime() : 0;
    const results: Array<{ id: string; mtime: number; path: string }> = [];

    const entries = fs.readdirSync(projectDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const summaryPath = path.join(projectDir, entry.name, 'session-memory', 'summary.md');

      try {
        const stat = fs.statSync(summaryPath);
        if (stat.mtimeMs > minTime) {
          results.push({
            id: entry.name,
            mtime: stat.mtimeMs,
            path: summaryPath,
          });
        }
      } catch {
        // 文件不存在，跳过
      }
    }

    // 按修改时间倒序排列
    results.sort((a, b) => b.mtime - a.mtime);

    return results;
  } catch {
    return [];
  }
}

// ============================================================================
// Feature Flag 函数（写死为启用）
// ============================================================================

/**
 * 检查 session memory 是否启用
 * 官方: rF1() - 写死为 true
 *
 * @returns 始终返回 true
 */
export function isSessionMemoryEnabled(): boolean {
  // 官方检查 ROA("tengu_session_memory") && ROA("tengu_sm_compact")
  // 我们直接写死为 true
  return true;
}

// ============================================================================
// Session Memory 配置
// ============================================================================

/**
 * Session memory compact 配置
 * 官方: oF1 / gL0
 */
export interface SessionMemoryConfig {
  /** 最小 token 数才触发 compact */
  minTokens: number;
  /** 最小文本消息数 */
  minTextBlockMessages: number;
  /** 最大 token 数 */
  maxTokens: number;
}

/**
 * 默认配置
 * 官方: oF1
 */
export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  minTokens: 10000,
  minTextBlockMessages: 5,
  maxTokens: 40000,
};

/**
 * Session memory 更新配置
 * 官方: WhA / aEA
 */
export interface SessionMemoryUpdateConfig {
  /** 初始化最小消息 token 数 */
  minimumMessageTokensToInit: number;
  /** 更新之间最小 token 数 */
  minimumTokensBetweenUpdate: number;
  /** 更新之间的工具调用数 */
  toolCallsBetweenUpdates: number;
}

/**
 * 默认更新配置
 * 官方: WhA
 */
export const DEFAULT_UPDATE_CONFIG: SessionMemoryUpdateConfig = {
  minimumMessageTokensToInit: 10000,
  minimumTokensBetweenUpdate: 5000,
  toolCallsBetweenUpdates: 3,
};

// ============================================================================
// Session Memory 状态管理
// ============================================================================

/**
 * Session Memory 状态（按 sessionId 隔离）
 *
 * 官方 CLI 是单会话进程，所以用全局单例没问题。
 * 我们的 Web 模式允许多会话并发，必须按 sessionId 隔离状态，
 * 否则会话 A 的 isWriting 会阻塞会话 B 的 waitForWrite，
 * token 计数会跨会话累加导致错误触发更新。
 */
interface SessionMemoryState {
  /** 上次压缩的 UUID */
  lastCompactedUuid: string | undefined;
  /** 是否正在写入 */
  isWriting: boolean;
  /** 累计输入 token 数 */
  totalInputTokens: number;
  /** 累计消息 token 数 */
  totalMessageTokens: number;
  /** 上次更新时的 token 数 */
  lastUpdateTokens: number;
  /** 是否已初始化 */
  isInitialized: boolean;
}

/** 默认 key（CLI 单会话模式） */
const DEFAULT_SESSION_KEY = '__default__';

/** 按 sessionId 隔离的状态存储 */
const stateMap = new Map<string, SessionMemoryState>();

/** 创建初始状态 */
function createInitialState(): SessionMemoryState {
  return {
    lastCompactedUuid: undefined,
    isWriting: false,
    totalInputTokens: 0,
    totalMessageTokens: 0,
    lastUpdateTokens: 0,
    isInitialized: false,
  };
}

/** 获取指定会话的状态，不存在则创建 */
function getState(sessionId?: string): SessionMemoryState {
  const key = sessionId || DEFAULT_SESSION_KEY;
  let state = stateMap.get(key);
  if (!state) {
    state = createInitialState();
    stateMap.set(key, state);
  }
  return state;
}

/**
 * 获取上次压缩的 UUID
 * 官方: Xs2()
 */
export function getLastCompactedUuid(sessionId?: string): string | undefined {
  return getState(sessionId).lastCompactedUuid;
}

/**
 * 设置上次压缩的 UUID
 * 官方: oEA()
 */
export function setLastCompactedUuid(uuid: string | undefined, sessionId?: string): void {
  getState(sessionId).lastCompactedUuid = uuid;
}

/**
 * 标记开始写入
 * 官方: Is2()
 */
export function markWriteStart(sessionId?: string): void {
  getState(sessionId).isWriting = true;
}

/**
 * 标记写入结束
 * 官方: Ds2()
 */
export function markWriteEnd(sessionId?: string): void {
  getState(sessionId).isWriting = false;
}

/**
 * 等待写入完成
 * 官方: Ws2()
 */
export async function waitForWrite(timeout: number = 15000, sessionId?: string): Promise<void> {
  const state = getState(sessionId);
  const startTime = Date.now();
  const maxWait = 60000;

  while (state.isWriting) {
    if (Date.now() - startTime > maxWait) return;
    if (Date.now() - startTime > timeout) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * 增加输入 token 数
 * 官方: Hs2()
 */
export function addInputTokens(tokens: number, sessionId?: string): void {
  getState(sessionId).totalInputTokens += tokens;
}

/**
 * 增加消息 token 数
 * 官方: Es2()
 */
export function addMessageTokens(tokens: number, sessionId?: string): void {
  getState(sessionId).totalMessageTokens += tokens;
}

/**
 * 记录上次更新的 token 数
 * 官方: zs2()
 */
export function recordUpdateTokens(sessionId?: string): void {
  const state = getState(sessionId);
  state.lastUpdateTokens = state.totalInputTokens;
}

/**
 * 检查是否已初始化
 * 官方: $s2()
 */
export function isInitialized(sessionId?: string): boolean {
  return getState(sessionId).isInitialized;
}

/**
 * 标记已初始化
 * 官方: Cs2()
 */
export function markInitialized(sessionId?: string): void {
  getState(sessionId).isInitialized = true;
}

/**
 * 检查是否应该初始化
 * 官方: Us2()
 */
export function shouldInit(config: SessionMemoryUpdateConfig = DEFAULT_UPDATE_CONFIG, sessionId?: string): boolean {
  return getState(sessionId).totalMessageTokens >= config.minimumMessageTokensToInit;
}

/**
 * 检查是否应该更新
 * 官方: qs2()
 */
export function shouldUpdate(config: SessionMemoryUpdateConfig = DEFAULT_UPDATE_CONFIG, sessionId?: string): boolean {
  const state = getState(sessionId);
  return state.totalInputTokens - state.lastUpdateTokens >= config.minimumTokensBetweenUpdate;
}

/**
 * 重置指定会话的状态
 */
export function resetState(sessionId?: string): void {
  const key = sessionId || DEFAULT_SESSION_KEY;
  stateMap.delete(key);
}

/**
 * 清除所有会话状态（用于测试）
 */
export function resetAllStates(): void {
  stateMap.clear();
}

// ============================================================================
// 格式化 Session Memory 用于显示
// ============================================================================

/**
 * 格式化 session memory 用于系统提示
 * 官方: u51()
 *
 * @param content session memory 内容
 * @param isCompact 是否为 compact 模式
 * @param notesPath summary.md 路径
 * @param includeReadPrompt 是否包含读取提示
 * @returns 格式化后的内容
 */
export function formatForSystemPrompt(
  content: string,
  isCompact: boolean = false,
  notesPath?: string,
  includeReadPrompt: boolean = false
): string {
  const lines: string[] = [
    '<session-notes>',
    content,
    '</session-notes>',
  ];

  if (isCompact && notesPath && includeReadPrompt) {
    lines.push('');
    lines.push(`To read the full session notes, use: Read tool with path "${notesPath}"`);
  }

  return lines.join('\n');
}
