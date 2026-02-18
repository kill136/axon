import DOMPurify from 'dompurify';

/**
 * Sanitize HTML content (for Markdown rendering, rich text)
 * Strips dangerous tags/attributes while preserving safe formatting
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
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
