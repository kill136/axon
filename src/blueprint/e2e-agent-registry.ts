/**
 * E2E Agent 全局注册表
 *
 * 解决的问题：E2E Agent 可能从两条路径创建：
 * 1. WebSocket 直接启动（websocket.ts）
 * 2. LeadAgent 通过 TriggerE2ETestTool 启动（trigger-e2e-test.ts）
 *
 * 用户插嘴（interject）需要找到活跃的 E2E Agent 实例，
 * 因此需要一个两条路径都能访问的共享注册表。
 */

// blueprintId -> E2ETestAgent 实例
const activeE2EAgents = new Map<string, any>();

/**
 * 注册活跃的 E2E Agent
 */
export function registerE2EAgent(blueprintId: string, agent: any): void {
  activeE2EAgents.set(blueprintId, agent);
  console.log(`[E2E Registry] Registered E2E Agent: ${blueprintId}`);
}

/**
 * 注销 E2E Agent（执行完成或失败后调用）
 */
export function unregisterE2EAgent(blueprintId: string): void {
  activeE2EAgents.delete(blueprintId);
  console.log(`[E2E Registry] Unregistered E2E Agent: ${blueprintId}`);
}

/**
 * 获取活跃的 E2E Agent
 */
export function getE2EAgent(blueprintId: string): any | undefined {
  return activeE2EAgents.get(blueprintId);
}

/**
 * 检查是否存在活跃的 E2E Agent
 */
export function hasE2EAgent(blueprintId: string): boolean {
  return activeE2EAgents.has(blueprintId);
}
