/**
 * 模式预设管理服务
 * 
 * 将权限行为、系统提示词、工具过滤打包为"模式预设"。
 * 内置 4 个默认预设（询问/自动编辑/YOLO/计划），用户可编辑和新增。
 * 
 * 对齐官方行为：
 * - default/acceptEdits/bypassPermissions: 不注入额外系统提示词，仅控制权限行为
 * - plan: 注入 plan mode 系统提示词（官方通过 attachment 注入，WebUI 通过 appendPrompt 模拟）
 */

import * as fs from 'fs';
import { configManager } from '../../../config/index.js';
import type { ModePreset, PermissionMode, SystemPromptConfig, ToolFilterConfig } from '../../shared/types.js';

// ============ 内置默认预设 ============
// 对齐官方：default/acceptEdits/bypassPermissions 不注入提示词
// plan mode 提示词来自官方 qvz() 函数（简化版，去掉动态变量）

const DEFAULT_PRESETS: ModePreset[] = [
  {
    id: 'default',
    name: 'Ask',
    icon: '🔒',
    builtIn: true,
    permissionMode: 'default',
    description: 'Ask for user approval before writing files, running commands, or making network requests',
    systemPrompt: { useDefault: true },
    toolFilter: { mode: 'all' },
  },
  {
    id: 'acceptEdits',
    name: 'Auto Edit',
    icon: '📝',
    builtIn: true,
    permissionMode: 'acceptEdits',
    description: 'File edits are automatically approved; bash commands and network requests still require approval',
    systemPrompt: { useDefault: true },
    toolFilter: { mode: 'all' },
  },
  {
    id: 'bypassPermissions',
    name: 'YOLO',
    icon: '⚡',
    builtIn: true,
    permissionMode: 'bypassPermissions',
    description: 'All tool calls are automatically approved — use responsibly',
    systemPrompt: { useDefault: true },
    toolFilter: { mode: 'all' },
  },
  {
    id: 'plan',
    name: 'Plan',
    icon: '📋',
    builtIn: true,
    permissionMode: 'plan',
    description: 'Read-only exploration mode — plan before implementing',
    systemPrompt: {
      useDefault: true,
      appendPrompt: `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

You should build your plan incrementally by writing to or editing the plan file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.`,
    },
    toolFilter: {
      mode: 'blacklist',
      disallowedTools: ['Write', 'Edit', 'MultiEdit', 'Bash', 'NotebookEdit'],
    },
  },
];

// ============ 管理器 ============

class ModePresetsManager {
  private presets: ModePreset[] = [];
  private loaded = false;

  /**
   * 获取所有预设（内置 + 自定义）
   */
  getAll(): ModePreset[] {
    this.ensureLoaded();
    return [...this.presets];
  }

  /**
   * 根据 ID 获取预设
   */
  get(id: string): ModePreset | undefined {
    this.ensureLoaded();
    return this.presets.find(p => p.id === id);
  }

  /**
   * 保存预设（新增或更新）
   */
  save(preset: ModePreset): void {
    this.ensureLoaded();

    const index = this.presets.findIndex(p => p.id === preset.id);
    if (index >= 0) {
      this.presets[index] = preset;
    } else {
      this.presets.push(preset);
    }

    this.persist();
  }

  /**
   * 删除预设（内置不可删除）
   */
  delete(id: string): boolean {
    this.ensureLoaded();
    const preset = this.presets.find(p => p.id === id);
    if (!preset || preset.builtIn) return false;

    this.presets = this.presets.filter(p => p.id !== id);
    this.persist();
    return true;
  }

  /**
   * 获取默认内置预设
   */
  getDefaults(): ModePreset[] {
    return DEFAULT_PRESETS.map(p => ({ ...p }));
  }

  // ============ 私有方法 ============

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    // 从 settings.json 读取自定义预设
    let savedPresets: ModePreset[] = [];
    try {
      const settingsPath = configManager.getConfigPaths().userSettings;
      if (fs.existsSync(settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (Array.isArray(raw.modePresets)) {
          savedPresets = raw.modePresets;
        }
      }
    } catch {
      // 读取失败使用默认值
    }

    // 合并：内置预设以保存的版本优先（用户可能编辑了提示词），不存在则用默认
    const result: ModePreset[] = [];
    for (const defaultPreset of DEFAULT_PRESETS) {
      const saved = savedPresets.find(s => s.id === defaultPreset.id);
      if (saved) {
        // 保留 builtIn 标记
        result.push({ ...saved, builtIn: true });
      } else {
        result.push({ ...defaultPreset });
      }
    }

    // 追加自定义预设
    for (const saved of savedPresets) {
      if (!DEFAULT_PRESETS.some(d => d.id === saved.id)) {
        result.push({ ...saved, builtIn: false });
      }
    }

    this.presets = result;
  }

  private persist(): void {
    try {
      configManager.save({ modePresets: this.presets } as any);
      console.log(`[ModePresets] Saved ${this.presets.length} presets to settings.json`);
    } catch (err) {
      console.error('[ModePresets] Failed to persist presets:', err);
    }
  }
}

// 单例
export const modePresetsManager = new ModePresetsManager();
