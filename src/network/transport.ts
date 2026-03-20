/**
 * Agent 间 WebSocket 传输层
 *
 * 独立端口（默认 7860），不复用 Web UI 端口。
 * 支持：服务端监听 + 客户端连接 + 连接管理 + 握手 + 心跳
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { createServer, type Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AgentIdentity,
  AgentMessage,
  TransportMessage,
  HandshakeMessage,
  HandshakeAckMessage,
  HandshakeChallengeMessage,
  HandshakeChallengeResponseMessage,
  TrustLevel,
} from './types.js';
import { PROTOCOL_VERSION } from './types.js';
import type { IdentityManager } from './identity.js';
import type { PermissionManager } from './permission.js';
import { sign, verify } from './identity.js';
import { verifyMessage } from './protocol.js';

/** 心跳间隔 (30 秒) */
const PING_INTERVAL = 30_000;
/** 心跳超时 (3 次 ping 未响应) */
const PONG_TIMEOUT = PING_INTERVAL * 3;
/** 握手超时 */
const HANDSHAKE_TIMEOUT = 10_000;
/** WebSocket 最大消息大小 (1MB) */
const MAX_PAYLOAD = 1024 * 1024;
/** 消息时间戳容差 (5 分钟) — 超出视为重放攻击 */
const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
/** Nonce 去重缓存最大条目数 */
const NONCE_CACHE_MAX = 10_000;

/**
 * 与远程 Agent 的连接
 */
export class AgentConnection extends EventEmitter {
  agentId: string = '';
  identity: AgentIdentity | null = null;
  trustLevel: TrustLevel = 'unknown';
  /** 缓存的 PEM 公钥，避免每条消息重建 */
  cachedPem: string | null = null;
  private lastPong: number = Date.now();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    public readonly ws: WebSocket,
    public readonly direction: 'inbound' | 'outbound',
  ) {
    super();

    // 默认 error 处理：防止无监听器时 EventEmitter 抛未捕获异常崩溃进程
    // 调用方（connect/handleInbound）已在 ws 层面处理错误逻辑，
    // 这里只是兜底，避免连接拒绝等常见网络错误导致进程退出
    this.on('error', () => {});

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as TransportMessage;
        this.emit('message', msg);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this.stopPing();
      this.emit('close');
    });

    ws.on('error', (err) => {
      this.emit('error', err);
    });

    ws.on('pong', () => {
      this.lastPong = Date.now();
    });
  }

  send(msg: TransportMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.stopPing();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  startPing(): void {
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPong > PONG_TIMEOUT) {
        // 超时，关闭连接
        this.close();
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  get isAlive(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Agent 传输层 — 管理所有 WebSocket 连接
 */
export class AgentTransport extends EventEmitter {
  private server: Server | null = null;
  private wss: WebSocketServer | null = null;
  private connections: Map<string, AgentConnection> = new Map();
  private actualPort: number = 0;

  /** 连接并发锁 — 防止同时对同一 agentId 创建多个连接 */
  private connectingPromises: Map<string, Promise<AgentConnection>> = new Map();

  /** Nonce 去重缓存 — 防止消息重放攻击 */
  private seenNonces: Set<string> = new Set();
  private nonceInsertionOrder: string[] = [];

  constructor(
    private identityManager: IdentityManager,
    private permissionManager: PermissionManager,
  ) {
    super();
  }

  /**
   * 检查消息是否可能是重放攻击
   * 1. timestamp 必须在 ±5 分钟窗口内
   * 2. 消息 ID (nonce) 不能重复
   */
  checkReplayProtection(msg: AgentMessage): boolean {
    const now = Date.now();
    const diff = Math.abs(now - msg._meta.timestamp);
    if (diff > TIMESTAMP_TOLERANCE_MS) {
      return false; // timestamp 超出容差
    }

    if (msg.id) {
      if (this.seenNonces.has(msg.id)) {
        return false; // nonce 重复 — 重放攻击
      }
      this.seenNonces.add(msg.id);
      this.nonceInsertionOrder.push(msg.id);

      // 清理过期 nonce
      if (this.seenNonces.size > NONCE_CACHE_MAX) {
        const toRemove = this.nonceInsertionOrder.splice(0, NONCE_CACHE_MAX / 2);
        for (const n of toRemove) {
          this.seenNonces.delete(n);
        }
      }
    }

    return true;
  }

  get port(): number {
    return this.actualPort;
  }

  /**
   * 启动 WebSocket 服务端
   *
   * Windows 上 Node.js server.listen() 复用同一 server 对象重试时，
   * 之前失败的 listen 回调也会被触发（Node.js bug/行为）。
   * 因此每次重试都创建新的 server + WebSocketServer 实例。
   */
  async listen(preferredPort: number): Promise<number> {
    const maxAttempts = 10;

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const port = preferredPort + attempt;
      try {
        await this.tryListenOnPort(port);
        return port;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && attempt < maxAttempts) {
          // 端口被占用，清理后重试下一个端口
          this.cleanupServer();
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Could not find available port after ${maxAttempts} attempts starting from ${preferredPort}`);
  }

  /**
   * 尝试在指定端口启动服务
   */
  private tryListenOnPort(port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer();
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('error', (err: Error) => {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') return;
        console.error('[AgentTransport] WebSocketServer error:', err.message);
      });

      this.wss.on('connection', (ws: WebSocket) => {
        const conn = new AgentConnection(ws, 'inbound');
        this.handleInboundConnection(conn);
      });

      let settled = false;

      this.server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
        if (settled) return;
        settled = true;
        this.actualPort = port;

        this.server!.on('error', (err: Error) => {
          console.error(`[AgentTransport] Server error on port ${port}:`, err.message);
        });

        resolve();
      });

      this.server.once('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  /**
   * 清理当前 server/wss 实例（重试前调用）
   */
  private cleanupServer(): void {
    if (this.wss) {
      try { this.wss.close(); } catch { /* ignore */ }
      this.wss = null;
    }
    if (this.server) {
      try { this.server.close(); } catch { /* ignore */ }
      this.server = null;
    }
  }

  /**
   * 规范化 endpoint 地址（处理 IPv6）
   */
  private normalizeEndpoint(endpoint: string): string {
    let normalized = endpoint;
    if (!endpoint.startsWith('ws://') && !endpoint.startsWith('[')) {
      const lastColon = endpoint.lastIndexOf(':');
      const beforePort = endpoint.substring(0, lastColon);
      if (beforePort.includes(':')) {
        const port = endpoint.substring(lastColon + 1);
        normalized = `[${beforePort}]:${port}`;
      }
    }
    return normalized.startsWith('ws://') ? normalized : `ws://${normalized}`;
  }

  /**
   * 主动连接远程 Agent（带并发锁，防止重复连接）
   */
  async connect(endpoint: string): Promise<AgentConnection> {
    // 并发锁：如果正在连接同一 endpoint，复用 promise
    const existing = this.connectingPromises.get(endpoint);
    if (existing) return existing;

    const promise = this.doConnect(endpoint).finally(() => {
      this.connectingPromises.delete(endpoint);
    });
    this.connectingPromises.set(endpoint, promise);
    return promise;
  }

  /**
   * 实际执行连接（内部方法）
   *
   * 握手流程 (带 challenge-response):
   *   Client → Server: HandshakeMessage { identity }
   *   Server → Client: HandshakeChallengeMessage { identity, trustLevel, challenge }
   *   Client → Server: HandshakeChallengeResponseMessage { challengeResponse }
   *   Server → Client: HandshakeAckMessage { identity, trustLevel }  (final ack)
   *
   * 如果对端是旧版本（不支持 challenge），会回退到直接 HandshakeAck。
   */
  private doConnect(endpoint: string): Promise<AgentConnection> {
    return new Promise((resolve, reject) => {
      const url = this.normalizeEndpoint(endpoint);
      const ws = new WebSocket(url, { maxPayload: MAX_PAYLOAD });
      const conn = new AgentConnection(ws, 'outbound');

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection to ${endpoint} timed out`));
      }, HANDSHAKE_TIMEOUT);

      ws.on('open', () => {
        const handshake: HandshakeMessage = {
          type: 'handshake',
          identity: this.identityManager.identity,
        };
        conn.send(handshake);

        // 等待 challenge 或 ack（兼容旧版）
        conn.once('message', (msg: TransportMessage) => {
          if ('type' in msg && msg.type === 'handshake_challenge') {
            // 新协议：收到 challenge，签名并回复
            const challenge = msg as HandshakeChallengeMessage;

            // 先验证 server 端身份
            if (challenge.identity.protocolVersion !== PROTOCOL_VERSION) {
              clearTimeout(timeout);
              conn.close();
              reject(new Error(`Incompatible protocol version: ${challenge.identity.protocolVersion} vs ${PROTOCOL_VERSION}`));
              return;
            }
            if (!this.identityManager.verifyCertificate(challenge.identity)) {
              clearTimeout(timeout);
              conn.close();
              reject(new Error('Server certificate verification failed'));
              return;
            }

            // 签名 challenge
            const challengeResponse: HandshakeChallengeResponseMessage = {
              type: 'handshake_challenge_response',
              challengeResponse: sign(challenge.challenge, this.identityManager.agentPrivateKey),
            };
            conn.send(challengeResponse);

            // 等待最终 ack
            conn.once('message', (ackMsg: TransportMessage) => {
              clearTimeout(timeout);
              this.finalizeOutboundConnection(conn, ackMsg, resolve, reject);
            });
          } else if ('type' in msg && msg.type === 'handshake_ack') {
            // 旧版本 server：直接 ack（无 challenge）
            clearTimeout(timeout);
            this.finalizeOutboundConnection(conn, msg, resolve, reject);
          } else {
            clearTimeout(timeout);
            conn.close();
            reject(new Error('Invalid handshake response'));
          }
        });
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * 完成出站连接握手（验证 ack 并注册连接）
   */
  private finalizeOutboundConnection(
    conn: AgentConnection,
    msg: TransportMessage,
    resolve: (c: AgentConnection) => void,
    reject: (e: Error) => void,
  ): void {
    if (!('type' in msg) || msg.type !== 'handshake_ack') {
      conn.close();
      reject(new Error('Invalid handshake ack'));
      return;
    }

    const ack = msg as HandshakeAckMessage;
    if (ack.identity.protocolVersion !== PROTOCOL_VERSION) {
      conn.close();
      reject(new Error(`Incompatible protocol version: ${ack.identity.protocolVersion} vs ${PROTOCOL_VERSION}`));
      return;
    }
    if (!this.identityManager.verifyCertificate(ack.identity)) {
      conn.close();
      reject(new Error('Certificate verification failed'));
      return;
    }

    const pem = this.buildPem(ack.identity.publicKey);
    if (!pem) {
      conn.close();
      reject(new Error('Invalid public key — cannot build PEM'));
      return;
    }

    conn.agentId = ack.identity.agentId;
    conn.identity = ack.identity;
    conn.trustLevel = ack.trustLevel;
    conn.cachedPem = pem;
    conn.startPing();

    // 关闭旧连接（如有）
    const existingConn = this.connections.get(conn.agentId);
    if (existingConn) existingConn.close();

    this.connections.set(conn.agentId, conn);
    this.setupConnectionEvents(conn);
    this.emit('connection', conn);
    resolve(conn);
  }

  /**
   * 处理入站连接（带 challenge-response）
   *
   * 握手流程:
   *   Client → Server: HandshakeMessage
   *   Server → Client: HandshakeChallengeMessage (含 32 字节随机 challenge)
   *   Client → Server: HandshakeChallengeResponseMessage (用私钥签名 challenge)
   *   Server → Client: HandshakeAckMessage (验证通过后)
   */
  private handleInboundConnection(conn: AgentConnection): void {
    const timeout = setTimeout(() => {
      conn.close();
    }, HANDSHAKE_TIMEOUT);

    conn.once('message', (msg: TransportMessage) => {
      if (!('type' in msg) || msg.type !== 'handshake') {
        clearTimeout(timeout);
        conn.close();
        return;
      }

      const handshake = msg as HandshakeMessage;

      // 验证协议版本
      if (handshake.identity.protocolVersion !== PROTOCOL_VERSION) {
        clearTimeout(timeout);
        conn.close();
        return;
      }

      // 验证归属证书
      if (!this.identityManager.verifyCertificate(handshake.identity)) {
        clearTimeout(timeout);
        conn.close();
        return;
      }

      // 构建 PEM 并验证公钥可用
      const pem = this.buildPem(handshake.identity.publicKey);
      if (!pem) {
        clearTimeout(timeout);
        conn.close();
        return;
      }

      const trustLevel = this.permissionManager.determineTrustLevel(handshake.identity);

      // 发送 challenge
      const challenge = crypto.randomBytes(32).toString('base64');
      const challengeMsg: HandshakeChallengeMessage = {
        type: 'handshake_challenge',
        identity: this.identityManager.identity,
        trustLevel,
        challenge,
      };
      conn.send(challengeMsg);

      // 等待 challenge response
      conn.once('message', (respMsg: TransportMessage) => {
        clearTimeout(timeout);

        if (!('type' in respMsg) || respMsg.type !== 'handshake_challenge_response') {
          conn.close();
          return;
        }

        const resp = respMsg as HandshakeChallengeResponseMessage;

        // 验证 challenge 签名：用对方公钥验证
        if (!verify(challenge, resp.challengeResponse, pem)) {
          console.warn(`[AgentTransport] Challenge verification failed for ${handshake.identity.agentId.slice(0, 8)}`);
          conn.close();
          return;
        }

        // Challenge 通过，完成连接
        conn.agentId = handshake.identity.agentId;
        conn.identity = handshake.identity;
        conn.trustLevel = trustLevel;
        conn.cachedPem = pem;
        conn.startPing();

        // 发送最终 ack
        const ack: HandshakeAckMessage = {
          type: 'handshake_ack',
          identity: this.identityManager.identity,
          trustLevel,
        };
        conn.send(ack);

        // 关闭旧连接
        const existing = this.connections.get(conn.agentId);
        if (existing) existing.close();

        this.connections.set(conn.agentId, conn);
        this.setupConnectionEvents(conn);
        this.emit('connection', conn);
      });
    });
  }

  /**
   * 设置连接事件（含强制签名验证 + 重放保护）
   */
  private setupConnectionEvents(conn: AgentConnection): void {
    conn.on('message', (msg: TransportMessage) => {
      // 跳过握手消息
      if ('type' in msg && (
        msg.type === 'handshake' || msg.type === 'handshake_ack' ||
        msg.type === 'handshake_challenge' || msg.type === 'handshake_challenge_response'
      )) return;

      const agentMsg = msg as AgentMessage;

      // 强制签名验证 — cachedPem 不可能为 null（握手时已检查）
      if (!conn.cachedPem) {
        console.warn(`[AgentTransport] Dropping message from ${conn.agentId.slice(0, 8)}: no cached PEM`);
        conn.close();
        return;
      }

      if (agentMsg._meta?.signature) {
        if (!verifyMessage(agentMsg, conn.cachedPem)) {
          console.warn(`[AgentTransport] Invalid signature from ${conn.agentId.slice(0, 8)}, dropping message`);
          return;
        }
      } else {
        // 无签名的消息一律拒绝
        console.warn(`[AgentTransport] Unsigned message from ${conn.agentId.slice(0, 8)}, dropping`);
        return;
      }

      // 重放保护
      if (!this.checkReplayProtection(agentMsg)) {
        console.warn(`[AgentTransport] Replay attack detected from ${conn.agentId.slice(0, 8)}, dropping message`);
        return;
      }

      this.emit('message', agentMsg, conn);
    });

    conn.on('close', () => {
      this.connections.delete(conn.agentId);
      this.emit('disconnect', conn.agentId);
    });
  }

  /**
   * 获取连接
   */
  getConnection(agentId: string): AgentConnection | undefined {
    return this.connections.get(agentId);
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): AgentConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * 发送消息给指定 Agent
   */
  sendTo(agentId: string, msg: TransportMessage): boolean {
    const conn = this.connections.get(agentId);
    if (conn && conn.isAlive) {
      conn.send(msg);
      return true;
    }
    return false;
  }

  /**
   * 广播消息给所有已连接的 Agent
   */
  broadcast(msg: TransportMessage, excludeAgentId?: string): void {
    for (const [agentId, conn] of this.connections) {
      if (agentId !== excludeAgentId && conn.isAlive) {
        conn.send(msg);
      }
    }
  }

  /**
   * 从 base64 DER 公钥构建 PEM 字符串
   */
  private buildPem(publicKeyBase64: string): string | null {
    try {
      const key = crypto.createPublicKey({
        key: Buffer.from(publicKeyBase64, 'base64'),
        format: 'der',
        type: 'spki',
      });
      return key.export({ type: 'spki', format: 'pem' }) as string;
    } catch {
      return null;
    }
  }

  /**
   * 停止传输层
   */
  async stop(): Promise<void> {
    // 关闭所有连接
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();

    // 关闭 WebSocket 服务器
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // 关闭 HTTP 服务器
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
  }
}
