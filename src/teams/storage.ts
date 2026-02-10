/**
 * Agent Teams 存储层
 * 管理团队配置、消息收件箱的文件存储
 *
 * 目录结构:
 * ~/.claude/teams/{team-name}/config.json     - 团队配置
 * ~/.claude/teams/{team-name}/mailbox/{agent-name}.json - 消息收件箱
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type {
  TeamConfig,
  TeamMember,
  TeamMessage,
  TeamContext,
} from './types.js';

// ============================================================================
// 路径管理
// ============================================================================

/**
 * 获取 teams 存储根目录
 */
function getTeamsDir(): string {
  return path.join(os.homedir(), '.claude', 'teams');
}

/**
 * 获取指定团队的目录
 */
function getTeamDir(teamName: string): string {
  return path.join(getTeamsDir(), teamName);
}

/**
 * 获取团队配置文件路径
 */
function getTeamConfigPath(teamName: string): string {
  return path.join(getTeamDir(teamName), 'config.json');
}

/**
 * 获取团队收件箱目录
 */
function getMailboxDir(teamName: string): string {
  return path.join(getTeamDir(teamName), 'mailbox');
}

/**
 * 获取某个 agent 的收件箱文件路径
 */
function getMailboxPath(teamName: string, agentName: string): string {
  return path.join(getMailboxDir(teamName), `${agentName}.json`);
}

// ============================================================================
// 随机团队名称生成（官方 adjective-noun-noun 格式）
// ============================================================================

const ADJECTIVES = [
  'swift', 'bright', 'calm', 'deft', 'keen',
  'bold', 'warm', 'cool', 'fast', 'wise',
  'sharp', 'clear', 'deep', 'fair', 'firm',
];

const NOUNS = [
  'fox', 'oak', 'owl', 'wolf', 'bear',
  'hawk', 'pine', 'star', 'tide', 'wind',
  'sage', 'fern', 'lake', 'peak', 'reef',
];

function generateTeamId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun1 = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const noun2 = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun1}-${noun2}`;
}

// ============================================================================
// 团队存储操作
// ============================================================================

/**
 * 确保目录存在
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 创建新团队
 */
export function createTeam(input: {
  teamName: string;
  description?: string;
  agentType?: string;
  leadAgentId: string;
  leadSessionId: string;
}): TeamConfig {
  const teamDir = getTeamDir(input.teamName);

  // 检查团队是否已存在
  if (fs.existsSync(teamDir)) {
    throw new Error(`Team "${input.teamName}" already exists`);
  }

  // 创建目录结构
  ensureDir(teamDir);
  ensureDir(getMailboxDir(input.teamName));

  const teamId = generateTeamId();
  const taskListId = `team-${input.teamName}`;

  // 创建 team lead 成员
  const leadMember: TeamMember = {
    name: 'team-lead',
    role: 'lead',
    agentType: input.agentType,
    active: true,
    joinedAt: Date.now(),
    sessionId: input.leadSessionId,
  };

  const config: TeamConfig = {
    name: input.teamName,
    description: input.description,
    teamId,
    leadAgentId: input.leadAgentId,
    leadSessionId: input.leadSessionId,
    members: [leadMember],
    createdAt: Date.now(),
    taskListId,
  };

  // 写入配置文件
  const configPath = getTeamConfigPath(input.teamName);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // 初始化 team-lead 的收件箱
  const leadMailbox = getMailboxPath(input.teamName, 'team-lead');
  fs.writeFileSync(leadMailbox, JSON.stringify([], null, 2));

  return config;
}

/**
 * 获取团队配置
 */
export function getTeam(teamName: string): TeamConfig | null {
  const configPath = getTeamConfigPath(teamName);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as TeamConfig;
  } catch {
    return null;
  }
}

/**
 * 更新团队配置
 */
export function updateTeam(teamName: string, updates: Partial<TeamConfig>): TeamConfig | null {
  const config = getTeam(teamName);
  if (!config) return null;

  const updated = { ...config, ...updates };
  const configPath = getTeamConfigPath(teamName);
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2));

  return updated;
}

/**
 * 删除团队
 */
export function deleteTeam(teamName: string): boolean {
  const teamDir = getTeamDir(teamName);

  if (!fs.existsSync(teamDir)) {
    return false;
  }

  try {
    fs.rmSync(teamDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 列出所有团队
 */
export function listTeams(): string[] {
  const teamsDir = getTeamsDir();
  if (!fs.existsSync(teamsDir)) {
    return [];
  }

  return fs.readdirSync(teamsDir).filter(name => {
    const configPath = getTeamConfigPath(name);
    return fs.existsSync(configPath);
  });
}

/**
 * 添加团队成员
 */
export function addTeamMember(teamName: string, member: TeamMember): boolean {
  const config = getTeam(teamName);
  if (!config) return false;

  // 检查成员是否已存在
  if (config.members.some(m => m.name === member.name)) {
    return false;
  }

  config.members.push(member);
  updateTeam(teamName, { members: config.members });

  // 初始化成员收件箱
  const mailboxPath = getMailboxPath(teamName, member.name);
  if (!fs.existsSync(mailboxPath)) {
    fs.writeFileSync(mailboxPath, JSON.stringify([], null, 2));
  }

  return true;
}

/**
 * 移除团队成员
 */
export function removeTeamMember(teamName: string, memberName: string): boolean {
  const config = getTeam(teamName);
  if (!config) return false;

  config.members = config.members.filter(m => m.name !== memberName);
  updateTeam(teamName, { members: config.members });

  return true;
}

/**
 * 更新成员状态
 */
export function updateMemberStatus(
  teamName: string,
  memberName: string,
  active: boolean,
): boolean {
  const config = getTeam(teamName);
  if (!config) return false;

  const member = config.members.find(m => m.name === memberName);
  if (!member) return false;

  member.active = active;
  updateTeam(teamName, { members: config.members });

  return true;
}

/**
 * 获取活跃成员列表
 */
export function getActiveMembers(teamName: string): TeamMember[] {
  const config = getTeam(teamName);
  if (!config) return [];

  return config.members.filter(m => m.active);
}

// ============================================================================
// 消息收件箱操作
// ============================================================================

/**
 * 向指定 agent 发送消息
 */
export function sendToMailbox(teamName: string, recipientName: string, message: TeamMessage): boolean {
  const mailboxPath = getMailboxPath(teamName, recipientName);
  ensureDir(path.dirname(mailboxPath));

  let messages: TeamMessage[] = [];
  if (fs.existsSync(mailboxPath)) {
    try {
      messages = JSON.parse(fs.readFileSync(mailboxPath, 'utf-8'));
    } catch {
      messages = [];
    }
  }

  messages.push(message);
  fs.writeFileSync(mailboxPath, JSON.stringify(messages, null, 2));

  return true;
}

/**
 * 向团队所有活跃成员广播消息（除了发送者）
 */
export function broadcastToTeam(
  teamName: string,
  senderName: string,
  message: TeamMessage,
): number {
  const config = getTeam(teamName);
  if (!config) return 0;

  let count = 0;
  for (const member of config.members) {
    if (member.name !== senderName && member.active) {
      sendToMailbox(teamName, member.name, message);
      count++;
    }
  }

  return count;
}

/**
 * 读取并清空收件箱
 */
export function readAndClearMailbox(teamName: string, agentName: string): TeamMessage[] {
  const mailboxPath = getMailboxPath(teamName, agentName);

  if (!fs.existsSync(mailboxPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(mailboxPath, 'utf-8');
    const messages = JSON.parse(content) as TeamMessage[];

    // 清空收件箱
    fs.writeFileSync(mailboxPath, JSON.stringify([], null, 2));

    return messages;
  } catch {
    return [];
  }
}

/**
 * 查看收件箱（不清空）
 */
export function peekMailbox(teamName: string, agentName: string): TeamMessage[] {
  const mailboxPath = getMailboxPath(teamName, agentName);

  if (!fs.existsSync(mailboxPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(mailboxPath, 'utf-8');
    return JSON.parse(content) as TeamMessage[];
  } catch {
    return [];
  }
}

// ============================================================================
// 全局团队上下文（运行时状态）
// ============================================================================

let currentTeamContext: TeamContext | null = null;

/**
 * 设置当前团队上下文
 */
export function setTeamContext(context: TeamContext | null): void {
  currentTeamContext = context;
}

/**
 * 获取当前团队上下文
 */
export function getTeamContext(): TeamContext | null {
  return currentTeamContext;
}

/**
 * 检查是否在团队模式中
 */
export function isInTeamMode(): boolean {
  return currentTeamContext !== null;
}

/**
 * 检查 agent teams 功能是否启用
 * 官方 p8() 函数
 */
export function isAgentTeamsEnabled(): boolean {
  // 检查环境变量
  const envValue = process.env.CLAUDE_CODE_ENABLE_AGENT_TEAMS;
  if (envValue) {
    const lower = envValue.toLowerCase().trim();
    return ['1', 'true', 'yes', 'on'].includes(lower);
  }

  // 默认禁用（企业级功能）
  return false;
}

/**
 * 检查是否在 teammate 模式
 * 官方 MH() 函数
 */
export function isTeammateMode(): boolean {
  return currentTeamContext !== null && currentTeamContext.role === 'teammate';
}

/**
 * 生成消息 ID
 */
export function generateMessageId(): string {
  return uuidv4();
}
