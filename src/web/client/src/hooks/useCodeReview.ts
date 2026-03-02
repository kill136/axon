/**
 * useCodeReview Hook
 * 实现 AI 代码审查功能：分析代码问题，在编辑器中高亮显示
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { aiCodeReviewApi, type CodeReviewIssue } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseCodeReviewOptions {
  filePath: string | null;
  content: string;
  language: string;
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.RefObject<typeof Monaco | null>;
  editorReady: boolean;
}

export interface UseCodeReviewReturn {
  enabled: boolean;
  loading: boolean;
  toggle: () => void;
  issues: CodeReviewIssue[];
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

export function useCodeReview(options: UseCodeReviewOptions): UseCodeReviewReturn {
  const { filePath, content, language, editorRef, monacoRef, editorReady } = options;

  // 状态
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<CodeReviewIssue[]>([]);
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
   * 分析代码问题
   */
  const analyzeCode = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    const currentContent = contentRef.current;
    const currentLanguage = languageRef.current;

    if (!currentFilePath || !currentContent) return;

    setLoading(true);
    setIssues([]);
    setSummary(null);

    try {
      const filename = currentFilePath.split('/').pop() || 'file.txt';
      const lang = getMonacoLanguage(filename);

      console.log(`[AI Code Review] Starting analysis: ${currentFilePath}, language: ${lang}`);

      const result = await aiCodeReviewApi.analyze({
        filePath: currentFilePath,
        content: currentContent,
        language: lang,
      });

      if (result.success) {
        console.log(`[AI Code Review] Analysis complete, found ${result.issues.length} issues${result.fromCache ? ' (cached)' : ''}`);
        setIssues(result.issues);
        setSummary(result.summary || null);
        setEnabled(true);
      } else {
        console.error('[AI Code Review] Analysis failed:', result.error);
        setIssues([]);
        setSummary(null);
      }
    } catch (error: any) {
      console.error('[AI Code Review] Analysis error:', error);
      setIssues([]);
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
    if (newEnabled && issues.length === 0) {
      analyzeCode();
    }
  }, [enabled, issues.length, analyzeCode]);

  /**
   * 文件切换时清除数据
   */
  useEffect(() => {
    decorationsRef.current = [];
    setIssues([]);
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

    if (enabled && issues.length > 0) {
      issues.forEach(issue => {
        // 根据类型和严重程度确定颜色
        let glyphClass = 'review-glyph';
        let lineClass = '';

        if (issue.type === 'bug' && issue.severity === 'error') {
          glyphClass += ' review-bug-error';
          lineClass = 'review-line-bug-error';
        } else if (issue.type === 'bug') {
          glyphClass += ' review-bug-warning';
          lineClass = 'review-line-bug-warning';
        } else if (issue.type === 'performance' && issue.severity === 'error') {
          glyphClass += ' review-perf-error';
          lineClass = 'review-line-perf-error';
        } else if (issue.type === 'performance') {
          glyphClass += ' review-perf-warning';
          lineClass = 'review-line-perf-warning';
        } else if (issue.type === 'security' && issue.severity === 'error') {
          glyphClass += ' review-security-error';
          lineClass = 'review-line-security-error';
        } else if (issue.type === 'security') {
          glyphClass += ' review-security-warning';
          lineClass = 'review-line-security-warning';
        } else if (issue.type === 'style' && issue.severity === 'error') {
          glyphClass += ' review-style-error';
          lineClass = 'review-line-style-error';
        } else {
          glyphClass += ' review-style-info';
          lineClass = 'review-line-style-info';
        }

        // 构建 hover 消息
        const hoverMessage = issue.suggestion
          ? `**${issue.message}**\n\n💡 建议：${issue.suggestion}`
          : `**${issue.message}**`;

        decorations.push({
          range: new monaco.Range(issue.line, 1, issue.endLine, 1),
          options: {
            isWholeLine: true,
            className: lineClass,
            glyphMarginClassName: glyphClass,
            glyphMarginHoverMessage: { value: hoverMessage },
            overviewRuler: {
              color: issue.severity === 'error' ? '#f44336' : issue.severity === 'warning' ? '#ff9800' : '#2196f3',
              position: monaco.editor.OverviewRulerLane.Right,
            },
          },
        });
      });
    }

    // 应用装饰器
    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
  }, [editorReady, enabled, issues, editorRef, monacoRef]);

  return {
    enabled,
    loading,
    toggle,
    issues,
    summary,
  };
}
