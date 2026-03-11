/**
 * API 代理管理面板
 * 管理 axon-proxy 的配置、启停和状态
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../i18n';

// ============================================================================
// 类型
// ============================================================================

interface ProxyPanelProps {
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

interface ProxyConfig {
  proxyKey?: string;
  port?: number;
  host?: string;
}

interface ProxyStatus {
  running: boolean;
  config?: ProxyConfig;
  port?: number;
  host?: string;
  startedAt?: number;
  stats?: {
    totalRequests: number;
  };
}

// ============================================================================
// ProxyPanel
// ============================================================================

export default function ProxyPanel({ onSendMessage, addMessageHandler }: ProxyPanelProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<ProxyConfig>({
    port: 8082,
    host: '0.0.0.0',
  });
  const [showKey, setShowKey] = useState(false);

  const requestStatus = useCallback(() => {
    onSendMessage?.({ type: 'proxy:status' });
  }, [onSendMessage]);

  // 监听后端消息
  useEffect(() => {
    if (!addMessageHandler) return;
    const unsub = addMessageHandler((msg: any) => {
      if (msg.type === 'proxy:status') {
        setStatus(msg.payload);
        setLoading(false);
        // 初始化编辑配置
        if (msg.payload?.config) {
          setEditConfig(prev => ({ ...prev, ...msg.payload.config }));
        }
      } else if (msg.type === 'proxy:error') {
        setError(msg.payload?.error || 'Unknown error');
        setLoading(false);
      }
    });
    return unsub;
  }, [addMessageHandler]);

  // 首次加载
  useEffect(() => {
    requestStatus();
  }, [requestStatus]);

  // 生成随机密钥
  const generateKey = () => {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    const key = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    setEditConfig(prev => ({ ...prev, proxyKey: key }));
  };

  // 启动
  const handleStart = () => {
    if (!editConfig.proxyKey) {
      setError(t('proxy.error.noKey'));
      return;
    }
    setLoading(true);
    setError(null);
    onSendMessage?.({ type: 'proxy:start', payload: editConfig });
  };

  // 停止
  const handleStop = () => {
    setLoading(true);
    setError(null);
    onSendMessage?.({ type: 'proxy:stop' });
  };

  const running = status?.running || false;
  const displayHost = (status?.host || editConfig.host || '0.0.0.0') === '0.0.0.0'
    ? '<your-ip>'
    : (status?.host || editConfig.host);
  const displayPort = status?.port || editConfig.port || 8082;
  const displayKey = status?.config?.proxyKey || editConfig.proxyKey || '';

  return (
    <div style={containerStyle}>
      <h2 style={titleStyle}>{t('proxy.title')}</h2>
      <p style={descStyle}>{t('proxy.description')}</p>

      {error && (
        <div style={errorBannerStyle}>
          {error}
          <button onClick={() => setError(null)} style={errorDismissStyle}>&times;</button>
        </div>
      )}

      {/* 状态卡片 */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔀</span>
            <h3 style={cardTitleStyle}>{t('proxy.server')}</h3>
          </div>
          <StatusBadge running={running} t={t} />
        </div>

        {/* 运行时信息 */}
        {running && status && (
          <div style={statusDetailStyle}>
            <span>Port: {status.port}</span>
            <span>Host: {status.host}</span>
            {status.startedAt && (
              <span>Uptime: {formatUptime(Date.now() - status.startedAt)}</span>
            )}
            {status.stats && (
              <span>Requests: {status.stats.totalRequests}</span>
            )}
          </div>
        )}

        {/* 配置表单 */}
        <div style={formStyle}>
          <div style={formRowStyle}>
            <label style={labelStyle}>{t('proxy.proxyKey')}</label>
            <div style={{ display: 'flex', flex: 1, gap: 6, maxWidth: 360 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={editConfig.proxyKey || ''}
                onChange={e => setEditConfig(prev => ({ ...prev, proxyKey: e.target.value }))}
                style={{ ...inputStyle, flex: 1 }}
                placeholder={t('proxy.proxyKey.placeholder')}
                disabled={running}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                style={smallBtnStyle}
                title={showKey ? 'Hide' : 'Show'}
              >
                {showKey ? '🙈' : '👁'}
              </button>
              <button
                onClick={generateKey}
                style={smallBtnStyle}
                title={t('proxy.generateKey')}
                disabled={running}
              >
                🎲
              </button>
            </div>
          </div>

          <div style={formRowStyle}>
            <label style={labelStyle}>{t('proxy.port')}</label>
            <input
              type="number"
              value={editConfig.port ?? 8082}
              onChange={e => setEditConfig(prev => ({ ...prev, port: parseInt(e.target.value) || 8082 }))}
              style={inputStyle}
              min={1024}
              max={65535}
              disabled={running}
            />
          </div>

          <div style={formRowStyle}>
            <label style={labelStyle}>{t('proxy.host')}</label>
            <input
              type="text"
              value={editConfig.host ?? '0.0.0.0'}
              onChange={e => setEditConfig(prev => ({ ...prev, host: e.target.value }))}
              style={inputStyle}
              disabled={running}
            />
          </div>

        </div>

        {/* 操作按钮 */}
        <div style={actionRowStyle}>
          {!running ? (
            <button
              onClick={handleStart}
              disabled={loading}
              style={btnStyle('#4ade80')}
            >
              {loading ? t('proxy.starting') : t('proxy.start')}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={loading}
              style={btnStyle('#ef4444')}
            >
              {loading ? t('proxy.stopping') : t('proxy.stop')}
            </button>
          )}
          <button onClick={requestStatus} style={btnStyle('#60a5fa')}>
            {t('proxy.refresh')}
          </button>
        </div>
      </div>

      {/* 使用说明 */}
      {running && displayKey && (
        <div style={cardStyle}>
          <h3 style={cardTitleStyle}>{t('proxy.usage')}</h3>
          <p style={{ ...cardDescStyle, marginTop: 8 }}>{t('proxy.usage.description')}</p>

          <div style={codeBlockStyle}>
            <div style={codeHeaderStyle}>Linux / macOS</div>
            <pre style={preStyle}>
{`export ANTHROPIC_API_KEY="${displayKey}"
export ANTHROPIC_BASE_URL="http://${displayHost}:${displayPort}"
claude`}
            </pre>
          </div>

          <div style={codeBlockStyle}>
            <div style={codeHeaderStyle}>Windows (PowerShell)</div>
            <pre style={preStyle}>
{`$env:ANTHROPIC_API_KEY="${displayKey}"
$env:ANTHROPIC_BASE_URL="http://${displayHost}:${displayPort}"
claude`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 子组件
// ============================================================================

function StatusBadge({ running, t }: { running: boolean; t: (key: string) => string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '3px 10px',
      borderRadius: 12,
      fontSize: 12,
      fontWeight: 500,
      background: running ? 'rgba(74, 222, 128, 0.15)' : 'rgba(156, 163, 175, 0.15)',
      color: running ? '#4ade80' : '#9ca3af',
      border: `1px solid ${running ? 'rgba(74, 222, 128, 0.3)' : 'rgba(156, 163, 175, 0.3)'}`,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: running ? '#4ade80' : '#6b7280',
      }} />
      {running ? t('perception.status.running') : t('perception.status.stopped')}
    </span>
  );
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ============================================================================
// 样式
// ============================================================================

const containerStyle: React.CSSProperties = {
  padding: '24px 32px',
  maxWidth: 720,
  overflowY: 'auto',
  height: '100%',
};

const titleStyle: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: 'var(--text-primary, #e0e0e0)',
  margin: '0 0 4px 0',
};

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #9ca3af)',
  margin: '0 0 24px 0',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-secondary, #1a1a2e)',
  border: '1px solid var(--border-color, #333)',
  borderRadius: 10,
  padding: '20px 24px',
  marginBottom: 16,
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 8,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text-primary, #e0e0e0)',
  margin: 0,
};

const cardDescStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #9ca3af)',
  margin: '0 0 12px 0',
  lineHeight: 1.5,
};

const statusDetailStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  flexWrap: 'wrap',
  fontSize: 12,
  color: 'var(--text-secondary, #9ca3af)',
  background: 'var(--bg-primary, #0f0f23)',
  padding: '8px 12px',
  borderRadius: 6,
  marginBottom: 12,
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  marginBottom: 16,
};

const formRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text-secondary, #9ca3af)',
  width: 120,
  flexShrink: 0,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: 200,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border-color, #333)',
  background: 'var(--bg-primary, #0f0f23)',
  color: 'var(--text-primary, #e0e0e0)',
  fontSize: 13,
  outline: 'none',
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--border-color, #333)',
  background: 'var(--bg-primary, #0f0f23)',
  color: 'var(--text-primary, #e0e0e0)',
  cursor: 'pointer',
  fontSize: 14,
};

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 14px',
  marginBottom: 16,
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.3)',
  borderRadius: 8,
  color: '#ef4444',
  fontSize: 13,
};

const errorDismissStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#ef4444',
  fontSize: 18,
  cursor: 'pointer',
  padding: '0 4px',
};

const codeBlockStyle: React.CSSProperties = {
  background: 'var(--bg-primary, #0f0f23)',
  border: '1px solid var(--border-color, #333)',
  borderRadius: 8,
  marginBottom: 12,
  overflow: 'hidden',
};

const codeHeaderStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-secondary, #9ca3af)',
  borderBottom: '1px solid var(--border-color, #333)',
  background: 'rgba(255,255,255,0.03)',
};

const preStyle: React.CSSProperties = {
  padding: '10px 12px',
  margin: 0,
  fontSize: 12,
  lineHeight: 1.6,
  color: '#4ade80',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '7px 16px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    transition: 'background 0.15s',
  };
}
