/**
 * 插件管理面板组件
 * 复刻 CLI 的 PluginsDialog 交互式界面
 */

import { useState, useEffect, useMemo } from 'react';
import { PluginInfo } from '../../shared/types';
import './PluginsPanel.css';

// 图标常量
const ICONS = {
  tick: '✓',
  cross: '✗',
  radioOn: '●',
  radioOff: '○',
  pointer: '❯',
  arrowUp: '↑',
  arrowDown: '↓',
  bullet: '•',
  ellipsis: '…',
  warning: '⚠',
  plus: '+',
  trash: '🗑',
};

// Tab 定义
type TabId = 'discover' | 'installed' | 'marketplaces' | 'errors';

const TAB_LABELS: Record<TabId, string> = {
  discover: 'Discover',
  installed: 'Installed',
  marketplaces: 'Marketplaces',
  errors: 'Errors',
};

const TAB_ORDER: TabId[] = ['discover', 'installed', 'marketplaces', 'errors'];

// 插件接口
interface MarketplacePlugin {
  pluginId: string;
  name: string;
  description?: string;
  version?: string;
  author?: string;
  marketplaceName: string;
  tags?: string[];
  installCount?: number;
}

interface Marketplace {
  name: string;
  source: string;
  pluginCount: number;
  autoUpdate?: boolean;
  pendingUpdate?: boolean;
  lastUpdated?: string;
}

interface PluginError {
  pluginId: string;
  message: string;
  timestamp: string;
}

interface PluginsPanelProps {
  onClose?: () => void;
  onSendMessage?: (message: any) => void;
}

type ViewMode = 'tabs' | 'details' | 'add-marketplace';

/**
 * 格式化安装数
 */
function formatInstalls(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
  return count.toString();
}

/**
 * Tab 栏组件
 */
function TabBar({
  tabs,
  selectedTab,
  onTabChange,
}: {
  tabs: TabId[];
  selectedTab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  return (
    <div className="plugins-tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={`plugins-tab ${selectedTab === tab ? 'active' : ''}`}
          onClick={() => onTabChange(tab)}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
}

/**
 * Discover Tab 组件
 */
function DiscoverTab({
  plugins,
  selectedPlugins,
  loadingPlugins,
  installedPlugins,
  onSelect,
  onDeselect,
  onViewDetails,
  onInstall,
  searchQuery,
  onSearchChange,
  error,
  noMarketplaces,
}: {
  plugins: MarketplacePlugin[];
  selectedPlugins: Set<string>;
  loadingPlugins: Set<string>;
  installedPlugins: Set<string>;
  onSelect: (pluginId: string) => void;
  onDeselect: (pluginId: string) => void;
  onViewDetails: (plugin: MarketplacePlugin) => void;
  onInstall: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  error?: string;
  noMarketplaces?: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 过滤插件
  const filteredPlugins = useMemo(() => {
    if (!searchQuery) return plugins;
    const q = searchQuery.toLowerCase();
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.marketplaceName.toLowerCase().includes(q)
    );
  }, [plugins, searchQuery]);

  if (noMarketplaces) {
    return (
      <div className="plugins-tab-content">
        <h4>Discover plugins</h4>
        <div className="plugins-empty">
          <p>No marketplaces configured.</p>
          <p>Add a marketplace first with:</p>
          <code>/plugins marketplace add anthropics/claude-code</code>
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <div className="plugins-discover-header">
        <h4>Discover plugins</h4>
        {filteredPlugins.length > 10 && (
          <span className="plugins-count">({selectedIndex + 1}/{filteredPlugins.length})</span>
        )}
      </div>

      {/* 搜索框 */}
      <div className="plugins-search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Type to search..."
          className="plugins-search-input"
        />
      </div>

      {/* 警告信息 */}
      {error && (
        <div className="plugins-warning">
          {ICONS.warning} {error}
        </div>
      )}

      {/* 无搜索结果 */}
      {filteredPlugins.length === 0 && searchQuery && (
        <div className="plugins-no-results">No plugins match "{searchQuery}"</div>
      )}

      {/* 插件列表 */}
      <div className="plugins-list">
        {filteredPlugins.slice(0, 15).map((plugin, index) => {
          const isSelected = index === selectedIndex;
          const isChecked = selectedPlugins.has(plugin.pluginId);
          const isLoading = loadingPlugins.has(plugin.pluginId);
          const isInstalled = installedPlugins.has(plugin.name);

          return (
            <div
              key={plugin.pluginId}
              className={`plugins-list-item ${isSelected ? 'selected' : ''} ${isInstalled ? 'installed' : ''}`}
              onClick={() => onViewDetails(plugin)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="plugins-item-main">
                <span className="plugins-item-icon">
                  {isSelected ? ICONS.pointer : ' '}
                </span>
                <span
                  className="plugins-item-checkbox"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isChecked) {
                      onDeselect(plugin.pluginId);
                    } else {
                      onSelect(plugin.pluginId);
                    }
                  }}
                >
                  {isLoading ? ICONS.ellipsis : isChecked ? ICONS.radioOn : ICONS.radioOff}
                </span>
                <span className="plugins-item-name">{plugin.name}</span>
                <span className="plugins-item-marketplace">· {plugin.marketplaceName}</span>
                {plugin.tags?.includes('community-managed') && (
                  <span className="plugins-tag">[Community Managed]</span>
                )}
                {isInstalled && <span className="plugins-tag plugins-tag-installed">[Installed]</span>}
                {plugin.installCount && plugin.installCount > 0 && (
                  <span className="plugins-item-installs">· {formatInstalls(plugin.installCount)} installs</span>
                )}
              </div>
              {plugin.description && (
                <div className="plugins-item-desc">
                  {plugin.description.length > 60
                    ? plugin.description.substring(0, 57) + '...'
                    : plugin.description}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 更多指示器 */}
      {filteredPlugins.length > 15 && (
        <div className="plugins-more">{ICONS.arrowDown} more below</div>
      )}

      {/* 底部提示 */}
      <div className="plugins-hint">
        {selectedPlugins.size > 0 && (
          <button className="plugins-install-btn" onClick={onInstall}>
            Install {selectedPlugins.size} plugin{selectedPlugins.size > 1 ? 's' : ''}
          </button>
        )}
        <span>Type to search · Space: (de)select · Enter: details</span>
      </div>
    </div>
  );
}

/**
 * Installed Tab 组件
 */
function InstalledTab({
  plugins,
  onUninstall,
  onViewDetails,
  onToggle,
}: {
  plugins: PluginInfo[];
  onUninstall: (pluginName: string) => void;
  onViewDetails: (plugin: PluginInfo) => void;
  onToggle: (pluginName: string, enabled: boolean) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (plugins.length === 0) {
    return (
      <div className="plugins-tab-content">
        <h4>Installed Plugins</h4>
        <div className="plugins-empty">
          <p>No plugins installed.</p>
          <p>Use the Discover tab to find and install plugins.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <h4>Installed Plugins</h4>

      <div className="plugins-list">
        {plugins.map((plugin, index) => (
          <div
            key={plugin.name}
            className={`plugins-list-item ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => onViewDetails(plugin)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div className="plugins-item-main">
              <span className="plugins-item-icon">
                {index === selectedIndex ? ICONS.pointer : ' '}
              </span>
              <span className="plugins-item-checkbox">
                {plugin.enabled ? ICONS.radioOn : ICONS.radioOff}
              </span>
              <span className="plugins-item-name">{plugin.name}</span>
              <span className="plugins-item-version">v{plugin.version}</span>
              {!plugin.enabled && <span className="plugins-tag plugins-tag-disabled">[Disabled]</span>}
              {plugin.error && <span className="plugins-tag plugins-tag-error">[Error]</span>}
            </div>
            {plugin.description && (
              <div className="plugins-item-desc">{plugin.description}</div>
            )}
            <div className="plugins-item-actions">
              <button
                className="plugins-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(plugin.name, !plugin.enabled);
                }}
              >
                {plugin.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                className="plugins-action-btn plugins-action-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onUninstall(plugin.name);
                }}
              >
                Uninstall
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="plugins-hint">
        <span>Enter: details · Delete: uninstall</span>
      </div>
    </div>
  );
}

/**
 * Marketplaces Tab 组件
 */
function MarketplacesTab({
  marketplaces,
  onAdd,
  onRemove,
  onUpdate,
}: {
  marketplaces: Marketplace[];
  onAdd: () => void;
  onRemove: (name: string) => void;
  onUpdate: (name: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <div className="plugins-tab-content">
      <h4>Manage marketplaces</h4>

      <div className="plugins-list">
        {/* 添加选项 */}
        <div
          className={`plugins-list-item plugins-list-item-add ${selectedIndex === 0 ? 'selected' : ''}`}
          onClick={onAdd}
          onMouseEnter={() => setSelectedIndex(0)}
        >
          <span className="plugins-item-icon">{selectedIndex === 0 ? ICONS.pointer : ' '}</span>
          <span className="plugins-add-icon">{ICONS.plus}</span>
          <span className="plugins-item-name">Add Marketplace</span>
        </div>

        {/* Marketplace 列表 */}
        {marketplaces.map((marketplace, index) => {
          const itemIndex = index + 1;
          const isSelected = itemIndex === selectedIndex;

          return (
            <div
              key={marketplace.name}
              className={`plugins-list-item ${isSelected ? 'selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(itemIndex)}
            >
              <div className="plugins-item-main">
                <span className="plugins-item-icon">{isSelected ? ICONS.pointer : ' '}</span>
                <span className="plugins-item-checkbox">
                  {marketplace.pendingUpdate ? ICONS.ellipsis : ICONS.tick}
                </span>
                <span className="plugins-item-name">{marketplace.name}</span>
                <span className="plugins-item-count">· {marketplace.pluginCount} plugins</span>
                {marketplace.autoUpdate && <span className="plugins-tag">[auto-update]</span>}
              </div>
              <div className="plugins-item-source">{marketplace.source}</div>
              <div className="plugins-item-actions">
                <button
                  className="plugins-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(marketplace.name);
                  }}
                >
                  Update
                </button>
                <button
                  className="plugins-action-btn plugins-action-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(marketplace.name);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {marketplaces.length === 0 && (
        <div className="plugins-empty">No marketplaces configured.</div>
      )}

      <div className="plugins-hint">
        <span>{ICONS.arrowUp}{ICONS.arrowDown} · enter to select</span>
      </div>
    </div>
  );
}

/**
 * Errors Tab 组件
 */
function ErrorsTab({
  errors,
  onClear,
}: {
  errors: PluginError[];
  onClear: () => void;
}) {
  if (errors.length === 0) {
    return (
      <div className="plugins-tab-content">
        <h4>Plugin errors</h4>
        <div className="plugins-success">
          {ICONS.tick} No errors
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <h4>Plugin errors ({errors.length})</h4>

      <div className="plugins-errors-list">
        {errors.map((error, index) => (
          <div key={index} className="plugins-error-item">
            <div className="plugins-error-header">
              <span className="plugins-error-icon">{ICONS.cross}</span>
              <span className="plugins-error-plugin">{error.pluginId}</span>
            </div>
            <div className="plugins-error-message">{error.message}</div>
            <div className="plugins-error-time">at {error.timestamp}</div>
          </div>
        ))}
      </div>

      <div className="plugins-hint">
        <button className="plugins-clear-btn" onClick={onClear}>
          Clear errors
        </button>
      </div>
    </div>
  );
}

/**
 * Plugin Details 视图
 */
function PluginDetails({
  plugin,
  isInstalled,
  isInstalling,
  onInstall,
  onUninstall,
  onBack,
}: {
  plugin: MarketplacePlugin | PluginInfo;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onBack: () => void;
}) {
  const name = 'pluginId' in plugin ? plugin.name : plugin.name;
  const version = 'version' in plugin ? plugin.version : undefined;
  const description = plugin.description;
  const author = 'author' in plugin ? plugin.author : undefined;
  const marketplaceName = 'marketplaceName' in plugin ? plugin.marketplaceName : undefined;

  return (
    <div className="plugins-details">
      <div className="plugins-details-card">
        <div className="plugins-details-header">
          <h4>Plugin details</h4>
        </div>

        <div className="plugins-details-info">
          <div className="plugins-details-name">{name}</div>
          {marketplaceName && <div className="plugins-details-from">from {marketplaceName}</div>}
          {version && <div className="plugins-details-version">Version: {version}</div>}
          {description && <div className="plugins-details-desc">{description}</div>}
          {author && <div className="plugins-details-author">By: {author}</div>}
        </div>

        <div className="plugins-warning-box">
          <span className="plugins-warning-icon">{ICONS.warning}</span>
          <span className="plugins-warning-text">
            Make sure you trust a plugin before installing, updating, or using it.
            Anthropic does not control what MCP servers, files, or other software
            are included in plugins.
          </span>
        </div>

        <div className="plugins-details-actions">
          {isInstalled ? (
            <button className="plugins-btn plugins-btn-danger" onClick={onUninstall}>
              Uninstall
            </button>
          ) : (
            <button
              className="plugins-btn plugins-btn-primary"
              onClick={onInstall}
              disabled={isInstalling}
            >
              {isInstalling ? 'Installing…' : 'Install'}
            </button>
          )}
        </div>
      </div>

      <div className="plugins-hint">
        <button className="plugins-btn plugins-btn-secondary" onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}

/**
 * Add Marketplace 视图
 */
function AddMarketplace({
  onAdd,
  onBack,
}: {
  onAdd: (source: string) => void;
  onBack: () => void;
}) {
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!source.trim()) {
      setError('Please enter a marketplace source');
      return;
    }
    onAdd(source.trim());
  };

  return (
    <div className="plugins-add-marketplace">
      <div className="plugins-add-card">
        <h4>Add Marketplace</h4>

        {error && <div className="plugins-form-error">{error}</div>}

        <div className="plugins-form-group">
          <label>Enter marketplace source:</label>
          <input
            type="text"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setError(null);
            }}
            placeholder="anthropics/claude-code"
            className="plugins-form-input"
          />
        </div>

        <div className="plugins-examples">
          <div className="plugins-examples-title">Examples:</div>
          <div className="plugins-example">• anthropics/claude-code</div>
          <div className="plugins-example">• git@github.com:owner/repo.git</div>
          <div className="plugins-example">• https://example.com/marketplace</div>
          <div className="plugins-example">• ./path/to/local/marketplace</div>
        </div>
      </div>

      <div className="plugins-form-actions">
        <button className="plugins-btn plugins-btn-secondary" onClick={onBack}>
          Cancel
        </button>
        <button className="plugins-btn plugins-btn-primary" onClick={handleSubmit}>
          Add
        </button>
      </div>
    </div>
  );
}

/**
 * 插件管理主面板
 */
export function PluginsPanel({ onClose, onSendMessage }: PluginsPanelProps) {
  const [currentTab, setCurrentTab] = useState<TabId>('discover');
  const [viewMode, setViewMode] = useState<ViewMode>('tabs');

  // 数据状态
  const [discoverPlugins, setDiscoverPlugins] = useState<MarketplacePlugin[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<PluginInfo[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [errors, setErrors] = useState<PluginError[]>([]);

  // UI 状态
  const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set());
  const [loadingPlugins, setLoadingPlugins] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | PluginInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // 加载数据
  useEffect(() => {
    // 发送获取插件列表请求
    if (onSendMessage) {
      onSendMessage({ type: 'plugin_list' });
    }

    // 模拟数据加载
    const loadData = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));

      // 模拟 marketplace 数据
      setMarketplaces([
        {
          name: 'anthropic-agent-skills',
          source: 'github.com/anthropics/claude-code-agent-skills',
          pluginCount: 15,
          autoUpdate: true,
        },
      ]);

      // 模拟可发现的插件
      setDiscoverPlugins([
        {
          pluginId: 'document-skills@anthropic-agent-skills',
          name: 'document-skills',
          description: 'Document creation and manipulation skills including PDF, DOCX, XLSX, PPTX support',
          version: '1.0.0',
          author: 'Anthropic',
          marketplaceName: 'anthropic-agent-skills',
          installCount: 25000,
          tags: [],
        },
        {
          pluginId: 'frontend-design@anthropic-agent-skills',
          name: 'frontend-design',
          description: 'Create distinctive, production-grade frontend interfaces with high design quality',
          version: '1.0.0',
          author: 'Anthropic',
          marketplaceName: 'anthropic-agent-skills',
          installCount: 18000,
          tags: [],
        },
        {
          pluginId: 'web-artifacts@anthropic-agent-skills',
          name: 'web-artifacts-builder',
          description: 'Suite of tools for creating elaborate, multi-component HTML artifacts',
          version: '1.0.0',
          author: 'Anthropic',
          marketplaceName: 'anthropic-agent-skills',
          installCount: 12000,
          tags: ['community-managed'],
        },
      ]);

      // 模拟已安装插件
      setInstalledPlugins([
        {
          name: 'document-skills',
          version: '1.0.0',
          description: 'Document creation and manipulation skills',
          author: 'Anthropic',
          enabled: true,
          loaded: true,
          path: '~/.claude/plugins/document-skills',
          skills: ['pdf', 'docx', 'xlsx', 'pptx'],
        },
      ]);

      setLoading(false);
    };

    loadData();
  }, [onSendMessage]);

  // 已安装插件名称集合
  const installedPluginNames = useMemo(
    () => new Set(installedPlugins.map((p) => p.name)),
    [installedPlugins]
  );

  // Tab 切换
  const handleTabChange = (tab: TabId) => {
    setCurrentTab(tab);
    setViewMode('tabs');
    setSelectedPlugin(null);
  };

  // 插件选择
  const handleSelectPlugin = (pluginId: string) => {
    setSelectedPlugins((prev) => new Set([...prev, pluginId]));
  };

  const handleDeselectPlugin = (pluginId: string) => {
    setSelectedPlugins((prev) => {
      const next = new Set(prev);
      next.delete(pluginId);
      return next;
    });
  };

  // 查看插件详情
  const handleViewPluginDetails = (plugin: MarketplacePlugin | PluginInfo) => {
    setSelectedPlugin(plugin);
    setViewMode('details');
  };

  // 安装插件
  const handleInstall = () => {
    for (const pluginId of selectedPlugins) {
      setLoadingPlugins((prev) => new Set([...prev, pluginId]));

      // 模拟安装
      setTimeout(() => {
        setLoadingPlugins((prev) => {
          const next = new Set(prev);
          next.delete(pluginId);
          return next;
        });
        setSelectedPlugins((prev) => {
          const next = new Set(prev);
          next.delete(pluginId);
          return next;
        });

        // 添加到已安装列表
        const plugin = discoverPlugins.find((p) => p.pluginId === pluginId);
        if (plugin) {
          setInstalledPlugins((prev) => [
            ...prev,
            {
              name: plugin.name,
              version: plugin.version || '1.0.0',
              description: plugin.description,
              author: plugin.author,
              enabled: true,
              loaded: true,
              path: `~/.claude/plugins/${plugin.name}`,
            },
          ]);
        }
      }, 2000);
    }
  };

  // 卸载插件
  const handleUninstall = (pluginName: string) => {
    setInstalledPlugins((prev) => prev.filter((p) => p.name !== pluginName));

    if (onSendMessage) {
      onSendMessage({
        type: 'plugin_uninstall',
        payload: { name: pluginName },
      });
    }

    setViewMode('tabs');
    setSelectedPlugin(null);
  };

  // 启用/禁用插件
  const handleToggle = (pluginName: string, enabled: boolean) => {
    setInstalledPlugins((prev) =>
      prev.map((p) => (p.name === pluginName ? { ...p, enabled } : p))
    );

    if (onSendMessage) {
      onSendMessage({
        type: enabled ? 'plugin_enable' : 'plugin_disable',
        payload: { name: pluginName },
      });
    }
  };

  // 添加 marketplace
  const handleAddMarketplace = (source: string) => {
    const name = source.includes('/') ? source.split('/').pop() || source : source;
    setMarketplaces((prev) => [
      ...prev,
      {
        name,
        source,
        pluginCount: 0,
        autoUpdate: true,
        pendingUpdate: true,
      },
    ]);
    setViewMode('tabs');

    // 模拟更新
    setTimeout(() => {
      setMarketplaces((prev) =>
        prev.map((m) =>
          m.source === source ? { ...m, pendingUpdate: false, pluginCount: 5 } : m
        )
      );
    }, 2000);
  };

  // 移除 marketplace
  const handleRemoveMarketplace = (name: string) => {
    setMarketplaces((prev) => prev.filter((m) => m.name !== name));
  };

  // 更新 marketplace
  const handleUpdateMarketplace = (name: string) => {
    setMarketplaces((prev) =>
      prev.map((m) => (m.name === name ? { ...m, pendingUpdate: true } : m))
    );

    setTimeout(() => {
      setMarketplaces((prev) =>
        prev.map((m) =>
          m.name === name ? { ...m, pendingUpdate: false, lastUpdated: new Date().toISOString() } : m
        )
      );
    }, 2000);
  };

  // 清除错误
  const handleClearErrors = () => {
    setErrors([]);
  };

  // 返回
  const handleBack = () => {
    setViewMode('tabs');
    setSelectedPlugin(null);
  };

  if (loading) {
    return (
      <div className="plugins-panel">
        <div className="plugins-panel-header">
          <h3>/plugins</h3>
          <span className="plugins-panel-subtitle">Loading...</span>
        </div>
      </div>
    );
  }

  // 添加 marketplace 视图
  if (viewMode === 'add-marketplace') {
    return (
      <div className="plugins-panel">
        <AddMarketplace onAdd={handleAddMarketplace} onBack={handleBack} />
      </div>
    );
  }

  // 插件详情视图
  if (viewMode === 'details' && selectedPlugin) {
    const isInstalled = installedPluginNames.has(
      'pluginId' in selectedPlugin ? selectedPlugin.name : selectedPlugin.name
    );
    const pluginId = 'pluginId' in selectedPlugin ? selectedPlugin.pluginId : selectedPlugin.name;
    const isInstalling = loadingPlugins.has(pluginId);

    return (
      <div className="plugins-panel">
        <PluginDetails
          plugin={selectedPlugin}
          isInstalled={isInstalled}
          isInstalling={isInstalling}
          onInstall={() => {
            if ('pluginId' in selectedPlugin) {
              handleSelectPlugin(selectedPlugin.pluginId);
              handleInstall();
            }
          }}
          onUninstall={() => {
            const name = 'pluginId' in selectedPlugin ? selectedPlugin.name : selectedPlugin.name;
            handleUninstall(name);
          }}
          onBack={handleBack}
        />
      </div>
    );
  }

  // 主 Tab 视图
  return (
    <div className="plugins-panel">
      <div className="plugins-panel-header">
        <h3>/plugins</h3>
      </div>

      {/* Tab 栏 */}
      <TabBar tabs={TAB_ORDER} selectedTab={currentTab} onTabChange={handleTabChange} />

      {/* Tab 内容 */}
      {currentTab === 'discover' && (
        <DiscoverTab
          plugins={discoverPlugins}
          selectedPlugins={selectedPlugins}
          loadingPlugins={loadingPlugins}
          installedPlugins={installedPluginNames}
          onSelect={handleSelectPlugin}
          onDeselect={handleDeselectPlugin}
          onViewDetails={handleViewPluginDetails}
          onInstall={handleInstall}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          error={error}
          noMarketplaces={marketplaces.length === 0}
        />
      )}

      {currentTab === 'installed' && (
        <InstalledTab
          plugins={installedPlugins}
          onUninstall={handleUninstall}
          onViewDetails={handleViewPluginDetails}
          onToggle={handleToggle}
        />
      )}

      {currentTab === 'marketplaces' && (
        <MarketplacesTab
          marketplaces={marketplaces}
          onAdd={() => setViewMode('add-marketplace')}
          onRemove={handleRemoveMarketplace}
          onUpdate={handleUpdateMarketplace}
        />
      )}

      {currentTab === 'errors' && (
        <ErrorsTab errors={errors} onClear={handleClearErrors} />
      )}
    </div>
  );
}

export default PluginsPanel;
