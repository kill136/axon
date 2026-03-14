/**
 * Agent 身份系统
 *
 * 基于 Ed25519 的密钥管理、Agent 身份卡片、Owner 归属证书。
 *
 * 密钥存储:
 *   ~/.axon/network/
 *     ├── owner.key      # Owner 私钥 (PEM)
 *     ├── owner.pub      # Owner 公钥 (PEM)
 *     ├── agent.key      # Agent 私钥 (PEM)
 *     ├── agent.pub      # Agent 公钥 (PEM)
 *     └── agent-cert.sig # Owner 对 Agent 的归属证书
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentIdentity, ProjectInfo, NetworkConfig } from './types.js';
import { PROTOCOL_VERSION } from './types.js';
import { probeProjects } from './project-probe.js';

const NETWORK_DIR = path.join(os.homedir(), '.axon', 'network');

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 生成 Ed25519 密钥对
 */
function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * 从 PEM 公钥提取原始字节并转 base64
 */
function pemToBase64(pem: string): string {
  const key = crypto.createPublicKey(pem);
  const raw = key.export({ type: 'spki', format: 'der' });
  return Buffer.from(raw).toString('base64');
}

/**
 * 计算公钥的 agentId：SHA-256 哈希前 16 字节 (hex)
 */
export function computeAgentId(publicKeyPem: string): string {
  const raw = pemToBase64(publicKeyPem);
  const hash = crypto.createHash('sha256').update(raw).digest();
  return hash.subarray(0, 16).toString('hex');
}

/**
 * 计算公钥指纹：SHA-256 前 8 字节 (hex)
 */
export function computeFingerprint(publicKeyPem: string): string {
  const raw = pemToBase64(publicKeyPem);
  const hash = crypto.createHash('sha256').update(raw).digest();
  return hash.subarray(0, 8).toString('hex');
}

/**
 * 用私钥签名数据
 */
export function sign(data: Buffer | string, privateKeyPem: string): string {
  const signature = crypto.sign(null, Buffer.from(data), privateKeyPem);
  return signature.toString('base64');
}

/**
 * 用公钥验签
 */
export function verify(data: Buffer | string, signature: string, publicKeyPem: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(data), publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

// ============================================================================
// 密钥存储
// ============================================================================

interface StoredKeys {
  ownerPublicKey: string;   // PEM
  ownerPrivateKey: string;  // PEM
  agentPublicKey: string;   // PEM
  agentPrivateKey: string;  // PEM
  ownerCertificate: string; // base64 签名
  ownerName: string;
}

/**
 * 加载或生成密钥
 */
function loadOrCreateKeys(ownerName: string): StoredKeys {
  ensureDir(NETWORK_DIR);

  const ownerKeyPath = path.join(NETWORK_DIR, 'owner.key');
  const ownerPubPath = path.join(NETWORK_DIR, 'owner.pub');
  const agentKeyPath = path.join(NETWORK_DIR, 'agent.key');
  const agentPubPath = path.join(NETWORK_DIR, 'agent.pub');
  const certPath = path.join(NETWORK_DIR, 'agent-cert.sig');
  const ownerNamePath = path.join(NETWORK_DIR, 'owner-name.txt');

  let ownerPublicKey: string;
  let ownerPrivateKey: string;
  let agentPublicKey: string;
  let agentPrivateKey: string;
  let ownerCertificate: string;

  // Owner 密钥
  if (fs.existsSync(ownerKeyPath) && fs.existsSync(ownerPubPath)) {
    ownerPrivateKey = fs.readFileSync(ownerKeyPath, 'utf-8');
    ownerPublicKey = fs.readFileSync(ownerPubPath, 'utf-8');
  } else {
    const pair = generateKeyPair();
    ownerPrivateKey = pair.privateKey;
    ownerPublicKey = pair.publicKey;
    fs.writeFileSync(ownerKeyPath, ownerPrivateKey, { mode: 0o600 });
    fs.writeFileSync(ownerPubPath, ownerPublicKey);
  }

  // Agent 密钥
  if (fs.existsSync(agentKeyPath) && fs.existsSync(agentPubPath)) {
    agentPrivateKey = fs.readFileSync(agentKeyPath, 'utf-8');
    agentPublicKey = fs.readFileSync(agentPubPath, 'utf-8');
  } else {
    const pair = generateKeyPair();
    agentPrivateKey = pair.privateKey;
    agentPublicKey = pair.publicKey;
    fs.writeFileSync(agentKeyPath, agentPrivateKey, { mode: 0o600 });
    fs.writeFileSync(agentPubPath, agentPublicKey);
  }

  // 归属证书：Owner 用自己的私钥签 Agent 的公钥
  if (fs.existsSync(certPath)) {
    ownerCertificate = fs.readFileSync(certPath, 'utf-8').trim();
  } else {
    const agentPubBase64 = pemToBase64(agentPublicKey);
    ownerCertificate = sign(agentPubBase64, ownerPrivateKey);
    fs.writeFileSync(certPath, ownerCertificate);
  }

  // Owner 名字
  if (ownerName) {
    fs.writeFileSync(ownerNamePath, ownerName);
  } else if (fs.existsSync(ownerNamePath)) {
    ownerName = fs.readFileSync(ownerNamePath, 'utf-8').trim();
  } else {
    ownerName = os.userInfo().username;
    fs.writeFileSync(ownerNamePath, ownerName);
  }

  return { ownerPublicKey, ownerPrivateKey, agentPublicKey, agentPrivateKey, ownerCertificate, ownerName };
}

// ============================================================================
// IdentityManager
// ============================================================================

export class IdentityManager {
  private keys!: StoredKeys;
  private _identity!: AgentIdentity;

  get identity(): AgentIdentity {
    return this._identity;
  }

  get agentId(): string {
    return this._identity.agentId;
  }

  get agentPrivateKey(): string {
    return this.keys.agentPrivateKey;
  }

  get ownerFingerprint(): string {
    return computeFingerprint(this.keys.ownerPublicKey);
  }

  /**
   * 初始化身份系统
   */
  async initialize(config: NetworkConfig, cwd: string): Promise<void> {
    const ownerName = ''; // 从已存储文件读取或使用系统用户名
    this.keys = loadOrCreateKeys(ownerName);

    const agentId = computeAgentId(this.keys.agentPublicKey);
    const agentPubBase64 = pemToBase64(this.keys.agentPublicKey);
    const ownerPubBase64 = pemToBase64(this.keys.ownerPublicKey);
    const hostname = os.hostname();
    const name = config.name || `${hostname}-${config.port}`;

    // 探测项目
    const projects = probeProjects(cwd);

    // 自动推断能力
    const capabilities = this.inferCapabilities(cwd);

    this._identity = {
      agentId,
      publicKey: agentPubBase64,
      name,
      owner: {
        name: this.keys.ownerName,
        publicKey: ownerPubBase64,
      },
      ownerCertificate: this.keys.ownerCertificate,
      projects,
      capabilities,
      exposedTools: [], // 由 AgentNetwork 后续填充
      endpoint: '', // 由 transport 后续填充
      version: '', // 由 AgentNetwork 填充
      protocolVersion: PROTOCOL_VERSION,
      startedAt: Date.now(),
    };
  }

  /**
   * 验证远程 Agent 的归属证书
   */
  verifyCertificate(remoteIdentity: AgentIdentity): boolean {
    try {
      // 重建 owner 公钥 PEM
      const ownerKeyObj = crypto.createPublicKey({
        key: Buffer.from(remoteIdentity.owner.publicKey, 'base64'),
        format: 'der',
        type: 'spki',
      });
      const ownerPem = ownerKeyObj.export({ type: 'spki', format: 'pem' }) as string;

      // 验证：Owner 签的是 Agent 的公钥
      return verify(remoteIdentity.publicKey, remoteIdentity.ownerCertificate, ownerPem);
    } catch {
      return false;
    }
  }

  /**
   * 判断远程 Agent 是否同 Owner
   */
  isSameOwner(remoteIdentity: AgentIdentity): boolean {
    return remoteIdentity.owner.publicKey === this._identity.owner.publicKey;
  }

  /**
   * 从工作目录推断能力
   */
  private inferCapabilities(cwd: string): string[] {
    const caps: string[] = [];
    const check = (file: string, cap: string) => {
      if (fs.existsSync(path.join(cwd, file))) caps.push(cap);
    };

    check('tsconfig.json', 'typescript');
    check('package.json', 'nodejs');
    check('requirements.txt', 'python');
    check('Cargo.toml', 'rust');
    check('go.mod', 'golang');
    check('Dockerfile', 'docker');
    check('.github/workflows', 'ci-cd');

    // 从 package.json 推断框架
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) caps.push('react');
      if (deps.vue) caps.push('vue');
      if (deps.express) caps.push('express');
      if (deps.next) caps.push('nextjs');
      if (deps['better-sqlite3'] || deps.pg || deps.mysql2) caps.push('database');
    } catch {
      // ignore
    }

    return caps;
  }
}
