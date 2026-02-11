/**
 * 对话管理器
 * 封装核心对话逻辑，提供 WebUI 专用接口
 */

import { ClaudeClient } from '../../core/client.js';
import { Session } from '../../core/session.js';
import { runWithCwd } from '../../core/cwd-context.js';
import { shouldAutoCompact, calculateAutoCompactThreshold, getContextWindowSize, generateSummaryPrompt, formatCompactSummaryContent, validateToolResults } from '../../core/loop.js';
import { toolRegistry, registerBlueprintTools } from '../../tools/index.js';
import { systemPromptBuilder, type PromptContext } from '../../prompt/index.js';
import { modelConfig } from '../../models/index.js';
import { configManager } from '../../config/index.js';
import { initAuth, getAuth } from '../../auth/index.js';
import type { Message, ContentBlock, ToolUseBlock, TextBlock } from '../../types/index.js';
import type { ChatMessage, ChatContent, ToolResultData, PermissionConfigPayload, PermissionRequestPayload, SystemPromptConfig, SystemPromptGetPayload, DebugMessagesPayload } from '../shared/types.js';
import { UserInteractionHandler } from './user-interaction.js';
import { PermissionHandler, type PermissionConfig, type PermissionRequest, type PermissionDestination } from './permission-handler.js';
import { runPreToolUseHooks, runPostToolUseHooks, runPostToolUseFailureHooks, getHookCount } from '../../hooks/index.js';
import type { WebSocket } from 'ws';
import { WebSessionManager, type WebSessionData } from './session-manager.js';
import type { SessionMetadata, SessionListOptions } from '../../session/index.js';
import { walAppend, walCheckpoint } from '../../session/index.js';
import { TaskManager } from './task-manager.js';
import { McpConfigManager } from '../../mcp/config.js';
import type { ExtendedMcpServerConfig } from '../../mcp/config.js';
import { oauthManager } from './oauth-manager.js';
import { blueprintStore, executionManager } from './routes/blueprint-api.js';
import type { Blueprint } from '../../blueprint/types.js';
import { StartLeadAgentTool } from '../../tools/start-lead-agent.js';
import { geminiImageService } from './services/gemini-image-service.js';
import {
  initSessionMemory,
  readSessionMemory,
  writeSessionMemory,
  getSummaryPath,
  isSessionMemoryEnabled,
} from '../../context/session-memory.js';
import { initNotebookManager, getNotebookManager } from '../../memory/notebook.js';
import { registerMcpServer, connectMcpServer, createMcpTools, getMcpServers, callMcpTool, type McpToolDefinition } from '../../tools/mcp.js';
import { getChromeIntegrationConfig } from '../../chrome-mcp/index.js';
import { CHROME_MCP_TOOLS } from '../../chrome-mcp/tools.js';
import { RewindManager, type RewindOption } from '../../rewind/index.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// 网络错误重试相关常量
// ============================================================================

/** 可重试的网络错误模式 */
const RETRYABLE_NETWORK_PATTERNS = [
  'Connection error',
  'connection error',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'fetch failed',
  'network error',
  'socket hang up',
  'overloaded_error',
  'rate_limit_error',
];

/** conversation loop 层面的最大网络重试次数 */
const MAX_CONVERSATION_RETRIES = 3;

/**
 * 判断错误是否为可重试的网络错误
 */
function isRetryableNetworkError(error: any): boolean {
  const message = error?.message || String(error);
  const causeMsg = error?.cause?.message || error?.cause?.code || '';
  return RETRYABLE_NETWORK_PATTERNS.some(
    pattern => message.includes(pattern) || causeMsg.includes(pattern)
  );
}

// ============================================================================
// 工具输出截断常量和函数（与 CLI loop.ts 完全一致）
// ============================================================================

/** 持久化输出起始标签 */
const PERSISTED_OUTPUT_START = '<persisted-output>';

/** 持久化输出结束标签 */
const PERSISTED_OUTPUT_END = '</persisted-output>';

/** 最大输出行数限制 */
const MAX_OUTPUT_LINES = 2000;

/** 输出阈值（字符数），超过此值使用持久化标签 */
const OUTPUT_THRESHOLD = 400000; // 400KB

/** 预览大小（字节） */
const PREVIEW_SIZE = 2000; // 2KB

/**
 * 智能截断输出内容
 * 优先在换行符处截断，以保持内容的可读性
 */
function truncateOutput(content: string, maxSize: number): { preview: string; hasMore: boolean } {
  if (content.length <= maxSize) {
    return { preview: content, hasMore: false };
  }

  // 找到最后一个换行符的位置
  const lastNewline = content.slice(0, maxSize).lastIndexOf('\n');

  // 如果换行符在前半部分（>50%），就在换行符处截断，否则直接截断
  const cutoff = lastNewline > maxSize * 0.5 ? lastNewline : maxSize;

  return {
    preview: content.slice(0, cutoff),
    hasMore: true,
  };
}

/**
 * 使用持久化标签包装大型输出
 * 生成带预览的持久化格式
 */
function wrapPersistedOutput(content: string): string {
  // 如果输出未超过阈值，直接返回
  if (content.length <= OUTPUT_THRESHOLD) {
    return content;
  }

  // 生成预览
  const { preview, hasMore } = truncateOutput(content, PREVIEW_SIZE);

  // 格式化持久化输出
  let result = `${PERSISTED_OUTPUT_START}\n`;
  result += `Preview (first ${PREVIEW_SIZE} bytes):\n`;
  result += preview;
  if (hasMore) {
    result += '\n...\n';
  } else {
    result += '\n';
  }
  result += PERSISTED_OUTPUT_END;

  return result;
}

/**
 * 格式化工具结果
 * 统一处理所有工具的输出，根据大小自动应用持久化
 */
function formatToolResult(
  toolName: string,
  result: { success: boolean; output?: string; error?: string }
): string {
  // 获取原始内容
  let content: string;
  if (!result.success) {
    content = `Error: ${result.error}`;
  } else {
    content = result.output || '';
  }

  // 统一应用持久化处理（根据大小自动决定）
  content = wrapPersistedOutput(content);

  return content;
}

/**
 * 清理消息历史中的旧持久化输出
 * 保留最近的 N 个持久化输出，清理更早的
 */
function cleanOldPersistedOutputs(messages: Message[], keepRecent: number = 3): Message[] {
  const persistedOutputIndices: number[] = [];

  // 找到所有包含持久化输出的消息索引
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'tool_result' &&
          typeof block.content === 'string' &&
          block.content.includes(PERSISTED_OUTPUT_START)
        ) {
          persistedOutputIndices.push(i);
          break;
        }
      }
    }
  }

  // 如果持久化输出数量超过限制，清理旧的
  if (persistedOutputIndices.length > keepRecent) {
    const indicesToClean = persistedOutputIndices.slice(0, -keepRecent);

    return messages.map((msg, index) => {
      if (!indicesToClean.includes(index)) {
        return msg;
      }

      // 清理这条消息中的持久化标签
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        return {
          ...msg,
          content: msg.content.map((block) => {
            if (
              typeof block === 'object' &&
              'type' in block &&
              block.type === 'tool_result' &&
              typeof block.content === 'string'
            ) {
              // 移除持久化标签，替换为简单的清理提示
              let content = block.content;
              if (content.includes(PERSISTED_OUTPUT_START)) {
                // 官方实现：直接替换为固定的清理消息
                content = '[Old tool result content cleared]';
              }
              return { ...block, content };
            }
            return block;
          }),
        };
      }

      return msg;
    });
  }

  return messages;
}

/**
 * 流式回调接口
 */
export interface StreamCallbacks {
  onThinkingStart?: () => void;
  onThinkingDelta?: (text: string) => void;
  onThinkingComplete?: () => void;
  onTextDelta?: (text: string) => void;
  onToolUseStart?: (toolUseId: string, toolName: string, input: unknown) => void;
  onToolUseDelta?: (toolUseId: string, partialJson: string) => void;
  onToolResult?: (toolUseId: string, success: boolean, output?: string, error?: string, data?: ToolResultData) => void;
  onPermissionRequest?: (request: any) => void;
  onComplete?: (stopReason: string | null, usage?: { inputTokens: number; outputTokens: number }) => void;
  onError?: (error: Error) => void;
  /** 上下文压缩事件：start=开始压缩, end=压缩完成, error=压缩失败 */
  onContextCompact?: (phase: 'start' | 'end' | 'error', info?: Record<string, any>) => void;
  /** 上下文使用量更新 */
  onContextUpdate?: (usage: { usedTokens: number; maxTokens: number; percentage: number; model: string }) => void;
}

/**
 * 会话状态
 */
interface SessionState {
  session: Session;
  client: ClaudeClient;
  messages: Message[];
  model: string;
  cancelled: boolean;
  chatHistory: ChatMessage[];
  userInteractionHandler: UserInteractionHandler;
  taskManager: TaskManager;
  permissionHandler: PermissionHandler;
  rewindManager: RewindManager;
  ws?: WebSocket;
  toolFilterConfig: import('../shared/types.js').ToolFilterConfig;
  systemPromptConfig: SystemPromptConfig;
  /** 标记会话是否正在处理对话（防止并发覆盖 ws） */
  isProcessing: boolean;
  /** 上一次 API 返回的实际 inputTokens（用于精确判断是否需要压缩） */
  lastActualInputTokens: number;
  /** 最后一次压缩的边界标记 UUID（对齐官方，用于增量压缩） */
  lastCompactedUuid?: string;
  /** 标记：处理中 WebSocket 被刷新替换，完成后需要重发 history */
  needsHistoryResend?: boolean;
  /** 用于取消正在执行的工具（如 Bash 命令）的 AbortController */
  currentAbortController?: AbortController;
  /** 正在流式生成的助手消息内容（用于浏览器刷新后恢复中间状态） */
  streamingContent?: {
    thinkingText: string;
    textContent: string;
  };
}

/**
 * 对话管理器
 */
export class ConversationManager {
  private sessions = new Map<string, SessionState>();
  private sessionManager: WebSessionManager;
  private cwd: string;
  private defaultModel: string;
  private mcpConfigManager: McpConfigManager;
  private options?: { verbose?: boolean };
  /** Chrome MCP 系统提示（与官方 wbA() 一致） */
  private chromeSystemPrompt?: string;
  /**
   * MCP 工具列表（与官方 mcp.tools 对应）
   * 官方架构：内置工具(registry) + MCP工具(state) 分离管理，查询时合并
   * 对应官方 LM6() / DV6() 合并逻辑
   */
  private mcpTools: Array<{ name: string; description: string; inputSchema: any; isMcp?: boolean }> = [];

  constructor(cwd: string, defaultModel: string = 'opus', options?: { verbose?: boolean }) {
    this.cwd = cwd;
    this.defaultModel = defaultModel;
    this.options = options;
    this.sessionManager = new WebSessionManager(cwd);
    this.mcpConfigManager = new McpConfigManager({
      validateCommands: true,
      autoSave: true,
    });
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    // 注册蓝图工具（仅 Web 模式需要，CLI 模式不加载）
    registerBlueprintTools();

    // v11.0: 注入 StartLeadAgent 自包含执行上下文（替代 executeTool 拦截模式）
    StartLeadAgentTool.setContext({
      getBlueprint: (id: string) => blueprintStore.get(id),
      saveBlueprint: (blueprint: Blueprint) => blueprintStore.save(blueprint),
      startExecution: (blueprint: Blueprint) => executionManager.startExecution(blueprint),
      waitForCompletion: async (sessionId: string) => {
        const result = await executionManager.waitForCompletion(sessionId);
        return { success: result.success, rawResponse: result.rawResponse };
      },
      // navigateToSwarm 在 createSession 中按会话设置（需要 ws 引用）
    });

    // 初始化认证系统（加载 OAuth token 或 API key）
    const auth = initAuth();
    if (auth) {
      console.log(`[ConversationManager] 认证类型: ${auth.type}${auth.accountType ? ` (${auth.accountType})` : ''}`);
    } else {
      console.warn('[ConversationManager] 警告: 未找到认证信息，请先运行 /login 登录');
    }

    // Skills 会在 SkillTool 第一次执行时延迟初始化
    // 此时在 runWithCwd 上下文中，可以正确获取工作目录

    // 【与官方架构一致】加载 Chrome MCP 集成
    // 官方模式：Chrome MCP 工具放入 mcp.tools（state），不注册到 toolRegistry
    // 通过 registerMcpServer() 预注册到 MCP 服务器映射，使 McpTool.execute() 可用
    try {
      const chromeConfig = await getChromeIntegrationConfig();
      if (chromeConfig) {
        for (const [name, config] of Object.entries(chromeConfig.mcpConfig)) {
          try {
            configManager.addMcpServer(name, config as any);
          } catch {
            // 可能已存在，忽略
          }
          // 注册到 MCP 服务器映射（预加载工具定义，使执行时可用）
          registerMcpServer(name, config as any, CHROME_MCP_TOOLS as any);
          // 将工具定义加入 mcpTools（对应官方 mcp.tools state）
          for (const tool of (CHROME_MCP_TOOLS as any[])) {
            this.mcpTools.push({
              name: `mcp__${name}__${tool.name}`,
              description: tool.description || '',
              inputSchema: tool.inputSchema || { type: 'object', properties: {} },
              isMcp: true,
            });
          }
        }
        this.chromeSystemPrompt = chromeConfig.systemPrompt;
        console.log(`[ConversationManager] Chrome MCP 工具已加载 (${this.mcpTools.length} tools)`);
      }
    } catch (error) {
      console.warn('[ConversationManager] Chrome 集成加载失败:', error);
    }

    // 【与 CLI cli.ts:382-391 一致】自动加载并连接所有配置的 MCP 服务器
    try {
      await this.initializeAllMcpServers();
    } catch (error) {
      console.warn('[ConversationManager] MCP 服务器初始化失败:', error);
    }

    // 确保工具已注册
    console.log(`[ConversationManager] 已注册 ${toolRegistry.getAll().length} 个工具`);
  }

  /**
   * 初始化所有配置的 MCP 服务器
   * 官方模式：连接服务器后，工具定义放入 mcpTools（state），不注册到 toolRegistry
   * 对应官方 useManageMcpConnections hook (e8q) 的状态更新逻辑
   */
  private async initializeAllMcpServers(): Promise<void> {
    const mcpServerConfigs = configManager.getMcpServers();
    const serverNames = Object.keys(mcpServerConfigs);
    if (serverNames.length === 0) return;

    const disabledServers = this.getDisabledMcpServers();
    let connectedCount = 0;
    let failedCount = 0;

    const connectionPromises = serverNames.map(async (name) => {
      const config = mcpServerConfigs[name];
      if (disabledServers.includes(name)) return;

      try {
        registerMcpServer(name, config);
        const connected = await connectMcpServer(name);
        if (connected) {
          connectedCount++;
          // 获取工具定义并加入 mcpTools（对应官方 state 更新）
          const tools = await createMcpTools(name);
          for (const tool of tools) {
            this.mcpTools.push({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.getInputSchema(),
              isMcp: true,
            });
          }
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
    });

    await Promise.all(connectionPromises);

    if (connectedCount > 0 || failedCount > 0) {
      console.log(`[ConversationManager] MCP: ${connectedCount} connected, ${failedCount} failed`);
    }
  }

  /**
   * 获取禁用的 MCP 服务器列表（与 CLI cli.ts:2610-2636 一致）
   */
  private getDisabledMcpServers(): string[] {
    try {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      const globalDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');
      const configPaths = [
        path.join(this.cwd, '.claude', 'settings.local.json'),
        path.join(this.cwd, '.claude', 'settings.json'),
        path.join(globalDir, 'settings.json'),
      ];
      for (const configPath of configPaths) {
        try {
          if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);
            if (config.disabledMcpServers && Array.isArray(config.disabledMcpServers)) {
              return config.disabledMcpServers;
            }
          }
        } catch {
          // 忽略单个文件读取错误
        }
      }
    } catch {
      // 忽略
    }
    return [];
  }

  /**
   * 根据认证信息构建 ClaudeClient 配置
   * 与核心 loop.ts 逻辑保持一致
   */
  private buildClientConfig(model: string): { model: string; apiKey?: string; authToken?: string; timeout?: number } {
    const auth = getAuth();
    const config: { model: string; apiKey?: string; authToken?: string; timeout?: number } = {
      model: this.getModelId(model),
      timeout: 300000,  // 5分钟 API 请求超时（对齐核心 loop.ts）
    };

    if (auth) {
      if (auth.type === 'api_key' && auth.apiKey) {
        config.apiKey = auth.apiKey;
      } else if (auth.type === 'oauth') {
        // 检查是否有 user:inference scope (Claude.ai 订阅用户)
        // 注意：auth.scopes 是数组形式，auth.scope 是旧格式
        const scopes = auth.scopes || auth.scope || [];
        const hasInferenceScope = scopes.includes('user:inference');

        // 获取 OAuth token（可能是 authToken 或 accessToken）
        const oauthToken = auth.authToken || auth.accessToken;

        if (hasInferenceScope && oauthToken) {
          // Claude.ai 订阅用户可以直接使用 OAuth token
          config.authToken = oauthToken;
        } else if (auth.oauthApiKey) {
          // Console 用户使用创建的 API Key
          config.apiKey = auth.oauthApiKey;
        }
      }
    }

    return config;
  }

  /**
   * 确保 OAuth token 有效（自动刷新）
   * 这个方法在每次调用 API 之前被调用，检查 token 是否过期，如果过期则自动刷新
   */
  private async ensureValidOAuthToken(state: SessionState): Promise<void> {
    const auth = getAuth();

    // 只有 OAuth 模式才需要刷新
    if (!auth || auth.type !== 'oauth') {
      return;
    }

    // 首先检查是否有 OAuth 配置
    const oauthConfig = oauthManager.getOAuthConfig();
    if (!oauthConfig) {
      // 没有 OAuth 配置（可能使用 API Key），无需刷新
      return;
    }

    // 检查 token 是否过期
    if (!oauthManager.isTokenExpired()) {
      // Token 还未过期，无需刷新
      return;
    }

    console.log('[ConversationManager] OAuth token 已过期，正在刷新...');

    try {
      // 刷新 token
      const refreshed = await oauthManager.refreshToken();

      console.log('[ConversationManager] OAuth token 刷新成功，过期时间:', new Date(refreshed.expiresAt));

      // 重新构建客户端配置并更新客户端
      const newConfig = this.buildClientConfig(state.model);

      // 更新客户端的 authToken
      if (newConfig.authToken) {
        // 创建新的客户端实例
        state.client = new ClaudeClient({
          apiKey: newConfig.apiKey,
          authToken: newConfig.authToken,
        });
        console.log('[ConversationManager] 客户端已更新为新的 OAuth token');
      } else if (newConfig.apiKey) {
        // OAuth 用户可能使用 API Key
        state.client = new ClaudeClient({
          apiKey: newConfig.apiKey,
          authToken: undefined,
        });
        console.log('[ConversationManager] 客户端已更新为 OAuth API Key');
      }
    } catch (error: any) {
      console.error('[ConversationManager] OAuth token 刷新失败:', error.message);
      throw new Error(`OAuth token 已过期，刷新失败: ${error.message}。请重新登录。`);
    }
  }

  /**
   * 获取或创建会话
   * @param permissionMode 可选，从客户端继承的权限模式（确保 YOLO 等模式跨会话持久化）
   */
  private async getOrCreateSession(sessionId: string, model?: string, projectPath?: string, permissionMode?: string): Promise<SessionState> {
    let state = this.sessions.get(sessionId);

    if (state) {
      // 会话已存在，检查是否需要更新工作目录
      if (projectPath && state.session.cwd !== projectPath) {
        console.log(`[ConversationManager] 更新会话 ${sessionId} 工作目录: ${state.session.cwd} -> ${projectPath}`);
        state.session.setWorkingDirectory(projectPath);
        await state.session.initializeGitInfo();
      }
      // 如果提供了权限模式，同步到现有会话（修复切换会话后权限模式丢失的问题）
      if (permissionMode) {
        state.permissionHandler.updateConfig({ mode: permissionMode as any });
      }
      return state;
    }

    // 创建新会话
    const workingDir = projectPath || this.cwd;
    console.log(`[ConversationManager] 创建新会话 ${sessionId}, workingDir: ${workingDir}, permissionMode: ${permissionMode || 'default'}`);

    const session = new Session(workingDir);
    await session.initializeGitInfo();

    // 使用与核心 loop.ts 一致的认证逻辑
    const clientConfig = this.buildClientConfig(model || this.defaultModel);
    const client = new ClaudeClient(clientConfig);

    // 创建用户交互处理器
    const userInteractionHandler = new UserInteractionHandler();

    // 创建任务管理器
    const taskManager = new TaskManager();

    // 创建权限处理器：优先使用客户端传入的权限模式，确保 YOLO 等模式跨会话生效
    const permissionHandler = new PermissionHandler({ mode: (permissionMode as any) || 'default' });

    // 创建 Rewind 管理器
    const rewindManager = new RewindManager(sessionId);

    state = {
      session,
      client,
      messages: [],
      model: model || this.defaultModel,
      cancelled: false,
      chatHistory: [],
      userInteractionHandler,
      taskManager,
      permissionHandler,
      rewindManager,
      toolFilterConfig: {
        mode: 'all', // 默认允许所有工具
      },
      systemPromptConfig: {
        useDefault: true, // 默认使用默认提示
      },
      isProcessing: false,
      lastActualInputTokens: 0,
    };

    this.sessions.set(sessionId, state);

    // 初始化 session memory（官方 session-memory 功能）
    if (isSessionMemoryEnabled()) {
      try {
        initSessionMemory(workingDir, sessionId);
        console.log(`[ConversationManager] 初始化 session memory: ${sessionId}, workingDir: ${workingDir}`);
      } catch (error) {
        console.warn('[ConversationManager] 初始化 session memory 失败:', error);
      }
    }

    // 初始化 Agent 笔记本系统（与 CLI loop.ts 保持一致）
    try {
      initNotebookManager(workingDir);
      console.log(`[ConversationManager] 初始化 NotebookManager: ${workingDir}`);
    } catch (error) {
      console.warn('[ConversationManager] 初始化 NotebookManager 失败:', error);
    }

    return state;
  }

  /**
   * 获取完整模型 ID
   * 使用 modelConfig.resolveAlias() 统一解析别名，确保与模型配置保持一致
   */
  private getModelId(shortName: string): string {
    // 使用统一的别名解析，避免硬编码
    return modelConfig.resolveAlias(shortName);
  }

  /**
   * 设置模型
   */
  setModel(sessionId: string, model: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.model = model;
      // 使用与核心 loop.ts 一致的认证逻辑
      const clientConfig = this.buildClientConfig(model);
      state.client = new ClaudeClient(clientConfig);
    }
  }

  /**
   * 获取历史记录
   */
  getHistory(sessionId: string): ChatMessage[] {
    const state = this.sessions.get(sessionId);
    return state?.chatHistory || [];
  }

  /**
   * 获取实时历史记录（用于浏览器刷新恢复）
   * 当会话正在处理中时，chatHistory 可能不完整（缺少工具调用的中间 turn），
   * 此方法从 state.messages 实时构建完整历史，确保所有中间步骤都能显示。
   */
  getLiveHistory(sessionId: string): ChatMessage[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];

    // 如果会话不在处理中，chatHistory 应该是完整的
    if (!state.isProcessing) {
      return state.chatHistory;
    }

    // 会话处理中：从 messages 实时构建，确保包含所有中间工具调用 turn
    return this.convertMessagesToChatHistory(state.messages);
  }

  /**
   * 清除历史
   */
  clearHistory(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.messages = [];
      state.chatHistory = [];
    }
  }

  /**
   * 取消当前操作
   */
  cancel(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.cancelled = true;
      // 中断正在执行的工具（如 Bash 命令），让 conversationLoop 的 Promise.race 立即返回
      state.currentAbortController?.abort();
      // 取消所有待处理的用户问题
      state.userInteractionHandler?.cancelAll();
      // 取消所有待处理的权限请求
      state.permissionHandler?.cancelAll();
    }
  }

  /**
   * 设置会话的 WebSocket 连接
   * 始终允许更新：页面刷新时旧 WebSocket 的 close 事件可能延迟到达，
   * 导致 readyState 仍为 OPEN，不能因此拒绝更新，否则新客户端收不到任何消息。
   * 多标签页场景下，最后连接的客户端获得会话输出（与主流 Web 应用行为一致）。
   */
  setWebSocket(sessionId: string, ws: WebSocket): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      if (state.isProcessing && state.ws && state.ws !== ws && state.ws.readyState === 1 /* OPEN */) {
        console.warn(`[ConversationManager] 会话 ${sessionId} 正在处理中，WebSocket 被新连接替换（可能是页面刷新或多标签页）`);
      }
      // 如果会话正在处理中且 WebSocket 实际发生了变化（页面刷新），标记完成后重发 history
      // 因为刷新后客户端没有 currentMessageRef
      // 注意：插话（interrupt）场景下 ws 是同一个连接，不应设置此标记
      if (state.isProcessing && state.ws !== ws) {
        state.needsHistoryResend = true;
        console.log(`[ConversationManager] 会话 ${sessionId} 处理中 ws 被替换，标记完成后重发 history`);
      }
      state.ws = ws;
      state.userInteractionHandler.setWebSocket(ws);
      state.taskManager.setWebSocket(ws);
    }
  }

  /**
   * 获取会话当前活跃的 WebSocket 连接
   * 用于流式回调中动态获取最新的 ws，解决页面刷新后旧闭包引用失效的问题
   */
  getWebSocket(sessionId: string): WebSocket | undefined {
    const state = this.sessions.get(sessionId);
    return state?.ws;
  }

  /**
   * 检查并消费 needsHistoryResend 标记
   * 返回 true 表示需要重发 history
   */
  consumeHistoryResendFlag(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    if (state?.needsHistoryResend) {
      state.needsHistoryResend = false;
      return true;
    }
    return false;
  }

  /**
   * 获取会话正在流式生成的中间内容（用于浏览器刷新后恢复）
   */
  getStreamingContent(sessionId: string): { thinkingText: string; textContent: string } | undefined {
    const state = this.sessions.get(sessionId);
    return state?.streamingContent;
  }

  /**
   * 检查会话是否正在处理中
   */
  isSessionProcessing(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    return state?.isProcessing ?? false;
  }

  /**
   * 处理用户回答
   */
  handleUserAnswer(sessionId: string, requestId: string, answer: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.userInteractionHandler.handleAnswer(requestId, answer);
    }
  }

  /**
   * 处理权限响应（从前端通过 WebSocket 传入）
   */
  handlePermissionResponse(
    sessionId: string,
    requestId: string,
    approved: boolean,
    remember?: boolean,
    scope?: 'once' | 'session' | 'always',
    destination?: PermissionDestination
  ): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.permissionHandler.handleResponse(requestId, approved, remember, scope, destination);
    }
  }

  /**
   * 更新权限配置（从前端通过 WebSocket 传入）
   */
  updatePermissionConfig(sessionId: string, config: Partial<PermissionConfig>): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.permissionHandler.updateConfig(config);
      console.log(`[ConversationManager] 权限配置已更新 (session: ${sessionId}):`, config);
    } else {
      console.warn(`[ConversationManager] 权限配置更新失败: 会话 ${sessionId} 不存在 (config: ${JSON.stringify(config)})`);
    }
  }

  /**
   * 获取当前权限配置
   */
  getPermissionConfig(sessionId: string): PermissionConfig | null {
    const state = this.sessions.get(sessionId);
    if (state) {
      return state.permissionHandler.getConfig();
    }
    return null;
  }

  /**
   * 媒体附件信息（图片或 PDF）
   */


  /**
   * 发送聊天消息
   */
  async chat(
    sessionId: string,
    content: string,
    mediaAttachments: Array<{ data: string; mimeType: string; type: 'image' }> | undefined,
    model: string,
    callbacks: StreamCallbacks,
    projectPath?: string,
    ws?: WebSocket,
    permissionMode?: string
  ): Promise<void> {
    const state = await this.getOrCreateSession(sessionId, model, projectPath, permissionMode);

    // 插话模式：如果会话正在处理中，取消当前操作并等待其完成
    if (state.isProcessing) {
      state.cancelled = true;
      state.currentAbortController?.abort();
      state.userInteractionHandler?.cancelAll();
      state.permissionHandler?.cancelAll();

      // 等待当前处理完成（带超时）
      const waitStart = Date.now();
      while (state.isProcessing && Date.now() - waitStart < 10000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (state.isProcessing) {
        callbacks.onError?.(new Error('取消当前操作超时，请重试'));
        return;
      }
    }

    state.cancelled = false;
    state.isProcessing = true;

    // 关键修复：确保会话的 WebSocket 已设置
    // 在 getOrCreateSession 后设置 WebSocket，保证 UserInteractionHandler 可用
    if (ws && ws.readyState === 1 /* WebSocket.OPEN */) {
      state.ws = ws;
      state.userInteractionHandler.setWebSocket(ws);
      state.taskManager.setWebSocket(ws);
    }

    try {
      // 构建用户消息
      const userMessage: Message = {
        role: 'user',
        content: content,
      };

      // 如果有图片附件，转换为多内容块格式（直接传递给 Claude API）
      if (mediaAttachments && mediaAttachments.length > 0) {
        const contentBlocks: any[] = [{ type: 'text', text: content }];
        for (const attachment of mediaAttachments) {
          contentBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: attachment.data,
            },
          });
        }
        userMessage.content = contentBlocks;
      }

      state.messages.push(userMessage);

      // 添加到聊天历史（包含图片附件以便刷新后回显）
      const chatContentItems: ChatContent[] = [];
      if (mediaAttachments && mediaAttachments.length > 0) {
        for (const attachment of mediaAttachments) {
          chatContentItems.push({
            type: 'image' as const,
            mediaType: attachment.mimeType,
            data: attachment.data,
          });
        }
      }
      chatContentItems.push({ type: 'text' as const, text: content });
      const chatEntry: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        timestamp: Date.now(),
        content: chatContentItems,
      };
      state.chatHistory.push(chatEntry);

      // WAL：立即追加用户消息（同步 appendFileSync，微秒级）
      if (sessionId) {
        walAppend(sessionId, 'msg', userMessage);
        walAppend(sessionId, 'chat', chatEntry);
      }

      // 使用工作目录上下文包裹对话循环（与 CLI loop.ts 保持一致）
      // 确保所有工具执行都在正确的工作目录上下文中
      await runWithCwd(state.session.cwd, async () => {
        await this.conversationLoop(state, callbacks, sessionId);
      });

    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      state.isProcessing = false;
    }
  }

  /**
   * 对话循环
   */
  private async conversationLoop(
    state: SessionState,
    callbacks: StreamCallbacks,
    sessionId?: string
  ): Promise<void> {
    let continueLoop = true;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let networkRetryCount = 0;
    /** 是否刚执行过因 "prompt too long" 而触发的强制压缩（防止无限循环） */
    let justForceCompacted = false;

    // 创建 AbortController，用于在取消时中断正在执行的工具
    state.currentAbortController = new AbortController();

    while (continueLoop && !state.cancelled) {
      // 标记本次迭代是否已有内容流式输出到前端
      // 如果有内容已输出，则不进行自动重试（避免前端内容重复）
      let hasStreamedContent = false;

      // 初始化流式中间内容追踪（用于浏览器刷新后恢复）
      state.streamingContent = { thinkingText: '', textContent: '' };

      // OAuth Token 自动刷新检查（在调用 API 之前）
      try {
        await this.ensureValidOAuthToken(state);
      } catch (error: any) {
        console.error('[ConversationManager] OAuth token 刷新失败:', error.message);
        // 继续尝试，让 API 调用返回真实错误
      }

      // 构建系统提示
      const systemPrompt = await this.buildSystemPrompt(state);

      // 获取工具定义（使用过滤后的工具列表）
      const tools = this.getFilteredTools(sessionId || '');

      // 在发送请求前清理旧的持久化输出（与 CLI 完全一致）
      let cleanedMessages = cleanOldPersistedOutputs(state.messages, 3);

      // AutoCompact：检查是否需要压缩上下文（对齐 CLI loop.ts 的 autoCompact）
      // 双重检查：1) 估算值检查  2) 上一次 API 实际 inputTokens 检查
      const resolvedModel = modelConfig.resolveAlias(state.model);
      const threshold = calculateAutoCompactThreshold(resolvedModel);
      const needsCompact = shouldAutoCompact(cleanedMessages, resolvedModel) ||
        (state.lastActualInputTokens > 0 && state.lastActualInputTokens >= threshold);

      if (needsCompact) {
        try {
          console.log(`[AutoCompact] 触发压缩 (lastActualTokens: ${state.lastActualInputTokens.toLocaleString()}, threshold: ${threshold.toLocaleString()})`);
          // 通知前端：开始压缩
          callbacks.onContextCompact?.('start', { threshold, estimatedTokens: state.lastActualInputTokens });
          // 关键：压缩前保存当前轮次的消息（最后一条非摘要 user 消息及其后的所有消息）
          // NJ1 摘要会把所有消息压缩为一条摘要，但当前轮次的用户请求不应丢弃
          let messagesToKeep: Message[] = [];
          for (let i = cleanedMessages.length - 1; i >= 0; i--) {
            const msg = cleanedMessages[i];
            if (msg.role === 'user' && !(msg as any).isCompactSummary) {
              messagesToKeep = cleanedMessages.slice(i);
              break;
            }
          }

          const compactResult = await this.performAutoCompact(cleanedMessages, resolvedModel, state);
          if (compactResult.wasCompacted) {
            // 修复：压缩后保留当前轮次的消息（对齐 CLI TJ1 的 messagesToKeep 逻辑）
            cleanedMessages = [...compactResult.messages, ...messagesToKeep];
            state.messages = [...compactResult.messages, ...messagesToKeep];
            state.lastActualInputTokens = 0; // 压缩后重置
            // 对齐官方：保存边界 UUID 用于增量压缩
            if (compactResult.boundaryUuid) {
              state.lastCompactedUuid = compactResult.boundaryUuid;
            }
            // 对齐官方 compact_boundary：在 chatHistory 追加分隔标记（只增不减）
            // 官方 CLI 的 mutableMessages 永远不会删除，压缩时追加 boundary + summary
            const compactBoundaryEntry: import('../shared/types.js').ChatMessage = {
              id: `compact-boundary-${Date.now()}`,
              role: 'system',
              timestamp: Date.now(),
              content: [{ type: 'text' as const, text: `对话已压缩，节省约 ${(compactResult.savedTokens || 0).toLocaleString()} tokens` }],
              isCompactBoundary: true,
            };
            state.chatHistory.push(compactBoundaryEntry);
            // 对齐官方：追加 summary 消息（isCompactSummary + isVisibleInTranscriptOnly）
            // 官方 CLI 中 summary 消息在 prompt 模式下隐藏，transcript 模式下才显示
            if (compactResult.summaryText) {
              const summaryEntry: import('../shared/types.js').ChatMessage = {
                id: `compact-summary-${Date.now()}`,
                role: 'user',
                timestamp: Date.now(),
                content: [{ type: 'text' as const, text: compactResult.summaryText }],
                isCompactSummary: true,
                isVisibleInTranscriptOnly: true,
              };
              state.chatHistory.push(summaryEntry);
            }
            console.log(`[AutoCompact] 上下文已压缩`);
            // 通知前端：压缩完成（包含 summaryText 以便前端追加 summary 消息）
            callbacks.onContextCompact?.('end', {
              threshold,
              savedTokens: compactResult.savedTokens || 0,
              summaryText: compactResult.summaryText,
            });
          }
        } catch (err) {
          console.warn('[AutoCompact] 压缩失败，使用原消息继续:', err);
          callbacks.onContextCompact?.('error', { message: String(err) });
        }
      }

      try {
        // 调用 Claude API（使用 createMessageStream，默认开启 Extended Thinking）
        // 传递 abort signal，取消时可直接中止 HTTP 流（对齐官方 CLI）
        const stream = state.client.createMessageStream(
          cleanedMessages,
          tools,
          systemPrompt,
          {
            enableThinking: true,
            thinkingBudget: 10000,
            signal: state.currentAbortController?.signal,
          }
        );

        // 处理流式响应
        const assistantContent: ContentBlock[] = [];
        let currentTextContent = '';
        let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
        let stopReason: string | null = null;
        let thinkingStarted = false;

        for await (const event of stream) {
          if (state.cancelled) break;

          switch (event.type) {
            case 'thinking':
              if (!thinkingStarted) {
                callbacks.onThinkingStart?.();
                thinkingStarted = true;
              }
              if (event.thinking) {
                // 追踪 thinking 内容（用于浏览器刷新恢复）
                if (state.streamingContent) {
                  state.streamingContent.thinkingText += event.thinking;
                }
                callbacks.onThinkingDelta?.(event.thinking);
              }
              break;

            case 'text':
              if (thinkingStarted) {
                callbacks.onThinkingComplete?.();
                thinkingStarted = false;
              }
              if (event.text) {
                hasStreamedContent = true;
                currentTextContent += event.text;
                // 追踪 text 内容（用于浏览器刷新恢复）
                if (state.streamingContent) {
                  state.streamingContent.textContent += event.text;
                }
                callbacks.onTextDelta?.(event.text);
              }
              break;

            case 'tool_use_start':
              hasStreamedContent = true;
              // 保存之前的文本内容
              if (currentTextContent) {
                assistantContent.push({ type: 'text', text: currentTextContent } as TextBlock);
                currentTextContent = '';
              }
              // 开始新的工具调用（先不发送 onToolUseStart，等参数解析完成后再发送）
              currentToolUse = {
                id: event.id || '',
                name: event.name || '',
                inputJson: '',
              };
              break;

            case 'tool_use_delta':
              if (currentToolUse && event.input) {
                currentToolUse.inputJson += event.input;
                callbacks.onToolUseDelta?.(currentToolUse.id, event.input);
              }
              break;

            case 'stop':
              // 完成当前文本块
              if (currentTextContent) {
                assistantContent.push({ type: 'text', text: currentTextContent } as TextBlock);
                currentTextContent = '';
              }
              // 完成当前工具调用
              if (currentToolUse) {
                let parsedInput = {};
                try {
                  parsedInput = JSON.parse(currentToolUse.inputJson || '{}');
                } catch (e) {
                  // 解析失败使用空对象
                }
                assistantContent.push({
                  type: 'tool_use',
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: parsedInput,
                } as ToolUseBlock);
                // 现在发送 onToolUseStart（参数已完整解析，只发送一次）
                callbacks.onToolUseStart?.(currentToolUse.id, currentToolUse.name, parsedInput);
                currentToolUse = null;
              }
              stopReason = event.stopReason || null;
              break;

            case 'usage':
              if (event.usage) {
                // 对齐官方：context 使用量 = inputTokens + cacheReadTokens + cacheCreationTokens
                // 开启 prompt caching 后，大部分 tokens 走缓存，inputTokens 可能极小（如 1）
                // 必须将 cache tokens 也计入，才能反映真实的上下文窗口占用
                const cacheRead = event.usage.cacheReadTokens || 0;
                const cacheCreation = event.usage.cacheCreationTokens || 0;
                totalInputTokens = (event.usage.inputTokens || 0) + cacheRead + cacheCreation;
                totalOutputTokens = event.usage.outputTokens || 0;
                // 记录实际 inputTokens 供下次循环迭代的自动压缩判断使用
                state.lastActualInputTokens = totalInputTokens;

                // 实时发送上下文使用量更新（每次 API 调用都更新，而非仅对话结束时）
                if (totalInputTokens > 0) {
                  const contextWindow = getContextWindowSize(resolvedModel);
                  const percentage = Math.min(100, Math.round((totalInputTokens / contextWindow) * 100));
                  callbacks.onContextUpdate?.({
                    usedTokens: totalInputTokens,
                    maxTokens: contextWindow,
                    percentage,
                    model: resolvedModel,
                  });
                }
              }
              break;

            case 'error':
              throw new Error(event.error || 'Unknown stream error');
          }
        }

        // API 调用成功完成，重置网络重试计数器和强制压缩标记
        networkRetryCount = 0;
        justForceCompacted = false;

        // 中断或正常结束时，保存未完成的文本内容
        if (currentTextContent) {
          assistantContent.push({ type: 'text', text: currentTextContent } as TextBlock);
          currentTextContent = '';
        }

        // 保存助手响应
        const assistantMsg: Message | null = assistantContent.length > 0
          ? { role: 'assistant', content: assistantContent }
          : null;
        if (assistantMsg) {
          state.messages.push(assistantMsg);
          // WAL：追加助手消息
          if (sessionId) walAppend(sessionId, 'msg', assistantMsg);
        }

        // 处理工具调用
        const toolUseBlocks = assistantContent.filter(
          (block): block is ToolUseBlock => block.type === 'tool_use'
        );

        if (toolUseBlocks.length > 0 && stopReason === 'tool_use') {
          // 执行工具并收集结果
          const toolResults: any[] = [];
          // 收集所有工具返回的 newMessages（对齐官网实现）
          const allNewMessages: Array<{ role: 'user'; content: any[] }> = [];

          for (const toolUse of toolUseBlocks) {
            if (state.cancelled) break;

            // 用 Promise.race 包裹，使 cancel 时 AbortController.abort() 能立即打断阻塞的工具执行
            const result = await this.executeToolWithCancellation(toolUse, state, callbacks);

            // 取消后不再处理后续结果
            if (state.cancelled) break;

            // 使用格式化函数处理工具结果（与 CLI 完全一致）
            const formattedContent = formatToolResult(toolUse.name, result);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: formattedContent,
            });

            // 收集 newMessages（对齐官网实现）
            if (result.newMessages && result.newMessages.length > 0) {
              allNewMessages.push(...result.newMessages);
            }
          }

          // 添加工具结果到消息
          if (toolResults.length > 0) {
            const toolResultMsg: Message = {
              role: 'user',
              content: toolResults,
            };
            state.messages.push(toolResultMsg);
            // WAL：追加工具结果消息
            if (sessionId) walAppend(sessionId, 'msg', toolResultMsg);

            // 添加 newMessages（对齐官网实现：skill 内容作为独立的 user 消息）
            for (const newMsg of allNewMessages) {
              state.messages.push(newMsg);
              // WAL：追加 newMessages
              if (sessionId) walAppend(sessionId, 'msg', newMsg);
            }
          }

          // 继续循环
          continueLoop = true;
        } else {
          // 对话结束
          continueLoop = false;

          // 添加到聊天历史
          const chatContent: ChatContent[] = assistantContent.map(block => {
            if (block.type === 'text') {
              return { type: 'text', text: (block as TextBlock).text };
            } else if (block.type === 'tool_use') {
              const toolBlock = block as ToolUseBlock;
              return {
                type: 'tool_use',
                id: toolBlock.id,
                name: toolBlock.name,
                input: toolBlock.input,
                status: 'completed' as const,
              };
            }
            return { type: 'text', text: '' };
          });

          const assistantChatEntry = {
            id: `assistant-${Date.now()}`,
            role: 'assistant' as const,
            timestamp: Date.now(),
            content: chatContent,
            model: state.model,
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          };
          state.chatHistory.push(assistantChatEntry);

          // 流式内容已完成，清除中间追踪（不再需要刷新恢复）
          state.streamingContent = undefined;

          // WAL：追加聊天历史条目
          if (sessionId) {
            walAppend(sessionId, 'chat', assistantChatEntry);
          }

          callbacks.onComplete?.(stopReason, {
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          });
        }

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        // 对齐官方 CLI：中断/取消导致的错误（AbortError）不重试、不报错，直接退出循环
        if (
          state.cancelled ||
          (error instanceof Error && error.name === 'AbortError') ||
          errMsg.includes('aborted') ||
          errMsg.includes('Request aborted by user')
        ) {
          console.log('[ConversationManager] 请求已被用户取消');
          continueLoop = false;
          continue;
        }

        // 检查是否为 "prompt is too long" 错误 —— 触发强制压缩并重试
        if (
          errMsg.includes('prompt is too long') &&
          !justForceCompacted &&
          !hasStreamedContent
        ) {
          console.warn(`[ConversationManager] 上下文超出限制，强制执行压缩并重试...`);
          justForceCompacted = true; // 防止无限循环
          try {
            callbacks.onContextCompact?.('start', { threshold: 0, estimatedTokens: 0, reason: 'prompt_too_long' });
            // 强制压缩前保留当前轮次的消息（与上面 autoCompact 逻辑一致）
            let forceKeepMsgs: Message[] = [];
            for (let i = state.messages.length - 1; i >= 0; i--) {
              const msg = state.messages[i];
              if (msg.role === 'user' && !(msg as any).isCompactSummary) {
                forceKeepMsgs = state.messages.slice(i);
                break;
              }
            }
            const compactResult = await this.performAutoCompact(state.messages, resolvedModel, state);
            if (compactResult.wasCompacted) {
              state.messages = [...compactResult.messages, ...forceKeepMsgs];
              state.lastActualInputTokens = 0;
              // 对齐官方：保存边界 UUID 用于增量压缩
              if (compactResult.boundaryUuid) {
                state.lastCompactedUuid = compactResult.boundaryUuid;
              }
              // 对齐官方 compact_boundary：在 chatHistory 追加分隔标记 + summary
              const forceBoundaryEntry: import('../shared/types.js').ChatMessage = {
                id: `compact-boundary-${Date.now()}`,
                role: 'system',
                timestamp: Date.now(),
                content: [{ type: 'text' as const, text: `对话已压缩，节省约 ${(compactResult.savedTokens || 0).toLocaleString()} tokens` }],
                isCompactBoundary: true,
              };
              state.chatHistory.push(forceBoundaryEntry);
              if (compactResult.summaryText) {
                const summaryEntry: import('../shared/types.js').ChatMessage = {
                  id: `compact-summary-${Date.now()}`,
                  role: 'user',
                  timestamp: Date.now(),
                  content: [{ type: 'text' as const, text: compactResult.summaryText }],
                  isCompactSummary: true,
                  isVisibleInTranscriptOnly: true,
                };
                state.chatHistory.push(summaryEntry);
              }
              console.log(`[AutoCompact] 强制压缩成功，重试 API 调用`);
              callbacks.onContextCompact?.('end', {
                savedTokens: compactResult.savedTokens || 0,
                summaryText: compactResult.summaryText,
              });
              continue; // 重新进入循环
            }
          } catch (compactErr) {
            console.error('[AutoCompact] 强制压缩失败:', compactErr);
            callbacks.onContextCompact?.('error', { message: String(compactErr) });
          }
          // 压缩失败，报告原始错误
          callbacks.onError?.(error instanceof Error ? error : new Error(errMsg));
          continueLoop = false;
          continue;
        }

        // 检查是否为可重试的网络错误
        // 条件：1) 错误类型可重试  2) 未超过最大重试次数  3) 尚无内容输出到前端
        if (
          isRetryableNetworkError(error) &&
          networkRetryCount < MAX_CONVERSATION_RETRIES &&
          !hasStreamedContent
        ) {
          networkRetryCount++;
          const delay = 1000 * Math.pow(2, networkRetryCount - 1); // 1s, 2s, 4s
          console.warn(
            `[ConversationManager] 网络错误 (${errMsg})，${delay}ms 后重试 (${networkRetryCount}/${MAX_CONVERSATION_RETRIES})...`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          // continueLoop 保持为 true，继续下一次循环迭代（重新发起 API 调用）
          continue;
        }

        console.error('[ConversationManager] API 错误:', error);
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
        continueLoop = false;
      }
    }

    // 对齐官方 CLI：修复孤立的 tool_use 块
    // 取消/中断时 assistant 消息可能已包含 tool_use 块，但缺少对应的 tool_result
    // 这会导致下次 API 调用报错，需要补充 error tool_result
    if (state.cancelled) {
      state.messages = validateToolResults(state.messages);
    }

    // 更新使用统计（与 CLI 完全一致）
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      const resolvedModel = modelConfig.resolveAlias(state.model);
      state.session.updateUsage(
        resolvedModel,
        {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
        },
        modelConfig.calculateCost(resolvedModel, {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thinkingTokens: 0,
        }),
        0,
        0
      );
    }

    // 关键修复：确保 chatHistory 与 messages 同步
    // 当会话被中断时，messages 可能已更新但 chatHistory 没有
    // 这会导致恢复会话时无法显示历史消息
    this.syncChatHistoryFromMessages(state);

    // 自动保存会话（与 CLI 完全一致）
    this.autoSaveSession(state);

    // WAL checkpoint：全量保存主 JSON 并清空 WAL
    // 此时所有消息已在 WAL 中有增量记录，checkpoint 做一次完整落盘后删除 WAL 文件
    if (sessionId) {
      const sessionData = this.sessionManager.loadSessionById(sessionId);
      if (sessionData) {
        // 同步最新状态到 sessionData
        sessionData.messages = state.messages;
        sessionData.chatHistory = state.chatHistory;
        sessionData.currentModel = state.model;
        (sessionData as any).toolFilterConfig = state.toolFilterConfig;
        (sessionData as any).systemPromptConfig = state.systemPromptConfig;
        sessionData.metadata.messageCount = state.messages.length;
        sessionData.metadata.updatedAt = Date.now();
        walCheckpoint(sessionData);
      } else {
        // fallback：sessionData 不存在时走老路径
        await this.persistSession(sessionId);
      }
    }

  }

  /**
   * 同步 chatHistory 与 messages
   * 修复中断时 chatHistory 未更新导致恢复会话无法显示历史的问题
   *
   * 关键保护：如果 chatHistory 中已有 compact_boundary 标记，说明经历过压缩，
   * 此时 messages 只包含压缩后的摘要消息，不能用 messages 重建 chatHistory，
   * 否则会丢失压缩前的完整对话历史。
   */
  private syncChatHistoryFromMessages(state: SessionState): void {
    // 保护：chatHistory 含有 compact_boundary → 已经历压缩，messages 不完整，不能重建
    const hasCompactBoundary = state.chatHistory.some(m => m.isCompactBoundary);
    if (hasCompactBoundary) {
      return;
    }

    // 统计 messages 中的 assistant 消息数量
    const assistantMsgCount = state.messages.filter(m => m.role === 'assistant').length;
    // 统计 chatHistory 中的 assistant 消息数量
    const assistantChatCount = state.chatHistory.filter(m => m.role === 'assistant').length;

    // 如果 messages 中的 assistant 消息比 chatHistory 多，说明有消息没有同步
    if (assistantMsgCount > assistantChatCount) {
      // 从 messages 重建 chatHistory
      state.chatHistory = this.convertMessagesToChatHistory(state.messages);
      console.log(`[ConversationManager] 同步 chatHistory: messages=${assistantMsgCount}, chatHistory=${state.chatHistory.filter(m => m.role === 'assistant').length}`);
    }
  }

  /**
   * 自动保存会话
   */
  private autoSaveSession(state: SessionState): void {
    try {
      state.session.save();
    } catch (err) {
      // 静默失败，不影响对话
      console.warn('[ConversationManager] Failed to auto-save session:', err);
    }
  }

  /**
   * 可取消的工具执行包装器
   * 使用 Promise.race 让 AbortController.abort() 能立即打断阻塞的工具执行（如 Bash 命令）
   * 避免取消后会话卡在 isProcessing=true 状态导致后续消息无法处理
   */
  private async executeToolWithCancellation(
    toolUse: ToolUseBlock,
    state: SessionState,
    callbacks: StreamCallbacks
  ): Promise<{ success: boolean; output?: string; error?: string; data?: ToolResultData; newMessages?: Array<{ role: 'user'; content: any[] }> }> {
    const signal = state.currentAbortController?.signal;

    // 已经被取消
    if (signal?.aborted) {
      return { success: false, error: 'Operation cancelled by user' };
    }

    // 如果没有 AbortController（不应该发生），直接执行
    if (!signal) {
      return this.executeTool(toolUse, state, callbacks);
    }

    // Promise.race: 工具执行 vs 取消信号
    const abortPromise = new Promise<{ success: boolean; error: string }>((resolve) => {
      if (signal.aborted) {
        resolve({ success: false, error: 'Operation cancelled by user' });
        return;
      }
      signal.addEventListener('abort', () => {
        resolve({ success: false, error: 'Operation cancelled by user' });
      }, { once: true });
    });

    return Promise.race([
      this.executeTool(toolUse, state, callbacks),
      abortPromise,
    ]);
  }

  private async executeTool(
    toolUse: ToolUseBlock,
    state: SessionState,
    callbacks: StreamCallbacks
  ): Promise<{ success: boolean; output?: string; error?: string; data?: ToolResultData; newMessages?: Array<{ role: 'user'; content: any[] }> }> {
    const tool = toolRegistry.get(toolUse.name);

    // MCP 工具不在 toolRegistry 中，通过 mcpTools state 管理
    // 对应官方架构：MCP 工具通过 callMcpTool() 直接执行
    const isMcpTool = !tool && toolUse.name.startsWith('mcp__');

    if (!tool && !isMcpTool) {
      const error = `未知工具: ${toolUse.name}`;
      callbacks.onToolResult?.(toolUse.id, false, undefined, error);
      return { success: false, error };
    }

    // 检查工具是否被过滤
    if (!this.isToolEnabled(toolUse.name, state.toolFilterConfig)) {
      const error = `工具 ${toolUse.name} 已被禁用`;
      callbacks.onToolResult?.(toolUse.id, false, undefined, error);
      return { success: false, error };
    }

    // ========================================================================
    // 权限检查（对齐 CLI loop.ts 的 handlePermissionRequest 逻辑）
    // ========================================================================
    try {
      const permissionResult = await this.checkToolPermission(toolUse, state, callbacks);
      if (permissionResult === 'denied') {
        const error = `用户拒绝了 ${toolUse.name} 的执行权限`;
        callbacks.onToolResult?.(toolUse.id, false, undefined, error);
        return { success: false, error };
      }
      // permissionResult === 'allowed' 或 'skipped'（无需权限），继续执行
    } catch (permError) {
      // 权限请求超时或被取消
      const error = permError instanceof Error ? permError.message : '权限请求失败';
      callbacks.onToolResult?.(toolUse.id, false, undefined, error);
      return { success: false, error };
    }

    // ========================================================================
    // PreToolUse Hook（对齐 CLI loop.ts 的 Hook 系统）
    // ========================================================================
    const hookSessionId = state.session.sessionId || '';
    try {
      const hookResult = await runPreToolUseHooks(toolUse.name, toolUse.input, hookSessionId);
      if (!hookResult.allowed) {
        const error = hookResult.message || `PreToolUse hook 阻止了 ${toolUse.name} 的执行`;
        callbacks.onToolResult?.(toolUse.id, false, undefined, error);
        return { success: false, error };
      }
    } catch (hookError) {
      // Hook 执行失败不阻止工具执行
      console.warn(`[Hook] PreToolUse hook 执行失败:`, hookError);
    }

    try {
      console.log(`[Tool] 执行 ${toolUse.name}:`, JSON.stringify(toolUse.input).slice(0, 200));

      // 拦截 Task 工具 - WebUI 模式下使用同步执行 + WebSocket 实时推送
      // 不再默认后台执行，避免 TaskOutput 多次轮询的性能浪费
      if (toolUse.name === 'Task') {
        const input = toolUse.input as any;
        const description = input.description || 'Background task';
        const prompt = input.prompt || '';
        const agentType = input.subagent_type || 'general-purpose';

        // 验证必需参数
        if (!prompt) {
          const error = 'Task prompt is required';
          callbacks.onToolResult?.(toolUse.id, false, undefined, error);
          return { success: false, error };
        }

        try {
          // WebUI 始终使用同步执行：await 拿结果，中间过程由 TaskManager 通过 WebSocket 实时推送
          const result = await state.taskManager.executeTaskSync(
            description,
            prompt,
            agentType,
            {
              model: input.model || state.model,
              parentMessages: state.messages,
              workingDirectory: state.session.cwd,
            }
          );

          const output = result.success
            ? (result.output || 'Task completed successfully')
            : `Task failed: ${result.error || 'Unknown error'}`;

          callbacks.onToolResult?.(toolUse.id, result.success, output, result.success ? undefined : result.error, {
            tool: 'Task',
            agentType,
            description,
            status: 'completed',
            output,
          });

          return { success: result.success, output };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Tool] Task 执行失败:`, errorMessage);
          callbacks.onToolResult?.(toolUse.id, false, undefined, errorMessage);
          return { success: false, error: errorMessage };
        }
      }

      // 拦截 TaskOutput 工具 - 从 TaskManager 获取任务输出
      if (toolUse.name === 'TaskOutput') {
        const input = toolUse.input as any;
        const taskId = input.task_id;
        const block = input.block !== false;
        const timeout = input.timeout || 300000; // 默认5分钟超时
        const showHistory = input.show_history || false;

        if (!taskId) {
          const error = 'task_id is required';
          callbacks.onToolResult?.(toolUse.id, false, undefined, error);
          return { success: false, error };
        }

        try {
          const task = state.taskManager.getTask(taskId);

          if (!task) {
            const error = `Task ${taskId} not found`;
            callbacks.onToolResult?.(toolUse.id, false, undefined, error);
            return { success: false, error };
          }

          // 如果需要阻塞等待完成
          if (block && task.status === 'running') {
            const startTime = Date.now();
            while (task.status === 'running' && (Date.now() - startTime) < timeout) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }

            if (task.status === 'running') {
              const output = `Task ${taskId} is still running (timeout reached).\n\nStatus: ${task.status}\nDescription: ${task.description}`;
              callbacks.onToolResult?.(toolUse.id, true, output);
              return { success: true, output };
            }
          }

          // 构建输出
          let output = `Task: ${task.description}\n`;
          output += `ID: ${taskId}\n`;
          output += `Agent Type: ${task.agentType}\n`;
          output += `Status: ${task.status}\n`;
          output += `Started: ${task.startTime.toLocaleString('zh-CN')}\n`;

          if (task.endTime) {
            const duration = ((task.endTime.getTime() - task.startTime.getTime()) / 1000).toFixed(1);
            output += `Ended: ${task.endTime.toLocaleString('zh-CN')}\n`;
            output += `Duration: ${duration}s\n`;
          }

          if (task.progress) {
            output += `\nProgress: ${task.progress.current}/${task.progress.total}`;
            if (task.progress.message) {
              output += ` - ${task.progress.message}`;
            }
            output += '\n';
          }

          // 获取任务输出
          const taskOutput = state.taskManager.getTaskOutput(taskId);
          if (taskOutput) {
            output += `\n${'='.repeat(50)}\nOutput:\n${'='.repeat(50)}\n${taskOutput}`;
          } else if (task.status === 'running') {
            output += '\nTask is still running. No output available yet.';
          } else if (task.error) {
            output += `\nError: ${task.error}`;
          }

          callbacks.onToolResult?.(toolUse.id, true, output);
          return { success: true, output };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Tool] TaskOutput 执行失败:`, errorMessage);
          callbacks.onToolResult?.(toolUse.id, false, undefined, errorMessage);
          return { success: false, error: errorMessage };
        }
      }

      // 拦截 AskUserQuestion 工具 - 通过 WebSocket 向前端发送问题
      if (toolUse.name === 'AskUserQuestion') {
        const input = toolUse.input as any;
        const questions = input.questions || [];

        if (questions.length === 0) {
          const error = 'No questions provided';
          callbacks.onToolResult?.(toolUse.id, false, undefined, error);
          return { success: false, error };
        }

        const answers: Record<string, string> = {};

        try {
          // 逐个发送问题并等待回答
          for (const question of questions) {
            const answer = await state.userInteractionHandler.askQuestion({
              question: question.question,
              header: question.header,
              options: question.options,
              multiSelect: question.multiSelect,
              timeout: 300000, // 5分钟超时
            });
            answers[question.header] = answer;
          }

          // 格式化答案输出（使用官方格式）
          const formattedAnswers = Object.entries(answers)
            .map(([header, answer]) => `"${header}"="${answer}"`)
            .join(', ');
          const output = `User has answered your questions: ${formattedAnswers}. You can now continue with the user's answers in mind.`;

          callbacks.onToolResult?.(toolUse.id, true, output);
          return { success: true, output };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Tool] AskUserQuestion 失败:`, errorMessage);
          callbacks.onToolResult?.(toolUse.id, false, undefined, errorMessage);
          return { success: false, error: errorMessage };
        }
      }

      // 拦截 GenerateBlueprint 工具 - 将对话需求结构化为蓝图
      if (toolUse.name === 'GenerateBlueprint') {
        const input = toolUse.input as any;
        try {
          const blueprintId = `bp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const blueprint: Blueprint = {
            id: blueprintId,
            name: input.name,
            description: input.description,
            projectPath: state.session.cwd,
            status: 'confirmed',
            requirements: input.requirements || [],
            techStack: input.techStack || {},
            constraints: input.constraints || [],
            brief: input.brief,
            createdAt: new Date(),
            updatedAt: new Date(),
            confirmedAt: new Date(),
          };

          blueprintStore.save(blueprint);

          // 通知前端蓝图已创建
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({
              type: 'blueprint_created',
              payload: { blueprintId: blueprint.id, name: blueprint.name },
            }));
          }

          const output = `蓝图已生成并保存。\n蓝图ID: ${blueprint.id}\n项目名: ${blueprint.name}\n需求数: ${blueprint.requirements?.length || 0}\n\n现在可以调用 StartLeadAgent 启动执行。`;
          callbacks.onToolResult?.(toolUse.id, true, output);
          return { success: true, output };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Tool] GenerateBlueprint 执行失败:`, errorMessage);
          callbacks.onToolResult?.(toolUse.id, false, undefined, errorMessage);
          return { success: false, error: errorMessage };
        }
      }

      // v11.0: StartLeadAgent 不再拦截，走正常 tool.execute() 路径
      // 执行前动态绑定当前会话的 WebSocket，用于前端导航通知
      if (toolUse.name === 'StartLeadAgent') {
        const currentCtx = StartLeadAgentTool.getContext();
        if (currentCtx) {
          StartLeadAgentTool.setContext({
            ...currentCtx,
            navigateToSwarm: (blueprintId: string, executionId: string) => {
              if (state.ws && state.ws.readyState === 1) {
                state.ws.send(JSON.stringify({
                  type: 'navigate_to_swarm',
                  payload: { blueprintId, executionId },
                }));
              }
            },
          });
        }
      }

      // 拦截 GenerateDesign 工具 - 使用 Gemini 生成 UI 设计图
      if (toolUse.name === 'GenerateDesign') {
        const input = toolUse.input as any;

        try {
          console.log(`[Tool] GenerateDesign: 开始生成设计图 - ${input.projectName}`);

          const result = await geminiImageService.generateDesign({
            projectName: input.projectName,
            projectDescription: input.projectDescription,
            requirements: input.requirements || [],
            constraints: input.constraints,
            techStack: input.techStack,
            style: input.style,
          });

          if (!result.success) {
            const error = result.error || '设计图生成失败';
            callbacks.onToolResult?.(toolUse.id, false, undefined, error);
            return { success: false, error };
          }

          // 通过 WebSocket 发送设计图给前端显示
          if (state.ws && state.ws.readyState === 1) {
            state.ws.send(JSON.stringify({
              type: 'design_image_generated',
              payload: {
                imageUrl: result.imageUrl,
                projectName: input.projectName,
                style: input.style || 'modern',
                generatedText: result.generatedText,
              },
            }));
          }

          const output = `UI 设计图已生成并发送给用户预览。${result.generatedText ? `\n\n设计说明: ${result.generatedText}` : ''}\n\n用户可以在聊天界面中查看设计预览图。`;
          callbacks.onToolResult?.(toolUse.id, true, output);
          return { success: true, output };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`[Tool] GenerateDesign 执行失败:`, errorMessage);
          callbacks.onToolResult?.(toolUse.id, false, undefined, errorMessage);
          return { success: false, error: errorMessage };
        }
      }

      // MCP 工具执行：解析 mcp__{serverName}__{toolName} 格式，调用 callMcpTool()
      if (isMcpTool) {
        const parts = toolUse.name.split('__');
        // 格式: mcp__{serverName}__{toolName}
        const mcpServerName = parts[1];
        const mcpToolName = parts.slice(2).join('__');

        if (!mcpServerName || !mcpToolName) {
          const error = `Invalid MCP tool name format: ${toolUse.name}`;
          callbacks.onToolResult?.(toolUse.id, false, undefined, error);
          return { success: false, error };
        }

        const mcpResult = await callMcpTool(mcpServerName, mcpToolName, toolUse.input);
        const mcpOutput = mcpResult.output || mcpResult.error || JSON.stringify(mcpResult);
        const truncatedMcpOutput = mcpOutput.length > 50000
          ? mcpOutput.slice(0, 50000) + '\n... (输出已截断)'
          : mcpOutput;

        // PostToolUse Hook
        try {
          await runPostToolUseHooks(toolUse.name, toolUse.input, truncatedMcpOutput, hookSessionId);
        } catch (hookError) {
          console.warn(`[Hook] PostToolUse hook 执行失败:`, hookError);
        }

        callbacks.onToolResult?.(toolUse.id, mcpResult.success, truncatedMcpOutput, mcpResult.error ? mcpResult.error : undefined);
        return { success: mcpResult.success, output: truncatedMcpOutput, error: mcpResult.error };
      }

      // 执行其他工具（内置 registry 工具）
      const result = await tool!.execute(toolUse.input);

      // 构建结构化数据
      const data = this.buildToolResultData(toolUse.name, toolUse.input, result);

      // 格式化输出
      let output: string;
      if (typeof result === 'string') {
        output = result;
      } else if (result && typeof result === 'object') {
        if ('output' in result) {
          output = result.output as string;
        } else if ('content' in result) {
          output = result.content as string;
        } else {
          output = JSON.stringify(result, null, 2);
        }
      } else {
        output = String(result);
      }

      // 截断过长输出
      const maxOutputLength = 50000;
      if (output.length > maxOutputLength) {
        output = output.slice(0, maxOutputLength) + '\n... (输出已截断)';
      }

      // 提取 newMessages（对齐官网实现：Skill 工具返回的额外消息）
      const newMessages =
        result && typeof result === 'object' && 'newMessages' in result
          ? (result.newMessages as Array<{ role: 'user'; content: any[] }>)
          : undefined;

      // PostToolUse Hook
      try {
        await runPostToolUseHooks(toolUse.name, toolUse.input, output, hookSessionId);
      } catch (hookError) {
        console.warn(`[Hook] PostToolUse hook 执行失败:`, hookError);
      }

      callbacks.onToolResult?.(toolUse.id, true, output, undefined, data);
      return { success: true, output, data, newMessages };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Tool] ${toolUse.name} 执行失败:`, errorMessage);

      // PostToolUseFailure Hook
      try {
        await runPostToolUseFailureHooks(
          toolUse.name,
          toolUse.input,
          toolUse.id,
          errorMessage,
          'execution_failed',
          false,
          false,
          hookSessionId
        );
      } catch (hookError) {
        console.warn(`[Hook] PostToolUseFailure hook 执行失败:`, hookError);
      }

      callbacks.onToolResult?.(toolUse.id, false, undefined, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * 执行 AutoCompact（对齐官方 CLI oj1 + SQ1 + Au1 + oT9）
   *
   * 压缩优先级：
   * 1. TJ1: Session Memory 压缩（增量压缩）
   * 2. NJ1: 对话摘要压缩（AI 生成摘要）
   *
   * 压缩结果结构（对齐官方）：
   * - boundaryMarker: 压缩边界标记（type: "user", 带 uuid）
   * - summaryMessage: 摘要消息（type: "user", isCompactSummary: true）
   */
  private async performAutoCompact(
    messages: Message[],
    model: string,
    state: SessionState
  ): Promise<{ wasCompacted: boolean; messages: Message[]; savedTokens?: number; boundaryUuid?: string; summaryText?: string }> {
    const threshold = calculateAutoCompactThreshold(model);

    // 1. 尝试 Session Memory 压缩 (TJ1)
    if (isSessionMemoryEnabled()) {
      try {
        const memoryContent = await readSessionMemory(state.session.cwd, state.session.sessionId || '');
        if (memoryContent && memoryContent.trim().length > 0) {
          // 对齐官方 Au1 函数：格式化为标准摘要内容
          const formattedContent = formatCompactSummaryContent(memoryContent, true);

          const summaryTokens = Math.ceil(formattedContent.length / 4);
          if (summaryTokens < threshold * 0.5) {
            // 对齐官方 SQ1 函数：创建 compact_boundary 边界标记
            const boundaryUuid = `sm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const boundaryMarker: Message = {
              role: 'user',
              content: `--- Session Memory Compacted (auto) ---\nPrevious messages were compressed using Session Memory.`,
              uuid: boundaryUuid,
            };

            const summaryMessage: Message = {
              role: 'user',
              content: formattedContent,
              isCompactSummary: true,
              isVisibleInTranscriptOnly: true,
            };

            const savedTokens = Math.max(0, (state.lastActualInputTokens || threshold) - summaryTokens);
            console.log(`[AutoCompact/TJ1] Session Memory 压缩成功，节省约 ${savedTokens.toLocaleString()} tokens`);
            return { wasCompacted: true, messages: [boundaryMarker, summaryMessage], savedTokens, boundaryUuid, summaryText: formattedContent };
          }
        }
      } catch (err) {
        console.warn('[AutoCompact/TJ1] Session Memory 压缩失败:', err);
      }
    }

    // 2. 尝试对话摘要 (NJ1) — 对齐官方 oj1 压缩函数
    try {
      // 对齐官方 dDA 函数：使用完整的摘要 prompt（含 <analysis> + <summary> 结构）
      const summaryPrompt = generateSummaryPrompt();

      const summaryMessages: Message[] = [
        ...messages,
        { role: 'user', content: summaryPrompt },
      ];

      const response = await state.client.createMessage(
        summaryMessages,
        undefined, // 不需要工具（对齐官方：compaction agent should only produce text summary）
        'You are a helpful AI assistant tasked with summarizing conversations concisely while preserving all critical technical details.'
      );

      let summaryText = '';
      if (Array.isArray(response.content)) {
        for (const block of response.content) {
          if (block.type === 'text') {
            summaryText += (block as any).text;
          }
        }
      }

      if (summaryText && summaryText.trim().length > 0) {
        // 对齐官方 SQ1 函数：创建 compact_boundary 边界标记
        const boundaryUuid = `nj1-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const boundaryMarker: Message = {
          role: 'user',
          content: `--- Conversation Compacted (auto) ---\nPrevious messages were summarized.`,
          uuid: boundaryUuid,
        };

        // 对齐官方 Au1 函数：格式化摘要内容
        const formattedContent = formatCompactSummaryContent(summaryText, false);
        const summaryMessage: Message = {
          role: 'user',
          content: formattedContent,
          isCompactSummary: true,
          isVisibleInTranscriptOnly: true,
        };

        const summaryTokens = Math.ceil(formattedContent.length / 4);
        const savedTokens = Math.max(0, (state.lastActualInputTokens || threshold) - summaryTokens);
        console.log(`[AutoCompact/NJ1] 对话摘要压缩成功，节省约 ${savedTokens.toLocaleString()} tokens`);
        return { wasCompacted: true, messages: [boundaryMarker, summaryMessage], savedTokens, boundaryUuid, summaryText: formattedContent };
      }
    } catch (err) {
      console.warn('[AutoCompact/NJ1] 对话摘要压缩失败:', err);
    }

    return { wasCompacted: false, messages };
  }

  /**
   * 检查工具执行权限（对齐 CLI loop.ts 的 handlePermissionRequest）
   *
   * 检查流程：
   * 1. 先检查会话级权限记忆
   * 2. 再检查是否需要权限确认
   * 3. 如果需要，通过 WebSocket 发送权限请求到前端
   * 4. 等待用户响应
   *
   * @returns 'allowed' | 'denied' | 'skipped'
   */
  private async checkToolPermission(
    toolUse: ToolUseBlock,
    state: SessionState,
    callbacks: StreamCallbacks
  ): Promise<'allowed' | 'denied' | 'skipped'> {
    const handler = state.permissionHandler;

    // 1. 检查会话级权限记忆
    const remembered = handler.checkSessionMemory(toolUse.name, toolUse.input);
    if (remembered !== null) {
      console.log(`[Permission] 使用会话记忆: ${toolUse.name} -> ${remembered ? 'allowed' : 'denied'}`);
      return remembered ? 'allowed' : 'denied';
    }

    // 2. 检查是否需要权限确认
    if (!handler.needsPermission(toolUse.name, toolUse.input)) {
      return 'skipped';
    }

    // 3. 如果没有 WebSocket 连接（比如后台任务），降级为自动允许
    if (!state.ws || state.ws.readyState !== 1 /* WebSocket.OPEN */) {
      console.warn(`[Permission] 无 WebSocket 连接，自动允许 ${toolUse.name}`);
      return 'allowed';
    }

    // 4. 通过 WebSocket 请求权限
    console.log(`[Permission] 请求权限: ${toolUse.name}`);

    const approved = await handler.requestPermission(
      toolUse.name,
      toolUse.input,
      (request: PermissionRequest) => {
        // 通过回调发送权限请求到前端
        callbacks.onPermissionRequest?.(request);
      }
    );

    console.log(`[Permission] 权限响应: ${toolUse.name} -> ${approved ? 'allowed' : 'denied'}`);
    return approved ? 'allowed' : 'denied';
  }

  /**
   * 构建工具结果的结构化数据
   */
  private buildToolResultData(
    toolName: string,
    input: unknown,
    result: unknown
  ): ToolResultData | undefined {
    const inputObj = input as Record<string, unknown>;

    switch (toolName) {
      case 'Bash':
        return {
          tool: 'Bash',
          command: (inputObj.command as string) || '',
          exitCode: (result as any)?.exitCode,
          stdout: (result as any)?.stdout || (result as any)?.output,
          stderr: (result as any)?.stderr,
          duration: (result as any)?.duration,
        };

      case 'Read':
        const content = typeof result === 'string' ? result : (result as any)?.content || '';
        return {
          tool: 'Read',
          filePath: (inputObj.file_path as string) || '',
          content: content.slice(0, 10000), // 限制长度
          lineCount: content.split('\n').length,
          language: this.detectLanguage((inputObj.file_path as string) || ''),
        };

      case 'Write':
        return {
          tool: 'Write',
          filePath: (inputObj.file_path as string) || '',
          bytesWritten: (inputObj.content as string)?.length || 0,
        };

      case 'Edit':
        return {
          tool: 'Edit',
          filePath: (inputObj.file_path as string) || '',
          diff: [], // 需要解析 diff
          linesAdded: 0,
          linesRemoved: 0,
        };

      case 'Glob':
        const files = Array.isArray(result) ? result :
          typeof result === 'string' ? result.split('\n').filter(Boolean) :
          (result as any)?.files || [];
        return {
          tool: 'Glob',
          pattern: (inputObj.pattern as string) || '',
          files: files.slice(0, 100),
          totalCount: files.length,
        };

      case 'Grep':
        return {
          tool: 'Grep',
          pattern: (inputObj.pattern as string) || '',
          matches: [],
          totalCount: 0,
        };

      case 'WebFetch':
        return {
          tool: 'WebFetch',
          url: (inputObj.url as string) || '',
          title: (result as any)?.title,
          contentPreview: typeof result === 'string' ? result.slice(0, 500) : undefined,
        };

      case 'WebSearch':
        return {
          tool: 'WebSearch',
          query: (inputObj.query as string) || '',
          results: (result as any)?.results || [],
        };

      case 'TodoWrite':
        return {
          tool: 'TodoWrite',
          todos: (inputObj.todos as any[]) || [],
        };

      case 'Task':
        return {
          tool: 'Task',
          agentType: (inputObj.subagent_type as string) || 'general-purpose',
          description: (inputObj.description as string) || '',
          status: 'completed',
          output: typeof result === 'string' ? result : JSON.stringify(result),
        };

      default:
        return undefined;
    }
  }

  /**
   * 检测文件语言
   */
  private detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      sql: 'sql',
      md: 'markdown',
      txt: 'text',
    };
    return langMap[ext || ''] || 'text';
  }

  /**
   * 构建系统提示（与 CLI 完全一致，仅在末尾追加记忆单元）
   */
  private async buildSystemPrompt(state: SessionState): Promise<string> {
    const config = state.systemPromptConfig;

    // 如果使用自定义提示（完全替换）
    if (!config.useDefault && config.customPrompt) {
      return config.customPrompt;
    }

    let prompt: string;

    // 使用与 CLI 完全相同的系统提示构建逻辑
    try {
      // 检查是否为 Git 仓库
      const isGitRepo = this.checkIsGitRepo(state.session.cwd);

      // Agent 笔记本：每轮刷新笔记本内容（与 CLI loop.ts 保持一致）
      let notebookSummary: string | undefined;
      try {
        const nbMgr = getNotebookManager();
        if (nbMgr) {
          notebookSummary = nbMgr.getNotebookSummaryForPrompt() || undefined;
        }
      } catch {
        // 笔记本加载失败不影响主流程
      }

      // 构建 MCP 服务器信息（用于 getMcpInstructions）
      const mcpServerInfos: Array<{ name: string; type: string; instructions?: string }> = [];
      for (const [name, server] of getMcpServers()) {
        mcpServerInfos.push({
          name,
          type: server.connected ? 'connected' : 'disconnected',
          instructions: (server.config as any)?.instructions,
        });
      }

      // 构建提示上下文（与 CLI loop.ts 保持一致）
      const promptContext = {
        workingDir: state.session.cwd,
        model: this.getModelId(state.model),
        permissionMode: undefined, // WebUI 不使用权限模式
        planMode: false,
        delegateMode: false,
        ideType: undefined, // WebUI 没有 IDE 类型
        platform: process.platform,
        todayDate: new Date().toISOString().split('T')[0],
        isGitRepo,
        debug: false,
        // v2.1.0+: 语言配置 - 与 CLI 保持一致
        language: configManager.get('language'),
        // Agent 笔记本内容
        notebookSummary,
        // MCP 服务器信息（用于系统提示中的 MCP 指令）
        mcpServers: mcpServerInfos.length > 0 ? mcpServerInfos : undefined,
      };

      // 使用官方的 SystemPromptBuilder
      const buildResult = await systemPromptBuilder.build(promptContext);
      prompt = buildResult.content;

      if (this.options?.verbose) {
        console.log(`[SystemPrompt] Built in ${buildResult.buildTimeMs}ms, ${buildResult.hashInfo.estimatedTokens} tokens`);
      }
    } catch (error) {
      console.warn('[ConversationManager] Failed to build system prompt, using default:', error);
      // 降级到默认提示
      prompt = this.getDefaultSystemPrompt();
    }

    // 【与 CLI cli.ts:397-398 一致】如果 Chrome 集成已启用，前置 Chrome 系统提示
    if (this.chromeSystemPrompt) {
      prompt = `${this.chromeSystemPrompt}\n\n${prompt}`;
    }

    // 如果有追加提示，添加到默认提示后
    if (config.useDefault && config.appendPrompt) {
      prompt += '\n\n' + config.appendPrompt;
    }

    // 注入 WebUI 专属工具引导（GenerateDesign 等）
    const webuiToolGuidance = this.buildWebuiToolGuidance();
    if (webuiToolGuidance) {
      prompt += '\n\n' + webuiToolGuidance;
    }

    return prompt;
  }

  /**
   * 构建 WebUI 专属工具引导指令
   * 让 Agent 知道何时应主动调用 WebUI 专属工具（如 GenerateDesign）
   */
  private buildWebuiToolGuidance(): string | null {
    const sections: string[] = [];

    // GenerateDesign 工具引导（需要 GEMINI_API_KEY）
    const hasGeminiKey = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    if (hasGeminiKey) {
      sections.push(`# UI 设计图生成（GenerateDesign 工具）

你拥有一个强大的 GenerateDesign 工具，可以调用 Gemini AI 实时生成 UI 设计图/界面原型图。

## 主动调用时机
在以下场景中，你应该**主动**调用 GenerateDesign 工具，无需等待用户明确要求：

1. **需求讨论阶段**：当用户描述了一个项目的核心功能和界面需求后，主动生成设计图帮助用户可视化
2. **项目启动阶段**：当你收集到足够的项目信息（名称、描述、至少2-3个核心需求）时，主动提议并生成设计预览
3. **方案确认阶段**：当用户对 UI 布局、页面结构进行讨论时，生成设计图辅助沟通
4. **用户提到"界面"、"设计"、"UI"、"页面"、"原型"等关键词时**

## 调用策略
- 在收集到项目名称、描述和至少2个核心需求后，就应该调用此工具
- 不要等到所有需求都明确后才调用——早期预览有助于用户校准方向
- 如果用户对生成的设计图提出修改意见，可以调整参数后再次调用
- 生成设计图后，继续与用户讨论细节和改进方向`);
    }

    if (sections.length === 0) {
      return null;
    }

    return sections.join('\n\n');
  }

  /**
   * 检查是否为 Git 仓库
   */
  private checkIsGitRepo(dir: string): boolean {
    try {
      const fs = require('fs');
      const path = require('path');
      let currentDir = dir;
      while (currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, '.git'))) {
          return true;
        }
        currentDir = path.dirname(currentDir);
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 获取默认系统提示词（降级使用）
   */
  private getDefaultSystemPrompt(): string {
    return `You are Claude, an AI assistant made by Anthropic. You are an expert software engineer.

You have access to tools to help complete tasks. Use them as needed.

Guidelines:
- Be concise and direct
- Use tools to gather information before answering
- Prefer editing existing files over creating new ones
- Always verify your work`;
  }

  // ============ 工具过滤方法 ============

  /**
   * 更新工具过滤配置
   */
  updateToolFilter(sessionId: string, config: import('../shared/types.js').ToolFilterConfig): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      console.warn(`[ConversationManager] 未找到会话: ${sessionId}`);
      return;
    }

    state.toolFilterConfig = config;
    console.log(`[ConversationManager] 已更新会话 ${sessionId} 的工具过滤配置:`, config);
  }

  /**
   * 获取可用工具列表
   */
  getAvailableTools(sessionId: string): import('../shared/types.js').ToolInfo[] {
    const state = this.sessions.get(sessionId);
    const config = state?.toolFilterConfig || { mode: 'all' };

    // 内置工具
    const builtinTools = toolRegistry.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      enabled: this.isToolEnabled(tool.name, config),
      category: this.getToolCategory(tool.name),
    }));

    // MCP 工具
    const mcpToolInfos = this.mcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      enabled: this.isToolEnabled(tool.name, config),
      category: 'mcp' as string,
    }));

    return [...builtinTools, ...mcpToolInfos];
  }

  /**
   * 检查工具是否启用
   */
  private isToolEnabled(toolName: string, config: import('../shared/types.js').ToolFilterConfig): boolean {
    if (config.mode === 'all') {
      return true;
    }

    if (config.mode === 'whitelist') {
      return config.allowedTools?.includes(toolName) || false;
    }

    if (config.mode === 'blacklist') {
      return !(config.disallowedTools?.includes(toolName) || false);
    }

    return true;
  }

  /**
   * 获取工具分类
   */
  private getToolCategory(toolName: string): string {
    const categoryMap: Record<string, string> = {
      // Bash 工具
      Bash: 'system',
      BashOutput: 'system',
      KillShell: 'system',

      // 文件工具
      Read: 'file',
      Write: 'file',
      Edit: 'file',
      MultiEdit: 'file',

      // 搜索工具
      Glob: 'search',
      Grep: 'search',

      // Web 工具
      WebFetch: 'web',
      WebSearch: 'web',

      // 任务管理
      TodoWrite: 'task',
      Task: 'task',
      TaskOutput: 'task',
      ListAgents: 'task',

      // 其他
      NotebookEdit: 'notebook',
      EnterPlanMode: 'plan',
      ExitPlanMode: 'plan',
      ListMcpResources: 'mcp',
      ReadMcpResource: 'mcp',
      MCPSearch: 'mcp',
      AskUserQuestion: 'interaction',
      Tmux: 'system',
      Skill: 'skill',
      SlashCommand: 'skill',
      LSP: 'lsp',
      Chrome: 'browser',
    };

    return categoryMap[toolName] || 'other';
  }

  /**
   * 获取过滤后的工具列表
   */
  // Chat Tab 不应暴露的工具（各 Agent 专用工具不应注入到 Chat Tab 上下文）
  // 避免浪费 token，也防止模型误调用不属于当前角色的工具
  private static readonly CHAT_EXCLUDED_TOOLS = new Set([
    'Blueprint',        // CLI 模式工具，Chat Tab 应使用 GenerateBlueprint + StartLeadAgent
    'UpdateTaskPlan',   // LeadAgent 专用 - 更新执行计划中的任务状态
    'DispatchWorker',   // LeadAgent 专用 - 派发任务给 Worker 执行
    'TriggerE2ETest',   // LeadAgent 专用 - 触发 E2E 端到端测试
  ]);

  private getFilteredTools(sessionId: string): any[] {
    const state = this.sessions.get(sessionId);
    const config = state?.toolFilterConfig || { mode: 'all' };

    // 1. 内置工具（来自 toolRegistry，对应官方 C0(ctx)）
    const allTools = toolRegistry.getAll();
    const filteredBuiltinTools = allTools.filter(tool =>
      this.isToolEnabled(tool.name, config) &&
      !ConversationManager.CHAT_EXCLUDED_TOOLS.has(tool.name)
    );

    const builtinDefs = filteredBuiltinTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.getInputSchema(),
    }));

    // 2. MCP 工具（来自 mcpTools state，对应官方 JQ1(mcp.tools, ctx)）
    const filteredMcpTools = this.mcpTools.filter(tool =>
      this.isToolEnabled(tool.name, config)
    );

    const mcpDefs = filteredMcpTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    // 3. 合并并去重（对应官方 LM6() / DV6()：$x([...builtinTools, ...mcpTools], "name")）
    const seen = new Set<string>();
    const merged: any[] = [];
    for (const tool of [...builtinDefs, ...mcpDefs]) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        merged.push(tool);
      }
    }

    return merged;
  }

  // ============ 会话持久化方法 ============

  /**
   * 获取会话管理器
   */
  getSessionManager(): WebSessionManager {
    return this.sessionManager;
  }

  /**
   * 持久化会话
   */
  async persistSession(sessionId: string): Promise<boolean> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return false;
    }

    // 如果会话没有消息，不需要持久化
    if (state.messages.length === 0 && state.chatHistory.length === 0) {
      return true;
    }

    try {
      // 先检查会话是否存在于 sessionManager
      const sessionData = this.sessionManager.loadSessionById(sessionId);

      if (!sessionData) {
        // 如果会话不存在于 sessionManager，说明是临时会话或无效 ID
        // 不要创建新会话，直接返回 false
        console.warn(`[ConversationManager] 会话不存在于 sessionManager，跳过持久化: ${sessionId}`);
        return false;
      }

      // 检查是否有实际变化（避免不必要的磁盘写入）
      const hasChanges =
        sessionData.messages.length !== state.messages.length ||
        sessionData.chatHistory?.length !== state.chatHistory.length ||
        sessionData.currentModel !== state.model;

      if (!hasChanges) {
        return true; // 没有变化，直接返回
      }

      // 更新会话数据
      sessionData.messages = state.messages;
      sessionData.chatHistory = state.chatHistory;
      sessionData.currentModel = state.model;
      (sessionData as any).toolFilterConfig = state.toolFilterConfig;
      (sessionData as any).systemPromptConfig = state.systemPromptConfig;

      // 关键：更新 messageCount（官方规范：统计消息数）
      sessionData.metadata.messageCount = state.messages.length;
      sessionData.metadata.updatedAt = Date.now();

      // 保存到磁盘
      const success = this.sessionManager.saveSession(sessionId);
      if (success) {
        console.log(`[ConversationManager] 会话已持久化: ${sessionId}`);
      }
      return success;
    } catch (error) {
      console.error(`[ConversationManager] 持久化会话失败:`, error);
      return false;
    }
  }

  /**
   * 持久化所有活跃会话（graceful shutdown 时调用）
   */
  async persistAllSessions(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    if (ids.length === 0) return;
    console.log(`[ConversationManager] 正在持久化 ${ids.length} 个活跃会话...`);
    for (const id of ids) {
      try {
        const state = this.sessions.get(id);
        if (state) {
          this.syncChatHistoryFromMessages(state);
          this.autoSaveSession(state);
        }
        await this.persistSession(id);
      } catch (err) {
        console.error(`[ConversationManager] 持久化会话 ${id} 失败:`, err);
      }
    }
    console.log(`[ConversationManager] 所有会话已持久化`);
  }

  /**
   * 恢复会话
   * @param permissionMode 可选，从客户端继承的权限模式
   */
  async resumeSession(sessionId: string, permissionMode?: string): Promise<boolean> {
    try {
      // 如果会话已经在内存中，直接返回成功（避免重复创建）
      if (this.sessions.has(sessionId)) {
        // 同步权限模式（修复切换会话后 YOLO 模式丢失的问题）
        if (permissionMode) {
          const state = this.sessions.get(sessionId)!;
          state.permissionHandler.updateConfig({ mode: permissionMode as any });
        }
        return true;
      }

      const sessionData = this.sessionManager.loadSessionById(sessionId);
      if (!sessionData) {
        console.warn(`[ConversationManager] 会话不存在: ${sessionId}`);
        return false;
      }

      // 从持久化数据恢复会话状态
      const session = new Session(sessionData.metadata.workingDirectory || this.cwd);
      await session.initializeGitInfo();

      const clientConfig = this.buildClientConfig(sessionData.currentModel || this.defaultModel);
      const client = new ClaudeClient(clientConfig);

      // 如果 chatHistory 为空但 messages 不为空，从 messages 构建 chatHistory
      let chatHistory = sessionData.chatHistory || [];
      if (chatHistory.length === 0 && sessionData.messages && sessionData.messages.length > 0) {
        chatHistory = this.convertMessagesToChatHistory(sessionData.messages);
      }

      const state: SessionState = {
        session,
        client,
        messages: sessionData.messages,
        model: sessionData.currentModel || sessionData.metadata.model,
        cancelled: false,
        chatHistory,
        userInteractionHandler: new UserInteractionHandler(),
        taskManager: new TaskManager(),
        permissionHandler: new PermissionHandler({ mode: (permissionMode as any) || 'default' }),
        toolFilterConfig: (sessionData as any).toolFilterConfig || {
          mode: 'all', // 默认允许所有工具
        },
        systemPromptConfig: (sessionData as any).systemPromptConfig || {
          useDefault: true,
        },
        isProcessing: false,
        lastActualInputTokens: 0,
      };

      this.sessions.set(sessionId, state);
      console.log(`[ConversationManager] 会话已恢复: ${sessionId}, 消息数: ${sessionData.messages.length}, chatHistory: ${chatHistory.length}, permissionMode: ${permissionMode || 'default'}`);
      return true;
    } catch (error) {
      console.error(`[ConversationManager] 恢复会话失败:`, error);
      return false;
    }
  }

  /**
   * 将 API 消息格式转换为 ChatHistory 格式
   */
  private convertMessagesToChatHistory(messages: Message[]): ChatMessage[] {
    const chatHistory: ChatMessage[] = [];

    for (const msg of messages) {
      // 跳过 tool_result 消息（它们会被合并到工具调用中）
      if (Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'tool_result')) {
        continue;
      }

      const chatMsg: ChatMessage = {
        id: `${msg.role}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        role: msg.role as 'user' | 'assistant',
        timestamp: Date.now(),
        content: [],
      };

      // 转换内容
      if (typeof msg.content === 'string') {
        chatMsg.content.push({ type: 'text', text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text') {
            chatMsg.content.push({ type: 'text', text: (block as TextBlock).text });
          } else if (block.type === 'image') {
            // 保留图片内容以便刷新后回显
            const imgBlock = block as any;
            chatMsg.content.push({
              type: 'image',
              mediaType: imgBlock.source?.media_type || 'image/png',
              data: imgBlock.source?.data || '',
            });
          } else if (block.type === 'tool_use') {
            const toolBlock = block as ToolUseBlock;
            chatMsg.content.push({
              type: 'tool_use',
              id: toolBlock.id,
              name: toolBlock.name,
              input: toolBlock.input,
              status: 'completed',
            });
          }
        }
      }

      if (chatMsg.content.length > 0) {
        chatHistory.push(chatMsg);
      }
    }

    return chatHistory;
  }

  /**
   * 列出持久化会话
   */
  listPersistedSessions(options?: SessionListOptions): SessionMetadata[] {
    return this.sessionManager.listSessions(options);
  }

  /**
   * 删除持久化会话
   */
  deletePersistedSession(sessionId: string): boolean {
    // 从内存中删除
    this.sessions.delete(sessionId);
    // 从磁盘删除
    return this.sessionManager.deleteSession(sessionId);
  }

  /**
   * 重命名持久化会话
   */
  renamePersistedSession(sessionId: string, name: string): boolean {
    return this.sessionManager.renameSession(sessionId, name);
  }

  /**
   * 导出持久化会话
   */
  exportPersistedSession(sessionId: string, format: 'json' | 'md' = 'json'): string | null {
    if (format === 'json') {
      return this.sessionManager.exportSessionJSON(sessionId);
    } else {
      return this.sessionManager.exportSessionMarkdown(sessionId);
    }
  }

  // ============ 系统提示配置方法 ============

  /**
   * 更新系统提示配置
   */
  updateSystemPrompt(sessionId: string, config: SystemPromptConfig): boolean {
    const state = this.sessions.get(sessionId);
    if (!state) {
      console.warn(`[ConversationManager] 未找到会话: ${sessionId}`);
      return false;
    }

    state.systemPromptConfig = config;
    console.log(`[ConversationManager] 已更新会话 ${sessionId} 的系统提示配置`);
    return true;
  }

  /**
   * 获取系统提示配置和当前完整提示
   */
  async getSystemPrompt(sessionId: string): Promise<SystemPromptGetPayload> {
    const state = await this.getOrCreateSession(sessionId);

    // 构建当前完整的系统提示
    const currentPrompt = await this.buildSystemPrompt(state);

    return {
      current: currentPrompt,
      config: state.systemPromptConfig,
    };
  }

  /**
   * 获取调试信息：系统提示词 + 原始消息体 + 工具列表（探针功能）
   */
  async getDebugMessages(sessionId: string): Promise<DebugMessagesPayload> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return {
        systemPrompt: '(会话不存在)',
        messages: [],
        tools: [],
        model: 'unknown',
        messageCount: 0,
      };
    }

    // 构建当前完整的系统提示
    const systemPrompt = await this.buildSystemPrompt(state);

    // 获取工具定义列表
    const tools = this.getFilteredTools(sessionId);

    return {
      systemPrompt,
      messages: state.messages,
      tools,
      model: state.model,
      messageCount: state.messages.length,
    };
  }

  /**
   * 获取任务管理器
   */
  getTaskManager(sessionId: string): TaskManager | undefined {
    const state = this.sessions.get(sessionId);
    return state?.taskManager;
  }

  /**
   * 获取工具过滤配置
   */
  getToolFilterConfig(sessionId: string): import('../shared/types.js').ToolFilterConfig {
    const state = this.sessions.get(sessionId);
    return state?.toolFilterConfig || { mode: 'all' };
  }

  // ============ MCP 服务器管理方法 ============

  /**
   * 列出所有 MCP 服务器
   */
  listMcpServers(): import('../shared/types.js').McpServerConfig[] {
    const servers = this.mcpConfigManager.getServers();

    return Object.entries(servers).map(([name, config]) => ({
      name,
      type: config.type,
      command: config.command,
      args: config.args,
      env: config.env,
      url: config.url,
      headers: config.headers,
      enabled: config.enabled !== false,
      timeout: config.timeout,
      retries: config.retries,
    }));
  }

  /**
   * 添加 MCP 服务器
   */
  async addMcpServer(name: string, config: Omit<import('../shared/types.js').McpServerConfig, 'name'>): Promise<boolean> {
    try {
      const serverConfig: ExtendedMcpServerConfig = {
        type: config.type,
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
        enabled: config.enabled !== false,
        timeout: config.timeout || 30000,
        retries: config.retries || 3,
      };

      await this.mcpConfigManager.addServer(name, serverConfig);
      console.log(`[ConversationManager] 已添加 MCP 服务器: ${name}`);
      return true;
    } catch (error) {
      console.error(`[ConversationManager] 添加 MCP 服务器失败:`, error);
      return false;
    }
  }

  /**
   * 删除 MCP 服务器
   */
  async removeMcpServer(name: string): Promise<boolean> {
    try {
      const success = await this.mcpConfigManager.removeServer(name);
      if (success) {
        console.log(`[ConversationManager] 已删除 MCP 服务器: ${name}`);
      }
      return success;
    } catch (error) {
      console.error(`[ConversationManager] 删除 MCP 服务器失败:`, error);
      return false;
    }
  }

  /**
   * 切换 MCP 服务器启用状态
   */
  async toggleMcpServer(name: string, enabled?: boolean): Promise<{ success: boolean; enabled: boolean }> {
    try {
      const server = this.mcpConfigManager.getServer(name);

      if (!server) {
        console.warn(`[ConversationManager] MCP 服务器不存在: ${name}`);
        return { success: false, enabled: false };
      }

      // 如果未指定 enabled，则切换当前状态
      const newEnabled = enabled !== undefined ? enabled : !(server.enabled !== false);

      if (newEnabled) {
        await this.mcpConfigManager.enableServer(name);
      } else {
        await this.mcpConfigManager.disableServer(name);
      }

      console.log(`[ConversationManager] MCP 服务器 ${name} ${newEnabled ? '已启用' : '已禁用'}`);
      return { success: true, enabled: newEnabled };
    } catch (error) {
      console.error(`[ConversationManager] 切换 MCP 服务器失败:`, error);
      return { success: false, enabled: false };
    }
  }

  /**
   * 获取 MCP 配置管理器（供其他模块使用）
   */
  getMcpConfigManager(): McpConfigManager {
    return this.mcpConfigManager;
  }

  // ============ 插件管理方法 ============

  /**
   * 列出所有插件
   */
  async listPlugins(): Promise<import('../shared/types.js').PluginInfo[]> {
    const { pluginManager } = await import('../../plugins/index.js');

    // 发现所有插件
    await pluginManager.discover();

    const pluginStates = pluginManager.getPluginStates();

    return pluginStates.map(state => {
      const tools = pluginManager.getPluginTools(state.metadata.name);
      const commands = pluginManager.getPluginCommands(state.metadata.name);
      const skills = pluginManager.getPluginSkills(state.metadata.name);
      const hooks = pluginManager.getPluginHooks(state.metadata.name);

      return {
        name: state.metadata.name,
        version: state.metadata.version,
        description: state.metadata.description,
        author: state.metadata.author,
        enabled: state.enabled,
        loaded: state.loaded,
        path: state.path,
        commands: commands.map(c => c.name),
        skills: skills.map(s => s.name),
        hooks: hooks.map(h => h.type),
        tools: tools.map(t => t.name),
        error: state.error,
      };
    });
  }

  /**
   * 获取插件详情
   */
  async getPluginInfo(name: string): Promise<import('../shared/types.js').PluginInfo | null> {
    const { pluginManager } = await import('../../plugins/index.js');

    const state = pluginManager.getPluginState(name);
    if (!state) {
      return null;
    }

    const tools = pluginManager.getPluginTools(name);
    const commands = pluginManager.getPluginCommands(name);
    const skills = pluginManager.getPluginSkills(name);
    const hooks = pluginManager.getPluginHooks(name);

    return {
      name: state.metadata.name,
      version: state.metadata.version,
      description: state.metadata.description,
      author: state.metadata.author,
      enabled: state.enabled,
      loaded: state.loaded,
      path: state.path,
      commands: commands.map(c => c.name),
      skills: skills.map(s => s.name),
      hooks: hooks.map(h => h.type),
      tools: tools.map(t => t.name),
      error: state.error,
    };
  }

  /**
   * 启用插件
   */
  async enablePlugin(name: string): Promise<boolean> {
    try {
      const { pluginManager } = await import('../../plugins/index.js');

      const success = await pluginManager.setEnabled(name, true);
      if (success) {
        console.log(`[ConversationManager] 插件已启用: ${name}`);
      }
      return success;
    } catch (error) {
      console.error(`[ConversationManager] 启用插件失败:`, error);
      return false;
    }
  }

  /**
   * 禁用插件
   */
  async disablePlugin(name: string): Promise<boolean> {
    try {
      const { pluginManager } = await import('../../plugins/index.js');

      const success = await pluginManager.setEnabled(name, false);
      if (success) {
        console.log(`[ConversationManager] 插件已禁用: ${name}`);
      }
      return success;
    } catch (error) {
      console.error(`[ConversationManager] 禁用插件失败:`, error);
      return false;
    }
  }

  /**
   * 卸载插件
   */
  async uninstallPlugin(name: string): Promise<boolean> {
    try {
      const { pluginManager } = await import('../../plugins/index.js');

      const success = await pluginManager.uninstall(name);
      if (success) {
        console.log(`[ConversationManager] 插件已卸载: ${name}`);
      }
      return success;
    } catch (error) {
      console.error(`[ConversationManager] 卸载插件失败:`, error);
      return false;
    }
  }

  // ============================================================================
  // Rewind 功能
  // ============================================================================

  /**
   * 获取可回滚的消息列表
   */
  getRewindableMessages(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`会话未找到: ${sessionId}`);
    }

    // 设置消息给 RewindManager
    state.rewindManager.setMessages(state.messages);

    return state.rewindManager.getRewindableMessages();
  }

  /**
   * 获取回滚预览信息
   */
  getRewindPreview(sessionId: string, messageId: string, option: RewindOption) {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`会话未找到: ${sessionId}`);
    }

    // 设置消息给 RewindManager
    state.rewindManager.setMessages(state.messages);

    return state.rewindManager.previewRewind(messageId, option);
  }

  /**
   * 执行回滚操作
   */
  async rewind(sessionId: string, messageId: string, option: RewindOption) {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`会话未找到: ${sessionId}`);
    }

    console.log(`[ConversationManager] 执行回滚: sessionId=${sessionId}, messageId=${messageId}, option=${option}`);

    // 设置消息变更回调
    const onMessagesChange = (newMessages: Message[]) => {
      state.messages = newMessages;
      // 同步更新 chatHistory
      // TODO: 实现 messages 到 chatHistory 的转换
    };

    state.rewindManager.setMessages(state.messages, onMessagesChange);

    // 执行回滚
    const result = await state.rewindManager.rewind(messageId, option);

    if (result.success) {
      console.log(`[ConversationManager] 回滚成功:`, result);
    } else {
      console.error(`[ConversationManager] 回滚失败:`, result.error);
    }

    return result;
  }

  /**
   * 记录用户消息（创建文件快照）
   */
  recordUserMessage(sessionId: string, messageId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }

    state.rewindManager.recordUserMessage(messageId);
  }

  /**
   * 记录文件变更（在工具执行前调用）
   */
  recordFileChange(sessionId: string, filePath: string) {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }

    state.rewindManager.recordFileChange(filePath);
  }
}
