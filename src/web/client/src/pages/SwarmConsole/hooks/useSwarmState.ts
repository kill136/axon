/**
 * useSwarmState Hook - v2.0 完整版
 * 管理蜂群系统的状态，监听 WebSocket 消息并更新状态
 *
 * v2.0 变化：
 * - 移除 Queen 相关代码，使用 RealtimeCoordinator 直接调度
 * - 简化 Worker 状态管理
 * - 新增 ExecutionPlan、GitBranches、CostEstimate 支持
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSwarmWebSocket, UseSwarmWebSocketOptions } from './useSwarmWebSocket';
import { logsApi } from '../../../api/blueprint';
import type {
  SwarmState,
  SwarmServerMessage,
  UseSwarmStateReturn,
  TaskNode,
  WorkerAgent,
  LeadStreamPayload,
  LeadStreamBlock,
  LeadEventPayload,
  LeadAgentPhase,
} from '../types';

// 工具调用 ID 计数器，确保唯一性
let toolIdCounter = 0;

const initialState: SwarmState = {
  blueprint: null,
  taskTree: null,
  workers: [],
  stats: null,
  status: 'disconnected',
  error: null,
  // v2.0 新增
  executionPlan: null,
  gitBranches: [],
  costEstimate: null,
  // v2.0: Planner 状态
  plannerState: {
    phase: 'idle',
    message: '',
  },
  // v2.1: 任务日志
  taskLogs: {},
  // v2.1: 任务流式内容
  taskStreams: {},
  // v3.4: 验收测试
  verification: { status: 'idle' },
  // v3.5: 冲突状态
  conflicts: { conflicts: [], resolvingId: null },
  // v4.2: AskUserQuestion 对话框
  askUserDialog: { visible: false, requestId: null, questions: [] },
  // v4.5: 用户插嘴状态
  interjectStatus: null,
  // v9.0: LeadAgent 持久大脑状态
  leadAgent: {
    phase: 'idle' as const,
    stream: [],
    events: [],
    lastUpdated: '',
  },
  // v9.2: LeadAgent 插嘴状态
  leadInterjectStatus: null,
};

export interface UseSwarmStateOptions extends Omit<UseSwarmWebSocketOptions, 'onMessage' | 'onError'> {
  blueprintId?: string;
}

export function useSwarmState(options: UseSwarmStateOptions): UseSwarmStateReturn {
  const { blueprintId, ...wsOptions } = options;

  const [state, setState] = useState<SwarmState>(initialState);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 处理 WebSocket 消息
  const handleMessage = useCallback((message: SwarmServerMessage) => {
    switch (message.type) {
      case 'swarm:state':
        // 完整状态更新
        setState(prev => {
          const newPlan = 'executionPlan' in message.payload
            ? (message.payload.executionPlan || null)
            : prev.executionPlan;

          // v4.2 修复：检测到新执行开始或执行计划变化时，清空旧的任务日志状态
          // 这样可以避免 Task ID 复用时，新任务关联到旧日志的问题
          let newTaskLogs = prev.taskLogs;
          let newTaskStreams = prev.taskStreams;

          if (newPlan && prev.executionPlan) {
            // 如果执行计划 ID 变化，说明是新的执行
            if (newPlan.id !== prev.executionPlan.id) {
              console.log('[SwarmState] New execution detected, clearing old task log state');
              newTaskLogs = {};
              newTaskStreams = {};
            }
          } else if (newPlan && !prev.executionPlan) {
            // 从无执行计划到有执行计划，也清空旧状态
            console.log('[SwarmState] New execution plan, clearing task log state');
            newTaskLogs = {};
            newTaskStreams = {};
          }

          // v4.8: 恢复 E2E 验收测试状态（刷新浏览器后恢复上下文）
          let newVerification = prev.verification;
          if ('verification' in message.payload && message.payload.verification) {
            const v = message.payload.verification as { status: string; e2eTaskId?: string; result?: any };
            console.log(`[SwarmState] Restoring acceptance test state from server: ${v.status}, e2eTaskId=${v.e2eTaskId}`);
            newVerification = {
              status: v.status as any,
              e2eTaskId: v.e2eTaskId,
              result: v.result,
            };
          }

          // v9.2: 恢复 LeadAgent 状态（刷新浏览器后恢复上下文）
          let newLeadAgent = prev.leadAgent;
          if ('leadAgent' in message.payload && message.payload.leadAgent) {
            const la = message.payload.leadAgent as {
              phase: string;
              stream: LeadStreamBlock[];
              events: Array<{ type: string; data: Record<string, unknown>; timestamp: string }>;
              systemPrompt?: string;
              lastUpdated: string;
            };
            console.log(`[SwarmState] Restoring LeadAgent state from server: phase=${la.phase}, stream=${la.stream.length} blocks, events=${la.events.length}`);
            newLeadAgent = {
              phase: la.phase as LeadAgentPhase,
              stream: la.stream,
              events: la.events,
              systemPrompt: la.systemPrompt,
              lastUpdated: la.lastUpdated,
            };
          }

          return {
            ...prev,
            blueprint: message.payload.blueprint,
            taskTree: message.payload.taskTree,
            workers: message.payload.workers,
            stats: message.payload.stats,
            error: null,
            // v2.0 新增字段
            // v2.1 修复：只有当 payload 中明确包含这些字段时才更新，避免意外覆盖
            executionPlan: newPlan,
            gitBranches: 'gitBranches' in message.payload
              ? (message.payload.gitBranches || [])
              : prev.gitBranches,
            costEstimate: 'costEstimate' in message.payload
              ? (message.payload.costEstimate || null)
              : prev.costEstimate,
            // v4.2 修复：根据执行计划变化决定是否清空日志
            taskLogs: newTaskLogs,
            taskStreams: newTaskStreams,
            // v4.8: 恢复验收测试状态
            verification: newVerification,
            // v9.2: 恢复 LeadAgent 状态
            leadAgent: newLeadAgent,
          };
        });
        setIsLoading(false);
        break;

      case 'swarm:task_update':
        // 任务更新 - 同时更新 taskTree 和 executionPlan
        console.log(`[SwarmState] Received task update: taskId=${message.payload.taskId}, action=${(message.payload as any).action || 'update'}, updates=`, message.payload.updates);
        setState(prev => {
          let newState = { ...prev };

          // v9.0: 处理动态新增任务
          if ((message.payload as any).action === 'add' && (message.payload as any).task) {
            const newTask = (message.payload as any).task;
            console.log(`[SwarmState] Dynamically adding task: ${newTask.id} - ${newTask.name}`);

            if (prev.executionPlan) {
              // 检查是否已存在（避免重复）
              const exists = prev.executionPlan.tasks.some(t => t.id === newTask.id);
              if (!exists) {
                newState.executionPlan = {
                  ...prev.executionPlan,
                  tasks: [...prev.executionPlan.tasks, newTask],
                  // 添加到最后一个并行组
                  parallelGroups: prev.executionPlan.parallelGroups.length > 0
                    ? [
                        ...prev.executionPlan.parallelGroups.slice(0, -1),
                        [...prev.executionPlan.parallelGroups[prev.executionPlan.parallelGroups.length - 1], newTask.id],
                      ]
                    : [[newTask.id]],
                };
              }
            }
            return newState;
          }

          // 更新 taskTree
          if (prev.taskTree) {
            const updateTaskNode = (node: TaskNode): TaskNode => {
              if (node.id === message.payload.taskId) {
                return { ...node, ...message.payload.updates };
              }
              if (node.children && node.children.length > 0) {
                return {
                  ...node,
                  children: node.children.map(updateTaskNode),
                };
              }
              return node;
            };

            newState.taskTree = {
              ...prev.taskTree,
              root: updateTaskNode(prev.taskTree.root),
            };
          }

          // v2.1: 同时更新 executionPlan 中的任务状态（解决界面不刷新问题）
          if (prev.executionPlan) {
            // 调试：检查是否找到匹配的任务
            const matchingTask = prev.executionPlan.tasks.find(t => t.id === message.payload.taskId);
            console.log(`[SwarmState] Matching task found: ${matchingTask ? matchingTask.name : 'NOT FOUND'}, taskId=${message.payload.taskId}`);
            if (!matchingTask) {
              console.log(`[SwarmState] Available task IDs:`, prev.executionPlan.tasks.map(t => t.id));
            }

            newState.executionPlan = {
              ...prev.executionPlan,
              tasks: prev.executionPlan.tasks.map(task =>
                task.id === message.payload.taskId
                  ? { ...task, ...message.payload.updates }
                  : task
              ),
            };
          }

          return newState;
        });
        break;

      case 'swarm:worker_update':
        // Worker 更新
        setState(prev => {
          const workerId = message.payload.workerId;
          const existingWorker = prev.workers.find(w => w.id === workerId);

          if (existingWorker) {
            return {
              ...prev,
              workers: prev.workers.map(worker =>
                worker.id === workerId
                  ? { ...worker, ...message.payload.updates }
                  : worker
              ),
            };
          } else {
            // 添加新的 Worker（v2.0 简化版）
            const newWorker: WorkerAgent = {
              id: workerId,
              status: 'idle',
              currentTaskId: undefined,
              currentTaskName: undefined,
              branchName: undefined,
              progress: 0,
              errorCount: 0,
              createdAt: new Date().toISOString(),
              lastActiveAt: new Date().toISOString(),
              ...message.payload.updates,
            };
            return {
              ...prev,
              workers: [...prev.workers, newWorker],
            };
          }
        });
        break;

      case 'swarm:completed':
        // 蜂群完成
        setState(prev => ({
          ...prev,
          stats: message.payload.stats,
          blueprint: prev.blueprint
            ? { ...prev.blueprint, status: 'completed' }
            : null,
          // 同时更新 executionPlan 状态，以显示验收测试面板
          executionPlan: prev.executionPlan
            ? { ...prev.executionPlan, status: 'completed' as const }
            : null,
        }));
        break;

      case 'swarm:error':
        // 蜂群错误
        setError(message.payload.error);
        setIsLoading(false);
        setState(prev => ({
          ...prev,
          error: message.payload.error,
          blueprint: prev.blueprint
            ? { ...prev.blueprint, status: 'failed' }
            : null,
        }));
        break;

      case 'swarm:paused':
        // 蜂群已暂停
        setState(prev => ({
          ...prev,
          blueprint: prev.blueprint
            ? { ...prev.blueprint, status: 'paused' }
            : null,
        }));
        console.log('[SwarmState] Swarm paused');
        break;

      case 'swarm:resumed':
        // 蜂群已恢复
        setState(prev => ({
          ...prev,
          blueprint: prev.blueprint
            ? { ...prev.blueprint, status: 'executing' }
            : null,
        }));
        console.log('[SwarmState] Swarm resumed');
        break;

      case 'swarm:stats_update':
        // 统计信息更新
        setState(prev => ({
          ...prev,
          stats: message.payload.stats,
        }));
        break;

      case 'swarm:memory_update':
        // v5.0: 蜂群共享记忆更新
        setState(prev => {
          if (!prev.blueprint) return prev;
          return {
            ...prev,
            blueprint: {
              ...prev.blueprint,
              swarmMemory: message.payload.swarmMemory,
            },
          };
        });
        console.log(`[SwarmState] Memory update: ${message.payload.swarmMemory?.completedTasks?.length || 0} completed tasks`);
        break;

      case 'swarm:planner_update':
        // v2.0: Planner 状态更新（探索/分解）
        setState(prev => ({
          ...prev,
          plannerState: {
            phase: message.payload.phase,
            message: message.payload.message,
            exploration: message.payload.exploration,
          },
        }));
        console.log(`[SwarmState] Planner phase: ${message.payload.phase} - ${message.payload.message}`);
        break;

      case 'swarm:worker_log':
        // v2.1: Worker 日志消息
        setState(prev => {
          const { taskId, log } = message.payload;
          if (!taskId) return prev;

          const existingLogs = prev.taskLogs[taskId] || [];
          // 避免重复添加同一日志
          if (existingLogs.some(l => l.id === log.id)) {
            return prev;
          }

          // 最多保留 100 条日志
          const newLogs = [...existingLogs, log].slice(-100);
          return {
            ...prev,
            taskLogs: {
              ...prev.taskLogs,
              [taskId]: newLogs,
            },
          };
        });
        break;

      case 'swarm:worker_stream':
        // v2.1: Worker 流式输出（参考 App.tsx 的实现方式）
        // v9.3: 添加调试日志，排查 Worker 流数据未渲染问题
        console.log(`[SwarmState] 📡 worker_stream: taskId=${message.payload.taskId}, streamType=${message.payload.streamType}, hasContent=${!!message.payload.content}`);
        setState(prev => {
          const { taskId, streamType, content, toolName, toolInput, toolResult, toolError, timestamp } = message.payload;
          if (!taskId) {
            console.warn('[SwarmState] ⚠️ worker_stream missing taskId, message discarded');
            return prev;
          }

          const existingStream = prev.taskStreams[taskId] || { content: [], lastUpdated: timestamp };
          const newContent = [...existingStream.content];

          switch (streamType) {
            case 'thinking':
              if (content) {
                const lastIdx = newContent.length - 1;
                const last = newContent[lastIdx];
                if (last?.type === 'thinking') {
                  // 创建新对象替换，避免引用修改导致 React 重复追加
                  newContent[lastIdx] = { type: 'thinking', text: last.text + content };
                } else {
                  newContent.push({ type: 'thinking', text: content });
                }
              }
              break;

            case 'text':
              if (content) {
                const lastIdx = newContent.length - 1;
                const last = newContent[lastIdx];
                if (last?.type === 'text') {
                  newContent[lastIdx] = { type: 'text', text: last.text + content };
                } else {
                  newContent.push({ type: 'text', text: content });
                }
              }
              break;

            case 'tool_start':
              // v3.5: 如果已存在同名的 running 工具块，更新其 input 而不是新增
              // 这样可以在流式接收工具名称后，再更新完整的输入参数
              {
                let found = false;
                for (let i = newContent.length - 1; i >= 0; i--) {
                  const block = newContent[i];
                  if (block.type === 'tool' && block.status === 'running' && block.name === toolName) {
                    // 更新现有工具块的 input
                    if (toolInput !== undefined) {
                      newContent[i] = { ...block, input: toolInput };
                    }
                    found = true;
                    break;
                  }
                }
                if (!found) {
                  // 新增工具块
                  newContent.push({
                    type: 'tool',
                    id: `tool-${Date.now()}-${++toolIdCounter}`,
                    name: toolName || 'unknown',
                    input: toolInput,
                    status: 'running',
                  });
                }
              }
              break;

            case 'tool_end':
              // 匹配 toolName，而不是简单地找"最后一个 running"
              for (let i = newContent.length - 1; i >= 0; i--) {
                const block = newContent[i];
                if (block.type === 'tool' && block.status === 'running' && block.name === toolName) {
                  newContent[i] = {
                    ...block,
                    input: toolInput ?? block.input,
                    status: toolError ? 'error' as const : 'completed' as const,
                    result: toolResult,
                    error: toolError,
                  };
                  break;
                }
              }
              break;

            // v4.6: 处理 system_prompt 事件（存储但不添加到 content 流中）
            case 'system_prompt':
              // systemPrompt 单独存储，不添加到 content 数组
              break;
          }

          // v4.6: 获取 systemPrompt 和 agentType（如果有）
          const { systemPrompt, agentType } = message.payload;

          return {
            ...prev,
            taskStreams: {
              ...prev.taskStreams,
              [taskId]: {
                content: newContent.slice(-100),
                lastUpdated: timestamp,
                // v4.6: 保存 systemPrompt（首次收到时设置）
                systemPrompt: systemPrompt || existingStream.systemPrompt,
                agentType: agentType || existingStream.agentType,
              },
            },
          };
        });
        break;

      case 'swarm:verification_update':
        // v3.4: 验收测试状态更新
        // v4.1: 保存 e2eTaskId 用于显示流式日志
        setState(prev => {
          const payloadResult = message.payload.result;
          const prevResult = prev.verification.result;
          // 确保 result 对象有完整的默认值，防止 undefined 错误
          const mergedResult = payloadResult ? {
            totalTests: payloadResult.totalTests ?? prevResult?.totalTests ?? 0,
            passedTests: payloadResult.passedTests ?? prevResult?.passedTests ?? 0,
            failedTests: payloadResult.failedTests ?? prevResult?.failedTests ?? 0,
            skippedTests: payloadResult.skippedTests ?? prevResult?.skippedTests ?? 0,
            testOutput: payloadResult.testOutput ?? prevResult?.testOutput ?? '',
            failures: payloadResult.failures ?? prevResult?.failures ?? [],
            fixAttempts: payloadResult.fixAttempts ?? prevResult?.fixAttempts ?? [],
            envIssues: payloadResult.envIssues ?? prevResult?.envIssues ?? [],
            startedAt: payloadResult.startedAt ?? prevResult?.startedAt ?? new Date().toISOString(),
            completedAt: payloadResult.completedAt ?? prevResult?.completedAt,
          } : prevResult;

          return {
            ...prev,
            verification: {
              status: message.payload.status,
              e2eTaskId: message.payload.e2eTaskId || prev.verification.e2eTaskId,
              result: mergedResult,
            },
          };
        });
        console.log(`[SwarmState] Verification status: ${message.payload.status}, e2eTaskId: ${message.payload.e2eTaskId || 'N/A'}`);
        break;

      case 'conflict:needs_human':
        // v3.5: 冲突需要人工处理
        setState(prev => {
          const conflict = message.payload.conflict;
          // 避免重复添加
          if (prev.conflicts.conflicts.some(c => c.id === conflict.id)) {
            return prev;
          }
          console.log(`[SwarmState] 🔴 New conflict: ${conflict.id}, task: ${conflict.taskName}`);
          return {
            ...prev,
            conflicts: {
              ...prev.conflicts,
              conflicts: [...prev.conflicts.conflicts, conflict],
            },
          };
        });
        break;

      case 'conflict:resolved':
        // v3.5: 冲突已解决
        setState(prev => {
          console.log(`[SwarmState] ✅ Conflict resolved: ${message.payload.conflictId}`);
          return {
            ...prev,
            conflicts: {
              ...prev.conflicts,
              conflicts: prev.conflicts.conflicts.filter(c => c.id !== message.payload.conflictId),
              resolvingId: prev.conflicts.resolvingId === message.payload.conflictId ? null : prev.conflicts.resolvingId,
            },
          };
        });
        break;

      case 'swarm:ask_user':
        // v4.2: E2E Agent / Worker 请求用户输入
        console.log(`[SwarmState] 🤔 AskUserQuestion request: ${message.payload.requestId}${message.payload.workerId ? ` (Worker: ${message.payload.workerId})` : ''}`);
        setState(prev => ({
          ...prev,
          askUserDialog: {
            visible: true,
            requestId: message.payload.requestId,
            questions: message.payload.questions,
            e2eTaskId: message.payload.e2eTaskId,
            workerId: message.payload.workerId,
            taskId: message.payload.taskId,
          },
        }));
        break;

      case 'task:interject_success':
        // v4.5: 用户插嘴成功
        console.log(`[SwarmState] ✅ Interruption successful: task ${message.payload.taskId}`);
        setState(prev => ({
          ...prev,
          interjectStatus: {
            taskId: message.payload.taskId,
            success: true,
            message: message.payload.message,
            timestamp: message.payload.timestamp,
          },
        }));
        // 3秒后自动清除状态
        setTimeout(() => {
          setState(prev => ({
            ...prev,
            interjectStatus: null,
          }));
        }, 3000);
        break;

      case 'task:interject_failed':
        // v4.5: 用户插嘴失败
        console.log(`[SwarmState] ❌ Interruption failed: task ${message.payload.taskId}, reason: ${message.payload.error}`);
        setState(prev => ({
          ...prev,
          interjectStatus: {
            taskId: message.payload.taskId,
            success: false,
            message: message.payload.error,
            timestamp: message.payload.timestamp,
          },
        }));
        // 5秒后自动清除状态（失败消息显示更久）
        setTimeout(() => {
          setState(prev => ({
            ...prev,
            interjectStatus: null,
          }));
        }, 5000);
        break;

      case 'lead:interject_success':
        // v9.2: LeadAgent 插嘴成功
        console.log(`[SwarmState] ✅ LeadAgent interruption successful`);
        setState(prev => ({
          ...prev,
          leadInterjectStatus: {
            success: true,
            message: message.payload.message,
            timestamp: message.payload.timestamp,
          },
        }));
        setTimeout(() => {
          setState(prev => ({ ...prev, leadInterjectStatus: null }));
        }, 3000);
        break;

      case 'lead:interject_failed':
        // v9.2: LeadAgent 插嘴失败
        console.log(`[SwarmState] ❌ LeadAgent interruption failed: ${message.payload.error}`);
        setState(prev => ({
          ...prev,
          leadInterjectStatus: {
            success: false,
            message: message.payload.error,
            timestamp: message.payload.timestamp,
          },
        }));
        setTimeout(() => {
          setState(prev => ({ ...prev, leadInterjectStatus: null }));
        }, 5000);
        break;

      case 'swarm:lead_system_prompt':
        // LeadAgent System Prompt（供前端查看提示词）
        setState(prev => ({
          ...prev,
          leadAgent: {
            ...prev.leadAgent,
            systemPrompt: message.payload.systemPrompt,
          },
        }));
        break;

      case 'swarm:lead_stream':
        // v9.0: LeadAgent 流式输出（文本、工具调用）
        setState(prev => {
          const payload = message.payload as LeadStreamPayload;
          const newStream = [...prev.leadAgent.stream];

          switch (payload.streamType) {
            case 'text':
              if (payload.content) {
                const lastIdx = newStream.length - 1;
                const last = newStream[lastIdx];
                if (last?.type === 'text') {
                  newStream[lastIdx] = { type: 'text', text: last.text + payload.content };
                } else {
                  newStream.push({ type: 'text', text: payload.content });
                }
              }
              break;

            case 'tool_start':
              {
                let found = false;
                for (let i = newStream.length - 1; i >= 0; i--) {
                  const block = newStream[i];
                  if (block.type === 'tool' && block.status === 'running' && block.name === payload.toolName) {
                    if (payload.toolInput !== undefined) {
                      newStream[i] = { ...block, input: payload.toolInput };
                    }
                    found = true;
                    break;
                  }
                }
                if (!found) {
                  newStream.push({
                    type: 'tool',
                    id: `lead-tool-${Date.now()}-${++toolIdCounter}`,
                    name: payload.toolName || 'unknown',
                    input: payload.toolInput,
                    status: 'running',
                  });
                }
              }
              break;

            case 'tool_end':
              for (let i = newStream.length - 1; i >= 0; i--) {
                const block = newStream[i];
                if (block.type === 'tool' && block.status === 'running' && block.name === payload.toolName) {
                  newStream[i] = {
                    ...block,
                    input: payload.toolInput ?? block.input,
                    status: payload.toolError ? 'error' as const : 'completed' as const,
                    result: payload.toolResult,
                    error: payload.toolError,
                  };
                  break;
                }
              }
              break;
          }

          return {
            ...prev,
            leadAgent: {
              ...prev.leadAgent,
              stream: newStream.slice(-200),
              lastUpdated: new Date().toISOString(),
            },
          };
        });
        break;

      case 'swarm:lead_event':
        // v9.0: LeadAgent 阶段事件
        setState(prev => {
          const payload = message.payload as LeadEventPayload;
          console.log(`[SwarmState] LeadAgent event: ${payload.eventType}`, payload.data);

          // 根据事件类型推断阶段
          let phase: LeadAgentPhase = prev.leadAgent.phase;
          switch (payload.eventType) {
            case 'lead:started':
              phase = 'started';
              break;
            case 'lead:exploring':
              phase = 'exploring';
              break;
            case 'lead:planning':
              phase = 'planning';
              break;
            case 'lead:executing':
            case 'lead:dispatch':
              phase = 'executing';
              break;
            case 'lead:reviewing':
              phase = 'reviewing';
              break;
            case 'lead:completed': {
              const completedData = payload.data as any;
              if (completedData?.pendingTasks > 0) {
                // v9.3: 有未完成任务时保持执行状态，不标记为已完成
                phase = 'executing';
              } else {
                phase = completedData?.success === false ? 'failed' : 'completed';
              }
              break;
            }
          }

          return {
            ...prev,
            leadAgent: {
              ...prev.leadAgent,
              phase,
              events: [...prev.leadAgent.events, {
                type: payload.eventType,
                data: payload.data,
                timestamp: payload.timestamp,
              }].slice(-100),
              lastUpdated: payload.timestamp || new Date().toISOString(),
            },
          };
        });
        break;

      case 'connected':
        // 服务端连接确认消息，清除错误状态
        setError(null);
        setIsLoading(false);
        break;

      default:
        // 未知消息类型
        console.warn('[SwarmState] Unknown message type:', (message as any).type);
        break;
    }
  }, []);

  // 处理 WebSocket 错误
  const handleError = useCallback((err: string) => {
    setError(err);
    setState(prev => ({ ...prev, error: err }));
  }, []);

  // 创建 WebSocket 连接
  const ws = useSwarmWebSocket({
    ...wsOptions,
    url: blueprintId ? wsOptions.url : '',
    onMessage: handleMessage,
    onError: handleError,
  });

  // 没有 blueprintId 时，不需要加载（WebSocket 不会连接）
  // blueprintId 变为有效值时，重新进入加载状态等待 WebSocket 响应
  useEffect(() => {
    if (!blueprintId) {
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
  }, [blueprintId]);

  // 更新连接状态，重连成功时清除错误
  useEffect(() => {
    setState(prev => ({ ...prev, status: ws.status }));
    if (ws.status === 'connected') {
      setError(null);
      setState(prev => ({ ...prev, error: null }));
    }
  }, [ws.status]);

  // 订阅蜂群状态
  useEffect(() => {
    if (ws.connected && blueprintId) {
      console.log('[SwarmState] Subscribing to blueprint:', blueprintId);
      ws.subscribe(blueprintId);

      return () => {
        console.log('[SwarmState] Unsubscribing from blueprint:', blueprintId);
        ws.unsubscribe(blueprintId);
      };
    }
  }, [ws.connected, ws.subscribe, ws.unsubscribe, blueprintId]);

  // 刷新状态
  const refresh = useCallback(() => {
    if (blueprintId) {
      setIsLoading(true);
      setError(null);
      ws.unsubscribe(blueprintId);
      setTimeout(() => {
        ws.subscribe(blueprintId);
      }, 100);
    }
  }, [blueprintId, ws]);

  // v4.0: 从 SQLite 加载历史日志
  const loadTaskHistoryLogs = useCallback(async (taskId: string) => {
    try {
      const response = await logsApi.getTaskLogs(taskId, { limit: 200 });

      // v5.0: 将历史日志合并到当前状态（支持所有 stream 类型）
      setState(prev => {
        // 转换 logs 为前端格式
        const historyLogs = response.logs.map(log => ({
          id: log.id,
          timestamp: log.timestamp,
          level: log.level,
          type: log.type,
          message: log.message,
          details: log.details,
        }));

        // v5.0: 从 SQLite streams 重建所有类型的内容块（thinking/text/tool）
        // 按时间顺序遍历 streams，将连续的同类型内容合并
        const historyContent: Array<
          | { type: 'tool'; id: string; name: string; input?: any; status: 'completed' | 'error'; result?: string; error?: string }
          | { type: 'thinking'; text: string }
          | { type: 'text'; text: string }
        > = [];

        // 跟踪 tool_start 等待匹配的 tool_end
        const pendingTools = new Map<string, { id: string; name: string; input?: any }>();

        for (const s of response.streams) {
          switch (s.streamType) {
            case 'thinking':
              if (s.content) {
                // 合并连续的 thinking 块
                const last = historyContent[historyContent.length - 1];
                if (last?.type === 'thinking') {
                  last.text += s.content;
                } else {
                  historyContent.push({ type: 'thinking', text: s.content });
                }
              }
              break;

            case 'text':
              if (s.content) {
                // 合并连续的 text 块
                const last = historyContent[historyContent.length - 1];
                if (last?.type === 'text') {
                  last.text += s.content;
                } else {
                  historyContent.push({ type: 'text', text: s.content });
                }
              }
              break;

            case 'tool_start':
              // 记录 pending tool，等待 tool_end 匹配
              if (s.toolName) {
                pendingTools.set(s.toolName, { id: s.id, name: s.toolName, input: s.toolInput });
              }
              break;

            case 'tool_end':
              // 匹配 tool_start，生成完整的 tool 块
              pendingTools.delete(s.toolName || '');
              historyContent.push({
                type: 'tool' as const,
                id: s.id,
                name: s.toolName || 'unknown',
                input: s.toolInput,
                status: s.toolError ? 'error' as const : 'completed' as const,
                result: s.toolResult,
                error: s.toolError,
              });
              break;

            // system_prompt 不添加到 content 流中
          }
        }

        // 获取现有日志，避免重复
        const existingLogs = prev.taskLogs[taskId] || [];
        const existingIds = new Set(existingLogs.map(l => l.id));
        const newLogs = historyLogs.filter(l => !existingIds.has(l.id));

        // 获取现有流内容
        const existingStream = prev.taskStreams[taskId] || { content: [], lastUpdated: new Date().toISOString() };

        // v5.0: 智能去重 - 如果已有实时数据，以实时数据为准；否则用历史数据
        let mergedContent;
        if (existingStream.content.length > 0) {
          // 已有实时内容，不覆盖
          mergedContent = existingStream.content;
        } else {
          // 没有实时内容，使用历史数据
          mergedContent = historyContent;
        }

        return {
          ...prev,
          taskLogs: {
            ...prev.taskLogs,
            [taskId]: [...newLogs, ...existingLogs].slice(0, 200),
          },
          taskStreams: {
            ...prev.taskStreams,
            [taskId]: {
              content: mergedContent.slice(0, 200) as any,
              lastUpdated: existingStream.lastUpdated,
            },
          },
        };
      });

      return {
        success: true,
        executions: response.executions,
        totalLogs: response.totalLogs,
        totalStreams: response.totalStreams,
      };
    } catch (err) {
      console.error('[useSwarmState] Failed to load history logs:', err);
      return { success: false, error: err instanceof Error ? err.message : '未知错误' };
    }
  }, []);

  // v4.0: 清空任务日志（重试前调用）
  const clearTaskLogs = useCallback(async (taskId: string) => {
    try {
      // 清空后端 SQLite 日志
      await logsApi.clearTaskLogs(taskId, false);

      // 清空前端状态
      setState(prev => ({
        ...prev,
        taskLogs: {
          ...prev.taskLogs,
          [taskId]: [],
        },
        taskStreams: {
          ...prev.taskStreams,
          [taskId]: { content: [], lastUpdated: new Date().toISOString() },
        },
      }));

      return { success: true };
    } catch (err) {
      console.error('[useSwarmState] Failed to clear task logs:', err);
      return { success: false, error: err instanceof Error ? err.message : '未知错误' };
    }
  }, []);

  // v4.2: AskUserQuestion 响应包装（关闭对话框并发送响应，支持 Worker）
  const sendAskUserResponse = useCallback((
    requestId: string,
    answers: Record<string, string>,
    cancelled?: boolean
  ) => {
    if (blueprintId) {
      // 从当前对话框状态获取 workerId
      const workerId = state.askUserDialog.workerId;
      ws.sendAskUserResponse(blueprintId, requestId, answers, cancelled, workerId);
      // 关闭对话框
      setState(prev => ({
        ...prev,
        askUserDialog: { visible: false, requestId: null, questions: [] },
      }));
    }
  }, [blueprintId, ws.sendAskUserResponse, state.askUserDialog.workerId]);

  // v4.4: 用户插嘴包装（自动注入 blueprintId）
  const interjectTask = useCallback((taskId: string, message: string) => {
    if (blueprintId) {
      ws.interjectTask(blueprintId, taskId, message);
    }
  }, [blueprintId, ws.interjectTask]);

  // v9.2: LeadAgent 插嘴包装（自动注入 blueprintId）
  const interjectLead = useCallback((message: string) => {
    if (blueprintId) {
      ws.interjectLead(blueprintId, message);
    }
  }, [blueprintId, ws.interjectLead]);

  // v9.3: 恢复卡死的 LeadAgent 执行（自动注入 blueprintId）
  const resumeLead = useCallback(() => {
    if (blueprintId) {
      ws.resumeLead(blueprintId);
    }
  }, [blueprintId, ws.resumeLead]);

  return {
    state,
    isLoading,
    error,
    refresh,
    // v2.1: 任务重试
    retryTask: ws.retryTask,
    // v3.8: 任务跳过
    skipTask: ws.skipTask,
    // v3.8: 取消执行
    cancelSwarm: ws.cancelSwarm,
    // v4.0: 历史日志管理
    loadTaskHistoryLogs,
    clearTaskLogs,
    // v4.2: AskUserQuestion 响应
    sendAskUserResponse,
    // v4.4: 用户插嘴
    interjectTask,
    // v9.2: LeadAgent 插嘴
    interjectLead,
    // v9.3: 恢复卡死的 LeadAgent
    resumeLead,
    // 探针功能：暴露底层 send 和 addMessageHandler
    send: ws.send,
    addMessageHandler: ws.addMessageHandler,
  };
}

// ============= 辅助 Hooks =============

/**
 * 从状态中提取特定 Worker 的信息
 */
export function useWorker(state: SwarmState, workerId: string | null): WorkerAgent | null {
  return useMemo(() => {
    if (!workerId) return null;
    return state.workers.find(w => w.id === workerId) || null;
  }, [state.workers, workerId]);
}

/**
 * 从状态中提取特定任务节点
 */
export function useTaskNode(state: SwarmState, taskId: string | null): TaskNode | null {
  return useMemo(() => {
    if (!taskId || !state.taskTree) return null;

    const findTask = (node: TaskNode): TaskNode | null => {
      if (node.id === taskId) return node;
      for (const child of node.children || []) {
        const found = findTask(child);
        if (found) return found;
      }
      return null;
    };

    return findTask(state.taskTree.root);
  }, [state.taskTree, taskId]);
}

/**
 * 获取活跃的 Workers
 */
export function useActiveWorkers(state: SwarmState): WorkerAgent[] {
  return useMemo(() => {
    return state.workers.filter(w => w.status === 'working');
  }, [state.workers]);
}

/**
 * 获取任务树的扁平化列表
 */
export function useFlatTaskList(state: SwarmState): TaskNode[] {
  return useMemo(() => {
    if (!state.taskTree) return [];

    const flatten = (node: TaskNode): TaskNode[] => {
      const result: TaskNode[] = [node];
      if (node.children && node.children.length > 0) {
        node.children.forEach(child => {
          result.push(...flatten(child));
        });
      }
      return result;
    };

    return flatten(state.taskTree.root);
  }, [state.taskTree]);
}
