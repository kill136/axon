/**
 * 斜杠命令系统入口
 * 注册并导出所有命令
 */

export * from './types.js';
export { commandRegistry } from './registry.js';

import { registerGeneralCommands } from './general.js';
import { registerSessionCommands } from './session.js';
import { registerConfigCommands } from './config.js';
import { registerAuthCommands } from './auth.js';
import { registerToolsCommands } from './tools.js';
import { registerUtilityCommands } from './utility.js';
import { registerDevelopmentCommands } from './development.js';
import { registerApiCommands } from './api.js';
import { registerSettingsCommands } from './settings.js';

let initialized = false;

/**
 * 初始化所有斜杠命令
 */
export function initializeCommands(): void {
  if (initialized) return;

  registerGeneralCommands();
  registerSessionCommands();
  registerConfigCommands();
  registerAuthCommands();
  registerToolsCommands();
  registerUtilityCommands();
  registerDevelopmentCommands();
  registerApiCommands();
  registerSettingsCommands();

  initialized = true;
}

/**
 * 执行斜杠命令
 */
export async function executeCommand(
  input: string,
  context: {
    session: any;
    config: any;
    ui: any;
  }
): Promise<import('./types.js').CommandResult> {
  // 确保命令已初始化
  initializeCommands();

  // 解析命令
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { success: false, message: 'Not a command' };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const args = parts.slice(1);

  // 导入命令注册表
  const { commandRegistry } = await import('./registry.js');

  // 执行命令
  const result = await commandRegistry.execute(commandName, {
    session: context.session,
    config: context.config,
    ui: context.ui,
    args,
    rawInput: input,
  });

  return result;
}

// 导出各模块的命令注册函数（用于按需加载）
export { registerGeneralCommands } from './general.js';
export { registerSessionCommands } from './session.js';
export { registerConfigCommands } from './config.js';
export { registerAuthCommands } from './auth.js';
export { registerToolsCommands } from './tools.js';
export { registerUtilityCommands } from './utility.js';
export { registerDevelopmentCommands } from './development.js';
export { registerApiCommands } from './api.js';
export { registerSettingsCommands } from './settings.js';
