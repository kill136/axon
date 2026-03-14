/**
 * REST API 路由
 */

import type { Express, Request, Response } from 'express';
import type { ConversationManager } from '../conversation.js';
import { toolRegistry } from '../../../tools/index.js';
import { MCPSearchTool, getMcpServers } from '../../../tools/mcp.js';
import { getAllSkills } from '../../../tools/skill.js';
import { apiManager } from '../api-manager.js';
import { webAuth } from '../web-auth.js';
import { CheckpointManager } from '../checkpoint-manager.js';
import blueprintApiRouter from './blueprint-api.js';
import agentApiRouter from './agent-api.js';
import fileApiRouter from './file-api.js';
import notebookApiRouter from './notebook-api.js';
import mcpCliApiRouter from './mcp-cli-api.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { VERSION } from '../../../version.js';

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

  // ============ Notebook API ============
  // AI 可定制属性管理（profile/experience/project notebooks + AXON.md）
  app.use('/api/notebook', notebookApiRouter);

  // ============ MCP CLI API ============
  // HTTP bridge for mcp-cli command (progressive MCP tool loading)
  app.use('/api/mcp-cli', mcpCliApiRouter);

  // 健康检查
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      version: VERSION,
    });
  });

  // 版本更新检查 - 返回后台更新检查的缓存结果
  app.get('/api/update-check', (req: Request, res: Response) => {
    const info = (globalThis as any).__axon_update_info;
    res.json(info ?? { hasUpdate: false, current: VERSION, latest: VERSION });
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

  // 获取能力全景（聚合内置工具 + Skills + MCP servers）
  app.get('/api/capabilities', async (req: Request, res: Response) => {
    try {
      // 1. 内置工具
      const builtinTools = toolRegistry.getAll().map(tool => ({
        name: tool.name,
        description: tool.description.split('\n')[0].slice(0, 120), // 首行摘要
        source: 'builtin' as const,
        status: 'active' as const,
        deferred: tool.shouldDefer || false,
      }));

      // 2. Skills
      let skills: Array<{ name: string; description: string; source: 'skill'; status: 'active' }> = [];
      try {
        const allSkills = getAllSkills();
        skills = allSkills.map((s: any) => ({
          name: s.displayName || s.skillName || 'unknown',
          description: (s.description || s.whenToUse || '').slice(0, 120),
          source: 'skill' as const,
          status: 'active' as const,
        }));
      } catch { /* skills not loaded yet */ }

      // 3. MCP servers (enabled)
      const enabledMcp: Array<{ name: string; description: string; source: 'mcp'; status: 'active'; tools: string[] }> = [];
      for (const [serverName, server] of getMcpServers()) {
        if (server.connected) {
          enabledMcp.push({
            name: serverName,
            description: MCPSearchTool.serverCapabilitySummaries.get(serverName) || `${server.tools.length} tools`,
            source: 'mcp' as const,
            status: 'active' as const,
            tools: server.tools.map(t => t.name),
          });
        }
      }

      // 4. MCP servers (disabled)
      const disabledMcp = MCPSearchTool.disabledServers.map(name => ({
        name,
        description: MCPSearchTool.serverCapabilitySummaries.get(name) || '',
        source: 'mcp' as const,
        status: 'disabled' as const,
        tools: [] as string[],
      }));

      res.json({
        builtin: builtinTools,
        skills,
        mcp: {
          enabled: enabledMcp,
          disabled: disabledMcp,
        },
        summary: {
          totalBuiltin: builtinTools.length,
          activeBuiltin: builtinTools.filter(t => !t.deferred).length,
          deferredBuiltin: builtinTools.filter(t => t.deferred).length,
          totalSkills: skills.length,
          mcpEnabled: enabledMcp.length,
          mcpDisabled: disabledMcp.length,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // 获取模型列表
  app.get('/api/models', (req: Request, res: Response) => {
    res.json({
      models: [
        {
          id: 'opus',
          name: 'Claude Opus 4.6',
          description: 'Most powerful model, suitable for complex tasks (latest)',
          modelId: 'claude-opus-4-6',
        },
        {
          id: 'sonnet',
          name: 'Claude Sonnet 4.5',
          description: 'Balanced performance and speed',
          modelId: 'claude-sonnet-4-5-20250929',
        },
        {
          id: 'haiku',
          name: 'Claude Haiku 4.5',
          description: 'Fastest model',
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
      message: 'Session cleared',
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
      console.error('[API] Failed to get sessions list:', error);
      res.status(500).json({
        error: 'Failed to get session list',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Session does not exist',
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
      console.error('[API] Failed to get session details:', error);
      res.status(500).json({
        error: 'Failed to get session details',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: 'Session deleted',
        });
      } else {
        res.status(404).json({
          success: false,
          sessionId: id,
          error: 'Session does not exist',
        });
      }
    } catch (error) {
      console.error('[API] Failed to delete session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete session',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Invalid session name',
        });
        return;
      }

      const success = conversationManager.renamePersistedSession(id, name);

      if (success) {
        res.json({
          success: true,
          sessionId: id,
          name,
          message: 'Session renamed',
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session does not exist',
        });
      }
    } catch (error) {
      console.error('[API] Failed to rename session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to rename session',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Session does not exist or export failed',
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
      console.error('[API] Failed to export session:', error);
      res.status(500).json({
        error: 'Failed to export session',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: 'Session restored',
          history,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session does not exist',
        });
      }
    } catch (error) {
      console.error('[API] Failed to restore session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to restore session',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Missing sessionId parameter',
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
      console.error('[API] Failed to get tool filter config:', error);
      res.status(500).json({
        error: 'Failed to get tool filter configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 更新工具过滤配置
  app.put('/api/tools/config', (req: Request, res: Response) => {
    try {
      const { sessionId, config } = req.body;

      if (!sessionId) {
        res.status(400).json({
          error: 'Missing sessionId',
        });
        return;
      }

      if (!config || !config.mode) {
        res.status(400).json({
          error: 'Invalid tool filter configuration',
        });
        return;
      }

      conversationManager.updateToolFilter(sessionId, config);

      res.json({
        success: true,
        config,
      });
    } catch (error) {
      console.error('[API] Failed to update tool filter config:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update tool filter configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 获取当前可用工具列表
  app.get('/api/tools/available', (req: Request, res: Response) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) {
        res.status(400).json({
          error: 'Missing sessionId parameter',
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
      console.error('[API] Failed to get available tools list:', error);
      res.status(500).json({
        error: 'Failed to get available tools list',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to get API status:', error);
      res.status(500).json({
        error: 'Failed to get API status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 测试API连接
  app.post('/api/api/test', async (req: Request, res: Response) => {
    try {
      const result = await apiManager.testConnection();
      res.json(result);
    } catch (error) {
      console.error('[API] API test failed:', error);
      res.status(500).json({
        error: 'API test failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 获取Provider信息
  app.get('/api/api/provider', (req: Request, res: Response) => {
    try {
      const info = apiManager.getProviderInfo();
      res.json(info);
    } catch (error) {
      console.error('[API] Failed to get provider info:', error);
      res.status(500).json({
        error: 'Failed to get provider information',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 获取Token状态
  app.get('/api/api/token/status', (req: Request, res: Response) => {
    try {
      const status = apiManager.getTokenStatus();
      res.json(status);
    } catch (error) {
      console.error('[API] Failed to get token status:', error);
      res.status(500).json({
        error: 'Failed to get token status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // ============ 主动建议 API ============

  app.get('/api/project-suggestions', async (req: Request, res: Response) => {
    try {
      const projectPath = req.query.projectPath as string || process.cwd();
      const { getProjectSuggestions } = await import('../project-suggestions.js');
      const result = await getProjectSuggestions(projectPath, conversationManager);
      res.json(result);
    } catch (error) {
      console.error('[API] Failed to get project suggestions:', error);
      res.json({ suggestions: [], capabilities: [], frequentTasks: [] });
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
      console.error('[API] Failed to get system prompt:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system prompt',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Invalid configuration',
        });
        return;
      }

      const targetSessionId = sessionId || 'default';
      const success = conversationManager.updateSystemPrompt(targetSessionId, config);

      if (success) {
        const result = await conversationManager.getSystemPrompt(targetSessionId);
        res.json({
          success: true,
          message: 'System prompt updated',
          ...result,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Session does not exist',
        });
      }
    } catch (error) {
      console.error('[API] Failed to update system prompt:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update system prompt',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to get MCP servers list:', error);
      res.status(500).json({
        error: 'Failed to get MCP server list',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 添加 MCP 服务器
  app.post('/api/mcp/servers', async (req: Request, res: Response) => {
    try {
      const { name, config } = req.body;

      if (!name || !config) {
        res.status(400).json({
          error: 'Missing required parameters',
          message: 'Please provide name and config parameters',
        });
        return;
      }

      const success = await conversationManager.addMcpServer(name, config);

      if (success) {
        res.json({
          success: true,
          name,
          message: `MCP server ${name} added`,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to add MCP server',
        });
      }
    } catch (error) {
      console.error('[API] Failed to add MCP server:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add MCP server',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: `MCP server ${name} deleted`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Server does not exist',
          name,
        });
      }
    } catch (error) {
      console.error('[API] Failed to delete MCP server:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete MCP server',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: `MCP server ${name} ${result.enabled ? 'enabled' : 'disabled'}`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Server does not exist',
          name,
        });
      }
    } catch (error) {
      console.error('[API] Failed to toggle MCP server:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to toggle MCP server',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to run diagnostics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to run diagnostics',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to get diagnostic report:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get diagnostic report',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to get checkpoints list:', error);
      res.status(500).json({
        error: 'Failed to get checkpoint list',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 创建检查点
  app.post('/api/checkpoints', async (req: Request, res: Response) => {
    try {
      const { description, filePaths, workingDirectory, tags } = req.body;

      if (!description || !filePaths || filePaths.length === 0) {
        res.status(400).json({
          error: 'Creating a checkpoint requires description and file list',
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
      console.error('[API] Failed to create checkpoint:', error);
      res.status(500).json({
        error: 'Failed to create checkpoint',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to restore checkpoint:', error);
      res.status(500).json({
        error: 'Failed to restore checkpoint',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: 'Checkpoint deleted',
        });
      } else {
        res.status(404).json({
          checkpointId: id,
          success: false,
          error: 'Checkpoint does not exist',
        });
      }
    } catch (error) {
      console.error('[API] Failed to delete checkpoint:', error);
      res.status(500).json({
        error: 'Failed to delete checkpoint',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to compare checkpoint:', error);
      res.status(500).json({
        error: 'Failed to compare checkpoints',
        message: error instanceof Error ? error.message : 'Unknown error',
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
        message: `Cleared ${count} checkpoints`,
      });
    } catch (error) {
      console.error('[API] Failed to cleanup checkpoints:', error);
      res.status(500).json({
        error: 'Failed to clear checkpoints',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to get plugins list:', error);
      res.status(500).json({
        error: 'Failed to get plugin list',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Plugin does not exist',
          name,
        });
        return;
      }

      res.json({
        plugin,
      });
    } catch (error) {
      console.error('[API] Failed to get plugin details:', error);
      res.status(500).json({
        error: 'Failed to get plugin details',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: `Plugin ${name} enabled`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Plugin does not exist',
          name,
        });
      }
    } catch (error) {
      console.error('[API] Failed to enable plugin:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to enable plugin',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: `Plugin ${name} disabled`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Plugin does not exist',
          name,
        });
      }
    } catch (error) {
      console.error('[API] Failed to disable plugin:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to disable plugin',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: `Plugin ${name} uninstalled`,
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'Plugin does not exist',
          name,
        });
      }
    } catch (error) {
      console.error('[API] Failed to uninstall plugin:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to uninstall plugin',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      console.error('[API] Failed to get auth status:', error);
      res.status(500).json({
        error: 'Failed to get authentication status',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          error: 'Invalid API key',
        });
        return;
      }

      const success = webAuth.setApiKey(apiKey);

      if (success) {
        const status = webAuth.getStatus();
        res.json({
          success: true,
          message: 'API key set',
          status,
        });
      } else {
        res.status(500).json({
          success: false,
          error: 'Failed to set API key',
        });
      }
    } catch (error) {
      console.error('[API] Failed to set API key:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to set API key',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 清除认证（登出）
  app.delete('/api/auth', (req: Request, res: Response) => {
    try {
      webAuth.clearAll();
      const status = webAuth.getStatus();

      res.json({
        success: true,
        message: 'Authentication cleared',
        status,
      });
    } catch (error) {
      console.error('[API] Failed to clear auth:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear authentication',
        message: error instanceof Error ? error.message : 'Unknown error',
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
          message: 'Invalid API key format',
        });
        return;
      }

      const valid = await webAuth.validateApiKey(apiKey);

      res.json({
        valid,
        message: valid ? 'API key is valid' : 'API key is invalid',
      });
    } catch (error) {
      console.error('[API] Failed to validate API key:', error);
      res.status(500).json({
        valid: false,
        error: 'Failed to validate API key',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // 注意：Express 5 不再支持 /api/* 这样的通配符路由
  // 404 处理将由主路由的 SPA fallback 处理
}
