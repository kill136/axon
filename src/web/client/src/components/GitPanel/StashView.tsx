/**
 * StashView - Git Stash 管理视图
 * 显示 stash 列表，支持 apply、pop、drop 操作
 */

import { useState } from 'react';
import { useLanguage } from '../../i18n';
import { GitStash } from './index';

interface StashViewProps {
  stashes: GitStash[];
  send: (msg: any) => void;
  projectPath?: string;
  onRefresh?: () => void;
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

export function StashView({ stashes, send, projectPath, onRefresh }: StashViewProps) {
  const { t } = useLanguage();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [stashMessage, setStashMessage] = useState('');

  // 保存 stash
  const handleStashSave = () => {
    if (!projectPath) return;
    
    const message = stashMessage.trim();
    send({
      type: 'git:stash_save',
      payload: { projectPath, message: message || undefined },
    });
    
    // 重置对话框
    setStashMessage('');
    setShowSaveDialog(false);
    
    // 刷新列表
    if (onRefresh) {
      setTimeout(onRefresh, 500);
    }
  };

  // Apply stash
  const handleStashApply = (index: number) => {
    if (!projectPath) return;
    send({
      type: 'git:stash_apply',
      payload: { projectPath, index },
    });
    if (onRefresh) {
      setTimeout(onRefresh, 500);
    }
  };

  // Pop stash
  const handleStashPop = (index: number) => {
    if (!projectPath) return;
    send({
      type: 'git:stash_pop',
      payload: { projectPath, index },
    });
    if (onRefresh) {
      setTimeout(onRefresh, 500);
    }
  };

  // Drop stash（需确认）
  const handleStashDrop = (index: number) => {
    if (!projectPath) return;
    if (window.confirm(t('git.confirmDelete'))) {
      send({
        type: 'git:stash_drop',
        payload: { projectPath, index },
      });
      if (onRefresh) {
        setTimeout(onRefresh, 500);
      }
    }
  };

  return (
    <div className="git-stash-view">
      {/* 顶部操作栏 */}
      <div className="git-stash-header">
        <button
          className="git-stash-save-button"
          onClick={() => setShowSaveDialog(true)}
        >
          + {t('git.stashSave')}
        </button>
      </div>

      {/* Stash 保存对话框 */}
      {showSaveDialog && (
        <div className="git-input-dialog">
          <div className="git-input-dialog-content">
            <div className="git-input-dialog-header">
              <h3>{t('git.stashSave')}</h3>
              <button
                className="git-input-dialog-close"
                onClick={() => setShowSaveDialog(false)}
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              className="git-input-dialog-input"
              placeholder={t('git.commitMessage')}
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleStashSave();
                } else if (e.key === 'Escape') {
                  setShowSaveDialog(false);
                }
              }}
              autoFocus
            />
            <div className="git-input-dialog-actions">
              <button
                className="git-input-dialog-cancel"
                onClick={() => setShowSaveDialog(false)}
              >
                Cancel
              </button>
              <button
                className="git-input-dialog-confirm"
                onClick={handleStashSave}
              >
                {t('git.stashSave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stash 列表 */}
      {stashes.length === 0 ? (
        <div className="git-empty-state">
          {t('git.noStashes')}
        </div>
      ) : (
        stashes.map((stash) => (
          <div key={stash.index} className="git-stash-item">
            <div className="git-stash-info">
              <span className="git-stash-index">stash@{'{' + stash.index + '}'}</span>
              <span className="git-stash-message">{stash.message}</span>
              <span className="git-stash-time">{formatRelativeTime(stash.date)}</span>
            </div>
            <div className="git-stash-actions">
              <button
                onClick={() => handleStashApply(stash.index)}
                title={t('git.stashApply')}
              >
                {t('git.stashApply')}
              </button>
              <button
                onClick={() => handleStashPop(stash.index)}
                title={t('git.stashPop')}
              >
                {t('git.stashPop')}
              </button>
              <button
                onClick={() => handleStashDrop(stash.index)}
                title={t('git.stashDrop')}
              >
                {t('git.stashDrop')}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
