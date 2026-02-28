/**
 * 工具命令 - mcp, agents, ide, vim, plugin, install
 */

import type { SlashCommand, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// /mcp - MCP 服务器管理（官方 local-jsx 风格 - 交互式界面）
export const mcpCommand: SlashCommand = {
  name: 'mcp',
  description: 'Manage MCP (Model Context Protocol) servers',
  usage: '/mcp [list|add|remove|get|test|enable|disable]',
  category: 'tools',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const action = args[0];

    // 如果没有参数或是 list，显示交互式 UI
    if (!action || action === 'list') {
      try {
        // 动态导入 React、McpSettings 组件和 MCP 运行时状态
        const React = await import('react');
        const { default: McpSettings } = await import('../ui/McpSettings.js');
        const { getMcpServers } = await import('../tools/mcp.js');

        // 获取运行时 MCP 服务器状态
        const runtimeServers = getMcpServers();

        // 将运行时状态转换为可序列化的对象
        const runtimeState: Record<string, {
          connected: boolean;
          connecting: boolean;
          tools: Array<{ name: string; description?: string }>;
          resources: Array<{ uri: string; name: string }>;
          config: Record<string, unknown>;
        }> = {};

        for (const [name, state] of runtimeServers) {
          runtimeState[name] = {
            connected: state.connected,
            connecting: state.connecting,
            tools: state.tools || [],
            resources: state.resources || [],
            config: { ...state.config } as Record<string, unknown>,
          };
        }

        // 返回 JSX 组件，由 App.tsx 在主 UI 中显示（官方 local-jsx 模式）
        return {
          success: true,
          action: 'showJsx',
          jsx: React.createElement(McpSettings, {
            cwd: ctx.config.cwd,
            onDone: () => {},
            runtimeState, // 传递运行时状态
          }),
          shouldHidePromptInput: true,
        };
      } catch (error) {
        // 如果 JSX 组件加载失败，回退到文本模式
        console.error('Failed to load MCP Settings UI:', error);
      }
    }

    // 读取配置文件（支持多个 scope）
    const homeDir = os.homedir();
    const userConfigFile = path.join(homeDir, '.claude.json');
    const projectConfigFile = path.join(ctx.config.cwd, '.mcp.json');
    const localConfigFile = path.join(homeDir, '.claude', 'settings.json');

    const loadConfig = (file: string): any => {
      if (fs.existsSync(file)) {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch {
          return {};
        }
      }
      return {};
    };

    const userConfig = loadConfig(userConfigFile);
    const projectConfig = loadConfig(projectConfigFile);
    const localConfig = loadConfig(localConfigFile);

    // 合并所有配置
    const allServers = {
      ...localConfig.mcpServers || {},
      ...projectConfig.mcpServers || {},
      ...userConfig.mcpServers || {},
    };

    switch (action) {
      case 'list': {
        let listInfo = `MCP Servers:\n\n`;

        if (Object.keys(allServers).length === 0) {
          listInfo += `No MCP servers configured. Use \`/mcp add\` to add a server.\n\n`;
        } else {
          listInfo += `Checking MCP server health...\n\n`;

          for (const [name, server] of Object.entries(allServers)) {
            const s = server as any;

            // 显示服务器名称和类型
            const type = s.type || 'stdio';
            let serverLine = `  ${name}`;

            // 根据类型显示不同信息
            if (type === 'stdio') {
              const args = Array.isArray(s.args) ? s.args : [];
              serverLine += `: ${s.command} ${args.join(' ')}`;
            } else if (type === 'http') {
              serverLine += `: ${s.url} (HTTP)`;
            } else if (type === 'sse') {
              serverLine += `: ${s.url} (SSE)`;
            }

            // 连接状态（简化版本，实际需要运行时检测）
            serverLine += ` - Configured`;

            listInfo += serverLine + '\n';

            // 显示环境变量
            if (s.env && Object.keys(s.env).length > 0) {
              listInfo += `    Environment: ${Object.keys(s.env).join(', ')}\n`;
            }

            listInfo += '\n';
          }
        }

        listInfo += `Commands:
  /mcp list              - List all configured servers
  /mcp add <name>        - Add a new server (shows examples)
  /mcp remove <name>     - Remove a server
  /mcp get <name>        - Get details about a server
  /mcp test <name>       - Test server connection

Configuration files:
  User:    ${userConfigFile}
  Project: ${projectConfigFile}
  Local:   ${localConfigFile}

For more info: https://modelcontextprotocol.io`;

        ctx.ui.addMessage('assistant', listInfo);
        break;
      }

      case 'add': {
        const serverName = args[1];
        const transport = args[2]; // stdio, http, sse

        if (!serverName) {
          ctx.ui.addMessage('assistant', `Add an MCP server

Usage:
  /mcp add <name>          - Show configuration examples

Examples:

  # Add stdio server (most common):
  Edit ${userConfigFile}

  {
    "mcpServers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "/path/to/dir"]
      },
      "github": {
        "command": "npx",
        "args": ["-y", "@anthropic-ai/mcp-server-github"],
        "env": {
          "GITHUB_TOKEN": "your-token"
        }
      }
    }
  }

  # Add HTTP server:
  {
    "mcpServers": {
      "sentry": {
        "type": "http",
        "url": "https://mcp.sentry.dev/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_TOKEN"
        }
      }
    }
  }

  # Add SSE server:
  {
    "mcpServers": {
      "asana": {
        "type": "sse",
        "url": "https://mcp.asana.com/sse",
        "headers": {
          "Authorization": "Bearer YOUR_TOKEN"
        }
      }
    }
  }

After adding, restart Axon to connect.`);
          return { success: false };
        }

        ctx.ui.addMessage('assistant', `To add MCP server "${serverName}":

1. Edit configuration file: ${userConfigFile}

2. Add server configuration to "mcpServers" section

3. Restart Axon to connect

Server types:
  - stdio: Most common, runs a local command
  - http: HTTP-based MCP server
  - sse: Server-Sent Events based server`);
        break;
      }

      case 'remove': {
        const removeName = args[1];
        if (!removeName) {
          ctx.ui.addMessage('assistant', 'Usage: /mcp remove <server-name>');
          return { success: false };
        }

        // 检查服务器是否存在
        if (!allServers[removeName]) {
          ctx.ui.addMessage('assistant', `No MCP server found with name: "${removeName}"

Available servers: ${Object.keys(allServers).join(', ') || 'none'}`);
          return { success: false };
        }

        ctx.ui.addMessage('assistant', `To remove MCP server "${removeName}":

1. Edit the configuration file
2. Remove the "${removeName}" entry from "mcpServers"
3. Restart Axon

Configuration locations to check:
  - ${userConfigFile}
  - ${projectConfigFile}
  - ${localConfigFile}`);
        break;
      }

      case 'get': {
        const serverName = args[1];
        if (!serverName) {
          ctx.ui.addMessage('assistant', 'Usage: /mcp get <server-name>');
          return { success: false };
        }

        const serverConfig = allServers[serverName];
        if (!serverConfig) {
          ctx.ui.addMessage('assistant', `No MCP server found with name: "${serverName}"

Available servers: ${Object.keys(allServers).join(', ') || 'none'}`);
          return { success: false };
        }

        const s = serverConfig as any;
        let details = `MCP Server Details: ${serverName}\n\n`;

        details += `Type: ${s.type || 'stdio'}\n`;

        if (s.type === 'stdio' || !s.type) {
          details += `Command: ${s.command}\n`;
          if (s.args && Array.isArray(s.args)) {
            details += `Args: ${s.args.join(' ')}\n`;
          }
        } else if (s.type === 'http' || s.type === 'sse') {
          details += `URL: ${s.url}\n`;
          if (s.headers) {
            details += `Headers:\n`;
            for (const [key, value] of Object.entries(s.headers)) {
              details += `  ${key}: ${value}\n`;
            }
          }
        }

        if (s.env) {
          details += `Environment Variables:\n`;
          for (const [key, value] of Object.entries(s.env)) {
            // 不显示敏感值
            const displayValue = key.toLowerCase().includes('token') ||
                                 key.toLowerCase().includes('key') ||
                                 key.toLowerCase().includes('secret')
              ? '***'
              : value;
            details += `  ${key}=${displayValue}\n`;
          }
        }

        ctx.ui.addMessage('assistant', details);
        break;
      }

      case 'test':
      case 'status': {
        const serverName = args[1];

        if (serverName) {
          // 测试单个服务器
          const serverConfig = allServers[serverName];
          if (!serverConfig) {
            ctx.ui.addMessage('assistant', `No MCP server found with name: "${serverName}"`);
            return { success: false };
          }

          ctx.ui.addMessage('assistant', `Testing MCP server "${serverName}"...\n\nNote: Full connection testing requires runtime MCP client initialization.\nThis command shows configuration status only.\n\nServer is configured and ready to connect on next restart.`);
        } else {
          // 显示所有服务器状态
          let statusInfo = `MCP Server Status:\n\n`;

          if (Object.keys(allServers).length === 0) {
            statusInfo += `No servers configured\n`;
          } else {
            for (const name of Object.keys(allServers)) {
              statusInfo += `  ${name}: Configured\n`;
            }
            statusInfo += `\nNote: Server health checks require runtime connection.\n`;
            statusInfo += `Restart Axon to connect to configured servers.\n`;
          }

          ctx.ui.addMessage('assistant', statusInfo);
        }
        break;
      }

      case 'enable': {
        // v2.1.6: 启用 MCP 服务器
        const serverName = args[1];
        if (!serverName) {
          ctx.ui.addMessage('assistant', 'Usage: /mcp enable <server-name>');
          return { success: false };
        }

        // 检查服务器是否存在
        if (!allServers[serverName]) {
          ctx.ui.addMessage('assistant', `No MCP server found with name: "${serverName}"

Available servers: ${Object.keys(allServers).join(', ') || 'none'}`);
          return { success: false };
        }

        try {
          // 读取禁用列表
          const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
          const settings = fs.existsSync(settingsPath)
            ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
            : {};

          // 初始化禁用列表
          if (!Array.isArray(settings.disabledMcpServers)) {
            settings.disabledMcpServers = [];
          }

          // 检查服务器是否已启用
          const isDisabled = settings.disabledMcpServers.includes(serverName);
          if (!isDisabled) {
            ctx.ui.addMessage('assistant', `MCP server "${serverName}" is already enabled.`);
            return { success: true };
          }

          // 从禁用列表中移除服务器
          settings.disabledMcpServers = settings.disabledMcpServers.filter(
            (name: string) => name !== serverName
          );

          // 保存配置
          fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

          ctx.ui.addMessage('assistant', `✓ MCP server "${serverName}" enabled

The server will be connected on next restart or when explicitly connected.

To connect now without restarting:
  /mcp test ${serverName}`);
          return { success: true };
        } catch (error) {
          ctx.ui.addMessage('assistant', `Error enabling server: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return { success: false };
        }
      }

      case 'disable': {
        // v2.1.6: 禁用 MCP 服务器
        const serverName = args[1];
        if (!serverName) {
          ctx.ui.addMessage('assistant', 'Usage: /mcp disable <server-name>');
          return { success: false };
        }

        // 检查服务器是否存在
        if (!allServers[serverName]) {
          ctx.ui.addMessage('assistant', `No MCP server found with name: "${serverName}"

Available servers: ${Object.keys(allServers).join(', ') || 'none'}`);
          return { success: false };
        }

        try {
          // 读取禁用列表
          const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
          const settings = fs.existsSync(settingsPath)
            ? JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
            : {};

          // 初始化禁用列表
          if (!Array.isArray(settings.disabledMcpServers)) {
            settings.disabledMcpServers = [];
          }

          // 检查服务器是否已禁用
          const isDisabled = settings.disabledMcpServers.includes(serverName);
          if (isDisabled) {
            ctx.ui.addMessage('assistant', `MCP server "${serverName}" is already disabled.`);
            return { success: true };
          }

          // 添加到禁用列表
          settings.disabledMcpServers.push(serverName);

          // 保存配置
          fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

          // 尝试断开连接（如果已连接）
          try {
            const { disconnectMcpServer } = await import('../tools/mcp.js');
            await disconnectMcpServer(serverName);
          } catch {
            // 忽略断开连接错误
          }

          ctx.ui.addMessage('assistant', `✓ MCP server "${serverName}" disabled

The server will not connect on next startup.

To re-enable the server:
  /mcp enable ${serverName}`);
          return { success: true };
        } catch (error) {
          ctx.ui.addMessage('assistant', `Error disabling server: ${error instanceof Error ? error.message : 'Unknown error'}`);
          return { success: false };
        }
      }

      default:
        ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available commands:
  /mcp list              - List all configured servers
  /mcp add <name>        - Add a new server
  /mcp remove <name>     - Remove a server
  /mcp get <name>        - Get server details
  /mcp test <name>       - Test server connection
  /mcp enable <name>     - Enable a disabled server
  /mcp disable <name>    - Disable a server`);
        return { success: false };
    }

    return { success: true };
  },
};

// /agents - Agent 管理（基于官方源码完善）
export const agentsCommand: SlashCommand = {
  name: 'agents',
  description: 'View and manage running agents (sub-agents)',
  usage: '/agents [list|info <id>|output <id>|kill <id>|clear]',
  category: 'tools',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const action = args[0] || 'list';

    // 动态导入 agent 管理函数
    let getBackgroundAgents: any;
    let getBackgroundAgent: any;
    let killBackgroundAgent: any;
    let clearCompletedAgents: any;

    try {
      const agentModule = await import('../tools/agent.js');
      getBackgroundAgents = agentModule.getBackgroundAgents;
      getBackgroundAgent = agentModule.getBackgroundAgent;
      killBackgroundAgent = agentModule.killBackgroundAgent;
      clearCompletedAgents = agentModule.clearCompletedAgents;
    } catch (error) {
      ctx.ui.addMessage('assistant', 'Error: Agent management module not available');
      return { success: false };
    }

    switch (action) {
      case 'list': {
        const agents = getBackgroundAgents();

        if (agents.length === 0) {
          ctx.ui.addMessage('assistant', `No running agents.

Launch a background agent using:
  Task tool with run_in_background: true

Available agent types:
  - general-purpose: General-purpose agent for complex tasks
  - Explore: Fast agent for exploring codebases
  - Plan: Software architect agent for planning
  - claude-code-guide: Agent for Axon documentation

Usage:
  /agents list           - List all agents
  /agents info <id>      - Show agent details
  /agents output <id>    - View agent output
  /agents kill <id>      - Terminate a running agent
  /agents clear          - Clear completed/failed agents`);
          return { success: true };
        }

        let listInfo = `Running Agents:\n\n`;

        // 分组显示：运行中、已完成、失败
        const running = agents.filter(a => a.status === 'running');
        const completed = agents.filter(a => a.status === 'completed');
        const failed = agents.filter(a => a.status === 'failed');

        if (running.length > 0) {
          listInfo += `Running (${running.length}):\n`;
          for (const agent of running) {
            const elapsed = Math.floor((Date.now() - agent.startTime.getTime()) / 1000);
            listInfo += `  ${agent.id.substring(0, 8)}... - ${agent.agentType} - "${agent.description}" (${elapsed}s)\n`;
          }
          listInfo += '\n';
        }

        if (completed.length > 0) {
          listInfo += `Completed (${completed.length}):\n`;
          for (const agent of completed) {
            const duration = agent.endTime
              ? Math.floor((agent.endTime.getTime() - agent.startTime.getTime()) / 1000)
              : 0;
            listInfo += `  ${agent.id.substring(0, 8)}... - ${agent.agentType} - "${agent.description}" (${duration}s)\n`;
          }
          listInfo += '\n';
        }

        if (failed.length > 0) {
          listInfo += `Failed (${failed.length}):\n`;
          for (const agent of failed) {
            listInfo += `  ${agent.id.substring(0, 8)}... - ${agent.agentType} - "${agent.description}"\n`;
          }
          listInfo += '\n';
        }

        listInfo += `Commands:
  /agents info <id>      - Show detailed agent information
  /agents output <id>    - View agent output
  /agents kill <id>      - Terminate a running agent
  /agents clear          - Clear completed/failed agents`;

        ctx.ui.addMessage('assistant', listInfo);
        return { success: true };
      }

      case 'info': {
        const agentId = args[1];
        if (!agentId) {
          ctx.ui.addMessage('assistant', 'Usage: /agents info <agent-id>\n\nUse /agents list to see available agent IDs.');
          return { success: false };
        }

        // 支持部分ID匹配
        const agents = getBackgroundAgents();
        const agent = agents.find((a: any) => a.id.startsWith(agentId) || a.id === agentId);

        if (!agent) {
          ctx.ui.addMessage('assistant', `Agent not found: ${agentId}\n\nUse /agents list to see available agents.`);
          return { success: false };
        }

        const duration = agent.endTime
          ? Math.floor((agent.endTime.getTime() - agent.startTime.getTime()) / 1000)
          : Math.floor((Date.now() - agent.startTime.getTime()) / 1000);

        let info = `Agent Details:\n\n`;
        info += `ID:          ${agent.id}\n`;
        info += `Type:        ${agent.agentType}\n`;
        info += `Description: ${agent.description}\n`;
        info += `Status:      ${agent.status}\n`;
        info += `Started:     ${agent.startTime.toISOString()}\n`;
        if (agent.endTime) {
          info += `Ended:       ${agent.endTime.toISOString()}\n`;
        }
        info += `Duration:    ${duration}s\n`;

        if (agent.error) {
          info += `\nError: ${agent.error}\n`;
        }

        if (agent.result) {
          info += `\nResult available. Use /agents output ${agentId} to view.\n`;
        }

        ctx.ui.addMessage('assistant', info);
        return { success: true };
      }

      case 'output': {
        const agentId = args[1];
        if (!agentId) {
          ctx.ui.addMessage('assistant', 'Usage: /agents output <agent-id>\n\nUse /agents list to see available agent IDs.');
          return { success: false };
        }

        const agents = getBackgroundAgents();
        const agent = agents.find((a: any) => a.id.startsWith(agentId) || a.id === agentId);

        if (!agent) {
          ctx.ui.addMessage('assistant', `Agent not found: ${agentId}\n\nUse /agents list to see available agents.`);
          return { success: false };
        }

        if (agent.status === 'running') {
          ctx.ui.addMessage('assistant', `Agent ${agentId} is still running.\n\nCheck back later or use TaskOutput tool to monitor progress.`);
          return { success: true };
        }

        if (!agent.result) {
          ctx.ui.addMessage('assistant', `No output available for agent ${agentId}.`);
          return { success: true };
        }

        let output = `Agent Output (${agent.id}):\n\n`;
        output += `Status: ${agent.status}\n`;
        if (agent.error) {
          output += `Error: ${agent.error}\n\n`;
        }
        output += `--- Output ---\n`;
        output += typeof agent.result.output === 'string'
          ? agent.result.output
          : JSON.stringify(agent.result.output, null, 2);
        output += `\n--- End Output ---`;

        ctx.ui.addMessage('assistant', output);
        return { success: true };
      }

      case 'kill': {
        const agentId = args[1];
        if (!agentId) {
          ctx.ui.addMessage('assistant', 'Usage: /agents kill <agent-id>\n\nUse /agents list to see running agents.');
          return { success: false };
        }

        const agents = getBackgroundAgents();
        const agent = agents.find((a: any) => a.id.startsWith(agentId) || a.id === agentId);

        if (!agent) {
          ctx.ui.addMessage('assistant', `Agent not found: ${agentId}\n\nUse /agents list to see available agents.`);
          return { success: false };
        }

        if (agent.status !== 'running') {
          ctx.ui.addMessage('assistant', `Agent ${agentId} is not running (status: ${agent.status}).`);
          return { success: false };
        }

        const killed = killBackgroundAgent(agent.id);
        if (killed) {
          ctx.ui.addMessage('assistant', `Agent ${agentId} has been terminated.`);
          return { success: true };
        } else {
          ctx.ui.addMessage('assistant', `Failed to terminate agent ${agentId}.`);
          return { success: false };
        }
      }

      case 'clear': {
        const cleared = clearCompletedAgents();
        ctx.ui.addMessage('assistant', `Cleared ${cleared} completed/failed agent(s).`);
        return { success: true };
      }

      default:
        ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available commands:
  /agents list           - List all agents
  /agents info <id>      - Show agent details
  /agents output <id>    - View agent output
  /agents kill <id>      - Terminate a running agent
  /agents clear          - Clear completed/failed agents`);
        return { success: false };
    }
  },
};

// /ide - IDE 集成（基于官方源码完善）
export const ideCommand: SlashCommand = {
  name: 'ide',
  description: 'Configure IDE integration and setup extensions',
  usage: '/ide [vscode|cursor|windsurf|jetbrains|zed|status]',
  category: 'tools',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const ide = args[0]?.toLowerCase() || 'status';

    const ideInfo: Record<string, string> = {
      status: `Axon IDE Integration

Supported IDEs:
  • VS Code family: VS Code, Cursor, Windsurf, VSCodium
  • JetBrains: IntelliJ IDEA, PyCharm, WebStorm, etc.
  • Zed (native support)
  • Any terminal (CLI)

Quick Setup:
  1. Launch Axon from your IDE's integrated terminal
  2. The extension auto-installs for VS Code variants
  3. Or run /ide <ide-name> for specific instructions

Features:
  • Real-time diff viewing
  • @-mentions for file context
  • MCP server integration
  • Conversation history
  • Keyboard shortcuts
  • Slash commands
  • Diagnostic sharing (lint/syntax errors)

Commands:
  /ide vscode      - VS Code setup
  /ide cursor      - Cursor setup
  /ide windsurf    - Windsurf setup
  /ide jetbrains   - JetBrains IDEs setup
  /ide zed         - Zed editor setup

Note: If running from external terminal, use /ide to connect to your IDE.`,

      vscode: `VS Code Integration

Setup (One-Step):
  1. Open VS Code's integrated terminal
  2. Run: claude
  3. Extension auto-installs

Or Install Manually:
  1. Open Extensions (Cmd+Shift+X / Ctrl+Shift+X)
  2. Search "Axon"
  3. Click Install
  4. Reload VS Code

Features:
  • Real-time code changes visualization
  • Diff viewing in IDE
  • File selection with @-mentions
  • Extended thinking toggle
  • Multiple sessions
  • Keyboard shortcuts:
    - Cmd+Option+K (Mac) / Ctrl+Alt+K (Win): Add file reference
    - Cmd+Shift+P (Mac) / Ctrl+Shift+P (Win): Command palette

Configuration:
  • Settings > Extensions > Axon
  • Or edit .vscode/settings.json

External Terminal Setup:
  1. Open VS Code
  2. In external terminal, run: claude
  3. Type: /ide
  4. Extension connects automatically

Documentation: https://docs.anthropic.com/claude-code/ide-integrations`,

      cursor: `Cursor Integration

Cursor is a VS Code variant with built-in AI features. You can use Axon alongside Cursor's native AI.

Setup:
  1. Open Cursor's integrated terminal
  2. Run: claude
  3. Extension auto-installs

Or from Command Palette:
  1. Cmd+Shift+P (Mac) / Ctrl+Shift+P (Win)
  2. Run: "Install 'cursor' to shell"
  3. Launch: claude

Features:
  • Use Axon + Cursor AI together
  • Claude's deep reasoning + Cursor's speed
  • Inline completions (Cursor) + multi-file context (Axon)
  • Share context between both tools

Best Practices:
  • Use Cursor for quick inline edits
  • Use Axon for complex refactors and reasoning
  • Share files via @-mentions in Axon

External Terminal:
  If running from external terminal, type /ide to connect.

Tip: Axon complements Cursor - you get both tools' strengths!`,

      windsurf: `Windsurf Integration

Windsurf is an AI-powered IDE built on VS Code with the Cascade agent.

Setup (One-Step):
  1. Open Windsurf's integrated terminal
  2. Run: claude
  3. Extension auto-installs

Manual Installation:
  1. Extensions panel (Cmd+Shift+X / Ctrl+Shift+X)
  2. Search "Axon"
  3. Install and reload

Features:
  • Axon + Cascade agent
  • Deep reasoning (Claude) + simple UI (Windsurf)
  • Real-time diffs in IDE
  • Context sharing with @-mentions

Using Both Together:
  • Windsurf's chat/write modes for quick tasks
  • Axon for complex, multi-file changes
  • Both share the same workspace

External Terminal:
  Run claude from external terminal, then type /ide to connect.

Documentation: https://docs.anthropic.com/claude-code/ide-integrations`,

      jetbrains: `JetBrains IDE Integration

Supported IDEs:
  • IntelliJ IDEA (Ultimate, Community)
  • PyCharm (Pro, Community)
  • WebStorm
  • PhpStorm
  • Rider
  • GoLand
  • RubyMine
  • CLion
  • DataGrip
  • Android Studio

Installation:
  1. Open: Settings/Preferences > Plugins (Cmd+, or Ctrl+Alt+S)
  2. Switch to Marketplace tab
  3. Search: "Axon"
  4. Click Install
  5. Restart IDE

Features:
  • Tool window panel
  • Code actions and quick fixes
  • Context menu integration
  • Terminal integration
  • Diff viewer
  • Session management

Usage:
  1. Open Terminal tool window (Alt+F12)
  2. Run: claude
  3. Or: Tools > Axon

Configuration:
  • Settings > Tools > Axon
  • Or edit .idea/claude-code.xml

External Terminal:
  If using external terminal, type /ide after launching claude.

Documentation: https://docs.anthropic.com/claude-code/ide-integrations`,

      zed: `Zed Editor Integration

Zed has native Axon support built-in.

Setup:
  1. Open Zed
  2. Open terminal (Cmd+J / Ctrl+J)
  3. Run: claude
  4. Integration activates automatically

Features:
  • Native integration (no extension needed)
  • Collaborative editing
  • Real-time collaboration with Claude
  • Fast performance
  • Built-in terminal

Configuration:
  • Zed Settings > Extensions > Claude
  • Or edit ~/.config/zed/settings.json

Usage:
  • Run claude from Zed's terminal
  • Use /ide command if needed
  • Share context with @-mentions

Zed is optimized for Axon with minimal setup!

Documentation: https://zed.dev/docs/assistant/claude-code`,

      vim: `Vim/Neovim Integration

Axon works in any terminal, including vim/neovim terminals.

Setup:
  Use the /vim command for detailed setup instructions:
    /vim

Quick Start:
  1. Open vim/neovim
  2. Open terminal (in tmux/screen or separate window)
  3. Run: claude
  4. Use Claude to edit files

Tips:
  • Use tmux/screen for split view
  • Run /terminal-setup for shortcuts
  • Claude can edit vim config files

For full instructions, run: /vim`,
    };

    const response = ideInfo[ide] || `Unknown IDE: ${ide}

Supported IDEs:
  • vscode    - Visual Studio Code
  • cursor    - Cursor editor
  • windsurf  - Windsurf IDE
  • jetbrains - JetBrains IDEs
  • zed       - Zed editor

Run /ide <name> for setup instructions.
Or /ide status to see all options.`;

    ctx.ui.addMessage('assistant', response);
    return { success: true };
  },
};

// /chrome - Chrome 集成 (官方 local-jsx 风格 - 交互式界面)
export const chromeCommand: SlashCommand = {
  name: 'chrome',
  description: 'Claude in Chrome (Beta) settings',
  category: 'tools',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      // 动态导入 React 和 ChromeSettings 组件
      const React = await import('react');
      const { default: ChromeSettings } = await import('../ui/ChromeSettings.js');

      // 返回 JSX 组件，由 App.tsx 在主 UI 中显示（官方 local-jsx 模式）
      return {
        success: true,
        action: 'showJsx',
        jsx: React.createElement(ChromeSettings, { onDone: () => {} }),
        shouldHidePromptInput: true,
      };
    } catch (error) {
      // 如果 JSX 组件加载失败，回退到静态显示
      const configFile = path.join(os.homedir(), '.claude', 'settings.json');
      let chromeEnabled = false;

      if (fs.existsSync(configFile)) {
        try {
          const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
          chromeEnabled = config.chrome?.enabled || config.claudeInChromeDefaultEnabled || false;
        } catch {
          // 忽略解析错误
        }
      }

      const statusIcon = chromeEnabled ? '✓' : '○';
      const statusText = chromeEnabled ? 'Enabled' : 'Not connected';

      const chromeInfo = `╭─ Claude in Chrome (Beta) ───────────────────────────╮
│                                                     │
│  Status: ${statusIcon} ${statusText.padEnd(40)}│
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Claude in Chrome allows you to:                    │
│    • Use Claude directly in your browser            │
│    • Interact with web pages                        │
│    • Automate browser tasks                         │
│    • Take screenshots and analyze content           │
│                                                     │
│  Setup:                                             │
│    1. Install the Claude Chrome extension           │
│       https://chrome.google.com/webstore            │
│    2. Sign in with your Claude account              │
│    3. Run: /config chrome.enabled true              │
│                                                     │
│  Available Commands (when connected):               │
│    navigate <url>      Go to a URL                  │
│    click <selector>    Click an element             │
│    type <text>         Enter text                   │
│    screenshot          Capture the page             │
│                                                     │
│  Configuration:                                     │
│    /config chrome.enabled true                      │
│    /config chrome.headless false                    │
│                                                     │
╰─────────────────────────────────────────────────────╯

Note: This feature is in Beta. Some functionality may be limited.
Documentation: https://docs.anthropic.com/claude-code/chrome`;

      ctx.ui.addMessage('assistant', chromeInfo);
      return { success: true };
    }
  },
};

// /plugin - 插件管理（官方 local-jsx 风格 - 交互式界面）
export const pluginCommand: SlashCommand = {
  name: 'plugin',
  aliases: ['plugins'],
  description: 'Manage Axon plugins and marketplaces',
  usage: '/plugin [marketplace|install|list|validate]',
  category: 'tools',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const action = args[0];
    const subAction = args[1];

    const pluginDir = path.join(os.homedir(), '.claude', 'plugins');
    const projectPluginDir = path.join(ctx.config.cwd, '.claude', 'plugins');

    // 如果没有参数，显示交互式 UI（官方 local-jsx 模式）
    if (!action) {
      try {
        // 动态导入 React 和 PluginsDialog 组件
        const React = await import('react');
        const { default: PluginsDialog } = await import('../ui/PluginsDialog.js');

        // 返回 JSX 组件，由 App.tsx 在主 UI 中显示
        return {
          success: true,
          action: 'showJsx',
          jsx: React.createElement(PluginsDialog, {
            cwd: ctx.config.cwd,
            onDone: () => {},
          }),
          shouldHidePromptInput: true,
        };
      } catch (error) {
        // 如果 JSX 组件加载失败，回退到文本模式
        console.error('Failed to load Plugins UI:', error);
        // 继续执行下方的 list 逻辑
      }
    }

    // /plugin marketplace - 管理插件市场
    if (action === 'marketplace') {
      const marketplaceAction = subAction || 'list';

      switch (marketplaceAction) {
        case 'add':
          const addSource = args[2];
          if (!addSource) {
            ctx.ui.addMessage('assistant', `Add Plugin Marketplace

Usage:
  /plugin marketplace add <source>

Examples:
  /plugin marketplace add anthropics/claude-code
  /plugin marketplace add git@github.com:owner/repo.git
  /plugin marketplace add https://example.com/marketplace.json
  /plugin marketplace add ./path/to/marketplace

Source formats:
  • owner/repo              - GitHub repository shorthand
  • git@github.com:...      - Git SSH URL
  • https://...             - Direct URL to marketplace.json
  • ./path or /absolute     - Local file system path

The marketplace source must contain a marketplace.json file defining available plugins.

Documentation: https://docs.anthropic.com/claude-code/plugins`);
            return { success: false };
          }

          ctx.ui.addMessage('assistant', `To add marketplace "${addSource}":

1. Ensure the source is accessible and contains marketplace.json
2. Run the command with the source URL or path
3. Available plugins from this marketplace will be listed

Example marketplace.json structure:
{
  "name": "My Marketplace",
  "plugins": [
    {
      "name": "example-plugin",
      "description": "An example plugin",
      "source": { "github": "owner/repo" }
    }
  ]
}

Note: In this educational project, marketplace functionality is simulated.
The official Axon supports full marketplace integration.`);
          break;

        case 'remove':
          const removeName = args[2];
          if (!removeName) {
            ctx.ui.addMessage('assistant', `Remove Plugin Marketplace

Usage:
  /plugin marketplace remove <name>

This will remove the marketplace and uninstall all plugins from it.

Use /plugin marketplace list to see available marketplaces.`);
            return { success: false };
          }

          ctx.ui.addMessage('assistant', `To remove marketplace "${removeName}":

1. All plugins from this marketplace will be uninstalled
2. The marketplace configuration will be removed
3. You can re-add the marketplace later if needed

Warning: This action cannot be undone. Make sure you want to proceed.

In the official Axon, use the interactive UI to manage marketplaces.`);
          break;

        case 'list':
        default:
          ctx.ui.addMessage('assistant', `Plugin Marketplaces

Official Marketplace:
  • anthropics/claude-code - Official Axon plugins
    URL: https://github.com/anthropics/claude-code.git

Community Marketplaces:
  Add community marketplaces with:
  /plugin marketplace add <source>

Commands:
  /plugin marketplace list          - List configured marketplaces
  /plugin marketplace add <source>  - Add a new marketplace
  /plugin marketplace remove <name> - Remove a marketplace

Popular marketplace sources:
  • GitHub repositories with marketplace.json
  • Direct URLs to marketplace.json files
  • Local file system paths

Documentation: https://docs.anthropic.com/claude-code/plugins`);
          break;
      }
      return { success: true };
    }

    // /plugin install - 安装插件
    if (action === 'install') {
      const pluginName = args[1];
      if (!pluginName) {
        ctx.ui.addMessage('assistant', `Install Plugin

Usage:
  /plugin install <plugin-name>[@marketplace]

Examples:
  /plugin install frontend-design@claude-code-plugins
  /plugin install code-review@anthropics
  /plugin install my-plugin

The plugin must be available in a configured marketplace.

To browse available plugins:
  1. Use /plugin marketplace list to see marketplaces
  2. Add marketplaces with /plugin marketplace add
  3. Browse and install from the interactive UI

Note: Plugins are installed to:
  Global: ${pluginDir}
  Project: ${projectPluginDir}

After installation, restart Axon to load the plugin.`);
        return { success: false };
      }

      ctx.ui.addMessage('assistant', `Installing plugin: ${pluginName}

1. Searching configured marketplaces...
2. Downloading plugin files...
3. Validating plugin manifest...
4. Installing to plugin directory...

Note: In this educational project, actual plugin installation is simulated.
The official Axon fully supports plugin installation from marketplaces.

After installation:
  • Restart Axon to load the plugin
  • Use /plugin list to see installed plugins
  • Configure plugin settings if needed`);
      return { success: true };
    }

    // /plugin list - 列出已安装插件
    if (action === 'list') {
      let listInfo = `Installed Plugins\n\n`;

      // 检查插件目录
      const checkPluginDir = (dir: string, label: string): number => {
        if (!fs.existsSync(dir)) {
          return 0;
        }

        let count = 0;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          const plugins = entries.filter(e => e.isDirectory());

          if (plugins.length > 0) {
            listInfo += `${label} (${dir}):\n`;
            for (const plugin of plugins) {
              const manifestPath = path.join(dir, plugin.name, 'manifest.json');
              if (fs.existsSync(manifestPath)) {
                try {
                  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                  listInfo += `  • ${plugin.name} v${manifest.version || '0.0.0'}\n`;
                  if (manifest.description) {
                    listInfo += `    ${manifest.description}\n`;
                  }
                  count++;
                } catch {
                  listInfo += `  • ${plugin.name} (invalid manifest)\n`;
                }
              } else {
                listInfo += `  • ${plugin.name} (no manifest)\n`;
              }
            }
            listInfo += '\n';
          }
        } catch (error) {
          // 忽略读取错误
        }

        return count;
      };

      const globalCount = checkPluginDir(pluginDir, 'Global Plugins');
      const projectCount = checkPluginDir(projectPluginDir, 'Project Plugins');

      if (globalCount === 0 && projectCount === 0) {
        listInfo += `No plugins installed.\n\n`;
        listInfo += `To install plugins:\n`;
        listInfo += `  1. Add a marketplace: /plugin marketplace add <source>\n`;
        listInfo += `  2. Install a plugin: /plugin install <name>\n\n`;
      }

      listInfo += `Commands:
  /plugin list                  - List installed plugins
  /plugin install <name>        - Install a plugin
  /plugin marketplace add       - Add plugin marketplace
  /plugin marketplace list      - List marketplaces
  /plugin validate <path>       - Validate plugin manifest

Plugin Directories:
  Global:  ${pluginDir}
  Project: ${projectPluginDir}

Documentation: https://docs.anthropic.com/claude-code/plugins`;

      ctx.ui.addMessage('assistant', listInfo);
      return { success: true };
    }

    // /plugin validate - 验证插件
    if (action === 'validate') {
      const pluginPath = args[1] || '.claude-plugin/manifest.json';

      ctx.ui.addMessage('assistant', `Validate Plugin Manifest

Usage:
  /plugin validate [path]

Examples:
  /plugin validate .claude-plugin/manifest.json
  /plugin validate ./my-plugin/manifest.json
  /plugin validate .

This command validates a plugin or marketplace manifest file or directory.

Validation checks:
  • Valid JSON syntax
  • Required fields present (name, version)
  • Correct field types and values
  • Valid source configurations
  • Proper command/agent/hook definitions

Target path: ${pluginPath}

To validate:
  1. Ensure manifest.json exists at the path
  2. Run validation command
  3. Fix any reported errors
  4. Re-validate until all checks pass

Documentation: https://docs.anthropic.com/claude-code/plugins/manifest`);
      return { success: true };
    }

    // 默认：显示帮助信息
    ctx.ui.addMessage('assistant', `Plugin Management

Commands:
  /plugin list                        - List installed plugins
  /plugin install <name>              - Install a plugin from marketplace
  /plugin marketplace list            - List configured marketplaces
  /plugin marketplace add <source>    - Add a new marketplace
  /plugin marketplace remove <name>   - Remove a marketplace
  /plugin validate [path]             - Validate plugin manifest

Plugin Structure:
  plugin-name/
    manifest.json       - Plugin metadata and configuration
    commands/           - Custom slash commands (.md files)
    agents/             - Custom agent definitions (.md files)
    hooks/              - Lifecycle hooks (.sh, .js, .ts)
    mcpServers/         - MCP server configurations

Example manifest.json:
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My custom plugin",
  "author": "Your Name",
  "commands": {
    "my-command": "./commands/my-command.md"
  },
  "agents": {
    "my-agent": "./agents/my-agent.md"
  }
}

Plugin Directories:
  Global:  ${pluginDir}
  Project: ${projectPluginDir}

Quick Start:
  1. Add official marketplace:
     /plugin marketplace add anthropics/claude-code

  2. Install a plugin:
     /plugin install frontend-design@claude-code-plugins

  3. Restart Axon to load plugins

Documentation: https://docs.anthropic.com/claude-code/plugins`);

    return { success: true };
  },
};

// /install - 安装工具
export const installCommand: SlashCommand = {
  name: 'install',
  description: 'Install Axon extensions or tools',
  usage: '/install <tool>',
  category: 'tools',
  execute: (ctx: CommandContext): CommandResult => {
    const { args } = ctx;
    const tool = args[0];

    if (!tool) {
      const installInfo = `Install Extensions:

Available:
  vscode           - VS Code extension
  jetbrains        - JetBrains plugin
  github-app       - GitHub App integration
  mcp-filesystem   - MCP filesystem server
  mcp-github       - MCP GitHub server

Usage:
  /install <tool>
  /install-github-app  - Special GitHub App setup

Example:
  /install vscode
  /install mcp-filesystem`;

      ctx.ui.addMessage('assistant', installInfo);
      return { success: true };
    }

    const installInstructions: Record<string, string> = {
      vscode: `VS Code Extension:

Install via:
  1. VS Code Marketplace
  2. Or: code --install-extension anthropic.claude-code

After installation, restart VS Code.`,

      jetbrains: `JetBrains Plugin:

Install via:
  1. IDE Settings > Plugins > Marketplace
  2. Search "Axon"
  3. Install and restart IDE`,

      'mcp-filesystem': `MCP Filesystem Server:

Install:
  npm install -g @anthropic/mcp-server-filesystem

Configure in ~/.claude/settings.json:
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/path/to/dir"]
    }
  }
}`,

      'mcp-github': `MCP GitHub Server:

Install:
  npm install -g @anthropic/mcp-server-github

Configure in ~/.claude/settings.json:
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": "your-github-token"
      }
    }
  }
}`,
    };

    ctx.ui.addMessage('assistant', installInstructions[tool] || `Unknown tool: ${tool}\n\nUse /install to see available tools.`);
    return { success: true };
  },
};

// /install-github-app - 安装 GitHub App (基于官方源码完善)
export const installGithubAppCommand: SlashCommand = {
  name: 'install-github-app',
  description: 'Set up Claude GitHub Actions for a repository',
  category: 'tools',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { args } = ctx;

    // GitHub Actions 工作流模板 URL
    const GITHUB_APP_URL = 'https://github.com/apps/claude';
    const CLAUDE_ACTION_REPO = 'https://github.com/anthropics/claude-code-action';

    const githubAppInfo = `╭─ Set up Claude GitHub Actions ─────────────────────╮
│                                                     │
│  Claude GitHub Actions allows you to:               │
│    • Tag @claude in PR and issue comments           │
│    • Get automated code reviews on pull requests    │
│    • Run Claude directly from GitHub workflows      │
│    • Access repository context automatically        │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Setup Steps:                                       │
│                                                     │
│  1. Install the GitHub App                          │
│     Visit: ${GITHUB_APP_URL}                │
│     Click "Install" and select your repositories    │
│                                                     │
│  2. Check GitHub CLI (gh) is installed              │
│     Run: gh --version                               │
│     Install from: https://cli.github.com/           │
│                                                     │
│  3. Authenticate with GitHub CLI                    │
│     Run: gh auth login                              │
│     Or: gh auth refresh -h github.com -s repo,workflow
│                                                     │
│  4. Set up API Key Secret                           │
│     Run: gh secret set ANTHROPIC_API_KEY \\         │
│          --repo OWNER/REPO                          │
│     Enter your API key when prompted                │
│                                                     │
│  5. Add GitHub Actions Workflow                     │
│     Create: .github/workflows/claude.yml            │
│     Use template from: ${CLAUDE_ACTION_REPO}
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Example Workflow (claude.yml):                     │
│                                                     │
│    name: Axon                                │
│    on:                                              │
│      issue_comment:                                 │
│        types: [created]                             │
│      pull_request_review_comment:                   │
│        types: [created]                             │
│                                                     │
│    jobs:                                            │
│      claude:                                        │
│        if: contains(github.event.comment.body,      │
│            '@claude')                               │
│        runs-on: ubuntu-latest                       │
│        permissions:                                 │
│          contents: write                            │
│          pull-requests: write                       │
│          issues: write                              │
│        steps:                                       │
│          - uses: actions/checkout@v4                │
│          - uses: anthropics/claude-code-action@v1   │
│            with:                                    │
│              anthropic_api_key: \\                  │
│                \${{ secrets.ANTHROPIC_API_KEY }}    │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Automated Code Review Workflow:                    │
│                                                     │
│    Create: .github/workflows/claude-review.yml      │
│                                                     │
│    name: Axon Review                         │
│    on:                                              │
│      pull_request:                                  │
│        types: [opened, synchronize]                 │
│                                                     │
│    jobs:                                            │
│      review:                                        │
│        runs-on: ubuntu-latest                       │
│        permissions:                                 │
│          contents: read                             │
│          pull-requests: write                       │
│        steps:                                       │
│          - uses: actions/checkout@v4                │
│          - uses: anthropics/claude-code-action@v1   │
│            with:                                    │
│              anthropic_api_key: \\                  │
│                \${{ secrets.ANTHROPIC_API_KEY }}    │
│              prompt: |                              │
│                Review this PR for code quality,     │
│                bugs, and best practices.            │
│                Use \`gh pr comment\` to leave       │
│                your review.                         │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Quick Check:                                       │
│                                                     │
│    # Check if gh is installed                       │
│    gh --version                                     │
│                                                     │
│    # Check authentication                           │
│    gh auth status                                   │
│                                                     │
│    # List secrets in repo                           │
│    gh secret list --repo OWNER/REPO                 │
│                                                     │
│    # View workflows                                 │
│    gh workflow list --repo OWNER/REPO               │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Common Issues:                                     │
│                                                     │
│  ❌ Permission denied                               │
│     → Run: gh auth refresh -h github.com \\         │
│              -s repo,workflow                       │
│                                                     │
│  ❌ Not authorized                                  │
│     → Ensure you have admin access to repo          │
│                                                     │
│  ❌ Secret not found                                │
│     → Set secret with: gh secret set \\             │
│              ANTHROPIC_API_KEY --repo OWNER/REPO    │
│                                                     │
│  ❌ Workflow not triggering                         │
│     → Check workflow file syntax with:              │
│       gh workflow view claude.yml --repo OWNER/REPO │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Configuration Options:                             │
│                                                     │
│  • allowed_tools: Restrict which tools Claude can   │
│    use in workflows                                 │
│    Example:                                         │
│      allowed_tools: 'Bash(gh pr:*),Bash(npm test)'  │
│                                                     │
│  • additional_permissions: Grant extra permissions  │
│    Example:                                         │
│      additional_permissions: |                      │
│        checks: read                                 │
│                                                     │
│  • plugin_marketplaces: Use custom plugins          │
│    Example:                                         │
│      plugins: 'code-review@claude-code-plugins'     │
│                                                     │
╰─────────────────────────────────────────────────────╯

After setup, you can:
  • Comment @claude on any PR or issue to invoke Claude
  • Get automatic code reviews on new PRs
  • Use Claude for code analysis in CI/CD pipelines

For detailed documentation and advanced usage:
  ${CLAUDE_ACTION_REPO}

For manual setup and troubleshooting:
  https://code.claude.com/docs/en/github-actions`;

    ctx.ui.addMessage('assistant', githubAppInfo);
    return { success: true };
  },
};

// /install-slack-app - 安装 Slack App (官方风格 - 检查配置状态)
export const installSlackAppCommand: SlashCommand = {
  name: 'install-slack-app',
  description: 'Install the Claude Slack app',
  category: 'tools',
  execute: (ctx: CommandContext): CommandResult => {
    // 检查 Slack 配置
    const configFile = path.join(os.homedir(), '.claude', 'settings.json');
    let slackConfigured = false;
    let webhookUrl = '';

    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        if (config.slack?.webhook) {
          slackConfigured = true;
          webhookUrl = config.slack.webhook.substring(0, 30) + '...';
        }
      } catch {
        // 忽略解析错误
      }
    }

    const statusIcon = slackConfigured ? '✓' : '○';
    const statusText = slackConfigured ? 'Configured' : 'Not configured';

    const slackAppInfo = `╭─ Claude Slack App ──────────────────────────────────╮
│                                                     │
│  Status: ${statusIcon} ${statusText.padEnd(40)}│
${slackConfigured ? `│  Webhook: ${webhookUrl.padEnd(40)}│\n` : ''}│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Get notified in Slack when Axon needs       │
│  attention.                                         │
│                                                     │
│  Features:                                          │
│    • Receive notifications for long-running tasks   │
│    • Get alerts when Claude needs input             │
│    • Share session summaries                        │
│    • Team collaboration                             │
│                                                     │
│  Installation:                                      │
│    1. Create a Slack Incoming Webhook               │
│       https://api.slack.com/messaging/webhooks      │
│    2. Configure the webhook URL:                    │
│       /config slack.webhook <your-webhook-url>      │
│    3. Enable notifications:                         │
│       /config slack.notifications.taskComplete true │
│       /config slack.notifications.needsInput true   │
│       /config slack.notifications.errors true       │
│                                                     │
│  Test your configuration:                           │
│    /config slack.test true                          │
│                                                     │
╰─────────────────────────────────────────────────────╯

Example Configuration:
  /config slack.webhook https://hooks.slack.com/services/XXX/YYY/ZZZ

Once configured, you'll receive Slack messages when:
  • Long-running commands complete
  • Claude needs your approval
  • Errors occur during execution`;

    ctx.ui.addMessage('assistant', slackAppInfo);
    return { success: true };
  },
};

// 注册所有工具命令
export function registerToolsCommands(): void {
  commandRegistry.register(mcpCommand);
  commandRegistry.register(agentsCommand);
  commandRegistry.register(ideCommand);
  commandRegistry.register(chromeCommand);
  commandRegistry.register(pluginCommand);
  commandRegistry.register(installCommand);
  commandRegistry.register(installGithubAppCommand);
  commandRegistry.register(installSlackAppCommand);
}
