/**
 * 文件操作 API (file-operation/*)
 * 从 blueprint-api.ts 拆出的独立路由模块
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();

/**
 * POST /file-operation/create
 */
router.post('/file-operation/create', (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;

    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Missing file path' });
    }

    const cwd = process.cwd();
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(fullPath)) {
      return res.status(400).json({ success: false, error: 'File already exists' });
    }

    fs.writeFileSync(fullPath, content || '', 'utf-8');
    res.json({ success: true, data: { path: filePath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /file-operation/mkdir
 */
router.post('/file-operation/mkdir', (req: Request, res: Response) => {
  try {
    const { path: dirPath } = req.body;

    if (!dirPath) {
      return res.status(400).json({ success: false, error: 'Missing directory path' });
    }

    const cwd = process.cwd();
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(cwd, dirPath);

    if (fs.existsSync(fullPath)) {
      return res.status(400).json({ success: false, error: 'Directory already exists' });
    }

    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true, data: { path: dirPath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /file-operation/delete
 */
router.post('/file-operation/delete', (req: Request, res: Response) => {
  try {
    const { path: targetPath } = req.body;

    if (!targetPath) {
      return res.status(400).json({ success: false, error: 'Missing path' });
    }

    const cwd = process.cwd();
    const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'File or directory does not exist' });
    }

    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }

    res.json({ success: true, data: { path: targetPath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /file-operation/rename
 */
router.post('/file-operation/rename', (req: Request, res: Response) => {
  try {
    const { oldPath, newPath } = req.body;

    if (!oldPath || !newPath) {
      return res.status(400).json({ success: false, error: 'Missing path parameter' });
    }

    const cwd = process.cwd();
    const fullOldPath = path.isAbsolute(oldPath) ? oldPath : path.join(cwd, oldPath);
    const fullNewPath = path.isAbsolute(newPath) ? newPath : path.join(cwd, newPath);

    if (!fs.existsSync(fullOldPath)) {
      return res.status(404).json({ success: false, error: 'Source file or directory does not exist' });
    }

    if (fs.existsSync(fullNewPath)) {
      return res.status(400).json({ success: false, error: 'Target already exists' });
    }

    fs.renameSync(fullOldPath, fullNewPath);
    res.json({ success: true, data: { path: newPath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /file-operation/copy
 */
router.post('/file-operation/copy', (req: Request, res: Response) => {
  try {
    const { sourcePath, destPath } = req.body;

    if (!sourcePath || !destPath) {
      return res.status(400).json({ success: false, error: 'Missing path parameter' });
    }

    const cwd = process.cwd();
    const fullSourcePath = path.isAbsolute(sourcePath) ? sourcePath : path.join(cwd, sourcePath);
    const fullDestPath = path.isAbsolute(destPath) ? destPath : path.join(cwd, destPath);

    if (!fs.existsSync(fullSourcePath)) {
      return res.status(404).json({ success: false, error: 'Source file or directory does not exist' });
    }

    const destDir = path.dirname(fullDestPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.cpSync(fullSourcePath, fullDestPath, { recursive: true });
    res.json({ success: true, data: { path: destPath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /file-operation/move
 */
router.post('/file-operation/move', (req: Request, res: Response) => {
  try {
    const { sourcePath, destPath } = req.body;

    if (!sourcePath || !destPath) {
      return res.status(400).json({ success: false, error: 'Missing path parameter' });
    }

    const cwd = process.cwd();
    const fullSourcePath = path.isAbsolute(sourcePath) ? sourcePath : path.join(cwd, sourcePath);
    const fullDestPath = path.isAbsolute(destPath) ? destPath : path.join(cwd, destPath);

    if (!fs.existsSync(fullSourcePath)) {
      return res.status(404).json({ success: false, error: 'Source file or directory does not exist' });
    }

    const destDir = path.dirname(fullDestPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.renameSync(fullSourcePath, fullDestPath);
    res.json({ success: true, data: { path: destPath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
