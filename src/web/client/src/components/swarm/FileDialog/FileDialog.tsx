import { useState, useEffect, useRef, useCallback } from 'react';
import { useLanguage } from '../../../i18n';
import styles from './FileDialog.module.css';

/**
 * 对话框类型
 */
export type DialogType = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'openFolder';

/**
 * FileDialog 组件属性
 */
export interface FileDialogProps {
  /** 是否显示 */
  visible: boolean;
  /** 对话框类型 */
  type: DialogType;
  /** 初始值（重命名时使用） */
  initialValue?: string;
  /** 当前目录路径（用于显示完整路径预览） */
  currentPath?: string;
  /** 要删除的文件/文件夹名称 */
  targetName?: string;
  /** 确认回调 */
  onConfirm: (value: string) => void;
  /** 取消回调 */
  onCancel: () => void;
  /** 自定义验证函数 */
  validate?: (value: string) => string | null;
  /** 自定义类名 */
  className?: string;
}

/**
 * 获取对话框配置
 */
function getDialogConfig(type: DialogType, t: (key: string, params?: Record<string, string | number>) => string) {
  switch (type) {
    case 'newFile':
      return {
        title: t('fileDialog.newFile'),
        icon: '📄',
        label: t('fileDialog.fileName'),
        placeholder: t('fileDialog.fileNamePlaceholder'),
        confirmText: t('fileDialog.create'),
        hint: t('fileDialog.extensionHint'),
      };
    case 'newFolder':
      return {
        title: t('fileDialog.newFolder'),
        icon: '📁',
        label: t('fileDialog.folderName'),
        placeholder: t('fileDialog.folderNamePlaceholder'),
        confirmText: t('fileDialog.create'),
        hint: null,
      };
    case 'rename':
      return {
        title: t('fileDialog.rename'),
        icon: '✏️',
        label: t('fileDialog.newName'),
        placeholder: t('fileDialog.newNamePlaceholder'),
        confirmText: t('fileDialog.rename'),
        hint: null,
      };
    case 'delete':
      return {
        title: t('fileDialog.confirmDelete'),
        icon: '🗑️',
        label: null,
        placeholder: '',
        confirmText: t('fileDialog.delete'),
        hint: null,
      };
    case 'openFolder':
      return {
        title: t('fileDialog.openFolder'),
        icon: '📂',
        label: t('fileDialog.folderPath'),
        placeholder: t('fileDialog.folderPathPlaceholder'),
        confirmText: t('fileDialog.open'),
        hint: t('fileDialog.folderPathHint'),
      };
    default:
      return {
        title: t('fileDialog.input'),
        icon: '📝',
        label: t('fileDialog.name'),
        placeholder: t('fileDialog.inputPlaceholder'),
        confirmText: t('fileDialog.confirm'),
        hint: null,
      };
  }
}

/**
 * 默认文件名验证
 */
function defaultValidate(value: string, type: DialogType, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (type === 'delete') return null;

  if (!value.trim()) {
    return type === 'openFolder' ? t('fileDialog.pathEmpty') : t('fileDialog.nameEmpty');
  }

  // openFolder 类型使用不同的验证逻辑
  if (type === 'openFolder') {
    // 只检查是否为空和基本格式
    const trimmed = value.trim();
    // 检查是否像一个有效路径（包含盘符或以/开头）
    const isValidPath = /^([a-zA-Z]:[/\\]|\/|~\/)/.test(trimmed);
    if (!isValidPath) {
      return t('fileDialog.invalidPath');
    }
    return null;
  }

  // 检查非法字符
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(value)) {
    return t('fileDialog.invalidChars');
  }

  // 检查保留名称（Windows）
  const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  if (reservedNames.test(value.split('.')[0])) {
    return t('fileDialog.reservedName');
  }

  // 检查点开头（Unix 隐藏文件，允许但提示）
  // 不做限制，只是一个常见模式

  // 检查长度
  if (value.length > 255) {
    return t('fileDialog.nameTooLong');
  }

  return null;
}

/**
 * 文件/文件夹名称输入对话框
 *
 * 用于：
 * - 新建文件时输入文件名
 * - 新建文件夹时输入文件夹名
 * - 重命名时输入新名称
 * - 删除确认
 *
 * 功能：
 * - 标题（新建文件/新建文件夹/重命名）
 * - 输入框（带验证）
 * - 确认/取消按钮
 */
export default function FileDialog({
  visible,
  type,
  initialValue = '',
  currentPath,
  targetName,
  onConfirm,
  onCancel,
  validate,
  className = '',
}: FileDialogProps) {
  const { t } = useLanguage();
  // 输入值
  const [value, setValue] = useState(initialValue);
  // 错误消息
  const [error, setError] = useState<string | null>(null);
  // 输入框引用
  const inputRef = useRef<HTMLInputElement>(null);
  // 对话框配置
  const config = getDialogConfig(type, t);

  /**
   * 重置状态
   */
  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setError(null);
      // 延迟聚焦，确保动画完成
      setTimeout(() => {
        if (inputRef.current && type !== 'delete') {
          inputRef.current.focus();
          // 如果是重命名，选中不含扩展名的部分
          if (type === 'rename' && initialValue) {
            const dotIndex = initialValue.lastIndexOf('.');
            if (dotIndex > 0) {
              inputRef.current.setSelectionRange(0, dotIndex);
            } else {
              inputRef.current.select();
            }
          } else {
            inputRef.current.select();
          }
        }
      }, 50);
    }
  }, [visible, initialValue, type]);

  /**
   * 验证输入
   */
  const validateInput = useCallback(
    (val: string): boolean => {
      const customError = validate?.(val);
      if (customError) {
        setError(customError);
        return false;
      }

      const defaultError = defaultValidate(val, type, t);
      if (defaultError) {
        setError(defaultError);
        return false;
      }

      setError(null);
      return true;
    },
    [validate, type, t]
  );

  /**
   * 处理输入变化
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    // 实时验证
    if (error) {
      validateInput(newValue);
    }
  };

  /**
   * 处理确认
   */
  const handleConfirm = () => {
    if (type === 'delete') {
      onConfirm('');
      return;
    }

    if (validateInput(value)) {
      onConfirm(value.trim());
    }
  };

  /**
   * 处理键盘事件
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      onCancel();
    }
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

  // 计算完整路径预览
  const fullPath = currentPath
    ? type === 'delete'
      ? `${currentPath}/${targetName}`
      : value
        ? `${currentPath}/${value}`
        : currentPath
    : null;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div
        className={`${styles.dialog} ${styles[type]} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        {/* 头部 */}
        <div className={styles.header}>
          <div className={styles.title} id="dialog-title">
            <span className={styles.titleIcon}>{config.icon}</span>
            <span>{config.title}</span>
          </div>
          <button
            className={styles.closeButton}
            onClick={onCancel}
            aria-label={t('fileDialog.close')}
          >
            ✕
          </button>
        </div>

        {/* 内容 */}
        <div className={styles.content}>
          {type === 'delete' ? (
            // 删除确认内容
            <div>
              <p style={{ color: '#cccccc', marginBottom: 8 }}>
                {t('fileDialog.deleteConfirmPrefix')} <strong style={{ color: '#f14c4c' }}>{targetName}</strong> {t('fileDialog.deleteConfirmSuffix')}
              </p>
              <p style={{ color: '#858585', fontSize: 12 }}>
                {t('fileDialog.deleteWarning')}
              </p>
            </div>
          ) : (
            // 输入框内容
            <div className={styles.inputGroup}>
              {config.label && (
                <label className={styles.label} htmlFor="file-name-input">
                  {config.label}
                </label>
              )}
              <div className={styles.inputWrapper}>
                <input
                  ref={inputRef}
                  id="file-name-input"
                  type="text"
                  className={`${styles.input} ${error ? styles.error : ''}`}
                  value={value}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onBlur={() => validateInput(value)}
                  placeholder={config.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {error && (
                <div className={styles.errorMessage}>
                  <span className={styles.errorIcon}>⚠️</span>
                  <span>{error}</span>
                </div>
              )}
              {config.hint && !error && (
                <div className={styles.hint}>{config.hint}</div>
              )}
            </div>
          )}

          {/* 路径预览 */}
          {fullPath && (
            <div className={styles.pathPreview}>
              <span className={styles.pathPreviewLabel}>{t('fileDialog.pathLabel')}</span>
              <span>{fullPath}</span>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className={styles.footer}>
          <button
            className={`${styles.button} ${styles.cancelButton}`}
            onClick={onCancel}
          >
            {t('fileDialog.cancel')}
          </button>
          <button
            className={`${styles.button} ${type === 'delete' ? styles.dangerButton : styles.confirmButton}`}
            onClick={handleConfirm}
            disabled={type !== 'delete' && (!value.trim() || !!error)}
          >
            {config.confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
