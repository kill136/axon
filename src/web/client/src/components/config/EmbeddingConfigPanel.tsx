/**
 * Embedding 配置面板
 * 配置向量搜索 + 混合检索
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '../../i18n';
import '../../styles/config-panels.css';

interface EmbeddingConfig {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
  hybrid?: {
    enabled?: boolean;
    vectorWeight?: number;
    textWeight?: number;
  };
  mmr?: {
    enabled?: boolean;
    lambda?: number;
  };
}

export function EmbeddingConfigPanel() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<EmbeddingConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 加载配置
  useEffect(() => {
    setLoading(true);
    fetch('/api/config/embedding')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setConfig(data.data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/config/embedding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: t('embedding.saved') });
      } else {
        setMessage({ type: 'error', text: t('embedding.saveFailed', { error: data.error || 'Unknown' }) });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: t('embedding.saveFailed', { error: err.message }) });
    } finally {
      setSaving(false);
    }
  };

  const isConfigured = !!(config.apiKey && config.apiKey.length > 0 && !config.apiKey.includes('...'));

  if (loading) {
    return <div className="mcp-loading">Loading...</div>;
  }

  return (
    <div className="config-panel">
      <h3>{t('embedding.title')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
        {t('embedding.description')}
      </p>

      {/* Status indicator */}
      <div style={{
        padding: '8px 12px',
        marginBottom: '16px',
        borderRadius: '4px',
        fontSize: '13px',
        backgroundColor: config.apiKey ? 'rgba(34, 197, 94, 0.1)' : 'rgba(156, 163, 175, 0.1)',
        border: `1px solid ${config.apiKey ? 'rgba(34, 197, 94, 0.3)' : 'rgba(156, 163, 175, 0.3)'}`,
        color: config.apiKey ? '#22c55e' : 'var(--text-secondary)',
      }}>
        {config.apiKey ? t('embedding.status.configured') : t('embedding.status.noKey')}
      </div>

      {/* API Key */}
      <div className="mcp-form-group">
        <label className="mcp-form-label">{t('embedding.apiKey')}</label>
        <input
          type="password"
          className="mcp-form-input"
          placeholder={t('embedding.apiKey.placeholder')}
          value={config.apiKey || ''}
          onChange={e => setConfig({ ...config, apiKey: e.target.value })}
        />
        <span className="mcp-form-help">{t('embedding.apiKey.help')}</span>
      </div>

      {/* Base URL */}
      <div className="mcp-form-group">
        <label className="mcp-form-label">{t('embedding.baseUrl')}</label>
        <input
          type="text"
          className="mcp-form-input"
          placeholder={t('embedding.baseUrl.placeholder')}
          value={config.baseUrl || ''}
          onChange={e => setConfig({ ...config, baseUrl: e.target.value })}
        />
      </div>

      {/* Model & Dimensions */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <div className="mcp-form-group" style={{ flex: 2 }}>
          <label className="mcp-form-label">{t('embedding.model')}</label>
          <input
            type="text"
            className="mcp-form-input"
            placeholder={t('embedding.model.placeholder')}
            value={config.model || ''}
            onChange={e => setConfig({ ...config, model: e.target.value })}
          />
        </div>
        <div className="mcp-form-group" style={{ flex: 1 }}>
          <label className="mcp-form-label">{t('embedding.dimensions')}</label>
          <input
            type="number"
            className="mcp-form-input"
            value={config.dimensions || 1536}
            onChange={e => setConfig({ ...config, dimensions: parseInt(e.target.value) || 1536 })}
            min={64}
            max={4096}
          />
        </div>
      </div>

      {/* Hybrid Search */}
      <div style={{ marginTop: '16px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{t('embedding.hybrid.title')}</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
          <input
            type="checkbox"
            checked={config.hybrid?.enabled ?? true}
            onChange={e => setConfig({
              ...config,
              hybrid: { ...config.hybrid, enabled: e.target.checked },
            })}
          />
          <span style={{ fontSize: '13px' }}>{t('embedding.hybrid.enabled')}</span>
        </label>
        {(config.hybrid?.enabled ?? true) && (
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <div className="mcp-form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="mcp-form-label" style={{ fontSize: '12px' }}>
                {t('embedding.hybrid.vectorWeight')}: {config.hybrid?.vectorWeight ?? 0.6}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={config.hybrid?.vectorWeight ?? 0.6}
                onChange={e => {
                  const vw = parseFloat(e.target.value);
                  setConfig({
                    ...config,
                    hybrid: { ...config.hybrid, vectorWeight: vw, textWeight: Math.round((1 - vw) * 10) / 10 },
                  });
                }}
                style={{ width: '100%' }}
              />
            </div>
            <div className="mcp-form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="mcp-form-label" style={{ fontSize: '12px' }}>
                {t('embedding.hybrid.textWeight')}: {config.hybrid?.textWeight ?? 0.4}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={config.hybrid?.textWeight ?? 0.4}
                onChange={e => {
                  const tw = parseFloat(e.target.value);
                  setConfig({
                    ...config,
                    hybrid: { ...config.hybrid, textWeight: tw, vectorWeight: Math.round((1 - tw) * 10) / 10 },
                  });
                }}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* MMR */}
      <div style={{ marginTop: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px' }}>{t('embedding.mmr.title')}</h4>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '8px' }}>
          <input
            type="checkbox"
            checked={config.mmr?.enabled ?? false}
            onChange={e => setConfig({
              ...config,
              mmr: { ...config.mmr, enabled: e.target.checked },
            })}
          />
          <span style={{ fontSize: '13px' }}>{t('embedding.mmr.enabled')}</span>
        </label>
        {config.mmr?.enabled && (
          <div className="mcp-form-group" style={{ marginBottom: 0 }}>
            <label className="mcp-form-label" style={{ fontSize: '12px' }}>
              {t('embedding.mmr.lambda')}: {config.mmr?.lambda ?? 0.7}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.mmr?.lambda ?? 0.7}
              onChange={e => setConfig({
                ...config,
                mmr: { ...config.mmr, lambda: parseFloat(e.target.value) },
              })}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>

      {/* Messages */}
      {message && (
        <div style={{
          marginTop: '12px',
          padding: '8px 12px',
          borderRadius: '4px',
          fontSize: '13px',
          backgroundColor: message.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${message.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
          color: message.type === 'success' ? '#22c55e' : '#ef4444',
        }}>
          {message.text}
        </div>
      )}

      {/* Save button */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          className="mcp-btn-primary mcp-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t('embedding.saving') : t('embedding.save')}
        </button>
      </div>
    </div>
  );
}

export default EmbeddingConfigPanel;
