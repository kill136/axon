import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content (for Markdown rendering, rich text)
 * Strips dangerous tags/attributes while preserving safe formatting
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['img', 'video', 'audio', 'source'],
    ADD_ATTR: ['download', 'target', 'data-code-ref', 'data-file-path', 'data-line',
      'controls', 'autoplay', 'muted', 'loop', 'preload', 'poster',
      'src', 'alt', 'loading', 'type'],
  });
}

/**
 * Sanitize SVG content
 * Removes script tags and event handlers from SVG
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
  });
}
