/**
 * useCodeConversation Hook
 * 实现多轮代码对话功能：在编辑器右侧打开对话面板，AI 能看到当前代码和光标位置
 */

import { useState, useCallback, useRef } from 'react';
import type * as MonacoEditor from 'monaco-editor';
import { aiConversationApi, type ConversationMessage } from '../api/ai-editor';

// ============================================================================
// 类型定义
// ============================================================================

export interface UseCodeConversationOptions {
  filePath: string | null;
  content: string;
  language: string;
  editorRef: React.RefObject<MonacoEditor.editor.IStandaloneCodeEditor | null>;
}

export interface UseCodeConversationReturn {
  state: {
    visible: boolean;
    loading: boolean;
    messages: ConversationMessage[];
    input: string;
  };
  open: () => void;
  close: () => void;
  setInput: (input: string) => void;
  send: () => Promise<void>;
  clear: () => void;
}

// ============================================================================
// Hook 实现
// ============================================================================

export function useCodeConversation(options: UseCodeConversationOptions): UseCodeConversationReturn {
  const { filePath, content, language, editorRef } = options;

  // 状态
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');

  // 用 ref 存储可变值
  const filePathRef = useRef(filePath);
  const contentRef = useRef(content);
  const languageRef = useRef(language);

  // 更新 ref
  filePathRef.current = filePath;
  contentRef.current = content;
  languageRef.current = language;

  /**
   * 打开对话面板
   */
  const open = useCallback(() => {
    setVisible(true);
  }, []);

  /**
   * 关闭对话面板
   */
  const close = useCallback(() => {
    setVisible(false);
  }, []);

  /**
   * 清空对话历史
   */
  const clear = useCallback(() => {
    setMessages([]);
    setInput('');
  }, []);

  /**
   * 发送消息
   */
  const send = useCallback(async () => {
    const currentFilePath = filePathRef.current;
    const currentContent = contentRef.current;
    const currentLanguage = languageRef.current;

    if (!currentFilePath || !input.trim()) return;

    const editor = editorRef.current;
    let codeContext = currentContent;
    let cursorLine: number | undefined;

    // 如果编辑器存在，尝试获取选中代码和光标位置
    if (editor) {
      const selection = editor.getSelection();
      const model = editor.getModel();

      if (selection && model) {
        // 获取光标行号
        cursorLine = selection.startLineNumber;

        // 如果有选中代码，使用选中内容作为 codeContext
        const selectedText = model.getValueInRange(selection);
        if (selectedText && selectedText.trim()) {
          codeContext = selectedText;
        }
      }
    }

    const question = input.trim();

    // 添加用户消息到历史
    const newMessages: ConversationMessage[] = [
      ...messages,
      { role: 'user', content: question },
    ];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await aiConversationApi.chat({
        filePath: currentFilePath,
        language: currentLanguage,
        codeContext,
        cursorLine,
        messages,
        question,
      });

      if (response.success && response.answer) {
        // 添加 AI 回复到历史
        setMessages([
          ...newMessages,
          { role: 'assistant', content: response.answer },
        ]);
      } else {
        alert(`对话失败: ${response.error || '未知错误'}`);
        // 回退用户消息
        setMessages(messages);
        setInput(question);
      }
    } catch (error: any) {
      console.error('[useCodeConversation] Failed to send:', error);
      alert(`对话异常: ${error.message || '未知错误'}`);
      // 回退用户消息
      setMessages(messages);
      setInput(question);
    } finally {
      setLoading(false);
    }
  }, [input, messages, editorRef]);

  return {
    state: {
      visible,
      loading,
      messages,
      input,
    },
    open,
    close,
    setInput,
    send,
    clear,
  };
}
