import { useState, useEffect, useRef, useCallback } from 'react';
import type { WSMessage } from '../types';
import { updateSkillCommands } from '../utils/constants';

export interface UseWebSocketReturn {
  connected: boolean;
  sessionReady: boolean;
  sessionId: string | null;
  model: string;
  setModel: (model: string) => void;
  send: (message: unknown) => void;
  addMessageHandler: (handler: (msg: WSMessage) => void) => () => void;
}

// sessionStorage key for persisting session ID across HMR/reconnects
// 使用 sessionStorage 而非 localStorage，确保每个标签页有独立的会话上下文
// sessionStorage 在同一标签页内刷新/HMR 时保持，但不会跨标签页共享
const SESSION_ID_STORAGE_KEY = 'claude-code-current-session-id';

export function useWebSocket(url: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('opus');
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

      // 定期发送 ping 保持连接
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);

      // 检查是否有保存的 sessionId，如果有则自动恢复会话
      // 这对于 HMR 触发的重连特别重要
      if (!hasRestoredSessionRef.current) {
        const savedSessionId = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
        if (savedSessionId) {
          console.log('[WebSocket] Detected saved sessionId, attempting to restore session:', savedSessionId);
          hasRestoredSessionRef.current = true;
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

        messageHandlersRef.current.forEach(handler => handler(message));

        if (message.type === 'connected') {
          const payload = message.payload as { sessionId: string; model: string };
          // 注意：只有在没有恢复会话的情况下才使用服务端分配的临时 sessionId
          // 如果有保存的 sessionId 且已发送恢复请求，会在 session_switched 中更新
          if (!hasRestoredSessionRef.current) {
            setSessionId(payload.sessionId);
          }
          setModel(payload.model);
          setSessionReady(true);
        }

        // 接收后端推送的 skills 列表，更新到斜杠命令补全中
        if (message.type === 'skills_list') {
          const payload = message.payload as { skills: Array<{ name: string; description: string; argumentHint?: string }> };
          updateSkillCommands(payload.skills);
        }

        // 处理会话切换 - 更新 sessionId 并持久化
        if (message.type === 'session_switched') {
          const payload = message.payload as { sessionId: string };
          setSessionId(payload.sessionId);
          // 持久化 sessionId，用于 HMR/重连后恢复
          sessionStorage.setItem(SESSION_ID_STORAGE_KEY, payload.sessionId);
          console.log('[WebSocket] Session switched and saved:', payload.sessionId);
        }

        // 处理新建会话 - 更新 sessionId 并持久化
        if (message.type === 'session_new_ready') {
          const payload = message.payload as { sessionId: string; model: string };
          setSessionId(payload.sessionId);
          // 新建的临时会话也需要保存，以便 HMR 后能恢复
          sessionStorage.setItem(SESSION_ID_STORAGE_KEY, payload.sessionId);
          if (payload.model) {
            setModel(payload.model);
          }
        }

        // 处理会话创建（持久化会话） - 更新 sessionId 状态和存储
        // 当临时 sessionId 变为持久化 sessionId 时，必须更新 React state
        if (message.type === 'session_created') {
          const payload = message.payload as { sessionId: string };
          if (payload.sessionId) {
            setSessionId(payload.sessionId);
            sessionStorage.setItem(SESSION_ID_STORAGE_KEY, payload.sessionId);
            console.log('[WebSocket] Persistent session created and saved:', payload.sessionId);
          }
        }

        // 处理会话删除 - 如果删除的是当前保存的会话，清除 sessionStorage
        if (message.type === 'session_deleted') {
          const payload = message.payload as { sessionId: string; success: boolean };
          if (payload.success) {
            const savedSessionId = sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
            if (savedSessionId === payload.sessionId) {
              sessionStorage.removeItem(SESSION_ID_STORAGE_KEY);
              console.log('[WebSocket] Current session deleted, clearing saved sessionId');
            }
          }
        }

        // 处理恢复会话失败 - 清除无效的 sessionId
        if (message.type === 'error') {
          const payload = message.payload as { message: string };
          if (payload.message === '会话不存在或加载失败' || payload.message === '会话不存在或恢复失败') {
            sessionStorage.removeItem(SESSION_ID_STORAGE_KEY);
            hasRestoredSessionRef.current = false;
            console.log('[WebSocket] Session restore failed, clearing invalid sessionId');
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
      // 重置会话恢复标记，确保下次重连时能重新发送 session_switch 恢复会话
      hasRestoredSessionRef.current = false;

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

    return () => {
      // 标记组件为已卸载，阻止所有回调执行
      isMountedRef.current = false;
      isConnectingRef.current = false;

      // 清理定时器
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // 清理 WebSocket 连接
      if (wsRef.current) {
        const ws = wsRef.current;
        // 移除所有事件监听器，防止回调被触发
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

  return { connected, sessionReady, sessionId, model, setModel: handleModelChange, send, addMessageHandler };
}
