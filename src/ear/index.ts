/**
 * Ear Buffer — Claude's auditory memory.
 *
 * A ring buffer that stores recent speech transcriptions pushed from the
 * browser's Web Speech API via WebSocket. The AI calls the Ear tool to
 * "recall" what it heard recently.
 *
 * Design: the ear is always open. The browser continuously transcribes
 * ambient speech, pushes fragments to the server, and the server keeps
 * the last N seconds in memory. No disk writes.
 */

export interface TranscriptEntry {
  /** The transcribed text */
  text: string;
  /** When it was received (epoch ms) */
  timestamp: number;
  /** Whether this is a final result or interim */
  isFinal: boolean;
  /** Language detected */
  lang?: string;
}

const DEFAULT_MAX_AGE_MS = 60_000;    // Keep last 60 seconds
const DEFAULT_MAX_ENTRIES = 200;       // Max entries in buffer

/**
 * Ring buffer for speech transcriptions.
 * One instance per active session (keyed by sessionId).
 */
class EarBuffer {
  private entries: TranscriptEntry[] = [];
  private maxAgeMs: number;
  private maxEntries: number;

  constructor(maxAgeMs = DEFAULT_MAX_AGE_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxAgeMs = maxAgeMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Push a new transcription entry.
   */
  push(text: string, isFinal: boolean, lang?: string): void {
    const now = Date.now();
    this.entries.push({ text, timestamp: now, isFinal, lang });

    // Prune old entries
    this.prune(now);
  }

  /**
   * Get recent transcriptions within the last N milliseconds.
   * Default: all entries in buffer (up to maxAge).
   */
  getRecent(withinMs?: number): TranscriptEntry[] {
    const now = Date.now();
    const cutoff = now - (withinMs ?? this.maxAgeMs);
    return this.entries.filter(e => e.timestamp >= cutoff);
  }

  /**
   * Get recent transcriptions as a single text string.
   * Only final results are included for clean output.
   */
  getRecentText(withinMs?: number): string {
    return this.getRecent(withinMs)
      .filter(e => e.isFinal)
      .map(e => e.text)
      .join(' ')
      .trim();
  }

  /**
   * Get recent transcriptions with timestamps, formatted for AI consumption.
   */
  getRecentFormatted(withinMs?: number): string {
    const entries = this.getRecent(withinMs).filter(e => e.isFinal);
    if (entries.length === 0) return '(silence — nothing heard recently)';

    const now = Date.now();
    return entries.map(e => {
      const agoSec = Math.round((now - e.timestamp) / 1000);
      return `[${agoSec}s ago] ${e.text}`;
    }).join('\n');
  }

  /**
   * Check if any speech was detected recently.
   */
  hasSpeech(withinMs = 10_000): boolean {
    const cutoff = Date.now() - withinMs;
    return this.entries.some(e => e.isFinal && e.timestamp >= cutoff);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }

  get size(): number {
    return this.entries.length;
  }

  private prune(now: number): void {
    const cutoff = now - this.maxAgeMs;
    // Remove expired entries from the front
    while (this.entries.length > 0 && this.entries[0].timestamp < cutoff) {
      this.entries.shift();
    }
    // Enforce max entries
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }
}

// ── Global registry (one buffer per session) ───────────────────────────────

const buffers = new Map<string, EarBuffer>();

/**
 * Get or create the ear buffer for a session.
 */
export function getEarBuffer(sessionId: string): EarBuffer {
  let buf = buffers.get(sessionId);
  if (!buf) {
    buf = new EarBuffer();
    buffers.set(sessionId, buf);
  }
  return buf;
}

/**
 * Push a transcript to a session's ear buffer.
 * Called from the WebSocket handler when receiving 'ear:transcript' messages.
 */
export function pushTranscript(sessionId: string, text: string, isFinal: boolean, lang?: string): void {
  getEarBuffer(sessionId).push(text, isFinal, lang);
}

/**
 * Remove a session's ear buffer (on disconnect).
 */
export function removeEarBuffer(sessionId: string): void {
  buffers.delete(sessionId);
}
