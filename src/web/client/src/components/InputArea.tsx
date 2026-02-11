/**
 * InputArea 组件
 * 从 App.tsx 提取的输入区域（textarea + 附件预览 + 工具栏）
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SlashCommandPalette } from './SlashCommandPalette';
import { ContextBar, type ContextUsage, type CompactState } from './ContextBar';
import type { Attachment, SlashCommand } from '../types';
import type { Status, PermissionMode } from '../hooks/useMessageHandler';

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

  // 可见性回调
  onVisibilityChange?: (isVisible: boolean) => void;
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
  isPinned,
  onTogglePin,
  onVisibilityChange,
}: InputAreaProps) {
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
            placeholder="输入消息... (/ 显示命令)"
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
              title="切换模型"
            >
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
            <select
              className={`permission-mode-selector mode-${permissionMode}`}
              value={permissionMode}
              onChange={(e) => onPermissionModeChange(e.target.value as PermissionMode)}
              title="权限模式"
            >
              <option value="default">{'🔒 询问'}</option>
              <option value="acceptEdits">{'📝 自动编辑'}</option>
              <option value="bypassPermissions">{'⚡ YOLO'}</option>
              <option value="plan">{'📋 计划'}</option>
            </select>
            <ContextBar usage={contextUsage} compactState={compactState} />
            <button className="attach-btn" onClick={() => fileInputRef.current?.click()}>
              {'📎'}
            </button>
            <button
              className={`pin-toggle-btn ${isPinned ? 'pinned' : ''}`}
              onClick={onTogglePin}
              title={isPinned ? '取消锁定 - 允许自动隐藏输入框' : '锁定输入框 - 防止自动隐藏'}
            >
              {isPinned ? '📌' : '📍'}
            </button>
            <button
              className="debug-trigger-btn"
              onClick={onOpenDebugPanel}
              title="API 探针 - 查看系统提示词和消息体"
            >
              {'🔍'} <span className="debug-trigger-label">{'探针'}</span>
            </button>
            {hasCompactBoundary && (
              <button
                className={`transcript-toggle-btn ${isTranscriptMode ? 'active' : ''}`}
                onClick={onToggleTranscriptMode}
                title={isTranscriptMode ? '切换到精简视图' : '查看完整历史 (Ctrl+O)'}
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
                {'■ 停止'}
              </button>
            )}
            <button
              className="send-btn"
              onClick={onSend}
              disabled={!connected || (!input.trim() && attachments.length === 0)}
            >
              {'发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
