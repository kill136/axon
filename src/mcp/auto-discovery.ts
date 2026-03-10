/**
 * MCP 自动发现和连接管理
 *
 * 功能:
 * 1. 从配置文件自动加载 MCP 服务器定义
 * 2. 支持三种传输: stdio, sse, http
 * 3. 自动连接和重连机制
 * 4. MCP 工具自动注册到工具系统
 * 5. MCP 资源访问支持
 * 6. 连接失败优雅处理
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { spawn, ChildProcess } from 'child_process';
import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { VERSION } from '../version.js';

// ============ 类型定义 ============

/**
 * MCP 服务器配置 (支持多种格式)
 */
export interface McpServerDefinition {
  /** 传输类型 */
  type?: 'stdio' | 'sse' | 'http';

  /** stdio 传输的命令 */
  command?: string;

  /** 命令参数 */
  args?: string[];

  /** 环境变量 */
  env?: Record<string, string>;

  /** HTTP/SSE 传输的 URL */
  url?: string;

  /** 传输类型 (兼容格式) */
  transport?: 'stdio' | 'sse' | 'http';

  /** HTTP 请求头 */
  headers?: Record<string, string>;

  /** 是否启用 */
  enabled?: boolean;

  /** 超时时间 (毫秒) */
  timeout?: number;

  /** 重试次数 */
  retries?: number;

  /** 自动重连 */
  autoReconnect?: boolean;
}

/**
 * MCP 配置格式 (settings.json)
 */
export interface McpConfigFile {
  mcpServers?: Record<string, McpServerDefinition>;
}

/**
 * 服务器状态
 */
export type ServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'reconnecting';

/**
 * MCP 工具定义
 */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP 资源定义
 */
export interface McpResourceInfo {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP 提示定义
 */
export interface McpPromptInfo {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * 服务器能力
 */
export interface ServerCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  sampling?: boolean;
}

/**
 * 连接的服务器信息
 */
export interface ConnectedServer {
  name: string;
  config: McpServerDefinition;
  status: ServerStatus;
  capabilities: ServerCapabilities;
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  prompts: McpPromptInfo[];
  error?: string;
  lastConnectTime?: number;
  reconnectAttempts: number;
  transport?: McpTransport;
}

/**
 * MCP 消息格式
 */
export interface McpJsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * 自动发现选项
 */
export interface AutoDiscoveryOptions {
  /** 配置文件路径 (默认: ~/.axon/settings.json) */
  configPaths?: string[];

  /** 启动时自动连接 */
  autoConnect?: boolean;

  /** 自动重连 */
  autoReconnect?: boolean;

  /** 连接超时 (毫秒) */
  connectionTimeout?: number;

  /** 最大重连次数 */
  maxReconnectAttempts?: number;

  /** 重连延迟基数 (毫秒) */
  reconnectDelayBase?: number;

  /** 健康检查间隔 (毫秒) */
  healthCheckInterval?: number;
}

// ============ 传输层抽象 ============

/**
 * MCP 传输接口
 */
export interface McpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: McpJsonRpcMessage): Promise<void>;
  isConnected(): boolean;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler: (...args: any[]) => void): void;
}

/**
 * Stdio 传输实现
 */
class StdioTransport extends EventEmitter implements McpTransport {
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private process?: ChildProcess;
  private buffer: string = '';
  private connected: boolean = false;

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}) {
    super();
    this.command = command;
    this.args = args;
    this.env = { ...process.env as Record<string, string>, ...env };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          env: this.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });

        this.process.on('error', (err) => {
          this.connected = false;
          this.emit('error', err);
          reject(err);
        });

        this.process.on('exit', (code, signal) => {
          this.connected = false;
          this.emit('disconnect', { code, signal });
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          this.buffer += data.toString();
          this.processBuffer();
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          this.emit('stderr', data.toString());
        });

        // 等待进程启动
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.connected = true;
            this.emit('connect');
            resolve();
          }
        }, 100);
      } catch (err) {
        reject(err);
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message: McpJsonRpcMessage = JSON.parse(line);
          this.emit('message', message);
        } catch (err) {
          this.emit('parse-error', err, line);
        }
      }
    }
  }

  async send(message: McpJsonRpcMessage): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error('Transport not connected');
    }

    return new Promise((resolve, reject) => {
      try {
        const data = JSON.stringify(message) + '\n';
        this.process!.stdin!.write(data, (err) => {
          if (err) reject(err);
          else resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.connected = false;
    this.emit('disconnect', { code: 0, signal: null });
  }

  isConnected(): boolean {
    return this.connected && !!this.process && !this.process.killed;
  }
}

/**
 * SSE 传输实现
 */
class SseTransport extends EventEmitter implements McpTransport {
  private url: string;
  private headers: Record<string, string>;
  private httpClient: AxiosInstance;
  private connected: boolean = false;
  private pollingInterval?: NodeJS.Timeout;
  private sessionId: string;

  constructor(url: string, headers: Record<string, string> = {}) {
    super();
    this.url = url;
    this.headers = headers;
    this.sessionId = uuidv4();
    this.httpClient = axios.create({
      baseURL: url,
      headers: {
        ...headers,
        'Accept': 'text/event-stream',
        'X-Session-ID': this.sessionId,
      },
      timeout: 30000,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // 测试连接
      await this.httpClient.get('/health').catch(() => {
        // 健康检查可能不存在,忽略
      });

      this.connected = true;
      this.startEventPolling();
      this.emit('connect');
    } catch (err) {
      throw new Error(`Failed to connect to SSE server: ${err}`);
    }
  }

  private startEventPolling(): void {
    // SSE 轮询模式 (Node.js 不原生支持 EventSource)
    // 实际生产中应使用 eventsource 库
    this.pollingInterval = setInterval(async () => {
      if (!this.connected) return;

      try {
        const response = await this.httpClient.get('/events', {
          headers: {
            'Accept': 'text/event-stream',
          },
          responseType: 'text',
        });

        if (response.data) {
          // 解析 SSE 数据
          const events = this.parseSSEData(response.data);
          for (const event of events) {
            if (event.data) {
              try {
                const message = JSON.parse(event.data);
                this.emit('message', message);
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      } catch (err) {
        // 静默处理轮询错误
      }
    }, 1000);
  }

  private parseSSEData(data: string): Array<{ event?: string; data?: string }> {
    const events: Array<{ event?: string; data?: string }> = [];
    const lines = data.split('\n');
    let currentEvent: { event?: string; data?: string } = {};

    for (const line of lines) {
      if (line.startsWith('event:')) {
        currentEvent.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        currentEvent.data = line.slice(5).trim();
      } else if (line === '' && currentEvent.data) {
        events.push(currentEvent);
        currentEvent = {};
      }
    }

    return events;
  }

  async send(message: McpJsonRpcMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    try {
      const response = await this.httpClient.post('/messages', message, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.data) {
        this.emit('message', response.data);
      }
    } catch (err) {
      throw new Error(`Failed to send SSE message: ${err}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
    this.connected = false;
    this.emit('disconnect', { code: 0, signal: null });
  }

  isConnected(): boolean {
    return this.connected;
  }
}

/**
 * HTTP 传输实现
 */
class HttpTransport extends EventEmitter implements McpTransport {
  private url: string;
  private headers: Record<string, string>;
  private httpClient: AxiosInstance;
  private connected: boolean = false;

  constructor(url: string, headers: Record<string, string> = {}) {
    super();
    this.url = url;
    this.headers = headers;
    this.httpClient = axios.create({
      baseURL: url,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      // 测试连接
      await this.httpClient.get('/health').catch(() => {
        // 健康检查可能不存在
      });

      this.connected = true;
      this.emit('connect');
    } catch (err) {
      throw new Error(`Failed to connect to HTTP server: ${err}`);
    }
  }

  async send(message: McpJsonRpcMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }

    try {
      const response = await this.httpClient.post('/rpc', message);
      if (response.data) {
        this.emit('message', response.data);
      }
    } catch (err) {
      throw new Error(`Failed to send HTTP message: ${err}`);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnect', { code: 0, signal: null });
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ============ 默认配置 ============

const DEFAULT_OPTIONS: Required<AutoDiscoveryOptions> = {
  configPaths: [
    path.join(homedir(), '.axon', 'settings.json'),
    path.join(process.cwd(), '.axon', 'settings.json'),
  ],
  autoConnect: true,
  autoReconnect: true,
  connectionTimeout: 30000,
  maxReconnectAttempts: 3,
  reconnectDelayBase: 1000,
  healthCheckInterval: 30000,
};

// ============ MCP 自动发现类 ============

/**
 * MCP 自动发现和连接管理器
 *
 * 使用示例:
 * ```typescript
 * const discovery = new McpAutoDiscovery();
 * await discovery.initialize();
 *
 * // 获取所有已连接的服务器
 * const servers = discovery.getConnectedServers();
 *
 * // 调用工具
 * const result = await discovery.callTool('my-server', 'toolName', { arg1: 'value' });
 * ```
 */
export class McpAutoDiscovery extends EventEmitter {
  private options: Required<AutoDiscoveryOptions>;
  private servers: Map<string, ConnectedServer> = new Map();
  private pendingRequests: Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();
  private messageId: number = 1;
  private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
  private initialized: boolean = false;

  constructor(options?: AutoDiscoveryOptions) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Windows 路径处理
    if (process.platform === 'win32') {
      const userProfile = process.env.USERPROFILE || homedir();
      this.options.configPaths = [
        path.join(userProfile, '.axon', 'settings.json'),
        path.join(process.cwd(), '.axon', 'settings.json'),
      ];
    }
  }

  // ============ 初始化 ============

  /**
   * 初始化自动发现系统
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 1. 加载配置
    const configs = await this.loadConfigs();

    // 2. 注册服务器
    for (const [name, config] of Object.entries(configs)) {
      this.registerServer(name, config);
    }

    // 3. 自动连接
    if (this.options.autoConnect) {
      await this.connectAll();
    }

    this.initialized = true;
    this.emit('initialized', { serverCount: this.servers.size });
  }

  /**
   * 加载配置文件
   */
  private async loadConfigs(): Promise<Record<string, McpServerDefinition>> {
    const allConfigs: Record<string, McpServerDefinition> = {};

    for (const configPath of this.options.configPaths) {
      try {
        if (!fs.existsSync(configPath)) {
          continue;
        }

        const content = fs.readFileSync(configPath, 'utf-8');
        const config: McpConfigFile = JSON.parse(content);

        if (config.mcpServers) {
          for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
            // 后面的配置覆盖前面的
            allConfigs[name] = this.normalizeConfig(serverConfig);
          }
        }
      } catch (err) {
        console.warn(`Failed to load MCP config from ${configPath}:`, err);
        this.emit('config:error', { path: configPath, error: err });
      }
    }

    return allConfigs;
  }

  /**
   * 规范化配置
   */
  private normalizeConfig(config: McpServerDefinition): McpServerDefinition {
    // 确定传输类型
    let type: 'stdio' | 'sse' | 'http' = config.type || config.transport || 'stdio';

    // 如果有 URL 但没有指定类型,推断为 http 或 sse
    if (!config.type && !config.transport && config.url) {
      type = config.transport === 'sse' ? 'sse' : 'http';
    }

    return {
      type,
      command: config.command,
      args: config.args || [],
      env: config.env || {},
      url: config.url,
      headers: config.headers || {},
      enabled: config.enabled !== false,
      timeout: config.timeout || this.options.connectionTimeout,
      retries: config.retries || this.options.maxReconnectAttempts,
      autoReconnect: config.autoReconnect ?? this.options.autoReconnect,
    };
  }

  // ============ 服务器管理 ============

  /**
   * 注册服务器
   */
  registerServer(name: string, config: McpServerDefinition): void {
    const normalizedConfig = this.normalizeConfig(config);

    // 检查是否已启用
    if (normalizedConfig.enabled === false) {
      this.emit('server:skipped', { name, reason: 'disabled' });
      return;
    }

    const server: ConnectedServer = {
      name,
      config: normalizedConfig,
      status: 'disconnected',
      capabilities: {},
      tools: [],
      resources: [],
      prompts: [],
      reconnectAttempts: 0,
    };

    this.servers.set(name, server);
    this.emit('server:registered', { name, config: normalizedConfig });
  }

  /**
   * 注销服务器
   */
  async unregisterServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    // 断开连接
    await this.disconnect(name);

    // 移除服务器
    this.servers.delete(name);
    this.emit('server:unregistered', { name });
  }

  // ============ 连接管理 ============

  /**
   * 连接到所有服务器
   */
  async connectAll(): Promise<void> {
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    for (const [name, server] of this.servers) {
      try {
        await this.connect(name);
        results.push({ name, success: true });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        results.push({ name, success: false, error: errorMessage });
        this.emit('server:connect-failed', { name, error: errorMessage });
      }
    }

    this.emit('connect:all-complete', { results });
  }

  /**
   * 连接到指定服务器
   */
  async connect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(`Server not found: ${name}`);
    }

    if (server.status === 'connected') {
      return;
    }

    if (server.status === 'connecting') {
      // 等待连接完成
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout while waiting'));
        }, this.options.connectionTimeout);

        const checkStatus = setInterval(() => {
          if (server.status === 'connected') {
            clearTimeout(timeout);
            clearInterval(checkStatus);
            resolve();
          } else if (server.status === 'error' || server.status === 'disconnected') {
            clearTimeout(timeout);
            clearInterval(checkStatus);
            reject(new Error(server.error || 'Connection failed'));
          }
        }, 100);
      });
    }

    server.status = 'connecting';
    this.emit('server:connecting', { name });

    try {
      // 创建传输
      const transport = this.createTransport(server.config);
      server.transport = transport;

      // 设置事件处理
      this.setupTransportHandlers(name, transport);

      // 连接
      await transport.connect();

      // 初始化 MCP 协议
      await this.initializeMcp(name);

      // 获取能力
      await this.discoverCapabilities(name);

      server.status = 'connected';
      server.lastConnectTime = Date.now();
      server.reconnectAttempts = 0;

      // 启动健康检查
      this.startHealthCheck(name);

      this.emit('server:connected', {
        name,
        capabilities: server.capabilities,
        toolCount: server.tools.length,
        resourceCount: server.resources.length,
      });
    } catch (err) {
      server.status = 'error';
      server.error = err instanceof Error ? err.message : String(err);

      this.emit('server:error', { name, error: server.error });

      // 尝试重连
      if (server.config.autoReconnect && server.reconnectAttempts < (server.config.retries || 3)) {
        await this.scheduleReconnect(name);
      }

      throw err;
    }
  }

  /**
   * 断开服务器连接
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    // 停止健康检查
    this.stopHealthCheck(name);

    // 断开传输
    if (server.transport) {
      await server.transport.disconnect();
      server.transport = undefined;
    }

    server.status = 'disconnected';
    this.emit('server:disconnected', { name });
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.disconnect(name);
    }
  }

  /**
   * 创建传输实例
   */
  private createTransport(config: McpServerDefinition): McpTransport {
    switch (config.type) {
      case 'stdio':
        if (!config.command) {
          throw new Error('Command required for stdio transport');
        }
        return new StdioTransport(config.command, config.args, config.env);

      case 'sse':
        if (!config.url) {
          throw new Error('URL required for SSE transport');
        }
        return new SseTransport(config.url, config.headers);

      case 'http':
        if (!config.url) {
          throw new Error('URL required for HTTP transport');
        }
        return new HttpTransport(config.url, config.headers);

      default:
        throw new Error(`Unsupported transport type: ${config.type}`);
    }
  }

  /**
   * 设置传输事件处理
   */
  private setupTransportHandlers(name: string, transport: McpTransport): void {
    transport.on('message', (message: McpJsonRpcMessage) => {
      this.handleMessage(name, message);
    });

    transport.on('error', (error: Error) => {
      const server = this.servers.get(name);
      if (server) {
        server.status = 'error';
        server.error = error.message;
        this.emit('server:error', { name, error: error.message });
      }
    });

    transport.on('disconnect', () => {
      const server = this.servers.get(name);
      if (server && server.status !== 'disconnected') {
        server.status = 'disconnected';
        this.emit('server:disconnected', { name });

        // 尝试重连
        if (server.config.autoReconnect) {
          this.scheduleReconnect(name);
        }
      }
    });
  }

  // ============ MCP 协议 ============

  /**
   * 初始化 MCP 协议
   */
  private async initializeMcp(name: string): Promise<void> {
    const result = await this.sendRequest(name, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        sampling: {},
      },
      clientInfo: {
        name: 'axon',
        version: VERSION,
      },
    });

    // 解析服务器能力
    const server = this.servers.get(name);
    if (server && result) {
      const initResult = result as {
        capabilities?: {
          tools?: unknown;
          resources?: unknown;
          prompts?: unknown;
          sampling?: unknown;
        };
      };

      server.capabilities = {
        tools: !!initResult.capabilities?.tools,
        resources: !!initResult.capabilities?.resources,
        prompts: !!initResult.capabilities?.prompts,
        sampling: !!initResult.capabilities?.sampling,
      };
    }

    // 发送 initialized 通知
    await this.sendNotification(name, 'notifications/initialized', {});
  }

  /**
   * 发现服务器能力
   */
  private async discoverCapabilities(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    // 获取工具列表
    if (server.capabilities.tools) {
      try {
        const result = await this.sendRequest(name, 'tools/list', {});
        const toolsResult = result as { tools?: McpToolInfo[] };
        server.tools = toolsResult.tools || [];
      } catch (err) {
        console.warn(`Failed to list tools for ${name}:`, err);
      }
    }

    // 获取资源列表
    if (server.capabilities.resources) {
      try {
        const result = await this.sendRequest(name, 'resources/list', {});
        const resourcesResult = result as { resources?: McpResourceInfo[] };
        server.resources = resourcesResult.resources || [];
      } catch (err) {
        console.warn(`Failed to list resources for ${name}:`, err);
      }
    }

    // 获取提示列表
    if (server.capabilities.prompts) {
      try {
        const result = await this.sendRequest(name, 'prompts/list', {});
        const promptsResult = result as { prompts?: McpPromptInfo[] };
        server.prompts = promptsResult.prompts || [];
      } catch (err) {
        console.warn(`Failed to list prompts for ${name}:`, err);
      }
    }
  }

  // ============ 消息处理 ============

  /**
   * 发送请求并等待响应
   */
  async sendRequest(name: string, method: string, params: unknown): Promise<unknown> {
    const server = this.servers.get(name);
    if (!server?.transport || !server.transport.isConnected()) {
      throw new Error(`Server not connected: ${name}`);
    }

    const id = this.messageId++;
    const message: McpJsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout for ${method}`));
      }, server.config.timeout || this.options.connectionTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      server.transport!.send(message).catch((err) => {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * 发送通知 (无响应)
   */
  async sendNotification(name: string, method: string, params: unknown): Promise<void> {
    const server = this.servers.get(name);
    if (!server?.transport || !server.transport.isConnected()) {
      throw new Error(`Server not connected: ${name}`);
    }

    const message: McpJsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await server.transport.send(message);
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(name: string, message: McpJsonRpcMessage): void {
    // 响应消息
    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    }

    // 通知消息
    if (message.method) {
      this.emit('notification', { name, method: message.method, params: message.params });

      // 处理特定通知
      if (message.method === 'notifications/tools/list_changed') {
        this.discoverCapabilities(name);
      }
    }
  }

  // ============ 工具调用 ============

  /**
   * 调用 MCP 工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const server = this.servers.get(serverName);
    if (!server) {
      return { success: false, error: `Server not found: ${serverName}` };
    }

    if (server.status !== 'connected') {
      // 尝试连接
      try {
        await this.connect(serverName);
      } catch {
        return { success: false, error: `Failed to connect to server: ${serverName}` };
      }
    }

    try {
      const result = await this.sendRequest(serverName, 'tools/call', {
        name: toolName,
        arguments: args,
      });

      // 解析结果
      const toolResult = result as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      if (toolResult.isError) {
        const errorText = toolResult.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n') || 'Unknown error';
        return { success: false, error: errorText };
      }

      const outputText = toolResult.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n') || JSON.stringify(result);

      return { success: true, output: outputText };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ============ 资源访问 ============

  /**
   * 读取 MCP 资源
   */
  async readResource(
    serverName: string,
    uri: string
  ): Promise<{ success: boolean; content?: string; mimeType?: string; error?: string }> {
    const server = this.servers.get(serverName);
    if (!server) {
      return { success: false, error: `Server not found: ${serverName}` };
    }

    if (server.status !== 'connected') {
      try {
        await this.connect(serverName);
      } catch {
        return { success: false, error: `Failed to connect to server: ${serverName}` };
      }
    }

    try {
      const result = await this.sendRequest(serverName, 'resources/read', { uri });

      const resourceResult = result as {
        contents?: Array<{
          uri: string;
          text?: string;
          blob?: string;
          mimeType?: string;
        }>;
      };

      if (!resourceResult.contents || resourceResult.contents.length === 0) {
        return { success: false, error: 'Resource not found' };
      }

      const content = resourceResult.contents[0];
      return {
        success: true,
        content: content.text || (content.blob ? `[Binary: ${content.blob.length} bytes]` : ''),
        mimeType: content.mimeType,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ============ 重连逻辑 ============

  /**
   * 调度重连
   */
  private async scheduleReconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;

    const maxAttempts = server.config.retries || this.options.maxReconnectAttempts;
    if (server.reconnectAttempts >= maxAttempts) {
      this.emit('server:max-reconnects', { name, attempts: server.reconnectAttempts });
      return;
    }

    server.status = 'reconnecting';
    server.reconnectAttempts++;

    const delay = this.options.reconnectDelayBase * Math.pow(2, server.reconnectAttempts - 1);

    this.emit('server:reconnecting', {
      name,
      attempt: server.reconnectAttempts,
      maxAttempts,
      delayMs: delay,
    });

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      // 清理旧连接
      if (server.transport) {
        await server.transport.disconnect();
        server.transport = undefined;
      }

      // 重新连接
      await this.connect(name);
    } catch (err) {
      // connect 会处理后续重连
    }
  }

  // ============ 健康检查 ============

  /**
   * 启动健康检查
   */
  private startHealthCheck(name: string): void {
    this.stopHealthCheck(name);

    const timer = setInterval(async () => {
      const server = this.servers.get(name);
      if (!server || server.status !== 'connected') {
        this.stopHealthCheck(name);
        return;
      }

      try {
        await this.sendRequest(name, 'ping', {});
      } catch {
        // 健康检查失败
        server.status = 'error';
        this.emit('health:failed', { name });
        this.stopHealthCheck(name);

        if (server.config.autoReconnect) {
          await this.scheduleReconnect(name);
        }
      }
    }, this.options.healthCheckInterval);

    this.healthCheckTimers.set(name, timer);
  }

  /**
   * 停止健康检查
   */
  private stopHealthCheck(name: string): void {
    const timer = this.healthCheckTimers.get(name);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(name);
    }
  }

  // ============ 查询方法 ============

  /**
   * 获取所有服务器
   */
  getAllServers(): ConnectedServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * 获取已连接的服务器
   */
  getConnectedServers(): ConnectedServer[] {
    return Array.from(this.servers.values()).filter((s) => s.status === 'connected');
  }

  /**
   * 获取服务器信息
   */
  getServer(name: string): ConnectedServer | undefined {
    return this.servers.get(name);
  }

  /**
   * 获取所有工具
   */
  getAllTools(): Array<McpToolInfo & { serverName: string }> {
    const tools: Array<McpToolInfo & { serverName: string }> = [];

    for (const server of this.servers.values()) {
      if (server.status === 'connected') {
        for (const tool of server.tools) {
          tools.push({ ...tool, serverName: server.name });
        }
      }
    }

    return tools;
  }

  /**
   * 获取所有资源
   */
  getAllResources(): Array<McpResourceInfo & { serverName: string }> {
    const resources: Array<McpResourceInfo & { serverName: string }> = [];

    for (const server of this.servers.values()) {
      if (server.status === 'connected') {
        for (const resource of server.resources) {
          resources.push({ ...resource, serverName: server.name });
        }
      }
    }

    return resources;
  }

  // ============ 清理 ============

  /**
   * 销毁实例
   */
  async destroy(): Promise<void> {
    // 停止所有健康检查
    for (const timer of this.healthCheckTimers.values()) {
      clearInterval(timer);
    }
    this.healthCheckTimers.clear();

    // 清除所有待处理请求
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Discovery destroyed'));
    }
    this.pendingRequests.clear();

    // 断开所有连接
    await this.disconnectAll();

    // 清空服务器列表
    this.servers.clear();

    // 移除所有监听器
    this.removeAllListeners();

    this.initialized = false;
  }
}

// ============ 工厂函数 ============

/**
 * 创建 MCP 自动发现实例
 */
export function createAutoDiscovery(options?: AutoDiscoveryOptions): McpAutoDiscovery {
  return new McpAutoDiscovery(options);
}

/**
 * 创建并初始化 MCP 自动发现实例
 */
export async function initializeAutoDiscovery(
  options?: AutoDiscoveryOptions
): Promise<McpAutoDiscovery> {
  const discovery = new McpAutoDiscovery(options);
  await discovery.initialize();
  return discovery;
}

// ============ 默认导出 ============

export default McpAutoDiscovery;
