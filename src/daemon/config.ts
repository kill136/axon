/**
 * Daemon 配置加载
 * 从 .claude/daemon.yml（项目级）和 ~/.claude/daemon.yml（用户级）加载配置
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';
import { z } from 'zod';

// ============================================================================
// Schema 定义
// ============================================================================

const WatchRuleSchema = z.object({
  name: z.string(),
  paths: z.array(z.string()),
  events: z.array(z.string()).default(['change']),
  debounce: z.number().default(2000),
  prompt: z.string(),
  model: z.string().optional(),
  notify: z.array(z.enum(['desktop', 'feishu'])).default(['desktop']),
  feishuChatId: z.string().optional(),
});

const CronRuleSchema = z.object({
  name: z.string(),
  interval: z.number(),
  prompt: z.string(),
  model: z.string().optional(),
  notify: z.array(z.enum(['desktop', 'feishu'])).default(['desktop']),
  feishuChatId: z.string().optional(),
});

const DaemonSettingsSchema = z.object({
  maxConcurrent: z.number().default(2),
  logFile: z.string().default('.claude/daemon.log'),
  workingDir: z.string().default('.'),
  model: z.string().default('sonnet'),
  permissionMode: z.string().default('dontAsk'),
  feishuChatId: z.string().default(''),
  reloadInterval: z.number().default(5000),
});

const DaemonConfigSchema = z.object({
  watch: z.array(WatchRuleSchema).default([]),
  cron: z.array(CronRuleSchema).default([]),
  settings: DaemonSettingsSchema.default({}),
});

// ============================================================================
// 类型导出
// ============================================================================

export type WatchRule = z.infer<typeof WatchRuleSchema>;
export type CronRule = z.infer<typeof CronRuleSchema>;
export type DaemonSettings = z.infer<typeof DaemonSettingsSchema>;
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;

// ============================================================================
// 加载函数
// ============================================================================

function loadYamlFile(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.load(raw);
    if (data && typeof data === 'object') {
      return data as Record<string, any>;
    }
    return null;
  } catch {
    return null;
  }
}

function mergeConfigs(base: Record<string, any>, override: Record<string, any>): Record<string, any> {
  const result = { ...base };

  // watch 和 cron 是数组，合并
  if (override.watch) {
    result.watch = [...(result.watch || []), ...override.watch];
  }
  if (override.cron) {
    result.cron = [...(result.cron || []), ...override.cron];
  }
  // settings 深合并
  if (override.settings) {
    result.settings = { ...(result.settings || {}), ...override.settings };
  }

  return result;
}

/**
 * 加载 daemon 配置
 * @param cwd 项目工作目录
 * @returns 合并后的配置
 */
export function loadDaemonConfig(cwd?: string): DaemonConfig {
  const userConfigPath = path.join(os.homedir(), '.claude', 'daemon.yml');
  const projectConfigPath = cwd
    ? path.join(cwd, '.claude', 'daemon.yml')
    : null;

  let merged: Record<string, any> = {};

  // 用户级配置
  const userConfig = loadYamlFile(userConfigPath);
  if (userConfig) {
    merged = mergeConfigs(merged, userConfig);
  }

  // 项目级配置（覆盖）
  if (projectConfigPath) {
    const projectConfig = loadYamlFile(projectConfigPath);
    if (projectConfig) {
      merged = mergeConfigs(merged, projectConfig);
    }
  }

  // Zod 校验 + 默认值填充
  return DaemonConfigSchema.parse(merged);
}
