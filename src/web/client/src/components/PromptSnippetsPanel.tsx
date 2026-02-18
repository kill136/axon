/**
 * 提示词片段管理面板
 * 支持增删改查、启用/禁用、排序提示词片段
 */

import { useState, useEffect, useCallback } from 'react';
import './PromptSnippetsPanel.css';
import { useLanguage } from '../i18n';

interface PromptSnippet {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  priority: number;
  position: 'prepend' | 'append';
  createdAt: string;
  updatedAt: string;
  description?: string;
  tags?: string[];
}

interface PromptSnippetsPanelProps {
  onClose?: () => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
}

type ViewMode = 'list' | 'create' | 'edit';

export function PromptSnippetsPanel({ onClose, onSendMessage, addMessageHandler }: PromptSnippetsPanelProps) {
  const { t } = useLanguage();
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [editingSnippet, setEditingSnippet] = useState<PromptSnippet | null>(null);
  const [loading, setLoading] = useState(false);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPosition, setFormPosition] = useState<'prepend' | 'append'>('append');
  const [formTags, setFormTags] = useState('');

  // 请求片段列表
  const requestList = useCallback(() => {
    setLoading(true);
    onSendMessage?.({ type: 'prompt_snippets_list' });
  }, [onSendMessage]);

  // 监听响应
  useEffect(() => {
    if (!addMessageHandler) return;

    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'prompt_snippets_response') {
        if (msg.payload?.snippets) {
          setSnippets(msg.payload.snippets);
        }
        setLoading(false);
        // 创建/更新成功后回到列表
        if (msg.payload?.created || msg.payload?.updated) {
          setViewMode('list');
          resetForm();
        }
      }
    });

    return unsubscribe;
  }, [addMessageHandler]);

  // 初始加载
  useEffect(() => {
    requestList();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setFormName('');
    setFormContent('');
    setFormDescription('');
    setFormPosition('append');
    setFormTags('');
    setEditingSnippet(null);
  };

  const handleCreate = () => {
    resetForm();
    setViewMode('create');
  };

  const handleEdit = (snippet: PromptSnippet) => {
    setEditingSnippet(snippet);
    setFormName(snippet.name);
    setFormContent(snippet.content);
    setFormDescription(snippet.description || '');
    setFormPosition(snippet.position);
    setFormTags(snippet.tags?.join(', ') || '');
    setViewMode('edit');
  };

  const handleSave = () => {
    if (!formName.trim() || !formContent.trim()) return;

    const tags = formTags.split(',').map(t => t.trim()).filter(Boolean);

    if (viewMode === 'create') {
      onSendMessage?.({
        type: 'prompt_snippets_create',
        payload: {
          name: formName.trim(),
          content: formContent,
          description: formDescription.trim() || undefined,
          position: formPosition,
          tags: tags.length > 0 ? tags : undefined,
        },
      });
    } else if (viewMode === 'edit' && editingSnippet) {
      onSendMessage?.({
        type: 'prompt_snippets_update',
        payload: {
          id: editingSnippet.id,
          name: formName.trim(),
          content: formContent,
          description: formDescription.trim() || undefined,
          position: formPosition,
          tags: tags.length > 0 ? tags : undefined,
        },
      });
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`确定删除片段 "${name}" 吗？`)) return;
    onSendMessage?.({
      type: 'prompt_snippets_delete',
      payload: { id },
    });
  };

  const handleToggle = (id: string) => {
    onSendMessage?.({
      type: 'prompt_snippets_toggle',
      payload: { id },
    });
  };

  const handleCancel = () => {
    setViewMode('list');
    resetForm();
  };

  const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

  // 列表视图
  if (viewMode === 'list') {
    const enabledCount = snippets.filter(s => s.enabled).length;
    const totalTokens = snippets.filter(s => s.enabled).reduce((sum, s) => sum + estimateTokens(s.content), 0);

    return (
      <div className="prompt-snippets-panel">
        <h3>Prompt Snippets</h3>
        <p className="settings-description">
          管理自定义提示词片段，动态注入系统提示词。片段持久化到 ~/.claude/prompt-snippets/。
        </p>

        <div className="snippets-stats">
          <span>{snippets.length} 个片段</span>
          <span className="snippets-stats-sep">|</span>
          <span>{enabledCount} 个启用</span>
          <span className="snippets-stats-sep">|</span>
          <span>~{totalTokens.toLocaleString()} tokens</span>
        </div>

        <div className="snippets-actions">
          <button className="snippets-btn snippets-btn-primary" onClick={handleCreate}>
            + 新建片段
          </button>
          <button className="snippets-btn" onClick={requestList} disabled={loading}>
            {loading ? '...' : '刷新'}
          </button>
        </div>

        {snippets.length === 0 ? (
          <div className="snippets-empty">
            <p>暂无提示词片段</p>
            <p className="snippets-empty-hint">
              点击"新建片段"添加你的第一个提示词片段。
              片段将被注入到系统提示词中，影响 AI 的行为方式。
            </p>
          </div>
        ) : (
          <div className="snippets-list">
            {snippets.map(snippet => (
              <div
                key={snippet.id}
                className={`snippet-card ${snippet.enabled ? 'snippet-enabled' : 'snippet-disabled'}`}
              >
                <div className="snippet-card-header">
                  <div className="snippet-card-left">
                    <button
                      className={`snippet-toggle ${snippet.enabled ? 'on' : 'off'}`}
                      onClick={() => handleToggle(snippet.id)}
                      title={snippet.enabled ? '点击禁用' : '点击启用'}
                    >
                      {snippet.enabled ? '●' : '○'}
                    </button>
                    <span className="snippet-name">{snippet.name}</span>
                    <span className={`snippet-position-badge snippet-position-${snippet.position}`}>
                      {snippet.position === 'prepend' ? '前置' : '追加'}
                    </span>
                  </div>
                  <div className="snippet-card-right">
                    <span className="snippet-tokens">~{estimateTokens(snippet.content)} tokens</span>
                    <button className="snippet-action-btn" onClick={() => handleEdit(snippet)} title="编辑">
                      ✎
                    </button>
                    <button className="snippet-action-btn snippet-delete-btn" onClick={() => handleDelete(snippet.id, snippet.name)} title="删除">
                      ×
                    </button>
                  </div>
                </div>
                {snippet.description && (
                  <div className="snippet-description">{snippet.description}</div>
                )}
                <div className="snippet-preview">
                  {snippet.content.slice(0, 200)}
                  {snippet.content.length > 200 ? '...' : ''}
                </div>
                {snippet.tags && snippet.tags.length > 0 && (
                  <div className="snippet-tags">
                    {snippet.tags.map(tag => (
                      <span key={tag} className="snippet-tag">{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // 创建/编辑视图
  return (
    <div className="prompt-snippets-panel">
      <h3>{viewMode === 'create' ? '新建提示词片段' : '编辑提示词片段'}</h3>
      <p className="settings-description">
        {viewMode === 'create'
          ? '创建一个新的提示词片段，注入到系统提示词中。'
          : `正在编辑: ${editingSnippet?.name}`}
      </p>

      <div className="snippet-form">
        <div className="snippet-form-group">
          <label>名称 *</label>
          <input
            type="text"
            className="snippet-input"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="例如: code-review-rules"
          />
        </div>

        <div className="snippet-form-group">
          <label>描述</label>
          <input
            type="text"
            className="snippet-input"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="简要描述这个片段的作用"
          />
        </div>

        <div className="snippet-form-row">
          <div className="snippet-form-group snippet-form-half">
            <label>注入位置</label>
            <select
              className="snippet-select"
              value={formPosition}
              onChange={(e) => setFormPosition(e.target.value as 'prepend' | 'append')}
            >
              <option value="append">追加 (在系统提示词之后)</option>
              <option value="prepend">前置 (在系统提示词之前)</option>
            </select>
          </div>
          <div className="snippet-form-group snippet-form-half">
            <label>标签 (逗号分隔)</label>
            <input
              type="text"
              className="snippet-input"
              value={formTags}
              onChange={(e) => setFormTags(e.target.value)}
              placeholder="例如: style, rules"
            />
          </div>
        </div>

        <div className="snippet-form-group">
          <label>
            内容 *
            <span className="snippet-token-hint">~{estimateTokens(formContent).toLocaleString()} tokens</span>
          </label>
          <textarea
            className="snippet-textarea"
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder="输入要注入到系统提示词中的内容..."
            rows={12}
          />
        </div>

        <div className="snippet-form-actions">
          <button className="snippets-btn" onClick={handleCancel}>
            取消
          </button>
          <button
            className="snippets-btn snippets-btn-primary"
            onClick={handleSave}
            disabled={!formName.trim() || !formContent.trim()}
          >
            {viewMode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PromptSnippetsPanel;
