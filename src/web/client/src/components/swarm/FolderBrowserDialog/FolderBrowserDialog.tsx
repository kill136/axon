import { useState, useEffect, useCallback, useRef } from 'react';
import { useLanguage } from '../../../i18n';
import styles from './FolderBrowserDialog.module.css';

/**
 * 目录信息接口
 */
export interface DirInfo {
  name: string;
  path: string;
}

/**
 * 目录数据接口
 */
export interface DirData {
  currentPath: string;
  parentPath: string | null;
  dirs: DirInfo[];
}

/**
 * FolderBrowserDialog 组件属性
 */
export interface FolderBrowserDialogProps {
  /** 是否显示 */
  visible: boolean;
  /** 确认回调（返回选中的路径） */
  onConfirm: (path: string) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 初始路径 */
  initialPath?: string;
}

/**
 * 文件夹浏览器对话框组件
 * 
 * 用于在系统原生对话框不可用时，提供 Web 端的目录浏览功能
 * 
 * 功能：
 * - 地址栏：显示当前路径，可手动编辑
 * - 目录列表：显示当前路径下的所有子目录
 * - 导航按钮：返回上级目录
 * - 底部操作栏：确认和取消按钮
 * - 加载状态和错误提示
 */
export default function FolderBrowserDialog({
  visible,
  onConfirm,
  onCancel,
  initialPath,
}: FolderBrowserDialogProps) {
  const { t } = useLanguage();
  // 当前路径
  const [currentPath, setCurrentPath] = useState<string>('');
  // 父目录路径
  const [parentPath, setParentPath] = useState<string | null>(null);
  // 目录列表
  const [dirs, setDirs] = useState<DirInfo[]>([]);
  // 加载状态
  const [loading, setLoading] = useState<boolean>(false);
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 地址栏输入值
  const [pathInput, setPathInput] = useState<string>('');
  // 地址栏引用
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * 加载指定路径的目录列表
   */
  const loadDir = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/blueprint/projects/list-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || t('folderBrowser.loadDirFailed'));
      }

      const data: DirData = result.data;
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setDirs(data.dirs);
      setPathInput(data.currentPath);
    } catch (err: any) {
      console.error('[FolderBrowserDialog] 加载目录失败:', err);
      setError(err.message || t('folderBrowser.loadDirFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 初始化：加载初始路径
   */
  useEffect(() => {
    if (visible) {
      loadDir(initialPath);
    }
  }, [visible, initialPath, loadDir]);

  /**
   * 进入子目录
   */
  const handleEnterDir = (dirPath: string) => {
    loadDir(dirPath);
  };

  /**
   * 返回上级目录
   */
  const handleGoUp = () => {
    if (parentPath) {
      loadDir(parentPath);
    }
  };

  /**
   * 地址栏回车跳转
   */
  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) {
      loadDir(pathInput.trim());
    }
  };

  /**
   * 确认选择当前文件夹
   */
  const handleConfirm = () => {
    if (currentPath) {
      onConfirm(currentPath);
    }
  };

  /**
   * 取消
   */
  const handleCancel = () => {
    onCancel();
  };

  /**
   * 阻止遮罩层事件冒泡
   */
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  /**
   * 全局键盘事件
   */
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && visible) {
        onCancel();
      }
    };

    if (visible) {
      document.addEventListener('keydown', handleGlobalKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [visible, onCancel]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-browser-title"
      >
        {/* 头部 */}
        <div className={styles.header}>
          <div className={styles.title} id="folder-browser-title">
            <span className={styles.titleIcon}>📂</span>
            <span>{t('folderBrowser.selectFolder')}</span>
          </div>
          <button
            className={styles.closeButton}
            onClick={handleCancel}
            aria-label={t('folderBrowser.close')}
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className={styles.content}>
          {/* 导航栏 */}
          <div className={styles.navbar}>
            <button
              className={styles.navButton}
              onClick={handleGoUp}
              disabled={!parentPath || loading}
              title={t('folderBrowser.goUpTitle')}
            >
              ⬆️ {t('folderBrowser.goUp')}
            </button>

            {/* 地址栏 */}
            <form className={styles.pathForm} onSubmit={handlePathSubmit}>
              <input
                ref={inputRef}
                type="text"
                className={styles.pathInput}
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                placeholder={t('folderBrowser.pathPlaceholder')}
                disabled={loading}
              />
            </form>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className={styles.errorBanner}>
              <span className={styles.errorIcon}>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* 目录列表 */}
          <div className={styles.dirList}>
            {loading ? (
              <div className={styles.loadingState}>
                <div className={styles.spinner}></div>
                <span>{t('folderBrowser.loading')}</span>
              </div>
            ) : dirs.length === 0 ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>📁</span>
                <span>{t('folderBrowser.noSubfolders')}</span>
              </div>
            ) : (
              dirs.map((dir) => (
                <div
                  key={dir.path}
                  className={styles.dirItem}
                  onClick={() => handleEnterDir(dir.path)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleEnterDir(dir.path);
                    }
                  }}
                >
                  <span className={styles.dirIcon}>📁</span>
                  <span className={styles.dirName}>{dir.name}</span>
                </div>
              ))
            )}
          </div>

          {/* 当前路径显示 */}
          {currentPath && (
            <div className={styles.currentPathDisplay}>
              <span className={styles.currentPathLabel}>{t('folderBrowser.currentPath')}</span>
              <span className={styles.currentPathValue}>{currentPath}</span>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <button
            className={`${styles.button} ${styles.cancelButton}`}
            onClick={handleCancel}
          >
            {t('folderBrowser.cancel')}
          </button>
          <button
            className={`${styles.button} ${styles.confirmButton}`}
            onClick={handleConfirm}
            disabled={!currentPath || loading}
          >
            {t('folderBrowser.selectThisFolder')}
          </button>
        </div>
      </div>
    </div>
  );
}
