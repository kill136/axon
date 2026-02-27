import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import type { Session } from '../../types';
import styles from './SessionSearchModal.module.css';

// ─── SVG Icons ───────────────────────────────────────────

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5" />
    <path d="M3 4l1 10h8l1-10" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const DownloadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M2 13h12" />
  </svg>
);

const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 11V2M11.5 5.5L8 2 4.5 5.5M2 13h12" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M28 19c0 3-2 5-5 5H8L4 28V8c0-2 2-4 4-4h16c3 0 5 2 5 5v10z" />
  </svg>
);

// ─── Helpers ─────────────────────────────────────────────

type DateGroup = 'today' | 'yesterday' | 'last7days' | 'older';

function getDateGroup(ts: number): DateGroup {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const last7Start = todayStart - 6 * 86400000;

  if (ts >= todayStart) return 'today';
  if (ts >= yesterdayStart) return 'yesterday';
  if (ts >= last7Start) return 'last7days';
  return 'older';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getModelShortName(model?: string): string | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('haiku')) return 'Haiku';
  return null;
}

// ─── Types ───────────────────────────────────────────────

interface SessionSearchModalProps {
  isOpen: boolean;
  sessions: Session[];
  currentSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onSessionDelete: (id: string) => void;
  onSessionRename: (id: string, name: string) => void;
  onNewSession: () => void;
  onClose: () => void;
  /** 服务端搜索：输入关键词时调用，让父组件发 WebSocket 请求 */
  onSearch?: (query: string) => void;
  /** 导出会话 */
  onSessionExport?: (id: string, format?: 'json' | 'md') => void;
  /** 导入会话（JSON 字符串） */
  onSessionImport?: (content: string) => void;
}

// ─── Component ───────────────────────────────────────────

export function SessionSearchModal({
  isOpen,
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  onSessionRename,
  onNewSession,
  onClose,
  onSearch,
  onSessionExport,
  onSessionImport,
}: SessionSearchModalProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setEditingId(null);
      setFocusIndex(0);
      // 延迟聚焦，等待动画
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // 搜索词变化时触发服务端搜索（防抖 300ms）
  useEffect(() => {
    if (!isOpen) return;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      onSearch?.(query.trim());
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [query, isOpen, onSearch]);

  // Focus rename input
  useEffect(() => {
    if (editingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [editingId]);

  // 本地过滤（作为服务端搜索结果的补充即时过滤）
  const filtered = useMemo(() => {
    if (!query.trim()) return sessions;
    const q = query.trim().toLowerCase();
    return sessions.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  }, [sessions, query]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { key: DateGroup; label: string; items: Session[] }[] = [
      { key: 'today', label: t('sessionSearch.today'), items: [] },
      { key: 'yesterday', label: t('sessionSearch.yesterday'), items: [] },
      { key: 'last7days', label: t('sessionSearch.last7days'), items: [] },
      { key: 'older', label: t('sessionSearch.older'), items: [] },
    ];
    for (const s of filtered) {
      const g = getDateGroup(s.updatedAt);
      groups.find(gr => gr.key === g)!.items.push(s);
    }
    return groups.filter(g => g.items.length > 0);
  }, [filtered, t]);

  // Flat list for keyboard navigation + session id -> flat index map
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped]);
  const sessionIdxMap = useMemo(() => {
    const map = new Map<string, number>();
    flatItems.forEach((s, i) => map.set(s.id, i));
    return map;
  }, [flatItems]);

  // Clamp focus index
  useEffect(() => {
    if (focusIndex >= flatItems.length) {
      setFocusIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, focusIndex]);

  // Scroll focused item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${focusIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIndex]);

  // Handlers
  const handleSelect = useCallback((id: string) => {
    onSessionSelect(id);
    onClose();
  }, [onSessionSelect, onClose]);

  const handleStartRename = useCallback((e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingId(session.id);
    setEditName(session.name || '');
  }, []);

  const handleFinishRename = useCallback((sessionId: string) => {
    if (editName.trim()) {
      onSessionRename(sessionId, editName.trim());
    }
    setEditingId(null);
  }, [editName, onSessionRename]);

  const handleDelete = useCallback((e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    const name = session.name || t('nav.unnamedSession');
    if (confirm(t('sessionSearch.deleteConfirm', { name }))) {
      onSessionDelete(session.id);
    }
  }, [onSessionDelete, t]);

  const handleNewSession = useCallback(() => {
    onNewSession();
    onClose();
  }, [onNewSession, onClose]);

  const handleExport = useCallback((e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    onSessionExport?.(session.id, 'json');
  }, [onSessionExport]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      onSessionImport?.(content);
    };
    reader.readAsText(file);
    // 重置 input 以便再次选择同一文件
    e.target.value = '';
  }, [onSessionImport]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingId) return; // Let rename input handle keys

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIndex(i => Math.min(i + 1, flatItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (flatItems[focusIndex]) {
          handleSelect(flatItems[focusIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [editingId, flatItems, focusIndex, handleSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Search */}
        <div className={styles.header}>
          <div className={styles.searchRow}>
            <span className={styles.searchIcon}><SearchIcon /></span>
            <input
              ref={inputRef}
              className={styles.searchInput}
              placeholder={t('sessionSearch.placeholder')}
              value={query}
              onChange={e => { setQuery(e.target.value); setFocusIndex(0); }}
            />
            <span className={styles.shortcutHint}>ESC</span>
          </div>
        </div>

        {/* List */}
        <div className={styles.body} ref={listRef}>
          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><ChatBubbleIcon /></span>
              <span>{query ? t('sessionSearch.noResults') : t('sessionSearch.empty')}</span>
            </div>
          ) : (
            grouped.map(group => {
              return (
                <div key={group.key}>
                  <div className={styles.groupLabel}>{group.label}</div>
                  {group.items.map(session => {
                    const idx = sessionIdxMap.get(session.id) ?? 0;
                    const isActive = session.id === currentSessionId;
                    const isFocused = idx === focusIndex;
                    const modelName = getModelShortName(session.model);

                    return (
                      <div
                        key={session.id}
                        data-idx={idx}
                        className={
                          `${styles.sessionItem}` +
                          `${isActive ? ` ${styles.active}` : ''}` +
                          `${isFocused ? ` ${styles.focused}` : ''}`
                        }
                        onClick={() => editingId !== session.id && handleSelect(session.id)}
                        onMouseEnter={() => setFocusIndex(idx)}
                      >
                        <div className={styles.sessionInfo}>
                          {editingId === session.id ? (
                            <input
                              ref={renameRef}
                              className={styles.renameInput}
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleFinishRename(session.id);
                                if (e.key === 'Escape') setEditingId(null);
                                e.stopPropagation();
                              }}
                              onBlur={() => handleFinishRename(session.id)}
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <>
                              <span className={styles.sessionName}>
                                {session.name || t('nav.unnamedSession')}
                              </span>
                              <span className={styles.sessionMeta}>
                                <span>{t('sessionSearch.messages', { count: session.messageCount })}</span>
                                <span className={styles.dot} />
                                <span>{formatTime(session.updatedAt)}</span>
                                {modelName && (
                                  <>
                                    <span className={styles.dot} />
                                    <span className={styles.modelBadge}>{modelName}</span>
                                  </>
                                )}
                              </span>
                            </>
                          )}
                        </div>

                        {editingId !== session.id && (
                          <div className={styles.sessionActions}>
                            <button
                              className={styles.actionBtn}
                              onClick={e => handleExport(e, session)}
                              title={t('sessionSearch.export')}
                            >
                              <DownloadIcon />
                            </button>
                            <button
                              className={styles.actionBtn}
                              onClick={e => handleStartRename(e, session)}
                              title={t('nav.rename')}
                            >
                              <PencilIcon />
                            </button>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={e => handleDelete(e, session)}
                              title={t('nav.deleteSession')}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button className={styles.newSessionBtn} onClick={handleNewSession}>
              <PlusIcon />
              {t('sessionSearch.newSession')}
            </button>
            <button className={styles.importBtn} onClick={handleImport} title={t('sessionSearch.import')}>
              <UploadIcon />
              {t('sessionSearch.import')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
          <div className={styles.footerHints}>
            <span className={styles.footerHint}><kbd>↑↓</kbd> navigate</span>
            <span className={styles.footerHint}><kbd>↵</kbd> select</span>
            <span className={styles.footerHint}><kbd>esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
