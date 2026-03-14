/**
 * Agent 路由匹配测试
 *
 * 测试按项目、能力、信任等级匹配目标 Agent
 */

import { describe, it, expect } from 'vitest';
import { AgentRouter } from '../../src/network/router.js';
import type { AgentDiscovery } from '../../src/network/discovery.js';
import type { DiscoveredAgent, AgentIdentity } from '../../src/network/types.js';

function createMockDiscovery(agents: DiscoveredAgent[]): AgentDiscovery {
  return {
    getDiscoveredAgents: () => agents,
  } as unknown as AgentDiscovery;
}

function createAgent(overrides: Partial<DiscoveredAgent> & { agentId: string }): DiscoveredAgent {
  return {
    name: 'test-agent',
    ownerFingerprint: 'fp-default',
    projects: [],
    endpoint: '127.0.0.1:7860',
    discoveredAt: Date.now(),
    lastSeenAt: Date.now(),
    trustLevel: 'same-owner',
    online: true,
    ...overrides,
  };
}

describe('AgentRouter', () => {
  describe('findByProject', () => {
    it('should filter agents by project name', () => {
      const agents = [
        createAgent({ agentId: 'a1', projects: ['my-project', 'other'] }),
        createAgent({ agentId: 'a2', projects: ['different-project'] }),
        createAgent({ agentId: 'a3', projects: ['my-project'] }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findByProject('my-project');
      expect(matches).toHaveLength(2);
      expect(matches.map(m => m.agentId)).toContain('a1');
      expect(matches.map(m => m.agentId)).toContain('a3');
    });

    it('should be case-insensitive', () => {
      const agents = [
        createAgent({ agentId: 'a1', projects: ['My-Project'] }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findByProject('my-project');
      expect(matches).toHaveLength(1);
    });

    it('should exclude offline agents', () => {
      const agents = [
        createAgent({ agentId: 'a1', projects: ['proj'], online: true }),
        createAgent({ agentId: 'a2', projects: ['proj'], online: false }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findByProject('proj');
      expect(matches).toHaveLength(1);
      expect(matches[0].agentId).toBe('a1');
    });
  });

  describe('findByCapability', () => {
    it('should filter agents by capability', () => {
      const agents = [
        createAgent({
          agentId: 'a1',
          identity: { capabilities: ['typescript', 'react'] } as unknown as AgentIdentity,
        }),
        createAgent({
          agentId: 'a2',
          identity: { capabilities: ['python'] } as unknown as AgentIdentity,
        }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findByCapability('typescript');
      expect(matches).toHaveLength(1);
      expect(matches[0].agentId).toBe('a1');
    });

    it('should not match agents without identity', () => {
      const agents = [
        createAgent({ agentId: 'a1' }), // no identity
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findByCapability('typescript');
      expect(matches).toHaveLength(0);
    });
  });

  describe('findBestMatches', () => {
    it('should return empty for no agents', () => {
      const router = new AgentRouter(createMockDiscovery([]));
      const matches = router.findBestMatches({});
      expect(matches).toEqual([]);
    });

    it('should return all online agents when no filter specified', () => {
      const agents = [
        createAgent({ agentId: 'a1', online: true }),
        createAgent({ agentId: 'a2', online: false }),
        createAgent({ agentId: 'a3', online: true }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findBestMatches({});
      expect(matches).toHaveLength(2);
    });

    it('should rank project-matching agents higher', () => {
      const agents = [
        createAgent({ agentId: 'no-match', projects: ['other'], trustLevel: 'same-owner' }),
        createAgent({ agentId: 'matched', projects: ['target'], trustLevel: 'same-owner' }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findBestMatches({ project: 'target' });
      // 两个都返回，但 matched 应排在前面
      expect(matches).toHaveLength(2);
      expect(matches[0].agentId).toBe('matched');
    });

    it('should prefer higher trust level', () => {
      const agents = [
        createAgent({ agentId: 'a1', trustLevel: 'known' }),
        createAgent({ agentId: 'a2', trustLevel: 'same-owner' }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findBestMatches({});
      // same-owner (80) > known (50)
      expect(matches[0].agentId).toBe('a2');
    });

    it('should filter by trustLevels when specified', () => {
      const agents = [
        createAgent({ agentId: 'a1', trustLevel: 'same-owner' }),
        createAgent({ agentId: 'a2', trustLevel: 'unknown' }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findBestMatches({ trustLevels: ['same-owner', 'known'] });
      expect(matches).toHaveLength(1);
      expect(matches[0].agentId).toBe('a1');
    });

    it('should exclude offline agents', () => {
      const agents = [
        createAgent({ agentId: 'online', online: true }),
        createAgent({ agentId: 'offline', online: false }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const matches = router.findBestMatches({});
      expect(matches).toHaveLength(1);
      expect(matches[0].agentId).toBe('online');
    });
  });

  describe('findBestMatch', () => {
    it('should return single best match', () => {
      const agents = [
        createAgent({ agentId: 'a1', trustLevel: 'known' }),
        createAgent({ agentId: 'a2', trustLevel: 'same-owner' }),
      ];
      const router = new AgentRouter(createMockDiscovery(agents));

      const match = router.findBestMatch({});
      expect(match).toBeDefined();
      expect(match!.agentId).toBe('a2');
    });

    it('should return null for no matches', () => {
      const router = new AgentRouter(createMockDiscovery([]));
      const match = router.findBestMatch({});
      expect(match).toBeNull();
    });
  });
});
