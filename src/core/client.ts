/**
 * Claude API 客户端
 * 处理与 Anthropic API 的通信
 * 支持重试逻辑、token 计数、模型回退、Extended Thinking
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Message, ContentBlock, ToolDefinition, WebSearchTool20250305 } from '../types/index.js';
import type { ProxyConfig, ProxyAgentOptions, TimeoutConfig } from '../network/index.js';
import { createProxyAgent } from '../network/index.js';
import {
  modelConfig,
  modelFallback,
  modelStats,
  thinkingManager,
  type ThinkingConfig,
  type ThinkingResult,
} from '../models/index.js';
import { initAuth, getAuth, refreshTokenAsync } from '../auth/index.js';
import { v4 as uuidv4 } from 'uuid';
import { VERSION_BASE } from '../version.js';
import { randomBytes } from 'crypto';
import { getMaxOutputTokens } from './max-tokens.js';
import {
  isPenguinEnabled,
  shouldActivateFastMode,
  isInCooldown,
  triggerCooldown,
  isFastModeNotEnabledError,
  permanentlyDisableFastMode,
  handleOverageRejection,
  FAST_MODE_BETA,
  FAST_MODE_RESEARCH_PREVIEW,
} from '../fast-mode/index.js';

export interface ClientConfig {
  apiKey?: string;
  /** OAuth access token (用于 OAuth 登录) */
  authToken?: string;
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
  /** 代理配置 */
  proxy?: ProxyConfig;
  /** 代理 Agent 选项 */
  proxyOptions?: ProxyAgentOptions;
  /** 超时配置 */
  timeout?: number | TimeoutConfig;
  /** 是否启用调试日志 */
  debug?: boolean;
  /** 回退模型 */
  fallbackModel?: string;
  /** Extended Thinking 配置 */
  thinking?: ThinkingConfig;
  /** v2.1.31: Temperature 覆盖（0-1） */
  temperature?: number;
  /** v2.1.36: Fast mode 状态 */
  fastMode?: boolean;
  /** 请求来源标识，用于缓存破裂追踪（对齐官方 querySource，默认 "main"） */
  querySource?: string;
  /** 系统提示词身份前缀变体（Web Anthropic runtime 用） */
  identityVariant?: 'main' | 'sdk' | 'agent';
}

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onToolUse?: (id: string, name: string, input: unknown) => void;
  onToolResult?: (id: string, result: string) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  /** 缓存读取 tokens */
  cacheReadTokens?: number;
  /** 缓存创建 tokens */
  cacheCreationTokens?: number;
  /** 思考 tokens */
  thinkingTokens?: number;
  /** API 调用耗时 */
  apiDurationMs?: number;
}

// 模型价格 (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },  // Claude 4.6 (最新)
  'claude-opus-4-5-20251101': { input: 15, output: 75 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  'claude-haiku-3-5-20241022': { input: 0.8, output: 4 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
};

// 可重试的错误类型
const RETRYABLE_ERRORS = [
  'overloaded_error',
  'rate_limit_error',
  'api_error',
  'timeout',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'Connection error',
  'connection error',
  'network error',
  'fetch failed',
  'Request timed out',
  'timed out',
];

// ============================================================================
// 对标官方 CLI Ww6: 重试常量（与官方 V39/T39/N39 等一致）
// ============================================================================
const DEFAULT_MAX_RETRIES = 10;              // 官方 V39 = 10
const DEFAULT_RETRY_BASE_DELAY = 500;        // 官方 T39 = 500ms
const MAX_RETRY_DELAY = 32000;               // 官方 min(..., 32000)
const JITTER_FACTOR = 0.25;                  // 官方 random() * 0.25 * baseDelay
const OVERLOADED_FALLBACK_THRESHOLD = 3;     // 官方 N39 = 3, 连续 529 次数触发 fallback
const FAST_RETRY_AFTER_THRESHOLD = 20000;    // 官方 y39 = 20000ms, 429 retry-after < 此值直接等
const MIN_OUTPUT_TOKENS = 3000;              // 官方 wO8 = 3000, context overflow 时最小输出

/**
 * 对标官方 $p 函数: 计算带 jitter 的指数退避延迟
 */
function calculateRetryDelay(attempt: number, retryAfterHeader?: string | null): number {
  // 优先使用服务端 retry-after header
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  // 指数退避 + 25% jitter
  const baseDelay = Math.min(DEFAULT_RETRY_BASE_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
  const jitter = Math.random() * JITTER_FACTOR * baseDelay;
  return baseDelay + jitter;
}

/**
 * 对标官方 fE7 函数: 从 400 错误中解析 context overflow 信息
 * 错误格式: "input length and `max_tokens` exceed context limit: {input} + {maxTokens} > {contextLimit}"
 */
function parseContextOverflowError(error: any): { inputTokens: number; maxTokens: number; contextLimit: number } | null {
  if (error.status !== 400 || !error.message) return null;
  if (!error.message.includes('input length and `max_tokens` exceed context limit')) return null;
  const match = error.message.match(/input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/);
  if (!match || match.length !== 4) return null;
  const inputTokens = parseInt(match[1], 10);
  const maxTokens = parseInt(match[2], 10);
  const contextLimit = parseInt(match[3], 10);
  if (isNaN(inputTokens) || isNaN(maxTokens) || isNaN(contextLimit)) return null;
  return { inputTokens, maxTokens, contextLimit };
}

/**
 * 对标官方 GE7 函数: 检测 529 overloaded 错误
 */
function isOverloadedError(error: any): boolean {
  if (error.status === 529) return true;
  return error.message?.includes('"type":"overloaded_error"') ?? false;
}

/**
 * 获取 retry-after header（兼容不同的 header 格式）
 */
function getRetryAfterHeader(error: any): string | null {
  return error.headers?.get?.('retry-after') ?? error.headers?.['retry-after'] ?? null;
}

/**
 * 获取 overage rejection header（fast mode 降级检查）
 */
function getOverageDisabledReason(error: any): string | null {
  return error.headers?.get?.('anthropic-ratelimit-unified-overage-disabled-reason')
    ?? error.headers?.['anthropic-ratelimit-unified-overage-disabled-reason']
    ?? null;
}

/**
 * 检查 HTTP 状态码是否可重试（对标官方 k39）
 */
function isRetryableStatus(error: any): boolean {
  const status = error.status || error.statusCode;
  // 429 rate limit, 500+ server errors, overloaded
  if (status === 429 || status === 529) return true;
  if (status >= 500) return true;
  // 检查 x-should-retry header
  const shouldRetry = error.headers?.get?.('x-should-retry') ?? error.headers?.['x-should-retry'];
  if (shouldRetry === 'true') return true;
  if (shouldRetry === 'false') return false;
  // overloaded in message
  if (error.message?.includes('"type":"overloaded_error"')) return true;
  // context overflow 可重试（会自动调整 max_tokens）
  if (parseContextOverflowError(error)) return true;
  return false;
}

/** FallbackTriggeredError: 对标官方 Pw6 */
class FallbackTriggeredError extends Error {
  originalModel: string;
  fallbackModel: string;
  constructor(originalModel: string, fallbackModel: string) {
    super(`Model fallback triggered: ${originalModel} -> ${fallbackModel}`);
    this.name = 'FallbackTriggeredError';
    this.originalModel = originalModel;
    this.fallbackModel = fallbackModel;
  }
}

// Axon 的 beta 头 (v2.1.29 对齐官方)
// 重要发现：claude-code-20250219 beta 需要与特定的 system prompt 配合使用
// system prompt 的第一个 block 必须以下列字符串之一开头：
// - "You are Axon, an AI-powered coding assistant."
// - "You are a Claude agent, built on Anthropic's Claude Agent SDK."
const AXON_BETA = 'claude-code-20250219';           // tFA
const OAUTH_BETA = 'oauth-2025-04-20';                     // zE
const THINKING_BETA = 'interleaved-thinking-2025-05-14';   // eFA
const CONTEXT_1M_BETA = 'context-1m-2025-08-07';           // xZ1
const CONTEXT_MANAGEMENT_BETA = 'context-management-2025-06-27';  // md1
const STRUCTURED_OUTPUTS_BETA = 'structured-outputs-2025-12-15';  // ad
const WEB_SEARCH_BETA = 'web-search-2025-03-05';           // sV6
const TOOL_EXAMPLES_BETA = 'tool-examples-2025-10-29';     // Fd1
const ADVANCED_TOOL_USE_BETA = 'advanced-tool-use-2025-11-20';    // AgA
const TOOL_SEARCH_BETA = 'tool-search-tool-2025-10-19';    // qgA
const PROMPT_CACHING_SCOPE_BETA = 'prompt-caching-scope-2026-01-05';  // bZ1
const ADAPTIVE_THINKING_BETA = 'adaptive-thinking-2026-01-28';        // tl8

// v2.1.29: Bedrock 和 Vertex 不支持的 betas (对应官方 eV6 集合)
// 这些 betas 会导致网关用户出现 beta header 验证错误
const UNSUPPORTED_GATEWAY_BETAS = new Set([
  'interleaved-thinking-2025-05-14',
  'context-1m-2025-08-07',
  'tool-search-tool-2025-10-19',
  'tool-examples-2025-10-29',
]);

// v2.1.29: Provider 类型 (对应官方 F4 函数)
// 'firstParty' 是直接使用 Anthropic API，'anthropic' 作为默认值兼容旧代码
type ProviderType = 'firstParty' | 'anthropic' | 'bedrock' | 'vertex' | 'foundry';

/**
 * 获取当前 Provider 类型 (对应官方 F4 函数)
 * 从 settings.json 配置读取，不再依赖环境变量
 */
function getProviderType(): ProviderType {
  try {
    const { configManager } = require('../config/index.js');
    const config = configManager.getAll();
    if (config.apiProvider === 'bedrock' || config.useBedrock) return 'bedrock';
    if (config.apiProvider === 'vertex' || config.useVertex) return 'vertex';
  } catch {}
  if (process.env.AXON_USE_FOUNDRY === 'true' || process.env.AXON_USE_FOUNDRY === '1') {
    return 'foundry';
  }
  return 'firstParty';
}

/**
 * v2.1.31: 检查是否为第三方 provider（Bedrock、Vertex、Foundry）
 * 用于在模型选择器中隐藏 Anthropic API 定价信息
 */
export function isThirdPartyProvider(): boolean {
  const provider = getProviderType();
  return provider !== 'firstParty';
}

/**
 * 检查环境变量是否被设置为 true/1
 */
function isEnvEnabled(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/**
 * v2.1.29: 检查是否应该启用实验性 betas (对应官方 lr1 函数)
 *
 * 只有以下情况才启用实验性 betas：
 * 1. Provider 是 firstParty 或 foundry
 * 2. 且未设置 AXON_DISABLE_EXPERIMENTAL_BETAS=1
 *
 * 这是 v2.1.29 修复 beta header 验证错误的关键：
 * Bedrock 和 Vertex 网关用户不会获得实验性 betas
 */
function isExperimentalBetasEnabled(): boolean {
  const provider = getProviderType();
  if (provider !== 'firstParty' && provider !== 'foundry') {
    return false;
  }
  return !isEnvEnabled(process.env.AXON_DISABLE_EXPERIMENTAL_BETAS);
}

/**
 * v2.1.29: 检查模型是否支持 structured outputs (对应官方 zu6 函数)
 *
 * 只有 firstParty 或 foundry provider 且使用支持的模型才返回 true
 */
function supportsStructuredOutputs(model: string): boolean {
  const provider = getProviderType();
  if (provider !== 'firstParty' && provider !== 'foundry') {
    return false;
  }
  return model.includes('claude-sonnet-4-5') ||
         model.includes('claude-opus-4-1') ||
         model.includes('claude-opus-4-5') ||
         model.includes('claude-haiku-4-5');
}

/**
 * v2.1.41: 检查模型是否支持 interleaved thinking (对应官方 G15 函数)
 * 注意：haiku 不支持 interleaved thinking（官方 2.1.41 确认）
 */
function supportsInterleavedThinking(model: string): boolean {
  const providerType = getProviderType();
  if (providerType === 'foundry') return true;
  if (providerType === 'firstParty') return !model.includes('claude-3-');
  return model.includes('claude-opus-4') ||
         model.includes('claude-sonnet-4');
}

/**
 * v2.1.41: 检查模型是否支持 adaptive thinking (对应官方 h76 函数)
 * 仅 opus-4-6 支持，优先级高于 interleaved thinking
 */
function supportsAdaptiveThinking(model: string): boolean {
  return model.toLowerCase().includes('opus-4-6');
}

/**
 * v2.1.29: 检查模型是否支持 web search (对应官方 DOK 函数)
 */
function supportsWebSearch(model: string): boolean {
  return model.includes('claude-sonnet-4') ||
         model.includes('claude-opus-4') ||
         model.includes('claude-haiku-4');
}

// 官方 magic string，Anthropic subscription 服务器会校验此字段
// 必须与官方保持一致，不能使用品牌重命名后的字符串
const AXON_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const AXON_AGENT_SDK_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.";
const AXON_AGENT_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

function getIdentityText(identityVariant?: 'main' | 'sdk' | 'agent'): string | undefined {
  switch (identityVariant) {
    case 'sdk':
      return AXON_AGENT_SDK_IDENTITY;
    case 'agent':
      return AXON_AGENT_IDENTITY;
    case 'main':
      return AXON_IDENTITY;
    default:
      return undefined;
  }
}

/**
 * 检查 system prompt 是否包含有效的 Axon 身份标识
 */
function hasValidIdentity(systemPrompt?: string | Array<{type: string; text: string}>): boolean {
  if (!systemPrompt) return false;

  if (typeof systemPrompt === 'string') {
    return systemPrompt.startsWith(AXON_IDENTITY) ||
           systemPrompt.startsWith(AXON_AGENT_SDK_IDENTITY) ||
           systemPrompt.startsWith(AXON_AGENT_IDENTITY);
  }

  if (Array.isArray(systemPrompt) && systemPrompt.length > 0) {
    const firstBlock = systemPrompt[0];
    if (firstBlock?.type === 'text' && firstBlock?.text) {
      return firstBlock.text.startsWith(AXON_IDENTITY) ||
             firstBlock.text.startsWith(AXON_AGENT_SDK_IDENTITY) ||
             firstBlock.text.startsWith(AXON_AGENT_IDENTITY);
    }
  }

  return false;
}

/**
 * 格式化 system prompt 以启用 Prompt Caching
 *
 * v5.0: 所有模式都启用 cache_control，节省重复 System Prompt 的 token 消耗
 * - 对于 OAuth 模式：第一个 block 必须以 AXON_IDENTITY 开头
 * - 对于非 OAuth 模式：直接缓存整个 System Prompt
 */
/**
 * PromptBlock 类型（与 prompt/types.ts 对齐，避免循环依赖）
 */
interface PromptBlock {
  text: string;
  cacheScope: 'global' | 'org' | null;
}

/**
 * 对齐官方 HJq 函数：检查是否应为当前模型启用 prompt caching
 *
 * 官方支持 DISABLE_PROMPT_CACHING 系列 env var，按型号粒度控制：
 * - DISABLE_PROMPT_CACHING          - 禁用所有型号
 * - DISABLE_PROMPT_CACHING_HAIKU    - 仅禁用 Haiku
 * - DISABLE_PROMPT_CACHING_SONNET   - 仅禁用 Sonnet
 * - DISABLE_PROMPT_CACHING_OPUS     - 仅禁用 Opus
 */
export function isPromptCachingEnabled(model: string): boolean {
  if (process.env.DISABLE_PROMPT_CACHING) return false;
  if (process.env.DISABLE_PROMPT_CACHING_HAIKU && model.includes('haiku')) return false;
  if (process.env.DISABLE_PROMPT_CACHING_SONNET && model.includes('sonnet')) return false;
  if (process.env.DISABLE_PROMPT_CACHING_OPUS && model.includes('opus')) return false;
  return true;
}

/**
 * 构建 cache_control 对象（对齐官方 Pc1 函数）
 *
 * 官方逻辑：
 * - type: "ephemeral" — 始终设置
 * - ttl: "1h" — 官方需额外满足 OAuth+未超额+allowlist（我们无法检查，故不加）
 * - scope: "global" — 仅当 cacheScope === "global" 时设置，扩大缓存范围到同组织级别
 */
export function buildCacheControl(cacheScope: 'global' | 'org'): Record<string, unknown> {
  return {
    type: 'ephemeral' as const,
    ...(cacheScope === 'global' ? { scope: 'global' } : {}),
  };
}

/**
 * v6.1: 对齐官方 h2z + wI8 函数
 *
 * @param skipGlobalCacheForSystemPrompt - 对齐官方 P 变量：
 *   - "none": 正常缓存（static blocks 用 "global" scope）
 *   - "system_prompt": 有 MCP/ToolSearch 时，所有 blocks 退回 "org" scope，
 *     避免 MCP 工具变化频繁导致全局缓存失效
 */
export function formatSystemPrompt(
  systemPrompt: string | undefined,
  isOAuth: boolean,
  promptBlocks?: PromptBlock[],
  enableCaching?: boolean,
  skipGlobalCacheForSystemPrompt: 'none' | 'system_prompt' = 'none',
  identityVariant?: 'main' | 'sdk' | 'agent',
): Array<{type: 'text'; text: string; cache_control?: Record<string, unknown>}> | string | undefined {
  const preferredIdentity = getIdentityText(identityVariant) || (isOAuth ? AXON_IDENTITY : undefined);

  // 没有 system prompt 时
  if (!systemPrompt) {
    if (preferredIdentity) {
      return [
        { type: 'text', text: preferredIdentity, ...(enableCaching !== false ? { cache_control: { type: 'ephemeral' } } : {}) }
      ];
    }
    return undefined;
  }

  /**
   * 对齐官方 wI8：根据 skipGlobalCacheForSystemPrompt 决定 blocks 的 cacheScope
   * - skipGlobalCacheForSystemPrompt="system_prompt": 所有非 identity blocks → "org"（降级，不用 global）
   * - skipGlobalCacheForSystemPrompt="none": 保留原始 cacheScope（global/org/null）
   */
  const resolveScope = (originalScope: 'global' | 'org' | null): 'global' | 'org' | null => {
    if (originalScope === null) return null;
    if (skipGlobalCacheForSystemPrompt === 'system_prompt') return 'org';
    return originalScope;
  };

  // v6.0: 使用 PromptBlock 分块缓存（对齐官方 CG1 分割逻辑）
  if (promptBlocks && promptBlocks.length > 0) {
    const apiBlocks: Array<{type: 'text'; text: string; cache_control?: Record<string, unknown>}> = [];

    // 对齐官方 wI8 函数中 skipGlobalCacheForSystemPrompt 路径：
    // 当 skipGlobalCacheForSystemPrompt="system_prompt" 时，identity 用 null, 其他用 "org"
    // 当 skipGlobalCacheForSystemPrompt="none" 时，identity 用 null, static 用 "global", dynamic 用 null
    if (isOAuth && promptBlocks.length > 0) {
      const firstBlock = promptBlocks[0];
      let identityToExtract: string | null = null;
      if (firstBlock.text.startsWith(AXON_IDENTITY)) {
        identityToExtract = AXON_IDENTITY;
      } else if (firstBlock.text.startsWith(AXON_AGENT_SDK_IDENTITY)) {
        identityToExtract = AXON_AGENT_SDK_IDENTITY;
      } else if (firstBlock.text.startsWith(AXON_AGENT_IDENTITY)) {
        identityToExtract = AXON_AGENT_IDENTITY;
      }

      if (identityToExtract) {
        // 官方 wI8: identity block → cacheScope: null（不缓存）
        apiBlocks.push({ type: 'text', text: identityToExtract });

        // 剩余文本继承 resolveScope 后的 cacheScope
        const remainingText = firstBlock.text.slice(identityToExtract.length).trimStart();
        if (remainingText) {
          const scope = resolveScope(firstBlock.cacheScope);
          apiBlocks.push({
            type: 'text',
            text: remainingText,
            ...(enableCaching !== false && scope !== null ? { cache_control: buildCacheControl(scope) } : {}),
          });
        }

        for (let i = 1; i < promptBlocks.length; i++) {
          const block = promptBlocks[i];
          if (!block.text) continue;
          const scope = resolveScope(block.cacheScope);
          apiBlocks.push({
            type: 'text',
            text: block.text,
            ...(enableCaching !== false && scope !== null ? { cache_control: buildCacheControl(scope) } : {}),
          });
        }
        return apiBlocks.length > 0 ? apiBlocks : undefined;
      }
    }

    if (preferredIdentity) {
      apiBlocks.push({ type: 'text', text: preferredIdentity });
    }

    for (const block of promptBlocks) {
      if (!block.text) continue;
      const scope = resolveScope(block.cacheScope);
      apiBlocks.push({
        type: 'text',
        text: block.text,
        ...(enableCaching !== false && scope !== null ? { cache_control: buildCacheControl(scope) } : {}),
      });
    }
    return apiBlocks.length > 0 ? apiBlocks : undefined;
  }

  // 兼容旧路径：单字符串模式
  if (!isOAuth && !preferredIdentity) {
    return [
      { type: 'text', text: systemPrompt, ...(enableCaching !== false ? { cache_control: { type: 'ephemeral' } } : {}) }
    ];
  }

  // OAuth 或显式 identityVariant 模式需要身份标识作为第一个 block
  let identityToUse = preferredIdentity || AXON_IDENTITY;
  let remainingText = '';

  if (systemPrompt.startsWith(AXON_IDENTITY)) {
    identityToUse = AXON_IDENTITY;
    remainingText = systemPrompt.slice(AXON_IDENTITY.length).trim();
  } else if (systemPrompt.startsWith(AXON_AGENT_SDK_IDENTITY)) {
    identityToUse = AXON_AGENT_SDK_IDENTITY;
    remainingText = systemPrompt.slice(AXON_AGENT_SDK_IDENTITY.length).trim();
  } else if (systemPrompt.startsWith(AXON_AGENT_IDENTITY)) {
    identityToUse = AXON_AGENT_IDENTITY;
    remainingText = systemPrompt.slice(AXON_AGENT_IDENTITY.length).trim();
  } else {
    const cc = enableCaching !== false ? { cache_control: { type: 'ephemeral' as const } } : {};
    return [
      { type: 'text', text: identityToUse },
      { type: 'text', text: systemPrompt, ...cc }
    ];
  }

  const cc = enableCaching !== false ? { cache_control: { type: 'ephemeral' as const } } : {};
  const blocks: Array<{type: 'text'; text: string; cache_control?: Record<string, unknown>}> = [
    { type: 'text' as const, text: identityToUse }
  ];
  if (remainingText.length > 0) {
    blocks.push({ type: 'text' as const, text: remainingText, ...cc });
  }
  return blocks;
}

/**
 * v5.0: 格式化消息以启用 Prompt Caching
 *
 * 官方实现：为每条消息的最后一个 content block 添加 cache_control
 * 这样历史消息可以被缓存，在多轮对话中节省 token
 *
 * 注意：thinking 和 redacted_thinking 类型的 block 不添加缓存控制
 */

/**
 * 清理字符串中的孤立 UTF-16 代理字符（lone surrogates）
 *
 * JSON 规范要求 surrogate pairs 必须成对出现（高代理 \uD800-\uDBFF 后跟低代理 \uDC00-\uDFFF）。
 * 如果字符串中包含孤立的代理字符，JSON.stringify 会保留它们，但 API 端解析时会报错：
 * "not valid JSON: no low surrogate in string"
 *
 * 常见来源：Bash 输出包含二进制数据、损坏的文件内容、截断的 UTF-16 字符串。
 */
function sanitizeSurrogates(str: string): string {
  // 匹配孤立的高代理（后面没有低代理）或孤立的低代理（前面没有高代理）
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/**
 * 递归清理消息内容中的孤立代理字符
 */
function sanitizeContent(content: any): any {
  if (typeof content === 'string') {
    return sanitizeSurrogates(content);
  }
  if (Array.isArray(content)) {
    return content.map(sanitizeContent);
  }
  if (content && typeof content === 'object') {
    const result: any = {};
    for (const key of Object.keys(content)) {
      result[key] = sanitizeContent(content[key]);
    }
    return result;
  }
  return content;
}

/**
 * 对齐官方 S2z / R2z / y2z 函数：
 * - 官方 z > A.length-3 → 最后 2 条消息的最后一个 block 添加 cache_control
 * - enableCaching=false 时完全跳过（对齐 HJq 的 enablePromptCaching 控制）
 * - querySource 传递给 Pc1 用于 ttl 判断（我们简化为不加 ttl，但保持接口对齐）
 */
export function formatMessages(
  messages: Array<{ role: string; content: any }>,
  enableThinking?: boolean,
  enableCaching?: boolean,
  querySource?: string
): Array<{ role: string; content: any }> {
  // 构建 cache_control 对象（对齐官方 Pc1）
  const cacheControl: Record<string, unknown> = {
    type: 'ephemeral',
  };

  const formatted = messages.map((m, msgIndex) => {
    // 官方 z > A.length-3 → 最后 2 条消息（索引 >= length-2）
    const isRecentMessage = msgIndex >= messages.length - 2;

    // 如果 content 是字符串，转换为数组格式并添加缓存控制
    if (typeof m.content === 'string') {
      return {
        role: m.role,
        content: [{
          type: 'text',
          text: m.content,
          ...(isRecentMessage && enableCaching !== false ? { cache_control: cacheControl } : {}),
        }],
      };
    }

    // 如果 content 是数组，为最后一个非 thinking block 添加缓存控制
    if (Array.isArray(m.content) && m.content.length > 0) {
      // v2.1.30: 当 thinking 未启用时，从历史消息中移除 thinking blocks
      // 防止 /login 切换 API key 后发送 thinking blocks 导致 400 错误
      let filteredContent = m.content;
      if (!enableThinking) {
        filteredContent = m.content.filter((block: any) =>
          block.type !== 'thinking' && block.type !== 'redacted_thinking'
        );
        // 如果过滤后为空，添加占位文本
        if (filteredContent.length === 0) {
          filteredContent = [{ type: 'text', text: '(no content)' }];
        }
      }

      const content = filteredContent.map((block: any, blockIndex: number) => {
        const isLastBlock = blockIndex === filteredContent.length - 1;
        // 跳过 thinking 类型的 block（官方 y2z 逻辑）
        const isThinkingBlock = block.type === 'thinking' || block.type === 'redacted_thinking';

        if (isRecentMessage && isLastBlock && !isThinkingBlock && enableCaching !== false) {
          return { ...block, cache_control: cacheControl };
        }
        return block;
      });

      return { role: m.role, content };
    }

    return { role: m.role, content: m.content };
  });
  return sanitizeContent(formatted);
}

// ─── 缓存破裂追踪系统（对齐官方 xR7/bR7/kB）───────────────────────────────
// 官方常量：最多追踪10个 source、最小 token 差阈值 2000、5分钟/1小时时间窗口
const CACHE_BREAK_MAX_SOURCES = 10;
const CACHE_BREAK_MIN_TOKEN_DROP = 2000;

interface CacheBreakState {
  systemHash: number;
  toolsHash: number;
  toolNames: string[];
  systemCharCount: number;
  model: string;
  fastMode: boolean;
  callCount: number;
  pendingChanges: null | {
    systemPromptChanged: boolean;
    toolSchemasChanged: boolean;
    modelChanged: boolean;
    fastModeChanged: boolean;
    addedToolCount: number;
    removedToolCount: number;
    systemCharDelta: number;
    previousModel: string;
    newModel: string;
  };
  prevCacheReadTokens: number | null;
  microcompacted: boolean;
}

export const cacheBreakMap = new Map<string, CacheBreakState>();

/** 对齐官方 IR7：简单 djb2-like 整数哈希 */
export function hashContent(content: any): number {
  const str = JSON.stringify(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
  }
  return hash;
}

/** 对齐官方 hR7：计算哈希前剥离 cache_control 字段，避免其变化误判内容变化 */
export function stripCacheControlFields(items: any[]): any[] {
  return items.map((item: any) => {
    if (!('cache_control' in item)) return item;
    const { cache_control: _, ...rest } = item;
    return rest;
  });
}

/** 计算 system blocks 的总字符数（对齐官方 cY9） */
export function getSystemCharCount(systemBlocks: any[]): number {
  let count = 0;
  for (const block of systemBlocks) count += (block.text || '').length;
  return count;
}

/**
 * 追踪每次 API 调用前的状态（对齐官方 xR7）
 * 比较 system/tools 哈希，记录变化原因，为后续 cache break 报告提供上下文
 */
export function trackCacheState(
  systemBlocks: any[],
  tools: any[],
  model: string,
  querySource: string,
  fastMode: boolean
): void {
  try {
    const strippedSystem = stripCacheControlFields(systemBlocks);
    const strippedTools = stripCacheControlFields(tools);
    const systemHash = hashContent(strippedSystem);
    const toolsHash = hashContent(strippedTools);
    const toolNames = tools.map((t: any) => ('name' in t ? t.name : 'unknown'));
    const systemCharCount = getSystemCharCount(systemBlocks);

    const existing = cacheBreakMap.get(querySource);
    if (!existing) {
      // 容量满时驱逐最旧的 source
      while (cacheBreakMap.size >= CACHE_BREAK_MAX_SOURCES) {
        const firstKey = cacheBreakMap.keys().next().value;
        if (firstKey !== undefined) cacheBreakMap.delete(firstKey);
      }
      cacheBreakMap.set(querySource, {
        systemHash, toolsHash, toolNames, systemCharCount,
        model, fastMode, callCount: 1,
        pendingChanges: null, prevCacheReadTokens: null, microcompacted: false,
      });
      return;
    }

    existing.callCount++;
    const systemChanged = systemHash !== existing.systemHash;
    const toolsChanged = toolsHash !== existing.toolsHash;
    const modelChanged = model !== existing.model;
    const fastModeChanged = fastMode !== existing.fastMode;

    if (systemChanged || toolsChanged || modelChanged || fastModeChanged) {
      const prevToolSet = new Set(existing.toolNames);
      const newToolSet = new Set(toolNames);
      existing.pendingChanges = {
        systemPromptChanged: systemChanged,
        toolSchemasChanged: toolsChanged,
        modelChanged,
        fastModeChanged,
        addedToolCount: toolNames.filter((n: string) => !prevToolSet.has(n)).length,
        removedToolCount: existing.toolNames.filter((n: string) => !newToolSet.has(n)).length,
        systemCharDelta: systemCharCount - existing.systemCharCount,
        previousModel: existing.model,
        newModel: model,
      };
    } else {
      existing.pendingChanges = null;
    }

    existing.systemHash = systemHash;
    existing.toolsHash = toolsHash;
    existing.toolNames = toolNames;
    existing.systemCharCount = systemCharCount;
    existing.model = model;
    existing.fastMode = fastMode;
  } catch {
    // 追踪失败不影响主流程
  }
}

/**
 * 报告缓存命中率下降（对齐官方 bR7）
 * 当 cacheReadTokens < prevCacheReadTokens * 0.95 且差值 > 2000 时输出警告
 */
export function reportCacheBreak(
  querySource: string,
  cacheReadTokens: number,
  cacheCreationTokens: number,
  debug: boolean
): void {
  const state = cacheBreakMap.get(querySource);
  if (!state) return;

  // haiku 缓存行为特殊，官方跳过 haiku 的 cache break 报告
  if (state.model.includes('haiku')) return;

  const prevCacheRead = state.prevCacheReadTokens;
  state.prevCacheReadTokens = cacheReadTokens;

  if (prevCacheRead === null) return;

  const drop = prevCacheRead - cacheReadTokens;
  // 命中率未显著下降 → 清空 pendingChanges，正常缓存
  if (cacheReadTokens >= prevCacheRead * 0.95 || drop < CACHE_BREAK_MIN_TOKEN_DROP) {
    state.pendingChanges = null;
    state.microcompacted = false;
    return;
  }

  // 收集 cache break 原因
  const reasons: string[] = [];
  if (state.microcompacted) {
    reasons.push('microcompact');
    state.microcompacted = false;
  }
  const changes = state.pendingChanges;
  if (changes) {
    if (changes.modelChanged) {
      reasons.push(`model changed (${changes.previousModel} → ${changes.newModel})`);
    }
    if (changes.systemPromptChanged) {
      const delta = changes.systemCharDelta;
      const suffix = delta === 0 ? '' : delta > 0 ? ` (+${delta} chars)` : ` (${delta} chars)`;
      reasons.push(`system prompt changed${suffix}`);
    }
    if (changes.toolSchemasChanged) {
      const hasCounts = changes.addedToolCount > 0 || changes.removedToolCount > 0;
      const suffix = hasCounts
        ? ` (+${changes.addedToolCount}/-${changes.removedToolCount} tools)`
        : ' (tool prompt/schema changed, same tool set)';
      reasons.push(`tools changed${suffix}`);
    }
    if (changes.fastModeChanged) reasons.push('fast mode toggled');
  }

  const cause = reasons.length > 0 ? reasons.join(', ') : 'unknown cause';
  const msg = `[PROMPT CACHE BREAK] ${cause} [source=${querySource}, call #${state.callCount}, cache read: ${prevCacheRead} → ${cacheReadTokens}, creation: ${cacheCreationTokens}]`;

  if (debug) {
    console.warn(msg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// 会话相关的全局状态
let _sessionId: string | null = null;
let _userId: string | null = null;

/**
 * 获取会话 ID (模拟官方 h0 函数)
 */
function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = uuidv4();
  }
  return _sessionId;
}

/**
 * 获取用户 ID (模拟官方 Ug 函数)
 */
function getUserId(): string {
  if (!_userId) {
    _userId = randomBytes(32).toString('hex');
  }
  return _userId;
}

/**
 * 构建 metadata (模拟官方 Ja 函数)
 */
function buildMetadata(accountUuid?: string): { user_id: string } {
  return {
    user_id: `user_${getUserId()}_account_${accountUuid || ''}_session_${getSessionId()}`
  };
}

/**
 * v2.1.29: 构建 betas 数组 (对应官方 wu6 函数)
 *
 * 重要发现：
 * - claude-code-20250219 beta 需要与特定的 system prompt 配合使用
 * - system prompt 必须以 AXON_IDENTITY 或 AXON_AGENT_IDENTITY 开头
 * - 只有满足这个条件，OAuth token 才能使用 sonnet/opus 模型
 *
 * v2.1.29 修复：
 * - 完全重写以对齐官方实现
 * - 对于 Bedrock/Vertex 网关用户，不添加实验性 betas
 * - 支持 AXON_DISABLE_EXPERIMENTAL_BETAS=1 完全禁用实验性 betas
 * - 添加 structured-outputs beta 支持
 */
function buildBetas(model: string, isOAuth: boolean, fastMode?: boolean): string[] {
  const betas: string[] = [];
  const providerType = getProviderType();
  const experimentalEnabled = isExperimentalBetasEnabled();
  const isHaiku = model.toLowerCase().includes('haiku');

  // 1. 非 haiku 模型添加 claude-code beta（官方: if(!K)q.push(tFA)）
  if (!isHaiku) {
    betas.push(AXON_BETA);
  }

  // 2. OAuth 订阅用户添加 oauth beta（官方: if(O7())q.push(zE)）
  if (isOAuth) {
    betas.push(OAUTH_BETA);
  }

  // 3. 带 "[1m]" 标记的模型添加 context-1m beta（官方: if(A.includes("[1m]"))q.push(xZ1)）
  if (model.includes('[1m]')) {
    betas.push(CONTEXT_1M_BETA);
  }

  // 4. Thinking beta（官方只使用 interleaved-thinking）
  if (!isEnvEnabled(process.env.DISABLE_INTERLEAVED_THINKING) && supportsInterleavedThinking(model)) {
    betas.push(THINKING_BETA);
  }

  // 5. structured outputs beta（官方需要 feature flag tengu_tool_pear）
  // 由于我们没有 Anthropic 的 feature flag 系统，默认不启用
  // 通过环境变量 AXON_ENABLE_STRUCTURED_OUTPUTS=1 手动启用
  if (supportsStructuredOutputs(model) && isEnvEnabled(process.env.AXON_ENABLE_STRUCTURED_OUTPUTS)) {
    betas.push(STRUCTURED_OUTPUTS_BETA);
  }

  // 6. Vertex 模型支持 web search 时添加 web-search beta
  // （官方: if(Y==="vertex"&&DOK(A))q.push(sV6)）
  if (providerType === 'vertex' && supportsWebSearch(model)) {
    betas.push(WEB_SEARCH_BETA);
  }

  // 7. Foundry 总是添加 web-search beta
  // （官方: if(Y==="foundry")q.push(sV6)）
  if (providerType === 'foundry') {
    betas.push(WEB_SEARCH_BETA);
  }

  // 8. 实验性 betas 启用时添加 prompt-caching-scope beta
  // （官方: if(z)q.push(bZ1)）
  if (experimentalEnabled) {
    betas.push(PROMPT_CACHING_SCOPE_BETA);
  }

  // 9. 支持环境变量 ANTHROPIC_BETAS 添加自定义 betas
  // （官方: if(process.env.ANTHROPIC_BETAS&&!K)q.push(...)）
  if (process.env.ANTHROPIC_BETAS && !isHaiku) {
    const customBetas = process.env.ANTHROPIC_BETAS.split(',').map(b => b.trim()).filter(Boolean);
    betas.push(...customBetas);
  }

  // 10. v2.1.36: Fast mode beta（对齐官方: if(isFastMode) betas.push(opA)）
  if (fastMode && isPenguinEnabled() && shouldActivateFastMode(model, true)) {
    betas.push(FAST_MODE_BETA);
  }

  // v2.1.29: 对于 Bedrock/Vertex 网关用户，过滤掉不支持的 betas
  // 这是修复 beta header 验证错误的关键
  if (providerType === 'bedrock' || providerType === 'vertex') {
    return betas.filter(beta => !UNSUPPORTED_GATEWAY_BETAS.has(beta));
  }

  return betas;
}

/**
 * 构建 API 工具列表
 * 将客户端工具定义转换为 API 格式，并始终添加 WebSearch Server Tool
 *
 * v5.0: 为最后一个工具添加 cache_control，启用工具列表缓存
 * 官方实现：最后一个工具添加 { type: "ephemeral" } 来缓存整个工具列表
 *
 * 官方 Anthropic API 的 Server Tool 进行网络搜索：
 * - type: 'web_search_20250305'
 * - name: 'web_search'
 *
 * Server Tool 由 Anthropic 服务器执行，比客户端实现更可靠
 */
/**
 * 将 MCP 服务器返回的 inputSchema 规范化为 JSON Schema draft 2020-12 兼容格式
 * 常见问题：
 *  - `definitions` 关键字（draft-04/07）→ 需改为 `$defs`（draft-2020-12）
 *  - `$schema` 指向旧版本 → 移除
 *  - `$ref` 指向 `#/definitions/...` → 改为 `#/$defs/...`
 */
function sanitizeInputSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  const result = { ...schema };

  // 移除 $schema 字段（避免旧版本声明触发校验失败）
  delete result.$schema;

  // definitions → $defs
  if (result.definitions && !result.$defs) {
    result.$defs = result.definitions;
    delete result.definitions;
  }

  // 递归处理所有嵌套 schema 对象
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = sanitizeInputSchema(val);
    } else if (Array.isArray(val)) {
      result[key] = val.map((item: any) =>
        item && typeof item === 'object' ? sanitizeInputSchema(item) : item
      );
    }
  }

  // 修复 $ref 中指向 definitions 的路径
  if (typeof result.$ref === 'string' && result.$ref.startsWith('#/definitions/')) {
    result.$ref = result.$ref.replace('#/definitions/', '#/$defs/');
  }

  // 修复 DingTalk MCP 将 required 放入 properties 内部的问题
  // 错误结构：properties: { field: {...}, required: ["field","operator"] }
  // 正确结构：properties: { field: {...} }, required: ["field","operator"]
  if (result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
    const reqInProps = (result.properties as any).required;
    if (Array.isArray(reqInProps) && reqInProps.every((v: any) => typeof v === 'string')) {
      if (!result.required) {
        result.required = reqInProps;
      }
      const fixedProps = { ...(result.properties as any) };
      delete fixedProps.required;
      result.properties = fixedProps;
    }
  }

  // 修复非法的 type 值（如 Java 泛型类型 "Map<String, Any>"、"List<String>" 等）
  // JSON Schema 合法 type 值：string/number/integer/boolean/array/object/null
  const VALID_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
  if (typeof result.type === 'string' && !VALID_TYPES.has(result.type)) {
    const raw = result.type as string;
    if (raw.startsWith('Map') || raw.startsWith('map') || raw.toLowerCase().includes('object')) {
      result.type = 'object';
    } else if (raw.startsWith('List') || raw.startsWith('list') || raw.startsWith('Array') || raw.includes('[]')) {
      result.type = 'array';
    } else {
      // 兜底：未知类型替换为 object
      result.type = 'object';
    }
  }

  return result;
}

export function buildApiTools(
  tools?: ToolDefinition[],
  toolSearchEnabled?: boolean,
  enableCaching?: boolean,
  isOAuth?: boolean,
  isThirdParty?: boolean
): any[] | undefined {
  const apiTools: any[] = [];

  // 添加客户端工具
  if (tools && tools.length > 0) {
    for (const tool of tools) {
      const apiTool: any = {
        name: tool.name,
        description: tool.description,
        input_schema: sanitizeInputSchema(tool.inputSchema),
      };

      // v2.1.34: deferred tool 标记 defer_loading
      // 对齐官方 PP6 函数：if(q.deferLoading) z.defer_loading = true
      // 当 toolSearchEnabled 时，isMcp 的工具（已被发现并传给 API 的）标记为 defer_loading
      // v2.1.70: 第三方网关不支持 defer_loading / tool_reference blocks
      if (toolSearchEnabled && tool.isMcp && !isThirdParty) {
        apiTool.defer_loading = true;
      }

      apiTools.push(apiTool);
    }
  }

  // DEBUG: 扫描所有工具 schema 的已知非法模式（定位 DingTalk schema 问题）
  {
    const VALID = new Set(['string','number','integer','boolean','array','object','null']);
    function findSchemaIssues(obj: any, path: string): string[] {
      if (!obj || typeof obj !== 'object') return [];
      const issues: string[] = [];
      // 检查非法 type
      if (typeof obj.type === 'string' && !VALID.has(obj.type)) {
        issues.push(`${path}.type="${obj.type}"`);
      }
      // 检查 required 被放进了 properties 内部
      if (obj.properties && typeof obj.properties === 'object') {
        const req = (obj.properties as any).required;
        if (Array.isArray(req) && req.every((v: any) => typeof v === 'string')) {
          issues.push(`${path}.properties.required=[${req.join(',')}] (misplaced)`);
        }
        // 检查 properties 中的 value 不是合法 schema（既不是 object 也不是 boolean）
        for (const k of Object.keys(obj.properties as any)) {
          const v = (obj.properties as any)[k];
          if (v !== null && typeof v !== 'object' && typeof v !== 'boolean') {
            issues.push(`${path}.properties.${k} is ${typeof v} (not a schema)`);
          }
        }
      }
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) issues.push(...findSchemaIssues(v, `${path}.${k}`));
        else if (Array.isArray(v)) v.forEach((item: any, i: number) => {
          if (item && typeof item === 'object') issues.push(...findSchemaIssues(item, `${path}.${k}[${i}]`));
        });
      }
      return issues;
    }
    apiTools.forEach((t, i) => {
      const issues = findSchemaIssues(t.input_schema, 'schema');
      if (issues.length > 0) {
        console.log(`[schemaDebug] tools[${i}] ${t.name}:`);
        issues.forEach(iss => console.log(`  - ${iss}`));
      }
    });
  }

  // 仅在官方 Anthropic API 下添加 WebSearch Server Tool
  // 第三方兼容 API（如 MiniMax）不支持 web_search_20250305 类型
  if (!isThirdParty) {
    const webSearchServerTool: WebSearchTool20250305 = {
      name: 'web_search',
      type: 'web_search_20250305',
    };
    apiTools.push(webSearchServerTool);
  }

  // v6.1: 对齐官方 —— 不给 tools 加 cache_control
  // 官方依赖 prompt-caching-scope beta header 让 API 自动处理前缀缓存
  // 手动标记 tools 会浪费 cache_control 断点配额并产生不必要的 cache creation 写入费用

  return apiTools.length > 0 ? apiTools : undefined;
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private maxRetries: number;
  private retryDelay: number;
  private fallbackModel?: string;
  private debug: boolean;
  /** v2.1.31: temperature 覆盖值 */
  private temperature?: number;
  /** v2.1.36: fast mode 状态 */
  private fastMode: boolean = false;
  private isOAuth: boolean = false;  // 是否使用 OAuth 模式
  private isThirdParty: boolean = false;  // 是否使用第三方兼容 API（非 Anthropic 官方）
  private identityVariant?: 'main' | 'sdk' | 'agent';
  /** 请求来源标识，用于缓存破裂追踪（对齐官方 querySource） */
  private querySource: string = 'main';
  private totalUsage: UsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    thinkingTokens: 0,
    apiDurationMs: 0,
  };

  constructor(config: ClientConfig = {}) {
    // 准备 Anthropic 客户端配置
    // 关键：对于 OAuth 模式，只使用 authToken，不使用 apiKey
    // OAuth 模式下不需要 API Key
    const authToken = config.authToken || process.env.ANTHROPIC_AUTH_TOKEN;
    // 如果有 authToken，则不使用 apiKey（官方逻辑）
    const apiKey = authToken ? null : (config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY);

    if (!apiKey && !authToken) {
      console.warn('[ClaudeClient] No API key or auth token configured. API calls will fail until authentication is set up.');
    }

    // 构建默认 headers（与官方 Anthropic API 完全一致）
    // 官方 User-Agent 格式: claude-cli/${VERSION} (external, ${ENTRYPOINT}${agent-sdk})
    const entrypoint = process.env.AXON_ENTRYPOINT || 'claude-vscode';
    const agentSdkVersion = process.env.AXON_AGENT_SDK_VERSION;
    const agentSdkSuffix = agentSdkVersion ? `, agent-sdk/${agentSdkVersion}` : '';

    const defaultHeaders: Record<string, string> = {
      'x-app': 'cli',
      'User-Agent': `claude-cli/${VERSION_BASE} (external, ${entrypoint}${agentSdkSuffix})`,
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    // 第三方兼容 API（如 MiniMax）要求 Authorization: Bearer 格式，而非 x-api-key
    const isThirdPartyUrl = !!(config.baseUrl &&
      !config.baseUrl.includes('api.anthropic.com') &&
      !config.baseUrl.includes('anthropic.com'));
    if (isThirdPartyUrl && apiKey) {
      defaultHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    // 如果使用 OAuth，标记模式
    if (authToken) {
      this.isOAuth = true;
      // 调试日志已移除，避免污染 UI 输出
    }
    // API key 模式无需日志

    // Anthropic SDK 自动拼 /v1/messages，baseURL 不能带 /v1 后缀，否则会变成 /v1/v1/messages
    let effectiveBase = config.baseUrl;
    if (effectiveBase) {
      effectiveBase = effectiveBase.replace(/\/v1\/?$/, '');
    }

    const anthropicConfig: any = {
      apiKey: apiKey,  // OAuth 模式下为 null
      authToken: authToken || null,  // OAuth token
      baseURL: effectiveBase,
      maxRetries: 0, // 我们自己处理重试
      defaultHeaders,
      dangerouslyAllowBrowser: true,
    };

    // 配置代理（如果需要）
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';
    const proxyAgent = createProxyAgent(
      baseUrl,
      config.proxy,
      {
        ...config.proxyOptions,
        timeout: typeof config.timeout === 'number' ? config.timeout : config.timeout?.connect,
      }
    );

    if (proxyAgent) {
      anthropicConfig.httpAgent = proxyAgent;
      if (config.debug) {
        console.log('[ClaudeClient] Using proxy agent for:', baseUrl);
      }
    }

    // 配置超时
    if (config.timeout) {
      const timeoutMs = typeof config.timeout === 'number'
        ? config.timeout
        : config.timeout.request || 120000;
      anthropicConfig.timeout = timeoutMs;
    }

    this.client = new Anthropic(anthropicConfig);
    this.debug = config.debug ?? false;
    this.identityVariant = config.identityVariant;

    // 检测是否使用第三方兼容 API（非 Anthropic 官方）
    const effectiveBaseUrl = config.baseUrl || 'https://api.anthropic.com';
    this.isThirdParty = !effectiveBaseUrl.includes('api.anthropic.com') && !effectiveBaseUrl.includes('anthropic.com');

    // 解析模型别名
    const resolvedModel = modelConfig.resolveAlias(config.model || 'sonnet');
    this.model = resolvedModel;

    // 对齐官方：max_tokens 由 getMaxOutputTokens() 统一计算
    // 支持 CLAUDE_CODE_MAX_OUTPUT_TOKENS 环境变量 > settings.json maxTokens > 模型默认值
    // 注意：我们始终使用 streaming 模式，不受非 streaming 的 21333 限制
    this.maxTokens = config.maxTokens || getMaxOutputTokens(this.model);

    // 对标官方 V39: 默认 10 次重试，通过 settings.json maxRetries 配置
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelay = config.retryDelay ?? DEFAULT_RETRY_BASE_DELAY;

    // 配置回退模型
    if (config.fallbackModel) {
      const resolvedFallback = modelConfig.resolveAlias(config.fallbackModel);
      if (resolvedFallback === this.model) {
        console.warn('Fallback model cannot be the same as primary model, ignoring');
      } else {
        this.fallbackModel = resolvedFallback;
        modelFallback.setPrimaryModel(this.model);
        modelFallback.setFallbackModel(this.fallbackModel);
      }
    }

    // 配置 Extended Thinking
    if (config.thinking) {
      thinkingManager.configure(config.thinking);
    }

    // v2.1.31: 存储 temperature 覆盖值
    if (config.temperature !== undefined) {
      this.temperature = config.temperature;
    }

    // v2.1.36: 存储 fast mode 状态
    if (config.fastMode !== undefined) {
      this.fastMode = config.fastMode;
    }

    // 存储 querySource（用于缓存破裂追踪）
    if (config.querySource) {
      this.querySource = config.querySource;
    }

    if (this.debug) {
      const capabilities = modelConfig.getCapabilities(this.model);
      console.log(`[ClaudeClient] Initialized with model: ${this.model}`);
      console.log(`[ClaudeClient] Context window: ${capabilities.contextWindow.toLocaleString()} tokens`);
      console.log(`[ClaudeClient] Supports thinking: ${capabilities.supportsThinking}`);
      if (this.fallbackModel) {
        console.log(`[ClaudeClient] Fallback model: ${this.fallbackModel}`);
      }
    }
  }

  /**
   * 执行带重试的请求 — 对标官方 Ww6 函数
   *
   * 重试策略:
   * - 指数退避 + 25% Jitter (500ms base, 32s max)
   * - 429 + retry-after < 20s → 直接等待，不计入重试次数
   * - 529 overloaded 连续 3 次 → FallbackTriggeredError
   * - 400 context overflow → 自动调整 max_tokens，不计入重试次数
   * - 401 → OAuth token 刷新
   * - x-should-retry header 遵循服务端指示
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0,
    overloadedCount = 0
  ): Promise<T> {
    try {
      // 重置 overloaded 计数（成功时）
      return await operation();
    } catch (error: any) {
      const errorStatus = error.status || error.statusCode || 0;
      const errorType = error.type || error.code || error.message || '';

      // 详细的错误日志
      if (this.debug) {
        console.error('[ClaudeClient] API Error Details:');
        console.error(`  Type: ${errorType}`);
        console.error(`  Status: ${errorStatus}`);
        console.error(`  Message: ${error.message}`);
        if (error.error) {
          console.error(`  Error body: ${JSON.stringify(error.error, null, 2)}`);
        }
      }

      // === 401: OAuth token 刷新 ===
      if (errorStatus === 401 && retryCount === 0) {
        const auth = getAuth();
        if (auth?.type === 'oauth' && auth.refreshToken) {
          console.log('[ClaudeClient] OAuth token expired, attempting refresh...');
          try {
            const refreshedAuth = await refreshTokenAsync(auth);
            if (refreshedAuth?.accessToken) {
              console.log('[ClaudeClient] OAuth token refreshed, retrying request...');
              resetDefaultClient();
              if (this.client) {
                const clientOptions: any = {
                  apiKey: null,
                  authToken: refreshedAuth.accessToken,
                  baseURL: this.client.baseURL,
                  maxRetries: 0,
                };
                const existingOptions = (this.client as any)._options;
                if (existingOptions?.httpAgent) {
                  clientOptions.httpAgent = existingOptions.httpAgent;
                }
                if (existingOptions?.defaultHeaders) {
                  clientOptions.defaultHeaders = existingOptions.defaultHeaders;
                }
                this.client = new Anthropic(clientOptions);
                this.isOAuth = true;
              }
              return this.withRetry(operation, retryCount + 1, overloadedCount);
            }
          } catch (refreshError) {
            console.error('[ClaudeClient] OAuth token refresh failed:', refreshError);
          }
        }
        console.error('[ClaudeClient] Authentication failed - check your API key or login again');
        throw error;
      }

      // === 400: Context overflow 自适应 ===
      const overflowInfo = parseContextOverflowError(error);
      if (overflowInfo) {
        const adjustedMaxTokens = Math.max(
          MIN_OUTPUT_TOKENS,
          overflowInfo.contextLimit - overflowInfo.inputTokens - 1000
        );
        // 防止无限递归：如果调整后的值和当前值相同，说明无法再缩小，直接抛出
        if (adjustedMaxTokens >= this.maxTokens) {
          console.error(
            `[ClaudeClient] Context overflow: input=${overflowInfo.inputTokens} exceeds context limit=${overflowInfo.contextLimit}, cannot reduce max_tokens further (current=${this.maxTokens})`
          );
          throw error;
        }
        console.error(
          `[ClaudeClient] Context overflow: input=${overflowInfo.inputTokens}, max_tokens=${overflowInfo.maxTokens}, limit=${overflowInfo.contextLimit}. Adjusting max_tokens to ${adjustedMaxTokens}`
        );
        this.maxTokens = adjustedMaxTokens;
        return this.withRetry(operation, retryCount, overloadedCount);
      }

      // === 529: Overloaded 计数，连续 3 次触发 fallback ===
      if (isOverloadedError(error)) {
        const newOverloadedCount = overloadedCount + 1;
        if (newOverloadedCount >= OVERLOADED_FALLBACK_THRESHOLD) {
          console.error(
            `[ClaudeClient] Overloaded ${newOverloadedCount} times, triggering model fallback`
          );
          throw new FallbackTriggeredError(this.model, this.fallbackModel || 'unknown');
        }
        if (retryCount < this.maxRetries) {
          const delay = calculateRetryDelay(retryCount + 1);
          console.error(
            `[ClaudeClient] Server overloaded (529), retrying in ${Math.round(delay)}ms... (attempt ${retryCount + 1}/${this.maxRetries}, overloaded ${newOverloadedCount}/${OVERLOADED_FALLBACK_THRESHOLD})`
          );
          await this.sleep(delay);
          return this.withRetry(operation, retryCount + 1, newOverloadedCount);
        }
      }

      // === 429: Rate limit，解析 retry-after ===
      if (errorStatus === 429) {
        const retryAfter = getRetryAfterHeader(error);
        const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;

        // 检查 fast mode overage 降级
        const overageReason = getOverageDisabledReason(error);
        if (overageReason) {
          console.error(`[ClaudeClient] Fast mode disabled: ${overageReason}`);
        }

        // retry-after < 20s: 直接等待，不计入重试次数
        if (retryAfterMs > 0 && retryAfterMs < FAST_RETRY_AFTER_THRESHOLD) {
          console.error(
            `[ClaudeClient] Rate limited (429), waiting ${retryAfterMs}ms (retry-after header, not counting as retry)`
          );
          await this.sleep(retryAfterMs);
          return this.withRetry(operation, retryCount, overloadedCount);
        }

        // retry-after >= 20s 或无 header: 正常计入重试
        if (retryCount < this.maxRetries) {
          const delay = retryAfterMs > 0 ? retryAfterMs : calculateRetryDelay(retryCount + 1);
          console.error(
            `[ClaudeClient] Rate limited (429), retrying in ${Math.round(delay)}ms... (attempt ${retryCount + 1}/${this.maxRetries})`
          );
          await this.sleep(delay);
          return this.withRetry(operation, retryCount + 1, overloadedCount);
        }
      }

      // === 通用可重试错误 ===
      const retryable = isRetryableStatus(error) || RETRYABLE_ERRORS.some(
        (e) => errorType.includes(e) || error.message?.includes(e)
      );

      if (retryable && retryCount < this.maxRetries) {
        const delay = calculateRetryDelay(retryCount + 1, getRetryAfterHeader(error));
        const causeInfo = this.extractErrorCause(error);
        const errorDesc = causeInfo ? `${errorType} (${causeInfo})` : errorType;
        console.error(
          `[ClaudeClient] API error (${errorDesc}), retrying in ${Math.round(delay)}ms... (attempt ${retryCount + 1}/${this.maxRetries})`
        );
        await this.sleep(delay);
        return this.withRetry(operation, retryCount + 1, overloadedCount);
      }

      // === 不可重试，输出诊断信息 ===
      if (errorStatus === 401) {
        console.error('[ClaudeClient] Authentication failed after token refresh - please login again');
      } else if (errorStatus === 403) {
        console.error('[ClaudeClient] Access denied - check API key permissions');
      } else if (errorStatus === 400) {
        console.error('[ClaudeClient] Bad request - check your request parameters');
      } else {
        const causeInfo = this.extractErrorCause(error);
        if (causeInfo) {
          console.error(`[ClaudeClient] API request failed: ${error.message} (cause: ${causeInfo})`);
        } else {
          console.error(`[ClaudeClient] API request failed: ${error.message}`);
        }
      }

      throw error;
    }
  }

  /**
   * v2.1.33: 从错误对象中提取具体的失败原因
   * 对应官方改进：现在显示 ECONNREFUSED、SSL 错误等具体原因
   */
  private extractErrorCause(error: any): string | null {
    // 检查 error.cause (Node.js 标准)
    if (error.cause) {
      if (error.cause.code) {
        return error.cause.code;
      }
      if (error.cause.message) {
        return error.cause.message;
      }
      if (typeof error.cause === 'string') {
        return error.cause;
      }
    }

    // 检查 error.code
    if (error.code) {
      return error.code;
    }

    // 从错误消息中提取常见的连接错误模式
    const message = error.message || '';
    const patterns = [
      /ECONNREFUSED/,
      /ECONNRESET/,
      /ETIMEDOUT/,
      /ENOTFOUND/,
      /SSL_ERROR/i,
      /CERT_/,
      /certificate/i,
      /self.signed/i,
    ];

    for (const pattern of patterns) {
      const match = message.match(pattern);
      if (match) {
        return match[0];
      }
    }

    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 计算估算成本
   */
  private calculateCost(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
    cacheCreationTokens?: number,
    thinkingTokens?: number
  ): number {
    return modelConfig.calculateCost(this.model, {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      thinkingTokens,
    });
  }

  /**
   * 更新使用统计
   */
  private updateUsage(usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    thinkingTokens?: number;
    apiDurationMs?: number;
  }): void {
    this.totalUsage.inputTokens += usage.inputTokens;
    this.totalUsage.outputTokens += usage.outputTokens;
    this.totalUsage.totalTokens += usage.inputTokens + usage.outputTokens;
    this.totalUsage.cacheReadTokens = (this.totalUsage.cacheReadTokens || 0) + (usage.cacheReadTokens || 0);
    this.totalUsage.cacheCreationTokens = (this.totalUsage.cacheCreationTokens || 0) + (usage.cacheCreationTokens || 0);
    this.totalUsage.thinkingTokens = (this.totalUsage.thinkingTokens || 0) + (usage.thinkingTokens || 0);
    this.totalUsage.apiDurationMs = (this.totalUsage.apiDurationMs || 0) + (usage.apiDurationMs || 0);
    this.totalUsage.estimatedCost += this.calculateCost(
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheCreationTokens,
      usage.thinkingTokens
    );

    // 同步到全局模型统计
    modelStats.record(this.model, usage);
  }

  async createMessage(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: {
      enableThinking?: boolean;
      thinkingBudget?: number;
      reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
      toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
      promptBlocks?: PromptBlock[];
      toolSearchEnabled?: boolean;
    }
  ): Promise<{
    content: ContentBlock[];
    stopReason: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      thinkingTokens?: number;
    };
    thinking?: ThinkingResult;
    model: string;
  }> {
    const startTime = Date.now();

    // 准备 Extended Thinking 参数
    const thinkingParams = options?.enableThinking
      ? thinkingManager.getThinkingParams(this.model, { forceEnabled: true })
      : {};

    // 如果指定了思考预算，覆盖默认值
    if (options?.thinkingBudget && thinkingParams.thinking) {
      thinkingParams.thinking.budget_tokens = options.thinkingBudget;
    }

    // 使用回退机制执行请求
    const executeRequest = async (currentModel: string) => {
      return await this.withRetry(async () => {
        // v2.1.36: 计算 fast mode 激活状态
        const isFastActive = this.fastMode && shouldActivateFastMode(currentModel, this.fastMode);

        // 构建 betas 数组（模拟官方 qC 函数）
        const betas = buildBetas(currentModel, this.isOAuth, isFastActive);

        // 对齐官方 HJq：按型号检查是否启用 prompt caching
        const enableCaching = isPromptCachingEnabled(currentModel);

        // v6.1: 对齐官方 P 变量 —— 有 MCP tools 或 ToolSearch 时降级 system prompt cache scope
        const hasMcpTools = tools?.some(t => t.isMcp === true) ?? false;
        const hasToolSearch = options?.toolSearchEnabled ?? false;
        const skipGlobal: 'none' | 'system_prompt' = (enableCaching && (hasMcpTools || hasToolSearch)) ? 'system_prompt' : 'none';

        // 格式化 system prompt（优先使用 blocks 分块缓存）
        const formattedSystem = formatSystemPrompt(systemPrompt, this.isOAuth, options?.promptBlocks, enableCaching, skipGlobal, this.identityVariant);

        // 构建 API 工具列表（将 WebSearch 客户端工具替换为 Server Tool）
        const apiTools = buildApiTools(tools, options?.toolSearchEnabled, enableCaching, this.isOAuth, this.isThirdParty);

        const requestParams: any = {
          model: currentModel,
          max_tokens: this.maxTokens,
          system: formattedSystem,
          // v5.0: 使用 formatMessages 启用消息缓存（最后2条消息，对齐官方 S2z）
          messages: formatMessages(messages, options?.enableThinking, enableCaching, this.querySource),
          tools: apiTools,
          // 添加 tool_choice 参数（强制 AI 使用工具）
          ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
          // 添加 betas 参数（对齐原始参考实现）
          ...(betas.length > 0 ? { betas } : {}),
          // 添加 metadata（对齐原始参考实现的 Ja 函数）
          metadata: buildMetadata(),
          // v2.1.31: 传递 temperature（如果配置了覆盖值）
          ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
          // v2.1.36: Fast mode extra body 参数
          ...(isFastActive ? { [FAST_MODE_RESEARCH_PREVIEW]: 'active' } : {}),
          ...thinkingParams,
        };

        if (this.debug) {
          console.log('[ClaudeClient] Using beta.messages.create with betas:', betas);
          console.log('[ClaudeClient] System prompt format:', Array.isArray(formattedSystem) ? 'array' : 'string');
        }

        // 使用 beta.messages.create 而不是 messages.create（官方方式）
        return await this.client.beta.messages.create(requestParams);
      });
    };

    let response: any;
    let usedModel = this.model;

    if (this.fallbackModel) {
      const result = await modelFallback.executeWithFallback(executeRequest, {
        onRetry: (model, attempt, error) => {
          if (this.debug) {
            console.log(`[ClaudeClient] Retry ${attempt} for ${model}: ${error.message}`);
          }
        },
        onFallback: (from, to, error) => {
          console.warn(`[ClaudeClient] Falling back from ${from} to ${to}: ${error.message}`);
        },
      });
      response = result.result;
      usedModel = result.model;
    } else {
      response = await executeRequest(this.model);
    }

    const apiDurationMs = Date.now() - startTime;

    // 提取使用统计
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens,
      thinkingTokens: 0,
      apiDurationMs,
    };

    // 处理 Extended Thinking 响应
    let thinkingResult: ThinkingResult | undefined;
    if (response.thinking || response.thinking_tokens) {
      // 优先使用 usage 中的 thinking_tokens，如果没有则使用 response 顶层的
      const thinkingTokensCount = (response as any).usage?.thinking_tokens || response.thinking_tokens || 0;
      usage.thinkingTokens = thinkingTokensCount;

      if (response.thinking) {
        thinkingResult = thinkingManager.processThinkingResponse(
          {
            thinking: response.thinking,
            thinking_tokens: thinkingTokensCount,
          },
          startTime
        ) || undefined;
      }
    }

    this.updateUsage(usage);

    return {
      content: response.content as ContentBlock[],
      stopReason: response.stop_reason || 'end_turn',
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        thinkingTokens: usage.thinkingTokens,
      },
      thinking: thinkingResult,
      model: usedModel,
    };
  }

  async *createMessageStream(
    messages: Message[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    options?: {
      enableThinking?: boolean;
      thinkingBudget?: number;
      reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
      signal?: AbortSignal;
      toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
      promptBlocks?: PromptBlock[];
      toolSearchEnabled?: boolean;
    }
  ): AsyncGenerator<{
    type: 'text' | 'thinking' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_complete' | 'server_tool_use_start' | 'web_search_result' | 'stop' | 'usage' | 'error' | 'response_headers';
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: string;
    /** Web search results (for server_tool_use) */
    searchResults?: any[];
    /** Full web_search_tool_result block from API */
    data?: any;
    stopReason?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
      thinkingTokens?: number;
    };
    error?: string;
    /** v2.1.6: 响应头（用于速率限制警告） */
    headers?: Headers;
  }> {
    let stream: any;
    let retryCount = 0;
    const maxStreamRetries = this.maxRetries;
    const abortSignal = options?.signal;

    // 创建流的辅助函数（支持重试）
    const attemptCreateStream = async (): Promise<any> => {
      if (this.debug) {
        console.log('[ClaudeClient] Starting message stream...');
        console.log(`[ClaudeClient] Model: ${this.model}, MaxTokens: ${this.maxTokens}`);
        console.log(`[ClaudeClient] Messages: ${messages.length}, Tools: ${tools?.length || 0}`);
      }

      // 准备 Extended Thinking 参数
      const thinkingParams = options?.enableThinking
        ? thinkingManager.getThinkingParams(this.model, { forceEnabled: true })
        : {};

      // 如果指定了思考预算，覆盖默认值
      if (options?.thinkingBudget && thinkingParams.thinking) {
        thinkingParams.thinking.budget_tokens = options.thinkingBudget;
      }

      // v2.1.36: 计算 fast mode 激活状态
      const isFastActive = this.fastMode && shouldActivateFastMode(this.model, this.fastMode);

      // 构建 betas 数组（模拟官方 qC 函数）
      const betas = buildBetas(this.model, this.isOAuth, isFastActive);

      // 对齐官方 HJq：按型号检查是否启用 prompt caching
      const enableCaching = isPromptCachingEnabled(this.model);

      // v6.1: 对齐官方 P 变量 —— 有 MCP tools 或 ToolSearch 时降级 system prompt cache scope
      const hasMcpTools = tools?.some(t => t.isMcp === true) ?? false;
      const hasToolSearch = options?.toolSearchEnabled ?? false;
      const skipGlobal: 'none' | 'system_prompt' = (enableCaching && (hasMcpTools || hasToolSearch)) ? 'system_prompt' : 'none';

      // 格式化 system prompt（优先使用 blocks 分块缓存）
      const formattedSystem = formatSystemPrompt(systemPrompt, this.isOAuth, options?.promptBlocks, enableCaching, skipGlobal, this.identityVariant);

      // 构建 API 工具列表（将 WebSearch 客户端工具替换为 Server Tool）
      const apiTools = buildApiTools(tools, options?.toolSearchEnabled, enableCaching, this.isOAuth, this.isThirdParty);

      if (this.debug) {
        console.log('[ClaudeClient] isOAuth:', this.isOAuth, '| apiKey:', this.client.apiKey ? 'set' : 'null', '| authToken:', (this.client as any).authToken ? 'set' : 'null');
        console.log('[ClaudeClient] Using beta.messages.stream with betas:', betas);
        console.log('[ClaudeClient] System prompt format:', Array.isArray(formattedSystem) ? `array(${formattedSystem.length} blocks)` : 'string');
        if (Array.isArray(formattedSystem) && formattedSystem.length > 0) {
          console.log('[ClaudeClient] System prompt block[0] starts with:', formattedSystem[0].text.substring(0, 80));
        }
        if (apiTools?.some(t => t.type === 'web_search_20250305')) {
          console.log('[ClaudeClient] WebSearch Server Tool enabled');
        }
        if (isFastActive) {
          console.log('[ClaudeClient] Fast mode active');
        }
        if (!enableCaching) {
          console.log('[ClaudeClient] Prompt caching disabled for model:', this.model);
        }
      }

      // 对齐官方 xR7：在每次 API 调用前追踪 system/tools 状态，为后续 cache break 报告提供上下文
      if (enableCaching && Array.isArray(formattedSystem)) {
        trackCacheState(
          formattedSystem,
          apiTools || [],
          this.model,
          this.querySource,
          this.fastMode
        );
      }

      // 使用 beta.messages.stream 而不是 messages.stream（官方方式）
      const requestParams = {
        model: this.model,
        max_tokens: this.maxTokens,
        system: formattedSystem as any,
        // v5.0: 使用 formatMessages 启用消息缓存（最后2条消息，对齐官方 S2z）
        messages: formatMessages(messages, options?.enableThinking, enableCaching, this.querySource) as any,
        tools: apiTools as any,
        // 添加 toolChoice 支持（强制 AI 调用特定工具）
        ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
        // 添加 betas 参数（对齐原始参考实现）
        ...(betas.length > 0 ? { betas } : {}),
        // 添加 metadata（对齐原始参考实现的 Ja 函数）
        metadata: buildMetadata(),
        // v2.1.31: 传递 temperature 到 streaming 路径
        // 修复 temperatureOverride 在 streaming API 路径被静默忽略的问题
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        // v2.1.36: Fast mode extra body 参数
        ...(isFastActive ? { [FAST_MODE_RESEARCH_PREVIEW]: 'active' } : {}),
        ...thinkingParams,
      };

      // Debug: log request summary for diagnosing 400 errors
      console.log('[ClaudeClient] Request summary — model:', this.model,
        '| max_tokens:', this.maxTokens,
        '| betas:', betas,
        '| isOAuth:', this.isOAuth,
        '| apiKey:', this.client.apiKey ? this.client.apiKey.substring(0, 12) + '...' : 'null',
        '| authToken:', (this.client as any).authToken ? 'set' : 'null',
        '| baseURL:', (this.client as any).baseURL || 'default',
        '| thinking:', JSON.stringify(thinkingParams),
        '| tools:', (apiTools?.length || 0),
        '| messages:', messages.length,
      );

      stream = this.client.beta.messages.stream(requestParams as any);
      return stream;
    };

    // 带重试的流创建 — 对标 withRetry 策略
    let overloadedCount = 0;
    while (retryCount <= maxStreamRetries) {
      try {
        stream = await attemptCreateStream();
        break; // 成功创建，跳出重试循环
      } catch (error: any) {
        const errorType = error.type || error.code || error.message || '';
        const errorStatus = error.status || error.statusCode || 0;

        // 404: 端点不存在，不重试
        if (errorStatus === 404) {
          console.error('[ClaudeClient] Streaming endpoint returned 404 - endpoint not found');
          yield { type: 'error', error: `API endpoint returned 404: ${error.message}` };
          return;
        }

        // 401: OAuth token 刷新（仅首次）
        if (errorStatus === 401 && retryCount === 0) {
          const auth = getAuth();
          if (auth?.type === 'oauth' && auth.refreshToken) {
            try {
              const refreshedAuth = await refreshTokenAsync(auth);
              if (refreshedAuth?.accessToken) {
                console.log('[ClaudeClient] OAuth token refreshed for stream, retrying...');
                resetDefaultClient();
                if (this.client) {
                  const clientOptions: any = {
                    apiKey: null,
                    authToken: refreshedAuth.accessToken,
                    baseURL: this.client.baseURL,
                    maxRetries: 0,
                  };
                  const existingOptions = (this.client as any)._options;
                  if (existingOptions?.httpAgent) clientOptions.httpAgent = existingOptions.httpAgent;
                  if (existingOptions?.defaultHeaders) clientOptions.defaultHeaders = existingOptions.defaultHeaders;
                  this.client = new Anthropic(clientOptions);
                  this.isOAuth = true;
                }
                retryCount++;
                continue;
              }
            } catch (refreshError) {
              console.error('[ClaudeClient] OAuth token refresh failed for stream:', refreshError);
            }
          }
          yield { type: 'error', error: `Authentication failed: ${error.message}` };
          return;
        }

        // 400: Context overflow 自适应
        const overflowInfo = parseContextOverflowError(error);
        if (overflowInfo) {
          const adjustedMaxTokens = Math.max(
            MIN_OUTPUT_TOKENS,
            overflowInfo.contextLimit - overflowInfo.inputTokens - 1000
          );
          if (adjustedMaxTokens >= this.maxTokens) {
            console.error(
              `[ClaudeClient] Stream context overflow: input=${overflowInfo.inputTokens} exceeds context limit=${overflowInfo.contextLimit}, cannot reduce max_tokens further (current=${this.maxTokens})`
            );
            yield { type: 'error', error: `Context overflow: input tokens (${overflowInfo.inputTokens}) exceed context limit (${overflowInfo.contextLimit})` };
            return;
          }
          console.error(
            `[ClaudeClient] Stream context overflow: input=${overflowInfo.inputTokens}, limit=${overflowInfo.contextLimit}. Adjusting max_tokens to ${adjustedMaxTokens}`
          );
          this.maxTokens = adjustedMaxTokens;
          // 不计入重试次数
          continue;
        }

        // 529: Overloaded 计数
        if (isOverloadedError(error)) {
          overloadedCount++;
          if (overloadedCount >= OVERLOADED_FALLBACK_THRESHOLD) {
            console.error(`[ClaudeClient] Stream overloaded ${overloadedCount} times, triggering fallback`);
            yield { type: 'error', error: `Server overloaded ${overloadedCount} times` };
            return;
          }
          if (retryCount < maxStreamRetries) {
            retryCount++;
            const delay = calculateRetryDelay(retryCount);
            console.error(
              `[ClaudeClient] Stream overloaded (529), retrying in ${Math.round(delay)}ms... (attempt ${retryCount}/${maxStreamRetries}, overloaded ${overloadedCount}/${OVERLOADED_FALLBACK_THRESHOLD})`
            );
            await this.sleep(delay);
            continue;
          }
        }

        // 429: Rate limit
        if (errorStatus === 429) {
          const retryAfter = getRetryAfterHeader(error);
          const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 0;

          const overageReason = getOverageDisabledReason(error);
          if (overageReason) {
            console.error(`[ClaudeClient] Stream fast mode disabled: ${overageReason}`);
          }

          // retry-after < 20s: 直接等待，不计入重试次数
          if (retryAfterMs > 0 && retryAfterMs < FAST_RETRY_AFTER_THRESHOLD) {
            console.error(`[ClaudeClient] Stream rate limited, waiting ${retryAfterMs}ms (not counting as retry)`);
            await this.sleep(retryAfterMs);
            continue;
          }

          if (retryCount < maxStreamRetries) {
            retryCount++;
            const delay = retryAfterMs > 0 ? retryAfterMs : calculateRetryDelay(retryCount);
            console.error(`[ClaudeClient] Stream rate limited (429), retrying in ${Math.round(delay)}ms... (attempt ${retryCount}/${maxStreamRetries})`);
            await this.sleep(delay);
            continue;
          }
        }

        // 通用可重试
        const retryable = isRetryableStatus(error) || RETRYABLE_ERRORS.some(
          (e) => errorType.includes(e) || error.message?.includes(e)
        );

        if (retryable && retryCount < maxStreamRetries) {
          retryCount++;
          const delay = calculateRetryDelay(retryCount, getRetryAfterHeader(error));
          console.error(
            `[ClaudeClient] Stream creation failed (${errorType}), retrying in ${Math.round(delay)}ms... (attempt ${retryCount}/${maxStreamRetries})`
          );
          await this.sleep(delay);
          continue;
        }

        console.error('[ClaudeClient] Failed to create stream:', error.message);
        yield { type: 'error', error: error.message };
        return;
      }
    }

    if (!stream) {
      yield { type: 'error', error: 'Failed to create stream after retries' };
      return;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let thinkingTokens = 0;

    // 流式空闲超时保护：如果连续 STREAM_IDLE_TIMEOUT_MS 没有收到任何事件，主动超时
    // 防止 OpenRouter 等第三方代理静默断连导致 for-await 永远阻塞
    // 5 分钟：大上下文（90K+ tokens）首次 cache_creation 时 API 响应较慢，
    // 加上 Opus thinking 阶段可能持续数分钟，需要足够的等待时间
    const STREAM_IDLE_TIMEOUT_MS = 300_000;

    try {
      // 包装 async iterator 添加空闲超时
      const streamWithTimeout = async function* (source: AsyncIterable<any>, timeoutMs: number, signal?: AbortSignal) {
        const iterator = source[Symbol.asyncIterator]();
        while (true) {
          if (signal?.aborted) break;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const result = await Promise.race([
              iterator.next(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Stream idle timeout: no events received for ${timeoutMs / 1000}s`)), timeoutMs);
              }),
            ]);
            if (result.done) break;
            yield result.value;
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        }
      };

      for await (const event of streamWithTimeout(stream, STREAM_IDLE_TIMEOUT_MS, abortSignal)) {
        // 检查是否被中断
        if (abortSignal?.aborted) {
          // 尝试取消流
          try {
            stream.abort?.();
          } catch {
            // 忽略取消时的错误
          }
          yield { type: 'error', error: 'Request aborted by user' };
          return;
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta as any;
          if (delta.type === 'text_delta') {
            yield { type: 'text', text: delta.text };
          } else if (delta.type === 'thinking_delta') {
            // Extended Thinking delta
            yield { type: 'thinking', thinking: delta.thinking };
          } else if (delta.type === 'input_json_delta') {
            yield { type: 'tool_use_delta', input: delta.partial_json };
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block as any;
          if (block.type === 'tool_use') {
            yield { type: 'tool_use_start', id: block.id, name: block.name };
          } else if (block.type === 'server_tool_use') {
            // Server Tool (如 web_search) - 由 Anthropic 服务器执行
            // input 包含 server tool 的参数（如 web_search 的 { query: "..." }）
            yield { type: 'server_tool_use_start', id: block.id, name: block.name, input: JSON.stringify(block.input || {}) };
          } else if (block.type === 'thinking') {
            // Extended Thinking block started
            if (this.debug) {
              console.log('[ClaudeClient] Extended Thinking block started');
            }
          }
        } else if (event.type === 'content_block_stop') {
          // 检查是否是 web_search_tool_result
          // 注意：web_search_tool_result 作为完整块返回，需要从 finalMessage 中获取
        } else if (event.type === 'message_delta') {
          const delta = event as any;
          if (delta.usage) {
            outputTokens = delta.usage.output_tokens || 0;
          }
        } else if (event.type === 'message_start') {
          const msg = (event as any).message;
          if (msg?.usage) {
            inputTokens = msg.usage.input_tokens || 0;
            cacheReadTokens = msg.usage.cache_read_input_tokens || 0;
            cacheCreationTokens = msg.usage.cache_creation_input_tokens || 0;
          }
        } else if (event.type === 'message_stop') {
          // 从最终消息中获取 web_search_tool_result 和 thinking_tokens
          const finalMessage = await stream.finalMessage();

          // 从 finalMessage.content 中提取完整的 tool_use input 和 web_search_tool_result
          // SDK 内部维护了完整的 content_block 状态，包括 JSON.parse 后的 tool_use input
          // 这比我们手动拼接 input_json_delta 更可靠（避免截断/解析失败问题）
          if (finalMessage?.content) {
            for (const block of finalMessage.content) {
              if ((block as any).type === 'web_search_tool_result') {
                yield { type: 'web_search_result', data: block };
              } else if ((block as any).type === 'tool_use') {
                // yield 完整的 tool_use block（包含 SDK 解析好的 input 对象）
                yield {
                  type: 'tool_use_complete',
                  id: (block as any).id,
                  name: (block as any).name,
                  input: (block as any).input,
                };
              }
            }
          }

          if (finalMessage?.usage) {
            // 优先使用 usage 中的 thinking_tokens
            thinkingTokens = (finalMessage.usage as any).thinking_tokens || 0;

            // 如果有 thinking 内容但没有 tokens 统计，记录警告
            if (this.debug && finalMessage.thinking && !thinkingTokens) {
              console.warn('[ClaudeClient] Thinking content present but no thinking_tokens in usage');
            }
          }

          this.updateUsage({
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            thinkingTokens,
          });

          // 对齐官方 bR7：检测缓存命中率下降并输出警告
          reportCacheBreak(this.querySource, cacheReadTokens, cacheCreationTokens, this.debug);

          yield {
            type: 'usage',
            usage: {
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheCreationTokens,
              thinkingTokens,
            },
          };

          // v2.1.6: 获取响应头用于速率限制警告
          // 对齐官方 pG0 函数：在流结束后获取响应头
          try {
            const { response } = await stream.withResponse();
            if (response?.headers) {
              yield { type: 'response_headers', headers: response.headers };
            }
          } catch (headerError) {
            // 获取响应头失败不应影响正常流程
            if (this.debug) {
              console.warn('[ClaudeClient] Failed to get response headers:', headerError);
            }
          }

          yield { type: 'stop', stopReason: finalMessage?.stop_reason || 'end_turn' };
        } else if (event.type === 'error') {
          const errorEvent = event as any;
          console.error('[ClaudeClient] Stream error event:', errorEvent.error);
          yield { type: 'error', error: errorEvent.error?.message || 'Unknown stream error' };
        }
      }
    } catch (error: any) {
      // 增强错误日志，追踪 Connection error 的真正来源
      const errorCode = error.code || error.type || 'UNKNOWN';
      const errorStatus = error.status || error.statusCode || '';
      const errorCause = error.cause?.message || '';

      console.error(`[ClaudeClient] Stream processing error: ${error.message}`);
      console.error(`[ClaudeClient] Error details - code: ${errorCode}, status: ${errorStatus}, cause: ${errorCause}`);

      if (this.debug || error.message?.includes('Connection error')) {
        console.error('[ClaudeClient] Full error stack:', error.stack);
        if (error.cause) {
          console.error('[ClaudeClient] Error cause:', error.cause);
        }
      }
      yield { type: 'error', error: error.message };
    }
  }

  /**
   * 获取总使用统计
   */
  getUsageStats(): UsageStats {
    return { ...this.totalUsage };
  }

  /**
   * 获取格式化的成本字符串
   */
  getFormattedCost(): string {
    if (this.totalUsage.estimatedCost < 0.01) {
      return `$${(this.totalUsage.estimatedCost * 100).toFixed(2)}¢`;
    }
    return `$${this.totalUsage.estimatedCost.toFixed(4)}`;
  }

  /**
   * 重置使用统计
   */
  resetUsageStats(): void {
    this.totalUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  setMaxTokens(tokens: number): void {
    this.maxTokens = tokens;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  /** 获取底层 Anthropic SDK 客户端（用于 cache keepalive 等低级操作） */
  getAnthropicClient(): Anthropic {
    return this.client;
  }

  /** 是否使用 OAuth 模式 */
  getIsOAuth(): boolean {
    return this.isOAuth;
  }
}

// 默认客户端实例 (延迟初始化以支持 OAuth)
let _defaultClient: ClaudeClient | null = null;

/**
 * 检查 OAuth scope 是否包含 user:inference
 * 官方 Anthropic OAuth 只有在有这个 scope 时才直接使用 OAuth token
 */
function hasInferenceScope(scopes?: string[]): boolean {
  return Boolean(scopes?.includes('user:inference'));
}

/**
 * 获取默认客户端实例 (延迟初始化，自动使用 auth 模块的认证)
 */
export function getDefaultClient(): ClaudeClient {
  if (!_defaultClient) {
    // 初始化认证并获取凭据
    initAuth();
    const auth = getAuth();

    const config: ClientConfig = {};

    // 根据认证类型设置凭据
    if (auth) {
      if (auth.type === 'api_key' && auth.apiKey) {
        config.apiKey = auth.apiKey;
      } else if (auth.type === 'oauth') {
        // OAuth 模式：支持 accessToken 或 authToken（订阅模式）
        const oauthToken = auth.accessToken || auth.authToken;

        if (oauthToken) {
          // 关键修复：检查是否有 user:inference scope
          // 对齐原始参考实现，在有此 scope 时直接使用 OAuth access token
          // 注意：auth.scope 或 auth.scopes 都可能存在
          const scopes = auth.scope || auth.scopes;
          if (hasInferenceScope(scopes)) {
            // 直接使用 OAuth access token 作为 authToken
            config.authToken = oauthToken;
          } else {
            // 没有 inference scope，需要使用创建的 API Key
            if (auth.oauthApiKey) {
              config.apiKey = auth.oauthApiKey;
            }
          }
        }
      }
    }

    _defaultClient = new ClaudeClient(config);
  }
  return _defaultClient;
}

/**
 * 重置默认客户端（用于认证变更后刷新）
 */
export function resetDefaultClient(): void {
  _defaultClient = null;
}

/**
 * 创建指定模型的客户端（复用 auth 模块的认证）
 * 用于需要使用不同模型（如 Haiku）的场景
 */
export function createClientWithModel(model: string): ClaudeClient {
  initAuth();
  const auth = getAuth();

  const config: ClientConfig = {
    model,
    timeout: 300000,  // 5分钟 API 请求超时
  };

  if (auth) {
    if (auth.type === 'api_key' && auth.apiKey) {
      config.apiKey = auth.apiKey;
    } else if (auth.type === 'oauth') {
      const oauthToken = auth.accessToken || auth.authToken;
      if (oauthToken) {
        const scopes = auth.scope || auth.scopes;
        if (hasInferenceScope(scopes)) {
          config.authToken = oauthToken;
        } else if (auth.oauthApiKey) {
          config.apiKey = auth.oauthApiKey;
        }
      }
    }
  }

  return new ClaudeClient(config);
}

// 保持向后兼容性，但不推荐直接使用
// @deprecated 使用 getDefaultClient() 代替
export const defaultClient = new Proxy({} as ClaudeClient, {
  get(_, prop) {
    return Reflect.get(getDefaultClient(), prop);
  }
});
