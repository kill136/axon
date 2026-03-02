/**
 * 配置管理 - 增强版
 * 支持：Zod验证、配置合并、迁移、导出/导入、热重载
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type { McpServerConfig } from '../types/index.js';
import { envManager, maskSensitiveFields, getValidatedEnv } from '../env/index.js';

// Re-export McpServerConfig for backwards compatibility
export type { McpServerConfig };

// ============ Zod Schema 定义 ============

const McpServerConfigSchema = z.object({
  type: z.enum(['stdio', 'sse', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
}).refine(
  (data) => {
    // stdio 类型必须有 command
    if (data.type === 'stdio' && !data.command) return false;
    // http/sse 类型必须有 url
    if ((data.type === 'http' || data.type === 'sse') && !data.url) return false;
    return true;
  },
  {
    message: 'Invalid MCP server configuration',
  }
);

const UserConfigSchema = z.object({
  // 版本控制
  version: z.string().default('2.1.7'),

  // 语言配置 (v2.1.0+) - 配置 Claude 的响应语言
  // 官方格式：language: "japanese" 会添加到系统提示词
  language: z.string().optional(),

  // API 配置
  apiKey: z.string().optional(),
  model: z.enum(['claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'opus', 'sonnet', 'haiku']).default('sonnet'),
  maxTokens: z.number().int().positive().max(200000).default(32000),
  temperature: z.number().min(0).max(1).default(1),

  // 后端选择（新增 apiProvider 枚举，保留向后兼容）
  apiProvider: z.enum(['anthropic', 'bedrock', 'vertex']).default('anthropic').optional(),
  useBedrock: z.boolean().default(false),
  useVertex: z.boolean().default(false),
  oauthToken: z.string().optional(),

  // WebUI 专用配置（settings.json passthrough 字段）
  apiBaseUrl: z.string().optional(),
  customModelName: z.string().optional(),
  authPriority: z.enum(['apiKey', 'oauth', 'auto']).default('auto').optional(),
  oauthAccount: z.record(z.any()).optional(),

  // 功能配置
  maxRetries: z.number().int().min(0).max(10).default(3),
  debugLogsDir: z.string().optional(),
  agentId: z.string().optional(), // 新增：Agent ID

  // UI 配置
  theme: z.enum(['dark', 'light', 'auto']).default('auto'),
  verbose: z.boolean().default(false),
  editMode: z.enum(['default', 'vim', 'emacs']).default('default'),

  /** Diff 显示工具 (P0) */
  diffTool: z.enum(['terminal', 'auto']).default('auto').optional(),

  /** 输出样式 (P1) */
  outputStyle: z.enum(['default', 'compact', 'verbose']).default('default').optional(),

  /** 通知渠道 (P1) */
  notifChannel: z.enum(['desktop', 'terminal', 'none']).default('terminal').optional(),

  // 终端配置（新增）
  terminal: z.object({
    type: z.enum(['auto', 'vscode', 'cursor', 'windsurf', 'zed', 'ghostty', 'wezterm', 'kitty', 'alacritty', 'warp']).optional(),
    statusLine: z.object({
      type: z.enum(['command', 'text', 'disabled']).default('disabled'),
      command: z.string().optional(),
      text: z.string().optional(),
    }).optional(),
    keybindings: z.record(z.string()).optional(),
  }).optional(),

  // 功能开关
  enableTelemetry: z.boolean().default(false),
  disableFileCheckpointing: z.boolean().default(false),
  enableAutoSave: z.boolean().default(true),
  
  /** 自动链接理解 - 自动提取用户消息中的 URL 并获取内容注入上下文 */
  autoLinkUnderstanding: z.boolean().default(true).optional(),

  /** Extended Thinking 配置 (P0) */
  thinking: z.object({
    enabled: z.boolean().default(false),
    budgetTokens: z.number().int().min(1024).max(128000).default(10000),
    showThinking: z.boolean().default(false),
    timeout: z.number().int().positive().default(120000), // 2分钟
  }).optional(),

  /** IDE 集成配置 (P0/P1) */
  autoConnectIde: z.boolean().default(false).optional(),
  autoInstallIdeExtension: z.boolean().default(true).optional(),

  /** UI/UX 配置 (P1) */
  respectGitignore: z.boolean().default(true).optional(),
  promptSuggestionEnabled: z.boolean().default(false).optional(),
  fileCheckpointingEnabled: z.boolean().default(true).optional(),
  autoCompactEnabled: z.boolean().default(true).optional(),
  sessionMemoryEnabled: z.boolean().default(false).optional(), // Session Memory 压缩功能（TJ1）
  autoUpdatesChannel: z.enum(['latest', 'disabled']).default('latest').optional(),
  claudeInChromeDefaultEnabled: z.boolean().default(true).optional(),

  /** UI 提示和进度 (P2) */
  spinnerTipsEnabled: z.boolean().default(true).optional(),
  terminalProgressBarEnabled: z.boolean().default(true).optional(),

  /** 响应耗时显示 (v2.1.7+) */
  showTurnDuration: z.boolean().default(true).optional(),

  /** v2.1.30: Reduced motion mode - 减少动画和视觉效果 */
  reducedMotion: z.boolean().default(false).optional(),

  // Git 配置
  includeCoAuthoredBy: z.boolean().default(true), // 是否在 git commit 中添加 Claude 署名（已弃用，使用 attribution）

  // Git 署名配置（新增，v2.1.4+）
  attribution: z.object({
    commit: z.string().optional(), // commit 消息署名（包含 Co-Authored-By trailer）
    pr: z.string().optional(),     // PR 描述署名（包含链接）
  }).optional(),

  // 高级配置
  maxConcurrentTasks: z.number().int().positive().max(100).default(10),
  requestTimeout: z.number().int().positive().default(300000), // 5分钟
  
  /** Skill Hub URL - 社区 skill 注册中心地址 */
  skillHubUrl: z.string().url().optional(),

  // 遥测配置（新增）
  telemetry: z.object({
    otelShutdownTimeoutMs: z.number().int().positive().optional(),
  }).optional(),

  // 代理配置（新增）
  proxy: z.object({
    http: z.string().url().optional(),
    https: z.string().url().optional(),
    auth: z.object({
      username: z.string().optional(),
      password: z.string().optional(),
    }).optional(),
  }).optional(),

  // 日志配置（新增）
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    logPath: z.string().optional(),
    maxSize: z.number().int().positive().optional(),
    maxFiles: z.number().int().positive().optional(),
  }).optional(),

  // 缓存配置（新增）
  cache: z.object({
    enabled: z.boolean().default(true),
    location: z.string().optional(),
    maxSize: z.number().int().positive().optional(), // MB
    ttl: z.number().int().positive().optional(), // 秒
  }).optional(),

  // 安全配置（新增）
  security: z.object({
    sensitiveFiles: z.array(z.string()).optional(),
    dangerousCommands: z.array(z.string()).optional(),
    allowSandboxEscape: z.boolean().default(false),
  }).optional(),

  // MCP 服务器
  mcpServers: z.record(McpServerConfigSchema).optional(),

  // 工具过滤
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),

  // 自定义提示词
  systemPrompt: z.string().optional(),

  // 工作目录
  defaultWorkingDir: z.string().optional(),

  // 权限配置（匹配官方结构）
  permissions: z.object({
    // 默认权限模式（匹配官方 defaultMode）
    defaultMode: z.enum(['default', 'bypassPermissions', 'dontAsk', 'acceptEdits', 'plan', 'delegate']).default('default').optional(),

    // 向后兼容字段
    defaultLevel: z.enum(['accept', 'reject', 'ask']).default('ask').optional(),
    autoApprove: z.array(z.string()).optional(),

    // allow/deny/ask 规则（匹配官方）
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),

    // 工具级权限
    tools: z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    }).optional(),

    // 路径级权限（支持 glob patterns）
    paths: z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    }).optional(),

    // 命令级权限（支持 glob patterns）
    commands: z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    }).optional(),

    // 网络权限
    network: z.object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    }).optional(),

    // 额外允许的目录
    additionalDirectories: z.array(z.string()).optional(),

    // 审计日志
    audit: z.object({
      enabled: z.boolean().optional(),
      logFile: z.string().optional(),
      maxSize: z.number().int().positive().optional(),
    }).optional(),
  }).optional(),

  // Session Manager 配置（新增，v2.1.4+）
  sessionManager: z.object({
    /** 自动保存开关 */
    autoSave: z.boolean().default(true),
    /** 自动保存间隔 (ms) */
    autoSaveIntervalMs: z.number().int().positive().default(30000),
    /** 会话存储目录（默认: ~/.axon/sessions） */
    sessionDir: z.string().optional(),
    /** 最大会话数 */
    maxSessions: z.number().int().positive().default(100),
    /** 会话过期天数 */
    sessionExpiryDays: z.number().int().positive().default(30),
  }).optional(),

  // v2.1.9: Plan 模式配置
  plan: z.object({
    /** 自定义 plan 文件存储目录，相对于项目根目录 */
    plansDirectory: z.string().optional(),
  }).optional(),

  // v2.1.9: plansDirectory 快捷配置（等同于 plan.plansDirectory）
  plansDirectory: z.string().optional(),
}).passthrough(); // 允许额外字段，便于扩展

export type UserConfig = z.infer<typeof UserConfigSchema>;

// ============ 默认配置 ============

const DEFAULT_CONFIG: Partial<UserConfig> = {
  version: '2.1.18',
  model: 'sonnet',
  maxTokens: 32000,
  temperature: 1,
  theme: 'auto',
  verbose: false,
  editMode: 'default',
  maxRetries: 3,
  enableTelemetry: false,
  disableFileCheckpointing: false,
  enableAutoSave: true,
  includeCoAuthoredBy: true, // Git 署名默认开启
  maxConcurrentTasks: 10,
  requestTimeout: 300000,
  useBedrock: false,
  useVertex: false,

  // ===== 新增默认值 (v2.1.4+) =====

  /** Diff 工具 */
  diffTool: 'auto',

  /** Extended Thinking */
  thinking: {
    enabled: false,
    budgetTokens: 10000,
    showThinking: false,
    timeout: 120000,
  },

  /** IDE 集成 */
  autoConnectIde: false,
  autoInstallIdeExtension: true,

  /** UI/UX */
  respectGitignore: true,
  promptSuggestionEnabled: false,
  fileCheckpointingEnabled: true,
  autoCompactEnabled: true,
  autoUpdatesChannel: 'latest',
  claudeInChromeDefaultEnabled: true,
  outputStyle: 'default',
  notifChannel: 'terminal',

  /** UI 提示和进度 */
  spinnerTipsEnabled: true,
  terminalProgressBarEnabled: true,

  /** 响应耗时显示 (v2.1.7+) */
  showTurnDuration: true,

  /** Session Manager */
  sessionManager: {
    autoSave: true,
    autoSaveIntervalMs: 30000,
    maxSessions: 100,
    sessionExpiryDays: 30,
  },
};

// ============ 环境变量解析 ============

function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase().trim();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

function parseEnvNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return isNaN(parsed) ? undefined : parsed;
}

function getEnvConfig(): Partial<UserConfig> {
  const config: Partial<UserConfig> = {
    // ===== ANTHROPIC_* 和 AXON_API_KEY =====
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY,
    oauthToken: process.env.AXON_OAUTH_TOKEN,

    // ===== 后端选择 =====
    useBedrock: parseEnvBoolean(process.env.AXON_USE_BEDROCK),
    useVertex: parseEnvBoolean(process.env.AXON_USE_VERTEX),

    // ===== 性能配置 =====
    maxTokens: parseEnvNumber(process.env.AXON_MAX_OUTPUT_TOKENS),
    maxRetries: parseEnvNumber(process.env.AXON_MAX_RETRIES),
    debugLogsDir: process.env.AXON_DEBUG_LOGS_DIR,

    // ===== 功能开关 =====
    enableTelemetry: parseEnvBoolean(process.env.AXON_ENABLE_TELEMETRY) ?? (parseEnvBoolean(process.env.DISABLE_TELEMETRY) === false ? true : undefined),
    disableFileCheckpointing: parseEnvBoolean(process.env.AXON_DISABLE_FILE_CHECKPOINTING),

    // ===== Agent 系统 =====
    agentId: process.env.AXON_AGENT_ID,

    // ===== IDE 集成 =====
    autoConnectIde: parseEnvBoolean(process.env.AXON_AUTO_CONNECT_IDE),

    // ===== 语言配置 =====
    language: process.env.AXON_LANGUAGE,

    // ===== UI/UX =====
    promptSuggestionEnabled: parseEnvBoolean(process.env.AXON_ENABLE_PROMPT_SUGGESTION),
    respectGitignore: parseEnvBoolean(process.env.AXON_RESPECT_GITIGNORE),
    autoCompactEnabled: parseEnvBoolean(process.env.DISABLE_COMPACT) === true ? false : undefined,
    spinnerTipsEnabled: parseEnvBoolean(process.env.AXON_ENABLE_SPINNER_TIPS),
    terminalProgressBarEnabled: parseEnvBoolean(process.env.AXON_ENABLE_PROGRESS_BAR),
  };

  // ===== API Provider（从布尔标志推导）=====
  if (parseEnvBoolean(process.env.AXON_USE_BEDROCK)) {
    config.apiProvider = 'bedrock';
  } else if (parseEnvBoolean(process.env.AXON_USE_VERTEX)) {
    config.apiProvider = 'vertex';
  } else if (parseEnvBoolean(process.env.AXON_USE_FOUNDRY)) {
    config.apiProvider = 'anthropic'; // Foundry 也使用 anthropic provider
  }

  // ===== Extended Thinking 配置 =====
  if (process.env.MAX_THINKING_TOKENS || process.env.DISABLE_INTERLEAVED_THINKING) {
    config.thinking = {
      enabled: parseEnvBoolean(process.env.DISABLE_INTERLEAVED_THINKING) !== true,
      budgetTokens: parseEnvNumber(process.env.MAX_THINKING_TOKENS) ?? 10000,
      showThinking: false,
      timeout: 120000,
    };
  }

  // ===== 遥测配置 =====
  if (process.env.AXON_OTEL_SHUTDOWN_TIMEOUT_MS) {
    config.telemetry = {
      otelShutdownTimeoutMs: parseEnvNumber(process.env.AXON_OTEL_SHUTDOWN_TIMEOUT_MS),
    };
  }

  // ===== 代理配置 =====
  if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY) {
    config.proxy = {
      http: process.env.HTTP_PROXY,
      https: process.env.HTTPS_PROXY,
    };
  }

  // ========== 新增: 更多环境变量支持 (110+) ==========

  // ===== ANTHROPIC_* 扩展配置 =====
  if (process.env.ANTHROPIC_BASE_URL) {
    if (!config.api) config.api = {};
    (config as any).api.baseURL = process.env.ANTHROPIC_BASE_URL;
  }
  if (process.env.ANTHROPIC_MODEL) {
    config.model = process.env.ANTHROPIC_MODEL as any;
  }
  if (process.env.ANTHROPIC_CUSTOM_HEADERS) {
    try {
      (config as any).customHeaders = JSON.parse(process.env.ANTHROPIC_CUSTOM_HEADERS);
    } catch (e) {
      console.warn('Failed to parse ANTHROPIC_CUSTOM_HEADERS:', e);
    }
  }

  // ===== Git 集成 =====
  if (process.env.AXON_GIT_BASH_PATH) {
    (config as any).git = {
      bashPath: process.env.AXON_GIT_BASH_PATH,
    };
  }

  // ===== 会话管理扩展 =====
  if (process.env.AXON_SESSION_ID ||
      process.env.AXON_PARENT_SESSION_ID ||
      process.env.AXON_SESSION_ACCESS_TOKEN ||
      process.env.AXON_SKIP_PROMPT_HISTORY ||
      process.env.AXON_EXIT_AFTER_STOP_DELAY ||
      process.env.AXON_SSE_PORT) {
    (config as any).session = {
      id: process.env.AXON_SESSION_ID,
      parentId: process.env.AXON_PARENT_SESSION_ID,
      accessToken: process.env.AXON_SESSION_ACCESS_TOKEN,
      skipPromptHistory: parseEnvBoolean(process.env.AXON_SKIP_PROMPT_HISTORY),
      exitAfterStopDelay: parseEnvNumber(process.env.AXON_EXIT_AFTER_STOP_DELAY),
      ssePort: parseEnvNumber(process.env.AXON_SSE_PORT),
    };
  }

  // ===== Agent 系统扩展 =====
  if (process.env.AXON_AGENT_NAME ||
      process.env.AXON_AGENT_TYPE ||
      process.env.AXON_SUBAGENT_MODEL ||
      process.env.AXON_PLAN_V2_AGENT_COUNT ||
      process.env.AXON_PLAN_V2_EXPLORE_AGENT_COUNT ||
      process.env.AXON_EFFORT_LEVEL ||
      process.env.AXON_ACTION) {
    (config as any).agent = {
      id: config.agentId,
      name: process.env.AXON_AGENT_NAME,
      type: process.env.AXON_AGENT_TYPE,
      subagentModel: process.env.AXON_SUBAGENT_MODEL,
      planV2AgentCount: parseEnvNumber(process.env.AXON_PLAN_V2_AGENT_COUNT),
      planV2ExploreAgentCount: parseEnvNumber(process.env.AXON_PLAN_V2_EXPLORE_AGENT_COUNT),
      effortLevel: process.env.AXON_EFFORT_LEVEL as any,
      action: process.env.AXON_ACTION,
    };
  }

  // ===== IDE 集成扩展 =====
  if (process.env.AXON_IDE_HOST_OVERRIDE ||
      process.env.AXON_IDE_SKIP_AUTO_INSTALL ||
      process.env.AXON_IDE_SKIP_VALID_CHECK) {
    (config as any).ide = {
      autoConnect: config.autoConnectIde,
      hostOverride: process.env.AXON_IDE_HOST_OVERRIDE,
      skipAutoInstall: parseEnvBoolean(process.env.AXON_IDE_SKIP_AUTO_INSTALL),
      skipValidCheck: parseEnvBoolean(process.env.AXON_IDE_SKIP_VALID_CHECK),
    };
  }

  // ===== 安全配置 =====
  if (process.env.AXON_CLIENT_CERT ||
      process.env.AXON_CLIENT_KEY ||
      process.env.AXON_CLIENT_KEY_PASSPHRASE ||
      process.env.AXON_ADDITIONAL_PROTECTION ||
      process.env.AXON_DISABLE_COMMAND_INJECTION_CHECK) {
    (config as any).security = {
      clientCert: process.env.AXON_CLIENT_CERT,
      clientKey: process.env.AXON_CLIENT_KEY,
      clientKeyPassphrase: process.env.AXON_CLIENT_KEY_PASSPHRASE,
      additionalProtection: parseEnvBoolean(process.env.AXON_ADDITIONAL_PROTECTION),
      disableCommandInjectionCheck: parseEnvBoolean(process.env.AXON_DISABLE_COMMAND_INJECTION_CHECK),
    };
  }

  // ===== Prompt Caching =====
  if (process.env.DISABLE_PROMPT_CACHING ||
      process.env.DISABLE_PROMPT_CACHING_SONNET ||
      process.env.DISABLE_PROMPT_CACHING_OPUS ||
      process.env.DISABLE_PROMPT_CACHING_HAIKU) {
    (config as any).promptCaching = {
      enabled: !parseEnvBoolean(process.env.DISABLE_PROMPT_CACHING),
      sonnet: !parseEnvBoolean(process.env.DISABLE_PROMPT_CACHING_SONNET),
      opus: !parseEnvBoolean(process.env.DISABLE_PROMPT_CACHING_OPUS),
      haiku: !parseEnvBoolean(process.env.DISABLE_PROMPT_CACHING_HAIKU),
    };
  }

  // ===== MCP 配置扩展 =====
  if (process.env.MCP_TIMEOUT ||
      process.env.MCP_TOOL_TIMEOUT ||
      process.env.MAX_MCP_OUTPUT_TOKENS ||
      process.env.MCP_OAUTH_CALLBACK_PORT ||
      process.env.MCP_SERVER_CONNECTION_BATCH_SIZE ||
      process.env.ENABLE_MCP_CLI ||
      process.env.ENABLE_MCP_CLI_ENDPOINT ||
      process.env.ENABLE_EXPERIMENTAL_MCP_CLI ||
      process.env.ENABLE_MCP_LARGE_OUTPUT_FILES) {
    (config as any).mcp = {
      timeout: parseEnvNumber(process.env.MCP_TIMEOUT),
      toolTimeout: parseEnvNumber(process.env.MCP_TOOL_TIMEOUT),
      maxOutputTokens: parseEnvNumber(process.env.MAX_MCP_OUTPUT_TOKENS),
      oauthCallbackPort: parseEnvNumber(process.env.MCP_OAUTH_CALLBACK_PORT),
      serverConnectionBatchSize: parseEnvNumber(process.env.MCP_SERVER_CONNECTION_BATCH_SIZE),
      enableCli: parseEnvBoolean(process.env.ENABLE_MCP_CLI),
      enableCliEndpoint: parseEnvBoolean(process.env.ENABLE_MCP_CLI_ENDPOINT),
      enableExperimentalCli: parseEnvBoolean(process.env.ENABLE_EXPERIMENTAL_MCP_CLI),
      enableLargeOutputFiles: parseEnvBoolean(process.env.ENABLE_MCP_LARGE_OUTPUT_FILES),
    };
  }

  // ===== 认证跳过 =====
  if (process.env.AXON_SKIP_BEDROCK_AUTH ||
      process.env.AXON_SKIP_VERTEX_AUTH ||
      process.env.AXON_SKIP_FOUNDRY_AUTH) {
    (config as any).skipAuth = {
      bedrock: parseEnvBoolean(process.env.AXON_SKIP_BEDROCK_AUTH),
      vertex: parseEnvBoolean(process.env.AXON_SKIP_VERTEX_AUTH),
      foundry: parseEnvBoolean(process.env.AXON_SKIP_FOUNDRY_AUTH),
    };
  }

  // ===== 远程会话 =====
  if (process.env.AXON_REMOTE ||
      process.env.AXON_REMOTE_ENVIRONMENT_TYPE ||
      process.env.AXON_REMOTE_SESSION_ID) {
    (config as any).remote = {
      enabled: parseEnvBoolean(process.env.AXON_REMOTE),
      environmentType: process.env.AXON_REMOTE_ENVIRONMENT_TYPE,
      sessionId: process.env.AXON_REMOTE_SESSION_ID,
    };
  }

  // ===== 沙箱配置 =====
  if (process.env.AXON_BUBBLEWRAP ||
      process.env.AXON_BASH_SANDBOX_SHOW_INDICATOR ||
      process.env.AXON_CONTAINER_ID ||
      process.env.AXON_SHELL ||
      process.env.AXON_SHELL_PREFIX ||
      process.env.AXON_DONT_INHERIT_ENV) {
    (config as any).sandbox = {
      bubblewrap: process.env.AXON_BUBBLEWRAP,
      showIndicator: parseEnvBoolean(process.env.AXON_BASH_SANDBOX_SHOW_INDICATOR) ?? true,
      containerId: process.env.AXON_CONTAINER_ID,
      shell: process.env.AXON_SHELL,
      shellPrefix: process.env.AXON_SHELL_PREFIX,
      dontInheritEnv: parseEnvBoolean(process.env.AXON_DONT_INHERIT_ENV),
    };
  }

  // ===== 临时目录配置 (v2.1.5+) =====
  if (process.env.AXON_TMPDIR) {
    (config as any).tmpDir = process.env.AXON_TMPDIR;
  }

  // ===== UI/UX 扩展 =====
  if (process.env.AXON_DISABLE_ATTACHMENTS ||
      process.env.AXON_DISABLE_AXON_MDS ||
      process.env.AXON_DISABLE_FEEDBACK_SURVEY ||
      process.env.AXON_DISABLE_TERMINAL_TITLE ||
      process.env.AXON_ENABLE_TOKEN_USAGE_ATTACHMENT ||
      process.env.AXON_FORCE_FULL_LOGO ||
      process.env.AXON_SYNTAX_HIGHLIGHT ||
      process.env.DISABLE_MICROCOMPACT ||
      process.env.DISABLE_COST_WARNINGS ||
      process.env.ENABLE_INCREMENTAL_TUI) {
    (config as any).ui = {
      disableAttachments: parseEnvBoolean(process.env.AXON_DISABLE_ATTACHMENTS),
      disableAxonMds: parseEnvBoolean(process.env.AXON_DISABLE_AXON_MDS),
      disableFeedbackSurvey: parseEnvBoolean(process.env.AXON_DISABLE_FEEDBACK_SURVEY),
      disableTerminalTitle: parseEnvBoolean(process.env.AXON_DISABLE_TERMINAL_TITLE),
      enableTokenUsageAttachment: parseEnvBoolean(process.env.AXON_ENABLE_TOKEN_USAGE_ATTACHMENT),
      forceFullLogo: parseEnvBoolean(process.env.AXON_FORCE_FULL_LOGO),
      syntaxHighlight: parseEnvBoolean(process.env.AXON_SYNTAX_HIGHLIGHT) ?? true,
      microcompact: !parseEnvBoolean(process.env.DISABLE_MICROCOMPACT),
      disableCostWarnings: parseEnvBoolean(process.env.DISABLE_COST_WARNINGS),
      enableIncrementalTui: parseEnvBoolean(process.env.ENABLE_INCREMENTAL_TUI),
    };
  }

  // ===== 调试配置扩展 =====
  if (process.env.AXON_DIAGNOSTICS_FILE ||
      process.env.AXON_PROFILE_QUERY ||
      process.env.AXON_PROFILE_STARTUP ||
      process.env.AXON_ENABLE_SDK_FILE_CHECKPOINTING) {
    (config as any).debug = {
      diagnosticsFile: process.env.AXON_DIAGNOSTICS_FILE,
      profileQuery: parseEnvBoolean(process.env.AXON_PROFILE_QUERY),
      profileStartup: parseEnvBoolean(process.env.AXON_PROFILE_STARTUP),
      enableSdkFileCheckpointing: parseEnvBoolean(process.env.AXON_ENABLE_SDK_FILE_CHECKPOINTING),
    };
  }

  // ===== 网络配置 =====
  if (process.env.AXON_PROXY_RESOLVES_HOSTS ||
      process.env.AXON_DISABLE_NONESSENTIAL_TRAFFIC) {
    (config as any).network = {
      proxyResolvesHosts: parseEnvBoolean(process.env.AXON_PROXY_RESOLVES_HOSTS),
      disableNonessentialTraffic: parseEnvBoolean(process.env.AXON_DISABLE_NONESSENTIAL_TRAFFIC),
    };
  }

  // ===== 工具配置 =====
  if (process.env.AXON_MAX_TOOL_USE_CONCURRENCY ||
      process.env.ENABLE_TOOL_SEARCH ||
      process.env.AXON_USE_NATIVE_FILE_SEARCH ||
      process.env.ENABLE_BASH_ENV_VAR_MATCHING ||
      process.env.ENABLE_BASH_WRAPPER_MATCHING) {
    (config as any).tools = {
      maxConcurrency: parseEnvNumber(process.env.AXON_MAX_TOOL_USE_CONCURRENCY),
      enableSearch: parseEnvBoolean(process.env.ENABLE_TOOL_SEARCH),
      useNativeFileSearch: parseEnvBoolean(process.env.AXON_USE_NATIVE_FILE_SEARCH),
      enableBashEnvVarMatching: parseEnvBoolean(process.env.ENABLE_BASH_ENV_VAR_MATCHING),
      enableBashWrapperMatching: parseEnvBoolean(process.env.ENABLE_BASH_WRAPPER_MATCHING),
    };
  }

  // ===== Beta 功能 =====
  if (process.env.ENABLE_CODE_GUIDE_SUBAGENT ||
      process.env.ENABLE_BETA_TRACING_DETAILED ||
      process.env.ENABLE_ENHANCED_TELEMETRY_BETA ||
      process.env.AXON_DISABLE_EXPERIMENTAL_BETAS) {
    (config as any).beta = {
      enableCodeGuideSubagent: parseEnvBoolean(process.env.ENABLE_CODE_GUIDE_SUBAGENT),
      enableTracingDetailed: parseEnvBoolean(process.env.ENABLE_BETA_TRACING_DETAILED),
      enableEnhancedTelemetry: parseEnvBoolean(process.env.ENABLE_ENHANCED_TELEMETRY_BETA),
      disableExperimentalBetas: parseEnvBoolean(process.env.AXON_DISABLE_EXPERIMENTAL_BETAS),
    };
  }

  // ===== 杂项配置 =====
  if (process.env.AXON_TAGS) {
    if (!(config as any).misc) (config as any).misc = {};
    (config as any).misc.tags = process.env.AXON_TAGS.split(',').map((s: string) => s.trim());
  }
  if (process.env.AXON_TEAM_NAME) {
    if (!(config as any).misc) (config as any).misc = {};
    (config as any).misc.teamName = process.env.AXON_TEAM_NAME;
  }
  if (process.env.AXON_EXTRA_BODY) {
    if (!(config as any).misc) (config as any).misc = {};
    try {
      (config as any).misc.extraBody = JSON.parse(process.env.AXON_EXTRA_BODY);
    } catch (e) {
      console.warn('Failed to parse AXON_EXTRA_BODY:', e);
    }
  }
  if (process.env.AXON_TEST_FIXTURES_ROOT ||
      process.env.AXON_ENTRYPOINT ||
      process.env.DISABLE_ERROR_REPORTING ||
      process.env.DISABLE_AUTOUPDATER ||
      process.env.DISABLE_INSTALLATION_CHECKS ||
      process.env.DISABLE_AUTO_MIGRATE_TO_NATIVE) {
    if (!(config as any).misc) (config as any).misc = {};
    (config as any).misc.testFixturesRoot = process.env.AXON_TEST_FIXTURES_ROOT;
    (config as any).misc.entrypoint = process.env.AXON_ENTRYPOINT;
    (config as any).misc.disableErrorReporting = parseEnvBoolean(process.env.DISABLE_ERROR_REPORTING);
    (config as any).misc.disableAutoUpdater = parseEnvBoolean(process.env.DISABLE_AUTOUPDATER);
    (config as any).misc.disableInstallationChecks = parseEnvBoolean(process.env.DISABLE_INSTALLATION_CHECKS);
    (config as any).misc.disableAutoMigrateToNative = parseEnvBoolean(process.env.DISABLE_AUTO_MIGRATE_TO_NATIVE);
  }

  // ===== 命令禁用 =====
  if (process.env.DISABLE_LOGIN_COMMAND ||
      process.env.DISABLE_LOGOUT_COMMAND ||
      process.env.DISABLE_BUG_COMMAND ||
      process.env.DISABLE_DOCTOR_COMMAND ||
      process.env.DISABLE_FEEDBACK_COMMAND ||
      process.env.DISABLE_INSTALL_GITHUB_APP_COMMAND ||
      process.env.DISABLE_UPGRADE_COMMAND ||
      process.env.DISABLE_EXTRA_USAGE_COMMAND) {
    (config as any).disableCommands = {
      login: parseEnvBoolean(process.env.DISABLE_LOGIN_COMMAND),
      logout: parseEnvBoolean(process.env.DISABLE_LOGOUT_COMMAND),
      bug: parseEnvBoolean(process.env.DISABLE_BUG_COMMAND),
      doctor: parseEnvBoolean(process.env.DISABLE_DOCTOR_COMMAND),
      feedback: parseEnvBoolean(process.env.DISABLE_FEEDBACK_COMMAND),
      installGithubApp: parseEnvBoolean(process.env.DISABLE_INSTALL_GITHUB_APP_COMMAND),
      upgrade: parseEnvBoolean(process.env.DISABLE_UPGRADE_COMMAND),
      extraUsage: parseEnvBoolean(process.env.DISABLE_EXTRA_USAGE_COMMAND),
    };
  }

  // ===== 文件描述符 =====
  if (process.env.AXON_API_KEY_FILE_DESCRIPTOR ||
      process.env.AXON_OAUTH_TOKEN_FILE_DESCRIPTOR ||
      process.env.AXON_WEBSOCKET_AUTH_FILE_DESCRIPTOR ||
      process.env.AXON_API_KEY_HELPER_TTL_MS) {
    (config as any).fileDescriptors = {
      apiKey: parseEnvNumber(process.env.AXON_API_KEY_FILE_DESCRIPTOR),
      oauthToken: parseEnvNumber(process.env.AXON_OAUTH_TOKEN_FILE_DESCRIPTOR),
      websocketAuth: parseEnvNumber(process.env.AXON_WEBSOCKET_AUTH_FILE_DESCRIPTOR),
      apiKeyHelperTtlMs: parseEnvNumber(process.env.AXON_API_KEY_HELPER_TTL_MS),
    };
  }

  // ===== 最大重试和结构化输出 =====
  if (process.env.MAX_STRUCTURED_OUTPUT_RETRIES) {
    (config as any).maxStructuredOutputRetries = parseEnvNumber(process.env.MAX_STRUCTURED_OUTPUT_RETRIES);
  }

  // ===== 遥测配置扩展 =====
  if (process.env.AXON_OTEL_FLUSH_TIMEOUT_MS ||
      process.env.AXON_OTEL_HEADERS_HELPER_DEBOUNCE_MS) {
    if (!config.telemetry) config.telemetry = {};
    (config.telemetry as any).otelFlushTimeoutMs = parseEnvNumber(process.env.AXON_OTEL_FLUSH_TIMEOUT_MS);
    (config.telemetry as any).otelHeadersHelperDebounceMs = parseEnvNumber(process.env.AXON_OTEL_HEADERS_HELPER_DEBOUNCE_MS);
  }

  return config;
}

// ============ 配置迁移 ============

interface ConfigMigration {
  version: string;
  migrate: (config: any) => any;
}

const MIGRATIONS: ConfigMigration[] = [
  {
    version: '2.0.0',
    migrate: (config) => {
      // 迁移旧的模型名称
      if (config.model === 'claude-3-opus') config.model = 'opus';
      if (config.model === 'claude-3-sonnet') config.model = 'sonnet';
      if (config.model === 'claude-3-haiku') config.model = 'haiku';
      return config;
    },
  },
  {
    version: '2.1.4',
    migrate: (config) => {
      // 添加新字段的默认值
      if (!config.version) config.version = '2.1.4';
      if (config.autoSave !== undefined) {
        config.enableAutoSave = config.autoSave;
        delete config.autoSave;
      }
      return config;
    },
  },
];

function migrateConfig(config: any): any {
  const currentVersion = config.version || '1.0.0';
  let migratedConfig = { ...config };

  for (const migration of MIGRATIONS) {
    if (compareVersions(currentVersion, migration.version) < 0) {
      migratedConfig = migration.migrate(migratedConfig);
    }
  }

  migratedConfig.version = '2.1.4';
  return migratedConfig;
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  return 0;
}

// ============ 配置来源类型 ============
// 官方优先级链（从低到高）:
// 1. default (内置默认值)
// 2. userSettings (~/.axon/settings.json)
// 3. projectSettings (.axon/settings.json)
// 4. localSettings (.axon/settings.local.json - 机器特定, 应添加到 .gitignore)
// 5. envSettings (环境变量)
// 6. flagSettings (命令行标志)
// 7. policySettings (企业策略 - 最高优先级，强制覆盖)

export type ConfigSource =
  | 'default'           // 优先级 0 - 内置默认值
  | 'userSettings'      // 优先级 1 - 用户全局配置 (~/.axon/settings.json)
  | 'projectSettings'   // 优先级 2 - 项目配置 (.axon/settings.json)
  | 'localSettings'     // 优先级 3 - 本地配置 (.axon/settings.local.json, 机器特定)
  | 'envSettings'       // 优先级 4 - 环境变量
  | 'flagSettings'      // 优先级 5 - 命令行标志
  | 'policySettings'    // 优先级 6 - 企业策略（最高优先级，强制覆盖用户设置）
  | 'plugin'            // 插件提供的配置
  | 'built-in';         // 内置配置

// 优先级映射
export const CONFIG_SOURCE_PRIORITY: Record<ConfigSource, number> = {
  'default': 0,
  'userSettings': 1,
  'projectSettings': 2,
  'localSettings': 3,
  'envSettings': 4,
  'flagSettings': 5,
  'policySettings': 6,  // 最高优先级
  'plugin': 3,          // 与 localSettings 同级
  'built-in': 0,        // 与 default 同级
};

export interface ConfigSourceInfo {
  source: ConfigSource;
  path?: string;
  priority: number;
  exists?: boolean;     // 配置文件是否存在
  loadedAt?: Date;      // 加载时间
}

export interface ConfigWithSource<T = any> {
  value: T;
  source: ConfigSource;
  sourcePath?: string;  // 配置来源路径（如果适用）
}

// 配置项详细来源信息
export interface ConfigKeySource {
  key: string;
  value: any;
  source: ConfigSource;
  sourcePath?: string;
  overriddenBy?: ConfigSource[];  // 被哪些来源覆盖
}

// 企业策略配置接口
export interface EnterprisePolicyConfig {
  // 强制设置（不可被用户覆盖）
  enforced?: Partial<UserConfig>;
  // 默认设置（可被用户覆盖）
  defaults?: Partial<UserConfig>;
  // 禁用的功能
  disabledFeatures?: string[];
  // 允许的工具白名单
  allowedTools?: string[];
  // 禁止的工具黑名单
  deniedTools?: string[];
  // 策略元数据
  metadata?: {
    version?: string;
    lastUpdated?: string;
    organizationId?: string;
    policyName?: string;
  };
}

// ============ ConfigManager 增强版 ============

export interface ConfigManagerOptions {
  flagSettingsPath?: string;
  workingDirectory?: string;
  debugMode?: boolean;
  cliFlags?: Partial<UserConfig>;  // 直接传入的 CLI 标志
}

export class ConfigManager {
  private globalConfigDir: string;
  private userConfigFile: string;         // 用户配置 (~/.axon/settings.json)
  private projectConfigFile: string;      // 项目配置 (.axon/settings.json)
  private localConfigFile: string;        // 本地配置 (.axon/settings.local.json) - 官方命名
  private policyConfigFile: string;       // 企业策略配置 (~/.axon/managed_settings.json)
  private flagConfigFile?: string;        // 标志配置文件 (命令行指定的配置文件)

  private mergedConfig: UserConfig;
  private configSources: Map<string, ConfigSource> = new Map(); // 记录每个配置项的来源
  private configSourcePaths: Map<string, string> = new Map();   // 记录每个配置项的来源路径
  private configHistory: Map<string, ConfigKeySource[]> = new Map(); // 记录配置项的覆盖历史
  private watchers: fs.FSWatcher[] = [];
  private reloadCallbacks: Array<(config: UserConfig) => void> = [];
  private debugMode: boolean;
  private cliFlags?: Partial<UserConfig>;
  private enterprisePolicy?: EnterprisePolicyConfig;
  private loadedSources: ConfigSourceInfo[] = [];

  constructor(options?: ConfigManagerOptions) {
    this.debugMode = options?.debugMode ?? (process.env.AXON_DEBUG === 'true');
    this.cliFlags = options?.cliFlags;

    const workingDir = options?.workingDirectory ?? process.cwd();

    // 全局配置目录
    this.globalConfigDir = process.env.AXON_CONFIG_DIR ||
                           path.join(process.env.HOME || process.env.USERPROFILE || '~', '.axon');

    // 用户配置文件 (~/.axon/settings.json)
    this.userConfigFile = path.join(this.globalConfigDir, 'settings.json');

    // 企业策略配置文件 (~/.axon/managed_settings.json) - 官方命名
    // 同时支持 policy.json 作为备选
    const managedSettingsPath = path.join(this.globalConfigDir, 'managed_settings.json');
    const policyJsonPath = path.join(this.globalConfigDir, 'policy.json');
    this.policyConfigFile = fs.existsSync(managedSettingsPath) ? managedSettingsPath : policyJsonPath;

    // 项目配置文件 (.axon/settings.json)
    this.projectConfigFile = path.join(workingDir, '.axon', 'settings.json');

    // 本地配置文件 (.axon/settings.local.json) - 官方命名，应添加到 .gitignore
    this.localConfigFile = path.join(workingDir, '.axon', 'settings.local.json');

    // 标志配置文件 (通过命令行 --settings 指定)
    this.flagConfigFile = options?.flagSettingsPath;

    // 验证环境变量
    this.validateEnvironmentVariables();

    // 加载并合并配置
    this.mergedConfig = this.loadAndMergeConfig();

    // 调试输出
    if (this.debugMode) {
      this.printDebugInfo();
    }
  }

  /**
   * 验证所有环境变量
   */
  private validateEnvironmentVariables(): void {
    // 验证环境变量并记录结果
    const results = envManager.validateAll();

    // 输出验证警告
    for (const [name, result] of results) {
      if (result.status === 'invalid') {
        console.warn(`[Config] Invalid environment variable ${name}: ${result.message}`);
      } else if (result.status === 'capped') {
        console.warn(`[Config] Environment variable ${name} capped: ${result.message}`);
      }
    }
  }

  /**
   * 加载并合并所有配置源
   *
   * 官方优先级链（从低到高）:
   * 1. default - 内置默认值
   * 2. userSettings - 用户全局配置 (~/.axon/settings.json)
   * 3. projectSettings - 项目配置 (.axon/settings.json)
   * 4. localSettings - 本地配置 (.axon/settings.local.json)
   * 5. envSettings - 环境变量
   * 6. flagSettings - 命令行标志
   * 7. policySettings - 企业策略（最高优先级，强制覆盖）
   */
  private loadAndMergeConfig(): UserConfig {
    this.configSources.clear();
    this.configSourcePaths.clear();
    this.configHistory.clear();
    this.loadedSources = [];

    const loadTime = new Date();

    // 1. 默认配置 (优先级 0)
    let config: any = { ...DEFAULT_CONFIG };
    this.trackConfigSource(config, 'default');
    this.loadedSources.push({
      source: 'default',
      priority: CONFIG_SOURCE_PRIORITY.default,
      exists: true,
      loadedAt: loadTime,
    });

    // 2. 加载企业策略（如果存在）以获取默认值
    this.enterprisePolicy = this.loadEnterprisePolicy();
    if (this.enterprisePolicy?.defaults) {
      // 企业策略的默认值会被用户设置覆盖
      config = this.mergeConfig(config, this.enterprisePolicy.defaults, 'policySettings', this.policyConfigFile);
      this.debugLog('Loaded enterprise policy defaults');
    }

    // 3. 用户配置 (~/.axon/settings.json) (优先级 1)
    const userConfigExists = fs.existsSync(this.userConfigFile);
    this.loadedSources.push({
      source: 'userSettings',
      path: this.userConfigFile,
      priority: CONFIG_SOURCE_PRIORITY.userSettings,
      exists: userConfigExists,
      loadedAt: loadTime,
    });
    if (userConfigExists) {
      const userConfig = this.loadConfigFile(this.userConfigFile);
      if (userConfig) {
        config = this.mergeConfig(config, userConfig, 'userSettings', this.userConfigFile);
        this.debugLog(`Loaded user settings from ${this.userConfigFile}`);
      }
    }

    // 4. 项目配置 (.axon/settings.json) (优先级 2)
    const projectConfigExists = fs.existsSync(this.projectConfigFile);
    this.loadedSources.push({
      source: 'projectSettings',
      path: this.projectConfigFile,
      priority: CONFIG_SOURCE_PRIORITY.projectSettings,
      exists: projectConfigExists,
      loadedAt: loadTime,
    });
    if (projectConfigExists) {
      const projectConfig = this.loadConfigFile(this.projectConfigFile);
      if (projectConfig) {
        config = this.mergeConfig(config, projectConfig, 'projectSettings', this.projectConfigFile);
        this.debugLog(`Loaded project settings from ${this.projectConfigFile}`);
      }
    }

    // 5. 本地配置 (.axon/settings.local.json) (优先级 3)
    const localConfigExists = fs.existsSync(this.localConfigFile);
    this.loadedSources.push({
      source: 'localSettings',
      path: this.localConfigFile,
      priority: CONFIG_SOURCE_PRIORITY.localSettings,
      exists: localConfigExists,
      loadedAt: loadTime,
    });
    if (localConfigExists) {
      const localConfig = this.loadConfigFile(this.localConfigFile);
      if (localConfig) {
        config = this.mergeConfig(config, localConfig, 'localSettings', this.localConfigFile);
        this.debugLog(`Loaded local settings from ${this.localConfigFile}`);
      }
    }

    // 6. 环境变量 (优先级 4)
    const envConfig = getEnvConfig();
    const envKeys = Object.keys(envConfig).filter(k => (envConfig as any)[k] !== undefined);
    if (envKeys.length > 0) {
      config = this.mergeConfig(config, envConfig, 'envSettings');
      this.loadedSources.push({
        source: 'envSettings',
        priority: CONFIG_SOURCE_PRIORITY.envSettings,
        exists: true,
        loadedAt: loadTime,
      });
      this.debugLog(`Loaded ${envKeys.length} settings from environment variables`);
    }

    // 7. CLI 标志配置 (优先级 5)
    // 7a. 从配置文件加载（如果指定了 --settings）
    if (this.flagConfigFile) {
      const flagConfigExists = fs.existsSync(this.flagConfigFile);
      this.loadedSources.push({
        source: 'flagSettings',
        path: this.flagConfigFile,
        priority: CONFIG_SOURCE_PRIORITY.flagSettings,
        exists: flagConfigExists,
        loadedAt: loadTime,
      });
      if (flagConfigExists) {
        const flagConfig = this.loadConfigFile(this.flagConfigFile);
        if (flagConfig) {
          config = this.mergeConfig(config, flagConfig, 'flagSettings', this.flagConfigFile);
          this.debugLog(`Loaded flag settings from ${this.flagConfigFile}`);
        }
      }
    }

    // 7b. 直接传入的 CLI 标志（最高用户可控优先级）
    if (this.cliFlags) {
      const cliKeys = Object.keys(this.cliFlags).filter(k => (this.cliFlags as any)[k] !== undefined);
      if (cliKeys.length > 0) {
        config = this.mergeConfig(config, this.cliFlags, 'flagSettings');
        this.debugLog(`Applied ${cliKeys.length} CLI flag overrides`);
      }
    }

    // 8. 企业策略强制设置 (优先级 6 - 最高)
    // 强制设置会覆盖所有用户配置
    if (this.enterprisePolicy?.enforced) {
      config = this.mergeConfig(config, this.enterprisePolicy.enforced, 'policySettings', this.policyConfigFile);
      this.loadedSources.push({
        source: 'policySettings',
        path: this.policyConfigFile,
        priority: CONFIG_SOURCE_PRIORITY.policySettings,
        exists: true,
        loadedAt: loadTime,
      });
      this.debugLog('Applied enterprise policy enforced settings (highest priority)');
    }

    // 9. 迁移配置
    config = migrateConfig(config);

    // 10. 验证配置
    try {
      return UserConfigSchema.parse(config);
    } catch (error: any) {
      // v2.1.33: 改进错误展示 - 将验证错误详细展示给用户
      if (error?.issues) {
        const details = error.issues.map((issue: any) =>
          `- ${issue.path?.join('.') || 'root'}: ${issue.message}`
        ).join('\n');
        console.error(`Error processing settings:\n${details}`);
      } else {
        console.warn('Config validation failed, using defaults:', error);
      }
      return UserConfigSchema.parse(DEFAULT_CONFIG);
    }
  }

  /**
   * 加载企业策略配置
   */
  private loadEnterprisePolicy(): EnterprisePolicyConfig | undefined {
    try {
      if (fs.existsSync(this.policyConfigFile)) {
        const content = fs.readFileSync(this.policyConfigFile, 'utf-8');
        const policy = JSON.parse(content);
        this.debugLog(`Loaded enterprise policy from ${this.policyConfigFile}`);
        return policy as EnterprisePolicyConfig;
      }
    } catch (error) {
      // v2.1.33: 将 managed settings 错误直接展示给用户
      // 之前只在 debug 模式下输出，现在总是展示
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error processing settings: ${errorMsg}`);
      this.debugLog(`Failed to load enterprise policy: ${error}`);
    }
    return undefined;
  }

  /**
   * 调试日志
   */
  private debugLog(message: string): void {
    if (this.debugMode) {
      console.log(`[Config] ${message}`);
    }
  }

  /**
   * 打印调试信息
   */
  private printDebugInfo(): void {
    console.log('\n=== Configuration Debug Info ===');
    console.log('Loaded sources:');
    for (const source of this.loadedSources) {
      const status = source.exists ? 'OK' : 'NOT FOUND';
      const pathInfo = source.path ? ` (${source.path})` : '';
      console.log(`  [${source.priority}] ${source.source}${pathInfo}: ${status}`);
    }

    console.log('\nConfiguration key sources:');
    const sources = this.getAllConfigSources();
    for (const [key, source] of sources) {
      const sourcePath = this.configSourcePaths.get(key);
      const pathInfo = sourcePath ? ` (${sourcePath})` : '';
      console.log(`  ${key}: ${source}${pathInfo}`);
    }

    if (this.enterprisePolicy) {
      console.log('\nEnterprise policy:');
      if (this.enterprisePolicy.enforced) {
        console.log('  Enforced keys:', Object.keys(this.enterprisePolicy.enforced).join(', '));
      }
      if (this.enterprisePolicy.disabledFeatures?.length) {
        console.log('  Disabled features:', this.enterprisePolicy.disabledFeatures.join(', '));
      }
    }

    console.log('================================\n');
  }

  /**
   * 合并配置并追踪来源
   */
  private mergeConfig(base: any, override: any, source: ConfigSource, sourcePath?: string): any {
    const merged = this.deepMerge(base, override);
    this.trackConfigSource(override, source, sourcePath);
    return merged;
  }

  /**
   * 深度合并对象
   */
  private deepMerge(base: any, override: any): any {
    if (override === undefined) return base;
    if (base === undefined) return override;
    if (typeof override !== 'object' || override === null) return override;
    if (typeof base !== 'object' || base === null) return override;
    if (Array.isArray(override)) return override;

    const result = { ...base };
    for (const key of Object.keys(override)) {
      if (override[key] !== undefined) {
        if (typeof override[key] === 'object' && !Array.isArray(override[key]) && override[key] !== null) {
          result[key] = this.deepMerge(base[key], override[key]);
        } else {
          result[key] = override[key];
        }
      }
    }
    return result;
  }

  /**
   * 追踪配置项来源
   */
  private trackConfigSource(config: any, source: ConfigSource, sourcePath?: string): void {
    this.trackConfigSourceRecursive(config, source, sourcePath, '');
  }

  /**
   * 递归追踪配置项来源
   */
  private trackConfigSourceRecursive(config: any, source: ConfigSource, sourcePath: string | undefined, prefix: string): void {
    if (config === undefined || config === null) return;
    if (typeof config !== 'object') return;

    for (const key of Object.keys(config)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      const value = config[key];

      if (value !== undefined) {
        // 记录当前来源
        const previousSource = this.configSources.get(fullKey);

        // 追踪覆盖历史
        if (previousSource && previousSource !== source) {
          const history = this.configHistory.get(fullKey) || [];
          history.push({
            key: fullKey,
            value,
            source,
            sourcePath,
            overriddenBy: previousSource ? [previousSource] : undefined,
          });
          this.configHistory.set(fullKey, history);
        }

        // 更新当前来源
        this.configSources.set(fullKey, source);
        if (sourcePath) {
          this.configSourcePaths.set(fullKey, sourcePath);
        }

        // 递归处理嵌套对象
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          this.trackConfigSourceRecursive(value, source, sourcePath, fullKey);
        }
      }
    }
  }

  /**
   * 从文件加载配置
   */
  private loadConfigFile(filePath: string): any | null {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`Failed to load config file: ${filePath}`, error);
    }
    return null;
  }

  /**
   * 保存配置到用户配置文件 (旧名: 全局配置)
   */
  save(config?: Partial<UserConfig>): void {
    if (config) {
      this.mergedConfig = UserConfigSchema.parse({
        ...this.mergedConfig,
        ...config,
      });
    }

    if (!fs.existsSync(this.globalConfigDir)) {
      fs.mkdirSync(this.globalConfigDir, { recursive: true });
    }

    // 备份现有配置
    this.backupConfig(this.userConfigFile);

    // 读取当前文件中的内容作为基础
    let fileContent: Record<string, any> = {};
    try {
      if (fs.existsSync(this.userConfigFile)) {
        fileContent = JSON.parse(fs.readFileSync(this.userConfigFile, 'utf-8'));
      }
    } catch {
      // 文件读取失败，忽略
    }

    // 只把本次 config 参数中的字段合并到文件内容上，不写入整个 mergedConfig
    // 这样环境变量、项目配置等其他来源的值不会被"烘焙"到用户配置文件
    const output = config
      ? { ...fileContent, ...config }
      : { ...fileContent };

    // 处理显式设为 undefined 的属性：从 output 中删除
    for (const key of Object.keys(output)) {
      if (output[key] === undefined) {
        delete output[key];
      }
    }

    fs.writeFileSync(
      this.userConfigFile,
      JSON.stringify(output, null, 2),
      'utf-8'
    );
  }

  /**
   * 保存到本地配置文件 (.axon/settings.local.json)
   * 此文件应添加到 .gitignore，用于机器特定的配置
   */
  saveLocal(config: Partial<UserConfig>): void {
    const localDir = path.dirname(this.localConfigFile);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    // 检查配置项是否被企业策略强制
    if (this.enterprisePolicy?.enforced) {
      const enforcedKeys = Object.keys(this.enterprisePolicy.enforced);
      const attemptedEnforcedKeys = Object.keys(config).filter(k => enforcedKeys.includes(k));
      if (attemptedEnforcedKeys.length > 0) {
        console.warn(`Cannot save the following settings locally - they are enforced by enterprise policy: ${attemptedEnforcedKeys.join(', ')}`);
        // 移除被强制的配置项
        for (const key of attemptedEnforcedKeys) {
          delete (config as any)[key];
        }
      }
    }

    const currentLocalConfig = this.loadConfigFile(this.localConfigFile) || {};
    const newLocalConfig = this.deepMerge(currentLocalConfig, config);

    this.backupConfig(this.localConfigFile);

    fs.writeFileSync(
      this.localConfigFile,
      JSON.stringify(newLocalConfig, null, 2),
      'utf-8'
    );

    // 确保 .gitignore 包含 settings.local.json
    this.ensureGitignore(localDir);

    this.reload();
  }

  /**
   * 确保 .gitignore 包含 settings.local.json
   */
  private ensureGitignore(claudeDir: string): void {
    const projectRoot = path.dirname(claudeDir);
    const gitignorePath = path.join(projectRoot, '.gitignore');

    try {
      let content = '';
      if (fs.existsSync(gitignorePath)) {
        content = fs.readFileSync(gitignorePath, 'utf-8');
      }

      const patterns = [
        '.axon/settings.local.json',
        '# Axon local settings (machine-specific)',
      ];

      const linesToAdd: string[] = [];
      for (const pattern of patterns) {
        if (!content.includes(pattern)) {
          linesToAdd.push(pattern);
        }
      }

      if (linesToAdd.length > 0) {
        const newContent = content.trim() + '\n\n' + linesToAdd.join('\n') + '\n';
        fs.writeFileSync(gitignorePath, newContent, 'utf-8');
        this.debugLog(`Added settings.local.json to .gitignore`);
      }
    } catch (error) {
      // 忽略 .gitignore 更新失败
      this.debugLog(`Failed to update .gitignore: ${error}`);
    }
  }

  /**
   * 保存到项目配置文件
   */
  saveProject(config: Partial<UserConfig>): void {
    const projectDir = path.dirname(this.projectConfigFile);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }

    const currentProjectConfig = this.loadConfigFile(this.projectConfigFile) || {};
    const newProjectConfig = { ...currentProjectConfig, ...config };

    fs.writeFileSync(
      this.projectConfigFile,
      JSON.stringify(newProjectConfig, null, 2),
      'utf-8'
    );

    this.reload();
  }

  /**
   * 重新加载配置
   */
  reload(): void {
    this.mergedConfig = this.loadAndMergeConfig();
    this.reloadCallbacks.forEach(cb => cb(this.mergedConfig));
  }

  /**
   * 监听配置变化（热重载）
   */
  watch(callback: (config: UserConfig) => void): void {
    this.reloadCallbacks.push(callback);

    // 要监听的配置文件列表
    const filesToWatch = [
      this.userConfigFile,
      this.projectConfigFile,
      this.localConfigFile,
      this.policyConfigFile,
    ];

    if (this.flagConfigFile) {
      filesToWatch.push(this.flagConfigFile);
    }

    // 监听所有配置文件
    for (const file of filesToWatch) {
      if (fs.existsSync(file)) {
        const watcher = fs.watch(file, () => {
          this.reload();
        });
        this.watchers.push(watcher);
      }
    }
  }

  /**
   * 停止监听
   */
  unwatch(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers = [];
    this.reloadCallbacks = [];
  }

  /**
   * 获取配置项
   */
  get<K extends keyof UserConfig>(key: K): UserConfig[K] {
    return this.mergedConfig[key];
  }

  /**
   * 设置配置项
   */
  set<K extends keyof UserConfig>(key: K, value: UserConfig[K]): void {
    this.mergedConfig[key] = value;
    this.save({ [key]: value } as Partial<UserConfig>);
  }

  /**
   * 获取所有配置
   */
  getAll(): UserConfig {
    return { ...this.mergedConfig };
  }

  /**
   * 获取 API 密钥
   */
  getApiKey(): string | undefined {
    return this.mergedConfig.apiKey;
  }

  /**
   * 获取验证后的环境变量值
   */
  getValidatedEnv<T = any>(name: string): T | undefined {
    return getValidatedEnv<T>(name);
  }

  /**
   * 获取环境变量管理器
   */
  getEnvManager() {
    return envManager;
  }

  /**
   * 导出配置（掩码敏感信息）
   */
  export(maskSecrets = true): string {
    const config = { ...this.mergedConfig };

    if (maskSecrets) {
      // 使用统一的敏感字段掩码函数
      const masked = maskSensitiveFields(config);
      return JSON.stringify(masked, null, 2);
    }

    return JSON.stringify(config, null, 2);
  }

  /**
   * 导入配置
   */
  import(configJson: string): boolean {
    try {
      const config = JSON.parse(configJson);
      const validated = UserConfigSchema.parse(config);
      this.mergedConfig = validated;
      this.save(validated);
      return true;
    } catch (error) {
      console.error('Failed to import config:', error);
      return false;
    }
  }


  /**
   * 验证配置
   */
  validate(): { valid: boolean; errors?: z.ZodError } {
    try {
      UserConfigSchema.parse(this.mergedConfig);
      return { valid: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { valid: false, errors: error };
      }
      return { valid: false };
    }
  }

  /**
   * 重置为默认配置
   */
  reset(): void {
    const defaults = UserConfigSchema.parse(DEFAULT_CONFIG);
    this.mergedConfig = defaults;
    this.save(defaults);
  }

  // ============ 配置来源查询 ============

  /**
   * 获取配置项的来源
   */
  getConfigSource(key: keyof UserConfig): ConfigSource | undefined {
    return this.configSources.get(String(key));
  }

  /**
   * 获取所有配置来源
   */
  getAllConfigSources(): Map<string, ConfigSource> {
    return new Map(this.configSources);
  }

  /**
   * 获取配置来源信息
   */
  getConfigSourceInfo(): ConfigSourceInfo[] {
    return [...this.loadedSources];
  }

  /**
   * 获取所有可能的配置来源（包括未加载的）
   */
  getAllPossibleSources(): ConfigSourceInfo[] {
    return [
      { source: 'default', priority: CONFIG_SOURCE_PRIORITY.default, exists: true },
      { source: 'userSettings', path: this.userConfigFile, priority: CONFIG_SOURCE_PRIORITY.userSettings, exists: fs.existsSync(this.userConfigFile) },
      { source: 'projectSettings', path: this.projectConfigFile, priority: CONFIG_SOURCE_PRIORITY.projectSettings, exists: fs.existsSync(this.projectConfigFile) },
      { source: 'localSettings', path: this.localConfigFile, priority: CONFIG_SOURCE_PRIORITY.localSettings, exists: fs.existsSync(this.localConfigFile) },
      { source: 'envSettings', priority: CONFIG_SOURCE_PRIORITY.envSettings, exists: true },
      { source: 'flagSettings', path: this.flagConfigFile, priority: CONFIG_SOURCE_PRIORITY.flagSettings, exists: this.flagConfigFile ? fs.existsSync(this.flagConfigFile) : false },
      { source: 'policySettings', path: this.policyConfigFile, priority: CONFIG_SOURCE_PRIORITY.policySettings, exists: fs.existsSync(this.policyConfigFile) },
    ];
  }

  /**
   * 获取配置项及其来源
   */
  getWithSource<K extends keyof UserConfig>(key: K): ConfigWithSource<UserConfig[K]> {
    const keyStr = String(key);
    return {
      value: this.mergedConfig[key],
      source: this.configSources.get(keyStr) || 'default',
      sourcePath: this.configSourcePaths.get(keyStr),
    };
  }

  /**
   * 获取配置项的覆盖历史
   */
  getConfigHistory(key: string): ConfigKeySource[] {
    return this.configHistory.get(key) || [];
  }

  /**
   * 获取所有配置项的详细来源信息
   */
  getAllConfigDetails(): ConfigKeySource[] {
    const details: ConfigKeySource[] = [];
    for (const [key, source] of this.configSources) {
      details.push({
        key,
        value: this.getNestedValue(this.mergedConfig, key),
        source,
        sourcePath: this.configSourcePaths.get(key),
        overriddenBy: this.getConfigHistory(key).map(h => h.source),
      });
    }
    return details;
  }

  /**
   * 获取嵌套值
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === undefined || current === null) return undefined;
      current = current[key];
    }
    return current;
  }

  /**
   * 检查配置项是否被企业策略强制
   */
  isEnforcedByPolicy(key: string): boolean {
    if (!this.enterprisePolicy?.enforced) return false;
    return key in this.enterprisePolicy.enforced;
  }

  /**
   * 获取企业策略信息
   */
  getEnterprisePolicy(): EnterprisePolicyConfig | undefined {
    return this.enterprisePolicy;
  }

  /**
   * 检查功能是否被企业策略禁用
   */
  isFeatureDisabled(feature: string): boolean {
    return this.enterprisePolicy?.disabledFeatures?.includes(feature) ?? false;
  }

  /**
   * 获取配置文件路径
   */
  getConfigPaths(): Record<string, string> {
    return {
      userSettings: this.userConfigFile,
      projectSettings: this.projectConfigFile,
      localSettings: this.localConfigFile,
      policySettings: this.policyConfigFile,
      flagSettings: this.flagConfigFile || '',
      globalConfigDir: this.globalConfigDir,
    };
  }

  // ============ 配置备份和恢复 ============

  /**
   * 备份配置文件
   * v2.1.6 修复: 检查是否已存在相同内容的备份，避免重复备份文件累积
   */
  private backupConfig(filePath: string): void {
    if (!fs.existsSync(filePath)) return;

    const backupDir = path.join(path.dirname(filePath), '.backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const filename = path.basename(filePath, '.json');

    try {
      // 读取当前配置文件内容
      const currentContent = fs.readFileSync(filePath, { encoding: 'utf-8' });

      // 获取现有备份文件列表
      const existingBackups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(filename) && f.endsWith('.json'));

      // 检查是否已存在相同内容的备份
      let duplicateFound = false;
      for (const backupFile of existingBackups) {
        try {
          const backupPath = path.join(backupDir, backupFile);
          const backupContent = fs.readFileSync(backupPath, { encoding: 'utf-8' });
          if (currentContent === backupContent) {
            duplicateFound = true;
            this.debugLog(`Skipping backup - identical content already exists: ${backupFile}`);
            break;
          }
        } catch {
          // 忽略无法读取的备份文件
        }
      }

      // 如果没有找到相同内容的备份，才创建新备份
      if (!duplicateFound) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `${filename}.${timestamp}.json`);
        fs.copyFileSync(filePath, backupPath);
        this.debugLog(`Config backed up to: ${backupPath}`);
      }

      // 清理旧的备份文件
      this.cleanOldBackups(backupDir, filename);
    } catch (error) {
      console.warn(`Failed to backup config: ${error}`);
    }
  }

  /**
   * 清理旧的备份文件（保留最近10个）
   */
  private cleanOldBackups(backupDir: string, filename: string): void {
    try {
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith(filename))
        .map(f => ({
          name: f,
          path: path.join(backupDir, f),
          mtime: fs.statSync(path.join(backupDir, f)).mtime,
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // 保留最近10个备份
      files.slice(10).forEach(file => {
        fs.unlinkSync(file.path);
      });
    } catch (error) {
      console.warn(`Failed to clean backups: ${error}`);
    }
  }

  /**
   * 列出可用的备份
   */
  listBackups(configType: 'user' | 'project' | 'local' = 'user'): string[] {
    const configFile = configType === 'user' ? this.userConfigFile :
                      configType === 'project' ? this.projectConfigFile :
                      this.localConfigFile;

    const backupDir = path.join(path.dirname(configFile), '.backups');
    if (!fs.existsSync(backupDir)) return [];

    const filename = path.basename(configFile, '.json');
    return fs.readdirSync(backupDir)
      .filter(f => f.startsWith(filename))
      .sort()
      .reverse();
  }

  /**
   * 从备份恢复配置
   */
  restoreFromBackup(backupFilename: string, configType: 'user' | 'project' | 'local' = 'user'): boolean {
    const configFile = configType === 'user' ? this.userConfigFile :
                      configType === 'project' ? this.projectConfigFile :
                      this.localConfigFile;

    const backupDir = path.join(path.dirname(configFile), '.backups');
    const backupPath = path.join(backupDir, backupFilename);

    if (!fs.existsSync(backupPath)) {
      console.error(`Backup file does not exist: ${backupPath}`);
      return false;
    }

    try {
      // 备份当前配置
      this.backupConfig(configFile);

      // 恢复备份
      fs.copyFileSync(backupPath, configFile);

      // 重新加载配置
      this.reload();

      return true;
    } catch (error) {
      console.error(`Failed to restore backup: ${error}`);
      return false;
    }
  }

  // ============ MCP 服务器管理 ============

  getMcpServers(): Record<string, McpServerConfig> {
    return (this.mergedConfig.mcpServers || {}) as Record<string, McpServerConfig>;
  }

  addMcpServer(name: string, config: McpServerConfig): void {
    try {
      // 验证 MCP 服务器配置
      McpServerConfigSchema.parse(config);

      if (!this.mergedConfig.mcpServers) {
        this.mergedConfig.mcpServers = {};
      }
      this.mergedConfig.mcpServers[name] = config;
      this.save({ mcpServers: this.mergedConfig.mcpServers });
    } catch (error) {
      throw new Error(`无效的 MCP 服务器配置: ${error}`);
    }
  }

  removeMcpServer(name: string): boolean {
    if (this.mergedConfig.mcpServers?.[name]) {
      delete this.mergedConfig.mcpServers[name];
      this.save({ mcpServers: this.mergedConfig.mcpServers });
      return true;
    }
    return false;
  }

  updateMcpServer(name: string, config: Partial<McpServerConfig>): boolean {
    if (this.mergedConfig.mcpServers?.[name]) {
      const updated = { ...this.mergedConfig.mcpServers[name], ...config };
      try {
        McpServerConfigSchema.parse(updated);
        this.mergedConfig.mcpServers[name] = updated as McpServerConfig;
        this.save({ mcpServers: this.mergedConfig.mcpServers });
        return true;
      } catch (error) {
        throw new Error(`无效的 MCP 服务器配置: ${error}`);
      }
    }
    return false;
  }
}

// ============ 全局实例 ============

export const configManager = new ConfigManager();

// ============ 导出其他模块 ============

export {
  AxonMdParser,
  axonMdParser,
  // v2.1.2+ @include 二进制文件过滤辅助函数
  isTextFile,
  isBinaryFile,
  getTextFileExtensions,
  hasBinaryContent,
} from './axon-md-parser.js';
export { ConfigCommand, createConfigCommand } from './config-command.js';

// ============ v2.1.18 Keybindings 模块导出 ============
export {
  // 类型
  type ParsedKey,
  type KeybindingContext,
  type KeybindingBlock,
  type ReservedKey,
  type KeybindingWarning,
  type KeybindingsLoadResult,
  type KeybindingsConfig,
  // 常量
  DEFAULT_KEYBINDINGS,
  CHORD_KEYBINDINGS,
  // 函数
  getReservedKeys,
  parseKeyString,
  normalizeKeyString,
  getKeybindingsPath,
  getDefaultBindings,
  isUserCustomizationEnabled,
  loadKeybindings,
  getKeybindings,
  initKeybindings,
  onKeybindingsChange,
  stopFileWatcher,
  generateTemplateContent,
  findKeybinding,
  getContextBindings,
  matchKeyInput,
} from './keybindings.js';

// ============ 重新导出环境变量模块 ============

export {
  // 验证器
  type ValidationStatus,
  type ValidationResult,
  type EnvVarValidator,
  envValidatorRegistry,
  validateEnvVar,
  getValidatedEnvValue,
  validateAllEnvVars,

  // 内置验证器
  BASH_MAX_OUTPUT_LENGTH,
  createBooleanValidator,
  createNumberRangeValidator,
  createEnumValidator,

  // 敏感变量
  isSensitiveVar,
  maskSensitive,
  maskSensitiveFields,
  getSensitiveEnvVars,
  getMaskedSensitiveEnvVars,
  getSafeEnvVars,

  // 管理器
  envManager,
  getValidatedEnv,
  validateAllEnv,
  exportSafeEnv,
} from '../env/index.js';

// ============ 环境变量配置（向后兼容） ============

export const ENV_VARS = {
  // API 配置
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  AXON_API_KEY: process.env.AXON_API_KEY,
  AXON_OAUTH_TOKEN: process.env.AXON_OAUTH_TOKEN,

  // 后端选择
  AXON_USE_BEDROCK: process.env.AXON_USE_BEDROCK,
  AXON_USE_VERTEX: process.env.AXON_USE_VERTEX,

  // 功能配置
  AXON_MAX_OUTPUT_TOKENS: process.env.AXON_MAX_OUTPUT_TOKENS,
  AXON_MAX_RETRIES: process.env.AXON_MAX_RETRIES,
  AXON_DEBUG_LOGS_DIR: process.env.AXON_DEBUG_LOGS_DIR,

  // 开关
  AXON_ENABLE_TELEMETRY: process.env.AXON_ENABLE_TELEMETRY,
  AXON_DISABLE_FILE_CHECKPOINTING: process.env.AXON_DISABLE_FILE_CHECKPOINTING,
};
