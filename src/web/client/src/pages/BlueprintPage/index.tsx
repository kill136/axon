import { useState, useEffect, useMemo, useCallback } from 'react';
import styles from './BlueprintPage.module.css';
import type {
  BlueprintStatus,
  BlueprintListResponse,
  BlueprintListItem,
} from './types';
import { BlueprintDetailPanel } from '../../components/swarm/BlueprintDetailPanel';
import { useProject } from '../../contexts/ProjectContext';
import { useLanguage } from '../../i18n';

/**
 * 判断蓝图是否为活跃状态
 * 活跃状态包括：草稿、待审核、执行中、已暂停、已批准、已修改
 */
function isActiveBlueprint(status: BlueprintStatus): boolean {
  return ['draft', 'review', 'executing', 'paused', 'approved', 'modified'].includes(status);
}

/**
 * BlueprintPage Props
 */
interface BlueprintPageProps {
  /**
   * 可选的初始蓝图 ID（用于深度链接）
   */
  initialBlueprintId?: string | null;
  /**
   * 跳转到蜂群页面的回调，传递蓝图 ID
   */
  onNavigateToSwarm?: (blueprintId: string) => void;
}

/**
 * 蓝图页面 - 全局蓝图视图
 *
 * 功能：
 * - 显示所有项目的蓝图列表（与蜂群页面保持一致）
 * - 点击查看蓝图详情
 * - 无蓝图时显示生成引导
 */
export default function BlueprintPage({ initialBlueprintId, onNavigateToSwarm }: BlueprintPageProps) {
  // ============================================================================
  // 状态管理
  // ============================================================================

  // 获取项目上下文 - 与聊天Tab共享同一个项目选择状态
  const { state: projectState } = useProject();
  const { t } = useLanguage();
  const currentProjectPath = projectState.currentProject?.path;

  const [blueprints, setBlueprints] = useState<BlueprintListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialBlueprintId || null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);


  // 生成蓝图的状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<string>('');
  const [generateResult, setGenerateResult] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // 删除确认状态
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ============================================================================
  // 数据加载
  // ============================================================================

  /**
   * 加载蓝图列表（按当前项目过滤）
   */
  const loadBlueprints = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 传递当前项目路径，只加载该项目的蓝图
      const url = currentProjectPath
        ? `/api/blueprint/blueprints?projectPath=${encodeURIComponent(currentProjectPath)}`
        : '/api/blueprint/blueprints';
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: BlueprintListResponse = await response.json();

      if (result.success) {
        setBlueprints(result.data);

        // 如果没有选中的蓝图，自动选中当前活跃蓝图或最新的
        if (!selectedId && result.data.length > 0) {
          const active = result.data.find(bp => isActiveBlueprint(bp.status));
          if (active) {
            setSelectedId(active.id);
          } else {
            // 选择最新的蓝图
            const sorted = [...result.data].sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            setSelectedId(sorted[0].id);
          }
        }
      } else {
        throw new Error(result.message || t('blueprint.loadFailed'));
      }
    } catch (err) {
      console.error('加载蓝图列表失败:', err);
      setError(err instanceof Error ? err.message : t('blueprint.unknownError'));
    } finally {
      setIsLoading(false);
    }
  }, [currentProjectPath, t]);

  // 初始加载
  useEffect(() => {
    loadBlueprints();
  }, [loadBlueprints]);

  // 当项目切换时重置选中状态
  useEffect(() => {
    setSelectedId(null);
  }, [currentProjectPath]);

  // 当 initialBlueprintId 变化时更新选中状态
  useEffect(() => {
    if (initialBlueprintId) {
      setSelectedId(initialBlueprintId);
    }
  }, [initialBlueprintId]);

  // ============================================================================
  // 事件处理
  // ============================================================================



  /**
   * 处理生成蓝图
   */
  const handleCreateBlueprint = async () => {
    if (!canCreateBlueprint || isGenerating) return;

    // 检查是否有选中的项目
    if (!currentProjectPath) {
      setGenerateResult({
        type: 'error',
        message: t('blueprint.selectProjectFirst'),
      });
      return;
    }

    setGenerateResult(null);
    setIsGenerating(true);
    setGenerateProgress(t('blueprint.analyzingCodebase'));

    try {
      const progressSteps = [
        t('blueprint.scanningFiles'),
        t('blueprint.identifyingModules'),
        t('blueprint.analyzingProcesses'),
        t('blueprint.generatingBlueprint'),
      ];

      let stepIndex = 0;
      const progressInterval = setInterval(() => {
        if (stepIndex < progressSteps.length) {
          setGenerateProgress(progressSteps[stepIndex]);
          stepIndex++;
        }
      }, 1500);

      // 使用当前项目路径生成蓝图
      const response = await fetch('/api/blueprint/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectRoot: currentProjectPath }),
      });

      clearInterval(progressInterval);

      const result = await response.json();

      if (result.success) {
        setGenerateProgress('');
        setGenerateResult({
          type: 'success',
          message: result.message || t('blueprint.generateSuccess', { count: result.data?.moduleCount || 0 }),
        });

        // 刷新列表并选中新蓝图
        await loadBlueprints();
        if (result.data?.id) {
          setSelectedId(result.data.id);
        }

        setTimeout(() => setGenerateResult(null), 5000);
      } else if (result.needsDialog) {
        setGenerateProgress('');
        setGenerateResult({
          type: 'info',
          message: result.message || t('blueprint.generateNeedsDialog'),
        });
      } else {
        throw new Error(result.error || result.message || t('blueprint.generateFailed', { message: '' }));
      }
    } catch (err) {
      console.error('生成蓝图失败:', err);
      setGenerateProgress('');
      setGenerateResult({
        type: 'error',
        message: t('blueprint.generateFailed', { message: err instanceof Error ? err.message : t('blueprint.unknownError') }),
      });
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * 处理刷新
   */
  const handleRefresh = () => {
    loadBlueprints();
  };

  /**
   * 处理删除蓝图
   */
  const handleDeleteBlueprint = async (id: string) => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/blueprint/blueprints/${id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (result.success) {
        setDeleteConfirmId(null);
        if (selectedId === id) {
          setSelectedId(null);
        }
        loadBlueprints();
      } else {
        alert(result.error || t('blueprint.deleteFailed'));
      }
    } catch (err) {
      alert(t('blueprint.deleteFailed') + ': ' + (err instanceof Error ? err.message : t('blueprint.unknownError')));
    } finally {
      setIsDeleting(false);
    }
  };

  /**
   * 蓝图删除后的回调
   */
  const handleBlueprintDeleted = () => {
    setSelectedId(null);
    loadBlueprints();
  };

  // ============================================================================
  // 计算属性
  // ============================================================================

  /**
   * 当前活跃蓝图
   */
  const currentBlueprint = useMemo(() => {
    return blueprints.find(bp => isActiveBlueprint(bp.status)) || null;
  }, [blueprints]);



  /**
   * 按来源分组：codebase（项目全景）和 requirement（需求蓝图）
   */
  const { codebaseBlueprints, requirementBlueprints } = useMemo(() => {
    const cbs: BlueprintListItem[] = [];
    const rbs: BlueprintListItem[] = [];
    for (const bp of blueprints) {
      if (bp.source === 'codebase') {
        cbs.push(bp);
      } else {
        rbs.push(bp);
      }
    }
    return { codebaseBlueprints: cbs, requirementBlueprints: rbs };
  }, [blueprints]);

  /**
   * 是否允许创建新蓝图
   */
  const canCreateBlueprint = useMemo(() => {
    return currentBlueprint === null;
  }, [currentBlueprint]);

  /**
   * 是否已有项目全景蓝图
   */





  // ============================================================================
  // 渲染
  // ============================================================================

  return (
    <div className={styles.blueprintPage}>

      {/* 生成进度提示 */}
      {isGenerating && generateProgress && (
        <div className={styles.progressBanner}>
          <div className={styles.progressContent}>
            <span className={styles.progressSpinner}>...</span>
            <span className={styles.progressText}>{generateProgress}</span>
          </div>
        </div>
      )}

      {/* 生成结果提示 */}
      {generateResult && (
        <div className={`${styles.resultBanner} ${styles[generateResult.type]}`}>
          <div className={styles.resultContent}>
            <span className={styles.resultIcon}>
              {generateResult.type === 'success' ? 'OK' : generateResult.type === 'error' ? 'X' : 'i'}
            </span>
            <span className={styles.resultText}>{generateResult.message}</span>
            <button
              className={styles.dismissButton}
              onClick={() => setGenerateResult(null)}
              title={t('blueprint.close')}
            >
              x
            </button>
          </div>
        </div>
      )}

      {/* 主内容区域 */}
      <div className={styles.mainContent}>
        {/* 加载状态 */}
        {isLoading && (
          <div className={styles.centerState}>
            <div className={styles.spinner}>⏳</div>
            <div className={styles.stateText}>{t('blueprint.loading')}</div>
          </div>
        )}

        {/* 错误状态 */}
        {!isLoading && error && (
          <div className={styles.centerState}>
            <div className={styles.errorIcon}>❌</div>
            <div className={styles.errorText}>{t('blueprint.error', { message: error })}</div>
            <button className={styles.retryButton} onClick={handleRefresh}>
              {t('blueprint.retry')}
            </button>
          </div>
        )}

        {/* 空状态 - 无蓝图 */}
        {!isLoading && !error && blueprints.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <rect x="10" y="15" width="60" height="50" rx="4" stroke="currentColor" strokeWidth="2" fill="none" />
                <line x1="20" y1="30" x2="60" y2="30" stroke="currentColor" strokeWidth="2" />
                <line x1="20" y1="40" x2="50" y2="40" stroke="currentColor" strokeWidth="2" />
                <line x1="20" y1="50" x2="45" y2="50" stroke="currentColor" strokeWidth="2" />
              </svg>
            </div>
            <h2 className={styles.emptyTitle}>{t('blueprint.emptyTitle')}</h2>
            <p className={styles.emptyDescription}>
              {t('blueprint.emptyDescription')}
            </p>
          </div>
        )}

        {/* 蓝图列表 */}
        {!isLoading && !error && blueprints.length > 0 && (
          <div className={styles.blueprintList}>
            <div className={styles.listHeader}>
              <h2 className={styles.listTitle}>{t('blueprint.listTitle')}</h2>
              <div className={styles.listActions}>
                <button 
                  className={styles.refreshButton} 
                  onClick={handleRefresh}
                  title={t('blueprint.refresh')}
                >
                  🔄
                </button>
              </div>
            </div>

            <div className={styles.scrollArea}>
              {/* 项目全景区块（codebase 蓝图） */}
              {codebaseBlueprints.length > 0 && (
                <div className={styles.codebaseSection}>
                  <h3 className={styles.sectionTitle}>🏗️ {t('blueprint.sectionCodebase')}</h3>
                  {codebaseBlueprints.map((blueprint) => (
                    <div
                      key={blueprint.id}
                      className={`${styles.codebaseCard} ${selectedId === blueprint.id ? styles.selected : ''}`}
                      onClick={() => setSelectedId(blueprint.id)}
                    >
                      <div className={styles.cardHeader}>
                        <h3 className={styles.cardTitle}>{blueprint.name}</h3>
                        <div className={styles.cardHeaderActions}>
                          <span className={styles.codebaseBadge}>{t('blueprint.synced')}</span>
                          <button
                            className={styles.deleteButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(blueprint.id);
                            }}
                            title={t('blueprint.deleteBlueprint')}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      <p className={styles.cardDescription}>
                        {blueprint.description || t('blueprint.noDescription')}
                      </p>
                      <div className={styles.cardMeta}>
                        {blueprint.moduleCount > 0 && (
                          <span>📦 {t('blueprint.modules', { count: blueprint.moduleCount })}</span>
                        )}
                        {blueprint.processCount > 0 && (
                          <span>🔄 {t('blueprint.processes', { count: blueprint.processCount })}</span>
                        )}
                        {blueprint.nfrCount > 0 && (
                          <span>🎯 {blueprint.nfrCount} NFR</span>
                        )}
                      </div>
                      <div className={styles.cardFooter}>
                        <span className={styles.cardVersion}>v{blueprint.version}</span>
                        <span className={styles.cardDate}>
                          {new Date(blueprint.updatedAt).toLocaleDateString('zh-CN')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 需求蓝图区块 */}
              {requirementBlueprints.length > 0 && (
                <div className={styles.requirementSection}>
                  <h3 className={styles.sectionTitle}>📝 {t('blueprint.sectionRequirement')}</h3>
                  <div className={styles.listContent}>
                    {requirementBlueprints.map((blueprint) => (
                      <div
                        key={blueprint.id}
                        className={`${styles.blueprintCard} ${selectedId === blueprint.id ? styles.selected : ''}`}
                        onClick={() => setSelectedId(blueprint.id)}
                      >
                        <div className={styles.cardHeader}>
                          <h3 className={styles.cardTitle}>{blueprint.name}</h3>
                          <div className={styles.cardHeaderActions}>
                            <span className={`${styles.cardStatus} ${styles[blueprint.status]}`}>
                              {blueprint.status}
                            </span>
                            {blueprint.status !== 'executing' && (
                              <button
                                className={styles.deleteButton}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirmId(blueprint.id);
                                }}
                                title={t('blueprint.deleteBlueprint')}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </div>
                        <p className={styles.cardDescription}>
                          {blueprint.description || t('blueprint.noDescription')}
                        </p>
                        <div className={styles.cardMeta}>
                          {blueprint.requirementCount > 0 && (
                            <span>📋 {t('blueprint.requirements', { count: blueprint.requirementCount })}</span>
                          )}
                          {blueprint.constraintCount > 0 && (
                            <span>⚠️ {t('blueprint.constraints', { count: blueprint.constraintCount })}</span>
                          )}
                          {blueprint.requirementCount === 0 && blueprint.constraintCount === 0 && (
                            <span className={styles.cardMetaEmpty}>{t('blueprint.noDetailData')}</span>
                          )}
                        </div>
                        <div className={styles.cardFooter}>
                          <span className={styles.cardVersion}>v{blueprint.version}</span>
                          <span className={styles.cardDate}>
                            {new Date(blueprint.updatedAt).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 蓝图详情面板（右侧浮层） */}
      {selectedId && (
        <BlueprintDetailPanel
          blueprintId={selectedId}
          onClose={() => setSelectedId(null)}
          onNavigateToSwarm={onNavigateToSwarm}
          onDeleted={handleBlueprintDeleted}
          onRefresh={loadBlueprints}
        />
      )}

      {/* 删除确认对话框 */}
      {deleteConfirmId && (
        <div className={styles.deleteOverlay} onClick={() => setDeleteConfirmId(null)}>
          <div className={styles.deleteDialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.deleteDialogTitle}>{t('blueprint.confirmDeleteTitle')}</h3>
            <p className={styles.deleteDialogText}>
              {t('blueprint.confirmDeleteText')}
            </p>
            <div className={styles.deleteDialogActions}>
              <button
                className={styles.deleteDialogCancel}
                onClick={() => setDeleteConfirmId(null)}
                disabled={isDeleting}
              >
                {t('blueprint.cancel')}
              </button>
              <button
                className={styles.deleteDialogConfirm}
                onClick={() => handleDeleteBlueprint(deleteConfirmId)}
                disabled={isDeleting}
              >
                {isDeleting ? t('blueprint.deleting') : t('blueprint.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
