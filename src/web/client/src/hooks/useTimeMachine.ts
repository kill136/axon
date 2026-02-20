/**
 * useTimeMachine Hook
 * 代码时光机：分析代码的 git 历史演变
 */

import { useState, useRef, useCallback } from 'react';
import type * as MonacoEditor from 'monaco-editor';
import { aiTimeMachineApi, type TimeMachineCommit, type TimeMachineKeyChange } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseTimeMachineOptions {
  filePath: string | null;
  content: string;
  language: string;
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
}

export interface UseTimeMachineReturn {
  state: {
    visible: boolean;
    loading: boolean;
    result: {
      commits: TimeMachineCommit[];
      story: string;
      keyChanges: TimeMachineKeyChange[];
    } | null;
    selectedCode: string;
    selectedRange: { startLine: number; endLine: number } | null;
  };
  open: () => void;
  close: () => void;
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

export function useTimeMachine(options: UseTimeMachineOptions): UseTimeMachineReturn {
  const { filePath, content, language, editorRef } = options;

  // 状态
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    commits: TimeMachineCommit[];
    story: string;
    keyChanges: TimeMachineKeyChange[];
  } | null>(null);
  const [selectedCode, setSelectedCode] = useState('');
  const [selectedRange, setSelectedRange] = useState<{ startLine: number; endLine: number } | null>(null);

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const contentRef = useRef(content);
  const languageRef = useRef(language);

  // 更新 ref
  filePathRef.current = filePath;
  contentRef.current = content;
  languageRef.current = language;

  /**
   * 打开时光机
   */
  const open = useCallback(async () => {
    const editor = editorRef.current;
    const currentFilePath = filePathRef.current;
    const currentContent = contentRef.current;
    const currentLanguage = languageRef.current;

    if (!currentFilePath || !currentContent) {
      console.warn('[Time Machine] 文件路径或内容为空');
      return;
    }

    // 获取选中的代码和范围
    let code = '';
    let startLine: number | undefined;
    let endLine: number | undefined;

    if (editor) {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        code = editor.getModel()?.getValueInRange(selection) || '';
        startLine = selection.startLineNumber;
        endLine = selection.endLineNumber;
      }
    }

    // 如果没有选中，分析整个文件
    if (!code) {
      code = currentContent;
    }

    setSelectedCode(code);
    setSelectedRange(startLine && endLine ? { startLine, endLine } : null);
    setVisible(true);
    setLoading(true);
    setResult(null);

    try {
      const filename = currentFilePath.split('/').pop() || 'file.txt';
      const lang = getMonacoLanguage(filename);

      console.log(`[Time Machine] 开始分析: ${currentFilePath}, 语言: ${lang}${startLine ? `, 行号: ${startLine}-${endLine}` : ''}`);

      const response = await aiTimeMachineApi.analyze({
        filePath: currentFilePath,
        content: currentContent,
        language: lang,
        selectedCode: code !== currentContent ? code : undefined,
        startLine,
        endLine,
      });

      if (response.success && response.history) {
        console.log(`[Time Machine] 分析完成，${response.history.commits.length} 个提交${response.fromCache ? ' (缓存)' : ''}`);
        setResult(response.history);
      } else {
        console.error('[Time Machine] 分析失败:', response.error);
        setResult(null);
      }
    } catch (error: any) {
      console.error('[Time Machine] 分析异常:', error);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [editorRef]);

  /**
   * 关闭时光机
   */
  const close = useCallback(() => {
    setVisible(false);
  }, []);

  return {
    state: {
      visible,
      loading,
      result,
      selectedCode,
      selectedRange,
    },
    open,
    close,
  };
}
