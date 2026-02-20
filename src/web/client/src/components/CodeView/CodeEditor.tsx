import React, { useState, useRef, useImperativeHandle, forwardRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import styles from './CodeEditor.module.css';
import { useAIHover, type LineAnalysisData } from '../../hooks/useAIHover';
import { useCodeTour } from '../../hooks/useCodeTour';
import { useAskAI } from '../../hooks/useAskAI';
import { useMonacoDecorations } from '../../hooks/useMonacoDecorations';
import { useAutoComplete } from '../../hooks/useAutoComplete';
import { useIntentToCode } from '../../hooks/useIntentToCode';
import { useCodeReview } from '../../hooks/useCodeReview';
import { useTestGenerator } from '../../hooks/useTestGenerator';
import { useCodeConversation } from '../../hooks/useCodeConversation';
import { useSmartDiff } from '../../hooks/useSmartDiff';
import { useDeadCode } from '../../hooks/useDeadCode';
import { useTimeMachine } from '../../hooks/useTimeMachine';
import { usePatternDetector } from '../../hooks/usePatternDetector';
import { useApiDocOverlay } from '../../hooks/useApiDocOverlay';
import { getSyntaxExplanation, extractKeywordsFromLine } from '../../utils/syntaxDictionary';
import { aiHoverApi } from '../../api/ai-editor';

/**
 * CodeEditor Props
 */
export interface CodeEditorProps {
  projectPath?: string;
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
  ({ projectPath, onSelectionChange, onActiveFileChange, onCursorLineChange }, ref) => {
    const [tabs, setTabs] = useState<EditorTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);

    // AI 功能开关
    const [beginnerMode, setBeginnerMode] = useState(false);
    const [showMinimap, setShowMinimap] = useState(false);
    const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(true);
    const [apiDocEnabled, setApiDocEnabled] = useState(false); // API Doc Overlay 默认关闭

    // 工具栏按钮显隐配置
    const TOOLBAR_STORAGE_KEY = 'codeEditor.toolbarButtons';
    const DEFAULT_VISIBLE_BUTTONS = new Set([
      'autocomplete', 'review', 'intent', 'test', 'diff',
    ]);
    const [visibleButtons, setVisibleButtons] = useState<Set<string>>(() => {
      try {
        const saved = localStorage.getItem(TOOLBAR_STORAGE_KEY);
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
      return new Set(DEFAULT_VISIBLE_BUTTONS);
    });
    const [showToolbarMenu, setShowToolbarMenu] = useState(false);
    const [toolbarMenuPos, setToolbarMenuPos] = useState({ top: 0, right: 0 });
    const toolbarMenuRef = useRef<HTMLDivElement>(null);
    const toolbarBtnRef = useRef<HTMLButtonElement>(null);

    const toggleToolbarButton = (key: string) => {
      setVisibleButtons(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify([...next]));
        return next;
      });
    };

    const openToolbarMenu = useCallback(() => {
      if (toolbarBtnRef.current) {
        const rect = toolbarBtnRef.current.getBoundingClientRect();
        setToolbarMenuPos({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        });
      }
      setShowToolbarMenu(true);
    }, []);

    // 点击外部关闭工具栏菜单
    useEffect(() => {
      if (!showToolbarMenu) return;
      const handler = (e: MouseEvent) => {
        const target = e.target as Node;
        if (
          toolbarMenuRef.current && !toolbarMenuRef.current.contains(target) &&
          toolbarBtnRef.current && !toolbarBtnRef.current.contains(target)
        ) {
          setShowToolbarMenu(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [showToolbarMenu]);

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
    const handleLineAnalysis = useCallback((analysis: LineAnalysisData | null) => {
      setLineAnalysis(analysis);
      setShowLineDetails(analysis !== null);
    }, []);

    const { dispose: disposeAIHover } = useAIHover({
      enabled: beginnerMode,
      filePath: currentTab?.path || null,
      editorRef,
      monacoRef,
      onLineAnalysis: handleLineAnalysis,
    });

    // 语法详情面板：独立监听光标变化，主动获取行分析数据
    const lineAnalysisCacheRef = useRef<Map<string, LineAnalysisData>>(new Map());
    useEffect(() => {
      const editor = editorRef.current;
      if (!showLineDetails || !editor || !currentTab?.path) return;

      // 如果新手模式已开启，useAIHover 会处理数据，不需要重复
      if (beginnerMode) return;

      const analyzeCurrentLine = (lineNumber: number) => {
        const model = editor.getModel();
        if (!model) return;

        const lineContent = model.getLineContent(lineNumber);
        const filePath = currentTab.path;
        const cacheKey = `${filePath}:${lineNumber}`;

        // 检查缓存
        const cached = lineAnalysisCacheRef.current.get(cacheKey);
        if (cached && cached.lineContent === lineContent) {
          setLineAnalysis(cached);
          return;
        }

        // 提取关键词（同步）
        const keywords = extractKeywordsFromLine(lineContent)
          .map(kw => getSyntaxExplanation(kw))
          .filter(Boolean)
          .map(exp => ({
            keyword: exp!.keyword,
            brief: exp!.brief,
            detail: exp!.detail,
            example: exp!.example,
          }));

        // 先显示静态数据
        const staticData: LineAnalysisData = {
          lineNumber,
          lineContent,
          keywords,
          aiAnalysis: null,
          loading: true,
        };
        setLineAnalysis(staticData);

        // 异步获取 AI 分析
        const startLine = Math.max(1, lineNumber - 5);
        const endLine = Math.min(model.getLineCount(), lineNumber + 5);
        const contextLines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const prefix = i === lineNumber ? '>>>' : '   ';
          const lineNum = String(i).padStart(4, ' ');
          contextLines.push(`${prefix} ${lineNum} | ${model.getLineContent(i)}`);
        }

        aiHoverApi.generate({
          filePath,
          symbolName: lineContent.trim(),
          codeContext: contextLines.join('\n'),
          line: lineNumber,
          language: currentTab.language || 'typescript',
        }).then(result => {
          const fullData: LineAnalysisData = {
            lineNumber,
            lineContent,
            keywords,
            aiAnalysis: result.success ? result : null,
            loading: false,
          };
          lineAnalysisCacheRef.current.set(cacheKey, fullData);
          setLineAnalysis(fullData);
        }).catch(() => {
          const errorData: LineAnalysisData = {
            lineNumber,
            lineContent,
            keywords,
            aiAnalysis: null,
            loading: false,
          };
          lineAnalysisCacheRef.current.set(cacheKey, errorData);
          setLineAnalysis(errorData);
        });
      };

      // 分析当前行
      const pos = editor.getPosition();
      if (pos) analyzeCurrentLine(pos.lineNumber);

      // 监听光标变化
      const disposable = editor.onDidChangeCursorPosition((e) => {
        analyzeCurrentLine(e.position.lineNumber);
      });

      return () => disposable.dispose();
    }, [showLineDetails, beginnerMode, currentTab?.path, currentTab?.language, editorRef]);

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

    // 自动代码补全
    const autoComplete = useAutoComplete({
      enabled: autoCompleteEnabled,
      filePath: currentTab?.path || null,
      language: currentTab?.language || 'plaintext',
      editorRef,
      monacoRef,
      editorReady,
      projectPath,
    });

    // Intent-to-Code 意图编程
    const intentToCode = useIntentToCode({
      filePath: currentTab?.path || null,
      language: currentTab?.language || 'plaintext',
      editorRef,
    });

    // AI Code Review 代码审查
    const codeReview = useCodeReview({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      language: currentTab?.language || 'plaintext',
      editorRef,
      monacoRef,
      editorReady,
    });

    // Test Generator 测试生成
    const testGenerator = useTestGenerator({
      filePath: currentTab?.path || null,
      language: currentTab?.language || 'plaintext',
      editorRef,
    });

    // Code Conversation 代码对话
    const conversation = useCodeConversation({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      language: currentTab?.language || 'plaintext',
      editorRef,
    });

    // Smart Diff 语义 Diff 分析
    const smartDiff = useSmartDiff({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      originalContent: currentTab?.originalContent || '',
      language: currentTab?.language || 'plaintext',
      modified: currentTab?.modified || false,
    });

    // Dead Code Detection 死代码检测
    const deadCode = useDeadCode({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      language: currentTab?.language || 'plaintext',
      editorRef,
      monacoRef,
      editorReady,
    });

    // Time Machine 代码时光机
    const timeMachine = useTimeMachine({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      language: currentTab?.language || 'plaintext',
      editorRef,
    });

    // Pattern Detector 模式检测器
    const pattern = usePatternDetector({
      filePath: currentTab?.path || null,
      content: currentTab?.content || '',
      language: currentTab?.language || 'plaintext',
      editorRef,
      monacoRef,
      editorReady,
    });

    // API Doc Overlay API 文档叠加
    const apiDoc = useApiDocOverlay({
      enabled: apiDocEnabled,
      filePath: currentTab?.path || null,
      language: currentTab?.language || 'plaintext',
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
          const response = await fetch(`/api/files/read?path=${encodeURIComponent(path)}${projectPath ? `&root=${encodeURIComponent(projectPath)}` : ''}`);
          
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

      // 注册右键菜单 "意图编程" action
      editor.addAction({
        id: 'intent-to-code',
        label: '✏️ 意图编程',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1,
        run: () => {
          intentToCode.openIntent();
        },
      });

      // 注册右键菜单 "生成测试" action
      editor.addAction({
        id: 'generate-test',
        label: '\u{1F9EA} 生成测试',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 2,
        run: () => {
          testGenerator.openGenerator();
        },
      });

      // 注册右键菜单 "代码时光机" action
      editor.addAction({
        id: 'time-machine',
        label: '⏰ 代码时光机',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3,
        run: () => {
          timeMachine.open();
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
            root: projectPath,
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

      const showReviewPanel = codeReview.enabled && codeReview.issues.length > 0;
      const showConversationPanel = conversation.state.visible;
      const showPatternPanel = pattern.enabled && pattern.patterns.length > 0;
      const showAnyPanel = showLineDetails || showReviewPanel || showConversationPanel || showPatternPanel;

      return (
        <div className={showAnyPanel ? styles.editorWithPanel : styles.editorFull}>
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

          {/* Code Review 问题面板 */}
          {showReviewPanel && (
            <div className={styles.reviewPanel}>
              <div className={styles.reviewHeader}>
                <span className={styles.reviewTitle}>🎯 代码审查</span>
                <span className={styles.reviewCount}>{codeReview.issues.length} 个问题</span>
                <button
                  className={styles.reviewClose}
                  onClick={codeReview.toggle}
                >
                  ×
                </button>
              </div>

              {/* 摘要 */}
              {codeReview.summary && (
                <div className={styles.reviewSummary}>
                  {codeReview.summary}
                </div>
              )}

              {/* 问题列表 */}
              <div className={styles.reviewIssuesList}>
                {codeReview.issues.map((issue, idx) => {
                  const typeIcon = 
                    issue.type === 'bug' ? '🐛' :
                    issue.type === 'performance' ? '⚡' :
                    issue.type === 'security' ? '🔒' : '💅';

                  return (
                    <div
                      key={idx}
                      className={styles.reviewIssue}
                      data-type={issue.type}
                      data-severity={issue.severity}
                      onClick={() => {
                        if (editorRef.current) {
                          editorRef.current.revealLineInCenter(issue.line);
                          editorRef.current.setPosition({ lineNumber: issue.line, column: 1 });
                          editorRef.current.focus();
                        }
                      }}
                    >
                      <div className={styles.issueHeader}>
                        <span className={styles.issueIcon}>{typeIcon}</span>
                        <span className={styles.issueSeverity} data-severity={issue.severity}>
                          {issue.severity}
                        </span>
                        <span className={styles.issueLine}>L{issue.line}</span>
                      </div>
                      <div className={styles.issueMessage}>{issue.message}</div>
                      {issue.suggestion && (
                        <div className={styles.issueSuggestion}>💡 {issue.suggestion}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Code Conversation 对话面板 */}
          {showConversationPanel && (
            <div className={styles.conversationPanel}>
              <div className={styles.conversationHeader}>
                <span className={styles.conversationTitle}>💬 代码对话</span>
                <button className={styles.conversationClear} onClick={conversation.clear} title="清空对话">
                  🗑️
                </button>
                <button className={styles.conversationClose} onClick={conversation.close}>
                  ×
                </button>
              </div>

              {/* 对话列表 */}
              <div className={styles.conversationMessages}>
                {conversation.state.messages.length === 0 ? (
                  <div className={styles.conversationHints}>
                    <div className={styles.conversationHintItem} onClick={() => conversation.setInput('这段代码做什么？')}>
                      💡 这段代码做什么？
                    </div>
                    <div className={styles.conversationHintItem} onClick={() => conversation.setInput('有什么替代方案？')}>
                      💡 有什么替代方案？
                    </div>
                    <div className={styles.conversationHintItem} onClick={() => conversation.setInput('如何测试这个功能？')}>
                      💡 如何测试这个功能？
                    </div>
                  </div>
                ) : (
                  <>
                    {conversation.state.messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}
                      >
                        <div className={styles.messageRole}>
                          {msg.role === 'user' ? '👤 你' : '🤖 AI'}
                        </div>
                        <div className={styles.messageContent}>{msg.content}</div>
                      </div>
                    ))}
                  </>
                )}

                {conversation.state.loading && (
                  <div className={styles.assistantMessage}>
                    <div className={styles.messageRole}>🤖 AI</div>
                    <div className={styles.messageContent}>🤔 思考中...</div>
                  </div>
                )}
              </div>

              {/* 输入框 */}
              <div className={styles.conversationInputArea}>
                <textarea
                  className={styles.conversationInput}
                  placeholder="输入你的问题..."
                  value={conversation.state.input}
                  onChange={(e) => conversation.setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      conversation.send();
                    }
                  }}
                  rows={3}
                />
                <button
                  className={styles.conversationSendBtn}
                  onClick={conversation.send}
                  disabled={conversation.state.loading || !conversation.state.input.trim()}
                >
                  {conversation.state.loading ? '⏳ 发送中' : '📤 发送'}
                </button>
              </div>
            </div>
          )}

          {/* Pattern Detector 面板 */}
          {showPatternPanel && (
            <div className={styles.patternPanel}>
              <div className={styles.patternHeader}>
                <span className={styles.patternTitle}>🔍 代码模式</span>
                <span className={styles.patternCount}>{pattern.patterns.length} 个模式</span>
                <button className={styles.patternClose} onClick={pattern.toggle}>
                  ×
                </button>
              </div>

              {/* 摘要 */}
              {pattern.summary && (
                <div className={styles.patternSummary}>{pattern.summary}</div>
              )}

              {/* 模式列表 */}
              <div className={styles.patternList}>
                {pattern.patterns.map((p, idx) => {
                  // 确定图标
                  const icon = p.type === 'duplicate' ? '🔄' :
                              p.type === 'similar-logic' ? '↔️' :
                              p.type === 'extract-candidate' ? '✂️' : '🏗️';

                  // 确定影响级别样式
                  const impactClass = p.impact === 'high' ? styles.patternImpactHigh :
                                     p.impact === 'medium' ? styles.patternImpactMedium :
                                     styles.patternImpactLow;

                  return (
                    <div key={idx} className={styles.patternItem}>
                      <div className={styles.patternItemHeader}>
                        <span className={styles.patternIcon}>{icon}</span>
                        <span className={styles.patternName}>{p.name}</span>
                        <span className={`${styles.patternImpact} ${impactClass}`}>
                          {p.impact}
                        </span>
                      </div>
                      <div className={styles.patternDescription}>{p.description}</div>
                      <div className={styles.patternSuggestion}>
                        💡 <strong>建议</strong>: {p.suggestion}
                      </div>
                      <div className={styles.patternLocations}>
                        <strong>位置</strong>:
                        {p.locations.map((loc, locIdx) => (
                          <button
                            key={locIdx}
                            className={styles.patternLocation}
                            onClick={() => {
                              if (editorRef.current) {
                                editorRef.current.revealLineInCenter(loc.line);
                                editorRef.current.setSelection({
                                  startLineNumber: loc.line,
                                  startColumn: 1,
                                  endLineNumber: loc.endLine,
                                  endColumn: 1,
                                });
                              }
                            }}
                          >
                            行 {loc.line}-{loc.endLine}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
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
              {visibleButtons.has('tour') && (
                <button
                  className={`${styles.aiBtn} ${tourState.active ? styles.active : ''}`}
                  onClick={() => tourState.active ? stopTour() : startTour()}
                  disabled={tourState.loading}
                  title="代码导游"
                >
                  🚀 导游 {tourState.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('heatmap') && (
                <button
                  className={`${styles.aiBtn} ${heatmap.enabled ? styles.active : ''}`}
                  onClick={heatmap.toggle}
                  disabled={heatmap.loading}
                  title="代码复杂度热力图"
                >
                  🔥 热力图 {heatmap.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('refactor') && (
                <button
                  className={`${styles.aiBtn} ${refactor.enabled ? styles.active : ''}`}
                  onClick={refactor.toggle}
                  disabled={refactor.loading}
                  title="AI 重构建议"
                >
                  ✨ 重构 {refactor.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('bubbles') && (
                <button
                  className={`${styles.aiBtn} ${bubbles.enabled ? styles.active : ''}`}
                  onClick={bubbles.toggle}
                  disabled={bubbles.loading}
                  title="AI 代码气泡"
                >
                  💬 气泡 {bubbles.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('review') && (
                <button
                  className={`${styles.aiBtn} ${codeReview.enabled ? styles.active : ''}`}
                  onClick={codeReview.toggle}
                  disabled={codeReview.loading}
                  title="AI 代码审查"
                >
                  🎯 审查 {codeReview.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('deadcode') && (
                <button
                  className={`${styles.aiBtn} ${deadCode.enabled ? styles.active : ''}`}
                  onClick={deadCode.toggle}
                  disabled={deadCode.loading}
                  title={`死代码检测${deadCode.items.length > 0 ? ` (${deadCode.items.length})` : ''}`}
                >
                  💀 死代码 {deadCode.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('pattern') && (
                <button
                  className={`${styles.aiBtn} ${pattern.enabled ? styles.active : ''}`}
                  onClick={pattern.toggle}
                  disabled={pattern.loading}
                  title={`模式检测${pattern.patterns.length > 0 ? ` (${pattern.patterns.length})` : ''}`}
                >
                  🔍 模式 {pattern.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('autocomplete') && (
                <button
                  className={`${styles.aiBtn} ${autoCompleteEnabled ? styles.active : ''}`}
                  onClick={() => setAutoCompleteEnabled(!autoCompleteEnabled)}
                  title={`AI 代码补全（本地 ${autoComplete.stats.localItems} 项 + ${autoComplete.stats.snippetItems} 片段）`}
                >
                  ⚡ 补全
                </button>
              )}
              {visibleButtons.has('intent') && (
                <button
                  className={`${styles.aiBtn} ${intentToCode.state.visible ? styles.active : ''}`}
                  onClick={() => {
                    if (intentToCode.state.visible) {
                      intentToCode.close();
                    } else {
                      const editor = editorRef.current;
                      const selection = editor?.getSelection();
                      const hasSelection = selection && editor?.getModel()?.getValueInRange(selection)?.trim();
                      if (!hasSelection) {
                        const pos = editor?.getPosition();
                        const line = pos ? editor?.getModel()?.getLineContent(pos.lineNumber)?.trim() : '';
                        const isComment = line && (/^(\/\/|#|\/\*|\*|--|<!--)/).test(line);
                        if (!isComment) {
                          alert('请先选中代码，或将光标放在注释行上');
                          return;
                        }
                      }
                      intentToCode.openIntent();
                    }
                  }}
                  title="意图编程：选中代码后改写，或在注释行生成代码"
                >
                  ✏️ 意图
                </button>
              )}
              {visibleButtons.has('test') && (
                <button
                  className={styles.aiBtn}
                  onClick={testGenerator.openGenerator}
                  title="测试生成：为函数生成单元测试"
                >
                  🧪 测试
                </button>
              )}
              {visibleButtons.has('conversation') && (
                <button
                  className={`${styles.aiBtn} ${conversation.state.visible ? styles.active : ''}`}
                  onClick={() => conversation.state.visible ? conversation.close() : conversation.open()}
                  title="代码对话：与 AI 讨论代码"
                >
                  💬 对话
                </button>
              )}
              {visibleButtons.has('diff') && (
                <button
                  className={styles.aiBtn}
                  onClick={smartDiff.analyze}
                  disabled={smartDiff.state.loading || !currentTab?.modified}
                  title={currentTab?.modified ? "语义 Diff 分析：分析代码改动的影响" : "语义 Diff 分析：需要先修改文件"}
                >
                  🔍 Diff {smartDiff.state.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('beginner') && (
                <button
                  className={`${styles.aiBtn} ${beginnerMode ? styles.active : ''}`}
                  onClick={() => setBeginnerMode(!beginnerMode)}
                  title="新手模式（AI 悬浮提示）"
                >
                  🎓 新手模式
                </button>
              )}
              {visibleButtons.has('minimap') && (
                <button
                  className={`${styles.aiBtn} ${showMinimap ? styles.active : ''}`}
                  onClick={() => setShowMinimap(!showMinimap)}
                  title="代码小地图"
                >
                  🗺️ 小地图
                </button>
              )}
              {visibleButtons.has('timemachine') && (
                <button
                  className={styles.aiBtn}
                  onClick={timeMachine.open}
                  title="代码时光机：查看代码演变历史"
                >
                  ⏰ 时光机
                </button>
              )}
              {visibleButtons.has('apidoc') && (
                <button
                  className={`${styles.aiBtn} ${apiDocEnabled ? styles.active : ''}`}
                  onClick={() => setApiDocEnabled(!apiDocEnabled)}
                  title="API 文档叠加：悬停显示第三方 API 文档"
                >
                  📚 API
                </button>
              )}
            </div>

            {/* 工具栏配置按钮 */}
            <span className={styles.toolDivider}></span>
            <button
              ref={toolbarBtnRef}
              className={`${styles.aiBtn} ${showToolbarMenu ? styles.active : ''}`}
              onClick={() => showToolbarMenu ? setShowToolbarMenu(false) : openToolbarMenu()}
              title="配置工具栏按钮"
            >
              ⋯
            </button>
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

        {/* Intent-to-Code 对话框 */}
        {intentToCode.state.visible && (
          <div className={styles.askAIOverlay}>
            <div className={styles.askAIDialog}>
              <div className={styles.askAIHeader}>
                <span className={styles.askAITitle}>
                  ✏️ 意图编程（{intentToCode.state.mode === 'rewrite' ? '改写' : '生成'}）
                </span>
                {intentToCode.state.selectedRange && (
                  <span className={styles.askAIRange}>
                    第 {intentToCode.state.selectedRange.startLine}
                    {intentToCode.state.selectedRange.endLine !== intentToCode.state.selectedRange.startLine
                      ? `-${intentToCode.state.selectedRange.endLine}`
                      : ''} 行
                  </span>
                )}
                <button className={styles.askAIClose} onClick={intentToCode.close}>×</button>
              </div>

              <pre className={styles.askAICode}>{intentToCode.state.selectedCode}</pre>

              <input
                className={styles.askAIInput}
                placeholder={
                  intentToCode.state.mode === 'rewrite'
                    ? '输入你的意图（例如：添加错误处理）'
                    : '输入你的意图（例如：实现这个函数）'
                }
                value={intentToCode.state.intent}
                onChange={(e) => intentToCode.setIntent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    intentToCode.executeIntent();
                  }
                }}
                autoFocus
              />

              <button
                className={styles.askAISubmit}
                onClick={intentToCode.executeIntent}
                disabled={intentToCode.state.loading || !intentToCode.state.intent.trim()}
              >
                {intentToCode.state.loading ? '⏳ AI 生成中...' : '🚀 执行意图'}
              </button>

              {intentToCode.state.result && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>✨ 生成的代码：</div>
                  <pre className={styles.askAICode}>{intentToCode.state.result.code}</pre>
                  {intentToCode.state.result.explanation && (
                    <div className={styles.askAIAnswerContent}>
                      {intentToCode.state.result.explanation}
                    </div>
                  )}
                  <button
                    className={styles.askAISubmit}
                    onClick={intentToCode.applyResult}
                    style={{ marginTop: '10px' }}
                  >
                    ✅ 应用到编辑器
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Test Generator 对话框 */}
        {testGenerator.state.visible && (
          <div className={styles.askAIOverlay}>
            <div className={styles.askAIDialog}>
              <div className={styles.askAIHeader}>
                <span className={styles.askAITitle}>🧪 测试生成</span>
                <span className={styles.askAIRange}>
                  函数: {testGenerator.state.functionName}
                </span>
                <button className={styles.askAIClose} onClick={testGenerator.close}>×</button>
              </div>

              <pre className={styles.askAICode}>{testGenerator.state.selectedCode}</pre>

              <button
                className={styles.askAISubmit}
                onClick={testGenerator.generate}
                disabled={testGenerator.state.loading}
              >
                {testGenerator.state.loading ? '⏳ AI 生成中...' : '🚀 生成测试'}
              </button>

              {testGenerator.state.result && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>
                    ✨ 测试代码（{testGenerator.state.result.testFramework} - {testGenerator.state.result.testCount} 个用例）：
                  </div>
                  <pre className={styles.askAICode}>{testGenerator.state.result.testCode}</pre>
                  {testGenerator.state.result.explanation && (
                    <div className={styles.askAIAnswerContent}>
                      {testGenerator.state.result.explanation}
                    </div>
                  )}
                  <button
                    className={styles.askAISubmit}
                    onClick={testGenerator.copyToClipboard}
                    style={{ marginTop: '10px' }}
                  >
                    📋 复制到剪贴板
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Smart Diff 对话框 */}
        {smartDiff.state.visible && (
          <div className={styles.askAIOverlay}>
            <div className={styles.askAIDialog}>
              <div className={styles.askAIHeader}>
                <span className={styles.askAITitle}>🔍 语义 Diff 分析</span>
                {smartDiff.state.analysis && (
                  <span className={`${styles.diffImpact} ${styles[`diffImpact_${smartDiff.state.analysis.impact}`]}`}>
                    {smartDiff.state.analysis.impact === 'safe' && '✅ 安全'}
                    {smartDiff.state.analysis.impact === 'warning' && '⚠️ 警告'}
                    {smartDiff.state.analysis.impact === 'danger' && '🚨 危险'}
                  </span>
                )}
                <button className={styles.askAIClose} onClick={smartDiff.close}>×</button>
              </div>

              {smartDiff.state.loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
                  🤖 AI 分析改动中...
                </div>
              ) : smartDiff.state.analysis ? (
                <div style={{ padding: '16px', overflow: 'auto', maxHeight: '500px' }}>
                  {/* 摘要 */}
                  <div className={styles.askAIAnswerLabel}>改动摘要：</div>
                  <div className={styles.askAIAnswerContent} style={{ marginBottom: '16px' }}>
                    {smartDiff.state.analysis.summary}
                  </div>

                  {/* 改动列表 */}
                  {smartDiff.state.analysis.changes.length > 0 && (
                    <>
                      <div className={styles.askAIAnswerLabel}>具体改动：</div>
                      <div style={{ marginBottom: '16px' }}>
                        {smartDiff.state.analysis.changes.map((change, idx) => (
                          <div key={idx} className={styles.diffChange} style={{ marginBottom: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                              <span style={{ fontSize: '14px' }}>
                                {change.type === 'added' && '➕'}
                                {change.type === 'removed' && '➖'}
                                {change.type === 'modified' && '🔄'}
                              </span>
                              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.8)' }}>
                                {change.description}
                              </span>
                            </div>
                            {change.risk && (
                              <div style={{ fontSize: '11px', color: '#ffc107', paddingLeft: '20px' }}>
                                ⚠️ {change.risk}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* 警告列表 */}
                  {smartDiff.state.analysis.warnings.length > 0 && (
                    <>
                      <div className={styles.askAIAnswerLabel}>⚠️ 警告：</div>
                      <div>
                        {smartDiff.state.analysis.warnings.map((warning, idx) => (
                          <div key={idx} className={styles.diffWarning} style={{ marginBottom: '6px' }}>
                            {warning}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Time Machine 对话框 */}
        {timeMachine.state.visible && (
          <div className={styles.overlay} onClick={timeMachine.close}>
            <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
              <div className={styles.dialogHeader}>
                <span className={styles.dialogTitle}>⏰ 代码时光机</span>
                <button className={styles.dialogClose} onClick={timeMachine.close}>
                  ×
                </button>
              </div>

              <div className={styles.dialogBody}>
                {timeMachine.state.loading ? (
                  <div className={styles.dialogLoading}>
                    🤖 正在分析代码历史...
                  </div>
                ) : timeMachine.state.result ? (
                  <>
                    {/* 选中的代码 */}
                    {timeMachine.state.selectedRange && (
                      <div className={styles.timeMachineSelection}>
                        <strong>分析范围</strong>: 第 {timeMachine.state.selectedRange.startLine}-{timeMachine.state.selectedRange.endLine} 行
                      </div>
                    )}

                    {/* Commits 时间线 */}
                    {timeMachine.state.result.commits.length > 0 && (
                      <div className={styles.timeMachineSection}>
                        <h4>📜 提交历史 ({timeMachine.state.result.commits.length} 条)</h4>
                        <div className={styles.timeMachineTimeline}>
                          {timeMachine.state.result.commits.map((commit, idx) => (
                            <div key={idx} className={styles.timeMachineCommit}>
                              <span className={styles.commitHash}>{commit.hash.substring(0, 7)}</span>
                              <span className={styles.commitAuthor}>{commit.author}</span>
                              <span className={styles.commitDate}>{commit.date}</span>
                              <span className={styles.commitMessage}>{commit.message}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI 讲述的演变故事 */}
                    <div className={styles.timeMachineSection}>
                      <h4>📖 演变故事</h4>
                      <div className={styles.timeMachineStory}>{timeMachine.state.result.story}</div>
                    </div>

                    {/* 关键改动 */}
                    {timeMachine.state.result.keyChanges.length > 0 && (
                      <div className={styles.timeMachineSection}>
                        <h4>🔑 关键改动</h4>
                        <div className={styles.timeMachineKeyChanges}>
                          {timeMachine.state.result.keyChanges.map((change, idx) => (
                            <div key={idx} className={styles.timeMachineChange}>
                              <span className={styles.changeDate}>{change.date}</span>
                              <span className={styles.changeDescription}>{change.description}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.dialogError}>无法获取代码历史</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 工具栏配置菜单 (Portal 到 body，避免被 overflow 裁剪) */}
        {showToolbarMenu && createPortal(
          <div
            ref={toolbarMenuRef}
            className={styles.toolbarMenu}
            style={{
              position: 'fixed',
              top: toolbarMenuPos.top,
              right: toolbarMenuPos.right,
            }}
          >
            <div className={styles.toolbarMenuTitle}>工具栏按钮</div>
            {[
              { key: 'autocomplete', label: '⚡ 补全' },
              { key: 'review', label: '🎯 审查' },
              { key: 'conversation', label: '💬 对话' },
              { key: 'intent', label: '✏️ 意图' },
              { key: 'test', label: '🧪 测试' },
              { key: 'diff', label: '🔍 Diff' },
              { key: 'tour', label: '🚀 导游' },
              { key: 'heatmap', label: '🔥 热力图' },
              { key: 'refactor', label: '✨ 重构' },
              { key: 'bubbles', label: '💬 气泡' },
              { key: 'deadcode', label: '💀 死代码' },
              { key: 'pattern', label: '🔍 模式' },
              { key: 'beginner', label: '🎓 新手模式' },
              { key: 'minimap', label: '🗺️ 小地图' },
              { key: 'timemachine', label: '⏰ 时光机' },
              { key: 'apidoc', label: '📚 API' },
            ].map(item => (
              <label key={item.key} className={styles.toolbarMenuItem}>
                <input
                  type="checkbox"
                  checked={visibleButtons.has(item.key)}
                  onChange={() => toggleToolbarButton(item.key)}
                />
                <span>{item.label}</span>
              </label>
            ))}
            <div className={styles.toolbarMenuDivider} />
            <button
              className={styles.toolbarMenuReset}
              onClick={() => {
                setVisibleButtons(new Set(DEFAULT_VISIBLE_BUTTONS));
                localStorage.setItem(TOOLBAR_STORAGE_KEY, JSON.stringify([...DEFAULT_VISIBLE_BUTTONS]));
              }}
            >
              恢复默认
            </button>
          </div>,
          document.body,
        )}
      </div>
    );
  }
);

CodeEditor.displayName = 'CodeEditor';

export default CodeEditor;
