/**
 * REST API 路由
 */

import type { Express, Request, Response } from 'express';
import type { ConversationManager } from '../conversation.js';
import { toolRegistry } from '../../../tools/index.js';
import { apiManager } from '../api-manager.js';
import { authManager } from '../auth-manager.js';
import { CheckpointManager } from '../checkpoint-manager.js';
import blueprintApiRouter from './blueprint-api.js';
import agentApiRouter from './agent-api.js';
import fileApiRouter from './file-api.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 全局检查点管理器实例（惰性初始化）
let _cpManager: CheckpointManager | null = null;
function getCheckpointManager(): CheckpointManager {
  if (!_cpManager) {
    _cpManager = new CheckpointManager();
  }
  return _cpManager;
}

export function setupApiRoutes(app: Express, conversationManager: ConversationManager): void {
  // ============ 蓝图系统 API ============
  // 注册蓝图API路由（供 SwarmConsole 使用）
  app.use('/api/blueprint', blueprintApiRouter);

  // ============ Agent 系统 API ============
  // 注册 Agent API 路由（提供 agent 元数据）
  app.use('/api/agents', agentApiRouter);

  // ============ 文件系统 API ============
  // 注册文件 API 路由（供 CodeView 文件树使用）
  app.use('/api/files', fileApiRouter);

  // 健康检查
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '2.1.4',
    });
  });

  // 获取可用工具列表
  app.get('/api/tools', (req: Request, res: Response) => {
    const tools = toolRegistry.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.getInputSchema(),
    }));

    res.json({
      count: tools.length,
      tools,
    });
  });

  // 获取模型列表
  app.get('/api/models', (req: Request, res: Response) => {
    res.json({
      models: [
        {
          id: 'opus',
          name: 'Claude Opus 4.6',
          description: '最强大的模型，适合复杂任务 (最新)',
          modelId: 'claude-opus-4-6',
        },
        {
          id: 'sonnet',
          name: 'Claude Sonnet 4.5',
          description: '平衡性能和速度',
          modelId: 'claude-sonnet-4-5-20250929',
        },
        {
          id: 'haiku',
          name: 'Claude Haiku 4.5',
          description: '最快速的模型',
          modelId: 'claude-haiku-4-5-20251001',
        },
      ],
    });
  });

  // 获取会话信息
  app.get('/api/session/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const history = conversationManager.getHistory(sessionId);

    res.json({
      sessionId,
      messageCount: history.length,
      history,
    });
  });

  // 清除会话
  app.delete('/api/session/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    conversationManager.clearHistory(sessionId);

    res.json({
      success: true,
      message: '会话已清除',
    });
  });

  // 获取工作目录信息
  app.get('/api/cwd', (req: Request, res: Response) => {
    res.json({
      cwd: process.cwd(),
    });
  });

  // ============ 会话管理API ============

  // 获取会话列表
  app.get('/api/sessions', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const search = req.query.search as string | undefined;
      // 支持按项目路径过滤：
      // - 不传参数：获取所有会话
      // - projectPath=null：只获取全局会话
      // - projectPath=xxx：获取指定项目的会话
      let projectPath: string | null | undefined;
      if (req.query.projectPath !== undefined) {
        const rawProjectPath = req.query.projectPath as string;
        projectPath = rawProjectPath === 'null' ? null : rawProjectPath;
      }

      const sessions = conversationManager.listPersistedSessions({
        limit,
        offset,
        search,
        projectPath,
      });

      res.json({
        sessions: sessions.map(s => ({
          ...s,
          projectPath: s.projectPath,
        })),
        total: sessions.length,
        limit,
        offset,
      });
    } catch (error) {
      console.error('[API] 获取会话列表失败:', error);
      res.status(500).json({
        error: '获取会话列表失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 获取特定会话详情
  app.get('/api/sessions/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const sessionManager = conversationManager.getSessionManager();
      const session = sessionManager.loadSessionById(id);

      if (!session) {
        res.status(404).json({
          error: '会话不存在',
          sessionId: id,
        });
        return;
      }

      res.json({
        session: {
          id: session.metadata.id,
          name: session.metadata.name,
          createdAt: session.metadata.createdAt,
          updatedAt: session.metadata.updatedAt,
          messageCount: session.metadata.messageCount,
          model: session.metadata.model,
          cost: session.metadata.cost,
          tokenUsage: session.metadata.tokenUsage,
          tags: session.metadata.tags,
          workingDirectory: session.metadata.workingDirectory,
          projectPath: session.metadata.projectPath,
        },
        messages: session.chatHistory || [],
      });
    } catch (error) {
      console.error('[API] 获取会话详情失败:', error);
      res.status(500).json({
        error: '获取会话详情失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 删除会话
  app.delete('/api/sessions/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const success = conversationManager.deletePersistedSession(id);

      if (success) {
        res.json({
          success: true,
          sessionId: id,
          message: '会话已删除',
        });
      } else {
        res.status(404).json({
          success: false,
          sessionId: id,
          error: '会话不存在',
        });
      }
    } catch (error) {
      console.error('[API] 删除会话失败:', error);
      res.status(500).json({
        success: false,
        error: '删除会话失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 重命名会话
  app.patch('/api/sessions/:id/rename', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { name } = req.body;

      if (!name || typeof name !== 'string') {
        res.status(400).json({
          error: '无效的会话名称',
        });
        return;
      }

      const success = conversationManager.renamePersistedSession(id, name);

      if (success) {
        res.json({
          success: true,
          sessionId: id,
          name,
          message: '会话已重命名',
        });
      } else {
        res.status(404).json({
          success: false,
          error: '会话不存在',
        });
      }
    } catch (error) {
      console.error('[API] 重命名会话失败:', error);
      res.status(500).json({
        success: false,
        error: '重命名会话失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 导出会话
  app.get('/api/sessions/:id/export', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const format = (req.query.format as 'json' | 'md') || 'json';

      const content = conversationManager.exportPersistedSession(id, format);

      if (!content) {
        res.status(404).json({
          error: '会话不存在或导出失败',
        });
        return;
      }

      // 设置响应头
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="session-${id}.json"`);
      } else {
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', `attachment; filename="session-${id}.md"`);
      }

      res.send(content);
    } catch (error) {
      console.error('[API] 导出会话失败:', error);
      res.status(500).json({
        error: '导出会话失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 恢复会话
  app.post('/api/sessions/:id/resume', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const success = await conversationManager.resumeSession(id);

      if (success) {
        const history = conversationManager.getHistory(id);
        res.json({
          success: true,
          sessionId: id,
          message: '会话已恢复',
          history,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '会话不存在',
        });
      }
    } catch (error) {
      console.error('[API] 恢复会话失败:', error);
      res.status(500).json({
        success: false,
        error: '恢复会话失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ 工具过滤配置API ============

  // 获取工具过滤配置
  app.get('/api/tools/config', (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({
          error: '缺少 sessionId 参数',
        });
        return;
      }

      const tools = conversationManager.getAvailableTools(sessionId);
      const config = conversationManager.getToolFilterConfig(sessionId);

      res.json({
        config,
        tools,
      });
    } catch (error) {
      console.error('[API] 获取工具过滤配置失败:', error);
      res.status(500).json({
        error: '获取工具过滤配置失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 更新工具过滤配置
  app.put('/api/tools/config', (req: Request, res: Response) => {
    try {
      const { sessionId, config } = req.body;

      if (!sessionId) {
        res.status(400).json({
          error: '缺少 sessionId',
        });
        return;
      }

      if (!config || !config.mode) {
        res.status(400).json({
          error: '无效的工具过滤配置',
        });
        return;
      }

      conversationManager.updateToolFilter(sessionId, config);

      res.json({
        success: true,
        config,
      });
    } catch (error) {
      console.error('[API] 更新工具过滤配置失败:', error);
      res.status(500).json({
        success: false,
        error: '更新工具过滤配置失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 获取当前可用工具列表
  app.get('/api/tools/available', (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({
          error: '缺少 sessionId 参数',
        });
        return;
      }

      const tools = conversationManager.getAvailableTools(sessionId);

      // 按分类分组
      const byCategory: Record<string, any[]> = {};
      for (const tool of tools) {
        if (!byCategory[tool.category]) {
          byCategory[tool.category] = [];
        }
        byCategory[tool.category].push(tool);
      }

      res.json({
        tools,
        byCategory,
        total: tools.length,
        enabled: tools.filter(t => t.enabled).length,
        disabled: tools.filter(t => !t.enabled).length,
      });
    } catch (error) {
      console.error('[API] 获取可用工具列表失败:', error);
      res.status(500).json({
        error: '获取可用工具列表失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ API 管理API ============

  // 获取API状态
  app.get('/api/api/status', async (req: Request, res: Response) => {
    try {
      const status = await apiManager.getStatus();
      res.json(status);
    } catch (error) {
      console.error('[API] 获取API状态失败:', error);
      res.status(500).json({
        error: '获取API状态失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 测试API连接
  app.post('/api/api/test', async (req: Request, res: Response) => {
    try {
      const result = await apiManager.testConnection();
      res.json(result);
    } catch (error) {
      console.error('[API] API测试失败:', error);
      res.status(500).json({
        error: 'API测试失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 获取Provider信息
  app.get('/api/api/provider', (req: Request, res: Response) => {
    try {
      const info = apiManager.getProviderInfo();
      res.json(info);
    } catch (error) {
      console.error('[API] 获取Provider信息失败:', error);
      res.status(500).json({
        error: '获取Provider信息失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 获取Token状态
  app.get('/api/api/token/status', (req: Request, res: Response) => {
    try {
      const status = apiManager.getTokenStatus();
      res.json(status);
    } catch (error) {
      console.error('[API] 获取Token状态失败:', error);
      res.status(500).json({
        error: '获取Token状态失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ 系统提示API ============

  // 获取当前系统提示
  app.get('/api/system-prompt', async (req: Request, res: Response) => {
    try {
      // 获取当前会话ID（假设从查询参数或默认会话）
      const sessionId = (req.query.sessionId as string) || 'default';

      const result = await conversationManager.getSystemPrompt(sessionId);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error('[API] 获取系统提示失败:', error);
      res.status(500).json({
        success: false,
        error: '获取系统提示失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 更新系统提示配置
  app.put('/api/system-prompt', async (req: Request, res: Response) => {
    try {
      const { config, sessionId } = req.body;

      if (!config || typeof config !== 'object') {
        res.status(400).json({
          success: false,
          error: '无效的配置',
        });
        return;
      }

      const targetSessionId = sessionId || 'default';
      const success = conversationManager.updateSystemPrompt(targetSessionId, config);

      if (success) {
        const result = await conversationManager.getSystemPrompt(targetSessionId);
        res.json({
          success: true,
          message: '系统提示已更新',
          ...result,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '会话不存在',
        });
      }
    } catch (error) {
      console.error('[API] 更新系统提示失败:', error);
      res.status(500).json({
        success: false,
        error: '更新系统提示失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ Doctor 诊断API ============

  // ============ MCP 服务器管理 API ============

  // 获取 MCP 服务器列表
  app.get('/api/mcp/servers', (req: Request, res: Response) => {
    try {
      const servers = conversationManager.listMcpServers();

      res.json({
        servers,
        total: servers.length,
      });
    } catch (error) {
      console.error('[API] 获取 MCP 服务器列表失败:', error);
      res.status(500).json({
        error: '获取 MCP 服务器列表失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 添加 MCP 服务器
  app.post('/api/mcp/servers', async (req: Request, res: Response) => {
    try {
      const { name, config } = req.body;

      if (!name || !config) {
        res.status(400).json({
          error: '缺少必要参数',
          message: '请提供 name 和 config 参数',
        });
        return;
      }

      const success = await conversationManager.addMcpServer(name, config);

      if (success) {
        res.json({
          success: true,
          name,
          message: `MCP 服务器 ${name} 已添加`,
        });
      } else {
        res.status(500).json({
          success: false,
          error: '添加 MCP 服务器失败',
        });
      }
    } catch (error) {
      console.error('[API] 添加 MCP 服务器失败:', error);
      res.status(500).json({
        success: false,
        error: '添加 MCP 服务器失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 删除 MCP 服务器
  app.delete('/api/mcp/servers/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const success = await conversationManager.removeMcpServer(name);

      if (success) {
        res.json({
          success: true,
          name,
          message: `MCP 服务器 ${name} 已删除`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '服务器不存在',
          name,
        });
      }
    } catch (error) {
      console.error('[API] 删除 MCP 服务器失败:', error);
      res.status(500).json({
        success: false,
        error: '删除 MCP 服务器失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 启用/禁用 MCP 服务器
  app.patch('/api/mcp/servers/:name/toggle', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;

      const result = await conversationManager.toggleMcpServer(name, enabled);

      if (result.success) {
        res.json({
          success: true,
          name,
          enabled: result.enabled,
          message: `MCP 服务器 ${name} 已${result.enabled ? '启用' : '禁用'}`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '服务器不存在',
          name,
        });
      }
    } catch (error) {
      console.error('[API] 切换 MCP 服务器失败:', error);
      res.status(500).json({
        success: false,
        error: '切换 MCP 服务器失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 运行系统诊断
  app.post('/api/doctor', async (req: Request, res: Response) => {
    try {
      const { verbose, includeSystemInfo } = req.body || {};

      // 动态导入 doctor 模块
      const { runDiagnostics, formatDoctorReport } = await import('../doctor.js');

      const options = {
        verbose: verbose || false,
        includeSystemInfo: includeSystemInfo ?? true,
      };

      const report = await runDiagnostics(options);
      const formattedText = formatDoctorReport(report, options.verbose);

      res.json({
        success: true,
        report: {
          ...report,
          timestamp: report.timestamp.getTime(),
        },
        formattedText,
      });
    } catch (error) {
      console.error('[API] 运行诊断失败:', error);
      res.status(500).json({
        success: false,
        error: '运行诊断失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 获取系统诊断报告（可选：缓存上次的结果）
  app.get('/api/doctor', async (req: Request, res: Response) => {
    try {
      const verbose = req.query.verbose === 'true';
      const includeSystemInfo = req.query.includeSystemInfo !== 'false';

      const { runDiagnostics, formatDoctorReport } = await import('../doctor.js');

      const options = {
        verbose,
        includeSystemInfo,
      };

      const report = await runDiagnostics(options);
      const formattedText = formatDoctorReport(report, options.verbose);

      res.json({
        success: true,
        report: {
          ...report,
          timestamp: report.timestamp.getTime(),
        },
        formattedText,
      });
    } catch (error) {
      console.error('[API] 获取诊断报告失败:', error);
      res.status(500).json({
        success: false,
        error: '获取诊断报告失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ 检查点管理API ============

  // 获取检查点列表
  app.get('/api/checkpoints', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const sortBy = (req.query.sortBy as 'timestamp' | 'description') || 'timestamp';
      const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'desc';

      const checkpoints = getCheckpointManager().listCheckpoints({
        limit,
        sortBy,
        sortOrder,
      });

      const stats = getCheckpointManager().getStats();

      const checkpointSummaries = checkpoints.map(cp => ({
        id: cp.id,
        timestamp: cp.timestamp.getTime(),
        description: cp.description,
        fileCount: cp.files.length,
        totalSize: cp.files.reduce((sum, f) => sum + f.size, 0),
        workingDirectory: cp.workingDirectory,
        tags: cp.metadata?.tags,
      }));

      res.json({
        checkpoints: checkpointSummaries,
        total: checkpointSummaries.length,
        stats: {
          totalFiles: stats.totalFiles,
          totalSize: stats.totalSize,
          oldest: stats.oldest?.getTime(),
          newest: stats.newest?.getTime(),
        },
      });
    } catch (error) {
      console.error('[API] 获取检查点列表失败:', error);
      res.status(500).json({
        error: '获取检查点列表失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 创建检查点
  app.post('/api/checkpoints', async (req: Request, res: Response) => {
    try {
      const { description, filePaths, workingDirectory, tags } = req.body;

      if (!description || !filePaths || filePaths.length === 0) {
        res.status(400).json({
          error: '创建检查点需要提供描述和文件列表',
        });
        return;
      }

      const checkpoint = await getCheckpointManager().createCheckpoint(
        description,
        filePaths,
        workingDirectory,
        { tags }
      );

      res.json({
        checkpointId: checkpoint.id,
        timestamp: checkpoint.timestamp.getTime(),
        description: checkpoint.description,
        fileCount: checkpoint.files.length,
        totalSize: checkpoint.files.reduce((sum, f) => sum + f.size, 0),
      });
    } catch (error) {
      console.error('[API] 创建检查点失败:', error);
      res.status(500).json({
        error: '创建检查点失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 恢复检查点
  app.post('/api/checkpoints/:id/restore', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { dryRun } = req.body;

      const result = await getCheckpointManager().restoreCheckpoint(id, {
        dryRun: dryRun || false,
        skipBackup: false,
      });

      res.json({
        checkpointId: id,
        success: result.success,
        restored: result.restored,
        failed: result.failed,
        errors: result.errors,
      });
    } catch (error) {
      console.error('[API] 恢复检查点失败:', error);
      res.status(500).json({
        error: '恢复检查点失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 删除检查点
  app.delete('/api/checkpoints/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const success = getCheckpointManager().deleteCheckpoint(id);

      if (success) {
        res.json({
          checkpointId: id,
          success: true,
          message: '检查点已删除',
        });
      } else {
        res.status(404).json({
          checkpointId: id,
          success: false,
          error: '检查点不存在',
        });
      }
    } catch (error) {
      console.error('[API] 删除检查点失败:', error);
      res.status(500).json({
        error: '删除检查点失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 比较检查点差异
  app.get('/api/checkpoints/:id/diff', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const diffs = await getCheckpointManager().diffCheckpoint(id);

      const stats = {
        added: diffs.filter(d => d.type === 'added').length,
        removed: diffs.filter(d => d.type === 'removed').length,
        modified: diffs.filter(d => d.type === 'modified').length,
        unchanged: diffs.filter(d => d.type === 'unchanged').length,
      };

      res.json({
        checkpointId: id,
        diffs,
        stats,
      });
    } catch (error) {
      console.error('[API] 比较检查点失败:', error);
      res.status(500).json({
        error: '比较检查点失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 清除所有检查点
  app.delete('/api/checkpoints', (req: Request, res: Response) => {
    try {
      const count = getCheckpointManager().clearCheckpoints();

      res.json({
        success: true,
        count,
        message: `已清除 ${count} 个检查点`,
      });
    } catch (error) {
      console.error('[API] 清除检查点失败:', error);
      res.status(500).json({
        error: '清除检查点失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ 插件管理API ============

  // 获取插件列表
  app.get('/api/plugins', async (req: Request, res: Response) => {
    try {
      const plugins = await conversationManager.listPlugins();

      res.json({
        plugins,
        total: plugins.length,
      });
    } catch (error) {
      console.error('[API] 获取插件列表失败:', error);
      res.status(500).json({
        error: '获取插件列表失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 获取插件详情
  app.get('/api/plugins/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const plugin = await conversationManager.getPluginInfo(name);

      if (!plugin) {
        res.status(404).json({
          error: '插件不存在',
          name,
        });
        return;
      }

      res.json({
        plugin,
      });
    } catch (error) {
      console.error('[API] 获取插件详情失败:', error);
      res.status(500).json({
        error: '获取插件详情失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 启用插件
  app.patch('/api/plugins/:name/enable', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const success = await conversationManager.enablePlugin(name);

      if (success) {
        res.json({
          success: true,
          name,
          message: `插件 ${name} 已启用`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '插件不存在',
          name,
        });
      }
    } catch (error) {
      console.error('[API] 启用插件失败:', error);
      res.status(500).json({
        success: false,
        error: '启用插件失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 禁用插件
  app.patch('/api/plugins/:name/disable', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const success = await conversationManager.disablePlugin(name);

      if (success) {
        res.json({
          success: true,
          name,
          message: `插件 ${name} 已禁用`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '插件不存在',
          name,
        });
      }
    } catch (error) {
      console.error('[API] 禁用插件失败:', error);
      res.status(500).json({
        success: false,
        error: '禁用插件失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 卸载插件
  app.delete('/api/plugins/:name', async (req: Request, res: Response) => {
    try {
      const { name } = req.params;

      const success = await conversationManager.uninstallPlugin(name);

      if (success) {
        res.json({
          success: true,
          name,
          message: `插件 ${name} 已卸载`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: '插件不存在',
          name,
        });
      }
    } catch (error) {
      console.error('[API] 卸载插件失败:', error);
      res.status(500).json({
        success: false,
        error: '卸载插件失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // ============ 认证管理API ============

  // 获取认证状态
  app.get('/api/auth/status', async (req: Request, res: Response) => {
    try {
      // 使用 getAuth() + isAuthenticated() 与 auth.ts 保持一致
      const { getAuth, isAuthenticated } = await import('../../../auth/index.js');
      const { isDemoMode } = await import('../../../utils/env-check.js');
      
      const auth = getAuth();
      const authenticated = isAuthenticated();

      // 如果是内置 API 配置，返回未认证状态
      if (auth?.isBuiltin) {
        return res.json({
          authenticated: false,
          type: 'builtin',
        });
      }

      if (!authenticated || !auth) {
        return res.json({
          authenticated: false,
        });
      }

      const demoMode = isDemoMode();

      res.json({
        authenticated: true,
        type: auth.type,
        accountType: auth.accountType,
        email: demoMode ? undefined : auth.email,
        expiresAt: auth.expiresAt,
        scopes: auth.scopes || auth.scope,
        isDemoMode: demoMode,
      });
    } catch (error) {
      console.error('[API] 获取认证状态失败:', error);
      res.status(500).json({
        error: '获取认证状态失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 设置API密钥
  app.post('/api/auth/key', (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({
          success: false,
          error: '无效的API密钥',
        });
        return;
      }

      const success = authManager.setApiKey(apiKey);

      if (success) {
        const status = authManager.getAuthStatus();
        res.json({
          success: true,
          message: 'API密钥已设置',
          status,
        });
      } else {
        res.status(500).json({
          success: false,
          error: '设置API密钥失败',
        });
      }
    } catch (error) {
      console.error('[API] 设置API密钥失败:', error);
      res.status(500).json({
        success: false,
        error: '设置API密钥失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 清除认证（登出）
  app.delete('/api/auth', (req: Request, res: Response) => {
    try {
      authManager.clearAuth();
      const status = authManager.getAuthStatus();

      res.json({
        success: true,
        message: '认证已清除',
        status,
      });
    } catch (error) {
      console.error('[API] 清除认证失败:', error);
      res.status(500).json({
        success: false,
        error: '清除认证失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 验证API密钥
  app.post('/api/auth/validate', async (req: Request, res: Response) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey || typeof apiKey !== 'string') {
        res.status(400).json({
          valid: false,
          message: '无效的API密钥格式',
        });
        return;
      }

      const valid = await authManager.validateApiKey(apiKey);

      res.json({
        valid,
        message: valid ? 'API密钥有效' : 'API密钥无效',
      });
    } catch (error) {
      console.error('[API] 验证API密钥失败:', error);
      res.status(500).json({
        valid: false,
        error: '验证API密钥失败',
        message: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 注意：Express 5 不再支持 /api/* 这样的通配符路由
  // 404 处理将由主路由的 SPA fallback 处理
}
