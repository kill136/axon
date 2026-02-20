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
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

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

// Intent-to-Code 结果缓存
const intentCache = new LRUCache<string, IntentToCodeResponse>({
  max: 500,
  ttl: 1000 * 60 * 15,
});

// Code Review 结果缓存
const reviewCache = new LRUCache<string, CodeReviewResponse>({
  max: 500,
  ttl: 1000 * 60 * 15,
});

// Test Generator 结果缓存
const testGenCache = new LRUCache<string, GenerateTestResponse>({
  max: 200,
  ttl: 1000 * 60 * 15,
});

// Smart Diff 结果缓存
const smartDiffCache = new LRUCache<string, SmartDiffResponse>({
  max: 200,
  ttl: 1000 * 60 * 10, // 10分钟
});

// Dead Code 结果缓存
const deadCodeCache = new LRUCache<string, DeadCodeResponse>({
  max: 500,
  ttl: 1000 * 60 * 15, // 15分钟
});

// Time Machine 结果缓存
const timeMachineCache = new LRUCache<string, TimeMachineResponse>({
  max: 200,
  ttl: 1000 * 60 * 15, // 15分钟
});

// Pattern Detector 结果缓存
const patternCache = new LRUCache<string, PatternDetectorResponse>({
  max: 300,
  ttl: 1000 * 60 * 15, // 15分钟
});

// API Doc 结果缓存
const apiDocCache = new LRUCache<string, ApiDocResponse>({
  max: 500,
  ttl: 1000 * 60 * 30, // 30分钟（API文档不常变）
});

// Inline Complete 结果缓存
const inlineCompleteCache = new LRUCache<string, { completion: string }>({
  max: 200,
  ttl: 1000 * 60 * 5, // 5分钟（代码上下文变化快）
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

interface IntentToCodeRequest {
  filePath: string;
  code: string;
  intent: string;
  language: string;
  mode: 'rewrite' | 'generate';
}

interface IntentToCodeResponse {
  success: boolean;
  code?: string;
  explanation?: string;
  error?: string;
  fromCache?: boolean;
}

interface CodeReviewIssue {
  line: number;
  endLine: number;
  type: 'bug' | 'performance' | 'security' | 'style';
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

interface CodeReviewRequest {
  filePath: string;
  content: string;
  language: string;
}

interface CodeReviewResponse {
  success: boolean;
  issues: CodeReviewIssue[];
  summary?: string;
  fromCache?: boolean;
  error?: string;
}

interface GenerateTestRequest {
  filePath: string;
  code: string;
  functionName: string;
  language: string;
  framework?: string;
}

interface GenerateTestResponse {
  success: boolean;
  testCode?: string;
  testFramework?: string;
  testCount?: number;
  explanation?: string;
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
  // 1. 尝试从 markdown 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    const inner = codeBlockMatch[1].trim();
    try {
      return JSON.parse(inner);
    } catch {}
  }

  // 2. 尝试匹配最外层 JSON 对象（使用大括号计数而非贪婪正则）
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('无法从响应中提取 JSON');
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) return JSON.parse(text.slice(firstBrace, i + 1)); }
  }

  // 3. fallback: 贪婪正则
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

/**
 * POST /intent-to-code - Intent-to-Code (意图编程)
 */
router.post('/intent-to-code', async (req: Request, res: Response) => {
  try {
    const { filePath, code, intent, language, mode }: IntentToCodeRequest = req.body;

    if (!filePath || !code || !intent || !language || !mode) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: filePath, code, intent, language 和 mode',
      });
    }

    // 检查缓存
    const cacheKey = `intent:${hashContent(code)}:${hashContent(intent)}:${mode}`;
    const cached = intentCache.get(cacheKey);
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
    const requestPromise = (async (): Promise<IntentToCodeResponse> => {
      let prompt = '';

      if (mode === 'rewrite') {
        prompt = `你是一个专业的代码编写助手。用户选中了一段代码，并提出了修改意图，请按照意图改写代码。

## 原代码
文件路径: ${filePath}
语言: ${language}

\`\`\`${language}
${code}
\`\`\`

## 用户意图
${intent}

## 输出要求
返回 JSON 格式：
{
  "code": "改写后的完整代码（保持格式和风格）",
  "explanation": "简短说明改动了什么（中文，1-2句话）"
}

只输出 JSON，不要有其他内容。`;
      } else {
        // generate 模式
        prompt = `你是一个专业的代码编写助手。用户在代码注释后要求生成代码，请根据意图生成代码。

## 上下文
文件路径: ${filePath}
语言: ${language}
注释内容: ${code}

## 用户意图
${intent}

## 输出要求
返回 JSON 格式：
{
  "code": "生成的代码（格式规范，可直接使用）",
  "explanation": "简短说明生成了什么（中文，1-2句话）"
}

只输出 JSON，不要有其他内容。`;
      }

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          code: parsed.code || '',
          explanation: parsed.explanation || '',
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'AI 生成失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        intentCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /intent-to-code 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /code-review - AI Code Review (代码审查)
 */
router.post('/code-review', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language }: CodeReviewRequest = req.body;

    if (!filePath || !content || !language) {
      return res.status(400).json({
        success: false,
        issues: [],
        error: '缺少必需参数: filePath, content 和 language',
      });
    }

    // 检查缓存
    const cacheKey = `review:${filePath}:${hashContent(content)}`;
    const cached = reviewCache.get(cacheKey);
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
    const requestPromise = (async (): Promise<CodeReviewResponse> => {
      const prompt = `你是一个代码审查专家。请分析下方代码，找出潜在问题，按类型分类。

## 代码文件: ${filePath}
语言: ${language}

\`\`\`${language}
${content}
\`\`\`

## 问题分类
- bug: 潜在 bug（空指针、未初始化变量、竞态条件、边界条件等）
- performance: 性能问题（N+1查询、不必要的渲染、内存泄漏、低效算法等）
- security: 安全隐患（注入漏洞、XSS、敏感信息泄露、不安全的随机数等）
- style: 代码风格和最佳实践（命名规范、代码重复、可读性、设计模式等）

## 严重程度
- error: 严重问题，必须修复
- warning: 警告，建议修复
- info: 信息提示，可选优化

## 输出要求
返回 JSON 格式：
{
  "issues": [
    {
      "line": 起始行号（从1开始）,
      "endLine": 结束行号,
      "type": "bug" | "performance" | "security" | "style",
      "severity": "error" | "warning" | "info",
      "message": "问题描述（中文，1句话）",
      "suggestion": "修复建议（中文，1句话，可选）"
    }
  ],
  "summary": "整体代码质量总结（中文，2-3句话）"
}

只返回最重要的 5-15 个问题。只输出 JSON，不要有其他内容。`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, issues: [], error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          issues: parsed.issues || [],
          summary: parsed.summary || '',
        };
      } catch (error: any) {
        return {
          success: false,
          issues: [],
          error: error.message || 'AI 分析失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        reviewCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /code-review 请求处理失败:', error);
    res.status(500).json({
      success: false,
      issues: [],
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /generate-test - Test Generator (测试生成)
 */
router.post('/generate-test', async (req: Request, res: Response) => {
  try {
    const { filePath, code, functionName, language, framework }: GenerateTestRequest = req.body;

    if (!filePath || !code || !functionName || !language) {
      return res.status(400).json({
        success: false,
        error: '缺少必需参数: filePath, code, functionName 和 language',
      });
    }

    // 检查缓存
    const cacheKey = `testgen:${hashContent(code)}:${functionName}:${language}`;
    const cached = testGenCache.get(cacheKey);
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
    const requestPromise = (async (): Promise<GenerateTestResponse> => {
      // 自动检测测试框架
      const detectFramework = (lang: string): string => {
        const frameworks: Record<string, string> = {
          'typescript': 'vitest',
          'javascript': 'vitest',
          'python': 'pytest',
          'go': 'testing',
          'rust': 'rust-test',
          'java': 'junit',
        };
        return frameworks[lang] || 'vitest';
      };

      const testFramework = framework || detectFramework(language);

      const prompt = `你是一个测试代码生成专家。请为下方函数生成完整的单元测试。

## 函数代码
文件路径: ${filePath}
语言: ${language}
函数名: ${functionName}

\`\`\`${language}
${code}
\`\`\`

## 测试要求
- 测试框架: ${testFramework}
- 覆盖正常情况、边界条件、异常情况
- 测试代码要完整可运行，包含必要的 import 和 setup
- 测试用例命名清晰
- 每个测试一个独立的 test case

## 输出要求
返回 JSON 格式：
{
  "testCode": "完整的测试文件代码",
  "testFramework": "${testFramework}",
  "testCount": 测试用例数量（数字）,
  "explanation": "测试覆盖了哪些场景（中文，1-2句话）"
}

只输出 JSON，不要有其他内容。`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: '无法获取 AI 响应' };
        }

        const parsed = extractJSON(response);
        return {
          success: true,
          testCode: parsed.testCode || '',
          testFramework: parsed.testFramework || testFramework,
          testCount: parsed.testCount || 0,
          explanation: parsed.explanation || '',
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'AI 生成失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        testGenCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /generate-test 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

// ============================================================================
// Smart Diff API - 语义 Diff 分析
// ============================================================================

/**
 * Smart Diff Change
 */
interface SmartDiffChange {
  type: 'added' | 'removed' | 'modified';
  description: string;
  risk?: string;
}

/**
 * Smart Diff 请求体
 */
interface SmartDiffRequest {
  filePath: string;
  language: string;
  originalContent: string;
  modifiedContent: string;
}

/**
 * Smart Diff 响应
 */
interface SmartDiffResponse {
  success: boolean;
  analysis?: {
    summary: string;
    impact: 'safe' | 'warning' | 'danger';
    changes: SmartDiffChange[];
    warnings: string[];
  };
  fromCache?: boolean;
  error?: string;
}

/**
 * POST /api/ai-editor/smart-diff
 * 分析代码改动的语义影响
 */
router.post('/smart-diff', async (req: Request, res: Response) => {
  try {
    const { filePath, language, originalContent, modifiedContent }: SmartDiffRequest = req.body;

    // 参数验证
    if (!filePath || !originalContent || !modifiedContent) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数 (filePath, originalContent, modifiedContent)',
      });
    }

    // 生成缓存键
    const cacheKey = crypto
      .createHash('md5')
      .update(`smart-diff:${filePath}:${originalContent}:${modifiedContent}`)
      .digest('hex');

    // 检查缓存
    const cached = smartDiffCache.get(cacheKey);
    if (cached) {
      console.log(`[AI Editor] /smart-diff 命中缓存: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /smart-diff 请求已在处理中，复用: ${cacheKey}`);
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    // 创建新请求
    const requestPromise = (async (): Promise<SmartDiffResponse> => {
      try {
        const client = createClient();
        if (!client) {
          return {
            success: false,
            error: 'API 客户端未初始化，请检查 API Key 配置',
          };
        }

        const prompt = `请分析以下代码改动的语义影响。

文件路径: ${filePath}
编程语言: ${language}

原始代码:
\`\`\`${language}
${originalContent}
\`\`\`

修改后代码:
\`\`\`${language}
${modifiedContent}
\`\`\`

请分析：
1. 改动摘要（summary）：简要说明这次改动做了什么
2. 风险等级（impact）：safe（安全，无风险）、warning（有潜在问题需注意）、danger（危险，可能引入 bug）
3. 具体改动列表（changes）：每个改动包含 type（added/removed/modified）、description（语义描述）、risk（可选，风险提示）
4. 警告列表（warnings）：列出所有潜在问题

请以 JSON 格式返回，格式如下：
{
  "summary": "改动摘要",
  "impact": "safe" | "warning" | "danger",
  "changes": [
    { "type": "added" | "removed" | "modified", "description": "语义描述", "risk": "可选风险提示" }
  ],
  "warnings": ["警告1", "警告2"]
}`;

        console.log(`[AI Editor] /smart-diff 调用 Claude: ${filePath}`);

        const response = await client.createMessage(
          [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          undefined, // 无工具
          undefined, // 无 system prompt
          { enableThinking: false }
        );

        const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';

        if (!rawText) {
          return {
            success: false,
            error: 'AI 未返回有效分析结果',
          };
        }

        // 尝试解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !parsed.summary || !parsed.impact) {
          console.error('[AI Editor] /smart-diff 无法解析 AI 返回的 JSON:', rawText);
          return {
            success: false,
            error: 'AI 返回格式不正确',
          };
        }

        return {
          success: true,
          analysis: {
            summary: parsed.summary,
            impact: parsed.impact,
            changes: parsed.changes || [],
            warnings: parsed.warnings || [],
          },
        };
      } catch (error: any) {
        console.error('[AI Editor] /smart-diff AI 调用失败:', error);
        return {
          success: false,
          error: error.message || 'AI 调用失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        smartDiffCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /smart-diff 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

// ============================================================================
// Dead Code Detection API - 死代码检测
// ============================================================================

/**
 * Dead Code Item
 */
interface DeadCodeItem {
  line: number;
  endLine: number;
  type: 'unused' | 'unreachable' | 'redundant' | 'suspicious';
  name: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Dead Code 请求体
 */
interface DeadCodeRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Dead Code 响应
 */
interface DeadCodeResponse {
  success: boolean;
  deadCode: DeadCodeItem[];
  summary?: string;
  fromCache?: boolean;
  error?: string;
}

// ============================================================================
// 第三批 AI 功能类型定义
// ============================================================================

/**
 * Time Machine Commit
 */
interface TimeMachineCommit {
  hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

/**
 * Time Machine Key Change
 */
interface TimeMachineKeyChange {
  date: string;
  description: string;
}

/**
 * Time Machine 请求体
 */
interface TimeMachineRequest {
  filePath: string;
  content: string;
  language: string;
  selectedCode?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Time Machine 响应
 */
interface TimeMachineResponse {
  success: boolean;
  history?: {
    commits: TimeMachineCommit[];
    story: string;
    keyChanges: TimeMachineKeyChange[];
  };
  fromCache?: boolean;
  error?: string;
}

/**
 * Pattern Location
 */
interface PatternLocation {
  line: number;
  endLine: number;
}

/**
 * Detected Pattern
 */
interface DetectedPattern {
  type: 'duplicate' | 'similar-logic' | 'extract-candidate' | 'design-pattern';
  name: string;
  locations: PatternLocation[];
  description: string;
  suggestion: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * Pattern Detector 请求体
 */
interface PatternDetectorRequest {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Pattern Detector 响应
 */
interface PatternDetectorResponse {
  success: boolean;
  patterns: DetectedPattern[];
  summary?: string;
  fromCache?: boolean;
  error?: string;
}

/**
 * API Doc Param
 */
interface ApiDocParam {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
}

/**
 * API Doc Result
 */
interface ApiDocResult {
  name: string;
  package: string;
  brief: string;
  params?: ApiDocParam[];
  returns?: {
    type: string;
    description: string;
  };
  examples: string[];
  pitfalls: string[];
  seeAlso: string[];
}

/**
 * API Doc 请求体
 */
interface ApiDocRequest {
  symbolName: string;
  packageName?: string;
  language: string;
  codeContext: string;
}

/**
 * API Doc 响应
 */
interface ApiDocResponse {
  success: boolean;
  doc?: ApiDocResult;
  fromCache?: boolean;
  error?: string;
}

/**
 * POST /api/ai-editor/dead-code
 * 检测代码中的死代码
 */
router.post('/dead-code', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language }: DeadCodeRequest = req.body;

    // 参数验证
    if (!filePath || !content) {
      return res.status(400).json({
        success: false,
        deadCode: [],
        error: '缺少必要参数 (filePath, content)',
      });
    }

    // 生成缓存键
    const cacheKey = crypto
      .createHash('md5')
      .update(`dead-code:${filePath}:${content}`)
      .digest('hex');

    // 检查缓存
    const cached = deadCodeCache.get(cacheKey);
    if (cached) {
      console.log(`[AI Editor] /dead-code 命中缓存: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /dead-code 请求已在处理中，复用: ${cacheKey}`);
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    // 创建新请求
    const requestPromise = (async (): Promise<DeadCodeResponse> => {
      try {
        const client = createClient();
        if (!client) {
          return {
            success: false,
            deadCode: [],
            error: 'API 客户端未初始化，请检查 API Key 配置',
          };
        }

        const prompt = `请分析以下代码中的死代码（dead code）。

文件路径: ${filePath}
编程语言: ${language}

代码内容:
\`\`\`${language}
${content}
\`\`\`

请检测以下类型的死代码：
1. unused: 未使用的变量、函数、导入
2. unreachable: 不可达代码（如 return 后的代码）
3. redundant: 冗余代码（重复赋值、永真条件等）
4. suspicious: 导出了但可能整个项目没人使用（单文件分析无法确定，标记为可疑）

对于每个死代码，返回：
- line: 起始行号
- endLine: 结束行号
- type: 类型（unused/unreachable/redundant/suspicious）
- name: 变量/函数/导入名
- reason: 为什么被判定为死代码
- confidence: 置信度（high/medium/low）

请以 JSON 格式返回，格式如下：
{
  "deadCode": [
    {
      "line": 10,
      "endLine": 12,
      "type": "unused",
      "name": "unusedVar",
      "reason": "变量声明后从未使用",
      "confidence": "high"
    }
  ],
  "summary": "检测到 N 个死代码"
}

如果没有死代码，返回空数组。`;

        console.log(`[AI Editor] /dead-code 调用 Claude: ${filePath}`);

        const response = await client.createMessage(
          [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          undefined, // 无工具
          undefined, // 无 system prompt
          { enableThinking: false }
        );

        const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';

        if (!rawText) {
          return {
            success: false,
            deadCode: [],
            error: 'AI 未返回有效分析结果',
          };
        }

        // 尝试解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !Array.isArray(parsed.deadCode)) {
          console.error('[AI Editor] /dead-code 无法解析 AI 返回的 JSON:', rawText);
          return {
            success: false,
            deadCode: [],
            error: 'AI 返回格式不正确',
          };
        }

        return {
          success: true,
          deadCode: parsed.deadCode,
          summary: parsed.summary || `检测到 ${parsed.deadCode.length} 个死代码`,
        };
      } catch (error: any) {
        console.error('[AI Editor] /dead-code AI 调用失败:', error);
        return {
          success: false,
          deadCode: [],
          error: error.message || 'AI 调用失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        deadCodeCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /dead-code 请求处理失败:', error);
    res.status(500).json({
      success: false,
      deadCode: [],
      error: error.message || '服务器内部错误',
    });
  }
});

// ============================================================================
// Code Conversation API - 多轮代码对话
// ============================================================================

/**
 * Code Conversation 请求体
 */
interface ConversationRequest {
  filePath: string;
  language: string;
  codeContext: string;
  cursorLine?: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
}

/**
 * Code Conversation 响应
 */
interface ConversationResponse {
  success: boolean;
  answer?: string;
  error?: string;
}

/**
 * POST /api/ai-editor/conversation
 * 多轮代码对话，支持历史上下文
 */
router.post('/conversation', async (req: Request, res: Response) => {
  try {
    const { filePath, language, codeContext, cursorLine, messages, question }: ConversationRequest = req.body;

    // 参数验证
    if (!filePath || !codeContext || !question) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数 (filePath, codeContext, question)',
      });
    }

    // 生成缓存键（不缓存，但用于防重）
    const cacheKey = crypto
      .createHash('md5')
      .update(`conversation:${filePath}:${JSON.stringify(messages)}:${question}`)
      .digest('hex');

    // 检查是否有正在处理的相同请求（防重）
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /conversation 请求已在处理中，复用: ${cacheKey}`);
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    // 创建新请求
    const requestPromise = (async (): Promise<ConversationResponse> => {
      try {
        const client = createClient();
        if (!client) {
          return {
            success: false,
            error: 'API 客户端未初始化，请检查 API Key 配置',
          };
        }

        // 构建 system prompt
        const systemPrompt = `你是一个专业的代码助手。用户正在查看以下文件：

文件路径: ${filePath}
编程语言: ${language}
${cursorLine ? `光标行号: ${cursorLine}` : ''}

当前代码上下文:
\`\`\`${language}
${codeContext}
\`\`\`

请基于上述代码上下文，回答用户的问题。如果用户提到"这段代码"、"当前位置"等，请参考上述代码上下文。`;

        // 构建消息列表
        const conversationMessages = [
          ...messages.map(msg => ({
            role: msg.role,
            content: [{ type: 'text' as const, text: msg.content }],
          })),
          {
            role: 'user' as const,
            content: [{ type: 'text' as const, text: question }],
          },
        ];

        console.log(`[AI Editor] /conversation 调用 Claude: ${filePath}, ${conversationMessages.length} 条消息`);

        // 调用 Claude API
        const response = await client.createMessage(
          conversationMessages,
          undefined, // 无工具
          systemPrompt, // system prompt
          { enableThinking: false }
        );

        const answer = response.content[0]?.type === 'text' ? response.content[0].text : '';

        if (!answer) {
          return {
            success: false,
            error: 'AI 未返回有效回答',
          };
        }

        return {
          success: true,
          answer,
        };
      } catch (error: any) {
        console.error('[AI Editor] /conversation AI 调用失败:', error);
        return {
          success: false,
          error: error.message || 'AI 调用失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /conversation 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

// ============================================================================
// 第三批 AI 功能 API 端点
// ============================================================================

/**
 * POST /api/ai-editor/time-machine
 * 代码时光机：分析代码的 git 历史演变
 */
router.post('/time-machine', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language, selectedCode, startLine, endLine }: TimeMachineRequest = req.body;

    // 参数验证
    if (!filePath || !content) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数 (filePath, content)',
      });
    }

    // 生成缓存键
    const cacheKey = crypto
      .createHash('md5')
      .update(`time-machine:${filePath}:${selectedCode || content}:${startLine}:${endLine}`)
      .digest('hex');

    // 检查缓存
    const cached = timeMachineCache.get(cacheKey);
    if (cached) {
      console.log(`[AI Editor] /time-machine 命中缓存: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /time-machine 请求已在处理中，复用: ${cacheKey}`);
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    // 创建新请求
    const requestPromise = (async (): Promise<TimeMachineResponse> => {
      try {
        const client = createClient();
        if (!client) {
          return {
            success: false,
            error: 'API 客户端未初始化，请检查 API Key 配置',
          };
        }

        // 获取 git 历史
        let commits: TimeMachineCommit[] = [];
        let gitError = '';

        try {
          // 获取文件的整体历史（最近20条）
          const gitLogCmd = `git log --follow --format="%H|%an|%ae|%ad|%s" -20 -- "${filePath}"`;
          const gitOutput = execSync(gitLogCmd, {
            cwd: process.cwd(),
            encoding: 'utf-8',
            timeout: 5000,
          });

          // 解析 git log 输出
          const lines = gitOutput.trim().split('\n').filter(line => line);
          commits = lines.map(line => {
            const [hash, author, email, date, ...messageParts] = line.split('|');
            return {
              hash: hash || '',
              author: author || '',
              email: email || '',
              date: date || '',
              message: messageParts.join('|') || '',
            };
          });

          // 如果指定了行号范围，还获取该区域的历史
          if (startLine && endLine) {
            try {
              const gitLineLogCmd = `git log -L ${startLine},${endLine}:"${filePath}" --format="%H|%an|%ad|%s" -10`;
              const lineLogOutput = execSync(gitLineLogCmd, {
                cwd: process.cwd(),
                encoding: 'utf-8',
                timeout: 5000,
              });
              // 这个输出会更详细，但格式复杂，我们暂时只用于丰富上下文
            } catch (lineError: any) {
              console.log('[AI Editor] /time-machine git log -L 失败（可能不支持），跳过');
            }
          }
        } catch (error: any) {
          console.error('[AI Editor] /time-machine git 命令失败:', error);
          gitError = error.message || 'Git 命令执行失败';
          // 不是 git repo 或文件无历史，继续但通知 AI
        }

        // 构建 AI prompt
        const codeToAnalyze = selectedCode || content;
        const rangeDesc = startLine && endLine ? `选中的代码范围（第 ${startLine}-${endLine} 行）` : '整个文件';

        const prompt = `请分析以下代码的演变历史。

文件路径: ${filePath}
分析范围: ${rangeDesc}

${commits.length > 0 ? `Git 历史（最近 ${commits.length} 次提交）：
${commits.map(c => `- ${c.hash.substring(0, 7)} | ${c.author} | ${c.date} | ${c.message}`).join('\n')}
` : `注意：此文件无 Git 历史${gitError ? `（原因：${gitError}）` : ''}，请基于代码内容推测可能的演变过程。`}

代码内容:
\`\`\`${language}
${codeToAnalyze}
\`\`\`

请以 JSON 格式返回分析结果：
{
  "story": "用通俗易懂的语言讲述这段代码是如何一步步演变到现在的，包括主要的设计决策和重构过程",
  "keyChanges": [
    {
      "date": "2024-01-15",
      "description": "初始版本，实现了基本功能"
    },
    {
      "date": "2024-02-20",
      "description": "重构：引入依赖注入模式"
    }
  ]
}

如果没有 Git 历史，请根据代码结构和注释推测可能的演变过程（例如从简单到复杂、从硬编码到配置化等）。`;

        console.log(`[AI Editor] /time-machine 调用 Claude: ${filePath}, ${commits.length} commits`);

        const response = await client.createMessage(
          [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          undefined,
          undefined,
          { enableThinking: false }
        );

        const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';

        if (!rawText) {
          return {
            success: false,
            error: 'AI 未返回有效分析结果',
          };
        }

        // 解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !parsed.story) {
          console.error('[AI Editor] /time-machine 无法解析 AI 返回的 JSON:', rawText);
          return {
            success: false,
            error: 'AI 返回格式不正确',
          };
        }

        return {
          success: true,
          history: {
            commits: commits,
            story: parsed.story,
            keyChanges: parsed.keyChanges || [],
          },
        };
      } catch (error: any) {
        console.error('[AI Editor] /time-machine AI 调用失败:', error);
        return {
          success: false,
          error: error.message || 'AI 调用失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        timeMachineCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /time-machine 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /api/ai-editor/detect-patterns
 * 模式检测器：检测代码中的重复模式
 */
router.post('/detect-patterns', async (req: Request, res: Response) => {
  try {
    const { filePath, content, language }: PatternDetectorRequest = req.body;

    // 参数验证
    if (!filePath || !content) {
      return res.status(400).json({
        success: false,
        patterns: [],
        error: '缺少必要参数 (filePath, content)',
      });
    }

    // 生成缓存键
    const cacheKey = crypto
      .createHash('md5')
      .update(`detect-patterns:${filePath}:${content}`)
      .digest('hex');

    // 检查缓存
    const cached = patternCache.get(cacheKey);
    if (cached) {
      console.log(`[AI Editor] /detect-patterns 命中缓存: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /detect-patterns 请求已在处理中，复用: ${cacheKey}`);
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    // 创建新请求
    const requestPromise = (async (): Promise<PatternDetectorResponse> => {
      try {
        const client = createClient();
        if (!client) {
          return {
            success: false,
            patterns: [],
            error: 'API 客户端未初始化，请检查 API Key 配置',
          };
        }

        const prompt = `请分析以下代码中的重复模式和可抽象的代码。

文件路径: ${filePath}
编程语言: ${language}

代码内容:
\`\`\`${language}
${content}
\`\`\`

请检测以下类型的模式：

1. **duplicate**（重复代码块）：
   - 相似的 try-catch 块
   - 相似的 API 调用模式
   - 重复的数据转换逻辑
   - 重复的验证代码

2. **similar-logic**（相似逻辑）：
   - 相似的条件判断
   - 相似的循环处理
   - 相似的错误处理

3. **extract-candidate**（可提取候选）：
   - 可以提取为独立函数的代码块
   - 可以提取为工具类的方法
   - 可以提取为自定义 Hook（React）

4. **design-pattern**（设计模式机会）：
   - 可以应用策略模式的地方
   - 可以应用工厂模式的地方
   - 可以应用装饰器模式的地方
   - 其他设计模式

对于每个检测到的模式，返回：
- type: 模式类型
- name: 模式名称（简短描述）
- locations: 出现的位置数组 [{ line, endLine }, ...]
- description: 详细描述
- suggestion: 建议的抽象/重构方式
- impact: 影响级别（high/medium/low）

请以 JSON 格式返回：
{
  "patterns": [
    {
      "type": "duplicate",
      "name": "重复的错误处理",
      "locations": [
        { "line": 10, "endLine": 15 },
        { "line": 30, "endLine": 35 }
      ],
      "description": "两处相似的 try-catch 错误处理逻辑",
      "suggestion": "提取为 handleError 工具函数",
      "impact": "medium"
    }
  ],
  "summary": "检测到 N 个模式，建议优先处理 X 个高影响模式"
}

如果没有检测到模式，返回空数组。`;

        console.log(`[AI Editor] /detect-patterns 调用 Claude: ${filePath}`);

        const response = await client.createMessage(
          [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          undefined,
          undefined,
          { enableThinking: false }
        );

        const rawText = response.content[0]?.type === 'text' ? response.content[0].text : '';

        if (!rawText) {
          return {
            success: false,
            patterns: [],
            error: 'AI 未返回有效分析结果',
          };
        }

        // 解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !Array.isArray(parsed.patterns)) {
          console.error('[AI Editor] /detect-patterns 无法解析 AI 返回的 JSON:', rawText);
          return {
            success: false,
            patterns: [],
            error: 'AI 返回格式不正确',
          };
        }

        return {
          success: true,
          patterns: parsed.patterns,
          summary: parsed.summary || `检测到 ${parsed.patterns.length} 个模式`,
        };
      } catch (error: any) {
        console.error('[AI Editor] /detect-patterns AI 调用失败:', error);
        return {
          success: false,
          patterns: [],
          error: error.message || 'AI 调用失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        patternCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /detect-patterns 请求处理失败:', error);
    res.status(500).json({
      success: false,
      patterns: [],
      error: error.message || '服务器内部错误',
    });
  }
});

/**
 * POST /api/ai-editor/api-doc
 * API 文档叠加：查询第三方库 API 的使用文档
 */
router.post('/api-doc', async (req: Request, res: Response) => {
  try {
    const { symbolName, packageName, language, codeContext }: ApiDocRequest = req.body;

    // 参数验证
    if (!symbolName || !codeContext) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数 (symbolName, codeContext)',
      });
    }

    // 生成缓存键
    const cacheKey = crypto
      .createHash('md5')
      .update(`api-doc:${symbolName}:${packageName || ''}:${language}`)
      .digest('hex');

    // 检查缓存
    const cached = apiDocCache.get(cacheKey);
    if (cached) {
      console.log(`[AI Editor] /api-doc 命中缓存: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /api-doc 请求已在处理中，复用: ${cacheKey}`);
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    // 创建新请求
    const requestPromise = (async (): Promise<ApiDocResponse> => {
      try {
        const client = createClient();
        if (!client) {
          return {
            success: false,
            error: 'API 客户端未初始化，请检查 API Key 配置',
          };
        }

        const prompt = `请提供以下第三方库 API 的使用文档。

符号名称: ${symbolName}
${packageName ? `所属包: ${packageName}` : ''}
编程语言: ${language}

代码上下文:
\`\`\`${language}
${codeContext}
\`\`\`

请提供该 API 的详细使用说明，包括：
1. 简要描述（一句话说明这个 API 是做什么的）
2. 参数说明（每个参数的类型、含义、是否可选）
3. 返回值说明（返回值类型和含义）
4. 常见用法示例（至少 2-3 个实用示例）
5. 常见陷阱/注意事项（使用时需要注意的问题）
6. 相关 API（相关或替代的 API）

请以 JSON 格式返回：
{
  "name": "${symbolName}",
  "package": "${packageName || '未知'}",
  "brief": "简要描述",
  "params": [
    {
      "name": "参数名",
      "type": "类型",
      "description": "说明",
      "optional": false
    }
  ],
  "returns": {
    "type": "返回值类型",
    "description": "返回值说明"
  },
  "examples": [
    "示例代码1",
    "示例代码2"
  ],
  "pitfalls": [
    "注意事项1",
    "注意事项2"
  ],
  "seeAlso": [
    "relatedAPI1",
    "relatedAPI2"
  ]
}

如果无法识别该 API 或不是第三方库 API，请在 brief 中说明。`;

        console.log(`[AI Editor] /api-doc 调用 Claude: ${symbolName}`);

        const response = await client.createMessage(
          [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          undefined,
          undefined,
          { enableThinking: false }
        );

        // 从 content blocks 中提取所有 text（跳过 thinking blocks）
        const rawText = response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');

        console.log(`[AI Editor] /api-doc rawText (${rawText.length} chars):`, rawText.slice(0, 500));

        if (!rawText) {
          console.error('[AI Editor] /api-doc 无 text content, blocks:', response.content.map((b: any) => b.type));
          return {
            success: false,
            error: 'AI 未返回有效文档',
          };
        }

        // 解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !parsed.name) {
          console.error('[AI Editor] /api-doc 无法解析 AI 返回的 JSON:', rawText);
          return {
            success: false,
            error: 'AI 返回格式不正确',
          };
        }

        return {
          success: true,
          doc: {
            name: parsed.name,
            package: parsed.package || packageName || '未知',
            brief: parsed.brief || '',
            params: parsed.params || [],
            returns: parsed.returns,
            examples: parsed.examples || [],
            pitfalls: parsed.pitfalls || [],
            seeAlso: parsed.seeAlso || [],
          },
        };
      } catch (error: any) {
        console.error('[AI Editor] /api-doc AI 调用失败:', error);
        return {
          success: false,
          error: error.message || 'AI 调用失败',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        apiDocCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /api-doc 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

// ============================================================================
// POST /complete-path - Import 路径补全
// ============================================================================

router.post('/complete-path', async (req: Request, res: Response) => {
  try {
    const { filePath, prefix, root } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        items: [],
        error: '缺少必要参数 filePath',
      });
    }

    // 解析基准目录
    const fileDir = path.dirname(filePath);
    let resolveBase: string;

    if (prefix.startsWith('.')) {
      // 相对路径：基于当前文件目录
      resolveBase = path.resolve(fileDir, prefix);
    } else if (root) {
      // 非相对路径：从项目根目录的 node_modules 查找
      resolveBase = path.resolve(root, 'node_modules', prefix);
    } else {
      return res.json({ success: true, items: [] });
    }

    // 判断 resolveBase 是文件夹还是需要列出其父目录的匹配项
    let dirToList: string;
    let filterPrefix = '';

    try {
      const stat = fs.statSync(resolveBase);
      if (stat.isDirectory()) {
        dirToList = resolveBase;
      } else {
        return res.json({ success: true, items: [] });
      }
    } catch {
      // resolveBase 不存在，列出其父目录并用最后一段做前缀过滤
      dirToList = path.dirname(resolveBase);
      filterPrefix = path.basename(resolveBase).toLowerCase();
    }

    // 读取目录
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirToList, { withFileTypes: true });
    } catch {
      return res.json({ success: true, items: [] });
    }

    const items: Array<{ label: string; kind: 'file' | 'folder'; detail?: string }> = [];

    for (const entry of entries) {
      // 跳过隐藏文件
      if (entry.name.startsWith('.')) continue;

      const nameLower = entry.name.toLowerCase();
      if (filterPrefix && !nameLower.startsWith(filterPrefix)) continue;

      if (entry.isDirectory()) {
        items.push({
          label: entry.name,
          kind: 'folder',
          detail: '📁 目录',
        });
      } else if (entry.isFile()) {
        // 只显示代码相关文件
        const ext = path.extname(entry.name).toLowerCase();
        const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.scss', '.less', '.vue', '.svelte'];
        if (codeExts.includes(ext)) {
          // 显示时去掉 .ts/.tsx/.js/.jsx 扩展名
          const stripExts = ['.ts', '.tsx', '.js', '.jsx'];
          const label = stripExts.includes(ext) ? entry.name.replace(/\.(ts|tsx|js|jsx)$/, '') : entry.name;
          items.push({
            label,
            kind: 'file',
            detail: ext,
          });
        }
      }

      if (items.length >= 50) break;
    }

    // 文件夹排前面
    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    res.json({ success: true, items });
  } catch (error: any) {
    console.error('[AI Editor] /complete-path 失败:', error);
    res.status(500).json({
      success: false,
      items: [],
      error: error.message || '服务器内部错误',
    });
  }
});

// ============================================================================
// POST /inline-complete - AI Inline 补全（Ghost Text）
// ============================================================================

router.post('/inline-complete', async (req: Request, res: Response) => {
  try {
    const { filePath, language, prefix, suffix, currentLine, cursorColumn } = req.body;

    if (!filePath || !prefix) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数',
      });
    }

    // 缓存键：基于前缀最后 3 行 + 当前行前缀
    const lastLines = prefix.split('\n').slice(-3).join('\n');
    const cacheKey = crypto
      .createHash('md5')
      .update(`inline:${filePath}:${lastLines}`)
      .digest('hex');

    const cached = inlineCompleteCache.get(cacheKey);
    if (cached) {
      return res.json({ success: true, completion: cached.completion, fromCache: true });
    }

    // 检查重复请求
    if (pendingRequests.has(cacheKey)) {
      const result = await pendingRequests.get(cacheKey);
      return res.json(result);
    }

    const requestPromise = (async () => {
      try {
        const client = createClient();
        if (!client) {
          return { success: false, error: 'API 客户端未初始化' };
        }

        // 截取上下文（避免 token 过多）
        const prefixLines = prefix.split('\n');
        const trimmedPrefix = prefixLines.slice(-30).join('\n');
        const suffixLines = suffix ? suffix.split('\n').slice(0, 10).join('\n') : '';

        const prompt = `你是一个代码补全引擎。根据上下文预测用户接下来要写的代码。

文件: ${path.basename(filePath)} (${language})

== 光标前的代码 ==
${trimmedPrefix}
== 光标位置（在此处补全）==
${suffixLines ? `== 光标后的代码 ==\n${suffixLines}` : ''}

规则：
- 只输出要补全的代码片段，不要解释，不要 markdown
- 补全应该自然地续接光标前的代码
- 通常补全 1-3 行，不要过长
- 如果当前行已经写了一半，先补完当前行
- 如果无法确定应该补全什么，返回空字符串
- 不要重复已有的代码`;

        const response = await client.createMessage(
          [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          undefined,
          undefined,
          { enableThinking: false }
        );

        const rawText = response.content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');

        // 清理：去除可能的 markdown 包裹
        let completion = rawText.trim();
        completion = completion.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();

        if (!completion) {
          return { success: true, completion: '' };
        }

        const result = { success: true, completion };
        inlineCompleteCache.set(cacheKey, { completion });
        return result;
      } catch (error: any) {
        console.error('[AI Editor] /inline-complete AI 调用失败:', error);
        return { success: false, error: error.message || 'AI 调用失败' };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);
    try {
      const result = await requestPromise;
      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Editor] /inline-complete 请求处理失败:', error);
    res.status(500).json({
      success: false,
      error: error.message || '服务器内部错误',
    });
  }
});

export default router;
