import { useState } from 'react';
import { MarkdownContent } from '../MarkdownContent';
import type { ChatMessage, ChatContent, ToolUse } from '../../types';
import { useLanguage } from '../../i18n';
import styles from './CompactMessage.module.css';

interface CompactMessageProps {
  message: ChatMessage;
  onOpenFile?: (path: string) => void;
  isStreaming?: boolean;
}

export function CompactMessage({ message, onOpenFile, isStreaming = false }: CompactMessageProps) {
  const { role, content } = message;
  const contentArray = Array.isArray(content) ? content : [];

  const renderContent = (item: ChatContent, index: number) => {
    if (item.type === 'text') {
      return <TextContent key={index} text={item.text} onOpenFile={onOpenFile} />;
    }
    if (item.type === 'tool_use') {
      return <ToolUseContent key={index} toolUse={item as ToolUse} />;
    }
    if (item.type === 'thinking') {
      return <ThinkingContent key={index} text={item.text} isStreaming={isStreaming} />;
    }
    if (item.type === 'blueprint') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z"/>
          </svg>
          <span>Blueprint: {item.name} ({item.moduleCount} modules)</span>
        </div>
      );
    }
    if (item.type === 'design_image') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2h6v1H5V7z"/>
          </svg>
          <span>Design: {item.projectName} ({item.style})</span>
        </div>
      );
    }
    if (item.type === 'impact_analysis') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1L1 8l7 7 7-7-7-7zm0 2.414L12.586 8 8 12.586 3.414 8 8 3.414z"/>
          </svg>
          <span>Impact Analysis ({item.data.risk.overallLevel} risk)</span>
        </div>
      );
    }
    if (item.type === 'dev_progress') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM3 8a5 5 0 1110 0A5 5 0 013 8z"/>
          </svg>
          <span>Progress: {item.data.phase} ({item.data.percentage}%)</span>
        </div>
      );
    }
    if (item.type === 'regression_result') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1L1 8l7 7 7-7-7-7zm0 2.414L12.586 8 8 12.586 3.414 8 8 3.414z"/>
          </svg>
          <span>Regression: {item.data.passed ? 'Passed' : 'Failed'}</span>
        </div>
      );
    }
    if (item.type === 'cycle_review') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM3 8a5 5 0 1110 0A5 5 0 013 8z"/>
          </svg>
          <span>Review: Score {item.data.score}</span>
        </div>
      );
    }
    if (item.type === 'image') {
      return (
        <div key={index} className={styles.inlineInfo}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 7l2-3 2 2 3-4v8H5v-3z"/>
          </svg>
          <span>{item.fileName || 'Image'}</span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`${styles.message} ${styles[role]}`}>
      <div className={styles.content}>
        {contentArray.map(renderContent)}
      </div>
    </div>
  );
}

// 文本内容组件
function TextContent({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const [showFullCode, setShowFullCode] = useState(false);

  // 检测代码块并提取文件路径
  const codeBlockRegex = /```(\w+)?\s*\n([\s\S]*?)```/g;
  const matches = [...text.matchAll(codeBlockRegex)];

  if (matches.length > 0 && !showFullCode) {
    // 有代码块，显示预览
    const parts: JSX.Element[] = [];
    let lastIndex = 0;

    matches.forEach((match, idx) => {
      const beforeCode = text.slice(lastIndex, match.index);
      if (beforeCode.trim()) {
        parts.push(<MarkdownContent key={`text-${idx}`} content={beforeCode} />);
      }

      const language = match[1] || 'text';
      const code = match[2];
      const lines = code.split('\n');
      const preview = lines.slice(0, 3).join('\n');
      const hasMore = lines.length > 3;

      // 尝试提取文件路径（从代码块前的注释或文本中）
      const pathMatch = text.slice(Math.max(0, match.index! - 200), match.index).match(/(?:File|Path|in)\s*[:：]\s*([^\s\n]+)/i);
      const filePath = pathMatch?.[1];

      parts.push(
        <div key={`code-${idx}`} className={styles.codePreview}>
          <div className={styles.codeHeader}>
            <span className={styles.codeLang}>{language}</span>
            {filePath && onOpenFile && (
              <button
                className={styles.codeOpenBtn}
                onClick={() => onOpenFile(filePath)}
                title={`Open ${filePath}`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11 2L5 8l6 6V2z"/>
                </svg>
                Open
              </button>
            )}
          </div>
          <pre className={styles.codeContent}>
            <code>{preview}</code>
          </pre>
          {hasMore && (
            <div className={styles.codeExpand}>
              <button onClick={() => setShowFullCode(true)}>
                ... ({lines.length - 3} more lines)
              </button>
            </div>
          )}
        </div>
      );

      lastIndex = match.index! + match[0].length;
    });

    const afterCode = text.slice(lastIndex);
    if (afterCode.trim()) {
      parts.push(<MarkdownContent key="text-after" content={afterCode} />);
    }

    return <>{parts}</>;
  }

  // 没有代码块或已展开，直接渲染
  return <MarkdownContent content={text} />;
}

// 工具调用内容组件
function ToolUseContent({ toolUse }: { toolUse: ToolUse }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();

  // 提取文件路径（如果存在）
  let pathInfo = '';
  if (toolUse.input && typeof toolUse.input === 'object') {
    const input = toolUse.input as any;
    pathInfo = input.path || input.file_path || input.filePath || '';
  }

  // 状态图标
  let statusIcon = '...';
  if (toolUse.status === 'completed') statusIcon = '✓';
  else if (toolUse.status === 'error') statusIcon = '✗';
  else if (toolUse.status === 'running') statusIcon = '⟳';

  return (
    <div className={styles.toolUse}>
      <div className={styles.toolHeader} onClick={() => setExpanded(!expanded)}>
        <span className={styles.toolStatus}>{statusIcon}</span>
        <span className={styles.toolName}>{toolUse.name}</span>
        {pathInfo && <span className={styles.toolPath}>{pathInfo}</span>}
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="currentColor"
          className={expanded ? styles.toolExpandIconOpen : styles.toolExpandIcon}
        >
          <path d="M4 6l4 4 4-4H4z"/>
        </svg>
      </div>
      {expanded && (
        <div className={styles.toolDetails}>
          <div className={styles.toolSection}>
            <div className={styles.toolSectionTitle}>Input:</div>
            <pre className={styles.toolJson}>{JSON.stringify(toolUse.input, null, 2)}</pre>
          </div>
          {toolUse.result && (
            <div className={styles.toolSection}>
              <div className={styles.toolSectionTitle}>Output:</div>
              <pre className={styles.toolJson}>
                {toolUse.result.output || toolUse.result.error || t('error.noOutput')}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 思考块组件
function ThinkingContent({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  // 计算持续时间（简化版，实际应从时间戳计算）
  const duration = text ? Math.min(Math.floor(text.length / 50), 30) : 0;
  const label = isStreaming ? 'Thinking...' : duration > 0 ? `Thinking (${duration}s)` : 'Thinking...';

  return (
    <div className={styles.thinking}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 2a6 6 0 100 12A6 6 0 008 2zM3 8a5 5 0 1110 0A5 5 0 013 8z"/>
      </svg>
      <span>{label}</span>
    </div>
  );
}
