/**
 * 目录浏览器组件
 * 
 * 通过后端 API 逐级浏览文件系统目录，返回选中的完整路径。
 * 解决浏览器 showDirectoryPicker 无法返回完整路径的问题。
 */

import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '../i18n';

interface DirectoryBrowserProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (fullPath: string) => void;
  initialPath?: string;
}

interface DirEntry {
  name: string;
  path: string;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

export function DirectoryBrowser({ isOpen, onClose, onSelect, initialPath }: DirectoryBrowserProps) {
  const { t } = useLanguage();
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualInput, setManualInput] = useState('');

  const browse = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/files/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(data.error || 'Failed to browse directory');
        return;
      }
      const data: BrowseResult = await res.json();
      setCurrentPath(data.current);
      setParentPath(data.parent);
      setDirs(data.dirs);
      setManualInput(data.current);
    } catch (err: any) {
      setError(err.message || 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      browse(initialPath || '');
    }
  }, [isOpen, initialPath, browse]);

  if (!isOpen) return null;

  const handleSelect = () => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  };

  const handleManualGo = () => {
    const trimmed = manualInput.trim();
    if (trimmed) {
      browse(trimmed);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleManualGo();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="dir-browser-overlay" onClick={onClose}>
      <div className="dir-browser-dialog" onClick={e => e.stopPropagation()}>
        <h3>{t('apps.selectDirectory') || 'Select Directory'}</h3>

        {/* Address bar */}
        <div className="dir-browser-address">
          <input
            type="text"
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('apps.enterPathPlaceholder') || 'Enter path and press Enter...'}
            className="dir-browser-address-input"
          />
          <button className="dir-browser-go-btn" onClick={handleManualGo}>
            Go
          </button>
        </div>

        {error && <p className="dir-browser-error">{error}</p>}

        {/* Current path display */}
        {currentPath && (
          <div className="dir-browser-current">
            {currentPath}
          </div>
        )}

        {/* Directory list */}
        <div className="dir-browser-list">
          {loading ? (
            <div className="dir-browser-loading">{t('common.loading') || 'Loading...'}</div>
          ) : (
            <>
              {parentPath !== null && (
                <div
                  className="dir-browser-item dir-browser-parent"
                  onClick={() => browse(parentPath)}
                >
                  ..
                </div>
              )}
              {dirs.length === 0 && !parentPath && (
                <div className="dir-browser-empty">{t('apps.noSubDirs') || 'No subdirectories'}</div>
              )}
              {dirs.map(dir => (
                <div
                  key={dir.path}
                  className="dir-browser-item"
                  onClick={() => browse(dir.path)}
                >
                  <span className="dir-browser-icon">📁</span>
                  {dir.name}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="dir-browser-actions">
          <button className="dir-browser-cancel" onClick={onClose}>
            {t('common.cancel') || 'Cancel'}
          </button>
          <button
            className="dir-browser-select"
            onClick={handleSelect}
            disabled={!currentPath}
          >
            {t('apps.selectThisDir') || 'Select This Directory'}
          </button>
        </div>
      </div>

      <style>{`
        .dir-browser-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10001;
          animation: fadeIn 0.15s ease;
          -webkit-app-region: no-drag;
        }
        .dir-browser-dialog {
          background: var(--bg-secondary, #161b22);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 12px;
          padding: 20px;
          width: 500px;
          max-width: 90vw;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          animation: slideUp 0.2s ease;
        }
        .dir-browser-dialog h3 {
          margin: 0 0 12px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #e6edf3);
        }
        .dir-browser-address {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
        }
        .dir-browser-address-input {
          flex: 1;
          padding: 8px 10px;
          background: var(--bg-primary, #0d1117);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 6px;
          color: var(--text-primary, #e6edf3);
          font-size: 12px;
          font-family: 'Consolas', 'Monaco', monospace;
        }
        .dir-browser-address-input:focus {
          outline: none;
          border-color: #7c3aed;
        }
        .dir-browser-go-btn {
          padding: 8px 12px;
          background: var(--bg-tertiary, #21262d);
          border: 1px solid var(--border-color, #30363d);
          border-radius: 6px;
          color: var(--text-primary, #e6edf3);
          cursor: pointer;
          font-size: 12px;
          flex-shrink: 0;
        }
        .dir-browser-go-btn:hover {
          border-color: #7c3aed;
        }
        .dir-browser-current {
          padding: 6px 10px;
          background: var(--bg-primary, #0d1117);
          border-radius: 4px;
          font-size: 11px;
          color: var(--text-secondary, #8b949e);
          font-family: 'Consolas', 'Monaco', monospace;
          margin-bottom: 8px;
          word-break: break-all;
        }
        .dir-browser-error {
          margin: 0 0 8px;
          padding: 6px 10px;
          background: rgba(248, 81, 73, 0.1);
          border: 1px solid rgba(248, 81, 73, 0.3);
          border-radius: 4px;
          font-size: 12px;
          color: #f85149;
        }
        .dir-browser-list {
          flex: 1;
          min-height: 200px;
          max-height: 350px;
          overflow-y: auto;
          border: 1px solid var(--border-color, #30363d);
          border-radius: 8px;
          background: var(--bg-primary, #0d1117);
        }
        .dir-browser-item {
          padding: 8px 12px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text-primary, #e6edf3);
          border-bottom: 1px solid var(--border-color, #30363d);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .dir-browser-item:last-child {
          border-bottom: none;
        }
        .dir-browser-item:hover {
          background: var(--bg-tertiary, #21262d);
        }
        .dir-browser-parent {
          font-weight: 500;
          color: var(--text-secondary, #8b949e);
        }
        .dir-browser-icon {
          flex-shrink: 0;
        }
        .dir-browser-loading,
        .dir-browser-empty {
          padding: 20px;
          text-align: center;
          color: var(--text-secondary, #8b949e);
          font-size: 13px;
        }
        .dir-browser-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 12px;
        }
        .dir-browser-cancel {
          padding: 8px 16px;
          background: transparent;
          border: 1px solid var(--border-color, #30363d);
          border-radius: 6px;
          color: var(--text-primary, #e6edf3);
          cursor: pointer;
          font-size: 13px;
        }
        .dir-browser-cancel:hover {
          background: var(--bg-tertiary, #21262d);
        }
        .dir-browser-select {
          padding: 8px 16px;
          background: linear-gradient(135deg, #7c3aed, #6d28d9);
          border: none;
          border-radius: 6px;
          color: #fff;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        }
        .dir-browser-select:hover:not(:disabled) {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
        }
        .dir-browser-select:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
