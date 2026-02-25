/**
 * BranchesView - Git 分支管理视图
 * 显示本地和远程分支，支持分支切换、创建、删除操作
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { GitBranch } from './index';

interface BranchesViewProps {
  branches: GitBranch[];
  send: (msg: any) => void;
  projectPath?: string;
}

type MergeStrategy = 'default' | 'no-ff' | 'squash' | 'ff-only';

interface MergeDialogState {
  visible: boolean;
  targetBranch: string;
  strategy: MergeStrategy;
}

export function BranchesView({ branches, send, projectPath }: BranchesViewProps) {
  const { t } = useLanguage();
  
  // Merge 对话框状态
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState>({
    visible: false,
    targetBranch: '',
    strategy: 'default',
  });

  // 分离本地分支和远程分支
  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);

  // 新建分支
  const handleNewBranch = () => {
    const name = window.prompt(t('git.branchName'));
    if (name && name.trim() && projectPath) {
      send({
        type: 'git:create_branch',
        payload: { projectPath, name: name.trim() },
      });
    }
  };

  // 切换分支
  const handleCheckout = (branch: string) => {
    if (!projectPath) return;
    send({
      type: 'git:checkout',
      payload: { projectPath, branch },
    });
  };

  // 删除分支
  const handleDeleteBranch = (name: string) => {
    if (!projectPath) return;
    if (window.confirm(t('git.confirmDelete'))) {
      send({
        type: 'git:delete_branch',
        payload: { projectPath, name },
      });
    }
  };

  // Merge 分支
  const handleMerge = (branchName: string) => {
    setMergeDialog({
      visible: true,
      targetBranch: branchName,
      strategy: 'default',
    });
  };

  // 确认 Merge
  const handleConfirmMerge = () => {
    if (!projectPath || !mergeDialog.targetBranch) return;
    
    send({
      type: 'git:merge',
      payload: {
        projectPath,
        branch: mergeDialog.targetBranch,
        strategy: mergeDialog.strategy,
      },
    });

    // 关闭对话框
    setMergeDialog({ visible: false, targetBranch: '', strategy: 'default' });
  };

  // 取消 Merge
  const handleCancelMerge = () => {
    setMergeDialog({ visible: false, targetBranch: '', strategy: 'default' });
  };

  // Rebase 分支
  const handleRebase = (branchName: string) => {
    if (!projectPath) return;
    if (window.confirm(t('git.confirmRebase', { branch: branchName }))) {
      send({
        type: 'git:rebase',
        payload: { projectPath, branch: branchName },
      });
    }
  };

  // Compare 分支
  const handleCompare = (branchName: string) => {
    if (!projectPath) return;
    
    // 获取当前分支
    const currentBranch = localBranches.find((b) => b.current);
    if (!currentBranch) return;

    send({
      type: 'git:compare_branches',
      payload: {
        projectPath,
        baseBranch: currentBranch.name,
        compareBranch: branchName,
      },
    });
  };

  // 无分支提示
  if (branches.length === 0) {
    return (
      <div className="git-branches-view">
        <div className="git-empty-state">
          {t('git.noBranches')}
        </div>
      </div>
    );
  }

  return (
    <div className="git-branches-view">
      {/* Merge 对话框 */}
      {mergeDialog.visible && (
        <div className="git-dialog-overlay" onClick={handleCancelMerge}>
          <div className="git-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="git-dialog-header">
              <h3>{t('git.merge')}: {mergeDialog.targetBranch}</h3>
            </div>
            <div className="git-dialog-body">
              <div className="git-dialog-section">
                <label>{t('git.mergeStrategy')}</label>
                <div className="git-merge-strategies">
                  <label className="git-merge-strategy-option">
                    <input
                      type="radio"
                      name="mergeStrategy"
                      value="default"
                      checked={mergeDialog.strategy === 'default'}
                      onChange={(e) =>
                        setMergeDialog({ ...mergeDialog, strategy: e.target.value as MergeStrategy })
                      }
                    />
                    <div>
                      <strong>Default</strong>
                      <p>{t('git.strategyDefault')}</p>
                    </div>
                  </label>
                  <label className="git-merge-strategy-option">
                    <input
                      type="radio"
                      name="mergeStrategy"
                      value="no-ff"
                      checked={mergeDialog.strategy === 'no-ff'}
                      onChange={(e) =>
                        setMergeDialog({ ...mergeDialog, strategy: e.target.value as MergeStrategy })
                      }
                    />
                    <div>
                      <strong>No Fast-Forward</strong>
                      <p>{t('git.strategyNoFF')}</p>
                    </div>
                  </label>
                  <label className="git-merge-strategy-option">
                    <input
                      type="radio"
                      name="mergeStrategy"
                      value="squash"
                      checked={mergeDialog.strategy === 'squash'}
                      onChange={(e) =>
                        setMergeDialog({ ...mergeDialog, strategy: e.target.value as MergeStrategy })
                      }
                    />
                    <div>
                      <strong>Squash</strong>
                      <p>{t('git.strategySquash')}</p>
                    </div>
                  </label>
                  <label className="git-merge-strategy-option">
                    <input
                      type="radio"
                      name="mergeStrategy"
                      value="ff-only"
                      checked={mergeDialog.strategy === 'ff-only'}
                      onChange={(e) =>
                        setMergeDialog({ ...mergeDialog, strategy: e.target.value as MergeStrategy })
                      }
                    />
                    <div>
                      <strong>Fast-Forward Only</strong>
                      <p>{t('git.strategyFFOnly')}</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
            <div className="git-dialog-footer">
              <button className="git-dialog-cancel" onClick={handleCancelMerge}>
                {t('git.cancel')}
              </button>
              <button className="git-dialog-confirm" onClick={handleConfirmMerge}>
                {t('git.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部操作栏 */}
      <div className="git-branches-header">
        <button className="git-new-branch-button" onClick={handleNewBranch}>
          + {t('git.newBranch')}
        </button>
      </div>

      {/* 本地分支组 */}
      {localBranches.length > 0 && (
        <div className="git-branch-group">
          <div className="git-branch-group-title">{t('git.localBranches')}</div>
          {localBranches.map((branch) => (
            <div
              key={branch.name}
              className={`git-branch-item ${branch.current ? 'git-branch-item--current' : ''}`}
            >
              <span className="git-branch-name">{branch.name}</span>
              <div className="git-branch-actions">
                {!branch.current && (
                  <>
                    <button
                      onClick={() => handleCheckout(branch.name)}
                      title={t('git.switch')}
                    >
                      {t('git.switch')}
                    </button>
                    <button
                      onClick={() => handleMerge(branch.name)}
                      title={t('git.merge')}
                    >
                      {t('git.merge')}
                    </button>
                    <button
                      onClick={() => handleRebase(branch.name)}
                      title={t('git.rebase')}
                    >
                      {t('git.rebase')}
                    </button>
                    <button
                      onClick={() => handleCompare(branch.name)}
                      title={t('git.compare')}
                    >
                      {t('git.compare')}
                    </button>
                    <button
                      onClick={() => handleDeleteBranch(branch.name)}
                      title={t('git.delete')}
                    >
                      {t('git.delete')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 远程分支组 */}
      {remoteBranches.length > 0 && (
        <div className="git-branch-group">
          <div className="git-branch-group-title">{t('git.remoteBranches')}</div>
          {remoteBranches.map((branch) => (
            <div key={branch.name} className="git-branch-item">
              <span className="git-branch-name">{branch.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
