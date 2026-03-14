/**
 * 登录状态组件
 * 显示在顶部导航栏，支持多种认证来源：
 * - OAuth (Claude.ai / Console)
 * - API Key (多 Provider)
 * - Axon Cloud（显示余额 + 充值入口）
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../i18n';
import './AuthStatus.css';

interface AuthInfo {
  authenticated: boolean;
  type?: string;       // 'oauth' | 'api_key' | 'builtin'
  accountType?: string; // 'claude.ai' | 'subscription' | 'api' | 'axon-cloud'
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

  if (loading) {
    return (
      <div className="auth-status loading">
        <div className="spinner-small"></div>
      </div>
    );
  }

  // 内置 API 配置不显示为已登录
  if (authInfo.authenticated && authInfo.type !== 'builtin') {
    // 根据认证类型选择图标和标签
    let avatar: string;
    let label: string;
    let typeLabel: string;
    const isAxonCloud = authInfo.isAxonCloud || authInfo.accountType === 'axon-cloud';

    if (authInfo.type === 'oauth') {
      avatar = authInfo.accountType === 'claude.ai' ? '🎨' : '⚡';
      label = authInfo.displayName || authInfo.email || authInfo.accountType || 'User';
      typeLabel = authInfo.accountType === 'claude.ai' ? t('auth.claudeAi') : t('auth.console');
    } else if (isAxonCloud) {
      avatar = '☁️';
      label = t('auth.status.axonCloud');
      typeLabel = 'Axon Cloud';
    } else if (authInfo.type === 'api_key') {
      avatar = '🔑';
      label = t('auth.status.apiKey');
      typeLabel = authInfo.accountType || 'API';
    } else {
      avatar = '☁️';
      label = authInfo.email || 'User';
      typeLabel = t('auth.status.axonCloud');
    }

    /** 格式化金额 */
    const formatAmount = (n: number) => n.toFixed(2);

    return (
      <div className="auth-status authenticated" ref={dropdownRef}>
        <button
          className="auth-user-trigger"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          <div className="user-avatar">{avatar}</div>
          <span className="user-name">{label}</span>
          <span className={`auth-arrow ${dropdownOpen ? 'open' : ''}`}>▼</span>
        </button>

        {dropdownOpen && (
          <div className="auth-dropdown">
            <div className="auth-dropdown-info">
              <div className="auth-dropdown-avatar">{avatar}</div>
              <div className="auth-dropdown-details">
                <div className="auth-dropdown-name">{label}</div>
                <div className="auth-dropdown-type">{typeLabel}</div>
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
                      href={`${AXON_CLOUD_DASHBOARD}/topup`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="auth-dropdown-item quota-action-btn recharge"
                    >
                      {t('axonCloud.recharge')}
                    </a>
                    <a
                      href={AXON_CLOUD_DASHBOARD}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="auth-dropdown-item quota-action-btn"
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
