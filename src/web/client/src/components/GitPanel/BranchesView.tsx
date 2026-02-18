/**
 * BranchesView - Git 分支管理视图
 * 显示本地和远程分支，支持分支切换、创建、删除操作
 */

import { useLanguage } from '../../i18n';
import { GitBranch } from './index';

interface BranchesViewProps {
  branches: GitBranch[];
  send: (msg: any) => void;
  projectPath?: string;
}

export function BranchesView({ branches, send, projectPath }: BranchesViewProps) {
  const { t } = useLanguage();

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
