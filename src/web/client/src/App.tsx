import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useMessageHandler } from './hooks/useMessageHandler';
import { useSessionManager } from './hooks/useSessionManager';
import { useChatInput } from './hooks/useChatInput';
import {
  Message,
  WelcomeScreen,
  UserQuestionDialog,
  PermissionDialog,
  SettingsPanel,
  DebugPanel,
} from './components';
import { RewindOption } from './components/RewindMenu';
import { InputArea } from './components/InputArea';
import { useProject } from './contexts/ProjectContext';
import { BlueprintDetailContent } from './components/swarm/BlueprintDetailPanel/BlueprintDetailContent';
import { TerminalPanel } from './components/Terminal/TerminalPanel';
import type { SessionActions } from './types';

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
  showCodePanel?: boolean;
  onToggleCodePanel?: () => void;
  showSettings?: boolean;
  onCloseSettings?: () => void;
  onSessionsChange?: (sessions: any[]) => void;
  onSessionIdChange?: (id: string | null) => void;
  onConnectedChange?: (connected: boolean) => void;
  registerSessionActions?: (actions: SessionActions) => void;
}

function AppContent({
  onNavigateToBlueprint, onNavigateToSwarm, onNavigateToCode,
  showCodePanel,
  showSettings, onCloseSettings,
  onSessionsChange, onSessionIdChange, onConnectedChange,
  registerSessionActions,
}: AppProps) {
  const { state: projectState } = useProject();
  const currentProjectPath = projectState.currentProject?.path;
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(280);
  const [isInputVisible, setIsInputVisible] = useState(true);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  const { connected, sessionId, model, setModel, send, addMessageHandler } = useWebSocket(getWebSocketUrl());

  // 消息处理
  const {
    messages,
    setMessages,
    status,
    setStatus,
    contextUsage,
    compactState,
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
  });

  // 自动滚动到底部
  useEffect(() => {
    if (chatContainerRef.current) {
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
    });
  }, [sessionManager.handleSessionSelect, sessionManager.handleSessionDelete, sessionManager.handleSessionRename, sessionManager.handleNewSession, registerSessionActions]);

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
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [setIsTranscriptMode]);

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
      throw new Error('WebSocket 未连接');
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
      const timeout = setTimeout(() => {
        reject(new Error('回滚超时'));
      }, 30000);

      const successHandler = (data: any) => {
        if (data.type === 'rewind_success') {
          clearTimeout(timeout);
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
        if (data.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(data.payload?.message || '回滚失败'));
        }
      };

      // 临时添加监听器
      addMessageHandler(successHandler);
      addMessageHandler(errorHandler);

      // 清理监听器
      setTimeout(() => {
        // TODO: 实现 removeMessageHandler
      }, 30000);
    });
  }, [send, setMessages, addMessageHandler, messages, chatInput]);

  // 是否可以回滚（至少有2条消息）
  const canRewind = messages.length >= 2;

  // ========================================================================

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', flex: 1 }}>
      <div className="main-content" style={{ flex: 1, ...(showCodePanel ? { flexDirection: 'row' as const } : {}) }}>
        {showCodePanel && (
          <div className="code-panel">
            <BlueprintDetailContent blueprintId="code-browser-standalone" />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <div className={`chat-panel ${showCodePanel ? 'chat-panel-split' : ''}`} style={{ flex: 1, minHeight: 0 }}>
            <div className={`chat-container ${!isInputVisible ? 'input-hidden' : ''}`} ref={chatContainerRef}>
              {visibleMessages.length === 0 && messages.length === 0 ? (
                <WelcomeScreen onBlueprintCreated={onNavigateToBlueprint} />
              ) : (
                visibleMessages.map(msg => (
                  <Message
                    key={msg.id}
                    message={msg}
                    onNavigateToBlueprint={onNavigateToBlueprint}
                    onNavigateToSwarm={onNavigateToSwarm}
                    onNavigateToCode={onNavigateToCode}
                    onDevAction={chatInput.handleDevAction}
                    isStreaming={currentMessageRef.current?.id === msg.id && status !== 'idle'}
                    isTranscriptMode={isTranscriptMode}
                    onRewind={handleRewind}
                    getRewindPreview={getRewindPreview}
                    canRewind={canRewind}
                  />
                ))
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
              onPermissionModeChange={chatInput.handlePermissionModeChange}
              onSend={chatInput.handleSend}
              onCancel={chatInput.handleCancel}
              contextUsage={contextUsage}
              compactState={compactState}
              hasCompactBoundary={hasCompactBoundary}
              isTranscriptMode={isTranscriptMode}
              onToggleTranscriptMode={() => setIsTranscriptMode(!isTranscriptMode)}
              showTerminal={showTerminal}
              onToggleTerminal={() => setShowTerminal(!showTerminal)}
              onOpenDebugPanel={() => setShowDebugPanel(true)}
              isPinned={chatInput.isPinned}
              onTogglePin={chatInput.togglePin}
              onVisibilityChange={setIsInputVisible}
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
      </div>

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
      />
      <DebugPanel
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
        send={send}
        addMessageHandler={addMessageHandler}
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
