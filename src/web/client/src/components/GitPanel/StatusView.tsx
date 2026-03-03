/**
 * StatusView - Git Status 标签页视图组件
 * 显示文件变更状态并提供 stage/unstage 操作
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { ContextMenu, type ContextMenuItem, type ContextMenuEntry } from './ContextMenu';
import type { GitStatus } from './index';

interface StatusViewProps {
  gitStatus: GitStatus | null;
  send: (msg: any) => void;
  projectPath?: string;
}

export function StatusView({ gitStatus, send, projectPath }: StatusViewProps) {
  const { t } = useLanguage();

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    file: string;
    source: 'staged' | 'unstaged' | 'untracked' | 'conflict';
  } | null>(null);

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

  // 处理 Stage All
  const handleStageAll = () => {
    if (!projectPath) return;
    const count = changes.length;
    if (count === 0) return;
    
    const confirmed = window.confirm(t('git.confirmStageAll', { count }));
    if (!confirmed) return;
    
    send({
      type: 'git:stage_all',
      payload: { projectPath },
    });
  };

  // 处理 Unstage All
  const handleUnstageAll = () => {
    if (!projectPath) return;
    const count = staged.length;
    if (count === 0) return;
    
    const confirmed = window.confirm(t('git.confirmUnstageAll', { count }));
    if (!confirmed) return;
    
    send({
      type: 'git:unstage_all',
      payload: { projectPath },
    });
  };

  // 处理 Discard All
  const handleDiscardAll = () => {
    if (!projectPath) return;
    const count = changes.length;
    if (count === 0) return;
    
    const confirmed = window.confirm(t('git.confirmDiscard'));
    if (!confirmed) return;
    
    send({
      type: 'git:discard_all',
      payload: { projectPath },
    });
  };

  // 处理 Discard File
  const handleDiscardFile = (file: string) => {
    if (!projectPath) return;
    
    const confirmed = window.confirm(t('git.confirmDiscardFile', { file }));
    if (!confirmed) return;
    
    send({
      type: 'git:discard_file',
      payload: { projectPath, file },
    });
  };

  // 处理文件右键菜单
  const handleContextMenu = (
    e: React.MouseEvent,
    file: string,
    source: 'staged' | 'unstaged' | 'untracked' | 'conflict'
  ) => {
    e.preventDefault();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      file,
      source,
    });
  };

  // 生成右键菜单项
  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];

    const { file, source } = contextMenu;
    const items: ContextMenuItem[] = [];

    // Stage / Unstage
    if (source === 'unstaged' || source === 'untracked') {
      items.push({
        label: t('git.stage'),
        icon: '➕',
        onClick: () => handleStage(file),
      });
    } else if (source === 'staged') {
      items.push({
        label: t('git.unstage'),
        icon: '➖',
        onClick: () => handleUnstage(file),
      });
    }

    // View Diff (staged/unstaged 文件可看 diff)
    if (source === 'staged' || source === 'unstaged') {
      items.push({
        label: t('git.viewDiff'),
        icon: '🔍',
        onClick: () => handleFileDiff(file),
      });
    }

    // Discard (unstaged/untracked 文件可丢弃)
    if (source === 'unstaged' || source === 'untracked') {
      items.push({
        label: t('git.discard'),
        icon: '🗑️',
        onClick: () => handleDiscardFile(file),
        danger: true,
      });
    }

    // File History (所有文件)
    items.push({
      label: t('git.fileHistory'),
      icon: '📜',
      onClick: () => {
        if (!projectPath) return;
        send({
          type: 'git:get_file_history',
          payload: { projectPath, file },
        });
      },
    });

    // Blame (所有文件)
    items.push({
      label: t('git.blame'),
      icon: '👤',
      onClick: () => {
        if (!projectPath) return;
        send({
          type: 'git:get_blame',
          payload: { projectPath, file },
        });
      },
    });

    return items;
  };

  // 合并 unstaged + untracked 为 "更改" 组（与 VS Code 一致）
  const changes = [
    ...unstaged.map(f => ({ file: f, source: 'unstaged' as const })),
    ...untracked.map(f => ({ file: f, source: 'untracked' as const })),
  ];

  // 获取文件状态标记（与 VS Code 一致）
  // staged/unstaged 文件格式为 "X filename"（如 "M src/foo.ts"），untracked 文件无前缀
  const getFileStatusBadge = (file: string, type: 'staged' | 'unstaged' | 'untracked' | 'conflict') => {
    if (type === 'conflict') return 'C';
    if (type === 'untracked') return 'U';
    // staged 和 unstaged 文件第一个字符就是状态标记
    const status = file[0];
    if (status === 'D') return 'D';
    if (status === 'A') return 'A';
    if (status === 'R') return 'R';
    return 'M';
  };

  // 清理文件名
  // staged/unstaged: "X filename" → "filename"
  // untracked/conflict: "filename" → "filename"（无前缀）
  const cleanFileName = (file: string, type: 'staged' | 'unstaged' | 'untracked' | 'conflict') => {
    if (type === 'staged' || type === 'unstaged') {
      return file.substring(2);
    }
    return file;
  };

  return (
    <div className="git-status-view">
      {/* 分支信息头部 + 远程操作 */}
      <div className="git-status-header">
        <div className="git-status-branch-row">
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

        {/* Push / Pull / Fetch 操作按钮 */}
        <div className="git-sync-actions">
          <button
            className={`git-sync-btn git-sync-btn--fetch`}
            onClick={() => {
              if (!projectPath) return;
              send({ type: 'git:fetch', payload: { projectPath } });
            }}
            title={t('git.fetch')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1a.75.75 0 01.75.75v6.69l1.72-1.72a.75.75 0 011.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 011.06-1.06l1.72 1.72V1.75A.75.75 0 018 1zM3.5 10a.75.75 0 01.75.75v2.5h7.5v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0111.5 15h-7A1.75 1.75 0 012.75 13.25v-2.5a.75.75 0 01.75-.75z"/>
            </svg>
            {t('git.fetch')}
          </button>
          <button
            className={`git-sync-btn git-sync-btn--pull ${remoteStatus && remoteStatus.behind > 0 ? 'git-sync-btn--highlight' : ''}`}
            onClick={() => {
              if (!projectPath) return;
              send({ type: 'git:pull', payload: { projectPath } });
            }}
            title={remoteStatus?.behind ? `${t('git.pull')} (${remoteStatus.behind} behind)` : t('git.pull')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 12a.75.75 0 01-.53-.22l-3.5-3.5a.75.75 0 011.06-1.06L7.75 9.94V1.75a.75.75 0 011.5 0v8.19l2.72-2.72a.75.75 0 011.06 1.06l-3.5 3.5A.75.75 0 018 12z"/>
              <path d="M2.75 14a.75.75 0 010-1.5h10.5a.75.75 0 010 1.5H2.75z"/>
            </svg>
            {t('git.pull')}
            {remoteStatus && remoteStatus.behind > 0 && (
              <span className="git-sync-count">{remoteStatus.behind}</span>
            )}
          </button>
          <button
            className={`git-sync-btn git-sync-btn--push ${remoteStatus && remoteStatus.ahead > 0 ? 'git-sync-btn--highlight' : ''}`}
            onClick={() => {
              if (!projectPath) return;
              send({ type: 'git:push', payload: { projectPath } });
            }}
            title={remoteStatus?.ahead ? `${t('git.push')} (${remoteStatus.ahead} ahead)` : t('git.push')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4a.75.75 0 01.53.22l3.5 3.5a.75.75 0 01-1.06 1.06L8.25 6.06v8.19a.75.75 0 01-1.5 0V6.06L4.03 8.78a.75.75 0 01-1.06-1.06l3.5-3.5A.75.75 0 018 4z"/>
              <path d="M2.75 2a.75.75 0 010-1.5h10.5a.75.75 0 010 1.5H2.75z"/>
            </svg>
            {t('git.push')}
            {remoteStatus && remoteStatus.ahead > 0 && (
              <span className="git-sync-count">{remoteStatus.ahead}</span>
            )}
          </button>
        </div>
      </div>

      {/* 批量操作按钮区域 */}
      {hasChanges && (
        <div className="git-status-actions">
          <button
            className="git-action-button git-action-button--stage-all"
            onClick={handleStageAll}
            disabled={changes.length === 0}
            title={t('git.stageAll')}
          >
            {t('git.stageAll')}
          </button>
          <button
            className="git-action-button git-action-button--unstage-all"
            onClick={handleUnstageAll}
            disabled={staged.length === 0}
            title={t('git.unstageAll')}
          >
            {t('git.unstageAll')}
          </button>
          <button
            className="git-action-button git-action-button--discard-all"
            onClick={handleDiscardAll}
            disabled={changes.length === 0}
            title={t('git.discardAll')}
          >
            {t('git.discardAll')}
          </button>
        </div>
      )}

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
            {t('git.conflicts')} ({conflicts.length})
          </div>
          {conflicts.map((file, index) => {
            const cleanFile = cleanFileName(file, 'conflict');
            return (
              <div
                key={`conflict-${index}`}
                className="git-file-item git-file-item--conflict"
                onContextMenu={(e) => handleContextMenu(e, cleanFile, 'conflict')}
              >
                <span className="git-file-status-badge">C</span>
                <span className="git-file-name" onClick={() => handleFileDiff(cleanFile)}>
                  {cleanFile}
                </span>
                <div className="git-file-actions">
                  {/* Conflict 文件通常需要手动解决，这里只提供查看 diff */}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Staged Changes（绿色） */}
      {staged.length > 0 && (
        <div className="git-file-group">
          <div className="git-file-group-title git-file-group-title--staged">
            {t('git.staged')} ({staged.length})
          </div>
          {staged.map((file, index) => {
            const cleanFile = cleanFileName(file, 'staged');
            const badge = getFileStatusBadge(file, 'staged');
            return (
              <div
                key={`staged-${index}`}
                className="git-file-item git-file-item--staged"
                onContextMenu={(e) => handleContextMenu(e, cleanFile, 'staged')}
              >
                <span className="git-file-status-badge">{badge}</span>
                <span className="git-file-name" onClick={() => handleFileDiff(cleanFile)}>
                  {cleanFile}
                </span>
                <div className="git-file-actions">
                  <button
                    className="git-action-button git-action-button--diff"
                    onClick={() => handleFileDiff(cleanFile)}
                    title={t('git.viewDiff')}
                  >
                    Diff
                  </button>
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

      {/* Changes — 合并已修改 + 未跟踪（与 VS Code 一致） */}
      {changes.length > 0 && (
        <div className="git-file-group">
          <div className="git-file-group-title git-file-group-title--modified">
            {t('git.changes')} ({changes.length})
          </div>
          {changes.map(({ file, source }, index) => {
            const cleanFile = cleanFileName(file, source);
            const badge = getFileStatusBadge(file, source);
            return (
              <div
                key={`change-${index}`}
                className="git-file-item git-file-item--modified"
                onContextMenu={(e) => handleContextMenu(e, cleanFile, source)}
              >
                <span className="git-file-status-badge">{badge}</span>
                <span className="git-file-name" onClick={() => handleFileDiff(cleanFile)}>
                  {cleanFile}
                </span>
                <div className="git-file-actions">
                  <button
                    className="git-action-button git-action-button--diff"
                    onClick={() => handleFileDiff(cleanFile)}
                    title={t('git.viewDiff')}
                  >
                    Diff
                  </button>
                  <button
                    className="git-action-button git-action-button--stage"
                    onClick={() => handleStage(cleanFile)}
                    title={t('git.stage')}
                  >
                    {t('git.stage')}
                  </button>
                  <button
                    className="git-file-discard-btn"
                    onClick={() => handleDiscardFile(cleanFile)}
                    title={t('git.discard')}
                  >
                    {t('git.discard')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          items={getContextMenuItems()}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
