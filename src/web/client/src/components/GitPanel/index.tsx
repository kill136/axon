/**
 * GitPanel - Git 智能面板主组件（三栏布局）
 * 提供可视化的 Git 操作界面和 AI 增强功能
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../../i18n';
import { StatusView } from './StatusView';
import { LogView } from './LogView';
import { BranchesView } from './BranchesView';
import { StashView } from './StashView';
import { TagsView } from './TagsView';
import { RemotesView, GitRemote } from './RemotesView';
import { DiffView } from './DiffView';
import { FileHistoryView } from './FileHistoryView';
import { BlameView } from './BlameView';
import { CommitDetail } from './CommitDetail';
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
  parents: string[];
  refs: string[];
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

export interface GitTag {
  name: string;
  commit: string;
  type: 'lightweight' | 'annotated';
  message?: string;
}

export interface GitDiff {
  file?: string;
  content: string;
}

// 导出 GitRemote 接口供外部使用
export type { GitRemote };

type TabType = 'status' | 'log' | 'branches' | 'stash' | 'tags' | 'remotes';

interface GitPanelProps {
  isOpen: boolean;
  onClose: () => void;
  send: (msg: any) => void;
  addMessageHandler: (handler: (msg: any) => void) => () => void;
  projectPath?: string;
}

export function GitPanel({ isOpen, onClose, send, addMessageHandler, projectPath }: GitPanelProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabType>('log');  // 默认显示 log 视图
  
  // Git 数据状态
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [stashes, setStashes] = useState<GitStash[]>([]);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [remotes, setRemotes] = useState<GitRemote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 三栏布局相关状态
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [filterBranch, setFilterBranch] = useState<string | null>(null);

  // Diff 查看状态
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [diffFileName, setDiffFileName] = useState('');

  // File History 查看状态
  const [viewingFileHistory, setViewingFileHistory] = useState<string | null>(null);

  // Blame 查看状态
  const [viewingBlameFile, setViewingBlameFile] = useState<string | null>(null);

  // 自动 Fetch 状态
  const [autoFetchEnabled, setAutoFetchEnabled] = useState(false);
  const [autoFetchInterval, setAutoFetchInterval] = useState(5); // 分钟

  // AI 增强状态
  const [isGeneratingCommit, setIsGeneratingCommit] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [smartCommitMessage, setSmartCommitMessage] = useState<string | null>(null);
  const [smartCommitNeedsStaging, setSmartCommitNeedsStaging] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [explainResult, setExplainResult] = useState<string | null>(null);
  // 合并审查+提交弹窗状态
  const [commitAndReviewResult, setCommitAndReviewResult] = useState<{
    review: string;
    message: string;
    needsStaging: boolean;
  } | null>(null);
  const [editableCommitMessage, setEditableCommitMessage] = useState('');

  // Checkout 冲突对话框状态
  const [checkoutConflict, setCheckoutConflict] = useState<{
    branch: string;
    error: string;
  } | null>(null);

  // Lock 文件冲突对话框状态
  const [lockConflict, setLockConflict] = useState<{
    lockFile: string;
    age: number;
    suggestion: 'delete' | 'wait';
    operation: string;
  } | null>(null);

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

        case 'git:tags_response':
          if (msg.payload?.success) {
            setTags(msg.payload.data || []);
          }
          break;

        case 'git:remotes_response':
          if (msg.payload?.success) {
            setRemotes(msg.payload.data || []);
          }
          break;

        case 'git:diff_response':
          if (msg.payload?.success && msg.payload.data) {
            setDiffContent(msg.payload.data.content || '');
            setDiffFileName(msg.payload.data.file || 'diff');
          }
          break;

        case 'git:get_file_history':
          // Track when file history is requested from StatusView
          if (msg.payload?.file) {
            setViewingFileHistory(msg.payload.file);
          }
          break;

        case 'git:get_blame':
          // Track when blame is requested from StatusView
          if (msg.payload?.file) {
            setViewingBlameFile(msg.payload.file);
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

        case 'git:smart_commit_and_review_response':
          setIsGeneratingCommit(false);
          setIsReviewing(false);
          if (msg.payload?.success) {
            const result = {
              review: msg.payload.review || '',
              message: msg.payload.message || '',
              needsStaging: !!msg.payload.needsStaging,
            };
            setCommitAndReviewResult(result);
            setEditableCommitMessage(result.message);
          } else {
            setError(msg.payload?.error || 'Smart commit & review failed');
          }
          break;

        case 'git:explain_commit_response':
          if (msg.payload?.success) {
            setExplainResult(msg.payload.explanation);
          }
          break;

        case 'git:checkout_conflict':
          // 切换分支时有未提交的修改 → 弹出友好对话框
          setCheckoutConflict({
            branch: msg.payload.branch,
            error: msg.payload.error,
          });
          break;

        case 'git:operation_result':
          // Git 操作完成后刷新状态（handler 已自动发送 status_response）
          if (!msg.payload?.success) {
            // 检测是否为 lock 文件冲突 — 弹出智能诊断对话框而非普通错误
            if (msg.payload?.lockConflict) {
              setLockConflict({
                lockFile: msg.payload.lockConflict.lockFile,
                age: msg.payload.lockConflict.age,
                suggestion: msg.payload.lockConflict.suggestion,
                operation: msg.payload.operation || 'unknown',
              });
            } else {
              setError(msg.payload?.error || 'Git operation failed');
            }
          } else if (msg.payload?.operation === 'stash_and_checkout' || msg.payload?.operation === 'force_checkout') {
            // 切换分支成功后刷新分支列表和 log
            if (projectPath) {
              send({ type: 'git:get_branches', payload: { projectPath } });
              send({ type: 'git:get_log', payload: { projectPath } });
            }
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

    // 请求 git log（--all 显示所有分支，limit 200）
    send({
      type: 'git:get_log',
      payload: { projectPath, limit: 200, all: true },
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

    send({
      type: 'git:get_tags',
      payload: { projectPath },
    });

    send({
      type: 'git:get_remotes',
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
    } else if (activeTab === 'tags') {
      send({
        type: 'git:get_tags',
        payload: { projectPath },
      });
    } else if (activeTab === 'remotes') {
      send({
        type: 'git:get_remotes',
        payload: { projectPath },
      });
    }
  }, [activeTab, isOpen, projectPath, send]);

  // 自动 Fetch 定时器
  useEffect(() => {
    if (!autoFetchEnabled || !projectPath || !isOpen) return;

    const intervalMs = autoFetchInterval * 60 * 1000; // 转换为毫秒
    const timer = setInterval(() => {
      send({
        type: 'git:fetch',
        payload: { projectPath },
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [autoFetchEnabled, autoFetchInterval, projectPath, isOpen, send]);

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

  // AI 智能审查 + 提交（合并流程）
  const handleSmartCommitAndReview = useCallback(() => {
    if (!projectPath) return;
    setIsGeneratingCommit(true);
    setIsReviewing(true);
    send({
      type: 'git:smart_commit_and_review',
      payload: { projectPath },
    });
  }, [projectPath, send]);

  // 分支选择回调
  const handleBranchSelect = useCallback((branch: string | null) => {
    setFilterBranch(branch);
  }, []);

  // Commit 选择回调
  const handleSelectCommit = useCallback((hash: string) => {
    setSelectedCommitHash(hash);
  }, []);

  if (!isOpen) return null;

  // 获取选中的 commit 对象
  const selectedCommit = selectedCommitHash ? commits.find(c => c.hash === selectedCommitHash) || null : null;

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
          {/* AI 合并按钮：同时触发提交 + 审查 v2 */}
          <button
            className="git-ai-button git-ai-button--compact"
            onClick={handleSmartCommitAndReview}
            disabled={isGeneratingCommit || isReviewing || !(gitStatus?.staged.length || gitStatus?.unstaged.length || gitStatus?.untracked.length)}
            title={`${t('git.smartCommit')} + ${t('git.smartReview')}`}
          >
            {(isGeneratingCommit || isReviewing) ? '⚡' : '🤖'}
          </button>
          <button className="git-panel-close" onClick={onClose} title={t('git.closeShortcut')}>
            ✕
          </button>
        </div>
      </div>

      {/* 标签页导航（简化版）*/}
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
          className={`git-tab ${activeTab === 'stash' ? 'active' : ''}`}
          onClick={() => setActiveTab('stash')}
        >
          {t('git.tab.stash')}
        </button>
        <button
          className={`git-tab ${activeTab === 'tags' ? 'active' : ''}`}
          onClick={() => setActiveTab('tags')}
        >
          {t('git.tab.tags')}
        </button>
        <button
          className={`git-tab ${activeTab === 'remotes' ? 'active' : ''}`}
          onClick={() => setActiveTab('remotes')}
        >
          {t('git.tab.remotes')}
        </button>
      </div>

      {/* Checkout 冲突对话框 */}
      {checkoutConflict && (
        <div className="git-dialog-overlay" onClick={() => setCheckoutConflict(null)}>
          <div className="git-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="git-dialog-header">
              <h3>{t('git.checkoutConflictTitle')}</h3>
            </div>
            <div className="git-dialog-body">
              <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('git.checkoutConflictDesc', { branch: checkoutConflict.branch })}
              </p>
              <div style={{
                background: 'rgba(255,100,100,0.08)',
                border: '1px solid rgba(255,100,100,0.2)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                maxHeight: 120,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>
                {checkoutConflict.error}
              </div>
            </div>
            <div className="git-dialog-footer" style={{ gap: 8 }}>
              <button
                className="git-dialog-cancel"
                onClick={() => setCheckoutConflict(null)}
              >
                {t('git.cancel')}
              </button>
              <button
                className="git-dialog-confirm"
                style={{ background: '#e15a60' }}
                onClick={() => {
                  if (projectPath) {
                    send({
                      type: 'git:force_checkout',
                      payload: { projectPath, branch: checkoutConflict.branch },
                    });
                  }
                  setCheckoutConflict(null);
                }}
              >
                {t('git.forceCheckout')}
              </button>
              <button
                className="git-dialog-confirm"
                onClick={() => {
                  if (projectPath) {
                    send({
                      type: 'git:stash_and_checkout',
                      payload: { projectPath, branch: checkoutConflict.branch },
                    });
                  }
                  setCheckoutConflict(null);
                }}
              >
                {t('git.stashAndCheckout')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lock 文件冲突智能诊断对话框 */}
      {lockConflict && (
        <div className="git-dialog-overlay" onClick={() => setLockConflict(null)}>
          <div className="git-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="git-dialog-header">
              <h3>{t('git.lockConflictTitle')}</h3>
            </div>
            <div className="git-dialog-body">
              <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('git.lockConflictDesc')}
              </p>
              <div style={{
                background: 'rgba(255,180,50,0.08)',
                border: '1px solid rgba(255,180,50,0.3)',
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
              }}>
                <div style={{ marginBottom: 6 }}>
                  <strong>{t('git.lockFile')}:</strong>{' '}
                  <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.15)', padding: '1px 5px', borderRadius: 3 }}>
                    {lockConflict.lockFile}
                  </code>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <strong>{t('git.lockAge')}:</strong>{' '}
                  {lockConflict.age > 60
                    ? t('git.lockAgeMinutes', { minutes: Math.floor(lockConflict.age / 60) })
                    : t('git.lockAgeSeconds', { seconds: lockConflict.age })
                  }
                </div>
                <div>
                  <strong>{t('git.lockDiagnosis')}:</strong>{' '}
                  {lockConflict.suggestion === 'delete'
                    ? t('git.lockDiagnosisStale')
                    : t('git.lockDiagnosisRecent')
                  }
                </div>
              </div>
            </div>
            <div className="git-dialog-footer" style={{ gap: 8 }}>
              <button
                className="git-dialog-cancel"
                onClick={() => setLockConflict(null)}
              >
                {t('git.cancel')}
              </button>
              <button
                className="git-dialog-confirm"
                style={{ background: lockConflict.suggestion === 'delete' ? '#e15a60' : undefined }}
                onClick={() => {
                  if (projectPath) {
                    send({
                      type: 'git:resolve_lock',
                      payload: { projectPath, action: 'delete' },
                    });
                  }
                  setLockConflict(null);
                }}
              >
                {t('git.lockDeleteAndRetry')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内容区 - 三栏布局或单视图 */}
      <div className="git-panel-body">
        {error && (
          <div className="git-error-banner">
            <span>⚠️ {error}</span>
            <button onClick={refreshGitData}>{t('git.retry')}</button>
          </div>
        )}

        {loading && (
          <div className="git-loading">
            <div className="git-loading-spinner"></div>
            {t('common.loading')}
          </div>
        )}

        {!loading && (
          <>
            {/* Status 视图（单栏）*/}
            {activeTab === 'status' && (
              <div className="git-panel-content">
                <StatusView
                  gitStatus={gitStatus}
                  send={send}
                  projectPath={projectPath}
                />
              </div>
            )}

            {/* Log 视图（三栏布局）*/}
            {activeTab === 'log' && (
              <>
                {/* 左侧栏：分支树 */}
                <div className="git-panel-sidebar">
                  <BranchesView
                    branches={branches}
                    send={send}
                    projectPath={projectPath}
                    onBranchSelect={handleBranchSelect}
                  />
                </div>

                {/* 中间栏：Graph + Commit 列表 */}
                <div className="git-panel-main">
                  <LogView
                    commits={commits}
                    send={send}
                    addMessageHandler={addMessageHandler}
                    projectPath={projectPath}
                    selectedHash={selectedCommitHash}
                    onSelectCommit={handleSelectCommit}
                    filterBranch={filterBranch}
                  />
                </div>

                {/* 右侧栏：Commit 详情 */}
                <div className="git-panel-detail">
                  <CommitDetail
                    commit={selectedCommit}
                    send={send}
                    addMessageHandler={addMessageHandler}
                    projectPath={projectPath}
                  />
                </div>
              </>
            )}

            {/* 其他标签页（单栏）*/}
            {activeTab === 'stash' && (
              <div className="git-panel-content">
                <StashView
                  stashes={stashes}
                  send={send}
                  projectPath={projectPath}
                  onRefresh={refreshGitData}
                />
              </div>
            )}

            {activeTab === 'tags' && (
              <div className="git-panel-content">
                <TagsView
                  tags={tags}
                  send={send}
                  projectPath={projectPath}
                />
              </div>
            )}

            {activeTab === 'remotes' && (
              <div className="git-panel-content">
                <RemotesView
                  remotes={remotes}
                  send={send}
                  projectPath={projectPath}
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

      {/* Blame 浮层 */}
      {viewingBlameFile !== null && (
        <div className="git-blame-overlay">
          <BlameView
            file={viewingBlameFile}
            send={send}
            addMessageHandler={addMessageHandler}
            projectPath={projectPath}
            onClose={() => setViewingBlameFile(null)}
          />
        </div>
      )}

      {/* File History 浮层 */}
      {viewingFileHistory !== null && (
        <div className="git-file-history-overlay">
          <FileHistoryView
            file={viewingFileHistory}
            send={send}
            addMessageHandler={addMessageHandler}
            projectPath={projectPath}
            onClose={() => setViewingFileHistory(null)}
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
              <button onClick={() => setSmartCommitMessage(null)}>{t('git.cancel')}</button>
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

      {/* Smart Commit + Review 合并弹窗 */}
      {commitAndReviewResult && (
        <div className="git-ai-result-overlay" onClick={() => setCommitAndReviewResult(null)}>
          <div className="git-ai-result git-ai-result--wide" onClick={e => e.stopPropagation()}>
            <div className="git-ai-result-header">
              <span>{t('git.smartReview')}</span>
              <button onClick={() => setCommitAndReviewResult(null)}>✕</button>
            </div>
            {/* 审查结果区域 */}
            <div className="git-ai-result-content git-ai-result-content--markdown git-ai-review-section">
              <MarkdownContent content={commitAndReviewResult.review} />
            </div>
            {/* 分隔线 + Commit Message 区域 */}
            <div className="git-ai-commit-section">
              <div className="git-ai-commit-section-header">{t('git.commitMessage')}</div>
              <textarea
                className="git-ai-commit-textarea"
                value={editableCommitMessage}
                onChange={e => setEditableCommitMessage(e.target.value)}
                rows={4}
              />
            </div>
            <div className="git-ai-result-actions">
              <button
                className="git-ai-result-action-primary"
                disabled={!editableCommitMessage.trim()}
                onClick={() => {
                  send({
                    type: 'git:commit',
                    payload: {
                      projectPath,
                      message: editableCommitMessage,
                      autoStage: commitAndReviewResult.needsStaging,
                    },
                  });
                  setCommitAndReviewResult(null);
                  setEditableCommitMessage('');
                }}
              >
                {t('git.commit')}
              </button>
              <button onClick={() => setCommitAndReviewResult(null)}>{t('git.cancel')}</button>
            </div>
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
