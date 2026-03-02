/**
 * useDeadCode Hook
 * 实现死代码检测功能：检测 unused/unreachable/redundant/suspicious 代码，用装饰器标注
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { aiDeadCodeApi, type DeadCodeItem } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseDeadCodeOptions {
  filePath: string | null;
  content: string;
  language: string;
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.RefObject<typeof Monaco | null>;
  editorReady: boolean;
}

export interface UseDeadCodeReturn {
  enabled: boolean;
  loading: boolean;
  toggle: () => void;
  items: DeadCodeItem[];
  summary: string | null;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useDeadCode(options: UseDeadCodeOptions): UseDeadCodeReturn {
  const { filePath, content, language, editorRef, monacoRef, editorReady } = options;

  // 状态
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DeadCodeItem[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  // 装饰器引用
  const decorationsRef = useRef<string[]>([]);

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const contentRef = useRef(content);
  const languageRef = useRef(language);

  // 更新 ref
  filePathRef.current = filePath;
  contentRef.current = content;
  languageRef.current = language;

  /**
   * 分析死代码
   */
  const analyzeDeadCode = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    const currentContent = contentRef.current;
    const currentLanguage = languageRef.current;

    if (!currentFilePath || !currentContent) return;

    setLoading(true);
    setItems([]);
    setSummary(null);

    try {
      console.log(`[AI Dead Code] Starting analysis: ${currentFilePath}`);

      const result = await aiDeadCodeApi.analyze({
        filePath: currentFilePath,
        content: currentContent,
        language: currentLanguage,
      });

      if (result.success) {
        console.log(`[AI Dead Code] Analysis complete, found ${result.deadCode.length} dead code items${result.fromCache ? ' (cached)' : ''}`);
        setItems(result.deadCode);
        setSummary(result.summary || null);
        setEnabled(true);
      } else {
        console.error('[AI Dead Code] Analysis failed:', result.error);
        setItems([]);
        setSummary(null);
      }
    } catch (error: any) {
      console.error('[AI Dead Code] Analysis error:', error);
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Toggle 开关
   */
  const toggle = useCallback(() => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);

    // 如果从 false → true 且无数据，自动分析
    if (newEnabled && items.length === 0) {
      analyzeDeadCode();
    }
  }, [enabled, items.length, analyzeDeadCode]);

  /**
   * 文件切换时清除数据
   */
  useEffect(() => {
    decorationsRef.current = [];
    setItems([]);
    setSummary(null);
  }, [filePath]);

  /**
   * 应用装饰器到编辑器
   */
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !editorReady) return;

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const decorations: any[] = [];

    if (enabled && items.length > 0) {
      items.forEach(item => {
        // 根据类型和置信度确定样式
        let glyphClass = 'dead-code-glyph';
        let lineClass = '';

        if (item.type === 'unused' && item.confidence === 'high') {
          glyphClass = 'dead-code-glyph'; // 灰色 glyph
          lineClass = 'dead-code-unused';
        } else if (item.type === 'unreachable' && item.confidence === 'high') {
          glyphClass = 'dead-code-glyph'; // 红色 glyph 会在 CSS 中处理
          lineClass = 'dead-code-unreachable';
        } else if (item.type === 'redundant') {
          lineClass = 'dead-code-redundant';
        } else if (item.type === 'suspicious') {
          lineClass = 'dead-code-suspicious';
        }

        // 构建 hover 消息
        const hoverMessage = `**${item.type.toUpperCase()}**: ${item.name}\n\n${item.reason}\n\n置信度: ${item.confidence}`;

        decorations.push({
          range: new monaco.Range(item.line, 1, item.endLine, 1),
          options: {
            isWholeLine: true,
            className: `${lineClass} dead-code-strikethrough`,
            glyphMarginClassName: glyphClass,
            glyphMarginHoverMessage: { value: hoverMessage },
            overviewRuler: {
              color: item.type === 'unreachable' ? '#f44336' : item.type === 'unused' ? '#9e9e9e' : item.type === 'redundant' ? '#ffc107' : '#2196f3',
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        });
      });
    }

    // 应用装饰器
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [editorReady, enabled, items, editorRef, monacoRef]);

  return {
    enabled,
    loading,
    toggle,
    items,
    summary,
  };
}
