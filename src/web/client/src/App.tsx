import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useMessageHandler } from './hooks/useMessageHandler';
import { useSessionManager } from './hooks/useSessionManager';
import { useChatInput } from './hooks/useChatInput';
import { useArtifacts } from './hooks/useArtifacts';
import { useScheduleArtifacts } from './hooks/useScheduleArtifacts';
import {
  Message,
  WelcomeScreen,
  UserQuestionDialog,
  PermissionDialog,
  SettingsPanel,
  DebugPanel,
} from './components';
import { CrossSessionToast } from './components/CrossSessionToast';
import { UpdateBanner } from './components/UpdateBanner';
import { SlashCommandDialog } from './components/SlashCommandDialog';
import { RewindOption } from './components/RewindMenu';
import { InputArea } from './components/InputArea';
import { ArtifactsPanel } from './components/ArtifactsPanel/ArtifactsPanel';
import { GitPanel } from './components/GitPanel';
import { useProject } from './contexts/ProjectContext';
import { TerminalPanel } from './components/Terminal/TerminalPanel';
import { LogsView } from './components/Terminal/LogsView';
import CodeView from './components/CodeView';
import type { SessionActions } from './types';
import { useLanguage } from './i18n/LanguageContext';
import InitAxonMdDialog from './components/InitAxonMdDialog';
import { useSpeechSynthesis } from './hooks/useSpeechSynthesis';

// 获取 WebSocket URL
function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

interface AppProps {
  onNavigateToBlueprint?: (blueprintId: string) => void;
  onNavigateToSwarm?: (blueprintId?: string) => void;
  onNavigateToCode?: (context?: any) => void;
  codeViewActive?: boolean;
  onToggleCodeView?: () => void;
  showSettings?: boolean;
  onCloseSettings?: () => void;
  showGitPanel?: boolean;
  onToggleGitPanel?: () => void;
  onSessionsChange?: (sessions: any[]) => void;
  onSessionIdChange?: (id: string | null) => void;
  onConnectedChange?: (connected: boolean) => void;
  registerSessionActions?: (actions: SessionActions) => void;
  registerMessaging?: (messaging: { send: (msg: any) => void; addMessageHandler: (handler: (msg: any) => void) => () => void }) => void;
}

function AppContent({
  onNavigateToBlueprint, onNavigateToSwarm, onNavigateToCode,
  codeViewActive,
  onToggleCodeView,
  showSettings, onCloseSettings,
  showGitPanel: showGitPanelProp, onToggleGitPanel,
  onSessionsChange, onSessionIdChange, onConnectedChange,
  registerSessionActions,
  registerMessaging,
}: AppProps) {
  const { t } = useLanguage();
  const { state: projectState, openFolder } = useProject();
  const currentProjectPath = projectState.currentProject?.path;
  const [showInitAxonMd, setShowInitAxonMd] = useState(false);
  // 记录弹框打开时的项目路径，防止切换项目后 confirm 操作跑到错误的项目
  const initAxonMdProjectRef = useRef<string | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showLogsPanel, setShowLogsPanel] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const [isInputVisible, setIsInputVisible] = useState(true);
  // Git 面板状态：优先使用 Root 传入的 prop，否则使用内部 state
  const [showGitPanelLocal, setShowGitPanelLocal] = useState(false);
  const showGitPanel = showGitPanelProp ?? showGitPanelLocal;
  const setShowGitPanel = onToggleGitPanel
    ? (valueOrUpdater: boolean | ((prev: boolean) => boolean)) => {
        // 计算实际值：支持函数式更新器
        const newValue = typeof valueOrUpdater === 'function'
          ? valueOrUpdater(showGitPanel)
          : valueOrUpdater;
        // 只在状态真正变化时调用外部 toggle
        if (newValue !== showGitPanel) {
          onToggleGitPanel();
        }
      }
    : setShowGitPanelLocal;
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const codeViewRef = useRef<CodeViewRef>(null);
  const [pendingCodeRef, setPendingCodeRef] = useState<{ filePath: string; line: number } | null>(null);

  const { connected, sessionId, model, setModel, send, addMessageHandler } = useWebSocket(getWebSocketUrl());

  // 模式预设列表 + 当前活跃预设 ID
  const [modePresets, setModePresets] = useState<Array<{ id: string; name: string; icon: string; permissionMode: string }>>([]);
  const [activePresetId, setActivePresetId] = useState('bypassPermissions');

  // 暴露 send/addMessageHandler 给 Root（供 CustomizePage 等兄弟组件使用）
  useEffect(() => {
    registerMessaging?.({ send, addMessageHandler });
  }, [send, addMessageHandler, registerMessaging]);

  // 项目切换时同步 projectPath 到 WebSocket 后端
  useEffect(() => {
    if (connected) {
      send({ type: 'set_project_path', payload: { projectPath: currentProjectPath || null } });
    }
  }, [currentProjectPath, connected, send]);

  // 连接后加载模式预设列表，监听预设应用确认
  useEffect(() => {
    if (!connected) return;
    const unsub = addMessageHandler((msg: any) => {
      if (msg.type === 'mode_presets_list') {
        setModePresets(msg.payload.presets.map((p: any) => ({
          id: p.id, name: p.name, icon: p.icon, permissionMode: p.permissionMode,
        })));
        if (msg.payload.activeId) {
          setActivePresetId(msg.payload.activeId);
        }
      } else if (msg.type === 'mode_preset_applied') {
        setActivePresetId(msg.payload.id);
      }
    });
    send({ type: 'mode_presets_get' });
    return unsub;
  }, [connected, send, addMessageHandler]);

  // AXON.md 初始化检测：项目切换后检查是否缺少 AXON.md，且 AI 服务可用时才弹框
  useEffect(() => {
    const project = projectState.currentProject;

    // 项目切换时先关闭已打开的弹框，避免 confirm 操作在错误的项目上执行
    setShowInitAxonMd(false);
    initAxonMdProjectRef.current = null;

    // 条件：项目存在 + 没有 AXON.md + 已连接
    if (!project || project.hasAxonMd !== false || !connected) return;

    // 异步检查认证状态，只有 AI 可用时才弹框
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/oauth/status');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.authenticated) {
          initAxonMdProjectRef.current = project.path;
          setShowInitAxonMd(true);
        }
      } catch {
        // 认证检查失败，不弹框
      }
    })();
    return () => { cancelled = true; };
  }, [projectState.currentProject, connected]);

  // 消息处理
  const {
    messages,
    setMessages,
    status,
    setStatus,
    contextUsage,
    compactState,
    rateLimitInfo,
    permissionRequest,
    setPermissionRequest,
    userQuestion,
    setUserQuestion,
    permissionMode,
    setPermissionMode,
    currentMessageRef,
    interruptPendingRef,
    isTranscriptMode,
    setIsTranscriptMode,
    crossSessionNotification,
    dismissCrossSessionNotification,
    slashCommandResult,
    setSlashCommandResult,
  } = useMessageHandler({
    addMessageHandler,
    model,
    send,
    refreshSessions: () => sessionManager.refreshSessions(),
    onNavigateToSwarm,
    sessionId: sessionId ?? null,
  });

  // 会话管理
  const sessionManager = useSessionManager({
    connected,
    send,
    addMessageHandler,
    sessionId: sessionId ?? null,
    model,
    currentProjectPath,
    setMessages,
  });

  // 输入处理
  const chatInput = useChatInput({
    connected,
    send,
    model,
    status,
    setStatus,
    messages,
    setMessages,
    currentMessageRef,
    interruptPendingRef,
    currentProjectPath,
    permissionRequest,
    setPermissionRequest,
    userQuestion,
    setUserQuestion,
    setPermissionMode,
    sessionId: sessionId ?? null,
    openFolder,
  });

  // 产物面板
  const artifactsState = useArtifacts(messages);
  const scheduleState = useScheduleArtifacts(messages);

  // TTS 语音合成（嘴巴）
  const tts = useSpeechSynthesis();

  // 对话模式：自动启用 TTS
  useEffect(() => {
    if (chatInput.conversationMode) {
      tts.setEnabled(true);
    }
  }, [chatInput.conversationMode, tts.setEnabled]);

  // 对话模式：AI 开始说话时暂停麦克风（回声消除）
  useEffect(() => {
    if (!chatInput.conversationMode) return;
    if (tts.isSpeaking) {
      chatInput.pauseMic();
    }
  }, [chatInput.conversationMode, tts.isSpeaking, chatInput.pauseMic]);

  // 对话模式：AI 说完后恢复麦克风
  useEffect(() => {
    if (!chatInput.conversationMode) return;
    tts.onSpeechEnd(() => {
      chatInput.resumeMic();
    });
    return () => { tts.onSpeechEnd(null); };
  }, [chatInput.conversationMode, tts.onSpeechEnd, chatInput.resumeMic]);

  // 监听流式消息事件，喂给 TTS
  useEffect(() => {
    const remove = addMessageHandler((msg: any) => {
      if (msg.type === 'text_delta' && msg.payload?.text) {
        tts.feedText(msg.payload.text);
      } else if (msg.type === 'message_complete') {
        tts.flush();
      }
    });
    return remove;
  }, [addMessageHandler, tts.feedText, tts.flush]);

  // 定时任务产物出现时自动打开面板
  useEffect(() => {
    if (scheduleState.hasNewScheduleArtifact) {
      artifactsState.setIsPanelOpen(true);
      scheduleState.clearHasNew();
    }
  }, [scheduleState.hasNewScheduleArtifact]);

  // 监听滚动位置，判断用户是否在底部附近
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    const THRESHOLD = 80; // 距底部 80px 以内视为"在底部"
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < THRESHOLD;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // 仅在用户处于底部附近时自动滚动
  useEffect(() => {
    if (isNearBottomRef.current && chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // 上报会话数据给 Root
  useEffect(() => {
    onSessionsChange?.(sessionManager.sessions);
  }, [sessionManager.sessions, onSessionsChange]);

  useEffect(() => {
    onSessionIdChange?.(sessionId ?? null);
  }, [sessionId, onSessionIdChange]);

  useEffect(() => {
    onConnectedChange?.(connected);
  }, [connected, onConnectedChange]);

  // 注册会话操作回调给 Root
  useEffect(() => {
    registerSessionActions?.({
      selectSession: sessionManager.handleSessionSelect,
      deleteSession: sessionManager.handleSessionDelete,
      renameSession: sessionManager.handleSessionRename,
      newSession: sessionManager.handleNewSession,
      searchSessions: sessionManager.handleSearchSessions,
      exportSession: sessionManager.handleSessionExport,
      importSession: sessionManager.handleSessionImport,
    });
  }, [sessionManager.handleSessionSelect, sessionManager.handleSessionDelete, sessionManager.handleSessionRename, sessionManager.handleNewSession, sessionManager.handleSearchSessions, sessionManager.handleSessionExport, sessionManager.handleSessionImport, registerSessionActions]);

  // 全局快捷键
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        setShowTerminal(prev => !prev);
      }
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        setIsTranscriptMode(prev => !prev);
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        artifactsState.setIsPanelOpen(prev => !prev);
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
        e.preventDefault();
        onToggleCodeView?.();
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        setShowGitPanel(prev => {
          const newValue = !prev;
          // 如果打开 Git 面板，则关闭 Artifacts 面板（互斥显示）
          if (newValue) {
            artifactsState.setIsPanelOpen(false);
          }
          return newValue;
        });
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [setIsTranscriptMode, artifactsState.setIsPanelOpen, onToggleCodeView]);

  // 处理代码引用跳转：拦截 onNavigateToCode，支持 { filePath, line } 参数
  const handleNavigateToCode = useCallback((context?: any) => {
    if (context?.filePath) {
      // 有文件路径：切换到 CodeView 并记录待打开的文件
      setPendingCodeRef({ filePath: context.filePath, line: context.line || 1 });
      if (!codeViewActive) {
        onToggleCodeView?.();
      } else {
        // 已经在 CodeView 模式，直接打开文件
        codeViewRef.current?.openFileAtLine(context.filePath, context.line || 1);
        setPendingCodeRef(null);
      }
    } else {
      // 无文件路径：直接切换到 CodeView
      onNavigateToCode?.(context);
    }
  }, [codeViewActive, onToggleCodeView, onNavigateToCode]);

  // 消费 pendingCodeRef：当 CodeView 激活后打开文件
  useEffect(() => {
    if (codeViewActive && pendingCodeRef) {
      // 等待 CodeView 挂载完成
      const timer = setTimeout(() => {
        codeViewRef.current?.openFileAtLine(pendingCodeRef.filePath, pendingCodeRef.line);
        setPendingCodeRef(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [codeViewActive, pendingCodeRef]);

  // 对齐官方渲染管线
  const visibleMessages = useMemo(() => {
    let filtered = messages;
    if (!isTranscriptMode) {
      let lastBoundaryIndex = -1;
      for (let i = filtered.length - 1; i >= 0; i--) {
        if (filtered[i].isCompactBoundary) {
          lastBoundaryIndex = i;
          break;
        }
      }
      if (lastBoundaryIndex !== -1) {
        filtered = filtered.slice(lastBoundaryIndex);
      }
    }
    filtered = filtered.filter(msg => {
      if (msg.isVisibleInTranscriptOnly && !isTranscriptMode) return false;
      return true;
    });
    return filtered;
  }, [messages, isTranscriptMode]);

  const hasCompactBoundary = useMemo(() => messages.some(m => m.isCompactBoundary), [messages]);

  // ========================================================================
  // Rewind 功能
  // ========================================================================

  // 获取回滚预览信息
  const getRewindPreview = useCallback((messageId: string) => {
    const messageIndex = messages.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return { filesWillChange: [], messagesWillRemove: 0, insertions: 0, deletions: 0 };
    }

    // 计算将要删除的消息数（包括当前消息及之后的所有消息）
    // 这样"Fork conversation from here"就表示"回到这条消息之前的状态"
    const messagesWillRemove = messages.length - messageIndex;

    // 返回简单的预览信息
    // 文件变化由后端 RewindManager 实时追踪，前端不需要计算
    return {
      filesWillChange: [],
      messagesWillRemove,
      insertions: 0,
      deletions: 0,
    };
  }, [messages]);

  // 执行回滚（通过 WebSocket）
  const handleRewind = useCallback(async (messageId: string, option: RewindOption) => {
    if (!send) {
      throw new Error(t('app.wsNotConnected'));
    }

    console.log(`[App] 发送回滚请求: messageId=${messageId}, option=${option}`);

    // 如果是删除消息的操作，提取被删除消息的文本内容，准备填充到输入框
    let deletedMessageText = '';
    if (option === 'conversation' || option === 'both') {
      const targetMessage = messages.find(m => m.id === messageId);
      if (targetMessage && targetMessage.role === 'user') {
        // 提取用户消息的文本内容
        const textContents = targetMessage.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text);
        deletedMessageText = textContents.join('\n\n');
      }
    }

    // 发送回滚请求
    send({
      type: 'rewind_execute',
      payload: {
        messageId,
        option,
      },
    });

    // 等待回滚完成（监听 rewind_success 消息）
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (!settled) {
          settled = true;
          unsubSuccess();
          unsubError();
          clearTimeout(timeout);
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(t('app.rewindTimeout')));
      }, 30000);

      const successHandler = (data: any) => {
        if (data.type === 'rewind_success') {
          cleanup();
          // 更新消息列表
          if (data.payload?.messages) {
            setMessages(data.payload.messages);
          }
          // 如果有被删除的消息文本，填充到输入框
          if (deletedMessageText && chatInput.setInput) {
            chatInput.setInput(deletedMessageText);
            // 聚焦到输入框
            chatInput.inputRef.current?.focus();
          }
          resolve();
        }
      };

      const errorHandler = (data: any) => {
        // 只匹配与回滚相关的 error（包含 rewind 关键词或通用错误），
        // 避免不相关的工具执行错误误触发回滚失败
        if (data.type === 'error' && data.payload?.source === 'rewind') {
          cleanup();
          reject(new Error(data.payload?.message || t('app.rewindFailed')));
        }
      };

      // 临时添加监听器
      const unsubSuccess = addMessageHandler(successHandler);
      const unsubError = addMessageHandler(errorHandler);
    });
  }, [send, setMessages, addMessageHandler, messages, chatInput]);

  // 是否可以回滚（至少有2条消息）
  const canRewind = messages.length >= 2;

  // ========================================================================

  // CodeView 发送消息处理（构造用户消息并通过 WebSocket 发送）
  const handleCodeViewSendMessage = useCallback((text: string) => {
    if (!text.trim() || !send || !connected) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text: text.trim() }],
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setStatus('thinking');

    send({
      type: 'chat',
      payload: {
        content: text.trim(),
        projectPath: currentProjectPath,
      },
    });
  }, [send, connected, currentProjectPath, setMessages, setStatus]);

  // ========================================================================

  const showSplitLayout = artifactsState.isPanelOpen;

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', flex: 1 }}>
      <UpdateBanner />
      {codeViewActive ? (
        // 代码视图模式
        <CodeView
          ref={codeViewRef}
          messages={messages}
          status={status}
          model={model}
          permissionMode={permissionMode}
          onModelChange={setModel}
          onPermissionModeChange={setPermissionMode}
          onSendMessage={handleCodeViewSendMessage}
          connected={connected}
          currentMessageId={currentMessageRef.current?.id}
          isStreaming={status !== 'idle'}
          projectPath={currentProjectPath || ''}
        />
      ) : (
        // 对话视图模式（原有的全屏聊天界面）
        <div className="main-content" style={{ flex: 1, flexDirection: showSplitLayout ? 'row' : 'column' }}>
          {/* 左侧：聊天 + 输入 + 终端 */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
            <div className="chat-panel" style={{ flex: 1, minHeight: 0 }}>
              <div className={`chat-container ${!isInputVisible ? 'input-hidden' : ''}`} ref={chatContainerRef}>
              {visibleMessages.length === 0 && messages.length === 0 ? (
                <WelcomeScreen
                  onBlueprintCreated={onNavigateToBlueprint}
                  onQuickPrompt={(prompt) => {
                    chatInput.setInput(prompt);
                    setTimeout(() => chatInput.inputRef.current?.focus(), 50);
                  }}
                  onOpenFolder={openFolder}
                />
              ) : (
                <>
                {visibleMessages.map(msg => (
                  <Message
                    key={msg.id}
                    message={msg}
                    onNavigateToBlueprint={onNavigateToBlueprint}
                    onNavigateToSwarm={onNavigateToSwarm}
                    onNavigateToCode={handleNavigateToCode}
                    onDevAction={chatInput.handleDevAction}
                    isStreaming={currentMessageRef.current?.id === msg.id && status !== 'idle'}
                    isTranscriptMode={isTranscriptMode}
                    onRewind={handleRewind}
                    getRewindPreview={getRewindPreview}
                    canRewind={canRewind}
                  />
                ))}
                {/* 上下文压缩进度指示器 — 在聊天区域底部显示醒目的压缩状态 */}
                {compactState.phase === 'compacting' && (
                  <div className="compact-progress-indicator">
                    <div className="compact-progress-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="4 14 10 14 10 20" />
                        <polyline points="20 10 14 10 14 4" />
                        <line x1="14" y1="10" x2="21" y2="3" />
                        <line x1="3" y1="21" x2="10" y2="14" />
                      </svg>
                    </div>
                    <div className="compact-progress-content">
                      <span className="compact-progress-title">{t('app.compacting')}</span>
                      <span className="compact-progress-desc">{t('app.compactingDesc')}</span>
                    </div>
                    <div className="compact-progress-dots">
                      <span className="compact-dot" />
                      <span className="compact-dot" />
                      <span className="compact-dot" />
                    </div>
                  </div>
                )}
              </>
              )}
            </div>

            <InputArea
              input={chatInput.input}
              onInputChange={chatInput.handleInputChange}
              onKeyDown={chatInput.handleKeyDown}
              onPaste={chatInput.handlePaste}
              inputRef={chatInput.inputRef}
              fileInputRef={chatInput.fileInputRef}
              attachments={chatInput.attachments}
              onRemoveAttachment={chatInput.handleRemoveAttachment}
              onFileSelect={chatInput.handleFileSelect}
              showCommandPalette={chatInput.showCommandPalette}
              onCommandSelect={chatInput.handleCommandSelect}
              onCloseCommandPalette={() => chatInput.setShowCommandPalette(false)}
              connected={connected}
              status={status}
              model={model}
              onModelChange={setModel}
              permissionMode={permissionMode}
              activePresetId={activePresetId}
              onPresetChange={chatInput.handlePresetChange}
              onSend={chatInput.handleSend}
              onCancel={chatInput.handleCancel}
              contextUsage={contextUsage}
              compactState={compactState}
              rateLimitInfo={rateLimitInfo}
              hasCompactBoundary={hasCompactBoundary}
              isTranscriptMode={isTranscriptMode}
              onToggleTranscriptMode={() => setIsTranscriptMode(!isTranscriptMode)}
              showTerminal={showTerminal}
              onToggleTerminal={() => setShowTerminal(!showTerminal)}
              onOpenDebugPanel={() => setShowDebugPanel(true)}
              onOpenGitPanel={() => {
                const willOpen = !showGitPanel;
                if (willOpen) {
                  artifactsState.setIsPanelOpen(false);
                  setShowLogsPanel(false);
                }
                setShowGitPanel(() => willOpen);
              }}
              onOpenLogsPanel={() => {
                const willOpenLogs = !showLogsPanel;
                if (willOpenLogs) {
                  artifactsState.setIsPanelOpen(false);
                  if (showGitPanel) {
                    setShowGitPanel(() => false);
                  }
                }
                setShowLogsPanel(willOpenLogs);
              }}
              isPinned={chatInput.isPinned}
              onTogglePin={chatInput.togglePin}
              onVisibilityChange={setIsInputVisible}
              isVoiceSupported={chatInput.isVoiceSupported}
              voiceTranscript={chatInput.voiceTranscript}
              conversationMode={chatInput.conversationMode}
              onToggleConversationMode={chatInput.toggleConversationMode}
              modePresets={modePresets}
            />
          </div>

            <TerminalPanel
              send={send}
              addMessageHandler={addMessageHandler}
              connected={connected}
              visible={showTerminal}
              height={terminalHeight}
              onClose={() => setShowTerminal(false)}
              onHeightChange={setTerminalHeight}
              projectPath={currentProjectPath}
            />
          </div>

          {/* 右侧：产物面板 */}
          {artifactsState.isPanelOpen && (
            <ArtifactsPanel
              groups={artifactsState.groups}
              artifacts={artifactsState.artifacts}
              selectedId={artifactsState.selectedId}
              selectedArtifact={artifactsState.selectedArtifact}
              onSelectArtifact={artifactsState.setSelectedId}
              onClose={() => artifactsState.setIsPanelOpen(false)}
              scheduleArtifacts={scheduleState.scheduleArtifacts}
              selectedScheduleId={scheduleState.selectedScheduleId}
              selectedScheduleArtifact={scheduleState.selectedScheduleArtifact}
              onSelectScheduleArtifact={scheduleState.setSelectedScheduleId}
            />
          )}

          {/* 右侧：Git 面板 */}
          {showGitPanel && (
            <GitPanel
              isOpen={showGitPanel}
              onClose={() => setShowGitPanel(false)}
              send={send}
              addMessageHandler={addMessageHandler}
              projectPath={currentProjectPath}
            />
          )}

          {/* 右侧：日志面板 */}
          {showLogsPanel && (
            <div className="logs-side-panel">
              <div className="logs-side-panel-header">
                <span className="logs-side-panel-title">{t('logs.title')}</span>
                <button className="logs-side-panel-close" onClick={() => setShowLogsPanel(false)} title={t('common.close')}>
                  &#215;
                </button>
              </div>
              <LogsView
                active={true}
                panelVisible={true}
                connected={connected}
                send={send}
                addMessageHandler={addMessageHandler}
              />
            </div>
          )}
        </div>
      )}

      {userQuestion && (
        <UserQuestionDialog question={userQuestion} onAnswer={chatInput.handleAnswerQuestion} />
      )}
      {permissionRequest && (
        <PermissionDialog
          request={permissionRequest}
          onRespond={chatInput.handlePermissionRespond}
          onRespondWithDestination={chatInput.handlePermissionRespondWithDestination}
          showFullSelector={true}
          defaultDestination="session"
        />
      )}
      <SettingsPanel
        isOpen={!!showSettings}
        onClose={() => onCloseSettings?.()}
        model={model}
        onModelChange={setModel}
        onSendMessage={send}
        addMessageHandler={addMessageHandler}
      />
      <DebugPanel
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
        send={send}
        addMessageHandler={addMessageHandler}
      />
      <SlashCommandDialog
        isOpen={!!slashCommandResult}
        onClose={() => setSlashCommandResult(null)}
        result={slashCommandResult}
        onSessionSelect={(sid) => {
          setSlashCommandResult(null);
          sessionManager.handleSessionSelect(sid);
        }}
      />
      {crossSessionNotification && (
        <CrossSessionToast
          notification={crossSessionNotification}
          sessionName={sessionManager.sessions.find(s => s.id === crossSessionNotification.sessionId)?.name}
          onSwitch={sessionManager.handleSessionSelect}
          onDismiss={dismissCrossSessionNotification}
        />
      )}
      <InitAxonMdDialog
        visible={showInitAxonMd}
        projectPath={initAxonMdProjectRef.current || currentProjectPath || ''}
        onConfirm={() => {
          setShowInitAxonMd(false);
          // 只在记录的项目路径与当前项目路径一致时才执行，防止切换项目后误操作
          if (initAxonMdProjectRef.current && initAxonMdProjectRef.current === currentProjectPath) {
            send({ type: 'slash_command', payload: { command: '/init' } });
          }
          initAxonMdProjectRef.current = null;
        }}
        onCancel={() => {
          setShowInitAxonMd(false);
          initAxonMdProjectRef.current = null;
        }}
      />
    </div>
  );
}

// 需要 React 导入用于 useRef
import React from 'react';

function App(props: AppProps) {
  return <AppContent {...props} />;
}

export default App;
