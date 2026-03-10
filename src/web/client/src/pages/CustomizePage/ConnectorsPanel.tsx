import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import styles from './ConnectorsPanel.module.css';

interface ConnectorStatus {
  id: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  status: 'connected' | 'not_connected';
  configured: boolean;
  configureHint?: string;
  connectedAt?: number;
  userInfo?: Record<string, any>;
  mcpServerName?: string;
  mcpConnected?: boolean;
  mcpToolCount?: number;
  authType?: 'oauth' | 'credentials' | 'mcp-oauth';
  credentialFields?: { key: string; label: string; type: 'text' | 'password' }[];
}

// ========================================
// Connector 彩色品牌图标
// ========================================

function getConnectorIcon(icon: string, size: number = 24): JSX.Element {
  const iconName = icon.toLowerCase();

  // GitHub - 黑/白色 Octocat
  if (iconName === 'github') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
      </svg>
    );
  }

  // Gmail - 彩色 M logo
  if (iconName === 'gmail') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="#EA4335"/>
        <path d="M2 6l10 7 10-7" stroke="#fff" strokeWidth="1.5" fill="none"/>
        <path d="M2 6v12h2V8l8 5.5L20 8v10h2V6l-10 7L2 6z" fill="#C5221F" opacity="0.3"/>
      </svg>
    );
  }

  // Google Calendar - 蓝色日历
  if (iconName === 'google-calendar') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="18" rx="2" fill="#4285F4"/>
        <rect x="3" y="4" width="18" height="5" rx="2" fill="#1967D2"/>
        <line x1="8" y1="2" x2="8" y2="6" stroke="#1967D2" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="16" y1="2" x2="16" y2="6" stroke="#1967D2" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="6" y="12" width="3" height="2.5" rx="0.5" fill="#fff"/>
        <rect x="10.5" y="12" width="3" height="2.5" rx="0.5" fill="#fff"/>
        <rect x="15" y="12" width="3" height="2.5" rx="0.5" fill="#fff"/>
        <rect x="6" y="16" width="3" height="2.5" rx="0.5" fill="#fff"/>
        <rect x="10.5" y="16" width="3" height="2.5" rx="0.5" fill="#fff"/>
      </svg>
    );
  }

  // Google Drive - 彩色三角
  if (iconName === 'google-drive') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M8.3 3.5L1.7 15h5.1l6.6-11.5H8.3z" fill="#0066DA"/>
        <path d="M13.4 3.5L6.8 15l2.6 4.5 6.6-11.5h-2.6z" fill="#00AC47"/>
        <path d="M6.8 15h13.2l2.6 4.5H9.4L6.8 15z" fill="#EA4335"/>
        <path d="M15.7 3.5h-2.3l6.6 11.5h2.3L15.7 3.5z" fill="#00832D"/>
        <path d="M22.3 15h-2.3L17.4 19.5h2.3L22.3 15z" fill="#2684FC"/>
        <path d="M8.3 3.5L6.8 15l2.6 4.5L13.4 3.5H8.3z" fill="#FFBA00" opacity="0.8"/>
      </svg>
    );
  }

  // 飞书 - 蓝色飞鸟 logo
  if (iconName === 'feishu') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#3370FF"/>
        <path d="M6.5 8.5C8.5 7 11 6.5 13.5 7.5C14.5 8 15.5 9 16 10L17.5 7C15 4.5 11 4 8 5.5L6.5 8.5Z" fill="white"/>
        <path d="M16 10C16.5 11.5 16 13.5 14.5 15C13 16.5 11 17 9 16.5L7 19C10 20.5 14 19.5 16.5 17C18.5 15 19 12 17.5 9.5L16 10Z" fill="white" opacity="0.8"/>
        <circle cx="10" cy="12" r="1.5" fill="white"/>
      </svg>
    );
  }

  // 钉钉 - 蓝白色 logo
  if (iconName === 'dingtalk') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#3089DC"/>
        <path d="M17.5 10.5c-.3-.8-1.5-1.2-3-1.5-.8-.2-2.5-.5-2.8-.6-.3-.1-.2-.3.1-.4.6-.2 2.8-.1 3.5 0 0 0-.5-1.2-2.8-1.8-1.5-.4-2.8-.2-3.2 0-.4.2-1 .7-.8 2 .2 1.2 1.2 3 2 4.2.5.8.8 1.5.6 2-.1.3-.3.5-.7.5H8.2s.5 1.5 2.8 1.5c1.5 0 2.2-.5 2.5-.8.8-.8 2.5-2.2 3-3.5.3-.7.3-1.2 0-1.6z" fill="white"/>
      </svg>
    );
  }

  // Notion - 黑白 N logo
  if (iconName === 'notion') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="4" fill="currentColor" opacity="0.1"/>
        <path d="M5.5 4.5h8.5l4.5 4v11a1 1 0 01-1 1H5.5a1 1 0 01-1-1V5.5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/>
        <path d="M8 8.5h5M8 11.5h8M8 14.5h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
      </svg>
    );
  }

  // Slack - 彩色 # logo
  if (iconName === 'slack') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M6 15a2 2 0 11-2-2h2v2zm1 0a2 2 0 112 2v-2H7z" fill="#E01E5A"/>
        <path d="M9 6a2 2 0 112 2H9V6zm0 1a2 2 0 11-2 2V7h2z" fill="#36C5F0"/>
        <path d="M18 9a2 2 0 11-2 2V9h2zm-1 0a2 2 0 11-2-2h2v2z" fill="#2EB67D"/>
        <path d="M15 18a2 2 0 11-2-2h2v2zm0-1a2 2 0 112 2v-2h-2z" fill="#ECB22E"/>
      </svg>
    );
  }

  // Linear - 紫色圆环
  if (iconName === 'linear') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#5E6AD2" strokeWidth="2"/>
        <path d="M8 12l3 3 5-6" stroke="#5E6AD2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  // Jira - 蓝色三角
  if (iconName === 'jira') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12.005 2L5.47 8.535a2 2 0 000 2.83L12 17.9l6.535-6.534a2 2 0 000-2.83L12.005 2z" fill="#2684FF"/>
        <path d="M12.005 2c-.003 3.39-1.358 6.64-3.768 9.035L12 14.8l3.763-3.765A12.78 12.78 0 0012.005 2z" fill="url(#jira-grad)"/>
        <defs><linearGradient id="jira-grad" x1="12" y1="2" x2="8.2" y2="11"><stop stopColor="#2684FF"/><stop offset="1" stopColor="#0052CC"/></linearGradient></defs>
      </svg>
    );
  }

  // Default: puzzle piece icon
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 16V7a2 2 0 00-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6a2 2 0 00-2 2v4c1.66 0 3 1.34 3 3s-1.34 3-3 3v3a2 2 0 002 2h4c0-1.66 1.34-3 3-3s3 1.34 3 3h4a2 2 0 002-2z" />
    </svg>
  );
}

// 折叠箭头
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s ease',
      }}
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

// ========================================
// ConnectorsPanel 主组件
// ========================================

export default function ConnectorsPanel() {
  const { t } = useLanguage();
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorStatus | null>(null);

  // 配置表单状态（View details 模式下使用）
  const [showConfig, setShowConfig] = useState(false);
  const [configClientId, setConfigClientId] = useState('');
  const [configClientSecret, setConfigClientSecret] = useState('');
  const [configFields, setConfigFields] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);

  // OAuth 连接状态
  const [connecting, setConnecting] = useState(false);

  // 分组折叠状态
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // 通过 HTTP API 获取连接器列表
  const fetchConnectors = useCallback(async (): Promise<ConnectorStatus[]> => {
    try {
      const res = await fetch('/api/connectors');
      if (res.ok) {
        const data = await res.json();
        const list = data.connectors || [];
        setConnectors(list);
        return list;
      }
    } catch (err) {
      console.error('Failed to fetch connectors:', err);
    } finally {
      setLoading(false);
    }
    return [];
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // 监听 OAuth 弹窗的 postMessage 回调
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const { type, connectorId, error } = event.data || {};

      if (type === 'oauth-success' && connectorId) {
        // 刷新列表，选中已连接的 connector
        const list = await fetchConnectors();
        const updated = list.find((c: ConnectorStatus) => c.id === connectorId);
        if (updated) {
          setSelectedConnector(updated);
        }
      } else if (type === 'oauth-error' && error) {
        alert(`OAuth failed: ${error}`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchConnectors]);

  // 当选中连接器变化时，重置配置面板状态
  useEffect(() => {
    setShowConfig(false);
    setConfigClientId('');
    setConfigClientSecret('');
    setConfigFields({});
  }, [selectedConnector?.id]);

  // 保存配置
  const handleSaveConfig = async (connector: ConnectorStatus) => {
    if (!configClientId || !configClientSecret) {
      alert(t('customize.configRequired'));
      return;
    }

    setConfigSaving(true);
    try {
      const res = await fetch(`/api/connectors/${connector.id}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: configClientId,
          clientSecret: configClientSecret,
        }),
      });

      if (res.ok) {
        setConfigClientId('');
        setConfigClientSecret('');
        setShowConfig(false);
        await fetchConnectors();
      } else {
        const error = await res.json();
        alert(`Failed to save config: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to save config:', err);
      alert('Failed to save configuration');
    } finally {
      setConfigSaving(false);
    }
  };

  // MCP 远程 OAuth 连接（Notion/Slack/Linear/Jira）
  const handleMcpOAuthConnect = async (connector: ConnectorStatus) => {
    setConnecting(true);
    try {
      const res = await fetch(`/api/connectors/${connector.id}/mcp-oauth-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        // MCP 启动后 mcp-remote 会自动弹浏览器做 OAuth
        // 轮询等待 MCP 连接就绪
        const pollMcpReady = async () => {
          for (let i = 0; i < 30; i++) { // 最多等 60 秒
            await new Promise(r => setTimeout(r, 2000));
            const list = await fetchConnectors();
            const updated = list.find((c: ConnectorStatus) => c.id === connector.id);
            if (updated && updated.mcpConnected && updated.mcpToolCount && updated.mcpToolCount > 0) {
              setSelectedConnector(updated);
              return;
            }
          }
        };
        pollMcpReady();
      } else {
        const error = await res.json();
        alert(`Failed to connect: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to mcp-oauth connect:', err);
      alert('Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  // 连接操作
  const handleConnect = async (connector: ConnectorStatus) => {
    // MCP 远程 OAuth 模式（Notion/Slack/Linear/Jira）
    if (connector.authType === 'mcp-oauth') {
      handleMcpOAuthConnect(connector);
      return;
    }

    // 凭据直连模式
    if (connector.authType === 'credentials') {
      if (connector.configured) {
        // 已有环境变量配置，直接连
        handleDirectConnect(connector);
      } else {
        // 显示表单让用户填
        setShowConfig(true);
      }
      return;
    }

    // OAuth 模式
    if (!connector.configured) {
      // 未配置时跳到配置表单
      setShowConfig(true);
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(`/api/connectors/${connector.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        window.open(data.authUrl, '_blank', 'width=600,height=800');
      } else {
        const error = await res.json();
        alert(`Failed to connect: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to connect:', err);
      alert('Failed to start OAuth flow');
    } finally {
      setConnecting(false);
    }
  };

  // 凭据直连
  const handleDirectConnect = async (connector: ConnectorStatus) => {
    // 构建凭据（统一用 configFields map）
    const bodyData: Record<string, string> = {};
    Object.entries(configFields).forEach(([k, v]) => { if (v) bodyData[k] = v; });

    // 如果环境变量已配置，后端可以补齐缺失字段
    const hasEnvConfig = connector.configured;
    const hasFormData = Object.values(bodyData).some(v => v);
    if (!hasEnvConfig && !hasFormData) {
      alert('Please fill in required fields');
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch(`/api/connectors/${connector.id}/direct-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
      });

      if (res.ok) {
        setConfigClientId('');
        setConfigClientSecret('');
        setConfigFields({});
        setShowConfig(false);
        const list = await fetchConnectors();
        const updated = list.find((c: ConnectorStatus) => c.id === connector.id);
        if (updated) {
          setSelectedConnector(updated);
        }
      } else {
        const error = await res.json();
        alert(`Failed to connect: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to direct connect:', err);
      alert('Failed to connect');
    } finally {
      setConnecting(false);
      setConfigSaving(false);
    }
  };

  // 断开连接
  const handleDisconnect = async (connector: ConnectorStatus) => {
    try {
      // 先停用 MCP（后端已经在 disconnect API 中自动调用，这里保留以确保顺序）
      if (connector.mcpConnected) {
        await fetch(`/api/connectors/${connector.id}/deactivate-mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const res = await fetch(`/api/connectors/${connector.id}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        await fetchConnectors();
        setSelectedConnector(null);
      } else {
        const error = await res.json();
        alert(`Failed to disconnect: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to disconnect:', err);
      alert('Failed to disconnect');
    }
  };

  // 激活 MCP
  const handleActivateMcp = async (connector: ConnectorStatus) => {
    try {
      const res = await fetch(`/api/connectors/${connector.id}/activate-mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`MCP activated for ${connector.name}, tools:`, data.tools);
        await fetchConnectors();
      } else {
        const error = await res.json();
        alert(`Failed to activate MCP: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to activate MCP:', err);
      alert('Failed to activate MCP');
    }
  };

  // 切换分组折叠
  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  // 按连接状态分组（对齐官方：已连接的按 category 分组，未连接的单独一组）
  const connectedByCategory: Record<string, ConnectorStatus[]> = {};
  const notConnected: ConnectorStatus[] = [];

  connectors.forEach((c) => {
    if (c.status === 'connected') {
      const cat = c.category || 'web';
      if (!connectedByCategory[cat]) connectedByCategory[cat] = [];
      connectedByCategory[cat].push(c);
    } else {
      notConnected.push(c);
    }
  });

  // 分组标题映射
  const getCategoryTitle = (category: string): string => {
    if (category === 'web') return t('customize.web');
    if (category === 'google') return t('customize.google');
    if (category === 'feishu') return t('customize.feishu');
    if (category === 'dingtalk') return t('customize.dingtalk');
    return category;
  };

  // 当前选中的最新数据
  const currentSelected = selectedConnector
    ? connectors.find((c) => c.id === selectedConnector.id) || selectedConnector
    : null;

  return (
    <div className={styles.connectorsPanel}>
      {/* 中栏：列表 */}
      <div className={styles.middleColumn}>
        <div className={styles.middleHeader}>
          <h2 className={styles.middleTitle}>{t('customize.connectors')}</h2>
          <div className={styles.middleActions}>
            <button className={styles.iconButton} title={t('customize.search')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
              </svg>
            </button>
            <button className={styles.iconButton} title={t('customize.addConnector')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          </div>
        </div>

        <div className={styles.middleContent}>
          {loading ? (
            <div className={styles.emptyState}>{t('mcp.loading')}</div>
          ) : connectors.length === 0 ? (
            <div className={styles.emptyState}>{t('customize.noConnectors')}</div>
          ) : (
            <>
              {/* 已连接的，按 category 分组 */}
              {Object.entries(connectedByCategory).map(([category, items]) => (
                <div key={category} className={styles.group}>
                  <button
                    className={styles.groupHeader}
                    onClick={() => toggleGroup(category)}
                  >
                    <ChevronIcon collapsed={!!collapsedGroups[category]} />
                    <span>{getCategoryTitle(category)}</span>
                  </button>
                  {!collapsedGroups[category] && (
                    <div className={styles.connectorList}>
                      {items.map((connector) => (
                        <button
                          key={connector.id}
                          className={`${styles.connectorItem} ${currentSelected?.id === connector.id ? styles.active : ''}`}
                          onClick={() => setSelectedConnector(connector)}
                        >
                          <span className={styles.connectorIcon}>{getConnectorIcon(connector.icon)}</span>
                          <span className={styles.connectorName}>{connector.name}</span>
                          {connector.mcpConnected && connector.mcpToolCount && connector.mcpToolCount > 0 && (
                            <span className={styles.mcpBadgeGreen}>{connector.mcpToolCount} tools</span>
                          )}
                          {!connector.mcpConnected && connector.mcpServerName && (
                            <span className={styles.mcpBadgeGray}>MCP not connected</span>
                          )}
                        </button>
                      ))}
                      {items.length > 0 && <div className={styles.groupDivider} />}
                    </div>
                  )}
                </div>
              ))}

              {/* 未连接的 */}
              {notConnected.length > 0 && (
                <div className={styles.group}>
                  <button
                    className={styles.groupHeader}
                    onClick={() => toggleGroup('not-connected')}
                  >
                    <ChevronIcon collapsed={!!collapsedGroups['not-connected']} />
                    <span>{t('customize.notConnected')}</span>
                  </button>
                  {!collapsedGroups['not-connected'] && (
                    <div className={styles.connectorList}>
                      {notConnected.map((connector) => (
                        <button
                          key={connector.id}
                          className={`${styles.connectorItem} ${currentSelected?.id === connector.id ? styles.active : ''}`}
                          onClick={() => setSelectedConnector(connector)}
                        >
                          <span className={styles.connectorIcon}>{getConnectorIcon(connector.icon)}</span>
                          <span className={styles.connectorName}>{connector.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 右栏：详情 */}
      <div className={styles.rightColumn}>
        {!currentSelected ? (
          <div className={styles.emptyDetail}>
            <p>{connectors.length === 0 ? t('customize.noConnectors') : t('customize.selectConnector')}</p>
          </div>
        ) : (
          <div className={styles.detailContent}>
            {/* 大图标 */}
            <div className={styles.detailIcon}>
              {getConnectorIcon(currentSelected.icon, 48)}
            </div>

            {/* 未连接状态 */}
            {currentSelected.status !== 'connected' && !showConfig && (
              <>
                <p className={styles.detailMessage}>
                  {t('customize.notConnectedYet', { name: currentSelected.name })}
                </p>
                <div className={styles.detailActions}>
                  <button
                    className={styles.connectButton}
                    onClick={() => handleConnect(currentSelected)}
                    disabled={connecting}
                  >
                    {connecting ? t('customize.connecting') : t('customize.connect')}
                  </button>
                  {/* mcp-oauth 模式不需要配置，隐藏 View details */}
                  {currentSelected.authType !== 'mcp-oauth' && (
                    <button
                      className={styles.viewDetailsButton}
                      onClick={() => setShowConfig(true)}
                    >
                      {t('customize.viewDetails')}
                    </button>
                  )}
                </div>
                {connecting && (
                  <p className={styles.oauthHint}>
                    {currentSelected.authType === 'mcp-oauth'
                      ? t('customize.mcpOAuthStarting')
                      : t('customize.oauthPopupHint')}
                  </p>
                )}
              </>
            )}

            {/* 配置表单（View details 展开 / 凭据直连） */}
            {currentSelected.status !== 'connected' && showConfig && (
              <div className={styles.configForm}>
                <p className={styles.configHint}>
                  {currentSelected.authType === 'credentials'
                    ? `${currentSelected.description}`
                    : t('customize.configHint', { name: currentSelected.name })}
                </p>
                {currentSelected.credentialFields ? (
                  // 凭据直连：用 provider 定义的字段
                  <>
                    {currentSelected.credentialFields.map((field) => {
                      // 统一用 configFields map 管理所有凭据字段
                      const value = configFields[field.key] || '';
                      const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
                        setConfigFields(prev => ({ ...prev, [field.key]: e.target.value }));
                      };
                      return (
                        <div key={field.key} className={styles.configField}>
                          <label className={styles.configLabel}>{field.label}</label>
                          <input
                            type={field.type}
                            className={styles.configInput}
                            value={value}
                            onChange={onChange}
                            placeholder={`Enter ${field.label}`}
                          />
                        </div>
                      );
                    })}
                  </>
                ) : (
                  // OAuth：标准 Client ID / Secret 表单
                  <>
                    <div className={styles.configField}>
                      <label className={styles.configLabel}>{t('customize.clientId')}</label>
                      <input
                        type="text"
                        className={styles.configInput}
                        value={configClientId}
                        onChange={(e) => setConfigClientId(e.target.value)}
                        placeholder="Enter Client ID"
                      />
                    </div>
                    <div className={styles.configField}>
                      <label className={styles.configLabel}>{t('customize.clientSecret')}</label>
                      <input
                        type="password"
                        className={styles.configInput}
                        value={configClientSecret}
                        onChange={(e) => setConfigClientSecret(e.target.value)}
                        placeholder="Enter Client Secret"
                      />
                    </div>
                  </>
                )}
                <div className={styles.configActions}>
                  <button
                    className={styles.connectButton}
                    onClick={() =>
                      currentSelected.authType === 'credentials'
                        ? handleDirectConnect(currentSelected)
                        : handleSaveConfig(currentSelected)
                    }
                    disabled={configSaving || (
                      currentSelected.credentialFields
                        ? !Object.values(configFields).some(v => v)
                        : (!configClientId || !configClientSecret)
                    )}
                  >
                    {configSaving
                      ? t('customize.connecting')
                      : currentSelected.authType === 'credentials'
                        ? t('customize.connect')
                        : t('customize.saveConfig')}
                  </button>
                  <button
                    className={styles.viewDetailsButton}
                    onClick={() => setShowConfig(false)}
                  >
                    {t('customize.back')}
                  </button>
                </div>
              </div>
            )}

            {/* 已连接状态 */}
            {currentSelected.status === 'connected' && (
              <div className={styles.connectedInfo}>
                <p className={styles.connectedMessage}>
                  {t('customize.connectedTo', { name: currentSelected.name })}
                </p>
                {currentSelected.userInfo && (
                  <div className={styles.userInfo}>
                    {(currentSelected.userInfo.login || currentSelected.userInfo.name) && (
                      <p className={styles.infoRow}>
                        <span className={styles.infoLabel}>User:</span>
                        <span>{currentSelected.userInfo.login || currentSelected.userInfo.name}</span>
                      </p>
                    )}
                    {currentSelected.userInfo.email && (
                      <p className={styles.infoRow}>
                        <span className={styles.infoLabel}>Email:</span>
                        <span>{currentSelected.userInfo.email}</span>
                      </p>
                    )}
                  </div>
                )}
                {currentSelected.connectedAt && (
                  <p className={styles.connectedSince}>
                    {t('customize.connectedSince', {
                      date: new Date(currentSelected.connectedAt).toLocaleDateString(),
                    })}
                  </p>
                )}

                {/* MCP 状态 */}
                {currentSelected.mcpServerName && (
                  <div className={styles.mcpStatus}>
                    {currentSelected.mcpConnected && currentSelected.mcpToolCount && currentSelected.mcpToolCount > 0 ? (
                      <div className={styles.mcpConnectedBadge}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="6" fill="#10b981" />
                          <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>MCP Connected: {currentSelected.mcpToolCount} tools available</span>
                      </div>
                    ) : (
                      <div className={styles.mcpNotConnected}>
                        <div className={styles.mcpNotConnectedBadge}>
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="6" fill="#6b7280" />
                          </svg>
                          <span>MCP not connected</span>
                        </div>
                        <button
                          className={styles.activateMcpButton}
                          onClick={() => handleActivateMcp(currentSelected)}
                        >
                          Activate MCP
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button
                  className={styles.disconnectButton}
                  onClick={() => handleDisconnect(currentSelected)}
                >
                  {t('customize.disconnect')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
