import { useState, useRef, useEffect, useCallback } from 'react';
import { BlueprintDetailContent } from '../../components/swarm/BlueprintDetailPanel/BlueprintDetailContent';
import { useProject } from '../../contexts/ProjectContext';
import { useWebSocket } from '../../hooks/useWebSocket';
import type { ChatMessage, ChatContent } from '../../types';
import styles from './CodeBrowserPage.module.css';
import { useLanguage } from '../../i18n';

/** Tab 类型定义 */
interface Tab {
  id: string;
  type: 'welcome' | 'chat' | 'file';
  title: string;
  icon: string;
  closable: boolean;
}

interface CodeBrowserPageProps {
  /** 从聊天页传递的上下文 */
  context?: any;
  /** 返回聊天页的回调 */
  onNavigateToChat?: () => void;
}

/**
 * 代码浏览器页面 - 独立Tab
 *
 * 功能：
 * - 显示当前项目的文件树
 * - 支持代码浏览和编辑
 * - 提供AI增强的代码分析
 * - Tab式聊天入口（类似VSCode）
 */
export default function CodeBrowserPage({ context, onNavigateToChat }: CodeBrowserPageProps) {
  const { t } = useLanguage();
  const { state: projectState } = useProject();
  const currentProject = projectState.currentProject;

  // Tab 状态管理
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'welcome', type: 'welcome', title: t('codeBrowser.welcome'), icon: '🏠', closable: false }
  ]);
  const [activeTabId, setActiveTabId] = useState('welcome');

  // 聊天状态
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const chatMessagesRef = useRef<HTMLDivElement>(null);

  // WebSocket 连接
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
  const { connected, send, addMessageHandler, model } = useWebSocket(wsUrl);

  // 处理 WebSocket 消息
  useEffect(() => {
    const unsubscribe = addMessageHandler((msg: any) => {
      if (msg.type === 'assistant_message') {
        const content: ChatContent[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          timestamp: Date.now(),
          content,
          model: msg.model || model,
        };

        setChatMessages(prev => [...prev, assistantMessage]);
        setIsSending(false);
      } else if (msg.type === 'content_block_delta') {
        setChatMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.role === 'assistant') {
            const newContent = [...lastMsg.content];
            const lastContent = newContent[newContent.length - 1];
            if (lastContent?.type === 'text') {
              lastContent.text += msg.delta?.text || '';
            }
            return [...prev.slice(0, -1), { ...lastMsg, content: newContent }];
          }
          return prev;
        });
      } else if (msg.type === 'message_stop' || msg.type === 'error') {
        setIsSending(false);
      }
    });

    return unsubscribe;
  }, [addMessageHandler, model]);

  // 自动滚动到底部
  useEffect(() => {
    if (chatMessagesRef.current) {
      chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // 发送消息
  const handleSendMessage = useCallback(() => {
    if (!chatInput.trim() || !connected || isSending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      timestamp: Date.now(),
      content: [{ type: 'text', text: chatInput.trim() }],
    };

    setChatMessages(prev => [...prev, userMessage]);

    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      timestamp: Date.now(),
      content: [{ type: 'text', text: '' }],
      model,
    };
    setChatMessages(prev => [...prev, assistantMessage]);

    send({
      type: 'user_message',
      content: chatInput.trim(),
      model,
    });

    setChatInput('');
    setIsSending(true);
  }, [chatInput, connected, isSending, send, model]);

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 添加新的聊天 Tab
  const addChatTab = useCallback(() => {
    const existingChatTab = tabs.find(t => t.type === 'chat');
    if (existingChatTab) {
      // 如果已存在聊天 Tab，直接切换到它
      setActiveTabId(existingChatTab.id);
      return;
    }

    const newTab: Tab = {
      id: `chat-${Date.now()}`,
      type: 'chat',
      title: t('codeBrowser.aiChat'),
      icon: '💬',
      closable: true
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs]);

  // 关闭 Tab
  const closeTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab?.closable) return;

    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);

    // 如果关闭的是当前激活的 Tab，切换到前一个
    if (activeTabId === tabId) {
      const currentIndex = tabs.findIndex(t => t.id === tabId);
      const newActiveTab = newTabs[Math.max(0, currentIndex - 1)];
      setActiveTabId(newActiveTab?.id || 'welcome');
    }
  }, [tabs, activeTabId]);

  // 切换回欢迎视图
  const switchToWelcome = useCallback(() => {
    setActiveTabId('welcome');
  }, []);

  // 渲染 Tab 内容
  const renderTabContent = () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (!activeTab) return null;

    switch (activeTab.type) {
      case 'welcome':
        return (
          <BlueprintDetailContent
            blueprintId="code-browser-standalone"
            onNavigateToSwarm={undefined}
            onDeleted={undefined}
            onRefresh={undefined}
            onAddChatTab={addChatTab}
            onNavigateToChat={onNavigateToChat}
          />
        );

      case 'chat':
        return (
          <div className={styles.chatTabContent}>
            <div className={styles.chatTabHeader}>
              <button className={styles.backToCodeButton} onClick={switchToWelcome} title={t('codeBrowser.backToCode')}>
                {t('codeBrowser.codeShort')}
              </button>
              <span className={styles.chatTabTitle}>{t('codeBrowser.aiAssistant')}</span>
              <span className={styles.chatTabStatus}>
                {connected ? t('codeBrowser.connected') : t('codeBrowser.disconnected')}
              </span>
            </div>

            <div className={styles.chatTabMessages} ref={chatMessagesRef}>
              {chatMessages.length === 0 ? (
                <div className={styles.chatTabWelcome}>
                  <div className={styles.welcomeIcon}>🤖</div>
                  <h3>{t('codeBrowser.aiCodeAssistant')}</h3>
                  <p>{t('codeBrowser.askAnything')}</p>
                  <div className={styles.exampleQuestions}>
                    <button onClick={() => setChatInput(t('codeBrowser.exampleAnalyzeInput'))}>
                      {t('codeBrowser.exampleAnalyze')}
                    </button>
                    <button onClick={() => setChatInput(t('codeBrowser.exampleOptimizeInput'))}>
                      {t('codeBrowser.exampleOptimize')}
                    </button>
                    <button onClick={() => setChatInput(t('codeBrowser.exampleExplainInput'))}>
                      {t('codeBrowser.exampleExplain')}
                    </button>
                  </div>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`${styles.chatTabMessage} ${styles[msg.role]}`}
                  >
                    <div className={styles.messageAvatar}>
                      {msg.role === 'user' ? '👤' : '🤖'}
                    </div>
                    <div className={styles.messageBody}>
                      <div className={styles.messageRole}>
                        {msg.role === 'user' ? t('codeBrowser.you') : 'Claude'}
                      </div>
                      <div className={styles.messageText}>
                        {msg.content.map((c, i) => (
                          c.type === 'text' ? <span key={i}>{c.text}</span> : null
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              )}
              {isSending && (
                <div className={styles.typingIndicator}>
                  <span></span><span></span><span></span>
                </div>
              )}
            </div>

            <div className={styles.chatTabInputArea}>
              <textarea
                ref={chatInputRef}
                className={styles.chatTabInput}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('codeBrowser.inputPlaceholder')}
                rows={3}
                disabled={!connected || isSending}
              />
              <button
                className={styles.chatTabSendButton}
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || !connected || isSending}
              >
                {t('codeBrowser.send')}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // 如果没有选择项目，显示提示
  if (!currentProject) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyIcon}>📁</div>
        <h2 className={styles.emptyTitle}>{t('codeBrowser.selectProject')}</h2>
        <p className={styles.emptyDescription}>
          {t('codeBrowser.selectProjectHint')}
        </p>
        {onNavigateToChat && (
          <button className={styles.goToChatButton} onClick={onNavigateToChat}>
            💬 {t('codeBrowser.goToChat')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.codeBrowserPage}>
      {renderTabContent()}
    </div>
  );
}
