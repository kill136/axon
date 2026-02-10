/**
 * Provider 类型检测（从 client.ts 抽取，供 fast-mode 模块使用）
 */

export type ProviderType = 'firstParty' | 'bedrock' | 'vertex' | 'foundry';

/**
 * 获取当前 Provider 类型（对应官方 F4/K4 函数）
 */
export function getProviderType(): ProviderType {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === 'true' || process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return 'bedrock';
  }
  if (process.env.CLAUDE_CODE_USE_VERTEX === 'true' || process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    return 'vertex';
  }
  if (process.env.CLAUDE_CODE_USE_FOUNDRY === 'true' || process.env.CLAUDE_CODE_USE_FOUNDRY === '1') {
    return 'foundry';
  }
  return 'firstParty';
}
