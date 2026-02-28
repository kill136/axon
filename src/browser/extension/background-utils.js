/**
 * Background utilities for Axon Browser Bridge
 * Adapted from OpenClaw (MIT License)
 */

/**
 * Calculate reconnection delay with exponential backoff
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} opts - Options
 * @param {number} opts.baseMs - Base delay in milliseconds (default: 1000)
 * @param {number} opts.maxMs - Maximum delay in milliseconds (default: 30000)
 * @param {number} opts.factor - Exponential factor (default: 2)
 * @returns {number} Delay in milliseconds
 */
export function reconnectDelayMs(attempt, opts = {}) {
  const { baseMs = 1000, maxMs = 30000, factor = 2 } = opts;
  const delay = baseMs * Math.pow(factor, attempt);
  return Math.min(delay, maxMs);
}

/**
 * Build relay WebSocket URL
 * @param {number} port - Relay server port
 * @param {string} gatewayToken - Authentication token
 * @returns {string} WebSocket URL
 */
export function buildRelayWsUrl(port, gatewayToken) {
  const host = '127.0.0.1';
  const encodedToken = encodeURIComponent(gatewayToken);
  return `ws://${host}:${port}/extension?token=${encodedToken}`;
}

/**
 * Check if error is retryable for reconnection
 * @param {Error|string} err - Error object or message
 * @returns {boolean} True if error is retryable
 */
export function isRetryableReconnectError(err) {
  const errMsg = typeof err === 'string' ? err : (err?.message || '');
  const retryablePatterns = [
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /EHOSTUNREACH/i,
    /socket hang up/i,
    /network error/i,
    /Failed to fetch/i,
    /ERR_CONNECTION_REFUSED/i,
    /ERR_CONNECTION_RESET/i,
    /AbortError/i,
  ];
  return retryablePatterns.some(pattern => pattern.test(errMsg));
}
