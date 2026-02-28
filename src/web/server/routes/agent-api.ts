/**
 * Agent API
 * 提供 agent 元数据和管理功能
 */

import express from 'express';
import { BUILT_IN_AGENT_TYPES, getAllActiveAgents } from '../../../tools/agent.js';
import path from 'path';
import fs from 'fs';

const router = express.Router();

/**
 * Agent 元数据扩展信息
 */
interface AgentMetadata {
  agentType: string;
  displayName: string;
  description: string;
  whenToUse: string;
  tools: string[];
  forkContext: boolean;
  permissionMode?: string;
  defaultModel?: string;
  examples?: string[];
  thoroughnessLevels?: string[];
  features?: string[];
}

/**
 * 从 BUILT_IN_AGENT_TYPES 提取完整元数据
 */
function getAgentMetadata(): AgentMetadata[] {
  return getAllActiveAgents().map(agent => {
    // 基本元数据
    const metadata: AgentMetadata = {
      agentType: agent.agentType,
      displayName: formatDisplayName(agent.agentType),
      description: agent.whenToUse,
      whenToUse: agent.whenToUse,
      tools: agent.tools || ['*'],
      forkContext: agent.forkContext || false,
      permissionMode: agent.permissionMode,
      defaultModel: agent.model,
    };

    // 针对特定 agent 类型添加额外信息
    switch (agent.agentType) {
      case 'Explore':
        metadata.thoroughnessLevels = ['quick', 'medium', 'very thorough'];
        metadata.examples = [
          '搜索所有 API 端点',
          '找到处理用户认证的文件',
          '分析 src/components 目录结构',
        ];
        metadata.features = [
          '文件模式搜索 (glob)',
          '代码内容搜索 (grep)',
          '语义搜索 (文件名+内容)',
          '结构分析 (导出/导入/类/函数)',
        ];
        break;

      case 'general-purpose':
        metadata.examples = [
          '研究复杂的架构问题',
          '多步骤代码搜索和分析',
          '跨文件重构规划',
        ];
        metadata.features = [
          '访问所有工具',
          '多轮对话能力',
          '复杂任务分解',
        ];
        break;

      case 'Plan':
        metadata.examples = [
          '设计新功能的实现方案',
          '评估技术方案的权衡',
          '规划代码重构步骤',
        ];
        metadata.features = [
          '架构设计思维',
          '方案对比分析',
          '风险评估',
        ];
        break;

      case 'code-analyzer':
        metadata.examples = [
          '分析文件的导出和依赖关系',
          '提取目录的模块结构',
          '生成代码的语义摘要',
        ];
        metadata.features = [
          '快速 Opus 模型',
          'LSP 工具支持',
          '结构化 JSON 输出',
          '语义分析缓存',
        ];
        break;

      case 'blueprint-worker':
        metadata.examples = [
          'TDD 方式实现功能',
          '先写测试后写代码',
          '确保测试通过',
        ];
        metadata.features = [
          'Test-Driven Development',
          '仅被 Queen Agent 调用',
          '完整的工具访问',
        ];
        break;

      case 'claude-code-guide':
        metadata.examples = [
          'Axon CLI 功能说明',
          'Anthropic API 使用方法',
          'MCP 服务器配置',
        ];
        metadata.features = [
          'Web 搜索能力',
          '文档检索',
          'API 参考查询',
        ];
        break;
    }

    return metadata;
  });
}

/**
 * 格式化显示名称
 */
function formatDisplayName(agentType: string): string {
  // Explore -> Explore Agent
  // general-purpose -> General Purpose Agent
  // claude-code-guide -> Axon Guide

  if (agentType === 'Explore' || agentType === 'Plan') {
    return `${agentType} Agent`;
  }

  return agentType
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') + ' Agent';
}

/**
 * 获取 agent 实现文件的源码
 */
async function getAgentSourceCode(agentType: string): Promise<string | null> {
  try {
    // 将 agentType 转换为文件名
    // Explore -> explore.ts
    // general-purpose -> general-purpose.ts (不存在，返回null)
    const filename = agentType.toLowerCase() + '.ts';
    const agentFilePath = path.join(process.cwd(), 'src', 'agents', filename);

    if (fs.existsSync(agentFilePath)) {
      return fs.readFileSync(agentFilePath, 'utf-8');
    }

    return null;
  } catch (error) {
    console.error(`Failed to read agent source code for ${agentType}:`, error);
    return null;
  }
}

// ==================== API 路由 ====================

/**
 * GET /api/agents
 * 获取所有 agent 的元数据列表
 */
router.get('/', (req, res) => {
  try {
    const agents = getAgentMetadata();
    res.json({
      success: true,
      data: agents,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get agent metadata',
    });
  }
});

/**
 * GET /api/agents/:agentType
 * 获取特定 agent 的详细信息
 */
router.get('/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const agents = getAgentMetadata();
    const agent = agents.find(a => a.agentType === agentType);

    if (!agent) {
      return res.status(404).json({
        success: false,
        error: `Agent type '${agentType}' not found`,
      });
    }

    // 尝试获取源码
    const sourceCode = await getAgentSourceCode(agentType);

    res.json({
      success: true,
      data: {
        ...agent,
        hasSourceCode: !!sourceCode,
        sourceCode: req.query.includeSource === 'true' ? sourceCode : undefined,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get agent details',
    });
  }
});

/**
 * GET /api/agents/:agentType/source
 * 获取 agent 的源码实现
 */
router.get('/:agentType/source', async (req, res) => {
  try {
    const { agentType } = req.params;
    const sourceCode = await getAgentSourceCode(agentType);

    if (!sourceCode) {
      return res.status(404).json({
        success: false,
        error: `Source code for agent '${agentType}' not found`,
      });
    }

    res.json({
      success: true,
      data: {
        agentType,
        sourceCode,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get agent source code',
    });
  }
});

export default router;
