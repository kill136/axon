/**
 * T-015: 权限规则解析器
 *
 * 功能：
 * - 解析官方权限规则语法
 * - 支持 Bash(command:pattern) 命令匹配
 * - 支持 Read/Write/Edit(path/**) 路径通配符
 * - 支持工具参数级别的权限控制
 * - 实现权限规则的优先级排序 (deny > allow > default)
 *
 * 语法示例：
 * - "Bash" - 匹配所有 Bash 命令
 * - "Bash(*)" - 同上，匹配所有 Bash 命令
 * - "Bash(npm:*)" - 匹配以 npm 开头的命令
 * - "Bash(npm install:*)" - 匹配以 "npm install" 开头的命令
 * - "Read" - 匹配所有 Read 操作
 * - "Read(/home/user/**)" - 匹配 /home/user/ 及其子目录下的所有文件
 * - "Write(src/*.ts)" - 匹配 src 目录下的 .ts 文件
 * - "Edit(*.md)" - 匹配所有 .md 文件
 */

import * as path from 'path';
import { minimatch } from 'minimatch';
import {
  checkShellSecurity,
  splitCompoundCommand,
  canSafelyMatchWildcardRule,
  normalizeCommand,
  extractActualCommand,
  type ShellSecurityCheckResult,
} from './shell-security.js';

// ============ 类型定义 ============

/**
 * 权限规则类型
 */
export type RuleType = 'allow' | 'deny';

/**
 * 规则来源
 */
export type RuleSource =
  | 'cli'              // 命令行参数
  | 'settings'         // 用户设置 (~/.axon/settings.json)
  | 'project'          // 项目设置 (.axon/settings.json)
  | 'policy'           // 策略文件
  | 'session'          // 会话记忆
  | 'runtime';         // 运行时动态添加

/**
 * 解析后的权限规则
 */
export interface ParsedRule {
  /** 原始规则字符串 */
  raw: string;

  /** 规则类型: allow 或 deny */
  type: RuleType;

  /** 工具名称 (如 "Bash", "Read", "Write") */
  tool: string;

  /** 是否有参数限制 */
  hasParams: boolean;

  /** 参数模式 (如 "npm install:*", "/home/**") */
  paramPattern?: string;

  /** 解析后的参数匹配器 */
  matcher?: ParameterMatcher;

  /** 规则优先级 (数值越高优先级越高) */
  priority: number;

  /** 规则来源 */
  source: RuleSource;

  /** 创建时间戳 */
  createdAt: number;

  /** 描述信息 */
  description?: string;
}

/**
 * 参数匹配器类型
 */
export type ParameterMatcherType =
  | 'any'           // 匹配任意参数 (*)
  | 'prefix'        // 前缀匹配 (npm:*)
  | 'exact'         // 精确匹配
  | 'glob'          // Glob 模式匹配 (**/*.ts)
  | 'regex';        // 正则表达式匹配

/**
 * 参数匹配器
 */
export interface ParameterMatcher {
  type: ParameterMatcherType;
  pattern: string;
  /** 对于命令匹配，这是命令前缀 */
  commandPrefix?: string;
  /** 对于路径匹配，这是路径模式 */
  pathPattern?: string;
  /** 编译后的正则表达式 */
  regex?: RegExp;
}

/**
 * 工具输入参数
 */
export interface ToolInput {
  /** 工具名称 */
  tool: string;
  /** 工具参数 */
  params: Record<string, unknown>;
}

/**
 * 权限检查结果
 */
export interface RuleCheckResult {
  /** 是否匹配到规则 */
  matched: boolean;
  /** 匹配的规则 */
  rule?: ParsedRule;
  /** 是否允许 */
  allowed: boolean;
  /** 原因说明 */
  reason: string;
}

/**
 * 解析错误
 */
export class RuleParseError extends Error {
  constructor(
    public rule: string,
    message: string
  ) {
    super(`Failed to parse rule "${rule}": ${message}`);
    this.name = 'RuleParseError';
  }
}

// ============ 规则解析器 ============

/**
 * 权限规则解析器
 *
 * 解析官方权限规则语法，支持：
 * - 工具级权限 (Bash, Read, Write, etc.)
 * - 命令级权限 (Bash(npm:*), Bash(git diff:*))
 * - 路径级权限 (Read(/path/**), Write(src/*.ts))
 */
export class PermissionRuleParser {
  // 规则语法正则表达式
  // 匹配格式: ToolName 或 ToolName(pattern)
  private static readonly RULE_PATTERN = /^([A-Za-z][A-Za-z0-9_-]*)(?:\(([^)]*)\))?$/;

  // 命令前缀匹配正则 (如 "npm install:*")
  private static readonly COMMAND_PREFIX_PATTERN = /^(.+?):\*$/;

  // Glob 模式检测
  private static readonly GLOB_CHARS = /[*?[\]{}]/;

  /**
   * 解析单个规则字符串
   *
   * @param ruleStr 规则字符串 (如 "Bash(npm:*)")
   * @param type 规则类型 (allow/deny)
   * @param source 规则来源
   * @param priority 优先级 (可选，默认根据来源和类型自动计算)
   * @returns 解析后的规则
   */
  static parse(
    ruleStr: string,
    type: RuleType = 'allow',
    source: RuleSource = 'runtime',
    priority?: number
  ): ParsedRule {
    const trimmed = ruleStr.trim();

    if (!trimmed) {
      throw new RuleParseError(ruleStr, 'Rule string cannot be empty');
    }

    const match = this.RULE_PATTERN.exec(trimmed);
    if (!match) {
      throw new RuleParseError(ruleStr, 'Invalid rule syntax');
    }

    const [, tool, paramStr] = match;
    const hasParams = paramStr !== undefined;
    const paramPattern = paramStr?.trim();

    // 创建参数匹配器
    let matcher: ParameterMatcher | undefined;
    if (hasParams && paramPattern) {
      matcher = this.createMatcher(tool, paramPattern);
    } else if (hasParams && !paramPattern) {
      // 空括号 Tool() 等同于 Tool(*)
      matcher = { type: 'any', pattern: '*' };
    }

    // 计算优先级
    const calculatedPriority = priority ?? this.calculatePriority(type, source, hasParams);

    return {
      raw: ruleStr,
      type,
      tool,
      hasParams,
      paramPattern,
      matcher,
      priority: calculatedPriority,
      source,
      createdAt: Date.now(),
    };
  }

  /**
   * 解析多个规则字符串
   *
   * @param rulesStr 规则字符串，逗号分隔
   * @param type 规则类型
   * @param source 规则来源
   * @returns 解析后的规则数组
   */
  static parseMultiple(
    rulesStr: string,
    type: RuleType = 'allow',
    source: RuleSource = 'runtime'
  ): ParsedRule[] {
    if (!rulesStr.trim()) {
      return [];
    }

    // 处理逗号分隔的规则，需要考虑括号内的逗号
    const rules: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of rulesStr) {
      if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        if (current.trim()) {
          rules.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      rules.push(current.trim());
    }

    return rules.map(rule => this.parse(rule, type, source));
  }

  /**
   * 创建参数匹配器
   */
  private static createMatcher(tool: string, pattern: string): ParameterMatcher {
    // 匹配任意参数
    if (pattern === '*') {
      return { type: 'any', pattern };
    }

    // 检查是否为命令前缀匹配 (如 "npm:*" 或 "npm install:*")
    const prefixMatch = this.COMMAND_PREFIX_PATTERN.exec(pattern);
    if (prefixMatch) {
      const [, prefix] = prefixMatch;
      return {
        type: 'prefix',
        pattern,
        commandPrefix: prefix,
      };
    }

    // 检查是否为 Glob 模式
    if (this.GLOB_CHARS.test(pattern)) {
      return {
        type: 'glob',
        pattern,
        pathPattern: pattern,
      };
    }

    // 精确匹配
    return {
      type: 'exact',
      pattern,
    };
  }

  /**
   * 计算规则优先级
   *
   * 优先级规则：
   * 1. deny > allow (deny 优先级 +1000)
   * 2. 更具体的规则优先级更高
   * 3. 来源优先级: cli > policy > project > settings > session > runtime
   */
  private static calculatePriority(
    type: RuleType,
    source: RuleSource,
    hasParams: boolean
  ): number {
    let priority = 0;

    // deny 优先于 allow
    if (type === 'deny') {
      priority += 1000;
    }

    // 有参数的规则更具体，优先级更高
    if (hasParams) {
      priority += 100;
    }

    // 来源优先级
    const sourcePriorities: Record<RuleSource, number> = {
      cli: 50,
      policy: 40,
      project: 30,
      settings: 20,
      session: 10,
      runtime: 0,
    };
    priority += sourcePriorities[source] ?? 0;

    return priority;
  }
}

// ============ 规则匹配器 ============

/**
 * 规则匹配器
 *
 * 检查工具调用是否匹配给定的权限规则
 */
export class RuleMatcher {
  /**
   * 检查工具调用是否匹配规则
   *
   * @param rule 权限规则
   * @param input 工具输入
   * @returns 是否匹配
   */
  static matches(rule: ParsedRule, input: ToolInput): boolean {
    // 检查工具名是否匹配
    if (rule.tool !== input.tool && rule.tool !== '*') {
      return false;
    }

    // 如果没有参数限制，匹配成功
    if (!rule.hasParams || !rule.matcher) {
      return true;
    }

    // 根据工具类型和匹配器类型进行参数匹配
    return this.matchParameters(rule, input);
  }

  /**
   * 匹配参数
   */
  private static matchParameters(rule: ParsedRule, input: ToolInput): boolean {
    const matcher = rule.matcher!;

    // 匹配任意参数
    if (matcher.type === 'any') {
      return true;
    }

    // 根据工具类型选择匹配策略
    switch (rule.tool) {
      case 'Bash':
        return this.matchBashCommand(matcher, input.params);

      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
        return this.matchFilePath(matcher, input.params);

      case 'Glob':
      case 'Grep':
        return this.matchSearchPath(matcher, input.params);

      case 'WebFetch':
      case 'WebSearch':
        return this.matchUrl(matcher, input.params);

      default:
        // 对于其他工具，尝试通用匹配
        return this.matchGeneric(matcher, input.params);
    }
  }

  /**
   * 匹配 Bash 命令
   *
   * 安全修复 (CVE-2.1.6, CVE-2.1.7):
   * - 在匹配前检测 shell 操作符
   * - 复合命令需要拆分检查每个子命令
   * - 行续行符会阻止通配符匹配
   *
   * v2.1.38: Env var wrapper 支持
   * - "KEY=value command" 格式的命令会提取实际命令进行匹配
   * - 也会尝试用原始命令匹配（支持精确匹配带 env var 的完整命令）
   */
  private static matchBashCommand(
    matcher: ParameterMatcher,
    params: Record<string, unknown>
  ): boolean {
    const command = params.command as string | undefined;
    if (!command) {
      return false;
    }

    // 规范化命令
    const normalizedCmd = normalizeCommand(command);

    // 安全检查：检测 shell 操作符
    const securityCheck = checkShellSecurity(normalizedCmd);

    // CVE-2.1.6: 如果包含行续行符，拒绝通配符匹配
    if (securityCheck.hasLineContinuation) {
      // 行续行符只允许精确匹配
      if (matcher.type !== 'exact') {
        return false;
      }
    }

    // v2.1.59: 对于复合命令，先尝试精确匹配完整命令（支持 Always Allow 保存的完整复合命令）
    if (matcher.type === 'exact' && this.matchSingleBashCommand(normalizedCmd, matcher)) {
      return true;
    }

    // CVE-2.1.7: 如果是复合命令，需要检查每个子命令
    if (securityCheck.isCompoundCommand && securityCheck.subcommands) {
      // 对于通配符和前缀匹配，检查是否安全
      if (matcher.type === 'prefix' || matcher.type === 'glob' || matcher.type === 'any') {
        const safeCheck = canSafelyMatchWildcardRule(normalizedCmd, matcher.pattern);
        if (!safeCheck.canMatch) {
          // 不安全，需要检查每个子命令是否都匹配
          return this.matchAllSubcommands(securityCheck.subcommands, matcher);
        }
      }
    }

    // 尝试用原始规范化命令匹配
    if (this.matchSingleBashCommand(normalizedCmd, matcher)) {
      return true;
    }

    // v2.1.38: 提取实际命令（跳过 env var 前缀和 shell wrapper），再次尝试匹配
    const actualCmd = extractActualCommand(normalizedCmd);
    if (actualCmd !== normalizedCmd) {
      return this.matchSingleBashCommand(actualCmd, matcher);
    }

    return false;
  }

  /**
   * 匹配单个 Bash 命令（不含 shell 操作符）
   */
  private static matchSingleBashCommand(
    command: string,
    matcher: ParameterMatcher
  ): boolean {
    switch (matcher.type) {
      case 'any':
        // 匹配任意命令
        return true;

      case 'prefix':
        // 前缀匹配 (如 "npm:*" 匹配 "npm install lodash")
        if (matcher.commandPrefix) {
          const prefix = matcher.commandPrefix;
          // 精确匹配前缀，或者前缀后跟空格
          return command === prefix || command.startsWith(prefix + ' ');
        }
        return false;

      case 'exact':
        // 精确匹配
        return command === matcher.pattern;

      case 'glob':
        // Glob 模式匹配
        return minimatch(command, matcher.pattern, { nocase: false });

      case 'regex':
        // 正则表达式匹配
        return matcher.regex?.test(command) ?? false;

      default:
        return false;
    }
  }

  /**
   * 检查所有子命令是否都匹配规则
   *
   * 当命令包含 shell 操作符时，需要确保每个子命令都符合权限规则
   */
  private static matchAllSubcommands(
    subcommands: string[],
    matcher: ParameterMatcher
  ): boolean {
    // 每个子命令都必须匹配
    for (const subcmd of subcommands) {
      const trimmedSubcmd = subcmd.trim();
      if (!trimmedSubcmd) continue;

      // 递归检查子命令的安全性
      const subSecurityCheck = checkShellSecurity(trimmedSubcmd);

      // 如果子命令仍然是复合命令，递归处理
      if (subSecurityCheck.isCompoundCommand && subSecurityCheck.subcommands) {
        if (!this.matchAllSubcommands(subSecurityCheck.subcommands, matcher)) {
          return false;
        }
      } else {
        // 简单命令，直接匹配
        if (!this.matchSingleBashCommand(trimmedSubcmd, matcher)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 匹配文件路径
   */
  private static matchFilePath(
    matcher: ParameterMatcher,
    params: Record<string, unknown>
  ): boolean {
    const filePath = (params.file_path ?? params.path) as string | undefined;
    if (!filePath) {
      return false;
    }

    // 规范化路径
    const normalizedPath = path.normalize(filePath);

    switch (matcher.type) {
      case 'prefix':
        // 路径前缀匹配
        if (matcher.commandPrefix) {
          const normalizedPrefix = path.normalize(matcher.commandPrefix);
          return normalizedPath.startsWith(normalizedPrefix);
        }
        return false;

      case 'exact':
        // 精确匹配
        return normalizedPath === path.normalize(matcher.pattern);

      case 'glob':
        // Glob 模式匹配
        return minimatch(normalizedPath, matcher.pattern, {
          dot: true,
          matchBase: false,
          nocase: process.platform === 'win32',
        });

      case 'regex':
        // 正则表达式匹配
        return matcher.regex?.test(normalizedPath) ?? false;

      default:
        return false;
    }
  }

  /**
   * 匹配搜索路径 (Glob, Grep)
   */
  private static matchSearchPath(
    matcher: ParameterMatcher,
    params: Record<string, unknown>
  ): boolean {
    const searchPath = (params.path ?? params.pattern) as string | undefined;
    if (!searchPath) {
      return true; // 没有指定路径时使用当前目录，默认匹配
    }

    return this.matchFilePath(matcher, { path: searchPath });
  }

  /**
   * 匹配 URL
   */
  private static matchUrl(
    matcher: ParameterMatcher,
    params: Record<string, unknown>
  ): boolean {
    const url = params.url as string | undefined;
    if (!url) {
      return false;
    }

    switch (matcher.type) {
      case 'prefix':
        if (matcher.commandPrefix) {
          return url.startsWith(matcher.commandPrefix);
        }
        return false;

      case 'exact':
        return url === matcher.pattern;

      case 'glob':
        return minimatch(url, matcher.pattern, { nocase: true });

      case 'regex':
        return matcher.regex?.test(url) ?? false;

      default:
        return false;
    }
  }

  /**
   * 通用参数匹配
   */
  private static matchGeneric(
    matcher: ParameterMatcher,
    params: Record<string, unknown>
  ): boolean {
    // 尝试匹配所有字符串类型的参数
    for (const value of Object.values(params)) {
      if (typeof value === 'string') {
        let matched = false;

        switch (matcher.type) {
          case 'prefix':
            matched = matcher.commandPrefix
              ? value.startsWith(matcher.commandPrefix)
              : false;
            break;

          case 'exact':
            matched = value === matcher.pattern;
            break;

          case 'glob':
            matched = minimatch(value, matcher.pattern, { nocase: false });
            break;

          case 'regex':
            matched = matcher.regex?.test(value) ?? false;
            break;
        }

        if (matched) {
          return true;
        }
      }
    }

    return false;
  }
}

// ============ 权限规则管理器 ============

/**
 * 权限规则管理器
 *
 * 管理和评估权限规则，支持：
 * - 添加/移除规则
 * - 规则优先级排序
 * - 权限检查 (deny > allow > default)
 */
export class PermissionRuleManager {
  private allowRules: ParsedRule[] = [];
  private denyRules: ParsedRule[] = [];

  /**
   * 添加允许规则
   */
  addAllowRule(rule: ParsedRule | string, source?: RuleSource): void {
    const parsed = typeof rule === 'string'
      ? PermissionRuleParser.parse(rule, 'allow', source ?? 'runtime')
      : { ...rule, type: 'allow' as RuleType };

    this.allowRules.push(parsed);
    this.sortRules();
  }

  /**
   * 添加多个允许规则
   */
  addAllowRules(rulesStr: string, source?: RuleSource): void {
    const rules = PermissionRuleParser.parseMultiple(rulesStr, 'allow', source ?? 'runtime');
    this.allowRules.push(...rules);
    this.sortRules();
  }

  /**
   * 添加拒绝规则
   */
  addDenyRule(rule: ParsedRule | string, source?: RuleSource): void {
    const parsed = typeof rule === 'string'
      ? PermissionRuleParser.parse(rule, 'deny', source ?? 'runtime')
      : { ...rule, type: 'deny' as RuleType };

    this.denyRules.push(parsed);
    this.sortRules();
  }

  /**
   * 添加多个拒绝规则
   */
  addDenyRules(rulesStr: string, source?: RuleSource): void {
    const rules = PermissionRuleParser.parseMultiple(rulesStr, 'deny', source ?? 'runtime');
    this.denyRules.push(...rules);
    this.sortRules();
  }

  /**
   * 移除规则
   */
  removeRule(ruleStr: string): void {
    this.allowRules = this.allowRules.filter(r => r.raw !== ruleStr);
    this.denyRules = this.denyRules.filter(r => r.raw !== ruleStr);
  }

  /**
   * 清空所有规则
   */
  clearRules(): void {
    this.allowRules = [];
    this.denyRules = [];
  }

  /**
   * 清空特定来源的规则
   */
  clearRulesBySource(source: RuleSource): void {
    this.allowRules = this.allowRules.filter(r => r.source !== source);
    this.denyRules = this.denyRules.filter(r => r.source !== source);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): { allow: ParsedRule[]; deny: ParsedRule[] } {
    return {
      allow: [...this.allowRules],
      deny: [...this.denyRules],
    };
  }

  /**
   * 检查工具调用是否被允许
   *
   * 优先级规则：
   * 1. deny 规则优先于 allow 规则
   * 2. 更具体的规则优先于更通用的规则
   * 3. 如果没有匹配的规则，返回默认结果
   *
   * @param input 工具输入
   * @param defaultAllow 默认是否允许 (当没有匹配规则时)
   * @returns 检查结果
   */
  check(input: ToolInput, defaultAllow: boolean = true): RuleCheckResult {
    // 1. 首先检查 deny 规则 (优先级最高)
    for (const rule of this.denyRules) {
      if (RuleMatcher.matches(rule, input)) {
        return {
          matched: true,
          rule,
          allowed: false,
          reason: `Denied by rule: ${rule.raw}`,
        };
      }
    }

    // 2. 检查 allow 规则
    for (const rule of this.allowRules) {
      if (RuleMatcher.matches(rule, input)) {
        return {
          matched: true,
          rule,
          allowed: true,
          reason: `Allowed by rule: ${rule.raw}`,
        };
      }
    }

    // 3. 没有匹配的规则，返回默认结果
    return {
      matched: false,
      allowed: defaultAllow,
      reason: defaultAllow
        ? 'No matching rule, allowed by default'
        : 'No matching rule, denied by default',
    };
  }

  /**
   * 检查工具是否被明确允许
   */
  isExplicitlyAllowed(input: ToolInput): boolean {
    for (const rule of this.allowRules) {
      if (RuleMatcher.matches(rule, input)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查工具是否被明确拒绝
   */
  isExplicitlyDenied(input: ToolInput): boolean {
    for (const rule of this.denyRules) {
      if (RuleMatcher.matches(rule, input)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取匹配的规则列表
   */
  getMatchingRules(input: ToolInput): ParsedRule[] {
    const matching: ParsedRule[] = [];

    for (const rule of this.denyRules) {
      if (RuleMatcher.matches(rule, input)) {
        matching.push(rule);
      }
    }

    for (const rule of this.allowRules) {
      if (RuleMatcher.matches(rule, input)) {
        matching.push(rule);
      }
    }

    return matching;
  }

  /**
   * 排序规则 (按优先级降序)
   */
  private sortRules(): void {
    const sortFn = (a: ParsedRule, b: ParsedRule) => b.priority - a.priority;
    this.allowRules.sort(sortFn);
    this.denyRules.sort(sortFn);
  }

  /**
   * 导出规则配置
   */
  export(): { allow: string[]; deny: string[] } {
    return {
      allow: this.allowRules.map(r => r.raw),
      deny: this.denyRules.map(r => r.raw),
    };
  }

  /**
   * 导入规则配置
   */
  import(config: { allow?: string[]; deny?: string[] }, source?: RuleSource): void {
    if (config.allow) {
      for (const rule of config.allow) {
        this.addAllowRule(rule, source);
      }
    }
    if (config.deny) {
      for (const rule of config.deny) {
        this.addDenyRule(rule, source);
      }
    }
  }

  /**
   * 获取规则统计
   */
  getStats(): {
    totalRules: number;
    allowRules: number;
    denyRules: number;
    bySource: Record<RuleSource, number>;
    byTool: Record<string, number>;
  } {
    const allRules = [...this.allowRules, ...this.denyRules];

    const bySource: Record<RuleSource, number> = {
      cli: 0,
      settings: 0,
      project: 0,
      policy: 0,
      session: 0,
      runtime: 0,
    };

    const byTool: Record<string, number> = {};

    for (const rule of allRules) {
      bySource[rule.source] = (bySource[rule.source] || 0) + 1;
      byTool[rule.tool] = (byTool[rule.tool] || 0) + 1;
    }

    return {
      totalRules: allRules.length,
      allowRules: this.allowRules.length,
      denyRules: this.denyRules.length,
      bySource,
      byTool,
    };
  }

  /**
   * 检测不可达规则
   *
   * 分别检测 allow 规则和 deny 规则列表中的不可达规则，
   * 以及 deny 规则对 allow 规则的阻塞。
   *
   * @returns 不可达规则检测结果
   */
  detectUnreachable(): UnreachableRuleDetectionResult {
    const allUnreachable: UnreachableRule[] = [];

    // 检测 allow 规则内部的不可达
    const allowResult = detectUnreachableRules(this.allowRules);
    allUnreachable.push(...allowResult.unreachableRules);

    // 检测 deny 规则内部的不可达
    const denyResult = detectUnreachableRules(this.denyRules);
    allUnreachable.push(...denyResult.unreachableRules);

    // 检测 deny 规则对 allow 规则的阻塞
    // deny 规则先于 allow 规则执行，所以要检查是否有 deny 规则完全阻塞了 allow 规则
    for (const allowRule of this.allowRules) {
      for (const denyRule of this.denyRules) {
        if (isBlocking(denyRule, allowRule)) {
          allUnreachable.push({
            rule: allowRule,
            blockedBy: denyRule,
            reason: generateBlockingReason(denyRule, allowRule),
            source: allowRule.source,
            fixSuggestion: generateFixSuggestion(denyRule, allowRule),
          });
          break; // 找到第一个阻塞的规则就停止
        }
      }
    }

    // 生成警告消息
    const warnings = allUnreachable.map(ur => formatUnreachableWarning(ur));

    return {
      hasUnreachable: allUnreachable.length > 0,
      unreachableRules: allUnreachable,
      warnings,
    };
  }

  /**
   * 验证规则并返回警告消息
   *
   * @returns 警告消息字符串，如果没有警告则返回空字符串
   */
  validateRules(): string {
    const result = this.detectUnreachable();
    return formatUnreachableWarnings(result);
  }
}

// ============ 便捷函数 ============

/**
 * 解析允许的工具列表 (如 --allowed-tools 参数)
 */
export function parseAllowedTools(
  toolsStr: string,
  source: RuleSource = 'cli'
): ParsedRule[] {
  return PermissionRuleParser.parseMultiple(toolsStr, 'allow', source);
}

/**
 * 解析禁止的工具列表 (如 --disallowed-tools 参数)
 */
export function parseDisallowedTools(
  toolsStr: string,
  source: RuleSource = 'cli'
): ParsedRule[] {
  return PermissionRuleParser.parseMultiple(toolsStr, 'deny', source);
}

/**
 * 创建 Bash 命令规则
 */
export function createBashRule(
  commandPattern: string,
  type: RuleType = 'allow',
  source: RuleSource = 'runtime'
): ParsedRule {
  return PermissionRuleParser.parse(
    commandPattern.includes(':') ? `Bash(${commandPattern})` : `Bash(${commandPattern}:*)`,
    type,
    source
  );
}

/**
 * 创建文件路径规则
 */
export function createPathRule(
  tool: 'Read' | 'Write' | 'Edit',
  pathPattern: string,
  type: RuleType = 'allow',
  source: RuleSource = 'runtime'
): ParsedRule {
  return PermissionRuleParser.parse(`${tool}(${pathPattern})`, type, source);
}

// ============ 不可达规则检测 ============

/**
 * 不可达规则信息
 */
export interface UnreachableRule {
  /** 被阻塞的规则 */
  rule: ParsedRule;
  /** 阻塞此规则的规则 */
  blockedBy: ParsedRule;
  /** 不可达原因 */
  reason: string;
  /** 规则来源信息 */
  source: RuleSource;
  /** 修复建议 */
  fixSuggestion: string;
}

/**
 * 不可达规则检测结果
 */
export interface UnreachableRuleDetectionResult {
  /** 是否有不可达规则 */
  hasUnreachable: boolean;
  /** 不可达规则列表 */
  unreachableRules: UnreachableRule[];
  /** 警告消息列表 */
  warnings: string[];
}

/**
 * 格式化规则为可读字符串
 */
export function formatRule(rule: ParsedRule): string {
  if (rule.hasParams && rule.paramPattern) {
    return `${rule.tool}(${rule.paramPattern})`;
  }
  return rule.tool;
}

/**
 * 格式化规则来源为可读字符串
 */
export function formatRuleSource(source: RuleSource): string {
  const sourceLabels: Record<RuleSource, string> = {
    cli: 'Command Line',
    settings: 'User Settings (~/.axon/settings.json)',
    project: 'Project Settings (.axon/settings.json)',
    policy: 'Policy File',
    session: 'Session Memory',
    runtime: 'Runtime',
  };
  return sourceLabels[source] || source;
}

/**
 * 检查规则 A 是否覆盖/阻塞规则 B
 *
 * 一个规则阻塞另一个规则的情况：
 * 1. 规则 A 和规则 B 针对同一工具
 * 2. 规则 A 的参数模式比规则 B 更宽泛或相同
 * 3. 规则 A 的类型使得规则 B 永远不会被触发
 */
export function isBlocking(ruleA: ParsedRule, ruleB: ParsedRule): boolean {
  // 不同工具的规则不会互相阻塞（除非是通配符）
  if (ruleA.tool !== ruleB.tool && ruleA.tool !== '*') {
    return false;
  }

  // 同类型规则（都是 allow 或都是 deny）
  if (ruleA.type === ruleB.type) {
    // 如果 A 没有参数限制，它覆盖所有同工具规则
    if (!ruleA.hasParams || ruleA.matcher?.type === 'any') {
      // B 有更具体的参数，A 会先匹配，B 不可达
      if (ruleB.hasParams && ruleB.matcher?.type !== 'any') {
        return true;
      }
    }

    // 如果都有参数，检查 A 是否包含 B 的模式
    if (ruleA.hasParams && ruleB.hasParams) {
      return isPatternSubsumed(ruleA, ruleB);
    }
  }

  // deny 规则在 allow 规则之前检查
  // 如果有一个宽泛的 deny 规则，它可能会阻塞后面的 allow 规则
  if (ruleA.type === 'deny' && ruleB.type === 'allow') {
    // 如果 deny 没有参数限制，它会拒绝所有
    if (!ruleA.hasParams || ruleA.matcher?.type === 'any') {
      return true;
    }

    // 如果 deny 和 allow 有相同的精确模式，allow 不可达
    if (ruleA.hasParams && ruleB.hasParams) {
      return isPatternSubsumed(ruleA, ruleB);
    }
  }

  return false;
}

/**
 * 检查规则 A 的模式是否包含规则 B 的模式
 */
function isPatternSubsumed(ruleA: ParsedRule, ruleB: ParsedRule): boolean {
  const matcherA = ruleA.matcher;
  const matcherB = ruleB.matcher;

  if (!matcherA || !matcherB) {
    return false;
  }

  // any 模式包含所有其他模式
  if (matcherA.type === 'any') {
    return true;
  }

  // 精确匹配只包含完全相同的模式
  if (matcherA.type === 'exact' && matcherB.type === 'exact') {
    return matcherA.pattern === matcherB.pattern;
  }

  // 前缀匹配：如果 A 的前缀是 B 的前缀的子串
  if (matcherA.type === 'prefix' && matcherB.type === 'prefix') {
    const prefixA = matcherA.commandPrefix || '';
    const prefixB = matcherB.commandPrefix || '';
    // A 的前缀更短或相同，则 A 包含 B
    return prefixB.startsWith(prefixA);
  }

  // 前缀匹配包含精确匹配（如果精确值以前缀开头）
  if (matcherA.type === 'prefix' && matcherB.type === 'exact') {
    const prefixA = matcherA.commandPrefix || '';
    return matcherB.pattern.startsWith(prefixA);
  }

  // glob 模式：简单检查 ** 是否包含 *
  if (matcherA.type === 'glob' && matcherB.type === 'glob') {
    const patternA = matcherA.pattern;
    const patternB = matcherB.pattern;

    // ** 包含所有
    if (patternA === '**' || patternA === '**/*') {
      return true;
    }

    // 如果 A 的模式与 B 相同
    if (patternA === patternB) {
      return true;
    }

    // 简单的包含检查：如果 A 以 ** 结尾，B 以相同前缀开始
    if (patternA.endsWith('**')) {
      const prefix = patternA.slice(0, -2);
      return patternB.startsWith(prefix);
    }
  }

  return false;
}

/**
 * 检测规则列表中的不可达规则
 *
 * @param rules 按优先级排序的规则列表
 * @returns 检测结果
 */
export function detectUnreachableRules(rules: ParsedRule[]): UnreachableRuleDetectionResult {
  const unreachableRules: UnreachableRule[] = [];

  // 对于每个规则，检查是否被之前的规则阻塞
  for (let i = 0; i < rules.length; i++) {
    for (let j = 0; j < i; j++) {
      if (isBlocking(rules[j], rules[i])) {
        const blockedRule = rules[i];
        const blockingRule = rules[j];

        unreachableRules.push({
          rule: blockedRule,
          blockedBy: blockingRule,
          reason: generateBlockingReason(blockingRule, blockedRule),
          source: blockedRule.source,
          fixSuggestion: generateFixSuggestion(blockingRule, blockedRule),
        });

        // 找到第一个阻塞的规则就停止（避免重复报告）
        break;
      }
    }
  }

  // 生成警告消息
  const warnings = unreachableRules.map(ur => formatUnreachableWarning(ur));

  return {
    hasUnreachable: unreachableRules.length > 0,
    unreachableRules,
    warnings,
  };
}

/**
 * 生成阻塞原因说明
 */
function generateBlockingReason(blockingRule: ParsedRule, blockedRule: ParsedRule): string {
  const blockingStr = formatRule(blockingRule);
  const blockedStr = formatRule(blockedRule);

  if (blockingRule.type === 'deny' && blockedRule.type === 'allow') {
    return `The deny rule "${blockingStr}" will always reject before the allow rule "${blockedStr}" can be evaluated`;
  }

  if (!blockingRule.hasParams || blockingRule.matcher?.type === 'any') {
    return `The broader rule "${blockingStr}" will always match before the more specific rule "${blockedStr}"`;
  }

  if (blockingRule.matcher?.type === 'prefix' && blockedRule.matcher?.type === 'prefix') {
    return `The prefix "${blockingRule.matcher.commandPrefix}" in "${blockingStr}" covers the prefix "${blockedRule.matcher?.commandPrefix}" in "${blockedStr}"`;
  }

  return `Rule "${blockingStr}" shadows rule "${blockedStr}"`;
}

/**
 * 生成修复建议
 */
function generateFixSuggestion(blockingRule: ParsedRule, blockedRule: ParsedRule): string {
  const blockingStr = formatRule(blockingRule);
  const blockedStr = formatRule(blockedRule);

  // 如果是同类型规则，建议重新排序或删除
  if (blockingRule.type === blockedRule.type) {
    if (blockingRule.hasParams && blockedRule.hasParams) {
      return `Move "${blockedStr}" before "${blockingStr}", or remove it if redundant`;
    }
    return `Remove "${blockedStr}" as it is redundant with "${blockingStr}"`;
  }

  // 如果是 deny/allow 冲突
  if (blockingRule.type === 'deny' && blockedRule.type === 'allow') {
    return `Add a more specific deny rule after the allow rule "${blockedStr}", or make the deny rule "${blockingStr}" more specific`;
  }

  return `Review the rule order and consider reorganizing your permission rules`;
}

/**
 * 格式化不可达规则警告消息
 */
export function formatUnreachableWarning(ur: UnreachableRule): string {
  const lines: string[] = [];

  lines.push(`Warning: Unreachable permission rule detected`);
  lines.push(`  Rule: ${formatRule(ur.rule)} (${ur.rule.type})`);
  lines.push(`  Source: ${formatRuleSource(ur.source)}`);
  lines.push(`  Blocked by: ${formatRule(ur.blockedBy)} (${ur.blockedBy.type})`);
  lines.push(`  Reason: ${ur.reason}`);
  lines.push(`  Fix: ${ur.fixSuggestion}`);

  return lines.join('\n');
}

/**
 * 格式化所有不可达规则警告为终端输出
 */
export function formatUnreachableWarnings(result: UnreachableRuleDetectionResult): string {
  if (!result.hasUnreachable) {
    return '';
  }

  const lines: string[] = [];
  lines.push('');
  lines.push('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
  lines.push('\x1b[33mPermission Rules Warning\x1b[0m');
  lines.push('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
  lines.push('');
  lines.push(`Found ${result.unreachableRules.length} unreachable rule(s):`);
  lines.push('');

  for (let i = 0; i < result.unreachableRules.length; i++) {
    const ur = result.unreachableRules[i];
    lines.push(`${i + 1}. \x1b[33mUnreachable Rule\x1b[0m`);
    lines.push(`   Rule: \x1b[36m${formatRule(ur.rule)}\x1b[0m (${ur.rule.type})`);
    lines.push(`   Source: ${formatRuleSource(ur.source)}`);
    lines.push(`   Blocked by: \x1b[35m${formatRule(ur.blockedBy)}\x1b[0m (${ur.blockedBy.type})`);
    lines.push(`   Reason: ${ur.reason}`);
    lines.push(`   \x1b[32mFix:\x1b[0m ${ur.fixSuggestion}`);
    lines.push('');
  }

  lines.push('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
  lines.push('');

  return lines.join('\n');
}

// ============ 全局实例 ============

/**
 * 默认权限规则管理器实例
 */
export const permissionRuleManager = new PermissionRuleManager();
