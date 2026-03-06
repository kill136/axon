import React, { useState } from 'react';
import styles from './TaskTree.module.css';
import { useLanguage } from '../../../i18n';

/**
 * TaskNode 类型定义 - v2.0 简化版
 *
 * v2.0 变化：
 * - status 使用后端一致的状态名
 * - 新增 skipped 状态
 */
export interface TaskNode {
  id: string;
  name: string;
  // v2.0: 与后端一致的状态
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  progress?: number; // 0-100
  children: TaskNode[];

  // v2.0 新增字段
  type?: 'code' | 'config' | 'test' | 'refactor' | 'docs' | 'integrate';
  complexity?: 'trivial' | 'simple' | 'moderate' | 'complex';
  needsTest?: boolean;
  workerId?: string;
  estimatedMinutes?: number;

  // 失败原因（当 status === 'failed' 时）
  error?: string;
}

interface TaskNodeProps {
  node: TaskNode;
  level: number;
  selectedTaskId?: string;
  onTaskSelect?: (taskId: string) => void;
}

interface StatusConfigItem {
  icon: string;
  label: string;
  color: string;
  animated?: string;
}

// v2.0: 与后端一致的状态配置（label 使用 i18n key）
const STATUS_CONFIG: Record<TaskNode['status'], StatusConfigItem> = {
  pending: { icon: '⏳', label: 'taskNode.status.pending', color: '#999' },
  running: { icon: '💻', label: 'taskNode.status.running', color: '#3b82f6', animated: 'pulse' },
  completed: { icon: '✅', label: 'taskNode.status.completed', color: '#10b981' },
  failed: { icon: '❌', label: 'taskNode.status.failed', color: '#ef4444' },
  skipped: { icon: '⏭️', label: 'taskNode.status.skipped', color: '#6b7280' },
};

// v2.0: 任务类型配置（label 使用 i18n key）
const TYPE_CONFIG: Record<string, { icon: string; label: string }> = {
  code: { icon: '💻', label: 'taskNode.type.code' },
  config: { icon: '⚙️', label: 'taskNode.type.config' },
  test: { icon: '🧪', label: 'taskNode.type.test' },
  refactor: { icon: '♻️', label: 'taskNode.type.refactor' },
  docs: { icon: '📚', label: 'taskNode.type.docs' },
  integrate: { icon: '🔗', label: 'taskNode.type.integrate' },
};

// v2.0: 复杂度配置（label 使用 i18n key）
const COMPLEXITY_CONFIG: Record<string, { label: string; color: string }> = {
  trivial: { label: 'taskNode.complexity.trivial', color: '#4ade80' },
  simple: { label: 'taskNode.complexity.simple', color: '#60a5fa' },
  moderate: { label: 'taskNode.complexity.moderate', color: '#fbbf24' },
  complex: { label: 'taskNode.complexity.complex', color: '#f87171' },
};

export const TaskNodeComponent: React.FC<TaskNodeProps> = ({
  node,
  level,
  selectedTaskId,
  onTaskSelect,
}) => {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const statusConfig = STATUS_CONFIG[node.status];
  const isSelected = node.id === selectedTaskId;

  // 计算子任务统计 - v2.0 使用 'completed' 状态
  const getChildStats = (node: TaskNode): { total: number; completed: number } => {
    if (!node.children || node.children.length === 0) {
      return { total: 0, completed: 0 };
    }

    let total = node.children.length;
    let completed = node.children.filter(child => child.status === 'completed').length;

    return { total, completed };
  };

  const childStats = hasChildren ? getChildStats(node) : null;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasChildren) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleSelect = () => {
    if (onTaskSelect) {
      onTaskSelect(node.id);
    }
  };

  const renderProgressBar = () => {
    if (node.progress === undefined || node.progress === null) {
      return null;
    }

    const filledBlocks = Math.floor(node.progress / 10);
    const halfBlock = node.progress % 10 >= 5;

    return (
      <span className={styles.progressBar}>
        {Array.from({ length: filledBlocks }).map((_, i) => (
          <span key={`filled-${i}`} className={styles.progressFilled}>█</span>
        ))}
        {halfBlock && <span className={styles.progressHalf}>▓</span>}
        {Array.from({ length: 10 - filledBlocks - (halfBlock ? 1 : 0) }).map((_, i) => (
          <span key={`empty-${i}`} className={styles.progressEmpty}>░</span>
        ))}
      </span>
    );
  };

  return (
    <div className={styles.taskNodeWrapper}>
      <div
        className={`${styles.taskNode} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${level * 20}px` }}
        onClick={handleSelect}
      >
        {/* 展开/折叠图标 */}
        <span
          className={`${styles.expandIcon} ${!hasChildren ? styles.noChildren : ''}`}
          onClick={handleToggle}
        >
          {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
        </span>

        {/* 文件夹/文件图标 */}
        <span className={styles.folderIcon}>
          {hasChildren ? '📁' : '📄'}
        </span>

        {/* 任务名称 */}
        <span className={styles.taskName}>{node.name}</span>

        {/* v2.0: 任务类型标签 */}
        {node.type && TYPE_CONFIG[node.type] && (
          <span className={styles.typeTag} title={t(TYPE_CONFIG[node.type].label)}>
            {TYPE_CONFIG[node.type].icon}
          </span>
        )}

        {/* v2.0: 复杂度标签 */}
        {node.complexity && COMPLEXITY_CONFIG[node.complexity] && (
          <span
            className={styles.complexityTag}
            style={{ color: COMPLEXITY_CONFIG[node.complexity].color }}
            title={`${t('taskNode.complexityLabel')}: ${t(COMPLEXITY_CONFIG[node.complexity].label)}`}
          >
            {node.complexity === 'complex' ? '◆' :
             node.complexity === 'moderate' ? '◇' :
             node.complexity === 'simple' ? '○' : '·'}
          </span>
        )}

        {/* v2.0: 需要测试标记 */}
        {node.needsTest && (
          <span className={styles.needsTestTag} title={t('taskNode.needsTest')}>
            🧪
          </span>
        )}

        {/* v2.0: Worker 分配 */}
        {node.workerId && (
          <span className={styles.workerTag} title={`Worker: ${node.workerId}`}>
            🐝
          </span>
        )}

        {/* 子任务统计 */}
        {childStats && (
          <span
            className={styles.childStats}
            style={{ color: statusConfig.color }}
          >
            {childStats.completed}/{childStats.total}
          </span>
        )}

        {/* 状态标签 */}
        <span
          className={`${styles.statusBadge} ${statusConfig.animated ? styles[statusConfig.animated] : ''}`}
          style={{ color: statusConfig.color }}
        >
          <span className={styles.statusIcon}>{statusConfig.icon}</span>
          <span className={styles.statusLabel}>{t(statusConfig.label)}</span>
        </span>

        {/* 失败原因显示 */}
        {node.status === 'failed' && node.error && (
          <span
            className={styles.errorReason}
            title={node.error}
            style={{ color: '#ef4444', marginLeft: '8px', fontSize: '0.85em' }}
          >
            ⚠️ {node.error.length > 30 ? node.error.substring(0, 30) + '...' : node.error}
          </span>
        )}

        {/* v2.0: 预估时间 */}
        {node.estimatedMinutes !== undefined && node.estimatedMinutes > 0 && (
          <span className={styles.estimatedTime} title={t('taskNode.estimatedTime')}>
            ⏱️ {node.estimatedMinutes}m
          </span>
        )}

        {/* 进度条 */}
        {node.progress !== undefined && renderProgressBar()}
      </div>

      {/* 子任务 */}
      {hasChildren && isExpanded && (
        <div className={styles.children}>
          {node.children.map((child) => (
            <TaskNodeComponent
              key={child.id}
              node={child}
              level={level + 1}
              selectedTaskId={selectedTaskId}
              onTaskSelect={onTaskSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};
