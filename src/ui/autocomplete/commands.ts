/**
 * 命令自动完成提供器
 */

import type { CompletionItem } from './types.js';
import { getAllSkills } from '../../tools/skill.js';

// 所有可用命令列表 (基于官方 Claude Code v2.1.4)
export const ALL_COMMANDS: CompletionItem[] = [
  {
    value: '/add-dir ',
    label: '/add-dir',
    description: 'Add a new working directory',
    type: 'command',
    aliases: ['add'],
    priority: 10
  },
  {
    value: '/agents ',
    label: '/agents',
    description: 'Manage agent configurations',
    type: 'command',
    priority: 20
  },
  {
    value: '/bug ',
    label: '/bug',
    description: 'Report a bug or issue',
    type: 'command',
    priority: 30
  },
  {
    value: '/chrome ',
    label: '/chrome',
    description: 'Claude in Chrome (Beta) settings',
    type: 'command',
    priority: 40
  },
  {
    value: '/clear',
    label: '/clear',
    description: 'Clear conversation history',
    type: 'command',
    priority: 5
  },
  {
    value: '/compact',
    label: '/compact',
    description: 'Compact context to save tokens',
    type: 'command',
    aliases: ['c'],
    priority: 15
  },
  {
    value: '/config ',
    label: '/config',
    description: 'View or edit configuration',
    type: 'command',
    priority: 8
  },
  {
    value: '/context',
    label: '/context',
    description: 'Show current context window usage',
    type: 'command',
    aliases: ['ctx'],
    priority: 12
  },
  {
    value: '/cost',
    label: '/cost',
    description: 'Show API cost and spending information',
    type: 'command',
    priority: 18
  },
  {
    value: '/discover',
    label: '/discover',
    description: 'Discover and browse MCP servers',
    type: 'command',
    priority: 43
  },
  {
    value: '/debug',
    label: '/debug',
    description: 'Help troubleshoot the current session',
    type: 'command',
    priority: 24
  },
  {
    value: '/doctor ',
    label: '/doctor',
    description: 'Run diagnostics to check for issues',
    type: 'command',
    priority: 25
  },
  {
    value: '/exit',
    label: '/exit',
    description: 'Exit Claude Code',
    type: 'command',
    aliases: ['quit', 'q'],
    priority: 3
  },
  {
    value: '/export ',
    label: '/export',
    description: 'Export conversation to file',
    type: 'command',
    priority: 28
  },
  {
    value: '/extra-usage',
    label: '/extra-usage',
    description: 'Request additional usage beyond plan limits',
    type: 'command',
    priority: 44
  },
  {
    value: '/feedback ',
    label: '/feedback',
    description: 'Send feedback about Claude Code',
    type: 'command',
    priority: 35
  },
  {
    value: '/files ',
    label: '/files',
    description: 'List files in the current directory or context',
    type: 'command',
    aliases: ['ls'],
    priority: 9
  },
  {
    value: '/help',
    label: '/help',
    description: 'Show help and available commands',
    type: 'command',
    aliases: ['?', 'h'],
    priority: 1
  },
  {
    value: '/hooks ',
    label: '/hooks',
    description: 'Manage hook configurations',
    type: 'command',
    priority: 32
  },
  {
    value: '/ide ',
    label: '/ide',
    description: 'IDE integration settings',
    type: 'command',
    priority: 38
  },
  {
    value: '/init',
    label: '/init',
    description: 'Initialize CLAUDE.md configuration file',
    type: 'command',
    priority: 22
  },
  {
    value: '/install ',
    label: '/install',
    description: 'Install MCP server',
    type: 'command',
    priority: 26
  },
  {
    value: '/install-github-app',
    label: '/install-github-app',
    description: 'Install Claude Code GitHub App for CI/CD',
    type: 'command',
    aliases: ['github-app'],
    priority: 51
  },
  {
    value: '/install-slack-app',
    label: '/install-slack-app',
    description: 'Install Claude Code Slack App for notifications',
    type: 'command',
    aliases: ['slack-app'],
    priority: 52
  },
  {
    value: '/login',
    label: '/login',
    description: 'Log in to Anthropic account',
    type: 'command',
    priority: 45
  },
  {
    value: '/logout',
    label: '/logout',
    description: 'Log out from current account',
    type: 'command',
    priority: 46
  },
  {
    value: '/mcp ',
    label: '/mcp',
    description: 'Manage MCP servers',
    type: 'command',
    priority: 24
  },
  {
    value: '/memory ',
    label: '/memory',
    description: 'View or edit memory/instructions',
    type: 'command',
    priority: 27
  },
  {
    value: '/mobile',
    label: '/mobile',
    description: 'Show QR code for mobile connection',
    type: 'command',
    priority: 47
  },
  {
    value: '/model ',
    label: '/model',
    description: 'Switch or view current model',
    type: 'command',
    aliases: ['m'],
    priority: 7
  },
  {
    value: '/output-style ',
    label: '/output-style',
    description: 'Configure output style (concise/verbose)',
    type: 'command',
    aliases: ['style'],
    priority: 53
  },
  {
    value: '/permissions ',
    label: '/permissions',
    description: 'View or change permission mode',
    type: 'command',
    aliases: ['perms'],
    priority: 19
  },
  {
    value: '/plan',
    label: '/plan',
    description: 'Enter planning mode for complex tasks',
    type: 'command',
    priority: 11
  },
  {
    value: '/plugin ',
    label: '/plugin',
    description: 'Manage plugins',
    type: 'command',
    priority: 33
  },
  {
    value: '/pr-comments ',
    label: '/pr-comments',
    description: 'View or respond to PR comments',
    type: 'command',
    aliases: ['pr'],
    priority: 29
  },
  {
    value: '/privacy-settings',
    label: '/privacy-settings',
    description: 'View and update privacy settings',
    type: 'command',
    aliases: ['privacy'],
    priority: 54
  },
  {
    value: '/rate-limit-options',
    label: '/rate-limit-options',
    description: 'View rate limit options and status',
    type: 'command',
    aliases: ['rate-limit', 'limits'],
    priority: 55
  },
  {
    value: '/release-notes',
    label: '/release-notes',
    description: 'Show recent release notes and changes',
    type: 'command',
    aliases: ['changelog', 'whats-new'],
    priority: 36
  },
  {
    value: '/remote-env',
    label: '/remote-env',
    description: 'Configure remote environment for teleport',
    type: 'command',
    aliases: ['remote', 'teleport'],
    priority: 56
  },
  {
    value: '/resume ',
    label: '/resume',
    description: 'Resume a previous session',
    type: 'command',
    aliases: ['r'],
    priority: 13
  },
  {
    value: '/review ',
    label: '/review',
    description: 'Request a code review',
    type: 'command',
    aliases: ['code-review', 'cr'],
    priority: 16
  },
  {
    value: '/rewind ',
    label: '/rewind',
    description: 'Rewind conversation to a previous state',
    type: 'command',
    priority: 21
  },
  {
    value: '/security-review ',
    label: '/security-review',
    description: 'Run a security review on code',
    type: 'command',
    aliases: ['security', 'sec'],
    priority: 17
  },
  {
    value: '/skills',
    label: '/skills',
    description: 'List available skills',
    type: 'command',
    priority: 31
  },
  {
    value: '/stats',
    label: '/stats',
    description: 'Show your Claude Code usage statistics',
    type: 'command',
    priority: 15
  },
  {
    value: '/status',
    label: '/status',
    description: 'Show current session status',
    type: 'command',
    priority: 14
  },
  {
    value: '/stickers ',
    label: '/stickers',
    description: 'Fun stickers and reactions',
    type: 'command',
    priority: 50
  },
  {
    value: '/tasks',
    label: '/tasks',
    description: 'Show running background tasks',
    type: 'command',
    priority: 23
  },
  {
    value: '/terminal-setup',
    label: '/terminal-setup',
    description: 'Terminal setup instructions',
    type: 'command',
    priority: 39
  },
  {
    value: '/theme ',
    label: '/theme',
    description: 'Change color theme',
    type: 'command',
    priority: 41
  },
  {
    value: '/tag ',
    label: '/tag',
    description: 'Add, remove, or list session tags',
    type: 'command',
    aliases: ['tags'],
    priority: 42
  },
  {
    value: '/think-back',
    label: '/think-back',
    description: 'Your Claude Code Year in Review',
    type: 'command',
    aliases: ['thinkback', 'year-review'],
    priority: 48
  },
  {
    value: '/thinkback-play',
    label: '/thinkback-play',
    description: 'Play the thinkback animation',
    type: 'command',
    priority: 49
  },
  {
    value: '/todos ',
    label: '/todos',
    description: 'Show or manage the current todo list',
    type: 'command',
    aliases: ['todo'],
    priority: 6
  },
  {
    value: '/upgrade',
    label: '/upgrade',
    description: 'Upgrade Claude Code to latest version',
    type: 'command',
    priority: 57
  },
  {
    value: '/usage',
    label: '/usage',
    description: 'Show usage statistics',
    type: 'command',
    priority: 34
  },
  {
    value: '/version',
    label: '/version',
    description: 'Show version information',
    type: 'command',
    aliases: ['v'],
    priority: 4
  },
  {
    value: '/vim',
    label: '/vim',
    description: 'Toggle vim keybindings',
    type: 'command',
    priority: 37
  },
];

/**
 * 从 skill 注册表动态获取 user-invocable skills 作为补全项
 */
function getSkillCompletionItems(): CompletionItem[] {
  try {
    const skills = getAllSkills();
    const builtinNames = new Set(ALL_COMMANDS.map(c => c.label.replace(/^\//, '').toLowerCase()));

    return skills
      .filter(s => s.userInvocable !== false)
      .filter(s => !builtinNames.has(s.skillName.toLowerCase()))
      .map(s => ({
        value: `/${s.skillName} `,
        label: `/${s.skillName}`,
        description: s.description || `Skill: ${s.skillName}`,
        type: 'command' as const,
        priority: 60, // skills 排在内置命令之后
      }));
  } catch {
    return [];
  }
}

/**
 * 获取命令补全建议
 * v2.1.14: 修复输入相似命令时选择错误 (如 /context vs /compact)
 * @param query 查询文本 (不含前导斜杠)
 * @param maxResults 最大返回数量
 */
export function getCommandCompletions(query: string, maxResults: number = 10): CompletionItem[] {
  const lowerQuery = query.toLowerCase();
  const allCommands = [...ALL_COMMANDS, ...getSkillCompletionItems()];

  if (!lowerQuery) {
    // 无查询时返回最常用的命令
    return allCommands.slice()
      .sort((a, b) => (a.priority || 100) - (b.priority || 100))
      .slice(0, maxResults);
  }

  // v2.1.14 修复：将匹配分为精确匹配和前缀匹配
  const exactMatches: CompletionItem[] = [];
  const prefixMatches: CompletionItem[] = [];

  allCommands.forEach(cmd => {
    // 移除前导斜杠进行匹配
    const cmdName = cmd.label.replace(/^\//, '').toLowerCase();

    // 检查精确匹配（完全相同）
    if (cmdName === lowerQuery) {
      exactMatches.push(cmd);
      return;
    }

    // 检查别名精确匹配
    const exactAliasMatch = cmd.aliases?.some(alias =>
      alias.toLowerCase() === lowerQuery
    );
    if (exactAliasMatch) {
      exactMatches.push(cmd);
      return;
    }

    // 检查命令名称前缀匹配
    const matchesName = cmdName.startsWith(lowerQuery);

    // 检查别名前缀匹配
    const matchesAlias = cmd.aliases?.some(alias =>
      alias.toLowerCase().startsWith(lowerQuery)
    ) || false;

    if (matchesName || matchesAlias) {
      prefixMatches.push(cmd);
    }
  });

  // v2.1.14: 精确匹配优先，然后是前缀匹配
  const allMatches = [...exactMatches, ...prefixMatches];

  // 按优先级排序并返回
  return allMatches
    .sort((a, b) => (a.priority || 100) - (b.priority || 100))
    .slice(0, maxResults);
}

/**
 * 检查文本是否正在输入命令
 * @param text 输入文本
 * @param cursorPosition 光标位置
 */
export function isTypingCommand(text: string, cursorPosition: number): boolean {
  // 检查是否以斜杠开头
  if (!text.startsWith('/')) {
    return false;
  }

  // 检查光标是否在命令部分
  const beforeCursor = text.slice(0, cursorPosition);
  const firstSpace = text.indexOf(' ');

  // 如果还没有空格，或者光标在第一个空格之前，说明正在输入命令
  return firstSpace === -1 || cursorPosition <= firstSpace;
}

/**
 * 提取命令查询文本
 * @param text 输入文本
 * @param cursorPosition 光标位置
 */
export function extractCommandQuery(text: string, cursorPosition: number): string {
  if (!isTypingCommand(text, cursorPosition)) {
    return '';
  }

  const beforeCursor = text.slice(0, cursorPosition);
  const query = beforeCursor.slice(1); // 移除前导斜杠

  return query;
}
