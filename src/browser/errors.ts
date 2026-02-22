/**
 * AI-friendly error transformation for Playwright errors
 * 
 * Transforms technical Playwright error messages into actionable guidance for AI agents.
 */

/**
 * Normalize timeout value to safe range (500ms - 120000ms)
 */
export function normalizeTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined) return 20000; // default 20s
  return Math.max(500, Math.min(120000, timeoutMs));
}

/**
 * Transform Playwright error into AI-friendly actionable message
 */
export function toAIFriendlyError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMsg = message.toLowerCase();

  // Strict mode violation - multiple elements matched
  if (lowerMsg.includes('strict mode violation')) {
    return new Error(
      'Multiple elements matched. The page structure has changed. Please take a new snapshot to get updated element references.'
    );
  }

  // Element not visible
  if (
    lowerMsg.includes('timeout') && 
    (lowerMsg.includes('waiting for') || lowerMsg.includes('to be visible'))
  ) {
    return new Error(
      'Element is not visible on the page. It may be hidden, off-screen, or not yet loaded. Please take a new snapshot to verify the page state.'
    );
  }

  // Element intercepted by another element
  if (
    lowerMsg.includes('intercepts pointer events') ||
    lowerMsg.includes('not receive pointer events')
  ) {
    return new Error(
      'Element is blocked by another element (e.g., modal, overlay, or popup). Try scrolling the element into view, closing popups, or waiting for the page to finish loading.'
    );
  }

  // Timeout errors (generic)
  if (lowerMsg.includes('timeout')) {
    return new Error(
      'Operation timed out. The page may be slow to respond or the element may not exist. Try taking a new snapshot to verify the current page state.'
    );
  }

  // Navigation errors
  if (lowerMsg.includes('navigation')) {
    return new Error(
      'Navigation failed. The URL may be unreachable or the page failed to load. Please verify the URL and try again.'
    );
  }

  // Return original error if no pattern matches
  return error instanceof Error ? error : new Error(String(error));
}
