/**
 * StatsPanel 组件 - 官方风格的统计面板
 * v2.1.6+: 支持按 r 键循环切换日期范围 (Last 7 days / Last 30 days / All time)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Spinner } from './Spinner.js';
import { t } from '../../i18n/index.js';
import { convertFullwidthToHalfwidth } from '../../utils/index.js';

// 日期范围类型
type DateRangeType = 'all' | '7d' | '30d';

// 日期范围标签
function getDateRangeLabels(): Record<DateRangeType, string> {
  return {
    '7d': t('stats.last7days'),
    '30d': t('stats.last30days'),
    'all': t('stats.allTime'),
  };
}

// 日期范围循环顺序 (官方实现: ["all", "7d", "30d"])
const DATE_RANGE_ORDER: DateRangeType[] = ['all', '7d', '30d'];

// 循环到下一个日期范围
function cycleNextDateRange(current: DateRangeType): DateRangeType {
  const currentIndex = DATE_RANGE_ORDER.indexOf(current);
  return DATE_RANGE_ORDER[(currentIndex + 1) % DATE_RANGE_ORDER.length];
}

// Tab 类型
type TabType = 'Overview' | 'Models';

// 模型使用统计
interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

// 每日活动
interface DailyActivity {
  date: string;
  messageCount: number;
  tokenCount?: number;
}

// 每日模型 token
interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

// 会话统计
interface SessionStats {
  sessionId: string;
  timestamp: string;
  duration: number;
  messageCount: number;
}

// 统计数据
interface StatsData {
  totalSessions: number;
  totalMessages: number;
  totalDays: number;
  activeDays: number;
  streaks: {
    currentStreak: number;
    longestStreak: number;
  };
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  longestSession: SessionStats | null;
  modelUsage: Record<string, ModelUsage>;
  firstSessionDate: string | null;
  lastSessionDate: string | null;
  peakActivityDay: string | null;
  peakActivityHour: number | null;
}

// 加载结果类型
type LoadResult =
  | { type: 'success'; data: StatsData }
  | { type: 'empty' }
  | { type: 'error'; message: string };

// 格式化 token 数
function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1000000).toFixed(1)}M`;
}

// 格式化持续时间
function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

// 格式化日期
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// 截取模型名称
function shortModelName(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  // claude-3-5-sonnet-20241022 -> Sonnet
  const match = model.match(/claude-[0-9]+-?[0-9]*-(\w+)/);
  return match ? match[1].charAt(0).toUpperCase() + match[1].slice(1) : model.slice(0, 15);
}

// 计算连续天数
function calculateStreaks(dailyActivity: DailyActivity[]): { currentStreak: number; longestStreak: number } {
  if (dailyActivity.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const sortedDates = [...dailyActivity]
    .map(d => d.date)
    .sort()
    .map(d => new Date(d));

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 计算最长连续
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = sortedDates[i - 1];
    const curr = sortedDates[i];
    const diffDays = Math.floor((curr.getTime() - prev.getTime()) / 86400000);

    if (diffDays === 1) {
      tempStreak++;
    } else {
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, tempStreak);

  // 计算当前连续（从今天往前数）
  const lastDate = sortedDates[sortedDates.length - 1];
  lastDate.setHours(0, 0, 0, 0);
  const diffFromToday = Math.floor((today.getTime() - lastDate.getTime()) / 86400000);

  if (diffFromToday <= 1) {
    currentStreak = 1;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
      const curr = sortedDates[i + 1];
      const prev = sortedDates[i];
      const diffDays = Math.floor((curr.getTime() - prev.getTime()) / 86400000);
      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  return { currentStreak, longestStreak };
}

// 从会话文件加载统计数据
function loadStatsFromSessions(dateRange: DateRangeType): StatsData | null {
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');

  if (!fs.existsSync(sessionsDir)) {
    return null;
  }

  const now = new Date();
  let fromDate: Date | null = null;

  if (dateRange === '7d') {
    fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 6);
    fromDate.setHours(0, 0, 0, 0);
  } else if (dateRange === '30d') {
    fromDate = new Date(now);
    fromDate.setDate(now.getDate() - 29);
    fromDate.setHours(0, 0, 0, 0);
  }

  const sessionStats: SessionStats[] = [];
  const dailyActivityMap = new Map<string, DailyActivity>();
  const dailyModelTokensMap = new Map<string, Record<string, number>>();
  const modelUsage: Record<string, ModelUsage> = {};
  const hourCounts: Record<number, number> = {};
  let totalMessages = 0;
  let longestSession: SessionStats | null = null;

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const sessionPath = path.join(sessionsDir, file);
        const content = fs.readFileSync(sessionPath, 'utf-8');
        const session = JSON.parse(content);

        // 获取会话时间
        const timestamp = session.startTime || session.createdAt || session.created_at;
        if (!timestamp) continue;

        const sessionDate = new Date(timestamp);

        // 日期范围过滤
        if (fromDate && sessionDate < fromDate) continue;

        const dateKey = sessionDate.toISOString().split('T')[0];
        const msgCount = session.messages?.length || 0;
        const duration = session.duration || 0;

        // 会话统计
        const stat: SessionStats = {
          sessionId: session.id || file.replace('.json', ''),
          timestamp,
          duration,
          messageCount: msgCount,
        };
        sessionStats.push(stat);

        // 最长会话
        if (!longestSession || duration > longestSession.duration) {
          longestSession = stat;
        }

        // 每日活动
        const existing = dailyActivityMap.get(dateKey);
        if (existing) {
          existing.messageCount += msgCount;
        } else {
          dailyActivityMap.set(dateKey, { date: dateKey, messageCount: msgCount });
        }

        // 小时统计
        const hour = sessionDate.getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + msgCount;

        totalMessages += msgCount;

        // 模型使用统计 (从消息中提取)
        if (session.messages) {
          for (const msg of session.messages) {
            if (msg.model) {
              if (!modelUsage[msg.model]) {
                modelUsage[msg.model] = { inputTokens: 0, outputTokens: 0 };
              }
              modelUsage[msg.model].inputTokens += msg.inputTokens || 0;
              modelUsage[msg.model].outputTokens += msg.outputTokens || 0;
            }
          }
        }
      } catch {
        // 忽略单个文件解析错误
      }
    }
  } catch {
    return null;
  }

  const dailyActivity = Array.from(dailyActivityMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const streaks = calculateStreaks(dailyActivity);

  // 计算总天数
  let totalDays = 0;
  if (dateRange === '7d') {
    totalDays = 7;
  } else if (dateRange === '30d') {
    totalDays = 30;
  } else if (sessionStats.length > 0) {
    const timestamps = sessionStats.map(s => new Date(s.timestamp).getTime());
    const first = Math.min(...timestamps);
    const last = Math.max(...timestamps);
    totalDays = Math.ceil((last - first) / 86400000) + 1;
  }

  // 峰值活动日
  let peakActivityDay: string | null = null;
  let peakCount = 0;
  for (const activity of dailyActivity) {
    if (activity.messageCount > peakCount) {
      peakCount = activity.messageCount;
      peakActivityDay = activity.date;
    }
  }

  // 峰值活动小时
  let peakActivityHour: number | null = null;
  let peakHourCount = 0;
  for (const [hour, count] of Object.entries(hourCounts)) {
    if (count > peakHourCount) {
      peakHourCount = count;
      peakActivityHour = parseInt(hour, 10);
    }
  }

  return {
    totalSessions: sessionStats.length,
    totalMessages,
    totalDays,
    activeDays: dailyActivity.length,
    streaks,
    dailyActivity,
    dailyModelTokens: Array.from(dailyModelTokensMap.entries()).map(([date, tokensByModel]) => ({
      date,
      tokensByModel,
    })),
    longestSession,
    modelUsage,
    firstSessionDate: sessionStats.length > 0 ? sessionStats[0].timestamp : null,
    lastSessionDate: sessionStats.length > 0 ? sessionStats[sessionStats.length - 1].timestamp : null,
    peakActivityDay,
    peakActivityHour,
  };
}

// 生成活动热力图 (简化版 ASCII)
function generateActivityChart(dailyActivity: DailyActivity[], width: number = 52): string {
  if (dailyActivity.length === 0) return '';

  const maxCount = Math.max(...dailyActivity.map(d => d.messageCount));
  const blocks = [' ', '\u2591', '\u2592', '\u2593', '\u2588']; // 空、浅、中、深、满

  // 取最近 width 天
  const recentDays = dailyActivity.slice(-width);

  let chart = '';
  for (const day of recentDays) {
    const intensity = maxCount > 0 ? Math.ceil((day.messageCount / maxCount) * 4) : 0;
    chart += blocks[Math.min(intensity, 4)];
  }

  return chart;
}

// 趣味统计比较
const BOOK_COMPARISONS = [
  { name: 'The Little Prince', tokens: 22000 },
  { name: 'The Old Man and the Sea', tokens: 35000 },
  { name: 'A Christmas Carol', tokens: 37000 },
  { name: 'Animal Farm', tokens: 39000 },
  { name: 'Fahrenheit 451', tokens: 60000 },
  { name: 'The Great Gatsby', tokens: 62000 },
  { name: 'Brave New World', tokens: 83000 },
  { name: 'The Catcher in the Rye', tokens: 95000 },
  { name: 'Harry Potter and the Philosopher\'s Stone', tokens: 103000 },
  { name: '1984', tokens: 123000 },
  { name: 'Pride and Prejudice', tokens: 156000 },
  { name: 'Dune', tokens: 244000 },
  { name: 'War and Peace', tokens: 730000 },
];

const TIME_COMPARISONS = [
  { name: 'a TED talk', minutes: 18 },
  { name: 'an episode of The Office', minutes: 22 },
  { name: 'listening to Abbey Road', minutes: 47 },
  { name: 'a yoga class', minutes: 60 },
  { name: 'a World Cup soccer match', minutes: 90 },
  { name: 'a half marathon (average time)', minutes: 120 },
  { name: 'the movie Inception', minutes: 148 },
  { name: 'watching Titanic', minutes: 195 },
  { name: 'a transatlantic flight', minutes: 420 },
  { name: 'a full night of sleep', minutes: 480 },
];

function getFunComparison(stats: StatsData, totalTokens: number): string {
  const comparisons: string[] = [];

  // Token 比较
  if (totalTokens > 0) {
    const matchedBooks = BOOK_COMPARISONS.filter(b => totalTokens >= b.tokens);
    for (const book of matchedBooks) {
      const ratio = totalTokens / book.tokens;
      if (ratio >= 2) {
        comparisons.push(`You've used ~${Math.floor(ratio)}x more tokens than ${book.name}`);
      } else {
        comparisons.push(`You've used the same number of tokens as ${book.name}`);
      }
    }
  }

  // 时间比较
  if (stats.longestSession) {
    const durationMins = stats.longestSession.duration / 60000;
    for (const time of TIME_COMPARISONS) {
      const ratio = durationMins / time.minutes;
      if (ratio >= 2) {
        comparisons.push(`Your longest session is ~${Math.floor(ratio)}x longer than ${time.name}`);
      }
    }
  }

  if (comparisons.length === 0) return '';

  // 随机选一个
  return comparisons[Math.floor(Math.random() * comparisons.length)];
}

interface StatsPanelProps {
  onDone?: (message?: string, options?: { display?: 'system' | 'user' }) => void;
  sessionStats?: {
    messageCount: number;
    duration: number;
    totalCost: string;
    modelUsage: Record<string, number>;
  };
  modelDisplayName?: string;
}

// 日期范围选择器组件
const DateRangeSelector: React.FC<{
  dateRange: DateRangeType;
  isLoading: boolean;
}> = ({ dateRange, isLoading }) => {
  const labels = getDateRangeLabels();
  return (
    <Box marginBottom={1} gap={1}>
      <Box>
        {DATE_RANGE_ORDER.map((range, index) => (
          <Text key={range}>
            {index > 0 && <Text dimColor> {'\u00B7'} </Text>}
            {range === dateRange ? (
              <Text bold color="magenta">{labels[range]}</Text>
            ) : (
              <Text dimColor>{labels[range]}</Text>
            )}
          </Text>
        ))}
      </Box>
      {isLoading && <Spinner type="dots" color="yellow" />}
    </Box>
  );
};

// Overview Tab 内容
const OverviewTab: React.FC<{
  stats: StatsData;
  allTimeStats: StatsData;
  dateRange: DateRangeType;
  isLoading: boolean;
}> = ({ stats, allTimeStats, dateRange, isLoading }) => {
  const termWidth = process.stdout.columns || 80;

  // 计算总 token
  const modelEntries = Object.entries(stats.modelUsage).sort(
    ([, a], [, b]) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
  );
  const favoriteModel = modelEntries[0];
  const totalTokens = modelEntries.reduce((sum, [, usage]) => sum + usage.inputTokens + usage.outputTokens, 0);

  // 趣味比较
  const funComparison = useMemo(() => getFunComparison(stats, totalTokens), [stats, totalTokens]);

  // 计算显示的天数
  const displayDays = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : stats.totalDays;

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 活动热力图 */}
      {allTimeStats.dailyActivity.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>{generateActivityChart(allTimeStats.dailyActivity, Math.min(52, termWidth - 10))}</Text>
        </Box>
      )}

      {/* 日期范围选择器 */}
      <DateRangeSelector dateRange={dateRange} isLoading={isLoading} />

      {/* 第一行: Favorite model + Total tokens */}
      <Box flexDirection="row" gap={4} marginBottom={1}>
        <Box flexDirection="column" width={28}>
          {favoriteModel && (
            <Text wrap="truncate">
              {t('stats.favoriteModel')}{' '}
              <Text color="magenta" bold>{shortModelName(favoriteModel[0])}</Text>
            </Text>
          )}
        </Box>
        <Box flexDirection="column" width={28}>
          <Text wrap="truncate">
            {t('stats.totalTokens')}{' '}
            <Text color="magenta">{formatTokens(totalTokens)}</Text>
          </Text>
        </Box>
      </Box>

      {/* 第二行: Sessions + Longest session */}
      <Box flexDirection="row" gap={4}>
        <Box flexDirection="column" width={28}>
          <Text wrap="truncate">
            {t('stats.sessions')}{' '}
            <Text color="magenta">{formatTokens(stats.totalSessions)}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" width={28}>
          {stats.longestSession && (
            <Text wrap="truncate">
              {t('stats.longestSession')}{' '}
              <Text color="magenta">{formatDuration(stats.longestSession.duration)}</Text>
            </Text>
          )}
        </Box>
      </Box>

      {/* 第三行: Active days + Longest streak */}
      <Box flexDirection="row" gap={4}>
        <Box flexDirection="column" width={28}>
          <Text wrap="truncate">
            {t('stats.activeDays')} <Text color="magenta">{stats.activeDays}</Text>
            <Text color="gray">/{displayDays}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" width={28}>
          <Text wrap="truncate">
            {t('stats.longestStreak')}{' '}
            <Text color="magenta" bold>{stats.streaks.longestStreak}</Text>
            {' '}{stats.streaks.longestStreak === 1 ? t('stats.day') : t('stats.days')}
          </Text>
        </Box>
      </Box>

      {/* 第四行: Most active day + Current streak */}
      <Box flexDirection="row" gap={4}>
        <Box flexDirection="column" width={28}>
          {stats.peakActivityDay && (
            <Text wrap="truncate">
              {t('stats.mostActiveDay')}{' '}
              <Text color="magenta">{formatDate(stats.peakActivityDay)}</Text>
            </Text>
          )}
        </Box>
        <Box flexDirection="column" width={28}>
          <Text wrap="truncate">
            {t('stats.currentStreak')}{' '}
            <Text color="magenta" bold>{allTimeStats.streaks.currentStreak}</Text>
            {' '}{allTimeStats.streaks.currentStreak === 1 ? t('stats.day') : t('stats.days')}
          </Text>
        </Box>
      </Box>

      {/* 趣味比较 */}
      {funComparison && (
        <Box marginTop={1}>
          <Text color="cyan">{funComparison}</Text>
        </Box>
      )}
    </Box>
  );
};

// Models Tab 内容
const ModelsTab: React.FC<{
  stats: StatsData;
  dateRange: DateRangeType;
  isLoading: boolean;
}> = ({ stats, dateRange, isLoading }) => {
  const [scrollOffset, setScrollOffset] = useState(0);
  const maxVisible = 4;

  const modelEntries = Object.entries(stats.modelUsage).sort(
    ([, a], [, b]) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
  );

  const totalTokens = modelEntries.reduce((sum, [, usage]) => sum + usage.inputTokens + usage.outputTokens, 0);

  // 键盘导航
  useInput((input, key) => {
    if (key.downArrow && scrollOffset < modelEntries.length - maxVisible) {
      setScrollOffset(prev => Math.min(prev + 2, modelEntries.length - maxVisible));
    }
    if (key.upArrow && scrollOffset > 0) {
      setScrollOffset(prev => Math.max(prev - 2, 0));
    }
  });

  if (modelEntries.length === 0) {
    return (
      <Box>
        <Text color="gray">{t('stats.noModelData')}</Text>
      </Box>
    );
  }

  const visibleModels = modelEntries.slice(scrollOffset, scrollOffset + maxVisible);
  const hasMore = modelEntries.length > maxVisible;
  const canScrollUp = scrollOffset > 0;
  const canScrollDown = scrollOffset < modelEntries.length - maxVisible;

  // 分成两列
  const halfLen = Math.ceil(visibleModels.length / 2);
  const leftColumn = visibleModels.slice(0, halfLen);
  const rightColumn = visibleModels.slice(halfLen);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* 日期范围选择器 */}
      <DateRangeSelector dateRange={dateRange} isLoading={isLoading} />

      {/* 模型列表 */}
      <Box flexDirection="row" gap={4}>
        <Box flexDirection="column" width={36}>
          {leftColumn.map(([model, usage]) => {
            const modelTokens = usage.inputTokens + usage.outputTokens;
            const percentage = ((modelTokens / totalTokens) * 100).toFixed(1);
            return (
              <Box key={model} flexDirection="column">
                <Text>
                  {'\u2022'} <Text bold>{shortModelName(model)}</Text>{' '}
                  <Text color="gray">({percentage}%)</Text>
                </Text>
                <Text color="gray">
                  {'  '}In: {formatTokens(usage.inputTokens)} {'\u00B7'} Out: {formatTokens(usage.outputTokens)}
                </Text>
              </Box>
            );
          })}
        </Box>
        <Box flexDirection="column" width={36}>
          {rightColumn.map(([model, usage]) => {
            const modelTokens = usage.inputTokens + usage.outputTokens;
            const percentage = ((modelTokens / totalTokens) * 100).toFixed(1);
            return (
              <Box key={model} flexDirection="column">
                <Text>
                  {'\u2022'} <Text bold>{shortModelName(model)}</Text>{' '}
                  <Text color="gray">({percentage}%)</Text>
                </Text>
                <Text color="gray">
                  {'  '}In: {formatTokens(usage.inputTokens)} {'\u00B7'} Out: {formatTokens(usage.outputTokens)}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* 滚动提示 */}
      {hasMore && (
        <Box marginTop={1}>
          <Text color="gray">
            {canScrollUp ? '\u2191' : ' '} {canScrollDown ? '\u2193' : ' '}{' '}
            {t('stats.ofModels', { start: scrollOffset + 1, end: Math.min(scrollOffset + maxVisible, modelEntries.length), total: modelEntries.length })}
            {' '}({'\u2191\u2193'} {t('stats.toScroll')})
          </Text>
        </Box>
      )}
    </Box>
  );
};

// 主统计面板组件
export const StatsPanel: React.FC<StatsPanelProps> = ({ onDone }) => {
  const [dateRange, setDateRange] = useState<DateRangeType>('all');
  const [activeTab, setActiveTab] = useState<TabType>('Overview');
  const [isLoading, setIsLoading] = useState(false);
  const [statsCache, setStatsCache] = useState<Record<DateRangeType, StatsData | null>>({
    all: null,
    '7d': null,
    '30d': null,
  });
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  // 加载 all time 数据
  useEffect(() => {
    const allStats = loadStatsFromSessions('all');
    setStatsCache(prev => ({ ...prev, all: allStats }));
  }, []);

  // 加载其他日期范围数据 (懒加载)
  useEffect(() => {
    if (dateRange === 'all') return;
    if (statsCache[dateRange]) return;

    setIsLoading(true);
    // 模拟异步加载
    setTimeout(() => {
      const stats = loadStatsFromSessions(dateRange);
      setStatsCache(prev => ({ ...prev, [dateRange]: stats }));
      setIsLoading(false);
    }, 100);
  }, [dateRange, statsCache]);

  // 键盘处理
  useInput((input, key) => {
    // 将全角字符转换为半角字符（支持日语 IME 输入）
    const normalizedInput = convertFullwidthToHalfwidth(input);

    // Escape 或 Ctrl+C/D 关闭
    if (key.escape || (key.ctrl && (normalizedInput === 'c' || normalizedInput === 'd'))) {
      onDone?.(t('stats.dismissed'), { display: 'system' });
    }

    // Tab 切换 Overview/Models
    if (key.tab) {
      setActiveTab(prev => prev === 'Overview' ? 'Models' : 'Overview');
    }

    // r 键循环切换日期范围 (官方实现，支持全角字符)
    if (normalizedInput === 'r' && !key.ctrl && !key.meta) {
      setDateRange(cycleNextDateRange);
    }

    // Ctrl+S 复制统计 (TODO: 实现剪贴板功能)
    // if (key.ctrl && normalizedInput === 's') { ... }
  });

  const allTimeStats = statsCache.all;
  const currentStats = statsCache[dateRange] || allTimeStats;

  // 无数据
  if (!allTimeStats || allTimeStats.totalSessions === 0) {
    return (
      <Box flexDirection="column" marginX={1} marginTop={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={2}
          paddingY={1}
        >
          <Box marginBottom={1}>
            <Text bold color="cyan">{t('stats.title')}</Text>
          </Box>
          <Text color="yellow">{t('stats.noStats')}</Text>
          <Box marginTop={1}>
            <Text dimColor italic>{t('stats.escToClose')}</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  // 加载中
  if (!currentStats) {
    return (
      <Box flexDirection="column" marginX={1} marginTop={1}>
        <Box marginTop={1}>
          <Spinner type="dots" color="yellow" label={t('stats.loadingStats')} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginX={1} marginTop={1}>
      {/* Tab 容器 - 使用类似官方的 TabPanel 样式 */}
      <Box flexDirection="row" gap={1} marginBottom={1}>
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="magenta"
          paddingX={2}
          paddingY={1}
          minWidth={70}
        >
          {/* Tab 标题 */}
          <Box marginBottom={1}>
            <Text
              bold={activeTab === 'Overview'}
              color={activeTab === 'Overview' ? 'magenta' : 'gray'}
              underline={activeTab === 'Overview'}
            >
              {t('stats.overview')}
            </Text>
            <Text> </Text>
            <Text
              bold={activeTab === 'Models'}
              color={activeTab === 'Models' ? 'magenta' : 'gray'}
              underline={activeTab === 'Models'}
            >
              {t('stats.models')}
            </Text>
          </Box>

          {/* Tab 内容 */}
          {activeTab === 'Overview' ? (
            <OverviewTab
              stats={currentStats}
              allTimeStats={allTimeStats}
              dateRange={dateRange}
              isLoading={isLoading}
            />
          ) : (
            <ModelsTab
              stats={currentStats}
              dateRange={dateRange}
              isLoading={isLoading}
            />
          )}
        </Box>
      </Box>

      {/* 底部提示 */}
      <Box paddingLeft={1}>
        <Text dimColor>
          {t('stats.escToCancel')} {'\u00B7'} {t('stats.cycleDates')}
          {copyStatus && <Text> {'\u00B7'} {copyStatus}</Text>}
        </Text>
      </Box>
    </Box>
  );
};

export default StatsPanel;
