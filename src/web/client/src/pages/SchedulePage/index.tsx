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
  watchEvents?: string[];
  debounceMs?: number;
  notify?: ('desktop' | 'feishu')[];
  feishuChatId?: string;
  silentToken?: string;
  timeoutMs?: number;
  context?: string;
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
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<any>('');
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

  const handleSave = useCallback(async (field: string, value: any) => {
    if (!selectedTask) return;
    
    const body: any = {};
    body[field] = value;
    
    try {
      const res = await fetch(`/api/schedule/tasks/${selectedTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      
      if (data.success) {
        setEditingField(null);
        // WebSocket 会自动更新 tasks 列表，无需手动更新
      } else {
        alert(t('schedule.saveFailed') + ': ' + (data.error || t('schedule.unknownError')));
      }
    } catch (err) {
      alert(t('schedule.saveFailed') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [selectedTask, t]);

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
      alert(t('schedule.validation.nameRequired'));
      return;
    }
    if (!formData.prompt.trim()) {
      alert(t('schedule.validation.promptRequired'));
      return;
    }

    // 类型特定验证
    if (formData.type === 'once') {
      if (!formData.triggerAt) {
        alert(t('schedule.validation.triggerTimeRequired'));
        return;
      }
    }
    if (formData.type === 'interval') {
      if (formData.intervalValue <= 0) {
        alert(t('schedule.validation.intervalRequired'));
        return;
      }
    }
    if (formData.type === 'watch') {
      if (!formData.watchPaths.trim()) {
        alert(t('schedule.validation.watchPathRequired'));
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
        alert(t('schedule.createFailed') + ': ' + (data.error || t('schedule.unknownError')));
      }
    } catch (err) {
      console.error('Failed to create task:', err);
      alert(t('schedule.createFailed'));
    }
  }, [formData, loadTasks, handleCloseModal, t]);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 60000); // 改为 60 秒兜底
    return () => clearInterval(interval);
  }, [loadTasks]);

  // WebSocket 实时监听定时任务变化
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'schedule:task_created':
            setTasks(prev => [...prev, msg.payload.task]);
            break;
          case 'schedule:task_updated':
            setTasks(prev => prev.map(t => t.id === msg.payload.task.id ? msg.payload.task : t));
            break;
          case 'schedule:task_deleted':
            setTasks(prev => prev.filter(t => t.id !== msg.payload.taskId));
            if (selectedId === msg.payload.taskId) setSelectedId(null);
            break;
        }
      } catch (err) {
        console.error('WS message parse error:', err);
      }
    };
    
    return () => ws.close();
  }, [selectedId]);

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
            <h1 className={editingField === 'name' ? '' : styles.editableTitle}
                onClick={() => {
                  if (editingField !== 'name') {
                    setEditingField('name');
                    setEditValue(selectedTask.name);
                  }
                }}>
              {editingField === 'name' ? (
                <input
                  className={styles.titleEditInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => {
                    if (editValue.trim() && editValue !== selectedTask.name) {
                      handleSave('name', editValue.trim());
                    } else {
                      setEditingField(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                  autoFocus
                />
              ) : (
                selectedTask.name
              )}
            </h1>
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
              ▶ {t('schedule.runNow')}
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
                  ? t('schedule.taskMaybeStuck')
                  : t('schedule.taskRunning')}
              </div>
              <div className={styles.warningText}>
                {t('schedule.startedAt')} {formatTime(selectedTask.runningAtMs)}
                {now - selectedTask.runningAtMs > 10 * 60 * 1000 && (
                  <span style={{ color: 'var(--accent-error)', marginLeft: '8px' }}>
                    {t('schedule.runningFor')} {formatDuration(now - selectedTask.runningAtMs)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={styles.detailInfo}>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.taskType')}</div>
            <div className={styles.infoValue}>
              {t(`schedule.type.${selectedTask.type}`)}
            </div>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.model')}</div>
            <div className={editingField === 'model' ? '' : styles.editable}
                 onClick={() => {
                   if (editingField !== 'model') {
                     setEditingField('model');
                     setEditValue(selectedTask.model || 'sonnet');
                   }
                 }}>
              {editingField === 'model' ? (
                <select
                  className={styles.editSelect}
                  value={editValue}
                  onChange={(e) => {
                    handleSave('model', e.target.value);
                  }}
                  onBlur={() => setEditingField(null)}
                  autoFocus
                >
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                  <option value="opus">Opus</option>
                </select>
              ) : (
                <span className={styles.infoValue}>
                  {selectedTask.model === 'haiku' ? 'Haiku' :
                   selectedTask.model === 'opus' ? 'Opus' :
                   'Sonnet'}
                </span>
              )}
              {editingField !== 'model' && <span className={styles.editIcon}>✏️</span>}
            </div>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>{t('schedule.created')}</div>
            <div className={styles.infoValue}>{formatTime(selectedTask.createdAt)}</div>
          </div>
          {selectedTask.type === 'interval' && selectedTask.intervalMs && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('schedule.interval')}</div>
              <div className={editingField === 'intervalMs' ? '' : styles.editable}
                   onClick={() => {
                     if (editingField !== 'intervalMs') {
                       setEditingField('intervalMs');
                       setEditValue(selectedTask.intervalMs || 60000);
                     }
                   }}>
                {editingField === 'intervalMs' ? (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="number"
                      className={styles.editInput}
                      value={Math.floor((editValue as number) / 1000)}
                      onChange={(e) => setEditValue(parseInt(e.target.value) * 1000 || 0)}
                      onBlur={() => {
                        if (editValue > 0 && editValue !== selectedTask.intervalMs) {
                          handleSave('intervalMs', editValue);
                        } else {
                          setEditingField(null);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        } else if (e.key === 'Escape') {
                          setEditingField(null);
                        }
                      }}
                      min="1"
                      autoFocus
                    />
                    <span className={styles.infoValue} style={{ paddingTop: '8px' }}>{t('schedule.unit.seconds')}</span>
                  </div>
                ) : (
                  <span className={styles.infoValue}>
                    {formatDuration(selectedTask.intervalMs)}
                  </span>
                )}
                {editingField !== 'intervalMs' && <span className={styles.editIcon}>✏️</span>}
              </div>
            </div>
          )}
          {selectedTask.type === 'once' && selectedTask.triggerAt && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>{t('schedule.nextRun')}</div>
              <div className={editingField === 'triggerAt' ? '' : styles.editable}
                   onClick={() => {
                     if (editingField !== 'triggerAt') {
                       setEditingField('triggerAt');
                       const date = new Date(selectedTask.triggerAt!);
                       const localDatetime = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                         .toISOString()
                         .slice(0, 16);
                       setEditValue(localDatetime);
                     }
                   }}>
                {editingField === 'triggerAt' ? (
                  <input
                    type="datetime-local"
                    className={styles.editInput}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                      if (editValue) {
                        const newTriggerAt = new Date(editValue).getTime();
                        if (newTriggerAt !== selectedTask.triggerAt) {
                          handleSave('triggerAt', newTriggerAt);
                        } else {
                          setEditingField(null);
                        }
                      } else {
                        setEditingField(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        setEditingField(null);
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <span className={styles.infoValue}>{formatTime(selectedTask.triggerAt)}</span>
                )}
                {editingField !== 'triggerAt' && <span className={styles.editIcon}>✏️</span>}
              </div>
            </div>
          )}
          {selectedTask.type === 'watch' && selectedTask.watchPaths && (
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>Watch Paths</div>
              <div className={editingField === 'watchPaths' ? '' : styles.editable}
                   onClick={() => {
                     if (editingField !== 'watchPaths') {
                       setEditingField('watchPaths');
                       setEditValue(selectedTask.watchPaths?.join(', ') || '');
                     }
                   }}>
                {editingField === 'watchPaths' ? (
                  <input
                    type="text"
                    className={styles.editInput}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                      if (editValue.trim()) {
                        const paths = editValue.split(',').map(p => p.trim()).filter(p => p);
                        if (JSON.stringify(paths) !== JSON.stringify(selectedTask.watchPaths)) {
                          handleSave('watchPaths', paths);
                        } else {
                          setEditingField(null);
                        }
                      } else {
                        setEditingField(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        setEditingField(null);
                      }
                    }}
                    autoFocus
                  />
                ) : (
                  <div className={`${styles.infoValue} ${styles.mono}`}>
                    {selectedTask.watchPaths.join(', ')}
                  </div>
                )}
                {editingField !== 'watchPaths' && <span className={styles.editIcon}>✏️</span>}
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
                    {t('schedule.nextRetryIn', { time: formatCountdown(selectedTask.nextRunAtMs, now) })}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>Silent Token</div>
            <div className={editingField === 'silentToken' ? '' : styles.editable}
                 onClick={() => {
                   if (editingField !== 'silentToken') {
                     setEditingField('silentToken');
                     setEditValue(selectedTask.silentToken || '');
                   }
                 }}>
              {editingField === 'silentToken' ? (
                <input
                  type="text"
                  className={styles.editInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => {
                    const newValue = editValue.trim() || undefined;
                    if (newValue !== selectedTask.silentToken) {
                      handleSave('silentToken', newValue);
                    } else {
                      setEditingField(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                  placeholder={t('schedule.placeholder.notSet')}
                  autoFocus
                />
              ) : (
                <span className={styles.infoValue}>{selectedTask.silentToken || '-'}</span>
              )}
              {editingField !== 'silentToken' && <span className={styles.editIcon}>✏️</span>}
            </div>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>Timeout (ms)</div>
            <div className={editingField === 'timeoutMs' ? '' : styles.editable}
                 onClick={() => {
                   if (editingField !== 'timeoutMs') {
                     setEditingField('timeoutMs');
                     setEditValue(selectedTask.timeoutMs || 300000);
                   }
                 }}>
              {editingField === 'timeoutMs' ? (
                <input
                  type="number"
                  className={styles.editInput}
                  value={editValue}
                  onChange={(e) => setEditValue(parseInt(e.target.value) || 0)}
                  onBlur={() => {
                    const newValue = editValue > 0 ? editValue : undefined;
                    if (newValue !== selectedTask.timeoutMs) {
                      handleSave('timeoutMs', newValue);
                    } else {
                      setEditingField(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setEditingField(null);
                    }
                  }}
                  min="1000"
                  autoFocus
                />
              ) : (
                <span className={styles.infoValue}>{selectedTask.timeoutMs || '-'}</span>
              )}
              {editingField !== 'timeoutMs' && <span className={styles.editIcon}>✏️</span>}
            </div>
          </div>
          <div className={`${styles.infoCard} ${styles.promptCard}`}>
            <div className={styles.infoLabel}>{t('schedule.prompt')}</div>
            <div className={editingField === 'prompt' ? '' : styles.editable}
                 onClick={() => {
                   if (editingField !== 'prompt') {
                     setEditingField('prompt');
                     setEditValue(selectedTask.prompt);
                   }
                 }}>
              {editingField === 'prompt' ? (
                <div className={styles.editTextareaWrapper}>
                  <textarea
                    className={styles.editTextarea}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingField(null);
                      }
                    }}
                    autoFocus
                  />
                  <div className={styles.editTextareaActions}>
                    <button
                      className={styles.editCancelBtn}
                      onClick={() => setEditingField(null)}
                    >
                      {t('schedule.cancel')}
                    </button>
                    <button
                      className={styles.editSaveBtn}
                      onClick={() => {
                        if (editValue.trim() && editValue !== selectedTask.prompt) {
                          handleSave('prompt', editValue.trim());
                        } else {
                          setEditingField(null);
                        }
                      }}
                    >
                      {t('schedule.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.promptValue}>{selectedTask.prompt}</div>
              )}
              {editingField !== 'prompt' && <span className={styles.editIcon}>✏️</span>}
            </div>
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
              + {t('schedule.createTask')}
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
              <h2>{t('schedule.createScheduledTask')}</h2>
              <button className={styles.closeButton} onClick={handleCloseModal}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t('schedule.form.taskName')} *</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t('schedule.placeholder.taskName')}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t('schedule.form.taskType')} *</label>
                <select
                  className={styles.formInput}
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                >
                  <option value="once">{t('schedule.form.typeOnce')}</option>
                  <option value="interval">{t('schedule.form.typeInterval')}</option>
                  <option value="watch">{t('schedule.form.typeWatch')}</option>
                </select>
              </div>

              {formData.type === 'once' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{t('schedule.form.triggerTime')} *</label>
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
                  <label className={styles.formLabel}>{t('schedule.form.interval')} *</label>
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
                      <option value="seconds">{t('schedule.unit.seconds')}</option>
                      <option value="minutes">{t('schedule.unit.minutes')}</option>
                      <option value="hours">{t('schedule.unit.hours')}</option>
                    </select>
                  </div>
                </div>
              )}

              {formData.type === 'watch' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>{t('schedule.form.watchPaths')} *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={formData.watchPaths}
                    onChange={(e) => setFormData({ ...formData, watchPaths: e.target.value })}
                    placeholder={t('schedule.placeholder.watchPaths')}
                  />
                </div>
              )}

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t('schedule.form.aiModel')}</label>
                <select
                  className={styles.formInput}
                  value={formData.model}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                >
                  <option value="sonnet">Claude Sonnet ({t('schedule.form.recommended')})</option>
                  <option value="haiku">Claude Haiku ({t('schedule.form.fast')})</option>
                  <option value="opus">Claude Opus ({t('schedule.form.advanced')})</option>
                </select>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>AI Prompt *</label>
                <textarea
                  className={styles.formTextarea}
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder={t('schedule.placeholder.prompt')}
                  rows={4}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>{t('schedule.form.notifyChannel')}</label>
                <div className={styles.checkboxGroup}>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={formData.notifyDesktop}
                      onChange={(e) => setFormData({ ...formData, notifyDesktop: e.target.checked })}
                    />
                    <span>{t('schedule.form.desktopNotify')}</span>
                  </label>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={formData.notifyFeishu}
                      onChange={(e) => setFormData({ ...formData, notifyFeishu: e.target.checked })}
                    />
                    <span>{t('schedule.form.feishuNotify')}</span>
                  </label>
                </div>
              </div>
            </div>
            <div className={styles.formActions}>
              <button className={styles.cancelButton} onClick={handleCloseModal}>
                {t('schedule.cancel')}
              </button>
              <button className={styles.submitButton} onClick={handleCreateTask}>
                {t('schedule.createTask')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SchedulePage;
