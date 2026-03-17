/**
 * Header 组件
 * 仿官方 Axon 的头部样式
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { isDemoMode } from '../../utils/env-check.js';
import { t } from '../../i18n/index.js';

// 官方 claude 颜色 (clawd_body)
const AXON_COLOR = '#D77757'; // rgb(215,119,87)

/**
 * PR 审核状态类型
 * v2.1.27: 添加 PR 状态显示
 */
export type PRReviewState = 'approved' | 'changes_requested' | 'pending' | 'draft' | null;

/**
 * PR 状态信息
 */
export interface PRStatusInfo {
  number: number | null;
  url: string | null;
  reviewState: PRReviewState;
}

interface HeaderProps {
  version: string;
  model: string;
  cwd?: string;
  username?: string;
  apiType?: string;
  organization?: string;
  isCompact?: boolean;
  isPlanMode?: boolean;
  connectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'error';
  showShortcutHint?: boolean;
  hasUpdate?: boolean;
  latestVersion?: string;
  // 后台任务计数
  backgroundTaskCount?: number;
  runningTaskCount?: number;
  // v2.1.27: PR 状态
  prStatus?: PRStatusInfo;
}

export const Header: React.FC<HeaderProps> = React.memo(({
  version,
  model,
  cwd,
  username,
  apiType = 'Claude API',
  organization,
  isCompact = false,
  isPlanMode = false,
  connectionStatus = 'connected',
  showShortcutHint = true,
  hasUpdate = false,
  latestVersion,
  backgroundTaskCount = 0,
  runningTaskCount = 0,
  prStatus,
}) => {
  // 连接状态指示器
  const getConnectionIndicator = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Text color="green">●</Text>;
      case 'connecting':
        return <Text color="yellow">●</Text>;
      case 'disconnected':
        return <Text color="gray" dimColor>●</Text>;
      case 'error':
        return <Text color="red">●</Text>;
      default:
        return null;
    }
  };

  const getConnectionLabel = () => {
    switch (connectionStatus) {
      case 'connected':
        return t('header.connected');
      case 'connecting':
        return t('header.connecting');
      case 'disconnected':
        return t('header.disconnected');
      case 'error':
        return t('header.connectionError');
      default:
        return '';
    }
  };

  // v2.1.27: PR 状态颜色
  const getPRStatusColor = (state: PRReviewState): string => {
    switch (state) {
      case 'approved':
        return 'green';
      case 'changes_requested':
        return 'red';
      case 'pending':
        return 'yellow';
      case 'draft':
        return 'gray';
      default:
        return 'gray';
    }
  };

  // v2.1.27: 渲染状态指示器（后台任务 + PR 状态）
  // 修复：确保后台任务指示器不会与 PR 状态一起重复显示
  const renderStatusIndicators = () => {
    const indicators: React.ReactNode[] = [];

    // 后台任务指示器（只显示一次）
    if (backgroundTaskCount > 0) {
      indicators.push(
        <React.Fragment key="bg-task">
          <Text color={runningTaskCount > 0 ? 'yellow' : 'blue'}>
            {runningTaskCount > 0 ? '🔄' : '✓'} {backgroundTaskCount > 1 ? t('header.tasks', { count: backgroundTaskCount }) : t('header.task', { count: backgroundTaskCount })}
          </Text>
        </React.Fragment>
      );
    }

    // PR 状态指示器
    if (prStatus?.reviewState && prStatus?.number) {
      indicators.push(
        <React.Fragment key="pr-status">
          <Text color={getPRStatusColor(prStatus.reviewState)}>●</Text>
          <Text dimColor> PR #{prStatus.number}</Text>
        </React.Fragment>
      );
    }

    return indicators.map((indicator, index) => (
      <React.Fragment key={index}>
        {indicator}
        {index < indicators.length - 1 && <Text dimColor> · </Text>}
      </React.Fragment>
    ));
  };

  // 紧凑模式 - 对话开始后显示的简洁头部
  if (isCompact) {
    return (
      <Box marginBottom={1} paddingX={1} justifyContent="space-between">
        <Box>
          <Text color={AXON_COLOR} bold>
            Axon
          </Text>
          <Text dimColor> v{version}</Text>
          {isPlanMode && (
            <Text dimColor>-restored</Text>
          )}
          <Text dimColor> · </Text>
          <Text color="cyan">{model}</Text>
          {apiType && apiType !== 'Claude API' && (
            <>
              <Text dimColor> · </Text>
              <Text color="white">{apiType}</Text>
            </>
          )}
          {isPlanMode && (
            <>
              <Text dimColor> · </Text>
              <Text color="magenta" bold>📋 {t('header.planMode')}</Text>
            </>
          )}
          {cwd && (
            <>
              <Text dimColor> · </Text>
              <Text dimColor>{cwd}</Text>
            </>
          )}
        </Box>
        <Box>
          {hasUpdate && latestVersion && (
            <>
              <Text color="green">🎉 {t('header.updateAvailableShort', { version: latestVersion })}</Text>
              <Text dimColor> · </Text>
            </>
          )}
          {/* v2.1.27: 状态指示器（后台任务 + PR 状态，修复重复显示问题） */}
          {renderStatusIndicators()}
          {(backgroundTaskCount > 0 || prStatus?.reviewState) && <Text dimColor> · </Text>}
          {getConnectionIndicator()}
          <Text dimColor> {getConnectionLabel()}</Text>
        </Box>
      </Box>
    );
  }

  // 完整模式 - 带边框的头部 (用于没有欢迎屏幕时)
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isPlanMode ? 'magenta' : AXON_COLOR}
      paddingX={2}
      paddingY={1}
    >
      {/* 标题行 */}
      <Box justifyContent="space-between">
        <Box>
          <Text color={AXON_COLOR} bold>
            Axon
          </Text>
          <Text dimColor> v{version}</Text>
          {hasUpdate && latestVersion && (
            <>
              <Text dimColor> · </Text>
              <Text color="green" bold>{t('header.updateAvailable', { version: latestVersion })}</Text>
            </>
          )}
        </Box>
        <Box>
          {username && (
            <>
              <Text bold>{t('header.welcomeBack', { username })}</Text>
              <Text dimColor> · </Text>
            </>
          )}
          {/* v2.1.27: 状态指示器（后台任务 + PR 状态，修复重复显示问题） */}
          {renderStatusIndicators()}
          {(backgroundTaskCount > 0 || prStatus?.reviewState) && <Text dimColor> · </Text>}
          {getConnectionIndicator()}
          <Text dimColor> {getConnectionLabel()}</Text>
        </Box>
      </Box>

      {/* 计划模式指示器 */}
      {isPlanMode && (
        <Box
          marginTop={1}
          paddingX={1}
          borderStyle="single"
          borderColor="magenta"
        >
          <Text color="magenta" bold>
            📋 {t('header.planModeActive')}
          </Text>
          <Text dimColor> - {t('header.planModeHint')}</Text>
        </Box>
      )}

      {/* 模型和 API 信息 */}
      <Box marginTop={1} justifyContent="space-between">
        <Box>
          <Text color="cyan">{model}</Text>
          <Text dimColor> · </Text>
          <Text dimColor>{apiType}</Text>
          {/* IS_DEMO 模式下隐藏组织名称 - 官网实现: !process.env.IS_DEMO && D.oauthAccount?.organizationName */}
          {organization && !isDemoMode() && (
            <>
              <Text dimColor> · </Text>
              <Text dimColor>{organization}</Text>
            </>
          )}
        </Box>
        {showShortcutHint && (
          <Text color="gray" dimColor>
            {t('header.pressForShortcuts')}
          </Text>
        )}
      </Box>

      {/* 工作目录 */}
      {cwd && (
        <Box marginTop={1}>
          <Text dimColor>📁 {cwd}</Text>
        </Box>
      )}

      {/* 更新通知 */}
      {hasUpdate && latestVersion && (
        <Box
          marginTop={1}
          paddingX={1}
          borderStyle="single"
          borderColor="green"
        >
          <Text color="green">
            🎉 {t('header.newVersionAvailable')}
          </Text>
          <Text color="green" bold> npm install -g axon-code</Text>
        </Box>
      )}
    </Box>
  );
});

export default Header;
