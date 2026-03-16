/**
 * Agent Identity 系统测试
 *
 * 测试 Ed25519 密钥管理、签名验证、Agent ID 计算
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  computeAgentId,
  computeFingerprint,
  sign,
  verify,
  IdentityManager,
} from '../../src/network/identity.js';
import type { NetworkConfig } from '../../src/network/types.js';

// 生成临时 Ed25519 密钥对用于测试
function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

describe('Identity - Crypto Functions', () => {
  let keyPair: { publicKey: string; privateKey: string };

  beforeEach(() => {
    keyPair = generateTestKeyPair();
  });

  describe('computeAgentId', () => {
    it('should return 32 char hex string', () => {
      const agentId = computeAgentId(keyPair.publicKey);
      expect(agentId).toMatch(/^[0-9a-f]{32}$/);
    });

    it('should be deterministic for same key', () => {
      const id1 = computeAgentId(keyPair.publicKey);
      const id2 = computeAgentId(keyPair.publicKey);
      expect(id1).toBe(id2);
    });

    it('should be different for different keys', () => {
      const otherPair = generateTestKeyPair();
      const id1 = computeAgentId(keyPair.publicKey);
      const id2 = computeAgentId(otherPair.publicKey);
      expect(id1).not.toBe(id2);
    });
  });

  describe('computeFingerprint', () => {
    it('should return 16 char hex string', () => {
      const fp = computeFingerprint(keyPair.publicKey);
      expect(fp).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should be consistent with agentId prefix', () => {
      const agentId = computeAgentId(keyPair.publicKey);
      const fp = computeFingerprint(keyPair.publicKey);
      // fingerprint 是 SHA-256 前 8 字节，agentId 是前 16 字节
      // fingerprint 应该是 agentId 的前缀
      expect(agentId.startsWith(fp)).toBe(true);
    });
  });

  describe('sign and verify', () => {
    it('should sign and verify string data', () => {
      const data = 'hello world';
      const signature = sign(data, keyPair.privateKey);
      expect(typeof signature).toBe('string');
      expect(signature.length).toBeGreaterThan(0);

      const valid = verify(data, signature, keyPair.publicKey);
      expect(valid).toBe(true);
    });

    it('should sign and verify Buffer data', () => {
      const data = Buffer.from('binary data');
      const signature = sign(data, keyPair.privateKey);
      const valid = verify(data, signature, keyPair.publicKey);
      expect(valid).toBe(true);
    });

    it('should fail verification with wrong data', () => {
      const signature = sign('original', keyPair.privateKey);
      const valid = verify('tampered', signature, keyPair.publicKey);
      expect(valid).toBe(false);
    });

    it('should fail verification with wrong key', () => {
      const otherPair = generateTestKeyPair();
      const signature = sign('data', keyPair.privateKey);
      const valid = verify('data', signature, otherPair.publicKey);
      expect(valid).toBe(false);
    });

    it('should fail verification with corrupt signature', () => {
      const valid = verify('data', 'not-a-valid-signature', keyPair.publicKey);
      expect(valid).toBe(false);
    });
  });
});

describe('IdentityManager', () => {
  let manager: IdentityManager;
  let testDir: string;
  let originalHome: string;

  beforeEach(() => {
    manager = new IdentityManager();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
    // 需要 mock HOME 以避免污染真实密钥
    originalHome = os.homedir();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('initialize', () => {
    // IdentityManager.initialize 会读写 ~/.axon/network/
    // 在 CI 环境中不方便 mock homedir，所以这里只测试已有密钥后的行为

    it('should create identity with correct structure after init', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      // initialize 会创建/加载密钥
      await manager.initialize(config, testDir);

      const identity = manager.identity;
      expect(identity).toBeDefined();
      expect(identity.agentId).toMatch(/^[0-9a-f]{32}$/);
      expect(identity.publicKey).toBeTruthy();
      expect(identity.owner).toBeDefined();
      expect(identity.owner.name).toBeTruthy();
      expect(identity.owner.publicKey).toBeTruthy();
      expect(identity.ownerCertificate).toBeTruthy();
      expect(identity.protocolVersion).toBe('1.0');
      expect(identity.projects).toBeInstanceOf(Array);
      expect(identity.capabilities).toBeInstanceOf(Array);
    });

    it('should have stable agentId across multiple inits', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      await manager.initialize(config, testDir);
      const id1 = manager.agentId;

      // 第二次初始化应该复用密钥
      const manager2 = new IdentityManager();
      await manager2.initialize(config, testDir);
      const id2 = manager2.agentId;

      expect(id1).toBe(id2);
    });
  });

  describe('verifyCertificate', () => {
    it('should verify own certificate', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      await manager.initialize(config, testDir);
      const identity = manager.identity;

      // 验证自己的证书
      const valid = manager.verifyCertificate(identity);
      expect(valid).toBe(true);
    });
  });

  describe('isSameOwner', () => {
    it('should detect same owner', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      await manager.initialize(config, testDir);
      const identity = manager.identity;

      // 同一个 identity 当然是 same owner
      const result = manager.isSameOwner(identity);
      expect(result).toBe(true);
    });
  });

  describe('multi-instance identity isolation', () => {
    it('should generate different agentIds for different ports', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      // 默认端口 7860 — 无后缀
      const m1 = new IdentityManager();
      await m1.initialize(config, testDir, 7860);

      // 非默认端口 7861 — 生成独立密钥
      const m2 = new IdentityManager();
      await m2.initialize(config, testDir, 7861);

      expect(m1.agentId).not.toBe(m2.agentId);
    });

    it('should share the same owner across instances', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      const m1 = new IdentityManager();
      await m1.initialize(config, testDir, 7860);

      const m2 = new IdentityManager();
      await m2.initialize(config, testDir, 7861);

      // 两个实例应该互相认为是 same-owner
      expect(m1.isSameOwner(m2.identity)).toBe(true);
      expect(m2.isSameOwner(m1.identity)).toBe(true);
    });

    it('should verify cross-instance certificates', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      const m1 = new IdentityManager();
      await m1.initialize(config, testDir, 7860);

      const m2 = new IdentityManager();
      await m2.initialize(config, testDir, 7861);

      // 两个实例的证书都应该可验证（同一个 owner 签的）
      expect(m1.verifyCertificate(m2.identity)).toBe(true);
      expect(m2.verifyCertificate(m1.identity)).toBe(true);
    });

    it('should keep same agentId for default port 7860', async () => {
      const config: NetworkConfig = {
        enabled: true,
        port: 7860,
        advertise: true,
        autoAcceptSameOwner: true,
      };

      // 不传 port 和传 7860 应该一样（向后兼容）
      const m1 = new IdentityManager();
      await m1.initialize(config, testDir);

      const m2 = new IdentityManager();
      await m2.initialize(config, testDir, 7860);

      expect(m1.agentId).toBe(m2.agentId);
    });
  });
});
