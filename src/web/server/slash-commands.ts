/**
 * WebUI 斜杠命令系统
 * 提供类似 CLI 的命令接口
 */

import type { ConversationManager } from './conversation.js';
import type { WebSocket } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SessionInfo } from '../shared/types.js';

// ============ 类型定义 ============

/**
 * 命令执行上下文 (WebUI 版本)
 */
export interface CommandContext {
  conversationManager: ConversationManager;
  ws: WebSocket;
  sessionId: string;
  cwd: string;
  model: string;
}

/**
 * 扩展的命令执行上下文（包含命令参数）
 */
export interface ExtendedCommandContext extends CommandContext {
  args: string[];
  rawInput: string;
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
  action?: 'clear' | 'reload' | 'none';
}

/**
 * 斜杠命令接口
 */
export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  category: 'general' | 'session' | 'config' | 'utility' | 'integration' | 'auth' | 'development';
  execute: (ctx: ExtendedCommandContext) => Promise<CommandResult> | CommandResult;
}

// ============ 命令注册表 ============

/**
 * 斜杠命令注册表
 */
export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private aliases = new Map<string, string>();

  /**
   * 注册命令
   */
  register(command: SlashCommand): void {
    this.commands.set(command.name, command);

    // 注册别名
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }
  }

  /**
   * 获取命令
   */
  get(name: string): SlashCommand | undefined {
    // 先检查直接命令名
    const cmd = this.commands.get(name);
    if (cmd) return cmd;

    // 检查别名
    const aliasedName = this.aliases.get(name);
    if (aliasedName) {
      return this.commands.get(aliasedName);
    }

    return undefined;
  }

  /**
   * 获取所有命令
   */
  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * 按类别获取命令
   */
  getByCategory(category: string): SlashCommand[] {
    return this.getAll().filter(cmd => cmd.category === category);
  }

  /**
   * 执行命令
   */
  async execute(input: string, ctx: CommandContext): Promise<CommandResult> {
    // 解析命令和参数
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return {
        success: false,
        message: 'Not a slash command',
      };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const command = this.get(commandName);

    if (!command) {
      return {
        success: false,
        message: `未知命令: /${commandName}\n\n使用 /help 查看所有可用命令。`,
      };
    }

    try {
      // 创建扩展的上下文
      const extendedCtx: ExtendedCommandContext = {
        ...ctx,
        args,
        rawInput: trimmed,
      };

      return await command.execute(extendedCtx);
    } catch (error) {
      return {
        success: false,
        message: `执行 /${commandName} 时出错: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取帮助文本
   */
  getHelp(): string {
    const categories = {
      general: '通用命令',
      session: '会话管理',
      config: '配置',
      utility: '工具',
      integration: '集成',
      auth: '认证',
      development: '开发',
    };

    const categoryOrder: Array<keyof typeof categories> = ['general', 'session', 'config', 'utility', 'integration', 'auth', 'development'];

    let help = '\n可用命令\n';
    help += '='.repeat(50) + '\n\n';

    for (const category of categoryOrder) {
      const cmds = this.getByCategory(category);
      if (cmds.length === 0) continue;

      help += `${categories[category]}\n`;
      help += '-'.repeat(categories[category].length) + '\n';

      for (const cmd of cmds.sort((a, b) => a.name.localeCompare(b.name))) {
        const cmdDisplay = `/${cmd.name}`;
        const aliasStr = cmd.aliases && cmd.aliases.length > 0
          ? ` (${cmd.aliases.map(a => '/' + a).join(', ')})`
          : '';
        help += `  ${cmdDisplay.padEnd(20)}${cmd.description}${aliasStr}\n`;
      }
      help += '\n';
    }

    help += '\n使用 /help <命令> 查看特定命令的详细信息。\n';

    return help;
  }
}

// ============ 核心命令实现 ============

// /help - 显示帮助信息
const helpCommand: SlashCommand = {
  name: 'help',
  aliases: ['?'],
  description: '显示所有可用命令',
  usage: '/help [命令名]',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (args && args.length > 0) {
      // 显示特定命令的帮助
      const cmdName = args[0].replace(/^\//, '');
      const cmd = registry.get(cmdName);

      if (cmd) {
        let helpText = `\n/${cmd.name}\n`;
        helpText += '='.repeat(cmd.name.length + 1) + '\n\n';
        helpText += `${cmd.description}\n\n`;

        if (cmd.usage) {
          helpText += `用法:\n  ${cmd.usage}\n\n`;
        }

        if (cmd.aliases && cmd.aliases.length > 0) {
          helpText += `别名:\n  ${cmd.aliases.map(a => '/' + a).join(', ')}\n\n`;
        }

        helpText += `类别: ${cmd.category}\n`;

        return { success: true, message: helpText };
      } else {
        return {
          success: false,
          message: `未知命令: /${cmdName}\n\n使用 /help 查看所有可用命令。`,
        };
      }
    }

    // 显示所有命令
    return {
      success: true,
      message: registry.getHelp(),
    };
  },
};

// /clear - 清除对话历史
const clearCommand: SlashCommand = {
  name: 'clear',
  aliases: ['reset', 'new'],
  description: '清除对话历史',
  category: 'general',
  execute: (ctx: CommandContext): CommandResult => {
    ctx.conversationManager.clearHistory(ctx.sessionId);
    return {
      success: true,
      message: '对话已清除。上下文已释放。',
      action: 'clear',
    };
  },
};

// /model - 查看或切换模型
const modelCommand: SlashCommand = {
  name: 'model',
  aliases: ['m'],
  description: '查看或切换当前模型',
  usage: '/model [opus|sonnet|haiku]',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      // 显示当前模型
      const modelMap: Record<string, string> = {
        opus: 'Claude Opus 4.6 (最强大)',
        sonnet: 'Claude Sonnet 4.5 (平衡)',
        haiku: 'Claude Haiku 4.5 (快速)',
      };

      let message = `当前模型: ${modelMap[ctx.model] || ctx.model}\n\n`;
      message += '可用模型:\n';
      message += '  opus   - Claude Opus 4.6 (最强大，推荐，适合复杂任务)\n';
      message += '  sonnet - Claude Sonnet 4.5 (平衡，适合日常任务)\n';
      message += '  haiku  - Claude Haiku 4.5 (快速，适合简单任务)\n\n';
      message += '使用 /model <模型名> 切换模型';

      return { success: true, message };
    }

    const newModel = args[0].toLowerCase();
    const validModels = ['opus', 'sonnet', 'haiku'];

    if (!validModels.includes(newModel)) {
      return {
        success: false,
        message: `无效的模型: ${newModel}\n\n可用模型: opus, sonnet, haiku`,
      };
    }

    ctx.conversationManager.setModel(ctx.sessionId, newModel);
    return {
      success: true,
      message: `已切换到 ${newModel} 模型`,
    };
  },
};

// /cost - 显示费用
const costCommand: SlashCommand = {
  name: 'cost',
  description: '显示当前会话费用',
  category: 'utility',
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

    // 根据模型获取定价
    const modelPricing: Record<string, { input: number; output: number; name: string }> = {
      opus: { input: 15, output: 75, name: 'Claude Opus 4.6' },
      sonnet: { input: 3, output: 15, name: 'Claude Sonnet 4.5' },
      haiku: { input: 0.8, output: 4, name: 'Claude Haiku 4.5' },
    };

    const pricing = modelPricing[ctx.model] || modelPricing.opus;

    // 计算费用（每百万 tokens 的价格）
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

    return { success: true, message };
  },
};

// /compact - 压缩上下文
const compactCommand: SlashCommand = {
  name: 'compact',
  aliases: ['c'],
  description: '压缩对话历史以释放上下文',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);

    if (history.length === 0) {
      return {
        success: false,
        message: '没有对话历史需要压缩。\n\n开始对话后，可以使用 /compact 释放上下文空间。',
      };
    }

    // WebUI 目前不支持真正的压缩，但可以提供信息
    let message = '上下文压缩\n\n';
    message += `当前状态:\n`;
    message += `  消息数: ${history.length}\n\n`;
    message += '注意: WebUI 目前不支持自动压缩。\n';
    message += '如需释放上下文，请使用 /clear 清除历史。\n\n';
    message += '提示:\n';
    message += '  • 较长的对话会消耗更多上下文\n';
    message += '  • 可以使用 /clear 开始新对话\n';
    message += '  • 未来版本将支持智能压缩';

    return { success: true, message };
  },
};

// /config - 显示当前配置
const configCommand: SlashCommand = {
  name: 'config',
  description: '显示当前配置',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    let message = '当前配置\n\n';
    message += `会话 ID: ${ctx.sessionId}\n`;
    message += `模型: ${ctx.model}\n`;
    message += `工作目录: ${ctx.cwd}\n`;
    message += `平台: ${process.platform}\n`;
    message += `Node.js: ${process.version}\n\n`;

    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    message += `API 状态:\n`;
    message += `  API Key: ${apiKeySet ? '✓ 已配置' : '✗ 未配置'}\n`;

    return { success: true, message };
  },
};

// /resume - 恢复指定会话
const resumeCommand: SlashCommand = {
  name: 'resume',
  aliases: ['r'],
  description: '恢复指定会话',
  usage: '/resume <session-id>',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      return {
        success: false,
        message: '用法: /resume <session-id>\n\n使用 /sessions 查看可用的会话。',
      };
    }

    return {
      success: false,
      message: '会话恢复\n\n' +
        '请使用 WebUI 界面的会话管理功能切换会话。\n\n' +
        '提示:\n' +
        '  • 使用 /sessions 查看所有会话\n' +
        '  • 通过 WebUI 界面侧边栏切换会话\n' +
        '  • 会话会自动保存到 ~/.claude/sessions/',
    };
  },
};

// /status - 显示状态
const statusCommand: SlashCommand = {
  name: 'status',
  description: '显示系统状态',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);
    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

    let message = 'Claude Code WebUI 状态\n\n';

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
    message += `  Node.js: ${process.version}\n\n`;

    message += '工具状态:\n';
    message += '  ✓ Bash 可用\n';
    message += '  ✓ 文件操作可用\n';
    message += '  ✓ Web 访问可用';

    return { success: true, message };
  },
};

// ============ 注册所有命令 ============

export const registry = new SlashCommandRegistry();

// 注册核心命令
registry.register(helpCommand);
registry.register(clearCommand);
registry.register(modelCommand);
registry.register(costCommand);
registry.register(compactCommand);
registry.register(configCommand);
registry.register(resumeCommand);
registry.register(statusCommand);

// /tasks - 管理后台任务
const tasksCommand: SlashCommand = {
  name: 'tasks',
  aliases: ['task'],
  description: '列出和管理后台 Agent 任务',
  usage: '/tasks [list|cancel <id>|output <id>]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager, sessionId } = ctx;

    const taskManager = conversationManager.getTaskManager(sessionId);
    if (!taskManager) {
      return {
        success: false,
        message: '任务管理器未初始化。',
      };
    }

    // 生成单个任务详情的辅助函数
    const formatTaskDetail = (task: ReturnType<typeof taskManager.getTask>) => {
      if (!task) return '';

      let message = `任务详情: ${task.description}\n`;
      message += `=`.repeat(50) + '\n\n';
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
        if (task.progress.message) {
          message += `消息: ${task.progress.message}\n`;
        }
      }

      const output = taskManager.getTaskOutput(task.id);
      if (output) {
        message += `\n输出:\n${'-'.repeat(50)}\n${output}\n`;
      } else if (task.status === 'running') {
        message += `\n任务正在运行中，暂无输出。\n`;
      } else if (task.error) {
        message += `\n错误:\n${task.error}\n`;
      }

      return message;
    };

    // 默认行为：列出所有任务
    if (!args || args.length === 0) {
      const tasks = taskManager.listTasks();

      if (tasks.length === 0) {
        return {
          success: true,
          message: '没有后台任务。',
        };
      }

      // v2.1.6 改进：只有一个任务时直接显示详情
      if (tasks.length === 1) {
        const task = tasks[0];
        return {
          success: true,
          message: formatTaskDetail(task),
        };
      }

      // 多个任务时：显示列表
      let message = '后台任务列表\n\n';

      tasks.forEach((task, idx) => {
        const duration = task.endTime
          ? ((task.endTime.getTime() - task.startTime.getTime()) / 1000).toFixed(1) + 's'
          : '运行中...';

        const statusEmoji = {
          running: '⏳',
          completed: '✅',
          failed: '❌',
          cancelled: '🚫',
        }[task.status] || '?';

        message += `${idx + 1}. ${statusEmoji} ${task.description}\n`;
        message += `   ID: ${task.id.slice(0, 8)}\n`;
        message += `   类型: ${task.agentType}\n`;
        message += `   状态: ${task.status}\n`;
        message += `   时长: ${duration}\n`;

        if (task.progress) {
          message += `   进度: ${task.progress.current}/${task.progress.total}`;
          if (task.progress.message) {
            message += ` - ${task.progress.message}`;
          }
          message += '\n';
        }

        message += '\n';
      });

      message += '使用 /tasks output <id> 查看任务输出\n';
      message += '使用 /tasks cancel <id> 取消运行中的任务';

      return { success: true, message };
    }

    const subcommand = args[0].toLowerCase();

    // /tasks cancel <id>
    if (subcommand === 'cancel') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /tasks cancel <task-id>',
        };
      }

      const taskId = args[1];
      const task = taskManager.getTask(taskId);

      if (!task) {
        return {
          success: false,
          message: `任务 ${taskId} 不存在`,
        };
      }

      const success = taskManager.cancelTask(taskId);

      if (success) {
        return {
          success: true,
          message: `任务 ${taskId.slice(0, 8)} 已取消`,
        };
      } else {
        return {
          success: false,
          message: `无法取消任务 ${taskId.slice(0, 8)}（可能已经完成）`,
        };
      }
    }

    // /tasks output <id>
    if (subcommand === 'output' || subcommand === 'o') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /tasks output <task-id>',
        };
      }

      const taskId = args[1];
      const task = taskManager.getTask(taskId);

      if (!task) {
        return {
          success: false,
          message: `任务 ${taskId} 不存在`,
        };
      }

      return { success: true, message: formatTaskDetail(task) };
    }

    // /tasks list (等同于默认行为)
    if (subcommand === 'list' || subcommand === 'ls') {
      // 重新调用默认行为
      return tasksCommand.execute({ ...ctx, args: [] });
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n用法:\n  /tasks          - 列出所有任务\n  /tasks cancel <id>  - 取消任务\n  /tasks output <id>  - 查看任务输出`,
    };
  },
};

// /doctor - 系统诊断命令
const doctorCommand: SlashCommand = {
  name: 'doctor',
  description: '运行系统诊断检查',
  usage: '/doctor [verbose]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const verbose = args.includes('verbose') || args.includes('v') || args.includes('-v');

    try {
      // 动态导入 doctor 模块
      const { runDiagnostics, formatDoctorReport } = await import('./doctor.js');

      const options = {
        verbose,
        includeSystemInfo: true,
      };

      let message = '正在运行系统诊断...\n\n';

      const report = await runDiagnostics(options);
      const formattedText = formatDoctorReport(report, verbose);

      message = formattedText;

      return {
        success: true,
        message,
        data: {
          report: {
            ...report,
            timestamp: report.timestamp.getTime(),
          },
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `运行诊断失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};

// /mcp - 管理 MCP 服务器
const mcpCommand: SlashCommand = {
  name: 'mcp',
  description: '管理 MCP (Model Context Protocol) 服务器',
  usage: '/mcp [list|add|remove|toggle] [参数]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager } = ctx;

    // 默认行为：列出所有 MCP 服务器
    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const servers = conversationManager.listMcpServers();

        if (servers.length === 0) {
          return {
            success: true,
            message: '没有配置 MCP 服务器。\n\n使用 /mcp add <name> <command> 添加服务器。',
          };
        }

        let message = 'MCP 服务器列表\n\n';

        servers.forEach((server, idx) => {
          const statusIcon = server.enabled ? '✓' : '✗';
          const typeLabel = {
            stdio: '标准输入输出',
            sse: 'SSE',
            http: 'HTTP',
          }[server.type] || server.type;

          message += `${idx + 1}. ${statusIcon} ${server.name}\n`;
          message += `   类型: ${typeLabel}\n`;

          if (server.type === 'stdio' && server.command) {
            message += `   命令: ${server.command}`;
            if (server.args && server.args.length > 0) {
              message += ` ${server.args.join(' ')}`;
            }
            message += '\n';
          } else if (server.url) {
            message += `   URL: ${server.url}\n`;
          }

          if (server.env && Object.keys(server.env).length > 0) {
            message += `   环境变量: ${Object.keys(server.env).length} 个\n`;
          }

          message += '\n';
        });

        message += '使用命令:\n';
        message += '  /mcp add <name> <command>    - 添加服务器\n';
        message += '  /mcp remove <name>           - 删除服务器\n';
        message += '  /mcp toggle <name>           - 启用/禁用服务器';

        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          message: `列出 MCP 服务器失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const subcommand = args[0].toLowerCase();

    // /mcp add <name> <command> [args...]
    if (subcommand === 'add') {
      if (args.length < 3) {
        return {
          success: false,
          message: '用法: /mcp add <name> <command> [args...]\n\n示例: /mcp add my-server node /path/to/server.js',
        };
      }

      const name = args[1];
      const command = args[2];
      const cmdArgs = args.slice(3);

      try {
        const success = await conversationManager.addMcpServer(name, {
          type: 'stdio',
          command,
          args: cmdArgs.length > 0 ? cmdArgs : undefined,
          enabled: true,
        });

        if (success) {
          return {
            success: true,
            message: `已添加 MCP 服务器: ${name}\n\n命令: ${command} ${cmdArgs.join(' ')}\n类型: stdio\n状态: 已启用`,
          };
        } else {
          return {
            success: false,
            message: `添加 MCP 服务器 ${name} 失败。\n\n可能原因:\n  • 服务器名称已存在\n  • 配置无效`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `添加 MCP 服务器失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /mcp remove <name>
    if (subcommand === 'remove') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /mcp remove <name>\n\n示例: /mcp remove my-server',
        };
      }

      const name = args[1];

      try {
        const success = await conversationManager.removeMcpServer(name);

        if (success) {
          return {
            success: true,
            message: `已删除 MCP 服务器: ${name}`,
          };
        } else {
          return {
            success: false,
            message: `MCP 服务器 ${name} 不存在。\n\n使用 /mcp list 查看所有服务器。`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `删除 MCP 服务器失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /mcp toggle <name>
    if (subcommand === 'toggle' || subcommand === 'enable' || subcommand === 'disable') {
      if (args.length < 2) {
        return {
          success: false,
          message: `用法: /mcp ${subcommand} <name>\n\n示例: /mcp ${subcommand} my-server`,
        };
      }

      const name = args[1];
      let enabled: boolean | undefined = undefined;

      if (subcommand === 'enable') {
        enabled = true;
      } else if (subcommand === 'disable') {
        enabled = false;
      }

      try {
        const result = await conversationManager.toggleMcpServer(name, enabled);

        if (result.success) {
          return {
            success: true,
            message: `MCP 服务器 ${name} 已${result.enabled ? '启用' : '禁用'}`,
          };
        } else {
          return {
            success: false,
            message: `MCP 服务器 ${name} 不存在。\n\n使用 /mcp list 查看所有服务器。`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `切换 MCP 服务器失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n可用命令:\n  list   - 列出所有服务器\n  add    - 添加服务器\n  remove - 删除服务器\n  toggle - 启用/禁用服务器`,
    };
  },
};

// /checkpoint - 管理文件检查点
const checkpointCommand: SlashCommand = {
  name: 'checkpoint',
  aliases: ['cp'],
  description: '管理文件检查点（保存和恢复文件状态）',
  usage: '/checkpoint [list|create|restore|delete|diff|clear] [参数]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;

    // 动态导入 CheckpointManager
    const { CheckpointManager } = await import('./checkpoint-manager.js');
    const checkpointManager = new CheckpointManager();

    // 默认行为：列出所有检查点
    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const checkpoints = checkpointManager.listCheckpoints({
          limit: 20,
          sortBy: 'timestamp',
          sortOrder: 'desc',
        });

        if (checkpoints.length === 0) {
          return {
            success: true,
            message: '没有检查点。\n\n使用 /checkpoint create <描述> <文件1> [文件2...] 创建检查点。',
          };
        }

        const stats = checkpointManager.getStats();

        let message = '检查点列表\n\n';

        checkpoints.forEach((cp, idx) => {
          const date = new Date(cp.timestamp).toLocaleString('zh-CN');
          const fileCount = cp.files.length;
          const totalSize = cp.files.reduce((sum, f) => sum + f.size, 0);
          const sizeKB = (totalSize / 1024).toFixed(2);

          message += `${idx + 1}. ${cp.description}\n`;
          message += `   ID: ${cp.id.slice(0, 8)}\n`;
          message += `   时间: ${date}\n`;
          message += `   文件: ${fileCount} 个 (${sizeKB} KB)\n`;
          if (cp.metadata?.tags && cp.metadata.tags.length > 0) {
            message += `   标签: ${cp.metadata.tags.join(', ')}\n`;
          }
          message += '\n';
        });

        message += `总计: ${stats.total} 个检查点, ${stats.totalFiles} 个文件, ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB\n\n`;
        message += '使用命令:\n';
        message += '  /checkpoint create <描述> <文件...>  - 创建检查点\n';
        message += '  /checkpoint restore <id>             - 恢复检查点\n';
        message += '  /checkpoint diff <id>                - 查看差异\n';
        message += '  /checkpoint delete <id>              - 删除检查点\n';
        message += '  /checkpoint clear                    - 清除所有检查点';

        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          message: `列出检查点失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const subcommand = args[0].toLowerCase();

    // /checkpoint create <description> <file1> [file2...]
    if (subcommand === 'create') {
      if (args.length < 3) {
        return {
          success: false,
          message: '用法: /checkpoint create <描述> <文件1> [文件2...]\n\n示例: /checkpoint create "功能完成前的状态" src/index.ts src/utils.ts',
        };
      }

      const description = args[1];
      const filePaths = args.slice(2);

      try {
        const checkpoint = await checkpointManager.createCheckpoint(
          description,
          filePaths,
          ctx.cwd
        );

        const totalSize = checkpoint.files.reduce((sum, f) => sum + f.size, 0);
        const sizeKB = (totalSize / 1024).toFixed(2);

        return {
          success: true,
          message: `已创建检查点\n\n` +
            `ID: ${checkpoint.id.slice(0, 8)}\n` +
            `描述: ${checkpoint.description}\n` +
            `文件: ${checkpoint.files.length} 个 (${sizeKB} KB)\n` +
            `时间: ${checkpoint.timestamp.toLocaleString('zh-CN')}\n\n` +
            `使用 /checkpoint restore ${checkpoint.id.slice(0, 8)} 恢复此检查点`,
        };
      } catch (error) {
        return {
          success: false,
          message: `创建检查点失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /checkpoint restore <id>
    if (subcommand === 'restore') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /checkpoint restore <checkpoint-id>\n\n使用 /checkpoint list 查看所有检查点。',
        };
      }

      // 支持短ID（前8位）
      const inputId = args[1];
      const checkpoints = checkpointManager.listCheckpoints({});
      const checkpoint = checkpoints.find(cp => cp.id.startsWith(inputId) || cp.id === inputId);

      if (!checkpoint) {
        return {
          success: false,
          message: `检查点 ${inputId} 不存在。\n\n使用 /checkpoint list 查看所有检查点。`,
        };
      }

      try {
        const result = await checkpointManager.restoreCheckpoint(checkpoint.id, {
          dryRun: false,
          skipBackup: false,
        });

        if (result.success) {
          return {
            success: true,
            message: `已恢复检查点: ${checkpoint.description}\n\n` +
              `恢复的文件: ${result.restored.length} 个\n` +
              `${result.restored.map(f => `  • ${f}`).join('\n')}\n\n` +
              `备份文件已创建（.backup-* 后缀）`,
          };
        } else {
          let message = `恢复检查点失败\n\n`;
          message += `成功: ${result.restored.length} 个\n`;
          if (result.restored.length > 0) {
            message += result.restored.map(f => `  ✓ ${f}`).join('\n') + '\n\n';
          }
          message += `失败: ${result.failed.length} 个\n`;
          if (result.errors.length > 0) {
            message += result.errors.map(e => `  ✗ ${e.path}: ${e.error}`).join('\n');
          }
          return { success: false, message };
        }
      } catch (error) {
        return {
          success: false,
          message: `恢复检查点失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /checkpoint delete <id>
    if (subcommand === 'delete' || subcommand === 'del' || subcommand === 'rm') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /checkpoint delete <checkpoint-id>\n\n使用 /checkpoint list 查看所有检查点。',
        };
      }

      const inputId = args[1];
      const checkpoints = checkpointManager.listCheckpoints({});
      const checkpoint = checkpoints.find(cp => cp.id.startsWith(inputId) || cp.id === inputId);

      if (!checkpoint) {
        return {
          success: false,
          message: `检查点 ${inputId} 不存在。\n\n使用 /checkpoint list 查看所有检查点。`,
        };
      }

      try {
        const success = checkpointManager.deleteCheckpoint(checkpoint.id);

        if (success) {
          return {
            success: true,
            message: `已删除检查点: ${checkpoint.description}`,
          };
        } else {
          return {
            success: false,
            message: `删除检查点失败。`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `删除检查点失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /checkpoint diff <id>
    if (subcommand === 'diff') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /checkpoint diff <checkpoint-id>\n\n使用 /checkpoint list 查看所有检查点。',
        };
      }

      const inputId = args[1];
      const checkpoints = checkpointManager.listCheckpoints({});
      const checkpoint = checkpoints.find(cp => cp.id.startsWith(inputId) || cp.id === inputId);

      if (!checkpoint) {
        return {
          success: false,
          message: `检查点 ${inputId} 不存在。\n\n使用 /checkpoint list 查看所有检查点。`,
        };
      }

      try {
        const diffs = await checkpointManager.diffCheckpoint(checkpoint.id);

        const stats = {
          added: diffs.filter(d => d.type === 'added').length,
          removed: diffs.filter(d => d.type === 'removed').length,
          modified: diffs.filter(d => d.type === 'modified').length,
          unchanged: diffs.filter(d => d.type === 'unchanged').length,
        };

        let message = `检查点差异: ${checkpoint.description}\n\n`;
        message += `统计:\n`;
        message += `  添加: ${stats.added} 个文件\n`;
        message += `  删除: ${stats.removed} 个文件\n`;
        message += `  修改: ${stats.modified} 个文件\n`;
        message += `  未变: ${stats.unchanged} 个文件\n\n`;

        if (stats.modified > 0) {
          message += `修改的文件:\n`;
          diffs.filter(d => d.type === 'modified').forEach(d => {
            message += `  • ${d.path}\n`;
          });
        }

        if (stats.removed > 0) {
          message += `\n删除的文件:\n`;
          diffs.filter(d => d.type === 'removed').forEach(d => {
            message += `  • ${d.path}\n`;
          });
        }

        if (stats.added > 0) {
          message += `\n新增的文件:\n`;
          diffs.filter(d => d.type === 'added').forEach(d => {
            message += `  • ${d.path}\n`;
          });
        }

        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          message: `比较检查点失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /checkpoint clear
    if (subcommand === 'clear') {
      try {
        const count = checkpointManager.clearCheckpoints();

        return {
          success: true,
          message: `已清除 ${count} 个检查点。`,
        };
      } catch (error) {
        return {
          success: false,
          message: `清除检查点失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n可用命令:\n  list    - 列出所有检查点\n  create  - 创建检查点\n  restore - 恢复检查点\n  delete  - 删除检查点\n  diff    - 查看差异\n  clear   - 清除所有检查点`,
    };
  },
};

// /plugins - 管理插件
const pluginsCommand: SlashCommand = {
  name: 'plugins',
  aliases: ['plugin'],
  description: '管理 Claude Code 插件',
  usage: '/plugins [list|info|enable|disable|uninstall] [参数]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, conversationManager } = ctx;

    // 默认行为：列出所有插件
    if (!args || args.length === 0 || args[0] === 'list') {
      try {
        const plugins = await conversationManager.listPlugins();

        if (plugins.length === 0) {
          return {
            success: true,
            message: '没有安装插件。\n\n插件安装在: ~/.claude/plugins/ 和 ./.claude/plugins/\n\n更多信息: https://docs.anthropic.com/claude-code/plugins',
          };
        }

        let message = '插件列表\n\n';

        plugins.forEach((plugin, idx) => {
          const statusIcon = plugin.loaded ? '✓' : plugin.enabled ? '○' : '✗';
          const statusText = plugin.loaded ? '已加载' : plugin.enabled ? '已启用' : '已禁用';

          message += `${idx + 1}. ${statusIcon} ${plugin.name} v${plugin.version}\n`;
          if (plugin.description) {
            message += `   描述: ${plugin.description}\n`;
          }
          if (plugin.author) {
            message += `   作者: ${plugin.author}\n`;
          }
          message += `   状态: ${statusText}\n`;

          // 统计提供的功能
          const features: string[] = [];
          if (plugin.tools && plugin.tools.length > 0) {
            features.push(`${plugin.tools.length} 个工具`);
          }
          if (plugin.commands && plugin.commands.length > 0) {
            features.push(`${plugin.commands.length} 个命令`);
          }
          if (plugin.skills && plugin.skills.length > 0) {
            features.push(`${plugin.skills.length} 个技能`);
          }
          if (plugin.hooks && plugin.hooks.length > 0) {
            features.push(`${plugin.hooks.length} 个钩子`);
          }

          if (features.length > 0) {
            message += `   功能: ${features.join(', ')}\n`;
          }

          if (plugin.error) {
            message += `   ⚠️  错误: ${plugin.error}\n`;
          }

          message += '\n';
        });

        message += `总计: ${plugins.length} 个插件\n`;
        message += `已加载: ${plugins.filter(p => p.loaded).length} | `;
        message += `已启用: ${plugins.filter(p => p.enabled).length} | `;
        message += `已禁用: ${plugins.filter(p => !p.enabled).length}\n\n`;

        message += '使用命令:\n';
        message += '  /plugins list              - 列出所有插件\n';
        message += '  /plugins info <name>       - 查看插件详情\n';
        message += '  /plugins enable <name>     - 启用插件\n';
        message += '  /plugins disable <name>    - 禁用插件\n';
        message += '  /plugins uninstall <name>  - 卸载插件';

        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          message: `列出插件失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const subcommand = args[0].toLowerCase();

    // /plugins info <name>
    if (subcommand === 'info') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /plugins info <插件名>\n\n示例: /plugins info my-plugin',
        };
      }

      const pluginName = args[1];

      try {
        const plugin = await conversationManager.getPluginInfo(pluginName);

        if (!plugin) {
          return {
            success: false,
            message: `插件 ${pluginName} 不存在。\n\n使用 /plugins list 查看所有插件。`,
          };
        }

        let message = `插件详情: ${plugin.name}\n`;
        message += '='.repeat(plugin.name.length + 6) + '\n\n';
        message += `版本: ${plugin.version}\n`;
        if (plugin.description) {
          message += `描述: ${plugin.description}\n`;
        }
        if (plugin.author) {
          message += `作者: ${plugin.author}\n`;
        }
        message += `状态: ${plugin.loaded ? '已加载' : plugin.enabled ? '已启用' : '已禁用'}\n`;
        message += `路径: ${plugin.path}\n\n`;

        // 显示功能详情
        if (plugin.tools && plugin.tools.length > 0) {
          message += `工具 (${plugin.tools.length}):\n`;
          plugin.tools.forEach(tool => {
            message += `  • ${tool}\n`;
          });
          message += '\n';
        }

        if (plugin.commands && plugin.commands.length > 0) {
          message += `命令 (${plugin.commands.length}):\n`;
          plugin.commands.forEach(cmd => {
            message += `  • ${cmd}\n`;
          });
          message += '\n';
        }

        if (plugin.skills && plugin.skills.length > 0) {
          message += `技能 (${plugin.skills.length}):\n`;
          plugin.skills.forEach(skill => {
            message += `  • ${skill}\n`;
          });
          message += '\n';
        }

        if (plugin.hooks && plugin.hooks.length > 0) {
          message += `钩子 (${plugin.hooks.length}):\n`;
          plugin.hooks.forEach(hook => {
            message += `  • ${hook}\n`;
          });
          message += '\n';
        }

        if (plugin.error) {
          message += `⚠️  错误:\n${plugin.error}\n`;
        }

        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          message: `获取插件信息失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /plugins enable <name>
    if (subcommand === 'enable') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /plugins enable <插件名>\n\n示例: /plugins enable my-plugin',
        };
      }

      const pluginName = args[1];

      try {
        const success = await conversationManager.enablePlugin(pluginName);

        if (success) {
          return {
            success: true,
            message: `已启用插件: ${pluginName}\n\n插件将在下次对话时加载。`,
          };
        } else {
          return {
            success: false,
            message: `启用插件 ${pluginName} 失败。\n\n可能原因:\n  • 插件不存在\n  • 插件配置无效`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `启用插件失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /plugins disable <name>
    if (subcommand === 'disable') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /plugins disable <插件名>\n\n示例: /plugins disable my-plugin',
        };
      }

      const pluginName = args[1];

      try {
        const success = await conversationManager.disablePlugin(pluginName);

        if (success) {
          return {
            success: true,
            message: `已禁用插件: ${pluginName}\n\n插件将在下次对话时卸载。`,
          };
        } else {
          return {
            success: false,
            message: `禁用插件 ${pluginName} 失败。\n\n可能原因:\n  • 插件不存在`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `禁用插件失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /plugins uninstall <name>
    if (subcommand === 'uninstall' || subcommand === 'remove') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /plugins uninstall <插件名>\n\n示例: /plugins uninstall my-plugin',
        };
      }

      const pluginName = args[1];

      try {
        const success = await conversationManager.uninstallPlugin(pluginName);

        if (success) {
          return {
            success: true,
            message: `已卸载插件: ${pluginName}\n\n插件文件已从磁盘删除。`,
          };
        } else {
          return {
            success: false,
            message: `卸载插件 ${pluginName} 失败。\n\n可能原因:\n  • 插件不存在\n  • 其他插件依赖此插件`,
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `卸载插件失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n可用命令:\n  list      - 列出所有插件\n  info      - 查看插件详情\n  enable    - 启用插件\n  disable   - 禁用插件\n  uninstall - 卸载插件`,
    };
  },
};

// /login - 认证管理命令（与 CLI 模式一致，auth 作为别名）
const loginCommand: SlashCommand = {
  name: 'login',
  aliases: ['auth'],
  description: '管理认证和API密钥',
  usage: '/login [status|set <key>|clear]',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;

    // 动态导入 authManager
    const { authManager } = await import('./auth-manager.js');

    // 默认行为：显示认证状态
    if (!args || args.length === 0 || args[0] === 'status') {
      try {
        const status = authManager.getAuthStatus();
        const maskedKey = authManager.getMaskedApiKey();

        let message = '认证状态\n\n';
        message += `认证: ${status.authenticated ? '✓ 已认证' : '✗ 未认证'}\n`;
        message += `类型: ${status.type === 'api_key' ? 'API密钥' : status.type === 'oauth' ? 'OAuth' : '无'}\n`;
        message += `Provider: ${status.provider}\n`;

        if (maskedKey) {
          message += `API密钥: ${maskedKey}\n`;
        }

        if (status.username) {
          message += `用户: ${status.username}\n`;
        }

        if (status.expiresAt) {
          const expiresDate = new Date(status.expiresAt);
          message += `过期时间: ${expiresDate.toLocaleString('zh-CN')}\n`;
        }

        message += '\n可用命令:\n';
        message += '  /login status      - 显示认证状态\n';
        message += '  /login set <key>   - 设置API密钥\n';
        message += '  /login clear       - 清除认证（登出）\n';
        message += '  /logout            - 等同于 /login clear';

        return { success: true, message };
      } catch (error) {
        return {
          success: false,
          message: `获取认证状态失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const subcommand = args[0].toLowerCase();

    // /login set <api_key>
    if (subcommand === 'set') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /login set <api_key>\n\n示例: /login set sk-ant-api03-...',
        };
      }

      const apiKey = args.slice(1).join(' '); // 支持包含空格的密钥（虽然通常不会有）

      try {
        const success = authManager.setApiKey(apiKey);

        if (success) {
          const maskedKey = authManager.getMaskedApiKey();
          return {
            success: true,
            message: `API密钥已设置\n\n密钥: ${maskedKey}\n\n注意: 密钥已保存到配置文件。`,
          };
        } else {
          return {
            success: false,
            message: '设置API密钥失败。请检查密钥格式。',
          };
        }
      } catch (error) {
        return {
          success: false,
          message: `设置API密钥失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /login clear
    if (subcommand === 'clear') {
      try {
        authManager.clearAuth();

        return {
          success: true,
          message: '认证已清除。\n\nAPI密钥已从配置中移除。',
        };
      } catch (error) {
        return {
          success: false,
          message: `清除认证失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // /login validate <api_key>
    if (subcommand === 'validate') {
      if (args.length < 2) {
        return {
          success: false,
          message: '用法: /login validate <api_key>\n\n验证API密钥是否有效。',
        };
      }

      const apiKey = args.slice(1).join(' ');

      try {
        let message = '正在验证API密钥...\n\n';
        const valid = await authManager.validateApiKey(apiKey);

        if (valid) {
          message += '✓ API密钥有效\n\n';
          message += '密钥已通过验证，可以正常使用。';
        } else {
          message += '✗ API密钥无效\n\n';
          message += '密钥验证失败，请检查密钥是否正确。';
        }

        return { success: valid, message };
      } catch (error) {
        return {
          success: false,
          message: `验证API密钥失败: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n可用命令:\n  status   - 显示认证状态\n  set      - 设置API密钥\n  clear    - 清除认证\n  validate - 验证API密钥`,
    };
  },
};

// /logout - 登出（清除认证）
const logoutCommand: SlashCommand = {
  name: 'logout',
  description: '登出（清除API密钥）',
  category: 'config',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    // 直接调用 /login clear
    return loginCommand.execute({
      ...ctx,
      args: ['clear'],
    });
  },
};

// ============ 通用命令 ============

// /exit - 退出 Claude Code
const exitCommand: SlashCommand = {
  name: 'exit',
  aliases: ['quit', 'q'],
  description: '退出 Claude Code',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '正在退出 Claude Code...\n\n请关闭浏览器标签页。',
    };
  },
};

// /version - 显示版本信息
const versionCommand: SlashCommand = {
  name: 'version',
  aliases: ['ver', 'v'],
  description: '显示版本信息',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const packageJson = require('../../../package.json');

    let message = 'Claude Code 版本信息\n\n';
    message += `版本: ${packageJson.version || 'Unknown'}\n`;
    message += `Node.js: ${process.version}\n`;
    message += `平台: ${process.platform} ${process.arch}\n`;
    message += `运行模式: WebUI\n\n`;
    message += '项目地址: https://github.com/kill136/claude-code-open\n';
    message += '官方文档: https://docs.anthropic.com/claude-code';

    return { success: true, message };
  },
};

// /bug - 报告问题
const bugCommand: SlashCommand = {
  name: 'bug',
  aliases: ['report', 'issue'],
  description: '报告问题或提交反馈',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    let message = '报告问题\n\n';
    message += '感谢您帮助改进 Claude Code！\n\n';
    message += '报告问题:\n';
    message += '  • GitHub Issues: https://github.com/kill136/claude-code-open/issues\n';
    message += '  • 邮箱: support@example.com\n\n';
    message += '提交反馈时请包含:\n';
    message += '  1. 问题描述\n';
    message += '  2. 复现步骤\n';
    message += '  3. 预期行为\n';
    message += '  4. 实际行为\n';
    message += '  5. 系统信息 (使用 /doctor 获取)\n\n';
    message += '使用 /doctor 运行系统诊断并附上结果。';

    return { success: true, message };
  },
};

// ============ 会话命令 ============

// /context - 显示上下文使用情况
const contextCommand: SlashCommand = {
  name: 'context',
  aliases: ['ctx'],
  description: '显示当前上下文使用情况',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);

    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const msg of history) {
      if (msg.usage) {
        inputTokens += msg.usage.inputTokens || 0;
        outputTokens += msg.usage.outputTokens || 0;
        totalTokens += (msg.usage.inputTokens || 0) + (msg.usage.outputTokens || 0);
      }
    }

    // 假设上下文窗口为 200k tokens
    const contextWindow = 200000;
    const usagePercent = ((totalTokens / contextWindow) * 100).toFixed(1);

    let message = '上下文使用情况\n\n';
    message += `当前会话:\n`;
    message += `  消息数: ${history.length}\n`;
    message += `  输入 tokens: ${inputTokens.toLocaleString()}\n`;
    message += `  输出 tokens: ${outputTokens.toLocaleString()}\n`;
    message += `  总计 tokens: ${totalTokens.toLocaleString()}\n\n`;
    message += `上下文窗口:\n`;
    message += `  容量: ${contextWindow.toLocaleString()} tokens\n`;
    message += `  已使用: ${usagePercent}%\n`;
    message += `  剩余: ${(contextWindow - totalTokens).toLocaleString()} tokens\n\n`;

    if (totalTokens > contextWindow * 0.8) {
      message += '⚠️  警告: 上下文使用超过 80%，建议使用 /clear 或 /compact 释放空间。';
    } else {
      message += '提示: 使用 /compact 压缩历史，或 /clear 清除对话。';
    }

    return { success: true, message };
  },
};

// /rewind - 回退会话
const rewindCommand: SlashCommand = {
  name: 'rewind',
  aliases: ['undo'],
  description: '回退会话到之前的状态',
  usage: '/rewind [步数]',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: '会话回退\n\n' +
        'WebUI 模式暂不支持会话回退功能。\n\n' +
        '替代方案:\n' +
        '  • 使用 /checkpoint 创建检查点\n' +
        '  • 使用 /clear 清除当前会话\n' +
        '  • 在 CLI 模式中使用 /rewind 命令',
    };
  },
};

// /rename - 重命名会话
const renameCommand: SlashCommand = {
  name: 'rename',
  description: '重命名当前会话',
  usage: '/rename <新名称>',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      return {
        success: false,
        message: '用法: /rename <新名称>\n\n示例: /rename "我的项目开发"',
      };
    }

    const newName = args.join(' ');

    return {
      success: false,
      message: '会话重命名\n\n' +
        'WebUI 模式暂不支持会话重命名功能。\n\n' +
        '替代方案:\n' +
        '  • 通过 WebUI 界面管理会话\n' +
        '  • 在 CLI 模式中使用 /rename 命令',
    };
  },
};

// /export - 导出会话
const exportCommand: SlashCommand = {
  name: 'export',
  description: '导出会话数据',
  usage: '/export [格式]',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: '会话导出\n\n' +
        'WebUI 模式暂不支持会话导出功能。\n\n' +
        '替代方案:\n' +
        '  • 使用 /transcript 导出对话记录\n' +
        '  • 在 CLI 模式中使用 /export 命令',
    };
  },
};

// /transcript - 导出对话记录
const transcriptCommand: SlashCommand = {
  name: 'transcript',
  description: '导出对话记录',
  usage: '/transcript [markdown|json|text]',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;
    const format = args && args.length > 0 ? args[0].toLowerCase() : 'markdown';

    const history = ctx.conversationManager.getHistory(ctx.sessionId);

    if (history.length === 0) {
      return {
        success: false,
        message: '没有对话记录可导出。',
      };
    }

    let message = '对话记录导出\n\n';
    message += `格式: ${format}\n`;
    message += `消息数: ${history.length}\n\n`;
    message += 'WebUI 模式暂不支持直接导出到文件。\n\n';
    message += '对话记录保存在: ~/.claude/sessions/\n';
    message += `会话 ID: ${ctx.sessionId}\n\n`;
    message += '提示: 在 CLI 模式中使用 /transcript 导出到文件。';

    return { success: true, message };
  },
};

// /tag - 会话标签管理
const tagCommand: SlashCommand = {
  name: 'tag',
  description: '管理会话标签',
  usage: '/tag [add|remove|list] [标签]',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: '会话标签\n\n' +
        'WebUI 模式暂不支持会话标签功能。\n\n' +
        '替代方案:\n' +
        '  • 通过 WebUI 界面管理会话\n' +
        '  • 在 CLI 模式中使用 /tag 命令',
    };
  },
};

// /stats - 会话统计
const statsCommand: SlashCommand = {
  name: 'stats',
  description: '显示会话统计信息',
  category: 'session',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const history = ctx.conversationManager.getHistory(ctx.sessionId);

    let totalInput = 0;
    let totalOutput = 0;
    let toolCalls = 0;

    for (const msg of history) {
      if (msg.usage) {
        totalInput += msg.usage.inputTokens || 0;
        totalOutput += msg.usage.outputTokens || 0;
      }
      if (msg.role === 'assistant' && msg.content) {
        const content = Array.isArray(msg.content) ? msg.content : [msg.content];
        toolCalls += content.filter(c => typeof c === 'object' && c.type === 'tool_use').length;
      }
    }

    const modelPricing: Record<string, { input: number; output: number }> = {
      opus: { input: 15, output: 75 },
      sonnet: { input: 3, output: 15 },
      haiku: { input: 0.8, output: 4 },
    };

    const pricing = modelPricing[ctx.model] || modelPricing.sonnet;
    const totalCost = (totalInput / 1000000) * pricing.input + (totalOutput / 1000000) * pricing.output;

    let message = '会话统计\n\n';
    message += `基本信息:\n`;
    message += `  会话 ID: ${ctx.sessionId.slice(0, 8)}\n`;
    message += `  消息数: ${history.length}\n`;
    message += `  模型: ${ctx.model}\n`;
    message += `  工具调用: ${toolCalls} 次\n\n`;
    message += `Token 使用:\n`;
    message += `  输入: ${totalInput.toLocaleString()}\n`;
    message += `  输出: ${totalOutput.toLocaleString()}\n`;
    message += `  总计: ${(totalInput + totalOutput).toLocaleString()}\n\n`;
    message += `费用:\n`;
    message += `  估算: $${totalCost.toFixed(4)}`;

    return { success: true, message };
  },
};

// ============ 配置命令 ============

// /permissions - 管理工具权限
const permissionsCommand: SlashCommand = {
  name: 'permissions',
  description: '管理工具权限设置',
  usage: '/permissions [list|grant|revoke] [工具名]',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: '工具权限管理\n\n' +
        'WebUI 模式暂不支持权限管理功能。\n\n' +
        '说明:\n' +
        '  • WebUI 模式下所有工具默认可用\n' +
        '  • 在 CLI 模式中使用 /permissions 管理权限\n' +
        '  • 可通过配置文件设置工具允许/拒绝列表',
    };
  },
};

// /hooks - 查看/管理钩子
const hooksCommand: SlashCommand = {
  name: 'hooks',
  description: '查看和管理钩子脚本',
  usage: '/hooks [list|enable|disable] [钩子名]',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '钩子管理\n\n' +
        '钩子脚本位置:\n' +
        '  • ~/.claude/hooks/\n' +
        '  • ./.claude/hooks/\n\n' +
        '可用钩子:\n' +
        '  • pre-tool-call - 工具调用前执行\n' +
        '  • post-tool-call - 工具调用后执行\n' +
        '  • pre-message - 发送消息前执行\n' +
        '  • post-message - 接收消息后执行\n' +
        '  • session-start - 会话开始时执行\n' +
        '  • session-end - 会话结束时执行\n\n' +
        '详细管理请在 CLI 模式中使用 /hooks 命令。',
    };
  },
};

// /init - 初始化 CLAUDE.md
const initCommand: SlashCommand = {
  name: 'init',
  description: '初始化项目的 CLAUDE.md 文件',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: '初始化 CLAUDE.md\n\n' +
        'WebUI 模式暂不支持直接初始化功能。\n\n' +
        '手动创建:\n' +
        '  1. 在项目根目录创建 CLAUDE.md 文件\n' +
        '  2. 添加项目说明和 Claude 使用指南\n' +
        '  3. 参考: https://docs.anthropic.com/claude-code/claude-md\n\n' +
        '或在 CLI 模式中使用 /init 命令自动创建。',
    };
  },
};

// /privacy-settings - 隐私设置
const privacySettingsCommand: SlashCommand = {
  name: 'privacy-settings',
  description: '管理隐私和数据收集设置',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '隐私设置\n\n' +
        '当前设置:\n' +
        '  • 数据收集: 已禁用\n' +
        '  • 匿名统计: 已禁用\n' +
        '  • 会话本地存储: 已启用\n\n' +
        '数据存储位置:\n' +
        '  • 会话: ~/.claude/sessions/\n' +
        '  • 配置: ~/.claude/settings.json\n' +
        '  • 日志: ~/.claude/logs/\n\n' +
        '注意:\n' +
        '  • 所有数据仅本地存储\n' +
        '  • 不会上传到任何服务器\n' +
        '  • API 调用直接发送到 Anthropic',
    };
  },
};

// /vim - 切换 Vim 模式
const vimCommand: SlashCommand = {
  name: 'vim',
  description: '切换 Vim 键绑定模式',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: 'Vim 模式\n\n' +
        'WebUI 模式暂不支持 Vim 键绑定。\n\n' +
        '替代方案:\n' +
        '  • 使用浏览器扩展 (如 Vimium)\n' +
        '  • 在 CLI 模式中使用 /vim 启用 Vim 模式',
    };
  },
};

// /theme - 更改主题
const themeCommand: SlashCommand = {
  name: 'theme',
  description: '更改界面主题',
  usage: '/theme [light|dark|auto]',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      return {
        success: true,
        message: '主题设置\n\n' +
          '当前主题: 跟随系统\n\n' +
          '可用主题:\n' +
          '  • light - 浅色主题\n' +
          '  • dark - 深色主题\n' +
          '  • auto - 跟随系统设置\n\n' +
          '用法: /theme <主题名>',
      };
    }

    const theme = args[0].toLowerCase();
    const validThemes = ['light', 'dark', 'auto'];

    if (!validThemes.includes(theme)) {
      return {
        success: false,
        message: `无效的主题: ${theme}\n\n可用主题: light, dark, auto`,
      };
    }

    return {
      success: false,
      message: '主题切换\n\n' +
        'WebUI 模式请通过浏览器界面切换主题。\n\n' +
        '主题设置将自动保存。',
    };
  },
};

// /discover - 发现功能
const discoverCommand: SlashCommand = {
  name: 'discover',
  description: '发现 Claude Code 的功能和技巧',
  category: 'general',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    let message = '发现功能\n\n';
    message += '核心功能:\n';
    message += '  • 文件操作: Read, Write, Edit, MultiEdit\n';
    message += '  • 代码搜索: Grep, Glob\n';
    message += '  • 命令执行: Bash, Tmux\n';
    message += '  • Web 访问: WebFetch, WebSearch\n';
    message += '  • 任务管理: Task, TodoWrite\n';
    message += '  • MCP 服务器: 扩展 Claude 能力\n\n';
    message += '高级功能:\n';
    message += '  • 检查点: 保存和恢复文件状态\n';
    message += '  • 插件系统: 自定义扩展\n';
    message += '  • 钩子脚本: 自动化工作流\n';
    message += '  • 技能系统: 复用常见任务\n\n';
    message += '使用技巧:\n';
    message += '  1. 使用 /help 查看所有命令\n';
    message += '  2. 使用 CLAUDE.md 提供项目上下文\n';
    message += '  3. 使用 /checkpoint 保护重要文件\n';
    message += '  4. 使用 /context 监控 token 使用\n\n';
    message += '文档: https://docs.anthropic.com/claude-code';

    return { success: true, message };
  },
};

// /sandbox - 沙箱设置
const sandboxCommand: SlashCommand = {
  name: 'sandbox',
  description: '配置沙箱安全设置',
  usage: '/sandbox [status|enable|disable]',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '沙箱设置\n\n' +
        '注意: 沙箱功能仅在 CLI 模式的 Linux 系统上可用。\n\n' +
        '沙箱功能:\n' +
        '  • 使用 Bubblewrap 隔离命令执行\n' +
        '  • 限制文件系统访问\n' +
        '  • 限制网络访问\n' +
        '  • 防止意外的系统更改\n\n' +
        '当前环境:\n' +
        `  • 平台: ${process.platform}\n` +
        '  • 沙箱: 不可用 (WebUI 模式)\n\n' +
        '在 CLI 模式中使用 /sandbox 管理沙箱设置。',
    };
  },
};

// ============ 工具集成命令 ============

// /agents - 管理代理
const agentsCommand: SlashCommand = {
  name: 'agents',
  description: '管理和查看后台代理',
  usage: '/agents [list|create|stop] [参数]',
  category: 'integration',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '代理管理\n\n' +
        '后台代理用于执行长时间运行的任务。\n\n' +
        '相关命令:\n' +
        '  • /tasks - 查看所有后台任务\n' +
        '  • /tasks cancel <id> - 取消任务\n' +
        '  • /tasks output <id> - 查看任务输出\n\n' +
        '提示: 使用 Task 工具创建后台任务。',
    };
  },
};

// /ide - IDE 集成
const ideCommand: SlashCommand = {
  name: 'ide',
  description: 'IDE 集成设置和状态',
  category: 'integration',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: 'IDE 集成\n\n' +
        'Claude Code 支持以下 IDE 集成:\n\n' +
        'VS Code:\n' +
        '  • 安装 Claude Code 扩展\n' +
        '  • 在编辑器内直接使用 Claude\n' +
        '  • 快捷键支持\n\n' +
        'JetBrains IDEs:\n' +
        '  • 通过 LSP 集成\n' +
        '  • 代码分析和建议\n\n' +
        'Vim/Neovim:\n' +
        '  • 通过命令行集成\n' +
        '  • 终端内使用\n\n' +
        '详细文档: https://docs.anthropic.com/claude-code/ide-integration',
    };
  },
};

// /chrome - Chrome 集成
const chromeCommand: SlashCommand = {
  name: 'chrome',
  description: 'Chrome 浏览器集成',
  category: 'integration',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: 'Chrome 集成\n\n' +
        'Claude Code 通过 MCP 支持浏览器控制。\n\n' +
        '功能:\n' +
        '  • 自动化网页操作\n' +
        '  • 抓取网页内容\n' +
        '  • 填写表单\n' +
        '  • 截图和录屏\n\n' +
        '设置:\n' +
        '  1. 安装 Chrome/Chromium\n' +
        '  2. 配置 MCP chrome 服务器\n' +
        '  3. 使用 /mcp add chrome-server <command>\n\n' +
        '示例:\n' +
        '  /mcp add chrome npx @modelcontextprotocol/server-puppeteer\n\n' +
        '相关命令: /mcp list',
    };
  },
};

// ============ 实用工具命令 ============

// /usage - 使用统计
const usageCommand: SlashCommand = {
  name: 'usage',
  description: '显示 API 使用统计',
  category: 'utility',
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

    const modelPricing: Record<string, { input: number; output: number }> = {
      opus: { input: 15, output: 75 },
      sonnet: { input: 3, output: 15 },
      haiku: { input: 0.8, output: 4 },
    };

    const pricing = modelPricing[ctx.model] || modelPricing.sonnet;
    const totalCost = (totalInput / 1000000) * pricing.input + (totalOutput / 1000000) * pricing.output;

    let message = 'API 使用统计\n\n';
    message += `当前会话:\n`;
    message += `  输入 tokens: ${totalInput.toLocaleString()}\n`;
    message += `  输出 tokens: ${totalOutput.toLocaleString()}\n`;
    message += `  总计 tokens: ${(totalInput + totalOutput).toLocaleString()}\n`;
    message += `  估算费用: $${totalCost.toFixed(4)}\n\n`;
    message += '使用 /stats 查看详细统计。';

    return { success: true, message };
  },
};

// /files - 列出文件
const filesCommand: SlashCommand = {
  name: 'files',
  aliases: ['ls'],
  description: '列出当前目录的文件',
  usage: '/files [目录]',
  category: 'utility',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args, cwd } = ctx;
    const targetDir = args && args.length > 0 ? path.join(cwd, args[0]) : cwd;

    try {
      if (!fs.existsSync(targetDir)) {
        return {
          success: false,
          message: `目录不存在: ${targetDir}`,
        };
      }

      const files = fs.readdirSync(targetDir);

      let message = `文件列表: ${targetDir}\n\n`;

      const dirs: string[] = [];
      const regularFiles: string[] = [];

      for (const file of files) {
        const filePath = path.join(targetDir, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
          dirs.push(file);
        } else {
          regularFiles.push(file);
        }
      }

      if (dirs.length > 0) {
        message += '目录:\n';
        dirs.sort().forEach(dir => {
          message += `  📁 ${dir}/\n`;
        });
        message += '\n';
      }

      if (regularFiles.length > 0) {
        message += '文件:\n';
        regularFiles.sort().forEach(file => {
          const filePath = path.join(targetDir, file);
          const stats = fs.statSync(filePath);
          const sizeKB = (stats.size / 1024).toFixed(2);
          message += `  📄 ${file} (${sizeKB} KB)\n`;
        });
      }

      if (dirs.length === 0 && regularFiles.length === 0) {
        message += '(空目录)';
      }

      return { success: true, message };
    } catch (error) {
      return {
        success: false,
        message: `列出文件失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

// /todos - 待办事项
const todosCommand: SlashCommand = {
  name: 'todos',
  aliases: ['todo'],
  description: '查看和管理待办事项',
  usage: '/todos [list|add|done|clear]',
  category: 'utility',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '待办事项\n\n' +
        '使用 TodoWrite 工具管理任务列表。\n\n' +
        '功能:\n' +
        '  • 创建任务列表\n' +
        '  • 跟踪任务状态 (pending/in_progress/completed)\n' +
        '  • 实时更新进度\n\n' +
        '示例:\n' +
        '  "创建一个待办事项列表，包含:\n' +
        '   1. 实现用户登录\n' +
        '   2. 添加数据验证\n' +
        '   3. 编写单元测试"\n\n' +
        '提示: 直接在对话中要求 Claude 创建待办清单。',
    };
  },
};

// /add-dir - 添加目录到上下文
const addDirCommand: SlashCommand = {
  name: 'add-dir',
  aliases: ['add'],
  description: '将目录添加到会话上下文',
  usage: '/add-dir <目录路径>',
  category: 'utility',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      return {
        success: false,
        message: '用法: /add-dir <目录路径>\n\n示例: /add-dir ./src',
      };
    }

    const dirPath = args[0];
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(ctx.cwd, dirPath);

    if (!fs.existsSync(fullPath)) {
      return {
        success: false,
        message: `目录不存在: ${fullPath}`,
      };
    }

    if (!fs.statSync(fullPath).isDirectory()) {
      return {
        success: false,
        message: `不是目录: ${fullPath}`,
      };
    }

    return {
      success: true,
      message: `目录信息\n\n` +
        `路径: ${fullPath}\n\n` +
        `提示:\n` +
        `  • 使用自然语言描述您想对此目录做什么\n` +
        `  • Claude 会自动读取和分析相关文件\n` +
        `  • 示例: "分析 ${dirPath} 目录的代码结构"`,
    };
  },
};

// /skills - 显示技能
const skillsCommand: SlashCommand = {
  name: 'skills',
  description: '查看可用的技能和自定义命令',
  category: 'utility',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    // 扫描并列出实际的 skills
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const userSkillsDir = path.join(homeDir, '.claude', 'skills');
    const projectSkillsDir = path.join(ctx.cwd, '.claude', 'skills');

    let message = '技能系统\n\n' +
      '技能位置:\n' +
      `  • 全局: ${userSkillsDir}\n` +
      `  • 项目: ${projectSkillsDir}\n\n`;

    // 扫描项目级 skills
    const projectSkills: string[] = [];
    if (fs.existsSync(projectSkillsDir)) {
      try {
        const entries = fs.readdirSync(projectSkillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFile = path.join(projectSkillsDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              projectSkills.push(entry.name);
            }
          }
        }
      } catch (error) {
        // 忽略错误
      }
    }

    // 扫描用户全局 skills
    const userSkills: string[] = [];
    if (fs.existsSync(userSkillsDir)) {
      try {
        const entries = fs.readdirSync(userSkillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const skillFile = path.join(userSkillsDir, entry.name, 'SKILL.md');
            if (fs.existsSync(skillFile)) {
              userSkills.push(entry.name);
            }
          }
        }
      } catch (error) {
        // 忽略错误
      }
    }

    // 显示已加载的 skills
    if (projectSkills.length > 0) {
      message += `项目级 Skills (${projectSkills.length}):\n`;
      projectSkills.forEach(skill => {
        message += `  • ${skill}\n`;
      });
      message += '\n';
    }

    if (userSkills.length > 0) {
      message += `全局 Skills (${userSkills.length}):\n`;
      userSkills.forEach(skill => {
        message += `  • ${skill}\n`;
      });
      message += '\n';
    }

    if (projectSkills.length === 0 && userSkills.length === 0) {
      message += '目前没有配置任何自定义 Skills\n\n';
    }

    message += '技能类型:\n' +
      '  • 斜杠命令: 自定义快捷命令\n' +
      '  • 提示模板: 可复用的提示词\n' +
      '  • 工作流: 自动化任务序列\n\n' +
      '创建技能:\n' +
      '  1. 在 .claude/skills/<skill-name>/ 目录创建 SKILL.md 文件\n' +
      '  2. 在 SKILL.md 文件顶部添加 YAML frontmatter\n' +
      '  3. 文件内容为技能使用文档\n\n' +
      '示例:\n' +
      '  文件: .claude/skills/review/SKILL.md\n' +
      '  内容:\n' +
      '  ---\n' +
      '  name: review\n' +
      '  description: Code review assistant\n' +
      '  ---\n' +
      '  # Code Review\n' +
      '  审查代码的质量和安全性...\n\n' +
      '详细文档: https://docs.anthropic.com/claude-code/skills';

    return {
      success: true,
      message,
    };
  },
};

// /mobile - 移动端配置
const mobileCommand: SlashCommand = {
  name: 'mobile',
  description: '移动端访问配置',
  category: 'config',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '移动端访问\n\n' +
        'WebUI 支持移动设备访问。\n\n' +
        '访问方式:\n' +
        '  1. 在移动浏览器中打开 WebUI 地址\n' +
        '  2. 界面会自动适配移动设备\n' +
        '  3. 支持触摸操作\n\n' +
        '功能限制:\n' +
        '  • 某些高级功能可能不可用\n' +
        '  • 建议使用桌面端进行开发\n' +
        '  • 移动端适合查看和轻度交互\n\n' +
        '提示:\n' +
        '  • 使用横屏模式获得更好体验\n' +
        '  • 将网页添加到主屏幕快速访问',
    };
  },
};

// /api - API 查询
const apiCommand: SlashCommand = {
  name: 'api',
  aliases: ['api-query'],
  description: 'Anthropic API 查询和测试',
  usage: '/api [status|models|limits]',
  category: 'utility',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args } = ctx;
    const subcommand = args && args.length > 0 ? args[0].toLowerCase() : 'status';

    const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

    if (subcommand === 'status') {
      let message = 'API 状态\n\n';
      message += `连接状态: ${apiKeySet ? '✓ 已连接' : '✗ 未连接'}\n`;
      message += `API Key: ${apiKeySet ? '✓ 已配置' : '✗ 未配置'}\n`;
      message += `端点: api.anthropic.com\n\n`;

      if (!apiKeySet) {
        message += '设置 API Key:\n';
        message += '  • 使用 /login set <key> 命令\n';
        message += '  • 或设置环境变量 ANTHROPIC_API_KEY\n';
        message += '  • 或在 ~/.claude/settings.json 中配置';
      } else {
        message += '可用子命令:\n';
        message += '  /api status - API 状态\n';
        message += '  /api models - 可用模型\n';
        message += '  /api limits - 使用限制';
      }

      return { success: true, message };
    }

    if (subcommand === 'models') {
      let message = 'API 模型列表\n\n';
      message += 'Claude 4.5 系列:\n';
      message += '  • claude-opus-4-5 - 最强大的模型\n';
      message += '  • claude-sonnet-4-5 - 平衡性能和速度\n';
      message += '  • claude-haiku-3-5 - 快速响应\n\n';
      message += '上下文窗口:\n';
      message += '  • 所有模型: 200k tokens\n\n';
      message += '输出限制:\n';
      message += '  • 最大输出: 32k tokens\n\n';
      message += '使用 /model <名称> 切换模型。';

      return { success: true, message };
    }

    if (subcommand === 'limits') {
      let message = 'API 使用限制\n\n';
      message += '速率限制:\n';
      message += '  • 免费层: 50 请求/分钟\n';
      message += '  • Pro: 1000 请求/分钟\n';
      message += '  • 企业: 自定义\n\n';
      message += 'Token 限制:\n';
      message += '  • 上下文: 200k tokens\n';
      message += '  • 输出: 32k tokens\n\n';
      message += '当前会话:\n';
      message += '  使用 /context 查看 token 使用情况\n';
      message += '  使用 /cost 查看费用统计';

      return { success: true, message };
    }

    return {
      success: false,
      message: `未知子命令: ${subcommand}\n\n可用命令:\n  status - API 状态\n  models - 可用模型\n  limits - 使用限制`,
    };
  },
};

// /memory - 管理持久记忆
const memoryCommand: SlashCommand = {
  name: 'memory',
  aliases: ['mem', 'remember'],
  description: '管理 Claude 的持久记忆',
  usage: '/memory [add|list|remove|clear] [内容]',
  category: 'utility',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: false,
      message: '持久记忆\n\n' +
        'WebUI 模式暂不支持持久记忆功能。\n\n' +
        '替代方案:\n' +
        '  • 使用 CLAUDE.md 提供项目上下文\n' +
        '  • 在对话中重复重要信息\n' +
        '  • 在 CLI 模式中使用 /memory 命令\n\n' +
        'CLAUDE.md 文件:\n' +
        '  • 在项目根目录创建 CLAUDE.md\n' +
        '  • 添加项目说明、约定、偏好设置\n' +
        '  • Claude 会自动读取并记住这些信息',
    };
  },
};

// ============ 认证命令 ============

// /upgrade - 升级账户
const upgradeCommand: SlashCommand = {
  name: 'upgrade',
  description: '升级 Claude Code 账户',
  category: 'auth',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '账户升级\n\n' +
        'Claude Code 基于 Anthropic API 运行。\n\n' +
        '升级选项:\n' +
        '  • API 免费层: 基本使用\n' +
        '  • API Pro: 更高速率限制\n' +
        '  • API 企业: 自定义配额和支持\n\n' +
        '升级步骤:\n' +
        '  1. 访问: https://platform.claude.com\n' +
        '  2. 登录您的账户\n' +
        '  3. 进入 Billing 页面\n' +
        '  4. 选择合适的计划\n\n' +
        '注意: 升级后需更新 API Key 才能生效。',
    };
  },
};

// /passes - 管理 API passes
const passesCommand: SlashCommand = {
  name: 'passes',
  description: '管理 API 使用额度',
  category: 'auth',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: 'API 使用额度\n\n' +
        'Claude Code 使用 Anthropic API。\n\n' +
        '查看额度:\n' +
        '  1. 访问: https://platform.claude.com\n' +
        '  2. 进入 Usage 页面\n' +
        '  3. 查看当前余额和使用情况\n\n' +
        '充值额度:\n' +
        '  1. 进入 Billing 页面\n' +
        '  2. 添加支付方式\n' +
        '  3. 设置自动充值或手动充值\n\n' +
        '当前会话费用:\n' +
        '  使用 /cost 查看详细费用统计',
    };
  },
};

// ============ 开发命令 ============

// /review - 代码审查
const reviewCommand: SlashCommand = {
  name: 'review',
  aliases: ['code-review', 'cr'],
  description: '代码审查和质量检查',
  usage: '/review [文件路径]',
  category: 'development',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    let message = '代码审查\n\n';

    if (args && args.length > 0) {
      const filePath = args[0];
      message += `目标文件: ${filePath}\n\n`;
    }

    message += '审查内容:\n';
    message += '  • 代码质量和可读性\n';
    message += '  • 潜在的 bug 和错误\n';
    message += '  • 性能优化建议\n';
    message += '  • 安全漏洞检查\n';
    message += '  • 最佳实践建议\n\n';
    message += '使用方法:\n';
    message += '  直接告诉 Claude "审查这个文件的代码" 并提供文件路径。\n\n';
    message += '示例:\n';
    message += '  "请审查 src/index.ts 的代码质量"';

    return { success: true, message };
  },
};

// /feedback - 提交反馈
const feedbackCommand: SlashCommand = {
  name: 'feedback',
  description: '提交功能反馈和建议',
  category: 'development',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '提交反馈\n\n' +
        '感谢您帮助改进 Claude Code！\n\n' +
        '反馈渠道:\n' +
        '  • GitHub Discussions: https://github.com/kill136/claude-code-open/discussions\n' +
        '  • GitHub Issues: https://github.com/kill136/claude-code-open/issues\n' +
        '  • 邮箱: feedback@example.com\n\n' +
        '反馈类型:\n' +
        '  • 功能建议\n' +
        '  • 使用体验\n' +
        '  • 性能问题\n' +
        '  • 文档改进\n\n' +
        '也可使用 /bug 报告具体问题。',
    };
  },
};

// /pr - 管理 Pull Request
const prCommand: SlashCommand = {
  name: 'pr',
  description: '管理 GitHub Pull Request',
  usage: '/pr [create|list|view|merge] [参数]',
  category: 'development',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: 'Pull Request 管理\n\n' +
        'Claude Code 可以帮助管理 PR。\n\n' +
        '可用操作:\n' +
        '  • 创建 PR: "创建一个 PR，标题是..."\n' +
        '  • 审查 PR: "审查 PR #123"\n' +
        '  • 查看评论: 使用 /pr-comments 命令\n' +
        '  • 合并 PR: "合并 PR #123"\n\n' +
        '前置要求:\n' +
        '  • 项目是 Git 仓库\n' +
        '  • 配置 GitHub 凭证\n' +
        '  • 安装 gh CLI 工具\n\n' +
        '示例:\n' +
        '  "基于当前分支创建一个 PR 到 main"',
    };
  },
};

// /pr-comments - 查看 PR 评论
const prCommentsCommand: SlashCommand = {
  name: 'pr-comments',
  description: '查看 Pull Request 评论',
  usage: '/pr-comments <PR编号>',
  category: 'development',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    const { args } = ctx;

    if (!args || args.length === 0) {
      return {
        success: false,
        message: '用法: /pr-comments <PR编号>\n\n示例: /pr-comments 123',
      };
    }

    return {
      success: false,
      message: 'PR 评论查看\n\n' +
        'WebUI 模式暂不支持直接查看 PR 评论。\n\n' +
        '替代方案:\n' +
        '  • 使用 GitHub 网页界面\n' +
        '  • 使用 gh CLI: gh pr view <编号>\n' +
        '  • 在 CLI 模式中使用此命令\n\n' +
        '示例:\n' +
        '  "查看 PR #123 的评论并总结"',
    };
  },
};

// /security-review - 安全审查
const securityReviewCommand: SlashCommand = {
  name: 'security-review',
  description: '执行安全审查和漏洞扫描',
  usage: '/security-review [文件路径]',
  category: 'development',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '安全审查\n\n' +
        'Claude 可以帮助识别常见的安全问题。\n\n' +
        '检查项目:\n' +
        '  • SQL 注入风险\n' +
        '  • XSS 跨站脚本\n' +
        '  • CSRF 攻击\n' +
        '  • 敏感信息泄露\n' +
        '  • 不安全的依赖\n' +
        '  • 权限和认证问题\n\n' +
        '使用方法:\n' +
        '  直接告诉 Claude "进行安全审查" 并指定文件或目录。\n\n' +
        '示例:\n' +
        '  "审查 src/ 目录的安全性"\n' +
        '  "检查这段代码是否有安全漏洞"\n\n' +
        '注意: 这是基础检查，严肃项目建议使用专业安全工具。',
    };
  },
};

// /map - 代码地图
const mapCommand: SlashCommand = {
  name: 'map',
  description: '生成代码库结构地图',
  usage: '/map [目录]',
  category: 'development',
  execute: (ctx: ExtendedCommandContext): CommandResult => {
    return {
      success: true,
      message: '代码地图\n\n' +
        'Claude 可以分析和可视化代码结构。\n\n' +
        '生成内容:\n' +
        '  • 目录结构树\n' +
        '  • 模块依赖关系\n' +
        '  • 主要组件和功能\n' +
        '  • 架构概览\n\n' +
        '使用方法:\n' +
        '  直接告诉 Claude "生成代码地图" 或 "分析项目结构"。\n\n' +
        '示例:\n' +
        '  "分析 src/ 目录的结构并生成概览"\n' +
        '  "绘制这个项目的架构图"\n' +
        '  "列出主要模块及其职责"\n\n' +
        '提示: Claude 会自动使用 Glob 和 Read 工具分析代码。',
    };
  },
};

// 注册工具和提示命令
registry.register(tasksCommand);
registry.register(doctorCommand);
registry.register(mcpCommand);
registry.register(checkpointCommand);
registry.register(pluginsCommand);
registry.register(loginCommand);
registry.register(logoutCommand);

// 注册新增的通用命令
registry.register(exitCommand);
registry.register(versionCommand);
registry.register(bugCommand);
registry.register(discoverCommand);

// 注册新增的会话命令
registry.register(contextCommand);
registry.register(rewindCommand);
registry.register(renameCommand);
registry.register(exportCommand);
registry.register(transcriptCommand);
registry.register(tagCommand);
registry.register(statsCommand);

// 注册新增的配置命令
registry.register(permissionsCommand);
registry.register(hooksCommand);
registry.register(initCommand);
registry.register(privacySettingsCommand);
registry.register(vimCommand);
registry.register(themeCommand);
registry.register(sandboxCommand);

// 注册工具集成命令
registry.register(agentsCommand);
registry.register(ideCommand);
registry.register(chromeCommand);

// 注册实用工具命令
registry.register(usageCommand);
registry.register(filesCommand);
registry.register(todosCommand);
registry.register(addDirCommand);
registry.register(skillsCommand);
registry.register(mobileCommand);
registry.register(apiCommand);
registry.register(memoryCommand);

// 注册认证命令
registry.register(upgradeCommand);
registry.register(passesCommand);

// 注册开发命令
registry.register(reviewCommand);
registry.register(feedbackCommand);
registry.register(prCommand);
registry.register(prCommentsCommand);
registry.register(securityReviewCommand);
registry.register(mapCommand);

// ============================================================================
// /dev - 持续开发命令
// ============================================================================

/**
 * /dev 命令 - 启动持续开发流程
 * 
 * 使用示例：
 *   /dev 增加用户邀请功能，支持邮件和链接邀请
 *   /dev status    查看当前开发状态
 *   /dev pause     暂停执行
 *   /dev resume    恢复执行
 *   /dev rollback  回滚到上一个检查点
 */
const devCommand: SlashCommand = {
  name: 'dev',
  aliases: ['continuous', 'cdev'],
  description: '启动持续开发流程（影响分析 → 蓝图生成 → 安全执行）',
  usage: '/dev <需求描述> 或 /dev [status|pause|resume|rollback]',
  category: 'development',
  execute: async (ctx: ExtendedCommandContext): Promise<CommandResult> => {
    const { args, ws, sessionId } = ctx;

    // 没有参数时显示帮助
    if (!args || args.length === 0) {
      return {
        success: true,
        message: `持续开发命令 (/dev)

启动一个安全的持续开发流程，在现有代码库上添加新功能，同时确保不破坏现有功能。

用法:
  /dev <需求描述>     启动新的开发流程
  /dev status         查看当前开发状态
  /dev pause          暂停执行
  /dev resume         恢复执行
  /dev rollback       回滚到上一个检查点

示例:
  /dev 增加用户邀请功能，支持邮件和链接邀请
  /dev 优化登录页面性能，减少首屏加载时间
  /dev 添加数据导出功能，支持 CSV 和 Excel 格式

开发流程:
  ┌─────────────────────────────────────────────────┐
  │ 1. 代码库分析   → 理解现有结构                   │
  │ 2. 影响分析     → 评估风险，设置安全边界          │
  │ 3. 蓝图生成     → 创建增量开发计划               │
  │ 4. 人工审批     → 确认后开始执行                 │
  │ 5. TDD 执行     → 测试先行，安全开发             │
  │ 6. 回归测试     → 确保不破坏现有功能             │
  └─────────────────────────────────────────────────┘

安全保障:
  • 现有测试必须全部通过（回归测试门禁）
  • Worker 只能在授权范围内操作（边界检查）
  • 关键节点自动创建检查点（可回滚）
  • 高风险操作需要人工确认

提示: 首次使用会先分析代码库，可能需要几分钟。`,
      };
    }

    const subcommand = args[0].toLowerCase();

    // /dev status - 查看状态
    if (subcommand === 'status') {
      // 发送 WebSocket 消息请求状态
      const message = {
        type: 'continuous_dev:status',
        sessionId,
      };
      
      // 通过 WebSocket 发送
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify(message));
      }

      return {
        success: true,
        message: `正在获取开发状态...

如果没有活跃的开发流程，请使用 /dev <需求描述> 启动新流程。`,
      };
    }

    // /dev pause - 暂停执行
    if (subcommand === 'pause') {
      const message = {
        type: 'continuous_dev:pause',
        sessionId,
      };
      
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
      }

      return {
        success: true,
        message: `⏸️ 正在暂停开发流程...

已暂停的任务可以使用 /dev resume 恢复。`,
      };
    }

    // /dev resume - 恢复执行
    if (subcommand === 'resume') {
      const message = {
        type: 'continuous_dev:resume',
        sessionId,
      };
      
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
      }

      return {
        success: true,
        message: `▶️ 正在恢复开发流程...`,
      };
    }

    // /dev rollback - 回滚
    if (subcommand === 'rollback') {
      const checkpointId = args[1]; // 可选的检查点 ID

      const message = {
        type: 'continuous_dev:rollback',
        sessionId,
        checkpointId,
      };
      
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
      }

      return {
        success: true,
        message: checkpointId
          ? `⏪ 正在回滚到检查点 ${checkpointId}...`
          : `⏪ 正在回滚到上一个检查点...`,
      };
    }

    // /dev <需求> - 启动新的开发流程
    const requirement = args.join(' ');
    
    // 输入验证
    if (requirement.length < 5) {
      return {
        success: false,
        message: `需求描述太短了，请提供更详细的说明。

示例:
  /dev 增加用户邀请功能，支持邮件和链接邀请
  /dev 优化数据库查询性能，添加索引和缓存`,
      };
    }

    // 发送启动消息
    const message = {
      type: 'continuous_dev:start',
      sessionId,
      requirement,
    };
    
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }

    return {
      success: true,
      message: `🚀 启动持续开发流程

需求: ${requirement}

正在执行:
  ⏳ 第一步: 分析代码库...

后续步骤:
  ○ 第二步: 影响分析
  ○ 第三步: 生成增量蓝图
  ○ 第四步: 等待审批
  ○ 第五步: 执行开发

提示:
  • 使用 /dev status 查看进度
  • 使用 /dev pause 暂停执行
  • 高风险操作会请求您的确认`,
    };
  },
};

// 注册持续开发命令
registry.register(devCommand);

/**
 * 检查输入是否为斜杠命令
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * 执行斜杠命令
 */
export async function executeSlashCommand(
  input: string,
  ctx: CommandContext
): Promise<CommandResult> {
  return registry.execute(input, ctx);
}
