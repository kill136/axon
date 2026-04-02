/**
 * AgentsPanel - 子 Agent 管理面板
 *
 * 列表展示所有 agent（内置 + 自定义），支持自定义 agent 的 CRUD 操作。
 * 内置 agent 只读，自定义 agent 可编辑/删除。
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import styles from './AgentsPanel.module.css';

interface AgentInfo {
  agentType: string;
  displayName: string;
  description: string;
  whenToUse: string;
  tools: string[];
  forkContext: boolean;
  permissionMode?: string;
  defaultModel?: string;
  examples?: string[];
  features?: string[];
  source?: 'built-in' | 'userSettings' | 'projectSettings' | 'plugin';
}

interface AgentFormData {
  name: string;
  description: string;
  model: string;
  tools: string;
  disallowedTools: string;
  skills: string;
  permissionMode: string;
  forkContext: boolean;
  maxTurns: string;
  color: string;
  memory: string;
  systemPrompt: string;
}

const EMPTY_FORM: AgentFormData = {
  name: '',
  description: '',
  model: '',
  tools: '',
  disallowedTools: '',
  skills: '',
  permissionMode: '',
  forkContext: false,
  maxTurns: '',
  color: '',
  memory: '',
  systemPrompt: '',
};

const BUILT_IN_NAMES = new Set([
  'general-purpose', 'Explore', 'Plan', 'claude-code-guide', 'blueprint-worker', 'code-analyzer',
]);

export default function AgentsPanel() {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentInfo | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formData, setFormData] = useState<AgentFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setAgents(data.data);
      if (data.data.length > 0 && !selected) {
        setSelected(data.data[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const isBuiltIn = (agent: AgentInfo) => {
    return BUILT_IN_NAMES.has(agent.agentType) || agent.source === 'built-in';
  };

  const openCreateForm = () => {
    setFormData(EMPTY_FORM);
    setFormMode('create');
    setShowForm(true);
  };

  const openEditForm = async (agent: AgentInfo) => {
    // 尝试获取原始文件内容回填
    try {
      const res = await fetch(`/api/agents/${agent.agentType}/raw`);
      const data = await res.json();
      if (data.success && data.data.raw) {
        // 解析 frontmatter
        const raw = data.data.raw as string;
        const fmMatch = raw.match(/^---\s*\n([\s\S]*?)---\s*\n?([\s\S]*)$/);
        if (fmMatch) {
          const fm: Record<string, string> = {};
          fmMatch[1].split('\n').forEach(line => {
            const idx = line.indexOf(':');
            if (idx > 0) {
              fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
            }
          });
          setFormData({
            name: agent.agentType,
            description: fm.description || agent.description || '',
            model: fm.model || '',
            tools: fm.tools || '',
            disallowedTools: fm.disallowedTools || '',
            skills: fm.skills || '',
            permissionMode: fm.permissionMode || '',
            forkContext: fm.forkContext === 'true',
            maxTurns: fm.maxTurns || '',
            color: fm.color || '',
            memory: fm.memory || '',
            systemPrompt: fmMatch[2].trim(),
          });
          setFormMode('edit');
          setShowForm(true);
          return;
        }
      }
    } catch { /* fallback */ }

    // fallback: 从现有信息填充
    setFormData({
      name: agent.agentType,
      description: agent.description || '',
      model: agent.defaultModel || '',
      tools: agent.tools.join(', '),
      disallowedTools: '',
      skills: '',
      permissionMode: agent.permissionMode || '',
      forkContext: agent.forkContext,
      maxTurns: '',
      color: '',
      memory: '',
      systemPrompt: '',
    });
    setFormMode('edit');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.description) return;
    setSaving(true);
    try {
      const body = {
        name: formData.name,
        description: formData.description,
        model: formData.model || undefined,
        tools: formData.tools ? formData.tools.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        disallowedTools: formData.disallowedTools ? formData.disallowedTools.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        skills: formData.skills ? formData.skills.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        permissionMode: formData.permissionMode || undefined,
        forkContext: formData.forkContext || undefined,
        maxTurns: formData.maxTurns ? parseInt(formData.maxTurns) : undefined,
        color: formData.color || undefined,
        memory: formData.memory || undefined,
        systemPrompt: formData.systemPrompt || undefined,
      };

      const url = formMode === 'create' ? '/api/agents' : `/api/agents/${formData.name}`;
      const method = formMode === 'create' ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      setShowForm(false);
      await fetchAgents();
      // 选中刚创建/编辑的 agent
      setSelected(prev => {
        const found = agents.find(a => a.agentType === formData.name);
        return found || prev;
      });
    } catch (err: any) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (agent: AgentInfo) => {
    if (!confirm(`Delete agent "${agent.agentType}"?`)) return;
    try {
      const res = await fetch(`/api/agents/${agent.agentType}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      if (selected?.agentType === agent.agentType) setSelected(null);
      await fetchAgents();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  if (loading) {
    return <div className={styles.loadingContainer}>Loading agents...</div>;
  }
  if (error) {
    return (
      <div className={styles.errorContainer}>
        <span>{error}</span>
        <button className={styles.retryButton} onClick={fetchAgents}>Retry</button>
      </div>
    );
  }

  const builtInAgents = agents.filter(a => isBuiltIn(a));
  const customAgents = agents.filter(a => !isBuiltIn(a));

  return (
    <div className={styles.outerLayout}>
      {/* 左侧列表 */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <h3 className={styles.listTitle}>
            Agents
            <span className={styles.countBadge}>{agents.length}</span>
          </h3>
          <button className={styles.addButton} onClick={openCreateForm}>
            + New
          </button>
        </div>
        <div className={styles.listContent}>
          {/* 内置 agents */}
          {builtInAgents.length > 0 && (
            <>
              <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Built-in
              </div>
              {builtInAgents.map(agent => (
                <div
                  key={agent.agentType}
                  className={`${styles.agentCard} ${selected?.agentType === agent.agentType ? styles.selected : ''}`}
                  onClick={() => setSelected(agent)}
                >
                  <span className={styles.agentEmoji}>🤖</span>
                  <div className={styles.agentCardInfo}>
                    <div className={styles.agentCardName}>{agent.displayName}</div>
                    <div className={styles.agentCardDesc}>{agent.defaultModel || 'default'}</div>
                  </div>
                  <span className={`${styles.sourceBadge} ${styles.builtIn}`}>built-in</span>
                </div>
              ))}
            </>
          )}
          {/* 自定义 agents */}
          {customAgents.length > 0 && (
            <>
              <div style={{ padding: '16px 12px 4px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Custom
              </div>
              {customAgents.map(agent => (
                <div
                  key={agent.agentType}
                  className={`${styles.agentCard} ${selected?.agentType === agent.agentType ? styles.selected : ''}`}
                  onClick={() => setSelected(agent)}
                >
                  <span className={styles.agentEmoji}>🧩</span>
                  <div className={styles.agentCardInfo}>
                    <div className={styles.agentCardName}>{agent.displayName}</div>
                    <div className={styles.agentCardDesc}>{agent.defaultModel || 'default'}</div>
                  </div>
                  <span className={`${styles.sourceBadge} ${styles.custom}`}>custom</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 右侧详情 */}
      <div className={styles.detailPanel}>
        {selected ? (
          <>
            <div className={styles.detailHeader}>
              <div className={styles.detailTitleRow}>
                <span className={styles.detailIcon}>{isBuiltIn(selected) ? '🤖' : '🧩'}</span>
                <h2 className={styles.detailName}>{selected.displayName}</h2>
                {selected.defaultModel && (
                  <span className={styles.modelBadge}>{selected.defaultModel}</span>
                )}
              </div>
              {!isBuiltIn(selected) && (
                <div className={styles.detailActions}>
                  <button className={styles.editBtn} onClick={() => openEditForm(selected)}>
                    Edit
                  </button>
                  <button className={styles.deleteBtn} onClick={() => handleDelete(selected)}>
                    Delete
                  </button>
                </div>
              )}
            </div>

            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>Description</h4>
              <div className={styles.sectionContent}>{selected.description}</div>
            </div>

            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>When to use</h4>
              <div className={styles.sectionContent}>{selected.whenToUse}</div>
            </div>

            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>Tools</h4>
              <div className={styles.toolsList}>
                {selected.tools.map((tool, i) => (
                  <span key={i} className={styles.toolTag}>
                    {tool === '*' ? 'All Tools' : tool}
                  </span>
                ))}
              </div>
            </div>

            {selected.features && selected.features.length > 0 && (
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Features</h4>
                <div className={styles.sectionContent}>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {selected.features.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              </div>
            )}

            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>Meta</h4>
              <div className={styles.metaGrid}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Agent Type</span>
                  <span className={styles.metaValue}>{selected.agentType}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Fork Context</span>
                  <span className={styles.metaValue}>{selected.forkContext ? 'true' : 'false'}</span>
                </div>
                {selected.permissionMode && (
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Permission</span>
                    <span className={styles.metaValue}>{selected.permissionMode}</span>
                  </div>
                )}
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Source</span>
                  <span className={styles.metaValue}>{isBuiltIn(selected) ? 'built-in' : 'custom'}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🤖</div>
            <div className={styles.emptyText}>Select an agent to view details</div>
          </div>
        )}
      </div>

      {/* 创建/编辑表单弹窗 */}
      {showForm && (
        <div className={styles.formOverlay} onClick={() => setShowForm(false)}>
          <div className={styles.formDialog} onClick={e => e.stopPropagation()}>
            <h3 className={styles.formTitle}>
              {formMode === 'create' ? 'Create New Agent' : `Edit Agent: ${formData.name}`}
            </h3>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Name *</label>
              <input
                className={styles.formInput}
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="my-agent"
                disabled={formMode === 'edit'}
              />
              <div className={styles.formHint}>Agent identifier (lowercase, hyphens allowed)</div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Description *</label>
              <input
                className={styles.formInput}
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="What this agent does and when to use it"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Model</label>
              <select
                className={styles.formSelect}
                value={formData.model}
                onChange={e => setFormData(prev => ({ ...prev, model: e.target.value }))}
              >
                <option value="">Default (inherit)</option>
                <option value="sonnet">Sonnet</option>
                <option value="opus">Opus</option>
                <option value="haiku">Haiku</option>
                <option value="inherit">Inherit from parent</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Tools</label>
              <input
                className={styles.formInput}
                value={formData.tools}
                onChange={e => setFormData(prev => ({ ...prev, tools: e.target.value }))}
                placeholder="Read, Write, Edit, Glob, Grep, Bash"
              />
              <div className={styles.formHint}>Comma-separated. Use * for all tools. Supports Task(AgentType) syntax.</div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Disallowed Tools</label>
              <input
                className={styles.formInput}
                value={formData.disallowedTools}
                onChange={e => setFormData(prev => ({ ...prev, disallowedTools: e.target.value }))}
                placeholder="e.g. Bash, Write"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Skills</label>
              <input
                className={styles.formInput}
                value={formData.skills}
                onChange={e => setFormData(prev => ({ ...prev, skills: e.target.value }))}
                placeholder="e.g. commit, review-pr"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Permission Mode</label>
              <select
                className={styles.formSelect}
                value={formData.permissionMode}
                onChange={e => setFormData(prev => ({ ...prev, permissionMode: e.target.value }))}
              >
                <option value="">Default</option>
                <option value="bypassPermissions">Bypass (YOLO)</option>
                <option value="acceptEdits">Accept Edits</option>
                <option value="plan">Plan (read-only)</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Color</label>
              <select
                className={styles.formSelect}
                value={formData.color}
                onChange={e => setFormData(prev => ({ ...prev, color: e.target.value }))}
              >
                <option value="">None</option>
                <option value="red">Red</option>
                <option value="green">Green</option>
                <option value="yellow">Yellow</option>
                <option value="blue">Blue</option>
                <option value="magenta">Magenta</option>
                <option value="cyan">Cyan</option>
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Max Turns</label>
              <input
                className={styles.formInput}
                type="number"
                value={formData.maxTurns}
                onChange={e => setFormData(prev => ({ ...prev, maxTurns: e.target.value }))}
                placeholder="e.g. 10"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={formData.forkContext}
                  onChange={e => setFormData(prev => ({ ...prev, forkContext: e.target.checked }))}
                />
                Fork Context (access parent conversation context)
              </label>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>System Prompt</label>
              <textarea
                className={styles.formTextarea}
                value={formData.systemPrompt}
                onChange={e => setFormData(prev => ({ ...prev, systemPrompt: e.target.value }))}
                placeholder="Custom system prompt for this agent (markdown supported)"
                rows={6}
              />
            </div>

            <div className={styles.formActions}>
              <button className={styles.cancelBtn} onClick={() => setShowForm(false)}>Cancel</button>
              <button
                className={styles.submitBtn}
                onClick={handleSave}
                disabled={saving || !formData.name || !formData.description}
              >
                {saving ? 'Saving...' : formMode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
