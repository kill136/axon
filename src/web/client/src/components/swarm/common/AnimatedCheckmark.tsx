import React from 'react';
import styles from './animations.module.css';
import { useLanguage } from '../../../i18n';

/**
 * 动画打勾组件 Props
 */
export interface AnimatedCheckmarkProps {
  /** 大小（像素） */
  size?: number;
  /** 颜色（CSS color 值） */
  color?: string;
  /** 是否播放动画 */
  animate?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * AnimatedCheckmark - 动画打勾组件
 *
 * 功能：
 * - SVG 绘制打勾动画（stroke-dashoffset）
 * - 0.6s 的流畅动画
 * - 可自定义大小和颜色
 * - 可控制是否播放动画
 *
 * 技术实现：
 * - 使用 stroke-dasharray 和 stroke-dashoffset
 * - CSS animation 控制绘制过程
 * - 圆形背景 + 打勾路径
 *
 * @example
 * ```tsx
 * <AnimatedCheckmark size={48} color="#10b981" animate />
 * ```
 */
export const AnimatedCheckmark: React.FC<AnimatedCheckmarkProps> = ({
  size = 32,
  color = '#10b981',
  animate = true,
  className = '',
}) => {
  const { t } = useLanguage();
  return (
    <div
      className={`${styles.checkmarkContainer} ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={t('checkmark.completed')}
    >
      <svg
        className={styles.checkmarkSvg}
        width={size}
        height={size}
        viewBox="0 0 52 52"
        xmlns="http://www.w3.org/2000/svg"
        style={{ color }}
      >
        {/* 背景圆圈 */}
        <circle
          className={styles.checkmarkCircle}
          cx="26"
          cy="26"
          r="25"
        />

        {/* 打勾路径 */}
        <path
          className={`${styles.checkmarkPath} ${animate ? styles.animate : ''}`}
          d="M14.1 27.2l7.1 7.2 16.7-16.8"
        />
      </svg>
    </div>
  );
};

export default AnimatedCheckmark;
