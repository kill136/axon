import React from 'react';
import { useLanguage } from '../../../i18n';
import styles from './WorkerPanel.module.css';

/**
 * Queen Agent 状态类型定义
 */
export interface QueenAgent {
  status: 'idle' | 'planning' | 'coordinating' | 'reviewing' | 'paused';
  decision?: string;
}

interface QueenStatusProps {
  queen: QueenAgent;
}

/**
 * Queen 状态组件
 * 显示 Queen Agent 的当前状态和决策信息
 */
export const QueenStatus: React.FC<QueenStatusProps> = ({ queen }) => {
  const { t } = useLanguage();

  // 状态图标映射
  const statusIcons: Record<QueenAgent['status'], string> = {
    idle: '💤',
    planning: '🧠',
    coordinating: '📋',
    reviewing: '🔍',
    paused: '⏸️',
  };

  // 状态文本映射
  const statusTexts: Record<QueenAgent['status'], string> = {
    idle: t('queenStatus.idle'),
    planning: t('queenStatus.planning'),
    coordinating: t('queenStatus.coordinating'),
    reviewing: t('queenStatus.reviewing'),
    paused: t('queenStatus.paused'),
  };

  return (
    <div className={styles.queenCard}>
      <div className={styles.queenHeader}>
        <div className={styles.queenTitle}>
          <span className={styles.queenIcon}>👑</span>
          <span>Queen Agent</span>
        </div>
        <div className={`${styles.queenStatusBadge} ${styles[queen.status]}`}>
          {statusIcons[queen.status]} {statusTexts[queen.status]}
        </div>
      </div>

      {queen.decision && (
        <div className={styles.queenDecision}>
          <strong>{t('queenStatus.currentDecision')}:</strong> {queen.decision}
        </div>
      )}
    </div>
  );
};

export default QueenStatus;
