import { useRef, useEffect, useCallback } from 'react';
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import { sanitizeHtml } from '../utils/sanitize';
import { getTranslation } from '../i18n';

interface MarkdownContentProps {
  content: string;
  /** 是否为用户消息（用户消息启用换行支持） */
  isUserMessage?: boolean;
  /** 代码引用点击回调（filePath, line） */
  onCodeRefClick?: (filePath: string, line: number) => void;
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

/** 可内联渲染的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp']);

/** 可内联播放的视频扩展名 */
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm']);

/** 可内联播放的音频扩展名 */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aac']);

/**
 * 代码引用正则：匹配 `FileName.ext:lineNumber` 或 `FileName.ext:startLine-endLine`
 * 支持路径格式：`src/com/Foo.java:107` 或 `OrderService.java:153-185`
 */
const CODE_REF_REGEX = /^(.+\.\w+):(\d+)(?:-(\d+))?$/;

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
 * 检查字符串是否为代码引用格式（filename.ext:line 或 filename.ext:start-end）
 */
function isCodeReference(text: string): { match: boolean; filePath: string; line: number } {
  const trimmed = text.trim();
  const m = CODE_REF_REGEX.exec(trimmed);
  if (!m) return { match: false, filePath: '', line: 0 };
  return { match: true, filePath: m[1], line: parseInt(m[2], 10) };
}

/**
 * 生成文件链接 HTML（下载按钮 + 可选预览按钮 + 内联媒体）
 */
function renderFileLink(filePath: string, ext: string): string {
  const encodedPath = encodeURIComponent(filePath);
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const escapedFileName = fileName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escapedPath = filePath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const canPreview = PREVIEWABLE_EXTENSIONS.has(ext);
  const inlineSrc = `/api/files/download?path=${encodedPath}&inline=1`;

  const downloadBtn = `<a class="file-download-btn" href="/api/files/download?path=${encodedPath}" download="${encodeURIComponent(fileName)}" title="${getTranslation('markdown.download')} ${escapedFileName}">↓</a>`;
  const previewBtn = canPreview
    ? `<a class="file-preview-btn" href="${inlineSrc}" target="_blank" title="${getTranslation('markdown.preview')} ${escapedFileName}">⧉</a>`
    : '';

  const linkBar = `<span class="file-link-wrapper"><code class="file-path">${escapedPath}</code>${downloadBtn}${previewBtn}</span>`;

  // 内联渲染媒体
  if (IMAGE_EXTENSIONS.has(ext)) {
    return `<div class="media-inline media-inline--image">${linkBar}<img src="${inlineSrc}" alt="${escapedFileName}" loading="lazy" class="media-inline__img" /></div>`;
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return `<div class="media-inline media-inline--video">${linkBar}<video controls preload="metadata" class="media-inline__video"><source src="${inlineSrc}" type="video/${ext.slice(1)}" /></video></div>`;
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    const audioType = ext === '.mp3' ? 'mpeg' : ext === '.flac' ? 'flac' : ext === '.aac' ? 'aac' : ext.slice(1);
    return `<div class="media-inline media-inline--audio">${linkBar}<audio controls preload="metadata" class="media-inline__audio"><source src="${inlineSrc}" type="audio/${audioType}" /></audio></div>`;
  }

  return linkBar;
}

/**
 * 生成代码引用链接 HTML
 */
function renderCodeRefLink(text: string, filePath: string, line: number): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedFilePath = filePath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<code class="code-ref-link" data-code-ref="true" data-file-path="${escapedFilePath}" data-line="${line}" title="${getTranslation('markdown.openInEditor')} ${escapedFilePath}:${line}">${escaped}</code>`;
}

/**
 * 创建自定义 marked renderer，在 inline code 中检测文件路径和代码引用
 */
function createFileAwareRenderer(): Renderer {
  const renderer = new Renderer();

  // 覆盖 codespan（行内代码 `...`）的渲染
  // marked v12 签名: codespan(text: string)，直接传字符串
  renderer.codespan = function (text: string) {
    if (!text) return `<code></code>`;

    // 优先检测代码引用格式 (filename.ext:line)
    const codeRef = isCodeReference(text);
    if (codeRef.match) {
      return renderCodeRefLink(text, codeRef.filePath, codeRef.line);
    }

    // 其次检测可下载文件路径
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

export function MarkdownContent({ content, isUserMessage = false, onCodeRefClick }: MarkdownContentProps) {
  const ref = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCodeRefClick);
  callbackRef.current = onCodeRefClick;

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

  // 事件委托：监听代码引用点击 + 内联图片点击放大
  const handleClick = useCallback((e: React.MouseEvent) => {
    // 内联图片点击 → 新标签打开原图
    const imgTarget = (e.target as HTMLElement).closest('.media-inline__img') as HTMLImageElement | null;
    if (imgTarget?.src) {
      window.open(imgTarget.src, '_blank');
      return;
    }

    const target = (e.target as HTMLElement).closest('.code-ref-link') as HTMLElement | null;
    if (!target) return;

    const filePath = target.getAttribute('data-file-path');
    const line = target.getAttribute('data-line');
    if (filePath && line && callbackRef.current) {
      e.preventDefault();
      e.stopPropagation();
      callbackRef.current(filePath, parseInt(line, 10));
    }
  }, []);

  return <div ref={ref} className="message-content" onClick={handleClick} />;
}
