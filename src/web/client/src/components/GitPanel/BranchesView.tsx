/**
 * BranchesView - Git 分支管理视图（树形结构）
 * 显示本地和远程分支，支持分支切换、创建、删除操作
 * 新增：树形结构、分支筛选回调
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { GitBranch } from './index';

interface BranchesViewProps {
  branches: GitBranch[];
  send: (msg: any) => void;
  projectPath?: string;
  onBranchSelect?: (branch: string | null) => void; // 新增：筛选分支回调
}

type MergeStrategy = 'default' | 'no-ff' | 'squash' | 'ff-only';

interface MergeDialogState {
  visible: boolean;
  targetBranch: string;
  strategy: MergeStrategy;
}

// 树节点类型
interface TreeNode {
  name: string;           // 节点名称（目录名或分支名）
  fullPath: string;       // 完整路径
  isLeaf: boolean;        // 是否叶子节点（分支）
  isCurrent: boolean;     // 是否当前分支
  children: TreeNode[];   // 子节点
}

/**
 * 构建树形结构
 */
function buildTree(branches: GitBranch[]): TreeNode[] {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  branches.forEach((branch) => {
    const parts = branch.name.split('/');
    let currentLevel = root;
    let currentPath = '';

    parts.forEach((part, idx) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = idx === parts.length - 1;

      // 查找当前层级是否已有该节点
      let node = currentLevel.find(n => n.name === part);

      if (!node) {
        node = {
          name: part,
          fullPath: currentPath,
          isLeaf: isLast,
          isCurrent: isLast && branch.current,
          children: [],
        };
        currentLevel.push(node);
        nodeMap.set(currentPath, node);
      }

      if (!isLast) {
        currentLevel = node.children;
      }
    });
  });

  return root;
}

export function BranchesView({ branches, send, projectPath, onBranchSelect }: BranchesViewProps) {
  const { t } = useLanguage();
  
  // Merge 对话框状态
  const [mergeDialog, setMergeDialog] = useState<MergeDialogState>({
    visible: false,
    targetBranch: '',
    strategy: 'default',
  });

  // 展开/折叠状态
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['HEAD', 'local', 'remote']));

  // 选中的分支（用于筛选）
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // 分离本地分支和远程分支
  const localBranches = branches.filter((b) => !b.remote);
  const remoteBranches = branches.filter((b) => b.remote);

  // 当前分支
  const currentBranch = localBranches.find((b) => b.current);

  // 构建树形结构
  const localTree = buildTree(localBranches);
  const remoteTree = buildTree(remoteBranches);

  // 切换展开/折叠
  const toggleNode = (path: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);
  };

  // 选择分支（筛选）
  const handleBranchClick = (branch: string | null) => {
    setSelectedBranch(branch);
    onBranchSelect?.(branch);
  };

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

  /**
   * 渲染树节点
   */
  const renderTreeNode = (node: TreeNode, isRemote: boolean = false): JSX.Element => {
    const isExpanded = expandedNodes.has(node.fullPath);
    const isSelected = selectedBranch === node.fullPath;

    if (node.isLeaf) {
      // 叶子节点（分支）
      return (
        <div
          key={node.fullPath}
          className={`git-branch-tree-leaf ${node.isCurrent ? 'git-branch-tree-current' : ''} ${isSelected ? 'git-branch-tree-selected' : ''}`}
          onClick={() => handleBranchClick(node.fullPath)}
        >
          <span className="git-branch-tree-icon">
            {node.isCurrent ? '●' : '○'}
          </span>
          <span className="git-branch-tree-name">
            {node.name}
            {node.isCurrent && <span className="git-branch-tree-badge">★</span>}
          </span>
          {!isRemote && (
            <div className="git-branch-tree-actions">
              {!node.isCurrent && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); handleCheckout(node.fullPath); }} title={t('git.switch')}>
                    ✓
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleMerge(node.fullPath); }} title={t('git.merge')}>
                    ⤴
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleRebase(node.fullPath); }} title={t('git.rebase')}>
                    ⤵
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleCompare(node.fullPath); }} title={t('git.compare')}>
                    ↔
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteBranch(node.fullPath); }} title={t('git.delete')}>
                    ✕
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      );
    } else {
      // 目录节点
      return (
        <div key={node.fullPath} className="git-branch-tree-directory">
          <div
            className="git-branch-tree-node"
            onClick={() => toggleNode(node.fullPath)}
          >
            <span className="git-branch-tree-toggle">
              {isExpanded ? '▼' : '▸'}
            </span>
            <span className="git-branch-tree-name">{node.name}/</span>
          </div>
          {isExpanded && (
            <div className="git-branch-tree-children">
              {node.children.map(child => renderTreeNode(child, isRemote))}
            </div>
          )}
        </div>
      );
    }
  };

  // 无分支提示
  if (branches.length === 0) {
    return (
      <div className="git-branch-tree">
        <div className="git-empty-state">
          {t('git.noBranches')}
        </div>
      </div>
    );
  }

  return (
    <div className="git-branch-tree">
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
      <div className="git-branch-tree-header">
        <button className="git-new-branch-button" onClick={handleNewBranch}>
          + {t('git.newBranch')}
        </button>
        {selectedBranch && (
          <button
            className="git-clear-filter-button"
            onClick={() => handleBranchClick(null)}
            title="Clear filter"
          >
            Clear
          </button>
        )}
      </div>

      {/* HEAD 显示 */}
      {currentBranch && (
        <div className="git-branch-tree-section">
          <div className="git-branch-tree-section-title">HEAD</div>
          <div className="git-branch-tree-leaf git-branch-tree-current">
            <span className="git-branch-tree-icon">●</span>
            <span className="git-branch-tree-name">
              {currentBranch.name} ★
            </span>
          </div>
        </div>
      )}

      {/* 本地分支树 */}
      {localBranches.length > 0 && (
        <div className="git-branch-tree-section">
          <div
            className="git-branch-tree-section-title"
            onClick={() => toggleNode('local')}
          >
            <span className="git-branch-tree-toggle">
              {expandedNodes.has('local') ? '▼' : '▸'}
            </span>
            {t('git.localBranches')}
          </div>
          {expandedNodes.has('local') && (
            <div className="git-branch-tree-section-content">
              {localTree.map(node => renderTreeNode(node, false))}
            </div>
          )}
        </div>
      )}

      {/* 远程分支树 */}
      {remoteBranches.length > 0 && (
        <div className="git-branch-tree-section">
          <div
            className="git-branch-tree-section-title"
            onClick={() => toggleNode('remote')}
          >
            <span className="git-branch-tree-toggle">
              {expandedNodes.has('remote') ? '▼' : '▸'}
            </span>
            {t('git.remoteBranches')}
          </div>
          {expandedNodes.has('remote') && (
            <div className="git-branch-tree-section-content">
              {remoteTree.map(node => renderTreeNode(node, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
