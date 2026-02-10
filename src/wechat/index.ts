/**
 * 微信适配器导出
 */

export { WeChatBot } from './bot.js';
export { SessionManager } from './session-manager.js';
export { getDefaultConfig, loadConfigFromEnv } from './config.js';
export type { WeChatBotConfig } from './config.js';
export {
  extractUserInput,
  shouldRespond,
  formatResponse,
  splitMessage,
  handleBuiltinCommand,
} from './message-handler.js';
