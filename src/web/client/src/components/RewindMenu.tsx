/**
 * RewindMenu - 消息回滚菜单组件
 *
 * 提供三个回滚选项：
 * 1. Fork conversation from here（只回滚对话）
 * 2. Rewind code to here（只回滚代码）
 * 3. Fork conversation and rewind code（同时回滚对话和代码）
 */

import { useState, useEffect, useRef } from 'react';
import styles from './RewindMenu.module.css';

export type RewindOption = 'code' | 'conversation' | 'both' | 'cancel';

export interface RewindMenuProps {
  /** 是否显示菜单 */
  visible: boolean;
  /** 菜单位置 */
  position: { x: number; y: number };
  /** 消息预览信息 */
  preview: {
    filesWillChange: string[];
    messagesWillRemove: number;
    insertions: number;
    deletions: number;
  };
  /** 选择回调 */
  onSelect: (option: RewindOption) => void;
  /** 取消回调 */
  onCancel: () => void;
}

export function RewindMenu({
  visible,
  position,
  preview,
  onSelect,
  onCancel,
}: RewindMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const options: Array<{ value: RewindOption; label: string; description: string; icon: string; disabled?: boolean }> = [
    {
      value: 'conversation',
      label: 'Delete this message',
      description: preview.messagesWillRemove > 1
        ? `Remove this and ${preview.messagesWillRemove - 1} more message${preview.messagesWillRemove > 2 ? 's' : ''}`
        : preview.messagesWillRemove === 1
        ? 'Remove this message'
        : 'No messages to remove',
      icon: '💬',
      disabled: preview.messagesWillRemove === 0,
    },
    {
      value: 'code',
      label: 'Rewind code before this',
      description: 'Restore files to before this message',
      icon: '📝',
      disabled: false, // 总是启用，由后端决定是否有文件可回滚
    },
    {
      value: 'both',
      label: 'Delete message and rewind code',
      description: preview.messagesWillRemove > 1
        ? `${preview.messagesWillRemove} messages + code changes`
        : 'This message + code changes',
      icon: '🔄',
      disabled: false, // 总是启用
    },
  ];

  const enabledOptions = options.filter(o => !o.disabled);

  // 键盘导航
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(enabledOptions.length - 1, prev + 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = enabledOptions[selectedIndex];
        if (selected) {
          onSelect(selected.value);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible, selectedIndex, enabledOptions, onSelect, onCancel]);

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };

    // 延迟添加监听器，避免立即触发
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [visible, onCancel]);

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className={styles.rewindMenu}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className={styles.menuHeader}>
        <span className={styles.menuTitle}>Rewind to this message</span>
      </div>

      {options.map((option, index) => {
        const enabledIndex = enabledOptions.findIndex(o => o.value === option.value);
        const isSelected = enabledIndex === selectedIndex && !option.disabled;
        const isDisabled = option.disabled;

        return (
          <button
            key={option.value}
            className={`${styles.menuOption} ${isSelected ? styles.selected : ''} ${isDisabled ? styles.disabled : ''}`}
            onClick={() => !isDisabled && onSelect(option.value)}
            onMouseEnter={() => !isDisabled && setSelectedIndex(enabledIndex)}
            disabled={isDisabled}
          >
            <span className={styles.optionIcon}>{option.icon}</span>
            <div className={styles.optionContent}>
              <div className={styles.optionLabel}>{option.label}</div>
              <div className={styles.optionDescription}>{option.description}</div>
            </div>
          </button>
        );
      })}

      <div className={styles.menuFooter}>
        <div className={styles.hint}>Press ESC to cancel</div>
      </div>
    </div>
  );
}

export default RewindMenu;
