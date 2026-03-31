import { useState, useEffect, useCallback } from 'react';
import { logsApi } from '../../../api/blueprint';
import styles from '../SwarmConsole.module.css';

interface TaskExecution {
  id: string;
  blueprintId: string;
  taskId: string;
  taskName: string;
  workerId: string;
  attempt: number;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  error?: string;
}

interface ExecutionHistoryProps {
  blueprintId: string;
}

export function ExecutionHistory({ blueprintId }: ExecutionHistoryProps) {
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!blueprintId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await logsApi.getBlueprintLogs(blueprintId, { limit: 100 });
      setExecutions(data.executions || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load execution history');
    } finally {
      setLoading(false);
    }
  }, [blueprintId]);

  useEffect(() => {
    if (expanded) {
      loadHistory();
    }
  }, [expanded, loadHistory]);

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return '...';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (iso: string): string => {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  };

  const statusIcon = (status: string): string => {
    switch (status) {
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'running': return '⏳';
      default: return '•';
    }
  };

  return (
    <div className={styles.executionHistory}>
      <button
        className={styles.executionHistoryToggle}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▼' : '▶'} Execution History
        {executions.length > 0 && ` (${executions.length})`}
      </button>

      {expanded && (
        <div className={styles.executionHistoryContent}>
          {loading && <div className={styles.historyLoading}>Loading...</div>}
          {error && <div className={styles.historyError}>{error}</div>}
          {!loading && !error && executions.length === 0 && (
            <div className={styles.historyEmpty}>No execution history yet</div>
          )}
          {executions.length > 0 && (
            <table className={styles.executionHistoryTable}>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Attempt</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {executions.map(exec => (
                  <tr key={exec.id} data-status={exec.status}>
                    <td title={exec.taskId}>{exec.taskName}</td>
                    <td>{statusIcon(exec.status)} {exec.status}</td>
                    <td>#{exec.attempt}</td>
                    <td>{formatTime(exec.startedAt)}</td>
                    <td>{formatDuration(exec.startedAt, exec.completedAt)}</td>
                    <td className={styles.errorCell} title={exec.error || ''}>
                      {exec.error ? exec.error.substring(0, 60) + (exec.error.length > 60 ? '...' : '') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            className={styles.refreshButton}
            onClick={loadHistory}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
