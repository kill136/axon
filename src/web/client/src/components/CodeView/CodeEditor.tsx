import React, { useState, useRef, useImperativeHandle, forwardRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Editor, { OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import styles from './CodeEditor.module.css';
import { FilePreviewPanel } from './FilePreviewPanel';
import { useAIHover, type LineAnalysisData } from '../../hooks/useAIHover';
import { useSelectionExplain } from '../../hooks/useSelectionExplain';
import { useCodeTour } from '../../hooks/useCodeTour';
import { useAskAI } from '../../hooks/useAskAI';
import { useMonacoDecorations } from '../../hooks/useMonacoDecorations';
import { useAutoComplete } from '../../hooks/useAutoComplete';
import { useIntentToCode } from '../../hooks/useIntentToCode';
import { useCodeReview } from '../../hooks/useCodeReview';
import { useTestGenerator } from '../../hooks/useTestGenerator';
import { useCodeConversation } from '../../hooks/useCodeConversation';
import { useSmartDiff } from '../../hooks/useSmartDiff';
import { useLanguage } from '../../i18n/LanguageContext';
import { useDeadCode } from '../../hooks/useDeadCode';
import { useTimeMachine } from '../../hooks/useTimeMachine';
import { usePatternDetector } from '../../hooks/usePatternDetector';
import { useApiDocOverlay } from '../../hooks/useApiDocOverlay';
import { getSyntaxExplanation, extractKeywordsFromLine } from '../../utils/syntaxDictionary';
import { aiHoverApi, TourStep } from '../../api/ai-editor';
import { analyzeCodeStructure } from '../../utils/codeStructureAnalyzer';
import SemanticMap from './SemanticMap';
import { SimpleTerminalTab } from './SimpleTerminalTab';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { sanitizeHtml } from '../../utils/sanitize';

/**
 * CodeEditor Props
 */
export interface CodeEditorProps {
  projectPath?: string;
  onSelectionChange?: (selection: string, filePath: string, startLine: number, endLine: number) => void;
  onActiveFileChange?: (filePath: string | null, content: string, language: string) => void;
  onCursorLineChange?: (line: number) => void;
  send?: (msg: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
  connected?: boolean;
}

/**
 * CodeEditor Ref 接口
 */
export interface CodeEditorRef {
  openFile: (path: string) => void;
  getActiveFilePath: () => string | null;
  getCurrentContent: () => string | null;
  goToLine: (line: number) => void;
  openTerminal: () => void;
}

/**
 * 文件类型定义
 */
type EditorFileType = 'code' | 'image' | 'pdf' | 'excel' | 'word' | 'unsupported' | 'terminal';

/**
 * Tab 状态接口
 */
interface EditorTab {
  id: number;
  path: string;
  content: string;
  language: string;
  modified: boolean;
  originalContent: string;
  fileType: EditorFileType;
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
 * 根据文件扩展名判断文件类型
 */
function getFileType(filePath: string): EditorFileType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';

  // 图片格式
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return 'image';
  }

  // PDF
  if (ext === 'pdf') {
    return 'pdf';
  }

  // Excel
  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return 'excel';
  }

  // Word
  if (['docx', 'doc'].includes(ext)) {
    return 'word';
  }

  // 代码文件
  const codeExts = [
    'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c',
    'css', 'json', 'md', 'yaml', 'yml', 'xml', 'sh', 'sql', 'html',
    'txt', 'toml', 'ini', 'env', 'log', 'java', 'rb', 'php', 'swift',
    'kotlin', 'scala', 'groovy', 'gradle', 'maven', 'pom',
  ];

  if (codeExts.includes(ext)) {
    return 'code';
  }

  // 默认作为代码处理
  return 'code';
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
 * Markdown 预览面板
 */
const MarkdownPreviewPane: React.FC<{ content: string }> = React.memo(({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !content) return;
    const html = marked.parse(content, { gfm: true, breaks: false }) as string;
    containerRef.current.innerHTML = sanitizeHtml(html);
    containerRef.current.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={styles.markdownPreview}
    />
  );
});

/**
 * CodeEditor 组件
 * Monaco Editor 包装器，支持多 Tab、文件打开/保存，集成 AI 增强功能
 */
export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  ({ projectPath, onSelectionChange, onActiveFileChange, onCursorLineChange, send, addMessageHandler, connected }, ref) => {
    const { t, locale } = useLanguage();
    const [tabs, setTabs] = useState<EditorTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
    const tabIdCounterRef = useRef(0);
    const tabsRef = useRef<EditorTab[]>([]);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof Monaco | null>(null);
    // 追踪当前打开的文件路径（供 LSP provider 使用，避免 stale closure）
    const currentTabPathRef = useRef<string | null>(null);

    // 终端 tab 计数器（用于生成唯一路径）
    const terminalCounterRef = useRef(0);
    // 终端 tab 的 terminalId 映射：tabPath -> serverId（state 用于触发渲染）
    const [terminalIdMap, setTerminalIdMap] = useState<Record<string, string | null>>({});
    // 同步版本的 terminalId 映射（ref，不等 React 渲染，避免丢失早期 terminal:output）
    const terminalIdSyncRef = useRef<Record<string, string | null>>({});
    // 待关联的终端 tab 路径队列（FIFO，解决多实例 terminal:created 路由问题）
    const pendingTerminalTabsRef = useRef<string[]>([]);

    // 文件内容缓存：关闭 tab 后再次打开无需重新请求后端
    const fileCacheRef = useRef<Map<string, { content: string; language: string; timestamp: number }>>(new Map());
    const FILE_CACHE_TTL = 5 * 60 * 1000; // 5 分钟过期
    const [lspNotification, setLspNotification] = useState<{
      serverName: string;
      language: string;
      npmPackage: string;
      status: 'missing' | 'installing' | 'done' | 'error';
      message?: string;
    } | null>(null);

    // 同步 tabsRef，供 openFile 闭包使用（避免 stale closure）
    tabsRef.current = tabs;

    // 追踪正在打开的文件路径，防止双击等场景下的竞态重复打开
    const openingFilesRef = useRef<Set<string>>(new Set());

    // Markdown 预览模式：记录哪些 tab 正在预览
    const [markdownPreviewTabs, setMarkdownPreviewTabs] = useState<Set<number>>(new Set());

    const toggleMarkdownPreview = useCallback((tabId: number) => {
      setMarkdownPreviewTabs(prev => {
        const next = new Set(prev);
        if (next.has(tabId)) next.delete(tabId);
        else next.add(tabId);
        return next;
      });
    }, []);

    // AI 功能开关
    const [beginnerMode, setBeginnerMode] = useState(false);
    const [showSemanticMap, setShowSemanticMap] = useState(false);
    const [semanticSteps, setSemanticSteps] = useState<TourStep[]>([]);
    const [currentVisibleLine, setCurrentVisibleLine] = useState(1);
    const [autoCompleteEnabled, setAutoCompleteEnabled] = useState(true);
    const [apiDocEnabled, setApiDocEnabled] = useState(false); // API Doc Overlay 默认关闭
    const [selectionExplainEnabled, setSelectionExplainEnabled] = useState(true); // 选中解释默认开启

    // 工具栏按钮显隐配置
    const TOOLBAR_STORAGE_KEY = 'codeEditor.toolbarButtons';
    const DEFAULT_VISIBLE_BUTTONS = new Set([
      'autocomplete', 'review', 'intent', 'test', 'diff', 'selectionExplain',
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

    // 同步当前文件路径到 ref（供 LSP provider 闭包使用）
    useEffect(() => {
      currentTabPathRef.current = currentTab?.path ?? null;
    }, [currentTab?.path]);

    // Monaco 原生支持的语言（不需要后端 LSP server）
    const MONACO_NATIVE_LANGUAGES = new Set([
      'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
      'json', 'html', 'css', 'scss', 'less', 'plaintext', 'markdown',
    ]);

    // 打开文件时检测该语言是否有可用的 LSP server
    useEffect(() => {
      const lang = currentTab?.language;
      if (!lang || MONACO_NATIVE_LANGUAGES.has(lang)) {
        setLspNotification(null);
        return;
      }
      fetch('/api/lsp/servers')
        .then(r => r.json())
        .then((data: { servers: { name: string; installed: boolean; languages: string[]; npmPackage: string }[] }) => {
          const server = data.servers?.find(s => s.languages.includes(lang));
          if (server && !server.installed) {
            setLspNotification(prev => {
              if (prev?.serverName === server.name && prev.status !== 'missing') return prev;
              return { serverName: server.name, language: lang, npmPackage: server.npmPackage, status: 'missing' };
            });
          } else {
            setLspNotification(null);
          }
        })
        .catch(() => {});
    }, [currentTab?.language]); // eslint-disable-line react-hooks/exhaustive-deps

    // 安装 LSP server（SSE 流式进度）
    const handleInstallLsp = async () => {
      if (!lspNotification) return;
      const { serverName } = lspNotification;
      setLspNotification(prev => prev ? { ...prev, status: 'installing', message: 'Starting...' } : null);
      try {
        const response = await fetch('/api/lsp/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverName }),
        });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value);
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.status === 'success') {
                setLspNotification(prev => prev ? { ...prev, status: 'done', message: data.message } : null);
              } else if (data.status === 'error') {
                setLspNotification(prev => prev ? { ...prev, status: 'error', message: data.message } : null);
              } else {
                setLspNotification(prev => prev ? { ...prev, message: data.message } : null);
              }
            } catch (_e) {}
          }
        }
      } catch (_e) {
        setLspNotification(prev => prev ? { ...prev, status: 'error', message: 'Network error' } : null);
      }
    };

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

    // 选中文本 AI 解释浮动卡片
    const { dispose: disposeSelectionExplain } = useSelectionExplain({
      editorRef,
      monacoRef,
      filePath: currentTab?.path || null,
      enabled: selectionExplainEnabled && editorReady,
      locale,
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

    // 语义地图：内容变化时自动分析代码结构
    useEffect(() => {
      if (!currentTab?.content) {
        setSemanticSteps([]);
        return;
      }
      const steps = analyzeCodeStructure(currentTab.content, currentTab.path);
      setSemanticSteps(steps);
    }, [currentTab?.content, currentTab?.path]);

    // ========================================================================
    // 暴露给父组件的方法
    // ========================================================================

    useImperativeHandle(ref, () => ({
      openFile: async (path: string) => {
        // 使用 ref 检查是否已打开（避免 stale closure 导致重复 tab）
        const existingIndex = tabsRef.current.findIndex(tab => tab.path === path);
        if (existingIndex !== -1) {
          setActiveTabIndex(existingIndex);
          return;
        }

        // 防止双击等场景下的竞态重复打开
        if (openingFilesRef.current.has(path)) {
          return;
        }
        openingFilesRef.current.add(path);

        try {
        const fileType = getFileType(path);

        // ============= 处理图片和 PDF：直接打开，不加载内容 =============
        if (fileType === 'image' || fileType === 'pdf') {
          const newTab: EditorTab = {
            id: tabIdCounterRef.current++,
            path,
            content: '',
            language: '',
            modified: false,
            originalContent: '',
            fileType,
          };
          setTabs(prev => [...prev, newTab]);
          setActiveTabIndex(tabsRef.current.length);
          return;
        }

        // ============= 处理 Excel 和 Word：获取 Blob URL =============
        if (fileType === 'excel' || fileType === 'word') {
          try {
            const response = await fetch(
              `/api/files/download?inline=1&path=${encodeURIComponent(path)}${projectPath ? `&root=${encodeURIComponent(projectPath)}` : ''}`
            );

            if (!response.ok) {
              console.error('[CodeEditor] 读取文件失败');
              alert(t('codeEditor.readFileFailed', { error: 'Failed to read file' }));
              return;
            }

            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const newTab: EditorTab = {
              id: tabIdCounterRef.current++,
              path,
              content: blobUrl,
              language: '',
              modified: false,
              originalContent: '',
              fileType,
            };

            setTabs(prev => [...prev, newTab]);
            setActiveTabIndex(tabsRef.current.length);
          } catch (err) {
            console.error('[CodeEditor] 读取文件异常:', err);
            alert(t('codeEditor.readFileError', { error: err instanceof Error ? err.message : 'Unknown error' }));
          }
          return;
        }

        // ============= 处理代码文件：原有逻辑 =============
        // 优先从缓存加载
        const cached = fileCacheRef.current.get(path);
        if (cached && Date.now() - cached.timestamp < FILE_CACHE_TTL) {
          const newTab: EditorTab = {
            id: tabIdCounterRef.current++,
            path,
            content: cached.content,
            language: cached.language,
            modified: false,
            originalContent: cached.content,
            fileType: 'code',
          };
          setTabs(prev => [...prev, newTab]);
          setActiveTabIndex(tabsRef.current.length);
          return;
        }

        // 从后端加载文件内容
        try {
          const response = await fetch(`/api/files/read?path=${encodeURIComponent(path)}${projectPath ? `&root=${encodeURIComponent(projectPath)}` : ''}`);

          if (!response.ok) {
            const errorData = await response.json();
            console.error('[CodeEditor] 读取文件失败:', errorData.error);
            alert(t('codeEditor.readFileFailed', { error: errorData.error }));
            return;
          }

          const data = await response.json();
          const content = data.content || '';
          const language = getLanguage(path);

          // 写入缓存
          fileCacheRef.current.set(path, { content, language, timestamp: Date.now() });
          // 限制缓存大小（最多 100 个文件）
          if (fileCacheRef.current.size > 100) {
            const oldest = [...fileCacheRef.current.entries()]
              .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) fileCacheRef.current.delete(oldest[0]);
          }

          const newTab: EditorTab = {
            id: tabIdCounterRef.current++,
            path,
            content,
            language,
            modified: false,
            originalContent: content,
            fileType: 'code',
          };

          setTabs(prev => [...prev, newTab]);
          setActiveTabIndex(tabsRef.current.length);
        } catch (err) {
          console.error('[CodeEditor] 读取文件异常:', err);
          alert(t('codeEditor.readFileError', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
        } finally {
          openingFilesRef.current.delete(path);
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
      openTerminal: () => {
        const createTerminalTab = () => {
          terminalCounterRef.current += 1;
          const tabPath = `__terminal__${terminalCounterRef.current}`;
          const terminalTab: EditorTab = {
            id: tabIdCounterRef.current++,
            path: tabPath,
            content: '',
            language: '',
            modified: false,
            originalContent: '',
            fileType: 'terminal',
          };
          const newTabs = [...tabs, terminalTab];
          setTabs(newTabs);
          setActiveTabIndex(newTabs.length - 1);
          // 终端创建由 SimpleTerminalTab 自行处理
        };

        const currentTab = activeTabIndex >= 0 ? tabs[activeTabIndex] : null;
        if (currentTab?.fileType === 'terminal') {
          // 当前已在终端 tab，创建新的终端
          createTerminalTab();
        } else {
          // 否则切到已有的终端 tab，或创建第一个
          const terminalIndex = tabs.findIndex(t => t.fileType === 'terminal');
          if (terminalIndex !== -1) {
            setActiveTabIndex(terminalIndex);
          } else {
            createTerminalTab();
          }
        }
      },
    }));

    // 终端消息路由已移至 SimpleTerminalTab 自行管理，无需 CodeEditor 中间路由

    // 终端 tab 生命周期由 SimpleTerminalTab 自行管理（unmount 时自动 destroy）

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

      // 监听滚动变化（用于语义地图高亮当前可见区域）
      editor.onDidScrollChange(() => {
        const visibleRanges = editor.getVisibleRanges();
        if (visibleRanges.length > 0) {
          // 取可见范围的中心行
          const firstRange = visibleRanges[0];
          const centerLine = Math.floor((firstRange.startLineNumber + firstRange.endLineNumber) / 2);
          setCurrentVisibleLine(centerLine);
        }
      });

      // 监听 Ctrl+S 保存
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSaveCurrentFile();
      });

      // 注册右键菜单 "问 AI" action
      editor.addAction({
        id: 'ask-ai-about-selection',
        label: '\u{1F916} ' + t('codeEditor.askAIAboutCode'),
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0,
        run: () => {
          openAskAI();
        },
      });

      // 注册右键菜单 "意图编程" action
      editor.addAction({
        id: 'intent-to-code',
        label: '✏️ ' + t('codeEditor.intentProgramming'),
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1,
        run: () => {
          intentToCode.openIntent();
        },
      });

      // 注册右键菜单 "生成测试" action
      editor.addAction({
        id: 'generate-test',
        label: '\u{1F9EA} ' + t('codeEditor.generateTest'),
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 2,
        run: () => {
          testGenerator.openGenerator();
        },
      });

      // 注册右键菜单 "代码时光机" action
      editor.addAction({
        id: 'time-machine',
        label: '⏰ ' + t('codeEditor.codeTimeMachine'),
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 3,
        run: () => {
          timeMachine.open();
        },
      });

      // 注册 LSP Definition Provider（Python、Go、Rust 等语言的 Ctrl+Click 跳转定义）
      // TypeScript/JavaScript 由 Monaco 内置语言服务处理，不需要注册
      const lspLanguages = ['python', 'go', 'rust', 'java', 'cpp', 'c', 'csharp', 'ruby', 'php'];
      const lspDisposables = lspLanguages.map(lang =>
        monaco.languages.registerDefinitionProvider(lang, {
          async provideDefinition(model, position) {
            // 从 ref 获取当前文件路径（避免 stale closure）
            const filePath = currentTabPathRef.current;
            if (!filePath) return null;

            try {
              const response = await fetch('/api/lsp/definition', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filePath,
                  line: position.lineNumber - 1,    // Monaco 1-indexed → LSP 0-indexed
                  character: position.column - 1,
                  projectPath: projectPath,
                }),
              });

              if (!response.ok) return null;
              const data = await response.json();
              if (!data.location) return null;

              const { filePath: defPath, line, character } = data.location;
              return {
                uri: monaco.Uri.file(defPath),
                range: new monaco.Range(line + 1, character + 1, line + 1, character + 1),
              };
            } catch {
              return null;
            }
          },
        })
      );

      // 编辑器销毁时清理 provider
      editor.onDidDispose(() => lspDisposables.forEach(d => d.dispose()));
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
          alert(t('codeEditor.saveFailed', { error: errorData.error }));
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
        alert(t('codeEditor.saveError', { error: err instanceof Error ? err.message : 'Unknown error' }));
      }
    };

    // 语义地图：点击区块跳转
    const handleSemanticMapNavigate = (line: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    };

    // 关闭 Tab
    const handleCloseTab = (index: number, e: React.MouseEvent) => {
      e.stopPropagation();

      const tab = tabs[index];
      if (tab.modified) {
        const confirmed = confirm(t('codeEditor.confirmClose', { fileName: getFileName(tab.path) }));
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
            <p className={styles.emptyText}>{t('codeEditor.noFileOpen')}</p>
            <p className={styles.emptyHint}>{t('codeEditor.selectFileHint')}</p>
          </div>
        );
      }

      // Terminal tab：由 editorContainer 中的持久化 SimpleTerminalTab 处理，这里返回 null
      if (currentTab.fileType === 'terminal') {
        return null;
      }

      const showReviewPanel = codeReview.enabled && codeReview.issues.length > 0;
      const showConversationPanel = conversation.state.visible;
      const showPatternPanel = pattern.enabled && pattern.patterns.length > 0;
      const showAnyPanel = showLineDetails || showReviewPanel || showConversationPanel || showPatternPanel;

      return (
        <div className={showAnyPanel ? styles.editorWithPanel : styles.editorFull}>
          {/* 内容区域：根据文件类型渲染不同的预览器 */}
          <div className={styles.monacoContainer}>
            {currentTab.fileType === 'code' && currentTab.language === 'markdown' && markdownPreviewTabs.has(currentTab.id) ? (
              <MarkdownPreviewPane content={currentTab.content} />
            ) : currentTab.fileType === 'code' ? (
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
                  minimap: { enabled: false }, // 禁用 Monaco 内置 minimap，使用自定义语义地图
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
            ) : (
              <FilePreviewPanel
                filePath={currentTab.path}
                fileType={currentTab.fileType}
                content={currentTab.content}
                projectPath={projectPath}
              />
            )}
            {/* LSP server 未安装提示 */}
            {lspNotification && (
              <div style={{
                position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
                backgroundColor: '#1e1e2e', border: '1px solid #3c3c5c', borderRadius: 8,
                padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10,
                zIndex: 100, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontSize: 13, color: '#cdd6f4',
                maxWidth: 500, whiteSpace: 'nowrap',
              }}>
                {lspNotification.status === 'missing' && (<>
                  <span style={{ color: '#fab387' }}>⚠</span>
                  <span>{lspNotification.language} language server not installed</span>
                  <button onClick={handleInstallLsp} style={{ background: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Install {lspNotification.serverName}
                  </button>
                  <button onClick={() => setLspNotification(null)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: 16, padding: '0 2px' }}>×</button>
                </>)}
                {lspNotification.status === 'installing' && (<>
                  <span style={{ color: '#89dceb', animation: 'spin 1s linear infinite' }}>⟳</span>
                  <span>Installing {lspNotification.serverName}...</span>
                  <span style={{ color: '#6c7086', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{lspNotification.message}</span>
                </>)}
                {lspNotification.status === 'done' && (<>
                  <span style={{ color: '#a6e3a1' }}>✓</span>
                  <span>{lspNotification.serverName} installed! Ctrl+Click now works.</span>
                  <button onClick={() => setLspNotification(null)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: 16, padding: '0 2px' }}>×</button>
                </>)}
                {lspNotification.status === 'error' && (<>
                  <span style={{ color: '#f38ba8' }}>✗</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 300 }}>Install failed: {lspNotification.message}</span>
                  <button onClick={() => setLspNotification(null)} style={{ background: 'none', border: 'none', color: '#6c7086', cursor: 'pointer', fontSize: 16, padding: '0 2px' }}>×</button>
                </>)}
              </div>
            )}
          </div>

          {/* 语法详情面板 */}
          {showLineDetails && lineAnalysis && (
            <div className={styles.lineDetailPanel}>
              <div className={styles.lineDetailHeader}>
                <span className={styles.lineDetailTitle}>
                  {t('codeEditor.lineNumber', { line: lineAnalysis.lineNumber })}
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
                  <div className={styles.lineDetailSectionTitle}>🔑 {t('codeEditor.syntaxKeywords')}</div>
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
                <div className={styles.lineDetailLoading}>🤖 {t('codeEditor.aiAnalyzing')}</div>
              )}
              {lineAnalysis.aiAnalysis && (
                <div className={styles.lineDetailSection}>
                  <div className={styles.lineDetailSectionTitle}>🤖 {t('codeEditor.aiAnalysis')}</div>
                  {lineAnalysis.aiAnalysis.brief && (
                    <div className={styles.aiAnalysisBrief}>{lineAnalysis.aiAnalysis.brief}</div>
                  )}
                  {lineAnalysis.aiAnalysis.detail && (
                    <div className={styles.aiAnalysisDetail}>{lineAnalysis.aiAnalysis.detail}</div>
                  )}
                  {lineAnalysis.aiAnalysis.params && lineAnalysis.aiAnalysis.params.length > 0 && (
                    <div className={styles.aiAnalysisParams}>
                      <div className={styles.aiAnalysisParamsTitle}>{t('codeEditor.parameters')}</div>
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
                      <span className={styles.returnsLabel}>{t('codeEditor.returns')}</span>
                      {typeof lineAnalysis.aiAnalysis.returns === 'string'
                        ? lineAnalysis.aiAnalysis.returns
                        : `${lineAnalysis.aiAnalysis.returns.type}: ${lineAnalysis.aiAnalysis.returns.description}`}
                    </div>
                  )}
                  {lineAnalysis.aiAnalysis.examples && lineAnalysis.aiAnalysis.examples.length > 0 && (
                    <div className={styles.aiAnalysisExamples}>
                      <div className={styles.aiAnalysisExamplesTitle}>{t('codeEditor.examples')}</div>
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
                <span className={styles.reviewTitle}>🎯 {t('codeEditor.codeReview')}</span>
                <span className={styles.reviewCount}>{t('codeEditor.issueCount', { count: codeReview.issues.length })}</span>
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
                <span className={styles.conversationTitle}>💬 {t('codeEditor.codeConversation')}</span>
                <button className={styles.conversationClear} onClick={conversation.clear} title={t('codeEditor.clearConversation')}>
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
                    <div className={styles.conversationHintItem} onClick={() => conversation.setInput(t('codeEditor.hintWhatDoesThisCodeDo'))}>
                      💡 {t('codeEditor.hintWhatDoesThisCodeDo')}
                    </div>
                    <div className={styles.conversationHintItem} onClick={() => conversation.setInput(t('codeEditor.hintAlternatives'))}>
                      💡 {t('codeEditor.hintAlternatives')}
                    </div>
                    <div className={styles.conversationHintItem} onClick={() => conversation.setInput(t('codeEditor.hintHowToTest'))}>
                      💡 {t('codeEditor.hintHowToTest')}
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
                          {msg.role === 'user' ? '👤 ' + t('codeEditor.you') : '🤖 ' + t('codeEditor.ai')}
                        </div>
                        <div className={styles.messageContent}>{msg.content}</div>
                      </div>
                    ))}
                  </>
                )}

                {conversation.state.loading && (
                  <div className={styles.assistantMessage}>
                    <div className={styles.messageRole}>🤖 {t('codeEditor.ai')}</div>
                    <div className={styles.messageContent}>🤔 {t('codeEditor.thinking')}</div>
                  </div>
                )}
              </div>

              {/* 输入框 */}
              <div className={styles.conversationInputArea}>
                <textarea
                  className={styles.conversationInput}
                  placeholder={t('codeEditor.inputPlaceholder')}
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
                  {conversation.state.loading ? '⏳ ' + t('codeEditor.sending') : '📤 ' + t('codeEditor.send')}
                </button>
              </div>
            </div>
          )}

          {/* Pattern Detector 面板 */}
          {showPatternPanel && (
            <div className={styles.patternPanel}>
              <div className={styles.patternHeader}>
                <span className={styles.patternTitle}>🔍 {t('codeEditor.codePatterns')}</span>
                <span className={styles.patternCount}>{t('codeEditor.patternCount', { count: pattern.patterns.length })}</span>
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
                        💡 <strong>{t('codeEditor.suggestion')}</strong>: {p.suggestion}
                      </div>
                      <div className={styles.patternLocations}>
                        <strong>{t('codeEditor.location')}</strong>:
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
                            {t('codeEditor.lineRange', { start: loc.line, end: loc.endLine })}
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
                key={tab.id}
                className={`${styles.tab} ${index === activeTabIndex ? styles.active : ''}`}
                onClick={() => setActiveTabIndex(index)}
              >
                <span className={styles.tabName}>
                  {tab.fileType === 'terminal' ? `Terminal ${tab.path.replace('__terminal__', '')}` : getFileName(tab.path)}
                  {tab.modified && <span className={styles.modifiedDot}>●</span>}
                </span>
                <button
                  className={styles.closeButton}
                  onClick={(e) => handleCloseTab(index, e)}
                  aria-label={t('codeEditor.close')}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
            {/* Markdown 预览切换按钮 */}
            {currentTab && currentTab.language === 'markdown' && currentTab.fileType === 'code' && (
              <button
                className={styles.mdPreviewToggle}
                onClick={() => toggleMarkdownPreview(currentTab.id)}
                title={markdownPreviewTabs.has(currentTab.id) ? '切换到源码' : '切换到预览'}
              >
                {markdownPreviewTabs.has(currentTab.id) ? '</>' : '👁 Preview'}
              </button>
            )}
          </div>
        )}

        {/* AI 工具栏 - 终端 tab 不显示 */}
        {currentTab && currentTab.fileType !== 'terminal' && (
          <div className={styles.aiToolbar}>
            <div className={styles.aiToolGroup}>
              {visibleButtons.has('tour') && (
                <button
                  className={`${styles.aiBtn} ${tourState.active ? styles.active : ''}`}
                  onClick={() => tourState.active ? stopTour() : startTour()}
                  disabled={tourState.loading}
                  title={t('codeEditor.tourTitle')}
                >
                  🚀 {t('codeEditor.tour')} {tourState.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('heatmap') && (
                <button
                  className={`${styles.aiBtn} ${heatmap.enabled ? styles.active : ''}`}
                  onClick={heatmap.toggle}
                  disabled={heatmap.loading}
                  title={t('codeEditor.heatmapTitle')}
                >
                  🔥 {t('codeEditor.heatmap')} {heatmap.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('refactor') && (
                <button
                  className={`${styles.aiBtn} ${refactor.enabled ? styles.active : ''}`}
                  onClick={refactor.toggle}
                  disabled={refactor.loading}
                  title={t('codeEditor.refactorTitle')}
                >
                  ✨ {t('codeEditor.refactor')} {refactor.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('bubbles') && (
                <button
                  className={`${styles.aiBtn} ${bubbles.enabled ? styles.active : ''}`}
                  onClick={bubbles.toggle}
                  disabled={bubbles.loading}
                  title={t('codeEditor.bubblesTitle')}
                >
                  💬 {t('codeEditor.bubbles')} {bubbles.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('review') && (
                <button
                  className={`${styles.aiBtn} ${codeReview.enabled ? styles.active : ''}`}
                  onClick={codeReview.toggle}
                  disabled={codeReview.loading}
                  title={t('codeEditor.reviewTitle')}
                >
                  🎯 {t('codeEditor.review')} {codeReview.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('deadcode') && (
                <button
                  className={`${styles.aiBtn} ${deadCode.enabled ? styles.active : ''}`}
                  onClick={deadCode.toggle}
                  disabled={deadCode.loading}
                  title={deadCode.items.length > 0 ? t('codeEditor.deadCodeTitleCount', { count: deadCode.items.length }) : t('codeEditor.deadCodeTitle')}
                >
                  💀 {t('codeEditor.deadCode')} {deadCode.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('pattern') && (
                <button
                  className={`${styles.aiBtn} ${pattern.enabled ? styles.active : ''}`}
                  onClick={pattern.toggle}
                  disabled={pattern.loading}
                  title={pattern.patterns.length > 0 ? t('codeEditor.patternTitleCount', { count: pattern.patterns.length }) : t('codeEditor.patternTitle')}
                >
                  🔍 {t('codeEditor.pattern')} {pattern.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('autocomplete') && (
                <button
                  className={`${styles.aiBtn} ${autoCompleteEnabled ? styles.active : ''}`}
                  onClick={() => setAutoCompleteEnabled(!autoCompleteEnabled)}
                  title={t('codeEditor.autocompleteTitle', { local: autoComplete.stats.localItems, snippets: autoComplete.stats.snippetItems })}
                >
                  ⚡ {t('codeEditor.autocomplete')}
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
                          alert(t('codeEditor.intentAlert'));
                          return;
                        }
                      }
                      intentToCode.openIntent();
                    }
                  }}
                  title={t('codeEditor.intentTitle')}
                >
                  ✏️ {t('codeEditor.intent')}
                </button>
              )}
              {visibleButtons.has('test') && (
                <button
                  className={styles.aiBtn}
                  onClick={testGenerator.openGenerator}
                  title={t('codeEditor.testTitle')}
                >
                  🧪 {t('codeEditor.test')}
                </button>
              )}
              {visibleButtons.has('conversation') && (
                <button
                  className={`${styles.aiBtn} ${conversation.state.visible ? styles.active : ''}`}
                  onClick={() => conversation.state.visible ? conversation.close() : conversation.open()}
                  title={t('codeEditor.conversationTitle')}
                >
                  💬 {t('codeEditor.conversation')}
                </button>
              )}
              {visibleButtons.has('diff') && (
                <button
                  className={styles.aiBtn}
                  onClick={smartDiff.analyze}
                  disabled={smartDiff.state.loading || !currentTab?.modified}
                  title={currentTab?.modified ? t('codeEditor.diffTitle') : t('codeEditor.diffTitleNoChange')}
                >
                  🔍 {t('codeEditor.diff')} {smartDiff.state.loading && '⏳'}
                </button>
              )}
              {visibleButtons.has('beginner') && (
                <button
                  className={`${styles.aiBtn} ${beginnerMode ? styles.active : ''}`}
                  onClick={() => setBeginnerMode(!beginnerMode)}
                  title={t('codeEditor.beginnerTitle')}
                >
                  🎓 {t('codeEditor.beginner')}
                </button>
              )}
              {visibleButtons.has('minimap') && (
                <button
                  className={`${styles.aiBtn} ${showSemanticMap ? styles.active : ''}`}
                  onClick={() => setShowSemanticMap(!showSemanticMap)}
                  title={t('codeEditor.minimapTitle')}
                >
                  🗺️ {t('codeEditor.minimap')}
                </button>
              )}
              {visibleButtons.has('timemachine') && (
                <button
                  className={styles.aiBtn}
                  onClick={timeMachine.open}
                  title={t('codeEditor.timeMachineTitle')}
                >
                  ⏰ {t('codeEditor.timeMachine')}
                </button>
              )}
              {visibleButtons.has('selectionExplain') && (
                <button
                  className={`${styles.aiBtn} ${selectionExplainEnabled ? styles.active : ''}`}
                  onClick={() => setSelectionExplainEnabled(!selectionExplainEnabled)}
                  title={t('codeEditor.selectionExplainTitle')}
                >
                  💬 {t('codeEditor.selectionExplain')}
                </button>
              )}
              {visibleButtons.has('apidoc') && (
                <button
                  className={`${styles.aiBtn} ${apiDocEnabled ? styles.active : ''}`}
                  onClick={() => setApiDocEnabled(!apiDocEnabled)}
                  title={t('codeEditor.apiDocTitle')}
                >
                  📚 {t('codeEditor.apiDoc')}
                </button>
              )}
            </div>

            {/* 工具栏配置按钮 */}
            <span className={styles.toolDivider}></span>
            <button
              ref={toolbarBtnRef}
              className={`${styles.aiBtn} ${showToolbarMenu ? styles.active : ''}`}
              onClick={() => showToolbarMenu ? setShowToolbarMenu(false) : openToolbarMenu()}
              title={t('codeEditor.configureToolbar')}
            >
              ⋯
            </button>
          </div>
        )}

        {/* 编辑器区域 */}
        <div className={styles.editorContainer}>
          {/* 持久化终端实例：每个终端 tab 独立挂载，通过 display 切换可见性 */}
          {send && addMessageHandler && connected !== undefined && tabs
            .filter(t => t.fileType === 'terminal')
            .map(tab => (
              <SimpleTerminalTab
                key={tab.id}
                send={send}
                addMessageHandler={addMessageHandler}
                connected={connected}
                projectPath={projectPath}
                active={currentTab?.path === tab.path}
              />
            ))
          }
          {currentTab?.fileType === 'terminal' ? null : tourState.active ? (
            /* 导游模式：编辑器 + 导游面板 二栏布局 */
            <div className={styles.codeEditorWithTour}>
              <div className={styles.codeEditorMain}>
                {renderEditorBody()}
              </div>

              {/* 导游面板 */}
              <div className={styles.tourPanel}>
                <div className={styles.tourHeader}>
                  <span className={styles.tourTitle}>🚀 {t('codeEditor.codeTour')}</span>
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
                        {t('codeEditor.lineNumber', { line: currentTourStep.line })}
                      </div>
                      <div className={styles.tourDescription}>
                        {currentTourStep.description}
                      </div>
                    </div>
                  )}
                </div>

                <div className={styles.tourStepsList}>
                  <div className={styles.tourStepsTitle}>{t('codeEditor.allSteps')}</div>
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
                    {t('codeEditor.prevStep')}
                  </button>
                  <button
                    className={styles.tourNavBtn}
                    onClick={() => navigate('next')}
                    disabled={tourState.currentStep === tourState.steps.length - 1}
                  >
                    {t('codeEditor.nextStep')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* 普通模式：编辑器 + 可选的语义地图 */
            showSemanticMap ? (
              <div className={styles.editorWithSemanticMap}>
                <div className={styles.editorMainContent}>
                  {renderEditorBody()}
                </div>
                <SemanticMap
                  steps={semanticSteps}
                  currentLine={currentVisibleLine}
                  onNavigate={handleSemanticMapNavigate}
                  totalLines={currentTab?.content.split('\n').length || 0}
                />
              </div>
            ) : (
              renderEditorBody()
            )
          )}
        </div>

        {/* 选中即问 AI 对话框 */}
        {askAIState.visible && (
          <div className={styles.askAIOverlay}>
            <div className={styles.askAIDialog}>
              <div className={styles.askAIHeader}>
                <span className={styles.askAITitle}>🤖 {t('codeEditor.askAI')}</span>
                <span className={styles.askAIRange}>
                  {t('codeEditor.lineRange', { start: askAIState.selectedRange?.startLine, end: askAIState.selectedRange?.endLine })}
                </span>
                <button className={styles.askAIClose} onClick={closeAskAI}>×</button>
              </div>

              <pre className={styles.askAICode}>{askAIState.selectedCode}</pre>

              <input
                className={styles.askAIInput}
                placeholder={t('codeEditor.askAIPlaceholder')}
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
                {askAIState.loading ? '⏳ ' + t('codeEditor.aiThinking') : '🚀 ' + t('codeEditor.submitQuestion')}
              </button>

              {askAIState.answer && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>💡 {t('codeEditor.aiAnswer')}</div>
                  <div className={styles.askAIAnswerContent}>
                    {typeof askAIState.answer === 'string'
                      ? askAIState.answer
                      : JSON.stringify(askAIState.answer)}
                  </div>
                </div>
              )}

              <div className={styles.askAIHints}>
                <div className={styles.askAIHint} onClick={() => setQuestion(t('codeEditor.hintQ1'))}>
                  💡 {t('codeEditor.hint1')}
                </div>
                <div className={styles.askAIHint} onClick={() => setQuestion(t('codeEditor.hintQ2'))}>
                  ⚠️ {t('codeEditor.hint2')}
                </div>
                <div className={styles.askAIHint} onClick={() => setQuestion(t('codeEditor.hintQ3'))}>
                  ✨ {t('codeEditor.hint3')}
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
                  ✏️ {t('codeEditor.intentProgrammingMode', { mode: intentToCode.state.mode === 'rewrite' ? t('codeEditor.modeRewrite') : t('codeEditor.modeGenerate') })}
                </span>
                {intentToCode.state.selectedRange && (
                  <span className={styles.askAIRange}>
                    {t('codeEditor.lineRange', { start: intentToCode.state.selectedRange.startLine, end: intentToCode.state.selectedRange.endLine !== intentToCode.state.selectedRange.startLine ? intentToCode.state.selectedRange.endLine : intentToCode.state.selectedRange.startLine })}
                  </span>
                )}
                <button className={styles.askAIClose} onClick={intentToCode.close}>×</button>
              </div>

              <pre className={styles.askAICode}>{intentToCode.state.selectedCode}</pre>

              <input
                className={styles.askAIInput}
                placeholder={
                  intentToCode.state.mode === 'rewrite'
                    ? t('codeEditor.intentPlaceholderRewrite')
                    : t('codeEditor.intentPlaceholderGenerate')
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
                {intentToCode.state.loading ? '⏳ ' + t('codeEditor.aiGenerating') : '🚀 ' + t('codeEditor.executeIntent')}
              </button>

              {intentToCode.state.result && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>✨ {t('codeEditor.generatedCode')}</div>
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
                    ✅ {t('codeEditor.applyToEditor')}
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
                <span className={styles.askAITitle}>🧪 {t('codeEditor.testGeneration')}</span>
                <span className={styles.askAIRange}>
                  {t('codeEditor.function')}: {testGenerator.state.functionName}
                </span>
                <button className={styles.askAIClose} onClick={testGenerator.close}>×</button>
              </div>

              <pre className={styles.askAICode}>{testGenerator.state.selectedCode}</pre>

              <button
                className={styles.askAISubmit}
                onClick={testGenerator.generate}
                disabled={testGenerator.state.loading}
              >
                {testGenerator.state.loading ? '⏳ ' + t('codeEditor.aiGenerating') : '🚀 ' + t('codeEditor.generateTestBtn')}
              </button>

              {testGenerator.state.result && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>
                    ✨ {t('codeEditor.testCode', { framework: testGenerator.state.result.testFramework, count: testGenerator.state.result.testCount })}
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
                    📋 {t('codeEditor.copyToClipboard')}
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
                <span className={styles.askAITitle}>🔍 {t('codeEditor.semanticDiffAnalysis')}</span>
                {smartDiff.state.analysis && (
                  <span className={`${styles.diffImpact} ${styles[`diffImpact_${smartDiff.state.analysis.impact}`]}`}>
                    {smartDiff.state.analysis.impact === 'safe' && '✅ ' + t('codeEditor.impactSafe')}
                    {smartDiff.state.analysis.impact === 'warning' && '⚠️ ' + t('codeEditor.impactWarning')}
                    {smartDiff.state.analysis.impact === 'danger' && '🚨 ' + t('codeEditor.impactDanger')}
                  </span>
                )}
                <button className={styles.askAIClose} onClick={smartDiff.close}>×</button>
              </div>

              {smartDiff.state.loading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>
                  🤖 {t('codeEditor.analyzingChanges')}
                </div>
              ) : smartDiff.state.analysis ? (
                <div style={{ padding: '16px', overflow: 'auto', maxHeight: '500px' }}>
                  {/* 摘要 */}
                  <div className={styles.askAIAnswerLabel}>{t('codeEditor.changeSummary')}</div>
                  <div className={styles.askAIAnswerContent} style={{ marginBottom: '16px' }}>
                    {smartDiff.state.analysis.summary}
                  </div>

                  {/* 改动列表 */}
                  {smartDiff.state.analysis.changes.length > 0 && (
                    <>
                      <div className={styles.askAIAnswerLabel}>{t('codeEditor.specificChanges')}</div>
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
                      <div className={styles.askAIAnswerLabel}>⚠️ {t('codeEditor.warnings')}</div>
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
                <span className={styles.dialogTitle}>⏰ {t('codeEditor.codeTimeMachineTitle')}</span>
                <button className={styles.dialogClose} onClick={timeMachine.close}>
                  ×
                </button>
              </div>

              <div className={styles.dialogBody}>
                {timeMachine.state.loading ? (
                  <div className={styles.dialogLoading}>
                    🤖 {t('codeEditor.analyzingHistory')}
                  </div>
                ) : timeMachine.state.result ? (
                  <>
                    {/* 选中的代码 */}
                    {timeMachine.state.selectedRange && (
                      <div className={styles.timeMachineSelection}>
                        <strong>{t('codeEditor.analysisRange')}</strong>: {t('codeEditor.lineRange', { start: timeMachine.state.selectedRange.startLine, end: timeMachine.state.selectedRange.endLine })}
                      </div>
                    )}

                    {/* Commits 时间线 */}
                    {timeMachine.state.result.commits.length > 0 && (
                      <div className={styles.timeMachineSection}>
                        <h4>📜 {t('codeEditor.commitHistory', { count: timeMachine.state.result.commits.length })}</h4>
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
                      <h4>📖 {t('codeEditor.evolutionStory')}</h4>
                      <div className={styles.timeMachineStory}>{timeMachine.state.result.story}</div>
                    </div>

                    {/* 关键改动 */}
                    {timeMachine.state.result.keyChanges.length > 0 && (
                      <div className={styles.timeMachineSection}>
                        <h4>🔑 {t('codeEditor.keyChanges')}</h4>
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
                  <div className={styles.dialogError}>{t('codeEditor.cannotGetHistory')}</div>
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
            <div className={styles.toolbarMenuTitle}>{t('codeEditor.toolbarButtons')}</div>
            {[
              { key: 'autocomplete', label: `⚡ ${t('codeEditor.autocomplete')}` },
              { key: 'review', label: `🎯 ${t('codeEditor.review')}` },
              { key: 'conversation', label: `💬 ${t('codeEditor.conversation')}` },
              { key: 'intent', label: `✏️ ${t('codeEditor.intent')}` },
              { key: 'test', label: `🧪 ${t('codeEditor.test')}` },
              { key: 'diff', label: `🔍 ${t('codeEditor.diff')}` },
              { key: 'tour', label: `🚀 ${t('codeEditor.tour')}` },
              { key: 'heatmap', label: `🔥 ${t('codeEditor.heatmap')}` },
              { key: 'refactor', label: `✨ ${t('codeEditor.refactor')}` },
              { key: 'bubbles', label: `💬 ${t('codeEditor.bubbles')}` },
              { key: 'deadcode', label: `💀 ${t('codeEditor.deadCode')}` },
              { key: 'pattern', label: `🔍 ${t('codeEditor.pattern')}` },
              { key: 'beginner', label: `🎓 ${t('codeEditor.beginner')}` },
              { key: 'minimap', label: `🗺️ ${t('codeEditor.minimap')}` },
              { key: 'timemachine', label: `⏰ ${t('codeEditor.timeMachine')}` },
              { key: 'selectionExplain', label: `💬 ${t('codeEditor.selectionExplain')}` },
              { key: 'apidoc', label: `📚 ${t('codeEditor.apiDoc')}` },
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
              {t('codeEditor.restoreDefault')}
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
