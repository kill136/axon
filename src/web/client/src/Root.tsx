import React, { useState, useCallback, useRef, useEffect } from 'react';
import App from './App';
import SwarmConsole from './pages/SwarmConsole/index.tsx';
import BlueprintPage from './pages/BlueprintPage';
import CustomizePage from './pages/CustomizePage';
import AppsPage from './pages/AppsPage';
import ActivityPage from './pages/ActivityPage';
import TopNavBar from './components/swarm/TopNavBar';
import { SessionSearchModal } from './components/SessionSearchModal/SessionSearchModal';
import { AuthDialog } from './components/AuthDialog';
import { CreateAppDialog } from './components/CreateAppDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupWizard, useSetupWizard } from './components/SetupWizard';
import { ProjectProvider, useProject } from './contexts/ProjectContext';
import { LanguageProvider } from './i18n';
import type { Session, SessionActions } from './types';

type Page = 'chat' | 'code' | 'swarm' | 'blueprint' | 'customize' | 'apps' | 'activity';

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
  const [sessionStatusMap, setSessionStatusMap] = useState<Map<string, string>>(new Map());
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
  const { state: projectState, dispatch: projectDispatch, switchProject, openFolder, removeProject } = useProject();

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

  // AI 帮我做
  const [showCreateApp, setShowCreateApp] = useState(false);

  const handleCreateAppSubmit = useCallback(async (description: string, workingDirectory: string) => {
    setShowCreateApp(false);

    // 1. 切换 ProjectContext 到新工作目录（注册为项目，更新 currentProject）
    //    这确保后续聊天消息中的 projectPath 也指向正确的目录
    const dirName = workingDirectory.split(/[/\\]/).pop() || workingDirectory;
    try {
      await switchProject(
        { id: workingDirectory, name: dirName, path: workingDirectory },
        { source: 'create-app', createSession: false },
      );
    } catch (err) {
      // 目录可能不存在（AI 会创建），手动设置 currentProject 保证后续消息带正确路径
      console.warn('[CreateApp] switchProject 失败，手动设置 currentProject:', err);
      projectDispatch({
        type: 'SET_CURRENT_PROJECT',
        payload: { id: workingDirectory, name: dirName, path: workingDirectory },
      });
    }

    // 2. 注册到 App Manager（启动命令默认 npx serve，用户可后续修改）
    try {
      await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dirName,
          description: description.slice(0, 200),
          directory: workingDirectory,
          startCommand: 'npx serve',
          port: 3000,
        }),
      });
    } catch (err) {
      console.warn('[CreateApp] App 注册失败（非致命）:', err);
    }

    // 3. 通知后端切换项目路径 + 新建会话
    messagingRef.current.send({ type: 'set_project_path', payload: { projectPath: workingDirectory } });
    messagingRef.current.send({ type: 'session_new', payload: { projectPath: workingDirectory } });

    // 4. 切换到聊天页
    setCurrentPage('chat');

    // 5. 稍等一下让会话创建完成，再发送消息
    setTimeout(() => {
      messagingRef.current.send({
        type: 'chat',
        payload: { content: description, projectPath: workingDirectory },
      });
    }, 500);
  }, [switchProject, projectDispatch]);

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
    width: '100%',
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
        onCreateApp={() => setShowCreateApp(true)}
        // 会话
        sessions={sessions}
        sessionStatusMap={sessionStatusMap}
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
              onSessionStatusMapChange={setSessionStatusMap}
              onSessionIdChange={setCurrentSessionId}
              onConnectedChange={setConnected}
              registerSessionActions={handleRegisterSessionActions}
              registerMessaging={handleRegisterMessaging}
              onLoginClick={() => setShowAuthDialog(true)}
              authRefreshKey={authRefreshKey}
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
            <AppsPage />
          </ErrorBoundary>
        </div>
        <div style={pageStyle('activity')}>
          <ErrorBoundary name="Activity">
            <ActivityPage
              onNavigateToSession={(sessionId) => {
                sessionActionsRef.current.selectSession(sessionId);
                setCurrentPage('chat');
              }}
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
      <CreateAppDialog
        isOpen={showCreateApp}
        onClose={() => setShowCreateApp(false)}
        onSubmit={handleCreateAppSubmit}
      />
      {needSetup && (
        <SetupWizard
          onComplete={completeSetup}
          onOpenFolder={openFolder}
          currentProjectName={projectState.currentProject?.name ?? null}
        />
      )}
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
