import { useRef, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { sanitizeHtml } from '../utils/sanitize';

interface MarkdownContentProps {
  content: string;
  /** 是否为用户消息（用户消息启用换行支持） */
  isUserMessage?: boolean;
}

export function MarkdownContent({ content, isUserMessage = false }: MarkdownContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && content) {
      // 用户消息：启用 breaks，支持单换行符
      // 助手消息：标准 Markdown，不破坏格式
      const html = marked.parse(content, {
        breaks: isUserMessage,
        gfm: true,
      }) as string;

      ref.current.innerHTML = sanitizeHtml(html);
      ref.current.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });
    }
  }, [content, isUserMessage]);

  return <div ref={ref} className="message-content" />;
}
