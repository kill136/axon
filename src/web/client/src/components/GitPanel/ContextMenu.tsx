/**
 * ContextMenu - 通用右键菜单组件
 * 支持自定义菜单项，通过 portal 渲染到 body
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export function ContextMenu({ items, x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // 延迟添加监听器，避免立即触发
    setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // 调整菜单位置，确保不超出视口
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      // 右侧超出
      if (x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }

      // 底部超出
      if (y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      menuRef.current.style.left = `${adjustedX}px`;
      menuRef.current.style.top = `${adjustedY}px`;
    }
  }, [x, y]);

  const handleItemClick = (item: ContextMenuItem) => {
    if (!item.disabled) {
      item.onClick();
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="git-context-menu"
      style={{ left: x, top: y }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={`git-context-menu-item ${item.disabled ? 'git-context-menu-item--disabled' : ''} ${
            item.danger ? 'git-context-menu-item--danger' : ''
          }`}
          onClick={() => handleItemClick(item)}
        >
          {item.icon && <span className="git-context-menu-item-icon">{item.icon}</span>}
          <span className="git-context-menu-item-label">{item.label}</span>
        </div>
      ))}
    </div>,
    document.body
  );
}
