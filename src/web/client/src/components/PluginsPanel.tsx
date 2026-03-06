/**
 * Skills & Plugins 管理面板组件
 * 复刻 CLI 的 PluginsDialog 交互式界面，扩展了 Skills 管理功能
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLanguage } from '../i18n';
import { PluginInfo, SkillInfo } from '../../shared/types';
import './PluginsPanel.css';

// SVG 图标组件
const SvgEye = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 8s3-5.5 7-5.5S15 8 15 8s-3 5.5-7 5.5S1 8 1 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

const SvgTrash = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M12.67 4v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4" />
  </svg>
);

const SvgChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l4 4 4-4" />
  </svg>
);

const SvgChevronUp = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 10l4-4 4 4" />
  </svg>
);

// 图标常量（用于非按钮场景）
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
  eye: '👁',
  skill: '⚡',
};

// Tab 定义
type TabId = 'skills' | 'plugins' | 'discover' | 'marketplaces' | 'errors';

const TAB_ORDER: TabId[] = ['skills', 'plugins', 'discover', 'marketplaces', 'errors'];

// Source filter type
type SourceFilter = 'all' | 'plugin' | 'smithery' | 'manual';

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

interface PluginProgress {
  pluginId: string;
  step: number;
  totalSteps: number;
  message: string;
}

interface PluginsPanelProps {
  onClose?: () => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
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
 * 获取来源 badge 的 CSS 类名
 */
function getSourceBadgeClass(source: SkillInfo['source']): string {
  switch (source) {
    case 'plugin': return 'plugins-source-badge plugins-source-badge-plugin';
    case 'smithery': return 'plugins-source-badge plugins-source-badge-smithery';
    case 'manual': return 'plugins-source-badge plugins-source-badge-manual';
    default: return 'plugins-source-badge';
  }
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
  const { t } = useLanguage();
  return (
    <div className="plugins-tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={`plugins-tab ${selectedTab === tab ? 'active' : ''}`}
          onClick={() => onTabChange(tab)}
        >
          {t(`plugins.tab.${tab}`)}
        </button>
      ))}
    </div>
  );
}

/**
 * Skill 内容查看模态框
 */
function SkillContentModal({
  skillName,
  content,
  onClose,
}: {
  skillName: string;
  content: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="plugins-skill-modal-overlay" onClick={onClose}>
      <div className="plugins-skill-modal" onClick={(e) => e.stopPropagation()}>
        <div className="plugins-skill-modal-header">
          <h4>{t('plugins.skills.viewContent')}: {skillName}</h4>
          <button className="plugins-action-btn" onClick={onClose}>
            {t('plugins.skills.closeModal')}
          </button>
        </div>
        <div className="plugins-skill-modal-content">
          <pre>{content}</pre>
        </div>
      </div>
    </div>
  );
}

/**
 * Skills Tab 组件
 */
function SkillsTab({
  skills,
  onViewContent,
  onDelete,
  onToggle,
}: {
  skills: SkillInfo[];
  onViewContent: (name: string) => void;
  onDelete: (name: string, source: string) => void;
  onToggle: (name: string, enabled: boolean) => void;
}) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);

  // 过滤 skills
  const filteredSkills = useMemo(() => {
    let result = skills;

    // 按来源过滤
    if (sourceFilter !== 'all') {
      result = result.filter((s) => s.source === sourceFilter);
    }

    // 按搜索关键词过滤
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }

    return result;
  }, [skills, sourceFilter, searchQuery]);

  if (skills.length === 0) {
    return (
      <div className="plugins-tab-content">
        <h4>{t('plugins.skills.title')}</h4>
        <div className="plugins-empty">
          <p>{t('plugins.skills.empty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <h4>{t('plugins.skills.title')}</h4>

      {/* 搜索框和筛选器 */}
      <div className="plugins-skills-toolbar">
        <div className="plugins-search" style={{ flex: 1, marginBottom: 0 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('plugins.skills.search')}
            className="plugins-search-input"
          />
        </div>
        <select
          className="plugins-source-filter"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
        >
          <option value="all">{t('plugins.skills.filter.all')}</option>
          <option value="plugin">{t('plugins.skills.filter.plugin')}</option>
          <option value="smithery">{t('plugins.skills.filter.smithery')}</option>
          <option value="manual">{t('plugins.skills.filter.manual')}</option>
        </select>
      </div>

      {/* 无搜索结果 */}
      {filteredSkills.length === 0 && (searchQuery || sourceFilter !== 'all') && (
        <div className="plugins-no-results">{t('plugins.skills.noResults')}</div>
      )}

      {/* Skills 列表 */}
      <div className="plugins-list">
        {filteredSkills.map((skill) => {
          const isExpanded = expandedSkill === skill.name;

          return (
            <div
              key={skill.name}
              className={`plugins-list-item ${isExpanded ? 'selected' : ''}`}
            >
              {/* 卡片头部：名称 + badge + 操作按钮 */}
              <div className="plugins-skill-item-header">
                <span className="plugins-item-name">{skill.displayName}</span>
                <span className={getSourceBadgeClass(skill.source)}>
                  {t(`plugins.skills.source.${skill.source}`)}
                </span>
                {skill.version && (
                  <span className="plugins-item-version">v{skill.version}</span>
                )}
                {!skill.enabled && (
                  <span className="plugins-tag plugins-tag-disabled">{t('plugins.skills.detail.disabled')}</span>
                )}
                
                {/* 右侧操作按钮 */}
                <div className="plugins-skill-actions-inline">
                  <button
                    className="plugins-skill-action-icon"
                    title={t('plugins.skills.actions.view')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewContent(skill.name);
                    }}
                  >
                    <SvgEye />
                  </button>
                  {skill.source !== 'plugin' && (
                    <button
                      className="plugins-skill-action-icon danger"
                      title={t('plugins.skills.actions.delete')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(t('plugins.skills.actions.confirmDelete'))) {
                          onDelete(skill.name, skill.source);
                        }
                      }}
                    >
                      <SvgTrash />
                    </button>
                  )}
                  <button
                    className="plugins-skill-expand-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedSkill(isExpanded ? null : skill.name);
                    }}
                  >
                    {isExpanded ? <SvgChevronUp /> : <SvgChevronDown />}
                  </button>
                </div>
              </div>

              {/* 描述（2行截断） */}
              {skill.description && (
                <div className="plugins-item-desc">{skill.description}</div>
              )}

              {/* 展开的详细信息 */}
              {isExpanded && (
                <div className="plugins-skill-detail">
                  {skill.sourceName && (
                    <div className="plugins-skill-detail-row">
                      <span className="plugins-skill-detail-label">{t('plugins.skills.detail.source')}:</span>
                      <span>{skill.sourceName}</span>
                    </div>
                  )}
                  {skill.model && (
                    <div className="plugins-skill-detail-row">
                      <span className="plugins-skill-detail-label">{t('plugins.skills.detail.model')}:</span>
                      <span>{skill.model}</span>
                    </div>
                  )}
                  {skill.allowedTools && skill.allowedTools.length > 0 && (
                    <div className="plugins-skill-detail-row">
                      <span className="plugins-skill-detail-label">{t('plugins.skills.detail.tools')}:</span>
                      <span>{skill.allowedTools.join(', ')}</span>
                    </div>
                  )}
                  {skill.argumentHint && (
                    <div className="plugins-skill-detail-row">
                      <span className="plugins-skill-detail-label">{t('plugins.skills.detail.argumentHint')}:</span>
                      <span>{skill.argumentHint}</span>
                    </div>
                  )}
                  {skill.author && (
                    <div className="plugins-skill-detail-row">
                      <span className="plugins-skill-detail-label">{t('plugins.skills.detail.author')}:</span>
                      <span>{skill.author}</span>
                    </div>
                  )}
                  <div className="plugins-skill-detail-row">
                    <span className="plugins-skill-detail-label">{t('plugins.skills.detail.path')}:</span>
                    <code>{skill.path}</code>
                  </div>

                  {/* 展开区域的操作按钮 */}
                  <div className="plugins-item-actions" style={{ marginLeft: 0, marginTop: 12 }}>
                    <button
                      className="plugins-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(skill.name, !skill.enabled);
                      }}
                    >
                      {skill.enabled ? t('plugins.skills.actions.disable') : t('plugins.skills.actions.enable')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  pluginProgress,
  simulatedProgress,
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
  pluginProgress: Map<string, PluginProgress>;
  simulatedProgress: Map<string, number>;
  onSelect: (pluginId: string) => void;
  onDeselect: (pluginId: string) => void;
  onViewDetails: (plugin: MarketplacePlugin) => void;
  onInstall: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  error?: string;
  noMarketplaces?: boolean;
}) {
  const { t } = useLanguage();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [displayCount, setDisplayCount] = useState(15);

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

  // 搜索变化时重置显示数量
  useEffect(() => {
    setDisplayCount(15);
  }, [searchQuery]);

  if (noMarketplaces) {
    return (
      <div className="plugins-tab-content">
        <h4>{t('plugins.discover.title')}</h4>
        <div className="plugins-empty">
          <p>{t('plugins.discover.noMarketplaces')}</p>
          <p>{t('plugins.discover.addMarketplaceHint')}</p>
          <code>/plugins marketplace add anthropics/claude-plugins-official</code>
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <div className="plugins-discover-header">
        <h4>{t('plugins.discover.title')}</h4>
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
          placeholder={t('plugins.discover.search')}
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
        <div className="plugins-no-results">{t('plugins.discover.noPlugins')}</div>
      )}

      {/* 插件列表 */}
      <div className="plugins-list">
        {filteredPlugins.slice(0, displayCount).map((plugin, index) => {
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
                  <span className="plugins-tag">{t('plugins.communityManaged')}</span>
                )}
                {isInstalled && <span className="plugins-tag plugins-tag-installed">{t('plugins.installed')}</span>}
                {plugin.installCount && plugin.installCount > 0 && (
                  <span className="plugins-item-installs">· {t('plugins.installs', { count: formatInstalls(plugin.installCount) })}</span>
                )}
              </div>
              {plugin.description && !isLoading && (
                <div className="plugins-item-desc">
                  {plugin.description.length > 60
                    ? plugin.description.substring(0, 57) + '...'
                    : plugin.description}
                </div>
              )}
              {isLoading && (() => {
                const serverProgress = pluginProgress.get(plugin.pluginId);
                const simPercent = simulatedProgress.get(plugin.pluginId) ?? 0;
                const percent = Math.round(simPercent);
                const msg = serverProgress?.message || t('plugins.discover.installing');
                return (
                  <div className="plugins-progress">
                    <div className="plugins-progress-bar">
                      <div className="plugins-progress-fill" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="plugins-progress-text">{msg} {percent}%</span>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* 加载更多按钮 */}
      {filteredPlugins.length > displayCount && (
        <div
          className="plugins-more"
          onClick={() => setDisplayCount(prev => prev + 15)}
          style={{ cursor: 'pointer' }}
        >
          {ICONS.arrowDown} {t('plugins.moreBelow')}
        </div>
      )}

      {/* 底部提示 */}
      <div className="plugins-hint">
        {selectedPlugins.size > 0 && (
          <button className="plugins-install-btn" onClick={onInstall}>
            {t('plugins.discover.install')} ({selectedPlugins.size})
          </button>
        )}
        <span>{t('plugins.searchHint')}</span>
      </div>
    </div>
  );
}

/**
 * Plugins Tab 组件 (原 InstalledTab)
 */
function PluginsTab({
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
  const { t } = useLanguage();
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (plugins.length === 0) {
    return (
      <div className="plugins-tab-content">
        <h4>{t('plugins.installed.title')}</h4>
        <div className="plugins-empty">
          <p>{t('plugins.installed.noPlugins')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <h4>{t('plugins.installed.title')}</h4>

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
                {plugin.enabled ? t('plugins.installed.disable') : t('plugins.installed.enable')}
              </button>
              <button
                className="plugins-action-btn plugins-action-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onUninstall(plugin.name);
                }}
              >
                {t('plugins.installed.uninstall')}
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
  const { t } = useLanguage();
  const [selectedIndex, setSelectedIndex] = useState(0);

  return (
    <div className="plugins-tab-content">
      <h4>{t('plugins.marketplaces.title')}</h4>

      <div className="plugins-list">
        {/* 添加选项 */}
        <div
          className={`plugins-list-item plugins-list-item-add ${selectedIndex === 0 ? 'selected' : ''}`}
          onClick={onAdd}
          onMouseEnter={() => setSelectedIndex(0)}
        >
          <span className="plugins-item-icon">{selectedIndex === 0 ? ICONS.pointer : ' '}</span>
          <span className="plugins-add-icon">{ICONS.plus}</span>
          <span className="plugins-item-name">{t('plugins.marketplaces.add')}</span>
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
                  {t('plugins.marketplaces.update')}
                </button>
                <button
                  className="plugins-action-btn plugins-action-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(marketplace.name);
                  }}
                >
                  {t('plugins.marketplaces.remove')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {marketplaces.length === 0 && (
        <div className="plugins-empty">{t('plugins.marketplaces.noMarketplaces')}</div>
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
  const { t } = useLanguage();
  if (errors.length === 0) {
    return (
      <div className="plugins-tab-content">
        <h4>{t('plugins.errors.title')}</h4>
        <div className="plugins-success">
          {ICONS.tick} {t('plugins.errors.noErrors')}
        </div>
      </div>
    );
  }

  return (
    <div className="plugins-tab-content">
      <h4>{t('plugins.errors.title')} ({errors.length})</h4>

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
          {t('plugins.errors.clear')}
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
  installProgress,
  installPercent,
  onInstall,
  onUninstall,
  onBack,
}: {
  plugin: MarketplacePlugin | PluginInfo;
  isInstalled: boolean;
  isInstalling: boolean;
  installProgress?: PluginProgress;
  installPercent: number;
  onInstall: () => void;
  onUninstall: () => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const name = 'pluginId' in plugin ? plugin.name : plugin.name;
  const version = 'version' in plugin ? plugin.version : undefined;
  const description = plugin.description;
  const author = 'author' in plugin ? plugin.author : undefined;
  const marketplaceName = 'marketplaceName' in plugin ? plugin.marketplaceName : undefined;
  const pluginPath = 'path' in plugin ? (plugin as PluginInfo).path : undefined;

  return (
    <div className="plugins-details">
      <div className="plugins-details-card">
        <div className="plugins-details-header">
          <h4>{t('plugins.details')}</h4>
        </div>

        <div className="plugins-details-info">
          <div className="plugins-details-name">{name}</div>
          {marketplaceName && <div className="plugins-details-from">{t('plugins.from', { name: marketplaceName })}</div>}
          {version && <div className="plugins-details-version">{t('plugins.version', { version })}</div>}
          {description && <div className="plugins-details-desc">{description}</div>}
          {author && <div className="plugins-details-author">{t('plugins.by', { author })}</div>}
          {pluginPath && <div className="plugins-details-path">{t('plugins.path')}: <code>{pluginPath}</code></div>}
        </div>

        <div className="plugins-warning-box">
          <span className="plugins-warning-icon">{ICONS.warning}</span>
          <span className="plugins-warning-text">
            {t('plugins.trustWarning')}
          </span>
        </div>

        <div className="plugins-details-actions">
          {isInstalled ? (
            <button className="plugins-btn plugins-btn-danger" onClick={onUninstall}>
              {t('plugins.uninstallBtn')}
            </button>
          ) : (
            <button
              className="plugins-btn plugins-btn-primary"
              onClick={onInstall}
              disabled={isInstalling}
            >
              {isInstalling ? t('plugins.installing') : t('plugins.installBtn')}
            </button>
          )}
        </div>
        {isInstalling && (() => {
          const percent = Math.round(installPercent);
          const msg = installProgress?.message || 'Installing...';
          return (
            <div className="plugins-details-progress">
              <div className="plugins-progress-bar">
                <div className="plugins-progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <span className="plugins-progress-text">{msg} {percent}%</span>
            </div>
          );
        })()}
      </div>

      <div className="plugins-hint">
        <button className="plugins-btn plugins-btn-secondary" onClick={onBack}>
          ← {t('plugins.back')}
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
  const { t } = useLanguage();
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!source.trim()) {
      setError(t('plugins.sourceError'));
      return;
    }
    onAdd(source.trim());
  };

  return (
    <div className="plugins-add-marketplace">
      <div className="plugins-add-card">
        <h4>{t('plugins.addMarketplace')}</h4>

        {error && <div className="plugins-form-error">{error}</div>}

        <div className="plugins-form-group">
          <label>{t('plugins.enterSource')}</label>
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
          <div className="plugins-examples-title">{t('plugins.examples')}</div>
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
 * Skills & Plugins 管理主面板
 */
export function PluginsPanel({ onClose, onSendMessage, addMessageHandler }: PluginsPanelProps) {
  const { t } = useLanguage();
  const [currentTab, setCurrentTab] = useState<TabId>('skills');
  const [viewMode, setViewMode] = useState<ViewMode>('tabs');

  // Plugin 数据状态
  const [discoverPlugins, setDiscoverPlugins] = useState<MarketplacePlugin[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<PluginInfo[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [errors, setErrors] = useState<PluginError[]>([]);

  // Skills 数据状态
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillContentModal, setSkillContentModal] = useState<{ name: string; content: string } | null>(null);

  // UI 状态
  const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set());
  const [loadingPlugins, setLoadingPlugins] = useState<Set<string>>(new Set());
  const [pluginProgress, setPluginProgress] = useState<Map<string, PluginProgress>>(new Map());
  const [simulatedProgress, setSimulatedProgress] = useState<Map<string, number>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePlugin | PluginInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // 加载数据：通过 WebSocket 获取真实数据
  useEffect(() => {
    if (onSendMessage) {
      // 请求已安装插件列表
      onSendMessage({ type: 'plugin_list' });
      // 请求 marketplace 和可发现插件
      onSendMessage({ type: 'plugin_discover' });
      // 请求 skills 列表
      onSendMessage({ type: 'skill_list' });
    }
  }, [onSendMessage]);

  // 监听 WebSocket 消息
  useEffect(() => {
    if (!addMessageHandler) {
      setLoading(false);
      return;
    }

    const unsubscribe = addMessageHandler((msg: any) => {
      // 已安装插件列表
      if (msg.type === 'plugin_list_response') {
        const { plugins } = msg.payload;
        setInstalledPlugins(plugins || []);
        setLoading(false);
      }

      // marketplace + 可发现插件
      if (msg.type === 'plugin_discover_response') {
        const { marketplaces: mks, availablePlugins } = msg.payload;
        setMarketplaces((mks || []).map((m: any) => ({
          name: m.name,
          source: m.source,
          pluginCount: m.pluginCount,
          autoUpdate: m.autoUpdate,
          lastUpdated: m.lastUpdated,
        })));
        setDiscoverPlugins((availablePlugins || []).map((p: any) => ({
          pluginId: p.pluginId,
          name: p.name,
          description: p.description,
          version: p.version,
          author: p.author,
          marketplaceName: p.marketplaceName,
          installCount: p.installCount,
          tags: p.tags || [],
        })));
        setLoading(false);
      }

      // Skills 列表
      if (msg.type === 'skill_list_response') {
        const { skills: skillList } = msg.payload;
        setSkills(skillList || []);
        setLoading(false);
      }

      // Skill 内容查看
      if (msg.type === 'skill_view_response') {
        const { name, content } = msg.payload;
        setSkillContentModal({ name, content });
      }

      // Skill 删除
      if (msg.type === 'skill_deleted') {
        const { name, success } = msg.payload;
        if (success) {
          setSkills((prev) => prev.filter((s) => s.name !== name));
        }
      }

      // Skill 切换启用/禁用
      if (msg.type === 'skill_toggled') {
        const { name, enabled, success } = msg.payload;
        if (success) {
          setSkills((prev) =>
            prev.map((s) => (s.name === name ? { ...s, enabled } : s))
          );
        }
      }
    });

    return unsubscribe;
  }, [addMessageHandler]);

  // 模拟渐进进度动画：loading 开始后从 0 递增到 90%
  useEffect(() => {
    if (loadingPlugins.size === 0) {
      setSimulatedProgress(new Map());
      return;
    }

    const timer = setInterval(() => {
      setSimulatedProgress((prev: Map<string, number>) => {
        const next = new Map<string, number>(prev);
        for (const pluginId of loadingPlugins) {
          const current = next.get(pluginId) ?? 0;
          // 越接近 90% 越慢（对数增长曲线）
          const increment = Math.max(0.5, (90 - current) * 0.08);
          next.set(pluginId, Math.min(90, current + increment));
        }
        return next;
      });
    }, 200);

    return () => clearInterval(timer);
  }, [loadingPlugins]);

  // 监听 WebSocket 消息：安装进度和安装完成
  useEffect(() => {
    if (!addMessageHandler) return;

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'plugin_progress') {
        const { pluginId, step, totalSteps, message } = msg.payload;
        setPluginProgress((prev) => {
          const next = new Map(prev);
          next.set(pluginId, { pluginId, step, totalSteps, message });
          return next;
        });
      }

      if (msg.type === 'plugin_installed') {
        // 安装完成：先将进度跳到 100%，短暂延迟后清除
        setSimulatedProgress((prev: Map<string, number>) => {
          const next = new Map<string, number>(prev);
          for (const pluginId of loadingPlugins) {
            next.set(pluginId, 100);
          }
          return next;
        });

        const installSuccess = msg.payload.success;
        const installedPlugin = msg.payload.plugin;
        const installError = msg.payload.error;

        // 延迟 500ms 清除，让用户看到 100% 完成状态
        setTimeout(() => {
          setLoadingPlugins(new Set());
          setPluginProgress(new Map());
          setSimulatedProgress(new Map());

          if (installSuccess && installedPlugin) {
            setInstalledPlugins((prev) => {
              const exists = prev.some((p) => p.name === installedPlugin.name);
              if (exists) return prev;
              return [...prev, installedPlugin];
            });
          } else if (installError) {
            setError(installError);
          }

          // 刷新插件列表
          if (onSendMessage) {
            onSendMessage({ type: 'plugin_list' });
          }
        }, 500);
      }
    });

    return unsubscribe;
  }, [addMessageHandler, onSendMessage, loadingPlugins]);

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

  // 安装单个插件（核心逻辑）
  const installSinglePlugin = (pluginId: string) => {
    setLoadingPlugins((prev) => new Set([...prev, pluginId]));

    if (onSendMessage) {
      onSendMessage({
        type: 'plugin_install',
        payload: { pluginId },
      });
    }

    // 清理选中状态
    setSelectedPlugins((prev) => {
      const next = new Set(prev);
      next.delete(pluginId);
      return next;
    });

    // 超时兜底：无论是否有 addMessageHandler，60 秒后强制清除 loading
    setTimeout(() => {
      setLoadingPlugins((prev) => {
        if (!prev.has(pluginId)) return prev;
        const next = new Set(prev);
        next.delete(pluginId);
        return next;
      });
      setPluginProgress((prev) => {
        if (!prev.has(pluginId)) return prev;
        const next = new Map(prev);
        next.delete(pluginId);
        return next;
      });
      setSimulatedProgress((prev: Map<string, number>) => {
        if (!prev.has(pluginId)) return prev;
        const next = new Map<string, number>(prev);
        next.delete(pluginId);
        return next;
      });
    }, 60000);
  };

  // 批量安装（从 Discover tab 勾选后点击安装按钮）
  const handleInstall = () => {
    for (const pluginId of selectedPlugins) {
      installSinglePlugin(pluginId);
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

  // Skills 操作
  const handleViewSkillContent = useCallback((name: string) => {
    if (onSendMessage) {
      onSendMessage({
        type: 'skill_view',
        payload: { name },
      });
    }
  }, [onSendMessage]);

  const handleDeleteSkill = useCallback((name: string, source: string) => {
    if (onSendMessage) {
      onSendMessage({
        type: 'skill_delete',
        payload: { name, source },
      });
    }
  }, [onSendMessage]);

  const handleToggleSkill = useCallback((name: string, enabled: boolean) => {
    // 乐观更新
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled } : s))
    );

    if (onSendMessage) {
      onSendMessage({
        type: 'skill_toggle',
        payload: { name, enabled },
      });
    }
  }, [onSendMessage]);

  if (loading) {
    return (
      <div className="plugins-panel">
        <div className="plugins-panel-header">
          <h3>{t('plugins.title')}</h3>
          <span className="plugins-panel-subtitle">{t('common.loading')}</span>
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
          installProgress={pluginProgress.get(pluginId)}
          installPercent={simulatedProgress.get(pluginId) ?? 0}
          onInstall={() => {
            if ('pluginId' in selectedPlugin) {
              installSinglePlugin(selectedPlugin.pluginId);
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
        <h3>{t('plugins.title')}</h3>
      </div>

      {/* Tab 栏 */}
      <TabBar tabs={TAB_ORDER} selectedTab={currentTab} onTabChange={handleTabChange} />

      {/* Tab 内容 */}
      {currentTab === 'skills' && (
        <SkillsTab
          skills={skills}
          onViewContent={handleViewSkillContent}
          onDelete={handleDeleteSkill}
          onToggle={handleToggleSkill}
        />
      )}

      {currentTab === 'plugins' && (
        <PluginsTab
          plugins={installedPlugins}
          onUninstall={handleUninstall}
          onViewDetails={handleViewPluginDetails}
          onToggle={handleToggle}
        />
      )}

      {currentTab === 'discover' && (
        <DiscoverTab
          plugins={discoverPlugins}
          selectedPlugins={selectedPlugins}
          loadingPlugins={loadingPlugins}
          installedPlugins={installedPluginNames}
          pluginProgress={pluginProgress}
          simulatedProgress={simulatedProgress}
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

      {/* Skill 内容查看模态框 */}
      {skillContentModal && (
        <SkillContentModal
          skillName={skillContentModal.name}
          content={skillContentModal.content}
          onClose={() => setSkillContentModal(null)}
        />
      )}
    </div>
  );
}

export default PluginsPanel;
