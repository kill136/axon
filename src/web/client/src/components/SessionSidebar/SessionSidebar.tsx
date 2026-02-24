import React, { useState, useRef, useEffect } from 'react';
import type { Session } from '../../types';
import { useLanguage } from '../../i18n';
import styles from './SessionSidebar.module.css';

export interface SessionSidebarProps {
  isOpen: boolean;
  sessions: Session[];
  currentSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onSessionDelete: (id: string) => void;
  onSessionRename: (id: string, name: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}

// SVG Icons
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3 3" />
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2l3 3-8 8H3v-3l8-8z" />
  </svg>
);

const DeleteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4h10M5 4V3h6v1M6 7v4M10 7v4M4 4l1 9h6l1-9" />
  </svg>
);

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 9.5c0 1.5-1 2.5-2.5 2.5H4L2 14V4c0-1 1-2 2-2h8c1.5 0 2.5 1 2.5 2.5v5z" />
  </svg>
);

type DateGroup = 'today' | 'yesterday' | 'last7days' | 'older';

interface GroupedSessions {
  today: Session[];
  yesterday: Session[];
  last7days: Session[];
  older: Session[];
}

export default function SessionSidebar({
  isOpen,
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  onSessionRename,
  onNewSession,
  onClose,
}: SessionSidebarProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 聚焦重命名输入框
  useEffect(() => {
    if (editingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingSessionId]);

  // 过滤会话
  const filteredSessions = sessions.filter((session) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return session.name.toLowerCase().includes(query);
  });

  // 日期分组
  const groupSessionsByDate = (sessions: Session[]): GroupedSessions => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * oneDayMs;

    const groups: GroupedSessions = {
      today: [],
      yesterday: [],
      last7days: [],
      older: [],
    };

    sessions.forEach((session) => {
      const diff = now - session.updatedAt;
      const diffDays = Math.floor(diff / oneDayMs);

      if (diffDays === 0) {
        groups.today.push(session);
      } else if (diffDays === 1) {
        groups.yesterday.push(session);
      } else if (diff < sevenDaysMs) {
        groups.last7days.push(session);
      } else {
        groups.older.push(session);
      }
    });

    return groups;
  };

  const groupedSessions = groupSessionsByDate(filteredSessions);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const handleStartRename = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingName(session.name || '');
  };

  const handleFinishRename = (sessionId: string) => {
    if (editingName.trim() && editingName !== sessions.find(s => s.id === sessionId)?.name) {
      onSessionRename(sessionId, editingName.trim());
    }
    setEditingSessionId(null);
  };

  const handleDeleteSession = (e: React.MouseEvent, session: Session) => {
    e.stopPropagation();
    if (window.confirm(t('sidebar.deleteConfirm').replace('{{name}}', session.name))) {
      onSessionDelete(session.id);
    }
  };

  const renderSessionItem = (session: Session) => {
    const isActive = session.id === currentSessionId;
    const isEditing = editingSessionId === session.id;

    return (
      <div
        key={session.id}
        className={`${styles.sessionItem} ${isActive ? styles.active : ''}`}
        onClick={() => {
          if (!isEditing) {
            onSessionSelect(session.id);
          }
        }}
      >
        <div className={styles.sessionItemIcon}>
          <ChatIcon />
        </div>
        <div className={styles.sessionItemContent}>
          {isEditing ? (
            <input
              ref={renameInputRef}
              className={styles.renameInput}
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishRename(session.id);
                if (e.key === 'Escape') setEditingSessionId(null);
              }}
              onBlur={() => handleFinishRename(session.id)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <div className={styles.sessionItemName}>{session.name || t('nav.unnamedSession')}</div>
              <div className={styles.sessionItemMeta}>
                {t('nav.messageCount', { count: session.messageCount })} · {formatTime(session.updatedAt)}
              </div>
            </>
          )}
        </div>
        <div className={styles.sessionItemActions}>
          <button
            className={styles.actionButton}
            onClick={(e) => handleStartRename(e, session)}
            title={t('nav.rename')}
          >
            <EditIcon />
          </button>
          <button
            className={`${styles.actionButton} ${styles.deleteButton}`}
            onClick={(e) => handleDeleteSession(e, session)}
            title={t('nav.deleteSession')}
          >
            <DeleteIcon />
          </button>
        </div>
      </div>
    );
  };

  const renderGroup = (groupKey: DateGroup, sessions: Session[]) => {
    if (sessions.length === 0) return null;

    return (
      <div className={styles.sessionGroup} key={groupKey}>
        <div className={styles.groupHeader}>{t(`sidebar.${groupKey}`)}</div>
        <div className={styles.groupContent}>
          {sessions.map(renderSessionItem)}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 移动端遮罩 */}
      <div className={styles.overlay} onClick={onClose} />

      {/* 侧边栏主体 */}
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
        {/* 头部 */}
        <div className={styles.header}>
          <h2 className={styles.title}>{t('sidebar.title')}</h2>
          <button className={styles.closeButton} onClick={onClose} title={t('sidebar.toggle')}>
            <CloseIcon />
          </button>
        </div>

        {/* 搜索框 */}
        <div className={styles.searchBox}>
          <div className={styles.searchIcon}>
            <SearchIcon />
          </div>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t('sidebar.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* 会话列表 */}
        <div className={styles.sessionList}>
          {filteredSessions.length === 0 ? (
            <div className={styles.emptyState}>{t('sidebar.noResults')}</div>
          ) : (
            <>
              {renderGroup('today', groupedSessions.today)}
              {renderGroup('yesterday', groupedSessions.yesterday)}
              {renderGroup('last7days', groupedSessions.last7days)}
              {renderGroup('older', groupedSessions.older)}
            </>
          )}
        </div>

        {/* 新建会话按钮 */}
        <div className={styles.footer}>
          <button className={styles.newSessionButton} onClick={onNewSession}>
            <PlusIcon />
            <span>{t('sidebar.newSession')}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
