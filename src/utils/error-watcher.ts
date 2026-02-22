/**
 * ErrorWatcher: 错误自感知与自修复系统
 *
 * 作为 Logger 的 hook，实时接收 error 级别日志，执行：
 *   1. 指纹提取 — 将错误消息模板化 + 源码位置 → 唯一指纹
 *   2. 分类 — 源码错误 vs 外部错误（网络/API/第三方）
 *   3. 滑动窗口聚合 — 5 分钟内同类错误合并计数
 *   4. 阈值检测 — 源码错误 ≥3 次 → 触发自修复 Pipeline
 *
 * 所有模式默认启用，零门槛感知错误。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { LogEntry } from './logger.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface ErrorPattern {
  fingerprint: string;
  description: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  sample: LogEntry;
  category: 'source' | 'external' | 'unknown';
  sourceLocation?: string;
  repairTriggered: boolean;
}

interface RepairRecord {
  timestamp: number;
  fingerprint: string;
  action: string;
  reason: string;
  success: boolean;
  sessionId?: string;
}

/**
 * 修复会话创建器回调类型
 * 由 web/server/index.ts 注入，避免 utils → web/server 的循环依赖
 *
 * @param pattern - 触发修复的错误模式
 * @param sourceContext - 源码上下文
 * @returns sessionId 或 null（创建失败）
 */
export type RepairSessionCreator = (
  pattern: ErrorPattern,
  sourceContext: string,
) => Promise<string | null>;

// ============================================================================
// 常量
// ============================================================================

const EXTERNAL_ERROR_PATTERNS = [
  /terminated/i, /ECONNRESET/i, /ECONNREFUSED/i, /ETIMEDOUT/i,
  /ENOTFOUND/i, /socket hang up/i, /aborted/i, /429/, /529/,
  /rate_limit/i, /overloaded/i, /network/i, /EPIPE/i,
  /EHOSTUNREACH/i, /fetch failed/i, /getaddrinfo/i,
  /certificate/i, /SSL/i, /TLS/i, /CERT_/i, /readyState/i,
];

const VARIABLE_PATTERNS: Array<[RegExp, string]> = [
  [/(?:\/[\w.-]+)+(?:\.\w+)?/g, '<path>'],
  [/(?:[A-Z]:\\[\w\\.-]+)+/g, '<path>'],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
  [/\b\d{2,}\b/g, '<N>'],
  [/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '<ip>'],
  [/\b[0-9a-f]{8,}\b/gi, '<hex>'],
];

const SOURCE_LOCATION_PATTERN = /[\\/]src[\\/](.+?):(\d+)/;

// ============================================================================
// ErrorWatcher
// ============================================================================

class ErrorWatcher {
  private readonly WINDOW_MS = 5 * 60 * 1000;
  private readonly REPAIR_THRESHOLD = 3;
  private readonly COOLDOWN_MS = 10 * 60 * 1000;
  private readonly MAX_REPAIRS_PER_HOUR = 3;
  private readonly CLEANUP_INTERVAL_MS = 60 * 1000;

  private patterns = new Map<string, ErrorPattern>();
  private lastRepairTime = 0;
  private repairHistory: RepairRecord[] = [];
  private enabled = false;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private repairSessionCreator: RepairSessionCreator | null = null;

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), this.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    this.log('info', 'ErrorWatcher enabled');
  }

  /**
   * 注入修复会话创建器
   * 由 web/server/index.ts 在初始化时调用，将"创建修复会话"的能力注入 ErrorWatcher
   */
  setRepairSessionCreator(creator: RepairSessionCreator): void {
    this.repairSessionCreator = creator;
    this.log('info', 'Repair session creator injected — auto-repair enabled');
  }

  disable(): void {
    this.enabled = false;
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.patterns.clear();
  }

  onError(entry: LogEntry): void {
    if (!this.enabled) return;

    const now = Date.now();
    const fingerprint = this.generateFingerprint(entry);
    const category = this.classifyError(entry);

    const existing = this.patterns.get(fingerprint);
    if (existing) {
      existing.lastSeen = now;
      existing.count++;
      existing.sample = entry;
    } else {
      const sourceLocation = this.extractSourceLocation(entry);
      this.patterns.set(fingerprint, {
        fingerprint,
        description: this.buildDescription(entry, sourceLocation),
        firstSeen: now,
        lastSeen: now,
        count: 1,
        sample: entry,
        category,
        sourceLocation: sourceLocation || undefined,
        repairTriggered: false,
      });
    }

    const pattern = this.patterns.get(fingerprint)!;

    if (this.shouldTriggerRepair(pattern)) {
      this.log('warn', `Source error repeated ${pattern.count}x, triggering repair: ${pattern.description}`);
      pattern.repairTriggered = true;
      this.triggerRepair(pattern).catch(err => {
        this.log('error', `Repair pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  getPatterns(): ErrorPattern[] {
    return Array.from(this.patterns.values());
  }

  getSourceErrors(): ErrorPattern[] {
    return this.getPatterns().filter(p => p.category === 'source');
  }

  getStats(): {
    enabled: boolean;
    totalPatterns: number;
    sourceErrors: number;
    externalErrors: number;
    repairsTriggered: number;
    lastRepairTime: number;
  } {
    const patterns = this.getPatterns();
    return {
      enabled: this.enabled,
      totalPatterns: patterns.length,
      sourceErrors: patterns.filter(p => p.category === 'source').length,
      externalErrors: patterns.filter(p => p.category === 'external').length,
      repairsTriggered: this.repairHistory.length,
      lastRepairTime: this.lastRepairTime,
    };
  }

  private generateFingerprint(entry: LogEntry): string {
    const normalizedMsg = this.normalizeMessage(entry.msg);
    const sourceLocation = this.extractSourceLocation(entry) || 'unknown';
    const raw = `${entry.module}::${normalizedMsg}::${sourceLocation}`;
    return crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
  }

  private normalizeMessage(msg: string): string {
    let normalized = msg;
    for (const [pattern, replacement] of VARIABLE_PATTERNS) {
      normalized = normalized.replace(pattern, replacement);
    }
    return normalized.slice(0, 200);
  }

  private extractSourceLocation(entry: LogEntry): string | null {
    const stack = entry.stack || entry.msg;
    const match = stack.match(SOURCE_LOCATION_PATTERN);
    if (match) {
      return match[1].replace(/\\/g, '/') + ':' + match[2];
    }
    return null;
  }

  private buildDescription(entry: LogEntry, sourceLocation: string | null): string {
    const msgPreview = entry.msg.slice(0, 80) + (entry.msg.length > 80 ? '...' : '');
    if (sourceLocation) {
      return `[${entry.module}] ${msgPreview} @ ${sourceLocation}`;
    }
    return `[${entry.module}] ${msgPreview}`;
  }

  private classifyError(entry: LogEntry): 'source' | 'external' | 'unknown' {
    const msg = entry.msg;
    const stack = entry.stack || '';

    for (const pattern of EXTERNAL_ERROR_PATTERNS) {
      if (pattern.test(msg)) return 'external';
    }

    if (SOURCE_LOCATION_PATTERN.test(stack)) return 'source';

    if (stack && !stack.includes('/src/') && !stack.includes('\\src\\')) {
      if (stack.includes('node_modules') || stack.includes('node:internal')) {
        return 'external';
      }
    }

    return 'unknown';
  }

  private shouldTriggerRepair(pattern: ErrorPattern): boolean {
    if (pattern.category !== 'source') return false;
    if (pattern.repairTriggered) return false;
    if (pattern.count < this.REPAIR_THRESHOLD) return false;
    if (Date.now() - this.lastRepairTime < this.COOLDOWN_MS) return false;

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentRepairs = this.repairHistory.filter(r => r.timestamp > oneHourAgo).length;
    if (recentRepairs >= this.MAX_REPAIRS_PER_HOUR) return false;

    return true;
  }

  private async triggerRepair(pattern: ErrorPattern): Promise<void> {
    const now = Date.now();
    this.lastRepairTime = now;

    this.log('info', '=== Repair Pipeline START ===');
    this.log('info', `Fingerprint: ${pattern.fingerprint}`);
    this.log('info', `Description: ${pattern.description}`);
    this.log('info', `Count: ${pattern.count}`);
    this.log('info', `Location: ${pattern.sourceLocation || 'unknown'}`);

    const sourceContext = await this.readSourceContext(pattern);

    // Phase 2: 自动创建修复会话
    let sessionId: string | null = null;
    let action = 'notify';

    if (this.repairSessionCreator) {
      try {
        this.log('info', 'Creating auto-repair session...');
        sessionId = await this.repairSessionCreator(pattern, sourceContext);
        if (sessionId) {
          action = 'repair_session';
          this.log('info', `Repair session created: ${sessionId}`);
        } else {
          this.log('warn', 'Repair session creator returned null — falling back to notify');
        }
      } catch (err) {
        this.log('error', `Failed to create repair session: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      this.log('info', 'No repair session creator injected — notify only');
    }

    const record: RepairRecord = {
      timestamp: now,
      fingerprint: pattern.fingerprint,
      action,
      reason: `Source error repeated ${pattern.count}x: ${pattern.description}`,
      success: !!sessionId,
      sessionId: sessionId || undefined,
    };
    this.repairHistory.push(record);

    this.appendRepairLog(record, pattern, sourceContext);
    await this.writeToNotebook(pattern, sourceContext);

    this.log('info', `=== Repair Pipeline END (${action}) ===`);
  }

  private async readSourceContext(pattern: ErrorPattern): Promise<string> {
    if (!pattern.sourceLocation) return '(no source location)';

    try {
      const lastColon = pattern.sourceLocation.lastIndexOf(':');
      if (lastColon < 0) return '(invalid source location)';
      const relPath = pattern.sourceLocation.slice(0, lastColon);
      const line = parseInt(pattern.sourceLocation.slice(lastColon + 1), 10);
      if (isNaN(line)) return '(cannot parse line number)';

      const projectRoot = this.findProjectRoot();
      if (!projectRoot) return '(cannot locate project root)';

      const fullPath = path.join(projectRoot, 'src', relPath);
      if (!fs.existsSync(fullPath)) return `(file not found: src/${relPath})`;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(0, line - 11);
      const endLine = Math.min(lines.length, line + 10);

      const contextLines = lines.slice(startLine, endLine).map((l, i) => {
        const lineNum = startLine + i + 1;
        const marker = lineNum === line ? ' >>>' : '    ';
        return `${marker} ${lineNum}: ${l}`;
      });

      return `File: src/${relPath}\n\n${contextLines.join('\n')}`;
    } catch {
      return '(failed to read source)';
    }
  }

  private appendRepairLog(record: RepairRecord, pattern: ErrorPattern, sourceContext: string): void {
    try {
      const logDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      const logPath = path.join(logDir, 'error-watcher.jsonl');
      const entry = {
        ...record,
        pattern: {
          fingerprint: pattern.fingerprint,
          description: pattern.description,
          count: pattern.count,
          category: pattern.category,
          sourceLocation: pattern.sourceLocation,
          sampleMsg: pattern.sample.msg,
          sampleStack: pattern.sample.stack?.slice(0, 500),
        },
        sourceContext: sourceContext.slice(0, 1000),
      };
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // must not affect main flow
    }
  }

  private async writeToNotebook(pattern: ErrorPattern, _sourceContext: string): Promise<void> {
    try {
      const projectRoot = this.findProjectRoot();
      if (!projectRoot) return;

      const claudeDir = path.join(os.homedir(), '.claude');
      const sanitized = projectRoot.replace(/[<>:"|?*]/g, '-').replace(/[\\/]+/g, '-').toLowerCase();
      const projectDir = path.join(claudeDir, 'memory', 'projects', sanitized);

      if (!fs.existsSync(projectDir)) return;

      const notebookPath = path.join(projectDir, 'project.md');
      if (!fs.existsSync(notebookPath)) return;

      const content = fs.readFileSync(notebookPath, 'utf-8');

      const sectionHeader = '## ErrorWatcher 自动检测';
      if (content.includes(pattern.fingerprint)) return;

      const date = new Date().toISOString().slice(0, 10);
      const newEntry = [
        '',
        `### [${date}] ${pattern.description}`,
        `- 指纹: \`${pattern.fingerprint}\``,
        `- 分类: ${pattern.category}`,
        `- 重复次数: ${pattern.count}`,
        `- 位置: \`${pattern.sourceLocation || 'unknown'}\``,
        `- 错误: \`${pattern.sample.msg.slice(0, 100)}\``,
        '',
      ].join('\n');

      if (content.includes(sectionHeader)) {
        const newContent = content.replace(sectionHeader, sectionHeader + '\n' + newEntry);
        fs.writeFileSync(notebookPath, newContent, 'utf-8');
      } else {
        fs.appendFileSync(notebookPath, '\n' + sectionHeader + '\n' + newEntry, 'utf-8');
      }

      this.log('info', `Written to project notebook: ${pattern.fingerprint}`);
    } catch {
      // must not affect main flow
    }
  }

  private cleanupExpired(): void {
    const cutoff = Date.now() - this.WINDOW_MS;
    for (const [key, pattern] of this.patterns) {
      if (pattern.lastSeen < cutoff) {
        this.patterns.delete(key);
      }
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.repairHistory = this.repairHistory.filter(r => r.timestamp > oneHourAgo);
  }

  private findProjectRoot(): string | null {
    let dir = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === 'win32' && dir.startsWith('/')) {
      dir = dir.slice(1);
    }

    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.name === 'claude-code-open') return dir;
        } catch { /* continue */ }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string): void {
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[ErrorWatcher] ${msg}`);
  }
}

export const errorWatcher = new ErrorWatcher();
