/**
 * WebUI 斜杠命令系统（精简版）
 * 只保留有实际功能的命令，删除所有占位假命令
 */

import type { ConversationManager } from './conversation.js';
import type { WebSocket } from 'ws';
import { createRequire } from 'module';

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
        message: `未知命令: /${commandName}\n\n使用 /help 查看所有可用命令。`,
        dialogType: 'text',
      };
    }

    try {
      const extendedCtx: ExtendedCommandContext = { ...ctx, args, rawInput: trimmed };
      return await command.execute(extendedCtx);
    } catch (error) {
      return {
        success: false,
        message: `执行 /${commandName} 时出错: ${error instanceof Error ? error.message : String(error)}`,
        dialogType: 'text',
      };
    }
  }

  getHelp(): string {
    const categories: Record<string, string> = {
      general: '通用命令',
      session: '会话管理',
      config: '配置',
      utility: '工具',
      auth: '认证',
    };
    const categoryOrder = ['general', 'session', 'config', 'utility', 'auth'];

    let help = '可用命令\n';
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

    help += '使用 /help <命令> 查看特定命令的详细信息。\n';
    return help;
  }
}

// ============ 命令实现 ============

// /help
const helpCommand: SlashCommand = {
  name: 'help',
  aliases: ['?'],
  description: '显示所有可用命令',
  usage: '/help [命令名]',
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
        if (cmd.usage) helpText += `用法:\n  ${cmd.usage}\n\n`;
        if (cmd.aliases?.length) helpText += `别名:\n  ${cmd.aliases.map(a => '/' + a).join(', ')}\n\n`;
        helpText += `类别: ${cmd.category}\n`;
        return { success: true, message: helpText, dialogType: 'text' };
      } else {
        return { success: false, message: `未知命令: /${cmdName}\n\n使用 /help 查看所有可用命令。`, dialogType: 'text' };
      }
    }

    return { success: true, message: registry.getHelp(), dialogType: 'text' };
  },
};

// /clear
const clearCommand: SlashCommand = {
  name: 'clear',
  aliases: ['reset', 'new'],
  description: '清除对话历史',
  category: 'general',
  execute: (ctx: CommandContext): CommandResult => {
    ctx.conversationManager.clearHistory(ctx.sessionId);
    return { success: true, message: '对话已清除。上下文已释放。', action: 'clear', dialogType: 'text' };
  },
};

// /status
const statusCommand: SlashCommand = {
  name: 'status',
  description: '显示系统状态',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);
    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY);

    let message = 'Axon WebUI 状态\n\n';
    message += '会话信息:\n';
    message += `  会话 ID: ${ctx.sessionId.slice(0, 8)}\n`;
    message += `  消息数: ${history.length}\n`;
    message += `  模型: ${ctx.model}\n\n`;
    message += 'API 连接:\n';
    message += `  状态: ${apiKeySet ? '✓ 已连接' : '✗ 未连接'}\n`;
    message += `  API Key: ${apiKeySet ? '✓ 已配置' : '✗ 未配置'}\n\n`;
    message += '环境:\n';
    message += `  工作目录: ${ctx.cwd}\n`;
    message += `  平台: ${process.platform}\n`;
    message += `  Node.js: ${process.version}\n`;

    return { success: true, message, dialogType: 'text' };
  },
};

// /model
const modelCommand: SlashCommand = {
  name: 'model',
  aliases: ['m'],
  description: '查看或切换当前模型',
  usage: '/model [opus|sonnet|haiku]',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      const modelMap: Record<string, string> = {
        opus: 'Claude Opus 4.6 (最强大)',
        sonnet: 'Claude Sonnet 4.5 (平衡)',
        haiku: 'Claude Haiku 4.5 (快速)',
      };
      let message = `当前模型: ${modelMap[ctx.model] || ctx.model}\n\n`;
      message += '可用模型:\n';
      message += '  opus   - Claude Opus 4.6 (最强大，适合复杂任务)\n';
      message += '  sonnet - Claude Sonnet 4.5 (平衡，适合日常任务)\n';
      message += '  haiku  - Claude Haiku 4.5 (快速，适合简单任务)\n\n';
      message += '使用 /model <模型名> 切换模型';
      return { success: true, message, dialogType: 'text' };
    }

    const newModel = args[0].toLowerCase();
    const validModels = ['opus', 'sonnet', 'haiku'];
    if (!validModels.includes(newModel)) {
      return { success: false, message: `无效的模型: ${newModel}\n\n可用模型: opus, sonnet, haiku`, dialogType: 'text' };
    }

    ctx.conversationManager.setModel(ctx.sessionId, newModel);
    return { success: true, message: `已切换到 ${newModel} 模型`, dialogType: 'text' };
  },
};

// /cost
const costCommand: SlashCommand = {
  name: 'cost',
  description: '显示当前会话费用',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);

    let totalInput = 0;
    let totalOutput = 0;
    for (const msg of history) {
      if (msg.usage) {
        totalInput += msg.usage.inputTokens || 0;
        totalOutput += msg.usage.outputTokens || 0;
      }
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

    let message = '会话费用统计\n\n';
    message += '当前会话:\n';
    message += `  消息数: ${history.length}\n`;
    message += `  输入 tokens: ${totalInput.toLocaleString()}\n`;
    message += `  输出 tokens: ${totalOutput.toLocaleString()}\n`;
    message += `  估算费用: $${totalCost.toFixed(4)}\n\n`;
    message += `定价参考 (${pricing.name}):\n`;
    message += `  输入: $${pricing.input} / 1M tokens\n`;
    message += `  输出: $${pricing.output} / 1M tokens`;

    return { success: true, message, dialogType: 'text' };
  },
};

// /config
const configCommand: SlashCommand = {
  name: 'config',
  aliases: ['settings'],
  description: '显示当前配置',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY);
    let message = '当前配置\n\n';
    message += `会话 ID: ${ctx.sessionId}\n`;
    message += `模型: ${ctx.model}\n`;
    message += `工作目录: ${ctx.cwd}\n`;
    message += `平台: ${process.platform}\n`;
    message += `Node.js: ${process.version}\n\n`;
    message += `API 状态:\n`;
    message += `  API Key: ${apiKeySet ? '✓ 已配置' : '✗ 未配置'}\n`;
    return { success: true, message, dialogType: 'text' };
  },
};

// /compact - 真实压缩上下文
const compactCommand: SlashCommand = {
  name: 'compact',
  aliases: ['c'],
  description: '压缩对话历史以释放上下文',
  category: 'session',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const result = await ctx.conversationManager.compactSession(ctx.sessionId);

    if (!result.success) {
      return {
        success: false,
        message: result.error || '压缩失败',
        dialogType: 'compact-result',
      };
    }

    let message = '上下文压缩完成\n\n';
    message += `节省 tokens: ~${result.savedTokens?.toLocaleString() || '未知'}\n`;
    message += `压缩前消息数: ${result.messagesBefore || '未知'}\n`;
    message += `压缩后消息数: ${result.messagesAfter || '未知'}`;

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
  description: '恢复之前的对话',
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
          message: '没有可恢复的历史会话。',
          dialogType: 'text',
        };
      }

      return {
        success: true,
        message: '选择要恢复的会话',
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
        message: `会话 ${targetSessionId} 不存在或恢复失败。`,
        dialogType: 'text',
      };
    }

    return {
      success: true,
      message: `会话已恢复: ${targetSessionId.slice(0, 8)}...`,
      dialogType: 'text',
      data: { switchToSessionId: targetSessionId },
    };
  },
};

// /tasks
const tasksCommand: SlashCommand = {
  name: 'tasks',
  aliases: ['bashes'],
  description: '列出和管理后台 Agent 任务',
  usage: '/tasks [list|cancel <id>|output <id>]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager, sessionId } = ctx;

    const taskManager = conversationManager.getTaskManager(sessionId);
    if (!taskManager) {
      return { success: false, message: '任务管理器未初始化。', dialogType: 'text' };
    }

    const formatTaskDetail = (task: ReturnType<typeof taskManager.getTask>) => {
      if (!task) return '';
      let message = `任务详情: ${task.description}\n`;
      message += '='.repeat(50) + '\n\n';
      message += `ID: ${task.id}\n`;
      message += `类型: ${task.agentType}\n`;
      message += `状态: ${task.status}\n`;
      message += `开始时间: ${task.startTime.toLocaleString('zh-CN')}\n`;
      if (task.endTime) {
        const duration = ((task.endTime.getTime() - task.startTime.getTime()) / 1000).toFixed(1);
        message += `结束时间: ${task.endTime.toLocaleString('zh-CN')}\n`;
        message += `耗时: ${duration}s\n`;
      }
      if (task.progress) {
        message += `\n进度: ${task.progress.current}/${task.progress.total}\n`;
        if (task.progress.message) message += `消息: ${task.progress.message}\n`;
      }
      const output = taskManager.getTaskOutput(task.id);
      if (output) {
        message += `\n输出:\n${'-'.repeat(50)}\n${output}\n`;
      } else if (task.status === 'running') {
        message += '\n任务正在运行中，暂无输出。\n';
      } else if (task.error) {
        message += `\n错误:\n${task.error}\n`;
      }
      return message;
    };

    if (!args || args.length === 0) {
      const tasks = taskManager.listTasks();
      if (tasks.length === 0) {
        return { success: true, message: '没有后台任务。', dialogType: 'text' };
      }
      if (tasks.length === 1) {
        return { success: true, message: formatTaskDetail(tasks[0]), dialogType: 'text' };
      }

      let message = '后台任务列表\n\n';
      tasks.forEach((task, idx) => {
        const duration = task.endTime
          ? ((task.endTime.getTime() - task.startTime.getTime()) / 1000).toFixed(1) + 's'
          : '运行中...';
        const statusEmoji = { running: '⏳', completed: '✅', failed: '❌', cancelled: '🚫' }[task.status] || '?';
        message += `${idx + 1}. ${statusEmoji} ${task.description}\n`;
        message += `   ID: ${task.id.slice(0, 8)}\n`;
        message += `   状态: ${task.status} | 时长: ${duration}\n`;
        if (task.progress) {
          message += `   进度: ${task.progress.current}/${task.progress.total}`;
          if (task.progress.message) message += ` - ${task.progress.message}`;
          message += '\n';
        }
        message += '\n';
      });
      message += '使用 /tasks output <id> 查看任务输出\n';
      message += '使用 /tasks cancel <id> 取消运行中的任务';
      return { success: true, message, dialogType: 'text' };
    }

    const subcommand = args[0].toLowerCase();

    if (subcommand === 'cancel') {
      if (args.length < 2) return { success: false, message: '用法: /tasks cancel <task-id>', dialogType: 'text' };
      const taskId = args[1];
      const task = taskManager.getTask(taskId);
      if (!task) return { success: false, message: `任务 ${taskId} 不存在`, dialogType: 'text' };
      const success = taskManager.cancelTask(taskId);
      return success
        ? { success: true, message: `任务 ${taskId.slice(0, 8)} 已取消`, dialogType: 'text' }
        : { success: false, message: `无法取消任务 ${taskId.slice(0, 8)}（可能已经完成）`, dialogType: 'text' };
    }

    if (subcommand === 'output' || subcommand === 'o') {
      if (args.length < 2) return { success: false, message: '用法: /tasks output <task-id>', dialogType: 'text' };
      const taskId = args[1];
      const task = taskManager.getTask(taskId);
      if (!task) return { success: false, message: `任务 ${taskId} 不存在`, dialogType: 'text' };
      return { success: true, message: formatTaskDetail(task), dialogType: 'text' };
    }

    if (subcommand === 'list' || subcommand === 'ls') {
      return tasksCommand.execute({ ...ctx, args: [] });
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n用法:\n  /tasks          - 列出所有任务\n  /tasks cancel <id>  - 取消任务\n  /tasks output <id>  - 查看任务输出`,
      dialogType: 'text',
    };
  },
};

// /doctor
const doctorCommand: SlashCommand = {
  name: 'doctor',
  description: '运行系统诊断检查',
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
        message: `运行诊断失败: ${error instanceof Error ? error.message : '未知错误'}`,
        dialogType: 'text',
      };
    }
  },
};

// /mcp
const mcpCommand: SlashCommand = {
  name: 'mcp',
  description: '管理 MCP 服务器',
  usage: '/mcp [list|add|remove|toggle] [参数]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager } = ctx;

    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const servers = conversationManager.listMcpServers();
        if (servers.length === 0) {
          return { success: true, message: '没有配置 MCP 服务器。\n\n使用 /mcp add <name> <command> 添加服务器。', dialogType: 'text' };
        }

        let message = 'MCP 服务器列表\n\n';
        servers.forEach((server, idx) => {
          const statusIcon = server.enabled ? '✓' : '✗';
          message += `${idx + 1}. ${statusIcon} ${server.name}\n`;
          message += `   类型: ${server.type}\n`;
          if (server.type === 'stdio' && server.command) {
            message += `   命令: ${server.command}${server.args?.length ? ' ' + server.args.join(' ') : ''}\n`;
          } else if (server.url) {
            message += `   URL: ${server.url}\n`;
          }
          message += '\n';
        });
        message += '命令: /mcp add|remove|toggle <name>';
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `列出 MCP 服务器失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    const sub = args[0].toLowerCase();

    if (sub === 'add') {
      if (args.length < 3) return { success: false, message: '用法: /mcp add <name> <command> [args...]', dialogType: 'text' };
      const name = args[1], command = args[2], cmdArgs = args.slice(3);
      try {
        const success = await conversationManager.addMcpServer(name, { type: 'stdio', command, args: cmdArgs.length > 0 ? cmdArgs : undefined, enabled: true });
        return success
          ? { success: true, message: `已添加 MCP 服务器: ${name}`, dialogType: 'text' }
          : { success: false, message: `添加 MCP 服务器 ${name} 失败`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `添加失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'remove') {
      if (args.length < 2) return { success: false, message: '用法: /mcp remove <name>', dialogType: 'text' };
      try {
        const success = await conversationManager.removeMcpServer(args[1]);
        return success
          ? { success: true, message: `已删除 MCP 服务器: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `MCP 服务器 ${args[1]} 不存在`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `删除失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'toggle' || sub === 'enable' || sub === 'disable') {
      if (args.length < 2) return { success: false, message: `用法: /mcp ${sub} <name>`, dialogType: 'text' };
      const enabled = sub === 'enable' ? true : sub === 'disable' ? false : undefined;
      try {
        const result = await conversationManager.toggleMcpServer(args[1], enabled);
        return result.success
          ? { success: true, message: `MCP 服务器 ${args[1]} 已${result.enabled ? '启用' : '禁用'}`, dialogType: 'text' }
          : { success: false, message: `MCP 服务器 ${args[1]} 不存在`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `操作失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    return { success: false, message: '可用命令: list, add, remove, toggle', dialogType: 'text' };
  },
};

// /plugin
const pluginCommand: SlashCommand = {
  name: 'plugin',
  aliases: ['plugins'],
  description: '管理 Axon 插件',
  usage: '/plugin [list|info|enable|disable|uninstall] [参数]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager } = ctx;

    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const plugins = await conversationManager.listPlugins();
        if (plugins.length === 0) {
          return { success: true, message: '没有安装插件。\n\n插件安装在: ~/.axon/plugins/', dialogType: 'text' };
        }

        let message = '插件列表\n\n';
        plugins.forEach((plugin, idx) => {
          const statusIcon = plugin.loaded ? '✓' : plugin.enabled ? '○' : '✗';
          message += `${idx + 1}. ${statusIcon} ${plugin.name} v${plugin.version}\n`;
          if (plugin.description) message += `   ${plugin.description}\n`;
          message += `   状态: ${plugin.loaded ? '已加载' : plugin.enabled ? '已启用' : '已禁用'}\n\n`;
        });
        message += '命令: /plugin info|enable|disable|uninstall <name>';
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `列出插件失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    const sub = args[0].toLowerCase();

    if (sub === 'info' && args.length >= 2) {
      try {
        const plugin = await conversationManager.getPluginInfo(args[1]);
        if (!plugin) return { success: false, message: `插件 ${args[1]} 不存在`, dialogType: 'text' };
        let message = `${plugin.name} v${plugin.version}\n`;
        if (plugin.description) message += `${plugin.description}\n`;
        if (plugin.author) message += `作者: ${plugin.author}\n`;
        message += `状态: ${plugin.loaded ? '已加载' : plugin.enabled ? '已启用' : '已禁用'}\n`;
        if (plugin.path) message += `路径: ${plugin.path}\n`;
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `获取插件信息失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'enable' && args.length >= 2) {
      try {
        const success = await conversationManager.enablePlugin(args[1]);
        return success
          ? { success: true, message: `已启用插件: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `启用插件 ${args[1]} 失败`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `启用失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'disable' && args.length >= 2) {
      try {
        const success = await conversationManager.disablePlugin(args[1]);
        return success
          ? { success: true, message: `已禁用插件: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `禁用插件 ${args[1]} 失败`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `禁用失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if ((sub === 'uninstall' || sub === 'remove') && args.length >= 2) {
      try {
        const success = await conversationManager.uninstallPlugin(args[1]);
        return success
          ? { success: true, message: `已卸载插件: ${args[1]}`, dialogType: 'text' }
          : { success: false, message: `卸载插件 ${args[1]} 失败`, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `卸载失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    return { success: false, message: '可用命令: list, info, enable, disable, uninstall', dialogType: 'text' };
  },
};

// /login
const loginCommand: SlashCommand = {
  name: 'login',
  aliases: ['auth'],
  description: '管理认证和 API 密钥',
  usage: '/login [status|set <key>|clear]',
  category: 'auth',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const { webAuth } = await import('./web-auth.js');

    if (!args || args.length === 0 || args[0] === 'status') {
      try {
        const status = webAuth.getStatus();
        const maskedKey = webAuth.getMaskedApiKey();
        let message = '认证状态\n\n';
        message += `认证: ${status.authenticated ? '✓ 已认证' : '✗ 未认证'}\n`;
        message += `类型: ${status.type === 'api_key' ? 'API密钥' : status.type === 'oauth' ? 'OAuth' : '无'}\n`;
        if (maskedKey) message += `API密钥: ${maskedKey}\n`;
        message += '\n命令: /login set <key> | /login clear | /logout';
        return { success: true, message, dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `获取认证状态失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    const sub = args[0].toLowerCase();

    if (sub === 'set' && args.length >= 2) {
      try {
        const apiKey = args.slice(1).join(' ');
        const success = webAuth.setApiKey(apiKey);
        if (success) {
          return { success: true, message: `API密钥已设置: ${webAuth.getMaskedApiKey()}`, dialogType: 'text' };
        }
        return { success: false, message: '设置API密钥失败，请检查格式。', dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `设置失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    if (sub === 'clear') {
      try {
        webAuth.clearAll();
        return { success: true, message: '认证已清除。', dialogType: 'text' };
      } catch (error) {
        return { success: false, message: `清除失败: ${error instanceof Error ? error.message : String(error)}`, dialogType: 'text' };
      }
    }

    return { success: false, message: '可用命令: status, set <key>, clear', dialogType: 'text' };
  },
};

// /logout
const logoutCommand: SlashCommand = {
  name: 'logout',
  description: '登出（清除 API 密钥）',
  category: 'auth',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    return loginCommand.execute({ ...ctx, args: ['clear'] });
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
