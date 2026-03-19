/**
 * Transport 层测试
 *
 * 测试 WebSocket 传输、握手 challenge-response、签名验证、重放保护、连接并发锁
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { AgentTransport, AgentConnection } from '../../src/network/transport.js';
import { IdentityManager, computeAgentId } from '../../src/network/identity.js';
import { PermissionManager } from '../../src/network/permission.js';
import type { AgentMessage, TrustLevel } from '../../src/network/types.js';
import { PROTOCOL_VERSION } from '../../src/network/types.js';
import { createRequest } from '../../src/network/protocol.js';

/**
 * 生成测试用 Ed25519 密钥对
 */
function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function pemToBase64(pem: string): string {
  const key = crypto.createPublicKey(pem);
  const raw = key.export({ type: 'spki', format: 'der' });
  return (raw as Buffer).toString('base64');
}

describe('AgentTransport', () => {
  describe('replay protection', () => {
    let transport: AgentTransport;
    let mockIdentityManager: IdentityManager;
    let mockPermissionManager: PermissionManager;

    beforeEach(() => {
      // 创建 minimal mock
      mockIdentityManager = new IdentityManager();
      mockPermissionManager = new PermissionManager(mockIdentityManager);
      transport = new AgentTransport(mockIdentityManager, mockPermissionManager);
    });

    it('should accept message with valid timestamp', () => {
      const msg: AgentMessage = {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'agent.ping',
        _meta: {
          from: 'sender',
          to: 'receiver',
          signature: 'test',
          timestamp: Date.now(),
        },
      };

      expect(transport.checkReplayProtection(msg)).toBe(true);
    });

    it('should reject message with expired timestamp (> 5 minutes old)', () => {
      const msg: AgentMessage = {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'agent.ping',
        _meta: {
          from: 'sender',
          to: 'receiver',
          signature: 'test',
          timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        },
      };

      expect(transport.checkReplayProtection(msg)).toBe(false);
    });

    it('should reject message with future timestamp (> 5 minutes ahead)', () => {
      const msg: AgentMessage = {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'agent.ping',
        _meta: {
          from: 'sender',
          to: 'receiver',
          signature: 'test',
          timestamp: Date.now() + 6 * 60 * 1000, // 6 minutes in the future
        },
      };

      expect(transport.checkReplayProtection(msg)).toBe(false);
    });

    it('should reject replayed message (same nonce)', () => {
      const nonce = crypto.randomUUID();
      const createMsg = () => ({
        jsonrpc: '2.0' as const,
        id: nonce,
        method: 'agent.ping',
        _meta: {
          from: 'sender',
          to: 'receiver',
          signature: 'test',
          timestamp: Date.now(),
        },
      });

      expect(transport.checkReplayProtection(createMsg())).toBe(true);
      expect(transport.checkReplayProtection(createMsg())).toBe(false); // replay!
    });

    it('should accept different nonces', () => {
      for (let i = 0; i < 100; i++) {
        const msg: AgentMessage = {
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'agent.ping',
          _meta: {
            from: 'sender',
            to: 'receiver',
            signature: 'test',
            timestamp: Date.now(),
          },
        };
        expect(transport.checkReplayProtection(msg)).toBe(true);
      }
    });

    it('should evict old nonces when cache exceeds limit', () => {
      // 填充 nonce 缓存（超过 NONCE_CACHE_MAX = 10000）
      for (let i = 0; i < 10_001; i++) {
        const msg: AgentMessage = {
          jsonrpc: '2.0',
          id: `nonce-${i}`,
          method: 'agent.ping',
          _meta: {
            from: 'sender',
            to: 'receiver',
            signature: 'test',
            timestamp: Date.now(),
          },
        };
        transport.checkReplayProtection(msg);
      }

      // 早期的 nonce 应该已被清除，重放应该能通过（因为 nonce 已从缓存中移除）
      const oldMsg: AgentMessage = {
        jsonrpc: '2.0',
        id: 'nonce-0', // 最早的 nonce
        method: 'agent.ping',
        _meta: {
          from: 'sender',
          to: 'receiver',
          signature: 'test',
          timestamp: Date.now(),
        },
      };

      // 注意：这只是测试缓存清理机制在工作
      // 实际中 timestamp 检查是第一道防线
      expect(transport.checkReplayProtection(oldMsg)).toBe(true);
    });
  });

  describe('listen and connect (integration)', () => {
    let serverTransport: AgentTransport;
    let clientTransport: AgentTransport;
    let serverIdentity: IdentityManager;
    let clientIdentity: IdentityManager;
    let serverPermission: PermissionManager;
    let clientPermission: PermissionManager;
    let serverPort: number;

    beforeEach(async () => {
      // 动态获取可用端口
      const { createServer } = await import('http');
      serverPort = await new Promise<number>((resolve) => {
        const srv = createServer();
        srv.listen(0, () => {
          const addr = srv.address() as { port: number };
          srv.close(() => resolve(addr.port));
        });
      });

      serverIdentity = new IdentityManager();
      clientIdentity = new IdentityManager();

      await serverIdentity.initialize(
        { enabled: true, port: serverPort, advertise: false, autoAcceptSameOwner: true },
        process.cwd(),
        serverPort,
      );
      await clientIdentity.initialize(
        { enabled: true, port: serverPort + 100, advertise: false, autoAcceptSameOwner: true },
        process.cwd(),
        serverPort + 100,
      );

      serverPermission = new PermissionManager(serverIdentity);
      clientPermission = new PermissionManager(clientIdentity);

      serverTransport = new AgentTransport(serverIdentity, serverPermission);
      clientTransport = new AgentTransport(clientIdentity, clientPermission);
    });

    afterEach(async () => {
      await clientTransport.stop();
      await serverTransport.stop();
    });

    it('should complete handshake with challenge-response', async () => {
      await serverTransport.listen(serverPort);

      const connectionPromise = new Promise<void>((resolve) => {
        serverTransport.on('connection', () => resolve());
      });

      const conn = await clientTransport.connect(`127.0.0.1:${serverPort}`);

      // 等待 server 端也完成握手
      await connectionPromise;

      expect(conn.agentId).toBe(serverIdentity.agentId);
      expect(conn.identity).toBeDefined();
      expect(conn.cachedPem).not.toBeNull();
      expect(conn.trustLevel).toBeDefined();
    });

    it('should exchange signed messages after handshake', async () => {
      await serverTransport.listen(serverPort);

      // 先绑定事件再连接（防止事件在连接完成前触发丢失）
      const messagePromise = new Promise<{ msg: AgentMessage; conn: AgentConnection }>((resolve) => {
        serverTransport.on('message', (msg: AgentMessage, conn: AgentConnection) => {
          resolve({ msg, conn });
        });
      });
      const serverConnected = new Promise<void>((resolve) => {
        serverTransport.on('connection', () => resolve());
      });

      const conn = await clientTransport.connect(`127.0.0.1:${serverPort}`);
      await serverConnected;

      // 发送签名消息
      const testMsg = createRequest(
        'agent.ping',
        { data: 'hello' },
        clientIdentity.agentId,
        serverIdentity.agentId,
        clientIdentity.agentPrivateKey,
      );
      conn.send(testMsg);

      const { msg } = await messagePromise;
      expect(msg.method).toBe('agent.ping');
      expect((msg.params as any).data).toBe('hello');
    });

    it('should reject unsigned messages', async () => {
      await serverTransport.listen(serverPort);

      // 先绑定 connection 事件再连接
      const serverConnected = new Promise<void>((resolve) => {
        serverTransport.on('connection', () => resolve());
      });
      const conn = await clientTransport.connect(`127.0.0.1:${serverPort}`);
      await serverConnected;

      // 发送无签名消息
      const unsignedMsg = {
        jsonrpc: '2.0' as const,
        id: crypto.randomUUID(),
        method: 'agent.ping',
        _meta: {
          from: clientIdentity.agentId,
          to: serverIdentity.agentId,
          signature: '',  // 空签名
          timestamp: Date.now(),
        },
      };

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      conn.send(unsignedMsg);

      // 等一下确认消息被丢弃
      await new Promise((r) => setTimeout(r, 200));

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unsigned message'),
      );
      warnSpy.mockRestore();
    });

    it('should prevent duplicate concurrent connections to same endpoint', async () => {
      await serverTransport.listen(serverPort);

      // 并发连接同一 endpoint
      const [conn1, conn2] = await Promise.all([
        clientTransport.connect(`127.0.0.1:${serverPort}`),
        clientTransport.connect(`127.0.0.1:${serverPort}`),
      ]);

      // 应该返回相同的连接对象
      expect(conn1).toBe(conn2);
    });
  });

  describe('AgentConnection', () => {
    it('should track alive status', () => {
      // 创建一个 mock WebSocket
      const mockWs = new EventEmitter() as any;
      mockWs.readyState = 1; // OPEN
      mockWs.send = vi.fn();
      mockWs.close = vi.fn();
      mockWs.ping = vi.fn();

      const conn = new AgentConnection(mockWs, 'outbound');
      expect(conn.isAlive).toBe(true);

      // 模拟关闭
      mockWs.readyState = 3; // CLOSED
      expect(conn.isAlive).toBe(false);
    });
  });
});
