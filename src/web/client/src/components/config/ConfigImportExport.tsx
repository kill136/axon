/**
 * 配置导入导出组件
 * 用于配置的导入、导出、验证和重置
 */

import { useState } from 'react';
import '../../styles/config-panels.css';

interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}

interface ConfigImportExportProps {
  onClose?: () => void;
}

export function ConfigImportExport({ onClose }: ConfigImportExportProps) {
  const [exportedConfig, setExportedConfig] = useState<string>('');
  const [importConfig, setImportConfig] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // 导出配置
  const handleExport = async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/export', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success && data.config) {
        const configStr = JSON.stringify(data.config, null, 2);
        setExportedConfig(configStr);
        setMessage({ type: 'success', text: '配置导出成功' });
      } else {
        throw new Error(data.error || '导出失败');
      }
    } catch (error) {
      console.error('Export failed:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导出配置失败'
      });
    } finally {
      setLoading(false);
    }
  };

  // 验证配置
  const handleValidate = async () => {
    if (!importConfig.trim()) {
      setMessage({ type: 'error', text: '请先粘贴配置 JSON' });
      return;
    }

    setLoading(true);
    setMessage(null);
    setValidationResult(null);

    try {
      // 先尝试解析 JSON
      let configObj;
      try {
        configObj = JSON.parse(importConfig);
      } catch (error) {
        setValidationResult({
          valid: false,
          errors: ['无效的 JSON 格式: ' + (error instanceof Error ? error.message : '解析失败')]
        });
        setLoading(false);
        return;
      }

      // 发送到服务器验证
      const response = await fetch('/api/config/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: configObj }),
      });

      const data = await response.json();
      setValidationResult(data);

      if (data.valid) {
        setMessage({ type: 'success', text: '配置验证通过' });
      } else {
        setMessage({ type: 'error', text: '配置验证失败,请查看错误详情' });
      }
    } catch (error) {
      console.error('Validation failed:', error);
      setValidationResult({
        valid: false,
        errors: ['验证失败: ' + (error instanceof Error ? error.message : '未知错误')]
      });
      setMessage({ type: 'error', text: '验证请求失败' });
    } finally {
      setLoading(false);
    }
  };

  // 导入配置
  const handleImport = async () => {
    if (!validationResult?.valid) {
      setMessage({ type: 'error', text: '请先验证配置' });
      return;
    }

    const confirmed = window.confirm(
      '确定要导入此配置吗?\n\n这将覆盖当前配置,且无法撤销。\n\n建议先导出当前配置作为备份。'
    );
    if (!confirmed) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: importConfig,
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: '配置导入成功!页面将在 3 秒后刷新...' });
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        throw new Error(data.error || '导入失败');
      }
    } catch (error) {
      console.error('Import failed:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导入配置失败'
      });
      setLoading(false);
    }
  };

  // 下载配置文件
  const handleDownload = () => {
    if (!exportedConfig) {
      setMessage({ type: 'error', text: '请先导出配置' });
      return;
    }

    try {
      const blob = new Blob([exportedConfig], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ type: 'success', text: '配置文件下载成功' });
    } catch (error) {
      console.error('Download failed:', error);
      setMessage({ type: 'error', text: '下载失败' });
    }
  };

  // 重置配置
  const handleReset = async () => {
    const confirmed1 = window.confirm(
      '确定要重置所有配置为默认值吗?\n\n此操作无法撤销!'
    );
    if (!confirmed1) {
      return;
    }

    const confirmed2 = window.confirm(
      '最后确认:\n\n这将删除您的所有自定义配置,包括:\n- API 密钥\n- MCP 服务器\n- 插件配置\n- 系统设置\n\n确定继续吗?'
    );
    if (!confirmed2) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/config/reset', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: '配置已重置!页面将在 3 秒后刷新...' });
        setTimeout(() => {
          window.location.reload();
        }, 3000);
      } else {
        throw new Error(data.error || '重置失败');
      }
    } catch (error) {
      console.error('Reset failed:', error);
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '重置配置失败'
      });
      setLoading(false);
    }
  };

  // 从文件读取配置
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setMessage({ type: 'error', text: '请选择 JSON 文件' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setImportConfig(content);
      setValidationResult(null);
      setMessage({ type: 'info', text: '文件已加载,请点击验证按钮检查配置' });
    };
    reader.onerror = () => {
      setMessage({ type: 'error', text: '读取文件失败' });
    };
    reader.readAsText(file);

    // 重置 input,允许选择同一个文件
    event.target.value = '';
  };

  return (
    <div className="config-import-export">
      <div className="config-panel-header">
        <h3>配置导入导出 (Configuration Import/Export)</h3>
        <p className="config-description">
          导出、导入或重置您的配置
        </p>
      </div>

      {message && (
        <div className={`config-message config-message-${message.type}`}>
          {message.text}
        </div>
      )}

      {/* 导出配置 */}
      <section className="config-section">
        <h4>导出配置 (Export Configuration)</h4>
        <p className="config-section-desc">
          导出当前配置为 JSON 格式。您可以保存此文件作为备份,或转移到其他安装。
        </p>

        <button
          className="config-btn config-btn-primary"
          onClick={handleExport}
          disabled={loading}
        >
          {loading ? '导出中...' : '导出当前配置'}
        </button>

        {exportedConfig && (
          <div className="config-export-result">
            <textarea
              className="config-textarea config-export-textarea"
              value={exportedConfig}
              readOnly
              rows={15}
            />
            <button
              className="config-btn config-btn-secondary"
              onClick={handleDownload}
            >
              下载为文件
            </button>
          </div>
        )}
      </section>

      {/* 导入配置 */}
      <section className="config-section">
        <h4>导入配置 (Import Configuration)</h4>
        <p className="config-section-desc">
          粘贴或上传配置 JSON。先点击"验证配置"检查错误,然后点击"导入配置"应用。
        </p>

        <div className="config-import-file">
          <label className="config-file-label">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="config-file-input"
            />
            <span className="config-btn config-btn-secondary">
              从文件加载
            </span>
          </label>
          <span className="help-text">或直接粘贴 JSON 到下方文本框</span>
        </div>

        <textarea
          className="config-textarea config-import-textarea"
          value={importConfig}
          onChange={(e) => {
            setImportConfig(e.target.value);
            setValidationResult(null);
          }}
          placeholder='粘贴配置 JSON 到此处...'
          rows={15}
        />

        <div className="config-import-actions">
          <button
            className="config-btn config-btn-secondary"
            onClick={handleValidate}
            disabled={loading || !importConfig.trim()}
          >
            {loading ? '验证中...' : '验证配置'}
          </button>
          <button
            className="config-btn config-btn-primary"
            onClick={handleImport}
            disabled={loading || !validationResult?.valid}
          >
            导入配置
          </button>
        </div>

        {validationResult && (
          <div className={`validation-result ${validationResult.valid ? 'valid' : 'invalid'}`}>
            {validationResult.valid ? (
              <div className="validation-success">
                <div className="validation-icon">✓</div>
                <div className="validation-text">配置有效</div>
              </div>
            ) : (
              <div className="validation-error">
                <div className="validation-icon">✗</div>
                <div className="validation-text">
                  <div className="validation-title">配置验证失败:</div>
                  {validationResult.errors && validationResult.errors.length > 0 && (
                    <ul className="validation-list">
                      {validationResult.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            {validationResult.warnings && validationResult.warnings.length > 0 && (
              <div className="validation-warnings">
                <div className="validation-warning-title">警告:</div>
                <ul className="validation-list">
                  {validationResult.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 配置重置 */}
      <section className="config-section config-section-danger">
        <h4>重置配置 (Reset Configuration)</h4>
        <p className="config-section-desc danger">
          重置所有配置为默认值。此操作无法撤销,请谨慎使用!
        </p>

        <button
          className="config-btn config-btn-danger"
          onClick={handleReset}
          disabled={loading}
        >
          重置为默认配置
        </button>
      </section>

      {onClose && (
        <div className="config-actions">
          <button
            className="config-btn config-btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

export default ConfigImportExport;
