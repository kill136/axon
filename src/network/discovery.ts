/**
 * 局域网 Agent 发现
 *
 * 基于 mDNS/DNS-SD (bonjour-service) 实现。
 * 服务类型：_axon-agent._tcp
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type { AgentIdentity, DiscoveredAgent, TrustLevel } from './types.js';
import { computeFingerprint } from './identity.js';

// 服务类型常量
const SERVICE_TYPE = 'axon-agent';
const SERVICE_PROTOCOL = 'tcp';

// bonjour-service 类型（避免硬依赖）
interface BonjourService {
  name: string;
  type: string;
  port: number;
  host: string;
  addresses?: string[];
  txt?: Record<string, string>;
}

interface BonjourBrowser extends EventEmitter {
  stop(): void;
}

interface BonjourInstance {
  publish(options: {
    name: string;
    type: string;
    protocol: string;
    port: number;
    txt?: Record<string, string>;
  }): { stop(): void };
  find(options: { type: string; protocol: string }): BonjourBrowser;
  destroy(): void;
}

export interface DiscoveryEvents {
  found: (agent: DiscoveredAgent) => void;
  lost: (agentId: string) => void;
  updated: (agent: DiscoveredAgent) => void;
}

export class AgentDiscovery extends EventEmitter {
  private bonjour: BonjourInstance | null = null;
  private service: { stop(): void } | null = null;
  private browser: BonjourBrowser | null = null;
  private agents: Map<string, DiscoveredAgent> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  /** Agent 离线超时（90 秒未见心跳） */
  private readonly OFFLINE_TIMEOUT = 90_000;
  /** 健康检查间隔（30 秒） */
  private readonly HEALTH_CHECK_INTERVAL = 30_000;

  /**
   * 获取所有发现的 Agent
   */
  getDiscoveredAgents(): DiscoveredAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * 获取指定 Agent
   */
  getAgent(agentId: string): DiscoveredAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * 启动发现服务
   */
  async start(identity: AgentIdentity, port: number, advertise: boolean): Promise<void> {
    try {
      const { Bonjour } = await import('bonjour-service');
      this.bonjour = new Bonjour() as unknown as BonjourInstance;
    } catch (err) {
      console.warn('[AgentDiscovery] Failed to load bonjour-service, discovery disabled:', err);
      return;
    }

    // 广播自己
    if (advertise) {
      this.service = this.bonjour.publish({
        name: `axon-${identity.agentId.slice(0, 8)}`,
        type: SERVICE_TYPE,
        protocol: SERVICE_PROTOCOL,
        port,
        txt: {
          agentId: identity.agentId,
          ownerFp: this.computeOwnerFp(identity),
          projects: identity.projects.map(p => p.name).join(','),
          version: identity.version,
          name: identity.name,
        },
      });
    }

    // 浏览局域网
    this.browser = this.bonjour.find({
      type: SERVICE_TYPE,
      protocol: SERVICE_PROTOCOL,
    });

    this.browser.on('up', (service: BonjourService) => {
      this.handleServiceFound(service, identity);
    });

    this.browser.on('down', (service: BonjourService) => {
      const agentId = service.txt?.agentId;
      if (agentId && this.agents.has(agentId)) {
        this.agents.delete(agentId);
        this.emit('lost', agentId);
      }
    });

    // 启动健康检查
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * 处理发现的服务
   */
  private handleServiceFound(service: BonjourService, selfIdentity: AgentIdentity): void {
    const txt = service.txt || {};
    const agentId = txt.agentId;
    if (!agentId || agentId === selfIdentity.agentId) return; // 跳过自己

    // 优先选择 IPv4 地址（IPv6 link-local 在 Windows 上跨机器不可靠）
    const ipv4 = service.addresses?.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a));
    const address = ipv4 || service.addresses?.[0] || service.host;
    // IPv6 地址需要方括号包裹，否则 ws://addr:port 格式无法解析
    const host = address.includes(':') ? `[${address}]` : address;
    const endpoint = `${host}:${service.port}`;
    const ownerFingerprint = txt.ownerFp || '';

    const existing = this.agents.get(agentId);
    const now = Date.now();

    if (existing) {
      // 更新最后心跳
      existing.lastSeenAt = now;
      existing.online = true;
      existing.endpoint = endpoint;
      this.emit('updated', existing);
    } else {
      // 新 Agent
      const agent: DiscoveredAgent = {
        agentId,
        name: txt.name || agentId.slice(0, 8),
        ownerFingerprint,
        projects: (txt.projects || '').split(',').filter(Boolean),
        endpoint,
        discoveredAt: now,
        lastSeenAt: now,
        trustLevel: 'unknown', // 握手后更新
        online: true,
      };

      this.agents.set(agentId, agent);
      this.emit('found', agent);
    }
  }

  /**
   * 健康检查：标记超时 Agent 为离线
   */
  private checkHealth(): void {
    const now = Date.now();
    for (const [agentId, agent] of this.agents) {
      if (agent.online && now - agent.lastSeenAt > this.OFFLINE_TIMEOUT) {
        agent.online = false;
        this.emit('updated', agent);
      }
    }
  }

  /**
   * 手动添加 Agent（用于防火墙环境下无法 mDNS 发现时）
   */
  addManual(endpoint: string, agentId: string, name: string): DiscoveredAgent {
    const agent: DiscoveredAgent = {
      agentId,
      name,
      ownerFingerprint: '',
      projects: [],
      endpoint,
      discoveredAt: Date.now(),
      lastSeenAt: Date.now(),
      trustLevel: 'unknown',
      online: true,
    };
    this.agents.set(agentId, agent);
    this.emit('found', agent);
    return agent;
  }

  /**
   * 更新 Agent 信息（握手后用完整身份更新）
   */
  updateAgent(agentId: string, updates: Partial<DiscoveredAgent>): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      Object.assign(agent, updates);
      this.emit('updated', agent);
    }
  }

  /**
   * 移除 Agent
   */
  removeAgent(agentId: string): void {
    if (this.agents.delete(agentId)) {
      this.emit('lost', agentId);
    }
  }

  /**
   * 从 AgentIdentity 计算 owner 指纹
   * owner.publicKey 是 base64(DER) 格式，需要先重建 PEM 再计算 fingerprint
   */
  private computeOwnerFp(identity: AgentIdentity): string {
    try {
      const ownerKeyObj = crypto.createPublicKey({
        key: Buffer.from(identity.owner.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });
      const ownerPem = ownerKeyObj.export({ type: 'spki', format: 'pem' }) as string;
      return computeFingerprint(ownerPem);
    } catch {
      return '';
    }
  }

  /**
   * 停止发现服务
   */
  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    if (this.service) {
      this.service.stop();
      this.service = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
    this.agents.clear();
  }
}
