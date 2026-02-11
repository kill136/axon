#!/usr/bin/env node
/**
 * WebUI CLI 入口
 * 启动 Web 服务器
 */

import * as fs from 'fs';
import * as path from 'path';

// 手动加载 .env 文件（不依赖 dotenv 包）
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          // 只设置未定义的环境变量
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    }
  }
}

loadEnvFile();

import { Command } from 'commander';
import { startWebServer } from './web/index.js';
import { VERSION_BASE } from './version.js';

const program = new Command();

program
  .name('claude-web')
  .description('Claude Code WebUI 服务器')
  .version(VERSION_BASE)
  .option('-p, --port <port>', '服务器端口', '3456')
  .option('-H, --host <host>', '服务器主机', '127.0.0.1')
  .option('-m, --model <model>', '默认模型 (opus/sonnet/haiku)', 'sonnet')
  .option('-d, --dir <directory>', '工作目录', process.cwd())
  .option('--ngrok', '启用 ngrok 公网隧道 (需要 NGROK_AUTHTOKEN 环境变量)', false)
  .option('--no-open', '不自动打开浏览器', false)
  .action(async (options) => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🤖 Claude Code WebUI                                    ║
║                                                           ║
║   一个基于 Web 的 Claude Code 界面                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

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
      console.error('启动失败:', error);
      process.exit(1);
    }
  });

program.parse();
