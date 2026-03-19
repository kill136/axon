import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { AgentNetwork } from '../network/index.js';
import type { DiscoveredAgent } from '../network/types.js';

/**
 * NetworkTool 输入参数类型
 */
interface NetworkToolInput {
  action: 'discover' | 'send' | 'call_tool' | 'delegate' | 'audit_log' | 'trust' | 'status';
  agentId?: string;
  method?: string;
  params?: unknown;
  toolName?: string;
  toolInput?: unknown;
  description?: string;
  context?: string;
  attachments?: Array<{
    type: 'file' | 'error' | 'output';
    filename?: string;
    content?: string;
  }>;
  trust?: boolean;
  limit?: number;
  project?: string;
  capability?: string;
}

/**
 * AgentNetwork 工具 — 让 AI 在对话中与网络中的其他 Agent 通信和协作
 *
 * 功能:
 * - 发现网络中的 Agent
 * - 发送 RPC 消息 (ping, getIdentity, listTools, 等)
 * - 调用远程 Agent 的工具
 * - 委派任务给其他 Agent
 * - 查看通信审计日志
 * - 管理信任关系
 */
export class NetworkTool extends BaseTool<NetworkToolInput, ToolResult> {
  name = 'AgentNetwork';
  shouldDefer = true;
  searchHint = 'talk to other AI agents, discover agents, delegate task, remote tool call, agent collaboration';
  description = `与网络中的其他 AI Agent 通信和协作。发现 Agent、发送消息、调用远程工具、委派任务。

Supported actions:
- status: View network status (enabled, agentId, port, connected agents)
- discover: Discover agents on the network, optionally filter by project or capability
- send: Send RPC message to an agent (e.g. agent.ping, agent.getIdentity, agent.listTools)
- call_tool: Call a tool on a remote agent
- delegate: Delegate a task to another agent with description, context, and attachments
- audit_log: View recent communication log entries
- trust: Trust or untrust an agent

Examples:
  { "action": "status" }
  { "action": "discover" }
  { "action": "discover", "project": "my-project", "capability": "testing" }
  { "action": "send", "agentId": "abc123...", "method": "agent.ping" }
  { "action": "send", "agentId": "abc123...", "method": "agent.getIdentity" }
  { "action": "send", "agentId": "abc123...", "method": "agent.listTools" }
  { "action": "call_tool", "agentId": "abc123...", "toolName": "Bash", "toolInput": { "command": "ls" } }
  { "action": "delegate", "agentId": "abc123...", "description": "Run tests for module X", "context": "Recent changes in src/..." }
  { "action": "audit_log", "limit": 20 }
  { "action": "trust", "agentId": "abc123...", "trust": true }
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['discover', 'send', 'call_tool', 'delegate', 'audit_log', 'trust', 'status'],
          description: 'Action to perform',
        },
        agentId: {
          type: 'string',
          description: 'Target agent ID (for send, call_tool, delegate, trust)',
        },
        method: {
          type: 'string',
          description: 'RPC method (for send action, e.g. agent.ping, agent.getIdentity)',
        },
        params: {
          description: 'Parameters for the method/tool call',
        },
        toolName: {
          type: 'string',
          description: 'Tool name to call on remote agent (for call_tool action)',
        },
        toolInput: {
          description: 'Input for the remote tool (for call_tool action)',
        },
        description: {
          type: 'string',
          description: 'Task description (for delegate action)',
        },
        context: {
          type: 'string',
          description: 'Additional context (for delegate action)',
        },
        attachments: {
          type: 'array',
          description: 'File snippets or error logs to attach (for delegate action)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['file', 'error', 'output'] },
              filename: { type: 'string' },
              content: { type: 'string' },
            },
          },
        },
        trust: {
          type: 'boolean',
          description: 'true to trust, false to untrust (for trust action)',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return (for audit_log)',
        },
        project: {
          type: 'string',
          description: 'Filter by project name (for discover)',
        },
        capability: {
          type: 'string',
          description: 'Filter by capability (for discover)',
        },
      },
      required: ['action'],
    };
  }

  async execute(input: NetworkToolInput): Promise<ToolResult> {
    try {
      // 动态导入以避免循环依赖
      const { AgentNetwork } = await import('../network/index.js');
      const network = AgentNetwork.instance;
      if (!network) {
        return this.error('Agent Network is not enabled. Enable it in settings: network.enabled = true');
      }

      switch (input.action) {
        case 'status':
          return this.handleStatus(network);
        case 'discover':
          return this.handleDiscover(network, input);
        case 'send':
          return this.handleSend(network, input);
        case 'call_tool':
          return this.handleCallTool(network, input);
        case 'delegate':
          return this.handleDelegate(network, input);
        case 'audit_log':
          return this.handleAuditLog(network, input);
        case 'trust':
          return this.handleTrust(network, input);
        default:
          return this.error(`Unknown action: ${(input as any).action}`);
      }
    } catch (err: any) {
      return this.error(err.message ?? String(err));
    }
  }

  // ===== Action handlers =====

  private handleStatus(network: AgentNetwork): ToolResult {
    const status = network.getStatus();
    const identity = status.identity;
    const lines: string[] = [
      'Agent Network Status',
      '====================',
      `Enabled:    ${status.enabled}`,
      `Agent ID:   ${identity?.agentId ?? 'N/A'}`,
      `Name:       ${identity?.name ?? 'N/A'}`,
      `Port:       ${status.port}`,
      `Protocol:   ${identity?.protocolVersion ?? 'N/A'}`,
      `Version:    ${identity?.version ?? 'N/A'}`,
      `Uptime:     ${identity?.startedAt ? this.formatUptime(Date.now() - identity.startedAt) : 'N/A'}`,
      '',
      `Connected Agents: ${status.agents.filter((a: any) => a.online).length}`,
      `Total Discovered: ${status.agents.length}`,
    ];

    if (identity?.projects?.length) {
      lines.push('');
      lines.push('Projects:');
      for (const p of identity.projects) {
        lines.push(`  - ${p.name}${p.role ? ` (${p.role})` : ''}`);
      }
    }

    if (identity?.capabilities?.length) {
      lines.push('');
      lines.push(`Capabilities: ${identity.capabilities.join(', ')}`);
    }

    return this.success(lines.join('\n'));
  }

  private handleDiscover(network: AgentNetwork, input: NetworkToolInput): ToolResult {
    let agents: DiscoveredAgent[] = network.getDiscoveredAgents();

    // 按 project 过滤
    if (input.project) {
      const projectFilter = input.project.toLowerCase();
      agents = agents.filter((a) =>
        a.projects?.some((p: string) => p.toLowerCase().includes(projectFilter))
      );
    }

    // 按 capability 过滤
    if (input.capability) {
      const capFilter = input.capability.toLowerCase();
      agents = agents.filter((a) =>
        a.identity?.capabilities?.some((c: string) => c.toLowerCase().includes(capFilter))
      );
    }

    if (agents.length === 0) {
      let msg = 'No agents discovered on the network.';
      if (input.project || input.capability) {
        msg += ' (filters applied — try without filters to see all agents)';
      }
      return this.success(msg);
    }

    const lines: string[] = [`Discovered Agents (${agents.length})`, ''];

    for (const agent of agents) {
      const statusIcon = agent.online ? '[ONLINE]' : '[OFFLINE]';
      const trustTag = `[${agent.trustLevel}]`;
      lines.push(`${statusIcon} ${trustTag} ${agent.name}`);
      lines.push(`  Agent ID:  ${agent.agentId}`);
      lines.push(`  Endpoint:  ${agent.endpoint}`);
      if (agent.projects?.length) {
        lines.push(`  Projects:  ${agent.projects.join(', ')}`);
      }
      if (agent.identity?.capabilities?.length) {
        lines.push(`  Capabilities: ${agent.identity.capabilities.join(', ')}`);
      }
      lines.push(`  Last seen: ${this.formatTimestamp(agent.lastSeenAt)}`);
      lines.push('');
    }

    return this.success(lines.join('\n'));
  }

  private async handleSend(network: AgentNetwork, input: NetworkToolInput): Promise<ToolResult> {
    if (!input.agentId) return this.error('Missing parameter: agentId');
    if (!input.method) return this.error('Missing parameter: method');

    try {
      const result = await network.sendRequest(input.agentId, input.method, input.params);
      return this.success(
        `Response from ${input.agentId.slice(0, 8)}... (method: ${input.method}):\n\n` +
        this.formatResult(result)
      );
    } catch (err: any) {
      return this.error(`Send failed: ${err.message}`);
    }
  }

  private async handleCallTool(network: AgentNetwork, input: NetworkToolInput): Promise<ToolResult> {
    if (!input.agentId) return this.error('Missing parameter: agentId');
    if (!input.toolName) return this.error('Missing parameter: toolName');

    try {
      const result = await network.sendRequest(input.agentId, 'agent.callTool', {
        toolName: input.toolName,
        toolInput: input.toolInput ?? {},
      });

      const res = result as any;
      if (res?.error) {
        return this.error(`Remote tool error: ${res.error}`);
      }

      return this.success(
        `Remote tool "${input.toolName}" on ${input.agentId.slice(0, 8)}... completed:\n\n` +
        this.formatResult(res?.result ?? res)
      );
    } catch (err: any) {
      return this.error(`Remote tool call failed: ${err.message}`);
    }
  }

  private async handleDelegate(network: AgentNetwork, input: NetworkToolInput): Promise<ToolResult> {
    if (!input.agentId) return this.error('Missing parameter: agentId');
    if (!input.description) return this.error('Missing parameter: description');

    try {
      const result = await network.sendRequest(input.agentId, 'agent.delegateTask', {
        description: input.description,
        context: input.context,
        attachments: input.attachments,
      }, undefined, AgentNetwork.LONG_TASK_TIMEOUT);

      const res = result as any;

      const lines: string[] = [
        `Task delegated to ${input.agentId.slice(0, 8)}...`,
        '',
        `Task ID:     ${res?.taskId ?? 'N/A'}`,
        `Status:      ${res?.status ?? 'N/A'}`,
        `Description: ${input.description}`,
      ];

      if (res?.message) {
        lines.push('');
        lines.push(`Message: ${res.message}`);
      }

      if (res?.error) {
        lines.push('');
        lines.push(`Error: ${res.error}`);
      }

      return this.success(lines.join('\n'));
    } catch (err: any) {
      return this.error(`Delegate failed: ${err.message}`);
    }
  }

  private handleAuditLog(network: AgentNetwork, input: NetworkToolInput): ToolResult {
    const limit = input.limit ?? 20;
    const entries = network.getAuditLog({ limit });

    if (!entries || entries.length === 0) {
      return this.success('No audit log entries found.');
    }

    const lines: string[] = [`Audit Log (last ${entries.length} entries)`, ''];

    for (const entry of entries) {
      const dir = entry.direction === 'inbound' ? '<-' : '->';
      const time = this.formatTimestamp(entry.timestamp);
      const status = entry.success ? 'OK' : 'FAIL';
      lines.push(
        `[${time}] ${dir} [${status}] ${entry.method} | ${entry.fromName} -> ${entry.toName}`
      );
      if (entry.summary && entry.summary !== `Request: ${entry.method}`) {
        lines.push(`  ${entry.summary}`);
      }
      if (entry.error) {
        lines.push(`  Error: ${entry.error}`);
      }
    }

    return this.success(lines.join('\n'));
  }

  private handleTrust(network: AgentNetwork, input: NetworkToolInput): ToolResult {
    if (!input.agentId) return this.error('Missing parameter: agentId');
    if (input.trust === undefined) return this.error('Missing parameter: trust (true or false)');

    if (input.trust) {
      network.trustAgent(input.agentId);
      return this.success(`Agent ${input.agentId.slice(0, 8)}... is now trusted.`);
    } else {
      network.untrustAgent(input.agentId);
      return this.success(`Agent ${input.agentId.slice(0, 8)}... is now untrusted.`);
    }
  }

  // ===== Formatting helpers =====

  private formatResult(result: unknown): string {
    if (result === null || result === undefined) return '(empty response)';
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  private formatTimestamp(ts: number): string {
    if (!ts) return 'N/A';
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
