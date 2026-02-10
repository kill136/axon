/**
 * 微信 Bot 配置
 * 定义微信机器人的所有可配置项
 */

export interface WeChatBotConfig {
  /** 触发关键词，设置后只有以该关键词开头的消息才会触发，为空则使用 @提及 */
  triggerKeyword: string;

  /** 是否响应群聊中的 @提及 */
  respondToMention: boolean;

  /** 是否响应私聊消息 */
  respondToPrivate: boolean;

  // ---- Claude 配置 ----

  /** 模型选择: opus / sonnet / haiku */
  model: string;

  /** 最大输出 token 数 */
  maxTokens: number;

  /** 自定义系统提示词（追加到默认提示词后） */
  systemPrompt: string;

  // ---- 安全与限制 ----

  /** 允许使用的工具白名单 */
  allowedTools: string[];

  /** 微信单条消息最大字符数（超出会分段发送） */
  maxMessageLength: number;

  /** 每个会话最大对话轮数 */
  maxSessionTurns: number;

  /** 会话超时时间（毫秒），超时后自动清除历史 */
  sessionTimeout: number;

  /** 每用户每分钟最大请求数 */
  rateLimitPerMinute: number;

  /** 每日全局预算上限（美元） */
  dailyBudgetUSD: number;

  // ---- 工作环境 ----

  /** 工作目录（Claude 执行文件操作的根目录） */
  workingDir: string;

  // ---- Wechaty 配置 ----

  /** Wechaty Puppet 名称 */
  puppet: string;

  /** Puppet 特定选项 */
  puppetOptions: Record<string, unknown>;
}

/**
 * 默认配置
 * 安全优先：默认只开放只读工具
 */
export function getDefaultConfig(): WeChatBotConfig {
  return {
    triggerKeyword: '',
    respondToMention: true,
    respondToPrivate: true,

    model: 'sonnet',
    maxTokens: 16000,
    systemPrompt: '你是一个在微信群里的 AI 助手。请用简洁的中文回复，避免使用过多 Markdown 格式。回复尽量控制在 500 字以内。',

    // 安全：默认只允许只读工具
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'TodoWrite',
    ],

    maxMessageLength: 4000,
    maxSessionTurns: 20,
    sessionTimeout: 30 * 60 * 1000,  // 30 分钟
    rateLimitPerMinute: 5,
    dailyBudgetUSD: 10,

    workingDir: process.cwd(),

    puppet: process.env.WECHAT_PUPPET || 'wechaty-puppet-wechat4u',
    puppetOptions: {},
  };
}

/**
 * 从环境变量加载配置覆盖项
 */
export function loadConfigFromEnv(base: WeChatBotConfig): WeChatBotConfig {
  const config = { ...base };

  if (process.env.WECHAT_TRIGGER_KEYWORD) {
    config.triggerKeyword = process.env.WECHAT_TRIGGER_KEYWORD;
  }
  if (process.env.WECHAT_MODEL) {
    config.model = process.env.WECHAT_MODEL;
  }
  if (process.env.WECHAT_WORKING_DIR) {
    config.workingDir = process.env.WECHAT_WORKING_DIR;
  }
  if (process.env.WECHAT_MAX_TOKENS) {
    config.maxTokens = parseInt(process.env.WECHAT_MAX_TOKENS, 10);
  }
  if (process.env.WECHAT_RATE_LIMIT) {
    config.rateLimitPerMinute = parseInt(process.env.WECHAT_RATE_LIMIT, 10);
  }
  if (process.env.WECHAT_DAILY_BUDGET) {
    config.dailyBudgetUSD = parseFloat(process.env.WECHAT_DAILY_BUDGET);
  }
  if (process.env.WECHAT_SESSION_TIMEOUT) {
    config.sessionTimeout = parseInt(process.env.WECHAT_SESSION_TIMEOUT, 10) * 1000;
  }
  if (process.env.WECHAT_RESPOND_PRIVATE === 'false') {
    config.respondToPrivate = false;
  }
  if (process.env.WECHAT_PUPPET) {
    config.puppet = process.env.WECHAT_PUPPET;
  }
  if (process.env.WECHAT_SYSTEM_PROMPT) {
    config.systemPrompt = process.env.WECHAT_SYSTEM_PROMPT;
  }

  // 允许通过环境变量扩展工具白名单（逗号分隔）
  if (process.env.WECHAT_EXTRA_TOOLS) {
    const extraTools = process.env.WECHAT_EXTRA_TOOLS.split(',').map(t => t.trim());
    config.allowedTools = [...config.allowedTools, ...extraTools];
  }

  return config;
}
