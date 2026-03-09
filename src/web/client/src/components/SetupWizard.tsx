/**
 * 首次启动引导 Setup Wizard
 * 4 步：语言 → 选择 Provider → 配置认证 → 完成
 *
 * Step 2 选 Provider（Anthropic / OpenAI / OpenRouter / 自定义）
 * Step 3 根据 Provider 显示对应认证方式：
 *   - Anthropic: OAuth 登录（嵌入 OAuthLogin）或 API Key
 *   - 其他: Base URL + API Key
 */

import { useState } from 'react';
import { useLanguage } from '../i18n';
import type { Locale } from '../i18n';
import { OAuthLogin } from './auth/OAuthLogin';
import { AxonCloudAuth } from './AxonCloudAuth';

const SETUP_DONE_KEY = 'axon_setup_done';

interface SetupWizardProps {
  onComplete: () => void;
}

type WizardStep = 'language' | 'mode' | 'provider' | 'auth' | 'done';
type UsageMode = 'cloud' | 'byo-key'; // Axon Cloud 或自带 Key

interface ProviderOption {
  id: string;
  name: string;
  icon: string;
  descKey: string;
  defaultBaseUrl: string;
  hasOAuth: boolean;
  messageFormat: 'claude' | 'openai';
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    descKey: 'setupWizard.provider.anthropicDesc',
    defaultBaseUrl: 'https://api.anthropic.com',
    hasOAuth: true,
    messageFormat: 'claude',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '🧠',
    descKey: 'setupWizard.provider.openaiDesc',
    defaultBaseUrl: 'https://api.openai.com/v1',
    hasOAuth: false,
    messageFormat: 'openai',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    descKey: 'setupWizard.provider.openrouterDesc',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    hasOAuth: false,
    messageFormat: 'openai',
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    descKey: 'setupWizard.provider.customDesc',
    defaultBaseUrl: '',
    hasOAuth: false,
    messageFormat: 'openai',
  },
];

const STEPS: WizardStep[] = ['language', 'mode', 'provider', 'auth', 'done'];

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { locale, setLocale, t } = useLanguage();
  const [step, setStep] = useState<WizardStep>('language');

  // Mode 选择（Axon Cloud 或自带 Key）
  const [selectedMode, setSelectedMode] = useState<UsageMode | null>(null);

  // Provider 选择
  const [selectedProvider, setSelectedProvider] = useState<string>('anthropic');

  // Axon Cloud 用户信息
  const [axonCloudUser, setAxonCloudUser] = useState<{ username: string; quota: number } | null>(null);

  // Auth 配置（API Key 模式）
  const [authMethod, setAuthMethod] = useState<'oauth' | 'apikey'>('oauth');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [customMessageFormat, setCustomMessageFormat] = useState<'claude' | 'openai'>('openai');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const currentStepIndex = STEPS.indexOf(step);
  const provider = PROVIDERS.find((p) => p.id === selectedProvider)!;

  // 实际使用的消息格式：custom Provider 用 state，其他用 Provider 定义
  const effectiveMessageFormat = selectedProvider === 'custom' ? customMessageFormat : provider.messageFormat;

  const goNext = () => {
    // mode 步骤：根据选择分流
    if (step === 'mode') {
      if (selectedMode === 'cloud') {
        setStep('auth'); // 直接跳到 Axon Cloud 认证
      } else if (selectedMode === 'byo-key') {
        setStep('provider'); // 跳到 Provider 选择
      }
      return;
    }

    // 其他步骤正常前进
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex]);
    }
  };

  const goBack = () => {
    // auth 步骤：根据模式返回
    if (step === 'auth') {
      if (selectedMode === 'cloud') {
        setStep('mode'); // Cloud 模式回到模式选择
      } else if (selectedMode === 'byo-key') {
        setStep('provider'); // BYO Key 模式回到 Provider 选择
      }
      setError(null);
      setTestResult('idle');
      return;
    }

    // provider 步骤：回到模式选择
    if (step === 'provider') {
      setStep('mode');
      setError(null);
      setTestResult('idle');
      return;
    }

    // 其他步骤正常后退
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex]);
      setError(null);
      setTestResult('idle');
    }
  };

  // 进入 auth 步骤时，重置 auth 相关状态
  const goToAuth = () => {
    setError(null);
    setTestResult('idle');
    setApiKey('');
    setApiBaseUrl('');
    // Anthropic 默认 OAuth，其他默认 API Key
    setAuthMethod(provider.hasOAuth ? 'oauth' : 'apikey');
    setStep('auth');
  };

  // OAuth 登录成功回调
  const handleOAuthSuccess = () => {
    saveConfig().then(() => {
      localStorage.setItem(SETUP_DONE_KEY, 'true');
      goNext();
    });
  };

  // Axon Cloud 认证成功回调
  const handleAxonCloudSuccess = (data: { username: string; quota: number }) => {
    setAxonCloudUser(data);
    localStorage.setItem(SETUP_DONE_KEY, 'true');
    // 直接跳到完成步骤
    setStep('done');
  };

  // 保存配置
  const saveConfig = async () => {
    try {
      const payload: any = {
        apiProvider: effectiveMessageFormat === 'claude' ? 'anthropic' : 'openai-compatible',
      };
      await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // 非关键操作
    }
  };

  // API Key 模式 - 测试连接
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
        setError(data.error || t('setupWizard.testFailed'));
      }
    } catch (err) {
      setTestResult('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // API Key 模式 - 保存并完成
  const handleSaveApiKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: any = {
        apiKey,
        apiProvider: effectiveMessageFormat === 'claude' ? 'anthropic' : 'openai-compatible',
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
        setError(data.error || t('setupWizard.saveFailed'));
        setSaving(false);
        return;
      }

      localStorage.setItem(SETUP_DONE_KEY, 'true');
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = () => {
    localStorage.setItem(SETUP_DONE_KEY, 'true');
    onComplete();
  };

  const handleSkip = () => {
    localStorage.setItem(SETUP_DONE_KEY, 'true');
    onComplete();
  };

  return (
    <div className="setup-wizard-overlay">
      <div className="setup-wizard-modal">
        {/* Progress bar */}
        <div className="setup-wizard-progress">
          {STEPS.slice(0, -1).map((s, i) => (
            <div
              key={s}
              className={`setup-wizard-progress-dot ${i <= currentStepIndex ? 'active' : ''} ${i < currentStepIndex ? 'completed' : ''}`}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="setup-wizard-content">
          {/* Step 1: Language */}
          {step === 'language' && (
            <div className="setup-wizard-step">
              <h2>{t('setupWizard.language.title')}</h2>
              <p className="setup-wizard-desc">{t('setupWizard.language.desc')}</p>
              <div className="setup-wizard-language-options">
                <button
                  className={`setup-wizard-language-btn ${locale === 'en' ? 'selected' : ''}`}
                  onClick={() => setLocale('en' as Locale)}
                >
                  <span className="lang-flag">US</span>
                  <span className="lang-name">English</span>
                </button>
                <button
                  className={`setup-wizard-language-btn ${locale === 'zh' ? 'selected' : ''}`}
                  onClick={() => setLocale('zh' as Locale)}
                >
                  <span className="lang-flag">CN</span>
                  <span className="lang-name">中文</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Choose Mode (Axon Cloud vs BYO Key) */}
          {step === 'mode' && (
            <div className="setup-wizard-step">
              <h2>{t('setupWizard.mode.title')}</h2>
              <p className="setup-wizard-desc">{t('setupWizard.mode.desc')}</p>
              <div className="setup-wizard-provider-grid">
                <button
                  className={`setup-wizard-mode-card recommended ${selectedMode === 'cloud' ? 'selected' : ''}`}
                  onClick={() => setSelectedMode('cloud')}
                  data-badge={t('setupWizard.mode.cloudRecommended')}
                >
                  <span className="mode-icon">☁️</span>
                  <span className="mode-name">{t('setupWizard.mode.cloud')}</span>
                  <span className="mode-desc">{t('setupWizard.mode.cloudDesc')}</span>
                </button>
                <button
                  className={`setup-wizard-mode-card ${selectedMode === 'byo-key' ? 'selected' : ''}`}
                  onClick={() => setSelectedMode('byo-key')}
                >
                  <span className="mode-icon">🔑</span>
                  <span className="mode-name">{t('setupWizard.mode.byoKey')}</span>
                  <span className="mode-desc">{t('setupWizard.mode.byoKeyDesc')}</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 3a: Axon Cloud Auth (仅在选择 cloud 模式时显示) */}
          {step === 'auth' && selectedMode === 'cloud' && (
            <div className="setup-wizard-step">
              <h2>{t('setupWizard.mode.cloud')}</h2>
              <p className="setup-wizard-desc">{t('setupWizard.mode.cloudDesc')}</p>
              <AxonCloudAuth
                onSuccess={handleAxonCloudSuccess}
                onError={(err) => setError(err)}
              />
            </div>
          )}

          {/* Step 3b: Choose Provider (仅在选择 byo-key 模式时显示) */}
          {step === 'provider' && selectedMode === 'byo-key' && (
            <div className="setup-wizard-step">
              <h2>{t('setupWizard.provider.title')}</h2>
              <p className="setup-wizard-desc">{t('setupWizard.provider.desc')}</p>
              <div className="setup-wizard-provider-grid">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    className={`setup-wizard-provider-card ${selectedProvider === p.id ? 'selected' : ''}`}
                    onClick={() => setSelectedProvider(p.id)}
                  >
                    <span className="provider-icon">{p.icon}</span>
                    <span className="provider-name">{p.id === 'custom' ? t('setupWizard.provider.customName') : p.name}</span>
                    <span className="provider-desc">{t(p.descKey)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4a: BYO Key 路径 - Provider Auth 配置 */}
          {step === 'auth' && selectedMode === 'byo-key' && (
            <div className="setup-wizard-step">
              <h2>{t('setupWizard.auth.title', { provider: provider.id === 'custom' ? t('setupWizard.provider.customName') : provider.name })}</h2>
              <p className="setup-wizard-desc">{t('setupWizard.auth.desc')}</p>

              {/* Anthropic: OAuth / API Key 切换 */}
              {provider.hasOAuth && (
                <div className="setup-wizard-format-toggle" style={{ marginBottom: '16px' }}>
                  <button
                    className={`setup-wizard-format-btn ${authMethod === 'oauth' ? 'selected' : ''}`}
                    onClick={() => { setAuthMethod('oauth'); setError(null); }}
                  >
                    {t('setupWizard.config.oauthLogin')}
                  </button>
                  <button
                    className={`setup-wizard-format-btn ${authMethod === 'apikey' ? 'selected' : ''}`}
                    onClick={() => { setAuthMethod('apikey'); setError(null); }}
                  >
                    API Key
                  </button>
                </div>
              )}

              {/* OAuth 模式 */}
              {authMethod === 'oauth' && provider.hasOAuth && (
                <div className="setup-wizard-oauth-embed">
                  <OAuthLogin
                    onSuccess={handleOAuthSuccess}
                    onError={(err) => setError(err)}
                  />
                </div>
              )}

              {/* API Key 模式 */}
              {authMethod === 'apikey' && (
                <div className="setup-wizard-apikey-form">
                  {/* API Base URL */}
                  <div className="setup-wizard-field">
                    <label>API Base URL</label>
                    <input
                      type="text"
                      value={apiBaseUrl}
                      onChange={(e) => { setApiBaseUrl(e.target.value); setTestResult('idle'); }}
                      placeholder={provider.defaultBaseUrl || 'https://your-api-endpoint.com/v1'}
                      className="setup-wizard-input"
                    />
                    <span className="setup-wizard-hint">{t('setupWizard.config.baseUrlHint')}</span>
                  </div>

                  {/* API Key */}
                  <div className="setup-wizard-field">
                    <label>API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setTestResult('idle'); setError(null); }}
                      placeholder="sk-..."
                      className="setup-wizard-input"
                    />
                  </div>

                  {/* 自定义 Provider 需选消息格式 */}
                  {provider.id === 'custom' && (
                    <div className="setup-wizard-field">
                      <label>{t('setupWizard.config.messageFormat')}</label>
                      <div className="setup-wizard-format-toggle">
                        <button
                          className={`setup-wizard-format-btn ${customMessageFormat === 'claude' ? 'selected' : ''}`}
                          onClick={() => setCustomMessageFormat('claude')}
                        >
                          Claude
                        </button>
                        <button
                          className={`setup-wizard-format-btn ${customMessageFormat === 'openai' ? 'selected' : ''}`}
                          onClick={() => setCustomMessageFormat('openai')}
                        >
                          OpenAI
                        </button>
                      </div>
                      <span className="setup-wizard-hint">
                        {customMessageFormat === 'claude'
                          ? t('setupWizard.config.claudeFormatHint')
                          : t('setupWizard.config.openaiFormatHint')}
                      </span>
                    </div>
                  )}

                  {error && <div className="setup-wizard-error">{error}</div>}
                  {testResult === 'success' && (
                    <div className="setup-wizard-success">{t('setupWizard.testSuccess')}</div>
                  )}

                  <button
                    className="setup-wizard-test-btn"
                    onClick={handleTestConnection}
                    disabled={!apiKey || testResult === 'testing'}
                  >
                    {testResult === 'testing' ? t('setupWizard.testing') : t('setupWizard.testConnection')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Done */}
          {step === 'done' && (
            <div className="setup-wizard-step setup-wizard-done">
              <div className="done-icon">✨</div>
              <h2>{t('setupWizard.done.title')}</h2>
              {axonCloudUser ? (
                <p className="setup-wizard-desc">
                  {t('axonCloud.welcome', { username: axonCloudUser.username })}
                  <br />
                  {t('axonCloud.balance')}: {axonCloudUser.quota}
                </p>
              ) : (
                <p className="setup-wizard-desc">{t('setupWizard.done.desc')}</p>
              )}
              <div className="setup-wizard-done-tips">
                <div className="done-tip">💡 {t('setupWizard.done.tip1')}</div>
                <div className="done-tip">🔍 {t('setupWizard.done.tip2')}</div>
                <div className="done-tip">📋 {t('setupWizard.done.tip3')}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="setup-wizard-footer">
          {step !== 'done' && (
            <button className="setup-wizard-skip-btn" onClick={handleSkip}>
              {t('setupWizard.skip')}
            </button>
          )}

          <div className="setup-wizard-nav-buttons">
            {currentStepIndex > 0 && step !== 'done' && (
              <button className="setup-wizard-back-btn" onClick={goBack}>
                {t('setupWizard.back')}
              </button>
            )}

            {step === 'language' && (
              <button className="setup-wizard-next-btn" onClick={goNext}>
                {t('setupWizard.next')}
              </button>
            )}

            {step === 'mode' && (
              <button 
                className="setup-wizard-next-btn" 
                onClick={goNext}
                disabled={!selectedMode}
              >
                {t('setupWizard.next')}
              </button>
            )}

            {step === 'provider' && (
              <button className="setup-wizard-next-btn" onClick={goToAuth}>
                {t('setupWizard.next')}
              </button>
            )}

            {step === 'auth' && selectedMode === 'byo-key' && authMethod === 'apikey' && (
              <button
                className="setup-wizard-next-btn primary"
                onClick={handleSaveApiKey}
                disabled={saving || !apiKey}
              >
                {saving ? t('setupWizard.saving') : t('setupWizard.finish')}
              </button>
            )}

            {step === 'auth' && selectedMode === 'byo-key' && authMethod === 'oauth' && (
              // OAuth 模式由 OAuthLogin 组件成功回调推进
              null
            )}

            {step === 'auth' && selectedMode === 'cloud' && (
              // Axon Cloud 模式由 AxonCloudAuth 组件成功回调推进
              null
            )}

            {step === 'done' && (
              <button className="setup-wizard-next-btn primary" onClick={handleFinish}>
                {t('setupWizard.startUsing')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 检查是否需要显示 Setup Wizard
 */
export function useSetupWizard() {
  const [needSetup, setNeedSetup] = useState(false);

  const [initialized] = useState(() => {
    const done = localStorage.getItem(SETUP_DONE_KEY);
    if (!done) {
      setTimeout(() => setNeedSetup(true), 0);
    }
    return true;
  });

  const completeSetup = () => {
    setNeedSetup(false);
  };

  const resetSetup = () => {
    localStorage.removeItem(SETUP_DONE_KEY);
    setNeedSetup(true);
  };

  return { needSetup, completeSetup, resetSetup };
}
