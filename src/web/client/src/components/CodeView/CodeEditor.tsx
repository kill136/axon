import React, { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import styles from './CodeEditor.module.css';

/**
 * CodeEditor Props
 */
export interface CodeEditorProps {
  onSelectionChange?: (selection: string, filePath: string, startLine: number, endLine: number) => void;
}

/**
 * CodeEditor Ref 接口
 */
export interface CodeEditorRef {
  openFile: (path: string) => void;
}

/**
 * Tab 状态接口
 */
interface EditorTab {
  path: string;
  content: string;
  language: string;
  modified: boolean;
  originalContent: string;
}

/**
 * 根据文件路径推断语言
 */
function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    'ts': 'typescript',
    'tsx': 'typescript',
    'js': 'javascript',
    'jsx': 'javascript',
    'css': 'css',
    'json': 'json',
    'md': 'markdown',
    'html': 'html',
    'py': 'python',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'sh': 'shell',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
  };
  return langMap[ext || ''] || 'plaintext';
}

/**
 * 从完整路径提取文件名
 */
function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * 关闭图标组件
 */
const CloseIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path 
      d="M2 2l8 8M10 2l-8 8" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      strokeLinecap="round"
    />
  </svg>
);

/**
 * CodeEditor 组件
 * Monaco Editor 包装器，支持多 Tab、文件打开/保存
 */
export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  ({ onSelectionChange }, ref) => {
    const [tabs, setTabs] = useState<EditorTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);

    // 暴露给父组件的方法
    useImperativeHandle(ref, () => ({
      openFile: async (path: string) => {
        // 检查是否已打开
        const existingIndex = tabs.findIndex(tab => tab.path === path);
        if (existingIndex !== -1) {
          setActiveTabIndex(existingIndex);
          return;
        }

        // 加载文件内容
        try {
          const response = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
          
          if (!response.ok) {
            const errorData = await response.json();
            console.error('[CodeEditor] 读取文件失败:', errorData.error);
            alert(`读取文件失败: ${errorData.error}`);
            return;
          }

          const data = await response.json();
          const content = data.content || '';
          const language = getLanguage(path);

          const newTab: EditorTab = {
            path,
            content,
            language,
            modified: false,
            originalContent: content,
          };

          setTabs(prev => [...prev, newTab]);
          setActiveTabIndex(tabs.length);
        } catch (err) {
          console.error('[CodeEditor] 读取文件异常:', err);
          alert(`读取文件异常: ${err instanceof Error ? err.message : '未知错误'}`);
        }
      },
    }));

    // 当前活跃的 Tab
    const currentTab = activeTabIndex >= 0 ? tabs[activeTabIndex] : null;

    // Monaco Editor 挂载回调
    const handleEditorDidMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // 监听选择变化
      editor.onDidChangeCursorSelection((e) => {
        if (!onSelectionChange || !currentTab) return;

        const model = editor.getModel();
        if (!model) return;

        const selection = e.selection;
        const selectedText = model.getValueInRange(selection);
        
        if (selectedText) {
          onSelectionChange(
            selectedText,
            currentTab.path,
            selection.startLineNumber,
            selection.endLineNumber
          );
        }
      });

      // 监听 Ctrl+S 保存
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSaveCurrentFile();
      });
    };

    // 内容变化回调
    const handleEditorChange = (value: string | undefined) => {
      if (activeTabIndex < 0 || !value) return;

      setTabs(prev => {
        const updated = [...prev];
        const tab = updated[activeTabIndex];
        tab.content = value;
        tab.modified = value !== tab.originalContent;
        return updated;
      });
    };

    // 保存当前文件
    const handleSaveCurrentFile = async () => {
      if (activeTabIndex < 0) return;

      const tab = tabs[activeTabIndex];
      if (!tab.modified) {
        console.log('[CodeEditor] 文件未修改，无需保存');
        return;
      }

      try {
        const response = await fetch('/api/files/write', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: tab.path,
            content: tab.content,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('[CodeEditor] 保存文件失败:', errorData.error);
          alert(`保存失败: ${errorData.error}`);
          return;
        }

        console.log('[CodeEditor] 文件保存成功:', tab.path);

        // 更新原始内容，清除修改标记
        setTabs(prev => {
          const updated = [...prev];
          const current = updated[activeTabIndex];
          current.originalContent = current.content;
          current.modified = false;
          return updated;
        });
      } catch (err) {
        console.error('[CodeEditor] 保存文件异常:', err);
        alert(`保存异常: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    };

    // 关闭 Tab
    const handleCloseTab = (index: number, e: React.MouseEvent) => {
      e.stopPropagation();

      const tab = tabs[index];
      if (tab.modified) {
        const confirmed = confirm(`文件 "${getFileName(tab.path)}" 未保存，确认关闭？`);
        if (!confirmed) return;
      }

      setTabs(prev => prev.filter((_, i) => i !== index));

      // 调整活跃索引
      if (index === activeTabIndex) {
        if (tabs.length === 1) {
          setActiveTabIndex(-1);
        } else if (index === tabs.length - 1) {
          setActiveTabIndex(index - 1);
        }
      } else if (index < activeTabIndex) {
        setActiveTabIndex(activeTabIndex - 1);
      }
    };

    // 当活跃 Tab 变化时，更新编辑器内容
    useEffect(() => {
      if (!editorRef.current || !currentTab) return;

      const model = editorRef.current.getModel();
      if (model && model.getValue() !== currentTab.content) {
        editorRef.current.setValue(currentTab.content);
      }
    }, [activeTabIndex, currentTab?.content]);

    return (
      <div className={styles.codeEditor}>
        {/* Tab 栏 */}
        {tabs.length > 0 && (
          <div className={styles.tabBar}>
            {tabs.map((tab, index) => (
              <div
                key={tab.path}
                className={`${styles.tab} ${index === activeTabIndex ? styles.active : ''}`}
                onClick={() => setActiveTabIndex(index)}
              >
                <span className={styles.tabName}>
                  {getFileName(tab.path)}
                  {tab.modified && <span className={styles.modifiedDot}>●</span>}
                </span>
                <button
                  className={styles.closeButton}
                  onClick={(e) => handleCloseTab(index, e)}
                  aria-label="关闭"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 编辑器区域 */}
        <div className={styles.editorContainer}>
          {currentTab ? (
            <Editor
              height="100%"
              language={currentTab.language}
              value={currentTab.content}
              theme="vs-dark"
              onMount={handleEditorDidMount}
              onChange={handleEditorChange}
              options={{
                fontSize: 13,
                fontFamily: 'JetBrains Mono, Consolas, monospace',
                lineHeight: 20,
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                wordWrap: 'off',
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                renderWhitespace: 'selection',
                bracketPairColorization: {
                  enabled: true,
                },
              }}
            />
          ) : (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>No file open</p>
              <p className={styles.emptyHint}>Select a file from the tree to start editing</p>
            </div>
          )}
        </div>
      </div>
    );
  }
);

CodeEditor.displayName = 'CodeEditor';

export default CodeEditor;
