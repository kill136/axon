/**
 * 会话管理系统
 * 支持会话持久化和恢复
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { Message, ContentBlock } from '../types/index.js';
import { configManager } from '../config/index.js';

// ============================================================================
// v2.1.33: XML 标记清理函数
// 修复 /resume session picker 显示 raw XML 标记而不是干净标题的问题
// 当会话通过 slash command 开始时，消息中包含 XML 标记（如 <command-message>、<skill> 等）
// ============================================================================

/**
 * 从文本中剥离 XML 标记，只保留纯文本内容
 * 用于 session picker 显示干净的标题
 *
 * v2.1.33 修复：/resume session picker showing raw XML markup instead of clean titles
 */
export function stripXmlTags(text: string): string {
  if (!text) return text;
  // 移除所有 XML/HTML 标记
  let clean = text.replace(/<[^>]*>/g, '');
  // 清理多余空白
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
}

/**
 * 获取干净的 session 显示标题
 * 如果 session name 包含 XML 标记（来自 slash command），则清理它
 */
export function getCleanSessionTitle(session: SessionData): string {
  if (session.metadata.name) {
    return stripXmlTags(session.metadata.name);
  }

  // 如果没有 name，从第一条消息获取预览
  if (session.messages.length > 0) {
    const firstMsg = session.messages[0];
    let preview = '';
    if (typeof firstMsg.content === 'string') {
      preview = firstMsg.content;
    } else if (Array.isArray(firstMsg.content)) {
      const textBlock = firstMsg.content.find((b: any) => b.type === 'text');
      if (textBlock && 'text' in textBlock) {
        preview = (textBlock as any).text || '';
      }
    }
    // 清理 XML 标记并截取
    preview = stripXmlTags(preview);
    if (preview.length > 80) {
      preview = preview.slice(0, 80) + '...';
    }
    return preview || session.metadata.id;
  }

  return session.metadata.id;
}

// ============================================================================
// v2.1.19: 恢复会话路径追踪
// 当从不同目录恢复会话时，需要记住原始会话文件路径
// 用于修复 /rename 和 /tag 在不同目录恢复时更新错误会话的问题
// ============================================================================

/**
 * 恢复的会话文件路径（官方 resumedTranscriptPath）
 * 当恢复会话时设置，用于确保 rename/tag 更新正确的会话文件
 */
let resumedTranscriptPath: string | null = null;

/**
 * 获取恢复的会话路径
 * 官方 Fd6() 函数
 */
export function getResumedTranscriptPath(): string | null {
  return resumedTranscriptPath;
}

/**
 * 设置恢复的会话路径
 * 官方 blA() 函数
 */
export function setResumedTranscriptPath(filePath: string | null): void {
  resumedTranscriptPath = filePath;
}

/**
 * 获取当前活动会话的文件路径
 * 官方 O$() 函数
 *
 * 逻辑：
 * 1. 如果有恢复的会话路径，使用它
 * 2. 否则使用当前会话 ID 生成路径
 */
export function getActiveSessionPath(sessionId: string): string {
  if (resumedTranscriptPath) {
    return resumedTranscriptPath;
  }
  return getSessionPath(sessionId);
}

// ============================================================================
// 会话元数据缓存系统（解决 listSessions 性能问题）
// ============================================================================

/**
 * 缓存的会话元数据条目
 */
interface CachedSessionEntry {
  metadata: SessionMetadata;
  mtime: number; // 文件修改时间
}

/**
 * 元数据缓存
 */
const sessionMetadataCache = new Map<string, CachedSessionEntry>();

/**
 * 上次扫描目录的时间
 */
let lastDirScanTime = 0;

/**
 * 上次扫描时的文件列表
 */
let lastFileList: string[] = [];

/**
 * 缓存有效期（毫秒）- 5秒内不重新扫描目录
 */
const CACHE_SCAN_INTERVAL = 5000;

/**
 * 使缓存失效（外部调用，如保存/删除会话后）
 */
export function invalidateSessionCache(sessionId?: string): void {
  if (sessionId) {
    sessionMetadataCache.delete(sessionId);
    // 同时重置目录扫描缓存，确保新创建的会话能立即显示
    lastDirScanTime = 0;
    lastFileList = [];
  } else {
    sessionMetadataCache.clear();
    lastDirScanTime = 0;
    lastFileList = [];
  }
}

/**
 * 获取会话存储目录（从配置）
 */
function getSessionDir(): string {
  const config = configManager.getAll();
  return config.sessionManager?.sessionDir || path.join(os.homedir(), '.axon', 'sessions');
}

/**
 * 获取最大会话数（从配置）
 */
function getMaxSessions(): number {
  const config = configManager.getAll();
  return config.sessionManager?.maxSessions ?? 100;
}

/**
 * 获取会话过期天数（从配置）
 */
function getSessionExpiryDays(): number {
  const config = configManager.getAll();
  return config.sessionManager?.sessionExpiryDays ?? 30;
}

export interface SessionMetadata {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  workingDirectory: string;
  model: string;
  messageCount: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
  };
  tags?: string[];
  summary?: string;
  // 项目路径（用于按项目过滤会话，null 表示全局会话）
  projectPath?: string | null;
  // Fork 相关元数据
  parentId?: string; // 父会话 ID（如果是 fork）
  forkPoint?: number; // 从父会话的哪个消息索引 fork
  branches?: string[]; // 子会话 ID 列表
  forkName?: string; // 分支名称
  mergedFrom?: string[]; // 合并自哪些会话
  cost?: number; // 会话成本（美元）
  // Plan Mode 相关元数据
  hasExitedPlanMode?: boolean; // 是否已退出计划模式
  needsPlanModeExitAttachment?: boolean; // 是否需要在退出时添加附件
  activePlanId?: string; // 当前活跃的计划 ID
  planHistory?: string[]; // 历史计划 ID 列表
  // v2.1.27: PR 链接相关元数据
  prNumber?: number; // 关联的 PR 号
  prUrl?: string; // PR 的完整 URL
  prRepository?: string; // 仓库名称（格式：owner/repo）
  // Git 分支相关
  gitBranch?: string; // 当前 git 分支
}

export interface SessionData {
  metadata: SessionMetadata;
  messages: Message[];
  systemPrompt?: string;
  context?: Record<string, unknown>;
}

/**
 * 官方会话状态
 */
export interface OfficialSessionState {
  sessionId: string;
  cwd: string;
  originalCwd: string;
  startTime: number;
  totalCostUSD: number;
  totalAPIDuration: number;
  totalAPIDurationWithoutRetries: number;
  totalToolDuration: number;
  modelUsage: Record<string, unknown>;
  todos: unknown[];
}

/**
 * 官方会话元数据
 */
export interface OfficialSessionMetadata {
  gitStatus?: string;
  firstPrompt?: string;
  projectPath?: string;
  created: number;
  modified: number;
  messageCount: number;
}

/**
 * 官方会话数据格式
 */
export interface OfficialSessionData {
  version: string;
  state: OfficialSessionState;
  messages: Message[];
  metadata: OfficialSessionMetadata;
}

/**
 * 判断是否为官方格式的会话数据
 */
function isOfficialFormat(data: any): data is OfficialSessionData {
  return data?.version && data?.state?.sessionId && typeof data.state.sessionId === 'string';
}

/**
 * 将官方格式转换为内部格式的元数据
 */
function convertOfficialToMetadata(data: OfficialSessionData): SessionMetadata {
  return {
    id: data.state.sessionId,
    name: (data.metadata as any)?.customTitle || data.metadata?.firstPrompt?.substring(0, 50) || undefined,
    createdAt: data.metadata?.created || data.state.startTime || Date.now(),
    updatedAt: data.metadata?.modified || data.state.startTime || Date.now(),
    workingDirectory: data.state.cwd || data.metadata?.projectPath || process.cwd(),
    model: Object.keys(data.state.modelUsage || {})[0] || 'sonnet',
    messageCount: data.metadata?.messageCount || data.messages?.length || 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    cost: data.state.totalCostUSD || 0,
  };
}

export interface SessionListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'asc' | 'desc';
  tags?: string[];
  /** 按项目路径过滤，null 表示只获取全局会话 */
  projectPath?: string | null;
}

export interface SessionStatistics {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  averageMessagesPerSession: number;
  averageTokensPerSession: number;
  modelUsage: Record<string, number>;
  tagUsage: Record<string, number>;
  oldestSession?: SessionMetadata;
  newestSession?: SessionMetadata;
  mostActiveSession?: SessionMetadata;
}

export interface ForkOptions {
  fromMessageIndex?: number; // 从哪条消息开始 fork（默认：全部）
  name?: string; // 新会话名称
  tags?: string[]; // 新会话标签
  includeFutureMessages?: boolean; // 是否包含指定索引之后的消息（默认：true）
}

export interface MergeOptions {
  strategy?: 'append' | 'interleave' | 'replace'; // 合并策略
  keepMetadata?: 'source' | 'target' | 'merge'; // 元数据保留策略
  conflictResolution?: 'source' | 'target'; // 冲突解决策略
}

/**
 * 上次清理过期会话的时间戳（用于节流）
 */
let lastCleanupTime = 0;

/**
 * 确保会话目录存在
 */
function ensureSessionDir(): void {
  if (!fs.existsSync(getSessionDir())) {
    fs.mkdirSync(getSessionDir(), { recursive: true });
  }
}

/**
 * 生成会话 ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${timestamp}-${random}`;
}

/**
 * 获取会话文件路径
 */
function getSessionPath(sessionId: string): string {
  return path.join(getSessionDir(), `${sessionId}.json`);
}

// ============================================================================
// WAL (Write-Ahead Log) 增量持久化
//
// 解决的问题：conversationLoop 中途被 tsx watch 杀进程时，内存中的新消息丢失。
// 原方案：每轮全量 JSON.stringify + writeFile → I/O 膨胀，且仍有丢失窗口。
// WAL 方案：每条消息只 appendFileSync 一行 JSONL（微秒级），加载时 replay。
//
// 文件布局：
//   {sessionId}.json      — 主快照（一轮完整对话结束后全量写入）
//   {sessionId}.wal.jsonl  — 增量日志（每条消息实时追加）
//
// 生命周期：
//   对话中 → walAppend()  每条消息追加到 WAL
//   一轮结束 → walCheckpoint()  全量保存主 JSON，清空 WAL
//   加载时 → loadSession() 先读主 JSON，再 replay WAL 中比主 JSON 更新的条目
// ============================================================================

/** WAL 条目类型 */
interface WalEntry {
  /** 全局序号，单调递增 */
  seq: number;
  /** 该 op 类型的分类序号（msg/chat 各自独立递增），用于判断是否比主快照更新 */
  opSeq?: number;
  /** 时间戳 */
  ts: number;
  /** 操作类型 */
  op: 'msg' | 'chat' | 'meta';
  /** 数据载荷 */
  data: unknown;
}

/** 每个会话的 WAL 序号计数器，按 op 类型分别维护（进程内维护） */
const walSeqCounters = new Map<string, { msg: number; chat: number; global: number }>();

/** 获取 WAL 文件路径 */
function getWalPath(sessionId: string): string {
  return path.join(getSessionDir(), `${sessionId}.wal.jsonl`);
}

/**
 * 追加一条消息到 WAL（同步，微秒级）
 * 供 conversation.ts 在每条消息 push 到 state 后立即调用
 */
export function walAppend(sessionId: string, op: WalEntry['op'], data: unknown): void {
  if (!sessionId || sessionId === 'undefined') return;

  let counters = walSeqCounters.get(sessionId);
  if (!counters) {
    counters = { msg: 0, chat: 0, global: 0 };
    walSeqCounters.set(sessionId, counters);
  }
  counters.global++;
  // 按 op 类型递增分类计数器
  let opSeq: number | undefined;
  if (op === 'msg') { counters.msg++; opSeq = counters.msg; }
  else if (op === 'chat') { counters.chat++; opSeq = counters.chat; }
  const seq = counters.global;

  const entry: WalEntry = { seq, ts: Date.now(), op, data, opSeq };
  const line = JSON.stringify(entry) + '\n';

  try {
    ensureSessionDir();
    fs.appendFileSync(getWalPath(sessionId), line, { mode: 0o600 });
  } catch (err) {
    // WAL 写失败不阻塞主流程，降级为丢该条
    console.warn(`[WAL] append failed (session=${sessionId}):`, err);
  }
}

/**
 * Checkpoint：全量保存主 JSON 并清空 WAL
 * 在一轮完整对话结束后调用
 */
export function walCheckpoint(session: SessionData): void {
  const sessionId = session.metadata.id;

  // 先全量保存主 JSON
  saveSession(session);

  // 清空 WAL 文件
  try {
    const walPath = getWalPath(sessionId);
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  } catch {
    // 忽略清理失败
  }

  // 将分类计数器设为当前数量（不是 delete）
  // 这样 checkpoint 后追加的 WAL 条目的 msg/chat 计数器会从当前 length 继续递增
  // walReplay 时 msgSeq/chatSeq 会正确地大于 baseMessageCount/baseChatCount
  const chatCount = (session as any).chatHistory?.length ?? 0;
  walSeqCounters.set(sessionId, {
    msg: session.messages.length,
    chat: chatCount,
    global: session.messages.length + chatCount,
  });
}

/**
 * 从 WAL 文件读取所有条目
 * 容错：跳过损坏的行（进程被杀可能导致最后一行不完整）
 */
function walRead(sessionId: string): WalEntry[] {
  const walPath = getWalPath(sessionId);
  if (!fs.existsSync(walPath)) return [];

  try {
    const content = fs.readFileSync(walPath, 'utf-8');
    const entries: WalEntry[] = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // 跳过损坏行（最后一行可能被截断）
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * 将 WAL 条目 replay 到 SessionData 上
 * loadSession 加载主 JSON 后调用
 */
function walReplay(session: SessionData, entries: WalEntry[]): void {
  if (entries.length === 0) return;

  const baseMessageCount = session.messages.length;
  const baseChatCount = (session as any).chatHistory?.length ?? 0;

  let replayedMsgs = 0;
  let replayedChats = 0;

  // 使用局部计数器作为 fallback（兼容无 opSeq 的旧 WAL 格式）
  let msgSeq = 0;
  let chatSeq = 0;

  for (const entry of entries) {
    switch (entry.op) {
      case 'msg': {
        msgSeq++;
        // 优先使用 opSeq（全局分类序号），回退到局部计数器
        const effectiveSeq = entry.opSeq ?? msgSeq;
        if (effectiveSeq > baseMessageCount) {
          session.messages.push(entry.data as Message);
          replayedMsgs++;
        }
        break;
      }
      case 'chat': {
        chatSeq++;
        const effectiveSeq = entry.opSeq ?? chatSeq;
        if (effectiveSeq > baseChatCount) {
          if (!(session as any).chatHistory) {
            (session as any).chatHistory = [];
          }
          (session as any).chatHistory.push(entry.data);
          replayedChats++;
        }
        break;
      }
      case 'meta':
        // 元数据更新（model 切换等），直接 merge
        Object.assign(session.metadata, entry.data);
        break;
    }
  }

  if (replayedMsgs > 0 || replayedChats > 0) {
    session.metadata.messageCount = session.messages.length;
    console.log(`[WAL] Replayed ${replayedMsgs} messages, ${replayedChats} chat entries for session ${session.metadata.id}`);
  }
}

/**
 * 保存会话
 *
 * v2.1.19 修复：支持 resumedTranscriptPath
 * 当从不同目录恢复会话时，使用原始的会话文件路径
 */
export function saveSession(session: SessionData, options?: { useResumedPath?: boolean }): void {
  // 验证 sessionId 有效性
  const sessionId = session.metadata.id;
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
    console.error(`[Session] Invalid session ID, refusing to save: ${sessionId}`);
    return;
  }

  ensureSessionDir();

  // v2.1.19: 如果指定使用恢复路径且有 resumedTranscriptPath，使用它
  // 这修复了从不同目录（如 git worktree）恢复时 /rename 和 /tag 更新错误会话的问题
  let sessionPath: string;
  if (options?.useResumedPath && resumedTranscriptPath) {
    sessionPath = resumedTranscriptPath;
  } else {
    sessionPath = getSessionPath(sessionId);
  }

  session.metadata.updatedAt = Date.now();
  session.metadata.messageCount = session.messages.length;

  // 原子写入：先写临时文件再 rename，防止进程中途被杀导致文件半写损坏
  const content = JSON.stringify(session);
  const tmpFile = `${sessionPath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpFile, content, { mode: 0o600, flush: true });
    fs.renameSync(tmpFile, sessionPath);
  } catch {
    // rename 失败（Windows 上目标被锁定时可能发生），降级为直接写
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    fs.writeFileSync(sessionPath, content, { mode: 0o600, flush: true });
  }

  // 使该会话的缓存失效（因为文件已更新）
  invalidateSessionCache(sessionId);

  // 清理过期会话（节流：只在距上次清理超过 10 分钟时才执行）
  const now = Date.now();
  if (now - lastCleanupTime > 10 * 60 * 1000) {
    lastCleanupTime = now;
    cleanupOldSessions();
  }
}

/**
 * 将官方格式转换为内部格式的完整会话数据
 */
function convertOfficialToSessionData(data: OfficialSessionData): SessionData {
  return {
    metadata: convertOfficialToMetadata(data),
    messages: data.messages || [],
    systemPrompt: undefined,
    context: undefined,
  };
}

/**
 * 加载会话
 */
export function loadSession(sessionId: string): SessionData | null {
  const sessionPath = getSessionPath(sessionId);

  if (!fs.existsSync(sessionPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(sessionPath, 'utf-8');
    const data = JSON.parse(content);

    let session: SessionData;

    // 兼容官方 Axon 格式
    if (isOfficialFormat(data)) {
      session = convertOfficialToSessionData(data);
    } else {
      session = data as SessionData;
    }

    // WAL replay：将未 checkpoint 的增量条目恢复到 session
    const walEntries = walRead(sessionId);
    if (walEntries.length > 0) {
      walReplay(session, walEntries);
      // replay 后的条目数写回计数器，以便后续 walAppend 序号连续
      const maxSeq = walEntries[walEntries.length - 1].seq;
      // 从 WAL 条目中恢复分类计数器
      let maxMsgOpSeq = 0;
      let maxChatOpSeq = 0;
      for (const e of walEntries) {
        if (e.op === 'msg' && e.opSeq && e.opSeq > maxMsgOpSeq) maxMsgOpSeq = e.opSeq;
        if (e.op === 'chat' && e.opSeq && e.opSeq > maxChatOpSeq) maxChatOpSeq = e.opSeq;
      }
      // 如果旧 WAL 没有 opSeq，使用 session 当前的实际数量作为基线
      walSeqCounters.set(sessionId, {
        msg: maxMsgOpSeq || session.messages.length,
        chat: maxChatOpSeq || ((session as any).chatHistory?.length ?? 0),
        global: maxSeq,
      });
    }

    return session;
  } catch (err) {
    console.error(`Failed to load session ${sessionId}:`, err);
    return null;
  }
}

/**
 * 删除会话
 */
export function deleteSession(sessionId: string): boolean {
  // 验证 sessionId 有效性
  if (!sessionId || sessionId === 'undefined' || sessionId === 'null') {
    console.error(`[Session] Invalid session ID: ${sessionId}`);
    return false;
  }

  const sessionPath = getSessionPath(sessionId);

  // 使缓存失效
  invalidateSessionCache(sessionId);

  // 如果文件不存在，仍然返回 true（会话已经不存在了，删除目标达成）
  if (!fs.existsSync(sessionPath)) {
    console.log(`[Session] Session file does not exist, treating as deleted successfully: ${sessionId}`);
    return true;
  }

  try {
    fs.unlinkSync(sessionPath);

    // 同时删除 WAL 文件（防止资源泄漏和数据幽灵）
    try {
      const walPath = getWalPath(sessionId);
      if (fs.existsSync(walPath)) {
        fs.unlinkSync(walPath);
      }
    } catch { /* WAL 清理失败不影响主逻辑 */ }

    // 清除内存中的 WAL 计数器
    walSeqCounters.delete(sessionId);

    console.log(`[Session] Session deleted: ${sessionId}`);
    return true;
  } catch (err) {
    console.error(`Failed to delete session ${sessionId}:`, err);
    return false;
  }
}

/**
 * 列出所有会话（带缓存优化）
 */
export function listSessions(options: SessionListOptions = {}): SessionMetadata[] {
  ensureSessionDir();

  const {
    limit = 20,
    offset = 0,
    search,
    sortBy = 'updatedAt',
    sortOrder = 'desc',
    tags,
    projectPath,
  } = options;

  const sessionDir = getSessionDir();
  const now = Date.now();

  // 检查是否需要重新扫描目录
  let files: string[];
  if (now - lastDirScanTime < CACHE_SCAN_INTERVAL && lastFileList.length > 0) {
    // 使用缓存的文件列表
    files = lastFileList;
  } else {
    // 重新扫描目录
    files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json'));
    lastFileList = files;
    lastDirScanTime = now;
  }

  const sessions: SessionMetadata[] = [];

  for (const file of files) {
    const sessionId = file.replace('.json', '');
    const filePath = path.join(sessionDir, file);

    try {
      // v2.1.30: stat-based 轻量加载 - 先用 stat 检查缓存有效性
      // 避免解析大型 JSON 文件（68% 内存减少优化）
      const stat = fs.statSync(filePath);

      // 检查缓存
      const cached = sessionMetadataCache.get(sessionId);

      // 如果缓存有效（mtime 匹配），直接使用，不读取文件
      if (cached && stat.mtimeMs === cached.mtime) {
        sessions.push(cached.metadata);
        continue;
      }

      // 缓存无效或不存在，需要读取文件
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      let metadata: SessionMetadata | null = null;

      // 兼容官方 Axon 格式和内部格式
      if (isOfficialFormat(data)) {
        metadata = convertOfficialToMetadata(data);
      } else if (data?.metadata?.id) {
        metadata = (data as SessionData).metadata;
      }

      if (metadata) {
        // WAL 感知：如果存在未 checkpoint 的 WAL 文件，修正 messageCount
        // 强制重启时主 JSON 可能未更新，messageCount=0 会导致会话被列表过滤掉
        const walPath = getWalPath(sessionId);
        if (fs.existsSync(walPath)) {
          const walEntries = walRead(sessionId);
          const msgEntries = walEntries.filter(e => e.op === 'msg');
          if (msgEntries.length > 0) {
            // 使用 opSeq（分类序号）来确定实际总消息数
            // opSeq 是全局绝对序号，表示该 msg 是会话中的第 N 条消息
            const maxOpSeq = msgEntries.reduce((max, e) => Math.max(max, e.opSeq ?? 0), 0);
            if (maxOpSeq > (metadata.messageCount || 0)) {
              // 浅拷贝 metadata 避免污染缓存
              metadata = { ...metadata, messageCount: maxOpSeq };
            } else if (maxOpSeq === 0) {
              // 旧格式 WAL 无 opSeq，回退到原始逻辑
              const extraMsgs = msgEntries.length - (metadata.messageCount || 0);
              if (extraMsgs > 0) {
                metadata = { ...metadata, messageCount: (metadata.messageCount || 0) + extraMsgs };
              }
            }
          }
        }

        // 更新缓存（stat 已在前面获取）
        sessionMetadataCache.set(sessionId, {
          metadata,
          mtime: stat.mtimeMs,
        });
        sessions.push(metadata);
      }
    } catch {
      // 忽略无法解析的文件，同时从缓存中移除
      sessionMetadataCache.delete(sessionId);
    }
  }

  // 清理已删除文件的缓存
  const fileSet = new Set(files.map(f => f.replace('.json', '')));
  for (const cachedId of sessionMetadataCache.keys()) {
    if (!fileSet.has(cachedId)) {
      sessionMetadataCache.delete(cachedId);
    }
  }

  // 去重（按 id 去重，保留第一个）
  const seenIds = new Set<string>();
  const uniqueSessions = sessions.filter((s) => {
    if (seenIds.has(s.id)) {
      return false;
    }
    seenIds.add(s.id);
    return true;
  });

  // 过滤
  let filtered = uniqueSessions;

  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.name?.toLowerCase().includes(searchLower) ||
        s.summary?.toLowerCase().includes(searchLower) ||
        s.id.includes(searchLower)
    );
  }

  if (tags && tags.length > 0) {
    filtered = filtered.filter((s) => s.tags?.some((t) => tags.includes(t)));
  }

  // 按项目路径过滤（兼容 CLI 会话：回退到 workingDirectory）
  if (projectPath !== undefined) {
    if (projectPath === null) {
      // 只获取全局会话（projectPath 为 null 或 undefined，且 workingDirectory 也为空）
      filtered = filtered.filter((s) =>
        (s.projectPath === null || s.projectPath === undefined) &&
        (s.workingDirectory === null || s.workingDirectory === undefined)
      );
    } else {
      // 获取指定项目的会话
      // 路径标准化：统一转小写、统一斜杠方向（兼容 Windows 路径差异）
      const normalizePathForCompare = (p: string | undefined | null): string => {
        if (!p) return '';
        return p.replace(/\\/g, '/').toLowerCase();
      };
      const normalizedTarget = normalizePathForCompare(projectPath);

      filtered = filtered.filter((s) => {
        // 优先匹配 projectPath，回退到 workingDirectory（兼容 CLI 会话）
        const sessionPath = s.projectPath || s.workingDirectory;
        return normalizePathForCompare(sessionPath) === normalizedTarget;
      });
    }
  }

  // 排序（添加二级排序以确保稳定性）
  filtered.sort((a, b) => {
    const aVal = a[sortBy] ?? 0;
    const bVal = b[sortBy] ?? 0;

    let result: number;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      result = sortOrder === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    } else {
      result = sortOrder === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    }

    // 二级排序：当主排序字段相同时，按 id 降序排列（确保稳定性）
    if (result === 0) {
      return b.id.localeCompare(a.id);
    }

    return result;
  });

  // 分页
  return filtered.slice(offset, offset + limit);
}

/**
 * 获取最近的会话
 */
export function getRecentSession(): SessionData | null {
  const sessions = listSessions({ limit: 1, sortBy: 'updatedAt', sortOrder: 'desc' });

  if (sessions.length === 0) {
    return null;
  }

  return loadSession(sessions[0].id);
}

/**
 * 获取特定目录的最近会话
 */
export function getSessionForDirectory(directory: string): SessionData | null {
  ensureSessionDir();

  const files = fs.readdirSync(getSessionDir()).filter((f) => f.endsWith('.json'));
  let latestSession: SessionData | null = null;
  let latestTime = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(getSessionDir(), file), 'utf-8');
      const session = JSON.parse(content) as SessionData;

      if (
        session.metadata.workingDirectory === directory &&
        session.metadata.updatedAt > latestTime
      ) {
        latestSession = session;
        latestTime = session.metadata.updatedAt;
      }
    } catch {
      // 忽略
    }
  }

  return latestSession;
}

/**
 * 创建新会话
 */
export function createSession(options: {
  name?: string;
  model: string;
  workingDirectory?: string;
  systemPrompt?: string;
  tags?: string[];
  /** 项目路径，用于按项目过滤会话，null 表示全局会话 */
  projectPath?: string | null;
}): SessionData {
  const now = Date.now();

  const session: SessionData = {
    metadata: {
      id: generateSessionId(),
      name: options.name,
      createdAt: now,
      updatedAt: now,
      workingDirectory: options.workingDirectory || process.cwd(),
      model: options.model,
      messageCount: 0,
      tokenUsage: { input: 0, output: 0, total: 0 },
      tags: options.tags,
      projectPath: options.projectPath,
    },
    messages: [],
    systemPrompt: options.systemPrompt,
    context: {},
  };

  return session;
}

/**
 * 添加消息到会话
 */
export function addMessageToSession(
  session: SessionData,
  message: Message,
  tokenUsage?: { input: number; output: number }
): void {
  session.messages.push(message);
  session.metadata.messageCount = session.messages.length;
  session.metadata.updatedAt = Date.now();

  if (tokenUsage) {
    session.metadata.tokenUsage.input += tokenUsage.input;
    session.metadata.tokenUsage.output += tokenUsage.output;
    session.metadata.tokenUsage.total += tokenUsage.input + tokenUsage.output;
  }
}

/**
 * 更新会话摘要
 */
export function updateSessionSummary(session: SessionData, summary: string): void {
  session.metadata.summary = summary;
  session.metadata.updatedAt = Date.now();
}

/**
 * 清理过期会话
 */
function cleanupOldSessions(): void {
  ensureSessionDir();

  const sessionDir = getSessionDir();
  const allFiles = fs.readdirSync(sessionDir);
  const jsonFiles = allFiles.filter((f) => f.endsWith('.json'));
  const sessions: { file: string; mtime: number }[] = [];

  const expiryTime = Date.now() - getSessionExpiryDays() * 24 * 60 * 60 * 1000;

  for (const file of jsonFiles) {
    try {
      const filePath = path.join(sessionDir, file);
      // 优化：使用 fs.statSync 获取文件修改时间，而不是读取完整 JSON
      const stats = fs.statSync(filePath);
      const mtime = stats.mtimeMs;

      // 删除过期会话（基于文件修改时间）
      if (mtime < expiryTime) {
        deleteSessionFiles(sessionDir, file);
        continue;
      }

      sessions.push({ file, mtime });
    } catch {
      // 删除无法访问的文件
      deleteSessionFiles(sessionDir, file);
    }
  }

  // 如果超过最大数量，优先删除空会话（无消息、文件小），再按时间删最旧的
  // 防止定时任务产生的大量空会话挤掉有价值的历史会话
  if (sessions.length > getMaxSessions()) {
    const maxSessions = getMaxSessions();
    const toDeleteCount = sessions.length - maxSessions;

    // 区分空会话和有内容的会话（空会话文件一般 < 3KB）
    const EMPTY_SESSION_SIZE_THRESHOLD = 3 * 1024;
    const emptyOnes: typeof sessions = [];
    const contentOnes: typeof sessions = [];

    for (const s of sessions) {
      try {
        const stat = fs.statSync(path.join(sessionDir, s.file));
        if (stat.size < EMPTY_SESSION_SIZE_THRESHOLD) {
          emptyOnes.push(s);
        } else {
          contentOnes.push(s);
        }
      } catch {
        emptyOnes.push(s); // 无法 stat 的视为空会话
      }
    }

    // 先删空会话（按时间从旧到新），再删有内容的（按时间从旧到新）
    emptyOnes.sort((a, b) => a.mtime - b.mtime);
    contentOnes.sort((a, b) => a.mtime - b.mtime);

    const toDelete = [...emptyOnes, ...contentOnes].slice(0, toDeleteCount);
    for (const { file } of toDelete) {
      deleteSessionFiles(sessionDir, file);
    }
  }

  // 清理孤立 WAL 文件（有 .wal.jsonl 但没有对应的 .json）
  const jsonSet = new Set(jsonFiles.map(f => f.replace('.json', '')));
  const walFiles = allFiles.filter(f => f.endsWith('.wal.jsonl'));
  for (const walFile of walFiles) {
    const sessionId = walFile.replace('.wal.jsonl', '');
    if (!jsonSet.has(sessionId)) {
      try {
        fs.unlinkSync(path.join(sessionDir, walFile));
      } catch { /* ignore */ }
    }
  }
}

/**
 * 删除会话的所有关联文件（.json + .wal.jsonl）
 */
function deleteSessionFiles(sessionDir: string, jsonFile: string): void {
  const sessionId = jsonFile.replace('.json', '');
  // 删除主 JSON 文件
  try {
    fs.unlinkSync(path.join(sessionDir, jsonFile));
  } catch { /* ignore */ }
  // 删除对应的 WAL 文件
  try {
    const walPath = path.join(sessionDir, `${sessionId}.wal.jsonl`);
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  } catch { /* ignore */ }
  // 清除内存缓存
  sessionMetadataCache.delete(sessionId);
}

/**
 * 导出会话为 Markdown
 */
export function exportSessionToMarkdown(session: SessionData): string {
  const lines: string[] = [];

  lines.push(`# Claude Session: ${session.metadata.name || session.metadata.id}`);
  lines.push('');
  lines.push(`- **Created:** ${new Date(session.metadata.createdAt).toISOString()}`);
  lines.push(`- **Updated:** ${new Date(session.metadata.updatedAt).toISOString()}`);
  lines.push(`- **Model:** ${session.metadata.model}`);
  lines.push(`- **Messages:** ${session.metadata.messageCount}`);
  lines.push(
    `- **Tokens:** ${session.metadata.tokenUsage.total} (${session.metadata.tokenUsage.input} in / ${session.metadata.tokenUsage.output} out)`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const message of session.messages) {
    const role = message.role === 'user' ? '👤 User' : '🤖 Assistant';
    lines.push(`## ${role}`);
    lines.push('');

    if (typeof message.content === 'string') {
      lines.push(message.content);
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          lines.push(block.text || '');
        } else if (block.type === 'tool_use') {
          lines.push(`\`\`\`json`);
          lines.push(`// Tool: ${block.name}`);
          lines.push(JSON.stringify(block.input, null, 2));
          lines.push('```');
        } else if (block.type === 'tool_result') {
          lines.push('**Tool Result:**');
          lines.push('```');
          lines.push(typeof block.content === 'string' ? block.content : JSON.stringify(block.content));
          lines.push('```');
        }
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 导入 Markdown 为会话（简化版）
 */
export function importSessionFromMarkdown(
  markdown: string,
  model: string
): SessionData {
  const session = createSession({ model });

  // 简单解析：按 "## 👤 User" 和 "## 🤖 Assistant" 分割
  const sections = markdown.split(/## (👤 User|🤖 Assistant)\n/);

  for (let i = 1; i < sections.length; i += 2) {
    const role = sections[i].includes('User') ? 'user' : 'assistant';
    const content = sections[i + 1]?.split('---')[0]?.trim() || '';

    if (content) {
      session.messages.push({
        role: role as 'user' | 'assistant',
        content,
      });
    }
  }

  session.metadata.messageCount = session.messages.length;
  return session;
}

/**
 * 压缩会话历史（用于 context 管理）
 */
export function compactSession(
  session: SessionData,
  maxMessages: number = 20
): SessionData {
  if (session.messages.length <= maxMessages) {
    return session;
  }

  // 保留最近的消息
  const recentMessages = session.messages.slice(-maxMessages);

  // 创建摘要消息（如果有之前的消息）
  const oldMessages = session.messages.slice(0, -maxMessages);
  const summaryText = `[Previous conversation compacted: ${oldMessages.length} messages omitted]`;

  const compactedSession: SessionData = {
    ...session,
    messages: [
      {
        role: 'user' as const,
        content: summaryText,
      },
      ...recentMessages,
    ],
  };

  return compactedSession;
}

/**
 * Fork 会话（创建分支）
 */
export function forkSession(
  sourceSessionId: string,
  options: ForkOptions = {}
): SessionData | null {
  const sourceSession = loadSession(sourceSessionId);
  if (!sourceSession) {
    return null;
  }

  const {
    fromMessageIndex = 0,
    name,
    tags,
    includeFutureMessages = true,
  } = options;

  // 计算实际的消息索引
  const actualIndex = Math.max(0, Math.min(fromMessageIndex, sourceSession.messages.length));

  // 创建新会话
  const forkedSession = createSession({
    name: name || `${sourceSession.metadata.name || 'Session'} (fork)`,
    model: sourceSession.metadata.model,
    workingDirectory: sourceSession.metadata.workingDirectory,
    systemPrompt: sourceSession.systemPrompt,
    tags: tags || sourceSession.metadata.tags,
  });

  // 设置 fork 元数据
  forkedSession.metadata.parentId = sourceSessionId;
  forkedSession.metadata.forkPoint = actualIndex;
  forkedSession.metadata.forkName = name;

  // 复制消息
  if (includeFutureMessages) {
    forkedSession.messages = sourceSession.messages.slice(actualIndex);
  } else {
    forkedSession.messages = sourceSession.messages.slice(0, actualIndex);
  }

  forkedSession.metadata.messageCount = forkedSession.messages.length;

  // 更新源会话的分支列表
  if (!sourceSession.metadata.branches) {
    sourceSession.metadata.branches = [];
  }
  sourceSession.metadata.branches.push(forkedSession.metadata.id);
  saveSession(sourceSession);

  // 保存 fork 会话
  saveSession(forkedSession);

  return forkedSession;
}

/**
 * 合并会话
 */
export function mergeSessions(
  targetSessionId: string,
  sourceSessionId: string,
  options: MergeOptions = {}
): SessionData | null {
  const targetSession = loadSession(targetSessionId);
  const sourceSession = loadSession(sourceSessionId);

  if (!targetSession || !sourceSession) {
    return null;
  }

  const {
    strategy = 'append',
    keepMetadata = 'target',
    conflictResolution = 'target',
  } = options;

  // 合并消息
  let mergedMessages: Message[] = [];

  switch (strategy) {
    case 'append':
      // 将源会话的消息追加到目标会话
      mergedMessages = [...targetSession.messages, ...sourceSession.messages];
      break;

    case 'interleave':
      // 按时间戳交错合并（如果消息有时间戳的话）
      mergedMessages = [...targetSession.messages, ...sourceSession.messages].sort((a, b) => {
        // 简单实现：保持原有顺序
        return 0;
      });
      break;

    case 'replace':
      // 用源会话替换目标会话
      mergedMessages = sourceSession.messages;
      break;
  }

  targetSession.messages = mergedMessages;

  // 合并元数据
  if (keepMetadata === 'source') {
    targetSession.metadata = { ...sourceSession.metadata, id: targetSession.metadata.id };
  } else if (keepMetadata === 'merge') {
    // 合并标签
    const mergedTags = [
      ...(targetSession.metadata.tags || []),
      ...(sourceSession.metadata.tags || []),
    ];
    targetSession.metadata.tags = Array.from(new Set(mergedTags));

    // 合并 token 使用
    targetSession.metadata.tokenUsage.input +=
      sourceSession.metadata.tokenUsage.input;
    targetSession.metadata.tokenUsage.output +=
      sourceSession.metadata.tokenUsage.output;
    targetSession.metadata.tokenUsage.total +=
      sourceSession.metadata.tokenUsage.total;

    // 合并成本
    if (sourceSession.metadata.cost) {
      targetSession.metadata.cost =
        (targetSession.metadata.cost || 0) + sourceSession.metadata.cost;
    }
  }

  // 记录合并来源
  if (!targetSession.metadata.mergedFrom) {
    targetSession.metadata.mergedFrom = [];
  }
  targetSession.metadata.mergedFrom.push(sourceSessionId);

  // 更新消息计数和时间戳
  targetSession.metadata.messageCount = targetSession.messages.length;
  targetSession.metadata.updatedAt = Date.now();

  // 保存合并后的会话
  saveSession(targetSession);

  return targetSession;
}

/**
 * 获取会话分支树
 */
export function getSessionBranchTree(sessionId: string): {
  session: SessionMetadata;
  parent?: SessionMetadata;
  branches: SessionMetadata[];
} | null {
  const session = loadSession(sessionId);
  if (!session) {
    return null;
  }

  const result: {
    session: SessionMetadata;
    parent?: SessionMetadata;
    branches: SessionMetadata[];
  } = {
    session: session.metadata,
    branches: [],
  };

  // v2.1.30: 加载父会话（带 cycle 检测，防止 parentId 循环导致挂起）
  if (session.metadata.parentId) {
    // 检查是否存在循环引用
    if (session.metadata.parentId === sessionId) {
      // 自引用循环，清除
      console.error(`Cycle detected: session ${sessionId} references itself as parent. Clearing parentId.`);
      session.metadata.parentId = undefined;
    } else {
      const parent = loadSession(session.metadata.parentId);
      if (parent) {
        // 进一步检查 parent 是否循环引用回当前 session
        if (parent.metadata.parentId === sessionId) {
          console.error(`Cycle detected in parentId chain between ${sessionId} and ${session.metadata.parentId}. Returning partial result.`);
        }
        result.parent = parent.metadata;
      }
    }
  }

  // 加载子会话
  if (session.metadata.branches) {
    for (const branchId of session.metadata.branches) {
      const branch = loadSession(branchId);
      if (branch) {
        result.branches.push(branch.metadata);
      }
    }
  }

  return result;
}

/**
 * 获取会话统计信息
 */
export function getSessionStatistics(): SessionStatistics {
  ensureSessionDir();

  const files = fs.readdirSync(getSessionDir()).filter((f) => f.endsWith('.json'));
  const sessions: SessionMetadata[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(getSessionDir(), file), 'utf-8');
      const data = JSON.parse(content);

      // 兼容官方 Axon 格式和内部格式
      if (isOfficialFormat(data)) {
        sessions.push(convertOfficialToMetadata(data));
      } else if (data?.metadata?.id) {
        sessions.push((data as SessionData).metadata);
      }
    } catch {
      // 忽略无法解析的文件
    }
  }

  const stats: SessionStatistics = {
    totalSessions: sessions.length,
    totalMessages: 0,
    totalTokens: 0,
    totalCost: 0,
    averageMessagesPerSession: 0,
    averageTokensPerSession: 0,
    modelUsage: {},
    tagUsage: {},
  };

  if (sessions.length === 0) {
    return stats;
  }

  let oldestTime = Infinity;
  let newestTime = 0;
  let mostMessages = 0;

  for (const session of sessions) {
    // 累计统计
    stats.totalMessages += session.messageCount;
    stats.totalTokens += session.tokenUsage.total;
    stats.totalCost += session.cost || 0;

    // 模型使用统计
    stats.modelUsage[session.model] = (stats.modelUsage[session.model] || 0) + 1;

    // 标签使用统计
    if (session.tags) {
      for (const tag of session.tags) {
        stats.tagUsage[tag] = (stats.tagUsage[tag] || 0) + 1;
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

  // 计算平均值
  stats.averageMessagesPerSession = stats.totalMessages / sessions.length;
  stats.averageTokensPerSession = stats.totalTokens / sessions.length;

  return stats;
}

/**
 * 导出会话为 JSON
 */
export function exportSessionToJSON(session: SessionData): string {
  return JSON.stringify(session, null, 2);
}

/**
 * 从 JSON 导入会话
 */
export function importSessionFromJSON(json: string): SessionData {
  const session = JSON.parse(json) as SessionData;

  // 生成新的会话 ID
  const oldId = session.metadata.id;
  session.metadata.id = generateSessionId();
  session.metadata.createdAt = Date.now();
  session.metadata.updatedAt = Date.now();

  // 清除分支信息（因为是新会话）
  delete session.metadata.branches;

  // 如果有父会话引用，保留它
  // session.metadata.parentId 保持不变（如果存在）

  return session;
}

/**
 * 导出会话为文件
 */
export function exportSessionToFile(
  sessionId: string,
  filePath: string,
  format: 'json' | 'markdown' = 'json'
): boolean {
  const session = loadSession(sessionId);
  if (!session) {
    return false;
  }

  try {
    const content =
      format === 'json'
        ? exportSessionToJSON(session)
        : exportSessionToMarkdown(session);
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to export session to ${filePath}:`, err);
    return false;
  }
}

/**
 * 从文件导入会话
 */
export function importSessionFromFile(
  filePath: string,
  model?: string
): SessionData | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // 尝试 JSON 格式
    try {
      const session = importSessionFromJSON(content);
      return session;
    } catch {
      // 尝试 Markdown 格式
      if (!model) {
        console.error('Model must be specified for Markdown import');
        return null;
      }
      return importSessionFromMarkdown(content, model);
    }
  } catch (err) {
    console.error(`Failed to import session from ${filePath}:`, err);
    return null;
  }
}

/**
 * 重命名会话
 *
 * v2.1.19 修复：当从不同目录恢复会话时，使用 resumedTranscriptPath
 * 确保更新正确的会话文件
 */
export function renameSession(sessionId: string, newName: string): boolean {
  const session = loadSession(sessionId);
  if (!session) {
    return false;
  }

  session.metadata.name = newName;
  session.metadata.updatedAt = Date.now();
  // 使用 useResumedPath 确保更新正确的会话文件
  saveSession(session, { useResumedPath: true });
  return true;
}

/**
 * 更新会话标签
 *
 * v2.1.19 修复：当从不同目录恢复会话时，使用 resumedTranscriptPath
 * 确保更新正确的会话文件
 */
export function updateSessionTags(
  sessionId: string,
  tags: string[],
  mode: 'replace' | 'add' | 'remove' = 'replace'
): boolean {
  const session = loadSession(sessionId);
  if (!session) {
    return false;
  }

  const currentTags = session.metadata.tags || [];

  switch (mode) {
    case 'replace':
      session.metadata.tags = tags;
      break;
    case 'add':
      session.metadata.tags = Array.from(new Set([...currentTags, ...tags]));
      break;
    case 'remove':
      session.metadata.tags = currentTags.filter((t) => !tags.includes(t));
      break;
  }

  session.metadata.updatedAt = Date.now();
  // 使用 useResumedPath 确保更新正确的会话文件
  saveSession(session, { useResumedPath: true });
  return true;
}

/**
 * 搜索会话消息内容
 */
export function searchSessionMessages(
  query: string,
  options: {
    sessionId?: string;
    caseSensitive?: boolean;
    regex?: boolean;
  } = {}
): Array<{
  sessionId: string;
  sessionName?: string;
  messageIndex: number;
  message: Message;
  matches: string[];
}> {
  const results: Array<{
    sessionId: string;
    sessionName?: string;
    messageIndex: number;
    message: Message;
    matches: string[];
  }> = [];

  ensureSessionDir();

  // 如果指定了会话 ID，只搜索该会话
  const files = fs.readdirSync(getSessionDir()).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(getSessionDir(), file), 'utf-8');
      const session = JSON.parse(content) as SessionData;

      // 如果指定了会话 ID，跳过其他会话
      if (options.sessionId && session.metadata.id !== options.sessionId) {
        continue;
      }

      // 搜索消息
      session.messages.forEach((message, index) => {
        const messageText =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);

        let isMatch = false;
        const matches: string[] = [];

        if (options.regex) {
          const pattern = new RegExp(
            query,
            options.caseSensitive ? 'g' : 'gi'
          );
          const regexMatches = messageText.match(pattern);
          if (regexMatches) {
            isMatch = true;
            matches.push(...regexMatches);
          }
        } else {
          const searchText = options.caseSensitive
            ? messageText
            : messageText.toLowerCase();
          const searchQuery = options.caseSensitive
            ? query
            : query.toLowerCase();

          if (searchText.includes(searchQuery)) {
            isMatch = true;
            matches.push(query);
          }
        }

        if (isMatch) {
          results.push({
            sessionId: session.metadata.id,
            sessionName: session.metadata.name,
            messageIndex: index,
            message,
            matches,
          });
        }
      });
    } catch {
      // 忽略无法解析的文件
    }
  }

  return results;
}

/**
 * 批量删除会话
 */
export function bulkDeleteSessions(
  sessionIds: string[],
  options: { force?: boolean } = {}
): { deleted: string[]; failed: string[] } {
  const result = { deleted: [] as string[], failed: [] as string[] };

  for (const sessionId of sessionIds) {
    // 如果不是强制删除，检查是否有分支
    if (!options.force) {
      const session = loadSession(sessionId);
      if (session?.metadata.branches && session.metadata.branches.length > 0) {
        result.failed.push(sessionId);
        console.warn(
          `Session ${sessionId} has branches. Use force option to delete.`
        );
        continue;
      }
    }

    if (deleteSession(sessionId)) {
      result.deleted.push(sessionId);
    } else {
      result.failed.push(sessionId);
    }
  }

  return result;
}

/**
 * 清理过期和无效会话
 */
export function cleanupSessions(options: {
  deleteExpired?: boolean;
  deleteOrphaned?: boolean;
  dryRun?: boolean;
} = {}): {
  expired: string[];
  orphaned: string[];
  invalid: string[];
} {
  ensureSessionDir();

  const result = {
    expired: [] as string[],
    orphaned: [] as string[],
    invalid: [] as string[],
  };

  const files = fs.readdirSync(getSessionDir()).filter((f) => f.endsWith('.json'));
  const expiryTime = Date.now() - getSessionExpiryDays() * 24 * 60 * 60 * 1000;
  const allSessionIds = new Set<string>();

  // 第一遍：收集所有有效的会话 ID
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(getSessionDir(), file), 'utf-8');
      const session = JSON.parse(content) as SessionData;
      allSessionIds.add(session.metadata.id);
    } catch {
      // 无效文件
    }
  }

  // 第二遍：检查过期、孤立和无效的会话
  for (const file of files) {
    const sessionPath = path.join(getSessionDir(), file);

    try {
      const content = fs.readFileSync(sessionPath, 'utf-8');
      const session = JSON.parse(content) as SessionData;

      // 检查过期
      if (
        options.deleteExpired &&
        session.metadata.updatedAt < expiryTime
      ) {
        result.expired.push(session.metadata.id);
        if (!options.dryRun) {
          fs.unlinkSync(sessionPath);
        }
        continue;
      }

      // 检查孤立（父会话不存在）
      if (
        options.deleteOrphaned &&
        session.metadata.parentId &&
        !allSessionIds.has(session.metadata.parentId)
      ) {
        result.orphaned.push(session.metadata.id);
        if (!options.dryRun) {
          // 清除父会话引用而不是删除会话
          session.metadata.parentId = undefined;
          session.metadata.forkPoint = undefined;
          const repairContent = JSON.stringify(session, null, 2);
          const repairTmp = `${sessionPath}.tmp.${process.pid}.${Date.now()}`;
          try {
            fs.writeFileSync(repairTmp, repairContent, { flush: true });
            fs.renameSync(repairTmp, sessionPath);
          } catch {
            try { fs.unlinkSync(repairTmp); } catch { /* ignore */ }
            fs.writeFileSync(sessionPath, repairContent, { flush: true });
          }
        }
      }
    } catch {
      // 无效文件
      result.invalid.push(file);
      if (!options.dryRun) {
        fs.unlinkSync(sessionPath);
      }
    }
  }

  return result;
}

/**
 * 设置计划模式退出标志
 */
export function setPlanModeExited(session: SessionData, exited: boolean): void {
  session.metadata.hasExitedPlanMode = exited;
  if (exited) {
    session.metadata.needsPlanModeExitAttachment = true;
  }
}

/**
 * 检查是否需要计划模式退出附件
 */
export function needsPlanModeExitAttachment(session: SessionData): boolean {
  return session.metadata.needsPlanModeExitAttachment === true;
}

/**
 * 清除计划模式退出附件标志
 */
export function clearPlanModeExitAttachment(session: SessionData): void {
  session.metadata.needsPlanModeExitAttachment = false;
}

/**
 * 获取当前活跃的计划 ID
 */
export function getActivePlanId(session: SessionData): string | undefined {
  return session.metadata.activePlanId;
}

/**
 * 设置活跃的计划 ID
 */
export function setActivePlanId(session: SessionData, planId: string | undefined): void {
  session.metadata.activePlanId = planId;
  if (planId) {
    if (!session.metadata.planHistory) {
      session.metadata.planHistory = [];
    }
    if (!session.metadata.planHistory.includes(planId)) {
      session.metadata.planHistory.push(planId);
    }
  }
}

/**
 * 获取计划历史
 */
export function getPlanHistory(session: SessionData): string[] {
  return session.metadata.planHistory || [];
}

/**
 * SessionManager 配置接口
 *
 * 用于配置 SessionManager 的持久化和清理行为
 */
export interface SessionManagerConfig {
  /** 自动保存开关 */
  autoSave?: boolean;

  /** 自动保存间隔 (ms) */
  autoSaveIntervalMs?: number;

  /** 会话目录 */
  sessionDir?: string;

  /** 最大会话数 */
  maxSessions?: number;

  /** 会话过期天数 */
  sessionExpiryDays?: number;
}

/**
 * 会话管理器类
 */
export class SessionManager {
  private currentSession: SessionData | null = null;
  private autoSave: boolean;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private config: SessionManagerConfig;

  /**
   * SessionManager 构造函数
   *
   * @param config - SessionManager 配置对象
   *
   * @example
   * // 使用默认配置
   * const manager = new SessionManager();
   *
   * @example
   * // 自定义配置
   * const manager = new SessionManager({
   *   autoSave: true,
   *   autoSaveIntervalMs: 60000, // 1分钟
   *   maxSessions: 200,
   *   sessionExpiryDays: 60,
   * });
   */
  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      autoSave: config.autoSave ?? true,
      autoSaveIntervalMs: config.autoSaveIntervalMs ?? 30000,
      sessionDir: config.sessionDir || path.join(os.homedir(), '.axon', 'sessions'),
      maxSessions: config.maxSessions ?? 100,
      sessionExpiryDays: config.sessionExpiryDays ?? 30,
    };

    this.autoSave = this.config.autoSave;

    if (this.autoSave) {
      this.autoSaveInterval = setInterval(() => {
        this.save();
      }, this.config.autoSaveIntervalMs);
      this.autoSaveInterval.unref(); // 不阻止 Node.js 进程正常退出
    }
  }

  /**
   * 开始新会话
   */
  start(options: {
    name?: string;
    model: string;
    workingDirectory?: string;
    systemPrompt?: string;
    resume?: boolean;
  }): SessionData {
    // 如果要恢复，尝试加载最近的会话
    if (options.resume) {
      const recent = getSessionForDirectory(options.workingDirectory || process.cwd());
      if (recent) {
        this.currentSession = recent;
        return this.currentSession;
      }
    }

    this.currentSession = createSession(options);
    return this.currentSession;
  }

  /**
   * 恢复会话
   *
   * v2.1.19 修复：设置 resumedTranscriptPath
   * 确保 /rename 和 /tag 在从不同目录恢复时更新正确的会话文件
   */
  resume(sessionId: string): SessionData | null {
    const session = loadSession(sessionId);
    if (session) {
      this.currentSession = session;
      // v2.1.19: 设置恢复的会话路径，用于后续的 rename/tag 操作
      setResumedTranscriptPath(getSessionPath(sessionId));
    }
    return session;
  }

  /**
   * 获取当前会话
   */
  getCurrent(): SessionData | null {
    return this.currentSession;
  }

  /**
   * 添加消息
   */
  addMessage(
    message: Message,
    tokenUsage?: { input: number; output: number }
  ): void {
    if (this.currentSession) {
      addMessageToSession(this.currentSession, message, tokenUsage);
    }
  }

  /**
   * 保存当前会话
   */
  save(): void {
    if (this.currentSession) {
      saveSession(this.currentSession);
    }
  }

  /**
   * 结束会话
   */
  end(): void {
    this.save();
    this.currentSession = null;

    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  /**
   * 导出当前会话
   */
  export(format: 'json' | 'markdown' = 'markdown'): string | null {
    if (!this.currentSession) {
      return null;
    }
    return format === 'json'
      ? exportSessionToJSON(this.currentSession)
      : exportSessionToMarkdown(this.currentSession);
  }

  /**
   * Fork 当前会话
   */
  fork(options: ForkOptions = {}): SessionData | null {
    if (!this.currentSession) {
      return null;
    }

    const forkedSession = forkSession(this.currentSession.metadata.id, options);
    if (forkedSession) {
      // 切换到新的 fork 会话
      this.currentSession = forkedSession;
    }
    return forkedSession;
  }

  /**
   * 合并会话到当前会话
   */
  merge(sourceSessionId: string, options: MergeOptions = {}): boolean {
    if (!this.currentSession) {
      return false;
    }

    const merged = mergeSessions(
      this.currentSession.metadata.id,
      sourceSessionId,
      options
    );

    if (merged) {
      this.currentSession = merged;
      return true;
    }

    return false;
  }

  /**
   * 获取当前会话的分支树
   */
  getBranchTree(): {
    session: SessionMetadata;
    parent?: SessionMetadata;
    branches: SessionMetadata[];
  } | null {
    if (!this.currentSession) {
      return null;
    }
    return getSessionBranchTree(this.currentSession.metadata.id);
  }

  /**
   * 重命名当前会话
   */
  rename(newName: string): boolean {
    if (!this.currentSession) {
      return false;
    }

    this.currentSession.metadata.name = newName;
    this.currentSession.metadata.updatedAt = Date.now();
    this.save();
    return true;
  }

  /**
   * 更新当前会话的标签
   */
  updateTags(tags: string[], mode: 'replace' | 'add' | 'remove' = 'replace'): boolean {
    if (!this.currentSession) {
      return false;
    }

    const currentTags = this.currentSession.metadata.tags || [];

    switch (mode) {
      case 'replace':
        this.currentSession.metadata.tags = tags;
        break;
      case 'add':
        this.currentSession.metadata.tags = Array.from(new Set([...currentTags, ...tags]));
        break;
      case 'remove':
        this.currentSession.metadata.tags = currentTags.filter((t) => !tags.includes(t));
        break;
    }

    this.currentSession.metadata.updatedAt = Date.now();
    this.save();
    return true;
  }

  /**
   * 搜索当前会话的消息
   */
  searchMessages(
    query: string,
    options: {
      caseSensitive?: boolean;
      regex?: boolean;
    } = {}
  ): Array<{
    sessionId: string;
    sessionName?: string;
    messageIndex: number;
    message: Message;
    matches: string[];
  }> {
    if (!this.currentSession) {
      return [];
    }

    return searchSessionMessages(query, {
      ...options,
      sessionId: this.currentSession.metadata.id,
    });
  }

  /**
   * 导出当前会话到文件
   */
  exportToFile(filePath: string, format: 'json' | 'markdown' = 'json'): boolean {
    if (!this.currentSession) {
      return false;
    }

    return exportSessionToFile(
      this.currentSession.metadata.id,
      filePath,
      format
    );
  }

  /**
   * 更新会话成本
   */
  updateCost(inputTokens: number, outputTokens: number, model?: string): void {
    if (!this.currentSession) {
      return;
    }

    // 简化的成本计算（实际应该根据模型定价）
    const modelName = model || this.currentSession.metadata.model;
    let costPerMillion = { input: 3, output: 15 }; // 默认 Sonnet 定价

    // 根据模型调整定价
    if (modelName.includes('opus')) {
      costPerMillion = { input: 15, output: 75 };
    } else if (modelName.includes('haiku')) {
      costPerMillion = { input: 0.25, output: 1.25 };
    }

    const cost =
      (inputTokens / 1_000_000) * costPerMillion.input +
      (outputTokens / 1_000_000) * costPerMillion.output;

    this.currentSession.metadata.cost =
      (this.currentSession.metadata.cost || 0) + cost;
  }

  /**
   * 获取会话摘要
   */
  getSummary(): {
    id: string;
    name?: string;
    messageCount: number;
    tokenUsage: { input: number; output: number; total: number };
    cost?: number;
    createdAt: Date;
    updatedAt: Date;
    model: string;
    tags?: string[];
    hasBranches: boolean;
    branchCount: number;
  } | null {
    if (!this.currentSession) {
      return null;
    }

    const metadata = this.currentSession.metadata;

    return {
      id: metadata.id,
      name: metadata.name,
      messageCount: metadata.messageCount,
      tokenUsage: metadata.tokenUsage,
      cost: metadata.cost,
      createdAt: new Date(metadata.createdAt),
      updatedAt: new Date(metadata.updatedAt),
      model: metadata.model,
      tags: metadata.tags,
      hasBranches: !!metadata.branches && metadata.branches.length > 0,
      branchCount: metadata.branches?.length || 0,
    };
  }

  /**
   * 获取会话目录
   */
  getSessionDir(): string {
    return this.config.sessionDir!;
  }

  /**
   * 获取最大会话数
   */
  getMaxSessions(): number {
    return this.config.maxSessions!;
  }

  /**
   * 获取会话过期天数
   */
  getSessionExpiryDays(): number {
    return this.config.sessionExpiryDays!;
  }

  /**
   * 获取自动保存间隔 (ms)
   */
  getAutoSaveIntervalMs(): number | undefined {
    return this.config.autoSaveIntervalMs;
  }

  /**
   * 是否启用自动保存
   */
  isAutoSaveEnabled(): boolean {
    return this.autoSave;
  }

  /**
   * 获取配置副本
   */
  getConfig(): SessionManagerConfig {
    return { ...this.config };
  }
}

// 默认实例（懒加载，避免模块级副作用导致测试环境崩溃）
let _sessionManager: SessionManager | null = null;
export function getSessionManagerInstance(): SessionManager {
  if (!_sessionManager) {
    const config = configManager.getAll();
    _sessionManager = new SessionManager(config.sessionManager || {});
  }
  return _sessionManager;
}
// 保持向后兼容的导出（通过 getter 延迟初始化）
export const sessionManager: SessionManager = new Proxy({} as SessionManager, {
  get(_target, prop, receiver) {
    const instance = getSessionManagerInstance();
    const value = Reflect.get(instance, prop, instance);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_target, prop, value) {
    const instance = getSessionManagerInstance();
    return Reflect.set(instance, prop, value);
  },
});

// 导出增强的列表功能
export {
  listSessionsEnhanced,
  getSessionDetails,
  searchSessions,
  bulkDeleteSessionsEnhanced,
  bulkExportSessions,
  bulkArchiveSessions,
  exportSession,
  exportMultipleSessions,
  getListStatistics,
  generateSessionReport,
  archiveSession,
  clearSessionCache,
} from './list.js';

export type {
  SessionFilter,
  SessionSummary,
  SessionDetails,
  ListSessionsResult,
  ExportOptions,
} from './list.js';

// ============ v2.1.27: PR 链接功能 ============

/**
 * 解析 GitHub PR URL
 *
 * 官方 mxY() 函数实现
 *
 * @param urlOrNumber PR URL 或编号
 * @returns PR 信息对象，如果解析失败返回 null
 */
export function parseGitHubPrUrl(urlOrNumber: string): {
  prNumber: number;
  prUrl: string;
  prRepository: string;
} | null {
  // 尝试解析完整 URL
  const urlMatch = urlOrNumber.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (urlMatch?.[1] && urlMatch?.[2]) {
    return {
      prNumber: parseInt(urlMatch[2], 10),
      prUrl: urlOrNumber,
      prRepository: urlMatch[1],
    };
  }

  // 尝试解析纯数字
  const numMatch = urlOrNumber.match(/^(\d+)$/);
  if (numMatch?.[1]) {
    return {
      prNumber: parseInt(numMatch[1], 10),
      prUrl: '', // 需要通过 gh cli 获取完整 URL
      prRepository: '', // 需要通过 git remote 获取
    };
  }

  return null;
}

/**
 * 将 PR 链接到会话
 *
 * 官方 TeY() 函数实现
 *
 * @param sessionId 会话 ID
 * @param prNumber PR 号
 * @param prUrl PR URL
 * @param prRepository 仓库名称
 */
export function linkSessionToPr(
  sessionId: string,
  prNumber: number,
  prUrl?: string,
  prRepository?: string
): boolean {
  const session = loadSession(sessionId);
  if (!session) {
    return false;
  }

  session.metadata.prNumber = prNumber;
  if (prUrl) {
    session.metadata.prUrl = prUrl;
  }
  if (prRepository) {
    session.metadata.prRepository = prRepository;
  }
  session.metadata.updatedAt = Date.now();
  saveSession(session);

  // 发送遥测事件
  if (process.env.DEBUG) {
    console.log(`[Session] Linked session ${sessionId} to PR #${prNumber}`);
  }

  return true;
}

/**
 * 获取与 PR 关联的会话列表
 *
 * @param prNumber PR 号
 * @param prRepository 可选的仓库名称过滤
 * @returns 匹配的会话元数据列表
 */
export function getSessionsByPr(
  prNumber: number,
  prRepository?: string
): SessionMetadata[] {
  const allSessions = listSessions({ limit: 1000 });

  return allSessions.filter((session) => {
    if (session.prNumber !== prNumber) {
      return false;
    }
    if (prRepository && session.prRepository !== prRepository) {
      return false;
    }
    return true;
  });
}

/**
 * 通过 PR 号或 URL 查找会话
 *
 * @param prIdentifier PR 号或 URL
 * @returns 最近的匹配会话，如果没有找到返回 null
 */
export function findSessionByPr(prIdentifier: string | number): SessionData | null {
  let prNumber: number;
  let prRepository: string | undefined;

  if (typeof prIdentifier === 'number') {
    prNumber = prIdentifier;
  } else {
    const parsed = parseGitHubPrUrl(prIdentifier);
    if (!parsed) {
      return null;
    }
    prNumber = parsed.prNumber;
    prRepository = parsed.prRepository || undefined;
  }

  const sessions = getSessionsByPr(prNumber, prRepository);
  if (sessions.length === 0) {
    return null;
  }

  // 返回最近更新的会话
  const sortedSessions = sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return loadSession(sortedSessions[0].id);
}

/**
 * 从 gh pr create 输出中提取 PR 信息
 *
 * @param output gh pr create 命令的输出
 * @returns PR 信息对象，如果解析失败返回 null
 */
export function parsePrCreateOutput(output: string): {
  prNumber: number;
  prUrl: string;
  prRepository: string;
} | null {
  // gh pr create 输出格式：https://github.com/owner/repo/pull/123
  const match = output.match(/https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (match?.[1] && match?.[2]) {
    return {
      prNumber: parseInt(match[2], 10),
      prUrl: match[0],
      prRepository: match[1],
    };
  }
  return null;
}

/**
 * 设置会话的 git 分支
 *
 * @param sessionId 会话 ID
 * @param branch 分支名称
 */
export function setSessionGitBranch(sessionId: string, branch: string): boolean {
  const session = loadSession(sessionId);
  if (!session) {
    return false;
  }

  session.metadata.gitBranch = branch;
  session.metadata.updatedAt = Date.now();
  saveSession(session);
  return true;
}

// ============ 导出新增模块 ============
export * from './resume.js';
export * from './cleanup.js';
