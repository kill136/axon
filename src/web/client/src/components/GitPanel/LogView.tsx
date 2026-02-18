/**
 * LogView - Git Commit 历史视图
 * 显示最近 50 条 commit，支持展开查看详情和 AI 解释
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { GitCommit } from './index';

interface LogViewProps {
  commits: GitCommit[];
  send: (msg: any) => void;
  projectPath?: string;
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

export function LogView({ commits, send, projectPath }: LogViewProps) {
  const { t } = useLanguage();
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [explainingHash, setExplainingHash] = useState<string | null>(null);

  // 切换 commit 展开/折叠
  const toggleCommit = (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
    } else {
      setExpandedHash(hash);
      // 发送请求获取 commit 详情
      if (projectPath) {
        send({
          type: 'git:get_commit_detail',
          payload: { projectPath, hash },
        });
      }
    }
  };

  // AI 解释 commit
  const handleExplainCommit = (hash: string) => {
    if (!projectPath) return;
    setExplainingHash(hash);
    send({
      type: 'git:explain_commit',
      payload: { projectPath, hash },
    });
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
      {commits.map((commit) => {
        const isExpanded = expandedHash === commit.hash;
        const isExplaining = explainingHash === commit.hash;

        return (
          <div
            key={commit.hash}
            className={`git-commit-item ${isExpanded ? 'git-commit-item--expanded' : ''}`}
          >
            {/* Commit 头部 - 可点击展开 */}
            <div
              className="git-commit-header"
              onClick={() => toggleCommit(commit.hash)}
            >
              <span className="git-commit-hash">{commit.shortHash}</span>
              <span className="git-commit-message">{commit.message}</span>
            </div>

            {/* Commit 元信息 */}
            <div className="git-commit-meta">
              <span className="git-commit-author">{commit.author}</span>
              <span className="git-commit-time">
                {formatRelativeTime(commit.date)}
              </span>
            </div>

            {/* 展开后显示操作按钮 */}
            {isExpanded && (
              <div className="git-commit-actions">
                <button
                  className="git-explain-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExplainCommit(commit.hash);
                  }}
                  disabled={isExplaining}
                >
                  {isExplaining ? t('git.explaining') : t('git.explainCommit')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
