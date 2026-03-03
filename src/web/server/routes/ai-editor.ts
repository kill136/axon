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
import { webAuth } from '../web-auth.js';
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
    console.error('[AI Editor] Failed to initialize client:', error);
    return null;
  }
}

/**
 * 调用 Claude API
 */
async function callClaude(prompt: string): Promise<string | null> {
  // 确保 OAuth token 有效（对齐官方 NM()）
  await webAuth.ensureValidToken();
  const client = createClient();
  if (!client) {
    throw new Error('API client not initialized, please check API Key configuration');
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
    console.error('[AI Editor] API call failed:', error);
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
    throw new Error('Unable to extract JSON from response');
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
    throw new Error('Unable to extract JSON from response');
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
        error: 'Missing required parameters: filePath and content',
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
      const prompt = `You are a professional code tour guide. Please analyze the code below, extracting important functions, classes, components, etc. as tour steps.

## Code File: ${filePath}
\`\`\`
${content}
\`\`\`

## Output Requirements
Return JSON format containing a steps array, each step includes:
- type: 'file' | 'function' | 'class' | 'block'
- name: name
- line: starting line number (from 1)
- endLine: ending line number (optional)
- description: brief description (1-2 sentences)
- importance: 'high' | 'medium' | 'low'

Only return the 5-10 most important steps, sorted by line number. Output only JSON, no other content.

Example:
{
  "steps": [
    {
      "type": "class",
      "name": "UserController",
      "line": 10,
      "endLine": 50,
      "description": "User controller, handles user-related HTTP requests",
      "importance": "high"
    }
  ]
}`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: 'Unable to get AI response' };
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
          error: error.message || 'AI analysis failed',
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
    console.error('[AI Editor] /tour request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: code and question',
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
        'You are a professional code analysis assistant. The user has selected a piece of code and asked a question. Please answer based on the code context.',
        '',
        '## User Question',
        question,
        '',
        '## Code Context',
      ];

      if (filePath) {
        parts.push(`File path: ${filePath}`);
      }
      if (context?.language) {
        parts.push(`Language: ${context.language}`);
      }

      parts.push('```' + (context?.language || ''));
      parts.push(code);
      parts.push('```');
      parts.push('');
      parts.push('## Output Requirements');
      parts.push('Answer concisely in 2-4 sentences. Output only the answer text, no extra formatting.');

      const prompt = parts.join('\n');

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: 'Unable to get AI response' };
        }

        return {
          success: true,
          answer: response.trim(),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'AI analysis failed',
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
    console.error('[AI Editor] /ask request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: filePath, content, and language',
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
      const prompt = `You are a code complexity analysis expert. Please analyze the code below and assess a complexity score (0-100) for each line.

## Code File: ${filePath}
Language: ${language}

\`\`\`${language}
${content}
\`\`\`

## Scoring Criteria
- 0-20: Simple statements (variable declarations, simple assignments, etc.)
- 21-40: Basic logic (single-level if/for/while)
- 41-60: Medium complexity (nested logic, multi-condition checks)
- 61-80: High complexity (deep nesting, complex algorithms)
- 81-100: Very high complexity (code that needs refactoring)

## Output Requirements
Return JSON format containing a heatmap array, only include lines with complexity > 30:
{
  "heatmap": [
    {
      "line": line number (from 1),
      "complexity": complexity score (0-100),
      "reason": "brief reason (1 sentence)"
    }
  ]
}

Output only JSON, no other content.`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, heatmap: [], error: 'Unable to get AI response' };
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
          error: error.message || 'AI analysis failed',
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
    console.error('[AI Editor] /heatmap request processing failed:', error);
    res.status(500).json({
      success: false,
      heatmap: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: filePath, content, and language',
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
      const prompt = `You are a code quality expert. Please analyze the code below and propose refactoring suggestions.

## Code File: ${filePath}
Language: ${language}

\`\`\`${language}
${content}
\`\`\`

## Analysis Dimensions
- extract: Functions/methods that can be extracted
- simplify: Logic that can be simplified
- rename: Poorly named variables/functions
- unused: Unused code
- duplicate: Duplicate code
- performance: Performance issues
- safety: Security concerns

## Output Requirements
Return JSON format containing a suggestions array:
{
  "suggestions": [
    {
      "line": starting line number (from 1),
      "endLine": ending line number,
      "type": "extract" | "simplify" | "rename" | "unused" | "duplicate" | "performance" | "safety",
      "message": "suggestion description (1-2 sentences)",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Only return the 5-10 most important suggestions. Output only JSON, no other content.`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, suggestions: [], error: 'Unable to get AI response' };
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
          error: error.message || 'AI analysis failed',
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
    console.error('[AI Editor] /refactor request processing failed:', error);
    res.status(500).json({
      success: false,
      suggestions: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: filePath, content, and language',
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
      const prompt = `You are a code explanation expert. Please generate valuable explanation bubbles for the code below to help readers understand the code.

## Code File: ${filePath}
Language: ${language}

\`\`\`${language}
${content}
\`\`\`

## Bubble Types
- info: General information (code purpose, design patterns, etc.)
- warning: Notes (boundary conditions, potential issues, etc.)
- tip: Optimization suggestions (better approaches, performance tips, etc.)

## Output Requirements
Return JSON format containing a bubbles array:
{
  "bubbles": [
    {
      "line": line number (from 1),
      "message": "explanation text (1-2 sentences, valuable content, avoid obvious statements)",
      "type": "info" | "warning" | "tip"
    }
  ]
}

Only return the 3-8 most valuable bubbles, avoid obvious content. Output only JSON, no other content.`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, bubbles: [], error: 'Unable to get AI response' };
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
          error: error.message || 'AI analysis failed',
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
    console.error('[AI Editor] /bubbles request processing failed:', error);
    res.status(500).json({
      success: false,
      bubbles: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: filePath, code, intent, language, and mode',
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
        prompt = `You are a professional code writing assistant. The user has selected a piece of code and described their modification intent. Please rewrite the code according to the intent.

## Original Code
File path: ${filePath}
Language: ${language}

\`\`\`${language}
${code}
\`\`\`

## User Intent
${intent}

## Output Requirements
Return JSON format:
{
  "code": "complete rewritten code (maintain formatting and style)",
  "explanation": "brief description of what was changed (1-2 sentences)"
}

Output only JSON, no other content.`;
      } else {
        // generate 模式
        prompt = `You are a professional code writing assistant. The user wants to generate code after a code comment. Please generate code based on the intent.

## Context
File path: ${filePath}
Language: ${language}
Comment content: ${code}

## User Intent
${intent}

## Output Requirements
Return JSON format:
{
  "code": "generated code (well-formatted, ready to use)",
  "explanation": "brief description of what was generated (1-2 sentences)"
}

Output only JSON, no other content.`;
      }

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: 'Unable to get AI response' };
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
          error: error.message || 'AI generation failed',
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
    console.error('[AI Editor] /intent-to-code request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: filePath, content, and language',
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
      const prompt = `You are a code review expert. Please analyze the code below, find potential issues, and categorize them by type.

## Code File: ${filePath}
Language: ${language}

\`\`\`${language}
${content}
\`\`\`

## Issue Categories
- bug: Potential bugs (null pointers, uninitialized variables, race conditions, boundary conditions, etc.)
- performance: Performance issues (N+1 queries, unnecessary renders, memory leaks, inefficient algorithms, etc.)
- security: Security concerns (injection vulnerabilities, XSS, sensitive data exposure, insecure random numbers, etc.)
- style: Code style and best practices (naming conventions, code duplication, readability, design patterns, etc.)

## Severity Levels
- error: Serious issue, must fix
- warning: Warning, should fix
- info: Informational, optional optimization

## Output Requirements
Return JSON format:
{
  "issues": [
    {
      "line": starting line number (from 1),
      "endLine": ending line number,
      "type": "bug" | "performance" | "security" | "style",
      "severity": "error" | "warning" | "info",
      "message": "issue description (1 sentence)",
      "suggestion": "fix suggestion (1 sentence, optional)"
    }
  ],
  "summary": "overall code quality summary (2-3 sentences)"
}

Only return the 5-15 most important issues. Output only JSON, no other content.`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, issues: [], error: 'Unable to get AI response' };
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
          error: error.message || 'AI analysis failed',
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
    console.error('[AI Editor] /code-review request processing failed:', error);
    res.status(500).json({
      success: false,
      issues: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters: filePath, code, functionName, and language',
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

      const prompt = `You are a test code generation expert. Please generate complete unit tests for the function below.

## Function Code
File path: ${filePath}
Language: ${language}
Function name: ${functionName}

\`\`\`${language}
${code}
\`\`\`

## Test Requirements
- Test framework: ${testFramework}
- Cover normal cases, boundary conditions, and error cases
- Test code should be complete and runnable, including necessary imports and setup
- Test case names should be clear and descriptive
- Each test should be an independent test case

## Output Requirements
Return JSON format:
{
  "testCode": "complete test file code",
  "testFramework": "${testFramework}",
  "testCount": number of test cases (number),
  "explanation": "what scenarios the tests cover (1-2 sentences)"
}

Output only JSON, no other content.`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: 'Unable to get AI response' };
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
          error: error.message || 'AI generation failed',
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
    console.error('[AI Editor] /generate-test request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters (filePath, originalContent, modifiedContent)',
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
      console.log(`[AI Editor] /smart-diff cache hit: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /smart-diff request already in progress, reusing: ${cacheKey}`);
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
            error: 'API client not initialized, please check API Key configuration',
          };
        }

        const prompt = `Please analyze the semantic impact of the following code changes.

File path: ${filePath}
Programming language: ${language}

Original code:
\`\`\`${language}
${originalContent}
\`\`\`

Modified code:
\`\`\`${language}
${modifiedContent}
\`\`\`

Please analyze:
1. Change summary: briefly describe what this change does
2. Risk level (impact): safe (no risk), warning (potential issues to watch), danger (may introduce bugs)
3. Specific changes list: each change includes type (added/removed/modified), description (semantic description), risk (optional risk note)
4. Warnings list: list all potential issues

Return in JSON format as follows:
{
  "summary": "change summary",
  "impact": "safe" | "warning" | "danger",
  "changes": [
    { "type": "added" | "removed" | "modified", "description": "semantic description", "risk": "optional risk note" }
  ],
  "warnings": ["warning 1", "warning 2"]
}`;

        console.log(`[AI Editor] /smart-diff calling Claude: ${filePath}`);

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
            error: 'AI did not return valid analysis results',
          };
        }

        // 尝试解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !parsed.summary || !parsed.impact) {
          console.error('[AI Editor] /smart-diff failed to parse AI response JSON:', rawText);
          return {
            success: false,
            error: 'AI returned incorrect format',
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
        console.error('[AI Editor] /smart-diff AI call failed:', error);
        return {
          success: false,
          error: error.message || 'AI call failed',
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
    console.error('[AI Editor] /smart-diff request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters (filePath, content)',
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
      console.log(`[AI Editor] /dead-code cache hit: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /dead-code request already in progress, reusing: ${cacheKey}`);
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
            error: 'API client not initialized, please check API Key configuration',
          };
        }

        const prompt = `Please analyze the following code for dead code.

File path: ${filePath}
Programming language: ${language}

Code content:
\`\`\`${language}
${content}
\`\`\`

Please detect the following types of dead code:
1. unused: Unused variables, functions, imports
2. unreachable: Unreachable code (e.g., code after return)
3. redundant: Redundant code (duplicate assignments, always-true conditions, etc.)
4. suspicious: Exported but possibly unused across the entire project (cannot be determined from single-file analysis, mark as suspicious)

For each dead code instance, return:
- line: starting line number
- endLine: ending line number
- type: type (unused/unreachable/redundant/suspicious)
- name: variable/function/import name
- reason: why it is considered dead code
- confidence: confidence level (high/medium/low)

Return in JSON format as follows:
{
  "deadCode": [
    {
      "line": 10,
      "endLine": 12,
      "type": "unused",
      "name": "unusedVar",
      "reason": "Variable declared but never used",
      "confidence": "high"
    }
  ],
  "summary": "Detected N instances of dead code"
}

If there is no dead code, return an empty array.`;

        console.log(`[AI Editor] /dead-code calling Claude: ${filePath}`);

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
            error: 'AI did not return valid analysis results',
          };
        }

        // 尝试解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !Array.isArray(parsed.deadCode)) {
          console.error('[AI Editor] /dead-code failed to parse AI response JSON:', rawText);
          return {
            success: false,
            deadCode: [],
            error: 'AI returned incorrect format',
          };
        }

        return {
          success: true,
          deadCode: parsed.deadCode,
          summary: parsed.summary || `Detected ${parsed.deadCode.length} instances of dead code`,
        };
      } catch (error: any) {
        console.error('[AI Editor] /dead-code AI call failed:', error);
        return {
          success: false,
          deadCode: [],
          error: error.message || 'AI call failed',
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
    console.error('[AI Editor] /dead-code request processing failed:', error);
    res.status(500).json({
      success: false,
      deadCode: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters (filePath, codeContext, question)',
      });
    }

    // 生成缓存键（不缓存，但用于防重）
    const cacheKey = crypto
      .createHash('md5')
      .update(`conversation:${filePath}:${JSON.stringify(messages)}:${question}`)
      .digest('hex');

    // 检查是否有正在处理的相同请求（防重）
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /conversation request already in progress, reusing: ${cacheKey}`);
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
            error: 'API client not initialized, please check API Key configuration',
          };
        }

        // 构建 system prompt
        const systemPrompt = `You are a professional code assistant. The user is viewing the following file:

File path: ${filePath}
Programming language: ${language}
${cursorLine ? `Cursor line: ${cursorLine}` : ''}

Current code context:
\`\`\`${language}
${codeContext}
\`\`\`

Please answer the user's questions based on the code context above. If the user mentions "this code", "current position", etc., refer to the code context above.`;

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

        console.log(`[AI Editor] /conversation calling Claude: ${filePath}, ${conversationMessages.length} messages`);

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
            error: 'AI did not return a valid answer',
          };
        }

        return {
          success: true,
          answer,
        };
      } catch (error: any) {
        console.error('[AI Editor] /conversation AI call failed:', error);
        return {
          success: false,
          error: error.message || 'AI call failed',
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
    console.error('[AI Editor] /conversation request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters (filePath, content)',
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
      console.log(`[AI Editor] /time-machine cache hit: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /time-machine request already in progress, reusing: ${cacheKey}`);
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
            error: 'API client not initialized, please check API Key configuration',
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
              console.log('[AI Editor] /time-machine git log -L failed (possibly unsupported), skipping');
            }
          }
        } catch (error: any) {
          console.error('[AI Editor] /time-machine git command failed:', error);
          gitError = error.message || 'Git command execution failed';
          // 不是 git repo 或文件无历史，继续但通知 AI
        }

        // 构建 AI prompt
        const codeToAnalyze = selectedCode || content;
        const rangeDesc = startLine && endLine ? `Selected code range (lines ${startLine}-${endLine})` : 'entire file';

        const prompt = `Please analyze the evolution history of the following code.

File path: ${filePath}
Analysis scope: ${rangeDesc}

${commits.length > 0 ? `Git history (last ${commits.length} commits):
${commits.map(c => `- ${c.hash.substring(0, 7)} | ${c.author} | ${c.date} | ${c.message}`).join('\n')}
` : `Note: This file has no Git history${gitError ? ` (reason: ${gitError})` : ''}, please infer the possible evolution process based on the code content.`}

Code content:
\`\`\`${language}
${codeToAnalyze}
\`\`\`

Return the analysis results in JSON format:
{
  "story": "Describe in plain language how this code evolved step by step to its current state, including major design decisions and refactoring processes",
  "keyChanges": [
    {
      "date": "2024-01-15",
      "description": "Initial version, implemented basic functionality"
    },
    {
      "date": "2024-02-20",
      "description": "Refactoring: introduced dependency injection pattern"
    }
  ]
}

If there is no Git history, please infer the possible evolution process based on the code structure and comments (e.g., from simple to complex, from hardcoded to configurable, etc.).`;

        console.log(`[AI Editor] /time-machine calling Claude: ${filePath}, ${commits.length} commits`);

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
            error: 'AI did not return valid analysis results',
          };
        }

        // 解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !parsed.story) {
          console.error('[AI Editor] /time-machine failed to parse AI response JSON:', rawText);
          return {
            success: false,
            error: 'AI returned incorrect format',
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
        console.error('[AI Editor] /time-machine AI call failed:', error);
        return {
          success: false,
          error: error.message || 'AI call failed',
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
    console.error('[AI Editor] /time-machine request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters (filePath, content)',
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
      console.log(`[AI Editor] /detect-patterns cache hit: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /detect-patterns request already in progress, reusing: ${cacheKey}`);
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
            error: 'API client not initialized, please check API Key configuration',
          };
        }

        const prompt = `Please analyze the following code for duplicate patterns and abstractable code.

File path: ${filePath}
Programming language: ${language}

Code content:
\`\`\`${language}
${content}
\`\`\`

Please detect the following types of patterns:

1. **duplicate** (duplicate code blocks):
   - Similar try-catch blocks
   - Similar API call patterns
   - Duplicate data transformation logic
   - Duplicate validation code

2. **similar-logic** (similar logic):
   - Similar conditional checks
   - Similar loop processing
   - Similar error handling

3. **extract-candidate** (extraction candidates):
   - Code blocks that can be extracted into standalone functions
   - Methods that can be extracted into utility classes
   - Code that can be extracted into custom Hooks (React)

4. **design-pattern** (design pattern opportunities):
   - Places where the Strategy pattern can be applied
   - Places where the Factory pattern can be applied
   - Places where the Decorator pattern can be applied
   - Other design patterns

For each detected pattern, return:
- type: pattern type
- name: pattern name (brief description)
- locations: array of locations [{ line, endLine }, ...]
- description: detailed description
- suggestion: suggested abstraction/refactoring approach
- impact: impact level (high/medium/low)

Return in JSON format:
{
  "patterns": [
    {
      "type": "duplicate",
      "name": "Duplicate error handling",
      "locations": [
        { "line": 10, "endLine": 15 },
        { "line": 30, "endLine": 35 }
      ],
      "description": "Two similar try-catch error handling blocks",
      "suggestion": "Extract into a handleError utility function",
      "impact": "medium"
    }
  ],
  "summary": "Detected N patterns, recommend prioritizing X high-impact patterns"
}

If no patterns are detected, return an empty array.`;

        console.log(`[AI Editor] /detect-patterns calling Claude: ${filePath}`);

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
            error: 'AI did not return valid analysis results',
          };
        }

        // 解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !Array.isArray(parsed.patterns)) {
          console.error('[AI Editor] /detect-patterns failed to parse AI response JSON:', rawText);
          return {
            success: false,
            patterns: [],
            error: 'AI returned incorrect format',
          };
        }

        return {
          success: true,
          patterns: parsed.patterns,
          summary: parsed.summary || `Detected ${parsed.patterns.length} patterns`,
        };
      } catch (error: any) {
        console.error('[AI Editor] /detect-patterns AI call failed:', error);
        return {
          success: false,
          patterns: [],
          error: error.message || 'AI call failed',
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
    console.error('[AI Editor] /detect-patterns request processing failed:', error);
    res.status(500).json({
      success: false,
      patterns: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters (symbolName, codeContext)',
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
      console.log(`[AI Editor] /api-doc cache hit: ${cacheKey}`);
      return res.json({ ...cached, fromCache: true });
    }

    // 检查是否有正在处理的相同请求
    if (pendingRequests.has(cacheKey)) {
      console.log(`[AI Editor] /api-doc request already in progress, reusing: ${cacheKey}`);
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
            error: 'API client not initialized, please check API Key configuration',
          };
        }

        const prompt = `Please provide usage documentation for the following third-party library API.

Symbol name: ${symbolName}
${packageName ? `Package: ${packageName}` : ''}
Programming language: ${language}

Code context:
\`\`\`${language}
${codeContext}
\`\`\`

Please provide detailed usage instructions for this API, including:
1. Brief description (one sentence explaining what this API does)
2. Parameter descriptions (type, meaning, and whether optional for each parameter)
3. Return value description (return type and meaning)
4. Common usage examples (at least 2-3 practical examples)
5. Common pitfalls/notes (issues to watch out for when using)
6. Related APIs (related or alternative APIs)

Return in JSON format:
{
  "name": "${symbolName}",
  "package": "${packageName || 'unknown'}",
  "brief": "brief description",
  "params": [
    {
      "name": "parameter name",
      "type": "type",
      "description": "description",
      "optional": false
    }
  ],
  "returns": {
    "type": "return type",
    "description": "return value description"
  },
  "examples": [
    "example code 1",
    "example code 2"
  ],
  "pitfalls": [
    "note 1",
    "note 2"
  ],
  "seeAlso": [
    "relatedAPI1",
    "relatedAPI2"
  ]
}

If the API cannot be identified or is not a third-party library API, explain in the brief field.`;

        console.log(`[AI Editor] /api-doc calling Claude: ${symbolName}`);

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
          console.error('[AI Editor] /api-doc no text content, blocks:', response.content.map((b: any) => b.type));
          return {
            success: false,
            error: 'AI did not return valid documentation',
          };
        }

        // 解析 JSON
        const parsed = extractJSON(rawText);
        if (!parsed || !parsed.name) {
          console.error('[AI Editor] /api-doc failed to parse AI response JSON:', rawText);
          return {
            success: false,
            error: 'AI returned incorrect format',
          };
        }

        return {
          success: true,
          doc: {
            name: parsed.name,
            package: parsed.package || packageName || 'unknown',
            brief: parsed.brief || '',
            params: parsed.params || [],
            returns: parsed.returns,
            examples: parsed.examples || [],
            pitfalls: parsed.pitfalls || [],
            seeAlso: parsed.seeAlso || [],
          },
        };
      } catch (error: any) {
        console.error('[AI Editor] /api-doc AI call failed:', error);
        return {
          success: false,
          error: error.message || 'AI call failed',
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
    console.error('[AI Editor] /api-doc request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameter filePath',
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
          detail: 'Directory',
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
    console.error('[AI Editor] /complete-path failed:', error);
    res.status(500).json({
      success: false,
      items: [],
      error: error.message || 'Internal server error',
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
        error: 'Missing required parameters',
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
          return { success: false, error: 'API client not initialized' };
        }

        // 截取上下文（避免 token 过多）
        const prefixLines = prefix.split('\n');
        const trimmedPrefix = prefixLines.slice(-30).join('\n');
        const suffixLines = suffix ? suffix.split('\n').slice(0, 10).join('\n') : '';

        const prompt = `You are a code completion engine. Predict the code the user will write next based on context.

File: ${path.basename(filePath)} (${language})

== Code before cursor ==
${trimmedPrefix}
== Cursor position (complete here) ==
${suffixLines ? `== Code after cursor ==\n${suffixLines}` : ''}

Rules:
- Only output the code snippet to complete, no explanations, no markdown
- The completion should naturally continue from the code before the cursor
- Typically complete 1-3 lines, do not make it too long
- If the current line is partially written, complete the current line first
- If unsure what to complete, return an empty string
- Do not repeat existing code`;

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
        console.error('[AI Editor] /inline-complete AI call failed:', error);
        return { success: false, error: error.message || 'AI call failed' };
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
    console.error('[AI Editor] /inline-complete request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;
