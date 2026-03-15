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
  TrustLevel,
} from './types.js';
import { PROTOCOL_VERSION } from './types.js';
import type { IdentityManager } from './identity.js';
import type { PermissionManager } from './permission.js';

/** 心跳间隔 (30 秒) */
const PING_INTERVAL = 30_000;
/** 心跳超时 (3 次 ping 未响应) */
const PONG_TIMEOUT = PING_INTERVAL * 3;
/** 握手超时 */
const HANDSHAKE_TIMEOUT = 10_000;

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

  constructor(
    private identityManager: IdentityManager,
    private permissionManager: PermissionManager,
  ) {
    super();
  }

  get port(): number {
    return this.actualPort;
  }

  /**
   * 启动 WebSocket 服务端
   */
  async listen(preferredPort: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer();
      this.wss = new WebSocketServer({ server: this.server });

      this.wss.on('connection', (ws: WebSocket) => {
        const conn = new AgentConnection(ws, 'inbound');
        this.handleInboundConnection(conn);
      });

      // 尝试端口，如果被占用则递增
      const tryListen = (port: number, attempts: number = 0): void => {
        if (attempts > 10) {
          reject(new Error(`Could not find available port after 10 attempts starting from ${preferredPort}`));
          return;
        }

        // 绑定 0.0.0.0 以允许局域网内其他 Agent 连接
        // 安全性通过握手时的 Ed25519 签名验证 + 信任分级保障，TLS 待 Phase 3
        this.server!.listen(port, '0.0.0.0', () => {
          this.actualPort = port;

          // 端口绑定成功后，注册 permanent error handler 防止 error 事件未处理导致 crash
          this.server!.on('error', (err: Error) => {
            console.error(`[AgentTransport] Server error on port ${port}:`, err.message);
          });

          resolve(port);
        });

        this.server!.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            this.server!.removeAllListeners('error');
            tryListen(port + 1, attempts + 1);
          } else {
            reject(err);
          }
        });
      };

      tryListen(preferredPort);
    });
  }

  /**
   * 主动连接远程 Agent
   */
  async connect(endpoint: string): Promise<AgentConnection> {
    return new Promise((resolve, reject) => {
      // 处理 IPv6 地址：如果 endpoint 包含裸 IPv6（含冒号但无方括号），需要包裹
      let normalizedEndpoint = endpoint;
      if (!endpoint.startsWith('ws://') && !endpoint.startsWith('[')) {
        // 检测是否为 IPv6 地址（包含多个冒号）
        // IPv6 endpoint 格式如 "fe80::1:7860"，最后一个冒号后是端口
        const lastColon = endpoint.lastIndexOf(':');
        const beforePort = endpoint.substring(0, lastColon);
        if (beforePort.includes(':')) {
          // 是 IPv6 地址，需要方括号
          const port = endpoint.substring(lastColon + 1);
          normalizedEndpoint = `[${beforePort}]:${port}`;
        }
      }
      const url = normalizedEndpoint.startsWith('ws://') ? normalizedEndpoint : `ws://${normalizedEndpoint}`;
      const ws = new WebSocket(url);
      const conn = new AgentConnection(ws, 'outbound');

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection to ${endpoint} timed out`));
      }, HANDSHAKE_TIMEOUT);

      ws.on('open', () => {
        // 发送握手
        const handshake: HandshakeMessage = {
          type: 'handshake',
          identity: this.identityManager.identity,
        };
        conn.send(handshake);

        // 等待握手响应
        conn.once('message', (msg: TransportMessage) => {
          clearTimeout(timeout);

          if ('type' in msg && msg.type === 'handshake_ack') {
            const ack = msg as HandshakeAckMessage;

            // 验证协议版本
            if (ack.identity.protocolVersion !== PROTOCOL_VERSION) {
              conn.close();
              reject(new Error(`Incompatible protocol version: ${ack.identity.protocolVersion} vs ${PROTOCOL_VERSION}`));
              return;
            }

            // 验证归属证书
            if (!this.identityManager.verifyCertificate(ack.identity)) {
              conn.close();
              reject(new Error('Certificate verification failed'));
              return;
            }

            conn.agentId = ack.identity.agentId;
            conn.identity = ack.identity;
            conn.trustLevel = ack.trustLevel;
            conn.cachedPem = this.buildPem(ack.identity.publicKey);
            conn.startPing();

            this.connections.set(conn.agentId, conn);
            this.setupConnectionEvents(conn);
            this.emit('connection', conn);
            resolve(conn);
          } else {
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
   * 处理入站连接
   */
  private handleInboundConnection(conn: AgentConnection): void {
    const timeout = setTimeout(() => {
      conn.close();
    }, HANDSHAKE_TIMEOUT);

    conn.once('message', (msg: TransportMessage) => {
      clearTimeout(timeout);

      if (!('type' in msg) || msg.type !== 'handshake') {
        conn.close();
        return;
      }

      const handshake = msg as HandshakeMessage;

      // 验证协议版本
      if (handshake.identity.protocolVersion !== PROTOCOL_VERSION) {
        conn.close();
        return;
      }

      // 验证归属证书
      if (!this.identityManager.verifyCertificate(handshake.identity)) {
        conn.close();
        return;
      }

      // 确定信任等级
      const trustLevel = this.permissionManager.determineTrustLevel(handshake.identity);

      conn.agentId = handshake.identity.agentId;
      conn.identity = handshake.identity;
      conn.trustLevel = trustLevel;
      conn.cachedPem = this.buildPem(handshake.identity.publicKey);
      conn.startPing();

      // 发送握手确认
      const ack: HandshakeAckMessage = {
        type: 'handshake_ack',
        identity: this.identityManager.identity,
        trustLevel,
      };
      conn.send(ack);

      // 如果已有同 agentId 的连接，关闭旧的
      const existing = this.connections.get(conn.agentId);
      if (existing) {
        existing.close();
      }

      this.connections.set(conn.agentId, conn);
      this.setupConnectionEvents(conn);
      this.emit('connection', conn);
    });
  }

  /**
   * 设置连接事件
   */
  private setupConnectionEvents(conn: AgentConnection): void {
    conn.on('message', (msg: TransportMessage) => {
      // 跳过握手消息（已在连接建立时处理）
      if ('type' in msg && (msg.type === 'handshake' || msg.type === 'handshake_ack')) return;

      // 转发为 AgentMessage
      this.emit('message', msg as AgentMessage, conn);
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
