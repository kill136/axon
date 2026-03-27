import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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

interface SimpleTerminalTabProps {
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  connected: boolean;
  projectPath?: string;
  /** 是否为当前活跃 tab（控制 display 可见性） */
  active?: boolean;
  /** 服务端分配的 terminalId（由父组件管理，解决多实例消息路由问题） */
  terminalId?: string | null;
  /** 同步 terminalId 映射 ref（解决 React 异步渲染导致的早期消息丢失） */
  terminalIdSyncRef?: MutableRefObject<Record<string, string | null>>;
  /** 当前 tab 的路径标识（配合 terminalIdSyncRef 使用） */
  tabPath?: string;
}

/**
 * 简单终端 Tab - 仅显示 xterm 终端，无任何额外UI
 *
 * 多实例模式：当传入 terminalId 时，不自行创建终端，仅处理匹配 terminalId 的消息。
 * 单实例模式（向后兼容）：不传 terminalId 时，自行发送 terminal:create。
 */
export function SimpleTerminalTab({
  send,
  addMessageHandler,
  connected,
  projectPath,
  active = true,
  terminalId: externalTerminalId,
  terminalIdSyncRef,
  tabPath,
}: SimpleTerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(externalTerminalId ?? null);
  const [terminalReady, setTerminalReady] = useState(false);
  // 是否由父组件管理终端创建
  const managedExternally = externalTerminalId !== undefined;

  // 同步外部 terminalId
  useEffect(() => {
    if (managedExternally) {
      terminalIdRef.current = externalTerminalId ?? null;
      if (externalTerminalId) {
        setTerminalReady(true);
      }
    }
  }, [externalTerminalId, managedExternally]);

  // 初始化 xterm
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

    // 尝试 fit
    const fitWithRetry = () => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    };
    requestAnimationFrame(() => fitWithRetry());
    const t1 = setTimeout(fitWithRetry, 100);
    const t2 = setTimeout(fitWithRetry, 300);

    // 监听容器尺寸变化
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // ignore
        }
      });
      resizeObserver.observe(containerRef.current);
    }

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

    // 剪贴板图片粘贴：拦截 paste 事件，保存图片为临时文件，将路径写入终端
    const container = containerRef.current;
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imageItem = items.find(item => item.type.startsWith('image/'));
      if (!imageItem) return; // 非图片粘贴，交给 xterm 默认处理

      e.preventDefault();
      e.stopPropagation();
      const blob = imageItem.getAsFile();
      if (!blob) return;

      const tid = terminalIdRef.current;
      if (!tid) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        send({
          type: 'terminal:paste-image',
          payload: {
            terminalId: tid,
            data: base64,
            mimeType: imageItem.type,
          },
        });
      };
      reader.readAsDataURL(blob);
    };
    container?.addEventListener('paste', handlePaste);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      container?.removeEventListener('paste', handlePaste);
      resizeObserver?.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [send]);

  // 单实例模式：自行创建终端会话
  useEffect(() => {
    if (managedExternally) return;
    if (!connected) return;

    send({
      type: 'terminal:create',
      payload: { cwd: projectPath || undefined },
    });
  }, [connected, projectPath, send, managedExternally]);

  // 监听 WebSocket 消息
  useEffect(() => {
    // 获取当前实例的 terminalId（优先从同步 ref 读取，避免 React 渲染延迟导致丢消息）
    const getMyTerminalId = (): string | null => {
      if (terminalIdSyncRef && tabPath) {
        return terminalIdSyncRef.current[tabPath] ?? null;
      }
      return terminalIdRef.current;
    };

    const unsubscribe = addMessageHandler((msg: any) => {
      if (!msg.type?.startsWith('terminal:')) return;
      const payload = msg.payload as Record<string, unknown>;

      switch (msg.type) {
        case 'terminal:created': {
          // 多实例模式下不处理 created（由父组件管理）
          if (managedExternally) break;
          terminalIdRef.current = payload.terminalId as string;
          setTerminalReady(true);

          // fit + resize
          setTimeout(() => {
            if (fitAddonRef.current && xtermRef.current) {
              try {
                fitAddonRef.current.fit();
                send({
                  type: 'terminal:resize',
                  payload: {
                    terminalId: terminalIdRef.current,
                    cols: xtermRef.current.cols,
                    rows: xtermRef.current.rows,
                  },
                });
              } catch {
                // ignore
              }
            }
          }, 100);
          break;
        }

        case 'terminal:output': {
          const tid = payload.terminalId as string;
          const data = payload.data as string;
          const myTid = getMyTerminalId();
          // 只处理属于自己的终端输出
          if (tid && tid === myTid && data && xtermRef.current) {
            xtermRef.current.write(data);
          }
          break;
        }

        case 'terminal:exit': {
          const tid = payload.terminalId as string;
          const myTid = getMyTerminalId();
          // 只处理属于自己的终端退出
          if (tid && tid === myTid && xtermRef.current) {
            const exitCode = payload.exitCode as number;
            xtermRef.current.write(
              `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`
            );
          }
          break;
        }
      }
    });

    return () => {
      unsubscribe();
      // 仅单实例模式下清理终端（多实例模式由父组件管理生命周期）
      if (!managedExternally && terminalIdRef.current) {
        send({
          type: 'terminal:destroy',
          payload: { terminalId: terminalIdRef.current },
        });
        terminalIdRef.current = null;
      }
    };
  }, [addMessageHandler, send, managedExternally]);

  // 处理 fit 当容器可见时（包括 active 切换回来时）
  useEffect(() => {
    if (terminalReady && active && fitAddonRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
            if (xtermRef.current && terminalIdRef.current) {
              send({
                type: 'terminal:resize',
                payload: {
                  terminalId: terminalIdRef.current,
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows,
                },
              });
            }
          } catch {
            // ignore
          }
        });
      });
    }
  }, [terminalReady, active, send]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        display: active ? 'block' : 'none',
      }}
    />
  );
}
