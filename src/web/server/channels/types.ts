/**
 * IM 通道系统类型定义
 *
 * 让用户在已有 IM（Telegram/飞书/Slack）中直接给 AI 下任务。
 * 接口设计参考 OpenClaw ChannelPlugin，但大幅精简为只关心收发消息。
 */

// ============================================================================
// 通道适配器接口
// ============================================================================

/**
 * 通道适配器：每个 IM 平台实现一个
 *
 * 职责明确：收消息、发消息、管理连接状态。
 * 不涉及 AI 逻辑（AI 逻辑在 bridge.ts 中）。
 */
export interface ChannelAdapter {
  /** 通道唯一标识 */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;

  /**
   * 启动通道（连接 IM 平台、启动轮询/Webhook）
   * @param config 通道配置
   * @param onMessage 收到消息时的回调
   */
  start(config: ChannelConfig, onMessage: (msg: InboundMessage) => void): Promise<void>;

  /** 停止通道（断开连接、清理资源） */
  stop(): Promise<void>;

  /**
   * 发送文本消息到 IM
   * @returns 消息 ID（用于后续编辑），如果平台不支持返回 undefined
   */
  sendText(chatId: string, text: string, options?: SendOptions): Promise<string | void>;

  /**
   * 编辑已发送的文本消息（可选能力，用于流式输出）
   * @returns true 成功，false 失败（应降级为发新消息）
   */
  editText?(chatId: string, messageId: string, text: string, options?: SendOptions): Promise<boolean>;

  /** 发送图片到 IM（可选能力） */
  sendImage?(chatId: string, imageData: Buffer, mimeType: string, caption?: string): Promise<void>;

  /** 获取当前连接状态 */
  getStatus(): ChannelStatus;
}

// ============================================================================
// 配置类型
// ============================================================================

/**
 * 单个通道的配置
 */
export interface ChannelConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 凭据（各平台不同） */
  credentials: Record<string, string>;
  /** 白名单：允许哪些用户/群组与 AI 对话。'*' 表示全部放行 */
  allowList?: string[];
  /** DM 权限策略（默认 'allowlist'） */
  dmPolicy?: DmPolicy;
  /** 是否允许群组消息（默认 false，只允许私聊） */
  allowGroups?: boolean;
  /** 群组中触发 AI 的方式 */
  groupTrigger?: GroupTriggerMode;
  /** 使用的模型（覆盖默认） */
  model?: string;
  /** 固定会话 ID（同一通道所有消息复用同一会话） */
  fixedSessionId?: string;
}

/**
 * 群组触发模式
 * - 'mention': @机器人 时才响应（推荐）
 * - 'keyword': 包含关键词时响应
 * - 'always': 群内所有消息都响应（慎用）
 */
export type GroupTriggerMode = 'mention' | 'keyword' | 'always';

/**
 * 所有通道的配置集合
 */
export interface ChannelsConfig {
  [channelId: string]: ChannelConfig;
}

// ============================================================================
// 消息类型
// ============================================================================

/**
 * 入站消息（从 IM 到 AI）
 */
export interface InboundMessage {
  /** 来源通道 */
  channel: string;
  /** 发送者 ID（平台内部 ID） */
  senderId: string;
  /** 发送者显示名 */
  senderName: string;
  /** 聊天 ID（私聊=senderId，群=群ID） */
  chatId: string;
  /** 消息文本 */
  text: string;
  /** 是否群组消息 */
  isGroup: boolean;
  /** 是否 @了机器人（群组消息中） */
  isMentioned?: boolean;
  /** 原始消息 ID（用于回复） */
  messageId?: string;
  /** 图片附件（base64 编码） */
  images?: Array<{ data: string; mimeType: string }>;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 发送选项
 */
export interface SendOptions {
  /** 回复特定消息 */
  replyToMessageId?: string;
  /** Markdown 解析模式 */
  parseMode?: 'Markdown' | 'HTML' | 'plain';
}

// ============================================================================
// 状态类型
// ============================================================================

export type ChannelStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * 通道运行时状态（供 Web UI 和 API 展示）
 */
export interface ChannelStatusInfo {
  id: string;
  name: string;
  status: ChannelStatus;
  enabled: boolean;
  /** 是否已配置凭据 */
  configured: boolean;
  /** 配置引导文案 */
  configureHint?: string;
  /** 错误信息（status=error 时） */
  error?: string;
  /** 最后活跃时间 */
  lastActiveAt?: number;
  /** 已处理的消息计数 */
  messageCount?: number;
  /** 已保存的配置（凭据脱敏），供前端回显 */
  savedConfig?: {
    /** 脱敏后的凭据（只显示前几位） */
    credentials: Record<string, string>;
    allowList?: string[];
    dmPolicy?: DmPolicy;
    allowGroups?: boolean;
    groupTrigger?: GroupTriggerMode;
    fixedSessionId?: string;
  };
}

// ============================================================================
// Pairing 配对（参考 OpenClaw src/pairing/）
// ============================================================================

/**
 * DM 权限策略
 * - 'allowlist': 只允许白名单中的用户（传统模式）
 * - 'pairing': 未授权用户发消息时自动发放配对码，管理员审批后加入白名单
 * - 'open': 任何人都可以对话（相当于 allowList = ['*']）
 */
export type DmPolicy = 'allowlist' | 'pairing' | 'open';

/**
 * 配对请求（等待管理员审批）
 */
export interface PairingRequest {
  /** 发送者 ID */
  senderId: string;
  /** 发送者显示名 */
  senderName: string;
  /** 来源通道 */
  channel: string;
  /** 8 位配对码 */
  code: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后消息时间 */
  lastSeenAt: number;
}

// ============================================================================
// WebSocket 消息类型（前后端通信）
// ============================================================================

/**
 * 通道相关的 WebSocket 客户端消息
 */
export type ChannelClientMessage =
  | { type: 'channel:list' }
  | { type: 'channel:start'; payload: { channelId: string } }
  | { type: 'channel:stop'; payload: { channelId: string } }
  | { type: 'channel:config_update'; payload: { channelId: string; config: Partial<ChannelConfig> } }
  | { type: 'channel:test'; payload: { channelId: string } }
  | { type: 'channel:pairing_list' }
  | { type: 'channel:pairing_approve'; payload: { channel: string; code: string } }
  | { type: 'channel:pairing_deny'; payload: { channel: string; code: string } };

/**
 * 通道相关的 WebSocket 服务端消息
 */
export type ChannelServerMessage =
  | { type: 'channel:list'; payload: { channels: ChannelStatusInfo[] } }
  | { type: 'channel:status_update'; payload: ChannelStatusInfo }
  | { type: 'channel:message'; payload: { channel: string; direction: 'inbound' | 'outbound'; senderName: string; text: string; timestamp: number } }
  | { type: 'channel:error'; payload: { channelId: string; error: string } }
  | { type: 'channel:pairing_list'; payload: { requests: PairingRequest[] } }
  | { type: 'channel:pairing_new'; payload: PairingRequest }
  | { type: 'channel:new_session'; payload: { sessionId: string; channel: string; senderName: string } };
