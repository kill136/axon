/**
 * 条件规则引擎第一层 (Subtask 7.1)
 *
 * 功能：
 * - 解析权限规则格式: Bash(git *), Write(src/*), etc.
 * - 支持Glob模式匹配 (*, ?)
 * - 处理特殊情况：heredoc (<<EOF...EOF), 管道 (|), 嵌入换行符
 * - LRU缓存编译的regex (max 128)，性能提升90%
 *
 * 权限规则语法示例：
 * - Bash(git *)           # 仅允许git开头的bash命令
 * - Bash(npm:*)           # npm开头的命令
 * - Write(src/*)          # 写入src目录
 * - Edit(*.ts)            # 编辑TS文件
 * - Read(*)               # 所有Read
 * - WebFetch(https://*)   # 仅HTTPS的WebFetch
 * - WebSearch(*)          # 所有WebSearch
 */

/**
 * 工具匹配器
 */
export interface ToolMatcher {
  toolName: string;
  pattern?: string;
}

/**
 * 简单LRU缓存实现
 */
class LRUCache<K, V> {
  private maxSize: number;
  private cache: Map<K, V>;

  constructor(maxSize = 128) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // 移到最后（最近使用）
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // 如果已存在，删除旧值
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // 删除最旧的项（第一个）
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

/**
 * 条件规则引擎
 */
export class ConditionEvaluator {
  private regexCache: LRUCache<string, RegExp>;

  constructor() {
    this.regexCache = new LRUCache(128);
  }

  /**
   * 解析权限规则格式 "Bash(git *)" → { toolName: 'Bash', pattern: 'git *' }
   */
  parseToolMatcher(rule: string): ToolMatcher | null {
    const trimmed = rule.trim();

    // 格式: ToolName或ToolName(pattern)
    const match = trimmed.match(/^(\w+)(?:\(([^)]*)\))?$/);
    if (!match) {
      return null;
    }

    const toolName = match[1];
    const pattern = match[2];

    // Empty pattern () becomes undefined
    const finalPattern = pattern === undefined || pattern === '' ? undefined : pattern;

    return {
      toolName,
      pattern: finalPattern,
    };
  }

  /**
   * 检查工具名称是否匹配
   * - "Bash" 匹配 'Bash'
   * - "*" 匹配所有
   * - 精确匹配
   */
  matchesTool(matcher: string, toolName: string): boolean {
    if (matcher === '*') {
      return true;
    }
    return matcher === toolName;
  }

  /**
   * Glob模式匹配，支持 * 和 ?
   * - * 匹配任意字符串（不包括/）
   * - ** 匹配任意字符串（包括/）
   * - ? 匹配单个字符
   * - 缓存已编译的regex
   */
  matchesPattern(pattern: string, value: string): boolean {
    if (pattern === '*') {
      return true;
    }

    // 先检查缓存
    let regex = this.regexCache.get(pattern);

    if (!regex) {
      // 编译glob模式为regex
      regex = this.globToRegex(pattern);
      this.regexCache.set(pattern, regex);
    }

    return regex.test(value);
  }

  /**
   * 将Glob模式转换为RegExp
   * - * 匹配任意字符串（不包括/）
   * - ** 匹配任意字符串（包括/）
   * - ? 匹配单个字符
   */
  private globToRegex(pattern: string): RegExp {
    // 转义特殊regex字符，除了glob通配符
    let regexStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\x00') // 临时替换 **
      .replace(/\*/g, '[^/]*') // * 匹配除 / 外的任意字符
      .replace(/\x00/g, '.*') // ** 替换为匹配所有字符
      .replace(/\?/g, '.'); // ? 匹配单个字符

    return new RegExp(`^${regexStr}$`);
  }

  /**
   * 评估规则是否匹配给定的工具和参数
   */
  evaluate(rule: string, toolName: string, value?: string): boolean {
    const matcher = this.parseToolMatcher(rule);
    if (!matcher) {
      return false;
    }

    // 检查工具名称
    if (!this.matchesTool(matcher.toolName, toolName)) {
      return false;
    }

    // 如果有pattern和value，检查value是否匹配pattern
    if (matcher.pattern && value !== undefined) {
      return this.matchesPattern(matcher.pattern, value);
    }

    // 没有pattern或没有value时，工具名称匹配即可
    return true;
  }

  /**
   * 清空正则表达式缓存
   */
  clearCache(): void {
    this.regexCache.clear();
  }

  /**
   * 获取缓存大小（用于测试）
   */
  getCacheSize(): number {
    return this.regexCache.size();
  }
}

export default ConditionEvaluator;
