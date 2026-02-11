/**
 * Agent Teams 工具 - TeammateTool
 *
 * 管理团队和协调代理（对齐官方 cli.js 实现）
 * 需要 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 环境变量
 *
 * 注意：SendMessage 功能已统一到 tools/team.ts 的 TeamSendMessageTool
 * 此文件仅保留 TeammateTool（官方 23 次引用的主要工具）
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';
import {
  isAgentTeamsEnabled,
  getAgentId,
  getTeamName,
  createTeammateContext,
  setDynamicTeamContext,
  clearDynamicTeamContext,
} from '../agents/teammate-context.js';
import {
  createTeam,
  getTeam,
  deleteTeam,
  getActiveMembers,
} from '../teams/storage.js';

// ============================================================================
// 类型定义
// ============================================================================

interface TeammateToolInput {
  operation: 'spawnTeam' | 'cleanup';
  team_name?: string;
  description?: string;
}

// ============================================================================
// TeammateTool（对齐官方实现，使用统一存储层）
// ============================================================================

export class TeammateTool extends BaseTool<TeammateToolInput, ToolResult> {
  name = 'TeammateTool';
  description = `Manage teams and coordinate agents on your team. Use this tool to create and clean up teams.
To spawn new teammates, use the Task tool with \`team_name\` and \`name\` parameters.

## Operations

### spawnTeam - Create a Team
Create a new team to coordinate multiple agents working on a project.
Teams have a 1:1 correspondence with task lists (Team = TaskList).

### cleanup - Remove a Team
Remove team and task directories. Cleanup will fail if the team still has active members.
Gracefully shut down teammates first, then call cleanup after all teammates have closed.

## When to Use

Use this tool proactively whenever:
- The user explicitly asks to use a team, swarm, or group of agents
- The user mentions wanting agents to work together, coordinate, or collaborate
- A task is complex enough that it would benefit from parallel work by multiple agents

When in doubt about whether a task warrants a team, prefer spawning a team.

## Workflow
1. Create a team with \`spawnTeam\`
2. Create tasks using Task tool (they auto-use team's task list)
3. Spawn teammates using Task tool with \`team_name\` and \`name\` parameters
4. Assign tasks using TaskUpdate's \`owner\` parameter
5. Teammates work and mark tasks complete via TaskUpdate
6. Shutdown team via SendMessage (type: "shutdown_request") then cleanup`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['spawnTeam', 'cleanup'],
          description: 'The operation to perform',
        },
        team_name: {
          type: 'string',
          description: 'Name for the team (required for spawnTeam)',
        },
        description: {
          type: 'string',
          description: 'Description of the team purpose',
        },
      },
      required: ['operation'],
    };
  }

  async execute(input: TeammateToolInput): Promise<ToolResult> {
    if (!isAgentTeamsEnabled()) {
      return {
        success: false,
        error: t('agentTeams.notEnabled'),
      };
    }

    switch (input.operation) {
      case 'spawnTeam':
        return this.spawnTeam(input);
      case 'cleanup':
        return this.cleanup();
      default:
        return {
          success: false,
          error: t('agentTeams.unknownOperation', { operation: input.operation }),
        };
    }
  }

  private spawnTeam(input: TeammateToolInput): ToolResult {
    const teamName = input.team_name;
    if (!teamName) {
      return { success: false, error: t('agentTeams.teamNameRequired') };
    }

    // 检查团队是否已存在（使用统一存储层）
    const existing = getTeam(teamName);
    if (existing) {
      return {
        success: false,
        error: t('agentTeams.teamAlreadyExists', { teamName }),
      };
    }

    const leadId = getAgentId() || uuidv4();

    try {
      // 使用统一存储层创建团队
      const config = createTeam({
        teamName,
        description: input.description,
        leadAgentId: leadId,
        leadSessionId: uuidv4(),
      });

      // 设置动态 Team 上下文（AsyncLocalStorage）
      setDynamicTeamContext(createTeammateContext({
        agentId: leadId,
        agentName: 'team-lead',
        teamName,
        agentType: 'teammate',
        leadAgentId: leadId,
      }));

      return {
        success: true,
        output: t('agentTeams.createSuccess', { teamName, teamId: config.teamId, taskListId: config.taskListId }),
      };
    } catch (error) {
      return {
        success: false,
        error: t('agentTeams.createFailed', { error: error instanceof Error ? error.message : String(error) }),
      };
    }
  }

  private cleanup(): ToolResult {
    const teamName = getTeamName();
    if (!teamName) {
      return {
        success: false,
        error: t('agentTeams.noActiveTeam'),
      };
    }

    // 检查团队是否存在（使用统一存储层）
    const config = getTeam(teamName);
    if (!config) {
      return {
        success: false,
        error: t('agentTeams.teamNotFound', { teamName }),
      };
    }

    // 检查是否有活跃成员（除 lead 外）
    const activeMembers = getActiveMembers(teamName).filter(m => m.role === 'teammate');
    if (activeMembers.length > 0) {
      return {
        success: false,
        error: t('agentTeams.activeMembers', { teamName, count: activeMembers.length, names: activeMembers.map(m => m.name).join(', ') }),
      };
    }

    // 使用统一存储层删除团队
    const deleted = deleteTeam(teamName);
    if (!deleted) {
      return {
        success: false,
        error: t('agentTeams.cleanupFailed', { teamName }),
      };
    }

    // 清空动态上下文
    clearDynamicTeamContext();

    return {
      success: true,
      output: t('agentTeams.cleanupSuccess', { teamName }),
    };
  }
}
