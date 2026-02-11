/**
 * ModelSelector 组件
 * 交互式模型选择器，显示可用模型、能力和定价信息
 */

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { modelConfig } from '../../models/config.js';
import type { ModelInfo } from '../../models/types.js';
import { convertFullwidthToHalfwidth, charToDigit } from '../../utils/index.js';
import { isThirdPartyProvider } from '../../core/client.js';
import { t } from '../../i18n/index.js';

export interface ModelSelectorProps {
  /** 当前选中的模型 ID */
  currentModel: string;
  /** 选择回调 */
  onSelect: (model: string) => void;
  /** 取消回调 */
  onCancel?: () => void;
  /** 是否显示定价信息 */
  showPricing?: boolean;
  /** 是否显示能力标签 */
  showCapabilities?: boolean;
  /** 标题 */
  title?: string;
  /** 提示文本 */
  hint?: string;
}

/**
 * 格式化上下文窗口大小
 */
function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return '1M';
  } else if (tokens >= 200_000) {
    return '200K';
  }
  return `${Math.round(tokens / 1000)}K`;
}

/**
 * 格式化定价信息
 */
function formatPricing(modelId: string): string {
  const pricing = modelConfig.getPricing(modelId);
  return `$${pricing.input}/${pricing.output} per 1M`;
}

/**
 * 获取能力标签
 */
function getCapabilityBadges(model: ModelInfo): string[] {
  const badges: string[] = [];

  if (model.supportsThinking) {
    badges.push('thinking');
  }
  if (model.supportsVision) {
    badges.push('vision');
  }
  if (model.contextWindow >= 1_000_000) {
    badges.push('1M');
  }
  if (model.supportsPdf) {
    badges.push('pdf');
  }

  return badges;
}

/**
 * 模型选择器组件
 */
export function ModelSelector({
  currentModel,
  onSelect,
  onCancel,
  // v2.1.31: 第三方 provider（Bedrock、Vertex、Foundry）不显示 Anthropic API 定价
  showPricing = !isThirdPartyProvider(),
  showCapabilities = true,
  title = t('model.selectTitle'),
  hint = t('model.navHint'),
}: ModelSelectorProps) {
  // 获取主要模型列表（4.5 系列）
  const models = useMemo(() => {
    const allModels = modelConfig.getAllModels();
    // 优先显示 4.5 系列模型
    return allModels
      .filter((m) =>
        m.id.includes('4-5') ||
        m.id === currentModel
      )
      .sort((a, b) => {
        // 排序：opus > sonnet > haiku
        const familyOrder = { opus: 0, sonnet: 1, haiku: 2 };
        const orderA = familyOrder[a.family];
        const orderB = familyOrder[b.family];
        if (orderA !== orderB) return orderA - orderB;
        // 相同家族按发布日期降序
        return (b.releaseDate || '').localeCompare(a.releaseDate || '');
      });
  }, [currentModel]);

  // 查找当前模型的索引
  const currentModelIndex = models.findIndex((m) => m.id === currentModel);
  const initialIndex = currentModelIndex >= 0 ? currentModelIndex : 0;

  const [selectedIndex, setSelectedIndex] = useState(initialIndex);

  // 处理键盘输入
  useInput((input, key) => {
    // 将全角字符转换为半角字符（支持日语 IME 输入）
    const normalizedInput = convertFullwidthToHalfwidth(input);

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : models.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < models.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const selectedModel = models[selectedIndex];
      if (selectedModel) {
        onSelect(selectedModel.id);
      }
    } else if (key.escape && onCancel) {
      onCancel();
    } else {
      // 支持数字键快速选择（1-9 选择对应模型，支持全角数字）
      const digit = charToDigit(normalizedInput);
      if (digit >= 1 && digit <= 9 && digit <= models.length) {
        const targetModel = models[digit - 1];
        if (targetModel) {
          setSelectedIndex(digit - 1);
          onSelect(targetModel.id);
        }
      }
    }
  });

  return (
    <Box flexDirection="column">
      {/* 标题 */}
      {title && (
        <Box marginBottom={1}>
          <Text color="cyan" bold>
            {title}
          </Text>
        </Box>
      )}

      {/* 模型列表 */}
      {models.map((model, index) => {
        const isSelected = index === selectedIndex;
        const isCurrent = model.id === currentModel;
        const badges = getCapabilityBadges(model);

        return (
          <Box key={model.id} marginBottom={0}>
            <Box width={40}>
              {/* 选择指示器 */}
              <Text color={isSelected ? 'cyan' : 'gray'}>
                {isSelected ? '> ' : '  '}
              </Text>

              {/* 当前模型标记 */}
              <Text color={isCurrent ? 'green' : isSelected ? 'cyan' : 'white'}>
                {isCurrent ? '[x] ' : '[ ] '}
              </Text>

              {/* 模型名称 */}
              <Text
                color={isSelected ? 'cyan' : 'white'}
                bold={isSelected || isCurrent}
              >
                {model.displayName}
              </Text>
            </Box>

            {/* 定价信息 */}
            {showPricing && (
              <Box width={20} marginLeft={1}>
                <Text color={isSelected ? 'yellow' : 'gray'}>
                  [{formatPricing(model.id)}]
                </Text>
              </Box>
            )}

            {/* 能力标签 */}
            {showCapabilities && badges.length > 0 && (
              <Box marginLeft={1}>
                {badges.map((badge, i) => (
                  <Text key={badge} color={isSelected ? 'green' : 'gray'}>
                    [{badge}]{i < badges.length - 1 ? ' ' : ''}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        );
      })}

      {/* 提示信息 */}
      {hint && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            {hint}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default ModelSelector;
