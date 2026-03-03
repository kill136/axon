/**
 * 蓝图需求对话 API（已简化）
 *
 * 新蜂群架构 v2.0 使用 SmartPlanner 进行需求对话，
 * 旧的 RequirementDialogManager 已被移除。
 *
 * 此文件保留 API 路由结构，返回适当的错误或重定向到新的 SmartPlanner API。
 */

import { Router, Request, Response } from 'express';

const router = Router();

// ============================================================================
// API 路由（已禁用，返回升级提示）
// ============================================================================

/**
 * 返回升级提示的辅助函数
 */
function returnUpgradeNotice(res: Response, operation: string): void {
  res.status(501).json({
    success: false,
    error: `Requirement dialog API has been upgraded`,
    message: `Operation "${operation}" has been replaced by the new SmartPlanner dialog API. Please use /api/blueprint/dialog/* endpoints.`,
    migrationGuide: {
      oldApi: '/api/blueprint/requirement/*',
      newApi: '/api/blueprint/dialog/*',
      documentation: 'New API endpoints: POST /dialog/start, POST /dialog/:sessionId/message, POST /dialog/:sessionId/confirm, DELETE /dialog/:sessionId',
    },
  });
}

/**
 * POST /api/blueprint/requirement/start
 * 启动需求收集对话 - 已迁移到 SmartPlanner
 */
router.post('/start', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'start');
});

/**
 * POST /api/blueprint/requirement/message
 * 发送消息到对话 - 已迁移到 SmartPlanner
 */
router.post('/message', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'message');
});

/**
 * GET /api/blueprint/requirement/state/:sessionId
 * 获取对话状态 - 已迁移到 SmartPlanner
 */
router.get('/state/:sessionId', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'state');
});

/**
 * GET /api/blueprint/requirement/by-project
 * 根据项目路径获取对话 - 已迁移到 SmartPlanner
 */
router.get('/by-project', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'by-project');
});

/**
 * GET /api/blueprint/requirement/:sessionId/history
 * 获取对话历史 - 已迁移到 SmartPlanner
 */
router.get('/:sessionId/history', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'history');
});

/**
 * GET /api/blueprint/requirement/:sessionId/preview
 * 生成蓝图预览 - 已迁移到 SmartPlanner
 */
router.get('/:sessionId/preview', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'preview');
});

/**
 * DELETE /api/blueprint/requirement/:sessionId
 * 结束对话 - 已迁移到 SmartPlanner
 */
router.delete('/:sessionId', (_req: Request, res: Response) => {
  returnUpgradeNotice(res, 'delete');
});

/**
 * GET /api/blueprint/requirement/sessions
 * 获取所有活跃会话列表 - 已迁移到 SmartPlanner
 */
router.get('/sessions', (_req: Request, res: Response) => {
  res.json({
    success: true,
    sessions: [],
    total: 0,
    message: 'Requirement dialog API has been upgraded to SmartPlanner, please use the new API',
  });
});

export default router;
