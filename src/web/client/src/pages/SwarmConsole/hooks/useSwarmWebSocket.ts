/**
 * useSwarmWebSocket Hook
 * 管理蜂群系统的 WebSocket 连接和消息处理
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  SwarmServerMessage,
  SwarmClientMessage,
  SwarmConnectionStatus,
  UseSwarmWebSocketReturn,
} from '../types';

export interface UseSwarmWebSocketOptions {
  url: string;
  onMessage?: (message: SwarmServerMessage) => void;
  onError?: (error: string) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  pingInterval?: number;
}

export function useSwarmWebSocket(options: UseSwarmWebSocketOptions): UseSwarmWebSocketReturn {
  const {
    url,
    onMessage,
    onError,
    autoReconnect = true,
    reconnectInterval = 3000,
    pingInterval = 25000,
  } = options;

  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SwarmConnectionStatus>('disconnected');
  const [lastPongTime, setLastPongTime] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const messageHandlersRef = useRef<Array<(msg: SwarmServerMessage) => void>>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 追踪组件是否已卸载，防止 React 18 Strict Mode 导致的重复连接问题
  const isMountedRef = useRef(true);
  // 追踪是否正在连接中
  const isConnectingRef = useRef(false);
  // 保存 URL ref，避免 useCallback 依赖变化导致重新连接
  const urlRef = useRef(url);
  urlRef.current = url;

  // 添加消息处理器
  const addMessageHandler = useCallback((handler: (msg: SwarmServerMessage) => void) => {
    messageHandlersRef.current.push(handler);
    return () => {
      messageHandlersRef.current = messageHandlersRef.current.filter(h => h !== handler);
    };
  }, []);

  // 注册外部消息处理器
  useEffect(() => {
    if (onMessage) {
      return addMessageHandler(onMessage);
    }
  }, [onMessage, addMessageHandler]);

  // 发送消息
  const send = useCallback((message: SwarmClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected, cannot send message:', message);
    }
  }, []);

  // 连接 WebSocket
  const connect = useCallback(() => {
    // 防止重复连接
    if (isConnectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (!isMountedRef.current) return;

    isConnectingRef.current = true;
    setStatus('connecting');

    const ws = new WebSocket(urlRef.current);
    wsRef.current = ws;

    ws.onopen = () => {
      isConnectingRef.current = false;

      // 如果组件已卸载，立即关闭连接
      if (!isMountedRef.current) {
        ws.close();
        return;
      }

      console.log('[SwarmWebSocket] Connected');
      setConnected(true);
      setStatus('connected');

      // 定期发送 ping 保持连接，并检测连接超时
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));

          // 设置 ping 超时检测（如果 pingInterval 时间内没有收到 pong，认为连接断开）
          if (pingTimeoutRef.current) {
            clearTimeout(pingTimeoutRef.current);
          }
          pingTimeoutRef.current = setTimeout(() => {
            console.warn('[SwarmWebSocket] Ping timeout, connection may be lost');
            // 如果超时没收到 pong，尝试重连
            if (isMountedRef.current && ws.readyState === WebSocket.OPEN) {
              ws.close();
            }
          }, pingInterval * 0.8); // 80% 的 pingInterval 作为超时时间
        }
      }, pingInterval);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as SwarmServerMessage;

        // 处理 pong 消息：更新最后 pong 时间，清除超时计时器
        if (message.type === 'pong') {
          setLastPongTime(Date.now());
          if (pingTimeoutRef.current) {
            clearTimeout(pingTimeoutRef.current);
            pingTimeoutRef.current = null;
          }
          return;
        }

        // 触发所有消息处理器
        messageHandlersRef.current.forEach(handler => {
          try {
            handler(message);
          } catch (err) {
            console.error('[SwarmWebSocket] Message handler error:', err);
          }
        });

        // 处理错误消息
        if (message.type === 'swarm:error') {
          const error = message.payload.error;
          console.error('[SwarmWebSocket] Swarm error:', error);
          if (onError) {
            onError(error);
          }
        }
      } catch (err) {
        console.error('[SwarmWebSocket] Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      isConnectingRef.current = false;
      console.log('[SwarmWebSocket] Disconnected');
      setConnected(false);
      setStatus('disconnected');

      // 清除 ping 定时器
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // 清除 ping 超时定时器
      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
        pingTimeoutRef.current = null;
      }

      // 只有在组件仍然挂载且需要自动重连时才尝试重连
      if (isMountedRef.current && autoReconnect) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[SwarmWebSocket] Attempting to reconnect...');
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = (event) => {
      isConnectingRef.current = false;
      console.error('[SwarmWebSocket] WebSocket error:', event);
      setStatus('error');

      if (onError) {
        onError('WebSocket connection error');
      }
    };
  }, [autoReconnect, reconnectInterval, pingInterval, onError]);

  // 组件挂载时连接，卸载时清理
  useEffect(() => {
    // 只在有效 URL 时才连接（避免 undefined 或空 URL 导致错误）
    if (!url || url.trim() === '') {
      console.log('[SwarmWebSocket] No valid URL provided, skipping connection');
      return;
    }

    isMountedRef.current = true;
    connect();

    return () => {
      isMountedRef.current = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      if (pingTimeoutRef.current) {
        clearTimeout(pingTimeoutRef.current);
        pingTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, url]); // 添加 url 依赖，当 URL 改变时重新连接

  // ============= 蜂群控制方法 =============

  const subscribe = useCallback((blueprintId: string) => {
    send({ type: 'swarm:subscribe', payload: { blueprintId } });
  }, [send]);

  const unsubscribe = useCallback((blueprintId: string) => {
    send({ type: 'swarm:unsubscribe', payload: { blueprintId } });
  }, [send]);

  const pauseSwarm = useCallback((blueprintId: string) => {
    send({ type: 'swarm:pause', payload: { blueprintId } });
  }, [send]);

  const resumeSwarm = useCallback((blueprintId: string) => {
    send({ type: 'swarm:resume', payload: { blueprintId } });
  }, [send]);

  const stopSwarm = useCallback((blueprintId: string) => {
    send({ type: 'swarm:stop', payload: { blueprintId } });
  }, [send]);

  const pauseWorker = useCallback((workerId: string) => {
    send({ type: 'worker:pause', payload: { workerId } });
  }, [send]);

  const resumeWorker = useCallback((workerId: string) => {
    send({ type: 'worker:resume', payload: { workerId } });
  }, [send]);

  const terminateWorker = useCallback((workerId: string) => {
    send({ type: 'worker:terminate', payload: { workerId } });
  }, [send]);

  // v2.1: 重试失败任务
  const retryTask = useCallback((blueprintId: string, taskId: string) => {
    send({ type: 'task:retry', payload: { blueprintId, taskId } });
  }, [send]);

  // v3.8: 跳过失败任务
  const skipTask = useCallback((blueprintId: string, taskId: string) => {
    send({ type: 'task:skip', payload: { blueprintId, taskId } });
  }, [send]);

  // v3.8: 取消执行
  const cancelSwarm = useCallback((blueprintId: string) => {
    send({ type: 'swarm:cancel', payload: { blueprintId } });
  }, [send]);

  // v4.2: AskUserQuestion 响应（支持 E2E Agent 和 Worker）
  const sendAskUserResponse = useCallback((
    blueprintId: string,
    requestId: string,
    answers: Record<string, string>,
    cancelled?: boolean,
    workerId?: string
  ) => {
    send({
      type: 'swarm:ask_response',
      payload: { blueprintId, requestId, answers, cancelled, workerId },
    });
  }, [send]);

  // v4.4: 用户插嘴 - 向正在执行的任务发送消息
  const interjectTask = useCallback((
    blueprintId: string,
    taskId: string,
    message: string
  ) => {
    send({
      type: 'task:interject',
      payload: { blueprintId, taskId, message },
    });
  }, [send]);

  // v9.2: LeadAgent 插嘴 - 向正在执行的 LeadAgent 发送消息
  const interjectLead = useCallback((
    blueprintId: string,
    message: string
  ) => {
    send({
      type: 'lead:interject',
      payload: { blueprintId, message },
    });
  }, [send]);

  // v9.3: 恢复卡死的 LeadAgent 执行
  const resumeLead = useCallback((blueprintId: string) => {
    send({ type: 'swarm:resume_lead', payload: { blueprintId } });
  }, [send]);

  return {
    connected,
    status,
    lastPongTime,
    subscribe,
    unsubscribe,
    pauseSwarm,
    resumeSwarm,
    stopSwarm,
    pauseWorker,
    resumeWorker,
    terminateWorker,
    retryTask,
    skipTask,
    cancelSwarm,
    sendAskUserResponse,
    interjectTask,
    interjectLead,
    resumeLead,
    // 探针功能：暴露底层通信方法
    send,
    addMessageHandler,
  };
}
