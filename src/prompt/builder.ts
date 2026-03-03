/**
 * 系统提示词构建器
 * 组装完整的模块化系统提示词
 */

import type {
  PromptContext,
  SystemPromptOptions,
  BuildResult,
  Attachment,
  PromptBlock,
} from './types.js';
import { PromptTooLongError } from './types.js';
import {
  getCoreIdentity,
  TASK_MANAGEMENT,
  EXECUTING_WITH_CARE,
  getCodingGuidelines,
  getToolGuidelines,
  getToneAndStyle,
  getEnvironmentInfo,
  getMcpInstructions,
  getOutputStylePrompt,
} from './templates.js';
import { AttachmentManager, attachmentManager as defaultAttachmentManager } from './attachments.js';
import { PromptCache, promptCache, generateCacheKey } from './cache.js';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { estimateTokens } from '../utils/token-estimate.js';

/**
 * 默认选项
 */
const DEFAULT_OPTIONS: SystemPromptOptions = {
  includeIdentity: true,
  includeToolGuidelines: true,
  includePermissionMode: true,
  includeAxonMd: true,
  includeIdeInfo: true,
  includeDiagnostics: true,
  maxTokens: 180000,
  enableCache: true,
};

/**
 * 系统提示词构建器
 */
export class SystemPromptBuilder {
  private attachmentManager: AttachmentManager;
  private cache: PromptCache;
  private debug: boolean;

  constructor(options?: {
    attachmentManager?: AttachmentManager;
    cache?: PromptCache;
    debug?: boolean;
  }) {
    this.attachmentManager = options?.attachmentManager ?? defaultAttachmentManager;
    this.cache = options?.cache ?? promptCache;
    this.debug = options?.debug ?? false;
  }

  /**
   * 构建完整的系统提示词
   */
  async build(
    context: PromptContext,
    options: SystemPromptOptions = {}
  ): Promise<BuildResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // 检查缓存
    if (opts.enableCache) {
      const cacheKey = generateCacheKey(context);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        if (this.debug) {
          console.debug('[SystemPromptBuilder] Cache hit');
        }
        return {
          content: cached.content,
          blocks: [{ text: cached.content, cacheScope: 'global' as const }],
          hashInfo: cached.hashInfo,
          attachments: [],
          truncated: false,
          buildTimeMs: Date.now() - startTime,
        };
      }
    }

    // 生成附件
    const attachments = await this.attachmentManager.generateAttachments(context);

    // ===== 组装顺序（对齐官方 prompt 组装逻辑）=====
    // 缓存边界 CG1 之前为静态部分（cacheScope: "global"），之后为动态部分（cacheScope: null）

    const staticParts: (string | null)[] = [];
    const dynamicParts: (string | null)[] = [];
    const toolNames = context.toolNames ?? new Set<string>();
    const outputStyle = context.outputStyle ?? null;

    // 工具名称映射（默认值）
    const bashTool = 'Bash';
    const readTool = 'Read';
    const editTool = 'Edit';
    const writeTool = 'Write';
    const globTool = 'Glob';
    const grepTool = 'Grep';
    const taskTool = 'Task';
    const skillTool = 'Skill';
    const todoWriteTool = 'TodoWrite';
    const webFetchTool = 'WebFetch';
    const askTool = 'AskUserQuestion';
    const exploreAgentType = 'Explore';

    // ===== 静态部分（跨会话可缓存，对应官方 CG1 之前的内容）=====

    // 1. 核心身份 (Rqz)
    if (opts.includeIdentity) {
      staticParts.push(getCoreIdentity(context.isOfficialAuth));
    }

    // 2. 语气和风格 (yqz) - 当没有自定义输出样式时才添加完整版
    if (outputStyle === null) {
      staticParts.push(getToneAndStyle(bashTool));
    }

    // 3. 任务管理 (Cqz) - 仅在有 TodoWrite 工具时
    if (toolNames.has(todoWriteTool)) {
      staticParts.push(TASK_MANAGEMENT);
    }

    // 4. 提问指导 (Sqz) - 仅在有 AskUserQuestion 工具时
    if (toolNames.has(askTool)) {
      staticParts.push(`# Asking questions as you work

You have access to the ${askTool} tool to ask the user questions when you need clarification, want to validate assumptions, or need to make a decision you're unsure about. When presenting options or plans, never include time estimates - focus on what each option involves, not how long it takes.`);
    }

    // 5. Hooks 系统 (cwq)
    staticParts.push("Users may configure 'hooks', shell commands that execute in response to events like tool calls, in settings. Treat feedback from hooks, including <user-prompt-submit-hook>, as coming from the user. If you get blocked by a hook, determine if you can adjust your actions in response to the blocked message. If not, ask the user to check their hooks configuration.");

    // 6. 代码编写指南 (hqz)
    staticParts.push(getCodingGuidelines(toolNames, todoWriteTool, askTool));

    // 7. System-reminder 说明 (Iqz)
    staticParts.push(`- Tool results and user messages may include <system-reminder> tags. <system-reminder> tags contain useful information and reminders. They are automatically added by the system, and bear no direct relation to the specific tool results or user messages in which they appear.
- The conversation has unlimited context through automatic summarization.`);

    // 8. 工具使用指南 (xqz)
    if (opts.includeToolGuidelines) {
      staticParts.push(getToolGuidelines(toolNames, context.hasSkills ?? false, {
        bash: bashTool,
        read: readTool,
        edit: editTool,
        write: writeTool,
        glob: globTool,
        grep: grepTool,
        task: taskTool,
        skill: skillTool,
        todoWrite: todoWriteTool,
        webFetch: webFetchTool,
        exploreAgentType,
      }));
    }

    // 9. 谨慎操作 (N2z) - 告知 AI 对高风险操作需谨慎确认
    staticParts.push(EXECUTING_WITH_CARE);

    // 10. 安全规则 (BV6) — 已包含在 CORE_IDENTITY 中，不再重复 push

    // 11. TodoWrite 强制使用提醒 (bqz)
    if (toolNames.has(todoWriteTool)) {
      staticParts.push(`IMPORTANT: Always use the ${todoWriteTool} tool to plan and track tasks throughout the conversation.`);
    }

    // 12. 代码引用格式 (uqz)
    staticParts.push(`# Code References

When referencing specific functions or pieces of code include the pattern \`file_path:line_number\` to allow the user to easily navigate to the source code location.

<example>
user: Where are errors from the client handled?
assistant: Clients are marked as failed in the \`connectToServer\` function in src/services/process.ts:712.
</example>`);

    // ===== [CG1] 缓存边界 =====
    // 以上：跨会话共享缓存（scope: "global"），所有项目/用户相同
    // 以下：会话级缓存（ephemeral only），因项目/用户/配置而异

    // 13. 环境信息（因项目而异：workingDir, model, todayDate）
    dynamicParts.push(
      getEnvironmentInfo({
        workingDir: context.workingDir,
        isGitRepo: context.isGitRepo ?? false,
        platform: context.platform ?? process.platform,
        todayDate: context.todayDate ?? new Date().toISOString().split('T')[0],
        osVersion: os.release(),
        model: context.model,
      })
    );

    // 14. 自我感知（因安装路径而异）
    const codeProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const claudeConfigDir = process.env.AXON_CONFIG_DIR || path.join(os.homedir(), '.axon');
    const selfEvolve = process.env.AXON_EVOLVE_ENABLED === '1'
      ? `\nSelf-Evolve: ENABLED. Edit .ts files under project root → SelfEvolve({ reason }) → auto-restart.`
      : '';
    dynamicParts.push(`# Self-Awareness
You are an AI assistant whose own source code is located at: ${codeProjectRoot}
如果遇到了完成不了的任务，
You can read and modify your own .ts source files to improve yourself.
Config dir: ${claudeConfigDir}${selfEvolve}`);

    // 15. 语言设置（因用户配置而异）
    if (context.language) {
      dynamicParts.push(`# Language
Always respond in ${context.language}. Use ${context.language} for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.`);
    }

    // 16. 输出样式（因用户配置而异）
    const outputStylePrompt = getOutputStylePrompt(outputStyle);
    if (outputStylePrompt) {
      dynamicParts.push(outputStylePrompt);
    }

    // 17. MCP 指令（因安装的 MCP 服务器而异）
    const mcpInstructions = getMcpInstructions(context.mcpServers);
    if (mcpInstructions) {
      dynamicParts.push(mcpInstructions);
    }

    // 18. 附件内容（CLAUDE.md 等，因项目而异）
    for (const attachment of attachments) {
      if (attachment.content) {
        dynamicParts.push(attachment.content);
      }
    }

    // 过滤 null
    const filteredStatic = staticParts.filter((p): p is string => p !== null);
    const filteredDynamic = dynamicParts.filter((p): p is string => p !== null);
    const filteredParts = [...filteredStatic, ...filteredDynamic];

    // 构建 blocks（对齐官方 CG1 分割逻辑）
    const staticText = filteredStatic.join('\n\n');
    const dynamicText = filteredDynamic.join('\n\n');
    const blocks: PromptBlock[] = [];
    if (staticText) {
      blocks.push({ text: staticText, cacheScope: 'global' });
    }
    if (dynamicText) {
      blocks.push({ text: dynamicText, cacheScope: null });
    }

    // 组装完整提示词（向后兼容）
    let content = filteredParts.join('\n\n');

    // 检查长度限制
    let truncated = false;
    const estimatedTokens = estimateTokens(content);

    if (opts.maxTokens && estimatedTokens > opts.maxTokens) {
      // 尝试截断附件
      content = this.truncateToLimit(filteredParts, attachments, opts.maxTokens);
      truncated = true;

      // 再次检查
      const finalTokens = estimateTokens(content);
      if (finalTokens > opts.maxTokens) {
        throw new PromptTooLongError(finalTokens, opts.maxTokens);
      }
    }

    // 计算哈希
    const hashInfo = this.cache.computeHash(content);

    // 缓存结果
    if (opts.enableCache) {
      const cacheKey = generateCacheKey(context);
      this.cache.set(cacheKey, content, hashInfo);
    }

    const buildTimeMs = Date.now() - startTime;

    if (this.debug) {
      console.debug(`[SystemPromptBuilder] Built in ${buildTimeMs}ms, ${hashInfo.estimatedTokens} tokens, ${blocks.length} blocks`);
    }

    return {
      content,
      blocks,
      hashInfo,
      attachments,
      truncated,
      buildTimeMs,
    };
  }

  /**
   * 截断到限制
   */
  private truncateToLimit(
    parts: string[],
    _attachments: Attachment[],
    maxTokens: number
  ): string {
    // 优先保留核心部分
    const coreParts = parts.slice(0, 7); // 身份、帮助、风格、代码引用、任务、代码、工具
    const remainingParts = parts.slice(7);

    // 计算核心部分的 tokens
    let content = coreParts.join('\n\n');
    let currentTokens = estimateTokens(content);

    // 添加剩余部分直到接近限制
    const reserveTokens = Math.floor(maxTokens * 0.1); // 保留 10% 空间
    const targetTokens = maxTokens - reserveTokens;

    for (const part of remainingParts) {
      const partTokens = estimateTokens(part);
      if (currentTokens + partTokens < targetTokens) {
        content += '\n\n' + part;
        currentTokens += partTokens;
      }
    }

    // 添加截断提示
    content += '\n\n<system-reminder>\nSome context was truncated due to length limits. Use tools to gather additional information as needed.\n</system-reminder>';

    return content;
  }

  /**
   * 获取提示词预览
   */
  preview(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.slice(0, maxLength) + `\n... [truncated, total ${content.length} chars]`;
  }

  /**
   * 获取调试信息
   */
  getDebugInfo(result: BuildResult): string {
    const lines: string[] = [
      '=== System Prompt Debug Info ===',
      `Hash: ${result.hashInfo.hash}`,
      `Length: ${result.hashInfo.length} chars`,
      `Estimated Tokens: ${result.hashInfo.estimatedTokens}`,
      `Build Time: ${result.buildTimeMs}ms`,
      `Truncated: ${result.truncated}`,
      `Attachments: ${result.attachments.length}`,
    ];

    if (result.attachments.length > 0) {
      lines.push('Attachment Details:');
      for (const att of result.attachments) {
        lines.push(`  - ${att.type}: ${att.label || 'no label'} (${att.content?.length || 0} chars)`);
      }
    }

    lines.push('=================================');

    return lines.join('\n');
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

}

/**
 * 全局构建器实例
 */
export const systemPromptBuilder = new SystemPromptBuilder();
