/**
 * Agent 间权限控制
 *
 * 信任分级：
 *   self        — 自己，全部允许
 *   same-owner  — 同主人，默认允许
 *   known       — 手动信任，需白名单
 *   unknown     — 未知，拒绝
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TrustLevel, AgentIdentity, AgentMethod } from './types.js';
import type { IdentityManager } from './identity.js';

const TRUST_FILE = path.join(os.homedir(), '.axon', 'network', 'trusted-agents.json');

/**
 * 信任记录
 */
interface TrustRecord {
  agentId: string;
  name: string;
  ownerFingerprint: string;
  trustedAt: number;
  /** 允许的方法白名单（空数组 = 允许所有） */
  allowedMethods: string[];
}

export class PermissionManager {
  private trustedAgents: Map<string, TrustRecord> = new Map();

  constructor(private identityManager: IdentityManager) {
    this.loadTrustedAgents();
  }

  /**
   * 确定远程 Agent 的信任等级
   */
  determineTrustLevel(remoteIdentity: AgentIdentity): TrustLevel {
    // 自己
    if (remoteIdentity.agentId === this.identityManager.agentId) {
      return 'self';
    }

    // 同主人
    if (this.identityManager.isSameOwner(remoteIdentity)) {
      return 'same-owner';
    }

    // 手动信任过
    if (this.trustedAgents.has(remoteIdentity.agentId)) {
      return 'known';
    }

    return 'unknown';
  }

  /**
   * 检查是否允许执行指定方法
   */
  checkPermission(agentId: string, trustLevel: TrustLevel, method: string): {
    allowed: boolean;
    reason?: string;
  } {
    switch (trustLevel) {
      case 'self':
        return { allowed: true };

      case 'same-owner':
        return { allowed: true };

      case 'known': {
        const record = this.trustedAgents.get(agentId);
        if (!record) {
          return { allowed: false, reason: 'Agent not in trust list' };
        }
        // 空白名单 = 允许所有
        if (record.allowedMethods.length === 0) {
          return { allowed: true };
        }
        if (record.allowedMethods.includes(method)) {
          return { allowed: true };
        }
        return { allowed: false, reason: `Method '${method}' not in allowed list` };
      }

      case 'unknown':
        return { allowed: false, reason: 'Unknown agent, requires manual trust approval' };

      default:
        return { allowed: false, reason: 'Invalid trust level' };
    }
  }

  /**
   * 手动信任一个 Agent
   */
  trustAgent(agentId: string, name: string, ownerFingerprint: string, allowedMethods: string[] = []): void {
    this.trustedAgents.set(agentId, {
      agentId,
      name,
      ownerFingerprint,
      trustedAt: Date.now(),
      allowedMethods,
    });
    this.saveTrustedAgents();
  }

  /**
   * 取消信任
   */
  untrustAgent(agentId: string): void {
    this.trustedAgents.delete(agentId);
    this.saveTrustedAgents();
  }

  /**
   * 获取所有信任记录
   */
  getTrustedAgents(): TrustRecord[] {
    return Array.from(this.trustedAgents.values());
  }

  /**
   * 加载信任列表
   */
  private loadTrustedAgents(): void {
    try {
      if (fs.existsSync(TRUST_FILE)) {
        const data = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          for (const record of data) {
            this.trustedAgents.set(record.agentId, record);
          }
        }
      }
    } catch {
      // ignore corrupt file
    }
  }

  /**
   * 保存信任列表
   */
  private saveTrustedAgents(): void {
    const dir = path.dirname(TRUST_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data = Array.from(this.trustedAgents.values());
    fs.writeFileSync(TRUST_FILE, JSON.stringify(data, null, 2));
  }
}
