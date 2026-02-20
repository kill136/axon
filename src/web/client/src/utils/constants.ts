import type { SlashCommand } from '../types';

// 动态 skill 命令（由后端推送，运行时填充）
let _dynamicSkillCommands: SlashCommand[] = [];

/**
 * 更新后端推送的 skills 列表
 */
export function updateSkillCommands(skills: Array<{ name: string; description: string; argumentHint?: string }>) {
  _dynamicSkillCommands = skills.map(s => ({
    name: `/${s.name}`,
    description: s.description || `Skill: ${s.name}`,
    usage: s.argumentHint ? `/${s.name} ${s.argumentHint}` : undefined,
    category: 'skill' as const,
  }));
}

/**
 * 获取所有斜杠命令（内置 + 动态 skills）
 */
export function getAllSlashCommands(): SlashCommand[] {
  const builtinNames = new Set(SLASH_COMMANDS.map(c => c.name));
  const uniqueSkills = _dynamicSkillCommands.filter(s => !builtinNames.has(s.name));
  return [...SLASH_COMMANDS, ...uniqueSkills];
}

// 斜杠命令列表（仅保留 Web UI 中有真实实现的命令，与后端 slash-commands.ts 对齐）
export const SLASH_COMMANDS: SlashCommand[] = [
  // General
  { name: '/help', description: '显示所有可用命令', usage: '/help [命令名]', category: 'general' },
  { name: '/clear', description: '清除对话历史并释放上下文', aliases: ['/reset', '/new'], category: 'general' },
  { name: '/status', description: '显示系统状态', category: 'general' },

  // Session
  { name: '/compact', description: '压缩对话历史以释放上下文', aliases: ['/c'], category: 'session' },
  { name: '/cost', description: '显示当前会话费用', category: 'session' },
  { name: '/resume', description: '恢复之前的对话', aliases: ['/continue'], category: 'session' },

  // Config
  { name: '/model', description: '查看或切换模型', aliases: ['/m'], category: 'config' },
  { name: '/config', description: '显示当前配置', aliases: ['/settings'], category: 'config' },
  { name: '/mcp', description: '管理 MCP 服务器', category: 'config' },

  // Utility
  { name: '/tasks', description: '管理后台任务', aliases: ['/bashes'], category: 'utility' },
  { name: '/doctor', description: '运行系统诊断', category: 'utility' },

  // Integration
  { name: '/plugin', description: '管理插件', aliases: ['/plugins'], category: 'integration' },

  // Auth
  { name: '/login', description: '登录账户', aliases: ['/auth'], category: 'auth' },
  { name: '/logout', description: '登出账户', category: 'auth' },
];

// 工具名称映射
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Bash: '终端命令',
  BashOutput: '终端输出',
  KillShell: '终止进程',
  Read: '读取文件',
  Write: '写入文件',
  Edit: '编辑文件',
  MultiEdit: '批量编辑',
  Glob: '文件搜索',
  Grep: '内容搜索',
  WebFetch: '网页获取',
  WebSearch: '网页搜索',
  TodoWrite: '任务管理',
  Task: '子任务',
  NotebookEdit: '笔记本编辑',
  AskUserQuestion: '询问用户',
  ScheduleTask: '定时任务',
  TestRunner: '测试运行',
  Database: '数据库',
  REPL: '交互式执行',
  Debugger: '调试器',
};

// 工具图标映射
export const TOOL_ICONS: Record<string, string> = {
  Bash: '💻',
  Read: '📖',
  Write: '✏️',
  Edit: '🔧',
  MultiEdit: '📝',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
  WebSearch: '🔍',
  TodoWrite: '📋',
  Task: '🤖',
  NotebookEdit: '📓',
  AskUserQuestion: '❓',
  ScheduleTask: '⏰',
  TestRunner: '🧪',
  Database: '🗄️',
  REPL: '⚡',
  Debugger: '🐛',
};

// 格式化日期
export function formatDate(timestamp: number | undefined | null): string {
  // 处理无效输入
  if (timestamp === undefined || timestamp === null || isNaN(timestamp)) {
    return '未知时间';
  }

  const date = new Date(timestamp);

  // 检查是否是有效日期
  if (isNaN(date.getTime())) {
    return '未知时间';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
