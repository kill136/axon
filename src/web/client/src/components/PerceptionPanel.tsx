/**
 * 感知管理面板
 * 管理 Eye（摄像头）、Ear（听觉）、Mouth/TTS（语音合成）的状态和配置
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../i18n';

// ============================================================================
// 类型
// ============================================================================

interface PerceptionPanelProps {
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

interface EyeConfig {
  camera?: number;
  interval?: number;
  autoStart?: boolean;
  port?: number;
}

interface PerceptionStatus {
  eye: {
    running: boolean;
    config: EyeConfig;
    pid?: number;
    port?: number;
    camera?: number;
    daemon?: string;
    daemonUrl?: string;
  };
  ear: {
    enabled: boolean;
    bufferSize: number;
    lastSpeech?: number;
  };
}

// ============================================================================
// PerceptionPanel
// ============================================================================

export default function PerceptionPanel({ onSendMessage, addMessageHandler }: PerceptionPanelProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<PerceptionStatus | null>(null);
  const [eyeLoading, setEyeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editConfig, setEditConfig] = useState<EyeConfig>({});
  const [configDirty, setConfigDirty] = useState(false);

  // 请求状态
  const requestStatus = useCallback(() => {
    onSendMessage?.({ type: 'perception:status' });
  }, [onSendMessage]);

  // 监听后端消息
  useEffect(() => {
    if (!addMessageHandler) return;
    const unsub = addMessageHandler((msg: any) => {
      if (msg.type === 'perception:status') {
        setStatus(msg.payload);
        setEyeLoading(false);
        // 初始化编辑配置
        if (msg.payload?.eye?.config && !configDirty) {
          setEditConfig(msg.payload.eye.config);
        }
      } else if (msg.type === 'perception:error') {
        setError(msg.payload?.error || 'Unknown error');
        setEyeLoading(false);
      } else if (msg.type === 'perception:eye:captured') {
        // 预览拍摄的照片 — 不在此组件处理
      }
    });
    return unsub;
  }, [addMessageHandler, configDirty]);

  // 首次加载
  useEffect(() => {
    requestStatus();
  }, [requestStatus]);

  // Eye 启动
  const handleEyeStart = () => {
    setEyeLoading(true);
    setError(null);
    onSendMessage?.({ type: 'perception:eye:start', payload: editConfig });
  };

  // Eye 停止
  const handleEyeStop = () => {
    setEyeLoading(true);
    setError(null);
    onSendMessage?.({ type: 'perception:eye:stop' });
  };

  // Eye 配置保存
  const handleSaveConfig = () => {
    onSendMessage?.({ type: 'perception:eye:config', payload: editConfig });
    setConfigDirty(false);
  };

  // Eye 拍照预览
  const handleCapture = () => {
    onSendMessage?.({ type: 'perception:eye:capture' });
  };

  const updateConfig = (key: keyof EyeConfig, value: any) => {
    setEditConfig(prev => ({ ...prev, [key]: value }));
    setConfigDirty(true);
  };

  const eyeRunning = status?.eye?.running || false;

  return (
    <div style={containerStyle}>
      <h2 style={titleStyle}>{t('perception.title')}</h2>
      <p style={descStyle}>{t('perception.description')}</p>

      {error && (
        <div style={errorBannerStyle}>
          {error}
          <button onClick={() => setError(null)} style={errorDismissStyle}>&times;</button>
        </div>
      )}

      {/* ===== Eye 摄像头卡片 ===== */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>👁</span>
            <h3 style={cardTitleStyle}>{t('perception.eye.title')}</h3>
          </div>
          <StatusBadge running={eyeRunning} t={t} />
        </div>

        <p style={cardDescStyle}>{t('perception.eye.description')}</p>

        {/* 状态详情 */}
        {eyeRunning && status?.eye && (
          <div style={statusDetailStyle}>
            {status.eye.pid && <span>PID: {status.eye.pid}</span>}
            {status.eye.port && <span>Port: {status.eye.port}</span>}
            {status.eye.daemonUrl && <span>URL: {status.eye.daemonUrl}</span>}
          </div>
        )}

        {/* 配置表单 */}
        <div style={formStyle}>
          <div style={formRowStyle}>
            <label style={labelStyle}>{t('perception.eye.camera')}</label>
            <input
              type="number"
              value={editConfig.camera ?? 0}
              onChange={e => updateConfig('camera', parseInt(e.target.value) || 0)}
              style={inputStyle}
              min={0}
              max={10}
            />
          </div>
          <div style={formRowStyle}>
            <label style={labelStyle}>{t('perception.eye.interval')}</label>
            <input
              type="number"
              value={editConfig.interval ?? 0.5}
              onChange={e => updateConfig('interval', parseFloat(e.target.value) || 0.5)}
              style={inputStyle}
              min={0.1}
              max={10}
              step={0.1}
            />
          </div>
          <div style={formRowStyle}>
            <label style={labelStyle}>{t('perception.eye.port')}</label>
            <input
              type="number"
              value={editConfig.port ?? 7890}
              onChange={e => updateConfig('port', parseInt(e.target.value) || 7890)}
              style={inputStyle}
              min={1024}
              max={65535}
            />
          </div>
          <div style={formRowStyle}>
            <label style={checkboxLabelStyle}>
              <input
                type="checkbox"
                checked={editConfig.autoStart ?? false}
                onChange={e => updateConfig('autoStart', e.target.checked)}
              />
              <span>{t('perception.eye.autoStart')}</span>
            </label>
          </div>
        </div>

        {/* 操作按钮 */}
        <div style={actionRowStyle}>
          {!eyeRunning ? (
            <button
              onClick={handleEyeStart}
              disabled={eyeLoading}
              style={btnStyle('#4ade80')}
            >
              {eyeLoading ? t('perception.starting') : t('perception.eye.start')}
            </button>
          ) : (
            <>
              <button
                onClick={handleEyeStop}
                disabled={eyeLoading}
                style={btnStyle('#ef4444')}
              >
                {eyeLoading ? t('perception.stopping') : t('perception.eye.stop')}
              </button>
              <button
                onClick={handleCapture}
                style={btnStyle('#60a5fa')}
              >
                {t('perception.eye.capture')}
              </button>
            </>
          )}
          {configDirty && (
            <button
              onClick={handleSaveConfig}
              style={btnStyle('#a78bfa')}
            >
              {t('perception.saveConfig')}
            </button>
          )}
        </div>
      </div>

      {/* ===== Ear 听觉卡片 ===== */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>👂</span>
            <h3 style={cardTitleStyle}>{t('perception.ear.title')}</h3>
          </div>
          <StatusBadge running={status?.ear?.enabled || false} t={t} />
        </div>

        <p style={cardDescStyle}>{t('perception.ear.description')}</p>

        {status?.ear && (
          <div style={statusDetailStyle}>
            <span>{t('perception.ear.bufferSize')}: {status.ear.bufferSize}</span>
            {status.ear.lastSpeech && (
              <span>{t('perception.ear.lastSpeech')}: {formatTimeAgo(status.ear.lastSpeech)}</span>
            )}
          </div>
        )}

        <p style={hintStyle}>{t('perception.ear.hint')}</p>
      </div>

      {/* ===== Mouth/TTS 卡片 ===== */}
      <div style={cardStyle}>
        <div style={cardHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🗣</span>
            <h3 style={cardTitleStyle}>{t('perception.tts.title')}</h3>
          </div>
        </div>

        <p style={cardDescStyle}>{t('perception.tts.description')}</p>
        <p style={hintStyle}>{t('perception.tts.hint')}</p>
      </div>
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

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
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

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: 'var(--text-secondary, #9ca3af)',
  cursor: 'pointer',
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

const actionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-secondary, #6b7280)',
  fontStyle: 'italic',
  margin: '8px 0 0 0',
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
