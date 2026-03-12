/**
 * 全局代理设置
 *
 * 让 Node.js 内置 fetch（基于 undici）自动走代理。
 * 在进程启动极早期 import 一次即可，所有后续的 fetch() 调用（包括第三方 SDK 如 @google/genai）
 * 都会自动经过代理，无需逐个客户端单独配置。
 *
 * 代理来源优先级:
 *   1. 环境变量 HTTP_PROXY / HTTPS_PROXY
 *   2. settings.json 中的 proxy.http / proxy.https
 *
 * 依赖: undici（Node.js 内置）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRequire } from 'module';

let initialized = false;

/**
 * 从 settings.json 读取代理配置（轻量级，不依赖 configManager 避免循环依赖）
 */
function getProxyFromSettings(): { http?: string; https?: string } {
  try {
    const settingsPath = path.join(os.homedir(), '.axon', 'settings.json');
    if (!fs.existsSync(settingsPath)) return {};
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    if (settings.proxy) {
      return {
        http: settings.proxy.http,
        https: settings.proxy.https,
      };
    }
  } catch {
    // settings 读取失败不影响启动
  }
  return {};
}

/**
 * 初始化全局 fetch 代理
 * 幂等，多次调用安全
 */
export function setupGlobalFetchProxy(): void {
  if (initialized) return;
  initialized = true;

  // 优先环境变量，其次 settings.json
  let proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;

  if (!proxyUrl) {
    const settingsProxy = getProxyFromSettings();
    proxyUrl = settingsProxy.https || settingsProxy.http;
    if (proxyUrl) {
      // 写入环境变量，让 EnvHttpProxyAgent 能读到
      if (settingsProxy.https) process.env.HTTPS_PROXY = settingsProxy.https;
      if (settingsProxy.http) process.env.HTTP_PROXY = settingsProxy.http;
    }
  }

  if (!proxyUrl) return;

  try {
    // undici 是 Node.js 内置 fetch 的底层实现
    // EnvHttpProxyAgent 自动读取 HTTP_PROXY/HTTPS_PROXY/NO_PROXY
    // 使用 createRequire 确保在 ESM/tsx 环境下也能正确加载
    const nodeRequire = createRequire(import.meta.url);
    const undici = nodeRequire('undici');
    const { EnvHttpProxyAgent, setGlobalDispatcher } = undici;

    if (EnvHttpProxyAgent && setGlobalDispatcher) {
      setGlobalDispatcher(new EnvHttpProxyAgent());
      console.log(`[GlobalProxy] fetch proxy enabled: ${proxyUrl}`);
    }
  } catch (err) {
    // undici 不可用时静默降级，不影响启动
    console.warn('[GlobalProxy] Failed to setup fetch proxy:', (err as Error).message);
  }
}
