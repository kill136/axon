import React, { useState, useCallback, useRef, useEffect } from 'react';
import App from './App';
import SwarmConsole from './pages/SwarmConsole/index.tsx';
import BlueprintPage from './pages/BlueprintPage';
import CustomizePage from './pages/CustomizePage';
import AppsPage, { type UserApp } from './pages/AppsPage';
import TopNavBar from './components/swarm/TopNavBar';
import { SessionSearchModal } from './components/SessionSearchModal/SessionSearchModal';
import { AuthDialog } from './components/AuthDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupWizard, useSetupWizard } from './components/SetupWizard';
import { ProjectProvider, useProject } from './contexts/ProjectContext';
import { LanguageProvider } from './i18n';
import { CreateAppDialog } from './components/CreateAppDialog';
import type { Session, SessionActions } from './types';

type Page = 'chat' | 'code' | 'swarm' | 'blueprint' | 'customize' | 'apps';

/**
 * RootContent - 在 ProjectProvider 内部使用 ProjectContext
 */
function RootContent() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const [swarmBlueprintId, setSwarmBlueprintId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const [showSessionSearch, setShowSessionSearch] = useState(false);
  const { needSetup, completeSetup } = useSetupWizard();

  // 来自 App 的会话数据（通过回调上报）
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // 来自 App 的会话操作（通过 ref 注册）
  const sessionActionsRef = useRef<SessionActions>({
    selectSession: () => {},
    deleteSession: () => {},
    renameSession: () => {},
    newSession: () => {},
    searchSessions: () => {},
    exportSession: () => {},
    importSession: () => {},
  });

  // 来自 App 的消息通信（供 CustomizePage 等兄弟组件使用）
  const messagingRef = useRef<{
    send: (msg: any) => void;
    addMessageHandler: (handler: (msg: any) => void) => () => void;
  }>({
    send: () => {},
    addMessageHandler: () => () => {},
  });

  const handleRegisterMessaging = useCallback((messaging: typeof messagingRef.current) => {
    messagingRef.current = messaging;
  }, []);

  // 项目上下文
  const { state: projectState, switchProject, openFolder, removeProject } = useProject();
  // ===== AI 应用管理 =====
  const [apps, setApps] = useState<UserApp[]>([]);
  const [showCreateApp, setShowCreateApp] = useState(false);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch('/api/apps');
      if (res.ok) {
        const data = await res.json();
        if (data.apps) setApps(data.apps);
      }
    } catch { /* 忽略 */ }
  }, []);

  // 初始化加载 + 定时刷新
  useEffect(() => {
    fetchApps();
    const interval = setInterval(fetchApps, 10000);
    return () => clearInterval(interval);
  }, [fetchApps]);

  // 监听 ws 消息中的 app_created 事件来刷新，并自动切换项目
  useEffect(() => {
    const unsub = messagingRef.current.addMessageHandler((msg: any) => {
      if (msg.type === 'app_created') {
        fetchApps();
        // 自动切换 ProjectContext 到新应用的工作目录
        const appData = msg.payload?.app;
        if (appData?.workingDirectory) {
          const newProject = {
            id: appData.workingDirectory,
            name: appData.name || 'New App',
            path: appData.workingDirectory,
            icon: appData.icon || '✨',
          };
          switchProject(newProject).catch(() => {
            // 切换失败不阻塞流程
          });
        }
      }
    });
    return unsub;
  }, [fetchApps, switchProject]);

  // 创建应用回调
  const handleCreateApp = useCallback(() => {
    setShowCreateApp(true);
  }, []);

  // 创建应用提交
  const handleCreateAppSubmit = useCallback((description: string, workingDirectory: string) => {
    setShowCreateApp(false);
    messagingRef.current.send({
      type: 'app_create',
      payload: { name: description.slice(0, 30), description, workingDirectory },
    });
    // 切换到 chat 页面看创建过程
    setCurrentPage('chat');
  }, []);

  // 选择应用 — 切换到该应用的 session
  const handleAppSelect = useCallback((app: any) => {
    if (app.sessionId) {
      sessionActionsRef.current.selectSession(app.sessionId);
    }
    setCurrentPage('chat');
  }, []);

  // 简化的 AppItem 类型给 ProjectSelector 用
  const appItems = apps.map(a => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    status: a.status,
    sessionId: a.sessionId,
  }));

  const handlePageChange = (page: Page) => {
    setCurrentPage(page);
  };

  const codeViewActive = currentPage === 'code';

  const toggleCodeView = useCallback(() => {
    setCurrentPage(prev => prev === 'code' ? 'chat' : 'code');
  }, []);

  const toggleGitPanel = useCallback(() => {
    setShowGitPanel(prev => !prev);
  }, []);

  const openSessionSearch = useCallback(() => {
    setShowSessionSearch(true);
  }, []);

  // Ctrl+K 快捷键打开会话搜索
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSessionSearch(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const navigateToBlueprintPage = (blueprintId?: string) => {
    if (blueprintId) setSelectedBlueprintId(blueprintId);
    setCurrentPage('blueprint');
  };

  const navigateToSwarmPage = (blueprintId?: string) => {
    if (blueprintId) setSwarmBlueprintId(blueprintId);
    setCurrentPage('swarm');
  };

  const navigateToCodePage = useCallback(() => {
    setCurrentPage('code');
  }, []);

  // 项目操作（ProjectSelector 回调 -> ProjectContext）
  const handleProjectChange = useCallback(async (project: any) => {
    try {
      await switchProject(project);
    } catch (err) {
      console.error('项目切换失败:', err);
    }
  }, [switchProject]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await openFolder();
    } catch (err) {
      console.error('打开文件夹失败:', err);
    }
  }, [openFolder]);

  const handleProjectRemove = useCallback(async (project: any) => {
    try {
      await removeProject(project.id);
    } catch (err) {
      console.error('移除项目失败:', err);
    }
  }, [removeProject]);

  // 会话操作回调注册（App 调用此函数注册实际的操作实现）
  const handleRegisterSessionActions = useCallback((actions: SessionActions) => {
    sessionActionsRef.current = actions;
  }, []);

  // 页面容器样式：活跃页面显示，非活跃页面隐藏但保持挂载（保留 WebSocket 连接和状态）
  // App 容器在 chat 和 code 页面都需要显示（CodeView 是 App 的子组件，共享 WebSocket 和消息状态）
  const pageStyle = (page: Page): React.CSSProperties => ({
    display: (page === 'chat' ? (currentPage === 'chat' || currentPage === 'code') : currentPage === page) ? 'flex' : 'none',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden' }}>
      <TopNavBar
        currentPage={currentPage}
        onPageChange={handlePageChange}
        connected={connected}
        onLoginClick={() => setShowAuthDialog(true)}
        onSettingsClick={() => setShowSettings(true)}
        authRefreshKey={authRefreshKey}
        // 项目
        onOpenFolder={handleOpenFolder}
        // 应用
        apps={appItems}
        onAppSelect={handleAppSelect}
        onCreateApp={handleCreateApp}
        // 会话
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={(id) => sessionActionsRef.current.selectSession(id)}
        onNewSession={() => sessionActionsRef.current.newSession()}
        onSessionDelete={(id) => sessionActionsRef.current.deleteSession(id)}
        onSessionRename={(id, name) => sessionActionsRef.current.renameSession(id, name)}
        // 会话搜索
        onOpenSessionSearch={openSessionSearch}
      />
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex' }}>
        {/* 所有页面始终挂载，通过 display:none 隐藏非活跃页面，避免切换时丢失状态和 WebSocket 连接 */}
        <div style={pageStyle('chat')}>
          <ErrorBoundary name="Chat">
            <App
              onNavigateToBlueprint={navigateToBlueprintPage}
              onNavigateToSwarm={navigateToSwarmPage}
              onNavigateToCode={navigateToCodePage}
              codeViewActive={codeViewActive}
              onToggleCodeView={toggleCodeView}
              showSettings={showSettings}
              onCloseSettings={() => setShowSettings(false)}
              showGitPanel={showGitPanel}
              onToggleGitPanel={toggleGitPanel}
              onSessionsChange={setSessions}
              onSessionIdChange={setCurrentSessionId}
              onConnectedChange={setConnected}
              registerSessionActions={handleRegisterSessionActions}
              registerMessaging={handleRegisterMessaging}
              apps={appItems}
              onAppSelect={handleAppSelect}
              onCreateApp={handleCreateApp}
            />
          </ErrorBoundary>
        </div>
        <div style={pageStyle('swarm')}>
          <ErrorBoundary name="Swarm Console">
            <SwarmConsole initialBlueprintId={swarmBlueprintId} />
          </ErrorBoundary>
        </div>
        <div style={pageStyle('blueprint')}>
          <ErrorBoundary name="Blueprint">
            <BlueprintPage
              initialBlueprintId={selectedBlueprintId}
              onNavigateToSwarm={navigateToSwarmPage}
            />
          </ErrorBoundary>
        </div>
        <div style={pageStyle('customize')}>
          <ErrorBoundary name="Customize">
            <CustomizePage
              onNavigateBack={() => setCurrentPage('chat')}
              onSendMessage={(msg: any) => messagingRef.current.send(msg)}
              addMessageHandler={(handler: (msg: any) => void) => messagingRef.current.addMessageHandler(handler)}
              sessionId={currentSessionId ?? undefined}
            />
          </ErrorBoundary>
        </div>
        <div style={pageStyle('apps')}>
          <ErrorBoundary name="Apps">
            <AppsPage
              apps={apps}
              onRefresh={fetchApps}
              onAppSelect={handleAppSelect}
              onCreateApp={handleCreateApp}
            />
          </ErrorBoundary>
        </div>
      </div>
      <SessionSearchModal
        isOpen={showSessionSearch}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={(id) => sessionActionsRef.current.selectSession(id)}
        onSessionDelete={(id) => sessionActionsRef.current.deleteSession(id)}
        onSessionRename={(id, name) => sessionActionsRef.current.renameSession(id, name)}
        onNewSession={() => sessionActionsRef.current.newSession()}
        onClose={() => setShowSessionSearch(false)}
        onSearch={(q) => sessionActionsRef.current.searchSessions(q)}
        onSessionExport={(id, fmt) => sessionActionsRef.current.exportSession(id, fmt)}
        onSessionImport={(content) => sessionActionsRef.current.importSession(content)}
      />
      <AuthDialog
        isOpen={showAuthDialog}
        onClose={() => setShowAuthDialog(false)}
        onSuccess={() => setAuthRefreshKey(prev => prev + 1)}
      />
      {needSetup && <SetupWizard onComplete={completeSetup} />}
      <CreateAppDialog
        isOpen={showCreateApp}
        onClose={() => setShowCreateApp(false)}
        onSubmit={handleCreateAppSubmit}
      />
    </div>
  );
}

/**
 * Root - 顶层组件，提供 ProjectProvider
 */
export default function Root() {
  return (
    <ErrorBoundary name="Application">
      <LanguageProvider>
        <ProjectProvider>
          <RootContent />
        </ProjectProvider>
      </LanguageProvider>
    </ErrorBoundary>
  );
}
