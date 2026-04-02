import * as fs from 'fs';
import * as path from 'path';
import { VERSION } from '../version.js';

/**
 * 确保 settings.json 的 version 字段与当前 Axon 版本一致
 *
 * 早期版本可能遗留了旧版本号，导致 ConfigManager 内部的
 * 版本比较迁移逻辑反复触发。此迁移将 version 更新到当前值。
 *
 * 幂等：只在版本不同时才写入。
 */
export function migrateConfigVersion(): void {
  const configDir = process.env.AXON_CONFIG_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || '~', '.axon');
  const settingsFile = path.join(configDir, 'settings.json');

  if (!fs.existsSync(settingsFile)) {
    return;
  }

  let settings: Record<string, any>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
  } catch {
    return;
  }

  if (settings.version === VERSION) {
    return;
  }

  settings.version = VERSION;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}
