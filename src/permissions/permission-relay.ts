/**
 * 权限中继系统 (Subtask 7.4)
 *
 * 功能：
 * - 支持 --channels 参数的权限中继
 * - 多个权限源的聚合决策
 * - 支持跨进程/跨会话的权限传播
 * - 权限令牌的链式验证
 *
 * 使用场景：
 * - 多个 Claude Code 进程共享权限上下文
 * - 远程会话权限同步
 * - 权限令牌的委托和传播
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import PermissionTokenManager, { type TokenPayload } from './token-manager.js';

/**
 * 权限中继目标
 */
export interface PermissionRelayTarget {
  channel: string;
  userId: string;
  sessionId?: string;
  scopes?: string[];
}

/**
 * 权限中继请求
 */
export interface PermissionRelayRequest {
  sourceUser: string;
  sourceSession: string;
  targetUser: string;
  targetSession?: string;
  scopes: string[];
  reason?: string;
}

/**
 * 权限中继响应
 */
export interface PermissionRelayResponse {
  success: boolean;
  token?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * 权限中继存储条目
 */
interface RelayStorageEntry {
  token: string;
  sourceUser: string;
  targetUser: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  used: boolean;
  usedAt?: number;
}

/**
 * 权限中继管理器
 */
export class PermissionRelay {
  private tokenManager: PermissionTokenManager;
  private storageDir: string;
  private relayCache: Map<string, RelayStorageEntry> = new Map();
  private channelRegistry: Map<string, PermissionRelayTarget> = new Map();

  constructor(secret?: string, storageDir?: string) {
    this.tokenManager = new PermissionTokenManager(secret);
    this.storageDir = storageDir || this.getDefaultStorageDir();
    this.ensureStorageDir();
  }

  /**
   * 获取默认存储目录
   */
  private getDefaultStorageDir(): string {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    return path.join(home, '.axon', 'permission-relay');
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * 注册权限中继通道
   */
  registerChannel(target: PermissionRelayTarget): void {
    this.channelRegistry.set(target.channel, target);
  }

  /**
   * 获取已注册的通道
   */
  getChannel(channel: string): PermissionRelayTarget | undefined {
    return this.channelRegistry.get(channel);
  }

  /**
   * 列出所有已注册的通道
   */
  listChannels(): string[] {
    return Array.from(this.channelRegistry.keys());
  }

  /**
   * 创建权限中继令牌
   * 允许源用户向目标用户传播特定的权限作用域
   */
  createRelayToken(request: PermissionRelayRequest): PermissionRelayResponse {
    try {
      // 验证源用户有权限中继
      // (在实际应用中，这里会检查策略)

      // 生成令牌
      const token = this.tokenManager.createToken(
        request.targetUser,
        request.scopes,
        undefined,
        request.targetSession
      );

      const now = Date.now();
      const ttl = this.tokenManager.getTTL();
      const expiresAt = now + ttl;

      // 存储中继记录
      const entry: RelayStorageEntry = {
        token,
        sourceUser: request.sourceUser,
        targetUser: request.targetUser,
        scopes: request.scopes,
        createdAt: now,
        expiresAt,
        used: false,
      };

      // 保存到缓存和存储
      this.relayCache.set(token, entry);
      this.persistRelayEntry(token, entry);

      return {
        success: true,
        token,
        expiresAt,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create relay token: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 验证并使用中继令牌
   */
  validateAndUseRelayToken(token: string): PermissionRelayResponse {
    try {
      // 先从缓存查找
      let entry = this.relayCache.get(token);

      // 如果缓存中没有，从存储加载
      if (!entry) {
        entry = this.loadRelayEntry(token);
      }

      if (!entry) {
        return {
          success: false,
          error: 'Relay token not found',
        };
      }

      // 检查是否已过期
      if (Date.now() > entry.expiresAt) {
        return {
          success: false,
          error: 'Relay token has expired',
        };
      }

      // 检查是否已被使用（一次性令牌）
      if (entry.used) {
        return {
          success: false,
          error: 'Relay token has already been used',
        };
      }

      // 标记为已使用
      entry.used = true;
      entry.usedAt = Date.now();
      this.relayCache.set(token, entry);
      this.persistRelayEntry(token, entry);

      // 验证令牌本身的有效性
      const validation = this.tokenManager.validateToken(token);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error || 'Token validation failed',
        };
      }

      return {
        success: true,
        token,
      };
    } catch (error) {
      return {
        success: false,
        error: `Token validation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 持久化中继条目到文件
   */
  private persistRelayEntry(tokenId: string, entry: RelayStorageEntry): void {
    try {
      const filePath = path.join(this.storageDir, `${tokenId.substring(0, 16)}.json`);
      fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
    } catch (error) {
      console.error('Failed to persist relay entry:', error);
    }
  }

  /**
   * 从文件加载中继条目
   */
  private loadRelayEntry(tokenId: string): RelayStorageEntry | null {
    try {
      const filePath = path.join(this.storageDir, `${tokenId.substring(0, 16)}.json`);
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data) as RelayStorageEntry;
      }
    } catch (error) {
      console.error('Failed to load relay entry:', error);
    }
    return null;
  }

  /**
   * 清理过期的中继令牌
   */
  cleanupExpiredTokens(): number {
    let count = 0;
    const now = Date.now();

    // 清理缓存中的过期令牌
    for (const [token, entry] of this.relayCache.entries()) {
      if (now > entry.expiresAt) {
        this.relayCache.delete(token);
        count++;
      }
    }

    // 清理文件系统中的过期令牌
    try {
      const files = fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.storageDir, file);
          try {
            const data = fs.readFileSync(filePath, 'utf-8');
            const entry = JSON.parse(data) as RelayStorageEntry;
            if (now > entry.expiresAt) {
              fs.unlinkSync(filePath);
              count++;
            }
          } catch (error) {
            // 如果无法解析，删除文件
            fs.unlinkSync(filePath);
            count++;
          }
        }
      }
    } catch (error) {
      console.error('Failed to cleanup expired tokens:', error);
    }

    return count;
  }

  /**
   * 撤销中继令牌
   */
  revokeRelayToken(token: string): boolean {
    try {
      let found = false;

      const filePath = path.join(this.storageDir, `${token.substring(0, 16)}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        found = true;
      }

      if (this.relayCache.has(token)) {
        this.relayCache.delete(token);
        found = true;
      }

      return found;
    } catch (error) {
      console.error('Failed to revoke relay token:', error);
      return false;
    }
  }

  /**
   * 获取令牌管理器
   */
  getTokenManager(): PermissionTokenManager {
    return this.tokenManager;
  }
}

export default PermissionRelay;
