/**
 * LSP Server Manager - Language Server Protocol 服务器管理
 * 负责启动、管理和与LSP服务器通信
 *
 * 功能特性：
 * - 支持 .lsp.json 配置文件
 * - 支持自动检测和安装 LSP 服务器
 * - 支持环境变量展开 (${VAR_NAME})
 * - 支持 ContentModified 错误自动重试
 * - 支持服务器崩溃自动重启
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync, spawnSync } from 'child_process';
import * as path from 'path';
import { pathToFileURL } from 'url';
import * as fs from 'fs';
import * as os from 'os';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * LSP 服务器配置 (完整版，与官方一致)
 */
export interface LSPServerConfig {
  /** 服务器名称 */
  name: string;
  /** 可执行文件路径或命令 */
  command: string;
  /** 命令行参数 */
  args?: string[];
  /** 支持的文件扩展名 */
  fileExtensions: string[];
  /** 文件扩展名到语言ID的映射 */
  extensionToLanguage?: Record<string, string>;
  /** 通信方式: stdio 或 socket */
  transport?: 'stdio' | 'socket';
  /** 初始化选项 */
  initializationOptions?: any;
  /** 服务器设置 (workspace/didChangeConfiguration) */
  settings?: any;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作区文件夹路径 */
  workspaceFolder?: string;
  /** 启动超时时间 (毫秒) */
  startupTimeout?: number;
  /** 关闭超时时间 (毫秒) */
  shutdownTimeout?: number;
  /** 崩溃后是否自动重启 */
  restartOnCrash?: boolean;
  /** 最大重启次数 */
  maxRestarts?: number;
  /** npm 包名 (用于自动安装) */
  npmPackage?: string;
  /** 额外的 npm 包依赖 */
  npmDependencies?: string[];
  /** 配置来源 */
  source?: string;
  /** 作用域: static (内置) 或 dynamic (插件) */
  scope?: 'static' | 'dynamic';
}

/**
 * .lsp.json 配置文件格式
 */
interface LSPConfigFile {
  [serverName: string]: Omit<LSPServerConfig, 'name'>;
}

/**
 * LSP 服务器安装信息
 */
interface LSPServerInstallInfo {
  name: string;
  npmPackage: string;
  npmDependencies?: string[];
  command: string;
}

/**
 * 已知的 LSP 服务器及其安装信息
 */
const KNOWN_LSP_SERVERS: Record<string, LSPServerInstallInfo> = {
  'typescript-language-server': {
    name: 'typescript-language-server',
    npmPackage: 'typescript-language-server',
    npmDependencies: ['typescript'],
    command: 'typescript-language-server',
  },
  'pyright': {
    name: 'pyright',
    npmPackage: 'pyright',
    command: 'pyright-langserver',
  },
  'vscode-json-languageserver': {
    name: 'vscode-json-languageserver',
    npmPackage: 'vscode-json-languageserver',
    command: 'vscode-json-languageserver',
  },
  'vscode-css-languageserver': {
    name: 'vscode-css-languageserver',
    npmPackage: 'vscode-langservers-extracted',
    command: 'vscode-css-language-server',
  },
  'vscode-html-languageserver': {
    name: 'vscode-html-languageserver',
    npmPackage: 'vscode-langservers-extracted',
    command: 'vscode-html-language-server',
  },
};

// ============================================================================
// 环境变量展开
// ============================================================================

/**
 * 展开字符串中的环境变量
 * 支持 ${VAR_NAME} 和 ${VAR_NAME:-default} 语法
 */
function expandEnvVariables(str: string, extraVars?: Record<string, string>): {
  expanded: string;
  missingVars: string[];
} {
  const missingVars: string[] = [];
  const allVars = { ...process.env, ...extraVars };

  const expanded = str.replace(/\$\{([^}]+)\}/g, (match, expr) => {
    // 支持默认值语法: ${VAR:-default}
    const [varName, defaultValue] = expr.split(':-');
    const value = allVars[varName];

    if (value !== undefined) {
      return value;
    } else if (defaultValue !== undefined) {
      return defaultValue;
    } else {
      missingVars.push(varName);
      return match; // 保持原样
    }
  });

  return { expanded, missingVars };
}

/**
 * 展开配置中的所有环境变量
 */
function expandConfigEnvVars(
  config: LSPServerConfig,
  workspaceRoot: string
): LSPServerConfig {
  const extraVars: Record<string, string> = {
    WORKSPACE_ROOT: workspaceRoot,
    HOME: os.homedir(),
  };

  const expandStr = (s: string): string => {
    const { expanded, missingVars } = expandEnvVariables(s, extraVars);
    if (missingVars.length > 0) {
      console.warn(`[LSP] Missing environment variables: ${missingVars.join(', ')}`);
    }
    return expanded;
  };

  return {
    ...config,
    command: expandStr(config.command),
    args: config.args?.map(expandStr),
    workspaceFolder: config.workspaceFolder ? expandStr(config.workspaceFolder) : undefined,
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([k, v]) => [k, expandStr(v)])
        )
      : undefined,
  };
}

// ============================================================================
// .lsp.json 配置文件加载
// ============================================================================

/**
 * 查找并加载 .lsp.json 配置文件
 * 搜索顺序: 工作区根目录 -> .claude 目录 -> 用户目录
 */
function loadLSPConfigFile(workspaceRoot: string): LSPServerConfig[] {
  const configs: LSPServerConfig[] = [];
  const searchPaths = [
    path.join(workspaceRoot, '.lsp.json'),
    path.join(workspaceRoot, '.axon', 'lsp.json'),
    path.join(os.homedir(), '.axon', 'lsp.json'),
  ];

  for (const configPath of searchPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const configFile: LSPConfigFile = JSON.parse(content);

        for (const [name, serverConfig] of Object.entries(configFile)) {
          // 验证必需字段
          if (!serverConfig.command) {
            console.warn(`[LSP] Config ${name} missing command field, skipping`);
            continue;
          }

          // 从 extensionToLanguage 提取 fileExtensions
          let fileExtensions = serverConfig.fileExtensions || [];
          if (serverConfig.extensionToLanguage && fileExtensions.length === 0) {
            fileExtensions = Object.keys(serverConfig.extensionToLanguage);
          }

          if (fileExtensions.length === 0) {
            console.warn(`[LSP] Config ${name} missing fileExtensions, skipping`);
            continue;
          }

          configs.push({
            name,
            ...serverConfig,
            fileExtensions,
            source: configPath,
            scope: 'dynamic',
          });
        }

        console.log(`[LSP] Loaded ${Object.keys(configFile).length} configs from ${configPath}`);
      }
    } catch (error) {
      console.error(`[LSP] Failed to load config file ${configPath}:`, error);
    }
  }

  return configs;
}

// ============================================================================
// 命令检测和安装
// ============================================================================

/**
 * 检查命令是否可用
 */
function isCommandAvailable(command: string): boolean {
  try {
    // 在 Windows 上使用 where，在其他系统上使用 which
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(checkCmd, [command], {
      stdio: 'pipe',
      shell: true,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 安装 npm 包 (全局安装)
 */
async function installNpmPackage(packageName: string, dependencies?: string[]): Promise<boolean> {
  console.log(`[LSP] Installing ${packageName}...`);

  try {
    // 安装主包和依赖
    const packages = [packageName, ...(dependencies || [])];
    const installCmd = `npm install -g ${packages.join(' ')}`;

    execSync(installCmd, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    console.log(`[LSP] ${packageName} installed successfully`);
    return true;
  } catch (error) {
    console.error(`[LSP] Failed to install ${packageName}:`, error);
    return false;
  }
}

/**
 * 确保 LSP 服务器已安装
 * 如果未安装则尝试自动安装
 */
async function ensureLSPServerInstalled(config: LSPServerConfig): Promise<boolean> {
  // 检查命令是否已可用
  if (isCommandAvailable(config.command)) {
    return true;
  }

  console.log(`[LSP] ${config.name} not installed, attempting auto-install...`);

  // 查找安装信息
  const installInfo = KNOWN_LSP_SERVERS[config.name] || {
    name: config.name,
    npmPackage: config.npmPackage || config.name,
    npmDependencies: config.npmDependencies,
    command: config.command,
  };

  if (!installInfo.npmPackage) {
    console.error(`[LSP] Cannot auto-install ${config.name}: unknown npm package name`);
    return false;
  }

  // 尝试安装
  const installed = await installNpmPackage(
    installInfo.npmPackage,
    installInfo.npmDependencies
  );

  if (!installed) {
    return false;
  }

  // 再次检查命令是否可用
  if (isCommandAvailable(config.command)) {
    return true;
  }

  console.error(`[LSP] Installation complete but command ${config.command} is still unavailable`);
  return false;
}

/**
 * LSP 服务器状态
 */
export type LSPServerState = 'initializing' | 'ready' | 'error' | 'stopped';

/**
 * LSP 诊断信息
 */
export interface LSPDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string;
  source?: string;
  code?: string | number;
}

// LSP 错误码
const LSP_ERROR_CONTENT_MODIFIED = -32801;
const LSP_MAX_RETRIES = 3;
const LSP_RETRY_DELAY_MS = 500;

/**
 * LSP 服务器实例
 * 管理单个语言服务器的生命周期和通信
 *
 * 功能：
 * - 进程管理和通信
 * - 请求/响应匹配
 * - ContentModified 错误自动重试
 * - 崩溃自动重启
 */
export class LSPServer extends EventEmitter {
  private config: LSPServerConfig;
  private process: ChildProcess | null = null;
  private state: LSPServerState = 'stopped';
  private nextRequestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }>();
  private messageBuffer = '';
  private workspaceRoot: string = '';
  private restartCount = 0;
  private startTime?: Date;
  private lastError?: Error;

  // 已打开的文档
  private openDocuments = new Map<string, {
    uri: string;
    languageId: string;
    version: number;
    content: string;
  }>();

  constructor(config: LSPServerConfig) {
    super();
    this.config = config;
  }

  /**
   * 获取重启次数
   */
  getRestartCount(): number {
    return this.restartCount;
  }

  /**
   * 获取启动时间
   */
  getStartTime(): Date | undefined {
    return this.startTime;
  }

  /**
   * 获取最后一次错误
   */
  getLastError(): Error | undefined {
    return this.lastError;
  }

  /**
   * 检查服务器是否健康
   */
  isHealthy(): boolean {
    return this.state === 'ready' && this.process !== null;
  }

  /**
   * 启动 LSP 服务器
   */
  async start(workspaceRoot: string): Promise<void> {
    if (this.state !== 'stopped') {
      throw new Error(`Server already started (state: ${this.state})`);
    }

    this.workspaceRoot = workspaceRoot;
    this.state = 'initializing';

    try {
      // 展开配置中的环境变量
      const expandedConfig = expandConfigEnvVars(this.config, workspaceRoot);
      const cwd = expandedConfig.workspaceFolder || workspaceRoot;

      // 启动进程
      // 在 Windows 上需要使用 shell: true 来正确解析 .cmd 文件
      this.process = spawn(expandedConfig.command, expandedConfig.args || [], {
        cwd,
        env: { ...process.env, ...expandedConfig.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      // 监听输出
      this.process.stdout!.on('data', (data) => {
        this.handleData(data);
      });

      this.process.stderr!.on('data', (data) => {
        console.error(`[LSP ${this.config.name}] ${data.toString()}`);
      });

      this.process.on('exit', (code) => {
        const wasReady = this.state === 'ready';
        this.state = 'stopped';
        this.emit('exit', code);

        // 如果配置了崩溃重启且服务器曾经正常运行
        if (wasReady && code !== 0 && this.config.restartOnCrash) {
          this.handleCrash();
        }
      });

      this.process.on('error', (err) => {
        this.state = 'error';
        this.lastError = err;
        this.emit('error', err);
      });

      // 发送 initialize 请求
      const initResult = await this.sendRequest('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(workspaceRoot).href,
        capabilities: {
          textDocument: {
            synchronization: {
              didOpen: true,
              didChange: true,
              didSave: true,
              didClose: true,
            },
            completion: { completionItem: { snippetSupport: true } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            implementation: {},
            typeDefinition: {},
            callHierarchy: {},
          },
          workspace: {
            symbol: {},
            workspaceFolders: true,
          },
        },
        initializationOptions: this.config.initializationOptions,
        workspaceFolders: [
          {
            uri: pathToFileURL(workspaceRoot).href,
            name: path.basename(workspaceRoot),
          },
        ],
      });

      // 发送 initialized 通知
      this.sendNotification('initialized', {});

      // 如果有设置，发送配置
      if (this.config.settings) {
        this.sendNotification('workspace/didChangeConfiguration', {
          settings: this.config.settings,
        });
      }

      this.state = 'ready';
      this.startTime = new Date();
      this.emit('ready', initResult);
      console.log(`[LSP] ${this.config.name} started successfully`);
    } catch (err) {
      this.state = 'error';
      this.lastError = err as Error;
      throw err;
    }
  }

  /**
   * 停止 LSP 服务器
   */
  async stop(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }

    // v2.1.31: 使用 undefined 代替 null 作为参数
    // 修复严格的 LSP 服务器拒绝 null params 的兼容性问题
    try {
      await this.sendRequest('shutdown', undefined);
      this.sendNotification('exit', undefined);
    } catch (err) {
      // 忽略错误
    }

    // 杀死进程
    if (this.process) {
      this.process.kill();
      this.process = null;
    }

    this.state = 'stopped';
    console.log(`[LSP] ${this.config.name} stopped`);
  }

  /**
   * 重启服务器
   */
  async restart(): Promise<void> {
    console.log(`[LSP] Restarting ${this.config.name}...`);

    try {
      await this.stop();
    } catch (err) {
      console.error(`[LSP] Failed to stop ${this.config.name}:`, err);
    }

    this.restartCount++;
    const maxRestarts = this.config.maxRestarts ?? 3;

    if (this.restartCount > maxRestarts) {
      const error = new Error(`${this.config.name} exceeded maximum restart count (${maxRestarts})`);
      this.lastError = error;
      throw error;
    }

    await this.start(this.workspaceRoot);
  }

  /**
   * 处理服务器崩溃
   */
  private handleCrash(): void {
    const maxRestarts = this.config.maxRestarts ?? 3;

    if (this.restartCount >= maxRestarts) {
      console.error(`[LSP] ${this.config.name} crashed too many times, will not restart`);
      return;
    }

    console.log(`[LSP] ${this.config.name} crashed, attempting restart (${this.restartCount + 1}/${maxRestarts})...`);

    // 延迟重启，避免快速循环
    setTimeout(async () => {
      try {
        await this.restart();
      } catch (err) {
        console.error(`[LSP] ${this.config.name} restart failed:`, err);
      }
    }, 1000);
  }

  /**
   * 发送请求 (带自动重试)
   * 当收到 ContentModified 错误时自动重试
   */
  async sendRequestWithRetry<T = any>(method: string, params: any): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= LSP_MAX_RETRIES; attempt++) {
      try {
        return await this.sendRequest(method, params) as T;
      } catch (err: any) {
        lastError = err;

        // 检查是否是 ContentModified 错误
        const errorCode = err?.code ?? err?.data?.code;
        if (typeof errorCode === 'number' && errorCode === LSP_ERROR_CONTENT_MODIFIED) {
          if (attempt < LSP_MAX_RETRIES) {
            const delay = LSP_RETRY_DELAY_MS * Math.pow(2, attempt);
            console.log(`[LSP] ${method} received ContentModified, retrying in ${delay}ms (${attempt + 1}/${LSP_MAX_RETRIES})...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        throw err;
      }
    }

    throw lastError || new Error(`${method} request failed`);
  }

  /**
   * 处理接收的数据
   */
  private handleData(data: Buffer): void {
    this.messageBuffer += data.toString();

    while (true) {
      const headerEnd = this.messageBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        break;
      }

      const headerText = this.messageBuffer.substring(0, headerEnd);
      const headers = this.parseHeaders(headerText);
      const contentLength = headers['Content-Length'];

      if (!contentLength) {
        console.error('[LSP] No Content-Length header');
        this.messageBuffer = '';
        break;
      }

      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.messageBuffer.length < bodyEnd) {
        // 不完整的消息，等待更多数据
        break;
      }

      const bodyText = this.messageBuffer.substring(bodyStart, bodyEnd);
      this.messageBuffer = this.messageBuffer.substring(bodyEnd);

      try {
        const message = JSON.parse(bodyText);
        this.handleMessage(message);
      } catch (err) {
        console.error('[LSP] Failed to parse message:', err);
      }
    }
  }

  /**
   * 解析消息头
   */
  private parseHeaders(text: string): Record<string, number> {
    const headers: Record<string, number> = {};
    const lines = text.split('\r\n');

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        const value = match[2];
        if (key === 'Content-Length') {
          headers[key] = parseInt(value, 10);
        }
      }
    }

    return headers;
  }

  /**
   * 处理消息
   */
  private handleMessage(message: any): void {
    if ('id' in message && 'result' in message) {
      // 响应消息
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.resolve(message.result);
      }
    } else if ('id' in message && 'error' in message) {
      // 错误响应
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        pending.reject(new Error(message.error.message));
      }
    } else if ('method' in message && !('id' in message)) {
      // 通知
      this.emit('notification', message.method, message.params);

      // 处理诊断推送
      if (message.method === 'textDocument/publishDiagnostics') {
        this.emit('diagnostics', message.params);
      }
    }
  }

  /**
   * 发送请求
   */
  sendRequest(method: string, params: any): Promise<any> {
    if (this.state !== 'ready' && this.state !== 'initializing') {
      return Promise.reject(new Error('Server not ready'));
    }

    const id = this.nextRequestId++;
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.sendMessage(message);

      // 30 秒超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  /**
   * 发送通知
   */
  sendNotification(method: string, params: any): void {
    const message = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.sendMessage(message);
  }

  /**
   * 发送消息
   */
  private sendMessage(message: any): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('Process not started');
    }

    const content = JSON.stringify(message);
    const headers = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin.write(headers + content);
  }

  /**
   * 打开文档
   */
  async openDocument(filePath: string, content: string, languageId: string): Promise<void> {
    const uri = pathToFileURL(filePath).href;

    // 如果已打开，先关闭
    if (this.openDocuments.has(filePath)) {
      await this.closeDocument(filePath);
    }

    // 发送 didOpen 通知
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    });

    // 记录文档状态
    this.openDocuments.set(filePath, {
      uri,
      languageId,
      version: 1,
      content,
    });
  }

  /**
   * 更新文档
   */
  async changeDocument(filePath: string, newContent: string): Promise<void> {
    const doc = this.openDocuments.get(filePath);
    if (!doc) {
      throw new Error('Document not opened');
    }

    doc.version++;
    doc.content = newContent;

    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: doc.uri,
        version: doc.version,
      },
      contentChanges: [
        {
          text: newContent,
        },
      ],
    });
  }

  /**
   * 关闭文档
   */
  async closeDocument(filePath: string): Promise<void> {
    const doc = this.openDocuments.get(filePath);
    if (!doc) {
      return;
    }

    this.sendNotification('textDocument/didClose', {
      textDocument: {
        uri: doc.uri,
      },
    });

    this.openDocuments.delete(filePath);
  }

  /**
   * 检查文档是否打开
   */
  isDocumentOpen(filePath: string): boolean {
    return this.openDocuments.has(filePath);
  }

  /**
   * 获取状态
   */
  getState(): LSPServerState {
    return this.state;
  }

  /**
   * 获取配置
   */
  getConfig(): LSPServerConfig {
    return this.config;
  }
}

/**
 * LSP 服务器管理器
 * 管理多个语言服务器实例
 */
export class LSPServerManager extends EventEmitter {
  private servers = new Map<string, LSPServer>();
  private serverConfigs: LSPServerConfig[] = [];
  private workspaceRoot: string;
  private state: 'initializing' | 'ready' | 'failed' = 'initializing';
  private diagnosticsCache = new Map<string, LSPDiagnostic[]>();
  // 扩展名到服务器名的映射 (用于快速查找)
  private extensionToServer = new Map<string, string[]>();

  constructor(workspaceRoot: string) {
    super();
    this.workspaceRoot = workspaceRoot;

    // 监听诊断通知
    this.on('diagnostics', (params) => {
      this.handleDiagnostics(params);
    });
  }

  /**
   * 注册 LSP 服务器配置
   */
  registerServer(config: LSPServerConfig): void {
    this.serverConfigs.push(config);

    // 建立扩展名索引
    for (const ext of config.fileExtensions) {
      const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
      const servers = this.extensionToServer.get(normalizedExt) || [];
      if (!servers.includes(config.name)) {
        servers.push(config.name);
      }
      this.extensionToServer.set(normalizedExt, servers);
    }
  }

  /**
   * 从 .lsp.json 加载配置
   */
  loadConfigFromFile(): LSPServerConfig[] {
    const configs = loadLSPConfigFile(this.workspaceRoot);
    for (const config of configs) {
      this.registerServer(config);
    }
    return configs;
  }

  /**
   * 初始化所有服务器
   * 会自动检测并安装缺失的 LSP 服务器
   */
  async initialize(): Promise<void> {
    console.log(`[LSP] Starting initialization with ${this.serverConfigs.length} server configs`);

    try {
      for (const config of this.serverConfigs) {
        // 检查并安装 LSP 服务器
        const isInstalled = await ensureLSPServerInstalled(config);
        if (!isInstalled) {
          console.error(`[LSP] Skipping ${config.name}: not installed and auto-install failed`);
          continue;
        }

        const server = new LSPServer(config);

        // 监听诊断
        server.on('diagnostics', (params) => {
          this.emit('diagnostics', params);
        });

        // 监听错误
        server.on('error', (err) => {
          console.error(`[LSP] ${config.name} error:`, err);
          this.emit('serverError', { server: config.name, error: err });
        });

        try {
          await server.start(this.workspaceRoot);
          this.servers.set(config.name, server);
        } catch (err) {
          console.error(`[LSP] Failed to start ${config.name}:`, err);
        }
      }

      const successCount = this.servers.size;
      const totalCount = this.serverConfigs.length;
      console.log(`[LSP] Initialization complete: ${successCount}/${totalCount} servers started successfully`);

      this.state = 'ready';
      this.emit('ready');
    } catch (err) {
      this.state = 'failed';
      this.emit('error', err);
      throw err;
    }
  }

  /**
   * 关闭所有服务器
   */
  async shutdown(): Promise<void> {
    for (const server of this.servers.values()) {
      try {
        await server.stop();
      } catch (err) {
        console.error('[LSP] Failed to stop server:', err);
      }
    }

    this.servers.clear();
  }

  /**
   * 根据文件类型获取服务器
   */
  getServerForFile(filePath: string): LSPServer | undefined {
    const ext = path.extname(filePath);

    for (const [name, server] of this.servers) {
      const config = this.serverConfigs.find(c => c.name === name);
      if (config && config.fileExtensions.includes(ext)) {
        if (server.getState() === 'ready') {
          return server;
        }
      }
    }

    return undefined;
  }

  /**
   * 获取所有服务器
   */
  getAllServers(): Map<string, LSPServer> {
    return this.servers;
  }

  /**
   * 打开文件
   */
  async openFile(filePath: string, content: string): Promise<void> {
    const server = this.getServerForFile(filePath);
    if (!server) {
      return;
    }

    const ext = path.extname(filePath);
    const languageId = this.getLanguageId(ext);

    await server.openDocument(filePath, content, languageId);
  }

  /**
   * 检查文件是否打开
   */
  isFileOpen(filePath: string): boolean {
    const server = this.getServerForFile(filePath);
    return server?.isDocumentOpen(filePath) ?? false;
  }

  /**
   * 发送 LSP 请求
   */
  async sendRequest(filePath: string, method: string, params: any): Promise<any> {
    const server = this.getServerForFile(filePath);
    if (!server) {
      return undefined;
    }

    return server.sendRequest(method, params);
  }

  /**
   * 获取语言 ID
   */
  private getLanguageId(ext: string): string {
    const mapping: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
    };

    return mapping[ext] || 'plaintext';
  }

  /**
   * 处理诊断推送
   */
  private handleDiagnostics(params: any): void {
    const { uri, diagnostics } = params;
    this.diagnosticsCache.set(uri, diagnostics);
  }

  /**
   * 获取所有诊断
   */
  getDiagnostics(): Map<string, LSPDiagnostic[]> {
    return new Map(this.diagnosticsCache);
  }

  /**
   * 获取文件的诊断
   */
  getFileDiagnostics(filePath: string): LSPDiagnostic[] {
    const uri = pathToFileURL(filePath).href;
    return this.diagnosticsCache.get(uri) || [];
  }

  /**
   * 清除诊断
   */
  clearDiagnostics(filePath?: string): void {
    if (filePath) {
      const uri = pathToFileURL(filePath).href;
      this.diagnosticsCache.delete(uri);
    } else {
      this.diagnosticsCache.clear();
    }
  }

  /**
   * 获取状态
   */
  getStatus(): { status: 'initializing' | 'ready' | 'failed' } {
    return { status: this.state };
  }
}

/**
 * 默认 LSP 服务器配置 (内置)
 */
export const defaultLSPConfigs: LSPServerConfig[] = [
  {
    name: 'typescript-language-server',
    command: 'typescript-language-server',
    args: ['--stdio'],
    fileExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    extensionToLanguage: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
    },
    restartOnCrash: true,
    maxRestarts: 3,
    scope: 'static',
  },
  {
    name: 'pyright',
    command: 'pyright-langserver',
    args: ['--stdio'],
    fileExtensions: ['.py'],
    extensionToLanguage: {
      '.py': 'python',
    },
    restartOnCrash: true,
    maxRestarts: 3,
    scope: 'static',
  },
];

// 全局实例
let globalManager: LSPServerManager | null = null;

/**
 * 初始化选项
 */
export interface InitializeLSPOptions {
  /** 是否加载 .lsp.json 配置文件 */
  loadConfigFile?: boolean;
  /** 是否注册默认服务器 */
  useDefaults?: boolean;
  /** 自定义服务器配置 */
  customConfigs?: LSPServerConfig[];
}

/**
 * 初始化全局 LSP 管理器
 *
 * @param workspaceRoot 工作区根目录
 * @param options 初始化选项
 */
export async function initializeLSPManager(
  workspaceRoot: string,
  options: InitializeLSPOptions = {}
): Promise<LSPServerManager> {
  const {
    loadConfigFile = true,
    useDefaults = true,
    customConfigs = [],
  } = options;

  if (globalManager) {
    await globalManager.shutdown();
  }

  globalManager = new LSPServerManager(workspaceRoot);

  // 1. 加载 .lsp.json 配置 (优先级最高)
  if (loadConfigFile) {
    const fileConfigs = globalManager.loadConfigFromFile();
    if (fileConfigs.length > 0) {
      console.log(`[LSP] Loaded ${fileConfigs.length} servers from config file`);
    }
  }

  // 2. 注册自定义配置
  for (const config of customConfigs) {
    globalManager.registerServer(config);
  }

  // 3. 注册默认服务器 (只注册未被覆盖的)
  if (useDefaults) {
    const existingNames = new Set(globalManager['serverConfigs'].map(c => c.name));
    for (const config of defaultLSPConfigs) {
      if (!existingNames.has(config.name)) {
        globalManager.registerServer(config);
      }
    }
  }

  await globalManager.initialize();

  return globalManager;
}

/**
 * 获取全局 LSP 管理器
 */
export function getLSPManager(): LSPServerManager | null {
  return globalManager;
}

/**
 * 检查指定的 LSP 服务器是否已安装
 */
export function checkLSPServerInstalled(serverName: string): boolean {
  const config = defaultLSPConfigs.find(c => c.name === serverName);
  if (!config) {
    const installInfo = KNOWN_LSP_SERVERS[serverName];
    if (installInfo) {
      return isCommandAvailable(installInfo.command);
    }
    return false;
  }
  return isCommandAvailable(config.command);
}

/**
 * 手动安装 LSP 服务器
 */
export async function installLSPServer(serverName: string): Promise<boolean> {
  const installInfo = KNOWN_LSP_SERVERS[serverName];
  if (!installInfo) {
    console.error(`[LSP] Unknown server: ${serverName}`);
    console.log(`[LSP] Supported servers: ${Object.keys(KNOWN_LSP_SERVERS).join(', ')}`);
    return false;
  }

  return installNpmPackage(installInfo.npmPackage, installInfo.npmDependencies);
}

/**
 * 获取所有已知的 LSP 服务器列表
 */
export function getKnownLSPServers(): string[] {
  return Object.keys(KNOWN_LSP_SERVERS);
}

/**
 * 获取 LSP 服务器安装状态
 */
export function getLSPServerStatus(): Record<string, { installed: boolean; command: string }> {
  const status: Record<string, { installed: boolean; command: string }> = {};

  for (const [name, info] of Object.entries(KNOWN_LSP_SERVERS)) {
    status[name] = {
      installed: isCommandAvailable(info.command),
      command: info.command,
    };
  }

  return status;
}
