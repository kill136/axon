/**
 * 插件系统
 * 支持加载和管理第三方插件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import type { ToolDefinition, ToolResult } from '../types/index.js';

// ============ 插件上下文 ============

/**
 * 插件上下文 - 提供给插件的 API 和资源
 */
export interface PluginContext {
  // 插件信息
  pluginName: string;
  pluginPath: string;

  // 配置管理
  config: PluginConfigAPI;

  // 日志API
  logger: PluginLogger;

  // 文件系统访问（受限）
  fs: PluginFileSystemAPI;

  // 工具注册
  tools: PluginToolAPI;

  // 命令注册
  commands: PluginCommandAPI;

  // Skills/Prompts 注册
  skills: PluginSkillAPI;

  // 钩子注册
  hooks: PluginHookAPI;

  // 事件系统
  events: EventEmitter;
}

export interface PluginConfigAPI {
  get<T = unknown>(key: string, defaultValue?: T): T | undefined;
  set(key: string, value: unknown): Promise<void>;
  getAll(): Record<string, unknown>;
  has(key: string): boolean;
  delete(key: string): Promise<void>;
}

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface PluginFileSystemAPI {
  // 只允许在插件目录内操作
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, content: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  readdir(relativePath?: string): Promise<string[]>;
}

export interface PluginToolAPI {
  register(tool: ToolDefinition): void;
  unregister(toolName: string): void;
  getRegistered(): ToolDefinition[];
}

export interface PluginCommandAPI {
  register(command: CommandDefinition): void;
  unregister(commandName: string): void;
  getRegistered(): CommandDefinition[];
}

export interface PluginSkillAPI {
  register(skill: SkillDefinition): void;
  unregister(skillName: string): void;
  getRegistered(): SkillDefinition[];
}

export interface PluginHookAPI {
  on(hookType: PluginHookType, handler: HookHandler): void;
  off(hookType: PluginHookType, handler: HookHandler): void;
  getRegistered(): Array<{ type: PluginHookType; handler: HookHandler }>;
}

// ============ 插件定义 ============

/**
 * 插件元数据
 */
export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  main?: string;
  engines?: {
    node?: string;
    'claude-code'?: string;
  };
  dependencies?: Record<string, string>; // 依赖的其他插件
  peerDependencies?: Record<string, string>; // 可选的对等依赖
}

/**
 * 命令定义
 */
export interface CommandDefinition {
  name: string;
  description: string;
  usage?: string;
  examples?: string[];
  execute: (args: string[], context: PluginContext) => Promise<void>;
}

/**
 * Skill/Prompt 定义
 * Skills 是插件提供的可被用户调用的提示词或功能
 */
export interface SkillDefinition {
  name: string; // 技能名称，用户通过 /skill-name 调用
  description: string; // 技能描述
  prompt: string; // 提示词内容
  category?: string; // 分类（如：coding, writing, analysis）
  examples?: string[]; // 使用示例
  parameters?: Array<{
    name: string;
    description: string;
    required?: boolean;
    type?: string;
  }>; // 参数定义
}

/**
 * 插件钩子类型（Plugin 内部使用）
 */
export type PluginHookType =
  | 'beforeMessage'
  | 'afterMessage'
  | 'beforeToolCall'
  | 'afterToolCall'
  | 'onError'
  | 'onSessionStart'
  | 'onSessionEnd'
  | 'onPluginLoad'
  | 'onPluginUnload';

/**
 * 钩子处理器
 */
export type HookHandler<T = unknown> = (context: T) => Promise<T | void> | T | void;

/**
 * 钩子定义
 */
export interface HookDefinition {
  type: PluginHookType;
  handler: HookHandler;
  priority?: number; // 优先级，数字越小越先执行
}

/**
 * 插件接口
 */
export interface Plugin {
  metadata: PluginMetadata;

  // 生命周期钩子
  init?(context: PluginContext): Promise<void>;
  activate?(context: PluginContext): Promise<void>;
  deactivate?(): Promise<void>;

  // 插件提供的功能
  tools?: ToolDefinition[];
  commands?: CommandDefinition[];
  skills?: SkillDefinition[];
  hooks?: HookDefinition[];
}

// ============ 插件状态 ============

/**
 * 插件状态
 */
export interface PluginState {
  metadata: PluginMetadata;
  path: string;
  enabled: boolean;
  loaded: boolean;
  initialized: boolean;
  activated: boolean;
  error?: string;
  loadTime?: number;
  lastReloadTime?: number;
  dependencies: string[]; // 解析后的依赖列表
  dependents: string[]; // 依赖此插件的其他插件
}

/**
 * 插件配置
 */
export interface PluginConfig {
  enabled?: boolean;
  autoLoad?: boolean;
  config?: Record<string, unknown>;
}

// ============ 版本检查工具 ============

/**
 * 简化的 semver 版本比较
 */
class VersionChecker {
  /**
   * 检查版本是否满足范围要求
   * 支持: ^1.0.0, ~1.0.0, >=1.0.0, 1.0.0, *
   */
  static satisfies(version: string, range: string): boolean {
    if (range === '*' || range === 'latest') return true;

    const v = this.parseVersion(version);
    if (!v) return false;

    // 精确匹配
    if (!range.match(/[~^><=]/)) {
      return version === range;
    }

    // ^1.0.0 - 兼容主版本
    if (range.startsWith('^')) {
      const r = this.parseVersion(range.slice(1));
      if (!r) return false;
      return v.major === r.major && this.compareVersion(v, r) >= 0;
    }

    // ~1.0.0 - 兼容次版本
    if (range.startsWith('~')) {
      const r = this.parseVersion(range.slice(1));
      if (!r) return false;
      return v.major === r.major && v.minor === r.minor && v.patch >= r.patch;
    }

    // >=1.0.0
    if (range.startsWith('>=')) {
      const r = this.parseVersion(range.slice(2));
      if (!r) return false;
      return this.compareVersion(v, r) >= 0;
    }

    // >1.0.0
    if (range.startsWith('>')) {
      const r = this.parseVersion(range.slice(1));
      if (!r) return false;
      return this.compareVersion(v, r) > 0;
    }

    // <=1.0.0
    if (range.startsWith('<=')) {
      const r = this.parseVersion(range.slice(2));
      if (!r) return false;
      return this.compareVersion(v, r) <= 0;
    }

    // <1.0.0
    if (range.startsWith('<')) {
      const r = this.parseVersion(range.slice(1));
      if (!r) return false;
      return this.compareVersion(v, r) < 0;
    }

    return false;
  }

  private static parseVersion(version: string): { major: number; minor: number; patch: number } | null {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  }

  private static compareVersion(
    v1: { major: number; minor: number; patch: number },
    v2: { major: number; minor: number; patch: number }
  ): number {
    if (v1.major !== v2.major) return v1.major - v2.major;
    if (v1.minor !== v2.minor) return v1.minor - v2.minor;
    return v1.patch - v2.patch;
  }
}

// ============ 插件管理器 ============

/**
 * 插件管理器
 * 负责插件的发现、加载、卸载、依赖管理、版本检查、配置管理等
 */
export class PluginManager extends EventEmitter {
  private plugins: Map<string, Plugin> = new Map();
  private pluginStates: Map<string, PluginState> = new Map();
  private pluginContexts: Map<string, PluginContext> = new Map();
  private pluginConfigs: Map<string, Record<string, unknown>> = new Map();
  private pluginDirs: string[] = [];
  private configDir: string;
  private pluginConfigFile: string;
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private claudeCodeVersion: string = '2.1.4'; // 当前 Axon 版本

  // 注册的工具、命令、技能和钩子
  private registeredTools: Map<string, ToolDefinition[]> = new Map();
  private registeredCommands: Map<string, CommandDefinition[]> = new Map();
  private registeredSkills: Map<string, SkillDefinition[]> = new Map();
  private registeredHooks: Map<string, HookDefinition[]> = new Map();

  constructor(claudeCodeVersion?: string) {
    super();

    if (claudeCodeVersion) {
      this.claudeCodeVersion = claudeCodeVersion;
    }

    this.configDir = process.env.AXON_CONFIG_DIR ||
                     path.join(os.homedir(), '.axon');

    this.pluginConfigFile = path.join(this.configDir, 'plugins.json');

    // 默认插件目录
    this.pluginDirs = [
      path.join(this.configDir, 'plugins'),
      path.join(process.cwd(), '.axon', 'plugins'),
    ];

    // 确保目录存在
    this.ensureDirectories();

    // 加载插件配置
    this.loadPluginConfigs();
  }

  /**
   * 确保必要的目录存在
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 加载插件配置文件
   */
  private loadPluginConfigs(): void {
    try {
      if (fs.existsSync(this.pluginConfigFile)) {
        const configs = JSON.parse(fs.readFileSync(this.pluginConfigFile, 'utf-8'));
        for (const [name, config] of Object.entries(configs)) {
          this.pluginConfigs.set(name, config as Record<string, unknown>);
        }
      }
    } catch (err) {
      console.warn('Failed to load plugin configs:', err);
    }
  }

  /**
   * 保存插件配置文件
   */
  private savePluginConfigs(): void {
    try {
      const configs: Record<string, unknown> = {};
      for (const [name, config] of Array.from(this.pluginConfigs.entries())) {
        configs[name] = config;
      }
      fs.writeFileSync(this.pluginConfigFile, JSON.stringify(configs, null, 2));
    } catch (err) {
      console.error('Failed to save plugin configs:', err);
    }
  }

  /**
   * 添加插件搜索目录
   */
  addPluginDir(dir: string): void {
    if (!this.pluginDirs.includes(dir)) {
      this.pluginDirs.push(dir);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * 发现所有插件
   */
  async discover(): Promise<PluginState[]> {
    const discovered: PluginState[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginPath = path.join(dir, entry.name);
        const packagePath = path.join(pluginPath, 'package.json');

        if (!fs.existsSync(packagePath)) continue;

        try {
          const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

          const metadata: PluginMetadata = {
            name: packageJson.name || entry.name,
            version: packageJson.version || '0.0.0',
            description: packageJson.description,
            author: packageJson.author,
            homepage: packageJson.homepage,
            license: packageJson.license,
            main: packageJson.main || 'index.js',
            engines: packageJson.engines,
            dependencies: packageJson.claudePluginDependencies || packageJson.dependencies,
            peerDependencies: packageJson.peerDependencies,
          };

          // 从配置中读取启用状态
          const config = this.pluginConfigs.get(metadata.name) as PluginConfig | undefined;

          const state: PluginState = {
            metadata,
            path: pluginPath,
            enabled: config?.enabled !== false,
            loaded: false,
            initialized: false,
            activated: false,
            dependencies: [],
            dependents: [],
          };

          this.pluginStates.set(metadata.name, state);
          discovered.push(state);
        } catch (err) {
          console.warn(`Failed to read plugin at ${pluginPath}:`, err);
        }
      }
    }

    // 解析依赖关系
    this.resolveDependencies();

    return discovered;
  }

  /**
   * 解析插件依赖关系
   */
  private resolveDependencies(): void {
    for (const state of Array.from(this.pluginStates.values())) {
      state.dependencies = [];
      state.dependents = [];

      if (state.metadata.dependencies) {
        for (const depName of Object.keys(state.metadata.dependencies)) {
          // 只处理插件依赖
          if (this.pluginStates.has(depName)) {
            state.dependencies.push(depName);
          }
        }
      }
    }

    // 构建反向依赖
    for (const state of Array.from(this.pluginStates.values())) {
      for (const depName of state.dependencies) {
        const depState = this.pluginStates.get(depName);
        if (depState && !depState.dependents.includes(state.metadata.name)) {
          depState.dependents.push(state.metadata.name);
        }
      }
    }
  }

  /**
   * 检查插件引擎兼容性
   */
  private checkEngineCompatibility(metadata: PluginMetadata): boolean {
    if (!metadata.engines) return true;

    // 检查 Node.js 版本
    if (metadata.engines.node) {
      const nodeVersion = process.version.slice(1); // 去掉 'v'
      if (!VersionChecker.satisfies(nodeVersion, metadata.engines.node)) {
        return false;
      }
    }

    // 检查 Axon 版本
    if (metadata.engines['claude-code']) {
      if (!VersionChecker.satisfies(this.claudeCodeVersion, metadata.engines['claude-code'])) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查插件依赖
   */
  private checkDependencies(name: string): { satisfied: boolean; missing: string[] } {
    const state = this.pluginStates.get(name);
    if (!state || !state.metadata.dependencies) {
      return { satisfied: true, missing: [] };
    }

    const missing: string[] = [];

    for (const [depName, versionRange] of Object.entries(state.metadata.dependencies)) {
      const depState = this.pluginStates.get(depName);

      if (!depState) {
        missing.push(`${depName}@${versionRange} (not found)`);
        continue;
      }

      if (!depState.loaded) {
        missing.push(`${depName}@${versionRange} (not loaded)`);
        continue;
      }

      if (!VersionChecker.satisfies(depState.metadata.version, versionRange)) {
        missing.push(`${depName}@${versionRange} (found ${depState.metadata.version})`);
      }
    }

    return { satisfied: missing.length === 0, missing };
  }

  /**
   * 创建插件上下文（沙箱）
   */
  private createPluginContext(name: string, pluginPath: string): PluginContext {
    const events = new EventEmitter();

    // 配置 API
    const configAPI: PluginConfigAPI = {
      get: <T = unknown>(key: string, defaultValue?: T): T | undefined => {
        const config = this.pluginConfigs.get(name);
        return (config?.[key] as T) ?? defaultValue;
      },
      set: async (key: string, value: unknown): Promise<void> => {
        let config = this.pluginConfigs.get(name);
        if (!config) {
          config = {};
          this.pluginConfigs.set(name, config);
        }
        config[key] = value;
        this.savePluginConfigs();
      },
      getAll: (): Record<string, unknown> => {
        return { ...this.pluginConfigs.get(name) };
      },
      has: (key: string): boolean => {
        return this.pluginConfigs.get(name)?.[key] !== undefined;
      },
      delete: async (key: string): Promise<void> => {
        const config = this.pluginConfigs.get(name);
        if (config) {
          delete config[key];
          this.savePluginConfigs();
        }
      },
    };

    // 日志 API
    const logger: PluginLogger = {
      debug: (message: string, ...args: unknown[]): void => {
        console.debug(`[Plugin:${name}]`, message, ...args);
      },
      info: (message: string, ...args: unknown[]): void => {
        console.info(`[Plugin:${name}]`, message, ...args);
      },
      warn: (message: string, ...args: unknown[]): void => {
        console.warn(`[Plugin:${name}]`, message, ...args);
      },
      error: (message: string, ...args: unknown[]): void => {
        console.error(`[Plugin:${name}]`, message, ...args);
      },
    };

    // 文件系统 API（限制在插件目录内）
    const fsAPI: PluginFileSystemAPI = {
      readFile: async (relativePath: string): Promise<string> => {
        const fullPath = path.join(pluginPath, relativePath);
        if (!fullPath.startsWith(pluginPath)) {
          throw new Error('Access denied: path outside plugin directory');
        }
        return fs.promises.readFile(fullPath, 'utf-8');
      },
      writeFile: async (relativePath: string, content: string): Promise<void> => {
        const fullPath = path.join(pluginPath, relativePath);
        if (!fullPath.startsWith(pluginPath)) {
          throw new Error('Access denied: path outside plugin directory');
        }
        await fs.promises.writeFile(fullPath, content, 'utf-8');
      },
      exists: async (relativePath: string): Promise<boolean> => {
        const fullPath = path.join(pluginPath, relativePath);
        if (!fullPath.startsWith(pluginPath)) {
          throw new Error('Access denied: path outside plugin directory');
        }
        return fs.existsSync(fullPath);
      },
      readdir: async (relativePath: string = ''): Promise<string[]> => {
        const fullPath = path.join(pluginPath, relativePath);
        if (!fullPath.startsWith(pluginPath)) {
          throw new Error('Access denied: path outside plugin directory');
        }
        return fs.promises.readdir(fullPath);
      },
    };

    // 工具 API
    const toolsAPI: PluginToolAPI = {
      register: (tool: ToolDefinition): void => {
        let tools = this.registeredTools.get(name);
        if (!tools) {
          tools = [];
          this.registeredTools.set(name, tools);
        }
        tools.push(tool);
        this.emit('tool:registered', name, tool);
      },
      unregister: (toolName: string): void => {
        const tools = this.registeredTools.get(name);
        if (tools) {
          const index = tools.findIndex(t => t.name === toolName);
          if (index !== -1) {
            tools.splice(index, 1);
            this.emit('tool:unregistered', name, toolName);
          }
        }
      },
      getRegistered: (): ToolDefinition[] => {
        return [...(this.registeredTools.get(name) || [])];
      },
    };

    // 命令 API
    const commandsAPI: PluginCommandAPI = {
      register: (command: CommandDefinition): void => {
        let commands = this.registeredCommands.get(name);
        if (!commands) {
          commands = [];
          this.registeredCommands.set(name, commands);
        }
        commands.push(command);
        this.emit('command:registered', name, command);
      },
      unregister: (commandName: string): void => {
        const commands = this.registeredCommands.get(name);
        if (commands) {
          const index = commands.findIndex(c => c.name === commandName);
          if (index !== -1) {
            commands.splice(index, 1);
            this.emit('command:unregistered', name, commandName);
          }
        }
      },
      getRegistered: (): CommandDefinition[] => {
        return [...(this.registeredCommands.get(name) || [])];
      },
    };

    // Skills API
    const skillsAPI: PluginSkillAPI = {
      register: (skill: SkillDefinition): void => {
        let skills = this.registeredSkills.get(name);
        if (!skills) {
          skills = [];
          this.registeredSkills.set(name, skills);
        }
        skills.push(skill);
        this.emit('skill:registered', name, skill);
      },
      unregister: (skillName: string): void => {
        const skills = this.registeredSkills.get(name);
        if (skills) {
          const index = skills.findIndex(s => s.name === skillName);
          if (index !== -1) {
            skills.splice(index, 1);
            this.emit('skill:unregistered', name, skillName);
          }
        }
      },
      getRegistered: (): SkillDefinition[] => {
        return [...(this.registeredSkills.get(name) || [])];
      },
    };

    // 钩子 API
    const hooksAPI: PluginHookAPI = {
      on: (hookType: PluginHookType, handler: HookHandler): void => {
        let hooks = this.registeredHooks.get(name);
        if (!hooks) {
          hooks = [];
          this.registeredHooks.set(name, hooks);
        }
        hooks.push({ type: hookType, handler });
        this.emit('hook:registered', name, hookType);
      },
      off: (hookType: PluginHookType, handler: HookHandler): void => {
        const hooks = this.registeredHooks.get(name);
        if (hooks) {
          const index = hooks.findIndex(h => h.type === hookType && h.handler === handler);
          if (index !== -1) {
            hooks.splice(index, 1);
            this.emit('hook:unregistered', name, hookType);
          }
        }
      },
      getRegistered: (): Array<{ type: PluginHookType; handler: HookHandler }> => {
        return [...(this.registeredHooks.get(name) || [])];
      },
    };

    const context: PluginContext = {
      pluginName: name,
      pluginPath,
      config: configAPI,
      logger,
      fs: fsAPI,
      tools: toolsAPI,
      commands: commandsAPI,
      skills: skillsAPI,
      hooks: hooksAPI,
      events,
    };

    this.pluginContexts.set(name, context);
    return context;
  }

  /**
   * 加载插件（完整生命周期）
   */
  async load(name: string, options: { force?: boolean; skipDeps?: boolean } = {}): Promise<boolean> {
    const state = this.pluginStates.get(name);
    if (!state) {
      throw new Error(`Plugin not found: ${name}`);
    }

    if (state.loaded && !options.force) {
      return true;
    }

    try {
      // 1. 检查引擎兼容性
      if (!this.checkEngineCompatibility(state.metadata)) {
        throw new Error(
          `Plugin ${name} is not compatible with current environment. ` +
          `Requires: ${JSON.stringify(state.metadata.engines)}`
        );
      }

      // 2. 检查并加载依赖
      if (!options.skipDeps) {
        for (const depName of state.dependencies) {
          const depState = this.pluginStates.get(depName);
          if (!depState) {
            throw new Error(`Dependency not found: ${depName}`);
          }
          if (!depState.loaded) {
            const loaded = await this.load(depName, options);
            if (!loaded) {
              throw new Error(`Failed to load dependency: ${depName}`);
            }
          }
        }

        // 验证依赖版本
        const depCheck = this.checkDependencies(name);
        if (!depCheck.satisfied) {
          throw new Error(`Dependency requirements not satisfied: ${depCheck.missing.join(', ')}`);
        }
      }

      // 3. 查找主文件
      const mainFile = path.join(state.path, state.metadata.main || 'index.js');
      if (!fs.existsSync(mainFile)) {
        throw new Error(`Plugin main file not found: ${mainFile}`);
      }

      // 4. 创建插件上下文（沙箱）
      const context = this.createPluginContext(name, state.path);

      // 5. 动态导入插件
      const pluginModule = await import(`file://${mainFile}?t=${Date.now()}`);
      const plugin: Plugin = pluginModule.default || pluginModule;

      // 6. 验证插件
      if (!plugin.metadata) {
        plugin.metadata = state.metadata;
      }

      // 7. 初始化插件（新增）
      if (plugin.init) {
        await plugin.init(context);
        state.initialized = true;
      }

      // 8. 激活插件
      if (plugin.activate) {
        await plugin.activate(context);
        state.activated = true;
      }

      // 9. 注册插件提供的工具、命令、技能、钩子
      if (plugin.tools) {
        for (const tool of plugin.tools) {
          context.tools.register(tool);
        }
      }

      if (plugin.commands) {
        for (const command of plugin.commands) {
          context.commands.register(command);
        }
      }

      if (plugin.skills) {
        for (const skill of plugin.skills) {
          context.skills.register(skill);
        }
      }

      if (plugin.hooks) {
        for (const hook of plugin.hooks) {
          context.hooks.on(hook.type, hook.handler);
        }
      }

      // 10. 保存插件实例
      this.plugins.set(name, plugin);
      state.loaded = true;
      state.loadTime = Date.now();
      state.error = undefined;

      this.emit('plugin:loaded', name, plugin);
      await this.executeHook('onPluginLoad', { pluginName: name, plugin });

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      state.error = errorMsg;
      state.loaded = false;
      state.initialized = false;
      state.activated = false;
      this.emit('plugin:error', name, err);
      console.error(`Failed to load plugin ${name}:`, errorMsg);
      return false;
    }
  }

  /**
   * 卸载插件
   */
  async unload(name: string, options: { force?: boolean } = {}): Promise<boolean> {
    const plugin = this.plugins.get(name);
    const state = this.pluginStates.get(name);

    if (!plugin || !state) {
      return false;
    }

    try {
      // 1. 检查是否有其他插件依赖此插件
      if (!options.force && state.dependents.length > 0) {
        const loadedDependents = state.dependents.filter(
          depName => this.pluginStates.get(depName)?.loaded
        );
        if (loadedDependents.length > 0) {
          throw new Error(
            `Cannot unload plugin ${name}: it is required by ${loadedDependents.join(', ')}`
          );
        }
      }

      // 2. 停止文件监听（如果启用了热重载）
      const watcher = this.fileWatchers.get(name);
      if (watcher) {
        watcher.close();
        this.fileWatchers.delete(name);
      }

      // 3. 执行卸载钩子
      await this.executeHook('onPluginUnload', { pluginName: name, plugin });

      // 4. 调用插件的 deactivate
      if (plugin.deactivate) {
        await plugin.deactivate();
      }

      // 5. 清理注册的工具、命令、技能、钩子
      this.registeredTools.delete(name);
      this.registeredCommands.delete(name);
      this.registeredSkills.delete(name);
      this.registeredHooks.delete(name);

      // 6. 清理插件上下文
      this.pluginContexts.delete(name);

      // 7. 删除插件实例
      this.plugins.delete(name);

      // 8. 更新状态
      state.loaded = false;
      state.initialized = false;
      state.activated = false;

      this.emit('plugin:unloaded', name);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      state.error = errorMsg;
      console.error(`Failed to unload plugin ${name}:`, errorMsg);
      return false;
    }
  }

  /**
   * 重载插件（热重载）
   */
  async reload(name: string): Promise<boolean> {
    const state = this.pluginStates.get(name);
    if (!state) {
      return false;
    }

    const wasLoaded = state.loaded;
    if (wasLoaded) {
      await this.unload(name);
    }

    const result = await this.load(name, { force: true });
    if (result) {
      state.lastReloadTime = Date.now();
      this.emit('plugin:reloaded', name);
    }

    return result;
  }

  /**
   * 启用插件热重载
   */
  enableHotReload(name: string): void {
    const state = this.pluginStates.get(name);
    if (!state || this.fileWatchers.has(name)) {
      return;
    }

    try {
      const watcher = fs.watch(
        state.path,
        { recursive: true },
        async (eventType, filename) => {
          if (!filename) return;

          // 忽略 node_modules 和隐藏文件
          if (filename.includes('node_modules') || filename.startsWith('.')) {
            return;
          }

          // 只监听 JS/TS 文件
          if (!/\.(js|ts|mjs|cjs)$/.test(filename)) {
            return;
          }

          console.info(`[Plugin:${name}] File changed: ${filename}, reloading...`);

          // 防抖：延迟重载以避免多次快速触发
          const timeoutKey = `${name}_reload`;
          const existingTimeout = (this as any)[timeoutKey];
          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          (this as any)[timeoutKey] = setTimeout(async () => {
            await this.reload(name);
          }, 500);
        }
      );

      this.fileWatchers.set(name, watcher);
      console.info(`[Plugin:${name}] Hot reload enabled`);
    } catch (err) {
      console.error(`Failed to enable hot reload for plugin ${name}:`, err);
    }
  }

  /**
   * 禁用插件热重载
   */
  disableHotReload(name: string): void {
    const watcher = this.fileWatchers.get(name);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(name);
      console.info(`[Plugin:${name}] Hot reload disabled`);
    }
  }

  /**
   * 加载所有已发现的插件（拓扑排序）
   */
  async loadAll(options: { enableHotReload?: boolean } = {}): Promise<void> {
    await this.discover();

    // 拓扑排序：按依赖顺序加载
    const loaded = new Set<string>();
    const loading = new Set<string>();

    const loadWithDeps = async (name: string): Promise<void> => {
      const state = this.pluginStates.get(name);
      if (!state || !state.enabled || loaded.has(name)) {
        return;
      }

      if (loading.has(name)) {
        throw new Error(`Circular dependency detected: ${name}`);
      }

      loading.add(name);

      // 先加载依赖
      for (const depName of state.dependencies) {
        await loadWithDeps(depName);
      }

      // 再加载自己
      await this.load(name);
      loaded.add(name);
      loading.delete(name);

      // 启用热重载
      if (options.enableHotReload) {
        this.enableHotReload(name);
      }
    };

    for (const name of Array.from(this.pluginStates.keys())) {
      await loadWithDeps(name);
    }
  }

  /**
   * 卸载所有插件（反向拓扑排序）
   */
  async unloadAll(): Promise<void> {
    // 按依赖的反向顺序卸载
    const unloaded = new Set<string>();

    const unloadWithDependents = async (name: string): Promise<void> => {
      if (unloaded.has(name)) {
        return;
      }

      const state = this.pluginStates.get(name);
      if (!state) {
        return;
      }

      // 先卸载依赖此插件的其他插件
      for (const depName of state.dependents) {
        await unloadWithDependents(depName);
      }

      // 再卸载自己
      await this.unload(name, { force: true });
      unloaded.add(name);
    };

    for (const name of Array.from(this.plugins.keys())) {
      await unloadWithDependents(name);
    }
  }

  /**
   * 获取所有注册的工具
   */
  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const toolList of Array.from(this.registeredTools.values())) {
      tools.push(...toolList);
    }
    return tools;
  }

  /**
   * 获取所有注册的命令
   */
  getCommands(): CommandDefinition[] {
    const commands: CommandDefinition[] = [];
    for (const commandList of Array.from(this.registeredCommands.values())) {
      commands.push(...commandList);
    }
    return commands;
  }

  /**
   * 获取所有注册的技能
   */
  getSkills(): SkillDefinition[] {
    const skills: SkillDefinition[] = [];
    for (const skillList of Array.from(this.registeredSkills.values())) {
      skills.push(...skillList);
    }
    return skills;
  }

  /**
   * 获取指定插件的工具
   */
  getPluginTools(name: string): ToolDefinition[] {
    return this.registeredTools.get(name) || [];
  }

  /**
   * 获取指定插件的命令
   */
  getPluginCommands(name: string): CommandDefinition[] {
    return this.registeredCommands.get(name) || [];
  }

  /**
   * 获取指定插件的技能
   */
  getPluginSkills(name: string): SkillDefinition[] {
    return this.registeredSkills.get(name) || [];
  }

  /**
   * 获取指定插件的钩子
   */
  getPluginHooks(name: string): HookDefinition[] {
    return this.registeredHooks.get(name) || [];
  }

  /**
   * 执行钩子（按优先级排序）
   */
  async executeHook<T>(hookType: PluginHookType, context: T): Promise<T> {
    let result = context;

    // 收集所有相关钩子
    const hooks: Array<{ plugin: string; hook: HookDefinition }> = [];
    for (const [pluginName, hookList] of Array.from(this.registeredHooks.entries())) {
      for (const hook of hookList) {
        if (hook.type === hookType) {
          hooks.push({ plugin: pluginName, hook });
        }
      }
    }

    // 按优先级排序（数字越小优先级越高）
    hooks.sort((a, b) => (a.hook.priority || 100) - (b.hook.priority || 100));

    // 依次执行
    for (const { plugin, hook } of hooks) {
      try {
        const hookResult = await hook.handler(result);
        if (hookResult !== undefined) {
          result = hookResult as T;
        }
      } catch (err) {
        this.emit('hook:error', hookType, plugin, err);
        console.error(`Error in hook ${hookType} from plugin ${plugin}:`, err);
      }
    }

    return result;
  }

  /**
   * 获取已加载的插件
   */
  getLoadedPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取插件状态列表
   */
  getPluginStates(): PluginState[] {
    return Array.from(this.pluginStates.values());
  }

  /**
   * 获取插件
   */
  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * 获取插件状态
   */
  getPluginState(name: string): PluginState | undefined {
    return this.pluginStates.get(name);
  }

  /**
   * 获取插件上下文
   */
  getPluginContext(name: string): PluginContext | undefined {
    return this.pluginContexts.get(name);
  }

  /**
   * 安装插件（从路径复制）
   */
  async install(
    sourcePath: string,
    options: { autoLoad?: boolean; enableHotReload?: boolean } = {}
  ): Promise<PluginState> {
    const packagePath = path.join(sourcePath, 'package.json');

    if (!fs.existsSync(packagePath)) {
      throw new Error('Invalid plugin: package.json not found');
    }

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
    const name = packageJson.name;

    if (!name) {
      throw new Error('Invalid plugin: name not specified in package.json');
    }

    // 检查是否已安装
    const existingState = this.pluginStates.get(name);
    if (existingState) {
      // 卸载旧版本
      await this.unload(name);
    }

    // 目标路径
    const targetDir = path.join(this.pluginDirs[0], name);

    // 复制插件文件
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true });
    }

    fs.cpSync(sourcePath, targetDir, { recursive: true });

    // 重新发现
    await this.discover();

    const state = this.pluginStates.get(name);
    if (!state) {
      throw new Error(`Failed to discover installed plugin: ${name}`);
    }

    // 自动加载
    if (options.autoLoad !== false) {
      await this.load(name);

      if (options.enableHotReload) {
        this.enableHotReload(name);
      }
    }

    this.emit('plugin:installed', name, state);
    return state;
  }

  /**
   * 卸载插件（从磁盘删除）
   */
  async uninstall(name: string): Promise<boolean> {
    const state = this.pluginStates.get(name);
    if (!state) {
      return false;
    }

    // 检查依赖
    if (state.dependents.length > 0) {
      throw new Error(
        `Cannot uninstall plugin ${name}: it is required by ${state.dependents.join(', ')}`
      );
    }

    // 先卸载
    if (state.loaded) {
      await this.unload(name, { force: true });
    }

    // 删除文件
    if (fs.existsSync(state.path)) {
      fs.rmSync(state.path, { recursive: true });
    }

    // 删除配置
    this.pluginConfigs.delete(name);
    this.savePluginConfigs();

    this.pluginStates.delete(name);
    this.emit('plugin:uninstalled', name);
    return true;
  }

  /**
   * 启用/禁用插件
   */
  async setEnabled(name: string, enabled: boolean): Promise<boolean> {
    const state = this.pluginStates.get(name);
    if (!state) {
      return false;
    }

    state.enabled = enabled;

    // 更新配置
    let config = this.pluginConfigs.get(name);
    if (!config) {
      config = {};
      this.pluginConfigs.set(name, config);
    }
    config.enabled = enabled;
    this.savePluginConfigs();

    // 如果禁用，卸载插件
    if (!enabled && state.loaded) {
      await this.unload(name);
    }

    // 如果启用，加载插件
    if (enabled && !state.loaded) {
      await this.load(name);
    }

    this.emit('plugin:enabled-changed', name, enabled);
    return true;
  }

  /**
   * 注册内联插件（无需文件系统）
   * @param definition 内联插件定义
   */
  async registerInlinePlugin(definition: InlinePluginDefinition): Promise<boolean> {
    const name = definition.name;

    // 检查是否已存在
    if (this.plugins.has(name)) {
      throw new Error(`Plugin ${name} already registered`);
    }

    try {
      let plugin: Plugin;

      if (definition.plugin) {
        // 直接使用提供的插件对象
        plugin = definition.plugin;
      } else if (definition.code) {
        // 从代码字符串创建插件
        // 使用 Function 构造器执行代码（注意：这有安全风险，仅用于受信任的代码）
        const moduleFactory = new Function('return ' + definition.code);
        const module = moduleFactory();
        plugin = module.default || module;
      } else {
        throw new Error('Either plugin or code must be provided');
      }

      // 确保有元数据
      if (!plugin.metadata) {
        plugin.metadata = {
          name,
          version: definition.version || '1.0.0',
          description: definition.description,
        };
      }

      // 创建虚拟状态
      const state: PluginState = {
        metadata: plugin.metadata,
        path: '<inline>', // 标记为内联插件
        enabled: true,
        loaded: false,
        initialized: false,
        activated: false,
        dependencies: [],
        dependents: [],
      };

      this.pluginStates.set(name, state);

      // 创建上下文（使用内存路径）
      const context = this.createPluginContext(name, '<inline>');

      // 初始化插件
      if (plugin.init) {
        await plugin.init(context);
        state.initialized = true;
      }

      // 激活插件
      if (plugin.activate) {
        await plugin.activate(context);
        state.activated = true;
      }

      // 注册功能
      if (plugin.tools) {
        for (const tool of plugin.tools) {
          context.tools.register(tool);
        }
      }

      if (plugin.commands) {
        for (const command of plugin.commands) {
          context.commands.register(command);
        }
      }

      if (plugin.skills) {
        for (const skill of plugin.skills) {
          context.skills.register(skill);
        }
      }

      if (plugin.hooks) {
        for (const hook of plugin.hooks) {
          context.hooks.on(hook.type, hook.handler);
        }
      }

      // 保存插件实例
      this.plugins.set(name, plugin);
      state.loaded = true;
      state.loadTime = Date.now();

      this.emit('plugin:inline-registered', name, plugin);
      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to register inline plugin ${name}:`, errorMsg);
      return false;
    }
  }

  /**
   * 注销内联插件
   */
  async unregisterInlinePlugin(name: string): Promise<boolean> {
    const state = this.pluginStates.get(name);
    if (!state || state.path !== '<inline>') {
      return false;
    }

    return await this.unload(name, { force: true });
  }

  /**
   * 获取所有内联插件
   */
  getInlinePlugins(): PluginState[] {
    return Array.from(this.pluginStates.values()).filter(s => s.path === '<inline>');
  }

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    // 停止所有文件监听
    for (const watcher of Array.from(this.fileWatchers.values())) {
      watcher.close();
    }
    this.fileWatchers.clear();

    // 卸载所有插件
    await this.unloadAll();
  }
}

// ============ 插件执行器 ============

/**
 * 插件工具执行器
 * 用于执行插件提供的工具
 */
export class PluginToolExecutor {
  private manager: PluginManager;
  private toolExecutors: Map<string, (input: unknown) => Promise<ToolResult>> = new Map();

  constructor(manager: PluginManager) {
    this.manager = manager;

    // 监听工具注册事件
    this.manager.on('tool:registered', (pluginName: string, tool: ToolDefinition) => {
      this.registerToolExecutor(pluginName, tool);
    });

    this.manager.on('tool:unregistered', (pluginName: string, toolName: string) => {
      this.toolExecutors.delete(toolName);
    });
  }

  /**
   * 注册工具执行器
   */
  private registerToolExecutor(pluginName: string, tool: ToolDefinition): void {
    // 获取插件实例
    const plugin = this.manager.getPlugin(pluginName);
    if (!plugin) return;

    // 查找工具的执行方法
    const pluginWithExecutor = plugin as Plugin & {
      executeTool?: (toolName: string, input: unknown) => Promise<ToolResult>;
      [key: string]: unknown;
    };

    // 创建执行器
    const executor = async (input: unknown): Promise<ToolResult> => {
      try {
        // 尝试调用插件的 executeTool 方法
        if (pluginWithExecutor.executeTool) {
          return await pluginWithExecutor.executeTool(tool.name, input);
        }

        // 尝试查找同名方法
        const methodName = `execute_${tool.name}`;
        const method = pluginWithExecutor[methodName];
        if (typeof method === 'function') {
          return await method.call(plugin, input);
        }

        return {
          success: false,
          error: `Plugin ${pluginName} does not provide an executor for tool ${tool.name}`,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          error: `Error executing tool ${tool.name}: ${errorMsg}`,
        };
      }
    };

    this.toolExecutors.set(tool.name, executor);
  }

  /**
   * 执行工具
   */
  async execute(toolName: string, input: unknown): Promise<ToolResult> {
    const executor = this.toolExecutors.get(toolName);

    if (!executor) {
      return {
        success: false,
        error: `Tool not found: ${toolName}`,
      };
    }

    try {
      return await executor(input);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Error executing tool ${toolName}: ${errorMsg}`,
      };
    }
  }

  /**
   * 获取所有可用的工具
   */
  getAvailableTools(): string[] {
    return Array.from(this.toolExecutors.keys());
  }

  /**
   * 检查工具是否存在
   */
  hasTool(toolName: string): boolean {
    return this.toolExecutors.has(toolName);
  }
}

/**
 * 插件命令执行器
 */
export class PluginCommandExecutor {
  private manager: PluginManager;

  constructor(manager: PluginManager) {
    this.manager = manager;
  }

  /**
   * 执行命令
   */
  async execute(commandName: string, args: string[]): Promise<void> {
    const commands = this.manager.getCommands();
    const command = commands.find(c => c.name === commandName);

    if (!command) {
      throw new Error(`Command not found: ${commandName}`);
    }

    // 查找提供此命令的插件
    let pluginName: string | undefined;
    for (const [name, cmds] of (this.manager as any).registeredCommands) {
      if (cmds.some((c: CommandDefinition) => c.name === commandName)) {
        pluginName = name;
        break;
      }
    }

    if (!pluginName) {
      throw new Error(`Plugin for command ${commandName} not found`);
    }

    const context = this.manager.getPluginContext(pluginName);
    if (!context) {
      throw new Error(`Context for plugin ${pluginName} not found`);
    }

    await command.execute(args, context);
  }

  /**
   * 获取所有可用的命令
   */
  getAvailableCommands(): CommandDefinition[] {
    return this.manager.getCommands();
  }

  /**
   * 获取命令帮助信息
   */
  getCommandHelp(commandName: string): string {
    const command = this.manager.getCommands().find(c => c.name === commandName);
    if (!command) {
      return `Command not found: ${commandName}`;
    }

    let help = `Command: ${command.name}\n`;
    help += `Description: ${command.description}\n`;

    if (command.usage) {
      help += `Usage: ${command.usage}\n`;
    }

    if (command.examples && command.examples.length > 0) {
      help += '\nExamples:\n';
      for (const example of command.examples) {
        help += `  ${example}\n`;
      }
    }

    return help;
  }
}

/**
 * 插件技能执行器
 * 用于执行插件提供的 Skills/Prompts
 */
export class PluginSkillExecutor {
  private manager: PluginManager;

  constructor(manager: PluginManager) {
    this.manager = manager;
  }

  /**
   * 获取技能
   */
  getSkill(skillName: string): SkillDefinition | undefined {
    const skills = this.manager.getSkills();
    return skills.find(s => s.name === skillName);
  }

  /**
   * 执行技能（返回提示词）
   * @param skillName 技能名称
   * @param params 参数对象
   * @returns 处理后的提示词
   */
  execute(skillName: string, params: Record<string, unknown> = {}): string {
    const skill = this.getSkill(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }

    // 验证必需参数
    if (skill.parameters) {
      for (const param of skill.parameters) {
        if (param.required && !(param.name in params)) {
          throw new Error(`Missing required parameter: ${param.name}`);
        }
      }
    }

    // 替换提示词中的参数占位符
    let prompt = skill.prompt;
    for (const [key, value] of Object.entries(params)) {
      const placeholder = new RegExp(`\\{${key}\\}`, 'g');
      prompt = prompt.replace(placeholder, String(value));
    }

    return prompt;
  }

  /**
   * 获取所有可用的技能
   */
  getAvailableSkills(): SkillDefinition[] {
    return this.manager.getSkills();
  }

  /**
   * 按分类获取技能
   */
  getSkillsByCategory(category: string): SkillDefinition[] {
    return this.manager.getSkills().filter(s => s.category === category);
  }

  /**
   * 获取技能帮助信息
   */
  getSkillHelp(skillName: string): string {
    const skill = this.getSkill(skillName);
    if (!skill) {
      return `Skill not found: ${skillName}`;
    }

    let help = `Skill: /${skill.name}\n`;
    help += `Description: ${skill.description}\n`;

    if (skill.category) {
      help += `Category: ${skill.category}\n`;
    }

    if (skill.parameters && skill.parameters.length > 0) {
      help += '\nParameters:\n';
      for (const param of skill.parameters) {
        const required = param.required ? ' (required)' : ' (optional)';
        const type = param.type ? ` [${param.type}]` : '';
        help += `  ${param.name}${type}${required}: ${param.description}\n`;
      }
    }

    if (skill.examples && skill.examples.length > 0) {
      help += '\nExamples:\n';
      for (const example of skill.examples) {
        help += `  ${example}\n`;
      }
    }

    return help;
  }

  /**
   * 列出所有技能（格式化输出）
   */
  listSkills(): string {
    const skills = this.getAvailableSkills();
    if (skills.length === 0) {
      return 'No skills available.';
    }

    // 按分类分组
    const categories = new Map<string, SkillDefinition[]>();
    for (const skill of skills) {
      const category = skill.category || 'General';
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(skill);
    }

    let output = 'Available Plugin Skills:\n\n';
    for (const [category, categorySkills] of Array.from(categories.entries())) {
      output += `${category}:\n`;
      for (const skill of categorySkills) {
        output += `  /${skill.name}: ${skill.description}\n`;
      }
      output += '\n';
    }

    return output;
  }
}

// ============ 内联插件 ============

/**
 * 内联插件定义
 * 允许在代码中直接定义简单插件，无需文件系统
 */
export interface InlinePluginDefinition {
  name: string;
  version?: string;
  description?: string;

  // 内联代码（字符串形式的插件代码）
  code?: string;

  // 或直接提供插件对象
  plugin?: Plugin;
}

// ============ 插件推荐系统 ============

/**
 * 插件推荐
 */
export interface PluginRecommendation {
  pluginName: string;
  reason: string;
  relevance: number; // 0-1，相关度评分
  context?: {
    fileTypes?: string[];
    keywords?: string[];
    taskType?: string;
  };
}

/**
 * 插件推荐器
 * 基于上下文智能推荐插件
 */
export class PluginRecommender {
  private manager: PluginManager;

  // 插件推荐规则
  private recommendationRules: Array<{
    pluginPattern: RegExp;
    triggers: {
      fileExtensions?: string[];
      keywords?: string[];
      taskTypes?: string[];
    };
    reason: string;
  }> = [
    // 前端开发插件推荐
    {
      pluginPattern: /frontend|html|css|design/i,
      triggers: {
        fileExtensions: ['.html', '.htm', '.css', '.scss', '.sass', '.less'],
        keywords: ['html', 'css', 'frontend', 'design', 'styling'],
      },
      reason: 'Working with HTML/CSS files',
    },
    // React 开发插件推荐
    {
      pluginPattern: /react/i,
      triggers: {
        fileExtensions: ['.jsx', '.tsx'],
        keywords: ['react', 'component', 'hook'],
      },
      reason: 'Working with React components',
    },
    // Vue 开发插件推荐
    {
      pluginPattern: /vue/i,
      triggers: {
        fileExtensions: ['.vue'],
        keywords: ['vue', 'composition'],
      },
      reason: 'Working with Vue.js',
    },
    // Python 数据科学插件推荐
    {
      pluginPattern: /data|science|analysis|ml/i,
      triggers: {
        fileExtensions: ['.ipynb', '.py'],
        keywords: ['pandas', 'numpy', 'scikit', 'tensorflow', 'pytorch', 'jupyter'],
      },
      reason: 'Working with data science/ML',
    },
    // API 测试插件推荐
    {
      pluginPattern: /api|test|http/i,
      triggers: {
        keywords: ['api', 'http', 'rest', 'graphql', 'postman'],
        taskTypes: ['testing', 'debugging'],
      },
      reason: 'Testing APIs',
    },
    // 文档生成插件推荐
    {
      pluginPattern: /doc|markdown|readme/i,
      triggers: {
        fileExtensions: ['.md', '.mdx', '.rst'],
        keywords: ['documentation', 'readme', 'doc'],
        taskTypes: ['documentation'],
      },
      reason: 'Writing documentation',
    },
  ];

  constructor(manager: PluginManager) {
    this.manager = manager;
  }

  /**
   * 添加自定义推荐规则
   */
  addRule(rule: {
    pluginPattern: RegExp;
    triggers: {
      fileExtensions?: string[];
      keywords?: string[];
      taskTypes?: string[];
    };
    reason: string;
  }): void {
    this.recommendationRules.push(rule);
  }

  /**
   * 基于上下文推荐插件
   */
  async recommend(context: {
    currentFiles?: string[];
    recentCommands?: string[];
    userQuery?: string;
    taskType?: string;
  }): Promise<PluginRecommendation[]> {
    const recommendations: PluginRecommendation[] = [];
    const allPlugins = this.manager.getPluginStates();
    const installedPluginNames = new Set(
      allPlugins.filter(p => p.loaded).map(p => p.metadata.name)
    );

    // 提取文件扩展名
    const fileExtensions: string[] = [];
    if (context.currentFiles) {
      for (const file of context.currentFiles) {
        const ext = file.substring(file.lastIndexOf('.'));
        if (ext) fileExtensions.push(ext.toLowerCase());
      }
    }

    // 提取关键词
    const keywords: string[] = [];
    if (context.userQuery) {
      keywords.push(...context.userQuery.toLowerCase().split(/\s+/));
    }
    if (context.recentCommands) {
      for (const cmd of context.recentCommands) {
        keywords.push(...cmd.toLowerCase().split(/\s+/));
      }
    }

    // 检查每个规则
    for (const rule of this.recommendationRules) {
      let relevance = 0;
      const matchedContext: {
        fileTypes?: string[];
        keywords?: string[];
        taskType?: string;
      } = {};

      // 检查文件扩展名匹配
      if (rule.triggers.fileExtensions && fileExtensions.length > 0) {
        const matched = fileExtensions.filter(ext =>
          rule.triggers.fileExtensions!.includes(ext)
        );
        if (matched.length > 0) {
          relevance += 0.4;
          matchedContext.fileTypes = matched;
        }
      }

      // 检查关键词匹配
      if (rule.triggers.keywords && keywords.length > 0) {
        const matched = keywords.filter(kw =>
          rule.triggers.keywords!.some(trigger => kw.includes(trigger))
        );
        if (matched.length > 0) {
          relevance += 0.3;
          matchedContext.keywords = matched;
        }
      }

      // 检查任务类型匹配
      if (rule.triggers.taskTypes && context.taskType) {
        if (rule.triggers.taskTypes.includes(context.taskType)) {
          relevance += 0.3;
          matchedContext.taskType = context.taskType;
        }
      }

      // 如果有匹配，查找符合规则的未安装插件
      if (relevance > 0) {
        for (const plugin of allPlugins) {
          const pluginName = plugin.metadata.name;

          // 跳过已安装的插件
          if (installedPluginNames.has(pluginName)) {
            continue;
          }

          // 检查插件名称是否符合规则
          if (rule.pluginPattern.test(pluginName) ||
              rule.pluginPattern.test(plugin.metadata.description || '')) {
            recommendations.push({
              pluginName,
              reason: rule.reason,
              relevance,
              context: matchedContext,
            });
          }
        }
      }
    }

    // 按相关度排序并去重
    const uniqueRecommendations = new Map<string, PluginRecommendation>();
    for (const rec of recommendations) {
      const existing = uniqueRecommendations.get(rec.pluginName);
      if (!existing || rec.relevance > existing.relevance) {
        uniqueRecommendations.set(rec.pluginName, rec);
      }
    }

    return Array.from(uniqueRecommendations.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5); // 最多返回5个推荐
  }

  /**
   * 格式化推荐输出
   */
  formatRecommendations(recommendations: PluginRecommendation[]): string {
    if (recommendations.length === 0) {
      return '';
    }

    let output = '\n**Recommended Plugins:**\n\n';
    for (const rec of recommendations) {
      output += `- **${rec.pluginName}** (relevance: ${(rec.relevance * 100).toFixed(0)}%)\n`;
      output += `  ${rec.reason}\n`;

      if (rec.context) {
        const details: string[] = [];
        if (rec.context.fileTypes) {
          details.push(`files: ${rec.context.fileTypes.join(', ')}`);
        }
        if (rec.context.keywords) {
          details.push(`keywords: ${rec.context.keywords.join(', ')}`);
        }
        if (rec.context.taskType) {
          details.push(`task: ${rec.context.taskType}`);
        }
        if (details.length > 0) {
          output += `  (${details.join('; ')})\n`;
        }
      }

      output += `  Install: \`claude plugin install ${rec.pluginName}\`\n\n`;
    }

    return output;
  }
}

// ============ 默认实例 ============

/**
 * 默认插件管理器实例
 */
export const pluginManager = new PluginManager();

/**
 * 默认工具执行器实例
 */
export const pluginToolExecutor = new PluginToolExecutor(pluginManager);

/**
 * 默认命令执行器实例
 */
export const pluginCommandExecutor = new PluginCommandExecutor(pluginManager);

/**
 * 默认技能执行器实例
 */
export const pluginSkillExecutor = new PluginSkillExecutor(pluginManager);

/**
 * 默认插件推荐器实例
 */
export const pluginRecommender = new PluginRecommender(pluginManager);

// ============ 便捷导出 ============

/**
 * 创建新的插件管理器实例
 */
export function createPluginManager(claudeCodeVersion?: string): PluginManager {
  return new PluginManager(claudeCodeVersion);
}

/**
 * 创建插件开发助手
 */
export interface PluginHelper {
  /**
   * 验证插件元数据
   */
  validateMetadata(metadata: PluginMetadata): { valid: boolean; errors: string[] };

  /**
   * 创建插件模板
   */
  createTemplate(name: string, options?: {
    author?: string;
    description?: string;
    version?: string;
  }): string;
}

export const pluginHelper: PluginHelper = {
  validateMetadata(metadata: PluginMetadata): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!metadata.name || typeof metadata.name !== 'string') {
      errors.push('Invalid or missing name');
    }

    if (!metadata.version || typeof metadata.version !== 'string') {
      errors.push('Invalid or missing version');
    }

    if (metadata.engines) {
      if (metadata.engines.node && typeof metadata.engines.node !== 'string') {
        errors.push('Invalid engines.node');
      }
      if (metadata.engines['claude-code'] && typeof metadata.engines['claude-code'] !== 'string') {
        errors.push('Invalid engines.claude-code');
      }
    }

    return { valid: errors.length === 0, errors };
  },

  createTemplate(name: string, options = {}): string {
    const author = options.author || 'Your Name';
    const description = options.description || 'An Axon plugin';
    const version = options.version || '1.0.0';

    return `
// ${name} - Axon Plugin

export default {
  metadata: {
    name: '${name}',
    version: '${version}',
    description: '${description}',
    author: '${author}',
    engines: {
      'claude-code': '^2.0.0',
      'node': '>=18.0.0'
    }
  },

  async init(context) {
    context.logger.info('Initializing ${name} plugin');
    // Plugin initialization code
  },

  async activate(context) {
    context.logger.info('Activating ${name} plugin');

    // Register tools
    // context.tools.register({
    //   name: 'my-tool',
    //   description: 'My custom tool',
    //   inputSchema: {
    //     type: 'object',
    //     properties: {},
    //     required: []
    //   }
    // });

    // Register commands
    // context.commands.register({
    //   name: 'my-command',
    //   description: 'My custom command',
    //   async execute(args, ctx) {
    //     ctx.logger.info('Executing command');
    //   }
    // });

    // Register hooks
    // context.hooks.on('beforeMessage', async (msg) => {
    //   // Process message
    //   return msg;
    // });
  },

  async deactivate() {
    console.log('Deactivating ${name} plugin');
  },

  // Optional: Execute tool
  async executeTool(toolName, input) {
    // Handle tool execution
    return { success: true, output: 'Tool executed' };
  }
};
`.trim();
  },
};

// ============ 插件自动更新 (v2.1.2+) ============

import {
  shouldSkipPluginAutoUpdate,
  isForcePluginAutoUpdateEnabled,
  isAutoUpdaterDisabled,
  getAutoUpdaterDisabledReason,
} from '../utils/env-check.js';

/**
 * 插件更新状态
 */
export interface PluginUpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  updateAvailable?: boolean;
  changelog?: string;
}

/**
 * 插件自动更新器
 * 实现 FORCE_AUTOUPDATE_PLUGINS 环境变量功能 (v2.1.2)
 *
 * 官网 changelog:
 * "Added FORCE_AUTOUPDATE_PLUGINS environment variable to allow plugin autoupdate
 *  even when the main auto-updater is disabled"
 */
export class PluginAutoUpdater {
  private manager: PluginManager;
  private updateCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastUpdateCheck: Date | null = null;
  private pendingUpdates: Map<string, PluginUpdateInfo> = new Map();

  constructor(manager: PluginManager) {
    this.manager = manager;
  }

  /**
   * 检查是否应该跳过插件自动更新
   * 官网源码实现:
   * function BOA(){return Ku()&&!i1(process.env.FORCE_AUTOUPDATE_PLUGINS)}
   */
  shouldSkipAutoUpdate(): boolean {
    return shouldSkipPluginAutoUpdate();
  }

  /**
   * 检查是否强制启用插件自动更新
   */
  isForceUpdateEnabled(): boolean {
    return isForcePluginAutoUpdateEnabled();
  }

  /**
   * 启动自动更新检查
   * @param intervalMs 检查间隔（毫秒），默认 1 小时
   */
  startAutoUpdate(intervalMs: number = 60 * 60 * 1000): void {
    // 检查是否应该跳过自动更新
    if (this.shouldSkipAutoUpdate()) {
      console.log('[Plugins] Auto-update: skipped (auto-updater disabled)');
      return;
    }

    // 如果是因为 FORCE_AUTOUPDATE_PLUGINS 启用而允许更新，记录日志
    if (isAutoUpdaterDisabled() && this.isForceUpdateEnabled()) {
      console.log('[Plugins] Force auto-update enabled via FORCE_AUTOUPDATE_PLUGINS environment variable');
    }

    // 立即执行一次检查
    this.checkForUpdates().catch(err => {
      console.error('[Plugins] Auto-update check failed:', err);
    });

    // 设置定期检查
    this.updateCheckInterval = setInterval(() => {
      this.checkForUpdates().catch(err => {
        console.error('[Plugins] Auto-update check failed:', err);
      });
    }, intervalMs);
  }

  /**
   * 停止自动更新检查
   */
  stopAutoUpdate(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }
  }

  /**
   * 检查所有已安装插件的更新
   */
  async checkForUpdates(): Promise<Map<string, PluginUpdateInfo>> {
    // 再次检查是否应该跳过
    if (this.shouldSkipAutoUpdate()) {
      console.log('[Plugins] Plugin autoupdate: skipped (auto-updater disabled)');
      return new Map();
    }

    this.lastUpdateCheck = new Date();
    const updates = new Map<string, PluginUpdateInfo>();
    const installedPlugins = this.manager.getPluginStates();

    if (installedPlugins.length === 0) {
      return updates;
    }

    console.log(`[Plugins] Checking updates for ${installedPlugins.length} plugins...`);

    for (const state of installedPlugins) {
      if (!state.loaded) continue;

      try {
        const updateInfo = await this.checkPluginUpdate(state);
        if (updateInfo.hasUpdate) {
          updates.set(state.metadata.name, updateInfo);
          this.pendingUpdates.set(state.metadata.name, updateInfo);
          console.log(`[Plugins] Update available: ${state.metadata.name} ${updateInfo.currentVersion} -> ${updateInfo.latestVersion}`);
        }
      } catch (err) {
        console.warn(`[Plugins] Failed to check update for ${state.metadata.name}:`, err);
      }
    }

    this.manager.emit('plugins:updates-checked', updates);
    return updates;
  }

  /**
   * 检查单个插件的更新
   */
  private async checkPluginUpdate(state: PluginState): Promise<PluginUpdateInfo> {
    const name = state.metadata.name;
    const currentVersion = state.metadata.version;

    // 这里应该从远程仓库获取最新版本信息
    // 由于是本地实现，这里模拟返回当前版本（无更新）
    // 实际实现需要根据插件来源（marketplace、git、npm 等）获取最新版本

    return {
      name,
      currentVersion,
      latestVersion: currentVersion, // 模拟：当前已是最新版本
      hasUpdate: false,
    };
  }

  /**
   * 更新指定插件
   */
  async updatePlugin(name: string): Promise<boolean> {
    if (this.shouldSkipAutoUpdate()) {
      console.log(`[Plugins] Cannot update ${name}: auto-updater disabled`);
      return false;
    }

    const state = this.manager.getPluginState(name);
    if (!state) {
      console.error(`[Plugins] Plugin not found: ${name}`);
      return false;
    }

    const updateInfo = this.pendingUpdates.get(name);
    if (!updateInfo || !updateInfo.hasUpdate) {
      console.log(`[Plugins] No update available for ${name}`);
      return false;
    }

    try {
      console.log(`[Plugins] Updating ${name} from ${updateInfo.currentVersion} to ${updateInfo.latestVersion}...`);

      // 这里应该执行实际的更新逻辑
      // 1. 下载新版本
      // 2. 卸载旧版本
      // 3. 安装新版本
      // 4. 重新加载插件

      // 模拟更新成功
      this.pendingUpdates.delete(name);
      this.manager.emit('plugin:updated', name, updateInfo);
      console.log(`[Plugins] Successfully updated ${name} to ${updateInfo.latestVersion}`);
      return true;
    } catch (err) {
      console.error(`[Plugins] Failed to update ${name}:`, err);
      return false;
    }
  }

  /**
   * 更新所有有更新的插件
   */
  async updateAll(): Promise<{ success: string[]; failed: string[] }> {
    const success: string[] = [];
    const failed: string[] = [];

    const names = Array.from(this.pendingUpdates.keys());
    for (const name of names) {
      const result = await this.updatePlugin(name);
      if (result) {
        success.push(name);
      } else {
        failed.push(name);
      }
    }

    return { success, failed };
  }

  /**
   * 获取待更新的插件列表
   */
  getPendingUpdates(): PluginUpdateInfo[] {
    return Array.from(this.pendingUpdates.values());
  }

  /**
   * 获取上次更新检查时间
   */
  getLastUpdateCheck(): Date | null {
    return this.lastUpdateCheck;
  }

  /**
   * 获取自动更新状态信息
   */
  getStatus(): {
    enabled: boolean;
    reason?: string;
    forceEnabled: boolean;
    lastCheck: Date | null;
    pendingUpdates: number;
  } {
    const disabled = isAutoUpdaterDisabled();
    const forceEnabled = this.isForceUpdateEnabled();
    const skipUpdate = this.shouldSkipAutoUpdate();

    return {
      enabled: !skipUpdate,
      reason: disabled ? getAutoUpdaterDisabledReason() || undefined : undefined,
      forceEnabled,
      lastCheck: this.lastUpdateCheck,
      pendingUpdates: this.pendingUpdates.size,
    };
  }
}

/**
 * 默认插件自动更新器实例
 */
export const pluginAutoUpdater = new PluginAutoUpdater(pluginManager);

/**
 * 启动插件自动更新（在应用启动时调用）
 * 官网源码实现参考:
 * function TA9(){(async()=>{
 *   if(BOA()){k("Plugin autoupdate: skipped (auto-updater disabled)");return}
 *   try{let A=await qt5();if(A.size===0)...
 * })()}
 */
export async function startPluginAutoUpdate(): Promise<void> {
  // 检查是否应该跳过
  if (shouldSkipPluginAutoUpdate()) {
    console.log('[Plugins] Plugin autoupdate: skipped (auto-updater disabled)');
    return;
  }

  // 如果是强制启用，记录日志
  if (isAutoUpdaterDisabled() && isForcePluginAutoUpdateEnabled()) {
    console.log('[Plugins] Force auto-update enabled via FORCE_AUTOUPDATE_PLUGINS environment variable');
  }

  try {
    const updates = await pluginAutoUpdater.checkForUpdates();
    if (updates.size === 0) {
      console.log('[Plugins] All plugins are up to date');
    } else {
      console.log(`[Plugins] ${updates.size} plugin update(s) available`);
    }
  } catch (err) {
    console.error('[Plugins] Failed to check for plugin updates:', err);
  }
}

// 导出环境变量检查函数以便外部使用
export {
  shouldSkipPluginAutoUpdate,
  isForcePluginAutoUpdateEnabled,
  isAutoUpdaterDisabled,
  getAutoUpdaterDisabledReason,
};

// 导出插件市场管理器
export { MarketplaceManager } from './marketplace.js';

