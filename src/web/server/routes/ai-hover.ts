/**
 * AI Hover API
 *
 * 为代码编辑器提供 AI 驱动的智能悬停提示
 * 当用户将鼠标悬停在代码符号上时，调用 Claude API 生成详细的文档说明
 * 对自定义符号支持全链路分析（跨文件引用收集）
 */

import { Router, Request, Response } from 'express';
import * as path from 'path';
import { ClaudeClient } from '../../../core/client.js';
import { webAuth } from '../web-auth.js';
import { LRUCache } from 'lru-cache';
import { search as rgSearch, isRipgrepAvailable } from '../../../search/ripgrep.js';

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
  /** 被引用方（谁在使用这个符号） */
  usedBy?: Array<{
    file: string;
    line: number;
    context: string;
  }>;
  /** 下级依赖（这个符号使用了什么） */
  uses?: string[];
  /** 在项目中的角色 */
  role?: string;
  /** 错误信息 */
  error?: string;
  /** 是否来自缓存 */
  fromCache?: boolean;
}

// ============================================================================
// 跨文件引用分析
// ============================================================================

// 常见语法关键字（不需要跨文件分析）
const SYNTAX_KEYWORDS = new Set([
  // JS/TS
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return',
  'function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var', 'new', 'this',
  'import', 'export', 'default', 'from', 'as', 'async', 'await', 'yield', 'throw', 'try',
  'catch', 'finally', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'super',
  'extends', 'implements', 'static', 'public', 'private', 'protected', 'abstract',
  'readonly', 'override', 'declare', 'module', 'namespace', 'require',
  // 类型
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'null', 'undefined',
  'object', 'symbol', 'bigint', 'true', 'false',
  // Python
  'def', 'lambda', 'with', 'pass', 'raise', 'except', 'global', 'nonlocal',
  'and', 'or', 'not', 'is', 'None', 'True', 'False', 'self', 'cls',
  // Go
  'func', 'package', 'defer', 'go', 'chan', 'select', 'range', 'map', 'struct',
  // Rust
  'fn', 'let', 'mut', 'pub', 'mod', 'use', 'impl', 'trait', 'match', 'loop',
  // CSS
  'display', 'flex', 'grid', 'block', 'inline', 'none', 'auto', 'inherit',
  // HTML
  'div', 'span', 'input', 'button', 'form', 'table', 'img', 'link', 'script',
]);

/**
 * 判断是否是自定义符号（需要跨文件分析）
 */
function isCustomSymbol(symbolName: string): boolean {
  if (symbolName.length < 3) return false;
  if (SYNTAX_KEYWORDS.has(symbolName)) return false;
  if (/^[a-z]+$/.test(symbolName) && symbolName.length < 6) return false;
  return true;
}

/**
 * 跨文件引用信息
 */
interface CrossFileReference {
  file: string;
  line: number;
  context: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * 收集跨文件引用
 */
async function collectCrossFileReferences(
  symbolName: string,
  currentFilePath: string,
  projectRoot: string,
): Promise<CrossFileReference[]> {
  if (!isRipgrepAvailable()) return [];

  try {
    const result = await rgSearch({
      pattern: `\\b${escapeRegex(symbolName)}\\b`,
      cwd: projectRoot,
      glob: '!{node_modules,dist,.git,build,coverage,*.min.*}/**',
      maxCount: 10,
      timeout: 3000,
    });

    const currentRelative = path.relative(projectRoot, currentFilePath).replace(/\\/g, '/');
    const refs: CrossFileReference[] = [];
    const seen = new Set<string>();

    for (const m of result.matches) {
      const relPath = m.path.replace(/\\/g, '/');
      if (relPath === currentRelative) continue;
      if (relPath.endsWith('.d.ts')) continue;
      const key = `${relPath}:${m.lineNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);

      refs.push({
        file: relPath,
        line: m.lineNumber,
        context: m.lineContent.trim(),
      });

      if (refs.length >= 15) break;
    }

    return refs;
  } catch (err) {
    console.error('[AI Hover] Cross-file reference search failed:', err);
    return [];
  }
}

// ============================================================================
// 核心逻辑
// ============================================================================

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
  await webAuth.ensureValidToken();
  const client = createClient();
  if (!client) {
    return {
      success: false,
      error: 'API client not initialized, please check API Key configuration',
    };
  }

  // 对自定义符号收集跨文件引用
  let crossFileRefs: CrossFileReference[] = [];
  if (isCustomSymbol(req.symbolName) && req.filePath) {
    crossFileRefs = await collectCrossFileReferences(
      req.symbolName,
      req.filePath,
      process.cwd(),
    );
  }

  const prompt = buildPrompt(req, crossFileRefs);

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

    const content = response.content?.[0];
    if (content?.type === 'text') {
      const result = parseAIResponse(content.text);
      // 附加原始引用数据（AI 可能不会完整返回）
      if (crossFileRefs.length > 0 && result.success && !result.usedBy) {
        result.usedBy = crossFileRefs.slice(0, 8);
      }
      return result;
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
function buildPrompt(req: AIHoverRequest, crossFileRefs: CrossFileReference[] = []): string {
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

  // 跨文件引用上下文
  if (crossFileRefs.length > 0) {
    parts.push(``);
    parts.push(`## Cross-file references (where this symbol is used in the project)`);
    // 按文件分组
    const byFile = new Map<string, CrossFileReference[]>();
    for (const ref of crossFileRefs) {
      const arr = byFile.get(ref.file) || [];
      arr.push(ref);
      byFile.set(ref.file, arr);
    }
    byFile.forEach((refs, file) => {
      parts.push(`### ${file}`);
      parts.push('```');
      for (const ref of refs) {
        parts.push(`L${ref.line}: ${ref.context}`);
      }
      parts.push('```');
    });
  }

  parts.push(``);
  parts.push(`## Output requirements`);
  parts.push(`Please only analyze the line marked with >>>, and output in JSON format:`);
  parts.push(`- brief: One-sentence short description (required, describe what this symbol does)`);
  parts.push(`- detail: Detailed explanation (optional, 2-3 sentences)`);
  parts.push(`- params: Parameter description array (for functions/methods, each parameter includes name, type, description)`);
  parts.push(`- returns: Return value description (if any, includes type, description)`);
  parts.push(`- examples: Usage examples array (1-2 short code examples)`);
  parts.push(`- notes: Notes array (optional, important usage notes)`);

  if (crossFileRefs.length > 0) {
    parts.push(`- role: One sentence describing the role of this symbol in the project (based on cross-file references)`);
    parts.push(`- usedBy: Array of objects { file, line, context } describing where this symbol is referenced (pick the most important 5-8 from the cross-file references above)`);
    parts.push(`- uses: Array of strings listing key symbols/dependencies this symbol relies on (extracted from its definition)`);
  }

  parts.push(``);
  parts.push(`Only output JSON, no other content. Keep it concise.`);

  if (req.locale === 'zh') {
    parts.push(``);
    parts.push(`IMPORTANT: All text values in the JSON (brief, detail, role, params descriptions, returns description, examples, notes, uses) MUST be written in Chinese (中文). The "file" and "context" fields in usedBy should keep original code.`);
  }

  return parts.join('\n');
}

/**
 * 解析 AI 响应
 */
function parseAIResponse(text: string): AIHoverResult {
  try {
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
      usedBy: parsed.usedBy || undefined,
      uses: parsed.uses || undefined,
      role: parsed.role || undefined,
    };
  } catch (error) {
    return {
      success: true,
      brief: text.trim().split('\n')[0] || 'Unable to parse documentation',
      detail: text.trim(),
    };
  }
}

// ============================================================================
// 路由
// ============================================================================

/**
 * AI Hover API 端点
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const hoverReq: AIHoverRequest = req.body;

    if (!hoverReq.symbolName || !hoverReq.codeContext) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: symbolName and codeContext',
      });
    }

    const cacheKey = getCacheKey(hoverReq);
    const cached = hoverCache.get(cacheKey);
    if (cached) {
      return res.json({ ...cached, fromCache: true });
    }

    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      const result = await pending;
      return res.json({ ...result, fromCache: true });
    }

    const requestPromise = generateHoverDoc(hoverReq);
    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

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
