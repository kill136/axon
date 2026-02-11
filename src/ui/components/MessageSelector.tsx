/**
 * MessageSelector 组件
 * 用于选择要回退到的消息点
 *
 * 官方 Rewind 功能的 UI 实现
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RewindableMessage, RewindOption } from '../../rewind/rewindManager.js';
import { convertFullwidthToHalfwidth, charToDigit } from '../../utils/index.js';
import { t } from '../../i18n/index.js';

interface MessageSelectorProps {
  /** 可回退的消息列表 */
  messages: RewindableMessage[];
  /** 当用户选择消息后的回调 */
  onSelect: (messageId: string) => void;
  /** 当用户取消选择的回调 */
  onCancel: () => void;
  /** 标题 */
  title?: string;
  /** 当前会话的总消息数 */
  totalMessages?: number;
}

interface RewindOptionSelectorProps {
  /** 选中的消息 */
  message: RewindableMessage;
  /** 回退预览信息 */
  preview: {
    filesWillChange: string[];
    messagesWillRemove: number;
    insertions: number;
    deletions: number;
  };
  /** 选择回退选项后的回调 */
  onSelect: (option: RewindOption) => void;
  /** 返回消息列表的回调 */
  onBack: () => void;
}

/**
 * 消息列表选择器
 */
export function MessageSelector({
  messages,
  onSelect,
  onCancel,
  title = t('rewind.selectTitle'),
  totalMessages = 0,
}: MessageSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(messages.length - 1);

  // 反转列表，最新的在最上面
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);

  useInput((input, key) => {
    // 将全角字符转换为半角字符（支持日语 IME 输入）
    const normalizedInput = convertFullwidthToHalfwidth(input);

    if (key.upArrow || normalizedInput === 'k') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || normalizedInput === 'j') {
      setSelectedIndex((prev) => Math.min(reversedMessages.length - 1, prev + 1));
    } else if (key.return) {
      const selected = reversedMessages[selectedIndex];
      if (selected) {
        onSelect(selected.uuid);
      }
    } else if (key.escape || normalizedInput === 'q') {
      onCancel();
    } else {
      // 支持数字键快速选择（1-9 选择对应消息，支持全角数字）
      const digit = charToDigit(normalizedInput);
      if (digit >= 1 && digit <= 9 && digit <= reversedMessages.length) {
        const selected = reversedMessages[digit - 1];
        if (selected) {
          setSelectedIndex(digit - 1);
          onSelect(selected.uuid);
        }
      }
    }
  });

  // 如果没有可回退的消息
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">{t('rewind.noMessages')}</Text>
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {t('rewind.pressEsc')}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {title}
        </Text>
      </Box>

      {/* 统计信息 */}
      <Box marginBottom={1}>
        <Text color="gray" dimColor>
          {t('rewind.rewindPoints', { count: reversedMessages.length })} · {t('rewind.totalMessages', { count: totalMessages })}
        </Text>
      </Box>

      {/* 消息列表 */}
      <Box flexDirection="column">
        {reversedMessages.map((msg, index) => {
          const isSelected = index === selectedIndex;
          const relativeIndex = reversedMessages.length - index;

          return (
            <Box key={msg.uuid} flexDirection="column">
              <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                  {isSelected ? '❯ ' : '  '}
                </Text>
                <Text color={isSelected ? 'white' : 'gray'}>
                  {relativeIndex}.{' '}
                </Text>
                <Text
                  color={isSelected ? 'cyan' : 'white'}
                  bold={isSelected}
                >
                  {msg.preview}
                </Text>
                {msg.hasFileChanges && (
                  <Text color="yellow"> [files]</Text>
                )}
              </Box>

              {/* 显示更多信息（选中时） */}
              {isSelected && msg.timestamp && (
                <Box marginLeft={4}>
                  <Text color="gray" dimColor>
                    {formatTimestamp(msg.timestamp)}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 帮助提示 */}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray" dimColor>
          {t('rewind.navHint')}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * 回退选项选择器
 */
export function RewindOptionSelector({
  message,
  preview,
  onSelect,
  onBack,
}: RewindOptionSelectorProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 构建选项列表
  const options: Array<{ value: RewindOption; label: string; description: string; disabled?: boolean }> = [
    {
      value: 'both',
      label: t('rewind.optionBoth'),
      description: t('rewind.optionBothDesc', { fileCount: preview.filesWillChange.length, msgCount: preview.messagesWillRemove }),
    },
    {
      value: 'code',
      label: t('rewind.optionCode'),
      description: t('rewind.optionCodeDesc', { fileCount: preview.filesWillChange.length, insertions: preview.insertions, deletions: preview.deletions }),
      disabled: preview.filesWillChange.length === 0,
    },
    {
      value: 'conversation',
      label: t('rewind.optionConversation'),
      description: t('rewind.optionConversationDesc', { count: preview.messagesWillRemove }),
      disabled: preview.messagesWillRemove === 0,
    },
    {
      value: 'nevermind',
      label: t('rewind.optionCancel'),
      description: t('rewind.optionCancelDesc'),
    },
  ];

  const enabledOptions = options.filter(o => !o.disabled);

  useInput((input, key) => {
    // 将全角字符转换为半角字符（支持日语 IME 输入）
    const normalizedInput = convertFullwidthToHalfwidth(input);

    if (key.upArrow || normalizedInput === 'k') {
      setSelectedIndex((prev) => {
        let newIndex = prev - 1;
        if (newIndex < 0) newIndex = enabledOptions.length - 1;
        return newIndex;
      });
    } else if (key.downArrow || normalizedInput === 'j') {
      setSelectedIndex((prev) => {
        let newIndex = prev + 1;
        if (newIndex >= enabledOptions.length) newIndex = 0;
        return newIndex;
      });
    } else if (key.return) {
      const selected = enabledOptions[selectedIndex];
      if (selected) {
        onSelect(selected.value);
      }
    } else if (key.escape) {
      onBack();
    } else {
      // 支持数字键快速选择（1-9 选择对应选项，支持全角数字）
      const digit = charToDigit(normalizedInput);
      if (digit >= 1 && digit <= 9 && digit <= enabledOptions.length) {
        const selected = enabledOptions[digit - 1];
        if (selected) {
          setSelectedIndex(digit - 1);
          onSelect(selected.value);
        }
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          {t('rewind.toMessage')}
        </Text>
      </Box>

      {/* 消息预览 */}
      <Box marginBottom={1} paddingLeft={2}>
        <Text color="white">"{message.preview}"</Text>
      </Box>

      {/* 预览信息 */}
      {preview.filesWillChange.length > 0 && (
        <Box marginBottom={1} flexDirection="column" paddingLeft={2}>
          <Text color="yellow">
            {t('rewind.filesWillChange', { count: preview.filesWillChange.length })}
          </Text>
          {preview.filesWillChange.slice(0, 5).map((file, i) => (
            <Text key={i} color="gray" dimColor>
              {'  '}{file}
            </Text>
          ))}
          {preview.filesWillChange.length > 5 && (
            <Text color="gray" dimColor>
              {'  '}{t('rewind.andMore', { count: preview.filesWillChange.length - 5 })}
            </Text>
          )}
        </Box>
      )}

      {/* 选项列表 */}
      <Box flexDirection="column" marginTop={1}>
        <Text color="gray" dimColor>
          {t('rewind.chooseOption')}
        </Text>
        {options.map((option, index) => {
          const enabledIndex = enabledOptions.findIndex(o => o.value === option.value);
          const isSelected = enabledIndex === selectedIndex;
          const isDisabled = option.disabled;

          return (
            <Box key={option.value} flexDirection="column">
              <Box>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                  {isSelected ? '❯ ' : '  '}
                </Text>
                <Text
                  color={isDisabled ? 'gray' : isSelected ? 'cyan' : 'white'}
                  dimColor={isDisabled}
                  bold={isSelected}
                >
                  {option.label}
                </Text>
                {isDisabled && (
                  <Text color="gray" dimColor>
                    {' '}{t('rewind.noChanges')}
                  </Text>
                )}
              </Box>
              {isSelected && !isDisabled && (
                <Box marginLeft={4}>
                  <Text color="gray" dimColor>
                    {option.description}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 帮助提示 */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {t('rewind.confirmHint')}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * 完整的 Rewind UI（组合消息选择器和选项选择器）
 */
interface RewindUIProps {
  /** 可回退的消息列表 */
  messages: RewindableMessage[];
  /** 总消息数 */
  totalMessages: number;
  /** 获取预览信息的函数 */
  getPreview: (messageId: string, option: RewindOption) => {
    filesWillChange: string[];
    messagesWillRemove: number;
    insertions: number;
    deletions: number;
  };
  /** 执行回退的回调 */
  onRewind: (messageId: string, option: RewindOption) => Promise<void>;
  /** 取消回退的回调 */
  onCancel: () => void;
}

type RewindUIState =
  | { step: 'select-message' }
  | { step: 'select-option'; messageId: string; message: RewindableMessage }
  | { step: 'executing'; messageId: string; option: RewindOption }
  | { step: 'done'; success: boolean; message: string };

export function RewindUI({
  messages,
  totalMessages,
  getPreview,
  onRewind,
  onCancel,
}: RewindUIProps) {
  const [state, setState] = useState<RewindUIState>({ step: 'select-message' });

  const handleSelectMessage = (messageId: string) => {
    const message = messages.find(m => m.uuid === messageId);
    if (message) {
      setState({ step: 'select-option', messageId, message });
    }
  };

  const handleSelectOption = async (option: RewindOption) => {
    if (state.step !== 'select-option') return;

    if (option === 'nevermind') {
      onCancel();
      return;
    }

    setState({ step: 'executing', messageId: state.messageId, option });

    try {
      await onRewind(state.messageId, option);
      setState({
        step: 'done',
        success: true,
        message: t('rewind.success'),
      });
    } catch (error) {
      setState({
        step: 'done',
        success: false,
        message: t('rewind.failed', { error: error instanceof Error ? error.message : String(error) }),
      });
    }
  };

  const handleBack = () => {
    setState({ step: 'select-message' });
  };

  // 渲染当前步骤
  switch (state.step) {
    case 'select-message':
      return (
        <MessageSelector
          messages={messages}
          totalMessages={totalMessages}
          onSelect={handleSelectMessage}
          onCancel={onCancel}
        />
      );

    case 'select-option':
      const preview = getPreview(state.messageId, 'both');
      return (
        <RewindOptionSelector
          message={state.message}
          preview={preview}
          onSelect={handleSelectOption}
          onBack={handleBack}
        />
      );

    case 'executing':
      return (
        <Box padding={1}>
          <Text color="cyan">
            {t('rewind.executing')}
          </Text>
        </Box>
      );

    case 'done':
      return (
        <Box padding={1} flexDirection="column">
          <Text color={state.success ? 'green' : 'red'}>
            {state.success ? '✓' : '✗'} {state.message}
          </Text>
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              {t('rewind.pressAnyKey')}
            </Text>
          </Box>
        </Box>
      );

    default:
      return null;
  }
}

/**
 * 格式化时间戳
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // 不到一分钟
  if (diff < 60000) {
    return t('rewind.justNow');
  }

  // 不到一小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return t('rewind.minutesAgo', { count: minutes });
  }

  // 不到一天
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return t('rewind.hoursAgo', { count: hours });
  }

  // 超过一天
  return date.toLocaleString();
}

export default MessageSelector;
