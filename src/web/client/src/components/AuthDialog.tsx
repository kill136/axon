/**
 * 登录对话框组件
 * 三种登录方式：Axon Cloud / Anthropic OAuth / API Key (多 Provider)
 * 与 SetupWizard 的登录能力对齐
 */

import { useState } from 'react';
import { OAuthLogin } from './auth/OAuthLogin';
import { AxonCloudAuth } from './AxonCloudAuth';
import { useLanguage } from '../i18n';
import './AuthDialog.css';

interface AuthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type AuthTab = 'axon-cloud' | 'anthropic' | 'api-key';

interface ProviderOption {
  id: string;
  name: string;
  icon: string;
  defaultBaseUrl: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: 'anthropic', name: 'Anthropic', icon: '🤖', defaultBaseUrl: 'https://api.anthropic.com' },
  { id: 'openai', name: 'OpenAI', icon: '🧠', defaultBaseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', icon: '🌐', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'custom', name: 'Custom', icon: '⚙️', defaultBaseUrl: '' },
];

export function AuthDialog({ isOpen, onClose, onSuccess }: AuthDialogProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<AuthTab>('axon-cloud');

  // API Key tab state
  const [selectedProvider, setSelectedProvider] = useState('anthropic');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  if (!isOpen) return null;

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
  };

  const provider = PROVIDERS.find(p => p.id === selectedProvider)!;

  // API Key - 测试连接
  const handleTestConnection = async () => {
    setTestResult('testing');
    setError(null);
    try {
      const payload: any = { apiKey };
      if (apiBaseUrl) payload.apiBaseUrl = apiBaseUrl;
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
    setSaving(true);
    setError(null);
    try {
      const isAnthropicProvider = selectedProvider === 'anthropic';
      const payload: any = {
        apiKey,
        apiProvider: isAnthropicProvider ? 'anthropic' : 'openai-compatible',
      };
      if (apiBaseUrl) {
        payload.apiBaseUrl = apiBaseUrl;
      } else if (provider.defaultBaseUrl) {
        payload.apiBaseUrl = provider.defaultBaseUrl;
      }

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

        {/* Tab 切换 */}
        <div className="auth-dialog-tabs">
          <button
            className={`auth-dialog-tab ${activeTab === 'axon-cloud' ? 'active' : ''}`}
            onClick={() => handleTabChange('axon-cloud')}
          >
            <span className="tab-icon">☁️</span>
            <span className="tab-label">{t('auth.tab.axonCloud')}</span>
          </button>
          <button
            className={`auth-dialog-tab ${activeTab === 'anthropic' ? 'active' : ''}`}
            onClick={() => handleTabChange('anthropic')}
          >
            <span className="tab-icon">🔐</span>
            <span className="tab-label">{t('auth.tab.anthropic')}</span>
          </button>
          <button
            className={`auth-dialog-tab ${activeTab === 'api-key' ? 'active' : ''}`}
            onClick={() => handleTabChange('api-key')}
          >
            <span className="tab-icon">🔑</span>
            <span className="tab-label">{t('auth.tab.apiKey')}</span>
          </button>
        </div>

        <div className="auth-dialog-content">
          {/* Axon Cloud Tab */}
          {activeTab === 'axon-cloud' && (
            <div className="auth-dialog-panel">
              <p className="auth-panel-desc">{t('auth.tab.axonCloudDesc')}</p>
              <AxonCloudAuth
                onSuccess={() => handleSuccess()}
                onError={(err) => setError(err)}
              />
            </div>
          )}

          {/* Anthropic OAuth Tab */}
          {activeTab === 'anthropic' && (
            <div className="auth-dialog-panel">
              <OAuthLogin onSuccess={handleSuccess} />
            </div>
          )}

          {/* API Key Tab (Multi-Provider) */}
          {activeTab === 'api-key' && (
            <div className="auth-dialog-panel">
              <p className="auth-panel-desc">{t('auth.tab.apiKeyDesc')}</p>

              {/* Provider 选择 */}
              <div className="auth-provider-grid">
                {PROVIDERS.map(p => (
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

              <div className="auth-actions">
                <button
                  className="auth-btn-secondary"
                  onClick={handleTestConnection}
                  disabled={!apiKey || testResult === 'testing'}
                >
                  {testResult === 'testing' ? t('auth.provider.testing') : t('auth.provider.testConnection')}
                </button>
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
  );
}
