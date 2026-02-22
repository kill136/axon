/**
 * LogsView - 日志查看器组件
 * 实时显示 runtime.log 日志内容，支持级别过滤和自动刷新
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import './LogsView.css';

// 日志级别类型
type LogLevel = 'error' | 'warn' | 'info' | 'debug';

// 日志条目接口
interface LogEntry {
  ts: string;
  level: LogLevel;
  module: string;
  msg: string;
  stack?: string;
  data?: unknown;
}

interface LogsViewProps {
  active: boolean;         // 当前是否是活跃 Tab
  panelVisible: boolean;   // 面板是否可见
  connected: boolean;      // WebSocket 是否已连接
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
}

// 级别过滤选项
const LEVEL_FILTERS = ['ALL', 'ERROR', 'WARN', 'INFO'] as const;
type LevelFilter = typeof LEVEL_FILTERS[number];

// 级别颜色映射
const LEVEL_COLORS: Record<LogLevel, string> = {
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#64748b',
};

/**
 * 格式化时间戳为 HH:MM:SS.mmm
 */
function formatTime(ts: string): string {
  try {
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  } catch {
    return ts;
  }
}

/**
 * LogsView 组件
 */
export function LogsView({ active, panelVisible, connected, send, addMessageHandler }: LogsViewProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrollTop = useRef(0);

  // 过滤后的日志条目
  const filteredEntries = levelFilter === 'ALL' 
    ? entries 
    : entries.filter(e => e.level === levelFilter.toLowerCase());

  // 先注册消息处理器，再发请求——避免竞态（响应早于 handler 注册）
  // 依赖 connected：组件可能在 WebSocket 连接前就挂载，connected 变 true 时重新订阅
  useEffect(() => {
    if (!connected) return;

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'logs:data') {
        // 初始数据
        setEntries(msg.payload.entries || []);
      } else if (msg.type === 'logs:tail') {
        // 实时更新（追加新日志）
        const newEntries = msg.payload.entries || [];
        if (newEntries.length > 0) {
          setEntries(prev => {
            // 合并新日志，去重（基于时间戳+消息）
            const combined = [...prev, ...newEntries];
            const unique = Array.from(
              new Map(combined.map(e => [`${e.ts}:${e.msg}`, e])).values()
            );
            // 保留最近 1000 条
            return unique.slice(-1000);
          });
        }
      }
    });

    // handler 注册后再发请求
    send({ type: 'logs:read', payload: { count: 200 } });
    send({ type: 'logs:subscribe' });

    return () => {
      unsubscribe();
      send({ type: 'logs:unsubscribe' });
    };
  }, [addMessageHandler, send, connected]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredEntries, autoScroll]);

  // 监听用户手动滚动，暂停自动滚动
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    
    // 如果用户向上滚动，暂停自动滚动
    if (scrollTop < lastScrollTop.current) {
      setAutoScroll(false);
    }
    
    // 如果滚动到底部，恢复自动滚动
    if (scrollHeight - scrollTop - clientHeight < 10) {
      setAutoScroll(true);
    }
    
    lastScrollTop.current = scrollTop;
  }, []);

  // 清屏
  const handleClear = useCallback(() => {
    setEntries([]);
    setExpandedIds(new Set());
  }, []);

  // 切换展开/折叠
  const toggleExpand = useCallback((index: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  return (
    <div 
      className="logs-view"
      style={{ display: active ? 'flex' : 'none' }}
    >
      {/* 工具栏 */}
      <div className="logs-toolbar">
        <div className="logs-toolbar-left">
          {/* 级别过滤按钮 */}
          {LEVEL_FILTERS.map(level => (
            <button
              key={level}
              className={`logs-filter-btn ${levelFilter === level ? 'active' : ''}`}
              onClick={() => setLevelFilter(level)}
              title={`Filter by ${level}`}
            >
              {level}
            </button>
          ))}
        </div>
        <div className="logs-toolbar-right">
          {/* 自动滚动开关 */}
          <label className="logs-auto-scroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto Scroll</span>
          </label>
          {/* 清屏按钮 */}
          <button
            className="logs-clear-btn"
            onClick={handleClear}
            title="Clear logs"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div 
        className="logs-container"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {filteredEntries.length === 0 ? (
          <div className="logs-empty">No logs to display</div>
        ) : (
          filteredEntries.map((entry, index) => {
            const isExpanded = expandedIds.has(index);
            const hasDetails = entry.stack || entry.data;
            
            return (
              <div key={index} className="log-entry">
                <div 
                  className="log-entry-main"
                  onClick={() => hasDetails && toggleExpand(index)}
                  style={{ cursor: hasDetails ? 'pointer' : 'default' }}
                >
                  {/* 时间 */}
                  <span className="log-time">{formatTime(entry.ts)}</span>
                  
                  {/* 级别标签 */}
                  <span 
                    className="log-level"
                    style={{ 
                      backgroundColor: LEVEL_COLORS[entry.level],
                      color: '#fff',
                    }}
                  >
                    {entry.level.toUpperCase()}
                  </span>
                  
                  {/* 模块名 */}
                  <span className="log-module">{entry.module}</span>
                  
                  {/* 消息 */}
                  <span className="log-message">{entry.msg}</span>
                  
                  {/* 展开指示器 */}
                  {hasDetails && (
                    <span className="log-expand-icon">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  )}
                </div>
                
                {/* 展开的详细信息 */}
                {isExpanded && hasDetails && (
                  <div className="log-entry-details">
                    {entry.stack && (
                      <div className="log-detail-section">
                        <div className="log-detail-label">Stack Trace:</div>
                        <pre className="log-detail-content">{entry.stack}</pre>
                      </div>
                    )}
                    {entry.data && (
                      <div className="log-detail-section">
                        <div className="log-detail-label">Data:</div>
                        <pre className="log-detail-content">
                          {JSON.stringify(entry.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
