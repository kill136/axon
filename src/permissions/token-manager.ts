/**
 * 权限令牌管理器 (Subtask 7.4)
 *
 * 功能：
 * - 生成时间戳签名的权限令牌
 * - 验证令牌有效性（签名、过期时间）
 * - 支持作用域和角色
 * - HMAC-SHA256 签名算法
 *
 * 令牌格式: {payload}.{signature} (类似 JWT 格式)
 * 其中 payload 是 base64url 编码的 TokenPayload
 * 有效期: 24小时（可配置）
 */

import * as crypto from 'crypto';

/**
 * Base64URL 编码
 */
function base64urlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Base64URL 解码
 */
function base64urlDecode(str: string): string {
  const padding = (4 - (str.length % 4)) % 4;
  const paddedStr = str + '='.repeat(padding);
  return Buffer.from(paddedStr.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

/**
 * 权限令牌载荷
 */
export interface TokenPayload {
  userId: string;
  timestamp: number;
  scopes: string[];
  role?: string;
  sessionId?: string;
}

/**
 * 令牌验证结果
 */
export interface TokenValidationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

/**
 * 权限令牌管理器
 */
export class PermissionTokenManager {
  private secret: string;
  private ttl: number = 24 * 60 * 60 * 1000; // 24小时，毫秒

  constructor(secret?: string, ttlMs: number = 24 * 60 * 60 * 1000) {
    // 如果没有提供 secret，使用环境变量或生成一个
    this.secret = secret || process.env.AXON_PERMISSION_SECRET || this.generateSecret();
    this.ttl = ttlMs;
  }

  /**
   * 生成随机的 secret
   */
  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * 创建权限令牌
   */
  createToken(
    userId: string,
    scopes: string[],
    role?: string,
    sessionId?: string
  ): string {
    const timestamp = Date.now();
    const payload: TokenPayload = {
      userId,
      timestamp,
      scopes,
      role,
      sessionId,
    };

    // 编码载荷为 base64url
    const payloadStr = JSON.stringify(payload);
    const encodedPayload = base64urlEncode(payloadStr);

    // 创建签名
    const signature = this.sign(encodedPayload);

    // 返回令牌格式: {encodedPayload}.{signature}
    return `${encodedPayload}.${signature}`;
  }

  /**
   * 对载荷进行签名（HMAC-SHA256）
   */
  private sign(data: string): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(data)
      .digest('hex');
  }

  /**
   * 验证令牌
   */
  validateToken(token: string): TokenValidationResult {
    try {
      // 解析令牌格式: {encodedPayload}.{signature}
      const parts = token.split('.');
      if (parts.length !== 2) {
        return {
          valid: false,
          error: 'Invalid token format',
        };
      }

      const [encodedPayload, signature] = parts;

      // 验证签名
      const expectedSignature = this.sign(encodedPayload);
      if (signature !== expectedSignature) {
        return {
          valid: false,
          error: 'Invalid token signature',
        };
      }

      // 解码载荷
      let payload: TokenPayload;
      try {
        const payloadStr = base64urlDecode(encodedPayload);
        payload = JSON.parse(payloadStr) as TokenPayload;
      } catch (error) {
        return {
          valid: false,
          error: `Failed to decode token payload: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // 检查过期时间
      const now = Date.now();
      if (now - payload.timestamp > this.ttl) {
        return {
          valid: false,
          error: 'Token has expired',
        };
      }

      return {
        valid: true,
        payload,
      };
    } catch (error) {
      return {
        valid: false,
        error: `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 验证令牌的作用域
   */
  validateScopes(token: string, requiredScopes: string[]): boolean {
    const result = this.validateToken(token);
    if (!result.valid || !result.payload) {
      return false;
    }

    // 检查令牌中的作用域是否包含所有必需的作用域
    return requiredScopes.every((scope) =>
      result.payload!.scopes.includes(scope)
    );
  }

  /**
   * 刷新令牌（发行新令牌）
   */
  refreshToken(oldToken: string): string | null {
    const result = this.validateToken(oldToken);
    if (!result.valid || !result.payload) {
      return null;
    }

    const { userId, scopes, role, sessionId } = result.payload;
    return this.createToken(userId, scopes, role, sessionId);
  }

  /**
   * 设置 TTL
   */
  setTTL(ttlMs: number): void {
    this.ttl = ttlMs;
  }

  /**
   * 获取当前 TTL
   */
  getTTL(): number {
    return this.ttl;
  }
}

export default PermissionTokenManager;
