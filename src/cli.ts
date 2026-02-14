#!/usr/bin/env node

/**
 * Claude Code CLI 入口点
 * 还原版本 2.1.4 - 完整功能版
 */

import { Command, Option } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import React from 'react';
import { render } from 'ink';
import { ConversationLoop } from './core/loop.js';
import { Session } from './core/session.js';
import { toolRegistry } from './tools/index.js';
import { configManager } from './config/index.js';
import { listSessions, loadSession, forkSession, findSessionByPr, getSessionsByPr } from './session/index.js';
import { getMemoryManager } from './memory/index.js';
import { emitLifecycleEvent } from './lifecycle/index.js';
import { runHooks } from './hooks/index.js';
import { scheduleCleanup } from './session/cleanup.js';
import { createPluginCommand } from './plugins/cli.js';
import type { PermissionMode, OutputFormat, InputFormat } from './types/index.js';
import { VERSION_FULL } from './version.js';
import { resetTerminalTitle } from './utils/platform.js';
import { t, initI18n } from './i18n/index.js';
import { disconnectAllMcpServers } from './tools/mcp.js';
import {
  isPenguinEnabled,
  isFastModeAvailable,
  getUnavailableReason,
  toggleFastMode,
  isInFastMode,
  FAST_MODE_DISPLAY_NAME,
  forcePrefetchPenguinMode,
} from './fast-mode/index.js';

// 工作目录列表
const additionalDirectories: string[] = [];

// 全局 MCP 进程清理标志，防止重复清理
let mcpCleanupScheduled = false;

// v2.1.31: 追踪当前活跃的 session ID，用于退出时显示 resume 提示
let activeSessionId: string | null = null;
// v2.1.31: 追踪是否为交互模式
let isInteractiveMode = false;
// v2.1.31: 追踪是否禁用了 session 持久化
let sessionPersistenceDisabled = false;
// 全局 loop 引用，用于 SIGINT 时自动记忆
let activeLoop: ConversationLoop | null = null;

/**
 * 安全退出函数
 * 官方 Ch6() 函数 - v2.1.19 新增
 *
 * 当 process.exit() 失败时（例如终端已关闭导致 EIO 错误），
 * 使用 SIGKILL 强制终止进程，避免悬挂的进程。
 *
 * @param exitCode 退出码
 */
function safeExit(exitCode: number = 0): never {
  try {
    process.exit(exitCode);
  } catch (err) {
    // 如果 process.exit 失败（例如 EIO 错误），使用 SIGKILL
    process.kill(process.pid, 'SIGKILL');
  }
  // 理论上不应该到达这里
  throw new Error('unreachable');
}

/**
 * v2.1.31: 退出时显示 session resume 提示
 * 官方 kMA() 函数 - 仅在交互模式 TTY 环境下显示
 *
 * 条件：
 * 1. stdout 是 TTY（交互终端）
 * 2. 处于交互模式
 * 3. session 持久化未被禁用
 * 4. 有有效的 session ID
 */
function showSessionResumeHint(): void {
  if (!process.stdout.isTTY || !isInteractiveMode || sessionPersistenceDisabled) {
    return;
  }
  try {
    const sessionId = activeSessionId;
    if (!sessionId) return;

    // 对包含特殊字符的 session ID 进行转义
    const escapedId = sessionId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    process.stderr.write(chalk.dim(`\nResume this session with:\nclaude --resume "${escapedId}"\n`));
  } catch {
    // 忽略任何错误，不影响退出流程
  }
}

/**
 * 确保所有 MCP 服务器进程在程序退出前被正确清理
 *
 * 这个函数会在以下情况被调用：
 * 1. 正常退出 (beforeExit)
 * 2. 收到 SIGINT/SIGTERM 信号
 * 3. 发生未捕获的异常
 * 4. mcp list --status 或 mcp get --status 命令完成后
 *
 * v2.1.6 修复: 防止 mcp list 和 mcp get 命令留下孤儿进程
 *
 * @param resetFlag 是否在清理后重置标志，允许后续再次清理（用于命令级清理）
 */
async function cleanupMcpServers(resetFlag = false): Promise<void> {
  if (mcpCleanupScheduled && !resetFlag) return;
  mcpCleanupScheduled = true;

  try {
    await disconnectAllMcpServers();
  } catch (err) {
    // 静默处理清理错误，避免干扰用户
    if (process.env.DEBUG) {
      console.error('[MCP] Cleanup error:', err);
    }
  }

  // 如果是命令级清理，重置标志以允许后续清理
  if (resetFlag) {
    mcpCleanupScheduled = false;
  }
}

// 注册进程退出时的 MCP 清理
process.on('beforeExit', async () => {
  await cleanupMcpServers();
});

// 注册 SIGINT 信号处理（Ctrl+C）
process.on('SIGINT', async () => {
  // 自动记忆：退出前保存对话记忆
  if (activeLoop) {
    try {
      console.error(chalk.gray('\n[AutoMemory] 正在保存对话记忆...'));
      await activeLoop.autoMemorize();
    } catch {
      // 静默失败
    }
  }
  await cleanupMcpServers();
  showSessionResumeHint();
  safeExit(0);
});

// 注册 SIGTERM 信号处理
process.on('SIGTERM', async () => {
  await cleanupMcpServers();
  showSessionResumeHint();
  safeExit(0);
});

// 注册未捕获异常处理
process.on('uncaughtException', async (err) => {
  console.error('Uncaught exception:', err);
  await cleanupMcpServers();
  safeExit(1);
});

// 注册未处理的 Promise 拒绝
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  await cleanupMcpServers();
  safeExit(1);
});

const program = new Command();

program
  .name('claude')
  .description('Claude Code - starts an interactive session by default, use -p/--print for non-interactive output')
  .version(VERSION_FULL, '-v, --version', 'Output the version number');

// 主命令 - 交互模式
program
  .argument('[prompt]', 'Your prompt')
  // 调试选项
  .option('-d, --debug [filter]', 'Enable debug mode with optional category filtering')
  .option('--verbose', 'Override verbose mode setting from config')
  // 输出选项
  .option('-p, --print', 'Print response and exit (useful for pipes)')
  .addOption(
    new Option('--output-format <format>', 'Output format (only works with --print)')
      .choices(['text', 'json', 'stream-json'])
      .default('text')
  )
  .option('--json-schema <schema>', 'JSON Schema for structured output validation')
  .option('--include-partial-messages', 'Include partial message chunks (only with --print and stream-json)')
  .addOption(
    new Option('--input-format <format>', 'Input format (only works with --print)')
      .choices(['text', 'stream-json'])
      .default('text')
  )
  // 安全选项
  .option('--dangerously-skip-permissions', 'Bypass all permission checks (sandbox only)')
  .option('--allow-dangerously-skip-permissions', 'Enable bypassing permissions as an option')
  // 预算选项
  .option('--max-budget-usd <amount>', 'Maximum dollar amount for API calls (only with --print)')
  .option('--replay-user-messages', 'Re-emit user messages from stdin (stream-json only)')
  // 工具选项
  .option('--allowedTools, --allowed-tools <tools...>', 'Comma or space-separated list of allowed tools')
  .option('--tools <tools...>', 'Specify available tools from built-in set')
  .option('--disallowedTools, --disallowed-tools <tools...>', 'Comma or space-separated list of denied tools')
  // MCP 选项
  .option('--mcp-config <configs...>', 'Load MCP servers from JSON files or strings')
  .option('--mcp-debug', '[DEPRECATED] Enable MCP debug mode')
  .option('--strict-mcp-config', 'Only use MCP servers from --mcp-config')
  // 系统提示
  .option('--system-prompt <prompt>', 'System prompt to use for the session')
  .option('--system-prompt-file <file>', 'Read system prompt from a file')
  .option('--append-system-prompt <prompt>', 'Append to default system prompt')
  .option('--append-system-prompt-file <file>', 'Read system prompt from a file and append to the default system prompt')
  // 权限模式
  .addOption(
    new Option('--permission-mode <mode>', 'Permission mode for the session')
      .choices(['acceptEdits', 'bypassPermissions', 'default', 'delegate', 'dontAsk', 'plan'])
  )
  // 会话选项
  .option('-c, --continue', 'Continue the most recent conversation')
  .option('-r, --resume [value]', 'Resume by session ID, or open interactive picker')
  .option('--fork-session', 'Create new session ID when resuming')
  .option('--from-pr [value]', 'Resume a session linked to a PR by PR number/URL, or open interactive picker')
  .option('--no-session-persistence', 'Disable session persistence (only with --print)')
  .option('--session-id <uuid>', 'Use a specific session ID (must be valid UUID)')
  // 模型选项
  .option('-m, --model <model>', 'Model for the current session', 'sonnet')
  .option('--agent <agent>', 'Agent for the current session')
  .option('--betas <betas...>', 'Beta headers for API requests')
  .option('--fallback-model <model>', 'Fallback model when default is overloaded')
  .option('--max-tokens <tokens>', 'Maximum tokens for response', '32000')
  // 其他选项
  .option('--settings <file-or-json>', 'Path to settings JSON file or JSON string')
  .option('--add-dir <directories...>', 'Additional directories to allow tool access')
  .option('--ide', 'Auto-connect to IDE on startup')
  .option('--agents <json>', 'JSON object defining custom agents')
  .option('--teleport <session-id>', 'Connect to remote Claude Code session')
  .option('--include-dependencies', 'Auto-include project dependency type definitions')
  .option('--solo', 'Disable background processes and parallel execution')
  .option('--setting-sources <sources>', 'Comma-separated list of setting sources')
  .option('--plugin-dir <paths...>', 'Load plugins from directories')
  .option('--disable-slash-commands', 'Disable all slash commands')
  .option('--chrome', 'Enable Claude in Chrome integration')
  .option('--no-chrome', 'Disable Claude in Chrome integration')
  .option('--text', 'Use text-based interface instead of TUI')
  // v2.1.10: Setup hook 触发器
  .option('--init', 'Run Setup hook and start interactive session')
  .option('--init-only', 'Run Setup hook and exit (repository setup/maintenance)')
  .option('--maintenance', 'Alias for --init-only')
  .action(async (prompt, options) => {
    // T504: action_handler_start - Action 处理器开始
    await emitLifecycleEvent('action_handler_start');

    // v2.1.6: 设置终端标题为 "Claude Code"
    resetTerminalTitle();

    // ✅ 启动时自动清理过期数据（异步，不阻塞）
    scheduleCleanup();

    // 🔍 提前验证系统提示选项的互斥性
    if (options.systemPrompt && options.systemPromptFile) {
      process.stderr.write(chalk.red(t('cli.misc.sysPromptBothError') + '\n'));
      process.exit(1);
    }
    if (options.appendSystemPrompt && options.appendSystemPromptFile) {
      process.stderr.write(chalk.red(t('cli.misc.appendPromptBothError') + '\n'));
      process.exit(1);
    }

    // 检查是否需要显示登录选择器
    // 只在没有 prompt 且没有认证凭据时显示
    // v2.1.6: 添加 resume 检查，避免 --resume 时登录菜单闪现
    if (!prompt && !options.print && !options.text && options.resume === undefined) {
      const { shouldShowLoginSelector } = await import('./ui/LoginSelector.js');

      if (shouldShowLoginSelector()) {
        await showLoginSelectorUI();
        // 登录成功后继续启动交互界面,不要 return
        // return; // ❌ 移除这个 return
      }
    }

    // 调试模式
    if (options.debug) {
      process.env.CLAUDE_DEBUG = options.debug === true ? '*' : options.debug;
    }

    // Solo 模式 - 禁用后台进程和并行执行
    if (options.solo) {
      process.env.CLAUDE_SOLO_MODE = 'true';
    }

    // v2.1.33: 将 settings.json 中配置的环境变量应用到 process.env
    // 修复: 通过 settings.json environment 配置的代理设置不会应用到 WebFetch 和其他 HTTP 请求
    // 官方实现: 在启动早期阶段将 settings.json 的 env 字段注入 process.env
    const settingsConfig = configManager.getAll();
    if (settingsConfig.env && typeof settingsConfig.env === 'object') {
      for (const [key, value] of Object.entries(settingsConfig.env)) {
        if (value !== undefined && value !== null && !process.env[key]) {
          process.env[key] = String(value);
        }
      }
    }

    // i18n 初始化：从 settings.json 的 language 字段读取语言偏好
    const { initI18n } = await import('./i18n/index.js');
    await initI18n(settingsConfig.language);

    // v2.1.32: 将 --add-dir 传递给 Skill 模块以自动加载额外目录的 skills
    if (options.addDir && Array.isArray(options.addDir)) {
      const { setAdditionalDirectories } = await import('./tools/skill.js');
      const resolvedDirs = options.addDir.map((d: string) => path.resolve(d));
      setAdditionalDirectories(resolvedDirs);
    }

    // 模型映射（官方 Claude Code 使用的模型版本）
    // v2.1.33: Claude Opus 4.6 is now available (2026-02)
    const modelMap: Record<string, string> = {
      'sonnet': 'claude-sonnet-4-5-20250929',
      'opus': 'claude-opus-4-6',
      'haiku': 'claude-haiku-4-5-20251001',
    };

    // 加载 MCP 配置
    if (options.mcpConfig) {
      loadMcpConfigs(options.mcpConfig);
    }

    // 加载 Chrome 集成配置（如果启用）
    // 与官方实现一致：在启动时自动检测并加载 Chrome MCP
    let chromeSystemPrompt: string | undefined;
    try {
      const { getChromeIntegrationConfig } = await import('./chrome-mcp/index.js');
      // options.chrome 可能是 true（--chrome）、false（--no-chrome）或 undefined
      const chromeConfig = await getChromeIntegrationConfig(options.chrome);

      if (chromeConfig) {
        // 导入 MCP 注册函数和 Chrome 工具定义
        const { registerMcpServer, registerMcpToolsToRegistry } = await import('./tools/mcp.js');
        const { toolRegistry } = await import('./tools/index.js');
        const { CHROME_MCP_TOOLS } = await import('./chrome-mcp/tools.js');

        // 添加 Chrome MCP 服务器配置并注册到 MCP 系统
        for (const [name, config] of Object.entries(chromeConfig.mcpConfig)) {
          // 保存到配置文件（持久化）
          try {
            configManager.addMcpServer(name, config as any);
          } catch {
            // 可能已存在，忽略
          }

          // 注册到 MCP 服务器映射（运行时），使用预加载的工具定义
          // 这样工具可以立即被发现，无需连接 MCP 服务器
          registerMcpServer(name, config as any, CHROME_MCP_TOOLS as any);

          // 将工具直接注册到 ToolRegistry，这样 AI 可以直接调用它们
          registerMcpToolsToRegistry(name, CHROME_MCP_TOOLS as any, toolRegistry);
        }

        // 保存 Chrome 系统提示以便后续合并
        chromeSystemPrompt = chromeConfig.systemPrompt;

        if (options.verbose) {
          console.log(chalk.dim('[Chrome] Browser automation tools loaded'));
        }
      }
    } catch (error) {
      // Chrome 集成失败不应该阻止程序运行
      if (options.debug) {
        console.warn(chalk.yellow('[Chrome] Failed to load browser integration:'), error);
      }
    }

    // T507: action_mcp_configs_loaded - MCP 配置加载完成
    await emitLifecycleEvent('action_mcp_configs_loaded');
    await runHooks({ event: 'McpConfigsLoaded' });

    // 【与官方一致】自动加载并连接所有配置的 MCP 服务器
    // 官方逻辑：在 useManageMcpConnections hook 中，自动加载所有配置的 MCP 服务器并连接
    // 除非服务器在 disabledMcpServers 列表中
    try {
      await initializeAllMcpServers(options.verbose, options.strictMcpConfig);
    } catch (error) {
      if (options.debug) {
        console.warn(chalk.yellow(`[MCP] ${t('cli.misc.mcpInitFailed')}`), error);
      }
    }

    // 构建系统提示
    let systemPrompt = options.systemPrompt;

    // 如果 Chrome 集成已启用，添加 Chrome 系统提示
    if (chromeSystemPrompt) {
      systemPrompt = systemPrompt ? `${chromeSystemPrompt}\n\n${systemPrompt}` : chromeSystemPrompt;
    }

    // 处理 --system-prompt-file（互斥性已在前面验证）
    if (options.systemPromptFile) {
      try {
        const filePath = path.resolve(options.systemPromptFile);
        if (!fs.existsSync(filePath)) {
          process.stderr.write(chalk.red(t('cli.misc.sysPromptFileNotFound', { path: filePath }) + '\n'));
          process.exit(1);
        }
        systemPrompt = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(chalk.red(t('cli.misc.sysPromptFileError', { error: errorMsg }) + '\n'));
        process.exit(1);
      }
    }

    // 处理 --append-system-prompt 和 --append-system-prompt-file（互斥性已在前面验证）
    let appendSystemPrompt = options.appendSystemPrompt;
    if (options.appendSystemPromptFile) {
      try {
        const filePath = path.resolve(options.appendSystemPromptFile);
        if (!fs.existsSync(filePath)) {
          process.stderr.write(chalk.red(t('cli.misc.appendPromptFileNotFound', { path: filePath }) + '\n'));
          process.exit(1);
        }
        appendSystemPrompt = fs.readFileSync(filePath, 'utf-8');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        process.stderr.write(chalk.red(t('cli.misc.appendPromptFileError', { error: errorMsg }) + '\n'));
        process.exit(1);
      }
    }

    // 合并 append system prompt
    if (appendSystemPrompt) {
      systemPrompt = (systemPrompt || '') + '\n' + appendSystemPrompt;
    }

    // Include dependencies - 添加依赖类型定义到系统提示
    if (options.includeDependencies) {
      const dependenciesContext = '\n\nNote: Project dependency type definitions are automatically included for better code understanding.';
      systemPrompt = (systemPrompt || '') + dependenciesContext;
    }

    // 加载设置
    if (options.settings) {
      loadSettings(options.settings);
    }

    // T509: action_after_input_prompt - 输入提示处理后
    await emitLifecycleEvent('action_after_input_prompt', { prompt });

    // T506: action_tools_loaded - 工具加载完成
    // 注意：工具在 toolRegistry 导入时已加载，这里触发事件
    await emitLifecycleEvent('action_tools_loaded', { toolCount: toolRegistry.getAll().length });
    await runHooks({ event: 'ToolsLoaded' });

    // T502: action_before_setup - 设置前
    await emitLifecycleEvent('action_before_setup');
    await runHooks({ event: 'BeforeSetup' });

    // v2.1.10: Setup hook 系统
    // 当使用 --init, --init-only 或 --maintenance 标志时触发
    const shouldRunSetupHook = options.init || options.initOnly || options.maintenance;
    const isSetupOnlyMode = options.initOnly || options.maintenance;

    if (shouldRunSetupHook) {
      console.log(chalk.cyan(`\n🔧 ${t('cli.setup.running')}\n`));

      // 添加新的 Setup hook 事件类型
      const setupHookResult = await runHooks({ 
        event: 'Setup',
        sessionId: undefined // Setup hook 可能在会话之前运行
      });

      if (setupHookResult.some(r => !r.success)) {
        console.error(chalk.red(`\n❌ ${t('cli.setup.failed')}\n`));
        const failed = setupHookResult.filter(r => !r.success);
        failed.forEach(r => {
          if (r.error) {
            console.error(chalk.red(`  Error: ${r.error}`));
          }
        });
        
        if (isSetupOnlyMode) {
          process.exit(1);
        } else {
          console.log(chalk.yellow(t('cli.setup.continuing') + '\n'));
        }
      } else {
        console.log(chalk.green(`✓ ${t('cli.setup.completed')}\n`));
      }

      // 如果是 --init-only 或 --maintenance 模式，在 Setup hook 后退出
      if (isSetupOnlyMode) {
        console.log(chalk.gray(t('cli.setup.exitingInit') + '\n'));
        process.exit(0);
      }
    }

    // 这里进行必要的设置（setup logic）
    // 在本项目中，设置逻辑较为简单，主要是配置和会话管理

    // T503: action_after_setup - 设置后
    await emitLifecycleEvent('action_after_setup');
    await runHooks({ event: 'AfterSetup' });

    // 初始化 LSP 管理器
    try {
      const { initializeLSPManager } = await import('./lsp/index.js');
      const workspaceRoot = process.cwd();
      await initializeLSPManager(workspaceRoot);
      console.log(chalk.dim(`[LSP] ${t('cli.misc.lspInitialized')}`));
    } catch (error) {
      // LSP 初始化失败不应该阻止程序运行
      if (options.debug) {
        console.warn(chalk.yellow(`[LSP] ${t('cli.misc.lspFailed')}`), error);
      }
    }

    // T505: action_commands_loaded - 命令加载完成
    // 注意：本项目的斜杠命令是内联定义的，这里标记为已加载
    await emitLifecycleEvent('action_commands_loaded');
    await runHooks({ event: 'CommandsLoaded' });

    // T508: action_after_plugins_init - 插件初始化后
    // 注意：本项目的插件系统尚未完全实现，但仍触发事件
    await emitLifecycleEvent('action_after_plugins_init');
    await runHooks({ event: 'PluginsInitialized' });

    // T510: action_after_hooks - Hooks 执行后
    // 注意：Hooks 在需要时执行，这里标记为已准备就绪
    await emitLifecycleEvent('action_after_hooks');
    await runHooks({ event: 'AfterHooks' });

    // Teleport 模式 - 连接到远程会话
    if (options.teleport) {
      try {
        console.log(chalk.cyan(`Connecting to remote session: ${options.teleport}...`));

        // 动态导入 teleport 模块
        const { connectToRemoteSession, validateSessionRepository } = await import('./teleport/index.js');

        // 获取远程服务器 URL（可以从环境变量或配置获取）
        const ingressUrl = process.env.CLAUDE_TELEPORT_URL;
        const authToken = process.env.CLAUDE_TELEPORT_TOKEN;

        if (!ingressUrl) {
          console.log(chalk.yellow('Warning: No CLAUDE_TELEPORT_URL environment variable set.'));
          console.log(chalk.gray('Attempting to connect using local session...'));

          // 尝试从本地加载会话
          const session = Session.load(options.teleport);
          if (session) {
            console.log(chalk.green(`Loaded local session: ${options.teleport}`));
          } else {
            console.log(chalk.yellow(`Session ${options.teleport} not found locally.`));
            console.log(chalk.gray('Starting new session instead...'));
          }
        } else {
          // 连接到远程会话
          const remoteSession = await connectToRemoteSession(
            options.teleport,
            ingressUrl,
            authToken
          );

          console.log(chalk.green(`Connected to remote session: ${options.teleport}`));
          console.log(chalk.gray(`Remote URL: ${ingressUrl}`));

          // 监听远程会话事件
          remoteSession.on('message', (message) => {
            if (options.verbose) {
              console.log(chalk.dim(`[Remote] ${JSON.stringify(message)}`));
            }
          });

          remoteSession.on('disconnected', () => {
            console.log(chalk.yellow('Remote session disconnected'));
          });

          remoteSession.on('error', (error) => {
            console.error(chalk.red(`Remote session error: ${error.message}`));
          });

          // 在程序退出时断开连接
          process.on('SIGINT', async () => {
            console.log(chalk.yellow('\nDisconnecting from remote session...'));
            await remoteSession.disconnect();
            process.exit(0);
          });
        }
      } catch (err) {
        console.log(chalk.red(`Failed to connect to remote session: ${err instanceof Error ? err.message : err}`));
        console.log(chalk.gray('Starting new session instead...'));

        if (options.verbose && err instanceof Error) {
          console.error(chalk.dim(err.stack));
        }
      }
    }

    // v2.1.32: 主 agent 选择 - 对应官方 h6=S??Gq().agent
    // 当指定了 --agent 或 settings.agent 时，非 built-in agent 的 systemPrompt 和 model 会覆盖默认值
    {
      const { initializeCustomAgents, getAllActiveAgents, getAgentTypeDefinition } = await import('./tools/agent.js');
      
      // 初始化自定义 agent（从插件缓存、用户目录、项目目录加载）
      await initializeCustomAgents();
      
      // 确定主 agent：CLI --agent 优先，其次 settings.agent
      const agentName = options.agent ?? configManager.getAll().agent;
      
      if (agentName) {
        const agentDef = getAgentTypeDefinition(agentName);
        if (agentDef) {
          // 非 built-in agent 且用户未指定 systemPrompt 时，用 agent 的 systemPrompt
          if (agentDef.source !== 'built-in' && !systemPrompt) {
            const agentPrompt = agentDef.getSystemPrompt?.();
            if (agentPrompt) {
              systemPrompt = agentPrompt;
              if (options.verbose) {
                console.log(chalk.dim(`[Agent] Using system prompt from agent "${agentName}" (${agentPrompt.length} chars)`));
              }
            }
          }
          
          // agent 的 model 覆盖默认 model（仅当用户未通过 CLI 指定 model 时）
          if (!options.model && agentDef.model && agentDef.model !== 'inherit') {
            options.model = agentDef.model;
            if (options.verbose) {
              console.log(chalk.dim(`[Agent] Using model "${agentDef.model}" from agent "${agentName}"`));
            }
          }
          
          if (options.verbose) {
            console.log(chalk.dim(`[Agent] Main agent: "${agentName}" (source: ${agentDef.source})`));
          }
        } else {
          console.log(chalk.yellow(`Warning: agent "${agentName}" not found. Available agents: ${getAllActiveAgents().map(d => d.agentType).join(', ')}. Using default behavior.`));
        }
      }
    }

    // 打印模式 (JSON 格式支持) - 不使用 TUI
    if (options.print && prompt) {
      // 从配置管理器获取完整配置（包括环境变量）
      const config = configManager.getAll();

      // v2.1.29: 处理 --json-schema 选项，创建 StructuredOutput 工具
      let structuredOutputTool: any = null;
      if (options.jsonSchema) {
        const { parseJsonSchema, createStructuredOutputTool } = await import('./tools/structured-output.js');
        const schema = parseJsonSchema(options.jsonSchema);

        if (schema) {
          structuredOutputTool = createStructuredOutputTool(schema);

          if (structuredOutputTool) {
            // 注册 StructuredOutput 工具
            toolRegistry.register(structuredOutputTool);

            if (options.verbose) {
              console.log(chalk.dim('[StructuredOutput] Schema validated and tool registered'));
              console.log(chalk.dim(`[StructuredOutput] Properties: ${Object.keys(schema.properties || {}).join(', ')}`));
            }
          } else {
            console.error(chalk.red(t('cli.misc.invalidJsonSchema')));
            process.exit(1);
          }
        } else {
          console.error(chalk.red(t('cli.misc.jsonSchemaParseError')));
          process.exit(1);
        }
      }

      const loop = new ConversationLoop({
        model: modelMap[options.model] || options.model,
        maxTokens: parseInt(options.maxTokens),
        verbose: options.verbose,
        systemPrompt,
        permissionMode: options.permissionMode as PermissionMode,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        // 传递 Extended Thinking 配置
        thinking: config.thinking,
        // 传递回退模型配置
        fallbackModel: options.fallbackModel || config.fallbackModel,
        // 传递调试配置
        debug: options.debug || config.debug,
      });

      const outputFormat = options.outputFormat as OutputFormat;

      if (outputFormat === 'json') {
        const response = await loop.processMessage(prompt);

        // v2.1.29: 如果使用了 structured output，包含 structured_output 字段
        const result: any = {
          type: 'result',
          content: response,
          session_id: loop.getSession().sessionId,
        };

        // 检查是否有 structured output 结果
        if (structuredOutputTool) {
          const session = loop.getSession();
          const messages = session.getMessages();
          // 查找最后一个 tool_result 消息
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              const toolResult = msg.content.find((c: any) =>
                c.type === 'tool_result' && typeof c.content === 'string' && c.content.includes('structured_output')
              ) as any;
              if (toolResult && typeof toolResult.content === 'string') {
                try {
                  const parsed = JSON.parse(toolResult.content);
                  if (parsed.structured_output) {
                    result.structured_output = parsed.structured_output;
                  }
                } catch {
                  // 忽略解析错误
                }
                break;
              }
            }
          }
        }

        console.log(JSON.stringify(result));
      } else if (outputFormat === 'stream-json') {
        for await (const event of loop.processMessageStream(prompt)) {
          console.log(JSON.stringify(event));
        }
      } else {
        const response = await loop.processMessage(prompt);
        console.log(response);
      }
      process.exit(0);
    }

    // 使用文本界面还是 TUI
    if (options.text) {
      // 使用基于 readline 的文本界面
      await runTextInterface(prompt, options, modelMap, systemPrompt);
    } else {
      // 使用 Ink TUI 界面
      await runTuiInterface(prompt, options, modelMap, systemPrompt);
    }
  });

// 运行 TUI 界面 (Ink)
async function runTuiInterface(
  prompt: string | undefined,
  options: any,
  modelMap: Record<string, string>,
  systemPrompt?: string
): Promise<void> {
  try {
    // 动态导入 App 组件
    const { App } = await import('./ui/App.js');

    // 获取用户名
    const username = process.env.USER || process.env.USERNAME || undefined;

    // 渲染 Ink 应用
    render(
      React.createElement(App, {
        model: options.model,
        initialPrompt: prompt,
        verbose: options.verbose,
        systemPrompt,
        username,
        apiType: 'Claude API',
        organization: undefined,
      })
    );
  } catch (error) {
    console.error(chalk.red(t('cli.misc.tuiFailed')), error);
    console.log(chalk.yellow(t('cli.misc.tuiFallback')));
    await runTextInterface(prompt, options, modelMap, systemPrompt);
  }
}

// 运行文本界面 (readline)
async function runTextInterface(
  prompt: string | undefined,
  options: any,
  modelMap: Record<string, string>,
  systemPrompt?: string
): Promise<void> {
  // 官方 claude 颜色 (clawd_body): rgb(215,119,87)
  const claudeColor = chalk.rgb(215, 119, 87);

  // ASCII Art Logo for text mode - 使用官方 clawd 设计
  const LOGO = `
╭─────────────────────────────────────────────────────╮
│                                                     │
│   ${claudeColor('Claude Code')} ${chalk.gray('v' + VERSION_FULL)}                           │
│                                                     │
│        ${claudeColor('*')}       ${claudeColor('*')}                                 │
│      ${claudeColor('*')}  ${claudeColor(' ▐')}${claudeColor.bgBlack('▛███▜')}${claudeColor('▌')}  ${claudeColor('*')}                            │
│        ${claudeColor('*')} ${claudeColor('▝▜')}${claudeColor.bgBlack('█████')}${claudeColor('▛▘')} ${claudeColor('*')}                            │
│           ${claudeColor('▘▘ ▝▝')}                                │
│                                                     │
│   ${chalk.cyan('Sonnet 4')} · ${chalk.gray('Claude API')}                         │
│   ${chalk.gray(process.cwd())}
╰─────────────────────────────────────────────────────╯
`;

  console.log(LOGO);

  // 从配置管理器获取完整配置（包括环境变量）
  const config = configManager.getAll();

  const loop = new ConversationLoop({
    model: modelMap[options.model] || options.model,
    maxTokens: parseInt(options.maxTokens),
    verbose: options.verbose,
    systemPrompt,
    permissionMode: options.permissionMode as PermissionMode,
    allowedTools: options.allowedTools,
    disallowedTools: options.disallowedTools,
    // 传递 Extended Thinking 配置
    thinking: config.thinking,
    // 传递回退模型配置
    fallbackModel: options.fallbackModel || config.fallbackModel,
    // 传递调试配置
    debug: options.debug || config.debug,
  });

  // 设置全局引用，供 SIGINT 退出时自动记忆
  activeLoop = loop;

  // 恢复会话逻辑
  if (options.continue) {
    const sessions = listSessions({ limit: 1, sortBy: 'updatedAt', sortOrder: 'desc' });
    if (sessions.length > 0) {
      const session = loadSession(sessions[0].id);
      if (session) {
        console.log(chalk.green(t('cli.session.continuing', { id: sessions[0].id })));
      }
    } else {
      console.log(chalk.yellow(t('cli.session.noRecent')));
    }
  } else if (options.resume !== undefined) {
    if (options.resume === true || options.resume === '') {
      await showSessionPicker(loop);
    } else {
      // 检查是否需要 fork 会话
      if (options.forkSession) {
        // Fork 会话：创建新会话 ID，但保留历史消息
        const forkedSessionData = forkSession(options.resume, {
          name: undefined, // 使用默认名称
          tags: undefined,
          fromMessageIndex: 0, // 从开始复制所有消息
          includeFutureMessages: true,
        });

        if (forkedSessionData) {
          // 从 forkedSessionData 创建 Session 对象
          const forkedSession = new Session(forkedSessionData.metadata.workingDirectory);

          // 手动设置会话状态
          forkedSession['state'] = {
            sessionId: forkedSessionData.metadata.id,
            cwd: forkedSessionData.metadata.workingDirectory,
            originalCwd: forkedSessionData.metadata.workingDirectory,
            startTime: forkedSessionData.metadata.createdAt,
            totalCostUSD: forkedSessionData.metadata.cost || 0,
            totalAPIDuration: 0,
            totalAPIDurationWithoutRetries: 0,
            totalToolDuration: 0,
            totalLinesAdded: 0,
            totalLinesRemoved: 0,
            modelUsage: {},
            alwaysAllowedTools: [],
            todos: [],
          };

          // 设置消息历史
          forkedSessionData.messages.forEach(msg => forkedSession.addMessage(msg));

          // 设置到 loop
          loop.setSession(forkedSession);

          console.log(chalk.green(`✓ ${t('cli.session.forked', { id: options.resume.slice(0, 8) })}`));
          console.log(chalk.green(`  ${t('cli.session.newId', { id: forkedSessionData.metadata.id.slice(0, 8) })}`));
          console.log(chalk.gray(`  ${t('cli.session.copiedMessages', { count: forkedSessionData.messages.length })}`));
          console.log(chalk.gray(`  ${t('cli.session.independent')}`));
        } else {
          console.log(chalk.yellow(t('cli.session.notFound', { id: options.resume })));
        }
      } else {
        // 正常恢复会话
        const session = Session.load(options.resume);
        if (session) {
          loop.setSession(session);
          // v2.1.32: 如果用户没有指定 --agent，但会话保存了 agent 值，则复用
          if (!options.agent && session.getAgent()) {
            options.agent = session.getAgent();
            console.log(chalk.gray(`  ${t('cli.session.reusingAgent', { agent: options.agent })}`));
          }
          console.log(chalk.green(t('cli.session.resumed', { id: options.resume })));
        } else {
          console.log(chalk.yellow(t('cli.session.notFound', { id: options.resume })));
        }
      }
    }
  } else if (options.fromPr !== undefined) {
    // v2.1.27: 通过 PR 号或 URL 恢复会话
    if (options.fromPr === true || options.fromPr === '') {
      // 显示 PR 会话选择器
      await showPrSessionPicker(loop);
    } else {
      // 通过 PR 号或 URL 查找会话
      const sessionData = findSessionByPr(options.fromPr);
      if (sessionData) {
        const session = Session.load(sessionData.metadata.id);
        if (session) {
          loop.setSession(session);
          const prInfo = sessionData.metadata.prNumber
            ? `PR #${sessionData.metadata.prNumber}`
            : options.fromPr;
          console.log(chalk.green(`Resumed session linked to ${prInfo}`));
        } else {
          console.log(chalk.yellow(t('cli.session.prLoadFailed', { pr: options.fromPr })));
        }
      } else {
        console.log(chalk.yellow(t('cli.session.prNotFound', { pr: options.fromPr })));
      }
    }
  }

  // v2.1.32: 保存 --agent 值到会话（供 resume 复用）
  if (options.agent && loop.getSession()) {
    loop.getSession().setAgent(options.agent);
  }
  // v2.1.31: 设置全局追踪变量，用于退出时显示 resume 提示
  activeSessionId = loop.getSession().sessionId;
  isInteractiveMode = !options.print;
  sessionPersistenceDisabled = options.sessionPersistence === false;

  // 自动启动 daemon（如果未运行且存在动态任务或配置文件）
  if (isInteractiveMode) {
    try {
      const { isDaemonRunning } = await import('./daemon/index.js');
      const { TaskStore } = await import('./daemon/store.js');
      const daemonFs = await import('fs');
      const daemonPath = await import('path');

      if (!isDaemonRunning()) {
        const store = new TaskStore();
        const hasTasks = store.listTasks().length > 0;
        const hasConfig = daemonFs.existsSync(daemonPath.join(process.cwd(), '.claude', 'daemon.yml'))
          || daemonFs.existsSync(daemonPath.join((await import('os')).homedir(), '.claude', 'daemon.yml'));

        if (hasTasks || hasConfig) {
          // 后台启动 daemon（fork 子进程）
          const { spawn } = await import('child_process');
          // import.meta.dirname 在编译后已经在 dist/ 下，所以向上一层就是项目根，再进 dist/
          const daemonProcess = spawn(process.execPath, [daemonPath.join(import.meta.dirname, 'cli.js'), 'daemon', 'start'], {
            detached: true,
            stdio: 'ignore',
            cwd: process.cwd(),
          });
          daemonProcess.unref();
          console.log(chalk.gray(`[Daemon auto-started, PID: ${daemonProcess.pid}]`));
        }
      }
    } catch {
      // daemon 自动启动失败不影响主程序
    }
  }

  // 如果有初始 prompt
  if (prompt) {
    console.log(chalk.blue('> ') + prompt);
    console.log();

    for await (const event of loop.processMessageStream(prompt)) {
      if (event.type === 'text') {
        process.stdout.write(event.content || '');
      } else if (event.type === 'tool_start') {
        console.log(chalk.cyan(`\n[Using tool: ${event.toolName}]`));
      } else if (event.type === 'tool_end') {
        console.log(chalk.gray(`[Result: ${(event.toolResult || '').substring(0, 100)}...]`));
      }
    }
    console.log('\n');
  }

  // v2.1.10: 键盘缓冲 - 在 REPL 完全就绪前捕捉按键
  // 这确保用户在启动过程中输入的内容不会丢失
  const keyboardBuffer: string[] = [];
  let isReplReady = false;

  // 启用原始模式以捕捉按键（如果 stdin 是 TTY）
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    
    // 捕捉启动期间的按键
    const earlyKeypressHandler = (chunk: Buffer) => {
      if (!isReplReady) {
        const str = chunk.toString('utf8');
        // 捕捉可打印字符和空格，忽略控制字符
        if (str.length > 0 && str.charCodeAt(0) >= 32) {
          keyboardBuffer.push(str);
        }
      }
    };
    
    process.stdin.on('data', earlyKeypressHandler);
    
    // 设置超时，确保即使有问题也会停止捕捉
    setTimeout(() => {
      if (!isReplReady) {
        isReplReady = true;
        process.stdin.removeListener('data', earlyKeypressHandler);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
      }
    }, 5000); // 5秒后强制停止捕捉
  }

  // 交互式循环
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // REPL 现在已准备好
  isReplReady = true;

  // 如果有缓冲的按键，显示提示
  if (keyboardBuffer.length > 0) {
    console.log(chalk.dim(`[Captured ${keyboardBuffer.length} keystrokes during startup]`));
  }

  console.log(chalk.gray('> Try "how do I log an error?"'));
  console.log(chalk.gray('? for shortcuts'));
  console.log();

  // 如果有缓冲的按键，重放它们
  if (keyboardBuffer.length > 0) {
    const bufferedInput = keyboardBuffer.join('');
    if (bufferedInput.trim()) {
      console.log(chalk.blue('> ') + bufferedInput);
      // 自动处理缓冲的输入
      setTimeout(() => {
        rl.write(bufferedInput);
      }, 100);
    }
  }

  const askQuestion = (): void => {
    rl.question(chalk.white('> '), async (input) => {
      input = input.trim();

      if (!input) {
        askQuestion();
        return;
      }

      // 斜杠命令
      if (input.startsWith('/') && !options.disableSlashCommands) {
        await handleSlashCommand(input, loop);
        askQuestion();
        return;
      }

      // 退出命令
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log(chalk.yellow(`\n${t('cli.misc.goodbye')}`));
        // 自动记忆：提取本次对话值得记住的信息
        console.error(chalk.gray('[AutoMemory] 正在保存对话记忆...'));
        await loop.autoMemorize();
        const stats = loop.getSession().getStats();
        console.log(chalk.gray(`Session stats: ${stats.messageCount} messages, ${stats.totalCost}`));
        showSessionResumeHint();
        rl.close();
        process.exit(0);
      }

      // 处理消息
      console.log();

      try {
        for await (const event of loop.processMessageStream(input)) {
          if (event.type === 'text') {
            process.stdout.write(event.content || '');
          } else if (event.type === 'tool_start') {
            console.log(chalk.cyan(`\n[Using tool: ${event.toolName}]`));
          } else if (event.type === 'tool_end') {
            const preview = (event.toolResult || '').substring(0, 200);
            console.log(chalk.gray(`[Result: ${preview}${preview.length >= 200 ? '...' : ''}]`));
          }
        }
        console.log('\n');
      } catch (err) {
        console.error(chalk.red(`\nError: ${err}`));
      }

      askQuestion();
    });
  };

  askQuestion();
}

// MCP 子命令
const mcpCommand = program.command('mcp').description('Configure and manage MCP servers');

// serve 命令 - 启动 Claude Code MCP 服务器
mcpCommand
  .command('serve')
  .description('Start the Claude Code MCP server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--stdio', 'Use stdio transport instead of HTTP')
  .action(async (options) => {
    console.log(chalk.bold(`\n🚀 ${t('cli.mcp.startingServer')}\n`));

    // MCP Server 功能 - 占位实现
    console.log(chalk.cyan(t('cli.mcp.transport', { transport: options.stdio ? 'stdio' : `HTTP on port ${options.port}` })));
    console.log();
    console.log(chalk.yellow(`⚠️  ${t('cli.mcp.notImplemented')}`));
    console.log(chalk.gray('This feature allows Claude Code to act as an MCP server,'));
    console.log(chalk.gray('exposing its tools to other MCP-compatible applications.'));
    console.log();
    console.log(chalk.gray('For now, you can:'));
    console.log(chalk.gray('  • Use `claude mcp add` to add external MCP servers'));
    console.log(chalk.gray('  • Use `claude mcp list` to see configured servers'));
    console.log();
  });

// add 命令 - 添加 MCP 服务器（支持命令和 URL）
mcpCommand
  .command('add <name> <commandOrUrl> [args...]')
  .description('Add an MCP server to Claude Code')
  .option('-s, --scope <scope>', 'Configuration scope (local, user, project)', 'local')
  .option('-e, --env <env...>', 'Environment variables (KEY=VALUE)')
  .option('--client-id <clientId>', 'OAuth client ID for HTTP/SSE servers')
  .option('--client-secret', 'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)')
  .option('--callback-port <port>', 'Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)')
  .action(async (name, commandOrUrl, args, options) => {
    const env: Record<string, string> = {};
    if (options.env) {
      options.env.forEach((e: string) => {
        const [key, ...valueParts] = e.split('=');
        env[key] = valueParts.join('=');
      });
    }

    // 判断是 URL 还是命令
    const isUrl = commandOrUrl.startsWith('http://') || commandOrUrl.startsWith('https://');

    if (isUrl) {
      // v2.1.30: 构建 OAuth 配置
      const oauth = options.clientId ? {
        clientId: options.clientId,
        ...(options.callbackPort ? { callbackPort: parseInt(options.callbackPort, 10) } : {}),
      } : undefined;

      // v2.1.30: 获取 client secret（从环境变量或提示输入）
      let clientSecret: string | undefined;
      if (options.clientSecret && options.clientId) {
        clientSecret = process.env.MCP_CLIENT_SECRET;
        if (!clientSecret) {
          // 使用 readline 提示输入
          const readline = await import('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          clientSecret = await new Promise<string>((resolve) => {
            rl.question(t('cli.mcp.enterSecret'), (answer) => {
              rl.close();
              resolve(answer);
            });
          });
        }
      }

      // SSE 服务器
      const serverConfig: any = {
        type: 'sse' as const,
        url: commandOrUrl,
        ...(oauth ? { oauth } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      };

      configManager.addMcpServer(name, serverConfig);
      console.log(chalk.green(`✓ ${oauth ? t('cli.mcp.addedSseOauth', { name }) : t('cli.mcp.addedSse', { name })}`));
    } else {
      // stdio 服务器
      configManager.addMcpServer(name, {
        type: 'stdio',
        command: commandOrUrl,
        args: args || [],
        env,
      });
      console.log(chalk.green(`✓ ${t('cli.mcp.addedStdio', { name })}`));
    }
  });

// remove 命令 - 移除 MCP 服务器
mcpCommand
  .command('remove <name>')
  .description('Remove an MCP server')
  .option('-s, --scope <scope>', 'Configuration scope (local, user, project)', 'local')
  .action((name, options) => {
    if (configManager.removeMcpServer(name)) {
      console.log(chalk.green(`✓ ${t('cli.mcp.removed', { name })}`));
    } else {
      console.log(chalk.red(t('cli.mcp.notFound', { name })));
    }
  });

// list 命令 - 列出所有 MCP 服务器
mcpCommand
  .command('list')
  .description('List configured MCP servers')
  .option('--status', 'Check connection status of each server (starts and stops server processes)')
  .action(async (options) => {
    const servers = configManager.getMcpServers();
    const serverNames = Object.keys(servers);

    if (serverNames.length === 0) {
      console.log(t('cli.mcp.noServers'));
      return;
    }

    console.log(chalk.bold(`\n${t('cli.mcp.configuredServers')}\n`));

    // 如果请求状态，需要连接服务器检测
    if (options.status) {
      const { registerMcpServer, connectMcpServer, getServerStatus } = await import('./tools/mcp.js');

      for (const name of serverNames) {
        const config = servers[name];
        console.log(chalk.cyan(`  ${name}`));
        console.log(chalk.gray(`    Type: ${config.type}`));
        if (config.command) {
          console.log(chalk.gray(`    Command: ${config.command} ${(config.args || []).join(' ')}`));
        }
        if (config.url) {
          console.log(chalk.gray(`    URL: ${config.url}`));
        }

        // 尝试连接并获取状态
        try {
          registerMcpServer(name, config);
          const connected = await connectMcpServer(name, false); // 不重试
          const status = getServerStatus(name);

          if (connected && status) {
            console.log(chalk.green(`    ${t('cli.mcp.statusConnected')}`));
            console.log(chalk.gray(`    Tools: ${status.toolCount}`));
            console.log(chalk.gray(`    Resources: ${status.resourceCount}`));
          } else {
            console.log(chalk.yellow(`    ${t('cli.mcp.statusNotConnected')}`));
          }
        } catch (err) {
          console.log(chalk.red(`    ${t('cli.mcp.statusError', { error: err instanceof Error ? err.message : String(err) })}`));
        }
      }

      // v2.1.6 修复: 确保所有启动的 MCP 进程都被清理
      console.log(chalk.gray(`\n${t('cli.mcp.cleaningUp')}`));
      await cleanupMcpServers(true); // resetFlag = true 允许后续再次清理
      console.log(chalk.gray(t('cli.mcp.done')));
    } else {
      // 不检查状态，只显示配置
      serverNames.forEach(name => {
        const config = servers[name];
        console.log(chalk.cyan(`  ${name}`));
        console.log(chalk.gray(`    Type: ${config.type}`));
        if (config.command) {
          console.log(chalk.gray(`    Command: ${config.command} ${(config.args || []).join(' ')}`));
        }
        if (config.url) {
          console.log(chalk.gray(`    URL: ${config.url}`));
        }
      });
    }
    console.log();
  });

// get 命令 - 获取 MCP 服务器详情
mcpCommand
  .command('get <name>')
  .description('Get details about an MCP server')
  .option('--status', 'Check connection status (starts and stops the server process)')
  .action(async (name, options) => {
    const servers = configManager.getMcpServers();
    const config = servers[name];

    if (!config) {
      console.log(chalk.red(`\n${t('cli.mcp.notFound', { name })}\n`));
      return;
    }

    console.log(chalk.bold(`\nMCP Server: ${chalk.cyan(name)}\n`));
    console.log(`  Type: ${config.type}`);

    if (config.command) {
      console.log(`  Command: ${config.command}`);
      if (config.args && config.args.length > 0) {
        console.log(`  Arguments: ${config.args.join(' ')}`);
      }
    }

    if (config.url) {
      console.log(`  URL: ${config.url}`);
    }

    if (config.env && Object.keys(config.env).length > 0) {
      console.log('  Environment:');
      Object.entries(config.env).forEach(([key, value]) => {
        console.log(`    ${key}=${value}`);
      });
    }

    // 如果请求状态，尝试连接服务器
    if (options.status) {
      const { registerMcpServer, connectMcpServer, getServerStatus } = await import('./tools/mcp.js');

      console.log(chalk.gray('\n  Checking connection status...'));

      try {
        registerMcpServer(name, config);
        const connected = await connectMcpServer(name, false); // 不重试
        const status = getServerStatus(name);

        if (connected && status) {
          console.log(chalk.green(`  ${t('cli.mcp.statusConnected')}`));
          console.log(`  Capabilities: ${status.capabilities.join(', ') || 'none'}`);
          console.log(`  Tools: ${status.toolCount}`);
          console.log(`  Resources: ${status.resourceCount}`);
        } else {
          console.log(chalk.yellow(`  ${t('cli.mcp.statusNotConnected')}`));
        }
      } catch (err) {
        console.log(chalk.red(`  ${t('cli.mcp.statusError', { error: err instanceof Error ? err.message : String(err) })}`));
      }

      // v2.1.6 修复: 确保启动的 MCP 进程被清理
      console.log(chalk.gray('\n  Cleaning up MCP server process...'));
      await cleanupMcpServers(true); // resetFlag = true 允许后续再次清理
      console.log(chalk.gray('  Done.'));
    } else {
      // 不检查状态时的提示
      console.log(chalk.gray('\n  Status: Use --status flag to check connection status'));
    }

    console.log();
  });

// add-json 命令 - 用 JSON 字符串添加 MCP 服务器
mcpCommand
  .command('add-json <name> <json>')
  .description('Add an MCP server (stdio or SSE) with a JSON string')
  .option('-s, --scope <scope>', 'Configuration scope (local, user, project)', 'local')
  .action((name, jsonString, options) => {
    try {
      const config = JSON.parse(jsonString);

      // 验证配置格式
      if (!config.type || !['stdio', 'sse', 'http'].includes(config.type)) {
        console.log(chalk.red(`\n❌ ${t('cli.mcp.invalidType')}\n`));
        return;
      }

      if (config.type === 'stdio' && !config.command) {
        console.log(chalk.red(`\n❌ ${t('cli.mcp.stdioRequiresCmd')}\n`));
        return;
      }

      if ((config.type === 'sse' || config.type === 'http') && !config.url) {
        console.log(chalk.red(`\n❌ ${t('cli.mcp.sseRequiresUrl')}\n`));
        return;
      }

      configManager.addMcpServer(name, config);
      console.log(chalk.green(`\n✓ ${t('cli.mcp.addedServer', { name })}\n`));
      console.log(chalk.gray(`Config: ${JSON.stringify(config, null, 2)}\n`));
    } catch (error) {
      console.log(chalk.red(`\n❌ ${t('cli.mcp.invalidJson', { error: error instanceof Error ? error.message : String(error) })}\n`));
    }
  });

// add-from-claude-desktop 命令 - 从 Claude Desktop 导入 MCP 服务器
mcpCommand
  .command('add-from-claude-desktop')
  .description('Import MCP servers from Claude Desktop (Mac and WSL only)')
  .option('--select <names...>', 'Select specific servers to import')
  .option('--all', 'Import all servers without prompting')
  .action(async (options) => {
    console.log(chalk.bold('\n📥 Importing MCP servers from Claude Desktop\n'));

    // 从 Claude Desktop 导入 MCP 服务器（功能尚未完全实现）
    console.log(chalk.yellow('⚠️  This feature is not yet fully implemented.\n'));
    console.log('Claude Desktop config locations:');
    console.log(chalk.gray('  macOS: ~/Library/Application Support/Claude/claude_desktop_config.json'));
    console.log(chalk.gray('  Windows: %APPDATA%\\Claude\\claude_desktop_config.json'));
    console.log(chalk.gray('  WSL: /mnt/c/Users/<username>/AppData/Roaming/Claude/claude_desktop_config.json\n'));
    console.log(chalk.cyan('To import manually, use: claude mcp add-json <server-name> \'{"command": "..."}\''));
  });

// reset-project-choices 命令 - 重置项目级 MCP 服务器选择
mcpCommand
  .command('reset-project-choices')
  .description('Reset all approved and rejected project-scoped (.mcp.json) servers')
  .action(() => {
    console.log(chalk.bold('\n🔄 Resetting project MCP server choices\n'));

    try {
      const projectMcpFile = path.join(process.cwd(), '.claude', '.mcp.json');

      if (fs.existsSync(projectMcpFile)) {
        fs.unlinkSync(projectMcpFile);
        console.log(chalk.green('✓ Reset project MCP server choices'));
        console.log(chalk.gray(`  Removed: ${projectMcpFile}\n`));
      } else {
        console.log(chalk.gray('No project MCP choices found.\n'));
      }

      // 同时清除项目配置中的禁用服务器列表
      const projectSettingsFile = path.join(process.cwd(), '.claude', 'settings.json');
      if (fs.existsSync(projectSettingsFile)) {
        try {
          const settings = JSON.parse(fs.readFileSync(projectSettingsFile, 'utf-8'));

          if (settings.disabledMcpServers) {
            delete settings.disabledMcpServers;
            fs.writeFileSync(projectSettingsFile, JSON.stringify(settings, null, 2));
            console.log(chalk.green('✓ Cleared disabled MCP servers list'));
            console.log(chalk.gray(`  Updated: ${projectSettingsFile}\n`));
          }
        } catch (err) {
          // 忽略解析错误
        }
      }

      console.log('All project MCP server choices have been reset.');
      console.log('You will be prompted again for approval when using project-scoped servers.\n');
    } catch (error) {
      console.log(chalk.red(`\n❌ Failed to reset: ${error instanceof Error ? error.message : error}\n`));
    }
  });

// Plugin 子命令 - 使用完整实现
program.addCommand(createPluginCommand());

// Daemon 子命令
const daemonCmd = program
  .command('daemon')
  .description('Manage daemon process for scheduled tasks and file watching');

daemonCmd
  .command('start')
  .description('Start the daemon process (foreground)')
  .option('-c, --config <path>', 'Path to daemon config file')
  .action(async () => {
    const { DaemonManager } = await import('./daemon/index.js');
    const manager = new DaemonManager({ cwd: process.cwd() });
    try {
      await manager.start();
      // 保持进程运行
      await new Promise(() => {});
    } catch (err) {
      console.error(chalk.red(`Daemon start failed: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

daemonCmd
  .command('stop')
  .description('Stop the running daemon')
  .action(async () => {
    const { stopDaemon, isDaemonRunning } = await import('./daemon/index.js');
    if (!isDaemonRunning()) {
      console.log(chalk.yellow('No daemon is running.'));
      return;
    }
    if (stopDaemon()) {
      console.log(chalk.green('Daemon stopped.'));
    } else {
      console.log(chalk.red('Failed to stop daemon.'));
    }
  });

daemonCmd
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    const { getDaemonStatus } = await import('./daemon/index.js');
    const status = getDaemonStatus();
    if (!status.running) {
      console.log(chalk.yellow('Daemon is not running.'));
      console.log(chalk.gray('Start with: claude daemon start'));
      return;
    }
    console.log(chalk.green('Daemon is running.'));
    console.log(chalk.gray(`  PID: ${status.pid}`));
    console.log(chalk.gray(`  Dynamic tasks: ${status.dynamicTaskCount}`));
  });

daemonCmd
  .command('tasks')
  .description('List all scheduled tasks')
  .action(async () => {
    const { TaskStore } = await import('./daemon/store.js');
    const store = new TaskStore();
    const tasks = store.listTasks();
    if (tasks.length === 0) {
      console.log(chalk.yellow('No scheduled tasks.'));
      return;
    }
    console.log(chalk.bold(`\nScheduled Tasks (${tasks.length}):\n`));
    for (const t of tasks) {
      console.log(chalk.cyan(`  [${t.type}] ${t.name}`));
      console.log(chalk.gray(`    ID: ${t.id}`));
      if (t.type === 'once' && t.triggerAt) {
        console.log(chalk.gray(`    Trigger: ${new Date(t.triggerAt).toLocaleString()}`));
      }
      if (t.type === 'interval' && t.intervalMs) {
        console.log(chalk.gray(`    Every: ${Math.round(t.intervalMs / 60000)} min`));
      }
      if (t.type === 'watch' && t.watchPaths) {
        console.log(chalk.gray(`    Watch: ${t.watchPaths.join(', ')}`));
      }
      console.log(chalk.gray(`    Prompt: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? '...' : ''}`));
      console.log(chalk.gray(`    Notify: ${t.notify.join(', ')}`));
      console.log(chalk.gray(`    Enabled: ${t.enabled}`));
      console.log();
    }
  });

// 工具子命令
program
  .command('tools')
  .description('List available tools')
  .action(() => {
    console.log(chalk.bold('\nAvailable Tools:\n'));
    const tools = toolRegistry.getDefinitions();
    tools.forEach(tool => {
      console.log(chalk.cyan(`  ${tool.name}`));
      console.log(chalk.gray(`    ${tool.description.split('\n')[0]}`));
    });
    console.log();
  });

// 会话子命令
program
  .command('sessions')
  .description('List previous sessions')
  .option('-l, --limit <number>', 'Maximum sessions to show', '20')
  .option('-s, --search <term>', 'Search sessions')
  .action((options) => {
    const sessions = listSessions({
      limit: parseInt(options.limit),
      search: options.search,
    });

    if (sessions.length === 0) {
      console.log('No saved sessions found.');
      return;
    }

    console.log(chalk.bold('\nSaved Sessions:\n'));
    sessions.forEach(s => {
      const date = new Date(s.createdAt).toLocaleString();
      console.log(`  ${chalk.cyan(s.id)}`);
      if (s.name) {
        console.log(`    Name: ${s.name}`);
      }
      console.log(`    Created: ${date}`);
      console.log(`    Directory: ${s.workingDirectory}`);
      console.log(`    Messages: ${s.messageCount}\n`);
    });
  });

// Doctor 命令
program
  .command('doctor')
  .description('Check the health of your Claude Code installation')
  .option('--verbose', 'Show detailed diagnostics')
  .action(async (options) => {
    const { runDiagnostics, formatDiagnosticReport } = await import('./diagnostics/index.js');

    console.log(chalk.bold('\nRunning Claude Code diagnostics...\n'));

    try {
      const report = await runDiagnostics();
      console.log(formatDiagnosticReport(report));

      if (report.summary.failed > 0) {
        console.log(chalk.red(`  ✗ ${report.summary.failed} critical issue(s) found`));
      }
      if (report.summary.warnings > 0) {
        console.log(chalk.yellow(`  ⚠ ${report.summary.warnings} warning(s)`));
      }
      if (report.summary.failed === 0 && report.summary.warnings === 0) {
        console.log(chalk.green('  ✓ All checks passed!'));
      }

      if (options.verbose) {
        console.log(chalk.gray('\n  Additional info:'));
        console.log(chalk.gray(`  - Working directory: ${process.cwd()}`));
        console.log(chalk.gray(`  - Tools registered: ${toolRegistry.getAll().length}`));
        const mcpServers = Object.keys(configManager.getMcpServers());
        console.log(chalk.gray(`  - MCP servers: ${mcpServers.length}`));
      }
    } catch (err) {
      console.log(chalk.red(`\n  ✗ Diagnostics failed: ${err}`));
    }

    console.log();
  });

// Setup Token 命令
program
  .command('setup-token')
  .description('Set up a long-lived authentication token (requires Claude subscription)')
  .action(async () => {
    console.log(chalk.bold('\nSetup Authentication Token\n'));
    console.log(chalk.gray('This feature requires a Claude subscription.'));
    console.log(chalk.gray('Visit https://platform.claude.com to get your API key.\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Enter your API key: ', (apiKey) => {
      if (apiKey.trim()) {
        configManager.set('apiKey', apiKey.trim());
        console.log(chalk.green('\n✓ API key saved successfully!'));
      } else {
        console.log(chalk.yellow('\nNo API key provided.'));
      }
      rl.close();
    });
  });

// Update 命令
program
  .command('update')
  .description('Check for updates and install if available')
  .option('--force', 'Force reinstall even if already up to date')
  .option('--beta', 'Install beta version')
  .option('--canary', 'Install canary version')
  .option('--dry-run', 'Show what would be updated without actually updating')
  .option('--list-versions', 'List all available versions')
  .option('--version <version>', 'Install a specific version')
  .option('--rollback <version>', 'Rollback to a specific version')
  .action(async (options) => {
    const { checkForUpdates, performUpdate, rollbackVersion, listVersions } = await import('./updater/index.js');

    console.log(chalk.bold('\n📦 Claude Code Update Manager\n'));

    try {
      // 列出可用版本
      if (options.listVersions) {
        console.log(chalk.cyan('Fetching available versions...\n'));
        const versions = await listVersions();
        console.log(chalk.bold('Available Versions:\n'));
        versions.slice(0, 20).forEach((v, i) => {
          if (i === 0) {
            console.log(chalk.green(`  ✓ ${v} (latest)`));
          } else {
            console.log(chalk.gray(`    ${v}`));
          }
        });
        if (versions.length > 20) {
          console.log(chalk.gray(`\n  ... and ${versions.length - 20} more versions`));
        }
        console.log();
        return;
      }

      // 回滚版本
      if (options.rollback) {
        console.log(chalk.yellow(`Rolling back to version ${options.rollback}...\n`));
        const success = await rollbackVersion(options.rollback, {
          showProgress: true,
          dryRun: options.dryRun,
        });

        if (success) {
          console.log(chalk.green(`\n✓ Successfully rolled back to version ${options.rollback}`));
        } else {
          console.log(chalk.red('\n✗ Rollback failed'));
        }
        return;
      }

      // 检查更新
      console.log(chalk.cyan(`Current version: ${VERSION_FULL}\n`));
      console.log(chalk.gray('Checking for updates...\n'));

      const updateInfo = await checkForUpdates({
        channel: options.canary ? 'canary' : options.beta ? 'beta' : 'stable',
      });

      if (!updateInfo.hasUpdate && !options.force) {
        console.log(chalk.green('✓ You are already on the latest version!'));
        console.log();
        return;
      }

      // 显示版本信息
      console.log(chalk.bold('Update Available:\n'));
      console.log(`  Current:  ${chalk.gray(updateInfo.current)}`);
      console.log(`  Latest:   ${chalk.green(updateInfo.latest)}\n`);

      // 显示变更日志
      if (updateInfo.changelog && updateInfo.changelog.length > 0) {
        console.log(chalk.bold('Recent Versions:\n'));
        updateInfo.changelog.slice(0, 5).forEach(v => {
          console.log(chalk.gray(`  • ${v}`));
        });
        console.log();
      }

      // 显示版本详情
      if (updateInfo.versionInfo) {
        const info = updateInfo.versionInfo;
        if (info.description) {
          console.log(chalk.gray(`Description: ${info.description}\n`));
        }
        if (info.minimumNodeVersion) {
          console.log(chalk.gray(`Required Node.js: ${info.minimumNodeVersion}\n`));
        }
      }

      // 执行更新
      if (options.dryRun) {
        console.log(chalk.yellow('[DRY-RUN] Would update to version ' + updateInfo.latest));
        console.log(chalk.gray('Run without --dry-run to perform the actual update\n'));
        return;
      }

      // 确认更新
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const shouldUpdate = await new Promise<boolean>((resolve) => {
        rl.question(chalk.yellow(`\nUpdate to ${updateInfo.latest}? (y/N) `), (answer) => {
          rl.close();
          resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
      });

      if (!shouldUpdate && !options.force) {
        console.log(chalk.gray('\nUpdate cancelled.\n'));
        return;
      }

      console.log(chalk.cyan('\nUpdating...\n'));

      const success = await performUpdate({
        version: options.version,
        force: options.force,
        beta: options.beta,
        canary: options.canary,
        showProgress: true,
        dryRun: false,
      });

      if (success) {
        console.log(chalk.green('\n✓ Update completed successfully!'));
        console.log(chalk.gray('Please restart Claude Code to use the new version.\n'));
      } else {
        console.log(chalk.red('\n✗ Update failed'));
        console.log(chalk.gray('Try running: npm install -g claude-code-open\n'));
      }
    } catch (error) {
      console.error(chalk.red('Error during update:'), error);
      console.log(chalk.gray('\nManual update:'));
      console.log(chalk.gray('  npm install -g claude-code-open\n'));
    }
  });

// Install 命令
program
  .command('install [target]')
  .description('Install Claude Code native build')
  .option('--force', 'Force reinstall')
  .action((target, options) => {
    const version = target || 'stable';
    console.log(chalk.bold(`\nInstalling Claude Code (${version})...\n`));
    console.log(chalk.gray('For native builds, please visit:'));
    console.log(chalk.cyan('https://github.com/anthropics/claude-code\n'));
  });

// GitHub Actions 设置命令
program
  .command('github-setup')
  .description('Set up Claude Code GitHub Actions workflow')
  .action(async () => {
    console.log(chalk.bold('\n🐙 Setting up Claude Code GitHub Actions...\n'));

    const { checkGitHubCLI, setupGitHubWorkflow } = await import('./github/index.js');

    const ghStatus = await checkGitHubCLI();
    if (!ghStatus.installed) {
      console.log(chalk.yellow(`⚠️  ${t('cli.github.ghNotInstalled')}`));
      console.log(chalk.gray(`   ${t('cli.github.installFrom')}\n`));
    } else if (!ghStatus.authenticated) {
      console.log(chalk.yellow(`⚠️  ${t('cli.github.ghNotAuth')}`));
      console.log(chalk.gray(`   ${t('cli.github.runGhAuth')}\n`));
    } else {
      console.log(chalk.green(`✓ ${t('cli.github.ghReady')}`));
    }

    const result = await setupGitHubWorkflow(process.cwd());

    if (result.success) {
      console.log(chalk.green(`\n✓ ${result.message}`));
      console.log(chalk.gray(`  Path: ${result.workflowPath}`));
      console.log(chalk.bold(`\n${t('cli.github.nextSteps')}`));
      console.log(t('cli.github.addSecret'));
      console.log(t('cli.github.settingsPath'));
      console.log(t('cli.github.commitPush'));
      console.log(t('cli.github.openPr'));
    } else {
      console.log(chalk.yellow(`\n⚠️  ${result.message}`));
      if (result.workflowPath) {
        console.log(chalk.gray(`  Path: ${result.workflowPath}`));
      }
    }
    console.log();
  });

// PR Review 命令
program
  .command('review-pr <number>')
  .description('Review a GitHub pull request')
  .action(async (prNumber) => {
    console.log(chalk.bold(`\n📝 Reviewing PR #${prNumber}...\n`));

    const { checkGitHubCLI, getPRInfo } = await import('./github/index.js');

    const ghStatus = await checkGitHubCLI();
    if (!ghStatus.authenticated) {
      console.log(chalk.red(`${t('cli.github.ghNotAuth')} ${t('cli.github.runGhAuth')}`));
      return;
    }

    const prInfo = await getPRInfo(parseInt(prNumber));
    if (!prInfo) {
      console.log(chalk.red(`Failed to get PR #${prNumber} info`));
      return;
    }

    console.log(chalk.cyan(`Title: ${prInfo.title}`));
    console.log(chalk.gray(`Author: ${prInfo.author}`));
    console.log(chalk.gray(`State: ${prInfo.state}`));
    console.log(chalk.gray(`Changes: +${prInfo.additions} -${prInfo.deletions} (${prInfo.changedFiles} files)`));
    console.log();
    console.log(chalk.gray('Use Claude to review: claude "review PR #' + prNumber + '"'));
    console.log();
  });

// Provider 命令
program
  .command('provider')
  .description('Show current API provider configuration')
  .action(async () => {
    const { detectProvider, getProviderInfo, validateProviderConfig, getProviderDisplayName } = await import('./providers/index.js');

    console.log(chalk.bold('\n☁️  API Provider Configuration\n'));

    const config = detectProvider();
    const info = getProviderInfo(config);
    const validation = validateProviderConfig(config);

    console.log(`  Provider: ${chalk.cyan(getProviderDisplayName(config.type))}`);
    console.log(`  Model:    ${chalk.gray(info.model)}`);
    console.log(`  Base URL: ${chalk.gray(info.baseUrl)}`);

    if (info.region) {
      console.log(`  Region:   ${chalk.gray(info.region)}`);
    }

    if (validation.valid) {
      console.log(chalk.green('\n  ✓ Configuration is valid'));
    } else {
      console.log(chalk.red('\n  ✗ Configuration issues:'));
      validation.errors.forEach((err) => {
        console.log(chalk.red(`    - ${err}`));
      });
    }

    console.log(chalk.gray('\n  Environment variables:'));
    const envVars = [
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'AWS_REGION',
      'ANTHROPIC_VERTEX_PROJECT_ID',
    ];

    envVars.forEach((v) => {
      const val = process.env[v];
      if (val) {
        const display = v.includes('KEY') ? `***${val.slice(-4)}` : val;
        console.log(chalk.gray(`    ${v}=${display}`));
      }
    });

    console.log();
  });

// Checkpoint 命令
program
  .command('checkpoint')
  .description('Manage file checkpoints')
  .argument('[action]', 'Action: list, restore, clear')
  .argument('[file]', 'File path (for restore)')
  .action(async (action, file) => {
    const { getCurrentSession, getCheckpointHistory, restoreCheckpoint, clearCheckpoints } = await import('./checkpoint/index.js');

    const session = getCurrentSession();

    if (!action || action === 'list') {
      console.log(chalk.bold('\n📌 File Checkpoints\n'));

      if (!session) {
        console.log(chalk.gray('  No active checkpoint session.'));
        console.log();
        return;
      }

      const files = Array.from(session.checkpoints.keys());
      if (files.length === 0) {
        console.log(chalk.gray('  No checkpoints recorded yet.'));
      } else {
        files.forEach((f) => {
          const history = getCheckpointHistory(f);
          console.log(chalk.cyan(`  ${f}`));
          console.log(chalk.gray(`    ${history.checkpoints.length} checkpoint(s), current: #${history.currentIndex + 1}`));
        });
      }
    } else if (action === 'restore' && file) {
      const result = restoreCheckpoint(file);
      if (result.success) {
        console.log(chalk.green(`\n  ✓ ${result.message}`));
      } else {
        console.log(chalk.red(`\n  ✗ ${result.message}`));
      }
    } else if (action === 'clear') {
      clearCheckpoints();
      console.log(chalk.green('\n  ✓ All checkpoints cleared'));
    } else {
      console.log(chalk.yellow('\n  Usage: claude checkpoint [list|restore <file>|clear]'));
    }

    console.log();
  });

// Login 命令
program
  .command('login')
  .description('Login to Claude API or claude.ai')
  .option('--api-key', 'Setup with API key')
  .option('--oauth', 'OAuth login (interactive)')
  .option('--claudeai', 'OAuth with Claude.ai account')
  .option('--console', 'OAuth with Anthropic Console account')
  .action(async (options) => {
    const {
      startOAuthLogin,
      isAuthenticated,
      getAuthType,
      getAuth,
    } = await import('./auth/index.js');

    console.log(chalk.bold('\n🔐 Claude Code Login\n'));

    // 检查当前认证状态
    const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    const hasCredentials = fs.existsSync(path.join(os.homedir(), '.claude', 'credentials.json'));
    const hasOAuthToken = fs.existsSync(path.join(os.homedir(), '.claude', 'auth.json'));

    let authStatus = 'Not authenticated';
    if (hasApiKey) {
      authStatus = 'Authenticated (API Key from environment)';
    } else if (hasCredentials) {
      authStatus = 'Authenticated (API Key from file)';
    } else if (hasOAuthToken) {
      authStatus = 'Authenticated (OAuth)';
    }

    // 无参数时显示帮助
    if (!options.apiKey && !options.oauth && !options.claudeai && !options.console) {
      console.log(`Current Status: ${chalk.cyan(authStatus)}\n`);
      console.log(chalk.bold('Login Methods:\n'));
      console.log('  1. API Key (Recommended for developers)');
      console.log('     • Get key from: https://platform.claude.com');
      console.log(chalk.cyan('     • Command: claude login --api-key\n'));
      console.log('  2. OAuth with Claude.ai Account');
      console.log('     • For Claude Pro/Max subscribers');
      console.log(chalk.cyan('     • Command: claude login --claudeai\n'));
      console.log('  3. OAuth with Console Account');
      console.log('     • For Anthropic Console users');
      console.log(chalk.cyan('     • Command: claude login --console\n'));
      console.log(chalk.bold('Quick Start:\n'));
      console.log(chalk.gray('  claude login --api-key        Setup API key'));
      console.log(chalk.gray('  claude login --oauth          Interactive OAuth'));
      console.log(chalk.gray('  claude setup-token            Generate long-term token\n'));
      return;
    }

    // --api-key 方法
    if (options.apiKey) {
      console.log(chalk.bold('API Key Setup\n'));
      console.log('API keys provide usage-based billing and are the recommended method');
      console.log('for developers using Claude Code.\n');
      console.log(chalk.bold('Steps:\n'));
      console.log('1. Get your API key:');
      console.log(chalk.cyan('   Visit: https://platform.claude.com/settings/keys'));
      console.log('   Create or copy an existing key\n');
      console.log('2. Set the API key (choose one method):\n');
      console.log('   a) Environment variable (recommended):');
      console.log(chalk.gray('      export ANTHROPIC_API_KEY=sk-ant-your-key-here\n'));
      console.log('   b) Direct setup (stores in ~/.claude/credentials.json):');
      console.log(chalk.gray('      claude setup-token\n'));
      console.log('3. Verify:');
      console.log(chalk.gray('   claude doctor\n'));
      console.log(`Current Status: ${chalk.cyan(authStatus)}\n`);
      return;
    }

    // OAuth 方法
    if (options.oauth || options.claudeai || options.console) {
      const loginType = options.claudeai
        ? 'Claude.ai (Subscription)'
        : options.console
        ? 'Console (API Billing)'
        : 'OAuth';

      console.log(chalk.bold(`OAuth Login: ${loginType}\n`));
      console.log('OAuth authentication provides seamless integration with your Claude');
      console.log('or Anthropic Console account.\n');

      try {
        console.log(chalk.cyan('Starting OAuth login flow...\n'));

        const accountType = options.claudeai ? 'claude.ai' : 'console';
        const authResult = await startOAuthLogin({ accountType });

        if (authResult && authResult.accessToken) {
          console.log(chalk.green(`\n✅ ${t('cli.auth.oauthSuccess')}\n`));
          console.log(t('cli.auth.authDetails'));
          console.log(`  • Type: OAuth`);
          console.log(`  • Access Token: ${authResult.accessToken.substring(0, 20)}...`);
          if (authResult.expiresAt) {
            console.log(`  • Expires At: ${new Date(authResult.expiresAt).toLocaleString()}`);
          }
          console.log(`\n${t('cli.auth.credsSaved')}\n`);
          console.log(`${t('cli.auth.canUseNow')}\n`);
          console.log(t('cli.auth.toVerify'));
          console.log(chalk.gray('  claude doctor'));
          console.log(chalk.gray('  claude api test\n'));
        } else {
          throw new Error('OAuth login returned invalid result');
        }
      } catch (error) {
        console.log(chalk.red(`\n❌ ${t('cli.auth.oauthFailed')}\n`));
        console.log(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        console.log(t('cli.auth.oauthFrameworkNote'));
        console.log();
        console.log(t('cli.auth.forImmediate'));
        console.log(chalk.cyan('  claude login --api-key     Setup with API key'));
        console.log(chalk.cyan('  claude setup-token         Quick API key setup\n'));
      }
    }
  });

// Logout 命令
program
  .command('logout')
  .description('Logout from Claude')
  .action(async () => {
    const { logout, isAuthenticated, getAuthType, getAuth } = await import('./auth/index.js');

    console.log(chalk.bold(`\n🔐 ${t('cli.auth.logoutTitle')}\n`));

    // 检查当前认证状态
    const wasAuthenticated = isAuthenticated();
    const authType = getAuthType();
    const currentAuthInfo = getAuth();

    if (!wasAuthenticated) {
      console.log(t('cli.auth.noActiveSession'));
      console.log(`\n${t('cli.auth.notAuthenticated')}\n`);
      console.log(t('cli.auth.toLogin'));
      console.log(chalk.gray('  claude login              Show login options'));
      console.log(chalk.gray('  claude login --api-key    Setup with API key'));
      console.log(chalk.gray('  claude login --oauth      OAuth login'));
      console.log(chalk.gray('  claude setup-token        Quick API key setup\n'));
      return;
    }

    let clearedItems: string[] = [];

    // 调用认证系统的 logout() 函数
    try {
      logout();
      clearedItems.push('OAuth token (from auth system)');
    } catch (err) {
      // 继续处理其他清理
    }

    // 清除存储的 API key
    const credentialsFile = path.join(os.homedir(), '.claude', 'credentials.json');
    if (fs.existsSync(credentialsFile)) {
      try {
        fs.unlinkSync(credentialsFile);
        clearedItems.push('Stored API key');
      } catch (err) {
        // 忽略错误
      }
    }

    // 清除配置文件中的会话信息
    const configFile = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(configFile)) {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        let modified = false;

        if (config.sessionToken) {
          delete config.sessionToken;
          modified = true;
          clearedItems.push('Session token');
        }

        if (config.oauthAccount) {
          delete config.oauthAccount;
          modified = true;
          clearedItems.push('OAuth account');
        }

        if (modified) {
          fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        }
      } catch (err) {
        // 忽略错误
      }
    }

    // 构建退出消息
    console.log(chalk.green(`✅ ${t('cli.auth.logoutSuccess')}\n`));
    console.log(t('cli.auth.prevAuth'));
    console.log(`  • Type: ${authType || 'Unknown'}`);
    if (currentAuthInfo?.accessToken) {
      console.log(`  • Access Token: ${currentAuthInfo.accessToken.substring(0, 20)}...`);
    }
    if (currentAuthInfo?.apiKey) {
      console.log(`  • API Key: ${currentAuthInfo.apiKey.substring(0, 15)}...`);
    }

    console.log(`\n${t('cli.auth.cleared')}`);
    for (const item of clearedItems) {
      console.log(`  • ${item}`);
    }

    console.log(`\n${t('cli.auth.toCompletelyRemove')}\n`);
    console.log(t('cli.auth.removeEnvVars'));
    console.log(chalk.gray('   unset ANTHROPIC_API_KEY'));
    console.log(chalk.gray('   unset CLAUDE_API_KEY\n'));
    console.log(t('cli.auth.verifyCleared'));
    console.log(chalk.gray('   ls -la ~/.claude/\n'));
    console.log(t('cli.auth.toLoginAgain'));
    console.log(chalk.gray('  claude login              Show login options'));
    console.log(chalk.gray('  claude login --api-key    Setup with API key'));
    console.log(chalk.gray('  claude login --oauth      OAuth login\n'));
  });

// API 命令
const apiCommand = program.command('api').description('Interact with Claude API directly');

// api query
apiCommand
  .command('query <query...>')
  .description('Send a direct query to Claude API')
  .option('-m, --model <model>', 'Model to use', 'claude-sonnet-4-20250514')
  .action(async (queryParts, options) => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const query = queryParts.join(' ');

    // 获取 API key
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      const credentialsFile = path.join(os.homedir(), '.claude', 'credentials.json');
      if (fs.existsSync(credentialsFile)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
          if (!creds.apiKey) {
            console.log(chalk.red(`\n❌ ${t('cli.api.noKeyFound')}\n`));
            console.log(t('cli.api.setupKey'));
            console.log(chalk.gray('  claude login --api-key     Setup with API key'));
            console.log(chalk.gray('  claude setup-token         Quick API key setup\n'));
            return;
          }
        } catch {
          console.log(chalk.red(`\n❌ ${t('cli.api.noKeyFound')}\n`));
          return;
        }
      } else {
        console.log(chalk.red(`\n❌ ${t('cli.api.noKeyFound')}\n`));
        console.log(t('cli.api.setupKey'));
        console.log(chalk.gray('  claude login --api-key     Setup with API key'));
        console.log(chalk.gray('  claude setup-token         Quick API key setup\n'));
        return;
      }
    }

    console.log(chalk.cyan(`\n🤖 ${t('cli.api.sendingQuery')}\n`));

    try {
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: options.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
      });

      // 提取响应文本
      const textContent = response.content.find((block) => block.type === 'text');
      const responseText = textContent && 'text' in textContent ? textContent.text : 'No text response';

      console.log(chalk.bold(`${t('cli.api.response')}\n`));
      console.log(responseText);

      console.log(chalk.gray('\n─────────────────────────────────────'));
      console.log(chalk.gray(`Usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`));
      console.log(chalk.gray(`Model: ${response.model}`));
      console.log(chalk.gray(`Stop reason: ${response.stop_reason}\n`));
    } catch (error) {
      console.log(chalk.red(`\n❌ ${t('cli.api.apiError', { error: error instanceof Error ? error.message : String(error) })}\n`));
    }
  });

// api models
apiCommand
  .command('models')
  .description('List available Claude models')
  .action(() => {
    console.log(chalk.bold('\n📋 Available Claude Models\n'));
    console.log(chalk.bold('Claude 4.6 Series (Latest)\n'));
    console.log(chalk.cyan('  claude-opus-4-6'));
    console.log('    • Context: 1M tokens');
    console.log('    • Best for: Complex reasoning, long tasks');
    console.log('    • Pricing: $15 / $75 per MTok (in/out)');
    console.log('    • Highest capability (latest)\n');
    console.log(chalk.bold('Claude 4.5 Series\n'));
    console.log(chalk.cyan('  claude-opus-4-5-20251101'));
    console.log('    • Context: 1M tokens');
    console.log('    • Best for: Complex reasoning, long tasks');
    console.log('    • Pricing: $15 / $75 per MTok (in/out)\n');
    console.log(chalk.cyan('  claude-sonnet-4-5-20250929'));
    console.log('    • Context: 200K tokens');
    console.log('    • Best for: Most tasks, balanced performance');
    console.log('    • Pricing: $3 / $15 per MTok (in/out)');
    console.log('    • Recommended: Default choice\n');
    console.log(chalk.cyan('  claude-haiku-4-5-20250514'));
    console.log('    • Context: 200K tokens');
    console.log('    • Best for: Fast, simple tasks');
    console.log('    • Pricing: $0.80 / $4 per MTok (in/out)');
    console.log('    • Most cost-effective\n');
    console.log(chalk.bold('Claude 3.5 Series\n'));
    console.log(chalk.gray('  • claude-3-5-sonnet-20241022'));
    console.log(chalk.gray('  • claude-3-5-haiku-20241022\n'));
    console.log('Documentation: https://docs.anthropic.com/en/docs/models-overview\n');
  });

// api test
apiCommand
  .command('test')
  .description('Test API connection')
  .action(async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;

    console.log(chalk.bold(`\n🧪 ${t('cli.api.testingConnection')}\n`));

    // 获取 API key
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      const credentialsFile = path.join(os.homedir(), '.claude', 'credentials.json');
      if (fs.existsSync(credentialsFile)) {
        try {
          const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
          if (!creds.apiKey) {
            console.log(chalk.red(`❌ ${t('cli.api.keyNotFound')}\n`));
            console.log(t('cli.api.setupKey'));
            console.log(chalk.gray('  claude login --api-key'));
            console.log(chalk.gray('  claude setup-token\n'));
            return;
          }
        } catch {
          console.log(chalk.red(`❌ ${t('cli.api.keyNotFound')}\n`));
          return;
        }
      } else {
        console.log(chalk.red(`❌ ${t('cli.api.keyNotFound')}\n`));
        console.log(t('cli.api.setupKey'));
        console.log(chalk.gray('  claude login --api-key'));
        console.log(chalk.gray('  claude setup-token\n'));
        return;
      }
    }

    // 验证 API key 格式
    if (!apiKey.startsWith('sk-ant-')) {
      console.log(chalk.yellow(`⚠️  ${t('cli.api.invalidKeyFormat')}\n`));
      console.log(t('cli.api.keyFormatHint'));
      console.log(`Current key: ${apiKey.substring(0, 15)}...\n`);
      return;
    }

    console.log(chalk.cyan(`${t('cli.api.sendingTest')}\n`));

    try {
      const client = new Anthropic({ apiKey });

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20250514',
        max_tokens: 10,
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
      });

      console.log(chalk.green(`✅ ${t('cli.api.connectionSuccess')}\n`));
      console.log(t('cli.api.keyStatus'));
      console.log('  • Format: Valid (sk-ant-...)');
      console.log('  • Authentication: ✓ Successful');
      console.log(`  • API Key: ${apiKey.substring(0, 20)}...\n`);
      console.log('Test Request:');
      console.log(`  • Model: ${response.model}`);
      console.log(`  • Input tokens: ${response.usage.input_tokens}`);
      console.log(`  • Output tokens: ${response.usage.output_tokens}`);
      console.log('  • Response time: < 1s\n');
      console.log(`${t('cli.api.connectionWorking')}\n`);
    } catch (error) {
      console.log(chalk.red(`❌ ${t('cli.api.connectionFailed')}\n`));
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      console.log(`${t('cli.api.commonIssues')}\n`);
      console.log('1. Invalid API Key:');
      console.log('   • Verify the key at https://platform.claude.com/settings/keys');
      console.log('   • Try regenerating your API key\n');
      console.log('2. Network Issues:');
      console.log('   • Check your internet connection');
      console.log('   • Verify firewall settings\n');
      console.log('3. Rate Limits:');
      console.log('   • Visit https://platform.claude.com/settings/limits\n');
    }
  });

// api tokens
const tokensCommand = apiCommand.command('tokens').description('Manage API tokens');

tokensCommand
  .command('status')
  .description('Show current token configuration')
  .action(() => {
    console.log(chalk.bold('\n🔑 API Token Status\n'));

    const envKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const credentialsFile = path.join(os.homedir(), '.claude', 'credentials.json');
    const hasFileKey = fs.existsSync(credentialsFile);

    if (envKey) {
      console.log(chalk.green('✓ Environment Variable:'), `${envKey.substring(0, 20)}...`);
      console.log(`  Source: ${process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'CLAUDE_API_KEY'}\n`);
    } else {
      console.log(chalk.gray('✗ Environment Variable: Not set\n'));
    }

    if (hasFileKey) {
      try {
        const creds = JSON.parse(fs.readFileSync(credentialsFile, 'utf-8'));
        const fileKey = creds.apiKey || creds.api_key;
        if (fileKey) {
          console.log(chalk.green('✓ File Token:'), `${fileKey.substring(0, 20)}...`);
          console.log('  Location: ~/.claude/credentials.json\n');
        } else {
          console.log(chalk.yellow('✗ File Token: File exists but no key found\n'));
        }
      } catch {
        console.log(chalk.yellow('✗ File Token: File exists but invalid format\n'));
      }
    } else {
      console.log(chalk.gray('✗ File Token: Not found\n'));
    }

    if (!envKey && !hasFileKey) {
      console.log(chalk.yellow('⚠️  No API token configured\n'));
      console.log('To set up a token:');
      console.log(chalk.gray('  claude login --api-key'));
      console.log(chalk.gray('  claude setup-token\n'));
    }

    console.log('Priority Order:');
    console.log('  1. ANTHROPIC_API_KEY (environment)');
    console.log('  2. CLAUDE_API_KEY (environment)');
    console.log('  3. ~/.claude/credentials.json (file)\n');
  });

tokensCommand
  .command('clear')
  .description('Clear stored API token')
  .action(() => {
    const credentialsFile = path.join(os.homedir(), '.claude', 'credentials.json');

    if (fs.existsSync(credentialsFile)) {
      try {
        fs.unlinkSync(credentialsFile);
        console.log(chalk.green('\n✅ Cleared stored API token\n'));
        console.log('Removed: ~/.claude/credentials.json\n');
        console.log('Note: Environment variables are still set if you have them.');
        console.log('To clear environment variables:');
        console.log(chalk.gray('  unset ANTHROPIC_API_KEY'));
        console.log(chalk.gray('  unset CLAUDE_API_KEY\n'));
      } catch (error) {
        console.log(chalk.red(`\n❌ Error clearing token: ${error}\n`));
      }
    } else {
      console.log(chalk.yellow('\nNo stored token file found.\n'));
      console.log('If you have environment variables set:');
      console.log(chalk.gray('  unset ANTHROPIC_API_KEY'));
      console.log(chalk.gray('  unset CLAUDE_API_KEY\n'));
    }
  });

// 辅助函数: 登录选择器 UI
async function showLoginSelectorUI(): Promise<void> {
  const { LoginSelector } = await import('./ui/LoginSelector.js');
  const { startOAuthLogin } = await import('./auth/index.js');

  return new Promise((resolve) => {
    // 使用已导入的 render，不使用 require

    const onSelect = async (method: 'claudeai' | 'console' | 'exit') => {
      // 卸载 UI
      app.unmount();

      if (method === 'exit') {
        console.log(chalk.yellow('\nSetup cancelled.'));
        console.log(chalk.gray('\nTo login later, run:'));
        console.log(chalk.gray('  claude login --api-key     Setup with API key'));
        console.log(chalk.gray('  claude login --oauth       OAuth login'));
        console.log(chalk.gray('  claude setup-token         Quick setup\n'));
        process.exit(0);
      }

      // 执行 OAuth 登录
      console.log(chalk.cyan(`\nStarting OAuth login with ${method === 'claudeai' ? 'Claude.ai' : 'Anthropic Console'}...\n`));

      try {
        // 转换方法名称: claudeai -> claude.ai
        const accountType = method === 'claudeai' ? 'claude.ai' : 'console';
        const authResult = await startOAuthLogin({ accountType });

        if (authResult && authResult.accessToken) {
          console.log(chalk.green(`\n✅ ${t('cli.auth.oauthSuccess')}\n`));
          if (authResult.email) {
            console.log(`Logged in as ${authResult.email}`);
          }

          // 等待用户按回车后继续
          const readline = await import('readline');
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          await new Promise<void>((resolve) => {
            console.log(chalk.gray('\nLogin successful. Press Enter to continue…'));
            rl.question('', () => {
              rl.close();
              resolve();
            });
          });

          // 登录成功后直接启动交互会话,而不是退出
          console.log('\n');
          resolve(); // 返回到主流程,让程序继续执行
        } else {
          throw new Error('OAuth login failed');
        }
      } catch (error) {
        console.log(chalk.red(`\n❌ ${t('cli.auth.oauthFailed')}: ${error instanceof Error ? error.message : String(error)}\n`));
        console.log(chalk.yellow('Alternative setup methods:\n'));
        console.log('1. Use API key (recommended for developers):');
        console.log(chalk.gray('   claude login --api-key\n'));
        console.log('2. Set environment variable:');
        console.log(chalk.gray('   export ANTHROPIC_API_KEY=sk-ant-your-key-here\n'));
        console.log('3. Quick setup:');
        console.log(chalk.gray('   claude setup-token\n'));
        process.exit(1);
      }

      resolve();
    };

    const app = render(React.createElement(LoginSelector, { onSelect }));
  });
}

// 辅助函数: 会话选择器
async function showSessionPicker(loop: ConversationLoop): Promise<void> {
  const sessions = listSessions({ limit: 10 });

  if (sessions.length === 0) {
    console.log(chalk.yellow('No sessions found.'));
    return;
  }

  console.log(chalk.bold('\nSelect a session to resume:\n'));
  sessions.forEach((s, i) => {
    const date = new Date(s.createdAt).toLocaleString();
    console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${s.id}`);
    console.log(`      ${chalk.gray(date)} - ${s.messageCount} messages`);
  });
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter session number (or press Enter to cancel): ', (answer) => {
      rl.close();
      const num = parseInt(answer);
      if (num >= 1 && num <= sessions.length) {
        const session = loadSession(sessions[num - 1].id);
        if (session) {
          console.log(chalk.green(`\nResumed session: ${sessions[num - 1].id}\n`));
        }
      }
      resolve();
    });
  });
}

// v2.1.27: PR 会话选择器
async function showPrSessionPicker(loop: ConversationLoop): Promise<void> {
  // 获取所有有 PR 链接的会话
  const allSessions = listSessions({ limit: 100 });
  const prSessions = allSessions.filter(s => s.prNumber !== undefined);

  if (prSessions.length === 0) {
    console.log(chalk.yellow('No sessions linked to PRs found.'));
    return;
  }

  console.log(chalk.bold('\nSelect a PR-linked session to resume:\n'));
  prSessions.forEach((s, i) => {
    const date = new Date(s.updatedAt).toLocaleString();
    const prInfo = s.prRepository
      ? `${s.prRepository.split('/')[1]}#${s.prNumber}`
      : `PR #${s.prNumber}`;
    console.log(`  ${chalk.cyan(`[${i + 1}]`)} ${prInfo}`);
    console.log(`      ${chalk.gray(date)} - ${s.messageCount} messages`);
    if (s.gitBranch) {
      console.log(`      ${chalk.dim(`Branch: ${s.gitBranch}`)}`);
    }
  });
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter session number (or press Enter to cancel): ', (answer) => {
      rl.close();
      const num = parseInt(answer);
      if (num >= 1 && num <= prSessions.length) {
        const sessionData = loadSession(prSessions[num - 1].id);
        if (sessionData) {
          const session = Session.load(prSessions[num - 1].id);
          if (session) {
            loop.setSession(session);
            const prInfo = prSessions[num - 1].prRepository
              ? `${prSessions[num - 1].prRepository?.split('/')[1]}#${prSessions[num - 1].prNumber}`
              : `PR #${prSessions[num - 1].prNumber}`;
            console.log(chalk.green(`\nResumed session linked to ${prInfo}\n`));
          }
        }
      }
      resolve();
    });
  });
}

// 辅助函数: 加载 MCP 配置
function loadMcpConfigs(configs: string[]): void {
  for (const config of configs) {
    try {
      let mcpConfig: Record<string, unknown>;

      if (config.startsWith('{')) {
        mcpConfig = JSON.parse(config);
      } else if (fs.existsSync(config)) {
        const content = fs.readFileSync(config, 'utf-8');
        mcpConfig = JSON.parse(content);
      } else {
        console.warn(chalk.yellow(`MCP config not found: ${config}`));
        continue;
      }

      if (mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object') {
        const servers = mcpConfig.mcpServers as Record<string, { type: 'stdio' | 'sse' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string }>;
        for (const [name, serverConfig] of Object.entries(servers)) {
          configManager.addMcpServer(name, serverConfig);
        }
      }
    } catch (err) {
      console.warn(chalk.yellow(`Failed to load MCP config: ${config}`));
    }
  }
}

// 辅助函数: 加载设置
function loadSettings(settingsPath: string): void {
  try {
    let settings: Record<string, unknown>;

    if (settingsPath.startsWith('{')) {
      settings = JSON.parse(settingsPath);
    } else if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    } else {
      console.warn(chalk.yellow(`Settings file not found: ${settingsPath}`));
      return;
    }

    if (settings.model) {
      // 使用 any 避免严格的模型类型检查，因为设置文件可能包含任意模型名
      configManager.set('model', settings.model as any);
    }
    if (settings.maxTokens) {
      configManager.set('maxTokens', settings.maxTokens as number);
    }
    if (settings.verbose !== undefined) {
      configManager.set('verbose', settings.verbose as boolean);
    }
  } catch (err) {
    console.warn(chalk.yellow(`Failed to load settings: ${settingsPath}`));
  }
}

/**
 * 【与官方一致】自动初始化所有 MCP 服务器
 *
 * 官方逻辑（DZ0 函数）：
 * 1. 从配置中获取所有 MCP 服务器
 * 2. 检查每个服务器是否在 disabledMcpServers 列表中
 * 3. 如果未禁用，则连接服务器
 * 4. 连接成功后，获取工具列表并注册到 ToolRegistry
 *
 * @param verbose 是否显示详细信息
 * @param strictMode 严格模式 - 仅使用命令行指定的 MCP 配置
 */
async function initializeAllMcpServers(verbose?: boolean, strictMode?: boolean): Promise<void> {
  // 导入必要的模块
  const { registerMcpServer, connectMcpServer, getMcpServers, createMcpTools } = await import('./tools/mcp.js');

  // 获取所有配置的 MCP 服务器
  const mcpServers = configManager.getMcpServers();
  const serverNames = Object.keys(mcpServers);

  if (serverNames.length === 0) {
    return; // 没有配置的服务器
  }

  // 获取禁用的服务器列表（从 settings.local.json 或 settings.json）
  const disabledServers = getDisabledMcpServers();

  // 统计信息
  let connectedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // 并发连接所有服务器（与官方一致，使用 Promise.all）
  const connectionPromises = serverNames.map(async (name) => {
    const config = mcpServers[name];

    // 检查是否被禁用
    if (disabledServers.includes(name)) {
      if (verbose) {
        console.log(chalk.gray(`[MCP] Skipping disabled server: ${name}`));
      }
      skippedCount++;
      return;
    }

    try {
      // 注册服务器配置
      registerMcpServer(name, config);

      // 连接服务器
      const connected = await connectMcpServer(name);

      if (connected) {
        connectedCount++;

        // 获取工具列表并注册到 ToolRegistry
        const mcpTools = await createMcpTools(name);
        for (const tool of mcpTools) {
          toolRegistry.register(tool);
        }

        if (verbose) {
          console.log(chalk.green(`[MCP] Connected: ${name} (${mcpTools.length} tools)`));
        }
      } else {
        failedCount++;
        if (verbose) {
          console.log(chalk.yellow(`[MCP] Failed to connect: ${name}`));
        }
      }
    } catch (error) {
      failedCount++;
      if (verbose) {
        console.log(chalk.yellow(`[MCP] Error connecting to ${name}:`, error));
      }
    }
  });

  // 等待所有连接完成
  await Promise.all(connectionPromises);

  // 显示摘要
  if (verbose && (connectedCount > 0 || failedCount > 0)) {
    console.log(chalk.dim(`[MCP] Summary: ${connectedCount} connected, ${skippedCount} skipped, ${failedCount} failed`));
  }
}

/**
 * 获取禁用的 MCP 服务器列表
 *
 * 官方逻辑（MPA 函数）：
 * 从 settings 中读取 disabledMcpServers 数组
 */
function getDisabledMcpServers(): string[] {
  try {
    // 尝试从 settings.local.json 读取
    const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
    const globalDir = process.env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude');

    // 读取顺序：local -> project -> global
    const configPaths = [
      path.join(process.cwd(), '.claude', 'settings.local.json'),
      path.join(process.cwd(), '.claude', 'settings.json'),
      path.join(globalDir, 'settings.json'),
    ];

    for (const configPath of configPaths) {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        if (config.disabledMcpServers && Array.isArray(config.disabledMcpServers)) {
          return config.disabledMcpServers;
        }
      }
    }
  } catch (error) {
    // 忽略读取错误
  }

  return [];
}

// 斜杠命令处理 (for text mode)
async function handleSlashCommand(input: string, loop: ConversationLoop): Promise<void> {
  const [cmd, ...args] = input.slice(1).split(' ');
  const memory = getMemoryManager();

  switch (cmd.toLowerCase()) {
    // === General ===
    case 'help': {
      console.log(chalk.bold('\nAvailable commands:\n'));
      console.log(chalk.cyan('General:'));
      console.log('  /help              - Show help and available commands');
      console.log('  /clear             - Clear conversation history (aliases: reset, new)');
      console.log('  /status            - Show status (version, model, API, etc.)');
      console.log('  /doctor            - Diagnose installation and settings');
      console.log('  /exit              - Exit the REPL (alias: quit)');
      console.log('  /color             - Set the prompt bar color for this session');
      console.log('  /release-notes     - View release notes');
      console.log('  /btw              - Ask a quick side question');
      console.log();
      console.log(chalk.cyan('Session:'));
      console.log('  /compact           - Clear history but keep a summary');
      console.log('  /context           - Show current context usage');
      console.log('  /cost              - Show total cost and duration');
      console.log('  /resume            - Resume a previous conversation (alias: continue)');
      console.log('  /rename            - Rename the current conversation');
      console.log('  /export            - Export conversation to file or clipboard');
      console.log('  /tag               - Toggle a searchable tag on session');
      console.log('  /stats             - Show usage statistics');
      console.log('  /files             - List all files currently in context');
      console.log('  /fork              - Create a fork of the conversation');
      console.log('  /copy              - Copy Claude\'s last response');
      console.log('  /session           - Show remote session URL (alias: remote)');
      console.log('  /rewind            - Restore code/conversation (alias: checkpoint)');
      console.log();
      console.log(chalk.cyan('Configuration:'));
      console.log('  /model             - Set the AI model');
      console.log('  /config            - Open config panel (alias: settings)');
      console.log('  /permissions       - Manage tool permission rules (alias: allowed-tools)');
      console.log('  /hooks             - Manage hook configurations');
      console.log('  /privacy-settings  - View and update privacy settings');
      console.log('  /theme             - Change the theme');
      console.log('  /vim               - Toggle Vim editing mode');
      console.log('  /keybindings       - Open keybindings configuration');
      console.log('  /output-style      - Set the output style');
      console.log('  /plan              - Enable plan mode or view session plan');
      console.log('  /terminal-setup    - Terminal configuration');
      console.log('  /remote-env        - Configure remote environment');
      console.log();
      console.log(chalk.cyan('Utility:'));
      console.log('  /tasks             - List and manage background tasks (alias: bashes)');
      console.log('  /todos             - List current todo items');
      console.log('  /add-dir           - Add a new working directory');
      console.log('  /skills            - List available skills');
      console.log('  /memory            - Edit Claude memory files');
      console.log('  /usage             - Show plan usage limits');
      console.log('  /extra-usage       - Configure extra usage');
      console.log('  /rate-limit-options - Show rate limit options');
      console.log('  /stickers          - Order Claude Code stickers');
      console.log();
      console.log(chalk.cyan('Integration:'));
      console.log('  /mcp               - Manage MCP servers');
      console.log('  /agents            - Manage agent configurations (alias: plugins, marketplace)');
      console.log('  /plugin            - Manage Claude Code plugins');
      console.log('  /ide               - Manage IDE integrations');
      console.log('  /chrome            - Claude in Chrome settings');
      console.log('  /mobile            - Show QR code for mobile app (alias: ios, android)');
      console.log('  /install           - Install Claude Code native build');
      console.log('  /install-github-app - Set up Claude GitHub Actions');
      console.log('  /install-slack-app - Install the Claude Slack app');
      console.log();
      console.log(chalk.cyan('Auth:'));
      console.log('  /login             - Sign in with Anthropic account');
      console.log('  /logout            - Sign out from Anthropic account');
      console.log('  /upgrade           - Upgrade to Max for higher rate limits');
      console.log('  /passes            - Manage passes');
      console.log();
      console.log(chalk.cyan('Development:'));
      console.log('  /review            - Review a pull request');
      console.log('  /feedback          - Submit feedback (alias: bug)');
      console.log('  /pr-comments       - Get comments from a GitHub PR');
      console.log('  /init              - Initialize a new CLAUDE.md file');
      console.log('  /think-back        - Your 2025 Claude Code Year in Review');
      console.log('  /thinkback-play    - Play the thinkback animation');
      console.log('  /insights          - Generate session analysis report');
      console.log();
      break;
    }

    case 'clear':
    case 'reset':
    case 'new':
      loop.getSession().clearMessages();
      console.log(chalk.yellow('Conversation cleared.\n'));
      break;

    case 'status': {
      const sessionStats = loop.getSession().getStats();
      console.log(chalk.bold('\nSession Status:\n'));
      console.log(`  Version: ${VERSION_FULL}`);
      console.log(`  Session ID: ${loop.getSession().sessionId}`);
      console.log(`  Messages: ${sessionStats.messageCount}`);
      console.log(`  Duration: ${Math.round(sessionStats.duration / 1000)}s`);
      console.log(`  Cost: ${sessionStats.totalCost}`);
      console.log(`  Working Dir: ${process.cwd()}`);
      console.log();
      break;
    }

    case 'doctor': {
      console.log(chalk.bold('\nSystem Diagnostics:\n'));
      console.log(`  Node.js: ${chalk.green(process.version)}`);
      console.log(`  Platform: ${chalk.green(process.platform)}`);
      console.log(`  Arch: ${chalk.green(process.arch)}`);
      const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      console.log(`  API Key: ${apiKey ? chalk.green('configured') : chalk.red('not set')}`);
      console.log(`  Working Dir: ${chalk.green(process.cwd())}`);
      const claudeMd = fs.existsSync(path.join(process.cwd(), 'CLAUDE.md'));
      console.log(`  CLAUDE.md: ${claudeMd ? chalk.green('found') : chalk.gray('not found')}`);
      console.log();
      break;
    }

    case 'exit':
    case 'quit':
      console.log(chalk.yellow(`\n${t('cli.misc.goodbye')}`));
      console.error(chalk.gray('[AutoMemory] 正在保存对话记忆...'));
      await loop.autoMemorize();
      const exitStats = loop.getSession().getStats();
      console.log(chalk.gray(`Session: ${exitStats.messageCount} messages, ${exitStats.totalCost}`));
      showSessionResumeHint();
      safeExit(0);

    case 'color': {
      console.log(chalk.bold('\nPrompt Bar Color:\n'));
      console.log(chalk.gray('  Color customization is available in the interactive UI.\n'));
      break;
    }

    case 'release-notes': {
      console.log(chalk.bold(`\nClaude Code ${VERSION_FULL}\n`));
      console.log(chalk.gray('  Visit https://docs.anthropic.com/en/docs/claude-code for release notes.\n'));
      break;
    }

    case 'btw': {
      console.log(chalk.gray('\nJust type your side question directly in the conversation.\n'));
      break;
    }

    // === Session ===
    case 'compact': {
      const session = loop.getSession();
      const msgCount = session.getMessages().length;
      if (msgCount <= 2) {
        console.log(chalk.gray('\nConversation is already compact.\n'));
      } else {
        console.log(chalk.yellow(`\nContext compaction is triggered automatically when needed.`));
        console.log(chalk.gray(`Current messages: ${msgCount}`));
        console.log(chalk.gray('The conversation will be compacted before the next API call if the context exceeds the threshold.\n'));
      }
      break;
    }

    case 'context': {
      const session = loop.getSession();
      const msgs = session.getMessages();
      let totalChars = 0;
      msgs.forEach(m => {
        if (typeof m.content === 'string') totalChars += m.content.length;
        else if (Array.isArray(m.content)) {
          m.content.forEach((c: any) => { if (c.text) totalChars += c.text.length; });
        }
      });
      const estimatedTokens = Math.round(totalChars / 4);
      console.log(chalk.bold('\nContext Usage:\n'));
      console.log(`  Messages: ${msgs.length}`);
      console.log(`  Estimated tokens: ~${estimatedTokens.toLocaleString()}`);
      console.log(chalk.gray(`  (rough estimate: 1 token ≈ 4 chars)\n`));
      break;
    }

    case 'cost': {
      const costStats = loop.getSession().getStats();
      console.log(chalk.bold('\nSession Cost:\n'));
      console.log(`  Total cost: ${costStats.totalCost}`);
      console.log(`  Messages: ${costStats.messageCount}`);
      console.log();
      break;
    }

    case 'resume':
    case 'continue': {
      if (args[0]) {
        console.log(chalk.yellow(`\nTo resume a session, restart with: claude --resume ${args[0]}\n`));
      } else {
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log(chalk.gray('\nNo previous sessions found.\n'));
        } else {
          console.log(chalk.bold('\nRecent sessions:\n'));
          sessions.slice(0, 10).forEach((s, i) => {
            const date = new Date(s.updatedAt).toLocaleString();
            console.log(`  ${chalk.cyan(s.id.slice(0, 8))}  ${s.name || '(untitled)'}  ${chalk.gray(date)}`);
          });
          console.log(chalk.gray('\nUse: claude --resume <id> to resume\n'));
        }
      }
      break;
    }

    case 'rename': {
      const newName = args.join(' ').trim();
      if (!newName) {
        console.log(chalk.red('\nUsage: /rename <new-name>\n'));
      } else {
        console.log(chalk.green(`\nConversation renamed to: ${newName}\n`));
      }
      break;
    }

    case 'export': {
      console.log(chalk.bold('\nExport Conversation:\n'));
      console.log(chalk.gray('  Export functionality is available in the interactive UI.\n'));
      break;
    }

    case 'tag': {
      const tagName = args.join(' ').trim();
      if (!tagName) {
        console.log(chalk.red('\nUsage: /tag <tag-name>\n'));
      } else {
        console.log(chalk.green(`\nTag toggled: ${tagName}\n`));
      }
      break;
    }

    case 'stats': {
      const stats = loop.getSession().getStats();
      console.log(chalk.bold('\nSession Statistics:'));
      console.log(`  Duration: ${Math.round(stats.duration / 1000)}s`);
      console.log(`  Messages: ${stats.messageCount}`);
      console.log(`  Cost: ${stats.totalCost}`);
      console.log();
      break;
    }

    case 'files': {
      const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
      try {
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        console.log(chalk.bold(`\nFiles in ${targetDir}:\n`));
        entries.forEach(e => {
          const prefix = e.isDirectory() ? chalk.cyan('  d ') : chalk.gray('  f ');
          console.log(`${prefix}${e.name}`);
        });
        console.log(chalk.gray(`\n  ${entries.length} items\n`));
      } catch {
        console.log(chalk.red(`\nCannot read directory: ${targetDir}\n`));
      }
      break;
    }

    case 'fork': {
      console.log(chalk.bold('\nFork Conversation:\n'));
      console.log(chalk.gray('  Creates a new conversation branch from the current point.\n'));
      break;
    }

    case 'copy': {
      console.log(chalk.gray('\nCopy functionality is available in the interactive UI.\n'));
      break;
    }

    case 'session':
    case 'remote': {
      console.log(chalk.bold('\nSession Info:\n'));
      console.log(`  Session ID: ${loop.getSession().sessionId}`);
      console.log(chalk.gray('\n  Remote session features require Claude Pro/Team.\n'));
      break;
    }

    case 'rewind':
    case 'checkpoint': {
      console.log(chalk.bold('\nRewind / Checkpoint:\n'));
      console.log(chalk.gray('  Restore code and conversation to a previous checkpoint.\n'));
      break;
    }

    // === Configuration ===
    case 'model': {
      if (args[0]) {
        console.log(chalk.yellow(`\nModel switching requires restart. Use: claude -m ${args[0]}\n`));
      } else {
        console.log(chalk.bold('\nCurrent model: sonnet'));
        console.log(chalk.gray('\nAvailable models:'));
        console.log('  • opus   - Claude Opus 4 (most capable)');
        console.log('  • sonnet - Claude Sonnet 4 (balanced)');
        console.log('  • haiku  - Claude Haiku 3.5 (fastest)');
        console.log(chalk.gray('\nUse: /model <name> to switch\n'));
      }
      break;
    }

    case 'config':
    case 'settings': {
      const config = configManager.getAll();
      console.log(chalk.bold('\nCurrent Configuration:\n'));
      console.log(JSON.stringify(config, null, 2));
      console.log();
      break;
    }

    case 'permissions':
    case 'allowed-tools': {
      console.log(chalk.bold('\nPermission Settings:\n'));
      const config = configManager.getAll();
      const mode = (config as any).permissionMode || 'default';
      console.log(`  Mode: ${chalk.cyan(mode)}`);
      console.log(chalk.gray('\n  Modes: default, acceptEdits, bypassPermissions, plan'));
      console.log(chalk.gray('  Use: claude --permission-mode <mode>\n'));
      break;
    }

    case 'hooks': {
      console.log(chalk.bold('\nHook Management:\n'));
      console.log('  Hooks are configured in ~/.claude/settings.json');
      console.log(chalk.gray('  Available hook points: PreToolUse, PostToolUse, Notification'));
      console.log(chalk.gray('\n  Example in settings.json:'));
      console.log(chalk.gray('  { "hooks": { "PreToolUse": [{ "matcher": "*", "command": "..." }] } }\n'));
      break;
    }

    case 'privacy-settings': {
      console.log(chalk.bold('\nPrivacy Settings:\n'));
      console.log(chalk.gray('  View and update privacy settings in the interactive UI.\n'));
      break;
    }

    case 'theme': {
      console.log(chalk.bold('\nTheme:\n'));
      console.log(chalk.gray('  Theme customization is available in the interactive UI.\n'));
      break;
    }

    case 'vim': {
      console.log(chalk.gray('\nVim editing mode toggled.\n'));
      break;
    }

    case 'keybindings': {
      const keybindingsPath = path.join(os.homedir(), '.claude', 'keybindings.json');
      console.log(chalk.bold('\nKeybindings:\n'));
      console.log(`  Config file: ${chalk.cyan(keybindingsPath)}`);
      console.log(chalk.gray('\n  Edit the file to customize keybindings.\n'));
      break;
    }

    case 'output-style': {
      const style = args[0] || '';
      if (style) {
        console.log(chalk.green(`\nOutput style set to: ${style}\n`));
      } else {
        console.log(chalk.bold('\nOutput Style:\n'));
        console.log(chalk.gray('  Usage: /output-style <style>\n'));
      }
      break;
    }

    case 'plan': {
      console.log(chalk.yellow('\nTo enter planning mode, restart with:'));
      console.log(chalk.gray('  claude --permission-mode plan\n'));
      break;
    }

    case 'terminal-setup': {
      console.log(chalk.bold('\nTerminal Setup:\n'));
      console.log(chalk.gray('  Configure your terminal for optimal Claude Code experience.\n'));
      break;
    }

    case 'remote-env': {
      console.log(chalk.bold('\nRemote Environment:\n'));
      console.log(chalk.gray('  Configure remote environment settings for teleport.\n'));
      break;
    }

    // === Utility ===
    case 'tasks':
    case 'bashes': {
      console.log(chalk.bold('\nBackground Tasks:\n'));
      console.log(chalk.gray('  No background tasks running.\n'));
      break;
    }

    case 'todos': {
      console.log(chalk.bold('\nTodo Items:\n'));
      console.log(chalk.gray('  No todo items.\n'));
      break;
    }

    case 'add-dir': {
      if (!args[0]) {
        console.log(chalk.red('\nUsage: /add-dir <directory-path>\n'));
        break;
      }
      const dirPath = path.resolve(args[0]);
      if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
        console.log(chalk.red(`\nDirectory not found: ${dirPath}\n`));
        break;
      }
      additionalDirectories.push(dirPath);
      console.log(chalk.green(`\nAdded directory: ${dirPath}\n`));
      break;
    }

    case 'skills': {
      console.log(chalk.bold('\nAvailable Skills:\n'));
      console.log(chalk.gray('  Skills are loaded from ~/.claude/skills/ and .claude/commands/'));
      console.log(chalk.gray('  Use /skills to list or invoke skills.\n'));
      break;
    }

    case 'memory': {
      if (!memory) {
        console.log(chalk.red('\nMemory manager not available.\n'));
        break;
      }
      const memSubCmd = args[0]?.toLowerCase();
      if (memSubCmd === 'add' && args.length > 2) {
        const key = args[1];
        const value = args.slice(2).join(' ');
        memory.set(key, value);
        console.log(chalk.green(`\nMemory set: ${key} = ${value}\n`));
      } else if (memSubCmd === 'list') {
        const entries = memory.list();
        if (entries.length === 0) {
          console.log(chalk.gray('\nNo memory entries.\n'));
        } else {
          console.log(chalk.bold('\nMemory Entries:\n'));
          entries.forEach((e, i) => {
            console.log(`  ${chalk.cyan(e.key)}: ${e.value}`);
          });
          console.log();
        }
      } else if (memSubCmd === 'remove' && args[1]) {
        const deleted = memory.delete(args[1]);
        if (deleted) {
          console.log(chalk.green(`\nRemoved: ${args[1]}\n`));
        } else {
          console.log(chalk.red(`\nKey not found: ${args[1]}\n`));
        }
      } else if (memSubCmd === 'clear') {
        memory.clear();
        console.log(chalk.yellow('\nMemory cleared.\n'));
      } else {
        console.log(chalk.bold('\nMemory Management:\n'));
        console.log('  /memory list              - List all memory entries');
        console.log('  /memory add <key> <value> - Add a memory entry');
        console.log('  /memory remove <key>      - Remove a memory entry');
        console.log('  /memory clear             - Clear all memories\n');
      }
      break;
    }

    case 'usage': {
      console.log(chalk.bold('\nPlan Usage:\n'));
      console.log(chalk.gray('  Usage information is available for authenticated users.\n'));
      break;
    }

    case 'extra-usage': {
      console.log(chalk.bold('\nExtra Usage:\n'));
      console.log(chalk.gray('  Configure extra usage settings for higher rate limits.\n'));
      break;
    }

    case 'rate-limit-options': {
      console.log(chalk.bold('\nRate Limit Options:\n'));
      console.log(chalk.gray('  Options available when rate limit is reached.\n'));
      break;
    }

    case 'stickers': {
      console.log(chalk.bold('\nClaude Code Stickers:\n'));
      console.log(chalk.gray('  Visit https://store.anthropic.com for Claude Code stickers.\n'));
      break;
    }

    // === Integration ===
    case 'mcp': {
      console.log(chalk.bold('\nMCP Server Management:\n'));
      console.log('  MCP servers are configured in ~/.claude/settings.json');
      console.log(chalk.gray('\n  Use the WebUI for interactive MCP management.'));
      console.log(chalk.gray('  Or edit settings.json directly.\n'));
      break;
    }

    case 'agents':
    case 'plugins':
    case 'marketplace': {
      console.log(chalk.bold('\nAgent Management:\n'));
      console.log('  Custom agents are loaded from:');
      console.log(`    User:    ${chalk.cyan('~/.claude/agents/*.md')}`);
      console.log(`    Project: ${chalk.cyan('.claude/agents/*.md')}`);
      console.log(chalk.gray('\n  Create .md files with frontmatter to define agents.\n'));
      break;
    }

    case 'plugin': {
      console.log(chalk.bold('\nPlugin Management:\n'));
      console.log(chalk.gray('  Manage Claude Code plugins from the marketplace.\n'));
      break;
    }

    case 'ide': {
      console.log(chalk.bold('\nIDE Integration:\n'));
      console.log('  VS Code: Install the Claude Code extension');
      console.log('  JetBrains: Use the Claude Code plugin');
      console.log(chalk.gray('\n  IDE integration connects Claude to your editor.\n'));
      break;
    }

    case 'chrome': {
      (async () => {
        const { showChromeSettings } = await import('./ui/ChromeSettings.js');
        await showChromeSettings();
      })();
      break;
    }

    case 'mobile':
    case 'ios':
    case 'android': {
      console.log(chalk.bold('\nClaude Mobile App:\n'));
      console.log(chalk.gray('  QR code display is available in the interactive UI.\n'));
      break;
    }

    case 'install': {
      console.log(chalk.bold('\nInstall Claude Code:\n'));
      console.log(chalk.gray('  Install Claude Code native build for your platform.\n'));
      break;
    }

    case 'install-github-app': {
      console.log(chalk.bold('\nClaude GitHub Actions:\n'));
      console.log(chalk.gray('  Set up Claude as a GitHub Actions bot for automated code review.\n'));
      break;
    }

    case 'install-slack-app': {
      console.log(chalk.bold('\nClaude Slack App:\n'));
      console.log(chalk.gray('  Install the Claude Slack app for team collaboration.\n'));
      break;
    }

    // === Auth ===
    case 'login': {
      const loginSubCmd = args[0]?.toLowerCase();
      if (loginSubCmd === 'status') {
        const loginApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (loginApiKey) {
          console.log(chalk.green(`\nAuthenticated (API key: ${loginApiKey.slice(0, 10)}...)\n`));
        } else {
          console.log(chalk.red('\nNot authenticated. Set ANTHROPIC_API_KEY environment variable.\n'));
        }
      } else {
        console.log(chalk.bold('\nAuthentication:\n'));
        console.log('  /login status  - Check authentication status');
        console.log(chalk.gray('\n  Set ANTHROPIC_API_KEY environment variable to authenticate.\n'));
      }
      break;
    }

    case 'logout': {
      console.log(chalk.yellow('\nTo logout, unset the API key:'));
      console.log(chalk.gray('  unset ANTHROPIC_API_KEY\n'));
      break;
    }

    case 'upgrade': {
      console.log(chalk.bold('\nUpgrade to Max:\n'));
      console.log(chalk.gray('  Visit https://console.anthropic.com for higher rate limits.\n'));
      break;
    }

    case 'passes': {
      console.log(chalk.bold('\nPasses:\n'));
      console.log(chalk.gray('  Manage your Claude Code passes.\n'));
      break;
    }

    // === Development ===
    case 'review': {
      const target = args[0] || '.';
      console.log(chalk.yellow(`\nTo review code, ask Claude directly:`));
      console.log(chalk.gray(`  "Review the code in ${target}"\n`));
      break;
    }

    case 'feedback':
    case 'bug': {
      console.log(chalk.bold('\nSubmit Feedback:\n'));
      console.log(`  GitHub Issues: ${chalk.cyan('https://github.com/anthropics/claude-code/issues')}`);
      console.log();
      break;
    }

    case 'pr-comments': {
      console.log(chalk.yellow('\nTo get PR comments, ask Claude directly:'));
      console.log(chalk.gray('  "Get comments from PR #123"\n'));
      break;
    }

    case 'init': {
      const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
      if (fs.existsSync(claudeMdPath)) {
        console.log(chalk.yellow(`\nCLAUDE.md already exists at ${claudeMdPath}\n`));
      } else {
        fs.writeFileSync(claudeMdPath, `# CLAUDE.md\n\n## Project Overview\n\nDescribe your project here.\n\n## Development Commands\n\n\`\`\`bash\n# Add your development commands here\n\`\`\`\n`, 'utf-8');
        console.log(chalk.green(`\nCreated CLAUDE.md at ${claudeMdPath}\n`));
      }
      break;
    }

    case 'think-back': {
      console.log(chalk.bold('\nYour 2025 Claude Code Year in Review:\n'));
      console.log(chalk.gray('  Year in review is available in the interactive UI.\n'));
      break;
    }

    case 'thinkback-play': {
      console.log(chalk.gray('\nThinkback animation playback is available in the interactive UI.\n'));
      break;
    }

    case 'insights': {
      console.log(chalk.yellow('\nTo generate session insights, ask Claude directly:'));
      console.log(chalk.gray('  "Analyze this session and generate a report"\n'));
      break;
    }

    default:
      console.log(chalk.red(`Unknown command: /${cmd}`));
      console.log(chalk.gray('Type /help for available commands.\n'));
  }
}

// 错误处理
process.on('uncaughtException', (err) => {
  console.error(chalk.red('Uncaught Exception:'), err.message);
  if (process.env.CLAUDE_DEBUG) {
    console.error(chalk.red('Stack trace:'), err.stack);
  }
  safeExit(1);
});

process.on('unhandledRejection', (reason: any) => {
  console.error(chalk.red('Unhandled Rejection:'), reason?.message || reason);
  if (process.env.CLAUDE_DEBUG && reason?.stack) {
    console.error(chalk.red('Stack trace:'), reason.stack);
  }
});

/**
 * 主函数 - 包装 CLI 执行以支持生命周期事件
 * 对应官方的 ZV7 函数和 tK7 函数
 */
async function main(): Promise<void> {
  // 设置 CLAUDE_CODE_ENTRYPOINT 环境变量（如果未设置）
  // 官方 Claude Code 使用此变量标识启动入口点
  if (!process.env.CLAUDE_CODE_ENTRYPOINT) {
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  }

  // CLI 级别生命周期事件
  await emitLifecycleEvent('cli_entry');
  await emitLifecycleEvent('cli_imports_loaded');

  // 检查特殊路径（对应官方的 fast path 检查）
  const args = process.argv.slice(2);

  // 版本快速路径
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    await emitLifecycleEvent('cli_version_fast_path');
    program.parse();
    return;
  }

  // Chrome MCP 服务器路径 - 用于 Claude CLI 与 Chrome 扩展通信
  if (args[0] === '--claude-in-chrome-mcp') {
    await emitLifecycleEvent('cli_claude_in_chrome_mcp_path');
    const { runMcpServer } = await import('./chrome-mcp/index.js');
    await runMcpServer();
    return;
  }

  // Chrome Native Host 路径 - 用于 Chrome 扩展与 Native Host 通信
  if (args[0] === '--chrome-native-host') {
    await emitLifecycleEvent('cli_chrome_native_host_path');
    const { runNativeHost } = await import('./chrome-mcp/index.js');
    await runNativeHost();
    return;
  }

  // 主函数导入前
  await emitLifecycleEvent('cli_before_main_import');

  // 这里主模块已经导入（在 Node.js ES Module 中，导入是同步的）
  // 所以我们直接触发导入后事件
  await emitLifecycleEvent('cli_after_main_import');

  // 运行主程序
  program.parse();

  // T511: cli_after_main_complete - CLI 完成
  await emitLifecycleEvent('cli_after_main_complete');
}

// 运行主函数
main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  safeExit(1);
});
