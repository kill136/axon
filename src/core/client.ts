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

// 官方 Claude Code 的 beta 头 (v2.1.29 对齐)
// 重要发现：claude-code-20250219 beta 需要与特定的 system prompt 配合使用
// system prompt 的第一个 block 必须以下列字符串之一开头：
// - "You are Claude Code, Anthropic's official CLI for Claude."
// - "You are a Claude agent, built on Anthropic's Claude Agent SDK."
const CLAUDE_CODE_BETA = 'claude-code-20250219';           // tFA
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
 * 通过环境变量检测使用的云服务商
 */
function getProviderType(): ProviderType {
  if (process.env.CLAUDE_CODE_USE_BEDROCK === 'true' || process.env.CLAUDE_CODE_USE_BEDROCK === '1') {
    return 'bedrock';
  }
  if (process.env.CLAUDE_CODE_USE_VERTEX === 'true' || process.env.CLAUDE_CODE_USE_VERTEX === '1') {
    return 'vertex';
  }
  if (process.env.CLAUDE_CODE_USE_FOUNDRY === 'true' || process.env.CLAUDE_CODE_USE_FOUNDRY === '1') {
    return 'foundry';
  }
  // v2.1.29: 默认使用 'firstParty' 表示直接使用 Anthropic API
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
 * 2. 且未设置 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
 *
 * 这是 v2.1.29 修复 beta header 验证错误的关键：
 * Bedrock 和 Vertex 网关用户不会获得实验性 betas
 */
function isExperimentalBetasEnabled(): boolean {
  const provider = getProviderType();
  if (provider !== 'firstParty' && provider !== 'foundry') {
    return false;
  }
  return !isEnvEnabled(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS);
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
 * v2.1.29: 检查模型是否支持 web search (对应官方 DOK 函数)
 */
function supportsWebSearch(model: string): boolean {
  return model.includes('claude-sonnet-4') ||
         model.includes('claude-opus-4') ||
         model.includes('claude-haiku-4');
}

// Claude Code 身份验证的 magic string
// 官方有三种身份标识，根据不同场景使用
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const CLAUDE_CODE_AGENT_SDK_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.";
const CLAUDE_AGENT_IDENTITY = "You are a Claude agent, built on Anthropic's Claude Agent SDK.";

/**
 * 检查 system prompt 是否包含有效的 Claude Code 身份标识
 */
function hasValidIdentity(systemPrompt?: string | Array<{type: string; text: string}>): boolean {
  if (!systemPrompt) return false;

  if (typeof systemPrompt === 'string') {
    return systemPrompt.startsWith(CLAUDE_CODE_IDENTITY) ||
           systemPrompt.startsWith(CLAUDE_CODE_AGENT_SDK_IDENTITY) ||
           systemPrompt.startsWith(CLAUDE_AGENT_IDENTITY);
  }

  if (Array.isArray(systemPrompt) && systemPrompt.length > 0) {
    const firstBlock = systemPrompt[0];
    if (firstBlock?.type === 'text' && firstBlock?.text) {
      return firstBlock.text.startsWith(CLAUDE_CODE_IDENTITY) ||
             firstBlock.text.startsWith(CLAUDE_CODE_AGENT_SDK_IDENTITY) ||
             firstBlock.text.startsWith(CLAUDE_AGENT_IDENTITY);
    }
  }

  return false;
}

/**
 * 格式化 system prompt 以启用 Prompt Caching
 *
 * v5.0: 所有模式都启用 cache_control，节省重复 System Prompt 的 token 消耗
 * - 对于 OAuth 模式：第一个 block 必须以 CLAUDE_CODE_IDENTITY 开头
 * - 对于非 OAuth 模式：直接缓存整个 System Prompt
 */
/**
 * PromptBlock 类型（与 prompt/types.ts 对齐，避免循环依赖）
 */
interface PromptBlock {
  text: string;
  cacheScope: 'global' | 'org' | null;
}

function formatSystemPrompt(
  systemPrompt: string | undefined,
  isOAuth: boolean,
  promptBlocks?: PromptBlock[]
): Array<{type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}> | string | undefined {
  // 没有 system prompt 时
  if (!systemPrompt) {
    if (isOAuth) {
      return [
        { type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: { type: 'ephemeral' } }
      ];
    }
    return undefined;
  }

  // v6.0: 使用 PromptBlock 分块缓存（对齐官方 CG1 分割逻辑）
  // 静态 block (cacheScope: "global") → cache_control: ephemeral（可跨 turn 缓存）
  // 动态 block (cacheScope: null) → 不设 cache_control（每 turn 重新计算）
  if (promptBlocks && promptBlocks.length > 0) {
    const apiBlocks: Array<{type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}> = [];
    for (const block of promptBlocks) {
      if (!block.text) continue;
      apiBlocks.push({
        type: 'text',
        text: block.text,
        ...(block.cacheScope !== null ? { cache_control: { type: 'ephemeral' as const } } : {}),
      });
    }
    return apiBlocks.length > 0 ? apiBlocks : undefined;
  }

  // 兼容旧路径：单字符串模式
  if (!isOAuth) {
    return [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ];
  }

  // OAuth 模式需要身份标识作为第一个 block
  let identityToUse = CLAUDE_CODE_IDENTITY;
  let remainingText = '';

  if (systemPrompt.startsWith(CLAUDE_CODE_IDENTITY)) {
    identityToUse = CLAUDE_CODE_IDENTITY;
    remainingText = systemPrompt.slice(CLAUDE_CODE_IDENTITY.length).trim();
  } else if (systemPrompt.startsWith(CLAUDE_CODE_AGENT_SDK_IDENTITY)) {
    identityToUse = CLAUDE_CODE_AGENT_SDK_IDENTITY;
    remainingText = systemPrompt.slice(CLAUDE_CODE_AGENT_SDK_IDENTITY.length).trim();
  } else if (systemPrompt.startsWith(CLAUDE_AGENT_IDENTITY)) {
    identityToUse = CLAUDE_AGENT_IDENTITY;
    remainingText = systemPrompt.slice(CLAUDE_AGENT_IDENTITY.length).trim();
  } else {
    return [
      { type: 'text', text: CLAUDE_CODE_IDENTITY, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }
    ];
  }

  const blocks: Array<{type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}> = [
    { type: 'text' as const, text: identityToUse, cache_control: { type: 'ephemeral' as const } }
  ];
  if (remainingText.length > 0) {
    blocks.push({ type: 'text' as const, text: remainingText, cache_control: { type: 'ephemeral' as const } });
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

function formatMessages(messages: Array<{ role: string; content: any }>, enableThinking?: boolean): Array<{ role: string; content: any }> {
  const formatted = messages.map((m, msgIndex) => {
    const isLastMessage = msgIndex === messages.length - 1;

    // 如果 content 是字符串，转换为数组格式并添加缓存控制
    if (typeof m.content === 'string') {
      return {
        role: m.role,
        content: [{
          type: 'text',
          text: m.content,
          // 只为最后一条消息添加缓存控制（官方逻辑）
          ...(isLastMessage ? { cache_control: { type: 'ephemeral' } } : {}),
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
        // 跳过 thinking 类型的 block
        const isThinkingBlock = block.type === 'thinking' || block.type === 'redacted_thinking';

        // 只为最后一条消息的最后一个非 thinking block 添加缓存控制
        if (isLastMessage && isLastBlock && !isThinkingBlock) {
          return { ...block, cache_control: { type: 'ephemeral' } };
        }
        return block;
      });

      return { role: m.role, content };
    }

    return { role: m.role, content: m.content };
  });
  return sanitizeContent(formatted);
}

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
 * - system prompt 必须以 CLAUDE_CODE_IDENTITY 或 CLAUDE_AGENT_IDENTITY 开头
 * - 只有满足这个条件，OAuth token 才能使用 sonnet/opus 模型
 *
 * v2.1.29 修复：
 * - 完全重写以对齐官方实现
 * - 对于 Bedrock/Vertex 网关用户，不添加实验性 betas
 * - 支持 CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 完全禁用实验性 betas
 * - 添加 structured-outputs beta 支持
 */
function buildBetas(model: string, isOAuth: boolean, fastMode?: boolean): string[] {
  const betas: string[] = [];
  const providerType = getProviderType();
  const experimentalEnabled = isExperimentalBetasEnabled();
  const isHaiku = model.toLowerCase().includes('haiku');

  // 1. 非 haiku 模型添加 claude-code beta（官方: if(!K)q.push(tFA)）
  if (!isHaiku) {
    betas.push(CLAUDE_CODE_BETA);
  }

  // 2. OAuth 订阅用户添加 oauth beta（官方: if(O7())q.push(zE)）
  if (isOAuth) {
    betas.push(OAUTH_BETA);
  }

  // 3. 带 "[1m]" 标记的模型添加 context-1m beta（官方: if(A.includes("[1m]"))q.push(xZ1)）
  if (model.includes('[1m]')) {
    betas.push(CONTEXT_1M_BETA);
  }

  // 4. 未禁用 thinking 且模型支持时添加 thinking beta
  // （官方: if(!X6(process.env.DISABLE_INTERLEAVED_THINKING)&&XOK(A))q.push(eFA)）
  if (!isEnvEnabled(process.env.DISABLE_INTERLEAVED_THINKING) && supportsInterleavedThinking(model)) {
    betas.push(THINKING_BETA);
  }

  // 5. structured outputs beta（官方需要 feature flag tengu_tool_pear）
  // 由于我们没有 Anthropic 的 feature flag 系统，默认不启用
  // 通过环境变量 CLAUDE_CODE_ENABLE_STRUCTURED_OUTPUTS=1 手动启用
  if (supportsStructuredOutputs(model) && isEnvEnabled(process.env.CLAUDE_CODE_ENABLE_STRUCTURED_OUTPUTS)) {
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
 * 官方 Claude Code 使用 Anthropic API 的 Server Tool 进行网络搜索：
 * - type: 'web_search_20250305'
 * - name: 'web_search'
 *
 * Server Tool 由 Anthropic 服务器执行，比客户端实现更可靠
 */
function buildApiTools(tools?: ToolDefinition[], toolSearchEnabled?: boolean): any[] | undefined {
  const apiTools: any[] = [];

  // 添加客户端工具
  if (tools && tools.length > 0) {
    for (const tool of tools) {
      const apiTool: any = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      };

      // v2.1.34: deferred tool 标记 defer_loading
      // 对齐官方 PP6 函数：if(q.deferLoading) z.defer_loading = true
      // 当 toolSearchEnabled 时，isMcp 的工具（已被发现并传给 API 的）标记为 defer_loading
      if (toolSearchEnabled && tool.isMcp) {
        apiTool.defer_loading = true;
      }

      apiTools.push(apiTool);
    }
  }

  // 始终添加 WebSearch Server Tool（对齐官方实现）
  const webSearchServerTool: WebSearchTool20250305 = {
    name: 'web_search',
    type: 'web_search_20250305',
  };
  apiTools.push(webSearchServerTool);

  // v5.0: 为最后一个工具添加 cache_control，缓存整个工具列表
  // 官方实现：cacheControl: D && YA === D ? cPA("global") : void 0
  if (apiTools.length > 0) {
    const lastTool = apiTools[apiTools.length - 1];
    lastTool.cache_control = { type: 'ephemeral' };
  }

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
    // 官方 Claude Code 的逻辑：zB() ? null : apiKey
    const authToken = config.authToken || process.env.ANTHROPIC_AUTH_TOKEN;
    // 如果有 authToken，则不使用 apiKey（官方逻辑）
    const apiKey = authToken ? null : (config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);

    if (!apiKey && !authToken) {
      console.error('[ClaudeClient] ERROR: No API key found!');
      console.error('[ClaudeClient] Please set ANTHROPIC_API_KEY environment variable or provide apiKey in config');
    }

    // 构建默认 headers（与官方 Claude Code 完全一致）
    // 官方 User-Agent 格式: claude-cli/${VERSION} (external, ${ENTRYPOINT}${agent-sdk})
    const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT || 'claude-vscode';
    const agentSdkVersion = process.env.CLAUDE_AGENT_SDK_VERSION;
    const agentSdkSuffix = agentSdkVersion ? `, agent-sdk/${agentSdkVersion}` : '';

    const defaultHeaders: Record<string, string> = {
      'x-app': 'cli',
      'User-Agent': `claude-cli/${VERSION_BASE} (external, ${entrypoint}${agentSdkSuffix})`,
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    // 如果使用 OAuth，标记模式
    if (authToken) {
      this.isOAuth = true;
      // 调试日志已移除，避免污染 UI 输出
    }
    // API key 模式无需日志

    const anthropicConfig: any = {
      apiKey: apiKey,  // OAuth 模式下为 null
      authToken: authToken || null,  // OAuth token
      baseURL: config.baseUrl,
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

    // 解析模型别名
    const resolvedModel = modelConfig.resolveAlias(config.model || 'sonnet');
    this.model = resolvedModel;

    // 根据模型能力设置 maxTokens
    const capabilities = modelConfig.getCapabilities(this.model);
    // SDK限制：maxTokens不能太大，否则会要求streaming
    // 计算公式：3600 * maxTokens / 128000 <= 600，即 maxTokens <= 21333
    // 使用21000作为安全默认值（留有余量）
    this.maxTokens = config.maxTokens || Math.min(21000, capabilities.maxOutputTokens);

    this.maxRetries = config.maxRetries ?? 2;
    this.retryDelay = config.retryDelay ?? 1000;

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

    if (this.debug) {
      console.log(`[ClaudeClient] Initialized with model: ${this.model}`);
      console.log(`[ClaudeClient] Context window: ${capabilities.contextWindow.toLocaleString()} tokens`);
      console.log(`[ClaudeClient] Supports thinking: ${capabilities.supportsThinking}`);
      if (this.fallbackModel) {
        console.log(`[ClaudeClient] Fallback model: ${this.fallbackModel}`);
      }
    }
  }

  /**
   * 执行带重试的请求
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const errorType = error.type || error.code || error.message || '';
      const errorStatus = error.status || error.statusCode || '';
      const isRetryable = RETRYABLE_ERRORS.some(
        (e) => errorType.includes(e) || error.message?.includes(e)
      );

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

      if (isRetryable && retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, retryCount); // 指数退避
        // v2.1.33: 改进错误消息，显示具体的连接失败原因
        const causeInfo = this.extractErrorCause(error);
        const errorDesc = causeInfo ? `${errorType} (${causeInfo})` : errorType;
        console.error(
          `[ClaudeClient] API error (${errorDesc}), retrying in ${delay}ms... (attempt ${retryCount + 1}/${this.maxRetries})`
        );
        await this.sleep(delay);
        return this.withRetry(operation, retryCount + 1);
      }

      // 401 错误：尝试刷新 OAuth token
      if (errorStatus === 401 && retryCount === 0) {
        const auth = getAuth();
        if (auth?.type === 'oauth' && auth.refreshToken) {
          console.log('[ClaudeClient] OAuth token expired, attempting refresh...');
          try {
            const refreshedAuth = await refreshTokenAsync(auth);
            if (refreshedAuth?.accessToken) {
              console.log('[ClaudeClient] OAuth token refreshed, retrying request...');
              // 重置默认客户端，以便下次获取新的 token
              resetDefaultClient();
              // 更新当前客户端的 authToken
              if (this.client) {
                // 创建新的客户端实例
                const newAuthToken = refreshedAuth.accessToken;
                const clientOptions: any = {
                  apiKey: null, // OAuth 模式不需要 apiKey
                  authToken: newAuthToken,
                  baseURL: this.client.baseURL,
                  maxRetries: 0,
                };
                // 保持代理配置（如果有）
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
              // 重试请求
              return this.withRetry(operation, retryCount + 1);
            }
          } catch (refreshError) {
            console.error('[ClaudeClient] OAuth token refresh failed:', refreshError);
          }
        }
        console.error('[ClaudeClient] Authentication failed - check your API key or login again');
      } else if (errorStatus === 401) {
        console.error('[ClaudeClient] Authentication failed after token refresh - please login again');
      } else if (errorStatus === 403) {
        console.error('[ClaudeClient] Access denied - check API key permissions');
      } else if (errorStatus === 400) {
        console.error('[ClaudeClient] Bad request - check your request parameters');
      } else {
        // v2.1.33: 改进错误消息，显示具体原因（如 ECONNREFUSED、SSL 错误等）
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

        // 格式化 system prompt（优先使用 blocks 分块缓存）
        const formattedSystem = formatSystemPrompt(systemPrompt, this.isOAuth, options?.promptBlocks);

        // 构建 API 工具列表（将 WebSearch 客户端工具替换为 Server Tool）
        const apiTools = buildApiTools(tools, options?.toolSearchEnabled);

        const requestParams: any = {
          model: currentModel,
          max_tokens: this.maxTokens,
          system: formattedSystem,
          // v5.0: 使用 formatMessages 启用消息缓存
          messages: formatMessages(messages, options?.enableThinking),
          tools: apiTools,
          // 添加 tool_choice 参数（强制 AI 使用工具）
          ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
          // 添加 betas 参数（官方 Claude Code 的关键）
          ...(betas.length > 0 ? { betas } : {}),
          // 添加 metadata（官方 Claude Code 的 Ja 函数）
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
      signal?: AbortSignal;
      toolChoice?: { type: 'auto' } | { type: 'any' } | { type: 'tool'; name: string };
      promptBlocks?: PromptBlock[];
      toolSearchEnabled?: boolean;
    }
  ): AsyncGenerator<{
    type: 'text' | 'thinking' | 'tool_use_start' | 'tool_use_delta' | 'server_tool_use_start' | 'web_search_result' | 'stop' | 'usage' | 'error' | 'response_headers';
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

      // 格式化 system prompt（优先使用 blocks 分块缓存）
      const formattedSystem = formatSystemPrompt(systemPrompt, this.isOAuth, options?.promptBlocks);

      // 构建 API 工具列表（将 WebSearch 客户端工具替换为 Server Tool）
      const apiTools = buildApiTools(tools, options?.toolSearchEnabled);

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
      }

      // 使用 beta.messages.stream 而不是 messages.stream（官方方式）
      stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: this.maxTokens,
        system: formattedSystem as any,
        // v5.0: 使用 formatMessages 启用消息缓存（传递 enableThinking 避免 thinking blocks 被误过滤）
        messages: formatMessages(messages, options?.enableThinking) as any,
        tools: apiTools as any,
        // 添加 toolChoice 支持（强制 AI 调用特定工具）
        ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
        // 添加 betas 参数（官方 Claude Code 的关键）
        ...(betas.length > 0 ? { betas } : {}),
        // 添加 metadata（官方 Claude Code 的 Ja 函数）
        metadata: buildMetadata(),
        // v2.1.31: 传递 temperature 到 streaming 路径
        // 修复 temperatureOverride 在 streaming API 路径被静默忽略的问题
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        // v2.1.36: Fast mode extra body 参数
        ...(isFastActive ? { [FAST_MODE_RESEARCH_PREVIEW]: 'active' } : {}),
        ...thinkingParams,
      } as any);
      return stream;
    };

    // 带重试的流创建
    while (retryCount <= maxStreamRetries) {
      try {
        stream = await attemptCreateStream();
        break; // 成功创建，跳出重试循环
      } catch (error: any) {
        const errorType = error.type || error.code || error.message || '';
        const errorStatus = error.status || error.statusCode || 0;

        // v2.1.33: 404 错误不再触发重试或 non-streaming fallback
        // 这修复了 API proxy 兼容性问题，404 表示端点不存在
        if (errorStatus === 404) {
          console.error('[ClaudeClient] Streaming endpoint returned 404 - endpoint not found');
          yield { type: 'error', error: `API endpoint returned 404: ${error.message}` };
          return;
        }

        const isRetryable = RETRYABLE_ERRORS.some(
          (e) => errorType.includes(e) || error.message?.includes(e)
        );

        if (isRetryable && retryCount < maxStreamRetries) {
          retryCount++;
          const delay = this.retryDelay * Math.pow(2, retryCount - 1);
          console.error(
            `[ClaudeClient] Stream creation failed (${errorType}), retrying in ${delay}ms... (attempt ${retryCount}/${maxStreamRetries})`
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

    try {
      for await (const event of stream) {
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

          // 提取 web_search_tool_result（Server Tool 的搜索结果在 finalMessage 中）
          if (finalMessage?.content) {
            for (const block of finalMessage.content) {
              if ((block as any).type === 'web_search_tool_result') {
                yield { type: 'web_search_result', data: block };
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
}

// 默认客户端实例 (延迟初始化以支持 OAuth)
let _defaultClient: ClaudeClient | null = null;

/**
 * 检查 OAuth scope 是否包含 user:inference
 * 官方 Claude Code 只有在有这个 scope 时才直接使用 OAuth token
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
          // 官方 Claude Code 在有此 scope 时直接使用 OAuth access token
          // 注意：auth.scope 或 auth.scopes 都可能存在
          const scopes = auth.scope || auth.scopes;
          if (hasInferenceScope(scopes)) {
            // 直接使用 OAuth access token 作为 authToken
            // 这是官方 Claude Code 的做法
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
