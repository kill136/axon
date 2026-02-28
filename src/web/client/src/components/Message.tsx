import { useState, useRef, useEffect, useMemo } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { CliToolCall } from './CliToolCall';
import { CliThinkingBlock } from './CliThinkingBlock';
import { BlueprintSummaryCard } from './BlueprintSummaryCard';
import { ImpactAnalysisCard } from './continuous/ImpactAnalysisCard';
import { DevProgressBar } from './continuous/DevProgressBar';
import { RegressionResultCard } from './continuous/RegressionResultCard';
import { CycleReviewCard } from './continuous/CycleReviewCard';
import { NotebookOutputRenderer } from './NotebookOutputRenderer';
import { RewindMenu, RewindOption } from './RewindMenu';
import { SkillMessage, isSkillMessage } from './SkillMessage';
import { useLanguage } from '../i18n';
import { coordinatorApi } from '../api/blueprint';
import type { ChatMessage, ChatContent, ToolUse, NotebookOutputData } from '../types';

/** 用户消息折叠阈值：超过此行数自动折叠 */
const USER_MESSAGE_COLLAPSE_LINES = 10;
/** 折叠时显示的最大高度（px） */
const USER_MESSAGE_COLLAPSE_HEIGHT = 200;

interface MessageProps {
  message: ChatMessage;
  onNavigateToBlueprint?: (blueprintId: string) => void;
  onNavigateToSwarm?: () => void;  // 跳转到蜂群页面的回调
  onNavigateToCode?: (context?: any) => void;  // 跳转到代码页面的回调
  onDevAction?: (action: string, data?: any) => void; // 通用开发动作回调
  /** 消息是否正在流式传输中 */
  isStreaming?: boolean;
  /** 对齐官方 transcript 模式 */
  isTranscriptMode?: boolean;
  /** 回滚功能回调 */
  onRewind?: (messageId: string, option: RewindOption) => Promise<void>;
  /** 获取回滚预览信息 */
  getRewindPreview?: (messageId: string) => {
    filesWillChange: string[];
    messagesWillRemove: number;
    insertions: number;
    deletions: number;
  };
  /** 是否可以回滚 */
  canRewind?: boolean;
}

export function Message({
  message,
  onNavigateToBlueprint,
  onNavigateToSwarm,
  onNavigateToCode,
  onDevAction,
  isStreaming = false,
  isTranscriptMode = false,
  onRewind,
  getRewindPreview,
  canRewind = false,
}: MessageProps) {
  const { role, content } = message;
  const messageRef = useRef<HTMLDivElement>(null);
  const userContentRef = useRef<HTMLDivElement>(null);
  const [showRewindMenu, setShowRewindMenu] = useState(false);
  const [rewindMenuPosition, setRewindMenuPosition] = useState({ x: 0, y: 0 });
  const [copyButtonText, setCopyButtonText] = useState('📋');
  const [isUserMessageExpanded, setIsUserMessageExpanded] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const { t } = useLanguage();

  // 获取内容数组
  const contentArray = Array.isArray(content) ? content : [];

  // 判断用户消息是否需要折叠
  const shouldCollapseUserMessage = useMemo(() => {
    if (role !== 'user') return false;
    const textContent = contentArray
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    const lineCount = textContent.split('\n').length;
    return lineCount > USER_MESSAGE_COLLAPSE_LINES || textContent.length > 600;
  }, [role, contentArray]);

  const isUserMessageCollapsed = shouldCollapseUserMessage && !isUserMessageExpanded;

  // 处理回滚按钮点击
  const handleRewindClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!getRewindPreview || !message.id) return;

    const buttonRect = (e.target as HTMLElement).getBoundingClientRect();
    setRewindMenuPosition({
      x: buttonRect.left,
      y: buttonRect.bottom + 4,
    });
    setShowRewindMenu(true);
  };

  // 处理回滚选项选择
  const handleRewindSelect = async (option: RewindOption) => {
    if (option === 'cancel' || !message.id || !onRewind) {
      setShowRewindMenu(false);
      return;
    }

    try {
      await onRewind(message.id, option);
      setShowRewindMenu(false);
    } catch (error) {
      console.error('[Message] 回滚失败:', error);
      alert(t('message.rewindFailed', { error: error instanceof Error ? error.message : String(error) }));
    }
  };

  // 获取预览信息
  const rewindPreview = message.id && getRewindPreview
    ? getRewindPreview(message.id)
    : { filesWillChange: [], messagesWillRemove: 0, insertions: 0, deletions: 0 };

  // 提取消息的文本内容
  const extractMessageText = (): string => {
    const texts: string[] = [];
    for (const item of contentArray) {
      if (item.type === 'text' && item.text) {
        texts.push(item.text);
      } else if (item.type === 'thinking' && item.text) {
        texts.push(`${t('message.thinking')}\n${item.text}`);
      }
    }
    return texts.join('\n\n');
  };

  // TTS 朗读处理
  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.speechSynthesis) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    const rawText = extractMessageText();
    if (!rawText) return;
    // 简单去除常见 markdown 标记
    const text = rawText
      .replace(/```[\s\S]*?```/g, '')        // 代码块
      .replace(/`[^`]*`/g, '')               // 行内代码
      .replace(/\*\*([^*]+)\*\*/g, '$1')     // 粗体
      .replace(/\*([^*]+)\*/g, '$1')         // 斜体
      .replace(/^#{1,6}\s+/gm, '')           // 标题符号
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接 → 链接文字
      .trim();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    const voices = window.speechSynthesis.getVoices();
    const zhVoice = voices.find(v => v.lang.includes('zh'));
    if (zhVoice) utterance.voice = zhVoice;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  // 组件卸载时停止播放
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  // 复制消息内容
  const handleCopyMessage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = extractMessageText();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopyButtonText('✓');
      setTimeout(() => {
        setCopyButtonText('📋');
      }, 2000);
    } catch (error) {
      console.error('[Message] 复制失败:', error);
      setCopyButtonText('✗');
      setTimeout(() => {
        setCopyButtonText('📋');
      }, 2000);
    }
  };

  const renderContent = (item: ChatContent, index: number) => {
    if (item.type === 'text') {
      // 检查是否是 Skill 消息
      if (isSkillMessage(item.text)) {
        return <SkillMessage key={index} text={item.text} />;
      }
      return <MarkdownContent key={index} content={item.text} isUserMessage={role === 'user'} />;
    }
    if (item.type === 'image') {
      const imgSrc = item.source?.type === 'base64'
        ? `data:${item.source.media_type};base64,${item.source.data}`
        : item.url;
      return (
        <div key={index} className="image-container">
          <img
            src={imgSrc}
            alt={item.fileName || t('message.uploadedImage')}
            className="message-image"
          />
          {item.fileName && (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
              {item.fileName}
            </div>
          )}
        </div>
      );
    }
    if (item.type === 'tool_use') {
      return <CliToolCall key={index} toolUse={item as ToolUse} />;
    }
    if (item.type === 'thinking') {
      // 判断思考块是否正在进行中
      // 如果消息正在流式传输，且这是最后一个 thinking 块，或者后面只有空的 text 块
      const isLastThinking = isStreaming && (
        index === contentArray.length - 1 ||
        contentArray.slice(index + 1).every(c => c.type === 'thinking' || (c.type === 'text' && !c.text.trim()))
      );
      return (
        <CliThinkingBlock
          key={index}
          content={item.text}
          isThinking={isLastThinking}
        />
      );
    }

    if (item.type === 'blueprint') {
      return (
        <BlueprintSummaryCard
          key={index}
          content={{
            blueprintId: item.blueprintId,
            name: item.name,
            moduleCount: item.moduleCount,
            processCount: item.processCount,
            nfrCount: item.nfrCount
          }}
          onViewDetails={(blueprintId) => {
            console.log('[Blueprint] 查看完整蓝图:', blueprintId);
            onNavigateToBlueprint?.(blueprintId);
          }}
          onStartExecution={async (blueprintId) => {
            console.log('[Blueprint] 启动执行:', blueprintId);
            try {
              // 启动/恢复执行（会自动初始化Queen并重置中断任务）
              console.log('[Blueprint] 正在启动执行...');
              await coordinatorApi.resume(blueprintId);

              // 跳转到蜂群页面
              console.log('[Blueprint] 跳转到蜂群页面');
              onNavigateToSwarm?.();
            } catch (error) {
              // 启动失败，直接抛出错误，不做降级处理
              console.error('[Blueprint] 启动执行失败:', error);
              throw error;
            }
          }}
          onOpenInCodeTab={onNavigateToCode ? (blueprintId) => {
            console.log('[Blueprint] 在代码Tab打开:', blueprintId);
            onNavigateToCode({ blueprintId });
          } : undefined}
        />
      );
    }
    if (item.type === 'impact_analysis') {
      return (
        <ImpactAnalysisCard
          key={index}
          data={item.data}
          onApprove={() => onDevAction?.('approve')}
          onReject={() => onDevAction?.('reject')} // reject 可以对应 pause 或 rollback
        />
      );
    }
    if (item.type === 'dev_progress') {
      return (
        <DevProgressBar
          key={index}
          data={item.data}
          onPause={() => onDevAction?.('pause')}
          onResume={() => onDevAction?.('resume')}
          onCancel={() => onDevAction?.('cancel')}
        />
      );
    }
    if (item.type === 'regression_result') {
      return (
        <RegressionResultCard
          key={index}
          data={item.data}
          onRollback={() => onDevAction?.('rollback')}
        />
      );
    }
    if (item.type === 'cycle_review') {
      return (
        <CycleReviewCard
          key={index}
          data={item.data}
          onRollback={(checkpointId) => onDevAction?.('rollback', { checkpointId })}
        />
      );
    }
    if (item.type === 'notebook_output') {
      return (
        <NotebookOutputRenderer
          key={index}
          data={item.data as NotebookOutputData}
        />
      );
    }
    if (item.type === 'design_image') {
      return (
        <div key={index} className="design-image-container" style={{
          margin: '12px 0',
          borderRadius: '8px',
          overflow: 'hidden',
          border: '1px solid var(--border-color, #333)',
          backgroundColor: 'var(--bg-secondary, #1a1a2e)',
        }}>
          <div style={{
            padding: '8px 12px',
            fontSize: '13px',
            color: 'var(--text-muted, #888)',
            borderBottom: '1px solid var(--border-color, #333)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span style={{ fontSize: '16px' }}>🎨</span>
            <span>{item.title || 'Generated Image'}</span>
            <span style={{
              marginLeft: 'auto',
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: 'var(--bg-tertiary, #252540)',
            }}>
              {item.style}
            </span>
          </div>
          <div style={{ padding: '8px' }}>
            <img
              src={item.imageUrl}
              alt={t('message.designImage', { name: item.projectName })}
              style={{
                width: '100%',
                maxHeight: '600px',
                objectFit: 'contain',
                borderRadius: '4px',
              }}
            />
          </div>
          {item.generatedText && (
            <div style={{
              padding: '8px 12px',
              fontSize: '12px',
              color: 'var(--text-secondary, #aaa)',
              borderTop: '1px solid var(--border-color, #333)',
              lineHeight: '1.5',
            }}>
              {item.generatedText}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  // 对齐官方 Hh4 组件：渲染 compact_boundary 分隔线
  // 官方 CLI: "✻ Conversation compacted (ctrl+o for history)"
  if (message.isCompactBoundary) {
    return (
      <div className="compact-boundary">
        <div className="compact-boundary__line" />
        <span className="compact-boundary__label">
          ✻ {t('message.compactBoundary')}
          {!isTranscriptMode && <span className="compact-boundary__hint"> {t('message.compactBoundaryHint')}</span>}
        </span>
        <div className="compact-boundary__line" />
      </div>
    );
  }

  // 对齐官方 Mh4 组件：渲染 compact summary（仅在 transcript 模式下可见）
  if (message.isCompactSummary) {
    const summaryText = contentArray.find(c => c.type === 'text')?.text || '';
    return (
      <div className="compact-summary">
        <div className="compact-summary__header">
          <span className="compact-summary__icon">✻</span>
          <span className="compact-summary__title">{t('message.compactSummary')}</span>
          {!isTranscriptMode && (
            <span className="compact-summary__hint"> {t('message.compactSummaryHint')}</span>
          )}
        </div>
        {isTranscriptMode && summaryText && (
          <div className="compact-summary__content">
            <MarkdownContent content={summaryText} />
          </div>
        )}
      </div>
    );
  }

  // 是否显示回滚按钮（只对用户消息显示，且需要有回滚功能）
  const showRewindButton = role === 'user' && canRewind && onRewind && getRewindPreview;

  return (
    <>
      <div
        ref={messageRef}
        className={`message ${role}`}
      >
        <div className="message-main">
          <div className="message-content-wrapper">
            <div className="message-header">
              <span className="message-role">{role === 'user' ? t('message.role.user') : t('message.role.assistant')}</span>
              {message.model && <span>({message.model})</span>}
            </div>
            {isUserMessageCollapsed ? (
              <div className="user-message-collapsed" ref={userContentRef} style={{ maxHeight: USER_MESSAGE_COLLAPSE_HEIGHT }}>
                {Array.isArray(content)
                  ? content.map(renderContent)
                  : <MarkdownContent content={content as unknown as string} isUserMessage={role === 'user'} />
                }
                <div className="user-message-fade" />
              </div>
            ) : (
              Array.isArray(content)
                ? content.map(renderContent)
                : <MarkdownContent content={content as unknown as string} isUserMessage={role === 'user'} />
            )}
            {shouldCollapseUserMessage && (
              <button
                className="user-message-toggle"
                onClick={() => setIsUserMessageExpanded(!isUserMessageExpanded)}
              >
                {isUserMessageExpanded ? t('message.showLess') : t('message.showMore')}
              </button>
            )}
          </div>

          {/* 右侧按钮区域 - 用 CSS hover 控制显隐，避免鼠标移向按钮时消失 */}
          <div className="message-actions-sidebar">
            {/* 回滚按钮 */}
            {showRewindButton && (
              <button
                className="message-action-button message-rewind-button"
                onClick={handleRewindClick}
                title={t('message.rewindTooltip')}
              >
                ↻
              </button>
            )}
            {/* TTS 播放按钮 - 仅 assistant 消息显示 */}
            {role === 'assistant' && (
              <button
                className={`message-action-button message-speak-button${isSpeaking ? ' speaking' : ''}`}
                onClick={handleSpeak}
                title={isSpeaking ? t('message.speakStop') : t('message.speakPlay')}
              >
                {isSpeaking ? '■' : '▶'}
              </button>
            )}
            {/* 复制按钮 */}
            <button
              className="message-action-button message-copy-button"
              onClick={handleCopyMessage}
              title={t('message.copyTooltip')}
            >
              {copyButtonText}
            </button>
          </div>
        </div>
      </div>

      {/* 回滚菜单 */}
      {showRewindMenu && (
        <RewindMenu
          visible={showRewindMenu}
          position={rewindMenuPosition}
          preview={rewindPreview}
          onSelect={handleRewindSelect}
          onCancel={() => setShowRewindMenu(false)}
        />
      )}
    </>
  );
}
