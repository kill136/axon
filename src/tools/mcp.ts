/**
 * MCP (Model Context Protocol) 工具
 * 支持连接和调用 MCP 服务器
 */

import { spawn, ChildProcess } from 'child_process';
import { BaseTool, ToolRegistry } from './base.js';
import type {
  McpInput,
  ListMcpResourcesInput,
  ReadMcpResourceInput,
  McpResourceInput,
  MCPSearchInput,
  McpServerConfig,
  ToolResult,
  ToolDefinition,
} from '../types/index.js';
import type { MCPSearchToolResult } from '../types/results.js';
import { MAX_MCP_OUTPUT_TOKENS, truncateMcpOutput } from '../utils/index.js';
import { persistLargeOutputSync } from './output-persistence.js';
import { t } from '../i18n/index.js';

// MCP 服务器状态管理
interface McpServerState {
  config: McpServerConfig;
  process?: ChildProcess;
  connected: boolean;
  connecting: boolean;
  lastConnectAttempt?: number;
  reconnectAttempts: number;
  capabilities: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  tools: McpToolDefinition[];
  resources: McpResource[];
  resourcesCache?: {
    data: McpResource[];
    timestamp: number;
  };
  lastHealthCheck?: number;
  /**
   * v2.1.9: 缓存的连接 Promise
   * 用于防止并发连接时重复创建连接，确保多个调用者共享同一个连接结果
   * 解决了缓存的连接 promise 永不 resolve 导致的重连挂起问题
   */
  connectionPromise?: Promise<boolean>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface McpMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const mcpServers: Map<string, McpServerState> = new Map();
let messageId = 1;

// 配置常量
const MCP_TIMEOUT = parseInt(process.env.MCP_TIMEOUT || '10000', 10); // 默认 10 秒超时（减少等待时间）
const RESOURCE_CACHE_TTL = 60000; // 资源缓存 1 分钟
const HEALTH_CHECK_INTERVAL = 30000; // 健康检查间隔 30 秒
const MAX_RECONNECT_ATTEMPTS = 3; // 最大重连次数
const RECONNECT_DELAY_BASE = 1000; // 重连延迟基数（毫秒）

/**
 * 注册 MCP 服务器配置
 *
 * @param name 服务器名称
 * @param config 服务器配置
 * @param preloadedTools 预加载的工具定义（可选，用于不需要连接就能发现的工具）
 */
export function registerMcpServer(
  name: string,
  config: McpServerConfig,
  preloadedTools?: McpToolDefinition[]
): void {
  mcpServers.set(name, {
    config,
    connected: false,
    connecting: false,
    reconnectAttempts: 0,
    capabilities: preloadedTools ? { tools: true } : {},
    tools: preloadedTools || [],
    resources: [],
  });
}

/**
 * 注销 MCP 服务器（从 mcpServers Map 中移除）
 * 用于禁用 MCP 服务器时彻底清除，防止 MCPSearchTool 仍能搜索到已禁用的工具
 */
export function unregisterMcpServer(name: string): void {
  mcpServers.delete(name);
}

/**
 * 获取所有已注册的 MCP 服务器
 */
export function getMcpServers(): Map<string, McpServerState> {
  return mcpServers;
}

/**
 * 延迟函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 优雅地终止 MCP 服务器进程
 *
 * 按照官方实现，使用 SIGINT -> SIGTERM -> SIGKILL 的优雅关闭序列
 * 这确保 MCP 服务器有机会清理资源并正常退出
 *
 * 注意：Windows 上的信号处理与 Unix 不同：
 * - SIGINT: Windows 上会终止进程（类似 Ctrl+C）
 * - SIGTERM: Windows 上等同于 SIGINT
 * - SIGKILL: Windows 上强制终止进程
 *
 * @param name 服务器名称
 * @param pid 进程 ID
 */
async function gracefullyTerminateProcess(name: string, pid: number): Promise<void> {
  const CLEANUP_TIMEOUT = 600; // 600ms 总超时
  const isWindows = process.platform === 'win32';

  return new Promise((resolve) => {
    let terminated = false;

    // 定期检查进程是否已退出
    const checkInterval = setInterval(() => {
      try {
        // process.kill(pid, 0) 不发送信号，只检查进程是否存在
        process.kill(pid, 0);
      } catch {
        // 进程不存在，已退出
        if (!terminated) {
          terminated = true;
          clearInterval(checkInterval);
          clearTimeout(cleanupTimeout);
          if (process.env.DEBUG) {
            console.log(`[MCP] ${name}: Process exited cleanly`);
          }
          resolve();
        }
      }
    }, 50);

    // 总超时，防止无限等待
    const cleanupTimeout = setTimeout(() => {
      if (!terminated) {
        terminated = true;
        clearInterval(checkInterval);
        if (process.env.DEBUG) {
          console.log(`[MCP] ${name}: Cleanup timeout reached, stopping process monitoring`);
        }
        resolve();
      }
    }, CLEANUP_TIMEOUT);

    // 开始优雅关闭序列
    (async () => {
      try {
        // Windows 上直接使用 SIGTERM 终止进程（Node.js 在 Windows 上会映射到 TerminateProcess）
        if (isWindows) {
          if (process.env.DEBUG) {
            console.log(`[MCP] ${name}: Terminating process (Windows)`);
          }
          try {
            // Windows 上 SIGTERM 会调用 TerminateProcess API
            process.kill(pid, 'SIGTERM');
          } catch (err) {
            if (process.env.DEBUG) {
              console.log(`[MCP] ${name}: Error terminating: ${err}`);
            }
          }
          return;
        }

        // Unix 系统使用标准的 SIGINT -> SIGTERM -> SIGKILL 序列
        // 1. 发送 SIGINT
        if (process.env.DEBUG) {
          console.log(`[MCP] ${name}: Sending SIGINT`);
        }
        try {
          process.kill(pid, 'SIGINT');
        } catch (err) {
          if (process.env.DEBUG) {
            console.log(`[MCP] ${name}: Error sending SIGINT: ${err}`);
          }
          return;
        }

        // 等待 100ms
        await sleep(100);
        if (terminated) return;

        // 2. 检查是否退出，如果没有发送 SIGTERM
        try {
          process.kill(pid, 0);
          if (process.env.DEBUG) {
            console.log(`[MCP] ${name}: SIGINT failed, sending SIGTERM`);
          }
          try {
            process.kill(pid, 'SIGTERM');
          } catch (err) {
            if (process.env.DEBUG) {
              console.log(`[MCP] ${name}: Error sending SIGTERM: ${err}`);
            }
            terminated = true;
            clearInterval(checkInterval);
            clearTimeout(cleanupTimeout);
            resolve();
            return;
          }
        } catch {
          // 进程已退出
          return;
        }

        // 等待 400ms
        await sleep(400);
        if (terminated) return;

        // 3. 检查是否退出，如果没有发送 SIGKILL
        try {
          process.kill(pid, 0);
          if (process.env.DEBUG) {
            console.log(`[MCP] ${name}: SIGTERM failed, sending SIGKILL`);
          }
          try {
            process.kill(pid, 'SIGKILL');
          } catch (err) {
            if (process.env.DEBUG) {
              console.log(`[MCP] ${name}: Error sending SIGKILL: ${err}`);
            }
          }
        } catch {
          // 进程已退出
          return;
        }
      } catch {
        // 忽略错误，让超时机制处理
      }
    })();
  });
}

/**
 * 断开 MCP 服务器连接
 *
 * 使用优雅关闭序列，确保 MCP 服务器进程被正确清理，
 * 防止出现孤儿进程
 */
export async function disconnectMcpServer(name: string): Promise<void> {
  const server = mcpServers.get(name);
  if (!server) return;

  if (server.process) {
    const pid = server.process.pid;
    if (pid) {
      try {
        // 使用优雅关闭序列
        await gracefullyTerminateProcess(name, pid);
      } catch (err) {
        console.error(`[MCP] Failed to gracefully terminate ${name}:`, err);
        // 如果优雅关闭失败，尝试强制 kill
        try {
          server.process.kill('SIGKILL');
        } catch {}
      }
    } else {
      // 没有 pid，直接 kill
      try {
        server.process.kill();
      } catch (err) {
        console.error(`[MCP] Failed to kill ${name}:`, err);
      }
    }
    server.process = undefined;
  }

  server.connected = false;
  server.connecting = false;
  server.reconnectAttempts = 0;
}

/**
 * 检查服务器健康状态
 */
async function checkServerHealth(name: string): Promise<boolean> {
  const server = mcpServers.get(name);
  if (!server || !server.connected) return false;

  const now = Date.now();
  if (server.lastHealthCheck && now - server.lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return true; // 最近检查过，认为是健康的
  }

  try {
    // 发送 ping 请求（如果服务器支持）
    const result = await sendMcpMessage(name, 'ping', {});
    server.lastHealthCheck = now;
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * 连接到 MCP 服务器（带重试机制）
 *
 * v2.1.9: 使用 connectionPromise 缓存机制防止重连挂起
 * 修复了缓存的连接 promise 永不 resolve 导致的问题
 */
export async function connectMcpServer(name: string, retry = true): Promise<boolean> {
  const server = mcpServers.get(name);
  if (!server) return false;

  // 如果已连接且健康，直接返回
  if (server.connected && server.process) {
    const healthy = await checkServerHealth(name);
    if (healthy) return true;

    // 不健康，需要重连 - 先清除缓存的 promise
    server.connectionPromise = undefined;
    await disconnectMcpServer(name);
  }

  // v2.1.9: 如果已有连接 Promise 在进行，复用它
  // 这样多个调用者可以共享同一个连接结果
  if (server.connectionPromise) {
    try {
      return await server.connectionPromise;
    } catch {
      // 如果缓存的 promise 失败了，清除它并继续创建新连接
      server.connectionPromise = undefined;
    }
  }

  // 创建新的连接 Promise 并缓存（带超时保护，防止永不 settle）
  const CONNECTION_TIMEOUT = 30000; // 30 秒
  let timeoutId: ReturnType<typeof setTimeout>;
  server.connectionPromise = Promise.race([
    doConnect(name, server, retry),
    new Promise<boolean>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`MCP connection to "${name}" timed out after ${CONNECTION_TIMEOUT}ms`)), CONNECTION_TIMEOUT);
    }),
  ]);

  try {
    return await server.connectionPromise;
  } finally {
    clearTimeout(timeoutId!);
    // 连接完成后清除缓存，允许后续重连
    server.connectionPromise = undefined;
  }
}

/**
 * v2.1.9: 实际执行连接的内部函数
 */
async function doConnect(name: string, server: McpServerState, retry: boolean): Promise<boolean> {
  server.connecting = true;
  server.lastConnectAttempt = Date.now();

  const { config } = server;

  if (config.type === 'stdio' && config.command) {
    let attempt = 0;
    const maxAttempts = retry ? MAX_RECONNECT_ATTEMPTS : 1;

    while (attempt < maxAttempts) {
      try {
        // 如果不是第一次尝试，等待一段时间（指数退避）
        if (attempt > 0) {
          const delay = RECONNECT_DELAY_BASE * Math.pow(2, attempt - 1);
          console.log(`Retrying connection to ${name} in ${delay}ms (attempt ${attempt + 1}/${maxAttempts})...`);
          await sleep(delay);
        }

        // Windows 上需要特殊处理，使用 cmd.exe 启动以避免 Git Bash 兼容性问题
        // Git Bash/MSYS2 环境下无法正确访问 Windows Named Pipes
        let spawnCommand: string;
        let spawnArgs: string[];
        const isWindows = process.platform === 'win32';

        if (isWindows && config.command !== 'cmd' && config.command !== 'cmd.exe') {
          // 将命令和参数组合成一个完整的命令行
          const fullCommand = [config.command, ...(config.args || [])].join(' ');
          spawnCommand = 'cmd';
          spawnArgs = ['/c', fullCommand];
        } else {
          spawnCommand = config.command;
          spawnArgs = config.args || [];
        }

        const proc = spawn(spawnCommand, spawnArgs, {
          env: { ...process.env, ...config.env },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: isWindows, // Windows 上使用 shell 以确保命令正确解析
        });

        server.process = proc;

        // 监听进程错误和退出
        let processExited = false;
        let processError: Error | null = null;

        proc.on('error', (err) => {
          console.error(`MCP server ${name} process error:`, err);
          processError = err;
          processExited = true;
          server.connected = false;
          server.connecting = false;
        });

        proc.on('exit', (code) => {
          console.log(`MCP server ${name} exited with code ${code}`);
          processExited = true;
          server.connected = false;
          server.connecting = false;
          server.process = undefined;
        });

        // 等待进程启动稳定 - 关键！
        // 如果进程在此期间退出，说明启动失败
        await sleep(500);

        // 检查进程是否已退出
        if (processExited) {
          const errorMsg = processError ? processError.message : 'Process exited during startup';
          console.error(`MCP server ${name} failed to start: ${errorMsg}`);
          continue; // 尝试下一次重试
        }

        // 确保 stdin/stdout 可用
        if (!proc.stdin || !proc.stdout) {
          console.error(`MCP server ${name} stdio not available`);
          proc.kill();
          server.process = undefined;
          continue;
        }

        // 发送初始化消息
        const initResult = await sendMcpMessage(name, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'claude-code-restored',
            version: '2.1.4',
          },
        });

        if (initResult) {
          server.connected = true;
          server.connecting = false;
          server.reconnectAttempts = 0;
          const initResponse = initResult as { capabilities?: { tools?: boolean; resources?: boolean; prompts?: boolean } };
          server.capabilities = initResponse.capabilities || {};

          // 发送 initialized 通知
          await sendMcpNotification(name, 'notifications/initialized', {});

          // 获取工具列表
          if (server.capabilities.tools) {
            const toolsResult = await sendMcpMessage(name, 'tools/list', {}) as { tools?: McpToolDefinition[] } | null;
            if (toolsResult?.tools) {
              server.tools = toolsResult.tools;
            }
          }

          // 获取资源列表（使用缓存）
          if (server.capabilities.resources) {
            await refreshResourceCache(name);
          }

          console.log(`Successfully connected to MCP server: ${name}`);
          return true;
        }

        // 初始化失败，清理进程
        if (server.process) {
          server.process.kill();
          server.process = undefined;
        }
      } catch (err) {
        console.error(`Failed to connect to MCP server ${name} (attempt ${attempt + 1}/${maxAttempts}):`, err);

        // 清理失败的进程
        if (server.process) {
          try {
            server.process.kill();
          } catch {}
          server.process = undefined;
        }
      }

      attempt++;
      server.reconnectAttempts = attempt;
    }
  }

  server.connecting = false;
  return false;
}

/**
 * 刷新资源缓存
 */
async function refreshResourceCache(name: string): Promise<boolean> {
  const server = mcpServers.get(name);
  if (!server) return false;

  try {
    const resourcesResult = await sendMcpMessage(name, 'resources/list', {}) as { resources?: McpResource[] } | null;
    if (resourcesResult?.resources) {
      server.resources = resourcesResult.resources;
      server.resourcesCache = {
        data: resourcesResult.resources,
        timestamp: Date.now(),
      };
      return true;
    }
  } catch (err) {
    console.error(`Failed to refresh resource cache for ${name}:`, err);
  }

  return false;
}

/**
 * 获取资源列表（带缓存）
 */
async function getResources(name: string, forceRefresh = false): Promise<McpResource[]> {
  const server = mcpServers.get(name);
  if (!server) return [];

  // 检查缓存是否有效
  if (!forceRefresh && server.resourcesCache) {
    const cacheAge = Date.now() - server.resourcesCache.timestamp;
    if (cacheAge < RESOURCE_CACHE_TTL) {
      return server.resourcesCache.data;
    }
  }

  // 刷新缓存
  await refreshResourceCache(name);
  return server.resources;
}

/**
 * 发送 MCP 消息并等待响应（带重试机制）
 */
async function sendMcpMessage(
  serverName: string,
  method: string,
  params: unknown,
  timeout = MCP_TIMEOUT,
  retries = 1 // 减少重试次数，让失败更快返回
): Promise<unknown | null> {
  const server = mcpServers.get(serverName);
  if (!server?.process?.stdin || !server.process.stdout) {
    return null;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 每次尝试前检查进程状态
      if (!server?.process?.stdin || !server.process.stdout) {
        // 尝试重新连接
        const reconnected = await connectMcpServer(serverName);
        if (!reconnected || !server?.process?.stdin || !server.process.stdout) {
          throw new Error(t('mcp.serverNotConnected', { name: serverName }));
        }
      }

      const id = messageId++;
      const message: McpMessage = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const result = await new Promise<unknown | null>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new Error(`Timeout waiting for response to ${method}`));
        }, timeout);

        // 再次检查，因为可能在等待期间断开
        if (!server.process?.stdout) {
          clearTimeout(timeoutHandle);
          reject(new Error(`MCP server ${serverName} disconnected`));
          return;
        }

        const onData = (data: Buffer) => {
          try {
            const lines = data.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              const response: McpMessage = JSON.parse(line);
              if (response.id === id) {
                clearTimeout(timeoutHandle);
                server.process?.stdout?.removeListener('data', onData);

                if (response.error) {
                  reject(new Error(response.error.message));
                } else {
                  resolve(response.result);
                }
                return;
              }
            }
          } catch (err) {
            // Ignore parse errors for partial messages
          }
        };

        server.process.stdout.on('data', onData);

        try {
          if (!server.process?.stdin) {
            clearTimeout(timeoutHandle);
            server.process?.stdout?.removeListener('data', onData);
            reject(new Error(`MCP server ${serverName} stdin not available`));
            return;
          }
          server.process.stdin.write(JSON.stringify(message) + '\n');
        } catch (err) {
          clearTimeout(timeoutHandle);
          server.process?.stdout?.removeListener('data', onData);
          reject(err);
        }
      });

      return result;
    } catch (err) {
      lastError = err as Error;
      console.error(`MCP message ${method} failed (attempt ${attempt + 1}/${retries + 1}):`, err);

      // 如果不是最后一次尝试，等待一小段时间再重试
      if (attempt < retries) {
        await sleep(500 * Math.pow(2, attempt));
      }
    }
  }

  // 所有重试都失败了
  if (lastError) {
    console.error(`All retries failed for MCP message ${method}:`, lastError);
  }

  return null;
}

/**
 * 发送 MCP 通知（无响应）
 */
async function sendMcpNotification(
  serverName: string,
  method: string,
  params: unknown
): Promise<void> {
  const server = mcpServers.get(serverName);
  if (!server?.process?.stdin) {
    return;
  }

  const message: McpMessage = {
    jsonrpc: '2.0',
    method,
    params,
  };

  server.process.stdin.write(JSON.stringify(message) + '\n');
}

/**
 * 调用 MCP 工具（带重试和错误处理）
 */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: unknown
): Promise<ToolResult> {
  const server = mcpServers.get(serverName);
  if (!server) {
    return {
      success: false,
      error: t('mcp.serverNotFound', { name: serverName, available: Array.from(mcpServers.keys()).join(', ') || 'none' })
    };
  }

  // 确保连接
  if (!server.connected) {
    const connected = await connectMcpServer(serverName);
    if (!connected) {
      return {
        success: false,
        error: t('mcp.connectFailed', { name: serverName })
      };
    }
  }

  // 检查服务器是否支持工具
  if (!server.capabilities.tools) {
    return {
      success: false,
      error: t('mcp.noToolSupport', { name: serverName })
    };
  }

  // 验证工具是否存在
  const toolExists = server.tools.some((tt) => tt.name === toolName);
  if (!toolExists) {
    return {
      success: false,
      error: t('mcp.toolNotFound', { name: toolName, available: server.tools.map((tt) => tt.name).join(', ') || 'none' })
    };
  }

  try {
    // 调用工具，带重试
    const result = await sendMcpMessage(serverName, 'tools/call', {
      name: toolName,
      arguments: args,
    });

    if (!result) {
      return {
        success: false,
        error: t('mcp.toolCallFailed', { tool: toolName })
      };
    }

    // 解析结果
    const content = (result as { content?: Array<{ type: string; text?: string; image?: string }> }).content;
    let output: string;

    if (content && Array.isArray(content)) {
      const textContent = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join('\n');

      output = textContent || JSON.stringify(result);
    } else {
      output = JSON.stringify(result, null, 2);
    }

    // 使用统一的输出持久化机制（MCP 工具特殊处理：基于 token 限制）
    const maxTokens = MAX_MCP_OUTPUT_TOKENS();
    const maxChars = maxTokens * 4; // 大约 4 字符/token

    const persistResult = persistLargeOutputSync(output, {
      toolName: 'MCP',
      maxLength: maxChars,
    });

    return { success: true, output: persistResult.content };
  } catch (err) {
    return {
      success: false,
      error: t('mcp.callError', { error: err instanceof Error ? err.message : 'Unknown error' })
    };
  }
}

/**
 * 断开所有 MCP 服务器
 */
export async function disconnectAllMcpServers(): Promise<void> {
  for (const name of mcpServers.keys()) {
    await disconnectMcpServer(name);
  }
}

/**
 * 获取服务器连接状态
 */
export function getServerStatus(name: string): {
  connected: boolean;
  connecting: boolean;
  capabilities: string[];
  toolCount: number;
  resourceCount: number;
  lastConnectAttempt?: number;
  reconnectAttempts: number;
} | null {
  const server = mcpServers.get(name);
  if (!server) return null;

  return {
    connected: server.connected,
    connecting: server.connecting,
    capabilities: Object.keys(server.capabilities).filter((k) => server.capabilities[k as keyof typeof server.capabilities]),
    toolCount: server.tools.length,
    resourceCount: server.resources.length,
    lastConnectAttempt: server.lastConnectAttempt,
    reconnectAttempts: server.reconnectAttempts,
  };
}

// ============ MCP Tool Search 自动模式常量（v2.1.7） ============

/**
 * MCP 工具描述阈值百分比（对齐官方 heB 常量）
 * 当 MCP 工具描述的字符数超过上下文窗口的 10% 时，启用延迟加载模式
 */
const MCP_TOOL_THRESHOLD_PERCENT = 0.1; // 10%

/**
 * 阈值乘数（对齐官方 At8 常量）
 * 实际阈值 = contextWindowSize * MCP_TOOL_THRESHOLD_PERCENT * MCP_THRESHOLD_MULTIPLIER
 * = contextWindowSize * 0.1 * 2.5 = contextWindowSize * 0.25 (25%)
 */
const MCP_THRESHOLD_MULTIPLIER = 2.5;

/**
 * 默认上下文窗口大小（tokens）
 * 对齐官方 VT9 常量
 */
const DEFAULT_CONTEXT_WINDOW = 200000;

/**
 * 1M 上下文窗口大小
 */
const LARGE_CONTEXT_WINDOW = 1000000;

/**
 * 不支持 tool_reference 的模型列表（对齐官方 Bt8 常量）
 * 这些模型不支持延迟加载模式
 */
const TOOL_SEARCH_UNSUPPORTED_MODELS = ['haiku'];

/**
 * MCP 模式类型
 * - 'tst': 强制启用 Tool Search（延迟加载）
 * - 'tst-auto': 自动判断（默认）
 * - 'mcp-cli': MCP CLI 模式
 * - 'standard': 标准模式（不延迟加载）
 */
export type McpMode = 'tst' | 'tst-auto' | 'mcp-cli' | 'standard';

/**
 * 获取上下文窗口大小（字符数）
 * 对齐官方 Jq 函数
 * @param model 模型名称
 * @param betas Beta 功能列表（可选）
 * @returns 上下文窗口大小（tokens）
 */
export function getContextWindowSize(model: string, betas?: string[]): number {
  // 检查是否是 1M 模型
  if (model.includes('[1m]') || (betas?.includes('max-tokens-1m') && model.includes('claude-sonnet-4-5'))) {
    return LARGE_CONTEXT_WINDOW;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

/**
 * 获取自动工具搜索阈值（字符数）
 * 对齐官方 geB 函数
 * @param model 模型名称
 * @returns 阈值（字符数）
 */
export function getAutoToolSearchCharThreshold(model: string): number {
  const contextWindow = getContextWindowSize(model);
  // 阈值 = 上下文窗口 * 10% * 2.5 = 上下文窗口 * 25%
  return Math.floor(contextWindow * MCP_TOOL_THRESHOLD_PERCENT * MCP_THRESHOLD_MULTIPLIER);
}

/**
 * 获取 MCP 模式（对齐官方 Qt8 / k9A 函数）
 * @returns MCP 模式
 */
export function getMcpMode(): McpMode {
  // 环境变量控制
  if (process.env.ENABLE_TOOL_SEARCH === 'auto') {
    return 'tst-auto';
  }
  if (process.env.ENABLE_TOOL_SEARCH === '1' || process.env.ENABLE_TOOL_SEARCH === 'true') {
    return 'tst';
  }
  if (process.env.ENABLE_MCP_CLI === '1' || process.env.ENABLE_MCP_CLI === 'true') {
    return 'mcp-cli';
  }
  if (process.env.ENABLE_MCP_CLI === '0' || process.env.ENABLE_MCP_CLI === 'false') {
    return 'standard';
  }
  if (process.env.ENABLE_TOOL_SEARCH === '0' || process.env.ENABLE_TOOL_SEARCH === 'false') {
    return 'standard';
  }
  // 默认使用自动模式
  return 'tst-auto';
}

/**
 * 检查模型是否支持 tool_reference 块
 * 对齐官方 ueB 函数
 * @param model 模型名称
 * @returns 是否支持
 */
export function modelSupportsToolReference(model: string): boolean {
  const modelLower = model.toLowerCase();
  for (const unsupported of TOOL_SEARCH_UNSUPPORTED_MODELS) {
    if (modelLower.includes(unsupported.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/**
 * 检查 MCPSearch 工具是否可用
 * 对齐官方 meB 函数
 * @param tools 工具列表
 * @returns 是否可用
 */
export function isMcpSearchToolAvailable(tools: Array<{ name: string }>): boolean {
  return tools.some((t) => t.name === 'Mcp');
}

/**
 * 计算所有 MCP 工具描述的字符数
 * 对齐官方 Zt8 函数
 * @returns 总字符数
 */
export function calculateMcpToolDescriptionChars(): number {
  let totalChars = 0;

  for (const server of mcpServers.values()) {
    for (const tool of server.tools) {
      // 计算工具描述的字符数
      // 官方实现调用 tool.prompt()，这里简化为使用 description
      const description = tool.description || '';
      const inputSchemaStr = JSON.stringify(tool.inputSchema || {});

      // 估算完整的工具 prompt 大小
      // 包括：工具名、描述、输入 schema
      const fullToolPrompt = `${tool.name}\n${description}\n${inputSchemaStr}`;
      totalChars += fullToolPrompt.length;
    }
  }

  return totalChars;
}

/**
 * 判断是否应该启用 MCP 工具搜索（延迟加载）
 * 对齐官方 RZ0 / isToolSearchEnabled 函数
 *
 * 逻辑：
 * 1. 检查模型是否支持 tool_reference 块
 * 2. 检查 MCPSearch 工具是否可用
 * 3. 根据 MCP 模式决定：
 *    - tst: 强制启用
 *    - tst-auto: 自动判断（MCP 工具描述超过阈值时启用）
 *    - mcp-cli/standard: 不启用
 *
 * @param model 模型名称
 * @param tools 工具列表
 * @returns 是否启用延迟加载
 */
export function isToolSearchEnabled(model: string, tools: Array<{ name: string }>): boolean {
  const mcpToolCount = Array.from(mcpServers.values()).reduce((sum, s) => sum + s.tools.length, 0);

  // 1. 检查模型是否支持 tool_reference 块
  if (!modelSupportsToolReference(model)) {
    if (process.env.DEBUG) {
      console.log(`[MCP] Tool search disabled for model '${model}': model does not support tool_reference blocks.`);
    }
    return false;
  }

  // 2. 检查 Mcp 工具是否可用
  if (!isMcpSearchToolAvailable(tools)) {
    if (process.env.DEBUG) {
      console.log('[MCP] Tool search disabled: Mcp tool is not available (may have been disallowed via disallowedTools).');
    }
    return false;
  }

  // 3. 根据 MCP 模式决定
  const mode = getMcpMode();

  switch (mode) {
    case 'tst':
      // 强制启用
      if (process.env.DEBUG) {
        console.log(`[MCP] Tool search enabled (tst mode), mcpToolCount=${mcpToolCount}`);
      }
      return true;

    case 'tst-auto': {
      // 自动判断：计算 MCP 工具描述总字符数
      const mcpToolDescriptionChars = calculateMcpToolDescriptionChars();
      const threshold = getAutoToolSearchCharThreshold(model);
      const enabled = mcpToolDescriptionChars >= threshold;

      if (process.env.DEBUG) {
        console.log(`[MCP] Auto tool search ${enabled ? 'enabled' : 'disabled'}: ${mcpToolDescriptionChars} chars (threshold: ${threshold}, ${Math.round(MCP_TOOL_THRESHOLD_PERCENT * 100)}% of context)`);
      }

      return enabled;
    }

    case 'mcp-cli':
    case 'standard':
      // 不启用
      if (process.env.DEBUG) {
        console.log(`[MCP] Tool search disabled (${mode} mode)`);
      }
      return false;
  }
}

/**
 * 乐观检查是否启用工具搜索（不进行实际计算）
 * 对齐官方 Zd / isToolSearchEnabledOptimistic 函数
 * @returns 是否可能启用
 */
export function isToolSearchEnabledOptimistic(): boolean {
  const mode = getMcpMode();
  switch (mode) {
    case 'tst':
    case 'tst-auto':
      return true;
    case 'mcp-cli':
    case 'standard':
      return false;
  }
}

/**
 * 生成 MCPSearch 工具的动态描述（对齐官方 F9A 函数）
 * 包含所有可用的 MCP 工具列表
 * @param tools MCP 工具列表
 * @returns 描述字符串
 */
export function generateMcpSearchDescription(tools: Array<{ name: string }>): string {
  const baseDescription = `Search for or select MCP tools to make them available for use.

**MANDATORY PREREQUISITE - THIS IS A HARD REQUIREMENT**

You MUST use this tool to load MCP tools BEFORE calling them directly.

This is a BLOCKING REQUIREMENT - MCP tools listed below are NOT available until you load them using this tool.

**Why this is non-negotiable:**
- MCP tools are deferred and not loaded until discovered via this tool
- Calling an MCP tool without first loading it will fail

**Query modes:**

1. **Direct selection** - Use \`select:<tool_name>\` when you know exactly which tool you need:
   - "select:mcp__slack__read_channel"
   - "select:mcp__filesystem__list_directory"
   - Returns just that tool if it exists

2. **Keyword search** - Use keywords when you're unsure which tool to use:
   - "list directory" - find tools for listing directories
   - "read file" - find tools for reading files
   - "slack message" - find slack messaging tools
   - Returns up to 5 matching tools ranked by relevance

**CORRECT Usage Patterns:**

<example>
User: List files in the src directory
Assistant: I can see mcp__filesystem__list_directory in the available tools. Let me select it.
[Calls MCPSearch with query: "select:mcp__filesystem__list_directory"]
[Calls the MCP tool]
</example>

<example>
User: I need to work with slack somehow
Assistant: Let me search for slack tools.
[Calls MCPSearch with query: "slack"]
Assistant: Found several options including mcp__slack__read_channel.
[Calls the MCP tool]
</example>

**INCORRECT Usage Pattern - NEVER DO THIS:**

<bad-example>
User: Read my slack messages
Assistant: [Directly calls mcp__slack__read_channel without loading it first]
WRONG - You must load the tool FIRST using this tool
</bad-example>`;

  // 如果有 MCP 工具，添加可用工具列表
  if (tools.length > 0) {
    const toolList = tools.map((t) => t.name).join('\n');
    return `${baseDescription}

Available MCP tools (must be loaded before use):
${toolList}`;
  }

  return baseDescription;
}

// ============ MCP Search 工具 ============

/**
 * MCP工具搜索工具 - 用于查找和加载MCP工具
 * 这是官方强制要求的工具，必须在调用MCP工具前使用
 */
export class MCPSearchTool extends BaseTool<MCPSearchInput, MCPSearchToolResult> {
  name = 'Mcp';

  /**
   * 已配置但被禁用的 MCP 服务器名称列表
   * 由外部（conversation.ts）在初始化和状态变更时更新
   * 当搜索无结果时用于提示用户可以启用哪些服务器
   */
  static disabledServers: string[] = [];

  // 静态描述（不包含工具列表）
  private static baseDescription = `Search for or select MCP tools to make them available for use.

**MANDATORY PREREQUISITE - THIS IS A HARD REQUIREMENT**

You MUST use this tool to load MCP tools BEFORE calling them directly.

This is a BLOCKING REQUIREMENT - MCP tools listed below are NOT available until you load them using this tool.

**Why this is non-negotiable:**
- MCP tools are deferred and not loaded until discovered via this tool
- Calling an MCP tool without first loading it will fail

**Query modes:**

1. **Direct selection** - Use \`select:<tool_name>\` when you know exactly which tool you need:
   - "select:mcp__slack__read_channel"
   - "select:mcp__filesystem__list_directory"
   - Returns just that tool if it exists

2. **Keyword search** - Use keywords when you're unsure which tool to use:
   - "list directory" - find tools for listing directories
   - "read file" - find tools for reading files
   - "slack message" - find slack messaging tools
   - Returns up to 5 matching tools ranked by relevance

**CORRECT Usage Patterns:**

<example>
User: List files in the src directory
Assistant: I can see mcp__filesystem__list_directory in the available tools. Let me select it.
[Calls MCPSearch with query: "select:mcp__filesystem__list_directory"]
[Calls the MCP tool]
</example>

<example>
User: I need to work with slack somehow
Assistant: Let me search for slack tools.
[Calls MCPSearch with query: "slack"]
Assistant: Found several options including mcp__slack__read_channel.
[Calls the MCP tool]
</example>

**INCORRECT Usage Pattern - NEVER DO THIS:**

<bad-example>
User: Read my slack messages
Assistant: [Directly calls mcp__slack__read_channel without loading it first]
WRONG - You must load the tool FIRST using this tool
</bad-example>`;

  /**
   * 获取动态描述（包含可用工具列表）
   */
  get description(): string {
    // 生成可用工具列表
    const tools: string[] = [];
    for (const [serverName, server] of mcpServers) {
      for (const tool of server.tools) {
        tools.push(`mcp__${serverName}__${tool.name}`);
      }
    }

    const disabled = MCPSearchTool.disabledServers;
    const disabledHint = disabled.length > 0
      ? `\n\nDisabled MCP servers (use McpManage to enable):\n${disabled.join('\n')}`
      : '';

    if (tools.length > 0) {
      return `${MCPSearchTool.baseDescription}

Available MCP tools (must be loaded before use):
${tools.join('\n')}${disabledHint}`;
    }

    if (disabledHint) {
      return `${MCPSearchTool.baseDescription}${disabledHint}`;
    }

    return MCPSearchTool.baseDescription;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query to find MCP tools. Use "select:<tool_name>" for direct selection, or keywords to search.',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5)',
        },
      },
      required: ['query'],
    };
  }

  /**
   * 获取所有可用的MCP工具列表
   */
  private getAvailableMcpTools(): string {
    const tools: string[] = [];
    for (const [serverName, server] of mcpServers) {
      for (const tool of server.tools) {
        tools.push(`mcp__${serverName}__${tool.name}`);
      }
    }
    return tools.join('\n');
  }

  /**
   * 获取禁用服务器的提示信息
   * 当搜索无结果且有禁用服务器时，提示用户可以用 McpManage 启用
   */
  private getDisabledServersHint(): string {
    const disabled = MCPSearchTool.disabledServers;
    if (disabled.length === 0) return '';
    return `\n\nNote: The following MCP servers are installed but DISABLED. Use the McpManage tool with action="enable" to activate them:\n${disabled.map(s => `- ${s}`).join('\n')}`;
  }

  /**
   * 执行关键词搜索
   */
  private async keywordSearch(query: string, maxResults: number): Promise<string[]> {
    const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 0);
    const results: Array<{ name: string; score: number }> = [];

    for (const [serverName, server] of mcpServers) {
      for (const tool of server.tools) {
        const fullName = `mcp__${serverName}__${tool.name}`;
        const searchableName = fullName.toLowerCase().replace(/__/g, ' ');
        const searchableDesc = tool.description.toLowerCase();

        let score = 0;
        for (const keyword of keywords) {
          // 完全匹配工具名
          if (searchableName === keyword) {
            score += 10;
          }
          // 工具名包含关键词
          else if (searchableName.includes(keyword)) {
            score += 5;
          }
          // 描述包含关键词
          if (searchableDesc.includes(keyword)) {
            score += 2;
          }
        }

        if (score > 0) {
          results.push({ name: fullName, score });
        }
      }
    }

    // 按分数排序并返回前N个
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((r) => r.name);
  }

  async execute(input: MCPSearchInput): Promise<MCPSearchToolResult> {
    const { query, max_results = 5 } = input;

    // 获取所有MCP工具数量
    let totalMcpTools = 0;
    for (const server of mcpServers.values()) {
      totalMcpTools += server.tools.length;
    }

    // 检查是否是 select: 语法
    const selectMatch = query.match(/^select:(.+)$/i);
    if (selectMatch) {
      const toolName = selectMatch[1].trim();

      // 验证工具是否存在
      let found = false;
      for (const [serverName, server] of mcpServers) {
        for (const tool of server.tools) {
          const fullName = `mcp__${serverName}__${tool.name}`;
          if (fullName === toolName) {
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        return {
          success: true,
          output: `${t('mcp.toolNotFound', { name: toolName, available: '' })}\n\nAvailable tools:\n${this.getAvailableMcpTools()}${this.getDisabledServersHint()}`,
          matches: [],
          query,
          total_mcp_tools: totalMcpTools,
        };
      }

      return {
        success: true,
        output: t('mcp.toolSelected', { name: toolName }),
        matches: [toolName],
        query,
        total_mcp_tools: totalMcpTools,
      };
    }

    // 关键词搜索
    const matches = await this.keywordSearch(query, max_results);

    if (matches.length === 0) {
      return {
        success: true,
        output: `${t('mcp.noMatchingTools', { query })}\n\nAvailable tools:\n${this.getAvailableMcpTools()}${this.getDisabledServersHint()}`,
        matches: [],
        query,
        total_mcp_tools: totalMcpTools,
      };
    }

    const output = `Found ${matches.length} MCP tool${matches.length === 1 ? '' : 's'} matching "${query}":\n\n${matches.map((m, i) => `${i + 1}. ${m}`).join('\n')}\n\nThese tools are now loaded and ready to use.`;

    return {
      success: true,
      output,
      matches,
      query,
      total_mcp_tools: totalMcpTools,
    };
  }
}

// ============ MCP 工具类 ============

export class McpTool extends BaseTool<McpInput, ToolResult> {
  private serverName: string;
  private toolName: string;
  private toolDescription: string;
  private toolInputSchema: Record<string, unknown>;

  constructor(serverName: string, toolDef: McpToolDefinition) {
    // MCP 工具启用重试机制
    super({
      maxRetries: 3,
      baseTimeout: 300000, // 5分钟超时
      retryableErrors: [
        4000, // NETWORK_CONNECTION_FAILED
        4001, // NETWORK_TIMEOUT
        4005, // NETWORK_RATE_LIMITED
      ],
    });
    this.serverName = serverName;
    this.toolName = toolDef.name;
    this.toolDescription = toolDef.description;
    this.toolInputSchema = toolDef.inputSchema;
  }

  get name(): string {
    return `mcp__${this.serverName}__${this.toolName}`;
  }

  get description(): string {
    return this.toolDescription;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return this.toolInputSchema as ToolDefinition['inputSchema'];
  }

  async execute(input: McpInput): Promise<ToolResult> {
    // 使用重试和超时包装器
    return this.executeWithRetryAndTimeout(async () => {
      return callMcpTool(this.serverName, this.toolName, input);
    });
  }
}

/**
 * 创建 MCP 服务器的所有工具
 */
export async function createMcpTools(serverName: string): Promise<McpTool[]> {
  const server = mcpServers.get(serverName);
  if (!server) return [];

  if (!server.connected) {
    await connectMcpServer(serverName);
  }

  return server.tools.map((tool) => new McpTool(serverName, tool));
}

/**
 * 将预加载的 MCP 工具直接注册到 ToolRegistry
 *
 * 这允许在不连接 MCP 服务器的情况下注册工具，
 * 工具会在实际调用时才尝试连接服务器。
 *
 * @param serverName MCP 服务器名称
 * @param tools 预加载的工具定义
 * @param registry ToolRegistry 实例
 */
export function registerMcpToolsToRegistry(
  serverName: string,
  tools: McpToolDefinition[],
  registry: ToolRegistry
): void {
  for (const toolDef of tools) {
    const mcpTool = new McpTool(serverName, toolDef);
    registry.register(mcpTool);
  }
}

// ============ MCP Resource 工具 ============

/**
 * 列出 MCP 资源工具
 * 列出已配置 MCP 服务器中的可用资源
 */
export class ListMcpResourcesTool extends BaseTool<ListMcpResourcesInput, ToolResult> {
  name = 'ListMcpResources';

  description = `List available resources from configured MCP servers.
Each resource object includes a 'server' field indicating which server it's from.

Usage examples:
- List all resources from all servers: \`listMcpResources\`
- List resources from a specific server: \`listMcpResources({ server: "myserver" })\`

List available resources from configured MCP servers.
Each returned resource will include all standard MCP resource fields plus a 'server' field
indicating which server the resource belongs to.

Parameters:
- server (optional): The name of a specific MCP server to get resources from. If not provided,
  resources from all servers will be returned.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Optional server name to filter resources by',
        },
        refresh: {
          type: 'boolean',
          description: 'Whether to refresh the resource list from the server',
        },
      },
      required: [],
    };
  }

  async execute(input: ListMcpResourcesInput): Promise<ToolResult> {
    const { server, refresh = false } = input;

    const results: Array<{
      server: string;
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    }> = [];

    // 确定要查询的服务器列表
    const serversToQuery: string[] = [];
    if (server) {
      if (!mcpServers.has(server)) {
        return {
          success: false,
          error: t('mcp.serverNotFound', { name: server, available: Array.from(mcpServers.keys()).join(', ') || 'none' }),
        };
      }
      serversToQuery.push(server);
    } else {
      serversToQuery.push(...mcpServers.keys());
    }

    // 遍历服务器获取资源
    for (const serverName of serversToQuery) {
      const serverState = mcpServers.get(serverName);
      if (!serverState) continue;

      // 确保服务器已连接
      if (!serverState.connected) {
        const connected = await connectMcpServer(serverName);
        if (!connected) {
          console.error(`Failed to connect to MCP server: ${serverName}`);
          continue;
        }
      }

      // 检查服务器是否支持资源
      if (!serverState.capabilities.resources) {
        continue;
      }

      // 获取资源列表（可选刷新缓存）
      let resources: McpResource[];
      if (refresh) {
        await refreshResourceCache(serverName);
        resources = serverState.resources;
      } else {
        // 检查缓存
        if (serverState.resourcesCache && Date.now() - serverState.resourcesCache.timestamp < RESOURCE_CACHE_TTL) {
          resources = serverState.resourcesCache.data;
        } else {
          await refreshResourceCache(serverName);
          resources = serverState.resources;
        }
      }

      // 添加服务器信息到每个资源
      for (const resource of resources) {
        results.push({
          server: serverName,
          ...resource,
        });
      }
    }

    if (results.length === 0) {
      return {
        success: true,
        output: server
          ? `No resources found for server: ${server}`
          : 'No resources found from any MCP server.',
      };
    }

    const output = results
      .map((r) => `[${r.server}] ${r.name}: ${r.uri}${r.description ? ` - ${r.description}` : ''}`)
      .join('\n');

    return {
      success: true,
      output: `${t('mcp.resourcesFound', { count: results.length })}:\n\n${output}`,
    };
  }
}

/**
 * 读取 MCP 资源工具
 * 从 MCP 服务器读取特定资源
 */
export class ReadMcpResourceTool extends BaseTool<ReadMcpResourceInput, ToolResult> {
  name = 'ReadMcpResource';

  description = `Reads a specific resource from an MCP server.
- server: The name of the MCP server to read from
- uri: The URI of the resource to read

Usage examples:
- Read a resource from a server: \`readMcpResource({ server: "myserver", uri: "my-resource-uri" })\`

Reads a specific resource from an MCP server, identified by server name and resource URI.

Parameters:
- server (required): The name of the MCP server from which to read the resource
- uri (required): The URI of the resource to read`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'The MCP server name',
        },
        uri: {
          type: 'string',
          description: 'The resource URI to read',
        },
      },
      required: ['server', 'uri'],
    };
  }

  async execute(input: ReadMcpResourceInput): Promise<ToolResult> {
    const { server, uri } = input;

    // 验证服务器存在
    const serverState = mcpServers.get(server);
    if (!serverState) {
      return {
        success: false,
        error: t('mcp.resourceServerNotFound', { name: server, available: Array.from(mcpServers.keys()).join(', ') || 'none' }),
      };
    }

    // 确保服务器已连接
    if (!serverState.connected) {
      const connected = await connectMcpServer(server);
      if (!connected) {
        return {
          success: false,
          error: t('mcp.resourceConnectFailed', { name: server }),
        };
      }
    }

    // 检查服务器是否支持资源
    if (!serverState.capabilities.resources) {
      return {
        success: false,
        error: t('mcp.noResourceSupport', { name: server }),
      };
    }

    try {
      // 调用 resources/read
      const result = await sendMcpMessage(server, 'resources/read', {
        uri,
      });

      if (!result) {
        return {
          success: false,
          error: t('mcp.resourceReadFailed', { uri, server }),
        };
      }

      // 解析结果
      const resourceResult = result as {
        contents?: Array<{
          uri: string;
          mimeType?: string;
          text?: string;
          blob?: string;
        }>;
      };

      if (!resourceResult.contents || resourceResult.contents.length === 0) {
        return {
          success: false,
          error: t('mcp.resourceNotFound', { uri }),
        };
      }

      // 处理内容
      const contents = resourceResult.contents;
      let output = '';

      for (const content of contents) {
        if (content.text) {
          output += content.text;
        } else if (content.blob) {
          // 对于二进制内容，返回 base64 信息
          output += `[Binary content: ${content.mimeType || 'application/octet-stream'}, ${content.blob.length} bytes (base64)]`;
        }
      }

      // 使用统一的输出持久化机制
      const maxTokens = MAX_MCP_OUTPUT_TOKENS();
      const maxChars = maxTokens * 4;

      const persistResult = persistLargeOutputSync(output, {
        toolName: 'ReadMcpResource',
        maxLength: maxChars,
      });

      return { success: true, output: persistResult.content };
    } catch (err) {
      return {
        success: false,
        error: t('mcp.resourceReadError', { error: err instanceof Error ? err.message : 'Unknown error' }),
      };
    }
  }
}

// ============ 合并的 MCP Resource 工具 ============

/**
 * 合并的 MCP 资源工具
 * 替代 ListMcpResourcesTool 和 ReadMcpResourceTool
 */
export class McpResourceTool extends BaseTool<McpResourceInput, ToolResult> {
  name = 'McpResource';

  description = `List available resources from configured MCP servers or read a specific resource.

Parameters:
- action (required): 'list' or 'read'
- server (optional for list, required for read): MCP server name
- uri (required for read): The resource URI to read
- refresh (optional, for list): Whether to refresh the resource list`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'read'],
          description: 'Action to perform: list available resources or read a specific resource',
        },
        server: {
          type: 'string',
          description: 'MCP server name (optional for list, required for read)',
        },
        uri: {
          type: 'string',
          description: 'The resource URI to read (required for action=read)',
        },
        refresh: {
          type: 'boolean',
          description: 'Whether to refresh the resource list from the server (for action=list)',
        },
      },
      required: ['action'],
    };
  }

  private listTool = new ListMcpResourcesTool();
  private readTool = new ReadMcpResourceTool();

  async execute(input: McpResourceInput): Promise<ToolResult> {
    if (input.action === 'list') {
      return this.listTool.execute({
        server: input.server,
        refresh: input.refresh,
      });
    }

    if (input.action === 'read') {
      if (!input.server || !input.uri) {
        return {
          success: false,
          error: t('mcp.serverAndUriRequired'),
        };
      }
      return this.readTool.execute({
        server: input.server,
        uri: input.uri,
      });
    }

    return {
      success: false,
      error: t('mcp.unknownAction', { action: input.action }),
    };
  }
}
