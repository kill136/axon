/**
 * Self-Evolve 状态管理（独立模块）
 *
 * 从 web/server/index.ts 中提取出来，避免 SelfEvolveTool 静态导入
 * 整个 web/server 模块（会触发 CheckpointManager 等大量副作用）。
 */

// ============================================================================
// Self-Evolve: 进化重启支持
// AI 修改自身源码后，通过退出码 42 触发 --evolve 监控进程自动重启
// ============================================================================
let evolveRestartRequested = false;

/** 存储 gracefulShutdown 闭包的引用，供 SelfEvolveTool 跨平台调用 */
let gracefulShutdownFn: ((signal: string) => Promise<void>) | null = null;

/**
 * 请求进化重启（由 SelfEvolveTool 调用）
 * 设置标志后，gracefulShutdown 会使用退出码 42 而非 0
 */
export function requestEvolveRestart(): void {
  evolveRestartRequested = true;
}

/**
 * 触发优雅关闭（由 SelfEvolveTool 调用）
 * Windows 上 SIGTERM 不会触发 process.on('SIGTERM') 监听器，
 * 所以需要这个函数来直接调用 gracefulShutdown 闭包。
 */
export function triggerGracefulShutdown(): void {
  if (gracefulShutdownFn) {
    gracefulShutdownFn('SelfEvolve');
  } else {
    // 兜底：如果 gracefulShutdown 还没初始化，直接退出
    console.error('[Evolve] gracefulShutdown not initialized, forcing exit(42)');
    process.exit(42);
  }
}

/**
 * 检查进化模式是否启用（通过 --evolve 标志启动时设置 CLAUDE_EVOLVE_ENABLED=1）
 */
export function isEvolveEnabled(): boolean {
  return process.env.CLAUDE_EVOLVE_ENABLED === '1';
}

/**
 * 检查是否已请求进化重启
 */
export function isEvolveRestartRequested(): boolean {
  return evolveRestartRequested;
}

/**
 * 注册 gracefulShutdown 闭包（由 web/server/index.ts 调用）
 */
export function registerGracefulShutdown(fn: (signal: string) => Promise<void>): void {
  gracefulShutdownFn = fn;
}
