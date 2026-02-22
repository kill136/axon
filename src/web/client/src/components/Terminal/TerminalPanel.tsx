/**
 * TerminalPanel - WebUI 多终端面板组件
 * 支持多个终端 Tab，使用 @xterm/xterm 实现浏览器端终端模拟
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './TerminalPanel.css';
import { LogsView } from './LogsView';

// xterm 主题配置
const XTERM_THEME = {
  background: '#0a0e1a',
  foreground: '#e2e8f0',
  cursor: '#6366f1',
  cursorAccent: '#0a0e1a',
  selectionBackground: 'rgba(99, 102, 241, 0.3)',
  selectionForeground: '#f8fafc',
  black: '#1e293b',
  red: '#ef4444',
  green: '#10b981',
  yellow: '#f59e0b',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e2e8f0',
  brightBlack: '#475569',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#f8fafc',
};

interface TerminalTab {
  id: string;           // 客户端 tab ID
  name: string;         // 显示名称
  terminalId: string | null; // 服务端终端 ID（null 表示任务 Tab）
  isReady: boolean;
  isTask?: boolean;     // 是否是后台任务 Tab
  taskId?: string;      // 后台任务 ID（仅任务 Tab）
}

interface TerminalPanelProps {
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  connected: boolean;
  visible: boolean;
  height: number;
  onClose: () => void;
  onHeightChange: (height: number) => void;
  projectPath?: string;
}

/**
 * 单个终端实例组件
 * 始终挂载在 DOM 中（通过 display 控制可见性），确保 xterm 正确初始化
 */
function TerminalInstance({
  tabId,
  active,
  terminalId,
  send,
  panelVisible,
}: {
  tabId: string;
  active: boolean;
  terminalId: string | null;
  send: (msg: any) => void;
  panelVisible: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  // 使用 ref 追踪最新的 terminalId（避免 onData 闭包问题）
  const terminalIdRef = useRef<string | null>(terminalId);
  terminalIdRef.current = terminalId;

  // 初始化 xterm（组件挂载时执行一次）
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
      theme: XTERM_THEME,
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 用户输入 → 发送到服务端
    term.onData((data: string) => {
      const tid = terminalIdRef.current;
      if (tid) {
        send({
          type: 'terminal:input',
          payload: { terminalId: tid, data },
        });
      }
    });

    return () => {
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 当变为活跃或面板变为可见时 fit
  useEffect(() => {
    if (active && panelVisible && fitAddonRef.current) {
      // 使用两次 rAF 确保 DOM 完全 layout
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
            // 同步大小到服务端
            const tid = terminalIdRef.current;
            if (xtermRef.current && tid) {
              send({
                type: 'terminal:resize',
                payload: {
                  terminalId: tid,
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                },
              });
            }
          } catch {}
        });
      });
    }
  }, [active, panelVisible, send]);

  // 暴露写入方法（通过 DOM data attribute 查找实例）
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      // 将写入函数挂载到 DOM 元素上，供父组件查找
      (el as any).__xtermWrite = (data: string) => {
        xtermRef.current?.write(data);
      };
      (el as any).__xtermFit = () => {
        try { fitAddonRef.current?.fit(); } catch {}
      };
      (el as any).__xtermClear = () => {
        xtermRef.current?.clear();
      };
      (el as any).__xtermGetSize = () => {
        if (xtermRef.current) {
          return { cols: xtermRef.current.cols, rows: xtermRef.current.rows };
        }
        return null;
      };
    }
  }, []);

  return (
    <div
      className="terminal-instance"
      data-tab-id={tabId}
      ref={containerRef}
      style={{
        display: active ? 'block' : 'none',
        flex: 1,
        width: '100%',
        height: '100%',
      }}
    />
  );
}

/**
 * 终端面板主组件 - 管理多个终端 Tab
 */
export function TerminalPanel({
  send,
  addMessageHandler,
  connected,
  visible,
  height,
  onClose,
  onHeightChange,
  projectPath,
}: TerminalPanelProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<'terminal' | 'logs'>('terminal');
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  // 待关联的 tabId 队列（用于将 server terminalId 关联到 client tab）
  const pendingTabIdsRef = useRef<string[]>([]);
  const instancesContainerRef = useRef<HTMLDivElement>(null);
  // 终端计数器（用于生成名称）
  const counterRef = useRef(0);

  // 查找某个 tab 对应的 xterm 实例 DOM
  const findInstanceEl = useCallback((tabId: string): HTMLElement | null => {
    return instancesContainerRef.current?.querySelector(`[data-tab-id="${tabId}"]`) || null;
  }, []);

  // 创建新终端
  const addNewTerminal = useCallback(() => {
    if (!connected) return;
    counterRef.current += 1;
    const tabId = `tab-${Date.now()}-${counterRef.current}`;
    const newTab: TerminalTab = {
      id: tabId,
      name: `Terminal ${counterRef.current}`,
      terminalId: null,
      isReady: false,
    };

    pendingTabIdsRef.current.push(tabId);
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(tabId);

    send({
      type: 'terminal:create',
      payload: { cwd: projectPath || undefined },
    });
  }, [connected, send, projectPath]);

  // 关闭终端
  const closeTerminal = useCallback((tabId: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === tabId);
      if (tab?.terminalId) {
        send({
          type: 'terminal:destroy',
          payload: { terminalId: tab.terminalId },
        });
      }

      const newTabs = prev.filter(t => t.id !== tabId);

      // 如果关闭的是活跃 tab，切换到最后一个
      if (tabId === activeTabId) {
        const newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
        // 用 setTimeout 避免 setState 嵌套
        setTimeout(() => setActiveTabId(newActive), 0);
      }

      // 如果没有 tab 了，关闭面板
      if (newTabs.length === 0) {
        setTimeout(() => onClose(), 0);
      }

      return newTabs;
    });
  }, [activeTabId, send, onClose]);

  // 重启当前终端
  const restartTerminal = useCallback(() => {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    // 销毁旧终端
    if (tab.terminalId) {
      send({
        type: 'terminal:destroy',
        payload: { terminalId: tab.terminalId },
      });
    }

    // 清屏
    const el = findInstanceEl(activeTabId);
    if (el) (el as any).__xtermClear?.();

    // 更新 tab 状态
    setTabs(prev => prev.map(t =>
      t.id === activeTabId ? { ...t, terminalId: null, isReady: false } : t
    ));

    // 创建新终端
    pendingTabIdsRef.current.push(activeTabId);
    send({
      type: 'terminal:create',
      payload: { cwd: projectPath || undefined },
    });
  }, [activeTabId, tabs, send, projectPath, findInstanceEl]);

  // 面板首次可见时自动创建第一个终端
  useEffect(() => {
    if (visible && connected && tabs.length === 0) {
      addNewTerminal();
    }
  }, [visible, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // 监听 WebSocket 消息
  useEffect(() => {
    const unsubscribe = addMessageHandler((msg: any) => {
      // 处理终端消息和 Bash 任务消息
      if (!msg.type?.startsWith('terminal:') && !msg.type?.startsWith('bash:')) return;
      const payload = msg.payload as Record<string, unknown>;

      switch (msg.type) {
        case 'terminal:created': {
          const serverTerminalId = payload.terminalId as string;
          // 从队列中取出待关联的 tabId
          const pendingTabId = pendingTabIdsRef.current.shift();
          if (pendingTabId) {
            setTabs(prev => prev.map(t =>
              t.id === pendingTabId
                ? { ...t, terminalId: serverTerminalId, isReady: true }
                : t
            ));

            // fit + resize
            setTimeout(() => {
              const el = findInstanceEl(pendingTabId);
              if (el) {
                (el as any).__xtermFit?.();
                const size = (el as any).__xtermGetSize?.();
                if (size) {
                  send({
                    type: 'terminal:resize',
                    payload: { terminalId: serverTerminalId, cols: size.cols, rows: size.rows },
                  });
                }
              }
            }, 100);
          }
          break;
        }

        case 'terminal:output': {
          const tid = payload.terminalId as string;
          const data = payload.data as string;
          if (!tid || !data) break;

          // 查找对应的 tab 并写入
          // 使用 DOM 查找（因为 tabs state 在闭包中可能过时）
          const container = instancesContainerRef.current;
          if (container) {
            const instances = container.querySelectorAll('.terminal-instance');
            // 需要通过 tabs ref 查找 terminalId 对应的 tabId
            // 但 tabs state 在闭包中可能过时，所以我们遍历所有实例检查
            setTabs(currentTabs => {
              const tab = currentTabs.find(t => t.terminalId === tid);
              if (tab) {
                const el = container.querySelector(`[data-tab-id="${tab.id}"]`);
                if (el) (el as any).__xtermWrite?.(data);
              }
              return currentTabs; // 不修改状态
            });
          }
          break;
        }

        case 'terminal:exit': {
          const tid = payload.terminalId as string;
          const exitCode = payload.exitCode as number;
          setTabs(prev => {
            const tab = prev.find(t => t.terminalId === tid);
            if (tab) {
              const el = instancesContainerRef.current?.querySelector(`[data-tab-id="${tab.id}"]`);
              if (el) {
                (el as any).__xtermWrite?.(
                  `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`
                );
              }
            }
            return prev.map(t =>
              t.terminalId === tid ? { ...t, isReady: false, terminalId: null } : t
            );
          });
          break;
        }

        // ========== Bash 后台任务消息 ==========
        case 'bash:task-started': {
          const taskId = payload.taskId as string;
          const command = payload.command as string;
          if (!taskId || !command) break;

          // 创建新的任务 Tab
          counterRef.current += 1;
          const tabId = `task-${taskId}`;
          const commandPreview = command.length > 40 ? command.substring(0, 40) + '...' : command;
          const newTab: TerminalTab = {
            id: tabId,
            name: `Task: ${commandPreview}`,
            terminalId: null,
            isReady: true,
            isTask: true,
            taskId,
          };

          setTabs(prev => [...prev, newTab]);
          // 自动切换到任务 Tab
          setActiveTabId(tabId);
          break;
        }

        case 'bash:task-output': {
          const taskId = payload.taskId as string;
          const data = payload.data as string;
          if (!taskId || !data) break;

          // 查找对应的任务 Tab 并写入输出
          const container = instancesContainerRef.current;
          if (container) {
            setTabs(currentTabs => {
              const tab = currentTabs.find(t => t.isTask && t.taskId === taskId);
              if (tab) {
                const el = container.querySelector(`[data-tab-id="${tab.id}"]`);
                if (el) (el as any).__xtermWrite?.(data);
              }
              return currentTabs; // 不修改状态
            });
          }
          break;
        }

        case 'bash:task-completed': {
          const taskId = payload.taskId as string;
          const exitCode = payload.exitCode as number;
          const success = payload.success as boolean;
          if (!taskId) break;

          // 显示完成状态
          const container = instancesContainerRef.current;
          if (container) {
            setTabs(currentTabs => {
              const tab = currentTabs.find(t => t.isTask && t.taskId === taskId);
              if (tab) {
                const el = container.querySelector(`[data-tab-id="${tab.id}"]`);
                if (el) {
                  const statusColor = success ? '\x1b[32m' : '\x1b[31m'; // green or red
                  const statusText = success ? 'completed' : 'failed';
                  (el as any).__xtermWrite?.(
                    `\r\n${statusColor}[Task ${statusText} with exit code ${exitCode}]\x1b[0m\r\n`
                  );
                }
              }
              return currentTabs;
            });
          }

          // 3 秒后自动关闭任务 Tab
          setTimeout(() => {
            setTabs(prev => {
              const taskTab = prev.find(t => t.isTask && t.taskId === taskId);
              if (!taskTab) return prev;

              const newTabs = prev.filter(t => !(t.isTask && t.taskId === taskId));

              // 如果关闭的是活跃 tab，切换到最后一个
              if (taskTab.id === activeTabId) {
                const newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
                setTimeout(() => setActiveTabId(newActive), 0);
              }

              // 如果没有 tab 了，关闭面板
              if (newTabs.length === 0) {
                setTimeout(() => onClose(), 0);
              }

              return newTabs;
            });
          }, 3000);
          break;
        }
      }
    });

    return unsubscribe;
  }, [addMessageHandler, send, findInstanceEl, activeTabId, onClose]);

  // 窗口 resize 时 fit 活跃终端
  useEffect(() => {
    const handleResize = () => {
      if (visible && activeTabId) {
        requestAnimationFrame(() => {
          const el = findInstanceEl(activeTabId);
          if (el) {
            (el as any).__xtermFit?.();
            const size = (el as any).__xtermGetSize?.();
            const tab = tabs.find(t => t.id === activeTabId);
            if (size && tab?.terminalId) {
              send({
                type: 'terminal:resize',
                payload: { terminalId: tab.terminalId, cols: size.cols, rows: size.rows },
              });
            }
          }
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [visible, activeTabId, tabs, send, findInstanceEl]);

  // 面板高度或可见性变化时 fit
  useEffect(() => {
    if (visible && activeTabId) {
      // 延迟以等待 CSS 过渡完成
      const timer = setTimeout(() => {
        const el = findInstanceEl(activeTabId);
        if (el) {
          (el as any).__xtermFit?.();
          const size = (el as any).__xtermGetSize?.();
          const tab = tabs.find(t => t.id === activeTabId);
          if (size && tab?.terminalId) {
            send({
              type: 'terminal:resize',
              payload: { terminalId: tab.terminalId, cols: size.cols, rows: size.rows },
            });
          }
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [visible, height, activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 拖拽调整高度
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = height;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = startYRef.current - ev.clientY;
        const newHeight = Math.max(100, Math.min(window.innerHeight - 100, startHeightRef.current + delta));
        onHeightChange(newHeight);
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [height, onHeightChange]
  );

  // 面板隐藏时不渲染（但保持组件挂载）
  // 注意：使用 display:none 而非条件渲染，保持 xterm 实例存活
  return (
    <div
      className="terminal-panel"
      style={{
        height: `${height}px`,
        display: visible ? 'flex' : 'none',
      }}
    >
      {/* 拖拽条 */}
      <div className="terminal-drag-bar" onMouseDown={handleDragStart}>
        <div className="terminal-drag-handle" />
      </div>

      {/* 标题栏 + Tab 栏 */}
      <div className="terminal-header">
        <div className="terminal-header-left">
          {/* 面板模式切换按钮 */}
          <div className="panel-mode-tabs">
            <button
              className={`panel-mode-btn ${panelMode === 'terminal' ? 'active' : ''}`}
              onClick={() => setPanelMode('terminal')}
            >
              Terminal
            </button>
            <button
              className={`panel-mode-btn ${panelMode === 'logs' ? 'active' : ''}`}
              onClick={() => setPanelMode('logs')}
            >
              Logs
            </button>
          </div>
          
          {/* Terminal 模式：显示 Tab 列表 */}
          {panelMode === 'terminal' && (
            <div className="terminal-tabs">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`terminal-tab ${tab.id === activeTabId ? 'active' : ''}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span className="terminal-tab-name">
                    {tab.isReady && <span className="terminal-tab-dot" />}
                    {tab.name}
                  </span>
                  <button
                    className="terminal-tab-close"
                    onClick={(e) => { e.stopPropagation(); closeTerminal(tab.id); }}
                    title="Close"
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
                    </svg>
                  </button>
                </div>
              ))}
              {/* 新建终端按钮 */}
              <button className="terminal-add-btn" onClick={addNewTerminal} title="New Terminal">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1v6H2v2h6v6h2V9h6V7H10V1H8z"/>
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="terminal-header-right">
          {/* Terminal 模式：显示重启和关闭按钮 */}
          {panelMode === 'terminal' && (
            <button className="terminal-action-btn" onClick={restartTerminal} title="Restart Terminal">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M12.75 8a4.5 4.5 0 0 1-8.61 1.834l-1.391.565A6.001 6.001 0 0 0 14.25 8 6 6 0 0 0 3.5 4.334V2.5H2v4h4V5H3.934a4.5 4.5 0 0 1 8.816 3z"/>
              </svg>
            </button>
          )}
          <button className="terminal-action-btn" onClick={onClose} title="Close Panel">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* 终端实例容器 - 所有 Tab 都渲染，通过 display 切换 */}
      <div className="terminal-instances" ref={instancesContainerRef}>
        {/* Terminal 模式：渲染终端实例 */}
        {tabs.map(tab => (
          <TerminalInstance
            key={tab.id}
            tabId={tab.id}
            active={panelMode === 'terminal' && tab.id === activeTabId}
            terminalId={tab.terminalId}
            send={send}
            panelVisible={visible}
          />
        ))}
        
        {/* Logs 模式：渲染日志查看器 */}
        <LogsView
          active={panelMode === 'logs'}
          panelVisible={visible}
          connected={connected}
          send={send}
          addMessageHandler={addMessageHandler}
        />
      </div>
    </div>
  );
}
