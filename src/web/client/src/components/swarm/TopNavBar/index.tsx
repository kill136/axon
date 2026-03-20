import { useState, useEffect, useRef } from 'react';
import styles from './TopNavBar.module.css';
import ProjectSelector from '../ProjectSelector/ProjectSelector';
import { AuthStatus } from '../../AuthStatus';
import { useLanguage } from '../../../i18n';

// 检测是否在 Electron 环境中运行（preload.cjs 注入了 electronAPI）
const isElectron = typeof (window as any).electronAPI !== 'undefined';
const electronAPI = isElectron ? (window as any).electronAPI as {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
} : null;
// macOS 检测：用于交通灯按钮区域适配
const isMacElectron = isElectron && navigator.platform.toUpperCase().includes('MAC');

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
  currentPage: 'chat' | 'code' | 'swarm' | 'blueprint' | 'customize' | 'apps' | 'activity';
  onPageChange: (page: 'chat' | 'code' | 'swarm' | 'blueprint' | 'customize' | 'apps' | 'activity') => void;
  onSettingsClick?: () => void;
  /** 连接状态 */
  connected?: boolean;
  /** 点击登录按钮 */
  onLoginClick?: () => void;
  /** 认证刷新键（变化时触发刷新） */
  authRefreshKey?: number;
  // 项目相关
  onOpenFolder?: () => void;
  // 应用相关
  apps?: Array<{ id: string; name: string; icon: string; status: 'creating' | 'ready' | 'error'; sessionId: string }>;
  onAppSelect?: (app: any) => void;
  onCreateApp?: () => void;
  // 会话相关
  sessions?: SessionItem[];
  sessionStatusMap?: Map<string, string>;
  currentSessionId?: string | null;
  onSessionSelect?: (id: string) => void;
  onNewSession?: () => void;
  onSessionDelete?: (id: string) => void;
  onSessionRename?: (id: string, name: string) => void;
  // 会话搜索
  onOpenSessionSearch?: () => void;
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

const ToolboxIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="6" width="14" height="8" rx="1" />
    <path d="M5 6V4a3 3 0 016 0v2" />
    <path d="M1 9h14" />
    <rect x="6" y="8" width="4" height="2" rx="0.5" />
  </svg>
);

const AppsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 8 4 8 6 3 10 13 12 8 15 8" />
  </svg>
);

const ConversationViewIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h12M2 8h12M2 13h8" />
  </svg>
);

const FilesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3.5A1.5 1.5 0 013.5 2h3.172a1 1 0 01.707.293L8.5 3.414A1 1 0 009.207 3.5H12.5A1.5 1.5 0 0114 5v7.5a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
  </svg>
);

const GitBranchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="4" r="2" />
    <circle cx="11" cy="4" r="2" />
    <circle cx="5" cy="12" r="2" />
    <path d="M5 6v4M11 6c0 3-2 4-6 6" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="3" />
    <path d="M12 8a4 4 0 00-.5-2l1.5-1-1-1.7-1.8.5a4 4 0 00-1.7-1V1h-2v1.8a4 4 0 00-1.7 1L3 3.3l-1 1.7 1.5 1a4 4 0 000 4l-1.5 1 1 1.7 1.8-.5a4 4 0 001.7 1V15h2v-1.8a4 4 0 001.7-1l1.8.5 1-1.7-1.5-1a4 4 0 00.5-2z" />
  </svg>
);

const MenuIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h12M2 8h12M2 12h12" />
  </svg>
);

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

/**
 * 顶部导航栏组件 - 两行布局
 * 第一行：项目选择器 + 会话选择器 + 连接状态 + 新会话按钮 + 设置按钮
 * 第二行：页面 Tab（Chat/Blueprint/Swarm）+ 视图切换按钮（仅 Chat 页面显示）
 */
export default function TopNavBar({
  currentPage, onPageChange, onSettingsClick,
  connected, onLoginClick, authRefreshKey,
  onOpenFolder,
  apps, onAppSelect, onCreateApp,
  sessions = [], sessionStatusMap, currentSessionId, onSessionSelect, onNewSession,
  onSessionDelete, onSessionRename,
  onOpenSessionSearch,
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
      {/* 第一行：全局上下文行（Electron 模式下充当标题栏，可拖拽） */}
      <div className={`${styles.contextRow} ${isElectron ? styles.electronDragRegion : ''} ${isMacElectron ? styles.electronMacDragRegion : ''}`}>
        {/* 左侧：项目选择器 */}
        <div className={styles.contextLeft}>
          <ProjectSelector
            onOpenFolder={onOpenFolder}
            apps={apps}
            onAppSelect={onAppSelect}
            onCreateApp={onCreateApp}
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
                {/* 顶部新建对话入口 - 让用户在下拉里也能一眼找到 */}
                <div
                  className={styles.newSessionEntry}
                  onClick={() => {
                    onNewSession?.();
                    setSessionDropdownOpen(false);
                  }}
                >
                  <span className={styles.newSessionEntryIcon}>+</span>
                  <span>{t('nav.startNewChat')}</span>
                </div>
                <div className={styles.sessionDropdownHeader}>{t('nav.recentSessions')}</div>
                <div className={styles.sessionList}>
                  {sessions.length === 0 ? (
                    <div className={styles.sessionEmpty}>{t('nav.noSessions')}</div>
                  ) : (
                    sessions.map(session => {
                      const activityStatus = sessionStatusMap?.get(session.id);
                      const needsAttention = activityStatus === 'waiting_input' || activityStatus === 'waiting_permission';
                      const isWorking = activityStatus === 'thinking' || activityStatus === 'streaming' || activityStatus === 'tool_executing';
                      return (
                      <div
                        key={session.id}
                        className={`${styles.sessionItem} ${session.id === currentSessionId ? styles.active : ''} ${needsAttention ? styles.needsAttention : ''}`}
                        onClick={() => {
                          if (editingSessionId !== session.id) {
                            onSessionSelect?.(session.id);
                            setSessionDropdownOpen(false);
                          }
                        }}
                      >
                        {/* 会话状态指示器（借鉴 cmux 通知环设计） */}
                        {activityStatus && session.id !== currentSessionId && (
                          <span
                            className={`${styles.sessionStatusDot} ${needsAttention ? styles.attention : isWorking ? styles.working : ''}`}
                            title={activityStatus === 'waiting_input' ? t('nav.waitingInput') : activityStatus === 'waiting_permission' ? t('nav.waitingPermission') : activityStatus === 'thinking' ? t('nav.thinking') : activityStatus === 'tool_executing' ? t('nav.toolExecuting') : ''}
                          />
                        )}
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
                    ); })
                  )}
                </div>
              </div>
            )}
          </div>
          <button className={styles.newSessionButton} onClick={onNewSession} title={t('nav.newSession')}>
            +
          </button>
          {onOpenSessionSearch && (
            <button className={styles.searchButton} onClick={onOpenSessionSearch} title={`${t('sessionSearch.placeholder')} (Ctrl+K)`}>
              <SearchIcon />
            </button>
          )}
          </div>
        </div>

        {/* 右侧：认证状态 + 连接状态 + 设置按钮 + (Electron) 窗口控制 */}
        <div className={styles.contextRight}>
          <AuthStatus onLoginClick={onLoginClick ?? (() => {})} refreshKey={authRefreshKey} />
          {connected !== undefined && (
            <span className={`${styles.connectionDot} ${connected ? styles.connected : ''}`} title={connected ? t('nav.connected') : t('nav.disconnected')} />
          )}
          <button className={styles.settingsButton} onClick={onSettingsClick} title={t('nav.settings')}>
            <SettingsIcon />
          </button>
          {/* Electron 窗口控制按钮（macOS 用系统交通灯，不需要自定义按钮） */}
          {electronAPI && !isMacElectron && (
            <div className={styles.windowControls}>
              <button className={styles.windowBtn} onClick={() => electronAPI.minimize()} title={t('nav.minimize')}>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
              </button>
              <button className={styles.windowBtn} onClick={() => electronAPI.maximize()} title={t('nav.maximize')}>
                <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
              </button>
              <button className={`${styles.windowBtn} ${styles.windowBtnClose}`} onClick={() => electronAPI.close()} title={t('nav.close')}>
                <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 第二行：页面导航行 */}
      <div className={styles.navRow}>
        {/* 左侧：页面 Tab */}
        <div className={styles.navTabs}>
          <button
            className={`${styles.navTab} ${currentPage === 'chat' ? styles.active : ''}`}
            onClick={() => onPageChange('chat')}
          >
            <span className={styles.icon}>
              <ChatIcon />
            </span>
            <span>{t('nav.chat')}</span>
          </button>
          <button
            className={`${styles.navTab} ${currentPage === 'code' ? styles.active : ''}`}
            onClick={() => onPageChange('code')}
          >
            <span className={styles.icon}>
              <FilesIcon />
            </span>
            <span>{t('nav.code')}</span>
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
          <button
            className={`${styles.navTab} ${currentPage === 'customize' ? styles.active : ''}`}
            onClick={() => onPageChange('customize')}
          >
            <span className={styles.icon}>
              <ToolboxIcon />
            </span>
            <span>{t('nav.customize')}</span>
          </button>
          <button
            className={`${styles.navTab} ${currentPage === 'apps' ? styles.active : ''}`}
            onClick={() => onPageChange('apps')}
          >
            <span className={styles.icon}>
              <AppsIcon />
            </span>
            <span>{t('nav.myApps')}</span>
          </button>
          <button
            className={`${styles.navTab} ${currentPage === 'activity' ? styles.active : ''}`}
            onClick={() => onPageChange('activity')}
          >
            <span className={styles.icon}>
              <ActivityIcon />
            </span>
            <span>{t('nav.activity')}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
