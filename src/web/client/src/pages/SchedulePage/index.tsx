import React, { useState, useEffect, useCallback, useMemo } from 'react';
import styles from './SchedulePage.module.css';
import { useLanguage } from '../../i18n';

interface ScheduledTask {
  id: string;
  type: 'once' | 'interval' | 'watch';
  name: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  model?: string;
  intervalMs?: number;
  triggerAt?: number;
  watchPaths?: string[];
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'failed' | 'timeout';
  lastRunError?: string;
  lastDurationMs?: number;
  runCount?: number;
  consecutiveErrors?: number;
}

interface RunLogEntry {
  ts: number;
  taskId: string;
  taskName: string;
  status: 'success' | 'failed' | 'timeout';
  error?: string;
  durationMs?: number;
}

const SchedulePage: React.FC = () => {
  const { t } = useLanguage();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<RunLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'interval' as 'once' | 'interval' | 'watch',
    prompt: '',
    model: 'sonnet',
    triggerAt: '',
    intervalValue: 60,
    intervalUnit: 'seconds' as 'seconds' | 'minutes' | 'hours',
    watchPaths: '',
    notifyDesktop: false,
    notifyFeishu: false,
  });

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedId),
    [tasks, selectedId]
  );

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/schedule/tasks');
      const data = await res.json();
      if (data.success) {
        setTasks(data.data);
      }
    } catch (err) {
      console.error('Failed to load tasks:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}/history`);
      const data = await res.json();
      if (data.success) {
        setHistory(data.data);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
      setHistory([]);
    }
  }, []);

  const handleToggle = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}/toggle`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        await loadTasks();
      }
    } catch (err) {
      console.error('Failed to toggle task:', err);
    }
  }, [loadTasks]);

  const handleDelete = useCallback(async (taskId: string) => {
    if (!window.confirm(t('schedule.confirmDelete'))) {
      return;
    }
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        if (selectedId === taskId) {
          setSelectedId(null);
        }
        await loadTasks();
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  }, [selectedId, loadTasks, t]);

  const handleRunNow = useCallback(async (taskId: string) => {
    try {
      const res = await fetch(`/api/schedule/tasks/${taskId}/run-now`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        await loadTasks();
      }
    } catch (err) {
      console.error('Failed to run task:', err);
    }
  }, [loadTasks]);

  const handleCloseModal = useCallback(() => {
    setShowCreateModal(false);
    setFormData({
      name: '',
      type: 'interval',
      prompt: '',
      model: 'sonnet',
      triggerAt: '',
      intervalValue: 60,
      intervalUnit: 'seconds',
      watchPaths: '',
      notifyDesktop: false,
      notifyFeishu: false,
    });
  }, []);

  const handleCreateTask = useCallback(async () => {
    // 表单验证
    if (!formData.name.trim()) {
      alert('请输入任务名称');
      return;
    }
    if (!formData.prompt.trim()) {
      alert('请输入 AI Prompt');
      return;
    }

    // 类型特定验证
    if (formData.type === 'once') {
      if (!formData.triggerAt) {
        alert('请选择触发时间');
        return;
      }
    }
    if (formData.type === 'interval') {
      if (formData.intervalValue <= 0) {
        alert('请输入有效的间隔时间');
        return;
      }
    }
    if (formData.type === 'watch') {
      if (!formData.watchPaths.trim()) {
        alert('请输入监听路径');
        return;
      }
    }

    try {
      // 构造请求数据
      const body: any = {
        type: formData.type,
        name: formData.name.trim(),
        prompt: formData.prompt.trim(),
        model: formData.model,
        notifyChannels: [],
      };

      if (formData.notifyDesktop) body.notifyChannels.push('desktop');
      if (formData.notifyFeishu) body.notifyChannels.push('feishu');

      // 添加类型特定字段
      if (formData.type === 'once') {
        body.triggerAt = new Date(formData.triggerAt).getTime();
      }
      if (formData.type === 'interval') {
        const multiplier = formData.intervalUnit === 'hours' ? 3600000 : formData.intervalUnit === 'minutes' ? 60000 : 1000;
        body.intervalMs = formData.intervalValue * multiplier;
      }
      if (formData.type === 'watch') {
        body.watchPaths = formData.watchPaths.split(',').map(p => p.trim()).filter(p => p);
      }

      const res = await fetch('/api/schedule/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        handleCloseModal();
        await loadTasks();
        // 自动选中新创建的任务
        setSelectedId(data.data.id);
      } else {
        alert('创建失败: ' + (data.error || '未知错误'));
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      alert('创建失败');
    }
  }, [formData, loadTasks, handleCloseModal]);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 10000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  useEffect(() => {
    if (selectedId) {
      loadHistory(selectedId);
    } else {
      setHistory([]);
    }
  }, [selectedId, loadHistory]);

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatCountdown = (nextRunAtMs: number | undefined, currentNow: number): string => {
    if (!nextRunAtMs) return '';
    const diff = nextRunAtMs - currentNow;
    if (diff <= 0) return t('schedule.status.running');

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatDuration = (ms: number | undefined): string => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const formatTime = (ts: number | undefined): string => {
    if (!ts) return '-';
    const date = new Date(ts);
    return date.toLocaleString();
  };

  const renderTaskItem = (task: ScheduledTask) => {
    const isActive = selectedId === task.id;
    const isRunning = typeof task.runningAtMs === 'number';
    const hasError = task.lastRunStatus === 'failed' || task.lastRunStatus === 'timeout';
    const isStuck = isRunning && (now - task.runningAtMs!) > 10 * 60 * 1000; // 卡住超过 10 分钟

    return (
      <div
        key={task.id}
        className={`${styles.taskItem} ${isActive ? styles.active : ''}`}
        onClick={() => setSelectedId(task.id)}
      >
        <div className={styles.taskHeader}>
          <span className={styles.taskName} title={task.name}>
            {task.name}
          </span>
          <span className={`${styles.typeTag} ${styles[task.type]}`}>
            {t(`schedule.type.${task.type}`)}
          </span>
        </div>
        <div className={styles.taskInfo}>
          <div className={styles.taskStatus}>
            <span
              className={`${styles.statusDot} ${
                isStuck
                  ? styles.stuck
                  : isRunning
                  ? styles.running
                  : !task.enabled
                  ? styles.disabled
                  : hasError
                  ? styles.failed
                  : styles.success
              }`}
            />
            {isRunning
              ? t('schedule.status.running')
              : task.enabled
              ? t('schedule.status.enabled')
              : t('schedule.status.disabled')}
          </div>
          {task.enabled && task.nextRunAtMs && !isRunning && (
            <div className={styles.countdown}>
              {t('schedule.nextRun')}: {formatCountdown(task.nextRunAtMs, now)}
            </div>
          )}
          {task.lastRunAt && (
            <div>
              {t('schedule.lastRun')}: {formatTime(task.lastRunAt)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTaskDetail = () => {
    if (!selectedTask) {
      return (
        <div className={styles.selectHint}>
          {t('schedule.empty')}
        </div>
      );
    }

    return (
      <div className={styles.detailScroll}>
        <div className={styles.detailHeader}>
          <div className={styles.detailTitle}>
            <h1>{selectedTask.name}</h1>
            <div className={styles.taskStatus}>
              <span
                className={`${styles.statusDot} ${
                  typeof selectedTask.runningAtMs === 'number'
                    ? styles.running
                    : !selectedTask.enabled
                    ? styles.disabled
                    : selectedTask.lastRunStatus === 'failed' ||
                      selectedTask.lastRunStatus === 'timeout'
                    ? styles.failed
                    : styles.success
                }`}
              />
              {typeof selectedTask.runningAtMs === 'number'
                ? t('schedule.status.running')
                : selectedTask.enabled
                ? t('schedule.status.enabled')
                : t('schedule.status.disabled')}
            </div>
          </div>
          <div className={styles.detailActions}>
            <button
              className={`${styles.actionButton} ${styles.toggle}`}
              onClick={() => handleToggle(selectedTask.id)}
            >
              {selectedTask.enabled ? t('schedule.disable') : t('schedule.enable')}
            </button>
            <button
              className={`${styles.actionButton} ${styles.runNow}`}
              onClick={() => handleRunNow(selectedTask.id)}
            >
              ▶ {t('schedule.runNow') || '立即执行'}
            </button>
            <button
              className={`${styles.actionButton} ${styles.delete}`}
              onClick={() => handleDelete(selectedTask.id)}
            >
              {t('schedule.delete')}
            </button>
          </div>
        </div>

        {/* 卡住警告 */}
        {typeof selectedTask.runningAtMs === 'number' && (
          <div className={`${styles.warningCard} ${
            now - selectedTask.runningAtMs > 10 * 60 * 1000 ? styles.stuckWarning : ''
          }`}>
            <div className={styles.warningIcon}>⚠️</div>
            <div className={styles.warningContent}>
              <div className={styles.warningTitle}>
                {now - selectedTask.runningAtMs > 10 * 60 * 1000
                  ? '任务可能已卡住'
                  : '任务正在执行中'}
              </div>
              <div className={styles.warningText}>
                开始于 {formatTime(selectedTask.runningAtMs)}
                {now - selectedTask.runningAtMs > 10 * 60 * 1000 && (
                  <span style={{ color: 'var(--accent-error)', marginLeft: '8px' }}>
                    已运行 {formatDuration(now - selectedTask.runningAtMs)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={styles.detailInfo}>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.taskType') || '类型'}</div>
            <div className={styles.infoValue}>
              {t(`schedule.type.${selectedTask.type}`)}
            </div>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.model')}</div>
            <div className={styles.infoValue}>{selectedTask.model || '-'}</div>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.created')}</div>
            <div className={styles.infoValue}>{formatTime(selectedTask.createdAt)}</div>
          </div>
          {selectedTask.type === 'interval' && selectedTask.intervalMs && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('schedule.interval')}</div>
              <div className={styles.infoValue}>
                {formatDuration(selectedTask.intervalMs)}
              </div>
            </div>
          )}
          {selectedTask.type === 'once' && selectedTask.triggerAt && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('schedule.nextRun')}</div>
              <div className={styles.infoValue}>{formatTime(selectedTask.triggerAt)}</div>
            </div>
          )}
          {selectedTask.type === 'watch' && selectedTask.watchPaths && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>Watch Paths</div>
              <div className={`${styles.infoValue} ${styles.mono}`}>
                {selectedTask.watchPaths.join(', ')}
              </div>
            </div>
          )}
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.runCount')}</div>
            <div className={styles.infoValue}>{selectedTask.runCount || 0}</div>
          </div>
          {selectedTask.enabled && selectedTask.nextRunAtMs && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('schedule.nextRun')}</div>
              <div className={styles.infoValue}>
                {formatTime(selectedTask.nextRunAtMs)}
                <br />
                <span className={styles.countdown}>
                  ({formatCountdown(selectedTask.nextRunAtMs, now)})
                </span>
              </div>
            </div>
          )}
          {selectedTask.consecutiveErrors !== undefined && selectedTask.consecutiveErrors > 0 && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('schedule.errors')}</div>
              <div className={styles.infoValue} style={{ color: 'var(--accent-error)' }}>
                {selectedTask.consecutiveErrors}
                {selectedTask.nextRunAtMs && selectedTask.enabled && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    下次重试：{formatCountdown(selectedTask.nextRunAtMs, now)} 后（退避中）
                  </div>
                )}
              </div>
            </div>
          )}
          <div className={`${styles.infoCard} ${styles.promptCard}`}>
            <div className={styles.infoLabel}>{t('schedule.prompt')}</div>
            <div className={styles.promptValue}>{selectedTask.prompt}</div>
          </div>
        </div>

        <div className={styles.historySection}>
          <h3 className={styles.historyHeader}>{t('schedule.history')}</h3>
          {history.length === 0 ? (
            <div className={styles.historyEmpty}>{t('schedule.noHistory')}</div>
          ) : (
            <div className={styles.historyList}>
              {history.map((entry, idx) => (
                <div key={idx} className={`${styles.historyItem} ${styles[entry.status]}`}>
                  <div className={styles.historyTop}>
                    <div className={`${styles.historyStatus} ${styles[entry.status]}`}>
                      {entry.status === 'success' && '✓'}
                      {entry.status === 'failed' && '✗'}
                      {entry.status === 'timeout' && '⏱'}
                      <span>{t(`schedule.${entry.status}`)}</span>
                    </div>
                    <div className={styles.historyTime}>
                      {formatTime(entry.ts)}
                      {entry.durationMs && ` • ${formatDuration(entry.durationMs)}`}
                    </div>
                  </div>
                  {entry.error && (
                    <div className={styles.historyError}>{entry.error}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.selectHint}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.taskList}>
        <div className={styles.toolbar}>
          <h2>{t('schedule.title')}</h2>
          <div className={styles.toolbarButtons}>
            <button className={styles.createButton} onClick={() => setShowCreateModal(true)}>
              + 新建任务
            </button>
            <button className={styles.refreshButton} onClick={loadTasks}>
              🔄 {t('schedule.refresh')}
            </button>
          </div>
        </div>
        <div className={styles.listScroll}>
          {tasks.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>⏰</div>
              <div className={styles.emptyText}>{t('schedule.empty')}</div>
              <div className={styles.emptyHint}>{t('schedule.emptyHint')}</div>
            </div>
          ) : (
            tasks.map(renderTaskItem)
          )}
        </div>
      </div>
      <div className={styles.detailPanel}>
        {renderTaskDetail()}
      </div>

      {/* 创建任务模态框 */}
      {showCreateModal && (
        <div className={styles.modalOverlay} onClick={handleCloseModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>新建定时任务</h2>
              <button className={styles.closeButton} onClick={handleCloseModal}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>任务名称 *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="输入任务名称"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>任务类型 *</label>
                <select
                  className={styles.formInput}
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                >
                  <option value="once">单次执行</option>
                  <option value="interval">定时循环</option>
                  <option value="watch">文件监听</option>
                </select>
              </div>

              {formData.type === 'once' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>触发时间 *</label>
                  <input
                    type="datetime-local"
                    className={styles.formInput}
                    value={formData.triggerAt}
                    onChange={(e) => setFormData({ ...formData, triggerAt: e.target.value })}
                  />
                </div>
              )}

              {formData.type === 'interval' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>执行间隔 *</label>
                  <div className={styles.intervalInput}>
                    <input
                      type="number"
                      className={styles.formInput}
                      value={formData.intervalValue}
                      onChange={(e) => setFormData({ ...formData, intervalValue: parseInt(e.target.value) || 0 })}
                      min="1"
                    />
                    <select
                      className={styles.formInput}
                      value={formData.intervalUnit}
                      onChange={(e) => setFormData({ ...formData, intervalUnit: e.target.value as any })}
                    >
                      <option value="seconds">秒</option>
                      <option value="minutes">分钟</option>
                      <option value="hours">小时</option>
                    </select>
                  </div>
                </div>
              )}

              {formData.type === 'watch' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>监听路径 *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={formData.watchPaths}
                    onChange={(e) => setFormData({ ...formData, watchPaths: e.target.value })}
                    placeholder="例如: src/**/*.ts, *.json (逗号分隔)"
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>AI 模型</label>
                <select
                  className={styles.formInput}
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                >
                  <option value="sonnet">Claude Sonnet (推荐)</option>
                  <option value="haiku">Claude Haiku (快速)</option>
                  <option value="opus">Claude Opus (高级)</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>AI Prompt *</label>
                <textarea
                  className={styles.formTextarea}
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder="输入 AI 执行的任务描述..."
                  rows={4}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>通知渠道</label>
                <div className={styles.checkboxGroup}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={formData.notifyDesktop}
                      onChange={(e) => setFormData({ ...formData, notifyDesktop: e.target.checked })}
                    />
                    <span>桌面通知</span>
                  </label>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={formData.notifyFeishu}
                      onChange={(e) => setFormData({ ...formData, notifyFeishu: e.target.checked })}
                    />
                    <span>飞书通知</span>
                  </label>
                </div>
              </div>
            </div>
            <div className={styles.formActions}>
              <button className={styles.cancelButton} onClick={handleCloseModal}>
                取消
              </button>
              <button className={styles.submitButton} onClick={handleCreateTask}>
                创建任务
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulePage;
