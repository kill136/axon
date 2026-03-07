import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styles from './TDDPanel.module.css';
import { tddApi, TDDLoopState, TDDPhase, TestResult, PhaseTransition } from '../../../api/blueprint';
import { SplitPanes } from '../../common/SplitPanes';
import { useLanguage } from '../../../i18n';

// ============================================================================
// 类型定义
// ============================================================================

interface TDDPanelProps {
  /** 任务树ID（可选，用于启动新的TDD循环） */
  treeId?: string;
  /** 任务ID（可选，用于显示特定任务的TDD状态） */
  taskId?: string;
  /** 是否自动刷新 */
  autoRefresh?: boolean;
  /** 刷新间隔（毫秒） */
  refreshInterval?: number;
  /** 状态变化回调 */
  onStateChange?: (state: TDDLoopState) => void;
}

// TDD 阶段配置（label/description 使用 i18n key，渲染时通过 t() 翻译）
const PHASE_CONFIG: Record<TDDPhase, { labelKey: string; icon: string; color: string; descriptionKey: string }> = {
  write_test: {
    labelKey: 'tdd.phaseWriteTest',
    icon: '📝',
    color: '#9c27b0',
    descriptionKey: 'tdd.phaseWriteTestDesc',
  },
  run_test_red: {
    labelKey: 'tdd.phaseRedLight',
    icon: '🔴',
    color: '#f44336',
    descriptionKey: 'tdd.phaseRedLightDesc',
  },
  write_code: {
    labelKey: 'tdd.phaseWriteCode',
    icon: '💻',
    color: '#2196f3',
    descriptionKey: 'tdd.phaseWriteCodeDesc',
  },
  run_test_green: {
    labelKey: 'tdd.phaseGreenLight',
    icon: '🟢',
    color: '#4caf50',
    descriptionKey: 'tdd.phaseGreenLightDesc',
  },
  refactor: {
    labelKey: 'tdd.phaseRefactor',
    icon: '🔧',
    color: '#ff9800',
    descriptionKey: 'tdd.phaseRefactorDesc',
  },
  done: {
    labelKey: 'tdd.phaseDone',
    icon: '✅',
    color: '#4caf50',
    descriptionKey: 'tdd.phaseDoneDesc',
  },
};

// 阶段顺序
const PHASE_ORDER: TDDPhase[] = ['write_test', 'run_test_red', 'write_code', 'run_test_green', 'refactor', 'done'];

// ============================================================================
// 主组件
// ============================================================================

export const TDDPanel: React.FC<TDDPanelProps> = ({
  treeId,
  taskId,
  autoRefresh = true,
  refreshInterval = 3000,
  onStateChange,
}) => {
  const { t } = useLanguage();

  // 状态
  const [loopState, setLoopState] = useState<TDDLoopState | null>(null);
  const [activeLoops, setActiveLoops] = useState<TDDLoopState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(taskId || null);
  const [phaseTransitioning, setPhaseTransitioning] = useState(false);

  // 状态一致性检查
  const [consistencyCheck, setConsistencyCheck] = useState<{
    total: number;
    consistent: number;
    inconsistent: number;
    details: Array<{
      taskId: string;
      treeId: string;
      tddPhase: TDDPhase;
      expectedTaskStatus: string;
      actualTaskStatus: string | null;
      isConsistent: boolean;
    }>;
  } | null>(null);
  const [showConsistencyPanel, setShowConsistencyPanel] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // 加载单个任务的TDD状态
  const loadLoopState = useCallback(async (tid: string) => {
    try {
      setLoading(true);
      setError(null);
      const state = await tddApi.getLoopState(tid);
      setLoopState(state);
      onStateChange?.(state);

      // 同时加载指南
      const guidanceText = await tddApi.getPhaseGuidance(tid);
      setGuidance(guidanceText);
    } catch (err: any) {
      // 如果是 "TDD loop not found" 错误，说明还没有启动循环，这不是一个真正的错误
      // 我们应该重置状态，以便显示启动按钮
      if (err.message && err.message.includes('TDD loop not found')) {
        setLoopState(null);
        setError(null);
        setGuidance(null);
        // 重要：如果当前选中的任务 TDD loop 不存在，且不是从 props 传入的 taskId，
        // 则清除选中状态以停止轮询
        if (tid === selectedTaskId && tid !== taskId) {
          setSelectedTaskId(null);
        }
      } else {
        setError(err.message || t('tdd.loadStateFailed'));
        setLoopState(null);
      }
    } finally {
      setLoading(false);
    }
  }, [onStateChange, selectedTaskId, taskId]);

  // 加载所有活跃的TDD循环
  const loadActiveLoops = useCallback(async () => {
    try {
      const loops = await tddApi.getActiveLoops();
      setActiveLoops(loops);

      // 如果有指定的taskId，选择它
      if (taskId && loops.some(l => l.taskId === taskId)) {
        setSelectedTaskId(taskId);
        loadLoopState(taskId);
      } else if (loops.length > 0 && !selectedTaskId) {
        // 否则选择第一个
        setSelectedTaskId(loops[0].taskId);
        loadLoopState(loops[0].taskId);
      } else if (selectedTaskId && !loops.some(l => l.taskId === selectedTaskId)) {
        // 如果当前选中的任务不在活跃列表中（可能被重置或清理了），清除选中状态
        setSelectedTaskId(null);
        setLoopState(null);
        setGuidance(null);
      }
    } catch (err: any) {
      console.error('加载活跃TDD循环失败:', err);
    }
  }, [taskId, selectedTaskId, loadLoopState]);

  // 启动新的TDD循环
  const startLoop = useCallback(async () => {
    if (!treeId || !taskId) {
      setError(t('tdd.requireTreeAndTaskId'));
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const state = await tddApi.startLoop(treeId, taskId);
      setLoopState(state);
      setSelectedTaskId(taskId);
      onStateChange?.(state);
      await loadActiveLoops();
    } catch (err: any) {
      setError(err.message || t('tdd.startLoopFailed'));
    } finally {
      setLoading(false);
    }
  }, [treeId, taskId, onStateChange, loadActiveLoops]);

  // 加载报告
  const loadReport = useCallback(async (tid: string) => {
    try {
      const reportText = await tddApi.getReport(tid);
      setReport(reportText);
      setShowReport(true);
    } catch (err: any) {
      console.error('加载报告失败:', err);
    }
  }, []);

  // 选择任务
  const handleSelectTask = useCallback((tid: string) => {
    setSelectedTaskId(tid);
    loadLoopState(tid);
    setShowReport(false);
  }, [loadLoopState]);

  // 阶段转换：跳转到指定阶段
  const handleTransitionPhase = useCallback(async (phase: TDDPhase) => {
    if (!selectedTaskId || phase === 'done') return;

    try {
      setPhaseTransitioning(true);
      setError(null);
      const state = await tddApi.transitionPhase(selectedTaskId, phase as any);
      setLoopState(state);
      onStateChange?.(state);

      // 重新加载指南
      const guidanceText = await tddApi.getPhaseGuidance(selectedTaskId);
      setGuidance(guidanceText);
    } catch (err: any) {
      setError(err.message || t('tdd.transitionFailed'));
    } finally {
      setPhaseTransitioning(false);
    }
  }, [selectedTaskId, onStateChange]);

  // 阶段转换：完成当前阶段
  const handleCompletePhase = useCallback(async () => {
    if (!selectedTaskId) return;

    try {
      setPhaseTransitioning(true);
      setError(null);
      const state = await tddApi.completePhase(selectedTaskId);
      setLoopState(state);
      onStateChange?.(state);

      // 重新加载指南
      if (state.phase !== 'done') {
        const guidanceText = await tddApi.getPhaseGuidance(selectedTaskId);
        setGuidance(guidanceText);
      }
    } catch (err: any) {
      setError(err.message || t('tdd.completePhaseError'));
    } finally {
      setPhaseTransitioning(false);
    }
  }, [selectedTaskId, onStateChange]);

  // 阶段转换：回退到上一阶段
  const handleRevertPhase = useCallback(async () => {
    if (!selectedTaskId) return;

    try {
      setPhaseTransitioning(true);
      setError(null);
      const state = await tddApi.revertPhase(selectedTaskId);
      setLoopState(state);
      onStateChange?.(state);

      // 重新加载指南
      const guidanceText = await tddApi.getPhaseGuidance(selectedTaskId);
      setGuidance(guidanceText);
    } catch (err: any) {
      setError(err.message || t('tdd.revertPhaseError'));
    } finally {
      setPhaseTransitioning(false);
    }
  }, [selectedTaskId, onStateChange]);

  // 检查状态一致性
  const handleCheckConsistency = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await tddApi.checkConsistency();
      setConsistencyCheck(result);
      setShowConsistencyPanel(true);
    } catch (err: any) {
      setError(err.message || t('tdd.checkConsistencyFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  // 同步单个任务状态
  const handleSyncState = useCallback(async (taskIdToSync: string) => {
    try {
      setSyncing(true);
      setError(null);
      const result = await tddApi.syncState(taskIdToSync);
      if (result.success) {
        // 重新检查一致性
        const checkResult = await tddApi.checkConsistency();
        setConsistencyCheck(checkResult);
        // 刷新当前状态
        if (taskIdToSync === selectedTaskId) {
          loadLoopState(taskIdToSync);
        }
        loadActiveLoops();
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || t('tdd.syncStateFailed'));
    } finally {
      setSyncing(false);
    }
  }, [selectedTaskId, loadLoopState, loadActiveLoops]);

  // 批量同步所有不一致状态
  const handleSyncAll = useCallback(async () => {
    try {
      setSyncing(true);
      setError(null);
      const result = await tddApi.syncAllStates();
      if (result.synced > 0 || result.failed > 0) {
        // 重新检查一致性
        const checkResult = await tddApi.checkConsistency();
        setConsistencyCheck(checkResult);
        // 刷新状态
        if (selectedTaskId) {
          loadLoopState(selectedTaskId);
        }
        loadActiveLoops();
      }
    } catch (err: any) {
      setError(err.message || t('tdd.syncAllFailed'));
    } finally {
      setSyncing(false);
    }
  }, [selectedTaskId, loadLoopState, loadActiveLoops]);

  // 清理孤立的 TDD 循环
  const handleCleanupOrphaned = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await tddApi.cleanupOrphaned();
      if (result.removedCount > 0) {
        // 刷新状态
        loadActiveLoops();
        if (selectedTaskId) {
          // 如果当前选中的循环被清理了，清除选中状态
          if (result.removedTasks.includes(selectedTaskId)) {
            setSelectedTaskId(null);
            setLoopState(null);
            setGuidance(null);
          } else {
            loadLoopState(selectedTaskId);
          }
        }
      }
    } catch (err: any) {
      setError(err.message || t('tdd.cleanupOrphanedFailed'));
    } finally {
      setLoading(false);
    }
  }, [selectedTaskId, loadLoopState, loadActiveLoops]);

  // 初始加载
  useEffect(() => {
    loadActiveLoops();
  }, []);

  // 自动刷新
  useEffect(() => {
    if (!autoRefresh || !selectedTaskId) return;

    const interval = setInterval(() => {
      loadLoopState(selectedTaskId);
      loadActiveLoops();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, selectedTaskId, loadLoopState, loadActiveLoops]);

  // 计算当前阶段索引
  const currentPhaseIndex = useMemo(() => {
    if (!loopState) return -1;
    return PHASE_ORDER.indexOf(loopState.phase);
  }, [loopState]);

  // 渲染阶段指示器
  const renderPhaseIndicator = () => {
    if (!loopState) return null;

    const isDone = loopState.phase === 'done';

    return (
      <div className={styles.phaseIndicator}>
        <div className={styles.phaseTitle}>{t('tdd.loopProgress')}</div>
        <div className={styles.phaseTimeline}>
          {PHASE_ORDER.filter(p => p !== 'done').map((phase, index) => {
            const config = PHASE_CONFIG[phase];
            const isActive = phase === loopState.phase;
            const isCompleted = currentPhaseIndex > index || isDone;
            const isPending = currentPhaseIndex < index;
            const canClick = !isDone && !phaseTransitioning && phase !== loopState.phase;

            return (
              <div
                key={phase}
                className={`${styles.phaseItem} ${isActive ? styles.active : ''} ${isCompleted ? styles.completed : ''} ${isPending ? styles.pending : ''} ${canClick ? styles.clickable : ''}`}
                onClick={() => canClick && handleTransitionPhase(phase)}
                title={canClick ? t('tdd.clickToJump', { phase: t(config.labelKey) }) : (isDone ? t('tdd.taskCompleted') : t(config.labelKey))}
              >
                <div
                  className={styles.phaseNode}
                  style={{ borderColor: isActive || isCompleted ? config.color : undefined }}
                >
                  {isCompleted && !isActive ? (
                    <span className={styles.checkIcon}>✓</span>
                  ) : (
                    <span className={styles.phaseIcon}>{config.icon}</span>
                  )}
                </div>
                <div className={styles.phaseLabel}>{t(config.labelKey)}</div>
                {index < PHASE_ORDER.length - 2 && (
                  <div className={`${styles.phaseLine} ${isCompleted ? styles.completedLine : ''}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 渲染测试结果列表
  const renderTestResults = () => {
    if (!loopState || loopState.testResults.length === 0) return null;

    return (
      <div className={styles.testResults}>
        <div className={styles.sectionTitle}>{t('tdd.testHistory')}</div>
        <div className={styles.resultsList}>
          {loopState.testResults.slice(-5).reverse().map((result, index) => (
            <div
              key={result.id}
              className={`${styles.resultItem} ${result.passed ? styles.passed : styles.failed}`}
            >
              <span className={styles.resultIcon}>
                {result.passed ? '✅' : '❌'}
              </span>
              <span className={styles.resultInfo}>
                <span className={styles.resultStatus}>
                  {result.passed ? t('tdd.passed') : t('tdd.failed')}
                </span>
                <span className={styles.resultDuration}>
                  {result.duration}ms
                </span>
              </span>
              {result.errorMessage && (
                <span className={styles.resultError} title={result.errorMessage}>
                  {result.errorMessage.substring(0, 50)}...
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 渲染阶段历史
  const renderPhaseHistory = () => {
    if (!loopState || loopState.phaseHistory.length === 0) return null;

    return (
      <div className={styles.phaseHistory}>
        <div className={styles.sectionTitle}>{t('tdd.phaseTransitionHistory')}</div>
        <div className={styles.historyList}>
          {loopState.phaseHistory.slice(-5).reverse().map((transition, index) => (
            <div key={index} className={styles.historyItem}>
              <span className={styles.historyTransition}>
                {PHASE_CONFIG[transition.from]?.icon || '?'} → {PHASE_CONFIG[transition.to]?.icon || '?'}
              </span>
              <span className={styles.historyReason}>{transition.reason}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 渲染活跃循环列表
  const renderActiveLoops = () => {
    if (activeLoops.length === 0) {
      // 根据条件显示不同的引导信息
      let guidance = null;
      if (!treeId) {
        guidance = (
          <>
            <div className={styles.emptyHint}>
              <span className={styles.hintIcon}>💡</span>
              <span>{t('tdd.createOrSelectTree')}</span>
            </div>
            <div className={styles.emptySteps}>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>1</span>
                <span>{t('tdd.step1CreateBlueprint')}</span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>2</span>
                <span>{t('tdd.step2GenerateTree')}</span>
              </div>
              <div className={styles.stepItem}>
                <span className={styles.stepNumber}>3</span>
                <span>{t('tdd.step3SelectTask')}</span>
              </div>
            </div>
          </>
        );
      } else if (!taskId) {
        guidance = (
          <>
            <div className={styles.emptyHint}>
              <span className={styles.hintIcon}>👈</span>
              <span>{t('tdd.selectTaskInTree')}</span>
            </div>
            <div className={styles.emptyDescription}>
              {t('tdd.selectTaskDescription')}<br />
              {t('tdd.tddFlowDescription')}
            </div>
          </>
        );
      }

      return (
        <div className={styles.emptyLoops}>
          <div className={styles.emptyIcon}>🔄</div>
          <div className={styles.emptyText}>{t('tdd.noActiveLoops')}</div>
          {guidance}
          {treeId && taskId && (
            <button className={styles.startButton} onClick={startLoop} disabled={loading}>
              {loading ? t('tdd.starting') : t('tdd.startLoop')}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className={styles.loopsList}>
        <div className={styles.sectionTitle}>
          {t('tdd.activeLoops', { count: activeLoops.length })}
        </div>
        {activeLoops.map(loop => (
          <div
            key={loop.taskId}
            className={`${styles.loopItem} ${selectedTaskId === loop.taskId ? styles.selected : ''}`}
            onClick={() => handleSelectTask(loop.taskId)}
          >
            <span className={styles.loopIcon}>
              {PHASE_CONFIG[loop.phase]?.icon || '🔄'}
            </span>
            <div className={styles.loopInfo}>
              <span className={styles.loopTaskId}>{loop.taskId.substring(0, 8)}...</span>
              <span className={styles.loopPhase}>{t(PHASE_CONFIG[loop.phase]?.labelKey)}</span>
            </div>
            <span className={styles.loopIteration}>
              {t('tdd.iteration', { count: loop.iteration + 1 })}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // 渲染活跃循环水平列表（紧凑布局）
  const renderActiveLoopsHorizontal = () => {
    if (activeLoops.length === 0) return null;

    return (
      <div className={styles.loopsHorizontal}>
        <div className={styles.loopsHeader}>
          <span className={styles.loopsTitle}>{t('tdd.activeLoopsShort', { count: activeLoops.length })}</span>
          {treeId && taskId && !loopState && (
            <button className={styles.startButtonSmall} onClick={startLoop} disabled={loading}>
              {loading ? '...' : t('tdd.newLoop')}
            </button>
          )}
        </div>
        <div className={styles.loopsScroll}>
          {activeLoops.map(loop => (
            <div
              key={loop.taskId}
              className={`${styles.loopChip} ${selectedTaskId === loop.taskId ? styles.selected : ''}`}
              onClick={() => handleSelectTask(loop.taskId)}
              title={loop.taskId}
            >
              <span className={styles.loopChipIcon}>
                {PHASE_CONFIG[loop.phase]?.icon || '🔄'}
              </span>
              <span className={styles.loopChipText}>
                {loop.taskId.substring(0, 6)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // 渲染指南面板
  const renderGuidance = () => {
    if (!guidance) return null;

    return (
      <div className={styles.guidancePanel}>
        <div className={styles.sectionTitle}>
          {t('tdd.phaseGuidance')}
          <button
            className={styles.reportButton}
            onClick={() => selectedTaskId && loadReport(selectedTaskId)}
          >
            {t('tdd.viewReport')}
          </button>
        </div>
        <pre className={styles.guidanceContent}>{guidance}</pre>
      </div>
    );
  };

  // 渲染报告弹窗
  const renderReportModal = () => {
    if (!showReport || !report) return null;

    return (
      <div className={styles.modalOverlay} onClick={() => setShowReport(false)}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <span className={styles.modalTitle}>{t('tdd.loopReport')}</span>
            <button className={styles.modalClose} onClick={() => setShowReport(false)}>×</button>
          </div>
          <div className={styles.modalContent}>
            <pre className={styles.reportContent}>{report}</pre>
          </div>
        </div>
      </div>
    );
  };

  // 渲染状态一致性检查面板
  const renderConsistencyPanel = () => {
    if (!showConsistencyPanel) return null;

    const inconsistentItems = consistencyCheck?.details.filter(d => !d.isConsistent) || [];

    return (
      <div className={styles.modalOverlay} onClick={() => setShowConsistencyPanel(false)}>
        <div className={styles.modal} onClick={e => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <span className={styles.modalTitle}>{t('tdd.consistencyCheck')}</span>
            <button className={styles.modalClose} onClick={() => setShowConsistencyPanel(false)}>×</button>
          </div>
          <div className={styles.modalContent}>
            {consistencyCheck ? (
              <div className={styles.consistencyContent}>
                <div className={styles.consistencySummary}>
                  <div className={styles.consistencyStat}>
                    <span className={styles.statLabel}>{t('tdd.total')}</span>
                    <span className={styles.statValue}>{consistencyCheck.total}</span>
                  </div>
                  <div className={styles.consistencyStat}>
                    <span className={styles.statLabel}>{t('tdd.consistent')}</span>
                    <span className={styles.statValue} style={{ color: '#4caf50' }}>{consistencyCheck.consistent}</span>
                  </div>
                  <div className={styles.consistencyStat}>
                    <span className={styles.statLabel}>{t('tdd.inconsistent')}</span>
                    <span className={styles.statValue} style={{ color: '#f44336' }}>{consistencyCheck.inconsistent}</span>
                  </div>
                </div>

                {inconsistentItems.length > 0 && (
                  <>
                    <div className={styles.consistencyActions}>
                      <button
                        className={styles.syncAllButton}
                        onClick={handleSyncAll}
                        disabled={syncing}
                      >
                        {syncing ? t('tdd.syncing') : t('tdd.syncAll', { count: inconsistentItems.length })}
                      </button>
                    </div>

                    <div className={styles.inconsistentList}>
                      <div className={styles.listHeader}>{t('tdd.inconsistentTasks')}</div>
                      {inconsistentItems.map(item => (
                        <div key={item.taskId} className={styles.inconsistentItem}>
                          <div className={styles.itemInfo}>
                            <span className={styles.itemTaskId}>{item.taskId.substring(0, 8)}...</span>
                            <span className={styles.itemStatus}>
                              TDD: {item.tddPhase} → {t('tdd.expected')}: {item.expectedTaskStatus}
                            </span>
                            <span className={styles.itemActual}>
                              {t('tdd.actual')}: {item.actualTaskStatus || t('tdd.unknown')}
                            </span>
                          </div>
                          <button
                            className={styles.syncButton}
                            onClick={() => handleSyncState(item.taskId)}
                            disabled={syncing}
                          >
                            {syncing ? '...' : t('tdd.sync')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {inconsistentItems.length === 0 && (
                  <div className={styles.allConsistent}>
                    <span className={styles.checkIcon}>✅</span>
                    <span>{t('tdd.allConsistent')}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.loadingText}>{t('tdd.loading')}</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 计算统计信息（使用 useMemo 避免重复计算和数据不一致）
  // 关键修复：只显示当前阶段的测试结果，而不是累计所有历史
  const stats = useMemo(() => {
    if (!loopState) return null;

    const iteration = typeof loopState.iteration === 'number' ? loopState.iteration : 0;

    // 如果有验收测试，使用 acceptanceTestResults（当前阶段的验收测试结果）
    if (loopState.hasAcceptanceTests) {
      const acceptanceResults = loopState.acceptanceTestResults || {};
      const results = Object.values(acceptanceResults) as TestResult[];
      const passedTests = results.filter(r => r && r.passed === true).length;
      const failedTests = results.filter(r => r && r.passed === false).length;
      const totalDuration = results.reduce((sum, r) => sum + (r?.duration || 0), 0);
      const totalTests = loopState.acceptanceTests?.length || 0;

      return {
        iteration: iteration + 1,
        passedTests,
        failedTests,
        // 显示待运行的测试数（总测试数 - 已运行数）
        pendingTests: Math.max(0, totalTests - results.length),
        totalDuration: (totalDuration / 1000).toFixed(1),
      };
    }

    // 没有验收测试，使用最近一次测试结果
    const testResults = Array.isArray(loopState.testResults) ? loopState.testResults : [];

    // 只统计最近一次测试运行的结果（绿灯阶段的最后一次）
    const lastResult = testResults.length > 0 ? testResults[testResults.length - 1] : null;

    if (lastResult) {
      return {
        iteration: iteration + 1,
        passedTests: lastResult.passed ? 1 : 0,
        failedTests: lastResult.passed ? 0 : 1,
        totalDuration: ((lastResult.duration || 0) / 1000).toFixed(1),
      };
    }

    // 默认返回空统计
    return {
      iteration: iteration + 1,
      passedTests: 0,
      failedTests: 0,
      totalDuration: '0.0',
    };
  }, [loopState?.iteration, loopState?.testResults, loopState?.acceptanceTestResults, loopState?.hasAcceptanceTests, loopState?.acceptanceTests]);

  // 渲染统计信息
  const renderStats = () => {
    if (!stats) return null;

    // 检查是否有待运行的测试
    const hasPending = 'pendingTests' in stats && stats.pendingTests > 0;

    return (
      <div className={styles.stats}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.iteration}</span>
          <span className={styles.statLabel}>{t('tdd.currentIteration')}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue} style={{ color: '#4caf50' }}>{stats.passedTests}</span>
          <span className={styles.statLabel}>{t('tdd.passed')}</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue} style={{ color: '#f44336' }}>{stats.failedTests}</span>
          <span className={styles.statLabel}>{t('tdd.failed')}</span>
        </div>
        {hasPending && (
          <div className={styles.statItem}>
            <span className={styles.statValue} style={{ color: '#ff9800' }}>{stats.pendingTests}</span>
            <span className={styles.statLabel}>{t('tdd.pendingRun')}</span>
          </div>
        )}
        <div className={styles.statItem}>
          <span className={styles.statValue}>{stats.totalDuration}s</span>
          <span className={styles.statLabel}>{t('tdd.duration')}</span>
        </div>
      </div>
    );
  };

  // 渲染当前状态卡片
  const renderCurrentState = () => {
    if (!loopState) return null;

    const config = PHASE_CONFIG[loopState.phase];
    const isDone = loopState.phase === 'done';
    const isFirstPhase = loopState.phase === 'write_test';

    return (
      <div className={styles.currentState} style={{ borderColor: config.color }}>
        <div className={styles.stateHeader}>
          <span className={styles.stateIcon}>{config.icon}</span>
          <span className={styles.statePhase} style={{ color: config.color }}>
            {t(config.labelKey)}
          </span>
        </div>
        <div className={styles.stateDescription}>{t(config.descriptionKey)}</div>
        {loopState.lastError && (
          <div className={styles.stateError}>
            <span className={styles.errorIcon}>⚠️</span>
            <span className={styles.errorText}>{loopState.lastError}</span>
          </div>
        )}

        {/* 重复错误检测警告 */}
        {loopState.consecutiveSameErrorCount && loopState.consecutiveSameErrorCount >= 2 && (
          <div className={styles.repeatedErrorWarning}>
            <div className={styles.warningHeader}>
              <span className={styles.warningIcon}>🔄</span>
              <span className={styles.warningTitle}>
                {t('tdd.repeatedError', { count: loopState.consecutiveSameErrorCount })}
              </span>
            </div>
            <div className={styles.warningDescription}>
              {loopState.consecutiveSameErrorCount >= 3 ? (
                <>
                  <strong>{t('tdd.queenIntervening')}</strong><br />
                  {t('tdd.queenInterveningDesc')}
                </>
              ) : (
                <>
                  {t('tdd.repeatedErrorHint')}
                </>
              )}
            </div>
          </div>
        )}

        {/* 阶段控制按钮 */}
        {!isDone && (
          <div className={styles.phaseControls}>
            <button
              className={styles.revertButton}
              onClick={handleRevertPhase}
              disabled={isFirstPhase || phaseTransitioning}
              title={isFirstPhase ? t('tdd.alreadyFirstPhase') : t('tdd.revertToPrevPhase')}
            >
              <span className={styles.buttonIcon}>⬅</span>
              {t('tdd.revertPhase')}
            </button>
            <button
              className={styles.completeButton}
              onClick={handleCompletePhase}
              disabled={phaseTransitioning}
              title={t('tdd.completePhaseTooltip')}
            >
              {phaseTransitioning ? t('tdd.processing') : t('tdd.completeCurrentPhase')}
              <span className={styles.buttonIcon}>➡</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  // 主渲染 - 紧凑垂直布局
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.headerIcon}>🔄</span>
        <span className={styles.headerTitle}>TDD</span>
        {loading && <span className={styles.loadingIndicator}>...</span>}
        <button
          className={styles.consistencyButton}
          onClick={handleCleanupOrphaned}
          disabled={loading}
          title={t('tdd.cleanupOrphanedTooltip')}
        >
          🧹
        </button>
        <button
          className={styles.consistencyButton}
          onClick={handleCheckConsistency}
          disabled={loading}
          title={t('tdd.checkConsistencyTooltip')}
        >
          🔍
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner}>
          <span className={styles.errorIcon}>❌</span>
          <span>{error}</span>
        </div>
      )}

      <div className={styles.content}>
        {/* 顶部：活跃循环水平列表 */}
        {activeLoops.length > 0 && renderActiveLoopsHorizontal()}

        {/* 主内容区 */}
        <div className={styles.main}>
          {activeLoops.length > 0 ? (
            loopState ? (
              <>
                {renderPhaseIndicator()}
                {renderStats()}
                {renderCurrentState()}
                {renderTestResults()}
                {renderPhaseHistory()}
                {renderGuidance()}
              </>
            ) : (
              <div className={styles.noSelection}>
                {taskId ? (
                  <div className={styles.startLoopState}>
                    <div className={styles.emptyIcon}>🚀</div>
                    <div className={styles.emptyText}>{t('tdd.noLoopStarted')}</div>
                    <div className={styles.emptyDescription}>
                      {t('tdd.clickToStartTdd')}
                    </div>
                    <button className={styles.startButton} onClick={startLoop} disabled={loading}>
                      {loading ? t('tdd.starting') : t('tdd.startLoop')}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className={styles.noSelectionIcon}>📋</div>
                    <div className={styles.noSelectionText}>
                      {t('tdd.selectLoopToView')}
                    </div>
                  </>
                )}
              </div>
            )
          ) : (
            /* 没有活跃循环时显示空状态 */
            renderActiveLoops()
          )}
        </div>
      </div>

      {renderReportModal()}
      {renderConsistencyPanel()}
    </div>
  );
};

// 导出类型
export type { TDDPanelProps, TDDLoopState, TDDPhase, TestResult, PhaseTransition };
export default TDDPanel;
