/**
 * Agent 权限控制测试
 *
 * 测试信任分级判定、权限检查、信任列表管理
 * 注意: PermissionManager 构造时会尝试读取信任文件，文件不存在时会跳过
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PermissionManager } from '../../src/network/permission.js';
import type { IdentityManager } from '../../src/network/identity.js';
import type { AgentIdentity } from '../../src/network/types.js';

function createMockIdentityManager(agentId: string, ownerPublicKey: string): IdentityManager {
  return {
    agentId,
    identity: {
      agentId,
      owner: { publicKey: ownerPublicKey, name: 'test-owner' },
    } as AgentIdentity,
    isSameOwner: (remote: AgentIdentity) => remote.owner.publicKey === ownerPublicKey,
  } as unknown as IdentityManager;
}

describe('PermissionManager', () => {
  const myAgentId = 'my-agent-id-0000000000000000';
  const myOwnerKey = 'owner-pub-key-base64';
  let manager: PermissionManager;

  beforeEach(() => {
    // PermissionManager 构造时会尝试读取 ~/.axon/network/trusted-agents.json
    // 文件不存在时会 catch 并跳过，所以不需要 mock
    const mockIdentity = createMockIdentityManager(myAgentId, myOwnerKey);
    manager = new PermissionManager(mockIdentity);
  });

  describe('determineTrustLevel', () => {
    it('should return "self" for own agentId', () => {
      const remote: AgentIdentity = {
        agentId: myAgentId,
        owner: { publicKey: myOwnerKey, name: 'me' },
      } as AgentIdentity;

      expect(manager.determineTrustLevel(remote)).toBe('self');
    });

    it('should return "same-owner" for same owner key', () => {
      const remote: AgentIdentity = {
        agentId: 'different-agent-id-00000000',
        owner: { publicKey: myOwnerKey, name: 'me' },
      } as AgentIdentity;

      expect(manager.determineTrustLevel(remote)).toBe('same-owner');
    });

    it('should return "unknown" for unrecognized agent', () => {
      const remote: AgentIdentity = {
        agentId: 'unknown-agent-id-000000000',
        owner: { publicKey: 'other-owner-key', name: 'stranger' },
      } as AgentIdentity;

      expect(manager.determineTrustLevel(remote)).toBe('unknown');
    });

    it('should return "known" after manual trust', () => {
      const agentId = 'trusted-agent-id-000000000';
      manager.trustAgent(agentId, 'trusted-bot', 'fp-1234');

      const remote: AgentIdentity = {
        agentId,
        owner: { publicKey: 'other-owner-key', name: 'other' },
      } as AgentIdentity;

      expect(manager.determineTrustLevel(remote)).toBe('known');
    });
  });

  describe('checkPermission', () => {
    it('should allow everything for "self"', () => {
      const result = manager.checkPermission(myAgentId, 'self', 'any.method');
      expect(result.allowed).toBe(true);
    });

    it('should allow everything for "same-owner"', () => {
      const result = manager.checkPermission('other-id', 'same-owner', 'any.method');
      expect(result.allowed).toBe(true);
    });

    it('should deny for "unknown"', () => {
      const result = manager.checkPermission('unknown-id', 'unknown', 'any.method');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown agent');
    });

    it('should allow all methods for "known" with empty whitelist', () => {
      manager.trustAgent('trusted-id', 'bot', 'fp-abc');
      const result = manager.checkPermission('trusted-id', 'known', 'anything');
      expect(result.allowed).toBe(true);
    });

    it('should enforce method whitelist for "known"', () => {
      manager.trustAgent('trusted-id', 'bot', 'fp-abc', ['agent.ping', 'agent.listTools']);

      expect(manager.checkPermission('trusted-id', 'known', 'agent.ping').allowed).toBe(true);
      expect(manager.checkPermission('trusted-id', 'known', 'agent.listTools').allowed).toBe(true);
      expect(manager.checkPermission('trusted-id', 'known', 'agent.callTool').allowed).toBe(false);
    });

    it('should deny "known" that is not in trust list', () => {
      const result = manager.checkPermission('not-trusted-id', 'known', 'agent.ping');
      expect(result.allowed).toBe(false);
    });
  });

  describe('trustAgent / untrustAgent', () => {
    it('should add and remove agent trust', () => {
      const agentId = 'agent-to-trust-00000000000';
      manager.trustAgent(agentId, 'friend', 'fp-x');

      const trusted = manager.getTrustedAgents();
      // 可能已有之前持久化的信任记录，至少包含我们刚加的
      const found = trusted.find(t => t.agentId === agentId);
      expect(found).toBeDefined();
      expect(found!.name).toBe('friend');

      manager.untrustAgent(agentId);
      const afterUntrust = manager.getTrustedAgents().find(t => t.agentId === agentId);
      expect(afterUntrust).toBeUndefined();
    });

    it('should update trust record on re-trust', () => {
      const agentId = 'agent-retrust-0000000000000';
      manager.trustAgent(agentId, 'old-name', 'fp-1', ['agent.ping']);
      manager.trustAgent(agentId, 'new-name', 'fp-1', []);

      const found = manager.getTrustedAgents().find(t => t.agentId === agentId);
      expect(found).toBeDefined();
      expect(found!.name).toBe('new-name');
      expect(found!.allowedMethods).toEqual([]);

      // cleanup
      manager.untrustAgent(agentId);
    });
  });
});
