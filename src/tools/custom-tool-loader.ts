/**
 * CustomToolLoader - 外挂工具加载器
 *
 * 扫描 ~/.axon/custom-tools/ 目录，动态加载用户自定义的 JS 工具文件，
 * 注册到 ToolRegistry，使模型可以直接调用。
 *
 * 工具文件格式 (ES Module):
 * ```js
 * export default {
 *   name: "MyTool",
 *   description: "工具描述",
 *   inputSchema: { type: "object", properties: { ... }, required: [...] },
 *   async execute(input) { return { success: true, output: "result" }; }
 * }
 * ```
 *
 * 核心设计：
 * - 模型自己可以通过 Write 工具创建 JS 文件来给自己扩展能力
 * - CreateTool 工具提供结构化创建方式
 * - 支持热重载：写完文件后调用 reloadCustomTools() 即可生效
 */

import { BaseTool, toolRegistry } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pathToFileURL } from 'url';

/**
 * 自定义工具定义接口
 */
export interface CustomToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
  execute: (input: any) => Promise<ToolResult | string>;
}

/**
 * 获取自定义工具目录路径
 */
export function getCustomToolsDir(): string {
  return path.join(process.env.AXON_CONFIG_DIR || path.join(os.homedir(), '.axon'), 'custom-tools');
}

/**
 * CustomToolWrapper - 将外挂 JS 工具包装为 BaseTool
 */
export class CustomToolWrapper extends BaseTool {
  name: string;
  description: string;
  private _inputSchema: ToolDefinition['inputSchema'];
  private _executor: (input: any) => Promise<ToolResult | string>;
  /** 来源文件路径 */
  sourceFile: string;

  constructor(definition: CustomToolDefinition, sourceFile: string) {
    super();
    this.name = definition.name;
    this.description = definition.description;
    this._inputSchema = definition.inputSchema;
    this._executor = definition.execute;
    this.sourceFile = sourceFile;
    // 外挂工具默认 defer，避免膨胀核心工具列表
    this.shouldDefer = true;
    this.searchHint = `custom tool from ${path.basename(sourceFile)}`;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return this._inputSchema;
  }

  async execute(input: unknown): Promise<ToolResult> {
    try {
      const result = await this._executor(input);
      // 支持返回字符串或 ToolResult
      if (typeof result === 'string') {
        return { success: true, output: result };
      }
      return result;
    } catch (err: any) {
      return {
        success: false,
        error: `Custom tool "${this.name}" execution failed: ${err.message}`,
      };
    }
  }
}

/**
 * 验证自定义工具定义
 */
function validateToolDefinition(def: any, filePath: string): string | null {
  if (!def || typeof def !== 'object') {
    return `${filePath}: default export is not an object`;
  }
  if (!def.name || typeof def.name !== 'string') {
    return `${filePath}: missing or invalid "name" (must be a non-empty string)`;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(def.name)) {
    return `${filePath}: invalid tool name "${def.name}" (must start with a letter, contain only letters, digits, _ or -)`;
  }
  if (!def.description || typeof def.description !== 'string') {
    return `${filePath}: missing or invalid "description"`;
  }
  if (!def.inputSchema || typeof def.inputSchema !== 'object') {
    return `${filePath}: missing or invalid "inputSchema"`;
  }
  if (typeof def.execute !== 'function') {
    return `${filePath}: missing or invalid "execute" (must be a function)`;
  }
  return null;
}

/**
 * 已加载的自定义工具名称集合（用于 reload 时清理旧工具）
 */
let loadedCustomTools = new Set<string>();

/**
 * 加载单个自定义工具文件
 */
async function loadToolFile(filePath: string): Promise<CustomToolWrapper | null> {
  try {
    // 使用 file:// URL 并附加时间戳绕过 import 缓存
    const fileUrl = pathToFileURL(filePath).href + `?t=${Date.now()}`;
    const mod = await import(fileUrl);
    const def = mod.default;

    const error = validateToolDefinition(def, filePath);
    if (error) {
      console.warn(`[CustomToolLoader] Validation failed: ${error}`);
      return null;
    }

    return new CustomToolWrapper(def as CustomToolDefinition, filePath);
  } catch (err: any) {
    console.warn(`[CustomToolLoader] Failed to load ${filePath}: ${err.message}`);
    return null;
  }
}

/**
 * 加载所有自定义工具
 * 扫描 ~/.axon/custom-tools/ 目录下的所有 .js 和 .mjs 文件
 */
export async function loadCustomTools(): Promise<{ loaded: string[]; errors: string[] }> {
  const dir = getCustomToolsDir();
  const loaded: string[] = [];
  const errors: string[] = [];

  // 确保目录存在
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return { loaded, errors };
  }

  // 扫描 .js 和 .mjs 文件
  let files: string[];
  try {
    files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.js') || f.endsWith('.mjs'))
      .map(f => path.join(dir, f));
  } catch (err: any) {
    errors.push(`Failed to read directory ${dir}: ${err.message}`);
    return { loaded, errors };
  }

  // 并行加载所有工具文件
  const results = await Promise.all(files.map(f => loadToolFile(f)));

  for (const wrapper of results) {
    if (!wrapper) continue;

    // 检查与内置工具冲突
    const existing = toolRegistry.get(wrapper.name);
    if (existing && !(existing instanceof CustomToolWrapper)) {
      errors.push(`Custom tool "${wrapper.name}" conflicts with built-in tool, skipped`);
      continue;
    }

    toolRegistry.register(wrapper);
    loadedCustomTools.add(wrapper.name);
    loaded.push(wrapper.name);
  }

  if (loaded.length > 0) {
    console.log(`[CustomToolLoader] Loaded ${loaded.length} custom tool(s): ${loaded.join(', ')}`);
  }

  return { loaded, errors };
}

/**
 * 重新加载所有自定义工具
 * 先卸载旧的自定义工具，再重新加载
 */
export async function reloadCustomTools(): Promise<{ loaded: string[]; errors: string[] }> {
  // 1. 卸载所有已加载的自定义工具
  for (const name of loadedCustomTools) {
    const existing = toolRegistry.get(name);
    if (existing instanceof CustomToolWrapper) {
      toolRegistry.unregister(name);
    }
  }
  loadedCustomTools.clear();

  // 2. 重新加载
  return loadCustomTools();
}

/**
 * 获取已加载的自定义工具列表
 */
export function getLoadedCustomTools(): string[] {
  return Array.from(loadedCustomTools);
}

/**
 * 列出自定义工具目录下的所有工具文件信息
 */
export function listCustomToolFiles(): Array<{
  file: string;
  name: string | null;
  description: string | null;
  loaded: boolean;
}> {
  const dir = getCustomToolsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.js') || f.endsWith('.mjs'));

  return files.map(f => {
    const filePath = path.join(dir, f);
    // 尝试从已注册的工具中获取信息
    for (const name of loadedCustomTools) {
      const tool = toolRegistry.get(name);
      if (tool instanceof CustomToolWrapper && tool.sourceFile === filePath) {
        return {
          file: f,
          name: tool.name,
          description: tool.description,
          loaded: true,
        };
      }
    }
    return { file: f, name: null, description: null, loaded: false };
  });
}
