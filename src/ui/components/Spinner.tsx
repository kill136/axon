/**
 * Spinner 组件
 * 增强版加载动画组件 - 支持多种样式、状态、进度和计时器
 */

import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { t } from '../../i18n/index.js';

// 定义多种动画类型的帧
const SPINNER_TYPES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  circle: ['◐', '◓', '◑', '◒'],
  dots2: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  dots3: ['⠋', '⠙', '⠚', '⠞', '⠖', '⠦', '⠴', '⠲', '⠳', '⠓'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  box: ['▖', '▘', '▝', '▗'],
  hamburger: ['☱', '☲', '☴'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
  earth: ['🌍', '🌎', '🌏'],
  clock: ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  bouncingBar: ['[    ]', '[=   ]', '[==  ]', '[=== ]', '[ ===]', '[  ==]', '[   =]', '[    ]', '[   =]', '[  ==]', '[ ===]', '[====]'],
  bouncingBall: ['( ●    )', '(  ●   )', '(   ●  )', '(    ● )', '(     ●)', '(    ● )', '(   ●  )', '(  ●   )', '( ●    )', '(●     )'],
  // v2.1.7: 终端标题专用等宽 braille 字符，避免标题宽度变化导致的抖动
  terminalTitle: ['⠂', '⠐'],
};

// 状态类型
export type SpinnerStatus = 'loading' | 'success' | 'error' | 'warning' | 'info';

// 状态图标
const STATUS_ICONS = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
};

// 状态颜色
const STATUS_COLORS = {
  loading: 'cyan',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'blue',
};

export interface SpinnerProps {
  label?: string;
  type?: keyof typeof SPINNER_TYPES;
  color?: string;
  status?: SpinnerStatus;
  progress?: number; // 0-100
  showElapsed?: boolean;
  startTime?: number;
  dimLabel?: boolean;
  /** v2.1.0 改进：等待首个 token 的特殊状态 */
  waitingForFirstToken?: boolean;
  /** v2.1.20 新增：thinking 状态的 shimmer 动画效果 */
  shimmer?: boolean;
  /** shimmer 的主色调 */
  shimmerColor?: string;
  /** shimmer 的高亮色调 */
  shimmerHighlightColor?: string;
}

export const Spinner: React.FC<SpinnerProps> = React.memo(({
  label,
  type = 'dots',
  color,
  status = 'loading',
  progress,
  showElapsed = false,
  startTime = Date.now(),
  dimLabel = false,
  waitingForFirstToken = false,
  shimmer = false,
  shimmerColor = 'cyan',
  shimmerHighlightColor = 'white',
}) => {
  const [frame, setFrame] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // v2.1.0 改进：等待首个 token 时使用脉冲效果
  const [pulsePhase, setPulsePhase] = useState(0);
  // v2.1.20 新增：shimmer 动画相位
  const [shimmerPhase, setShimmerPhase] = useState(0);

  const frames = SPINNER_TYPES[type] || SPINNER_TYPES.dots;
  const displayColor = color || STATUS_COLORS[status];

  // 动画更新
  useEffect(() => {
    if (status !== 'loading') return;

    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80);

    return () => clearInterval(timer);
  }, [status, frames.length]);

  // 计时器更新
  useEffect(() => {
    if (!showElapsed) return;

    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);

    return () => clearInterval(timer);
  }, [showElapsed, startTime]);

  // v2.1.0 改进：等待首个 token 时的脉冲动画
  useEffect(() => {
    if (!waitingForFirstToken) return;

    const timer = setInterval(() => {
      setPulsePhase((prev) => (prev + 1) % 3);
    }, 500);

    return () => clearInterval(timer);
  }, [waitingForFirstToken]);

  // v2.1.20 新增：shimmer 动画效果
  useEffect(() => {
    if (!shimmer || status !== 'loading') return;

    const timer = setInterval(() => {
      setShimmerPhase((prev) => (prev + 1) % 20);
    }, 100);

    return () => clearInterval(timer);
  }, [shimmer, status]);

  const formatElapsed = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const icon = status === 'loading'
    ? frames[frame]
    : STATUS_ICONS[status] || frames[frame];

  // v2.1.0 改进：等待首个 token 时的特殊显示
  const waitingLabel = waitingForFirstToken
    ? `${t('spinner.waitingForResponse')}${'.'.repeat(pulsePhase + 1)}`
    : label;

  // v2.1.20 新增：计算 shimmer 效果的颜色
  const getShimmerTextColor = (): string => {
    if (!shimmer || status !== 'loading') return displayColor;
    // 使用正弦波创建平滑的闪烁效果
    const intensity = Math.sin(shimmerPhase * Math.PI / 10);
    return intensity > 0.5 ? shimmerHighlightColor : shimmerColor;
  };

  // v2.1.20 新增：渲染带 shimmer 效果的标签
  const renderShimmerLabel = () => {
    if (!shimmer || !waitingLabel) {
      return waitingLabel ? (
        <Text dimColor={dimLabel || waitingForFirstToken}> {waitingLabel}</Text>
      ) : null;
    }

    // 创建字符级别的 shimmer 效果
    const chars = waitingLabel.split('');
    const shimmerWidth = 5; // shimmer 高亮宽度
    const shimmerPos = shimmerPhase % (chars.length + shimmerWidth);

    return (
      <Text>
        {' '}
        {chars.map((char, i) => {
          const distanceFromShimmer = Math.abs(i - shimmerPos);
          const isHighlighted = distanceFromShimmer < shimmerWidth / 2;
          return (
            <Text
              key={i}
              color={isHighlighted ? shimmerHighlightColor : shimmerColor}
              dimColor={!isHighlighted}
            >
              {char}
            </Text>
          );
        })}
      </Text>
    );
  };

  // v2.1.31: 使用 minHeight 减少 spinner 出现和消失时的布局抖动
  return (
    <Box minHeight={1}>
      <Text color={shimmer ? getShimmerTextColor() : displayColor}>{icon}</Text>
      {renderShimmerLabel()}
      {progress !== undefined && (
        <Text dimColor> ({Math.round(progress)}%)</Text>
      )}
      {showElapsed && (
        <Text dimColor> [{formatElapsed(elapsed)}]</Text>
      )}
    </Box>
  );
});

// 多任务 Spinner 组件
export interface Task {
  id: string;
  label: string;
  status: SpinnerStatus;
  progress?: number;
  startTime?: number;
  type?: keyof typeof SPINNER_TYPES;
}

export interface MultiSpinnerProps {
  tasks: Task[];
  type?: keyof typeof SPINNER_TYPES;
  showElapsed?: boolean;
  compact?: boolean;
}

export const MultiSpinner: React.FC<MultiSpinnerProps> = ({
  tasks,
  type = 'dots',
  showElapsed = false,
  compact = false,
}) => {
  return (
    <Box flexDirection="column" paddingY={compact ? 0 : 1}>
      {tasks.map((task) => (
        <Box key={task.id} marginBottom={compact ? 0 : 0}>
          <Spinner
            label={task.label}
            type={task.type || type}
            status={task.status}
            progress={task.progress}
            showElapsed={showElapsed}
            startTime={task.startTime}
          />
        </Box>
      ))}
    </Box>
  );
};


// 状态指示器组件
export interface StatusIndicatorProps {
  status: SpinnerStatus;
  label?: string;
  color?: string;
  showIcon?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  status,
  label,
  color,
  showIcon = true,
}) => {
  const displayColor = color || STATUS_COLORS[status];
  const icon = STATUS_ICONS[status];

  return (
    <Box>
      {showIcon && icon && (
        <Text color={displayColor}>{icon}</Text>
      )}
      {label && (
        <Text color={displayColor}> {label}</Text>
      )}
    </Box>
  );
};

// 导出所有类型和常量
export { SPINNER_TYPES, STATUS_ICONS, STATUS_COLORS };

export default Spinner;
