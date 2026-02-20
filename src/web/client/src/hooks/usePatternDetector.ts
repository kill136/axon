/**
 * usePatternDetector Hook
 * 模式检测器：检测代码中的重复模式，用装饰器标注
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { aiPatternApi, type DetectedPattern } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UsePatternDetectorOptions {
  filePath: string | null;
  content: string;
  language: string;
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.RefObject<typeof Monaco | null>;
  editorReady: boolean;
}

export interface UsePatternDetectorReturn {
  enabled: boolean;
  loading: boolean;
  toggle: () => void;
  patterns: DetectedPattern[];
  summary: string | null;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从文件名获取语言
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
    'css': 'css',
    'md': 'markdown',
    'py': 'python',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'c': 'c',
    'cpp': 'cpp',
  };
  return languageMap[ext] || 'plaintext';
}

// ============================================================================
// Hook 实现
// ============================================================================

export function usePatternDetector(options: UsePatternDetectorOptions): UsePatternDetectorReturn {
  const { filePath, content, language, editorRef, monacoRef, editorReady } = options;

  // 状态
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
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
   * 检测代码模式
   */
  const detectPatterns = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    const currentContent = contentRef.current;
    const currentLanguage = languageRef.current;

    if (!currentFilePath || !currentContent) return;

    setLoading(true);
    setPatterns([]);
    setSummary(null);

    try {
      const filename = currentFilePath.split('/').pop() || 'file.txt';
      const lang = getMonacoLanguage(filename);

      console.log(`[Pattern Detector] 开始检测: ${currentFilePath}, 语言: ${lang}`);

      const result = await aiPatternApi.detect({
        filePath: currentFilePath,
        content: currentContent,
        language: lang,
      });

      if (result.success) {
        console.log(`[Pattern Detector] 检测完成，发现 ${result.patterns.length} 个模式${result.fromCache ? ' (缓存)' : ''}`);
        setPatterns(result.patterns);
        setSummary(result.summary || null);
        setEnabled(true);
      } else {
        console.error('[Pattern Detector] 检测失败:', result.error);
        setPatterns([]);
        setSummary(null);
      }
    } catch (error: any) {
      console.error('[Pattern Detector] 检测异常:', error);
      setPatterns([]);
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

    // 如果从 false → true 且无数据，自动检测
    if (newEnabled && patterns.length === 0) {
      detectPatterns();
    }
  }, [enabled, patterns.length, detectPatterns]);

  /**
   * 文件切换时清除数据
   */
  useEffect(() => {
    decorationsRef.current = [];
    setPatterns([]);
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

    if (enabled && patterns.length > 0) {
      patterns.forEach(pattern => {
        // 根据类型确定颜色
        let glyphClass = 'pattern-glyph';
        let lineClass = '';

        if (pattern.type === 'duplicate') {
          glyphClass += ' pattern-duplicate';
          lineClass = 'pattern-line-duplicate';
        } else if (pattern.type === 'similar-logic') {
          glyphClass += ' pattern-similar-logic';
          lineClass = 'pattern-line-similar-logic';
        } else if (pattern.type === 'extract-candidate') {
          glyphClass += ' pattern-extract-candidate';
          lineClass = 'pattern-line-extract-candidate';
        } else if (pattern.type === 'design-pattern') {
          glyphClass += ' pattern-design-pattern';
          lineClass = 'pattern-line-design-pattern';
        }

        // 为每个位置添加装饰器
        pattern.locations.forEach(location => {
          // 构建 hover 消息
          const hoverMessage = `**${pattern.name}** (${pattern.type})

${pattern.description}

💡 **建议**: ${pattern.suggestion}

影响: ${pattern.impact}`;

          decorations.push({
            range: new monaco.Range(location.line, 1, location.endLine, 1),
            options: {
              isWholeLine: true,
              className: lineClass,
              glyphMarginClassName: glyphClass,
              glyphMarginHoverMessage: { value: hoverMessage },
              overviewRuler: {
                color: pattern.type === 'duplicate' ? '#9c27b0' :
                       pattern.type === 'similar-logic' ? '#00bcd4' :
                       pattern.type === 'extract-candidate' ? '#4caf50' : '#2196f3',
                position: monaco.editor.OverviewRulerLane.Right,
              },
            },
          });
        });
      });
    }

    // 应用装饰器
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [editorReady, enabled, patterns, editorRef, monacoRef]);

  return {
    enabled,
    loading,
    toggle,
    patterns,
    summary,
  };
}
