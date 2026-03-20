/**
 * WebUI 斜杠命令系统（精简版）
 * 只保留有实际功能的命令，删除所有占位假命令
 */

import type { ConversationManager } from './conversation.js';
import type { WebSocket } from 'ws';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import {
  getProviderForRuntimeBackend,
  getRuntimeBackendLabel,
  getWebModelLabel,
  getWebModelOptionsForBackend,
  isCodexCompatibleModel,
  normalizeWebRuntimeModelForBackend,
} from '../shared/model-catalog.js';

const require = createRequire(import.meta.url);

// ============ 类型定义 ============

export interface CommandContext {
  conversationManager: ConversationManager;
  ws: WebSocket;
  sessionId: string;
  cwd: string;
  model: string;
}

export interface ExtendedCommandContext extends CommandContext {
  args: string[];
  rawInput: string;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  action?: 'clear' | 'reload' | 'none';
  dialogType?: 'text' | 'session-list' | 'compact-result';
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category: 'general' | 'session' | 'config' | 'utility' | 'integration' | 'auth' | 'development';
  execute: (ctx: ExtendedCommandContext) => Promise<CommandResult> | CommandResult;
}

// ============ 命令注册表 ============

export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private aliases = new Map<string, string>();

  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }
  }

  get(name: string): SlashCommand | undefined {
    const cmd = this.commands.get(name);
    if (cmd) return cmd;
    const aliasedName = this.aliases.get(name);
    if (aliasedName) {
      return this.commands.get(aliasedName);
    }
    return undefined;
  }

  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  getByCategory(category: string): SlashCommand[] {
    return this.getAll().filter(cmd => cmd.category === category);
  }

  async execute(input: string, ctx: CommandContext): Promise<CommandResult> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { success: false, message: 'Not a slash command' };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const command = this.get(commandName);
    if (!command) {
      return {
        success: false,
        message: `Unknown command: /${commandName}\n\nUse /help to see all available commands.`,
        dialogType: 'text',
      };
    }

    try {
      const extendedCtx: ExtendedCommandContext = { ...ctx, args, rawInput: trimmed };
      return await command.execute(extendedCtx);
    } catch (error) {
      return {
        success: false,
        message: `Error executing /${commandName}: ${error instanceof Error ? error.message : String(error)}`,
        dialogType: 'text',
      };
    }
  }

  getHelp(): string {
    const categories: Record<string, string> = {
      general: 'General',
      session: 'Session Management',
      config: 'Configuration',
      utility: 'Utilities',
      auth: 'Authentication',
    };
    const categoryOrder = ['general', 'session', 'config', 'utility', 'auth'];

    let help = 'Available Commands\n';
    help += '='.repeat(50) + '\n\n';

    for (const category of categoryOrder) {
      const cmds = this.getByCategory(category);
      if (cmds.length === 0) continue;

      help += `${categories[category] || category}\n`;
      help += '-'.repeat((categories[category] || category).length) + '\n';

      for (const cmd of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
        const aliasStr = cmd.aliases?.length
          ? ` (${cmd.aliases.map(a => '/' + a).join(', ')})`
          : '';
        help += `  /${cmd.name.padEnd(18)}${cmd.description}${aliasStr}\n`;
      }
      help += '\n';
    }

    help += 'Use /help <command> for details on a specific command.\n';
    return help;
  }
}

// ============ 命令实现 ============

// /help
const helpCommand: SlashCommand = {
  name: 'help',
  aliases: ['?'],
  description: 'Show all available commands',
  usage: '/help [command]',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (args && args.length > 0) {
      const cmdName = args[0].replace(/^\//, '');
      const cmd = registry.get(cmdName);
      if (cmd) {
        let helpText = `/${cmd.name}\n`;
        helpText += '='.repeat(cmd.name.length + 1) + '\n\n';
        helpText += `${cmd.description}\n\n`;
        if (cmd.usage) helpText += `Usage:\n  ${cmd.usage}\n\n`;
        if (cmd.aliases?.length) helpText += `Aliases:\n  ${cmd.aliases.map(a => '/' + a).join(', ')}\n\n`;
        helpText += `Category: ${cmd.category}\n`;
        return { success: true, message: helpText, dialogType: 'text' };
      } else {
        return { success: false, message: `Unknown command: /${cmdName}\n\nUse /help to see all available commands.`, dialogType: 'text' };
      }
    }

    return { success: true, message: registry.getHelp(), dialogType: 'text' };
  },
};

// /clear
const clearCommand: SlashCommand = {
  name: 'clear',
  aliases: ['reset', 'new'],
  description: 'Clear conversation history',
  category: 'general',
  execute: (ctx: CommandContext): CommandResult => {
    ctx.conversationManager.clearHistory(ctx.sessionId);
    return { success: true, message: 'Conversation cleared. Context released.', action: 'clear', dialogType: 'text' };
  },
};

// /status
const statusCommand: SlashCommand = {
  name: 'status',
  description: 'Show system status',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);
    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY);

    let message = 'Axon WebUI Status\n\n';
    message += 'Session Info:\n';
    message += `  Session ID: ${ctx.sessionId.slice(0, 8)}\n`;
    message += `  Messages: ${history.length}\n`;
    message += `  Model: ${ctx.model}\n\n`;
    message += 'API Connection:\n';
    message += `  Status: ${apiKeySet ? '✓ Connected' : '✗ Not connected'}\n`;
    message += `  API Key: ${apiKeySet ? '✓ Configured' : '✗ Not configured'}\n\n`;
    message += 'Environment:\n';
    message += `  Working Directory: ${ctx.cwd}\n`;
    message += `  Platform: ${process.platform}\n`;
    message += `  Node.js: ${process.version}\n`;

    return { success: true, message, dialogType: 'text' };
  },
};

// /model
const modelCommand: SlashCommand = {
  name: 'model',
  aliases: ['m'],
  description: 'View or switch current model',
  usage: '/model [name]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const { webAuth } = await import('./web-auth.js');
    const runtimeBackend = ctx.conversationManager.getSessionRuntimeBackend(ctx.sessionId) || webAuth.getRuntimeBackend();
    const provider = getProviderForRuntimeBackend(runtimeBackend);
    const customModelName = webAuth.getDefaultModelByBackend()[runtimeBackend]
      || (provider === 'codex' ? webAuth.getCodexModelName() : webAuth.getCustomModelName());
    const currentModel = normalizeWebRuntimeModelForBackend(runtimeBackend, ctx.model, customModelName);
    const options = getWebModelOptionsForBackend(runtimeBackend, currentModel, customModelName);

    if (!args || args.length === 0) {
      let message = `Current runtime backend: ${getRuntimeBackendLabel(runtimeBackend)}\n`;
      message += `Current model: ${getWebModelLabel(currentModel, provider)} (${currentModel})\n\n`;
      message += 'Available models:\n';
      for (const option of options) {
        message += `  ${option.value} - ${option.label}`;
        if (option.description) {
          message += ` (${option.description})`;
        }
        message += '\n';
      }
      if (provider === 'codex') {
        message += runtimeBackend === 'openai-compatible-api'
          ? '\nOpenAI-compatible mode also accepts arbitrary responses-compatible model ids, such as gpt-5.4 or gpt-5.1.\n'
          : '\nCodex mode also accepts any Codex-compatible model id, such as gpt-5.4 or gpt-5.1-codex.\n';
      }
      message += '\n';
      message += 'Use /model <name> to switch models';
      return { success: true, message, dialogType: 'text' };
    }

    const requestedModel = args[0].trim();
    if (provider === 'codex' && !isCodexCompatibleModel(requestedModel)) {
      return {
        success: false,
        message: `Invalid Codex model: ${requestedModel}\n\nUse a Codex-compatible model id such as gpt-5-codex, gpt-5.4, or gpt-5.1-codex.`,
        dialogType: 'text',
      };
    }

    const newModel = normalizeWebRuntimeModelForBackend(runtimeBackend, requestedModel, customModelName);
    if (provider === 'anthropic' && !['opus', 'sonnet', 'haiku'].includes(newModel)) {
      return {
        success: false,
        message: `Invalid Claude model: ${requestedModel}\n\nAvailable models: opus, sonnet, haiku`,
        dialogType: 'text',
      };
    }

    ctx.conversationManager.setModel(ctx.sessionId, newModel);
    return {
      success: true,
      message: `Switched to ${getRuntimeBackendLabel(runtimeBackend)} ${getWebModelLabel(newModel, provider)} (${newModel})`,
      dialogType: 'text',
    };
  },
};

// /cost
const costCommand: SlashCommand = {
  name: 'cost',
  description: 'Show current session cost',
  category: 'session',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { webAuth } = await import('./web-auth.js');
    const history = ctx.conversationManager.getHistory(ctx.sessionId);
    const runtimeBackend = ctx.conversationManager.getSessionRuntimeBackend(ctx.sessionId) || webAuth.getRuntimeBackend();
    const provider = getProviderForRuntimeBackend(runtimeBackend);

    let totalInput = 0;
    let totalOutput = 0;
    for (const msg of history) {
      if (msg.usage) {
        totalInput += msg.usage.inputTokens || 0;
        totalOutput += msg.usage.outputTokens || 0;
      }
    }

    if (provider === 'codex') {
      let message = 'Session Cost Summary\n\n';
      message += 'Current Session:\n';
      message += `  Messages: ${history.length}\n`;
      message += `  Input tokens: ${totalInput.toLocaleString()}\n`;
      message += `  Output tokens: ${totalOutput.toLocaleString()}\n\n`;
      message += 'Codex subscription mode does not expose a stable public per-token price table here.\n';
      message += 'Use OpenAI billing or product quota views for authoritative usage accounting.';
      return { success: true, message, dialogType: 'text' };
    }

    const modelPricing: Record<string, { input: number; output: number; name: string }> = {
      opus: { input: 15, output: 75, name: 'Claude Opus 4.6' },
      sonnet: { input: 3, output: 15, name: 'Claude Sonnet 4.5' },
      haiku: { input: 0.8, output: 4, name: 'Claude Haiku 4.5' },
    };
    const pricing = modelPricing[ctx.model] || modelPricing.opus;
    const inputCost = (totalInput / 1000000) * pricing.input;
    const outputCost = (totalOutput / 1000000) * pricing.output;
    const totalCost = inputCost + outputCost;

    let message = 'Session Cost Summary\n\n';
    message += 'Current Session:\n';
    message += `  Messages: ${history.length}\n`;
    message += `  Input tokens: ${totalInput.toLocaleString()}\n`;
    message += `  Output tokens: ${totalOutput.toLocaleString()}\n`;
    message += `  Estimated cost: ${totalCost.toFixed(4)}\n\n`;
    message += `Pricing reference (${pricing.name}):\n`;
    message += `  Input: ${pricing.input} / 1M tokens\n`;
    message += `  Output: ${pricing.output} / 1M tokens`;

    return { success: true, message, dialogType: 'text' };
  },
};

// /config
const configCommand: SlashCommand = {
  name: 'config',
  aliases: ['settings'],
  description: 'Show current configuration',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY);
    let message = 'Current Configuration\n\n';
    message += `Session ID: ${ctx.sessionId}\n`;
    message += `Model: ${ctx.model}\n`;
    message += `Working Directory: ${ctx.cwd}\n`;
    message += `Platform: ${process.platform}\n`;
    message += `Node.js: ${process.version}\n\n`;
    message += `API Status:\n`;
    message += `  API Key: ${apiKeySet ? '✓ Configured' : '✗ Not configured'}\n`;
    return { success: true, message, dialogType: 'text' };
  },
};

// /compact - 真实压缩上下文
const compactCommand: SlashCommand = {
  name: 'compact',
  aliases: ['c'],
  description: 'Compact conversation history to free up context',
  category: 'session',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const result = await ctx.conversationManager.compactSession(ctx.sessionId);

    if (!result.success) {
      return {
        success: false,
        message: result.error || 'Compaction failed',
        dialogType: 'compact-result',
      };
    }

    let message = 'Context compaction complete\n\n';
    message += `Tokens saved: ~${result.savedTokens?.toLocaleString() || 'unknown'}\n`;
    message += `Messages before: ${result.messagesBefore || 'unknown'}\n`;
    message += `Messages after: ${result.messagesAfter || 'unknown'}`;

    return {
      success: true,
      message,
      dialogType: 'compact-result',
      data: result,
    };
  },
};

// /resume - 恢复历史会话
const resumeCommand: SlashCommand = {
  name: 'resume',
  aliases: ['continue'],
  description: 'Resume a previous conversation',
  usage: '/resume [session-id]',
  category: 'session',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager, sessionId } = ctx;

    // 无参数：列出最近会话供选择
    if (!args || args.length === 0) {
      const sessions = conversationManager.listPersistedSessions({
        limit: 15,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });

      // 过滤掉当前会话和没有消息的会话
      const filteredSessions = sessions.filter(s => s.id !== sessionId && s.messageCount > 0);

      if (filteredSessions.length === 0) {
        return {
          success: true,
          message: 'No resumable history sessions.',
          dialogType: 'text',
        };
      }

      return {
        success: true,
        message: 'Select a session to resume',
        dialogType: 'session-list',
        data: {
          sessions: filteredSessions.map(s => ({
            id: s.id,
            name: s.name,
            updatedAt: s.updatedAt,
            createdAt: s.createdAt,
            messageCount: s.messageCount,
            model: s.model,
            summary: s.summary,
            projectPath: s.projectPath,
          })),
        },
      };
    }

    // 有参数：直接恢复指定会话
    const targetSessionId = args[0];
    const success = await conversationManager.resumeSession(targetSessionId);

    if (!success) {
      return {
        success: false,
        message: `Session ${targetSessionId} does not exist or failed to resume.`,
        dialogType: 'text',
      };
    }

    return {
      success: true,
      message: `Session resumed: ${targetSessionId.slice(0, 8)}...`,
      dialogType: 'text',
      data: { switchToSessionId: targetSessionId },
    };
  },
};

// /tasks
const tasksCommand: SlashCommand = {
  name: 'tasks',
  aliases: ['bashes'],
  description: 'List and manage background Agent tasks',
  usage: '/tasks [list|cancel <id>|output <id>]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager, sessionId } = ctx;

    const taskManager = conversationManager.getTaskManager(sessionId);
    if (!taskManager) {
      return { success: false, message: 'Task manager not initialized.', dialogType: 'text' };
    }

    const formatTaskDetail = (task: ReturnType<typeof taskManager.getTask>) => {
      if (!task) return '';
      let message = `Task details: ${task.description}\n`;
      message += '='.repeat(50) + '\n\n';
      message += `ID: ${task.id}\n`;
      message += `Type: ${task.agentType}\n`;
      message += `Status: ${task.status}\n`;
      message += `Start time: ${task.startTime.toLocaleString()}\n`;
      if (task.endTime) {
        const duration = ((task.endTime.getTime() - task.startTime.getTime()) / 1000).toFixed(1);
        message += `End time: ${task.endTime.toLocaleString()}\n`;
        message += `Duration: ${duration}s\n`;
      }
      if (task.progress) {
        message += `\nProgress: ${task.progress.current}/${task.progress.total}\n`;
        if (task.progress.message) message += `Message: ${task.progress.message}\n`;
      }
      const output = taskManager.getTaskOutput(task.id);
      if (output) {
        message += `\nOutput:\n${'-'.repeat(50)}\n${output}\n`;
      } else if (task.status === 'running') {
        message += '\nTask is running, no output yet.\n';
      } else if (task.error) {
        message += `\nError:\n${task.error}\n`;
      }
      return message;
    };

    if (!args || args.length === 0) {
      const tasks = taskManager.listTasks();
      if (tasks.length === 0) {
        return { success: true, message: 'No background tasks.', dialogType: 'text' };
      }
      if (tasks.length === 1) {
        return { success: true, message: formatTaskDetail(tasks[0]), dialogType: 'text' };
      }

      let message = 'Background Tasks\n\n';
      tasks.forEach((task, idx) => {
        const duration = task.endTime
          ? ((task.endTime.getTime() - task.startTime.getTime()) / 1000).toFixed(1) + 's'
          : 'running...';
        const statusEmoji = { running: '⏳', completed: '✅', failed: '❌', cancelled: '🚫' }[task.status] || '?';
        message += `${idx + 1}. ${statusEmoji} ${task.description}\n`;
        message += `   ID: ${task.id.slice(0, 8)}\n`;
        message += `   Status: ${task.status} | Duration: ${duration}\n`;
        if (task.progress) {
          message += `   Progress: ${task.progress.current}/${task.progress.total}`;
          if (task.progress.message) message += ` - ${task.progress.message}`;
          message += '\n';
        }
        message += '\n';
      });
      message += 'Use /tasks output <id> to view task output\n';
      message += 'Use /tasks cancel <id> to cancel a running task';
      return { success: true, message, dialogType: 'text' };
    }

    const subcommand = args[0].toLowerCase();

    if (subcommand === 'cancel') {
      if (args.length < 2) return { success: false, message: 'Usage: /tasks cancel <task-id>', dialogType: 'text' };
      const taskId = args[1];
      const task = taskManager.getTask(taskId);
      if (!task) return { success: false, message: `Task ${taskId} does not exist`, dialogType: 'text' };
      const success = taskManager.cancelTask(taskId);
      return success
        ? { success: true, message: `Task ${taskId.slice(0, 8)} cancelled`, dialogType: 'text' }
        : { success: false, message: `Cannot cancel task ${taskId.slice(0, 8)} (may have already completed)`, dialogType: 'text' };
    }

    if (subcommand === 'output' || subcommand === 'o') {
      if (args.length < 2) return { success: false, message: 'Usage: /tasks output <task-id>', dialogType: 'text' };
      const taskId = args[1];
      const task = taskManager.getTask(taskId);
      if (!task) return { success: false, message: `Task ${taskId} does not exist`, dialogType: 'text' };
      return { success: true, message: formatTaskDetail(task), dialogType: 'text' };
    }

    if (subcommand === 'list' || subcommand === 'ls') {
      return tasksCommand.execute({ ...ctx, args: [] });
    }

    return {
      success: false,
      message: `Unknown subcommand: ${subcommand}\n\nUsage:\n  /tasks          - List all tasks\n  /tasks cancel <id>  - Cancel a task\n  /tasks output <id>  - View task output`,
      dialogType: 'text',
    };
  },
};

// /doctor
const doctorCommand: SlashCommand = {
  name: 'doctor',
  description: 'Run system diagnostic checks',
  usage: '/doctor [verbose]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const verbose = args.includes('verbose') || args.includes('v') || args.includes('-v');

    try {
      const { runDiagnostics, formatDoctorReport } = await import('./doctor.js');
      const report = await runDiagnostics({ verbose, includeSystemInfo: true });
      const message = formatDoctorReport(report, verbose);
      return {
        success: true,
        message,
        dialogType: 'text',
        data: { report: { ...report, timestamp: report.timestamp.getTime() } },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to run diagnostics: ${error instanceof Error ? error.message : 'unknown error'}`,
        dialogType: 'text',
      };
    }
  },
};

// /mcp
const mcpCommand: SlashCommand = {
  name: 'mcp',
  description: 'Manage MCP servers',
  usage: '/mcp [list|add|remove|toggle] [args]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager } = ctx;

    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const servers = conversationManager.listMcpServers();
        if (servers.length === 0) {
          return { success: true, message: 'No MCP servers configured.\n\nUse /mcp add <name> <command> to add a server.', dialogType: 'text' };
        }

        let message = 'MCP Server List\n\n';
        servers.forEach((server, idx) => {
          const statusIcon = server.enabled ? '✓' : '✗';
          message += `${idx + 1}. ${statusIcon} ${server.name}\n`;
          message += `   Type: ${server.type}\n`;
          if (server.type === 'stdio' && server.command) {
            message += `   Command: ${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}\n`;
          } else if (server.url) {
            message += `   URL: ${server.url}\n`;
          }
          message += '\n';
        });
        message += 'Commands: /mcp add|remove|toggle <name>';
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to list MCP servers: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    const sub = args[0].toLowerCase();

    if (sub === 'add') {
      if (args.length < 3) return { success: false, message: 'Usage: /mcp add <name> <command> [args...]', dialogType: 'text' };
      const name = args[1], command = args[2], cmdArgs = args.slice(3);
      try {
        const success = await conversationManager.addMcpServer(name, { type: 'stdio', command, args: cmdArgs.length > 0 ? cmdArgs : undefined, enabled: true });
        return success
          ? { success: true, message: `MCP server added: ${name}`, dialogType: 'text' }
          : { success: false, message: `Failed to add MCP server ${name}`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to add: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'remove') {
      if (args.length < 2) return { success: false, message: 'Usage: /mcp remove <name>', dialogType: 'text' };
      try {
        const success = await conversationManager.removeMcpServer(args[1]);
        return success
          ? { success: true, message: `MCP server removed: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `MCP server ${args[1]} does not exist`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to remove: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'toggle' || sub === 'enable' || sub === 'disable') {
      if (args.length < 2) return { success: false, message: `Usage: /mcp ${sub} <name>`, dialogType: 'text' };
      const enabled = sub === 'enable' ? true : sub === 'disable' ? false : undefined;
      try {
        const result = await conversationManager.toggleMcpServer(args[1], enabled);
        return result.success
          ? { success: true, message: `MCP server ${args[1]} ${result.enabled ? 'enabled' : 'disabled'}`, dialogType: 'text' }
          : { success: false, message: `MCP server ${args[1]} does not exist`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Operation failed: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    return { success: false, message: 'Available commands: list, add, remove, toggle', dialogType: 'text' };
  },
};

// /plugin
const pluginCommand: SlashCommand = {
  name: 'plugin',
  aliases: ['plugins'],
  description: 'Manage Axon plugins',
  usage: '/plugin [list|info|enable|disable|uninstall] [args]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager } = ctx;

    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const plugins = await conversationManager.listPlugins();
        if (plugins.length === 0) {
          return { success: true, message: 'No plugins installed.\n\nPlugins are installed in: ~/.axon/plugins/', dialogType: 'text' };
        }

        let message = 'Plugin List\n\n';
        plugins.forEach((plugin, idx) => {
          const statusIcon = plugin.loaded ? '✓' : plugin.enabled ? '○' : '✗';
          message += `${idx + 1}. ${statusIcon} ${plugin.name} v${plugin.version}\n`;
          if (plugin.description) message += `   ${plugin.description}\n`;
          message += `   Status: ${plugin.loaded ? 'Loaded' : plugin.enabled ? 'Enabled' : 'Disabled'}\n\n`;
        });
        message += 'Commands: /plugin info|enable|disable|uninstall <name>';
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    const sub = args[0].toLowerCase();

    if (sub === 'info' && args.length >= 2) {
      try {
        const plugin = await conversationManager.getPluginInfo(args[1]);
        if (!plugin) return { success: false, message: `Plugin ${args[1]} does not exist`, dialogType: 'text' };
        let message = `${plugin.name} v${plugin.version}\n`;
        if (plugin.description) message += `${plugin.description}\n`;
        if (plugin.author) message += `Author: ${plugin.author}\n`;
        message += `Status: ${plugin.loaded ? 'Loaded' : plugin.enabled ? 'Enabled' : 'Disabled'}\n`;
        if (plugin.path) message += `Path: ${plugin.path}\n`;
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to get plugin info: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'enable' && args.length >= 2) {
      try {
        const success = await conversationManager.enablePlugin(args[1]);
        return success
          ? { success: true, message: `Plugin enabled: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `Failed to enable plugin ${args[1]}`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to enable: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'disable' && args.length >= 2) {
      try {
        const success = await conversationManager.disablePlugin(args[1]);
        return success
          ? { success: true, message: `Plugin disabled: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `Failed to disable plugin ${args[1]}`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to disable: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if ((sub === 'uninstall' || sub === 'remove') && args.length >= 2) {
      try {
        const success = await conversationManager.uninstallPlugin(args[1]);
        return success
          ? { success: true, message: `Plugin uninstalled: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `Failed to uninstall plugin ${args[1]}`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to uninstall: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    return { success: false, message: 'Available commands: list, info, enable, disable, uninstall', dialogType: 'text' };
  },
};

// /login
const loginCommand: SlashCommand = {
  name: 'login',
  aliases: ['auth'],
  description: 'Manage authentication and API keys',
  usage: '/login [status|set <key>|clear]',
  category: 'auth',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const { webAuth } = await import('./web-auth.js');

    if (!args || args.length === 0 || args[0] === 'status') {
      try {
        const status = webAuth.getStatus();
        const maskedKey = webAuth.getMaskedApiKey();
        let message = 'Authentication Status\n\n';
        message += `Auth: ${status.authenticated ? '✓ Authenticated' : '✗ Not authenticated'}\n`;
        message += `Type: ${status.type === 'api_key' ? 'API Key' : status.type === 'oauth' ? 'OAuth' : 'None'}\n`;
        if (maskedKey) message += `API Key: ${maskedKey}\n`;
        message += '\nCommands: /login set <key> | /login clear | /logout';
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to get auth status: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    const sub = args[0].toLowerCase();

    if (sub === 'set' && args.length >= 2) {
      try {
        const apiKey = args.slice(1).join(' ');
        const success = webAuth.setApiKey(apiKey);
        if (success) {
          return { success: true, message: `API key set: ${webAuth.getMaskedApiKey()}`, dialogType: 'text' };
        }
        return { success: false, message: 'Failed to set API key, please check the format.', dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to set: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'clear') {
      try {
        webAuth.clearAll();
        return { success: true, message: 'Authentication cleared.', dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `Failed to clear: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    return { success: false, message: 'Available commands: status, set <key>, clear', dialogType: 'text' };
  },
};

// /logout
const logoutCommand: SlashCommand = {
  name: 'logout',
  description: 'Log out (clear API key)',
  category: 'auth',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    return loginCommand.execute({ ...ctx, args: ['clear'] });
  },
};

// /init - 初始化 AXON.md
const initCommand: SlashCommand = {
  name: 'init',
  description: 'Initialize AXON.md for this project',
  usage: '/init',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const claudeMdPath = path.join(ctx.cwd, 'AXON.md');
    const claudeDir = path.join(ctx.cwd, '.axon');
    const alreadyInitialized = fs.existsSync(claudeMdPath) || fs.existsSync(claudeDir);

    if (alreadyInitialized) {
      const existingFiles: string[] = [];
      if (fs.existsSync(claudeMdPath)) existingFiles.push('AXON.md');
      if (fs.existsSync(claudeDir)) existingFiles.push('.axon/');

      return {
        success: true,
        data: {
          chatPrompt: `Please analyze this codebase and suggest improvements to the existing Axon configuration.\n\nCurrent configuration found:\n${existingFiles.map(f => `- ${f}`).join('\n')}\n\nPlease review and suggest improvements for:\n1. AXON.md - Is it comprehensive? Does it include key commands and architecture?\n2. .axon/ directory - Are there useful custom commands or settings that should be added?\n3. Any missing configuration that would help future Claude instances work more effectively in this codebase.\n\nFocus on practical improvements based on the actual codebase structure and development workflow.`,
        },
      };
    }

    return {
      success: true,
      data: {
        chatPrompt: `Please analyze this codebase and create a AXON.md file, which will be given to future instances of Axon to operate in this repository.

IMPORTANT: The AXON.md file MUST use the built-in template as its foundation. Call the createClaudeMdTemplate function or use the following structure:
1. Start with the standard header "# AXON.md" and the intro line
2. Fill in the "## Project Overview" section with a concise description of the project
3. Keep the "## Iron Rules" section and "## Behavioral Red Lines" section EXACTLY as they are in the template — do NOT modify, remove, or reword any rules
4. Fill in the "## Development Commands" section with actual build/test/lint commands discovered from the project
5. Fill in the "## Architecture Overview" section with the high-level code structure

What to add in the project-specific sections:
1. Commands that will be commonly used, such as how to build, lint, and run tests. Include the necessary commands to develop in this codebase, such as how to run a single test.
2. High-level code architecture and structure so that future instances can be productive more quickly. Focus on the "big picture" architecture that requires reading multiple files to understand.

Usage notes:
- Do not repeat yourself and do not include obvious instructions.
- Avoid listing every component or file structure that can be easily discovered.
- Don't include generic development practices — the Iron Rules already cover behavioral constraints.
- If there are Cursor rules or Copilot rules, make sure to include the important parts.
- If there is a README.md, make sure to include the important parts.

Additionally, please help set up the .axon/ directory structure:
1. Create .axon/commands/ for custom slash commands
2. Suggest adding .axon/ to .gitignore (but keep AXON.md tracked)
3. If there are common project-specific workflows, suggest creating custom commands for them

Please analyze the codebase now and create these files.`,
      },
    };
  },
};

// ============ 注册所有命令 ============

export const registry = new SlashCommandRegistry();

registry.register(helpCommand);
registry.register(clearCommand);
registry.register(statusCommand);
registry.register(modelCommand);
registry.register(costCommand);
registry.register(configCommand);
registry.register(compactCommand);
registry.register(resumeCommand);
registry.register(tasksCommand);
registry.register(doctorCommand);
registry.register(mcpCommand);
registry.register(pluginCommand);
registry.register(loginCommand);
registry.register(logoutCommand);
registry.register(initCommand);

// ============ 导出工具函数 ============

export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

export async function executeSlashCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  return registry.execute(input, ctx);
}
