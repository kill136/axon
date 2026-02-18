/**
 * 系统提示词预览和调试工具
 * 用于分析、比较和预览系统提示词
 */

import chalk from 'chalk';
import { estimateTokens } from '../utils/token-estimate.js';

/**
 * 预览选项
 */
export interface PreviewOptions {
  /** 最大显示长度 */
  maxLength?: number;
  /** 显示 token 数量 */
  showTokenCount?: boolean;
  /** 显示各部分标题 */
  showSections?: boolean;
  /** 高亮变化 */
  highlightChanges?: boolean;
  /** 输出格式 */
  format?: 'plain' | 'markdown' | 'json';
}

/**
 * 提示词部分
 */
export interface PromptSection {
  /** 部分名称 */
  name: string;
  /** 部分内容 */
  content: string;
  /** token 数量 */
  tokens: number;
  /** 开始位置 */
  startIndex: number;
  /** 结束位置 */
  endIndex: number;
}

/**
 * 分析结果
 */
export interface AnalysisResult {
  /** 总 token 数 */
  totalTokens: number;
  /** 总字符数 */
  totalChars: number;
  /** 各个部分 */
  sections: PromptSection[];
  /** 警告信息 */
  warnings: string[];
  /** 统计信息 */
  stats: {
    /** 平均每部分 token */
    avgTokensPerSection: number;
    /** 最大部分 */
    largestSection: PromptSection | null;
    /** 最小部分 */
    smallestSection: PromptSection | null;
  };
}

/**
 * Diff 结果
 */
export interface DiffResult {
  /** 添加的行 */
  additions: DiffLine[];
  /** 删除的行 */
  deletions: DiffLine[];
  /** 修改的行 */
  modifications: DiffLine[];
  /** 未变化的行数 */
  unchangedLines: number;
  /** 变化统计 */
  stats: {
    addedChars: number;
    deletedChars: number;
    addedTokens: number;
    deletedTokens: number;
  };
}

/**
 * Diff 行
 */
export interface DiffLine {
  /** 行号 */
  lineNumber: number;
  /** 内容 */
  content: string;
  /** 类型 */
  type: 'add' | 'delete' | 'modify';
}

/**
 * 提示词预览工具
 */
export class PromptPreview {
  /**
   * 生成预览
   */
  preview(content: string, options: PreviewOptions = {}): string {
    const opts: Required<PreviewOptions> = {
      maxLength: options.maxLength ?? 500,
      showTokenCount: options.showTokenCount ?? true,
      showSections: options.showSections ?? true,
      highlightChanges: options.highlightChanges ?? false,
      format: options.format ?? 'plain',
    };

    if (opts.format === 'json') {
      return this.previewJson(content, opts);
    }

    const analysis = this.analyze(content);
    const lines: string[] = [];

    // 标题
    lines.push(this.formatHeader('System Prompt Preview'));

    // Token 统计
    if (opts.showTokenCount) {
      lines.push(
        `Total: ${chalk.cyan(analysis.totalTokens.toLocaleString())} tokens (estimated)`
      );
      lines.push(`Chars: ${chalk.cyan(analysis.totalChars.toLocaleString())}`);
      lines.push('');
    }

    // 各部分统计
    if (opts.showSections && analysis.sections.length > 0) {
      lines.push(chalk.bold('Sections:'));
      for (const section of analysis.sections) {
        const percentage = ((section.tokens / analysis.totalTokens) * 100).toFixed(1);
        const bar = this.createProgressBar(section.tokens / analysis.totalTokens);
        lines.push(
          `  ${chalk.yellow('●')} ${section.name}: ` +
            `${chalk.cyan(section.tokens.toLocaleString())} tokens ` +
            `${chalk.gray(`(${percentage}%)`)} ${bar}`
        );
      }
      lines.push('');
    }

    // 预览内容
    if (opts.maxLength > 0) {
      lines.push(chalk.bold('Preview:'));
      lines.push(chalk.gray('---'));
      const preview =
        content.length <= opts.maxLength
          ? content
          : content.slice(0, opts.maxLength) + '\n... [truncated]';
      lines.push(preview);
      lines.push(chalk.gray('---'));
      lines.push('');
    }

    // 警告
    if (analysis.warnings.length > 0) {
      lines.push(chalk.bold(chalk.yellow('Warnings:')));
      for (const warning of analysis.warnings) {
        lines.push(`  ${chalk.yellow('⚠')} ${warning}`);
      }
      lines.push('');
    }

    // 统计信息
    if (analysis.stats.largestSection) {
      lines.push(chalk.bold('Statistics:'));
      lines.push(
        `  Largest section: ${chalk.cyan(analysis.stats.largestSection.name)} ` +
          `(${analysis.stats.largestSection.tokens.toLocaleString()} tokens)`
      );
      if (analysis.stats.smallestSection) {
        lines.push(
          `  Smallest section: ${chalk.cyan(analysis.stats.smallestSection.name)} ` +
            `(${analysis.stats.smallestSection.tokens.toLocaleString()} tokens)`
        );
      }
      lines.push(
        `  Average per section: ${chalk.cyan(analysis.stats.avgTokensPerSection.toFixed(0))} tokens`
      );
    }

    lines.push(this.formatFooter());

    return lines.join('\n');
  }

  /**
   * JSON 格式预览
   */
  private previewJson(content: string, options: Required<PreviewOptions>): string {
    const analysis = this.analyze(content);
    const preview =
      options.maxLength > 0 && content.length > options.maxLength
        ? content.slice(0, options.maxLength)
        : content;

    return JSON.stringify(
      {
        totalTokens: analysis.totalTokens,
        totalChars: analysis.totalChars,
        sections: analysis.sections.map((s) => ({
          name: s.name,
          tokens: s.tokens,
          percentage: ((s.tokens / analysis.totalTokens) * 100).toFixed(2),
        })),
        preview,
        warnings: analysis.warnings,
        stats: {
          avgTokensPerSection: analysis.stats.avgTokensPerSection,
          largestSection: analysis.stats.largestSection?.name,
          smallestSection: analysis.stats.smallestSection?.name,
        },
      },
      null,
      2
    );
  }

  /**
   * 比较两个提示词的差异
   */
  diff(oldPrompt: string, newPrompt: string, options: PreviewOptions = {}): string {
    const opts: Required<PreviewOptions> = {
      maxLength: options.maxLength ?? 0,
      showTokenCount: options.showTokenCount ?? true,
      showSections: options.showSections ?? false,
      highlightChanges: options.highlightChanges ?? true,
      format: options.format ?? 'plain',
    };

    const diffResult = this.computeDiff(oldPrompt, newPrompt);

    if (opts.format === 'json') {
      return JSON.stringify(diffResult, null, 2);
    }

    const lines: string[] = [];

    // 标题
    lines.push(this.formatHeader('System Prompt Diff'));

    // 统计
    if (opts.showTokenCount) {
      const oldTokens = estimateTokens(oldPrompt);
      const newTokens = estimateTokens(newPrompt);
      const tokenDiff = newTokens - oldTokens;
      const tokenDiffStr =
        tokenDiff > 0
          ? chalk.green(`+${tokenDiff.toLocaleString()}`)
          : tokenDiff < 0
            ? chalk.red(`${tokenDiff.toLocaleString()}`)
            : chalk.gray('0');

      lines.push(`Old: ${chalk.cyan(oldTokens.toLocaleString())} tokens`);
      lines.push(`New: ${chalk.cyan(newTokens.toLocaleString())} tokens`);
      lines.push(`Diff: ${tokenDiffStr} tokens`);
      lines.push('');
    }

    // 变化统计
    lines.push(chalk.bold('Changes:'));
    lines.push(
      `  ${chalk.green('+')} ${diffResult.additions.length} additions ` +
        `(${diffResult.stats.addedChars} chars, ~${diffResult.stats.addedTokens} tokens)`
    );
    lines.push(
      `  ${chalk.red('-')} ${diffResult.deletions.length} deletions ` +
        `(${diffResult.stats.deletedChars} chars, ~${diffResult.stats.deletedTokens} tokens)`
    );
    lines.push(
      `  ${chalk.yellow('~')} ${diffResult.modifications.length} modifications`
    );
    lines.push(`  ${chalk.gray('=')} ${diffResult.unchangedLines} unchanged lines`);
    lines.push('');

    // 详细差异
    if (opts.maxLength === 0 || diffResult.additions.length + diffResult.deletions.length < 50) {
      lines.push(chalk.bold('Details:'));

      // 显示删除
      for (const del of diffResult.deletions.slice(0, opts.maxLength || 20)) {
        lines.push(chalk.red(`- [${del.lineNumber}] ${del.content}`));
      }

      // 显示添加
      for (const add of diffResult.additions.slice(0, opts.maxLength || 20)) {
        lines.push(chalk.green(`+ [${add.lineNumber}] ${add.content}`));
      }

      if (
        opts.maxLength &&
        diffResult.additions.length + diffResult.deletions.length >
          opts.maxLength
      ) {
        lines.push(chalk.gray('... [truncated]'));
      }
    } else {
      lines.push(
        chalk.gray(
          '(Too many changes to display, use format: "json" for full details)'
        )
      );
    }

    lines.push(this.formatFooter());

    return lines.join('\n');
  }

  /**
   * 计算 diff
   */
  private computeDiff(oldText: string, newText: string): DiffResult {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    const additions: DiffLine[] = [];
    const deletions: DiffLine[] = [];
    const modifications: DiffLine[] = [];
    let unchangedLines = 0;

    // 简单的逐行比较（可以改进为更复杂的 diff 算法）
    const maxLen = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === undefined && newLine !== undefined) {
        // 新增行
        additions.push({
          lineNumber: i + 1,
          content: newLine,
          type: 'add',
        });
      } else if (newLine === undefined && oldLine !== undefined) {
        // 删除行
        deletions.push({
          lineNumber: i + 1,
          content: oldLine,
          type: 'delete',
        });
      } else if (oldLine !== newLine) {
        // 修改行
        modifications.push({
          lineNumber: i + 1,
          content: newLine,
          type: 'modify',
        });
      } else {
        // 未变化
        unchangedLines++;
      }
    }

    // 计算统计
    const addedChars = additions.reduce((sum, line) => sum + line.content.length, 0);
    const deletedChars = deletions.reduce(
      (sum, line) => sum + line.content.length,
      0
    );
    const addedTokens = estimateTokens(additions.map((l) => l.content).join('\n'));
    const deletedTokens = estimateTokens(
      deletions.map((l) => l.content).join('\n')
    );

    return {
      additions,
      deletions,
      modifications,
      unchangedLines,
      stats: {
        addedChars,
        deletedChars,
        addedTokens,
        deletedTokens,
      },
    };
  }

  /**
   * 分析提示词结构
   */
  analyze(content: string): AnalysisResult {
    const totalChars = content.length;
    const totalTokens = estimateTokens(content);

    // 识别各个部分
    const sections = this.extractSections(content);

    // 检测警告
    const warnings: string[] = [];

    // 检查过长的部分
    for (const section of sections) {
      const percentage = (section.tokens / totalTokens) * 100;
      if (percentage > 40) {
        warnings.push(
          `Section "${section.name}" is large (${percentage.toFixed(1)}%), consider trimming`
        );
      }
    }

    // 检查总长度
    if (totalTokens > 150000) {
      warnings.push(
        `Total tokens (${totalTokens.toLocaleString()}) is very high, may hit context limits`
      );
    } else if (totalTokens > 100000) {
      warnings.push(
        `Total tokens (${totalTokens.toLocaleString()}) is high, consider optimization`
      );
    }

    // 检查重复内容
    const lines = content.split('\n');
    const uniqueLines = new Set(lines.filter((l) => l.trim().length > 0));
    const duplicateRatio = 1 - uniqueLines.size / lines.length;
    if (duplicateRatio > 0.3) {
      warnings.push(
        `High duplicate content ratio (${(duplicateRatio * 100).toFixed(1)}%)`
      );
    }

    // 计算统计
    const avgTokensPerSection =
      sections.length > 0 ? totalTokens / sections.length : 0;

    let largestSection: PromptSection | null = null;
    let smallestSection: PromptSection | null = null;

    for (const section of sections) {
      if (!largestSection || section.tokens > largestSection.tokens) {
        largestSection = section;
      }
      if (!smallestSection || section.tokens < smallestSection.tokens) {
        smallestSection = section;
      }
    }

    return {
      totalTokens,
      totalChars,
      sections,
      warnings,
      stats: {
        avgTokensPerSection,
        largestSection,
        smallestSection,
      },
    };
  }

  /**
   * 提取提示词的各个部分
   */
  private extractSections(content: string): PromptSection[] {
    const sections: PromptSection[] = [];

    // 识别常见的部分标记
    const sectionPatterns = [
      { name: 'Core Identity', pattern: /You are Claude Code/i },
      { name: 'Tool Guidelines', pattern: /# Tool usage policy/i },
      { name: 'Permission Mode', pattern: /# Permission Mode:/i },
      { name: 'Output Style', pattern: /# Tone and style/i },
      { name: 'Task Management', pattern: /# Task Management/i },
      { name: 'Coding Guidelines', pattern: /# Coding/i },
      { name: 'Git Operations', pattern: /# Git Operations/i },
      { name: 'Subagent System', pattern: /# Subagent/i },
      { name: 'Environment Info', pattern: /<env>/i },
      { name: 'CLAUDE.md', pattern: /# CLAUDE\.md/i },
      { name: 'Attachments', pattern: /<attachment/i },
      { name: 'System Reminder', pattern: /<system-reminder>/i },
    ];

    const lines = content.split('\n');
    let currentSection: PromptSection | null = null;
    let currentContent: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let foundSection = false;

      // 检查是否匹配新部分
      for (const pattern of sectionPatterns) {
        if (pattern.pattern.test(line)) {
          // 保存当前部分
          if (currentSection) {
            const content = currentContent.join('\n');
            currentSection.content = content;
            currentSection.tokens = estimateTokens(content);
            currentSection.endIndex = i - 1;
            sections.push(currentSection);
          }

          // 开始新部分
          currentSection = {
            name: pattern.name,
            content: '',
            tokens: 0,
            startIndex: i,
            endIndex: i,
          };
          currentContent = [line];
          foundSection = true;
          break;
        }
      }

      // 如果没有匹配到新部分，添加到当前部分
      if (!foundSection && currentSection) {
        currentContent.push(line);
      } else if (!foundSection && !currentSection) {
        // 第一个部分之前的内容
        if (!currentSection) {
          currentSection = {
            name: 'Header',
            content: '',
            tokens: 0,
            startIndex: 0,
            endIndex: i,
          };
          currentContent = [line];
        }
      }
    }

    // 保存最后一个部分
    if (currentSection) {
      const content = currentContent.join('\n');
      currentSection.content = content;
      currentSection.tokens = estimateTokens(content);
      currentSection.endIndex = lines.length - 1;
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * 创建进度条
   */
  private createProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round(percentage * width);
    const empty = width - filled;
    return chalk.gray('[') + chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(empty)) + chalk.gray(']');
  }

  /**
   * 格式化标题
   */
  private formatHeader(title: string): string {
    const border = '='.repeat(title.length + 8);
    return chalk.bold(chalk.cyan(`${border}\n   ${title}\n${border}`));
  }

  /**
   * 格式化页脚
   */
  private formatFooter(): string {
    return chalk.gray('='.repeat(40));
  }
}

/**
 * 全局预览实例
 */
export const promptPreview = new PromptPreview();
