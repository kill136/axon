/**
 * Provider 类型检测（从 client.ts 抽取，供 fast-mode 模块使用）
 */

export type ProviderType = 'firstParty' | 'bedrock' | 'vertex' | 'foundry';

/**
 * 获取当前 Provider 类型（对应官方 F4/K4 函数）
 * 从 settings.json 配置读取，不再依赖环境变量
 */
export function getProviderType(): ProviderType {
  try {
    const { configManager } = require('../config/index.js');
    const config = configManager.getAll();
    if (config.apiProvider === 'bedrock' || config.useBedrock) return 'bedrock';
    if (config.apiProvider === 'vertex' || config.useVertex) return 'vertex';
  } catch {}
  if (process.env.AXON_USE_FOUNDRY === 'true' || process.env.AXON_USE_FOUNDRY === '1') {
    return 'foundry';
  }
  return 'firstParty';
}
