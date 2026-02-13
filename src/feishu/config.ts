/**
 * 飞书 Bot 配置
 * 定义飞书机器人的所有可配置项
 */

export interface FeishuBotConfig {
  // ---- 飞书应用凭据 ----

  /** 飞书应用 App ID（必填） */
  appId: string;

  /** 飞书应用 App Secret（必填） */
  appSecret: string;

  /** 事件加密密钥（webhook 模式可选） */
  encryptKey: string;

  /** 验证令牌（webhook 模式可选） */
  verificationToken: string;

  // ---- 连接模式 ----

  /** 连接模式: websocket（无需公网 IP） 或 webhook */
  connectionMode: 'websocket' | 'webhook';

  /** Webhook 模式监听端口 */
  webhookPort: number;

  /** Webhook 模式路径 */
  webhookPath: string;

  // ---- 响应行为 ----

  /** 是否响应群聊中的 @提及 */
  respondToMention: boolean;

  /** 是否响应私聊消息 */
  respondToPrivate: boolean;

  // ---- Claude 配置 ----

  /** 模型选择: opus / sonnet / haiku */
  model: string;

  /** 最大输出 token 数 */
  maxTokens: number;

  /** 自定义系统提示词 */
  systemPrompt: string;

  // ---- 安全与限制 ----

  /** 允许使用的工具白名单 */
  allowedTools: string[];

  /** 单条消息最大字符数（超出会分段发送） */
  maxMessageLength: number;

  /** 每个会话最大对话轮数 */
  maxSessionTurns: number;

  /** 会话超时时间（毫秒） */
  sessionTimeout: number;

  /** 每用户每分钟最大请求数 */
  rateLimitPerMinute: number;

  /** 每日全局预算上限（美元） */
  dailyBudgetUSD: number;

  // ---- 工作环境 ----

  /** 工作目录 */
  workingDir: string;
}

/**
 * 默认配置
 * 安全优先：默认只开放只读工具
 */
export function getDefaultConfig(): FeishuBotConfig {
  return {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
    encryptKey: '',
    verificationToken: '',

    connectionMode: 'websocket',
    webhookPort: 3001,
    webhookPath: '/webhook/event',

    respondToMention: true,
    respondToPrivate: true,

    model: 'sonnet',
    maxTokens: 16000,
    systemPrompt: '你是一个在飞书群里的 AI 助手。请用简洁的中文回复，适当使用 Markdown 格式。回复尽量控制在 500 字以内。',

    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'TodoWrite',
      'ScheduleTask',
    ],

    maxMessageLength: 4000,
    maxSessionTurns: 20,
    sessionTimeout: 30 * 60 * 1000,
    rateLimitPerMinute: 5,
    dailyBudgetUSD: 10,

    workingDir: process.cwd(),
  };
}

/**
 * 从环境变量加载配置覆盖项
 */
export function loadConfigFromEnv(base: FeishuBotConfig): FeishuBotConfig {
  const config = { ...base };

  if (process.env.FEISHU_APP_ID) {
    config.appId = process.env.FEISHU_APP_ID;
  }
  if (process.env.FEISHU_APP_SECRET) {
    config.appSecret = process.env.FEISHU_APP_SECRET;
  }
  if (process.env.FEISHU_ENCRYPT_KEY) {
    config.encryptKey = process.env.FEISHU_ENCRYPT_KEY;
  }
  if (process.env.FEISHU_VERIFICATION_TOKEN) {
    config.verificationToken = process.env.FEISHU_VERIFICATION_TOKEN;
  }
  if (process.env.FEISHU_CONNECTION_MODE) {
    const mode = process.env.FEISHU_CONNECTION_MODE;
    if (mode === 'websocket' || mode === 'webhook') {
      config.connectionMode = mode;
    }
  }
  if (process.env.FEISHU_WEBHOOK_PORT) {
    config.webhookPort = parseInt(process.env.FEISHU_WEBHOOK_PORT, 10);
  }
  if (process.env.FEISHU_MODEL) {
    config.model = process.env.FEISHU_MODEL;
  }
  if (process.env.FEISHU_WORKING_DIR) {
    config.workingDir = process.env.FEISHU_WORKING_DIR;
  }
  if (process.env.FEISHU_MAX_TOKENS) {
    config.maxTokens = parseInt(process.env.FEISHU_MAX_TOKENS, 10);
  }
  if (process.env.FEISHU_RATE_LIMIT) {
    config.rateLimitPerMinute = parseInt(process.env.FEISHU_RATE_LIMIT, 10);
  }
  if (process.env.FEISHU_DAILY_BUDGET) {
    config.dailyBudgetUSD = parseFloat(process.env.FEISHU_DAILY_BUDGET);
  }
  if (process.env.FEISHU_SESSION_TIMEOUT) {
    config.sessionTimeout = parseInt(process.env.FEISHU_SESSION_TIMEOUT, 10) * 1000;
  }
  if (process.env.FEISHU_RESPOND_PRIVATE === 'false') {
    config.respondToPrivate = false;
  }
  if (process.env.FEISHU_SYSTEM_PROMPT) {
    config.systemPrompt = process.env.FEISHU_SYSTEM_PROMPT;
  }
  if (process.env.FEISHU_MAX_MESSAGE_LENGTH) {
    config.maxMessageLength = parseInt(process.env.FEISHU_MAX_MESSAGE_LENGTH, 10);
  }

  // 允许通过环境变量扩展工具白名单（逗号分隔）
  if (process.env.FEISHU_EXTRA_TOOLS) {
    const extraTools = process.env.FEISHU_EXTRA_TOOLS.split(',').map(t => t.trim());
    config.allowedTools = [...config.allowedTools, ...extraTools];
  }

  return config;
}
