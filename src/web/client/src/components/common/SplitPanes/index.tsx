/**
 * 可调整大小的分割面板组件
 * 支持水平/垂直分割、拖动调整大小、折叠面板
 */
import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import styles from './SplitPanes.module.css';
import { useLanguage } from '../../../i18n';

// ============================================
// 类型定义
// ============================================

export interface PaneConfig {
  /** 面板唯一标识 */
  id: string;
  /** 面板内容 */
  content: ReactNode;
  /** 初始大小（px 或百分比字符串如 "25%"） */
  initialSize?: number | string;
  /** 最小大小 (px) */
  minSize?: number;
  /** 最大大小 (px) */
  maxSize?: number;
  /** 是否可折叠 */
  collapsible?: boolean;
  /** 折叠时显示的标题 */
  collapsedTitle?: string;
  /** 初始是否折叠 */
  defaultCollapsed?: boolean;
}

export interface SplitPanesProps {
  /** 面板配置数组 */
  panes: PaneConfig[];
  /** 分割方向 */
  direction?: 'horizontal' | 'vertical';
  /** 本地存储键名（用于记住用户偏好） */
  storageKey?: string;
  /** 面板大小变化回调 */
  onResize?: (sizes: number[]) => void;
  /** 面板折叠状态变化回调 */
  onCollapseChange?: (id: string, collapsed: boolean) => void;
  /** 自定义类名 */
  className?: string;
}

interface PaneState {
  size: number;
  collapsed: boolean;
}

// ============================================
// 辅助函数
// ============================================

/**
 * 解析初始大小，支持 px 和百分比
 */
function parseInitialSize(
  size: number | string | undefined,
  containerSize: number,
  defaultSize: number
): number {
  if (size === undefined) return defaultSize;
  if (typeof size === 'number') return size;
  if (size.endsWith('%')) {
    const percent = parseFloat(size) / 100;
    return Math.round(containerSize * percent);
  }
  return parseFloat(size) || defaultSize;
}

/**
 * 从 localStorage 加载状态
 */
function loadFromStorage(key: string): Record<string, PaneState> | null {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * 保存状态到 localStorage
 */
function saveToStorage(key: string, states: Record<string, PaneState>): void {
  try {
    localStorage.setItem(key, JSON.stringify(states));
  } catch {
    // 忽略存储错误
  }
}

// ============================================
// 主组件
// ============================================

export function SplitPanes({
  panes,
  direction = 'horizontal',
  storageKey,
  onResize,
  onCollapseChange,
  className,
}: SplitPanesProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const [paneStates, setPaneStates] = useState<Record<string, PaneState>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const [initialized, setInitialized] = useState(false);

  // 初始化面板状态
  useEffect(() => {
    if (!containerRef.current || initialized) return;

    const container = containerRef.current;
    const containerSize = direction === 'horizontal'
      ? container.offsetWidth
      : container.offsetHeight;

    // 尝试从存储加载
    const savedStates = storageKey ? loadFromStorage(storageKey) : null;

    const defaultSize = Math.floor(containerSize / panes.length);
    const newStates: Record<string, PaneState> = {};

    panes.forEach((pane) => {
      if (savedStates?.[pane.id]) {
        newStates[pane.id] = savedStates[pane.id];
      } else {
        newStates[pane.id] = {
          size: parseInitialSize(pane.initialSize, containerSize, defaultSize),
          collapsed: pane.defaultCollapsed ?? false,
        };
      }
    });

    setPaneStates(newStates);
    setInitialized(true);
  }, [panes, direction, storageKey, initialized]);

  // 保存状态到存储
  useEffect(() => {
    if (storageKey && initialized && Object.keys(paneStates).length > 0) {
      saveToStorage(storageKey, paneStates);
    }
  }, [paneStates, storageKey, initialized]);

  // 处理拖动开始
  const handleDragStart = useCallback((index: number) => {
    setDragging(index);
  }, []);

  // 处理拖动
  const handleDrag = useCallback(
    (e: MouseEvent) => {
      if (dragging === null || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const isHorizontal = direction === 'horizontal';

      // 计算鼠标相对于容器的位置
      const mousePos = isHorizontal
        ? e.clientX - rect.left
        : e.clientY - rect.top;

      // 获取当前面板和下一个面板
      const currentPane = panes[dragging];
      const nextPane = panes[dragging + 1];
      if (!currentPane || !nextPane) return;

      const currentState = paneStates[currentPane.id];
      const nextState = paneStates[nextPane.id];
      if (!currentState || !nextState) return;

      // 计算分隔条之前所有面板的总大小
      let beforeSize = 0;
      for (let i = 0; i < dragging; i++) {
        const pane = panes[i];
        const state = paneStates[pane.id];
        if (state && !state.collapsed) {
          beforeSize += state.size;
        }
        // 加上分隔条宽度
        beforeSize += 1;
      }

      // 计算新大小
      const newCurrentSize = mousePos - beforeSize;
      const totalAvailable = currentState.size + nextState.size;
      const newNextSize = totalAvailable - newCurrentSize;

      // 应用最小/最大限制
      const currentMin = currentPane.minSize ?? 50;
      const currentMax = currentPane.maxSize ?? Infinity;
      const nextMin = nextPane.minSize ?? 50;
      const nextMax = nextPane.maxSize ?? Infinity;

      // 检查约束
      if (
        newCurrentSize >= currentMin &&
        newCurrentSize <= currentMax &&
        newNextSize >= nextMin &&
        newNextSize <= nextMax
      ) {
        setPaneStates((prev) => ({
          ...prev,
          [currentPane.id]: { ...prev[currentPane.id], size: newCurrentSize },
          [nextPane.id]: { ...prev[nextPane.id], size: newNextSize },
        }));
      }
    },
    [dragging, direction, panes, paneStates]
  );

  // 处理拖动结束
  const handleDragEnd = useCallback(() => {
    if (dragging !== null) {
      setDragging(null);
      // 触发回调
      if (onResize) {
        const sizes = panes.map((p) => paneStates[p.id]?.size ?? 0);
        onResize(sizes);
      }
    }
  }, [dragging, panes, paneStates, onResize]);

  // 绑定全局鼠标事件
  useEffect(() => {
    if (dragging !== null) {
      window.addEventListener('mousemove', handleDrag);
      window.addEventListener('mouseup', handleDragEnd);
      return () => {
        window.removeEventListener('mousemove', handleDrag);
        window.removeEventListener('mouseup', handleDragEnd);
      };
    }
  }, [dragging, handleDrag, handleDragEnd]);

  // 切换折叠状态
  const toggleCollapse = useCallback(
    (id: string) => {
      setPaneStates((prev) => {
        const newCollapsed = !prev[id]?.collapsed;
        onCollapseChange?.(id, newCollapsed);
        return {
          ...prev,
          [id]: { ...prev[id], collapsed: newCollapsed },
        };
      });
    },
    [onCollapseChange]
  );

  // 渲染面板
  const renderPane = (pane: PaneConfig, index: number) => {
    const state = paneStates[pane.id];
    const isCollapsed = state?.collapsed ?? false;
    const size = state?.size ?? 200;

    const isFirst = index === 0;
    const isLast = index === panes.length - 1;

    const style: React.CSSProperties = isCollapsed
      ? {}
      : direction === 'horizontal'
      ? { flexBasis: `${size}px`, width: `${size}px`, flexGrow: 0, flexShrink: 0 }
      : { flexBasis: `${size}px`, height: `${size}px`, flexGrow: 0, flexShrink: 0 };

    // 中间面板使用 flex: 1
    const isMiddle = !isFirst && !isLast;
    if (isMiddle && !isCollapsed) {
      style.flexGrow = 1;
      style.flexShrink = 1;
      style.flexBasis = 'auto';
      if (direction === 'horizontal') {
        delete style.width;
      } else {
        delete style.height;
      }
    }

    return (
      <div
        key={pane.id}
        className={`${styles.pane} ${isCollapsed ? styles.collapsed : ''}`}
        style={style}
      >
        {isCollapsed ? (
          // 折叠状态显示展开按钮
          <button
            className={styles.collapseToggle}
            onClick={() => toggleCollapse(pane.id)}
            title={t('splitPanes.expand', { name: pane.collapsedTitle || '' })}
          >
            <span className={styles.collapseIcon}>
              {direction === 'horizontal'
                ? isFirst ? '▶' : '◀'
                : isFirst ? '▼' : '▲'}
            </span>
            {pane.collapsedTitle && (
              <span className={styles.collapsedTitle}>{pane.collapsedTitle}</span>
            )}
          </button>
        ) : (
          <>
            {/* 折叠按钮 */}
            {pane.collapsible && (
              <button
                className={styles.collapseToggle}
                onClick={() => toggleCollapse(pane.id)}
                title={t('splitPanes.collapse', { name: pane.collapsedTitle || '' })}
              >
                <span className={styles.collapseIcon}>
                  {direction === 'horizontal'
                    ? isFirst ? '◀' : '▶'
                    : isFirst ? '▲' : '▼'}
                </span>
              </button>
            )}
            {/* 面板内容 */}
            <div className={styles.paneContent}>{pane.content}</div>
          </>
        )}
      </div>
    );
  };

  // 渲染分隔条
  const renderResizer = (index: number) => {
    const currentPane = panes[index];
    const nextPane = panes[index + 1];
    const currentCollapsed = paneStates[currentPane?.id]?.collapsed;
    const nextCollapsed = paneStates[nextPane?.id]?.collapsed;

    // 如果相邻面板都折叠了，不显示分隔条
    if (currentCollapsed && nextCollapsed) return null;

    return (
      <div
        key={`resizer-${index}`}
        className={`${styles.resizer} ${dragging === index ? styles.dragging : ''}`}
        onMouseDown={() => handleDragStart(index)}
      />
    );
  };

  // 构建渲染内容
  const elements: ReactNode[] = [];
  panes.forEach((pane, index) => {
    elements.push(renderPane(pane, index));
    if (index < panes.length - 1) {
      elements.push(renderResizer(index));
    }
  });

  return (
    <div
      ref={containerRef}
      className={`${styles.splitContainer} ${styles[direction]} ${
        dragging !== null ? styles.dragging : ''
      } ${className || ''}`}
    >
      {initialized && elements}
      {/* 拖动时的遮罩层 */}
      {dragging !== null && <div className={styles.dragOverlay} />}
    </div>
  );
}

export default SplitPanes;
