/**
 * 插件系统 CLI 命令
 * 提供插件的安装、卸载、启用、禁用、列表等功能
 */

import { Command } from 'commander';
import { pluginManager } from './index.js';
import { escapePathForShell, isWindows } from '../utils/platform.js';

/**
 * 创建插件 CLI 命令
 */
export function createPluginCommand(): Command {
  const pluginCommand = new Command('plugin');
  pluginCommand.description('Manage Axon plugins');

  // claude plugin validate <path> - 官方命令，验证插件清单
  pluginCommand
    .command('validate <path>')
    .description('Validate a plugin or marketplace manifest')
    .action(async (pluginPath) => {
      await validatePlugin(pluginPath);
    });

  // claude plugin marketplace - 官方命令，管理市场
  pluginCommand
    .command('marketplace')
    .description('Manage Axon marketplaces')
    .action(async () => {
      await manageMarketplace();
    });

  // claude plugin list - 额外命令，保留（虽然官方没有，但很有用）
  pluginCommand
    .command('list')
    .alias('ls')
    .description('List all installed plugins')
    .option('-a, --all', 'Show all plugins including disabled ones')
    .option('-v, --verbose', 'Show detailed information')
    .action(async (options) => {
      await listPlugins(options);
    });

  // claude plugin install <plugin> - 官方命令
  // v2.1.14: 添加 --sha 选项支持固定到特定 git commit SHA
  pluginCommand
    .command('install <plugin>')
    .alias('i')
    .description('Install a plugin from available marketplaces')
    .option('--no-auto-load', 'Do not automatically load the plugin after installation')
    .option('--enable-hot-reload', 'Enable hot reload for the plugin')
    .option('--sha <commit>', 'Pin to a specific git commit SHA (for git sources only)')
    .action(async (plugin, options) => {
      await installPlugin(plugin, options);
    });

  // claude plugin uninstall <plugin> - 官方命令（主命令是 uninstall，别名是 remove）
  pluginCommand
    .command('uninstall <plugin>')
    .alias('remove')
    .description('Uninstall an installed plugin')
    .action(async (plugin) => {
      await removePlugin(plugin);
    });

  // claude plugin enable <plugin> - 官方命令
  pluginCommand
    .command('enable <plugin>')
    .description('Enable a disabled plugin')
    .action(async (plugin) => {
      await enablePlugin(plugin);
    });

  // claude plugin disable <plugin> - 官方命令
  pluginCommand
    .command('disable <plugin>')
    .description('Disable an enabled plugin')
    .action(async (plugin) => {
      await disablePlugin(plugin);
    });

  // claude plugin update <plugin> - 官方命令
  pluginCommand
    .command('update <plugin>')
    .description('Update a plugin to the latest version')
    .action(async (plugin) => {
      await updatePlugin(plugin);
    });

  // claude plugin pin <plugin> <sha> - v2.1.14 新增命令
  pluginCommand
    .command('pin <plugin> <sha>')
    .description('Pin a git-based plugin to a specific commit SHA')
    .action(async (plugin, sha) => {
      await pinPlugin(plugin, sha);
    });

  // claude plugin unpin <plugin> - v2.1.14 新增命令
  pluginCommand
    .command('unpin <plugin>')
    .description('Unpin a plugin and allow updates to latest version')
    .action(async (plugin) => {
      await unpinPlugin(plugin);
    });

  // claude plugin info <plugin> - 额外命令，保留（虽然官方没有，但很有用）
  pluginCommand
    .command('info <plugin>')
    .description('Show detailed information about a plugin')
    .action(async (plugin) => {
      await showPluginInfo(plugin);
    });

  return pluginCommand;
}

/**
 * 列出所有插件
 */
async function listPlugins(options: { all?: boolean; verbose?: boolean }): Promise<void> {
  await pluginManager.discover();
  const plugins = pluginManager.getPluginStates();

  const filteredPlugins = options.all
    ? plugins
    : plugins.filter(p => p.enabled);

  if (filteredPlugins.length === 0) {
    console.log('No plugins found.');
    return;
  }

  console.log(`\n${'Name'.padEnd(30)} ${'Version'.padEnd(12)} ${'Status'.padEnd(10)} ${'Type'.padEnd(10)}`);
  console.log('─'.repeat(70));

  for (const plugin of filteredPlugins) {
    const name = plugin.metadata.name.padEnd(30);
    const version = plugin.metadata.version.padEnd(12);
    const status = plugin.loaded
      ? '✓ Loaded'.padEnd(10)
      : plugin.enabled
      ? '○ Enabled'.padEnd(10)
      : '✗ Disabled'.padEnd(10);
    const type = (plugin.path === '<inline>' ? 'Inline' : 'File').padEnd(10);

    console.log(`${name} ${version} ${status} ${type}`);

    if (options.verbose) {
      if (plugin.metadata.description) {
        console.log(`  Description: ${plugin.metadata.description}`);
      }
      if (plugin.path !== '<inline>') {
        console.log(`  Path: ${plugin.path}`);
      }
      if (plugin.dependencies.length > 0) {
        console.log(`  Dependencies: ${plugin.dependencies.join(', ')}`);
      }
      if (plugin.error) {
        console.log(`  Error: ${plugin.error}`);
      }
      console.log('');
    }
  }

  console.log(`\nTotal: ${filteredPlugins.length} plugin(s)`);
}

/**
 * 安装插件
 * v2.1.14: 添加 sha 选项支持固定到特定 git commit SHA
 */
async function installPlugin(
  pluginPath: string,
  options: { autoLoad?: boolean; enableHotReload?: boolean; sha?: string }
): Promise<void> {
  try {
    console.log(`Installing plugin from ${pluginPath}...`);

    // v2.1.14: 如果是 git URL 且指定了 SHA，先克隆到临时目录
    if (options.sha && (pluginPath.startsWith('git+') || pluginPath.includes('.git') || pluginPath.includes('github.com'))) {
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      // 创建临时目录
      const tempDir = path.join(os.tmpdir(), `claude-plugin-git-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      console.log(`  Cloning with pinned SHA: ${options.sha.substring(0, 8)}...`);

      // 使用带 SHA 的 git 克隆
      const success = await updateFromGit(pluginPath, tempDir, options.sha);
      if (!success) {
        throw new Error('Failed to clone repository with pinned SHA');
      }

      // 从临时目录安装
      const state = await pluginManager.install(tempDir, {
        autoLoad: options.autoLoad,
        enableHotReload: options.enableHotReload,
      });

      // 更新 package.json 中的源信息和 SHA
      const installedPath = state.path;
      const packageJsonPath = path.join(installedPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        packageJson._source = pluginPath;
        packageJson.gitCommitSha = options.sha;
        packageJson._updatedAt = new Date().toISOString();
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      }

      // 清理临时目录
      fs.rmSync(tempDir, { recursive: true });

      console.log(`✓ Successfully installed plugin: ${state.metadata.name}@${state.metadata.version}`);
      console.log(`  Pinned to SHA: ${options.sha}`);

      if (state.loaded) {
        console.log(`  Plugin is loaded and ready to use.`);
      }

      if (options.enableHotReload) {
        console.log(`  Hot reload is enabled.`);
      }
      return;
    }

    const state = await pluginManager.install(pluginPath, {
      autoLoad: options.autoLoad,
      enableHotReload: options.enableHotReload,
    });

    console.log(`✓ Successfully installed plugin: ${state.metadata.name}@${state.metadata.version}`);

    if (state.loaded) {
      console.log(`  Plugin is loaded and ready to use.`);
    }

    if (options.enableHotReload) {
      console.log(`  Hot reload is enabled.`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to install plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 移除插件
 */
async function removePlugin(pluginName: string): Promise<void> {
  try {
    console.log(`Removing plugin ${pluginName}...`);

    const success = await pluginManager.uninstall(pluginName);

    if (success) {
      console.log(`✓ Successfully removed plugin: ${pluginName}`);
    } else {
      console.error(`✗ Plugin not found: ${pluginName}`);
      process.exit(1);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to remove plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 启用插件
 */
async function enablePlugin(pluginName: string): Promise<void> {
  try {
    console.log(`Enabling plugin ${pluginName}...`);

    const success = await pluginManager.setEnabled(pluginName, true);

    if (success) {
      console.log(`✓ Successfully enabled plugin: ${pluginName}`);
    } else {
      console.error(`✗ Plugin not found: ${pluginName}`);
      process.exit(1);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to enable plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 禁用插件
 */
async function disablePlugin(pluginName: string): Promise<void> {
  try {
    console.log(`Disabling plugin ${pluginName}...`);

    const success = await pluginManager.setEnabled(pluginName, false);

    if (success) {
      console.log(`✓ Successfully disabled plugin: ${pluginName}`);
    } else {
      console.error(`✗ Plugin not found: ${pluginName}`);
      process.exit(1);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to disable plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 从 package.json 中获取插件的远程源信息
 * 支持的源格式：
 * - npm: 包名称（如 "claude-code-plugin-xxx"）
 * - git: git+https://github.com/xxx/yyy.git
 * - url: https://example.com/plugin.tar.gz
 *
 * v2.1.14: 支持固定到特定 git commit SHA
 */
interface PluginSourceInfo {
  type: 'npm' | 'git' | 'url' | 'local';
  source: string;
  currentVersion: string;
  /** v2.1.14: 固定的 git commit SHA */
  gitCommitSha?: string;
}

/**
 * 解析插件源信息
 * v2.1.14: 添加对 gitCommitSha 的支持
 */
async function getPluginSourceInfo(pluginPath: string): Promise<PluginSourceInfo | null> {
  const fs = await import('fs');
  const path = await import('path');

  const packageJsonPath = path.join(pluginPath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const currentVersion = packageJson.version || '0.0.0';
    // v2.1.14: 读取固定的 git commit SHA
    const gitCommitSha = packageJson.gitCommitSha || undefined;

    // 检查 package.json 中的 _source 字段（安装时记录的来源）
    if (packageJson._source) {
      const source = packageJson._source;
      if (source.startsWith('git+') || source.includes('.git')) {
        return { type: 'git', source, currentVersion, gitCommitSha };
      } else if (source.startsWith('http://') || source.startsWith('https://')) {
        return { type: 'url', source, currentVersion };
      } else if (source.startsWith('npm:')) {
        return { type: 'npm', source: source.slice(4), currentVersion };
      } else {
        // 假定为 npm 包名
        return { type: 'npm', source, currentVersion };
      }
    }

    // 检查 repository 字段
    if (packageJson.repository) {
      const repo = typeof packageJson.repository === 'string'
        ? packageJson.repository
        : packageJson.repository.url;
      if (repo && (repo.startsWith('git+') || repo.includes('github.com'))) {
        return { type: 'git', source: repo, currentVersion, gitCommitSha };
      }
    }

    // 如果包名看起来是 npm 格式，则假定可以从 npm 更新
    if (packageJson.name && !packageJson.name.startsWith('@local/')) {
      return { type: 'npm', source: packageJson.name, currentVersion };
    }

    // 无法确定远程源，只能本地重载
    return { type: 'local', source: pluginPath, currentVersion };
  } catch (err) {
    return null;
  }
}

/**
 * 从 npm 获取包的最新版本
 */
async function getNpmLatestVersion(packageName: string): Promise<string | null> {
  const https = await import('https');

  return new Promise((resolve) => {
    // 使用 npm registry API 获取最新版本
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null);
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.version || null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => {
      resolve(null);
    });
  });
}

/**
 * 比较语义化版本号
 * 返回: 1 表示 v1 > v2, -1 表示 v1 < v2, 0 表示相等
 */
function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => {
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return [0, 0, 0];
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  };

  const [major1, minor1, patch1] = parse(v1);
  const [major2, minor2, patch2] = parse(v2);

  if (major1 !== major2) return major1 > major2 ? 1 : -1;
  if (minor1 !== minor2) return minor1 > minor2 ? 1 : -1;
  if (patch1 !== patch2) return patch1 > patch2 ? 1 : -1;
  return 0;
}

/**
 * 使用 npm 安装/更新插件
 */
async function installFromNpm(packageName: string, targetDir: string): Promise<boolean> {
  const { execSync } = await import('child_process');
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  try {
    // 创建临时目录进行安装
    // 使用 path.join 确保路径分隔符正确
    const tempDir = path.join(os.tmpdir(), `claude-plugin-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`  Downloading ${packageName} from npm...`);

    // 使用 npm pack 下载包
    // 在 Windows 上确保路径安全
    const safeTempDir = escapePathForShell(tempDir);
    execSync(`npm pack ${packageName}`, { cwd: safeTempDir, stdio: 'pipe' });

    // 找到下载的 tgz 文件
    const files = fs.readdirSync(tempDir);
    const tgzFile = files.find(f => f.endsWith('.tgz'));

    if (!tgzFile) {
      console.error('  Failed to download package from npm');
      return false;
    }

    console.log(`  Extracting package...`);

    // 解压 tgz 文件
    // 在 Windows 上，使用转义后的路径确保安全
    const safeTgzFile = escapePathForShell(tgzFile);
    execSync(`tar -xzf "${safeTgzFile}"`, { cwd: safeTempDir, stdio: 'pipe' });

    // npm pack 解压后的目录通常是 'package'
    const extractedDir = path.join(tempDir, 'package');

    if (!fs.existsSync(extractedDir)) {
      console.error('  Failed to extract package');
      return false;
    }

    // 删除旧的插件目录
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true });
    }

    // 复制新版本到目标目录
    fs.cpSync(extractedDir, targetDir, { recursive: true });

    // 记录安装源
    const packageJsonPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      packageJson._source = `npm:${packageName}`;
      packageJson._updatedAt = new Date().toISOString();
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }

    // 清理临时目录
    fs.rmSync(tempDir, { recursive: true });

    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`  npm install error: ${errorMsg}`);
    return false;
  }
}

/**
 * 使用 git 更新插件
 * v2.1.7: 修复了 git submodules 未完全初始化的问题
 * - 克隆时使用 --recurse-submodules 和 --shallow-submodules 标志
 * - 拉取后执行 git submodule update --init --recursive
 *
 * v2.1.14: 支持固定到特定 git commit SHA
 * - 添加 gitCommitSha 参数，允许 checkout 到指定的 commit
 * - 这允许 marketplace 条目安装精确版本
 */
async function updateFromGit(gitUrl: string, targetDir: string, gitCommitSha?: string): Promise<boolean> {
  const { execSync } = await import('child_process');
  const fs = await import('fs');

  try {
    // 检查目标目录是否有 .git 目录
    const gitDir = `${targetDir}/.git`;

    if (fs.existsSync(gitDir)) {
      // 如果是 git 仓库
      if (gitCommitSha) {
        // v2.1.14: 如果指定了 SHA，fetch 并 checkout 到该 SHA
        console.log(`  Fetching and checking out pinned SHA: ${gitCommitSha.substring(0, 8)}...`);
        execSync('git fetch --all', { cwd: targetDir, stdio: 'pipe' });
        execSync(`git checkout ${gitCommitSha}`, { cwd: targetDir, stdio: 'pipe' });
      } else {
        // 执行 git pull
        console.log(`  Pulling latest changes from git...`);
        execSync('git pull', { cwd: targetDir, stdio: 'pipe' });
      }

      // v2.1.7: 拉取后更新子模块，确保子模块完全初始化
      console.log(`  Updating submodules...`);
      try {
        execSync('git submodule update --init --recursive', { cwd: targetDir, stdio: 'pipe' });
      } catch (submoduleErr) {
        // 子模块更新失败不应阻止主仓库更新成功
        const submoduleErrMsg = submoduleErr instanceof Error ? submoduleErr.message : String(submoduleErr);
        console.warn(`  Warning: submodule update failed: ${submoduleErrMsg}`);
      }
    } else {
      // 否则克隆仓库
      console.log(`  Cloning from ${gitUrl}...`);

      // 删除旧目录
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true });
      }

      // 规范化 git URL
      let cloneUrl = gitUrl;
      if (cloneUrl.startsWith('git+')) {
        cloneUrl = cloneUrl.slice(4);
      }

      // v2.1.7: 使用 --recurse-submodules 和 --shallow-submodules 克隆
      // 这确保子模块在克隆时就被完全初始化
      try {
        execSync(`git clone --recurse-submodules --shallow-submodules "${cloneUrl}" "${targetDir}"`, { stdio: 'pipe' });
      } catch (cloneErr) {
        // 如果带子模块克隆失败，尝试普通克隆后再初始化子模块
        const cloneErrMsg = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
        console.warn(`  Clone with submodules failed, trying fallback: ${cloneErrMsg}`);

        // 清理可能的部分克隆
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true });
        }

        // 普通克隆
        execSync(`git clone "${cloneUrl}" "${targetDir}"`, { stdio: 'pipe' });

        // 然后初始化子模块
        try {
          execSync('git submodule update --init --recursive', { cwd: targetDir, stdio: 'pipe' });
        } catch (submoduleErr) {
          const submoduleErrMsg = submoduleErr instanceof Error ? submoduleErr.message : String(submoduleErr);
          console.warn(`  Warning: submodule initialization failed: ${submoduleErrMsg}`);
        }
      }

      // v2.1.14: 如果指定了 SHA，checkout 到该 SHA
      if (gitCommitSha) {
        console.log(`  Checking out pinned SHA: ${gitCommitSha.substring(0, 8)}...`);
        try {
          execSync(`git checkout ${gitCommitSha}`, { cwd: targetDir, stdio: 'pipe' });
        } catch (checkoutErr) {
          // 如果是短 SHA，可能需要 fetch 更多历史
          console.log(`  SHA not found in shallow clone, fetching full history...`);
          execSync('git fetch --unshallow', { cwd: targetDir, stdio: 'pipe' });
          execSync(`git checkout ${gitCommitSha}`, { cwd: targetDir, stdio: 'pipe' });
        }
      }
    }

    // 记录更新源和固定的 SHA
    const packageJsonPath = `${targetDir}/package.json`;
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      packageJson._source = gitUrl;
      packageJson._updatedAt = new Date().toISOString();
      // v2.1.14: 记录固定的 SHA
      if (gitCommitSha) {
        packageJson.gitCommitSha = gitCommitSha;
      } else {
        // 如果没有固定 SHA，记录当前 HEAD 的 SHA
        try {
          const currentSha = execSync('git rev-parse HEAD', { cwd: targetDir, encoding: 'utf-8' }).trim();
          packageJson._currentSha = currentSha;
        } catch {
          // 忽略获取 SHA 失败的情况
        }
        delete packageJson.gitCommitSha;
      }
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }

    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`  git update error: ${errorMsg}`);
    return false;
  }
}

/**
 * 从 URL 更新插件（下载 tar.gz 或 zip）
 */
async function updateFromUrl(url: string, targetDir: string): Promise<boolean> {
  const https = await import('https');
  const http = await import('http');
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const { execSync } = await import('child_process');

  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const tempFile = path.join(os.tmpdir(), `claude-plugin-${Date.now()}.tar.gz`);

    console.log(`  Downloading from ${url}...`);

    const file = fs.createWriteStream(tempFile);

    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        console.error(`  Download failed: HTTP ${res.statusCode}`);
        resolve(false);
        return;
      }

      res.pipe(file);

      file.on('finish', () => {
        file.close();

        try {
          console.log(`  Extracting package...`);

          const tempExtract = path.join(os.tmpdir(), `claude-plugin-extract-${Date.now()}`);
          fs.mkdirSync(tempExtract, { recursive: true });

          // 解压文件
          if (url.endsWith('.zip')) {
            execSync(`unzip -q "${tempFile}" -d "${tempExtract}"`, { stdio: 'pipe' });
          } else {
            execSync(`tar -xzf "${tempFile}" -C "${tempExtract}"`, { stdio: 'pipe' });
          }

          // 找到解压后的主目录
          const extractedItems = fs.readdirSync(tempExtract);
          let sourceDir = tempExtract;
          if (extractedItems.length === 1) {
            const singleItem = path.join(tempExtract, extractedItems[0]);
            if (fs.statSync(singleItem).isDirectory()) {
              sourceDir = singleItem;
            }
          }

          // 删除旧目录并复制新内容
          if (fs.existsSync(targetDir)) {
            fs.rmSync(targetDir, { recursive: true });
          }
          fs.cpSync(sourceDir, targetDir, { recursive: true });

          // 记录更新源
          const packageJsonPath = path.join(targetDir, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            packageJson._source = url;
            packageJson._updatedAt = new Date().toISOString();
            fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
          }

          // 清理临时文件
          fs.unlinkSync(tempFile);
          fs.rmSync(tempExtract, { recursive: true });

          resolve(true);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`  Extraction error: ${errorMsg}`);
          resolve(false);
        }
      });
    }).on('error', (err) => {
      console.error(`  Download error: ${err.message}`);
      resolve(false);
    });
  });
}

/**
 * 更新插件
 * 支持从 npm、git、URL 远程源更新，以及本地重载
 */
async function updatePlugin(pluginName: string): Promise<void> {
  try {
    console.log(`Updating plugin ${pluginName}...`);

    const state = pluginManager.getPluginState(pluginName);
    if (!state) {
      console.error(`✗ Plugin not found: ${pluginName}`);
      process.exit(1);
      return;
    }

    if (state.path === '<inline>') {
      console.error(`✗ Cannot update inline plugin: ${pluginName}`);
      process.exit(1);
      return;
    }

    // 获取插件的远程源信息
    const sourceInfo = await getPluginSourceInfo(state.path);

    if (!sourceInfo) {
      console.error(`✗ Cannot read plugin source information`);
      process.exit(1);
      return;
    }

    console.log(`  Current version: ${sourceInfo.currentVersion}`);
    console.log(`  Source type: ${sourceInfo.type}`);

    let updateSuccess = false;

    switch (sourceInfo.type) {
      case 'npm': {
        // 从 npm 更新
        console.log(`  Checking npm registry for updates...`);
        const latestVersion = await getNpmLatestVersion(sourceInfo.source);

        if (!latestVersion) {
          console.log(`  Cannot fetch latest version from npm, falling back to reinstall...`);
          updateSuccess = await installFromNpm(sourceInfo.source, state.path);
        } else if (compareVersions(latestVersion, sourceInfo.currentVersion) > 0) {
          console.log(`  New version available: ${latestVersion}`);
          updateSuccess = await installFromNpm(sourceInfo.source, state.path);
        } else {
          console.log(`  Already at latest version (${sourceInfo.currentVersion})`);
          // 仍然重载以应用任何本地更改
          updateSuccess = await pluginManager.reload(pluginName);
        }
        break;
      }

      case 'git': {
        // 从 git 更新
        // v2.1.14: 如果插件固定到特定 SHA，维持在该 SHA
        if (sourceInfo.gitCommitSha) {
          console.log(`  Plugin is pinned to SHA: ${sourceInfo.gitCommitSha.substring(0, 8)}`);
          console.log(`  Updating from git repository (maintaining pinned version)...`);
          updateSuccess = await updateFromGit(sourceInfo.source, state.path, sourceInfo.gitCommitSha);
        } else {
          console.log(`  Updating from git repository...`);
          updateSuccess = await updateFromGit(sourceInfo.source, state.path);
        }
        break;
      }

      case 'url': {
        // 从 URL 更新
        console.log(`  Updating from remote URL...`);
        updateSuccess = await updateFromUrl(sourceInfo.source, state.path);
        break;
      }

      case 'local':
      default: {
        // 本地插件只能重载
        console.log(`  Local plugin detected, performing reload...`);
        updateSuccess = await pluginManager.reload(pluginName);
        break;
      }
    }

    if (updateSuccess) {
      // 重新加载插件到内存
      if (sourceInfo.type !== 'local') {
        await pluginManager.reload(pluginName);
      }

      // 获取更新后的版本信息
      const updatedState = pluginManager.getPluginState(pluginName);
      const newVersion = updatedState?.metadata.version || 'unknown';

      console.log(`✓ Successfully updated plugin: ${pluginName}`);
      console.log(`  New version: ${newVersion}`);
    } else {
      console.error(`✗ Failed to update plugin: ${pluginName}`);
      process.exit(1);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to update plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 显示插件详细信息
 */
async function showPluginInfo(pluginName: string): Promise<void> {
  await pluginManager.discover();
  const state = pluginManager.getPluginState(pluginName);

  if (!state) {
    console.error(`✗ Plugin not found: ${pluginName}`);
    process.exit(1);
    return;
  }

  const metadata = state.metadata;

  console.log(`\nPlugin: ${metadata.name}`);
  console.log('─'.repeat(60));
  console.log(`Version:      ${metadata.version}`);
  console.log(`Description:  ${metadata.description || 'N/A'}`);
  console.log(`Author:       ${metadata.author || 'N/A'}`);
  console.log(`License:      ${metadata.license || 'N/A'}`);
  console.log(`Homepage:     ${metadata.homepage || 'N/A'}`);
  console.log(`Status:       ${state.loaded ? 'Loaded' : state.enabled ? 'Enabled' : 'Disabled'}`);
  console.log(`Type:         ${state.path === '<inline>' ? 'Inline' : 'File'}`);

  if (state.path !== '<inline>') {
    console.log(`Path:         ${state.path}`);

    // v2.1.14: 显示 pinned SHA 信息
    const sourceInfo = await getPluginSourceInfo(state.path);
    if (sourceInfo?.type === 'git') {
      if (sourceInfo.gitCommitSha) {
        console.log(`Pinned SHA:   ${sourceInfo.gitCommitSha} (version locked)`);
      } else {
        console.log(`Git source:   ${sourceInfo.source}`);
      }
    }
  }

  if (metadata.engines) {
    console.log(`\nEngines:`);
    if (metadata.engines.node) {
      console.log(`  Node.js:    ${metadata.engines.node}`);
    }
    if (metadata.engines['claude-code']) {
      console.log(`  Axon: ${metadata.engines['claude-code']}`);
    }
  }

  if (metadata.dependencies && Object.keys(metadata.dependencies).length > 0) {
    console.log(`\nDependencies:`);
    for (const [name, version] of Object.entries(metadata.dependencies)) {
      console.log(`  ${name}: ${version}`);
    }
  }

  if (state.loaded) {
    const tools = pluginManager.getPluginTools(pluginName);
    const commands = pluginManager.getPluginCommands(pluginName);
    const skills = pluginManager.getPluginSkills(pluginName);
    const hooks = pluginManager.getPluginHooks(pluginName);

    if (tools.length > 0) {
      console.log(`\nTools (${tools.length}):`);
      for (const tool of tools) {
        console.log(`  - ${tool.name}: ${tool.description}`);
      }
    }

    if (commands.length > 0) {
      console.log(`\nCommands (${commands.length}):`);
      for (const cmd of commands) {
        console.log(`  - ${cmd.name}: ${cmd.description}`);
      }
    }

    if (skills.length > 0) {
      console.log(`\nSkills (${skills.length}):`);
      for (const skill of skills) {
        console.log(`  - /${skill.name}: ${skill.description}`);
      }
    }

    if (hooks.length > 0) {
      console.log(`\nHooks (${hooks.length}):`);
      const hookTypes = new Set(hooks.map(h => h.type));
      for (const type of Array.from(hookTypes)) {
        const count = hooks.filter(h => h.type === type).length;
        console.log(`  - ${type}: ${count} handler(s)`);
      }
    }
  }

  if (state.error) {
    console.log(`\n✗ Error: ${state.error}`);
  }

  console.log('');
}

/**
 * 管理市场（Marketplace）
 */
async function manageMarketplace(): Promise<void> {
  console.log('\n📦 Axon Plugin Marketplace\n');
  console.log('The plugin marketplace allows you to discover and install plugins from');
  console.log('official and community sources.\n');
  console.log('Available commands:\n');
  console.log('  claude plugin marketplace add <url>      Add a marketplace source');
  console.log('  claude plugin marketplace list           List configured marketplaces');
  console.log('  claude plugin marketplace remove <name>  Remove a marketplace source');
  console.log('  claude plugin marketplace search <term>  Search for plugins');
  console.log('  claude plugin marketplace sync           Sync marketplace catalog\n');
  console.log('Note: This is an educational implementation. Full marketplace');
  console.log('functionality requires official Anthropic infrastructure.\n');
  console.log('Current status: Framework implemented, awaiting official marketplace API.\n');
}

/**
 * 验证插件
 */
async function validatePlugin(pluginPath: string): Promise<void> {
  try {
    console.log(`Validating plugin at ${pluginPath}...`);

    const fs = await import('fs');
    const path = await import('path');

    // 检查路径是否存在
    if (!fs.existsSync(pluginPath)) {
      console.error(`✗ Path does not exist: ${pluginPath}`);
      process.exit(1);
      return;
    }

    // 如果是文件，检查是否是 JSON
    const stats = fs.statSync(pluginPath);
    let manifestPath: string;

    if (stats.isFile()) {
      manifestPath = pluginPath;
    } else if (stats.isDirectory()) {
      // 在目录中查找 package.json
      manifestPath = path.join(pluginPath, 'package.json');
      if (!fs.existsSync(manifestPath)) {
        console.error(`✗ package.json not found in directory: ${pluginPath}`);
        process.exit(1);
        return;
      }
    } else {
      console.error(`✗ Invalid path: ${pluginPath}`);
      process.exit(1);
      return;
    }

    // 读取并解析 manifest
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    let manifest: any;

    try {
      manifest = JSON.parse(manifestContent);
    } catch (err) {
      console.error(`✗ Invalid JSON in manifest file`);
      process.exit(1);
      return;
    }

    // 验证必需字段
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Missing or invalid "version" field');
    }

    if (!manifest.description) {
      warnings.push('Missing "description" field');
    }

    if (!manifest.main) {
      warnings.push('Missing "main" field (defaults to "index.js")');
    }

    if (!manifest.engines) {
      warnings.push('Missing "engines" field (recommended)');
    }

    // 检查主文件是否存在
    if (stats.isDirectory()) {
      const mainFile = path.join(pluginPath, manifest.main || 'index.js');
      if (!fs.existsSync(mainFile)) {
        errors.push(`Main file not found: ${manifest.main || 'index.js'}`);
      }
    }

    // 输出结果
    if (errors.length > 0) {
      console.log(`\n✗ Validation failed with ${errors.length} error(s):\n`);
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      if (warnings.length > 0) {
        console.log(`\n⚠ Warnings (${warnings.length}):\n`);
        for (const warning of warnings) {
          console.log(`  - ${warning}`);
        }
      }
      process.exit(1);
    } else if (warnings.length > 0) {
      console.log(`\n✓ Validation passed with ${warnings.length} warning(s):\n`);
      for (const warning of warnings) {
        console.log(`  - ${warning}`);
      }
    } else {
      console.log(`\n✓ Validation passed: Plugin is valid`);
      console.log(`  Name:    ${manifest.name}`);
      console.log(`  Version: ${manifest.version}`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Validation error: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 固定插件到特定 git commit SHA
 * v2.1.14: 支持将插件固定到特定版本
 */
async function pinPlugin(pluginName: string, sha: string): Promise<void> {
  try {
    console.log(`Pinning plugin ${pluginName} to SHA: ${sha}...`);

    const state = pluginManager.getPluginState(pluginName);
    if (!state) {
      console.error(`✗ Plugin not found: ${pluginName}`);
      process.exit(1);
      return;
    }

    if (state.path === '<inline>') {
      console.error(`✗ Cannot pin inline plugin: ${pluginName}`);
      process.exit(1);
      return;
    }

    // 获取插件的远程源信息
    const sourceInfo = await getPluginSourceInfo(state.path);

    if (!sourceInfo || sourceInfo.type !== 'git') {
      console.error(`✗ Plugin ${pluginName} is not a git-based plugin. Only git plugins can be pinned.`);
      process.exit(1);
      return;
    }

    // 验证 SHA 格式（至少 7 个字符）
    if (!/^[a-f0-9]{7,40}$/i.test(sha)) {
      console.error(`✗ Invalid SHA format: ${sha}`);
      console.error(`  SHA must be 7-40 hexadecimal characters`);
      process.exit(1);
      return;
    }

    // 更新到指定的 SHA
    console.log(`  Updating plugin to pinned SHA...`);
    const success = await updateFromGit(sourceInfo.source, state.path, sha);

    if (!success) {
      console.error(`✗ Failed to checkout SHA: ${sha}`);
      console.error(`  Make sure the SHA exists in the repository`);
      process.exit(1);
      return;
    }

    // 重新加载插件
    await pluginManager.reload(pluginName);

    console.log(`✓ Successfully pinned plugin ${pluginName} to SHA: ${sha}`);
    console.log(`  The plugin will stay at this version until unpinned.`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to pin plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 取消固定插件版本
 * v2.1.14: 允许插件恢复到最新版本更新
 */
async function unpinPlugin(pluginName: string): Promise<void> {
  try {
    console.log(`Unpinning plugin ${pluginName}...`);

    const state = pluginManager.getPluginState(pluginName);
    if (!state) {
      console.error(`✗ Plugin not found: ${pluginName}`);
      process.exit(1);
      return;
    }

    if (state.path === '<inline>') {
      console.error(`✗ Cannot unpin inline plugin: ${pluginName}`);
      process.exit(1);
      return;
    }

    const fs = await import('fs');
    const path = await import('path');

    // 获取插件的远程源信息
    const sourceInfo = await getPluginSourceInfo(state.path);

    if (!sourceInfo || sourceInfo.type !== 'git') {
      console.error(`✗ Plugin ${pluginName} is not a git-based plugin.`);
      process.exit(1);
      return;
    }

    if (!sourceInfo.gitCommitSha) {
      console.log(`  Plugin ${pluginName} is not pinned.`);
      return;
    }

    // 移除 gitCommitSha 并更新到最新版本
    const packageJsonPath = path.join(state.path, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      delete packageJson.gitCommitSha;
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    }

    // 更新到最新版本
    console.log(`  Updating plugin to latest version...`);
    const success = await updateFromGit(sourceInfo.source, state.path);

    if (!success) {
      console.error(`✗ Failed to update to latest version`);
      process.exit(1);
      return;
    }

    // 重新加载插件
    await pluginManager.reload(pluginName);

    const updatedState = pluginManager.getPluginState(pluginName);
    const newVersion = updatedState?.metadata.version || 'unknown';

    console.log(`✓ Successfully unpinned plugin ${pluginName}`);
    console.log(`  Updated to version: ${newVersion}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to unpin plugin: ${errorMsg}`);
    process.exit(1);
  }
}

/**
 * 默认导出
 */
export default createPluginCommand;
