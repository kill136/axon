import React, { useState, useEffect } from 'react';
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
 * FileTree 组件 Props
 */
interface FileTreeProps {
  projectPath: string;
  projectName?: string;
  currentFile?: string;
  onFileSelect: (filePath: string) => void;
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

/**
 * 文件树节点组件
 */
const TreeNode: React.FC<{
  node: FileTreeNode;
  level: number;
  currentFile?: string;
  onFileSelect: (filePath: string) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
}> = ({ node, level, currentFile, onFileSelect, expandedDirs, onToggleDir }) => {
  const isDirectory = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = currentFile === node.path;
  
  const handleClick = () => {
    if (isDirectory) {
      onToggleDir(node.path);
    } else {
      onFileSelect(node.path);
    }
  };
  
  return (
    <>
      <div
        className={`${styles.treeNode} ${isSelected ? styles.selected : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
      >
        {isDirectory && (
          <span className={styles.chevron}>
            <ChevronIcon isOpen={isExpanded} />
          </span>
        )}
        {!isDirectory && <span className={styles.chevronPlaceholder} />}
        
        <span className={styles.icon}>
          {isDirectory ? (
            <FolderIcon isOpen={isExpanded} />
          ) : (
            <FileIcon fileName={node.name} />
          )}
        </span>
        
        <span className={styles.name}>{node.name}</span>
      </div>
      
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
 */
export const FileTree: React.FC<FileTreeProps> = ({
  projectPath,
  projectName,
  currentFile,
  onFileSelect,
}) => {
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));
  
  // 加载文件树
  useEffect(() => {
    const fetchTree = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const response = await fetch(`/api/files/tree?path=${encodeURIComponent(projectPath)}&depth=3`);
        
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
      
      <div className={styles.treeContainer}>
        {tree && (
          <TreeNode
            node={tree}
            level={0}
            currentFile={currentFile}
            onFileSelect={onFileSelect}
            expandedDirs={expandedDirs}
            onToggleDir={handleToggleDir}
          />
        )}
      </div>
    </div>
  );
};

export default FileTree;
