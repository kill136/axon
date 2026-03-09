/**
 * useSelectionExplain Hook
 * 
 * 选中文本后自动弹出浮动 AI 解释卡片
 * 使用 Monaco contentWidget 实现，在选中位置下方显示
 */

import { useEffect, useRef, useCallback } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { aiHoverApi, type AIHoverResult } from '../api/ai-editor';

export interface UseSelectionExplainOptions {
  /** Monaco Editor 实例引用 */
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
  /** Monaco 命名空间引用 */
  monacoRef: React.RefObject<typeof Monaco | null>;
  /** 当前文件路径 */
  filePath: string | null;
  /** 是否启用 */
  enabled: boolean;
  /** UI 语言 (en/zh) */
  locale?: string;
}

export interface UseSelectionExplainReturn {
  /** 手动清理 */
  dispose: () => void;
}

// 防抖定时器和 AbortController 管理
interface InternalState {
  debounceTimer: ReturnType<typeof setTimeout> | null;
  abortController: AbortController | null;
  currentWidgetId: string | null;
  widgetDomNode: HTMLDivElement | null;
}

export function useSelectionExplain(options: UseSelectionExplainOptions): UseSelectionExplainReturn {
  const { editorRef, monacoRef, filePath, enabled, locale } = options;

  const stateRef = useRef<InternalState>({
    debounceTimer: null,
    abortController: null,
    currentWidgetId: null,
    widgetDomNode: null,
  });

  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const localeRef = useRef(locale);
  localeRef.current = locale;

  // 移除当前 widget
  const removeWidget = useCallback(() => {
    const editor = editorRef.current;
    const state = stateRef.current;

    if (state.currentWidgetId && editor) {
      try {
        editor.removeContentWidget({
          getId: () => state.currentWidgetId!,
          getDomNode: () => state.widgetDomNode!,
          getPosition: () => null,
        });
      } catch (_e) {
        // widget 可能已被移除
      }
    }

    // 清理 DOM 节点
    if (state.widgetDomNode && state.widgetDomNode.parentNode) {
      state.widgetDomNode.parentNode.removeChild(state.widgetDomNode);
    }

    state.currentWidgetId = null;
    state.widgetDomNode = null;

    // 取消进行中的请求
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
  }, [editorRef]);

  // 创建并显示 widget
  const showExplainWidget = useCallback(
    (selectedText: string, position: MonacoEditor.IPosition, lineContent: string) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;

      // 清理旧的
      removeWidget();

      const state = stateRef.current;
      const widgetId = `selection-explain-${Date.now()}`;

      // 创建 DOM 节点
      const domNode = document.createElement('div');
      domNode.className = 'selection-explain-widget';
      domNode.style.cssText = `
        max-width: 500px;
        min-width: 240px;
        max-height: 400px;
        overflow-y: auto;
        padding: 10px 14px;
        background: #1e1e2e;
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.1);
        color: rgba(255, 255, 255, 0.9);
        font-size: 12.5px;
        line-height: 1.5;
        z-index: 1000;
        pointer-events: auto;
        animation: selectionExplainFadeIn 0.15s ease-out;
      `;

      // 初始加载状态
      domNode.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          <span style="font-size: 13px; font-weight: 600; color: #a78bfa;">
            <code style="background: rgba(139,92,246,0.15); padding: 1px 6px; border-radius: 3px; font-size: 12px;">${escapeHtml(selectedText.length > 40 ? selectedText.slice(0, 40) + '...' : selectedText)}</code>
          </span>
        </div>
        <div style="color: rgba(255,255,255,0.5); font-size: 11px;">
          <span class="selection-explain-spinner"></span> AI 分析中...
        </div>
      `;

      state.currentWidgetId = widgetId;
      state.widgetDomNode = domNode;

      // 注册 contentWidget
      const contentWidget: MonacoEditor.editor.IContentWidget = {
        getId: () => widgetId,
        getDomNode: () => domNode,
        getPosition: () => ({
          position: { lineNumber: position.lineNumber, column: position.column },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.BELOW,
            monaco.editor.ContentWidgetPositionPreference.ABOVE,
          ],
        }),
      };

      editor.addContentWidget(contentWidget);

      // 异步调用 AI
      const abortController = new AbortController();
      state.abortController = abortController;

      (async () => {
        try {
          // 获取上下文（±5行）
          const model = editor.getModel();
          if (!model) return;

          const startLine = Math.max(1, position.lineNumber - 5);
          const endLine = Math.min(model.getLineCount(), position.lineNumber + 5);
          const contextLines: string[] = [];
          for (let i = startLine; i <= endLine; i++) {
            const prefix = i === position.lineNumber ? '>>>' : '   ';
            const lineNum = String(i).padStart(4, ' ');
            contextLines.push(`${prefix} ${lineNum} | ${model.getLineContent(i)}`);
          }

          const aiResult = await aiHoverApi.generate({
            filePath: filePathRef.current || '',
            symbolName: selectedText,
            codeContext: contextLines.join('\n'),
            line: position.lineNumber,
            language: 'typescript',
            locale: localeRef.current,
          });

          // 检查是否已被取消
          if (abortController.signal.aborted) return;
          if (state.currentWidgetId !== widgetId) return;

          // 更新 widget 内容
          if (aiResult.success && aiResult.brief) {
            let html = `
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                <code style="background: rgba(139,92,246,0.15); padding: 1px 6px; border-radius: 3px; font-size: 12px; color: #a78bfa;">${escapeHtml(selectedText.length > 40 ? selectedText.slice(0, 40) + '...' : selectedText)}</code>
              </div>
              <div style="color: rgba(255,255,255,0.85); font-size: 12.5px; line-height: 1.6;">${escapeHtml(aiResult.brief)}</div>
            `;

            if (aiResult.role) {
              html += `<div style="color: #34d399; font-size: 11px; margin-top: 4px; padding: 3px 8px; background: rgba(52,211,153,0.08); border-radius: 4px; display: inline-block;">${escapeHtml(aiResult.role)}</div>`;
            }

            if (aiResult.detail) {
              html += `<div style="color: rgba(255,255,255,0.55); font-size: 11.5px; margin-top: 6px; line-height: 1.5; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">${escapeHtml(aiResult.detail)}</div>`;
            }

            if (aiResult.params && aiResult.params.length > 0) {
              html += `<div style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">`;
              for (const p of aiResult.params) {
                html += `<div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 2px;">
                  <code style="color: #7dd3fc;">${escapeHtml(p.name)}</code>
                  <span style="color: rgba(255,255,255,0.3)">:</span>
                  <span style="color: #fbbf24;">${escapeHtml(p.type)}</span>
                  — ${escapeHtml(p.description)}
                </div>`;
              }
              html += `</div>`;
            }

            // 被引用方
            if (aiResult.usedBy && aiResult.usedBy.length > 0) {
              html += `<div style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">`;
              html += `<div style="font-size: 10px; color: rgba(255,255,255,0.35); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Referenced by</div>`;
              for (const ref of aiResult.usedBy.slice(0, 6)) {
                const fileName = ref.file.split('/').pop() || ref.file;
                html += `<div style="font-size: 10.5px; color: rgba(255,255,255,0.5); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  <code style="color: #93c5fd; font-size: 10px;">${escapeHtml(fileName)}:${ref.line}</code>
                  <span style="color: rgba(255,255,255,0.3); margin: 0 3px;">|</span>
                  <span style="color: rgba(255,255,255,0.4);">${escapeHtml(ref.context.length > 60 ? ref.context.slice(0, 60) + '...' : ref.context)}</span>
                </div>`;
              }
              html += `</div>`;
            }

            // 下级依赖
            if (aiResult.uses && aiResult.uses.length > 0) {
              html += `<div style="margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 6px;">`;
              html += `<div style="font-size: 10px; color: rgba(255,255,255,0.35); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px;">Depends on</div>`;
              html += `<div style="display: flex; flex-wrap: wrap; gap: 4px;">`;
              for (const dep of aiResult.uses.slice(0, 8)) {
                html += `<code style="font-size: 10px; color: #fbbf24; background: rgba(251,191,36,0.08); padding: 1px 5px; border-radius: 3px;">${escapeHtml(dep)}</code>`;
              }
              html += `</div></div>`;
            }

            domNode.innerHTML = html;
          } else {
            domNode.innerHTML = `
              <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                <code style="background: rgba(139,92,246,0.15); padding: 1px 6px; border-radius: 3px; font-size: 12px; color: #a78bfa;">${escapeHtml(selectedText.length > 40 ? selectedText.slice(0, 40) + '...' : selectedText)}</code>
              </div>
              <div style="color: rgba(255,255,255,0.4); font-size: 11px;">无额外信息</div>
            `;
          }

          // 通知 Monaco 重新布局 widget
          editor.layoutContentWidget(contentWidget);
        } catch (err: any) {
          if (abortController.signal.aborted) return;
          if (state.currentWidgetId !== widgetId) return;

          domNode.innerHTML = `
            <div style="color: rgba(255,255,255,0.4); font-size: 11px;">请求失败</div>
          `;
          editor.layoutContentWidget(contentWidget);
        }
      })();
    },
    [editorRef, monacoRef, removeWidget]
  );

  // 主 effect：监听选择变化
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) {
      removeWidget();
      return;
    }

    const disposable = editor.onDidChangeCursorSelection((e) => {
      if (!enabledRef.current) {
        removeWidget();
        return;
      }

      const model = editor.getModel();
      if (!model) return;

      const selection = e.selection;
      const selectedText = model.getValueInRange(selection).trim();

      // 清除旧的定时器
      const state = stateRef.current;
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }

      // 没有选中文本或太短，移除 widget
      if (!selectedText || selectedText.length < 2 || selectedText.length > 200) {
        removeWidget();
        return;
      }

      // 纯数字或纯空白不触发
      if (/^\d+$/.test(selectedText) || /^\s*$/.test(selectedText)) {
        removeWidget();
        return;
      }

      // 多行文本不触发（超过3行）
      if (selectedText.split('\n').length > 3) {
        removeWidget();
        return;
      }

      const lineContent = model.getLineContent(selection.startLineNumber);
      const position: MonacoEditor.IPosition = {
        lineNumber: selection.endLineNumber,
        column: selection.endColumn,
      };

      // 500ms 防抖
      state.debounceTimer = setTimeout(() => {
        showExplainWidget(selectedText, position, lineContent);
      }, 500);
    });

    // 点击其他位置时移除 widget
    const clickDisposable = editor.onDidChangeCursorPosition(() => {
      const model = editor.getModel();
      if (!model) return;
      const selection = editor.getSelection();
      if (!selection) return;
      const selectedText = model.getValueInRange(selection).trim();
      if (!selectedText) {
        removeWidget();
      }
    });

    return () => {
      disposable.dispose();
      clickDisposable.dispose();
      removeWidget();
      const state = stateRef.current;
      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }
    };
  }, [enabled, editorRef, removeWidget, showExplainWidget]);

  const dispose = useCallback(() => {
    removeWidget();
    const state = stateRef.current;
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  }, [removeWidget]);

  return { dispose };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
