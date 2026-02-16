/**
 * useMonacoDecorations Hook
 * 
 * 从 BlueprintDetailContent.tsx 提取的装饰器管理逻辑
 * 管理 Monaco 编辑器的三种装饰器：热力图、重构建议、AI 气泡
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { 
  aiHeatmapApi, 
  aiRefactorApi, 
  aiBubblesApi,
  type HeatmapData,
  type RefactorSuggestion,
  type AIBubble,
} from '../api/ai-editor';

/**
 * Hook 配置选项
 */
export interface UseMonacoDecorationsOptions {
  /** 当前文件路径 */
  filePath: string | null;
  /** 文件内容 */
  content: string;
  /** Monaco Editor 实例引用 */
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  /** Monaco 命名空间引用 */
  monacoRef: React.RefObject<typeof Monaco | null>;
  /** Editor 是否已准备 */
  editorReady: boolean;
}

/**
 * Hook 返回值
 */
export interface UseMonacoDecorationsReturn {
  heatmap: {
    enabled: boolean;
    loading: boolean;
    toggle: () => void;
    analyze: () => Promise<void>;
  };
  refactor: {
    enabled: boolean;
    loading: boolean;
    toggle: () => void;
    analyze: () => Promise<void>;
  };
  bubbles: {
    enabled: boolean;
    loading: boolean;
    toggle: () => void;
    generate: () => Promise<void>;
  };
}

/**
 * 从文件名获取 Monaco 语言 ID
 */
function getMonacoLanguage(filename: string): string {
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
}

/**
 * Monaco 装饰器管理 Hook
 * 
 * 提供热力图、重构建议、AI 气泡三种装饰器的管理功能
 */
export function useMonacoDecorations(options: UseMonacoDecorationsOptions): UseMonacoDecorationsReturn {
  const { filePath, content, editorRef, monacoRef, editorReady } = options;

  // ============ 热力图状态 ============
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // ============ 重构建议状态 ============
  const [refactorEnabled, setRefactorEnabled] = useState(false);
  const [refactorSuggestions, setRefactorSuggestions] = useState<RefactorSuggestion[]>([]);
  const [refactorLoading, setRefactorLoading] = useState(false);

  // ============ AI 气泡状态 ============
  const [bubblesEnabled, setBubblesEnabled] = useState(true); // 默认开启
  const [aiBubbles, setAiBubbles] = useState<AIBubble[]>([]);
  const [bubblesLoading, setBubblesLoading] = useState(false);

  // ============ 装饰器引用 ============
  const decorationsRef = useRef<string[]>([]);

  // 气泡自动生成标记（避免重复生成）
  const bubblesGeneratedRef = useRef<string | null>(null);

  // ============ 热力图分析 ============
  const analyzeHeatmap = useCallback(async () => {
    if (!content || !filePath) return;

    setHeatmapLoading(true);
    setHeatmapData([]);

    try {
      const filename = filePath.split('/').pop() || 'file.txt';
      const language = getMonacoLanguage(filename);

      console.log(`[AI Heatmap] 开始分析复杂度: ${filePath}, 语言: ${language}`);

      const result = await aiHeatmapApi.analyze({
        filePath,
        content,
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
  }, [content, filePath]);

  // ============ 重构建议分析 ============
  const analyzeRefactoring = useCallback(async () => {
    if (!content || !filePath) return;

    setRefactorLoading(true);
    setRefactorSuggestions([]);

    try {
      const filename = filePath.split('/').pop() || 'file.txt';
      const language = getMonacoLanguage(filename);

      console.log(`[AI Refactor] 开始分析重构建议: ${filePath}, 语言: ${language}`);

      const result = await aiRefactorApi.analyze({
        filePath,
        content,
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
  }, [content, filePath]);

  // ============ AI 气泡生成 ============
  const generateAIBubbles = useCallback(async () => {
    if (!content || !filePath) return;

    setBubblesLoading(true);
    setAiBubbles([]);

    try {
      const filename = filePath.split('/').pop() || 'file.txt';
      const language = getMonacoLanguage(filename);

      console.log(`[AI Bubbles] 开始生成气泡: ${filePath}, 语言: ${language}`);

      const result = await aiBubblesApi.generate({
        filePath,
        content,
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
      setAiBubbles([]);
    } finally {
      setBubblesLoading(false);
    }
  }, [content, filePath]);

  // ============ Toggle 函数 ============
  const toggleHeatmap = useCallback(() => {
    const newEnabled = !heatmapEnabled;
    setHeatmapEnabled(newEnabled);
    // 如果从 false → true 且无数据，自动分析
    if (newEnabled && heatmapData.length === 0) {
      analyzeHeatmap();
    }
  }, [heatmapEnabled, heatmapData.length, analyzeHeatmap]);

  const toggleRefactor = useCallback(() => {
    const newEnabled = !refactorEnabled;
    setRefactorEnabled(newEnabled);
    // 如果从 false → true 且无数据，自动分析
    if (newEnabled && refactorSuggestions.length === 0) {
      analyzeRefactoring();
    }
  }, [refactorEnabled, refactorSuggestions.length, analyzeRefactoring]);

  const toggleBubbles = useCallback(() => {
    const newEnabled = !bubblesEnabled;
    setBubblesEnabled(newEnabled);
    // 如果从 false → true 且无数据，自动生成
    if (newEnabled && aiBubbles.length === 0) {
      generateAIBubbles();
    }
  }, [bubblesEnabled, aiBubbles.length, generateAIBubbles]);

  // ============ 文件切换处理 ============
  useEffect(() => {
    // 文件切换时清除装饰器和数据
    decorationsRef.current = [];
    setHeatmapData([]);
    setRefactorSuggestions([]);
    setAiBubbles([]);
    bubblesGeneratedRef.current = null;
  }, [filePath]);

  // ============ 自动生成气泡（文件切换时） ============
  useEffect(() => {
    if (bubblesEnabled && content && filePath && bubblesGeneratedRef.current !== filePath) {
      bubblesGeneratedRef.current = filePath;
      // 延迟生成，避免频繁触发
      const timer = setTimeout(() => {
        generateAIBubbles();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [bubblesEnabled, content, filePath, generateAIBubbles]);

  // ============ 应用装饰器到编辑器 ============
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
  }, [editorReady, heatmapEnabled, heatmapData, refactorEnabled, refactorSuggestions, bubblesEnabled, aiBubbles, editorRef, monacoRef]);

  return {
    heatmap: {
      enabled: heatmapEnabled,
      loading: heatmapLoading,
      toggle: toggleHeatmap,
      analyze: analyzeHeatmap,
    },
    refactor: {
      enabled: refactorEnabled,
      loading: refactorLoading,
      toggle: toggleRefactor,
      analyze: analyzeRefactoring,
    },
    bubbles: {
      enabled: bubblesEnabled,
      loading: bubblesLoading,
      toggle: toggleBubbles,
      generate: generateAIBubbles,
    },
  };
}
