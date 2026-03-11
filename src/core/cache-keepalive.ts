/**
 * Prompt Cache Keepalive
 *
 * Anthropic prompt cache TTL = 5 分钟。工具执行超过 5 分钟时 cache 会过期，
 * 导致下次 API 调用产生完整的 cache miss + cache creation 费用。
 *
 * 本模块在工具执行期间定期发送轻量级 API 请求（max_tokens=1），
 * 使用相同的 system prompt 前缀来保持 cache 活跃。
 *
 * 成本：每次 ping ~1 output token（≈$0.000075 for opus），远低于 cache 重建成本。
 */

import Anthropic from '@anthropic-ai/sdk';
import { isPromptCachingEnabled } from './client.js';

/** Cache keepalive 配置 */
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;  // 4 分钟间隔（cache TTL 5分钟，留 1 分钟余量）
const KEEPALIVE_DELAY_MS = 3 * 60 * 1000;     // 工具执行 3 分钟后才开始 ping（避免短任务浪费）

interface KeepaliveState {
  timer: ReturnType<typeof setTimeout> | null;
  interval: ReturnType<typeof setInterval> | null;
  aborted: boolean;
  pingCount: number;
}

interface KeepaliveParams {
  /** Anthropic SDK client instance */
  client: Anthropic;
  /** 当前模型名称 */
  model: string;
  /** 格式化后的 system prompt（与主请求相同，确保 cache 前缀匹配） */
  formattedSystem: any;
  /** 是否启用 debug 日志 */
  debug?: boolean;
}

let activeState: KeepaliveState | null = null;

/**
 * 发送一次 cache ping
 *
 * 使用相同的 system prompt 前缀 + max_tokens=1 + 极短 messages，
 * 触发 Anthropic API 的 cache_read，从而刷新 cache TTL。
 */
async function sendCachePing(params: KeepaliveParams): Promise<void> {
  const { client, model, formattedSystem, debug } = params;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1,
      system: formattedSystem,
      messages: [{ role: 'user', content: 'ping' }],
    });

    const usage = response.usage;
    const cacheRead = (usage as any).cache_read_input_tokens || 0;
    const cacheCreation = (usage as any).cache_creation_input_tokens || 0;

    if (debug) {
      console.log(`[CacheKeepalive] Ping sent — cache_read: ${cacheRead}, cache_creation: ${cacheCreation}, output: ${usage.output_tokens}`);
    }

    // 如果 cache_read 很低而 cache_creation 很高，说明 cache 已经过期了，ping 来晚了
    if (cacheCreation > 0 && cacheRead === 0) {
      console.warn('[CacheKeepalive] Cache was already expired before ping. Consider reducing KEEPALIVE_DELAY_MS.');
    }
  } catch (err) {
    // ping 失败不应影响正常工具执行
    if (debug) {
      console.warn('[CacheKeepalive] Ping failed:', err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * 启动 cache keepalive
 *
 * 在工具执行开始时调用。会先等待 KEEPALIVE_DELAY_MS（默认 3 分钟），
 * 如果工具还在执行，则开始定期 ping。
 *
 * @returns 停止函数，在工具执行结束后调用
 */
export function startCacheKeepalive(params: KeepaliveParams): () => void {
  // 如果 prompt caching 未启用，不需要 keepalive
  if (!isPromptCachingEnabled(params.model)) {
    return () => {};
  }

  // 如果已有活跃的 keepalive，先停止
  if (activeState) {
    stopCacheKeepalive();
  }

  const state: KeepaliveState = {
    timer: null,
    interval: null,
    aborted: false,
    pingCount: 0,
  };
  activeState = state;

  // 延迟启动：只有长时间工具执行才需要 keepalive
  state.timer = setTimeout(() => {
    if (state.aborted) return;

    // 首次 ping
    sendCachePing(params).then(() => {
      state.pingCount++;
    });

    // 定期 ping
    state.interval = setInterval(() => {
      if (state.aborted) {
        if (state.interval) clearInterval(state.interval);
        return;
      }
      sendCachePing(params).then(() => {
        state.pingCount++;
      });
    }, KEEPALIVE_INTERVAL_MS);
  }, KEEPALIVE_DELAY_MS);

  // 返回停止函数
  return () => {
    state.aborted = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    if (state.pingCount > 0 && params.debug) {
      console.log(`[CacheKeepalive] Stopped after ${state.pingCount} ping(s)`);
    }
    if (activeState === state) {
      activeState = null;
    }
  };
}

/**
 * 强制停止所有活跃的 cache keepalive
 */
export function stopCacheKeepalive(): void {
  if (activeState) {
    activeState.aborted = true;
    if (activeState.timer) {
      clearTimeout(activeState.timer);
      activeState.timer = null;
    }
    if (activeState.interval) {
      clearInterval(activeState.interval);
      activeState.interval = null;
    }
    activeState = null;
  }
}
