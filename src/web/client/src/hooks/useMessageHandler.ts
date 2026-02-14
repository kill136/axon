/**
 * useMessageHandler hook
 * 从 App.tsx 提取的 WebSocket 消息处理逻辑
 * 处理所有 ServerMessage -> 前端状态的映射
 */

import { useState, useEffect, useRef } from 'react';
import type {
  ChatMessage,
  ChatContent,
  PermissionRequest,
  UserQuestion,
  WSMessage,
} from '../types';
import type { ContextUsage, CompactState } from '../components/ContextBar';

export type Status = 'idle' | 'thinking' | 'streaming' | 'tool_executing';
export type PermissionMode = 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan';

interface UseMessageHandlerParams {
  addMessageHandler: (handler: (msg: WSMessage) => void) => () => void;
  model: string;
  send: (msg: any) => void;
  refreshSessions: () => void;
  onNavigateToSwarm?: (blueprintId?: string) => void;
  sessionId: string | null;
}

interface UseMessageHandlerReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  status: Status;
  setStatus: React.Dispatch<React.SetStateAction<Status>>;
  contextUsage: ContextUsage | null;
  compactState: CompactState;
  permissionRequest: PermissionRequest | null;
  setPermissionRequest: React.Dispatch<React.SetStateAction<PermissionRequest | null>>;
  userQuestion: UserQuestion | null;
  setUserQuestion: React.Dispatch<React.SetStateAction<UserQuestion | null>>;
  permissionMode: PermissionMode;
  setPermissionMode: React.Dispatch<React.SetStateAction<PermissionMode>>;
  currentMessageRef: React.MutableRefObject<ChatMessage | null>;
  sessionIdRef: React.MutableRefObject<string | null>;
  interruptPendingRef: React.MutableRefObject<boolean>;
  isTranscriptMode: boolean;
  setIsTranscriptMode: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useMessageHandler({
  addMessageHandler,
  model,
  send,
  refreshSessions,
  onNavigateToSwarm,
  sessionId,
}: UseMessageHandlerParams): UseMessageHandlerReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const [compactState, setCompactState] = useState<CompactState>({ phase: 'idle' });
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<UserQuestion | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [isTranscriptMode, setIsTranscriptMode] = useState(false);

  const currentMessageRef = useRef<ChatMessage | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);
  // 修复竞态条件：不在 render body 中同步覆盖 sessionIdRef.current
  // 原因：message handler 中直接设置 sessionIdRef.current = persistentId（同步），
  // 但 React 的 setSessionId 是异步批量更新。如果其他 state 变更触发了中间 render，
  // sessionId prop 还是旧的 tempId，会覆盖 handler 设置的 persistentId，
  // 导致后续流式消息因 session ID 不匹配被过滤。
  // 改用 useEffect：只在 React state 真正更新后才同步 ref，避免中间 render 覆盖。
  const permissionModeRef = useRef<PermissionMode>(permissionMode);
  permissionModeRef.current = permissionMode;
  // 稳定 refreshSessions 引用：App.tsx 传入的是内联箭头函数，每次 render 都变，
  // 如果放在 useEffect deps 中会导致 handler 频繁重新注册，增加竞态风险。
  // 用 ref 包裹，useEffect deps 中改用稳定的 ref callback。
  const refreshSessionsRef = useRef(refreshSessions);
  refreshSessionsRef.current = refreshSessions;
  // 插话（interrupt）保护：当用户在模型回复中发送新消息时，
  // 标记为 true，直到新消息的 message_start 到达。
  // 在此期间忽略来自旧消息的 status: idle 和 message_complete 事件。
  const interruptPendingRef = useRef(false);

  // 安全同步 sessionId prop → ref：仅在 React state 真正更新后才同步
  // useEffect 在 commit phase 后执行，此时 sessionId prop 已经是最新值
  useEffect(() => {
    if (sessionId) {
      sessionIdRef.current = sessionId;
    }
  }, [sessionId]);

  useEffect(() => {
    const unsubscribe = addMessageHandler((msg: WSMessage) => {
      const payload = msg.payload as Record<string, unknown>;

      // 会话隔离
      const msgSessionId = payload.sessionId as string | undefined;
      const currentSessionId = sessionIdRef.current;
      const isStreamingMessage = [
        'message_start', 'text_delta', 'thinking_start', 'thinking_delta',
        'thinking_complete', 'tool_use_start', 'tool_use_delta', 'tool_result',
        'message_complete', 'permission_request', 'context_update', 'context_compact',
      ].includes(msg.type);

      if (isStreamingMessage && msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
        return;
      }

      if (msg.type === 'status' && msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
        return;
      }

      // 兜底：孤立流式事件自动创建消息上下文
      const streamingEventTypes = [
        'text_delta', 'thinking_start', 'thinking_delta',
        'tool_use_start', 'tool_use_delta', 'tool_result',
      ];
      if (streamingEventTypes.includes(msg.type) && !currentMessageRef.current) {
        // 插话保护：正在等待新消息的 message_start，忽略旧消息的尾部流式事件
        if (interruptPendingRef.current) {
          return;
        }
        console.warn('[App] 收到孤立流式事件，自动创建消息上下文:', msg.type);
        currentMessageRef.current = {
          id: (payload.messageId as string) || `resume-${Date.now()}`,
          role: 'assistant',
          timestamp: Date.now(),
          content: [],
          model,
        };
        setStatus('streaming');
      }

      switch (msg.type) {
        case 'message_start': {
          // 新消息开始，清除插话保护标记
          interruptPendingRef.current = false;
          const newMsg: ChatMessage = {
            id: payload.messageId as string,
            role: 'assistant',
            timestamp: Date.now(),
            content: [],
            model,
          };
          currentMessageRef.current = newMsg;
          setMessages(prev => [...prev, newMsg]);
          setStatus('streaming');
          break;
        }

        case 'text_delta':
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            const lastContent = currentMsg.content[currentMsg.content.length - 1];
            if (lastContent?.type === 'text') {
              lastContent.text += payload.text as string;
            } else {
              currentMsg.content.push({ type: 'text', text: payload.text as string });
            }
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== currentMsg.id);
              return [...filtered, { ...currentMsg }];
            });
          }
          break;

        case 'thinking_start':
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            currentMsg.content.push({ type: 'thinking', text: '' });
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== currentMsg.id);
              return [...filtered, { ...currentMsg }];
            });
            setStatus('thinking');
          }
          break;

        case 'thinking_delta':
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            const thinkingBlocks = currentMsg.content.filter(c => c.type === 'thinking');
            let thinkingContent = thinkingBlocks[thinkingBlocks.length - 1];
            // 修复：如果没有 thinking block（如浏览器刷新后 thinking_start 丢失），自动创建
            if (!thinkingContent || thinkingContent.type !== 'thinking') {
              currentMsg.content.push({ type: 'thinking', text: '' });
              thinkingContent = currentMsg.content[currentMsg.content.length - 1];
            }
            if (thinkingContent && thinkingContent.type === 'thinking') {
              thinkingContent.text += payload.text as string;
              setMessages(prev => {
                const filtered = prev.filter(m => m.id !== currentMsg.id);
                return [...filtered, { ...currentMsg }];
              });
            }
          }
          break;

        case 'tool_use_start':
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            const newContent = [
              ...currentMsg.content,
              {
                type: 'tool_use' as const,
                id: payload.toolUseId as string,
                name: payload.toolName as string,
                input: payload.input,
                status: 'running' as const,
              },
            ];
            const updatedMsg = { ...currentMsg, content: newContent };
            currentMessageRef.current = updatedMsg;
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== currentMsg.id);
              return [...filtered, updatedMsg];
            });
            setStatus('tool_executing');
          }
          break;

        case 'tool_result':
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            const toolUseIndex = currentMsg.content.findIndex(
              c => c.type === 'tool_use' && c.id === payload.toolUseId
            );
            if (toolUseIndex !== -1) {
              const toolUse = currentMsg.content[toolUseIndex];
              if (toolUse.type === 'tool_use') {
                const newContent = currentMsg.content.map((item, index) => {
                  if (index === toolUseIndex && item.type === 'tool_use') {
                    return {
                      ...item,
                      status: (payload.success ? 'completed' : 'error') as 'completed' | 'error',
                      result: {
                        success: payload.success as boolean,
                        output: payload.output as string | undefined,
                        error: payload.error as string | undefined,
                      },
                    };
                  }
                  return item;
                });
                const updatedMsg = { ...currentMsg, content: newContent };
                currentMessageRef.current = updatedMsg;
                setMessages(prev => {
                  const filtered = prev.filter(m => m.id !== currentMsg.id);
                  return [...filtered, updatedMsg];
                });
              }
            }
          }
          break;

        case 'message_complete':
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            const usage = payload.usage as { inputTokens: number; outputTokens: number } | undefined;
            const finalMsg = {
              ...currentMsg,
              content: [...currentMsg.content],
              ...(usage && { usage }),
            };
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== currentMsg.id);
              return [...filtered, finalMsg];
            });
            currentMessageRef.current = null;
            setStatus('idle');
          }
          // 注意：如果 currentMessageRef 为 null，说明消息已被取消/清理（插话场景），
          // 不应设置 status: idle，否则会覆盖用户刚发新消息设置的 'thinking' 状态
          refreshSessionsRef.current();
          break;

        case 'error':
          console.error('Server error:', payload);
          setStatus('idle');
          break;

        case 'context_update':
          setContextUsage(payload as unknown as ContextUsage);
          break;

        case 'context_compact': {
          const compactPayload = payload as { phase: string; savedTokens?: number; message?: string; summaryText?: string };
          if (compactPayload.phase === 'start') {
            setCompactState({ phase: 'compacting' });
          } else if (compactPayload.phase === 'end') {
            setCompactState({ phase: 'done', savedTokens: compactPayload.savedTokens });
            const savedTokens = compactPayload.savedTokens || 0;
            const now = Date.now();
            const boundaryMsg: ChatMessage = {
              id: `compact-boundary-${now}`,
              role: 'system',
              timestamp: now,
              content: [{ type: 'text', text: `对话已压缩，节省约 ${savedTokens.toLocaleString()} tokens` }],
              isCompactBoundary: true,
            };
            const newMsgs: ChatMessage[] = [boundaryMsg];
            if (compactPayload.summaryText) {
              const summaryMsg: ChatMessage = {
                id: `compact-summary-${now}`,
                role: 'user',
                timestamp: now,
                content: [{ type: 'text', text: compactPayload.summaryText }],
                isCompactSummary: true,
                isVisibleInTranscriptOnly: true,
              };
              newMsgs.push(summaryMsg);
            }
            setMessages(prev => [...prev, ...newMsgs]);
            setTimeout(() => setCompactState({ phase: 'idle' }), 4500);
          } else if (compactPayload.phase === 'error') {
            setCompactState({ phase: 'error', message: compactPayload.message });
            setTimeout(() => setCompactState({ phase: 'idle' }), 3000);
          }
          break;
        }

        case 'status':
          // 插话保护：忽略来自旧消息/cancel 的 idle 状态，
          // 避免覆盖用户刚发新消息设置的 'thinking' 状态
          if (interruptPendingRef.current && payload.status === 'idle') {
            break;
          }
          setStatus(payload.status as Status);
          break;

        case 'permission_request':
          // YOLO 模式下自动批准，不弹出对话框
          if (permissionModeRef.current === 'bypassPermissions') {
            const req = payload as unknown as PermissionRequest;
            console.warn(`[YOLO] 自动批准权限请求: ${req.tool} (服务端不应发送此请求)`);
            send({
              type: 'permission_response',
              payload: {
                requestId: req.requestId,
                approved: true,
                remember: false,
                scope: 'once',
                destination: 'session',
              },
            });
          } else if (permissionModeRef.current === 'acceptEdits') {
            // acceptEdits 模式下自动批准编辑工具
            const req = payload as unknown as PermissionRequest;
            if (['Write', 'Edit', 'MultiEdit'].includes(req.tool)) {
              console.warn(`[acceptEdits] 自动批准编辑权限: ${req.tool}`);
              send({
                type: 'permission_response',
                payload: {
                  requestId: req.requestId,
                  approved: true,
                  remember: false,
                  scope: 'once',
                  destination: 'session',
                },
              });
            } else {
              setPermissionRequest(payload as unknown as PermissionRequest);
            }
          } else {
            setPermissionRequest(payload as unknown as PermissionRequest);
          }
          break;

        case 'user_question':
          setUserQuestion(payload as unknown as UserQuestion);
          break;

        case 'session_list_response':
          break;

        case 'session_switched':
          console.log('[useMessageHandler] session_switched received, clearing messages');
          // 立即同步更新 sessionIdRef，防止旧会话的流式消息通过隔离检查泄漏到新会话
          // 不能依赖 useWebSocket 的 setSessionId（异步），必须在此处直接更新 ref
          if (payload.sessionId) {
            sessionIdRef.current = payload.sessionId as string;
          }
          // 清除正在流式传输的消息引用，防止旧会话的 streaming 数据混入新会话
          currentMessageRef.current = null;
          // 重置所有状态
          interruptPendingRef.current = false;
          setStatus('idle');
          setMessages([]);
          refreshSessionsRef.current();
          break;

        case 'history':
          console.log(`[useMessageHandler] history received: ${Array.isArray(payload.messages) ? (payload.messages as any[]).length : 'not array'} messages`);
          if (payload.messages && Array.isArray(payload.messages)) {
            const historyMessages = payload.messages as ChatMessage[];
            console.log('[useMessageHandler] history details:', historyMessages.map(m => `${m.role}: ${m.content?.[0]?.type}/${(m.content?.[0] as any)?.text?.substring(0, 40) || '...'}`));
            // 清理流式状态：history 替换了全部消息，旧的 currentMessageRef 已过时
            // 典型场景：onComplete 通过 consumeHistoryResendFlag 发送完整 history，
            // 此时客户端可能还持有刷新前的恢复消息引用，必须清理
            currentMessageRef.current = null;
            setMessages(historyMessages);
          }
          break;

        case 'session_deleted':
          if (payload.success) {
            const deletedId = payload.sessionId as string;
            if (deletedId === sessionId) {
              setMessages([]);
            }
          }
          break;

        case 'session_created':
          if (payload.sessionId) {
            sessionIdRef.current = payload.sessionId as string;
            // 不在此处调用 refreshSessions()：
            // session_created 发出时 messageCount=0，服务端 handleSessionList 会过滤掉它，
            // 导致 session_list_response 覆盖 useSessionManager 的乐观插入。
            // 列表刷新由 message_complete 事件负责，届时 messageCount>0。
          }
          break;

        case 'session_new_ready':
          console.log('[App] 临时会话已就绪:', payload.sessionId);
          // 立即同步更新 sessionIdRef，与 session_switched 同理
          if (payload.sessionId) {
            sessionIdRef.current = payload.sessionId as string;
          }
          // 清除旧会话的流式消息引用
          currentMessageRef.current = null;
          interruptPendingRef.current = false;
          setStatus('idle');
          break;

        case 'task_status': {
          if (!payload.taskId) break;

          let targetMsg = currentMessageRef.current;
          let taskTool: ChatContent | undefined;

          if (targetMsg) {
            taskTool = targetMsg.content.find(
              c => c.type === 'tool_use' && c.name === 'Task'
            );
          }

          if (!taskTool) {
            setMessages(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const msg = prev[i];
                if (msg.role !== 'assistant') continue;
                const found = msg.content.find(
                  c => c.type === 'tool_use' && c.name === 'Task'
                );
                if (found && found.type === 'tool_use') {
                  found.toolUseCount = payload.toolUseCount as number | undefined;
                  found.lastToolInfo = payload.lastToolInfo as string | undefined;
                  if (payload.status === 'completed' || payload.status === 'failed') {
                    found.status = payload.status === 'completed' ? 'completed' : 'error';
                    found.result = {
                      success: payload.status === 'completed',
                      output: payload.result as string | undefined,
                      error: payload.error as string | undefined,
                    };
                  }
                  return [...prev.slice(0, i), { ...msg }, ...prev.slice(i + 1)];
                }
              }
              return prev;
            });
            break;
          }

          if (taskTool && taskTool.type === 'tool_use') {
            taskTool.toolUseCount = payload.toolUseCount as number | undefined;
            taskTool.lastToolInfo = payload.lastToolInfo as string | undefined;
            if (payload.status === 'completed' || payload.status === 'failed') {
              taskTool.status = payload.status === 'completed' ? 'completed' : 'error';
              taskTool.result = {
                success: payload.status === 'completed',
                output: payload.result as string | undefined,
                error: payload.error as string | undefined,
              };
            }
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== targetMsg!.id);
              return [...filtered, { ...targetMsg! }];
            });
          }
          break;
        }

        case 'subagent_tool_start': {
          if (!payload.taskId || !payload.toolCall) break;

          const tc = payload.toolCall as { id: string; name: string; input?: unknown; status: 'running' | 'completed' | 'error'; startTime: number };

          let targetMsg = currentMessageRef.current;
          let taskTool: ChatContent | undefined;

          if (targetMsg) {
            taskTool = targetMsg.content.find(
              c => c.type === 'tool_use' && c.name === 'Task'
            );
          }

          if (!taskTool) {
            setMessages(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const msg = prev[i];
                if (msg.role !== 'assistant') continue;
                const found = msg.content.find(
                  c => c.type === 'tool_use' && c.name === 'Task'
                );
                if (found && found.type === 'tool_use') {
                  if (!found.subagentToolCalls) {
                    found.subagentToolCalls = [];
                  }
                  found.subagentToolCalls.push({
                    id: tc.id,
                    name: tc.name,
                    input: tc.input,
                    status: tc.status,
                    startTime: tc.startTime,
                  });
                  return [...prev.slice(0, i), { ...msg }, ...prev.slice(i + 1)];
                }
              }
              return prev;
            });
            break;
          }

          if (taskTool && taskTool.type === 'tool_use') {
            if (!taskTool.subagentToolCalls) {
              taskTool.subagentToolCalls = [];
            }
            taskTool.subagentToolCalls.push({
              id: tc.id,
              name: tc.name,
              input: tc.input,
              status: tc.status,
              startTime: tc.startTime,
            });
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== targetMsg!.id);
              return [...filtered, { ...targetMsg! }];
            });
          }
          break;
        }

        case 'subagent_tool_end': {
          if (!payload.taskId || !payload.toolCall) break;

          const tc = payload.toolCall as { id: string; name: string; status: 'running' | 'completed' | 'error'; result?: string; error?: string; endTime?: number };

          let targetMsg = currentMessageRef.current;
          let taskTool: ChatContent | undefined;

          if (targetMsg) {
            taskTool = targetMsg.content.find(
              c => c.type === 'tool_use' && c.name === 'Task'
            );
          }

          if (!taskTool) {
            setMessages(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const msg = prev[i];
                if (msg.role !== 'assistant') continue;
                const found = msg.content.find(
                  c => c.type === 'tool_use' && c.name === 'Task' && c.subagentToolCalls?.length
                );
                if (found && found.type === 'tool_use' && found.subagentToolCalls) {
                  const existingCall = found.subagentToolCalls.find(call => call.id === tc.id);
                  if (existingCall) {
                    existingCall.status = tc.status;
                    existingCall.result = tc.result;
                    existingCall.error = tc.error;
                    existingCall.endTime = tc.endTime;
                    return [...prev.slice(0, i), { ...msg }, ...prev.slice(i + 1)];
                  }
                }
              }
              return prev;
            });
            break;
          }

          if (taskTool && taskTool.type === 'tool_use' && taskTool.subagentToolCalls) {
            const existingCall = taskTool.subagentToolCalls.find(c => c.id === tc.id);
            if (existingCall) {
              existingCall.status = tc.status;
              existingCall.result = tc.result;
              existingCall.error = tc.error;
              existingCall.endTime = tc.endTime;
            }
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== targetMsg!.id);
              return [...filtered, { ...targetMsg! }];
            });
          }
          break;
        }

        // 持续开发消息处理
        case 'continuous_dev:flow_started': {
          const newMessage: ChatMessage = {
            id: `dev-${Date.now()}`,
            role: 'assistant',
            timestamp: Date.now(),
            content: [{
              type: 'dev_progress',
              data: {
                phase: 'analyzing_codebase',
                percentage: 0,
                tasksCompleted: 0,
                tasksTotal: 0,
                status: 'running',
                currentTask: '流程启动中...'
              }
            }]
          };
          setMessages(prev => [...prev, newMessage]);
          break;
        }

        case 'continuous_dev:status_update':
        case 'continuous_dev:progress_update':
        case 'continuous_dev:phase_changed':
        case 'continuous_dev:task_completed':
        case 'continuous_dev:task_failed':
        case 'continuous_dev:paused':
        case 'continuous_dev:resumed':
        case 'continuous_dev:flow_failed':
        case 'continuous_dev:flow_paused':
        case 'continuous_dev:flow_resumed':
        case 'continuous_dev:flow_stopped':
        case 'continuous_dev:completed': {
           setMessages(prev => {
              const newMessages = [...prev];
              for (let i = newMessages.length - 1; i >= 0; i--) {
                const chatMsg = newMessages[i];
                if (chatMsg.role === 'assistant') {
                  const progressIndex = chatMsg.content.findIndex(c => c.type === 'dev_progress');
                  if (progressIndex !== -1) {
                    const prevData = (chatMsg.content[progressIndex] as any).data;
                    const newData = { ...prevData };

                    if (msg.type === 'continuous_dev:paused' || msg.type === 'continuous_dev:flow_paused') newData.status = 'paused';
                    else if (msg.type === 'continuous_dev:resumed' || msg.type === 'continuous_dev:flow_resumed') newData.status = 'running';
                    else if (msg.type === 'continuous_dev:flow_failed') {
                      newData.status = 'error';
                      newData.phase = 'failed';
                    } else if (msg.type === 'continuous_dev:completed') {
                      newData.phase = 'completed';
                    } else if (payload?.phase) {
                      newData.phase = payload.phase;
                    }

                    if (msg.type === 'continuous_dev:status_update' && payload?.stats) {
                      if ((payload.stats as any).tasksCompleted !== undefined) {
                        newData.tasksCompleted = (payload.stats as any).tasksCompleted;
                      }
                      if ((payload.stats as any).tasksTotal !== undefined) {
                        newData.tasksTotal = (payload.stats as any).tasksTotal;
                      }
                      if (newData.tasksTotal > 0) {
                        newData.percentage = Math.round((newData.tasksCompleted / newData.tasksTotal) * 100);
                      }
                    }

                    if (payload?.percentage !== undefined) newData.percentage = Math.round(payload.percentage as number);
                    if (payload?.currentTask) newData.currentTask = payload.currentTask;
                    if (payload?.tasksCompleted !== undefined) newData.tasksCompleted = payload.tasksCompleted;
                    if (payload?.tasksTotal !== undefined) newData.tasksTotal = payload.tasksTotal;

                    const newContent = [...chatMsg.content];
                    newContent[progressIndex] = { type: 'dev_progress', data: newData };
                    newMessages[i] = { ...chatMsg, content: newContent };
                    return newMessages;
                  }
                }
              }
              return newMessages;
           });
           break;
        }

        case 'continuous_dev:approval_required': {
          const impactAnalysis = (payload as any).impactAnalysis;
          if (impactAnalysis) {
            const newMessage: ChatMessage = {
              id: `dev-approval-${Date.now()}`,
              role: 'assistant',
              timestamp: Date.now(),
              content: [{ type: 'impact_analysis', data: impactAnalysis }]
            };
            setMessages(prev => [...prev, newMessage]);
          }
          const blueprint = (payload as any).blueprint;
          if (blueprint) {
            const newMessage: ChatMessage = {
              id: `dev-blueprint-${Date.now()}`,
              role: 'assistant',
              timestamp: Date.now(),
              content: [{
                type: 'blueprint',
                blueprintId: blueprint.id,
                name: blueprint.name,
                moduleCount: blueprint.modules?.length || 0,
                processCount: blueprint.businessProcesses?.length || 0,
                nfrCount: blueprint.nfrs?.length || 0
              }]
            };
            setMessages(prev => [...prev, newMessage]);
          }
          break;
        }

        case 'continuous_dev:regression_failed':
        case 'continuous_dev:regression_passed': {
          const newMessage: ChatMessage = {
            id: `dev-regression-${Date.now()}`,
            role: 'assistant',
            timestamp: Date.now(),
            content: [{ type: 'regression_result', data: payload as any }]
          };
          setMessages(prev => [...prev, newMessage]);
          break;
        }

        case 'continuous_dev:cycle_review_completed': {
          const newMessage: ChatMessage = {
            id: `dev-cycle-${Date.now()}`,
            role: 'assistant',
            timestamp: Date.now(),
            content: [{ type: 'cycle_review', data: payload as any }]
          };
          setMessages(prev => [...prev, newMessage]);
          break;
        }

        case 'continuous_dev:ack':
           console.log('[Dev] Server ACK:', (payload as any).message);
           break;

        case 'permission_config_update':
          if (payload.mode) {
            setPermissionMode(payload.mode as PermissionMode);
          }
          break;

        case 'design_image_generated': {
          const designPayload = payload as { imageUrl: string; projectName: string; style: string; generatedText?: string };
          if (designPayload.imageUrl) {
            const designContent: ChatContent = {
              type: 'design_image',
              imageUrl: designPayload.imageUrl,
              projectName: designPayload.projectName || '',
              style: designPayload.style || 'modern',
              generatedText: designPayload.generatedText,
            };

            if (currentMessageRef.current) {
              const currentMsg = currentMessageRef.current;
              const newContent = [...currentMsg.content, designContent];
              const updatedMsg = { ...currentMsg, content: newContent };
              currentMessageRef.current = updatedMsg;
              setMessages(prev => {
                const filtered = prev.filter(m => m.id !== currentMsg.id);
                return [...filtered, updatedMsg];
              });
            } else {
              const newMessage: ChatMessage = {
                id: `design-${Date.now()}`,
                role: 'assistant',
                timestamp: Date.now(),
                content: [designContent],
              };
              setMessages(prev => [...prev, newMessage]);
            }
          }
          break;
        }

        case 'navigate_to_swarm':
          console.log('[App] Navigate to swarm:', payload);
          onNavigateToSwarm?.((payload as any).blueprintId);
          break;

        case 'slash_command_result': {
          const cmdResult = payload as { command: string; success: boolean; message?: string; data?: any; action?: string };
          // 将命令结果作为助手消息展示
          const resultMessage: ChatMessage = {
            id: `cmd-${Date.now()}`,
            role: 'assistant',
            timestamp: Date.now(),
            content: [{ type: 'text', text: cmdResult.message || (cmdResult.success ? '命令执行成功' : '命令执行失败') }],
          };
          setMessages(prev => [...prev, resultMessage]);
          setStatus('idle');

          // 如果命令要求清除历史（如 /clear）
          if (cmdResult.action === 'clear') {
            setMessages([]);
          }
          break;
        }

        case 'blueprint_created':
          console.log('[App] Blueprint created:', (payload as any).name);
          break;

        case 'execution:report':
          console.log('[App] Execution report:', (payload as any).status, (payload as any).summary?.substring(0, 100));
          addMessageHandler?.({
            role: 'assistant',
            content: (payload as any).message || '执行完成',
          } as any);
          break;
      }
    });

    return unsubscribe;
  }, [addMessageHandler, model, send, onNavigateToSwarm]);

  return {
    messages,
    setMessages,
    status,
    setStatus,
    contextUsage,
    compactState,
    permissionRequest,
    setPermissionRequest,
    userQuestion,
    setUserQuestion,
    permissionMode,
    setPermissionMode,
    currentMessageRef,
    sessionIdRef,
    interruptPendingRef,
    isTranscriptMode,
    setIsTranscriptMode,
  };
}
