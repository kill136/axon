/**
 * Schedule API - 定时任务管理 REST API
 * 提供任务列表、获取、删除、启用/禁用切换、执行历史等接口
 */

import express from 'express';
import { randomUUID } from 'crypto';
import { TaskStore } from '../../../daemon/store.js';
import { readRunLogEntries } from '../../../daemon/run-log.js';
import { broadcastMessage } from '../websocket.js';
import { getWebScheduler } from '../web-scheduler.js';
import { webAuth } from '../web-auth.js';
import { normalizeWebRuntimeModelForBackend } from '../../shared/model-catalog.js';

const router = express.Router();

// 使用 WebScheduler 的 store 实例（避免多实例竞态覆盖 daemon-tasks.json）
// fallback 到独立 TaskStore（仅在 WebScheduler 未启动时）
function getStore(): TaskStore {
  const ws = getWebScheduler();
  return ws ? ws.getStore() : new TaskStore();
}

// GET /api/schedule/tasks - 列出所有任务
router.get('/tasks', (_req, res) => {
  try {
    const tasks = getStore().listTasks();
    res.json({ success: true, data: tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/schedule/tasks - 创建新任务
router.post('/tasks', (req, res) => {
  try {
    const { type, name, prompt, model, triggerAt, intervalMs, watchPaths, notifyChannels } = req.body;
    
    // 基础字段验证
    if (!type || !['once', 'interval', 'watch'].includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid task type' });
    }
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ success: false, error: 'Task name is required' });
    }
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({ success: false, error: 'Prompt is required' });
    }
    
    // 类型特定验证
    if (type === 'once' && (!triggerAt || typeof triggerAt !== 'number' || triggerAt <= 0)) {
      return res.status(400).json({ success: false, error: 'Valid triggerAt is required for once type' });
    }
    if (type === 'interval' && (!intervalMs || typeof intervalMs !== 'number' || intervalMs <= 0)) {
      return res.status(400).json({ success: false, error: 'Valid intervalMs is required for interval type' });
    }
    if (type === 'watch' && (!watchPaths || !Array.isArray(watchPaths) || watchPaths.length === 0)) {
      return res.status(400).json({ success: false, error: 'Watch paths are required for watch type' });
    }
    
    // 构造任务数据
    const runtimeBackend = webAuth.getRuntimeBackend();
    const customModelName = webAuth.getDefaultModelByBackend()[runtimeBackend] || webAuth.getCustomModelName();

    const taskData: any = {
      id: randomUUID(),
      type,
      name: name.trim(),
      prompt: prompt.trim(),
      model: normalizeWebRuntimeModelForBackend(runtimeBackend, model, customModelName),
      enabled: true,
      createdAt: Date.now(),
      createdBy: 'web-ui',
      workingDir: process.cwd(),
      notify: Array.isArray(notifyChannels) ? notifyChannels : [],
    };
    
    // 添加类型特定字段
    if (type === 'once' && triggerAt) {
      taskData.triggerAt = triggerAt;
    }
    if (type === 'interval' && intervalMs) {
      taskData.intervalMs = intervalMs;
    }
    if (type === 'watch' && watchPaths) {
      taskData.watchPaths = watchPaths;
    }
    
    const store = getStore();
    const created = store.addTask(taskData);
    store.signalReload();
    
    // 通知 WebScheduler 热加载
    const ws = getWebScheduler();
    if (ws) ws.onTaskCreated();
    
    // 广播任务创建事件
    broadcastMessage({
      type: 'schedule:task_created',
      payload: { task: created },
    });
    
    res.json({ success: true, data: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// GET /api/schedule/tasks/:id - 获取单个任务
router.get('/tasks/:id', (req, res) => {
  try {
    const task = getStore().getTask(req.params.id);
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
    const store = getStore();
    const removed = store.removeTask(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    store.signalReload();
    
    // 通知 WebScheduler 热加载
    const ws = getWebScheduler();
    if (ws) ws.onTaskCreated();
    
    // 广播任务删除事件
    broadcastMessage({
      type: 'schedule:task_deleted',
      payload: { taskId: req.params.id },
    });
    
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/schedule/tasks/:id/toggle - 启用/禁用切换
router.post('/tasks/:id/toggle', (req, res) => {
  try {
    const store = getStore();
    const task = store.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    const newEnabled = !task.enabled;
    let updates: any = { enabled: newEnabled };
    
    if (newEnabled) {
      // 从禁用 → 启用：清除 runningAtMs、lastRunStatus、consecutiveErrors，让 recomputeNextRuns 重算 nextRunAtMs
      updates.runningAtMs = undefined;
      updates.lastRunStatus = undefined;
      updates.consecutiveErrors = 0;
    } else {
      // 从启用 → 禁用：清除 nextRunAtMs 和 runningAtMs
      updates.nextRunAtMs = undefined;
      updates.runningAtMs = undefined;
    }
    
    const updated = store.updateTask(req.params.id, updates);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to update task' });
    }
    store.signalReload();
    
    // 通知 WebScheduler 热加载
    const ws = getWebScheduler();
    if (ws) ws.onTaskCreated();
    
    // 广播任务更新事件
    const updatedTask = store.getTask(req.params.id);
    if (updatedTask) {
      broadcastMessage({
        type: 'schedule:task_updated',
        payload: { task: updatedTask },
      });
    }
    
    res.json({ success: true, data: { enabled: newEnabled } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// POST /api/schedule/tasks/:id/run-now - 立即执行任务
router.post('/tasks/:id/run-now', (req, res) => {
  try {
    const store = getStore();
    const task = store.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    // 设置 nextRunAtMs 为当前时间，让下次 timer tick 时立即被调度
    // 清除 runningAtMs 防止卡住状态阻止执行
    const updated = store.updateTask(req.params.id, {
      nextRunAtMs: Date.now(),
      runningAtMs: undefined,
    });
    
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to update task' });
    }
    
    store.signalReload();
    
    // 通知 WebScheduler 热加载
    const ws = getWebScheduler();
    if (ws) ws.onTaskCreated();
    
    // 广播任务更新事件
    const updatedTask = store.getTask(req.params.id);
    if (updatedTask) {
      broadcastMessage({
        type: 'schedule:task_updated',
        payload: { task: updatedTask },
      });
    }
    
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: message });
  }
});

// PATCH /api/schedule/tasks/:id - 更新任务
router.patch('/tasks/:id', (req, res) => {
  try {
    const store = getStore();
    const task = store.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const updates: any = {};
    const { name, prompt, model, timeoutMs, triggerAt, intervalMs, watchPaths, watchEvents, debounceMs, notify, feishuChatId, silentToken, context } = req.body;

    // 验证可修改字段
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ success: false, error: 'Name cannot be empty' });
      }
      updates.name = name.trim();
    }

    if (prompt !== undefined) {
      if (typeof prompt !== 'string' || prompt.trim() === '') {
        return res.status(400).json({ success: false, error: 'Prompt cannot be empty' });
      }
      updates.prompt = prompt.trim();
    }

    if (model !== undefined) {
      updates.model = model;
    }

    if (timeoutMs !== undefined) {
      updates.timeoutMs = timeoutMs;
    }

    if (silentToken !== undefined) {
      updates.silentToken = silentToken;
    }

    if (context !== undefined) {
      updates.context = context;
    }

    if (notify !== undefined) {
      updates.notify = notify;
    }

    if (feishuChatId !== undefined) {
      updates.feishuChatId = feishuChatId;
    }

    // 类型特定字段
    if (task.type === 'once' && triggerAt !== undefined) {
      if (typeof triggerAt !== 'number' || triggerAt <= 0) {
        return res.status(400).json({ success: false, error: 'Valid triggerAt is required' });
      }
      updates.triggerAt = triggerAt;
    }

    if (task.type === 'interval' && intervalMs !== undefined) {
      if (typeof intervalMs !== 'number' || intervalMs <= 0) {
        return res.status(400).json({ success: false, error: 'intervalMs must be > 0' });
      }
      updates.intervalMs = intervalMs;
    }

    if (task.type === 'watch') {
      if (watchPaths !== undefined) {
        if (!Array.isArray(watchPaths) || watchPaths.length === 0) {
          return res.status(400).json({ success: false, error: 'Watch paths cannot be empty' });
        }
        updates.watchPaths = watchPaths;
      }
      if (watchEvents !== undefined) {
        updates.watchEvents = watchEvents;
      }
      if (debounceMs !== undefined) {
        updates.debounceMs = debounceMs;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    const updated = store.updateTask(req.params.id, updates);
    if (!updated) {
      return res.status(500).json({ success: false, error: 'Failed to update task' });
    }

    store.signalReload();

    // 通知 WebScheduler 热加载
    const ws = getWebScheduler();
    if (ws) ws.onTaskCreated();

    // 广播任务更新事件
    const updatedTask = store.getTask(req.params.id);
    if (updatedTask) {
      broadcastMessage({
        type: 'schedule:task_updated',
        payload: { task: updatedTask },
      });
    }

    res.json({ success: true, data: updatedTask });
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
