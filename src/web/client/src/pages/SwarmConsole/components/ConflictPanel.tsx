/**
 * ConflictPanel - 冲突解决面板
 *
 * 当蜂群执行过程中发生合并冲突且无法自动解决时，
 * 显示此面板让用户选择解决方案。
 */

import React, { useState } from 'react';
import type { PendingConflict, ConflictDecision, ConflictFile } from '../types';
import styles from '../SwarmConsole.module.css';
import { useLanguage } from '../../../i18n';

interface ConflictPanelProps {
  conflicts: PendingConflict[];
  onResolve: (conflictId: string, decision: ConflictDecision, customContents?: Record<string, string>) => void;
}

/**
 * 冲突解决面板
 */
export const ConflictPanel: React.FC<ConflictPanelProps> = ({ conflicts, onResolve }) => {
  const { t } = useLanguage();
  const [selectedConflict, setSelectedConflict] = useState<PendingConflict | null>(
    conflicts.length > 0 ? conflicts[0] : null
  );
  const [selectedFile, setSelectedFile] = useState<ConflictFile | null>(
    selectedConflict?.files?.[0] || null
  );
  const [isResolving, setIsResolving] = useState(false);

  if (conflicts.length === 0) {
    return null;
  }

  const handleResolve = async (decision: ConflictDecision) => {
    if (!selectedConflict) return;

    setIsResolving(true);
    try {
      await onResolve(selectedConflict.id, decision);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className={styles.conflictPanel}>
      {/* 标题栏 */}
      <div className={styles.conflictHeader}>
        <span className={styles.conflictIcon}>🔴</span>
        <h3>{t('conflict.mergeRequired')}</h3>
        <span className={styles.conflictCount}>{t('conflict.count', { count: conflicts.length })}</span>
      </div>

      {/* 冲突列表 */}
      {conflicts.length > 1 && (
        <div className={styles.conflictList}>
          {conflicts.map((conflict) => (
            <button
              key={conflict.id}
              className={`${styles.conflictItem} ${selectedConflict?.id === conflict.id ? styles.active : ''}`}
              onClick={() => {
                setSelectedConflict(conflict);
                setSelectedFile(conflict.files?.[0] || null);
              }}
            >
              <span className={styles.taskName}>{conflict.taskName}</span>
              <span className={styles.fileCount}>{t('conflict.fileCount', { count: conflict.files.length })}</span>
            </button>
          ))}
        </div>
      )}

      {/* 冲突详情 */}
      {selectedConflict && (
        <div className={styles.conflictDetail}>
          {/* 任务信息 */}
          <div className={styles.conflictInfo}>
            <div className={styles.infoRow}>
              <span className={styles.label}>{t('conflict.task')}:</span>
              <span className={styles.value}>{selectedConflict.taskName}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Worker:</span>
              <span className={styles.value}>{selectedConflict.workerId.slice(0, 8)}...</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>{t('conflict.branch')}:</span>
              <span className={styles.value}>{selectedConflict.branchName}</span>
            </div>
          </div>

          {/* 文件选择器 */}
          {selectedConflict.files.length > 1 && (
            <div className={styles.fileSelector}>
              {selectedConflict.files.map((file) => (
                <button
                  key={file.path}
                  className={`${styles.fileTab} ${selectedFile?.path === file.path ? styles.active : ''}`}
                  onClick={() => setSelectedFile(file)}
                >
                  {file.path.split(/[/\\]/).pop()}
                </button>
              ))}
            </div>
          )}

          {/* 文件对比 */}
          {selectedFile && (
            <FileCompare file={selectedFile} />
          )}

          {/* 操作按钮 */}
          <div className={styles.conflictActions}>
            {selectedFile?.suggestedMerge && (
              <button
                className={`${styles.actionBtn} ${styles.primary}`}
                onClick={() => handleResolve('use_suggested')}
                disabled={isResolving}
              >
                {t('conflict.useSuggested')}
              </button>
            )}
            <button
              className={`${styles.actionBtn} ${styles.secondary}`}
              onClick={() => handleResolve('use_both')}
              disabled={isResolving}
            >
              {t('conflict.useBoth')}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => handleResolve('use_ours')}
              disabled={isResolving}
            >
              {t('conflict.useOurs')}
            </button>
            <button
              className={styles.actionBtn}
              onClick={() => handleResolve('use_theirs')}
              disabled={isResolving}
            >
              {t('conflict.useTheirs')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * 文件对比组件
 */
const FileCompare: React.FC<{ file: ConflictFile }> = ({ file }) => {
  const { t } = useLanguage();
  const [viewMode, setViewMode] = useState<'split' | 'suggested'>('split');

  return (
    <div className={styles.fileCompare}>
      {/* 视图切换 */}
      <div className={styles.viewTabs}>
        <button
          className={`${styles.viewTab} ${viewMode === 'split' ? styles.active : ''}`}
          onClick={() => setViewMode('split')}
        >
          {t('conflict.splitView')}
        </button>
        {file.suggestedMerge && (
          <button
            className={`${styles.viewTab} ${viewMode === 'suggested' ? styles.active : ''}`}
            onClick={() => setViewMode('suggested')}
          >
            {t('conflict.queenSuggestion')}
          </button>
        )}
      </div>

      {/* 文件路径 */}
      <div className={styles.filePath}>{file.path}</div>

      {/* 内容区域 */}
      {viewMode === 'split' ? (
        <div className={styles.splitView}>
          <div className={styles.codePane}>
            <div className={styles.paneHeader}>{t('conflict.currentVersion')}</div>
            <pre className={styles.codeContent}>{file.oursContent}</pre>
          </div>
          <div className={styles.codePane}>
            <div className={styles.paneHeader}>{t('conflict.workerVersion')}</div>
            <pre className={styles.codeContent}>{file.theirsContent}</pre>
          </div>
        </div>
      ) : (
        <div className={styles.suggestedView}>
          <div className={styles.paneHeader}>{t('conflict.queenMergeSuggestion')}</div>
          <pre className={styles.codeContent}>{file.suggestedMerge}</pre>
        </div>
      )}
    </div>
  );
};

export default ConflictPanel;
