/**
 * 登录状态组件
 * 显示在顶部导航栏，支持多种认证来源：
 * - OAuth (Claude.ai / Console)
 * - API Key (多 Provider)
 * - Axon Cloud（显示余额 + 充值入口）
 */

import { useState, useEffect, useRef, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { useLanguage } from '../i18n';
import './AuthStatus.css';
import { type WebRuntimeBackend } from '../../../shared/model-catalog';
import { summarizeAuthStatus } from '../../../shared/auth-summary';

interface AuthInfo {
  authenticated: boolean;
  type?: string;       // 'oauth' | 'api_key' | 'builtin'
  accountType?: string; // 'claude.ai' | 'subscription' | 'api' | 'axon-cloud'
  provider?: string;
  runtimeBackend?: WebRuntimeBackend;
  email?: string;
  displayName?: string;
  expiresAt?: number;
  isDemoMode?: boolean;
  isAxonCloud?: boolean;
}

interface QuotaInfo {
  total: number;
  used: number;
  remaining: number;
}

interface AuthStatusProps {
  onLoginClick: () => void;
  refreshKey?: number;
}

const AXON_CLOUD_DASHBOARD = 'https://api.chatbi.site/console';
const AXON_CLOUD_TOPUP_PATH = '/api/axon-cloud/topup';

interface ElectronBridge {
  openExternal?: (url: string) => Promise<void>;
}

function getElectronBridge(): ElectronBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as any).electronAPI ?? null;
}

export function AuthStatus({ onLoginClick, refreshKey }: AuthStatusProps) {
  const { t } = useLanguage();
  const [authInfo, setAuthInfo] = useState<AuthInfo>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Axon Cloud 余额
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState(false);

  const checkAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/oauth/status');
      if (response.ok) {
        const data = await response.json();
        setAuthInfo(data);
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuota = useCallback(async () => {
    setQuotaLoading(true);
    setQuotaError(false);
    try {
      const res = await fetch('/api/axon-cloud/quota');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setQuota({ total: data.total, used: data.used, remaining: data.remaining });
        } else {
          setQuotaError(true);
        }
      } else {
        setQuotaError(true);
      }
    } catch {
      setQuotaError(true);
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Axon Cloud 用户打开下拉时查询余额
  useEffect(() => {
    if (dropdownOpen && authInfo.isAxonCloud && !quota && !quotaLoading) {
      fetchQuota();
    }
  }, [dropdownOpen, authInfo.isAxonCloud, quota, quotaLoading, fetchQuota]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      checkAuthStatus();
      setQuota(null); // 刷新后清除缓存的余额
    }
  }, [refreshKey]);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/oauth/logout', { method: 'POST' });
      if (response.ok) {
        setAuthInfo({ authenticated: false });
        setDropdownOpen(false);
        setQuota(null);
      }
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  const handleExternalLinkClick = async (
    event: ReactMouseEvent<HTMLAnchorElement>,
    url: string,
  ) => {
    const electronBridge = getElectronBridge();
    if (!electronBridge?.openExternal) {
      return;
    }

    event.preventDefault();

    try {
      await electronBridge.openExternal(url);
      setDropdownOpen(false);
    } catch (error) {
      console.error('Failed to open external link:', error);
    }
  };

  const handleRechargeClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    void handleExternalLinkClick(event, new URL(AXON_CLOUD_TOPUP_PATH, window.location.origin).toString());
  };

  const handleDashboardClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    void handleExternalLinkClick(event, AXON_CLOUD_DASHBOARD);
  };

  if (loading) {
    return (
      <div className="auth-status loading">
        <div className="spinner-small"></div>
      </div>
    );
  }

  // 内置 API 配置不显示为已登录
  if (authInfo.authenticated && authInfo.type !== 'builtin') {
    const isAxonCloud = authInfo.isAxonCloud || authInfo.accountType === 'axon-cloud';
    const summary = summarizeAuthStatus(authInfo, {
      claudeAi: t('auth.claudeAi'),
      console: t('auth.console'),
      apiKey: t('auth.status.apiKey'),
      axonCloud: t('auth.status.axonCloud'),
      chatgpt: 'ChatGPT / Codex',
      userFallback: 'User',
    });

    /** 格式化金额 */
    const formatAmount = (n: number) => n.toFixed(2);

    return (
      <div className="auth-status authenticated" ref={dropdownRef}>
        <button
          className="auth-user-trigger"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <div className="user-avatar">{summary.avatar}</div>
          <span className="user-name">{summary.triggerLabel}</span>
          <span className={`auth-arrow ${dropdownOpen ? 'open' : ''}`}>▼</span>
        </button>

        {dropdownOpen && (
          <div className="auth-dropdown">
            <div className="auth-dropdown-info">
              <div className="auth-dropdown-avatar">{summary.avatar}</div>
              <div className="auth-dropdown-details">
                <div className="auth-dropdown-name">{summary.triggerLabel}</div>
                <div className="auth-dropdown-type">{summary.runtimeLabel}</div>
              </div>
            </div>

            <div className="auth-dropdown-divider" />
            <div className="auth-dropdown-meta">
              <div className="auth-dropdown-meta-row">
                <span className="auth-dropdown-meta-label">{t('auth.status.account')}</span>
                <span className="auth-dropdown-meta-value">{summary.accountLabel}</span>
              </div>
              <div className="auth-dropdown-meta-row">
                <span className="auth-dropdown-meta-label">{t('auth.status.identity')}</span>
                <span className="auth-dropdown-meta-value">{summary.accountDetail}</span>
              </div>
              <div className="auth-dropdown-meta-row">
                <span className="auth-dropdown-meta-label">{t('auth.status.runtime')}</span>
                <span className="auth-dropdown-meta-value">{summary.runtimeLabel}</span>
              </div>
            </div>

            {/* Axon Cloud 余额区域 */}
            {isAxonCloud && (
              <>
                <div className="auth-dropdown-divider" />
                <div className="auth-dropdown-quota">
                  {quotaLoading && (
                    <div className="quota-loading">{t('axonCloud.quota.loading')}</div>
                  )}
                  {quotaError && !quotaLoading && (
                    <div className="quota-error">
                      {t('axonCloud.quota.error')}
                      <button className="quota-retry" onClick={fetchQuota}>↻</button>
                    </div>
                  )}
                  {quota && !quotaLoading && (
                    <div className="quota-info">
                      <div className="quota-bar-wrapper">
                        <div className="quota-bar">
                          <div
                            className="quota-bar-fill"
                            style={{ width: `${quota.total > 0 ? Math.min((quota.used / quota.total) * 100, 100) : 0}%` }}
                          />
                        </div>
                        <div className="quota-numbers">
                          <span className="quota-remaining">${formatAmount(quota.remaining)}</span>
                          <span className="quota-total">/ ${formatAmount(quota.total)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="quota-actions">
                    <a
                      href={AXON_CLOUD_TOPUP_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="auth-dropdown-item quota-action-btn recharge"
                      onClick={handleRechargeClick}
                    >
                      {t('axonCloud.recharge')}
                    </a>
                    <a
                      href={AXON_CLOUD_DASHBOARD}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="auth-dropdown-item quota-action-btn"
                      onClick={handleDashboardClick}
                    >
                      {t('axonCloud.manage')}
                    </a>
                  </div>
                </div>
              </>
            )}

            <div className="auth-dropdown-divider" />
            <button className="auth-dropdown-item" onClick={() => { setDropdownOpen(false); onLoginClick(); }}>
              {t('auth.switchAccount')}
            </button>
            <button className="auth-dropdown-item danger" onClick={handleLogout}>
              {t('auth.logout')}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="auth-status not-authenticated">
      <button className="btn-login-small" onClick={onLoginClick}>
        {t('auth.login')}
      </button>
    </div>
  );
}
