/**
 * Artifacts API — Backend route for aggregating file artifacts across sessions
 *
 * Scans all session chat histories for Edit/Write/MultiEdit tool_use blocks.
 * Returns data grouped by session, with same-file operations merged.
 *
 * Mounted at: /api/artifacts
 */

import * as path from 'path';
import { Router, type Request, type Response } from 'express';
import type { ConversationManager } from '../conversation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single raw tool operation (before merging) */
interface RawOp {
  toolName: 'Edit' | 'Write' | 'MultiEdit';
  timestamp: number;
  status: string;
  added: number;
  removed: number;
  contentPreview?: string;
}

/** A file with its merged operations within one session */
interface ArtifactFile {
  filePath: string;           // relative to project root
  ops: number;                // total operation count
  toolNames: string[];        // unique tool names used (e.g. ['Edit', 'Write'])
  added: number;              // total lines added
  removed: number;            // total lines removed
  latestTimestamp: number;
  contentPreview?: string;    // from the latest Write, if any
}

/** A session group containing its merged files */
interface ArtifactSession {
  sessionId: string;
  sessionName: string;
  latestTimestamp: number;
  files: ArtifactFile[];
}

interface ArtifactsResponse {
  sessions: ArtifactSession[];
  stats: {
    totalFiles: number;
    totalEdits: number;
    totalWrites: number;
    sessionCount: number;
  };
}

// ---------------------------------------------------------------------------
// In-memory cache (30-second TTL)
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: ArtifactsResponse;
  timestamp: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function getCacheKey(params: {
  sessionLimit: number;
  search: string;
  type: string;
}): string {
  return `${params.sessionLimit}:${params.search}:${params.type}`;
}

function getCached(key: string): ArtifactsResponse | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: ArtifactsResponse): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ARTIFACT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit']);
const SUBAGENT_HOST_TOOLS = new Set(['Task', 'ScheduleTask']);

function countLines(s: string | undefined | null): number {
  if (!s) return 0;
  return s.split('\n').length;
}

const PREVIEW_MAX_LENGTH = 200;

/**
 * Extract raw operations from a tool_use block (including subagent calls).
 */
function extractOps(
  block: any,
  timestamp: number,
): Array<{ filePath: string; op: RawOp }> {
  const results: Array<{ filePath: string; op: RawOp }> = [];

  function processOne(name: string, input: any, status: string, ts: number) {
    if (!ARTIFACT_TOOL_NAMES.has(name) || !input?.file_path) return;

    const op: RawOp = {
      toolName: name as RawOp['toolName'],
      timestamp: ts,
      status: status || 'unknown',
      added: 0,
      removed: 0,
    };

    if (name === 'Write' && typeof input.content === 'string') {
      op.contentPreview = input.content.slice(0, PREVIEW_MAX_LENGTH);
      op.added = countLines(input.content);
    } else if (name === 'Edit') {
      op.added = countLines(input.new_string);
      op.removed = countLines(input.old_string);
    } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
      for (const edit of input.edits) {
        op.added += countLines(edit.new_string);
        op.removed += countLines(edit.old_string);
      }
    }

    results.push({ filePath: input.file_path, op });
  }

  processOne(block.name, block.input, block.status, timestamp);

  if (SUBAGENT_HOST_TOOLS.has(block.name) && Array.isArray(block.subagentToolCalls)) {
    for (const sub of block.subagentToolCalls) {
      processOne(sub.name, sub.input, sub.status, sub.startTime || timestamp);
    }
  }

  return results;
}

/**
 * Make a file path relative to the project root.
 */
function toRelativePath(filePath: string, projectRoot: string): string {
  // Normalize both paths for cross-platform
  const normalizedFile = filePath.replace(/\\/g, '/');
  const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  
  if (normalizedFile.startsWith(normalizedRoot)) {
    return normalizedFile.slice(normalizedRoot.length);
  }
  // If not under project root, return as-is
  return normalizedFile;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * GET / — List all file artifacts across sessions, grouped by session, files merged.
 *
 * Query parameters:
 *   sessionLimit — max sessions to scan (default 20)
 *   search       — case-insensitive substring match on filePath
 *   type         — 'all' | 'edit' | 'write' (default 'all')
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const conversationManager: ConversationManager = req.app.locals.conversationManager;
    const sessionManager = conversationManager.getSessionManager();

    const sessionLimit = Math.max(1, parseInt(req.query.sessionLimit as string, 10) || 20);
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const type = ((req.query.type as string) || 'all').toLowerCase();

    // Check cache
    const cacheKey = getCacheKey({ sessionLimit, search, type });
    const cached = getCached(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    // Project root for relative paths
    const projectRoot = process.cwd();

    // List recent sessions
    const sessionMetadataList = sessionManager.listSessions({
      limit: sessionLimit,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    const sessions: ArtifactSession[] = [];
    let totalEdits = 0;
    let totalWrites = 0;
    const allFiles = new Set<string>();

    for (const meta of sessionMetadataList) {
      const session = sessionManager.loadSessionById(meta.id);
      if (!session) continue;

      const chatHistory = (session as any).chatHistory;
      if (!chatHistory || !Array.isArray(chatHistory)) continue;

      // Collect all raw ops for this session, keyed by relative file path
      const fileOpsMap = new Map<string, RawOp[]>();

      for (const msg of chatHistory) {
        if (!msg.content || !Array.isArray(msg.content)) continue;

        for (const block of msg.content) {
          if (block.type !== 'tool_use') continue;

          const ops = extractOps(block, msg.timestamp);
          for (const { filePath, op } of ops) {
            const relPath = toRelativePath(filePath, projectRoot);

            // Type filter
            if (type === 'edit' && op.toolName === 'Write') continue;
            if (type === 'write' && (op.toolName === 'Edit' || op.toolName === 'MultiEdit')) continue;

            // Search filter
            if (search && !relPath.toLowerCase().includes(search)) continue;

            const existing = fileOpsMap.get(relPath) || [];
            existing.push(op);
            fileOpsMap.set(relPath, existing);
          }
        }
      }

      if (fileOpsMap.size === 0) continue;

      // Merge ops per file
      const files: ArtifactFile[] = [];
      let sessionLatest = 0;

      for (const [relPath, ops] of fileOpsMap) {
        allFiles.add(relPath);

        const toolNameSet = new Set<string>();
        let added = 0, removed = 0, latest = 0;
        let lastWritePreview: string | undefined;

        for (const op of ops) {
          toolNameSet.add(op.toolName);
          added += op.added;
          removed += op.removed;
          if (op.timestamp > latest) latest = op.timestamp;
          if (op.toolName === 'Write') totalWrites++;
          else totalEdits++;
          if (op.toolName === 'Write' && op.contentPreview) {
            lastWritePreview = op.contentPreview;
          }
        }

        if (latest > sessionLatest) sessionLatest = latest;

        files.push({
          filePath: relPath,
          ops: ops.length,
          toolNames: Array.from(toolNameSet),
          added,
          removed,
          latestTimestamp: latest,
          contentPreview: lastWritePreview,
        });
      }

      // Sort files within session: by timestamp descending
      files.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

      sessions.push({
        sessionId: meta.id,
        sessionName: meta.name || meta.id,
        latestTimestamp: sessionLatest,
        files,
      });
    }

    // Sort sessions by latest timestamp descending
    sessions.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

    const response: ArtifactsResponse = {
      sessions,
      stats: {
        totalFiles: allFiles.size,
        totalEdits,
        totalWrites,
        sessionCount: sessions.length,
      },
    };

    setCache(cacheKey, response);
    res.json(response);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * Clear the in-memory cache. Exported for testing purposes.
 */
export function clearArtifactsCache(): void {
  cache.clear();
}

export default router;
