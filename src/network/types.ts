/**
 * Agent Network 类型定义
 *
 * AI Agent 间去中心化通信系统的所有类型。
 */

// ============================================================================
// 身份
// ============================================================================

/**
 * Agent 身份卡片 — 完整信息，握手时交换
 */
export interface AgentIdentity {
  /** Ed25519 公钥的 SHA-256 哈希前 16 字节 (hex, 32 chars) */
  agentId: string;
  /** Ed25519 公钥 (base64) */
  publicKey: string;
  /** 人类可读名称（默认 hostname-port） */
  name: string;
  /** Owner 信息 */
  owner: {
    name: string;
    /** Owner Ed25519 公钥 (base64) */
    publicKey: string;
  };
  /** Owner 对 Agent 公钥的签名 (base64)，证明归属关系 */
  ownerCertificate: string;
  /** 负责的项目列表 */
  projects: ProjectInfo[];
  /** 能力标签 */
  capabilities: string[];
  /** 对外暴露的工具列表 */
  exposedTools: string[];
  /** 网络端点 "host:port" */
  endpoint: string;
  /** Axon 版本 */
  version: string;
  /** 协议版本 */
  protocolVersion: string;
  /** 启动时间 */
  startedAt: number;
}

/**
 * 项目信息
 */
export interface ProjectInfo {
  /** 项目名 */
  name: string;
  /** git remote URL（可选） */
  gitRemote?: string;
  /** 角色描述 */
  role?: string;
}

// ============================================================================
// 发现
// ============================================================================

/**
 * 发现的远程 Agent
 */
export interface DiscoveredAgent {
  agentId: string;
  name: string;
  /** Owner 公钥指纹（前 8 字节 hex, 16 chars） */
  ownerFingerprint: string;
  /** 项目名列表 */
  projects: string[];
  /** 网络端点 */
  endpoint: string;
  /** 首次发现时间 */
  discoveredAt: number;
  /** 最后心跳时间 */
  lastSeenAt: number;
  /** 信任等级 */
  trustLevel: TrustLevel;
  /** 在线状态 */
  online: boolean;
  /** 完整身份（握手后填充） */
  identity?: AgentIdentity;
}

/** 信任等级 */
export type TrustLevel = 'self' | 'same-owner' | 'known' | 'unknown';

// ============================================================================
// 通信协议
// ============================================================================

/** 协议版本 */
export const PROTOCOL_VERSION = '1.0';

/**
 * Agent 间消息 — 基于 JSON-RPC 2.0 扩展
 */
export interface AgentMessage {
  jsonrpc: '2.0';
  /** 请求 ID（通知消息无此字段） */
  id?: string;
  /** 方法名 */
  method?: string;
  /** 参数 */
  params?: unknown;
  /** 响应结果 */
  result?: unknown;
  /** 响应错误 */
  error?: { code: number; message: string; data?: unknown };
  /** 元数据 */
  _meta: MessageMeta;
}

export interface MessageMeta {
  /** 发送方 agentId */
  from: string;
  /** 接收方 agentId（广播时为 '*'） */
  to: string;
  /** Ed25519 签名 (base64) — 对 {id, method, params, timestamp} 签名 */
  signature: string;
  /** 时间戳 */
  timestamp: number;
  /** 关联任务 ID（长任务追踪） */
  taskId?: string;
}

/**
 * 握手消息
 */
export interface HandshakeMessage {
  type: 'handshake';
  identity: AgentIdentity;
}

export interface HandshakeAckMessage {
  type: 'handshake_ack';
  identity: AgentIdentity;
  trustLevel: TrustLevel;
}

export type TransportMessage = HandshakeMessage | HandshakeAckMessage | AgentMessage;

// ============================================================================
// 内置方法
// ============================================================================

export enum AgentMethod {
  Ping = 'agent.ping',
  GetIdentity = 'agent.getIdentity',
  ListTools = 'agent.listTools',
  CallTool = 'agent.callTool',
  DelegateTask = 'agent.delegateTask',
  Notify = 'agent.notify',
  Progress = 'agent.progress',
  Chat = 'agent.chat',
}

// ============================================================================
// 审计日志
// ============================================================================

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  direction: 'inbound' | 'outbound';
  fromAgentId: string;
  fromName: string;
  toAgentId: string;
  toName: string;
  messageType: 'query' | 'task' | 'notify' | 'response' | 'chat';
  method: string;
  /** 人类可读摘要 */
  summary: string;
  success: boolean;
  error?: string;
  /** 关联任务 ID */
  taskId?: string;
  /** 完整消息 JSON（调试用） */
  payload?: string;
}

// ============================================================================
// 离线消息队列
// ============================================================================

export interface PendingMessage {
  id: string;
  targetAgentId: string;
  message: AgentMessage;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
}

// ============================================================================
// 委派任务
// ============================================================================

/** 委派任务状态 */
export type DelegatedTaskStatus = 'accepted' | 'running' | 'completed' | 'failed';

/** 委派任务记录 */
export interface DelegatedTask {
  taskId: string;
  fromAgentId: string;
  fromName: string;
  description: string;
  fullContext: string;
  status: DelegatedTaskStatus;
  createdAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

// ============================================================================
// 配置
// ============================================================================

export interface NetworkConfig {
  /** 是否启用 Agent Network */
  enabled: boolean;
  /** Agent 间通信端口（默认 7860） */
  port: number;
  /** Agent 显示名（默认 hostname-port） */
  name?: string;
  /** 是否通过 mDNS 广播自己（默认 true） */
  advertise: boolean;
  /** 同 Owner 的 Agent 自动信任（默认 true） */
  autoAcceptSameOwner: boolean;
}

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  enabled: false,
  port: 7860,
  advertise: true,
  autoAcceptSameOwner: true,
};

// ============================================================================
// 群组
// ============================================================================

/** 群组 */
export interface AgentGroup {
  id: string;
  /** 群名 */
  name: string;
  /** 群头像颜色 seed */
  avatarSeed?: string;
  /** 成员 agentId 列表 */
  members: string[];
  /** 创建时间 */
  createdAt: number;
  /** 最后活跃时间 */
  lastActivity: number;
}

// ============================================================================
// WebSocket 消息类型（前后端通信）
// ============================================================================

export type NetworkServerMessage =
  | { type: 'network:status'; payload: NetworkStatus }
  | { type: 'network:agent_found'; payload: DiscoveredAgent }
  | { type: 'network:agent_lost'; payload: { agentId: string } }
  | { type: 'network:agent_updated'; payload: DiscoveredAgent }
  | { type: 'network:message'; payload: AuditLogEntry }
  | { type: 'network:trust_request'; payload: DiscoveredAgent };

export type NetworkClientMessage =
  | { type: 'network:get_status' }
  | { type: 'network:send'; payload: { agentId: string; method: string; params?: unknown } }
  | { type: 'network:trust'; payload: { agentId: string; trust: boolean } }
  | { type: 'network:kick'; payload: { agentId: string } };

export interface NetworkStatus {
  enabled: boolean;
  identity: AgentIdentity | null;
  agents: DiscoveredAgent[];
  groups: AgentGroup[];
  port: number;
  /** 本机 IP 地址列表 */
  addresses?: string[];
}
