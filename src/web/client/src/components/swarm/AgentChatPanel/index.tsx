/**
 * AgentChatPanel — 统一 Agent 对话面板
 *
 * 所有三级 Agent (LeadAgent, Worker, E2E) 共用同一个渲染组件，
 * 使用 Planner Agent 的组件（CliToolCall + CliThinkingBlock + MarkdownContent），
 * 确保视觉一致性。
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useLanguage } from '../../../i18n';
import { CliToolCall } from '../../CliToolCall';
import { CliThinkingBlock } from '../../CliThinkingBlock';
import { MarkdownContent } from '../../MarkdownContent';
import type { ToolUse } from '../../../types';
import styles from './AgentChatPanel.module.css';

// ============================================================================
// 类型定义
// ============================================================================

/** 流式内容块（与 WorkerPanel 的定义保持一致） */
export type StreamContentBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input?: any; result?: string; error?: string; status: 'running' | 'completed' | 'error' };

/** 任务流式内容 */
export interface TaskStreamContent {
  content: StreamContentBlock[];
  lastUpdated: string;
  systemPrompt?: string;
  agentType?: 'worker' | 'e2e' | 'reviewer' | 'lead';
}

export interface AgentChatPanelProps {
  /** Agent 类型 */
  agentType: 'lead' | 'worker' | 'e2e';
  /** Agent 显示标签（如 "LeadAgent" 或 "Worker: Fix auth bug"） */
  agentLabel: string;
  /** Agent 状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  /** 使用的模型 */
  model?: string;
  /** 流式内容 */
  stream: TaskStreamContent | null;
  /** 是否可以插嘴 */
  canInterject: boolean;
  /** 插嘴回调 */
  onInterject?: (message: string) => void;
  /** 插嘴反馈状态 */
  interjectStatus?: { success: boolean; message: string } | null;
}

// ============================================================================
// 工具函数
// ============================================================================

/** 将 StreamContentBlock.tool 转换为 CliToolCall 所需的 ToolUse 类型 */
function toToolUse(block: StreamContentBlock & { type: 'tool' }): ToolUse {
  return {
    id: block.id,
    name: block.name,
    input: block.input || {},
    status: block.status,
    result: block.status !== 'running' ? {
      success: block.status === 'completed',
      output: block.result,
      error: block.error,
    } : undefined,
  };
}

/** 检测是否为用户插嘴消息 */
const USER_INTERJECT_PATTERN = /^[\s\n]*💬\s*\[用户插嘴\]\s*/;

function isUserInterjectMessage(text: string): boolean {
  return USER_INTERJECT_PATTERN.test(text);
}

function extractInterjectContent(text: string): string {
  return text.replace(USER_INTERJECT_PATTERN, '').trim();
}

/** 过滤掉冗余的日志消息 */
const LOG_PATTERN = /^\[[\w-]+\]\s*(执行工具|Starting|Checking|Running|Found|Using|Tool)/;

// ============================================================================
// AgentChatPanel 组件
// ============================================================================

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  agentType,
  agentLabel,
  status,
  model,
  stream,
  canInterject,
  onInterject,
  interjectStatus,
}) => {
  const { t } = useLanguage();
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [interjectInput, setInterjectInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  // 过滤后的内容块
  const filteredBlocks = useMemo(() => {
    if (!stream?.content) return [];
    return stream.content.filter(block => {
      if (block.type === 'tool' || block.type === 'thinking') return true;
      if (block.type === 'text') {
        const text = block.text.trim();
        if (!text) return false;
        if (LOG_PATTERN.test(text)) return false;
        return true;
      }
      return true;
    });
  }, [stream?.content]);

  const totalMessageCount = filteredBlocks.length;

  // 监听滚动位置，判断用户是否在底部附近
  useEffect(() => {
    const container = chatAreaRef.current;
    if (!container) return;
    const THRESHOLD = 80;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < THRESHOLD;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // 仅在用户处于底部附近时自动滚动
  useEffect(() => {
    if (isNearBottomRef.current && chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [filteredBlocks.length, stream?.lastUpdated]);

  // 插嘴提交
  const handleInterjectSubmit = useCallback(() => {
    if (!interjectInput.trim() || !onInterject) return;
    setIsSending(true);
    onInterject(interjectInput.trim());
    setInterjectInput('');
    setTimeout(() => setIsSending(false), 500);
  }, [interjectInput, onInterject]);

  const handleInterjectKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInterjectSubmit();
    }
  }, [handleInterjectSubmit]);

  // Agent 类型显示
  const agentTypeLabel = agentType === 'lead' ? 'LeadAgent' :
                          agentType === 'e2e' ? 'E2E Test' : 'Worker';

  // 渲染单个内容块
  const renderContentBlock = (block: StreamContentBlock, index: number) => {
    switch (block.type) {
      case 'thinking': {
        // 判断是否为最后一个 thinking 块（正在流式传输时显示 spinner）
        const isLastThinking = status === 'running' && (
          index === filteredBlocks.length - 1 ||
          filteredBlocks.slice(index + 1).every(b =>
            b.type === 'thinking' || (b.type === 'text' && !b.text.trim())
          )
        );
        return (
          <div key={`thinking-${index}`} className={styles.contentBlock}>
            <CliThinkingBlock
              content={block.text}
              isThinking={isLastThinking}
            />
          </div>
        );
      }

      case 'text': {
        // 检测用户插嘴消息
        if (isUserInterjectMessage(block.text)) {
          const content = extractInterjectContent(block.text);
          return (
            <div key={`interject-${index}`} className={styles.userInterjectMessage}>
              <div className={styles.userInterjectLabel}>{t('agentChat.you')}</div>
              <div>{content}</div>
            </div>
          );
        }
        return (
          <div key={`text-${index}`} className={styles.contentBlock}>
            <MarkdownContent content={block.text} />
          </div>
        );
      }

      case 'tool':
        return (
          <div key={block.id || `tool-${index}`} className={styles.contentBlock}>
            <CliToolCall toolUse={toToolUse(block)} />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className={styles.agentChatPanel}>
      {/* Agent Header */}
      <div className={styles.agentHeader}>
        <span className={`${styles.agentTypeBadge} ${styles[agentType]}`}>
          {agentType === 'lead' ? '🧠' : agentType === 'e2e' ? '🧪' : '⚙️'}
          {agentTypeLabel}
        </span>
        <span className={styles.agentLabel}>{agentLabel}</span>
        <span className={`${styles.statusDot} ${styles[status]}`} />
        {model && <span className={styles.modelTag}>{model}</span>}
        {stream?.systemPrompt && (
          <button
            className={styles.systemPromptToggle}
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
            title={t('agentChat.viewSystemPrompt')}
          >
            📜 {showSystemPrompt ? t('agentChat.hide') : t('agentChat.instructions')}
          </button>
        )}
      </div>

      {/* System Prompt */}
      {showSystemPrompt && stream?.systemPrompt && (
        <div className={styles.systemPromptContainer}>
          <div className={styles.systemPromptHeader}>
            <span className={styles.systemPromptTitle}>
              {agentTypeLabel} System Prompt
            </span>
            <button
              className={styles.systemPromptClose}
              onClick={() => setShowSystemPrompt(false)}
            >
              ✕
            </button>
          </div>
          <pre className={styles.systemPromptContent}>
            {stream.systemPrompt}
          </pre>
        </div>
      )}

      {/* Chat Header */}
      <div className={styles.chatHeader}>
        <span>📜 {t('agentChat.chatLog')}</span>
        <span className={styles.chatLogCount}>{t('agentChat.messageCount', { count: totalMessageCount })}</span>
        {status === 'running' && (
          <span className={styles.chatLiveIndicator}>● {t('agentChat.live')}</span>
        )}
      </div>

      {/* Chat Area */}
      <div className={styles.chatArea} ref={chatAreaRef}>
        {filteredBlocks.map(renderContentBlock)}

        {/* Empty State */}
        {totalMessageCount === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>
              {status === 'pending' ? '⏳' : status === 'running' ? '🔄' : '📝'}
            </div>
            <div className={styles.emptyStateText}>
              {status === 'pending' ? t('agentChat.waitingToStart') :
               status === 'running' ? t('agentChat.starting', { agent: agentTypeLabel }) :
               t('agentChat.noChatLog')}
            </div>
          </div>
        )}
      </div>

      {/* Interject Input */}
      {canInterject && onInterject && (
        <div className={styles.interjectArea}>
          <div className={styles.interjectHeader}>
            <span>💬</span>
            <span>{t('agentChat.sendInstruction', { agent: agentTypeLabel })}</span>
          </div>
          <div className={styles.interjectInputWrapper}>
            <textarea
              className={styles.interjectInput}
              value={interjectInput}
              onChange={(e) => setInterjectInput(e.target.value)}
              onKeyDown={handleInterjectKeyDown}
              placeholder={t('agentChat.interjectPlaceholder')}
              disabled={isSending}
              rows={2}
            />
            <button
              className={styles.interjectButton}
              onClick={handleInterjectSubmit}
              disabled={!interjectInput.trim() || isSending}
            >
              {isSending ? '...' : t('agentChat.send')}
            </button>
          </div>
          {interjectStatus ? (
            <div className={`${styles.interjectFeedback} ${interjectStatus.success ? styles.success : styles.error}`}>
              {interjectStatus.success ? '✅' : '❌'} {interjectStatus.message}
            </div>
          ) : (
            <div className={styles.interjectHint}>
              {t('agentChat.interjectHint', { agent: agentTypeLabel })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentChatPanel;
