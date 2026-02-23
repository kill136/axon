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
                isRunning
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
              className={`${styles.actionButton} ${styles.delete}`}
              onClick={() => handleDelete(selectedTask.id)}
            >
              {t('schedule.delete')}
            </button>
          </div>
        </div>

        <div className={styles.detailInfo}>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.type.interval')}</div>
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
          <button className={styles.refreshButton} onClick={loadTasks}>
            🔄 {t('schedule.refresh')}
          </button>
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
    </div>
  );
};

export default SchedulePage;
