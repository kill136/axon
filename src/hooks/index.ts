/**
 * Hooks 系统
 * 支持在工具调用前后执行自定义脚本或 URL 回调
 * 基于官方 Claude Code CLI v2.1.4 逆向分析
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Hook 事件类型（官方支持的事件 + CLI 级别事件）
 */
export type HookEvent =
  // 工具级别事件
  | 'PreToolUse'           // 工具执行前
  | 'PostToolUse'          // 工具执行后
  | 'PostToolUseFailure'   // 工具执行失败后
  | 'Notification'         // 通知事件
  | 'UserPromptSubmit'     // 用户提交提示
  | 'SessionStart'         // 会话开始
  | 'SessionEnd'           // 会话结束
  | 'Stop'                 // 停止事件
  | 'SubagentStart'        // 子代理开始
  | 'SubagentStop'         // 子代理停止
  | 'PreCompact'           // 压缩前
  | 'PermissionRequest'    // 权限请求
  // v2.1.33: 多代理工作流事件
  | 'TeammateIdle'         // 当 teammate 即将进入空闲状态
  | 'TaskCompleted'        // 当任务被标记为已完成
  // CLI 级别事件（新增）
  | 'Setup'                // v2.1.10: 仓库设置/维护（通过 --init/--init-only/--maintenance 触发）
  | 'BeforeSetup'          // 设置前（对应 action_before_setup）
  | 'AfterSetup'           // 设置后（对应 action_after_setup）
  | 'CommandsLoaded'       // 命令加载完成（对应 action_commands_loaded）
  | 'ToolsLoaded'          // 工具加载完成（对应 action_tools_loaded）
  | 'McpConfigsLoaded'     // MCP 配置加载完成（对应 action_mcp_configs_loaded）
  | 'PluginsInitialized'   // 插件初始化后（对应 action_after_plugins_init）
  | 'AfterHooks';          // Hooks 执行后（对应 action_after_hooks）

/**
 * Hook 类型（对应官方 Claude Code CLI 支持的类型 + 扩展类型）
 * - command: 执行 shell 命令（官方）
 * - mcp: 调用 MCP 服务器工具（官方）
 * - prompt: LLM 提示评估（官方）
 * - agent: 代理验证器（官方）
 * - url: HTTP 回调（扩展，用于远程集成）
 */
export type HookType = 'command' | 'mcp' | 'prompt' | 'agent' | 'url';

/**
 * 默认超时时间（毫秒）
 * 官方 Claude Code CLI v2.1.3+ 要求：Tool hook 超时为 10 分钟
 */
export const DEFAULT_HOOK_TIMEOUT = 600000; // 10 minutes

/**
 * Command Hook 配置
 */
export interface CommandHookConfig {
  type: 'command';
  /** 执行的命令（支持环境变量替换，如 $TOOL_NAME） */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒，默认 600000 = 10分钟） */
  timeout?: number;
  /** 是否阻塞（等待完成，默认 true） */
  blocking?: boolean;
  /**
   * 是否异步执行（后台运行，不等待完成）
   * 官方 2.1.19: 当 async: true 时，命令在后台运行，hook 立即返回
   */
  async?: boolean;
  /** 匹配条件（工具名或正则） */
  matcher?: string;
}

/**
 * Prompt Hook 配置（使用 LLM 评估）
 */
export interface PromptHookConfig {
  type: 'prompt';
  /** LLM 提示模板 */
  prompt: string;
  /** 使用的模型（可选，默认使用当前会话模型） */
  model?: string;
  /** 超时时间（毫秒，默认 600000 = 10分钟） */
  timeout?: number;
  /** 是否阻塞（等待完成，默认 true） */
  blocking?: boolean;
  /** 匹配条件（工具名或正则） */
  matcher?: string;
}

/**
 * Agent Hook 配置（代理验证器）
 */
export interface AgentHookConfig {
  type: 'agent';
  /** 代理类型或名称 */
  agentType: string;
  /** 代理配置 */
  agentConfig?: Record<string, unknown>;
  /** 超时时间（毫秒，默认 600000 = 10分钟） */
  timeout?: number;
  /** 是否阻塞（等待完成，默认 true） */
  blocking?: boolean;
  /** 匹配条件（工具名或正则） */
  matcher?: string;
}

/**
 * MCP Hook 配置（调用 MCP 服务器工具）
 */
export interface McpHookConfig {
  type: 'mcp';
  /** MCP 服务器名称 */
  server: string;
  /** 要调用的工具名称 */
  tool: string;
  /** 工具参数（可选，会与 hook input 合并） */
  toolArgs?: Record<string, unknown>;
  /** 超时时间（毫秒，默认 600000 = 10分钟） */
  timeout?: number;
  /** 是否阻塞（等待完成，默认 true） */
  blocking?: boolean;
  /** 匹配条件（工具名或正则） */
  matcher?: string;
}

/**
 * URL Hook 配置（扩展类型，用于远程集成）
 */
export interface UrlHookConfig {
  type: 'url';
  /** 回调 URL */
  url: string;
  /** HTTP 方法（默认 POST） */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** 请求头 */
  headers?: Record<string, string>;
  /** 超时时间（毫秒，默认 600000 = 10分钟） */
  timeout?: number;
  /** 是否阻塞（等待完成，默认 false） */
  blocking?: boolean;
  /** 匹配条件（工具名或正则） */
  matcher?: string;
}

/**
 * Hook 配置（联合类型）
 */
export type HookConfig = CommandHookConfig | McpHookConfig | PromptHookConfig | AgentHookConfig | UrlHookConfig;

/**
 * 旧版 Hook 配置（兼容性）
 */
export interface LegacyHookConfig {
  event: HookEvent;
  matcher?: string;
  command: string;
  args?: string[];
  timeout?: number;
  env?: Record<string, string>;
  blocking?: boolean;
}

/**
 * Hook 输入数据（完整接口，符合官方 CLI v2.1.4）
 */
export interface HookInput {
  event: HookEvent;
  // 通用字段
  hook_event_name?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  message?: string;
  sessionId?: string;

  // PostToolUseFailure 专用字段
  tool_use_id?: string;
  error?: string;
  error_type?: 'permission_denied' | 'execution_failed' | 'timeout' | 'invalid_input';
  is_interrupt?: boolean;
  is_timeout?: boolean;

  // SubagentStart/SubagentStop 专用字段
  agent_id?: string;
  agent_type?: string;
  result?: unknown;

  // PermissionRequest 专用字段（tool_use_id已包含）

  // Notification 专用字段
  notification_type?: 'permission_prompt' | 'idle_prompt' | 'auth_success' | 'elicitation_dialog';

  // SessionStart 专用字段
  source?: 'startup' | 'resume' | 'clear' | 'compact';
  model?: string;

  // SessionEnd 专用字段
  reason?: 'clear' | 'logout' | 'prompt_input_exit' | 'other';

  // PreCompact 专用字段
  trigger?: 'manual' | 'auto';
  currentTokens?: number;

  // v2.1.33: TeammateIdle 专用字段
  teammate_name?: string;
  team_name?: string;

  // v2.1.33: TaskCompleted 专用字段
  task_id?: string;
  task_subject?: string;
  task_description?: string;
}

export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
  blocked?: boolean;
  blockMessage?: string;
  /** 异步钩子标识（支持后台执行） */
  async?: boolean;
  /** 钩子决策（用于 agent 类型） */
  decision?: 'allow' | 'deny' | 'block';
  /** 决策原因 */
  reason?: string;
  /**
   * v2.1.9: PreToolUse hooks 返回的额外上下文信息
   * 会被添加到发送给模型的消息中
   */
  additionalContext?: string;
}

/**
 * 注册的 Hooks 存储（按事件类型分组）
 */
export interface RegisteredHooks {
  [event: string]: HookConfig[];
}

const registeredHooks: RegisteredHooks = {};

/**
 * 注册 hook
 */
export function registerHook(event: HookEvent, config: HookConfig): void {
  if (!registeredHooks[event]) {
    registeredHooks[event] = [];
  }
  registeredHooks[event].push(config);
}

/**
 * 注册旧版 hook（兼容性）
 */
export function registerLegacyHook(config: LegacyHookConfig): void {
  const hookConfig: CommandHookConfig = {
    type: 'command',
    command: config.command,
    args: config.args,
    env: config.env,
    timeout: config.timeout,
    blocking: config.blocking,
    matcher: config.matcher,
  };
  registerHook(config.event, hookConfig);
}

/**
 * 从配置文件加载 hooks（支持新旧两种格式）
 */
export function loadHooksFromFile(configPath: string): void {
  if (!fs.existsSync(configPath)) return;

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    // 新格式：{ "hooks": { "PreToolUse": [...], "PostToolUse": [...] } }
    if (config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks)) {
      for (const [eventName, hooks] of Object.entries(config.hooks)) {
        if (!isValidHookEvent(eventName)) {
          console.warn(`Unknown hook event: ${eventName}`);
          continue;
        }

        const hookArray = Array.isArray(hooks) ? hooks : [hooks];
        for (const hook of hookArray) {
          if (isValidHookConfig(hook)) {
            registerHook(eventName as HookEvent, hook);
          } else {
            console.warn(`Invalid hook config for event ${eventName}:`, hook);
          }
        }
      }
    }
    // 旧格式：{ "hooks": [...] }（兼容性）
    else if (config.hooks && Array.isArray(config.hooks)) {
      for (const hook of config.hooks) {
        if (isValidLegacyHookConfig(hook)) {
          registerLegacyHook(hook);
        }
      }
    }
  } catch (err) {
    console.error(`Failed to load hooks from ${configPath}:`, err);
  }
}

/**
 * 验证 Hook 事件名称
 */
function isValidHookEvent(event: string): boolean {
  const validEvents: HookEvent[] = [
    // 工具级别事件
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'Notification',
    'UserPromptSubmit',
    'SessionStart',
    'SessionEnd',
    'Stop',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
    'PermissionRequest',
    // v2.1.33: 多代理工作流事件
    'TeammateIdle',
    'TaskCompleted',
    // CLI 级别事件
    'Setup',             // v2.1.10
    'BeforeSetup',
    'AfterSetup',
    'CommandsLoaded',
    'ToolsLoaded',
    'McpConfigsLoaded',
    'PluginsInitialized',
    'AfterHooks',
  ];
  return validEvents.includes(event as HookEvent);
}

/**
 * 验证 Hook 配置
 */
function isValidHookConfig(config: any): config is HookConfig {
  if (!config || typeof config !== 'object') return false;

  if (config.type === 'command') {
    return typeof config.command === 'string';
  } else if (config.type === 'prompt') {
    return typeof config.prompt === 'string';
  } else if (config.type === 'agent') {
    return typeof config.agentType === 'string';
  } else if (config.type === 'mcp') {
    return typeof config.server === 'string' && typeof config.tool === 'string';
  } else if (config.type === 'url') {
    return typeof config.url === 'string';
  }

  return false;
}

/**
 * 验证旧版 Hook 配置
 */
function isValidLegacyHookConfig(config: any): config is LegacyHookConfig {
  return config &&
         typeof config === 'object' &&
         typeof config.event === 'string' &&
         typeof config.command === 'string';
}

/**
 * 从项目目录加载 hooks
 */
export function loadProjectHooks(projectDir: string): void {
  // 检查 .claude/settings.json
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  loadHooksFromFile(settingsPath);

  // 检查 .claude/hooks/ 目录
  const hooksDir = path.join(projectDir, '.claude', 'hooks');
  if (fs.existsSync(hooksDir) && fs.statSync(hooksDir).isDirectory()) {
    const files = fs.readdirSync(hooksDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        loadHooksFromFile(path.join(hooksDir, file));
      }
    }
  }
}

/**
 * 获取匹配的 hooks
 */
function getMatchingHooks(event: HookEvent, toolName?: string): HookConfig[] {
  const hooks = registeredHooks[event] || [];

  return hooks.filter((hook) => {
    if (hook.matcher && toolName) {
      // 支持正则匹配
      if (hook.matcher.startsWith('/') && hook.matcher.endsWith('/')) {
        const regex = new RegExp(hook.matcher.slice(1, -1));
        return regex.test(toolName);
      }
      // 精确匹配
      return hook.matcher === toolName;
    }

    return true;
  });
}

/**
 * 替换命令中的环境变量占位符
 */
function replaceCommandVariables(command: string, input: HookInput): string {
  return command
    .replace(/\$TOOL_NAME/g, input.toolName || '')
    .replace(/\$EVENT/g, input.event)
    .replace(/\$SESSION_ID/g, input.sessionId || '');
}

/**
 * 执行 Command Hook
 */
async function executeCommandHook(
  hook: CommandHookConfig,
  input: HookInput
): Promise<HookResult> {
  return new Promise((resolve) => {
    const timeout = hook.timeout || DEFAULT_HOOK_TIMEOUT;
    let stdout = '';
    let stderr = '';

    // 替换命令中的环境变量
    let command = replaceCommandVariables(hook.command, input);

    // Windows 兼容：.sh 文件在 Windows 上会被文本编辑器打开而非执行
    // 自动添加 bash 前缀来正确执行
    if (process.platform === 'win32' && /\.sh(?:\s|$|")/.test(command)) {
      command = `bash ${command}`;
    }

    // 准备环境变量
    const env = {
      ...process.env,
      ...hook.env,
      CLAUDE_HOOK_EVENT: input.event,
      CLAUDE_HOOK_TOOL_NAME: input.toolName || '',
      CLAUDE_HOOK_SESSION_ID: input.sessionId || '',
    };

    // 通过 stdin 传递输入（包含所有官方字段）
    const inputJson = JSON.stringify({
      event: input.event,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput,
      message: input.message,
      sessionId: input.sessionId,
      // PostToolUseFailure 专用字段
      tool_use_id: input.tool_use_id,
      error: input.error,
      error_type: input.error_type,
      is_interrupt: input.is_interrupt,
      is_timeout: input.is_timeout,
      // SubagentStart/SubagentStop 专用字段
      agent_id: input.agent_id,
      agent_type: input.agent_type,
      result: input.result,
      // Notification 专用字段
      notification_type: input.notification_type,
      // SessionStart 专用字段
      source: input.source,
      // SessionEnd 专用字段
      reason: input.reason,
      // PreCompact 专用字段
      trigger: input.trigger,
      currentTokens: input.currentTokens,
      // v2.1.33: TeammateIdle 专用字段
      teammate_name: input.teammate_name,
      team_name: input.team_name,
      // v2.1.33: TaskCompleted 专用字段
      task_id: input.task_id,
      task_subject: input.task_subject,
      task_description: input.task_description,
      // SessionStart 专用字段
      model: input.model,
    });

    const proc = spawn(command, hook.args || [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true, // 使用 shell 执行以支持复杂命令
    });

    // 官方 2.1.19: 当 async: true 或 blocking: false 时，后台运行并立即返回
    const isBackgrounded = hook.async === true || hook.blocking === false;

    if (isBackgrounded) {
      // 写入 stdin 并关闭
      proc.stdin?.write(inputJson);
      proc.stdin?.end();

      // 使进程脱离父进程，允许后台运行
      // unref() 使进程不阻止 Node.js 进程退出
      proc.unref();

      // 立即返回成功，标记为异步
      resolve({
        success: true,
        async: true,
        output: '',
      });
      return;
    }

    const timeoutId = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({
        success: false,
        error: 'Hook execution timed out',
      });
    }, timeout);

    proc.stdin?.write(inputJson);
    proc.stdin?.end();

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);

      // 检查是否阻塞
      if (code !== 0) {
        // 尝试解析 JSON 输出以获取阻塞消息
        try {
          const output = JSON.parse(stdout);
          if (output.blocked) {
            resolve({
              success: false,
              blocked: true,
              blockMessage: output.message || 'Blocked by hook',
            });
            return;
          }
        } catch {
          // 非 JSON 输出
        }

        resolve({
          success: false,
          error: stderr || `Hook exited with code ${code}`,
        });
        return;
      }

      resolve({
        success: true,
        output: stdout,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: err.message,
      });
    });
  });
}

/**
 * 执行 Prompt Hook（使用 LLM 评估）
 */
async function executePromptHook(
  hook: PromptHookConfig,
  input: HookInput
): Promise<HookResult> {
  const timeout = hook.timeout || DEFAULT_HOOK_TIMEOUT;

  try {
    // 构建提示词，替换变量（包含所有官方字段）
    let prompt = hook.prompt
      .replace(/\{EVENT\}/g, input.event)
      .replace(/\{TOOL_NAME\}/g, input.toolName || '')
      .replace(/\{TOOL_INPUT\}/g, JSON.stringify(input.toolInput || {}))
      .replace(/\{TOOL_OUTPUT\}/g, input.toolOutput || '')
      .replace(/\{MESSAGE\}/g, input.message || '')
      .replace(/\{SESSION_ID\}/g, input.sessionId || '')
      .replace(/\{TOOL_USE_ID\}/g, input.tool_use_id || '')
      .replace(/\{ERROR\}/g, input.error || '')
      .replace(/\{ERROR_TYPE\}/g, input.error_type || '')
      .replace(/\{AGENT_ID\}/g, input.agent_id || '')
      .replace(/\{AGENT_TYPE\}/g, input.agent_type || '')
      .replace(/\{NOTIFICATION_TYPE\}/g, input.notification_type || '')
      .replace(/\{SOURCE\}/g, input.source || '')
      .replace(/\{REASON\}/g, input.reason || '')
      .replace(/\{TRIGGER\}/g, input.trigger || '');

    // 动态导入 ClaudeClient 以避免循环依赖
    const { ClaudeClient } = await import('../core/client.js');
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        error: 'Prompt hook requires ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable',
      };
    }

    const client = new ClaudeClient({
      apiKey,
      model: hook.model || 'claude-3-5-sonnet-20241022',
      maxTokens: 1024,
    });

    // 调用 Claude API 评估提示
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await client.createMessage([
        {
          role: 'user',
          content: prompt,
        },
      ],
      undefined, // tools
      `You are evaluating a hook in Claude Code.

CRITICAL: You MUST return ONLY valid JSON with no other text, explanation, or commentary before or after the JSON. Do not include any markdown code blocks, thinking, or additional text.

Your response must be a single JSON object matching one of the following schemas:
1. If the condition is met, return: {"ok": true}
2. If the condition is not met, return: {"ok": false, "reason": "Reason for why it is not met"}

Do not return anything else. Just the JSON.`);

      clearTimeout(timeoutId);

      // 提取文本内容
      let text = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          text += block.text;
        }
      }

      // 解析 JSON 响应
      const result = JSON.parse(text.trim());

      if (result.ok === false) {
        return {
          success: false,
          blocked: true,
          blockMessage: result.reason || 'Blocked by prompt hook',
          decision: 'deny',
          reason: result.reason,
        };
      }

      return {
        success: true,
        output: JSON.stringify(result),
        decision: 'allow',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return {
          success: false,
          error: 'Prompt hook evaluation timed out',
        };
      }

      return {
        success: false,
        error: err.message || 'Failed to evaluate prompt hook',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Prompt hook evaluation failed',
    };
  }
}

/**
 * 执行 Agent Hook（代理验证器）
 */
async function executeAgentHook(
  hook: AgentHookConfig,
  input: HookInput
): Promise<HookResult> {
  const timeout = hook.timeout || DEFAULT_HOOK_TIMEOUT;

  try {
    // 动态导入 Agent 相关模块以避免循环依赖
    const { ClaudeClient } = await import('../core/client.js');
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        error: 'Agent hook requires ANTHROPIC_API_KEY or CLAUDE_API_KEY environment variable',
      };
    }

    // 构建代理提示词（包含所有官方字段）
    const agentPrompt = `You are a validator agent of type "${hook.agentType}" in Claude Code.

Your task is to evaluate the following operation and decide whether it should be allowed.

Event: ${input.event}
${input.toolName ? `Tool Name: ${input.toolName}` : ''}
${input.toolInput ? `Tool Input: ${JSON.stringify(input.toolInput, null, 2)}` : ''}
${input.toolOutput ? `Tool Output: ${input.toolOutput}` : ''}
${input.message ? `Message: ${input.message}` : ''}
${input.tool_use_id ? `Tool Use ID: ${input.tool_use_id}` : ''}
${input.error ? `Error: ${input.error}` : ''}
${input.error_type ? `Error Type: ${input.error_type}` : ''}
${input.is_interrupt ? `Interrupted: ${input.is_interrupt}` : ''}
${input.is_timeout ? `Timeout: ${input.is_timeout}` : ''}
${input.agent_id ? `Agent ID: ${input.agent_id}` : ''}
${input.agent_type ? `Agent Type: ${input.agent_type}` : ''}
${input.notification_type ? `Notification Type: ${input.notification_type}` : ''}
${input.source ? `Source: ${input.source}` : ''}
${input.reason ? `Reason: ${input.reason}` : ''}
${input.trigger ? `Trigger: ${input.trigger}` : ''}

${hook.agentConfig ? `Agent Configuration: ${JSON.stringify(hook.agentConfig, null, 2)}` : ''}

Based on your role as a "${hook.agentType}" validator, determine if this operation should be allowed.

CRITICAL: You MUST return ONLY valid JSON with no other text, explanation, or commentary before or after the JSON. Do not include any markdown code blocks, thinking, or additional text.

Your response must be a single JSON object with the following schema:
{
  "decision": "allow" | "deny",
  "reason": "Brief explanation of your decision"
}

Do not return anything else. Just the JSON.`;

    const client = new ClaudeClient({
      apiKey,
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 2048,
    });

    // 调用 Claude API 作为代理
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await client.createMessage([
        {
          role: 'user',
          content: agentPrompt,
        },
      ]);

      clearTimeout(timeoutId);

      // 提取文本内容
      let text = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          text += block.text;
        }
      }

      // 解析 JSON 响应
      const result = JSON.parse(text.trim());

      if (result.decision === 'deny') {
        return {
          success: false,
          blocked: true,
          blockMessage: result.reason || 'Blocked by agent hook',
          decision: 'deny',
          reason: result.reason,
        };
      }

      return {
        success: true,
        output: JSON.stringify(result),
        decision: 'allow',
        reason: result.reason,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return {
          success: false,
          error: 'Agent hook evaluation timed out',
        };
      }

      return {
        success: false,
        error: err.message || 'Failed to evaluate agent hook',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Agent hook validation failed',
    };
  }
}

/**
 * 执行 MCP Hook（调用 MCP 服务器工具）
 */
async function executeMcpHook(
  hook: McpHookConfig,
  input: HookInput
): Promise<HookResult> {
  const timeout = hook.timeout || DEFAULT_HOOK_TIMEOUT;

  try {
    // 动态导入 MCP 工具以避免循环依赖
    const mcpModule = await import('../tools/mcp.js');
    const { getMcpServers } = mcpModule;

    // 检查 MCP 服务器是否存在
    const servers = getMcpServers();
    const server = servers.get(hook.server);

    if (!server) {
      return {
        success: false,
        error: `MCP server "${hook.server}" not found. Available servers: ${Array.from(servers.keys()).join(', ')}`,
      };
    }

    if (!server.connected) {
      return {
        success: false,
        error: `MCP server "${hook.server}" is not connected`,
      };
    }

    // 检查工具是否存在
    const tool = server.tools.find((t) => t.name === hook.tool);
    if (!tool) {
      return {
        success: false,
        error: `Tool "${hook.tool}" not found on MCP server "${hook.server}". Available tools: ${server.tools.map((t) => t.name).join(', ')}`,
      };
    }

    // 合并工具参数（hook配置 + hook输入）- 包含所有官方字段
    const toolArgs = {
      ...hook.toolArgs,
      event: input.event,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolOutput: input.toolOutput,
      message: input.message,
      sessionId: input.sessionId,
      // PostToolUseFailure 专用字段
      tool_use_id: input.tool_use_id,
      error: input.error,
      error_type: input.error_type,
      is_interrupt: input.is_interrupt,
      is_timeout: input.is_timeout,
      // SubagentStart/SubagentStop 专用字段
      agent_id: input.agent_id,
      agent_type: input.agent_type,
      result: input.result,
      // Notification 专用字段
      notification_type: input.notification_type,
      // SessionStart 专用字段
      source: input.source,
      // SessionEnd 专用字段
      reason: input.reason,
      // PreCompact 专用字段
      trigger: input.trigger,
      currentTokens: input.currentTokens,
    };

    // 调用 MCP 工具
    // 我们需要使用内部的 sendMcpMessage 函数
    // 由于它不是导出的，我们需要通过反射或者修改 mcp.ts 来导出它
    // 暂时使用一个简化的实现

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // 使用 MCP 工具的 callMcpTool 函数
      const { callMcpTool } = await import('../tools/mcp.js');

      const result = await callMcpTool(hook.server, hook.tool, toolArgs);

      clearTimeout(timeoutId);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'MCP tool execution failed',
        };
      }

      // 解析结果以检查是否有阻塞决策
      if (result.output) {
        try {
          const output = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;

          if (output.blocked || output.decision === 'deny') {
            return {
              success: false,
              blocked: true,
              blockMessage: output.reason || output.message || 'Blocked by MCP hook',
              decision: 'deny',
              reason: output.reason || output.message,
            };
          }

          return {
            success: true,
            output: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
            decision: output.decision || 'allow',
          };
        } catch {
          // 如果不是 JSON，直接返回
          return {
            success: true,
            output: result.output,
          };
        }
      }

      return {
        success: true,
        output: result.output || '',
      };
    } catch (err: any) {
      clearTimeout(timeoutId);

      if (err.name === 'AbortError') {
        return {
          success: false,
          error: 'MCP hook execution timed out',
        };
      }

      return {
        success: false,
        error: err.message || 'Failed to execute MCP hook',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'MCP hook execution failed',
    };
  }
}

/**
 * 执行 URL Hook（扩展功能，用于远程集成）
 */
async function executeUrlHook(
  hook: UrlHookConfig,
  input: HookInput
): Promise<HookResult> {
  const timeout = hook.timeout || DEFAULT_HOOK_TIMEOUT;
  const method = hook.method || 'POST';

  // URL Hook payload - 包含所有官方字段
  const payload = {
    event: input.event,
    toolName: input.toolName,
    toolInput: input.toolInput,
    toolOutput: input.toolOutput,
    message: input.message,
    sessionId: input.sessionId,
    timestamp: new Date().toISOString(),
    // PostToolUseFailure 专用字段
    tool_use_id: input.tool_use_id,
    error: input.error,
    error_type: input.error_type,
    is_interrupt: input.is_interrupt,
    is_timeout: input.is_timeout,
    // SubagentStart/SubagentStop 专用字段
    agent_id: input.agent_id,
    agent_type: input.agent_type,
    result: input.result,
    // Notification 专用字段
    notification_type: input.notification_type,
    // SessionStart 专用字段
    source: input.source,
    // SessionEnd 专用字段
    reason: input.reason,
    // PreCompact 专用字段
    trigger: input.trigger,
    currentTokens: input.currentTokens,
  };

  try {
    // 使用 fetch API（Node.js 18+ 内置）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Claude-Code-Hooks/2.0',
      ...(hook.headers || {}),
    };

    const response = await fetch(hook.url, {
      method,
      headers,
      body: method !== 'GET' ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${responseText}`,
      };
    }

    // 尝试解析 JSON 响应
    try {
      const responseJson = JSON.parse(responseText);
      if (responseJson.blocked) {
        return {
          success: false,
          blocked: true,
          blockMessage: responseJson.message || 'Blocked by hook',
        };
      }
      return {
        success: true,
        output: responseText,
      };
    } catch {
      // 非 JSON 响应
      return {
        success: true,
        output: responseText,
      };
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Hook request timed out',
      };
    }
    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}

/**
 * 执行单个 hook（根据类型分发）
 */
async function executeHook(hook: HookConfig, input: HookInput): Promise<HookResult> {
  if (hook.type === 'command') {
    return executeCommandHook(hook, input);
  } else if (hook.type === 'prompt') {
    return executePromptHook(hook, input);
  } else if (hook.type === 'agent') {
    return executeAgentHook(hook, input);
  } else if (hook.type === 'mcp') {
    return executeMcpHook(hook, input);
  } else if (hook.type === 'url') {
    return executeUrlHook(hook, input);
  } else {
    return {
      success: false,
      error: `Unknown hook type: ${(hook as any).type}`,
    };
  }
}

/**
 * 运行所有匹配的 hooks
 */
export async function runHooks(input: HookInput): Promise<HookResult[]> {
  const matchingHooks = getMatchingHooks(input.event, input.toolName);
  const results: HookResult[] = [];

  for (const hook of matchingHooks) {
    const result = await executeHook(hook, input);
    results.push(result);

    // 如果 hook 阻塞且是 blocking 类型，停止执行后续 hooks
    if (result.blocked && hook.blocking) {
      break;
    }
  }

  return results;
}

/**
 * 检查是否有任何 hook 阻塞操作
 */
export function isBlocked(results: HookResult[]): { blocked: boolean; message?: string } {
  for (const result of results) {
    if (result.blocked) {
      return { blocked: true, message: result.blockMessage };
    }
  }
  return { blocked: false };
}

/**
 * PreToolUse hook 辅助函数
 * v2.1.9: 支持返回 additionalContext
 */
export async function runPreToolUseHooks(
  toolName: string,
  toolInput: unknown,
  sessionId?: string
): Promise<{ allowed: boolean; message?: string; additionalContext?: string }> {
  const results = await runHooks({
    event: 'PreToolUse',
    toolName,
    toolInput,
    sessionId,
  });

  const blockCheck = isBlocked(results);

  // v2.1.9: 收集所有 hook 返回的 additionalContext
  const additionalContexts = results
    .filter((r) => r.additionalContext)
    .map((r) => r.additionalContext);

  return {
    allowed: !blockCheck.blocked,
    message: blockCheck.message,
    // 如果有多个 hook 返回 additionalContext，用分隔符连接
    additionalContext: additionalContexts.length > 0
      ? additionalContexts.join('\n---\n')
      : undefined,
  };
}

/**
 * PostToolUse hook 辅助函数
 */
export async function runPostToolUseHooks(
  toolName: string,
  toolInput: unknown,
  toolOutput: string,
  sessionId?: string
): Promise<void> {
  await runHooks({
    event: 'PostToolUse',
    toolName,
    toolInput,
    toolOutput,
    sessionId,
  });
}

/**
 * UserPromptSubmit hook - 用户提交提示时触发
 */
export async function runUserPromptSubmitHooks(
  prompt: string,
  sessionId?: string
): Promise<{ allowed: boolean; message?: string }> {
  const results = await runHooks({
    event: 'UserPromptSubmit',
    message: prompt,
    sessionId,
  });

  const blockCheck = isBlocked(results);
  return {
    allowed: !blockCheck.blocked,
    message: blockCheck.message,
  };
}

/**
 * Stop hook - 停止事件触发
 */
export async function runStopHooks(
  reason?: string,
  sessionId?: string
): Promise<void> {
  await runHooks({
    event: 'Stop',
    message: reason,
    sessionId,
  });
}

/**
 * PreCompact hook - 压缩前触发
 *
 * @param sessionId 会话ID
 * @param currentTokens 当前token数
 * @param trigger 触发方式（manual或auto）
 * @returns 是否允许压缩
 */
export async function runPreCompactHooks(
  sessionId?: string,
  currentTokens?: number,
  trigger?: 'manual' | 'auto'
): Promise<{ allowed: boolean; message?: string }> {
  const results = await runHooks({
    event: 'PreCompact',
    currentTokens,
    trigger,
    sessionId,
  });

  const blockCheck = isBlocked(results);
  return {
    allowed: !blockCheck.blocked,
    message: blockCheck.message,
  };
}

/**
 * PostToolUseFailure hook - 工具执行失败后触发
 *
 * @param toolName 工具名称
 * @param toolInput 工具输入
 * @param toolUseId 工具使用ID
 * @param error 错误信息
 * @param errorType 错误类型
 * @param isInterrupt 是否被中断
 * @param isTimeout 是否超时
 * @param sessionId 会话ID
 */
export async function runPostToolUseFailureHooks(
  toolName: string,
  toolInput: unknown,
  toolUseId: string,
  error: string,
  errorType: 'permission_denied' | 'execution_failed' | 'timeout' | 'invalid_input' = 'execution_failed',
  isInterrupt: boolean = false,
  isTimeout: boolean = false,
  sessionId?: string
): Promise<void> {
  await runHooks({
    event: 'PostToolUseFailure',
    toolName,
    toolInput,
    tool_use_id: toolUseId,
    error,
    error_type: errorType,
    is_interrupt: isInterrupt,
    is_timeout: isTimeout,
    sessionId,
  });
}

/**
 * 清除所有已注册的 hooks
 */
export function clearHooks(): void {
  for (const event in registeredHooks) {
    delete registeredHooks[event];
  }
}

/**
 * 获取已注册的 hooks 数量
 */
export function getHookCount(): number {
  let count = 0;
  for (const event in registeredHooks) {
    count += registeredHooks[event].length;
  }
  return count;
}

/**
 * 获取指定事件的 hooks 数量
 */
export function getEventHookCount(event: HookEvent): number {
  return (registeredHooks[event] || []).length;
}

/**
 * SessionStart hook - 会话开始时触发
 *
 * @param sessionId 会话ID
 * @param source 会话启动来源
 */
export async function runSessionStartHooks(
  sessionId: string,
  source?: 'startup' | 'resume' | 'clear' | 'compact'
): Promise<void> {
  await runHooks({
    event: 'SessionStart',
    source,
    sessionId,
  });
}

/**
 * SessionEnd hook - 会话结束时触发
 *
 * @param sessionId 会话ID
 * @param reason 会话结束原因
 */
export async function runSessionEndHooks(
  sessionId: string,
  reason?: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
): Promise<void> {
  await runHooks({
    event: 'SessionEnd',
    reason,
    sessionId,
  });
}

/**
 * SubagentStart hook - 子代理启动时触发
 *
 * @param agentId 代理ID
 * @param agentType 代理类型
 * @param sessionId 会话ID
 */
export async function runSubagentStartHooks(
  agentId: string,
  agentType: string,
  sessionId?: string
): Promise<void> {
  await runHooks({
    event: 'SubagentStart',
    agent_id: agentId,
    agent_type: agentType,
    sessionId,
  });
}

/**
 * SubagentStop hook - 子代理停止时触发
 *
 * @param agentId 代理ID
 * @param agentType 代理类型
 * @param result 代理执行结果
 * @param sessionId 会话ID
 */
export async function runSubagentStopHooks(
  agentId: string,
  agentType: string,
  result?: unknown,
  sessionId?: string
): Promise<void> {
  await runHooks({
    event: 'SubagentStop',
    agent_id: agentId,
    agent_type: agentType,
    result,
    sessionId,
  });
}

/**
 * PermissionRequest hook - 权限请求时触发
 *
 * @param toolName 工具名称
 * @param toolInput 工具输入
 * @param toolUseId 工具使用ID
 * @param sessionId 会话ID
 * @returns Hook决策结果
 */
export async function runPermissionRequestHooks(
  toolName: string,
  toolInput: unknown,
  toolUseId?: string,
  sessionId?: string
): Promise<{ decision?: 'allow' | 'deny'; message?: string }> {
  const results = await runHooks({
    event: 'PermissionRequest',
    toolName,
    toolInput,
    tool_use_id: toolUseId,
    sessionId,
  });

  // 检查是否有 hook 返回决策
  for (const result of results) {
    if (result.output) {
      try {
        const output = JSON.parse(result.output);
        if (output.decision === 'allow' || output.decision === 'deny') {
          return {
            decision: output.decision,
            message: output.message,
          };
        }
      } catch {
        // 非 JSON 输出
      }
    }
  }

  return {};
}

/**
 * Notification hook - 发送通知时触发
 *
 * @param message 通知消息
 * @param notificationType 通知类型
 * @param sessionId 会话ID
 */
export async function runNotificationHooks(
  message: string,
  notificationType?: 'permission_prompt' | 'idle_prompt' | 'auth_success' | 'elicitation_dialog',
  sessionId?: string
): Promise<void> {
  await runHooks({
    event: 'Notification',
    message,
    notification_type: notificationType,
    sessionId,
  });
}

/**
 * v2.1.33: TeammateIdle hook - 当 teammate 即将进入空闲状态时触发
 *
 * 对应官方 NyA 函数:
 * Exit code 0 - stdout/stderr not shown
 * Exit code 2 - show stderr to teammate and prevent idle (teammate continues working)
 * Other exit codes - show stderr to user only
 *
 * @param teammateName teammate 名称
 * @param teamName team 名称
 * @param sessionId 会话ID
 */
export async function runTeammateIdleHooks(
  teammateName: string,
  teamName: string,
  sessionId?: string
): Promise<{ blocked: boolean; blockingError?: string }> {
  const results = await runHooks({
    event: 'TeammateIdle',
    hook_event_name: 'TeammateIdle',
    teammate_name: teammateName,
    team_name: teamName,
    sessionId,
  });

  const blockCheck = isBlocked(results);
  return {
    blocked: blockCheck.blocked,
    blockingError: blockCheck.message,
  };
}

/**
 * v2.1.33: TeammateIdle hook 反馈消息格式化
 * 对应官方 fyA 函数
 */
export function formatTeammateIdleHookFeedback(result: { blockingError: string }): string {
  return `TeammateIdle hook feedback:\n${result.blockingError}`;
}

/**
 * v2.1.33: TaskCompleted hook - 当任务被标记为已完成时触发
 *
 * 对应官方 NQ1 函数:
 * Exit code 0 - stdout/stderr not shown
 * Exit code 2 - show stderr to model and prevent task completion
 * Other exit codes - show stderr to user only
 *
 * @param taskId 任务ID
 * @param taskSubject 任务标题
 * @param taskDescription 任务描述
 * @param teammateName teammate 名称
 * @param teamName team 名称
 * @param sessionId 会话ID
 */
export async function runTaskCompletedHooks(
  taskId: string,
  taskSubject: string,
  taskDescription: string,
  teammateName: string,
  teamName: string,
  sessionId?: string
): Promise<{ blocked: boolean; blockingError?: string }> {
  const results = await runHooks({
    event: 'TaskCompleted',
    hook_event_name: 'TaskCompleted',
    task_id: taskId,
    task_subject: taskSubject,
    task_description: taskDescription,
    teammate_name: teammateName,
    team_name: teamName,
    sessionId,
  });

  const blockCheck = isBlocked(results);
  return {
    blocked: blockCheck.blocked,
    blockingError: blockCheck.message,
  };
}

/**
 * v2.1.33: TaskCompleted hook 反馈消息格式化
 * 对应官方 VQ1 函数
 */
export function formatTaskCompletedHookFeedback(result: { blockingError: string }): string {
  return `TaskCompleted hook feedback:\n${result.blockingError}`;
}

/**
 * 获取所有已注册的 hooks（按事件分组）
 */
export function getRegisteredHooks(): RegisteredHooks {
  return { ...registeredHooks };
}

/**
 * 获取所有已注册的 hooks（扁平数组，兼容旧版）
 */
export function getRegisteredHooksFlat(): Array<{ event: HookEvent; config: HookConfig }> {
  const result: Array<{ event: HookEvent; config: HookConfig }> = [];
  for (const [event, hooks] of Object.entries(registeredHooks)) {
    for (const config of hooks) {
      result.push({ event: event as HookEvent, config });
    }
  }
  return result;
}

/**
 * 获取指定事件的 hooks
 */
export function getHooksForEvent(event: HookEvent): HookConfig[] {
  return [...(registeredHooks[event] || [])];
}

/**
 * 取消注册 hook
 */
export function unregisterHook(event: HookEvent, config: HookConfig): boolean {
  const hooks = registeredHooks[event];
  if (!hooks) return false;

  const index = hooks.findIndex((h) => {
    if (h.type === 'command' && config.type === 'command') {
      return h.command === config.command;
    } else if (h.type === 'url' && config.type === 'url') {
      return h.url === config.url;
    }
    return false;
  });

  if (index !== -1) {
    hooks.splice(index, 1);
    if (hooks.length === 0) {
      delete registeredHooks[event];
    }
    return true;
  }
  return false;
}

/**
 * 清除指定事件的所有 hooks
 */
export function clearEventHooks(event: HookEvent): void {
  delete registeredHooks[event];
}

/**
 * 重新加载所有 hooks
 * 用于在信任状态变化后重新加载项目 hooks
 *
 * 修复官方 v2.1.3 bug:
 * "Fixed trust dialog acceptance when running from the home directory
 *  not enabling trust-requiring features like hooks during the session"
 *
 * @param projectDir 项目目录，默认为当前工作目录
 */
export function reloadHooks(projectDir?: string): void {
  const dir = projectDir || process.cwd();

  console.log(`[Hooks] Reloading hooks for: ${dir}`);

  // 清除现有 hooks
  clearHooks();

  // 重新加载项目 hooks
  loadProjectHooks(dir);

  // 加载全局 hooks（如果存在）
  const globalSettingsPath = path.join(
    process.env.HOME || process.env.USERPROFILE || '',
    '.claude',
    'settings.json'
  );
  loadHooksFromFile(globalSettingsPath);

  console.log(`[Hooks] Reloaded ${getHookCount()} hooks`);
}

/**
 * 检查 hooks 是否已加载
 */
export function areHooksLoaded(): boolean {
  return getHookCount() > 0;
}

/**
 * 获取 hooks 加载状态摘要
 */
export function getHooksLoadedSummary(): {
  loaded: boolean;
  count: number;
  events: string[];
} {
  const count = getHookCount();
  const events = Object.keys(registeredHooks);

  return {
    loaded: count > 0,
    count,
    events,
  };
}
