import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { OutlineSymbol, OutlineSymbolKind } from '../../hooks/useOutlineSymbols';
import styles from './FileTree.module.css';

/**
 * 文件树节点类型
 */
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

/**
 * 右键菜单项接口
 */
interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

/**
 * FileTree 组件 Props
 */
interface FileTreeProps {
  projectPath: string;
  projectName?: string;
  currentFile?: string;
  onFileSelect: (filePath: string) => void;
  outlineSymbols?: OutlineSymbol[];
  cursorLine?: number;
  onSymbolClick?: (line: number) => void;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 将树结构扁平化为可见节点列表（仅展开的目录下的子节点可见）
 */
function flattenVisibleNodes(
  node: FileTreeNode,
  expandedDirs: Set<string>,
  level: number = 0,
): { node: FileTreeNode; level: number }[] {
  const result: { node: FileTreeNode; level: number }[] = [];
  result.push({ node, level });

  if (node.type === 'directory' && expandedDirs.has(node.path) && node.children) {
    for (const child of node.children) {
      result.push(...flattenVisibleNodes(child, expandedDirs, level + 1));
    }
  }
  return result;
}

/**
 * 检查 path 是否是 parentPath 的子路径
 */
function isDescendantOf(path: string, parentPath: string): boolean {
  return path.startsWith(parentPath + '/');
}

/**
 * 获取节点的父目录路径
 */
function getParentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx > 0 ? path.substring(0, idx) : '.';
}

// ============================================================================
// 文件类型图标组件
// ============================================================================

const FileIcon: React.FC<{ fileName: string }> = ({ fileName }) => {
  const ext = fileName.split('.').pop()?.toLowerCase();

  if (ext === 'ts' || ext === 'tsx') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="#3178c6" strokeWidth="1.5" fill="none"/>
        <text x="8" y="11" fontSize="7" fill="#3178c6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">TS</text>
      </svg>
    );
  }

  if (ext === 'js' || ext === 'jsx') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="#f7df1e" strokeWidth="1.5" fill="none"/>
        <text x="8" y="11" fontSize="7" fill="#f7df1e" textAnchor="middle" fontFamily="monospace" fontWeight="bold">JS</text>
      </svg>
    );
  }

  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="#2965f1" strokeWidth="1.5" fill="none"/>
        <path d="M5 7h6M5 9h6" stroke="#2965f1" strokeWidth="1"/>
      </svg>
    );
  }

  if (ext === 'json') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M5 4h6M5 8h6M5 12h4" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 3v10M12 3v10" stroke="#f59e0b" strokeWidth="1.5"/>
      </svg>
    );
  }

  if (ext === 'md' || ext === 'markdown') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 5l2 2l2-2M3 9l2 2l2-2" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 6h4M9 10h4" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 2h5l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    </svg>
  );
};

/**
 * 文件夹图标组件
 */
const FolderIcon: React.FC<{ isOpen: boolean }> = ({ isOpen }) => {
  if (isOpen) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M2 5h12v7a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" fill="rgba(99,102,241,0.15)" stroke="#6366f1" strokeWidth="1.5"/>
        <path d="M2 4h4l1-1h6a1 1 0 011 1v1H2V4z" fill="rgba(99,102,241,0.15)" stroke="#6366f1" strokeWidth="1.5"/>
      </svg>
    );
  }

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 4h4l1-1h6a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
    </svg>
  );
};

/**
 * 展开/折叠箭头图标
 */
const ChevronIcon: React.FC<{ isOpen: boolean }> = ({ isOpen }) => {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      style={{
        transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s ease'
      }}
    >
      <path d="M4 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// ============================================================================
// 右键菜单组件
// ============================================================================

const ContextMenu: React.FC<{
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const adjustedPosition = useMemo(() => {
    const menuWidth = 220;
    const menuHeight = items.length * 28 + 8;
    
    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > window.innerWidth) {
      adjustedX = window.innerWidth - menuWidth - 4;
    }

    if (y + menuHeight > window.innerHeight) {
      adjustedY = window.innerHeight - menuHeight - 4;
    }

    return { x: adjustedX, y: adjustedY };
  }, [x, y, items.length]);

  return (
    <>
      <div className={styles.contextMenuOverlay} onClick={onClose} />
      <div
        ref={menuRef}
        className={styles.contextMenu}
        style={{
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
        }}
      >
        {items.map((item, index) => {
          if (item.divider) {
            return <div key={`divider-${index}`} className={styles.contextMenuSeparator} />;
          }

          return (
            <div
              key={`${item.label}-${index}`}
              className={`${styles.contextMenuItem} ${item.disabled ? styles.disabled : ''}`}
              onClick={() => {
                if (!item.disabled && item.onClick) {
                  item.onClick();
                  onClose();
                }
              }}
            >
              <span className={styles.menuLabel}>{item.label}</span>
              {item.shortcut && (
                <span className={styles.contextMenuShortcut}>{item.shortcut}</span>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

// ============================================================================
// 符号类型图标配置
// ============================================================================

const symbolKindConfig: Record<OutlineSymbolKind, { letter: string; color: string; bg: string }> = {
  import:    { letter: 'I',  color: '#8b949e', bg: 'rgba(139,148,158,0.15)' },
  class:     { letter: 'C',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  interface: { letter: 'I',  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  type:      { letter: 'T',  color: '#06b6d4', bg: 'rgba(6,182,212,0.15)' },
  enum:      { letter: 'E',  color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
  function:  { letter: 'F',  color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  method:    { letter: 'M',  color: '#c084fc', bg: 'rgba(192,132,252,0.15)' },
  property:  { letter: 'P',  color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  constant:  { letter: 'K',  color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  component: { letter: 'R',  color: '#22d3ee', bg: 'rgba(34,211,238,0.15)' },
  variable:  { letter: 'V',  color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
};

const SymbolKindIcon: React.FC<{ kind: OutlineSymbolKind }> = ({ kind }) => {
  const cfg = symbolKindConfig[kind] || symbolKindConfig.variable;
  return (
    <span
      className={styles.symbolKindIcon}
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      {cfg.letter}
    </span>
  );
};

// ============================================================================
// 找到当前光标所在的最深符号 key
// ============================================================================

function findActiveSymbolKey(symbols: OutlineSymbol[], cursorLine: number): string | null {
  let activeKey: string | null = null;

  function walk(syms: OutlineSymbol[]) {
    for (const sym of syms) {
      const start = sym.line;
      const end = sym.endLine ?? sym.line;
      if (cursorLine >= start && cursorLine <= end) {
        activeKey = `${sym.kind}:${sym.name}:${sym.line}`;
        if (sym.children) walk(sym.children);
      }
    }
  }

  walk(symbols);
  return activeKey;
}

// ============================================================================
// 符号树节点组件
// ============================================================================

const SymbolTreeNode: React.FC<{
  symbol: OutlineSymbol;
  level: number;
  activeSymbolKey: string | null;
  expandedSymbols: Set<string>;
  onToggleSymbol: (key: string) => void;
  onSymbolClick: (line: number) => void;
}> = ({ symbol, level, activeSymbolKey, expandedSymbols, onToggleSymbol, onSymbolClick }) => {
  const nodeKey = `${symbol.kind}:${symbol.name}:${symbol.line}`;
  const hasChildren = symbol.children && symbol.children.length > 0;
  const isExpanded = expandedSymbols.has(nodeKey);
  const isActive = activeSymbolKey === nodeKey;
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive && nodeRef.current) {
      nodeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isActive]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSymbolClick(symbol.line);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSymbol(nodeKey);
  };

  return (
    <>
      <div
        ref={nodeRef}
        className={`${styles.treeNode} ${styles.symbolNode} ${isActive ? styles.symbolActive : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {hasChildren ? (
          <span className={styles.chevron} onClick={handleChevronClick}>
            <ChevronIcon isOpen={isExpanded} />
          </span>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        <span className={styles.icon}>
          <SymbolKindIcon kind={symbol.kind} />
        </span>

        <span className={styles.symbolName}>{symbol.name}</span>

        {symbol.detail && (
          <span className={styles.symbolDetail} title={symbol.detail}>
            {symbol.detail}
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <div className={styles.children}>
          {symbol.children!.map((child) => (
            <SymbolTreeNode
              key={`${child.kind}:${child.name}:${child.line}`}
              symbol={child}
              level={level + 1}
              activeSymbolKey={activeSymbolKey}
              expandedSymbols={expandedSymbols}
              onToggleSymbol={onToggleSymbol}
              onSymbolClick={onSymbolClick}
            />
          ))}
        </div>
      )}
    </>
  );
};

// ============================================================================
// 文件树节点组件
// ============================================================================

const TreeNode: React.FC<{
  node: FileTreeNode;
  level: number;
  currentFile?: string;
  onFileSelect: (filePath: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  // 符号相关
  outlineSymbols?: OutlineSymbol[];
  symbolsExpanded: boolean;
  onToggleSymbols: () => void;
  activeSymbolKey: string | null;
  expandedSymbols: Set<string>;
  onToggleSymbol: (key: string) => void;
  onSymbolClick?: (line: number) => void;
  // 右键菜单
  onContextMenu?: (e: React.MouseEvent, node: FileTreeNode) => void;
  clipboard?: { node: FileTreeNode; nodes: FileTreeNode[]; operation: 'cut' | 'copy' } | null;
  // 内联编辑
  inlineEdit?: { path: string; type: 'rename' | 'newFile' | 'newFolder'; parentPath?: string; initialValue?: string } | null;
  onInlineEditSubmit?: (value: string) => void;
  onInlineEditCancel?: () => void;
  // 多选
  selectedPaths: Set<string>;
  focusedPath: string | null;
  onNodeClick: (e: React.MouseEvent, node: FileTreeNode) => void;
  // 拖拽
  dragState: { dragging: boolean; sourcePaths: Set<string>; overPath: string | null };
  onDragStart: (e: React.DragEvent, node: FileTreeNode) => void;
  onDragOver: (e: React.DragEvent, node: FileTreeNode) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, node: FileTreeNode) => void;
  onDragEnd: () => void;
}> = ({
  node, level, currentFile, onFileSelect, expandedDirs, onToggleDir,
  outlineSymbols, symbolsExpanded, onToggleSymbols, activeSymbolKey,
  expandedSymbols, onToggleSymbol, onSymbolClick, onContextMenu, clipboard,
  inlineEdit, onInlineEditSubmit, onInlineEditCancel,
  selectedPaths, focusedPath, onNodeClick,
  dragState, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}) => {
  const isDirectory = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isCurrentFile = currentFile === node.path;
  const isSelected = selectedPaths.has(node.path);
  const isFocused = focusedPath === node.path;
  const hasSymbols = isCurrentFile && outlineSymbols && outlineSymbols.length > 0;
  const isCut = clipboard?.operation === 'cut' && clipboard.nodes.some(n => n.path === node.path);
  const isDragOver = dragState.overPath === node.path && isDirectory;
  const isDragSource = dragState.dragging && dragState.sourcePaths.has(node.path);

  const handleClick = (e: React.MouseEvent) => {
    onNodeClick(e, node);
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDirectory) {
      onToggleDir(node.path);
    } else if (hasSymbols) {
      onToggleSymbols();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onContextMenu) {
      onContextMenu(e, node);
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    onDragStart(e, node);
  };

  const handleDragOver = (e: React.DragEvent) => {
    onDragOver(e, node);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    onDragLeave(e);
  };

  const handleDrop = (e: React.DragEvent) => {
    onDrop(e, node);
  };

  const nodeClasses = [
    styles.treeNode,
    isCurrentFile ? styles.currentFile : '',
    isSelected ? styles.multiSelected : '',
    isFocused ? styles.focused : '',
    isCut ? styles.cutNode : '',
    isDragOver ? styles.dragOver : '',
    isDragSource ? styles.dragging : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div
        data-path={node.path}
        className={nodeClasses}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onDragEnd={onDragEnd}
      >
        {(isDirectory || hasSymbols) ? (
          <span className={styles.chevron} onClick={handleChevronClick}>
            <ChevronIcon isOpen={isDirectory ? isExpanded : symbolsExpanded} />
          </span>
        ) : (
          <span className={styles.chevronPlaceholder} />
        )}

        <span className={styles.icon}>
          {isDirectory ? (
            <FolderIcon isOpen={isExpanded} />
          ) : (
            <FileIcon fileName={node.name} />
          )}
        </span>

        {inlineEdit?.path === node.path && inlineEdit.type === 'rename' ? (
          <input
            className={styles.inlineInput}
            defaultValue={inlineEdit.initialValue || node.name}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onInlineEditSubmit?.(e.currentTarget.value);
              } else if (e.key === 'Escape') {
                onInlineEditCancel?.();
              }
            }}
            onBlur={() => onInlineEditCancel?.()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.name}>{node.name}</span>
        )}

        {hasSymbols && (
          <span className={styles.symbolCount}>{outlineSymbols!.length}</span>
        )}
      </div>

      {/* 目录子节点 */}
      {isDirectory && isExpanded && node.children && (
        <div className={styles.children}>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              level={level + 1}
              currentFile={currentFile}
              onFileSelect={onFileSelect}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              outlineSymbols={outlineSymbols}
              symbolsExpanded={symbolsExpanded}
              onToggleSymbols={onToggleSymbols}
              activeSymbolKey={activeSymbolKey}
              expandedSymbols={expandedSymbols}
              onToggleSymbol={onToggleSymbol}
              onSymbolClick={onSymbolClick}
              onContextMenu={onContextMenu}
              clipboard={clipboard}
              inlineEdit={inlineEdit}
              onInlineEditSubmit={onInlineEditSubmit}
              onInlineEditCancel={onInlineEditCancel}
              selectedPaths={selectedPaths}
              focusedPath={focusedPath}
              onNodeClick={onNodeClick}
              dragState={dragState}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}

      {/* 文件符号子节点 */}
      {hasSymbols && symbolsExpanded && onSymbolClick && (
        <div className={styles.children}>
          {outlineSymbols!.map((sym) => (
            <SymbolTreeNode
              key={`${sym.kind}:${sym.name}:${sym.line}`}
              symbol={sym}
              level={level + 1}
              activeSymbolKey={activeSymbolKey}
              expandedSymbols={expandedSymbols}
              onToggleSymbol={onToggleSymbol}
              onSymbolClick={onSymbolClick}
            />
          ))}
        </div>
      )}
    </>
  );
};

/**
 * FileTree 组件
 * 支持多选、键盘导航、拖拽移动、批量操作
 */
export const FileTree: React.FC<FileTreeProps> = ({
  projectPath,
  projectName,
  currentFile,
  onFileSelect,
  outlineSymbols,
  cursorLine,
  onSymbolClick,
}) => {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));

  // 符号展开状态
  const [symbolsExpanded, setSymbolsExpanded] = useState(true);
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const prevSymbolsRef = useRef<OutlineSymbol[]>([]);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetNode: FileTreeNode | null;
    targetType: 'file' | 'directory' | 'blank';
  } | null>(null);

  // 剪贴板状态（支持多文件）
  const [clipboard, setClipboard] = useState<{
    node: FileTreeNode;
    nodes: FileTreeNode[];
    operation: 'cut' | 'copy';
  } | null>(null);

  // 内联编辑状态
  const [inlineEdit, setInlineEdit] = useState<{
    path: string;
    type: 'rename' | 'newFile' | 'newFolder';
    parentPath?: string;
    initialValue?: string;
  } | null>(null);

  // ==================== 多选状态 ====================
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [lastClickedPath, setLastClickedPath] = useState<string | null>(null);

  // ==================== 拖拽状态 ====================
  const [dragState, setDragState] = useState<{
    dragging: boolean;
    sourcePaths: Set<string>;
    overPath: string | null;
  }>({ dragging: false, sourcePaths: new Set(), overPath: null });
  const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Container ref（用于焦点和键盘事件）
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // 扁平化的可见节点列表
  const flatNodes = useMemo(() => {
    if (!tree) return [];
    return flattenVisibleNodes(tree, expandedDirs);
  }, [tree, expandedDirs]);

  // 所有可见节点的 path 到 FileTreeNode 映射
  const nodeByPath = useMemo(() => {
    const map = new Map<string, FileTreeNode>();
    for (const { node } of flatNodes) {
      map.set(node.path, node);
    }
    return map;
  }, [flatNodes]);

  // 当 symbols 变化时，重置默认展开状态
  useEffect(() => {
    if (outlineSymbols && outlineSymbols !== prevSymbolsRef.current) {
      prevSymbolsRef.current = outlineSymbols;
      setSymbolsExpanded(true);
      const defaultExpanded = new Set<string>();
      for (const sym of outlineSymbols) {
        if (sym.children && sym.children.length > 0 && sym.kind !== 'import') {
          defaultExpanded.add(`${sym.kind}:${sym.name}:${sym.line}`);
        }
      }
      setExpandedSymbols(defaultExpanded);
    }
  }, [outlineSymbols]);

  // 当前活跃符号
  const activeSymbolKey = useMemo(() => {
    if (!outlineSymbols || !cursorLine) return null;
    return findActiveSymbolKey(outlineSymbols, cursorLine);
  }, [outlineSymbols, cursorLine]);

  const handleToggleSymbols = () => {
    setSymbolsExpanded(prev => !prev);
  };

  const handleToggleSymbol = (key: string) => {
    setExpandedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // ==================== 加载文件树 ====================

  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/files/tree?root=${encodeURIComponent(projectPath)}&path=.&depth=3`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '加载文件树失败');
      }
      const data = await response.json();
      setTree(data);
    } catch (err) {
      console.error('[FileTree] 加载失败:', err);
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // 切换目录展开/折叠
  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // ==================== 节点点击处理（多选逻辑） ====================

  const handleNodeClick = useCallback((e: React.MouseEvent, node: FileTreeNode) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isCtrl) {
      // Ctrl+Click: 切换选中状态
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return next;
      });
      setFocusedPath(node.path);
      setLastClickedPath(node.path);
    } else if (isShift && lastClickedPath) {
      // Shift+Click: 范围选择
      const startIdx = flatNodes.findIndex(n => n.node.path === lastClickedPath);
      const endIdx = flatNodes.findIndex(n => n.node.path === node.path);

      if (startIdx !== -1 && endIdx !== -1) {
        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        const rangePaths = new Set<string>();
        for (let i = minIdx; i <= maxIdx; i++) {
          rangePaths.add(flatNodes[i].node.path);
        }
        setSelectedPaths(rangePaths);
      }
      setFocusedPath(node.path);
    } else {
      // 普通点击：清除多选，选中当前
      setSelectedPaths(new Set([node.path]));
      setFocusedPath(node.path);
      setLastClickedPath(node.path);

      // 原有的文件打开/目录切换逻辑
      if (node.type === 'directory') {
        handleToggleDir(node.path);
      } else {
        onFileSelect(node.path);
        // 如果已经是当前文件，切换符号展开状态
        if (currentFile === node.path && outlineSymbols && outlineSymbols.length > 0) {
          handleToggleSymbols();
        }
      }
    }
  }, [flatNodes, lastClickedPath, currentFile, outlineSymbols, onFileSelect, handleToggleDir]);

  // ==================== 键盘导航 ====================

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 如果正在内联编辑，不处理快捷键
    if (inlineEdit) return;

    const currentIdx = focusedPath ? flatNodes.findIndex(n => n.node.path === focusedPath) : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIdx = currentIdx < flatNodes.length - 1 ? currentIdx + 1 : 0;
        const nextNode = flatNodes[nextIdx];
        if (nextNode) {
          setFocusedPath(nextNode.node.path);
          if (!e.shiftKey) {
            setSelectedPaths(new Set([nextNode.node.path]));
            setLastClickedPath(nextNode.node.path);
          } else {
            // Shift+Arrow: 扩展选择
            setSelectedPaths(prev => {
              const next = new Set(prev);
              next.add(nextNode.node.path);
              return next;
            });
          }
          // 滚动到可见区域
          const el = treeContainerRef.current?.querySelector(`[data-path="${CSS.escape(nextNode.node.path)}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : flatNodes.length - 1;
        const prevNode = flatNodes[prevIdx];
        if (prevNode) {
          setFocusedPath(prevNode.node.path);
          if (!e.shiftKey) {
            setSelectedPaths(new Set([prevNode.node.path]));
            setLastClickedPath(prevNode.node.path);
          } else {
            setSelectedPaths(prev => {
              const next = new Set(prev);
              next.add(prevNode.node.path);
              return next;
            });
          }
          const el = treeContainerRef.current?.querySelector(`[data-path="${CSS.escape(prevNode.node.path)}"]`);
          el?.scrollIntoView({ block: 'nearest' });
        }
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        if (focusedPath) {
          const node = nodeByPath.get(focusedPath);
          if (node?.type === 'directory') {
            if (!expandedDirs.has(node.path)) {
              handleToggleDir(node.path);
            } else if (node.children && node.children.length > 0) {
              // 已展开：焦点移到第一个子节点
              const childIdx = flatNodes.findIndex(n => n.node.path === node.children![0].path);
              if (childIdx !== -1) {
                setFocusedPath(flatNodes[childIdx].node.path);
                setSelectedPaths(new Set([flatNodes[childIdx].node.path]));
                setLastClickedPath(flatNodes[childIdx].node.path);
              }
            }
          }
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (focusedPath) {
          const node = nodeByPath.get(focusedPath);
          if (node?.type === 'directory' && expandedDirs.has(node.path)) {
            // 折叠当前目录
            handleToggleDir(node.path);
          } else {
            // 跳到父目录
            const parentPath = getParentPath(focusedPath);
            if (parentPath && nodeByPath.has(parentPath)) {
              setFocusedPath(parentPath);
              setSelectedPaths(new Set([parentPath]));
              setLastClickedPath(parentPath);
            }
          }
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (focusedPath) {
          const node = nodeByPath.get(focusedPath);
          if (node) {
            if (node.type === 'directory') {
              handleToggleDir(node.path);
            } else {
              onFileSelect(node.path);
            }
          }
        }
        break;
      }
      case 'Delete':
      case 'Backspace': {
        if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey) break; // Backspace 需要 Ctrl
        e.preventDefault();
        const pathsToDelete = selectedPaths.size > 0 ? selectedPaths : (focusedPath ? new Set([focusedPath]) : new Set<string>());
        if (pathsToDelete.size > 0) {
          handleBatchDelete(pathsToDelete);
        }
        break;
      }
      case 'F2': {
        e.preventDefault();
        if (focusedPath) {
          const node = nodeByPath.get(focusedPath);
          if (node) {
            handleRename(node);
          }
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        if (inlineEdit) {
          setInlineEdit(null);
        } else {
          setSelectedPaths(new Set());
        }
        break;
      }
      case 'a':
      case 'A': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          // 全选当前可见节点
          const allPaths = new Set(flatNodes.map(n => n.node.path));
          setSelectedPaths(allPaths);
        }
        break;
      }
      case 'c':
      case 'C': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleCopySelected();
        }
        break;
      }
      case 'x':
      case 'X': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          handleCutSelected();
        }
        break;
      }
      case 'v':
      case 'V': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (focusedPath) {
            const node = nodeByPath.get(focusedPath);
            if (node) {
              handlePaste(node);
            }
          }
        }
        break;
      }
    }
  }, [flatNodes, focusedPath, expandedDirs, nodeByPath, inlineEdit, selectedPaths, onFileSelect, handleToggleDir]);

  // ==================== 文件操作函数 ====================

  const handleCut = useCallback((node: FileTreeNode) => {
    const nodes = selectedPaths.has(node.path) && selectedPaths.size > 1
      ? Array.from(selectedPaths).map(p => nodeByPath.get(p)).filter((n): n is FileTreeNode => !!n)
      : [node];
    setClipboard({ node, nodes, operation: 'cut' });
  }, [selectedPaths, nodeByPath]);

  const handleCopy = useCallback((node: FileTreeNode) => {
    const nodes = selectedPaths.has(node.path) && selectedPaths.size > 1
      ? Array.from(selectedPaths).map(p => nodeByPath.get(p)).filter((n): n is FileTreeNode => !!n)
      : [node];
    setClipboard({ node, nodes, operation: 'copy' });
  }, [selectedPaths, nodeByPath]);

  const handleCutSelected = useCallback(() => {
    const paths = selectedPaths.size > 0 ? selectedPaths : (focusedPath ? new Set([focusedPath]) : new Set<string>());
    if (paths.size === 0) return;
    const nodes = Array.from(paths).map(p => nodeByPath.get(p)).filter((n): n is FileTreeNode => !!n);
    if (nodes.length > 0) {
      setClipboard({ node: nodes[0], nodes, operation: 'cut' });
    }
  }, [selectedPaths, focusedPath, nodeByPath]);

  const handleCopySelected = useCallback(() => {
    const paths = selectedPaths.size > 0 ? selectedPaths : (focusedPath ? new Set([focusedPath]) : new Set<string>());
    if (paths.size === 0) return;
    const nodes = Array.from(paths).map(p => nodeByPath.get(p)).filter((n): n is FileTreeNode => !!n);
    if (nodes.length > 0) {
      setClipboard({ node: nodes[0], nodes, operation: 'copy' });
    }
  }, [selectedPaths, focusedPath, nodeByPath]);

  const handlePaste = useCallback(async (targetNode: FileTreeNode) => {
    if (!clipboard || clipboard.nodes.length === 0) return;

    const destDir = targetNode.type === 'directory' ? targetNode.path : getParentPath(targetNode.path);
    const errors: string[] = [];

    for (const srcNode of clipboard.nodes) {
      const destPath = `${destDir}/${srcNode.name}`;
      try {
        if (clipboard.operation === 'cut') {
          const response = await fetch('/api/files/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePath: srcNode.path, destPath, root: projectPath }),
          });
          if (!response.ok) {
            const error = await response.json();
            errors.push(`${srcNode.name}: ${error.error}`);
          }
        } else {
          const response = await fetch('/api/files/copy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePath: srcNode.path, destPath, root: projectPath }),
          });
          if (!response.ok) {
            const error = await response.json();
            errors.push(`${srcNode.name}: ${error.error}`);
          }
        }
      } catch (err) {
        errors.push(`${srcNode.name}: 操作失败`);
      }
    }

    if (clipboard.operation === 'cut') {
      setClipboard(null);
    }

    if (errors.length > 0) {
      alert(`部分操作失败:\n${errors.join('\n')}`);
    }

    await fetchTree();
  }, [clipboard, projectPath, fetchTree]);

  const handleRename = useCallback((node: FileTreeNode) => {
    setInlineEdit({
      path: node.path,
      type: 'rename',
      initialValue: node.name,
    });
  }, []);

  const handleDelete = useCallback(async (node: FileTreeNode) => {
    if (!window.confirm(`确定删除 "${node.name}"？`)) return;

    try {
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path, root: projectPath }),
      });

      if (response.ok) {
        await fetchTree();
      } else {
        const error = await response.json();
        alert(`删除失败: ${error.error}`);
      }
    } catch (err) {
      console.error('[FileTree] 删除失败:', err);
      alert('删除失败');
    }
  }, [projectPath, fetchTree]);

  const handleBatchDelete = useCallback(async (paths: Set<string>) => {
    const nodeNames = Array.from(paths)
      .map(p => nodeByPath.get(p)?.name || p)
      .slice(0, 10);
    const suffix = paths.size > 10 ? `\n...等 ${paths.size} 个文件` : '';
    const msg = `确定删除以下 ${paths.size} 个文件/文件夹？\n\n${nodeNames.join('\n')}${suffix}`;

    if (!window.confirm(msg)) return;

    const errors: string[] = [];
    for (const path of paths) {
      try {
        const response = await fetch('/api/files/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, root: projectPath }),
        });
        if (!response.ok) {
          const error = await response.json();
          errors.push(`${path}: ${error.error}`);
        }
      } catch (err) {
        errors.push(`${path}: 操作失败`);
      }
    }

    if (errors.length > 0) {
      alert(`部分删除失败:\n${errors.join('\n')}`);
    }

    setSelectedPaths(new Set());
    await fetchTree();
  }, [projectPath, nodeByPath, fetchTree]);

  const handleNewFile = useCallback((node: FileTreeNode) => {
    const parentPath = node.type === 'directory' ? node.path : getParentPath(node.path);
    setInlineEdit({ path: '', type: 'newFile', parentPath });
  }, []);

  const handleNewFolder = useCallback((node: FileTreeNode) => {
    const parentPath = node.type === 'directory' ? node.path : getParentPath(node.path);
    setInlineEdit({ path: '', type: 'newFolder', parentPath });
  }, []);

  const handleCopyPath = useCallback(async (node: FileTreeNode, relative: boolean) => {
    // 多选时复制所有路径
    const paths = selectedPaths.has(node.path) && selectedPaths.size > 1
      ? Array.from(selectedPaths)
      : [node.path];
    const result = paths.map(p => relative ? p : `${projectPath}/${p}`).join('\n');
    try {
      await navigator.clipboard.writeText(result);
    } catch (err) {
      console.error('[FileTree] 复制路径失败:', err);
    }
  }, [selectedPaths, projectPath]);

  const handleReveal = useCallback(async (node: FileTreeNode) => {
    try {
      await fetch('/api/files/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path, root: projectPath }),
      });
    } catch (err) {
      console.error('[FileTree] Reveal失败:', err);
    }
  }, [projectPath]);

  const handleInlineEditSubmit = useCallback(async (value: string) => {
    if (!inlineEdit || !value.trim()) {
      setInlineEdit(null);
      return;
    }

    try {
      if (inlineEdit.type === 'rename') {
        const oldPath = inlineEdit.path;
        const newPath = oldPath.substring(0, oldPath.lastIndexOf('/') + 1) + value;

        const response = await fetch('/api/files/rename', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath, newPath, root: projectPath }),
        });

        if (!response.ok) {
          const error = await response.json();
          alert(`重命名失败: ${error.error}`);
          return;
        }
      } else if (inlineEdit.type === 'newFile') {
        const filePath = `${inlineEdit.parentPath}/${value}`;

        const response = await fetch('/api/files/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath, content: '', root: projectPath }),
        });

        if (!response.ok) {
          const error = await response.json();
          alert(`创建文件失败: ${error.error}`);
          return;
        }
      } else if (inlineEdit.type === 'newFolder') {
        const dirPath = `${inlineEdit.parentPath}/${value}`;

        const response = await fetch('/api/files/mkdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: dirPath, root: projectPath }),
        });

        if (!response.ok) {
          const error = await response.json();
          alert(`创建文件夹失败: ${error.error}`);
          return;
        }
      }

      setInlineEdit(null);
      await fetchTree();
    } catch (err) {
      console.error('[FileTree] 内联编辑失败:', err);
      alert('操作失败');
    }
  }, [inlineEdit, projectPath, fetchTree]);

  // ==================== 拖拽处理 ====================

  const handleDragStart = useCallback((e: React.DragEvent, node: FileTreeNode) => {
    // 确定要拖的文件集合
    const sourcePaths = selectedPaths.has(node.path) && selectedPaths.size > 1
      ? new Set(selectedPaths)
      : new Set([node.path]);

    setDragState({ dragging: true, sourcePaths, overPath: null });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', Array.from(sourcePaths).join('\n'));
  }, [selectedPaths]);

  const handleDragOver = useCallback((e: React.DragEvent, node: FileTreeNode) => {
    if (!dragState.dragging) return;

    // 不能拖到自身或自身的子目录
    for (const srcPath of dragState.sourcePaths) {
      if (node.path === srcPath || isDescendantOf(node.path, srcPath)) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetDir = node.type === 'directory' ? node.path : getParentPath(node.path);

    if (dragState.overPath !== targetDir) {
      setDragState(prev => ({ ...prev, overPath: targetDir }));

      // 清除之前的定时器
      if (dragExpandTimerRef.current) {
        clearTimeout(dragExpandTimerRef.current);
      }

      // 500ms 后自动展开目标目录
      if (node.type === 'directory' && !expandedDirs.has(node.path)) {
        dragExpandTimerRef.current = setTimeout(() => {
          handleToggleDir(node.path);
        }, 500);
      }
    }
  }, [dragState.dragging, dragState.sourcePaths, dragState.overPath, expandedDirs, handleToggleDir]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 清除自动展开定时器
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, node: FileTreeNode) => {
    e.preventDefault();
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }

    if (!dragState.dragging || dragState.sourcePaths.size === 0) {
      setDragState({ dragging: false, sourcePaths: new Set(), overPath: null });
      return;
    }

    const destDir = node.type === 'directory' ? node.path : getParentPath(node.path);
    const errors: string[] = [];

    for (const srcPath of dragState.sourcePaths) {
      // 不能拖到自身目录
      if (destDir === srcPath || isDescendantOf(destDir, srcPath)) continue;

      const srcName = srcPath.split('/').pop() || '';
      const destPath = `${destDir}/${srcName}`;

      // 跳过已在目标目录的文件
      if (getParentPath(srcPath) === destDir) continue;

      try {
        const response = await fetch('/api/files/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: srcPath, destPath, root: projectPath }),
        });

        if (!response.ok) {
          const error = await response.json();
          errors.push(`${srcName}: ${error.error}`);
        }
      } catch (err) {
        errors.push(`${srcName}: 移动失败`);
      }
    }

    setDragState({ dragging: false, sourcePaths: new Set(), overPath: null });

    if (errors.length > 0) {
      alert(`部分移动失败:\n${errors.join('\n')}`);
    }

    await fetchTree();
  }, [dragState, projectPath, fetchTree]);

  const handleDragEnd = useCallback(() => {
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    setDragState({ dragging: false, sourcePaths: new Set(), overPath: null });
  }, []);

  // ==================== 右键菜单 ====================

  const getContextMenuItems = useCallback((
    targetNode: FileTreeNode | null,
    targetType: 'file' | 'directory' | 'blank'
  ): ContextMenuItem[] => {
    // 计算当前操作的节点集合
    const isMultiSelection = targetNode && selectedPaths.has(targetNode.path) && selectedPaths.size > 1;
    const selCount = isMultiSelection ? selectedPaths.size : 0;

    if (targetType === 'blank') {
      return [
        { label: '新建文件...', onClick: () => handleNewFile({ name: '', path: '.', type: 'directory' }) },
        { label: '新建文件夹...', onClick: () => handleNewFolder({ name: '', path: '.', type: 'directory' }) },
        { divider: true } as ContextMenuItem,
        { label: '粘贴', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => handlePaste({ name: '', path: '.', type: 'directory' }) },
      ];
    }

    if (isMultiSelection && targetNode) {
      // 多选右键菜单
      return [
        { label: `剪切 ${selCount} 个项目`, shortcut: 'Ctrl+X', onClick: () => handleCut(targetNode) },
        { label: `复制 ${selCount} 个项目`, shortcut: 'Ctrl+C', onClick: () => handleCopy(targetNode) },
        { label: '粘贴', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => handlePaste(targetNode) },
        { divider: true } as ContextMenuItem,
        { label: `复制 ${selCount} 个路径`, onClick: () => handleCopyPath(targetNode, false) },
        { label: `复制 ${selCount} 个相对路径`, onClick: () => handleCopyPath(targetNode, true) },
        { divider: true } as ContextMenuItem,
        { label: `删除 ${selCount} 个项目`, shortcut: 'Delete', onClick: () => handleBatchDelete(selectedPaths) },
      ];
    }

    if (targetNode) {
      const isFile = targetType === 'file';
      return [
        { label: '剪切', shortcut: 'Ctrl+X', onClick: () => handleCut(targetNode) },
        { label: '复制', shortcut: 'Ctrl+C', onClick: () => handleCopy(targetNode) },
        { label: '粘贴', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => handlePaste(targetNode) },
        { divider: true } as ContextMenuItem,
        { label: '复制路径', onClick: () => handleCopyPath(targetNode, false) },
        { label: '复制相对路径', onClick: () => handleCopyPath(targetNode, true) },
        { divider: true } as ContextMenuItem,
        ...(isFile ? [] : [
          { label: '新建文件...', onClick: () => handleNewFile(targetNode) } as ContextMenuItem,
          { label: '新建文件夹...', onClick: () => handleNewFolder(targetNode) } as ContextMenuItem,
          { divider: true } as ContextMenuItem,
        ]),
        { label: '重命名', shortcut: 'F2', onClick: () => handleRename(targetNode) },
        { label: '删除', shortcut: 'Delete', onClick: () => handleDelete(targetNode) },
        { divider: true } as ContextMenuItem,
        { label: '在文件管理器中显示', onClick: () => handleReveal(targetNode) },
      ];
    }

    return [];
  }, [selectedPaths, clipboard, handleCut, handleCopy, handlePaste, handleCopyPath, handleRename, handleDelete, handleBatchDelete, handleNewFile, handleNewFolder, handleReveal]);

  // 右键菜单处理
  const handleTreeNodeContextMenu = useCallback((e: React.MouseEvent, node: FileTreeNode) => {
    // 如果右键的节点不在已选中列表中，先选中它
    if (!selectedPaths.has(node.path)) {
      setSelectedPaths(new Set([node.path]));
      setFocusedPath(node.path);
      setLastClickedPath(node.path);
    }

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetNode: node,
      targetType: node.type,
    });
  }, [selectedPaths]);

  const handleContainerContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetNode: null,
      targetType: 'blank',
    });
  }, []);

  // ==================== 批量操作工具栏 ====================

  const handleClearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  const handleBatchCopyPaths = useCallback(async () => {
    const paths = Array.from(selectedPaths).join('\n');
    try {
      await navigator.clipboard.writeText(paths);
    } catch (err) {
      console.error('[FileTree] 复制路径失败:', err);
    }
  }, [selectedPaths]);

  // ==================== 渲染 ====================

  if (loading) {
    return (
      <div className={styles.fileTree}>
        <div className={styles.header}>
          <span className={styles.projectName}>{projectName || '加载中...'}</span>
        </div>
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <span className={styles.loadingText}>加载文件树...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.fileTree}>
        <div className={styles.header}>
          <span className={styles.projectName}>{projectName || '项目'}</span>
        </div>
        <div className={styles.errorContainer}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="2"/>
            <path d="M12 7v6M12 16v1" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <span className={styles.errorText}>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.fileTree}>
      <div
        ref={treeContainerRef}
        className={styles.treeContainer}
        tabIndex={0}
        onContextMenu={handleContainerContextMenu}
        onKeyDown={handleKeyDown}
      >
        {tree && (
          <TreeNode
            node={tree}
            level={0}
            currentFile={currentFile}
            onFileSelect={onFileSelect}
            expandedDirs={expandedDirs}
            onToggleDir={handleToggleDir}
            outlineSymbols={outlineSymbols}
            symbolsExpanded={symbolsExpanded}
            onToggleSymbols={handleToggleSymbols}
            activeSymbolKey={activeSymbolKey}
            expandedSymbols={expandedSymbols}
            onToggleSymbol={handleToggleSymbol}
            onSymbolClick={onSymbolClick}
            onContextMenu={handleTreeNodeContextMenu}
            clipboard={clipboard}
            inlineEdit={inlineEdit}
            onInlineEditSubmit={handleInlineEditSubmit}
            onInlineEditCancel={() => setInlineEdit(null)}
            selectedPaths={selectedPaths}
            focusedPath={focusedPath}
            onNodeClick={handleNodeClick}
            dragState={dragState}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
        )}
      </div>

      {/* 多选批量操作工具栏 */}
      {selectedPaths.size > 1 && (
        <div className={styles.batchToolbar}>
          <span className={styles.batchCount}>
            已选 {selectedPaths.size} 项
          </span>
          <div className={styles.batchActions}>
            <button
              className={styles.batchButton}
              onClick={handleBatchCopyPaths}
              title="复制路径"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M3 11V3h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"/>
              </svg>
            </button>
            <button
              className={`${styles.batchButton} ${styles.batchDanger}`}
              onClick={() => handleBatchDelete(selectedPaths)}
              title="删除选中项"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              </svg>
            </button>
            <button
              className={styles.batchButton}
              onClick={handleClearSelection}
              title="取消选择 (Esc)"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && contextMenu.visible && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.targetNode, contextMenu.targetType)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default FileTree;
