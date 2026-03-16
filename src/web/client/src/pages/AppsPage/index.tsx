/**
 * AI 应用工厂 — 运行中应用仪表盘
 *
 * 展示所有应用的运行状态、预览入口、发布链接。
 * 创建入口在 ProjectSelector 和 WelcomeScreen 中。
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import './AppsPage.css';

// ============ 类型 ============

export interface UserApp {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  status: 'creating' | 'ready' | 'error';
  errorMessage?: string;
  sessionId: string;
  workingDirectory: string;
  previewUrl: string;
  publish?: {
    surgeUrl?: string;
    tunnelUrl?: string;
    publishedAt: string;
  };
}

interface AppsPageProps {
  /** 当前 WebSocket 连接的 send 方法 */
  wsSend?: (msg: any) => void;
  /** 注册 WebSocket 消息处理器，返回取消注册函数 */
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
  /** 应用列表（由父组件管理） */
  apps?: UserApp[];
  /** 刷新应用列表回调 */
  onRefresh?: () => void;
  /** 选中应用回调（跳转到对应 session） */
  onAppSelect?: (app: UserApp) => void;
  /** 创建应用回调 */
  onCreateApp?: () => void;
}

// ============ 工具函数 ============

function timeAgo(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return t('time.justNow');
  if (diff < hour) return t('time.minutesAgo', { count: Math.floor(diff / minute) });
  if (diff < day) return t('time.hoursAgo', { count: Math.floor(diff / hour) });
  return t('time.daysAgo', { count: Math.floor(diff / day) });
}

// ============ 组件 ============

export default function AppsPage({ apps: propApps, onRefresh, onAppSelect, onCreateApp }: AppsPageProps) {
  const { t } = useLanguage();
  const [apps, setApps] = useState<UserApp[]>(propApps || []);
  const [selectedApp, setSelectedApp] = useState<UserApp | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);

  // 从 prop 同步
  useEffect(() => {
    if (propApps) setApps(propApps);
  }, [propApps]);

  // 如果没有传 apps prop，自己 fetch
  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch('/api/apps');
      if (res.ok) {
        const data = await res.json();
        if (data.apps) setApps(data.apps);
      }
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    if (!propApps) fetchApps();
  }, [propApps, fetchApps]);

  const handleRefresh = () => {
    if (onRefresh) onRefresh();
    else fetchApps();
  };

  const handlePublish = async (appId: string, method: 'surge' | 'tunnel') => {
    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/apps/${appId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });
      const data = await res.json();
      if (data.url) {
        setPublishResult(data.url);
        handleRefresh();
      }
    } catch { /* 忽略 */ } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async (appId: string) => {
    try {
      await fetch(`/api/apps/${appId}`, { method: 'DELETE' });
      setSelectedApp(null);
      handleRefresh();
    } catch { /* 忽略 */ }
  };

  // 统计
  const readyCount = apps.filter(a => a.status === 'ready').length;
  const creatingCount = apps.filter(a => a.status === 'creating').length;
  const errorCount = apps.filter(a => a.status === 'error').length;

  return (
    <div className="apps-page">
      {/* 头部统计 */}
      <div className="apps-header">
        <h1>
          <span>📱</span> {t('apps.title') || '我的作品'}
        </h1>
        <div className="apps-stats">
          {readyCount > 0 && <span className="apps-stat apps-stat-ready">🟢 {readyCount}</span>}
          {creatingCount > 0 && <span className="apps-stat apps-stat-creating">🟡 {creatingCount}</span>}
          {errorCount > 0 && <span className="apps-stat apps-stat-error">🔴 {errorCount}</span>}
        </div>
      </div>

      {/* 详情视图 */}
      {selectedApp ? (
        <div className="apps-detail">
          <div className="apps-detail-header">
            <button className="apps-back-btn" onClick={() => { setSelectedApp(null); setPublishResult(null); }}>
              ← {t('apps.back') || '返回'}
            </button>
            <div className="apps-detail-title">
              <span className="apps-detail-icon">{selectedApp.icon}</span>
              <span>{selectedApp.name}</span>
            </div>
            <div className="apps-detail-actions">
              {selectedApp.status === 'ready' && (
                <button className="apps-chat-btn" onClick={() => onAppSelect?.(selectedApp)}>
                  💬 {t('apps.chat') || '对话'}
                </button>
              )}
              <button className="apps-delete-btn" onClick={() => handleDelete(selectedApp.id)}>
                {t('apps.delete') || '删除'}
              </button>
            </div>
          </div>

          <div className="apps-detail-body">
            {/* 预览 */}
            <div className="apps-detail-preview">
              {selectedApp.status === 'ready' ? (
                <iframe
                  src={selectedApp.previewUrl}
                  title={selectedApp.name}
                  className="apps-preview-iframe"
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
                />
              ) : selectedApp.status === 'creating' ? (
                <div className="apps-preview-placeholder">
                  <span className="apps-preview-spinner">⏳</span>
                  <p>{t('apps.creating') || '创建中...'}</p>
                </div>
              ) : (
                <div className="apps-preview-placeholder apps-preview-error">
                  <span>❌</span>
                  <p>{selectedApp.errorMessage || (t('apps.statusError') || '异常')}</p>
                </div>
              )}
            </div>

            {/* 发布面板 */}
            {selectedApp.status === 'ready' && (
              <div className="apps-detail-publish">
                <h3>{t('apps.publish') || '发布到公网'}</h3>

                {selectedApp.publish?.surgeUrl && (
                  <div className="publish-result">
                    <p>🌐 Surge: <a href={selectedApp.publish.surgeUrl} target="_blank" rel="noreferrer">{selectedApp.publish.surgeUrl}</a></p>
                  </div>
                )}
                {selectedApp.publish?.tunnelUrl && (
                  <div className="publish-result">
                    <p>🔗 Tunnel: <a href={selectedApp.publish.tunnelUrl} target="_blank" rel="noreferrer">{selectedApp.publish.tunnelUrl}</a></p>
                  </div>
                )}

                {publishResult && (
                  <div className="publish-result">
                    <p>✅ <a href={publishResult} target="_blank" rel="noreferrer">{publishResult}</a></p>
                  </div>
                )}

                {!publishing && (
                  <div className="publish-options">
                    <button className="publish-option" onClick={() => handlePublish(selectedApp.id, 'surge')}>
                      <div className="publish-option-title">🚀 Surge.sh</div>
                      <div className="publish-option-desc">{t('apps.publishSurgeDesc') || '永久链接，需要 surge CLI'}</div>
                    </button>
                    <button className="publish-option" onClick={() => handlePublish(selectedApp.id, 'tunnel')}>
                      <div className="publish-option-title">🔗 Cloudflare Tunnel</div>
                      <div className="publish-option-desc">{t('apps.publishTunnelDesc') || '临时链接，无需安装'}</div>
                    </button>
                  </div>
                )}
                {publishing && <p className="apps-publishing">{t('apps.publishing') || '发布中...'}</p>}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 应用网格 */
        <>
          {apps.length === 0 ? (
            <div className="apps-empty">
              <div className="apps-empty-icon">📱</div>
              <h2>{t('apps.emptyTitle') || 'AI 帮你做'}</h2>
              <p>{t('apps.emptyDesc') || '描述你想做的东西，AI 帮你生成'}</p>
              <button className="apps-create-btn" onClick={onCreateApp}>
                ✨ {t('projectSelector.createApp') || 'AI 帮我做'}
              </button>
            </div>
          ) : (
            <div className="apps-grid">
              {apps.map(app => (
                <div
                  key={app.id}
                  className={`app-card app-card-${app.status}`}
                  onClick={() => setSelectedApp(app)}
                >
                  <div className="app-card-icon">{app.icon}</div>
                  <div className="app-card-info">
                    <div className="app-card-name">{app.name}</div>
                    <div className="app-card-desc">{app.description}</div>
                  </div>
                  <div className="app-card-footer">
                    <span className={`app-card-status status-${app.status}`}>
                      {app.status === 'ready' ? '🟢' : app.status === 'creating' ? '🟡' : '🔴'}
                      {' '}
                      {app.status === 'ready'
                        ? (t('apps.statusReady') || '可用')
                        : app.status === 'creating'
                          ? (t('apps.statusCreating') || '创建中')
                          : (t('apps.statusError') || '异常')}
                    </span>
                    <span className="app-card-time">{timeAgo(app.updatedAt, t)}</span>
                  </div>
                  {app.publish?.surgeUrl && (
                    <div className="app-card-published">
                      🌐 {t('apps.published') || '已发布'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
