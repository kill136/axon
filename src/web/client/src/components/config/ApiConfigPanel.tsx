/**
 * API 配置面板组件
 * 用于配置 Claude API 的高级参数
 */

import { useState, useEffect } from 'react';
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
function validateConfig(config: ApiConfig): string | null {
  // 验证 temperature
  if (config.temperature !== undefined) {
    if (config.temperature < 0 || config.temperature > 1) {
      return 'Temperature 必须在 0 到 1 之间';
    }
  }

  // 验证 maxTokens
  if (config.maxTokens !== undefined) {
    if (config.maxTokens < 1 || config.maxTokens > 200000) {
      return 'Max Output Tokens 必须在 1 到 200000 之间';
    }
  }

  // 验证 maxRetries
  if (config.maxRetries !== undefined) {
    if (config.maxRetries < 0 || config.maxRetries > 10) {
      return 'Max Retries 必须在 0 到 10 之间';
    }
  }

  // 验证 requestTimeout
  if (config.requestTimeout !== undefined) {
    if (config.requestTimeout < 1000 || config.requestTimeout > 600000) {
      return 'Request Timeout 必须在 1000 到 600000 毫秒之间';
    }
  }

  // 验证 apiBaseUrl
  if (config.apiBaseUrl !== undefined && config.apiBaseUrl.trim() !== '') {
    try {
      new URL(config.apiBaseUrl);
    } catch {
      return 'API Base URL 格式无效，必须是有效的 URL（如 https://api.example.com）';
    }
  }

  return null;
}

/**
 * API 配置面板组件
 */
export function ApiConfigPanel({ onSave, onClose }: ApiConfigPanelProps) {
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
  });

  // 加载状态
  const [loading, setLoading] = useState(false);
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 验证错误
  const [validationError, setValidationError] = useState<string | null>(null);
  // 测试状态
  const [testing, setTesting] = useState(false);
  // 测试成功消息
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

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
      if (data.success && data.config) {
        setConfig(data.config);
      }
    } catch (err) {
      setError('加载配置失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  /**
   * 保存配置
   */
  const handleSave = async () => {
    // 验证配置
    const validationErr = validateConfig(config);
    if (validationErr) {
      setValidationError(validationErr);
      return;
    }

    setValidationError(null);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/config/api', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await response.json();

      if (data.success) {
        onSave?.(config);
        setError(null);
      } else {
        setError(data.error || '保存失败');
      }
    } catch (err) {
      setError('保存配置失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  };

  /**
   * 更新配置字段
   */
  const updateConfig = (field: keyof ApiConfig, value: any) => {
    setConfig({ ...config, [field]: value });
    setValidationError(null); // 清除验证错误
    setTestSuccess(null); // 清除测试成功消息
  };

  /**
   * 测试 API 连接
   */
  const handleTest = async () => {
    // 验证必填项
    if (!config.apiKey || config.apiKey.trim() === '') {
      setValidationError('请先输入 API Key');
      return;
    }

    setTesting(true);
    setError(null);
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
        setTestSuccess(`连接成功！模型: ${data.data.model}，端点: ${data.data.baseUrl}`);
        setError(null);
      } else {
        setError(data.error || '连接测试失败');
        setTestSuccess(null);
      }
    } catch (err) {
      setError('测试连接失败: ' + (err instanceof Error ? err.message : String(err)));
      setTestSuccess(null);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="api-config-panel">
      <div className="settings-section">
        <h3>API Configuration</h3>
        <p className="settings-description">
          配置 Claude API 的高级参数，这些设置会影响 AI 的行为和性能。
        </p>

        {/* 错误消息 */}
        {(error || validationError) && (
          <div className="mcp-form-error">
            {validationError || error}
          </div>
        )}

        {/* 成功消息 */}
        {testSuccess && (
          <div className="mcp-form-success" style={{ 
            padding: '12px', 
            marginBottom: '16px', 
            backgroundColor: 'rgba(34, 197, 94, 0.1)', 
            border: '1px solid rgba(34, 197, 94, 0.3)', 
            borderRadius: '4px',
            color: '#22c55e'
          }}>
            ✓ {testSuccess}
          </div>
        )}

        {/* 配置表单 */}
        <div className="config-form">
          {/* Temperature */}
          <div className="mcp-form-group">
            <label>
              Temperature (0-1)
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
              控制输出的随机性。较低的值 (0.0-0.3) 使输出更聚焦和确定，较高的值 (0.7-1.0) 使输出更有创造性和多样性。默认: 1.0
            </span>
          </div>

          {/* Max Output Tokens */}
          <div className="mcp-form-group">
            <label>
              Max Output Tokens (1-200000)
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
              限制 AI 响应的最大长度（以 tokens 为单位）。较大的值允许更长的响应，但会消耗更多资源。默认: 32000
            </span>
          </div>

          {/* Max Retries */}
          <div className="mcp-form-group">
            <label>
              Max Retries (0-10)
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
              API 请求失败时的最大重试次数。设置为 0 则不重试。默认: 3
            </span>
          </div>

          {/* Request Timeout */}
          <div className="mcp-form-group">
            <label>
              Request Timeout (ms)
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
              API 请求的超时时间（毫秒）。超过此时间未响应将取消请求。默认: 300000 (5分钟)
            </span>
          </div>

          {/* API Provider */}
          <div className="mcp-form-group">
            <label>
              API Provider
              <select
                className="mcp-form-input"
                value={config.apiProvider ?? 'anthropic'}
                onChange={(e) => updateConfig('apiProvider', e.target.value as ApiConfig['apiProvider'])}
              >
                <option value="anthropic">Anthropic (Default)</option>
                <option value="bedrock">AWS Bedrock</option>
                <option value="vertex">Google Vertex AI</option>
              </select>
            </label>
            <span className="help-text">
              选择 Claude API 的提供商。不同的提供商可能有不同的功能和定价。
            </span>
          </div>

          {/* 分隔线 */}
          <div style={{ margin: '24px 0', borderTop: '1px solid var(--border-color)' }} />
          <h4 style={{ marginBottom: '16px', color: 'var(--text-primary)' }}>自定义 API 配置</h4>
          <p className="help-text" style={{ marginBottom: '16px' }}>
            以下配置用于对接第三方兼容 Claude API 的服务。设置自定义 API Key 后，将优先使用该 Key 而不是 OAuth 认证。
          </p>

          {/* API Base URL */}
          <div className="mcp-form-group">
            <label>
              API Base URL
              <input
                type="text"
                className="mcp-form-input"
                placeholder="https://api.anthropic.com"
                value={config.apiBaseUrl ?? ''}
                onChange={(e) => updateConfig('apiBaseUrl', e.target.value)}
              />
            </label>
            <span className="help-text">
              自定义 API 端点地址。留空则使用默认端点。用于对接第三方兼容的 Claude API 服务。
            </span>
          </div>

          {/* API Key */}
          <div className="mcp-form-group">
            <label>
              API Key
              <input
                type="password"
                className="mcp-form-input"
                placeholder="sk-ant-..."
                value={config.apiKey ?? ''}
                onChange={(e) => updateConfig('apiKey', e.target.value)}
              />
            </label>
            <span className="help-text">
              自定义 API 密钥。设置后将优先使用此密钥而不是 OAuth 认证。密钥将被加密存储。留空则使用 OAuth 认证。
            </span>
          </div>

          {/* Custom Model Name */}
          <div className="mcp-form-group">
            <label>
              自定义模型名称
              <input
                type="text"
                className="mcp-form-input"
                placeholder="claude-3-opus-20240229"
                value={config.customModelName ?? ''}
                onChange={(e) => updateConfig('customModelName', e.target.value)}
              />
            </label>
            <span className="help-text">
              自定义模型名称，用于第三方 API。设置后将覆盖内置模型选择。留空则使用界面上选择的模型。
            </span>
          </div>

          {/* Auth Priority */}
          <div className="mcp-form-group">
            <label>
              认证优先级
              <select
                className="mcp-form-input"
                value={config.authPriority ?? 'auto'}
                onChange={(e) => updateConfig('authPriority', e.target.value as ApiConfig['authPriority'])}
              >
                <option value="auto">自动（有 API Key 则优先使用）</option>
                <option value="apiKey">API Key 优先</option>
                <option value="oauth">OAuth 优先</option>
              </select>
            </label>
            <span className="help-text">
              选择认证方式的优先级。"自动"模式下，如果设置了 API Key 则使用 Key，否则使用 OAuth。
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="mcp-form-actions">
          {onClose && (
            <button
              className="mcp-btn-secondary mcp-btn"
              onClick={onClose}
              disabled={loading || testing}
            >
              取消
            </button>
          )}
          <button
            className="mcp-btn-secondary mcp-btn"
            onClick={handleTest}
            disabled={loading || testing}
            style={{ marginLeft: 'auto' }}
          >
            {testing ? '测试中...' : '测试连接'}
          </button>
          <button
            className="mcp-btn-primary mcp-btn"
            onClick={handleSave}
            disabled={loading || testing}
          >
            {loading ? '保存中...' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApiConfigPanel;
