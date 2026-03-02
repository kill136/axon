/**
 * useAutoComplete Hook
 * 
 * 为 Monaco Editor 提供三层自动代码补全功能：
 * 1. 第一层：本地快速补全（标识符、关键字、代码片段）
 * 2. 第二层：import 路径补全（文件/文件夹）
 * 3. 第三层：AI Inline Completion（Ghost Text，用户按 Tab 接受）
 */

import { useEffect, useRef, useState } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { aiEditorApi } from '../api/ai-editor';

/**
 * Hook 配置选项
 */
export interface UseAutoCompleteOptions {
  /** 是否启用自动补全 */
  enabled: boolean;
  /** 当前文件路径 */
  filePath: string | null;
  /** 文件语言 */
  language: string;
  /** Monaco Editor 实例引用 */
  editorRef: React.MutableRefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  /** Monaco 命名空间引用 */
  monacoRef: React.MutableRefObject<typeof Monaco | null>;
  /** Editor 是否已准备就绪（必须用 state 驱动，ref 变化不触发 effect） */
  editorReady: boolean;
  /** 项目根路径（用于路径补全） */
  projectPath?: string;
}

/**
 * Hook 返回值
 */
export interface UseAutoCompleteReturn {
  /** 是否启用 */
  enabled: boolean;
  /** 切换启用状态 */
  toggle: () => void;
  /** 统计信息 */
  stats: {
    localItems: number;
    snippetItems: number;
  };
}

/**
 * TypeScript/JavaScript 关键字
 */
const TS_JS_KEYWORDS = [
  'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum',
  'export', 'import', 'async', 'await', 'return', 'if', 'else', 'for',
  'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally',
  'throw', 'new', 'this', 'super', 'extends', 'implements', 'typeof',
  'instanceof', 'in', 'of', 'void', 'null', 'undefined', 'true', 'false',
  'default', 'static', 'readonly', 'private', 'public', 'protected',
  'abstract', 'as', 'from', 'get', 'set', 'yield', 'delete', 'debugger',
];

/**
 * 代码片段定义
 */
const CODE_SNIPPETS = [
  { label: 'log', insertText: 'console.log(${1})', detail: 'console.log()' },
  { label: 'fn', insertText: 'function ${1}(${2}) {\n\t${3}\n}', detail: 'function declaration' },
  { label: 'afn', insertText: 'async function ${1}(${2}) {\n\t${3}\n}', detail: 'async function' },
  { label: 'arr', insertText: '(${1}) => ${2}', detail: 'arrow function' },
  { label: 'iife', insertText: '(() => {\n\t${1}\n})()', detail: 'immediately invoked function' },
  { label: 'imp', insertText: 'import { ${1} } from \'${2}\'', detail: 'import named' },
  { label: 'impd', insertText: 'import ${1} from \'${2}\'', detail: 'import default' },
  { label: 'exp', insertText: 'export { ${1} }', detail: 'export named' },
  { label: 'expd', insertText: 'export default ${1}', detail: 'export default' },
  { label: 'iff', insertText: 'if (${1}) {\n\t${2}\n}', detail: 'if statement' },
  { label: 'ifel', insertText: 'if (${1}) {\n\t${2}\n} else {\n\t${3}\n}', detail: 'if-else statement' },
  { label: 'forr', insertText: 'for (let ${1} = 0; ${1} < ${2}; ${1}++) {\n\t${3}\n}', detail: 'for loop' },
  { label: 'forof', insertText: 'for (const ${1} of ${2}) {\n\t${3}\n}', detail: 'for-of loop' },
  { label: 'forin', insertText: 'for (const ${1} in ${2}) {\n\t${3}\n}', detail: 'for-in loop' },
  { label: 'tryc', insertText: 'try {\n\t${1}\n} catch (err) {\n\t${2}\n}', detail: 'try-catch block' },
  { label: 'map', insertText: '.map((${1}) => ${2})', detail: 'array map' },
  { label: 'filter', insertText: '.filter((${1}) => ${2})', detail: 'array filter' },
  { label: 'reduce', insertText: '.reduce((${1}, ${2}) => ${3}, ${4})', detail: 'array reduce' },
  { label: 'prom', insertText: 'new Promise((resolve, reject) => {\n\t${1}\n})', detail: 'new Promise' },
  { label: 'cl', insertText: 'class ${1} {\n\tconstructor(${2}) {\n\t\t${3}\n\t}\n}', detail: 'class definition' },
  { label: 'intf', insertText: 'interface ${1} {\n\t${2}\n}', detail: 'interface definition' },
  { label: 'type', insertText: 'type ${1} = ${2}', detail: 'type alias' },
  { label: 'uestate', insertText: 'const [${1}, set${2}] = useState(${3})', detail: 'useState hook' },
  { label: 'ueeffect', insertText: 'useEffect(() => {\n\t${1}\n\treturn () => {\n\t\t${2}\n\t}\n}, [${3}])', detail: 'useEffect hook' },
  { label: 'useref', insertText: 'const ${1} = useRef(${2})', detail: 'useRef hook' },
  { label: 'usememo', insertText: 'const ${1} = useMemo(() => ${2}, [${3}])', detail: 'useMemo hook' },
  { label: 'usecb', insertText: 'const ${1} = useCallback((${2}) => {\n\t${3}\n}, [${4}])', detail: 'useCallback hook' },
];

/**
 * 从文本中提取标识符
 */
function extractIdentifiers(content: string): Set<string> {
  const identifiers = new Set<string>();
  // 匹配标识符（变量名、函数名、类名等）
  const regex = /\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;
  const matches = content.match(regex);
  
  if (matches) {
    matches.forEach(match => {
      // 过滤掉关键字和太短的标识符
      if (!TS_JS_KEYWORDS.includes(match) && match.length >= 2) {
        identifiers.add(match);
      }
    });
  }
  
  return identifiers;
}

/**
 * 检查光标是否在 import/require 语句的引号中
 */
function isInImportPath(lineContent: string, column: number): { isImport: boolean; prefix: string } {
  // 匹配 import ... from '...' 或 require('...')
  const importRegex = /(?:import\s+.*?\s+from\s+['"]|require\s*\(\s*['"])([^'"]*)/;
  const match = lineContent.match(importRegex);
  
  if (match && match[1] !== undefined) {
    const quoteStart = lineContent.indexOf(match[1]);
    const quoteEnd = quoteStart + match[1].length;
    
    // 光标在引号内
    if (column >= quoteStart && column <= quoteEnd) {
      return {
        isImport: true,
        prefix: match[1],
      };
    }
  }
  
  return { isImport: false, prefix: '' };
}

/**
 * useAutoComplete Hook
 */
export function useAutoComplete(options: UseAutoCompleteOptions): UseAutoCompleteReturn {
  const { enabled, filePath, language, editorRef, monacoRef, editorReady, projectPath } = options;

  const [internalEnabled, setInternalEnabled] = useState(enabled);
  const [stats, setStats] = useState({ localItems: 0, snippetItems: CODE_SNIPPETS.length });

  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const inlineProviderRef = useRef<{ dispose: () => void } | null>(null);

  // 用 ref 存可变值，供 provider 回调闭包读取最新值
  const filePathRef = useRef(filePath);
  const languageRef = useRef(language);
  const projectPathRef = useRef(projectPath);
  filePathRef.current = filePath;
  languageRef.current = language;
  projectPathRef.current = projectPath;

  // AI 补全防抖 timer
  const aiDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 更新内部启用状态
  useEffect(() => {
    setInternalEnabled(enabled);
  }, [enabled]);

  // ========================================================================
  // 第一层 + 第二层：CompletionItemProvider
  // 依赖 editorReady（state）来感知 editor mount，而不是 editorRef（ref）
  // provider 只注册一次，通过 ref 读取最新的 filePath/language
  // ========================================================================

  useEffect(() => {
    const monaco = monacoRef.current;

    if (!internalEnabled || !editorReady || !monaco) {
      // 清理已注册的 provider
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
      return;
    }

    // 注册 CompletionItemProvider（对所有支持的语言注册一次）
    const provider = monaco.languages.registerCompletionItemProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python', 'go', 'rust', 'java', 'css', 'html', 'json'],
      {
        triggerCharacters: ['.', '/', '"', "'", '`', '<', '@', '#'],
        provideCompletionItems: async (model, position) => {
          const lineContent = model.getLineContent(position.lineNumber);
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions: any[] = [];

          // 从 ref 读取最新值
          const currentFilePath = filePathRef.current;
          const currentLanguage = languageRef.current;
          const currentProjectPath = projectPathRef.current;

          // 检查是否在 import 路径中
          const { isImport, prefix } = isInImportPath(lineContent, position.column);
          
          if (isImport && currentFilePath) {
            // 第二层：import 路径补全
            try {
              const response = await aiEditorApi.complete.completePath({
                filePath: currentFilePath,
                prefix,
                root: currentProjectPath,
              });

              if (response.success && response.items) {
                response.items.forEach((item) => {
                  suggestions.push({
                    label: item.label,
                    kind: item.kind === 'folder'
                      ? monaco.languages.CompletionItemKind.Folder
                      : monaco.languages.CompletionItemKind.File,
                    insertText: item.label,
                    detail: item.detail,
                    range,
                    sortText: `0_${item.label}`,
                  });
                });
              }
            } catch (error) {
              console.error('[AutoComplete] Path completion failed:', error);
            }

            return { suggestions };
          }

          // 第一层：本地标识符 + 关键字 + 代码片段

          // 1. 本地标识符（从当前编辑器内容提取）
          const currentContent = model.getValue();
          const identifiers = extractIdentifiers(currentContent);
          
          const prefixLower = word.word.toLowerCase();
          identifiers.forEach(id => {
            const idLower = id.toLowerCase();
            const sortText = idLower.startsWith(prefixLower) ? '1_' : '2_';
            
            suggestions.push({
              label: id,
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: id,
              range,
              sortText: sortText + id,
            });
          });

          // 2. 关键字（仅 TypeScript/JavaScript）
          const tsLangs = ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'];
          if (tsLangs.includes(currentLanguage)) {
            TS_JS_KEYWORDS.forEach(keyword => {
              const sortText = keyword.startsWith(prefixLower) ? '1_' : '2_';
              
              suggestions.push({
                label: keyword,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: keyword,
                range,
                sortText: sortText + keyword,
              });
            });

            // 3. 代码片段
            CODE_SNIPPETS.forEach(snippet => {
              const sortText = snippet.label.startsWith(prefixLower) ? '1_' : '2_';
              
              suggestions.push({
                label: snippet.label,
                kind: monaco.languages.CompletionItemKind.Snippet,
                insertText: snippet.insertText,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                detail: snippet.detail,
                range,
                sortText: sortText + snippet.label,
              });
            });
          }

          // 更新统计
          setStats({
            localItems: identifiers.size + (tsLangs.includes(currentLanguage) ? TS_JS_KEYWORDS.length : 0),
            snippetItems: tsLangs.includes(currentLanguage) ? CODE_SNIPPETS.length : 0,
          });

          return { suggestions };
        },
      }
    );

    completionProviderRef.current = provider;

    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
    };
  }, [internalEnabled, editorReady]);

  // ========================================================================
  // 第三层：AI Inline Completion（Ghost Text）
  // 同样依赖 editorReady，provider 回调通过 ref 读取最新值
  // ========================================================================

  useEffect(() => {
    const monaco = monacoRef.current;

    if (!internalEnabled || !editorReady || !monaco) {
      if (inlineProviderRef.current) {
        inlineProviderRef.current.dispose();
        inlineProviderRef.current = null;
      }
      return;
    }

    const provider = monaco.languages.registerInlineCompletionsProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact', 'python', 'go', 'rust', 'java'],
      {
        provideInlineCompletions: async (model, position, _context, token) => {
          // 取消之前的防抖 timer
          if (aiDebounceTimerRef.current) {
            clearTimeout(aiDebounceTimerRef.current);
          }

          // 防抖 300ms（平衡响应速度和请求频率）
          await new Promise<void>(resolve => {
            aiDebounceTimerRef.current = setTimeout(resolve, 300);
          });

          // 检查是否被取消
          if (token.isCancellationRequested) {
            return { items: [] };
          }

          const currentFilePath = filePathRef.current;
          const currentLanguage = languageRef.current;
          if (!currentFilePath) {
            return { items: [] };
          }

          // 获取上下文
          const currentLine = model.getLineContent(position.lineNumber);
          const currentLinePrefix = currentLine.substring(0, position.column - 1);
          
          // 只有在有实际输入文本时才触发
          if (!currentLinePrefix.trim()) {
            return { items: [] };
          }

          // 获取光标前 50 行
          const startLine = Math.max(1, position.lineNumber - 50);
          const prefixLines: string[] = [];
          for (let i = startLine; i < position.lineNumber; i++) {
            prefixLines.push(model.getLineContent(i));
          }
          prefixLines.push(currentLinePrefix);
          const prefix = prefixLines.join('\n');

          // 获取光标后 20 行
          const endLine = Math.min(model.getLineCount(), position.lineNumber + 20);
          const suffixLines: string[] = [];
          const currentLineSuffix = currentLine.substring(position.column - 1);
          if (currentLineSuffix) {
            suffixLines.push(currentLineSuffix);
          }
          for (let i = position.lineNumber + 1; i <= endLine; i++) {
            suffixLines.push(model.getLineContent(i));
          }
          const suffix = suffixLines.join('\n');

          // 再次检查取消（网络请求前）
          if (token.isCancellationRequested) {
            return { items: [] };
          }

          try {
            const response = await aiEditorApi.complete.inlineComplete({
              filePath: currentFilePath,
              language: currentLanguage,
              prefix,
              suffix,
              currentLine,
              cursorColumn: position.column,
            });

            // 请求返回后再次检查取消
            if (token.isCancellationRequested) {
              return { items: [] };
            }

            if (response.success && response.completion) {
              const completion = response.completion.trim();
              
              if (completion) {
                return {
                  items: [
                    {
                      insertText: completion,
                      range: new monaco.Range(
                        position.lineNumber,
                        position.column,
                        position.lineNumber,
                        position.column
                      ),
                    },
                  ],
                };
              }
            }
          } catch (error) {
            console.error('[AutoComplete] AI inline completion failed:', error);
          }

          return { items: [] };
        },
        freeInlineCompletions: () => {},
      }
    );

    inlineProviderRef.current = provider;

    return () => {
      if (inlineProviderRef.current) {
        inlineProviderRef.current.dispose();
        inlineProviderRef.current = null;
      }
      if (aiDebounceTimerRef.current) {
        clearTimeout(aiDebounceTimerRef.current);
      }
    };
  }, [internalEnabled, editorReady]);

  // ========================================================================
  // 返回 API
  // ========================================================================

  return {
    enabled: internalEnabled,
    toggle: () => setInternalEnabled(!internalEnabled),
    stats,
  };
}
