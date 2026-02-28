/**
 * Anthropic API 透传代理服务器
 *
 * 支持两种认证模式：
 * 1. API Key 模式：转发 x-api-key
 * 2. OAuth 订阅模式：转发 Authorization: Bearer + 自动刷新 token
 *
 * 客户端使用方式（完全透明，无需修改任何代码）：
 *   ANTHROPIC_API_KEY=<proxy-key> ANTHROPIC_BASE_URL=http://<host>:<port> claude
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { VERSION_BASE } from '../version.js';

// ============ OAuth 常量 ============

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_ENDPOINT = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_BETA = 'oauth-2025-04-20';
const AXON_BETA = 'claude-code-20250219';
const THINKING_BETA = 'interleaved-thinking-2025-05-14';
const PROMPT_CACHING_SCOPE_BETA = 'prompt-caching-scope-2026-01-05';

// Axon 身份标识（Anthropic 订阅 token 要求 system prompt 必须以此开头）
// 官方有三种有效身份标识，CC 客户端根据运行模式使用不同的版本：
//   1. CLI 模式:       "You are Axon, an AI-powered coding assistant."
//   2. Agent SDK 模式: "You are Axon, an AI-powered coding assistant, running within the Claude Agent SDK."
//   3. 自定义 Agent:   "You are a Claude agent, built on Anthropic's Claude Agent SDK."
const AXON_IDENTITIES = [
  "You are Axon, an AI-powered coding assistant, running within the Claude Agent SDK.",
  "You are Axon, an AI-powered coding assistant.",
  "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
];
// 注入时使用最短的 CLI 身份标识（兼容性最好）
const AXON_IDENTITY = AXON_IDENTITIES[1];

// Token 提前刷新时间：过期前 5 分钟
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// 代理的持久 ID（模拟官方 CC 的 Sy() 设备ID 和 B6() 会话ID）
// 每次代理进程启动时重新生成，与官方 CC 行为一致
const PROXY_DEVICE_ID = crypto.randomBytes(32).toString('hex');
const PROXY_SESSION_ID = crypto.randomUUID();

// ============ 类型定义 ============

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  /** 代理服务器监听端口 */
  port: number;
  /** 代理服务器监听地址 */
  host: string;
  /** 客户端连接代理时使用的 key（用于鉴权） */
  proxyApiKey: string;
  /** 认证模式 */
  authMode: AuthMode;
  /** API Key 模式：真实的 Anthropic API Key */
  anthropicApiKey?: string;
  /** OAuth 模式：access token */
  oauthAccessToken?: string;
  /** OAuth 模式：refresh token */
  oauthRefreshToken?: string;
  /** OAuth 模式：token 过期时间 (ms timestamp) */
  oauthExpiresAt?: number;
  /** OAuth 模式：账户 UUID（从 ~/.axon/.credentials.json 的 oauthAccount 读取） */
  oauthAccountUuid?: string;
  /** 转发目标地址，默认 https://api.anthropic.com */
  targetBaseUrl: string;
}

interface OAuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshing: Promise<boolean> | null;
  accountUUID: string | null;
}

/**
 * 从 JWT access token 中解码出 account UUID
 * Claude OAuth access token 是 JWT 格式，payload 中包含 sub (subject) 字段
 */
function extractAccountUUID(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;

    // Base64url decode payload (第二段)
    let payload = parts[1];
    // 补齐 base64 padding
    payload = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';

    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded);

    // 尝试常见的 claim 名称
    const uuid = claims.sub || claims.account_uuid || claims.account_id;
    if (uuid && typeof uuid === 'string') {
      console.log(`[AUTH] JWT 解码成功: sub=${uuid.slice(0, 12)}... claims=[${Object.keys(claims).join(',')}]`);
      return uuid;
    }

    // 没找到 UUID，打印所有 claims 帮助调试
    console.log(`[AUTH] JWT 解码成功但未找到 account UUID, claims: ${JSON.stringify(claims).slice(0, 200)}`);
    return null;
  } catch (e: any) {
    console.log(`[AUTH] access token 不是 JWT 格式或解码失败: ${e.message}`);
    return null;
  }
}

/**
 * 调用 Anthropic OAuth profile API 获取 accountUuid
 * 这是官方 CC 的 C21() 函数实现
 * 端点: GET https://api.anthropic.com/api/oauth/profile
 */
async function fetchAccountUUID(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/profile', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.log(`[AUTH] Profile API 失败: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as any;
    const uuid = data?.account?.uuid;
    if (uuid && typeof uuid === 'string') {
      console.log(`[AUTH] Profile API 成功: accountUuid=${uuid.slice(0, 12)}... email=${data?.account?.email || 'N/A'}`);
      return uuid;
    }

    console.log(`[AUTH] Profile API 返回但无 account.uuid: ${JSON.stringify(data).slice(0, 200)}`);
    return null;
  } catch (err: any) {
    console.log(`[AUTH] Profile API 异常: ${err.message}`);
    return null;
  }
}

interface RequestLog {
  time: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  clientIp: string;
  streaming: boolean;
}

// ============ 工具函数 ============

/**
 * 从 IncomingMessage 中收集完整的请求体
 */
function collectBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 不应该转发的 hop-by-hop 头部 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

/**
 * 刷新 OAuth token
 */
async function refreshOAuthToken(state: OAuthState): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: OAUTH_CLIENT_ID,
      refresh_token: state.refreshToken,
    });

    const response = await fetch(OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      console.error(`[AUTH] Token 刷新失败: ${response.status} ${response.statusText}`);
      return false;
    }

    const data = await response.json() as any;
    state.accessToken = data.access_token;
    if (data.refresh_token) {
      state.refreshToken = data.refresh_token;
    }
    state.expiresAt = Date.now() + data.expires_in * 1000;

    // 刷新后重新提取 account UUID
    const newUUID = extractAccountUUID(data.access_token);
    if (newUUID) {
      state.accountUUID = newUUID;
    }

    const remainMin = Math.round((state.expiresAt - Date.now()) / 60000);
    console.log(`[AUTH] Token 刷新成功，有效期 ${remainMin} 分钟`);
    return true;
  } catch (err: any) {
    console.error(`[AUTH] Token 刷新异常: ${err.message}`);
    return false;
  }
}

/**
 * 确保 OAuth token 有效（提前刷新）
 */
async function ensureValidOAuthToken(state: OAuthState): Promise<boolean> {
  // token 还没过期也不需要提前刷新
  if (state.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return true;
  }

  console.log('[AUTH] Token 即将过期，正在刷新...');

  // 防止并发刷新
  if (state.refreshing) {
    return state.refreshing;
  }

  state.refreshing = refreshOAuthToken(state).finally(() => {
    state.refreshing = null;
  });

  return state.refreshing;
}

/**
 * 构建 betas 数组（参考 src/core/client.ts 的 buildBetas 函数）
 *
 * 完全从零生成，不从客户端请求中取。
 * 客户端以 API key 模式连接代理，其 beta 组合可能与 OAuth 模式不同。
 * 代理必须以 OAuth 身份发请求，所以 betas 必须匹配 OAuth 模式。
 */
function buildProxyBetas(model: string): string[] {
  const betas: string[] = [];
  const isHaiku = model.toLowerCase().includes('haiku');

  // 1. 非 haiku 模型添加 claude-code beta（官方: if(!K)q.push(tFA)）
  if (!isHaiku) {
    betas.push(AXON_BETA);
  }

  // 2. OAuth 订阅用户必须添加 oauth beta（官方: if(O7())q.push(zE)）
  betas.push(OAUTH_BETA);

  // 3. 支持 thinking 的模型添加 thinking beta
  if (model.includes('claude-sonnet-4') || model.includes('claude-opus-4') || model.includes('claude-haiku-4')) {
    betas.push(THINKING_BETA);
  }

  // 4. prompt-caching-scope beta — 不添加！
  //    官方 CC 只在 experimentalEnabled 时才添加此 beta（client.ts:434）
  //    此 beta 会强制执行 "maximum 4 cache_control blocks" 限制，
  //    而真实 CC 客户端发来的请求通常有 3 system + 1 tool + 1 message = 5 个，
  //    超过限制就会报 400 错误。

  return betas;
}

/**
 * 构建转发到目标服务器的请求头
 *
 * 策略：转发客户端 SDK 生成的 headers + 定向修补认证和 betas。
 *
 * 实验证明：转发客户端 headers（SDK 自动生成的 x-stainless-*、User-Agent 等）
 * 是唯一通过 CC 身份验证的方式。从零构建会遗漏 SDK 内部的微妙差异。
 *
 * 修补内容：
 *   - 认证：x-api-key → Authorization: Bearer（OAuth 模式）
 *   - betas：去掉 prompt-caching-scope（实验证明去掉后 CC 验证通过）
 *   - 添加 oauth beta（如果客户端没有）
 *   - 保留其他所有 SDK 生成的 headers
 */
function buildForwardHeaders(
  authMode: AuthMode,
  authValue: string,
  model: string,
  bodyLength: number,
  clientHeaders: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  if (authMode === 'api-key') {
    // API Key 模式：简单直转
    return {
      'content-type': 'application/json',
      'accept': 'application/json',
      'x-api-key': authValue,
      'anthropic-version': '2023-06-01',
      'content-length': String(bodyLength),
    };
  }

  // OAuth 模式：转发客户端 headers + 定向修补
  const headers: http.OutgoingHttpHeaders = {};

  // 1. 复制客户端的所有 headers（保留 SDK 的 x-stainless-*、User-Agent 等）
  for (const [key, value] of Object.entries(clientHeaders)) {
    // 跳过 hop-by-hop headers 和需要替换的 headers
    if (key === 'host' || key === 'connection' || key === 'transfer-encoding' ||
        key === 'x-api-key' || key === 'authorization' || key === 'content-length') {
      continue;
    }
    if (value !== undefined) {
      headers[key] = typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  // 2. 替换认证头
  headers['authorization'] = `Bearer ${authValue}`;
  // 删除客户端的 x-api-key（如果有）
  delete headers['x-api-key'];

  // 3. 修补 betas：去掉 prompt-caching-scope + 确保有 oauth beta
  //    实验证明：去掉 prompt-caching-scope 后 CC 验证通过
  //    ttl ordering 问题通过 body 中统一 cache_control 解决
  const clientBeta = (headers['anthropic-beta'] as string) || '';
  let betaList = clientBeta.split(',').map(b => b.trim()).filter(Boolean);

  // 去掉 prompt-caching-scope（这是通过 CC 验证的关键）
  betaList = betaList.filter(b => !b.startsWith('prompt-caching-scope'));

  // 确保包含 claude-code beta
  if (!betaList.includes(AXON_BETA) && !model.toLowerCase().includes('haiku')) {
    betaList.push(AXON_BETA);
  }

  // 确保包含 oauth beta
  if (!betaList.includes(OAUTH_BETA)) {
    betaList.push(OAUTH_BETA);
  }

  // 确保包含 thinking beta（如果模型支持）
  if (!betaList.includes(THINKING_BETA) &&
      (model.includes('claude-sonnet-4') || model.includes('claude-opus-4') || model.includes('claude-haiku-4'))) {
    betaList.push(THINKING_BETA);
  }

  headers['anthropic-beta'] = betaList.join(',');

  // 4. 确保有 anthropic-dangerous-direct-browser-access
  if (!headers['anthropic-dangerous-direct-browser-access']) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  // 5. 更新 content-length
  headers['content-length'] = String(bodyLength);

  return headers;
}

// ============ 服务器 ============

/**
 * 创建并启动代理服务器
 */
export async function createProxyServer(config: ProxyConfig) {
  const { port, host, proxyApiKey, authMode, targetBaseUrl } = config;
  const targetUrl = new URL(targetBaseUrl);
  const isTargetHttps = targetUrl.protocol === 'https:';
  const requestModule = isTargetHttps ? https : http;

  // OAuth 状态管理
  let oauthState: OAuthState | null = null;
  if (authMode === 'oauth') {
    // 第一步：尝试 JWT 解码 和 credentials 文件
    const jwtUUID = extractAccountUUID(config.oauthAccessToken || '');
    let accountUUID = jwtUUID || config.oauthAccountUuid || null;
    let uuidSource = jwtUUID ? 'JWT sub' : config.oauthAccountUuid ? 'credentials oauthAccount' : '';

    oauthState = {
      accessToken: config.oauthAccessToken!,
      refreshToken: config.oauthRefreshToken!,
      expiresAt: config.oauthExpiresAt || 0,
      refreshing: null,
      accountUUID,
    };

    // 第二步：如果前两种都失败，调用 Profile API（官方 CC 的 C21() 函数）
    if (!accountUUID) {
      console.log('[AUTH] JWT 和 credentials 都未找到 accountUuid，尝试调用 Profile API...');
      const profileUUID = await fetchAccountUUID(config.oauthAccessToken || '');
      if (profileUUID) {
        accountUUID = profileUUID;
        uuidSource = 'Profile API';
        oauthState.accountUUID = profileUUID;
      }
    }

    if (accountUUID) {
      console.log(`[AUTH] Account UUID: ${accountUUID} (来源: ${uuidSource})`);
    } else {
      console.log('[AUTH] ⚠ 无法获取 account UUID（JWT/credentials/Profile API 全部失败），metadata 将使用空 account');
    }
    console.log(`[AUTH] Proxy Device ID: ${PROXY_DEVICE_ID.slice(0, 16)}...`);
    console.log(`[AUTH] Proxy Session ID: ${PROXY_SESSION_ID}`);
  }

  const logs: RequestLog[] = [];

  const server = http.createServer(async (req, res) => {
    const startTime = Date.now();
    const clientIp = req.socket.remoteAddress || 'unknown';
    const method = req.method || 'GET';
    const path = req.url || '/';

    // CORS 预检请求
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // 健康检查端点
    if (path === '/health' || path === '/') {
      const info: any = {
        status: 'ok',
        mode: 'anthropic-api-proxy',
        authMode,
        target: targetBaseUrl,
        timestamp: new Date().toISOString(),
        totalRequests: logs.length,
      };
      if (oauthState) {
        const remainMin = Math.max(0, Math.round((oauthState.expiresAt - Date.now()) / 60000));
        info.tokenExpiresIn = `${remainMin} min`;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(info));
      return;
    }

    // 统计端点
    if (path === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalRequests: logs.length,
        recentRequests: logs.slice(-100),
      }));
      return;
    }

    // ===== 鉴权：验证客户端提供的 proxy key =====
    const clientKey =
      (req.headers['x-api-key'] as string) ||
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '');

    if (!clientKey || clientKey !== proxyApiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Invalid API key provided to proxy.',
        },
      }));
      // 调试日志：显示客户端实际发送的 key（脱敏）
      const mask = (s?: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)} (len=${s.length})` : '<empty>';
      console.log(`[DENIED] ${method} ${path} from ${clientIp} - Invalid proxy key`);
      console.log(`  ├─ x-api-key header:     ${mask(req.headers['x-api-key'] as string)}`);
      console.log(`  ├─ authorization header:  ${mask(req.headers['authorization'] as string)}`);
      console.log(`  ├─ extracted clientKey:   ${mask(clientKey)}`);
      console.log(`  └─ expected proxyApiKey:  ${mask(proxyApiKey)}`);
      return;
    }

    // ===== OAuth: 确保 token 有效 =====
    if (authMode === 'oauth' && oauthState) {
      const tokenValid = await ensureValidOAuthToken(oauthState);
      if (!tokenValid) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: {
            type: 'proxy_auth_error',
            message: 'OAuth token expired and refresh failed. Please restart the proxy after re-login.',
          },
        }));
        console.error(`[ERROR] OAuth token 刷新失败`);
        return;
      }
    }

    // ===== 转发请求 =====
    try {
      let body = await collectBody(req);
      const forwardUrl = new URL(path, targetBaseUrl);

      // 获取认证值
      const authValue = authMode === 'api-key'
        ? config.anthropicApiKey!
        : oauthState!.accessToken;

      // 提取 model（用于构建 betas）
      let requestModel = 'claude-sonnet-4-20250514'; // 默认值
      if (body.length > 0) {
        try {
          const peek = JSON.parse(body.toString());
          if (peek.model) requestModel = peek.model;
        } catch { /* ignore */ }
      }

      // 检测是否是流式请求 + OAuth 模式下注入 Axon 身份
      let isStreaming = false;
      if (body.length > 0) {
        try {
          const parsed = JSON.parse(body.toString());
          isStreaming = parsed.stream === true;

          // OAuth 模式：确保 system prompt 以 Axon 身份开头
          // 这是 Anthropic 订阅 token 的硬性要求，否则返回 invalid_request_error
          if (authMode === 'oauth' && parsed.messages) {
            // 保存原始 body 快照（修改前），用于 dump 对比
            const originalBodySnapshot: Record<string, string> = {};
            // 深度记录原始 system prompt 结构（修改前）
            let originalSystemDetail = '';
            for (const [k, v] of Object.entries(parsed)) {
              if (k === 'messages') originalBodySnapshot[k] = `[${(v as any[])?.length || 0} msgs]`;
              else if (k === 'system') {
                if (typeof v === 'string') {
                  originalBodySnapshot[k] = `string(${(v as string).length})`;
                  originalSystemDetail = `string(${(v as string).length}): ${(v as string).slice(0, 200)}`;
                } else if (Array.isArray(v)) {
                  originalBodySnapshot[k] = `array[${(v as any[]).length}]`;
                  originalSystemDetail = `array[${(v as any[]).length}]:\n`;
                  for (let si = 0; si < (v as any[]).length; si++) {
                    const sb = (v as any[])[si];
                    originalSystemDetail += `      [${si}] type=${sb.type}, text.len=${sb.text?.length || 0}, cache_control=${JSON.stringify(sb.cache_control || null)}\n`;
                    originalSystemDetail += `          text前200字符: ${(sb.text || '').slice(0, 200)}\n`;
                  }
                } else {
                  originalBodySnapshot[k] = typeof v;
                  originalSystemDetail = `${typeof v}`;
                }
              }
              else if (k === 'tools') originalBodySnapshot[k] = `[${(v as any[])?.length || 0} tools]`;
              else originalBodySnapshot[k] = JSON.stringify(v)?.slice(0, 300) || 'undefined';
            }

            let needsRewrite = false;
            const systemType = parsed.system == null ? 'none'
              : typeof parsed.system === 'string' ? 'string'
              : Array.isArray(parsed.system) ? `array[${parsed.system.length}]` : typeof parsed.system;

            // 辅助函数：检查文本是否以任一有效 CC 身份标识开头
            const hasValidIdentity = (text: string): boolean =>
              AXON_IDENTITIES.some(id => text.startsWith(id));

            if (!parsed.system) {
              // 没有 system prompt，直接添加
              parsed.system = AXON_IDENTITY;
              needsRewrite = true;
            } else if (typeof parsed.system === 'string') {
              // string 格式的 system prompt
              if (!hasValidIdentity(parsed.system)) {
                parsed.system = AXON_IDENTITY + '\n\n' + parsed.system;
                needsRewrite = true;
              }
              // 已有有效身份标识，不做任何修改
            } else if (Array.isArray(parsed.system)) {
              if (parsed.system.length === 0) {
                // 空数组，转成包含身份标识的数组
                parsed.system = [{ type: 'text', text: AXON_IDENTITY }];
                needsRewrite = true;
              } else {
                // 官方 CC 的 system prompt 结构（cli.js:3117-3123）：
                //   Block 0: "x-anthropic-billing-header: cc_version=...; cc_entrypoint=...;" (cacheScope: null)
                //   Block 1: identity string (cacheScope: "org")
                //   Block 2: rest of prompt (cacheScope: "org")
                //
                // 关键：billing header 块必须保持独立！不能把 identity 拼接进去。
                // 只在非 billing header 的 text block 中查找/注入 identity。

                // 辅助：检查是否是 billing header block
                const isBillingBlock = (b: any): boolean =>
                  b?.type === 'text' && typeof b.text === 'string' && b.text.startsWith('x-anthropic-billing-header');

                // 在非 billing header 的 text block 中查找 identity
                const identityIdx = parsed.system.findIndex(
                  (b: any) => b?.type === 'text' && !isBillingBlock(b) && hasValidIdentity(b.text || '')
                );

                if (identityIdx >= 0) {
                  // 已有有效身份标识，不做任何修改
                } else {
                  // 没有 identity block，需要插入一个
                  // 找到 billing header 后面的位置插入（保持官方结构：billing → identity → rest）
                  let insertIdx = 0;
                  for (let i = 0; i < parsed.system.length; i++) {
                    if (isBillingBlock(parsed.system[i])) {
                      insertIdx = i + 1;
                      break;
                    }
                  }
                  parsed.system.splice(insertIdx, 0, { type: 'text', text: AXON_IDENTITY });
                  needsRewrite = true;
                }
              }
            }

            // cache_control 注入 — 完全对齐 src/core/client.ts 的实现
            //
            // 我们自己的 CLI（npm run dev）用的格式：
            //   formatSystemPrompt(): 每个 system text block → { type: 'ephemeral' }
            //   buildApiTools():      最后一个 tool → { type: 'ephemeral' }
            //   formatMessages():     最后一条消息的最后一个非 thinking block → { type: 'ephemeral' }
            //
            // 注意：不用 ttl:"1h" 或 scope:"global"！
            //   ttl/scope 格式会触发 "maximum 4 blocks" 限制，
            //   而简单的 {type:"ephemeral"} 没有这个限制。
            {
              const CC = { type: 'ephemeral' };

              // 1. system prompt blocks → 仅 first + last text block（最多 2 个）
              //    确保总计不超过 4（2 system + 1 tool + 1 message）
              if (Array.isArray(parsed.system)) {
                // 先清除所有 system block 的 cache_control
                for (const block of parsed.system) {
                  if (block && typeof block === 'object' && block.cache_control) {
                    delete block.cache_control;
                    needsRewrite = true;
                  }
                }
                const textIdxs: number[] = [];
                for (let i = 0; i < parsed.system.length; i++) {
                  if (parsed.system[i]?.type === 'text') textIdxs.push(i);
                }
                if (textIdxs.length > 0) {
                  parsed.system[textIdxs[0]].cache_control = { ...CC };
                  needsRewrite = true;
                  if (textIdxs.length > 1) {
                    parsed.system[textIdxs[textIdxs.length - 1]].cache_control = { ...CC };
                  }
                }
              }

              // 2. tools → 仅最后一个（对齐 buildApiTools）
              if (Array.isArray(parsed.tools) && parsed.tools.length > 0) {
                // 先清除所有 tools 上已有的 cache_control
                for (const tool of parsed.tools) {
                  if (tool && typeof tool === 'object' && tool.cache_control) {
                    delete tool.cache_control;
                    needsRewrite = true;
                  }
                }
                // 仅最后一个 tool
                const lastTool = parsed.tools[parsed.tools.length - 1];
                if (lastTool && typeof lastTool === 'object') {
                  lastTool.cache_control = { ...CC };
                  needsRewrite = true;
                }
              }

              // 3. messages → 仅最后一条消息的最后一个非 thinking block（对齐 formatMessages）
              if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
                // 先清除所有 messages 中已有的 cache_control
                for (const msg of parsed.messages) {
                  if (Array.isArray(msg.content)) {
                    for (const block of msg.content) {
                      if (block && typeof block === 'object' && block.cache_control) {
                        delete block.cache_control;
                        needsRewrite = true;
                      }
                    }
                  }
                }
                // 最后一条消息
                const lastMsg = parsed.messages[parsed.messages.length - 1];
                if (Array.isArray(lastMsg?.content) && lastMsg.content.length > 0) {
                  // 从后往前找第一个非 thinking block
                  for (let i = lastMsg.content.length - 1; i >= 0; i--) {
                    const block = lastMsg.content[i];
                    if (block && typeof block === 'object'
                      && block.type !== 'thinking' && block.type !== 'redacted_thinking') {
                      block.cache_control = { ...CC };
                      needsRewrite = true;
                      break;
                    }
                  }
                }
              }
            }

            // OAuth 模式：总是重建 metadata
            //
            // 官方 CC 的 ho() 总是为 messages 请求生成 metadata：
            //   { user_id: "user_${Sy()}_account_${accountUuid ?? ''}_session_${B6()}" }
            //
            // 客户端以 API Key 模式连接代理，其 buildMetadata() 生成的
            // user_id 中 account 为空、device hex 是客户端的随机值。
            // 代理必须用自己的 device ID + accountUUID 完整重建。
            {
              const accountUuid = oauthState?.accountUUID || '';
              parsed.metadata = {
                user_id: `user_${PROXY_DEVICE_ID}_account_${accountUuid}_session_${PROXY_SESSION_ID}`
              };
              needsRewrite = true;
              console.log(`[INJECT] 重建 metadata: device=${PROXY_DEVICE_ID.slice(0, 8)}... account=${accountUuid ? accountUuid.slice(0, 8) + '...' : '<空>'} session=${PROXY_SESSION_ID.slice(0, 8)}...`);
            }

            if (needsRewrite) {
              body = Buffer.from(JSON.stringify(parsed));
              console.log('[INJECT] 请求已重写');
            }

            // body 处理完毕，从模型名提取 requestModel（用于 betas）
            if (parsed.model) requestModel = parsed.model;

            // ===== 完整请求 DUMP：客户端原始 vs 代理转发 =====
            console.log(`[DUMP] ═══ 客户端原始请求 ═══`);
            // 客户端发来的所有 header（原始，未经代理修改）
            console.log(`  [原始 headers - 全部]`);
            for (const [hk, hv] of Object.entries(req.headers)) {
              const val = typeof hv === 'string' ? hv : Array.isArray(hv) ? hv.join(', ') : String(hv);
              if (hk === 'x-api-key' || hk === 'authorization') {
                console.log(`    ${hk}: ${val.slice(0, 12)}...(len=${val.length})`);
              } else {
                console.log(`    ${hk}: ${val.slice(0, 200)}`);
              }
            }
            // 客户端发来的所有 body 字段（修改前快照）
            console.log(`  [原始 body 字段 - 全部]`);
            for (const [bk, bv] of Object.entries(originalBodySnapshot)) {
              console.log(`    ${bk}: ${bv}`);
            }
            // 原始 system prompt 详细结构（修改前）
            if (originalSystemDetail) {
              console.log(`  [原始 system prompt 详情 - 修改前]`);
              console.log(`    ${originalSystemDetail}`);
            }

            // ===== 详细 DUMP：system prompt 结构 =====
            console.log(`  [system prompt 详情 - 修改后]`);
            if (!parsed.system) {
              console.log(`    <无 system prompt>`);
            } else if (typeof parsed.system === 'string') {
              console.log(`    格式: string (len=${parsed.system.length})`);
              console.log(`    内容前300字符: ${parsed.system.slice(0, 300)}`);
            } else if (Array.isArray(parsed.system)) {
              console.log(`    格式: array[${parsed.system.length}]`);
              for (let si = 0; si < parsed.system.length; si++) {
                const sb = parsed.system[si];
                console.log(`    [${si}] type=${sb.type}, text.len=${sb.text?.length || 0}, cache_control=${JSON.stringify(sb.cache_control || null)}`);
                console.log(`        text前200字符: ${(sb.text || '').slice(0, 200)}`);
              }
            }

            // ===== 详细 DUMP：消息列表 =====
            if (parsed.messages && Array.isArray(parsed.messages)) {
              const msgs = parsed.messages;
              console.log(`  [messages 详情] 共 ${msgs.length} 条`);
              // 显示前3条和后2条
              const showIndices = new Set<number>();
              for (let mi = 0; mi < Math.min(3, msgs.length); mi++) showIndices.add(mi);
              for (let mi = Math.max(0, msgs.length - 2); mi < msgs.length; mi++) showIndices.add(mi);
              for (const mi of Array.from(showIndices).sort((a, b) => a - b)) {
                const msg = msgs[mi];
                const role = msg.role || '?';
                let contentSummary = '';
                if (typeof msg.content === 'string') {
                  contentSummary = `string(${msg.content.length}): ${msg.content.slice(0, 150)}`;
                } else if (Array.isArray(msg.content)) {
                  const blocks = msg.content.map((b: any) => {
                    if (b.type === 'text') return `text(${(b.text || '').length})`;
                    if (b.type === 'tool_use') return `tool_use(${b.name})`;
                    if (b.type === 'tool_result') return `tool_result(${b.tool_use_id?.slice(0, 12)})`;
                    if (b.type === 'thinking') return `thinking(${(b.thinking || '').length})`;
                    if (b.type === 'redacted_thinking') return `redacted_thinking`;
                    return `${b.type || 'unknown'}`;
                  });
                  contentSummary = `[${blocks.join(', ')}]`;
                  // 显示第一个 text block 的内容
                  const firstText = msg.content.find((b: any) => b.type === 'text');
                  if (firstText?.text) {
                    contentSummary += ` first_text: ${firstText.text.slice(0, 150)}`;
                  }
                }
                console.log(`    [${mi}] ${role}: ${contentSummary}`);
                // 显示 cache_control
                if (Array.isArray(msg.content)) {
                  for (const b of msg.content) {
                    if (b.cache_control) {
                      console.log(`        ^ cache_control on ${b.type}: ${JSON.stringify(b.cache_control)}`);
                    }
                  }
                }
              }
              if (msgs.length > 5) {
                console.log(`    ... 省略 ${msgs.length - 5} 条中间消息 ...`);
              }
            }

            // ===== 详细 DUMP：工具列表 =====
            if (parsed.tools && Array.isArray(parsed.tools) && parsed.tools.length > 0) {
              const toolNames = parsed.tools.map((t: any) => t.name || '?').join(', ');
              console.log(`  [tools] ${parsed.tools.length} 个: ${toolNames}`);
            }

            // ===== 详细 DUMP：其他关键字段 =====
            if (parsed.tool_choice) console.log(`  tool_choice:    ${JSON.stringify(parsed.tool_choice)}`);
            if (parsed.output_config) console.log(`  output_config:  ${JSON.stringify(parsed.output_config)}`);
            if (parsed.context_management) console.log(`  context_mgmt:   ${JSON.stringify(parsed.context_management)}`);

            console.log(`[DUMP] ═══ 代理转发请求 ═══`);
            // 代理修改后的 body 关键字段
            console.log(`  model:          ${parsed.model}`);
            console.log(`  metadata:       ${JSON.stringify(parsed.metadata || null)}`);
            if (parsed.thinking) {
              console.log(`  thinking:       ${JSON.stringify(parsed.thinking)}`);
            }
            console.log(`  max_tokens:     ${parsed.max_tokens}`);
            console.log(`  stream:         ${parsed.stream}`);
            // 预览转发 headers（最终版在 body 处理后构建）
            const previewHeaders = buildForwardHeaders(authMode, authValue, requestModel, body.length, req.headers);
            console.log(`  [转发 headers - 全部] (转发+修补)`);
            for (const [hk, hv] of Object.entries(previewHeaders)) {
              const val = typeof hv === 'string' ? hv : String(hv);
              if (hk === 'authorization') {
                console.log(`    ${hk}: ${val.slice(0, 20)}...(len=${val.length})`);
              } else {
                console.log(`    ${hk}: ${val.slice(0, 200)}`);
              }
            }
            console.log(`  [转发 body keys]: ${Object.keys(parsed).join(', ')}`);
            console.log(`[DUMP] ═══ end ═══`);
          }
        } catch {
          // 非 JSON body，跳过
        }
      }

      console.log(
        `[PROXY] ${method} ${path} from ${clientIp}` +
        ` [${authMode}]` +
        (isStreaming ? ' (streaming)' : ''),
      );

      // ===== 核心转发逻辑：OAuth messages 端点使用 SDK 驱动 =====
      //
      // 原理：直接抄袭 CLI 模块的实现方式。
      // CLI 通过 Anthropic SDK 发请求，SDK 自动处理所有 headers、betas、认证。
      // 代理做同样的事：创建 SDK 实例，用自定义 fetch 截获 SDK 构建的完美请求，
      // 然后用 globalThis.fetch 发出真正请求，把原始响应 pipe 回客户端。
      //
      // 这样做的好处：
      //   1. headers 由 SDK 生成，与官方 CC 完全一致（x-stainless-*、betas 等）
      //   2. 不需要手动拼凑或猜测 headers
      //   3. 响应直接 pipe，不经过 SDK 解析，客户端收到原始 SSE 流
      const isOAuthMessages = authMode === 'oauth' && path.startsWith('/v1/messages') && body.length > 0;

      if (isOAuthMessages) {
        // ===== v4: 直接转发模式（不使用 SDK）=====
        //
        // 核心原理：完全保留 CC 客户端的原始 headers 和 body，只替换 auth。
        //
        // 之前的 v1-v3 都通过 SDK 重新生成 headers/body，导致与真正的 CC 客户端
        // 存在微妙差异（如 User-Agent 版本不匹配、stainless 参数不同等），
        // Anthropic 的 CC 凭证校验（由 claude-code-20250219 beta 触发）因此失败。
        //
        // v4 策略：
        //   1. 取 CC 客户端的原始 headers，只替换 auth + 修补 betas
        //   2. 取代理修改后的 body（identity、metadata、cache_control 已注入）
        //   3. 用 globalThis.fetch 直接转发
        //   4. 响应直接 pipe 回客户端
        try {
          const parsedBody = JSON.parse(body.toString());

          // ── 构建转发 headers：基于客户端原始 headers ──
          const fwdHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            const lk = key.toLowerCase();
            if (HOP_BY_HOP_HEADERS.has(lk)) continue;
            if (lk === 'x-api-key') continue;       // 去掉代理 key
            if (lk === 'authorization') continue;    // 去掉代理 key
            if (lk === 'content-length') continue;   // 后面重新计算
            if (typeof value === 'string') fwdHeaders[lk] = value;
            else if (Array.isArray(value)) fwdHeaders[lk] = value[0]; // 取第一个
          }

          // OAuth auth
          fwdHeaders['authorization'] = `Bearer ${oauthState!.accessToken}`;

          // 确保 anthropic-dangerous-direct-browser-access 存在（OAuth 必须）
          fwdHeaders['anthropic-dangerous-direct-browser-access'] = 'true';

          // 修补 betas: 去掉 prompt-caching-scope + 添加 oauth beta
          //
          // 与 buildForwardHeaders() 对齐：
          //   - 去掉 prompt-caching-scope（客户端 API key 模式可能添加了，但 OAuth 转发会导致
          //     cache_control scope/ttl 格式与实际 body 中的 {type:"ephemeral"} 不匹配）
          //   - 确保包含 oauth beta
          const existingBetas = fwdHeaders['anthropic-beta'] || '';
          let betaParts = existingBetas ? existingBetas.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
          // 去掉 prompt-caching-scope（与 buildForwardHeaders 一致）
          betaParts = betaParts.filter((b: string) => !b.startsWith('prompt-caching-scope'));
          if (!betaParts.includes(OAUTH_BETA)) {
            betaParts.push(OAUTH_BETA);
          }
          fwdHeaders['anthropic-beta'] = betaParts.join(',');

          // ── 构建转发 body：基于代理修改后的 parsedBody ──
          const bodyObj: any = { ...parsedBody };

          // 确保 stream 正确
          if (isStreaming) {
            bodyObj.stream = true;
          }

          // cache_control 注入 — 对齐 src/core/client.ts
          {
            const CC = { type: 'ephemeral' };

            // system: 仅 first + last text block（最多 2 个）
            if (Array.isArray(bodyObj.system)) {
              for (const block of bodyObj.system) {
                if (block && typeof block === 'object') delete block.cache_control;
              }
              const textIdxs: number[] = [];
              for (let i = 0; i < bodyObj.system.length; i++) {
                if (bodyObj.system[i]?.type === 'text') textIdxs.push(i);
              }
              if (textIdxs.length > 0) {
                bodyObj.system[textIdxs[0]].cache_control = { ...CC };
                if (textIdxs.length > 1) {
                  bodyObj.system[textIdxs[textIdxs.length - 1]].cache_control = { ...CC };
                }
              }
            }

            // tools: 清除全部，仅最后一个
            if (Array.isArray(bodyObj.tools) && bodyObj.tools.length > 0) {
              for (const tool of bodyObj.tools) {
                if (tool && typeof tool === 'object') delete tool.cache_control;
              }
              bodyObj.tools[bodyObj.tools.length - 1].cache_control = { ...CC };
            }

            // messages: 清除全部，仅最后一条的最后一个非 thinking block
            if (Array.isArray(bodyObj.messages) && bodyObj.messages.length > 0) {
              for (const msg of bodyObj.messages) {
                if (Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block && typeof block === 'object') delete block.cache_control;
                  }
                }
              }
              const lastMsg = bodyObj.messages[bodyObj.messages.length - 1];
              if (Array.isArray(lastMsg?.content)) {
                for (let i = lastMsg.content.length - 1; i >= 0; i--) {
                  const b = lastMsg.content[i];
                  if (b && b.type !== 'thinking' && b.type !== 'redacted_thinking') {
                    b.cache_control = { ...CC };
                    break;
                  }
                }
              }
            }
          }

          const requestBody = JSON.stringify(bodyObj);

          // 更新 content-length
          fwdHeaders['content-length'] = Buffer.byteLength(requestBody, 'utf-8').toString();

          // 目标 URL
          const targetUrl = `${config.targetBaseUrl}${path}`;

          // 日志
          console.log(`[FWD] URL: ${targetUrl}`);
          console.log(`[FWD] Headers:`);
          for (const [k, v] of Object.entries(fwdHeaders)) {
            if (k === 'authorization') {
              console.log(`  ${k}: ${v.slice(0, 20)}...(len=${v.length})`);
            } else {
              console.log(`  ${k}: ${v.slice(0, 200)}`);
            }
          }
          try {
            console.log(`[FWD] Body keys: ${Object.keys(bodyObj).join(', ')}`);
            console.log(`[FWD] Body model: ${bodyObj.model}`);
            console.log(`[FWD] Body stream: ${bodyObj.stream}`);
            if (Array.isArray(bodyObj.system)) {
              const sysLen = bodyObj.system.length;
              console.log(`[FWD] Body system: array[${sysLen}]`);
              console.log(`[FWD] Body system[0] starts: ${(bodyObj.system[0]?.text || '').slice(0, 120)}`);
              const sysCacheCount = bodyObj.system.filter((b: any) => b?.cache_control).length;
              console.log(`[FWD] Body system cache_control count: ${sysCacheCount}/${sysLen}`);
            }
            if (Array.isArray(bodyObj.tools)) {
              console.log(`[FWD] Body tools: ${bodyObj.tools.length} tools, last cache: ${JSON.stringify(bodyObj.tools[bodyObj.tools.length - 1]?.cache_control)}`);
            }
            console.log(`[FWD] Body size: ${requestBody.length} bytes`);
          } catch {}

          // 直接转发
          const realResponse = await globalThis.fetch(targetUrl, {
            method: 'POST',
            headers: fwdHeaders,
            body: requestBody,
            // @ts-ignore - duplex needed for streaming request body
            duplex: 'half',
          });

          // 把原始响应 pipe 回代理客户端
          const statusCode = realResponse.status;
          const responseHeaders: Record<string, string> = {
            'access-control-allow-origin': '*',
            'access-control-expose-headers': '*',
          };
          // globalThis.fetch 自动解压 gzip/br，必须去掉 content-encoding/content-length
          const STRIP_RESP = new Set([...HOP_BY_HOP_HEADERS, 'content-encoding', 'content-length']);
          realResponse.headers.forEach((v, k) => {
            if (!STRIP_RESP.has(k.toLowerCase())) {
              responseHeaders[k] = v;
            }
          });

          if (isStreaming && statusCode === 200) {
            responseHeaders['cache-control'] = 'no-cache';
            responseHeaders['x-accel-buffering'] = 'no';
          }

          res.writeHead(statusCode, responseHeaders);

          if (realResponse.body) {
            const reader = realResponse.body.getReader();
            const errChunks: Uint8Array[] = [];
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(value);
                if (statusCode >= 400) errChunks.push(value);
              }
            } catch (pipeErr: any) {
              console.error(`[FWD] Pipe error: ${pipeErr.message}`);
            } finally {
              res.end();
            }

            const duration = Date.now() - startTime;
            logs.push({ time: new Date().toISOString(), method, path, status: statusCode, duration, clientIp, streaming: isStreaming });
            if (logs.length > 1000) logs.splice(0, logs.length - 1000);
            console.log(`[DONE]  ${method} ${path} -> ${statusCode} (${duration}ms)` + (isStreaming ? ' [stream]' : ''));
            if (statusCode >= 400) {
              const errBody = Buffer.from(errChunks.reduce((acc, chunk) => {
                const merged = new Uint8Array(acc.length + chunk.length);
                merged.set(acc); merged.set(chunk, acc.length);
                return merged;
              }, new Uint8Array())).toString().slice(0, 500);
              console.log(`  ⎿ API Error: ${statusCode} ${errBody}`);
            }
          } else {
            res.end();
            const duration = Date.now() - startTime;
            logs.push({ time: new Date().toISOString(), method, path, status: statusCode, duration, clientIp, streaming: isStreaming });
            console.log(`[DONE]  ${method} ${path} -> ${statusCode} (${duration}ms)`);
          }
        } catch (fwdErr: any) {
          console.error(`[FWD-ERROR] ${fwdErr.message}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              type: 'error',
              error: { type: 'proxy_error', message: `Forward failed: ${fwdErr.message}` },
            }));
          }
        }
      } else {
        // ===== 传统模式：非 OAuth 或非 messages 端点，用 http.request 直转 =====
        const forwardHeaders = buildForwardHeaders(authMode, authValue, requestModel, body.length, req.headers);
        forwardHeaders['host'] = forwardUrl.host;

        const proxyReq = requestModule.request(
          forwardUrl.toString(),
          {
            method,
            headers: forwardHeaders,
            ...(isTargetHttps ? { rejectUnauthorized: true } : {}),
          },
          (proxyRes) => {
            const statusCode = proxyRes.statusCode || 502;
            const responseHeaders: http.OutgoingHttpHeaders = {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Expose-Headers': '*',
            };
            for (const [key, value] of Object.entries(proxyRes.headers)) {
              if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
              if (value !== undefined) responseHeaders[key] = value;
            }
            if (isStreaming && statusCode === 200) {
              responseHeaders['Cache-Control'] = 'no-cache';
              responseHeaders['X-Accel-Buffering'] = 'no';
            }
            res.writeHead(statusCode, responseHeaders);

            if (statusCode >= 400) {
              const errChunks: Buffer[] = [];
              proxyRes.on('data', (chunk: Buffer) => { errChunks.push(chunk); res.write(chunk); });
              proxyRes.on('end', () => {
                res.end();
                const duration = Date.now() - startTime;
                const errBody = Buffer.concat(errChunks).toString().slice(0, 500);
                logs.push({ time: new Date().toISOString(), method, path, status: statusCode, duration, clientIp, streaming: isStreaming });
                if (logs.length > 1000) logs.splice(0, logs.length - 1000);
                console.log(`[DONE]  ${method} ${path} -> ${statusCode} (${duration}ms)` + (isStreaming ? ' [stream]' : ''));
                console.log(`  ⎿ API Error: ${statusCode} ${errBody}`);
              });
            } else {
              proxyRes.pipe(res);
              proxyRes.on('end', () => {
                const duration = Date.now() - startTime;
                logs.push({ time: new Date().toISOString(), method, path, status: statusCode, duration, clientIp, streaming: isStreaming });
                if (logs.length > 1000) logs.splice(0, logs.length - 1000);
                console.log(`[DONE]  ${method} ${path} -> ${statusCode} (${duration}ms)` + (isStreaming ? ' [stream]' : ''));
              });
            }
          },
        );

        proxyReq.on('error', (err) => {
          const duration = Date.now() - startTime;
          console.error(`[ERROR] ${method} ${path} -> ${err.message} (${duration}ms)`);
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              type: 'error',
              error: { type: 'proxy_error', message: `Failed to connect to upstream: ${err.message}` },
            }));
          }
        });

        if (body.length > 0) proxyReq.write(body);
        proxyReq.end();
      }

    } catch (err: any) {
      console.error(`[ERROR] ${method} ${path} -> ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'internal_error', message: err.message },
        }));
      }
    }
  });

  function start(): Promise<void> {
    return new Promise((resolve, reject) => {
      server.on('error', reject);
      server.listen(port, host, () => resolve());
    });
  }

  function stop(): Promise<void> {
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  return { server, start, stop, logs, oauthState };
}
