/**
 * 登录对话框组件
 * 三种登录方式：Axon Cloud / Anthropic OAuth / API Key (多 Provider)
 * 与 SetupWizard 的登录能力对齐
 */

import { useEffect, useState } from 'react';
import { OAuthLogin } from './auth/OAuthLogin';
import { CodexLogin } from './auth/CodexLogin';
import { AxonCloudAuth } from './AxonCloudAuth';
import { useLanguage } from '../i18n';
import './AuthDialog.css';
import type { WebRuntimeBackend } from '../../../shared/model-catalog';
import { getRuntimeBackendLabel } from '../../../shared/model-catalog';
import {
  buildRuntimeBackendConfigPayload,
  getGroupedSetupRuntimeOptions,
  getRuntimeBackendAuthSpec,
} from '../../../shared/setup-runtime';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type AuthTab = WebRuntimeBackend;

export function AuthDialog({ isOpen, onClose, onSuccess }: AuthDialogProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<AuthTab>('axon-cloud');
  const [currentRuntimeBackend, setCurrentRuntimeBackend] = useState<WebRuntimeBackend>('claude-compatible-api');

  // API Key tab state
  const [selectedProvider, setSelectedProvider] = useState('anthropic');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const runtimeGroups = getGroupedSetupRuntimeOptions();
  const activeAuthSpec = getRuntimeBackendAuthSpec(activeTab);

  const handleSuccess = () => {
    onSuccess?.();
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleTabChange = (tab: AuthTab) => {
    setActiveTab(tab);
    setError(null);
    setTestResult('idle');
    const firstProviderId = getRuntimeBackendAuthSpec(tab).providerOptions[0]?.id;
    if (firstProviderId) {
      setSelectedProvider(firstProviderId);
    }
  };

  const providerChoices = activeAuthSpec.providerOptions;
  const provider = providerChoices.find(p => p.id === selectedProvider) || providerChoices[0];
  const isApiBackend = activeAuthSpec.authMode === 'api-key';
  const canTestConnection = activeAuthSpec.testConnection;
  const activeBackendMeta = runtimeGroups
    .flatMap(group => group.items)
    .find(item => item.backend === activeTab) || runtimeGroups[0].items[0];
  const runtimeDescriptions: Record<WebRuntimeBackend, string> = {
    'axon-cloud': t('auth.runtime.axonCloudDesc'),
    'claude-subscription': t('auth.runtime.claudeSubscriptionDesc'),
    'codex-subscription': t('auth.runtime.codexSubscriptionDesc'),
    'claude-compatible-api': t('auth.runtime.claudeCompatibleApiDesc'),
    'openai-compatible-api': t('auth.runtime.openaiCompatibleApiDesc'),
  };

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadAuthStatus = async () => {
      try {
        const response = await fetch('/api/auth/oauth/status');
        if (!response.ok || cancelled) {
          return;
        }

        const data = await response.json();
        if (!cancelled) {
          const backend = (data.runtimeBackend || 'claude-compatible-api') as WebRuntimeBackend;
          setCurrentRuntimeBackend(backend);
          setActiveTab(backend);
        }
      } catch {
        if (!cancelled) {
          setCurrentRuntimeBackend('claude-compatible-api');
        }
      }
    };

    void loadAuthStatus();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // API Key - 测试连接
  const handleTestConnection = async () => {
    if (!canTestConnection) {
      return;
    }
    setTestResult('testing');
    setError(null);
    try {
      const payload: any = {
        apiKey,
        runtimeBackend: activeTab,
        apiProvider: activeAuthSpec.apiProvider,
      };
      if (apiBaseUrl) {
        payload.apiBaseUrl = apiBaseUrl;
      } else if (provider.defaultBaseUrl) {
        payload.apiBaseUrl = provider.defaultBaseUrl;
      }
      const response = await fetch('/api/config/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (data.success) {
        setTestResult('success');
      } else {
        setTestResult('error');
        setError(data.error || t('auth.provider.testFailed'));
      }
    } catch (err) {
      setTestResult('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // API Key - 保存并登录
  const handleSaveApiKey = async () => {
    if (
      currentRuntimeBackend === 'codex-subscription' &&
      !window.confirm(t('auth.provider.leaveCodexConfirm'))
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = buildRuntimeBackendConfigPayload(activeTab, {
        apiKey,
        apiBaseUrl: apiBaseUrl || provider.defaultBaseUrl || undefined,
      });

      const response = await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Save failed');
        setSaving(false);
        return;
      }

      setCurrentRuntimeBackend(activeTab);
      handleSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-dialog-backdrop" onClick={handleBackdropClick}>
      <div className="auth-dialog">
        <div className="auth-dialog-header">
          <h2>{t('auth.title')}</h2>
          <button className="close-btn" onClick={onClose} title={t('auth.close')}>
            ✕
          </button>
        </div>

        <div className="auth-dialog-body">
          <aside className="auth-dialog-sidebar">
            {runtimeGroups.map(group => (
              <section key={group.id} className="auth-sidebar-group">
                <div className="auth-sidebar-group-header">
                  <div className="auth-sidebar-group-title">
                    {group.id === 'managed' ? t('auth.layout.managedTitle') : t('auth.layout.apiTitle')}
                  </div>
                  <div className="auth-sidebar-group-desc">
                    {group.id === 'managed' ? t('auth.layout.managedDesc') : t('auth.layout.apiDesc')}
                  </div>
                </div>
                <div className="auth-sidebar-list">
                  {group.items.map(option => {
                    const backend = option.backend;
                    const isActive = activeTab === backend;
                    const isCurrent = currentRuntimeBackend === backend;
                    return (
                      <button
                        key={backend}
                        className={`auth-sidebar-card ${isActive ? 'active' : ''} ${isCurrent ? 'current' : ''}`}
                        onClick={() => handleTabChange(backend)}
                        title={getRuntimeBackendLabel(backend)}
                      >
                        <div className="auth-sidebar-card-top">
                          <div className="auth-sidebar-card-title-wrap">
                            <span className="tab-icon">{option.icon}</span>
                            <span className="tab-label">{getRuntimeBackendLabel(backend)}</span>
                          </div>
                          {isCurrent && (
                            <span className="auth-sidebar-card-badge">{t('auth.layout.currentBadge')}</span>
                          )}
                        </div>
                        <div className="auth-sidebar-card-desc">{runtimeDescriptions[backend]}</div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </aside>

          <div className="auth-dialog-main">
            <div className="auth-pane-hero">
              <div className="auth-pane-hero-icon">{activeBackendMeta.icon}</div>
              <div className="auth-pane-hero-copy">
                <div className="auth-pane-hero-title">{getRuntimeBackendLabel(activeTab)}</div>
                <p className="auth-panel-desc">{runtimeDescriptions[activeTab]}</p>
              </div>
            </div>

            <div className="auth-dialog-content">
              {/* Axon Cloud Tab */}
              {activeTab === 'axon-cloud' && (
                <div className="auth-dialog-panel">
                  <AxonCloudAuth
                    onSuccess={() => handleSuccess()}
                    onError={(err) => setError(err)}
                  />
                </div>
              )}

              {/* Anthropic OAuth Tab */}
              {activeTab === 'claude-subscription' && (
                <div className="auth-dialog-panel">
                  {error && <div className="auth-error">{error}</div>}
                  <OAuthLogin onSuccess={handleSuccess} onError={(err) => setError(err)} />
                </div>
              )}

              {activeTab === 'codex-subscription' && (
                <div className="auth-dialog-panel">
                  {error && <div className="auth-error">{error}</div>}
                  <CodexLogin onSuccess={handleSuccess} onError={(err) => setError(err)} />
                </div>
              )}

              {/* API Key Tab (Multi-Provider) */}
              {isApiBackend && (
                <div className="auth-dialog-panel">
                  {currentRuntimeBackend === 'codex-subscription' && (
                    <div className="auth-hint auth-inline-hint">
                      {t('auth.provider.leaveCodexHint')}
                    </div>
                  )}

                  {/* Provider 选择 */}
                  {providerChoices.length > 1 && (
                    <div className="auth-provider-grid">
                      {providerChoices.map(p => (
                        <button
                          key={p.id}
                          className={`auth-provider-chip ${selectedProvider === p.id ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedProvider(p.id);
                            setApiBaseUrl('');
                            setTestResult('idle');
                            setError(null);
                          }}
                        >
                          <span>{p.icon}</span>
                          <span>{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {providerChoices.length === 1 && (
                    <div className="auth-hint">{t('auth.provider.currentBackend', { backend: getRuntimeBackendLabel(activeTab) })}</div>
                  )}

                  {/* API Base URL */}
                  <div className="auth-field">
                    <label>{t('auth.provider.baseUrl')}</label>
                    <input
                      type="text"
                      value={apiBaseUrl}
                      onChange={e => { setApiBaseUrl(e.target.value); setTestResult('idle'); }}
                      placeholder={provider.defaultBaseUrl || 'https://your-api-endpoint.com/v1'}
                      className="auth-input"
                    />
                    <span className="auth-hint">{t('auth.provider.baseUrlHint')}</span>
                  </div>

                  {/* API Key */}
                  <div className="auth-field">
                    <label>{t('auth.provider.apiKey')}</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={e => { setApiKey(e.target.value); setTestResult('idle'); setError(null); }}
                      placeholder="sk-..."
                      className="auth-input"
                    />
                  </div>

                  {error && <div className="auth-error">{error}</div>}
                  {testResult === 'success' && (
                    <div className="auth-success">{t('auth.provider.testSuccess')}</div>
                  )}

                  {!canTestConnection && (
                    <div className="auth-hint">{t('auth.provider.testUnsupported')}</div>
                  )}

                  <div className="auth-actions">
                    {canTestConnection && (
                      <button
                        className="auth-btn-secondary"
                        onClick={handleTestConnection}
                        disabled={!apiKey || testResult === 'testing'}
                      >
                        {testResult === 'testing' ? t('auth.provider.testing') : t('auth.provider.testConnection')}
                      </button>
                    )}
                    <button
                      className="auth-btn-primary"
                      onClick={handleSaveApiKey}
                      disabled={saving || !apiKey}
                    >
                      {saving ? t('auth.provider.saving') : t('auth.provider.saveAndLogin')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
