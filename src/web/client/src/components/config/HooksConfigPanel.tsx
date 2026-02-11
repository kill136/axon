/**
 * Hooks 配置面板组件
 * 用于配置 12 个事件钩子，支持命令和 URL 两种类型
 */

import { useState, useEffect } from 'react';
import '../../styles/config-panels.css';

// ============ 类型定义 ============

interface ConfigPanelProps {
  onSave: (config: HooksConfig) => void;
  onClose?: () => void;
  initialConfig?: HooksConfig;
}

interface HooksConfig {
  enabled?: boolean;
  globalTimeout?: number;
  maxConcurrent?: number;
  [key: string]: any; // 用于存储各个 hook 事件的配置
}

interface HookConfig {
  type?: 'command' | 'url';
  command?: string;
  args?: string[];
  url?: string;
  method?: string;
  timeout?: number;
  blocking?: boolean;
  matcher?: string;
}

interface HookEditorProps {
  hookConfig: HookConfig;
  onChange: (config: HookConfig) => void;
}

// 12 个事件钩子
const HOOK_EVENTS = [
  { id: 'PreToolUse', name: '工具使用前', description: '在执行任何工具之前触发' },
  { id: 'PostToolUse', name: '工具使用后', description: '工具成功执行后触发' },
  { id: 'PostToolUseFailure', name: '工具执行失败', description: '工具执行失败时触发' },
  { id: 'Notification', name: '通知', description: '系统发送通知时触发' },
  { id: 'UserPromptSubmit', name: '用户提交', description: '用户提交新消息时触发' },
  { id: 'SessionStart', name: '会话开始', description: '新会话启动时触发' },
  { id: 'SessionEnd', name: '会话结束', description: '会话结束时触发' },
  { id: 'Stop', name: '停止', description: '用户请求停止执行时触发' },
  { id: 'SubagentStart', name: '子代理启动', description: '子代理开始执行时触发' },
  { id: 'SubagentStop', name: '子代理停止', description: '子代理停止执行时触发' },
  { id: 'PreCompact', name: '压缩前', description: '上下文压缩前触发' },
  { id: 'PermissionRequest', name: '权限请求', description: '请求用户权限时触发' },
];

// ============ Hook 编辑器子组件 ============

function HookEditor({ hookConfig, onChange }: HookEditorProps) {
  return (
    <div className="hook-editor">
      <div className="hook-editor-grid">
        <div className="setting-item">
          <label className="setting-label">Hook 类型</label>
          <select
            className="setting-select"
            value={hookConfig.type || 'command'}
            onChange={(e) => onChange({ ...hookConfig, type: e.target.value as any })}
          >
            <option value="command">命令 (Shell Script)</option>
            <option value="url">URL (HTTP/HTTPS Webhook)</option>
          </select>
        </div>

        {hookConfig.type === 'command' ? (
          <>
            <div className="setting-item">
              <label className="setting-label">命令路径</label>
              <input
                type="text"
                className="setting-input"
                value={hookConfig.command || ''}
                onChange={(e) => onChange({ ...hookConfig, command: e.target.value })}
                placeholder="/path/to/script.sh 或 /usr/bin/python"
              />
              <div className="setting-hint">
                脚本路径，需要具有执行权限
              </div>
            </div>
            <div className="setting-item">
              <label className="setting-label">
                命令参数 (逗号分隔)
                <span className="setting-label-hint">可选</span>
              </label>
              <input
                type="text"
                className="setting-input"
                value={hookConfig.args?.join(', ') || ''}
                onChange={(e) =>
                  onChange({
                    ...hookConfig,
                    args: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                placeholder="arg1, arg2, arg3"
              />
              <div className="setting-hint">
                传递给命令的参数
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="setting-item">
              <label className="setting-label">Webhook URL</label>
              <input
                type="text"
                className="setting-input"
                value={hookConfig.url || ''}
                onChange={(e) => onChange({ ...hookConfig, url: e.target.value })}
                placeholder="https://example.com/webhook"
              />
              <div className="setting-hint">
                HTTP/HTTPS 端点地址
              </div>
            </div>
            <div className="setting-item">
              <label className="setting-label">HTTP 方法</label>
              <select
                className="setting-select"
                value={hookConfig.method || 'POST'}
                onChange={(e) => onChange({ ...hookConfig, method: e.target.value })}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
          </>
        )}

        <div className="setting-item">
          <label className="setting-label">超时时间 (毫秒)</label>
          <input
            type="number"
            className="setting-input"
            value={hookConfig.timeout || 30000}
            onChange={(e) => onChange({ ...hookConfig, timeout: parseInt(e.target.value) || 30000 })}
            min="1000"
            max="300000"
            step="1000"
          />
          <div className="setting-hint">
            Hook 执行的最大等待时间
          </div>
        </div>

        <div className="setting-item">
          <label className="setting-checkbox-label">
            <input
              type="checkbox"
              className="setting-checkbox"
              checked={hookConfig.blocking || false}
              onChange={(e) => onChange({ ...hookConfig, blocking: e.target.checked })}
            />
            阻塞模式 (等待 Hook 完成)
          </label>
          <div className="setting-hint">
            启用后，主流程会等待 Hook 执行完成
          </div>
        </div>

        <div className="setting-item">
          <label className="setting-label">
            匹配器模式 (正则表达式)
            <span className="setting-label-hint">可选</span>
          </label>
          <input
            type="text"
            className="setting-input"
            value={hookConfig.matcher || ''}
            onChange={(e) => onChange({ ...hookConfig, matcher: e.target.value })}
            placeholder="^(Read|Write)$"
          />
          <div className="setting-hint">
            只有匹配此正则的事件才会触发 Hook
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ 主组件 ============

export function HooksConfigPanel({ onSave, onClose, initialConfig }: ConfigPanelProps) {
  const [config, setConfig] = useState<HooksConfig>({
    enabled: false,
    globalTimeout: 30000,
    maxConcurrent: 5,
  });

  const [selectedHook, setSelectedHook] = useState<string | null>(null);

  // 加载初始配置
  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
    }
  }, [initialConfig]);

  const updateHookConfig = (event: string, hookConfig: HookConfig) => {
    setConfig({
      ...config,
      [event]: hookConfig,
    });
  };

  const removeHookConfig = (event: string) => {
    const newConfig = { ...config };
    delete newConfig[event];
    setConfig(newConfig);
  };

  const handleSave = () => {
    // 清理未配置的 hook
    const cleanedConfig: HooksConfig = {
      enabled: config.enabled,
      globalTimeout: config.globalTimeout,
      maxConcurrent: config.maxConcurrent,
    };

    HOOK_EVENTS.forEach((event) => {
      if (config[event.id]) {
        cleanedConfig[event.id] = config[event.id];
      }
    });

    onSave(cleanedConfig);
  };

  return (
    <div className="hooks-config-panel">
      <div className="config-panel-header">
        <h3>Hooks 配置</h3>
        <p className="config-description">
          配置事件钩子，在特定事件发生时执行自定义脚本或调用 Webhook
        </p>
      </div>

      {/* 全局设置 */}
      <section className="config-section">
        <h4 className="config-section-title">全局设置</h4>
        <p className="config-section-description">
          控制整个 Hooks 系统的全局行为
        </p>

        <div className="setting-item">
          <label className="setting-checkbox-label">
            <input
              type="checkbox"
              className="setting-checkbox"
              checked={config.enabled || false}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
            />
            启用 Hooks 系统
          </label>
          <div className="setting-hint">
            关闭后，所有 Hook 都不会执行
          </div>
        </div>

        <div className="setting-item">
          <label className="setting-label">全局超时时间 (毫秒)</label>
          <input
            type="number"
            className="setting-input"
            value={config.globalTimeout || 30000}
            onChange={(e) => setConfig({ ...config, globalTimeout: parseInt(e.target.value) || 30000 })}
            min="1000"
            max="300000"
            step="1000"
          />
          <div className="setting-hint">
            所有 Hook 的默认超时时间
          </div>
        </div>

        <div className="setting-item">
          <label className="setting-label">最大并发 Hook 数</label>
          <input
            type="number"
            className="setting-input"
            value={config.maxConcurrent || 5}
            onChange={(e) => setConfig({ ...config, maxConcurrent: parseInt(e.target.value) || 5 })}
            min="1"
            max="20"
          />
          <div className="setting-hint">
            同时可以执行的 Hook 数量上限
          </div>
        </div>
      </section>

      {/* Hook 事件列表 */}
      <section className="config-section">
        <h4 className="config-section-title">事件 Hooks</h4>
        <p className="config-section-description">
          为每个事件配置对应的 Hook 处理器
        </p>

        <div className="hooks-list">
          {HOOK_EVENTS.map((event) => {
            const isConfigured = !!config[event.id];
            const isExpanded = selectedHook === event.id;

            return (
              <div key={event.id} className="hook-item">
                <div
                  className="hook-header"
                  onClick={() => setSelectedHook(isExpanded ? null : event.id)}
                >
                  <div className="hook-header-left">
                    <span className="hook-icon">
                      {isConfigured ? '✓' : '○'}
                    </span>
                    <div className="hook-info">
                      <span className="hook-name">{event.name}</span>
                      <span className="hook-id">{event.id}</span>
                    </div>
                  </div>
                  <div className="hook-header-right">
                    <span className={`hook-status ${isConfigured ? 'hook-configured' : 'hook-unconfigured'}`}>
                      {isConfigured ? '已配置' : '未配置'}
                    </span>
                    <span className="hook-expand-icon">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="hook-content">
                    <div className="hook-description">
                      {event.description}
                    </div>
                    <HookEditor
                      hookConfig={config[event.id] || {}}
                      onChange={(hookConfig) => updateHookConfig(event.id, hookConfig)}
                    />
                    {isConfigured && (
                      <div className="hook-actions">
                        <button
                          className="config-btn config-btn-danger-small"
                          onClick={() => removeHookConfig(event.id)}
                        >
                          移除此 Hook
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 操作按钮 */}
      <div className="config-actions">
        <button className="config-btn config-btn-primary" onClick={handleSave}>
          保存 Hooks 配置
        </button>
        {onClose && (
          <button className="config-btn config-btn-secondary" onClick={onClose}>
            取消
          </button>
        )}
      </div>
    </div>
  );
}

export default HooksConfigPanel;
