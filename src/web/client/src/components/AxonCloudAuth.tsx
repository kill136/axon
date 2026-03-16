/**
 * Axon Cloud 认证组件
 * 提供注册和登录功能，成功后自动配置 API
 */

import { useState } from 'react';
import { useLanguage } from '../i18n';

export interface AxonCloudAuthProps {
  onSuccess?: (data: { username: string; quota: number }) => void;
  onError?: (error: string) => void;
}

type AuthTab = 'login' | 'register';

/**
 * 将后端返回的英文错误信息翻译为本地化文本
 */
function translateServerError(error: string, t: (key: string) => string): string {
  const msg = error.toLowerCase();

  // Go validator 格式: "Field validation for 'X' failed on the 'Y' tag"
  if (msg.includes('field validation') && msg.includes("failed on the")) {
    if (msg.includes('password') && msg.includes("'min'")) {
      return t('axonCloud.error.passwordTooShort');
    }
    if (msg.includes('username') && msg.includes("'min'")) {
      return t('axonCloud.error.usernameTooShort');
    }
    if (msg.includes('email')) {
      return t('axonCloud.error.emailInvalid');
    }
    // 其他 validator 错误，使用通用文案
    return t('axonCloud.error.serverValidation');
  }

  // 常见业务错误
  if (msg.includes('already exist') && msg.includes('user')) {
    return t('axonCloud.error.usernameExists');
  }
  if (msg.includes('already exist') && msg.includes('email')) {
    return t('axonCloud.error.emailExists');
  }
  if (msg.includes('already') && (msg.includes('registered') || msg.includes('taken'))) {
    if (msg.includes('email')) return t('axonCloud.error.emailExists');
    return t('axonCloud.error.usernameExists');
  }
  if (msg.includes('invalid') && (msg.includes('credential') || msg.includes('password'))) {
    return t('axonCloud.error.invalidCredentials');
  }
  if (msg.includes('not found') && msg.includes('user')) {
    return t('axonCloud.error.invalidCredentials');
  }

  // 网络类错误
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused') || msg.includes('timeout')) {
    return t('axonCloud.error.networkError');
  }

  // "Invalid input" 前缀的通用验证错误
  if (msg.includes('invalid input')) {
    return t('axonCloud.error.serverValidation');
  }

  // 无法识别，返回原文
  return error;
}

export function AxonCloudAuth({ onSuccess, onError }: AxonCloudAuthProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusType, setStatusType] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  // 登录表单
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // 注册表单
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');

  /**
   * 验证邮箱格式
   */
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  /**
   * 处理登录
   */
  const handleLogin = async () => {
    // 验证
    if (!loginUsername.trim()) {
      setStatusType('error');
      setStatus(t('axonCloud.error.usernameRequired'));
      return;
    }
    if (!loginPassword.trim()) {
      setStatusType('error');
      setStatus(t('axonCloud.error.passwordRequired'));
      return;
    }

    setLoading(true);
    setStatusType('loading');
    setStatus(t('axonCloud.loggingIn'));

    try {
      const response = await fetch('/api/axon-cloud/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
      }

      setStatusType('success');
      setStatus(t('axonCloud.loginSuccess'));
      setLoading(false);

      // 成功回调
      onSuccess?.({
        username: data.username,
        quota: data.quota || 0,
      });
    } catch (error) {
      setLoading(false);
      setStatusType('error');
      const rawMsg = error instanceof Error ? error.message : String(error);
      const errorMsg = translateServerError(rawMsg, t);
      setStatus(errorMsg);
      onError?.(errorMsg);
    }
  };

  /**
   * 处理注册
   */
  const handleRegister = async () => {
    // 验证
    if (!registerUsername.trim()) {
      setStatusType('error');
      setStatus(t('axonCloud.error.usernameRequired'));
      return;
    }
    if (!registerEmail.trim()) {
      setStatusType('error');
      setStatus(t('axonCloud.error.emailRequired'));
      return;
    }
    if (!validateEmail(registerEmail)) {
      setStatusType('error');
      setStatus(t('axonCloud.error.emailInvalid'));
      return;
    }
    if (!registerPassword.trim()) {
      setStatusType('error');
      setStatus(t('axonCloud.error.passwordRequired'));
      return;
    }
    if (registerPassword.length < 6) {
      setStatusType('error');
      setStatus(t('axonCloud.error.passwordTooShort'));
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setStatusType('error');
      setStatus(t('axonCloud.error.passwordMismatch'));
      return;
    }

    setLoading(true);
    setStatusType('loading');
    setStatus(t('axonCloud.registering'));

    try {
      const response = await fetch('/api/axon-cloud/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: registerUsername.trim(),
          email: registerEmail.trim(),
          password: registerPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Registration failed');
      }

      setStatusType('success');
      setStatus(t('axonCloud.registerSuccess'));
      setLoading(false);

      // 成功回调
      onSuccess?.({
        username: data.username,
        quota: data.quota || 0,
      });
    } catch (error) {
      setLoading(false);
      setStatusType('error');
      const rawMsg = error instanceof Error ? error.message : String(error);
      const errorMsg = translateServerError(rawMsg, t);
      setStatus(errorMsg);
      onError?.(errorMsg);
    }
  };

  /**
   * Tab 切换
   */
  const handleTabChange = (tab: AuthTab) => {
    setActiveTab(tab);
    setStatus('');
    setStatusType('idle');
  };

  return (
    <div className="axon-cloud-auth">
      {/* Tab 切换 */}
      <div className="axon-cloud-tabs">
        <button
          className={`axon-cloud-tab ${activeTab === 'login' ? 'active' : ''}`}
          onClick={() => handleTabChange('login')}
          disabled={loading}
        >
          {t('axonCloud.login')}
        </button>
        <button
          className={`axon-cloud-tab ${activeTab === 'register' ? 'active' : ''}`}
          onClick={() => handleTabChange('register')}
          disabled={loading}
        >
          {t('axonCloud.register')}
        </button>
      </div>

      {/* 登录表单 */}
      {activeTab === 'login' && (
        <div className="axon-cloud-form">
          <div className="axon-cloud-field">
            <label>{t('axonCloud.username')}</label>
            <input
              type="text"
              className="axon-cloud-input"
              placeholder={t('axonCloud.username')}
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  handleLogin();
                }
              }}
            />
          </div>

          <div className="axon-cloud-field">
            <label>{t('axonCloud.password')}</label>
            <input
              type="password"
              className="axon-cloud-input"
              placeholder={t('axonCloud.password')}
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  handleLogin();
                }
              }}
            />
          </div>

          <button
            className="axon-cloud-btn"
            onClick={handleLogin}
            disabled={loading || !loginUsername.trim() || !loginPassword.trim()}
          >
            {loading ? t('axonCloud.loggingIn') : t('axonCloud.loginBtn')}
          </button>
        </div>
      )}

      {/* 注册表单 */}
      {activeTab === 'register' && (
        <div className="axon-cloud-form">
          <div className="axon-cloud-field">
            <label>{t('axonCloud.username')}</label>
            <input
              type="text"
              className="axon-cloud-input"
              placeholder={t('axonCloud.username')}
              value={registerUsername}
              onChange={(e) => setRegisterUsername(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="axon-cloud-field">
            <label>{t('axonCloud.email')}</label>
            <input
              type="email"
              className="axon-cloud-input"
              placeholder={t('axonCloud.email')}
              value={registerEmail}
              onChange={(e) => setRegisterEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="axon-cloud-field">
            <label>{t('axonCloud.password')}</label>
            <input
              type="password"
              className="axon-cloud-input"
              placeholder={t('axonCloud.password')}
              value={registerPassword}
              onChange={(e) => setRegisterPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="axon-cloud-field">
            <label>{t('axonCloud.confirmPassword')}</label>
            <input
              type="password"
              className="axon-cloud-input"
              placeholder={t('axonCloud.confirmPassword')}
              value={registerConfirmPassword}
              onChange={(e) => setRegisterConfirmPassword(e.target.value)}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) {
                  handleRegister();
                }
              }}
            />
          </div>

          <button
            className="axon-cloud-btn"
            onClick={handleRegister}
            disabled={
              loading ||
              !registerUsername.trim() ||
              !registerEmail.trim() ||
              !registerPassword.trim() ||
              !registerConfirmPassword.trim()
            }
          >
            {loading ? t('axonCloud.registering') : t('axonCloud.registerBtn')}
          </button>
        </div>
      )}

      {/* 状态显示 */}
      {status && statusType !== 'idle' && (
        <div className={`axon-cloud-status ${statusType}`}>
          {status}
        </div>
      )}
    </div>
  );
}
