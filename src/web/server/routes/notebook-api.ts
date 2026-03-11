/**
 * Notebook API 路由
 * 
 * 管理 AI 可定制属性文件：
 * - profile.md   — 用户画像 (~/.axon/memory/profile.md)
 * - experience.md — AI 经验 (~/.axon/memory/experience.md)
 * - project.md   — 项目知识 (~/.axon/memory/projects/<hash>/project.md)
 * - AXON.md      — 项目级 AI 指令 (项目根目录/AXON.md)
 */

import { Router, Request, Response } from 'express';
import { initNotebookManager, getNotebookManagerForProject, type NotebookType } from '../../../memory/notebook.js';
import { findClaudeMd } from '../../../rules/index.js';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

/**
 * 从请求获取项目路径
 */
function getProjectPath(req: Request): string {
  return (req.query.project as string) || (req.body?.project as string) || process.cwd();
}

/**
 * 确保项目有 NotebookManager 实例
 */
function ensureManager(projectPath: string) {
  let mgr = getNotebookManagerForProject(projectPath);
  if (!mgr) {
    mgr = initNotebookManager(projectPath);
  }
  return mgr;
}

/**
 * GET /api/notebook/list
 * 返回所有可管理的 MD 文件列表及其基本信息
 */
router.get('/list', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectPath(req);
    const mgr = ensureManager(projectPath);
    const stats = mgr.getStats();

    // 查找 AXON.md
    const axonMdPath = findClaudeMd(projectPath);
    let axonMdInfo = null;
    if (axonMdPath && fs.existsSync(axonMdPath)) {
      const st = fs.statSync(axonMdPath);
      axonMdInfo = {
        path: axonMdPath,
        size: st.size,
        lastModified: st.mtime.toISOString(),
      };
    }

    res.json({
      success: true,
      data: {
        notebooks: {
          profile: {
            ...stats.profile,
            maxTokens: 2000,
            description: 'User profile — name, preferences, contact info',
          },
          experience: {
            ...stats.experience,
            maxTokens: 4000,
            description: 'Cross-project experience — working patterns, lessons learned',
          },
          project: {
            ...stats.project,
            maxTokens: 8000,
            description: 'Project-specific knowledge — architecture, gotchas, decisions',
          },
          identity: {
            ...stats.identity,
            maxTokens: 2000,
            description: 'AI personality — tone, style, quirks, catchphrases',
          },
          'tools-notes': {
            ...stats['tools-notes'],
            maxTokens: 2000,
            description: 'Tool usage notes — conventions, preferences, local toolchain',
          },
        },
        axonMd: axonMdInfo,
        projectPath,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/notebook/read?type=profile|experience|project
 * 读取指定笔记本内容
 */
router.get('/read', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string;
    const projectPath = getProjectPath(req);

    if (type === 'axonmd') {
      // 读取 AXON.md
      const axonMdPath = findClaudeMd(projectPath);
      if (!axonMdPath || !fs.existsSync(axonMdPath)) {
        return res.json({ success: true, data: { content: '', path: null, exists: false } });
      }
      const content = fs.readFileSync(axonMdPath, 'utf-8');
      return res.json({ success: true, data: { content, path: axonMdPath, exists: true } });
    }

    if (!['profile', 'experience', 'project', 'identity', 'tools-notes'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid type. Must be profile, experience, project, identity, tools-notes, or axonmd.' });
    }

    const mgr = ensureManager(projectPath);
    const content = mgr.read(type as NotebookType);
    const filePath = mgr.getPath(type as NotebookType);

    res.json({
      success: true,
      data: {
        content,
        path: filePath,
        exists: content.trim().length > 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/notebook/write
 * 写入指定笔记本内容
 * Body: { type: string, content: string, project?: string }
 */
router.put('/write', async (req: Request, res: Response) => {
  try {
    const { type, content } = req.body;
    const projectPath = getProjectPath(req);

    if (type === 'axonmd') {
      // 写入 AXON.md
      let axonMdPath = findClaudeMd(projectPath);
      if (!axonMdPath) {
        // 不存在则在项目根目录创建
        axonMdPath = path.join(projectPath, 'AXON.md');
      }
      fs.writeFileSync(axonMdPath, content, 'utf-8');
      return res.json({ success: true, data: { path: axonMdPath } });
    }

    if (!['profile', 'experience', 'project', 'identity', 'tools-notes'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid type. Must be profile, experience, project, identity, tools-notes, or axonmd.' });
    }

    if (typeof content !== 'string') {
      return res.status(400).json({ success: false, error: 'Content must be a string.' });
    }

    const mgr = ensureManager(projectPath);
    const result = mgr.write(type as NotebookType, content);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
