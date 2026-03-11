/**
 * 模式预设编辑器
 * 
 * 管理权限模式预设 — 每个预设绑定权限行为、系统提示词、工具过滤。
 * 内置 4 个默认预设（询问/自动编辑/YOLO/计划），支持编辑和新增自定义预设。
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '../../i18n';
import '../../styles/config-panels.css';

// ============ 类型（与 shared/types.ts 保持一致）============

interface ModePreset {
  id: string;
  name: string;
  icon: string;
  builtIn: boolean;
  permissionMode: string;
  systemPrompt: {
    customPrompt?: string;
    appendPrompt?: string;
    useDefault: boolean;
  };
  toolFilter: {
    mode: 'all' | 'whitelist' | 'blacklist';
    allowedTools?: string[];
    disallowedTools?: string[];
  };
  description?: string;
}

interface Props {
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
  onClose?: () => void;
}

// ============ 主组件 ============

export function ModePresetsPanel({ onSendMessage, addMessageHandler, onClose }: Props) {
  const { t } = useLanguage();
  const [presets, setPresets] = useState<ModePreset[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ModePreset | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string; category: string }[]>([]);
  const [toolSearchQuery, setToolSearchQuery] = useState('');

  // 加载预设列表 + 工具列表
  useEffect(() => {
    if (!onSendMessage || !addMessageHandler) return;

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'mode_presets_list') {
        setPresets(msg.payload.presets);
        setActiveId(msg.payload.activeId);
        // 默认选中第一个
        if (msg.payload.presets.length > 0) {
          setSelectedId(prev => {
            if (prev) return prev; // 已有选中的不覆盖
            const first = msg.payload.presets[0];
            setEditDraft({ ...first });
            return first.id;
          });
        }
      }
      if (msg.type === 'tool_list_response') {
        setAvailableTools(msg.payload.tools || []);
      }
    });

    onSendMessage({ type: 'mode_presets_get' });
    onSendMessage({ type: 'tool_list_get' });
    return unsubscribe;
  }, [onSendMessage, addMessageHandler]);

  // 选中预设
  const handleSelect = (preset: ModePreset) => {
    setSelectedId(preset.id);
    setEditDraft({ ...preset, systemPrompt: { ...preset.systemPrompt }, toolFilter: { ...preset.toolFilter } });
    setSaveStatus('idle');
  };

  // 新增自定义预设
  const handleAdd = () => {
    const newId = `custom-${Date.now()}`;
    const newPreset: ModePreset = {
      id: newId,
      name: t('modePresets.newPreset'),
      icon: '🔧',
      builtIn: false,
      permissionMode: 'default',
      description: '',
      systemPrompt: { useDefault: true, appendPrompt: '' },
      toolFilter: { mode: 'all' },
    };
    setPresets(prev => [...prev, newPreset]);
    setSelectedId(newId);
    setEditDraft({ ...newPreset, systemPrompt: { ...newPreset.systemPrompt }, toolFilter: { ...newPreset.toolFilter } });
    setSaveStatus('idle');
  };

  // 保存预设
  const handleSave = () => {
    if (!editDraft || !onSendMessage) return;

    onSendMessage({ type: 'mode_preset_save', payload: { preset: editDraft } });

    // 更新本地列表
    setPresets(prev => {
      const idx = prev.findIndex(p => p.id === editDraft.id);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = editDraft;
        return updated;
      }
      return [...prev, editDraft];
    });

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  // 删除预设
  const handleDelete = () => {
    if (!editDraft || editDraft.builtIn || !onSendMessage) return;
    onSendMessage({ type: 'mode_preset_delete', payload: { id: editDraft.id } });
    setPresets(prev => prev.filter(p => p.id !== editDraft.id));
    const remaining = presets.filter(p => p.id !== editDraft.id);
    if (remaining.length > 0) {
      handleSelect(remaining[0]);
    } else {
      setSelectedId(null);
      setEditDraft(null);
    }
  };

  // 应用预设
  const handleApply = () => {
    if (!editDraft || !onSendMessage) return;
    onSendMessage({ type: 'mode_preset_apply', payload: { id: editDraft.id } });
    setActiveId(editDraft.id);
  };

  // 工具复选框切换
  const toggleTool = (toolName: string, listType: 'allowedTools' | 'disallowedTools') => {
    if (!editDraft) return;
    const current = editDraft.toolFilter[listType] || [];
    const updated = current.includes(toolName)
      ? current.filter(t => t !== toolName)
      : [...current, toolName];
    setEditDraft({
      ...editDraft,
      toolFilter: { ...editDraft.toolFilter, [listType]: updated },
    });
  };

  // 全选/全不选
  const toggleAllTools = (listType: 'allowedTools' | 'disallowedTools', selectAll: boolean) => {
    if (!editDraft) return;
    const toolNames = selectAll ? availableTools.map(t => t.name) : [];
    setEditDraft({
      ...editDraft,
      toolFilter: { ...editDraft.toolFilter, [listType]: toolNames },
    });
  };

  // 按搜索词和分类过滤工具
  const filteredTools = availableTools.filter(tool =>
    !toolSearchQuery || tool.name.toLowerCase().includes(toolSearchQuery.toLowerCase())
  );

  // 按分类分组
  const groupedTools = filteredTools.reduce<Record<string, typeof availableTools>>((acc, tool) => {
    const cat = tool.category || 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(tool);
    return acc;
  }, {});

  return (
    <div className="permissions-config-panel">
      <div className="config-panel-header">
        <h3>{t('modePresets.title')}</h3>
        <p className="config-description">{t('modePresets.description')}</p>
      </div>

      <div style={{ display: 'flex', gap: '16px', minHeight: '400px' }}>
        {/* 左侧：预设列表 */}
        <div style={{ width: '200px', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {presets.map(preset => (
              <div
                key={preset.id}
                onClick={() => handleSelect(preset)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  background: selectedId === preset.id ? 'var(--bg-accent, #4f46e5)' : 'transparent',
                  color: selectedId === preset.id ? 'white' : 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '14px',
                  border: preset.id === activeId ? '1px solid var(--color-success, #22c55e)' : '1px solid transparent',
                }}
              >
                <span>{preset.icon}</span>
                <span style={{ flex: 1 }}>{preset.name}</span>
                {preset.id === activeId && <span style={{ fontSize: '10px', opacity: 0.8 }}>●</span>}
              </div>
            ))}
          </div>
          <button
            className="config-btn config-btn-secondary"
            onClick={handleAdd}
            style={{ width: '100%', marginTop: '8px' }}
          >
            + {t('modePresets.addPreset')}
          </button>
        </div>

        {/* 右侧：编辑表单 */}
        {editDraft && (
          <div style={{ flex: 1 }}>
            {/* 名称 + 图标 */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <label className="setting-label">{t('modePresets.name')}</label>
                <input
                  type="text"
                  className="setting-input"
                  value={editDraft.name}
                  onChange={e => setEditDraft({ ...editDraft, name: e.target.value })}
                />
              </div>
              <div style={{ width: '80px' }}>
                <label className="setting-label">{t('modePresets.icon')}</label>
                <input
                  type="text"
                  className="setting-input"
                  value={editDraft.icon}
                  onChange={e => setEditDraft({ ...editDraft, icon: e.target.value })}
                  maxLength={4}
                />
              </div>
            </div>

            {/* 描述 */}
            <div className="setting-item">
              <label className="setting-label">{t('modePresets.desc')}</label>
              <input
                type="text"
                className="setting-input"
                value={editDraft.description || ''}
                onChange={e => setEditDraft({ ...editDraft, description: e.target.value })}
                placeholder={t('modePresets.descPlaceholder')}
              />
            </div>

            {/* 权限行为 */}
            <section className="config-section" style={{ marginTop: '16px' }}>
              <h4 className="config-section-title">{t('modePresets.permissionBehavior')}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {(['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const).map(mode => (
                  <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="permissionMode"
                      checked={editDraft.permissionMode === mode}
                      onChange={() => setEditDraft({ ...editDraft, permissionMode: mode })}
                    />
                    <span>{t(`modePresets.perm.${mode}`)}</span>
                  </label>
                ))}
              </div>
            </section>

            {/* 系统提示词 */}
            <section className="config-section" style={{ marginTop: '16px' }}>
              <h4 className="config-section-title">{t('modePresets.systemPrompt')}</h4>
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editDraft.systemPrompt.useDefault}
                    onChange={e => setEditDraft({
                      ...editDraft,
                      systemPrompt: { ...editDraft.systemPrompt, useDefault: e.target.checked },
                    })}
                  />
                  <span>{t('modePresets.useDefaultPrompt')}</span>
                </label>
              </div>

              {editDraft.systemPrompt.useDefault ? (
                <div>
                  <label className="setting-label">{t('modePresets.appendPrompt')}</label>
                  <textarea
                    className="setting-input"
                    rows={6}
                    value={editDraft.systemPrompt.appendPrompt || ''}
                    onChange={e => setEditDraft({
                      ...editDraft,
                      systemPrompt: { ...editDraft.systemPrompt, appendPrompt: e.target.value },
                    })}
                    placeholder={t('modePresets.appendPromptPlaceholder')}
                    style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                  />
                  <div className="setting-hint">{t('modePresets.appendPromptHint')}</div>
                </div>
              ) : (
                <div>
                  <label className="setting-label">{t('modePresets.customPrompt')}</label>
                  <textarea
                    className="setting-input"
                    rows={10}
                    value={editDraft.systemPrompt.customPrompt || ''}
                    onChange={e => setEditDraft({
                      ...editDraft,
                      systemPrompt: { ...editDraft.systemPrompt, customPrompt: e.target.value },
                    })}
                    placeholder={t('modePresets.customPromptPlaceholder')}
                    style={{ fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
                  />
                  <div className="setting-hint">{t('modePresets.customPromptHint')}</div>
                </div>
              )}
            </section>

            {/* 工具过滤 */}
            <section className="config-section" style={{ marginTop: '16px' }}>
              <h4 className="config-section-title">{t('modePresets.toolFilter')}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                {(['all', 'whitelist', 'blacklist'] as const).map(mode => (
                  <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="toolFilterMode"
                      checked={editDraft.toolFilter.mode === mode}
                      onChange={() => setEditDraft({
                        ...editDraft,
                        toolFilter: { ...editDraft.toolFilter, mode },
                      })}
                    />
                    <span>{t(`modePresets.toolMode.${mode}`)}</span>
                  </label>
                ))}
              </div>

              {(editDraft.toolFilter.mode === 'whitelist' || editDraft.toolFilter.mode === 'blacklist') && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <label className="setting-label" style={{ margin: 0 }}>
                      {editDraft.toolFilter.mode === 'whitelist'
                        ? t('modePresets.allowedTools')
                        : t('modePresets.disallowedTools')}
                    </label>
                    <span style={{ fontSize: '12px', opacity: 0.6 }}>
                      ({(editDraft.toolFilter.mode === 'whitelist'
                        ? editDraft.toolFilter.allowedTools
                        : editDraft.toolFilter.disallowedTools)?.length || 0}/{availableTools.length})
                    </span>
                  </div>

                  {/* 搜索 + 全选/全不选 */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="setting-input"
                      value={toolSearchQuery}
                      onChange={e => setToolSearchQuery(e.target.value)}
                      placeholder={t('modePresets.toolSearchPlaceholder')}
                      style={{ flex: 1, margin: 0 }}
                    />
                    <button
                      className="config-btn config-btn-secondary"
                      style={{ fontSize: '12px', padding: '4px 8px', whiteSpace: 'nowrap' }}
                      onClick={() => toggleAllTools(
                        editDraft.toolFilter.mode === 'whitelist' ? 'allowedTools' : 'disallowedTools',
                        true
                      )}
                    >
                      {t('modePresets.selectAll')}
                    </button>
                    <button
                      className="config-btn config-btn-secondary"
                      style={{ fontSize: '12px', padding: '4px 8px', whiteSpace: 'nowrap' }}
                      onClick={() => toggleAllTools(
                        editDraft.toolFilter.mode === 'whitelist' ? 'allowedTools' : 'disallowedTools',
                        false
                      )}
                    >
                      {t('modePresets.selectNone')}
                    </button>
                  </div>

                  {/* 工具复选框列表 */}
                  {availableTools.length === 0 ? (
                    <div style={{ padding: '12px', textAlign: 'center', opacity: 0.5, fontSize: '13px' }}>
                      {t('modePresets.loadingTools')}
                    </div>
                  ) : (
                    <div style={{
                      maxHeight: '280px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-color, #333)',
                      borderRadius: '6px',
                      padding: '8px',
                    }}>
                      {Object.entries(groupedTools).map(([category, tools]) => (
                        <div key={category} style={{ marginBottom: '8px' }}>
                          <div style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            opacity: 0.5,
                            marginBottom: '4px',
                            padding: '2px 0',
                          }}>
                            {category}
                          </div>
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                            gap: '2px',
                          }}>
                            {tools.map(tool => {
                              const listType = editDraft.toolFilter.mode === 'whitelist' ? 'allowedTools' : 'disallowedTools';
                              const isChecked = (editDraft.toolFilter[listType] || []).includes(tool.name);
                              return (
                                <label
                                  key={tool.name}
                                  title={tool.description}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '3px 6px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '13px',
                                    background: isChecked ? 'var(--bg-accent-subtle, rgba(79, 70, 229, 0.1))' : 'transparent',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleTool(tool.name, listType)}
                                    style={{ margin: 0 }}
                                  />
                                  <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{tool.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="setting-hint" style={{ marginTop: '4px' }}>
                    {t('modePresets.toolCheckboxHint')}
                  </div>
                </div>
              )}
            </section>

            {/* 操作按钮 */}
            <div className="config-actions" style={{ marginTop: '16px' }}>
              <button className="config-btn config-btn-primary" onClick={handleSave}>
                {saveStatus === 'saved' ? t('modePresets.saved') : t('modePresets.save')}
              </button>
              <button className="config-btn config-btn-primary" onClick={handleApply} style={{ marginLeft: '8px' }}>
                {t('modePresets.apply')}
              </button>
              {!editDraft.builtIn && (
                <button className="config-btn config-btn-secondary" onClick={handleDelete} style={{ marginLeft: '8px', color: '#ef4444' }}>
                  {t('modePresets.delete')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ModePresetsPanel;
