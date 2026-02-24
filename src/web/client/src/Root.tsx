import React, { useState, useCallback, useRef, useEffect } from 'react';
import App from './App';
import SwarmConsole from './pages/SwarmConsole/index.tsx';
import BlueprintPage from './pages/BlueprintPage';
import SchedulePage from './pages/SchedulePage';
import TopNavBar from './components/swarm/TopNavBar';
import SessionSidebar from './components/SessionSidebar/SessionSidebar';
import { AuthDialog } from './components/AuthDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProjectProvider, useProject } from './contexts/ProjectContext';
import { LanguageProvider } from './i18n';
import type { Session, SessionActions } from './types';

type Page = 'chat' | 'swarm' | 'blueprint' | 'schedule';

/**
 * RootContent - 在 ProjectProvider 内部使用 ProjectContext
 */
function RootContent() {
  const [currentPage, setCurrentPage] = useState<Page>('chat');
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(null);
  const [swarmBlueprintId, setSwarmBlueprintId] = useState<string | null>(null);
  const [codeViewActive, setCodeViewActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authRefreshKey, setAuthRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
  });

  // 项目上下文
  const { state: projectState, switchProject, openFolder, removeProject } = useProject();

  const handlePageChange = (page: Page) => {
    setCurrentPage(page);
    // 切换到非 chat 页面时自动关闭代码视图
    if (page !== 'chat' && codeViewActive) {
      setCodeViewActive(false);
    }
  };

  const toggleCodeView = useCallback(() => {
    if (currentPage !== 'chat') {
      setCurrentPage('chat');
    }
    setCodeViewActive(prev => !prev);
  }, [currentPage, codeViewActive]);

  const toggleGitPanel = useCallback(() => {
    setShowGitPanel(prev => !prev);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Ctrl+B 快捷键切换侧边栏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
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
    setCurrentPage('chat');
    setCodeViewActive(true);
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
  const pageStyle = (page: Page): React.CSSProperties => ({
    display: currentPage === page ? 'flex' : 'none',
    flex: 1,
    overflow: 'hidden',
    minHeight: 0,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden' }}>
      <TopNavBar
        currentPage={currentPage}
        onPageChange={handlePageChange}
        codeViewActive={codeViewActive}
        onToggleCodeView={toggleCodeView}
        gitPanelActive={showGitPanel}
        onToggleGitPanel={toggleGitPanel}
        connected={connected}
        onLoginClick={() => setShowAuthDialog(true)}
        onSettingsClick={() => setShowSettings(true)}
        authRefreshKey={authRefreshKey}
        // 项目
        currentProject={projectState.currentProject}
        onProjectChange={handleProjectChange}
        onOpenFolder={handleOpenFolder}
        onProjectRemove={handleProjectRemove}
        // 会话
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={(id) => sessionActionsRef.current.selectSession(id)}
        onNewSession={() => sessionActionsRef.current.newSession()}
        onSessionDelete={(id) => sessionActionsRef.current.deleteSession(id)}
        onSessionRename={(id, name) => sessionActionsRef.current.renameSession(id, name)}
        // 侧边栏
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
      />
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, display: 'flex' }}>
        {/* 会话侧边栏 */}
        <SessionSidebar
          isOpen={sidebarOpen}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={(id) => sessionActionsRef.current.selectSession(id)}
          onSessionDelete={(id) => sessionActionsRef.current.deleteSession(id)}
          onSessionRename={(id, name) => sessionActionsRef.current.renameSession(id, name)}
          onNewSession={() => sessionActionsRef.current.newSession()}
          onClose={() => setSidebarOpen(false)}
        />
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
        <div style={pageStyle('schedule')}>
          <ErrorBoundary name="Schedule">
            <SchedulePage />
          </ErrorBoundary>
        </div>
      </div>
      <AuthDialog
        isOpen={showAuthDialog}
        onClose={() => setShowAuthDialog(false)}
        onSuccess={() => setAuthRefreshKey(prev => prev + 1)}
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
