/**
 * Schedule API - 定时任务管理 REST API
 * 提供任务列表、获取、删除、启用/禁用切换、执行历史等接口
 */

import express from 'express';
import { TaskStore } from '../../../daemon/store.js';
import { readRunLogEntries } from '../../../daemon/run-log.js';

const router = express.Router();
const store = new TaskStore();

// GET /api/schedule/tasks - 列出所有任务
router.get('/tasks', (_req, res) => {
  try {
    const tasks = store.listTasks();
    res.json({ success: true, data: tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/schedule/tasks/:id - 获取单个任务
router.get('/tasks/:id', (req, res) => {
  try {
    const task = store.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, data: task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// DELETE /api/schedule/tasks/:id - 删除任务
router.delete('/tasks/:id', (req, res) => {
  try {
    const removed = store.removeTask(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    store.signalReload();
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/schedule/tasks/:id/toggle - 启用/禁用切换
router.post('/tasks/:id/toggle', (req, res) => {
  try {
    const task = store.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const updated = store.updateTask(req.params.id, { enabled: !task.enabled });
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to update task' });
    }
    store.signalReload();
    res.json({ success: true, data: { enabled: !task.enabled } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/schedule/tasks/:id/history - 获取执行历史
router.get('/tasks/:id/history', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const entries = readRunLogEntries(req.params.id, { limit });
    res.json({ success: true, data: entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

export default router;
