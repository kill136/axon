/**
 * StatusView - Git Status 标签页视图组件
 * 显示文件变更状态并提供 stage/unstage 操作
 * 支持树形视图和列表视图、多选批量操作
 */

import { useState, useCallback, useMemo } from 'react';
import { useLanguage } from '../../i18n';
import { ContextMenu, type ContextMenuItem, type ContextMenuEntry } from './ContextMenu';
import type { GitStatus } from './index';

interface StatusViewProps {
  gitStatus: GitStatus | null;
  send: (msg: any) => void;
  projectPath?: string;
}

// 文件条目（统一 staged/unstaged/untracked/conflict）
interface FileEntry {
  file: string;       // 原始文件字符串（如 "M src/foo.ts"）
  cleanFile: string;  // 清理后的文件名
  badge: string;      // 状态标记 M/A/D/R/U/C
  source: 'staged' | 'unstaged' | 'untracked' | 'conflict';
}

// 树节点
interface TreeNode {
  name: string;           // 节点名（目录名或文件名）
  path: string;           // 完整路径
  isDir: boolean;
  children: TreeNode[];
  entry?: FileEntry;      // 叶子节点才有
}

type ViewMode = 'list' | 'tree';

export function StatusView({ gitStatus, send, projectPath }: StatusViewProps) {
  const { t } = useLanguage();

  // 视图模式
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // 多选状态
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  // 展开的目录
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['__all__']));

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

  // 获取文件状态标记
  const getFileStatusBadge = (file: string, type: 'staged' | 'unstaged' | 'untracked' | 'conflict') => {
    if (type === 'conflict') return 'C';
    if (type === 'untracked') return 'U';
    const status = file[0];
    if (status === 'D') return 'D';
    if (status === 'A') return 'A';
    if (status === 'R') return 'R';
    return 'M';
  };

  // 清理文件名
  const cleanFileName = (file: string, type: 'staged' | 'unstaged' | 'untracked' | 'conflict') => {
    if (type === 'staged' || type === 'unstaged') {
      return file.substring(2);
    }
    return file;
  };

  // 构建所有文件条目
  const allEntries: FileEntry[] = useMemo(() => {
    const entries: FileEntry[] = [];
    for (const f of conflicts) {
      entries.push({ file: f, cleanFile: cleanFileName(f, 'conflict'), badge: 'C', source: 'conflict' });
    }
    for (const f of staged) {
      entries.push({ file: f, cleanFile: cleanFileName(f, 'staged'), badge: getFileStatusBadge(f, 'staged'), source: 'staged' });
    }
    for (const f of unstaged) {
      entries.push({ file: f, cleanFile: cleanFileName(f, 'unstaged'), badge: getFileStatusBadge(f, 'unstaged'), source: 'unstaged' });
    }
    for (const f of untracked) {
      entries.push({ file: f, cleanFile: f, badge: 'U', source: 'untracked' });
    }
    return entries;
  }, [staged, unstaged, untracked, conflicts]);

  // 按分组的文件条目
  const groupedEntries = useMemo(() => ({
    conflict: allEntries.filter(e => e.source === 'conflict'),
    staged: allEntries.filter(e => e.source === 'staged'),
    changes: allEntries.filter(e => e.source === 'unstaged' || e.source === 'untracked'),
  }), [allEntries]);

  // 构建树形结构
  const buildTree = (entries: FileEntry[]): TreeNode[] => {
    const root: TreeNode[] = [];
    const dirMap = new Map<string, TreeNode>();

    for (const entry of entries) {
      const parts = entry.cleanFile.split('/');
      let currentChildren = root;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        if (isLast) {
          // 叶子节点（文件）
          currentChildren.push({
            name: part,
            path: currentPath,
            isDir: false,
            children: [],
            entry,
          });
        } else {
          // 目录节点
          const key = `${entry.source}:${currentPath}`;
          let dirNode = dirMap.get(key);
          if (!dirNode) {
            dirNode = {
              name: part,
              path: currentPath,
              isDir: true,
              children: [],
            };
            dirMap.set(key, dirNode);
            currentChildren.push(dirNode);
          }
          currentChildren = dirNode.children;
        }
      }
    }

    // 排序：目录在前，文件在后，各自按名称排序
    const sortTree = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      for (const node of nodes) {
        if (node.isDir) sortTree(node.children);
      }
    };
    sortTree(root);
    return root;
  };

  const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0 || conflicts.length > 0;

  // 获取平铺的文件列表（用于 Shift 多选）
  const flatFileList = useMemo(() => allEntries.map(e => e.cleanFile), [allEntries]);

  // ---- 操作处理函数 ----

  const handleStage = (file: string) => {
    if (!projectPath) return;
    send({ type: 'git:stage', payload: { projectPath, files: [file] } });
  };

  const handleUnstage = (file: string) => {
    if (!projectPath) return;
    send({ type: 'git:unstage', payload: { projectPath, files: [file] } });
  };

  const handleFileDiff = (file: string) => {
    if (!projectPath) return;
    send({ type: 'git:get_diff', payload: { projectPath, file } });
  };

  const handleStageAll = () => {
    if (!projectPath) return;
    const count = groupedEntries.changes.length;
    if (count === 0) return;
    const confirmed = window.confirm(t('git.confirmStageAll', { count }));
    if (!confirmed) return;
    send({ type: 'git:stage_all', payload: { projectPath } });
  };

  const handleUnstageAll = () => {
    if (!projectPath) return;
    const count = staged.length;
    if (count === 0) return;
    const confirmed = window.confirm(t('git.confirmUnstageAll', { count }));
    if (!confirmed) return;
    send({ type: 'git:unstage_all', payload: { projectPath } });
  };

  const handleDiscardAll = () => {
    if (!projectPath) return;
    const count = groupedEntries.changes.length;
    if (count === 0) return;
    const confirmed = window.confirm(t('git.confirmDiscard'));
    if (!confirmed) return;
    send({ type: 'git:discard_all', payload: { projectPath } });
  };

  const handleDiscardFile = (file: string) => {
    if (!projectPath) return;
    const confirmed = window.confirm(t('git.confirmDiscardFile', { file }));
    if (!confirmed) return;
    send({ type: 'git:discard_file', payload: { projectPath, file } });
  };

  // ---- 多选处理 ----

  const handleFileClick = (e: React.MouseEvent, cleanFile: string) => {
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + 点击：切换单个选中
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(cleanFile)) {
          next.delete(cleanFile);
        } else {
          next.add(cleanFile);
        }
        return next;
      });
    } else if (e.shiftKey && selectedFiles.size > 0) {
      // Shift + 点击：范围选中
      const lastSelected = Array.from(selectedFiles).pop()!;
      const startIdx = flatFileList.indexOf(lastSelected);
      const endIdx = flatFileList.indexOf(cleanFile);
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const next = new Set(selectedFiles);
        for (let i = from; i <= to; i++) {
          next.add(flatFileList[i]);
        }
        setSelectedFiles(next);
      }
    } else {
      // 普通点击：查看 diff
      handleFileDiff(cleanFile);
    }
  };

  // 批量操作选中文件
  const handleBatchStage = () => {
    if (!projectPath || selectedFiles.size === 0) return;
    for (const file of selectedFiles) {
      send({ type: 'git:stage', payload: { projectPath, files: [file] } });
    }
    setSelectedFiles(new Set());
  };

  const handleBatchUnstage = () => {
    if (!projectPath || selectedFiles.size === 0) return;
    for (const file of selectedFiles) {
      send({ type: 'git:unstage', payload: { projectPath, files: [file] } });
    }
    setSelectedFiles(new Set());
  };

  const handleBatchDiscard = () => {
    if (!projectPath || selectedFiles.size === 0) return;
    const confirmed = window.confirm(t('git.confirmDiscard'));
    if (!confirmed) return;
    for (const file of selectedFiles) {
      send({ type: 'git:discard_file', payload: { projectPath, file } });
    }
    setSelectedFiles(new Set());
  };

  // ---- 目录展开/折叠 ----
  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // 初始展开所有目录
  const expandAll = () => {
    const allDirs = new Set<string>(['__all__']);
    for (const entry of allEntries) {
      const parts = entry.cleanFile.split('/');
      let path = '';
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        allDirs.add(`conflict:${path}`);
        allDirs.add(`staged:${path}`);
        allDirs.add(`changes:${path}`);
      }
    }
    setExpandedDirs(allDirs);
  };

  // ---- 右键菜单 ----

  const handleContextMenu = (
    e: React.MouseEvent,
    file: string,
    source: 'staged' | 'unstaged' | 'untracked' | 'conflict'
  ) => {
    e.preventDefault();
    setContextMenu({ show: true, x: e.clientX, y: e.clientY, file, source });
  };

  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const { file, source } = contextMenu;
    const items: ContextMenuItem[] = [];

    if (source === 'unstaged' || source === 'untracked') {
      items.push({ label: t('git.stage'), icon: '+', onClick: () => handleStage(file) });
    } else if (source === 'staged') {
      items.push({ label: t('git.unstage'), icon: '-', onClick: () => handleUnstage(file) });
    }

    if (source === 'staged' || source === 'unstaged') {
      items.push({ label: t('git.viewDiff'), icon: '🔍', onClick: () => handleFileDiff(file) });
    }

    if (source === 'unstaged' || source === 'untracked') {
      items.push({ label: t('git.discard'), icon: '🗑️', onClick: () => handleDiscardFile(file), danger: true });
    }

    items.push({
      label: t('git.fileHistory'),
      icon: '📜',
      onClick: () => {
        if (!projectPath) return;
        send({ type: 'git:get_file_history', payload: { projectPath, file } });
      },
    });

    items.push({
      label: t('git.blame'),
      icon: '👤',
      onClick: () => {
        if (!projectPath) return;
        send({ type: 'git:get_blame', payload: { projectPath, file } });
      },
    });

    return items;
  };

  // ---- 渲染文件项（列表模式和树模式共用） ----

  const renderFileItem = (entry: FileEntry) => {
    const isSelected = selectedFiles.has(entry.cleanFile);
    const itemClass = `git-file-item git-file-item--${entry.source === 'untracked' ? 'modified' : entry.source}${isSelected ? ' git-file-item--selected' : ''}`;

    return (
      <div
        key={`${entry.source}-${entry.cleanFile}`}
        className={itemClass}
        onContextMenu={(e) => handleContextMenu(e, entry.cleanFile, entry.source)}
        onClick={(e) => handleFileClick(e, entry.cleanFile)}
      >
        {/* 多选复选框 */}
        <input
          type="checkbox"
          className="git-file-checkbox"
          checked={isSelected}
          onChange={(e) => {
            e.stopPropagation();
            setSelectedFiles(prev => {
              const next = new Set(prev);
              if (next.has(entry.cleanFile)) {
                next.delete(entry.cleanFile);
              } else {
                next.add(entry.cleanFile);
              }
              return next;
            });
          }}
          onClick={(e) => e.stopPropagation()}
        />
        <span className={`git-file-status-badge git-file-status-badge--${entry.badge}`}>{entry.badge}</span>
        <span className="git-file-name" title={entry.cleanFile}>
          {viewMode === 'tree' ? entry.cleanFile.split('/').pop() : entry.cleanFile}
        </span>
        <div className="git-file-actions">
          {entry.source === 'staged' && (
            <button
              className="git-action-button git-action-button--unstage"
              onClick={(e) => { e.stopPropagation(); handleUnstage(entry.cleanFile); }}
              title={t('git.unstage')}
            >
              -
            </button>
          )}
          {(entry.source === 'unstaged' || entry.source === 'untracked') && (
            <button
              className="git-action-button git-action-button--stage"
              onClick={(e) => { e.stopPropagation(); handleStage(entry.cleanFile); }}
              title={t('git.stage')}
            >
              +
            </button>
          )}
        </div>
      </div>
    );
  };

  // ---- 渲染树节点 ----

  const renderTreeNode = (node: TreeNode, groupKey: string, depth: number = 0) => {
    if (!node.isDir) {
      // 文件叶子节点
      return renderFileItem(node.entry!);
    }

    // 目录节点
    const dirKey = `${groupKey}:${node.path}`;
    const isExpanded = expandedDirs.has(dirKey);
    const fileCount = countFiles(node);

    return (
      <div key={dirKey} className="git-tree-dir">
        <div
          className="git-tree-dir-header"
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => toggleDir(dirKey)}
        >
          <span className="git-tree-dir-arrow">{isExpanded ? '▾' : '▸'}</span>
          <span className="git-tree-dir-icon">📁</span>
          <span className="git-tree-dir-name">{node.name}</span>
          <span className="git-tree-dir-count">{fileCount}</span>
        </div>
        {isExpanded && (
          <div className="git-tree-dir-children">
            {node.children.map(child => renderTreeNode(child, groupKey, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const countFiles = (node: TreeNode): number => {
    if (!node.isDir) return 1;
    return node.children.reduce((sum, child) => sum + countFiles(child), 0);
  };

  // ---- 渲染文件组 ----

  const renderFileGroup = (
    title: string,
    titleClass: string,
    entries: FileEntry[],
    groupKey: string,
  ) => {
    if (entries.length === 0) return null;

    const tree = viewMode === 'tree' ? buildTree(entries) : null;

    return (
      <div className="git-file-group">
        <div className={`git-file-group-title ${titleClass}`}>
          {title} ({entries.length})
        </div>
        {viewMode === 'list'
          ? entries.map(entry => renderFileItem(entry))
          : tree!.map(node => renderTreeNode(node, groupKey, 0))
        }
      </div>
    );
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

      {/* 工具栏：视图切换 + 批量操作 */}
      <div className="git-status-toolbar">
        <div className="git-status-toolbar-left">
          {/* 视图模式切换 */}
          <div className="git-view-mode-switcher">
            <button
              className={`git-view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title={t('git.listView')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3h12v1.5H2V3zm0 4h12v1.5H2V7zm0 4h12v1.5H2V11z"/>
              </svg>
            </button>
            <button
              className={`git-view-mode-btn ${viewMode === 'tree' ? 'active' : ''}`}
              onClick={() => { setViewMode('tree'); expandAll(); }}
              title={t('git.treeView')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2h4v4H1V2zm0 5h3v1H1V7zm5-5h4v4H6V2zm0 5h3v1H6V7zm5-5h4v4h-4V2zm0 5h3v1h-3V7zM1 9h4v4H1V9zm5 0h4v4H6V9z"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="git-status-toolbar-right">
          {/* 多选操作 */}
          {selectedFiles.size > 0 && (
            <div className="git-batch-actions">
              <span className="git-batch-count">{selectedFiles.size} {t('git.selected')}</span>
              <button className="git-batch-btn git-batch-btn--stage" onClick={handleBatchStage} title={t('git.stage')}>
                + Stage
              </button>
              <button className="git-batch-btn git-batch-btn--unstage" onClick={handleBatchUnstage} title={t('git.unstage')}>
                - Unstage
              </button>
              <button className="git-batch-btn git-batch-btn--discard" onClick={handleBatchDiscard} title={t('git.discard')}>
                🗑️
              </button>
              <button className="git-batch-btn" onClick={() => setSelectedFiles(new Set())} title={t('git.clear')}>
                ✕
              </button>
            </div>
          )}
          {/* 全局操作 */}
          {hasChanges && selectedFiles.size === 0 && (
            <>
              <button
                className="git-action-button git-action-button--stage-all"
                onClick={handleStageAll}
                disabled={groupedEntries.changes.length === 0}
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
                disabled={groupedEntries.changes.length === 0}
                title={t('git.discardAll')}
              >
                {t('git.discardAll')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 如果没有变更 */}
      {!hasChanges && (
        <div className="git-status-empty">
          ✓ {t('git.noChanges')}
        </div>
      )}

      {/* 文件分组 */}
      {renderFileGroup(
        t('git.conflicts'),
        'git-file-group-title--conflict',
        groupedEntries.conflict,
        'conflict',
      )}
      {renderFileGroup(
        t('git.staged'),
        'git-file-group-title--staged',
        groupedEntries.staged,
        'staged',
      )}
      {renderFileGroup(
        t('git.changes'),
        'git-file-group-title--modified',
        groupedEntries.changes,
        'changes',
      )}

      {/* 提示：多选操作说明 */}
      {hasChanges && selectedFiles.size === 0 && (
        <div className="git-status-hint">
          💡 Ctrl+Click {t('git.multiSelectHint')}
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
