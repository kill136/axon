/**
 * OAuth 登录组件
 * 支持 Claude.ai 和 Console 两种认证方式
 *
 * 流程：
 * 1. 用户点击登录按钮
 * 2. 打开官方授权页面
 * 3. 用户在官方页面完成授权
 * 4. 官方页面显示授权码
 * 5. 用户复制授权码并粘贴到本组件的输入框
 * 6. 提交授权码完成登录
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import './OAuthLogin.css';

export type AccountType = 'claude.ai' | 'console';

export interface OAuthLoginProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

type LoginPhase = 'select' | 'authorize' | 'input-code';

export function OAuthLogin({ onSuccess, onError }: OAuthLoginProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [phase, setPhase] = useState<LoginPhase>('select');
  const [authId, setAuthId] = useState<string>('');
  const [authCode, setAuthCode] = useState<string>('');
  const [selectedAccountType, setSelectedAccountType] = useState<AccountType | null>(null);
  const [authUrl, setAuthUrl] = useState<string>('');

  /**
   * 启动 OAuth 登录流程
   */
  const handleOAuthLogin = async (accountType: AccountType) => {
    setLoading(true);
    setSelectedAccountType(accountType);
    setStatusIsError(false);
    setStatus(t('auth.oauth.starting', { accountType }));

    try {
      // 1. 请求后端生成授权 URL
      const response = await fetch('/api/auth/oauth/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountType }),
      });

      if (!response.ok) {
        throw new Error(t('auth.oauth.startFailed', { error: response.statusText }));
      }

      const data = await response.json();
      const { authUrl, authId: newAuthId } = data;

      setAuthId(newAuthId);

      // 2. 打开授权页面（新窗口）
      setStatus(t('auth.oauth.openingAuth'));
      const authWindow = window.open(
        authUrl,
        'Claude OAuth',
        'width=600,height=700,left=200,top=100'
      );

      if (!authWindow) {
        // 如果弹窗被阻止，提供手动打开链接的方式
        setStatus(t('auth.oauth.clickToAuth'));
        setPhase('authorize');
        // 存储 authUrl 供用户手动点击
        setAuthUrl(authUrl);
        setLoading(false);
        return;
      }

      // 3. 切换到输入授权码阶段
      setPhase('input-code');
      setStatus(t('auth.oauth.copyCodeHint'));
      setLoading(false);
    } catch (error) {
      setLoading(false);
      setStatusIsError(true);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setStatus(t('auth.oauth.error', { error: errorMsg }));
      onError?.(errorMsg);
    }
  };

  /**
   * 提交授权码
   */
  const handleSubmitCode = async () => {
    if (!authCode.trim()) {
      setStatusIsError(true);
      setStatus(t('auth.oauth.pleaseEnterCode'));
      return;
    }

    setLoading(true);
    setStatusIsError(false);
    setStatus(t('auth.oauth.exchanging'));

    try {
      const response = await fetch('/api/auth/oauth/submit-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authId,
          code: authCode.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t('auth.oauth.exchangeFailed'));
      }

      setStatus(t('auth.oauth.success'));
      setLoading(false);
      onSuccess?.();
    } catch (error) {
      setLoading(false);
      setStatusIsError(true);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setStatus(t('auth.oauth.error', { error: errorMsg }));
      onError?.(errorMsg);
    }
  };

  /**
   * 返回选择阶段
   */
  const handleBack = () => {
    setPhase('select');
    setAuthId('');
    setAuthCode('');
    setAuthUrl('');
    setStatus('');
    setStatusIsError(false);
    setSelectedAccountType(null);
  };

  /**
   * 手动打开授权链接
   */
  const handleOpenAuthUrl = () => {
    if (authUrl) {
      window.open(authUrl, '_blank');
      setPhase('input-code');
      setStatus(t('auth.oauth.copyCodeHint'));
    }
  };

  // 渲染选择账户类型阶段
  if (phase === 'select') {
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <h2>{t('auth.oauth.title')}</h2>
          <p>{t('auth.oauth.selectMethod')}</p>
        </div>

        <div className="oauth-buttons">
          <button
            className="oauth-button claude-ai"
            onClick={() => handleOAuthLogin('claude.ai')}
            disabled={loading}
          >
            <div className="button-content">
              <div className="icon">🔐</div>
              <div className="text">
                <div className="title">{t('auth.oauth.claudeAi')}</div>
                <div className="subtitle">{t('auth.oauth.claudeAiDesc')}</div>
              </div>
            </div>
          </button>

          <button
            className="oauth-button console"
            onClick={() => handleOAuthLogin('console')}
            disabled={loading}
          >
            <div className="button-content">
              <div className="icon">🔑</div>
              <div className="text">
                <div className="title">{t('auth.oauth.console')}</div>
                <div className="subtitle">{t('auth.oauth.consoleDesc')}</div>
              </div>
            </div>
          </button>
        </div>

        {status && (
          <div className={`oauth-status ${loading ? 'loading' : ''}`}>
            {loading && <div className="spinner"></div>}
            <span>{status}</span>
          </div>
        )}

        <div className="oauth-footer">
          <p>
            {t('auth.oauth.noAccount')}{' '}
            <a href="https://claude.ai" target="_blank" rel="noopener noreferrer">
              {t('auth.oauth.signUpClaudeAi')}
            </a>
          </p>
          <p>
            {t('auth.oauth.needApiKey')}{' '}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">
              {t('auth.oauth.getFromConsole')}
            </a>
          </p>
        </div>
      </div>
    );
  }

  // 渲染手动打开链接阶段（弹窗被阻止时）
  if (phase === 'authorize') {
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <h2>{t('auth.oauth.authRequired')}</h2>
          <p>{t('auth.oauth.popupBlocked')}</p>
        </div>

        <div className="oauth-code-section">
          <button
            className="oauth-button primary"
            onClick={handleOpenAuthUrl}
          >
            <div className="button-content">
              <div className="icon">🔗</div>
              <div className="text">
                <div className="title">{t('auth.oauth.openAuthPage')}</div>
              </div>
            </div>
          </button>
        </div>

        <div className="oauth-back">
          <button className="back-button" onClick={handleBack}>
            {t('auth.oauth.backToLogin')}
          </button>
        </div>
      </div>
    );
  }

  // 渲染输入授权码阶段
  return (
    <div className="oauth-login">
      <div className="oauth-header">
        <h2>{t('auth.oauth.enterCode')}</h2>
        <p>{t('auth.oauth.enterCodeDesc')}</p>
      </div>

      <div className="oauth-code-section">
        <div className="oauth-instructions">
          <div className="instruction-step">
            <span className="step-number">1</span>
            <span>{t('auth.oauth.step1')}</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">2</span>
            <span>{t('auth.oauth.step2')}</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">3</span>
            <span>{t('auth.oauth.step3')}</span>
          </div>
        </div>

        <div className="code-input-group">
          <input
            type="text"
            className="code-input"
            placeholder={t('auth.oauth.codePlaceholder')}
            value={authCode}
            onChange={(e) => setAuthCode(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && authCode.trim()) {
                handleSubmitCode();
              }
            }}
          />
          <button
            className="submit-button"
            onClick={handleSubmitCode}
            disabled={loading || !authCode.trim()}
          >
            {loading ? t('auth.oauth.submitting') : t('auth.oauth.submit')}
          </button>
        </div>

        {status && (
          <div className={`oauth-status ${loading ? 'loading' : statusIsError ? 'error' : ''}`}>
            {loading && <div className="spinner"></div>}
            <span>{status}</span>
          </div>
        )}
      </div>

      <div className="oauth-back">
        <button className="back-button" onClick={handleBack} disabled={loading}>
          {t('auth.oauth.backToLogin')}
        </button>
      </div>
    </div>
  );
}
