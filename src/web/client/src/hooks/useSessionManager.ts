/**
 * useSessionManager hook
 * 从 App.tsx 提取的会话管理逻辑
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjectChangeListener, type Project, type BlueprintInfo } from '../contexts/ProjectContext';
import type { Session, WSMessage } from '../types';

// 防抖函数
function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const debouncedFn = ((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  }) as T & { cancel: () => void };
  debouncedFn.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  return debouncedFn;
}

interface UseSessionManagerParams {
  connected: boolean;
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: WSMessage) => void) => () => void;
  sessionId: string | null;
  model: string;
  currentProjectPath?: string;
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
}

/**
 * 会话实时状态（用于侧边栏状态指示器，借鉴 cmux 通知环设计）
 */
export type SessionActivityStatus =
  | 'idle'              // 空闲
  | 'thinking'          // AI 正在思考
  | 'streaming'         // AI 正在输出
  | 'tool_executing'    // 正在执行工具
  | 'waiting_input'     // 等待用户输入（user_question）
  | 'waiting_permission'; // 等待权限确认（permission_request）

interface UseSessionManagerReturn {
  sessions: Session[];
  sessionStatusMap: Map<string, SessionActivityStatus>;
  refreshSessions: () => void;
  handleSessionSelect: (id: string) => void;
  handleSessionDelete: (id: string) => void;
  handleSessionRename: (id: string, name: string) => void;
  handleNewSession: () => void;
  handleSearchSessions: (query: string) => void;
  handleSessionExport: (id: string, format?: 'json' | 'md') => void;
  handleSessionImport: (content: string) => void;
}

export function useSessionManager({
  connected,
  send,
  addMessageHandler,
  sessionId,
  model,
  currentProjectPath,
  setMessages,
}: UseSessionManagerParams): UseSessionManagerReturn {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionStatusMap, setSessionStatusMap] = useState<Map<string, SessionActivityStatus>>(new Map());

  // 防抖的会话列表刷新函数
  const refreshSessionsRef = useRef<ReturnType<typeof debounce> | null>(null);

  useEffect(() => {
    refreshSessionsRef.current = debounce(() => {
      if (connected) {
        send({
          type: 'session_list',
          payload: {
            limit: 50,
            sortBy: 'updatedAt',
            sortOrder: 'desc',
            projectPath: currentProjectPath,
          },
        });
      }
    }, 500);

    return () => {
      refreshSessionsRef.current?.cancel();
    };
  }, [connected, send, currentProjectPath]);

  const refreshSessions = useCallback(() => {
    refreshSessionsRef.current?.();
  }, []);

  // 监听 session_list_response 和 session_deleted/renamed 消息
  useEffect(() => {
    const unsubscribe = addMessageHandler((msg: WSMessage) => {
      const payload = msg.payload as Record<string, unknown>;

      switch (msg.type) {
        case 'session_list_response':
          if (payload.sessions) {
            setSessions(payload.sessions as Session[]);
          }
          break;

        case 'session_deleted':
          if (payload.success) {
            const deletedId = payload.sessionId as string;
            setSessions(prev => prev.filter(s => s.id !== deletedId));
          }
          break;

        case 'session_renamed':
          if (payload.success) {
            setSessions(prev =>
              prev.map(s => (s.id === payload.sessionId ? { ...s, name: payload.name as string } : s))
            );
          }
          break;

        case 'session_created':
          if (payload.sessionId) {
            // 直接将新会话插入列表头部（乐观更新）
            // 服务端会话列表通过 name/summary/messageCount 过滤，
            // 新会话有 name 所以不会被过滤，但乐观插入可以避免等待刷新
            const newSession: Session = {
              id: payload.sessionId as string,
              name: (payload.name as string) || '新会话',
              updatedAt: (payload.createdAt as number) || Date.now(),
              messageCount: 0,
            };
            setSessions(prev => {
              if (prev.some(s => s.id === newSession.id)) return prev;
              return [newSession, ...prev];
            });
          }
          break;

        case 'session_switched':
          // 切换会话后，如果目标会话不在 sessions 列表中（跨项目/被过滤），
          // 乐观插入到列表头部，确保 TopNavBar 会话选择器能显示正确的会话名
          if (payload.sessionId) {
            const switchedId = payload.sessionId as string;
            const switchedName = payload.sessionName as string | undefined;
            setSessions(prev => {
              if (prev.some(s => s.id === switchedId)) return prev;
              // 会话不在列表中，插入一个临时项
              return [{
                id: switchedId,
                name: switchedName || switchedId,
                updatedAt: Date.now(),
                messageCount: 0,
              }, ...prev];
            });
          }
          break;

        case 'session_exported': {
          const content = payload.content as string;
          const fmt = payload.format as string;
          const ext = fmt === 'md' ? 'md' : 'json';
          const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `session-${(payload.sessionId as string).slice(0, 8)}.${ext}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          break;
        }

        case 'session_imported':
          if (payload.success) {
            refreshSessions();
          }
          break;

        case 'message_complete':
          // 对话完成后刷新列表，更新 messageCount 和 updatedAt
          refreshSessions();
          break;

        // === 会话状态追踪（用于侧边栏状态指示器） ===
        case 'status': {
          const sid = payload.sessionId as string | undefined;
          if (sid) {
            const s = payload.status as string;
            let activity: SessionActivityStatus = 'idle';
            if (s === 'thinking') activity = 'thinking';
            else if (s === 'streaming') activity = 'streaming';
            else if (s === 'tool_executing') activity = 'tool_executing';
            setSessionStatusMap(prev => {
              const next = new Map(prev);
              if (activity === 'idle') next.delete(sid);
              else next.set(sid, activity);
              return next;
            });
          }
          break;
        }
        case 'user_question': {
          const sid = payload.sessionId as string | undefined;
          if (sid) {
            setSessionStatusMap(prev => {
              const next = new Map(prev);
              next.set(sid, 'waiting_input');
              return next;
            });
          }
          break;
        }
        case 'permission_request': {
          const sid = payload.sessionId as string | undefined;
          if (sid) {
            setSessionStatusMap(prev => {
              const next = new Map(prev);
              next.set(sid, 'waiting_permission');
              return next;
            });
          }
          break;
        }
      }
    });

    return unsubscribe;
  }, [addMessageHandler, refreshSessions]);

  // 连接成功后请求会话列表
  useEffect(() => {
    if (connected) {
      send({
        type: 'session_list',
        payload: {
          limit: 50,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          projectPath: currentProjectPath,
        },
      });
    }
  }, [connected, send, currentProjectPath]);

  // 监听项目切换事件
  useProjectChangeListener(
    useCallback(
      (project: Project | null, _blueprint: BlueprintInfo | null) => {
        console.log('[App] Project switched, creating new session for:', project?.path);
        if (connected) {
          // 切换项目时自动创建新会话，确保当前会话关联到新目录
          setMessages([]);
          send({ type: 'session_new', payload: { model, projectPath: project?.path } });
          // 刷新会话列表（按新项目过滤）
          send({
            type: 'session_list',
            payload: {
              limit: 50,
              sortBy: 'updatedAt',
              sortOrder: 'desc',
              projectPath: project?.path,
            },
          });
        }
      },
      [connected, send, model, setMessages]
    )
  );

  const handleSessionSelect = useCallback(
    (id: string) => {
      send({ type: 'session_switch', payload: { sessionId: id } });
    },
    [send]
  );

  const handleSessionDelete = useCallback(
    (id: string) => {
      send({ type: 'session_delete', payload: { sessionId: id } });
    },
    [send]
  );

  const handleSessionRename = useCallback(
    (id: string, name: string) => {
      send({ type: 'session_rename', payload: { sessionId: id, name } });
    },
    [send]
  );

  const handleNewSession = useCallback(() => {
    setMessages([]);
    send({ type: 'session_new', payload: { model, projectPath: currentProjectPath } });
  }, [send, model, currentProjectPath, setMessages]);

  // 服务端搜索（供 SessionSearchModal 使用）
  const handleSearchSessions = useCallback((query: string) => {
    if (connected) {
      send({
        type: 'session_list',
        payload: {
          limit: 100,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          search: query || undefined,
          projectPath: currentProjectPath,
        },
      });
    }
  }, [connected, send, currentProjectPath]);

  // 导出会话
  const handleSessionExport = useCallback((id: string, format: 'json' | 'md' = 'json') => {
    send({ type: 'session_export', payload: { sessionId: id, format } });
  }, [send]);

  // 导入会话（接收 JSON 字符串）
  const handleSessionImport = useCallback((content: string) => {
    send({ type: 'session_import', payload: { content } });
  }, [send]);

  return {
    sessions,
    sessionStatusMap,
    refreshSessions,
    handleSessionSelect,
    handleSessionDelete,
    handleSessionRename,
    handleNewSession,
    handleSearchSessions,
    handleSessionExport,
    handleSessionImport,
  };
}
