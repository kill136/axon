/**
 * Configuration Type Definitions for Axon CLI
 *
 * This file provides comprehensive type definitions for all configuration
 * aspects of the Axon CLI, including API settings, permissions,
 * hooks, MCP servers, plugins, UI preferences, and more.
 *
 * @module types/config
 * @version 2.1.4
 */

// ============================================================================
// Model Types
// ============================================================================

/**
 * Supported Claude model identifiers
 */
export type ModelName =
  | 'claude-opus-4-6'
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-5-20250929'
  | 'claude-haiku-4-5-20251001'
  | 'opus'
  | 'sonnet'
  | 'haiku';

/**
 * Model display name mapping
 */
export type ModelDisplayName =
  | 'Claude Opus 4.6'
  | 'Claude Opus 4.5'
  | 'Claude Sonnet 4.5'
  | 'Claude Haiku 4.5';

// ============================================================================
// API Backend Types
// ============================================================================

/**
 * API backend provider type
 */
export type APIBackend = 'anthropic' | 'bedrock' | 'vertex';

/**
 * API configuration
 */
export interface APIConfig {
  /** Anthropic API key */
  apiKey?: string;

  /** OAuth token for authenticated sessions */
  oauthToken?: string;

  /** Use AWS Bedrock backend */
  useBedrock?: boolean;

  /** Use Google Cloud Vertex AI backend */
  useVertex?: boolean;

  /** Maximum number of retry attempts for API calls */
  maxRetries?: number;

  /** Request timeout in milliseconds */
  requestTimeout?: number;

  /** Base URL for API requests (for custom endpoints) */
  baseURL?: string;

  /** Additional headers to include in API requests */
  headers?: Record<string, string>;
}

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Model generation parameters
 */
export interface ModelConfig {
  /** Model identifier */
  model?: ModelName;

  /** Maximum tokens to generate in response */
  maxTokens?: number;

  /** Temperature for response generation (0-1) */
  temperature?: number;

  /** Top-p sampling parameter */
  topP?: number;

  /** Top-k sampling parameter */
  topK?: number;

  /** Custom system prompt override */
  systemPrompt?: string;

  /** Stop sequences */
  stopSequences?: string[];
}

// ============================================================================
// Permission Settings
// ============================================================================

/**
 * Permission mode for tool execution
 */
export type PermissionMode =
  | 'acceptEdits'        // Auto-accept file edits
  | 'bypassPermissions'  // Bypass all permission checks
  | 'default'            // Ask for each permission
  | 'delegate'           // Delegate to external system
  | 'dontAsk'            // Don't ask, use rules
  | 'plan';              // Plan mode (no execution)

/**
 * Permission action type
 */
export type PermissionAction = 'allow' | 'deny' | 'ask';

/**
 * Permission scope
 */
export type PermissionScope = 'once' | 'session' | 'always';

/**
 * Tool-level permission settings
 */
export interface ToolPermissionSettings {
  /** List of allowed tool names */
  allow?: string[];

  /** List of denied tool names */
  deny?: string[];
}

/**
 * Path-level permission settings (supports glob patterns)
 */
export interface PathPermissionSettings {
  /** List of allowed path patterns */
  allow?: string[];

  /** List of denied path patterns */
  deny?: string[];
}

/**
 * Command-level permission settings for Bash tool
 */
export interface CommandPermissionSettings {
  /** List of allowed command patterns */
  allow?: string[];

  /** List of denied command patterns */
  deny?: string[];
}

/**
 * Network permission settings
 */
export interface NetworkPermissionSettings {
  /** List of allowed domain/URL patterns */
  allow?: string[];

  /** List of denied domain/URL patterns */
  deny?: string[];
}

/**
 * Audit logging configuration
 */
export interface AuditSettings {
  /** Enable audit logging */
  enabled?: boolean;

  /** Path to audit log file */
  logFile?: string;

  /** Maximum log file size in bytes */
  maxSize?: number;

  /** Log rotation count */
  rotationCount?: number;

  /** Include sensitive data in logs */
  includeSensitiveData?: boolean;
}

/**
 * Complete permission configuration
 */
export interface PermissionSettings {
  /** Default permission mode */
  mode?: PermissionMode;

  /** Tool-level permissions */
  tools?: ToolPermissionSettings;

  /** Path-level permissions */
  paths?: PathPermissionSettings;

  /** Command-level permissions */
  commands?: CommandPermissionSettings;

  /** Network permissions */
  network?: NetworkPermissionSettings;

  /** Audit logging settings */
  audit?: AuditSettings;

  /** Remember permission decisions */
  rememberDecisions?: boolean;

  /** Default permission scope for remembered decisions */
  defaultScope?: PermissionScope;
}

// ============================================================================
// Hook Settings
// ============================================================================

/**
 * Hook event types (12 official events)
 */
export type HookEvent =
  | 'PreToolUse'           // Before tool execution
  | 'PostToolUse'          // After successful tool execution
  | 'PostToolUseFailure'   // After failed tool execution
  | 'Notification'         // Notification events
  | 'UserPromptSubmit'     // User submits a prompt
  | 'SessionStart'         // Session starts
  | 'SessionEnd'           // Session ends
  | 'Stop'                 // Stop/interrupt event
  | 'SubagentStart'        // Subagent starts
  | 'SubagentStop'         // Subagent stops
  | 'PreCompact'           // Before context compression
  | 'PermissionRequest'    // Permission requested
  | 'Setup';               // v2.1.10: Repository setup/maintenance (triggered by --init flags)

/**
 * Hook type
 */
export type HookType = 'command' | 'url';

/**
 * Command hook configuration
 */
export interface CommandHookConfig {
  /** Hook type */
  type: 'command';

  /** Command to execute (supports env var substitution like $TOOL_NAME) */
  command: string;

  /** Command arguments */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Blocking mode - wait for completion (default: true) */
  blocking?: boolean;

  /** Matcher for filtering events (tool name or regex) */
  matcher?: string;

  /** Working directory for command execution */
  cwd?: string;
}

/**
 * URL hook configuration
 */
export interface UrlHookConfig {
  /** Hook type */
  type: 'url';

  /** Callback URL */
  url: string;

  /** HTTP method (default: POST) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /** Request headers */
  headers?: Record<string, string>;

  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;

  /** Blocking mode - wait for response (default: false) */
  blocking?: boolean;

  /** Matcher for filtering events */
  matcher?: string;

  /** Retry configuration */
  retry?: {
    attempts?: number;
    backoff?: number;
  };
}

/**
 * Hook configuration (union type)
 */
export type HookConfig = CommandHookConfig | UrlHookConfig;

/**
 * Hook settings - map of events to hook configs
 */
export interface HookSettings {
  /** Map of hook events to their configurations */
  [event: string]: HookConfig | HookConfig[] | boolean | number | undefined;

  /** Enable/disable all hooks */
  enabled?: boolean;

  /** Global timeout for all hooks */
  globalTimeout?: number;

  /** Maximum concurrent hook executions */
  maxConcurrent?: number;
}

// ============================================================================
// MCP (Model Context Protocol) Settings
// ============================================================================

/**
 * MCP server transport type
 */
export type MCPTransportType = 'stdio' | 'sse' | 'http';

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Transport type */
  type: MCPTransportType;

  /** Command to execute (for stdio transport) */
  command?: string;

  /** Command arguments */
  args?: string[];

  /** Environment variables */
  env?: Record<string, string>;

  /** Server URL (for http/sse transport) */
  url?: string;

  /** HTTP headers (for http/sse transport) */
  headers?: Record<string, string>;

  /** Timeout for server initialization (ms) */
  timeout?: number;

  /** Enable/disable this server */
  enabled?: boolean;

  /** Auto-restart on failure */
  autoRestart?: boolean;

  /** Maximum restart attempts */
  maxRestarts?: number;
}

/**
 * MCP settings
 */
export interface MCPSettings {
  /** Map of server name to configuration */
  servers?: Record<string, MCPServerConfig>;

  /** Enable/disable MCP system */
  enabled?: boolean;

  /** Auto-discover MCP servers */
  autoDiscover?: boolean;

  /** Search paths for auto-discovery */
  discoveryPaths?: string[];

  /** Global timeout for MCP operations (ms) */
  globalTimeout?: number;

  /** Maximum concurrent MCP requests */
  maxConcurrentRequests?: number;
}

// ============================================================================
// Plugin Settings
// ============================================================================

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  /** Plugin name */
  name: string;

  /** Plugin version */
  version: string;

  /** Plugin description */
  description?: string;

  /** Plugin author */
  author?: string;

  /** Plugin homepage */
  homepage?: string;

  /** Plugin license */
  license?: string;

  /** Main entry point */
  main?: string;

  /** Engine requirements */
  engines?: {
    node?: string;
    'claude-code'?: string;
  };

  /** Plugin dependencies */
  dependencies?: Record<string, string>;
}

/**
 * Plugin configuration
 */
export interface PluginConfig {
  /** Enable/disable this plugin */
  enabled?: boolean;

  /** Plugin-specific settings */
  settings?: Record<string, unknown>;

  /** Plugin priority (lower = higher priority) */
  priority?: number;

  /** Auto-load on startup */
  autoLoad?: boolean;
}

/**
 * Plugin settings
 */
export interface PluginSettings {
  /** Map of plugin name to configuration */
  plugins?: Record<string, PluginConfig>;

  /** Enable/disable plugin system */
  enabled?: boolean;

  /** Plugin search paths */
  searchPaths?: string[];

  /** Auto-load plugins from search paths */
  autoLoad?: boolean;

  /** Sandbox plugins (restrict capabilities) */
  sandboxed?: boolean;

  /** Maximum memory per plugin (bytes) */
  maxMemoryPerPlugin?: number;

  /** Plugin timeout (ms) */
  timeout?: number;
}

// ============================================================================
// UI Settings
// ============================================================================

/**
 * Theme type
 */
export type ThemeType = 'dark' | 'light' | 'auto';

/**
 * Color scheme
 */
export interface ColorScheme {
  /** Primary color */
  primary?: string;

  /** Secondary color */
  secondary?: string;

  /** Success color */
  success?: string;

  /** Warning color */
  warning?: string;

  /** Error color */
  error?: string;

  /** Info color */
  info?: string;

  /** Background color */
  background?: string;

  /** Foreground/text color */
  foreground?: string;

  /** Border color */
  border?: string;
}

/**
 * UI component visibility settings
 */
export interface UIComponentSettings {
  /** Show header */
  showHeader?: boolean;

  /** Show status bar */
  showStatusBar?: boolean;

  /** Show todo list */
  showTodoList?: boolean;

  /** Show spinner */
  showSpinner?: boolean;

  /** Show diff view for file edits */
  showDiffView?: boolean;

  /** Show progress bar */
  showProgressBar?: boolean;
}

/**
 * UI formatting settings
 */
export interface UIFormattingSettings {
  /** Enable syntax highlighting */
  syntaxHighlighting?: boolean;

  /** Enable markdown rendering */
  markdownRendering?: boolean;

  /** Code block theme */
  codeBlockTheme?: string;

  /** Line wrapping */
  lineWrapping?: boolean;

  /** Maximum line length before wrapping */
  maxLineLength?: number;

  /** Show line numbers in code blocks */
  showLineNumbers?: boolean;
}

/**
 * UI settings
 */
export interface UISettings {
  /** Theme preference */
  theme?: ThemeType;

  /** Custom color scheme */
  colors?: ColorScheme;

  /** Component visibility */
  components?: UIComponentSettings;

  /** Formatting preferences */
  formatting?: UIFormattingSettings;

  /** Verbose output */
  verbose?: boolean;

  /** Compact mode (minimal UI) */
  compact?: boolean;

  /** Animation settings */
  animations?: {
    enabled?: boolean;
    speed?: 'slow' | 'normal' | 'fast';
  };

  /** Terminal width override */
  terminalWidth?: number;

  /** Enable unicode symbols */
  useUnicode?: boolean;

  /**
   * v2.1.23: Custom spinner verbs configuration
   * Allows customizing the verbs shown during loading
   */
  spinnerVerbs?: {
    /** Mode: 'append' adds to default list, 'replace' uses only custom verbs */
    mode: 'append' | 'replace';
    /** Custom verbs list */
    verbs: string[];
  };
}

// ============================================================================
// Telemetry Settings
// ============================================================================

/**
 * Telemetry level
 */
export type TelemetryLevel = 'off' | 'error' | 'minimal' | 'full';

/**
 * Telemetry settings
 */
export interface TelemetrySettings {
  /** Enable telemetry */
  enabled?: boolean;

  /** Telemetry level */
  level?: TelemetryLevel;

  /** Anonymize user data */
  anonymize?: boolean;

  /** Include performance metrics */
  includePerformance?: boolean;

  /** Include error reports */
  includeErrors?: boolean;

  /** Include usage statistics */
  includeUsage?: boolean;

  /** Custom telemetry endpoint */
  endpoint?: string;

  /** Telemetry batch size */
  batchSize?: number;

  /** Telemetry flush interval (ms) */
  flushInterval?: number;
}

// ============================================================================
// Context Management Settings
// ============================================================================

/**
 * Context compression strategy
 */
export type CompressionStrategy =
  | 'summarize'        // Summarize old messages
  | 'truncate'         // Remove oldest messages
  | 'selective'        // Selectively remove less important content
  | 'hybrid';          // Combination of strategies

/**
 * Context settings
 */
export interface ContextSettings {
  /** Maximum context size (tokens) */
  maxTokens?: number;

  /** Context compression threshold (percentage) */
  compressionThreshold?: number;

  /** Compression strategy */
  compressionStrategy?: CompressionStrategy;

  /** Preserve important messages during compression */
  preserveImportant?: boolean;

  /** Include system information in context */
  includeSystemInfo?: boolean;

  /** Include file tree in context */
  includeFileTree?: boolean;

  /** Maximum file tree depth */
  fileTreeDepth?: number;

  /** Auto-summarization */
  autoSummarize?: boolean;

  /** Summarization model */
  summarizationModel?: ModelName;
}

// ============================================================================
// Sandbox Settings
// ============================================================================

/**
 * Sandbox type
 */
export type SandboxType = 'none' | 'bubblewrap' | 'docker' | 'vm';

/**
 * Sandbox settings
 */
export interface SandboxSettings {
  /** Sandbox type */
  type?: SandboxType;

  /** Enable sandboxing */
  enabled?: boolean;

  /** Allowed directories (bind mounts) */
  allowedPaths?: string[];

  /** Network access in sandbox */
  allowNetwork?: boolean;

  /** Sandbox timeout (ms) */
  timeout?: number;

  /** Resource limits */
  limits?: {
    /** Maximum CPU usage (cores) */
    cpu?: number;

    /** Maximum memory (bytes) */
    memory?: number;

    /** Maximum disk usage (bytes) */
    disk?: number;

    /** Maximum processes */
    processes?: number;
  };

  /** Docker-specific settings */
  docker?: {
    /** Docker image */
    image?: string;

    /** Container name prefix */
    containerPrefix?: string;

    /** Remove container after execution */
    autoRemove?: boolean;
  };
}

// ============================================================================
// Session Settings
// ============================================================================

/**
 * Session settings
 */
export interface SessionSettings {
  /** Auto-save session */
  autoSave?: boolean;

  /** Save interval (ms) */
  saveInterval?: number;

  /** Session expiration time (ms) */
  expirationTime?: number;

  /** Maximum session count */
  maxSessions?: number;

  /** Session directory */
  sessionDir?: string;

  /** Compress old sessions */
  compressOld?: boolean;

  /** Include environment in session */
  includeEnvironment?: boolean;

  /** Encryption for sensitive data */
  encryption?: {
    enabled?: boolean;
    algorithm?: string;
  };
}

// ============================================================================
// Checkpoint Settings
// ============================================================================

/**
 * Checkpoint settings
 */
export interface CheckpointSettings {
  /** Enable file checkpointing */
  enabled?: boolean;

  /** Checkpoint directory */
  checkpointDir?: string;

  /** Maximum checkpoints per file */
  maxCheckpointsPerFile?: number;

  /** Checkpoint retention period (ms) */
  retentionPeriod?: number;

  /** Auto-cleanup old checkpoints */
  autoCleanup?: boolean;

  /** Compression for checkpoints */
  compression?: boolean;
}

// ============================================================================
// Tool Settings
// ============================================================================

/**
 * Tool-specific settings
 */
export interface ToolSettings {
  /** List of allowed tools (whitelist) */
  allowedTools?: string[];

  /** List of disallowed tools (blacklist) */
  disallowedTools?: string[];

  /** Maximum concurrent tool executions */
  maxConcurrentTasks?: number;

  /** Default tool timeout (ms) */
  defaultTimeout?: number;

  /** Tool-specific configurations */
  toolConfig?: {
    /** Bash tool settings */
    bash?: {
      /** Default shell */
      shell?: string;

      /** Shell arguments */
      shellArgs?: string[];

      /** Default timeout */
      timeout?: number;

      /** Enable background execution */
      allowBackground?: boolean;
    };

    /** Grep tool settings */
    grep?: {
      /** Default context lines */
      contextLines?: number;

      /** Case sensitive by default */
      caseSensitive?: boolean;

      /** Max results */
      maxResults?: number;
    };

    /** WebFetch tool settings */
    webFetch?: {
      /** User agent */
      userAgent?: string;

      /** Follow redirects */
      followRedirects?: boolean;

      /** Maximum redirects */
      maxRedirects?: number;

      /** Timeout */
      timeout?: number;
    };

    /** WebSearch tool settings */
    webSearch?: {
      /** Default search engine */
      engine?: string;

      /** Results per page */
      resultsPerPage?: number;

      /** Safe search */
      safeSearch?: boolean;
    };
  };
}

// ============================================================================
// Notification Settings
// ============================================================================

/**
 * Notification settings
 */
export interface NotificationSettings {
  /** Enable notifications */
  enabled?: boolean;

  /** Notification types to enable */
  types?: {
    /** Session events */
    session?: boolean;

    /** Tool execution */
    tools?: boolean;

    /** Errors */
    errors?: boolean;

    /** Warnings */
    warnings?: boolean;

    /** Completion */
    completion?: boolean;
  };

  /** Desktop notifications */
  desktop?: boolean;

  /** Sound notifications */
  sound?: boolean;

  /** Webhook for notifications */
  webhook?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
}

// ============================================================================
// Update Settings
// ============================================================================

/**
 * Update settings
 */
export interface UpdateSettings {
  /** Enable auto-update checks */
  autoCheck?: boolean;

  /** Check interval (ms) */
  checkInterval?: number;

  /** Auto-install updates */
  autoInstall?: boolean;

  /** Update channel */
  channel?: 'stable' | 'beta' | 'canary';

  /** Notify about updates */
  notify?: boolean;

  /** Custom update server */
  updateServer?: string;
}

// ============================================================================
// Attribution Settings
// ============================================================================

/**
 * Attribution settings for git commits and PRs
 */
export interface AttributionSettings {
  /**
   * Attribution text for git commits, including any trailers.
   * Empty string hides attribution.
   * Default includes Co-Authored-By trailer with model name.
   */
  commit?: string;

  /**
   * Attribution text for pull request descriptions.
   * Empty string hides attribution.
   * Default includes link to Axon.
   */
  pr?: string;
}

// ============================================================================
// Plan Settings (v2.1.9)
// ============================================================================

/**
 * Plan mode settings
 * @since 2.1.9
 */
export interface PlanSettings {
  /**
   * Custom directory for plan files, relative to project root.
   * If not set, defaults to ~/.axon/plans/
   * @since 2.1.9
   */
  plansDirectory?: string;
}

// ============================================================================
// Advanced Settings
// ============================================================================

/**
 * Advanced/experimental settings
 */
export interface AdvancedSettings {
  /** Default working directory */
  defaultWorkingDir?: string;

  /** Debug logs directory */
  debugLogsDir?: string;

  /** Enable experimental features */
  experimentalFeatures?: boolean;

  /** Feature flags */
  features?: Record<string, boolean>;

  /** Custom API endpoint */
  customEndpoint?: string;

  /** Proxy configuration */
  proxy?: {
    http?: string;
    https?: string;
    no?: string[];
  };

  /** Certificate settings */
  certificates?: {
    ca?: string[];
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
  };

  /** Rate limiting */
  rateLimit?: {
    enabled?: boolean;
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
}

// ============================================================================
// Main Configuration Types
// ============================================================================

/**
 * Complete Axon configuration
 *
 * This is the main configuration object that combines all settings.
 * It can be loaded from settings.json files and environment variables.
 */
export interface ClaudeConfig {
  /** Configuration version */
  version?: string;

  // Core API settings
  /** API key */
  apiKey?: string;

  /** OAuth token */
  oauthToken?: string;

  /** Model selection */
  model?: ModelName;

  /** Max tokens to generate */
  maxTokens?: number;

  /** Temperature (0-1) */
  temperature?: number;

  /** Top-p sampling */
  topP?: number;

  /** Top-k sampling */
  topK?: number;

  // Backend selection
  /** Use AWS Bedrock */
  useBedrock?: boolean;

  /** Use Google Vertex AI */
  useVertex?: boolean;

  // Feature toggles
  /** Enable telemetry */
  enableTelemetry?: boolean;

  /** Disable file checkpointing */
  disableFileCheckpointing?: boolean;

  /** Enable auto-save */
  enableAutoSave?: boolean;

  // Performance settings
  /** Maximum retry attempts */
  maxRetries?: number;

  /** Request timeout (ms) */
  requestTimeout?: number;

  /** Maximum concurrent tasks */
  maxConcurrentTasks?: number;

  // UI preferences
  /** UI theme */
  theme?: ThemeType;

  /** Verbose output */
  verbose?: boolean;

  // Tool filtering
  /** Allowed tools */
  allowedTools?: string[];

  /** Disallowed tools */
  disallowedTools?: string[];

  // System settings
  /** Custom system prompt */
  systemPrompt?: string;

  /** Default working directory */
  defaultWorkingDir?: string;

  /** Debug logs directory */
  debugLogsDir?: string;

  // ===== Nested Configuration Objects =====

  /** API configuration */
  api?: APIConfig;

  /** Model configuration */
  modelConfig?: ModelConfig;

  /** Permission settings */
  permissions?: PermissionSettings;

  /** Hook settings */
  hooks?: HookSettings;

  /** MCP server settings */
  mcpServers?: Record<string, MCPServerConfig>;

  /** MCP global settings */
  mcp?: MCPSettings;

  /** Plugin settings */
  plugins?: PluginSettings;

  /** UI settings */
  ui?: UISettings;

  /** Telemetry settings */
  telemetry?: TelemetrySettings;

  /** Context management settings */
  context?: ContextSettings;

  /** Sandbox settings */
  sandbox?: SandboxSettings;

  /** Session settings */
  session?: SessionSettings;

  /** Checkpoint settings */
  checkpoint?: CheckpointSettings;

  /** Tool settings */
  tools?: ToolSettings;

  /** Notification settings */
  notifications?: NotificationSettings;

  /** Update settings */
  updates?: UpdateSettings;

  /** Advanced settings */
  advanced?: AdvancedSettings;

  /**
   * Attribution settings for git commits and pull requests
   * @since 2.1.4
   */
  attribution?: AttributionSettings;

  /**
   * Deprecated: Use attribution instead.
   * Whether to include Claude's co-authored by attribution in commits and PRs.
   * Defaults to true.
   * @deprecated Use attribution.commit and attribution.pr instead
   */
  includeCoAuthoredBy?: boolean;

  /**
   * Main agent selection
   * Can be set via --agent CLI flag or in settings.json
   * When a non-built-in agent is selected, its system prompt and model override defaults
   * @since 2.1.32
   */
  agent?: string;

  /**
   * Plan mode settings
   * @since 2.1.9
   */
  plan?: PlanSettings;

  /**
   * Custom directory for plan files, relative to project root.
   * If not set, defaults to ~/.axon/plans/
   * Shorthand for plan.plansDirectory
   * @since 2.1.9
   */
  plansDirectory?: string;
}

/**
 * User configuration (alias for ClaudeConfig)
 *
 * This is the configuration format stored in ~/.axon/settings.json
 */
export type UserConfig = ClaudeConfig;

/**
 * Settings (alias for ClaudeConfig)
 *
 * Alternative name for the configuration object
 */
export type Settings = ClaudeConfig;

// ============================================================================
// Backward Compatibility Exports
// ============================================================================

/**
 * Legacy Config interface (for backward compatibility)
 */
export interface Config {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Legacy McpServerConfig (exported from index.ts)
 */
export interface McpServerConfig {
  type: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Session state
 */
export interface SessionState {
  sessionId: string;
  cwd: string;
  originalCwd?: string; // T153: 原始工作目录
  startTime: number;
  totalCostUSD: number;
  totalAPIDuration: number;
  totalAPIDurationWithoutRetries?: number; // T143: 不含重试的 API 时间
  totalToolDuration?: number; // T143: 工具执行总时间
  totalLinesAdded?: number; // 代码修改统计：添加的行数
  totalLinesRemoved?: number; // 代码修改统计：删除的行数
  modelUsage: Record<string, ModelUsageStats>; // T151: 扩展为详细统计
  alwaysAllowedTools?: string[]; // 会话级权限：总是允许的工具列表
  lastCompactedUuid?: string; // 最后一次压缩的边界标记 UUID（用于增量压缩）
  todos: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    activeForm: string;
  }>;
}

/**
 * T151/T152: 详细的模型使用统计
 */
export interface ModelUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  thinkingTokens?: number; // 思考 token 数（Extended Thinking）
  webSearchRequests?: number;
  requests?: number; // API 请求次数
  costUSD: number;
  contextWindow: number;
}

/**
 * Output format
 */
export type OutputFormat = 'text' | 'json' | 'stream-json';

/**
 * Input format
 */
export type InputFormat = 'text' | 'stream-json';

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * Environment variable configuration
 *
 * Maps environment variables to configuration options
 */
export interface EnvironmentConfig {
  /** ANTHROPIC_API_KEY or AXON_API_KEY */
  ANTHROPIC_API_KEY?: string;
  AXON_API_KEY?: string;

  /** AXON_OAUTH_TOKEN */
  AXON_OAUTH_TOKEN?: string;

  /** AXON_USE_BEDROCK */
  AXON_USE_BEDROCK?: string;

  /** AXON_USE_VERTEX */
  AXON_USE_VERTEX?: string;

  /** AXON_MAX_OUTPUT_TOKENS */
  AXON_MAX_OUTPUT_TOKENS?: string;

  /** AXON_MAX_RETRIES */
  AXON_MAX_RETRIES?: string;

  /** AXON_DEBUG_LOGS_DIR */
  AXON_DEBUG_LOGS_DIR?: string;

  /** AXON_ENABLE_TELEMETRY */
  AXON_ENABLE_TELEMETRY?: string;

  /** AXON_DISABLE_FILE_CHECKPOINTING */
  AXON_DISABLE_FILE_CHECKPOINTING?: string;

  /** AXON_CONFIG_DIR */
  AXON_CONFIG_DIR?: string;

  /** HTTP_PROXY */
  HTTP_PROXY?: string;

  /** HTTPS_PROXY */
  HTTPS_PROXY?: string;

  /** NO_PROXY */
  NO_PROXY?: string;
}

// ============================================================================
// Runtime Configuration
// ============================================================================

/**
 * Runtime configuration (CLI arguments + environment + config files)
 *
 * This represents the final merged configuration at runtime
 */
export interface RuntimeConfig extends ClaudeConfig {
  /** Current working directory */
  cwd: string;

  /** Session ID (if resuming) */
  sessionId?: string;

  /** Initial prompt */
  initialPrompt?: string;

  /** Print mode (non-interactive) */
  printMode?: boolean;

  /** Resume last session */
  resume?: boolean;

  /** Accept all edits without prompting */
  acceptEdits?: boolean;

  /** Bypass all permissions */
  bypassPermissions?: boolean;

  /** Plan mode (no execution) */
  planMode?: boolean;

  /** Input format */
  inputFormat?: 'text' | 'stream-json';

  /** Output format */
  outputFormat?: 'text' | 'json' | 'stream-json';

  /** Compute start time */
  startTime?: number;
}

// ============================================================================
// Configuration Validation
// ============================================================================

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  /** Validation successful */
  valid: boolean;

  /** Validation errors */
  errors?: Array<{
    path: string;
    message: string;
    value?: unknown;
  }>;

  /** Validation warnings */
  warnings?: Array<{
    path: string;
    message: string;
    value?: unknown;
  }>;
}

// ============================================================================
// Configuration Migration
// ============================================================================

/**
 * Configuration migration
 */
export interface ConfigMigration {
  /** Source version */
  fromVersion: string;

  /** Target version */
  toVersion: string;

  /** Migration function */
  migrate: (config: Partial<ClaudeConfig>) => Partial<ClaudeConfig>;

  /** Migration description */
  description?: string;
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<ClaudeConfig> = {
  version: '2.1.9',
  model: 'sonnet',
  maxTokens: 32000,
  temperature: 1,
  maxRetries: 3,
  requestTimeout: 300000,
  theme: 'auto',
  verbose: false,
  enableTelemetry: false,
  disableFileCheckpointing: false,
  enableAutoSave: true,
  maxConcurrentTasks: 10,
  useBedrock: false,
  useVertex: false,
};

/**
 * Environment variable names (完整的 130+ 个变量)
 *
 * 来源：从官方 @anthropic-ai/claude-code v2.1.4 提取
 * 提取日期：2026-01-07
 */
export const ENV_VAR_NAMES = {
  // ===== ANTHROPIC_* 变量 (16个) =====

  /** API 认证 */
  API_KEY: ['ANTHROPIC_API_KEY', 'AXON_API_KEY'],
  AUTH_TOKEN: 'ANTHROPIC_AUTH_TOKEN',

  /** API 配置 */
  BASE_URL: 'ANTHROPIC_BASE_URL',
  MODEL: 'ANTHROPIC_MODEL',
  BETAS: 'ANTHROPIC_BETAS',
  CUSTOM_HEADERS: 'ANTHROPIC_CUSTOM_HEADERS',

  /** 默认模型 */
  DEFAULT_HAIKU_MODEL: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  DEFAULT_OPUS_MODEL: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  DEFAULT_SONNET_MODEL: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  SMALL_FAST_MODEL: 'ANTHROPIC_SMALL_FAST_MODEL',
  SMALL_FAST_MODEL_AWS_REGION: 'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',

  /** Bedrock 配置 */
  BEDROCK_BASE_URL: 'ANTHROPIC_BEDROCK_BASE_URL',

  /** Foundry 配置 */
  FOUNDRY_API_KEY: 'ANTHROPIC_FOUNDRY_API_KEY',
  FOUNDRY_BASE_URL: 'ANTHROPIC_FOUNDRY_BASE_URL',
  FOUNDRY_RESOURCE: 'ANTHROPIC_FOUNDRY_RESOURCE',

  /** Vertex AI 配置 */
  VERTEX_PROJECT_ID: 'ANTHROPIC_VERTEX_PROJECT_ID',

  // ===== AXON_* 变量 (75个) =====

  /** OAuth 认证 */
  OAUTH_TOKEN: 'AXON_OAUTH_TOKEN',
  OAUTH_TOKEN_FILE_DESCRIPTOR: 'AXON_OAUTH_TOKEN_FILE_DESCRIPTOR',

  /** API Key 辅助 */
  API_KEY_FILE_DESCRIPTOR: 'AXON_API_KEY_FILE_DESCRIPTOR',
  API_KEY_HELPER_TTL_MS: 'AXON_API_KEY_HELPER_TTL_MS',

  /** 后端选择 */
  USE_BEDROCK: 'AXON_USE_BEDROCK',
  USE_VERTEX: 'AXON_USE_VERTEX',
  USE_FOUNDRY: 'AXON_USE_FOUNDRY',

  /** 后端认证跳过 */
  SKIP_BEDROCK_AUTH: 'AXON_SKIP_BEDROCK_AUTH',
  SKIP_FOUNDRY_AUTH: 'AXON_SKIP_FOUNDRY_AUTH',
  SKIP_VERTEX_AUTH: 'AXON_SKIP_VERTEX_AUTH',

  /** 性能配置 */
  MAX_OUTPUT_TOKENS: 'AXON_MAX_OUTPUT_TOKENS',
  MAX_RETRIES: 'AXON_MAX_RETRIES',
  MAX_TOOL_USE_CONCURRENCY: 'AXON_MAX_TOOL_USE_CONCURRENCY',

  /** Git 集成 */
  GIT_BASH_PATH: 'AXON_GIT_BASH_PATH',

  /** 会话管理 */
  SESSION_ID: 'AXON_SESSION_ID',
  PARENT_SESSION_ID: 'AXON_PARENT_SESSION_ID',
  SESSION_ACCESS_TOKEN: 'AXON_SESSION_ACCESS_TOKEN',
  SKIP_PROMPT_HISTORY: 'AXON_SKIP_PROMPT_HISTORY',

  /** Agent 系统 */
  AGENT_ID: 'AXON_AGENT_ID',
  AGENT_NAME: 'AXON_AGENT_NAME',
  AGENT_TYPE: 'AXON_AGENT_TYPE',
  SUBAGENT_MODEL: 'AXON_SUBAGENT_MODEL',
  PLAN_V2_AGENT_COUNT: 'AXON_PLAN_V2_AGENT_COUNT',
  PLAN_V2_EXPLORE_AGENT_COUNT: 'AXON_PLAN_V2_EXPLORE_AGENT_COUNT',

  /** 远程会话 */
  REMOTE: 'AXON_REMOTE',
  REMOTE_ENVIRONMENT_TYPE: 'AXON_REMOTE_ENVIRONMENT_TYPE',
  REMOTE_SESSION_ID: 'AXON_REMOTE_SESSION_ID',

  /** IDE 集成 */
  AUTO_CONNECT_IDE: 'AXON_AUTO_CONNECT_IDE',
  IDE_HOST_OVERRIDE: 'AXON_IDE_HOST_OVERRIDE',
  IDE_SKIP_AUTO_INSTALL: 'AXON_IDE_SKIP_AUTO_INSTALL',
  IDE_SKIP_VALID_CHECK: 'AXON_IDE_SKIP_VALID_CHECK',

  /** 调试和日志 */
  DEBUG_LOGS_DIR: 'AXON_DEBUG_LOGS_DIR',
  DIAGNOSTICS_FILE: 'AXON_DIAGNOSTICS_FILE',
  PROFILE_QUERY: 'AXON_PROFILE_QUERY',
  PROFILE_STARTUP: 'AXON_PROFILE_STARTUP',

  /** 遥测配置 */
  ENABLE_TELEMETRY: 'AXON_ENABLE_TELEMETRY',
  OTEL_SHUTDOWN_TIMEOUT_MS: 'AXON_OTEL_SHUTDOWN_TIMEOUT_MS',
  OTEL_FLUSH_TIMEOUT_MS: 'AXON_OTEL_FLUSH_TIMEOUT_MS',
  OTEL_HEADERS_HELPER_DEBOUNCE_MS: 'AXON_OTEL_HEADERS_HELPER_DEBOUNCE_MS',

  /** 功能禁用 */
  DISABLE_FILE_CHECKPOINTING: 'AXON_DISABLE_FILE_CHECKPOINTING',
  DISABLE_NONESSENTIAL_TRAFFIC: 'AXON_DISABLE_NONESSENTIAL_TRAFFIC',
  DISABLE_ATTACHMENTS: 'AXON_DISABLE_ATTACHMENTS',
  DISABLE_AXON_MDS: 'AXON_DISABLE_AXON_MDS',
  DISABLE_FEEDBACK_SURVEY: 'AXON_DISABLE_FEEDBACK_SURVEY',
  DISABLE_TERMINAL_TITLE: 'AXON_DISABLE_TERMINAL_TITLE',
  DISABLE_EXPERIMENTAL_BETAS: 'AXON_DISABLE_EXPERIMENTAL_BETAS',
  DISABLE_COMMAND_INJECTION_CHECK: 'AXON_DISABLE_COMMAND_INJECTION_CHECK',

  /** 功能启用 */
  ENABLE_CFC: 'AXON_ENABLE_CFC',
  ENABLE_PROMPT_SUGGESTION: 'AXON_ENABLE_PROMPT_SUGGESTION',
  ENABLE_SDK_FILE_CHECKPOINTING: 'AXON_ENABLE_SDK_FILE_CHECKPOINTING',
  ENABLE_TOKEN_USAGE_ATTACHMENT: 'AXON_ENABLE_TOKEN_USAGE_ATTACHMENT',

  /** UI/UX 配置 */
  FORCE_FULL_LOGO: 'AXON_FORCE_FULL_LOGO',
  SYNTAX_HIGHLIGHT: 'AXON_SYNTAX_HIGHLIGHT',

  /** 沙箱配置 */
  BASH_SANDBOX_SHOW_INDICATOR: 'AXON_BASH_SANDBOX_SHOW_INDICATOR',
  BUBBLEWRAP: 'AXON_BUBBLEWRAP',
  CONTAINER_ID: 'AXON_CONTAINER_ID',
  SHELL: 'AXON_SHELL',
  SHELL_PREFIX: 'AXON_SHELL_PREFIX',

  /** 网络配置 */
  PROXY_RESOLVES_HOSTS: 'AXON_PROXY_RESOLVES_HOSTS',
  SSE_PORT: 'AXON_SSE_PORT',
  WEBSOCKET_AUTH_FILE_DESCRIPTOR: 'AXON_WEBSOCKET_AUTH_FILE_DESCRIPTOR',

  /** 安全配置 */
  CLIENT_CERT: 'AXON_CLIENT_CERT',
  CLIENT_KEY: 'AXON_CLIENT_KEY',
  CLIENT_KEY_PASSPHRASE: 'AXON_CLIENT_KEY_PASSPHRASE',
  ADDITIONAL_PROTECTION: 'AXON_ADDITIONAL_PROTECTION',

  /** 环境隔离 */
  DONT_INHERIT_ENV: 'AXON_DONT_INHERIT_ENV',

  /** 其他配置 */
  ACTION: 'AXON_ACTION',
  EFFORT_LEVEL: 'AXON_EFFORT_LEVEL',
  ENTRYPOINT: 'AXON_ENTRYPOINT',
  EXIT_AFTER_STOP_DELAY: 'AXON_EXIT_AFTER_STOP_DELAY',
  EXTRA_BODY: 'AXON_EXTRA_BODY',
  TAGS: 'AXON_TAGS',
  TEAM_NAME: 'AXON_TEAM_NAME',
  /** v2.1.32: Agent Teams 实验性功能开关 */
  EXPERIMENTAL_AGENT_TEAMS: 'AXON_EXPERIMENTAL_AGENT_TEAMS',
  /** v2.1.32: Plan 模式要求 */
  PLAN_MODE_REQUIRED: 'AXON_PLAN_MODE_REQUIRED',
  TEST_FIXTURES_ROOT: 'AXON_TEST_FIXTURES_ROOT',
  USE_NATIVE_FILE_SEARCH: 'AXON_USE_NATIVE_FILE_SEARCH',

  /** 通用配置目录 */
  CONFIG_DIR: 'AXON_CONFIG_DIR',

  // ===== DISABLE_* 变量 (21个) =====

  /** Extended Thinking */
  DISABLE_INTERLEAVED_THINKING: 'DISABLE_INTERLEAVED_THINKING',

  /** Prompt Caching */
  DISABLE_PROMPT_CACHING: 'DISABLE_PROMPT_CACHING',
  DISABLE_PROMPT_CACHING_HAIKU: 'DISABLE_PROMPT_CACHING_HAIKU',
  DISABLE_PROMPT_CACHING_OPUS: 'DISABLE_PROMPT_CACHING_OPUS',
  DISABLE_PROMPT_CACHING_SONNET: 'DISABLE_PROMPT_CACHING_SONNET',

  /** 命令禁用 */
  DISABLE_BUG_COMMAND: 'DISABLE_BUG_COMMAND',
  DISABLE_DOCTOR_COMMAND: 'DISABLE_DOCTOR_COMMAND',
  DISABLE_EXTRA_USAGE_COMMAND: 'DISABLE_EXTRA_USAGE_COMMAND',
  DISABLE_FEEDBACK_COMMAND: 'DISABLE_FEEDBACK_COMMAND',
  DISABLE_INSTALL_GITHUB_APP_COMMAND: 'DISABLE_INSTALL_GITHUB_APP_COMMAND',
  DISABLE_LOGIN_COMMAND: 'DISABLE_LOGIN_COMMAND',
  DISABLE_LOGOUT_COMMAND: 'DISABLE_LOGOUT_COMMAND',
  DISABLE_UPGRADE_COMMAND: 'DISABLE_UPGRADE_COMMAND',

  /** 自动化和优化 */
  DISABLE_AUTOUPDATER: 'DISABLE_AUTOUPDATER',
  DISABLE_AUTO_MIGRATE_TO_NATIVE: 'DISABLE_AUTO_MIGRATE_TO_NATIVE',
  DISABLE_COMPACT: 'DISABLE_COMPACT',
  DISABLE_MICROCOMPACT: 'DISABLE_MICROCOMPACT',
  DISABLE_COST_WARNINGS: 'DISABLE_COST_WARNINGS',
  DISABLE_ERROR_REPORTING: 'DISABLE_ERROR_REPORTING',
  DISABLE_INSTALLATION_CHECKS: 'DISABLE_INSTALLATION_CHECKS',
  DISABLE_TELEMETRY: 'DISABLE_TELEMETRY',

  // ===== ENABLE_* 变量 (11个) =====

  /** Bash 匹配 */
  ENABLE_BASH_ENV_VAR_MATCHING: 'ENABLE_BASH_ENV_VAR_MATCHING',
  ENABLE_BASH_WRAPPER_MATCHING: 'ENABLE_BASH_WRAPPER_MATCHING',

  /** Beta 功能 */
  ENABLE_BETA_TRACING_DETAILED: 'ENABLE_BETA_TRACING_DETAILED',
  ENABLE_CODE_GUIDE_SUBAGENT: 'ENABLE_CODE_GUIDE_SUBAGENT',
  ENABLE_ENHANCED_TELEMETRY_BETA: 'ENABLE_ENHANCED_TELEMETRY_BETA',

  /** MCP CLI */
  ENABLE_EXPERIMENTAL_MCP_CLI: 'ENABLE_EXPERIMENTAL_MCP_CLI',
  ENABLE_MCP_CLI: 'ENABLE_MCP_CLI',
  ENABLE_MCP_CLI_ENDPOINT: 'ENABLE_MCP_CLI_ENDPOINT',
  ENABLE_MCP_LARGE_OUTPUT_FILES: 'ENABLE_MCP_LARGE_OUTPUT_FILES',

  /** UI */
  ENABLE_INCREMENTAL_TUI: 'ENABLE_INCREMENTAL_TUI',

  /** 工具搜索 */
  ENABLE_TOOL_SEARCH: 'ENABLE_TOOL_SEARCH',

  // ===== MAX_* 变量 (3个) =====

  /** Extended Thinking 预算 */
  MAX_THINKING_TOKENS: 'MAX_THINKING_TOKENS',

  /** Structured Output 重试 */
  MAX_STRUCTURED_OUTPUT_RETRIES: 'MAX_STRUCTURED_OUTPUT_RETRIES',

  /** MCP 输出 Token */
  MAX_MCP_OUTPUT_TOKENS: 'MAX_MCP_OUTPUT_TOKENS',

  // ===== MCP_* 变量 (4个) =====

  /** MCP 超时 */
  MCP_TIMEOUT: 'MCP_TIMEOUT',
  MCP_TOOL_TIMEOUT: 'MCP_TOOL_TIMEOUT',

  /** MCP OAuth */
  MCP_OAUTH_CALLBACK_PORT: 'MCP_OAUTH_CALLBACK_PORT',

  /** MCP 连接 */
  MCP_SERVER_CONNECTION_BATCH_SIZE: 'MCP_SERVER_CONNECTION_BATCH_SIZE',
} as const;

/**
 * Configuration file paths
 */
export const CONFIG_PATHS = {
  /** Global config directory */
  GLOBAL_DIR: '~/.axon',

  /** Global config file */
  GLOBAL_FILE: '~/.axon/settings.json',

  /** Project config directory */
  PROJECT_DIR: '.axon',

  /** Project config file */
  PROJECT_FILE: '.axon/settings.json',

  /** Session directory */
  SESSION_DIR: '~/.axon/sessions',

  /** Plugin directory */
  PLUGIN_DIR: '~/.axon/plugins',

  /** Hook directory */
  HOOK_DIR: '~/.axon/hooks',

  /** Skills directory */
  SKILLS_DIR: '~/.axon/skills',
} as const;

// ============ Session 配置接口 ============

/**
 * Session 配置接口
 *
 * 用于配置 Session 类的行为和初始状态
 */
export interface SessionConfig {
  /** 会话 ID (如果指定，使用此 ID 而不是生成新 ID) */
  id?: string;

  /** 父会话 ID (用于 fork) */
  parentId?: string;

  /** 会话访问令牌 */
  accessToken?: string;

  /** 跳过提示历史 */
  skipPromptHistory?: boolean;

  /** 停止后延迟退出 (ms) */
  exitAfterStopDelay?: number;

  /** SSE 端口 */
  ssePort?: number;

  /** 配置目录 (默认: ~/.axon) */
  configDir?: string;

  /** 工作目录 */
  cwd?: string;
}

/**
 * SessionManager 配置接口
 *
 * 用于配置 SessionManager 的持久化和清理行为
 */
export interface SessionManagerConfig {
  /** 自动保存开关 */
  autoSave?: boolean;

  /** 自动保存间隔 (ms) */
  autoSaveIntervalMs?: number;

  /** 会话目录 */
  sessionDir?: string;

  /** 最大会话数 */
  maxSessions?: number;

  /** 会话过期天数 */
  sessionExpiryDays?: number;
}
