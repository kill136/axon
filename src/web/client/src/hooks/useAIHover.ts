/**
 * useAIHover Hook
 * 
 * 从 BlueprintDetailContent.tsx 提取的三层悬浮提示逻辑
 * 提供 Monaco Editor 智能悬浮提示：
 * 1. 第一层：JSDoc 注释（用户编写的文档）
 * 2. 第二层：语法关键字解释（本地字典，0ms 响应）
 * 3. 第三层：AI 语义分析（异步调用后端 API）
 */

import { useEffect, useRef } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { getSyntaxExplanation, extractKeywordsFromLine, type SyntaxExplanation } from '../utils/syntaxDictionary';
import { extractJSDocForLine, hasValidJSDoc } from '../utils/jsdocParser';
import { aiHoverApi, type AIHoverResult } from '../api/ai-editor';

/**
 * 行级 AI 分析数据
 */
export interface LineAnalysisData {
  lineNumber: number;
  lineContent: string;
  keywords: Array<{ keyword: string; brief: string; detail?: string; example?: string }>;
  aiAnalysis: AIHoverResult | null;
  loading: boolean;
}

/**
 * Hook 配置选项
 */
export interface UseAIHoverOptions {
  /** 是否启用（新手模式开关） */
  enabled: boolean;
  /** 当前文件路径 */
  filePath: string | null;
  /** Monaco Editor 实例引用 */
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  /** Monaco 命名空间引用 */
  monacoRef: React.RefObject<typeof Monaco | null>;
  /** 行分析回调（用于右侧面板显示） */
  onLineAnalysis?: (analysis: LineAnalysisData | null) => void;
}

/**
 * Hook 返回值
 */
export interface UseAIHoverReturn {
  /** 手动清理 HoverProvider */
  dispose: () => void;
}

/**
 * AI Hover Hook
 * 
 * 注册 Monaco HoverProvider，提供三层智能悬浮提示
 */
export function useAIHover(options: UseAIHoverOptions): UseAIHoverReturn {
  const { enabled, filePath, editorRef, monacoRef, onLineAnalysis } = options;

  // HoverProvider 实例引用
  const hoverProviderRef = useRef<{ dispose: () => void } | null>(null);

  // 行级 AI 分析缓存（filePath:lineNumber -> 分析结果）
  const lineAnalysisCacheRef = useRef<Map<string, {
    lineContent: string;
    keywords: string[];
    aiAnalysis: AIHoverResult | null;
    loading: boolean;
  }>>(new Map());

  // 注册 HoverProvider
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;

    // 清理旧的 HoverProvider
    if (hoverProviderRef.current) {
      hoverProviderRef.current.dispose();
      hoverProviderRef.current = null;
    }

    // 只在启用时注册
    if (!enabled || !monaco || !editor || !filePath) {
      return;
    }

    // 注册增强的 Hover Provider（精简悬浮 + 右侧面板详情）
    const hoverProvider = monaco.languages.registerHoverProvider(
      ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
      {
        provideHover: async (model: any, position: any) => {
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
          const cacheKey = `${filePath}:${lineNumber}`;
          const cached = lineAnalysisCacheRef.current.get(cacheKey);

          // 如果缓存的行内容不同，清除缓存
          if (cached && cached.lineContent !== lineContent) {
            lineAnalysisCacheRef.current.delete(cacheKey);
          }

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
            onLineAnalysis?.({
              lineNumber,
              lineContent,
              keywords: staticKeywords,
              aiAnalysis: existingCache.aiAnalysis,
              loading: existingCache.loading,
            });
          } else {
            // 显示静态内容，标记 AI 加载中
            onLineAnalysis?.({
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
                  filePath: filePath || '',
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

                // 更新面板（使用函数式更新，避免依赖过期的 state）
                onLineAnalysis?.({
                  lineNumber,
                  lineContent,
                  keywords: staticKeywords,
                  aiAnalysis: aiResult.success ? aiResult : null,
                  loading: false,
                });
              } catch (error) {
                console.warn('[AI Line Analysis] 调用失败:', error);
                lineAnalysisCacheRef.current.set(cacheKey, {
                  lineContent,
                  keywords: keywords,
                  aiAnalysis: null,
                  loading: false,
                });
                onLineAnalysis?.({
                  lineNumber,
                  lineContent,
                  keywords: staticKeywords,
                  aiAnalysis: null,
                  loading: false,
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
      }
    );

    // 保存到 ref，以便后续清理
    hoverProviderRef.current = hoverProvider;

    // 清理函数
    return () => {
      if (hoverProviderRef.current) {
        hoverProviderRef.current.dispose();
        hoverProviderRef.current = null;
      }
    };
  }, [enabled, filePath, editorRef, monacoRef, onLineAnalysis]);

  // 手动清理函数
  const dispose = () => {
    if (hoverProviderRef.current) {
      hoverProviderRef.current.dispose();
      hoverProviderRef.current = null;
    }
  };

  return { dispose };
}
