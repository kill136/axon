/**
 * AutoComplete API
 *
 * 为代码编辑器提供自动补全功能
 * - 路径补全：import/require 语句的文件路径补全
 * - AI Inline 补全：基于上下文的智能代码补全（Ghost Text）
 */

import { Router, Request, Response } from 'express';
import { ClaudeClient } from '../../../core/client.js';
import { webAuth } from '../web-auth.js';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const router = Router();

// ============================================================================
// 缓存配置
// ============================================================================

// AI Inline 补全结果缓存
const inlineCompleteCache = new LRUCache<string, InlineCompleteResponse>({
  max: 200,
  ttl: 1000 * 60 * 5, // 5分钟
});

// 防止重复请求
const pendingRequests = new Map<string, Promise<any>>();

// ============================================================================
// 类型定义
// ============================================================================

interface CompletePathRequest {
  filePath: string;
  prefix: string;
  root?: string;
}

interface CompletePathResponse {
  success: boolean;
  items: Array<{
    label: string;
    kind: 'file' | 'folder';
    detail?: string;
  }>;
  error?: string;
}

interface InlineCompleteRequest {
  filePath: string;
  language: string;
  prefix: string;
  suffix: string;
  currentLine: string;
  cursorColumn: number;
}

interface InlineCompleteResponse {
  success: boolean;
  completion?: string;
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
      model: 'claude-haiku-4-5-20251001', // AI 补全使用 haiku 以节省成本
    });
  } catch (error) {
    console.error('[AutoComplete] Failed to initialize client:', error);
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
    console.error('[AutoComplete] API call failed:', error);
    throw error;
  }
}

// ============================================================================
// API 端点
// ============================================================================

/**
 * POST /complete-path - 路径补全（import/require 语句）
 */
router.post('/complete-path', async (req: Request, res: Response) => {
  try {
    const { filePath, prefix, root }: CompletePathRequest = req.body;

    if (!filePath || prefix === undefined) {
      return res.status(400).json({
        success: false,
        items: [],
        error: 'Missing required parameters: filePath and prefix',
      });
    }

    // 确定搜索目录
    let searchDir: string;
    
    if (prefix.startsWith('./') || prefix.startsWith('../')) {
      // 相对于当前文件所在目录
      const currentFileDir = path.dirname(filePath);
      searchDir = path.resolve(currentFileDir, prefix);
    } else if (prefix.startsWith('@/')) {
      // 相对于项目根目录
      if (!root) {
        return res.status(400).json({
          success: false,
          items: [],
          error: '@/ path requires root parameter',
        });
      }
      const relPath = prefix.substring(2); // 去掉 @/
      searchDir = path.resolve(root, relPath);
    } else {
      // 默认相对于当前文件所在目录
      const currentFileDir = path.dirname(filePath);
      searchDir = path.resolve(currentFileDir, prefix);
    }

    // 如果 searchDir 是一个完整的文件路径，取父目录
    let dirToScan = searchDir;
    let filterPrefix = '';
    
    try {
      const stats = fs.statSync(searchDir);
      if (stats.isFile()) {
        dirToScan = path.dirname(searchDir);
        filterPrefix = path.basename(searchDir);
      }
    } catch {
      // 路径不存在，可能是部分输入
      dirToScan = path.dirname(searchDir);
      filterPrefix = path.basename(searchDir);
    }

    // 读取目录
    const items: Array<{ label: string; kind: 'file' | 'folder'; detail?: string }> = [];

    try {
      if (!fs.existsSync(dirToScan)) {
        return res.json({
          success: true,
          items: [],
        });
      }

      const entries = fs.readdirSync(dirToScan, { withFileTypes: true });

      for (const entry of entries) {
        const name = entry.name;

        // 过滤隐藏文件和特殊目录
        if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || name === 'build') {
          continue;
        }

        // 过滤匹配前缀
        if (filterPrefix && !name.toLowerCase().startsWith(filterPrefix.toLowerCase())) {
          continue;
        }

        const isDir = entry.isDirectory();
        let label = name;

        // 文件去掉扩展名（仅限 TS/JS）
        if (!isDir) {
          const ext = path.extname(name);
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            label = name.substring(0, name.length - ext.length);
          }
        }

        items.push({
          label,
          kind: isDir ? 'folder' : 'file',
          detail: isDir ? undefined : path.extname(name),
        });

        // 最多返回 50 个结果
        if (items.length >= 50) {
          break;
        }
      }
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        items: [],
        error: `Failed to read directory: ${error.message}`,
      });
    }

    res.json({
      success: true,
      items,
    });
  } catch (error: any) {
    console.error('[AutoComplete] /complete-path request processing failed:', error);
    res.status(500).json({
      success: false,
      items: [],
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * POST /inline-complete - AI Inline 补全（Ghost Text）
 */
router.post('/inline-complete', async (req: Request, res: Response) => {
  try {
    const { filePath, language, prefix, suffix, currentLine, cursorColumn }: InlineCompleteRequest = req.body;

    if (!filePath || !language || !currentLine || cursorColumn === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: filePath, language, currentLine, cursorColumn',
      });
    }

    // 检查缓存
    const cacheKey = `inline:${filePath}:${hashContent(currentLine)}:${cursorColumn}`;
    const cached = inlineCompleteCache.get(cacheKey);
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
    const requestPromise = (async (): Promise<InlineCompleteResponse> => {
      const prompt = `You are a code completion engine. Based on the code context, predict the code the user is about to type next.

File: ${filePath}
Language: ${language}

Code context (before cursor):
\`\`\`${language}
${prefix}
\`\`\`

Code context (after cursor):
\`\`\`${language}
${suffix}
\`\`\`

Current line: ${currentLine}
Cursor position: column ${cursorColumn}

Requirements:
- Only output the completion code text, no explanations
- Start completion from the cursor position, do not repeat existing code
- Completion should naturally follow the existing code
- Maintain consistent style with surrounding code (indentation, naming, etc.)
- If unsure what to complete, return an empty string
- Complete 1-3 lines of code, no more`;

      try {
        const response = await callClaude(prompt);
        if (!response) {
          return { success: false, error: 'Failed to get AI response' };
        }

        // 后处理：去掉 markdown 代码块标记
        let completion = response.trim();
        
        // 去掉可能的 ```language 和 ```
        completion = completion.replace(/^```[a-z]*\n?/i, '');
        completion = completion.replace(/\n?```$/, '');
        completion = completion.trim();

        return {
          success: true,
          completion,
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || 'AI completion failed',
        };
      }
    })();

    pendingRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;

      // 只缓存成功的结果
      if (result.success && result.completion) {
        inlineCompleteCache.set(cacheKey, result);
      }

      res.json(result);
    } finally {
      pendingRequests.delete(cacheKey);
    }
  } catch (error: any) {
    console.error('[AutoComplete] /inline-complete request processing failed:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
});

export default router;
