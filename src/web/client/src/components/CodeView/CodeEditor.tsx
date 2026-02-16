import React, { useState, useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import styles from './CodeEditor.module.css';
import { useAIHover, type LineAnalysisData } from '../../hooks/useAIHover';
import { useCodeTour } from '../../hooks/useCodeTour';
import { useAskAI } from '../../hooks/useAskAI';
import { useMonacoDecorations } from '../../hooks/useMonacoDecorations';

/**
 * CodeEditor Props
 */
export interface CodeEditorProps {
  onSelectionChange?: (selection: string, filePath: string, startLine: number, endLine: number) => void;
  onActiveFileChange?: (filePath: string | null, content: string, language: string) => void;
  onCursorLineChange?: (line: number) => void;
}

/**
 * CodeEditor Ref 接口
 */
export interface CodeEditorRef {
  openFile: (path: string) => void;
  getActiveFilePath: () => string | null;
  getCurrentContent: () => string | null;
  goToLine: (line: number) => void;
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
 * Monaco Editor 包装器，支持多 Tab、文件打开/保存，集成 AI 增强功能
 */
export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  ({ onSelectionChange, onActiveFileChange, onCursorLineChange }, ref) => {
    const [tabs, setTabs] = useState<EditorTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);

    // AI 功能开关
    const [beginnerMode, setBeginnerMode] = useState(false);
    const [showMinimap, setShowMinimap] = useState(true);

    // 编辑器就绪标志
    const [editorReady, setEditorReady] = useState(false);

    // 语法详情面板
    const [showLineDetails, setShowLineDetails] = useState(false);
    const [lineAnalysis, setLineAnalysis] = useState<LineAnalysisData | null>(null);

    // 当前活跃的 Tab
    const currentTab = activeTabIndex >= 0 ? tabs[activeTabIndex] : null;

    // ========================================================================
    // 集成 AI Hooks
    // ========================================================================

    // AI Hover（三层悬浮提示）
    const { dispose: disposeAIHover } = useAIHover({
      enabled: beginnerMode,
      filePath: currentTab?.path || null,
      editorRef,
      monacoRef,
      onLineAnalysis: (analysis) => {
        setLineAnalysis(analysis);
        setShowLineDetails(analysis !== null);
      },
    });

    // 代码导游
    const { tourState, startTour, stopTour, navigate, goToStep } = useCodeTour({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      editorRef,
    });

    // 选中即问 AI
    const { askAIState, openAskAI, submitQuestion, closeAskAI, setQuestion } = useAskAI({
      filePath: currentTab?.path || null,
      editorRef,
    });

    // Monaco 装饰器（热力图、重构建议、AI气泡）
    const { heatmap, refactor, bubbles } = useMonacoDecorations({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      editorRef,
      monacoRef,
      editorReady,
    });

    // ========================================================================
    // 暴露给父组件的方法
    // ========================================================================

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
      getActiveFilePath: () => currentTab?.path || null,
      getCurrentContent: () => currentTab?.content || null,
      goToLine: (line: number) => {
        if (editorRef.current) {
          editorRef.current.revealLineInCenter(line);
          editorRef.current.setPosition({ lineNumber: line, column: 1 });
          editorRef.current.focus();
        }
      },
    }));

    // ========================================================================
    // Monaco Editor 事件处理
    // ========================================================================

    // Monaco Editor 挂载回调
    const handleEditorDidMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      setEditorReady(true);

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

      // 监听光标位置变化（用于 Outline 面板高亮）
      editor.onDidChangeCursorPosition((e) => {
        onCursorLineChange?.(e.position.lineNumber);
      });

      // 监听 Ctrl+S 保存
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSaveCurrentFile();
      });

      // 注册右键菜单 "问 AI" action
      editor.addAction({
        id: 'ask-ai-about-selection',
        label: '\u{1F916} 问 AI 关于这段代码',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0,
        run: () => {
          openAskAI();
        },
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

    // 通知父组件活跃文件变化
    useEffect(() => {
      onActiveFileChange?.(
        currentTab?.path || null,
        currentTab?.content || '',
        currentTab?.language || ''
      );
    }, [activeTabIndex, currentTab?.path, currentTab?.content, currentTab?.language]);

    // ========================================================================
    // 渲染辅助：获取当前导游步骤
    // ========================================================================

    const currentTourStep = tourState.active && tourState.steps[tourState.currentStep]
      ? tourState.steps[tourState.currentStep]
      : null;

    // ========================================================================
    // 渲染 - 编辑器主体（Monaco + 语法详情面板）
    // ========================================================================

    const renderEditorBody = () => {
      if (!currentTab) {
        return (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>No file open</p>
            <p className={styles.emptyHint}>Select a file from the tree to start editing</p>
          </div>
        );
      }

      return (
        <div className={showLineDetails ? styles.editorWithPanel : styles.editorFull}>
          {/* Monaco 编辑器 */}
          <div className={styles.monacoContainer}>
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
                minimap: { enabled: showMinimap },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                wordWrap: 'off',
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                renderWhitespace: 'selection',
                bracketPairColorization: { enabled: true },
                glyphMargin: true,
                guides: {
                  indentation: true,
                  bracketPairs: true,
                },
                suggest: {
                  showKeywords: true,
                  showSnippets: true,
                },
                hover: {
                  enabled: true,
                  delay: 300,
                },
              }}
            />
          </div>

          {/* 语法详情面板 */}
          {showLineDetails && lineAnalysis && (
            <div className={styles.lineDetailPanel}>
              <div className={styles.lineDetailHeader}>
                <span className={styles.lineDetailTitle}>
                  第 {lineAnalysis.lineNumber} 行
                </span>
                <button
                  className={styles.lineDetailClose}
                  onClick={() => setShowLineDetails(false)}
                >
                  ×
                </button>
              </div>

              {/* 代码行 */}
              <div className={styles.lineDetailCode}>
                {lineAnalysis.lineContent}
              </div>

              {/* 关键字解释 */}
              {lineAnalysis.keywords.length > 0 && (
                <div className={styles.lineDetailSection}>
                  <div className={styles.lineDetailSectionTitle}>🔑 语法关键字</div>
                  {lineAnalysis.keywords.map((kw, i) => (
                    <div key={i} className={styles.lineDetailKeyword}>
                      <span className={styles.keywordName}>{kw.keyword}</span>
                      <span className={styles.keywordBrief}>{kw.brief}</span>
                      {kw.detail && <div className={styles.keywordDetail}>{kw.detail}</div>}
                      {kw.example && <pre className={styles.keywordExample}>{kw.example}</pre>}
                    </div>
                  ))}
                </div>
              )}

              {/* AI 分析结果 */}
              {lineAnalysis.loading && (
                <div className={styles.lineDetailLoading}>🤖 AI 分析中...</div>
              )}
              {lineAnalysis.aiAnalysis && (
                <div className={styles.lineDetailSection}>
                  <div className={styles.lineDetailSectionTitle}>🤖 AI 分析</div>
                  {lineAnalysis.aiAnalysis.brief && (
                    <div className={styles.aiAnalysisBrief}>{lineAnalysis.aiAnalysis.brief}</div>
                  )}
                  {lineAnalysis.aiAnalysis.detail && (
                    <div className={styles.aiAnalysisDetail}>{lineAnalysis.aiAnalysis.detail}</div>
                  )}
                  {lineAnalysis.aiAnalysis.params && lineAnalysis.aiAnalysis.params.length > 0 && (
                    <div className={styles.aiAnalysisParams}>
                      <div className={styles.aiAnalysisParamsTitle}>参数：</div>
                      {lineAnalysis.aiAnalysis.params.map((param: any, idx: number) => (
                        <div key={idx} className={styles.aiAnalysisParam}>
                          <span className={styles.paramName}>{param.name}</span>
                          <span className={styles.paramDesc}>{param.description || param.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {lineAnalysis.aiAnalysis.returns && (
                    <div className={styles.aiAnalysisReturns}>
                      <span className={styles.returnsLabel}>返回：</span>
                      {typeof lineAnalysis.aiAnalysis.returns === 'string'
                        ? lineAnalysis.aiAnalysis.returns
                        : `${lineAnalysis.aiAnalysis.returns.type}: ${lineAnalysis.aiAnalysis.returns.description}`}
                    </div>
                  )}
                  {lineAnalysis.aiAnalysis.examples && lineAnalysis.aiAnalysis.examples.length > 0 && (
                    <div className={styles.aiAnalysisExamples}>
                      <div className={styles.aiAnalysisExamplesTitle}>示例：</div>
                      {lineAnalysis.aiAnalysis.examples.map((example: any, idx: number) => (
                        <pre key={idx} className={styles.aiAnalysisExample}>
                          {typeof example === 'string' ? example : (example.code || JSON.stringify(example))}
                        </pre>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    // ========================================================================
    // 渲染
    // ========================================================================

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

        {/* AI 工具栏 */}
        {currentTab && (
          <div className={styles.aiToolbar}>
            <div className={styles.aiToolGroup}>
              <button
                className={`${styles.aiBtn} ${tourState.active ? styles.active : ''}`}
                onClick={() => tourState.active ? stopTour() : startTour()}
                disabled={tourState.loading}
                title="代码导游"
              >
                🚀 导游 {tourState.loading && '⏳'}
              </button>
              <button
                className={`${styles.aiBtn} ${heatmap.enabled ? styles.active : ''}`}
                onClick={heatmap.toggle}
                disabled={heatmap.loading}
                title="代码复杂度热力图"
              >
                🔥 热力图 {heatmap.loading && '⏳'}
              </button>
              <button
                className={`${styles.aiBtn} ${refactor.enabled ? styles.active : ''}`}
                onClick={refactor.toggle}
                disabled={refactor.loading}
                title="AI 重构建议"
              >
                ✨ 重构 {refactor.loading && '⏳'}
              </button>
              <button
                className={`${styles.aiBtn} ${bubbles.enabled ? styles.active : ''}`}
                onClick={bubbles.toggle}
                disabled={bubbles.loading}
                title="AI 代码气泡"
              >
                💬 气泡 {bubbles.loading && '⏳'}
              </button>
            </div>

            <span className={styles.toolDivider}></span>

            <div className={styles.aiToolGroup}>
              <button
                className={`${styles.aiBtn} ${showLineDetails ? styles.active : ''}`}
                onClick={() => setShowLineDetails(!showLineDetails)}
                title="语法详情面板"
              >
                📖 语法详情
              </button>
              <button
                className={`${styles.aiBtn} ${beginnerMode ? styles.active : ''}`}
                onClick={() => setBeginnerMode(!beginnerMode)}
                title="新手模式（AI 悬浮提示）"
              >
                🎓 新手模式
              </button>
              <button
                className={`${styles.aiBtn} ${showMinimap ? styles.active : ''}`}
                onClick={() => setShowMinimap(!showMinimap)}
                title="代码小地图"
              >
                🗺️ 小地图
              </button>
            </div>
          </div>
        )}

        {/* 编辑器区域 */}
        <div className={styles.editorContainer}>
          {tourState.active ? (
            /* 导游模式：编辑器 + 导游面板 二栏布局 */
            <div className={styles.codeEditorWithTour}>
              <div className={styles.codeEditorMain}>
                {renderEditorBody()}
              </div>

              {/* 导游面板 */}
              <div className={styles.tourPanel}>
                <div className={styles.tourHeader}>
                  <span className={styles.tourTitle}>🚀 代码导游</span>
                  <span className={styles.tourProgress}>
                    {tourState.currentStep + 1} / {tourState.steps.length}
                  </span>
                  <button className={styles.tourClose} onClick={stopTour}>×</button>
                </div>

                <div className={styles.tourContent}>
                  {currentTourStep && (
                    <div className={styles.tourStepInfo}>
                      <div className={styles.tourStepType}>
                        {currentTourStep.type}
                      </div>
                      <div className={styles.tourStepName}>
                        {currentTourStep.name}
                      </div>
                      <div className={styles.tourStepLine}>
                        第 {currentTourStep.line} 行
                      </div>
                      <div className={styles.tourDescription}>
                        {currentTourStep.description}
                      </div>
                    </div>
                  )}
                </div>

                <div className={styles.tourStepsList}>
                  <div className={styles.tourStepsTitle}>所有步骤</div>
                  {tourState.steps.map((step, index) => (
                    <div
                      key={index}
                      className={`${styles.tourStepItem} ${index === tourState.currentStep ? styles.active : ''}`}
                      onClick={() => goToStep(index)}
                    >
                      <span className={styles.tourStepItemNum}>{index + 1}</span>
                      <span className={styles.tourStepItemName}>{step.name}</span>
                      <span className={styles.tourStepItemType}>{step.type}</span>
                    </div>
                  ))}
                </div>

                <div className={styles.tourNav}>
                  <button
                    className={styles.tourNavBtn}
                    onClick={() => navigate('prev')}
                    disabled={tourState.currentStep === 0}
                  >
                    ← 上一步
                  </button>
                  <button
                    className={styles.tourNavBtn}
                    onClick={() => navigate('next')}
                    disabled={tourState.currentStep === tourState.steps.length - 1}
                  >
                    下一步 →
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* 普通模式：编辑器（可能带语法详情面板） */
            renderEditorBody()
          )}
        </div>

        {/* 选中即问 AI 对话框 */}
        {askAIState.visible && (
          <div className={styles.askAIOverlay}>
            <div className={styles.askAIDialog}>
              <div className={styles.askAIHeader}>
                <span className={styles.askAITitle}>🤖 问 AI</span>
                <span className={styles.askAIRange}>
                  第 {askAIState.selectedRange?.startLine}-{askAIState.selectedRange?.endLine} 行
                </span>
                <button className={styles.askAIClose} onClick={closeAskAI}>×</button>
              </div>

              <pre className={styles.askAICode}>{askAIState.selectedCode}</pre>

              <input
                className={styles.askAIInput}
                placeholder="输入你的问题（例如：这段代码做什么？）"
                value={askAIState.question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitQuestion(askAIState.question);
                  }
                }}
                autoFocus
              />

              <button
                className={styles.askAISubmit}
                onClick={() => submitQuestion(askAIState.question)}
                disabled={askAIState.loading || !askAIState.question.trim()}
              >
                {askAIState.loading ? '⏳ AI 思考中...' : '🚀 提交问题'}
              </button>

              {askAIState.answer && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>💡 AI 回答：</div>
                  <div className={styles.askAIAnswerContent}>
                    {typeof askAIState.answer === 'string'
                      ? askAIState.answer
                      : JSON.stringify(askAIState.answer)}
                  </div>
                </div>
              )}

              <div className={styles.askAIHints}>
                <div className={styles.askAIHint} onClick={() => setQuestion('这段代码做什么？')}>
                  💡 提示1：这段代码做什么？
                </div>
                <div className={styles.askAIHint} onClick={() => setQuestion('有什么潜在问题？')}>
                  ⚠️ 提示2：有什么潜在问题？
                </div>
                <div className={styles.askAIHint} onClick={() => setQuestion('如何优化？')}>
                  ✨ 提示3：如何优化？
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

CodeEditor.displayName = 'CodeEditor';

export default CodeEditor;
