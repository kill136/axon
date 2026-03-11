/**
 * MCP 服务器发现系统
 *
 * 功能:
 * 1. 从多个配置源加载 MCP 服务器
 * 2. 自动发现本地安装的 MCP 服务器
 * 3. 探测服务器能力 (工具、资源、提示词)
 * 4. 动态注册和管理服务器
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { homedir } from 'os';
import type { McpServerConfig } from '../types/index.js';
import { VERSION } from '../version.js';

// ============ 类型定义 ============

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpCapabilities {
  tools: ToolDefinition[];
  resources: ResourceDefinition[];
  prompts: PromptDefinition[];
}

export type ServerStatus = 'available' | 'connected' | 'error' | 'unknown';

export interface McpServerInfo {
  name: string;
  type: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  capabilities: McpCapabilities;
  status: ServerStatus;
  error?: string;
  source?: 'config' | 'local' | 'global' | 'manual';
}


interface McpMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

// ============ 常量配置 ============

const CONFIG_PATHS = {
  user: path.join(homedir(), '.axon', 'settings.json'),
  project: path.join(process.cwd(), '.axon', 'settings.json'),
};

const DISCOVERY_TIMEOUT = 5000; // 5秒探测超时
const MESSAGE_TIMEOUT = 3000; // 3秒消息超时

// 常见的 MCP 服务器包名
const KNOWN_MCP_PACKAGES = [
  '@modelcontextprotocol/server-filesystem',
  '@modelcontextprotocol/server-github',
  '@modelcontextprotocol/server-gitlab',
  '@modelcontextprotocol/server-google-drive',
  '@modelcontextprotocol/server-postgres',
  '@modelcontextprotocol/server-sqlite',
  '@modelcontextprotocol/server-puppeteer',
  '@modelcontextprotocol/server-brave-search',
  '@modelcontextprotocol/server-memory',
  '@modelcontextprotocol/server-fetch',
  '@anthropic-ai/mcp-server-filesystem',
  '@anthropic-ai/mcp-server-github',
];

// ============ MCP Discovery 类 ============

export class McpDiscovery {
  private servers: Map<string, McpServerInfo> = new Map();
  private configPaths: string[];
  private messageId = 0;

  constructor(configPaths?: string[]) {
    this.configPaths = configPaths || Object.values(CONFIG_PATHS);
  }

  /**
   * 发现所有可用的 MCP 服务器
   */
  async discover(): Promise<McpServerInfo[]> {
    const discovered: McpServerInfo[] = [];

    // 1. 从配置文件发现
    const fromConfig = await this.discoverFromConfig();
    discovered.push(...fromConfig);

    // 2. 从本地 node_modules 发现
    const fromLocal = await this.discoverLocal();
    discovered.push(...fromLocal);

    // 3. 从全局包发现
    const fromGlobal = await this.discoverGlobal();
    discovered.push(...fromGlobal);

    // 去重 (优先级: config > local > global)
    const uniqueServers = new Map<string, McpServerInfo>();
    for (const server of discovered) {
      if (!uniqueServers.has(server.name)) {
        uniqueServers.set(server.name, server);
      } else {
        const existing = uniqueServers.get(server.name)!;
        // 配置文件的优先级最高
        if (server.source === 'config' && existing.source !== 'config') {
          uniqueServers.set(server.name, server);
        }
      }
    }

    // 更新内部注册表
    for (const [name, info] of uniqueServers) {
      this.servers.set(name, info);
    }

    return Array.from(uniqueServers.values());
  }

  /**
   * 从配置文件发现服务器
   */
  async discoverFromConfig(): Promise<McpServerInfo[]> {
    const servers: McpServerInfo[] = [];

    for (const configPath of this.configPaths) {
      try {
        if (!fs.existsSync(configPath)) {
          continue;
        }

        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);

        if (!config.mcpServers || typeof config.mcpServers !== 'object') {
          continue;
        }

        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          if (!validateMcpConfig(serverConfig)) {
            console.warn(`Invalid MCP server config for "${name}" in ${configPath}`);
            continue;
          }

          const info: McpServerInfo = {
            name,
            type: serverConfig.type,
            command: serverConfig.command,
            args: serverConfig.args,
            url: serverConfig.url,
            env: serverConfig.env,
            headers: serverConfig.headers,
            capabilities: {
              tools: [],
              resources: [],
              prompts: [],
            },
            status: 'available',
            source: 'config',
          };

          // 探测服务器能力
          try {
            const capabilities = await this.probeServer(info);
            info.capabilities = capabilities;
            info.status = 'available';
          } catch (err) {
            info.status = 'error';
            info.error = err instanceof Error ? err.message : 'Unknown error';
          }

          servers.push(info);
        }
      } catch (err) {
        console.warn(`Failed to read MCP config from ${configPath}:`, err);
      }
    }

    return servers;
  }

  /**
   * 从本地 node_modules 发现服务器
   */
  async discoverLocal(): Promise<McpServerInfo[]> {
    const servers: McpServerInfo[] = [];
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');

    if (!fs.existsSync(nodeModulesPath)) {
      return servers;
    }

    for (const packageName of KNOWN_MCP_PACKAGES) {
      const packagePath = path.join(nodeModulesPath, packageName);
      if (fs.existsSync(packagePath)) {
        try {
          const packageJson = JSON.parse(
            fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8')
          );

          const serverName = this.extractServerName(packageName);
          const info: McpServerInfo = {
            name: serverName,
            type: 'stdio',
            command: 'npx',
            args: ['-y', packageName],
            capabilities: {
              tools: [],
              resources: [],
              prompts: [],
            },
            status: 'available',
            source: 'local',
          };

          servers.push(info);
        } catch (err) {
          // 忽略无效的包
        }
      }
    }

    return servers;
  }

  /**
   * 从全局 npm 包发现服务器
   */
  async discoverGlobal(): Promise<McpServerInfo[]> {
    const servers: McpServerInfo[] = [];

    try {
      // 获取全局 node_modules 路径
      const { execSync } = await import('child_process');
      const globalPath = execSync('npm root -g', { encoding: 'utf-8' }).trim();

      if (!fs.existsSync(globalPath)) {
        return servers;
      }

      for (const packageName of KNOWN_MCP_PACKAGES) {
        const packagePath = path.join(globalPath, packageName);
        if (fs.existsSync(packagePath)) {
          const serverName = this.extractServerName(packageName);
          const info: McpServerInfo = {
            name: serverName,
            type: 'stdio',
            command: 'npx',
            args: ['-y', packageName],
            capabilities: {
              tools: [],
              resources: [],
              prompts: [],
            },
            status: 'available',
            source: 'global',
          };

          servers.push(info);
        }
      }
    } catch (err) {
      // npm 可能不可用，忽略
    }

    return servers;
  }

  /**
   * 探测服务器能力
   */
  async probeServer(info: McpServerInfo): Promise<McpCapabilities> {
    if (info.type === 'stdio' && info.command) {
      return this.probeStdioServer(info);
    } else if (info.type === 'http' || info.type === 'sse') {
      return this.probeHttpServer(info);
    }

    return {
      tools: [],
      resources: [],
      prompts: [],
    };
  }

  /**
   * 探测 stdio 服务器
   */
  private async probeStdioServer(info: McpServerInfo): Promise<McpCapabilities> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Server probe timeout'));
      }, DISCOVERY_TIMEOUT);

      let childProcess: ChildProcess | null = null;
      let resolved = false;

      const cleanup = () => {
        clearTimeout(timeout);
        if (childProcess && !childProcess.killed) {
          childProcess.kill();
        }
      };

      const resolveOnce = (capabilities: McpCapabilities) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(capabilities);
        }
      };

      const rejectOnce = (err: Error) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      };

      try {
        const spawnEnv = { ...(globalThis.process.env as Record<string, string>), ...info.env };
        childProcess = spawn(info.command!, info.args || [], {
          env: spawnEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const capabilities: McpCapabilities = {
          tools: [],
          resources: [],
          prompts: [],
        };

        let initDone = false;

        childProcess.on('error', (err) => {
          rejectOnce(new Error(`Process error: ${err.message}`));
        });

        childProcess.on('exit', (code) => {
          if (!initDone) {
            rejectOnce(new Error(`Process exited with code ${code}`));
          }
        });

        // 收集输出
        const outputChunks: Buffer[] = [];
        childProcess.stdout?.on('data', (data: Buffer) => {
          outputChunks.push(data);

          // 尝试解析每一行
          const lines = Buffer.concat(outputChunks).toString().split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const response: McpMessage = JSON.parse(line);

              // 初始化响应
              if (response.result && typeof response.result === 'object') {
                const result = response.result as {
                  capabilities?: {
                    tools?: { listChanged?: boolean };
                    resources?: { listChanged?: boolean };
                    prompts?: { listChanged?: boolean };
                  };
                };

                initDone = true;

                // 请求工具列表
                if (result.capabilities?.tools) {
                  this.sendMessage(childProcess, 'tools/list', {});
                }

                // 请求资源列表
                if (result.capabilities?.resources) {
                  this.sendMessage(childProcess, 'resources/list', {});
                }

                // 请求提示词列表
                if (result.capabilities?.prompts) {
                  this.sendMessage(childProcess, 'prompts/list', {});
                }
              }

              // 工具列表响应
              if (response.result && (response.result as any).tools) {
                capabilities.tools = (response.result as any).tools;
              }

              // 资源列表响应
              if (response.result && (response.result as any).resources) {
                capabilities.resources = (response.result as any).resources;
              }

              // 提示词列表响应
              if (response.result && (response.result as any).prompts) {
                capabilities.prompts = (response.result as any).prompts;
              }

              // 如果已经获取了所有信息，返回
              if (initDone) {
                // 给一点时间让其他响应到达
                setTimeout(() => {
                  resolveOnce(capabilities);
                }, 500);
              }
            } catch {
              // 忽略解析错误，可能是不完整的消息
            }
          }
        });

        // 发送初始化消息
        this.sendMessage(childProcess, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'claude-code-discovery',
            version: VERSION,
          },
        });
      } catch (err) {
        rejectOnce(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 探测 HTTP/SSE 服务器
   */
  private async probeHttpServer(info: McpServerInfo): Promise<McpCapabilities> {
    // HTTP/SSE 服务器探测 - 简化实现
    // 实际场景中需要发送 HTTP 请求
    return {
      tools: [],
      resources: [],
      prompts: [],
    };
  }

  /**
   * 发送 MCP 消息
   */
  private sendMessage(process: ChildProcess, method: string, params: unknown): void {
    if (!process.stdin) return;

    const message: McpMessage = {
      jsonrpc: '2.0',
      id: ++this.messageId,
      method,
      params,
    };

    try {
      process.stdin.write(JSON.stringify(message) + '\n');
    } catch {
      // 忽略写入错误
    }
  }

  /**
   * 注册新服务器
   */
  async register(info: McpServerInfo): Promise<void> {
    // 验证配置
    if (!validateMcpConfig(info)) {
      throw new Error('Invalid MCP server configuration');
    }

    // 探测能力
    try {
      const capabilities = await this.probeServer(info);
      info.capabilities = capabilities;
      info.status = 'available';
    } catch (err) {
      info.status = 'error';
      info.error = err instanceof Error ? err.message : 'Unknown error';
    }

    // 添加到注册表
    this.servers.set(info.name, info);

    // 可选: 保存到配置文件
    if (info.source === 'manual') {
      await this.saveToConfig(info);
    }
  }

  /**
   * 注销服务器
   */
  async unregister(name: string): Promise<boolean> {
    if (!this.servers.has(name)) {
      return false;
    }

    this.servers.delete(name);

    // 可选: 从配置文件移除
    await this.removeFromConfig(name);

    return true;
  }

  /**
   * 获取所有服务器
   */
  getServers(): McpServerInfo[] {
    return Array.from(this.servers.values());
  }

  /**
   * 获取指定服务器
   */
  getServer(name: string): McpServerInfo | undefined {
    return this.servers.get(name);
  }

  /**
   * 保存服务器到配置文件
   */
  private async saveToConfig(info: McpServerInfo): Promise<void> {
    const configPath = CONFIG_PATHS.user;

    try {
      // 确保目录存在
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 读取现有配置
      let config: any = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }

      // 添加服务器
      if (!config.mcpServers) {
        config.mcpServers = {};
      }

      config.mcpServers[info.name] = {
        type: info.type,
        command: info.command,
        args: info.args,
        url: info.url,
        env: info.env,
        headers: info.headers,
      };

      // 写回配置
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Failed to save server to config:`, err);
    }
  }

  /**
   * 从配置文件移除服务器
   */
  private async removeFromConfig(name: string): Promise<void> {
    const configPath = CONFIG_PATHS.user;

    try {
      if (!fs.existsSync(configPath)) {
        return;
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      if (config.mcpServers && config.mcpServers[name]) {
        delete config.mcpServers[name];
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch (err) {
      console.error(`Failed to remove server from config:`, err);
    }
  }

  /**
   * 从包名提取服务器名称
   */
  private extractServerName(packageName: string): string {
    // @modelcontextprotocol/server-filesystem -> filesystem
    // @anthropic-ai/mcp-server-github -> github
    const parts = packageName.split('/');
    const lastPart = parts[parts.length - 1];
    return lastPart.replace(/^(mcp-)?server-/, '');
  }
}

// ============ 工具函数 ============

/**
 * 在指定路径搜索 MCP 服务器
 */
export async function findMcpServers(searchPaths: string[]): Promise<McpServerInfo[]> {
  const servers: McpServerInfo[] = [];

  for (const searchPath of searchPaths) {
    try {
      if (!fs.existsSync(searchPath)) {
        continue;
      }

      const stat = fs.statSync(searchPath);
      if (!stat.isDirectory()) {
        continue;
      }

      // 查找所有包含 "mcp" 或 "server" 的目录
      const entries = fs.readdirSync(searchPath);
      for (const entry of entries) {
        if (!entry.includes('mcp') && !entry.includes('server')) {
          continue;
        }

        const fullPath = path.join(searchPath, entry);
        const packageJsonPath = path.join(fullPath, 'package.json');

        if (fs.existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

            // 检查是否是 MCP 服务器 (简单启发式)
            const isMcpServer =
              packageJson.name?.includes('mcp') ||
              packageJson.name?.includes('server') ||
              packageJson.keywords?.includes('mcp') ||
              packageJson.keywords?.includes('model-context-protocol');

            if (isMcpServer) {
              const serverName = packageJson.name.split('/').pop().replace(/^(mcp-)?server-/, '');

              servers.push({
                name: serverName,
                type: 'stdio',
                command: 'node',
                args: [fullPath],
                capabilities: {
                  tools: [],
                  resources: [],
                  prompts: [],
                },
                status: 'available',
                source: 'local',
              });
            }
          } catch {
            // 忽略无效的 package.json
          }
        }
      }
    } catch (err) {
      console.warn(`Failed to search path ${searchPath}:`, err);
    }
  }

  return servers;
}

/**
 * 验证 MCP 服务器配置
 */
export function validateMcpConfig(config: unknown): config is McpServerConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const cfg = config as any;

  // 必须有 type
  if (!cfg.type || !['stdio', 'sse', 'http'].includes(cfg.type)) {
    return false;
  }

  // stdio 必须有 command
  if (cfg.type === 'stdio' && !cfg.command) {
    return false;
  }

  // http/sse 必须有 url
  if ((cfg.type === 'http' || cfg.type === 'sse') && !cfg.url) {
    return false;
  }

  return true;
}

/**
 * 创建默认的 discovery 实例
 */
export function createDiscovery(configPaths?: string[]): McpDiscovery {
  return new McpDiscovery(configPaths);
}
