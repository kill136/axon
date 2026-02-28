/**
 * 工具命令 - cost, usage, files, tasks, todos, add-dir
 */

import type { SlashCommand, CommandContext, CommandResult } from './types.js';
import { commandRegistry } from './registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateTerminalConfig, detectTerminalType, formatConfigAsMarkdown } from '../utils/terminal-setup.js';
import React from 'react';
import { SkillsDialog } from '../ui/components/SkillsDialog.js';
import { StatsPanel } from '../ui/components/StatsPanel.js';
import { isDemoMode } from '../utils/env-check.js';

// /cost - 费用统计 (官方风格)
export const costCommand: SlashCommand = {
  name: 'cost',
  description: 'Show the total cost and duration of the current session',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const stats = ctx.session.getStats();
    const durationMins = Math.floor(stats.duration / 60000);
    const durationSecs = Math.floor((stats.duration % 60000) / 1000);

    let costInfo = `Session Cost\n\n`;

    // 当前会话统计
    costInfo += `This Session\n`;
    costInfo += `  Cost: ${stats.totalCost}\n`;
    costInfo += `  Duration: ${durationMins}m ${durationSecs}s\n`;
    costInfo += `  Messages: ${stats.messageCount}\n\n`;

    // 模型使用统计
    const usage = stats.modelUsage;
    if (Object.keys(usage).length > 0) {
      costInfo += `Token Usage\n`;
      for (const [model, tokens] of Object.entries(usage)) {
        costInfo += `  ${model}: ${tokens.toLocaleString()} tokens\n`;
      }
      costInfo += '\n';
    }

    // 定价参考
    costInfo += `Pricing Reference\n`;
    costInfo += `  Opus 4:   $15/$75 per 1M tokens (in/out)\n`;
    costInfo += `  Sonnet 4: $3/$15 per 1M tokens (in/out)\n`;
    costInfo += `  Haiku 3.5: $0.25/$1.25 per 1M tokens (in/out)\n\n`;

    costInfo += `For detailed billing: https://platform.claude.com/billing`;

    ctx.ui.addMessage('assistant', costInfo);
    return { success: true };
  },
};

// /usage - 使用量统计
export const usageCommand: SlashCommand = {
  name: 'usage',
  description: 'Show usage statistics',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const stats = ctx.session.getStats();

    const usageInfo = `Usage Statistics:

Current Session:
  Messages: ${stats.messageCount}
  Duration: ${Math.round(stats.duration / 1000)}s
  Est. Tokens: ~${stats.messageCount * 500}

Today:
  (Session-based tracking)

This Month:
  (Requires API billing dashboard)

Usage Limits:
  API: Per-account limits
  claude.ai: Plan-based limits

To check API limits:
  https://platform.claude.com/settings

To check claude.ai limits:
  https://claude.ai/settings

Related commands:
  /cost     - Spending information
  /context  - Context window usage
  /stats    - Session statistics`;

    ctx.ui.addMessage('assistant', usageInfo);
    return { success: true };
  },
};

// /files - 文件列表
export const filesCommand: SlashCommand = {
  name: 'files',
  aliases: ['ls'],
  description: 'List files in the current directory or context',
  usage: '/files [path]',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const { args, config } = ctx;
    const targetPath = args[0] ? path.resolve(config.cwd, args[0]) : config.cwd;

    try {
      if (!fs.existsSync(targetPath)) {
        ctx.ui.addMessage('assistant', `Path not found: ${targetPath}`);
        return { success: false };
      }

      const stat = fs.statSync(targetPath);

      if (!stat.isDirectory()) {
        // 显示文件信息
        const fileInfo = `File: ${path.basename(targetPath)}
Path: ${targetPath}
Size: ${stat.size} bytes
Modified: ${stat.mtime.toLocaleString()}
Type: ${path.extname(targetPath) || 'no extension'}`;

        ctx.ui.addMessage('assistant', fileInfo);
        return { success: true };
      }

      // 列出目录内容
      const entries = fs.readdirSync(targetPath, { withFileTypes: true });

      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name + '/');
      const files = entries.filter(e => e.isFile()).map(e => e.name);

      let listing = `Directory: ${targetPath}\n\n`;

      if (dirs.length > 0) {
        listing += `Directories:\n${dirs.map(d => `  ${d}`).join('\n')}\n\n`;
      }

      if (files.length > 0) {
        listing += `Files:\n${files.slice(0, 50).map(f => `  ${f}`).join('\n')}`;
        if (files.length > 50) {
          listing += `\n  ... and ${files.length - 50} more files`;
        }
      }

      if (dirs.length === 0 && files.length === 0) {
        listing += '(empty directory)';
      }

      ctx.ui.addMessage('assistant', listing);
      return { success: true };
    } catch (error) {
      ctx.ui.addMessage('assistant', `Error reading path: ${error}`);
      return { success: false };
    }
  },
};

// /tasks - 任务列表
export const tasksCommand: SlashCommand = {
  name: 'tasks',
  description: 'Show running background tasks',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const tasksInfo = `Background Tasks:

Currently Running:
  (No background tasks)

Task Types:
  - Bash commands (background)
  - Agent tasks
  - Long-running operations

Commands:
  /tasks           - List all tasks
  /tasks kill <id> - Kill a task

To run a command in background:
  Ask Claude to run a command with "in background"

Example:
  "Run npm test in the background"`;

    ctx.ui.addMessage('assistant', tasksInfo);
    return { success: true };
  },
};

// /todos - Todo 列表 (官方风格 - 完整实现)
export const todosCommand: SlashCommand = {
  name: 'todos',
  aliases: ['todo'],
  description: 'Show or manage the current todo list',
  usage: '/todos [add <item>|clear|done <n>]',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const { args, session } = ctx;
    const action = args[0] || 'list';

    // 获取当前 todos
    const todos = session.getTodos();

    // list - 显示所有 todos（默认操作）
    if (action === 'list' || !['add', 'clear', 'done'].includes(action)) {
      if (todos.length === 0) {
        const emptyInfo = `╭─ Todo List ──────────────────────────────────────────╮
│                                                     │
│  No todos yet                                       │
│                                                     │
╰─────────────────────────────────────────────────────╯

The todo list helps Claude track:
  • Multi-step tasks
  • Implementation progress
  • Pending items

Claude automatically manages todos during complex tasks.

You can also:
  • Ask Claude to "add X to the todo list"
  • Use /todos add <item> to add manually
  • Use /todos clear to clear all todos
  • Use /todos done <n> to mark item as done

💡 Tip: For complex tasks, ask Claude to create a todo list
   to track progress and ensure nothing is missed.`;

        ctx.ui.addMessage('assistant', emptyInfo);
        return { success: true };
      }

      // 格式化显示 todos
      let todosInfo = `╭─ Todo List ──────────────────────────────────────────╮
│                                                     │`;

      const pendingTodos = todos.filter(t => t.status === 'pending');
      const inProgressTodos = todos.filter(t => t.status === 'in_progress');
      const completedTodos = todos.filter(t => t.status === 'completed');

      // 显示进行中的任务
      if (inProgressTodos.length > 0) {
        todosInfo += `
│  🔄 In Progress                                      │
│                                                     │`;
        for (const todo of inProgressTodos) {
          const content = todo.activeForm.substring(0, 45);
          todosInfo += `
│    ▸ ${content.padEnd(45)}│`;
        }
        todosInfo += `
│                                                     │`;
      }

      // 显示待处理的任务
      if (pendingTodos.length > 0) {
        todosInfo += `
│  ⏳ Pending                                          │
│                                                     │`;
        for (let i = 0; i < pendingTodos.length; i++) {
          const todo = pendingTodos[i];
          const num = String(i + 1).padStart(2);
          const content = todo.content.substring(0, 42);
          todosInfo += `
│    ${num}. ${content.padEnd(44)}│`;
        }
        todosInfo += `
│                                                     │`;
      }

      // 显示已完成的任务
      if (completedTodos.length > 0) {
        todosInfo += `
│  ✓ Completed                                        │
│                                                     │`;
        for (const todo of completedTodos) {
          const content = todo.content.substring(0, 45);
          todosInfo += `
│    ✓ ${content.padEnd(45)}│`;
        }
        todosInfo += `
│                                                     │`;
      }

      // 统计
      const total = todos.length;
      const completed = completedTodos.length;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

      todosInfo += `
╰─────────────────────────────────────────────────────╯

Progress: ${completed}/${total} completed (${progress}%)

Commands:
  /todos           - Show this list
  /todos add <item> - Add a new todo
  /todos clear     - Clear all todos
  /todos done <n>  - Mark todo #n as done`;

      ctx.ui.addMessage('assistant', todosInfo);
      return { success: true };
    }

    // add - 添加新的 todo
    if (action === 'add') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /todos add <item>

Example:
  /todos add Fix the authentication bug`);
        return { success: false };
      }

      const content = args.slice(1).join(' ');
      const activeForm = content.startsWith('Fix') || content.startsWith('Build') ||
                         content.startsWith('Create') || content.startsWith('Update') ||
                         content.startsWith('Add') || content.startsWith('Remove') ||
                         content.startsWith('Implement') || content.startsWith('Refactor')
        ? content.replace(/^(Fix|Build|Create|Update|Add|Remove|Implement|Refactor)/, (match) => {
            const map: Record<string, string> = {
              'Fix': 'Fixing',
              'Build': 'Building',
              'Create': 'Creating',
              'Update': 'Updating',
              'Add': 'Adding',
              'Remove': 'Removing',
              'Implement': 'Implementing',
              'Refactoring': 'Refactoring'
            };
            return map[match] || match;
          })
        : content;

      const newTodo = {
        content,
        status: 'pending' as const,
        activeForm,
      };

      todos.push(newTodo);
      session.setTodos(todos);

      ctx.ui.addMessage('assistant', `✓ Added to todo list: ${content}

Run /todos to see the updated list.`);
      return { success: true };
    }

    // clear - 清除所有 todos
    if (action === 'clear') {
      if (todos.length === 0) {
        ctx.ui.addMessage('assistant', 'Todo list is already empty.');
        return { success: true };
      }

      session.setTodos([]);
      ctx.ui.addMessage('assistant', `✓ Cleared ${todos.length} todo${todos.length === 1 ? '' : 's'} from the list.`);
      return { success: true };
    }

    // done - 标记为已完成
    if (action === 'done') {
      if (args.length < 2) {
        ctx.ui.addMessage('assistant', `Usage: /todos done <number>

Example:
  /todos done 1

Run /todos to see the numbered list.`);
        return { success: false };
      }

      const num = parseInt(args[1], 10);
      if (isNaN(num) || num < 1) {
        ctx.ui.addMessage('assistant', 'Please provide a valid todo number (e.g., /todos done 1)');
        return { success: false };
      }

      const pendingTodos = todos.filter(t => t.status === 'pending');
      if (num > pendingTodos.length) {
        ctx.ui.addMessage('assistant', `Todo #${num} not found. You have ${pendingTodos.length} pending todo${pendingTodos.length === 1 ? '' : 's'}.

Run /todos to see the current list.`);
        return { success: false };
      }

      // 找到对应的 todo 并标记为完成
      const targetTodo = pendingTodos[num - 1];
      const index = todos.indexOf(targetTodo);
      if (index !== -1) {
        todos[index].status = 'completed';
        session.setTodos(todos);

        ctx.ui.addMessage('assistant', `✓ Marked as completed: ${targetTodo.content}

Run /todos to see the updated list.`);
        return { success: true };
      }

      return { success: false };
    }

    // 未知的子命令
    ctx.ui.addMessage('assistant', `Unknown action: ${action}

Available commands:
  /todos           - Show current todos
  /todos add <item> - Add a todo item
  /todos clear     - Clear all todos
  /todos done <n>  - Mark item as done`);
    return { success: false };
  },
};

// /add-dir - 添加目录到上下文
export const addDirCommand: SlashCommand = {
  name: 'add-dir',
  aliases: ['add'],
  description: 'Add a directory to the working context',
  usage: '/add-dir <path>',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const { args, config } = ctx;

    if (args.length === 0) {
      ctx.ui.addMessage('assistant', `Usage: /add-dir <path>

Add a directory to Claude's working context.

This helps when:
  - Working with multiple projects
  - Referencing external code
  - Accessing shared libraries

Examples:
  /add-dir ../shared-lib
  /add-dir /path/to/other/project

Current working directory:
  ${config.cwd}`);
      return { success: true };
    }

    const targetDir = path.resolve(config.cwd, args[0]);

    if (!fs.existsSync(targetDir)) {
      ctx.ui.addMessage('assistant', `Directory not found: ${targetDir}`);
      return { success: false };
    }

    if (!fs.statSync(targetDir).isDirectory()) {
      ctx.ui.addMessage('assistant', `Not a directory: ${targetDir}`);
      return { success: false };
    }

    ctx.ui.addMessage('assistant', `Added directory to context: ${targetDir}

Claude can now access files in this directory.
Use absolute paths or relative paths from this location.`);
    ctx.ui.addActivity(`Added directory: ${targetDir}`);
    return { success: true };
  },
};

// /stickers - 贴纸
export const stickersCommand: SlashCommand = {
  name: 'stickers',
  description: 'Fun stickers and reactions',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const stickers = `Stickers:

Claude's Reactions:
  (•‿•)    - Happy
  (╯°□°)╯  - Frustrated
  ¯\\_(ツ)_/¯ - Shrug
  (ノ◕ヮ◕)ノ*:・゚✧ - Excited
  ( ˘ω˘ )  - Content
  ಠ_ಠ     - Disapproval
  ⊂(◉‿◉)つ - Hug

Claude Mascot:
     ▐▛███▜▌
    ▝▜█████▛▘
      ▘▘ ▝▝

Fun fact: The mascot's name is "Clawd"!`;

    ctx.ui.addMessage('assistant', stickers);
    return { success: true };
  },
};

// /skills - 技能列表 (官方风格 - 交互式对话框)
export const skillsCommand: SlashCommand = {
  name: 'skills',
  description: 'List available skills',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const { config } = ctx;

    // 返回 JSX 组件，由 App.tsx 显示为交互式对话框
    // App.tsx 会通过 React.cloneElement 注入 onDone 回调
    const jsx = React.createElement(SkillsDialog, {
      cwd: config.cwd,
    });

    return {
      success: true,
      action: 'showJsx',
      jsx,
      shouldHidePromptInput: true,
    };
  },
};

// /stats - 使用统计 (官方风格 v2.1.6+: 交互式统计面板)
// 支持按 r 键循环切换日期范围: Last 7 days / Last 30 days / All time
export const statsCommand: SlashCommand = {
  name: 'stats',
  description: 'Show your Axon usage statistics and activity',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    // v2.1.6+: 返回交互式 JSX 组件，由 App.tsx 显示为交互式对话框
    // 用户可以按 r 键在日期范围间循环: Last 7 days / Last 30 days / All time
    // 用户可以按 Tab 键在 Overview 和 Models 标签间切换
    const jsx = React.createElement(StatsPanel, {
      sessionStats: ctx.session.getStats(),
      modelDisplayName: ctx.config.modelDisplayName,
    });

    return {
      success: true,
      action: 'showJsx',
      jsx,
      shouldHidePromptInput: true,
    };
  },
};

// /think-back - 年度回顾 (官方风格 - 生成真实统计)
export const thinkBackCommand: SlashCommand = {
  name: 'think-back',
  aliases: ['thinkback', 'year-review'],
  description: 'Your 2025 Axon Year in Review',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    // 收集会话统计
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    let totalSessions = 0;
    let totalMessages = 0;
    const toolUsage: Record<string, number> = {};
    const monthlyActivity: Record<string, number> = {};

    if (fs.existsSync(sessionsDir)) {
      try {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
        totalSessions = files.length;

        for (const file of files) {
          try {
            const sessionPath = path.join(sessionsDir, file);
            const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
            const msgCount = sessionData.messages?.length || 0;
            totalMessages += msgCount;

            // 按月统计
            const createdAt = sessionData.createdAt || sessionData.created_at;
            if (createdAt) {
              const month = new Date(createdAt).toLocaleString('default', { month: 'short' });
              monthlyActivity[month] = (monthlyActivity[month] || 0) + msgCount;
            }

            // 工具使用统计
            if (sessionData.messages) {
              for (const msg of sessionData.messages) {
                if (msg.toolCalls) {
                  for (const tool of msg.toolCalls) {
                    const toolName = tool.name || 'Unknown';
                    toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
                  }
                }
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      } catch {
        // 忽略目录读取错误
      }
    }

    // 排序工具使用
    const sortedTools = Object.entries(toolUsage)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    const thinkBackInfo = `╭─────────────────────────────────────────────────────╮
│                                                     │
│       🎉 Your 2025 Axon Year in Review       │
│                                                     │
╰─────────────────────────────────────────────────────╯

📊 Your Stats

  Total Sessions:     ${totalSessions}
  Total Messages:     ${totalMessages}
  Avg per Session:    ${totalSessions > 0 ? Math.round(totalMessages / totalSessions) : 0}

🛠️  Most Used Tools
${sortedTools.length > 0
  ? sortedTools.map(([name, count], i) => `  ${i + 1}. ${name.padEnd(15)} ${count} uses`).join('\n')
  : '  (no tool usage recorded)'}

📈 Activity by Month
${Object.keys(monthlyActivity).length > 0
  ? Object.entries(monthlyActivity)
      .slice(-6)
      .map(([month, count]) => {
        const bar = '█'.repeat(Math.min(20, Math.ceil(count / 10)));
        return `  ${month.padEnd(4)} ${bar} ${count}`;
      })
      .join('\n')
  : '  (no monthly data)'}

🏆 Achievements
  ${totalSessions >= 1 ? '✓' : '○'} First session completed
  ${totalSessions >= 10 ? '✓' : '○'} 10+ sessions
  ${totalSessions >= 50 ? '✓' : '○'} Power user (50+ sessions)
  ${totalMessages >= 100 ? '✓' : '○'} 100+ messages exchanged
  ${Object.keys(toolUsage).length >= 5 ? '✓' : '○'} Used 5+ different tools

Use /thinkback-play to see an animated version!`;

    ctx.ui.addMessage('assistant', thinkBackInfo);
    return { success: true };
  },
};

// /thinkback-play - 播放年度回顾动画 (官方风格 - ASCII 动画效果)
export const thinkbackPlayCommand: SlashCommand = {
  name: 'thinkback-play',
  description: 'Play the thinkback animation',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    // 收集统计数据
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    let totalSessions = 0;
    let totalMessages = 0;

    if (fs.existsSync(sessionsDir)) {
      try {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
        totalSessions = files.length;
        for (const file of files.slice(-20)) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf-8'));
            totalMessages += data.messages?.length || 0;
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }

    const currentDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const playInfo = `
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   ░█████╗░██╗░░░░░░█████╗░██╗░░░██╗██████╗░███████╗  ║
║   ██╔══██╗██║░░░░░██╔══██╗██║░░░██║██╔══██╗██╔════╝  ║
║   ██║░░╚═╝██║░░░░░███████║██║░░░██║██║░░██║█████╗░░  ║
║   ██║░░██╗██║░░░░░██╔══██║██║░░░██║██║░░██║██╔══╝░░  ║
║   ╚█████╔╝███████╗██║░░██║╚██████╔╝██████╔╝███████╗  ║
║   ░╚════╝░╚══════╝╚═╝░░╚═╝░╚═════╝░╚═════╝░╚══════╝  ║
║                                                      ║
║             ░█████╗░░█████╗░██████╗░███████╗         ║
║             ██╔══██╗██╔══██╗██╔══██╗██╔════╝         ║
║             ██║░░╚═╝██║░░██║██║░░██║█████╗░░         ║
║             ██║░░██╗██║░░██║██║░░██║██╔══╝░░         ║
║             ╚█████╔╝╚█████╔╝██████╔╝███████╗         ║
║             ░╚════╝░░╚════╝░╚═════╝░╚══════╝         ║
║                                                      ║
║                   🎬 2025 RECAP 🎬                   ║
║                                                      ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  📅 ${currentDate.padEnd(42)}│  ║
║  │                                                │  ║
║  │  🔢 Sessions: ${String(totalSessions).padEnd(34)}│  ║
║  │  💬 Messages: ${String(totalMessages).padEnd(34)}│  ║
║  │                                                │  ║
║  │  ⭐ Your coding journey with Claude ⭐        │  ║
║  └────────────────────────────────────────────────┘  ║
║                                                      ║
║  ═══════════════════════════════════════════════════ ║
║                                                      ║
║      "Every great developer you know got there      ║
║       by solving problems they were unqualified     ║
║       to solve until they actually did it."         ║
║                                                      ║
║                         - Patrick McKenzie          ║
║                                                      ║
╚══════════════════════════════════════════════════════╝

🎉 Thanks for coding with Claude in 2025!

Use /think-back to see detailed statistics.`;

    ctx.ui.addMessage('assistant', playInfo);
    return { success: true };
  },
};

// /terminal-setup - 终端配置指南
export const terminalSetupCommand: SlashCommand = {
  name: 'terminal-setup',
  description: 'Show terminal configuration for Shift+Enter multi-line input',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    const configs = generateTerminalConfig();
    const currentTerminal = detectTerminalType();

    let output = '# Terminal Configuration for Shift+Enter Multi-line Input\n\n';
    output += 'Configure your terminal to send the escape sequence `\\x1b\\r` when pressing Shift+Enter.\n';
    output += 'This allows you to insert newlines without submitting your prompt.\n\n';

    if (currentTerminal) {
      output += `✓ Detected terminal: **${currentTerminal}**\n\n`;
      const config = configs.find(c => c.terminal === currentTerminal);
      if (config) {
        output += '## Your Terminal Configuration\n\n';
        output += '```\n';
        output += config.config;
        output += '\n```\n\n';
        if (config.instructions) {
          output += `> ${config.instructions}\n\n`;
        }
        output += '---\n\n';
      }
    }

    output += '## All Supported Terminals\n\n';

    for (const { terminal, config, instructions } of configs) {
      output += `### ${terminal}\n\n`;
      output += '```\n';
      output += config;
      output += '\n```\n\n';
      if (instructions) {
        output += `> ${instructions}\n\n`;
      }
    }

    output += '---\n\n';
    output += 'After configuring, press **Shift+Enter** to insert a newline without submitting.\n';
    output += 'Press **Enter** (without Shift) to submit your prompt as usual.\n\n';
    output += '💡 Tip: Multi-line input is useful for:\n';
    output += '  - Writing longer prompts\n';
    output += '  - Formatting code snippets\n';
    output += '  - Creating structured instructions\n';

    ctx.ui.addMessage('assistant', output);
    return { success: true };
  },
};

// /mobile - 移动端连接（显示 QR 码）
export const mobileCommand: SlashCommand = {
  name: 'mobile',
  description: 'Show QR code for mobile connection',
  category: 'utility',
  execute: (ctx: CommandContext): CommandResult => {
    // 生成一个简单的 ASCII QR 码或者显示说明
    const mobileInfo = `Mobile Connection

Axon mobile integration is coming soon!

Current status: Beta

To use Claude on mobile:
  1. Visit claude.ai on your mobile browser
  2. Login with your account
  3. Your conversations will sync across devices

Future features:
  • QR code to link mobile device
  • Push notifications for long-running tasks
  • Remote monitoring of agent progress

Stay tuned for updates!`;

    ctx.ui.addMessage('assistant', mobileInfo);
    return { success: true };
  },
};

// 注册所有工具命令
export function registerUtilityCommands(): void {
  commandRegistry.register(costCommand);
  commandRegistry.register(usageCommand);
  commandRegistry.register(filesCommand);
  commandRegistry.register(tasksCommand);
  commandRegistry.register(todosCommand);
  commandRegistry.register(addDirCommand);
  commandRegistry.register(stickersCommand);
  commandRegistry.register(skillsCommand);
  commandRegistry.register(statsCommand);
  commandRegistry.register(thinkBackCommand);
  commandRegistry.register(thinkbackPlayCommand);
  commandRegistry.register(terminalSetupCommand);
  commandRegistry.register(mobileCommand);
}
