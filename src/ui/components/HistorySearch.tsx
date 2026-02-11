/**
 * HistorySearch 组件
 * 反向历史搜索界面 (Ctrl+R)
 */

import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../../i18n/index.js';

const CLAUDE_COLOR = '#D77757';

export interface HistorySearchProps {
  /** 搜索关键词 */
  query: string;
  /** 匹配的历史记录列表 */
  matches: string[];
  /** 当前选中的索引 */
  selectedIndex: number;
  /** 是否显示 */
  visible: boolean;
}

export const HistorySearch: React.FC<HistorySearchProps> = ({
  query,
  matches,
  selectedIndex,
  visible,
}) => {
  if (!visible) return null;

  const currentMatch = matches[selectedIndex] || '';
  const matchCount = matches.length;

  // 高亮显示匹配的部分
  const renderHighlightedMatch = (text: string, highlight: string) => {
    if (!highlight) return <Text>{text}</Text>;

    const lowerText = text.toLowerCase();
    const lowerHighlight = highlight.toLowerCase();
    const index = lowerText.indexOf(lowerHighlight);

    if (index === -1) return <Text>{text}</Text>;

    const before = text.slice(0, index);
    const match = text.slice(index, index + highlight.length);
    const after = text.slice(index + highlight.length);

    return (
      <>
        <Text>{before}</Text>
        <Text backgroundColor="yellow" color="black">
          {match}
        </Text>
        <Text>{after}</Text>
      </>
    );
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* 搜索提示行 */}
      <Box>
        <Text color={CLAUDE_COLOR} bold>
          (reverse-i-search)`
        </Text>
        <Text color="cyan" bold>
          {query}
        </Text>
        <Text color={CLAUDE_COLOR} bold>
          ':
        </Text>
        {currentMatch ? (
          renderHighlightedMatch(currentMatch, query)
        ) : (
          <Text dimColor>{t('history.noMatches')}</Text>
        )}
      </Box>

      {/* 匹配计数 */}
      {matchCount > 0 && (
        <Box>
          <Text dimColor>
            [{selectedIndex + 1}/{matchCount} {t('history.matches')}]
            {matchCount > 1 && ` (${t('history.nextPrev')})`}
            {matchCount === 1 && ` (${t('history.selectCancel')})`}
          </Text>
        </Box>
      )}

      {/* 显示最近的几条匹配（最多5条） */}
      {matchCount > 1 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {matches.slice(0, 5).map((match, index) => (
            <Box key={index}>
              <Text
                backgroundColor={index === selectedIndex ? 'gray' : undefined}
                color={index === selectedIndex ? 'white' : 'dim'}
              >
                {index === selectedIndex ? '▶ ' : '  '}
                {match.length > 80 ? match.slice(0, 77) + '...' : match}
              </Text>
            </Box>
          ))}
          {matchCount > 5 && (
            <Box>
              <Text dimColor>  {t('history.andMore', { count: matchCount - 5 })}</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default HistorySearch;
