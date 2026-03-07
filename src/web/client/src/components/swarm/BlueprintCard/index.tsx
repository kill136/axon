import React from 'react';
import styles from './BlueprintCard.module.css';
import { ProgressBar } from '../common/ProgressBar';
import { blueprintApi, coordinatorApi } from '../../../api/blueprint';
import { useLanguage } from '../../../i18n';

/**
 * 蓝图数据类型（用于列表展示）
 */
export interface BlueprintCardData {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  moduleCount?: number;
  processCount?: number;
  nfrCount?: number;
  progress?: number; // 0-100，仅 running 状态有效
  workerStats?: {
    total: number;
    working: number;
    idle: number;
  };
}

/**
 * 卡片变体类型
 * - current: 当前活跃蓝图（大卡片，醒目样式）
 * - history: 历史蓝图（小卡片，淡化样式）
 * - default: 默认样式
 */
export type BlueprintCardVariant = 'current' | 'history' | 'default';

interface BlueprintCardProps {
  blueprint: BlueprintCardData;
  isSelected: boolean;
  onClick: (blueprintId: string) => void;
  onNavigateToSwarm?: () => void;
  /** 卡片变体样式 */
  variant?: BlueprintCardVariant;
  /** 刷新列表回调，操作完成后调用 */
  onRefresh?: () => void;
}

/**
 * BlueprintCard - 蓝图列表卡片组件
 */
export const BlueprintCard: React.FC<BlueprintCardProps> = ({
  blueprint,
  isSelected,
  onClick,
  onNavigateToSwarm,
  variant = 'default',
  onRefresh,
}) => {
  const { t } = useLanguage();

  // 状态图标映射
  const statusIcons: Record<BlueprintCardData['status'], string> = {
    pending: '🟡',
    running: '🟢',
    paused: '⏸️',
    completed: '✅',
    failed: '❌',
  };

  // 状态文本映射
  const statusTexts: Record<BlueprintCardData['status'], string> = {
    pending: t('blueprint.statusPending'),
    running: t('blueprint.statusRunning'),
    paused: t('blueprint.statusPaused'),
    completed: t('blueprint.statusCompleted'),
    failed: t('blueprint.statusFailed'),
  };

  // 格式化日期
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours === 0) {
        const minutes = Math.floor(diff / (1000 * 60));
        return t('blueprint.minutesAgo', { count: minutes });
      }
      return t('blueprint.hoursAgo', { count: hours });
    } else if (days < 7) {
      return t('blueprint.daysAgo', { count: days });
    } else {
      return date.toLocaleDateString('zh-CN');
    }
  };

  // 处理卡片点击
  const handleCardClick = () => {
    onClick(blueprint.id);
  };

  // 处理操作按钮点击
  const handleActionClick = async (e: React.MouseEvent, action: string) => {
    e.stopPropagation();
    console.log(`[BlueprintCard] Action: ${action}, Blueprint: ${blueprint.id}`);

    try {
      switch (action) {
        case 'approve':
          await blueprintApi.approveBlueprint(blueprint.id, 'admin');
          console.log('[BlueprintCard] 蓝图已批准');
          onRefresh?.();
          break;

        case 'reject':
          const reason = prompt(t('blueprint.rejectPrompt'));
          if (reason) {
            await blueprintApi.rejectBlueprint(blueprint.id, reason);
            console.log('[BlueprintCard] 蓝图已拒绝');
            onRefresh?.();
          }
          break;

        case 'pause':
        case 'stop':
          if (action === 'stop' && !confirm(t('blueprint.confirmStop'))) {
            break;
          }
          await coordinatorApi.stop();
          console.log('[BlueprintCard] 蓝图执行已暂停');
          onRefresh?.();
          break;

        case 'resume':
          await coordinatorApi.resume(blueprint.id);
          console.log('[BlueprintCard] 蓝图执行已恢复');
          onRefresh?.();
          break;

        case 'view-swarm':
          onNavigateToSwarm?.();
          break;

        case 'view-detail':
          break;

        default:
          console.warn(`[BlueprintCard] 未知操作: ${action}`);
      }
    } catch (error) {
      console.error(`[BlueprintCard] 操作失败:`, error);
      alert(t('blueprint.operationFailed', { message: error instanceof Error ? error.message : t('blueprint.unknownError') }));
    }
  };

  // 渲染操作按钮
  const renderActionButtons = () => {
    switch (blueprint.status) {
      case 'pending':
        return (
          <div className={styles.actionButtons}>
            <button
              className={`${styles.actionButton} ${styles.approve}`}
              onClick={(e) => handleActionClick(e, 'approve')}
              title={t('blueprint.approveTitle')}
            >
              {t('blueprint.approve')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.reject}`}
              onClick={(e) => handleActionClick(e, 'reject')}
              title={t('blueprint.rejectTitle')}
            >
              {t('blueprint.reject')}
            </button>
          </div>
        );
      case 'running':
        return (
          <div className={styles.actionButtons}>
            <button
              className={`${styles.actionButton} ${styles.pause}`}
              onClick={(e) => handleActionClick(e, 'pause')}
              title={t('blueprint.pauseTitle')}
            >
              {t('blueprint.pause')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.viewSwarm}`}
              onClick={(e) => handleActionClick(e, 'view-swarm')}
              title={t('blueprint.viewSwarmTitle')}
            >
              {t('blueprint.viewSwarm')}
            </button>
          </div>
        );
      case 'paused':
        return (
          <div className={styles.actionButtons}>
            <button
              className={`${styles.actionButton} ${styles.resume}`}
              onClick={(e) => handleActionClick(e, 'resume')}
              title={t('blueprint.resumeTitle')}
            >
              {t('blueprint.resume')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.stop}`}
              onClick={(e) => handleActionClick(e, 'stop')}
              title={t('blueprint.stopTitle')}
            >
              {t('blueprint.stop')}
            </button>
          </div>
        );
      case 'completed':
      case 'failed':
        return (
          <div className={styles.actionButtons}>
            <button
              className={`${styles.actionButton} ${styles.viewDetail}`}
              onClick={(e) => handleActionClick(e, 'view-detail')}
              title={t('blueprint.viewDetailTitle')}
            >
              {t('blueprint.viewDetail')}
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  // 计算卡片的 className
  const cardClassName = [
    styles.card,
    isSelected ? styles.selected : '',
    styles[blueprint.status],
    variant !== 'default' ? styles[`variant-${variant}`] : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cardClassName}
      onClick={handleCardClick}
    >
      {/* 卡片头部 */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.statusIcon}>{statusIcons[blueprint.status]}</span>
          <h3 className={styles.title}>{blueprint.name}</h3>
        </div>
        <span className={`${styles.statusBadge} ${styles[blueprint.status]}`}>
          {statusTexts[blueprint.status]}
        </span>
      </div>

      {/* 描述 */}
      {blueprint.description && (
        <p className={styles.description}>{blueprint.description}</p>
      )}

      {/* 统计信息 */}
      <div className={styles.stats}>
        <span className={styles.statItem}>
          <span className={styles.statIcon}>🧩</span>
          {t('blueprint.cardModules', { count: blueprint.moduleCount || 0 })}
        </span>
        <span className={styles.statSeparator}>·</span>
        <span className={styles.statItem}>
          <span className={styles.statIcon}>📊</span>
          {t('blueprint.cardProcesses', { count: blueprint.processCount || 0 })}
        </span>
        <span className={styles.statSeparator}>·</span>
        <span className={styles.statItem}>
          <span className={styles.statIcon}>🎯</span>
          {t('blueprint.cardNfrs', { count: blueprint.nfrCount || 0 })}
        </span>
      </div>

      {/* 执行中状态的进度信息 */}
      {blueprint.status === 'running' && (
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressLabel}>{t('blueprint.executionProgress')}</span>
            <span className={styles.progressValue}>{blueprint.progress || 0}%</span>
          </div>
          <ProgressBar
            value={blueprint.progress || 0}
            color="green"
            animated
            className={styles.progressBar}
          />
          {blueprint.workerStats && (
            <div className={styles.workerStats}>
              <span className={styles.workerStat}>
                🐝 {t('blueprint.workerTotal', { count: blueprint.workerStats.total })}
              </span>
              <span className={styles.workerSeparator}>|</span>
              <span className={styles.workerStat}>
                💼 {t('blueprint.workerWorking', { count: blueprint.workerStats.working })}
              </span>
              <span className={styles.workerSeparator}>|</span>
              <span className={styles.workerStat}>
                💤 {t('blueprint.workerIdle', { count: blueprint.workerStats.idle })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 卡片底部 */}
      <div className={styles.footer}>
        <span className={styles.timestamp}>
          {t('blueprint.createdAt', { time: formatDate(blueprint.createdAt) })}
        </span>
        {renderActionButtons()}
      </div>
    </div>
  );
};

export default BlueprintCard;
