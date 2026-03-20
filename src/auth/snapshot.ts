/**
 * 统一认证快照 — 供 GoalTool / ScheduleTask 等需要持久化凭证的场景使用
 *
 * 问题背景：
 *   GoalTool 创建目标时需要快照当前认证，供 daemon 后台执行时复用。
 *   但在 Web UI 模式下，认证信息存在 settings.json 里，不在环境变量中。
 *   旧实现只读 process.env.ANTHROPIC_API_KEY，导致快照为空，daemon 执行时 401。
 *
 * 读取优先级（与 webAuth.getCredentials 对齐）:
 *   1. settings.json 中的 apiKey / OAuth 配置（Web UI 的主认证源）
 *   2. 环境变量 ANTHROPIC_API_KEY / AXON_API_KEY
 *   3. initAuth()/getAuth()（CLI keychain 等）
 */

import * as fs from 'fs';
import { configManager } from '../config/index.js';
import { initAuth, getAuth } from './index.js';

export interface AuthSnapshot {
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

/**
 * 从所有可用认证源获取当前有效凭证的快照
 * 适用于需要序列化认证信息供独立进程使用的场景（daemon、子进程等）
 */
export function snapshotAuthCredentials(): AuthSnapshot | undefined {
  // 来源 1: settings.json（Web UI 模式的主认证源）
  const fromSettings = readFromSettings();
  if (fromSettings && (fromSettings.apiKey || fromSettings.authToken)) {
    return fromSettings;
  }

  // 来源 2: 环境变量
  const envKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
    };
  }

  // 来源 3: CLI 认证系统（keychain 等）
  try {
    initAuth();
    const auth = getAuth();
    if (auth) {
      if (auth.type === 'api_key' && auth.apiKey) {
        return {
          apiKey: auth.apiKey,
          baseUrl: process.env.ANTHROPIC_BASE_URL,
        };
      }
      if (auth.type === 'oauth') {
        const token = auth.authToken || auth.accessToken;
        if (token) {
          return {
            authToken: token,
            baseUrl: process.env.ANTHROPIC_BASE_URL,
          };
        }
      }
    }
  } catch {
    // CLI auth 初始化失败，忽略
  }

  return undefined;
}

/**
 * 从 settings.json 读取认证信息
 * 复制了 webAuth.readSettings + getCredentials 的核心逻辑，
 * 避免工具层直接依赖 web server 层
 */
function readFromSettings(): AuthSnapshot | undefined {
  try {
    const settingsPath = configManager.getConfigPaths().userSettings;
    if (!fs.existsSync(settingsPath)) return undefined;

    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const apiKey = raw.apiKey;
    const apiBaseUrl = raw.apiBaseUrl;
    const authPriority = raw.authPriority || 'auto';

    const result: AuthSnapshot = {};
    if (apiBaseUrl) {
      result.baseUrl = apiBaseUrl;
    }

    // 按 authPriority 决定使用哪种凭证（与 webAuth.getCredentials 逻辑一致）
    if (authPriority === 'apiKey') {
      if (apiKey) result.apiKey = apiKey;
    } else if (authPriority === 'oauth') {
      const oauthCreds = readOAuthCredentials();
      if (oauthCreds) Object.assign(result, oauthCreds);
    } else {
      // auto: apiKey 优先，没有则 fallback 到 OAuth
      if (apiKey) {
        result.apiKey = apiKey;
      } else {
        const oauthCreds = readOAuthCredentials();
        if (oauthCreds) Object.assign(result, oauthCreds);
      }
    }

    // 环境变量兜底（容器化部署场景，settings.json 可能没有 apiKey）
    if (!result.apiKey && !result.authToken) {
      const envKey = process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY;
      if (envKey) {
        result.apiKey = envKey;
        // baseUrl 也从环境变量兜底（settings.json 没有 apiBaseUrl 时）
        if (!result.baseUrl && process.env.ANTHROPIC_BASE_URL) {
          result.baseUrl = process.env.ANTHROPIC_BASE_URL;
        }
      }
    }

    if (result.apiKey || result.authToken) return result;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 从 configManager 读取 OAuth 凭证
 * 对齐 webAuth.getOAuthCredentials 的逻辑
 */
function readOAuthCredentials(): { apiKey?: string; authToken?: string } | undefined {
  try {
    const config = configManager.getAll();
    const oauthAccount = (config as any).oauthAccount;
    if (!oauthAccount || !oauthAccount.accessToken) return undefined;

    const hasInferenceScope = oauthAccount.scopes?.includes('user:inference');
    if (hasInferenceScope) {
      return { authToken: oauthAccount.accessToken };
    }
    if (oauthAccount.oauthApiKey) {
      return { apiKey: oauthAccount.oauthApiKey };
    }
    // fallback
    return { authToken: oauthAccount.accessToken };
  } catch {
    return undefined;
  }
}
