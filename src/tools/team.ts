/**
 * Agent Teams 工具
 * 官方 v2.1.33 团队协作系统核心工具
 *
 * 包含 3 个工具：
 * - TeamCreate: 创建新团队
 * - TeamDelete: 清理团队资源
 * - SendMessage: 团队内通信
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import {
  createTeam,
  getTeam,
  deleteTeam,
  getActiveMembers,
  updateMemberStatus,
  sendToMailbox,
  broadcastToTeam,
  isInTeamMode,
  getTeamContext,
  setTeamContext,
  generateMessageId,
} from '../teams/storage.js';
import { isAgentTeamsEnabled } from '../agents/teammate-context.js';
import {
  createTmuxBackend,
  destroyTmuxBackend,
  isTmuxAvailable,
  isInsideTmux,
} from '../teams/tmux.js';
import type {
  TeamCreateInput,
  SendMessageInput,
  DirectMessage,
  BroadcastMessage,
  ShutdownRequest,
  ShutdownResponse,
  PlanApprovalResponse,
  TeamContext,
} from '../teams/types.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TeamCreate 工具
// ============================================================================

const TEAM_CREATE_DESCRIPTION = `Create a new team for coordinating multiple agents.

Use this tool to create a team that can:
- Coordinate multiple agent teammates via tmux sessions
- Share tasks and communicate via messages
- Work in parallel on different parts of a project

The team lead (you) will manage task assignment and coordination.
Team members communicate via the SendMessage tool.`;

export class TeamCreateTool extends BaseTool<TeamCreateInput, ToolResult> {
  name = 'TeamCreate';
  description = TEAM_CREATE_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        team_name: {
          type: 'string',
          description: 'Name for the new team to create.',
        },
        description: {
          type: 'string',
          description: 'Team description/purpose.',
        },
        agent_type: {
          type: 'string',
          description: 'Type/role of the team lead (e.g., "researcher", "test-runner"). Used for team file and inter-agent coordination.',
        },
      },
      required: ['team_name'],
    };
  }

  async execute(input: TeamCreateInput): Promise<ToolResult> {
    // 检查 agent teams 是否启用
    if (!isAgentTeamsEnabled()) {
      return {
        success: false,
        error: 'Agent Teams feature is not enabled. Set CLAUDE_CODE_ENABLE_AGENT_TEAMS=true to enable.',
      };
    }

    // 检查是否已在团队中
    if (isInTeamMode()) {
      return {
        success: false,
        error: 'Already in a team. Use TeamDelete to clean up the current team first.',
      };
    }

    const { team_name, description, agent_type } = input;

    try {
      // 创建团队
      const config = createTeam({
        teamName: team_name,
        description,
        agentType: agent_type,
        leadAgentId: uuidv4(),
        leadSessionId: uuidv4(),
      });

      // 设置团队上下文
      const context: TeamContext = {
        teamName: team_name,
        agentName: 'team-lead',
        role: 'lead',
        config,
      };
      setTeamContext(context);

      // 如果 tmux 可用，创建 tmux backend
      let tmuxInfo = '';
      if (isTmuxAvailable()) {
        try {
          const backend = createTmuxBackend(`claude-team-${team_name}`);
          if (isInsideTmux()) {
            await backend.createInternalSwarmSession();
            tmuxInfo = '\nTmux: Using current session for teammate panes.';
          } else {
            await backend.createExternalSwarmSession();
            tmuxInfo = `\nTmux: Created session "claude-team-${team_name}" for teammate panes.`;
          }
        } catch (e) {
          tmuxInfo = `\nTmux: Warning - Could not initialize tmux backend: ${e}`;
        }
      }

      const output = [
        `Team "${team_name}" created successfully.`,
        `Team ID: ${config.teamId}`,
        `Task List: ${config.taskListId}`,
        description ? `Description: ${description}` : '',
        `Role: team-lead`,
        tmuxInfo,
        '',
        'Next steps:',
        '1. Use TaskCreate to create tasks for the team',
        '2. Use Task tool to spawn teammate agents',
        '3. Use SendMessage to communicate with teammates',
        '4. Use TaskUpdate to track task progress',
        '5. Use TeamDelete when done',
      ].filter(Boolean).join('\n');

      return {
        success: true,
        output,
        data: {
          teamName: team_name,
          teamId: config.teamId,
          taskListId: config.taskListId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create team: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

// ============================================================================
// TeamDelete 工具
// ============================================================================

const TEAM_DELETE_DESCRIPTION = `Clean up team and task directories when the swarm is complete.

Use this after all teammates have finished their work or responded to shutdown requests.
This will:
- Remove the team configuration
- Clean up mailbox directories
- Destroy tmux sessions for teammates`;

export class TeamDeleteTool extends BaseTool<Record<string, never>, ToolResult> {
  name = 'TeamDelete';
  description = TEAM_DELETE_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  async execute(): Promise<ToolResult> {
    // 检查 agent teams 是否启用
    if (!isAgentTeamsEnabled()) {
      return {
        success: false,
        error: 'Agent Teams feature is not enabled.',
      };
    }

    // 获取当前团队上下文
    const context = getTeamContext();
    if (!context) {
      return {
        success: false,
        error: 'Not in a team. Nothing to delete.',
      };
    }

    const teamName = context.teamName;

    // 检查是否有活跃成员（除了 team-lead）
    const activeMembers = getActiveMembers(teamName);
    const activeTeammates = activeMembers.filter(m => m.role === 'teammate');

    if (activeTeammates.length > 0) {
      return {
        success: false,
        error: `Team still has ${activeTeammates.length} active teammate(s): ${activeTeammates.map(m => m.name).join(', ')}. Send shutdown_request to all teammates first, then wait for them to finish.`,
      };
    }

    try {
      // 销毁 tmux backend
      await destroyTmuxBackend();

      // 删除团队文件
      deleteTeam(teamName);

      // 清除团队上下文
      setTeamContext(null);

      return {
        success: true,
        output: `Team "${teamName}" has been deleted. All team resources cleaned up.`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete team: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

// ============================================================================
// SendMessage 工具
// ============================================================================

const SEND_MESSAGE_DESCRIPTION = `Send messages between team members for coordination.

Message types:
- "message": Send a direct message to a specific teammate
- "broadcast": Send a message to all teammates
- "shutdown_request": Request a teammate to shut down
- "shutdown_response": Respond to a shutdown request (approve/deny)
- "plan_approval_response": Approve or reject a teammate's plan

Required fields per type:
- message: type, recipient, content, summary
- broadcast: type, content, summary
- shutdown_request: type, recipient (content optional)
- shutdown_response: type, request_id, approve (content optional)
- plan_approval_response: type, request_id, recipient, approve (content optional)`;

export class TeamSendMessageTool extends BaseTool<SendMessageInput, ToolResult> {
  name = 'SendMessage';
  description = SEND_MESSAGE_DESCRIPTION;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['message', 'broadcast', 'shutdown_request', 'shutdown_response', 'plan_approval_response'],
          description: 'Message type: "message" for DMs, "broadcast" to all teammates, "shutdown_request" to request shutdown, "shutdown_response" to respond to shutdown, "plan_approval_response" to approve/reject plans',
        },
        recipient: {
          type: 'string',
          description: 'Agent name of the recipient (required for message, shutdown_request, plan_approval_response)',
        },
        content: {
          type: 'string',
          description: 'Message text, reason, or feedback',
        },
        summary: {
          type: 'string',
          description: 'A 5-10 word summary of the message, shown as a preview in the UI (required for message, broadcast)',
        },
        request_id: {
          type: 'string',
          description: 'Request ID to respond to (required for shutdown_response, plan_approval_response)',
        },
        approve: {
          type: 'boolean',
          description: 'Whether to approve the request (required for shutdown_response, plan_approval_response)',
        },
      },
      required: ['type'],
    };
  }

  async execute(input: SendMessageInput): Promise<ToolResult> {
    // 检查 agent teams 是否启用
    if (!isAgentTeamsEnabled()) {
      return {
        success: false,
        error: 'Agent Teams feature is not enabled.',
      };
    }

    // 获取当前团队上下文
    const context = getTeamContext();
    if (!context) {
      return {
        success: false,
        error: 'Not in a team. Create a team first with TeamCreate.',
      };
    }

    const { type } = input;
    const teamName = context.teamName;
    const senderName = context.agentName;

    switch (type) {
      case 'message':
        return this.handleDirectMessage(teamName, senderName, input);

      case 'broadcast':
        return this.handleBroadcast(teamName, senderName, input);

      case 'shutdown_request':
        return this.handleShutdownRequest(teamName, senderName, input);

      case 'shutdown_response':
        return this.handleShutdownResponse(teamName, senderName, input);

      case 'plan_approval_response':
        return this.handlePlanApprovalResponse(teamName, senderName, input);

      default:
        return {
          success: false,
          error: `Unknown message type: "${type}". Valid types: message, broadcast, shutdown_request, shutdown_response, plan_approval_response`,
        };
    }
  }

  /**
   * 处理点对点消息
   */
  private handleDirectMessage(
    teamName: string,
    senderName: string,
    input: SendMessageInput,
  ): ToolResult {
    if (!input.recipient) {
      return { success: false, error: 'recipient is required for message type' };
    }
    if (!input.content) {
      return { success: false, error: 'content is required for message type' };
    }
    if (!input.summary) {
      return { success: false, error: 'summary is required for message type' };
    }

    // 验证收件人存在
    const team = getTeam(teamName);
    if (!team) {
      return { success: false, error: `Team "${teamName}" not found` };
    }
    const recipientMember = team.members.find(m => m.name === input.recipient);
    if (!recipientMember) {
      return {
        success: false,
        error: `Recipient "${input.recipient}" not found in team. Members: ${team.members.map(m => m.name).join(', ')}`,
      };
    }

    const message: DirectMessage = {
      id: generateMessageId(),
      type: 'message',
      from: senderName,
      recipient: input.recipient,
      content: input.content,
      summary: input.summary,
      timestamp: Date.now(),
    };

    sendToMailbox(teamName, input.recipient, message);

    return {
      success: true,
      output: `Message sent to ${input.recipient}: "${input.summary}"`,
    };
  }

  /**
   * 处理广播消息
   */
  private handleBroadcast(
    teamName: string,
    senderName: string,
    input: SendMessageInput,
  ): ToolResult {
    if (!input.content) {
      return { success: false, error: 'content is required for broadcast type' };
    }
    if (!input.summary) {
      return { success: false, error: 'summary is required for broadcast type' };
    }

    const message: BroadcastMessage = {
      id: generateMessageId(),
      type: 'broadcast',
      from: senderName,
      content: input.content,
      summary: input.summary,
      timestamp: Date.now(),
    };

    const count = broadcastToTeam(teamName, senderName, message);

    return {
      success: true,
      output: `Broadcast sent to ${count} teammate(s): "${input.summary}"`,
    };
  }

  /**
   * 处理关闭请求
   */
  private handleShutdownRequest(
    teamName: string,
    senderName: string,
    input: SendMessageInput,
  ): ToolResult {
    if (!input.recipient) {
      return { success: false, error: 'recipient is required for shutdown_request type' };
    }

    const message: ShutdownRequest = {
      id: generateMessageId(),
      type: 'shutdown_request',
      from: senderName,
      recipient: input.recipient,
      content: input.content,
      timestamp: Date.now(),
    };

    sendToMailbox(teamName, input.recipient, message);

    return {
      success: true,
      output: `Shutdown request sent to ${input.recipient}`,
    };
  }

  /**
   * 处理关闭响应
   */
  private handleShutdownResponse(
    teamName: string,
    senderName: string,
    input: SendMessageInput,
  ): ToolResult {
    if (!input.request_id) {
      return { success: false, error: 'request_id is required for shutdown_response type' };
    }
    if (input.approve === undefined) {
      return { success: false, error: 'approve is required for shutdown_response type' };
    }

    const message: ShutdownResponse = {
      id: generateMessageId(),
      type: 'shutdown_response',
      from: senderName,
      requestId: input.request_id,
      approve: input.approve,
      content: input.content,
      timestamp: Date.now(),
    };

    // 发送给 team-lead（关闭响应通常回复给 lead）
    sendToMailbox(teamName, 'team-lead', message);

    // 如果批准关闭，标记自己为不活跃
    if (input.approve) {
      updateMemberStatus(teamName, senderName, false);
    }

    return {
      success: true,
      output: input.approve
        ? `Shutdown approved. Agent "${senderName}" is shutting down.`
        : `Shutdown denied by ${senderName}.`,
    };
  }

  /**
   * 处理计划批准响应
   */
  private handlePlanApprovalResponse(
    teamName: string,
    senderName: string,
    input: SendMessageInput,
  ): ToolResult {
    if (!input.request_id) {
      return { success: false, error: 'request_id is required for plan_approval_response type' };
    }
    if (!input.recipient) {
      return { success: false, error: 'recipient is required for plan_approval_response type' };
    }
    if (input.approve === undefined) {
      return { success: false, error: 'approve is required for plan_approval_response type' };
    }

    const message: PlanApprovalResponse = {
      id: generateMessageId(),
      type: 'plan_approval_response',
      from: senderName,
      requestId: input.request_id,
      recipient: input.recipient,
      approve: input.approve,
      content: input.content,
      timestamp: Date.now(),
    };

    sendToMailbox(teamName, input.recipient, message);

    return {
      success: true,
      output: input.approve
        ? `Plan approved for ${input.recipient}`
        : `Plan rejected for ${input.recipient}: ${input.content || 'No reason given'}`,
    };
  }
}
