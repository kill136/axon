/**
 * Agent 消息路由
 *
 * 根据项目名、能力标签、信任等级匹配目标 Agent。
 */

import type { DiscoveredAgent, TrustLevel } from './types.js';
import type { AgentDiscovery } from './discovery.js';

/** 信任等级权重（越高越优先） */
const TRUST_WEIGHT: Record<TrustLevel, number> = {
  self: 100,
  'same-owner': 80,
  known: 50,
  unknown: 0,
};

export class AgentRouter {
  constructor(private discovery: AgentDiscovery) {}

  /**
   * 按项目名查找 Agent
   */
  findByProject(projectName: string): DiscoveredAgent[] {
    const lower = projectName.toLowerCase();
    return this.discovery.getDiscoveredAgents().filter(
      agent => agent.online && agent.projects.some(p => p.toLowerCase() === lower)
    );
  }

  /**
   * 按能力查找 Agent（需要握手后才有完整能力信息）
   */
  findByCapability(capability: string): DiscoveredAgent[] {
    const lower = capability.toLowerCase();
    return this.discovery.getDiscoveredAgents().filter(
      agent => agent.online && agent.identity?.capabilities.some(c => c.toLowerCase() === lower)
    );
  }

  /**
   * 综合匹配：项目 + 能力 + 信任优先级
   * 返回按匹配度排序的 Agent 列表
   */
  findBestMatches(query: {
    project?: string;
    capability?: string;
    trustLevels?: TrustLevel[];
  }): DiscoveredAgent[] {
    const agents = this.discovery.getDiscoveredAgents().filter(a => a.online);

    const scored = agents.map(agent => {
      let score = TRUST_WEIGHT[agent.trustLevel] || 0;

      // 项目匹配
      if (query.project) {
        const lower = query.project.toLowerCase();
        if (agent.projects.some(p => p.toLowerCase() === lower)) {
          score += 50;
        }
      }

      // 能力匹配
      if (query.capability && agent.identity) {
        const lower = query.capability.toLowerCase();
        if (agent.identity.capabilities.some(c => c.toLowerCase() === lower)) {
          score += 30;
        }
      }

      // 信任等级过滤
      if (query.trustLevels && !query.trustLevels.includes(agent.trustLevel)) {
        score = -1;
      }

      return { agent, score };
    });

    return scored
      .filter(s => s.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.agent);
  }

  /**
   * 找到最佳匹配的单个 Agent
   */
  findBestMatch(query: { project?: string; capability?: string }): DiscoveredAgent | null {
    const matches = this.findBestMatches(query);
    return matches[0] || null;
  }
}
