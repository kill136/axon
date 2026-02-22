/**
 * 系统配置面板组件
 * 用于配置系统相关的设置（日志、代理、缓存、安全等）
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '../../i18n';
import '../../styles/config-panels.css';

// ============ 类型定义 ============

interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  logPath?: string;
  maxSize?: number;
  maxFiles?: number;
}

interface ProxyConfig {
  http?: string;
  https?: string;
  auth?: {
    username?: string;
    password?: string;
  };
}

interface CacheConfig {
  enabled: boolean;
  location?: string;
  maxSize?: number;
  ttl?: number;
}

interface SecurityConfig {
  sensitiveFiles?: string[];
  dangerousCommands?: string[];
  allowSandboxEscape?: boolean;
}

interface ConfigPanelProps {
  onSave?: () => void;
  onClose?: () => void;
}

// ============ 主组件 ============

export function SystemConfigPanel({ onSave, onClose }: ConfigPanelProps) {
  const { t } = useLanguage();
  const [loggingConfig, setLoggingConfig] = useState<LoggingConfig>({
    level: 'info',
    logPath: '',
    maxSize: 10485760, // 10MB
    maxFiles: 5,
  });

  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>({});

  const [cacheConfig, setCacheConfig] = useState<CacheConfig>({
    enabled: true,
    maxSize: 104857600, // 100MB
    ttl: 86400, // 24 hours
  });

  const [securityConfig, setSecurityConfig] = useState<SecurityConfig>({
    sensitiveFiles: [],
    dangerousCommands: [],
    allowSandboxEscape: false,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 加载配置
  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const [loggingRes, proxyRes, cacheRes, securityRes] = await Promise.all([
        fetch('/api/config/logging').then(r => r.json()),
        fetch('/api/config/proxy').then(r => r.json()),
        fetch('/api/config/cache').then(r => r.json()),
        fetch('/api/config/security').then(r => r.json()),
      ]);

      if (loggingRes.success && loggingRes.config) {
        setLoggingConfig(loggingRes.config);
      }
      if (proxyRes.success && proxyRes.config) {
        setProxyConfig(proxyRes.config);
      }
      if (cacheRes.success && cacheRes.config) {
        setCacheConfig(cacheRes.config);
      }
      if (securityRes.success && securityRes.config) {
        setSecurityConfig(securityRes.config);
      }
    } catch (error) {
      console.error('Failed to load configs:', error);
      setMessage({ type: 'error', text: t('system.loadFailed') });
    } finally {
      setLoading(false);
    }
  };

  const saveLogging = async (config: LoggingConfig) => {
    const response = await fetch('/api/config/logging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || t('error.saveLoggingFailed'));
    }
  };

  const saveProxy = async (config: ProxyConfig) => {
    const response = await fetch('/api/config/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || t('error.saveProxyFailed'));
    }
  };

  const saveCache = async (config: CacheConfig) => {
    const response = await fetch('/api/config/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || t('error.saveCacheFailed'));
    }
  };

  const saveSecurity = async (config: SecurityConfig) => {
    const response = await fetch('/api/config/security', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || t('error.saveSecurityFailed'));
    }
  };

  const handleSaveAll = async () => {
    setLoading(true);
    setMessage(null);

    try {
      await Promise.all([
        saveLogging(loggingConfig),
        saveProxy(proxyConfig),
        saveCache(cacheConfig),
        saveSecurity(securityConfig),
      ]);

      setMessage({ type: 'success', text: t('system.saveSuccess') });
      onSave?.();
    } catch (error) {
      console.error('Failed to save configs:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : t('system.saveFailed')
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading && !loggingConfig.level) {
    return (
      <div className="system-config-panel">
        <div className="config-loading">{t('system.loading')}</div>
      </div>
    );
  }

  return (
    <div className="system-config-panel">
      <div className="config-panel-header">
        <h3>{t('system.title')}</h3>
        <p className="config-description">
          {t('system.description')}
        </p>
      </div>

      {message && (
        <div className={`config-message config-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 日志配置 */}
      <section className="config-section">
        <h4>{t('system.logging.title')}</h4>

        <label className="config-label">
          <span className="label-text">{t('system.logging.level')}</span>
          <select
            className="config-input config-select"
            value={loggingConfig.level}
            onChange={(e) => setLoggingConfig({
              ...loggingConfig,
              level: e.target.value as LoggingConfig['level']
            })}
          >
            <option value="debug">{t('system.logging.level.debug')}</option>
            <option value="info">{t('system.logging.level.info')}</option>
            <option value="warn">{t('system.logging.level.warn')}</option>
            <option value="error">{t('system.logging.level.error')}</option>
          </select>
        </label>

        <label className="config-label">
          <span className="label-text">{t('system.logging.path')}</span>
          <input
            type="text"
            className="config-input"
            value={loggingConfig.logPath || ''}
            onChange={(e) => setLoggingConfig({
              ...loggingConfig,
              logPath: e.target.value
            })}
            placeholder={t('placeholder.logFile')}
          />
          <span className="help-text">{t('system.logging.pathHint')}</span>
        </label>

        <label className="config-label">
          <span className="label-text">{t('system.logging.maxSize')}</span>
          <input
            type="number"
            className="config-input"
            value={loggingConfig.maxSize || 10485760}
            onChange={(e) => setLoggingConfig({
              ...loggingConfig,
              maxSize: parseInt(e.target.value) || 10485760
            })}
            min="1048576"
          />
          <span className="help-text">{t('system.logging.maxSizeHint')}</span>
        </label>

        <label className="config-label">
          <span className="label-text">{t('system.logging.maxFiles')}</span>
          <input
            type="number"
            className="config-input"
            value={loggingConfig.maxFiles || 5}
            onChange={(e) => setLoggingConfig({
              ...loggingConfig,
              maxFiles: parseInt(e.target.value) || 5
            })}
            min="1"
            max="100"
          />
          <span className="help-text">{t('system.logging.maxFilesHint')}</span>
        </label>
      </section>

      {/* 代理配置 */}
      <section className="config-section">
        <h4>{t('system.proxy.title')}</h4>

        <label className="config-label">
          <span className="label-text">{t('system.proxy.http')}</span>
          <input
            type="text"
            className="config-input"
            value={proxyConfig.http || ''}
            onChange={(e) => setProxyConfig({
              ...proxyConfig,
              http: e.target.value
            })}
            placeholder={t('placeholder.httpProxy')}
          />
        </label>

        <label className="config-label">
          <span className="label-text">{t('system.proxy.https')}</span>
          <input
            type="text"
            className="config-input"
            value={proxyConfig.https || ''}
            onChange={(e) => setProxyConfig({
              ...proxyConfig,
              https: e.target.value
            })}
            placeholder={t('placeholder.httpsProxy')}
          />
        </label>

        <details className="config-details">
          <summary className="config-summary">{t('system.proxy.auth')}</summary>
          <div className="config-details-content">
            <label className="config-label">
              <span className="label-text">{t('system.proxy.username')}</span>
              <input
                type="text"
                className="config-input"
                value={proxyConfig.auth?.username || ''}
                onChange={(e) => setProxyConfig({
                  ...proxyConfig,
                  auth: {
                    ...proxyConfig.auth,
                    username: e.target.value
                  }
                })}
              />
            </label>
            <label className="config-label">
              <span className="label-text">{t('system.proxy.password')}</span>
              <input
                type="password"
                className="config-input"
                value={proxyConfig.auth?.password || ''}
                onChange={(e) => setProxyConfig({
                  ...proxyConfig,
                  auth: {
                    ...proxyConfig.auth,
                    password: e.target.value
                  }
                })}
              />
            </label>
          </div>
        </details>
      </section>

      {/* 缓存配置 */}
      <section className="config-section">
        <h4>{t('system.cache.title')}</h4>

        <label className="config-label config-checkbox">
          <input
            type="checkbox"
            checked={cacheConfig.enabled || false}
            onChange={(e) => setCacheConfig({
              ...cacheConfig,
              enabled: e.target.checked
            })}
          />
          <span className="label-text">{t('system.cache.enable')}</span>
        </label>

        {cacheConfig.enabled && (
          <>
            <label className="config-label">
              <span className="label-text">{t('system.cache.location')}</span>
              <input
                type="text"
                className="config-input"
                value={cacheConfig.location || ''}
                onChange={(e) => setCacheConfig({
                  ...cacheConfig,
                  location: e.target.value
                })}
                placeholder={t('placeholder.cacheLocation')}
              />
              <span className="help-text">{t('system.cache.locationHint')}</span>
            </label>

            <label className="config-label">
              <span className="label-text">{t('system.cache.maxSize')}</span>
              <input
                type="number"
                className="config-input"
                value={cacheConfig.maxSize || 104857600}
                onChange={(e) => setCacheConfig({
                  ...cacheConfig,
                  maxSize: parseInt(e.target.value) || 104857600
                })}
                min="1048576"
              />
              <span className="help-text">{t('system.cache.maxSizeHint')}</span>
            </label>

            <label className="config-label">
              <span className="label-text">{t('system.cache.ttl')}</span>
              <input
                type="number"
                className="config-input"
                value={cacheConfig.ttl || 86400}
                onChange={(e) => setCacheConfig({
                  ...cacheConfig,
                  ttl: parseInt(e.target.value) || 86400
                })}
                min="60"
              />
              <span className="help-text">{t('system.cache.ttlHint')}</span>
            </label>
          </>
        )}
      </section>

      {/* 安全配置 */}
      <section className="config-section">
        <h4>{t('system.security.title')}</h4>

        <label className="config-label">
          <span className="label-text">{t('system.security.sensitiveFiles')}</span>
          <textarea
            className="config-textarea"
            value={securityConfig.sensitiveFiles?.join('\n') || ''}
            onChange={(e) => setSecurityConfig({
              ...securityConfig,
              sensitiveFiles: e.target.value.split('\n').filter(Boolean)
            })}
            placeholder={t('placeholder.sensitiveFiles')}
            rows={4}
          />
          <span className="help-text">{t('system.security.sensitiveFilesHint')}</span>
        </label>

        <label className="config-label">
          <span className="label-text">{t('system.security.dangerousCommands')}</span>
          <textarea
            className="config-textarea"
            value={securityConfig.dangerousCommands?.join('\n') || ''}
            onChange={(e) => setSecurityConfig({
              ...securityConfig,
              dangerousCommands: e.target.value.split('\n').filter(Boolean)
            })}
            placeholder={t('placeholder.dangerousCommands')}
            rows={4}
          />
          <span className="help-text">{t('system.security.dangerousCommandsHint')}</span>
        </label>

        <label className="config-label config-checkbox">
          <input
            type="checkbox"
            checked={securityConfig.allowSandboxEscape || false}
            onChange={(e) => setSecurityConfig({
              ...securityConfig,
              allowSandboxEscape: e.target.checked
            })}
          />
          <span className="label-text">{t('system.security.allowSandboxEscape')}</span>
          <span className="help-text danger">{t('system.security.allowSandboxEscapeHint')}</span>
        </label>
      </section>

      <div className="config-actions">
        <button
          className="config-btn config-btn-primary"
          onClick={handleSaveAll}
          disabled={loading}
        >
          {loading ? t('system.saving') : t('system.save')}
        </button>
        {onClose && (
          <button
            className="config-btn config-btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            {t('system.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

export default SystemConfigPanel;
