/**
 * 插件市场管理 - 还原官方 CLI 实现
 *
 * 架构对应关系：
 *   配置文件: ~/.axon/known_marketplaces.json
 *   缓存目录: ~/.axon/marketplaces/{name}/
 *   插件清单: {cache}/.claude-plugin/marketplace.json
 *   插件缓存: ~/.axon/cache/{marketplace}/{name}/{version}/
 *
 * pluginId 格式: "plugin-name@marketplace-name"
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PluginManager, PluginState } from './index.js';

const execFileAsync = promisify(execFile);

// ============ 类型定义 (对应官方 schema) ============

/** marketplace source 类型 (discriminated union) */
export type MarketplaceSource =
  | { source: 'github'; repo: string; ref?: string; path?: string }
  | { source: 'git'; url: string; ref?: string; path?: string }
  | { source: 'url'; url: string; headers?: Record<string, string> }
  | { source: 'directory'; path: string }
  | { source: 'file'; path: string };

/** known_marketplaces.json 中的单个条目 */
export interface KnownMarketplaceEntry {
  source: MarketplaceSource;
  installLocation: string;
  lastUpdated: string;
  autoUpdate?: boolean;
}

/** .claude-plugin/marketplace.json 中的插件条目 */
export interface MarketplacePluginEntry {
  name: string;
  version?: string;
  description?: string;
  author?: string | { name: string; email?: string; url?: string };
  source: string | { source: string; [key: string]: any };
  category?: string;
  tags?: string[];
}

/** .claude-plugin/marketplace.json 顶层结构 */
export interface MarketplaceManifest {
  name: string;
  plugins: MarketplacePluginEntry[];
  metadata?: {
    pluginRoot?: string;
    version?: string;
    description?: string;
  };
}

/** 兼容前端的插件信息 */
export interface MarketplacePluginInfo {
  pluginId: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  marketplaceName?: string;
  installCount?: number;
  tags?: string[];
}

// ============ Git 环境 (对应官方 od4 变量) ============

const GIT_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
};

function getGitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...GIT_ENV };
}

function getConfigDir(): string {
  return process.env.AXON_CONFIG_DIR || path.join(os.homedir(), '.axon');
}

// ============ 解析 pluginId (对应官方 ho 函数) ============

export function parsePluginId(pluginId: string): { name: string; marketplace?: string } {
  if (pluginId.includes('@')) {
    const parts = pluginId.split('@');
    return { name: parts[0] || '', marketplace: parts[1] };
  }
  return { name: pluginId };
}

export function makePluginId(name: string, marketplace: string): string {
  return `${name}@${marketplace}`;
}

// ============ 路径函数 (对应官方) ============

/** ~/.axon/known_marketplaces.json */
function getKnownMarketplacesPath(): string {
  return path.join(getConfigDir(), 'known_marketplaces.json');
}

/** ~/.axon/marketplaces/ */
function getMarketplacesCacheDir(): string {
  return path.join(getConfigDir(), 'marketplaces');
}

/** ~/.axon/cache/ */
function getPluginCacheDir(): string {
  return path.join(getConfigDir(), 'cache');
}

/** ~/.axon/installed_plugins.json */
function getInstalledPluginsPath(): string {
  return path.join(getConfigDir(), 'installed_plugins.json');
}

/** 生成插件版本化缓存路径: ~/.axon/cache/{marketplace}/{name}/{version}/ */
function getPluginVersionedPath(pluginId: string, version: string): string {
  const { name, marketplace } = parsePluginId(pluginId);
  const marketplaceSafe = (marketplace || 'unknown').replace(/[^a-zA-Z0-9\-_]/g, '-');
  const nameSafe = (name || pluginId).replace(/[^a-zA-Z0-9\-_]/g, '-');
  const versionSafe = version.replace(/[^a-zA-Z0-9\-_.]/g, '-');
  return path.join(getPluginCacheDir(), marketplaceSafe, nameSafe, versionSafe);
}

// ============ 配置文件读写 (对应官方 g5/aW1) ============

async function loadKnownMarketplaces(): Promise<Record<string, KnownMarketplaceEntry>> {
  const configPath = getKnownMarketplacesPath();
  if (!fs.existsSync(configPath)) return {};

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[Marketplace] Failed to load known_marketplaces.json:', err);
    return {};
  }
}

async function saveKnownMarketplaces(config: Record<string, KnownMarketplaceEntry>): Promise<void> {
  const configPath = getKnownMarketplacesPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// ============ Marketplace 数据读取 (对应官方 RW6/AZ) ============

/** 从缓存目录读取 .claude-plugin/marketplace.json */
function readMarketplaceManifest(installLocation: string): MarketplaceManifest | null {
  try {
    let manifestPath: string;

    if (fs.existsSync(installLocation) && fs.statSync(installLocation).isDirectory()) {
      manifestPath = path.join(installLocation, '.claude-plugin', 'marketplace.json');
    } else {
      manifestPath = installLocation;
    }

    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error('[Marketplace] Failed to read marketplace manifest:', err);
    return null;
  }
}

// ============ Git 操作 (对应官方 rW1/uyY/IyY) ============

/** 执行 git 命令 (使用 execFile 避免 shell 转义问题) */
async function execGit(args: string[], options?: {
  cwd?: string;
  timeout?: number;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: options?.cwd,
      timeout: options?.timeout || 30000,
      env: getGitEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err: any) {
    return {
      code: err.code || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || (err instanceof Error ? err.message : String(err)),
    };
  }
}

/** 克隆仓库 (对应官方 uyY) */
async function gitClone(url: string, destDir: string, ref?: string): Promise<void> {
  const args = [
    '-c', 'core.sshCommand=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new',
    'clone', '--depth', '1', '--recurse-submodules', '--shallow-submodules',
  ];
  if (ref) args.push('--branch', ref);
  args.push(url, destDir);

  const result = await execGit(args, { timeout: 30000 });
  if (result.code !== 0) {
    throw new Error(`Failed to clone repository: ${result.stderr}`);
  }
}

/** 更新仓库 (对应官方 IyY) */
async function gitPull(repoDir: string, ref?: string): Promise<void> {
  const args = ref
    ? ['pull', 'origin', ref]
    : ['pull', 'origin', 'HEAD'];

  const result = await execGit(args, { cwd: repoDir, timeout: 30000 });
  if (result.code !== 0) {
    throw new Error(`Failed to update repository: ${result.stderr}`);
  }
}

// ============ Marketplace 获取/刷新 (对应官方 kLA/rs) ============

/** 获取/刷新 marketplace (对应官方 kLA) */
async function fetchMarketplace(
  source: MarketplaceSource,
  onProgress?: (msg: string) => void,
): Promise<{ manifest: MarketplaceManifest; cachePath: string }> {
  const cacheDir = getMarketplacesCacheDir();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  let installDir: string;
  let manifestPath: string;
  let cloned = false;

  switch (source.source) {
    case 'github': {
      const httpsUrl = `https://github.com/${source.repo}.git`;
      installDir = path.join(cacheDir, source.repo.replace(/\//g, '-'));
      cloned = true;

      onProgress?.(`Cloning via HTTPS: ${httpsUrl}`);
      console.log(`[Marketplace] Cloning: ${httpsUrl}`);

      if (fs.existsSync(installDir) && fs.existsSync(path.join(installDir, '.git'))) {
        // 已存在，拉取更新
        try {
          await gitPull(installDir, source.ref);
        } catch {
          // 更新失败，删除重新克隆
          fs.rmSync(installDir, { recursive: true, force: true });
          await gitClone(httpsUrl, installDir, source.ref);
        }
      } else {
        if (fs.existsSync(installDir)) {
          fs.rmSync(installDir, { recursive: true, force: true });
        }
        await gitClone(httpsUrl, installDir, source.ref);
      }

      manifestPath = path.join(installDir, source.path || '.claude-plugin/marketplace.json');
      break;
    }

    case 'git': {
      const urlHash = source.url.replace(/[^a-zA-Z0-9]/g, '-');
      installDir = path.join(cacheDir, urlHash);
      cloned = true;

      onProgress?.(`Cloning: ${source.url}`);

      if (fs.existsSync(installDir) && fs.existsSync(path.join(installDir, '.git'))) {
        try {
          await gitPull(installDir, source.ref);
        } catch {
          fs.rmSync(installDir, { recursive: true, force: true });
          await gitClone(source.url, installDir, source.ref);
        }
      } else {
        if (fs.existsSync(installDir)) {
          fs.rmSync(installDir, { recursive: true, force: true });
        }
        await gitClone(source.url, installDir, source.ref);
      }

      manifestPath = path.join(installDir, source.path || '.claude-plugin/marketplace.json');
      break;
    }

    case 'directory': {
      installDir = source.path;
      cloned = false;
      manifestPath = path.join(source.path, '.claude-plugin', 'marketplace.json');
      break;
    }

    case 'file': {
      installDir = path.dirname(source.path);
      cloned = false;
      manifestPath = source.path;
      break;
    }

    case 'url':
    default:
      throw new Error(`Marketplace source type "${source.source}" not yet supported`);
  }

  if (!fs.existsSync(manifestPath)) {
    // 如果克隆成功但清单不存在，清理目录
    if (cloned && installDir) {
      try { fs.rmSync(installDir, { recursive: true, force: true }); } catch {}
    }
    throw new Error(`Marketplace manifest not found at ${manifestPath}`);
  }

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const manifest: MarketplaceManifest = JSON.parse(content);

  // 官方逻辑: 重命名目录为 marketplace name
  const finalDir = path.join(cacheDir, manifest.name);
  if (installDir !== finalDir && cloned) {
    try {
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true });
      }
      fs.renameSync(installDir, finalDir);
      installDir = finalDir;
    } catch (err) {
      console.warn('[Marketplace] Failed to rename cache dir:', err);
    }
  }

  return { manifest, cachePath: installDir };
}

// ============ 插件目录复制工具 ============

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.git') continue; // 跳过 .git
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ============ 默认 marketplace (对应官方 e51/j6z/vxA) ============

const DEFAULT_MARKETPLACES: Array<{ name: string; repo: string; source: MarketplaceSource }> = [
  {
    name: 'claude-plugins-official',
    repo: 'anthropics/claude-plugins-official',
    source: { source: 'github', repo: 'anthropics/claude-plugins-official' },
  },
  {
    name: 'anthropic-agent-skills',
    repo: 'anthropics/skills',
    source: { source: 'github', repo: 'anthropics/skills' },
  },
];

// ============ MarketplaceManager (主类) ============

export class MarketplaceManager {
  private pluginManager: PluginManager;

  constructor(pluginManager: PluginManager) {
    this.pluginManager = pluginManager;

    // 确保基础目录存在
    for (const dir of [getMarketplacesCacheDir(), getPluginCacheDir()]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  // ============ 默认 marketplace 自动注册 (对应官方 thinkback 安装流程) ============

  /** 确保默认 marketplace 已注册，未注册则自动添加 */
  async ensureDefaultMarketplace(
    onProgress?: (msg: string) => void,
  ): Promise<void> {
    const known = await loadKnownMarketplaces();

    for (const mp of DEFAULT_MARKETPLACES) {
      if (known[mp.name]) {
        continue; // 已存在
      }

      try {
        console.log(`[Marketplace] Auto-adding default marketplace: ${mp.name}`);
        onProgress?.(`Installing marketplace ${mp.repo}`);

        const { manifest, cachePath } = await fetchMarketplace(mp.source, onProgress);

        known[manifest.name] = {
          source: mp.source,
          installLocation: cachePath,
          lastUpdated: new Date().toISOString(),
        };

        await saveKnownMarketplaces(known);
        console.log(`[Marketplace] Default marketplace installed: ${manifest.name} (${manifest.plugins.length} plugins)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Marketplace] Failed to auto-add default marketplace ${mp.name}: ${msg}`);
        // 不抛异常，不阻塞启动，继续下一个
      }
    }
  }

  // ============ Marketplace 管理 ============

  /** 获取所有已知 marketplace (对应官方 g5) */
  async getMarketplaces(): Promise<Record<string, KnownMarketplaceEntry>> {
    return await loadKnownMarketplaces();
  }

  /** 添加 marketplace (对应官方 uv) */
  async addMarketplace(
    source: MarketplaceSource,
    onProgress?: (msg: string) => void,
  ): Promise<{ name: string }> {
    const { manifest, cachePath } = await fetchMarketplace(source, onProgress);

    const known = await loadKnownMarketplaces();
    if (known[manifest.name]) {
      throw new Error(`Marketplace '${manifest.name}' is already installed. Remove it first.`);
    }

    known[manifest.name] = {
      source,
      installLocation: cachePath,
      lastUpdated: new Date().toISOString(),
    };

    await saveKnownMarketplaces(known);
    console.log(`[Marketplace] Added marketplace: ${manifest.name}`);

    return { name: manifest.name };
  }

  /** 删除 marketplace (对应官方 CW6) */
  async removeMarketplace(name: string): Promise<void> {
    const known = await loadKnownMarketplaces();
    if (!known[name]) {
      throw new Error(`Marketplace '${name}' not found`);
    }

    // 清理缓存目录
    const installLocation = known[name].installLocation;
    if (fs.existsSync(installLocation)) {
      fs.rmSync(installLocation, { recursive: true, force: true });
    }

    delete known[name];
    await saveKnownMarketplaces(known);
    console.log(`[Marketplace] Removed marketplace: ${name}`);
  }

  /** 刷新 marketplace (对应官方 rs) */
  async refreshMarketplace(
    name: string,
    onProgress?: (msg: string) => void,
  ): Promise<void> {
    const known = await loadKnownMarketplaces();
    const entry = known[name];
    if (!entry) {
      throw new Error(`Marketplace '${name}' not found. Available: ${Object.keys(known).join(', ')}`);
    }

    await fetchMarketplace(entry.source, onProgress);
    known[name].lastUpdated = new Date().toISOString();
    await saveKnownMarketplaces(known);
  }

  // ============ 插件发现 ============

  /** 从 marketplace manifest 获取可用插件列表 */
  async listAvailablePlugins(marketplaceName?: string): Promise<MarketplacePluginInfo[]> {
    const known = await loadKnownMarketplaces();
    const results: MarketplacePluginInfo[] = [];

    const marketplaces = marketplaceName
      ? [[marketplaceName, known[marketplaceName]] as const].filter(([, v]) => v)
      : Object.entries(known);

    for (const [name, entry] of marketplaces) {
      if (!entry) continue;

      const manifest = readMarketplaceManifest(entry.installLocation);
      if (!manifest) continue;

      for (const plugin of manifest.plugins) {
        results.push({
          pluginId: makePluginId(plugin.name, name as string),
          name: plugin.name,
          version: plugin.version || '0.0.0',
          description: plugin.description,
          author: typeof plugin.author === 'object' ? plugin.author?.name : plugin.author,
          marketplaceName: name as string,
          tags: plugin.tags,
        });
      }
    }

    return results;
  }

  // ============ 插件安装 (对应官方 W7q + Bv) ============

  async installPlugin(pluginId: string): Promise<{
    success: boolean;
    plugin?: PluginState;
    error?: string;
  }> {
    try {
      console.log(`[Marketplace] Installing plugin: ${pluginId}`);
      const { name, marketplace } = parsePluginId(pluginId);
      console.log(`[Marketplace] Parsed: name=${name}, marketplace=${marketplace}`);

      if (!name) {
        console.log('[Marketplace] Invalid plugin ID (empty name)');
        return { success: false, error: 'Invalid plugin ID' };
      }

      // 1. 在 marketplace 中查找插件 (对应官方 f0)
      let pluginEntry: MarketplacePluginEntry | null = null;
      let marketplaceName: string | null = null;
      let installLocation: string | null = null;

      const known = await loadKnownMarketplaces();
      console.log(`[Marketplace] Known marketplaces: ${JSON.stringify(Object.keys(known))}`);

      if (marketplace) {
        // 指定了 marketplace
        const entry = known[marketplace];
        if (!entry) {
          const errMsg = `Marketplace '${marketplace}' not found. Available: ${Object.keys(known).join(', ') || 'none'}. Use 'plugin marketplace add' to add one.`;
          console.log(`[Marketplace] ${errMsg}`);
          return {
            success: false,
            error: errMsg,
          };
        }

        const manifest = readMarketplaceManifest(entry.installLocation);
        if (!manifest) {
          // 缓存不存在或损坏，尝试重新获取
          console.log(`[Marketplace] Cache missing for ${marketplace}, fetching...`);
          try {
            await this.refreshMarketplace(marketplace);
            const refreshed = readMarketplaceManifest(entry.installLocation);
            if (refreshed) {
              pluginEntry = refreshed.plugins.find(p => p.name === name) || null;
            }
          } catch (fetchErr) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            return { success: false, error: `Failed to fetch marketplace '${marketplace}': ${msg}` };
          }
        } else {
          pluginEntry = manifest.plugins.find(p => p.name === name) || null;
        }

        marketplaceName = marketplace;
        installLocation = entry.installLocation;
      } else {
        // 未指定 marketplace，搜索所有
        for (const [mName, entry] of Object.entries(known)) {
          const manifest = readMarketplaceManifest(entry.installLocation);
          if (!manifest) continue;

          const found = manifest.plugins.find(p => p.name === name);
          if (found) {
            pluginEntry = found;
            marketplaceName = mName;
            installLocation = entry.installLocation;
            break;
          }
        }
      }

      if (!pluginEntry || !marketplaceName || !installLocation) {
        const scope = marketplace ? `marketplace "${marketplace}"` : 'any configured marketplace';
        return { success: false, error: `Plugin "${name}" not found in ${scope}` };
      }

      // 2. 解析插件源路径
      const fullPluginId = makePluginId(pluginEntry.name, marketplaceName);
      const version = pluginEntry.version || '1.0.0';
      let pluginSourceDir: string;

      if (typeof pluginEntry.source === 'string') {
        // 相对路径 (如 "plugins/frontend-design")
        pluginSourceDir = path.join(installLocation, pluginEntry.source);
      } else {
        // 复杂 source 对象 - 暂只支持字符串
        return { success: false, error: `Complex plugin sources not yet supported` };
      }

      if (!fs.existsSync(pluginSourceDir)) {
        return {
          success: false,
          error: `Plugin source directory not found: ${pluginSourceDir}`,
        };
      }

      // 3. 复制到版本化缓存目录 (对应官方 Bv + hW6)
      const versionedDir = getPluginVersionedPath(fullPluginId, version);
      if (!fs.existsSync(versionedDir)) {
        fs.mkdirSync(path.dirname(versionedDir), { recursive: true });
        copyDirRecursive(pluginSourceDir, versionedDir);
        console.log(`[Marketplace] Cached plugin at: ${versionedDir}`);
      }

      // 4. 确保有 package.json
      this.ensurePackageJson(versionedDir, pluginEntry.name, marketplaceName, version);

      // 4.5 处理 .mcp.json — 自动注册 MCP server 到 settings.json
      this.registerMcpServers(versionedDir, pluginEntry.name);

      // 4.6 处理 marketplace entry 中的 lspServers（仅记录日志，暂无 LSP 子系统）
      if ((pluginEntry as any).lspServers) {
        const serverNames = Object.keys((pluginEntry as any).lspServers);
        console.log(`[Marketplace] Plugin ${pluginEntry.name} declares LSP servers: ${serverNames.join(', ')} (not auto-started, install the language server binary manually)`);
      }

      // 5. 用 PluginManager 安装
      const state = await this.pluginManager.install(versionedDir, {
        autoLoad: true,
        enableHotReload: false,
      });

      // 6. 记录安装信息
      this.recordInstall(fullPluginId, {
        version,
        installedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        installPath: versionedDir,
      });

      console.log(`[Marketplace] Plugin installed: ${fullPluginId}@${version}`);
      return { success: true, plugin: state };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Marketplace] Install failed:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  // ============ 工具方法 ============

  /** 确保插件有 package.json (对应官方 skill 自动生成) */
  private ensurePackageJson(
    pluginDir: string,
    pluginName: string,
    marketplaceName: string,
    version: string,
  ): void {
    const pkgPath = path.join(pluginDir, 'package.json');
    if (fs.existsSync(pkgPath)) return;

    console.log(`[Marketplace] Generating package.json for: ${pluginName}`);

    const pkg = {
      name: pluginName,
      version,
      description: `Plugin from ${marketplaceName}`,
      main: 'index.js',
      engines: { 'claude-code': '>=2.0.0' },
    };

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

    // 生成 index.js（空壳）
    const indexPath = path.join(pluginDir, 'index.js');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, `module.exports = {
  metadata: ${JSON.stringify(pkg, null, 2)},
  async activate(context) { context.logger?.info('Plugin ${pluginName} activated'); },
  async deactivate() {},
};
`);
    }
  }

  /**
   * 读取插件目录中的 .mcp.json，自动注册 MCP server 到 settings.json
   * 对应官方 _M8 / OM8 / eE9 函数
   *
   * .mcp.json 格式示例 (context7 插件):
   *   { "context7": { "command": "npx", "args": ["-y", "@upstash/context7-mcp"] } }
   */
  private registerMcpServers(pluginDir: string, pluginName: string): void {
    const mcpJsonPath = path.join(pluginDir, '.mcp.json');
    if (!fs.existsSync(mcpJsonPath)) return;

    try {
      const raw = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf-8'));
      // .mcp.json 可以是 { serverName: config } 或 { mcpServers: { serverName: config } }
      const servers: Record<string, any> = raw.mcpServers || raw;

      const settingsPath = path.join(os.homedir(), '.axon', 'settings.json');
      let settings: any = {};
      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      }
      if (!settings.mcpServers) settings.mcpServers = {};

      let registered = 0;
      for (const [serverName, config] of Object.entries(servers)) {
        if (!config || typeof config !== 'object') continue;

        // 命名空间：plugin:{pluginName}:{serverName}（对应官方 eE9 函数）
        const key = `plugin:${pluginName}:${serverName}`;

        // 如果已经存在同名 server（不含 plugin: 前缀的原始名也检查），跳过
        if (settings.mcpServers[key] || settings.mcpServers[serverName]) {
          console.log(`[Marketplace] MCP server ${key} already registered, skipping`);
          continue;
        }

        // 构建 stdio 类型的 MCP server 配置
        const mcpConfig: any = {
          type: config.type || 'stdio',
          ...(config.command && { command: config.command }),
          ...(config.args && { args: config.args }),
          ...(config.env && { env: config.env }),
          ...(config.url && { url: config.url }),
          enabled: true,
        };

        settings.mcpServers[key] = mcpConfig;
        registered++;
        console.log(`[Marketplace] Registered MCP server: ${key}`);
      }

      if (registered > 0) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        console.log(`[Marketplace] Registered ${registered} MCP server(s) from plugin ${pluginName}`);
      }
    } catch (err) {
      console.warn(`[Marketplace] Failed to register MCP servers from ${pluginName}:`, err);
    }
  }

  /** 记录安装信息到 installed_plugins.json (对应官方 U_A) */
  private recordInstall(pluginId: string, info: {
    version: string;
    installedAt: string;
    lastUpdated: string;
    installPath: string;
  }): void {
    try {
      const filePath = getInstalledPluginsPath();
      let records: Record<string, any> = {};

      if (fs.existsSync(filePath)) {
        records = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }

      if (!records.plugins) records.plugins = {};
      if (!records.plugins[pluginId]) records.plugins[pluginId] = [];

      records.plugins[pluginId].push({
        ...info,
        scope: 'user',
      });

      fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
    } catch (err) {
      console.warn('[Marketplace] Failed to record install:', err);
    }
  }
}
