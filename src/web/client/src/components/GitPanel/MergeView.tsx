/**
 * MergeView - Git 冲突解决视图组件
 * 显示冲突文件列表，每个文件显示 ours/theirs 内容，提供解决选项
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import type { GitMergeStatus } from '../../types.ts';

interface ConflictFile {
  file: string;
  oursContent?: string;
  theirsContent?: string;
  baseContent?: string;
}

interface MergeViewProps {
  mergeStatus: GitMergeStatus;
  send: (msg: any) => void;
  projectPath?: string;
  onClose: () => void;
}

type ConflictViewMode = 'list' | 'detail';

/**
 * MergeView 冲突解决组件
 */
export function MergeView({ mergeStatus, send, projectPath, onClose }: MergeViewProps) {
  const { t } = useLanguage();
  const [mode, setMode] = useState<ConflictViewMode>('list');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [conflictDetails, setConflictDetails] = useState<ConflictFile | null>(null);
  const [loading, setLoading] = useState(false);

  if (!mergeStatus.inProgress) {
    return (
      <div className="git-merge-view">
        <div className="git-merge-view-empty">
          ✓ {t('git.noMergeInProgress')}
        </div>
      </div>
    );
  }

  const { type, conflicts, currentBranch, targetBranch } = mergeStatus;

  // 处理获取冲突文件详情
  const handleViewConflict = (file: string) => {
    if (!projectPath) return;
    setSelectedFile(file);
    setMode('detail');
    setLoading(true);

    send({
      type: 'git:get_conflict_details',
      payload: { projectPath, file },
    });
  };

  // 处理接受我们的版本
  const handleAcceptOurs = (file: string) => {
    if (!projectPath) return;
    const confirmed = window.confirm(t('git.confirmResolveConflict', { file }));
    if (!confirmed) return;

    send({
      type: 'git:resolve_conflict',
      payload: { projectPath, file, resolution: 'ours' },
    });
  };

  // 处理接受他们的版本
  const handleAcceptTheirs = (file: string) => {
    if (!projectPath) return;
    const confirmed = window.confirm(t('git.confirmResolveConflict', { file }));
    if (!confirmed) return;

    send({
      type: 'git:resolve_conflict',
      payload: { projectPath, file, resolution: 'theirs' },
    });
  };

  // 处理标记为已解决
  const handleMarkResolved = (file: string) => {
    if (!projectPath) return;
    send({
      type: 'git:mark_resolved',
      payload: { projectPath, file },
    });
  };

  // 处理中止合并/变基
  const handleAbort = () => {
    const confirmed = window.confirm(
      t('git.confirmAbort', {
        operation: type === 'merge' ? t('git.merge') : type === 'rebase' ? t('git.rebase') : t('git.cherryPick'),
      })
    );
    if (!confirmed) return;

    if (type === 'merge') {
      send({
        type: 'git:merge_abort',
        payload: { projectPath },
      });
    } else if (type === 'rebase') {
      send({
        type: 'git:rebase_abort',
        payload: { projectPath },
      });
    } else if (type === 'cherry-pick') {
      send({
        type: 'git:cherry_pick_abort',
        payload: { projectPath },
      });
    }
    onClose();
  };

  // 处理继续合并/变基
  const handleContinue = () => {
    if (!projectPath) return;

    if (type === 'merge') {
      send({
        type: 'git:merge_continue',
        payload: { projectPath },
      });
    } else if (type === 'rebase') {
      send({
        type: 'git:rebase_continue',
        payload: { projectPath },
      });
    } else if (type === 'cherry-pick') {
      send({
        type: 'git:cherry_pick_continue',
        payload: { projectPath },
      });
    }
  };

  // 列表模式：显示冲突文件列表
  if (mode === 'list') {
    return (
      <div className="git-merge-view">
        <div className="git-merge-view-header">
          <h3>{t('git.resolveConflicts')}</h3>
          <button className="git-merge-view-close" onClick={onClose}>✕</button>
        </div>

        <div className="git-merge-view-body">
          {/* 合并状态信息 */}
          <div className="git-merge-status-info">
            <div className="git-merge-status-line">
              <span className="git-merge-status-label">
                {type === 'merge'
                  ? t('git.merging')
                  : type === 'rebase'
                  ? t('git.rebasing')
                  : t('git.cherryPicking')}
              </span>
            </div>
            {targetBranch && (
              <div className="git-merge-status-line">
                <span className="git-merge-branch-info">
                  {currentBranch} ← {targetBranch}
                </span>
              </div>
            )}
          </div>

          {/* 冲突文件列表 */}
          <div className="git-conflict-list">
            <div className="git-conflict-list-header">
              {t('git.conflictFiles')} ({conflicts.length})
            </div>

            {conflicts.length === 0 ? (
              <div className="git-conflict-list-empty">
                ✓ {t('git.noConflicts')}
              </div>
            ) : (
              conflicts.map((file) => (
                <div key={file} className="git-conflict-item">
                  <div className="git-conflict-item-name">
                    <span className="git-conflict-status-badge">⚠️</span>
                    {file}
                  </div>
                  <div className="git-conflict-item-actions">
                    <button
                      className="git-conflict-action-btn git-conflict-action-btn--view"
                      onClick={() => handleViewConflict(file)}
                      title={t('git.viewConflict')}
                    >
                      {t('git.view')}
                    </button>
                    <button
                      className="git-conflict-action-btn git-conflict-action-btn--ours"
                      onClick={() => handleAcceptOurs(file)}
                      title={t('git.acceptOurs')}
                    >
                      {t('git.acceptOurs')}
                    </button>
                    <button
                      className="git-conflict-action-btn git-conflict-action-btn--theirs"
                      onClick={() => handleAcceptTheirs(file)}
                      title={t('git.acceptTheirs')}
                    >
                      {t('git.acceptTheirs')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 页脚：中止/继续按钮 */}
        <div className="git-merge-view-footer">
          <button
            className="git-merge-action-btn git-merge-action-btn--abort"
            onClick={handleAbort}
            title={t('git.abort')}
          >
            {t('git.abort')}
          </button>
          <button
            className="git-merge-action-btn git-merge-action-btn--continue"
            onClick={handleContinue}
            disabled={conflicts.length > 0}
            title={conflicts.length > 0 ? t('git.resolveAllConflicts') : t('git.continue')}
          >
            {t('git.continue')}
          </button>
        </div>
      </div>
    );
  }

  // 详情模式：显示单个冲突文件的内容
  return (
    <div className="git-merge-view">
      <div className="git-merge-view-header">
        <div className="git-merge-view-header-title">
          <button className="git-merge-view-back" onClick={() => setMode('list')}>
            ← {t('git.back')}
          </button>
          <span>{selectedFile}</span>
        </div>
        <button className="git-merge-view-close" onClick={onClose}>✕</button>
      </div>

      <div className="git-merge-view-body git-merge-view-body--detail">
        {loading ? (
          <div className="git-merge-detail-loading">
            {t('common.loading')}
          </div>
        ) : conflictDetails ? (
          <div className="git-merge-detail-content">
            {/* Ours 内容 */}
            <div className="git-merge-section">
              <div className="git-merge-section-header">
                {t('git.ours')} (Current Branch: {currentBranch})
              </div>
              <pre className="git-merge-section-content">
                {conflictDetails.oursContent || ''}
              </pre>
            </div>

            {/* Base 内容（如果有） */}
            {conflictDetails.baseContent && (
              <div className="git-merge-section">
                <div className="git-merge-section-header">
                  {t('git.base')}
                </div>
                <pre className="git-merge-section-content">
                  {conflictDetails.baseContent}
                </pre>
              </div>
            )}

            {/* Theirs 内容 */}
            <div className="git-merge-section">
              <div className="git-merge-section-header">
                {t('git.theirs')} (Incoming: {targetBranch || 'N/A'})
              </div>
              <pre className="git-merge-section-content">
                {conflictDetails.theirsContent || ''}
              </pre>
            </div>
          </div>
        ) : (
          <div className="git-merge-detail-empty">
            {t('git.failedLoadConflictDetails')}
          </div>
        )}
      </div>

      {/* 页脚：解决冲突的操作 */}
      {selectedFile && (
        <div className="git-merge-view-footer">
          <button
            className="git-merge-action-btn git-merge-action-btn--ours"
            onClick={() => {
              handleAcceptOurs(selectedFile);
              setMode('list');
            }}
            title={t('git.acceptOurs')}
          >
            {t('git.acceptOurs')}
          </button>
          <button
            className="git-merge-action-btn git-merge-action-btn--theirs"
            onClick={() => {
              handleAcceptTheirs(selectedFile);
              setMode('list');
            }}
            title={t('git.acceptTheirs')}
          >
            {t('git.acceptTheirs')}
          </button>
          <button
            className="git-merge-action-btn git-merge-action-btn--mark-resolved"
            onClick={() => {
              handleMarkResolved(selectedFile);
              setMode('list');
            }}
            title={t('git.markResolved')}
          >
            {t('git.markResolved')}
          </button>
        </div>
      )}
    </div>
  );
}
