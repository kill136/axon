import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { FileArtifact, ArtifactGroup } from '../../hooks/useArtifacts';
import type { ScheduleArtifact } from '../../hooks/useScheduleArtifacts';
import { computeSideBySideDiff } from '../../utils/diffUtils';
import { useLanguage } from '../../i18n';
import './ArtifactsPanel.css';

interface ArtifactsPanelProps {
  groups: ArtifactGroup[];
  artifacts: FileArtifact[];
  selectedId: string | null;
  selectedArtifact: FileArtifact | null;
  onSelectArtifact: (id: string | null) => void;
  onClose: () => void;
  scheduleArtifacts?: ScheduleArtifact[];
  selectedScheduleId?: string | null;
  selectedScheduleArtifact?: ScheduleArtifact | null;
  onSelectScheduleArtifact?: (id: string | null) => void;
}

function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

function getDirPath(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getLatestToolName(group: ArtifactGroup): string {
  const last = group.artifacts[group.artifacts.length - 1];
  return last?.toolName || 'Edit';
}

function getLatestStatus(group: ArtifactGroup): string {
  const statuses = group.artifacts.map(a => a.status);
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('pending')) return 'pending';
  return 'completed';
}

/**
 * Diff 详情视图
 */
function DiffDetailView({ artifact }: { artifact: FileArtifact }) {
  const oldLines = (artifact.oldString || '').split('\n');
  const newLines = (artifact.newString || '').split('\n');

  const diffRows = useMemo(
    () => computeSideBySideDiff(oldLines, newLines),
    [artifact.oldString, artifact.newString]
  );

  const removedCount = diffRows.filter(r => r.left && !r.right).length;
  const addedCount = diffRows.filter(r => !r.left && r.right).length;

  return (
    <div className="artifacts-diff">
      <div className="artifacts-diff-header">
        <span style={{ color: 'var(--text-muted)' }}>
          {removedCount + addedCount} changes
        </span>
        <div className="artifacts-diff-stats">
          {removedCount > 0 && <span className="artifacts-diff-stat-removed">-{removedCount}</span>}
          {addedCount > 0 && <span className="artifacts-diff-stat-added">+{addedCount}</span>}
        </div>
      </div>
      <div className="artifacts-diff-table">
        {diffRows.map((row, i) => (
          <div key={i} className="artifacts-diff-row">
            <div className={`artifacts-diff-cell ${
              row.left
                ? (row.left.type === 'removed' ? 'artifacts-diff-cell--removed' : 'artifacts-diff-cell--unchanged')
                : 'artifacts-diff-cell--empty'
            }`}>
              {row.left && (
                <>
                  <span className="artifacts-diff-cell-prefix">
                    {row.left.type === 'removed' ? '\u2212' : '\u00A0'}
                  </span>
                  <span className="artifacts-diff-cell-text">{row.left.text || '\u00A0'}</span>
                </>
              )}
            </div>
            <div className={`artifacts-diff-cell ${
              row.right
                ? (row.right.type === 'added' ? 'artifacts-diff-cell--added' : 'artifacts-diff-cell--unchanged')
                : 'artifacts-diff-cell--empty'
            }`}>
              {row.right && (
                <>
                  <span className="artifacts-diff-cell-prefix">
                    {row.right.type === 'added' ? '+' : '\u00A0'}
                  </span>
                  <span className="artifacts-diff-cell-text">{row.right.text || '\u00A0'}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Write 内容详情视图
 */
function ContentDetailView({ artifact }: { artifact: FileArtifact }) {
  const lines = (artifact.content || '').split('\n');
  return (
    <div className="artifacts-content-view">
      <div className="artifacts-content-header">
        <span>{lines.length} lines</span>
        <span>Write</span>
      </div>
      <div className="artifacts-content-body">
        <pre>
          {lines.map((line, i) => (
            <div key={i} className="artifacts-content-line">
              <span className="artifacts-content-line-number">{i + 1}</span>
              <span className="artifacts-content-line-text">{line || '\u00A0'}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/**
 * 产物详情 - 大尺寸 overlay 弹窗，方便程序员阅读
 */
function ArtifactDetailOverlay({
  artifact,
  onClose,
}: {
  artifact: FileArtifact;
  onClose: () => void;
}) {
  const toolBadgeClass = artifact.toolName === 'Write'
    ? 'artifacts-detail-tool-badge--write'
    : 'artifacts-detail-tool-badge--edit';

  // Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="artifacts-overlay" onClick={onClose}>
      <div className="artifacts-overlay-content" onClick={e => e.stopPropagation()}>
        <div className="artifacts-overlay-header">
          <div className="artifacts-overlay-file-info">
            <span className={`artifacts-detail-tool-badge ${toolBadgeClass}`}>
              {artifact.toolName}
            </span>
            <span className="artifacts-overlay-filepath">{artifact.filePath}</span>
          </div>
          <button className="artifacts-overlay-close" onClick={onClose} title="Close (Esc)">
            &#215;
          </button>
        </div>
        <div className="artifacts-overlay-body">
          {artifact.toolName === 'Edit' || artifact.toolName === 'MultiEdit' ? (
            <DiffDetailView artifact={artifact} />
          ) : (
            <ContentDetailView artifact={artifact} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 格式化倒计时剩余时间
 */
function formatCountdown(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec >= 60) {
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}m ${sec}s`;
  }
  return `${totalSec}s`;
}

/**
 * 定时任务状态 badge 文字
 */
function getScheduleStatusText(artifact: ScheduleArtifact): string {
  switch (artifact.phase) {
    case 'countdown':
      return artifact.remainingMs != null ? `倒计时 ${formatCountdown(artifact.remainingMs)}` : '倒计时';
    case 'executing':
      return '执行中...';
    case 'done':
      return artifact.result && !artifact.result.success ? '失败' : '完成';
    default:
      return '等待中';
  }
}

/**
 * 定时任务状态对应的 CSS modifier
 */
function getScheduleStatusClass(artifact: ScheduleArtifact): string {
  switch (artifact.phase) {
    case 'countdown': return 'countdown';
    case 'executing': return 'running';
    case 'done':
      return artifact.result && !artifact.result.success ? 'error' : 'completed';
    default: return 'pending';
  }
}

/**
 * 定时任务卡片
 */
function ScheduleArtifactItem({
  artifact,
  isSelected,
  onClick,
}: {
  artifact: ScheduleArtifact;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusClass = getScheduleStatusClass(artifact);
  const statusText = getScheduleStatusText(artifact);

  // 倒计时进度
  const progress = useMemo(() => {
    if (artifact.phase !== 'countdown' || !artifact.triggerAt || artifact.remainingMs == null) return null;
    const totalMs = artifact.triggerAt - (Date.now() - artifact.remainingMs);
    if (totalMs <= 0) return 100;
    return Math.max(0, Math.min(100, ((totalMs - artifact.remainingMs) / totalMs) * 100));
  }, [artifact.phase, artifact.triggerAt, artifact.remainingMs]);

  return (
    <div
      className={`schedule-artifact-item ${isSelected ? 'schedule-artifact-item--selected' : ''}`}
      onClick={onClick}
    >
      <div className="schedule-artifact-header">
        <span className="schedule-artifact-name">{artifact.taskName}</span>
        <span className={`schedule-artifact-status schedule-artifact-status--${statusClass}`}>
          {statusText}
        </span>
      </div>
      {artifact.phase === 'countdown' && progress != null && (
        <div className="schedule-artifact-bar">
          <div className="countdown-bar-track">
            <div className="countdown-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {artifact.triggerAt && artifact.phase !== 'countdown' && (
        <div className="schedule-artifact-time">
          {new Date(artifact.triggerAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  );
}

/**
 * 定时任务详情 overlay
 */
function ScheduleDetailOverlay({
  artifact,
  onClose,
}: {
  artifact: ScheduleArtifact;
  onClose: () => void;
}) {
  const statusClass = getScheduleStatusClass(artifact);
  const statusText = getScheduleStatusText(artifact);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="artifacts-overlay" onClick={onClose}>
      <div className="artifacts-overlay-content" onClick={e => e.stopPropagation()}>
        <div className="artifacts-overlay-header">
          <div className="artifacts-overlay-file-info">
            <span className="artifacts-detail-tool-badge artifacts-detail-tool-badge--schedule">
              ScheduleTask
            </span>
            <span className="artifacts-overlay-filepath">{artifact.taskName}</span>
          </div>
          <button className="artifacts-overlay-close" onClick={onClose} title="Close (Esc)">
            &#215;
          </button>
        </div>
        <div className="artifacts-overlay-body">
          <div className="schedule-detail">
            <div className="schedule-detail-row">
              <span className="schedule-detail-label">状态</span>
              <span className={`schedule-artifact-status schedule-artifact-status--${statusClass}`}>
                {statusText}
              </span>
            </div>
            {artifact.triggerAt && (
              <div className="schedule-detail-row">
                <span className="schedule-detail-label">触发时间</span>
                <span className="schedule-detail-value">
                  {new Date(artifact.triggerAt).toLocaleString()}
                </span>
              </div>
            )}
            {artifact.prompt && (
              <div className="schedule-detail-section">
                <div className="schedule-detail-label">提示词</div>
                <pre className="schedule-detail-prompt"><code>{artifact.prompt}</code></pre>
              </div>
            )}
            {artifact.result && (
              <div className="schedule-detail-section">
                <div className="schedule-detail-label">
                  {artifact.result.success ? '执行结果' : '错误信息'}
                </div>
                <pre className={`schedule-detail-result ${artifact.result.success ? '' : 'schedule-detail-result--error'}`}>
                  <code>{artifact.result.output || artifact.result.error || '(无输出)'}</code>
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Artifacts Panel 主组件
 */
export function ArtifactsPanel({
  groups,
  artifacts,
  selectedId,
  selectedArtifact,
  onSelectArtifact,
  onClose,
  scheduleArtifacts,
  selectedScheduleId,
  selectedScheduleArtifact,
  onSelectScheduleArtifact,
}: ArtifactsPanelProps) {
  const { t } = useLanguage();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const totalCount = artifacts.length + (scheduleArtifacts?.length || 0);
  const hasBothSections = (scheduleArtifacts?.length || 0) > 0 && groups.length > 0;

  const toggleFileExpand = (filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  const handleFileClick = (group: ArtifactGroup) => {
    if (group.artifacts.length === 1) {
      // 单个变更，直接打开详情
      onSelectArtifact(group.artifacts[0].id);
    } else {
      // 多个变更，展开/折叠列表
      toggleFileExpand(group.filePath);
    }
  };

  const handleCloseDetail = () => {
    onSelectArtifact(null);
    onSelectScheduleArtifact?.(null);
  };

  return (
    <div className="artifacts-panel">
      {/* 文件产物详情 overlay */}
      {selectedArtifact && createPortal(
        <ArtifactDetailOverlay artifact={selectedArtifact} onClose={handleCloseDetail} />,
        document.body
      )}

      {/* 定时任务详情 overlay */}
      {selectedScheduleArtifact && createPortal(
        <ScheduleDetailOverlay artifact={selectedScheduleArtifact} onClose={handleCloseDetail} />,
        document.body
      )}

      <div className="artifacts-panel-header">
        <div className="artifacts-panel-title">
          <span className="artifacts-panel-title-icon">&#9874;</span>
          {t('artifacts.title')}
          {totalCount > 0 && (
            <span className="artifacts-panel-badge">{totalCount}</span>
          )}
        </div>
        <button className="artifacts-panel-close" onClick={onClose} title="Close panel">
          &#215;
        </button>
      </div>

      {/* 定时任务分区 */}
          {scheduleArtifacts && scheduleArtifacts.length > 0 && (
            <div className="artifacts-section">
              {hasBothSections && (
                <div className="artifacts-section-header">定时任务</div>
              )}
              <div className="artifacts-file-list">
                {scheduleArtifacts.map(sa => (
                  <ScheduleArtifactItem
                    key={sa.id}
                    artifact={sa}
                    isSelected={selectedScheduleId === sa.id}
                    onClick={() => {
                      onSelectArtifact(null);
                      onSelectScheduleArtifact?.(sa.id);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 文件变更分区 */}
          {groups.length === 0 && (!scheduleArtifacts || scheduleArtifacts.length === 0) ? (
            <div className="artifacts-empty">
              <div className="artifacts-empty-icon">&#128196;</div>
              <div className="artifacts-empty-text">{t('artifacts.empty')}</div>
            </div>
          ) : groups.length > 0 ? (
            <div className="artifacts-section">
              {hasBothSections && (
                <div className="artifacts-section-header">文件变更</div>
              )}
              <div className="artifacts-file-list">
              {groups.map(group => {
                const fileName = getFileName(group.filePath);
                const dirPath = getDirPath(group.filePath);
                const toolName = getLatestToolName(group);
                const status = getLatestStatus(group);
                const isExpanded = expandedFiles.has(group.filePath);
                const iconClass = toolName === 'Write' ? 'artifacts-file-icon--write' : 'artifacts-file-icon--edit';
                const iconChar = toolName === 'Write' ? '\u2795' : '\u270E';

                return (
                  <div key={group.filePath} className="artifacts-file-group">
                    <div
                      className="artifacts-file-item"
                      onClick={() => handleFileClick(group)}
                    >
                      <div className={`artifacts-file-icon ${iconClass}`}>
                        {iconChar}
                      </div>
                      <div className="artifacts-file-info">
                        <span className="artifacts-file-name">{fileName}</span>
                        {dirPath && <span className="artifacts-file-path">{dirPath}</span>}
                      </div>
                      <div className="artifacts-file-meta">
                        {group.artifacts.length > 1 && (
                          <span className="artifacts-change-count">
                            {group.artifacts.length}
                          </span>
                        )}
                        <span className={`artifacts-status-dot artifacts-status-dot--${status}`} />
                      </div>
                    </div>

                    {/* 展开的变更子列表 */}
                    {isExpanded && group.artifacts.length > 1 && (
                      <div className="artifacts-changes-list">
                        {group.artifacts.map(artifact => {
                          const toolClass = artifact.toolName === 'Write'
                            ? 'artifacts-change-tool--write'
                            : 'artifacts-change-tool--edit';
                          const isSelected = selectedId === artifact.id;

                          return (
                            <div
                              key={artifact.id}
                              className={`artifacts-change-item ${isSelected ? 'artifacts-change-item--selected' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectArtifact(artifact.id);
                              }}
                            >
                              <span className={`artifacts-change-tool ${toolClass}`}>
                                {artifact.toolName}
                              </span>
                              <span className={`artifacts-status-dot artifacts-status-dot--${artifact.status}`} />
                              <span className="artifacts-change-time">
                                {formatTime(artifact.timestamp)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          ) : null}
    </div>
  );
}
