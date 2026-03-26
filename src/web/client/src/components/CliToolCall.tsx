import { useState, useMemo, useRef, useEffect, ReactNode } from 'react';
import { CliSpinner, CliStatusIndicator } from './common/CliSpinner';
import { useLanguage } from '../i18n';
import './CliToolCall.css';
import type { ToolUse, SubagentToolCall } from '../types';
import { computeSideBySideDiff } from '../utils/diffUtils';
import type { DiffRow } from '../utils/diffUtils';
import { getEditOperations, getToolResultText } from '../utils/editTool';
import type { EditOperation } from '../utils/editTool';

// 默认显示的最大行数（与官方 CLI 保持一致）
const DEFAULT_MAX_LINES = 10;

// CLI 风格的工具名称
const CLI_TOOL_NAMES: Record<string, string> = {
  Bash: 'Bash',
  BashOutput: 'Bash',
  KillShell: 'Kill',
  Read: 'Read',
  Write: 'Write',
  Edit: 'Edit',
  MultiEdit: 'MultiEdit',
  Glob: 'Glob',
  Grep: 'Grep',
  WebFetch: 'WebFetch',
  WebSearch: 'WebSearch',
  TodoWrite: 'Update Todos',
  Task: 'Task',
  NotebookEdit: 'NotebookEdit',
  AskUserQuestion: 'AskUserQuestion',
  Browser: 'Browser',
  TestRunner: 'TestRunner',
  Database: 'Database',
  Debugger: 'Debugger',
};

interface CliToolCallProps {
  toolUse: ToolUse;
}

type EditDisplayRow =
  | { kind: 'separator'; key: string }
  | { kind: 'diff'; key: string; row: DiffRow };

/**
 * 可展开的内容包装组件 - 支持 "Click to expand" 功能
 */
interface ExpandableContentProps {
  children: ReactNode;
  maxLines?: number;
  totalLines: number;
  expanded: boolean;
  onToggle: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  hideContentWhenCollapsed?: boolean;
  alwaysShowToggle?: boolean;
}

function ExpandableContent({
  children,
  maxLines = DEFAULT_MAX_LINES,
  totalLines,
  expanded,
  onToggle,
  t,
  hideContentWhenCollapsed = false,
  alwaysShowToggle = false,
}: ExpandableContentProps) {
  const hiddenLines = totalLines - maxLines;
  const shouldTruncate = !expanded && hiddenLines > 0;
  const showToggle = alwaysShowToggle || hiddenLines > 0;
  const showBody = !(hideContentWhenCollapsed && !expanded);

  return (
    <div className="cli-expandable-content">
      {showBody && (
        <div className={`cli-expandable-body ${shouldTruncate ? 'cli-expandable-truncated' : ''}`}>
          {children}
        </div>
      )}
      {showToggle && (
        <div className="cli-expand-footer">
          {!expanded && !hideContentWhenCollapsed && hiddenLines > 0 && (
            <span className="cli-hidden-lines">{t('cli.hiddenLines', { count: hiddenLines })}</span>
          )}
          <button
            className="cli-expand-btn"
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
          >
            {expanded ? t('cli.collapseButton') : t('cli.expandButton')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 获取工具调用的简要描述
 */
function getToolDescription(name: string, input: any): string {
  // 参数正在流式传输中
  if (input?._streaming) return 'streaming...';

  switch (name) {
    case 'Bash':
      return input?.description || '';
    case 'Read':
      if (input?.file_path) {
        const path = String(input.file_path);
        return path;
      }
      return '';
    case 'Write':
      if (input?.file_path) {
        const path = String(input.file_path);
        const lines = input?.content?.split?.('\n')?.length || 0;
        return `${path}${lines > 0 ? ` (${lines} lines)` : ''}`;
      }
      return '';
    case 'Edit':
      if (input?.file_path) {
        return input.file_path;
      }
      return '';
    case 'Glob':
      return input?.pattern || '';
    case 'Grep':
      return `"${input?.pattern || ''}"` + (input?.path ? ` (in ${input.path})` : '');
    case 'WebFetch':
      return input?.url || '';
    case 'WebSearch':
      return input?.query || '';
    case 'Task':
      return input?.description || '';
    case 'Browser':
      return input?.action || '';
    case 'TestRunner':
      return input?.path || input?.framework || '';
    case 'Database':
      return input?.action === 'query' ? (input?.sql || input?.command || '') : (input?.action || '');
    case 'Debugger':
      return input?.action || '';
    default:
      // 通用工具描述：尝试常见参数名
      if (input) {
        for (const key of ['query', 'action', 'description', 'prompt', 'skill', 'name', 'url']) {
          if (typeof input[key] === 'string' && input[key]) {
            return input[key].length > 80 ? input[key].slice(0, 80) + '...' : input[key];
          }
        }
      }
      return '';
  }
}

interface HiddenOutputToolContentProps {
  output: string;
  lineCount: number;
  containerClassName: string;
  infoClassName: string;
  previewClassName: string;
}

function HiddenOutputToolContent({
  output,
  lineCount,
  containerClassName,
  infoClassName,
  previewClassName,
}: HiddenOutputToolContentProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const totalLines = output ? output.split('\n').length : 0;

  if (!output) return null;

  return (
    <div className={containerClassName}>
      <div className={infoClassName}>{t('cli.linesOfOutput', { count: lineCount })}</div>
      <ExpandableContent
        totalLines={totalLines}
        maxLines={DEFAULT_MAX_LINES}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        t={t}
        hideContentWhenCollapsed
        alwaysShowToggle
      >
        <pre className={previewClassName}>{output}</pre>
      </ExpandableContent>
    </div>
  );
}

/**
 * 渲染 Bash 工具内容 - 带 IN/OUT 标签，支持 Click to expand
 * 当 status=running 且有 streamingOutput 时，显示实时输出
 */
function BashToolContent({ input, result, status, streamingOutput }: {
  input: any;
  result?: any;
  status?: string;
  streamingOutput?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const streamingRef = useRef<HTMLPreElement>(null);
  const { t } = useLanguage();
  const output = result?.output || result?.error || t('cli.noOutput');
  const allLines = output.split('\n');
  const totalLines = allLines.length;
  const maxLines = DEFAULT_MAX_LINES;

  const displayOutput = expanded ? output : allLines.slice(0, maxLines).join('\n');

  const isRunning = status === 'running';
  const hasStreamingOutput = isRunning && streamingOutput;

  // 自动滚动到实时输出底部
  useEffect(() => {
    if (streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  }, [streamingOutput]);

  // 限制实时输出显示的行数（只显示最后 N 行，避免 DOM 过大）
  const streamingLines = streamingOutput?.split('\n') || [];
  const maxStreamingLines = 20;
  const displayStreaming = streamingLines.length > maxStreamingLines
    ? streamingLines.slice(-maxStreamingLines).join('\n')
    : streamingOutput || '';

  return (
    <div className="cli-bash-content">
      {input?.command && (
        <div className="cli-bash-section">
          <span className="cli-bash-label">{t('cli.inputLabel')}</span>
          <pre className="cli-bash-code">{input.command}</pre>
        </div>
      )}
      {/* 实时输出（前台执行中） */}
      {hasStreamingOutput && (
        <div className="cli-bash-section">
          <span className="cli-bash-label cli-bash-label--live">LIVE</span>
          <pre
            ref={streamingRef}
            className="cli-bash-code cli-bash-output cli-bash-streaming"
          >
            {displayStreaming}
          </pre>
        </div>
      )}
      {/* 最终结果（执行完成后） */}
      {result && (
        <div className="cli-bash-section">
          <span className="cli-bash-label">{t('cli.outputLabel')}</span>
          <ExpandableContent
            totalLines={totalLines}
            maxLines={maxLines}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            t={t}
          >
            <pre className="cli-bash-code cli-bash-output">
              {displayOutput}
            </pre>
          </ExpandableContent>
        </div>
      )}
    </div>
  );
}


/**
 * 渲染 Edit 工具内容 - 左右对比 side-by-side diff，支持 Click to expand
 */
function EditToolContent({ input, result }: { input: any; result?: any }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const filePath = input?.file_path || '';
  const fileExt = filePath.split('.').pop()?.toLowerCase() || '';
  const isDocumentFile = ['docx', 'xlsx', 'pptx'].includes(fileExt);
  const editOperations = useMemo(() => getEditOperations(input), [input]);
  const resultText = getToolResultText(result);

  const diffRows = useMemo<EditDisplayRow[]>(() => {
    return editOperations.flatMap((operation, index) => {
      const rows: EditDisplayRow[] = [];
      if (index > 0) {
        rows.push({ kind: 'separator', key: `separator-${index}` });
      }

      const oldLines = operation.old_string ? operation.old_string.split('\n') : [];
      const newLines = operation.new_string ? operation.new_string.split('\n') : [];
      const operationRows = computeSideBySideDiff(oldLines, newLines).map((row, rowIndex) => ({
        kind: 'diff' as const,
        key: `diff-${index}-${rowIndex}`,
        row,
      }));

      rows.push(...operationRows);
      return rows;
    });
  }, [editOperations]);

  const totalRows = diffRows.length;
  const maxRows = DEFAULT_MAX_LINES;
  const displayRows = expanded ? diffRows : diffRows.slice(0, maxRows);

  // 统计增删行数
  const removedCount = diffRows.filter(
    (entry): entry is Extract<EditDisplayRow, { kind: 'diff' }> => entry.kind === 'diff'
  ).filter(entry => entry.row.left && !entry.row.right).length;
  const addedCount = diffRows.filter(
    (entry): entry is Extract<EditDisplayRow, { kind: 'diff' }> => entry.kind === 'diff'
  ).filter(entry => !entry.row.left && entry.row.right).length;

  // 生成摘要文本
  const summaryParts: string[] = [];
  if (removedCount > 0) summaryParts.push(t('cli.editRemoved', { count: removedCount }));
  if (addedCount > 0) summaryParts.push(t('cli.editAdded', { count: addedCount }));
  const summary = summaryParts.length > 0 ? summaryParts.join(', ') : t('cli.editModified');

  if (displayRows.length === 0) {
    const fallbackLines = resultText ? resultText.split('\n').length : 0;

    return (
      <div className="cli-edit-content">
        <div className="cli-edit-header">
          {isDocumentFile && (
            <span className="cli-edit-doc-badge">{fileExt.toUpperCase()}</span>
          )}
          <div className="cli-edit-status">{summary}</div>
          <div className="cli-edit-stats">
            {removedCount > 0 && <span className="cli-stat-removed">-{removedCount}</span>}
            {addedCount > 0 && <span className="cli-stat-added">+{addedCount}</span>}
          </div>
        </div>
        {resultText ? (
          <ExpandableContent
            totalLines={fallbackLines}
            maxLines={DEFAULT_MAX_LINES}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
            t={t}
          >
            <pre className="cli-edit-fallback">{resultText}</pre>
          </ExpandableContent>
        ) : (
          <div className="cli-edit-fallback cli-edit-fallback--empty">{summary}</div>
        )}
      </div>
    );
  }

  return (
    <div className="cli-edit-content">
      <div className="cli-edit-header">
        {isDocumentFile && (
          <span className="cli-edit-doc-badge">{fileExt.toUpperCase()}</span>
        )}
        <div className="cli-edit-status">{summary}</div>
        <div className="cli-edit-stats">
          {removedCount > 0 && <span className="cli-stat-removed">-{removedCount}</span>}
          {addedCount > 0 && <span className="cli-stat-added">+{addedCount}</span>}
        </div>
      </div>
      <ExpandableContent
        totalLines={totalRows}
        maxLines={maxRows}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        t={t}
      >
        <div className="cli-diff-sidebyside">
          {displayRows.map((entry) => (
            entry.kind === 'separator' ? (
              <div key={entry.key} className="cli-edit-separator" />
            ) : (
              <div key={entry.key} className="cli-diff-row">
                {/* 左列 - old */}
                <div className={`cli-diff-cell ${
                  entry.row.left
                    ? (entry.row.left.type === 'removed' ? 'cli-diff-cell--removed' : 'cli-diff-cell--unchanged')
                    : 'cli-diff-cell--empty'
                }`}>
                  {entry.row.left && (
                    <>
                      <span className="cli-diff-cell-prefix">
                        {entry.row.left.type === 'removed' ? '\u2212' : '\u00A0'}
                      </span>
                      <span className="cli-diff-cell-text">{entry.row.left.text || '\u00A0'}</span>
                    </>
                  )}
                </div>
                {/* 右列 - new */}
                <div className={`cli-diff-cell ${
                  entry.row.right
                    ? (entry.row.right.type === 'added' ? 'cli-diff-cell--added' : 'cli-diff-cell--unchanged')
                    : 'cli-diff-cell--empty'
                }`}>
                  {entry.row.right && (
                    <>
                      <span className="cli-diff-cell-prefix">
                        {entry.row.right.type === 'added' ? '+' : '\u00A0'}
                      </span>
                      <span className="cli-diff-cell-text">{entry.row.right.text || '\u00A0'}</span>
                    </>
                  )}
                </div>
              </div>
            )
          ))}
        </div>
      </ExpandableContent>
    </div>
  );
}

/**
 * 渲染 Write 工具内容 - 支持 Click to expand
 */
function WriteToolContent({ input }: { input: any }) {
  const { t } = useLanguage();
  const isStreaming = input?._streaming;
  const filePath = input?.file_path || '';
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const isHtml = ext === 'html' || ext === 'htm';

  const [expanded, setExpanded] = useState(false);
  const [previewing, setPreviewing] = useState(isHtml);
  const content = input?.content || '';
  const allLines = content.split('\n');
  const totalLines = allLines.length;
  const maxLines = DEFAULT_MAX_LINES;

  const displayLines = expanded ? allLines : allLines.slice(0, maxLines);

  // 参数正在流式传输中，显示等待状态
  if (isStreaming) {
    return (
      <div className="cli-write-content">
        <div className="cli-write-info">
          <span>{t('cli.streaming') || 'Streaming content...'}</span>
        </div>
      </div>
    );
  }

  // 构建预览 URL：优先使用绝对路径直接传，否则用相对路径
  const previewUrl = isHtml
    ? `/api/files/preview?path=${encodeURIComponent(filePath)}`
    : '';

  return (
    <div className="cli-write-content">
      <div className="cli-write-info">
        <span>{t('cli.linesCount', { count: totalLines })}</span>
        {isHtml && (
          <button
            className="cli-preview-btn"
            onClick={(e) => { e.stopPropagation(); setPreviewing(!previewing); }}
          >
            {previewing ? '▼ Close Preview' : '▶ Preview'}
          </button>
        )}
      </div>
      {previewing && previewUrl && (
        <div className="cli-preview-container">
          <div className="cli-preview-toolbar">
            <span className="cli-preview-label">Live Preview</span>
            <a
              className="cli-preview-open-btn"
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              ↗ Open in new tab
            </a>
            <button
              className="cli-preview-close-btn"
              onClick={(e) => { e.stopPropagation(); setPreviewing(false); }}
            >
              ✕
            </button>
          </div>
          <iframe
            className="cli-preview-iframe"
            src={previewUrl}
            sandbox="allow-scripts allow-same-origin"
            title="HTML Preview"
          />
        </div>
      )}
      {!previewing && (
        <ExpandableContent
          totalLines={totalLines}
          maxLines={maxLines}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          t={t}
        >
          <pre className="cli-write-preview">
            {displayLines.join('\n')}
          </pre>
        </ExpandableContent>
      )}
    </div>
  );
}

/**
 * 渲染 TodoWrite 工具内容 - 带勾选框的列表
 */
function TodoWriteContent({ input }: { input: any }) {
  const todos = input?.todos || [];

  return (
    <div className="cli-todo-content">
      {todos.map((todo: any, index: number) => (
        <div key={index} className={`cli-todo-item cli-todo-${todo.status}`}>
          <span className="cli-todo-checkbox">
            {todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '◐' : '○'}
          </span>
          <span className={`cli-todo-text ${todo.status === 'completed' ? 'cli-todo-done' : ''}`}>
            {todo.content}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * 渲染 Read 工具内容 - 支持 Click to expand
 */
function ReadToolContent({ result }: { result?: any }) {
  const output = getToolResultText(result);
  const lineCount = output ? output.split('\n').length : 0;

  return (
    <HiddenOutputToolContent
      output={output}
      lineCount={lineCount}
      containerClassName="cli-read-content"
      infoClassName="cli-read-info"
      previewClassName="cli-read-preview"
    />
  );
}

/**
 * 渲染 Grep 工具内容 - 支持 Click to expand
 */
function GrepToolContent({ result }: { result?: any }) {
  const output = getToolResultText(result);
  const lineCount = output ? output.split('\n').filter((line: string) => line.trim().length > 0).length : 0;

  return (
    <HiddenOutputToolContent
      output={output}
      lineCount={lineCount}
      containerClassName="cli-grep-content"
      infoClassName="cli-grep-info"
      previewClassName="cli-grep-preview"
    />
  );
}

/**
 * 渲染 Glob 工具内容 - 默认隐藏结果正文
 */
function GlobToolContent({ result }: { result?: any }) {
  const output = getToolResultText(result);
  const lineCount = output ? output.split('\n').filter((line: string) => line.trim().length > 0).length : 0;

  return (
    <HiddenOutputToolContent
      output={output}
      lineCount={lineCount}
      containerClassName="cli-glob-content"
      infoClassName="cli-glob-info"
      previewClassName="cli-glob-preview"
    />
  );
}

/**
 * Browser 工具内容渲染
 * 支持截图预览和其他 Browser 操作的结果展示
 */
function BrowserToolContent({ input, result }: { input: any; result?: any }) {
  const action = input?.action || '';
  const images = result?.data?.images as Array<{ type: string; source: { type: string; media_type: string; data: string } }> | undefined;
  const output = result?.output || result?.error || '';
  const hasImages = images && images.length > 0;

  if (!output && !hasImages) return null;

  return (
    <div className="cli-browser-content">
      {/* 文本输出 */}
      {output && (
        <pre className="cli-generic-output">{output}</pre>
      )}
      {/* 图片（screenshot / screenshot_labeled 等任何返回 images 的操作） */}
      {hasImages && images.map((img, i) => (
        <div key={i} style={{ marginTop: '8px' }}>
          <img
            src={`data:${img.source.media_type};base64,${img.source.data}`}
            alt={`Browser ${action}`}
            style={{
              maxWidth: '100%',
              borderRadius: '6px',
              border: '1px solid var(--border-color, #333)',
            }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * TestRunner 工具内容渲染
 */
function TestRunnerToolContent({ input, result }: { input: any; result?: any }) {
  const [expanded, setExpanded] = useState(false);
  const [showPassed, setShowPassed] = useState(false);
  const { t } = useLanguage();

  let data: any = null;
  try {
    if (result?.output) {
      data = JSON.parse(result.output);
    }
  } catch {
    // 解析失败，回退纯文本
  }

  if (!data) {
    const output = result?.output || result?.error || '';
    const allLines = output.split('\n');
    return (
      <div className="cli-testrunner-content">
        <ExpandableContent
          totalLines={allLines.length}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          t={t}
        >
          <pre className="cli-bash-code cli-bash-output">{output}</pre>
        </ExpandableContent>
      </div>
    );
  }

  const suites: any[] = data.suites || [];
  const totalLines = suites.reduce((acc: number, s: any) => acc + (s.tests?.length || 0), 0);
  const failedTests: Array<{ suiteName: string; test: any }> = [];
  const passedTests: Array<{ suiteName: string; test: any }> = [];
  suites.forEach((suite: any) => {
    (suite.tests || []).forEach((test: any) => {
      if (test.status === 'failed') {
        failedTests.push({ suiteName: suite.name, test });
      } else if (test.status === 'passed') {
        passedTests.push({ suiteName: suite.name, test });
      }
    });
  });

  const coverage = data.coverage;

  return (
    <div className="cli-testrunner-content">
      {/* 概要栏 */}
      <div className="cli-test-summary">
        <span className="cli-test-passed">✓ {data.passed ?? 0}</span>
        <span className="cli-test-failed">✗ {data.failed ?? 0}</span>
        <span className="cli-test-skipped">◌ {data.skipped ?? 0}</span>
        <span className="cli-test-total">{t('cli.testTotal', { count: data.total ?? 0 })}</span>
        {data.duration != null && (
          <span className="cli-test-duration">{data.duration}ms</span>
        )}
      </div>

      <ExpandableContent
        totalLines={totalLines}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        t={t}
      >
        {/* 失败测试置顶 */}
        {failedTests.map(({ suiteName, test }, i) => (
          <div key={i} className="cli-test-error">
            <div className="cli-test-error-name">{suiteName} › {test.name}</div>
            {test.error?.message && (
              <pre className="cli-test-error-message">{test.error.message}</pre>
            )}
            {test.error?.diff && (
              <pre className="cli-test-error-diff">{test.error.diff}</pre>
            )}
          </div>
        ))}

        {/* 通过测试折叠显示 */}
        {passedTests.length > 0 && (
          <div className="cli-test-passed-section">
            <button
              className="cli-expand-btn"
              onClick={(e) => { e.stopPropagation(); setShowPassed(!showPassed); }}
            >
              {showPassed ? '▼' : '▶'} {t('cli.testPassed', { count: passedTests.length })}
            </button>
            {showPassed && passedTests.map(({ suiteName, test }, i) => (
              <div key={i} className="cli-test-passed-item">
                ✓ {suiteName} › {test.name}
                {test.duration != null && <span className="cli-test-duration"> ({test.duration}ms)</span>}
              </div>
            ))}
          </div>
        )}

        {/* 覆盖率区域 */}
        {coverage && (
          <div className="cli-coverage-section">
            {['lines', 'branches', 'functions'].map((key) => {
              const pct = coverage[key] ?? 0;
              return (
                <div key={key} className="cli-coverage-row">
                  <span className="cli-coverage-label">{key}</span>
                  <div className="cli-coverage-bar">
                    <div
                      className="cli-coverage-fill"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="cli-coverage-pct">{pct}%</span>
                </div>
              );
            })}
          </div>
        )}
      </ExpandableContent>
    </div>
  );
}

/**
 * Database 工具内容渲染
 */
function DatabaseToolContent({ input, result }: { input: any; result?: any }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();

  let data: any = null;
  let rows: any[] = [];
  let columns: string[] = [];
  let isTable = false;

  try {
    if (result?.output) {
      data = JSON.parse(result.output);
      if (data && Array.isArray(data.columns) && Array.isArray(data.rows)) {
        columns = data.columns;
        rows = data.rows;
        isTable = true;
      }
    }
  } catch {
    // 回退纯文本
  }

  const output = result?.output || '';
  const totalLines = isTable ? rows.length : output.split('\n').length;

  return (
    <div className="cli-db-content">
      <ExpandableContent
        totalLines={totalLines}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        t={t}
      >
        {isTable ? (
          <table className="cli-db-table">
            <thead>
              <tr>
                {columns.map((col: string, i: number) => (
                  <th key={i}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any, i: number) => (
                <tr key={i}>
                  {columns.map((col: string, j: number) => (
                    <td key={j}>{String(row[col] ?? row[j] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="cli-db-pre">{output}</pre>
        )}
      </ExpandableContent>

      {/* 底部信息 */}
      <div className="cli-db-footer">
        <span>{t('cli.dbRows', { count: data?.rowCount ?? rows.length })}</span>
        <span> · </span>
        <span>{t('cli.dbDuration', { duration: result?.duration ?? data?.duration ?? 0 })}</span>
        {data?.truncated && (
          <span className="cli-db-truncated"> {t('cli.dbTruncated')}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Debugger 工具内容渲染
 */
function DebuggerToolContent({ input, result }: { input: any; result?: any }) {
  const { t } = useLanguage();
  const action = input?.action || '';
  const output = result?.output || '';

  const renderByAction = () => {
    switch (action) {
      case 'launch':
      case 'attach':
        return (
          <div className="cli-debug-launch">
            {input?.program && <div className="cli-debug-program">{input.program}</div>}
            {input?.runtime && <span className="cli-debug-runtime">{input.runtime}</span>}
          </div>
        );

      case 'set_breakpoint':
        return (
          <div className="cli-debug-breakpoint">
            <span className="cli-debug-file">{input?.file}</span>
            {input?.line != null && <span className="cli-debug-line">:{input.line}</span>}
          </div>
        );

      case 'stack_trace': {
        let frames: any[] = [];
        try {
          frames = JSON.parse(output);
        } catch {
          return <pre className="cli-bash-code cli-bash-output">{output}</pre>;
        }
        return (
          <div className="cli-debug-stack">
            {frames.map((frame: any, i: number) => (
              <div key={i} className="cli-debug-frame">
                <span className="cli-debug-frame-fn">{frame.function || frame.fn || ''}</span>
                <span className="cli-debug-frame-loc">
                  {frame.file}{frame.line != null ? `:${frame.line}` : ''}
                </span>
              </div>
            ))}
          </div>
        );
      }

      case 'variables':
      case 'scopes': {
        let vars: any[] = [];
        try {
          vars = JSON.parse(output);
        } catch {
          return <pre className="cli-bash-code cli-bash-output">{output}</pre>;
        }
        return (
          <div className="cli-debug-vars">
            {vars.map((v: any, i: number) => (
              <div key={i} className="cli-debug-var">
                <span className="cli-debug-var-name">{v.name}</span>
                <span className="cli-debug-var-type">{v.type ? `(${v.type})` : ''}</span>
                <span className="cli-debug-var-value">{String(v.value ?? '')}</span>
              </div>
            ))}
          </div>
        );
      }

      case 'evaluate':
        return (
          <div className="cli-debug-evaluate">
            {input?.expression && (
              <div className="cli-bash-section">
                <span className="cli-bash-label">{t('cli.inputLabel')}</span>
                <pre className="cli-bash-code">{input.expression}</pre>
              </div>
            )}
            {output && (
              <div className="cli-bash-section">
                <span className="cli-bash-label">{t('cli.outputLabel')}</span>
                <pre className="cli-bash-code cli-bash-output">{output}</pre>
              </div>
            )}
          </div>
        );

      default:
        return output ? <pre className="cli-bash-code cli-bash-output">{output}</pre> : null;
    }
  };

  return (
    <div className="cli-debugger-content">
      {renderByAction()}
    </div>
  );
}

/**
 * 获取子工具的输入展示文本
 */
function getSubagentToolInput(name: string, input: any): string {
  switch (name) {
    case 'Bash':
      return input?.command || '';
    case 'Read':
      return input?.file_path || '';
    case 'Write':
      return input?.file_path ? `${input.file_path}` : '';
    case 'Edit':
      return input?.file_path || '';
    case 'Glob':
      return input?.pattern || '';
    case 'Grep':
      return input?.pattern || '';
    case 'WebFetch':
      return input?.url || '';
    case 'WebSearch':
      return input?.query || '';
    case 'Task':
      return input?.description || '';
    case 'TestRunner':
      return input?.path || input?.framework || '';
    case 'Database':
      return input?.sql || input?.command || input?.action || '';
    case 'Debugger':
      return `${input?.action || ''}${input?.file ? ' ' + input.file : ''}`;
    default:
      // 尝试序列化 input
      if (input) {
        try {
          const str = JSON.stringify(input);
          return str.length > 200 ? str.slice(0, 200) + '...' : str;
        } catch {
          return '';
        }
      }
      return '';
  }
}

/**
 * 子 agent 工具调用 - 详细展示版本，带 IN/OUT 标签
 */
function CliSubagentTool({ toolCall, index }: { toolCall: SubagentToolCall; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();
  const toolName = CLI_TOOL_NAMES[toolCall.name] || toolCall.name;
  const description = getToolDescription(toolCall.name, toolCall.input);
  const inputText = getSubagentToolInput(toolCall.name, toolCall.input);
  const hasOutput = !!(toolCall.result || toolCall.error);
  const output = toolCall.result || toolCall.error || '';

  // 计算执行时间
  const duration = toolCall.endTime && toolCall.startTime
    ? toolCall.endTime - toolCall.startTime
    : null;

  // 输出行数（用于判断是否需要展开）
  const outputLines = output.split('\n');
  const totalOutputLines = outputLines.length;
  const maxLines = 5;
  const shouldTruncateOutput = !expanded && totalOutputLines > maxLines;
  const displayOutput = shouldTruncateOutput
    ? outputLines.slice(0, maxLines).join('\n')
    : output;

  return (
    <div className={`cli-subagent-tool cli-subagent-tool--${toolCall.status}`}>
      {/* 工具头部 */}
      <div
        className="cli-subagent-header"
        onClick={() => hasOutput && setExpanded(!expanded)}
      >
        <CliStatusIndicator
          status={toolCall.status || 'pending'}
          showSpinner={toolCall.status === 'running'}
        />
        <span className="cli-subagent-name">{toolName}</span>
        {description && <span className="cli-subagent-desc">{description}</span>}
        {duration !== null && (
          <span className="cli-subagent-duration">{duration}ms</span>
        )}
        {hasOutput && (
          <span className="cli-subagent-expand">{expanded ? '▼' : '▶'}</span>
        )}
      </div>

      {/* 输入区域 - IN 标签 */}
      {inputText && (
        <div className="cli-subagent-section">
          <span className="cli-subagent-label cli-subagent-label--in">{t('cli.inputLabel')}</span>
          <pre className="cli-subagent-code">{inputText}</pre>
        </div>
      )}

      {/* 输出区域 - OUT 标签 (可折叠) */}
      {hasOutput && expanded && (
        <div className="cli-subagent-section">
          <span className={`cli-subagent-label ${toolCall.error ? 'cli-subagent-label--error' : 'cli-subagent-label--out'}`}>
            {toolCall.error ? t('cli.errorLabel') : t('cli.outputLabel')}
          </span>
          <div className="cli-subagent-output-wrapper">
            <pre className={`cli-subagent-code cli-subagent-output ${toolCall.error ? 'cli-subagent-output--error' : ''}`}>
              {displayOutput}
            </pre>
            {shouldTruncateOutput && (
              <div className="cli-subagent-truncated">
                {t('cli.hiddenLines', { count: totalOutputLines - maxLines })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CLI 风格的工具调用组件 - 默认展开
 */
export function CliToolCall({ toolUse }: CliToolCallProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { t } = useLanguage();
  const { name, input, status, result, subagentToolCalls, toolUseCount, lastToolInfo, streamingOutput } = toolUse;

  const toolName = CLI_TOOL_NAMES[name] || name;
  const description = getToolDescription(name, input);
  const isTaskTool = name === 'Task';

  // Task 进度信息
  const taskProgress = useMemo(() => {
    if (!isTaskTool) return null;
    const parts: string[] = [];
    if (toolUseCount && toolUseCount > 0) {
      parts.push(t('cli.toolUses', { count: toolUseCount }));
    }
    if (lastToolInfo) {
      parts.push(lastToolInfo);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [isTaskTool, toolUseCount, lastToolInfo, t]);

  // 渲染工具特定内容
  const renderToolContent = () => {
    switch (name) {
      case 'Bash':
        return <BashToolContent input={input} result={result} status={status} streamingOutput={streamingOutput} />;
      case 'Edit':
        return <EditToolContent input={input} result={result} />;
      case 'Write':
        return <WriteToolContent input={input} />;
      case 'TodoWrite':
        return <TodoWriteContent input={input} />;
      case 'Read':
        return <ReadToolContent result={result} />;
      case 'Glob':
        return <GlobToolContent result={result} />;
      case 'Grep':
        return <GrepToolContent result={result} />;
      case 'Browser':
        return <BrowserToolContent input={input} result={result} />;
      case 'TestRunner':
        return <TestRunnerToolContent input={input} result={result} />;
      case 'Database':
        return <DatabaseToolContent input={input} result={result} />;
      case 'Debugger':
        return <DebuggerToolContent input={input} result={result} />;
      case 'Task':
        return (
          <div className="cli-task-content">
            {/* Agent 工具日志标记 */}
            <div className="cli-agent-badge">
              <span className="cli-agent-badge-icon">🤖</span>
              <span className="cli-agent-badge-text">{t('cli.agentBadge')}</span>
              <span className="cli-agent-badge-type">{(input as any)?.subagent_type || 'general-purpose'}</span>
            </div>

            {subagentToolCalls && subagentToolCalls.length > 0 && (
              <div className="cli-subagent-list">
                {subagentToolCalls.map((tc, index) => (
                  <CliSubagentTool key={tc.id} toolCall={tc} index={index} />
                ))}
              </div>
            )}

            {/* 最终结果 */}
            {result && status === 'completed' && (
              <div className="cli-agent-result">
                <div className="cli-agent-result-header">{t('cli.agentResult')}</div>
                <pre className="cli-agent-result-content">
                  {typeof result === 'object' ? (result.output || result.error || JSON.stringify(result, null, 2)) : result}
                </pre>
              </div>
            )}
          </div>
        );
      default: {
        // 通用工具：显示 input 参数 + result
        const inputStr = input ? JSON.stringify(input, null, 2) : '';
        const outputStr = result
          ? (typeof result === 'string' ? result : (result.output || result.error || JSON.stringify(result, null, 2)))
          : '';
        return (inputStr || outputStr) ? (
          <div className="cli-generic-content">
            {inputStr && (
              <div className="cli-bash-section">
                <span className="cli-bash-label">IN</span>
                <pre className="cli-bash-code">{inputStr}</pre>
              </div>
            )}
            {outputStr && (
              <div className="cli-bash-section">
                <span className="cli-bash-label">OUT</span>
                <pre className="cli-bash-code cli-bash-output">{outputStr}</pre>
              </div>
            )}
          </div>
        ) : null;
      }
    }
  };

  return (
    <div className={`cli-tool-call ${isTaskTool ? 'cli-tool-call--task' : ''}`}>
      {/* 工具头部 */}
      <div className="cli-tool-header" onClick={() => setCollapsed(!collapsed)}>
        <CliStatusIndicator
          status={status || 'pending'}
          showSpinner={status === 'running'}
        />
        <span className="cli-tool-name">{toolName}</span>
        {description && <span className="cli-tool-desc">{description}</span>}
        {taskProgress && <span className="cli-task-progress">{taskProgress}</span>}
        <span className="cli-collapse-btn">{collapsed ? '▶' : '▼'}</span>
      </div>

      {/* 工具内容 - 默认展开 */}
      {!collapsed && (
        <div className="cli-tool-body">
          {renderToolContent()}
        </div>
      )}
    </div>
  );
}
