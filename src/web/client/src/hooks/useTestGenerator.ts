/**
 * useTestGenerator Hook
 * 实现测试代码生成功能：为选中的函数/类生成单元测试
 */

import { useState, useCallback, useRef } from 'react';
import * as Monaco from 'monaco-editor';
import { aiTestGenApi } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseTestGeneratorOptions {
  filePath: string | null;
  language: string;
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
}

export interface UseTestGeneratorReturn {
  state: {
    visible: boolean;
    loading: boolean;
    selectedCode: string;
    functionName: string;
    result: {
      testCode: string;
      testFramework: string;
      testCount: number;
      explanation: string;
    } | null;
  };
  openGenerator: () => void;
  generate: () => Promise<void>;
  copyToClipboard: () => Promise<void>;
  close: () => void;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 从代码中提取函数名
 */
function extractFunctionName(code: string): string {
  // 尝试匹配各种函数定义模式
  const patterns = [
    // JavaScript/TypeScript: function xxx
    /function\s+(\w+)/,
    // JavaScript/TypeScript: const xxx = 
    /const\s+(\w+)\s*=/,
    // JavaScript/TypeScript: export function xxx
    /export\s+function\s+(\w+)/,
    // JavaScript/TypeScript: export const xxx =
    /export\s+const\s+(\w+)\s*=/,
    // Class: class xxx
    /class\s+(\w+)/,
    // Python: def xxx
    /def\s+(\w+)/,
    // Go: func xxx
    /func\s+(\w+)/,
    // Rust: fn xxx
    /fn\s+(\w+)/,
    // Java: public/private xxx(
    /(?:public|private|protected)\s+(?:static\s+)?[\w<>]+\s+(\w+)\s*\(/,
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return 'unknown';
}

/**
 * 获取当前光标所在的函数定义
 */
function getCurrentFunctionAtCursor(
  editor: Monaco.editor.IStandaloneCodeEditor
): { code: string; functionName: string } | null {
  const model = editor.getModel();
  if (!model) return null;

  const position = editor.getPosition();
  if (!position) return null;

  const totalLines = model.getLineCount();
  let startLine = position.lineNumber;
  let endLine = position.lineNumber;

  // 向上查找函数开始
  for (let i = position.lineNumber; i >= 1; i--) {
    const lineContent = model.getLineContent(i);
    // 检查是否是函数定义行
    if (
      /function\s+\w+/.test(lineContent) ||
      /const\s+\w+\s*=/.test(lineContent) ||
      /class\s+\w+/.test(lineContent) ||
      /def\s+\w+/.test(lineContent) ||
      /func\s+\w+/.test(lineContent) ||
      /fn\s+\w+/.test(lineContent) ||
      /(?:public|private|protected)\s+(?:static\s+)?[\w<>]+\s+\w+\s*\(/.test(lineContent)
    ) {
      startLine = i;
      break;
    }
  }

  // 向下查找函数结束（简单的括号匹配）
  let braceCount = 0;
  let started = false;
  for (let i = startLine; i <= totalLines; i++) {
    const lineContent = model.getLineContent(i);
    for (const char of lineContent) {
      if (char === '{') {
        braceCount++;
        started = true;
      } else if (char === '}') {
        braceCount--;
      }
    }

    if (started && braceCount === 0) {
      endLine = i;
      break;
    }
  }

  // 如果没有找到闭合括号，使用当前行后 50 行作为范围
  if (endLine === position.lineNumber) {
    endLine = Math.min(startLine + 50, totalLines);
  }

  const code = model.getValueInRange({
    startLineNumber: startLine,
    startColumn: 1,
    endLineNumber: endLine,
    endColumn: model.getLineMaxColumn(endLine),
  });

  const functionName = extractFunctionName(code);

  return { code, functionName };
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useTestGenerator(options: UseTestGeneratorOptions): UseTestGeneratorReturn {
  const { filePath, language, editorRef } = options;

  // 状态
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [functionName, setFunctionName] = useState('');
  const [result, setResult] = useState<{
    testCode: string;
    testFramework: string;
    testCount: number;
    explanation: string;
  } | null>(null);

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const languageRef = useRef(language);

  // 更新 ref
  filePathRef.current = filePath;
  languageRef.current = language;

  /**
   * 打开测试生成对话框
   */
  const openGenerator = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    const selection = editor.getSelection();
    if (!selection) return;

    // 检查是否有选中文本
    const selectedText = model.getValueInRange(selection);

    if (selectedText && selectedText.trim()) {
      // 有选中文本
      const funcName = extractFunctionName(selectedText);
      setSelectedCode(selectedText);
      setFunctionName(funcName);
      setVisible(true);
      setResult(null);
    } else {
      // 没有选中文本，尝试获取光标所在的函数
      const funcInfo = getCurrentFunctionAtCursor(editor);
      if (funcInfo) {
        setSelectedCode(funcInfo.code);
        setFunctionName(funcInfo.functionName);
        setVisible(true);
        setResult(null);
      }
    }
  }, [editorRef]);

  /**
   * 生成测试代码
   */
  const generate = useCallback(async () => {
    if (!filePathRef.current || !selectedCode || !functionName) return;

    setLoading(true);
    setResult(null);

    try {
      const response = await aiTestGenApi.generate({
        filePath: filePathRef.current,
        code: selectedCode,
        functionName,
        language: languageRef.current,
      });

      if (response.success && response.testCode) {
        setResult({
          testCode: response.testCode,
          testFramework: response.testFramework || 'vitest',
          testCount: response.testCount || 0,
          explanation: response.explanation || '',
        });
      } else {
        alert(`测试生成失败: ${response.error || '未知错误'}`);
      }
    } catch (error: any) {
      console.error('[useTestGenerator] Generation failed:', error);
      alert(`测试生成异常: ${error.message || '未知错误'}`);
    } finally {
      setLoading(false);
    }
  }, [selectedCode, functionName]);

  /**
   * 复制到剪贴板
   */
  const copyToClipboard = useCallback(async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.testCode);
      alert('测试代码已复制到剪贴板');
    } catch (error: any) {
      console.error('[useTestGenerator] Copy failed:', error);
      alert(`复制失败: ${error.message || '未知错误'}`);
    }
  }, [result]);

  /**
   * 关闭对话框
   */
  const close = useCallback(() => {
    setVisible(false);
    setLoading(false);
    setSelectedCode('');
    setFunctionName('');
    setResult(null);
  }, []);

  return {
    state: {
      visible,
      loading,
      selectedCode,
      functionName,
      result,
    },
    openGenerator,
    generate,
    copyToClipboard,
    close,
  };
}
