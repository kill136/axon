/**
 * Discovery 清理机制测试
 *
 * 测试 signal handler 不泄漏、stop() 正确清理资源
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { AgentDiscovery } from '../../src/network/discovery.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import type { AgentIdentity } from '../../src/network/types.js';
import { PROTOCOL_VERSION } from '../../src/network/types.js';

describe('AgentDiscovery cleanup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `axon-test-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function createMockIdentity(port: number): AgentIdentity {
    // 需要有效的 Ed25519 SPKI DER 公钥（computeOwnerFp 会解析它）
    const { publicKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const pubBase64 = (publicKey as Buffer).toString('base64');

    return {
      agentId: `test-agent-${port}`,
      publicKey: pubBase64,
      name: `test-${port}`,
      owner: { name: 'test-owner', publicKey: pubBase64 },
      ownerCertificate: 'dGVzdA==',
      projects: [{ name: 'test-project' }],
      capabilities: [],
      exposedTools: [],
      endpoint: `127.0.0.1:${port}`,
      version: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
      startedAt: Date.now(),
    };
  }

  it('should not accumulate process exit handlers across start/stop cycles', async () => {
    const discovery = new AgentDiscovery({ peersDir: tmpDir });
    const identity = createMockIdentity(17860);

    const exitListenersBefore = process.listenerCount('exit');

    // 模拟多次 start/stop 循环
    await discovery.start(identity, 17860, false);
    await discovery.stop();

    await discovery.start(identity, 17860, false);
    await discovery.stop();

    await discovery.start(identity, 17860, false);
    await discovery.stop();

    const exitListenersAfter = process.listenerCount('exit');

    // 三次 start/stop 后不应有额外的 exit listener 残留
    expect(exitListenersAfter).toBe(exitListenersBefore);
  });

  it('should clean up peer file on stop()', async () => {
    const discovery = new AgentDiscovery({ peersDir: tmpDir });
    const identity = createMockIdentity(17861);

    await discovery.start(identity, 17861, true); // advertise=true 才会注册 peer 文件

    // 确认 peer 文件存在
    const peerFile = path.join(tmpDir, '17861.json');
    expect(fs.existsSync(peerFile)).toBe(true);

    await discovery.stop();

    // 确认 peer 文件被清理
    expect(fs.existsSync(peerFile)).toBe(false);
  });

  it('should clear discovered agents on stop()', async () => {
    const discovery = new AgentDiscovery({ peersDir: tmpDir });
    const identity = createMockIdentity(17862);

    await discovery.start(identity, 17862, false);
    expect(discovery.getDiscoveredAgents()).toBeDefined();

    await discovery.stop();
    expect(discovery.getDiscoveredAgents()).toEqual([]);
  });
});
