/**
 * LogView - GitLens 风格的 Commit 历史视图
 * Graph 和 commit 信息在同一行内无缝集成
 * 虚拟滚动 + 分页加载，支持大仓库
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import { GitCommit } from './index';
import { CommitGraphCell } from './CommitGraph';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { computeGraphLayout, GRAPH_COLORS } from './graph-utils';

interface LogViewProps {
  commits: GitCommit[];
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  projectPath?: string;
  selectedHash: string | null;
  onSelectCommit: (hash: string) => void;
  filterBranch?: string | null;
}

/**
 * 将 ISO 时间格式转换为相对时间字符串
 */
function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * 解析 ref 标签
 */
function parseRef(ref: string): { type: 'branch' | 'tag' | 'remote' | 'head'; name: string } {
  const trimmed = ref.trim();
  
  if (trimmed.startsWith('HEAD ->')) {
    return { type: 'head', name: trimmed.replace('HEAD ->', '').trim() };
  }
  if (trimmed === 'HEAD') {
    return { type: 'head', name: 'HEAD' };
  }
  if (trimmed.startsWith('tag:')) {
    return { type: 'tag', name: trimmed.replace('tag:', '').trim() };
  }
  if (trimmed.includes('/')) {
    return { type: 'remote', name: trimmed };
  }
  return { type: 'branch', name: trimmed };
}

const ROW_HEIGHT = 36;
const OVERSCAN = 10;
const PAGE_SIZE = 200;
const LANE_WIDTH = 16;
const PAD_LEFT = 12;

export function LogView({ commits, send, addMessageHandler, projectPath, selectedHash, onSelectCommit, filterBranch }: LogViewProps) {
  const { t } = useLanguage();
  
  // 搜索/过滤状态
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    commit: GitCommit;
  } | null>(null);

  // 虚拟滚动状态
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // 分页状态
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 计算 graph layout
  const layout = useMemo(() => {
    if (commits.length === 0) return null;
    return computeGraphLayout(commits.map(c => ({ hash: c.hash, parents: c.parents || [] })));
  }, [commits]);

  // graph 宽度
  const graphWidth = layout ? (layout.maxLane + 1) * LANE_WIDTH + PAD_LEFT * 2 : 40;

  // 虚拟滚动计算
  const totalHeight = commits.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(commits.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN);
  const visibleCommits = commits.slice(startIndex, endIndex);
  const offsetY = startIndex * ROW_HEIGHT;

  // 滚动处理
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);

    // 判断是否滚到底部，触发加载更多
    if (hasMore && !loadingMore) {
      const threshold = 200;
      if (target.scrollTop + target.clientHeight >= target.scrollHeight - threshold) {
        loadMore();
      }
    }
  }, [hasMore, loadingMore]);

  // 监测容器高度
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 加载更多 commits
  const loadMore = useCallback(() => {
    if (!projectPath || loadingMore || !hasMore) return;
    setLoadingMore(true);

    const filter: any = {
      projectPath,
      limit: PAGE_SIZE,
      skip: commits.length,
    };
    if (filterBranch) filter.branch = filterBranch;
    else filter.all = true;
    if (query.trim()) filter.query = query.trim();
    if (author.trim()) filter.author = author.trim();
    if (since) filter.since = since;
    if (until) filter.until = until;

    send({
      type: 'git:get_log',
      payload: filter,
    });
  }, [projectPath, loadingMore, hasMore, commits.length, filterBranch, query, author, since, until, send]);

  // 监听 log response 来处理分页
  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.type === 'git:log_response' && msg.payload?.success) {
        const data = msg.payload.data || [];
        if (data.length < PAGE_SIZE) {
          setHasMore(false);
        }
        setLoadingMore(false);
      }
    };
    const unsubscribe = addMessageHandler(handler);
    return () => unsubscribe();
  }, [addMessageHandler]);

  // 搜索 commits
  const handleSearch = () => {
    if (!projectPath) return;
    setHasMore(true);
    const filter: any = { projectPath, limit: PAGE_SIZE };
    if (query.trim()) filter.query = query.trim();
    if (author.trim()) filter.author = author.trim();
    if (since) filter.since = since;
    if (until) filter.until = until;
    
    send({
      type: 'git:search_commits',
      payload: filter,
    });
  };

  // 清空搜索过滤条件
  const handleClear = () => {
    setQuery('');
    setAuthor('');
    setSince('');
    setUntil('');
    setHasMore(true);
    if (projectPath) {
      send({
        type: 'git:get_log',
        payload: { projectPath, limit: PAGE_SIZE },
      });
    }
  };

  // 当 filterBranch 改变时，请求筛选的 log
  useEffect(() => {
    if (!projectPath) return;
    setHasMore(true);
    
    if (filterBranch) {
      send({
        type: 'git:get_log',
        payload: { projectPath, limit: PAGE_SIZE, branch: filterBranch },
      });
    } else {
      send({
        type: 'git:get_log',
        payload: { projectPath, limit: PAGE_SIZE, all: true },
      });
    }
  }, [filterBranch, projectPath, send]);

  // 右键菜单处理
  const handleContextMenu = (e: React.MouseEvent, commit: GitCommit) => {
    e.preventDefault();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      commit,
    });
  };

  // 生成 commit 右键菜单项
  const getContextMenuItems = (): ContextMenuEntry[] => {
    if (!contextMenu) return [];

    const { commit } = contextMenu;
    const items: ContextMenuEntry[] = [];

    items.push({
      label: t('git.viewDetail'),
      icon: '🔍',
      onClick: () => onSelectCommit(commit.hash),
    });

    items.push({ separator: true });

    items.push({
      label: 'Cherry-pick',
      icon: '🍒',
      onClick: () => {
        if (!projectPath) return;
        if (window.confirm(`Cherry-pick commit ${commit.shortHash}?\n\n${commit.message}`)) {
          send({
            type: 'git:cherry_pick',
            payload: { projectPath, hash: commit.hash },
          });
        }
      },
    });

    items.push({
      label: 'Revert',
      icon: '↩',
      onClick: () => {
        if (!projectPath) return;
        if (window.confirm(`Revert commit ${commit.shortHash}?\n\n${commit.message}`)) {
          send({
            type: 'git:revert_commit',
            payload: { projectPath, hash: commit.hash },
          });
        }
      },
    });

    items.push({ separator: true });

    items.push({
      label: 'Reset --soft',
      icon: '⟲',
      onClick: () => {
        if (!projectPath) return;
        if (window.confirm(`Reset (soft) to ${commit.shortHash}?\nKeeps all changes staged.`)) {
          send({
            type: 'git:reset',
            payload: { projectPath, commit: commit.hash, mode: 'soft' },
          });
        }
      },
    });

    items.push({
      label: 'Reset --mixed',
      icon: '⟲',
      onClick: () => {
        if (!projectPath) return;
        if (window.confirm(`Reset (mixed) to ${commit.shortHash}?\nKeeps changes but unstaged.`)) {
          send({
            type: 'git:reset',
            payload: { projectPath, commit: commit.hash, mode: 'mixed' },
          });
        }
      },
    });

    items.push({
      label: 'Reset --hard',
      icon: '⟲',
      onClick: () => {
        if (!projectPath) return;
        if (window.confirm(`Reset (hard) to ${commit.shortHash}?\n\nWARNING: This will DISCARD all uncommitted changes!`)) {
          send({
            type: 'git:reset',
            payload: { projectPath, commit: commit.hash, mode: 'hard' },
          });
        }
      },
      danger: true,
    });

    items.push({ separator: true });

    items.push({
      label: t('git.createBranchFrom'),
      icon: '🌿',
      onClick: () => {
        const name = window.prompt(t('git.branchName'));
        if (name && name.trim() && projectPath) {
          send({
            type: 'git:create_branch',
            payload: { projectPath, name: name.trim(), startPoint: commit.hash },
          });
        }
      },
    });

    items.push({
      label: t('git.createTagFrom'),
      icon: '🏷️',
      onClick: () => {
        const name = window.prompt(t('git.tagName'));
        if (name && name.trim() && projectPath) {
          send({
            type: 'git:create_tag',
            payload: { projectPath, name: name.trim(), commit: commit.hash, type: 'lightweight' },
          });
        }
      },
    });

    items.push({ separator: true });

    items.push({
      label: t('git.explainCommit'),
      icon: '🤖',
      onClick: () => {
        if (!projectPath) return;
        send({
          type: 'git:explain_commit',
          payload: { projectPath, hash: commit.hash },
        });
      },
    });

    items.push({ separator: true });

    items.push({
      label: t('git.copyHash'),
      icon: '📋',
      onClick: () => navigator.clipboard.writeText(commit.hash),
    });

    items.push({
      label: t('git.copyShortHash'),
      icon: '📋',
      onClick: () => navigator.clipboard.writeText(commit.shortHash),
    });

    items.push({
      label: t('git.copyMessage'),
      icon: '📝',
      onClick: () => navigator.clipboard.writeText(commit.message),
    });

    return items;
  };

  // 无 commits 提示
  if (commits.length === 0) {
    return (
      <div className="git-log-view">
        <div className="git-empty-state">
          {t('git.noCommits')}
        </div>
      </div>
    );
  }

  return (
    <div className="git-log-view">
      {/* 搜索栏 */}
      <div className="git-graph-toolbar">
        <div className="git-graph-search-row">
          <input
            type="text"
            className="git-graph-search-input"
            placeholder={t('git.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            className="git-graph-toolbar-btn"
            onClick={() => setShowFilters(!showFilters)}
            title="Filters"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2h14L9 8.5V13l-2 1V8.5L1 2z"/>
            </svg>
          </button>
          <button className="git-graph-toolbar-btn" onClick={handleSearch} title={t('git.search')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398l3.85 3.85a1 1 0 001.415-1.414l-3.868-3.834zm-5.44.806a4.5 4.5 0 110-9 4.5 4.5 0 010 9z"/>
            </svg>
          </button>
          {(query || author || since || until) && (
            <button className="git-graph-toolbar-btn git-graph-toolbar-btn--clear" onClick={handleClear} title={t('git.clear')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z"/>
              </svg>
            </button>
          )}
          {filterBranch && (
            <span className="git-graph-branch-badge">{filterBranch}</span>
          )}
        </div>
        {showFilters && (
          <div className="git-graph-filter-row">
            <input
              type="text"
              className="git-graph-filter-input"
              placeholder={t('git.filterAuthor')}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <input
              type="date"
              className="git-graph-filter-input git-graph-filter-input--date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              title={t('git.since')}
            />
            <input
              type="date"
              className="git-graph-filter-input git-graph-filter-input--date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              title={t('git.until')}
            />
          </div>
        )}
      </div>

      {/* Graph + Commit 统一列表（虚拟滚动） */}
      <div
        ref={scrollContainerRef}
        className="git-graph-list"
        onScroll={handleScroll}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ position: 'absolute', top: offsetY, left: 0, right: 0 }}>
            {visibleCommits.map((commit, i) => {
              const row = startIndex + i;
              const isSelected = selectedHash === commit.hash;
              const node = layout?.nodes.get(commit.hash);
              const nodeColor = node ? GRAPH_COLORS[node.color % GRAPH_COLORS.length] : '#6366f1';
              
              return (
                <div
                  key={commit.hash}
                  className={`git-graph-row ${isSelected ? 'git-graph-row--selected' : ''}`}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => onSelectCommit(commit.hash)}
                  onContextMenu={(e) => handleContextMenu(e, commit)}
                >
                  {/* 左侧 Graph Cell */}
                  {layout && (
                    <div className="git-graph-cell" style={{ width: graphWidth }}>
                      <CommitGraphCell
                        layout={layout}
                        commitHash={commit.hash}
                        row={row}
                        rowHeight={ROW_HEIGHT}
                        isSelected={isSelected}
                        laneWidth={LANE_WIDTH}
                        padLeft={PAD_LEFT}
                      />
                    </div>
                  )}

                  {/* 右侧 Commit 信息 */}
                  <div className="git-graph-commit-info">
                    {/* Commit message + ref tags */}
                    <span className="git-graph-commit-message">
                      {commit.message}
                    </span>
                    {commit.refs && commit.refs.length > 0 && (
                      <span className="git-graph-ref-tags">
                        {commit.refs.map((ref, refIdx) => {
                          const parsed = parseRef(ref);
                          return (
                            <span
                              key={refIdx}
                              className={`git-graph-ref-tag git-graph-ref-tag--${parsed.type}`}
                              style={parsed.type === 'branch' ? { borderColor: nodeColor, color: nodeColor } : {}}
                            >
                              {parsed.name}
                            </span>
                          );
                        })}
                      </span>
                    )}
                    <span className="git-graph-commit-spacer" />
                    {/* Author + Time */}
                    <span className="git-graph-commit-author">{commit.author}</span>
                    <span className="git-graph-commit-time">{formatRelativeTime(commit.date)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 加载更多 */}
        {loadingMore && (
          <div className="git-log-loading-more">
            <div className="git-loading-spinner" /> Loading...
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="git-log-status-bar">
        <span>{commits.length} commits</span>
        {!hasMore && <span> (all loaded)</span>}
      </div>

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
