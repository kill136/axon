/**
 * Daemon 文件监控器
 * 基于 chokidar 监控文件变化，触发 AI 任务
 */

import { watch, type FSWatcher } from 'chokidar';
import { TaskExecutor } from './executor.js';
import type { ScheduledTask } from './store.js';
import type { WatchRule } from './config.js';

interface WatchEntry {
  watcher: FSWatcher;
  debounceTimer?: NodeJS.Timeout;
}

export class FileWatcher {
  private watchers = new Map<string, WatchEntry>();

  constructor(private executor: TaskExecutor) {}

  /**
   * 注册文件监控（来自动态任务）
   */
  watchTask(task: ScheduledTask): void {
    if (!task.watchPaths || task.watchPaths.length === 0) return;

    const events = task.watchEvents || ['change'];
    const debounceMs = task.debounceMs || 2000;

    this.setupWatcher(task.id, task.watchPaths, events, debounceMs, (filePath) => {
      this.executor.execute({
        task,
        templateVars: { file: filePath },
      }).catch((err) => {
        console.error(`[Watcher] Task "${task.name}" failed:`, err.message);
      });
    });
  }

  /**
   * 注册文件监控（来自静态 YAML 配置）
   */
  watchRule(ruleId: string, rule: WatchRule, workingDir: string): void {
    const events = rule.events || ['change'];
    const debounceMs = rule.debounce || 2000;

    this.setupWatcher(ruleId, rule.paths, events, debounceMs, (filePath) => {
      this.executor.execute({
        task: {
          name: rule.name,
          prompt: rule.prompt,
          model: rule.model,
          notify: rule.notify,
          feishuChatId: rule.feishuChatId,
          workingDir,
        },
        templateVars: { file: filePath },
      }).catch((err) => {
        console.error(`[Watcher] Rule "${rule.name}" failed:`, err.message);
      });
    });
  }

  private setupWatcher(
    id: string,
    paths: string[],
    events: string[],
    debounceMs: number,
    callback: (filePath: string) => void,
  ): void {
    // 如果已存在同 id 的 watcher，先取消
    this.unwatch(id);

    const fsWatcher = watch(paths, {
      ignoreInitial: true,
      persistent: true,
    });

    const entry: WatchEntry = { watcher: fsWatcher };
    this.watchers.set(id, entry);

    const handler = (filePath: string) => {
      // 防抖
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = undefined;
        callback(filePath);
      }, debounceMs);
    };

    // chokidar v5 使用严格类型的 EventEmitter，用 'all' 事件 + 内部过滤
    const eventSet = new Set(events);
    fsWatcher.on('all', (eventName, filePath) => {
      if (eventSet.has(eventName)) {
        handler(filePath);
      }
    });
  }

  /**
   * 取消单个监控
   */
  unwatch(id: string): void {
    const entry = this.watchers.get(id);
    if (entry) {
      if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
      entry.watcher.close();
      this.watchers.delete(id);
    }
  }

  /**
   * 取消所有监控
   */
  unwatchAll(): void {
    for (const [id] of this.watchers) {
      this.unwatch(id);
    }
  }

  /**
   * 当前活跃的监控数量
   */
  getActiveCount(): number {
    return this.watchers.size;
  }
}
