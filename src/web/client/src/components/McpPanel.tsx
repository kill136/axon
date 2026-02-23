/**
 * MCP 管理面板组件
 * 复刻 CLI 的 McpSettings 交互式界面
 */

import { useState, useEffect } from 'react';
import { McpServerConfig } from '../../shared/types';
import { useLanguage } from '../i18n';
import './McpPanel.css';

// 图标常量
const ICONS = {
  tick: '✓',
  cross: '✗',
  radioOff: '○',
  pointer: '❯',
  arrowDown: '↓',
  plus: '+',
  refresh: '↻',
  trash: '🗑',
};

interface McpTool {
  name: string;
  serverName: string;
  description?: string;
  isReadOnly?: boolean;
  isDestructive?: boolean;
  isOpenWorld?: boolean;
}

interface McpServerEntry extends McpServerConfig {
  status: 'connected' | 'disconnected' | 'pending' | 'failed' | 'disabled';
  scope: 'user' | 'project' | 'local' | 'dynamic';
  toolsCount: number;
  resourcesCount: number;
  promptsCount: number;
  tools: McpTool[];
}

interface McpPanelProps {
  onClose?: () => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

type ViewMode = 'list' | 'detail' | 'tools' | 'toolDetail' | 'add';

/**
 * 获取配置文件的路径说明
 */
function getScopeDescription(scope: string): string {
  switch (scope) {
    case 'user':
      return 'User config (available in all your projects)';
    case 'project':
      return 'Project config (shared via .mcp.json)';
    case 'local':
      return 'Local config (private to you in this project)';
    case 'dynamic':
      return 'Dynamically configured';
    default:
      return scope;
  }
}

/**
 * 格式化工具名称显示
 */
function formatToolName(toolName: string, serverName: string): string {
  const prefix = `mcp__${serverName}__`;
  const shortName = toolName.startsWith(prefix)
    ? toolName.substring(prefix.length)
    : toolName;

  const displayServerName = serverName
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return `${displayServerName}[${shortName}]`;
}

/**
 * 添加 MCP 服务器表单
 */
function AddServerForm({
  onAdd,
  onBack,
}: {
  onAdd: (server: Partial<McpServerConfig>) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError('Server name is required');
      return;
    }

    if (type === 'stdio' && !command.trim()) {
      setError('Command is required for stdio type');
      return;
    }

    if ((type === 'sse' || type === 'http') && !url.trim()) {
      setError('URL is required for SSE/HTTP type');
      return;
    }

    const server: Partial<McpServerConfig> = {
      name: name.trim(),
      type,
      enabled: true,
    };

    if (type === 'stdio') {
      server.command = command.trim();
      if (args.trim()) {
        server.args = args.split(' ').filter(Boolean);
      }
    } else {
      server.url = url.trim();
    }

    onAdd(server);
  };

  return (
    <div className="mcp-add-form">
      <div className="mcp-form-header">
        <h3>{t('mcp.addServer')}</h3>
      </div>

      {error && <div className="mcp-form-error">{error}</div>}

      <div className="mcp-form-group">
        <label>{t('mcp.serverName')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="my-server"
          className="mcp-form-input"
        />
      </div>

      <div className="mcp-form-group">
        <label>{t('mcp.transportType')}</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'stdio' | 'sse' | 'http')}
          className="mcp-form-select"
        >
          <option value="stdio">{t('mcp.stdioCommand')}</option>
          <option value="sse">{t('mcp.sseEvents')}</option>
          <option value="http">HTTP</option>
        </select>
      </div>

      {type === 'stdio' ? (
        <>
          <div className="mcp-form-group">
            <label>{t('mcp.command')}</label>
            <input
              type="text"
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                setError(null);
              }}
              placeholder="npx -y @modelcontextprotocol/server-example"
              className="mcp-form-input"
            />
          </div>
          <div className="mcp-form-group">
            <label>{t('mcp.arguments')}</label>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="--port 3000"
              className="mcp-form-input"
            />
          </div>
        </>
      ) : (
        <div className="mcp-form-group">
          <label>{t('mcp.serverUrl')}</label>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder="http://localhost:3000/mcp"
            className="mcp-form-input"
          />
        </div>
      )}

      <div className="mcp-form-actions">
        <button className="mcp-btn mcp-btn-secondary" onClick={onBack}>
          {t('mcp.cancel')}
        </button>
        <button className="mcp-btn mcp-btn-primary" onClick={handleSubmit}>
          {t('mcp.addServerBtn')}
        </button>
      </div>
    </div>
  );
}

/**
 * MCP 工具详情
 */
function McpToolDetail({
  tool,
  server,
  onBack,
}: {
  tool: McpTool;
  server: McpServerEntry;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const displayName = formatToolName(tool.name, server.name);
  const prefix = `mcp__${server.name}__`;
  const shortName = tool.name.startsWith(prefix)
    ? tool.name.substring(prefix.length)
    : tool.name;

  return (
    <div className="mcp-tool-detail">
      <div className="mcp-detail-card">
        <div className="mcp-detail-header">
          <span className="mcp-detail-title">{displayName}</span>
          <span className="mcp-detail-subtitle">({server.name})</span>
          {tool.isReadOnly && <span className="mcp-tag mcp-tag-success">{t('mcp.tagReadOnly')}</span>}
          {tool.isDestructive && <span className="mcp-tag mcp-tag-error">{t('mcp.tagDestructive')}</span>}
          {tool.isOpenWorld && <span className="mcp-tag mcp-tag-muted">{t('mcp.tagOpenWorld')}</span>}
        </div>

        <div className="mcp-detail-info">
          <div className="mcp-info-row">
            <span className="mcp-info-label">{t('mcp.toolName')}:</span>
            <span className="mcp-info-value">{shortName}</span>
          </div>
          <div className="mcp-info-row">
            <span className="mcp-info-label">{t('mcp.fullName')}:</span>
            <span className="mcp-info-value">{tool.name}</span>
          </div>
          {tool.description && (
            <div className="mcp-info-row mcp-info-desc">
              <span className="mcp-info-label">{t('mcp.description')}:</span>
              <span className="mcp-info-value">{tool.description}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mcp-panel-hint">
        <button className="mcp-btn mcp-btn-secondary" onClick={onBack}>
          {t('mcp.back')}
        </button>
      </div>
    </div>
  );
}

/**
 * MCP 工具列表
 */
function McpToolsList({
  server,
  onSelectTool,
  onBack,
}: {
  server: McpServerEntry;
  onSelectTool: (tool: McpTool) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tools = server.tools || [];

  return (
    <div className="mcp-tools-list">
      <div className="mcp-detail-card">
        <div className="mcp-detail-header">
          <span className="mcp-detail-title">{t('mcp.toolsFor', { name: server.name })}</span>
          <span className="mcp-detail-subtitle">({t('mcp.toolCount', { count: tools.length })})</span>
        </div>

        {tools.length === 0 ? (
          <div className="mcp-empty">{t('mcp.noTools')}</div>
        ) : (
          <div className="mcp-list">
            {tools.map((tool, index) => {
              const displayName = formatToolName(tool.name, server.name);
              const tags: string[] = [];
              if (tool.isReadOnly) tags.push(t('mcp.tagReadOnly'));
              if (tool.isDestructive) tags.push(t('mcp.tagDestructive'));
              if (tool.isOpenWorld) tags.push(t('mcp.tagOpenWorld'));

              return (
                <div
                  key={tool.name}
                  className={`mcp-list-item ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => onSelectTool(tool)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="mcp-list-icon">{index === selectedIndex ? ICONS.pointer : ' '}</span>
                  <span className="mcp-list-index">{index + 1}.</span>
                  <span className="mcp-list-name">{displayName}</span>
                  {tags.length > 0 && (
                    <span className={`mcp-tag ${tool.isDestructive ? 'mcp-tag-error' : tool.isReadOnly ? 'mcp-tag-success' : 'mcp-tag-muted'}`}>
                      [{tags.join(', ')}]
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="mcp-panel-hint">
        <button className="mcp-btn mcp-btn-secondary" onClick={onBack}>
          {t('mcp.back')}
        </button>
      </div>
    </div>
  );
}

/**
 * MCP 服务器详情
 */
function McpServerDetail({
  server,
  onBack,
  onViewTools,
  onReconnect,
  onToggleEnabled,
  onRemove,
  isReconnecting,
}: {
  server: McpServerEntry;
  onBack: () => void;
  onViewTools: () => void;
  onReconnect: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  isReconnecting?: boolean;
}) {
  const { t } = useLanguage();
  const displayName = server.name.charAt(0).toUpperCase() + server.name.slice(1);

  const getStatusDisplay = () => {
    switch (server.status) {
      case 'connected':
        return <span className="mcp-status mcp-status-connected">{ICONS.tick} {t('mcp.statusConnected')}</span>;
      case 'disabled':
        return <span className="mcp-status mcp-status-disabled">{ICONS.radioOff} {t('mcp.statusDisabled')}</span>;
      case 'pending':
        return <span className="mcp-status mcp-status-pending">{ICONS.radioOff} {t('mcp.statusConnecting')}</span>;
      case 'failed':
        return <span className="mcp-status mcp-status-failed">{ICONS.cross} {t('mcp.statusFailed')}</span>;
      default:
        return <span className="mcp-status mcp-status-disconnected">{ICONS.radioOff} {t('mcp.statusDisconnected')}</span>;
    }
  };

  if (isReconnecting) {
    return (
      <div className="mcp-reconnecting">
        <div className="mcp-reconnecting-title">
          {t('mcp.reconnecting')} <strong>{server.name}</strong>
        </div>
        <div className="mcp-reconnecting-status">
          <span className="mcp-spinner">◐</span>
          <span>{t('mcp.restartingProcess')}</span>
        </div>
        <div className="mcp-reconnecting-hint">{t('mcp.reconnectHint')}</div>
      </div>
    );
  }

  return (
    <div className="mcp-server-detail">
      <div className="mcp-detail-card">
        <div className="mcp-detail-header">
          <span className="mcp-detail-title">{t('mcp.server', { name: displayName })}</span>
        </div>

        <div className="mcp-detail-info">
          <div className="mcp-info-row">
            <span className="mcp-info-label">{t('mcp.status')}:</span>
            {getStatusDisplay()}
          </div>

          {server.command && (
            <div className="mcp-info-row">
              <span className="mcp-info-label">{t('mcp.commandLabel')}:</span>
              <span className="mcp-info-value mcp-info-code">{server.command}</span>
            </div>
          )}

          {server.args && server.args.length > 0 && (
            <div className="mcp-info-row">
              <span className="mcp-info-label">{t('mcp.args')}:</span>
              <span className="mcp-info-value mcp-info-code">{server.args.join(' ')}</span>
            </div>
          )}

          {server.url && (
            <div className="mcp-info-row">
              <span className="mcp-info-label">{t('mcp.urlLabel')}:</span>
              <span className="mcp-info-value mcp-info-code">{server.url}</span>
            </div>
          )}

          <div className="mcp-info-row">
            <span className="mcp-info-label">{t('mcp.configLocation')}:</span>
            <span className="mcp-info-value">{getScopeDescription(server.scope)}</span>
          </div>

          {server.status === 'connected' && (
            <>
              <div className="mcp-info-row">
                <span className="mcp-info-label">Capabilities:</span>
                <span className="mcp-info-value">
                  {[
                    server.toolsCount > 0 && 'tools',
                    server.resourcesCount > 0 && 'resources',
                    server.promptsCount > 0 && 'prompts',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'none'}
                </span>
              </div>

              {server.toolsCount > 0 && (
                <div className="mcp-info-row">
                  <span className="mcp-info-label">Tools:</span>
                  <span className="mcp-info-value">{server.toolsCount} tools</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mcp-detail-actions">
          {server.status !== 'disabled' && server.toolsCount > 0 && (
            <button className="mcp-action-btn" onClick={onViewTools}>
              {t('mcp.viewTools')}
            </button>
          )}
          {server.status !== 'disabled' && (
            <button className="mcp-action-btn" onClick={onReconnect}>
              {ICONS.refresh} {t('mcp.reconnect')}
            </button>
          )}
          <button className="mcp-action-btn" onClick={onToggleEnabled}>
            {server.status !== 'disabled' ? t('mcp.disable') : t('mcp.enable')}
          </button>
          <button className="mcp-action-btn mcp-action-danger" onClick={onRemove}>
            {ICONS.trash} {t('mcp.remove')}
          </button>
        </div>
      </div>

      <div className="mcp-panel-hint">
        <button className="mcp-btn mcp-btn-secondary" onClick={onBack}>
          {t('mcp.back')}
        </button>
      </div>
    </div>
  );
}

/**
 * MCP 管理主面板
 */
export function McpPanel({ onClose, onSendMessage, addMessageHandler }: McpPanelProps) {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedServer, setSelectedServer] = useState<McpServerEntry | null>(null);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // 发送获取 MCP 列表请求
  useEffect(() => {
    if (onSendMessage) {
      onSendMessage({ type: 'mcp_list' });
    }
  }, [onSendMessage]);

  // 监听 WebSocket 消息：mcp_list_response
  useEffect(() => {
    if (!addMessageHandler) {
      setLoading(false);
      return;
    }

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'mcp_list_response') {
        const { servers: serverList } = msg.payload;
        const entries: McpServerEntry[] = (serverList || []).map((s: any) => ({
          ...s,
          status: s.enabled === false ? 'disabled' as const : 'connected' as const,
          scope: s.scope || 'user',
          toolsCount: s.toolsCount || 0,
          resourcesCount: s.resourcesCount || 0,
          promptsCount: s.promptsCount || 0,
          tools: s.tools || [],
        }));
        setServers(entries);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [addMessageHandler]);

  const handleSelect = (server: McpServerEntry) => {
    setSelectedServer(server);
    setViewMode('detail');
  };

  const handleBackToList = () => {
    setViewMode('list');
    setSelectedServer(null);
    setSelectedTool(null);
    setMessage(null);
  };

  const handleBackToDetail = () => {
    setViewMode('detail');
    setSelectedTool(null);
  };

  const handleBackToTools = () => {
    setViewMode('tools');
    setSelectedTool(null);
  };

  const handleReconnect = async () => {
    if (!selectedServer) return;
    setReconnecting(true);
    setMessage('Reconnecting...');

    // 模拟重连
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setServers((prev) =>
      prev.map((s) =>
        s.name === selectedServer.name ? { ...s, status: 'connected' as const } : s
      )
    );
    setMessage(`Reconnected to ${selectedServer.name}.`);
    setReconnecting(false);
    handleBackToList();
  };

  const handleToggleEnabled = () => {
    if (!selectedServer) return;
    const isEnabled = selectedServer.status !== 'disabled';

    setServers((prev) =>
      prev.map((s) =>
        s.name === selectedServer.name
          ? { ...s, status: isEnabled ? 'disabled' as const : 'disconnected' as const }
          : s
      )
    );

    if (onSendMessage) {
      onSendMessage({
        type: 'mcp_toggle',
        payload: { name: selectedServer.name, enabled: !isEnabled },
      });
    }

    setMessage(`${selectedServer.name} has been ${isEnabled ? 'disabled' : 'enabled'}.`);
    handleBackToList();
  };

  const handleRemove = () => {
    if (!selectedServer) return;

    setServers((prev) => prev.filter((s) => s.name !== selectedServer.name));

    if (onSendMessage) {
      onSendMessage({
        type: 'mcp_remove',
        payload: { name: selectedServer.name },
      });
    }

    setMessage(`${selectedServer.name} has been removed.`);
    handleBackToList();
  };

  const handleViewTools = () => {
    if (!selectedServer) return;
    setViewMode('tools');
  };

  const handleSelectTool = (tool: McpTool) => {
    setSelectedTool(tool);
    setViewMode('toolDetail');
  };

  const handleAddServer = (server: Partial<McpServerConfig>) => {
    const newServer: McpServerEntry = {
      name: server.name || 'new-server',
      type: server.type || 'stdio',
      command: server.command,
      args: server.args,
      url: server.url,
      enabled: true,
      status: 'disconnected',
      scope: 'user',
      toolsCount: 0,
      resourcesCount: 0,
      promptsCount: 0,
      tools: [],
    };

    setServers((prev) => [...prev, newServer]);

    if (onSendMessage) {
      onSendMessage({
        type: 'mcp_add',
        payload: { server },
      });
    }

    setMessage(`${server.name} has been added.`);
    setViewMode('list');
  };

  if (loading) {
    return (
      <div className="mcp-panel">
        <div className="mcp-panel-header">
          <h3>{t('mcp.manageServers')}</h3>
          <span className="mcp-panel-subtitle">{t('mcp.loading')}</span>
        </div>
      </div>
    );
  }

  // 添加服务器视图
  if (viewMode === 'add') {
    return (
      <div className="mcp-panel">
        <AddServerForm onAdd={handleAddServer} onBack={handleBackToList} />
      </div>
    );
  }

  // 工具详情视图
  if (viewMode === 'toolDetail' && selectedServer && selectedTool) {
    return (
      <div className="mcp-panel">
        <McpToolDetail tool={selectedTool} server={selectedServer} onBack={handleBackToTools} />
      </div>
    );
  }

  // 工具列表视图
  if (viewMode === 'tools' && selectedServer) {
    return (
      <div className="mcp-panel">
        <McpToolsList
          server={selectedServer}
          onSelectTool={handleSelectTool}
          onBack={handleBackToDetail}
        />
      </div>
    );
  }

  // 详情视图
  if (viewMode === 'detail' && selectedServer) {
    return (
      <div className="mcp-panel">
        <McpServerDetail
          server={selectedServer}
          onBack={handleBackToList}
          onViewTools={handleViewTools}
          onReconnect={handleReconnect}
          onToggleEnabled={handleToggleEnabled}
          onRemove={handleRemove}
          isReconnecting={reconnecting}
        />
      </div>
    );
  }

  // 列表视图
  return (
    <div className="mcp-panel">
      <div className="mcp-panel-header">
        <h3>{t('mcp.manageServers')}</h3>
        <span className="mcp-panel-subtitle">
          {t('mcp.serverCount', { count: servers.length })}
        </span>
      </div>

      {message && <div className="mcp-message mcp-message-success">{message}</div>}

      <div className="mcp-server-list">
        {/* 添加服务器按钮 */}
        <div
          className="mcp-list-item mcp-list-item-add"
          onClick={() => setViewMode('add')}
        >
          <span className="mcp-list-icon">{ICONS.plus}</span>
          <span className="mcp-list-name">{t('mcp.addServer')}</span>
        </div>

        {servers.length === 0 ? (
          <div className="mcp-empty">
            <p>No MCP servers configured.</p>
            <p>Add servers to your configuration files to get started.</p>
          </div>
        ) : (
          servers.map((server, index) => {
            const statusIcon =
              server.status === 'connected'
                ? `${ICONS.tick} connected`
                : server.status === 'disabled'
                ? `${ICONS.radioOff} disabled`
                : server.status === 'failed'
                ? `${ICONS.cross} failed`
                : `${ICONS.radioOff} disconnected`;

            return (
              <div
                key={server.name}
                className={`mcp-list-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleSelect(server)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="mcp-list-icon">{index === selectedIndex ? ICONS.pointer : ' '}</span>
                <span className="mcp-list-index">{index + 1}.</span>
                <span className="mcp-list-name">{server.name}</span>
                <span className={`mcp-list-status mcp-status-${server.status}`}>
                  {statusIcon}
                </span>
                <span className="mcp-list-hint">· Enter to view details</span>
              </div>
            );
          })
        )}
      </div>

      <div className="mcp-config-info">
        <div className="mcp-config-title">MCP Config locations (by scope):</div>
        <div className="mcp-config-item">
          <span>• User config (available in all your projects):</span>
          <span className="mcp-config-path">~/.claude.json</span>
        </div>
        <div className="mcp-config-item">
          <span>• Project config (shared via .mcp.json):</span>
          <span className="mcp-config-path">.mcp.json</span>
        </div>
        <div className="mcp-config-item">
          <span>• Local config (private to you in this project):</span>
          <span className="mcp-config-path">~/.claude/settings.json</span>
        </div>
      </div>

      <div className="mcp-tips">
        <p>Tip: Use /mcp enable or /mcp disable to quickly toggle all servers</p>
        <p>
          For help configuring MCP servers, see:{' '}
          <a href="https://code.claude.com/docs/en/mcp" target="_blank" rel="noopener noreferrer">
            https://code.claude.com/docs/en/mcp
          </a>
        </p>
      </div>
    </div>
  );
}

export default McpPanel;
