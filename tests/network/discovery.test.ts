/**
 * Agent Discovery 测试
 *
 * 测试文件注册发现机制（同机器多实例发现）
 * 使用临时目录隔离，避免干扰运行中的 Axon 实例
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentDiscovery } from '../../src/network/discovery.js';
import type { AgentIdentity } from '../../src/network/types.js';

// 构造测试用的 identity
function makeIdentity(agentId: string, name: string, port: number): AgentIdentity {
  return {
    agentId,
    publicKey: 'test-pub-key-' + agentId,
    name,
    owner: {
      name: 'test-owner',
      publicKey: 'test-owner-pub-key',
    },
    ownerCertificate: 'test-cert',
    projects: [{ name: 'test-project' }],
    capabilities: ['test'],
    exposedTools: [],
    endpoint: `127.0.0.1:${port}`,
    version: '1.0.0',
    protocolVersion: '1.0',
    startedAt: Date.now(),
  };
}

describe('AgentDiscovery - File-based local discovery', () => {
  let discovery1: AgentDiscovery;
  let discovery2: AgentDiscovery;
  let tempPeersDir: string;

  beforeEach(() => {
    // 使用临时目录，不干扰真实的 ~/.axon/network/peers/
    tempPeersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-test-peers-'));
    discovery1 = new AgentDiscovery({ peersDir: tempPeersDir });
    discovery2 = new AgentDiscovery({ peersDir: tempPeersDir });
  });

  afterEach(async () => {
    await discovery1.stop();
    await discovery2.stop();
    // 清理临时目录
    try { fs.rmSync(tempPeersDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should register a peer file on start', async () => {
    const identity = makeIdentity('aaaa1111bbbb2222cccc3333dddd4444', 'test-1', 17860);

    await discovery1.start(identity, 17860, true);

    const peerFile = path.join(tempPeersDir, '17860.json');
    expect(fs.existsSync(peerFile)).toBe(true);

    const content = JSON.parse(fs.readFileSync(peerFile, 'utf-8'));
    expect(content.agentId).toBe('aaaa1111bbbb2222cccc3333dddd4444');
    expect(content.port).toBe(17860);
    expect(content.pid).toBe(process.pid);
  });

  it('should clean up peer file on stop', async () => {
    const identity = makeIdentity('aaaa1111bbbb2222cccc3333dddd4444', 'test-1', 17861);
    await discovery1.start(identity, 17861, true);

    const peerFile = path.join(tempPeersDir, '17861.json');
    expect(fs.existsSync(peerFile)).toBe(true);

    await discovery1.stop();
    expect(fs.existsSync(peerFile)).toBe(false);
  });

  it('should discover another local agent via peer files', async () => {
    const id1 = makeIdentity('aaaa1111bbbb2222cccc3333dddd4444', 'agent-1', 17862);
    const id2 = makeIdentity('eeee5555ffff6666aaaa7777bbbb8888', 'agent-2', 17863);

    // Start first instance (registers peer file)
    await discovery1.start(id1, 17862, true);

    // Manually write a second peer file (simulating another instance)
    const peer2File = path.join(tempPeersDir, '17863.json');
    fs.writeFileSync(peer2File, JSON.stringify({
      agentId: id2.agentId,
      name: id2.name,
      port: 17863,
      ownerFp: '',
      projects: ['test-project'],
      version: '1.0.0',
      pid: process.pid, // Use current PID so isProcessAlive returns true
      startedAt: Date.now(),
    }));

    // Wait for scan to find the second agent
    const found = await new Promise<any>((resolve) => {
      const existing = discovery1.getAgent(id2.agentId);
      if (existing) return resolve(existing);

      discovery1.on('found', (agent) => {
        if (agent.agentId === id2.agentId) resolve(agent);
      });

      // Safety timeout
      setTimeout(() => resolve(null), 10_000);
    });

    expect(found).not.toBeNull();
    expect(found.agentId).toBe(id2.agentId);
    expect(found.name).toBe('agent-2');
    expect(found.endpoint).toBe('127.0.0.1:17863');
  });

  it('should remove dead peer files', { timeout: 15_000 }, async () => {
    const id1 = makeIdentity('aaaa1111bbbb2222cccc3333dddd4444', 'agent-1', 17864);

    // Write a peer file with a definitely dead PID
    const deadPeerFile = path.join(tempPeersDir, '19999.json');
    fs.writeFileSync(deadPeerFile, JSON.stringify({
      agentId: 'dead0000dead0000dead0000dead0000',
      name: 'dead-agent',
      port: 19999,
      ownerFp: '',
      projects: [],
      version: '1.0.0',
      pid: 999999, // Almost certainly not a real PID
      startedAt: Date.now() - 100000,
    }));

    await discovery1.start(id1, 17864, true);

    // Wait for scan
    await new Promise(r => setTimeout(r, 6_000));

    // Dead peer file should be cleaned up
    expect(fs.existsSync(deadPeerFile)).toBe(false);
    expect(discovery1.getAgent('dead0000dead0000dead0000dead0000')).toBeUndefined();
  });

  it('should not discover self', { timeout: 15_000 }, async () => {
    const id1 = makeIdentity('aaaa1111bbbb2222cccc3333dddd4444', 'agent-1', 17865);
    await discovery1.start(id1, 17865, true);

    // Wait for a scan cycle
    await new Promise(r => setTimeout(r, 6_000));

    // Should not have discovered itself (mDNS may discover other real agents, so only check self)
    expect(discovery1.getAgent(id1.agentId)).toBeUndefined();
  });
});
