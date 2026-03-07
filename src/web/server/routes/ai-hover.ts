/**
 * AI Hover API
 *
 * 为代码编辑器提供 AI 驱动的智能悬停提示
 * 当用户将鼠标悬停在代码符号上时，调用 Claude API 生成详细的文档说明
 */

import { Router, Request, Response } from 'express';
import { ClaudeClient } from '../../../core/client.js';
import { webAuth } from '../web-auth.js';
import { LRUCache } from 'lru-cache';

const router = Router();

// AI Hover 结果缓存（15分钟过期，最多缓存500条）
const hoverCache = new LRUCache<string, AIHoverResult>({
  max: 500,
  ttl: 1000 * 60 * 15, // 15分钟
});

// 正在进行的请求，防止重复调用
const pendingRequests = new Map<string, Promise<AIHoverResult>>();

/**
 * AI Hover 请求参数
 */
interface AIHoverRequest {
  /** 文件路径 */
  filePath: string;
  /** 符号名称 */
  symbolName: string;
  /** 符号类型（如 function, class, interface, variable 等） */
  symbolKind?: string;
  /** 代码上下文（悬停位置周围的代码） */
  codeContext: string;
  /** 行号 */
  line?: number;
  /** 列号 */
  column?: number;
  /** 语言 */
  language?: string;
  /** 类型签名（如果 TypeScript 已经推断出来） */
  typeSignature?: string;
  /** UI 语言（en/zh），用于控制 AI 回复语言 */
  locale?: string;
}

/**
 * AI Hover 返回结果
 */
interface AIHoverResult {
  /** 是否成功 */
  success: boolean;
  /** 简短描述 */
  brief?: string;
  /** 详细说明 */
  detail?: string;
  /** 参数说明 */
  params?: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  /** 返回值说明 */
  returns?: {
    type: string;
    description: string;
  };
  /** 使用示例 */
  examples?: string[];
  /** 相关链接 */
  seeAlso?: string[];
  /** 注意事项 */
  notes?: string[];
  /** 错误信息 */
  error?: string;
  /** 是否来自缓存 */
  fromCache?: boolean;
}

/**
 * 生成缓存键
 */
function getCacheKey(req: AIHoverRequest): string {
  return `${req.filePath}:${req.symbolName}:${req.symbolKind || ''}:${req.typeSignature || ''}`;
}

/**
 * 初始化 Claude 客户端
 */
function createClient(): ClaudeClient | null {
  try {
    const creds = webAuth.getCredentials();
    const apiKey = creds.apiKey;
    const authToken = creds.authToken;

    if (!apiKey && !authToken) {
      return null;
    }

    return new ClaudeClient({
      apiKey,
      authToken,
      baseUrl: creds.baseUrl || process.env.ANTHROPIC_BASE_URL,
      model: 'haiku',
    });
  } catch (error) {
    console.error('[AI Hover] Failed to initialize client:', error);
    return null;
  }
}

/**
 * 调用 AI 生成文档
 */
async function generateHoverDoc(req: AIHoverRequest): Promise<AIHoverResult> {
  // 确保 OAuth token 有效（对齐官方 NM()）
  await webAuth.ensureValidToken();
  const client = createClient();
  if (!client) {
    return {
      success: false,
      error: 'API client not initialized, please check API Key configuration',
    };
  }

  // 构建 prompt
  const prompt = buildPrompt(req);

  try {
    const response = await client.createMessage(
      [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
      ],
      undefined,
      undefined,
      {
        enableThinking: false,
      }
    );

    // 解析响应
    const content = response.content?.[0];
    if (content?.type === 'text') {
      return parseAIResponse(content.text);
    }

    return {
      success: false,
      error: 'Failed to parse AI response',
    };
  } catch (error: any) {
    console.error('[AI Hover] API call failed:', error);
    return {
      success: false,
      error: error.message || 'API call failed',
    };
  }
}

/**
 * 构建 AI prompt
 */
function buildPrompt(req: AIHoverRequest): string {
  const parts: string[] = [
    `You are a professional code documentation generator. Please analyze the line of code marked with >>> in the code context below, and generate concise but informative documentation.`,
    ``,
    `## Target Line Info`,
    `- Line: line ${req.line || '?'}`,
    `- Code: \`${req.symbolName}\``,
  ];

  if (req.symbolKind) {
    parts.push(`- Kind: ${req.symbolKind}`);
  }
  if (req.language) {
    parts.push(`- Language: ${req.language}`);
  }
  if (req.typeSignature) {
    parts.push(`- Type signature: \`${req.typeSignature}\``);
  }
  if (req.filePath) {
    parts.push(`- File: ${req.filePath}`);
  }

  parts.push(``);
  parts.push(`## Code context (>>> marks the target line, other lines are context)`);
  parts.push('```' + (req.language || 'typescript'));
  parts.push(req.codeContext);
  parts.push('```');
  parts.push(``);
  parts.push(`## Output requirements`);
  parts.push(`Please only analyze the line marked with >>>, and output in JSON format:`);
  parts.push(`- brief: One-sentence short description (required, describe what this line of code does)`);
  parts.push(`- detail: Detailed explanation (optional, 2-3 sentences)`);
  parts.push(`- params: Parameter description array (for functions/methods, each parameter includes name, type, description)`);
  parts.push(`- returns: Return value description (if any, includes type, description)`);
  parts.push(`- examples: Usage examples array (1-2 short code examples)`);
  parts.push(`- notes: Notes array (optional, important usage notes)`);
  parts.push(``);
  parts.push(`Only output JSON, no other content. Keep it concise, only analyze the line marked with >>>.`);

  // 根据 locale 设定回复语言
  if (req.locale === 'zh') {
    parts.push(``);
    parts.push(`IMPORTANT: All text values in the JSON (brief, detail, params descriptions, returns description, examples, notes) MUST be written in Chinese (中文).`);
  }

  return parts.join('\n');
}

/**
 * 解析 AI 响应
 */
function parseAIResponse(text: string): AIHoverResult {
  try {
    // 尝试从响应中提取 JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        success: true,
        brief: text.trim().split('\n')[0] || 'Unable to parse documentation',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      success: true,
      brief: parsed.brief || undefined,
      detail: parsed.detail || undefined,
      params: parsed.params || undefined,
      returns: parsed.returns || undefined,
      examples: parsed.examples || undefined,
      notes: parsed.notes || undefined,
      seeAlso: parsed.seeAlso || undefined,
    };
  } catch (error) {
    // JSON 解析失败，直接返回文本
    return {
      success: true,
      brief: text.trim().split('\n')[0] || 'Unable to parse documentation',
      detail: text.trim(),
    };
  }
}

/**
 * AI Hover API 端点
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const hoverReq: AIHoverRequest = req.body;

    // 参数验证
    if (!hoverReq.symbolName || !hoverReq.codeContext) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: symbolName and codeContext',
      });
    }

    // 检查缓存
    const cacheKey = getCacheKey(hoverReq);
    const cached = hoverCache.get(cacheKey);
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
    const requestPromise = generateHoverDoc(hoverReq);
    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success) {
        hoverCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AI Hover] Request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * 清空缓存
 */
router.post('/clear-cache', (req: Request, res: Response) => {
  hoverCache.clear();
  res.json({ success: true, message: 'Cache cleared' });
});

/**
 * 获取缓存状态
 */
router.get('/cache-stats', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      size: hoverCache.size,
      maxSize: 500,
      ttl: '15 minutes',
    },
  });
});

export default router;
