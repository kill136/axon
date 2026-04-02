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
 * 简单终端 Tab - 每个实例自行创建和管理自己的终端会话
 * 不再依赖父组件路由 terminalId，彻底消除竞态问题
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
  // 缓冲：在 xterm 初始化前到达的输出
  const pendingOutputRef = useRef<string[]>([]);
  // 防止重复创建
  const createdRef = useRef(false);
  // 用于关联 terminal:create 请求和 terminal:created 响应
  const requestIdRef = useRef<string | null>(null);
  // 保持 send 最新引用
  const sendRef = useRef(send);
  sendRef.current = send;
  // 跟踪 active 状态，供 ResizeObserver 等闭包读取
  const activeRef = useRef(active);
  activeRef.current = active;

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

    const fitWithRetry = () => {
      if (!activeRef.current) return;
      try { fitAddon.fit(); } catch { /* ignore */ }
    };
    requestAnimationFrame(() => fitWithRetry());
    const t1 = setTimeout(fitWithRetry, 100);
    const t2 = setTimeout(fitWithRetry, 300);

    // 监听容器尺寸变化 — 仅在 tab 可见时 fit，否则 display:none 下
    // fitAddon.fit() 会计算出 0 尺寸，导致 PTY resize 为 0x0，
    // Claude Code 等 TUI 程序收到 SIGWINCH 后按错误尺寸渲染，样式彻底错乱
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (!activeRef.current) return;
        try { fitAddon.fit(); } catch { /* ignore */ }
      });
      resizeObserver.observe(containerRef.current);
    }

    // 用户输入 → 发送到服务端
    term.onData((data: string) => {
      const tid = terminalIdRef.current;
      if (tid) {
        sendRef.current({
          type: 'terminal:input',
          payload: { terminalId: tid, data },
        });
      }
    });

    // 阻止 xterm 将 Ctrl+V 作为 \x16 控制字符发送到 PTY
    // 否则 Claude Code 等程序会收到 \x16 并尝试读取（不存在的）服务器系统剪贴板
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key === 'v') {
        return false;
      }
      return true;
    });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      resizeObserver?.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 注册全局图片粘贴回调（供 index.html 中的 inline script 调用）
  useEffect(() => {
    if (!active) return;
    const handler = (base64: string, mimeType: string) => {
      const tid = terminalIdRef.current;
      console.log('[SimpleTerminal] paste callback, tid:', tid, 'sendRef:', typeof sendRef.current);
      if (!tid) {
        console.warn('[SimpleTerminal] no terminalId, cannot paste');
        return;
      }
      // 直接通过 WebSocket 发送，绕过可能有问题的 send 封装
      const msg = JSON.stringify({
        type: 'terminal:paste-image',
        payload: { terminalId: tid, data: base64, mimeType },
      });
      console.log('[SimpleTerminal] sending via WS, msg size:', msg.length);
      try {
        // 用全局 __wsSend（由 useWebSocket 注入），确保通过同一个 WebSocket 发送
        const wsSend = (window as any).__wsSend;
        if (wsSend) {
          wsSend({ type: 'terminal:paste-image', payload: { terminalId: tid, data: base64, mimeType } });
          console.log('[SimpleTerminal] sent via __wsSend');
        } else {
          sendRef.current({ type: 'terminal:paste-image', payload: { terminalId: tid, data: base64, mimeType } });
          console.log('[SimpleTerminal] sent via sendRef (fallback)');
        }
      } catch (err) {
        console.error('[SimpleTerminal] send failed:', err);
      }
    };
    (window as any).__axonTerminalPasteImage = handler;
    return () => {
      if ((window as any).__axonTerminalPasteImage === handler) {
        (window as any).__axonTerminalPasteImage = null;
      }
    };
  }, [active]);

  // 创建终端会话（仅一次）
  useEffect(() => {
    if (!connected || createdRef.current) return;
    createdRef.current = true;
    const reqId = `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    requestIdRef.current = reqId;
    send({ type: 'terminal:create', payload: { cwd: projectPath || undefined, requestId: reqId } });
  }, [connected, projectPath, send]);

  // 监听 WebSocket 消息
  useEffect(() => {
    const unsubscribe = addMessageHandler((msg: any) => {
      if (!msg.type?.startsWith('terminal:')) return;
      const payload = msg.payload as Record<string, unknown>;

      switch (msg.type) {
        case 'terminal:created': {
          // 通过 requestId 精确匹配自己创建的终端，避免误领其他组件的 terminal
          if (terminalIdRef.current) break;
          const serverTerminalId = payload.terminalId as string;
          if (!serverTerminalId) break;
          // 如果有 requestId，必须匹配；如果服务端没有返回 requestId（兼容旧版），回退到首个认领
          const respRequestId = payload.requestId as string | undefined;
          if (requestIdRef.current && respRequestId && respRequestId !== requestIdRef.current) break;
          terminalIdRef.current = serverTerminalId;
          setTerminalReady(true);

          // fit + resize + 刷入缓冲
          setTimeout(() => {
            if (fitAddonRef.current && xtermRef.current) {
              try {
                // 仅在 active 时 fit，避免 display:none 下得到 0 尺寸
                if (activeRef.current) {
                  fitAddonRef.current.fit();
                }
                // 刷入缓冲的输出（无论是否 active 都要刷）
                for (const chunk of pendingOutputRef.current) {
                  xtermRef.current.write(chunk);
                }
                pendingOutputRef.current = [];
                // 仅在有效尺寸时发送 resize
                const { cols, rows } = xtermRef.current;
                if (cols > 0 && rows > 0) {
                  send({
                    type: 'terminal:resize',
                    payload: {
                      terminalId: terminalIdRef.current,
                      cols,
                      rows,
                    },
                  });
                }
              } catch { /* ignore */ }
            }
          }, 50);
          break;
        }

        case 'terminal:output': {
          const tid = payload.terminalId as string;
          const data = payload.data as string;
          if (!tid || !data) break;
          const myTid = terminalIdRef.current;
          if (tid !== myTid) {
            // 如果自己还没 terminalId，可能是早期消息，缓冲
            if (!myTid) {
              pendingOutputRef.current.push(data);
            }
            break;
          }
          if (xtermRef.current) {
            xtermRef.current.write(data);
          } else {
            pendingOutputRef.current.push(data);
          }
          break;
        }

        case 'terminal:exit': {
          const tid = payload.terminalId as string;
          if (tid && tid === terminalIdRef.current && xtermRef.current) {
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
      if (terminalIdRef.current) {
        sendRef.current({
          type: 'terminal:destroy',
          payload: { terminalId: terminalIdRef.current },
        });
        terminalIdRef.current = null;
      }
    };
  }, [addMessageHandler, send]);

  // fit 当容器变为可见时
  useEffect(() => {
    if (terminalReady && active && fitAddonRef.current) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try {
            fitAddonRef.current?.fit();
            if (xtermRef.current && terminalIdRef.current) {
              const { cols, rows } = xtermRef.current;
              // 防止发送无效尺寸（理论上此时 active=true 不会出现，但做防御）
              if (cols > 0 && rows > 0) {
                sendRef.current({
                  type: 'terminal:resize',
                  payload: {
                    terminalId: terminalIdRef.current,
                    cols,
                    rows,
                  },
                });
              }
            }
          } catch { /* ignore */ }
        });
      });
    }
  }, [terminalReady, active]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: active ? 'block' : 'none',
      }}
    />
  );
}
