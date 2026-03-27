/**
 * WebUI 权限条件匹配器
 * 从 CLI 的条件规则引擎 (src/hooks/condition-parser.ts) 移植
 * 支持 glob 模式匹配，如 Bash(git *), Write(src/*.ts), Edit(*.json)
 */

/**
 * 条件规则
 */
export interface ConditionRule {
  /** 工具名称（精确匹配） */
  toolName: string;
  /** 文件/命令模式（null = 匹配该工具的所有调用） */
  pattern: string | null;
}

/** 已解析的条件规则缓存 */
const ruleCache = new Map<string, ConditionRule | null>();

/** 已编译的 glob 正则缓存 */
const globRegexCache = new Map<string, RegExp>();

/**
 * 将 glob 模式转换为正则表达式
 * 支持: * (任意字符), ** (任意路径), ? (单个字符), [abc] (字符类)
 */
function globToRegex(pattern: string): RegExp {
  const cached = globRegexCache.get(pattern);
  if (cached) {
    return cached;
  }

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
    // ** 匹配任意路径（包含 /）
    .replace(/__STAR____STAR__/g, '.*')
    // * 匹配任意字符（不含 /，但为简化兼容性也允许）
    .replace(/__STAR__/g, '.*')
    .replace(/__QUESTION__/g, '.')
    .replace(/__BRACKET_OPEN__/g, '[')
    .replace(/__BRACKET_CLOSE__/g, ']');

  const regex = new RegExp(`^${regexStr}$`);
  globRegexCache.set(pattern, regex);
  return regex;
}

/**
 * glob 模式匹配
 */
function globMatch(str: string, pattern: string): boolean {
  return globToRegex(pattern).test(str);
}

/**
 * 解析条件规则字符串
 * @param rule 如 "Bash(git *)", "Write(src/*.ts)", "Bash", "*"
 * @returns 解析后的规则，无效返回 null
 */
export function parseConditionRule(rule: string): ConditionRule | null {
  if (ruleCache.has(rule)) {
    return ruleCache.get(rule) || null;
  }

  const trimmed = rule.trim();

  // 无条件通配
  if (trimmed === '*') {
    ruleCache.set(rule, null);
    return null;
  }

  // "ToolName(pattern)" 格式
  const match = /^(\w+)\((.+)\)$/.exec(trimmed);
  if (match) {
    const [, toolName, pattern] = match;
    const result: ConditionRule = {
      toolName,
      pattern: pattern.trim(),
    };
    ruleCache.set(rule, result);
    return result;
  }

  // 纯工具名（无括号），如 "Bash" — 匹配该工具的所有调用
  if (/^\w+$/.test(trimmed)) {
    const result: ConditionRule = {
      toolName: trimmed,
      pattern: null,
    };
    ruleCache.set(rule, result);
    return result;
  }

  // 无效格式
  ruleCache.set(rule, null);
  return null;
}

/**
 * 从工具参数中提取用于匹配的值
 */
function extractMatchValue(toolName: string, args: Record<string, unknown>): string {
  // Bash: 匹配 command 字段
  if (toolName === 'Bash' && typeof args.command === 'string') {
    return args.command;
  }

  // 文件操作: 匹配 file_path / filePath / path / notebook_path
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Read' || toolName === 'MultiEdit') {
    if (typeof args.file_path === 'string') return args.file_path;
    if (typeof args.filePath === 'string') return args.filePath;
    if (typeof args.path === 'string') return args.path;
  }

  if (toolName === 'NotebookEdit') {
    if (typeof args.notebook_path === 'string') return args.notebook_path;
  }

  // 通用回退: 序列化参数
  return JSON.stringify(args);
}

/**
 * 检查工具调用是否匹配条件规则
 * @param rule 条件规则
 * @param toolName 工具名称
 * @param args 工具参数
 * @returns 是否匹配
 */
export function matchesCondition(rule: ConditionRule, toolName: string, args: Record<string, unknown>): boolean {
  // 工具名称必须匹配
  if (rule.toolName !== toolName) {
    return false;
  }

  // pattern 为 null 表示匹配该工具的所有调用
  if (rule.pattern === null) {
    return true;
  }

  const value = extractMatchValue(toolName, args);
  return globMatch(value, rule.pattern);
}

/**
 * 检查工具调用是否匹配规则列表中的任一规则
 * @param rules 规则字符串列表，如 ["Bash(git *)", "Write(src/*.ts)"]
 * @param toolName 工具名称
 * @param args 工具参数
 * @returns 是否匹配任一规则
 */
export function matchesAnyCondition(rules: string[], toolName: string, args: Record<string, unknown>): boolean {
  for (const ruleStr of rules) {
    const parsed = parseConditionRule(ruleStr);

    // null 表示无条件通配 "*"，匹配一切
    if (parsed === null) {
      // 但要区分 "*" 和无效规则 — "*" 应匹配，无效规则不应
      if (ruleStr.trim() === '*') {
        return true;
      }
      continue;
    }

    if (matchesCondition(parsed, toolName, args)) {
      return true;
    }
  }

  return false;
}

/**
 * 清除缓存（用于测试）
 */
export function clearConditionMatcherCache(): void {
  ruleCache.clear();
  globRegexCache.clear();
}
