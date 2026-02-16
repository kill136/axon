/**
 * StatusView - Git Status 标签页视图组件
 * 显示文件变更状态并提供 stage/unstage 操作
 */

import { useLanguage } from '../../i18n';
import type { GitStatus } from './index';

interface StatusViewProps {
  gitStatus: GitStatus | null;
  send: (msg: any) => void;
  projectPath?: string;
}

export function StatusView({ gitStatus, send, projectPath }: StatusViewProps) {
  const { t } = useLanguage();

  // 如果没有 git status 数据，显示加载或空状态
  if (!gitStatus) {
    return (
      <div className="git-status-view">
        <div className="git-status-empty">{t('git.loading')}</div>
      </div>
    );
  }

  const { staged, unstaged, untracked, conflicts, currentBranch, remoteStatus } = gitStatus;

  // 计算是否有变更
  const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0 || conflicts.length > 0;

  // 处理 stage 文件
  const handleStage = (file: string) => {
    if (!projectPath) return;
    send({
      type: 'git:stage',
      payload: { projectPath, files: [file] },
    });
  };

  // 处理 unstage 文件
  const handleUnstage = (file: string) => {
    if (!projectPath) return;
    send({
      type: 'git:unstage',
      payload: { projectPath, files: [file] },
    });
  };

  // 处理点击文件名，获取 diff
  const handleFileDiff = (file: string) => {
    if (!projectPath) return;
    send({
      type: 'git:get_diff',
      payload: { projectPath, file },
    });
  };

  // 获取文件状态标记
  const getFileStatusBadge = (file: string, type: 'staged' | 'unstaged' | 'untracked' | 'conflict') => {
    if (type === 'conflict') return 'U';
    if (type === 'untracked') return '?';
    if (type === 'staged' && file.startsWith('D ')) return 'D';
    if (type === 'staged' && file.startsWith('A ')) return 'A';
    if (type === 'unstaged' && file.startsWith('D ')) return 'D';
    return 'M';
  };

  // 清理文件名（移除状态前缀）
  const cleanFileName = (file: string) => {
    return file.replace(/^[AMDUR?]\s+/, '');
  };

  return (
    <div className="git-status-view">
      {/* 分支信息头部 */}
      <div className="git-status-header">
        <div className="git-status-branch">
          📍 {t('git.currentBranch')}: <strong>{currentBranch}</strong>
        </div>
        {remoteStatus && (remoteStatus.ahead > 0 || remoteStatus.behind > 0) && (
          <div className="git-status-remote">
            {remoteStatus.ahead > 0 && (
              <span className="git-status-ahead">
                ↑ {t('git.ahead', { count: remoteStatus.ahead })}
              </span>
            )}
            {remoteStatus.behind > 0 && (
              <span className="git-status-behind">
                ↓ {t('git.behind', { count: remoteStatus.behind })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 如果没有变更 */}
      {!hasChanges && (
        <div className="git-status-empty">
          ✓ {t('git.noChanges')}
        </div>
      )}

      {/* Conflicts（最高优先级，红色） */}
      {conflicts.length > 0 && (
        <div className="git-file-group">
          <div className="git-file-group-title git-file-group-title--conflict">
            🔴 {t('git.conflicts')} ({conflicts.length})
          </div>
          {conflicts.map((file, index) => (
            <div key={`conflict-${index}`} className="git-file-item git-file-item--conflict">
              <span className="git-file-status-badge">U</span>
              <span className="git-file-name" onClick={() => handleFileDiff(cleanFileName(file))}>
                {cleanFileName(file)}
              </span>
              <div className="git-file-actions">
                {/* Conflict 文件通常需要手动解决，这里只提供查看 diff */}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Staged Changes（绿色） */}
      {staged.length > 0 && (
        <div className="git-file-group">
          <div className="git-file-group-title git-file-group-title--staged">
            ✓ {t('git.staged')} ({staged.length})
          </div>
          {staged.map((file, index) => {
            const cleanFile = cleanFileName(file);
            const badge = getFileStatusBadge(file, 'staged');
            return (
              <div key={`staged-${index}`} className="git-file-item git-file-item--staged">
                <span className="git-file-status-badge">{badge}</span>
                <span className="git-file-name" onClick={() => handleFileDiff(cleanFile)}>
                  {cleanFile}
                </span>
                <div className="git-file-actions">
                  <button
                    className="git-action-button git-action-button--unstage"
                    onClick={() => handleUnstage(cleanFile)}
                    title={t('git.unstage')}
                  >
                    {t('git.unstage')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Changes（黄色） */}
      {unstaged.length > 0 && (
        <div className="git-file-group">
          <div className="git-file-group-title git-file-group-title--modified">
            ⚠️ {t('git.modified')} ({unstaged.length})
          </div>
          {unstaged.map((file, index) => {
            const cleanFile = cleanFileName(file);
            const badge = getFileStatusBadge(file, 'unstaged');
            return (
              <div key={`unstaged-${index}`} className="git-file-item git-file-item--modified">
                <span className="git-file-status-badge">{badge}</span>
                <span className="git-file-name" onClick={() => handleFileDiff(cleanFile)}>
                  {cleanFile}
                </span>
                <div className="git-file-actions">
                  <button
                    className="git-action-button git-action-button--stage"
                    onClick={() => handleStage(cleanFile)}
                    title={t('git.stage')}
                  >
                    {t('git.stage')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Untracked Files（灰色） */}
      {untracked.length > 0 && (
        <div className="git-file-group">
          <div className="git-file-group-title git-file-group-title--untracked">
            ❓ {t('git.untracked')} ({untracked.length})
          </div>
          {untracked.map((file, index) => {
            const cleanFile = cleanFileName(file);
            return (
              <div key={`untracked-${index}`} className="git-file-item git-file-item--untracked">
                <span className="git-file-status-badge">?</span>
                <span className="git-file-name" onClick={() => handleFileDiff(cleanFile)}>
                  {cleanFile}
                </span>
                <div className="git-file-actions">
                  <button
                    className="git-action-button git-action-button--stage"
                    onClick={() => handleStage(cleanFile)}
                    title={t('git.stage')}
                  >
                    {t('git.stage')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
