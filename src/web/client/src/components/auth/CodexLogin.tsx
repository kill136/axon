import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n';
import './OAuthLogin.css';

interface CodexLoginProps {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

type CodexPhase = 'select' | 'input-callback';

export function CodexLogin({ onSuccess, onError }: CodexLoginProps) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<CodexPhase>('select');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [authId, setAuthId] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');
  const [waitingForBrowserCallback, setWaitingForBrowserCallback] = useState(false);
  const authWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!authId || !waitingForBrowserCallback) {
      return;
    }

    let cancelled = false;
    let inFlightController: AbortController | null = null;
    const startedAt = Date.now();
    const MAX_POLL_MS = 5 * 60 * 1000;

    const stopPolling = (message?: string, isError = false, notifyError = false) => {
      window.clearInterval(timer);
      setWaitingForBrowserCallback(false);
      if (message) {
        setStatusIsError(isError);
        setStatus(message);
      }
      if (notifyError && message) {
        onError?.(message);
      }
    };

    const pollStatus = async () => {
      if (cancelled) {
        return;
      }

      if (Date.now() - startedAt >= MAX_POLL_MS) {
        stopPolling(t('auth.codex.pollTimeout'), true, true);
        return;
      }

      if (authWindowRef.current && authWindowRef.current.closed) {
        authWindowRef.current = null;
        stopPolling(t('auth.codex.browserClosed'));
        return;
      }

      const controller = new AbortController();
      inFlightController = controller;
      const abortTimer = window.setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`/api/auth/oauth/codex/status/${authId}`, {
          signal: controller.signal,
        });
        const data = await response.json();

        if (!response.ok || cancelled) {
          return;
        }

        if (data.status === 'completed') {
          authWindowRef.current?.close();
          authWindowRef.current = null;
          stopPolling(t('auth.codex.success'));
          onSuccess?.();
          return;
        }

        if (data.status === 'failed') {
          const message = data.error || t('auth.codex.autoCallbackFailed');
          stopPolling(message, true, true);
        }
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          // 自动轮询失败时不打断手动粘贴流程
        }
      } finally {
        window.clearTimeout(abortTimer);
        if (inFlightController === controller) {
          inFlightController = null;
        }
      }
    };

    const timer = window.setInterval(() => {
      void pollStatus();
    }, 1200);
    void pollStatus();

    return () => {
      cancelled = true;
      inFlightController?.abort();
      authWindowRef.current = null;
      window.clearInterval(timer);
    };
  }, [authId, waitingForBrowserCallback, onError, onSuccess, t]);

  const startCodexLogin = async () => {
    const authWindow = window.open(
      '',
      'Codex ChatGPT Login',
      'width=760,height=820,left=160,top=60'
    );
    authWindowRef.current = authWindow;

    setLoading(true);
    setStatusIsError(false);
    setStatus(t('auth.codex.starting'));

    try {
      const response = await fetch('/api/auth/oauth/codex/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start Codex login');
      }

      setAuthId(data.authId);
      setAuthUrl(data.authUrl);
      setPhase('input-callback');

      if (authWindow) {
        authWindow.location.href = data.authUrl;
        authWindow.focus?.();
      }

      if (data.autoCallback) {
        setWaitingForBrowserCallback(true);
        setStatus(authWindow ? t('auth.codex.waitingBrowserCallback') : t('auth.codex.openManually'));
      } else {
        setWaitingForBrowserCallback(false);
        setStatus(authWindow ? t('auth.codex.opened') : t('auth.codex.openManually'));
      }
    } catch (error) {
      authWindowRef.current?.close();
      authWindowRef.current = null;
      setWaitingForBrowserCallback(false);
      const message = error instanceof Error ? error.message : String(error);
      setStatusIsError(true);
      setStatus(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const importLocalAuth = async () => {
    setLoading(true);
    setStatusIsError(false);
    setStatus(t('auth.codex.importing'));

    try {
      const response = await fetch('/api/auth/oauth/codex/import-local', {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to import local Codex auth');
      }
      setStatus(t('auth.codex.importSuccess'));
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusIsError(true);
      setStatus(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const submitCallbackUrl = async () => {
    if (!callbackUrl.trim()) {
      setStatusIsError(true);
      setStatus(t('auth.codex.callbackRequired'));
      return;
    }

    setLoading(true);
    setStatusIsError(false);
    setStatus(t('auth.codex.exchanging'));

    try {
      const response = await fetch('/api/auth/oauth/codex/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authId,
          callbackUrl: callbackUrl.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to complete Codex login');
      }

      authWindowRef.current?.close();
      authWindowRef.current = null;
      setWaitingForBrowserCallback(false);
      setStatus(t('auth.codex.success'));
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusIsError(true);
      setStatus(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  const copyAuthUrl = async () => {
    if (!authUrl) return;
    try {
      await navigator.clipboard.writeText(authUrl);
      setStatusIsError(false);
      setStatus(t('auth.codex.copied'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusIsError(true);
      setStatus(message);
    }
  };

  if (phase === 'select') {
    return (
      <div className="oauth-login">
        <div className="oauth-header">
          <h2>{t('auth.codex.title')}</h2>
          <p>{t('auth.codex.desc')}</p>
        </div>

        <div className="oauth-buttons">
          <button className="oauth-button claude-ai" onClick={startCodexLogin} disabled={loading}>
            <div className="button-content">
              <div className="icon">🧠</div>
              <div className="text">
                <div className="title">{t('auth.codex.openAuth')}</div>
                <div className="subtitle">{t('auth.codex.openAuthDesc')}</div>
              </div>
            </div>
          </button>

          <button className="oauth-button console" onClick={importLocalAuth} disabled={loading}>
            <div className="button-content">
              <div className="icon">📥</div>
              <div className="text">
                <div className="title">{t('auth.codex.importLocal')}</div>
                <div className="subtitle">{t('auth.codex.importLocalDesc')}</div>
              </div>
            </div>
          </button>
        </div>

        {status && (
          <div className={`oauth-status ${loading || waitingForBrowserCallback ? 'loading' : statusIsError ? 'error' : ''}`}>
            {(loading || waitingForBrowserCallback) && <div className="spinner"></div>}
            <span>{status}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="oauth-login">
      <div className="oauth-header">
        <h2>{t('auth.codex.callbackTitle')}</h2>
        <p>{t('auth.codex.callbackDesc')}</p>
      </div>

      <div className="oauth-code-section">
        {waitingForBrowserCallback && (
          <div className="oauth-instructions" style={{ marginBottom: 16 }}>
            <div className="instruction-step">
              <span className="step-number">A</span>
              <span>{t('auth.codex.autoCallbackWaiting')}</span>
            </div>
          </div>
        )}

        <div className="oauth-instructions">
          <div className="instruction-step">
            <span className="step-number">1</span>
            <span>{t('auth.codex.step1')}</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">2</span>
            <span>{t('auth.codex.step2')}</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">3</span>
            <span>{t('auth.codex.step3')}</span>
          </div>
          <div className="instruction-step">
            <span className="step-number">4</span>
            <span>{t('auth.codex.step4')}</span>
          </div>
        </div>

        <div className="auth-actions" style={{ justifyContent: 'flex-start' }}>
          <button className="auth-btn-secondary" onClick={() => window.open(authUrl, '_blank')} disabled={!authUrl || loading}>
            {t('auth.codex.openAuth')}
          </button>
          <button className="auth-btn-secondary" onClick={copyAuthUrl} disabled={!authUrl || loading}>
            {t('auth.codex.copyAuth')}
          </button>
        </div>

        <div className="code-input-group">
          <input
            type="text"
            className="code-input"
            placeholder={t('auth.codex.callbackPlaceholder')}
            value={callbackUrl}
            onChange={(e) => setCallbackUrl(e.target.value)}
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && callbackUrl.trim()) {
                submitCallbackUrl();
              }
            }}
          />
          <button className="submit-button" onClick={submitCallbackUrl} disabled={loading || !callbackUrl.trim()}>
            {loading ? t('auth.codex.submitting') : t('auth.codex.submit')}
          </button>
        </div>

        {status && (
          <div className={`oauth-status ${loading || waitingForBrowserCallback ? 'loading' : statusIsError ? 'error' : ''}`}>
            {(loading || waitingForBrowserCallback) && <div className="spinner"></div>}
            <span>{status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
