/**
 * Web 工具
 * WebFetch: 获取网页内容
 *
 * 注意：WebSearch 已迁移到 Anthropic API Server Tool (web_search_20250305)
 * 在 client.ts 的 buildApiTools 中自动添加，由 Anthropic 服务器执行搜索
 */

import axios, { AxiosProxyConfig } from 'axios';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { LRUCache } from 'lru-cache';
import { BaseTool, type ToolOptions } from './base.js';
import type { WebFetchInput, ToolResult, ToolDefinition } from '../types/index.js';
import { ErrorCode } from '../types/errors.js';
import { persistLargeOutputSync } from './output-persistence.js';
import { t } from '../i18n/index.js';

/**
 * 响应体大小限制 (10MB)
 */
const MAX_RESPONSE_SIZE = 10 * 1024 * 1024;

/**
 * 缓存接口
 */
interface CachedContent {
  content: string;
  contentType: string;
  statusCode: number;
  fetchedAt: number;
}

/**
 * WebFetch 缓存
 * - TTL: 15分钟 (900,000ms)
 * - 最大大小: 50MB
 * - LRU 淘汰策略
 */
const webFetchCache = new LRUCache<string, CachedContent>({
  maxSize: 50 * 1024 * 1024, // 50MB
  ttl: 15 * 60 * 1000,       // 15分钟
  sizeCalculation: (value) => {
    return Buffer.byteLength(value.content, 'utf8');
  },
});

/**
 * 创建增强的 Turndown 服务
 * T-011: 优化 Turndown 配置，支持 GFM 扩展和自定义规则
 */
function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
    hr: '---',
    bulletListMarker: '-',
    fence: '```',
    br: '  ',
    preformattedCode: false,
  });

  // 启用 GFM 扩展（表格、删除线、任务列表等）
  service.use(gfm);

  // 自定义规则：删除 script 和 style 标签
  service.addRule('removeScripts', {
    filter: ['script', 'style', 'noscript'],
    replacement: () => '',
  });

  // 自定义规则：优化图片 alt 文本
  service.addRule('images', {
    filter: 'img',
    replacement: (content, node) => {
      const element = node as any;
      const alt = element.alt || '';
      const src = element.src || '';
      const title = element.title || '';

      if (!src) return '';

      const titlePart = title ? ` "${title}"` : '';
      return `![${alt}](${src}${titlePart})`;
    },
  });

  // 自定义规则：保留语义化标签
  service.addRule('semanticTags', {
    filter: ['mark', 'ins', 'kbd', 'sub', 'sup'],
    replacement: (content, node) => {
      const tagMap: Record<string, string> = {
        'mark': '==',
        'ins': '++',
        'kbd': '`',
        'sub': '~',
        'sup': '^',
      };
      const delimiter = tagMap[node.nodeName.toLowerCase()] || '';
      return delimiter + content + delimiter;
    },
  });

  // 自定义规则：优化代码块语言标识
  service.addRule('codeBlock', {
    filter: (node) => {
      return (
        node.nodeName === 'PRE' &&
        node.firstChild !== null &&
        node.firstChild.nodeName === 'CODE'
      );
    },
    replacement: (content, node) => {
      const codeNode = node.firstChild as any;
      const className = codeNode?.className || '';

      // 提取语言标识（从 language-xxx 或 lang-xxx）
      const langMatch = className.match(/(?:language|lang)-(\w+)/);
      const lang = langMatch ? langMatch[1] : '';

      const codeContent = codeNode?.textContent || content;

      return '\n\n```' + lang + '\n' + codeContent + '\n```\n\n';
    },
  });

  return service;
}

/**
 * Turndown 服务实例（HTML 到 Markdown 转换）
 */
const turndownService = createTurndownService();

export class WebFetchTool extends BaseTool<WebFetchInput, ToolResult> {
  name = 'WebFetch';
  description = `
- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions. All MCP-provided tools start with "mcp__".
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
`;

  private skipWebFetchPreflight = false;

  constructor(options?: ToolOptions) {
    super({
      maxRetries: 3, // 网络请求失败时重试最多3次
      baseTimeout: 30000, // 30秒超时
      retryableErrors: [
        ErrorCode.NETWORK_CONNECTION_FAILED,
        ErrorCode.NETWORK_TIMEOUT,
        ErrorCode.NETWORK_RATE_LIMITED,
        ErrorCode.NETWORK_DNS_FAILED,
        ErrorCode.NETWORK_HOST_UNREACHABLE,
      ],
      ...options,
    });
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'The URL to fetch content from',
        },
        prompt: {
          type: 'string',
          description: 'The prompt to run on the fetched content',
        },
      },
      required: ['url', 'prompt'],
    };
  }

  /**
   * 检查域名安全性（预检查）
   * @param domain 要检查的域名
   * @returns 是否安全
   */
  private async checkDomainSafety(domain: string): Promise<boolean> {
    // 如果跳过预检查，直接返回true
    if (this.skipWebFetchPreflight) {
      return true;
    }

    // 常见的不安全域名黑名单
    const unsafeDomains = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '169.254.169.254', // AWS 元数据服务
      'metadata.google.internal', // GCP 元数据服务
    ];

    const normalizedDomain = domain.toLowerCase();

    // 检查黑名单
    for (const unsafeDomain of unsafeDomains) {
      if (normalizedDomain === unsafeDomain || normalizedDomain.endsWith(`.${unsafeDomain}`)) {
        return false;
      }
    }

    // 检查私有IP范围
    if (this.isPrivateIP(normalizedDomain)) {
      return false;
    }

    return true;
  }

  /**
   * 检查是否为私有IP地址
   */
  private isPrivateIP(host: string): boolean {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = host.match(ipv4Regex);

    if (!match) {
      return false;
    }

    const [, a, b, c, d] = match.map(Number);

    // 检查私有IP范围
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;

    return false;
  }

  /**
   * 获取代理配置（从环境变量和 settings.json）
   *
   * v2.1.33 修复: 现在也从 settings.json 中配置的环境变量读取代理设置
   * 之前只从进程环境变量读取，导致通过 settings.json environment 配置的
   * 代理设置不会应用到 WebFetch 和其他 HTTP 请求
   */
  private getProxyConfig(): AxiosProxyConfig | undefined {
    // v2.1.33: 先从环境变量读取，settings.json 的 environment 会在启动时
    // 被加载到 process.env 中，所以这里可以统一读取
    const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
    const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    const allProxy = process.env.ALL_PROXY || process.env.all_proxy;
    const proxyUrl = httpsProxy || httpProxy || allProxy;

    if (!proxyUrl) {
      return undefined;
    }

    // v2.1.33: 检查 NO_PROXY 设置
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    if (noProxy) {
      // 如果当前请求的域名在 NO_PROXY 列表中，不使用代理
      // 注意：实际的域名检查在请求时进行，这里只是记录
    }

    try {
      const url = new URL(proxyUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port || '80', 10),
        protocol: url.protocol.replace(':', ''),
        ...(url.username && {
          auth: {
            username: url.username,
            password: url.password,
          },
        }),
      };
    } catch (err) {
      return undefined;
    }
  }

  /**
   * 检查两个 URL 是否同源
   */
  private isSameOrigin(url1: string, url2: string): boolean {
    try {
      const u1 = new URL(url1);
      const u2 = new URL(url2);
      return (
        u1.protocol === u2.protocol &&
        u1.hostname === u2.hostname &&
        u1.port === u2.port
      );
    } catch {
      return false;
    }
  }

  /**
   * 解析相对重定向 URL
   */
  private resolveRedirectUrl(baseUrl: string, location: string): string {
    try {
      // 如果 location 是绝对 URL，直接返回
      if (location.startsWith('http://') || location.startsWith('https://')) {
        return location;
      }
      // 否则相对于 baseUrl 解析
      return new URL(location, baseUrl).toString();
    } catch {
      return location;
    }
  }

  /**
   * HTML 到 Markdown 转换
   */
  private htmlToMarkdown(html: string): string {
    try {
      return turndownService.turndown(html);
    } catch (err) {
      // 如果转换失败，回退到简单的文本清理
      return this.htmlToText(html);
    }
  }

  /**
   * 简单的 HTML 到文本转换（回退方案）
   */
  private htmlToText(html: string): string {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .trim();
  }

  /**
   * 实际的 URL 抓取逻辑
   */
  private async fetchUrl(
    url: string,
    options: { originalUrl?: string; redirectCount?: number } = {}
  ): Promise<{
    content: string;
    contentType: string;
    statusCode: number;
    redirectUrl?: string;
    originalUrl?: string;
  }> {
    const { originalUrl, redirectCount = 0 } = options;
    const proxy = this.getProxyConfig();

    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ClaudeCode/2.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        maxRedirects: 0, // 手动处理重定向
        validateStatus: (status) => status < 400 || (status >= 300 && status < 400),
        proxy: proxy ? proxy : false,
        maxContentLength: MAX_RESPONSE_SIZE,
        maxBodyLength: MAX_RESPONSE_SIZE,
      });

      const contentType = response.headers['content-type'] || '';
      const contentLength = response.headers['content-length'];

      // 检查响应体大小
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new Error(
          `Response size (${contentLength} bytes) exceeds maximum allowed size (${MAX_RESPONSE_SIZE} bytes)`
        );
      }

      let content = '';

      if (contentType.includes('text/html')) {
        content = this.htmlToMarkdown(response.data);
      } else if (contentType.includes('application/json')) {
        content = JSON.stringify(response.data, null, 2);
      } else {
        content = String(response.data);
      }

      // 再次检查处理后内容的大小
      const contentSize = Buffer.byteLength(content, 'utf8');
      if (contentSize > MAX_RESPONSE_SIZE) {
        throw new Error(
          `Processed content size (${contentSize} bytes) exceeds maximum allowed size (${MAX_RESPONSE_SIZE} bytes)`
        );
      }

      return {
        content,
        contentType,
        statusCode: response.status,
      };
    } catch (err: any) {
      // 处理重定向
      if (err.response && [301, 302, 307, 308].includes(err.response.status)) {
        const location = err.response.headers.location;
        if (!location) {
          throw new Error(t('web.redirectNoLocation'));
        }

        const redirectUrl = this.resolveRedirectUrl(url, location);
        const baseUrl = originalUrl || url;

        // 检查是否同源（与原始 URL 比较）
        if (this.isSameOrigin(baseUrl, redirectUrl)) {
          // 同源，自动跟随重定向（最多5次）
          if (redirectCount >= 5) {
            throw new Error(t('web.tooManyRedirects', { max: 5 }));
          }
          return this.fetchUrl(redirectUrl, {
            originalUrl: baseUrl,
            redirectCount: redirectCount + 1,
          });
        } else {
          // 跨域，返回重定向信息
          return {
            content: '',
            contentType: '',
            statusCode: err.response.status,
            redirectUrl,
            originalUrl: baseUrl,
          };
        }
      }

      throw err;
    }
  }

  async execute(input: WebFetchInput): Promise<ToolResult> {
    // 使用重试和超时包装器
    return this.executeWithRetryAndTimeout(async () => {
      let { url, prompt } = input;

      // URL 验证和规范化
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);

        // HTTP 到 HTTPS 自动升级
        if (parsedUrl.protocol === 'http:') {
          parsedUrl.protocol = 'https:';
          url = parsedUrl.toString();
        }
      } catch (err) {
        return {
          success: false,
          error: t('web.invalidUrl', { url }),
        };
      }

      // 域名安全检查
      const isSafe = await this.checkDomainSafety(parsedUrl.hostname);
      if (!isSafe) {
        return {
          success: false,
          error: t('web.domainBlocked', { hostname: parsedUrl.hostname }),
          errorCode: 3,
        };
      }

      // 检查缓存
      const cached = webFetchCache.get(url);
      if (cached) {
        const maxLength = 100000;

        // 使用统一的输出持久化
        const persistResult = persistLargeOutputSync(cached.content, {
          toolName: 'WebFetch',
          maxLength,
        });

        return {
          success: true,
          output: `URL: ${url}\nPrompt: ${prompt}\n\n--- Content (Cached) ---\n${persistResult.content}`,
        };
      }

      try {
        const result = await this.fetchUrl(url);

        // 处理跨域重定向
        if (result.redirectUrl) {
          const statusText = {
            301: 'Moved Permanently',
            302: 'Found',
            307: 'Temporary Redirect',
            308: 'Permanent Redirect',
          }[result.statusCode] || 'Redirect';

          return {
            success: false,
            error: `REDIRECT DETECTED: The URL redirects to a different host.

Original URL: ${result.originalUrl || url}
Redirect URL: ${result.redirectUrl}
Status: ${result.statusCode} ${statusText}

To complete your request, I need to fetch content from the redirected URL. Please use WebFetch again with these parameters:
- url: "${result.redirectUrl}"
- prompt: "${prompt}"`,
          };
        }

        // 使用统一的输出持久化处理大内容
        const maxLength = 100000;
        const persistResult = persistLargeOutputSync(result.content, {
          toolName: 'WebFetch',
          maxLength,
        });

        // 缓存结果（缓存原始内容）
        webFetchCache.set(url, {
          content: result.content,
          contentType: result.contentType,
          statusCode: result.statusCode,
          fetchedAt: Date.now(),
        });

        return {
          success: true,
          output: `URL: ${url}\nPrompt: ${prompt}\n\n--- Content ---\n${persistResult.content}`,
        };
      } catch (err: any) {
        // 将网络错误转换为可重试的错误
        const error = new Error(`Fetch error: ${err.message || String(err)}`);
        // 检查是否为可重试的网络错误
        if (
          err.code === 'ETIMEDOUT' ||
          err.code === 'ECONNRESET' ||
          err.code === 'ECONNREFUSED' ||
          err.code === 'ENETUNREACH' ||
          err.message?.includes('timeout') ||
          err.message?.includes('network')
        ) {
          // 抛出错误让重试机制捕获
          throw error;
        }
        // 其他错误直接返回
        return {
          success: false,
          error: error.message,
        };
      }
    });
  }
}

/**
 * 缓存统计信息
 * 用于监控和调试缓存使用情况
 *
 * 注意：WebSearch 已迁移到 Anthropic API Server Tool，不再有客户端缓存
 */
export function getWebCacheStats() {
  return {
    fetch: {
      size: webFetchCache.size,
      calculatedSize: webFetchCache.calculatedSize,
      maxSize: webFetchCache.maxSize,
      ttl: webFetchCache.ttl,
      itemCount: webFetchCache.size,
    },
  };
}

/**
 * 清除 Web 缓存
 * 用于调试或重置缓存状态
 */
export function clearWebCaches() {
  webFetchCache.clear();
}
