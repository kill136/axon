/**
 * Resume Session 组件 - 官方风格的交互式会话选择器
 * 参考官方 Claude Code cli.js 中的 R77/ubA 组件实现
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { Spinner } from './Spinner.js';
import { t } from '../../i18n/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 会话数据结构
interface SessionData {
  id: string;
  modified: Date;
  created: Date;
  messageCount: number;
  projectPath: string;
  gitBranch?: string;
  customTitle?: string;
  firstPrompt?: string;
  summary: string;
  isSidechain?: boolean;
}

interface ResumeSessionProps {
  onDone: (message?: string, options?: { display?: 'user' | 'assistant' | 'system' | 'skip' }) => void;
  onResume?: (sessionId: string, session: SessionData, source: string) => Promise<void>;
  initialSearch?: string;
}

// 获取会话目录
const getSessionsDir = () => path.join(os.homedir(), '.claude', 'sessions');

// 格式化时间差 (官方风格: "2h ago", "3d ago")
function getTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return t('resume.justNow');
  if (minutes < 60) return t('resume.minutesAgo', { count: minutes });
  if (hours < 24) return t('resume.hoursAgo', { count: hours });
  if (days < 7) return t('resume.daysAgo', { count: days });
  if (days < 30) return t('resume.weeksAgo', { count: Math.floor(days / 7) });
  return date.toLocaleDateString();
}

// 解析会话文件
function parseSessionFile(filePath: string): SessionData | null {
  try {
    const stat = fs.statSync(filePath);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const fileName = path.basename(filePath, '.json');

    const messages = data.messages || [];
    const metadata = data.metadata || {};

    const projectPath = metadata.workingDirectory || metadata.projectPath || data.state?.cwd || data.cwd || 'Unknown';
    const gitBranch = metadata.gitBranch;
    const customTitle = metadata.customTitle || metadata.name;
    const messageCount = metadata.messageCount || messages.length;
    const created = new Date(metadata.createdAt || metadata.created || data.state?.startTime || stat.birthtime);
    const modified = new Date(metadata.updatedAt || metadata.modified || stat.mtime);

    const firstUserMsg = messages.find((m: any) => m.role === 'user');
    let rawFirstPrompt = metadata.firstPrompt || metadata.summary ||
      (typeof firstUserMsg?.content === 'string' ? firstUserMsg.content : null);

    // v2.1.33: 剥离 XML 标记，修复以 slash command 启动的会话显示原始 XML 的问题
    if (rawFirstPrompt) {
      rawFirstPrompt = rawFirstPrompt.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
    const firstPrompt = rawFirstPrompt || null;

    const summary = customTitle || firstPrompt?.slice(0, 60) || t('resume.noMessages');

    return {
      id: metadata.id || data.state?.sessionId || fileName,
      modified,
      created,
      messageCount,
      projectPath,
      gitBranch,
      customTitle,
      firstPrompt,
      summary,
      isSidechain: metadata.isSidechain || false,
    };
  } catch {
    return null;
  }
}

// 加载所有会话
async function loadSessions(projectPaths?: string[]): Promise<SessionData[]> {
  const sessionsDir = getSessionsDir();

  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  const sessionFiles = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

  let sessions = sessionFiles
    .map(f => parseSessionFile(path.join(sessionsDir, f)))
    .filter((s): s is SessionData => s !== null)
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());

  // 如果指定了项目路径，过滤到该项目
  if (projectPaths && projectPaths.length > 0) {
    sessions = sessions.filter(s => projectPaths.includes(s.projectPath));
  }

  return sessions;
}

export const ResumeSession: React.FC<ResumeSessionProps> = ({
  onDone,
  onResume,
  initialSearch,
}) => {
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;

  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialSearch || '');
  const [scrollOffset, setScrollOffset] = useState(0);

  // 计算可见项目数（根据终端高度）
  // 每个会话项大约占 2-3 行，预留 8 行给标题、搜索框和底部提示
  const visibleCount = Math.max(3, Math.floor((terminalHeight - 8) / 3));

  // 加载会话
  const loadSessionsAsync = useCallback(async (allProjects: boolean, projectPaths: string[]) => {
    setLoading(true);
    try {
      const allSessions = allProjects ? await loadSessions() : await loadSessions(projectPaths);

      if (allSessions.length === 0) {
        onDone(t('resume.noConversations'));
        return;
      }

      setSessions(allSessions);
    } finally {
      setLoading(false);
    }
  }, [onDone]);

  // 初始加载
  useEffect(() => {
    const projectPaths = [process.cwd()];
    loadSessionsAsync(false, projectPaths);
  }, [loadSessionsAsync]);

  // 搜索过滤 - 使用 useMemo 实时过滤
  const filteredSessions = useMemo(() => {
    const baseSessions = sessions.filter(s => !s.isSidechain);

    if (!searchQuery.trim()) {
      return baseSessions;
    }

    const query = searchQuery.toLowerCase();
    return baseSessions.filter(s =>
      s.summary.toLowerCase().includes(query) ||
      s.projectPath.toLowerCase().includes(query) ||
      (s.gitBranch && s.gitBranch.toLowerCase().includes(query)) ||
      (s.customTitle && s.customTitle.toLowerCase().includes(query)) ||
      (s.firstPrompt && s.firstPrompt.toLowerCase().includes(query)) ||
      s.id.toLowerCase().includes(query)
    );
  }, [sessions, searchQuery]);

  // 当过滤结果变化时，重置选择索引
  useEffect(() => {
    setSelectedIndex(0);
    setScrollOffset(0);
  }, [searchQuery]);

  // 确保选中项在可见范围内
  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= scrollOffset + visibleCount) {
      setScrollOffset(selectedIndex - visibleCount + 1);
    }
  }, [selectedIndex, scrollOffset, visibleCount]);

  // 选择会话
  const handleSelect = useCallback(async (session: SessionData) => {
    if (!session) {
      onDone(t('resume.failed'));
      return;
    }

    // 检查是否跨项目
    const currentDir = process.cwd();
    if (session.projectPath !== currentDir && !showAllProjects) {
      const command = `cd "${session.projectPath}" && claude --resume ${session.id.slice(0, 8)}`;
      const message = [
        '',
        t('resume.differentDir'),
        '',
        t('resume.toResume'),
        `  ${command}`,
        '',
      ].join('\n');
      onDone(message, { display: 'user' });
      return;
    }

    setResuming(true);

    if (onResume) {
      try {
        await onResume(session.id, session, 'slash_command_picker');
        // onResume 成功后，调用 onDone 关闭组件并跳过消息显示
        onDone(undefined, { display: 'skip' });
      } catch (error) {
        onDone(t('resume.failedSession', { error: String(error) }), { display: 'assistant' });
      }
    } else {
      // 如果没有提供 onResume，显示恢复指令
      const message = [
        '',
        `To resume session "${session.summary.slice(0, 40)}${session.summary.length > 40 ? '...' : ''}"`,
        '',
        t('resume.run'),
        `  claude --resume ${session.id}`,
        '',
        t('resume.orShortForm'),
        `  claude -r ${session.id.slice(0, 8)}`,
        '',
      ].join('\n');
      onDone(message, { display: 'assistant' });
    }
  }, [onDone, onResume, showAllProjects]);

  // 键盘输入处理
  useInput((input, key) => {
    if (loading || resuming) return;

    // Escape - 取消
    if (key.escape) {
      onDone(t('resume.cancelled'), { display: 'system' });
      return;
    }

    // Ctrl+C - 退出
    if (key.ctrl && input === 'c') {
      onDone(t('resume.cancelled'), { display: 'system' });
      return;
    }

    // 上下箭头 - 导航列表
    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filteredSessions.length - 1, prev + 1));
      return;
    }

    // Page Up / Page Down
    if (key.pageUp) {
      setSelectedIndex(prev => Math.max(0, prev - visibleCount));
      return;
    }

    if (key.pageDown) {
      setSelectedIndex(prev => Math.min(filteredSessions.length - 1, prev + visibleCount));
      return;
    }

    // Ctrl+A / Ctrl+E - 跳到开头/结尾
    if (key.ctrl && input === 'a') {
      setSelectedIndex(0);
      return;
    }

    if (key.ctrl && input === 'e') {
      setSelectedIndex(filteredSessions.length - 1);
      return;
    }

    // Enter - 选择会话
    if (key.return) {
      const selected = filteredSessions[selectedIndex];
      if (selected) {
        handleSelect(selected);
      }
      return;
    }

    // Backspace - 删除搜索字符
    if (key.backspace || key.delete) {
      setSearchQuery(prev => prev.slice(0, -1));
      return;
    }

    // A - 切换显示所有项目
    if (input === 'A' && !searchQuery) {
      const newShowAll = !showAllProjects;
      setShowAllProjects(newShowAll);
      loadSessionsAsync(newShowAll, [process.cwd()]);
      return;
    }

    // 普通字符 - 添加到搜索
    if (input && !key.ctrl && !key.meta && input.length === 1) {
      // 排除特殊控制键
      const isPrintable = input.charCodeAt(0) >= 32;
      if (isPrintable) {
        setSearchQuery(prev => prev + input);
      }
    }
  });

  // 加载中
  if (loading) {
    return (
      <Box>
        <Spinner label={` ${t('resume.loading')}`} />
      </Box>
    );
  }

  // 正在恢复
  if (resuming) {
    return (
      <Box>
        <Spinner label={` ${t('resume.resuming')}`} />
      </Box>
    );
  }

  // 计算显示的会话（带滚动）
  const displaySessions = filteredSessions.slice(scrollOffset, scrollOffset + visibleCount);
  const hasMoreAbove = scrollOffset > 0;
  const hasMoreBelow = scrollOffset + visibleCount < filteredSessions.length;

  return (
    <Box flexDirection="column">
      {/* 分隔线 */}
      <Box>
        <Text color="cyan">{'─'.repeat(Math.min(60, stdout?.columns || 60))}</Text>
      </Box>

      {/* 标题 */}
      <Box marginTop={1}>
        <Text bold color="cyan">{t('resume.title')}</Text>
      </Box>

      {/* 搜索框 */}
      <Box marginTop={1}>
        <Text dimColor>⌕ {t('resume.search')}</Text>
        <Text color={searchQuery ? 'yellow' : 'gray'}>
          {searchQuery ? `: ${searchQuery}` : ''}
        </Text>
        <Text color="yellow">▊</Text>
      </Box>

      {/* 搜索提示 */}
      {searchQuery && (
        <Box paddingLeft={2}>
          <Text dimColor italic>
            {filteredSessions.length !== 1 ? t('resume.resultsForPlural', { count: filteredSessions.length, query: searchQuery }) : t('resume.resultsFor', { count: filteredSessions.length, query: searchQuery })}
          </Text>
        </Box>
      )}

      {/* 向上滚动指示 */}
      {hasMoreAbove && (
        <Box paddingLeft={2}>
          <Text dimColor>{t('resume.moreAbove', { count: scrollOffset })}</Text>
        </Box>
      )}

      {/* 会话列表 */}
      <Box flexDirection="column" marginTop={1}>
        {displaySessions.map((session, displayIdx) => {
          const actualIndex = scrollOffset + displayIdx;
          const isSelected = actualIndex === selectedIndex;
          const timeAgo = getTimeAgo(session.modified);
          const shortPath = session.projectPath.replace(os.homedir(), '~');
          const isDifferentProject = session.projectPath !== process.cwd();

          return (
            <Box key={session.id} flexDirection="column" marginBottom={1}>
              <Box>
                <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                  {isSelected ? '❯ ' : '  '}
                </Text>
                <Text bold color={isSelected ? 'cyan' : undefined}>
                  {session.summary.slice(0, 55)}{session.summary.length > 55 ? '...' : ''}
                </Text>
              </Box>
              <Box paddingLeft={2}>
                <Text dimColor>
                  {timeAgo} · {session.messageCount} {t('resume.msgs')}
                  {session.gitBranch && ` · ${session.gitBranch}`}
                  {isDifferentProject && showAllProjects && ` · 📁 ${shortPath}`}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* 向下滚动指示 */}
      {hasMoreBelow && (
        <Box paddingLeft={2}>
          <Text dimColor>{t('resume.moreBelow', { count: filteredSessions.length - scrollOffset - visibleCount })}</Text>
        </Box>
      )}

      {/* 没有结果 */}
      {filteredSessions.length === 0 && (
        <Box marginTop={1} paddingLeft={2}>
          <Text dimColor italic>
            {searchQuery
              ? t('resume.noSessionsMatch', { query: searchQuery })
              : t('resume.noSessions')
            }
          </Text>
        </Box>
      )}

      {/* 底部快捷键提示 */}
      <Box marginTop={1}>
        <Text dimColor>
          {t('resume.footerHint')}
        </Text>
      </Box>
    </Box>
  );
};

export default ResumeSession;
