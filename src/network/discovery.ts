/**
 * 局域网 Agent 发现
 *
 * 双重发现机制：
 *   1. 文件注册（本地）— 每个实例写 ~/.axon/network/peers/{port}.json，定期扫描
 *      可靠、跨平台、同机器多实例零问题
 *   2. mDNS/DNS-SD（局域网）— 基于 bonjour-service，跨机器发现
 *      Windows 同机器多进程不可靠，仅作补充
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentIdentity, DiscoveredAgent, TrustLevel } from './types.js';
import { computeFingerprint } from './identity.js';

// 服务类型常量
const SERVICE_TYPE = 'axon-agent';
const SERVICE_PROTOCOL = 'tcp';

// 本地注册目录
const PEERS_DIR = path.join(os.homedir(), '.axon', 'network', 'peers');

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

/** 文件注册记录 */
interface PeerRegistration {
  agentId: string;
  name: string;
  port: number;
  ownerFp: string;
  projects: string[];
  version: string;
  pid: number;
  startedAt: number;
}

export class AgentDiscovery extends EventEmitter {
  private bonjour: BonjourInstance | null = null;
  private service: { stop(): void } | null = null;
  private browser: BonjourBrowser | null = null;
  private agents: Map<string, DiscoveredAgent> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private peerScanTimer: NodeJS.Timeout | null = null;
  private peerFile: string | null = null;
  private selfAgentId: string = '';
  private peersDir: string;
  /** process exit cleanup handler 引用（用于 stop 时移除） */
  private cleanupHandler: (() => void) | null = null;

  /** Agent 离线超时（90 秒未见心跳） */
  private readonly OFFLINE_TIMEOUT = 90_000;
  /** 健康检查间隔（30 秒） */
  private readonly HEALTH_CHECK_INTERVAL = 30_000;
  /** 本地 peer 扫描间隔（5 秒） */
  private readonly PEER_SCAN_INTERVAL = 5_000;

  constructor(options?: { peersDir?: string }) {
    super();
    this.peersDir = options?.peersDir ?? PEERS_DIR;
  }

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
    this.selfAgentId = identity.agentId;

    // ====== 1. 文件注册（主要发现机制，同机器可靠） ======
    if (advertise) {
      this.registerPeerFile(identity, port);
    }

    // 启动 peer 扫描
    this.scanPeers(identity);
    this.peerScanTimer = setInterval(() => {
      this.scanPeers(identity);
    }, this.PEER_SCAN_INTERVAL);

    // ====== 2. mDNS（补充发现机制，跨机器） ======
    try {
      const { Bonjour } = await import('bonjour-service');
      this.bonjour = new Bonjour() as unknown as BonjourInstance;
    } catch (err) {
      console.warn('[AgentDiscovery] bonjour-service not available, mDNS disabled (file-based local discovery still active)');
      // mDNS 不可用不影响本地发现
      this.startHealthCheck();
      return;
    }

    // 广播自己
    if (advertise) {
      try {
        this.service = this.bonjour.publish({
          name: `axon-${identity.agentId.slice(0, 8)}-${port}`,
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
      } catch (err) {
        console.warn('[AgentDiscovery] mDNS publish failed (file-based discovery still active):', err instanceof Error ? err.message : err);
      }
    }

    // 浏览局域网
    try {
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
    } catch (err) {
      console.warn('[AgentDiscovery] mDNS browse failed:', err instanceof Error ? err.message : err);
    }

    // 启动健康检查
    this.startHealthCheck();
  }

  // ===== 文件注册发现 =====

  /**
   * 写注册文件到 ~/.axon/network/peers/{port}.json
   */
  private registerPeerFile(identity: AgentIdentity, port: number): void {
    try {
      if (!fs.existsSync(this.peersDir)) {
        fs.mkdirSync(this.peersDir, { recursive: true });
      }

      const registration: PeerRegistration = {
        agentId: identity.agentId,
        name: identity.name,
        port,
        ownerFp: this.computeOwnerFp(identity),
        projects: identity.projects.map(p => p.name),
        version: identity.version,
        pid: process.pid,
        startedAt: Date.now(),
      };

      this.peerFile = path.join(this.peersDir, `${port}.json`);
      fs.writeFileSync(this.peerFile, JSON.stringify(registration, null, 2));

      // 进程退出时清理（保存引用以便 stop() 时移除）
      this.cleanupHandler = () => {
        try {
          if (this.peerFile && fs.existsSync(this.peerFile)) {
            fs.unlinkSync(this.peerFile);
          }
        } catch {
          // ignore
        }
      };
      process.on('exit', this.cleanupHandler);
    } catch (err) {
      console.warn('[AgentDiscovery] Failed to register peer file:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * 扫描 peers 目录发现本地实例
   */
  private scanPeers(selfIdentity: AgentIdentity): void {
    try {
      if (!fs.existsSync(this.peersDir)) return;

      const files = fs.readdirSync(this.peersDir).filter(f => f.endsWith('.json'));
      const seenIds = new Set<string>();

      for (const file of files) {
        try {
          const filePath = path.join(this.peersDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const reg: PeerRegistration = JSON.parse(content);

          // 跳过自己
          if (reg.agentId === selfIdentity.agentId) continue;

          // 检查进程是否还活着
          if (!this.isProcessAlive(reg.pid)) {
            // 进程已死，清理注册文件
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            // 如果之前发现过，标记为 lost
            if (this.agents.has(reg.agentId)) {
              this.agents.delete(reg.agentId);
              this.emit('lost', reg.agentId);
            }
            continue;
          }

          seenIds.add(reg.agentId);
          const endpoint = `127.0.0.1:${reg.port}`;
          const now = Date.now();

          const existing = this.agents.get(reg.agentId);
          if (existing) {
            existing.lastSeenAt = now;
            existing.online = true;
            existing.endpoint = endpoint;
            this.emit('updated', existing);
          } else {
            const agent: DiscoveredAgent = {
              agentId: reg.agentId,
              name: reg.name,
              ownerFingerprint: reg.ownerFp,
              projects: reg.projects,
              endpoint,
              discoveredAt: now,
              lastSeenAt: now,
              trustLevel: 'unknown',
              online: true,
            };
            this.agents.set(reg.agentId, agent);
            this.emit('found', agent);
          }
        } catch {
          // 单文件解析失败不影响其他
        }
      }
    } catch {
      // 目录不可读不影响 mDNS 发现
    }
  }

  /**
   * 检查 PID 对应的进程是否存活
   */
  private isProcessAlive(pid: number): boolean {
    try {
      // kill(pid, 0) 不发送信号，仅检查进程是否存在
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  // ===== mDNS 发现 =====

  /**
   * 处理 mDNS 发现的服务
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

  // ===== 健康检查 =====

  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, this.HEALTH_CHECK_INTERVAL);
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
    // 清理 peer 扫描
    if (this.peerScanTimer) {
      clearInterval(this.peerScanTimer);
      this.peerScanTimer = null;
    }

    // 移除 process exit handler（防止累积泄漏）
    if (this.cleanupHandler) {
      process.removeListener('exit', this.cleanupHandler);
      this.cleanupHandler = null;
    }

    // 清理注册文件
    if (this.peerFile) {
      try {
        if (fs.existsSync(this.peerFile)) {
          fs.unlinkSync(this.peerFile);
        }
      } catch {
        // ignore
      }
      this.peerFile = null;
    }

    // 清理健康检查
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // 清理 mDNS
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
