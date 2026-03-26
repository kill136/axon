/**
 * Embedding 提供商接口和 OpenAI 兼容实现
 * 支持 OpenAI、DeepSeek、硅基流动等 OpenAI 兼容 API
 */

import * as crypto from 'crypto';

/**
 * Embedding 提供商接口
 */
export interface EmbeddingProvider {
  id: string;
  model: string;
  dimensions: number;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * Embedding 提供商配置
 */
export interface EmbeddingProviderConfig {
  apiKey: string;
  baseUrl?: string;       // 默认 https://api.openai.com/v1
  model?: string;         // 默认 text-embedding-3-small
  dimensions?: number;    // 默认 1536
}

// 常见模型的默认维度
const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
  'text-embedding-ada-002': 1536,
  // Ollama models
  'embeddinggemma:300m': 768,
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
  'all-minilm': 384,
  'snowflake-arctic-embed': 1024,
};

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const BATCH_SIZE = 20; // 每批最多 20 个文本
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;

function isTransientEmbeddingError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('fetch failed')
    || message.includes('terminated')
    || message.includes('other side closed')
    || message.includes('socket')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('econnreset')
    || message.includes('und_err_socket')
    || message.includes('aborterror');
}

/**
 * 归一化向量
 */
function normalizeVector(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return vec;
  return vec.map(v => v / magnitude);
}

/**
 * 创建 OpenAI 兼容的 Embedding 提供商
 */
export function createOpenAIEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  const model = config.model || DEFAULT_MODEL;
  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const dimensions = config.dimensions || MODEL_DIMENSIONS[model] || 1536;
  const url = `${baseUrl}/embeddings`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
  };

  async function embed(input: string[]): Promise<number[][]> {
    if (input.length === 0) return [];

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ model, input }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 200)}`);
        }

        const data = await response.json() as {
          data: Array<{ embedding: number[]; index: number }>;
        };

        // 按 index 排序（API 不保证顺序）
        const sorted = data.data.sort((a, b) => a.index - b.index);
        return sorted.map(d => normalizeVector(d.embedding));
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_RETRIES || !isTransientEmbeddingError(error)) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Embedding request failed');
  }

  return {
    id: 'openai',
    model,
    dimensions,

    async embedQuery(text: string): Promise<number[]> {
      const [vec] = await embed([text]);
      return vec || [];
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      if (texts.length <= BATCH_SIZE) {
        return embed(texts);
      }

      // 分批处理
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchResults = await embed(batch);
        results.push(...batchResults);
      }
      return results;
    },
  };
}

/**
 * 计算 embedding 缓存 key
 */
export function embeddingCacheKey(model: string, text: string): string {
  return crypto.createHash('sha256').update(`${model}:${text}`).digest('hex');
}

/**
 * 计算余弦相似度（降级用，sqlite-vec 不可用时在内存中计算）
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
