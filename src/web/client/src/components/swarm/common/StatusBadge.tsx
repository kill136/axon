import React from 'react';
import styles from './animations.module.css';
import { useLanguage } from '../../../i18n';

/**
 * 状态徽章组件 Props
 */
export interface StatusBadgeProps {
  /** 状态类型 */
  status: 'pending' | 'running' | 'success' | 'error' | 'warning';
  /** 显示文本（可选，不传则只显示状态点） */
  label?: string;
  /** 是否启用脉动动画 */
  pulse?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * StatusBadge - 状态徽章组件
 *
 * 功能：
 * - 5 种状态类型，每种有独特的颜色
 * - 状态指示点（running 状态有呼吸灯效果）
 * - 可选的脉动动画
 * - 支持自定义标签文本
 *
 * @example
 * ```tsx
 * <StatusBadge status="running" pulse />
 * <StatusBadge status="success" label="任务完成" />
 * ```
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  pulse = false,
  className = '',
}) => {
  const { t } = useLanguage();

  const STATUS_LABELS: Record<StatusBadgeProps['status'], string> = {
    pending: t('statusBadge.pending'),
    running: t('statusBadge.running'),
    success: t('statusBadge.success'),
    error: t('statusBadge.error'),
    warning: t('statusBadge.warning'),
  };

  const displayLabel = label ?? STATUS_LABELS[status];

  return (
    <span
      className={`${styles.statusBadge} ${styles[status]} ${pulse ? styles.pulse : ''} ${className}`}
      role="status"
      aria-label={t('statusBadge.statusLabel', { status: displayLabel })}
    >
      <span className={styles.statusDot} aria-hidden="true" />
      <span>{displayLabel}</span>
    </span>
  );
};

export default StatusBadge;
