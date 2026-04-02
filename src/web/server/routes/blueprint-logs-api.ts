/**
 * 蓝图执行日志 API
 * 从 blueprint-api.ts 拆出的独立路由模块
 */

import { Router, Request, Response } from 'express';
import { getSwarmLogDB } from '../database/swarm-logs.js';

const router = Router();

/**
 * GET /logs/task/:taskId
 * 获取指定任务的执行日志
 */
router.get('/logs/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { limit = '100', offset = '0', since, until } = req.query;

    const logDB = await getSwarmLogDB();

    // 获取任务执行历史
    const history = logDB.getTaskHistory(taskId);

    // 获取日志和流
    const logs = logDB.getLogs({
      taskId,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
      since: since as string,
      until: until as string,
    });

    const streams = logDB.getStreams({
      taskId,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
      since: since as string,
      until: until as string,
    });

    res.json({
      success: true,
      data: {
        taskId,
        executions: history.executions,
        logs,
        streams,
        totalLogs: history.totalLogs,
        totalStreams: history.totalStreams,
      },
    });
  } catch (error: any) {
    console.error('[LogsAPI] Failed to get task logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /logs/blueprint/:blueprintId
 * 获取指定蓝图的所有执行日志
 */
router.get('/logs/blueprint/:blueprintId', async (req: Request, res: Response) => {
  try {
    const { blueprintId } = req.params;
    const { limit = '500', offset = '0' } = req.query;

    const logDB = await getSwarmLogDB();

    const executions = logDB.getExecutions({
      blueprintId,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    const logs = logDB.getLogs({
      blueprintId,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    res.json({
      success: true,
      data: {
        blueprintId,
        executions,
        logs,
        totalExecutions: executions.length,
        totalLogs: logs.length,
      },
    });
  } catch (error: any) {
    console.error('[LogsAPI] Failed to get blueprint logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /logs/task/:taskId
 * 清空指定任务的日志（用于重试前）
 */
router.delete('/logs/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { keepLatest = 'false' } = req.query;

    const logDB = await getSwarmLogDB();
    const deletedCount = logDB.clearTaskLogs(taskId, keepLatest === 'true');

    res.json({
      success: true,
      data: {
        taskId,
        deletedCount,
      },
    });
  } catch (error: any) {
    console.error('[LogsAPI] Failed to clear task logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /logs/stats
 * 获取日志数据库统计信息
 */
router.get('/logs/stats', async (_req: Request, res: Response) => {
  try {
    const logDB = await getSwarmLogDB();
    const stats = logDB.getStats();

    res.json({
      success: true,
      data: {
        ...stats,
        dbSizeMB: (stats.dbSizeBytes / 1024 / 1024).toFixed(2),
      },
    });
  } catch (error: any) {
    console.error('[LogsAPI] Failed to get statistics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /logs/cleanup
 * 手动触发日志清理
 */
router.post('/logs/cleanup', async (_req: Request, res: Response) => {
  try {
    const logDB = await getSwarmLogDB();
    const deletedCount = logDB.cleanupOldLogs();

    res.json({
      success: true,
      data: {
        deletedCount,
        message: `Cleaned up ${deletedCount} expired log entries`,
      },
    });
  } catch (error: any) {
    console.error('[LogsAPI] Failed to cleanup logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
