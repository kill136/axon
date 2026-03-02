/**
 * WebUI 后台任务管理器
 * 管理 Task 工具启动的后台 Agent 任务
 */

import { randomUUID } from 'crypto';
import { ConversationLoop, type LoopOptions } from '../../core/loop.js';
import type { Message } from '../../types/index.js';
import type { WebSocket } from 'ws';
import {
  getAgentTypeDefinition,
  getAllActiveAgents,
  resolveAgentModel,
  parseToolsWithAgentTypeRestriction,
  type AgentTypeDefinition,
  BUILT_IN_AGENT_TYPES,
} from '../../tools/agent.js';
import {
  runSubagentStartHooks,
  runSubagentStopHooks,
} from '../../hooks/index.js';
import { configManager } from '../../config/index.js';

/**
 * 子 agent 工具调用信息
 */
export interface SubagentToolCall {
  id: string;
  name: string;
  input?: unknown;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

/**
 * 任务信息
 */
export interface TaskInfo {
  id: string;
  description: string;
  agentType: string;
  prompt: string;
  model?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: Date;
  endTime?: Date;
  result?: string;
  error?: string;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
  workingDirectory?: string;
  metadata?: Record<string, any>;
  /** 对应的 Claude API tool_use block ID，用于前端精确匹配 */
  toolUseId?: string;
  /** 子 agent 执行的工具调用列表 */
  toolCalls?: SubagentToolCall[];
  /** 工具调用计数 */
  toolUseCount?: number;
  /** 最后执行的工具信息 */
  lastToolInfo?: string;
  /** v12.0: 结构化错误信息（失败时） */
  structuredError?: {
    /** 已完成的步骤 */
    completedSteps: string[];
    /** 失败的具体步骤 */
    failedStep?: { name: string; reason: string };
    /** 建议的恢复策略 */
    suggestion: 'retry' | 'escalate' | 'manual';
  };
}

/**
 * 任务执行上下文
 */
interface TaskExecutionContext {
  task: TaskInfo;
  agentDef: AgentTypeDefinition;
  messages: Message[];
  loop?: ConversationLoop;
  abortController?: AbortController;
  /** 主 agent 的认证信息，供子 agent 复用 */
  clientConfig?: { apiKey?: string; authToken?: string; baseUrl?: string };
  /** 禁用的工具列表（防止子 agent 递归调用特定工具） */
  disallowedTools?: string[];
  /** 用户指定的最大轮次 */
  maxTurns?: number;
}

/**
 * 任务管理器
 */
export class TaskManager {
  private tasks = new Map<string, TaskExecutionContext>();
  private outputBuffers = new Map<string, string>();
  private ws?: WebSocket;

  // v12.0: 自动清理配置
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly TASK_RETENTION_MS = 30 * 60 * 1000;  // 30分钟后清理已完成的任务
  private readonly MAX_COMPLETED_TASKS = 50;
  
  // 输出截断限制（对齐其他工具如 Bash/Grep 的 30KB 限制）
  private readonly MAX_TASK_OUTPUT = 30000;

  constructor() {
    // v12.0: 启动定期清理（每5分钟检查一次）
    this.cleanupTimer = setInterval(() => this.autoCleanup(), 5 * 60 * 1000);
  }

  /**
   * v12.0: 销毁时清理定时器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * v12.0: 自动清理过期的已完成/失败任务
   */
  private autoCleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, context] of this.tasks.entries()) {
      const task = context.task;
      if (task.status === 'running') continue;

      const endTime = task.endTime?.getTime() || task.startTime.getTime();
      if (now - endTime > this.TASK_RETENTION_MS) {
        this.tasks.delete(taskId);
        this.outputBuffers.delete(taskId);
        cleaned++;
      }
    }

    // 如果已完成任务超过上限，按时间排序清理最老的
    const completedTasks: Array<{ id: string; endTime: number }> = [];
    for (const [taskId, context] of this.tasks.entries()) {
      const task = context.task;
      if (task.status !== 'running') {
        completedTasks.push({ id: taskId, endTime: task.endTime?.getTime() || task.startTime.getTime() });
      }
    }
    if (completedTasks.length > this.MAX_COMPLETED_TASKS) {
      completedTasks.sort((a, b) => a.endTime - b.endTime);
      const excess = completedTasks.length - this.MAX_COMPLETED_TASKS;
      for (let i = 0; i < excess; i++) {
        this.tasks.delete(completedTasks[i].id);
        this.outputBuffers.delete(completedTasks[i].id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[TaskManager] Auto-cleaned ${cleaned} expired tasks`);
    }
  }

  /**
   * 设置 WebSocket 连接以发送状态更新
   */
  setWebSocket(ws: WebSocket): void {
    this.ws = ws;
  }

  /**
   * 发送任务状态更新到前端
   */
  private sendTaskStatus(task: TaskInfo): void {
    if (this.ws && this.ws.readyState === 1) { // WebSocket.OPEN
      try {
        this.ws.send(JSON.stringify({
          type: 'task_status',
          payload: {
            taskId: task.id,
            toolUseId: task.toolUseId,
            status: task.status,
            result: task.result,
            error: task.error,
            progress: task.progress,
            toolUseCount: task.toolUseCount,
            lastToolInfo: task.lastToolInfo,
          },
        }));
      } catch (error) {
        console.error('[TaskManager] Failed to send task status:', error);
      }
    }
  }

  /**
   * 发送子 agent 工具开始事件
   */
  private sendSubagentToolStart(taskId: string, toolCall: SubagentToolCall, toolUseId?: string): void {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({
          type: 'subagent_tool_start',
          payload: {
            taskId,
            toolUseId,
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
              status: toolCall.status,
              startTime: toolCall.startTime,
            },
          },
        }));
      } catch (error) {
        console.error('[TaskManager] Failed to send subagent tool start event:', error);
      }
    }
  }

  /**
   * 发送子 agent 工具结束事件
   */
  private sendSubagentToolEnd(taskId: string, toolCall: SubagentToolCall, toolUseId?: string): void {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({
          type: 'subagent_tool_end',
          payload: {
            taskId,
            toolUseId,
            toolCall: {
              id: toolCall.id,
              name: toolCall.name,
              status: toolCall.status,
              result: toolCall.result,
              error: toolCall.error,
              endTime: toolCall.endTime,
            },
          },
        }));
      } catch (error) {
        console.error('[TaskManager] Failed to send subagent tool end event:', error);
      }
    }
  }

  /**
   * 创建新任务
   */
  async createTask(
    description: string,
    prompt: string,
    agentType: string,
    options?: {
      model?: string;
      runInBackground?: boolean;
      parentMessages?: Message[];
      workingDirectory?: string;
      /** 主 agent 的认证信息，传递给子 agent 复用 */
      clientConfig?: { apiKey?: string; authToken?: string; baseUrl?: string };
      /** 对应的 Claude API tool_use block ID，用于前端精确匹配多个 Task */
      toolUseId?: string;
      /** 用户指定的最大轮次 */
      maxTurns?: number;
    }
  ): Promise<string> {
    // 验证代理类型
    const agentDef = getAgentTypeDefinition(agentType);
    if (!agentDef) {
      throw new Error(
        `Unknown agent type: ${agentType}. Available: ${getAllActiveAgents().map(d => d.agentType).join(', ')}`
      );
    }

    const taskId = randomUUID();

    // 创建任务信息
    const task: TaskInfo = {
      id: taskId,
      description,
      agentType,
      prompt,
      model: options?.model,
      status: 'running',
      startTime: new Date(),
      workingDirectory: options?.workingDirectory || process.cwd(),
      metadata: {},
      toolUseId: options?.toolUseId,
    };

    // 构建初始消息
    let initialMessages: Message[] = [];

    // 如果代理支持 forkContext，添加父对话历史
    if (agentDef.forkContext && options?.parentMessages && options.parentMessages.length > 0) {
      initialMessages = options.parentMessages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .map(msg => ({
          role: msg.role,
          content: typeof msg.content === 'string' ? msg.content :
                   Array.isArray(msg.content) ? msg.content.filter(block => block.type === 'text') : [],
        }));
    }

    // 添加当前任务提示
    initialMessages.push({
      role: 'user',
      content: prompt,
    });

    // 创建执行上下文
    const context: TaskExecutionContext = {
      task,
      agentDef,
      messages: initialMessages,
      abortController: new AbortController(),
      clientConfig: options?.clientConfig,
      maxTurns: options?.maxTurns,
    };

    this.tasks.set(taskId, context);

    // 发送任务创建通知
    this.sendTaskStatus(task);

    // 仅当明确要求后台执行时才自动启动
    // executeTaskSync 会传 runInBackground=false，自行控制执行
    if (options?.runInBackground === true) {
      this.executeTaskInBackground(context);
    }

    return taskId;
  }

  /**
   * 获取任务信息
   */
  getTask(taskId: string): TaskInfo | undefined {
    const context = this.tasks.get(taskId);
    return context?.task;
  }

  /**
   * 获取所有任务
   */
  listTasks(): TaskInfo[] {
    return Array.from(this.tasks.values()).map(ctx => ctx.task);
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const context = this.tasks.get(taskId);
    if (!context) return false;

    if (context.task.status === 'running') {
      context.task.status = 'cancelled';
      context.task.endTime = new Date();
      context.task.error = 'Cancelled by user';
      context.abortController?.abort();

      // 发送状态更新
      this.sendTaskStatus(context.task);

      return true;
    }

    return false;
  }

  /**
   * 获取任务输出
   */
  getTaskOutput(taskId: string): string | undefined {
    const context = this.tasks.get(taskId);
    if (!context) return undefined;

    const buffer = this.outputBuffers.get(taskId);
    if (buffer) return buffer;

    if (context.task.status === 'completed') {
      return context.task.result;
    } else if (context.task.status === 'failed') {
      return context.task.error;
    }

    return undefined;
  }

  /**
   * 清理已完成的任务
   */
  clearCompletedTasks(): number {
    let cleared = 0;
    for (const [taskId, context] of this.tasks.entries()) {
      if (context.task.status === 'completed' || context.task.status === 'failed' || context.task.status === 'cancelled') {
        this.tasks.delete(taskId);
        this.outputBuffers.delete(taskId);
        cleared++;
      }
    }
    return cleared;
  }

  /**
   * 后台执行任务（流式执行，实时推送子 agent 进度）
   */
  private async executeTaskInBackground(context: TaskExecutionContext): Promise<void> {
    const { task, agentDef, messages } = context;

    // 初始化工具调用追踪
    task.toolCalls = [];
    task.toolUseCount = 0;

    // 当前正在执行的工具调用（按 toolName 追踪，因为流式接口没有 id）
    const activeToolCalls = new Map<string, SubagentToolCall>();
    let toolCallCounter = 0;

    try {
      // 日志：子 agent 开始执行
      console.log(`[SubAgent:${task.agentType}] 🚀 Starting task: ${task.description}`);
      console.log(`[SubAgent:${task.agentType}] 📝 Prompt: ${task.prompt.substring(0, 100)}${task.prompt.length > 100 ? '...' : ''}`);

      // 调用 SubagentStart Hook
      await runSubagentStartHooks(task.id, task.agentType);

      // 解析模型参数（对齐 CLI agent.ts 的 resolveAgentModel）
      const resolvedModel = resolveAgentModel(task.model, agentDef.model);

      // 从配置管理器获取完整配置（对齐 CLI agent.ts）
      const config = configManager.getAll();
      const fallbackModel = config.fallbackModel as string | undefined;
      const debug = config.debug as boolean | undefined;

      // 解析 tools 中的 Task(agent_type) 语法（对齐 CLI agent.ts）
      let effectiveTools = agentDef.tools;
      let childAllowedSubagentTypes = agentDef.allowedSubagentTypes;
      if (effectiveTools && !childAllowedSubagentTypes) {
        const parsed = parseToolsWithAgentTypeRestriction(effectiveTools);
        effectiveTools = parsed.tools;
        childAllowedSubagentTypes = parsed.allowedSubagentTypes;
      }

      // 构建 LoopOptions（对齐 CLI agent.ts 的 executeAgentLoop）
      const loopOptions: LoopOptions = {
        model: resolvedModel,
        maxTurns: context.maxTurns || agentDef.maxTurns || 100,
        verbose: process.env.AXON_VERBOSE === 'true',
        permissionMode: agentDef.permissionMode || 'default',
        allowedTools: effectiveTools,
        workingDir: task.workingDirectory,
        systemPrompt: agentDef.getSystemPrompt?.(),
        thinking: config.thinking,
        fallbackModel,
        debug,
        isSubAgent: true,
        mcpTools: [],
        allowedSubagentTypes: childAllowedSubagentTypes,
        // 传递主 agent 的认证信息，让子 agent 复用（避免子 agent 自己 initAuth 拿到不同凭证）
        apiKey: context.clientConfig?.apiKey,
        authToken: context.clientConfig?.authToken,
        baseUrl: context.clientConfig?.baseUrl,
        // 禁用指定工具（防止递归调度等问题）
        disallowedTools: context.disallowedTools,
      };

      // 创建对话循环
      const loop = new ConversationLoop(loopOptions);
      context.loop = loop;

      // 如果有初始上下文消息，注入到 session 中
      if (messages.length > 1) {
        const session = loop.getSession();
        const contextMessages = messages.slice(0, -1);
        for (const msg of contextMessages) {
          session.addMessage(msg);
        }
      }

      // 收集文本输出
      const textChunks: string[] = [];

      // 使用流式执行，实时推送子 agent 进度
      for await (const event of loop.processMessageStream(task.prompt)) {
        switch (event.type) {
          case 'text':
            // 收集文本输出
            if (event.content) {
              textChunks.push(event.content);
            }
            break;

          case 'tool_start':
            // 工具开始执行
            if (event.toolName) {
              toolCallCounter++;
              const toolCallId = `${task.id}-tool-${toolCallCounter}`;
              const toolCall: SubagentToolCall = {
                id: toolCallId,
                name: event.toolName,
                input: event.toolInput,
                status: 'running',
                startTime: Date.now(),
              };

              // 用唯一 ID 作为 key（修复并行执行同名工具时互相覆盖的问题）
              activeToolCalls.set(toolCallId, toolCall);
              task.toolCalls!.push(toolCall);
              task.toolUseCount = toolCallCounter;
              task.lastToolInfo = event.toolName;

              // 日志输出子 agent 工具执行过程
              const inputPreview = event.toolInput
                ? JSON.stringify(event.toolInput).substring(0, 200)
                : '';
              console.log(`[SubAgent:${task.agentType}] 🔧 Tool #${toolCallCounter}: ${event.toolName}${inputPreview ? ` | Input: ${inputPreview}${inputPreview.length >= 200 ? '...' : ''}` : ''}`);

              // 推送到前端
              this.sendSubagentToolStart(task.id, toolCall, task.toolUseId);

              // 更新任务状态（带进度信息）
              this.sendTaskStatus(task);
            }
            break;

          case 'tool_end':
            // 工具执行结束
            // 按 toolName 反查仍在 running 的最早同名工具（因为并行执行同名工具时需要按顺序匹配）
            if (event.toolName) {
              let matchedId: string | undefined;
              let matchedCall: SubagentToolCall | undefined;
              for (const [id, tc] of activeToolCalls) {
                if (tc.name === event.toolName && tc.status === 'running') {
                  matchedId = id;
                  matchedCall = tc;
                  break;
                }
              }
              if (matchedId && matchedCall) {
                matchedCall.status = event.toolError ? 'error' : 'completed';
                matchedCall.result = event.toolResult;
                matchedCall.error = event.toolError;
                matchedCall.endTime = Date.now();
                const duration = matchedCall.endTime - matchedCall.startTime;

                // 日志输出子 agent 工具执行结果
                const resultPreview = event.toolResult
                  ? String(event.toolResult).substring(0, 150).replace(/\n/g, ' ')
                  : '';
                const statusIcon = event.toolError ? '❌' : '✅';
                console.log(`[SubAgent:${task.agentType}] ${statusIcon} Tool ${event.toolName} (${duration}ms)${event.toolError ? ` | Error: ${event.toolError}` : resultPreview ? ` | Result: ${resultPreview}${resultPreview.length >= 150 ? '...' : ''}` : ''}`);

                // 从活动列表移除
                activeToolCalls.delete(matchedId);

                // 推送到前端
                this.sendSubagentToolEnd(task.id, matchedCall, task.toolUseId);
              }
            }
            break;

          case 'done':
            // 流式处理完成 — 检测 maxTurns 截断
            if (event.content === '[max_turns_reached]') {
              task.status = 'failed';
              task.endTime = new Date();
              task.error = 'Max turns reached, task incomplete';
              this.sendTaskStatus(task);
              await runSubagentStopHooks(task.id, task.agentType);
              return;
            }
            break;

          case 'interrupted':
            // 被中断
            task.status = 'cancelled';
            task.endTime = new Date();
            task.error = event.content || 'Interrupted';
            this.sendTaskStatus(task);
            await runSubagentStopHooks(task.id, task.agentType);
            return;
        }
      }

      // 任务完成
      task.status = 'completed';
      task.endTime = new Date();
      
      // 拼接完整输出
      let fullOutput = textChunks.join('');
      
      // 输出截断（对齐其他工具的 30KB 限制）
      const MAX_TASK_OUTPUT = 30000;
      if (fullOutput.length > MAX_TASK_OUTPUT) {
        const headSize = 15000;
        const tailSize = 15000;
        const head = fullOutput.substring(0, headSize);
        const tail = fullOutput.substring(fullOutput.length - tailSize);
        fullOutput = `${head}\n\n... [Output truncated: ${fullOutput.length} chars → ${MAX_TASK_OUTPUT} chars] ...\n\n${tail}`;
      }
      
      task.result = fullOutput || `Task completed (${toolCallCounter} tool calls, no text output)`;
      const totalDuration = task.endTime.getTime() - task.startTime.getTime();

      // 日志：子 agent 完成
      console.log(`[SubAgent:${task.agentType}] ✅ Task completed (duration: ${totalDuration}ms, tool calls: ${toolCallCounter})`);
      if (task.result) {
        const resultPreview = task.result.substring(0, 200).replace(/\n/g, ' ');
        console.log(`[SubAgent:${task.agentType}] 📤 Result: ${resultPreview}${task.result.length > 200 ? '...' : ''}`);
      }

      // 保存输出到缓冲区
      this.outputBuffers.set(task.id, task.result);

      // 发送状态更新
      this.sendTaskStatus(task);

      // 调用 SubagentStop Hook
      await runSubagentStopHooks(task.id, task.agentType);

    } catch (error) {
      // 任务失败 — 保留完整堆栈用于诊断
      task.status = 'failed';
      task.endTime = new Date();
      const errorMsg = error instanceof Error ? (error.message || error.constructor.name) : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      task.error = errorMsg || 'Unknown error';
      const totalDuration = task.endTime.getTime() - task.startTime.getTime();

      // v12.0: 构建结构化错误
      const completedTools = (task.toolCalls || [])
        .filter(tc => tc.status === 'completed').map(tc => tc.name);
      const failedTool = (task.toolCalls || []).find(tc => tc.status === 'error');
      task.structuredError = {
        completedSteps: completedTools,
        failedStep: failedTool
          ? { name: failedTool.name, reason: failedTool.error || task.error }
          : undefined,
        suggestion: task.error.includes('timeout') || task.error.includes('rate_limit')
          ? 'retry'
          : task.error.includes('permission') || task.error.includes('forbidden')
            ? 'manual'
            : 'escalate',
      };

      // 日志：子 agent 失败（含完整堆栈）
      console.error(`[SubAgent:${task.agentType}] Task failed (duration: ${totalDuration}ms): ${errorMsg}${errorStack ? '\n' + errorStack : ''}`);

      // 发送状态更新
      this.sendTaskStatus(task);

      // 调用 SubagentStop Hook（即使失败也要调用）
      await runSubagentStopHooks(task.id, task.agentType);
    }
  }

  /**
   * 执行定时任务的子 agent（ScheduleTask inline 执行专用）
   * 复用 TaskManager 的流式子 agent 推送机制，让前端能实时看到工具调用过程
   */
  async executeScheduleTaskInline(
    taskName: string,
    prompt: string,
    options: {
      model?: string;
      workingDirectory?: string;
      clientConfig?: { apiKey?: string; authToken?: string; baseUrl?: string };
    }
  ): Promise<{ success: boolean; output?: string; error?: string; taskId: string; durationMs: number }> {
    const taskId = await this.createTask(
      `ScheduleTask: ${taskName}`,
      prompt,
      'general-purpose',
      {
        model: options.model || 'sonnet',
        workingDirectory: options.workingDirectory,
        clientConfig: options.clientConfig,
        runInBackground: false,
      }
    );

    const context = this.tasks.get(taskId);
    if (!context) {
      return { success: false, error: 'Failed to create task context', taskId, durationMs: 0 };
    }

    // 定时任务执行环境中禁用特定工具，防止递归调度
    // 与 executor.ts 保持一致
    context.disallowedTools = ['ScheduleTask', 'AskUserQuestion'];

    const startedAt = Date.now();

    // 执行（复用已有的流式子 agent 逻辑，自动推送 subagent_tool_start/end 到前端）
    await this.executeTaskInBackground(context);

    const endedAt = Date.now();
    const task = context.task;

    if (task.status === 'completed') {
      return {
        success: true,
        output: task.result,
        taskId,
        durationMs: endedAt - startedAt,
      };
    } else {
      return {
        success: false,
        error: task.error || 'Task failed',
        taskId,
        durationMs: endedAt - startedAt,
      };
    }
  }

  /**
   * 同步执行任务（阻塞直到完成）
   */
  async executeTaskSync(
    description: string,
    prompt: string,
    agentType: string,
    options?: {
      model?: string;
      parentMessages?: Message[];
      workingDirectory?: string;
      /** 主 agent 的认证信息，传递给子 agent 复用 */
      clientConfig?: { apiKey?: string; authToken?: string; baseUrl?: string };
      /** 对应的 Claude API tool_use block ID，用于前端精确匹配多个 Task */
      toolUseId?: string;
      /** 用户指定的最大轮次 */
      maxTurns?: number;
    }
  ): Promise<{ success: boolean; output?: string; error?: string; taskId: string; structuredError?: TaskInfo['structuredError'] }> {
    const taskId = await this.createTask(description, prompt, agentType, {
      ...options,
      runInBackground: false,
    });

    const context = this.tasks.get(taskId);
    if (!context) {
      return {
        success: false,
        error: 'Failed to create task',
        taskId,
      };
    }

    // 执行任务
    await this.executeTaskInBackground(context);

    const task = context.task;

    if (task.status === 'completed') {
      return {
        success: true,
        output: task.result,
        taskId,
      };
    } else {
      return {
        success: false,
        error: task.error || 'Task failed',
        taskId,
        structuredError: task.structuredError,
      };
    }
  }
}
