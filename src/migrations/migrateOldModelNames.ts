import * as fs from 'fs';
import * as path from 'path';

/**
 * 迁移旧的模型名称到当前别名
 *
 * 早期版本用户可能在 settings.json 中保存了完整模型 ID（如 claude-3-opus-20240229），
 * 这些模型 ID 已不再有效。此迁移将它们更新为当前的短别名。
 *
 * 幂等：只在发现旧模型名称时才写入。
 */
export function migrateOldModelNames(): void {
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

  const model = settings.model;
  if (typeof model !== 'string') {
    return;
  }

  const remap: Record<string, string> = {
    'claude-3-opus-20240229': 'opus',
    'claude-3-sonnet-20240229': 'sonnet',
    'claude-3-haiku-20240307': 'haiku',
    'claude-3-5-sonnet-20241022': 'sonnet',
    'claude-3-5-haiku-20241022': 'haiku',
    'claude-3-opus': 'opus',
    'claude-3-sonnet': 'sonnet',
    'claude-3-haiku': 'haiku',
  };

  const replacement = remap[model];
  if (!replacement) {
    return;
  }

  settings.model = replacement;
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}
