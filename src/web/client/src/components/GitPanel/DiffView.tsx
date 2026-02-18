/**
 * DiffView - Git Diff 视图组件
 * 渲染彩色的 diff 内容，显示文件修改详情
 */

import { useMemo } from 'react';
import { useLanguage } from '../../i18n';

interface DiffViewProps {
  diff: string;
  fileName: string;
  onClose: () => void;
}

/**
 * Diff 行类型
 */
type DiffLineType = 'added' | 'removed' | 'context' | 'header' | 'hunk';

interface DiffLine {
  type: DiffLineType;
  content: string;
  lineNumber?: number;
}

/**
 * 解析 diff 文本为行数组
 */
function parseDiff(diffText: string): DiffLine[] {
  const lines = diffText.split('\n');
  const result: DiffLine[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    if (!line) {
      result.push({ type: 'context', content: '', lineNumber: ++lineNumber });
      continue;
    }

    // Diff 头部（diff --git, index, +++, ---）
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('+++') ||
      line.startsWith('---')
    ) {
      result.push({ type: 'header', content: line });
      continue;
    }

    // Hunk 头部（@@ -1,5 +1,7 @@）
    if (line.startsWith('@@')) {
      result.push({ type: 'hunk', content: line });
      lineNumber = 0; // 重置行号
      continue;
    }

    // 新增行
    if (line.startsWith('+')) {
      result.push({ type: 'added', content: line, lineNumber: ++lineNumber });
      continue;
    }

    // 删除行
    if (line.startsWith('-')) {
      result.push({ type: 'removed', content: line });
      continue;
    }

    // 上下文行
    result.push({ type: 'context', content: line, lineNumber: ++lineNumber });
  }

  return result;
}

export function DiffView({ diff, fileName, onClose }: DiffViewProps) {
  const { t } = useLanguage();

  // 解析 diff
  const diffLines = useMemo(() => parseDiff(diff), [diff]);

  // 如果 diff 为空
  if (!diff || diff.trim().length === 0) {
    return (
      <div className="git-diff-view">
        <div className="git-diff-header">
          <span className="git-diff-file-name">{fileName || 'Diff'}</span>
          <button className="git-diff-close" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="git-diff-content">
          <div className="git-empty-state">No changes</div>
        </div>
      </div>
    );
  }

  return (
    <div className="git-diff-view">
      {/* 头部 */}
      <div className="git-diff-header">
        <span className="git-diff-file-name">{fileName || 'Diff'}</span>
        <button className="git-diff-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {/* Diff 内容 */}
      <div className="git-diff-content">
        <div className="git-diff-lines">
          {diffLines.map((line, index) => {
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
      </div>
    </div>
  );
}
