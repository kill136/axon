import React from 'react';
import { useLanguage } from '../../../i18n';
import styles from './WorkerPanel.module.css';

/**
 * Worker 决策记录
 */
export interface WorkerDecision {
  type: 'strategy' | 'skip_test' | 'add_test' | 'install_dep' | 'retry' | 'other';
  description: string;
  timestamp: string;
}

/**
 * Worker Agent 状态类型定义 - v2.0 自治 Worker
 *
 * v2.0 变化：
 * - status 简化为 idle/working/waiting/error
 * - 移除 tddPhase，Worker 自主决策
 * - 新增 currentAction 展示当前操作
 * - 新增 decisions 展示自主决策记录
 */
export interface WorkerAgent {
  id: string;
  // v2.0: 简化的状态
  status: 'idle' | 'working' | 'waiting' | 'error';
  taskId?: string;
  taskName?: string;
  progress: number; // 0-100
  retryCount: number;
  maxRetries: number;
  duration?: number; // 秒

  // v2.0 新增字段
  branchName?: string;
  branchStatus?: 'active' | 'merged' | 'conflict';
  modelUsed?: 'opus' | 'sonnet' | 'haiku';
  currentAction?: {
    type: 'read' | 'write' | 'edit' | 'run_test' | 'install_dep' | 'git' | 'think';
    description: string;
    startedAt: string;
  };
  decisions?: WorkerDecision[];
}

interface WorkerCardProps {
  worker: WorkerAgent;
}

/**
 * v2.0: Worker 自治，不再使用固定 TDD 阶段
 * 改为展示当前操作类型
 * v2.0 新增: explore（探索代码库）、analyze（分析目标文件）
 */
const ACTION_TYPE_ICONS = {
  read: '📖',
  write: '✍️',
  edit: '📝',
  run_test: '🧪',
  install_dep: '📦',
  git: '🌿',
  think: '🤔',
  // v2.0 新增：Agent 模式操作
  explore: '🔍',
  analyze: '🔬',
} as const;

/**
 * Worker 卡片组件
 * 显示单个 Worker Agent 的详细状态
 */
export const WorkerCard: React.FC<WorkerCardProps> = ({ worker }) => {
  const { t } = useLanguage();

  // v2.0: 简化的状态图标映射
  const statusIcons: Record<WorkerAgent['status'], string> = {
    idle: '💤',
    working: '💻',
    waiting: '⏳',
    error: '❌',
  };

  // v2.0: 简化的状态文本映射
  const statusTexts: Record<WorkerAgent['status'], string> = {
    idle: t('workerCard.idle'),
    working: t('workerCard.working'),
    waiting: t('workerCard.waiting'),
    error: t('workerCard.error'),
  };

  // 呼吸灯状态 - v2.0 新增 error 状态
  const getStatusLightClass = () => {
    if (worker.status === 'idle') return 'idle';
    if (worker.status === 'waiting') return 'waiting';
    if (worker.status === 'error') return 'error';
    return 'working';
  };

  // 格式化时长
  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '0s';

    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;

    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  // v2.0: Action type label 映射（i18n）
  const actionTypeLabels: Record<string, string> = {
    read: t('workerCard.actionRead'),
    write: t('workerCard.actionWrite'),
    edit: t('workerCard.actionEdit'),
    run_test: t('workerCard.actionRunTest'),
    install_dep: t('workerCard.actionInstallDep'),
    git: t('workerCard.actionGit'),
    think: t('workerCard.actionThink'),
    explore: t('workerCard.actionExplore'),
    analyze: t('workerCard.actionAnalyze'),
  };

  // v2.0: 获取当前操作的显示信息
  const getCurrentActionDisplay = () => {
    if (!worker.currentAction) return null;
    const type = worker.currentAction.type as keyof typeof ACTION_TYPE_ICONS;
    const icon = ACTION_TYPE_ICONS[type] || '⚙️';
    const label = actionTypeLabels[type] || t('workerCard.actionDefault');
    return { icon, label };
  };

  // 重试次数警告
  const getRetryClass = () => {
    const ratio = worker.retryCount / worker.maxRetries;
    if (ratio >= 0.8) return 'danger';
    if (ratio >= 0.5) return 'warning';
    return '';
  };


  // v2.0: 决策类型文本映射
  const decisionTypeTexts: Record<string, string> = {
    strategy: t('workerCard.decisionStrategy'),
    skip_test: t('workerCard.decisionSkipTest'),
    add_test: t('workerCard.decisionAddTest'),
    install_dep: t('workerCard.decisionInstallDep'),
    retry: t('workerCard.decisionRetry'),
    other: t('workerCard.decisionOther'),
  };

  // v2.0: 模型文本映射
  const modelTexts: Record<string, string> = {
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
  };

  return (
    <div className={styles.workerCard}>
      {/* 卡片头部 */}
      <div className={styles.workerHeader}>
        <div className={styles.workerTitle}>
          <span className={styles.workerIcon}>🐝</span>
          <span>{worker.id}</span>
        </div>
        <div className={styles.workerHeaderRight}>
          {/* v2.0: 模型标签 */}
          {worker.modelUsed && (
            <span className={`${styles.modelBadge} ${styles[worker.modelUsed]}`}>
              {modelTexts[worker.modelUsed]}
            </span>
          )}
          <div className={`${styles.statusLight} ${styles[getStatusLightClass()]}`}
               title={statusTexts[worker.status]} />
        </div>
      </div>

      {/* Worker 信息 */}
      <div className={styles.workerInfo}>
        <div className={styles.workerInfoRow}>
          <span className={styles.workerInfoLabel}>{t('workerCard.statusLabel')}:</span>
          <span className={`${styles.workerInfoValue} ${styles.statusValue}`}>
            <span>{statusIcons[worker.status]}</span>
            <span>{statusTexts[worker.status]}</span>
          </span>
        </div>

        {/* 只在非空闲状态下显示当前任务，空闲状态下显示"等待分配" */}
        <div className={styles.workerInfoRow}>
          <span className={styles.workerInfoLabel}>{t('workerCard.taskLabel')}:</span>
          <span className={styles.workerInfoValue}>
            {worker.status === 'idle' ? (
              <span className={styles.noTask}>{t('workerCard.waitingForTask')}</span>
            ) : (
              worker.taskName || t('workerCard.unknownTask')
            )}
          </span>
        </div>

        {/* v2.0: Git 分支信息 */}
        {worker.branchName && (
          <div className={styles.workerInfoRow}>
            <span className={styles.workerInfoLabel}>{t('workerCard.branchLabel')}:</span>
            <span className={`${styles.workerInfoValue} ${styles.branchValue}`}>
              <span className={`${styles.branchIcon} ${styles[worker.branchStatus || 'active']}`}>
                🌿
              </span>
              <span className={styles.branchName}>{worker.branchName}</span>
              {worker.branchStatus === 'conflict' && (
                <span className={styles.conflictBadge}>{t('workerCard.conflict')}</span>
              )}
              {worker.branchStatus === 'merged' && (
                <span className={styles.mergedBadge}>{t('workerCard.merged')}</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* v2.0: 当前操作展示（替代旧的 TDD 阶段指示器） */}
      {worker.status === 'working' && worker.currentAction && (
        <div className={styles.currentActionSection}>
          <div className={styles.currentActionTitle}>{t('workerCard.currentAction')}</div>
          <div className={styles.currentActionContent}>
            {(() => {
              const actionDisplay = getCurrentActionDisplay();
              return actionDisplay ? (
                <div className={styles.actionItem}>
                  <span className={styles.actionTypeIcon}>{actionDisplay.icon}</span>
                  <span className={styles.actionTypeLabel}>{actionDisplay.label}</span>
                  <span className={styles.actionDescription}>{worker.currentAction.description}</span>
                </div>
              ) : null;
            })()}
          </div>
        </div>
      )}

      {/* 进度条 */}
      {worker.status !== 'idle' && (
        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>
            <span className={styles.progressLabel}>{t('workerCard.progress')}</span>
            <span className={styles.progressValue}>{worker.progress}%</span>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${worker.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* 元数据：重试次数和耗时 */}
      {worker.status !== 'idle' && (
        <div className={styles.workerMeta}>
          <div className={`${styles.retryInfo} ${styles[getRetryClass()]}`}>
            <span>🔄</span>
            <span>{t('workerCard.retry')}: {worker.retryCount}/{worker.maxRetries}</span>
          </div>
          <div className={styles.duration}>
            <span>⏱️</span>
            <span>{t('workerCard.duration')}: {formatDuration(worker.duration)}</span>
          </div>
        </div>
      )}

      {/* v2.0: 决策记录 */}
      {worker.decisions && worker.decisions.length > 0 && (
        <div className={styles.decisionsSection}>
          <div className={styles.decisionsSectionTitle}>
            <span>🤖</span>
            <span>{t('workerCard.autonomousDecisions')}</span>
          </div>
          <div className={styles.decisionsList}>
            {worker.decisions.slice(-3).map((decision, index) => (
              <div key={index} className={styles.decisionItem}>
                <span className={styles.decisionTypeBadge}>
                  {decisionTypeTexts[decision.type] || decision.type}
                </span>
                <span className={styles.decisionDescription}>
                  {decision.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkerCard;
