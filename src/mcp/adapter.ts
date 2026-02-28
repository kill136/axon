/**
 * MCP 插件适配器
 * 将 MCP 服务器的能力适配到 Axon 的现有系统
 *
 * 功能：
 * - MCP 工具 → Axon 工具
 * - MCP 资源 → 上下文数据
 * - MCP 提示 → 系统提示
 * - 与 ToolRegistry 和插件系统集成
 */

import { EventEmitter } from 'events';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { BaseTool, ToolRegistry } from '../tools/base.js';
import {
  getMcpServers,
  callMcpTool,
  createMcpTools,
  McpTool,
  registerMcpServer,
  getServerStatus,
} from '../tools/mcp.js';
import type { McpServerConfig } from '../types/index.js';

// ============ 类型定义 ============

/**
 * MCP 工具定义（内部使用）
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP 资源定义
 */
export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP 提示定义
 */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

/**
 * 上下文数据
 */
export interface ContextData {
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * 上下文提供者
 */
export interface ContextProvider {
  getName(): string;
  getContext(): Promise<ContextData>;
  refresh?(): Promise<void>;
}

/**
 * 提示适配器
 */
export interface PromptAdapter {
  mcpPrompt: McpPrompt;
  systemPrompt: string;
  serverName: string;
  generatePrompt(args?: Record<string, string>): Promise<string>;
}

/**
 * MCP 工具适配器
 */
export interface McpToolAdapter {
  mcpTool: McpToolDefinition;
  claudeTool: ToolDefinition;
  serverName: string;
}

/**
 * MCP 资源适配器
 */
export interface McpResourceAdapter {
  mcpResource: McpResource;
  contextProvider: ContextProvider;
  serverName: string;
}

/**
 * 回调类型
 */
export type ToolsChangedCallback = (serverName: string, tools: ToolDefinition[]) => void;
export type ResourcesChangedCallback = (serverName: string, resources: McpResource[]) => void;

// ============ 工具转换函数 ============

/**
 * 从 MCP 工具创建 Axon 工具定义
 */
export function createToolFromMcp(mcpTool: McpToolDefinition, serverName: string): ToolDefinition {
  return {
    name: `mcp__${serverName}__${mcpTool.name}`,
    description: `[MCP:${serverName}] ${mcpTool.description}`,
    inputSchema: convertMcpArgs(mcpTool.inputSchema as JSONSchema),
  };
}

/**
 * JSON Schema 类型（简化版）
 */
interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

/**
 * 将 MCP 的 JSON Schema 转换为 Axon 的工具参数格式
 */
export function convertMcpArgs(mcpSchema: JSONSchema): ToolDefinition['inputSchema'] {
  // MCP 使用标准 JSON Schema，Axon 也使用 JSON Schema
  // 大多数情况下可以直接使用，但需要确保格式正确
  return {
    type: 'object',
    properties: mcpSchema.properties || {},
    required: mcpSchema.required || [],
  };
}

/**
 * 将 MCP 工具调用结果转换为字符串
 */
export function convertMcpResult(mcpResult: unknown): string {
  if (typeof mcpResult === 'string') {
    return mcpResult;
  }

  // 处理结构化结果
  const result = mcpResult as { content?: Array<{ type: string; text?: string; image?: string }> };
  if (result.content && Array.isArray(result.content)) {
    const textContent = result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('\n');

    if (textContent) {
      return textContent;
    }
  }

  // 默认使用 JSON 序列化
  return JSON.stringify(mcpResult, null, 2);
}

// ============ 资源上下文提供者 ============

/**
 * MCP 资源上下文提供者
 */
class McpResourceContextProvider implements ContextProvider {
  constructor(
    private serverName: string,
    private resource: McpResource
  ) {}

  getName(): string {
    return `mcp_resource_${this.serverName}_${this.resource.name}`;
  }

  async getContext(): Promise<ContextData> {
    const servers = getMcpServers();
    const server = servers.get(this.serverName);

    if (!server) {
      return {
        content: `Error: MCP server ${this.serverName} not found`,
        metadata: { error: true },
      };
    }

    try {
      // 这里需要调用 ReadMcpResourceTool 或直接通过 MCP 协议读取
      // 为了简化，我们假设有一个辅助函数
      const content = await this.readResource();
      return {
        content,
        metadata: {
          serverName: this.serverName,
          resourceUri: this.resource.uri,
          mimeType: this.resource.mimeType,
        },
      };
    } catch (err) {
      return {
        content: `Error reading resource: ${err instanceof Error ? err.message : 'Unknown error'}`,
        metadata: { error: true },
      };
    }
  }

  private async readResource(): Promise<string> {
    // 这里应该调用 MCP 的 resources/read 方法
    // 为了避免循环依赖，我们使用工具注册表
    const toolRegistry = new ToolRegistry();
    const result = await toolRegistry.execute('McpResource', {
      action: 'read',
      server: this.serverName,
      uri: this.resource.uri,
    });

    if (result.success && result.output) {
      return result.output;
    }

    throw new Error(result.error || 'Failed to read resource');
  }

  async refresh(): Promise<void> {
    // 可以添加缓存刷新逻辑
  }
}

// ============ MCP 适配器主类 ============

/**
 * MCP 适配器
 * 负责将 MCP 服务器的能力适配到 Axon 系统
 */
export class McpAdapter extends EventEmitter {
  private toolAdapters: Map<string, McpToolAdapter[]> = new Map();
  private resourceAdapters: Map<string, McpResourceAdapter[]> = new Map();
  private promptAdapters: Map<string, PromptAdapter[]> = new Map();
  private registeredTools: Map<string, Set<string>> = new Map(); // serverName -> Set<toolName>

  constructor(
    private toolRegistry: ToolRegistry
  ) {
    super();
  }

  // ============ 工具适配 ============

  /**
   * 适配 MCP 服务器的工具
   */
  async adaptTools(serverName: string): Promise<McpToolAdapter[]> {
    const servers = getMcpServers();
    const server = servers.get(serverName);

    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const adapters: McpToolAdapter[] = [];

    for (const mcpTool of server.tools) {
      const claudeTool = createToolFromMcp(mcpTool, serverName);
      adapters.push({
        mcpTool,
        claudeTool,
        serverName,
      });
    }

    this.toolAdapters.set(serverName, adapters);
    return adapters;
  }

  /**
   * 将 MCP 工具注册到 ToolRegistry
   */
  async registerMcpTools(serverName: string): Promise<void> {
    // 首先适配工具
    const adapters = await this.adaptTools(serverName);

    // 创建并注册工具实例
    const mcpTools = await createMcpTools(serverName);

    const registeredToolNames = new Set<string>();

    for (const tool of mcpTools) {
      this.toolRegistry.register(tool);
      registeredToolNames.add(tool.name);
    }

    this.registeredTools.set(serverName, registeredToolNames);

    // 触发事件
    this.emit('tools:registered', serverName, adapters.map(a => a.claudeTool));
  }

  /**
   * 从 ToolRegistry 注销 MCP 工具
   */
  async unregisterMcpTools(serverName: string): Promise<void> {
    const toolNames = this.registeredTools.get(serverName);

    if (!toolNames) {
      return;
    }

    // 注意：ToolRegistry 没有 unregister 方法
    // 这是一个限制，我们只能清理内部状态
    this.registeredTools.delete(serverName);
    this.toolAdapters.delete(serverName);

    // 触发事件
    this.emit('tools:unregistered', serverName);
  }

  // ============ 资源适配 ============

  /**
   * 适配 MCP 服务器的资源
   */
  async adaptResources(serverName: string): Promise<McpResourceAdapter[]> {
    const servers = getMcpServers();
    const server = servers.get(serverName);

    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const adapters: McpResourceAdapter[] = [];

    for (const resource of server.resources) {
      const contextProvider = new McpResourceContextProvider(serverName, resource);
      adapters.push({
        mcpResource: resource,
        contextProvider,
        serverName,
      });
    }

    this.resourceAdapters.set(serverName, adapters);
    return adapters;
  }

  /**
   * 获取资源上下文
   */
  async getResourceContext(serverName: string, uri: string): Promise<ContextData> {
    const adapters = this.resourceAdapters.get(serverName);

    if (!adapters) {
      throw new Error(`No resource adapters found for server: ${serverName}`);
    }

    const adapter = adapters.find(a => a.mcpResource.uri === uri);

    if (!adapter) {
      throw new Error(`Resource not found: ${uri}`);
    }

    return adapter.contextProvider.getContext();
  }

  // ============ 提示适配 ============

  /**
   * 适配 MCP 服务器的提示
   *
   * 通过 MCP 协议的 prompts/list 和 prompts/get 方法获取并适配提示
   */
  async adaptPrompts(serverName: string): Promise<PromptAdapter[]> {
    const servers = getMcpServers();
    const server = servers.get(serverName);

    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    const adapters: PromptAdapter[] = [];

    // 获取 MCP 服务器的提示列表
    const prompts = await this.getMcpPrompts(serverName);

    for (const prompt of prompts) {
      // 将 MCP 提示转换为系统提示
      const systemPrompt = this.convertPromptToSystemPrompt(prompt);

      adapters.push({
        mcpPrompt: prompt,
        systemPrompt,
        serverName,
        generatePrompt: async (args?: Record<string, string>) => {
          // 调用 prompts/get 获取带参数的提示内容
          return await this.getMcpPromptContent(serverName, prompt.name, args);
        },
      });
    }

    this.promptAdapters.set(serverName, adapters);
    return adapters;
  }

  /**
   * 从 MCP 服务器获取提示列表
   * 通过 prompts/list 方法
   */
  private async getMcpPrompts(serverName: string): Promise<McpPrompt[]> {
    const servers = getMcpServers();
    const server = servers.get(serverName);

    if (!server) {
      return [];
    }

    // 检查服务器是否支持 prompts 能力
    if (!server.capabilities.prompts) {
      return [];
    }

    try {
      // 调用 MCP 的 prompts/list 方法
      const result = await callMcpTool(serverName, '__internal_prompts_list', {});

      if (!result.success || !result.output) {
        return [];
      }

      // 解析返回的提示列表
      const parsed = JSON.parse(result.output);
      const promptList = parsed.prompts || parsed || [];

      // 转换为 McpPrompt 类型
      return promptList.map((p: any) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((arg: any) => ({
          name: arg.name,
          description: arg.description,
          required: arg.required,
        })),
      }));
    } catch (err) {
      console.warn(`Failed to get prompts from MCP server ${serverName}:`, err);
      return [];
    }
  }

  /**
   * 从 MCP 服务器获取指定提示的内容
   * 通过 prompts/get 方法
   */
  private async getMcpPromptContent(
    serverName: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<string> {
    try {
      // 调用 MCP 的 prompts/get 方法
      const result = await callMcpTool(serverName, '__internal_prompts_get', {
        name: promptName,
        arguments: args || {},
      });

      if (!result.success || !result.output) {
        throw new Error(`Failed to get prompt content: ${result.error || 'Unknown error'}`);
      }

      // 解析返回的提示内容
      const parsed = JSON.parse(result.output);

      // MCP prompts/get 返回的格式通常包含 messages 数组
      // 每个 message 有 role 和 content 字段
      if (parsed.messages && Array.isArray(parsed.messages)) {
        // 提取所有消息的文本内容
        const contents = parsed.messages
          .map((msg: any) => {
            if (typeof msg.content === 'string') {
              return msg.content;
            }
            // content 可能是数组形式
            if (Array.isArray(msg.content)) {
              return msg.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
            }
            return '';
          })
          .filter((c: string) => c.length > 0);

        return contents.join('\n\n');
      }

      // 如果是简单格式，直接返回
      if (typeof parsed === 'string') {
        return parsed;
      }

      // 尝试提取 content 字段
      if (parsed.content) {
        return typeof parsed.content === 'string'
          ? parsed.content
          : JSON.stringify(parsed.content);
      }

      return JSON.stringify(parsed);
    } catch (err) {
      console.error(`Failed to get prompt content for ${promptName} from ${serverName}:`, err);
      throw err;
    }
  }

  /**
   * 将 MCP 提示转换为系统提示格式
   */
  private convertPromptToSystemPrompt(prompt: McpPrompt): string {
    let systemPrompt = `# ${prompt.name}\n`;

    if (prompt.description) {
      systemPrompt += `\n${prompt.description}\n`;
    }

    if (prompt.arguments && prompt.arguments.length > 0) {
      systemPrompt += '\n## 参数\n';
      for (const arg of prompt.arguments) {
        const required = arg.required ? ' (必需)' : ' (可选)';
        systemPrompt += `- **${arg.name}**${required}`;
        if (arg.description) {
          systemPrompt += `: ${arg.description}`;
        }
        systemPrompt += '\n';
      }
    }

    return systemPrompt;
  }

  /**
   * 获取提示内容
   */
  async getPromptContent(
    serverName: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<string> {
    const adapters = this.promptAdapters.get(serverName);

    if (!adapters) {
      throw new Error(`No prompt adapters found for server: ${serverName}`);
    }

    const adapter = adapters.find(a => a.mcpPrompt.name === promptName);

    if (!adapter) {
      throw new Error(`Prompt not found: ${promptName}`);
    }

    return adapter.generatePrompt(args);
  }

  // ============ 工具执行代理 ============

  /**
   * 执行工具（代理到 MCP）
   */
  async executeToolProxy(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    // 解析工具名称：mcp__serverName__toolName
    const match = toolName.match(/^mcp__([^_]+)__(.+)$/);

    if (!match) {
      return {
        success: false,
        error: `Invalid MCP tool name format: ${toolName}`,
      };
    }

    const [, serverName, mcpToolName] = match;

    // 调用 MCP 工具
    return callMcpTool(serverName, mcpToolName, args);
  }

  // ============ 同步功能 ============

  /**
   * 同步所有 MCP 服务器
   */
  async syncAll(): Promise<void> {
    const servers = getMcpServers();

    for (const serverName of Array.from(servers.keys())) {
      try {
        await this.syncServer(serverName);
      } catch (err) {
        console.error(`Failed to sync MCP server ${serverName}:`, err);
        this.emit('sync:error', serverName, err);
      }
    }
  }

  /**
   * 同步单个 MCP 服务器
   */
  async syncServer(serverName: string): Promise<void> {
    const status = getServerStatus(serverName);

    if (!status) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    // 1. 注册工具
    if (status.capabilities.includes('tools')) {
      await this.registerMcpTools(serverName);
    }

    // 2. 适配资源
    if (status.capabilities.includes('resources')) {
      await this.adaptResources(serverName);
      this.emit('resources:synced', serverName);
    }

    // 3. 适配提示
    if (status.capabilities.includes('prompts')) {
      await this.adaptPrompts(serverName);
      this.emit('prompts:synced', serverName);
    }

    this.emit('server:synced', serverName);
  }

  // ============ 事件处理 ============

  /**
   * 监听工具变化
   */
  onToolsChanged(callback: ToolsChangedCallback): () => void {
    this.on('tools:registered', callback);
    return () => {
      this.off('tools:registered', callback);
    };
  }

  /**
   * 监听资源变化
   */
  onResourcesChanged(callback: ResourcesChangedCallback): () => void {
    this.on('resources:synced', (serverName: string) => {
      const adapters = this.resourceAdapters.get(serverName);
      if (adapters) {
        callback(serverName, adapters.map(a => a.mcpResource));
      }
    });

    return () => {
      this.off('resources:synced', callback);
    };
  }

  // ============ 查询功能 ============

  /**
   * 获取所有适配的工具
   */
  getAllAdaptedTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const adapters of Array.from(this.toolAdapters.values())) {
      tools.push(...adapters.map(a => a.claudeTool));
    }

    return tools;
  }

  /**
   * 获取所有适配的资源
   */
  getAllAdaptedResources(): McpResource[] {
    const resources: McpResource[] = [];

    for (const adapters of Array.from(this.resourceAdapters.values())) {
      resources.push(...adapters.map(a => a.mcpResource));
    }

    return resources;
  }

  /**
   * 获取服务器的工具适配器
   */
  getServerToolAdapters(serverName: string): McpToolAdapter[] {
    return this.toolAdapters.get(serverName) || [];
  }

  /**
   * 获取服务器的资源适配器
   */
  getServerResourceAdapters(serverName: string): McpResourceAdapter[] {
    return this.resourceAdapters.get(serverName) || [];
  }

  /**
   * 获取服务器的提示适配器
   */
  getServerPromptAdapters(serverName: string): PromptAdapter[] {
    return this.promptAdapters.get(serverName) || [];
  }
}

// ============ 辅助函数 ============

/**
 * 批量注册 MCP 服务器为工具
 */
export async function registerMcpServersAsTools(
  adapter: McpAdapter,
  servers: string[]
): Promise<void> {
  for (const serverName of servers) {
    try {
      await adapter.registerMcpTools(serverName);
      console.log(`Registered MCP server tools: ${serverName}`);
    } catch (err) {
      console.error(`Failed to register MCP server ${serverName}:`, err);
    }
  }
}

/**
 * 创建 MCP 适配器实例
 */
export function createMcpAdapter(toolRegistry: ToolRegistry): McpAdapter {
  return new McpAdapter(toolRegistry);
}

// ============ 默认导出 ============

export default McpAdapter;
