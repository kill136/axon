/**
 * IM 通道管理面板
 * 管理 Telegram/飞书等 IM 通道的连接、配置和状态
 */

import { useState, useEffect, useCallback } from 'react';
import type { ChannelStatusInfo, PairingRequestInfo } from '../../shared/types';
import { useLanguage } from '../i18n';

// ============================================================================
// 类型
// ============================================================================

interface ChannelsPanelProps {
  onClose?: () => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
  /** 当前 Web UI 会话 ID，供用户填入 Fixed Session ID 字段 */
  webUiSessionId?: string;
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
    description: 'Connect a Feishu/Lark Bot for enterprise IM integration (WebSocket, no public URL needed)',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', placeholder: 'cli_xxx...' },
      { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '' },
      { key: 'domain', label: 'Domain (feishu or lark)', type: 'text', placeholder: 'feishu' },
    ],
    docsUrl: 'https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/create-an-app',
  },
  'slack-bot': {
    icon: '💬',
    description: 'Connect a Slack Bot via Socket Mode (no public URL needed, different from Slack MCP Connector)',
    fields: [
      { key: 'botToken', label: 'Bot Token (xoxb-)', type: 'password', placeholder: 'xoxb-...' },
      { key: 'appToken', label: 'App Token (xapp-)', type: 'password', placeholder: 'xapp-...' },
    ],
    docsUrl: 'https://api.slack.com/start/quickstart',
  },
  whatsapp: {
    icon: '📱',
    description: 'Connect WhatsApp via Cloud API (requires public HTTPS URL for webhook)',
    fields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'EAAx...' },
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', placeholder: '1234567890' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'text', placeholder: 'my-secret-token' },
    ],
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started',
  },
  discord: {
    icon: '🎮',
    description: 'Connect a Discord Bot via Gateway WebSocket (no public URL needed)',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', placeholder: 'MTxxxxx...' },
    ],
    docsUrl: 'https://discord.com/developers/docs/getting-started',
  },
};

// ============================================================================
// 组件
// ============================================================================

export default function ChannelsPanel({ onClose, onSendMessage, addMessageHandler, webUiSessionId }: ChannelsPanelProps) {
  const { t } = useLanguage();
  const [channels, setChannels] = useState<ChannelStatusInfo[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [configForm, setConfigForm] = useState<ChannelConfigForm>({});
  const [allowList, setAllowList] = useState<string>('');
  const [allowGroups, setAllowGroups] = useState(false);
  const [groupTrigger, setGroupTrigger] = useState<string>('mention');
  const [fixedSessionId, setFixedSessionId] = useState<string>('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentMessages, setRecentMessages] = useState<Array<{
    channel: string;
    direction: string;
    senderName: string;
    text: string;
    timestamp: number;
  }>>([]);
  const [pairingRequests, setPairingRequests] = useState<PairingRequestInfo[]>([]);
  const [dmPolicy, setDmPolicy] = useState<string>('allowlist');

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
      } else if (msg.type === 'channel:pairing_list') {
        setPairingRequests(msg.payload.requests);
      } else if (msg.type === 'channel:pairing_new') {
        setPairingRequests(prev => {
          // 去重
          if (prev.some(r => r.code === msg.payload.code)) return prev;
          return [msg.payload, ...prev];
        });
      }
    });

    return removeHandler;
  }, [addMessageHandler]);

  // 初始加载
  useEffect(() => {
    onSendMessage?.({ type: 'channel:list' });
    onSendMessage?.({ type: 'channel:pairing_list' });
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

  const handleEnable = useCallback((channelId: string) => {
    setLoading(channelId);
    setError(null);
    onSendMessage?.({
      type: 'channel:config_update',
      payload: {
        channelId,
        config: { enabled: true },
      },
    });
  }, [onSendMessage]);

  const handleDisable = useCallback((channelId: string) => {
    setLoading(channelId);
    setError(null);
    onSendMessage?.({
      type: 'channel:config_update',
      payload: {
        channelId,
        config: { enabled: false },
      },
    });
  }, [onSendMessage]);

  const handleSaveConfig = useCallback((channelId: string) => {
    setLoading(channelId);
    setError(null);
    const currentChannel = channels.find(ch => ch.id === channelId);
    const shouldEnable = currentChannel?.configured ? currentChannel.enabled : true;
    // 只发送用户实际填写了的凭据字段，空字段不发（保留已有值）
    const filledCredentials: Record<string, string> = {};
    for (const [k, v] of Object.entries(configForm)) {
      if (v?.trim()) filledCredentials[k] = v.trim();
    }
    const config: Record<string, any> = {
      enabled: shouldEnable,
      ...(Object.keys(filledCredentials).length > 0 ? { credentials: filledCredentials } : {}),
      allowGroups,
      dmPolicy,
      groupTrigger,
      ...(fixedSessionId.trim() ? { fixedSessionId: fixedSessionId.trim() } : { fixedSessionId: undefined }),
    };
    if (allowList.trim()) {
      config.allowList = allowList.split(',').map(s => s.trim()).filter(Boolean);
    }
    onSendMessage?.({ type: 'channel:config_update', payload: { channelId, config } });
    setSelectedChannel(null);
  }, [onSendMessage, channels, configForm, allowList, allowGroups, dmPolicy, groupTrigger, fixedSessionId]);

  const handleApprovePairing = useCallback((channel: string, code: string) => {
    onSendMessage?.({ type: 'channel:pairing_approve', payload: { channel, code } });
  }, [onSendMessage]);

  const handleDenyPairing = useCallback((channel: string, code: string) => {
    onSendMessage?.({ type: 'channel:pairing_deny', payload: { channel, code } });
  }, [onSendMessage]);

  // =========== 渲染 ===========

  const renderChannelCard = (ch: ChannelStatusInfo) => {
    const meta = CHANNEL_META[ch.id];
    if (!meta) return null;

    const isDisabled = ch.configured && !ch.enabled;
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
    const displayStatusColor = isDisabled ? '#9ca3af' : statusColor;
    const displayStatusLabel = isDisabled ? 'Disabled' : statusLabel;

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
              background: displayStatusColor,
            }} />
            <span style={{ fontSize: 12, color: displayStatusColor }}>{displayStatusLabel}</span>
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ch.configured && ch.enabled && (ch.status === 'connected' ? (
            <button
              onClick={() => handleStop(ch.id)}
              disabled={isLoading}
              style={btnStyle('#ef4444')}
            >
              {isLoading ? 'Stopping...' : 'Stop'}
            </button>
          ) : (
            <button
              onClick={() => handleStart(ch.id)}
              disabled={isLoading}
              style={btnStyle('#4ade80')}
            >
              {isLoading ? 'Starting...' : 'Start'}
            </button>
          ))}
          {ch.configured && !ch.enabled && (
            <button
              onClick={() => handleEnable(ch.id)}
              disabled={isLoading}
              style={btnStyle('#3b82f6')}
            >
              {isLoading ? 'Enabling...' : 'Enable'}
            </button>
          )}
          {ch.configured && ch.enabled && (
            <button
              onClick={() => handleDisable(ch.id)}
              disabled={isLoading}
              style={btnStyle('#f59e0b')}
            >
              {isLoading ? 'Disabling...' : 'Disable'}
            </button>
          )}
          <button
            onClick={() => {
              setSelectedChannel(ch.id);
              // 回填已保存配置
              const saved = ch.savedConfig;
              if (saved) {
                // 凭据字段：脱敏后的值作为 placeholder 提示，不填入 value（避免用户误以为是真实值）
                setConfigForm({});
                setAllowList(saved.allowList?.join(', ') || '');
                setAllowGroups(saved.allowGroups || false);
                setDmPolicy(saved.dmPolicy || 'allowlist');
                setGroupTrigger(saved.groupTrigger || 'mention');
                setFixedSessionId(saved.fixedSessionId || '');
              } else {
                setConfigForm({});
                setAllowList('');
                setAllowGroups(false);
                setDmPolicy('allowlist');
                setGroupTrigger('mention');
                setFixedSessionId('');
              }
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

    // 获取已保存配置用于 placeholder 提示
    const currentChannel = channels.find(ch => ch.id === selectedChannel);
    const savedCreds = currentChannel?.savedConfig?.credentials;
    const saveButtonLabel = currentChannel?.configured && !currentChannel.enabled
      ? 'Save'
      : 'Save & Connect';

    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        WebkitAppRegion: 'no-drag' as any,
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
          {meta.fields.map(field => {
            const savedValue = savedCreds?.[field.key];
            const placeholder = savedValue ? `Saved: ${savedValue} (leave empty to keep)` : field.placeholder;
            return (
              <div key={field.key} style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary, #999)' }}>
                  {field.label}
                  {savedValue && <span style={{ color: '#4ade80', marginLeft: 6, fontSize: 11 }}>configured</span>}
                </label>
                <input
                  type={field.type}
                  placeholder={placeholder}
                  value={configForm[field.key] || ''}
                  onChange={e => setConfigForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                  style={inputStyle()}
                />
              </div>
            );
          })}

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

          {/* DM Policy */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary, #999)' }}>
              DM Access Policy
            </label>
            <select
              value={dmPolicy}
              onChange={e => setDmPolicy(e.target.value)}
              style={{
                ...inputStyle(),
                cursor: 'pointer',
              }}
            >
              <option value="allowlist">Allow List (only whitelisted users)</option>
              <option value="pairing">Pairing (unknown users get a pairing code)</option>
              <option value="open">Open (anyone can chat)</option>
            </select>
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

          {/* Group trigger (only when allowGroups is enabled) */}
          {allowGroups && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary, #999)' }}>
                Group Trigger
              </label>
              <select
                value={groupTrigger}
                onChange={e => setGroupTrigger(e.target.value)}
                style={{ ...inputStyle(), cursor: 'pointer' }}
              >
                <option value="mention">@Mention only (bot replies when @mentioned)</option>
                <option value="always">All messages (bot replies to every message)</option>
              </select>
            </div>
          )}

          {/* Fixed Session ID */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, marginBottom: 4, color: 'var(--text-secondary, #999)' }}>
              Fixed Session ID <span style={{ fontWeight: 400, opacity: 0.7 }}>(optional)</span>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                value={fixedSessionId}
                onChange={e => setFixedSessionId(e.target.value)}
                placeholder="Leave empty to use per-user sessions"
                style={{ ...inputStyle(), flex: 1, fontFamily: 'monospace', fontSize: 12 }}
              />
              {webUiSessionId && (
                <button
                  onClick={() => setFixedSessionId(webUiSessionId)}
                  title="Use current Web UI session ID"
                  style={{ ...btnStyle('#4b5563'), padding: '0 10px', fontSize: 12, whiteSpace: 'nowrap' }}
                >
                  Use current
                </button>
              )}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary, #888)', margin: '4px 0 0' }}>
              When set, all messages from this channel share one conversation.
              {webUiSessionId && <> Current Web UI session: <code style={{ fontSize: 11 }}>{webUiSessionId.slice(0, 8)}…</code></>}
            </p>
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
              disabled={!meta.fields.every(f => configForm[f.key]?.trim() || savedCreds?.[f.key])}
              style={btnStyle('#3b82f6')}
            >
              {saveButtonLabel}
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
    <div style={{ padding: 16, maxWidth: 600, height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
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

      {/* Pairing requests */}
      {pairingRequests.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#facc15' }}>
            Pending Pairing Requests ({pairingRequests.length})
          </h4>
          {pairingRequests.map(req => (
            <div key={req.code} style={{
              border: '1px solid var(--border-color, #333)',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 8,
              background: 'var(--bg-secondary, #1a1a2e)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>{req.senderName}</span>
                  <span style={{ color: 'var(--text-secondary, #666)', marginLeft: 6 }}>({req.senderId})</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #666)', marginTop: 2 }}>
                  Channel: {req.channel} | Code: <code style={{ color: '#facc15' }}>{req.code}</code>
                  {' '}| {new Date(req.createdAt).toLocaleTimeString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => handleApprovePairing(req.channel, req.code)}
                  style={btnStyle('#4ade80')}
                >
                  Approve
                </button>
                <button
                  onClick={() => handleDenyPairing(req.channel, req.code)}
                  style={btnStyle('#ef4444')}
                >
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
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
