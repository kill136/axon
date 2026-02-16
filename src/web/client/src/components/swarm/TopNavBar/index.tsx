import { useState, useEffect, useRef } from 'react';
import styles from './TopNavBar.module.css';
import ProjectSelector from '../ProjectSelector/ProjectSelector';
import { useLanguage } from '../../../i18n';

interface SessionItem {
  id: string;
  name: string;
  updatedAt: number;
  messageCount: number;
}

interface ProjectItem {
  id: string;
  name: string;
  path: string;
  lastOpenedAt?: string;
  isEmpty?: boolean;
  hasBlueprint?: boolean;
}

export interface TopNavBarProps {
  currentPage: 'chat' | 'swarm' | 'blueprint';
  onPageChange: (page: 'chat' | 'swarm' | 'blueprint') => void;
  onSettingsClick?: () => void;
  /** 代码视图是否激活 */
  codeViewActive?: boolean;
  /** 切换代码视图 */
  onToggleCodeView?: () => void;
  /** 连接状态 */
  connected?: boolean;
  // 项目相关
  currentProject?: ProjectItem | null;
  onProjectChange?: (project: ProjectItem) => void;
  onOpenFolder?: () => void;
  onProjectRemove?: (project: ProjectItem) => void;
  // 会话相关
  sessions?: SessionItem[];
  currentSessionId?: string | null;
  onSessionSelect?: (id: string) => void;
  onNewSession?: () => void;
  onSessionDelete?: (id: string) => void;
  onSessionRename?: (id: string, name: string) => void;
}

// SVG 图标组件
const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h4l1 1h7v9H2V3z" />
  </svg>
);

const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 9.5c0 1.5-1 2.5-2.5 2.5H4L2 14V4c0-1 1-2 2-2h8c1.5 0 2.5 1 2.5 2.5v5z" />
  </svg>
);

const BlueprintIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="1" />
    <path d="M2 6h12M6 2v12" />
  </svg>
);

const SwarmIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="4" r="1.5" />
    <circle cx="4" cy="10" r="1.5" />
    <circle cx="12" cy="10" r="1.5" />
    <path d="M7 5.5L5 9M9 5.5L11 9" />
  </svg>
);

const ConversationViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h12M2 8h12M2 13h8" />
  </svg>
);

const CodeViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 4L2 8l3 4M11 4l3 4-3 4" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="3" />
    <path d="M12 8a4 4 0 00-.5-2l1.5-1-1-1.7-1.8.5a4 4 0 00-1.7-1V1h-2v1.8a4 4 0 00-1.7 1L3 3.3l-1 1.7 1.5 1a4 4 0 000 4l-1.5 1 1 1.7 1.8-.5a4 4 0 001.7 1V15h2v-1.8a4 4 0 001.7-1l1.8.5 1-1.7-1.5-1a4 4 0 00.5-2z" />
  </svg>
);

/**
 * 顶部导航栏组件 - 两行布局
 * 第一行：项目选择器 + 会话选择器 + 连接状态 + 新会话按钮 + 设置按钮
 * 第二行：页面 Tab（Chat/Blueprint/Swarm）+ 视图切换按钮（仅 Chat 页面显示）
 */
export default function TopNavBar({
  currentPage, onPageChange, onSettingsClick,
  codeViewActive, onToggleCodeView, connected,
  currentProject, onProjectChange, onOpenFolder, onProjectRemove,
  sessions = [], currentSessionId, onSessionSelect, onNewSession,
  onSessionDelete, onSessionRename,
}: TopNavBarProps) {
  const { t } = useLanguage();
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const sessionDropdownRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭会话下拉
  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (sessionDropdownRef.current && !sessionDropdownRef.current.contains(e.target as Node)) {
        setSessionDropdownOpen(false);
        setEditingSessionId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sessionDropdownOpen]);

  // 聚焦重命名输入框
  useEffect(() => {
    if (editingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingSessionId]);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const handleStartRename = (e: React.MouseEvent, session: SessionItem) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingName(session.name || '');
  };

  const handleFinishRename = (sessionId: string) => {
    if (editingName.trim()) {
      onSessionRename?.(sessionId, editingName.trim());
    }
    setEditingSessionId(null);
  };

  return (
    <nav className={styles.topNavBar}>
      {/* 第一行：全局上下文行 */}
      <div className={styles.contextRow}>
        {/* 左侧：项目选择器 */}
        <div className={styles.contextLeft}>
          <ProjectSelector
            currentProject={currentProject}
            onProjectChange={onProjectChange}
            onOpenFolder={onOpenFolder}
            onProjectRemove={onProjectRemove}
            className={styles.navProjectSelector}
          />
        </div>

        {/* 中间：会话选择器 + 新建按钮 */}
        <div className={styles.contextCenter}>
          <div className={styles.sessionGroup}>
          <div className={styles.sessionSelector} ref={sessionDropdownRef}>
            <button
              className={`${styles.sessionTrigger} ${sessionDropdownOpen ? styles.open : ''}`}
              onClick={() => setSessionDropdownOpen(!sessionDropdownOpen)}
            >
              <span className={styles.sessionIcon}>
                <ChatIcon />
              </span>
              <span className={styles.sessionName}>
                {currentSession?.name || t('nav.newSession')}
              </span>
              <span className={`${styles.sessionArrow} ${sessionDropdownOpen ? styles.open : ''}`}>▼</span>
            </button>

            {sessionDropdownOpen && (
              <div className={styles.sessionDropdown}>
                <div className={styles.sessionDropdownHeader}>{t('nav.recentSessions')}</div>
                <div className={styles.sessionList}>
                  {sessions.length === 0 ? (
                    <div className={styles.sessionEmpty}>{t('nav.noSessions')}</div>
                  ) : (
                    sessions.map(session => (
                      <div
                        key={session.id}
                        className={`${styles.sessionItem} ${session.id === currentSessionId ? styles.active : ''}`}
                        onClick={() => {
                          if (editingSessionId !== session.id) {
                            onSessionSelect?.(session.id);
                            setSessionDropdownOpen(false);
                          }
                        }}
                      >
                        <div className={styles.sessionItemInfo}>
                          {editingSessionId === session.id ? (
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
                              <span className={styles.sessionItemName}>
                                {session.name || t('nav.unnamedSession')}
                              </span>
                              <span className={styles.sessionItemMeta}>
                                {t('nav.messageCount', { count: session.messageCount })} · {formatTime(session.updatedAt)}
                              </span>
                            </>
                          )}
                        </div>
                        <div className={styles.sessionItemActions}>
                          <button
                            className={styles.sessionRenameBtn}
                            onClick={(e) => handleStartRename(e, session)}
                            title={t('nav.rename')}
                          >
                            ✏️
                          </button>
                          <button
                            className={styles.sessionDeleteBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              onSessionDelete?.(session.id);
                            }}
                            title={t('nav.deleteSession')}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button className={styles.newSessionButton} onClick={onNewSession} title={t('nav.newSession')}>
            +
          </button>
          </div>
        </div>

        {/* 右侧：连接状态 + 设置按钮 */}
        <div className={styles.contextRight}>
          {connected !== undefined && (
            <span className={`${styles.connectionDot} ${connected ? styles.connected : ''}`} title={connected ? t('nav.connected') : t('nav.disconnected')} />
          )}
          <button className={styles.settingsButton} onClick={onSettingsClick} title={t('nav.settings')}>
            <SettingsIcon />
          </button>
        </div>
      </div>

      {/* 第二行：页面导航行 */}
      <div className={styles.navRow}>
        {/* 左侧：页面 Tab */}
        <div className={styles.navTabs}>
          <button
            className={`${styles.navTab} ${currentPage === 'chat' && !codeViewActive ? styles.active : ''}`}
            onClick={() => onPageChange('chat')}
          >
            <span className={styles.icon}>
              <ChatIcon />
            </span>
            <span>{t('nav.chat')}</span>
          </button>
          <button
            className={`${styles.navTab} ${currentPage === 'blueprint' ? styles.active : ''}`}
            onClick={() => onPageChange('blueprint')}
          >
            <span className={styles.icon}>
              <BlueprintIcon />
            </span>
            <span>{t('nav.blueprint')}</span>
          </button>
          <button
            className={`${styles.navTab} ${currentPage === 'swarm' ? styles.active : ''}`}
            onClick={() => onPageChange('swarm')}
          >
            <span className={styles.icon}>
              <SwarmIcon />
            </span>
            <span>{t('nav.swarm')}</span>
          </button>
        </div>

        {/* 右侧：视图切换按钮（仅 Chat 页面显示） */}
        {currentPage === 'chat' && (
          <div className={styles.viewSwitcher}>
            <button
              className={`${styles.viewButton} ${!codeViewActive ? styles.active : ''}`}
              onClick={() => codeViewActive && onToggleCodeView?.()}
              title="Conversation View"
            >
              <ConversationViewIcon />
            </button>
            <button
              className={`${styles.viewButton} ${codeViewActive ? styles.active : ''}`}
              onClick={() => !codeViewActive && onToggleCodeView?.()}
              title="Code View"
            >
              <CodeViewIcon />
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
