/**
 * useIntentToCode Hook
 * 实现意图编程功能：根据用户意图改写代码或生成代码
 */

import { useState, useCallback, useRef } from 'react';
import * as Monaco from 'monaco-editor';
import { aiIntentApi } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseIntentToCodeOptions {
  filePath: string | null;
  language: string;
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
}

export interface UseIntentToCodeReturn {
  state: {
    visible: boolean;
    loading: boolean;
    selectedCode: string;
    selectedRange: { startLine: number; endLine: number } | null;
    intent: string;
    result: { code: string; explanation: string } | null;
    mode: 'rewrite' | 'generate';
  };
  openIntent: () => void;
  setIntent: (intent: string) => void;
  executeIntent: () => Promise<void>;
  applyResult: () => void;
  close: () => void;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useIntentToCode(options: UseIntentToCodeOptions): UseIntentToCodeReturn {
  const { filePath, language, editorRef } = options;

  // 状态
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [selectedRange, setSelectedRange] = useState<{ startLine: number; endLine: number } | null>(null);
  const [intent, setIntent] = useState('');
  const [result, setResult] = useState<{ code: string; explanation: string } | null>(null);
  const [mode, setMode] = useState<'rewrite' | 'generate'>('rewrite');

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const languageRef = useRef(language);

  // 更新 ref
  filePathRef.current = filePath;
  languageRef.current = language;

  /**
   * 打开意图编程对话框
   */
  const openIntent = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const selection = editor.getSelection();
    if (!selection) return;

    // 检查是否有选中文本
    const selectedText = model.getValueInRange(selection);

    if (selectedText && selectedText.trim()) {
      // 有选中文本 → rewrite 模式
      setMode('rewrite');
      setSelectedCode(selectedText);
      setSelectedRange({
        startLine: selection.startLineNumber,
        endLine: selection.endLineNumber,
      });
      setVisible(true);
      setIntent('');
      setResult(null);
    } else {
      // 没有选中文本 → 检查当前行是否是注释
      const position = editor.getPosition();
      if (!position) return;

      const currentLine = model.getLineContent(position.lineNumber);
      const trimmedLine = currentLine.trim();

      // 检查是否是注释行（支持多种语言的注释语法）
      const isComment = 
        trimmedLine.startsWith('//') ||   // JS/TS/C/C++/Go/Rust
        trimmedLine.startsWith('#') ||    // Python/Shell
        trimmedLine.startsWith('/*') ||   // 多行注释开始
        trimmedLine.startsWith('*') ||    // 多行注释中间
        trimmedLine.startsWith('--') ||   // SQL
        trimmedLine.startsWith('<!--');   // HTML

      if (isComment) {
        // 注释行 → generate 模式
        setMode('generate');
        setSelectedCode(trimmedLine);
        setSelectedRange({
          startLine: position.lineNumber,
          endLine: position.lineNumber,
        });
        setVisible(true);
        setIntent('');
        setResult(null);
      }
    }
  }, [editorRef]);

  /**
   * 执行意图编程
   */
  const executeIntent = useCallback(async () => {
    if (!filePathRef.current || !selectedCode || !intent.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await aiIntentApi.execute({
        filePath: filePathRef.current,
        code: selectedCode,
        intent: intent.trim(),
        language: languageRef.current,
        mode,
      });

      if (response.success && response.code) {
        setResult({
          code: response.code,
          explanation: response.explanation || '',
        });
      } else {
        alert(`意图编程失败: ${response.error || '未知错误'}`);
      }
    } catch (error: any) {
      console.error('[useIntentToCode] Execution failed:', error);
      alert(`意图编程异常: ${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, [selectedCode, intent, mode]);

  /**
   * 应用结果到编辑器
   */
  const applyResult = useCallback(() => {
    const editor = editorRef.current;
    if (!editor || !result || !selectedRange) return;

    const model = editor.getModel();
    if (!model) return;

    if (mode === 'rewrite') {
      // rewrite 模式：替换选中区域
      editor.executeEdits('intent-to-code', [
        {
          range: {
            startLineNumber: selectedRange.startLine,
            startColumn: 1,
            endLineNumber: selectedRange.endLine,
            endColumn: model.getLineMaxColumn(selectedRange.endLine),
          },
          text: result.code,
        },
      ]);
    } else {
      // generate 模式：在当前行下方插入
      const insertLine = selectedRange.endLine + 1;
      editor.executeEdits('intent-to-code', [
        {
          range: {
            startLineNumber: insertLine,
            startColumn: 1,
            endLineNumber: insertLine,
            endColumn: 1,
          },
          text: result.code + '\n',
        },
      ]);

      // 定位到插入的代码
      editor.setPosition({ lineNumber: insertLine, column: 1 });
      editor.revealLineInCenter(insertLine);
    }

    // 关闭对话框
    close();
  }, [editorRef, result, selectedRange, mode]);

  /**
   * 关闭对话框
   */
  const close = useCallback(() => {
    setVisible(false);
    setLoading(false);
    setSelectedCode('');
    setSelectedRange(null);
    setIntent('');
    setResult(null);
  }, []);

  return {
    state: {
      visible,
      loading,
      selectedCode,
      selectedRange,
      intent,
      result,
      mode,
    },
    openIntent,
    setIntent,
    executeIntent,
    applyResult,
    close,
  };
}
