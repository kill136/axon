/**
 * IM 通道管理面板
 * 管理 Telegram/飞书等 IM 通道的连接、配置和状态
 */

import { useState, useEffect, useCallback } from 'react';
import type { ChannelStatusInfo } from '../../shared/types';
import { useLanguage } from '../i18n';

// ============================================================================
// 类型
// ============================================================================

interface ChannelsPanelProps {
  onClose?: () => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

interface ChannelConfigForm {
  [key: string]: string;
}

// ============================================================================
// 通道元信息
// ============================================================================

const CHANNEL_META: Record<string, {
  icon: string;
  description: string;
  fields: Array<{ key: string; label: string; type: 'text' | 'password'; placeholder: string }>;
  docsUrl?: string;
}> = {
  telegram: {
    icon: '✈',
    description: 'Connect a Telegram Bot to let users chat with AI directly in Telegram',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...' },
    ],
    docsUrl: 'https://core.telegram.org/bots#botfather',
  },
  feishu: {
    icon: '🐦',
    description: 'Connect a Feishu/Lark Bot for enterprise IM integration',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', placeholder: 'cli_xxx...' },
      { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '' },
    ],
  },
  'slack-bot': {
    icon: '💬',
    description: 'Connect a Slack Bot (different from Slack MCP Connector)',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
    ],
  },
};

// ============================================================================
// 组件
// ============================================================================

export default function ChannelsPanel({ onClose, onSendMessage, addMessageHandler }: ChannelsPanelProps) {
  const { t } = useLanguage();
  const [channels, setChannels] = useState<ChannelStatusInfo[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<ChannelConfigForm>({});
  const [allowList, setAllowList] = useState<string>('');
  const [allowGroups, setAllowGroups] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentMessages, setRecentMessages] = useState<Array<{
    channel: string;
    direction: string;
    senderName: string;
    text: string;
    timestamp: number;
  }>>([]);

  // 监听服务端消息
  useEffect(() => {
    if (!addMessageHandler) return;

    const removeHandler = addMessageHandler((msg: any) => {
      if (msg.type === 'channel:list') {
        setChannels(msg.payload.channels);
        setLoading(null);
      } else if (msg.type === 'channel:status_update') {
        setChannels(prev => prev.map(ch =>
          ch.id === msg.payload.id ? msg.payload : ch
        ));
      } else if (msg.type === 'channel:message') {
        setRecentMessages(prev => [msg.payload, ...prev].slice(0, 50));
      } else if (msg.type === 'channel:error') {
        setError(msg.payload.error);
        setLoading(null);
      }
    });

    return removeHandler;
  }, [addMessageHandler]);

  // 初始加载
  useEffect(() => {
    onSendMessage?.({ type: 'channel:list' });
  }, [onSendMessage]);

  const handleStart = useCallback((channelId: string) => {
    setLoading(channelId);
    setError(null);
    onSendMessage?.({ type: 'channel:start', payload: { channelId } });
  }, [onSendMessage]);

  const handleStop = useCallback((channelId: string) => {
    setLoading(channelId);
    setError(null);
    onSendMessage?.({ type: 'channel:stop', payload: { channelId } });
  }, [onSendMessage]);

  const handleSaveConfig = useCallback((channelId: string) => {
    setLoading(channelId);
    setError(null);
    const config: Record<string, any> = {
      enabled: true,
      credentials: { ...configForm },
      allowGroups,
    };
    if (allowList.trim()) {
      config.allowList = allowList.split(',').map(s => s.trim()).filter(Boolean);
    }
    onSendMessage?.({ type: 'channel:config_update', payload: { channelId, config } });
    setSelectedChannel(null);
  }, [onSendMessage, configForm, allowList, allowGroups]);

  // =========== 渲染 ===========

  const renderChannelCard = (ch: ChannelStatusInfo) => {
    const meta = CHANNEL_META[ch.id];
    if (!meta) return null;

    const statusColor = {
      connected: '#4ade80',
      connecting: '#facc15',
      disconnected: '#6b7280',
      error: '#ef4444',
    }[ch.status];

    const statusLabel = {
      connected: 'Connected',
      connecting: 'Connecting...',
      disconnected: 'Disconnected',
      error: 'Error',
    }[ch.status];

    const isLoading = loading === ch.id;

    return (
      <div key={ch.id} style={{
        border: '1px solid var(--border-color, #333)',
        borderRadius: 8,
        padding: '16px',
        marginBottom: 12,
        background: 'var(--bg-secondary, #1a1a2e)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{meta.icon}</span>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{ch.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              display: 'inline-block',
              width: 8, height: 8,
              borderRadius: '50%',
              background: statusColor,
            }} />
            <span style={{ fontSize: 12, color: statusColor }}>{statusLabel}</span>
          </div>
        </div>

        {/* Description */}
        <p style={{ fontSize: 13, color: 'var(--text-secondary, #999)', margin: '0 0 12px' }}>
          {meta.description}
        </p>

        {/* Config hint */}
        {!ch.configured && ch.configureHint && (
          <p style={{ fontSize: 12, color: '#facc15', margin: '0 0 12px', fontStyle: 'italic' }}>
            {ch.configureHint}
          </p>
        )}

        {/* Error */}
        {ch.error && (
          <p style={{ fontSize: 12, color: '#ef4444', margin: '0 0 12px' }}>
            {ch.error}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          {ch.status === 'connected' ? (
            <button
              onClick={() => handleStop(ch.id)}
              disabled={isLoading}
              style={btnStyle('#ef4444')}
            >
              {isLoading ? 'Stopping...' : 'Stop'}
            </button>
          ) : ch.configured ? (
            <button
              onClick={() => handleStart(ch.id)}
              disabled={isLoading}
              style={btnStyle('#4ade80')}
            >
              {isLoading ? 'Starting...' : 'Start'}
            </button>
          ) : null}
          <button
            onClick={() => {
              setSelectedChannel(ch.id);
              setConfigForm({});
              setAllowList('');
              setAllowGroups(false);
            }}
            style={btnStyle('#6b7280')}
          >
            Configure
          </button>
        </div>
      </div>
    );
  };

  const renderConfigDialog = () => {
    if (!selectedChannel) return null;
    const meta = CHANNEL_META[selectedChannel];
    if (!meta) return null;

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }} onClick={() => setSelectedChannel(null)}>
        <div style={{
          background: 'var(--bg-primary, #0f0f23)',
          border: '1px solid var(--border-color, #333)',
          borderRadius: 12, padding: 24, width: 420, maxWidth: '90vw',
        }} onClick={e => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>
            {meta.icon} Configure {selectedChannel}
          </h3>

          {/* Credential fields */}
          {meta.fields.map(field => (
            <div key={field.key} style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary, #999)' }}>
                {field.label}
              </label>
              <input
                type={field.type}
                placeholder={field.placeholder}
                value={configForm[field.key] || ''}
                onChange={e => setConfigForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                style={inputStyle()}
              />
            </div>
          ))}

          {/* Allow list */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary, #999)' }}>
              Allow List (comma-separated user IDs, or * for all)
            </label>
            <input
              type="text"
              placeholder="user_id_1, user_id_2 or *"
              value={allowList}
              onChange={e => setAllowList(e.target.value)}
              style={inputStyle()}
            />
          </div>

          {/* Allow groups */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={allowGroups}
              onChange={e => setAllowGroups(e.target.checked)}
              id="allow-groups"
            />
            <label htmlFor="allow-groups" style={{ fontSize: 13, color: 'var(--text-secondary, #999)' }}>
              Allow group messages (default: private chat only)
            </label>
          </div>

          {/* Docs link */}
          {meta.docsUrl && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary, #666)', margin: '0 0 16px' }}>
              📖 <a href={meta.docsUrl} target="_blank" rel="noopener" style={{ color: '#60a5fa' }}>
                Setup guide
              </a>
            </p>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setSelectedChannel(null)} style={btnStyle('#6b7280')}>
              Cancel
            </button>
            <button
              onClick={() => handleSaveConfig(selectedChannel)}
              disabled={!meta.fields.every(f => configForm[f.key]?.trim())}
              style={btnStyle('#3b82f6')}
            >
              Save & Connect
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderMessageLog = () => {
    if (recentMessages.length === 0) return null;

    return (
      <div style={{ marginTop: 16 }}>
        <h4 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary, #999)' }}>
          Recent Messages
        </h4>
        <div style={{
          maxHeight: 200, overflowY: 'auto',
          border: '1px solid var(--border-color, #333)',
          borderRadius: 6, padding: 8,
          fontSize: 12, fontFamily: 'monospace',
        }}>
          {recentMessages.map((msg, i) => (
            <div key={i} style={{
              padding: '2px 0',
              color: msg.direction === 'inbound' ? '#60a5fa' : '#4ade80',
            }}>
              <span style={{ color: '#6b7280' }}>
                [{new Date(msg.timestamp).toLocaleTimeString()}]
              </span>
              {' '}
              <span style={{ color: '#facc15' }}>[{msg.channel}]</span>
              {' '}
              {msg.direction === 'inbound' ? '→' : '←'}
              {' '}
              <span style={{ fontWeight: 500 }}>{msg.senderName}:</span>
              {' '}
              {msg.text}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 16, maxWidth: 600 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>IM Channels</h2>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 18 }}>
            ✕
          </button>
        )}
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-secondary, #999)', margin: '0 0 16px' }}>
        Connect IM platforms so users can chat with AI directly from Telegram, Feishu, etc.
      </p>

      {/* Error banner */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444',
          borderRadius: 6, padding: '8px 12px', marginBottom: 12,
          fontSize: 13, color: '#ef4444',
        }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* Channel cards */}
      {channels.length > 0 ? (
        channels.map(renderChannelCard)
      ) : (
        // Show placeholder cards from CHANNEL_META when no data from server yet
        Object.keys(CHANNEL_META).map(id => renderChannelCard({
          id,
          name: id.charAt(0).toUpperCase() + id.slice(1),
          status: 'disconnected',
          enabled: false,
          configured: false,
          configureHint: CHANNEL_META[id]?.description,
        }))
      )}

      {/* Message log */}
      {renderMessageLog()}

      {/* Config dialog */}
      {renderConfigDialog()}
    </div>
  );
}

// ============================================================================
// Style helpers
// ============================================================================

function btnStyle(color: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: 'transparent',
    color,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border-color, #333)',
    background: 'var(--bg-primary, #0f0f23)',
    color: 'var(--text-primary, #e0e0e0)',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };
}
