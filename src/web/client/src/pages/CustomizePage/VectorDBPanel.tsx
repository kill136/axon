import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import { useProject } from '../../contexts/ProjectContext';
import styles from './VectorDBPanel.module.css';

interface EmbeddingStats {
  totalCalls: number;
  totalTexts: number;
  errors: number;
  provider: string;
}

interface VectorDBStatus {
  totalFiles: number;
  totalChunks: number;
  dbSizeBytes: number;
  dbSizeMB: number;
  dirty: boolean;
  hasEmbeddings: boolean;
  chunksWithoutEmbedding: number;
  embeddingStats?: EmbeddingStats | null;
}

interface SearchResult {
  id: string;
  path: string;
  score: number;
  snippet: string;
  source: string;
  timestamp: string;
  startLine: number;
  endLine: number;
}

interface ChunkInfo {
  id: string;
  startLine: number;
  endLine: number;
  preview: string;
  length: number;
  hasEmbedding: boolean;
  createdAt: string;
}

type ViewMode = 'files' | 'search' | 'chunks';

export default function VectorDBPanel() {
  const { t } = useLanguage();
  const { state: projectState } = useProject();
  const projectPath = projectState.currentProject?.path || '';

  const [status, setStatus] = useState<VectorDBStatus | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('files');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'hybrid' | 'keyword'>('hybrid');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const projectParam = projectPath ? `?project=${encodeURIComponent(projectPath)}` : '';

  // 加载状态
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/vectordb/status${projectParam}`);
      const json = await res.json();
      if (json.success) setStatus(json.data);
    } catch (err) {
      console.error('[VectorDBPanel] Failed to load status:', err);
    }
  }, [projectParam]);

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vectordb/files${projectParam}`);
      const json = await res.json();
      if (json.success) setFiles(json.data.files);
    } catch (err) {
      console.error('[VectorDBPanel] Failed to load files:', err);
    } finally {
      setLoading(false);
    }
  }, [projectParam]);

  // 加载 chunk 列表
  const loadChunks = useCallback(async (filePath: string) => {
    setLoading(true);
    try {
      const sep = projectParam ? '&' : '?';
      const base = projectParam ? projectParam : '?';
      const url = `/api/vectordb/chunks${base}${projectParam ? '&' : ''}file=${encodeURIComponent(filePath)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setChunks(json.data.chunks);
        setSelectedFile(filePath);
        setViewMode('chunks');
      }
    } catch (err) {
      console.error('[VectorDBPanel] Failed to load chunks:', err);
    } finally {
      setLoading(false);
    }
  }, [projectParam]);

  // 搜索
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setViewMode('search');
    try {
      const res = await fetch('/api/vectordb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          mode: searchMode,
          maxResults: 20,
          project: projectPath || undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setSearchResults(json.data.results);
      }
    } catch (err) {
      console.error('[VectorDBPanel] Search failed:', err);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searchMode, projectPath]);

  // 同步
  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/vectordb/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectPath || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setToast({ msg: t('customize.aiProfile.vectordb.syncSuccess'), type: 'success' });
        loadStatus();
        loadFiles();
      }
    } catch (err) {
      setToast({ msg: String(err), type: 'error' });
    } finally {
      setSyncing(false);
    }
  }, [projectPath, t, loadStatus, loadFiles]);

  // 删除文件索引
  const handleDeleteFile = useCallback(async (filePath: string) => {
    if (!confirm(t('customize.aiProfile.vectordb.deleteConfirm'))) return;
    try {
      const res = await fetch('/api/vectordb/file', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, project: projectPath || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setFiles(prev => prev.filter(f => f !== filePath));
        loadStatus();
      }
    } catch (err) {
      setToast({ msg: String(err), type: 'error' });
    }
  }, [projectPath, t, loadStatus]);

  // 重新索引缺失的 embeddings
  const handleReindex = useCallback(async () => {
    setReindexing(true);
    try {
      const res = await fetch('/api/vectordb/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: projectPath || undefined }),
      });
      const json = await res.json();
      if (json.success) {
        setToast({ msg: `Re-indexed: ${json.data?.indexed ?? 0} chunks`, type: 'success' });
        loadStatus();
      } else {
        setToast({ msg: json.error || 'Reindex failed', type: 'error' });
      }
    } catch (err) {
      setToast({ msg: String(err), type: 'error' });
    } finally {
      setReindexing(false);
    }
  }, [projectPath, loadStatus]);

  useEffect(() => {
    loadStatus();
    loadFiles();
  }, [loadStatus, loadFiles]);

  // Toast 自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const shortenPath = (p: string) => {
    // 截取最后两级路径
    const parts = p.replace(/\\/g, '/').split('/');
    if (parts.length <= 3) return p;
    return '.../' + parts.slice(-3).join('/');
  };

  return (
    <div className={styles.panel}>
      {/* 统计卡片 */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('customize.aiProfile.vectordb.totalFiles')}</div>
          <div className={styles.statValue}>{status?.totalFiles ?? '-'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('customize.aiProfile.vectordb.totalChunks')}</div>
          <div className={styles.statValue}>{status?.totalChunks ?? '-'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('customize.aiProfile.vectordb.dbSize')}</div>
          <div className={styles.statValue}>{status ? formatSize(status.dbSizeBytes) : '-'}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>{t('customize.aiProfile.vectordb.embeddingStatus')}</div>
          <div className={styles.statValue} style={{ fontSize: 14 }}>
            {status?.hasEmbeddings
              ? t('customize.aiProfile.vectordb.hasEmbeddings')
              : t('customize.aiProfile.vectordb.noEmbeddings')}
          </div>
          {status && status.chunksWithoutEmbedding > 0 && (
            <div className={`${styles.statExtra} ${styles.warning}`}>
              {t('customize.aiProfile.vectordb.pendingEmbeddings', { count: String(status.chunksWithoutEmbedding) })}
            </div>
          )}
        </div>
        {/* Embedding API Stats */}
        {status?.embeddingStats && (
          <div className={styles.statCard}>
            <div className={styles.statLabel}>API Calls</div>
            <div className={styles.statValue}>{status.embeddingStats.totalCalls}</div>
            <div className={styles.statExtra}>
              {status.embeddingStats.provider}
              {status.embeddingStats.errors > 0 && (
                <span className={styles.warning}> ({status.embeddingStats.errors} errors)</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Reindex button (when there are chunks without embedding) */}
      {status && status.chunksWithoutEmbedding > 0 && (
        <div className={styles.reindexBar}>
          <span className={styles.reindexInfo}>
            {status.chunksWithoutEmbedding} chunks missing embeddings
          </span>
          <button className={styles.btnPrimary} onClick={handleReindex} disabled={reindexing}>
            {reindexing ? 'Re-indexing...' : 'Re-index Embeddings'}
          </button>
        </div>
      )}

      {/* 搜索栏 */}
      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder={t('customize.aiProfile.vectordb.searchPlaceholder')}
        />
        <select
          className={styles.modeSelect}
          value={searchMode}
          onChange={e => setSearchMode(e.target.value as 'hybrid' | 'keyword')}
        >
          <option value="hybrid">{t('customize.aiProfile.vectordb.hybrid')}</option>
          <option value="keyword">{t('customize.aiProfile.vectordb.keyword')}</option>
        </select>
        <button className={styles.btnPrimary} onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
          {searching ? '...' : t('customize.aiProfile.vectordb.search')}
        </button>
      </div>

      {/* 工具栏 */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.tabGroup}>
            <button
              className={`${styles.tab} ${viewMode === 'files' ? styles.active : ''}`}
              onClick={() => { setViewMode('files'); setSelectedFile(null); }}
            >
              {t('customize.aiProfile.vectordb.files')}
            </button>
            {searchResults.length > 0 && (
              <button
                className={`${styles.tab} ${viewMode === 'search' ? styles.active : ''}`}
                onClick={() => setViewMode('search')}
              >
                {t('customize.aiProfile.vectordb.search')} ({searchResults.length})
              </button>
            )}
            {viewMode === 'chunks' && selectedFile && (
              <button className={`${styles.tab} ${styles.active}`}>
                {t('customize.aiProfile.vectordb.chunks')}
              </button>
            )}
          </div>
        </div>
        <div className={styles.toolbarRight}>
          {viewMode === 'chunks' && (
            <button className={styles.btnGhost} onClick={() => { setViewMode('files'); setSelectedFile(null); }}>
              {t('customize.aiProfile.vectordb.backToFiles')}
            </button>
          )}
          <button className={styles.btnPrimary} onClick={handleSync} disabled={syncing}>
            {syncing ? t('customize.aiProfile.vectordb.syncing') : t('customize.aiProfile.vectordb.sync')}
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className={styles.content}>
        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : viewMode === 'files' ? (
          files.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>🗄️</div>
              <div className={styles.emptyStateText}>{t('customize.aiProfile.vectordb.noFiles')}</div>
            </div>
          ) : (
            <div className={styles.fileList}>
              {files.map(filePath => (
                <div key={filePath} className={styles.fileItem}>
                  <div className={styles.fileInfo}>
                    <div className={styles.fileName} title={filePath}>{shortenPath(filePath)}</div>
                  </div>
                  <div className={styles.fileActions}>
                    <button className={styles.btnGhost} onClick={() => loadChunks(filePath)}>
                      {t('customize.aiProfile.vectordb.viewChunks')}
                    </button>
                    <button className={styles.btnDanger} onClick={() => handleDeleteFile(filePath)}>
                      {t('customize.aiProfile.vectordb.deleteFile')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : viewMode === 'search' ? (
          searchResults.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateIcon}>🔍</div>
              <div className={styles.emptyStateText}>{t('customize.aiProfile.vectordb.noResults')}</div>
            </div>
          ) : (
            <div className={styles.resultList}>
              {searchResults.map((result, idx) => (
                <div key={result.id || idx} className={styles.resultItem}>
                  <div className={styles.resultHeader}>
                    <span className={styles.resultPath}>{shortenPath(result.path)}</span>
                    <div className={styles.resultMeta}>
                      <span className={styles.scoreBadge}>
                        {t('customize.aiProfile.vectordb.score')}: {result.score}
                      </span>
                      <span>{t('customize.aiProfile.vectordb.source')}: {result.source}</span>
                      <span>
                        {t('customize.aiProfile.vectordb.lines', {
                          start: String(result.startLine),
                          end: String(result.endLine),
                        })}
                      </span>
                    </div>
                  </div>
                  <div className={styles.resultSnippet}>{result.snippet}</div>
                </div>
              ))}
            </div>
          )
        ) : viewMode === 'chunks' ? (
          chunks.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateText}>{t('customize.aiProfile.vectordb.noResults')}</div>
            </div>
          ) : (
            <div className={styles.resultList}>
              {chunks.map(chunk => (
                <div key={chunk.id} className={styles.chunkItem}>
                  <div className={styles.chunkHeader}>
                    <span className={styles.chunkId}>
                      {t('customize.aiProfile.vectordb.lines', {
                        start: String(chunk.startLine),
                        end: String(chunk.endLine),
                      })}
                      {' '}({chunk.length} chars)
                    </span>
                    <div className={styles.chunkMeta}>
                      <span className={`${styles.embeddingBadge} ${chunk.hasEmbedding ? styles.yes : styles.no}`}>
                        {chunk.hasEmbedding
                          ? t('customize.aiProfile.vectordb.embeddingYes')
                          : t('customize.aiProfile.vectordb.embeddingNo')}
                      </span>
                    </div>
                  </div>
                  <div className={styles.chunkPreview}>{chunk.preview}</div>
                </div>
              ))}
            </div>
          )
        ) : null}
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
