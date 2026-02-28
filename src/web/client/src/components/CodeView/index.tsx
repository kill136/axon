import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { FileTree } from './FileTree';
import { CodeEditor, CodeEditorRef } from './CodeEditor';
import { CompactChatPanel } from './CompactChatPanel';
import { SearchPanel } from './SearchPanel';
import { useOutlineSymbols } from '../../hooks/useOutlineSymbols';
import type { ChatMessage } from '../../types';
import styles from './CodeView.module.css';

/**
 * CodeView Props
 */
export interface CodeViewProps {
  messages: ChatMessage[];
  status: 'idle' | 'streaming' | 'thinking';
  model: string;
  permissionMode: string;
  onModelChange: (model: string) => void;
  onPermissionModeChange: (mode: string) => void;
  onSendMessage: (text: string) => void;
  connected: boolean;
  currentMessageId?: string;
  isStreaming?: boolean;
  projectPath: string;
}

/**
 * CodeView Ref 接口
 */
export interface CodeViewRef {
  openFileAtLine: (filePath: string, line?: number) => void;
}

/**
 * CodeView 容器组件
 * 三栏布局：FileTree | CodeEditor | CompactChatPanel
 */
export const CodeView = forwardRef<CodeViewRef, CodeViewProps>(({
  messages,
  status,
  model,
  permissionMode,
  onModelChange,
  onPermissionModeChange,
  onSendMessage,
  connected,
  currentMessageId,
  isStreaming = false,
  projectPath,
}, ref) => {
  // 面板宽度和状态
  const [fileTreeWidth, setFileTreeWidth] = useState(220);
  const [chatPanelWidth, setChatPanelWidth] = useState(360);
  const [isChatPanelCollapsed, setIsChatPanelCollapsed] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  
  // 左侧面板切换状态
  const [activePanel, setActivePanel] = useState<'explorer' | 'search'>('explorer');

  // Refs
  const codeEditorRef = useRef<CodeEditorRef>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outline 数据（传给 FileTree）
  const [activeFileContent, setActiveFileContent] = useState('');
  const [activeFileLanguage, setActiveFileLanguage] = useState('');
  const [cursorLine, setCursorLine] = useState(1);

  // 拖拽状态
  const [isResizingFileTree, setIsResizingFileTree] = useState(false);
  const [isResizingChatPanel, setIsResizingChatPanel] = useState(false);

  // 暴露 openFileAtLine 方法给父组件
  useImperativeHandle(ref, () => ({
    openFileAtLine: async (filePath: string, line?: number) => {
      setCurrentFile(filePath);
      await codeEditorRef.current?.openFile(filePath);
      if (line) {
        // 等待文件加载完成后跳转行号
        setTimeout(() => {
          codeEditorRef.current?.goToLine(line);
        }, 200);
      }
    },
  }));

  // 处理文件选择
  const handleFileSelect = (filePath: string) => {
    setCurrentFile(filePath);
    codeEditorRef.current?.openFile(filePath);
  };

  // 处理聊天面板收起/展开
  const handleChatPanelToggle = () => {
    setIsChatPanelCollapsed(prev => !prev);
  };

  // 处理编辑器选择变化（用于 Ctrl+L 代码引用）
  const [editorSelection, setEditorSelection] = useState<{
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
  } | null>(null);

  const handleSelectionChange = (
    text: string,
    filePath: string,
    startLine: number,
    endLine: number
  ) => {
    setEditorSelection({ text, filePath, startLine, endLine });
  };

  // 接收编辑器活跃文件变化
  const handleActiveFileChange = useCallback((
    filePath: string | null,
    content: string,
    language: string
  ) => {
    setCurrentFile(filePath ?? undefined);
    setActiveFileContent(content);
    setActiveFileLanguage(language);
  }, []);

  // 接收光标行变化
  const handleCursorLineChange = useCallback((line: number) => {
    setCursorLine(line);
  }, []);

  // 符号点击跳转
  const handleSymbolClick = useCallback((line: number) => {
    codeEditorRef.current?.goToLine(line);
  }, []);

  // 解析符号（传入 FileTree）
  const { symbols: outlineSymbols } = useOutlineSymbols({
    content: activeFileContent,
    language: activeFileLanguage,
    filePath: currentFile ?? null,
  });

  // FileTree 拖拽逻辑
  useEffect(() => {
    if (!isResizingFileTree) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(100, Math.min(400, e.clientX));
      setFileTreeWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingFileTree(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingFileTree]);

  // ChatPanel 拖拽逻辑
  useEffect(() => {
    if (!isResizingChatPanel) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.offsetWidth;
      const newWidth = Math.max(300, Math.min(600, containerWidth - e.clientX));
      setChatPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizingChatPanel(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingChatPanel]);

  // 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+F: 切换到搜索面板
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        setActivePanel('search');
        return;
      }
      
      // Ctrl+L (Windows/Linux) 或 Cmd+L (macOS)
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();

        // 展开聊天面板（如果已收起）
        if (isChatPanelCollapsed) {
          setIsChatPanelCollapsed(false);
        }

        // 聚焦输入框
        setTimeout(() => {
          chatInputRef.current?.focus();
        }, 100);

        // 如果有选中代码，插入代码引用
        if (editorSelection && editorSelection.text.trim()) {
          const { text, filePath, startLine, endLine } = editorSelection;
          const codeRef = `\`\`\`${filePath}:${startLine}-${endLine}\n${text}\n\`\`\``;

          // 触发插入到输入框
          if (chatInputRef.current) {
            const currentValue = chatInputRef.current.value;
            const newValue = currentValue ? `${currentValue}\n\n${codeRef}` : codeRef;
            chatInputRef.current.value = newValue;

            // 触发 change 事件以更新 CompactChatPanel 的状态
            const event = new Event('input', { bubbles: true });
            chatInputRef.current.dispatchEvent(event);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isChatPanelCollapsed, editorSelection]);

  // 处理从聊天面板打开文件
  const handleOpenFileFromChat = (filePath: string) => {
    handleFileSelect(filePath);
  };

  return (
    <div className={styles.codeView} ref={containerRef}>
      {/* FileTree 面板 */}
      <div
        className={styles.fileTreePanel}
        style={{ width: `${fileTreeWidth}px` }}
      >
        {/* Panel Header: 项目名 + 切换按钮 */}
        <div className={styles.panelHeader}>
          <div className={styles.projectName}>
            {projectPath.split(/[\\/]/).pop() || 'Project'}
          </div>
          <div className={styles.panelSwitcher}>
            {/* 文件浏览器按钮 */}
            <button
              className={`${styles.panelButton} ${activePanel === 'explorer' ? styles.active : ''}`}
              onClick={() => setActivePanel('explorer')}
              title="文件浏览器"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M1 3.5C1 2.67157 1.67157 2 2.5 2H5.5L6.5 3.5H13.5C14.3284 3.5 15 4.17157 15 5V12.5C15 13.3284 14.3284 14 13.5 14H2.5C1.67157 14 1 13.3284 1 12.5V3.5Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
            </button>
            {/* 搜索按钮 */}
            <button
              className={`${styles.panelButton} ${activePanel === 'search' ? styles.active : ''}`}
              onClick={() => setActivePanel('search')}
              title="搜索 (Ctrl+Shift+F)"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="7"
                  cy="7"
                  r="5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                />
                <path
                  d="M11 11L14.5 14.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Panel Content: 条件渲染 FileTree 或 SearchPanel */}
        <div className={styles.panelContent}>
          {activePanel === 'explorer' ? (
            <FileTree
              projectPath={projectPath}
              projectName={projectPath.split(/[\\/]/).pop() || 'Project'}
              currentFile={currentFile}
              onFileSelect={handleFileSelect}
              outlineSymbols={outlineSymbols}
              cursorLine={cursorLine}
              onSymbolClick={handleSymbolClick}
            />
          ) : (
            <SearchPanel
              projectPath={projectPath}
              onFileSelect={handleFileSelect}
              onGoToLine={(line) => {
                // 先等待文件打开，再跳转到行
                setTimeout(() => {
                  codeEditorRef.current?.goToLine(line);
                }, 100);
              }}
            />
          )}
        </div>
      </div>

      {/* FileTree 分割线 + 拖拽手柄 */}
      <div
        className={styles.resizer}
        onMouseDown={() => setIsResizingFileTree(true)}
      />

      {/* CodeEditor 面板 */}
      <div className={styles.editorPanel}>
        <CodeEditor
          ref={codeEditorRef}
          projectPath={projectPath}
          onSelectionChange={handleSelectionChange}
          onActiveFileChange={handleActiveFileChange}
          onCursorLineChange={handleCursorLineChange}
        />
      </div>

      {/* ChatPanel 分割线 + 拖拽手柄（仅在未收起时显示） */}
      {!isChatPanelCollapsed && (
        <div
          className={styles.resizer}
          onMouseDown={() => setIsResizingChatPanel(true)}
        />
      )}

      {/* CompactChatPanel 面板 */}
      {!isChatPanelCollapsed && (
        <div
          className={styles.chatPanel}
          style={{ width: `${chatPanelWidth}px` }}
        >
          <CompactChatPanel
            messages={messages}
            onSend={onSendMessage}
            onClose={handleChatPanelToggle}
            onOpenFile={handleOpenFileFromChat}
            status={status}
            model={model}
            onModelChange={onModelChange}
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            connected={connected}
            isStreaming={isStreaming}
            currentMessageId={currentMessageId}
            inputRef={chatInputRef}
          />
        </div>
      )}

      {/* 收起状态的展开按钮 */}
      {isChatPanelCollapsed && (
        <div className={styles.collapsedChatButton}>
          <button
            className={styles.expandButton}
            onClick={handleChatPanelToggle}
            title="展开聊天面板 (Ctrl+L)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 3l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
});

CodeView.displayName = 'CodeView';

export default CodeView;
