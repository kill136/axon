/**
 * LogView - Git Commit 历史视图（集成 Graph）
 * 显示 commit graph + commit 列表，支持搜索/过滤、ref 标签显示
 */

import { useState, useEffect, useMemo } from 'react';
import { useLanguage } from '../../i18n';
import { GitCommit } from './index';
import { CommitGraph } from './CommitGraph';
import { computeGraphLayout, GRAPH_COLORS } from './graph-utils';

interface LogViewProps {
  commits: GitCommit[];
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  projectPath?: string;
  selectedHash: string | null;
  onSelectCommit: (hash: string) => void;
  filterBranch?: string | null;  // 从分支树选择的筛选分支
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

export function LogView({ commits, send, addMessageHandler, projectPath, selectedHash, onSelectCommit, filterBranch }: LogViewProps) {
  const { t } = useLanguage();
  
  // 搜索/过滤状态
  const [query, setQuery] = useState('');
  const [author, setAuthor] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  // 计算 graph layout
  const layout = useMemo(() => {
    if (commits.length === 0) return null;
    return computeGraphLayout(commits.map(c => ({ hash: c.hash, parents: c.parents || [] })));
  }, [commits]);

  // 搜索 commits
  const handleSearch = () => {
    if (!projectPath) return;
    const filter: any = { projectPath, limit: 200 };
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
    // 重新获取默认 log
    if (projectPath) {
      send({
        type: 'git:get_log',
        payload: { projectPath, limit: 200 },
      });
    }
  };

  // 当 filterBranch 改变时，请求筛选的 log
  useEffect(() => {
    if (!projectPath) return;
    
    if (filterBranch) {
      // 请求特定分支的 log
      send({
        type: 'git:get_log',
        payload: { projectPath, limit: 200, branch: filterBranch },
      });
    } else {
      // 请求所有分支的 log
      send({
        type: 'git:get_log',
        payload: { projectPath, limit: 200 },
      });
    }
  }, [filterBranch, projectPath, send]);

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

  const rowHeight = 36;

  return (
    <div className="git-log-view">
      {/* 筛选栏 */}
      <div className="git-filter-bar">
        <input
          type="text"
          className="git-filter-input"
          placeholder={t('git.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <input
          type="text"
          className="git-filter-input git-filter-input--small"
          placeholder={t('git.filterAuthor')}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <div className="git-filter-date-group">
          <input
            type="date"
            className="git-filter-input git-filter-input--date"
            placeholder={t('git.since')}
            value={since}
            onChange={(e) => setSince(e.target.value)}
            title={t('git.since')}
          />
          <input
            type="date"
            className="git-filter-input git-filter-input--date"
            placeholder={t('git.until')}
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            title={t('git.until')}
          />
        </div>
        <button className="git-filter-button" onClick={handleSearch}>
          {t('git.search')}
        </button>
        <button className="git-filter-button git-filter-button--secondary" onClick={handleClear}>
          {t('git.clear')}
        </button>
        {filterBranch && (
          <div className="git-filter-badge">
            Branch: {filterBranch}
          </div>
        )}
      </div>

      {/* Commit 列表（集成 Graph）*/}
      <div className="git-log-content">
        {layout && (
          <div className="git-log-graph-container" style={{ width: (layout.maxLane + 1) * 20 + 20 }}>
            <CommitGraph
              layout={layout}
              commits={commits}
              selectedHash={selectedHash}
              rowHeight={rowHeight}
              onCommitClick={onSelectCommit}
            />
          </div>
        )}
        <div className="git-log-commits">
          {commits.map((commit, idx) => {
            const isSelected = selectedHash === commit.hash;
            
            return (
              <div
                key={commit.hash}
                className={`git-commit-row ${isSelected ? 'git-commit-row--selected' : ''}`}
                style={{ height: rowHeight }}
                onClick={() => onSelectCommit(commit.hash)}
              >
                <div className="git-commit-row-main">
                  <span className="git-commit-hash">{commit.shortHash}</span>
                  <span className="git-commit-message">
                    {commit.message}
                    {/* Ref 标签 */}
                    {commit.refs && commit.refs.length > 0 && (
                      <span className="git-ref-tags">
                        {commit.refs.map((ref, refIdx) => {
                          const parsed = parseRef(ref);
                          const node = layout?.nodes.get(commit.hash);
                          const color = node ? GRAPH_COLORS[node.color % GRAPH_COLORS.length] : '#6366f1';
                          
                          return (
                            <span
                              key={refIdx}
                              className={`git-ref-tag git-ref-tag--${parsed.type}`}
                              style={parsed.type === 'branch' ? { backgroundColor: color } : {}}
                            >
                              {parsed.name}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </span>
                </div>
                <div className="git-commit-row-meta">
                  <span className="git-commit-author">{commit.author}</span>
                  <span className="git-commit-time">{formatRelativeTime(commit.date)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
