import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import styles from './BlueprintDetailContent.module.css';
import { codebaseApi, fileApi, FileTreeNode, NodeAnalysis, FileContent, SymbolAnalysis, projectApi, fileOperationApi, RecentProject, aiHoverApi, AIHoverResult, blueprintApi, taskTreeApi } from '../../../api/blueprint';
import { getSyntaxExplanation, extractKeywordsFromLine, SyntaxExplanation } from '../../../utils/syntaxDictionary';
import { extractJSDocForLine, extractAllJSDocs, clearJSDocCache, ParsedJSDoc, formatJSDocBrief, hasValidJSDoc } from '../../../utils/jsdocParser';
// VS Code 风格组件
import { useProject, useProjectChangeListener, type Project, type BlueprintInfo } from '../../../contexts/ProjectContext';
import { ContextMenu, MenuItem, getFileContextMenuItems, getFolderContextMenuItems, getEmptyContextMenuItems } from '../ContextMenu';
import { FileDialog, DialogType } from '../FileDialog';
import { ArchitectureFlowGraph, type ArchitectureGraphData, type ArchitectureGraphType, type NodePathMapping } from '../ArchitectureFlowGraph';
import { useLanguage } from '../../../i18n/LanguageContext';

// 悬浮框位置状态
interface TooltipPosition {
  x: number;
  y: number;
  visible: boolean;
  path: string | null;
  // 符号相关
  symbol?: CodeSymbol | null;
  symbolFilePath?: string | null;
  // 新增：代码行上下文（用于语法解释）
  lineContent?: string;
  lineNumber?: number;
}

// 三层悬浮提示数据
interface LayeredTooltipData {
  // 第一层：用户注释（JSDoc）
  userComment?: ParsedJSDoc | null;
  // 第二层：语法解释（本地字典，0ms）
  syntaxExplanations: SyntaxExplanation[];
  // 第三层：AI 语义分析（异步加载）
  semanticAnalysis?: SymbolAnalysis | null;
  // 是否正在加载 AI 分析
  loadingAI: boolean;
}

// ============ AI 增强功能类型 ============

// AI 导游步骤
interface TourStep {
  type: 'file' | 'function' | 'class' | 'block';
  name: string;
  line: number;
  endLine?: number;
  description: string;
  importance: 'high' | 'medium' | 'low';
}

// AI 导游状态
interface TourState {
  active: boolean;
  steps: TourStep[];
  currentStep: number;
  loading: boolean;
}

// 选中即问对话
interface AskAIState {
  visible: boolean;
  selectedCode: string;
  selectedRange: { startLine: number; endLine: number } | null;
  question: string;
  answer: string | null;
  loading: boolean;
}

// 代码热力图数据
interface HeatmapData {
  line: number;
  complexity: number; // 0-100
  reason: string;
}

// 重构建议
interface RefactorSuggestion {
  line: number;
  endLine: number;
  type: 'extract' | 'simplify' | 'rename' | 'unused' | 'duplicate' | 'performance' | 'safety';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

// AI 气泡
interface AIBubble {
  line: number;
  message: string;
  type: 'info' | 'warning' | 'tip';
}


interface BlueprintDetailContentProps {
  blueprintId: string;
  onNavigateToSwarm?: () => void;
  onDeleted?: () => void;
  onRefresh?: () => void;
  /** 新建聊天 Tab 的回调 */
  onAddChatTab?: () => void;
  /** 返回主聊天页的回调 */
  onNavigateToChat?: () => void;
}

// 视图模式类型
type ViewMode = 'analysis' | 'code';

// 代码符号类型
interface CodeSymbol {
  name: string;
  kind: 'class' | 'method' | 'function' | 'property' | 'interface' | 'type' | 'const' | 'variable';
  line: number;
  detail?: string;
  children?: CodeSymbol[];
}

/**
 * VS Code 风格的代码仓库浏览器
 *
 * 功能：
 * - 左侧显示真实目录结构
 * - 点击节点时调用 Agent 生成语义分析
 * - 支持代码预览和编辑
 * - 分析结果缓存
 */
export const BlueprintDetailContent: React.FC<BlueprintDetailContentProps> = ({
  blueprintId,
  onNavigateToSwarm,
  onDeleted,
  onRefresh,
  onAddChatTab,
  onNavigateToChat,
}) => {
  const { t } = useLanguage();
  // 目录树
  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  // 展开状态
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['src']));

  // 选中节点
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedIsFile, setSelectedIsFile] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<CodeSymbol | null>(null);

  // 节点分析缓存
  const [analysisCache, setAnalysisCache] = useState<Map<string, NodeAnalysis>>(new Map());

  // 代码符号缓存（文件路径 -> 符号列表）
  const [symbolsCache, setSymbolsCache] = useState<Map<string, CodeSymbol[]>>(new Map());

  // 符号语义分析缓存（key: filePath:symbolName:line）
  const [symbolAnalysisCache, setSymbolAnalysisCache] = useState<Map<string, SymbolAnalysis>>(new Map());

  // 符号分析加载状态
  const [analyzingSymbol, setAnalyzingSymbol] = useState(false);

  // 当前分析状态
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // 视图模式
  const [viewMode, setViewMode] = useState<ViewMode>('analysis');
  // Main panel tab
  const [activeTab, setActiveTab] = useState<'welcome' | 'content'>('welcome');

  // 文件内容相关
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // 代码编辑器 ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // 悬浮框状态
  const [tooltip, setTooltip] = useState<TooltipPosition>({
    x: 0,
    y: 0,
    visible: false,
    path: null,
    symbol: null,
    symbolFilePath: null,
  });
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // 新手模式 ref（用于 Monaco hover provider）
  const beginnerModeRef = useRef<boolean>(true);

  // Hover provider 清理 ref
  const hoverProviderRef = useRef<{ dispose: () => void } | null>(null);

  // 蓝图基本信息
  const [blueprintInfo, setBlueprintInfo] = useState<{
    id: string;
    name: string;
    description: string;
    status: string;
    moduleCount: number;
    version: string;
  } | null>(null);

  // 蓝图操作状态
  const [blueprintOperating, setBlueprintOperating] = useState(false);
  const [blueprintOperationError, setBlueprintOperationError] = useState<string | null>(null);

  // 任务树统计
  const [taskTreeStats, setTaskTreeStats] = useState<{
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    runningTasks: number;
    failedTasks: number;
  } | null>(null);

  // 架构流程图数据（按类型缓存，支持并行加载）
  const [architectureGraphCache, setArchitectureGraphCache] = useState<Map<ArchitectureGraphType, ArchitectureGraphData>>(new Map());
  const [architectureGraphLoadingSet, setArchitectureGraphLoadingSet] = useState<Set<ArchitectureGraphType>>(new Set());
  const [architectureGraphErrorMap, setArchitectureGraphErrorMap] = useState<Map<ArchitectureGraphType, string>>(new Map());
  const [selectedArchitectureType, setSelectedArchitectureType] = useState<ArchitectureGraphType>('full');
  // 架构图节点点击后需要跳转到的行号
  const [targetLine, setTargetLine] = useState<number | null>(null);


  // ============ 新手模式相关状态 ============
  // 新手模式开关（默认开启）
  const [beginnerMode, setBeginnerMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('codeEditor_beginnerMode');
    return saved !== null ? saved === 'true' : true;
  });

  // JSDoc 注释缓存（文件路径 -> 行号 -> JSDoc）
  const [jsdocCache, setJsdocCache] = useState<Map<string, Map<number, ParsedJSDoc>>>(new Map());

  // 三层悬浮提示数据
  const [layeredTooltip, setLayeredTooltip] = useState<LayeredTooltipData>({
    syntaxExplanations: [],
    loadingAI: false,
  });

  // ============ AI 增强功能状态 ============

  // AI 导游模式
  const [tourState, setTourState] = useState<TourState>({
    active: false,
    steps: [],
    currentStep: 0,
    loading: false,
  });

  // 选中即问 AI
  const [askAI, setAskAI] = useState<AskAIState>({
    visible: false,
    selectedCode: '',
    selectedRange: null,
    question: '',
    answer: null,
    loading: false,
  });

  // 代码热力图
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // 重构建议
  const [refactorSuggestions, setRefactorSuggestions] = useState<RefactorSuggestion[]>([]);
  const [refactorEnabled, setRefactorEnabled] = useState(false);
  const [refactorLoading, setRefactorLoading] = useState(false);

  // ============ 右侧行详情面板状态 ============
  // 当前悬停的行号
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  // 行级 AI 分析缓存（filePath:lineNumber -> 分析结果）
  const lineAnalysisCacheRef = useRef<Map<string, {
    lineContent: string;
    keywords: string[];
    aiAnalysis: AIHoverResult | null;
    loading: boolean;
  }>>(new Map());
  // 右侧面板显示的行分析数据
  const [lineAnalysis, setLineAnalysis] = useState<{
    lineNumber: number;
    lineContent: string;
    keywords: Array<{ keyword: string; brief: string; detail?: string; example?: string }>;
    aiAnalysis: AIHoverResult | null;
    loading: boolean;
  } | null>(null);

  // ============ 项目管理和文件操作状态 ============

  // 使用全局 ProjectContext
  const { state: projectState } = useProject();
  
  // 项目根路径
  const [projectRoot, setProjectRoot] = useState<string>('');

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    targetPath: string;
    targetType: 'file' | 'directory' | 'empty';
  }>({
    visible: false,
    x: 0,
    y: 0,
    targetPath: '',
    targetType: 'empty',
  });

  // 文件对话框状态
  const [fileDialog, setFileDialog] = useState<{
    visible: boolean;
    type: DialogType;
    parentPath: string;
    currentName?: string;
  }>({
    visible: false,
    type: 'newFile',
    parentPath: '',
  });

  // ============ 拖拽和剪贴板状态 ============

  // 正在拖拽的项目
  const [draggedItem, setDraggedItem] = useState<{
    path: string;
    type: 'file' | 'directory';
    name: string;
  } | null>(null);

  // 当前拖放目标（高亮显示）
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // 剪贴板（用于复制/剪切粘贴）
  const [clipboardItem, setClipboardItem] = useState<{
    path: string;
    type: 'file' | 'directory';
    name: string;
    operation: 'copy' | 'cut';
  } | null>(null);

  // AI 气泡（默认开启）
  const [aiBubbles, setAiBubbles] = useState<AIBubble[]>([]);
  const [bubblesEnabled, setBubblesEnabled] = useState(true);
  const [bubblesLoading, setBubblesLoading] = useState(false);

  // Monaco 装饰器引用
  const decorationsRef = useRef<string[]>([]);

  // 气泡自动生成标记
  const bubblesGeneratedRef = useRef<string | null>(null);

  // Editor 准备状态（用于触发装饰器更新）
  const [editorReady, setEditorReady] = useState(false);

  // ============ 布局控制状态 ============
  // 左侧边栏折叠状态（默认展开）
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('codeEditor_sidebarCollapsed');
    return saved === 'true';
  });

  // 大纲视图（符号列表）开关（默认关闭）
  const [outlineEnabled, setOutlineEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('codeEditor_outlineEnabled');
    return saved === 'true';
  });

  // 右侧语法详情面板开关（默认开启）
  const [syntaxPanelEnabled, setSyntaxPanelEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('codeEditor_syntaxPanelEnabled');
    return saved !== 'false'; // 默认开启
  });

  // Monaco 小地图开关（默认关闭）
  const [minimapEnabled, setMinimapEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('codeEditor_minimapEnabled');
    return saved === 'true'; // 默认关闭
  });

  // 持久化布局设置
  useEffect(() => {
    localStorage.setItem('codeEditor_sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('codeEditor_outlineEnabled', String(outlineEnabled));
  }, [outlineEnabled]);

  useEffect(() => {
    localStorage.setItem('codeEditor_syntaxPanelEnabled', String(syntaxPanelEnabled));
  }, [syntaxPanelEnabled]);

  useEffect(() => {
    localStorage.setItem('codeEditor_minimapEnabled', String(minimapEnabled));
  }, [minimapEnabled]);

  // 应用 Monaco 装饰器（热力图、重构建议、气泡）
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !editorReady) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const decorations: any[] = [];

    // 热力图装饰器
    if (heatmapEnabled && heatmapData.length > 0) {
      heatmapData.forEach(item => {
        const hue = 120 - (item.complexity * 1.2); // 绿(120) -> 红(0)
        decorations.push({
          range: new monaco.Range(item.line, 1, item.line, 1),
          options: {
            isWholeLine: true,
            className: `heatmap-line-${Math.round(item.complexity / 10)}`,
            glyphMarginClassName: 'heatmap-glyph',
            glyphMarginHoverMessage: { value: `**复杂度: ${item.complexity}%**\n${item.reason}` },
            overviewRuler: {
              color: `hsl(${hue}, 80%, 50%)`,
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        });
      });
    }

    // 重构建议装饰器
    if (refactorEnabled && refactorSuggestions.length > 0) {
      refactorSuggestions.forEach(suggestion => {
        const icon = suggestion.type === 'extract' ? '✂️' :
                     suggestion.type === 'simplify' ? '🔄' :
                     suggestion.type === 'duplicate' ? '📋' :
                     suggestion.type === 'unused' ? '🗑️' : '✨';
        const color = suggestion.priority === 'high' ? '#f44336' :
                     suggestion.priority === 'medium' ? '#ff9800' : '#4caf50';
        decorations.push({
          range: new monaco.Range(suggestion.line, 1, suggestion.line, 1),
          options: {
            glyphMarginClassName: `refactor-glyph refactor-${suggestion.priority}`,
            glyphMarginHoverMessage: { value: `${icon} **${suggestion.message}**` },
            overviewRuler: {
              color: color,
              position: monaco.editor.OverviewRulerLane.Left,
            },
          },
        });
      });
    }

    // AI 气泡装饰器
    if (bubblesEnabled && aiBubbles.length > 0) {
      aiBubbles.forEach(bubble => {
        decorations.push({
          range: new monaco.Range(bubble.line, 1, bubble.line, 1),
          options: {
            glyphMarginClassName: `bubble-glyph bubble-${bubble.type}`,
            glyphMarginHoverMessage: { value: bubble.message },
          },
        });
      });
    }

    // 应用装饰器
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [editorReady, heatmapEnabled, heatmapData, refactorEnabled, refactorSuggestions, bubblesEnabled, aiBubbles]);

  // 保存新手模式设置并更新 ref
  useEffect(() => {
    localStorage.setItem('codeEditor_beginnerMode', String(beginnerMode));
    beginnerModeRef.current = beginnerMode;
  }, [beginnerMode]);

  // Return to welcome when nothing is selected
  useEffect(() => {
    if (!selectedPath && activeTab !== 'welcome') {
      setActiveTab('welcome');
    }
  }, [activeTab, selectedPath]);

  // 组件卸载时清理 hover provider
  useEffect(() => {
    return () => {
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
        hoverProviderRef.current = null;
      }
    };
  }, []);


  /**
   * 加载文件树
   * @param rootPath 指定根目录路径，不传则使用当前项目根目录，都没有则默认 'src'
   */
  const loadFileTree = useCallback(async (rootPath?: string) => {
    try {
      setLoadingTree(true);
      setTreeError(null);

      // 确定根目录：优先使用传入参数，其次使用项目根目录，最后默认 'src'
      const effectiveRoot = rootPath || projectRoot || 'src';

      // 使用封装好的 API 获取目录树
      const tree = await codebaseApi.getFileTree(effectiveRoot);
      setFileTree(tree);
      // 默认展开根目录
      setExpandedPaths(new Set([effectiveRoot]));
    } catch (err: any) {
      setTreeError(err.message);
      // 如果获取失败，使用模拟数据
      setFileTree(createMockFileTree());
    } finally {
      setLoadingTree(false);
    }
  }, [projectRoot]);

  /**
   * 初始化项目：
   * 1. 尝试获取当前工作目录
   * 2. 如果成功，设置项目信息、切换蓝图上下文并加载文件树
   * 3. 如果失败，使用默认的 'src' 目录
   *
   * 蓝图与项目 1:1 绑定，初始化时会自动切换到对应的蓝图
   */
  const initializeProject = useCallback(async () => {
    // 如果已经初始化过，不再重复执行（防止覆盖用户手动选择的项目）
    if (projectInitializedRef.current) {
      return;
    }
    projectInitializedRef.current = true;

    try {
      // 尝试获取当前工作目录
      const cwd = await projectApi.getCurrentWorkingDirectory();
      if (cwd && cwd.path) {
        // 调用 openProject API 切换蓝图上下文
        const result = await projectApi.openProject(cwd.path);

        // 设置项目根路径（项目已由 ProjectContext 管理）
        setProjectRoot(result.path);

        // 更新蓝图信息（如果该项目有关联的蓝图）
        if (result.blueprint) {
          setBlueprintInfo({
            id: result.blueprint.id || result.id,
            name: result.blueprint.name,
            description: '',
            status: result.blueprint.status || 'active',
            moduleCount: 0,
            version: result.blueprint.version || '1.0.0',
          });
        } else {
          setBlueprintInfo(null);
        }

        // 使用当前工作目录加载文件树
        loadFileTree(result.path);
        return;
      }
    } catch (err) {
      console.warn('获取当前工作目录失败，尝试获取最近项目:', err);
    }

    try {
      // 尝试获取最近打开的项目
      const recentProjects = await projectApi.getRecentProjects();
      if (recentProjects && recentProjects.length > 0) {
        const lastProject = recentProjects[0];

        // 调用 openProject API 切换蓝图上下文
        const result = await projectApi.openProject(lastProject.path);

        // 设置项目根路径（项目已由 ProjectContext 管理）
        setProjectRoot(result.path);

        // 更新蓝图信息
        if (result.blueprint) {
          setBlueprintInfo({
            id: result.blueprint.id || result.id,
            name: result.blueprint.name,
            description: '',
            status: result.blueprint.status || 'active',
            moduleCount: 0,
            version: result.blueprint.version || '1.0.0',
          });
        } else {
          setBlueprintInfo(null);
        }

        // 使用最近项目路径加载文件树
        loadFileTree(result.path);
        return;
      }
    } catch (err) {
      console.warn('获取最近项目失败，使用默认目录:', err);
    }

    // 都失败了，使用默认的 'src' 目录
    loadFileTree();
  }, [loadFileTree]);

  const closeContentTab = useCallback(() => {
    setSelectedPath(null);
    setSelectedIsFile(false);
    setSelectedSymbol(null);
    setFileContent(null);
    setHasUnsavedChanges(false);
    setActiveTab('welcome');
  }, []);

  const loadBlueprintInfo = async () => {
    try {
      const response = await fetch(`/api/blueprint/blueprints/${blueprintId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setBlueprintInfo({
            id: data.data.id || blueprintId,
            name: data.data.name,
            description: data.data.description,
            status: data.data.status || 'active',
            moduleCount: data.data.modules?.length || 0,
            version: data.data.version || '1.0.0',
          });

          // 如果蓝图有关联的taskTreeId，则加载任务树统计
          if (data.data.taskTreeId) {
            loadTaskTreeStats(data.data.taskTreeId);
          }
        }
      }
    } catch (err) {
      console.error('加载蓝图信息失败:', err);
    }
  };

  /**
   * 加载任务树统计
   */
  const loadTaskTreeStats = async (taskTreeId: string) => {
    try {
      const stats = await taskTreeApi.getTaskTreeStats(taskTreeId);
      setTaskTreeStats({
        totalTasks: stats.totalTasks || 0,
        completedTasks: stats.completedTasks || 0,
        pendingTasks: stats.pendingTasks || 0,
        runningTasks: stats.runningTasks || 0,
        failedTasks: stats.failedTasks || 0,
      });
    } catch (err) {
      console.error('加载任务树统计失败:', err);
      // 失败时设置为null，不会显示统计
      setTaskTreeStats(null);
    }
  };


  // 加载架构流程图（AI 生成，支持并行加载多种类型）
  const loadArchitectureGraph = useCallback(async (type: ArchitectureGraphType, forceRefresh: boolean = false) => {
    console.log(`[ArchitectureGraph] 开始加载: type=${type}, forceRefresh=${forceRefresh}`);

    // 如果已有缓存且非强制刷新，直接使用缓存
    if (!forceRefresh && architectureGraphCache.has(type)) {
      console.log(`[ArchitectureGraph] 使用缓存: type=${type}`);
      setSelectedArchitectureType(type);
      return;
    }

    // 将当前类型添加到加载中集合
    setArchitectureGraphLoadingSet(prev => {
      const newSet = new Set(prev);
      newSet.add(type);
      console.log(`[ArchitectureGraph] 添加到加载集合: type=${type}, loadingSet size=${newSet.size}`);
      return newSet;
    });
    // 清除该类型的错误状态
    setArchitectureGraphErrorMap(prev => {
      const newMap = new Map(prev);
      newMap.delete(type);
      return newMap;
    });
    setSelectedArchitectureType(type);

    try {
      const url = `/api/blueprint/blueprints/${blueprintId}/architecture-graph?type=${type}${forceRefresh ? '&forceRefresh=true' : ''}`;
      console.log(`[ArchitectureGraph] 发送请求: ${url}`);

      const response = await fetch(url);
      console.log(`[ArchitectureGraph] 响应状态: ${response.status} ${response.statusText}`);

      // 检查HTTP状态码
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ArchitectureGraph] HTTP错误: ${response.status}`, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      const result = await response.json();
      console.log(`[ArchitectureGraph] 响应结果: success=${result.success}`);

      if (result.success) {
        // 更新缓存
        setArchitectureGraphCache(prev => {
          const newMap = new Map(prev);
          newMap.set(type, result.data);
          console.log(`[ArchitectureGraph] 缓存已更新: type=${type}, data length=${result.data?.mermaidCode?.length || 0}`);
          return newMap;
        });
      } else {
        throw new Error(result.error || 'AI 生成架构图失败');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'AI 生成架构图失败';
      console.error(`[ArchitectureGraph] 错误:`, err);
      // 设置该类型的错误状态
      setArchitectureGraphErrorMap(prev => {
        const newMap = new Map(prev);
        newMap.set(type, errorMsg);
        console.log(`[ArchitectureGraph] 错误已设置: type=${type}, error=${errorMsg}`);
        return newMap;
      });
    } finally {
      // 从加载中集合移除当前类型
      setArchitectureGraphLoadingSet(prev => {
        const newSet = new Set(prev);
        newSet.delete(type);
        console.log(`[ArchitectureGraph] 从加载集合移除: type=${type}, loadingSet size=${newSet.size}`);
        return newSet;
      });
    }
  }, [blueprintId, architectureGraphCache]);


  // 组件挂载时初始化项目和蓝图信息
  useEffect(() => {
    // initializeProject(); // 已禁用：项目现在由全局 ProjectContext 管理
    loadBlueprintInfo();
  }, [blueprintId]);

  // 模拟目录树（当 API 不可用时）
  const createMockFileTree = (): FileTreeNode => ({
    name: 'src',
    path: 'src',
    type: 'directory',
    children: [
      { name: 'agents', path: 'src/agents', type: 'directory', children: [] },
      { name: 'blueprint', path: 'src/blueprint', type: 'directory', children: [] },
      { name: 'commands', path: 'src/commands', type: 'directory', children: [] },
      { name: 'config', path: 'src/config', type: 'directory', children: [] },
      { name: 'core', path: 'src/core', type: 'directory', children: [
        { name: 'client.ts', path: 'src/core/client.ts', type: 'file' },
        { name: 'loop.ts', path: 'src/core/loop.ts', type: 'file' },
        { name: 'session.ts', path: 'src/core/session.ts', type: 'file' },
      ]},
      { name: 'hooks', path: 'src/hooks', type: 'directory', children: [] },
      { name: 'tools', path: 'src/tools', type: 'directory', children: [] },
      { name: 'ui', path: 'src/ui', type: 'directory', children: [] },
      { name: 'web', path: 'src/web', type: 'directory', children: [] },
      { name: 'cli.ts', path: 'src/cli.ts', type: 'file' },
      { name: 'index.ts', path: 'src/index.ts', type: 'file' },
    ],
  });

  // 分析节点
  const analyzeNode = useCallback(async (path: string) => {
    // 检查缓存
    if (analysisCache.has(path)) {
      return;
    }

    setAnalyzing(true);
    setAnalysisError(null);

    try {
      // 使用封装好的 API 分析节点
      const analysis = await codebaseApi.analyzeNode(path, blueprintId);
      setAnalysisCache(prev => new Map(prev).set(path, analysis));
    } catch (err: any) {
      setAnalysisError(err.message);
      // 生成模拟分析结果
      const mockAnalysis = createMockAnalysis(path);
      setAnalysisCache(prev => new Map(prev).set(path, mockAnalysis));
    } finally {
      setAnalyzing(false);
    }
  }, [blueprintId, analysisCache]);

  // ============ 文件操作处理函数 ============

  /**
   * 处理右键菜单
   */
  const handleContextMenu = useCallback((
    e: React.MouseEvent,
    path: string,
    type: 'file' | 'directory' | 'empty'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      targetPath: path,
      targetType: type,
    });
  }, []);

  /**
   * 关闭右键菜单
   */
  const closeContextMenu = useCallback(() => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  }, []);

  /**
   * 创建新文件
   */
  const handleCreateFile = useCallback(async (name: string) => {
    const filePath = fileDialog.parentPath ? `${fileDialog.parentPath}/${name}` : name;
    try {
      await fileOperationApi.createFile(filePath);
      // 刷新文件树
      loadFileTree();
      setFileDialog(prev => ({ ...prev, visible: false }));
    } catch (err: any) {
      console.error('创建文件失败:', err);
      alert(t('bdc.createFileFailed', { error: err.message }));
    }
  }, [fileDialog.parentPath]);

  /**
   * 创建新文件夹
   */
  const handleCreateDirectory = useCallback(async (name: string) => {
    const dirPath = fileDialog.parentPath ? `${fileDialog.parentPath}/${name}` : name;
    try {
      await fileOperationApi.createDirectory(dirPath);
      // 刷新文件树
      loadFileTree();
      setFileDialog(prev => ({ ...prev, visible: false }));
    } catch (err: any) {
      console.error('创建文件夹失败:', err);
      alert(t('bdc.createFolderFailed', { error: err.message }));
    }
  }, [fileDialog.parentPath]);

  /**
   * 重命名文件/文件夹
   */
  const handleRename = useCallback(async (newName: string) => {
    const oldPath = fileDialog.parentPath;
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;
    try {
      await fileOperationApi.rename(oldPath, newPath);
      // 刷新文件树
      loadFileTree();
      setFileDialog(prev => ({ ...prev, visible: false }));
    } catch (err: any) {
      console.error('重命名失败:', err);
      alert(t('bdc.renameFailed', { error: err.message }));
    }
  }, [fileDialog.parentPath]);

  /**
   * 删除文件/文件夹
   */
  const handleDelete = useCallback(async () => {
    const targetPath = contextMenu.targetPath;
    if (!confirm(t('bdc.confirmDelete', { path: targetPath }))) {
      return;
    }
    try {
      await fileOperationApi.delete(targetPath);
      // 刷新文件树
      loadFileTree();
      // 如果删除的是当前选中的，清除选择
      if (selectedPath === targetPath || selectedPath?.startsWith(targetPath + '/')) {
        closeContentTab();
      }
    } catch (err: any) {
      console.error('删除失败:', err);
      alert(t('bdc.deleteFailed', { error: err.message }));
    }
  }, [closeContentTab, contextMenu.targetPath, selectedPath]);

  /**
   * 复制路径到剪贴板
   */
  const handleCopyPath = useCallback(async (relativePath: boolean = false) => {
    const path = relativePath ? contextMenu.targetPath : `${projectRoot}/${contextMenu.targetPath}`;
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error('复制失败:', err);
    }
  }, [contextMenu.targetPath, projectRoot]);

  // ============ 拖拽和剪贴板处理 ============

  /**
   * 拖拽开始
   */
  const handleDragStart = useCallback((e: React.DragEvent, path: string, type: 'file' | 'directory', name: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
    setDraggedItem({ path, type, name });
  }, []);

  /**
   * 拖拽经过目标
   */
  const handleDragOver = useCallback((e: React.DragEvent, targetPath: string, targetType: 'file' | 'directory') => {
    e.preventDefault();
    e.stopPropagation();

    // 只有文件夹才能作为拖放目标
    if (targetType !== 'directory') return;

    // 不能拖放到自己或自己的子目录
    if (draggedItem && (targetPath === draggedItem.path || targetPath.startsWith(draggedItem.path + '/'))) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.dataTransfer.dropEffect = 'move';
    setDropTarget(targetPath);
  }, [draggedItem]);

  /**
   * 拖拽离开目标
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
  }, []);

  /**
   * 拖拽放下
   */
  const handleDrop = useCallback(async (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);

    if (!draggedItem) return;

    // 不能拖放到自己或自己的子目录
    if (targetPath === draggedItem.path || targetPath.startsWith(draggedItem.path + '/')) {
      return;
    }

    // 计算目标路径
    const newPath = `${targetPath}/${draggedItem.name}`;

    try {
      await fileOperationApi.move(draggedItem.path, newPath);
      loadFileTree();

      // 如果移动的是当前选中的，更新选择
      if (selectedPath === draggedItem.path) {
        setSelectedPath(newPath);
      }
    } catch (err: any) {
      console.error('移动失败:', err);
      alert(t('bdc.moveFailed', { error: err.message }));
    }

    setDraggedItem(null);
  }, [draggedItem, selectedPath]);

  /**
   * 拖拽结束
   */
  const handleDragEnd = useCallback(() => {
    setDraggedItem(null);
    setDropTarget(null);
  }, []);

  /**
   * 复制文件/文件夹到剪贴板
   */
  const handleCopyItem = useCallback((path: string, type: 'file' | 'directory') => {
    const name = path.substring(path.lastIndexOf('/') + 1);
    setClipboardItem({ path, type, name, operation: 'copy' });
  }, []);

  /**
   * 剪切文件/文件夹到剪贴板
   */
  const handleCutItem = useCallback((path: string, type: 'file' | 'directory') => {
    const name = path.substring(path.lastIndexOf('/') + 1);
    setClipboardItem({ path, type, name, operation: 'cut' });
  }, []);

  /**
   * 粘贴文件/文件夹
   */
  const handlePaste = useCallback(async (targetDir: string) => {
    if (!clipboardItem) return;

    const newPath = `${targetDir}/${clipboardItem.name}`;

    try {
      if (clipboardItem.operation === 'copy') {
        await fileOperationApi.copy(clipboardItem.path, newPath);
      } else {
        await fileOperationApi.move(clipboardItem.path, newPath);
        // 剪切后清空剪贴板
        setClipboardItem(null);
      }
      loadFileTree();
    } catch (err: any) {
      console.error('粘贴失败:', err);
      alert(t('bdc.pasteFailed', { error: err.message }));
    }
  }, [clipboardItem]);

  /**
   * 键盘快捷键处理（Ctrl+C, Ctrl+X, Ctrl+V）
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 只在没有输入框焦点时处理
      const activeElement = document.activeElement;
      if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      // 只有选中了文件/文件夹才处理
      if (!selectedPath) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        handleCopyItem(selectedPath, selectedIsFile ? 'file' : 'directory');
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        e.preventDefault();
        handleCutItem(selectedPath, selectedIsFile ? 'file' : 'directory');
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        // 粘贴到选中的文件夹，或者选中文件的父目录
        if (clipboardItem) {
          let targetDir = selectedPath;
          if (selectedIsFile) {
            // 如果选中的是文件，获取其父目录
            const lastSlash = selectedPath.lastIndexOf('/');
            targetDir = lastSlash > 0 ? selectedPath.substring(0, lastSlash) : 'src';
          }
          handlePaste(targetDir);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedPath, selectedIsFile, clipboardItem, handleCopyItem, handleCutItem, handlePaste]);

  /**
   * 获取当前的右键菜单项
   */
  const getContextMenuItems = useCallback((): MenuItem[] => {
    const { targetPath, targetType } = contextMenu;

    if (targetType === 'file') {
      return getFileContextMenuItems({
        onOpen: () => {
          handleSelectNode(targetPath, true);
          closeContextMenu();
        },
        onCut: () => {
          handleCutItem(targetPath, 'file');
          closeContextMenu();
        },
        onCopy: () => {
          handleCopyItem(targetPath, 'file');
          closeContextMenu();
        },
        onRename: () => {
          const name = targetPath.substring(targetPath.lastIndexOf('/') + 1);
          setFileDialog({
            visible: true,
            type: 'rename',
            parentPath: targetPath,
            currentName: name,
          });
          closeContextMenu();
        },
        onDelete: () => {
          handleDelete();
          closeContextMenu();
        },
        onCopyPath: () => {
          handleCopyPath(false);
          closeContextMenu();
        },
        onCopyRelativePath: () => {
          handleCopyPath(true);
          closeContextMenu();
        },
        onRevealInExplorer: () => {
          // 在系统资源管理器中显示（通过后端API）
          window.open(`file://${projectRoot}/${targetPath}`, '_blank');
          closeContextMenu();
        },
      });
    }

    if (targetType === 'directory') {
      return getFolderContextMenuItems({
        onNewFile: () => {
          setFileDialog({
            visible: true,
            type: 'newFile',
            parentPath: targetPath,
          });
          closeContextMenu();
        },
        onNewFolder: () => {
          setFileDialog({
            visible: true,
            type: 'newFolder',
            parentPath: targetPath,
          });
          closeContextMenu();
        },
        onCut: () => {
          handleCutItem(targetPath, 'directory');
          closeContextMenu();
        },
        onCopy: () => {
          handleCopyItem(targetPath, 'directory');
          closeContextMenu();
        },
        onPaste: () => {
          handlePaste(targetPath);
          closeContextMenu();
        },
        canPaste: clipboardItem !== null,
        onRename: () => {
          const name = targetPath.substring(targetPath.lastIndexOf('/') + 1);
          setFileDialog({
            visible: true,
            type: 'rename',
            parentPath: targetPath,
            currentName: name,
          });
          closeContextMenu();
        },
        onDelete: () => {
          handleDelete();
          closeContextMenu();
        },
        onCopyPath: () => {
          handleCopyPath(false);
          closeContextMenu();
        },
        onCopyRelativePath: () => {
          handleCopyPath(true);
          closeContextMenu();
        },
        onRevealInExplorer: () => {
          window.open(`file://${projectRoot}/${targetPath}`, '_blank');
          closeContextMenu();
        },
        onCollapseAll: () => {
          setExpandedPaths(new Set());
          closeContextMenu();
        },
      });
    }

    // 空白区域
    return getEmptyContextMenuItems({
      onNewFile: () => {
        setFileDialog({
          visible: true,
          type: 'newFile',
          parentPath: 'src',
        });
        closeContextMenu();
      },
      onNewFolder: () => {
        setFileDialog({
          visible: true,
          type: 'newFolder',
          parentPath: 'src',
        });
        closeContextMenu();
      },
      onRefresh: () => {
        loadFileTree();
        closeContextMenu();
      },
      onCollapseAll: () => {
        setExpandedPaths(new Set());
        closeContextMenu();
      },
    });
  }, [contextMenu, handleDelete, handleCopyPath, handleCutItem, handleCopyItem, handlePaste, clipboardItem, closeContextMenu, projectRoot, loadFileTree]);


  /**
   * 监听全局项目切换事件
   */
  useProjectChangeListener(
    useCallback((project: Project | null, blueprint: BlueprintInfo | null) => {
      if (project) {
        console.log('[BlueprintDetailContent] 项目切换:', project.path);
        setProjectRoot(project.path);
        
        // 更新蓝图信息
        if (blueprint) {
          setBlueprintInfo({
            id: blueprint.id,
            name: blueprint.name,
            description: '',
            status: 'active',
            moduleCount: 0,
            version: blueprint.version,
          });
        } else {
          setBlueprintInfo(null);
        }
        
        // 重新加载文件树
        loadFileTree(project.path);
        
        // 通知父组件刷新蓝图列表
        onRefresh?.();
      }
    }, [loadFileTree, onRefresh])
  );

  /**
   * 初始化时同步当前项目
   * 如果ProjectContext中已有项目，立即同步到蓝图Tab
   */
  useEffect(() => {
    if (projectState.currentProject && !projectInitializedRef.current) {
      console.log('[BlueprintDetailContent] 初始化同步项目:', projectState.currentProject.path);
      setProjectRoot(projectState.currentProject.path);
      
      // 同步蓝图信息
      if (projectState.currentBlueprint) {
        setBlueprintInfo({
          id: projectState.currentBlueprint.id,
          name: projectState.currentBlueprint.name,
          description: '',
          status: 'active',
          moduleCount: 0,
          version: projectState.currentBlueprint.version,
        });
      }
      
      // 加载文件树
      loadFileTree(projectState.currentProject.path);
      
      // 标记已初始化，避免被旧的initializeProject覆盖
      projectInitializedRef.current = true;
    }
  }, [projectState.currentProject, projectState.currentBlueprint, loadFileTree]);

  // 解析代码符号
  const parseCodeSymbols = useCallback((content: string, filePath: string): CodeSymbol[] => {
    const symbols: CodeSymbol[] = [];
    const lines = content.split('\n');

    // 解析类
    const classRegex = /^export\s+(?:abstract\s+)?class\s+(\w+)/;
    // 解析接口
    const interfaceRegex = /^export\s+interface\s+(\w+)/;
    // 解析类型别名
    const typeRegex = /^export\s+type\s+(\w+)/;
    // 解析函数
    const functionRegex = /^export\s+(?:async\s+)?function\s+(\w+)/;
    // 解析常量
    const constRegex = /^export\s+const\s+(\w+)/;
    // 解析方法（类内部）
    const methodRegex = /^\s+(?:async\s+)?(\w+)\s*\(/;
    // 解析属性（类内部）
    const propertyRegex = /^\s+(?:private|public|protected)?\s*(\w+):\s*(.+);/;

    let currentClass: CodeSymbol | null = null;
    let classStartLine = -1;

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      const lineNumber = index + 1;

      // 类定义
      const classMatch = line.match(classRegex);
      if (classMatch) {
        currentClass = {
          name: classMatch[1],
          kind: 'class',
          line: lineNumber,
          children: [],
        };
        symbols.push(currentClass);
        classStartLine = index;
        return;
      }

      // 接口定义
      const interfaceMatch = line.match(interfaceRegex);
      if (interfaceMatch) {
        symbols.push({
          name: interfaceMatch[1],
          kind: 'interface',
          line: lineNumber,
        });
        return;
      }

      // 类型别名
      const typeMatch = line.match(typeRegex);
      if (typeMatch) {
        symbols.push({
          name: typeMatch[1],
          kind: 'type',
          line: lineNumber,
        });
        return;
      }

      // 函数定义
      const functionMatch = line.match(functionRegex);
      if (functionMatch) {
        symbols.push({
          name: functionMatch[1],
          kind: 'function',
          line: lineNumber,
        });
        return;
      }

      // 常量定义
      const constMatch = line.match(constRegex);
      if (constMatch) {
        symbols.push({
          name: constMatch[1],
          kind: 'const',
          line: lineNumber,
        });
        return;
      }

      // 类内部的成员（方法和属性）
      if (currentClass && classStartLine >= 0) {
        // 检测类结束
        if (trimmedLine === '}' && index > classStartLine) {
          currentClass = null;
          classStartLine = -1;
          return;
        }

        // 方法
        const methodMatch = line.match(methodRegex);
        if (methodMatch && !trimmedLine.startsWith('//')) {
          currentClass.children = currentClass.children || [];
          currentClass.children.push({
            name: methodMatch[1],
            kind: 'method',
            line: lineNumber,
          });
          return;
        }

        // 属性
        const propertyMatch = line.match(propertyRegex);
        if (propertyMatch) {
          currentClass.children = currentClass.children || [];
          currentClass.children.push({
            name: propertyMatch[1],
            kind: 'property',
            line: lineNumber,
            detail: propertyMatch[2],
          });
          return;
        }
      }
    });

    return symbols;
  }, []);

  // 加载文件内容
  const loadFileContent = useCallback(async (path: string) => {
    setLoadingFile(true);
    setFileError(null);

    try {
      const content = await fileApi.getContent(path);
      setFileContent(content);
      setEditedContent(content.content);
      setHasUnsavedChanges(false);

      // 预热 JSDoc 缓存（异步，不阻塞 UI）
      setTimeout(() => {
        extractAllJSDocs(content.content, path);
        console.log(`[Cache] JSDoc 预热完成: ${path}`);
      }, 100);

      // 解析代码符号
      const symbols = parseCodeSymbols(content.content, path);
      setSymbolsCache(prev => new Map(prev).set(path, symbols));
    } catch (err: any) {
      setFileError(err.message);
      setFileContent(null);
    } finally {
      setLoadingFile(false);
    }
  }, [parseCodeSymbols]);

  // 架构图节点点击处理：跳转到对应文件/文件夹
  const handleArchitectureNodeClick = useCallback((nodeId: string, mapping: NodePathMapping) => {
    console.log('[BlueprintDetailContent] 架构图节点点击:', nodeId, mapping);

    // 在文件树中选中该路径
    if (mapping.type === 'file' || mapping.type === 'folder') {
      const isFile = mapping.type === 'file';

      // 检查是否有未保存的更改
      if (hasUnsavedChanges) {
        const confirmed = window.confirm(t('snippets.unsavedConfirm'));
        if (!confirmed) return;
      }

      // 设置选中路径
      setSelectedPath(mapping.path);
      setSelectedIsFile(isFile);
      setActiveTab('content');
      setHasUnsavedChanges(false);
      setEditorReady(false);

      // 展开父级目录
      const pathParts = mapping.path.split('/');
      const parentPaths: string[] = [];
      for (let i = 1; i < pathParts.length; i++) {
        parentPaths.push(pathParts.slice(0, i).join('/'));
      }
      setExpandedPaths(prev => {
        const next = new Set(prev);
        parentPaths.forEach(p => next.add(p));
        return next;
      });

      if (isFile) {
        // 文件：加载内容
        loadFileContent(mapping.path);
        if (!analysisCache.has(mapping.path)) {
          analyzeNode(mapping.path);
        }

        // 如果有行号，设置目标行号等待编辑器加载后跳转
        if (mapping.line) {
          setTargetLine(mapping.line);
        }
      } else {
        // 目录：触发语义分析
        if (!analysisCache.has(mapping.path)) {
          analyzeNode(mapping.path);
        }
      }
    }
  }, [hasUnsavedChanges, analysisCache, analyzeNode, loadFileContent]);

  // 编辑器加载后跳转到目标行
  useEffect(() => {
    if (targetLine && editorRef.current) {
      // 延迟一点确保编辑器内容已加载
      const timer = setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.revealLineInCenter(targetLine);
          editorRef.current.setPosition({ lineNumber: targetLine, column: 1 });
          editorRef.current.focus();
        }
        setTargetLine(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [targetLine, fileContent]);

  // 保存文件
  const saveFile = async () => {
    if (!selectedPath || !hasUnsavedChanges) return;

    setSaving(true);
    try {
      await fileApi.saveContent(selectedPath, editedContent);
      setHasUnsavedChanges(false);
      // 更新缓存的文件内容
      if (fileContent) {
        setFileContent({
          ...fileContent,
          content: editedContent,
          modifiedAt: new Date().toISOString(),
        });
      }

      // 清除该文件相关的符号分析缓存（文件已修改）
      setSymbolAnalysisCache(prev => {
        const newCache = new Map(prev);
        // 遍历并删除该文件的所有符号分析缓存
        for (const key of newCache.keys()) {
          if (key.startsWith(`${selectedPath}:`)) {
            newCache.delete(key);
          }
        }
        return newCache;
      });

      // 同时清除节点分析缓存
      setAnalysisCache(prev => {
        const newCache = new Map(prev);
        newCache.delete(selectedPath);
        return newCache;
      });

      console.log(`[SaveFile] 已清除 ${selectedPath} 的分析缓存`);
    } catch (err: any) {
      setFileError(`保存失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 模拟分析结果
  const createMockAnalysis = (path: string): NodeAnalysis => {
    const name = path.split('/').pop() || path;
    const isFile = name.includes('.');

    if (isFile) {
      return {
        path,
        name,
        type: 'file',
        summary: `${name} 文件`,
        description: `这是 ${path} 文件。点击"重新分析"按钮来获取 AI 生成的详细语义分析。`,
        exports: ['(点击生成分析查看)'],
        dependencies: ['(点击生成分析查看)'],
        techStack: ['TypeScript'],
        keyPoints: ['需要 AI 分析来获取详细信息'],
        analyzedAt: new Date().toISOString(),
      };
    }

    return {
      path,
      name,
      type: 'directory',
      summary: `${name} 模块目录`,
      description: `这是 ${path} 目录。点击"重新分析"按钮来获取 AI 生成的详细语义分析。`,
      responsibilities: ['(点击生成分析查看)'],
      techStack: ['TypeScript'],
      children: [],
      analyzedAt: new Date().toISOString(),
    };
  };

  // 选中节点
  const handleSelectNode = (path: string, isFile: boolean) => {
    // 检查是否有未保存的更改
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(t('snippets.unsavedConfirm'));
      if (!confirmed) return;
    }

    setSelectedPath(path);
    setSelectedIsFile(isFile);
    setActiveTab('content');
    setHasUnsavedChanges(false);
    setEditorReady(false); // 重置 editor 状态，等待新 editor 挂载

    if (isFile) {
      // 文件：加载内容，同时也触发语义分析（用于悬浮框显示）
      loadFileContent(path);
      if (!analysisCache.has(path)) {
        analyzeNode(path);
      }
    } else {
      // 目录：触发语义分析
      if (!analysisCache.has(path)) {
        analyzeNode(path);
      }
    }
  };

  // 切换展开
  const toggleExpand = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // 处理鼠标进入文件/文件夹节点
  const handleNodeMouseEnter = useCallback((e: React.MouseEvent, path: string) => {
    // 清除之前的定时器
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }

    // 延迟300ms显示悬浮框，避免快速移动时频繁显示
    tooltipTimeoutRef.current = setTimeout(() => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const sidebarRect = sidebarRef.current?.getBoundingClientRect();

      // 计算悬浮框位置（显示在节点右侧）
      let x = sidebarRect ? sidebarRect.right + 8 : rect.right + 8;
      let y = rect.top;

      // 悬浮框尺寸（根据 CSS 定义）
      const tooltipWidth = 480;  // max-width
      const tooltipHeight = 400; // 估计高度

      // 检查右边界，如果超出则显示在左侧
      if (x + tooltipWidth > window.innerWidth - 16) {
        x = Math.max(16, (sidebarRect ? sidebarRect.left : rect.left) - tooltipWidth - 8);
      }

      // 检查底部边界，如果超出则向上调整
      if (y + tooltipHeight > window.innerHeight - 16) {
        y = Math.max(16, window.innerHeight - tooltipHeight - 16);
      }

      setTooltip({
        x,
        y,
        visible: true,
        path,
      });

      // 触发分析（如果还没有缓存）
      if (!analysisCache.has(path)) {
        analyzeNode(path);
      }
    }, 300);
  }, [analysisCache, analyzeNode]);

  // 用于追踪鼠标是否在悬浮框上
  const isMouseOnTooltipRef = useRef(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 用于防止初始化函数覆盖用户手动选择的项目
  const projectInitializedRef = useRef<boolean>(false);

  // 处理鼠标离开文件/文件夹节点
  const handleNodeMouseLeave = useCallback(() => {
    // 清除显示定时器
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    // 清除之前的隐藏定时器
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    // 延迟隐藏，让用户有时间移动到悬浮框上
    hideTimeoutRef.current = setTimeout(() => {
      if (!isMouseOnTooltipRef.current) {
        setTooltip(prev => ({ ...prev, visible: false }));
      }
    }, 150);
  }, []);

  // 处理鼠标进入悬浮框（保持显示）
  const handleTooltipMouseEnter = useCallback(() => {
    isMouseOnTooltipRef.current = true;
    // 清除所有定时器
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // 处理鼠标离开悬浮框
  const handleTooltipMouseLeave = useCallback(() => {
    isMouseOnTooltipRef.current = false;
    // 延迟隐藏，给用户一点缓冲时间
    hideTimeoutRef.current = setTimeout(() => {
      setTooltip(prev => ({ ...prev, visible: false }));
    }, 100);
  }, []);

  // 分析符号语义（调用 AI API）- 返回分析结果避免闭包问题
  const analyzeSymbol = useCallback(async (symbol: CodeSymbol, filePath: string): Promise<SymbolAnalysis | null> => {
    const cacheKey = `${filePath}:${symbol.name}:${symbol.line}`;

    // 检查缓存
    if (symbolAnalysisCache.has(cacheKey)) {
      return symbolAnalysisCache.get(cacheKey) || null;
    }

    setAnalyzingSymbol(true);
    try {
      const result = await codebaseApi.analyzeSymbol({
        filePath,
        symbolName: symbol.name,
        symbolKind: symbol.kind,
        lineNumber: symbol.line,
        detail: symbol.detail,
      });

      // 保存到缓存
      setSymbolAnalysisCache(prev => {
        const newCache = new Map(prev);
        newCache.set(cacheKey, result);
        return newCache;
      });

      return result; // 返回结果，避免闭包问题
    } catch (error) {
      console.error('[Analyze Symbol] 分析失败:', error);
      return null;
    } finally {
      setAnalyzingSymbol(false);
    }
  }, [symbolAnalysisCache]);

  // 计算分层悬浮提示数据（本地计算，0ms）
  const computeLayeredTooltip = useCallback((
    symbol: CodeSymbol,
    filePath: string,
    content: string
  ): Partial<LayeredTooltipData> => {
    const result: Partial<LayeredTooltipData> = {
      syntaxExplanations: [],
      loadingAI: false,
    };

    // 第一层：提取 JSDoc 注释
    const jsdoc = extractJSDocForLine(content, symbol.line, filePath);
    if (hasValidJSDoc(jsdoc)) {
      result.userComment = jsdoc;
    }

    // 第二层：提取符号所在行的语法关键字
    const lines = content.split('\n');
    if (symbol.line > 0 && symbol.line <= lines.length) {
      const lineContent = lines[symbol.line - 1];
      const keywords = extractKeywordsFromLine(lineContent);
      result.syntaxExplanations = keywords
        .map(kw => getSyntaxExplanation(kw))
        .filter((exp): exp is SyntaxExplanation => exp !== undefined);
    }

    // 第三层：检查缓存中是否有 AI 分析
    const cacheKey = `${filePath}:${symbol.name}:${symbol.line}`;
    const cachedAnalysis = symbolAnalysisCache.get(cacheKey);
    if (cachedAnalysis) {
      result.semanticAnalysis = cachedAnalysis;
    }

    return result;
  }, [symbolAnalysisCache]);

  // 处理鼠标进入代码符号节点
  const handleSymbolMouseEnter = useCallback((e: React.MouseEvent, symbol: CodeSymbol, filePath: string) => {
    // 清除之前的定时器
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }

    // 延迟显示悬浮框
    tooltipTimeoutRef.current = setTimeout(() => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const sidebarRect = sidebarRef.current?.getBoundingClientRect();

      let x = sidebarRect ? sidebarRect.right + 8 : rect.right + 8;
      let y = rect.top;

      // 悬浮框尺寸（根据 CSS 定义）
      const tooltipWidth = 480;  // max-width
      const tooltipHeight = 400; // 估计高度

      // 检查右边界，如果超出则显示在左侧
      if (x + tooltipWidth > window.innerWidth - 16) {
        x = Math.max(16, (sidebarRect ? sidebarRect.left : rect.left) - tooltipWidth - 8);
      }

      // 检查底部边界，如果超出则向上调整
      if (y + tooltipHeight > window.innerHeight - 16) {
        y = Math.max(16, window.innerHeight - tooltipHeight - 16);
      }

      // 立即计算本地数据（0ms）
      const content = editedContent || fileContent?.content || '';
      const localData = computeLayeredTooltip(symbol, filePath, content);

      // 更新分层提示数据
      setLayeredTooltip({
        userComment: localData.userComment,
        syntaxExplanations: localData.syntaxExplanations || [],
        semanticAnalysis: localData.semanticAnalysis,
        loadingAI: !localData.semanticAnalysis, // 如果没有缓存，标记为加载中
      });

      setTooltip({
        x,
        y,
        visible: true,
        path: null,
        symbol,
        symbolFilePath: filePath,
      });

      // 异步触发 AI 符号分析（如果还没有缓存）
      const cacheKey = `${filePath}:${symbol.name}:${symbol.line}`;
      if (!symbolAnalysisCache.has(cacheKey)) {
        analyzeSymbol(symbol, filePath).then((newAnalysis) => {
          // AI 分析完成后更新 - 直接使用返回值避免闭包问题
          if (newAnalysis) {
            setLayeredTooltip(prev => ({
              ...prev,
              semanticAnalysis: newAnalysis,
              loadingAI: false,
            }));
          }
        });
      }
    }, 300);
  }, [symbolAnalysisCache, analyzeSymbol, computeLayeredTooltip, editedContent, fileContent]);

  // 处理鼠标离开代码符号节点
  const handleSymbolMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      if (!isMouseOnTooltipRef.current) {
        setTooltip(prev => ({ ...prev, visible: false }));
      }
    }, 150);
  }, []);

  // 获取当前选中节点的分析
  const currentAnalysis = selectedPath ? analysisCache.get(selectedPath) : null;

  // 重新生成分析
  const regenerateAnalysis = async () => {
    if (!selectedPath) return;

    setAnalyzing(true);
    setAnalysisError(null);

    try {
      // 1. 清除前端缓存
      setAnalysisCache(prev => {
        const next = new Map(prev);
        next.delete(selectedPath);
        return next;
      });

      // 2. 清除后端缓存
      await fetch('/api/blueprint/cache/path', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath }),
      });

      // 3. 重新分析
      await analyzeNode(selectedPath);
    } catch (err: any) {
      setAnalysisError(t('bdc.reanalyzeFailed', { error: err.message }));
    } finally {
      setAnalyzing(false);
    }
  };

  // 处理代码编辑
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setEditedContent(newContent);
    setHasUnsavedChanges(newContent !== fileContent?.content);
  };

  // 处理 Tab 键（插入制表符）
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newValue = editedContent.substring(0, start) + '  ' + editedContent.substring(end);
        setEditedContent(newValue);
        setHasUnsavedChanges(true);
        // 恢复光标位置
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }, 0);
      }
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveFile();
    }
  };

  // 获取符号图标
  const getSymbolIcon = (kind: CodeSymbol['kind']): string => {
    switch (kind) {
      case 'class': return '🏛️';
      case 'interface': return '📋';
      case 'type': return '🔤';
      case 'function': return '🔧';
      case 'method': return '⚙️';
      case 'property': return '🔹';
      case 'const': return '💎';
      case 'variable': return '📦';
      default: return '•';
    }
  };

  // 渲染代码符号
  const renderCodeSymbol = (symbol: CodeSymbol, filePath: string, depth: number): React.ReactNode => {
    const symbolKey = `${filePath}:${symbol.name}:${symbol.line}`;
    const isExpanded = expandedPaths.has(symbolKey);
    const isSelected = selectedSymbol?.name === symbol.name && selectedSymbol?.line === symbol.line;
    const hasChildren = symbol.children && symbol.children.length > 0;

    return (
      <div key={symbolKey}>
        <div
          className={`${styles.treeItem} ${styles.symbolItem} ${isSelected ? styles.selected : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedSymbol(symbol);
            setSelectedPath(filePath);
            setActiveTab('content');
            // 跳转到代码行
            if (editorRef.current) {
              editorRef.current.revealLineInCenter(symbol.line);
              editorRef.current.setPosition({ lineNumber: symbol.line, column: 1 });
              editorRef.current.focus();
            }
            // 如果有子项，切换展开状态
            if (hasChildren) {
              toggleExpand(symbolKey);
            }
          }}
          onMouseEnter={(e) => handleSymbolMouseEnter(e, symbol, filePath)}
          onMouseLeave={handleSymbolMouseLeave}
        >
          <span className={styles.treeIcon}>
            {hasChildren ? (isExpanded ? '▼' : '▶') : '　'}
          </span>
          <span className={styles.fileIcon}>{getSymbolIcon(symbol.kind)}</span>
          <span className={styles.treeName}>{symbol.name}</span>
          <span className={styles.symbolLine}>:{symbol.line}</span>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {symbol.children!.map(child => renderCodeSymbol(child, filePath, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // 渲染目录树节点
  const renderTreeNode = (node: FileTreeNode, depth: number = 0): React.ReactNode => {
    const hasChildren = node.type === 'directory' && node.children && node.children.length > 0;
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = selectedPath === node.path && !selectedSymbol;
    const isAnalyzed = analysisCache.has(node.path);
    const symbols = node.type === 'file' ? symbolsCache.get(node.path) : undefined;
    const hasSymbols = symbols && symbols.length > 0;

    // 拖拽相关状态
    const isDragging = draggedItem?.path === node.path;
    const isDropTarget = dropTarget === node.path && node.type === 'directory';
    const isCutItem = clipboardItem?.path === node.path && clipboardItem?.operation === 'cut';

    return (
      <div key={node.path}>
        <div
          className={`${styles.treeItem} ${isSelected ? styles.selected : ''} ${isAnalyzed ? styles.analyzed : ''} ${isDragging ? styles.dragging : ''} ${isDropTarget ? styles.dropTarget : ''} ${isCutItem ? styles.cutItem : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          // 拖拽属性
          draggable={true}
          onDragStart={(e) => handleDragStart(e, node.path, node.type, node.name)}
          onDragOver={(e) => handleDragOver(e, node.path, node.type)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.path)}
          onDragEnd={handleDragEnd}
          onClick={() => {
            if (node.type === 'directory') {
              toggleExpand(node.path);
            } else {
              // 文件：展开/折叠符号列表
              toggleExpand(node.path);
            }
            handleSelectNode(node.path, node.type === 'file');
            setSelectedSymbol(null); // 清除符号选择
          }}
          onContextMenu={(e) => handleContextMenu(e, node.path, node.type)}
          onMouseEnter={(e) => handleNodeMouseEnter(e, node.path)}
          onMouseLeave={handleNodeMouseLeave}
        >
          <span className={styles.treeIcon}>
            {node.type === 'directory' ? (isExpanded ? '▼' : '▶') :
             (hasSymbols && outlineEnabled) ? (isExpanded ? '▼' : '▶') : '　'}
          </span>
          <span className={styles.fileIcon}>
            {node.type === 'directory' ? (isExpanded ? '📂' : '📁') : getFileIcon(node.name)}
          </span>
          <span className={styles.treeName}>{node.name}</span>
          {isAnalyzed && <span className={styles.analyzedDot}>●</span>}
        </div>
        {/* 目录的子节点 */}
        {node.type === 'directory' && hasChildren && isExpanded && (
          <div>
            {node.children!.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
        {/* 文件的代码符号（大纲视图）- 受 outlineEnabled 控制 */}
        {node.type === 'file' && hasSymbols && isExpanded && outlineEnabled && (
          <div>
            {symbols!.map(symbol => renderCodeSymbol(symbol, node.path, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // 获取文件图标
  const getFileIcon = (name: string): string => {
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return '📘';
    if (name.endsWith('.js') || name.endsWith('.jsx')) return '📒';
    if (name.endsWith('.css')) return '🎨';
    if (name.endsWith('.json')) return '📋';
    if (name.endsWith('.md')) return '📝';
    return '📄';
  };

  // 获取 Monaco 编辑器语言
  const getMonacoLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const languageMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'json': 'json',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'md': 'markdown',
      'py': 'python',
      'java': 'java',
      'go': 'go',
      'rs': 'rust',
      'c': 'c',
      'cpp': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'sh': 'shell',
      'bash': 'shell',
      'yaml': 'yaml',
      'yml': 'yaml',
      'xml': 'xml',
      'sql': 'sql',
      'graphql': 'graphql',
      'vue': 'vue',
      'svelte': 'svelte',
    };
    return languageMap[ext] || 'plaintext';
  };

  // Monaco Editor 挂载回调
  const handleEditorDidMount = (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorReady(true);

    // 配置 TypeScript/JavaScript 语言服务（用于跳转支持）
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      allowJs: true,
      typeRoots: ['node_modules/@types'],
    });

    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      allowJs: true,
    });

    // 启用诊断
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    // 注册自定义定义提供器（用于跨文件跳转）
    const languages = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'];
    languages.forEach(lang => {
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model: any, position: any) => {
          const word = model.getWordAtPosition(position);
          if (!word) return null;

          const lineContent = model.getLineContent(position.lineNumber);

          // 检测 import 语句
          const importMatch = lineContent.match(/from\s+['"]([^'"]+)['"]/);
          if (importMatch) {
            const importPath = importMatch[1];
            // 解析相对路径
            let targetPath = importPath;
            if (importPath.startsWith('.')) {
              const currentDir = selectedPath?.split('/').slice(0, -1).join('/') || '';
              targetPath = resolveRelativePath(currentDir, importPath);
            }

            // 尝试添加扩展名
            const extensions = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
            for (const ext of extensions) {
              const fullPath = targetPath + ext;
              // 检查文件是否存在（通过尝试加载）
              try {
                const response = await fetch(`/api/blueprint/file/content?path=${encodeURIComponent(fullPath)}`);
                if (response.ok) {
                  // 找到文件，跳转并选中该文件
                  handleSelectNode(fullPath, true);
                  return null; // 返回 null，因为我们已经手动处理了跳转
                }
              } catch {
                continue;
              }
            }
          }

          return null;
        }
      });
    });

    // 添加键盘快捷键
    editor.addAction({
      id: 'custom-save',
      label: '保存文件',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        saveFile();
      }
    });

    editor.addAction({
      id: 'custom-goto-definition',
      label: '跳转到定义',
      keybindings: [monaco.KeyCode.F12],
      run: () => {
        editor.trigger('keyboard', 'editor.action.revealDefinition', null);
      }
    });

    // 双击跳转到定义
    editor.onMouseDown((e) => {
      if (e.event.detail === 2) { // 双击
        const position = e.target.position;
        if (position) {
          // 延迟执行，让默认的双击选中完成
          setTimeout(() => {
            editor.trigger('keyboard', 'editor.action.revealDefinition', null);
          }, 100);
        }
      }
    });

    // 添加右键菜单 - "问AI"选项
    editor.addAction({
      id: 'ask-ai-about-selection',
      label: '🤖 问 AI 关于这段代码',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 0,
      run: () => {
        handleAskAI();
      }
    });

    // 清理旧的 Hover Provider（防止重复注册导致多个提示框）
    if (hoverProviderRef.current) {
      hoverProviderRef.current.dispose();
      hoverProviderRef.current = null;
    }

    // 前端 AI Hover 缓存
    const aiHoverCache = new Map<string, AIHoverResult>();

    // 格式化 AI Hover 结果为 Markdown
    const formatAIHoverResult = (result: AIHoverResult): string[] => {
      const contents: string[] = [];

      if (result.brief) {
        contents.push(`**🤖 AI 文档** ${result.fromCache ? '*(缓存)*' : ''}`);
        contents.push(result.brief);
      }

      if (result.detail) {
        contents.push(`\n*${result.detail}*`);
      }

      // 参数说明
      if (result.params && result.params.length > 0) {
        contents.push(`\n**参数：**`);
        result.params.forEach(p => {
          contents.push(`- \`${p.name}\`: ${p.type} - ${p.description}`);
        });
      }

      // 返回值
      if (result.returns) {
        contents.push(`\n**返回值：** ${result.returns.type} - ${result.returns.description}`);
      }

      // 使用示例
      if (result.examples && result.examples.length > 0) {
        contents.push(`\n**示例：**`);
        result.examples.forEach(ex => {
          contents.push(`\`\`\`typescript\n${ex}\n\`\`\``);
        });
      }

      // 注意事项
      if (result.notes && result.notes.length > 0) {
        contents.push(`\n**注意：**`);
        result.notes.forEach(note => {
          contents.push(`- ${note}`);
        });
      }

      return contents;
    };

    // 注册增强的 Hover Provider（精简悬浮 + 右侧面板详情）
    const hoverProvider = monaco.languages.registerHoverProvider(['typescript', 'javascript', 'typescriptreact', 'javascriptreact'], {
      provideHover: async (model: any, position: any) => {
        // 只在新手模式下增强
        if (!beginnerModeRef.current) return null;

        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const lineNumber = position.lineNumber;
        const lineContent = model.getLineContent(lineNumber);
        const range = new monaco.Range(lineNumber, word.startColumn, lineNumber, word.endColumn);

        // 提取行内所有关键字
        const keywords = extractKeywordsFromLine(lineContent);
        const keywordExplanations = keywords
          .map(kw => getSyntaxExplanation(kw))
          .filter((exp): exp is SyntaxExplanation => exp !== undefined);

        // 当前单词的解释
        const currentWordExp = getSyntaxExplanation(word.word);

        // 更新右侧面板（以行为单位）
        const cacheKey = `${selectedPath}:${lineNumber}`;
        const cached = lineAnalysisCacheRef.current.get(cacheKey);

        // 如果缓存的行内容不同，清除缓存
        if (cached && cached.lineContent !== lineContent) {
          lineAnalysisCacheRef.current.delete(cacheKey);
        }

        // 更新当前悬停行
        setHoverLine(lineNumber);

        // 立即显示静态内容到右侧面板
        const staticKeywords = keywordExplanations.map(exp => ({
          keyword: exp.keyword,
          brief: exp.brief,
          detail: exp.detail,
          example: exp.example,
        }));

        // 检查缓存
        const existingCache = lineAnalysisCacheRef.current.get(cacheKey);
        if (existingCache && existingCache.lineContent === lineContent) {
          // 使用缓存数据
          setLineAnalysis({
            lineNumber,
            lineContent,
            keywords: staticKeywords,
            aiAnalysis: existingCache.aiAnalysis,
            loading: existingCache.loading,
          });
        } else {
          // 显示静态内容，标记 AI 加载中
          setLineAnalysis({
            lineNumber,
            lineContent,
            keywords: staticKeywords,
            aiAnalysis: null,
            loading: true,
          });

          // 缓存初始状态
          lineAnalysisCacheRef.current.set(cacheKey, {
            lineContent,
            keywords: keywords,
            aiAnalysis: null,
            loading: true,
          });

          // 异步调用 AI 分析整行
          (async () => {
            try {
              // 获取上下文（±5行），并在每行前加行号，用 >>> 标记当前行
              const startLine = Math.max(1, lineNumber - 5);
              const endLine = Math.min(model.getLineCount(), lineNumber + 5);
              const contextLines: string[] = [];
              for (let i = startLine; i <= endLine; i++) {
                const prefix = i === lineNumber ? '>>>' : '   ';
                const lineNum = String(i).padStart(4, ' ');
                contextLines.push(`${prefix} ${lineNum} | ${model.getLineContent(i)}`);
              }

              const aiResult = await aiHoverApi.generate({
                filePath: selectedPath || '',
                symbolName: lineContent.trim(),  // 使用当前行的实际代码作为符号名
                codeContext: contextLines.join('\n'),
                line: lineNumber,
                language: 'typescript',
              });

              // 更新缓存
              lineAnalysisCacheRef.current.set(cacheKey, {
                lineContent,
                keywords: keywords,
                aiAnalysis: aiResult.success ? aiResult : null,
                loading: false,
              });

              // 如果仍在当前行，更新面板
              setLineAnalysis(prev => {
                if (prev && prev.lineNumber === lineNumber) {
                  return {
                    ...prev,
                    aiAnalysis: aiResult.success ? aiResult : null,
                    loading: false,
                  };
                }
                return prev;
              });
            } catch (error) {
              console.warn('[AI Line Analysis] 调用失败:', error);
              lineAnalysisCacheRef.current.set(cacheKey, {
                lineContent,
                keywords: keywords,
                aiAnalysis: null,
                loading: false,
              });
              setLineAnalysis(prev => {
                if (prev && prev.lineNumber === lineNumber) {
                  return { ...prev, loading: false };
                }
                return prev;
              });
            }
          })();
        }

        // 悬浮框只显示简短的一行摘要
        if (currentWordExp) {
          return {
            range,
            contents: [{ value: `**${currentWordExp.keyword}** - ${currentWordExp.brief}` }]
          };
        }

        // 非关键字：显示"查看右侧面板"提示
        if (word.word.length > 1 && !/^\d+$/.test(word.word)) {
          return {
            range,
            contents: [{ value: `\`${word.word}\` → 详情见右侧面板` }]
          };
        }

        return null;
      }
    });

    // 保存到 ref，以便后续清理
    hoverProviderRef.current = hoverProvider;
  };

  // 解析相对路径
  const resolveRelativePath = (basePath: string, relativePath: string): string => {
    const baseParts = basePath.split('/').filter(Boolean);
    const relativeParts = relativePath.split('/');

    for (const part of relativeParts) {
      if (part === '..') {
        baseParts.pop();
      } else if (part !== '.') {
        baseParts.push(part);
      }
    }

    return baseParts.join('/');
  };

  // ============ AI 增强功能实现 ============

  /**
   * 拆分驼峰命名为可读文本
   */
  const splitCamelCase = (str: string): string => {
    return str
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim()
      .toLowerCase();
  };

  /**
   * 根据命名推断代码职责
   */
  const inferPurposeFromName = (name: string): string => {
    // 常见命名模式
    const patterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
      // 动作类
      [/^handle(\w+)$/, (m) => `处理 ${splitCamelCase(m[1])} 事件`],
      [/^on(\w+)$/, (m) => `响应 ${splitCamelCase(m[1])} 事件`],
      [/^get(\w+)$/, (m) => `获取 ${splitCamelCase(m[1])}`],
      [/^set(\w+)$/, (m) => `设置 ${splitCamelCase(m[1])}`],
      [/^fetch(\w+)$/, (m) => `请求 ${splitCamelCase(m[1])} 数据`],
      [/^load(\w+)$/, (m) => `加载 ${splitCamelCase(m[1])}`],
      [/^save(\w+)$/, (m) => `保存 ${splitCamelCase(m[1])}`],
      [/^create(\w+)$/, (m) => `创建 ${splitCamelCase(m[1])}`],
      [/^update(\w+)$/, (m) => `更新 ${splitCamelCase(m[1])}`],
      [/^delete(\w+)$/, (m) => `删除 ${splitCamelCase(m[1])}`],
      [/^remove(\w+)$/, (m) => `移除 ${splitCamelCase(m[1])}`],
      [/^add(\w+)$/, (m) => `添加 ${splitCamelCase(m[1])}`],
      [/^init(\w*)$/, (m) => m[1] ? `初始化 ${splitCamelCase(m[1])}` : '执行初始化'],
      [/^parse(\w+)$/, (m) => `解析 ${splitCamelCase(m[1])}`],
      [/^format(\w+)$/, (m) => `格式化 ${splitCamelCase(m[1])}`],
      [/^validate(\w+)$/, (m) => `验证 ${splitCamelCase(m[1])}`],
      [/^check(\w+)$/, (m) => `检查 ${splitCamelCase(m[1])}`],
      [/^is(\w+)$/, (m) => `判断是否 ${splitCamelCase(m[1])}`],
      [/^has(\w+)$/, (m) => `判断是否有 ${splitCamelCase(m[1])}`],
      [/^can(\w+)$/, (m) => `判断能否 ${splitCamelCase(m[1])}`],
      [/^should(\w+)$/, (m) => `判断是否应该 ${splitCamelCase(m[1])}`],
      [/^render(\w*)$/, (m) => m[1] ? `渲染 ${splitCamelCase(m[1])}` : '执行渲染'],
      [/^use(\w+)$/, (m) => `${splitCamelCase(m[1])} Hook`],
      [/^with(\w+)$/, (m) => `附加 ${splitCamelCase(m[1])} 能力的高阶组件`],
      // 角色类后缀
      [/(\w+)Manager$/, (m) => `${splitCamelCase(m[1])} 管理器`],
      [/(\w+)Service$/, (m) => `${splitCamelCase(m[1])} 服务`],
      [/(\w+)Controller$/, (m) => `${splitCamelCase(m[1])} 控制器`],
      [/(\w+)Handler$/, (m) => `${splitCamelCase(m[1])} 处理器`],
      [/(\w+)Provider$/, (m) => `${splitCamelCase(m[1])} 提供者`],
      [/(\w+)Factory$/, (m) => `${splitCamelCase(m[1])} 工厂`],
      [/(\w+)Builder$/, (m) => `${splitCamelCase(m[1])} 构建器`],
      [/(\w+)Helper$/, (m) => `${splitCamelCase(m[1])} 辅助工具`],
      [/(\w+)Util(?:s)?$/, (m) => `${splitCamelCase(m[1])} 工具函数`],
      [/(\w+)Coordinator$/, (m) => `${splitCamelCase(m[1])} 协调器，负责多组件间的协作调度`],
      [/(\w+)Registry$/, (m) => `${splitCamelCase(m[1])} 注册表`],
      [/(\w+)Pool$/, (m) => `${splitCamelCase(m[1])} 池`],
      [/(\w+)Queue$/, (m) => `${splitCamelCase(m[1])} 队列`],
      [/(\w+)Cache$/, (m) => `${splitCamelCase(m[1])} 缓存`],
      [/(\w+)Store$/, (m) => `${splitCamelCase(m[1])} 状态存储`],
      [/(\w+)Context$/, (m) => `${splitCamelCase(m[1])} 上下文`],
      [/(\w+)Reducer$/, (m) => `${splitCamelCase(m[1])} 状态管理 Reducer`],
      [/(\w+)Middleware$/, (m) => `${splitCamelCase(m[1])} 中间件`],
      [/(\w+)Plugin$/, (m) => `${splitCamelCase(m[1])} 插件`],
      [/(\w+)Adapter$/, (m) => `${splitCamelCase(m[1])} 适配器`],
      [/(\w+)Wrapper$/, (m) => `${splitCamelCase(m[1])} 包装器`],
      [/(\w+)Listener$/, (m) => `${splitCamelCase(m[1])} 监听器`],
      [/(\w+)Observer$/, (m) => `${splitCamelCase(m[1])} 观察者`],
      [/(\w+)Emitter$/, (m) => `${splitCamelCase(m[1])} 事件发射器`],
      [/(\w+)Client$/, (m) => `${splitCamelCase(m[1])} 客户端`],
      [/(\w+)Server$/, (m) => `${splitCamelCase(m[1])} 服务端`],
      [/(\w+)Api$/, (m) => `${splitCamelCase(m[1])} API 接口`],
      [/(\w+)Route(?:r)?$/, (m) => `${splitCamelCase(m[1])} 路由`],
      [/(\w+)Component$/, (m) => `${splitCamelCase(m[1])} 组件`],
      [/(\w+)View$/, (m) => `${splitCamelCase(m[1])} 视图`],
      [/(\w+)Page$/, (m) => `${splitCamelCase(m[1])} 页面`],
      [/(\w+)Modal$/, (m) => `${splitCamelCase(m[1])} 弹窗`],
      [/(\w+)Dialog$/, (m) => `${splitCamelCase(m[1])} 对话框`],
      [/(\w+)Form$/, (m) => `${splitCamelCase(m[1])} 表单`],
      [/(\w+)List$/, (m) => `${splitCamelCase(m[1])} 列表`],
      [/(\w+)Table$/, (m) => `${splitCamelCase(m[1])} 表格`],
      [/(\w+)Panel$/, (m) => `${splitCamelCase(m[1])} 面板`],
      [/(\w+)Card$/, (m) => `${splitCamelCase(m[1])} 卡片`],
      [/(\w+)Button$/, (m) => `${splitCamelCase(m[1])} 按钮`],
      [/(\w+)Input$/, (m) => `${splitCamelCase(m[1])} 输入框`],
      [/(\w+)Select$/, (m) => `${splitCamelCase(m[1])} 选择器`],
    ];

    for (const [pattern, generator] of patterns) {
      const match = name.match(pattern);
      if (match) {
        return generator(match);
      }
    }

    return '';
  };

  /**
   * 生成智能描述：优先使用 JSDoc，否则分析代码结构
   */
  const generateSmartDescription = useCallback((
    type: 'class' | 'function' | 'component',
    name: string,
    lineNum: number,
    content: string
  ): string => {
    // 1. 优先从 JSDoc 获取描述
    const jsdoc = extractJSDocForLine(content, lineNum, selectedPath || undefined);
    if (jsdoc && jsdoc.description) {
      return jsdoc.description;
    }

    // 2. 根据代码结构分析
    const lines = content.split('\n');

    if (type === 'class') {
      // 分析类的结构
      const classStartLine = lineNum - 1;
      let braceCount = 0;
      let started = false;
      let methodCount = 0;
      let propertyCount = 0;
      const methods: string[] = [];
      let extendsClass = '';
      let implementsInterfaces: string[] = [];

      // 解析 extends 和 implements
      const classDecl = lines[classStartLine];
      const extendsMatch = classDecl.match(/extends\s+(\w+)/);
      const implementsMatch = classDecl.match(/implements\s+([\w\s,]+)/);
      if (extendsMatch) extendsClass = extendsMatch[1];
      if (implementsMatch) {
        implementsInterfaces = implementsMatch[1].split(',').map(s => s.trim());
      }

      for (let i = classStartLine; i < Math.min(classStartLine + 200, lines.length); i++) {
        const line = lines[i];
        if (line.includes('{')) { braceCount++; started = true; }
        if (line.includes('}')) braceCount--;
        if (started && braceCount === 0) break;

        // 识别方法
        const methodMatch = line.match(/^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:async)?\s*(\w+)\s*\(/);
        if (methodMatch && methodMatch[1] !== 'constructor') {
          methodCount++;
          if (methods.length < 3) methods.push(methodMatch[1]);
        }

        // 识别属性
        const propMatch = line.match(/^\s*(?:public|private|protected)?\s*(?:static)?\s*(?:readonly)?\s*(\w+)\s*[?:]?\s*[:=]/);
        if (propMatch && !line.includes('(')) {
          propertyCount++;
        }
      }

      // 根据分析结果生成描述
      const parts: string[] = [];

      // 基于类名推断职责
      const nameDesc = inferPurposeFromName(name);
      if (nameDesc) {
        parts.push(nameDesc);
      }

      if (extendsClass) {
        parts.push(`继承自 ${extendsClass}`);
      }
      if (implementsInterfaces.length > 0) {
        parts.push(`实现 ${implementsInterfaces.join(', ')} 接口`);
      }
      if (methodCount > 0) {
        parts.push(`包含 ${methodCount} 个方法` + (methods.length > 0 ? `（${methods.join(', ')} 等）` : ''));
      }
      if (propertyCount > 0) {
        parts.push(`${propertyCount} 个属性`);
      }

      return parts.length > 0 ? parts.join('，') + '。' : `类 ${name}`;
    }

    if (type === 'function' || type === 'component') {
      // 分析函数/组件结构
      const funcStartLine = lineNum - 1;
      const funcDecl = lines[funcStartLine];

      // 提取参数
      const paramsMatch = funcDecl.match(/\(([^)]*)\)/);
      const params = paramsMatch ? paramsMatch[1].split(',').filter(p => p.trim()).map(p => {
        const nameMatch = p.trim().match(/^(\w+)/);
        return nameMatch ? nameMatch[1] : '';
      }).filter(Boolean) : [];

      // 提取返回类型
      const returnMatch = funcDecl.match(/\):\s*([^{]+)/);
      const returnType = returnMatch ? returnMatch[1].trim() : '';

      // 检查是否是 async
      const isAsync = funcDecl.includes('async');

      const parts: string[] = [];

      // 基于函数名推断职责
      const nameDesc = inferPurposeFromName(name);
      if (nameDesc) {
        parts.push(nameDesc);
      }

      if (type === 'component') {
        // 分析组件使用的 hooks
        let braceCount = 0;
        let started = false;
        const hooks: string[] = [];
        for (let i = funcStartLine; i < Math.min(funcStartLine + 100, lines.length); i++) {
          const line = lines[i];
          if (line.includes('{')) { braceCount++; started = true; }
          if (line.includes('}')) braceCount--;
          if (started && braceCount === 0) break;

          const hookMatch = line.match(/use(\w+)\s*\(/);
          if (hookMatch && !hooks.includes(hookMatch[1]) && hooks.length < 3) {
            hooks.push('use' + hookMatch[1]);
          }
        }

        if (hooks.length > 0) {
          parts.push(`使用 ${hooks.join(', ')}`);
        }
      }

      if (isAsync) {
        parts.push('异步执行');
      }
      if (params.length > 0) {
        parts.push(`接收参数: ${params.slice(0, 3).join(', ')}${params.length > 3 ? ' 等' : ''}`);
      }
      if (returnType && returnType !== 'void') {
        parts.push(`返回 ${returnType}`);
      }

      return parts.length > 0 ? parts.join('，') + '。' : `${type === 'component' ? '组件' : '函数'} ${name}`;
    }

    return `${name}`;
  }, [selectedPath]);

  /**
   * 本地生成导游步骤（作为 AI 调用失败时的 fallback）
   */
  const generateLocalTourSteps = useCallback((content: string): TourStep[] => {
    const steps: TourStep[] = [];
    const lines = content.split('\n');

    // 解析导入区域
    let importEndLine = 0;
    const importSources: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const importMatch = lines[i].match(/^import\s.*from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        importEndLine = i + 1;
        const source = importMatch[1];
        if (!source.startsWith('.') && !source.startsWith('@/') && importSources.length < 5) {
          importSources.push(source.split('/')[0]);
        }
      }
    }
    if (importEndLine > 0) {
      const uniqueSources = [...new Set(importSources)];
      steps.push({
        type: 'block',
        name: '导入声明',
        line: 1,
        endLine: importEndLine,
        description: uniqueSources.length > 0
          ? `引入 ${uniqueSources.join(', ')} 等外部依赖。`
          : '引入本地模块依赖。',
        importance: 'medium',
      });
    }

    // 解析类定义
    const classMatches = content.matchAll(/(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g);
    for (const match of classMatches) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      steps.push({
        type: 'class',
        name: match[1],
        line: lineNum,
        description: generateSmartDescription('class', match[1], lineNum, content),
        importance: 'high',
      });
    }

    // 解析函数定义
    const funcMatches = content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g);
    for (const match of funcMatches) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      steps.push({
        type: 'function',
        name: match[1],
        line: lineNum,
        description: generateSmartDescription('function', match[1], lineNum, content),
        importance: 'high',
      });
    }

    // 解析 React 组件
    const componentMatches = content.matchAll(/(?:export\s+)?const\s+(\w+):\s*React\.FC/g);
    for (const match of componentMatches) {
      const lineNum = content.substring(0, match.index).split('\n').length;
      steps.push({
        type: 'function',
        name: match[1],
        line: lineNum,
        description: generateSmartDescription('component', match[1], lineNum, content),
        importance: 'high',
      });
    }

    steps.sort((a, b) => a.line - b.line);
    return steps;
  }, [generateSmartDescription]);

  // 1. AI 导游模式 - 生成代码导览
  const startCodeTour = useCallback(async () => {
    if (!selectedPath || !editedContent) return;

    setTourState(prev => ({ ...prev, loading: true, active: false }));

    try {
      // 调用后端 AI 接口生成智能导游
      const response = await fetch('/api/blueprint/ai/tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedPath,
          content: editedContent,
        }),
      });

      let steps: TourStep[] = [];

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.steps) {
          steps = data.data.steps;
        }
      }

      // 如果 AI 接口失败或返回空，使用本地分析作为 fallback
      if (steps.length === 0) {
        console.log('[Tour] AI 接口未返回结果，使用本地分析');
        steps = generateLocalTourSteps(editedContent);
      }

      setTourState({
        active: true,
        steps,
        currentStep: 0,
        loading: false,
      });

      // 跳转到第一步
      if (steps.length > 0 && editorRef.current) {
        editorRef.current.revealLineInCenter(steps[0].line);
        editorRef.current.setPosition({ lineNumber: steps[0].line, column: 1 });
      }
    } catch (err) {
      console.error('生成导游失败:', err);
      // 失败时尝试本地分析
      try {
        const localSteps = generateLocalTourSteps(editedContent);
        if (localSteps.length > 0) {
          setTourState({
            active: true,
            steps: localSteps,
            currentStep: 0,
            loading: false,
          });
          if (editorRef.current) {
            editorRef.current.revealLineInCenter(localSteps[0].line);
            editorRef.current.setPosition({ lineNumber: localSteps[0].line, column: 1 });
          }
          return;
        }
      } catch {}
      setTourState(prev => ({ ...prev, loading: false }));
    }
  }, [selectedPath, editedContent]);

  // 导游导航
  const tourNavigate = (direction: 'prev' | 'next') => {
    if (!tourState.active || tourState.steps.length === 0) return;

    let newStep = tourState.currentStep;
    if (direction === 'next' && newStep < tourState.steps.length - 1) {
      newStep++;
    } else if (direction === 'prev' && newStep > 0) {
      newStep--;
    }

    setTourState(prev => ({ ...prev, currentStep: newStep }));

    const step = tourState.steps[newStep];
    if (step && editorRef.current) {
      editorRef.current.revealLineInCenter(step.line);
      editorRef.current.setPosition({ lineNumber: step.line, column: 1 });
    }
  };

  // 停止导游
  const stopTour = () => {
    setTourState({
      active: false,
      steps: [],
      currentStep: 0,
      loading: false,
    });
  };

  // 2. 选中即问 AI
  const handleAskAI = useCallback(() => {
    if (!editorRef.current) return;

    const selection = editorRef.current.getSelection();
    const model = editorRef.current.getModel();
    if (!selection || !model) return;

    const selectedText = model.getValueInRange(selection);
    if (!selectedText.trim()) return;

    setAskAI({
      visible: true,
      selectedCode: selectedText,
      selectedRange: {
        startLine: selection.startLineNumber,
        endLine: selection.endLineNumber,
      },
      question: '',
      answer: null,
      loading: false,
    });
  }, []);

  // 提交 AI 问题
  const submitAIQuestion = useCallback(async () => {
    if (!askAI.question.trim() || !askAI.selectedCode) return;

    setAskAI(prev => ({ ...prev, loading: true, answer: null }));

    try {
      // 调用后端 AI 接口
      const response = await fetch('/api/blueprint/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: askAI.selectedCode,
          question: askAI.question,
          filePath: selectedPath,
          context: {
            language: selectedPath?.split('.').pop() || 'typescript',
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.answer) {
          setAskAI(prev => ({
            ...prev,
            answer: data.answer,
            loading: false,
          }));
        } else {
          setAskAI(prev => ({
            ...prev,
            answer: `❌ AI 服务暂时不可用: ${data.error || '请稍后重试'}`,
            loading: false,
          }));
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setAskAI(prev => ({
          ...prev,
          answer: `❌ AI 服务请求失败: ${errorData.error || '请检查网络连接或 API 配置'}`,
          loading: false,
        }));
      }
    } catch (err: any) {
      setAskAI(prev => ({
        ...prev,
        answer: `❌ 网络错误: ${err.message || '无法连接到 AI 服务'}`,
        loading: false,
      }));
    }
  }, [askAI.question, askAI.selectedCode, selectedPath]);

  // 关闭 AI 问答
  const closeAskAI = () => {
    setAskAI({
      visible: false,
      selectedCode: '',
      selectedRange: null,
      question: '',
      answer: null,
      loading: false,
    });
  };

  // 3. 代码热力图 - 调用真正的 AI 分析代码复杂度
  const analyzeHeatmap = useCallback(async () => {
    if (!editedContent || !selectedPath) return;

    setHeatmapLoading(true);
    setHeatmapData([]);

    try {
      // 获取文件语言
      const filename = selectedPath.split('/').pop() || 'file.txt';
      const language = getMonacoLanguage(filename);

      console.log(`[AI Heatmap] 开始分析复杂度: ${selectedPath}, 语言: ${language}`);

      const result = await codebaseApi.analyzeHeatmap({
        filePath: selectedPath,
        content: editedContent,
        language,
      });

      const heatmap: HeatmapData[] = result.heatmap.map(h => ({
        line: h.line,
        complexity: h.complexity,
        reason: h.reason,
      }));

      console.log(`[AI Heatmap] 分析完成，标记 ${heatmap.length} 个复杂行${result.fromCache ? ' (缓存)' : ''}`);

      setHeatmapData(heatmap);
      setHeatmapEnabled(true);
    } catch (err) {
      console.error('分析热力图失败:', err);
      setHeatmapData([]);
    } finally {
      setHeatmapLoading(false);
    }
  }, [editedContent, selectedPath]);

  // 4. 重构建议 - 调用真正的 AI 分析代码质量
  const analyzeRefactoring = useCallback(async () => {
    if (!editedContent || !selectedPath) return;

    setRefactorLoading(true);
    setRefactorSuggestions([]);

    try {
      // 获取文件语言
      const filename = selectedPath.split('/').pop() || 'file.txt';
      const language = getMonacoLanguage(filename);

      console.log(`[AI Refactor] 开始分析重构建议: ${selectedPath}, 语言: ${language}`);

      const result = await codebaseApi.analyzeRefactoring({
        filePath: selectedPath,
        content: editedContent,
        language,
      });

      const suggestions: RefactorSuggestion[] = result.suggestions.map(s => ({
        line: s.line,
        endLine: s.endLine,
        type: s.type,
        message: s.message,
        priority: s.priority,
      }));

      console.log(`[AI Refactor] 分析完成，生成 ${suggestions.length} 个建议${result.fromCache ? ' (缓存)' : ''}`);

      setRefactorSuggestions(suggestions);
      setRefactorEnabled(true);
    } catch (err) {
      console.error('分析重构建议失败:', err);
      setRefactorSuggestions([]);
    } finally {
      setRefactorLoading(false);
    }
  }, [editedContent, selectedPath]);

  // 5. AI 气泡 - 调用真正的 AI 生成代码解释
  const generateAIBubbles = useCallback(async () => {
    if (!editedContent || !selectedPath) return;

    setBubblesLoading(true);
    setAiBubbles([]);

    try {
      // 获取文件语言
      const filename = selectedPath.split('/').pop() || 'file.txt';
      const language = getMonacoLanguage(filename);

      console.log(`[AI Bubbles] 开始生成气泡: ${selectedPath}, 语言: ${language}`);

      // 调用真正的 AI API
      const result = await codebaseApi.analyzeBubbles({
        filePath: selectedPath,
        content: editedContent,
        language,
      });

      // 转换气泡格式，添加 emoji
      const bubbles: AIBubble[] = result.bubbles.map(b => ({
        line: b.line,
        message: `${b.type === 'info' ? '💡' : b.type === 'tip' ? '✨' : '⚠️'} ${b.message}`,
        type: b.type,
      }));

      console.log(`[AI Bubbles] 生成 ${bubbles.length} 个气泡${result.fromCache ? ' (来自缓存)' : ''}`);

      setAiBubbles(bubbles);
      setBubblesEnabled(true);
    } catch (err) {
      console.error('生成AI气泡失败:', err);
      // 失败时不显示任何气泡，而不是显示废话
      setAiBubbles([]);
    } finally {
      setBubblesLoading(false);
    }
  }, [editedContent, selectedPath]);

  // 文件内容变化时自动生成 AI 气泡（如果默认开启）
  useEffect(() => {
    if (bubblesEnabled && editedContent && selectedPath && bubblesGeneratedRef.current !== selectedPath) {
      bubblesGeneratedRef.current = selectedPath;
      // 延迟生成，避免频繁触发
      const timer = setTimeout(() => {
        generateAIBubbles();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [bubblesEnabled, editedContent, selectedPath, generateAIBubbles]);

  // Monaco Editor 内容变化回调
  const handleEditorChange = (value: string | undefined) => {
    const newContent = value || '';
    setEditedContent(newContent);
    const isModified = newContent !== fileContent?.content;
    setHasUnsavedChanges(isModified);

    // 文件修改时清除 JSDoc 缓存（内容已变，注释位置可能已变）
    if (isModified && selectedPath) {
      clearJSDocCache(selectedPath);
    }
  };

  // 跳转到定义（模拟 LSP Go to Definition）
  const handleGoToDefinition = async () => {
    if (!editorRef.current || !monacoRef.current || !selectedPath) return;

    const editor = editorRef.current;
    const position = editor.getPosition();
    if (!position) return;

    // 触发 Monaco 内置的 Go to Definition
    editor.trigger('keyboard', 'editor.action.revealDefinition', null);
  };

  // 解析依赖路径并尝试定位文件
  const handleDependencyClick = async (dep: string) => {
    // 如果是外部包，忽略
    if (!dep.startsWith('.') && !dep.startsWith('/')) {
      console.log('外部依赖，无法跳转:', dep);
      return;
    }

    if (!selectedPath) return;

    // 解析相对路径
    const currentDir = selectedPath.split('/').slice(0, -1).join('/');
    const resolvedPath = resolveRelativePath(currentDir, dep);

    // 尝试不同的扩展名
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];
    for (const ext of extensions) {
      const fullPath = resolvedPath + ext;
      try {
        // 检查文件是否存在（通过API）
        const response = await fetch(`/api/blueprint/file-content?path=${encodeURIComponent(fullPath)}`);
        if (response.ok) {
          // 文件存在，跳转
          handleSelectNode(fullPath, true);
          return;
        }
      } catch {
        continue;
      }
    }

    console.log('无法找到依赖文件:', dep);
  };

  const statusTexts: Record<string, string> = {
    draft: '草稿', review: '审核中', approved: '已批准',
    executing: '执行中', completed: '已完成', paused: '已暂停', modified: '已修改',
    rejected: '已拒绝', failed: '失败',
  };

  // ============ 蓝图操作处理函数 ============

  /**
   * 批准蓝图
   */
  const handleApproveBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      await blueprintApi.approveBlueprint(blueprintId, 'user');
      setBlueprintInfo(prev => prev ? { ...prev, status: 'approved' } : null);
      onRefresh?.();
    } catch (err: any) {
      setBlueprintOperationError(err.message || '批准蓝图失败');
      console.error('批准蓝图失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 拒绝蓝图
   */
  const handleRejectBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    const reason = window.prompt('请输入拒绝原因:');
    if (!reason) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      await blueprintApi.rejectBlueprint(blueprintId, reason);
      setBlueprintInfo(prev => prev ? { ...prev, status: 'rejected' } : null);
      onRefresh?.();
    } catch (err: any) {
      setBlueprintOperationError(err.message || '拒绝蓝图失败');
      console.error('拒绝蓝图失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 执行蓝图
   */
  const handleExecuteBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      const result = await blueprintApi.startExecution(blueprintId);
      setBlueprintInfo(prev => prev ? { ...prev, status: 'executing' } : null);
      console.log('蓝图执行已启动:', result.message);
      onRefresh?.();
      // 如果有跳转到蜂群页面的回调，询问用户是否跳转
      if (onNavigateToSwarm) {
        const shouldNavigate = window.confirm(t('bdc.executionStartedNavigate'));
        if (shouldNavigate) {
          onNavigateToSwarm();
        }
      }
    } catch (err: any) {
      setBlueprintOperationError(err.message || '执行蓝图失败');
      console.error('执行蓝图失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 暂停蓝图执行
   */
  const handlePauseBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      await blueprintApi.pauseExecution(blueprintId);
      setBlueprintInfo(prev => prev ? { ...prev, status: 'paused' } : null);
      onRefresh?.();
    } catch (err: any) {
      setBlueprintOperationError(err.message || '暂停执行失败');
      console.error('暂停执行失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 恢复蓝图执行
   */
  const handleResumeBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      await blueprintApi.resumeExecution(blueprintId);
      setBlueprintInfo(prev => prev ? { ...prev, status: 'executing' } : null);
      onRefresh?.();
    } catch (err: any) {
      setBlueprintOperationError(err.message || '恢复执行失败');
      console.error('恢复执行失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 完成蓝图执行
   */
  const handleCompleteBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    const confirmed = window.confirm(t('bdc.confirmMarkComplete'));
    if (!confirmed) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      await blueprintApi.completeExecution(blueprintId);
      setBlueprintInfo(prev => prev ? { ...prev, status: 'completed' } : null);
      onRefresh?.();
    } catch (err: any) {
      setBlueprintOperationError(err.message || '完成执行失败');
      console.error('完成执行失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 删除蓝图
   */
  const handleDeleteBlueprint = async () => {
    if (!blueprintId || blueprintOperating) return;
    const confirmed = window.confirm(t('bdc.confirmDeleteBlueprint'));
    if (!confirmed) return;
    setBlueprintOperating(true);
    setBlueprintOperationError(null);
    try {
      await blueprintApi.deleteBlueprint(blueprintId);
      onDeleted?.();
    } catch (err: any) {
      setBlueprintOperationError(err.message || '删除蓝图失败');
      console.error('删除蓝图失败:', err);
    } finally {
      setBlueprintOperating(false);
    }
  };

  /**
   * 根据蓝图状态获取可用的操作按钮
   */
  const getBlueprintActions = () => {
    if (!blueprintInfo) return [];
    const status = blueprintInfo.status;
    const actions: Array<{
      label: string;
      icon: string;
      onClick: () => void;
      type: 'primary' | 'success' | 'warning' | 'danger' | 'default';
      disabled?: boolean;
    }> = [];

    switch (status) {
      case 'draft':
      case 'modified':
        // 草稿和已修改状态可以提交审核（但这里没有提交审核的 API 调用，先跳过）
        actions.push({
          label: '删除',
          icon: '🗑️',
          onClick: handleDeleteBlueprint,
          type: 'danger',
        });
        break;
      case 'review':
        // 审核中可以批准或拒绝
        actions.push({
          label: '批准',
          icon: '✅',
          onClick: handleApproveBlueprint,
          type: 'success',
        });
        actions.push({
          label: '拒绝',
          icon: '❌',
          onClick: handleRejectBlueprint,
          type: 'danger',
        });
        break;
      case 'approved':
        // 已批准可以执行
        actions.push({
          label: '开始执行',
          icon: '▶️',
          onClick: handleExecuteBlueprint,
          type: 'primary',
        });
        actions.push({
          label: '删除',
          icon: '🗑️',
          onClick: handleDeleteBlueprint,
          type: 'danger',
        });
        break;
      case 'executing':
        // 执行中可以暂停或完成
        actions.push({
          label: '暂停',
          icon: '⏸️',
          onClick: handlePauseBlueprint,
          type: 'warning',
        });
        actions.push({
          label: '完成',
          icon: '✅',
          onClick: handleCompleteBlueprint,
          type: 'success',
        });
        break;
      case 'paused':
        // 已暂停可以恢复或完成
        actions.push({
          label: '恢复',
          icon: '▶️',
          onClick: handleResumeBlueprint,
          type: 'primary',
        });
        actions.push({
          label: '完成',
          icon: '✅',
          onClick: handleCompleteBlueprint,
          type: 'success',
        });
        break;
      case 'completed':
      case 'failed':
      case 'rejected':
        // 已完成、失败或已拒绝只能删除
        actions.push({
          label: '删除',
          icon: '🗑️',
          onClick: handleDeleteBlueprint,
          type: 'danger',
        });
        break;
    }

    return actions;
  };


  // 渲染代码视图
  const renderCodeView = () => {
    if (loadingFile) {
      return (
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}></div>
          <p>正在加载文件内容...</p>
        </div>
      );
    }

    if (fileError) {
      return (
        <div className={styles.errorState}>
          <p className={styles.errorText}>{fileError}</p>
          <button className={styles.retryButton} onClick={() => selectedPath && loadFileContent(selectedPath)}>
            重试
          </button>
        </div>
      );
    }

    if (!fileContent) {
      return (
        <div className={styles.welcomePage}>
          <h2 className={styles.welcomeTitle}>选择文件查看代码</h2>
          <p className={styles.welcomeDesc}>点击左侧文件树中的文件来查看和编辑代码</p>
        </div>
      );
    }

    const filename = selectedPath?.split('/').pop() || 'file.txt';
    const language = getMonacoLanguage(filename);

    // 跳转到指定步骤
    const goToStep = (stepIndex: number) => {
      setTourState(prev => ({ ...prev, currentStep: stepIndex }));
      const step = tourState.steps[stepIndex];
      if (step && editorRef.current) {
        editorRef.current.revealLineInCenter(step.line);
        editorRef.current.setPosition({ lineNumber: step.line, column: 1 });
      }
    };

    return (
      <div className={styles.codeEditorWithTour}>
        <div className={tourState.active && tourState.steps.length > 0 ? styles.codeEditorMain : styles.codeEditor}>
        <div className={styles.codeHeader}>
          <div className={styles.codeInfo}>
            <span className={styles.codeLanguage}>{language}</span>
            <span className={styles.codeSize}>{formatFileSize(fileContent.size)}</span>
            {hasUnsavedChanges && <span className={styles.unsavedBadge}>{t('blueprint.unsaved')}</span>}
          </div>
          <div className={styles.codeActions}>
            {/* AI 增强功能按钮组 */}
            <div className={styles.aiToolGroup}>
              <button
                className={`${styles.codeBtn} ${styles.aiBtn} ${tourState.active ? styles.active : ''}`}
                onClick={tourState.active ? stopTour : startCodeTour}
                disabled={tourState.loading}
                title={t('blueprint.codeTourTitle')}
              >
                {tourState.loading ? '⏳' : tourState.active ? `⏹️ ${t('blueprint.codeTourStop')}` : `🎯 ${t('blueprint.codeTour')}`}
              </button>
              <button
                className={`${styles.codeBtn} ${styles.aiBtn} ${heatmapEnabled ? styles.active : ''}`}
                onClick={() => {
                  if (heatmapEnabled) {
                    setHeatmapEnabled(false);
                    setHeatmapData([]);
                  } else {
                    analyzeHeatmap();
                  }
                }}
                disabled={heatmapLoading}
                title={t('blueprint.heatmapTitle')}
              >
                {heatmapLoading ? '⏳' : heatmapEnabled ? `🔥 ${t('blueprint.heatmapOff')}` : `🌡️ ${t('blueprint.heatmap')}`}
              </button>
              <button
                className={`${styles.codeBtn} ${styles.aiBtn} ${refactorEnabled ? styles.active : ''}`}
                onClick={() => {
                  if (refactorEnabled) {
                    setRefactorEnabled(false);
                    setRefactorSuggestions([]);
                  } else {
                    analyzeRefactoring();
                  }
                }}
                disabled={refactorLoading}
                title={t('blueprint.refactorTitle')}
              >
                {refactorLoading ? '⏳' : refactorEnabled ? `✨ ${t('blueprint.refactorOff')}` : `🔧 ${t('blueprint.refactor')}`}
              </button>
              <button
                className={`${styles.codeBtn} ${styles.aiBtn} ${bubblesEnabled ? styles.active : ''}`}
                onClick={() => {
                  if (bubblesEnabled) {
                    setBubblesEnabled(false);
                    setAiBubbles([]);
                  } else {
                    generateAIBubbles();
                  }
                }}
                disabled={bubblesLoading}
                title={t('blueprint.bubblesTitle')}
              >
                {bubblesLoading ? '⏳' : bubblesEnabled ? `💬 ${t('blueprint.bubblesOff')}` : `💡 ${t('blueprint.bubbles')}`}
              </button>
              {/* 语法详情面板开关 */}
              <button
                className={`${styles.codeBtn} ${styles.aiBtn} ${syntaxPanelEnabled ? styles.active : ''}`}
                onClick={() => setSyntaxPanelEnabled(!syntaxPanelEnabled)}
                title={syntaxPanelEnabled ? t('bdc.syntaxPanelToggle.close') : t('bdc.syntaxPanelToggle.open')}
              >
                {syntaxPanelEnabled ? '📖 关闭详情' : '📖 语法详情'}
              </button>
              {/* 小地图开关 */}
              <button
                className={`${styles.codeBtn} ${styles.aiBtn} ${minimapEnabled ? styles.active : ''}`}
                onClick={() => setMinimapEnabled(!minimapEnabled)}
                title={minimapEnabled ? t('bdc.minimapToggle.close') : t('bdc.minimapToggle.open')}
              >
                {minimapEnabled ? '🗺️ 关闭地图' : '🗺️ 小地图'}
              </button>
            </div>

            <span className={styles.toolDivider}>|</span>

            <button
              className={`${styles.codeBtn} ${isEditing ? styles.active : ''}`}
              onClick={() => setIsEditing(!isEditing)}
              title={isEditing ? t('bdc.editModeToggle.readonly') : t('bdc.editModeToggle.edit')}
            >
              {isEditing ? '📖 只读' : '✏️ 编辑'}
            </button>
            <button
              className={styles.codeBtn}
              onClick={handleGoToDefinition}
              title={t('bdc.goToDefinition')}
            >
              🔗 跳转
            </button>
            {hasUnsavedChanges && (
              <button
                className={`${styles.codeBtn} ${styles.saveBtn}`}
                onClick={saveFile}
                disabled={saving}
                title={t('bdc.saveFile')}
              >
                {saving ? '保存中...' : '💾 保存'}
              </button>
            )}
          </div>
        </div>
        <div className={styles.editorWithPanel}>
          <div className={styles.monacoContainer}>
            <Editor
              height="100%"
              language={language}
              value={editedContent}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              theme="vs-dark"
              options={{
                readOnly: !isEditing,
                minimap: { enabled: minimapEnabled },
                glyphMargin: true,
                fontSize: 14,
                fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
                fontLigatures: true,
                lineNumbers: 'on',
                wordWrap: 'off',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                folding: true,
                foldingStrategy: 'indentation',
                showFoldingControls: 'mouseover',
                bracketPairColorization: {
                  enabled: true,
                },
                guides: {
                  bracketPairs: true,
                  indentation: true,
                },
                renderWhitespace: 'selection',
                cursorBlinking: 'smooth',
                cursorSmoothCaretAnimation: 'on',
                smoothScrolling: true,
                tabSize: 2,
                formatOnPaste: true,
                formatOnType: true,
                suggest: {
                  showMethods: true,
                  showFunctions: true,
                  showConstructors: true,
                  showFields: true,
                  showVariables: true,
                  showClasses: true,
                  showStructs: true,
                  showInterfaces: true,
                  showModules: true,
                  showProperties: true,
                  showEvents: true,
                  showOperators: true,
                  showUnits: true,
                  showValues: true,
                  showConstants: true,
                  showEnums: true,
                  showEnumMembers: true,
                  showKeywords: true,
                  showWords: true,
                  showColors: true,
                  showFiles: true,
                  showReferences: true,
                  showFolders: true,
                  showTypeParameters: true,
                  showSnippets: true,
                },
                quickSuggestions: {
                  other: true,
                  comments: true,
                  strings: true,
                },
                gotoLocation: {
                  multiple: 'goto',
                  multipleDefinitions: 'goto',
                  multipleTypeDefinitions: 'goto',
                  multipleDeclarations: 'goto',
                  multipleImplementations: 'goto',
                  multipleReferences: 'goto',
                },
                hover: {
                  enabled: true,
                  delay: 200,
                  sticky: false,
                  above: false,
                },
                parameterHints: {
                  enabled: true,
                },
              }}
            />
          </div>

          {/* 右侧行详情面板（语法详情）- 受 syntaxPanelEnabled 控制 */}
          {beginnerMode && lineAnalysis && syntaxPanelEnabled && (
            <div className={styles.lineDetailPanel}>
              <div className={styles.lineDetailHeader}>
                <span className={styles.lineDetailTitle}>📖 第 {lineAnalysis.lineNumber} 行</span>
                {lineAnalysis.loading && <span className={styles.lineDetailLoading}>AI 分析中...</span>}
              </div>

              <div className={styles.lineDetailCode}>
                <code>{lineAnalysis.lineContent.trim()}</code>
              </div>

              {/* 关键字解释 */}
              {lineAnalysis.keywords.length > 0 && (
                <div className={styles.lineDetailSection}>
                  <div className={styles.lineDetailSectionTitle}>语法关键字</div>
                  {lineAnalysis.keywords.map((kw, idx) => (
                    <div key={idx} className={styles.lineDetailKeyword}>
                      <span className={styles.keywordName}>{kw.keyword}</span>
                      <span className={styles.keywordBrief}>{kw.brief}</span>
                      {kw.detail && <div className={styles.keywordDetail}>{kw.detail}</div>}
                      {kw.example && (
                        <pre className={styles.keywordExample}>{kw.example}</pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* AI 分析结果 */}
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
                      <div className={styles.paramTitle}>参数:</div>
                      {lineAnalysis.aiAnalysis.params.map((p, i) => (
                        <div key={i} className={styles.paramItem}>
                          <code>{p.name}</code>
                          <span className={styles.paramType}>{p.type}</span>
                          <span className={styles.paramDesc}>{p.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {lineAnalysis.aiAnalysis.returns && (
                    <div className={styles.aiAnalysisReturns}>
                      <span className={styles.returnLabel}>返回:</span>
                      <code>{lineAnalysis.aiAnalysis.returns.type}</code>
                      <span>{lineAnalysis.aiAnalysis.returns.description}</span>
                    </div>
                  )}
                  {lineAnalysis.aiAnalysis.examples && lineAnalysis.aiAnalysis.examples.length > 0 && (
                    <div className={styles.aiAnalysisExamples}>
                      <div className={styles.exampleTitle}>示例:</div>
                      {lineAnalysis.aiAnalysis.examples.map((ex, i) => (
                        <pre key={i} className={styles.exampleCode}>{ex}</pre>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 加载占位 */}
              {lineAnalysis.loading && !lineAnalysis.aiAnalysis && (
                <div className={styles.lineDetailLoading}>
                  <div className={styles.loadingSpinner}></div>
                  <span>正在分析代码...</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className={styles.codeFooter}>
          <span className={styles.codeModified}>
            最后修改: {new Date(fileContent.modifiedAt).toLocaleString('zh-CN')}
          </span>
          <span className={styles.codeLines}>
            {editedContent.split('\n').length} 行
          </span>
          <span className={styles.codeShortcuts}>
            F12: 跳转定义 | Ctrl+S: 保存 | 右键: 问AI
          </span>
        </div>

        {/* 选中即问 AI 对话框 */}
        {askAI.visible && (
          <div className={styles.askAIOverlay} onClick={closeAskAI}>
            <div className={styles.askAIDialog} onClick={e => e.stopPropagation()}>
              <div className={styles.askAIHeader}>
                <span className={styles.askAITitle}>🤖 问 AI</span>
                <span className={styles.askAIRange}>
                  行 {askAI.selectedRange?.startLine} - {askAI.selectedRange?.endLine}
                </span>
                <button className={styles.askAIClose} onClick={closeAskAI}>×</button>
              </div>
              <div className={styles.askAICode}>
                <pre>{askAI.selectedCode.slice(0, 500)}{askAI.selectedCode.length > 500 ? '...' : ''}</pre>
              </div>
              <div className={styles.askAIInput}>
                <input
                  type="text"
                  placeholder={t('bdc.askAIPlaceholder')}
                  value={askAI.question}
                  onChange={e => setAskAI(prev => ({ ...prev, question: e.target.value }))}
                  onKeyPress={e => e.key === 'Enter' && submitAIQuestion()}
                  disabled={askAI.loading}
                  autoFocus
                />
                <button
                  className={styles.askAISubmit}
                  onClick={submitAIQuestion}
                  disabled={askAI.loading || !askAI.question.trim()}
                >
                  {askAI.loading ? '思考中...' : '提问'}
                </button>
              </div>
              {askAI.answer && (
                <div className={styles.askAIAnswer}>
                  <div className={styles.askAIAnswerLabel}>AI 回答：</div>
                  <div className={styles.askAIAnswerContent}>{askAI.answer}</div>
                </div>
              )}
              <div className={styles.askAIHints}>
                <span className={styles.askAIHint} onClick={() => setAskAI(prev => ({ ...prev, question: '这段代码有什么作用？' }))}>
                  这段代码有什么作用？
                </span>
                <span className={styles.askAIHint} onClick={() => setAskAI(prev => ({ ...prev, question: '怎么优化这段代码？' }))}>
                  怎么优化这段代码？
                </span>
                <span className={styles.askAIHint} onClick={() => setAskAI(prev => ({ ...prev, question: '这段代码有什么问题？' }))}>
                  这段代码有什么问题？
                </span>
              </div>
            </div>
          </div>
        )}
        </div>

        {/* AI 导游面板 - 右侧边栏 */}
        {tourState.active && tourState.steps.length > 0 && (
          <div className={styles.tourPanel}>
            <div className={styles.tourHeader}>
              <span className={styles.tourTitle}>🎯 代码导游</span>
              <span className={styles.tourProgress}>
                {tourState.currentStep + 1} / {tourState.steps.length}
              </span>
              <button className={styles.tourClose} onClick={stopTour}>×</button>
            </div>

            <div className={styles.tourContent}>
              <div className={styles.tourStepInfo}>
                <span className={styles.tourStepType}>
                  {tourState.steps[tourState.currentStep].type === 'class' ? '🏛️ 类' :
                   tourState.steps[tourState.currentStep].type === 'function' ? '🔧 函数' :
                   tourState.steps[tourState.currentStep].type === 'block' ? '📦 代码块' : '📄 文件'}
                </span>
                <span className={styles.tourStepName}>
                  {tourState.steps[tourState.currentStep].name}
                </span>
                <span className={styles.tourStepLine}>
                  行 {tourState.steps[tourState.currentStep].line}
                </span>
              </div>
              <p className={styles.tourDescription}>
                {tourState.steps[tourState.currentStep].description}
              </p>
            </div>

            {/* 步骤列表 */}
            <div className={styles.tourStepsList}>
              <div className={styles.tourStepsTitle}>全部步骤</div>
              {tourState.steps.map((step, i) => (
                <div
                  key={i}
                  className={`${styles.tourStepItem} ${i === tourState.currentStep ? styles.active : ''}`}
                  onClick={() => goToStep(i)}
                >
                  <span className={styles.tourStepItemNum}>{i + 1}</span>
                  <span className={styles.tourStepItemName}>{step.name}</span>
                  <span className={styles.tourStepItemType}>
                    {step.type === 'class' ? '类' :
                     step.type === 'function' ? '函数' :
                     step.type === 'block' ? '块' : '文件'}
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.tourNav}>
              <button
                className={styles.tourNavBtn}
                onClick={() => tourNavigate('prev')}
                disabled={tourState.currentStep === 0}
              >
                ← 上一步
              </button>
              <button
                className={styles.tourNavBtn}
                onClick={() => tourNavigate('next')}
                disabled={tourState.currentStep === tourState.steps.length - 1}
              >
                下一步 →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // 渲染分析视图
  const renderAnalysisView = () => {
    // 如果选中了代码符号，显示符号详情
    if (selectedSymbol && selectedPath) {
      return (
        <div className={styles.symbolDetail}>
          <div className={styles.symbolDetailHeader}>
            <span className={styles.symbolDetailIcon}>{getSymbolIcon(selectedSymbol.kind)}</span>
            <div className={styles.symbolDetailTitle}>
              <h2 className={styles.symbolName}>{selectedSymbol.name}</h2>
              <span className={styles.symbolKind}>{selectedSymbol.kind}</span>
              <span className={styles.symbolLocation}>
                {selectedPath}:{selectedSymbol.line}
              </span>
            </div>
          </div>

          {/* 符号类型说明 */}
          <div className={styles.symbolSection}>
            <h3 className={styles.symbolSectionTitle}>类型说明</h3>
            <div className={styles.symbolTypeInfo}>
              {selectedSymbol.kind === 'class' && '类定义 - 封装数据和行为的蓝图'}
              {selectedSymbol.kind === 'interface' && '接口 - 定义对象的形状和契约'}
              {selectedSymbol.kind === 'type' && '类型别名 - 为类型定义一个新名称'}
              {selectedSymbol.kind === 'function' && '函数 - 可重用的代码块'}
              {selectedSymbol.kind === 'method' && '方法 - 类中的函数成员'}
              {selectedSymbol.kind === 'property' && '属性 - 类中的数据成员'}
              {selectedSymbol.kind === 'const' && '常量 - 不可变的值'}
              {selectedSymbol.kind === 'variable' && '变量 - 可变的值'}
            </div>
            {selectedSymbol.detail && (
              <div className={styles.symbolTypeDetail}>
                <code>{selectedSymbol.detail}</code>
              </div>
            )}
          </div>

          {/* 子成员（如果是类） */}
          {selectedSymbol.children && selectedSymbol.children.length > 0 && (
            <div className={styles.symbolSection}>
              <h3 className={styles.symbolSectionTitle}>成员 ({selectedSymbol.children.length})</h3>
              <div className={styles.symbolMembers}>
                {selectedSymbol.children.map((child, i) => (
                  <div key={i} className={styles.symbolMember}>
                    <span className={styles.symbolMemberIcon}>{getSymbolIcon(child.kind)}</span>
                    <span className={styles.symbolMemberName}>{child.name}</span>
                    <span className={styles.symbolMemberKind}>{child.kind}</span>
                    <span className={styles.symbolMemberLine}>:{child.line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 位置信息 */}
          <div className={styles.symbolSection}>
            <h3 className={styles.symbolSectionTitle}>位置</h3>
            <div className={styles.symbolLocation}>
              <div className={styles.locationItem}>
                <span className={styles.locationLabel}>文件:</span>
                <code className={styles.locationValue}>{selectedPath}</code>
              </div>
              <div className={styles.locationItem}>
                <span className={styles.locationLabel}>行号:</span>
                <code className={styles.locationValue}>{selectedSymbol.line}</code>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (!selectedPath) {
      return renderWelcomeView();
    }

    if (analyzing) {
      return (
        <div className={styles.analyzingState}>
          <div className={styles.analyzingSpinner}></div>
          <h3 className={styles.analyzingTitle}>正在分析 {selectedPath}</h3>
          <p className={styles.analyzingHint}>AI 正在阅读代码并生成语义分析...</p>
        </div>
      );
    }

    if (analysisError && !currentAnalysis) {
      return (
        <div className={styles.errorState}>
          <p className={styles.errorText}>分析失败: {analysisError}</p>
          <button className={styles.retryButton} onClick={() => analyzeNode(selectedPath)}>
            重试
          </button>
        </div>
      );
    }

    if (currentAnalysis) {
      return (
        <div className={styles.analysisResult}>
          <div className={styles.analysisHeader}>
            <div className={styles.analysisTitle}>
              <span className={styles.analysisIcon}>
                {currentAnalysis.type === 'directory' ? '📁' : '📄'}
              </span>
              <h2 className={styles.analysisPath}>{currentAnalysis.path}</h2>
              <span className={styles.analysisType}>
                {currentAnalysis.type === 'directory' ? '目录' : '文件'}
              </span>
            </div>
            <button
              className={styles.regenerateBtn}
              onClick={regenerateAnalysis}
              title={t('bdc.regenerateAnalysis')}
            >
              🔄 重新分析
            </button>
          </div>

          <div className={styles.analysisSummary}>
            {currentAnalysis.summary}
          </div>

          <div className={styles.analysisDescription}>
            {currentAnalysis.description}
          </div>

          {/* 职责（目录） */}
          {currentAnalysis.responsibilities && currentAnalysis.responsibilities.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>职责</h3>
              <ul className={styles.sectionList}>
                {currentAnalysis.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 导出（文件） */}
          {currentAnalysis.exports && currentAnalysis.exports.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>导出</h3>
              <div className={styles.exportList}>
                {currentAnalysis.exports.map((e, i) => (
                  <code key={i} className={styles.exportItem}>{e}</code>
                ))}
              </div>
            </div>
          )}

          {/* 依赖 */}
          {currentAnalysis.dependencies && currentAnalysis.dependencies.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>依赖</h3>
              <div className={styles.depList}>
                {currentAnalysis.dependencies.map((d, i) => {
                  const isInternal = d.startsWith('.') || d.startsWith('/') || d.startsWith('src');
                  return (
                    <span
                      key={i}
                      className={`${styles.depItem} ${isInternal ? styles.clickable : ''}`}
                      onClick={() => isInternal && handleDependencyClick(d)}
                      title={isInternal ? t('bdc.depClickToJump') : t('bdc.depExternal')}
                    >
                      {isInternal && '→ '}{d}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 被引用（反向依赖） */}
          {currentAnalysis.reverseDependencies && currentAnalysis.reverseDependencies.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>被引用 ({currentAnalysis.reverseDependencies.length})</h3>
              <div className={styles.reverseDepList}>
                {currentAnalysis.reverseDependencies.map((rd, i) => (
                  <div
                    key={i}
                    className={styles.reverseDepItem}
                    onClick={() => handleSelectNode(rd.path, true)}
                  >
                    <span className={styles.reverseDepPath}>📄 {rd.path}</span>
                    <span className={styles.reverseDepImports}>
                      使用: {rd.imports.join(', ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 关系图谱（文件才显示） */}
          {currentAnalysis.type === 'file' && ((currentAnalysis.dependencies?.length ?? 0) > 0 || (currentAnalysis.reverseDependencies?.length ?? 0) > 0) && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>关系图谱</h3>
              <div className={styles.relationshipGraph}>
                {/* 被引用者（上方） */}
                {currentAnalysis.reverseDependencies && currentAnalysis.reverseDependencies.length > 0 && (
                  <div className={styles.graphRow}>
                    <div className={styles.graphNodes}>
                      {currentAnalysis.reverseDependencies.slice(0, 5).map((rd, i) => (
                        <div
                          key={i}
                          className={styles.graphNode}
                          onClick={() => handleSelectNode(rd.path, true)}
                          title={rd.path}
                        >
                          <div className={styles.graphNodeIcon}>📄</div>
                          <div className={styles.graphNodeName}>{rd.path.split('/').pop()}</div>
                          <div className={styles.graphConnector} style={{ top: '100%', height: '20px' }}></div>
                        </div>
                      ))}
                      {currentAnalysis.reverseDependencies.length > 5 && (
                        <div className={styles.graphNodeMore}>
                          +{currentAnalysis.reverseDependencies.length - 5} 更多
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 当前文件（中心） */}
                <div className={styles.graphCenter}>
                  <div className={styles.graphCurrent}>
                    <div className={styles.graphCurrentIcon}>📘</div>
                    <div className={styles.graphCurrentName}>{currentAnalysis.name}</div>
                    <div className={styles.graphCurrentBadge}>当前文件</div>
                  </div>
                </div>

                {/* 依赖项（下方） */}
                {currentAnalysis.dependencies && currentAnalysis.dependencies.length > 0 && (
                  <div className={styles.graphRow}>
                    <div className={styles.graphNodes}>
                      {currentAnalysis.dependencies.slice(0, 5).map((dep, i) => {
                        const isInternal = dep.startsWith('.') || dep.startsWith('/') || dep.startsWith('src');
                        const fileName = dep.split('/').pop() || dep;
                        return (
                          <div
                            key={i}
                            className={`${styles.graphNode} ${!isInternal ? styles.external : ''}`}
                            onClick={() => isInternal && handleDependencyClick(dep)}
                            title={dep}
                          >
                            <div className={styles.graphConnector} style={{ bottom: '100%', height: '20px' }}></div>
                            <div className={styles.graphNodeIcon}>{isInternal ? '📄' : '📦'}</div>
                            <div className={styles.graphNodeName}>{fileName}</div>
                          </div>
                        );
                      })}
                      {currentAnalysis.dependencies.length > 5 && (
                        <div className={styles.graphNodeMore}>
                          +{currentAnalysis.dependencies.length - 5} 更多
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 技术栈 */}
          {currentAnalysis.techStack && currentAnalysis.techStack.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>技术栈</h3>
              <div className={styles.techTags}>
                {currentAnalysis.techStack.map((t, i) => (
                  <span key={i} className={styles.techTag}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* 关键点 */}
          {currentAnalysis.keyPoints && currentAnalysis.keyPoints.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>关键点</h3>
              <ul className={styles.keyPointsList}>
                {currentAnalysis.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 子项（目录） */}
          {currentAnalysis.children && currentAnalysis.children.length > 0 && (
            <div className={styles.analysisSection}>
              <h3 className={styles.sectionTitle}>子模块概览</h3>
              <div className={styles.childrenGrid}>
                {currentAnalysis.children.map((c, i) => (
                  <div
                    key={i}
                    className={styles.childCard}
                    onClick={() => {
                      const childPath = `${currentAnalysis.path}/${c.name}`;
                      handleSelectNode(childPath, c.name.includes('.'));
                      setExpandedPaths(prev => new Set(prev).add(currentAnalysis.path));
                    }}
                  >
                    <span className={styles.childName}>{c.name}</span>
                    <span className={styles.childDesc}>{c.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.analysisFooter}>
            <span className={styles.analyzedTime}>
              分析时间: {new Date(currentAnalysis.analyzedAt).toLocaleString('zh-CN')}
            </span>
            {(currentAnalysis as any).fromCache && (
              <span className={styles.cacheBadge} title={t('bdc.cacheHint')}>
                ⚡ 缓存
              </span>
            )}
            {(currentAnalysis as any).fromCache === false && (
              <span className={styles.freshBadge} title={t('bdc.freshHint')}>
                ✨ 新分析
              </span>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderWelcomeView = () => (
    <div className={`${styles.welcomePage} ${styles.welcomeGraphPage}`}>
      <section className={styles.moduleGraphSection}>
        <div className={styles.moduleGraphBody}>
          <ArchitectureFlowGraph
            blueprintId={blueprintId}
            data={architectureGraphCache.get(selectedArchitectureType) || null}
            loading={architectureGraphLoadingSet.has(selectedArchitectureType)}
            error={architectureGraphErrorMap.get(selectedArchitectureType) || null}
            onRefresh={loadArchitectureGraph}
            selectedType={selectedArchitectureType}
            onTypeChange={(type) => {
              setSelectedArchitectureType(type);
              // 如果没有缓存，则加载
              if (!architectureGraphCache.has(type)) {
                loadArchitectureGraph(type);
              }
            }}
            onNodeClick={handleArchitectureNodeClick}
            loadingTypes={architectureGraphLoadingSet}
          />
        </div>
      </section>
    </div>
  );

  if (loadingTree) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}></div>
          <p>正在加载目录结构...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* VS Code 风格主体 */}
      <div className={styles.vscodeLayout}>
        {/* 左侧边栏 - 资源管理器 */}
        <div className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`} ref={sidebarRef}>
          <div className={styles.sidebarHeader}>
            <button
              className={styles.collapseBtn}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              title={sidebarCollapsed ? t('bdc.sidebarToggle.expand') : t('bdc.sidebarToggle.collapse')}
            >
              {sidebarCollapsed ? '▶' : '◀'}
            </button>
            {!sidebarCollapsed && (
              <>
                <span className={styles.sidebarTitle}>资源管理器</span>
                <div className={styles.sidebarToolbar}>
                  <button
                    className={`${styles.toolbarBtn} ${outlineEnabled ? styles.active : ''}`}
                    onClick={() => setOutlineEnabled(!outlineEnabled)}
                    title={outlineEnabled ? t('bdc.outlineToggle.close') : t('bdc.outlineToggle.open')}
                  >
                    {outlineEnabled ? '📑' : '📄'}
                  </button>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => setFileDialog({ visible: true, type: 'newFile', parentPath: selectedPath || 'src' })}
                    title={t('bdc.newFile')}
                  >
                    📄+
                  </button>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => setFileDialog({ visible: true, type: 'newFolder', parentPath: selectedPath || 'src' })}
                    title={t('bdc.newFolder')}
                  >
                    📁+
                  </button>
                  <button
                    className={styles.toolbarBtn}
                    onClick={() => loadFileTree()}
                    title={t('bdc.refreshDir')}
                  >
                    ↻
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 文件树内容 - 折叠时隐藏 */}
          {!sidebarCollapsed && (
            <div
              className={styles.sidebarContent}
              onContextMenu={(e) => {
                // 空白区域右键菜单
                if (e.target === e.currentTarget) {
                  handleContextMenu(e, '', 'empty');
                }
              }}
            >
              {treeError && (
                <div className={styles.treeError}>
                  {treeError}
                </div>
              )}
              {fileTree && renderTreeNode(fileTree)}
            </div>
          )}
        </div>

        {/* 主编辑区 */}
        <div className={styles.mainPanel}>
          {/* 标签栏 */}
          <div className={styles.tabBar}>
            <div
              className={`${styles.tab} ${activeTab === 'welcome' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('welcome')}
            >
              <span className={styles.tabIcon}>🏠</span>
              <span className={styles.tabName}>欢迎</span>
            </div>

            {selectedPath && (
              <div
                className={`${styles.tab} ${activeTab === 'content' ? styles.activeTab : ''}`}
                onClick={() => setActiveTab('content')}
              >
                <span className={styles.tabIcon}>{selectedIsFile ? '📝' : '🔍'}</span>
                <span className={styles.tabName}>{selectedIsFile ? '代码编辑' : '分析'}</span>
                {selectedIsFile && hasUnsavedChanges && <span className={styles.unsavedDot}>●</span>}
                <span
                  className={styles.tabClose}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeContentTab();
                  }}
                  title={t('bdc.close')}
                >
                  ×
                </span>
              </div>
            )}

            {/* 当前文件路径 */}
            {selectedPath && (
              <div className={styles.breadcrumb}>
                <span className={styles.breadcrumbPath}>{selectedPath}</span>
              </div>
            )}

            {/* 任务树统计 - 显示在tabBar右侧 */}
            {taskTreeStats && (
              <div className={styles.tabStats}>
                <span className={styles.tabStat}>
                  {taskTreeStats.completedTasks}/{taskTreeStats.totalTasks} 完成
                </span>
              </div>
            )}

            {/* 右侧操作按钮区域 */}
            {(onAddChatTab || onNavigateToChat) && (
              <div className={styles.tabBarActions}>
                {onAddChatTab && (
                  <button
                    className={styles.tabBarActionBtn}
                    onClick={onAddChatTab}
                    title={t('bdc.newAIChat')}
                  >
                    + 💬
                  </button>
                )}
                {onNavigateToChat && (
                  <button
                    className={styles.tabBarActionBtn}
                    onClick={onNavigateToChat}
                    title={t('bdc.backToMainChat')}
                  >
                    ← 返回主聊天
                  </button>
                )}
              </div>
            )}
          </div>

          {/* 编辑区内容 - 文件显示代码，目录显示分析 */}
          <div className={styles.editorContent}>
            {activeTab === 'welcome' ? renderWelcomeView() : (selectedIsFile ? renderCodeView() : renderAnalysisView())}
          </div>
        </div>
      </div>

      {/* 语义悬浮框 */}
      {tooltip.visible && (tooltip.path || tooltip.symbol) && (
        <div
          className={styles.semanticTooltip}
          style={{
            position: 'fixed',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            zIndex: 1000,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          {(() => {
            // 符号悬浮框 - 三层分层显示
            if (tooltip.symbol) {
              const sym = tooltip.symbol;
              const kindLabels: Record<string, string> = {
                class: '类',
                interface: '接口',
                type: '类型',
                function: '函数',
                method: '方法',
                property: '属性',
                const: '常量',
                variable: '变量',
              };

              // 使用 layeredTooltip 中的分层数据
              const { userComment, syntaxExplanations, semanticAnalysis, loadingAI } = layeredTooltip;

              return (
                <div className={styles.tooltipContent}>
                  {/* 头部：符号名称和类型 */}
                  <div className={styles.tooltipHeader}>
                    <span className={styles.tooltipIcon}>{getSymbolIcon(sym.kind)}</span>
                    <span className={styles.tooltipName}>{sym.name}</span>
                    <span className={styles.tooltipType}>{kindLabels[sym.kind] || sym.kind}</span>
                    {semanticAnalysis?.complexity && (
                      <span className={`${styles.tooltipComplexity} ${styles[`complexity${semanticAnalysis.complexity.charAt(0).toUpperCase() + semanticAnalysis.complexity.slice(1)}`]}`}>
                        {semanticAnalysis.complexity === 'low' ? '简单' : semanticAnalysis.complexity === 'medium' ? '中等' : '复杂'}
                      </span>
                    )}
                  </div>

                  {/* ============ 第一层：用户注释（JSDoc） ============ */}
                  {userComment && userComment.description && (
                    <div className={styles.tooltipUserComment}>
                      <span className={styles.tooltipLayerLabel}>📝 注释</span>
                      <div className={styles.tooltipCommentText}>{formatJSDocBrief(userComment)}</div>
                      {userComment.params && userComment.params.length > 0 && (
                        <div className={styles.tooltipCommentParams}>
                          {userComment.params.slice(0, 3).map((p, i) => (
                            <span key={i} className={styles.tooltipCommentParam}>
                              <code>{p.name}</code>{p.type && `: ${p.type}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ============ 第二层：语法解释（新手模式） ============ */}
                  {beginnerMode && syntaxExplanations && syntaxExplanations.length > 0 && (
                    <div className={styles.tooltipSyntaxLayer}>
                      <span className={styles.tooltipLayerLabel}>📖 语法 <span className={styles.beginnerBadge}>新手</span></span>
                      <div className={styles.tooltipSyntaxList}>
                        {syntaxExplanations.slice(0, 4).map((exp, i) => (
                          <div key={i} className={styles.tooltipSyntaxItem}>
                            <code className={styles.syntaxKeyword}>{exp.keyword}</code>
                            <span className={styles.syntaxBrief}>{exp.brief}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ============ 第三层：AI 语义分析 ============ */}
                  {loadingAI && !semanticAnalysis && (
                    <div className={styles.tooltipAILoading}>
                      <div className={styles.tooltipSpinner}></div>
                      <span>AI 正在分析...</span>
                    </div>
                  )}

                  {semanticAnalysis && (
                    <div className={styles.tooltipSemanticLayer}>
                      <span className={styles.tooltipLayerLabel}>🤖 语义</span>
                      <div className={styles.tooltipSummary}>{semanticAnalysis.semanticDescription}</div>

                      {/* 参数（折叠显示） */}
                      {semanticAnalysis.parameters && semanticAnalysis.parameters.length > 0 && (
                        <div className={styles.tooltipCompactSection}>
                          <span className={styles.tooltipMiniLabel}>参数:</span>
                          {semanticAnalysis.parameters.slice(0, 3).map((p, i) => (
                            <code key={i} className={styles.tooltipMiniCode}>{p.name}</code>
                          ))}
                          {semanticAnalysis.parameters.length > 3 && (
                            <span className={styles.tooltipMore}>+{semanticAnalysis.parameters.length - 3}</span>
                          )}
                        </div>
                      )}

                      {/* 返回值 */}
                      {semanticAnalysis.returnValue && (
                        <div className={styles.tooltipCompactSection}>
                          <span className={styles.tooltipMiniLabel}>返回:</span>
                          <code className={styles.tooltipMiniCode}>{semanticAnalysis.returnValue.type}</code>
                        </div>
                      )}

                      {/* 新手提示（只在新手模式显示） */}
                      {beginnerMode && semanticAnalysis.tips && semanticAnalysis.tips.length > 0 && (
                        <div className={styles.tooltipTipsSection}>
                          <span className={styles.tooltipMiniLabel}>💡</span>
                          <span className={styles.tooltipTipText}>{semanticAnalysis.tips[0]}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 如果没有任何内容，显示基础信息 */}
                  {!userComment && !semanticAnalysis && !loadingAI && (
                    <div className={styles.tooltipSummary}>
                      {`${kindLabels[sym.kind] || sym.kind} 定义`}
                    </div>
                  )}

                  {/* 页脚 */}
                  <div className={styles.tooltipFooter}>
                    <span>行 {sym.line}</span>
                    {semanticAnalysis?.fromCache ? ' · ⚡缓存' : loadingAI ? ' · 分析中...' : ''}
                    <span className={styles.tooltipFooterHint}> · 点击跳转</span>
                  </div>
                </div>
              );
            }

            // 文件/目录悬浮框
            const analysis = tooltip.path ? analysisCache.get(tooltip.path) : null;
            if (analyzing && !analysis) {
              return (
                <div className={styles.tooltipLoading}>
                  <div className={styles.tooltipSpinner}></div>
                  <span>正在分析...</span>
                </div>
              );
            }
            if (!analysis) {
              return (
                <div className={styles.tooltipEmpty}>
                  <span className={styles.tooltipPath}>{tooltip.path}</span>
                  <span className={styles.tooltipHint}>悬停以加载语义分析</span>
                </div>
              );
            }
            return (
              <div className={styles.tooltipContent}>
                <div className={styles.tooltipHeader}>
                  <span className={styles.tooltipIcon}>
                    {analysis.type === 'directory' ? '📁' : '📄'}
                  </span>
                  <span className={styles.tooltipName}>{analysis.name}</span>
                  <span className={styles.tooltipType}>
                    {analysis.type === 'directory' ? '目录' : '文件'}
                  </span>
                </div>
                <div className={styles.tooltipSummary}>{analysis.summary}</div>
                {analysis.description && (
                  <div className={styles.tooltipDescription}>{analysis.description}</div>
                )}
                {/* 职责（目录） */}
                {analysis.responsibilities && analysis.responsibilities.length > 0 && (
                  <div className={styles.tooltipSection}>
                    <span className={styles.tooltipSectionTitle}>职责</span>
                    <ul className={styles.tooltipList}>
                      {analysis.responsibilities.slice(0, 3).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                      {analysis.responsibilities.length > 3 && (
                        <li className={styles.tooltipMore}>+{analysis.responsibilities.length - 3} 更多...</li>
                      )}
                    </ul>
                  </div>
                )}
                {/* 导出（文件） */}
                {analysis.exports && analysis.exports.length > 0 && (
                  <div className={styles.tooltipSection}>
                    <span className={styles.tooltipSectionTitle}>导出</span>
                    <div className={styles.tooltipExports}>
                      {analysis.exports.slice(0, 5).map((e, i) => (
                        <code key={i} className={styles.tooltipExportItem}>{e}</code>
                      ))}
                      {analysis.exports.length > 5 && (
                        <span className={styles.tooltipMore}>+{analysis.exports.length - 5}</span>
                      )}
                    </div>
                  </div>
                )}
                {/* 技术栈 */}
                {analysis.techStack && analysis.techStack.length > 0 && (
                  <div className={styles.tooltipTechStack}>
                    {analysis.techStack.slice(0, 4).map((t, i) => (
                      <span key={i} className={styles.tooltipTech}>{t}</span>
                    ))}
                  </div>
                )}
                <div className={styles.tooltipFooter}>
                  点击查看详情
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* 底部状态栏 */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span className={styles.statusItem}>
            {selectedPath || '未选择'}
          </span>
        </div>
        <div className={styles.statusRight}>
          {/* 新手模式开关 */}
          <button
            className={`${styles.statusBtn} ${beginnerMode ? styles.success : ''}`}
            onClick={() => setBeginnerMode(!beginnerMode)}
            title={beginnerMode ? t('bdc.beginnerModeToggle.close') : t('bdc.beginnerModeToggle.open')}
          >
            {beginnerMode ? '📖 新手模式' : '💡 专家模式'}
          </button>
          {blueprintInfo && (
            <span className={`${styles.statusBadge} ${styles[blueprintInfo.status]}`}>
              {statusTexts[blueprintInfo.status] || blueprintInfo.status}
            </span>
          )}
          {/* 蓝图操作按钮 */}
          {blueprintId && getBlueprintActions().length > 0 && (
            <div className={styles.blueprintActions}>
              {getBlueprintActions().map((action, idx) => (
                <button
                  key={idx}
                  className={`${styles.actionBtn} ${styles[action.type]}`}
                  onClick={action.onClick}
                  disabled={blueprintOperating || action.disabled}
                  title={action.label}
                >
                  {blueprintOperating ? '...' : `${action.icon} ${action.label}`}
                </button>
              ))}
            </div>
          )}
          {/* 操作错误提示 */}
          {blueprintOperationError && (
            <span className={styles.operationError} title={blueprintOperationError}>
              操作失败
            </span>
          )}
          <span className={styles.statusItem}>
            {analysisCache.size} 已分析
          </span>
          {analyzing && (
            <span className={styles.statusAnalyzing}>分析中...</span>
          )}
          {saving && (
            <span className={styles.statusSaving}>保存中...</span>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      <ContextMenu
        visible={contextMenu.visible}
        x={contextMenu.x}
        y={contextMenu.y}
        items={getContextMenuItems()}
        onClose={closeContextMenu}
      />

      {/* 文件操作对话框 */}
      <FileDialog
        visible={fileDialog.visible}
        type={fileDialog.type}
        initialValue={fileDialog.currentName}
        onConfirm={async (value) => {
          if (fileDialog.type === 'newFile') {
            handleCreateFile(value);
          } else if (fileDialog.type === 'newFolder') {
            handleCreateDirectory(value);
          } else if (fileDialog.type === 'rename') {
            handleRename(value);
          } else if (fileDialog.type === 'openFolder') {
            // 打开文件夹
            try {
              const response = await fetch('/api/blueprint/projects/open', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: value.trim() }),
              });
              const result = await response.json();
              if (result.success) {
                const project: Project = {
                  id: result.data.id,
                  name: result.data.name,
                  path: result.data.path,
                  lastOpenedAt: result.data.lastOpenedAt,
                };
                // 项目已由 ProjectContext 管理，不再本地设置
                setProjectRoot(project.path);
                loadFileTree();
                setFileDialog(prev => ({ ...prev, visible: false }));
              } else {
                alert(t('bdc.openFailed', { error: result.error }));
              }
            } catch (err: any) {
              console.error('打开文件夹失败:', err);
              alert(t('bdc.openFailed', { error: err.message }));
            }
          }
        }}
        onCancel={() => setFileDialog(prev => ({ ...prev, visible: false }))}
      />
    </div>
  );
};

export default BlueprintDetailContent;
