import React, { useState, useEffect, useMemo, useRef } from 'react';
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

/**
 * 文件类型图标组件
 */
const FileIcon: React.FC<{ fileName: string }> = ({ fileName }) => {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // TypeScript/TSX
  if (ext === 'ts' || ext === 'tsx') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="#3178c6" strokeWidth="1.5" fill="none"/>
        <text x="8" y="11" fontSize="7" fill="#3178c6" textAnchor="middle" fontFamily="monospace" fontWeight="bold">TS</text>
      </svg>
    );
  }

  // JavaScript/JSX
  if (ext === 'js' || ext === 'jsx') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="#f7df1e" strokeWidth="1.5" fill="none"/>
        <text x="8" y="11" fontSize="7" fill="#f7df1e" textAnchor="middle" fontFamily="monospace" fontWeight="bold">JS</text>
      </svg>
    );
  }

  // CSS/SCSS/LESS
  if (ext === 'css' || ext === 'scss' || ext === 'less') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="3" y="3" width="10" height="10" rx="1" stroke="#2965f1" strokeWidth="1.5" fill="none"/>
        <path d="M5 7h6M5 9h6" stroke="#2965f1" strokeWidth="1"/>
      </svg>
    );
  }

  // JSON
  if (ext === 'json') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M5 4h6M5 8h6M5 12h4" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 3v10M12 3v10" stroke="#f59e0b" strokeWidth="1.5"/>
      </svg>
    );
  }

  // Markdown
  if (ext === 'md' || ext === 'markdown') {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 5l2 2l2-2M3 9l2 2l2-2" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 6h4M9 10h4" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    );
  }

  // 通用文件图标
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

  // 关闭菜单的处理
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

  // 调整菜单位置，防止超出视口
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
                <span className={styles.menuShortcut}>{item.shortcut}</span>
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
  clipboard?: { node: FileTreeNode; operation: 'cut' | 'copy' } | null;
  // 内联编辑
  inlineEdit?: { path: string; type: 'rename' | 'newFile' | 'newFolder'; parentPath?: string; initialValue?: string } | null;
  onInlineEditSubmit?: (value: string) => void;
  onInlineEditCancel?: () => void;
}> = ({
  node, level, currentFile, onFileSelect, expandedDirs, onToggleDir,
  outlineSymbols, symbolsExpanded, onToggleSymbols, activeSymbolKey,
  expandedSymbols, onToggleSymbol, onSymbolClick, onContextMenu, clipboard,
  inlineEdit, onInlineEditSubmit, onInlineEditCancel,
}) => {
  const isDirectory = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = currentFile === node.path;
  const isCurrentFile = currentFile === node.path;
  const hasSymbols = isCurrentFile && outlineSymbols && outlineSymbols.length > 0;
  const isCut = clipboard?.node.path === node.path && clipboard.operation === 'cut';

  const handleClick = () => {
    if (isDirectory) {
      onToggleDir(node.path);
    } else {
      onFileSelect(node.path);
      // 如果已经是当前文件，切换符号展开状态
      if (isCurrentFile && hasSymbols) {
        onToggleSymbols();
      }
    }
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

  return (
    <>
      <div
        className={`${styles.treeNode} ${isSelected ? styles.selected : ''} ${isCut ? styles.cutNode : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
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
 * 显示项目文件树，支持展开/折叠目录，点击选择文件
 * 当前文件支持展开显示代码符号（函数、类、接口等）
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

  // 剪贴板状态
  const [clipboard, setClipboard] = useState<{
    node: FileTreeNode;
    operation: 'cut' | 'copy';
  } | null>(null);

  // 内联编辑状态
  const [inlineEdit, setInlineEdit] = useState<{
    path: string;
    type: 'rename' | 'newFile' | 'newFolder';
    parentPath?: string;
    initialValue?: string;
  } | null>(null);

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

  // 加载文件树
  useEffect(() => {
    const fetchTree = async () => {
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
    };

    fetchTree();
  }, [projectPath]);

  // 切换目录展开/折叠
  const handleToggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // 刷新文件树
  const refreshTree = async () => {
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
  };

  // ==================== 右键菜单操作函数 ====================

  const handleCut = (node: FileTreeNode) => {
    setClipboard({ node, operation: 'cut' });
  };

  const handleCopy = (node: FileTreeNode) => {
    setClipboard({ node, operation: 'copy' });
  };

  const handlePaste = async (targetNode: FileTreeNode) => {
    if (!clipboard) return;
    
    const destDir = targetNode.type === 'directory' ? targetNode.path : targetNode.path.substring(0, targetNode.path.lastIndexOf('/'));
    const destPath = `${destDir}/${clipboard.node.name}`;
    
    try {
      if (clipboard.operation === 'cut') {
        const response = await fetch('/api/files/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: clipboard.node.path, destPath, root: projectPath }),
        });
        
        if (!response.ok) {
          const error = await response.json();
          alert(`移动失败: ${error.error}`);
          return;
        }
        
        setClipboard(null);
      } else {
        const response = await fetch('/api/files/copy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourcePath: clipboard.node.path, destPath, root: projectPath }),
        });
        
        if (!response.ok) {
          const error = await response.json();
          alert(`复制失败: ${error.error}`);
          return;
        }
      }
      
      await refreshTree();
    } catch (err) {
      console.error('[FileTree] 粘贴操作失败:', err);
      alert('粘贴失败');
    }
  };

  const handleRename = (node: FileTreeNode) => {
    setInlineEdit({
      path: node.path,
      type: 'rename',
      initialValue: node.name,
    });
  };

  const handleDelete = async (node: FileTreeNode) => {
    if (!window.confirm(`确定删除 "${node.name}"？`)) return;
    
    try {
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path, root: projectPath }),
      });
      
      if (response.ok) {
        await refreshTree();
      } else {
        const error = await response.json();
        alert(`删除失败: ${error.error}`);
      }
    } catch (err) {
      console.error('[FileTree] 删除失败:', err);
      alert('删除失败');
    }
  };

  const handleNewFile = (node: FileTreeNode) => {
    const parentPath = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    setInlineEdit({ path: '', type: 'newFile', parentPath });
  };

  const handleNewFolder = (node: FileTreeNode) => {
    const parentPath = node.type === 'directory' ? node.path : node.path.substring(0, node.path.lastIndexOf('/'));
    setInlineEdit({ path: '', type: 'newFolder', parentPath });
  };

  const handleCopyPath = async (node: FileTreeNode, relative: boolean) => {
    const pathStr = relative ? node.path : `${projectPath}/${node.path}`;
    try {
      await navigator.clipboard.writeText(pathStr);
    } catch (err) {
      console.error('[FileTree] 复制路径失败:', err);
    }
  };

  const handleReveal = async (node: FileTreeNode) => {
    try {
      await fetch('/api/files/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path, root: projectPath }),
      });
    } catch (err) {
      console.error('[FileTree] Reveal失败:', err);
    }
  };

  const handleInlineEditSubmit = async (value: string) => {
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
      await refreshTree();
    } catch (err) {
      console.error('[FileTree] 内联编辑失败:', err);
      alert('操作失败');
    }
  };

  // 获取右键菜单项
  const getContextMenuItems = (
    targetNode: FileTreeNode | null,
    targetType: 'file' | 'directory' | 'blank'
  ): ContextMenuItem[] => {
    if (targetType === 'file' && targetNode) {
      return [
        { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => handleCut(targetNode) },
        { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => handleCopy(targetNode) },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => handlePaste(targetNode) },
        { divider: true },
        { label: 'Copy Path', onClick: () => handleCopyPath(targetNode, false) },
        { label: 'Copy Relative Path', onClick: () => handleCopyPath(targetNode, true) },
        { divider: true },
        { label: 'Rename', shortcut: 'F2', onClick: () => handleRename(targetNode) },
        { label: 'Delete', shortcut: 'Delete', onClick: () => handleDelete(targetNode) },
        { divider: true },
        { label: 'New File...', onClick: () => handleNewFile(targetNode) },
        { label: 'New Folder...', onClick: () => handleNewFolder(targetNode) },
        { divider: true },
        { label: 'Reveal in File Explorer', onClick: () => handleReveal(targetNode) },
      ];
    }
    
    if (targetType === 'directory' && targetNode) {
      return [
        { label: 'Cut', shortcut: 'Ctrl+X', onClick: () => handleCut(targetNode) },
        { label: 'Copy', shortcut: 'Ctrl+C', onClick: () => handleCopy(targetNode) },
        { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => handlePaste(targetNode) },
        { divider: true },
        { label: 'Copy Path', onClick: () => handleCopyPath(targetNode, false) },
        { label: 'Copy Relative Path', onClick: () => handleCopyPath(targetNode, true) },
        { divider: true },
        { label: 'New File...', onClick: () => handleNewFile(targetNode) },
        { label: 'New Folder...', onClick: () => handleNewFolder(targetNode) },
        { divider: true },
        { label: 'Rename', shortcut: 'F2', onClick: () => handleRename(targetNode) },
        { label: 'Delete', shortcut: 'Delete', onClick: () => handleDelete(targetNode) },
        { divider: true },
        { label: 'Reveal in File Explorer', onClick: () => handleReveal(targetNode) },
      ];
    }
    
    // 空白区域右键菜单
    return [
      { label: 'New File...', onClick: () => handleNewFile({ name: '', path: '.', type: 'directory' }) },
      { label: 'New Folder...', onClick: () => handleNewFolder({ name: '', path: '.', type: 'directory' }) },
      { divider: true },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboard, onClick: () => handlePaste({ name: '', path: '.', type: 'directory' }) },
    ];
  };

  // TreeNode 右键菜单处理
  const handleTreeNodeContextMenu = (e: React.MouseEvent, node: FileTreeNode) => {
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetNode: node,
      targetType: node.type,
    });
  };

  // 空白区域右键菜单处理
  const handleContainerContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetNode: null,
      targetType: 'blank',
    });
  };

  // 加载中
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

  // 错误状态
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

  // 正常显示
  return (
    <div className={styles.fileTree}>
      <div className={styles.header}>
        <span className={styles.projectName}>{projectName || tree?.name || '项目'}</span>
      </div>

      <div 
        className={styles.treeContainer}
        onContextMenu={handleContainerContextMenu}
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
          />
        )}
      </div>

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
