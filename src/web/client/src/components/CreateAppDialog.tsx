/**
 * 创建作品对话框
 * 
 * 用户输入自然语言描述 + 指定工作目录 → 提交创建。
 * 工作目录必填，AI 会在该目录下工作，不会污染当前项目。
 */

import { useState } from 'react';
import { useLanguage } from '../i18n';
import { DirectoryBrowser } from './DirectoryBrowser';

interface CreateAppDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (description: string, workingDirectory: string) => void;
}

export function CreateAppDialog({ isOpen, onClose, onSubmit }: CreateAppDialogProps) {
  const { t } = useLanguage();
  const [desc, setDesc] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [showDirBrowser, setShowDirBrowser] = useState(false);

  if (!isOpen) return null;

  const isAbsolutePath = (p: string) => {
    // Windows: C:\, D:\, \\server, //server
    // Unix: /home, /tmp
    return /^[A-Za-z]:[/\\]/.test(p) || p.startsWith('/') || p.startsWith('\\\\') || p.startsWith('//');
  };

  const handleSubmit = () => {
    const trimmedDesc = desc.trim();
    const trimmedDir = workDir.trim();
    if (!trimmedDesc) return;
    if (!trimmedDir) {
      setDirError(t('apps.dirRequired') || '请指定工作目录');
      return;
    }
    // 必须是绝对路径，不能是相对路径
    if (!isAbsolutePath(trimmedDir)) {
      setDirError(t('apps.dirMustBeAbsolute') || '请输入完整的绝对路径，如 D:\\Projects\\my-app');
      return;
    }
    setDirError('');
    onSubmit(trimmedDesc, trimmedDir);
    setDesc('');
    setWorkDir('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleBrowse = () => {
    setShowDirBrowser(true);
  };

  const handleDirSelected = (fullPath: string) => {
    setWorkDir(fullPath);
    setDirError('');
  };

  return (
    <div className="create-app-overlay" onClick={onClose}>
      <div className="create-app-dialog" onClick={e => e.stopPropagation()}>
        <h2>✨ {t('apps.createTitle') || '告诉 AI 你想做什么'}</h2>
        
        {/* 工作目录 */}
        <div className="create-app-field">
          <label className="create-app-label">
            📁 {t('apps.workingDir') || '工作目录'}
            <span className="create-app-required">*</span>
          </label>
          <p className="create-app-hint">
            {t('apps.workingDirHint') || 'AI 会在这个目录下创建项目文件，请指定一个新的空目录'}
          </p>
          <div className="create-app-dir-row">
            <input
              type="text"
              value={workDir}
              onChange={e => { setWorkDir(e.target.value); setDirError(''); }}
              onKeyDown={handleKeyDown}
              placeholder={t('apps.workingDirPlaceholder') || '例如：D:\\Projects\\my-app 或 ~/projects/my-app'}
              className={`create-app-dir-input ${dirError ? 'has-error' : ''}`}
            />
            <button
              className="create-app-browse-btn"
              onClick={handleBrowse}
              type="button"
              title={t('apps.browse') || '浏览...'}
            >
              📂
            </button>
          </div>
          {dirError && <p className="create-app-error">{dirError}</p>}
        </div>

        {/* 需求描述 */}
        <div className="create-app-field">
          <label className="create-app-label">
            💡 {t('apps.descLabel') || '需求描述'}
          </label>
          <p className="create-app-hint">
            {t('apps.createPlaceholder') || '描述你想做的东西，比如：一个征信报告解读工具、一个记账本、一个贪吃蛇游戏'}
          </p>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('apps.descPlaceholderShort') || '描述你想做的东西...'}
            autoFocus
            rows={4}
          />
        </div>

        <div className="create-app-actions">
          <button className="create-app-cancel" onClick={onClose}>
            {t('common.cancel') || '取消'}
          </button>
          <button
            className="create-app-submit"
            onClick={handleSubmit}
            disabled={!desc.trim() || !workDir.trim()}
          >
            {t('apps.startCreate') || '开始创建'}
          </button>
        </div>
      </div>

      <style>{`
        .create-app-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          animation: fadeIn 0.15s ease;
        }
        .create-app-dialog {
          background: var(--bg-secondary, #161b22);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 12px;
          padding: 24px;
          width: 520px;
          max-width: 90vw;
          max-height: 90vh;
          overflow-y: auto;
          animation: slideUp 0.2s ease;
        }
        .create-app-dialog h2 {
          margin: 0 0 16px;
          font-size: 20px;
          font-weight: 600;
        }
        .create-app-field {
          margin-bottom: 16px;
        }
        .create-app-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 4px;
          color: var(--text-primary, #e6edf3);
        }
        .create-app-required {
          color: #f85149;
          margin-left: 2px;
        }
        .create-app-hint {
          margin: 0 0 8px;
          font-size: 12px;
          color: var(--text-secondary, #8b949e);
          line-height: 1.5;
        }
        .create-app-dir-row {
          display: flex;
          gap: 8px;
        }
        .create-app-dir-input {
          flex: 1;
          padding: 10px 12px;
          background: var(--bg-primary, #0d1117);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 8px;
          color: var(--text-primary, #e6edf3);
          font-size: 13px;
          font-family: 'Consolas', 'Monaco', monospace;
        }
        .create-app-dir-input:focus {
          outline: none;
          border-color: #7c3aed;
        }
        .create-app-dir-input.has-error {
          border-color: #f85149;
        }
        .create-app-browse-btn {
          padding: 8px 12px;
          background: var(--bg-tertiary, #21262d);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          flex-shrink: 0;
        }
        .create-app-browse-btn:hover {
          background: var(--bg-primary, #0d1117);
          border-color: #7c3aed;
        }
        .create-app-error {
          margin: 4px 0 0;
          font-size: 12px;
          color: #f85149;
        }
        .create-app-dialog textarea {
          width: 100%;
          padding: 12px;
          background: var(--bg-primary, #0d1117);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 8px;
          color: var(--text-primary, #e6edf3);
          font-size: 14px;
          line-height: 1.5;
          resize: vertical;
          font-family: inherit;
          box-sizing: border-box;
        }
        .create-app-dialog textarea:focus {
          outline: none;
          border-color: #7c3aed;
        }
        .create-app-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }
        .create-app-cancel {
          padding: 8px 16px;
          background: transparent;
          border: 1px solid var(--border-color, #30363d);
          border-radius: 6px;
          color: var(--text-primary, #e6edf3);
          cursor: pointer;
          font-size: 14px;
        }
        .create-app-cancel:hover {
          background: var(--bg-tertiary, #21262d);
        }
        .create-app-submit {
          padding: 8px 20px;
          background: linear-gradient(135deg, #7c3aed, #6d28d9);
          border: none;
          border-radius: 6px;
          color: #fff;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }
        .create-app-submit:hover:not(:disabled) {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        }
        .create-app-submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>

      <DirectoryBrowser
        isOpen={showDirBrowser}
        onClose={() => setShowDirBrowser(false)}
        onSelect={handleDirSelected}
        initialPath={workDir || undefined}
      />
    </div>
  );
}
