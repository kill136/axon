/**
 * 迁移运行器
 *
 * 参考 Claude Code 的 runMigrations() 模式：
 * - 使用全局迁移版本号（CURRENT_MIGRATION_VERSION）控制是否需要执行
 * - 每个迁移函数自身保证幂等性
 * - 版本号不匹配时执行全部迁移，然后更新版本号
 * - 迁移状态记录在 ~/.axon/migrations.json
 *
 * 添加新迁移时：
 * 1. 在 migrations/ 目录下创建新文件
 * 2. 在 ALL_MIGRATIONS 数组中注册
 * 3. 递增 CURRENT_MIGRATION_VERSION
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Migration } from './types.js';
import { migrateOldModelNames } from './migrateOldModelNames.js';
import { migrateAutoSaveField } from './migrateAutoSaveField.js';
import { migrateConfigVersion } from './migrateConfigVersion.js';

// ---- 注册所有迁移 ----
// 添加新迁移时递增此版本号
const CURRENT_MIGRATION_VERSION = 1;

const ALL_MIGRATIONS: Migration[] = [
  { name: 'migrateOldModelNames', run: migrateOldModelNames },
  { name: 'migrateAutoSaveField', run: migrateAutoSaveField },
  { name: 'migrateConfigVersion', run: migrateConfigVersion },
];

// ---- 迁移状态持久化 ----

interface MigrationState {
  migrationVersion: number;
  lastRunAt: string;
}

function getConfigDir(): string {
  return process.env.AXON_CONFIG_DIR ||
    path.join(process.env.HOME || process.env.USERPROFILE || '~', '.axon');
}

function getMigrationStatePath(): string {
  return path.join(getConfigDir(), 'migrations.json');
}

function readMigrationState(): MigrationState | null {
  const statePath = getMigrationStatePath();
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveMigrationState(state: MigrationState): void {
  const configDir = getConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(getMigrationStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

// ---- 公开 API ----

/**
 * 在 CLI 启动时调用。
 * 如果已保存的迁移版本号 === CURRENT_MIGRATION_VERSION，跳过。
 * 否则依次执行所有迁移（每个自身幂等），然后更新版本号。
 */
export function runMigrations(): void {
  const state = readMigrationState();

  if (state?.migrationVersion === CURRENT_MIGRATION_VERSION) {
    return;
  }

  for (const migration of ALL_MIGRATIONS) {
    try {
      migration.run();
    } catch (error) {
      // 单个迁移失败不阻塞启动，输出警告即可
      console.error(`[migrations] Failed to run ${migration.name}:`, error);
    }
  }

  saveMigrationState({
    migrationVersion: CURRENT_MIGRATION_VERSION,
    lastRunAt: new Date().toISOString(),
  });
}
