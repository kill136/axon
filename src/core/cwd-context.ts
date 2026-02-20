/**
 * 工作目录上下文
 *
 * 使用 AsyncLocalStorage 在异步调用链中传递工作目录
 * 解决多 Worker 并发时共享 process.cwd() 的竞态条件问题
 *
 * 使用方法：
 * 1. 在 ConversationLoop 中：runWithCwd(workingDir, async () => { ... })
 * 2. 在工具中：getCurrentCwd() 获取当前工作目录
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * 工作目录上下文存储
 */
const cwdStorage = new AsyncLocalStorage<string>();

/**
 * 在指定工作目录上下文中执行函数
 * @param cwd 工作目录（必须是有效的绝对路径）
 * @param fn 要执行的函数
 * @returns 函数执行结果
 */
export function runWithCwd<T>(cwd: string, fn: () => T): T {
  // 关键验证：确保 cwd 是有效的路径，禁止传入 undefined 或空字符串
  if (!cwd) {
    throw new Error('runWithCwd: cwd 参数不能为空，请确保传入有效的工作目录');
  }
  return cwdStorage.run(cwd, fn);
}

/**
 * 获取当前工作目录
 *
 * 借鉴 VS Code 的设计理念：不在上下文中时直接抛错，而不是默默回退
 * 这能立即暴露 Worker 工作目录配置错误的问题
 *
 * @returns 当前工作目录
 * @throws 当不在上下文中时抛出错误
 */
export function getCurrentCwd(): string {
  const stored = cwdStorage.getStore();
  if (stored) {
    return stored;
  }

  // 测试环境下回退到 process.cwd()，避免测试文件需要逐个包装 runWithCwd
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return process.cwd();
  }

  throw new Error(
    'getCurrentCwd: 未在工作目录上下文中。\n' +
    '可能原因：\n' +
    '1. 忘记使用 runWithCwd() 包装调用\n' +
    '2. Worker/SubAgent 未正确传递 workingDir\n' +
    '解决方法：确保在 runWithCwd(cwd, fn) 内部调用此函数'
  );
}

/**
 * 获取当前工作目录，允许回退（用于主 CLI 入口）
 *
 * 仅用于程序入口点，如主 CLI 启动时。
 * Worker 和 SubAgent 应使用 getCurrentCwd() 或 requireCwd()
 *
 * @returns 当前工作目录（上下文中的值或 process.cwd()）
 */
export function getCwdOrDefault(): string {
  return cwdStorage.getStore() || process.cwd();
}

/**
 * 检查是否在工作目录上下文中
 * @returns 是否在上下文中
 */
export function isInCwdContext(): boolean {
  return cwdStorage.getStore() !== undefined;
}

/**
 * 包装 AsyncGenerator，确保在每次迭代时都在正确的工作目录上下文中
 *
 * 解决问题：AsyncLocalStorage.run() 不能跨 generator 边界传播上下文
 * 当使用 yield* 委托给另一个 generator 时，迭代发生在 run() 上下文之外
 *
 * @param cwd 工作目录（必须是有效的绝对路径）
 * @param generator 要包装的 AsyncGenerator
 * @returns 包装后的 AsyncGenerator，每次迭代都在正确的上下文中
 */
export async function* runGeneratorWithCwd<T>(
  cwd: string,
  generator: AsyncGenerator<T, void, undefined>
): AsyncGenerator<T, void, undefined> {
  // 关键验证：确保 cwd 是有效的路径，禁止传入 undefined 或空字符串
  if (!cwd) {
    throw new Error('runGeneratorWithCwd: cwd 参数不能为空，请确保传入有效的工作目录');
  }

  try {
    while (true) {
      // 在正确的上下文中执行 next()
      const result = await cwdStorage.run(cwd, () => generator.next());

      if (result.done) {
        return;
      }

      // TypeScript 无法正确推断 result.done === false 时 result.value 的类型
      yield result.value as T;
    }
  } finally {
    // 确保 generator 被正确关闭
    await generator.return?.(undefined);
  }
}
