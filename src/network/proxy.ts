/**
 * 代理配置和Agent创建
 * 支持 HTTP/HTTPS/SOCKS 代理
 * v2.1.23: 添加 mTLS 客户端证书支持
 */

import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';
import type { Agent } from 'http';
import * as fs from 'fs';

/**
 * v2.1.23: mTLS 配置接口
 */
export interface MTLSConfig {
  /** 客户端证书路径或内容 */
  cert?: string;
  /** 客户端私钥路径或内容 */
  key?: string;
  /** 私钥密码 */
  passphrase?: string;
}

/**
 * v2.1.23: 从环境变量加载 mTLS 配置
 */
export function loadMTLSConfig(): MTLSConfig {
  const config: MTLSConfig = {};

  // 加载客户端证书
  if (process.env.AXON_CLIENT_CERT) {
    try {
      config.cert = fs.readFileSync(process.env.AXON_CLIENT_CERT, { encoding: 'utf8' });
    } catch (err) {
      console.error(`mTLS: Failed to load client certificate: ${err}`);
    }
  }

  // 加载客户端私钥
  if (process.env.AXON_CLIENT_KEY) {
    try {
      config.key = fs.readFileSync(process.env.AXON_CLIENT_KEY, { encoding: 'utf8' });
    } catch (err) {
      console.error(`mTLS: Failed to load client key: ${err}`);
    }
  }

  // 私钥密码
  if (process.env.AXON_CLIENT_KEY_PASSPHRASE) {
    config.passphrase = process.env.AXON_CLIENT_KEY_PASSPHRASE;
  }

  return config;
}

/**
 * 代理配置接口
 */
export interface ProxyConfig {
  /** HTTP 代理 URL */
  http?: string;
  /** HTTPS 代理 URL */
  https?: string;
  /** SOCKS 代理 URL (socks4:// or socks5://) */
  socks?: string;
  /** 绕过代理的域名列表 */
  noProxy?: string | string[];
  /** 代理认证用户名 */
  username?: string;
  /** 代理认证密码 */
  password?: string;
  /** 是否使用系统代理设置 */
  useSystemProxy?: boolean;
}

/**
 * 代理 Agent 选项
 * v2.1.23: 添加 mTLS 支持
 */
export interface ProxyAgentOptions {
  /** 连接超时（毫秒） */
  timeout?: number;
  /** 保持连接 */
  keepAlive?: boolean;
  /** 最大 socket 数量 */
  maxSockets?: number;
  /** 最大空闲 socket 数量 */
  maxFreeSockets?: number;
  /** SSL/TLS 选项 */
  rejectUnauthorized?: boolean;
  /** 自定义 CA 证书 */
  ca?: string | Buffer | Array<string | Buffer>;
  /** v2.1.23: mTLS 客户端证书 */
  cert?: string | Buffer;
  /** v2.1.23: mTLS 客户端私钥 */
  key?: string | Buffer;
  /** v2.1.23: mTLS 私钥密码 */
  passphrase?: string;
}

/**
 * 从环境变量读取代理配置
 */
export function getProxyFromEnv(): ProxyConfig {
  return {
    http: process.env.HTTP_PROXY || process.env.http_proxy,
    https: process.env.HTTPS_PROXY || process.env.https_proxy,
    socks:
      process.env.ALL_PROXY ||
      process.env.all_proxy ||
      process.env.SOCKS_PROXY ||
      process.env.socks_proxy,
    noProxy: process.env.NO_PROXY || process.env.no_proxy,
    useSystemProxy: true,
  };
}

/**
 * 解析代理 URL，提取认证信息
 */
export function parseProxyUrl(proxyUrl: string): {
  url: string;
  username?: string;
  password?: string;
} {
  try {
    const url = new URL(proxyUrl);
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    // 移除认证信息后的 URL
    url.username = '';
    url.password = '';

    return {
      url: url.toString(),
      username,
      password,
    };
  } catch {
    return { url: proxyUrl };
  }
}

/**
 * 检查 URL 是否应该绕过代理
 */
export function shouldBypassProxy(targetUrl: string, noProxy?: string | string[]): boolean {
  if (!noProxy) return false;

  const noProxyList = Array.isArray(noProxy)
    ? noProxy
    : noProxy.split(',').map((s) => s.trim());

  if (noProxyList.length === 0) return false;

  try {
    const url = new URL(targetUrl);
    const hostname = url.hostname;

    for (const pattern of noProxyList) {
      if (!pattern) continue;

      // 特殊值 "*" 表示绕过所有
      if (pattern === '*') return true;

      // 完全匹配
      if (hostname === pattern) return true;

      // 通配符匹配 (*.example.com)
      if (pattern.startsWith('*.')) {
        const domain = pattern.slice(2);
        if (hostname.endsWith(domain)) return true;
      }

      // 后缀匹配 (.example.com)
      if (pattern.startsWith('.')) {
        if (hostname.endsWith(pattern)) return true;
      }

      // IP 范围匹配（简化版，仅支持精确匹配）
      if (hostname === pattern) return true;
    }
  } catch {
    // URL 解析失败，不绕过
  }

  return false;
}

/**
 * 创建代理 Agent
 */
export function createProxyAgent(
  targetUrl: string,
  config?: ProxyConfig,
  options?: ProxyAgentOptions
): Agent | undefined {
  // 合并环境变量配置
  const effectiveConfig: ProxyConfig = {
    ...getProxyFromEnv(),
    ...config,
  };

  // 检查是否绕过代理
  if (shouldBypassProxy(targetUrl, effectiveConfig.noProxy)) {
    return undefined;
  }

  // 手动配置优先级更高
  const isHttps = targetUrl.startsWith('https://');
  let proxyUrl =
    effectiveConfig.socks ||
    (isHttps ? effectiveConfig.https : effectiveConfig.http) ||
    effectiveConfig.https ||
    effectiveConfig.http;

  // 使用 proxy-from-env 自动检测（如果启用了系统代理）
  if (!proxyUrl && effectiveConfig.useSystemProxy) {
    proxyUrl = getProxyForUrl(targetUrl);
  }

  if (!proxyUrl) {
    return undefined;
  }

  // 解析代理 URL
  const parsed = parseProxyUrl(proxyUrl);

  // 合并认证信息
  const username = effectiveConfig.username || parsed.username;
  const password = effectiveConfig.password || parsed.password;

  // 构建带认证的代理 URL
  let finalProxyUrl = parsed.url;
  if (username && password) {
    const url = new URL(parsed.url);
    url.username = encodeURIComponent(username);
    url.password = encodeURIComponent(password);
    finalProxyUrl = url.toString();
  }

  // v2.1.23: 加载 mTLS 配置
  const mtlsConfig = loadMTLSConfig();

  // Agent 配置
  const agentOptions = {
    timeout: options?.timeout,
    keepAlive: options?.keepAlive ?? true,
    maxSockets: options?.maxSockets,
    maxFreeSockets: options?.maxFreeSockets,
    rejectUnauthorized: options?.rejectUnauthorized ?? true,
    ca: options?.ca,
    // v2.1.23: mTLS 支持
    cert: options?.cert || mtlsConfig.cert,
    key: options?.key || mtlsConfig.key,
    passphrase: options?.passphrase || mtlsConfig.passphrase,
  };

  // 根据协议创建对应的 Agent
  if (finalProxyUrl.startsWith('socks://') || finalProxyUrl.startsWith('socks5://') || finalProxyUrl.startsWith('socks4://')) {
    return new SocksProxyAgent(finalProxyUrl, agentOptions) as unknown as Agent;
  } else if (finalProxyUrl.startsWith('https://')) {
    return new HttpsProxyAgent(finalProxyUrl, agentOptions) as unknown as Agent;
  } else if (finalProxyUrl.startsWith('http://')) {
    // 对于 HTTPS 目标URL，即使代理是 HTTP，也需要使用 HttpsProxyAgent
    const isTargetHttps = targetUrl.startsWith('https://');
    if (isTargetHttps) {
      return new HttpsProxyAgent(finalProxyUrl, agentOptions) as unknown as Agent;
    } else {
      return new HttpProxyAgent(finalProxyUrl, agentOptions) as unknown as Agent;
    }
  }

  return undefined;
}

/**
 * 获取代理信息（用于调试）
 */
export function getProxyInfo(targetUrl: string, config?: ProxyConfig): {
  enabled: boolean;
  proxyUrl?: string;
  bypassed: boolean;
} {
  const effectiveConfig: ProxyConfig = {
    ...getProxyFromEnv(),
    ...config,
  };

  const bypassed = shouldBypassProxy(targetUrl, effectiveConfig.noProxy);

  if (bypassed) {
    return { enabled: false, bypassed: true };
  }

  const isHttps = targetUrl.startsWith('https://');
  let proxyUrl =
    effectiveConfig.socks ||
    (isHttps ? effectiveConfig.https : effectiveConfig.http) ||
    effectiveConfig.https ||
    effectiveConfig.http;

  if (!proxyUrl && effectiveConfig.useSystemProxy) {
    proxyUrl = getProxyForUrl(targetUrl);
  }

  return {
    enabled: !!proxyUrl,
    proxyUrl,
    bypassed: false,
  };
}
