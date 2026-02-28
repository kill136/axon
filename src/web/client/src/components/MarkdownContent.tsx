import { useRef, useEffect } from 'react';
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import { sanitizeHtml } from '../utils/sanitize';

interface MarkdownContentProps {
  content: string;
  /** 是否为用户消息（用户消息启用换行支持） */
  isUserMessage?: boolean;
}

/**
 * 可下载/可预览的文件扩展名集合
 */
const DOWNLOADABLE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.webm', '.avi', '.mov', '.mkv',
  '.mp3', '.wav', '.ogg', '.flac', '.aac',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.html', '.htm', '.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.log',
]);

/** 可在浏览器中直接预览的扩展名 */
const PREVIEWABLE_EXTENSIONS = new Set([
  '.pdf',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp',
  '.mp4', '.webm',
  '.mp3', '.wav', '.ogg',
  '.html', '.htm', '.txt', '.md', '.json', '.xml', '.csv', '.log',
]);

/**
 * 检查字符串是否为文件路径（绝对路径，且扩展名在白名单中）
 */
function isDownloadableFilePath(text: string): { match: boolean; ext: string } {
  const trimmed = text.trim();
  // Unix 绝对路径 或 Windows 绝对路径
  const isAbsolutePath = /^(?:[A-Za-z]:[\\/]|\/)/.test(trimmed);
  if (!isAbsolutePath) return { match: false, ext: '' };

  // 提取扩展名
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === trimmed.length - 1) return { match: false, ext: '' };
  const ext = trimmed.substring(dotIdx).toLowerCase();

  // 排除过短的路径（至少有目录 + 文件名）
  if (trimmed.length < 5) return { match: false, ext: '' };

  return { match: DOWNLOADABLE_EXTENSIONS.has(ext), ext };
}

/**
 * 生成文件链接 HTML（下载按钮 + 可选预览按钮）
 */
function renderFileLink(filePath: string, ext: string): string {
  const encodedPath = encodeURIComponent(filePath);
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const escapedFileName = fileName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escapedPath = filePath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const canPreview = PREVIEWABLE_EXTENSIONS.has(ext);

  const downloadBtn = `<a class="file-download-btn" href="/api/files/download?path=${encodedPath}" download="${encodeURIComponent(fileName)}" title="下载 ${escapedFileName}">↓</a>`;
  const previewBtn = canPreview
    ? `<a class="file-preview-btn" href="/api/files/download?path=${encodedPath}&inline=1" target="_blank" title="预览 ${escapedFileName}">⧉</a>`
    : '';

  return `<span class="file-link-wrapper"><code class="file-path">${escapedPath}</code>${downloadBtn}${previewBtn}</span>`;
}

/**
 * 创建自定义 marked renderer，在 inline code 中检测文件路径
 */
function createFileAwareRenderer(): Renderer {
  const renderer = new Renderer();

  // 覆盖 codespan（行内代码 `...`）的渲染
  // marked v12 签名: codespan(text: string)，直接传字符串
  renderer.codespan = function (text: string) {
    if (!text) return `<code></code>`;
    const { match, ext } = isDownloadableFilePath(text);
    if (match) {
      return renderFileLink(text, ext);
    }
    // 默认行为：返回 <code>
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code>${escaped}</code>`;
  };

  return renderer;
}

/** 用于助手消息的 renderer（检测文件路径） */
const fileAwareRenderer = createFileAwareRenderer();

export function MarkdownContent({ content, isUserMessage = false }: MarkdownContentProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && content) {
      const html = marked.parse(content, {
        breaks: isUserMessage,
        gfm: true,
        // 只对助手消息启用文件路径检测 renderer
        ...(isUserMessage ? {} : { renderer: fileAwareRenderer }),
      }) as string;

      ref.current.innerHTML = sanitizeHtml(html);
      ref.current.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });
    }
  }, [content, isUserMessage]);

  return <div ref={ref} className="message-content" />;
}
