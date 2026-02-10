import React, { useEffect, useRef, useState, useMemo } from 'react';
import { QueenStatus, QueenAgent } from './QueenStatus';
import { WorkerCard, WorkerAgent } from './WorkerCard';
import { MarkdownContent } from '../../MarkdownContent';
import { ToolCall as ToolCallComponent } from '../../ToolCall';
import type { ToolUse } from '../../../types';
import styles from './WorkerPanel.module.css';

/**
 * Worker 日志条目类型
 */
export interface WorkerLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  type: 'tool' | 'decision' | 'status' | 'output' | 'error';
  message: string;
  details?: any;
}

/**
 * v2.1: 流式内容块类型（参考 App.tsx）
 */
export type StreamContentBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input?: any; result?: string; error?: string; status: 'running' | 'completed' | 'error' };

/**
 * v2.1: 任务流式内容类型
 */
export interface TaskStreamContent {
  content: StreamContentBlock[];
  lastUpdated: string;
  /** v4.6: Agent 的 System Prompt */
  systemPrompt?: string;
  /** v4.6: Agent 类型 */
  agentType?: 'worker' | 'e2e' | 'reviewer';
}

/**
 * 选中任务的类型定义
 */
export interface SelectedTask {
  id: string;
  name: string;
  description?: string;
  type: 'code' | 'config' | 'test' | 'refactor' | 'docs' | 'integrate';
  complexity: 'trivial' | 'simple' | 'moderate' | 'complex';
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  needsTest?: boolean;
  estimatedMinutes?: number;
  workerId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: {
    success: boolean;
    testsRan?: boolean;
    testsPassed?: boolean;
    error?: string;
  };
  files?: string[];
  dependencies?: string[];
}

/**
 * v4.5: 用户插嘴状态
 */
export interface InterjectStatus {
  taskId: string;
  success: boolean;
  message: string;
  timestamp: string;
}

/**
 * WorkerPanel 组件属性
 * v2.0: queen 变为可选，因为 RealtimeCoordinator 直接调度
 * v2.1: 新增 selectedTask 和 taskLogs 用于显示任务详情和日志
 * v4.4: 新增 onInterject 用于用户插嘴
 * v4.5: 新增 interjectStatus 用于显示插嘴反馈
 */
interface WorkerPanelProps {
  queen?: QueenAgent | null;
  workers: WorkerAgent[];
  selectedTask?: SelectedTask | null;
  taskStream?: TaskStreamContent | null;
  // v4.4: 用户插嘴回调
  onInterject?: (taskId: string, message: string) => void;
  // v4.5: 用户插嘴状态反馈
  interjectStatus?: InterjectStatus | null;
}

/**
 * 任务类型的显示配置
 */
const TASK_TYPE_CONFIG = {
  code: { icon: '💻', label: '代码编写' },
  config: { icon: '⚙️', label: '配置文件' },
  test: { icon: '🧪', label: '测试用例' },
  refactor: { icon: '🔧', label: '代码重构' },
  docs: { icon: '📄', label: '文档编写' },
  integrate: { icon: '🔗', label: '功能集成' },
} as const;

/**
 * 复杂度的显示配置
 */
const COMPLEXITY_CONFIG = {
  trivial: { label: '极简', color: '#4ade80' },
  simple: { label: '简单', color: '#60a5fa' },
  moderate: { label: '中等', color: '#f59e0b' },
  complex: { label: '复杂', color: '#f87171' },
} as const;

/**
 * 任务状态的显示配置
 */
const STATUS_CONFIG = {
  pending: { icon: '⏳', label: '等待中', color: '#9ca3af' },
  running: { icon: '🔄', label: '执行中', color: '#60a5fa' },
  reviewing: { icon: '🔍', label: '审核中', color: '#c084fc' },
  completed: { icon: '✅', label: '已完成', color: '#4ade80' },
  failed: { icon: '❌', label: '失败', color: '#f87171' },
  skipped: { icon: '⏭️', label: '已跳过', color: '#9ca3af' },
} as const;

/**
 * 日志级别样式配置
 */
const LOG_LEVEL_CONFIG = {
  info: { icon: 'ℹ️', className: 'logInfo' },
  warn: { icon: '⚠️', className: 'logWarn' },
  error: { icon: '❌', className: 'logError' },
  debug: { icon: '🔍', className: 'logDebug' },
} as const;

/**
 * 日志类型图标配置
 */
const LOG_TYPE_ICONS = {
  tool: '🔧',
  decision: '🤔',
  status: '📊',
  output: '📝',
  error: '❗',
} as const;

/**
 * 任务执行面板组件
 * v2.2: 重构为 Worker 聊天式执行日志视图
 * 主要展示 Worker 的工具调用、思考、回复等执行过程
 */
const TaskDetailCard: React.FC<{
  task: SelectedTask;
  workers: WorkerAgent[];
  stream?: TaskStreamContent | null;
}> = ({ task, workers, stream }) => {
  const statusConfig = (task.status && STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]) ?? STATUS_CONFIG.pending;

  // v2.2: 任务信息折叠状态（默认折叠，聚焦于 Worker 执行日志）
  const [showTaskInfo, setShowTaskInfo] = useState(false);

  // 找到执行该任务的 Worker
  const assignedWorker = task.workerId
    ? workers.find(w => w.id === task.workerId)
    : null;

  // 格式化时间
  const formatTime = (isoString?: string): string => {
    if (!isoString) return '-';
    try {
      return new Date(isoString).toLocaleTimeString('zh-CN');
    } catch {
      return '-';
    }
  };

  // 计算执行时长
  const getDuration = (): string => {
    if (!task.startedAt) return '-';
    const start = new Date(task.startedAt).getTime();
    const end = task.completedAt ? new Date(task.completedAt).getTime() : Date.now();
    const seconds = Math.floor((end - start) / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  // v2.2: 根据任务状态和 Worker 信息决定显示内容
  const getWorkerDisplayInfo = () => {
    // 有 Worker 详情
    if (assignedWorker) {
      return {
        type: 'worker',
        worker: assignedWorker,
      };
    }
    // 有 workerId 但找不到 Worker 详情（可能是数据同步延迟）
    if (task.workerId) {
      return {
        type: 'working',
        workerId: task.workerId,
      };
    }
    // 根据任务状态判断
    if (task.status === 'running') {
      return { type: 'executing' };
    }
    if (task.status === 'completed') {
      return { type: 'completed' };
    }
    if (task.status === 'failed') {
      return { type: 'failed' };
    }
    // 默认：等待分配
    return { type: 'pending' };
  };

  const workerDisplay = getWorkerDisplayInfo();

  return (
    <div className={styles.workerExecutionPanel}>
      {/* v2.2: Worker 执行面板头部 - 显示 Worker 信息 */}
      <div className={styles.workerExecHeader}>
        {workerDisplay.type === 'worker' && workerDisplay.worker ? (
          <>
            <div className={styles.workerExecInfo}>
              <span className={styles.workerExecIcon}>🐝</span>
              <span className={styles.workerExecId}>{workerDisplay.worker.id.slice(0, 12)}</span>
              {workerDisplay.worker.modelUsed && (
                <span className={`${styles.workerExecModel} ${styles[workerDisplay.worker.modelUsed]}`}>
                  {workerDisplay.worker.modelUsed}
                </span>
              )}
              <span className={`${styles.workerExecStatus} ${styles[workerDisplay.worker.status]}`}>
                {workerDisplay.worker.status === 'idle' ? '💤 空闲' :
                 workerDisplay.worker.status === 'working' ? '💻 工作中' :
                 workerDisplay.worker.status === 'waiting' ? '⏳ 等待中' : '❌ 错误'}
              </span>
            </div>
            {/* Worker 进度条 */}
            {workerDisplay.worker.progress > 0 && (
              <div className={styles.workerExecProgress}>
                <div className={styles.workerExecProgressBar}>
                  <div
                    className={styles.workerExecProgressFill}
                    style={{ width: `${workerDisplay.worker.progress}%` }}
                  />
                </div>
                <span className={styles.workerExecProgressText}>{workerDisplay.worker.progress}%</span>
              </div>
            )}
          </>
        ) : workerDisplay.type === 'working' ? (
          // 有 workerId 但暂时找不到详情
          <div className={styles.workerExecInfo}>
            <span className={styles.workerExecIcon}>🐝</span>
            <span className={styles.workerExecId}>{workerDisplay.workerId?.slice(0, 12)}</span>
            <span className={`${styles.workerExecStatus} ${styles.working}`}>💻 工作中</span>
          </div>
        ) : workerDisplay.type === 'executing' ? (
          // 任务执行中但没有 workerId
          <div className={styles.workerExecInfo}>
            <span className={styles.workerExecIcon}>🔄</span>
            <span className={styles.workerExecId}>Worker 执行中...</span>
          </div>
        ) : workerDisplay.type === 'completed' ? (
          // 任务已完成
          <div className={styles.workerExecInfo}>
            <span className={styles.workerExecIcon}>✅</span>
            <span className={styles.workerExecId}>任务已完成</span>
          </div>
        ) : workerDisplay.type === 'failed' ? (
          // 任务失败
          <div className={styles.workerExecInfo}>
            <span className={styles.workerExecIcon}>❌</span>
            <span className={styles.workerExecId}>任务执行失败</span>
          </div>
        ) : (
          // 等待分配
          <div className={styles.workerExecInfo}>
            <span className={styles.workerExecIcon}>⏳</span>
            <span className={styles.workerExecId}>等待分配 Worker...</span>
          </div>
        )}
        <div className={styles.workerExecTaskStatus} style={{ color: statusConfig.color }}>
          {statusConfig.icon} {statusConfig.label}
        </div>
      </div>

      {/* v2.2: 任务简要信息（可折叠） */}
      <div className={styles.taskBrief}>
        <div
          className={styles.taskBriefHeader}
          onClick={() => setShowTaskInfo(!showTaskInfo)}
        >
          <span className={styles.taskBriefName}>{task.name}</span>
          <span className={styles.taskBriefToggle}>{showTaskInfo ? '收起' : '展开详情'}</span>
        </div>
        {showTaskInfo && (
          <div className={styles.taskBriefContent}>
            {task.description && (
              <div className={styles.taskBriefDesc}>{task.description}</div>
            )}
            <div className={styles.taskBriefMeta}>
              <span>类型: {task.type}</span>
              <span>复杂度: {task.complexity}</span>
              <span>预估: ~{task.estimatedMinutes || 0}分钟</span>
              {task.startedAt && <span>开始: {formatTime(task.startedAt)}</span>}
              {task.completedAt && <span>完成: {formatTime(task.completedAt)}</span>}
              {task.startedAt && <span>耗时: {getDuration()}</span>}
            </div>
            {task.files && task.files.length > 0 && (
              <div className={styles.taskBriefFiles}>
                📁 涉及文件: {task.files.slice(0, 3).join(', ')}
                {task.files.length > 3 && ` 等 ${task.files.length} 个`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* v2.2: Worker 当前操作（实时显示） */}
      {workerDisplay.type === 'worker' && workerDisplay.worker?.currentAction && task.status === 'running' && (
        <div className={styles.workerCurrentAction}>
          <span className={styles.currentActionIcon}>
            {workerDisplay.worker.currentAction.type === 'read' ? '📖' :
             workerDisplay.worker.currentAction.type === 'write' ? '✍️' :
             workerDisplay.worker.currentAction.type === 'edit' ? '📝' :
             workerDisplay.worker.currentAction.type === 'run_test' ? '🧪' :
             workerDisplay.worker.currentAction.type === 'install_dep' ? '📦' :
             workerDisplay.worker.currentAction.type === 'git' ? '🌿' :
             workerDisplay.worker.currentAction.type === 'think' ? '🤔' :
             workerDisplay.worker.currentAction.type === 'explore' ? '🔍' :
             workerDisplay.worker.currentAction.type === 'analyze' ? '🔬' : '⚙️'}
          </span>
          <span className={styles.currentActionText}>{workerDisplay.worker.currentAction.description}</span>
          <span className={styles.currentActionPulse}></span>
        </div>
      )}

      {/* v2.2: 错误信息（显眼位置） */}
      {(task.error || task.result?.error) && (
        <div className={styles.workerExecError}>
          <span className={styles.errorIcon}>⚠️</span>
          <span className={styles.errorText}>{task.error || task.result?.error}</span>
        </div>
      )}

      {/* v2.2: Worker 聊天式执行日志（主体） */}
      <WorkerChatLog taskStatus={task.status} worker={workerDisplay.type === 'worker' ? workerDisplay.worker : null} stream={stream} />
    </div>
  );
};

/**
 * v2.2: Worker 聊天式执行日志组件
 * 以类似聊天界面的形式展示 Worker 的工具调用、思考、输出
 * v4.6: 新增 System Prompt 展示功能（透明展示 Agent 指令）
 */
const WorkerChatLog: React.FC<{
  taskStatus?: string;
  worker?: WorkerAgent | null;
  stream?: TaskStreamContent | null;
}> = ({ taskStatus, worker, stream }) => {
  const logsContainerRef = useRef<HTMLDivElement>(null);
  // v4.6: 控制 System Prompt 展开/折叠
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);

  // v4.3: 过滤掉冗余的日志消息，保留正常的模型回复和工具调用
  // 冗余日志格式: "[EnvAgent] 执行工具: xxx" 或 "[E2ETestAgent] xxx" 等
  const LOG_PATTERN = /^\[[\w-]+\]\s*(执行工具|Starting|Checking|Running|Found|Using|Tool)/;

  const filteredBlocks = useMemo(() => {
    if (!stream?.content) return [];
    return stream.content.filter(block => {
      // 保留所有 tool 和 thinking 类型
      if (block.type === 'tool' || block.type === 'thinking') return true;
      // text 类型：过滤掉日志格式的消息
      if (block.type === 'text') {
        const text = block.text.trim();
        // 过滤掉空文本和日志格式的文本
        if (!text) return false;
        if (LOG_PATTERN.test(text)) return false;
        return true;
      }
      return true;
    });
  }, [stream?.content]);

  // 自动滚动到底部（当日志或流式内容变化时）
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [filteredBlocks.length, stream?.lastUpdated]);

  // 计算总消息数
  const totalMessageCount = filteredBlocks.length;

  // 将 StreamContentBlock 转换为官方 ToolUse 类型
  const toToolUse = (block: StreamContentBlock & { type: 'tool' }): ToolUse => ({
    id: block.id,
    name: block.name,
    input: block.input || {},
    status: block.status,
    result: block.status !== 'running' ? {
      success: block.status === 'completed',
      output: block.result,
      error: block.error,
    } : undefined,
  });

  // 渲染内容块
  const renderContentBlock = (block: StreamContentBlock, index: number) => {
    switch (block.type) {
      case 'thinking':
        return (
          <div key={`thinking-${index}`} className="thinking-block">
            <div className="thinking-header">💭 思考中</div>
            <div>{block.text}</div>
          </div>
        );
      case 'text':
        return (
          <div key={`text-${index}`}>
            <MarkdownContent content={block.text} />
          </div>
        );
      case 'tool':
        return (
          <ToolCallComponent key={block.id} toolUse={toToolUse(block)} />
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.workerChatContainer}>
      <div className={styles.workerChatHeader}>
        <span>📜 执行日志</span>
        <span className={styles.chatLogCount}>{totalMessageCount} 条</span>
        {taskStatus === 'running' && (
          <span className={styles.chatLiveIndicator}>🔴 实时</span>
        )}
        {/* v4.6: System Prompt 查看按钮 */}
        {stream?.systemPrompt && (
          <button
            className={styles.systemPromptToggle}
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
            title="查看 Agent 指令（System Prompt）"
          >
            🧠 {showSystemPrompt ? '隐藏指令' : '查看指令'}
          </button>
        )}
      </div>

      {/* v4.6: System Prompt 展示区域（可折叠） */}
      {showSystemPrompt && stream?.systemPrompt && (
        <div className={styles.systemPromptContainer}>
          <div className={styles.systemPromptHeader}>
            <span className={styles.systemPromptIcon}>🧠</span>
            <span className={styles.systemPromptTitle}>
              Agent System Prompt
              {stream.agentType && (
                <span className={styles.agentTypeBadge}>
                  {stream.agentType === 'worker' ? '🐝 Worker' :
                   stream.agentType === 'e2e' ? '🧪 E2E' :
                   stream.agentType === 'reviewer' ? '🔍 Reviewer' : stream.agentType}
                </span>
              )}
            </span>
            <button
              className={styles.systemPromptClose}
              onClick={() => setShowSystemPrompt(false)}
            >
              ✕
            </button>
          </div>
          <pre className={styles.systemPromptContent}>
            {stream.systemPrompt}
          </pre>
        </div>
      )}

      <div className={styles.workerChatMessages} ref={logsContainerRef}>
        {/* v4.3: 显示过滤后的内容块（工具调用 + 正常文本，排除日志消息） */}
        {filteredBlocks.map(renderContentBlock)}

        {/* 空状态 */}
        {totalMessageCount === 0 && (
          <div className={styles.chatEmpty}>
            {taskStatus === 'pending' ? (
              <>
                <span className={styles.chatEmptyIcon}>⏳</span>
                <span>等待任务开始执行...</span>
              </>
            ) : taskStatus === 'running' ? (
              <>
                <span className={styles.chatEmptyIcon}>🔄</span>
                <span>Worker 正在启动...</span>
              </>
            ) : (
              <>
                <span className={styles.chatEmptyIcon}>📝</span>
                <span>暂无执行日志</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Worker 自主决策记录（如果有） */}
      {worker?.decisions && worker.decisions.length > 0 && (
        <div className={styles.workerDecisionsFooter}>
          <div className={styles.decisionsTitle}>🤖 自主决策 ({worker.decisions.length})</div>
          <div className={styles.decisionsList}>
            {worker.decisions.slice(-3).map((decision, index) => (
              <div key={index} className={styles.decisionBadge}>
                {decision.type === 'skip_test' ? '跳过测试' :
                 decision.type === 'add_test' ? '添加测试' :
                 decision.type === 'install_dep' ? '安装依赖' :
                 decision.type === 'retry' ? '重试' :
                 decision.type === 'strategy' ? '策略' : decision.type}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * v2.2: Worker 详情展开面板（保留，但不再作为主要显示方式）
 * 显示 Worker 的完整执行详情：工具调用、思考、回复等
 */
const WorkerDetailPanel: React.FC<{
  worker: WorkerAgent;
  logs: WorkerLogEntry[];
}> = ({ worker, logs }) => {
  // 日志分类
  const toolLogs = logs.filter(log => log.type === 'tool');
  const decisionLogs = logs.filter(log => log.type === 'decision');
  const statusLogs = logs.filter(log => log.type === 'status');
  const outputLogs = logs.filter(log => log.type === 'output');
  const errorLogs = logs.filter(log => log.type === 'error');

  // 活动标签页状态
  const [activeTab, setActiveTab] = useState<'tools' | 'decisions' | 'output' | 'all'>('all');

  // 格式化时间
  const formatTime = (isoString: string): string => {
    try {
      return new Date(isoString).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '--:--:--';
    }
  };

  // 模型文本映射
  const modelTexts: Record<string, { label: string; color: string }> = {
    opus: { label: 'Opus', color: '#c084fc' },
    sonnet: { label: 'Sonnet', color: '#60a5fa' },
    haiku: { label: 'Haiku', color: '#4ade80' },
  };

  // 状态文本映射
  const statusTexts: Record<string, { icon: string; label: string; color: string }> = {
    idle: { icon: '💤', label: '空闲中', color: '#9ca3af' },
    working: { icon: '💻', label: '工作中', color: '#60a5fa' },
    waiting: { icon: '⏳', label: '等待中', color: '#f59e0b' },
    error: { icon: '❌', label: '出错', color: '#ef4444' },
  };

  // 决策类型文本映射
  const decisionTypeTexts: Record<string, string> = {
    strategy: '策略',
    skip_test: '跳过测试',
    add_test: '添加测试',
    install_dep: '安装依赖',
    retry: '重试',
    other: '其他',
  };

  // 根据活动标签页筛选日志
  const getFilteredLogs = () => {
    switch (activeTab) {
      case 'tools':
        return toolLogs;
      case 'decisions':
        return decisionLogs;
      case 'output':
        return [...outputLogs, ...statusLogs].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      case 'all':
      default:
        return logs;
    }
  };

  const filteredLogs = getFilteredLogs();
  const statusInfo = statusTexts[worker.status] || statusTexts.idle;
  const modelInfo = worker.modelUsed ? modelTexts[worker.modelUsed] : null;

  return (
    <div className={styles.workerDetailPanel}>
      {/* Worker 基本信息 */}
      <div className={styles.workerDetailHeader}>
        <div className={styles.workerDetailTitle}>
          <span className={styles.workerDetailIcon}>🐝</span>
          <span>Worker 详情</span>
        </div>
        <div className={styles.workerDetailBadges}>
          {modelInfo && (
            <span className={styles.workerDetailModelBadge} style={{ color: modelInfo.color }}>
              {modelInfo.label}
            </span>
          )}
          <span className={styles.workerDetailStatusBadge} style={{ color: statusInfo.color }}>
            {statusInfo.icon} {statusInfo.label}
          </span>
        </div>
      </div>

      {/* Worker 基础信息 */}
      <div className={styles.workerDetailInfo}>
        <div className={styles.workerDetailInfoRow}>
          <span className={styles.workerDetailInfoLabel}>ID</span>
          <span className={styles.workerDetailInfoValue}>{worker.id}</span>
        </div>
        {worker.branchName && (
          <div className={styles.workerDetailInfoRow}>
            <span className={styles.workerDetailInfoLabel}>分支</span>
            <span className={styles.workerDetailInfoValue}>
              🌿 {worker.branchName}
              {worker.branchStatus === 'conflict' && (
                <span className={styles.branchConflict}>冲突</span>
              )}
              {worker.branchStatus === 'merged' && (
                <span className={styles.branchMerged}>已合并</span>
              )}
            </span>
          </div>
        )}
        {worker.progress > 0 && (
          <div className={styles.workerDetailInfoRow}>
            <span className={styles.workerDetailInfoLabel}>进度</span>
            <span className={styles.workerDetailInfoValue}>
              <div className={styles.workerDetailProgress}>
                <div className={styles.workerDetailProgressBar}>
                  <div
                    className={styles.workerDetailProgressFill}
                    style={{ width: `${worker.progress}%` }}
                  />
                </div>
                <span>{worker.progress}%</span>
              </div>
            </span>
          </div>
        )}
      </div>

      {/* 当前操作 */}
      {worker.currentAction && (
        <div className={styles.workerDetailCurrentAction}>
          <div className={styles.workerDetailSectionTitle}>🔨 当前操作</div>
          <div className={styles.workerDetailActionItem}>
            <span className={styles.workerDetailActionIcon}>
              {worker.currentAction.type === 'read' ? '📖' :
               worker.currentAction.type === 'write' ? '✍️' :
               worker.currentAction.type === 'edit' ? '📝' :
               worker.currentAction.type === 'run_test' ? '🧪' :
               worker.currentAction.type === 'install_dep' ? '📦' :
               worker.currentAction.type === 'git' ? '🌿' :
               worker.currentAction.type === 'think' ? '🤔' :
               worker.currentAction.type === 'explore' ? '🔍' :
               worker.currentAction.type === 'analyze' ? '🔬' : '⚙️'}
            </span>
            <span className={styles.workerDetailActionText}>
              {worker.currentAction.description}
            </span>
          </div>
        </div>
      )}

      {/* Worker 自主决策记录 */}
      {worker.decisions && worker.decisions.length > 0 && (
        <div className={styles.workerDetailDecisions}>
          <div className={styles.workerDetailSectionTitle}>🤖 自主决策记录</div>
          <div className={styles.workerDetailDecisionList}>
            {worker.decisions.map((decision, index) => (
              <div key={index} className={styles.workerDetailDecisionItem}>
                <span className={styles.workerDetailDecisionType}>
                  {decisionTypeTexts[decision.type] || decision.type}
                </span>
                <span className={styles.workerDetailDecisionDesc}>
                  {decision.description}
                </span>
                <span className={styles.workerDetailDecisionTime}>
                  {formatTime(decision.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 日志分类标签页 */}
      <div className={styles.workerDetailTabs}>
        <button
          className={`${styles.workerDetailTab} ${activeTab === 'all' ? styles.active : ''}`}
          onClick={() => setActiveTab('all')}
        >
          全部 ({logs.length})
        </button>
        <button
          className={`${styles.workerDetailTab} ${activeTab === 'tools' ? styles.active : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          🔧 工具调用 ({toolLogs.length})
        </button>
        <button
          className={`${styles.workerDetailTab} ${activeTab === 'decisions' ? styles.active : ''}`}
          onClick={() => setActiveTab('decisions')}
        >
          🤔 思考决策 ({decisionLogs.length})
        </button>
        <button
          className={`${styles.workerDetailTab} ${activeTab === 'output' ? styles.active : ''}`}
          onClick={() => setActiveTab('output')}
        >
          📝 输出 ({outputLogs.length + statusLogs.length})
        </button>
      </div>

      {/* 日志详情列表 */}
      <div className={styles.workerDetailLogList}>
        {filteredLogs.length === 0 ? (
          <div className={styles.workerDetailLogEmpty}>
            暂无 {activeTab === 'all' ? '日志' : activeTab === 'tools' ? '工具调用' : activeTab === 'decisions' ? '决策' : '输出'} 记录
          </div>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className={`${styles.workerDetailLogItem} ${styles[`log${log.level.charAt(0).toUpperCase() + log.level.slice(1)}`]}`}
            >
              <div className={styles.workerDetailLogHeader}>
                <span className={styles.workerDetailLogTime}>{formatTime(log.timestamp)}</span>
                <span className={styles.workerDetailLogType}>
                  {LOG_TYPE_ICONS[log.type] || '📝'}
                </span>
                <span className={`${styles.workerDetailLogLevel} ${styles[log.level]}`}>
                  {log.level.toUpperCase()}
                </span>
              </div>
              <div className={styles.workerDetailLogMessage}>{log.message}</div>
              {log.details && (
                <div className={styles.workerDetailLogDetails}>
                  <details>
                    <summary>查看详情</summary>
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </details>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 错误日志（如果有） */}
      {errorLogs.length > 0 && activeTab === 'all' && (
        <div className={styles.workerDetailErrors}>
          <div className={styles.workerDetailSectionTitle}>❌ 错误记录 ({errorLogs.length})</div>
          <div className={styles.workerDetailErrorList}>
            {errorLogs.map((log) => (
              <div key={log.id} className={styles.workerDetailErrorItem}>
                <span className={styles.workerDetailErrorTime}>{formatTime(log.timestamp)}</span>
                <span className={styles.workerDetailErrorMessage}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Worker 日志区域组件
 */
const WorkerLogSection: React.FC<{
  logs: WorkerLogEntry[];
  taskStatus?: string;
}> = ({ logs, taskStatus }) => {
  const logsContainerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (logsContainerRef.current && logs.length > 0) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // 格式化时间
  const formatLogTime = (isoString: string): string => {
    try {
      return new Date(isoString).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '--:--:--';
    }
  };

  return (
    <div className={styles.taskDetailLogs}>
      <div className={styles.taskDetailSectionTitle}>
        <span>📋</span>
        <span>执行日志 ({logs.length})</span>
        {taskStatus === 'running' && (
          <span className={styles.logsLiveIndicator}>🔴 实时</span>
        )}
      </div>
      <div className={styles.logsContainer} ref={logsContainerRef}>
        {logs.length === 0 ? (
          <div className={styles.logsEmpty}>
            {taskStatus === 'pending' ? (
              <>
                <span className={styles.logsEmptyIcon}>⏳</span>
                <span>等待任务开始执行...</span>
              </>
            ) : taskStatus === 'running' ? (
              <>
                <span className={styles.logsEmptyIcon}>🔄</span>
                <span>等待日志输出...</span>
              </>
            ) : (
              <>
                <span className={styles.logsEmptyIcon}>📝</span>
                <span>暂无执行日志</span>
              </>
            )}
          </div>
        ) : (
          logs.map((log) => {
            const levelConfig = LOG_LEVEL_CONFIG[log.level] || LOG_LEVEL_CONFIG.info;
            const typeIcon = LOG_TYPE_ICONS[log.type] || '📝';
            return (
              <div
                key={log.id}
                className={`${styles.logEntry} ${styles[levelConfig.className]}`}
              >
                <span className={styles.logTime}>{formatLogTime(log.timestamp)}</span>
                <span className={styles.logTypeIcon}>{typeIcon}</span>
                <span className={styles.logMessage}>{log.message}</span>
                {log.details && (
                  <span className={styles.logDetails} title={JSON.stringify(log.details, null, 2)}>
                    📎
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/**
 * Worker 面板主组件
 * 展示所有 Worker Agents 的状态
 * v2.0: Queen 是可选的，仅在提供时显示
 * v2.1: 支持显示选中任务的详情和执行日志
 * v4.4: 支持用户插嘴（发送消息给正在执行的任务）
 */
export const WorkerPanel: React.FC<WorkerPanelProps> = ({ queen, workers, selectedTask, taskStream, onInterject, interjectStatus }) => {
  // v4.4: 用户插嘴输入状态
  const [interjectInput, setInterjectInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  // 处理插嘴发送
  const handleInterjectSubmit = () => {
    if (!interjectInput.trim() || !selectedTask || !onInterject) return;

    setIsSending(true);
    onInterject(selectedTask.id, interjectInput.trim());
    setInterjectInput('');
    // 短暂显示发送状态
    setTimeout(() => setIsSending(false), 500);
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInterjectSubmit();
    }
  };

  // 是否可以插嘴（任务正在执行）
  const canInterject = selectedTask && selectedTask.status === 'running' && onInterject;

  return (
    <div className={styles.panel}>
      {/* 选中任务详情（优先显示） */}
      {selectedTask && (
        <TaskDetailCard task={selectedTask} workers={workers} stream={taskStream} />
      )}

      {/* v4.4: 用户插嘴输入框 */}
      {canInterject && (
        <div className={styles.interjectContainer}>
          <div className={styles.interjectHeader}>
            <span className={styles.interjectIcon}>💬</span>
            <span className={styles.interjectTitle}>插嘴 (向 Worker 发送指令)</span>
          </div>
          <div className={styles.interjectInputWrapper}>
            <textarea
              className={styles.interjectInput}
              value={interjectInput}
              onChange={(e) => setInterjectInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入指令或反馈... (Enter 发送, Shift+Enter 换行)"
              disabled={isSending}
              rows={2}
            />
            <button
              className={styles.interjectButton}
              onClick={handleInterjectSubmit}
              disabled={!interjectInput.trim() || isSending}
            >
              {isSending ? '发送中...' : '发送'}
            </button>
          </div>
          {/* v4.5: 插嘴状态反馈 */}
          {interjectStatus && interjectStatus.taskId === selectedTask.id ? (
            <div className={`${styles.interjectFeedback} ${interjectStatus.success ? styles.success : styles.error}`}>
              {interjectStatus.success ? '✅' : '❌'} {interjectStatus.message}
            </div>
          ) : (
            <div className={styles.interjectHint}>
              提示：Worker 会在下一轮对话中收到您的消息
            </div>
          )}
        </div>
      )}

      {/* Queen 状态卡片（v2.0 可选） */}
      {queen && <QueenStatus queen={queen} />}

      {/* Worker 卡片列表 */}
      {/* v4.5: 过滤逻辑 - 选中任务时只显示关联 worker，否则只显示非空闲的 worker */}
      {(() => {
        // 过滤 workers：
        // 1. 如果选中了任务，只显示与该任务关联的 worker
        // 2. 否则只显示非空闲状态的 worker（正在工作或等待的）
        const filteredWorkers = selectedTask
          ? workers.filter(w => w.taskId === selectedTask.id)
          : workers.filter(w => w.status !== 'idle');

        return filteredWorkers.length > 0 ? (
          filteredWorkers.map((worker) => (
            <WorkerCard key={worker.id} worker={worker} />
          ))
        ) : !selectedTask && (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>👷</div>
            <div className={styles.emptyStateText}>
              暂无 Worker 数据
              <br />
              等待任务分配...
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// 导出类型定义（SelectedTask 和 WorkerLogEntry 已在顶部定义并导出）
export type { QueenAgent, WorkerAgent };
export { QueenStatus, WorkerCard, WorkerChatLog };
export default WorkerPanel;
