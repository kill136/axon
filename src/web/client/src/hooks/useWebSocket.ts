import { useState, useEffect, useRef, useCallback } from 'react';
import type { WSMessage } from '../types';
import { updateSkillCommands } from '../utils/constants';

export interface UseWebSocketReturn {
  connected: boolean;
  sessionReady: boolean;
  sessionId: string | null;
  model: string;
  runtimeBackend: string;
  setModel: (model: string) => void;
  send: (message: unknown) => void;
  addMessageHandler: (handler: (msg: WSMessage) => void) => () => void;
}

// localStorage key for persisting session ID across tabs/HMR/reconnects
// 使用 localStorage 而非 sessionStorage，确保多个标签页共享同一个会话上下文
// 这样新开标签页时能自动恢复到当前活跃会话，而不是创建新会话
const SESSION_ID_STORAGE_KEY = 'claude-code-current-session-id';

// BroadcastChannel 用于跨标签页实时同步会话切换
const SESSION_BROADCAST_CHANNEL = 'claude-code-session-sync';

// 这些消息对当前激活会话强绑定；如果来自后台会话，继续分发只会让
// App / TTS / 调试面板等 handler 做无意义工作，导致切换运行中会话时明显卡顿。
// 会话真正切回来时，session_switched 会用 history + 恢复逻辑补齐 UI。
const ACTIVE_SESSION_ONLY_MESSAGE_TYPES = new Set([
  'message_start',
  'text_delta',
  'thinking_start',
  'thinking_delta',
  'thinking_complete',
  'tool_use_start',
  'tool_use_input_ready',
  'tool_use_delta',
  'tool_result',
  'message_complete',
  'error',
  'history',
  'context_update',
  'rate_limit_update',
  'context_compact',
  'task_status',
  'subagent_tool_start',
  'subagent_tool_end',
  'schedule_countdown',
]);

function getMessageSessionId(message: WSMessage): string | null {
  const payload = message.payload;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const sessionId = (payload as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}

function shouldDispatchToHandlers(message: WSMessage, currentSessionId: string | null): boolean {
  const messageSessionId = getMessageSessionId(message);

  if (!messageSessionId || !currentSessionId || messageSessionId === currentSessionId) {
    return true;
  }

  if (message.type.startsWith('continuous_dev:')) {
    return false;
  }

  return !ACTIVE_SESSION_ONLY_MESSAGE_TYPES.has(message.type);
}

function isSessionRestoreFailureMessage(message: string): boolean {
  const errorMsg = message.toLowerCase();
  return errorMsg.includes('会话不存在')
    || errorMsg.includes('session does not exist')
    || errorMsg.includes('failed to resume')
    || errorMsg.includes('failed to switch')
    || errorMsg.includes('failed to load');
}

export function useWebSocket(url: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('opus');
  const [runtimeBackend, setRuntimeBackend] = useState('claude-compatible-api');
  const wsRef = useRef<WebSocket | null>(null);
  const messageHandlersRef = useRef<Array<(msg: WSMessage) => void>>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 追踪组件是否已卸载，防止 React 18 Strict Mode 导致的重复连接问题
  const isMountedRef = useRef(true);
  // 追踪是否正在连接中
  const isConnectingRef = useRef(false);
  // 保存 URL ref，避免 useCallback 依赖变化导致重新连接
  const urlRef = useRef(url);
  urlRef.current = url;
  // 追踪是否已经发送了 session_switch 恢复请求
  const hasRestoredSessionRef = useRef(false);
  const pendingRestoreSessionIdRef = useRef<string | null>(null);
  const requestedFreshSessionRef = useRef(false);
  // BroadcastChannel ref，用于跨标签页同步会话切换
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  // 记录首次连接时的 serverStartTime，后续重连发现变化则 reload 页面
  const serverStartTimeRef = useRef<number | null>(null);
  // 跟踪当前 sessionId（ref 版本，用于同步检查，避免依赖异步 state）
  const sessionIdRef = useRef<string | null>(null);

  // 广播会话变更到其他标签页
  const broadcastSessionChange = useCallback((newSessionId: string) => {
    try {
      broadcastChannelRef.current?.postMessage({ type: 'session_change', sessionId: newSessionId });
    } catch {
      // BroadcastChannel 可能在某些环境不可用，静默忽略
    }
  }, []);

  const connect = useCallback(() => {
    // 防止重复连接
    if (isConnectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (!isMountedRef.current) return;

    isConnectingRef.current = true;
    const ws = new WebSocket(urlRef.current);
    wsRef.current = ws;

    ws.onopen = () => {
      isConnectingRef.current = false;
      // 如果组件已卸载，立即关闭连接
      if (!isMountedRef.current) {
        ws.close();
        return;
      }
      console.log('WebSocket connected');
      setConnected(true);

      // 注入全局发送函数，供前端错误上报使用
      (window as any).__wsSend = (message: unknown) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      };

      // 定期发送 ping 保持连接
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);

      // 检查是否有保存的 sessionId，如果有则自动恢复会话
      // 这对于 HMR 触发的重连特别重要
      if (!hasRestoredSessionRef.current) {
        const savedSessionId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
        if (savedSessionId) {
          console.log('[WebSocket] Detected saved sessionId, attempting to restore session:', savedSessionId);
          hasRestoredSessionRef.current = true;
          pendingRestoreSessionIdRef.current = savedSessionId;
          // 延迟发送，确保 connected 消息已处理
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'session_switch', payload: { sessionId: savedSessionId } }));
            }
          }, 100);
        }
      }
    };

    ws.onmessage = (event) => {
      // 如果组件已卸载，忽略消息
      if (!isMountedRef.current) return;

      try {
        const message = JSON.parse(event.data) as WSMessage;

        // 忽略 pong 消息
        if (message.type === 'pong') return;

        if (message.type === 'error') {
          const payload = message.payload as { message?: string; error?: string };
          const errorText = payload.message || payload.error || '';
          if (pendingRestoreSessionIdRef.current && isSessionRestoreFailureMessage(errorText)) {
            const failedSessionId = pendingRestoreSessionIdRef.current;
            localStorage.removeItem(SESSION_ID_STORAGE_KEY);
            pendingRestoreSessionIdRef.current = null;
            hasRestoredSessionRef.current = false;
            sessionIdRef.current = null;
            setSessionId(null);
            console.log('[WebSocket] Auto-restore failed, clearing stale sessionId:', failedSessionId);

            if (!requestedFreshSessionRef.current && ws.readyState === WebSocket.OPEN) {
              requestedFreshSessionRef.current = true;
              ws.send(JSON.stringify({ type: 'session_new', payload: {} }));
              console.log('[WebSocket] Requested a fresh session after restore failure');
            }
            return;
          }
        }

        if (shouldDispatchToHandlers(message, sessionIdRef.current)) {
          messageHandlersRef.current.forEach(handler => handler(message));
        }

        if (message.type === 'connected') {
          const payload = message.payload as { sessionId: string; model: string; runtimeBackend?: string; serverStartTime?: number };
          
          // 检测后端是否重启过：如果 serverStartTime 变化，说明后端重启了，需要 reload 前端
          if (payload.serverStartTime) {
            if (serverStartTimeRef.current !== null && serverStartTimeRef.current !== payload.serverStartTime) {
              console.log('[WebSocket] Server restarted detected, reloading page to get fresh frontend...');
              window.location.reload();
              return;
            }
            serverStartTimeRef.current = payload.serverStartTime;
          }
          
          // 注意：只有在没有恢复会话的情况下才使用服务端分配的临时 sessionId
          // 如果有保存的 sessionId 且已发送恢复请求，会在 session_switched 中更新
          if (!hasRestoredSessionRef.current) {
            setSessionId(payload.sessionId);
            sessionIdRef.current = payload.sessionId;
          }
          setModel(payload.model);
          if (payload.runtimeBackend) {
            setRuntimeBackend(payload.runtimeBackend);
          }
          setSessionReady(true);
        }

        // 接收后端推送的 skills 列表，更新到斜杠命令补全中
        if (message.type === 'skills_list') {
          const payload = message.payload as { skills: Array<{ name: string; description: string; argumentHint?: string }> };
          updateSkillCommands(payload.skills);
        }

        // IM 新会话：自动切换到该会话（让 Web UI 同步显示 IM 对话）
        if (message.type === 'channel:new_session') {
          const { sessionId: imSessionId } = message.payload as { sessionId: string };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'session_switch', payload: { sessionId: imSessionId } }));
          }
        }

        // 处理会话切换 - 更新 sessionId 并持久化
        if (message.type === 'session_switched') {
          const payload = message.payload as { sessionId: string; model?: string; runtimeBackend?: string };
          pendingRestoreSessionIdRef.current = null;
          requestedFreshSessionRef.current = false;
          setSessionId(payload.sessionId);
          sessionIdRef.current = payload.sessionId;
          if (payload.model) {
            setModel(payload.model);
          }
          if (payload.runtimeBackend) {
            setRuntimeBackend(payload.runtimeBackend);
          }
          // 持久化 sessionId，用于 HMR/重连后恢复
          localStorage.setItem(SESSION_ID_STORAGE_KEY, payload.sessionId);
          broadcastSessionChange(payload.sessionId);
          console.log('[WebSocket] Session switched and saved:', payload.sessionId);
        }

        // 处理新建会话 - 更新 sessionId 并持久化
        if (message.type === 'session_new_ready') {
          const payload = message.payload as { sessionId: string; model: string; runtimeBackend?: string };
          pendingRestoreSessionIdRef.current = null;
          requestedFreshSessionRef.current = false;
          setSessionId(payload.sessionId);
          sessionIdRef.current = payload.sessionId;
          // 新建的临时会话也需要保存，以便 HMR 后能恢复
          localStorage.setItem(SESSION_ID_STORAGE_KEY, payload.sessionId);
          broadcastSessionChange(payload.sessionId);
          if (payload.model) {
            setModel(payload.model);
          }
          if (payload.runtimeBackend) {
            setRuntimeBackend(payload.runtimeBackend);
          }
        }

        // 处理会话创建（持久化会话） - 更新 sessionId 状态和存储
        // 当临时 sessionId 变为持久化 sessionId 时，必须更新 React state
        // 注意：委派任务（delegated-task）和 Agent Chat（agent-chat）创建的会话不应切换当前 sessionId
        if (message.type === 'session_created') {
          const payload = message.payload as { sessionId: string; tags?: string[]; runtimeBackend?: string };
          const isBackgroundSession = payload.tags?.includes('delegated-task') || payload.tags?.includes('agent-chat');
          if (payload.sessionId && !isBackgroundSession) {
            pendingRestoreSessionIdRef.current = null;
            requestedFreshSessionRef.current = false;
            setSessionId(payload.sessionId);
            sessionIdRef.current = payload.sessionId;
            localStorage.setItem(SESSION_ID_STORAGE_KEY, payload.sessionId);
            broadcastSessionChange(payload.sessionId);
            if (payload.runtimeBackend) {
              setRuntimeBackend(payload.runtimeBackend);
            }
            console.log('[WebSocket] Persistent session created and saved:', payload.sessionId);
          }
        }

        // 处理会话删除 - 如果删除的是当前保存的会话，清除 localStorage
        if (message.type === 'session_deleted') {
          const payload = message.payload as { sessionId: string; success: boolean };
          if (payload.success) {
            const savedSessionId = localStorage.getItem(SESSION_ID_STORAGE_KEY);
            if (savedSessionId === payload.sessionId) {
              localStorage.removeItem(SESSION_ID_STORAGE_KEY);
              console.log('[WebSocket] Current session deleted, clearing saved sessionId');
            }
          }
        }

      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };

    ws.onclose = () => {
      isConnectingRef.current = false;
      // 如果组件已卸载，不输出日志和重连
      if (!isMountedRef.current) return;

      console.log('WebSocket disconnected');
      setConnected(false);
      // 清除全局发送函数
      (window as any).__wsSend = undefined;
      // 重置会话恢复标记，确保下次重连时能重新发送 session_switch 恢复会话
      hasRestoredSessionRef.current = false;
      pendingRestoreSessionIdRef.current = null;
      requestedFreshSessionRef.current = false;

      // 清除 ping 定时器
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // 只有在组件仍然挂载时才尝试重连
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('Attempting to reconnect...');
        connect();
      }, 3000);
    };

    ws.onerror = (error) => {
      isConnectingRef.current = false;
      // 如果组件已卸载，不输出错误日志
      if (!isMountedRef.current) return;
      console.error('WebSocket error:', error);
    };
  }, []); // 移除 url 依赖，使用 ref 代替

  useEffect(() => {
    isMountedRef.current = true;
    connect();

    // BroadcastChannel：仅同步 localStorage 中的 sessionId 给其他标签页，
    // **不再自动触发 session_switch**。
    // 原因：自动切换会在多标签页频繁切换时形成乒乓循环
    //  (A broadcast → B switch → B broadcast → A switch → ...)，
    // 导致消息发到错误的会话。
    // 现在只更新 localStorage，这样其他标签页在刷新/重连时会自动恢复到最新会话。
    try {
      const bc = new BroadcastChannel(SESSION_BROADCAST_CHANNEL);
      broadcastChannelRef.current = bc;
      bc.onmessage = (event) => {
        if (!isMountedRef.current) return;
        const { type, sessionId: newSessionId } = event.data;
        if (type === 'session_change' && newSessionId) {
          // 仅更新 localStorage，不触发 session_switch
          // 其他标签页下次刷新或重连时会自动恢复到这个会话
          localStorage.setItem(SESSION_ID_STORAGE_KEY, newSessionId);
          console.log('[WebSocket] BroadcastChannel: updated localStorage to', newSessionId, '(no auto-switch)');
        }
      };
    } catch {
      // BroadcastChannel 可能在某些环境不可用
    }

    return () => {
      // 标记组件为已卸载，阻止所有回调执行
      isMountedRef.current = false;
      isConnectingRef.current = false;

      // 第一优先：立即移除 WS 事件回调，防止 cleanup 期间回调触发 setState
      // （React 18 StrictMode mount→unmount→remount 中有竞态窗口）
      if (wsRef.current) {
        const ws = wsRef.current;
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        // 关闭连接
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
        wsRef.current = null;
      }

      // 清理 BroadcastChannel
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
        broadcastChannelRef.current = null;
      }

      // 清理定时器
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const addMessageHandler = useCallback((handler: (msg: WSMessage) => void) => {
    messageHandlersRef.current.push(handler);
    return () => {
      messageHandlersRef.current = messageHandlersRef.current.filter(h => h !== handler);
    };
  }, []);

  const handleModelChange = useCallback((newModel: string) => {
    setModel(newModel);
    // 发送模型切换消息到服务器
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_model', payload: { model: newModel } }));
    }
  }, []);

  return { connected, sessionReady, sessionId, model, runtimeBackend, setModel: handleModelChange, send, addMessageHandler };
}
