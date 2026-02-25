/**
 * DiffView - Git Diff 视图组件
 * 渲染彩色的 diff 内容，显示文件修改详情
 */

import { useMemo, useState } from 'react';
import { useLanguage } from '../../i18n';

interface DiffViewProps {
  diff: string;
  fileName: string;
  onClose: () => void;
}

type DiffMode = 'unified' | 'split';

/**
 * Diff 行类型
 */
type DiffLineType = 'added' | 'removed' | 'context' | 'header' | 'hunk';

interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface ParsedDiff {
  unifiedLines: DiffLine[];
  leftLines: DiffLine[];
  rightLines: DiffLine[];
}

/**
 * 解析 diff 文本为行数组
 */
function parseDiff(diffText: string): ParsedDiff {
  const lines = diffText.split('\n');
  const unifiedLines: DiffLine[] = [];
  const leftLines: DiffLine[] = [];
  const rightLines: DiffLine[] = [];
  
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const line of lines) {
    if (!line) {
      const unifiedLine = { type: 'context' as DiffLineType, content: '', lineNumber: newLineNumber };
      unifiedLines.push(unifiedLine);
      
      leftLines.push({ type: 'context', content: '', oldLineNumber });
      rightLines.push({ type: 'context', content: '', newLineNumber });
      continue;
    }

    // Diff 头部（diff --git, index, +++, ---）
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('+++') ||
      line.startsWith('---')
    ) {
      const headerLine = { type: 'header' as DiffLineType, content: line };
      unifiedLines.push(headerLine);
      leftLines.push({ type: 'header', content: line });
      rightLines.push({ type: 'header', content: line });
      continue;
    }

    // Hunk 头部（@@ -1,5 +1,7 @@）
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLineNumber = parseInt(match[1], 10);
        newLineNumber = parseInt(match[2], 10);
      }
      
      const hunkLine = { type: 'hunk' as DiffLineType, content: line };
      unifiedLines.push(hunkLine);
      leftLines.push({ type: 'hunk', content: line });
      rightLines.push({ type: 'hunk', content: line });
      continue;
    }

    // 新增行
    if (line.startsWith('+')) {
      unifiedLines.push({ type: 'added', content: line, lineNumber: newLineNumber });
      
      leftLines.push({ type: 'context', content: '', oldLineNumber: undefined });
      rightLines.push({ type: 'added', content: line, newLineNumber: newLineNumber });
      newLineNumber++;
      continue;
    }

    // 删除行
    if (line.startsWith('-')) {
      unifiedLines.push({ type: 'removed', content: line });
      
      leftLines.push({ type: 'removed', content: line, oldLineNumber });
      rightLines.push({ type: 'context', content: '', newLineNumber: undefined });
      oldLineNumber++;
      continue;
    }

    // 上下文行
    unifiedLines.push({ type: 'context', content: line, lineNumber: newLineNumber });
    leftLines.push({ type: 'context', content: line, oldLineNumber });
    rightLines.push({ type: 'context', content: line, newLineNumber });
    oldLineNumber++;
    newLineNumber++;
  }

  return { unifiedLines, leftLines, rightLines };
}

export function DiffView({ diff, fileName, onClose }: DiffViewProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<DiffMode>('unified');

  // 解析 diff
  const parsedDiff = useMemo(() => parseDiff(diff), [diff]);

  // 如果 diff 为空
  if (!diff || diff.trim().length === 0) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">
          <span className="git-diff-file-name">{fileName || t('git.diff')}</span>
          <button className="git-diff-close" onClick={onClose} title={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="git-diff-content">
          <div className="git-empty-state">{t('git.noChanges')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-diff-view">
      {/* 头部 */}
      <div className="git-diff-header">
        <span className="git-diff-file-name">{fileName || t('git.diff')}</span>
        
        {/* 模式切换按钮 */}
        <div className="git-diff-mode-switcher">
          <button
            className={`git-diff-mode-btn ${mode === 'unified' ? 'active' : ''}`}
            onClick={() => setMode('unified')}
            title={t('git.unified')}
          >
            {t('git.unified')}
          </button>
          <button
            className={`git-diff-mode-btn ${mode === 'split' ? 'active' : ''}`}
            onClick={() => setMode('split')}
            title={t('git.split')}
          >
            {t('git.split')}
          </button>
        </div>
        
        <button className="git-diff-close" onClick={onClose} title={t('common.close')}>
          ✕
        </button>
      </div>

      {/* Diff 内容 */}
      <div className="git-diff-content">
        {mode === 'unified' ? (
          <div className="git-diff-lines">
            {parsedDiff.unifiedLines.map((line, index) => {
              // 根据行类型选择 CSS 类名
              let className = 'git-diff-line';
              if (line.type === 'added') className += ' git-diff-line--added';
              else if (line.type === 'removed') className += ' git-diff-line--removed';
              else if (line.type === 'header') className += ' git-diff-line--header';
              else if (line.type === 'hunk') className += ' git-diff-line--hunk';
              else className += ' git-diff-line--context';

              return (
                <div key={index} className={className}>
                  {line.lineNumber !== undefined && (
                    <span className="git-diff-line-number">{line.lineNumber}</span>
                  )}
                  <span className="git-diff-line-content">{line.content}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="git-diff-split-container">
            {/* 左侧（旧代码） */}
            <div className="git-diff-split-pane">
              {parsedDiff.leftLines.map((line, index) => {
                let className = 'git-diff-line';
                if (line.type === 'added') className += ' git-diff-line--empty';
                else if (line.type === 'removed') className += ' git-diff-line--removed';
                else if (line.type === 'header') className += ' git-diff-line--header';
                else if (line.type === 'hunk') className += ' git-diff-line--hunk';
                else className += ' git-diff-line--context';

                return (
                  <div key={index} className={className}>
                    {line.oldLineNumber !== undefined && (
                      <span className="git-diff-line-number">{line.oldLineNumber}</span>
                    )}
                    {line.oldLineNumber === undefined && line.type !== 'header' && line.type !== 'hunk' && (
                      <span className="git-diff-line-number"></span>
                    )}
                    <span className="git-diff-line-content">{line.content}</span>
                  </div>
                );
              })}
            </div>
            
            {/* 右侧（新代码） */}
            <div className="git-diff-split-pane">
              {parsedDiff.rightLines.map((line, index) => {
                let className = 'git-diff-line';
                if (line.type === 'added') className += ' git-diff-line--added';
                else if (line.type === 'removed') className += ' git-diff-line--empty';
                else if (line.type === 'header') className += ' git-diff-line--header';
                else if (line.type === 'hunk') className += ' git-diff-line--hunk';
                else className += ' git-diff-line--context';

                return (
                  <div key={index} className={className}>
                    {line.newLineNumber !== undefined && (
                      <span className="git-diff-line-number">{line.newLineNumber}</span>
                    )}
                    {line.newLineNumber === undefined && line.type !== 'header' && line.type !== 'hunk' && (
                      <span className="git-diff-line-number"></span>
                    )}
                    <span className="git-diff-line-content">{line.content}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
