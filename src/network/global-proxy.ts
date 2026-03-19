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
 * 可达性检查:
 *   启用代理后会异步探测代理是否可达（TCP connect，1.5s 超时）。
 *   如果代理不可达（如 VPN 已关闭），自动回退到直连模式。
 *
 * 依赖: undici（Node.js 内置）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
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
 * TCP 探测代理是否可达
 */
function probeProxy(proxyUrl: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyUrl);
      const host = url.hostname;
      const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);

      const socket = net.createConnection({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(timeoutMs);
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * 回退到直连：移除代理 dispatcher，清理环境变量
 */
function fallbackToDirect(proxyUrl: string, settingsOrigin: boolean): void {
  try {
    const nodeRequire = createRequire(import.meta.url);
    const undici = nodeRequire('undici');
    const { Agent, setGlobalDispatcher } = undici;
    if (Agent && setGlobalDispatcher) {
      setGlobalDispatcher(new Agent());
    }
  } catch {
    // ignore
  }

  // 只清理由 settings.json 写入的环境变量，不动用户原本设置的
  if (settingsOrigin) {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
  }

  console.log(`[GlobalProxy] proxy unreachable (${proxyUrl}), falling back to direct connection`);
}

/**
 * 初始化全局 fetch 代理
 * 幂等，多次调用安全
 *
 * 先同步设置代理（不阻塞启动），然后异步探测可达性。
 * 代理不可达时自动回退到直连。
 */
export function setupGlobalFetchProxy(): void {
  if (initialized) return;
  initialized = true;

  // 优先环境变量，其次 settings.json
  let proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;

  let settingsOrigin = false;

  if (!proxyUrl) {
    const settingsProxy = getProxyFromSettings();
    proxyUrl = settingsProxy.https || settingsProxy.http;
    if (proxyUrl) {
      settingsOrigin = true;
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

      // 异步探测代理可达性，不阻塞启动
      const urlToProbe = proxyUrl;
      probeProxy(urlToProbe).then((reachable) => {
        if (!reachable) {
          fallbackToDirect(urlToProbe, settingsOrigin);
        }
      });
    }
  } catch (err) {
    // undici 不可用时静默降级，不影响启动
    console.warn('[GlobalProxy] Failed to setup fetch proxy:', (err as Error).message);
  }
}
