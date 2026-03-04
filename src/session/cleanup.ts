/**
 * 消息历史清理
 *
 * 基于官方源码 cli.js yfA() 和 _W7() 函数实现
 *
 * 功能：
 * 1. 自动清理 30 天前的 session 文件
 * 2. 清理摘要缓存
 * 3. 清理空目录
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 配置常量
const CLEANUP_PERIOD_DAYS = 30;
const SESSIONS_BASE_DIR = process.env.AXON_SESSION_DIR || path.join(os.homedir(), '.axon', 'sessions');
const SUMMARIES_DIR = path.join(SESSIONS_BASE_DIR, 'summaries');

/**
 * 清理统计信息
 */
export interface CleanupStats {
  sessions: number;
  summaries: number;
  errors: number;
  directories: number;
}

/**
 * 获取清理截止日期
 *
 * @param periodDays 清理周期（天数），默认 30 天
 * @returns 截止日期
 */
export function getCutoffDate(periodDays: number = CLEANUP_PERIOD_DAYS): Date {
  const cleanupPeriod = periodDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - cleanupPeriod);
}

/**
 * 清理目录中的过期文件
 *
 * @param dir 目录路径
 * @param cutoffDate 截止日期
 * @param extension 文件扩展名
 * @param removeEmptyDir 是否删除空目录
 * @returns 清理统计信息
 */
function cleanDirectory(
  dir: string,
  cutoffDate: Date,
  extension: string,
  removeEmptyDir: boolean = false
): { cleaned: number; errors: number } {
  const stats = { cleaned: 0, errors: 0 };

  if (!fs.existsSync(dir)) {
    return stats;
  }

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);

      try {
        const stat = fs.statSync(filePath);

        if (stat.isFile() && file.endsWith(extension)) {
          // 检查文件修改时间
          if (stat.mtime < cutoffDate) {
            fs.unlinkSync(filePath);
            stats.cleaned++;
          }
        }
      } catch (error) {
        console.warn(`Failed to clean file ${filePath}:`, error);
        stats.errors++;
      }
    }

    // 如果目录为空且需要删除，则删除目录
    if (removeEmptyDir) {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) {
        fs.rmdirSync(dir);
      }
    }
  } catch (error) {
    console.warn(`Failed to clean directory ${dir}:`, error);
    stats.errors++;
  }

  return stats;
}

/**
 * 清理 session 子目录
 *
 * @param sessionDir session 目录路径
 * @param cutoffDate 截止日期
 * @returns 清理的文件数
 */
function cleanSessionDirectory(
  sessionDir: string,
  cutoffDate: Date
): number {
  let cleaned = 0;

  if (!fs.existsSync(sessionDir)) {
    return cleaned;
  }

  try {
    const files = fs.readdirSync(sessionDir);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }

      const filePath = path.join(sessionDir, file);

      try {
        const stat = fs.statSync(filePath);

        if (stat.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (error) {
        console.warn(`Failed to clean session file ${filePath}:`, error);
      }
    }

    // 如果目录为空，删除目录
    const remaining = fs.readdirSync(sessionDir);
    if (remaining.length === 0) {
      fs.rmdirSync(sessionDir);
    }
  } catch (error) {
    console.warn(`Failed to clean session directory ${sessionDir}:`, error);
  }

  return cleaned;
}

/**
 * 清理所有过期数据
 *
 * @param periodDays 清理周期（天数），默认 30 天
 * @returns 清理统计信息
 */
export function cleanupExpiredData(
  periodDays: number = CLEANUP_PERIOD_DAYS
): CleanupStats {
  const cutoffDate = getCutoffDate(periodDays);
  const stats: CleanupStats = {
    sessions: 0,
    summaries: 0,
    errors: 0,
    directories: 0,
  };

  // 1. 清理 session 文件
  if (fs.existsSync(SESSIONS_BASE_DIR)) {
    try {
      const entries = fs.readdirSync(SESSIONS_BASE_DIR);

      for (const entry of entries) {
        const entryPath = path.join(SESSIONS_BASE_DIR, entry);

        // 跳过 summaries 目录
        if (entry === 'summaries') {
          continue;
        }

        try {
          const stat = fs.statSync(entryPath);

          if (stat.isDirectory()) {
            const cleaned = cleanSessionDirectory(entryPath, cutoffDate);
            stats.sessions += cleaned;

            if (cleaned > 0) {
              stats.directories++;
            }
          }
        } catch (error) {
          console.warn(`Failed to process ${entryPath}:`, error);
          stats.errors++;
        }
      }
    } catch (error) {
      console.warn('Failed to read sessions directory:', error);
      stats.errors++;
    }
  }

  // 2. 清理摘要文件
  const summaryResult = cleanDirectory(SUMMARIES_DIR, cutoffDate, '.json', true);
  stats.summaries += summaryResult.cleaned;
  stats.errors += summaryResult.errors;

  return stats;
}

/**
 * 启动时自动清理（异步，不阻塞启动）
 *
 * @param periodDays 清理周期（天数），默认 30 天
 */
export function scheduleCleanup(periodDays: number = CLEANUP_PERIOD_DAYS): void {
  // 延迟执行，避免影响启动速度
  setImmediate(() => {
    try {
      const stats = cleanupExpiredData(periodDays);

      if (stats.sessions > 0 || stats.summaries > 0) {
        console.log(
          `Cleanup complete: ${stats.sessions} session files, ${stats.summaries} summaries removed from ${stats.directories} directories.`
        );
      }

      if (stats.errors > 0) {
        console.warn(`Cleanup encountered ${stats.errors} errors.`);
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }).unref();
}

/**
 * 强制清理（同步执行）
 *
 * @param periodDays 清理周期（天数），默认 30 天
 * @returns 清理统计信息
 */
export function forceCleanup(
  periodDays: number = CLEANUP_PERIOD_DAYS
): CleanupStats {
  const stats = cleanupExpiredData(periodDays);

  console.log(
    `Force cleanup complete: ${stats.sessions} session files, ${stats.summaries} summaries removed from ${stats.directories} directories.`
  );

  if (stats.errors > 0) {
    console.warn(`Cleanup encountered ${stats.errors} errors.`);
  }

  return stats;
}

/**
 * 使用示例：
 *
 * ```typescript
 * // 1. 在应用启动时自动清理（推荐）
 * scheduleCleanup(); // 默认 30 天
 *
 * // 2. 自定义清理周期
 * scheduleCleanup(60); // 60 天
 *
 * // 3. 强制立即清理
 * const stats = forceCleanup();
 * console.log(`Cleaned ${stats.sessions} sessions`);
 * ```
 */
