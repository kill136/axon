/**
 * useMessageHandler hook
 * 从 App.tsx 提取的 WebSocket 消息处理逻辑
 * 处理所有 ServerMessage -> 前端状态的映射
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ChatMessage,
  ChatContent,
  PermissionRequest,
  UserQuestion,
  WSMessage,
} from '../types';
import type { ContextUsage, CompactState } from '../components/ContextBar';
import type { SlashCommandResult } from '../components/SlashCommandDialog';

export type Status = 'idle' | 'thinking' | 'streaming' | 'tool_executing';
export type PermissionMode = 'default' | 'bypassPermissions' | 'acceptEdits' | 'plan';

/**
 * API 速率限制信息
 */
export interface RateLimitInfo {
  status: string;
  utilization5h?: number;
  utilization7d?: number;
  resetsAt?: number;
  rateLimitType?: string;
}

/**
 * 跨会话通知：当其他会话有弹窗等待时，通知当前用户
 */
export interface CrossSessionNotification {
  sessionId: string;
  type: 'permission_request' | 'user_question';
  toolName?: string;     // permission_request 时的工具名
  questionHeader?: string; // user_question 时的标题
  timestamp: number;
}

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
  rateLimitInfo: RateLimitInfo | null;
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
  crossSessionNotification: CrossSessionNotification | null;
  dismissCrossSessionNotification: () => void;
  slashCommandResult: SlashCommandResult | null;
  setSlashCommandResult: React.Dispatch<React.SetStateAction<SlashCommandResult | null>>;
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
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<UserQuestion | null>(null);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [isTranscriptMode, setIsTranscriptMode] = useState(false);
  const [crossSessionNotification, setCrossSessionNotification] = useState<CrossSessionNotification | null>(null);
  const [slashCommandResult, setSlashCommandResult] = useState<SlashCommandResult | null>(null);

  const dismissCrossSessionNotification = useCallback(() => {
    setCrossSessionNotification(null);
  }, []);

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

      // 会话隔离：通用检查
      // 只要消息携带了 sessionId 且与当前会话不匹配，一律丢弃
      // 不再使用白名单方式，避免新增消息类型时遗漏导致消息串线
      const msgSessionId = payload.sessionId as string | undefined;
      const currentSessionId = sessionIdRef.current;
      // 不需要隔离的消息类型（全局消息 + 会话切换/创建消息）
      // 会话切换/创建消息的 sessionId 是目标会话 ID，不能与当前会话比较过滤
      const isGlobalMessage = [
        'connected', 'pong', 'skills_list', 'session_list',
        'session_created', 'session_deleted', 'permission_config_update',
        'session_switched', 'session_new_ready',
      ].includes(msg.type);

      if (!isGlobalMessage && msgSessionId && currentSessionId && msgSessionId !== currentSessionId) {
        // 跨会话的弹框消息：不直接显示，但弹出通知提醒用户切回去
        if (msg.type === 'permission_request') {
          setCrossSessionNotification({
            sessionId: msgSessionId,
            type: 'permission_request',
            toolName: (payload as any).tool,
            timestamp: Date.now(),
          });
        } else if (msg.type === 'user_question') {
          setCrossSessionNotification({
            sessionId: msgSessionId,
            type: 'user_question',
            questionHeader: (payload as any).header,
            timestamp: Date.now(),
          });
        }
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
        console.warn('[App] Received orphaned stream event, auto-creating message context:', msg.type);
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
                toolCategory: payload.toolCategory as string | undefined,
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
                const finalStatus = (payload.success ? 'completed' : 'error') as 'completed' | 'error';
                const newContent = currentMsg.content.map((item, index) => {
                  if (index === toolUseIndex && item.type === 'tool_use') {
                    // 当 Task 工具完成时，把所有仍在 running 的 subagentToolCalls 也标记为完成
                    // 修复：Task 整体完成后内部工具仍显示 spinner 的问题
                    const fixedSubagentCalls = item.subagentToolCalls?.map(call =>
                      call.status === 'running'
                        ? { ...call, status: finalStatus, endTime: Date.now() }
                        : call
                    );
                    return {
                      ...item,
                      status: finalStatus,
                      result: {
                        success: payload.success as boolean,
                        output: payload.output as string | undefined,
                        error: payload.error as string | undefined,
                        data: payload.data,
                      },
                      ...(fixedSubagentCalls && { subagentToolCalls: fixedSubagentCalls }),
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

        case 'rate_limit_update':
          setRateLimitInfo(payload as unknown as RateLimitInfo);
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
            console.warn(`[YOLO] Auto-approving permission request: ${req.tool} (server should not send this request)`);
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
              console.warn(`[acceptEdits] Auto-approving edit permission: ${req.tool}`);
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
          // 重置所有状态（包括对话框状态，防止旧会话的弹窗残留到新会话）
          interruptPendingRef.current = false;
          setStatus('idle');
          setMessages([]);
          setPermissionRequest(null);
          setUserQuestion(null);
          setCompactState({ phase: 'idle' });
          setContextUsage(null);
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
            if (deletedId === sessionIdRef.current) {
              setMessages([]);
            }
          }
          break;

        case 'session_created':
          if (payload.sessionId) {
            sessionIdRef.current = payload.sessionId as string;
            // 不在此处调用 refreshSessions()：
            // 让 useSessionManager 的乐观插入先展示，避免刷新时数据不一致。
            // 列表刷新由 message_complete 事件负责。
            setCompactState({ phase: 'idle' });
            setContextUsage(null);
          }
          break;

        case 'session_new_ready':
          console.log('[App] Temporary session ready:', payload.sessionId);
          // 立即同步更新 sessionIdRef，与 session_switched 同理
          if (payload.sessionId) {
            sessionIdRef.current = payload.sessionId as string;
          }
          // 清除旧会话的流式消息引用和对话框状态
          currentMessageRef.current = null;
          interruptPendingRef.current = false;
          setStatus('idle');
          setPermissionRequest(null);
          setUserQuestion(null);
          setCompactState({ phase: 'idle' });
          setContextUsage(null);
          break;

        case 'task_status': {
          if (!payload.taskId) break;

          const taskToolUseId = payload.toolUseId as string | undefined;

          // 不可变更新辅助函数：在 content 中找到匹配的 Task tool_use 并返回更新后的 content
          const updateTaskStatusInContent = (content: ChatContent[]): ChatContent[] | null => {
            const idx = content.findIndex(c => {
              if (c.type !== 'tool_use') return false;
              if (taskToolUseId) return c.id === taskToolUseId;
              return c.name === 'Task' || c.name === 'ScheduleTask';
            });
            if (idx === -1) return null;
            const item = content[idx];
            if (item.type !== 'tool_use') return null;

            const updates: Partial<ChatContent> = {
              toolUseCount: payload.toolUseCount as number | undefined,
              lastToolInfo: payload.lastToolInfo as string | undefined,
            };
            if (payload.status === 'completed' || payload.status === 'failed') {
              updates.status = payload.status === 'completed' ? 'completed' : 'error';
              updates.result = {
                success: payload.status === 'completed',
                output: payload.result as string | undefined,
                error: payload.error as string | undefined,
              };
            }
            return content.map((c, i) => i === idx ? { ...c, ...updates } : c);
          };

          // 优先从 currentMessageRef 更新（不可变方式）
          const taskStatusMsg = currentMessageRef.current;
          if (taskStatusMsg) {
            const newContent = updateTaskStatusInContent(taskStatusMsg.content);
            if (newContent) {
              const updatedMsg = { ...taskStatusMsg, content: newContent };
              currentMessageRef.current = updatedMsg;
              setMessages(prev => {
                const filtered = prev.filter(m => m.id !== taskStatusMsg.id);
                return [...filtered, updatedMsg];
              });
              break;
            }
          }

          // fallback: 遍历历史消息
          setMessages(prev => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const msg = prev[i];
              if (msg.role !== 'assistant') continue;
              const newContent = updateTaskStatusInContent(msg.content);
              if (newContent) {
                const updatedMsg = { ...msg, content: newContent };
                return [...prev.slice(0, i), updatedMsg, ...prev.slice(i + 1)];
              }
            }
            return prev;
          });
          break;
        }

        // Bash 前台执行实时输出 — 追加到对应 tool_use 的 streamingOutput
        case 'bash:foreground-output': {
          const toolUseId = payload.toolUseId as string;
          const data = payload.data as string;
          if (!toolUseId || !data) break;

          // 优先更新 currentMessageRef（当前正在构建的消息）
          if (currentMessageRef.current) {
            const currentMsg = currentMessageRef.current;
            const idx = currentMsg.content.findIndex(
              c => c.type === 'tool_use' && c.id === toolUseId && c.status === 'running'
            );
            if (idx !== -1) {
              const item = currentMsg.content[idx];
              if (item.type === 'tool_use') {
                const newContent = [...currentMsg.content];
                newContent[idx] = {
                  ...item,
                  streamingOutput: (item.streamingOutput || '') + data,
                };
                const updatedMsg = { ...currentMsg, content: newContent };
                currentMessageRef.current = updatedMsg;
                setMessages(prev => {
                  const filtered = prev.filter(m => m.id !== currentMsg.id);
                  return [...filtered, updatedMsg];
                });
              }
              break;
            }
          }
          break;
        }

        case 'subagent_tool_start': {
          if (!payload.taskId || !payload.toolCall) break;

          const tc = payload.toolCall as { id: string; name: string; input?: unknown; status: 'running' | 'completed' | 'error'; startTime: number };
          const startToolUseId = payload.toolUseId as string | undefined;
          const newSubagentCall = {
            id: tc.id,
            name: tc.name,
            input: tc.input,
            status: tc.status,
            startTime: tc.startTime,
          };

          // 不可变更新辅助函数：在 content 中找到匹配的 Task 并追加 subagent call
          const addSubagentCallToContent = (content: ChatContent[]): ChatContent[] | null => {
            const idx = content.findIndex(c => {
              if (c.type !== 'tool_use') return false;
              if (startToolUseId) return c.id === startToolUseId;
              return c.name === 'Task' || c.name === 'ScheduleTask';
            });
            if (idx === -1) return null;
            const item = content[idx];
            if (item.type !== 'tool_use') return null;

            return content.map((c, i) => i === idx ? {
              ...c,
              subagentToolCalls: [...(c.subagentToolCalls || []), newSubagentCall],
            } : c);
          };

          // 优先从 currentMessageRef 更新（不可变方式）
          const subStartMsg = currentMessageRef.current;
          if (subStartMsg) {
            const newContent = addSubagentCallToContent(subStartMsg.content);
            if (newContent) {
              const updatedMsg = { ...subStartMsg, content: newContent };
              currentMessageRef.current = updatedMsg;
              setMessages(prev => {
                const filtered = prev.filter(m => m.id !== subStartMsg.id);
                return [...filtered, updatedMsg];
              });
              break;
            }
          }

          // fallback: 遍历历史消息
          setMessages(prev => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const msg = prev[i];
              if (msg.role !== 'assistant') continue;
              const newContent = addSubagentCallToContent(msg.content);
              if (newContent) {
                const updatedMsg = { ...msg, content: newContent };
                return [...prev.slice(0, i), updatedMsg, ...prev.slice(i + 1)];
              }
            }
            return prev;
          });
          break;
        }

        case 'subagent_tool_end': {
          if (!payload.taskId || !payload.toolCall) break;

          const tc = payload.toolCall as { id: string; name: string; status: 'running' | 'completed' | 'error'; result?: string; error?: string; endTime?: number };
          const endToolUseId = payload.toolUseId as string | undefined;

          // 不可变更新辅助函数：在 content 中找到匹配的 Task 并更新 subagent call 状态
          const updateSubagentCallInContent = (content: ChatContent[]): ChatContent[] | null => {
            const idx = content.findIndex(c => {
              if (c.type !== 'tool_use') return false;
              if (endToolUseId) return c.id === endToolUseId;
              // fallback: 找有匹配 subagent call 的 Task 块
              return (c.name === 'Task' || c.name === 'ScheduleTask') &&
                c.subagentToolCalls?.some(call => call.id === tc.id);
            });
            if (idx === -1) return null;
            const item = content[idx];
            if (item.type !== 'tool_use' || !item.subagentToolCalls) return null;

            const updatedCalls = item.subagentToolCalls.map(call =>
              call.id === tc.id
                ? { ...call, status: tc.status, result: tc.result, error: tc.error, endTime: tc.endTime }
                : call
            );

            return content.map((c, i) => i === idx ? {
              ...c,
              subagentToolCalls: updatedCalls,
            } : c);
          };

          // 优先从 currentMessageRef 更新（不可变方式）
          const subEndMsg = currentMessageRef.current;
          if (subEndMsg) {
            const newContent = updateSubagentCallInContent(subEndMsg.content);
            if (newContent) {
              const updatedMsg = { ...subEndMsg, content: newContent };
              currentMessageRef.current = updatedMsg;
              setMessages(prev => {
                const filtered = prev.filter(m => m.id !== subEndMsg.id);
                return [...filtered, updatedMsg];
              });
              break;
            }
          }

          // fallback: 遍历历史消息
          setMessages(prev => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const msg = prev[i];
              if (msg.role !== 'assistant') continue;
              const newContent = updateSubagentCallInContent(msg.content);
              if (newContent) {
                const updatedMsg = { ...msg, content: newContent };
                return [...prev.slice(0, i), updatedMsg, ...prev.slice(i + 1)];
              }
            }
            return prev;
          });
          break;
        }

        // ScheduleTask 倒计时消息
        case 'schedule_countdown': {
          if (!payload.taskId) break;

          const phase = payload.phase as 'countdown' | 'executing' | 'done';
          const remainingMs = payload.remainingMs as number || 0;
          const scheduleTaskName = payload.taskName as string || '';
          const scheduleTriggerAt = payload.triggerAt as number || 0;

          // 查找对应的 ScheduleTask tool_use
          const countdownData = {
            triggerAt: scheduleTriggerAt,
            remainingMs,
            phase,
            taskName: scheduleTaskName,
          };

          const cloneWithCountdown = (msg: ChatMessage): ChatMessage => {
            const newContent = msg.content.map(c => {
              if (c.type === 'tool_use' && c.name === 'ScheduleTask') {
                return { ...c, scheduleCountdown: countdownData };
              }
              return c;
            });
            return { ...msg, content: newContent };
          };

          const hasScheduleTool = (msg: ChatMessage) =>
            msg.content.some(c => c.type === 'tool_use' && c.name === 'ScheduleTask');

          let targetMsg = currentMessageRef.current;
          if (targetMsg && hasScheduleTool(targetMsg)) {
            const updated = cloneWithCountdown(targetMsg);
            currentMessageRef.current = updated;
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== targetMsg!.id);
              return [...filtered, updated];
            });
          } else {
            setMessages(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const msg = prev[i];
                if (msg.role !== 'assistant') continue;
                if (hasScheduleTool(msg)) {
                  return [...prev.slice(0, i), cloneWithCountdown(msg), ...prev.slice(i + 1)];
                }
              }
              return prev;
            });
          }
          break;
        }

        // 定时任务闹钟提醒
        case 'schedule_alarm': {
          const alarmTaskName = payload.taskName as string || '';
          const alarmSessionId = payload.sessionId as string || '';
          const alarmPrompt = payload.prompt as string || '';
          const alarmIsNewSession = !!(payload as any).isNewSession;

          // 只在当前查看的会话中插入提醒消息
          const currentSid = sessionIdRef.current;
          if (alarmSessionId && currentSid === alarmSessionId) {
            const alarmMessage: ChatMessage = {
              id: `alarm-${Date.now()}`,
              role: 'assistant',
              timestamp: Date.now(),
              content: [{
                type: 'text',
                text: `⏰ **定时提醒** — 任务 "${alarmTaskName}" 到时间了！\n\n正在执行: ${alarmPrompt}`,
              }],
              sessionId: alarmSessionId,
            };
            setMessages(prev => [...prev, alarmMessage]);
          }

          // 无论是否是当前会话，都发浏览器通知（用户可能在别的 tab）
          if ('Notification' in window && Notification.permission === 'granted') {
            const body = alarmIsNewSession
              ? `${alarmPrompt.slice(0, 80)}\n(在新会话中执行，请切换查看)`
              : alarmPrompt.slice(0, 100);
            new Notification(`⏰ ${alarmTaskName}`, {
              body,
              icon: '/favicon.ico',
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
          const designPayload = payload as { imageUrl: string; title?: string; style?: string; generatedText?: string };
          if (designPayload.imageUrl) {
            const designContent: ChatContent = {
              type: 'design_image',
              imageUrl: designPayload.imageUrl,
              title: designPayload.title,
              style: designPayload.style,
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
          const cmdResult = payload as SlashCommandResult;
          setStatus('idle');

          // 如果命令要求清除历史（如 /clear）
          if (cmdResult.action === 'clear') {
            setMessages([]);
            break;
          }

          // 以对话框方式展示命令结果
          setSlashCommandResult(cmdResult);
          break;
        }

        case 'blueprint_created':
          console.log('[App] Blueprint created:', (payload as any).name);
          break;

        case 'execution:report':
          console.log('[App] Execution report:', (payload as any).status, (payload as any).summary?.substring(0, 100));
          setMessages(prev => [...prev, {
            id: `exec-report-${Date.now()}`,
            role: 'assistant',
            timestamp: Date.now(),
            content: [{ type: 'text' as const, text: (payload as any).message || '执行完成' }],
          }]);
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
    rateLimitInfo,
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
    crossSessionNotification,
    dismissCrossSessionNotification,
    slashCommandResult,
    setSlashCommandResult,
  };
}
