import React from 'react';
import styles from './animations.module.css';
import { useLanguage } from '../../../i18n';

/**
 * 呼吸灯组件 Props
 */
export interface BreathingLightProps {
  /** 是否激活呼吸灯效果 */
  active: boolean;
  /** 颜色主题 */
  color?: 'green' | 'blue' | 'yellow' | 'red';
  /** 大小（像素） */
  size?: number;
  /** 自定义类名 */
  className?: string;
}

/**
 * BreathingLight - 呼吸灯组件
 *
 * 功能：
 * - 呼吸式发光动画（box-shadow + opacity）
 * - 2s 的循环呼吸效果
 * - 支持 4 种颜色主题
 * - active 状态控制动画开关
 *
 * 使用场景：
 * - 在线状态指示
 * - 运行中的任务标识
 * - 实时更新提示
 *
 * @example
 * ```tsx
 * <BreathingLight active={isRunning} color="green" size={12} />
 * ```
 */
export const BreathingLight: React.FC<BreathingLightProps> = ({
  active,
  color = 'green',
  size = 10,
  className = '',
}) => {
  const { t } = useLanguage();
  return (
    <div
      className={`${styles.breathingLight} ${active ? styles.active : styles.inactive} ${active ? styles[color] : ''} ${className}`}
      style={{
        width: size,
        height: size,
      }}
      role="status"
      aria-label={active ? t('breathingLight.active', { color }) : t('breathingLight.inactive')}
      aria-live="polite"
    />
  );
};

export default BreathingLight;
