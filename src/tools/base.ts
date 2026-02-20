/**
 * 工具基类
 * 所有工具都继承自此基类
 */

import type { ToolDefinition, ToolResult } from '../types/index.js';
import { t } from '../i18n/index.js';
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
    };
  }

  protected success(output: string): ToolResult {
    return { success: true, output };
  }

  protected error(message: string): ToolResult {
    return { success: false, error: message };
  }
}

export class ToolRegistry {
  private tools: Map<string, BaseTool> = new Map();

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  getAll(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(tool => tool.getDefinition());
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
