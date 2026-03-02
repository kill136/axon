/**
 * useApiDocOverlay Hook
 * API 文档叠加：鼠标悬停第三方库函数时显示 API 文档
 */

import { useEffect, useRef } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { aiApiDocApi } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseApiDocOverlayOptions {
  enabled: boolean;
  filePath: string | null;
  language: string;
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  monacoRef: React.RefObject<typeof Monaco | null>;
  editorReady: boolean;
}

export interface UseApiDocOverlayReturn {
  enabled: boolean;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useApiDocOverlay(options: UseApiDocOverlayOptions): UseApiDocOverlayReturn {
  const { enabled, filePath, language, editorRef, monacoRef, editorReady } = options;

  // HoverProvider 引用
  const hoverProviderRef = useRef<MonacoEditor.IDisposable | null>(null);

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const languageRef = useRef(language);

  // 更新 ref
  filePathRef.current = filePath;
  languageRef.current = language;

  // 文档缓存（局部缓存，避免重复调用）
  const docCacheRef = useRef<Map<string, any>>(new Map());

  // 防抖定时器
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * 注册 HoverProvider
   */
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !editorReady || !enabled) {
      // 清除 provider
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
        hoverProviderRef.current = null;
      }
      return;
    }

    const monaco = monacoRef.current;
    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    const languageId = model.getLanguageId();

    console.log(`[API Doc Overlay] Registering HoverProvider, language: ${languageId}`);

    // 注册 Hover Provider
    hoverProviderRef.current = monaco.languages.registerHoverProvider(languageId, {
      provideHover: async (model, position, token) => {
        // 获取光标位置的单词
        const wordAtPosition = model.getWordAtPosition(position);
        if (!wordAtPosition) return null;

        const symbolName = wordAtPosition.word;

        // 简单启发式：检查是否可能是第三方 API
        // 1. 太短的单词（如 i, j, x）不太可能是 API
        if (symbolName.length <= 2) return null;

        // 2. 常见的语言关键字和内置类型不查询
        const commonKeywords = new Set([
          'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
          'import', 'export', 'from', 'default', 'async', 'await', 'return',
          'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue',
          'string', 'number', 'boolean', 'object', 'array', 'void', 'null', 'undefined',
          'any', 'never', 'unknown', 'true', 'false', 'this', 'super', 'new',
        ]);
        if (commonKeywords.has(symbolName.toLowerCase())) return null;

        // 检查缓存
        const cacheKey = `${symbolName}:${languageRef.current}`;
        if (docCacheRef.current.has(cacheKey)) {
          const cached = docCacheRef.current.get(cacheKey);
          if (cached === null) return null; // 之前查询失败的也缓存
          return cached;
        }

        // 防抖：避免鼠标快速移动时触发太多请求
        return new Promise((resolve) => {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }

          debounceTimerRef.current = setTimeout(async () => {
            try {
              // 获取代码上下文（前后各 5 行）
              const lineNumber = position.lineNumber;
              const startLine = Math.max(1, lineNumber - 5);
              const endLine = Math.min(model.getLineCount(), lineNumber + 5);
              const codeContext = model.getValueInRange({
                startLineNumber: startLine,
                startColumn: 1,
                endLineNumber: endLine,
                endColumn: model.getLineMaxColumn(endLine),
              });

              console.log(`[API Doc Overlay] Querying API doc: ${symbolName}`);

              const result = await aiApiDocApi.lookup({
                symbolName,
                language: languageRef.current,
                codeContext,
              });

              if (!result.success || !result.doc) {
                // 查询失败，缓存 null
                docCacheRef.current.set(cacheKey, null);
                resolve(null);
                return;
              }

              const doc = result.doc;

              // 构建 Markdown 格式的文档
              let markdownContent = `### ${doc.name}\n\n`;
              
              if (doc.package) {
                markdownContent += `**包**: ${doc.package}\n\n`;
              }

              if (doc.brief) {
                markdownContent += `${doc.brief}\n\n`;
              }

              // 参数
              if (doc.params && doc.params.length > 0) {
                markdownContent += `**参数**:\n`;
                doc.params.forEach(param => {
                  const optional = param.optional ? ' (可选)' : '';
                  markdownContent += `- \`${param.name}\` (\`${param.type}\`)${optional}: ${param.description}\n`;
                });
                markdownContent += `\n`;
              }

              // 返回值
              if (doc.returns) {
                markdownContent += `**返回**: \`${doc.returns.type}\` - ${doc.returns.description}\n\n`;
              }

              // 示例
              if (doc.examples && doc.examples.length > 0) {
                markdownContent += `**示例**:\n`;
                doc.examples.forEach((example, idx) => {
                  markdownContent += `\n\`\`\`${languageRef.current}\n${example}\n\`\`\`\n`;
                });
                markdownContent += `\n`;
              }

              // 注意事项
              if (doc.pitfalls && doc.pitfalls.length > 0) {
                markdownContent += `**⚠️ 注意事项**:\n`;
                doc.pitfalls.forEach(pitfall => {
                  markdownContent += `- ${pitfall}\n`;
                });
                markdownContent += `\n`;
              }

              // 相关 API
              if (doc.seeAlso && doc.seeAlso.length > 0) {
                markdownContent += `**相关 API**: ${doc.seeAlso.join(', ')}\n`;
              }

              const hoverResult = {
                contents: [
                  { value: markdownContent },
                ],
              };

              // 缓存结果
              docCacheRef.current.set(cacheKey, hoverResult);

              console.log(`[API Doc Overlay] Doc query success: ${symbolName}${result.fromCache ? ' (cached)' : ''}`);

              resolve(hoverResult);
            } catch (error: any) {
              console.error('[API Doc Overlay] Doc query failed:', error);
              docCacheRef.current.set(cacheKey, null);
              resolve(null);
            }
          }, 300); // 300ms 防抖
        });
      },
    });

    // 清理函数
    return () => {
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
        hoverProviderRef.current = null;
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [enabled, editorReady, editorRef, monacoRef]);

  /**
   * 文件切换时清除缓存
   */
  useEffect(() => {
    docCacheRef.current.clear();
  }, [filePath]);

  return {
    enabled,
  };
}
