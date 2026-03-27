/**
 * 权限配置面板组件
 * 用于配置完整的权限系统，包括默认模式、工具权限、路径权限、命令权限、网络权限和审计日志
 */

import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../../i18n';
import '../../styles/config-panels.css';

// ============ 类型定义 ============

interface ConfigPanelProps {
  onSave: (config: PermissionsConfig) => void;
  onClose?: () => void;
  initialConfig?: PermissionsConfig;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

interface PermissionsConfig {
  defaultMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'delegate';
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  paths?: {
    allow?: string[];
    deny?: string[];
  };
  commands?: {
    allow?: string[];
    deny?: string[];
  };
  network?: {
    allow?: string[];
    deny?: string[];
  };
  audit?: {
    enabled?: boolean;
    logFile?: string;
  };
}

// ============ 主组件 ============

export function PermissionsConfigPanel({ onSave, onClose, initialConfig, onSendMessage, addMessageHandler }: ConfigPanelProps) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<PermissionsConfig>({
    defaultMode: 'default',
    tools: { allow: [], deny: [] },
    paths: { allow: [], deny: [] },
    commands: { allow: [], deny: [] },
    network: { allow: [], deny: [] },
    audit: { enabled: false },
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const loadedRef = useRef(false);
  const [availableTools, setAvailableTools] = useState<{ name: string; description: string; category: string }[]>([]);
  const [toolSearchAllow, setToolSearchAllow] = useState('');
  const [toolSearchDeny, setToolSearchDeny] = useState('');

  // 加载初始配置（优先从后端加载）
  useEffect(() => {
    if (initialConfig) {
      setConfig({
        ...initialConfig,
        tools: initialConfig.tools || { allow: [], deny: [] },
        paths: initialConfig.paths || { allow: [], deny: [] },
        commands: initialConfig.commands || { allow: [], deny: [] },
        network: initialConfig.network || { allow: [], deny: [] },
        audit: initialConfig.audit || { enabled: false },
      });
    }
  }, [initialConfig]);

  // 从后端加载当前权限配置 + 工具列表
  useEffect(() => {
    if (!onSendMessage || !addMessageHandler || loadedRef.current) return;
    loadedRef.current = true;

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'permission_config_full') {
        const p = msg.payload;
        setConfig({
          defaultMode: p.mode || 'default',
          tools: { allow: p.alwaysAllow || [], deny: p.alwaysDeny || [] },
          paths: p.paths || { allow: [], deny: [] },
          commands: p.commands || { allow: [], deny: [] },
          network: p.network || { allow: [], deny: [] },
          audit: p.audit || { enabled: false },
        });
      }
      if (msg.type === 'tool_list_response') {
        setAvailableTools(msg.payload.tools || []);
      }
    });

    onSendMessage({ type: 'permission_config_get' });
    onSendMessage({ type: 'tool_list_get' });

    return unsubscribe;
  }, [onSendMessage, addMessageHandler]);

  // 工具复选框切换
  const togglePermTool = (toolName: string, listType: 'allow' | 'deny') => {
    const current = config.tools?.[listType] || [];
    const updated = current.includes(toolName)
      ? current.filter(t => t !== toolName)
      : [...current, toolName];
    setConfig({
      ...config,
      tools: { ...config.tools, [listType]: updated },
    });
  };

  const handleSave = () => {
    // 清理空数组和未启用的配置
    const cleanedConfig: PermissionsConfig = {
      defaultMode: config.defaultMode,
    };

    if (config.tools?.allow?.length || config.tools?.deny?.length) {
      cleanedConfig.tools = {
        allow: config.tools.allow?.filter(Boolean),
        deny: config.tools.deny?.filter(Boolean),
      };
    }

    if (config.paths?.allow?.length || config.paths?.deny?.length) {
      cleanedConfig.paths = {
        allow: config.paths.allow?.filter(Boolean),
        deny: config.paths.deny?.filter(Boolean),
      };
    }

    if (config.commands?.allow?.length || config.commands?.deny?.length) {
      cleanedConfig.commands = {
        allow: config.commands.allow?.filter(Boolean),
        deny: config.commands.deny?.filter(Boolean),
      };
    }

    if (config.network?.allow?.length || config.network?.deny?.length) {
      cleanedConfig.network = {
        allow: config.network.allow?.filter(Boolean),
        deny: config.network.deny?.filter(Boolean),
      };
    }

    if (config.audit?.enabled) {
      cleanedConfig.audit = config.audit;
    }

    // 通过 WebSocket 发送到后端保存并生效
    if (onSendMessage) {
      setSaveStatus('saving');
      onSendMessage({
        type: 'permission_config',
        payload: {
          mode: cleanedConfig.defaultMode,
          alwaysAllow: cleanedConfig.tools?.allow,
          alwaysDeny: cleanedConfig.tools?.deny,
          paths: cleanedConfig.paths,
          commands: cleanedConfig.commands,
          network: cleanedConfig.network,
          audit: cleanedConfig.audit,
          persist: true,
        },
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    }

    onSave(cleanedConfig);
  };

  return (
    <div className="permissions-config-panel">
      <div className="config-panel-header">
        <h3>{t('permissions.title')}</h3>
        <p className="config-description">
          {t('permissions.description')}
        </p>
      </div>

      {/* 默认权限模式 */}
      <section className="config-section">
        <h4 className="config-section-title">{t('permissions.mode.title')}</h4>
        <p className="config-section-description">
          {t('permissions.mode.description')}
        </p>
        <div className="setting-item">
          <label className="setting-label">{t('permissions.mode.label')}</label>
          <select
            className="setting-select"
            value={config.defaultMode}
            onChange={(e) => setConfig({ ...config, defaultMode: e.target.value as any })}
          >
            <option value="default">{t('permissions.mode.default')}</option>
            <option value="acceptEdits">{t('permissions.mode.acceptEdits')}</option>
            <option value="bypassPermissions">{t('permissions.mode.bypassPermissions')}</option>
            <option value="plan">{t('permissions.mode.plan')}</option>
            <option value="dontAsk">{t('permissions.mode.dontAsk')}</option>
            <option value="delegate">{t('permissions.mode.delegate')}</option>
          </select>
          {config.defaultMode === 'dontAsk' && (
            <div className="permission-warning">
              ⚠️ {t('permissions.mode.hint.dontAsk')}
            </div>
          )}
          <div className="setting-hint">
            {config.defaultMode === 'default' && t('permissions.mode.hint.default')}
            {config.defaultMode === 'acceptEdits' && t('permissions.mode.hint.acceptEdits')}
            {config.defaultMode === 'bypassPermissions' && t('permissions.mode.hint.bypassPermissions')}
            {config.defaultMode === 'plan' && t('permissions.mode.hint.plan')}
            {config.defaultMode === 'dontAsk' && t('permissions.mode.hint.dontAsk')}
            {config.defaultMode === 'delegate' && t('permissions.mode.hint.delegate')}
          </div>
        </div>
      </section>

      {/* 工具权限 */}
      <section className="config-section">
        <h4 className="config-section-title">{t('permissions.tools.title')}</h4>
        <p className="config-section-description">
          {t('permissions.tools.description')}
        </p>

        {/* 始终允许的工具 */}
        <div className="setting-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <label className="setting-label" style={{ margin: 0 }}>
              {t('permissions.tools.allow.label')}
              <span className="setting-label-hint">{t('permissions.tools.allow.hint')}</span>
            </label>
            <span style={{ fontSize: '12px', opacity: 0.6 }}>
              ({config.tools?.allow?.length || 0}/{availableTools.length})
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
            <input
              type="text"
              className="setting-input"
              value={toolSearchAllow}
              onChange={e => setToolSearchAllow(e.target.value)}
              placeholder={t('modePresets.toolSearchPlaceholder')}
              style={{ flex: 1, margin: 0 }}
            />
          </div>
          {availableTools.length === 0 ? (
            <div style={{ padding: '8px', textAlign: 'center', opacity: 0.5, fontSize: '13px' }}>
              {t('modePresets.loadingTools')}
            </div>
          ) : (
            <div style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid var(--border-color, #333)',
              borderRadius: '6px',
              padding: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '2px',
            }}>
              {availableTools
                .filter(tool => !toolSearchAllow || tool.name.toLowerCase().includes(toolSearchAllow.toLowerCase()))
                .map(tool => {
                  const isChecked = (config.tools?.allow || []).includes(tool.name);
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
                        onChange={() => togglePermTool(tool.name, 'allow')}
                        style={{ margin: 0 }}
                      />
                      <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{tool.name}</span>
                    </label>
                  );
                })}
            </div>
          )}
          <div className="setting-hint">
            {t('permissions.tools.allow.example')}
          </div>
        </div>

        {/* 始终禁止的工具 */}
        <div className="setting-item">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <label className="setting-label" style={{ margin: 0 }}>
              {t('permissions.tools.deny.label')}
              <span className="setting-label-hint">{t('permissions.tools.deny.hint')}</span>
            </label>
            <span style={{ fontSize: '12px', opacity: 0.6 }}>
              ({config.tools?.deny?.length || 0}/{availableTools.length})
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
            <input
              type="text"
              className="setting-input"
              value={toolSearchDeny}
              onChange={e => setToolSearchDeny(e.target.value)}
              placeholder={t('modePresets.toolSearchPlaceholder')}
              style={{ flex: 1, margin: 0 }}
            />
          </div>
          {availableTools.length === 0 ? (
            <div style={{ padding: '8px', textAlign: 'center', opacity: 0.5, fontSize: '13px' }}>
              {t('modePresets.loadingTools')}
            </div>
          ) : (
            <div style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid var(--border-color, #333)',
              borderRadius: '6px',
              padding: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: '2px',
            }}>
              {availableTools
                .filter(tool => !toolSearchDeny || tool.name.toLowerCase().includes(toolSearchDeny.toLowerCase()))
                .map(tool => {
                  const isChecked = (config.tools?.deny || []).includes(tool.name);
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
                        background: isChecked ? 'var(--bg-accent-subtle, rgba(239, 68, 68, 0.1))' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => togglePermTool(tool.name, 'deny')}
                        style={{ margin: 0 }}
                      />
                      <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{tool.name}</span>
                    </label>
                  );
                })}
            </div>
          )}
          <div className="setting-hint">
            {t('permissions.tools.deny.description')}
          </div>
        </div>
      </section>

      {/* 路径权限 */}
      <section className="config-section">
        <h4 className="config-section-title">{t('permissions.paths.title')}</h4>
        <p className="config-section-description">
          {t('permissions.paths.description')}
        </p>
        <div className="setting-item">
          <label className="setting-label">
            {t('permissions.paths.allow.label')}
            <span className="setting-label-hint">{t('permissions.paths.allow.hint')}</span>
          </label>
          <textarea
            className="setting-textarea"
            value={config.paths?.allow?.join('\n') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                paths: {
                  ...config.paths,
                  allow: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
            placeholder={t('placeholder.allowedPaths')}
            rows={4}
          />
          <div className="setting-hint">
            {t('permissions.paths.allow.example')}
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            {t('permissions.paths.deny.label')}
            <span className="setting-label-hint">{t('permissions.paths.deny.hint')}</span>
          </label>
          <textarea
            className="setting-textarea"
            value={config.paths?.deny?.join('\n') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                paths: {
                  ...config.paths,
                  deny: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
            placeholder={t('placeholder.deniedPaths')}
            rows={4}
          />
          <div className="setting-hint">
            {t('permissions.paths.deny.description')}
          </div>
        </div>
      </section>

      {/* 命令权限 */}
      <section className="config-section">
        <h4 className="config-section-title">{t('permissions.commands.title')}</h4>
        <p className="config-section-description">
          {t('permissions.commands.description')}
        </p>
        <div className="setting-item">
          <label className="setting-label">
            {t('permissions.commands.allow.label')}
            <span className="setting-label-hint">{t('permissions.commands.allow.hint')}</span>
          </label>
          <textarea
            className="setting-textarea"
            value={config.commands?.allow?.join('\n') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                commands: {
                  ...config.commands,
                  allow: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
            placeholder={t('placeholder.allowedCommands')}
            rows={3}
          />
          <div className="setting-hint">
            {t('permissions.commands.allow.example')}
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            {t('permissions.commands.deny.label')}
            <span className="setting-label-hint">{t('permissions.commands.deny.hint')}</span>
          </label>
          <textarea
            className="setting-textarea"
            value={config.commands?.deny?.join('\n') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                commands: {
                  ...config.commands,
                  deny: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
            placeholder={t('placeholder.deniedCommands')}
            rows={3}
          />
          <div className="setting-hint">
            {t('permissions.commands.deny.description')}
          </div>
        </div>
      </section>

      {/* 网络权限 */}
      <section className="config-section">
        <h4 className="config-section-title">{t('permissions.network.title')}</h4>
        <p className="config-section-description">
          {t('permissions.network.description')}
        </p>
        <div className="setting-item">
          <label className="setting-label">
            {t('permissions.network.allow.label')}
            <span className="setting-label-hint">{t('permissions.network.allow.hint')}</span>
          </label>
          <textarea
            className="setting-textarea"
            value={config.network?.allow?.join('\n') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                network: {
                  ...config.network,
                  allow: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
            placeholder={t('placeholder.allowedUrls')}
            rows={3}
          />
          <div className="setting-hint">
            {t('permissions.network.allow.example')}
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            {t('permissions.network.deny.label')}
            <span className="setting-label-hint">{t('permissions.network.deny.hint')}</span>
          </label>
          <textarea
            className="setting-textarea"
            value={config.network?.deny?.join('\n') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                network: {
                  ...config.network,
                  deny: e.target.value.split('\n').filter(Boolean),
                },
              })
            }
            placeholder={t('placeholder.deniedUrls')}
            rows={3}
          />
          <div className="setting-hint">
            {t('permissions.network.deny.description')}
          </div>
        </div>
      </section>

      {/* 审计日志 */}
      <section className="config-section">
        <h4 className="config-section-title">{t('permissions.audit.title')}</h4>
        <p className="config-section-description">
          {t('permissions.audit.description')}
        </p>
        <div className="setting-item">
          <label className="setting-checkbox-label">
            <input
              type="checkbox"
              className="setting-checkbox"
              checked={config.audit?.enabled || false}
              onChange={(e) =>
                setConfig({
                  ...config,
                  audit: { ...config.audit, enabled: e.target.checked },
                })
              }
            />
            {t('permissions.audit.enable')}
          </label>
          <div className="setting-hint">
            {t('permissions.audit.enableHint')}
          </div>
        </div>
        {config.audit?.enabled && (
          <div className="setting-item">
            <label className="setting-label">{t('permissions.audit.logFile')}</label>
            <input
              type="text"
              className="setting-input"
              value={config.audit?.logFile || ''}
              onChange={(e) =>
                setConfig({
                  ...config,
                  audit: { ...config.audit, logFile: e.target.value },
                })
              }
              placeholder={t('placeholder.auditLogFile')}
            />
            <div className="setting-hint">
              {t('permissions.audit.logFileHint')}
            </div>
          </div>
        )}
      </section>

      {/* 操作按钮 */}
      <div className="config-actions">
        <button className="config-btn config-btn-primary" onClick={handleSave} disabled={saveStatus === 'saving'}>
          {saveStatus === 'saved' ? t('permissions.saved') : t('permissions.save')}
        </button>
        {onClose && (
          <button className="config-btn config-btn-secondary" onClick={onClose}>
            {t('permissions.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

export default PermissionsConfigPanel;
