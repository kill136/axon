/**
 * Shell 命令安全检查模块
 *
 * 修复 CVE-2.1.6 和 CVE-2.1.7 安全漏洞：
 * - (2.1.7) 修复通配符权限规则可以匹配包含 shell 操作符的复合命令的漏洞
 * - (2.1.6) 修复通过 shell 行续行符绕过权限检查的漏洞
 *
 * 功能：
 * - 检测命令是否包含危险的 shell 操作符
 * - 检测 shell 行续行符绕过尝试
 * - 拆分复合命令进行独立检查
 * - 提供安全的命令匹配功能
 */

/**
 * 危险的 shell 操作符列表
 * 这些操作符可以用于链接多个命令或改变命令执行流程
 */
export const DANGEROUS_SHELL_OPERATORS = [
  '&&',    // AND 操作符 - 前一命令成功后执行
  '||',    // OR 操作符 - 前一命令失败后执行
  ';',     // 命令分隔符 - 顺序执行
  '|',     // 管道 - 将输出传递给下一命令
  '>',     // 输出重定向
  '>>',    // 追加输出重定向
  '<',     // 输入重定向
  '`',     // 命令替换（反引号）
  '$(',    // 命令替换（美元括号）
  '${',    // 参数替换
  '\\',    // 行续行符（在行尾时）
] as const;

/**
 * 用于检测 shell 操作符的正则表达式
 * 需要排除在引号内的操作符
 */
const SHELL_OPERATOR_PATTERNS = {
  // 逻辑操作符（不在引号内）
  AND: /(?<!['"\\])&&(?!['"\\])/,
  OR: /(?<!['"\\])\|\|(?!['"\\])/,
  // 命令分隔符（不在引号内）
  SEMICOLON: /(?<!['"\\]);(?!['"\\])/,
  // 管道（不在引号内，且不是 ||）
  PIPE: /(?<!['"\\|])\|(?![|'"\\])/,
  // 输出重定向（不在引号内）
  REDIRECT_OUT: /(?<!['"\\>])>>?(?!['"\\])/,
  // 输入重定向（不在引号内）
  REDIRECT_IN: /(?<!['"\\])<(?!['"\\<])/,
  // 反引号命令替换（不在双引号内是安全的，但单引号内不执行）
  BACKTICK: /(?<!['\\])`/,
  // 美元括号命令替换
  COMMAND_SUB: /(?<!['"\\])\$\(/,
  // 参数替换
  PARAM_SUB: /(?<!['"\\])\$\{/,
  // 行续行符（在行尾）
  LINE_CONTINUATION: /\\\s*$/m,
  // 多行中的行续行符
  LINE_CONTINUATION_MULTILINE: /\\\r?\n/,
};

/**
 * Shell 安全检查结果
 */
export interface ShellSecurityCheckResult {
  /** 是否安全（无危险操作符） */
  safe: boolean;
  /** 检测到的危险操作符 */
  detectedOperators: string[];
  /** 是否是复合命令 */
  isCompoundCommand: boolean;
  /** 是否包含行续行符 */
  hasLineContinuation: boolean;
  /** 详细原因 */
  reason?: string;
  /** 拆分后的子命令（如果是复合命令） */
  subcommands?: string[];
}

/**
 * 检测命令是否包含危险的 shell 操作符
 *
 * @param command 要检查的命令
 * @returns 安全检查结果
 */
export function checkShellSecurity(command: string): ShellSecurityCheckResult {
  const detectedOperators: string[] = [];
  let isCompoundCommand = false;
  let hasLineContinuation = false;
  let reason: string | undefined;

  // 1. 检测行续行符（CVE-2.1.6 修复）
  if (SHELL_OPERATOR_PATTERNS.LINE_CONTINUATION.test(command) ||
      SHELL_OPERATOR_PATTERNS.LINE_CONTINUATION_MULTILINE.test(command)) {
    hasLineContinuation = true;
    detectedOperators.push('\\');
    reason = 'Command contains line continuation character that could bypass permission checks';
  }

  // 2. 使用安全的方式解析命令，排除引号内的内容
  const unquotedCommand = removeQuotedStrings(command);

  // 3. 检测逻辑操作符
  if (SHELL_OPERATOR_PATTERNS.AND.test(unquotedCommand)) {
    detectedOperators.push('&&');
    isCompoundCommand = true;
  }

  if (SHELL_OPERATOR_PATTERNS.OR.test(unquotedCommand)) {
    detectedOperators.push('||');
    isCompoundCommand = true;
  }

  if (SHELL_OPERATOR_PATTERNS.SEMICOLON.test(unquotedCommand)) {
    detectedOperators.push(';');
    isCompoundCommand = true;
  }

  // 4. 检测管道
  if (SHELL_OPERATOR_PATTERNS.PIPE.test(unquotedCommand)) {
    detectedOperators.push('|');
    isCompoundCommand = true;
  }

  // 5. 检测重定向
  if (SHELL_OPERATOR_PATTERNS.REDIRECT_OUT.test(unquotedCommand)) {
    detectedOperators.push('>');
  }

  if (SHELL_OPERATOR_PATTERNS.REDIRECT_IN.test(unquotedCommand)) {
    detectedOperators.push('<');
  }

  // 6. 检测命令替换
  if (SHELL_OPERATOR_PATTERNS.BACKTICK.test(unquotedCommand)) {
    detectedOperators.push('`');
    isCompoundCommand = true;
  }

  if (SHELL_OPERATOR_PATTERNS.COMMAND_SUB.test(unquotedCommand)) {
    detectedOperators.push('$(');
    isCompoundCommand = true;
  }

  // 7. 检测参数替换
  if (SHELL_OPERATOR_PATTERNS.PARAM_SUB.test(unquotedCommand)) {
    detectedOperators.push('${');
  }

  // 构建结果
  const safe = detectedOperators.length === 0;

  if (!safe && !reason) {
    if (isCompoundCommand) {
      reason = `Command contains shell operators (${detectedOperators.join(', ')}) that could execute multiple commands`;
    } else {
      reason = `Command contains shell operators (${detectedOperators.join(', ')}) that require special handling`;
    }
  }

  const result: ShellSecurityCheckResult = {
    safe,
    detectedOperators,
    isCompoundCommand,
    hasLineContinuation,
    reason,
  };

  // 如果是复合命令，尝试拆分子命令
  if (isCompoundCommand) {
    result.subcommands = splitCompoundCommand(command);
  }

  return result;
}

/**
 * 移除命令中的引号字符串，以便正确检测操作符
 *
 * @param command 原始命令
 * @returns 移除引号内容后的命令
 */
function removeQuotedStrings(command: string): string {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const prevChar = i > 0 ? command[i - 1] : '';

    // 处理转义
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      // 检查是否是行续行符
      if (i === command.length - 1 || command[i + 1] === '\n' || command[i + 1] === '\r') {
        result += '\\';
      }
      continue;
    }

    // 处理引号状态
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    // 只添加不在引号内的字符
    if (!inSingleQuote && !inDoubleQuote) {
      result += char;
    }
  }

  return result;
}

/**
 * 拆分复合命令为子命令列表
 *
 * @param command 复合命令
 * @returns 子命令列表
 */
export function splitCompoundCommand(command: string): string[] {
  const subcommands: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = i < command.length - 1 ? command[i + 1] : '';

    // 处理转义
    if (escaped) {
      escaped = false;
      current += char;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      // 行续行符不添加到当前命令
      if (nextChar === '\n' || nextChar === '\r' || i === command.length - 1) {
        continue;
      }
      current += char;
      continue;
    }

    // 处理引号
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    // 在引号内，直接添加字符
    if (inSingleQuote || inDoubleQuote) {
      current += char;
      continue;
    }

    // 处理括号深度
    if (char === '(' || char === '$' && nextChar === '(') {
      parenDepth++;
      current += char;
      continue;
    }

    if (char === ')') {
      parenDepth--;
      current += char;
      continue;
    }

    if (char === '{') {
      braceDepth++;
      current += char;
      continue;
    }

    if (char === '}') {
      braceDepth--;
      current += char;
      continue;
    }

    // 只在顶层检测分隔符
    if (parenDepth === 0 && braceDepth === 0) {
      // 检测 && 和 ||
      if ((char === '&' && nextChar === '&') ||
          (char === '|' && nextChar === '|')) {
        if (current.trim()) {
          subcommands.push(current.trim());
        }
        current = '';
        i++; // 跳过下一个字符
        continue;
      }

      // 检测 ; 和 |
      if (char === ';' || (char === '|' && nextChar !== '|')) {
        if (current.trim()) {
          subcommands.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  // 添加最后一个命令
  if (current.trim()) {
    subcommands.push(current.trim());
  }

  return subcommands;
}

/**
 * 检查命令是否可以安全地与通配符权限规则匹配
 *
 * 当命令包含 shell 操作符时，不应该用通配符规则自动允许，
 * 因为攻击者可能利用这些操作符注入恶意命令。
 *
 * 例如：
 * - 规则 "Bash(npm:*)" 应该匹配 "npm install"
 * - 但不应该匹配 "npm install && rm -rf /"
 *
 * @param command 要检查的命令
 * @param rulePattern 权限规则模式
 * @returns 是否可以安全匹配
 */
export function canSafelyMatchWildcardRule(command: string, rulePattern: string): {
  canMatch: boolean;
  reason?: string;
} {
  const securityCheck = checkShellSecurity(command);

  // 如果命令包含行续行符，拒绝匹配（CVE-2.1.6 修复）
  if (securityCheck.hasLineContinuation) {
    return {
      canMatch: false,
      reason: 'Command contains line continuation character (\\) that could bypass permission checks. ' +
              'Wildcard permission rules cannot match commands with line continuations.',
    };
  }

  // 如果是复合命令，拒绝直接匹配（CVE-2.1.7 修复）
  if (securityCheck.isCompoundCommand) {
    return {
      canMatch: false,
      reason: `Command contains shell operators (${securityCheck.detectedOperators.join(', ')}) ` +
              'that create a compound command. Wildcard permission rules cannot match compound commands. ' +
              'Each subcommand must be checked separately.',
    };
  }

  // 如果命令包含命令替换或参数替换，需要额外检查
  if (securityCheck.detectedOperators.includes('$(') ||
      securityCheck.detectedOperators.includes('`') ||
      securityCheck.detectedOperators.includes('${')) {
    return {
      canMatch: false,
      reason: 'Command contains command substitution or parameter expansion that could execute arbitrary code. ' +
              'Wildcard permission rules cannot match commands with substitutions.',
    };
  }

  return { canMatch: true };
}

/**
 * 安全地匹配 Bash 命令权限规则
 *
 * 这个函数在匹配之前会先检查命令是否包含危险的 shell 操作符。
 * 如果命令是复合命令，会拆分为子命令，每个子命令单独检查。
 *
 * @param command 要检查的命令
 * @param rules 权限规则列表（格式：{pattern: string, type: 'prefix' | 'exact' | 'wildcard'}）
 * @param matchType 匹配类型
 * @returns 匹配结果
 */
export function safeMatchBashRule(
  command: string,
  rules: Array<{ pattern: string; type: 'prefix' | 'exact' | 'wildcard' }>,
  matchType: 'exact' | 'prefix' = 'prefix'
): {
  matched: boolean;
  matchedRule?: string;
  requiresManualApproval: boolean;
  reason?: string;
  subcommandResults?: Array<{ command: string; matched: boolean; matchedRule?: string }>;
} {
  const securityCheck = checkShellSecurity(command);

  // 如果命令包含行续行符，需要手动批准
  if (securityCheck.hasLineContinuation) {
    return {
      matched: false,
      requiresManualApproval: true,
      reason: 'Command contains line continuation character. Manual approval required.',
    };
  }

  // 如果是复合命令，需要拆分检查
  if (securityCheck.isCompoundCommand && securityCheck.subcommands) {
    const subcommandResults: Array<{ command: string; matched: boolean; matchedRule?: string }> = [];
    let allMatched = true;

    for (const subcmd of securityCheck.subcommands) {
      const subResult = matchSingleCommand(subcmd, rules, matchType);
      subcommandResults.push({
        command: subcmd,
        matched: subResult.matched,
        matchedRule: subResult.matchedRule,
      });

      if (!subResult.matched) {
        allMatched = false;
      }
    }

    // 只有所有子命令都匹配才算匹配
    if (!allMatched) {
      return {
        matched: false,
        requiresManualApproval: true,
        reason: `Compound command detected with operators: ${securityCheck.detectedOperators.join(', ')}. ` +
                'Not all subcommands match the permission rules.',
        subcommandResults,
      };
    }

    return {
      matched: true,
      requiresManualApproval: false,
      subcommandResults,
    };
  }

  // 简单命令，直接匹配
  const result = matchSingleCommand(command, rules, matchType);

  return {
    matched: result.matched,
    matchedRule: result.matchedRule,
    requiresManualApproval: false,
  };
}

/**
 * 匹配单个命令（非复合命令）
 */
function matchSingleCommand(
  command: string,
  rules: Array<{ pattern: string; type: 'prefix' | 'exact' | 'wildcard' }>,
  matchType: 'exact' | 'prefix'
): { matched: boolean; matchedRule?: string } {
  const trimmedCommand = command.trim();

  for (const rule of rules) {
    let matched = false;

    switch (rule.type) {
      case 'exact':
        matched = trimmedCommand === rule.pattern;
        break;

      case 'prefix':
        // 前缀匹配：命令以模式开头，后跟空格或到结尾
        if (trimmedCommand === rule.pattern) {
          matched = true;
        } else if (trimmedCommand.startsWith(rule.pattern + ' ')) {
          matched = true;
        }
        break;

      case 'wildcard':
        // 通配符匹配需要先检查安全性
        const safeCheck = canSafelyMatchWildcardRule(command, rule.pattern);
        if (!safeCheck.canMatch) {
          continue; // 不安全，跳过此规则
        }
        // 简单的通配符匹配（* 匹配任意字符）
        const regexPattern = rule.pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        matched = new RegExp(`^${regexPattern}$`).test(trimmedCommand);
        break;
    }

    if (matched) {
      return { matched: true, matchedRule: rule.pattern };
    }
  }

  return { matched: false };
}

// ============================================================================
// v2.1.30: Git 命令安全标志验证系统
// 对齐官方实现，每个 git 子命令有独立的 safeFlags 白名单
// 标志类型：'none' = 布尔标志，'string' = 接受字符串值，'number' = 接受数字值
// ============================================================================

type SafeFlagType = 'none' | 'string' | 'number';

// 共享标志组（对齐官方 jG6, zU1, GG6, wU1, $yA, OyA 等压缩变量）
const commonFormatFlags: Record<string, SafeFlagType> = {
  '--oneline': 'none', '-n': 'number', '--max-count': 'number',
  '--skip': 'number', '--since': 'string', '--until': 'string',
  '--after': 'string', '--before': 'string', '--author': 'string',
  '--committer': 'string', '--grep': 'string', '--all-match': 'none',
  '--invert-grep': 'none', '-i': 'none', '--regexp-ignore-case': 'none',
  '--extended-regexp': 'none', '-E': 'none', '--fixed-strings': 'none', '-F': 'none',
};

const diffFlags: Record<string, SafeFlagType> = {
  '--stat': 'none', '--shortstat': 'none', '--numstat': 'none',
  '--summary': 'none', '--name-only': 'none', '--name-status': 'none',
  '--no-renames': 'none', '--check': 'none', '--full-index': 'none',
  '-p': 'none', '--patch': 'none', '-u': 'none', '--unified': 'number',
  '-U': 'number', '--no-patch': 'none', '-s': 'none',
  '--color': 'string', '--no-color': 'none',
  '--word-diff': 'none', '--word-diff-regex': 'string', '--color-words': 'none',
  '--diff-algorithm': 'string', '--diff-filter': 'string',
  '-w': 'none', '--ignore-all-space': 'none', '-b': 'none',
  '--ignore-space-change': 'none', '--ignore-blank-lines': 'none',
  '--ignore-space-at-eol': 'none', '--histogram': 'none',
  '--patience': 'none', '--minimal': 'none',
  '--no-ext-diff': 'none', '--binary': 'none',
  '--abbrev': 'number', '--inter-hunk-context': 'number',
};

const pathFlags: Record<string, SafeFlagType> = { '--': 'none', '--follow': 'none' };

const graphFlags: Record<string, SafeFlagType> = {
  '--graph': 'none', '--all': 'none', '--decorate': 'none', '--no-decorate': 'none',
  '--decorate-refs': 'string', '--decorate-refs-exclude': 'string',
  '--source': 'none', '--remotes': 'none', '--branches': 'none',
  '--tags': 'none', '--glob': 'string', '--exclude': 'string',
};

const outputFlags: Record<string, SafeFlagType> = {
  '--pretty': 'string', '--format': 'string',
  '--abbrev-commit': 'none', '--no-abbrev-commit': 'none',
  '--date': 'string', '--relative-date': 'none',
  '--parents': 'none', '--children': 'none',
  '--left-right': 'none', '--show-signature': 'none', '--show-linear-break': 'none',
};

/** v2.1.30: 每个 git 子命令的安全标志白名单（对齐官方 safeFlags 配置） */
export const GIT_COMMAND_SAFE_FLAGS: Record<string, Record<string, SafeFlagType>> = {
  'git log': {
    ...commonFormatFlags, ...diffFlags, ...pathFlags, ...graphFlags, ...outputFlags,
    '--full-history': 'none', '--dense': 'none', '--sparse': 'none',
    '--simplify-merges': 'none', '--ancestry-path': 'none',
    '--first-parent': 'none', '--merges': 'none', '--no-merges': 'none',
    '--reverse': 'none', '--walk-reflogs': 'none',
    '--max-age': 'number', '--min-age': 'number',
    '--no-min-parents': 'none', '--no-max-parents': 'none',
    '--no-walk': 'none',
    '--cherry-mark': 'none', '--cherry-pick': 'none', '--boundary': 'none',
    '--topo-order': 'none', '--date-order': 'none', '--author-date-order': 'none',
    '-S': 'string', '-G': 'string',
    '--pickaxe-regex': 'none', '--pickaxe-all': 'none',
  },
  'git show': {
    ...commonFormatFlags, ...diffFlags, ...pathFlags, ...outputFlags,
    '--first-parent': 'none', '--raw': 'none', '-m': 'none', '--quiet': 'none',
  },
  'git diff': {
    ...commonFormatFlags, ...diffFlags, ...pathFlags,
    '--cached': 'none', '--staged': 'none', '--merge-base': 'none',
    '--no-index': 'none', '--exit-code': 'none', '--quiet': 'none',
    '-R': 'none', '--relative': 'string', '--text': 'none', '-a': 'none',
  },
  'git status': {
    '--short': 'none', '-s': 'none', '--branch': 'none', '-b': 'none',
    '--porcelain': 'none', '--long': 'none', '--verbose': 'none', '-v': 'none',
    '--untracked-files': 'string', '-u': 'string',
    '--ignored': 'none', '--ahead-behind': 'none', '--no-ahead-behind': 'none',
    '--column': 'none', '--no-column': 'none',
  },
  'git branch': {
    '--list': 'none', '-l': 'none', '-a': 'none', '--all': 'none',
    '-r': 'none', '--remotes': 'none', '-v': 'none', '--verbose': 'none', '-vv': 'none',
    '--merged': 'string', '--no-merged': 'string',
    '--contains': 'string', '--no-contains': 'string',
    '--sort': 'string', '--format': 'string',
    '--color': 'string', '--no-color': 'none',
    '--abbrev': 'number', '--no-abbrev': 'none',
    '--points-at': 'string', '--column': 'none', '--no-column': 'none',
  },
};

/**
 * v2.1.30: 验证 git 命令的标志是否在安全白名单中
 */
export function validateGitFlags(command: string, gitSubcmd: string): boolean {
  const safeFlags = GIT_COMMAND_SAFE_FLAGS[gitSubcmd];
  if (!safeFlags) return true;

  const argsStr = command.trim().slice(gitSubcmd.length).trim();
  if (!argsStr) return true;

  // 简单解析参数（处理引号）
  const args = parseGitArgs(argsStr);

  for (const arg of args) {
    if (!arg.startsWith('-')) continue;
    if (arg === '--') break;

    // 处理 --flag=value 格式
    const eqIdx = arg.indexOf('=');
    const flagName = eqIdx > -1 ? arg.slice(0, eqIdx) : arg;

    if (!(flagName in safeFlags)) {
      return false; // 未知标志
    }
  }

  return true;
}

function parseGitArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false, inDouble = false, escaped = false;

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === '\\' && !inSingle) { escaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current) { args.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) args.push(current);
  return args;
}

/**
 * 检查命令是否只包含安全的读取操作
 *
 * 安全的读取操作不会修改系统状态，可以自动允许。
 * 但是即使是读取操作，如果包含 shell 操作符，也需要检查。
 *
 * v2.1.30: git 命令增加 safeFlags 细粒度验证
 *
 * @param command 要检查的命令
 * @returns 是否是安全的只读操作
 */
export function isReadOnlyCommand(command: string): boolean {
  const securityCheck = checkShellSecurity(command);

  // 如果包含危险操作符，不是安全的只读操作
  if (!securityCheck.safe) {
    return false;
  }

  const trimmedCommand = command.trim();

  // v2.1.30: git 命令使用 safeFlags 细粒度验证
  for (const gitCmd of Object.keys(GIT_COMMAND_SAFE_FLAGS)) {
    if (trimmedCommand === gitCmd || trimmedCommand.startsWith(gitCmd + ' ')) {
      return validateGitFlags(trimmedCommand, gitCmd);
    }
  }

  // 其他安全的只读命令列表
  const readOnlyCommands = [
    'ls', 'dir', 'pwd', 'cat', 'head', 'tail', 'less', 'more',
    'grep', 'find', 'which', 'whereis', 'type', 'file',
    'echo', 'printf', 'env', 'printenv',
    'npm list', 'npm ls', 'npm view', 'npm info',
    'node --version', 'npm --version', 'python --version',
  ];

  for (const cmd of readOnlyCommands) {
    if (trimmedCommand === cmd || trimmedCommand.startsWith(cmd + ' ')) {
      return true;
    }
  }

  return false;
}

/**
 * 提取命令的前缀（用于前缀匹配）
 *
 * @param command 命令
 * @returns 命令前缀（第一个单词或空格前的部分）
 */
export function extractCommandPrefix(command: string): string {
  const trimmed = command.trim();
  const spaceIndex = trimmed.indexOf(' ');
  return spaceIndex > -1 ? trimmed.substring(0, spaceIndex) : trimmed;
}

/**
 * 规范化命令以进行匹配
 *
 * @param command 原始命令
 * @returns 规范化后的命令
 */
export function normalizeCommand(command: string): string {
  let normalized = command.trim();

  // v2.1.65: Bug fix - 移除 heredoc 及其内容
  // 处理 <<DELIMITER ... DELIMITER 的 heredoc 语法
  // 支持 <<EOF, <<-EOF, <<"EOF", <<'EOF' 等形式
  // 策略：从 << 到第一个换行符（heredoc结束）之前的内容保留，
  // 其余内容（heredoc体和结束符）都移除
  normalized = normalized.split('<<')[0];

  // 移除行续行符和后续换行（修改前的逻辑）
  normalized = normalized.replace(/\\\r?\n\s*/g, ' ');

  // 压缩多个空格
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized.trim();
}

/**
 * v2.1.38: 从命令中提取实际命令（跳过环境变量前缀和 shell wrapper 关键字）
 *
 * 例如:
 * - "KEY=value npm install" → "npm install"
 * - "A=1 B=2 command arg" → "command arg"
 * - "command builtin noglob npm test" → "npm test"
 * - "npm install" → "npm install" (无变化)
 */
const SHELL_WRAPPER_KEYWORDS = new Set(['command', 'builtin', 'noglob', 'nocorrect']);
const ENV_VAR_PREFIX_PATTERN = /^[A-Za-z_]\w*=/;

export function extractActualCommand(command: string): string {
  const trimmed = command.trim();
  const tokens = trimmed.split(/\s+/);
  let actualStartIndex = 0;

  for (let i = 0; i < tokens.length; i++) {
    // 跳过 KEY=value 格式的环境变量前缀
    if (ENV_VAR_PREFIX_PATTERN.test(tokens[i])) {
      actualStartIndex = i + 1;
      continue;
    }
    // 跳过 shell wrapper 关键字
    if (SHELL_WRAPPER_KEYWORDS.has(tokens[i])) {
      actualStartIndex = i + 1;
      continue;
    }
    // 找到了实际命令
    break;
  }

  // 如果所有 token 都是前缀/wrapper，返回原始命令
  if (actualStartIndex >= tokens.length) {
    return trimmed;
  }

  return tokens.slice(actualStartIndex).join(' ');
}
