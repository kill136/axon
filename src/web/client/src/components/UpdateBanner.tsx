/**
 * UpdateBanner - VS Code / Cursor 风格无感更新通知
 *
 * Electron 模式：通过 electronAPI.update IPC 通道接收更新事件
 * Web 模式：通过 /api/update-check 检查更新（回退方案）
 */

import { useState, useEffect, useCallback } from 'react';

type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface UpdateState {
  status: UpdateStatus;
  version?: string;
  progress?: { percent: number; bytesPerSecond?: number; transferred?: number; total?: number };
  error?: string;
}

// 检测 Electron 环境
const electronUpdate = (window as any).electronAPI?.update as {
  onStatus: (cb: (data: any) => void) => () => void;
  checkForUpdate: () => Promise<any>;
  install: () => void;
} | undefined;

export function UpdateBanner() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  // Electron 模式：监听 IPC 事件
  useEffect(() => {
    if (!electronUpdate) return;

    const unsubscribe = electronUpdate.onStatus((data) => {
      setState((prev) => ({
        ...prev,
        status: data.status,
        version: data.version ?? prev.version,
        progress: data.progress,
        error: data.error,
      }));
      // 更新就绪时清除 dismiss 状态（重要更新不应被忽略）
      if (data.status === 'ready') {
        setDismissed(false);
        sessionStorage.removeItem('axon-update-dismissed');
      }
    });

    return unsubscribe;
  }, []);

  // Web 模式：轮询 /api/update-check（仅非 Electron 环境）
  useEffect(() => {
    if (electronUpdate) return;

    if (sessionStorage.getItem('axon-update-dismissed')) {
      setDismissed(true);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/update-check');
        if (!res.ok) return;
        const data = await res.json();
        if (data.hasUpdate) {
          setState({
            status: 'ready',
            version: data.latest,
          });
        }
      } catch {
        // 非关键路径，静默忽略
      }
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem('axon-update-dismissed', '1');
  }, []);

  const handleInstall = useCallback(() => {
    if (electronUpdate) {
      electronUpdate.install();
    }
  }, []);

  const handleRetry = useCallback(() => {
    if (electronUpdate) {
      electronUpdate.checkForUpdate();
    }
  }, []);

  // 不显示的情况
  if (dismissed) return null;
  if (state.status === 'idle' || state.status === 'checking') return null;
  // downloading 阶段静默（无感），不显示 banner
  if (state.status === 'downloading') return null;

  const isReady = state.status === 'ready';
  const isError = state.status === 'error';
  const isElectron = !!electronUpdate;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      right: 24,
      zIndex: 9999,
      background: isError ? '#3a1f1f' : '#1a2e1a',
      border: `1px solid ${isError ? '#5a2d2d' : '#2d5a2d'}`,
      color: '#e0e0e0',
      padding: '12px 16px',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '13px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
      maxWidth: '420px',
      WebkitAppRegion: 'no-drag' as any,
      animation: 'updateBannerSlideIn 0.3s ease-out',
    }}>
      <style>{`
        @keyframes updateBannerSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* 图标 */}
      <span style={{ fontSize: '18px', flexShrink: 0 }}>
        {isReady ? '↑' : '⚠'}
      </span>

      {/* 内容 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {isReady && (
          <span>
            {isElectron
              ? <>Update <strong>v{state.version}</strong> ready. Restart to apply.</>
              : <>New version <strong>{state.version}</strong> available. Run <code style={{
                  background: 'rgba(255,255,255,0.1)',
                  padding: '1px 5px',
                  borderRadius: '3px',
                  fontSize: '12px',
                }}>axon update</code> to upgrade.</>
            }
          </span>
        )}
        {isError && (
          <span style={{ color: '#ff8a8a' }}>
            Update failed: {state.error || 'Unknown error'}
          </span>
        )}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
        {isReady && isElectron && (
          <button
            onClick={handleInstall}
            style={{
              background: '#2ea043',
              border: 'none',
              color: '#fff',
              cursor: 'pointer',
              padding: '4px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            Restart
          </button>
        )}
        {isError && isElectron && (
          <button
            onClick={handleRetry}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#e0e0e0',
              cursor: 'pointer',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            Retry
          </button>
        )}
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer',
            padding: '4px 6px',
            fontSize: '16px',
            lineHeight: 1,
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
