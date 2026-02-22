/**
 * InputArea 组件
 * 从 App.tsx 提取的输入区域（textarea + 附件预览 + 工具栏）
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SlashCommandPalette } from './SlashCommandPalette';
import { ContextBar, type ContextUsage, type CompactState } from './ContextBar';
import type { Attachment, SlashCommand } from '../types';
import type { Status, PermissionMode } from '../hooks/useMessageHandler';
import { useLanguage } from '../i18n';

interface InputAreaProps {
  // 输入状态
  input: string;
  onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPaste: (e: React.ClipboardEvent) => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;

  // 附件
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // 命令面板
  showCommandPalette: boolean;
  onCommandSelect: (command: SlashCommand) => void;
  onCloseCommandPalette: () => void;

  // 控制
  connected: boolean;
  status: Status;
  model: string;
  onModelChange: (model: string) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onSend: () => void;
  onCancel: () => void;

  // 输入框锁定
  isPinned: boolean;
  onTogglePin: () => void;

  // Context
  contextUsage: ContextUsage | null;
  compactState: CompactState;

  // Transcript 模式
  hasCompactBoundary: boolean;
  isTranscriptMode: boolean;
  onToggleTranscriptMode: () => void;

  // 终端
  showTerminal: boolean;
  onToggleTerminal: () => void;

  // Debug
  onOpenDebugPanel: () => void;

  // Git
  onOpenGitPanel?: () => void;

  // Logs
  onOpenLogsPanel?: () => void;

  // 可见性回调
  onVisibilityChange?: (isVisible: boolean) => void;

  // 语音识别
  voiceState?: 'idle' | 'listening' | 'activated';
  isVoiceSupported?: boolean;
  voiceTranscript?: string;
  onToggleVoice?: () => void;
}

export function InputArea({
  input,
  onInputChange,
  onKeyDown,
  onPaste,
  inputRef,
  fileInputRef,
  attachments,
  onRemoveAttachment,
  onFileSelect,
  showCommandPalette,
  onCommandSelect,
  onCloseCommandPalette,
  connected,
  status,
  model,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  onSend,
  onCancel,
  contextUsage,
  compactState,
  hasCompactBoundary,
  isTranscriptMode,
  onToggleTranscriptMode,
  showTerminal,
  onToggleTerminal,
  onOpenDebugPanel,
  onOpenGitPanel,
  onOpenLogsPanel,
  isPinned,
  onTogglePin,
  onVisibilityChange,
  voiceState = 'idle',
  isVoiceSupported = false,
  voiceTranscript = '',
  onToggleVoice,
}: InputAreaProps) {
  const { t } = useLanguage();
  const [isAutoHidden, setIsAutoHidden] = useState(false);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInputFocusedRef = useRef(false);
  // 初始加载后有一个短暂的宽限期，不立即隐藏
  const mountTimeRef = useRef(Date.now());

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearHideTimer();
    setIsAutoHidden(false);
    onVisibilityChange?.(true);
  }, [clearHideTimer, onVisibilityChange]);

  const scheduleHide = useCallback(() => {
    // 以下情况不隐藏
    if (isPinned) return;                    // 输入框被锁定
    if (isInputFocusedRef.current) return;  // 输入框有焦点
    if (status !== 'idle') return;           // AI 正在生成
    if (input.trim()) return;                // 输入框有内容
    if (attachments.length > 0) return;      // 有附件
    if (Date.now() - mountTimeRef.current < 3000) return; // 初始宽限期

    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!isInputFocusedRef.current && !isPinned) {
        setIsAutoHidden(true);
        onVisibilityChange?.(false);
      }
    }, 800);
  }, [clearHideTimer, status, input, attachments.length, isPinned, onVisibilityChange]);

  // 鼠标位置检测：靠近窗口底部时显示
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 80; // 距离底部 80px 以内触发显示
      const windowHeight = window.innerHeight;

      if (windowHeight - e.clientY <= threshold) {
        show();
      } else if (inputAreaRef.current) {
        const rect = inputAreaRef.current.getBoundingClientRect();
        // 鼠标在输入区域上方 20px 范围内也保持显示
        if (
          e.clientY >= rect.top - 20 &&
          e.clientY <= rect.bottom &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right
        ) {
          show();
        } else {
          scheduleHide();
        }
      } else {
        scheduleHide();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      clearHideTimer();
    };
  }, [show, scheduleHide, clearHideTimer]);

  // 监听输入框焦点
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const handleFocus = () => {
      isInputFocusedRef.current = true;
      show();
    };
    const handleBlur = () => {
      isInputFocusedRef.current = false;
      scheduleHide();
    };

    textarea.addEventListener('focus', handleFocus);
    textarea.addEventListener('blur', handleBlur);
    return () => {
      textarea.removeEventListener('focus', handleFocus);
      textarea.removeEventListener('blur', handleBlur);
    };
  }, [inputRef, show, scheduleHide]);

  // 当 AI 正在生成或输入框有内容时，保持显示
  useEffect(() => {
    if (status !== 'idle' || input.trim() || attachments.length > 0) {
      show();
    }
  }, [status, input, attachments.length, show]);

  return (
    <div
      ref={inputAreaRef}
      className={`input-area ${isAutoHidden ? 'auto-hidden' : ''}`}
    >
      {attachments.length > 0 && (
        <div className="attachments-preview">
          {attachments.map(att => (
            <div key={att.id} className="attachment-item">
              <span className="file-icon">
                {att.type === 'image' ? '🖼️' : '📎'}
              </span>
              <span className="file-name">{att.name}</span>
              <button className="remove-btn" onClick={() => onRemoveAttachment(att.id)}>
                {'✕'}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-container">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden-file-input"
          multiple
          onChange={onFileSelect}
        />
        <div className="input-wrapper">
          {voiceState !== 'idle' && (
            <div className="voice-status-bar">
              {voiceState === 'listening' ? (
                <span>🎤 等待唤醒词 &ldquo;Claude&rdquo;...</span>
              ) : (
                <span>
                  🎤 正在听...
                  {voiceTranscript && <em className="voice-transcript-preview"> {voiceTranscript}</em>}
                </span>
              )}
            </div>
          )}
          {showCommandPalette && (
            <SlashCommandPalette
              input={input}
              onSelect={onCommandSelect}
              onClose={onCloseCommandPalette}
            />
          )}
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={t('input.placeholder')}
            disabled={!connected}
          />
        </div>
        <div className="input-toolbar">
          <div className="input-toolbar-left">
            <select
              className="model-selector-compact"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={status !== 'idle'}
              title={t('input.switchModel')}
            >
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
            <select
              className={`permission-mode-selector mode-${permissionMode}`}
              value={permissionMode}
              onChange={(e) => onPermissionModeChange(e.target.value as PermissionMode)}
              title={t('input.permissionMode')}
            >
              <option value="default">{`🔒 ${t('input.permAsk')}`}</option>
              <option value="acceptEdits">{`📝 ${t('input.permAutoEdit')}`}</option>
              <option value="bypassPermissions">{'⚡ YOLO'}</option>
              <option value="plan">{`📋 ${t('input.permPlan')}`}</option>
            </select>
            <ContextBar usage={contextUsage} compactState={compactState} />
            <span className="toolbar-divider" />
            <button className="attach-btn" onClick={() => fileInputRef.current?.click()} title={t('input.attach')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>
            {isVoiceSupported && onToggleVoice && (
              <button
                className={`voice-btn${voiceState === 'listening' ? ' voice-listening' : voiceState === 'activated' ? ' voice-activated' : ''}`}
                onClick={onToggleVoice}
                title={voiceState === 'idle' ? '开启语音识别' : voiceState === 'listening' ? '正在监听（点击关闭）' : '正在录入（点击关闭）'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="8" y1="22" x2="16" y2="22"/>
                </svg>
              </button>
            )}
            <button
              className={`pin-toggle-btn ${isPinned ? 'pinned' : ''}`}
              onClick={onTogglePin}
              title={isPinned ? t('input.pinUnlock') : t('input.pinLock')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 17v5"/>
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
              </svg>
            </button>
            <span className="toolbar-divider" />
            <button
              className="debug-trigger-btn"
              onClick={onOpenDebugPanel}
              title={t('input.debugProbe')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
            {onOpenGitPanel && (
              <button
                className="git-trigger-btn"
                onClick={onOpenGitPanel}
                title="Git (Ctrl+Shift+G)"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
              </button>
            )}
            {onOpenLogsPanel && (
              <button
                className="logs-trigger-btn"
                onClick={onOpenLogsPanel}
                title="Logs"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                  <polyline points="13 2 13 9 20 9"/>
                  <line x1="8" y1="13" x2="16" y2="13"/>
                  <line x1="8" y1="17" x2="16" y2="17"/>
                </svg>
              </button>
            )}
            {hasCompactBoundary && (
              <button
                className={`transcript-toggle-btn ${isTranscriptMode ? 'active' : ''}`}
                onClick={onToggleTranscriptMode}
                title={isTranscriptMode ? t('input.transcriptMinimal') : t('input.transcriptFull')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/>
                  <path d="M5 4h6v1H5V4zm0 3h6v1H5V7zm0 3h4v1H5v-1z"/>
                </svg>
              </button>
            )}
            <button
              className={`terminal-toggle-btn ${showTerminal ? 'active' : ''}`}
              onClick={onToggleTerminal}
              title="Toggle Terminal (Ctrl+`)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2zm6.5 7H13v1H8.5v-1zM4.146 5.146l2.5 2.5a.5.5 0 0 1 0 .708l-2.5 2.5-.708-.708L5.586 8 3.44 5.854l.707-.708z"/>
              </svg>
            </button>
          </div>
          <div className="input-toolbar-right">
            {status !== 'idle' && (
              <button className="stop-btn" onClick={onCancel}>
                {`■ ${t('input.stop')}`}
              </button>
            )}
            <button
              className="send-btn"
              onClick={onSend}
              disabled={!connected || (!input.trim() && attachments.length === 0)}
              title={t('input.send')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5"/>
                <path d="M5 12l7-7 7 7"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
