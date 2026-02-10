import { MarkdownContent } from './MarkdownContent';
import { CliToolCall } from './CliToolCall';
import { CliThinkingBlock } from './CliThinkingBlock';
import { BlueprintSummaryCard } from './BlueprintSummaryCard';
import { ImpactAnalysisCard } from './continuous/ImpactAnalysisCard';
import { DevProgressBar } from './continuous/DevProgressBar';
import { RegressionResultCard } from './continuous/RegressionResultCard';
import { CycleReviewCard } from './continuous/CycleReviewCard';
import { NotebookOutputRenderer } from './NotebookOutputRenderer';
import { coordinatorApi } from '../api/blueprint';
import type { ChatMessage, ChatContent, ToolUse, NotebookOutputData } from '../types';

interface MessageProps {
  message: ChatMessage;
  onNavigateToBlueprint?: (blueprintId: string) => void;
  onNavigateToSwarm?: () => void;  // 跳转到蜂群页面的回调
  onNavigateToCode?: (context?: any) => void;  // 跳转到代码页面的回调
  onDevAction?: (action: string, data?: any) => void; // 通用开发动作回调
  /** 消息是否正在流式传输中 */
  isStreaming?: boolean;
}

export function Message({ message, onNavigateToBlueprint, onNavigateToSwarm, onNavigateToCode, onDevAction, isStreaming = false }: MessageProps) {
  const { role, content } = message;

  // 获取内容数组
  const contentArray = Array.isArray(content) ? content : [];

  const renderContent = (item: ChatContent, index: number) => {
    if (item.type === 'text') {
      return <MarkdownContent key={index} content={item.text} />;
    }
    if (item.type === 'image') {
      const imgSrc = item.source?.type === 'base64'
        ? `data:${item.source.media_type};base64,${item.source.data}`
        : item.url;
      return (
        <div key={index} className="image-container">
          <img
            src={imgSrc}
            alt={item.fileName || '上传的图片'}
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
          onCancel={() => onDevAction?.('cancel')} // TODO: 实现 cancel
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
            <span>UI 设计图 - {item.projectName}</span>
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
              alt={`${item.projectName} UI 设计图`}
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

  return (
    <div className={`message ${role}`}>
      <div className="message-header">
        <span className="message-role">{role === 'user' ? '你' : 'Claude'}</span>
        {message.model && <span>({message.model})</span>}
      </div>
      {Array.isArray(content)
        ? content.map(renderContent)
        : <MarkdownContent content={content as unknown as string} />
      }
    </div>
  );
}
