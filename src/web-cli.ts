#!/usr/bin/env node
/**
 * WebUI CLI 入口
 * 启动 Web 服务器
 *
 * --evolve 模式：启用自我进化能力
 * 当 AI 修改自身源码并调用 SelfEvolve 工具后，进程以退出码 42 退出，
 * 本脚本检测到后自动重启子进程（tsx），新代码即刻生效。
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// 项目根目录（基于本文件位置，而非 cwd）
const __filename_resolved = fileURLToPath(import.meta.url);
const __dirname_resolved = path.dirname(__filename_resolved);
const PROJECT_ROOT = path.resolve(__dirname_resolved, '..');

// 手动加载 .env 文件（不依赖 dotenv 包）
// 追踪 .env 设置过的 key，重新加载时清理已移除的变量
const envFileKeys = new Set<string>();

function loadEnvFile() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envPath)) {
    // 清理上一次 .env 设置过但本次不再存在的变量
    const newKeys = new Set<string>();
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          process.env[key] = value;
          newKeys.add(key);
        }
      }
    }
    // 删除上次有但本次没有的变量（如注释掉的 SLACK_CLIENT_ID）
    for (const oldKey of envFileKeys) {
      if (!newKeys.has(oldKey)) {
        delete process.env[oldKey];
      }
    }
    envFileKeys.clear();
    for (const k of newKeys) envFileKeys.add(k);
  }
}

loadEnvFile();

import { Command } from 'commander';
import { startWebServer } from './web/index.js';
import { VERSION_BASE } from './version.js';

const program = new Command();

program
  .name('claude-web')
  .description('Axon WebUI 服务器')
  .version(VERSION_BASE)
  .option('-p, --port <port>', '服务器端口', process.env.PORT || '3456')
  .option('-H, --host <host>', '服务器主机', process.env.AXON_WEB_HOST || '0.0.0.0')
  .option('-m, --model <model>', '默认模型 (opus/sonnet/haiku)', 'sonnet')
  .option('-d, --dir <directory>', '工作目录', process.cwd())
  .option('--ngrok', '启用 ngrok 公网隧道 (需要 NGROK_AUTHTOKEN 环境变量)', false)
  .option('--no-open', '不自动打开浏览器')
  .option('--evolve', '启用自我进化模式 (AI 可修改源码并自动重启生效)', false)
  .action(async (options) => {
    if (options.evolve) {
      await runEvolveMode(options);
    } else {
      await runNormalMode(options);
    }
  });

program.parse();

// ============================================================================
// 普通模式：直接启动 WebUI 服务器
// ============================================================================
async function runNormalMode(options: any) {
  printBanner(false);

  try {
    await startWebServer({
      port: parseInt(options.port),
      host: options.host,
      model: options.model,
      cwd: options.dir,
      ngrok: options.ngrok,
      open: options.open,
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

// ============================================================================
// 进化模式：以子进程方式启动，退出码 42 时自动重启
// ============================================================================
async function runEvolveMode(options: any) {
  const { spawn } = await import('child_process');

  const MAX_RESTARTS = 10;
  let restartCount = 0;
  let currentChild: ReturnType<typeof spawn> | null = null;

  // 信号转发（只注册一次，通过 currentChild 引用当前子进程）
  const forwardSignal = (signal: NodeJS.Signals) => {
    if (currentChild && !currentChild.killed) {
      currentChild.kill(signal);
    }
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));

  // 查找 tsx 可执行路径，避免通过 npx + shell 中转（Windows 上退出码不可靠）
  function findTsxPath(): string {
    const nodeModulesBin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');
    // Windows 上 .bin 下有 tsx.cmd
    if (process.platform === 'win32') {
      const cmdPath = nodeModulesBin + '.cmd';
      if (fs.existsSync(cmdPath)) return cmdPath;
    }
    if (fs.existsSync(nodeModulesBin)) return nodeModulesBin;
    // 兜底：用 npx tsx
    return '';
  }

  function startChild(): void {
    // 每次重启子进程前重新加载 .env，确保注释掉/新增的变量生效
    loadEnvFile();
    printBanner(true, restartCount);

    // 构建子进程参数：去掉 --evolve，加上原始参数（使用绝对路径）
    const childArgs = [path.join(PROJECT_ROOT, 'src/web-cli.ts')];
    if (options.port) childArgs.push('-p', options.port);
    if (options.host) childArgs.push('-H', options.host);
    if (options.model) childArgs.push('-m', options.model);
    if (options.dir) childArgs.push('-d', options.dir);
    if (options.ngrok) childArgs.push('--ngrok');
    // 重启后不再自动打开浏览器
    if (options.open === false || restartCount > 0) childArgs.push('--no-open');

    const tsxPath = findTsxPath();
    let child: ReturnType<typeof spawn>;

    if (tsxPath) {
      // 直接用 tsx 可执行文件，不经过 npx 层
      // Windows 上 .cmd 文件必须用 shell: true 运行
      const useShell = process.platform === 'win32' && tsxPath.endsWith('.cmd');
      child = spawn(tsxPath, childArgs, {
        stdio: 'inherit',
        env: {
          ...process.env,
          AXON_EVOLVE_ENABLED: '1',
        },
        shell: useShell,
      });
    } else {
      // 兜底：npx tsx
      child = spawn('npx', ['tsx', ...childArgs], {
        stdio: 'inherit',
        env: {
          ...process.env,
          AXON_EVOLVE_ENABLED: '1',
        },
        shell: true,
      });
    }

    currentChild = child;

    child.on('exit', (code, signal) => {
      currentChild = null;

      if (code === 42) {
        restartCount++;
        if (restartCount >= MAX_RESTARTS) {
          console.error(`\n[Evolve] ERROR: Max restarts reached (${MAX_RESTARTS}). Exiting.`);
          console.error('[Evolve] This likely indicates a code issue causing restart loops.');
          process.exit(1);
        }
        console.log(`\n[Evolve] ================================================`);
        console.log(`[Evolve]   Self-evolve restart requested`);
        console.log(`[Evolve]   Attempt ${restartCount}/${MAX_RESTARTS}`);
        console.log(`[Evolve] ================================================`);
        console.log(`[Evolve] Waiting 2 seconds for port release...\n`);
        setTimeout(startChild, 2000);
      } else {
        if (code !== 0 && code !== null) {
          console.error(`[Evolve] Child process exited with code ${code}${signal ? `, signal ${signal}` : ''}`);
        }
        process.exit(code ?? 0);
      }
    });

    child.on('error', (err) => {
      console.error(`[Evolve] Failed to start child process:`, err.message);
      currentChild = null;
    });
  }

  startChild();
}

// ============================================================================
// Banner
// ============================================================================
function printBanner(evolve: boolean, restartCount = 0) {
  if (evolve) {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🧬 Axon WebUI  [EVOLVE MODE]                    ║
║                                                           ║
║   AI can modify its own source code and auto-restart      ║
║   ${restartCount > 0 ? `Restart #${restartCount}                                         `.slice(0, 42) + '║' : '                                                         ║'}
╚═══════════════════════════════════════════════════════════╝
`);
  } else {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🤖 Axon WebUI                                    ║
║                                                           ║
║   一个基于 Web 的 Axon 界面                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
  }
}
