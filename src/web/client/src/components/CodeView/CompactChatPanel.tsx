import { useState, useRef, useEffect, forwardRef } from 'react';
import { CompactMessage } from './CompactMessage';
import type { ChatMessage } from '../../types';
import { useLanguage } from '../../i18n';
import styles from './CompactChatPanel.module.css';

interface CompactChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  status: 'idle' | 'streaming' | 'thinking';
  model: string;
  onModelChange: (model: string) => void;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;
  connected: boolean;
  isStreaming?: boolean;
  currentMessageId?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement>;
  initialInput?: string;
}

export const CompactChatPanel = forwardRef<HTMLTextAreaElement, CompactChatPanelProps>(
  (
    {
      messages,
      onSend,
      onClose,
      onOpenFile,
      status,
      model,
      onModelChange,
      permissionMode,
      onPermissionModeChange,
      connected,
      isStreaming = false,
      currentMessageId,
      inputRef: externalInputRef,
      initialInput = '',
    },
    ref
  ) => {
    const { t } = useLanguage();
    const [inputText, setInputText] = useState(initialInput);
    const internalInputRef = useRef<HTMLTextAreaElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = externalInputRef || internalInputRef;

    // 同步 initialInput 到 textarea
    useEffect(() => {
      if (initialInput) {
        setInputText(initialInput);
        // 聚焦并移动光标到末尾
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(initialInput.length, initialInput.length);
        }
      }
    }, [initialInput, textareaRef]);

    // 自动滚动到底部
    useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 动态调整 textarea 高度
    const adjustTextareaHeight = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = 'auto';
      const newHeight = Math.min(textarea.scrollHeight, 120);
      textarea.style.height = `${newHeight}px`;
    };

    useEffect(() => {
      adjustTextareaHeight();
    }, [inputText]);

    const handleSend = () => {
      const trimmed = inputText.trim();
      if (!trimmed || !connected || isStreaming) return;

      onSend(trimmed);
      setInputText('');

      // 重置高度
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputText(e.target.value);
    };

    return (
      <div className={styles.panel}>
        {/* 顶部标题栏 */}
        <div className={styles.header}>
          <div className={styles.title}>{t('compactChat.title')}</div>
          <button className={styles.closeBtn} onClick={onClose} title={t('compactChat.collapsePanel')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>

        {/* 消息列表 */}
        <div className={styles.messages}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>{t('compactChat.startConversation')}</div>
          ) : (
            messages.map((message) => (
              <CompactMessage
                key={message.id}
                message={message}
                onOpenFile={onOpenFile}
                isStreaming={isStreaming && message.id === currentMessageId}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 底部输入区域 */}
        <div className={styles.inputArea}>
          {/* 主输入 */}
          <div className={styles.inputRow}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder={connected ? t('compactChat.inputPlaceholder') : t('compactChat.disconnected')}
              value={inputText}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              disabled={!connected || isStreaming}
              rows={1}
            />
            <button
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={!connected || !inputText.trim() || isStreaming}
              title={t('compactChat.send')}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 2l12 6-12 6V9.5l8.5-1.5L2 6.5V2z" />
              </svg>
            </button>
          </div>

          {/* 工具栏 */}
          <div className={styles.toolbar}>
            <div className={styles.toolbarGroup}>
              <label className={styles.toolbarLabel}>{t('compactChat.model')}</label>
              <select
                className={styles.toolbarSelect}
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={!connected || isStreaming}
              >
                <option value="haiku">Haiku</option>
                <option value="sonnet">Sonnet</option>
                <option value="opus">Opus</option>
              </select>
            </div>

            <div className={styles.toolbarGroup}>
              <label className={styles.toolbarLabel}>{t('compactChat.permission')}</label>
              <select
                className={styles.toolbarSelect}
                value={permissionMode}
                onChange={(e) => onPermissionModeChange(e.target.value)}
                disabled={!connected || isStreaming}
              >
                <option value="default">{t('compactChat.permDefault')}</option>
                <option value="bypassPermissions">{t('compactChat.permBypass')}</option>
                <option value="dontAsk">{t('compactChat.permDontAsk')}</option>
              </select>
            </div>

            {/* 状态指示 */}
            <div className={styles.statusIndicator}>
              {status === 'streaming' && (
                <>
                  <div className={styles.statusDot} />
                  <span>{t('compactChat.streaming')}</span>
                </>
              )}
              {status === 'thinking' && (
                <>
                  <div className={`${styles.statusDot} ${styles.thinking}`} />
                  <span>{t('compactChat.thinking')}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
);

CompactChatPanel.displayName = 'CompactChatPanel';
