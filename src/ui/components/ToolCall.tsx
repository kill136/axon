/**
 * ToolCall 组件 - 官方简洁风格
 * 显示工具调用的状态和结果摘要
 */

import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../../i18n/index.js';

export interface ToolCallProps {
  name: string;
  status: 'running' | 'success' | 'error';
  input?: Record<string, unknown>;
  result?: string;
  error?: string;
  duration?: number;
}

/**
 * 格式化时长
 */
const formatDuration = (ms?: number): string => {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

/**
 * 解析 web_search 结果摘要 JSON
 */
const parseWebSearchSummary = (result: string): { searchCount: number; results: Array<{ title: string; url: string }> } | null => {
  try {
    const data = JSON.parse(result);
    if (data.type === 'web_search_summary') {
      return data;
    }
  } catch { /* not JSON */ }
  return null;
};

/**
 * 生成结果摘要（增强版 - 显示更多有用信息）
 */
const generateSummary = (name: string, result?: string, error?: string): string => {
  if (error) {
    // 错误信息显示更多内容
    const errorLine = error.split('\n')[0];
    return errorLine.slice(0, 120);
  }

  if (!result) {
    return '';
  }

  // WebSearch Server Tool — 对齐官方 "Did N searches in Xs" 格式
  if (name === '[Server] web_search') {
    const summary = parseWebSearchSummary(result);
    if (summary) {
      const n = summary.searchCount;
      return n !== 1 ? t('tool.didSearches', { count: n }) : t('tool.didSearch', { count: n });
    }
    // 搜索错误
    if (result.startsWith('Search error:')) {
      return result;
    }
    return '';
  }

  // 根据工具类型生成智能摘要
  const lines = result.split('\n').filter(l => l.trim());
  const firstLine = lines[0] || '';

  // Grep/Glob - 文件数量摘要，并显示前几个匹配的文件
  if (name === 'Grep' || name === 'Glob') {
    const fileCount = lines.length;
    if (fileCount === 0) return t('tool.noMatches');
    if (fileCount === 1) return t('tool.foundOneFile', { file: lines[0].slice(0, 60) });
    if (fileCount <= 3) return t('tool.foundFilesDetail', { count: fileCount, files: lines.slice(0, 3).join(', ').slice(0, 100) });
    return t('tool.foundFiles', { count: fileCount });
  }

  // Read - 行数摘要
  if (name === 'Read') {
    const lineCount = result.split('\n').length;
    if (lineCount === 0) return t('tool.emptyFile');
    if (lineCount === 1) return t('tool.readOneLine');
    return t('tool.readLines', { count: lineCount });
  }

  // Write/Edit - 成功提示
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit') {
    return t('tool.done');
  }

  // Bash - 显示第一行输出（增加长度限制）
  if (name === 'Bash') {
    if (result.trim() === '') return t('tool.noOutput');
    // 显示更多内容
    return firstLine.slice(0, 120) + (firstLine.length > 120 ? '...' : '');
  }

  // 其他工具 - 显示第一行或字符数（增加限制）
  if (result.length > 120) {
    return `${result.slice(0, 120)}...`;
  }

  return firstLine || t('tool.done');
};

/**
 * 简化工具参数显示（增强版 - 显示更完整的参数信息）
 */
const formatToolInput = (name: string, input?: Record<string, unknown>): string => {
  if (!input) return '';

  // 根据工具类型提取关键参数
  switch (name) {
    case 'Read':
      if (input.file_path) {
        const path = String(input.file_path);
        // 如果有行范围，也显示出来
        const offset = Number(input.offset) || 0;
        const limit = Number(input.limit) || 0;
        const range = offset || limit
          ? `:${offset || 1}-${offset + limit}`
          : '';
        return `(${path}${range})`;
      }
      return '';

    case 'Write':
    case 'Edit':
      return input.file_path ? `(${input.file_path})` : '';

    case 'Bash':
      if (input.command) {
        const cmd = String(input.command);
        // 显示更多命令内容
        return `(${cmd.slice(0, 80)}${cmd.length > 80 ? '...' : ''})`;
      }
      return '';

    case 'Grep':
      if (input.pattern) {
        const pattern = String(input.pattern);
        const path = input.path ? ` in ${input.path}` : '';
        return `(${pattern}${path})`;
      }
      return '';

    case 'Glob':
      if (input.pattern) {
        const pattern = String(input.pattern);
        const path = input.path ? ` in ${input.path}` : '';
        return `(${pattern}${path})`;
      }
      return '';

    case 'WebFetch':
      return input.url ? `(${input.url})` : '';

    case 'Task':
      return input.description ? `(${input.description})` : '';

    case '[Server] web_search':
      // 对齐官方: 显示 "query text"
      if (input.query) {
        const query = String(input.query);
        return `("${query.slice(0, 60)}${query.length > 60 ? '...' : ''}")`;
      }
      return '';

    default:
      // 默认显示第一个参数
      const firstKey = Object.keys(input)[0];
      if (!firstKey) return '';
      const firstValue = input[firstKey];
      const valueStr = typeof firstValue === 'string'
        ? firstValue
        : JSON.stringify(firstValue);
      return `(${valueStr.slice(0, 50)}${valueStr.length > 50 ? '...' : ''})`;
  }
};

/**
 * ToolCall 组件（官方简洁风格）
 */
export const ToolCall: React.FC<ToolCallProps> = React.memo(({
  name,
  status,
  input,
  result,
  error,
  duration,
}) => {
  // 状态颜色和图标
  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'cyan';
      case 'success': return 'green';
      case 'error': return 'red';
    }
  };

  const statusColor = getStatusColor();
  const statusIcon = '•';

  // 工具名称和参数
  // 对齐官方: [Server] web_search → Web Search
  const displayName = name === '[Server] web_search' ? t('tool.webSearch') : name;
  const toolSignature = `${displayName}${formatToolInput(name, input)}`;

  // 结果摘要
  const summary = generateSummary(name, result, error);

  return (
    <Box flexDirection="column" marginY={0}>
      {/* 工具调用行：• ToolName(params)  2.3s */}
      <Box>
        <Text color={statusColor}>{statusIcon} </Text>
        <Text>{toolSignature}</Text>
        {duration && status !== 'running' && (
          <Text color="gray" dimColor>  {formatDuration(duration)}</Text>
        )}
      </Box>

      {/* 结果摘要（缩进显示）*/}
      {summary && (
        <Box marginLeft={2}>
          <Text color={status === 'error' ? 'red' : 'gray'} dimColor={status !== 'error'}>
            {summary}
          </Text>
        </Box>
      )}
    </Box>
  );
});

export default ToolCall;
