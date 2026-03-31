/**
 * InputArea 组件
 * 从 App.tsx 提取的输入区域（textarea + 附件预览 + 工具栏）
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SlashCommandPalette } from './SlashCommandPalette';
import { ContextBar, type ContextUsage, type CompactState } from './ContextBar';
import { ApiUsageBar } from './ApiUsageBar';
import type { Attachment, SlashCommand } from '../types';
import type { Status, PermissionMode, RateLimitInfo } from '../hooks/useMessageHandler';
import { useLanguage } from '../i18n';
import {
  getWebModelOptionsForBackend,
  normalizeWebRuntimeModelForBackend,
  type WebRuntimeBackend,
  type WebRuntimeProvider,
} from '../../../shared/model-catalog';
import {
  getSupportedWebThinkingLevels,
  getResolvedWebThinkingConfig,
  supportsWebThinkingConfig,
  type WebThinkingConfig,
  type WebThinkingLevel,
} from '../../../shared/thinking-config';

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
  onImageEditStrengthChange: (id: string, value: 'low' | 'medium' | 'high') => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;

  // 命令面板
  showCommandPalette: boolean;
  onCommandSelect: (command: SlashCommand) => void;
  onCloseCommandPalette: () => void;

  // 控制
  connected: boolean;
  status: Status;
  model: string;
  availableModels?: string[];
  runtimeProvider: WebRuntimeProvider;
  runtimeBackend: WebRuntimeBackend;
  onModelChange: (model: string) => void;
  thinkingConfig: WebThinkingConfig;
  onThinkingEnabledChange: (enabled: boolean) => void;
  onThinkingLevelChange: (level: WebThinkingLevel) => void;
  permissionMode: PermissionMode;
  activePresetId: string;
  onPresetChange: (presetId: string) => void;
  onSend: () => void;
  onCancel: () => void;

  // 输入框锁定
  isPinned: boolean;
  onTogglePin: () => void;

  // Context
  contextUsage: ContextUsage | null;
  compactState: CompactState;
  rateLimitInfo: RateLimitInfo | null;

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

  // TTS 语音合成（嘴巴）
  ttsEnabled?: boolean;
  isTtsSupported?: boolean;
  onToggleTts?: () => void;

  // 语音对话模式
  conversationMode?: boolean;
  onToggleConversationMode?: () => void;

  // 模式预设列表（用于动态渲染选择器）
  modePresets?: Array<{ id: string; name: string; icon: string; permissionMode: string }>;

  // 消息排队状态（压缩期间）
  isMessageQueued?: boolean;

  // 认证状态
  isAuthenticated?: boolean;
  onLoginClick?: () => void;

  // 新建对话
  onNewSession?: () => void;
  hasMessages?: boolean;
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
  onImageEditStrengthChange,
  onFileSelect,
  showCommandPalette,
  onCommandSelect,
  onCloseCommandPalette,
  connected,
  status,
  model,
  availableModels,
  runtimeProvider,
  runtimeBackend,
  onModelChange,
  thinkingConfig,
  onThinkingEnabledChange,
  onThinkingLevelChange,
  permissionMode,
  activePresetId,
  onPresetChange,
  onSend,
  onCancel,
  contextUsage,
  compactState,
  rateLimitInfo,
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
  ttsEnabled = false,
  isTtsSupported = false,
  onToggleTts,
  conversationMode = false,
  onToggleConversationMode,
  modePresets,
  isMessageQueued = false,
  isAuthenticated = true,
  onLoginClick,
  onNewSession,
  hasMessages = false,
}: InputAreaProps) {
  void runtimeProvider;
  void onToggleVoice;
  void ttsEnabled;
  void isTtsSupported;
  void onToggleTts;

  const { t } = useLanguage();
  const modelOptions = getWebModelOptionsForBackend(runtimeBackend, model, model, availableModels);
  const selectedModel = normalizeWebRuntimeModelForBackend(runtimeBackend, model, model, availableModels);
  const supportsThinking = supportsWebThinkingConfig(runtimeBackend, selectedModel);
  const resolvedThinkingConfig = getResolvedWebThinkingConfig(runtimeBackend, selectedModel, thinkingConfig);
  const supportedThinkingLevels = getSupportedWebThinkingLevels(runtimeBackend, selectedModel);
  const thinkingSelectValue: WebThinkingLevel | 'off' = resolvedThinkingConfig.enabled
    ? resolvedThinkingConfig.level
    : 'off';

  const PLACEHOLDER_KEYS = [
    'input.placeholder',
    'input.placeholder.hint1',
    'input.placeholder.hint2',
    'input.placeholder.hint3',
    'input.placeholder.hint4',
  ];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [isAutoHidden, setIsAutoHidden] = useState(false);
  const [isMorePanelOpen, setIsMorePanelOpen] = useState(false);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInputFocusedRef = useRef(false);
  const mountTimeRef = useRef(Date.now());

  const selectedModePresetLabel = modePresets?.find(p => p.id === activePresetId)?.name
    ?? (activePresetId === 'acceptEdits'
      ? t('input.permAutoEdit')
      : activePresetId === 'bypassPermissions'
        ? t('input.permYolo')
        : activePresetId === 'plan'
          ? t('input.permPlan')
          : activePresetId === 'dontAsk'
            ? t('input.permDontAsk')
            : activePresetId === 'delegate'
              ? t('input.permDelegate')
              : t('input.permAsk'));

  useEffect(() => {
    if (input.trim() || status !== 'idle') return;
    const timer = setInterval(() => {
      setPlaceholderIndex(i => (i + 1) % PLACEHOLDER_KEYS.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [input, status]);

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
    if (isPinned) return;
    if (isMorePanelOpen) return;
    if (isInputFocusedRef.current) return;
    if (status !== 'idle') return;
    if (input.trim()) return;
    if (attachments.length > 0) return;
    if (Date.now() - mountTimeRef.current < 3000) return;

    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!isInputFocusedRef.current && !isPinned && !isMorePanelOpen) {
        setIsAutoHidden(true);
        onVisibilityChange?.(false);
      }
    }, 800);
  }, [attachments.length, clearHideTimer, input, isMorePanelOpen, isPinned, onVisibilityChange, status]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const threshold = 80;
      const windowHeight = window.innerHeight;

      if (windowHeight - e.clientY <= threshold) {
        show();
        return;
      }

      if (!inputAreaRef.current) {
        scheduleHide();
        return;
      }

      const rect = inputAreaRef.current.getBoundingClientRect();
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
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      clearHideTimer();
    };
  }, [clearHideTimer, scheduleHide, show]);

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
  }, [inputRef, scheduleHide, show]);

  useEffect(() => {
    if (status !== 'idle' || input.trim() || attachments.length > 0 || isMorePanelOpen) {
      show();
    }
  }, [attachments.length, input, isMorePanelOpen, show, status]);

  const handleThinkingSelectChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === 'off') {
      if (resolvedThinkingConfig.enabled) {
        onThinkingEnabledChange(false);
      }
      return;
    }

    if (!resolvedThinkingConfig.enabled) {
      onThinkingEnabledChange(true);
    }
    if (resolvedThinkingConfig.level !== value) {
      onThinkingLevelChange(value as WebThinkingLevel);
    }
  }, [onThinkingEnabledChange, onThinkingLevelChange, resolvedThinkingConfig.enabled, resolvedThinkingConfig.level]);

  const toggleMorePanel = useCallback(() => {
    show();
    setIsMorePanelOpen(value => !value);
  }, [show]);

  return (
    <div
      ref={inputAreaRef}
      className={`input-area ${isAutoHidden ? 'auto-hidden' : ''}`}
    >
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
            <div className={`voice-status-bar${conversationMode ? ' conversation-mode' : ''}`}>
              {conversationMode ? (
                <span>
                  🗣️ {t('input.conversationListening')}
                  {voiceTranscript && <em className="voice-transcript-preview"> {voiceTranscript}</em>}
                </span>
              ) : voiceState === 'listening' ? (
                <span>🎤 {t('input.wakeWord')}</span>
              ) : (
                <span>
                  🎤 {t('input.listening')}
                  {voiceTranscript && <em className="voice-transcript-preview"> {voiceTranscript}</em>}
                </span>
              )}
            </div>
          )}
          {isMessageQueued && (
            <div className="queued-message-bar">
              <span>{t('input.messageQueued')}</span>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="attachments-preview attachments-preview--inline">
              {attachments.map(att => (
                <div key={att.id} className="attachment-item">
                  <span className="file-icon">
                    {att.type === 'image' ? '🖼️' : '📎'}
                  </span>
                  <span className="file-name">{att.name}</span>
                  {att.type === 'image' && (
                    <label className="attachment-edit-strength">
                      <span>{t('input.imageEditStrength')}</span>
                      <select
                        aria-label={`${t('input.imageEditStrength')} ${att.name}`}
                        value={att.imageEditStrength || 'low'}
                        onChange={(e) => onImageEditStrengthChange(att.id, e.target.value as 'low' | 'medium' | 'high')}
                      >
                        <option value="low">{t('input.imageEditStrength.low')}</option>
                        <option value="medium">{t('input.imageEditStrength.medium')}</option>
                        <option value="high">{t('input.imageEditStrength.high')}</option>
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="remove-btn"
                    onClick={() => onRemoveAttachment(att.id)}
                  >
                    {'✕'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {showCommandPalette && (
            <SlashCommandPalette
              input={input}
              onSelect={onCommandSelect}
              onClose={onCloseCommandPalette}
            />
          )}
          {!isAuthenticated && connected ? (
            <div
              className="chat-input auth-prompt"
              onClick={onLoginClick}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onLoginClick?.(); }}
            >
              {t('input.loginRequired')}
            </div>
          ) : (
            <textarea
              ref={inputRef}
              className="chat-input"
              rows={1}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={t(PLACEHOLDER_KEYS[placeholderIndex])}
              disabled={!connected}
            />
          )}
        </div>
        <div className="input-footer">
          <div className="input-control-row">
            <div className="input-control-strip" aria-label="input primary controls">
              <button
                type="button"
                className={`attach-btn${attachments.length > 0 ? ' has-attachments' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                title={t('input.attach')}
                aria-label={t('input.attach')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                </svg>
              </button>
              <select
                className="model-selector-compact"
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={status !== 'idle'}
                title={t('input.switchModel')}
                aria-label={t('input.switchModel')}
              >
                {modelOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                className={`thinking-level-selector${thinkingSelectValue === 'off' ? ' thinking-level-selector--off' : ''}`}
                value={thinkingSelectValue}
                onChange={handleThinkingSelectChange}
                disabled={status !== 'idle' || !supportsThinking}
                title={!supportsThinking ? t('input.thinkingUnsupported') : t('input.thinkingLevel')}
                aria-label={t('input.thinkingLevel')}
              >
                <option value="off">{t('input.thinkingDisable')}</option>
                {supportedThinkingLevels.map(level => (
                  <option key={level} value={level}>{t(`input.thinkingLevel.${level}`)}</option>
                ))}
              </select>
              <select
                className={`permission-mode-selector mode-${permissionMode}`}
                value={activePresetId}
                onChange={(e) => onPresetChange(e.target.value)}
                title={t('input.permissionMode')}
                aria-label={t('input.permissionMode')}
              >
                {modePresets && modePresets.length > 0 ? (
                  modePresets.map(p => (
                    <option key={p.id} value={p.id}>{`${p.icon} ${p.name}`}</option>
                  ))
                ) : (
                  <>
                    <option value="default">{`🔒 ${t('input.permAsk')}`}</option>
                    <option value="acceptEdits">{`📝 ${t('input.permAutoEdit')}`}</option>
                    <option value="bypassPermissions">{'⚡ YOLO'}</option>
                    <option value="plan">{`📋 ${t('input.permPlan')}`}</option>
                    <option value="dontAsk">{`🚫 ${t('input.permDontAsk')}`}</option>
                    <option value="delegate">{`🔗 ${t('input.permDelegate')}`}</option>
                  </>
                )}
              </select>
              {permissionMode === 'dontAsk' && (
                <span className="permission-dontask-warning" title="All sensitive tool operations will be automatically rejected">
                  ⚠️
                </span>
              )}
              {isVoiceSupported && onToggleConversationMode && (
                <button
                  type="button"
                  className={`conversation-mode-btn${conversationMode ? ' conversation-active' : ''}`}
                  onClick={onToggleConversationMode}
                  title={conversationMode ? t('input.conversationStop') : t('input.conversationStart')}
                  aria-label={conversationMode ? t('input.conversationStop') : t('input.conversationStart')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    {conversationMode && (
                      <>
                        <circle cx="9" cy="10" r="1" fill="currentColor"/>
                        <circle cx="12" cy="10" r="1" fill="currentColor"/>
                        <circle cx="15" cy="10" r="1" fill="currentColor"/>
                      </>
                    )}
                  </svg>
                </button>
              )}
              <button
                type="button"
                className={`more-btn${isMorePanelOpen ? ' active' : ''}`}
                onClick={toggleMorePanel}
                aria-expanded={isMorePanelOpen}
                aria-label="toggle input more panel"
                title={t('input.more')}
              >
                <span>{t('input.more')}</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m4 6 4 4 4-4"/>
                </svg>
              </button>
              {isMorePanelOpen && (
                <>
                  <span className="input-inline-divider" aria-hidden="true" />
                  {hasMessages && onNewSession && (
                    <button
                      type="button"
                      className="command-tool-btn new-session-drawer-btn"
                      onClick={onNewSession}
                      title={t('nav.startNewChat')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      <span>{t('nav.startNewChat')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`command-tool-btn pin-toggle-btn ${isPinned ? 'pinned' : ''}`}
                    onClick={onTogglePin}
                    title={isPinned ? t('input.pinUnlock') : t('input.pinLock')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 17v5"/>
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>
                    </svg>
                    <span>{isPinned ? t('input.pinUnlockShort') : t('input.pinLockShort')}</span>
                  </button>
                  <button
                    type="button"
                    className="command-tool-btn debug-trigger-btn"
                    onClick={onOpenDebugPanel}
                    title={t('input.debugProbe')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/>
                      <path d="m21 21-4.35-4.35"/>
                    </svg>
                    <span>{t('input.probe')}</span>
                  </button>
                  {onOpenLogsPanel && (
                    <button
                      type="button"
                      className="command-tool-btn logs-trigger-btn"
                      onClick={onOpenLogsPanel}
                      title={t('input.logs')}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                        <polyline points="13 2 13 9 20 9"/>
                        <line x1="8" y1="13" x2="16" y2="13"/>
                        <line x1="8" y1="17" x2="16" y2="17"/>
                      </svg>
                      <span>{t('input.logs')}</span>
                    </button>
                  )}
                  {hasCompactBoundary && (
                    <button
                      type="button"
                      className={`command-tool-btn transcript-toggle-btn ${isTranscriptMode ? 'active' : ''}`}
                      onClick={onToggleTranscriptMode}
                      title={isTranscriptMode ? t('input.transcriptMinimal') : t('input.transcriptFull')}
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/>
                        <path d="M5 4h6v1H5V4zm0 3h6v1H5V7zm0 3h4v1H5v-1z"/>
                      </svg>
                      <span>{t('input.transcriptShort')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`command-tool-btn terminal-toggle-btn ${showTerminal ? 'active' : ''}`}
                    onClick={onToggleTerminal}
                    title={t('input.toggleTerminal')}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2 3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2zm6.5 7H13v1H8.5v-1zM4.146 5.146l2.5 2.5a.5.5 0 0 1 0 .708l-2.5 2.5-.708-.708L5.586 8 3.44 5.854l.707-.708z"/>
                    </svg>
                    <span>{t('input.terminalShort')}</span>
                  </button>
                  <div className="input-inline-meta">
                    <ApiUsageBar info={rateLimitInfo} />
                  </div>
                </>
              )}
            </div>
            <div className="input-footer-actions">
              <ContextBar usage={contextUsage} compactState={compactState} />
              {status !== 'idle' && (
                <button type="button" className="stop-btn" onClick={onCancel}>
                  {`■ ${t('input.stop')}`}
                </button>
              )}
              <button
                type="button"
                className={`send-btn${!isAuthenticated && connected ? ' auth-required' : ''}`}
                onClick={!isAuthenticated && connected ? onLoginClick : onSend}
                disabled={!connected || (isAuthenticated && !input.trim() && attachments.length === 0)}
                title={!isAuthenticated && connected ? t('input.loginRequired') : t('input.send')}
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
    </div>
  );
}
