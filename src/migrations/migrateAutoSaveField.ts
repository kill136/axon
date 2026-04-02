import * as fs from 'fs';
import * as path from 'path';

/**
 * 迁移旧的 autoSave 字段到 enableAutoSave
 *
 * 早期版本使用 autoSave（位于 editor 子对象或顶层），
 * 后来统一为顶层的 enableAutoSave。
 * 此迁移清理 settings.json 中残留的旧字段名。
 *
 * 幂等：只在发现旧字段时才写入。
 */
export function migrateAutoSaveField(): void {
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

  let changed = false;

  // 顶层 autoSave → enableAutoSave
  if ('autoSave' in settings && !('enableAutoSave' in settings)) {
    settings.enableAutoSave = settings.autoSave;
    delete settings.autoSave;
    changed = true;
  } else if ('autoSave' in settings) {
    // enableAutoSave 已存在，删除重复的旧字段
    delete settings.autoSave;
    changed = true;
  }

  // editor.autoSave → enableAutoSave
  if (settings.editor && typeof settings.editor === 'object' && 'autoSave' in settings.editor) {
    if (!('enableAutoSave' in settings)) {
      settings.enableAutoSave = settings.editor.autoSave;
    }
    delete settings.editor.autoSave;
    // 如果 editor 对象为空，删除它
    if (Object.keys(settings.editor).length === 0) {
      delete settings.editor;
    }
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  }
}
