import React, { useState, useEffect, useCallback, useRef } from 'react';
import styles from './SearchPanel.module.css';

/**
 * 搜索面板 Props
 */
interface SearchPanelProps {
  projectPath: string;
  onFileSelect: (filePath: string) => void;
  onGoToLine?: (line: number) => void;
}

/**
 * 搜索匹配项
 */
interface SearchMatch {
  line: number;
  column: number;
  length: number;
  lineContent: string;
  previewBefore: string;
  matchText: string;
  previewAfter: string;
}

/**
 * 搜索结果（单个文件）
 */
interface SearchResultFile {
  file: string;
  matches: SearchMatch[];
}

/**
 * 搜索响应
 */
interface SearchResponse {
  results: SearchResultFile[];
  totalMatches: number;
  truncated: boolean;
}

/**
 * 替换项
 */
interface Replacement {
  line: number;
  column: number;
  length: number;
  newText: string;
}

/**
 * Chevron 图标
 */
const ChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    style={{
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <path
      d="M6 4L10 8L6 12"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 文件图标
 */
const FileIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M9 2H4C3.44772 2 3 2.44772 3 3V13C3 13.5523 3.44772 14 4 14H12C12.5523 14 13 13.5523 13 13V6L9 2Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 2V6H13"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 替换图标（单个）
 */
const ReplaceIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M3 8H13M13 8L10 5M13 8L10 11"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 全部替换图标
 */
const ReplaceAllIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M2 5H12M12 5L9 2M12 5L9 8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 11H12M12 11L9 8M12 11L9 14"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 搜索面板组件
 */
const SearchPanel: React.FC<SearchPanelProps> = ({
  projectPath,
  onFileSelect,
  onGoToLine,
}) => {
  // 搜索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isWholeWord, setIsWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  
  // 结果状态
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultFile[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedMatch, setSelectedMatch] = useState<{ file: string; matchIndex: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Debounce 定时器
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  /**
   * 执行搜索
   */
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setTotalMatches(0);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/files/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          root: projectPath,
          isRegex,
          isCaseSensitive,
          isWholeWord,
          maxResults: 500,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '搜索失败');
      }

      const data: SearchResponse = await response.json();
      setSearchResults(data.results);
      setTotalMatches(data.totalMatches);
      
      // 默认展开所有文件
      setExpandedFiles(new Set(data.results.map(r => r.file)));
      
      // 选中第一个匹配项
      if (data.results.length > 0 && data.results[0].matches.length > 0) {
        setSelectedMatch({ file: data.results[0].file, matchIndex: 0 });
      }
    } catch (err) {
      console.error('搜索失败:', err);
      setError(err instanceof Error ? err.message : '搜索失败');
      setSearchResults([]);
      setTotalMatches(0);
    } finally {
      setIsLoading(false);
    }
  }, [projectPath, isRegex, isCaseSensitive, isWholeWord]);

  /**
   * 搜索输入变化处理（带 debounce）
   */
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchQuery, performSearch]);

  /**
   * 切换文件展开/收起
   */
  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  /**
   * 点击匹配项
   */
  const handleMatchClick = useCallback((file: string, matchIndex: number, match: SearchMatch) => {
    setSelectedMatch({ file, matchIndex });
    onFileSelect(file);
    if (onGoToLine) {
      onGoToLine(match.line);
    }
  }, [onFileSelect, onGoToLine]);

  /**
   * 执行单个替换
   */
  const handleReplaceOne = useCallback(async () => {
    if (!selectedMatch || !replaceText) return;

    const fileResult = searchResults.find(r => r.file === selectedMatch.file);
    if (!fileResult) return;

    const match = fileResult.matches[selectedMatch.matchIndex];
    if (!match) return;

    try {
      const response = await fetch('/api/files/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file: selectedMatch.file,
          root: projectPath,
          replacements: [{
            line: match.line,
            column: match.column,
            length: match.length,
            newText: replaceText,
          }],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || '替换失败');
      }

      // 替换成功后重新搜索
      await performSearch(searchQuery);
    } catch (err) {
      console.error('替换失败:', err);
      setError(err instanceof Error ? err.message : '替换失败');
    }
  }, [selectedMatch, replaceText, searchResults, projectPath, searchQuery, performSearch]);

  /**
   * 执行全部替换
   */
  const handleReplaceAll = useCallback(async () => {
    if (!replaceText || searchResults.length === 0) return;

    try {
      // 逐文件替换（按行号从大到小排序）
      for (const fileResult of searchResults) {
        const sortedMatches = [...fileResult.matches].sort((a, b) => b.line - a.line);
        
        const replacements: Replacement[] = sortedMatches.map(match => ({
          line: match.line,
          column: match.column,
          length: match.length,
          newText: replaceText,
        }));

        const response = await fetch('/api/files/replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            file: fileResult.file,
            root: projectPath,
            replacements,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `替换文件 ${fileResult.file} 失败`);
        }
      }

      // 全部替换成功后重新搜索
      await performSearch(searchQuery);
    } catch (err) {
      console.error('全部替换失败:', err);
      setError(err instanceof Error ? err.message : '全部替换失败');
    }
  }, [replaceText, searchResults, projectPath, searchQuery, performSearch]);

  /**
   * 处理 Enter 键
   */
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      performSearch(searchQuery);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
    }
  }, [searchQuery, performSearch]);

  return (
    <div className={styles.searchPanel}>
      {/* 搜索输入区域 */}
      <div className={styles.searchInputArea}>
        {/* 第一行：搜索输入 */}
        <div className={styles.searchRow}>
          <button
            className={styles.chevronButton}
            onClick={() => setShowReplace(!showReplace)}
            title={showReplace ? '隐藏替换' : '显示替换'}
          >
            <ChevronIcon expanded={showReplace} />
          </button>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="搜索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <button
            className={`${styles.optionButton} ${isCaseSensitive ? styles.active : ''}`}
            onClick={() => setIsCaseSensitive(!isCaseSensitive)}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            className={`${styles.optionButton} ${isWholeWord ? styles.active : ''}`}
            onClick={() => setIsWholeWord(!isWholeWord)}
            title="全词匹配"
          >
            ab
          </button>
          <button
            className={`${styles.optionButton} ${isRegex ? styles.active : ''}`}
            onClick={() => setIsRegex(!isRegex)}
            title="正则表达式"
          >
            .*
          </button>
        </div>

        {/* 第二行：替换输入（可展开） */}
        {showReplace && (
          <div className={styles.replaceRow}>
            <div className={styles.chevronPlaceholder} />
            <input
              type="text"
              className={styles.replaceInput}
              placeholder="替换"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
            />
            <button
              className={styles.replaceButton}
              onClick={handleReplaceOne}
              disabled={!selectedMatch || !replaceText}
              title="替换"
            >
              <ReplaceIcon />
            </button>
            <button
              className={styles.replaceAllButton}
              onClick={handleReplaceAll}
              disabled={searchResults.length === 0 || !replaceText}
              title="全部替换"
            >
              <ReplaceAllIcon />
            </button>
          </div>
        )}
      </div>

      {/* 结果统计栏 */}
      <div className={styles.resultStats}>
        {isLoading && '搜索中...'}
        {!isLoading && searchResults.length > 0 && (
          `${searchResults.length} 个文件中有 ${totalMatches} 个结果`
        )}
        {!isLoading && searchQuery && searchResults.length === 0 && !error && (
          '未找到结果'
        )}
        {error && <span className={styles.errorText}>{error}</span>}
      </div>

      {/* 结果树 */}
      <div className={styles.resultsContainer}>
        {!searchQuery && !isLoading && (
          <div className={styles.emptyState}>输入搜索内容...</div>
        )}

        {searchResults.map((fileResult) => {
          const isExpanded = expandedFiles.has(fileResult.file);
          
          return (
            <div key={fileResult.file} className={styles.fileGroup}>
              {/* 文件节点 */}
              <div
                className={styles.fileNode}
                onClick={() => toggleFileExpanded(fileResult.file)}
              >
                <div className={styles.chevron}>
                  <ChevronIcon expanded={isExpanded} />
                </div>
                <div className={styles.icon}>
                  <FileIcon />
                </div>
                <div className={styles.fileName}>{fileResult.file}</div>
                <div className={styles.matchCount}>{fileResult.matches.length}</div>
              </div>

              {/* 匹配行节点 */}
              {isExpanded && fileResult.matches.map((match, matchIndex) => {
                const isSelected = selectedMatch?.file === fileResult.file && 
                                   selectedMatch?.matchIndex === matchIndex;

                return (
                  <div
                    key={`${fileResult.file}-${matchIndex}`}
                    className={`${styles.matchNode} ${isSelected ? styles.selected : ''}`}
                    onClick={() => handleMatchClick(fileResult.file, matchIndex, match)}
                  >
                    <div className={styles.lineNumber}>{match.line}</div>
                    <div className={styles.matchPreview}>
                      {match.previewBefore}
                      <span className={styles.highlight}>{match.matchText}</span>
                      {match.previewAfter}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SearchPanel;
