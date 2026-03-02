#!/usr/bin/env node
/**
 * Anthropic API 透传代理 CLI
 *
 * 自动检测本地认证方式（订阅 OAuth / API Key），启动代理服务器。
 * 让其他电脑上的 Axon 通过设置环境变量即可使用你的模型额度。
 *
 * 用法：
 *   # 自动检测本地认证（推荐）
 *   claude-proxy --proxy-key my-secret
 *
 *   # 手动指定 API Key
 *   claude-proxy --proxy-key my-secret --anthropic-key sk-ant-xxx
 *
 *   # 客户端使用：
 *   ANTHROPIC_API_KEY=my-secret ANTHROPIC_BASE_URL=http://your-ip:8082 claude
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// 手动加载 .env 文件
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
import { createProxyServer, type AuthMode } from './proxy/server.js';
import { VERSION_BASE } from './version.js';

// ============ 本地凭据检测 ============

const AXON_DIR = path.join(os.homedir(), '.axon');

/** 官方 Axon 的 OAuth 凭据文件（未加密） */
const OFFICIAL_CREDENTIALS_FILE = path.join(AXON_DIR, '.credentials.json');
/** 官方 Axon 的配置文件（存储 primaryApiKey） */
const CONFIG_FILE = path.join(AXON_DIR, 'config.json');

interface DetectedAuth {
  mode: AuthMode;
  source: string;
  // API Key 模式
  apiKey?: string;
  // OAuth 模式
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  accountUuid?: string;
}

/**
 * 检查是否有 user:inference scope（订阅用户标志）
 */
function hasInferenceScope(scopes: string[]): boolean {
  return scopes.some(s =>
    s === 'user:inference' || s.includes('inference'),
  );
}

/**
 * 自动检测本地认证信息
 * 优先级：环境变量 > 官方 OAuth 凭据 > 官方配置 API Key
 */
function detectLocalAuth(): DetectedAuth | null {
  // 1. 环境变量 ANTHROPIC_AUTH_TOKEN（OAuth）
  const envAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (envAuthToken) {
    return {
      mode: 'oauth',
      source: 'Environment variable ANTHROPIC_AUTH_TOKEN',
      accessToken: envAuthToken,
      refreshToken: '',
      expiresAt: Date.now() + 3600 * 1000, // 假设 1 小时
    };
  }

  // 2. 环境变量 ANTHROPIC_API_KEY
  const envApiKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
  if (envApiKey) {
    return {
      mode: 'api-key',
      source: 'Environment variable ANTHROPIC_API_KEY',
      apiKey: envApiKey,
    };
  }

  // 3. 官方 Axon 的 .credentials.json（OAuth，未加密）
  // 文件结构：{ claudeAiOauth: { accessToken, ... }, oauthAccount: { accountUuid, ... } }
  if (fs.existsSync(OFFICIAL_CREDENTIALS_FILE)) {
    try {
      const creds = JSON.parse(fs.readFileSync(OFFICIAL_CREDENTIALS_FILE, 'utf-8'));
      if (creds.claudeAiOauth?.accessToken) {
        const oauth = creds.claudeAiOauth;
        const scopes = oauth.scopes || [];

        if (hasInferenceScope(scopes)) {
          const expiresAt = oauth.expiresAt || 0;
          const remainMin = Math.max(0, Math.round((expiresAt - Date.now()) / 60000));

          // 从 oauthAccount 中读取 accountUuid（官方 CC 的 tK() 函数返回此对象）
          const accountUuid = creds.oauthAccount?.accountUuid || undefined;

          return {
            mode: 'oauth',
            source: `~/.axon/.credentials.json (subscription account, token expires in ${remainMin} min)`,
            accessToken: oauth.accessToken,
            refreshToken: oauth.refreshToken || '',
            expiresAt,
            scopes,
            accountUuid,
          };
        }
      }
    } catch {
      // 忽略解析错误
    }
  }

  // 4. 官方 Axon 的 config.json（API Key）
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.primaryApiKey) {
        return {
          mode: 'api-key',
          source: '~/.axon/config.json (primaryApiKey)',
          apiKey: config.primaryApiKey,
        };
      }
    } catch {
      // 忽略解析错误
    }
  }

  return null;
}

// ============ CLI ============

const program = new Command();

program
  .name('claude-proxy')
  .description('Anthropic API Proxy - Share your Claude subscription quota with other devices')
  .version(VERSION_BASE)
  .option('-p, --port <port>', 'Proxy server port', process.env.PROXY_PORT || '8082')
  .option('-H, --host <host>', 'Listen address (0.0.0.0 allows external access)', process.env.PROXY_HOST || '0.0.0.0')
  .option(
    '-k, --proxy-key <key>',
    'Key for clients to connect to proxy (auto-generated if not set)',
    process.env.PROXY_API_KEY,
  )
  .option(
    '--anthropic-key <key>',
    'Manually specify Anthropic API Key (overrides auto-detection)',
  )
  .option(
    '--auth-token <token>',
    'Manually specify OAuth Access Token (overrides auto-detection)',
  )
  .option(
    '--target <url>',
    'Forward target address',
    'https://api.anthropic.com',
  )
  .action(async (options) => {
    // 确定认证方式
    let authMode: AuthMode;
    let anthropicApiKey: string | undefined;
    let oauthAccessToken: string | undefined;
    let oauthRefreshToken: string | undefined;
    let oauthExpiresAt: number | undefined;
    let oauthAccountUuid: string | undefined;
    let authSource: string;

    if (options.anthropicKey) {
      // 手动指定 API Key
      authMode = 'api-key';
      anthropicApiKey = options.anthropicKey;
      authSource = 'Command-line argument --anthropic-key';
    } else if (options.authToken) {
      // 手动指定 OAuth Token
      authMode = 'oauth';
      oauthAccessToken = options.authToken;
      oauthRefreshToken = '';
      oauthExpiresAt = Date.now() + 3600 * 1000;
      authSource = 'Command-line argument --auth-token';
    } else {
      // 自动检测
      const detected = detectLocalAuth();
      if (!detected) {
        console.error(
          'Error: No local authentication detected.\n\n' +
          'Please ensure one of the following:\n' +
          '  1. Logged in via claude command (subscription user)\n' +
          '     → Will auto-read ~/.axon/.credentials.json\n' +
          '  2. Set environment variable ANTHROPIC_API_KEY\n' +
          '  3. Use --anthropic-key to manually specify API Key\n' +
          '  4. Use --auth-token to manually specify OAuth Token\n',
        );
        process.exit(1);
      }

      authMode = detected.mode;
      authSource = detected.source;

      if (detected.mode === 'api-key') {
        anthropicApiKey = detected.apiKey;
      } else {
        oauthAccessToken = detected.accessToken;
        oauthRefreshToken = detected.refreshToken;
        oauthExpiresAt = detected.expiresAt;
      }

      // 传递 accountUuid（从 oauthAccount 字段读取）
      oauthAccountUuid = detected.accountUuid;
    }

    // 生成 proxy key
    const proxyApiKey = options.proxyKey || `proxy-${crypto.randomBytes(16).toString('hex')}`;
    const port = parseInt(options.port);
    const host = options.host;
    const targetBaseUrl = options.target;

    const modeLabel = authMode === 'oauth' ? 'OAuth Subscription' : 'API Key';

    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   Anthropic API Proxy Server                                ║
║                                                               ║
║   Share your Claude ${modeLabel} quota with other devices  ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);

    try {
      const proxy = await createProxyServer({
        port,
        host,
        proxyApiKey,
        authMode,
        anthropicApiKey,
        oauthAccessToken,
        oauthRefreshToken,
        oauthExpiresAt,
        oauthAccountUuid,
        targetBaseUrl,
      });

      await proxy.start();

      console.log(`Proxy server started!`);
      console.log(`─────────────────────────────────────────────────`);
      console.log(`  Auth mode:   ${modeLabel}`);
      console.log(`  Auth source:   ${authSource}`);
      console.log(`  Listen address:   http://${host}:${port}`);
      console.log(`  Target:   ${targetBaseUrl}`);
      console.log(`  Proxy Key:   ${proxyApiKey}`);

      if (authMode === 'oauth' && proxy.oauthState) {
        const remainMin = Math.max(0, Math.round((proxy.oauthState.expiresAt - Date.now()) / 60000));
        console.log(`  Token status:  Valid (auto-refresh in ${remainMin} min)`);
      }

      console.log(`  Health check:   http://${host}:${port}/health`);
      console.log(`  Stats:   http://${host}:${port}/stats`);
      console.log(`─────────────────────────────────────────────────`);

      const displayHost = host === '0.0.0.0' ? '<your-ip-address>' : host;
      console.log(`\nClient usage (run on other machines):\n`);
      console.log(`  # Linux / macOS`);
      console.log(`  export ANTHROPIC_API_KEY="${proxyApiKey}"`);
      console.log(`  export ANTHROPIC_BASE_URL="http://${displayHost}:${port}"`);
      console.log(`  claude\n`);
      console.log(`  # Windows (PowerShell)`);
      console.log(`  $env:ANTHROPIC_API_KEY="${proxyApiKey}"`);
      console.log(`  $env:ANTHROPIC_BASE_URL="http://${displayHost}:${port}"`);
      console.log(`  claude\n`);
      console.log(`  # Windows (CMD)`);
      console.log(`  set ANTHROPIC_API_KEY=${proxyApiKey}`);
      console.log(`  set ANTHROPIC_BASE_URL=http://${displayHost}:${port}`);
      console.log(`  claude\n`);
      console.log(`Press Ctrl+C to stop proxy server\n`);

      // 优雅退出
      const shutdown = async () => {
        console.log('\nShutting down proxy server...');
        await proxy.stop();
        console.log('Proxy server stopped.');
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

    } catch (error: any) {
      console.error('Failed to start:', error.message);
      process.exit(1);
    }
  });

program.parse();
