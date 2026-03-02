/**
 * VisualComparator - 视觉对比服务
 *
 * 使用 Claude 多模态能力对比截图和设计图：
 * - 布局一致性检查
 * - 颜色匹配度
 * - 文字内容对比
 * - 交互元素状态
 *
 * 核心理念：像产品经理一样验收，判断是否"符合设计意图"
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlockParam, ImageBlockParam, TextBlockParam, MessageParam } from '@anthropic-ai/sdk/resources/messages';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 视觉对比配置
 */
export interface VisualComparatorConfig {
  /** 使用的模型（需要支持视觉） */
  model?: string;
  /** 相似度阈值 (0-100) */
  similarityThreshold?: number;
  /** 是否详细分析 */
  detailedAnalysis?: boolean;
  /** API Key（可选，默认从环境变量获取） */
  apiKey?: string;
}

/**
 * 对比结果
 */
export interface ComparisonResult {
  /** 是否通过验收 */
  passed: boolean;
  /** 相似度分数 (0-100) */
  similarityScore: number;
  /** 总体评价 */
  summary: string;
  /** 布局分析 */
  layout: {
    score: number;
    issues: string[];
  };
  /** 颜色分析 */
  colors: {
    score: number;
    issues: string[];
  };
  /** 文字分析 */
  text: {
    score: number;
    issues: string[];
  };
  /** 交互元素分析 */
  interactive: {
    score: number;
    issues: string[];
  };
  /** 所有差异列表 */
  allDifferences: string[];
  /** AI 原始分析 */
  rawAnalysis?: string;
}

/**
 * 图片输入
 */
export interface ImageInput {
  /** base64 数据 */
  base64?: string;
  /** 文件路径 */
  filePath?: string;
  /** MIME 类型 */
  mimeType?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

// ============================================================================
// VisualComparator 实现
// ============================================================================

export class VisualComparator {
  private config: Required<VisualComparatorConfig>;
  private client: Anthropic;

  constructor(config: VisualComparatorConfig = {}) {
    this.config = {
      model: 'claude-sonnet-4-20250514',
      similarityThreshold: 80,
      detailedAnalysis: true,
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || '',
      ...config,
    };

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
    });
  }

  /**
   * 对比截图和设计图
   */
  async compare(
    screenshot: ImageInput,
    designImage: ImageInput,
    context?: string
  ): Promise<ComparisonResult> {
    // 准备图片
    const screenshotData = await this.prepareImage(screenshot);
    const designData = await this.prepareImage(designImage);

    // 构建对比提示
    const prompt = this.buildComparisonPrompt(context);

    // 调用 Claude 多模态 API
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '这是当前页面的截图（实际效果）：',
            } as TextBlockParam,
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: screenshotData.mimeType,
                data: screenshotData.base64,
              },
            } as ImageBlockParam,
            {
              type: 'text',
              text: '\n\n这是设计图（预期效果）：',
            } as TextBlockParam,
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: designData.mimeType,
                data: designData.base64,
              },
            } as ImageBlockParam,
            {
              type: 'text',
              text: `\n\n${prompt}`,
            } as TextBlockParam,
          ],
        },
      ],
    });

    // 解析响应
    return this.parseResponse(response);
  }

  /**
   * 批量对比多张图片
   */
  async compareBatch(
    comparisons: Array<{
      screenshot: ImageInput;
      designImage: ImageInput;
      name: string;
    }>
  ): Promise<Map<string, ComparisonResult>> {
    const results = new Map<string, ComparisonResult>();

    for (const { screenshot, designImage, name } of comparisons) {
      try {
        const result = await this.compare(screenshot, designImage, name);
        results.set(name, result);
      } catch (error) {
        results.set(name, {
          passed: false,
          similarityScore: 0,
          summary: `对比失败: ${error instanceof Error ? error.message : String(error)}`,
          layout: { score: 0, issues: ['对比失败'] },
          colors: { score: 0, issues: [] },
          text: { score: 0, issues: [] },
          interactive: { score: 0, issues: [] },
          allDifferences: ['对比过程出错'],
        });
      }
    }

    return results;
  }

  /**
   * 准备图片数据
   */
  private async prepareImage(input: ImageInput): Promise<{ base64: string; mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' }> {
    let base64: string;
    let mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' = input.mimeType || 'image/png';

    if (input.base64) {
      base64 = input.base64;
    } else if (input.filePath) {
      if (!fs.existsSync(input.filePath)) {
        throw new Error(`图片文件不存在: ${input.filePath}`);
      }

      const buffer = fs.readFileSync(input.filePath);
      base64 = buffer.toString('base64');

      // 根据扩展名推断 MIME 类型
      const ext = path.extname(input.filePath).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') {
        mimeType = 'image/jpeg';
      } else if (ext === '.gif') {
        mimeType = 'image/gif';
      } else if (ext === '.webp') {
        mimeType = 'image/webp';
      }
    } else {
      throw new Error('必须提供 base64 或 filePath');
    }

    return { base64, mimeType };
  }

  /**
   * 构建对比提示
   */
  private buildComparisonPrompt(context?: string): string {
    return `请对比以上两张图片，分析当前页面截图与设计图的差异。

${context ? `**上下文**: ${context}\n\n` : ''}**分析维度**：

1. **布局 (Layout)** - 元素位置、大小、间距、对齐方式
2. **颜色 (Colors)** - 背景色、文字颜色、按钮颜色、边框颜色
3. **文字 (Text)** - 文字内容、字体大小、字体样式
4. **交互元素 (Interactive)** - 按钮、输入框、链接的样式和状态

**评分标准**：
- 90-100: 几乎完全一致，可以接受
- 80-89: 基本一致，有细微差异
- 60-79: 有明显差异，需要修复
- 0-59: 严重不符，必须重做

请以 JSON 格式返回分析结果：

\`\`\`json
{
  "similarityScore": <0-100的整数>,
  "summary": "<一句话总结>",
  "layout": {
    "score": <0-100>,
    "issues": ["问题1", "问题2"]
  },
  "colors": {
    "score": <0-100>,
    "issues": ["问题1", "问题2"]
  },
  "text": {
    "score": <0-100>,
    "issues": ["问题1", "问题2"]
  },
  "interactive": {
    "score": <0-100>,
    "issues": ["问题1", "问题2"]
  },
  "allDifferences": ["差异1", "差异2", "差异3"]
}
\`\`\`

注意：
- 只返回 JSON，不要有其他文字
- 如果某个维度完全一致，issues 为空数组
- similarityScore 应该是四个维度分数的加权平均`;
  }

  /**
   * 解析 AI 响应
   */
  private parseResponse(response: Anthropic.Messages.Message): ComparisonResult {
    // 提取文本内容
    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('AI 响应中没有文本内容');
    }

    const rawAnalysis = textContent.text;

    // 尝试提取 JSON
    const jsonMatch = rawAnalysis.match(/```json\s*([\s\S]*?)\s*```/);
    let jsonStr = jsonMatch ? jsonMatch[1] : rawAnalysis;

    // 清理 JSON 字符串
    jsonStr = jsonStr.trim();

    try {
      const parsed = JSON.parse(jsonStr);

      const result: ComparisonResult = {
        passed: parsed.similarityScore >= this.config.similarityThreshold,
        similarityScore: parsed.similarityScore || 0,
        summary: parsed.summary || '无法解析总结',
        layout: parsed.layout || { score: 0, issues: [] },
        colors: parsed.colors || { score: 0, issues: [] },
        text: parsed.text || { score: 0, issues: [] },
        interactive: parsed.interactive || { score: 0, issues: [] },
        allDifferences: parsed.allDifferences || [],
        rawAnalysis,
      };

      return result;

    } catch (error) {
      // JSON 解析失败，尝试从文本中提取信息
      console.error('JSON parsing failed, attempting to extract from text:', error);

      // 尝试提取分数
      const scoreMatch = rawAnalysis.match(/similarityScore[:\s]+(\d+)/i) ||
                        rawAnalysis.match(/相似度[:\s]+(\d+)/);
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 50;

      return {
        passed: score >= this.config.similarityThreshold,
        similarityScore: score,
        summary: '无法解析详细结果，请查看原始分析',
        layout: { score: 0, issues: ['解析失败'] },
        colors: { score: 0, issues: [] },
        text: { score: 0, issues: [] },
        interactive: { score: 0, issues: [] },
        allDifferences: ['JSON 解析失败，请查看原始分析'],
        rawAnalysis,
      };
    }
  }

  /**
   * 生成对比报告（Markdown 格式）
   */
  generateReport(result: ComparisonResult, name?: string): string {
    const statusEmoji = result.passed ? '✅' : '❌';
    const statusText = result.passed ? '通过' : '未通过';

    let report = `## ${statusEmoji} 视觉对比报告${name ? `: ${name}` : ''}

**状态**: ${statusText}
**相似度**: ${result.similarityScore}% (阈值: ${this.config.similarityThreshold}%)

### 总结
${result.summary}

### 详细分析

| 维度 | 分数 | 状态 |
|------|------|------|
| 布局 | ${result.layout.score}% | ${result.layout.score >= 80 ? '✅' : '⚠️'} |
| 颜色 | ${result.colors.score}% | ${result.colors.score >= 80 ? '✅' : '⚠️'} |
| 文字 | ${result.text.score}% | ${result.text.score >= 80 ? '✅' : '⚠️'} |
| 交互 | ${result.interactive.score}% | ${result.interactive.score >= 80 ? '✅' : '⚠️'} |

`;

    // 添加问题列表
    const allIssues = [
      ...result.layout.issues.map(i => `[布局] ${i}`),
      ...result.colors.issues.map(i => `[颜色] ${i}`),
      ...result.text.issues.map(i => `[文字] ${i}`),
      ...result.interactive.issues.map(i => `[交互] ${i}`),
    ];

    if (allIssues.length > 0) {
      report += `### 发现的问题

`;
      for (const issue of allIssues) {
        report += `- ${issue}\n`;
      }
    }

    if (result.allDifferences.length > 0) {
      report += `
### 差异列表

`;
      for (const diff of result.allDifferences) {
        report += `- ${diff}\n`;
      }
    }

    return report;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建视觉对比器
 */
export function createVisualComparator(config: VisualComparatorConfig = {}): VisualComparator {
  return new VisualComparator(config);
}

/**
 * 快速对比两张图片
 */
export async function compareImages(
  screenshot: ImageInput,
  designImage: ImageInput,
  config: VisualComparatorConfig = {}
): Promise<ComparisonResult> {
  const comparator = createVisualComparator(config);
  return comparator.compare(screenshot, designImage);
}
