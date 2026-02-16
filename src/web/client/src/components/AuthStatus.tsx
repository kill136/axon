/**
 * 登录状态组件
 * 显示在侧边栏底部，显示登录状态和快捷登录入口
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n';
import './AuthStatus.css';

interface AuthInfo {
  authenticated: boolean;
  type?: string;
  accountType?: string;
  email?: string;
  expiresAt?: number;
}

interface AuthStatusProps {
  onLoginClick: () => void;
  refreshKey?: number;
}

export function AuthStatus({ onLoginClick, refreshKey }: AuthStatusProps) {
  const { t } = useLanguage();
  const [authInfo, setAuthInfo] = useState<AuthInfo>({ authenticated: false });
  const [loading, setLoading] = useState(true);

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
    // 每30秒检查一次登录状态
    const interval = setInterval(checkAuthStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // 监听 refreshKey 变化，立即刷新认证状态
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      checkAuthStatus();
    }
  }, [refreshKey]);

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/auth/oauth/logout', {
        method: 'POST',
      });

      if (response.ok) {
        setAuthInfo({ authenticated: false });
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

  // 内置 API 配置不应显示为已登录
  if (authInfo.authenticated && authInfo.type !== 'builtin') {
    return (
      <div className="auth-status authenticated">
        <div className="auth-user-info">
          <div className="user-avatar">
            {authInfo.accountType === 'claude.ai' ? '🎨' : '⚡'}
          </div>
          <div className="user-details">
            <div className="user-name">
              {authInfo.email || authInfo.accountType || 'User'}
            </div>
            <div className="user-type">
              {authInfo.accountType === 'claude.ai' ? 'Claude.ai' : 'Console'}
            </div>
          </div>
        </div>
        <button className="btn-logout-small" onClick={handleLogout} title={t('auth.logout')}>
          🚪
        </button>
      </div>
    );
  }

  return (
    <div className="auth-status not-authenticated">
      <div className="auth-warning">
        <span className="warning-icon">⚠️</span>
        <span>{t('auth.notAuthenticated')}</span>
      </div>
      <button className="btn-login-small" onClick={onLoginClick}>
        {t('auth.login')}
      </button>
    </div>
  );
}
