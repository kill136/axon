/**
 * 代理工具配置与过滤
 *
 * 定义各 Agent 类型的工具访问权限
 */

import { ToolDefinition } from '../types/index.js';
import { toolRegistry } from '../tools/base.js';

// ============ 类型定义 ============

export interface AgentToolConfig {
  agentType: string;
  allowedTools: string[] | '*';
  disallowedTools?: string[];
  permissionLevel?: 'readonly' | 'standard' | 'elevated';
  customRestrictions?: ToolRestriction[];
}

export interface ToolRestriction {
  toolName: string;
  type: 'scope';
  rule: ScopeRestriction;
}

export interface ScopeRestriction {
  allowedPaths?: string[];
  disallowedPaths?: string[];
  allowedCommands?: RegExp[];
  disallowedCommands?: RegExp[];
}

// ============ 预定义代理配置 ============

export const AGENT_TOOL_CONFIGS: Record<string, AgentToolConfig> = {
  'general-purpose': {
    agentType: 'general-purpose',
    allowedTools: '*',
    permissionLevel: 'standard',
  },
  'statusline-setup': {
    agentType: 'statusline-setup',
    allowedTools: ['Read', 'Edit', 'AskUserQuestion'],
    permissionLevel: 'standard',
  },
  'Explore': {
    agentType: 'Explore',
    allowedTools: '*',
    permissionLevel: 'readonly',
    customRestrictions: [
      {
        toolName: 'Bash',
        type: 'scope',
        rule: {
          allowedCommands: [
            /^git\s+(status|diff|log|show)/,
            /^ls(\s|$)/,
            /^cat(\s|$)/,
            /^head(\s|$)/,
            /^tail(\s|$)/,
          ],
        },
      },
    ],
  },
  'Plan': {
    agentType: 'Plan',
    allowedTools: '*',
    permissionLevel: 'elevated',
  },
  'claude-code-guide': {
    agentType: 'claude-code-guide',
    allowedTools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch', 'AskUserQuestion'],
    permissionLevel: 'readonly',
  },
  'code-reviewer': {
    agentType: 'code-reviewer',
    allowedTools: ['Bash', 'Glob', 'Grep', 'Read', 'Task', 'AskUserQuestion'],
    permissionLevel: 'readonly',
    customRestrictions: [
      {
        toolName: 'Bash',
        type: 'scope',
        rule: {
          allowedCommands: [/^git\s+(diff|status|log|show|remote\s+show)/],
        },
      },
    ],
  },

  // ============ Blueprint 多 Agent 系统专用配置 ============
  // 以下配置仅在 Web 模式下有效，需先调用 registerBlueprintTools()

  'chat-tab-agent': {
    agentType: 'chat-tab-agent',
    allowedTools: '*',
    // Chat Tab (planner 主 agent) 排除不属于当前角色的工具
    disallowedTools: [
      'Blueprint',        // CLI 模式工具，Chat Tab 使用 GenerateBlueprint
      'UpdateTaskPlan',   // LeadAgent 专用 - 更新执行计划中的任务状态
      'DispatchWorker',   // LeadAgent 专用 - 派发任务给 Worker 执行
      'TriggerE2ETest',   // LeadAgent 专用 - 触发 E2E 端到端测试
    ],
    permissionLevel: 'standard',
  },
  'lead-agent': {
    agentType: 'lead-agent',
    allowedTools: [
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
      'UpdateTaskPlan', 'DispatchWorker', 'TriggerE2ETest',
      'AskUserQuestion', 'Database', 'Debugger',
    ],
    permissionLevel: 'elevated',
  },
  'worker': {
    agentType: 'worker',
    allowedTools: [
      'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
      'AskUserQuestion', 'Database',
    ],
    permissionLevel: 'standard',
  },
};

// ============ 工具过滤器 ============

/**
 * 根据 AgentToolConfig 过滤工具
 */
export function getToolsForAgent(agentType: string): ToolDefinition[] {
  const config = AGENT_TOOL_CONFIGS[agentType];
  if (!config) {
    return toolRegistry.getDefinitions();
  }

  let tools = toolRegistry.getDefinitions();

  // 白名单过滤
  if (config.allowedTools !== '*') {
    const allowed = new Set(config.allowedTools);
    tools = tools.filter(t => allowed.has(t.name));
  }

  // 黑名单过滤
  if (config.disallowedTools) {
    const disallowed = new Set(config.disallowedTools);
    tools = tools.filter(t => !disallowed.has(t.name));
  }

  return tools;
}
