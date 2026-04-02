/**
 * Agent API
 * 提供 agent 元数据和管理功能
 */

import express from 'express';
import { BUILT_IN_AGENT_TYPES, getAllActiveAgents, initializeCustomAgents } from '../../../tools/agent.js';
import path from 'path';
import fs from 'fs';

const AGENTS_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.axon', 'agents');

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
  source?: string;
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
      source: agent.source || 'built-in',
    };

    // 针对特定 agent 类型添加额外信息
    switch (agent.agentType) {
      case 'Explore':
        metadata.thoroughnessLevels = ['quick', 'medium', 'very thorough'];
        metadata.examples = [
          'Search all API endpoints',
          'Find files handling user authentication',
          'Analyze src/components directory structure',
        ];
        metadata.features = [
          'File pattern search (glob)',
          'Code content search (grep)',
          'Semantic search (filename + content)',
          'Structure analysis (exports/imports/classes/functions)',
        ];
        break;

      case 'general-purpose':
        metadata.examples = [
          'Research complex architectural issues',
          'Multi-step code search and analysis',
          'Cross-file refactoring planning',
        ];
        metadata.features = [
          'Access to all tools',
          'Multi-turn conversation capability',
          'Complex task decomposition',
        ];
        break;

      case 'Plan':
        metadata.examples = [
          'Design implementation plans for new features',
          'Evaluate trade-offs of technical approaches',
          'Plan code refactoring steps',
        ];
        metadata.features = [
          'Architectural design thinking',
          'Approach comparison analysis',
          'Risk assessment',
        ];
        break;

      case 'code-analyzer':
        metadata.examples = [
          'Analyze file exports and dependencies',
          'Extract module structure of directories',
          'Generate semantic summaries of code',
        ];
        metadata.features = [
          'Fast Opus model',
          'LSP tool support',
          'Structured JSON output',
          'Semantic analysis cache',
        ];
        break;

      case 'blueprint-worker':
        metadata.examples = [
          'Implement features using TDD',
          'Write tests first, then code',
          'Ensure tests pass',
        ];
        metadata.features = [
          'Test-Driven Development',
          'Only invoked by Queen Agent',
          'Full tool access',
        ];
        break;

      case 'claude-code-guide':
        metadata.examples = [
          'Axon CLI feature guide',
          'Anthropic API usage',
          'MCP server configuration',
        ];
        metadata.features = [
          'Web search capability',
          'Documentation retrieval',
          'API reference lookup',
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

/**
 * POST /api/agents
 * 创建新的自定义 agent（写入 ~/.axon/agents/{name}.md）
 */
router.post('/', (req, res) => {
  try {
    const { name, description, model, tools, disallowedTools, skills, permissionMode, forkContext, maxTurns, color, memory, systemPrompt } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing required field: name' });
    }
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing required field: description' });
    }

    // 检查是否与内置 agent 同名
    const builtIn = BUILT_IN_AGENT_TYPES.find(a => a.agentType === name);
    if (builtIn) {
      return res.status(409).json({ success: false, error: `Cannot create agent with built-in name '${name}'` });
    }

    // 确保目录存在
    fs.mkdirSync(AGENTS_DIR, { recursive: true });

    // 检查文件是否已存在
    const filePath = path.join(AGENTS_DIR, `${name}.md`);
    if (fs.existsSync(filePath)) {
      return res.status(409).json({ success: false, error: `Agent '${name}' already exists` });
    }

    // 构建 frontmatter
    const frontmatterLines = [`name: ${name}`, `description: ${description}`];
    if (model) frontmatterLines.push(`model: ${model}`);
    if (tools) frontmatterLines.push(`tools: ${Array.isArray(tools) ? tools.join(', ') : tools}`);
    if (disallowedTools) frontmatterLines.push(`disallowedTools: ${Array.isArray(disallowedTools) ? disallowedTools.join(', ') : disallowedTools}`);
    if (skills) frontmatterLines.push(`skills: ${Array.isArray(skills) ? skills.join(', ') : skills}`);
    if (permissionMode) frontmatterLines.push(`permissionMode: ${permissionMode}`);
    if (forkContext !== undefined) frontmatterLines.push(`forkContext: ${forkContext}`);
    if (maxTurns) frontmatterLines.push(`maxTurns: ${maxTurns}`);
    if (color) frontmatterLines.push(`color: ${color}`);
    if (memory) frontmatterLines.push(`memory: ${memory}`);

    const content = `---\n${frontmatterLines.join('\n')}\n---\n\n${systemPrompt || ''}`;
    fs.writeFileSync(filePath, content, 'utf-8');

    // 重新加载自定义 agents
    initializeCustomAgents();

    res.json({ success: true, data: { name, filePath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to create agent' });
  }
});

/**
 * PUT /api/agents/:agentType
 * 更新自定义 agent
 */
router.put('/:agentType', (req, res) => {
  try {
    const { agentType } = req.params;

    // 不允许编辑内置 agent
    const builtIn = BUILT_IN_AGENT_TYPES.find(a => a.agentType === agentType);
    if (builtIn) {
      return res.status(403).json({ success: false, error: `Cannot edit built-in agent '${agentType}'` });
    }

    const filePath = path.join(AGENTS_DIR, `${agentType}.md`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: `Custom agent '${agentType}' not found` });
    }

    const { description, model, tools, disallowedTools, skills, permissionMode, forkContext, maxTurns, color, memory, systemPrompt } = req.body;

    const name = agentType;
    const frontmatterLines = [`name: ${name}`];
    if (description) frontmatterLines.push(`description: ${description}`);
    if (model) frontmatterLines.push(`model: ${model}`);
    if (tools) frontmatterLines.push(`tools: ${Array.isArray(tools) ? tools.join(', ') : tools}`);
    if (disallowedTools) frontmatterLines.push(`disallowedTools: ${Array.isArray(disallowedTools) ? disallowedTools.join(', ') : disallowedTools}`);
    if (skills) frontmatterLines.push(`skills: ${Array.isArray(skills) ? skills.join(', ') : skills}`);
    if (permissionMode) frontmatterLines.push(`permissionMode: ${permissionMode}`);
    if (forkContext !== undefined) frontmatterLines.push(`forkContext: ${forkContext}`);
    if (maxTurns) frontmatterLines.push(`maxTurns: ${maxTurns}`);
    if (color) frontmatterLines.push(`color: ${color}`);
    if (memory) frontmatterLines.push(`memory: ${memory}`);

    const content = `---\n${frontmatterLines.join('\n')}\n---\n\n${systemPrompt || ''}`;
    fs.writeFileSync(filePath, content, 'utf-8');

    // 重新加载
    initializeCustomAgents();

    res.json({ success: true, data: { name, filePath } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to update agent' });
  }
});

/**
 * DELETE /api/agents/:agentType
 * 删除自定义 agent
 */
router.delete('/:agentType', (req, res) => {
  try {
    const { agentType } = req.params;

    // 不允许删除内置 agent
    const builtIn = BUILT_IN_AGENT_TYPES.find(a => a.agentType === agentType);
    if (builtIn) {
      return res.status(403).json({ success: false, error: `Cannot delete built-in agent '${agentType}'` });
    }

    const filePath = path.join(AGENTS_DIR, `${agentType}.md`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: `Custom agent '${agentType}' not found` });
    }

    fs.unlinkSync(filePath);

    // 重新加载
    initializeCustomAgents();

    res.json({ success: true, data: { deleted: agentType } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to delete agent' });
  }
});

/**
 * GET /api/agents/:agentType/raw
 * 获取自定义 agent 的原始 .md 内容（用于编辑表单回填）
 */
router.get('/:agentType/raw', (req, res) => {
  try {
    const { agentType } = req.params;
    const filePath = path.join(AGENTS_DIR, `${agentType}.md`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: `Custom agent '${agentType}' not found` });
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    res.json({ success: true, data: { agentType, raw } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || 'Failed to read agent file' });
  }
});

export default router;
