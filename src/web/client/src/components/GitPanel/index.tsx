/**
 * GitPanel - Git 智能面板主组件
 * 提供可视化的 Git 操作界面和 AI 增强功能
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import { StatusView } from './StatusView';
import { LogView } from './LogView';
import { BranchesView } from './BranchesView';
import { StashView } from './StashView';
import { DiffView } from './DiffView';
import { MarkdownContent } from '../MarkdownContent';
import './GitPanel.css';

// Git 数据类型定义（与后端 GitManager 对应）
export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicts: string[];
  currentBranch: string;
  remoteStatus: {
    ahead: number;
    behind: number;
    remote?: string;
    branch?: string;
  };
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitStash {
  index: number;
  message: string;
  date: string;
}

export interface GitDiff {
  file?: string;
  content: string;
}

type TabType = 'status' | 'log' | 'branches' | 'stash';

interface GitPanelProps {
  isOpen: boolean;
  onClose: () => void;
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  projectPath?: string;
}

export function GitPanel({ isOpen, onClose, send, addMessageHandler, projectPath }: GitPanelProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabType>('status');
  
  // Git 数据状态
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diff 查看状态
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffFileName, setDiffFileName] = useState('');

  // AI 增强状态
  const [isGeneratingCommit, setIsGeneratingCommit] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [smartCommitMessage, setSmartCommitMessage] = useState<string | null>(null);
  const [smartCommitNeedsStaging, setSmartCommitNeedsStaging] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [explainResult, setExplainResult] = useState<string | null>(null);

  // 订阅 WebSocket 消息
  useEffect(() => {
    if (!isOpen) return;

    const handler = (msg: any) => {
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case 'git:status_response':
          setLoading(false);
          if (msg.payload?.success) {
            setGitStatus(msg.payload.data);
            setError(null);
          } else {
            setError(msg.payload?.error || t('error.gitStatusFailed'));
          }
          break;

        case 'git:log_response':
          setLoading(false);
          if (msg.payload?.success) {
            setCommits(msg.payload.data || []);
            setError(null);
          } else {
            setError(msg.payload?.error || t('error.gitLogFailed'));
          }
          break;

        case 'git:branches_response':
          if (msg.payload?.success) {
            setBranches(msg.payload.data || []);
          }
          break;

        case 'git:stashes_response':
          if (msg.payload?.success) {
            setStashes(msg.payload.data || []);
          }
          break;

        case 'git:diff_response':
          if (msg.payload?.success && msg.payload.data) {
            setDiffContent(msg.payload.data.content || '');
            setDiffFileName(msg.payload.data.file || 'diff');
          }
          break;

        case 'git:smart_commit_response':
          setIsGeneratingCommit(false);
          if (msg.payload?.success) {
            setSmartCommitMessage(msg.payload.message);
            setSmartCommitNeedsStaging(!!msg.payload.needsStaging);
          } else {
            setError(msg.payload?.error || 'Smart commit failed');
          }
          break;

        case 'git:smart_review_response':
          setIsReviewing(false);
          if (msg.payload?.success) {
            setReviewResult(msg.payload.review);
          } else {
            setError(msg.payload?.error || 'Smart review failed');
          }
          break;

        case 'git:explain_commit_response':
          if (msg.payload?.success) {
            setExplainResult(msg.payload.explanation);
          }
          break;

        case 'git:operation_result':
          // Git 操作完成后刷新状态（handler 已自动发送 status_response）
          if (!msg.payload?.success) {
            setError(msg.payload?.error || 'Git operation failed');
          }
          break;
      }
    };

    const unsubscribe = addMessageHandler(handler);
    return () => unsubscribe();
  }, [isOpen, addMessageHandler]);

  // 面板打开时自动请求数据
  useEffect(() => {
    if (isOpen && projectPath) {
      refreshGitData();
    }
  }, [isOpen, projectPath]);

  // 刷新所有 Git 数据
  const refreshGitData = useCallback(() => {
    if (!projectPath) return;

    setLoading(true);
    setError(null);

    // 请求 git status
    send({
      type: 'git:get_status',
      payload: { projectPath },
    });

    // 请求 git log
    send({
      type: 'git:get_log',
      payload: { projectPath, limit: 50 },
    });

    // 始终请求 branches 和 stashes
    send({
      type: 'git:get_branches',
      payload: { projectPath },
    });

    send({
      type: 'git:get_stashes',
      payload: { projectPath },
    });
  }, [projectPath, send]);

  // 切换标签页时请求相应数据
  useEffect(() => {
    if (!isOpen || !projectPath) return;

    if (activeTab === 'branches') {
      send({
        type: 'git:get_branches',
        payload: { projectPath },
      });
    } else if (activeTab === 'stash') {
      send({
        type: 'git:get_stashes',
        payload: { projectPath },
      });
    }
  }, [activeTab, isOpen, projectPath, send]);

  // AI 智能提交
  const handleSmartCommit = useCallback(() => {
    if (!projectPath) return;
    setIsGeneratingCommit(true);
    send({
      type: 'git:smart_commit',
      payload: { projectPath },
    });
  }, [projectPath, send]);

  // AI 智能审查
  const handleSmartReview = useCallback(() => {
    if (!projectPath) return;
    setIsReviewing(true);
    send({
      type: 'git:smart_review',
      payload: { projectPath },
    });
  }, [projectPath, send]);

  if (!isOpen) return null;

  return (
    <div className="git-panel">
      {/* 面板头部 */}
      <div className="git-panel-header">
        <div className="git-panel-title">
          <span className="git-panel-title-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </span>
          {t('git.title')}
          {gitStatus && (
            <span className="git-panel-badge">
              {gitStatus.currentBranch || 'main'}
            </span>
          )}
        </div>
        <div className="git-panel-header-actions">
          {/* AI 增强按钮组 */}
          <button
            className="git-ai-button"
            onClick={handleSmartCommit}
            disabled={isGeneratingCommit || !(gitStatus?.staged.length || gitStatus?.unstaged.length || gitStatus?.untracked.length)}
            title={t('git.smartCommit')}
          >
            {isGeneratingCommit ? '⚡' : '🤖'} {t('git.smartCommit')}
          </button>
          <button
            className="git-ai-button"
            onClick={handleSmartReview}
            disabled={isReviewing}
            title={t('git.smartReview')}
          >
            {isReviewing ? '⚡' : '🔍'} {t('git.smartReview')}
          </button>
          <button className="git-panel-close" onClick={onClose} title="Close (Ctrl+Shift+G)">
            ✕
          </button>
        </div>
      </div>

      {/* 标签页导航 */}
      <div className="git-panel-tabs">
        <button
          className={`git-tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => setActiveTab('status')}
        >
          {t('git.tab.status')}
        </button>
        <button
          className={`git-tab ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => setActiveTab('log')}
        >
          {t('git.tab.log')}
        </button>
        <button
          className={`git-tab ${activeTab === 'branches' ? 'active' : ''}`}
          onClick={() => setActiveTab('branches')}
        >
          {t('git.tab.branches')}
        </button>
        <button
          className={`git-tab ${activeTab === 'stash' ? 'active' : ''}`}
          onClick={() => setActiveTab('stash')}
        >
          {t('git.tab.stash')}
        </button>
      </div>

      {/* 内容区 */}
      <div className="git-panel-content">
        {error && (
          <div className="git-error-banner">
            <span>⚠️ {error}</span>
            <button onClick={refreshGitData}>Retry</button>
          </div>
        )}

        {loading && (
          <div className="git-loading">
            <div className="git-loading-spinner"></div>
            Loading...
          </div>
        )}

        {!loading && (
          <>
            {activeTab === 'status' && (
              <div className="git-tab-content">
                <StatusView
                  gitStatus={gitStatus}
                  send={send}
                  projectPath={projectPath}
                />
              </div>
            )}

            {activeTab === 'log' && (
              <div className="git-tab-content">
                <LogView
                  commits={commits}
                  send={send}
                  projectPath={projectPath}
                />
              </div>
            )}

            {activeTab === 'branches' && (
              <div className="git-tab-content">
                <BranchesView
                  branches={branches}
                  send={send}
                  projectPath={projectPath}
                />
              </div>
            )}

            {activeTab === 'stash' && (
              <div className="git-tab-content">
                <StashView
                  stashes={stashes}
                  send={send}
                  projectPath={projectPath}
                  onRefresh={refreshGitData}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Diff 浮层 */}
      {diffContent !== null && (
        <div className="git-diff-overlay">
          <DiffView
            diff={diffContent}
            fileName={diffFileName}
            onClose={() => { setDiffContent(null); setDiffFileName(''); }}
          />
        </div>
      )}

      {/* Smart Commit Message 结果 */}
      {smartCommitMessage && (
        <div className="git-ai-result-overlay" onClick={() => setSmartCommitMessage(null)}>
          <div className="git-ai-result" onClick={e => e.stopPropagation()}>
            <div className="git-ai-result-header">
              <span>{t('git.smartCommit')}</span>
              <button onClick={() => setSmartCommitMessage(null)}>✕</button>
            </div>
            <pre className="git-ai-result-content">{smartCommitMessage}</pre>
            <div className="git-ai-result-actions">
              <button
                className="git-ai-result-action-primary"
                onClick={() => {
                  send({ type: 'git:commit', payload: { projectPath, message: smartCommitMessage, autoStage: smartCommitNeedsStaging } });
                  setSmartCommitMessage(null);
                  setSmartCommitNeedsStaging(false);
                }}
              >
                {t('git.commit')}
              </button>
              <button onClick={() => setSmartCommitMessage(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Review 结果 */}
      {reviewResult && (
        <div className="git-ai-result-overlay" onClick={() => setReviewResult(null)}>
          <div className="git-ai-result git-ai-result--wide" onClick={e => e.stopPropagation()}>
            <div className="git-ai-result-header">
              <span>{t('git.smartReview')}</span>
              <button onClick={() => setReviewResult(null)}>✕</button>
            </div>
            <div className="git-ai-result-content git-ai-result-content--markdown"><MarkdownContent content={reviewResult} /></div>
          </div>
        </div>
      )}

      {/* Explain Commit 结果 */}
      {explainResult && (
        <div className="git-ai-result-overlay" onClick={() => setExplainResult(null)}>
          <div className="git-ai-result" onClick={e => e.stopPropagation()}>
            <div className="git-ai-result-header">
              <span>{t('git.explainCommit')}</span>
              <button onClick={() => setExplainResult(null)}>✕</button>
            </div>
            <div className="git-ai-result-content git-ai-result-content--markdown"><MarkdownContent content={explainResult} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
