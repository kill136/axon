import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileTree } from './FileTree';
import { CodeEditor, CodeEditorRef } from './CodeEditor';
import { CompactChatPanel } from './CompactChatPanel';
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
 * CodeView 容器组件
 * 三栏布局：FileTree | CodeEditor | CompactChatPanel
 */
export const CodeView: React.FC<CodeViewProps> = ({
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
}) => {
  // 面板宽度和状态
  const [fileTreeWidth, setFileTreeWidth] = useState(220);
  const [chatPanelWidth, setChatPanelWidth] = useState(360);
  const [isChatPanelCollapsed, setIsChatPanelCollapsed] = useState(false);
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);

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

  // Ctrl+L 快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
        <FileTree
          projectPath={projectPath}
          projectName={projectPath.split(/[\\/]/).pop() || 'Project'}
          currentFile={currentFile}
          onFileSelect={handleFileSelect}
          outlineSymbols={outlineSymbols}
          cursorLine={cursorLine}
          onSymbolClick={handleSymbolClick}
        />
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
};

export default CodeView;
