/**
 * LSP 初始化进度组件
 * 显示 LSP 服务器的安装和启动进度
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from './ProgressBar.js';
import { Spinner } from './Spinner.js';
import { t } from '../../i18n/index.js';
import { LSPManager, ProgressEvent, InstallStatus, LSP_SERVERS } from '../../parser/lsp/lsp-manager.js';

export interface LSPInitProgressProps {
  /** LSP 管理器 */
  manager: LSPManager;
  /** 需要初始化的语言列表 */
  languages: string[];
  /** 初始化完成回调 */
  onComplete?: () => void;
  /** 初始化失败回调 */
  onError?: (error: Error) => void;
  /** 是否显示详细信息 */
  verbose?: boolean;
}

interface LanguageProgress {
  language: string;
  serverName: string;
  status: InstallStatus;
  message: string;
  progress: number;
}

/**
 * LSP 初始化进度显示
 */
export const LSPInitProgress: React.FC<LSPInitProgressProps> = ({
  manager,
  languages,
  onComplete,
  onError,
  verbose = false,
}) => {
  const [progress, setProgress] = useState<Map<string, LanguageProgress>>(new Map());
  const [isComplete, setIsComplete] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentLanguage, setCurrentLanguage] = useState<string | null>(null);

  useEffect(() => {
    // 初始化进度状态
    const initial = new Map<string, LanguageProgress>();
    for (const lang of languages) {
      const server = LSP_SERVERS[lang];
      initial.set(lang, {
        language: lang,
        serverName: server?.name || lang,
        status: 'checking',
        message: t('lsp.waiting'),
        progress: 0,
      });
    }
    setProgress(initial);

    // 监听进度事件
    const handleProgress = (event: ProgressEvent) => {
      setProgress((prev) => {
        const next = new Map(prev);
        const current = next.get(event.language);
        if (current) {
          next.set(event.language, {
            ...current,
            status: event.status,
            message: event.message,
            progress: event.progress ?? (event.status === 'installed' ? 100 : current.progress),
          });
        }
        return next;
      });

      if (event.status === 'installing' || event.status === 'checking') {
        setCurrentLanguage(event.language);
      }

      // 计算总体进度
      setProgress((prev) => {
        let total = 0;
        for (const p of prev.values()) {
          if (p.status === 'installed' || p.status === 'skipped') {
            total += 100;
          } else if (p.status === 'failed') {
            total += 100; // 失败也算完成
          } else {
            total += p.progress;
          }
        }
        setOverallProgress(Math.round(total / languages.length));
        return prev;
      });
    };

    manager.on('progress', handleProgress);

    // 开始初始化
    const init = async () => {
      try {
        await manager.initializeServers(languages);
        setIsComplete(true);
        setCurrentLanguage(null);
        if (onComplete) {
          onComplete();
        }
      } catch (error) {
        if (onError) {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    };

    init();

    return () => {
      manager.off('progress', handleProgress);
    };
  }, [manager, languages, onComplete]);

  // 获取状态图标
  const getStatusIcon = (status: InstallStatus): string => {
    switch (status) {
      case 'checking':
        return '○';
      case 'installing':
        return '◐';
      case 'installed':
        return '✓';
      case 'failed':
        return '✗';
      case 'skipped':
        return '○';
      default:
        return '○';
    }
  };

  // 获取状态颜色
  const getStatusColor = (status: InstallStatus): string => {
    switch (status) {
      case 'checking':
        return 'yellow';
      case 'installing':
        return 'cyan';
      case 'installed':
        return 'green';
      case 'failed':
        return 'red';
      case 'skipped':
        return 'gray';
      default:
        return 'white';
    }
  };

  if (isComplete && !verbose) {
    // 完成后简短显示
    const installed = Array.from(progress.values()).filter(p => p.status === 'installed').length;
    const failed = Array.from(progress.values()).filter(p => p.status === 'failed').length;

    return (
      <Box>
        <Text color="green">✓ </Text>
        <Text>{t('lsp.serversReady', { count: installed })}</Text>
        {failed > 0 && <Text color="red"> {t('lsp.failed', { count: failed })}</Text>}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* 标题 */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {isComplete ? `✓ ${t('lsp.initComplete')}` : `⚡ ${t('lsp.initializing')}`}
        </Text>
      </Box>

      {/* 总体进度条 */}
      {!isComplete && (
        <Box marginBottom={1}>
          <ProgressBar
            value={overallProgress}
            width={50}
            color="cyan"
            showPercentage
            label={currentLanguage ? t('lsp.current', { name: LSP_SERVERS[currentLanguage]?.name || currentLanguage }) : t('lsp.initDefault')}
          />
        </Box>
      )}

      {/* 语言列表 */}
      {verbose && (
        <Box flexDirection="column">
          {Array.from(progress.values()).map((p) => (
            <Box key={p.language} gap={1}>
              <Text color={getStatusColor(p.status)}>{getStatusIcon(p.status)}</Text>
              <Text color={getStatusColor(p.status)} bold>
                {p.serverName}
              </Text>
              <Text color="gray">
                {p.status === 'installing' && <Spinner type="dots" />}
                {' '}
                {p.message}
              </Text>
              {p.status === 'installing' && p.progress > 0 && (
                <Text color="gray"> ({p.progress}%)</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* 简化列表 (非 verbose 模式) */}
      {!verbose && !isComplete && (
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {Array.from(progress.values()).map((p) => (
            <Box key={p.language}>
              <Text color={getStatusColor(p.status)}>
                {getStatusIcon(p.status)} {p.language}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * 简化的 LSP 初始化加载指示器
 */
export interface LSPLoadingIndicatorProps {
  message?: string;
  languages?: string[];
}

export const LSPLoadingIndicator: React.FC<LSPLoadingIndicatorProps> = ({
  message = t('lsp.startingServers'),
  languages = [],
}) => {
  return (
    <Box gap={1}>
      <Spinner type="dots" />
      <Text color="cyan">{message}</Text>
      {languages.length > 0 && (
        <Text color="gray">({languages.join(', ')})</Text>
      )}
    </Box>
  );
};

export default LSPInitProgress;
