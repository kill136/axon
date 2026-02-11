/**
 * 系统配置面板组件
 * 用于配置系统相关的设置（日志、代理、缓存、安全等）
 */

import { useState, useEffect } from 'react';
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
      setMessage({ type: 'error', text: '加载配置失败' });
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
      throw new Error(data.error || 'Failed to save logging config');
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
      throw new Error(data.error || 'Failed to save proxy config');
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
      throw new Error(data.error || 'Failed to save cache config');
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
      throw new Error(data.error || 'Failed to save security config');
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

      setMessage({ type: 'success', text: '系统配置保存成功' });
      onSave?.();
    } catch (error) {
      console.error('Failed to save configs:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存配置失败'
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading && !loggingConfig.level) {
    return (
      <div className="system-config-panel">
        <div className="config-loading">加载配置中...</div>
      </div>
    );
  }

  return (
    <div className="system-config-panel">
      <div className="config-panel-header">
        <h3>系统配置 (System Configuration)</h3>
        <p className="config-description">
          配置日志、代理、缓存和安全相关设置
        </p>
      </div>

      {message && (
        <div className={`config-message config-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 日志配置 */}
      <section className="config-section">
        <h4>日志配置 (Logging Configuration)</h4>

        <label className="config-label">
          <span className="label-text">日志级别 (Log Level)</span>
          <select
            className="config-input config-select"
            value={loggingConfig.level}
            onChange={(e) => setLoggingConfig({
              ...loggingConfig,
              level: e.target.value as LoggingConfig['level']
            })}
          >
            <option value="debug">Debug (最详细)</option>
            <option value="info">Info (默认)</option>
            <option value="warn">Warning (警告)</option>
            <option value="error">Error (仅错误)</option>
          </select>
        </label>

        <label className="config-label">
          <span className="label-text">日志文件路径 (Log File Path)</span>
          <input
            type="text"
            className="config-input"
            value={loggingConfig.logPath || ''}
            onChange={(e) => setLoggingConfig({
              ...loggingConfig,
              logPath: e.target.value
            })}
            placeholder="/path/to/logfile.log"
          />
          <span className="help-text">留空则仅输出到控制台</span>
        </label>

        <label className="config-label">
          <span className="label-text">最大日志文件大小 (Max Log File Size, bytes)</span>
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
          <span className="help-text">默认: 10 MB (10485760 字节)</span>
        </label>

        <label className="config-label">
          <span className="label-text">保留日志文件数 (Max Log Files to Keep)</span>
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
          <span className="help-text">默认: 5</span>
        </label>
      </section>

      {/* 代理配置 */}
      <section className="config-section">
        <h4>代理配置 (Proxy Configuration)</h4>

        <label className="config-label">
          <span className="label-text">HTTP 代理</span>
          <input
            type="text"
            className="config-input"
            value={proxyConfig.http || ''}
            onChange={(e) => setProxyConfig({
              ...proxyConfig,
              http: e.target.value
            })}
            placeholder="http://proxy.example.com:8080"
          />
        </label>

        <label className="config-label">
          <span className="label-text">HTTPS 代理</span>
          <input
            type="text"
            className="config-input"
            value={proxyConfig.https || ''}
            onChange={(e) => setProxyConfig({
              ...proxyConfig,
              https: e.target.value
            })}
            placeholder="https://proxy.example.com:8443"
          />
        </label>

        <details className="config-details">
          <summary className="config-summary">代理认证 (Proxy Authentication, 可选)</summary>
          <div className="config-details-content">
            <label className="config-label">
              <span className="label-text">用户名 (Username)</span>
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
              <span className="label-text">密码 (Password)</span>
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
        <h4>缓存配置 (Cache Configuration)</h4>

        <label className="config-label config-checkbox">
          <input
            type="checkbox"
            checked={cacheConfig.enabled || false}
            onChange={(e) => setCacheConfig({
              ...cacheConfig,
              enabled: e.target.checked
            })}
          />
          <span className="label-text">启用缓存 (Enable Caching)</span>
        </label>

        {cacheConfig.enabled && (
          <>
            <label className="config-label">
              <span className="label-text">缓存位置 (Cache Location)</span>
              <input
                type="text"
                className="config-input"
                value={cacheConfig.location || ''}
                onChange={(e) => setCacheConfig({
                  ...cacheConfig,
                  location: e.target.value
                })}
                placeholder="/path/to/cache"
              />
              <span className="help-text">留空使用默认位置</span>
            </label>

            <label className="config-label">
              <span className="label-text">最大缓存大小 (Max Cache Size, bytes)</span>
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
              <span className="help-text">默认: 100 MB (104857600 字节)</span>
            </label>

            <label className="config-label">
              <span className="label-text">缓存过期时间 (Time to Live, seconds)</span>
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
              <span className="help-text">默认: 24 小时 (86400 秒)</span>
            </label>
          </>
        )}
      </section>

      {/* 安全配置 */}
      <section className="config-section">
        <h4>安全配置 (Security Configuration)</h4>

        <label className="config-label">
          <span className="label-text">敏感文件匹配模式 (Sensitive Files, glob patterns)</span>
          <textarea
            className="config-textarea"
            value={securityConfig.sensitiveFiles?.join('\n') || ''}
            onChange={(e) => setSecurityConfig({
              ...securityConfig,
              sensitiveFiles: e.target.value.split('\n').filter(Boolean)
            })}
            placeholder="**/.env&#10;**/*.key&#10;**/credentials.json"
            rows={4}
          />
          <span className="help-text">每行一个模式,匹配的文件将受到保护</span>
        </label>

        <label className="config-label">
          <span className="label-text">危险命令匹配模式 (Dangerous Commands, glob patterns)</span>
          <textarea
            className="config-textarea"
            value={securityConfig.dangerousCommands?.join('\n') || ''}
            onChange={(e) => setSecurityConfig({
              ...securityConfig,
              dangerousCommands: e.target.value.split('\n').filter(Boolean)
            })}
            placeholder="rm -rf *&#10;sudo *&#10;format *"
            rows={4}
          />
          <span className="help-text">每行一个模式,匹配的命令将需要额外确认</span>
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
          <span className="label-text">允许沙箱逃逸 (Allow Sandbox Escape)</span>
          <span className="help-text danger">高级选项,请谨慎使用</span>
        </label>
      </section>

      <div className="config-actions">
        <button
          className="config-btn config-btn-primary"
          onClick={handleSaveAll}
          disabled={loading}
        >
          {loading ? '保存中...' : '保存系统配置'}
        </button>
        {onClose && (
          <button
            className="config-btn config-btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}

export default SystemConfigPanel;
