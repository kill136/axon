/**
 * DiffView 组件
 * 显示文件差异对比（支持并排和统一视图）
 */

import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { t } from '../../i18n/index.js';

export interface DiffViewProps {
  oldContent: string;
  newContent: string;
  fileName?: string;
  mode?: 'side-by-side' | 'unified';
  contextLines?: number;
  showLineNumbers?: boolean;
  language?: string;
  maxWidth?: number;
}

interface DiffLine {
  type: 'add' | 'delete' | 'modify' | 'context' | 'separator';
  oldLineNumber?: number;
  newLineNumber?: number;
  oldContent?: string;
  newContent?: string;
  content?: string;
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/**
 * Myers diff 算法的简化实现
 * 基于最长公共子序列（LCS）
 */
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const lcs = computeLCS(oldLines, newLines);
  const result: DiffLine[] = [];

  let oldIndex = 0;
  let newIndex = 0;
  let lcsIndex = 0;

  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (lcsIndex < lcs.length && oldIndex < oldLines.length && oldLines[oldIndex] === lcs[lcsIndex]) {
      // 相同行（上下文）
      result.push({
        type: 'context',
        oldLineNumber: oldIndex + 1,
        newLineNumber: newIndex + 1,
        content: oldLines[oldIndex],
      });
      oldIndex++;
      newIndex++;
      lcsIndex++;
    } else if (lcsIndex < lcs.length && newIndex < newLines.length && newLines[newIndex] === lcs[lcsIndex]) {
      // 删除行
      if (oldIndex < oldLines.length) {
        result.push({
          type: 'delete',
          oldLineNumber: oldIndex + 1,
          oldContent: oldLines[oldIndex],
        });
        oldIndex++;
      }
    } else if (oldIndex < oldLines.length && newIndex < newLines.length) {
      // 修改行
      result.push({
        type: 'modify',
        oldLineNumber: oldIndex + 1,
        newLineNumber: newIndex + 1,
        oldContent: oldLines[oldIndex],
        newContent: newLines[newIndex],
      });
      oldIndex++;
      newIndex++;
    } else if (oldIndex < oldLines.length) {
      // 删除行
      result.push({
        type: 'delete',
        oldLineNumber: oldIndex + 1,
        oldContent: oldLines[oldIndex],
      });
      oldIndex++;
    } else {
      // 新增行
      result.push({
        type: 'add',
        newLineNumber: newIndex + 1,
        newContent: newLines[newIndex],
      });
      newIndex++;
    }
  }

  return result;
}

/**
 * 计算最长公共子序列（LCS）
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array(m + 1)
    .fill(0)
    .map(() => Array(n + 1).fill(0));

  // 构建 DP 表
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯构建 LCS
  const lcs: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return lcs;
}

/**
 * 将 diff 行分组为 hunks（带上下文）
 */
function createHunks(diffLines: DiffLine[], contextLines: number): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let contextBuffer: DiffLine[] = [];

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];

    if (line.type === 'context') {
      contextBuffer.push(line);

      if (contextBuffer.length > contextLines * 2) {
        // 如果上下文太多，可能需要开始新的 hunk
        if (currentHunk) {
          // 添加前面的上下文
          currentHunk.lines.push(...contextBuffer.slice(0, contextLines));
          currentHunk = null;
        }
        contextBuffer = contextBuffer.slice(-contextLines);
      }
    } else {
      // 变更行
      if (!currentHunk) {
        // 开始新的 hunk
        const oldStart = line.oldLineNumber || 0;
        const newStart = line.newLineNumber || 0;

        currentHunk = {
          oldStart: Math.max(1, oldStart - contextBuffer.length),
          oldLines: 0,
          newStart: Math.max(1, newStart - contextBuffer.length),
          newLines: 0,
          lines: [...contextBuffer],
        };
        hunks.push(currentHunk);
      }

      currentHunk.lines.push(line);

      if (line.type === 'delete' || line.type === 'modify') {
        currentHunk.oldLines++;
      }
      if (line.type === 'add' || line.type === 'modify') {
        currentHunk.newLines++;
      }

      contextBuffer = [];
    }
  }

  // 添加最后的上下文
  if (currentHunk && contextBuffer.length > 0) {
    currentHunk.lines.push(...contextBuffer.slice(0, contextLines));
  }

  return hunks;
}

/**
 * 格式化行号
 */
function formatLineNumber(num: number | undefined, width: number): string {
  if (num === undefined) return ' '.repeat(width);
  return num.toString().padStart(width, ' ');
}

/**
 * 截断过长的行
 */
function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return line.substring(0, maxLength - 3) + '...';
}

/**
 * Unified Diff 视图组件
 */
const UnifiedView: React.FC<{
  hunks: DiffHunk[];
  showLineNumbers: boolean;
  maxWidth: number;
}> = ({ hunks, showLineNumbers, maxWidth }) => {
  const lineNumberWidth = 4;

  return (
    <Box flexDirection="column">
      {hunks.map((hunk, hunkIndex) => (
        <Box key={hunkIndex} flexDirection="column">
          {/* Hunk 头部 */}
          <Box marginY={1}>
            <Text color="cyan" bold>
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </Text>
          </Box>

          {/* Hunk 内容 */}
          {hunk.lines.map((line, lineIndex) => {
            const key = `${hunkIndex}-${lineIndex}`;

            if (line.type === 'context') {
              return (
                <Box key={key}>
                  {showLineNumbers && (
                    <>
                      <Text color="gray" dimColor>
                        {formatLineNumber(line.oldLineNumber, lineNumberWidth)}
                      </Text>
                      <Text> </Text>
                      <Text color="gray" dimColor>
                        {formatLineNumber(line.newLineNumber, lineNumberWidth)}
                      </Text>
                      <Text> </Text>
                    </>
                  )}
                  <Text>  {truncateLine(line.content || '', maxWidth)}</Text>
                </Box>
              );
            }

            if (line.type === 'add') {
              return (
                <Box key={key}>
                  {showLineNumbers && (
                    <>
                      <Text color="gray" dimColor>
                        {formatLineNumber(undefined, lineNumberWidth)}
                      </Text>
                      <Text> </Text>
                      <Text color="green">
                        {formatLineNumber(line.newLineNumber, lineNumberWidth)}
                      </Text>
                      <Text> </Text>
                    </>
                  )}
                  <Text color="green">+ {truncateLine(line.newContent || '', maxWidth)}</Text>
                </Box>
              );
            }

            if (line.type === 'delete') {
              return (
                <Box key={key}>
                  {showLineNumbers && (
                    <>
                      <Text color="red">
                        {formatLineNumber(line.oldLineNumber, lineNumberWidth)}
                      </Text>
                      <Text> </Text>
                      <Text color="gray" dimColor>
                        {formatLineNumber(undefined, lineNumberWidth)}
                      </Text>
                      <Text> </Text>
                    </>
                  )}
                  <Text color="red">- {truncateLine(line.oldContent || '', maxWidth)}</Text>
                </Box>
              );
            }

            if (line.type === 'modify') {
              return (
                <Box key={key} flexDirection="column">
                  <Box>
                    {showLineNumbers && (
                      <>
                        <Text color="red">
                          {formatLineNumber(line.oldLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                        <Text color="gray" dimColor>
                          {formatLineNumber(undefined, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text color="red">- {truncateLine(line.oldContent || '', maxWidth)}</Text>
                  </Box>
                  <Box>
                    {showLineNumbers && (
                      <>
                        <Text color="gray" dimColor>
                          {formatLineNumber(undefined, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                        <Text color="green">
                          {formatLineNumber(line.newLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text color="green">+ {truncateLine(line.newContent || '', maxWidth)}</Text>
                  </Box>
                </Box>
              );
            }

            return null;
          })}
        </Box>
      ))}
    </Box>
  );
};

/**
 * Side-by-Side Diff 视图组件
 */
const SideBySideView: React.FC<{
  hunks: DiffHunk[];
  showLineNumbers: boolean;
  maxWidth: number;
}> = ({ hunks, showLineNumbers, maxWidth }) => {
  const lineNumberWidth = 4;
  const halfWidth = Math.floor((maxWidth - lineNumberWidth * 4 - 8) / 2);

  return (
    <Box flexDirection="column">
      {/* 头部 */}
      <Box marginBottom={1}>
        <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
          <Text color="red" bold>
            {t('diff.original')}
          </Text>
        </Box>
        <Text> │ </Text>
        <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
          <Text color="green" bold>
            {t('diff.modified')}
          </Text>
        </Box>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text color="gray">
          {'─'.repeat(maxWidth)}
        </Text>
      </Box>

      {/* 内容 */}
      {hunks.map((hunk, hunkIndex) => (
        <Box key={hunkIndex} flexDirection="column">
          {/* Hunk 头部 */}
          <Box marginY={1}>
            <Text color="cyan" bold>
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </Text>
          </Box>

          {/* Hunk 内容 */}
          {hunk.lines.map((line, lineIndex) => {
            const key = `${hunkIndex}-${lineIndex}`;

            if (line.type === 'context') {
              return (
                <Box key={key}>
                  {/* 左侧 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="gray" dimColor>
                          {formatLineNumber(line.oldLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text>{truncateLine(line.content || '', halfWidth)}</Text>
                  </Box>

                  <Text> │ </Text>

                  {/* 右侧 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="gray" dimColor>
                          {formatLineNumber(line.newLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text>{truncateLine(line.content || '', halfWidth)}</Text>
                  </Box>
                </Box>
              );
            }

            if (line.type === 'delete') {
              return (
                <Box key={key}>
                  {/* 左侧 - 删除的行 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="red">
                          {formatLineNumber(line.oldLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text color="red" backgroundColor="rgb(70,20,20)">
                      {truncateLine(line.oldContent || '', halfWidth)}
                    </Text>
                  </Box>

                  <Text> │ </Text>

                  {/* 右侧 - 空 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="gray" dimColor>
                          {formatLineNumber(undefined, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                  </Box>
                </Box>
              );
            }

            if (line.type === 'add') {
              return (
                <Box key={key}>
                  {/* 左侧 - 空 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="gray" dimColor>
                          {formatLineNumber(undefined, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                  </Box>

                  <Text> │ </Text>

                  {/* 右侧 - 新增的行 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="green">
                          {formatLineNumber(line.newLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text color="green" backgroundColor="rgb(20,70,20)">
                      {truncateLine(line.newContent || '', halfWidth)}
                    </Text>
                  </Box>
                </Box>
              );
            }

            if (line.type === 'modify') {
              return (
                <Box key={key}>
                  {/* 左侧 - 修改前 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="red">
                          {formatLineNumber(line.oldLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text color="red" backgroundColor="rgb(70,20,20)">
                      {truncateLine(line.oldContent || '', halfWidth)}
                    </Text>
                  </Box>

                  <Text> │ </Text>

                  {/* 右侧 - 修改后 */}
                  <Box width={halfWidth + (showLineNumbers ? lineNumberWidth + 2 : 0)}>
                    {showLineNumbers && (
                      <>
                        <Text color="green">
                          {formatLineNumber(line.newLineNumber, lineNumberWidth)}
                        </Text>
                        <Text> </Text>
                      </>
                    )}
                    <Text color="green" backgroundColor="rgb(20,70,20)">
                      {truncateLine(line.newContent || '', halfWidth)}
                    </Text>
                  </Box>
                </Box>
              );
            }

            return null;
          })}
        </Box>
      ))}
    </Box>
  );
};

/**
 * DiffView 主组件
 */
export const DiffView: React.FC<DiffViewProps> = ({
  oldContent,
  newContent,
  fileName,
  mode = 'unified',
  contextLines = 3,
  showLineNumbers = true,
  language,
  maxWidth = 120,
}) => {
  // 计算 diff
  const { diffLines, hunks, stats } = useMemo(() => {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines = computeDiff(oldLines, newLines);
    const hunks = createHunks(diffLines, contextLines);

    // 统计信息
    const stats = {
      additions: diffLines.filter(l => l.type === 'add' || l.type === 'modify').length,
      deletions: diffLines.filter(l => l.type === 'delete' || l.type === 'modify').length,
      changes: hunks.length,
    };

    return { diffLines, hunks, stats };
  }, [oldContent, newContent, contextLines]);

  return (
    <Box flexDirection="column">
      {/* 文件头部 */}
      {fileName && (
        <Box marginBottom={1}>
          <Text bold>{t('diff.file')}</Text>
          <Text color="cyan">{fileName}</Text>
          {language && (
            <>
              <Text> </Text>
              <Text color="gray" dimColor>
                ({language})
              </Text>
            </>
          )}
        </Box>
      )}

      {/* 统计信息 */}
      <Box marginBottom={1}>
        <Text color="green">+{stats.additions}</Text>
        <Text> </Text>
        <Text color="red">-{stats.deletions}</Text>
        <Text> </Text>
        <Text color="gray" dimColor>
          ({stats.changes === 1 ? t('diff.change', { count: stats.changes }) : t('diff.changes', { count: stats.changes })})
        </Text>
      </Box>

      {/* 内容区域 */}
      {hunks.length === 0 ? (
        <Box>
          <Text color="gray" dimColor>
            {t('diff.noChanges')}
          </Text>
        </Box>
      ) : mode === 'unified' ? (
        <UnifiedView hunks={hunks} showLineNumbers={showLineNumbers} maxWidth={maxWidth} />
      ) : (
        <SideBySideView hunks={hunks} showLineNumbers={showLineNumbers} maxWidth={maxWidth} />
      )}
    </Box>
  );
};

export default DiffView;
