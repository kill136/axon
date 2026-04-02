import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { MarkdownContent } from '../../components/MarkdownContent';
import { useLanguage } from '../../i18n';
import { useProject } from '../../contexts/ProjectContext';
import styles from './DocsPanel.module.css';

const VectorDBPanel = lazy(() => import('./VectorDBPanel'));

interface NotebookInfo {
  tokens: number;
  exists: boolean;
  path: string;
  maxTokens: number;
  description: string;
}

interface NotebookListResponse {
  success: boolean;
  data: {
    notebooks: {
      profile: NotebookInfo;
      experience: NotebookInfo;
      project: NotebookInfo;
      identity: NotebookInfo;
      'tools-notes': NotebookInfo;
    };
    axonMd: { path: string; size: number; lastModified: string } | null;
    projectPath: string;
  };
}

type DocType = 'axonmd' | 'profile' | 'experience' | 'project' | 'identity' | 'tools-notes' | 'vectordb';

interface DocItem {
  type: DocType;
  icon: string;
  nameKey: string;
  descKey: string;
  exists: boolean;
  tokens?: number;
  maxTokens?: number;
  group: 'project' | 'memory' | 'persona' | 'vectordb';
}

export default function DocsPanel() {
  const { t } = useLanguage();
  const { state: projectState } = useProject();
  const projectPath = projectState.currentProject?.path || '';
  const [items, setItems] = useState<DocItem[]>([]);
  const [selected, setSelected] = useState<DocType | null>(null);
  const [content, setContent] = useState('');
  const [editedContent, setEditedContent] = useState('');
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasChanges = mode === 'edit' && editedContent !== content;

  // 加载文件列表
  const loadList = useCallback(async () => {
    try {
      const params = projectPath ? `?project=${encodeURIComponent(projectPath)}` : '';
      const res = await fetch(`/api/notebook/list${params}`);
      const json: NotebookListResponse = await res.json();
      if (!json.success) return;

      const { notebooks, axonMd } = json.data;
      const docItems: DocItem[] = [
        {
          type: 'axonmd',
          icon: '📋',
          nameKey: 'customize.aiProfile.axonmd',
          descKey: 'customize.aiProfile.axonmdDesc',
          exists: !!axonMd,
          group: 'project',
        },
        {
          type: 'profile',
          icon: '👤',
          nameKey: 'customize.aiProfile.profile',
          descKey: 'customize.aiProfile.profileDesc',
          exists: notebooks.profile.exists,
          tokens: notebooks.profile.tokens,
          maxTokens: notebooks.profile.maxTokens,
          group: 'memory',
        },
        {
          type: 'experience',
          icon: '🧠',
          nameKey: 'customize.aiProfile.experience',
          descKey: 'customize.aiProfile.experienceDesc',
          exists: notebooks.experience.exists,
          tokens: notebooks.experience.tokens,
          maxTokens: notebooks.experience.maxTokens,
          group: 'memory',
        },
        {
          type: 'project',
          icon: '📁',
          nameKey: 'customize.aiProfile.project',
          descKey: 'customize.aiProfile.projectDesc',
          exists: notebooks.project.exists,
          tokens: notebooks.project.tokens,
          maxTokens: notebooks.project.maxTokens,
          group: 'memory',
        },
        {
          type: 'identity',
          icon: '🎭',
          nameKey: 'customize.aiProfile.identity',
          descKey: 'customize.aiProfile.identityDesc',
          exists: notebooks.identity.exists,
          tokens: notebooks.identity.tokens,
          maxTokens: notebooks.identity.maxTokens,
          group: 'persona',
        },
        {
          type: 'tools-notes',
          icon: '🔧',
          nameKey: 'customize.aiProfile.toolsNotes',
          descKey: 'customize.aiProfile.toolsNotesDesc',
          exists: notebooks['tools-notes'].exists,
          tokens: notebooks['tools-notes'].tokens,
          maxTokens: notebooks['tools-notes'].maxTokens,
          group: 'persona',
        },
        {
          type: 'vectordb',
          icon: '🗄️',
          nameKey: 'customize.aiProfile.vectordb',
          descKey: 'customize.aiProfile.vectordbDesc',
          exists: true,
          group: 'vectordb',
        },
      ];
      setItems(docItems);
    } catch (err) {
      console.error('[DocsPanel] Failed to load list:', err);
    }
  }, [projectPath]);

  useEffect(() => { loadList(); }, [loadList]);

  // 项目切换时重置选中状态并重新加载
  useEffect(() => {
    setSelected(null);
    setContent('');
    setEditedContent('');
    setMode('preview');
    loadList();
  }, [projectPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载文件内容
  const loadContent = useCallback(async (type: DocType) => {
    setLoading(true);
    try {
      const projectParam = projectPath ? `&project=${encodeURIComponent(projectPath)}` : '';
      const res = await fetch(`/api/notebook/read?type=${type}${projectParam}`);
      const json = await res.json();
      if (json.success) {
        setContent(json.data.content || '');
        setEditedContent(json.data.content || '');
      }
    } catch (err) {
      console.error('[DocsPanel] Failed to load content:', err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // 选择文件
  const handleSelect = useCallback((type: DocType) => {
    if (hasChanges) {
      if (!confirm(t('customize.aiProfile.unsavedChanges'))) return;
    }
    setSelected(type);
    setMode('preview');
    loadContent(type);
  }, [hasChanges, loadContent, t]);

  // 保存
  const handleSave = useCallback(async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/notebook/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: selected, content: editedContent, project: projectPath || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setContent(editedContent);
        setToast({ msg: t('customize.aiProfile.saved'), type: 'success' });
        loadList(); // 刷新 token 数
      } else {
        setToast({ msg: json.error || 'Save failed', type: 'error' });
      }
    } catch (err) {
      setToast({ msg: String(err), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [selected, editedContent, projectPath, t, loadList]);

  // 取消编辑
  const handleCancel = useCallback(() => {
    setEditedContent(content);
    setMode('preview');
  }, [content]);

  // 创建 AXON.md
  const handleCreateAxonMd = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/notebook/write', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'axonmd', content: '# AXON.md\n\n## Instructions\n\nAdd your project-specific AI instructions here.\n', project: projectPath || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setToast({ msg: t('customize.aiProfile.saved'), type: 'success' });
        loadList();
        setSelected('axonmd');
        loadContent('axonmd');
      }
    } catch (err) {
      setToast({ msg: String(err), type: 'error' });
    } finally {
      setSaving(false);
    }
  }, [projectPath, t, loadList, loadContent]);

  // Toast 自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // 当前选中项的信息
  const selectedItem = items.find(i => i.type === selected);

  // 计算 token 使用（粗略估算：4 chars ≈ 1 token）
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const currentTokens = mode === 'edit' ? estimateTokens(editedContent) : (selectedItem?.tokens || 0);
  const isOverBudget = selectedItem?.maxTokens ? currentTokens > selectedItem.maxTokens : false;

  const projectItems = items.filter(i => i.group === 'project');
  const memoryItems = items.filter(i => i.group === 'memory');
  const personaItems = items.filter(i => i.group === 'persona');
  const vectordbItems = items.filter(i => i.group === 'vectordb');

  const isVectorDBSelected = selected === 'vectordb';

  return (
    <div className={styles.docsPanel}>
      {/* 左侧：文件列表 */}
      <div className={styles.fileList}>
        <div className={styles.fileListHeader}>
          <h3 className={styles.fileListTitle}>{t('customize.aiProfile')}</h3>
          <p className={styles.fileListDesc}>{t('customize.aiProfileDesc')}</p>
        </div>

        <div className={styles.fileCards}>
          {/* 项目级 */}
          <div className={styles.groupTitle}>Project</div>
          {projectItems.map(item => (
            <button
              key={item.type}
              className={`${styles.fileCard} ${selected === item.type ? styles.active : ''}`}
              onClick={() => handleSelect(item.type)}
            >
              <div className={styles.fileCardIcon}>{item.icon}</div>
              <div className={styles.fileCardInfo}>
                <div className={styles.fileCardName}>{t(item.nameKey)}</div>
                <div className={styles.fileCardMeta}>
                  <span className={styles.fileCardStatus}>
                    <span className={`${styles.statusDot} ${item.exists ? styles.exists : styles.missing}`} />
                    {item.exists ? (item.tokens !== undefined ? t('customize.aiProfile.tokens', { count: String(item.tokens) }) : '') : t('customize.aiProfile.notFound')}
                  </span>
                </div>
              </div>
            </button>
          ))}

          {/* 记忆笔记本 */}
          <div className={styles.groupTitle}>Memory</div>
          {memoryItems.map(item => (
            <button
              key={item.type}
              className={`${styles.fileCard} ${selected === item.type ? styles.active : ''}`}
              onClick={() => handleSelect(item.type)}
            >
              <div className={styles.fileCardIcon}>{item.icon}</div>
              <div className={styles.fileCardInfo}>
                <div className={styles.fileCardName}>{t(item.nameKey)}</div>
                <div className={styles.fileCardMeta}>
                  <span className={styles.fileCardStatus}>
                    <span className={`${styles.statusDot} ${item.exists ? styles.exists : styles.missing}`} />
                    {item.tokens !== undefined ? t('customize.aiProfile.tokens', { count: String(item.tokens) }) : ''}
                    {item.maxTokens ? ` / ${item.maxTokens}` : ''}
                  </span>
                </div>
              </div>
            </button>
          ))}

          {/* AI 人格 & 工具备注 */}
          <div className={styles.groupTitle}>Persona</div>
          {personaItems.map(item => (
            <button
              key={item.type}
              className={`${styles.fileCard} ${selected === item.type ? styles.active : ''}`}
              onClick={() => handleSelect(item.type)}
            >
              <div className={styles.fileCardIcon}>{item.icon}</div>
              <div className={styles.fileCardInfo}>
                <div className={styles.fileCardName}>{t(item.nameKey)}</div>
                <div className={styles.fileCardMeta}>
                  <span className={styles.fileCardStatus}>
                    <span className={`${styles.statusDot} ${item.exists ? styles.exists : styles.missing}`} />
                    {item.tokens !== undefined ? t('customize.aiProfile.tokens', { count: String(item.tokens) }) : ''}
                    {item.maxTokens ? ` / ${item.maxTokens}` : ''}
                  </span>
                </div>
              </div>
            </button>
          ))}

          {/* 向量数据库 */}
          <div className={styles.groupTitle}>Vector DB</div>
          {vectordbItems.map(item => (
            <button
              key={item.type}
              className={`${styles.fileCard} ${selected === item.type ? styles.active : ''}`}
              onClick={() => { setSelected('vectordb'); setMode('preview'); }}
            >
              <div className={styles.fileCardIcon}>{item.icon}</div>
              <div className={styles.fileCardInfo}>
                <div className={styles.fileCardName}>{t(item.nameKey)}</div>
                <div className={styles.fileCardMeta}>
                  <span className={styles.fileCardStatus}>
                    <span className={`${styles.statusDot} ${styles.exists}`} />
                    {t(item.descKey)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧：编辑器或向量数据库面板 */}
      <div className={styles.editorArea}>
        {isVectorDBSelected ? (
          <Suspense fallback={<div className={styles.editorPlaceholder}>Loading...</div>}>
            <VectorDBPanel />
          </Suspense>
        ) : !selected ? (
          <div className={styles.editorPlaceholder}>
            {t('customize.aiProfileDesc')}
          </div>
        ) : loading ? (
          <div className={styles.editorPlaceholder}>Loading...</div>
        ) : !selectedItem?.exists && selected === 'axonmd' && !content ? (
          /* AXON.md 不存在时的创建提示 */
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>📋</div>
            <div className={styles.emptyStateText}>{t('customize.aiProfile.notFound')}</div>
            <button className={styles.btnPrimary} onClick={handleCreateAxonMd} disabled={saving}>
              {t('customize.aiProfile.createAxonMd')}
            </button>
          </div>
        ) : (
          <>
            {/* 编辑器头部 */}
            <div className={styles.editorHeader}>
              <div className={styles.editorTitleGroup}>
                <div className={styles.editorTitle}>{selectedItem ? t(selectedItem.nameKey) : ''}</div>
                <div className={styles.editorSubtitle}>{selectedItem ? t(selectedItem.descKey) : ''}</div>
              </div>
              <div className={styles.editorActions}>
                {selectedItem?.maxTokens && (
                  <span className={`${styles.tokenBadge} ${isOverBudget ? styles.overBudget : ''}`}>
                    {currentTokens} / {selectedItem.maxTokens} tokens
                  </span>
                )}
                {mode === 'edit' ? (
                  <>
                    <button className={styles.btnSecondary} onClick={handleCancel}>
                      {t('customize.aiProfile.cancel')}
                    </button>
                    <button
                      className={styles.btnPrimary}
                      onClick={handleSave}
                      disabled={saving || !hasChanges || isOverBudget}
                    >
                      {saving ? t('customize.aiProfile.saving') : t('customize.aiProfile.save')}
                    </button>
                  </>
                ) : (
                  <button className={styles.btnPrimary} onClick={() => setMode('edit')}>
                    {t('customize.aiProfile.edit')}
                  </button>
                )}
              </div>
            </div>

            {/* 模式切换 Tab */}
            <div className={styles.modeTabs}>
              <button
                className={`${styles.modeTab} ${mode === 'preview' ? styles.active : ''}`}
                onClick={() => setMode('preview')}
              >
                {t('customize.aiProfile.preview')}
              </button>
              <button
                className={`${styles.modeTab} ${mode === 'edit' ? styles.active : ''}`}
                onClick={() => setMode('edit')}
              >
                {t('customize.aiProfile.edit')}
              </button>
            </div>

            {/* 内容区 */}
            <div className={styles.editorContent}>
              {mode === 'edit' ? (
                <textarea
                  ref={textareaRef}
                  className={styles.editorTextarea}
                  value={editedContent}
                  onChange={e => setEditedContent(e.target.value)}
                  placeholder={t('customize.aiProfile.noContent')}
                  spellCheck={false}
                />
              ) : content ? (
                <div className={styles.markdownPreview}>
                  <MarkdownContent content={content} />
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateText}>{t('customize.aiProfile.noContent')}</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.success : styles.error}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
