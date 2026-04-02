/**
 * Vector DB API 路由
 *
 * 向量数据库内容管理：
 * - 统计信息（文件数、chunk数、DB大小、embedding状态）
 * - 已索引文件列表
 * - Chunk 列表（按文件）
 * - 搜索测试
 * - 触发同步
 * - 删除已索引文件
 */

import { Router, Request, Response } from 'express';
import {
  ensureMemorySearchManager,
  getMemorySearchManager,
} from '../../../memory/memory-search.js';
import * as crypto from 'crypto';

const router = Router();

/**
 * 从请求获取项目路径
 */
function getProjectPath(req: Request): string {
  return (req.query.project as string) || (req.body?.project as string) || process.cwd();
}

function hashProjectPath(projectPath: string): string {
  return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
}

/**
 * 确保有 MemorySearchManager 实例
 */
async function ensureManager(projectPath: string) {
  return ensureMemorySearchManager(projectPath);
}

/**
 * GET /api/vectordb/status
 * 返回向量数据库状态和统计信息
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const mgr = await ensureManager(projectPath);
    const status = mgr.status();

    res.json({
      success: true,
      data: {
        totalFiles: status.totalFiles,
        totalChunks: status.totalChunks,
        dbSizeBytes: status.dbSizeBytes,
        dbSizeMB: +(status.dbSizeBytes / (1024 * 1024)).toFixed(2),
        dirty: status.dirty,
        hasEmbeddings: status.hasEmbeddings ?? false,
        chunksWithoutEmbedding: status.chunksWithoutEmbedding ?? 0,
        embeddingStats: status.embeddingStats ?? null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/vectordb/files
 * 返回已索引的文件列表
 */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const source = req.query.source as string | undefined;
    const mgr = await ensureManager(projectPath);
    const store = mgr.getStore();

    const filePaths = store.listFilePaths(source as any);

    res.json({
      success: true,
      data: {
        files: filePaths,
        total: filePaths.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/vectordb/chunks?file=xxx
 * 返回指定文件的 chunk 列表
 */
router.get('/chunks', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const filePath = req.query.file as string;
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Missing file parameter' });
    }

    const mgr = await ensureManager(projectPath);
    const store = mgr.getStore();
    const chunkTexts = store.getChunkTexts([]);

    // 直接查询 chunks 表获取指定文件的 chunk
    const chunks = (store as any).db.prepare(
      'SELECT id, start_line, end_line, text, embedding IS NOT NULL as has_embedding, created_at FROM chunks WHERE path = ? ORDER BY start_line'
    ).all(filePath) as Array<{
      id: string;
      start_line: number;
      end_line: number;
      text: string;
      has_embedding: number;
      created_at: number;
    }>;

    res.json({
      success: true,
      data: {
        file: filePath,
        chunks: chunks.map(c => ({
          id: c.id,
          startLine: c.start_line,
          endLine: c.end_line,
          preview: c.text.length > 150 ? c.text.substring(0, 150) + '...' : c.text,
          length: c.text.length,
          hasEmbedding: !!c.has_embedding,
          createdAt: new Date(c.created_at).toISOString(),
        })),
        total: chunks.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vectordb/search
 * 搜索测试
 * Body: { query: string, mode?: 'hybrid' | 'keyword', maxResults?: number }
 */
router.post('/search', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const { query, mode, maxResults } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing query parameter' });
    }

    const mgr = await ensureManager(projectPath);
    const results = await mgr.recall(query, maxResults ?? 10, {
      mode: mode || 'hybrid',
      source: 'all',
    });

    // 也返回结构化结果
    let structuredResults: any[] = [];
    if (mode === 'keyword') {
      structuredResults = mgr.search(query, { source: 'all', maxResults: maxResults ?? 10 });
    } else {
      structuredResults = await mgr.hybridSearch(query, { source: 'all', maxResults: maxResults ?? 10 });
    }

    res.json({
      success: true,
      data: {
        formatted: results,
        results: structuredResults.map(r => ({
          id: r.id,
          path: r.path,
          score: +r.score.toFixed(4),
          snippet: r.snippet,
          source: r.source,
          timestamp: r.timestamp,
          startLine: r.startLine,
          endLine: r.endLine,
        })),
        total: structuredResults.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vectordb/sync
 * 触发同步
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const mgr = await ensureManager(projectPath);
    await mgr.sync('manual-ui');
    const status = mgr.status();

    res.json({
      success: true,
      data: {
        totalFiles: status.totalFiles,
        totalChunks: status.totalChunks,
        hasEmbeddings: status.hasEmbeddings ?? false,
        chunksWithoutEmbedding: status.chunksWithoutEmbedding ?? 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/vectordb/file
 * 删除已索引的文件
 * Body: { path: string }
 */
router.delete('/file', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const filePath = req.body.path || req.query.path as string;

    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Missing path parameter' });
    }

    const mgr = await ensureManager(projectPath);
    const store = mgr.getStore();
    store.removeFile(filePath);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/vectordb/reindex
 * 重新索引缺失 embedding 的 chunks
 */
router.post('/reindex', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const mgr = await ensureManager(projectPath);
    const indexed = await mgr.reindexEmbeddings();
    const status = mgr.status();

    res.json({
      success: true,
      data: {
        indexed,
        chunksWithoutEmbedding: status.chunksWithoutEmbedding ?? 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
