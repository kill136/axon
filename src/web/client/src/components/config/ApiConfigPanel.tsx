/**
 * API 配置面板组件
 * 用于配置 Claude API 的高级参数
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '../../i18n';
import '../../styles/config-panels.css';

/**
 * API 配置接口
 */
interface ApiConfig {
  /** Temperature 参数 (0-1) */
  temperature?: number;
  /** 最大输出 tokens */
  maxTokens?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 请求超时时间(ms) */
  requestTimeout?: number;
  /** API Provider */
  apiProvider?: 'anthropic' | 'bedrock' | 'vertex';
  /** 自定义 API Base URL */
  apiBaseUrl?: string;
  /** 自定义 API Key */
  apiKey?: string;
  /** 自定义模型名称（用于第三方 API） */
  customModelName?: string;
  /** 认证优先级 */
  authPriority?: 'apiKey' | 'oauth' | 'auto';
  /** Gemini API Key（图片生成） */
  geminiApiKey?: string;
}

/**
 * 组件属性
 */
interface ApiConfigPanelProps {
  /** 保存回调 */
  onSave?: (config: ApiConfig) => void;
  /** 关闭回调 */
  onClose?: () => void;
}

/**
 * 验证配置的有效性
 */
function validateConfig(config: ApiConfig, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  // 验证 temperature
  if (config.temperature !== undefined) {
    if (config.temperature < 0 || config.temperature > 1) {
      return t('apiConfig.temperature.error');
    }
  }

  // 验证 maxTokens
  if (config.maxTokens !== undefined) {
    if (config.maxTokens < 1 || config.maxTokens > 200000) {
      return t('apiConfig.maxTokens.error');
    }
  }

  // 验证 maxRetries
  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 0 || config.maxRetries > 10) {
      return t('apiConfig.maxRetries.error');
    }
  }

  // 验证 requestTimeout
  if (config.requestTimeout !== undefined) {
    if (config.requestTimeout < 1000 || config.requestTimeout > 600000) {
      return t('apiConfig.requestTimeout.error');
    }
  }

  // 验证 apiBaseUrl
  if (config.apiBaseUrl !== undefined && config.apiBaseUrl.trim() !== '') {
    try {
      new URL(config.apiBaseUrl);
    } catch {
      return t('apiConfig.baseUrl.error');
    }
  }

  return null;
}

/**
 * API 配置面板组件
 */
export function ApiConfigPanel({ onSave, onClose }: ApiConfigPanelProps) {
  const { t } = useLanguage();
  // 配置状态
  const [config, setConfig] = useState<ApiConfig>({
    temperature: 1.0,
    maxTokens: 32000,
    maxRetries: 3,
    requestTimeout: 300000,
    apiProvider: 'anthropic',
    apiBaseUrl: '',
    apiKey: '',
    customModelName: '',
    authPriority: 'auto',
    geminiApiKey: '',
  });

  // 跟踪 apiKey 是否被用户手动修改过（防止掩码值或空值覆盖已有 key）
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [geminiKeyDirty, setGeminiKeyDirty] = useState(false);

  // 加载状态
  const [loading, setLoading] = useState(false);
  // 加载/保存错误（顶部显示）
  const [error, setError] = useState<string | null>(null);
  // 验证错误（按钮附近显示）
  const [validationError, setValidationError] = useState<string | null>(null);
  // 测试状态
  const [testing, setTesting] = useState(false);
  // 测试成功消息（按钮附近显示）
  const [testSuccess, setTestSuccess] = useState<string | null>(null);
  // 测试失败消息（按钮附近显示）
  const [testError, setTestError] = useState<string | null>(null);
  // 保存成功消息
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  /**
   * 加载当前配置
   */
  useEffect(() => {
    fetchCurrentConfig();
  }, []);

  /**
   * 从服务器获取当前配置
   */
  const fetchCurrentConfig = async () => {
    try {
      const response = await fetch('/api/config/api');
      const data = await response.json();
      if (data.success && data.data) {
        setConfig(prev => ({
          ...prev,
          ...data.data,
          // 服务器返回什么就用什么，不回退到默认值（否则用户无法清空）
          apiBaseUrl: data.data.apiBaseUrl || '',
          apiKey: data.data.apiKey || '',
          geminiApiKey: data.data.geminiApiKey || '',
        }));
      }
    } catch (err) {
      setError(t('apiConfig.loadFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  /**
   * 保存配置
   */
  const handleSave = async () => {
    // 验证配置
    const validationErr = validateConfig(config, t);
    if (validationErr) {
      setValidationError(validationErr);
      return;
    }

    setValidationError(null);
    setLoading(true);
    setError(null);

    try {
      // 如果 apiKey 没被用户修改过，不发送（避免掩码值覆盖真实 key）
      const payload = { ...config };
      if (!apiKeyDirty) {
        delete payload.apiKey;
      }
      if (!geminiKeyDirty) {
        delete payload.geminiApiKey;
      }

      const response = await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (data.success) {
        onSave?.(config);
        setError(null);
        setApiKeyDirty(false);
        setGeminiKeyDirty(false);
        setSaveSuccess(t('apiConfig.saved'));
        // 重新加载配置以获取更新后的掩码值
        fetchCurrentConfig();
        setTimeout(() => setSaveSuccess(null), 3000);
      } else {
        setError(data.error || t('apiConfig.saveFailed', { error: '' }));
      }
    } catch (err) {
      setError(t('apiConfig.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 更新配置字段
   */
  const updateConfig = (field: keyof ApiConfig, value: any) => {
    setConfig({ ...config, [field]: value });
    setValidationError(null);
    setTestSuccess(null);
    setTestError(null);
    setSaveSuccess(null);
  };

  /**
   * 测试 API 连接
   */
  const handleTest = async () => {
    // 验证必填项：apiKey 为空且未被用户修改过时，可能后端有已保存的 key，允许测试
    // 只在完全没有 key（无掩码值且未输入新 key）时报错
    const hasExistingKey = !apiKeyDirty && config.apiKey && config.apiKey.includes('...');
    if (!hasExistingKey && (!config.apiKey || config.apiKey.trim() === '')) {
      setValidationError(t('apiConfig.apiKey.required'));
      return;
    }

    setTesting(true);
    setTestError(null);
    setTestSuccess(null);
    setValidationError(null);

    try {
      const response = await fetch('/api/config/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiBaseUrl: config.apiBaseUrl || '',
          apiKey: config.apiKey,
          customModelName: config.customModelName || '',
        }),
      });

      const data = await response.json();

      if (data.success) {
        setTestSuccess(t('apiConfig.testSuccess', { model: data.data.model, baseUrl: data.data.baseUrl }));
        setTestError(null);
      } else {
        setTestError(data.error || t('apiConfig.testFailed', { error: '' }));
        setTestSuccess(null);
      }
    } catch (err) {
      setTestError(t('apiConfig.testFailed', { error: err instanceof Error ? err.message : String(err) }));
      setTestSuccess(null);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="api-config-panel">
      <div className="settings-section">
        <h3>{t('apiConfig.title')}</h3>
        <p className="settings-description">
          {t('apiConfig.description')}
        </p>

        {/* 加载/保存错误消息（顶部显示） */}
        {error && (
          <div className="mcp-form-error">
            {error}
          </div>
        )}

        {/* 配置表单 */}
        <div className="config-form">
          {/* Temperature */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.temperature.label')}
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                className="mcp-form-input"
                value={config.temperature ?? 1.0}
                onChange={(e) => updateConfig('temperature', parseFloat(e.target.value))}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.temperature.help')}
            </span>
          </div>

          {/* Max Output Tokens */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.maxTokens.label')}
              <input
                type="number"
                min="1"
                max="200000"
                step="1000"
                className="mcp-form-input"
                value={config.maxTokens ?? 32000}
                onChange={(e) => updateConfig('maxTokens', parseInt(e.target.value, 10))}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.maxTokens.help')}
            </span>
          </div>

          {/* Max Retries */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.maxRetries.label')}
              <input
                type="number"
                min="0"
                max="10"
                step="1"
                className="mcp-form-input"
                value={config.maxRetries ?? 3}
                onChange={(e) => updateConfig('maxRetries', parseInt(e.target.value, 10))}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.maxRetries.help')}
            </span>
          </div>

          {/* Request Timeout */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.requestTimeout.label')}
              <input
                type="number"
                min="1000"
                max="600000"
                step="1000"
                className="mcp-form-input"
                value={config.requestTimeout ?? 300000}
                onChange={(e) => updateConfig('requestTimeout', parseInt(e.target.value, 10))}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.requestTimeout.help')}
            </span>
          </div>

          {/* API Provider */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.provider.label')}
              <select
                className="mcp-form-input"
                value={config.apiProvider ?? 'anthropic'}
                onChange={(e) => updateConfig('apiProvider', e.target.value as ApiConfig['apiProvider'])}
              >
                <option value="anthropic">{t('apiConfig.provider.anthropic')}</option>
                <option value="bedrock">{t('apiConfig.provider.bedrock')}</option>
                <option value="vertex">{t('apiConfig.provider.vertex')}</option>
              </select>
            </label>
            <span className="help-text">
              {t('apiConfig.provider.help')}
            </span>
          </div>

          {/* 分隔线 */}
          <div style={{ margin: '24px 0', borderTop: '1px solid var(--border-color)' }} />
          <h4 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>{t('apiConfig.custom.title')}</h4>
          <p className="help-text" style={{ marginBottom: '16px' }}>
            {t('apiConfig.custom.description')}
          </p>

          {/* API Base URL */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.baseUrl.label')}
              <input
                type="text"
                className="mcp-form-input"
                placeholder={t('placeholder.apiBaseUrl')}
                value={config.apiBaseUrl ?? ''}
                onChange={(e) => updateConfig('apiBaseUrl', e.target.value)}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.baseUrl.help')}
            </span>
          </div>

          {/* API Key */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.apiKey.label')}
              <input
                type={apiKeyDirty ? 'password' : 'text'}
                className="mcp-form-input"
                placeholder={t('placeholder.apiKey')}
                value={config.apiKey ?? ''}
                onFocus={() => {
                  // 聚焦时，如果显示的是掩码值，清空以便输入新 key
                  if (!apiKeyDirty && config.apiKey && config.apiKey.includes('...')) {
                    setConfig(prev => ({ ...prev, apiKey: '' }));
                  }
                }}
                onChange={(e) => {
                  setApiKeyDirty(true);
                  updateConfig('apiKey', e.target.value);
                }}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.apiKey.help')}
            </span>
          </div>

          {/* Custom Model Name */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.customModel.label')}
              <input
                type="text"
                className="mcp-form-input"
                placeholder={t('placeholder.customModel')}
                value={config.customModelName ?? ''}
                onChange={(e) => updateConfig('customModelName', e.target.value)}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.customModel.help')}
            </span>
          </div>

          {/* Auth Priority */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.authPriority.label')}
              <select
                className="mcp-form-input"
                value={config.authPriority ?? 'auto'}
                onChange={(e) => updateConfig('authPriority', e.target.value as ApiConfig['authPriority'])}
              >
                <option value="auto">{t('apiConfig.authPriority.auto')}</option>
                <option value="apiKey">{t('apiConfig.authPriority.apiKey')}</option>
                <option value="oauth">{t('apiConfig.authPriority.oauth')}</option>
              </select>
            </label>
            <span className="help-text">
              {t('apiConfig.authPriority.help')}
            </span>
          </div>

          {/* 分隔线 - Gemini */}
          <div style={{ margin: '24px 0', borderTop: '1px solid var(--border-color)' }} />
          <h4 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>{t('apiConfig.gemini.title')}</h4>
          <p className="help-text" style={{ marginBottom: '16px' }}>
            {t('apiConfig.gemini.description')}
          </p>

          {/* Gemini API Key */}
          <div className="mcp-form-group">
            <label>
              {t('apiConfig.geminiApiKey.label')}
              <input
                type={geminiKeyDirty ? 'password' : 'text'}
                className="mcp-form-input"
                placeholder={t('apiConfig.geminiApiKey.placeholder')}
                value={config.geminiApiKey ?? ''}
                onFocus={() => {
                  if (!geminiKeyDirty && config.geminiApiKey && config.geminiApiKey.includes('...')) {
                    setConfig(prev => ({ ...prev, geminiApiKey: '' }));
                  }
                }}
                onChange={(e) => {
                  setGeminiKeyDirty(true);
                  updateConfig('geminiApiKey', e.target.value);
                }}
              />
            </label>
            <span className="help-text">
              {t('apiConfig.geminiApiKey.help')}
            </span>
          </div>
        </div>

        {/* 验证/测试错误（按钮上方显示，保证可见） */}
        {(validationError || testError) && (
          <div className="mcp-form-error" style={{ marginBottom: '12px' }}>
            {validationError || testError}
          </div>
        )}

        {/* 测试成功消息（按钮上方显示，保证可见） */}
        {testSuccess && (
          <div style={{
            padding: '10px 12px',
            marginBottom: '12px',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '4px',
            color: '#22c55e',
            fontSize: '13px',
          }}>
            ✓ {testSuccess}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mcp-form-actions">
          {onClose && (
            <button
              className="mcp-btn-secondary mcp-btn"
              onClick={onClose}
              disabled={loading || testing}
            >
              {t('apiConfig.cancel')}
            </button>
          )}
          <button
            className="mcp-btn-secondary mcp-btn"
            onClick={handleTest}
            disabled={loading || testing}
            style={{ marginLeft: 'auto' }}
          >
            {testing ? t('apiConfig.testing') : t('apiConfig.testConnection')}
          </button>
          <button
            className="mcp-btn-primary mcp-btn"
            onClick={handleSave}
            disabled={loading || testing}
          >
            {loading ? t('apiConfig.saving') : t('apiConfig.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApiConfigPanel;
