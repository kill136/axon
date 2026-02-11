/**
 * 权限配置面板组件
 * 用于配置完整的权限系统，包括默认模式、工具权限、路径权限、命令权限、网络权限和审计日志
 */

import { useState, useEffect } from 'react';
import '../../styles/config-panels.css';

// ============ 类型定义 ============

interface ConfigPanelProps {
  onSave: (config: PermissionsConfig) => void;
  onClose?: () => void;
  initialConfig?: PermissionsConfig;
}

interface PermissionsConfig {
  defaultMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
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

export function PermissionsConfigPanel({ onSave, onClose, initialConfig }: ConfigPanelProps) {
  const [config, setConfig] = useState<PermissionsConfig>({
    defaultMode: 'default',
    tools: { allow: [], deny: [] },
    paths: { allow: [], deny: [] },
    commands: { allow: [], deny: [] },
    network: { allow: [], deny: [] },
    audit: { enabled: false },
  });

  // 加载初始配置
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

    onSave(cleanedConfig);
  };

  return (
    <div className="permissions-config-panel">
      <div className="config-panel-header">
        <h3>权限配置</h3>
        <p className="config-description">
          配置 Claude Code 的权限系统，控制工具、文件、命令和网络访问权限
        </p>
      </div>

      {/* 默认权限模式 */}
      <section className="config-section">
        <h4 className="config-section-title">默认权限模式</h4>
        <p className="config-section-description">
          选择默认的权限检查行为
        </p>
        <div className="setting-item">
          <label className="setting-label">权限模式</label>
          <select
            className="setting-select"
            value={config.defaultMode}
            onChange={(e) => setConfig({ ...config, defaultMode: e.target.value as any })}
          >
            <option value="default">默认 (每次询问权限)</option>
            <option value="acceptEdits">自动接受编辑 (自动接受文件编辑操作)</option>
            <option value="bypassPermissions">跳过所有权限 (不进行权限检查)</option>
            <option value="plan">计划模式 (只规划不执行)</option>
          </select>
          <div className="setting-hint">
            {config.defaultMode === 'default' && '每次操作都会请求用户确认'}
            {config.defaultMode === 'acceptEdits' && '自动接受文件编辑，其他操作仍需确认'}
            {config.defaultMode === 'bypassPermissions' && '跳过所有权限检查，直接执行'}
            {config.defaultMode === 'plan' && '只生成执行计划，不实际执行任何操作'}
          </div>
        </div>
      </section>

      {/* 工具权限 */}
      <section className="config-section">
        <h4 className="config-section-title">工具权限</h4>
        <p className="config-section-description">
          控制允许或禁止使用的工具（白名单/黑名单）
        </p>
        <div className="setting-item">
          <label className="setting-label">
            允许的工具 (逗号分隔)
            <span className="setting-label-hint">留空表示允许所有</span>
          </label>
          <input
            type="text"
            className="setting-input"
            value={config.tools?.allow?.join(', ') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                tools: {
                  ...config.tools,
                  allow: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                },
              })
            }
            placeholder="Bash, Read, Write, Edit, Glob, Grep"
          />
          <div className="setting-hint">
            示例: Bash, Read, Write, Edit, Glob, Grep, WebFetch
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            禁止的工具 (逗号分隔)
            <span className="setting-label-hint">优先级高于允许列表</span>
          </label>
          <input
            type="text"
            className="setting-input"
            value={config.tools?.deny?.join(', ') || ''}
            onChange={(e) =>
              setConfig({
                ...config,
                tools: {
                  ...config.tools,
                  deny: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                },
              })
            }
            placeholder="WebFetch, WebSearch"
          />
          <div className="setting-hint">
            禁止的工具将完全无法使用，即使在允许列表中
          </div>
        </div>
      </section>

      {/* 路径权限 */}
      <section className="config-section">
        <h4 className="config-section-title">路径权限</h4>
        <p className="config-section-description">
          使用 glob 模式控制文件系统访问权限
        </p>
        <div className="setting-item">
          <label className="setting-label">
            允许的路径 (每行一个 glob 模式)
            <span className="setting-label-hint">支持 * 和 ** 通配符</span>
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
            placeholder="/home/user/**&#10;/project/**/*.ts&#10;/data/**/*.json"
            rows={4}
          />
          <div className="setting-hint">
            示例: /home/user/**, /project/**/*.ts, ./src/**
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            禁止的路径 (每行一个 glob 模式)
            <span className="setting-label-hint">优先级最高</span>
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
            placeholder="/etc/**&#10;/root/**&#10;/sys/**"
            rows={4}
          />
          <div className="setting-hint">
            禁止访问的路径，通常是系统关键目录
          </div>
        </div>
      </section>

      {/* 命令权限 */}
      <section className="config-section">
        <h4 className="config-section-title">命令权限</h4>
        <p className="config-section-description">
          控制允许执行的 Shell 命令 (支持 glob 模式)
        </p>
        <div className="setting-item">
          <label className="setting-label">
            允许的命令 (每行一个模式)
            <span className="setting-label-hint">支持通配符</span>
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
            placeholder="git *&#10;npm *&#10;ls *&#10;cat *"
            rows={3}
          />
          <div className="setting-hint">
            示例: git *, npm *, ls *, cat *
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            禁止的命令 (每行一个模式)
            <span className="setting-label-hint">危险命令黑名单</span>
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
            placeholder="rm -rf *&#10;sudo *&#10;chmod 777 *"
            rows={3}
          />
          <div className="setting-hint">
            禁止的危险命令，防止误操作
          </div>
        </div>
      </section>

      {/* 网络权限 */}
      <section className="config-section">
        <h4 className="config-section-title">网络权限</h4>
        <p className="config-section-description">
          控制允许访问的网络资源 (URL 模式)
        </p>
        <div className="setting-item">
          <label className="setting-label">
            允许的 URL (每行一个模式)
            <span className="setting-label-hint">支持通配符</span>
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
            placeholder="https://api.github.com/**&#10;https://*.anthropic.com/**&#10;https://npmjs.com/**"
            rows={3}
          />
          <div className="setting-hint">
            示例: https://api.github.com/**, https://*.anthropic.com/**
          </div>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            禁止的 URL (每行一个模式)
            <span className="setting-label-hint">URL 黑名单</span>
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
            placeholder="http://**&#10;https://malicious.com/**"
            rows={3}
          />
          <div className="setting-hint">
            禁止访问的 URL，用于安全控制
          </div>
        </div>
      </section>

      {/* 审计日志 */}
      <section className="config-section">
        <h4 className="config-section-title">审计日志</h4>
        <p className="config-section-description">
          记录所有权限请求和决策，用于安全审计
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
            启用审计日志
          </label>
          <div className="setting-hint">
            记录所有权限请求、批准/拒绝决策和执行结果
          </div>
        </div>
        {config.audit?.enabled && (
          <div className="setting-item">
            <label className="setting-label">日志文件路径</label>
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
              placeholder="~/.claude/audit.log"
            />
            <div className="setting-hint">
              留空使用默认路径: ~/.claude/audit.log
            </div>
          </div>
        )}
      </section>

      {/* 操作按钮 */}
      <div className="config-actions">
        <button className="config-btn config-btn-primary" onClick={handleSave}>
          保存权限配置
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

export default PermissionsConfigPanel;
