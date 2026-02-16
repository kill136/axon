/**
 * AI Editor API
 *
 * 为代码编辑器提供 AI 驱动的增强功能
 * - 代码导游：分析代码结构，生成导游步骤
 * - 选中代码提问：基于代码上下文回答问题
 * - 代码复杂度热力图：分析每行代码的复杂度
 * - 重构建议：分析代码质量，提出重构建议
 * - AI 代码气泡注释：生成有价值的代码解释
 */

import { Router, Request, Response } from 'express';
import { ClaudeClient } from '../../../core/client.js';
import { configManager } from '../../../config/index.js';
import { getAuth } from '../../../auth/index.js';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';

const router = Router();

// ============================================================================
// 缓存配置
// ============================================================================

// 代码导游结果缓存
const tourCache = new LRUCache<string, TourResponse>({
  max: 500,
  ttl: 1000 * 60 * 15, // 15分钟
});

// 提问结果缓存
const askCache = new LRUCache<string, AskAIResponse>({
  max: 500,
  ttl: 1000 * 60 * 15,
});

// 热力图结果缓存
const heatmapCache = new LRUCache<string, HeatmapResponse>({
  max: 500,
  ttl: 1000 * 60 * 15,
});

// 重构建议结果缓存
const refactorCache = new LRUCache<string, RefactorResponse>({
  max: 500,
  ttl: 1000 * 60 * 15,
});

// 气泡注释结果缓存
const bubblesCache = new LRUCache<string, BubblesResponse>({
  max: 500,
  ttl: 1000 * 60 * 15,
});

// 防止重复请求
const pendingRequests = new Map<string, Promise<any>>();

// ============================================================================
// 类型定义
// ============================================================================

interface TourStep {
  type: 'file' | 'function' | 'class' | 'block';
  name: string;
  line: number;
  endLine?: number;
  description: string;
  importance: 'high' | 'medium' | 'low';
}

interface TourResponse {
  success: boolean;
  data?: {
    steps: TourStep[];
  };
  error?: string;
  fromCache?: boolean;
}

interface AskAIRequest {
  code: string;
  question: string;
  filePath?: string;
  context?: {
    language?: string;
  };
}

interface AskAIResponse {
  success: boolean;
  answer?: string;
  error?: string;
  fromCache?: boolean;
}

interface HeatmapData {
  line: number;
  complexity: number; // 0-100
  reason: string;
}

interface HeatmapRequest {
  filePath: string;
  content: string;
  language: string;
}

interface HeatmapResponse {
  success: boolean;
  heatmap: HeatmapData[];
  fromCache?: boolean;
  error?: string;
}

interface RefactorSuggestion {
  line: number;
  endLine: number;
  type: 'extract' | 'simplify' | 'rename' | 'unused' | 'duplicate' | 'performance' | 'safety';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

interface RefactorRequest {
  filePath: string;
  content: string;
  language: string;
}

interface RefactorResponse {
  success: boolean;
  suggestions: RefactorSuggestion[];
  fromCache?: boolean;
  error?: string;
}

interface AIBubble {
  line: number;
  message: string;
  type: 'info' | 'warning' | 'tip';
}

interface BubblesRequest {
  filePath: string;
  content: string;
  language: string;
}

interface BubblesResponse {
  success: boolean;
  bubbles: AIBubble[];
  fromCache?: boolean;
  error?: string;
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成内容哈希作为缓存键的一部分
 */
function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
}

/**
 * 初始化 Claude 客户端
 */
function createClient(): ClaudeClient | null {
  try {
    const auth = getAuth();
    const apiKey = auth?.apiKey || configManager.getApiKey();
    const authToken = auth?.type === 'oauth' ? (auth.accessToken || auth.authToken) : undefined;

    if (!apiKey && !authToken) {
      return null;
    }

    return new ClaudeClient({
      apiKey,
      authToken,
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      model: 'claude-haiku-4-5-20251001', // AI Editor 使用 haiku 以节省成本
    });
  } catch (error) {
    console.error('[AI Editor] 初始化客户端失败:', error);
    return null;
  }
}

/**
 * 调用 Claude API
 */
async function callClaude(prompt: string): Promise<string | null> {
  const client = createClient();
  if (!client) {
    throw new Error('API 客户端未初始化，请检查 API Key 配置');
  }

  try {
    const response = await client.createMessage(
      [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      undefined, // 无工具
      undefined, // 无 system prompt
      {
        enableThinking: false, // 快速响应
      }
    );

    const content = response.content?.[0];
    if (content?.type === 'text') {
      return content.text;
    }

    return null;
  } catch (error: any) {
    console.error('[AI Editor] API 调用失败:', error);
    throw error;
  }
}

/**
 * 从 AI 响应中提取 JSON
 */
function extractJSON(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('无法从响应中提取 JSON');
  }
  return JSON.parse(jsonMatch[0]);
}

// ============================================================================
// API 端点
// ============================================================================

/**
 * POST /tour - 代码导游
 */
router.post('/tour', async (req: Request, res: Response) => {
  try {
    const { filePath, content } = req.body;

    if (!filePath || !content) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: filePath 和 content',
      });
    }

    // 检查缓存
    const cacheKey = `tour:${filePath}:${hashContent(content)}`;
    const cached = tourCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在进行的相同请求
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      const result = await pending;
      return res.json({ ...result, fromCache: true });
    }

    // 创建新请求
    const requestPromise = (async (): Promise<TourResponse> => {
      const prompt = `你是一个专业的代码导游。请分析下方代码，提取重要的函数、类、组件等作为导游步骤。

## 代码文件: ${filePath}
\`\`\`
${content}
\`\`\`

## 输出要求
返回 JSON 格式，包含 steps 数组，每个步骤包含：
- type: 'file' | 'function' | 'class' | 'block'
- name: 名称
- line: 起始行号（从1开始）
- endLine: 结束行号（可选）
- description: 简短描述（中文，1-2句话）
- importance: 'high' | 'medium' | 'low'

只返回最重要的 5-10 个步骤，按行号排序。只输出 JSON，不要有其他内容。

示例：
{
  "steps": [
    {
      "type": "class",
      "name": "UserController",
      "line": 10,
      "endLine": 50,
      "description": "用户控制器，处理用户相关的 HTTP 请求",
      "importance": "high"
    }
  ]
}`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          data: {
            steps: parsed.steps || [],
          },
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'AI 分析失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        tourCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /tour 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /ask - 选中代码提问
 */
router.post('/ask', async (req: Request, res: Response) => {
  try {
    const { code, question, filePath, context }: AskAIRequest = req.body;

    if (!code || !question) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: code 和 question',
      });
    }

    // 检查缓存
    const cacheKey = `ask:${hashContent(code)}:${hashContent(question)}`;
    const cached = askCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在进行的相同请求
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      const result = await pending;
      return res.json({ ...result, fromCache: true });
    }

    // 创建新请求
    const requestPromise = (async (): Promise<AskAIResponse> => {
      const parts: string[] = [
        '你是一个专业的代码分析助手。用户选中了一段代码并提出问题，请基于代码上下文回答。',
        '',
        '## 用户问题',
        question,
        '',
        '## 代码上下文',
      ];

      if (filePath) {
        parts.push(`文件路径: ${filePath}`);
      }
      if (context?.language) {
        parts.push(`语言: ${context.language}`);
      }

      parts.push('```' + (context?.language || ''));
      parts.push(code);
      parts.push('```');
      parts.push('');
      parts.push('## 输出要求');
      parts.push('用中文回答，简洁明了，2-4句话。只输出答案文本，不要有额外格式。');

      const prompt = parts.join('\n');

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: '无法获取 AI 响应' };
        }

        return {
          success: true,
          answer: response.trim(),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'AI 分析失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        askCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /ask 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /heatmap - 代码复杂度热力图
 */
router.post('/heatmap', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language }: HeatmapRequest = req.body;

    if (!filePath || !content || !language) {
      return res.status(400).json({
        success: false,
        heatmap: [],
        error: '缺少必需参数: filePath, content 和 language',
      });
    }

    // 检查缓存
    const cacheKey = `heatmap:${filePath}:${hashContent(content)}`;
    const cached = heatmapCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在进行的相同请求
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      const result = await pending;
      return res.json({ ...result, fromCache: true });
    }

    // 创建新请求
    const requestPromise = (async (): Promise<HeatmapResponse> => {
      const prompt = `你是一个代码复杂度分析专家。请分析下方代码，为每一行代码评估复杂度分数（0-100）。

## 代码文件: ${filePath}
语言: ${language}

\`\`\`${language}
${content}
\`\`\`

## 评分标准
- 0-20: 简单语句（变量声明、简单赋值等）
- 21-40: 基础逻辑（if/for/while 单层）
- 41-60: 中等复杂度（嵌套逻辑、多条件判断）
- 61-80: 高复杂度（深层嵌套、复杂算法）
- 81-100: 极高复杂度（需要重构的代码）

## 输出要求
返回 JSON 格式，包含 heatmap 数组，只包含复杂度 > 30 的行：
{
  "heatmap": [
    {
      "line": 行号（从1开始）,
      "complexity": 复杂度分数（0-100）,
      "reason": "简短原因（中文，1句话）"
    }
  ]
}

只输出 JSON，不要有其他内容。`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, heatmap: [], error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          heatmap: parsed.heatmap || [],
        };
      } catch (error: any) {
        return {
          success: false,
          heatmap: [],
          error: error.message || 'AI 分析失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        heatmapCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /heatmap 请求处理失败:', error);
    res.status(500).json({
      success: false,
      heatmap: [],
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /refactor - 重构建议
 */
router.post('/refactor', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language }: RefactorRequest = req.body;

    if (!filePath || !content || !language) {
      return res.status(400).json({
        success: false,
        suggestions: [],
        error: '缺少必需参数: filePath, content 和 language',
      });
    }

    // 检查缓存
    const cacheKey = `refactor:${filePath}:${hashContent(content)}`;
    const cached = refactorCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在进行的相同请求
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      const result = await pending;
      return res.json({ ...result, fromCache: true });
    }

    // 创建新请求
    const requestPromise = (async (): Promise<RefactorResponse> => {
      const prompt = `你是一个代码质量专家。请分析下方代码，提出重构建议。

## 代码文件: ${filePath}
语言: ${language}

\`\`\`${language}
${content}
\`\`\`

## 分析维度
- extract: 可以提取的函数/方法
- simplify: 可以简化的逻辑
- rename: 命名不清晰的变量/函数
- unused: 未使用的代码
- duplicate: 重复代码
- performance: 性能问题
- safety: 安全隐患

## 输出要求
返回 JSON 格式，包含 suggestions 数组：
{
  "suggestions": [
    {
      "line": 起始行号（从1开始）,
      "endLine": 结束行号,
      "type": "extract" | "simplify" | "rename" | "unused" | "duplicate" | "performance" | "safety",
      "message": "建议描述（中文，1-2句话）",
      "priority": "high" | "medium" | "low"
    }
  ]
}

只返回最重要的 5-10 条建议。只输出 JSON，不要有其他内容。`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, suggestions: [], error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          suggestions: parsed.suggestions || [],
        };
      } catch (error: any) {
        return {
          success: false,
          suggestions: [],
          error: error.message || 'AI 分析失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        refactorCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /refactor 请求处理失败:', error);
    res.status(500).json({
      success: false,
      suggestions: [],
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /bubbles - AI 代码气泡注释
 */
router.post('/bubbles', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language }: BubblesRequest = req.body;

    if (!filePath || !content || !language) {
      return res.status(400).json({
        success: false,
        bubbles: [],
        error: '缺少必需参数: filePath, content 和 language',
      });
    }

    // 检查缓存
    const cacheKey = `bubbles:${filePath}:${hashContent(content)}`;
    const cached = bubblesCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在进行的相同请求
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      const result = await pending;
      return res.json({ ...result, fromCache: true });
    }

    // 创建新请求
    const requestPromise = (async (): Promise<BubblesResponse> => {
      const prompt = `你是一个代码解释专家。请为下方代码生成有价值的解释气泡，帮助读者理解代码。

## 代码文件: ${filePath}
语言: ${language}

\`\`\`${language}
${content}
\`\`\`

## 气泡类型
- info: 一般信息（代码作用、设计模式等）
- warning: 注意事项（边界条件、潜在问题等）
- tip: 优化建议（更好的写法、性能提示等）

## 输出要求
返回 JSON 格式，包含 bubbles 数组：
{
  "bubbles": [
    {
      "line": 行号（从1开始）,
      "message": "解释文本（中文，1-2句话，有价值的内容，避免废话）",
      "type": "info" | "warning" | "tip"
    }
  ]
}

只返回最有价值的 3-8 个气泡，避免显而易见的内容。只输出 JSON，不要有其他内容。`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, bubbles: [], error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          bubbles: parsed.bubbles || [],
        };
      } catch (error: any) {
        return {
          success: false,
          bubbles: [],
          error: error.message || 'AI 分析失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        bubblesCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /bubbles 请求处理失败:', error);
    res.status(500).json({
      success: false,
      bubbles: [],
      error: error.message || '服务器内部错误',
    });
  }
});

export default router;
