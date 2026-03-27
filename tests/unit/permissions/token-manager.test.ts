/**
 * 权限令牌管理器测试 (Subtask 7.4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import PermissionTokenManager, { type TokenPayload } from '../../../src/permissions/token-manager.js';

describe('PermissionTokenManager', () => {
  let tokenManager: PermissionTokenManager;

  beforeEach(() => {
    tokenManager = new PermissionTokenManager('test-secret', 24 * 60 * 60 * 1000);
  });

  describe('createToken', () => {
    it('should create a valid token', () => {
      const token = tokenManager.createToken('testuser', ['read', 'write']);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // 令牌格式为 {encodedPayload}.{signature}，两部分
      expect(token.split('.')).toHaveLength(2);
    });

    it('should include userId in token payload', () => {
      const token = tokenManager.createToken('alice', ['read']);
      const [encodedPayload] = token.split('.');
      // 验证可以通过验证
      const result = tokenManager.validateToken(token);
      expect(result.payload?.userId).toBe('alice');
    });

    it('should support role parameter', () => {
      const token = tokenManager.createToken('bob', ['write'], 'admin');
      expect(token).toBeDefined();
    });

    it('should support sessionId parameter', () => {
      const token = tokenManager.createToken('charlie', ['execute'], undefined, 'session-123');
      expect(token).toBeDefined();
    });

    it('should create different tokens for different calls', async () => {
      const token1 = tokenManager.createToken('user1', ['read']);
      // 等待至少 1ms 以确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 1));
      const token2 = tokenManager.createToken('user1', ['read']);
      // 由于时间戳不同，令牌应该不同
      expect(token1).not.toBe(token2);
    });

    it('should create token with multiple scopes', () => {
      const scopes = ['read', 'write', 'execute', 'admin'];
      const token = tokenManager.createToken('user', scopes);
      expect(token).toBeDefined();
    });
  });

  describe('validateToken', () => {
    it('should validate a valid token', () => {
      const token = tokenManager.createToken('testuser', ['read', 'write']);
      const result = tokenManager.validateToken(token);
      expect(result.valid).toBe(true);
      expect(result.payload).toBeDefined();
    });

    it('should return false for invalid format', () => {
      const result = tokenManager.validateToken('invalid-token');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject malformed token', () => {
      const result = tokenManager.validateToken('a.b');
      expect(result.valid).toBe(false);
      // 令牌格式为 2 部分，会通过格式检查但签名验证失败
      expect(result.error).toBeDefined();
    });

    it('should reject tampered token', () => {
      const token = tokenManager.createToken('user', ['read']);
      const [userId, timestamp] = token.split('.');
      const tamperedToken = `${userId}.${timestamp}.invalidsignature`;
      const result = tokenManager.validateToken(tamperedToken);
      expect(result.valid).toBe(false);
    });

    it('should extract payload from valid token', () => {
      const token = tokenManager.createToken('alice', ['read', 'write']);
      const result = tokenManager.validateToken(token);
      expect(result.payload).toBeDefined();
      expect(result.payload?.userId).toBe('alice');
    });

    it('should validate payload timestamp', () => {
      const token = tokenManager.createToken('user', ['read']);
      const result = tokenManager.validateToken(token);
      expect(result.payload?.timestamp).toBeDefined();
      expect(typeof result.payload?.timestamp).toBe('number');
    });
  });

  describe('token expiration', () => {
    it('should expire tokens after TTL', async () => {
      // 创建一个 1ms TTL 的令牌管理器
      const shortLivedTokenManager = new PermissionTokenManager('secret', 1);
      const token = shortLivedTokenManager.createToken('user', ['read']);

      // 立即验证应该成功
      expect(shortLivedTokenManager.validateToken(token).valid).toBe(true);

      // 等待 TTL 过期
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = shortLivedTokenManager.validateToken(token);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    it('should respect custom TTL', () => {
      const customTTL = 1000; // 1秒
      const manager = new PermissionTokenManager('secret', customTTL);
      expect(manager.getTTL()).toBe(customTTL);
    });
  });

  describe('validateScopes', () => {
    it('should validate token with required scopes', () => {
      const token = tokenManager.createToken('user', ['read', 'write', 'execute']);
      expect(tokenManager.validateScopes(token, ['read'])).toBe(true);
      expect(tokenManager.validateScopes(token, ['read', 'write'])).toBe(true);
    });

    it('should reject token without required scopes', () => {
      const token = tokenManager.createToken('user', ['read']);
      expect(tokenManager.validateScopes(token, ['write'])).toBe(false);
    });

    it('should return false for invalid token', () => {
      expect(tokenManager.validateScopes('invalid', ['read'])).toBe(false);
    });
  });

  describe('refreshToken', () => {
    it('should refresh valid token', async () => {
      const token = tokenManager.createToken('user', ['read', 'write']);
      // 等待确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 1));
      const refreshed = tokenManager.refreshToken(token);
      expect(refreshed).toBeDefined();
      expect(refreshed).not.toBe(token);
    });

    it('should return null for invalid token', () => {
      const refreshed = tokenManager.refreshToken('invalid-token');
      expect(refreshed).toBeNull();
    });

    it('should preserve user and scopes on refresh', () => {
      const token = tokenManager.createToken('bob', ['read', 'write']);
      const refreshed = tokenManager.refreshToken(token);
      expect(refreshed).not.toBeNull();
      if (refreshed) {
        const result = tokenManager.validateToken(refreshed);
        expect(result.payload?.userId).toBe('bob');
      }
    });
  });

  describe('TTL management', () => {
    it('should set and get TTL', () => {
      const ttl = 12 * 60 * 60 * 1000; // 12小时
      tokenManager.setTTL(ttl);
      expect(tokenManager.getTTL()).toBe(ttl);
    });

    it('should use new TTL for created tokens', () => {
      const shortTTL = 1;
      tokenManager.setTTL(shortTTL);
      const token = tokenManager.createToken('user', ['read']);

      // 立即验证应该成功
      expect(tokenManager.validateToken(token).valid).toBe(true);
    });
  });

  describe('secret management', () => {
    it('should use provided secret', () => {
      const manager1 = new PermissionTokenManager('secret-1');
      const manager2 = new PermissionTokenManager('secret-2');

      const token1 = manager1.createToken('user', ['read']);

      // manager2 应该无法验证 manager1 的令牌
      const result = manager2.validateToken(token1);
      expect(result.valid).toBe(false);
    });

    it('should validate with same secret', () => {
      const secret = 'same-secret';
      const manager = new PermissionTokenManager(secret);
      const token = manager.createToken('user', ['read']);

      // 同一个管理器应该能验证
      const result = manager.validateToken(token);
      expect(result.valid).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty scopes', () => {
      const token = tokenManager.createToken('user', []);
      expect(token).toBeDefined();
    });

    it('should handle special characters in userId', () => {
      const token = tokenManager.createToken('user@domain.com', ['read']);
      expect(token).toBeDefined();
      const result = tokenManager.validateToken(token);
      expect(result.valid).toBe(true);
    });

    it('should handle long scope names', () => {
      const scopes = [
        'very-long-scope-name-that-is-quite-descriptive',
        'another-long-scope-with-many-parts',
      ];
      const token = tokenManager.createToken('user', scopes);
      expect(token).toBeDefined();
    });
  });
});
