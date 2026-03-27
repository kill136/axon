/**
 * Hook 条件执行引擎
 * 支持 if: "Bash(git *)" 语法的条件过滤
 * 基于 Anthropic 官方 CLI v2.1.85
 */

/**
 * Hook 条件规则
 */
export interface ConditionRule {
  /** 工具名称（精确匹配） */
  toolName: string;
  /** 文件/命令模式（glob模式） */
  pattern: string;
}

/**
 * Hook 执行上下文
 */
export interface HookContext {
  /** 执行的工具名称 */
  toolName?: string;
  /** 工具输入（对于文件操作，包含filePath等） */
  toolInput?: Record<string, unknown>;
  /** 其他上下文字段 */
  [key: string]: unknown;
}

/** 已编译的条件规则缓存（性能优化） */
const conditionCache = new Map<string, ConditionRule | null>();

/** 已编译的 glob 正则缓存（性能优化） */
const globRegexCache = new Map<string, RegExp>();

/**
 * 将 glob 模式转换为正则表达式
 * 支持: *, **, ?, [abc]
 */
function globToRegex(pattern: string): RegExp {
  // 检查缓存
  if (globRegexCache.has(pattern)) {
    return globRegexCache.get(pattern)!;
  }

  // 转义特殊字符，除了 glob 通配符
  let regexStr = pattern
    .split('')
    .map((char) => {
      if (char === '*') return '__STAR__';
      if (char === '?') return '__QUESTION__';
      if (char === '[') return '__BRACKET_OPEN__';
      if (char === ']') return '__BRACKET_CLOSE__';
      return char;
    })
    .join('')
    // 转义正则特殊字符
    .replace(/[.+^${}()|\\]/g, '\\$&')
    // 恢复 glob 通配符
    .replace(/__STAR__/g, '.*')
    .replace(/__QUESTION__/g, '.')
    .replace(/__BRACKET_OPEN__/g, '[')
    .replace(/__BRACKET_CLOSE__/g, ']');

  // 创建正则（需要精确匹配）
  const regex = new RegExp(`^${regexStr}$`);
  globRegexCache.set(pattern, regex);

  return regex;
}

/**
 * 简单的 glob 模式匹配（类似 minimatch）
 */
function globMatch(str: string, pattern: string): boolean {
  return globToRegex(pattern).test(str);
}

/**
 * 解析条件规则字符串
 * 支持格式:
 * - "Bash(git *)"      -> 匹配 Bash 工具，命令以 git 开头
 * - "Write(src/*)"     -> 匹配 Write 工具，src 目录下的文件
 * - "Edit(*.ts)"       -> 匹配 Edit 工具，所有 TS 文件
 * - "Bash(*)"          -> 匹配所有 Bash 命令
 * - "*"                -> 无条件执行（默认）
 *
 * @param rule 条件规则字符串
 * @returns 解析后的条件规则，如果是无条件("*")则返回null
 */
export function parseConditionRule(rule: string): ConditionRule | null {
  // 检查缓存
  if (conditionCache.has(rule)) {
    return conditionCache.get(rule) || null;
  }

  const trimmed = rule.trim();

  // 无条件执行
  if (trimmed === '*') {
    conditionCache.set(rule, null);
    return null;
  }

  // 解析 "ToolName(pattern)" 格式
  const match = /^(\w+)\((.+)\)$/.exec(trimmed);
  if (!match) {
    console.warn(`Invalid condition rule format: "${rule}", treating as no condition`);
    conditionCache.set(rule, null);
    return null;
  }

  const [, toolName, pattern] = match;
  const result: ConditionRule = {
    toolName,
    pattern: pattern.trim(),
  };

  conditionCache.set(rule, result);
  return result;
}

/**
 * 检查上下文是否匹配条件规则
 *
 * @param condition 条件规则
 * @param context Hook 执行上下文
 * @returns 是否满足条件
 */
export function matchesCondition(condition: ConditionRule | undefined | null, context: HookContext): boolean {
  // 无条件规则或未指定条件时，总是匹配
  if (!condition) {
    return true;
  }

  // 工具名称必须匹配
  if (!context.toolName || context.toolName !== condition.toolName) {
    return false;
  }

  // 获取要匹配的值（优先级: command > filePath > input字符串化）
  let valueToMatch = '';

  if (typeof context.toolInput === 'object' && context.toolInput !== null) {
    const input = context.toolInput as Record<string, unknown>;
    // 对于 Bash，匹配 command 字段
    if (condition.toolName === 'Bash' && typeof input.command === 'string') {
      valueToMatch = input.command;
    }
    // 对于文件操作，匹配 filePath 或 path 字段
    else if (
      (condition.toolName === 'Write' || condition.toolName === 'Edit' || condition.toolName === 'Read') &&
      (typeof input.file_path === 'string' || typeof input.filePath === 'string' || typeof input.path === 'string')
    ) {
      valueToMatch = (input.file_path || input.filePath || input.path) as string;
    }
    // 通用：尝试查找任何路径或命令相关的字段
    else {
      valueToMatch = JSON.stringify(context.toolInput);
    }
  }

  // 使用自定义 glob 模式匹配
  return globMatch(valueToMatch, condition.pattern);
}

/**
 * 清除条件缓存（主要用于测试）
 */
export function clearConditionCache(): void {
  conditionCache.clear();
  globRegexCache.clear();
}

/**
 * 获取缓存大小（主要用于性能监控）
 */
export function getConditionCacheSize(): number {
  return conditionCache.size;
}

/**
 * 获取 glob 正则缓存大小
 */
export function getGlobCacheSize(): number {
  return globRegexCache.size;
}
