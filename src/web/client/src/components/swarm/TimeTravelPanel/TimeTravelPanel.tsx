import React, { useState, useEffect, useCallback } from 'react';
import styles from './TimeTravelPanel.module.css';
import { timeTravelApi } from '../../../api/blueprint';
import { useLanguage } from '../../../i18n';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 检查点信息
 */
interface CheckpointInfo {
  id: string;
  type: 'task' | 'global';
  name: string;
  description?: string;
  timestamp: string;
  taskId?: string;
  taskName?: string;
  taskPath?: string[];
  status: string;
  canRestore: boolean;
  hasCodeChanges: boolean;
  codeChangesCount: number;
}

/**
 * 分支信息
 */
interface BranchInfo {
  id: string;
  name: string;
  fromCheckpoint: string;
  createdAt: string;
  status: 'active' | 'merged' | 'abandoned';
}

/**
 * 时间线视图
 */
interface TimelineView {
  checkpoints: CheckpointInfo[];
  currentPosition: string | null;
  branches: BranchInfo[];
}

/**
 * 任务变更
 */
interface TaskChange {
  taskId: string;
  taskName: string;
  fromStatus: string;
  toStatus: string;
  iterations?: number;
}

/**
 * 代码差异
 */
interface DiffInfo {
  filePath: string;
  type: 'added' | 'modified' | 'deleted';
  beforeContent?: string;
  afterContent?: string;
  additions: number;
  deletions: number;
}

/**
 * 比较结果
 */
interface CompareResult {
  fromCheckpoint: string;
  toCheckpoint: string;
  taskChanges: TaskChange[];
  codeChanges: DiffInfo[];
  timeElapsed: number;
}

/**
 * 面板状态
 */
type PanelState = 'list' | 'create' | 'compare' | 'preview' | 'branch';

// ============================================================================
// 组件 Props
// ============================================================================

interface TimeTravelPanelProps {
  treeId: string;
  onRefresh?: () => void;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化时间为相对时间
 */
function formatTimeAgo(timestamp: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return t('timeTravel.daysAgo', { count: days });
  } else if (hours > 0) {
    return t('timeTravel.hoursAgo', { count: hours });
  } else if (minutes > 0) {
    return t('timeTravel.minutesAgo', { count: minutes });
  } else {
    return t('timeTravel.justNow');
  }
}

/**
 * 格式化完整时间
 */
function formatFullTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 格式化时间差
 */
function formatTimeDiff(ms: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return t('timeTravel.daysAndHours', { days, hours: hours % 24 });
  } else if (hours > 0) {
    return t('timeTravel.hoursAndMinutes', { hours, minutes: minutes % 60 });
  } else if (minutes > 0) {
    return t('timeTravel.minutes', { count: minutes });
  } else {
    return t('timeTravel.seconds', { count: seconds });
  }
}

// ============================================================================
// TimeTravelPanel 组件
// ============================================================================

/**
 * 时光倒流面板
 *
 * 功能：
 * - 显示检查点列表（时间线视图）
 * - 创建新的检查点
 * - 预览和执行回滚
 * - 比较两个检查点的差异
 * - 从检查点创建分支
 */
export const TimeTravelPanel: React.FC<TimeTravelPanelProps> = ({
  treeId,
  onRefresh,
}) => {
  const { t } = useLanguage();

  // 状态
  const [panelState, setPanelState] = useState<PanelState>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 时间线数据
  const [timeline, setTimeline] = useState<TimelineView | null>(null);

  // 选中的检查点
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<CheckpointInfo | null>(null);
  const [compareFrom, setCompareFrom] = useState<CheckpointInfo | null>(null);
  const [compareTo, setCompareTo] = useState<CheckpointInfo | null>(null);

  // 比较结果
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // 预览结果
  const [previewResult, setPreviewResult] = useState<CompareResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // 创建检查点表单
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createIsGlobal, setCreateIsGlobal] = useState(true);
  const [creating, setCreating] = useState(false);

  // 创建分支表单
  const [branchName, setBranchName] = useState('');
  const [creatingBranch, setCreatingBranch] = useState(false);

  // 回滚状态
  const [rolling, setRolling] = useState(false);

  // ============================================================================
  // 数据获取
  // ============================================================================

  /**
   * 获取时间线数据
   */
  const fetchTimeline = useCallback(async () => {
    if (!treeId) {
      setError(t('timeTravel.missingTreeId'));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await timeTravelApi.getTimeline(treeId);
      setTimeline(data);
    } catch (err: any) {
      console.error('[TimeTravelPanel] 获取时间线失败:', err);
      setError(err.message || t('timeTravel.fetchTimelineFailed'));
    } finally {
      setLoading(false);
    }
  }, [treeId]);

  // 初始加载
  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  // ============================================================================
  // 检查点操作
  // ============================================================================

  /**
   * 创建检查点
   */
  const handleCreateCheckpoint = async () => {
    if (!createName.trim()) {
      alert(t('timeTravel.pleaseEnterCheckpointName'));
      return;
    }

    try {
      setCreating(true);
      const checkpointData: {
        name: string;
        description: string;
        isGlobal?: boolean;
        taskId?: string;
      } = {
        name: createName.trim(),
        description: createDescription.trim(),
        isGlobal: createIsGlobal,
      };
      await timeTravelApi.createCheckpoint(treeId, checkpointData);

      // 重置表单并刷新
      setCreateName('');
      setCreateDescription('');
      setCreateIsGlobal(true);
      setPanelState('list');
      await fetchTimeline();
      onRefresh?.();
    } catch (err: any) {
      console.error('[TimeTravelPanel] 创建检查点失败:', err);
      alert(t('timeTravel.createCheckpointFailed', { error: err.message }));
    } finally {
      setCreating(false);
    }
  };

  /**
   * 预览回滚效果
   */
  const handlePreview = async (checkpoint: CheckpointInfo) => {
    try {
      setPreviewing(true);
      setSelectedCheckpoint(checkpoint);
      const result = await timeTravelApi.previewRollback(treeId, checkpoint.id);
      setPreviewResult(result);
      setPanelState('preview');
    } catch (err: any) {
      console.error('[TimeTravelPanel] 预览回滚失败:', err);
      alert(t('timeTravel.previewRollbackFailed', { error: err.message }));
    } finally {
      setPreviewing(false);
    }
  };

  /**
   * 执行回滚
   */
  const handleRollback = async () => {
    if (!selectedCheckpoint) return;

    if (!confirm(t('timeTravel.confirmRollbackMessage', { name: selectedCheckpoint.name }))) {
      return;
    }

    try {
      setRolling(true);
      await timeTravelApi.rollback(treeId, selectedCheckpoint.id);
      alert(t('timeTravel.rollbackSuccess'));
      setPanelState('list');
      setPreviewResult(null);
      setSelectedCheckpoint(null);
      await fetchTimeline();
      onRefresh?.();
    } catch (err: any) {
      console.error('[TimeTravelPanel] 回滚失败:', err);
      alert(t('timeTravel.rollbackFailed', { error: err.message }));
    } finally {
      setRolling(false);
    }
  };

  // ============================================================================
  // 比较操作
  // ============================================================================

  /**
   * 开始比较模式
   */
  const handleStartCompare = () => {
    setPanelState('compare');
    setCompareFrom(null);
    setCompareTo(null);
    setCompareResult(null);
  };

  /**
   * 选择比较的检查点
   */
  const handleSelectForCompare = (checkpoint: CheckpointInfo) => {
    if (!compareFrom) {
      setCompareFrom(checkpoint);
    } else if (!compareTo && checkpoint.id !== compareFrom.id) {
      setCompareTo(checkpoint);
    } else if (checkpoint.id === compareFrom.id) {
      setCompareFrom(null);
    } else if (checkpoint.id === compareTo?.id) {
      setCompareTo(null);
    }
  };

  /**
   * 执行比较
   */
  const handleCompare = async () => {
    if (!compareFrom || !compareTo) return;

    try {
      setComparing(true);
      const result = await timeTravelApi.compare(treeId, compareFrom.id, compareTo.id);
      setCompareResult(result);
    } catch (err: any) {
      console.error('[TimeTravelPanel] 比较失败:', err);
      alert(t('timeTravel.compareFailed', { error: err.message }));
    } finally {
      setComparing(false);
    }
  };

  // ============================================================================
  // 分支操作
  // ============================================================================

  /**
   * 开始创建分支
   */
  const handleStartBranch = (checkpoint: CheckpointInfo) => {
    setSelectedCheckpoint(checkpoint);
    setBranchName('');
    setPanelState('branch');
  };

  /**
   * 创建分支
   */
  const handleCreateBranch = async () => {
    if (!selectedCheckpoint || !branchName.trim()) {
      alert(t('timeTravel.pleaseEnterBranchName'));
      return;
    }

    try {
      setCreatingBranch(true);
      await timeTravelApi.createBranch(treeId, selectedCheckpoint.id, branchName.trim());
      alert(t('timeTravel.branchCreateSuccess'));
      setPanelState('list');
      setBranchName('');
      setSelectedCheckpoint(null);
      await fetchTimeline();
      onRefresh?.();
    } catch (err: any) {
      console.error('[TimeTravelPanel] 创建分支失败:', err);
      alert(t('timeTravel.createBranchFailed', { error: err.message }));
    } finally {
      setCreatingBranch(false);
    }
  };

  // ============================================================================
  // 渲染函数
  // ============================================================================

  /**
   * 渲染检查点卡片
   */
  const renderCheckpointCard = (checkpoint: CheckpointInfo, isCompareMode: boolean = false) => {
    const isSelected = selectedCheckpoint?.id === checkpoint.id;
    const isFromSelected = compareFrom?.id === checkpoint.id;
    const isToSelected = compareTo?.id === checkpoint.id;

    return (
      <div
        key={checkpoint.id}
        className={`${styles.checkpointCard} ${styles[checkpoint.type]} ${
          isSelected || isFromSelected || isToSelected ? styles.selected : ''
        } ${styles.fadeIn}`}
        onClick={() => {
          if (isCompareMode) {
            handleSelectForCompare(checkpoint);
          } else {
            setSelectedCheckpoint(isSelected ? null : checkpoint);
          }
        }}
      >
        <div className={styles.checkpointHeader}>
          <div className={styles.checkpointInfo}>
            <div className={styles.checkpointName}>
              {checkpoint.name}
              <span className={`${styles.checkpointType} ${styles[checkpoint.type]}`}>
                {checkpoint.type === 'global' ? t('timeTravel.global') : t('timeTravel.task')}
              </span>
              {!checkpoint.canRestore && (
                <span className={styles.cannotRestore}>{t('timeTravel.cannotRestore')}</span>
              )}
            </div>
            {checkpoint.description && (
              <div className={styles.checkpointDescription}>{checkpoint.description}</div>
            )}
            {checkpoint.taskPath && checkpoint.taskPath.length > 0 && (
              <div className={styles.taskPath}>
                {checkpoint.taskPath.join(' > ')}
              </div>
            )}
          </div>
        </div>

        <div className={styles.checkpointMeta}>
          <div className={styles.metaItem}>
            <span className={styles.metaIcon}>&#128197;</span>
            <span title={formatFullTime(checkpoint.timestamp)}>
              {formatTimeAgo(checkpoint.timestamp, t)}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaIcon}>&#128196;</span>
            <span>{t('timeTravel.fileChanges', { count: checkpoint.codeChangesCount })}</span>
          </div>
          {checkpoint.taskName && (
            <div className={styles.metaItem}>
              <span className={styles.metaIcon}>&#128203;</span>
              <span>{checkpoint.taskName}</span>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        {!isCompareMode && isSelected && (
          <div className={styles.checkpointActions}>
            {checkpoint.canRestore && (
              <>
                <button
                  className={`${styles.smallButton} ${styles.previewButton}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePreview(checkpoint);
                  }}
                  disabled={previewing}
                >
                  {previewing ? t('timeTravel.loading') : t('timeTravel.previewRollback')}
                </button>
                <button
                  className={`${styles.smallButton} ${styles.branchButton}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartBranch(checkpoint);
                  }}
                >
                  {t('timeTravel.createBranch')}
                </button>
              </>
            )}
          </div>
        )}

        {/* 比较模式下的选择状态 */}
        {isCompareMode && (
          <div className={styles.checkpointActions}>
            {isFromSelected && (
              <span className={`${styles.smallButton} ${styles.selectButton}`}>{t('timeTravel.startPoint')}</span>
            )}
            {isToSelected && (
              <span className={`${styles.smallButton} ${styles.selectButton}`}>{t('timeTravel.endPoint')}</span>
            )}
          </div>
        )}
      </div>
    );
  };

  /**
   * 渲染比较结果
   */
  const renderCompareResult = (result: CompareResult) => {
    return (
      <div className={styles.compareResult}>
        {/* 任务变更 */}
        {result.taskChanges.length > 0 && (
          <div className={styles.compareSection}>
            <div className={styles.compareSectionTitle}>
              {t('timeTravel.taskStatusChanges')}
              <span className={styles.compareSectionCount}>{result.taskChanges.length}</span>
            </div>
            <div className={styles.taskChangeList}>
              {result.taskChanges.map((change, index) => (
                <div key={index} className={styles.taskChange}>
                  <span className={styles.taskChangeName}>{change.taskName}</span>
                  <div className={styles.statusChange}>
                    <span className={styles.statusFrom}>{change.fromStatus}</span>
                    <span className={styles.statusArrow}>&#8594;</span>
                    <span className={styles.statusTo}>{change.toStatus}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 代码变更 */}
        {result.codeChanges.length > 0 && (
          <div className={styles.compareSection}>
            <div className={styles.compareSectionTitle}>
              {t('timeTravel.codeChanges')}
              <span className={styles.compareSectionCount}>{result.codeChanges.length}</span>
            </div>
            <div className={styles.codeChangeList}>
              {result.codeChanges.map((change, index) => (
                <div key={index} className={`${styles.codeChange} ${styles[change.type]}`}>
                  <span className={styles.codeChangePath}>{change.filePath}</span>
                  <div className={styles.codeChangeStats}>
                    <span className={styles.additions}>+{change.additions}</span>
                    <span className={styles.deletions}>-{change.deletions}</span>
                  </div>
                  <span className={`${styles.codeChangeType} ${styles[change.type]}`}>
                    {change.type === 'added' ? t('timeTravel.added') : change.type === 'modified' ? t('timeTravel.modified') : t('timeTravel.deleted')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 时间差 */}
        <div className={styles.compareSection}>
          <div className={styles.compareSectionTitle}>
            {t('timeTravel.timeSpan')}
          </div>
          <div className={styles.taskChange}>
            {formatTimeDiff(Math.abs(result.timeElapsed), t)}
          </div>
        </div>
      </div>
    );
  };

  /**
   * 渲染分支列表
   */
  const renderBranches = (branches: BranchInfo[]) => {
    if (branches.length === 0) return null;

    return (
      <div className={styles.branchSection}>
        <div className={styles.branchTitle}>{t('timeTravel.activeBranches')}</div>
        <div className={styles.branchList}>
          {branches.map(branch => (
            <div key={branch.id} className={styles.branchCard}>
              <div className={styles.branchInfo}>
                <div className={styles.branchName}>{branch.name}</div>
                <div className={styles.branchMeta}>
                  {t('timeTravel.createdAt')} {formatTimeAgo(branch.createdAt, t)}
                </div>
              </div>
              <span className={`${styles.branchStatus} ${styles[branch.status]}`}>
                {branch.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ============================================================================
  // 主渲染
  // ============================================================================

  // 加载中
  if (loading) {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <p>{t('timeTravel.loadingTimeline')}</p>
        </div>
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className={styles.panel}>
        <div className={styles.error}>
          {error}
          <button
            className={`${styles.actionButton} ${styles.refreshButton}`}
            onClick={fetchTimeline}
            style={{ marginTop: 12 }}
          >
            {t('timeTravel.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* 头部 */}
      <div className={styles.header}>
        <div className={styles.title}>
          <span className={styles.titleIcon}>&#9200;</span>
          {t('timeTravel.title')}
        </div>
        <div className={styles.headerActions}>
          {panelState === 'list' && (
            <>
              <button
                className={`${styles.actionButton} ${styles.createButton}`}
                onClick={() => setPanelState('create')}
              >
                {t('timeTravel.createCheckpoint')}
              </button>
              <button
                className={`${styles.actionButton} ${styles.compareButton}`}
                onClick={handleStartCompare}
                disabled={!timeline || timeline.checkpoints.length < 2}
              >
                {t('timeTravel.compareCheckpoints')}
              </button>
              <button
                className={`${styles.actionButton} ${styles.refreshButton}`}
                onClick={fetchTimeline}
              >
                {t('timeTravel.refresh')}
              </button>
            </>
          )}
          {panelState !== 'list' && (
            <button
              className={`${styles.actionButton} ${styles.cancelButton}`}
              onClick={() => {
                setPanelState('list');
                setCompareFrom(null);
                setCompareTo(null);
                setCompareResult(null);
                setPreviewResult(null);
                setSelectedCheckpoint(null);
              }}
            >
              {t('timeTravel.backToList')}
            </button>
          )}
        </div>
      </div>

      {/* 创建检查点表单 */}
      {panelState === 'create' && (
        <div className={`${styles.createForm} ${styles.fadeIn}`}>
          <div className={styles.formTitle}>{t('timeTravel.createNewCheckpoint')}</div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t('timeTravel.checkpointName')}</label>
            <input
              type="text"
              className={styles.formInput}
              placeholder={t('timeTravel.checkpointNamePlaceholder')}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t('timeTravel.descriptionOptional')}</label>
            <textarea
              className={`${styles.formInput} ${styles.formTextarea}`}
              placeholder={t('timeTravel.descriptionPlaceholder')}
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formCheckbox}>
              <input
                type="checkbox"
                checked={createIsGlobal}
                onChange={(e) => setCreateIsGlobal(e.target.checked)}
              />
              <span className={styles.formLabel}>{t('timeTravel.globalCheckpointLabel')}</span>
            </label>
          </div>

          <div className={styles.formActions}>
            <button
              className={`${styles.actionButton} ${styles.cancelButton}`}
              onClick={() => {
                setPanelState('list');
                setCreateName('');
                setCreateDescription('');
                setCreateIsGlobal(true);
              }}
            >
              {t('timeTravel.cancel')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.submitButton}`}
              onClick={handleCreateCheckpoint}
              disabled={creating || !createName.trim()}
            >
              {creating ? t('timeTravel.creating') : t('timeTravel.createCheckpointSubmit')}
            </button>
          </div>
        </div>
      )}

      {/* 比较面板 */}
      {panelState === 'compare' && (
        <div className={`${styles.comparePanel} ${styles.fadeIn}`}>
          <div className={styles.compareHeader}>
            <div className={styles.compareTitle}>{t('timeTravel.selectTwoCheckpoints')}</div>
          </div>

          {/* 比较选择状态 */}
          <div className={styles.compareSelection}>
            <div className={styles.compareFrom}>
              <span className={styles.compareLabel}>{t('timeTravel.startPoint')}</span>
              <span className={styles.compareName}>
                {compareFrom ? compareFrom.name : t('timeTravel.clickToSelect')}
              </span>
            </div>
            <span className={styles.compareArrow}>&#8594;</span>
            <div className={styles.compareTo}>
              <span className={styles.compareLabel}>{t('timeTravel.endPoint')}</span>
              <span className={styles.compareName}>
                {compareTo ? compareTo.name : t('timeTravel.clickToSelect')}
              </span>
            </div>
          </div>

          {/* 比较按钮 */}
          {compareFrom && compareTo && !compareResult && (
            <button
              className={`${styles.actionButton} ${styles.compareButton}`}
              onClick={handleCompare}
              disabled={comparing}
              style={{ alignSelf: 'center' }}
            >
              {comparing ? t('timeTravel.comparing') : t('timeTravel.startCompare')}
            </button>
          )}

          {/* 比较结果 */}
          {compareResult && (
            <>
              <div className={styles.compareDivider}></div>
              {renderCompareResult(compareResult)}
            </>
          )}

          {/* 检查点列表 */}
          <div className={styles.compareDivider}></div>
          <div className={styles.timeline}>
            {timeline?.checkpoints.map(checkpoint => renderCheckpointCard(checkpoint, true))}
          </div>
        </div>
      )}

      {/* 预览面板 */}
      {panelState === 'preview' && selectedCheckpoint && (
        <div className={`${styles.previewPanel} ${styles.fadeIn}`}>
          <div className={styles.previewTitle}>
            &#9888; {t('timeTravel.previewRollbackTitle', { name: selectedCheckpoint.name })}
          </div>

          <div className={styles.previewWarning}>
            {t('timeTravel.rollbackWarning')}
          </div>

          {/* 预览结果 */}
          {previewResult && renderCompareResult(previewResult)}

          <div className={styles.previewActions}>
            <button
              className={`${styles.actionButton} ${styles.cancelButton}`}
              onClick={() => {
                setPanelState('list');
                setPreviewResult(null);
                setSelectedCheckpoint(null);
              }}
            >
              {t('timeTravel.cancel')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.confirmRollback}`}
              onClick={handleRollback}
              disabled={rolling}
            >
              {rolling ? t('timeTravel.rollingBack') : t('timeTravel.confirmRollback')}
            </button>
          </div>
        </div>
      )}

      {/* 创建分支弹窗 */}
      {panelState === 'branch' && selectedCheckpoint && (
        <div className={`${styles.branchModal} ${styles.fadeIn}`}>
          <div className={styles.branchModalTitle}>
            {t('timeTravel.createBranchFrom', { name: selectedCheckpoint.name })}
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>{t('timeTravel.branchName')}</label>
            <input
              type="text"
              className={styles.formInput}
              placeholder={t('timeTravel.branchNamePlaceholder')}
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
            />
          </div>

          <div className={styles.formActions}>
            <button
              className={`${styles.actionButton} ${styles.cancelButton}`}
              onClick={() => {
                setPanelState('list');
                setBranchName('');
                setSelectedCheckpoint(null);
              }}
            >
              {t('timeTravel.cancel')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.branchButton}`}
              onClick={handleCreateBranch}
              disabled={creatingBranch || !branchName.trim()}
            >
              {creatingBranch ? t('timeTravel.creating') : t('timeTravel.createBranch')}
            </button>
          </div>
        </div>
      )}

      {/* 检查点列表 */}
      {panelState === 'list' && (
        <>
          {timeline && timeline.checkpoints.length > 0 ? (
            <div className={styles.timeline}>
              {timeline.checkpoints.map(checkpoint => renderCheckpointCard(checkpoint))}
            </div>
          ) : (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>&#128368;</div>
              <div className={styles.emptyText}>{t('timeTravel.noCheckpoints')}</div>
              <button
                className={`${styles.actionButton} ${styles.createButton}`}
                onClick={() => setPanelState('create')}
              >
                {t('timeTravel.createFirstCheckpoint')}
              </button>
            </div>
          )}

          {/* 分支列表 */}
          {timeline && renderBranches(timeline.branches)}
        </>
      )}
    </div>
  );
};

export default TimeTravelPanel;
