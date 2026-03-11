/**
 * 登录状态组件
 * 显示在顶部导航栏，支持多种认证来源：
 * - OAuth (Claude.ai / Console)
 * - API Key (多 Provider)
 * - Axon Cloud
 */

import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../i18n';
import './AuthStatus.css';

interface AuthInfo {
  authenticated: boolean;
  type?: string;       // 'oauth' | 'api_key' | 'builtin'
  accountType?: string; // 'claude.ai' | 'subscription' | 'api' | etc.
  email?: string;
  displayName?: string;
  expiresAt?: number;
  isDemoMode?: boolean;
}

interface AuthStatusProps {
  onLoginClick: () => void;
  refreshKey?: number;
}

export function AuthStatus({ onLoginClick, refreshKey }: AuthStatusProps) {
  const { t } = useLanguage();
  const [authInfo, setAuthInfo] = useState<AuthInfo>({ authenticated: false });
  const [loading, setLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    checkAuthStatus();
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      checkAuthStatus();
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

    if (authInfo.type === 'oauth') {
      avatar = authInfo.accountType === 'claude.ai' ? '🎨' : '⚡';
      label = authInfo.displayName || authInfo.email || authInfo.accountType || 'User';
      typeLabel = authInfo.accountType === 'claude.ai' ? t('auth.claudeAi') : t('auth.console');
    } else if (authInfo.type === 'api_key') {
      avatar = '🔑';
      label = t('auth.status.apiKey');
      typeLabel = authInfo.accountType || 'API';
    } else {
      avatar = '☁️';
      label = authInfo.email || 'User';
      typeLabel = t('auth.status.axonCloud');
    }

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
