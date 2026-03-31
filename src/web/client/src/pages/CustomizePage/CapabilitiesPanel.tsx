/**
 * CapabilitiesPanel - 能力全景面板
 *
 * 聚合展示 AI 的所有能力来源：
 * - 内置工具（active / deferred）— 支持点击编辑配置
 * - Skills（已安装的技能）
 * - MCP Servers（enabled / disabled）
 *
 * 工具配置覆盖持久化到 ~/.axon/tool-config.json
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import styles from './CapabilitiesPanel.module.css';

interface CapabilityItem {
  name: string;
  description: string;
  fullDescription?: string;
  source: 'builtin' | 'skill' | 'mcp';
  status: 'active' | 'disabled';
  deferred?: boolean;
  tools?: string[];
}

interface CapabilitySummary {
  totalBuiltin: number;
  activeBuiltin: number;
  deferredBuiltin: number;
  totalSkills: number;
  mcpEnabled: number;
  mcpDisabled: number;
}

interface CapabilitiesData {
  builtin: CapabilityItem[];
  skills: CapabilityItem[];
  mcp: {
    enabled: CapabilityItem[];
    disabled: CapabilityItem[];
  };
  summary: CapabilitySummary;
}

interface ToolConfigOverride {
  enabled?: boolean;
  description?: string;
  shouldDefer?: boolean;
  searchHint?: string;
}

type ToolConfigMap = Record<string, ToolConfigOverride>;

export default function CapabilitiesPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<CapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toolConfig, setToolConfig] = useState<ToolConfigMap>({});
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ToolConfigOverride>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // 加载能力数据和工具配置
  const loadData = useCallback(async () => {
    try {
      const [capRes, configRes] = await Promise.all([
        fetch('/api/capabilities'),
        fetch('/api/tool-config'),
      ]);
      const capData = await capRes.json();
      const configData = await configRes.json();
      setData(capData);
      setToolConfig(configData.config || {});
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 选中工具 → 加载配置到表单（带默认描述）
  const selectTool = (name: string) => {
    if (selectedTool === name) {
      setSelectedTool(null);
      return;
    }
    setSelectedTool(name);
    const existing = toolConfig[name] || {};
    // 如果没有描述覆盖，用工具的完整默认描述填充
    const tool = builtin.find(b => b.name === name);
    const defaultDesc = tool?.fullDescription || tool?.description || '';
    setEditForm({
      ...existing,
      description: existing.description || defaultDesc,
    });
  };

  // 保存工具配置
  const saveToolConfig = async () => {
    if (!selectedTool) return;
    setSaving(true);
    try {
      // 如果描述和默认值一致，不保存描述覆盖
      const tool = builtin.find(b => b.name === selectedTool);
      const defaultDesc = tool?.fullDescription || tool?.description || '';
      const formToSave = { ...editForm };
      if (formToSave.description === defaultDesc) {
        delete formToSave.description;
      }

      const res = await fetch(`/api/tool-config/${encodeURIComponent(selectedTool)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToSave),
      });
      const result = await res.json();
      if (result.success) {
        setToolConfig(result.config);
        setToast({ msg: t('customize.cap.configSaved') || 'Configuration saved', type: 'success' });
        // 重新加载能力数据以反映变化
        loadData();
      } else {
        setToast({ msg: result.error || 'Save failed', type: 'error' });
      }
    } catch (err: any) {
      setToast({ msg: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // 恢复默认（删除覆盖）
  const resetToolConfig = async () => {
    if (!selectedTool) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tool-config/${encodeURIComponent(selectedTool)}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (result.success) {
        setToolConfig(result.config);
        setEditForm({});
        setToast({ msg: t('customize.cap.configReset') || 'Reset to default', type: 'success' });
        loadData();
      }
    } catch (err: any) {
      setToast({ msg: err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className={styles.loading}>{t('common.loading') || 'Loading...'}</div>;
  }

  if (error || !data) {
    return <div className={styles.error}>{error || 'Failed to load capabilities'}</div>;
  }

  const { builtin, skills, mcp, summary } = data;
  const hasOverride = (name: string) => !!toolConfig[name];
  const isDisabledByConfig = (name: string) => toolConfig[name]?.enabled === false;

  return (
    <div className={styles.outerLayout}>
      {/* 左侧：能力列表 */}
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2>{t('customize.capabilities') || 'Capabilities'}</h2>
          <p>{t('customize.capabilitiesDesc') || 'Everything I can do right now — built-in tools, installed skills, and connected services.'}</p>
        </div>

        {/* Summary cards */}
        <div className={styles.summaryRow}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryNumber}>{summary.activeBuiltin}</span>
            <span className={styles.summaryLabel}>{t('customize.cap.activeTools') || 'Active Tools'}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryNumber}>{summary.deferredBuiltin}</span>
            <span className={styles.summaryLabel}>{t('customize.cap.deferredTools') || 'Deferred Tools'}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryNumber}>{summary.totalSkills}</span>
            <span className={styles.summaryLabel}>{t('customize.cap.skills') || 'Skills'}</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryNumber}>{summary.mcpEnabled + summary.mcpDisabled}</span>
            <span className={styles.summaryLabel}>{t('customize.cap.mcpServers') || 'MCP Servers'}</span>
          </div>
        </div>

        {/* Built-in Tools */}
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>{t('customize.cap.builtinTools') || 'Built-in Tools'}</h3>
            <span className={styles.sectionCount}>{summary.totalBuiltin}</span>
          </div>
          <div className={styles.itemGrid}>
            {builtin.map(item => (
              <div
                key={item.name}
                className={`${styles.item} ${styles.clickable} ${selectedTool === item.name ? styles.selected : ''} ${isDisabledByConfig(item.name) ? styles.itemDisabled : ''}`}
                onClick={() => selectTool(item.name)}
              >
                <span className={`${styles.itemIcon} ${isDisabledByConfig(item.name) ? styles.disabled : item.deferred ? styles.deferred : styles.active}`} />
                <div className={styles.itemContent}>
                  <div className={styles.itemName}>
                    {item.name}
                    {hasOverride(item.name) && <span className={styles.customBadge}>custom</span>}
                  </div>
                  <div className={styles.itemDesc}>{item.description}</div>
                </div>
                {isDisabledByConfig(item.name) ? (
                  <span className={`${styles.badge} ${styles.badgeDisabled}`}>disabled</span>
                ) : item.deferred ? (
                  <span className={styles.badge}>deferred</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* Skills */}
        {skills.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>{t('customize.cap.skillsSection') || 'Installed Skills'}</h3>
              <span className={styles.sectionCount}>{skills.length}</span>
            </div>
            <div className={styles.itemGrid}>
              {skills.map(item => (
                <div key={item.name} className={styles.item}>
                  <span className={`${styles.itemIcon} ${styles.active}`} />
                  <div>
                    <div className={styles.itemName}>{item.name}</div>
                    <div className={styles.itemDesc}>{item.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MCP Servers */}
        {(mcp.enabled.length > 0 || mcp.disabled.length > 0) && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>{t('customize.cap.mcpSection') || 'MCP Servers'}</h3>
              <span className={styles.sectionCount}>{mcp.enabled.length + mcp.disabled.length}</span>
            </div>
            <div className={styles.itemGrid}>
              {mcp.enabled.map(item => (
                <div key={item.name} className={styles.item}>
                  <span className={`${styles.itemIcon} ${styles.active}`} />
                  <div>
                    <div className={styles.itemName}>{item.name}</div>
                    <div className={styles.itemDesc}>
                      {item.description}
                      {item.tools && item.tools.length > 0 && (
                        <span> ({item.tools.length} tools)</span>
                      )}
                    </div>
                  </div>
                  <span className={styles.badge}>active</span>
                </div>
              ))}
              {mcp.disabled.map(item => (
                <div key={item.name} className={styles.item}>
                  <span className={`${styles.itemIcon} ${styles.disabled}`} />
                  <div>
                    <div className={styles.itemName}>{item.name}</div>
                    {item.description && (
                      <div className={styles.itemDesc}>{item.description}</div>
                    )}
                  </div>
                  <span className={styles.badge}>disabled</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右侧：工具配置编辑面板 */}
      {selectedTool && (
        <div className={styles.editPanel}>
          <div className={styles.editHeader}>
            <h3>{selectedTool}</h3>
            <button className={styles.closeBtn} onClick={() => setSelectedTool(null)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>

          <div className={styles.editBody}>
            {/* Enabled toggle */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                {t('customize.cap.enabled') || 'Enabled'}
              </label>
              <div
                className={`${styles.toggle} ${editForm.enabled !== false ? styles.toggleOn : ''}`}
                onClick={() => setEditForm(prev => ({
                  ...prev,
                  enabled: prev.enabled === false ? undefined : false,
                }))}
              >
                <div className={styles.toggleThumb} />
              </div>
              <span className={styles.formHint}>
                {editForm.enabled === false
                  ? (t('customize.cap.toolWillBeHidden') || 'Tool will be hidden from the model')
                  : (t('customize.cap.toolIsActive') || 'Tool is active')}
              </span>
            </div>

            {/* shouldDefer toggle */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                {t('customize.cap.deferredLoading') || 'Deferred Loading'}
              </label>
              <div
                className={`${styles.toggle} ${editForm.shouldDefer ? styles.toggleOn : ''}`}
                onClick={() => setEditForm(prev => ({
                  ...prev,
                  shouldDefer: prev.shouldDefer ? undefined : true,
                }))}
              >
                <div className={styles.toggleThumb} />
              </div>
              <span className={styles.formHint}>
                {editForm.shouldDefer
                  ? (t('customize.cap.deferredHint') || 'Loaded on demand via ToolSearch to save tokens')
                  : (t('customize.cap.alwaysLoadedHint') || 'Always included in tool list')}
              </span>
            </div>

            {/* Description override */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                {t('customize.cap.descriptionOverride') || 'Description Override'}
              </label>
              <textarea
                className={styles.textarea}
                rows={6}
                value={editForm.description || ''}
                onChange={e => setEditForm(prev => ({
                  ...prev,
                  description: e.target.value || undefined,
                }))}
                placeholder={t('customize.cap.descPlaceholder') || 'Leave empty to use default description'}
              />
              <span className={styles.formHint}>
                {t('customize.cap.descHint') || 'This text is sent to the model as the tool\'s usage instruction'}
              </span>
            </div>

            {/* SearchHint override */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                {t('customize.cap.searchHint') || 'Search Hint'}
              </label>
              <input
                className={styles.input}
                type="text"
                value={editForm.searchHint || ''}
                onChange={e => setEditForm(prev => ({
                  ...prev,
                  searchHint: e.target.value || undefined,
                }))}
                placeholder={t('customize.cap.searchHintPlaceholder') || 'Short description for ToolSearch'}
              />
            </div>
          </div>

          {/* Actions */}
          <div className={styles.editFooter}>
            <button
              className={styles.btnGhost}
              onClick={resetToolConfig}
              disabled={saving || !hasOverride(selectedTool)}
            >
              {t('customize.cap.resetDefault') || 'Reset to Default'}
            </button>
            <button
              className={styles.btnPrimary}
              onClick={saveToolConfig}
              disabled={saving}
            >
              {saving ? (t('customize.aiProfile.saving') || 'Saving...') : (t('customize.aiProfile.save') || 'Save')}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
