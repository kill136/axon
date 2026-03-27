import { useEffect, useRef, useState } from 'react';
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
}

/**
 * 简单终端 Tab - 仅显示 xterm 终端，无任何额外UI
 */
export function SimpleTerminalTab({
  send,
  addMessageHandler,
  connected,
  projectPath,
  active = true,
}: SimpleTerminalTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

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

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      resizeObserver?.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [send]);

  // 创建终端会话
  useEffect(() => {
    if (!connected) return;

    send({
      type: 'terminal:create',
      payload: { cwd: projectPath || undefined },
    });
  }, [connected, projectPath, send]);

  // 监听 WebSocket 消息
  useEffect(() => {
    const unsubscribe = addMessageHandler((msg: any) => {
      if (!msg.type?.startsWith('terminal:')) return;

      switch (msg.type) {
        case 'terminal:created': {
          terminalIdRef.current = msg.payload.terminalId as string;
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
          const data = msg.payload.data as string;
          if (data && xtermRef.current) {
            xtermRef.current.write(data);
          }
          break;
        }

        case 'terminal:exit': {
          const exitCode = msg.payload.exitCode as number;
          if (xtermRef.current) {
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
      // 清理终端
      if (terminalIdRef.current) {
        send({
          type: 'terminal:destroy',
          payload: { terminalId: terminalIdRef.current },
        });
        terminalIdRef.current = null;
      }
    };
  }, [addMessageHandler, send]);

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
