/**
 * 工具基类
 * 所有工具都继承自此基类
 */

import type { ToolDefinition, ToolResult } from '../types/index.js';
import { t } from '../i18n/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  withRetry,
  withTimeout,
  type RetryOptions,
  type TimeoutOptions,
  DynamicTimeoutAdjuster,
} from '../utils/retry.js';
import {
  ToolExecutionError,
  ToolTimeoutError,
  ErrorCode,
} from '../types/errors.js';

/**
 * 权限检查结果
 */
export interface PermissionCheckResult<TInput = unknown> {
  /** 权限行为：allow（允许）、deny（拒绝）、ask（询问用户） */
  behavior: 'allow' | 'deny' | 'ask';
  /** 拒绝或询问的原因消息 */
  message?: string;
  /** 修改后的输入参数（可选，用于修正或规范化输入） */
  updatedInput?: TInput;
}

/**
 * 工具配置选项
 */
export interface ToolOptions {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 基础超时时间 (毫秒) */
  baseTimeout?: number;
  /** 启用动态超时调整 */
  enableDynamicTimeout?: boolean;
  /** 可重试的错误代码 */
  retryableErrors?: ErrorCode[];
}

export abstract class BaseTool<TInput = unknown, TOutput extends ToolResult = ToolResult> {
  abstract name: string;
  abstract description: string;

  /** 是否应延迟加载（对齐官方 shouldDefer） */
  shouldDefer: boolean = false;
  /** ToolSearch 列表中的简短描述（对齐官方 searchHint） */
  searchHint?: string;

  /** 工具配置选项 */
  protected options: ToolOptions;

  /** 动态超时调整器 */
  private timeoutAdjuster?: DynamicTimeoutAdjuster;

  constructor(options: ToolOptions = {}) {
    this.options = {
      maxRetries: 0, // 默认不重试,子类可以覆盖
      baseTimeout: 120000, // 2分钟默认超时
      enableDynamicTimeout: false,
      ...options,
    };

    if (this.options.enableDynamicTimeout && this.options.baseTimeout) {
      this.timeoutAdjuster = new DynamicTimeoutAdjuster(this.options.baseTimeout);
    }
  }

  abstract getInputSchema(): ToolDefinition['inputSchema'];

  /**
   * 执行工具 (子类实现)
   */
  abstract execute(input: TInput): Promise<TOutput>;

  /**
   * 带重试和超时的执行包装器
   * 工具可以选择性地使用此方法包装其执行逻辑
   */
  protected async executeWithRetryAndTimeout(
    executeFunc: () => Promise<TOutput>
  ): Promise<TOutput> {
    const startTime = Date.now();
    const { maxRetries, baseTimeout, retryableErrors } = this.options;

    try {
      // 准备重试选项
      const retryOptions: RetryOptions = {
        maxRetries,
        retryableErrors,
        onRetry: (attempt, error) => {
          // 可以在这里添加日志
          console.warn(
            `[${this.name}] Retry attempt ${attempt}/${maxRetries} after error:`,
            error.message
          );
        },
      };

      // 准备超时选项
      const timeout = this.timeoutAdjuster
        ? this.timeoutAdjuster.getTimeout()
        : baseTimeout;

      const timeoutOptions: TimeoutOptions | undefined = timeout
        ? {
            timeout,
            toolName: this.name,
          }
        : undefined;

      // 执行带重试和超时的函数
      let result: TOutput;
      if (timeoutOptions) {
        result = await withRetry(
          () => withTimeout(executeFunc, timeoutOptions),
          retryOptions
        );
      } else {
        result = await withRetry(executeFunc, retryOptions);
      }

      // 记录执行时间用于动态超时调整
      if (this.timeoutAdjuster) {
        const executionTime = Date.now() - startTime;
        this.timeoutAdjuster.recordExecutionTime(executionTime);
      }

      return result;
    } catch (error) {
      // 转换错误为 ToolExecutionError
      if (error instanceof ToolTimeoutError) {
        throw error;
      }
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        error instanceof Error ? error.message : String(error),
        this.name,
        {
          cause: error instanceof Error ? error : undefined,
        }
      );
    }
  }

  /**
   * 判断错误是否可重试
   */
  protected isRetryable(error: unknown): boolean {
    if (error instanceof ToolTimeoutError) {
      return true;
    }
    if (error instanceof ToolExecutionError) {
      return error.retryable;
    }
    return false;
  }

  /**
   * 获取重试延迟时间
   */
  protected getRetryDelay(attempt: number): number {
    // 指数退避: 1s, 2s, 4s, 8s...
    return Math.min(1000 * Math.pow(2, attempt - 1), 30000);
  }

  /**
   * 权限检查方法（在工具执行前调用）
   * 子类可以重写此方法实现自定义权限检查逻辑
   *
   * @param input 工具输入参数
   * @returns 权限检查结果
   */
  async checkPermissions(input: TInput): Promise<PermissionCheckResult<TInput>> {
    // 默认行为：允许执行
    return {
      behavior: 'allow',
      updatedInput: input,
    };
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.getInputSchema(),
      shouldDefer: this.shouldDefer || undefined,
      searchHint: this.searchHint || undefined,
    };
  }

  protected success(output: string): ToolResult {
    return { success: true, output };
  }

  protected error(message: string): ToolResult {
    return { success: false, error: message };
  }
}

/**
 * 插件工具包装器 — 将插件注册的 ToolDefinition + executor 桥接为 BaseTool
 * 使插件工具能以标准 BaseTool 形式注册到 toolRegistry，从而被模型 API 识别
 */
export class PluginToolWrapper extends BaseTool {
  name: string;
  description: string;
  private _inputSchema: ToolDefinition['inputSchema'];
  private _executor: (input: unknown) => Promise<ToolResult>;
  /** 来源插件名称 */
  pluginName: string;

  constructor(
    definition: ToolDefinition,
    executor: (input: unknown) => Promise<ToolResult>,
    pluginName: string,
  ) {
    super();
    this.name = definition.name;
    this.description = definition.description;
    this._inputSchema = definition.inputSchema;
    this._executor = executor;
    this.pluginName = pluginName;
    // 插件工具默认 defer，避免膨胀核心工具列表
    this.shouldDefer = true;
    this.searchHint = definition.searchHint || `plugin tool from ${pluginName}`;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return this._inputSchema;
  }

  async execute(input: unknown): Promise<ToolResult> {
    return this._executor(input);
  }
}

/**
 * 单个工具的配置覆盖
 */
export interface ToolConfigOverride {
  /** 是否启用（false = 从工具列表中移除） */
  enabled?: boolean;
  /** 覆盖工具描述 */
  description?: string;
  /** 覆盖是否延迟加载 */
  shouldDefer?: boolean;
  /** 覆盖 searchHint */
  searchHint?: string;
}

/**
 * 工具配置文件格式 (~/.axon/tool-config.json)
 */
export type ToolConfigMap = Record<string, ToolConfigOverride>;

/**
 * 获取工具配置文件路径
 */
function getToolConfigPath(): string {
  const configDir = process.env.AXON_CONFIG_DIR || path.join(os.homedir(), '.axon');
  return path.join(configDir, 'tool-config.json');
}

/**
 * 加载工具配置覆盖
 */
function loadToolConfig(): ToolConfigMap {
  const configPath = getToolConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[ToolRegistry] Failed to load tool config from ${configPath}:`, err instanceof Error ? err.message : err);
  }
  return {};
}

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();
  /** 工具配置覆盖缓存 */
  private _toolConfig: ToolConfigMap | null = null;
  /** 配置文件最后修改时间（用于自动刷新） */
  private _toolConfigMtime: number = 0;

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取工具配置覆盖（带文件变更自动刷新）
   */
  getToolConfig(): ToolConfigMap {
    const configPath = getToolConfigPath();
    try {
      const stat = fs.statSync(configPath);
      const mtime = stat.mtimeMs;
      if (this._toolConfig && mtime === this._toolConfigMtime) {
        return this._toolConfig;
      }
      this._toolConfig = loadToolConfig();
      this._toolConfigMtime = mtime;
    } catch {
      // 文件不存在或不可读
      if (this._toolConfig === null) {
        this._toolConfig = {};
      }
    }
    return this._toolConfig;
  }

  /**
   * 强制重新加载工具配置
   */
  reloadToolConfig(): void {
    this._toolConfig = null;
    this._toolConfigMtime = 0;
  }

  getAll(): BaseTool[] {
    const config = this.getToolConfig();
    return Array.from(this.tools.values()).filter(tool => {
      const override = config[tool.name];
      return !override || override.enabled !== false;
    });
  }

  getDefinitions(): ToolDefinition[] {
    const config = this.getToolConfig();
    return Array.from(this.tools.values())
      .filter(tool => {
        const override = config[tool.name];
        return !override || override.enabled !== false;
      })
      .map(tool => {
        const def = tool.getDefinition();
        const override = config[tool.name];
        if (!override) return def;

        // 应用配置覆盖
        return {
          ...def,
          ...(override.description !== undefined && { description: override.description }),
          ...(override.shouldDefer !== undefined && { shouldDefer: override.shouldDefer }),
          ...(override.searchHint !== undefined && { searchHint: override.searchHint }),
        };
      });
  }

  /**
   * 获取立即加载的工具定义（非 deferred）
   * 对齐官方：启动时发送完整 schema 给 API 的工具
   */
  getImmediateDefinitions(): ToolDefinition[] {
    return this.getDefinitions().filter(def => !def.shouldDefer && !def.isMcp);
  }

  /**
   * 获取延迟加载的工具定义（deferred）
   * 对齐官方：只在 <available-deferred-tools> 列表中出现名称，
   * 完整 schema 通过 ToolSearch 按需获取
   */
  getDeferredDefinitions(): ToolDefinition[] {
    return this.getDefinitions().filter(def => def.shouldDefer === true || def.isMcp === true);
  }

  /**
   * 执行工具（带权限检查）
   * @param name 工具名称
   * @param input 工具输入参数
   * @param onPermissionRequest 权限请求回调函数（可选）
   * @returns 工具执行结果
   */
  async execute(
    name: string,
    input: unknown,
    onPermissionRequest?: (toolName: string, toolInput: unknown, message?: string) => Promise<boolean>
  ): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      return { success: false, error: t('base.toolNotFound', { name }) };
    }

    try {
      // 1. 执行权限预检查
      const permResult = await tool.checkPermissions(input);

      // 2. 处理权限检查结果
      if (permResult.behavior === 'deny') {
        // 拒绝执行
        return {
          success: false,
          error: permResult.message || t('base.permissionDeniedByCheck'),
        };
      }

      // 3. 如果需要询问用户
      if (permResult.behavior === 'ask') {
        // 如果没有提供权限请求回调，默认拒绝
        if (!onPermissionRequest) {
          return {
            success: false,
            error: permResult.message || t('base.permissionRequired'),
          };
        }

        // 调用权限请求回调，等待用户批准
        const approved = await onPermissionRequest(name, input, permResult.message);

        if (!approved) {
          return {
            success: false,
            error: t('base.permissionDenied'),
          };
        }
      }

      // 4. 使用更新后的输入参数（如果有）
      const finalInput = permResult.updatedInput !== undefined ? permResult.updatedInput : input;

      // 5. 执行工具
      return await tool.execute(finalInput);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

export const toolRegistry = new ToolRegistry();
