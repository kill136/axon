/**
 * MCP 管理面板组件
 * 复刻 CLI 的 McpSettings 交互式界面
 */

import { useState, useEffect } from 'react';
import { McpServerConfig } from '../../shared/types';
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
        <h3>Add MCP Server</h3>
      </div>

      {error && <div className="mcp-form-error">{error}</div>}

      <div className="mcp-form-group">
        <label>Server Name</label>
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
        <label>Transport Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'stdio' | 'sse' | 'http')}
          className="mcp-form-select"
        >
          <option value="stdio">stdio (Command)</option>
          <option value="sse">SSE (Server-Sent Events)</option>
          <option value="http">HTTP</option>
        </select>
      </div>

      {type === 'stdio' ? (
        <>
          <div className="mcp-form-group">
            <label>Command</label>
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
            <label>Arguments (space-separated)</label>
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
          <label>Server URL</label>
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
          Cancel
        </button>
        <button className="mcp-btn mcp-btn-primary" onClick={handleSubmit}>
          Add Server
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
          {tool.isReadOnly && <span className="mcp-tag mcp-tag-success">read-only</span>}
          {tool.isDestructive && <span className="mcp-tag mcp-tag-error">destructive</span>}
          {tool.isOpenWorld && <span className="mcp-tag mcp-tag-muted">open-world</span>}
        </div>

        <div className="mcp-detail-info">
          <div className="mcp-info-row">
            <span className="mcp-info-label">Tool name:</span>
            <span className="mcp-info-value">{shortName}</span>
          </div>
          <div className="mcp-info-row">
            <span className="mcp-info-label">Full name:</span>
            <span className="mcp-info-value">{tool.name}</span>
          </div>
          {tool.description && (
            <div className="mcp-info-row mcp-info-desc">
              <span className="mcp-info-label">Description:</span>
              <span className="mcp-info-value">{tool.description}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mcp-panel-hint">
        <button className="mcp-btn mcp-btn-secondary" onClick={onBack}>
          ← Back
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const tools = server.tools || [];

  return (
    <div className="mcp-tools-list">
      <div className="mcp-detail-card">
        <div className="mcp-detail-header">
          <span className="mcp-detail-title">Tools for {server.name}</span>
          <span className="mcp-detail-subtitle">({tools.length} tools)</span>
        </div>

        {tools.length === 0 ? (
          <div className="mcp-empty">No tools available</div>
        ) : (
          <div className="mcp-list">
            {tools.map((tool, index) => {
              const displayName = formatToolName(tool.name, server.name);
              const tags: string[] = [];
              if (tool.isReadOnly) tags.push('read-only');
              if (tool.isDestructive) tags.push('destructive');
              if (tool.isOpenWorld) tags.push('open-world');

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
          ← Back
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
  const displayName = server.name.charAt(0).toUpperCase() + server.name.slice(1);

  const getStatusDisplay = () => {
    switch (server.status) {
      case 'connected':
        return <span className="mcp-status mcp-status-connected">{ICONS.tick} connected</span>;
      case 'disabled':
        return <span className="mcp-status mcp-status-disabled">{ICONS.radioOff} disabled</span>;
      case 'pending':
        return <span className="mcp-status mcp-status-pending">{ICONS.radioOff} connecting…</span>;
      case 'failed':
        return <span className="mcp-status mcp-status-failed">{ICONS.cross} failed</span>;
      default:
        return <span className="mcp-status mcp-status-disconnected">{ICONS.radioOff} disconnected</span>;
    }
  };

  if (isReconnecting) {
    return (
      <div className="mcp-reconnecting">
        <div className="mcp-reconnecting-title">
          Reconnecting to <strong>{server.name}</strong>
        </div>
        <div className="mcp-reconnecting-status">
          <span className="mcp-spinner">◐</span>
          <span>Restarting MCP server process</span>
        </div>
        <div className="mcp-reconnecting-hint">This may take a few moments.</div>
      </div>
    );
  }

  return (
    <div className="mcp-server-detail">
      <div className="mcp-detail-card">
        <div className="mcp-detail-header">
          <span className="mcp-detail-title">{displayName} MCP Server</span>
        </div>

        <div className="mcp-detail-info">
          <div className="mcp-info-row">
            <span className="mcp-info-label">Status:</span>
            {getStatusDisplay()}
          </div>

          {server.command && (
            <div className="mcp-info-row">
              <span className="mcp-info-label">Command:</span>
              <span className="mcp-info-value mcp-info-code">{server.command}</span>
            </div>
          )}

          {server.args && server.args.length > 0 && (
            <div className="mcp-info-row">
              <span className="mcp-info-label">Args:</span>
              <span className="mcp-info-value mcp-info-code">{server.args.join(' ')}</span>
            </div>
          )}

          {server.url && (
            <div className="mcp-info-row">
              <span className="mcp-info-label">URL:</span>
              <span className="mcp-info-value mcp-info-code">{server.url}</span>
            </div>
          )}

          <div className="mcp-info-row">
            <span className="mcp-info-label">Config location:</span>
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
              View tools
            </button>
          )}
          {server.status !== 'disabled' && (
            <button className="mcp-action-btn" onClick={onReconnect}>
              {ICONS.refresh} Reconnect
            </button>
          )}
          <button className="mcp-action-btn" onClick={onToggleEnabled}>
            {server.status !== 'disabled' ? 'Disable' : 'Enable'}
          </button>
          <button className="mcp-action-btn mcp-action-danger" onClick={onRemove}>
            {ICONS.trash} Remove
          </button>
        </div>
      </div>

      <div className="mcp-panel-hint">
        <button className="mcp-btn mcp-btn-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}

/**
 * MCP 管理主面板
 */
export function McpPanel({ onClose, onSendMessage }: McpPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedServer, setSelectedServer] = useState<McpServerEntry | null>(null);
  const [selectedTool, setSelectedTool] = useState<McpTool | null>(null);
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // 模拟加载服务器数据
  useEffect(() => {
    // 发送获取 MCP 列表请求
    if (onSendMessage) {
      onSendMessage({ type: 'mcp_list' });
    }

    // 模拟数据加载
    const loadServers = async () => {
      // 模拟延迟
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 模拟数据
      const mockServers: McpServerEntry[] = [
        {
          name: 'claude-in-chrome',
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@anthropic-ai/claude-in-chrome-mcp'],
          enabled: true,
          status: 'connected',
          scope: 'user',
          toolsCount: 5,
          resourcesCount: 0,
          promptsCount: 0,
          tools: [
            { name: 'mcp__claude-in-chrome__javascript_tool', serverName: 'claude-in-chrome', description: 'Execute JavaScript in browser' },
            { name: 'mcp__claude-in-chrome__read_page', serverName: 'claude-in-chrome', description: 'Read page accessibility tree', isReadOnly: true },
            { name: 'mcp__claude-in-chrome__find', serverName: 'claude-in-chrome', description: 'Find elements on page', isReadOnly: true },
            { name: 'mcp__claude-in-chrome__navigate', serverName: 'claude-in-chrome', description: 'Navigate to URL' },
            { name: 'mcp__claude-in-chrome__computer', serverName: 'claude-in-chrome', description: 'Mouse and keyboard actions' },
          ],
        },
      ];

      setServers(mockServers);
      setLoading(false);
    };

    loadServers();
  }, [onSendMessage]);

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
          <h3>Manage MCP servers</h3>
          <span className="mcp-panel-subtitle">Loading...</span>
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
        <h3>Manage MCP servers</h3>
        <span className="mcp-panel-subtitle">
          {servers.length} server{servers.length === 1 ? '' : 's'}
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
          <span className="mcp-list-name">Add MCP Server</span>
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
