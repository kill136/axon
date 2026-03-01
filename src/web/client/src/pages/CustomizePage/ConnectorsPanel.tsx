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
}

// ========================================
// Connector 图标映射
// ========================================

function getConnectorIcon(icon: string, size: number = 32): JSX.Element {
  const iconName = icon.toLowerCase();

  // GitHub
  if (iconName === 'github') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
      </svg>
    );
  }

  // Gmail
  if (iconName === 'gmail') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 7l-10 7L2 7" />
      </svg>
    );
  }

  // Google Calendar
  if (iconName === 'google-calendar') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }

  // Google Drive
  if (iconName === 'google-drive') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M7.71 3.5L1.15 15l2.86 4.96L10.57 8.45 7.71 3.5zM8.8 3.5h6.4l6.65 11.5H15.2L8.8 3.5zm7.1 12.5H2.6l3.2 5.5h13.6l3.2-5.5H15.9z" />
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

// ========================================
// ConnectorsPanel 主组件
// ========================================

export default function ConnectorsPanel() {
  const { t } = useLanguage();
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorStatus | null>(null);
  
  // 配置表单状态
  const [configClientId, setConfigClientId] = useState('');
  const [configClientSecret, setConfigClientSecret] = useState('');
  const [configSaving, setConfigSaving] = useState(false);

  // OAuth 连接状态
  const [connecting, setConnecting] = useState(false);

  // 通过 HTTP API 获取连接器列表
  const fetchConnectors = useCallback(async () => {
    try {
      const res = await fetch('/api/connectors');
      if (res.ok) {
        const data = await res.json();
        setConnectors(data.connectors || []);
      }
    } catch (err) {
      console.error('Failed to fetch connectors:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  // 检测 URL 参数 connected（OAuth 回调后）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectedId = params.get('connected');
    if (connectedId) {
      // 清除 URL 参数
      const newUrl = window.location.pathname + '?page=customize';
      window.history.replaceState({}, '', newUrl);
      
      // 刷新列表并自动选中
      fetchConnectors().then(() => {
        const connector = connectors.find((c) => c.id === connectedId);
        if (connector) {
          setSelectedConnector(connector);
        }
      });
    }
  }, []);

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
        // 清空表单
        setConfigClientId('');
        setConfigClientSecret('');
        // 刷新列表
        await fetchConnectors();
        // 更新选中的连接器
        const updated = connectors.find((c) => c.id === connector.id);
        if (updated) {
          setSelectedConnector(updated);
        }
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

  // 连接操作
  const handleConnect = async (connector: ConnectorStatus) => {
    setConnecting(true);
    try {
      const res = await fetch(`/api/connectors/${connector.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        // 打开 OAuth 授权窗口
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

  // 断开连接
  const handleDisconnect = async (connector: ConnectorStatus) => {
    try {
      const res = await fetch(`/api/connectors/${connector.id}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        // 刷新列表
        await fetchConnectors();
        // 更新选中的连接器
        const updated = connectors.find((c) => c.id === connector.id);
        if (updated) {
          setSelectedConnector(updated);
        }
      } else {
        const error = await res.json();
        alert(`Failed to disconnect: ${error.error}`);
      }
    } catch (err) {
      console.error('Failed to disconnect:', err);
      alert('Failed to disconnect');
    }
  };

  // 分组：按 category
  const groupedConnectors = connectors.reduce((acc, connector) => {
    if (!acc[connector.category]) {
      acc[connector.category] = [];
    }
    acc[connector.category].push(connector);
    return acc;
  }, {} as Record<string, ConnectorStatus[]>);

  // 分组标题映射
  const getCategoryTitle = (category: string): string => {
    if (category === 'web') return t('customize.web');
    if (category === 'google') return t('customize.google');
    return category;
  };

  return (
    <div className={styles.connectorsPanel}>
      {/* 中栏：列表 */}
      <div className={styles.middleColumn}>
        <div className={styles.middleHeader}>
          <h2 className={styles.middleTitle}>{t('customize.connectors')}</h2>
          <div className={styles.middleActions}>
            <button className={styles.searchButton} title={t('customize.search')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5L14 14" />
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
              {Object.entries(groupedConnectors).map(([category, categoryConnectors]) => (
                <div key={category} className={styles.group}>
                  <div className={styles.groupHeader}>{getCategoryTitle(category)}</div>
                  <div className={styles.connectorList}>
                    {categoryConnectors.map((connector) => (
                      <button
                        key={connector.id}
                        className={`${styles.connectorItem} ${selectedConnector?.id === connector.id ? styles.active : ''}`}
                        onClick={() => setSelectedConnector(connector)}
                      >
                        <span className={styles.connectorIcon}>{getConnectorIcon(connector.icon)}</span>
                        <div className={styles.connectorInfo}>
                          <span className={styles.connectorName}>{connector.name}</span>
                          {connector.status === 'connected' && (
                            <span className={styles.connectedBadge}>{t('customize.connected')}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 右栏：详情 */}
      <div className={styles.rightColumn}>
        {!selectedConnector ? (
          <div className={styles.emptyDetail}>
            <p>{connectors.length === 0 ? t('customize.noConnectors') : t('customize.selectConnector')}</p>
          </div>
        ) : (
          <div className={styles.detailContent}>
            {/* 大图标 */}
            <div className={styles.detailIcon}>{getConnectorIcon(selectedConnector.icon, 64)}</div>

            {/* 名称 */}
            <h3 className={styles.detailName}>{selectedConnector.name}</h3>

            {/* 描述 */}
            <p className={styles.connectorDescription}>{selectedConnector.description}</p>

            {/* 未配置时显示配置表单 */}
            {!selectedConnector.configured && (
              <div className={styles.configForm}>
                <p className={styles.configHint}>
                  {t('customize.configHint', { name: selectedConnector.name })}
                </p>
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
                <button
                  className={styles.primaryButton}
                  onClick={() => handleSaveConfig(selectedConnector)}
                  disabled={configSaving || !configClientId || !configClientSecret}
                >
                  {configSaving ? t('customize.configSaved') : t('customize.saveConfig')}
                </button>
              </div>
            )}

            {/* 已配置但未连接 */}
            {selectedConnector.configured && selectedConnector.status === 'not_connected' && (
              <div className={styles.detailActions}>
                <button
                  className={styles.primaryButton}
                  onClick={() => handleConnect(selectedConnector)}
                  disabled={connecting}
                >
                  {connecting ? t('customize.connecting') : t('customize.connect')}
                </button>
                {connecting && (
                  <p className={styles.oauthHint}>{t('customize.oauthPopupHint')}</p>
                )}
              </div>
            )}

            {/* 已连接 */}
            {selectedConnector.status === 'connected' && (
              <div className={styles.detailInfo}>
                {selectedConnector.connectedAt && (
                  <div className={styles.userInfoSection}>
                    <p className={styles.infoRow}>
                      {t('customize.connectedSince', {
                        date: new Date(selectedConnector.connectedAt).toLocaleString(),
                      })}
                    </p>
                    {selectedConnector.userInfo && (
                      <div className={styles.userInfo}>
                        {selectedConnector.userInfo.login && (
                          <p className={styles.infoRow}>User: {selectedConnector.userInfo.login}</p>
                        )}
                        {selectedConnector.userInfo.email && (
                          <p className={styles.infoRow}>Email: {selectedConnector.userInfo.email}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className={styles.secondaryActions}>
                  <button
                    className={styles.dangerButton}
                    onClick={() => handleDisconnect(selectedConnector)}
                  >
                    {t('customize.disconnect')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
