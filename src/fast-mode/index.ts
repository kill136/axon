/**
 * Fast Mode 核心模块
 *
 * 对齐官方 v2.1.36: Fast mode is now available for Opus 4.6
 * 对齐官方 v2.1.37: Fixed /fast not immediately available after /extra-usage
 *
 * Fast mode 的本质是同一个 Opus 4.6 模型，通过在 API 请求中设置
 * research_preview_2026_02: "active" 和特定 beta flag 来启用服务端快速输出管线。
 * 计费按 extra usage 的高级费率。遇到 429 速率限制时自动进入 cooldown 并降级到普通模式。
 *
 * 内部代号: "penguin"
 */

import { getProviderType } from './provider.js';

// ============================================================================
// 常量定义
// ============================================================================

/** Fast mode 强制使用的模型标识 */
export const FAST_MODE_MODEL = 'opus';

/** Fast mode 对应的模型显示名 */
export const FAST_MODE_DISPLAY_NAME = 'Opus 4.6';

/** Fast mode 计费说明 */
export const FAST_MODE_BILLING_NOTE = 'Billed at a premium rate';

/** Fast mode beta flag */
export const FAST_MODE_BETA = 'fast-mode-2026-02-06';

/** Fast mode extra body 参数 */
export const FAST_MODE_RESEARCH_PREVIEW = 'research_preview_2026_02';

/** 预检查间隔 (30秒) */
const PREFETCH_INTERVAL_MS = 30_000;

/** 默认 cooldown 延迟 (60秒) */
const DEFAULT_COOLDOWN_DELAY_MS = 60_000;

/** 最小 cooldown 延迟 (10秒) */
const MIN_COOLDOWN_DELAY_MS = 10_000;

// ============================================================================
// Cooldown 状态机
// ============================================================================

interface CooldownActive {
  status: 'active';
}

interface CooldownCooling {
  status: 'cooldown';
  resetAt: number;
}

type CooldownState = CooldownActive | CooldownCooling;

/** Cooldown 状态 */
let cooldownState: CooldownState = { status: 'active' };

/** cooldown 过期后是否已通知 */
let cooldownExpiredNotified = false;

/** Cooldown 事件监听器 */
export interface CooldownListener {
  onCooldownTriggered(resetAt: number): void;
  onCooldownExpired(): void;
}

const cooldownListeners = new Set<CooldownListener>();

/** Overage rejection 事件监听器 */
const overageListeners = new Set<(message: string) => void>();

// ============================================================================
// 组织级 Penguin Mode 状态
// ============================================================================

/** 组织级 penguin mode 启用状态 (undefined = 未检查) */
let orgPenguinEnabled: boolean | undefined;

/** 禁用原因 */
let disabledReason: string | null = null;

/** 上次预检查时间 */
let lastPrefetchTime = 0;

/** 组织状态变更监听器 */
const orgStatusListeners = new Set<(enabled: boolean) => void>();

// ============================================================================
// Feature Flag
// ============================================================================

/**
 * 检查 fast mode feature flag 是否启用（对齐官方 n4()）
 *
 * 官方使用 LaunchDarkly: y8("tengu_penguins_enabled", true)
 * 我们默认启用，除非被环境变量明确禁用
 */
export function isPenguinEnabled(): boolean {
  const envDisable = process.env.CLAUDE_CODE_DISABLE_FAST_MODE;
  if (envDisable === '1' || envDisable === 'true') return false;
  return true;
}

// ============================================================================
// 可用性检查
// ============================================================================

/**
 * 检查 fast mode 是否完全可用（对齐官方 C$()）
 */
export function isFastModeAvailable(): boolean {
  if (!isPenguinEnabled()) return false;
  return getUnavailableReason() === null;
}

/**
 * 获取不可用原因（对齐官方 W46()）
 * 返回 null 表示可用
 */
export function getUnavailableReason(): string | null {
  if (!isPenguinEnabled()) {
    return 'Fast mode is not available';
  }

  // 检查 provider: 只有 firstParty 支持
  const provider = getProviderType();
  if (provider !== 'firstParty') {
    return 'Fast mode is not available on Bedrock, Vertex, or Foundry';
  }

  // 检查禁用原因
  if (disabledReason) {
    return getDisabledReasonMessage(disabledReason);
  }

  return null;
}

/**
 * 将禁用原因映射为用户可读消息（对齐官方 GG5()）
 */
function getDisabledReasonMessage(reason: string): string {
  switch (reason) {
    case 'free':
      return 'Fast mode requires a paid subscription';
    case 'preference':
      return 'Fast mode has been disabled by your organization';
    case 'extra_usage_disabled':
      return 'Fast mode requires extra usage billing \u00b7 /extra-usage to enable';
    default:
      return 'Fast mode is not available';
  }
}

// ============================================================================
// 模型检查
// ============================================================================

/**
 * 检查模型是否支持 fast mode（对齐官方 X0()）
 */
export function isModelSupportsFastMode(model?: string | null): boolean {
  if (!isPenguinEnabled()) return false;
  const m = model ?? '';
  // 官方: i9(m).toLowerCase().includes("opus-4-6")
  return m.toLowerCase().includes('opus-4-6') || m.toLowerCase() === 'opus';
}

/**
 * 判断当前是否处于 fast mode（对齐官方 vt8()）
 */
export function isInFastMode(model: string | null, fastModeState: boolean): boolean {
  if (!isPenguinEnabled()) return false;
  if (!isFastModeAvailable()) return false;
  if (!isModelSupportsFastMode(model)) return false;
  return fastModeState === true;
}

// ============================================================================
// Cooldown 机制
// ============================================================================

/**
 * 检查并更新 cooldown 状态（对齐官方 A8A()）
 */
function checkCooldownState(): CooldownState {
  if (cooldownState.status === 'cooldown' && Date.now() >= cooldownState.resetAt) {
    if (isPenguinEnabled() && !cooldownExpiredNotified) {
      cooldownExpiredNotified = true;
      for (const listener of cooldownListeners) {
        listener.onCooldownExpired();
      }
    }
    cooldownState = { status: 'active' };
  }
  return cooldownState;
}

/**
 * 检查是否在 cooldown 中（对齐官方 nk()）
 */
export function isInCooldown(): boolean {
  return checkCooldownState().status === 'cooldown';
}

/**
 * 触发 cooldown（对齐官方 kt8()）
 */
export function triggerCooldown(resetAt: number): void {
  if (!isPenguinEnabled()) return;
  cooldownState = { status: 'cooldown', resetAt };
  cooldownExpiredNotified = false;
  const duration = resetAt - Date.now();
  for (const listener of cooldownListeners) {
    listener.onCooldownTriggered(resetAt);
  }
}

/**
 * 重置 cooldown（对齐官方 k81()）
 */
export function resetCooldown(): void {
  cooldownState = { status: 'active' };
}

// ============================================================================
// 状态管理
// ============================================================================

/** Fast mode 用户设置存储 */
let userFastModeSetting: boolean | undefined;

/**
 * 获取用户的 fast mode 设置
 */
export function getUserFastModeSetting(): boolean | undefined {
  return userFastModeSetting;
}

/**
 * 设置用户的 fast mode 设置（对齐官方 w7()）
 */
export function setUserFastModeSetting(enabled: boolean | undefined): void {
  userFastModeSetting = enabled;
}

/**
 * 切换 fast mode 的核心逻辑（对齐官方 Q9q() + xAz()）
 *
 * 返回提示信息
 */
export function toggleFastMode(
  enable: boolean,
  getCurrentModel: () => string | null,
  setModel: (model: string) => void,
  setFastModeState: (enabled: boolean) => void,
): string {
  resetCooldown();
  setUserFastModeSetting(enable ? true : undefined);

  if (enable) {
    // 开启 fast mode，如果当前不是 opus-4-6 则自动切换
    const currentModel = getCurrentModel();
    if (!isModelSupportsFastMode(currentModel)) {
      setModel(FAST_MODE_MODEL);
    }
    setFastModeState(true);
    return `Fast mode enabled (${FAST_MODE_DISPLAY_NAME})`;
  } else {
    setFastModeState(false);
    return 'Fast mode disabled';
  }
}

// ============================================================================
// Overage/Extra Usage 处理
// ============================================================================

/**
 * 映射 overage 拒绝原因（对齐官方 PG5()）
 */
function getOverageRejectionMessage(reason: string | null): string {
  switch (reason) {
    case 'out_of_credits':
      return 'Fast mode disabled \u00b7 extra usage credits exhausted';
    case 'org_level_disabled':
    case 'org_service_level_disabled':
      return 'Fast mode disabled \u00b7 extra usage disabled by your organization';
    case 'org_level_disabled_until':
      return 'Fast mode disabled \u00b7 extra usage temporarily unavailable';
    case 'member_level_disabled':
      return 'Fast mode disabled \u00b7 extra usage disabled for your account';
    case 'seat_tier_level_disabled':
    case 'seat_tier_zero_credit_limit':
    case 'member_zero_credit_limit':
      return 'Fast mode disabled \u00b7 extra usage not available for your plan';
    case 'overage_not_provisioned':
    case 'no_limits_configured':
      return 'Fast mode requires extra usage billing \u00b7 /extra-usage to enable';
    default:
      return 'Fast mode disabled \u00b7 extra usage not available';
  }
}

/**
 * 处理 overage 拒绝（对齐官方 yt8()）
 */
export function handleOverageRejection(
  reason: string | null,
  setFastModeState: (enabled: boolean) => void,
): string {
  const message = getOverageRejectionMessage(reason);
  setUserFastModeSetting(undefined);
  setFastModeState(false);
  orgPenguinEnabled = false;
  for (const listener of overageListeners) {
    listener(message);
  }
  return message;
}

// ============================================================================
// 组织级预检查
// ============================================================================

/**
 * 检查 API 返回的 penguin mode 状态（对齐官方 G46()）
 *
 * v2.1.37 修复: 在 /extra-usage enable 后立即重新检查
 */
export async function prefetchPenguinMode(
  authInfo?: { accessToken?: string; apiKey?: string },
  force?: boolean,
): Promise<void> {
  if (!isPenguinEnabled()) return;

  const now = Date.now();
  if (!force && now - lastPrefetchTime < PREFETCH_INTERVAL_MS) return;
  lastPrefetchTime = now;

  // 如果没有认证信息，尝试从环境变量获取
  const apiKey = authInfo?.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  const accessToken = authInfo?.accessToken;
  if (!apiKey && !accessToken) return;

  try {
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const url = `${baseUrl}/api/claude_code_penguin_mode`;
    const headers: Record<string, string> = accessToken
      ? { 'Authorization': `Bearer ${accessToken}` }
      : { 'x-api-key': apiKey! };

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      orgPenguinEnabled = false;
      disabledReason = null;
      return;
    }

    const result = await response.json() as { enabled: boolean; disabled_reason?: string };
    const wasEnabled = orgPenguinEnabled;
    orgPenguinEnabled = result.enabled;
    disabledReason = result.disabled_reason ?? null;

    if (wasEnabled !== result.enabled) {
      if (!result.enabled) {
        setUserFastModeSetting(undefined);
      }
      for (const listener of orgStatusListeners) {
        listener(result.enabled);
      }
    }
  } catch {
    // 网络错误时不更改状态，保持上次的值
    // 如果是首次检查失败，默认设为可用（不阻塞用户）
    if (orgPenguinEnabled === undefined) {
      orgPenguinEnabled = true;
    }
  }
}

/**
 * v2.1.37: 强制重新检查 penguin mode（用于 /extra-usage enable 后）
 */
export async function forcePrefetchPenguinMode(
  authInfo?: { accessToken?: string; apiKey?: string },
): Promise<void> {
  lastPrefetchTime = 0; // 清除时间限制
  await prefetchPenguinMode(authInfo, true);
}

// ============================================================================
// API 集成
// ============================================================================

/**
 * 检查 fast mode 是否应该激活（用于 API 请求构建）
 * 对齐官方的 isFastMode 条件检查
 */
export function shouldActivateFastMode(
  model: string,
  fastModeState: boolean,
): boolean {
  return isPenguinEnabled()
    && !isInCooldown()
    && isFastModeAvailable()
    && isModelSupportsFastMode(model)
    && fastModeState === true;
}

/**
 * 检查是否为 fast mode 特定的 400 错误
 * 对齐官方 _79()
 */
export function isFastModeNotEnabledError(error: any): boolean {
  if (!error) return false;
  const status = error.status ?? error.statusCode;
  const message = error.message ?? '';
  return status === 400 && message.includes('Fast mode is not enabled');
}

/**
 * 永久禁用 fast mode（当服务端返回 fast mode not enabled 错误时）
 */
export function permanentlyDisableFastMode(): void {
  setUserFastModeSetting(undefined);
  orgPenguinEnabled = false;
}

// ============================================================================
// 定价
// ============================================================================

/** 普通 Opus 定价（每百万 token，美元） */
export const OPUS_PRICING = {
  inputTokens: 15,
  outputTokens: 75,
  promptCacheWriteTokens: 18.75,
  promptCacheReadTokens: 1.5,
};

/** Fast mode 标准定价（每百万 token，美元） */
export const FAST_MODE_PRICING = {
  inputTokens: 30,
  outputTokens: 150,
  promptCacheWriteTokens: 37.5,
  promptCacheReadTokens: 3,
};

/** Fast mode 1M 上下文定价（每百万 token，美元） */
export const FAST_MODE_1M_PRICING = {
  inputTokens: 60,
  outputTokens: 225,
  promptCacheWriteTokens: 75,
  promptCacheReadTokens: 6,
};

// ============================================================================
// 监听器管理
// ============================================================================

export function addCooldownListener(listener: CooldownListener): () => void {
  cooldownListeners.add(listener);
  return () => cooldownListeners.delete(listener);
}

export function addOverageListener(listener: (message: string) => void): () => void {
  overageListeners.add(listener);
  return () => overageListeners.delete(listener);
}

export function addOrgStatusListener(listener: (enabled: boolean) => void): () => void {
  orgStatusListeners.add(listener);
  return () => orgStatusListeners.delete(listener);
}
