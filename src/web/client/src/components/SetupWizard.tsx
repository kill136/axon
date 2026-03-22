/**
 * 首次启动引导 Setup Wizard
 * 4 步：语言 → 选择运行方式 → 配置认证 → 使用引导
 */

import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import type { Locale } from '../i18n';
import { OAuthLogin } from './auth/OAuthLogin';
import { CodexLogin } from './auth/CodexLogin';
import { AxonCloudAuth } from './AxonCloudAuth';
import { getRuntimeBackendLabel, type WebRuntimeBackend } from '../../../shared/model-catalog';
import {
  buildRuntimeBackendConfigPayload,
  getRuntimeBackendAuthSpec,
  getSetupRuntimeOptions,
  type RuntimeApiProviderOption,
} from '../../../shared/setup-runtime';

const SETUP_DONE_KEY = 'axon_setup_done';

interface SetupWizardProps {
  onComplete: () => void;
  onOpenFolder?: () => Promise<unknown> | unknown;
  currentProjectName?: string | null;
}

type WizardStep = 'language' | 'runtime' | 'auth' | 'usage';
const STEPS: WizardStep[] = ['language', 'runtime', 'auth', 'usage'];

export function SetupWizard({
  onComplete,
  onOpenFolder,
  currentProjectName = null,
}: SetupWizardProps) {
  const { locale, setLocale, t } = useLanguage();
  const [step, setStep] = useState<WizardStep>('language');
  const [selectedBackend, setSelectedBackend] = useState<WebRuntimeBackend>('axon-cloud');

  // Axon Cloud 用户信息
  const [axonCloudUser, setAxonCloudUser] = useState<{ username: string; quota: number } | null>(null);

  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [selectedApiProvider, setSelectedApiProvider] = useState<RuntimeApiProviderOption['id']>('openai');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [openingFolder, setOpeningFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const currentStepIndex = STEPS.indexOf(step);
  const runtimeOptions = getSetupRuntimeOptions();
  const authSpec = getRuntimeBackendAuthSpec(selectedBackend);
  const providerChoices = authSpec.providerOptions;
  const provider = providerChoices.find(option => option.id === selectedApiProvider) || providerChoices[0];
  const runtimeDescriptionKey = `setupWizard.runtime.${selectedBackend}.desc`;
  const isAxonCloudAuthStep = step === 'auth' && authSpec.authMode === 'axon-cloud';
  const isOauthAuthStep = step === 'auth' && authSpec.authMode === 'oauth';
  const isApiAuthStep = step === 'auth' && authSpec.authMode === 'api-key';
  const showOpenAiCompatibleHint =
    isApiAuthStep
    && authSpec.runtimeProvider === 'codex'
    && providerChoices.length > 1;
  const showUnsupportedTestHint = isApiAuthStep && !authSpec.testConnection && !showOpenAiCompatibleHint;
  const hasSelectedProject = !!currentProjectName;

  useEffect(() => {
    if (currentProjectName) {
      setFolderError(null);
    }
  }, [currentProjectName]);

  const goNext = () => {
    setError(null);
    setTestResult('idle');
    setFolderError(null);

    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setStep(STEPS[nextIndex]);
    }
  };

  const goBack = () => {
    if (step === 'auth') {
      setStep('runtime');
      setError(null);
      setTestResult('idle');
      setFolderError(null);
      return;
    }

    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setStep(STEPS[prevIndex]);
      setError(null);
      setTestResult('idle');
      setFolderError(null);
    }
  };

  const goToAuth = () => {
    setError(null);
    setTestResult('idle');
    setFolderError(null);
    setApiKey('');
    setApiBaseUrl('');
    setSelectedApiProvider(authSpec.providerOptions[0]?.id || 'openai');
    setStep('auth');
  };

  const handleOAuthSuccess = () => {
    saveConfig().then(() => {
      goNext();
    });
  };

  const handleAxonCloudSuccess = async (data: { username: string; quota: number }) => {
    await saveConfig();
    setAxonCloudUser(data);
    setStep('usage');
  };

  const saveConfig = async () => {
    try {
      const payload = buildRuntimeBackendConfigPayload(selectedBackend);
      await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // 非关键操作
    }
  };

  const handleTestConnection = async () => {
    if (!authSpec.testConnection) {
      return;
    }
    setTestResult('testing');
    setError(null);
    try {
      const payload: any = {
        apiKey,
        runtimeBackend: selectedBackend,
        apiProvider: authSpec.apiProvider,
      };
      if (apiBaseUrl) {
        payload.apiBaseUrl = apiBaseUrl;
      } else if (provider?.defaultBaseUrl) {
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
        setError(data.error || t('setupWizard.testFailed'));
      }
    } catch (err) {
      setTestResult('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveApiKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = buildRuntimeBackendConfigPayload(selectedBackend, {
        apiKey,
        apiBaseUrl: apiBaseUrl || provider?.defaultBaseUrl,
      });

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

      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUsageOpenFolder = async () => {
    if (!onOpenFolder || openingFolder) {
      return;
    }

    setOpeningFolder(true);
    setFolderError(null);

    try {
      await onOpenFolder();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpeningFolder(false);
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

  const modalClassName = [
    'setup-wizard-modal',
    step === 'runtime' ? 'runtime-step' : '',
    isOauthAuthStep ? 'oauth-auth-step' : '',
    isApiAuthStep ? 'api-auth-step' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="setup-wizard-overlay" style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)' }}>
      <div className={modalClassName}>
        {/* Progress bar */}
        <div className="setup-wizard-progress">
          {STEPS.map((s, i) => (
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

          {/* Step 2: Choose Runtime Backend */}
          {step === 'runtime' && (
            <div className="setup-wizard-step">
              <h2>{t('setupWizard.runtime.title')}</h2>
              <p className="setup-wizard-desc">{t('setupWizard.runtime.desc')}</p>
              <div className="setup-wizard-provider-grid runtime-grid">
                {runtimeOptions.map(option => (
                  <button
                    key={option.backend}
                    className={`setup-wizard-mode-card ${option.recommended ? 'recommended' : ''} ${selectedBackend === option.backend ? 'selected' : ''}`}
                    onClick={() => setSelectedBackend(option.backend)}
                    data-badge={option.recommended ? t('setupWizard.runtime.recommended') : undefined}
                  >
                    <span className="mode-icon">{option.icon}</span>
                    <span className="mode-name">{getRuntimeBackendLabel(option.backend)}</span>
                    <span className="mode-desc">{t(`setupWizard.runtime.${option.backend}.desc`)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Runtime Auth */}
          {isAxonCloudAuthStep && (
            <div className="setup-wizard-step">
              <h2>{getRuntimeBackendLabel(selectedBackend)}</h2>
              <p className="setup-wizard-desc">{t(runtimeDescriptionKey)}</p>
              <AxonCloudAuth
                onSuccess={handleAxonCloudSuccess}
                onError={(err) => setError(err)}
              />
            </div>
          )}

          {isOauthAuthStep && (
            <div className="setup-wizard-step">
              <h2>{getRuntimeBackendLabel(selectedBackend)}</h2>
              <p className="setup-wizard-desc">{t(runtimeDescriptionKey)}</p>
              <div className="setup-wizard-oauth-embed">
                {authSpec.runtimeProvider === 'codex' ? (
                  <CodexLogin
                    onSuccess={handleOAuthSuccess}
                    onError={(err) => setError(err)}
                  />
                ) : (
                  <OAuthLogin
                    onSuccess={handleOAuthSuccess}
                    onError={(err) => setError(err)}
                  />
                )}
              </div>
            </div>
          )}

          {isApiAuthStep && (
            <div className="setup-wizard-step">
              <h2>{getRuntimeBackendLabel(selectedBackend)}</h2>
              <p className="setup-wizard-desc">{t(runtimeDescriptionKey)}</p>

              <div className="setup-wizard-apikey-form">
                {providerChoices.length > 1 && (
                  <div className="setup-wizard-provider-grid api-grid">
                    {providerChoices.map((choice) => (
                      <button
                        key={choice.id}
                        className={`setup-wizard-provider-card ${selectedApiProvider === choice.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedApiProvider(choice.id);
                          setApiBaseUrl('');
                          setError(null);
                          setTestResult('idle');
                        }}
                      >
                        <span className="provider-icon">{choice.icon}</span>
                        <span className="provider-name">{choice.name}</span>
                        <span className="provider-desc">{t(`setupWizard.provider.${choice.id}Desc`)}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="setup-wizard-field">
                  <label>API Base URL</label>
                  <input
                    type="text"
                    value={apiBaseUrl}
                    onChange={(e) => { setApiBaseUrl(e.target.value); setTestResult('idle'); }}
                    placeholder={provider?.defaultBaseUrl || 'https://your-api-endpoint.com/v1'}
                    className="setup-wizard-input"
                  />
                  <span className="setup-wizard-hint">{t('setupWizard.config.baseUrlHint')}</span>
                </div>

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

                {showOpenAiCompatibleHint && (
                  <span className="setup-wizard-hint">
                    {t('setupWizard.config.openaiCompatibleHint')}
                  </span>
                )}

                {error && <div className="setup-wizard-error">{error}</div>}
                {testResult === 'success' && (
                  <div className="setup-wizard-success">{t('setupWizard.testSuccess')}</div>
                )}

                {authSpec.testConnection ? (
                  <button
                    className="setup-wizard-test-btn"
                    onClick={handleTestConnection}
                    disabled={!apiKey || testResult === 'testing'}
                  >
                    {testResult === 'testing' ? t('setupWizard.testing') : t('setupWizard.testConnection')}
                  </button>
                ) : showUnsupportedTestHint ? (
                  <div className="setup-wizard-hint">{t('setupWizard.testUnsupported')}</div>
                ) : null}
              </div>
            </div>
          )}

          {/* Step 4: Usage onboarding */}
          {step === 'usage' && (
            <div className="setup-wizard-step setup-wizard-done setup-wizard-usage">
              <div className="done-icon">✨</div>
              <h2>{t('setupWizard.usage.title')}</h2>
              {axonCloudUser && (
                <div className="setup-wizard-usage-account">
                  <span>{t('axonCloud.welcome', { username: axonCloudUser.username })}</span>
                  <span>{t('axonCloud.balance')}: {axonCloudUser.quota}</span>
                </div>
              )}
              <p className="setup-wizard-desc">{t('setupWizard.usage.desc')}</p>

              <div className="setup-wizard-usage-list">
                <div className={`setup-wizard-usage-card ${hasSelectedProject ? 'completed' : ''}`}>
                  <div className="setup-wizard-usage-index">1</div>
                  <div className="setup-wizard-usage-body">
                    <h3>{t('setupWizard.usage.project.title')}</h3>
                    <p>{t('setupWizard.usage.project.desc')}</p>
                    {hasSelectedProject ? (
                      <div className="setup-wizard-usage-status ready">
                        {t('setupWizard.usage.projectReadyLabel')} <strong>{currentProjectName}</strong>
                      </div>
                    ) : (
                      <div className="setup-wizard-usage-status">
                        {t('setupWizard.usage.projectPending')}
                      </div>
                    )}
                    {folderError && <div className="setup-wizard-error">{folderError}</div>}
                  </div>
                  {onOpenFolder && (
                    <button
                      className="setup-wizard-usage-action"
                      onClick={handleUsageOpenFolder}
                      disabled={openingFolder}
                    >
                      {openingFolder
                        ? t('setupWizard.usage.projectOpening')
                        : hasSelectedProject
                          ? t('setupWizard.usage.changeFolder')
                          : t('setupWizard.usage.openFolder')}
                    </button>
                  )}
                </div>

                <div className="setup-wizard-usage-card">
                  <div className="setup-wizard-usage-index">2</div>
                  <div className="setup-wizard-usage-body">
                    <h3>{t('setupWizard.usage.chat.title')}</h3>
                    <p>{t('setupWizard.usage.chat.desc')}</p>
                    <div className="setup-wizard-usage-note">{t('setupWizard.usage.chat.example')}</div>
                  </div>
                </div>

                <div className="setup-wizard-usage-card">
                  <div className="setup-wizard-usage-index">3</div>
                  <div className="setup-wizard-usage-body">
                    <h3>{t('setupWizard.usage.workspace.title')}</h3>
                    <p>{t('setupWizard.usage.workspace.desc')}</p>
                    <div className="setup-wizard-usage-note">{t('setupWizard.usage.workspace.note')}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="setup-wizard-footer">
          {step !== 'usage' && (
            <button className="setup-wizard-skip-btn" onClick={handleSkip}>
              {t('setupWizard.skip')}
            </button>
          )}

          <div className="setup-wizard-nav-buttons">
            {currentStepIndex > 0 && (
              <button className="setup-wizard-back-btn" onClick={goBack}>
                {t('setupWizard.back')}
              </button>
            )}

            {step === 'language' && (
              <button className="setup-wizard-next-btn" onClick={goNext}>
                {t('setupWizard.next')}
              </button>
            )}

            {step === 'runtime' && (
              <button className="setup-wizard-next-btn" onClick={goToAuth}>
                {t('setupWizard.next')}
              </button>
            )}

            {step === 'auth' && authSpec.authMode === 'api-key' && (
              <button
                className="setup-wizard-next-btn primary"
                onClick={handleSaveApiKey}
                disabled={saving || !apiKey}
              >
                {saving ? t('setupWizard.saving') : t('setupWizard.finish')}
              </button>
            )}

            {step === 'auth' && authSpec.authMode === 'oauth' && (
              // OAuth 模式由 OAuthLogin 组件成功回调推进
              null
            )}

            {step === 'auth' && authSpec.authMode === 'axon-cloud' && (
              // Axon Cloud 模式由 AxonCloudAuth 组件成功回调推进
              null
            )}

            {step === 'usage' && (
              <button className="setup-wizard-next-btn primary" onClick={handleFinish} disabled={openingFolder}>
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
