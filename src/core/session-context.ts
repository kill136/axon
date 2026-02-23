/**
 * 会话 ID 上下文
 *
 * 使用 AsyncLocalStorage 在异步调用链中传递 sessionId
 * 解决多会话并发时工具（如 Browser）需要区分不同会话的问题
 *
 * 使用方法：
 * 1. 在 ConversationLoop / WebUI chat 中：runWithSessionId(id, async () => { ... })
 * 2. 在工具中：getSessionId() 获取当前会话 ID
 */

import { AsyncLocalStorage } from 'async_hooks';

const sessionIdStorage = new AsyncLocalStorage<string>();

/**
 * 在指定会话上下文中执行函数
 */
export function runWithSessionId<T>(sessionId: string, fn: () => T): T {
  if (!sessionId) {
    throw new Error('runWithSessionId: sessionId 不能为空');
  }
  return sessionIdStorage.run(sessionId, fn);
}

/**
 * 获取当前会话 ID
 * 如果不在上下文中，返回 'default'（单用户 CLI 模式的兜底）
 */
export function getSessionId(): string {
  return sessionIdStorage.getStore() || 'default';
}

/**
 * 检查是否在会话上下文中
 */
export function isInSessionContext(): boolean {
  return sessionIdStorage.getStore() !== undefined;
}
