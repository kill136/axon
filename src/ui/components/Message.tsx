/**
 * Message 组件
 * 显示用户或助手消息，支持流式渲染、Markdown、代码高亮等
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import type { ContentBlock, ToolUseBlock, ToolResultBlockParam, AnyContentBlock } from '../../types/messages.js';
import { parseMarkdown, renderBlock, type MarkdownBlock } from '../markdown-renderer.js';
import { t } from '../../i18n/index.js';

export interface MessageProps {
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string | AnyContentBlock[];
  timestamp?: Date;
  streaming?: boolean; // 是否正在流式渲染中
  showCopyHint?: boolean; // 显示复制提示
  model?: string; // 使用的模型
}

// 渲染 Markdown 块组件
const MarkdownBlockComponent: React.FC<{ block: MarkdownBlock }> = ({ block }) => {
  const rendered = renderBlock(block);

  // 渲染的内容已经包含 ANSI 颜色代码，直接显示
  return (
    <Text>
      {rendered}
    </Text>
  );
};

// 工具调用块组件
const ToolUseBlockComponent: React.FC<{ block: ToolUseBlock }> = ({ block }) => {
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color="magenta" bold>
          🔧 {block.name}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray" dimColor>
          {JSON.stringify(block.input, null, 2).slice(0, 200)}
          {JSON.stringify(block.input).length > 200 ? '...' : ''}
        </Text>
      </Box>
    </Box>
  );
};

// 工具结果块组件
const ToolResultBlockComponent: React.FC<{ block: ToolResultBlockParam }> = ({ block }) => {
  const contentStr = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
  const isError = block.is_error || contentStr?.toLowerCase().includes('error');
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color={isError ? 'red' : 'green'}>
          {isError ? '✗' : '✓'} {t('message.toolResult')}
        </Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="gray" dimColor>
          {contentStr ? contentStr.slice(0, 200) : ''}
          {contentStr && contentStr.length > 200 ? '...' : ''}
        </Text>
      </Box>
    </Box>
  );
};

// 合并连续的 text blocks（解决流式消息被拆分成多个小块的问题）
const mergeTextBlocks = (blocks: AnyContentBlock[]): AnyContentBlock[] => {
  // v2.1.12: 边界检查
  if (!blocks || blocks.length === 0) {
    return [];
  }

  const merged: AnyContentBlock[] = [];
  let currentText = '';

  for (const block of blocks) {
    // v2.1.12: 跳过 null/undefined blocks
    if (!block) {
      continue;
    }

    if (block.type === 'text') {
      // 累积文本
      currentText += (block as { text?: string }).text || '';
    } else {
      // 遇到非文本块，先保存累积的文本
      if (currentText) {
        merged.push({ type: 'text', text: currentText } as AnyContentBlock);
        currentText = '';
      }
      merged.push(block);
    }
  }

  // 保存最后的文本块
  if (currentText) {
    merged.push({ type: 'text', text: currentText } as AnyContentBlock);
  }

  return merged;
};

// 渲染内容块
const renderContentBlocks = (blocks: AnyContentBlock[]) => {
  // v2.1.12: 处理空数组边界情况
  if (!blocks || blocks.length === 0) {
    return null;
  }

  // 先合并连续的 text blocks
  const mergedBlocks = mergeTextBlocks(blocks);

  return mergedBlocks.map((block, index) => {
    // v2.1.12: 跳过 null/undefined blocks
    if (!block) {
      return null;
    }

    switch (block.type) {
      case 'text':
        return <Text key={index}>{(block as { text?: string }).text || ''}</Text>;
      case 'tool_use':
        return <ToolUseBlockComponent key={index} block={block as ToolUseBlock} />;
      case 'tool_result':
        return <ToolResultBlockComponent key={index} block={block as ToolResultBlockParam} />;
      default:
        return null;
    }
  });
};

export const Message: React.FC<MessageProps> = React.memo(({
  role,
  content,
  timestamp,
  streaming = false,
  showCopyHint = false,
  model,
}) => {
  const isUser = role === 'user';
  const isSystem = role === 'system';
  const isError = role === 'error';

  // 获取纯文本内容（直接显示，无模拟）
  const getTextContent = (): string => {
    if (typeof content === 'string') {
      return content;
    }
    // 从 ContentBlock 数组中提取文本
    return content
      .map(block => {
        if (block.type === 'text') return block.text || '';
        return '';
      })
      .join('\n');
  };

  const displayedContent = getTextContent();

  // 渲染角色标签 - 官方风格
  const getRoleLabel = () => {
    if (isUser) return t('message.you');
    if (isSystem) return t('message.system');
    if (isError) return t('message.error');
    return t('message.claude');
  };

  const getRoleColor = () => {
    if (isUser) return 'blue';
    if (isSystem) return 'cyan';
    if (isError) return 'red';
    return 'green';
  };

  // 获取时间字符串
  const getTimeString = () => {
    if (!timestamp) return '';
    return timestamp.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 用户消息 - 官方风格（只显示 > 符号，内容在同一行）
  // 优先处理用户消息，无论 content 是字符串还是数组
  if (isUser) {
    // 从 content 中提取纯文本（用户消息通常只有文本）
    const userText = typeof content === 'string'
      ? content
      : content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text || '')
          .join('\n') || displayedContent;

    return (
      <Box flexDirection="column" marginY={1}>
        <Box>
          <Text bold color="blue">{'>'}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text>{userText}</Text>
        </Box>
      </Box>
    );
  }

  // 如果内容是 ContentBlock 数组，直接渲染（助手消息支持工具调用块）
  if (typeof content !== 'string') {
    return (
      <Box flexDirection="column" marginY={1}>
        <Box flexDirection="column" marginLeft={0}>
          {renderContentBlocks(content)}
        </Box>
        {/* 流式渲染指示器 */}
        {streaming && (
          <Box marginLeft={2}>
            <Text color="gray" dimColor italic>⋯</Text>
          </Box>
        )}
      </Box>
    );
  }

  // 使用 useMemo 缓存 Markdown 解析（性能优化）
  const blocks = React.useMemo(() => {
    return parseMarkdown(displayedContent);
  }, [displayedContent]);

  // 助手消息 - 使用增强的 Markdown 渲染（官方风格：无时间戳）
  return (
    <Box flexDirection="column" marginY={1}>
      {/* 消息内容 - 使用增强的 Markdown 渲染 */}
      <Box flexDirection="column">
        {blocks.map((block, index) => (
          <MarkdownBlockComponent key={index} block={block} />
        ))}
      </Box>

      {/* 流式渲染指示器（官方风格）*/}
      {streaming && displayedContent.length > 0 && (
        <Box marginLeft={2}>
          <Text color="gray" dimColor italic>⋯</Text>
        </Box>
      )}

      {/* 复制提示 */}
      {showCopyHint && !streaming && (
        <Box marginLeft={2} marginTop={1}>
          <Text color="gray" dimColor italic>
            {t('message.copyHint')}
          </Text>
        </Box>
      )}
    </Box>
  );
});
