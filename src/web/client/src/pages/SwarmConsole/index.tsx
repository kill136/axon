import { useState, useMemo, useEffect, useCallback } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import styles from './SwarmConsole.module.css';
import { AgentChatPanel, TaskStreamContent } from '../../components/swarm/AgentChatPanel';
import type { WorkerAgent as ComponentWorkerAgent } from '../../components/swarm/WorkerPanel/WorkerCard';
import type { SelectedTask } from '../../components/swarm/WorkerPanel';
import { FadeIn } from '../../components/swarm/common';
import { ConflictPanel } from './components/ConflictPanel';
import { AskUserDialog } from './components/AskUserDialog';
import { useSwarmState } from './hooks/useSwarmState';
import { coordinatorApi, blueprintApi } from '../../api/blueprint';
import { useProject } from '../../contexts/ProjectContext';
import { DebugPanel } from '../../components/DebugPanel';
import { useLanguage } from '../../i18n';
import type {
  WorkerAgent as APIWorkerAgent,
  ExecutionPlan,
  ConflictDecision,
} from './types';

// 获取 WebSocket URL
function getWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

// ============================================================================
// 数据转换: API 类型 → 组件类型
// ============================================================================

/** 转换 Worker: API WorkerAgent → Component WorkerAgent */
function convertWorker(apiWorker: APIWorkerAgent): ComponentWorkerAgent {
  return {
    id: apiWorker.id,
    status: apiWorker.status as ComponentWorkerAgent['status'], // 状态名已统一
    taskId: apiWorker.currentTaskId || undefined,
    taskName: apiWorker.currentTaskName || undefined,
    progress: apiWorker.progress || 0,
    retryCount: apiWorker.errorCount || 0,
    maxRetries: 3,
    duration: undefined,
    branchName: apiWorker.branchName,
    branchStatus: apiWorker.branchStatus,
    modelUsed: apiWorker.modelUsed,
    currentAction: apiWorker.currentAction,
    decisions: apiWorker.decisions,
  };
}

// ============================================================================
// 主组件
// ============================================================================

interface SwarmConsoleProps {
  initialBlueprintId?: string | null;
}

// v3.0: 移除 DashboardData 和 TaskTreeStats 接口
// 现在直接使用 WebSocket 推送的 state.stats 和 state.workers

export default function SwarmConsole({ initialBlueprintId }: SwarmConsoleProps) {
  const { t } = useLanguage();
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string | null>(initialBlueprintId || null);
  const [blueprintName, setBlueprintName] = useState<string>('');

  // 从 ProjectContext 获取当前选中的项目和蓝图
  const { state: projectState } = useProject();


  // 选中任务（点击任务列表项）
  const selectTask = useCallback((taskId: string | undefined) => {
    setSelectedTaskId(taskId);
  }, []);

  // WebSocket 状态
  const { state, isLoading, error, refresh, sendAskUserResponse, loadTaskHistoryLogs, interjectTask, interjectLead, resumeLead, send, addMessageHandler } = useSwarmState({
    url: getWebSocketUrl(),
    blueprintId: selectedBlueprintId || undefined,
  });

  // 探针面板状态
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // v3.0: 从 state 提取数据（原来通过 HTTP 轮询获取）
  const executionPlan = state.executionPlan as ExecutionPlan | null;


  // 自动加载当前选中项目的蓝图（一个工作目录一个蓝图）
  // 优先级：initialBlueprintId > ProjectContext.currentBlueprint > 按 projectPath 查询 API
  useEffect(() => {
    // 等待 ProjectContext 初始化完成
    if (!projectState.initialized) return;

    // 优先级 1：从页面导航传入的 initialBlueprintId
    if (initialBlueprintId) {
      setSelectedBlueprintId(initialBlueprintId);
      // 名称将由下方的 WebSocket state.blueprint.name 同步
      return;
    }

    // 优先级 2：ProjectContext 中当前项目关联的蓝图
    if (projectState.currentBlueprint?.id) {
      setSelectedBlueprintId(projectState.currentBlueprint.id);
      setBlueprintName(projectState.currentBlueprint.name || projectState.currentBlueprint.id);
      return;
    }

    // 优先级 3：有当前项目但 context 中无蓝图信息，按 projectPath 从 API 查询
    if (projectState.currentProject?.path) {
      const loadBlueprint = async () => {
        try {
          const url = `/api/blueprint/blueprints?projectPath=${encodeURIComponent(projectState.currentProject!.path)}`;
          const response = await fetch(url);
          const result = await response.json();
          if (result.success && result.data && result.data.length > 0) {
            const bp = result.data[0];
            setSelectedBlueprintId(bp.id);
            setBlueprintName(bp.name || bp.id);
          }
        } catch (err) {
          console.error('加载蓝图失败:', err);
        }
      };
      loadBlueprint();
    }
  }, [initialBlueprintId, projectState.initialized, projectState.currentBlueprint?.id, projectState.currentProject?.path]);

  // WebSocket 推送的蓝图数据同步名称
  useEffect(() => {
    if (state.blueprint?.name) {
      setBlueprintName(state.blueprint.name);
    }
  }, [state.blueprint?.name]);


  // v3.0: 直接使用 state.stats，不需要额外的本地状态

  // v3.0: 从 WebSocket state 获取 workers，不再通过 HTTP 轮询
  const workers: ComponentWorkerAgent[] = useMemo(() => {
    return (state.workers || []).map(convertWorker);
  }, [state.workers]);

  // v2.1: 计算选中的任务详情
  const selectedTask: SelectedTask | null = useMemo(() => {
    if (!selectedTaskId || !executionPlan) return null;

    const task = executionPlan.tasks.find(t => t.id === selectedTaskId);
    if (!task) return null;

    return {
      id: task.id,
      name: task.name,
      description: task.description,
      type: task.type,
      complexity: task.complexity,
      status: task.status,
      needsTest: task.needsTest,
      estimatedMinutes: task.estimatedMinutes,
      workerId: task.workerId,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      error: task.error,
      result: task.result,
      files: task.files,
      dependencies: task.dependencies,
    };
  }, [selectedTaskId, executionPlan]);

  // v2.1: 获取选中任务的流式内容
  // v4.1: 支持 E2E 测试任务的流式内容
  const selectedTaskStream = useMemo(() => {
    if (!selectedTaskId) return null;
    return state.taskStreams[selectedTaskId] || null;
  }, [selectedTaskId, state.taskStreams]);

  // v4.4: 选中任务时自动加载历史聊天记录
  useEffect(() => {
    if (!selectedTaskId || selectedTaskId === 'e2e-test') return;

    // 检查是否已有流式内容，如果没有则从 SQLite 加载历史
    const existingStream = state.taskStreams[selectedTaskId];
    if (!existingStream || existingStream.content.length === 0) {
      console.log(`[SwarmConsole] 加载任务 ${selectedTaskId} 的历史聊天记录...`);
      loadTaskHistoryLogs(selectedTaskId).then(result => {
        if (result.success) {
          console.log(`[SwarmConsole] 历史日志加载成功: ${result.totalLogs} 条日志, ${result.totalStreams} 条流`);
        }
      });
    }
  }, [selectedTaskId, loadTaskHistoryLogs]);

  // v4.1: E2E 测试任务流式内容
  const e2eTaskStream = useMemo(() => {
    const e2eTaskId = state.verification.e2eTaskId;
    if (!e2eTaskId) return null;
    return state.taskStreams[e2eTaskId] || null;
  }, [state.verification.e2eTaskId, state.taskStreams]);


  // LeadAgent stream 转换为 AgentChatPanel 的 TaskStreamContent 格式
  const leadStream: TaskStreamContent | null = useMemo(() => {
    if (state.leadAgent.phase === 'idle' || state.leadAgent.stream.length === 0) return null;
    return {
      content: state.leadAgent.stream,
      lastUpdated: state.leadAgent.lastUpdated || new Date().toISOString(),
      systemPrompt: state.leadAgent.systemPrompt,
      agentType: 'lead' as const,
    };
  }, [state.leadAgent.stream, state.leadAgent.phase, state.leadAgent.lastUpdated, state.leadAgent.systemPrompt]);

  // LeadAgent 状态
  const leadAgentStatus = useMemo((): 'pending' | 'running' | 'completed' | 'failed' => {
    const phase = state.leadAgent.phase;
    if (phase === 'completed') return 'completed';
    if (phase === 'failed') return 'failed';
    if (phase === 'idle') return 'pending';
    // v9.3: 如果 LeadAgent phase 仍为执行中，但所有任务都已结束，前端推导为已完成
    if (executionPlan && executionPlan.tasks.length > 0) {
      const allDone = executionPlan.tasks.every(
        t => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped'
      );
      if (allDone) {
        const hasFailed = executionPlan.tasks.some(t => t.status === 'failed');
        return hasFailed ? 'failed' : 'completed';
      }
    }
    return 'running';
  }, [state.leadAgent.phase, executionPlan]);

  // v9.3: 检测执行是否卡死（LeadAgent 已退出但仍有未完成任务）
  const isStalled = useMemo(() => {
    if (!executionPlan || executionPlan.tasks.length === 0) return false;
    const phase = state.leadAgent.phase;
    // LeadAgent 处于 idle/completed/failed 状态
    const leadExited = phase === 'idle' || phase === 'completed' || phase === 'failed';
    if (!leadExited) return false;
    // 存在未完成任务
    const hasPending = executionPlan.tasks.some(
      t => t.status === 'pending' || t.status === 'running'
    );
    return hasPending;
  }, [executionPlan, state.leadAgent.phase]);

  // 检测执行计划是否全部完成（用于显示完成横幅）
  const isAllCompleted = useMemo(() => {
    if (!executionPlan || executionPlan.tasks.length === 0) return false;
    return executionPlan.tasks.every(
      t => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped'
    );
  }, [executionPlan]);

  const [isDeletingBlueprint, setIsDeletingBlueprint] = useState(false);

  const handleDeleteBlueprint = useCallback(async () => {
    if (!selectedBlueprintId || isDeletingBlueprint) return;
    if (!confirm(t('swarm.confirmDeleteBlueprint'))) return;

    setIsDeletingBlueprint(true);
    try {
      await blueprintApi.deleteBlueprint(selectedBlueprintId);
      setSelectedBlueprintId(null);
      setBlueprintName('');
    } catch (err) {
      console.error('[SwarmConsole] 删除蓝图失败:', err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeletingBlueprint(false);
    }
  }, [selectedBlueprintId, isDeletingBlueprint, t]);

  const [isResuming, setIsResuming] = useState(false);

  const handleResumeLead = useCallback(() => {
    setIsResuming(true);
    resumeLead();
    // 超时自动恢复按钮状态
    setTimeout(() => setIsResuming(false), 15000);
  }, [resumeLead]);

  // LeadAgent 恢复执行后重置 resuming 状态
  useEffect(() => {
    if (isResuming && state.leadAgent.phase !== 'idle' && state.leadAgent.phase !== 'completed' && state.leadAgent.phase !== 'failed') {
      setIsResuming(false);
    }
  }, [isResuming, state.leadAgent.phase]);

  // LeadAgent 是否可以插嘴
  // v9.3: 基于实际状态判断，而非仅依赖 phase
  const canInterjectLead = leadAgentStatus === 'running';

  // 当前选中的 Worker 的模型信息
  const selectedWorkerModel = useMemo(() => {
    if (!selectedTask?.workerId) return undefined;
    const worker = workers.find(w => w.id === selectedTask.workerId);
    return worker?.modelUsed;
  }, [selectedTask, workers]);

  // Worker 任务是否可以插嘴
  const canInterjectTask = selectedTask?.status === 'running';

  // 统一的 Worker 插嘴回调
  const handleWorkerInterject = useCallback((message: string) => {
    if (selectedTask?.id) {
      interjectTask(selectedTask.id, message);
    }
  }, [selectedTask?.id, interjectTask]);

  // LeadAgent phase 标签 helper
  const getPhaseLabel = useCallback((phase: string): string => {
    const map: Record<string, string> = {
      started: t('swarm.phase.started'),
      exploring: t('swarm.phase.exploring'),
      planning: t('swarm.phase.planning'),
      executing: t('swarm.phase.executing'),
      reviewing: t('swarm.phase.reviewing'),
      completed: t('swarm.phase.completed'),
      failed: t('swarm.phase.failed'),
    };
    return map[phase] || '';
  }, [t]);


  // v3.5: 解决冲突
  const handleResolveConflict = useCallback(async (
    conflictId: string,
    decision: ConflictDecision,
    customContents?: Record<string, string>
  ) => {
    try {
      console.log(`[SwarmConsole] 解决冲突: ${conflictId}, 决策: ${decision}`);
      const result = await coordinatorApi.resolveConflict(conflictId, decision, customContents);
      if (result.success) {
        console.log(`[SwarmConsole] ✅ 冲突解决成功`);
      } else {
        alert('冲突解决失败: ' + (result.message || '未知错误'));
      }
    } catch (err) {
      console.error('[SwarmConsole] 解决冲突失败:', err);
      alert('解决冲突失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, []);


  return (
    <div className={styles.swarmConsole}>
      {/* v3.5: 冲突解决面板 - 有冲突时显示在最上方 */}
      {state.conflicts.conflicts.length > 0 && (
        <ConflictPanel
          conflicts={state.conflicts.conflicts}
          onResolve={handleResolveConflict}
        />
      )}

      {/* v4.2: E2E Agent AskUserQuestion 对话框 */}
      {state.askUserDialog.visible && (
        <AskUserDialog
          dialog={state.askUserDialog}
          onSubmit={sendAskUserResponse}
        />
      )}

      {/* 主内容区域 - 两栏布局：执行计划 + LeadAgent */}
      <PanelGroup orientation="horizontal" className={styles.mainArea}>
        {/* 左侧：执行计划 */}
        <Panel defaultSize="60" minSize="30" className={styles.centerPanel}>
          <div className={styles.panelHeader}>
            <h2>📋 {t('swarm.executionPlan')}{blueprintName ? ` - ${blueprintName}` : ''}</h2>
            {/* V2.0: 显示执行计划统计 */}
            {executionPlan && (
              <div className={styles.taskStats}>
                <span title={t('swarm.completedSlashTotal')}>
                  {executionPlan.tasks.filter(t => t.status === 'completed').length}/{executionPlan.tasks.length} {t('swarm.completed')}
                </span>
                {executionPlan.tasks.filter(t => t.status === 'running').length > 0 && (
                  <span className={styles.runningBadge}>
                    {executionPlan.tasks.filter(t => t.status === 'running').length} {t('swarm.running')}
                  </span>
                )}
                {executionPlan.tasks.filter(t => t.status === 'failed').length > 0 && (
                  <span className={styles.failedBadge}>
                    {executionPlan.tasks.filter(t => t.status === 'failed').length} {t('swarm.failed')}
                  </span>
                )}
              </div>
            )}
            {/* Worker 状态统计 */}
            {workers.length > 0 && (
              <div className={styles.dashboardPreview}>
                <span className={styles.dashboardItem} title={t('swarm.workersTitle')}>
                  👷 {workers.filter(w => w.status === 'working').length}/{workers.length}
                </span>
              </div>
            )}
            {/* 探针按钮 */}
            <button
              className={styles.probeButton}
              onClick={() => setShowDebugPanel(true)}
              title={t('swarm.debugProbe')}
            >
              🔍 {t('swarm.probe')}
            </button>
          </div>
          {/* 执行完成横幅 */}
          {isAllCompleted && executionPlan && (
            <div className={styles.completionBanner}>
              <div className={styles.completionInfo}>
                <span className={styles.completionIcon}>✅</span>
                <span>{t('swarm.executionComplete')} — {t('swarm.allTasksDone', { total: executionPlan.tasks.length })}</span>
              </div>
              <button
                className={styles.deleteBlueprintButton}
                onClick={handleDeleteBlueprint}
                disabled={isDeletingBlueprint}
              >
                {isDeletingBlueprint ? t('swarm.deleting') : t('swarm.deleteBlueprint')}
              </button>
            </div>
          )}
          <div className={styles.panelContent}>
            {/* LeadAgent 入口 — 点击可切到 LeadAgent 对话 */}
            {state.leadAgent.phase !== 'idle' && (
              <div
                className={`${styles.leadAgentEntry} ${!selectedTaskId ? styles.selected : ''}`}
                onClick={() => selectTask(undefined)}
              >
                <span className={styles.leadAgentEntryIcon}>🧠</span>
                <span className={styles.leadAgentEntryLabel}>LeadAgent</span>
                <span className={`${styles.leadPhase} ${styles[`lead_${state.leadAgent.phase}`]}`}>
                  {getPhaseLabel(state.leadAgent.phase)}
                </span>
                {['started', 'exploring', 'planning', 'executing', 'reviewing'].includes(state.leadAgent.phase) && (
                  <span className={styles.liveIndicator}>●</span>
                )}
              </div>
            )}

            {isLoading ? (
              <div className={styles.loadingState}>
                <div className={styles.spinner}>⏳</div>
                <div>{t('swarm.loading')}</div>
              </div>
            ) : error ? (
              <div className={styles.errorState}>
                <div className={styles.errorIcon}>❌</div>
                <div className={styles.errorText}>{t('swarm.error')}: {error}</div>
                <button className={styles.retryButton} onClick={refresh}>{t('swarm.retry')}</button>
              </div>
            ) : !selectedBlueprintId ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>📋</div>
                <div className={styles.emptyStateText}>
                  {t('swarm.noBlueprint')}
                </div>
                <div className={styles.emptyStateHint}>
                  {t('swarm.createBlueprint')}
                </div>
              </div>
            ) : !executionPlan ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>🚀</div>
                <div className={styles.emptyStateText}>
                  {t('swarm.blueprintReady')}
                </div>
                <div className={styles.emptyStateHint}>
                  {t('swarm.startExecution')}
                </div>
              </div>
            ) : (
              /* V2.0: 显示执行计划的任务列表（按并行组分组） */
              <FadeIn>
                <div className={styles.executionPlanView}>
                  {executionPlan.parallelGroups.map((group, groupIndex) => (
                    <div key={groupIndex} className={styles.parallelGroup}>
                      <div className={styles.parallelGroupHeader}>
                        <span className={styles.parallelGroupIcon}>⚡</span>
                        <span className={styles.parallelGroupTitle}>
                          {t('swarm.parallelGroup')} {groupIndex + 1}
                        </span>
                        <span className={styles.parallelGroupCount}>
                          {t('swarm.taskCount', { count: group.length })}
                        </span>
                      </div>
                      <div className={styles.taskList}>
                        {group.map(taskId => {
                          const task = executionPlan.tasks.find(t => t.id === taskId);
                          if (!task) return null;
                          return (
                            <div
                              key={task.id}
                              className={`${styles.taskItem} ${styles[task.status]} ${selectedTaskId === task.id ? styles.selected : ''}`}
                              onClick={() => selectTask(task.id)}
                            >
                              <div className={styles.taskStatus}>
                                {/* v2.2: 有错误的已完成任务显示警告图标 */}
                                {task.status === 'completed' && (task.error || task.result?.error) ? '⚠️' :
                                 task.status === 'completed' ? '✅' :
                                 task.status === 'running' ? '🔄' :
                                 task.status === 'reviewing' ? '🔍' :
                                 task.status === 'failed' ? '❌' :
                                 task.status === 'skipped' ? '⏭️' : '⏳'}
                              </div>
                              <div className={styles.taskInfo}>
                                <div className={styles.taskName}>{task.name}</div>
                                <div className={styles.taskMeta}>
                                  <span className={styles.taskType}>
                                    {task.type === 'code' ? '💻' :
                                     task.type === 'test' ? '🧪' :
                                     task.type === 'config' ? '⚙️' :
                                     task.type === 'refactor' ? '🔧' :
                                     task.type === 'docs' ? '📄' :
                                     task.type === 'verify' ? '🔬' : '🔗'}
                                    {task.type}
                                  </span>
                                  <span className={`${styles.taskComplexity} ${styles[task.complexity]}`}>
                                    {task.complexity}
                                  </span>
                                  {task.needsTest && <span className={styles.needsTest}>{t('swarm.needsTest')}</span>}
                                  <span className={styles.taskTime}>{t('swarm.estimatedMinutes', { minutes: task.estimatedMinutes })}</span>
                                </div>
                              </div>
                              {task.workerId && (
                                <div className={styles.taskWorker}>
                                  👷 {task.workerId.slice(0, 8)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* E2E 验收测试条目 — 和 LeadAgent 入口同级，点击可查看 AgentChatPanel */}
                  {state.verification.status !== 'idle' && (
                    <div
                      className={`${styles.leadAgentEntry} ${selectedTaskId === 'e2e-test' ? styles.selected : ''}`}
                      onClick={() => selectTask('e2e-test')}
                    >
                      <span className={styles.leadAgentEntryIcon}>
                        {state.verification.status === 'passed' ? '✅' :
                         state.verification.status === 'failed' ? '❌' : '🧪'}
                      </span>
                      <span className={styles.leadAgentEntryLabel}>{t('swarm.e2eTest')}</span>
                      <span className={styles.leadPhase}>
                        {state.verification.status === 'checking_env' ? t('swarm.verification.checkingEnv') :
                         state.verification.status === 'running_tests' ? t('swarm.verification.running') :
                         state.verification.status === 'fixing' ? t('swarm.verification.fixing') :
                         state.verification.status === 'passed' ? t('swarm.verification.passed') : t('swarm.verification.failed')}
                      </span>
                      {['checking_env', 'running_tests', 'fixing'].includes(state.verification.status) && (
                        <span className={styles.liveIndicator}>●</span>
                      )}
                    </div>
                  )}
                </div>
              </FadeIn>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className={styles.resizeHandle} />

        {/* 右侧：统一 Agent 对话面板 */}
        <Panel defaultSize="40" minSize="20" collapsible={true} className={styles.rightPanel}>
          <div className={styles.panelContent} style={{ height: '100%' }}>
            {/* 根据选中状态决定显示哪个 Agent 的对话 */}
            {selectedTaskId ? (
              /* 选中了任务 → 显示 Worker/E2E AgentChatPanel */
              selectedTaskId === 'e2e-test' && state.verification.status !== 'idle' ? (
                <AgentChatPanel
                  agentType="e2e"
                  agentLabel={t('swarm.e2eTest')}
                  status={
                    ['checking_env', 'running_tests', 'fixing'].includes(state.verification.status) ? 'running' :
                    state.verification.status === 'passed' ? 'completed' :
                    state.verification.status === 'failed' ? 'failed' : 'pending'
                  }
                  stream={e2eTaskStream}
                  canInterject={['checking_env', 'running_tests', 'fixing'].includes(state.verification.status)}
                  onInterject={(msg) => interjectTask('e2e-test', msg)}
                  interjectStatus={state.interjectStatus}
                />
              ) : selectedTask ? (
                <AgentChatPanel
                  agentType="worker"
                  agentLabel={selectedTask.name}
                  status={selectedTask.status || 'pending'}
                  model={selectedWorkerModel}
                  stream={selectedTaskStream}
                  canInterject={canInterjectTask}
                  onInterject={handleWorkerInterject}
                  interjectStatus={state.interjectStatus}
                />
              ) : (
                <div className={styles.emptyState}>
                  <div className={styles.emptyStateIcon}>📋</div>
                  <div className={styles.emptyStateText}>{t('swarm.taskNotFound')}</div>
                </div>
              )
            ) : state.leadAgent.phase !== 'idle' ? (
              /* 没有选中任务但 LeadAgent 活跃 → 显示 LeadAgent AgentChatPanel */
              <AgentChatPanel
                agentType="lead"
                agentLabel={getPhaseLabel(state.leadAgent.phase) || (state.leadAgent.phase === 'failed' ? t('swarm.phase.executionFailed') : '')}
                status={leadAgentStatus}
                stream={leadStream}
                canInterject={canInterjectLead}
                onInterject={(msg) => interjectLead(msg)}
                interjectStatus={state.leadInterjectStatus}
              />
            ) : (
              /* 空状态 / 卡死恢复 */
              <div className={styles.emptyState}>
                {isStalled ? (
                  <>
                    <div className={styles.emptyStateIcon}>⚠️</div>
                    <div className={styles.emptyStateText}>
                      {t('swarm.stalledExecution')}
                    </div>
                    <button
                      className={styles.resumeButton}
                      onClick={handleResumeLead}
                      disabled={isResuming}
                    >
                      {isResuming ? t('swarm.resuming') : t('swarm.resumeExecution')}
                    </button>
                  </>
                ) : (
                  <>
                    <div className={styles.emptyStateIcon}>🧠</div>
                    <div className={styles.emptyStateText}>
                      {!selectedBlueprintId ? t('swarm.noBlueprint') : t('swarm.leadAgentStandby')}
                      <br />
                      <span style={{ fontSize: '0.85em', opacity: 0.7 }}>
                        {!selectedBlueprintId ? t('swarm.createBlueprint') : t('swarm.clickToView')}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>

      {/* Agent 探针面板 */}
      <DebugPanel
        isOpen={showDebugPanel}
        onClose={() => setShowDebugPanel(false)}
        send={send}
        addMessageHandler={addMessageHandler}
        blueprintId={selectedBlueprintId || undefined}
      />
    </div>
  );
}
