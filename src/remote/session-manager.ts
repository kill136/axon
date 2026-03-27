/**
 * Remote Session Manager with Tool Use History Management
 *
 * Fixes v2.1.67 bug: Tool use ID arrays grow unbounded
 *
 * Key improvements:
 * - Use Set instead of Array for O(1) lookup
 * - Implement max size limit (1000)
 * - Regular cleanup of expired IDs
 * - Prevent unbounded memory growth in long sessions
 */

/**
 * Tool use history entry
 */
interface ToolUseEntry {
  id: string;
  timestamp: number;
}

/**
 * Remote session configuration
 */
export interface RemoteSessionConfig {
  maxToolUseHistory?: number;
  cleanupInterval?: number;
  idleTimeout?: number;
}

/**
 * Remote Session Manager
 *
 * Manages tool use history with bounded memory usage
 */
export class RemoteSession {
  private sessionId: string;
  private toolUseIds: Set<string>;
  private toolUseHistory: ToolUseEntry[];
  private maxToolUseHistory: number;
  private cleanupInterval: number;
  private idleTimeout: number;
  private lastActivityTime: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(sessionId: string, config: RemoteSessionConfig = {}) {
    this.sessionId = sessionId;
    this.toolUseIds = new Set();
    this.toolUseHistory = [];
    this.maxToolUseHistory = config.maxToolUseHistory ?? 1000;
    this.cleanupInterval = config.cleanupInterval ?? 60000; // 60 seconds
    this.idleTimeout = config.idleTimeout ?? 3600000; // 1 hour
    this.lastActivityTime = Date.now();

    // Start periodic cleanup
    this.startCleanupTimer();
  }

  /**
   * Starts the cleanup timer for periodic maintenance
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    // Allow the timer to not block process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Adds a tool use ID to the session history
   * v2.1.67 fix: Use Set to prevent duplicates and enable size limiting
   *
   * @param toolId The tool use ID to add
   */
  async addToolUse(toolId: string): Promise<void> {
    this.lastActivityTime = Date.now();

    // Add to Set for O(1) lookup
    if (!this.toolUseIds.has(toolId)) {
      this.toolUseIds.add(toolId);

      // Also maintain history for time-based cleanup
      this.toolUseHistory.push({
        id: toolId,
        timestamp: Date.now(),
      });

      // Check if we need to trim
      if (this.toolUseIds.size > this.maxToolUseHistory) {
        this.trimOldestIds();
      }
    }
  }

  /**
   * Trims the oldest tool IDs when limit is exceeded
   * v2.1.67 fix: Keeps Set size bounded
   */
  private trimOldestIds(): void {
    const keepCount = Math.max(this.maxToolUseHistory - 100, 500);

    // Sort by timestamp and keep the newest ones
    this.toolUseHistory.sort((a, b) => b.timestamp - a.timestamp);
    this.toolUseHistory = this.toolUseHistory.slice(0, keepCount);

    // Rebuild Set from trimmed history
    this.toolUseIds.clear();
    for (const entry of this.toolUseHistory) {
      this.toolUseIds.add(entry.id);
    }
  }

  /**
   * Checks if a tool use ID exists in the session
   *
   * @param toolId The tool use ID to check
   * @returns true if the ID is known
   */
  hasToolUse(toolId: string): boolean {
    return this.toolUseIds.has(toolId);
  }

  /**
   * Gets all known tool use IDs
   *
   * @returns Array of tool use IDs
   */
  getToolUseIds(): string[] {
    return Array.from(this.toolUseIds);
  }

  /**
   * Gets the count of known tool uses
   *
   * @returns Number of tool uses in history
   */
  getToolUseCount(): number {
    return this.toolUseIds.size;
  }

  /**
   * Cleans up expired entries and old IDs
   * v2.1.67 fix: Regular maintenance to prevent unbounded growth
   */
  private cleanup(): void {
    // Remove entries older than idle timeout
    const now = Date.now();
    const threshold = now - this.idleTimeout;

    this.toolUseHistory = this.toolUseHistory.filter((entry) => entry.timestamp > threshold);

    // Rebuild Set to remove expired entries
    this.toolUseIds.clear();
    for (const entry of this.toolUseHistory) {
      this.toolUseIds.add(entry.id);
    }

    // Check if session is idle
    if (now - this.lastActivityTime > this.idleTimeout) {
      this.close();
    }
  }

  /**
   * Forcefully clears all tool use history
   */
  clear(): void {
    this.toolUseIds.clear();
    this.toolUseHistory = [];
  }

  /**
   * Gets session statistics
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      toolUseCount: this.toolUseIds.size,
      maxToolUseHistory: this.maxToolUseHistory,
      historySize: this.toolUseHistory.length,
      lastActivityTime: this.lastActivityTime,
      isIdle: Date.now() - this.lastActivityTime > this.idleTimeout,
    };
  }

  /**
   * Closes the session and stops cleanup timer
   */
  close(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

/**
 * Remote Session Registry
 *
 * Manages multiple remote sessions
 */
export class RemoteSessionRegistry {
  private sessions: Map<string, RemoteSession>;
  private config: RemoteSessionConfig;

  constructor(config: RemoteSessionConfig = {}) {
    this.sessions = new Map();
    this.config = config;
  }

  /**
   * Creates or gets a remote session
   *
   * @param sessionId The session ID
   * @returns The remote session
   */
  getOrCreateSession(sessionId: string): RemoteSession {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new RemoteSession(sessionId, this.config));
    }
    return this.sessions.get(sessionId)!;
  }

  /**
   * Gets an existing session
   *
   * @param sessionId The session ID
   * @returns The session or undefined
   */
  getSession(sessionId: string): RemoteSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Removes a session
   *
   * @param sessionId The session ID
   */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.close();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Gets all active sessions
   *
   * @returns Array of session IDs
   */
  getAllSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Gets statistics for all sessions
   */
  getAllStats() {
    return Array.from(this.sessions.values()).map((session) => session.getStats());
  }

  /**
   * Closes all sessions
   */
  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
  }

  /**
   * Gets the total number of managed sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}
