/**
 * 设置面板组件
 * 包含通用设置、模型选择和系统配置（MCP 和技能&插件已移至自定义页面）
 */

import { useEffect, useState } from 'react';
import { PromptSnippetsPanel } from './PromptSnippetsPanel';
import {
  ApiConfigPanel,
  HooksConfigPanel,
  SystemConfigPanel,
  ConfigImportExport,
  EmbeddingConfigPanel,
} from './config';
import { ModePresetsPanel } from './config/ModePresetsPanel';
import { useLanguage } from '../i18n';
import type { Locale } from '../i18n';
import { useNotificationSound } from '../hooks/useNotificationSound';
import {
  getRuntimeBackendLabel,
  getWebModelOptionsForBackend,
  normalizeWebRuntimeModelForBackend,
  supportsDynamicModelCatalogForBackend,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from '../../../shared/model-catalog';
import {
  resolveBackendDefaultModel,
  upsertBackendDefaultModel,
  type DefaultModelMap,
} from '../../../shared/model-preferences';
import { getSetupRuntimeOptions } from '../../../shared/setup-runtime';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  model: string;
  availableModels?: string[];
  runtimeProvider: WebRuntimeProvider;
  runtimeBackend: WebRuntimeBackend;
  onModelChange: (model: string) => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

interface ModelSettingsConfig {
  runtimeBackend?: WebRuntimeBackend;
  defaultModelByBackend?: DefaultModelMap;
  customModelCatalogByBackend?: Partial<Record<WebRuntimeBackend, string[]>>;
}

type SettingsTab =
  | 'general'
  | 'model'
  | 'api'
  | 'embedding'
  | 'permissions'
  | 'hooks'
  | 'system'
  | 'import-export'
  | 'prompts'
  | 'about';

// Tab id -> i18n key 映射
const TAB_KEYS: { id: SettingsTab; i18nKey: string; icon: string }[] = [
  { id: 'general', i18nKey: 'settings.tab.general', icon: '⚙️' },
  { id: 'model', i18nKey: 'settings.tab.model', icon: '🤖' },
  { id: 'api', i18nKey: 'settings.tab.apiAdvanced', icon: '🔧' },
  { id: 'embedding', i18nKey: 'settings.tab.embedding', icon: '🧠' },
  { id: 'permissions', i18nKey: 'settings.tab.permissions', icon: '🔐' },
  { id: 'hooks', i18nKey: 'settings.tab.hooks', icon: '🪝' },
  { id: 'system', i18nKey: 'settings.tab.system', icon: '💾' },
  { id: 'import-export', i18nKey: 'settings.tab.importExport', icon: '📦' },
  { id: 'prompts', i18nKey: 'settings.tab.prompts', icon: '📝' },
  { id: 'about', i18nKey: 'settings.tab.about', icon: 'ℹ️' },
];

export function SettingsPanel(props: SettingsPanelProps) {
  if (!props.isOpen) {
    return null;
  }

  return <SettingsPanelContent {...props} />;
}

function SettingsPanelContent({
  isOpen,
  onClose,
  model,
  availableModels,
  runtimeProvider,
  runtimeBackend,
  onModelChange,
  onSendMessage,
  addMessageHandler,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const { locale, setLocale, t } = useLanguage();
  const { play, isEnabled, setEnabled, getVolume, setVolume } = useNotificationSound();
  const [soundEnabled, setSoundEnabled] = useState(isEnabled());
  const [soundVolume, setSoundVolume] = useState(getVolume());
  const [modelConfig, setModelConfig] = useState<ModelSettingsConfig>({
    runtimeBackend,
    defaultModelByBackend: {},
    customModelCatalogByBackend: {},
  });
  const currentRuntimeCatalog = availableModels && availableModels.length > 0
    ? availableModels
    : modelConfig.customModelCatalogByBackend?.[runtimeBackend];
  const modelOptions = getWebModelOptionsForBackend(runtimeBackend, model, model, currentRuntimeCatalog);
  const selectedModel = normalizeWebRuntimeModelForBackend(runtimeBackend, model, model, currentRuntimeCatalog);
  const [managedBackend, setManagedBackend] = useState<WebRuntimeBackend>(runtimeBackend);
  const [modelConfigLoading, setModelConfigLoading] = useState(false);
  const [modelConfigSaving, setModelConfigSaving] = useState(false);
  const [modelConfigError, setModelConfigError] = useState<string | null>(null);
  const [modelConfigSuccess, setModelConfigSuccess] = useState<string | null>(null);
  const managedBackendOptions = getSetupRuntimeOptions().map(option => option.backend);
  const managedDefaultModel = resolveBackendDefaultModel(
    managedBackend,
    modelConfig.defaultModelByBackend,
    managedBackend === runtimeBackend ? model : undefined,
  );
  const showCuratedAnthropicCards =
    runtimeProvider === 'anthropic'
    && !supportsDynamicModelCatalogForBackend(runtimeBackend);
  const managedModelOptions = getWebModelOptionsForBackend(
    managedBackend,
    managedDefaultModel,
    managedDefaultModel,
    modelConfig.customModelCatalogByBackend?.[managedBackend],
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setManagedBackend(runtimeBackend);
    setModelConfigLoading(true);
    setModelConfigError(null);

    fetch('/api/config/api')
      .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load model settings')))
      .then(data => {
        if (cancelled || !data.success) return;
        setModelConfig({
          runtimeBackend: data.data.runtimeBackend || runtimeBackend,
          defaultModelByBackend: data.data.defaultModelByBackend || {},
          customModelCatalogByBackend: data.data.customModelCatalogByBackend || {},
        });
      })
      .catch(err => {
        if (!cancelled) {
          setModelConfigError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModelConfigLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, runtimeBackend]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleLanguageChange = (lang: string) => {
    setLocale(lang as Locale);
    onSendMessage?.({ type: 'set_language', payload: { language: lang } });
  };

  const handleManagedBackendChange = (backend: WebRuntimeBackend) => {
    setManagedBackend(backend);
    setModelConfigError(null);
    setModelConfigSuccess(null);
  };

  const handleManagedDefaultModelChange = (nextModel: string) => {
    setModelConfig(prev => ({
      ...prev,
      defaultModelByBackend: upsertBackendDefaultModel(prev.defaultModelByBackend, managedBackend, nextModel),
    }));
    setModelConfigError(null);
    setModelConfigSuccess(null);
  };

  const handleSaveManagedDefaultModel = async () => {
    setModelConfigSaving(true);
    setModelConfigError(null);
    setModelConfigSuccess(null);
    try {
      const response = await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultModelByBackend: modelConfig.defaultModelByBackend || {},
        }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to save model preferences');
      }
      setModelConfigSuccess(t('settings.model.saveSuccess', { backend: getRuntimeBackendLabel(managedBackend) }));
      setTimeout(() => setModelConfigSuccess(null), 2500);
    } catch (error) {
      setModelConfigError(error instanceof Error ? error.message : String(error));
    } finally {
      setModelConfigSaving(false);
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="settings-section">
            <h3>{t('settings.general.title')}</h3>
            <p className="settings-description">
              {t('settings.general.description')}
            </p>
            <div className="setting-item">
              <label>{t('settings.general.theme')}</label>
              <select className="setting-select" disabled>
                <option value="dark">{t('settings.general.theme.dark')}</option>
                <option value="light">{t('settings.general.theme.light')}</option>
              </select>
            </div>
            <div className="setting-item">
              <label>{t('settings.general.language')}</label>
              <select
                className="setting-select"
                value={locale}
                onChange={(e) => handleLanguageChange(e.target.value)}
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </div>
            <div className="setting-item">
              <label>{t('settings.general.autoSave')}</label>
              <select className="setting-select" disabled>
                <option value="true">{t('settings.general.enabled')}</option>
                <option value="false">{t('settings.general.disabled')}</option>
              </select>
            </div>
            <div className="setting-item">
              <label>{t('settings.general.notificationSound')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <select
                  className="setting-select"
                  value={soundEnabled ? 'true' : 'false'}
                  onChange={(e) => {
                    const enabled = e.target.value === 'true';
                    setSoundEnabled(enabled);
                    setEnabled(enabled);
                    if (enabled) play('info');
                  }}
                  style={{ flex: '0 0 auto', width: 'auto' }}
                >
                  <option value="true">{t('settings.general.enabled')}</option>
                  <option value="false">{t('settings.general.disabled')}</option>
                </select>
                {soundEnabled && (
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(soundVolume * 100)}
                    onChange={(e) => {
                      const vol = parseInt(e.target.value) / 100;
                      setSoundVolume(vol);
                      setVolume(vol);
                    }}
                    onMouseUp={() => play('info')}
                    style={{ flex: 1, maxWidth: '120px', cursor: 'pointer' }}
                    title={`${Math.round(soundVolume * 100)}%`}
                  />
                )}
              </div>
            </div>
            <div className="setting-item" style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <label>{t('setupWizard.rerun')}</label>
              <button
                className="setting-select"
                style={{ cursor: 'pointer', textAlign: 'center', background: 'var(--bg-tertiary)' }}
                onClick={() => {
                  localStorage.removeItem('axon_setup_done');
                  window.location.reload();
                }}
              >
                {t('setupWizard.rerun')}
              </button>
            </div>
          </div>
        );

      case 'model':
        return (
          <div className="settings-section">
            <h3>{t('settings.model.title')}</h3>
            <p className="settings-description">
              {t('settings.model.description')}
            </p>
            <div className="setting-item">
              <label>{t('settings.model.currentRuntime')}</label>
              <input
                className="setting-select"
                value={getRuntimeBackendLabel(runtimeBackend)}
                disabled
              />
            </div>
            <div className="setting-item">
              <label>{t('settings.model.currentSessionModel')}</label>
              <select
                className="setting-select"
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
              >
                {modelOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="setting-item" style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <label>{t('settings.model.defaultBackend')}</label>
              <select
                className="setting-select"
                value={managedBackend}
                onChange={(e) => handleManagedBackendChange(e.target.value as WebRuntimeBackend)}
              >
                {managedBackendOptions.map(backend => (
                  <option key={backend} value={backend}>{getRuntimeBackendLabel(backend)}</option>
                ))}
              </select>
            </div>
            <div className="setting-item">
              <label>{t('settings.model.defaultModelForBackend', { backend: getRuntimeBackendLabel(managedBackend) })}</label>
              <select
                className="setting-select"
                value={managedDefaultModel}
                onChange={(e) => handleManagedDefaultModelChange(e.target.value)}
                disabled={modelConfigLoading}
              >
                {managedModelOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <p className="settings-description" style={{ marginTop: '8px' }}>
              {t('settings.model.defaultModelHint', { backend: getRuntimeBackendLabel(managedBackend) })}
            </p>
            {modelConfigError && (
              <div className="mcp-form-error" style={{ marginTop: '12px' }}>{modelConfigError}</div>
            )}
            {modelConfigSuccess && (
              <div className="mcp-form-success" style={{ marginTop: '12px' }}>{modelConfigSuccess}</div>
            )}
            <div className="setting-item" style={{ marginTop: '12px' }}>
              <button
                className="setting-select"
                style={{ cursor: modelConfigSaving ? 'default' : 'pointer', textAlign: 'center', background: 'var(--bg-tertiary)' }}
                onClick={handleSaveManagedDefaultModel}
                disabled={modelConfigSaving || modelConfigLoading}
              >
                {modelConfigSaving ? t('settings.model.saving') : t('settings.model.saveDefaults')}
              </button>
            </div>
            <div className="model-info">
              {showCuratedAnthropicCards ? (
                <>
                  <div className="model-card">
                    <h4>{t('settings.model.opus.title')}</h4>
                    <p>{t('settings.model.opus.desc')}</p>
                  </div>
                  <div className="model-card">
                    <h4>{t('settings.model.sonnet.title')}</h4>
                    <p>{t('settings.model.sonnet.desc')}</p>
                  </div>
                  <div className="model-card">
                    <h4>{t('settings.model.haiku.title')}</h4>
                    <p>{t('settings.model.haiku.desc')}</p>
                  </div>
                </>
              ) : (
                modelOptions.map(option => (
                  <div key={option.value} className="model-card">
                    <h4>{option.label}</h4>
                    <p>{option.description || option.value}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        );

      case 'api':
        return (
          <ApiConfigPanel
            onSave={() => { onClose(); }}
            onClose={onClose}
          />
        );

      case 'embedding':
        return <EmbeddingConfigPanel />;

      case 'permissions':
        return (
          <ModePresetsPanel
            onClose={onClose}
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
          />
        );

      case 'hooks':
        return (
          <HooksConfigPanel
            onSave={() => { onClose(); }}
            onClose={onClose}
          />
        );

      case 'system':
        return (
          <SystemConfigPanel
            onSave={() => { onClose(); }}
            onClose={onClose}
          />
        );

      case 'import-export':
        return <ConfigImportExport onClose={onClose} />;

      case 'prompts':
        return <PromptSnippetsPanel onClose={onClose} onSendMessage={onSendMessage} addMessageHandler={addMessageHandler} />;

      case 'about':
        return (
          <div className="settings-section">
            <h3>{t('settings.about.title')}</h3>
            <p className="settings-description">
              {t('settings.about.description')}
            </p>
            <div className="about-info">
              <p>
                <strong>{t('settings.about.version')}:</strong> 2.1.4 (Educational)
              </p>
              <p>
                <strong>{t('settings.about.repository')}:</strong> github.com/kill136/axon
              </p>
              <p>
                <strong>{t('settings.about.license')}:</strong> {t('settings.about.licenseValue')}
              </p>
            </div>
            <div className="about-disclaimer">
              <p>
                <strong>{t('settings.about.disclaimer')}:</strong> {t('settings.about.disclaimerText')}
              </p>
            </div>

            <div className="about-features">
              <h4>{t('settings.about.features')}</h4>
              <ul>
                <li>{t('settings.about.feature1')}</li>
                <li>{t('settings.about.feature2')}</li>
                <li>{t('settings.about.feature3')}</li>
                <li>{t('settings.about.feature4')}</li>
                <li>{t('settings.about.feature5')}</li>
                <li>{t('settings.about.feature6')}</li>
                <li>{t('settings.about.feature7')}</li>
              </ul>
            </div>

            <div className="about-links">
              <h4>{t('settings.about.links')}</h4>
              <p>
                <a
                  href="https://docs.anthropic.com/en/docs/claude-code"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('settings.about.link.docs')}
                </a>
              </p>
              <p>
                <a
                  href="https://modelcontextprotocol.io/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('settings.about.link.mcp')}
                </a>
              </p>
              <p>
                <a
                  href="https://github.com/kill136/axon"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('settings.about.link.github')}
                </a>
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="settings-panel-overlay" onClick={handleOverlayClick}>
      <div className="settings-panel">
        <div className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button className="settings-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {TAB_KEYS.map((tab) => (
              <div
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-nav-icon">{tab.icon}</span>
                {t(tab.i18nKey)}
              </div>
            ))}
          </nav>
          <div className="settings-content">{renderTabContent()}</div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPanel;
