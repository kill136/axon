/**
 * Agent 工具 (Task)
 * 子代理管理 - 参照官方 Claude Code CLI v2.1.4 实现
 */

import { BaseTool } from './base.js';
import type { AgentInput, ToolResult, ToolDefinition } from '../types/index.js';
import { isBackgroundTasksDisabled } from '../utils/env-check.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getBackgroundShell, isShellId, loadTaskMeta, getTaskOutputPath } from './bash.js';
import { getCurrentCwd } from '../core/cwd-context.js';
// 使用动态导入避免循环依赖：agent.ts -> loop.ts -> tools/index.ts -> agent.ts
import type { LoopOptions } from '../core/loop.js';
import {
  runSubagentStartHooks,
  runSubagentStopHooks,
  type HookInput
} from '../hooks/index.js';
import type { Message } from '../types/index.js';
import { GENERAL_PURPOSE_AGENT_PROMPT, EXPLORE_AGENT_PROMPT, CODE_ANALYZER_PROMPT, BLUEPRINT_WORKER_PROMPT } from '../prompt/templates.js';
import { notificationManager, type AgentCompletionResult } from '../notifications/index.js';
import { isAgentTeamsEnabled } from '../agents/teammate-context.js';
import { t } from '../i18n/index.js';

// 代理类型定义（参照官方）
export interface AgentTypeDefinition {
  agentType: string;
  whenToUse: string;
  tools?: string[];
  /** v2.1.33: 限制可以生成的子 agent 类型 (Task(agent_type) 语法) */
  allowedSubagentTypes?: string[];
  /** 禁用的工具列表 */
  disallowedTools?: string[];
  /** 限制可用的 skills */
  skills?: string[];
  forkContext?: boolean;  // 是否访问父对话上下文
  permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
  model?: string;         // 代理类型的默认模型
  color?: string;         // v2.1.33: agent color
  memory?: string;        // v2.1.33: agent memory scope
  /** agent 来源：built-in, userSettings, projectSettings, plugin */
  source?: 'built-in' | 'userSettings' | 'projectSettings' | 'plugin';
  /** 插件名称（source 为 plugin 时有值） */
  plugin?: string;
  /** 原始文件名（不含 .md） */
  filename?: string;
  /** 最大轮次 */
  maxTurns?: number;
  description?: string;
  getSystemPrompt?: () => string;  // 系统提示词生成函数
}

/**
 * v2.1.33: 解析 tools 字段中的 Task(agent_type) 语法
 *
 * 对应官方 qzq 函数中的 tools 格式解析
 * 例如: "Task(Explore), Task(Plan), Read, Grep" 表示
 * - 可以使用 Task 工具，但只能生成 Explore 和 Plan 类型的子 agent
 * - 可以使用 Read 和 Grep 工具
 *
 * @param tools 原始 tools 数组
 * @returns { tools: 过滤后的工具列表, allowedSubagentTypes: 允许的子 agent 类型 }
 */
export function parseToolsWithAgentTypeRestriction(tools: string[]): {
  tools: string[];
  allowedSubagentTypes?: string[];
} {
  const normalTools: string[] = [];
  const subagentTypes: string[] = [];
  let hasTaskRestriction = false;

  for (const tool of tools) {
    const trimmed = tool.trim();
    // 匹配 Task(agent_type) 语法
    const match = trimmed.match(/^Task\((\w+)\)$/);
    if (match) {
      hasTaskRestriction = true;
      subagentTypes.push(match[1]);
      // 确保 Task 工具在允许列表中
      if (!normalTools.includes('Task')) {
        normalTools.push('Task');
      }
    } else {
      normalTools.push(trimmed);
    }
  }

  return {
    tools: normalTools,
    allowedSubagentTypes: hasTaskRestriction ? subagentTypes : undefined,
  };
}

// 模型别名类型（与官方 SDK 一致）
export type ModelAlias = 'sonnet' | 'opus' | 'haiku' | 'inherit';

// 全局父模型上下文（用于 inherit 继承）
let parentModelContext: string | undefined;

/**
 * 设置父模型上下文
 * 在主循环中设置，供子代理继承
 */
export function setParentModelContext(model: string | undefined): void {
  parentModelContext = model;
}

/**
 * 获取父模型上下文
 */
export function getParentModelContext(): string | undefined {
  return parentModelContext;
}

/**
 * 解析模型参数，处理 inherit 继承
 * @param modelParam 模型参数 ('sonnet', 'opus', 'haiku', 'inherit', 或 undefined)
 * @param agentDefaultModel 代理类型的默认模型（可选）
 * @returns 解析后的模型名称
 */
export function resolveAgentModel(
  modelParam: string | undefined,
  agentDefaultModel?: string
): string | undefined {
  // 如果指定了 inherit，使用父模型
  if (modelParam === 'inherit') {
    return parentModelContext || agentDefaultModel;
  }

  // 如果明确指定了模型，使用指定的
  if (modelParam && modelParam !== 'inherit') {
    return modelParam;
  }

  // 如果代理类型有默认模型，使用代理默认模型
  if (agentDefaultModel) {
    return agentDefaultModel;
  }

  // 否则，继承父模型（如果有）
  if (parentModelContext) {
    return parentModelContext;
  }

  // 最终默认返回 undefined（让 ConversationLoop 使用它自己的默认值 'sonnet'）
  return undefined;
}

/**
 * 格式化代理模型名称用于显示
 * 官方 w71() 函数 - v2.1.19 修复
 *
 * 修复：当代理没有设置模型时显示 "Inherit (default)" 而不是 "Sonnet (default)"
 *
 * @param model 模型名称 (undefined, 'inherit', 'sonnet', 'opus', 'haiku' 等)
 * @returns 格式化的显示名称
 */
export function formatAgentModel(model: string | undefined): string {
  // v2.1.19 修复：如果没有模型，返回 "Inherit (default)"
  if (!model) {
    return 'Inherit (default)';
  }

  // 如果是 inherit，返回 "Inherit from parent"
  if (model === 'inherit') {
    return 'Inherit from parent';
  }

  // 否则首字母大写
  return model.charAt(0).toUpperCase() + model.slice(1);
}

// 内置代理类型
export const BUILT_IN_AGENT_TYPES: AgentTypeDefinition[] = [
  {
    agentType: 'general-purpose',
    whenToUse: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
    tools: ['*'],  // 所有工具
    forkContext: false,
    source: 'built-in',
    getSystemPrompt: () => GENERAL_PURPOSE_AGENT_PROMPT,
  },
  {
    agentType: 'Explore',
    whenToUse: 'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
    tools: ['Glob', 'Grep', 'Read'],
    forkContext: false,
    model: 'haiku',
    source: 'built-in',
    getSystemPrompt: () => EXPLORE_AGENT_PROMPT,
  },
  {
    agentType: 'Plan',
    whenToUse: 'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    tools: ['*'],
    forkContext: false,
    permissionMode: 'plan',
    source: 'built-in',
  },
  {
    agentType: 'claude-code-guide',
    whenToUse: 'Agent for Claude Code documentation and API questions',
    tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
    forkContext: false,
    source: 'built-in',
  },
  {
    agentType: 'blueprint-worker',
    whenToUse: 'Worker agent for executing blueprint tasks with TDD methodology. This agent writes tests first, then implements code until tests pass. Only used by the blueprint system (Queen Agent).',
    tools: ['*'],
    forkContext: false,
    source: 'built-in',
    getSystemPrompt: () => BLUEPRINT_WORKER_PROMPT,
  },
  {
    agentType: 'code-analyzer',
    whenToUse: 'Code analyzer agent for analyzing files and directories. Use this when you need to analyze code structure, dependencies, exports, and relationships. Returns structured JSON with semantic information.',
    tools: ['Read', 'Grep', 'Glob', 'Bash','LSP'],
    forkContext: false,
    model: 'opus',
    source: 'built-in',
    getSystemPrompt: () => CODE_ANALYZER_PROMPT,
  },
];

// 兼容性导出：将数组转换为对象格式（用于测试）
export const AGENT_TYPES: Record<string, { description: string; tools: string[] }> =
  BUILT_IN_AGENT_TYPES.reduce((acc, agent) => {
    acc[agent.agentType] = {
      description: agent.whenToUse,
      tools: agent.tools || ['*'],
    };
    return acc;
  }, {} as Record<string, { description: string; tools: string[] }>);

// ========== 自定义 Agent 加载系统（对齐官方 oc7/Tv9/pF7） ==========

/**
 * 有效的 model 值（对齐官方 pO1 数组）
 */
const VALID_AGENT_MODELS = ['sonnet', 'opus', 'haiku', 'inherit'];

/**
 * 有效的 memory 值（对齐官方 UF7 数组）
 */
const VALID_MEMORY_VALUES = ['user', 'project', 'local'];

/**
 * 有效的 permissionMode 值
 */
const VALID_PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];

/**
 * 有效的 color 值
 */
const VALID_COLORS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'gray'];

/**
 * 自定义 agent 存储（从文件系统加载）
 */
let customAgentTypes: AgentTypeDefinition[] = [];

/**
 * 是否已完成初始化加载
 */
let customAgentsInitialized = false;

/**
 * 解析 agent .md 文件的 frontmatter
 * 与 skill.ts 的 parseFrontmatter 类似，但返回更通用的 Record 类型
 */
function parseAgentFrontmatter(content: string): { frontmatter: Record<string, string>; content: string } {
  const regex = /^---\s*\n([\s\S]*?)---\s*\n?/;
  const match = content.match(regex);

  if (!match) {
    return { frontmatter: {}, content };
  }

  const frontmatterText = match[1] || '';
  const bodyContent = content.slice(match[0].length);
  const frontmatter: Record<string, string> = {};

  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) {
        // 移除前后的引号
        const cleanValue = value.replace(/^["']|["']$/g, '');
        frontmatter[key] = cleanValue;
      }
    }
  }

  return { frontmatter, content: bodyContent };
}

/**
 * 解析 tools 字段值（逗号分隔或 YAML 数组格式）
 * 对齐官方 Zq1 函数
 */
function parseToolsList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;

  // 逗号分隔
  if (value.includes(',')) {
    return value.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  // 单个值
  if (value.trim()) {
    return [value.trim()];
  }

  return undefined;
}

/**
 * 解析 maxTurns 字段
 */
function parseMaxTurns(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  if (isNaN(n) || n <= 0) return undefined;
  return n;
}

/**
 * 从单个 .md 文件解析自定义 agent 定义
 * 对齐官方 Tv9 函数（user/project agents）和 pF7 函数（plugin agents）
 */
function parseAgentFromFile(
  filePath: string,
  source: 'userSettings' | 'projectSettings' | 'plugin',
  pluginName?: string,
  namePrefixes: string[] = [],
): AgentTypeDefinition | null {
  try {
    const content = fs.readFileSync(filePath, { encoding: 'utf-8' });
    const { frontmatter, content: markdownContent } = parseAgentFrontmatter(content);

    // name 和 description 是必填字段（对齐官方 Tv9 验证）
    const name = frontmatter.name;
    const description = frontmatter.description || frontmatter['when-to-use'];

    if (!name || typeof name !== 'string') {
      console.error(`Agent file ${filePath} is missing required 'name' in frontmatter`);
      return null;
    }

    if (!description || typeof description !== 'string') {
      console.error(`Agent file ${filePath} is missing required 'description' in frontmatter`);
      return null;
    }

    // 构建 agentType 名称
    // - user/project agents: 直接用 name
    // - plugin agents: {pluginName}:{name}（对齐官方命名空间格式）
    let agentType: string;
    if (source === 'plugin' && pluginName) {
      agentType = [pluginName, ...namePrefixes, name].join(':');
    } else {
      agentType = name;
    }

    // 解析可选字段
    const model = frontmatter.model;
    const color = frontmatter.color;
    const memory = frontmatter.memory;
    const forkContextStr = frontmatter.forkContext;
    const permissionMode = frontmatter.permissionMode;
    const maxTurns = parseMaxTurns(frontmatter.maxTurns);
    const tools = parseToolsList(frontmatter.tools);
    const disallowedTools = parseToolsList(frontmatter.disallowedTools);
    const skills = parseToolsList(frontmatter.skills);

    // 验证 model
    const validModel = model && VALID_AGENT_MODELS.includes(model);
    if (model && !validModel) {
      console.error(`Agent file ${filePath} has invalid model '${model}'. Valid options: ${VALID_AGENT_MODELS.join(', ')}`);
    }

    // 验证 memory
    let validMemory: string | undefined;
    if (memory !== undefined) {
      if (VALID_MEMORY_VALUES.includes(memory)) {
        validMemory = memory;
      } else {
        console.error(`Agent file ${filePath} has invalid memory value '${memory}'. Valid options: ${VALID_MEMORY_VALUES.join(', ')}`);
      }
    }

    // 验证 forkContext
    let forkContext = false;
    if (forkContextStr !== undefined) {
      if (forkContextStr === 'true') {
        forkContext = true;
      } else if (forkContextStr !== 'false') {
        console.error(`Agent file ${filePath} has invalid forkContext value '${forkContextStr}'. Must be 'true', 'false', or omitted.`);
      }
    }

    // 官方约束：forkContext: true 的 agent 必须用 model: inherit
    if (forkContext && model !== 'inherit') {
      console.error(`Agent file ${filePath} has forkContext: true but model is not 'inherit'. Overriding to 'inherit'.`);
    }

    // 验证 permissionMode
    const validPermMode = permissionMode && VALID_PERMISSION_MODES.includes(permissionMode);
    if (permissionMode && !validPermMode) {
      console.error(`Agent file ${filePath} has invalid permissionMode '${permissionMode}'. Valid options: ${VALID_PERMISSION_MODES.join(', ')}`);
    }

    // 验证 color
    const validColor = color && VALID_COLORS.includes(color);

    // 解析文件名（不含 .md 后缀）
    const filename = path.basename(filePath, '.md');

    // 系统提示词就是 frontmatter 下方的 markdown 内容
    const systemPromptText = markdownContent.trim();

    // 解析 tools 中的 Task(agent_type) 语法
    let effectiveTools = tools;
    let allowedSubagentTypes: string[] | undefined;
    if (tools) {
      const parsed = parseToolsWithAgentTypeRestriction(tools);
      effectiveTools = parsed.tools;
      allowedSubagentTypes = parsed.allowedSubagentTypes;
    }

    return {
      agentType,
      whenToUse: description.replace(/\\n/g, '\n'),
      ...(effectiveTools !== undefined ? { tools: effectiveTools } : {}),
      ...(allowedSubagentTypes !== undefined ? { allowedSubagentTypes } : {}),
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(skills !== undefined ? { skills } : {}),
      getSystemPrompt: () => systemPromptText,
      source,
      filename,
      ...(validColor ? { color } : {}),
      ...(validModel ? { model } : {}),
      ...(validPermMode ? { permissionMode: permissionMode as any } : {}),
      ...(forkContext ? { forkContext } : {}),
      ...(maxTurns !== undefined ? { maxTurns } : {}),
      ...(validMemory ? { memory: validMemory } : {}),
      ...(pluginName ? { plugin: pluginName } : {}),
    };
  } catch (error) {
    console.error(`Failed to load agent from ${filePath}:`, error);
    return null;
  }
}

/**
 * 从目录递归加载 agent 定义
 * 对齐官方 gF7 函数
 */
function loadAgentsFromDirectory(
  dirPath: string,
  source: 'userSettings' | 'projectSettings' | 'plugin',
  pluginName?: string,
): AgentTypeDefinition[] {
  const results: AgentTypeDefinition[] = [];

  function scan(currentPath: string, prefixes: string[] = []) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath, [...prefixes, entry.name]);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const agent = parseAgentFromFile(fullPath, source, pluginName, prefixes);
          if (agent) {
            results.push(agent);
          }
        }
      }
    } catch (error) {
      // 目录不存在或无权限，静默忽略
    }
  }

  scan(dirPath);
  return results;
}

/**
 * 从已启用的插件缓存中加载 agents
 * 对齐官方 Pq1 函数
 */
function loadAgentsFromPluginCache(): AgentTypeDefinition[] {
  const results: AgentTypeDefinition[] = [];
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const pluginsCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache');

  // 获取已启用的插件列表
  const enabledPlugins = getEnabledPluginsForAgents();

  try {
    if (!fs.existsSync(pluginsCacheDir)) {
      return [];
    }

    const marketplaces = fs.readdirSync(pluginsCacheDir, { withFileTypes: true });
    for (const marketplace of marketplaces) {
      if (!marketplace.isDirectory()) continue;

      const marketplacePath = path.join(pluginsCacheDir, marketplace.name);
      const plugins = fs.readdirSync(marketplacePath, { withFileTypes: true });

      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue;

        // 检查插件是否启用
        const pluginId = `${plugin.name}@${marketplace.name}`;
        if (!enabledPlugins.has(pluginId)) continue;

        const pluginPath = path.join(marketplacePath, plugin.name);
        const versions = fs.readdirSync(pluginPath, { withFileTypes: true });

        for (const version of versions) {
          if (!version.isDirectory()) continue;

          // 检查 agents 目录
          const agentsPath = path.join(pluginPath, version.name, 'agents');
          if (!fs.existsSync(agentsPath)) continue;

          const agents = loadAgentsFromDirectory(agentsPath, 'plugin', plugin.name);
          results.push(...agents);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load agents from plugin cache:', error);
  }

  return results;
}

/**
 * 获取已启用的插件列表（与 skill.ts 中的 getEnabledPlugins 相同逻辑）
 */
function getEnabledPluginsForAgents(): Set<string> {
  const enabledPlugins = new Set<string>();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');

  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, { encoding: 'utf-8' });
      const settings = JSON.parse(content);

      if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
        for (const [pluginId, enabled] of Object.entries(settings.enabledPlugins)) {
          if (enabled === true) {
            enabledPlugins.add(pluginId);
          }
        }
      }
    }
  } catch {
    // 静默忽略
  }

  return enabledPlugins;
}

/**
 * Agent 去重合并（后来者优先覆盖同名）
 * 对齐官方 zp 函数
 */
function deduplicateAgents(agents: AgentTypeDefinition[]): AgentTypeDefinition[] {
  const seen = new Map<string, AgentTypeDefinition>();
  // 按顺序遍历，后面的会覆盖前面的同名 agent
  for (const agent of agents) {
    seen.set(agent.agentType, agent);
  }
  return Array.from(seen.values());
}

/**
 * 初始化加载所有自定义 agents
 * 加载顺序（对齐官方 oc7）：
 * 1. 插件 agents（最低优先级）
 * 2. 用户级 agents（~/.claude/agents/）
 * 3. 项目级 agents（.claude/agents/）（最高优先级）
 */
export function initializeCustomAgents(): void {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const allCustom: AgentTypeDefinition[] = [];

  // 1. 插件 agents
  try {
    const pluginAgents = loadAgentsFromPluginCache();
    allCustom.push(...pluginAgents);
  } catch {
    // 静默
  }

  // 2. 用户级 agents (~/.claude/agents/)
  const userAgentsDir = path.join(homeDir, '.claude', 'agents');
  if (fs.existsSync(userAgentsDir)) {
    const userAgents = loadAgentsFromDirectory(userAgentsDir, 'userSettings');
    allCustom.push(...userAgents);
  }

  // 3. 项目级 agents (.claude/agents/)
  try {
    const cwd = getCurrentCwd();
    const projectAgentsDir = path.join(cwd, '.claude', 'agents');
    if (fs.existsSync(projectAgentsDir)) {
      const projectAgents = loadAgentsFromDirectory(projectAgentsDir, 'projectSettings');
      allCustom.push(...projectAgents);
    }
  } catch {
    // getCurrentCwd 可能在某些上下文中不可用
  }

  customAgentTypes = allCustom;
  customAgentsInitialized = true;
}

/**
 * 获取所有活跃的 agent 定义（内置 + 自定义，去重后）
 * 对齐官方 agentDefinitions.activeAgents
 */
export function getAllActiveAgents(): AgentTypeDefinition[] {
  if (!customAgentsInitialized) {
    initializeCustomAgents();
  }
  return deduplicateAgents([...BUILT_IN_AGENT_TYPES, ...customAgentTypes]);
}

/**
 * 获取所有自定义（非内置）的 agent 定义
 */
export function getCustomAgents(): AgentTypeDefinition[] {
  if (!customAgentsInitialized) {
    initializeCustomAgents();
  }
  return customAgentTypes;
}

/**
 * 重置自定义 agents 缓存（用于测试或热重载）
 */
export function resetCustomAgents(): void {
  customAgentTypes = [];
  customAgentsInitialized = false;
}

// 代理执行历史条目
export interface AgentHistoryEntry {
  timestamp: Date;
  type: 'started' | 'progress' | 'completed' | 'failed' | 'resumed';
  message: string;
  data?: any;
}

// 后台代理管理
export interface BackgroundAgent {
  id: string;
  agentType: string;
  description: string;
  prompt: string;
  model?: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startTime: Date;
  endTime?: Date;
  result?: ToolResult;
  error?: string;
  // 持久化状态
  history: AgentHistoryEntry[];
  intermediateResults: any[];
  currentStep?: number;
  totalSteps?: number;
  workingDirectory?: string;
  metadata?: Record<string, any>;
  // 新增：对话历史
  messages?: Message[];
  // 新增：进度追踪（对齐官方实现）
  progress?: {
    toolUseCount: number;
    tokenCount: number;
  };
  lastActivity?: {
    toolName: string;
    input: any;
  };
}

const backgroundAgents: Map<string, BackgroundAgent> = new Map();

// 定时清理已完成的后台 Agent，防止 Map 无限增长
const AGENT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
let _agentCleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureAgentCleanupTimer(): void {
  if (_agentCleanupTimer) return;
  _agentCleanupTimer = setInterval(() => {
    clearCompletedAgents();
    if (backgroundAgents.size === 0 && _agentCleanupTimer) {
      clearInterval(_agentCleanupTimer);
      _agentCleanupTimer = null;
    }
  }, AGENT_CLEANUP_INTERVAL_MS);
  if (_agentCleanupTimer && typeof _agentCleanupTimer === 'object' && 'unref' in _agentCleanupTimer) {
    _agentCleanupTimer.unref();
  }
}

// 代理持久化目录
const getAgentsDir = (): string => {
  const agentsDir = path.join(os.homedir(), '.claude', 'agents');
  if (!fs.existsSync(agentsDir)) {
    fs.mkdirSync(agentsDir, { recursive: true });
  }
  return agentsDir;
};

const getAgentFilePath = (agentId: string): string => {
  return path.join(getAgentsDir(), `${agentId}.json`);
};

// 持久化函数
const saveAgentState = (agent: BackgroundAgent): void => {
  try {
    const filePath = getAgentFilePath(agent.id);
    const data = {
      ...agent,
      startTime: agent.startTime.toISOString(),
      endTime: agent.endTime?.toISOString(),
      history: agent.history.map(h => ({
        ...h,
        timestamp: h.timestamp.toISOString(),
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to save agent state ${agent.id}:`, error);
  }
};

const loadAgentState = (agentId: string): BackgroundAgent | null => {
  try {
    const filePath = getAgentFilePath(agentId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const agent: BackgroundAgent = {
      ...data,
      startTime: new Date(data.startTime),
      endTime: data.endTime ? new Date(data.endTime) : undefined,
      history: data.history.map((h: any) => ({
        ...h,
        timestamp: new Date(h.timestamp),
      })),
    };
    return agent;
  } catch (error) {
    console.error(`Failed to load agent state ${agentId}:`, error);
    return null;
  }
};

const deleteAgentState = (agentId: string): void => {
  try {
    const filePath = getAgentFilePath(agentId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error(`Failed to delete agent state ${agentId}:`, error);
  }
};

// 加载所有已保存的代理
const loadAllAgents = (): void => {
  try {
    const agentsDir = getAgentsDir();
    const files = fs.readdirSync(agentsDir);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const agentId = file.replace('.json', '');
        const agent = loadAgentState(agentId);
        if (agent) {
          backgroundAgents.set(agentId, agent);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load agents:', error);
  }
};

// 添加历史记录
const addAgentHistory = (
  agent: BackgroundAgent,
  type: AgentHistoryEntry['type'],
  message: string,
  data?: any
): void => {
  agent.history.push({
    timestamp: new Date(),
    type,
    message,
    data,
  });
  saveAgentState(agent);
};

// 导出代理管理函数
export function getBackgroundAgents(): BackgroundAgent[] {
  return Array.from(backgroundAgents.values());
}

export function getBackgroundAgent(id: string): BackgroundAgent | undefined {
  let agent = backgroundAgents.get(id);

  // 如果内存中没有，尝试从磁盘加载
  if (!agent) {
    const loaded = loadAgentState(id);
    if (loaded) {
      backgroundAgents.set(id, loaded);
      agent = loaded;
    }
  }

  return agent;
}

export function killBackgroundAgent(id: string): boolean {
  const agent = backgroundAgents.get(id);
  if (!agent) return false;

  if (agent.status === 'running') {
    agent.status = 'failed';
    agent.error = 'Killed by user';
    agent.endTime = new Date();
    addAgentHistory(agent, 'failed', 'Agent killed by user');
  }
  return true;
}

export function clearCompletedAgents(): number {
  let cleared = 0;
  const entries = Array.from(backgroundAgents.entries());
  for (const [id, agent] of entries) {
    if (agent.status === 'completed' || agent.status === 'failed') {
      backgroundAgents.delete(id);
      deleteAgentState(id);
      cleared++;
    }
  }
  return cleared;
}

export function pauseBackgroundAgent(id: string): boolean {
  const agent = backgroundAgents.get(id);
  if (!agent) return false;

  if (agent.status === 'running') {
    agent.status = 'paused';
    addAgentHistory(agent, 'progress', 'Agent paused');
    return true;
  }
  return false;
}

// 获取代理类型定义（搜索内置 + 自定义 agents）
export function getAgentTypeDefinition(agentType: string): AgentTypeDefinition | null {
  // 先搜索所有活跃 agents（去重后，自定义优先覆盖同名内置）
  const allActive = getAllActiveAgents();
  return allActive.find(def => def.agentType === agentType) || null;
}

// 初始化时加载所有代理
loadAllAgents();

/**
 * 生成后台任务相关提示文本（条件性）
 * 根据 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS 环境变量决定是否显示
 */
function getAgentBackgroundTasksPrompt(): string {
  if (isBackgroundTasksDisabled()) {
    return '';
  }
  return `
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will need to use TaskOutput to retrieve its results once it's done. You can continue to work while background agents run - When you need their results to continue you can use TaskOutput in blocking mode to pause and wait for their results.`;
}

export class TaskTool extends BaseTool<AgentInput, ToolResult> {
  name = 'Task';

  /**
   * 动态生成 description，包含所有活跃的 agents（内置 + 自定义）
   */
  get description(): string {
    const allAgents = getAllActiveAgents();
    const agentList = allAgents.map(def =>
      `- ${def.agentType}: ${def.whenToUse}${def.forkContext ? ' (Properties: access to current context)' : ''} (Tools: ${def.tools?.join(', ') || '*'})${def.model ? ` (Model: ${formatAgentModel(def.model)})` : ''}`
    ).join('\n');

    return `Launch a new agent to handle complex, multi-step tasks autonomously.

The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
${agentList}

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Grep tool instead of the Task tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Grep tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Task tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.${getAgentBackgroundTasksPrompt()}
- Agents can be resumed using the \`resume\` parameter by passing the agent ID from a previous invocation. When resumed, the agent continues with its full previous context preserved. When NOT resuming, each invocation starts fresh and you should provide a detailed task description with all necessary context.
- When the agent is done, it will return a single message back to you along with its agent ID. You can use this ID to resume the agent later if needed for follow-up work.
- Provide clear, detailed prompts so the agent can work autonomously and return exactly the information you need.
- Agents with "access to current context" can see the full conversation history before the tool call. When using these agents, you can write concise prompts that reference earlier context (e.g., "investigate the error discussed above") instead of repeating information. The agent will receive all prior messages and understand the context.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Task tool use content blocks. For example, if you need to launch both a code-reviewer agent and a test-runner agent in parallel, send a single message with both tool calls.

Example usage:

<example_agent_descriptions>
"code-reviewer": use this agent after you are done writing a signficant piece of code
"greeting-responder": use this agent when to respond to user greetings with a friendly joke
</example_agent_description>

<example>
user: "Please write a function that checks if a number is prime"
assistant: Sure let me write a function that checks if a number is prime
assistant: First let me use the Write tool to write a function that checks if a number is prime
assistant: I'm going to use the Write tool to write the following code:
<code>
function isPrime(n) {
  if (n <= 1) return false
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false
  }
  return true
}
</code>
<commentary>
Since a signficant piece of code was written and the task was completed, now use the code-reviewer agent to review the code
</commentary>
assistant: Now let me use the code-reviewer agent to review the code
assistant: Uses the Task tool to launch the code-reviewer agent
</example>

<example>
user: "Hello"
<commentary>
Since the user is greeting, use the greeting-responder agent to respond with a friendly joke
</commentary>
assistant: "I'm going to use the Task tool to launch the greeting-responder agent"
</example>

${!isAgentTeamsEnabled() ? `\nNote: The "Agent Teams" feature (TeammateTool, SendMessage, spawnTeam) is not available on this plan. Only mention this if the user explicitly asks for "agent teams" by name, or asks for agents to send messages to each other (peer-to-peer messaging). Do NOT mention this limitation when users ask for parallel subagents, coordinating agents, launching a "team" of agents, or having agents work together — those are all normal Task tool usage and you should proceed normally.` : ''}`;
  }

  // 父对话上下文（用于 forkContext）
  private parentMessages: Message[] = [];

  /**
   * v2.1.33: 限制可生成的子 agent 类型
   * 当从 frontmatter 的 tools 字段中解析出 Task(agent_type) 语法时设置
   * null 表示无限制
   */
  private _allowedSubagentTypes: string[] | undefined = undefined;

  /**
   * 设置允许的子 agent 类型
   */
  setAllowedSubagentTypes(types: string[] | undefined): void {
    this._allowedSubagentTypes = types;
  }

  /**
   * 获取当前的子 agent 类型限制
   */
  getAllowedSubagentTypes(): string[] | undefined {
    return this._allowedSubagentTypes;
  }

  /**
   * 设置父对话上下文（在 Loop 中调用）
   */
  setParentContext(messages: Message[]): void {
    this.parentMessages = messages;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short (3-5 word) description of the task',
        },
        prompt: {
          type: 'string',
          description: 'The task for the agent to perform',
        },
        subagent_type: {
          type: 'string',
          description: 'The type of specialized agent to use for this task',
        },
        model: {
          type: 'string',
          enum: ['sonnet', 'opus', 'haiku', 'inherit'],
          description: 'Optional model to use for this agent. Use "inherit" to explicitly inherit from parent. If not specified, inherits from parent. Prefer haiku for quick, straightforward tasks to minimize cost and latency.',
        },
        resume: {
          type: 'string',
          description: 'Optional agent ID to resume from. If provided, the agent will continue from the previous execution transcript.',
        },
        run_in_background: {
          type: 'boolean',
          description: 'Set to true to run this agent in the background. Use TaskOutput to read the output later.',
        },
        max_turns: {
          type: 'number',
          description: 'Maximum number of agentic turns (API round-trips) before stopping.',
        },
        name: {
          type: 'string',
          description: 'Agent name for identification within a team (Agent Teams feature).',
        },
        team_name: {
          type: 'string',
          description: 'Team name for Agent Teams collaboration (requires CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1).',
        },
        mode: {
          type: 'string',
          enum: ['acceptEdits', 'bypassPermissions', 'default', 'delegate', 'dontAsk', 'plan'],
          description: 'Permission mode for the agent.',
        },
      },
      required: ['description', 'prompt', 'subagent_type'],
    };
  }

  async execute(input: AgentInput): Promise<ToolResult> {
    const { description, prompt, subagent_type, model, resume, run_in_background,
            max_turns, name: agentName, team_name, mode } = input;

    // 验证代理类型
    const agentDef = getAgentTypeDefinition(subagent_type);
    if (!agentDef) {
      return {
        success: false,
        error: t('agent.unknownType', { type: subagent_type, available: getAllActiveAgents().map(d => d.agentType).join(', ') }),
      };
    }

    // v2.1.33: 检查子 agent 类型限制
    // 当父 agent 通过 Task(agent_type) 语法限制了允许的子 agent 类型时
    // 在这里进行验证，不允许生成未授权的 agent 类型
    if (this._allowedSubagentTypes && this._allowedSubagentTypes.length > 0) {
      if (!this._allowedSubagentTypes.includes(subagent_type)) {
        return {
          success: false,
          error: t('agent.typeNotAllowed', { type: subagent_type, allowed: this._allowedSubagentTypes.join(', ') }),
        };
      }
    }

    // Resume 模式
    if (resume) {
      return this.resumeAgent(resume, run_in_background);
    }

    // 新建代理模式
    const agentId = uuidv4();
    const agent: BackgroundAgent = {
      id: agentId,
      agentType: subagent_type,
      description,
      prompt,
      model,
      status: 'running',
      startTime: new Date(),
      history: [],
      intermediateResults: [],
      currentStep: 0,
      workingDirectory: getCurrentCwd(),
      metadata: {
        // v2.1.32: Agent Teams 元数据
        ...(agentName && { agentName }),
        ...(team_name && { teamName: team_name }),
        ...(mode && { permissionMode: mode }),
        ...(max_turns && { maxTurns: max_turns }),
      },
      messages: [],
    };

    // 添加启动历史
    addAgentHistory(agent, 'started', `Agent started with type ${subagent_type}`);

    // 保存到内存和磁盘
    backgroundAgents.set(agentId, agent);
    saveAgentState(agent);
    ensureAgentCleanupTimer();

    if (run_in_background) {
      // 后台执行 - 不阻塞，立即返回
      this.executeAgentInBackground(agent, agentDef);

      return {
        success: true,
        output: t('agent.backgroundStarted', { id: agentId }),
      };
    }

    // 同步执行 - 阻塞直到完成
    const result = await this.executeAgentSync(agent, agentDef);
    return result;
  }

  /**
   * 恢复已有代理
   */
  private async resumeAgent(agentId: string, runInBackground?: boolean): Promise<ToolResult> {
    const existingAgent = getBackgroundAgent(agentId);

    if (!existingAgent) {
      return {
        success: false,
        error: t('agent.notFound', { id: agentId }),
      };
    }

    // 检查代理状态是否可以恢复
    if (existingAgent.status === 'completed') {
      return {
        success: false,
        error: t('agent.alreadyCompleted', { id: agentId }),
        output: `Agent result:\n${JSON.stringify(existingAgent.result, null, 2)}`,
      };
    }

    if (existingAgent.status === 'running') {
      return {
        success: false,
        error: t('agent.stillRunning', { id: agentId }),
      };
    }

    // 恢复代理执行
    existingAgent.status = 'running';
    addAgentHistory(existingAgent, 'resumed', `Agent resumed from step ${existingAgent.currentStep || 0}`);

    const agentDef = getAgentTypeDefinition(existingAgent.agentType);
    if (!agentDef) {
      return {
        success: false,
        error: t('agent.typeNotFoundForResume', { type: existingAgent.agentType }),
      };
    }

    const resumeInfo = [
      `Resuming agent ${agentId}`,
      `Type: ${existingAgent.agentType}`,
      `Description: ${existingAgent.description}`,
      `Original prompt: ${existingAgent.prompt}`,
      `Current step: ${existingAgent.currentStep || 0}/${existingAgent.totalSteps || 'unknown'}`,
      `\nExecution history:`,
      ...existingAgent.history.map(h =>
        `  [${h.timestamp.toISOString()}] ${h.type}: ${h.message}`
      ),
    ];

    if (existingAgent.intermediateResults.length > 0) {
      resumeInfo.push('\nIntermediate results:');
      existingAgent.intermediateResults.forEach((result, idx) => {
        resumeInfo.push(`  Step ${idx + 1}: ${JSON.stringify(result).substring(0, 100)}...`);
      });
    }

    if (runInBackground) {
      // 后台恢复执行
      this.executeAgentInBackground(existingAgent, agentDef);

      return {
        success: true,
        output: resumeInfo.join('\n') + '\n\nAgent resumed in background.',
      };
    }

    // 同步恢复执行
    const result = await this.executeAgentSync(existingAgent, agentDef);
    return result;
  }

  /**
   * 后台执行代理（异步，不阻塞）
   */
  private executeAgentInBackground(agent: BackgroundAgent, agentDef: AgentTypeDefinition): void {
    // 使用 Promise 在后台执行，捕获错误
    this.executeAgentLoop(agent, agentDef)
      .then(() => {
        // 执行完成
        agent.status = 'completed';
        agent.endTime = new Date();
        addAgentHistory(agent, 'completed', 'Agent completed successfully');
        saveAgentState(agent);

        // v2.1.7: 发送代理完成通知，包含内联结果显示
        this.sendAgentCompletionNotification(agent);
      })
      .catch((error) => {
        // 执行失败
        agent.status = 'failed';
        agent.error = error instanceof Error ? error.message : String(error);
        agent.endTime = new Date();
        addAgentHistory(agent, 'failed', `Agent failed: ${agent.error}`);
        saveAgentState(agent);

        // v2.1.7: 发送代理失败通知
        this.sendAgentCompletionNotification(agent);
      });
  }

  /**
   * 同步执行代理（阻塞直到完成）
   */
  private async executeAgentSync(agent: BackgroundAgent, agentDef: AgentTypeDefinition): Promise<ToolResult> {
    try {
      await this.executeAgentLoop(agent, agentDef);

      agent.status = 'completed';
      agent.endTime = new Date();

      // v2.1.30: 构建结果输出，包含 token/工具使用/时长指标
      // 对应官方实现 (cli.js 行2941-2944)
      const durationMs = agent.endTime.getTime() - agent.startTime.getTime();
      const output = agent.result?.output || `Agent ${agent.agentType} completed: ${agent.description}`;
      const totalTokens = agent.progress?.tokenCount || 0;
      const toolUses = agent.progress?.toolUseCount || 0;

      agent.result = {
        success: true,
        output: `${output}\n\nagentId: ${agent.id} (for resuming to continue this agent's work if needed)\n<usage>total_tokens: ${totalTokens}\ntool_uses: ${toolUses}\nduration_ms: ${durationMs}</usage>`,
      };

      addAgentHistory(agent, 'completed', 'Agent execution completed');
      saveAgentState(agent);

      return agent.result;
    } catch (error) {
      agent.status = 'failed';
      agent.error = error instanceof Error ? error.message : String(error);
      agent.endTime = new Date();

      addAgentHistory(agent, 'failed', `Agent failed: ${agent.error}`);
      saveAgentState(agent);

      return {
        success: false,
        error: `Agent execution failed: ${agent.error}`,
      };
    }
  }

  /**
   * 真实的代理执行循环（核心逻辑）
   * 参照官方 B4A 函数实现
   */
  private async executeAgentLoop(agent: BackgroundAgent, agentDef: AgentTypeDefinition): Promise<void> {
    // 调用 SubagentStart Hook - 注意参数顺序是 (id, agentType)
    await runSubagentStartHooks(agent.id, agent.agentType);

    try {
      // 构建代理的初始消息
      let initialMessages: Message[] = [];

      // 如果代理支持 forkContext，添加父对话历史
      if (agentDef.forkContext && this.parentMessages.length > 0) {
        // 只包含用户和助手的消息，过滤掉工具调用相关内容
        initialMessages = this.parentMessages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content :
                     Array.isArray(msg.content) ? msg.content.filter(block => block.type === 'text') : [],
          }));
      }

      // 如果是恢复模式，使用已有的消息历史
      if (agent.messages && agent.messages.length > 0) {
        initialMessages = agent.messages;
      }

      // 添加当前任务提示
      initialMessages.push({
        role: 'user',
        content: agent.prompt,
      });

      // 解析模型参数，支持 inherit 继承
      const resolvedModel = resolveAgentModel(agent.model, agentDef.model);

      // 从配置管理器获取完整配置（包括环境变量）
      const { configManager } = await import('../config/index.js');
      const config = configManager.getAll();

      // 类型断言：确保 TypeScript 正确识别配置类型
      const fallbackModel = config.fallbackModel as string | undefined;
      const debug = config.debug as boolean | undefined;

      // v2.1.33: 解析 tools 字段中的 Task(agent_type) 语法
      let effectiveTools = agentDef.tools;
      let childAllowedSubagentTypes = agentDef.allowedSubagentTypes;

      if (effectiveTools && !childAllowedSubagentTypes) {
        // 如果 tools 中包含 Task(xxx) 语法但还没被解析
        const parsed = parseToolsWithAgentTypeRestriction(effectiveTools);
        effectiveTools = parsed.tools;
        childAllowedSubagentTypes = parsed.allowedSubagentTypes;
      }

      // 构建 LoopOptions
      const loopOptions: LoopOptions = {
        model: resolvedModel,
        maxTurns: 30,  // 限制最大轮次以避免无限循环
        verbose: process.env.CLAUDE_VERBOSE === 'true',
        permissionMode: agentDef.permissionMode || 'default',
        // 根据代理定义限制工具访问
        allowedTools: effectiveTools,
        workingDir: agent.workingDirectory,
        // 使用代理定义的系统提示词
        systemPrompt: agentDef.getSystemPrompt?.(),
        // 传递 Extended Thinking 配置
        thinking: config.thinking,
        // 传递回退模型配置
        fallbackModel,
        // 传递调试配置
        debug,
        // 标记为 sub-agent，防止覆盖全局父模型上下文
        isSubAgent: true,
        // v2.1.30: 传递 MCP 工具（空数组，子代理通过 ToolRegistry 单例访问 MCP 工具）
        mcpTools: [],
        // v2.1.33: 传递子 agent 类型限制
        allowedSubagentTypes: childAllowedSubagentTypes,
      };

      // 创建子对话循环（动态导入避免循环依赖）
      const { ConversationLoop } = await import('../core/loop.js');
      const loop = new ConversationLoop(loopOptions);

      // 如果有初始消息上下文（forkContext），需要注入到session中
      if (initialMessages.length > 1) { // >1 因为至少会有当前任务提示
        // 获取session并注入初始消息（除了最后一条当前任务提示）
        const session = loop.getSession();
        const contextMessages = initialMessages.slice(0, -1);
        for (const msg of contextMessages) {
          session.addMessage(msg);
        }
      }

      // 执行代理任务（使用 streaming API 以支持长时间运行的操作）
      // 根据 Anthropic SDK 要求，超过10分钟的操作必须使用 streaming
      let response = '';

      // 初始化进度追踪（对齐官方实现）
      if (!agent.progress) {
        agent.progress = {
          toolUseCount: 0,
          tokenCount: 0
        };
      }

      for await (const event of loop.processMessageStream(agent.prompt)) {
        if (event.type === 'text' && event.content) {
          response += event.content;
          // 更新token计数（粗略估计，1 word ≈ 1.3 tokens）
          agent.progress.tokenCount += Math.ceil(event.content.split(/\s+/).length * 1.3);
          saveAgentState(agent);
        } else if (event.type === 'tool_start') {
          // 追踪工具使用（对齐官方实现）
          agent.progress.toolUseCount++;
          agent.lastActivity = {
            toolName: event.toolName || 'unknown',
            input: event.toolInput
          };
          saveAgentState(agent);
        } else if (event.type === 'tool_end') {
          // 工具执行完成，更新状态
          saveAgentState(agent);
        } else if (event.type === 'done') {
          // Stream 完成
          break;
        } else if (event.type === 'interrupted') {
          // 如果被中断，记录状态
          throw new Error('Agent execution was interrupted');
        }
      }

      // 保存结果
      agent.result = {
        success: true,
        output: response,
      };

      // 保存对话历史以支持恢复
      agent.messages = initialMessages;

      // 调用 SubagentStop Hook - 注意参数顺序是 (id, agentType, result)
      await runSubagentStopHooks(agent.id, agent.agentType);

    } catch (error) {
      // 即使失败也要调用 SubagentStop Hook - 注意参数顺序是 (id, agentType, result)
      await runSubagentStopHooks(agent.id, agent.agentType);

      throw error;
    }
  }

  /**
   * 发送代理完成通知（v2.1.7 功能）
   * 在代理执行完成后发送通知，包含内联的最终响应摘要
   */
  private sendAgentCompletionNotification(agent: BackgroundAgent): void {
    // 计算执行时长
    const duration = agent.endTime && agent.startTime
      ? agent.endTime.getTime() - agent.startTime.getTime()
      : undefined;

    // 获取代理状态
    const status: AgentCompletionResult['status'] =
      agent.status === 'completed' ? 'completed' :
      agent.status === 'failed' ? 'failed' : 'killed';

    // 获取结果内容
    const result = agent.result?.output || agent.error;

    // 生成结果摘要（v2.1.6: 限制为最多3行）
    let resultSummary: string | undefined;
    if (result) {
      // 移除多余空白行，提取有意义的内容，并限制为最多3行
      const cleanedResult = result
        .split('\n')
        .filter((line: string) => line.trim())
        .slice(0, 3)  // v2.1.6: 限制为最多3行
        .join('\n')
        .trim();
      // 如果原始内容超过3行，添加省略号
      const originalLineCount = result.split('\n').filter((line: string) => line.trim()).length;
      const needsEllipsis = originalLineCount > 3;
      resultSummary = cleanedResult.length > 500
        ? cleanedResult.substring(0, 497) + '...'
        : needsEllipsis
          ? cleanedResult + '\n...'
          : cleanedResult;
    }

    // 获取转录文件路径
    const transcriptPath = getAgentFilePath(agent.id);

    // 发送通知
    notificationManager.notifyAgentCompletion({
      agentId: agent.id,
      agentType: agent.agentType,
      description: agent.description,
      status,
      result,
      resultSummary,
      duration,
      transcriptPath,
    });
  }
}

export class TaskOutputTool extends BaseTool<{ task_id: string; block?: boolean; timeout?: number; show_history?: boolean }, ToolResult> {
  name = 'TaskOutput';
  description = `Get output and status from a background task (Agent or Bash).

Usage notes:
- Supports both Agent tasks and Bash background shells
- Use block parameter to wait for task completion
- Use show_history to see detailed execution history (Agent only)
- Agent state is automatically persisted and can be resumed`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID to get output from',
        },
        block: {
          type: 'boolean',
          description: 'Whether to wait for completion',
        },
        timeout: {
          type: 'number',
          description: 'Max wait time in ms',
        },
        show_history: {
          type: 'boolean',
          description: 'Show detailed execution history (extension: not in official SDK)',
        },
      },
      required: ['task_id'],
    };
  }

  async execute(input: { task_id: string; block?: boolean; timeout?: number; show_history?: boolean }): Promise<ToolResult> {
    // 检查是否是 Bash shell ID
    if (isShellId(input.task_id)) {
      const shell = getBackgroundShell(input.task_id);
      if (shell) {
        // 内存中找到 → 正常处理
        return this.handleBashTask(input.task_id, shell, input.block, input.timeout);
      }

      // 内存中没有 → fallback 到磁盘（进程重启后的恢复路径）
      const meta = loadTaskMeta(input.task_id);
      if (meta) {
        return this.handleBashTaskFromDisk(input.task_id, meta);
      }

      return { success: false, error: `Task ${input.task_id} not found` };
    }

    // 处理 Agent 任务
    const agent = getBackgroundAgent(input.task_id);
    if (!agent) {
      return { success: false, error: `Task ${input.task_id} not found` };
    }

    if (input.block && agent.status === 'running') {
      // 等待完成
      const timeout = input.timeout || 5000;
      const startTime = Date.now();

      while (agent.status === 'running' && Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
        // 重新加载代理状态以获取最新进度
        const updatedAgent = getBackgroundAgent(input.task_id);
        if (updatedAgent && updatedAgent.status !== 'running') {
          break;
        }
      }
    }

    // 构建输出信息
    const output = [];
    output.push(`=== Agent ${input.task_id} ===`);
    output.push(`Type: ${agent.agentType}`);
    output.push(`Status: ${agent.status}`);
    output.push(`Description: ${agent.description}`);
    output.push(`Started: ${agent.startTime.toISOString()}`);

    if (agent.endTime) {
      const duration = agent.endTime.getTime() - agent.startTime.getTime();
      output.push(`Ended: ${agent.endTime.toISOString()}`);
      output.push(`Duration: ${(duration / 1000).toFixed(2)}s`);
    }

    if (agent.currentStep !== undefined && agent.totalSteps !== undefined) {
      output.push(`Progress: ${agent.currentStep}/${agent.totalSteps} steps`);
    }

    // 显示进度追踪（对齐官方实现）
    if (agent.progress) {
      output.push(`Tools used: ${agent.progress.toolUseCount}`);
      output.push(`Tokens: ${agent.progress.tokenCount}`);
    }

    if (agent.lastActivity) {
      output.push(`Last tool: ${agent.lastActivity.toolName}`);
    }

    if (agent.workingDirectory) {
      output.push(`Working Directory: ${agent.workingDirectory}`);
    }

    // 显示执行历史
    if (input.show_history && agent.history.length > 0) {
      output.push('\n=== Execution History ===');
      agent.history.forEach((entry, idx) => {
        const timestamp = entry.timestamp.toISOString();
        output.push(`${idx + 1}. [${timestamp}] ${entry.type.toUpperCase()}: ${entry.message}`);
        if (entry.data) {
          output.push(`   Data: ${JSON.stringify(entry.data)}`);
        }
      });
    }

    // 显示中间结果
    if (agent.intermediateResults.length > 0) {
      output.push('\n=== Intermediate Results ===');
      agent.intermediateResults.forEach((result, idx) => {
        output.push(`Step ${idx + 1}:`);
        output.push(`  ${JSON.stringify(result, null, 2)}`);
      });
    }

    // 显示最终结果或错误
    if (agent.status === 'completed' && agent.result) {
      output.push('\n=== Final Result ===');
      output.push(agent.result.output || 'No output');
    } else if (agent.status === 'failed' && agent.error) {
      output.push('\n=== Error ===');
      output.push(agent.error);
    } else if (agent.status === 'running') {
      output.push('\n=== Status ===');
      output.push('Agent is still running. Use block=true to wait for completion.');
      output.push(`Use resume parameter with agent ID ${agent.id} to continue if interrupted.`);
    } else if (agent.status === 'paused') {
      output.push('\n=== Status ===');
      output.push('Agent is paused.');
      output.push(`Use resume parameter with agent ID ${agent.id} to continue execution.`);
    }

    return {
      success: true,
      output: output.join('\n'),
    };
  }

  /**
   * 处理 Bash 后台任务
   */
  private async handleBashTask(
    taskId: string,
    shell: any,
    block?: boolean,
    timeout?: number
  ): Promise<ToolResult> {
    // 如果需要阻塞等待完成
    if (block && shell.status === 'running') {
      const maxTimeout = timeout || 30000;
      const startTime = Date.now();

      while (shell.status === 'running' && Date.now() - startTime < maxTimeout) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        // 重新获取 shell 状态
        const updatedShell = getBackgroundShell(taskId);
        if (updatedShell && updatedShell.status !== 'running') {
          break;
        }
      }

      if (shell.status === 'running') {
        // 超时但仍在运行
        return {
          success: true,
          output: t('agent.bashTaskTimeout', { id: taskId, timeout: maxTimeout }),
        };
      }
    }

    // 构建输出信息
    const output = [];
    output.push(`=== Bash Task ${taskId} ===`);
    output.push(`Command: ${shell.command}`);
    output.push(`Status: ${shell.status}`);
    output.push(`Started: ${new Date(shell.startTime).toISOString()}`);

    const duration = Date.now() - shell.startTime;
    if (shell.endTime) {
      output.push(`Ended: ${new Date(shell.endTime).toISOString()}`);
      output.push(`Duration: ${((shell.endTime - shell.startTime) / 1000).toFixed(2)}s`);
    } else {
      output.push(`Duration: ${(duration / 1000).toFixed(2)}s (running)`);
    }

    if (shell.exitCode !== undefined) {
      output.push(`Exit Code: ${shell.exitCode}`);
    }

    output.push(`Output File: ${shell.outputFile}`);

    // 读取输出
    const shellOutput = shell.output.join('');
    if (shellOutput.trim()) {
      output.push('\n=== Output ===');
      output.push(shellOutput);
    } else {
      output.push('\n=== Output ===');
      output.push('(no output yet)');
    }

    if (shell.status === 'completed') {
      output.push('\n=== Status ===');
      output.push('Command completed successfully.');
    } else if (shell.status === 'failed') {
      output.push('\n=== Status ===');
      output.push(`Command failed with exit code ${shell.exitCode}.`);
    } else if (shell.status === 'running') {
      output.push('\n=== Status ===');
      output.push('Command is still running. Use block=true to wait for completion.');
    }

    return {
      success: true,
      output: output.join('\n'),
    };
  }

  /**
   * 从磁盘元数据恢复后台任务信息（进程重启后的 fallback 路径）
   * 进程重启后内存中的 backgroundTasks Map 已清空，但 .meta.json 和 .log 文件仍在磁盘上
   */
  private async handleBashTaskFromDisk(
    taskId: string,
    meta: { command: string; startTime: number; outputFile: string; status: string; endTime?: number; exitCode?: number }
  ): Promise<ToolResult> {
    const output: string[] = [];
    output.push(`=== Bash Task ${taskId} (recovered from disk) ===`);
    output.push(`Command: ${meta.command}`);
    output.push(`Status: ${meta.status}`);
    output.push(`Started: ${new Date(meta.startTime).toISOString()}`);

    if (meta.endTime) {
      output.push(`Ended: ${new Date(meta.endTime).toISOString()}`);
      output.push(`Duration: ${((meta.endTime - meta.startTime) / 1000).toFixed(2)}s`);
    }

    if (meta.exitCode !== undefined) {
      output.push(`Exit Code: ${meta.exitCode}`);
    }

    output.push(`Output File: ${meta.outputFile}`);

    // 读取 .log 文件内容
    const logPath = meta.outputFile || getTaskOutputPath(taskId);
    try {
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf-8');
        if (logContent.trim()) {
          output.push('\n=== Output ===');
          // 截断过长的输出
          const maxLen = 30000;
          if (logContent.length > maxLen) {
            output.push(logContent.substring(0, maxLen));
            output.push(`\n[Output truncated, full output in ${logPath}]`);
          } else {
            output.push(logContent);
          }
        } else {
          output.push('\n=== Output ===');
          output.push('(no output)');
        }
      } else {
        output.push('\n=== Output ===');
        output.push('(output file not found)');
      }
    } catch {
      output.push('\n=== Output ===');
      output.push('(failed to read output file)');
    }

    // 状态信息
    if (meta.status === 'running') {
      output.push('\nNote: This task was running when the process restarted. The background process may have been terminated.');
    }

    return {
      success: true,
      output: output.join('\n'),
    };
  }
}

