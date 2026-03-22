/**
 * Agent 笔记本系统
 *
 * 设计哲学：把 agent 当人看，给它一个自管理的笔记本。
 * agent 自己决定记什么、怎么组织、什么时候更新。
 *
 * 三个笔记本，三个生命周期：
 * - profile.md:    用户个人档案（姓名、角色、联系方式、偏好）~2K tokens
 * - experience.md: 跨项目经验（工作模式、教训、反模式）~4K tokens
 * - project.md:    项目知识（AXON.md 没覆盖的、agent 自己发现的）~8K tokens
 *
 * 当前会话的上下文由对话本身 + TodoWrite + Session Memory 负责，不需要额外笔记本。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { estimateTokens } from '../utils/token-estimate.js';

// ============================================================================
// 常量
// ============================================================================

/** 各笔记本的 token 预算 */
const MAX_TOKENS: Record<NotebookType, number> = {
  profile: 2000,
  experience: 4000,
  project: 8000,
  identity: 2000,
  'tools-notes': 2000,
};

// ============================================================================
// 类型
// ============================================================================

export type NotebookType = 'profile' | 'experience' | 'project' | 'identity' | 'tools-notes';

export interface NotebookWriteResult {
  success: boolean;
  error?: string;
  tokens: number;
  path: string;
}

export interface NotebookStats {
  profile: { tokens: number; exists: boolean; path: string };
  experience: { tokens: number; exists: boolean; path: string };
  project: { tokens: number; exists: boolean; path: string };
  identity: { tokens: number; exists: boolean; path: string };
  'tools-notes': { tokens: number; exists: boolean; path: string };
  totalTokens: number;
}

// ============================================================================
// 工具函数
// ============================================================================

/** 获取用户级 .axon 目录 */
function getUserAxonDir(): string {
  return path.join(os.homedir(), '.axon');
}

/**
 * 获取 notebook 存储根目录。
 * Notebook 是长期记忆，不应因为项目级 .axon 配置目录而分叉。
 */
function getNotebookStorageDir(projectPath?: string): string {
  const configuredDir = process.env.AXON_CONFIG_DIR;
  if (!configuredDir) {
    return getUserAxonDir();
  }

  if (projectPath) {
    const normalizedConfigured = path.resolve(configuredDir);
    const normalizedProjectAxonDir = path.resolve(path.join(projectPath, '.axon'));
    if (normalizedConfigured === normalizedProjectAxonDir) {
      return getUserAxonDir();
    }
  }

  return configuredDir;
}

/** 将项目路径转为安全的目录名 */
function sanitizeProjectPath(projectPath: string): string {
  const hash = crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
  const projectName = path.basename(projectPath)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  return `${projectName}-${hash}`;
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface ProfileSectionDefinition {
  title: string;
  aliases: RegExp[];
}

type ProfileMetadataKey = 'updated' | 'evidence';

interface ParsedProfileEntry {
  signal: string;
  updated?: string;
  evidence?: string;
  extras: string[];
  topicKey: string | null;
  correction: boolean;
  order: number;
}

const PROFILE_SECTION_DEFINITIONS: ProfileSectionDefinition[] = [
  {
    title: 'Basic Info',
    aliases: [/^basic info$/i, /^stable facts$/i, /^identity$/i, /^background$/i, /^基本信息$/, /^个人信息$/],
  },
  {
    title: 'Stable Preferences',
    aliases: [/^stable preferences$/i, /^preferences$/i, /^长期偏好$/i, /^偏好$/i],
  },
  {
    title: 'Communication Style',
    aliases: [/^communication style$/i, /^communication preferences$/i, /^tone.*style$/i, /^沟通风格$/, /^表达风格$/],
  },
  {
    title: 'Working Style',
    aliases: [/^working style$/i, /^working preferences$/i, /^collaboration style$/i, /^工作风格$/, /^协作方式$/],
  },
  {
    title: 'Decision Signals',
    aliases: [/^decision signals$/i, /^friction signals$/i, /^triggers$/i, /^雷区$/, /^信号$/, /^决策信号$/],
  },
  {
    title: 'Values & Motivations',
    aliases: [/^values\s*&\s*motivations$/i, /^long-term goals.*values$/i, /^values$/i, /^goals$/i, /^价值观与动机$/, /^长期目标与价值$/],
  },
  {
    title: 'Do Not Assume / Open Questions',
    aliases: [/^do not assume\s*\/\s*open questions$/i, /^open questions$/i, /^unknowns$/i, /^uncertainties$/i, /^待确认事项$/, /^不要假设 \/ 待确认$/],
  },
];

const PROFILE_SECTION_ORDER = PROFILE_SECTION_DEFINITIONS.map((section) => section.title);
const PROFILE_ADDITIONAL_NOTES = 'Additional Notes';

function buildDefaultProfileTemplate(): string {
  return [
    '# User Profile',
    '',
    '## Basic Info',
    '- Language preference: (auto-detected)',
    '',
    '## Stable Preferences',
    '',
    '## Communication Style',
    '',
    '## Working Style',
    '',
    '## Decision Signals',
    '',
    '## Values & Motivations',
    '',
    '## Do Not Assume / Open Questions',
  ].join('\n');
}

function canonicalizeProfileSectionTitle(rawTitle: string): string | null {
  const normalizedTitle = rawTitle.trim();
  if (!normalizedTitle) return null;

  for (const section of PROFILE_SECTION_DEFINITIONS) {
    if (section.aliases.some((alias) => alias.test(normalizedTitle))) {
      return section.title;
    }
  }

  if (/additional notes/i.test(normalizedTitle) || /补充说明|附加说明/.test(normalizedTitle)) {
    return PROFILE_ADDITIONAL_NOTES;
  }

  return null;
}

function parseProfileMetadataKey(rawKey: string): ProfileMetadataKey | null {
  const normalized = rawKey.trim().toLowerCase();

  if (
    normalized === 'updated'
    || normalized === 'last updated'
    || normalized === 'update'
    || normalized === 'date'
    || normalized === '更新时间'
    || normalized === '更新'
    || normalized === '日期'
  ) {
    return 'updated';
  }

  if (
    normalized === 'evidence'
    || normalized === 'source'
    || normalized === 'proof'
    || normalized === 'reason'
    || normalized === '依据'
    || normalized === '证据'
    || normalized === '来源'
    || normalized === '理由'
  ) {
    return 'evidence';
  }

  return null;
}

function parseProfileMetadataLine(rawLine: string): { key: ProfileMetadataKey | 'extra'; value: string } | null {
  const trimmed = rawLine.trim().replace(/^[-*]\s*/, '');
  const match = trimmed.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
  if (!match) {
    return null;
  }

  const key = parseProfileMetadataKey(match[1]);
  const value = match[2].trim();
  if (!value) {
    return null;
  }

  if (key) {
    return { key, value };
  }

  return {
    key: 'extra',
    value: `${match[1].trim()}: ${value}`,
  };
}

function parseInlineProfileMetadata(rawText: string): {
  signal: string;
  updated?: string;
  evidence?: string;
  extras: string[];
} {
  const extras: string[] = [];
  let updated: string | undefined;
  let evidence: string | undefined;
  let signal = rawText.trim();

  const inlineMatch = signal.match(/\s+\[([^\]]+)\]\s*$/);
  if (!inlineMatch || inlineMatch.index === undefined) {
    return { signal, updated, evidence, extras };
  }

  const metadataText = inlineMatch[1].trim();
  const parts = metadataText
    .split(/[;；]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  let parsedCount = 0;
  for (const part of parts) {
    const parsed = parseProfileMetadataLine(part);
    if (!parsed) {
      continue;
    }

    parsedCount += 1;
    if (parsed.key === 'updated') {
      updated = parsed.value;
    } else if (parsed.key === 'evidence') {
      evidence = parsed.value;
    } else {
      extras.push(parsed.value);
    }
  }

  if (parsedCount === 0) {
    return { signal, updated, evidence, extras };
  }

  signal = signal.slice(0, inlineMatch.index).trim();
  return { signal, updated, evidence, extras };
}

function normalizeProfileSignalForRender(signal: string): string {
  return signal
    .replace(/\s+/g, ' ')
    .replace(/[ \t]+$/g, '')
    .trim();
}

function normalizeProfileComparisonText(signal: string): string {
  return signal
    .toLowerCase()
    .replace(/\b(the user|user|they|them)\b/g, ' ')
    .replace(/\b(prefers?|likes?|wants?|needs?|values?|cares about|dislikes?|hates?|avoids?|gets frustrated when)\b/g, ' ')
    .replace(/喜欢|偏好|更喜欢|希望|想要|需要|重视|在乎|讨厌|反感|避免|最烦|用户|对方/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeProfileExtras(extras: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const extra of extras) {
    const normalized = extra.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function isExplicitProfileCorrection(signal: string): boolean {
  return (
    /\b(no longer|instead|rather than|not .* but|wrong|corrected?|actually|do not|does not|don't|doesn't)\b/i.test(signal)
    || /不是|不再|而不是|别再|不要|并非|纠正|改成|其实|不是想要|不想要/.test(signal)
  );
}

function inferProfileTopicKey(signal: string): string | null {
  const normalized = normalizeProfileComparisonText(signal);
  if (!normalized) {
    return null;
  }

  const fieldMatch = signal.match(/^([^:：]{2,40})[:：]\s*.+$/);
  if (fieldMatch) {
    const fieldKey = normalizeProfileComparisonText(fieldMatch[1]);
    if (fieldKey) {
      return `field:${fieldKey}`;
    }
  }

  const topicPatterns: Array<{ key: string; patterns: RegExp[] }> = [
    { key: 'language', patterns: [/\blanguage\b/i, /中文|英文|双语|语言/] },
    { key: 'name', patterns: [/\bname\b/i, /名字|姓名|我叫/] },
    { key: 'role', patterns: [/\brole\b|\btitle\b|\bjob\b|\bbackground\b/i, /角色|职位|身份|背景|工程师|产品经理|创始人/] },
    { key: 'timezone', patterns: [/\btimezone\b/i, /时区/] },
    { key: 'verbosity', patterns: [/\bconcise\b|\bbrief\b|\bshort\b|\blong-winded\b|\bverbose\b|\bdetailed\b|\blengthy\b|\bexplanations?\b/i, /简洁|简短|啰嗦|冗长|别太长|长篇|详细|展开讲/] },
    { key: 'tone', patterns: [/\bdirect\b|\bcorporate\b|\btone\b|\bwording\b|\bpolite\b|\bblunt\b/i, /直接|官腔|语气|措辞|表达风格|说话方式/] },
    { key: 'corrections', patterns: [/\bcorrection\b|\bremember\b|\bforgotten\b/i, /纠正|记住|忘记|反复纠正/] },
    { key: 'proactivity', patterns: [/\bproactive\b|\binitiative\b/i, /主动|前置|提前|预判/] },
    { key: 'testing', patterns: [/\btests?\b|\btesting\b/i, /测试|提测|回归/] },
    { key: 'planning', patterns: [/\bplanning?\b|\bplan\b/i, /计划|方案|先.*后.*/] },
    { key: 'collaboration', patterns: [/\bcollaborat/i, /协作|合作|同伴|搭子/] },
    { key: 'scope', patterns: [/\bportrait\b|\bappearance\b|\bpersonality\b/i, /画像|长相|性格|特点/] },
    { key: 'values', patterns: [/\bvalue\b|\bmotivation\b|\bgoal\b|\bprinciple\b/i, /价值|动机|目标|原则|在乎|重视/] },
  ];

  for (const topic of topicPatterns) {
    if (topic.patterns.some((pattern) => pattern.test(signal) || pattern.test(normalized))) {
      return topic.key;
    }
  }

  return null;
}

function isSingleValueProfileTopic(topicKey: string | null): boolean {
  if (!topicKey) {
    return false;
  }

  return topicKey.startsWith('field:')
    || topicKey === 'language'
    || topicKey === 'name'
    || topicKey === 'role'
    || topicKey === 'timezone'
    || topicKey === 'scope';
}

function countProfileEntryMetadata(entry: ParsedProfileEntry): number {
  return (entry.updated ? 1 : 0) + (entry.evidence ? 1 : 0) + entry.extras.length;
}

function compareProfileDates(left?: string, right?: string): number {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return left.localeCompare(right);
  }

  if (leftTime === rightTime) {
    return 0;
  }

  return leftTime > rightTime ? 1 : -1;
}

function choosePreferredProfileEntry(left: ParsedProfileEntry, right: ParsedProfileEntry): ParsedProfileEntry {
  const dateCompare = compareProfileDates(left.updated, right.updated);
  if (dateCompare !== 0) {
    return dateCompare > 0 ? left : right;
  }

  if (left.correction !== right.correction) {
    return left.correction ? left : right;
  }

  const metadataDelta = countProfileEntryMetadata(left) - countProfileEntryMetadata(right);
  if (metadataDelta !== 0) {
    return metadataDelta > 0 ? left : right;
  }

  if (left.signal.length !== right.signal.length) {
    return left.signal.length > right.signal.length ? left : right;
  }

  return left.order >= right.order ? left : right;
}

function areProfileSignalsSimilar(left: ParsedProfileEntry, right: ParsedProfileEntry): boolean {
  const leftText = normalizeProfileComparisonText(left.signal);
  const rightText = normalizeProfileComparisonText(right.signal);

  if (!leftText || !rightText) {
    return false;
  }

  if (leftText === rightText) {
    return true;
  }

  if (leftText.length >= 6 && rightText.includes(leftText)) {
    return true;
  }

  if (rightText.length >= 6 && leftText.includes(rightText)) {
    return true;
  }

  if (left.topicKey && left.topicKey === right.topicKey) {
    const leftWords = new Set(leftText.split(' ').filter(Boolean));
    const rightWords = new Set(rightText.split(' ').filter(Boolean));
    if (leftWords.size > 0 && rightWords.size > 0) {
      const overlap = [...leftWords].filter((word) => rightWords.has(word)).length;
      const ratio = overlap / Math.min(leftWords.size, rightWords.size);
      if (ratio >= 0.6) {
        return true;
      }
    }
  }

  return false;
}

function mergeProfileEntries(left: ParsedProfileEntry, right: ParsedProfileEntry): ParsedProfileEntry {
  const preferred = choosePreferredProfileEntry(left, right);
  const fallback = preferred === left ? right : left;

  return {
    signal: preferred.signal,
    updated: compareProfileDates(left.updated, right.updated) >= 0 ? left.updated ?? right.updated : right.updated ?? left.updated,
    evidence: preferred.evidence ?? fallback.evidence,
    extras: dedupeProfileExtras([...left.extras, ...right.extras]),
    topicKey: preferred.topicKey ?? fallback.topicKey,
    correction: left.correction || right.correction,
    order: Math.max(left.order, right.order),
  };
}

function renderProfileEntry(entry: ParsedProfileEntry): string {
  const metadataParts: string[] = [];

  if (entry.updated) {
    metadataParts.push(`updated: ${entry.updated}`);
  }

  if (entry.evidence) {
    metadataParts.push(`evidence: ${entry.evidence}`);
  }

  metadataParts.push(...dedupeProfileExtras(entry.extras));

  return metadataParts.length > 0
    ? `- ${entry.signal} [${metadataParts.join('; ')}]`
    : `- ${entry.signal}`;
}

function parseProfileEntryBlock(blockLines: string[], order: number): ParsedProfileEntry | null {
  if (blockLines.length === 0) {
    return null;
  }

  const [firstLine, ...restLines] = blockLines;
  const firstText = firstLine.trim().replace(/^[-*]\s*/, '');
  const inlineParsed = parseInlineProfileMetadata(firstText);

  const signalParts = [inlineParsed.signal];
  let updated = inlineParsed.updated;
  let evidence = inlineParsed.evidence;
  const extras = [...inlineParsed.extras];

  for (const rawLine of restLines) {
    const metadata = parseProfileMetadataLine(rawLine);
    if (metadata) {
      if (metadata.key === 'updated') {
        updated = metadata.value;
      } else if (metadata.key === 'evidence') {
        evidence = metadata.value;
      } else {
        extras.push(metadata.value);
      }
      continue;
    }

    const continuation = rawLine.trim();
    if (continuation) {
      signalParts.push(continuation);
    }
  }

  const signal = normalizeProfileSignalForRender(signalParts.join(' '));
  if (!signal) {
    return null;
  }

  return {
    signal,
    updated,
    evidence,
    extras: dedupeProfileExtras(extras),
    topicKey: inferProfileTopicKey(signal),
    correction: isExplicitProfileCorrection(signal),
    order,
  };
}

function parseProfileSectionEntries(lines: string[]): ParsedProfileEntry[] {
  const entries: ParsedProfileEntry[] = [];
  let currentBlock: string[] = [];
  let order = 0;

  const flush = () => {
    const entry = parseProfileEntryBlock(currentBlock, order++);
    if (entry) {
      entries.push(entry);
    }
    currentBlock = [];
  };

  for (const rawLine of lines) {
    if (rawLine.trim() === '') {
      flush();
      continue;
    }

    if (/^[-*]\s+/.test(rawLine)) {
      flush();
      currentBlock = [rawLine];
      continue;
    }

    if (currentBlock.length === 0) {
      currentBlock = [`- ${rawLine.trim()}`];
    } else {
      currentBlock.push(rawLine);
    }
  }

  flush();
  return entries;
}

function normalizeProfileSectionEntries(lines: string[]): ParsedProfileEntry[] {
  const parsedEntries = parseProfileSectionEntries(lines);
  const mergedEntries: ParsedProfileEntry[] = [];

  for (const entry of parsedEntries) {
    const existingIndex = mergedEntries.findIndex((existing) => {
      if (normalizeProfileComparisonText(existing.signal) === normalizeProfileComparisonText(entry.signal)) {
        return true;
      }

      if (existing.topicKey && entry.topicKey && existing.topicKey === entry.topicKey) {
        return areProfileSignalsSimilar(existing, entry)
          || isSingleValueProfileTopic(entry.topicKey)
          || existing.correction
          || entry.correction;
      }

      return false;
    });

    if (existingIndex >= 0) {
      mergedEntries[existingIndex] = mergeProfileEntries(mergedEntries[existingIndex], entry);
      continue;
    }

    mergedEntries.push(entry);
  }

  return mergedEntries;
}

function stripInlineProfileMetadata(line: string): string {
  return parseInlineProfileMetadata(line).signal;
}

function routeLooseProfileLine(line: string): string {
  const normalized = stripInlineProfileMetadata(line.trim().replace(/^[-*]\s*/, ''));
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return 'Stable Preferences';
  }

  if (
    /language|name|role|title|background|location|timezone|pronouns?|company/i.test(normalized)
    || /我叫|我是|身份|角色|语言|地区|时区/.test(normalized)
  ) {
    return 'Basic Info';
  }

  if (
    /communication|tone|wording|concise|verbosity|direct|polite|blunt|reply style/i.test(lower)
    || /沟通|语气|措辞|表达|官腔|简洁|直接|啰嗦|回复风格/.test(normalized)
  ) {
    return 'Communication Style';
  }

  if (
    /workflow|working|collaboration|review|iterate|testing|tests|commit|planning/i.test(lower)
    || /工作流|协作|反馈|迭代|测试|提测|先.*后.*|改动方式/.test(normalized)
  ) {
    return 'Working Style';
  }

  if (
    /hate|dislike|annoy|frustrat|trigger|cannot stand|avoid/i.test(lower)
    || /最烦|讨厌|反感|不满|踩雷|不能接受|很在意/.test(normalized)
  ) {
    return 'Decision Signals';
  }

  if (
    /goal|value|motivation|principle|care about|optimizing for/i.test(lower)
    || /目标|价值|动机|原则|在乎|重视/.test(normalized)
  ) {
    return 'Values & Motivations';
  }

  return 'Stable Preferences';
}

function tidySectionLines(lines: string[]): string[] {
  const trimmed = [...lines];

  while (trimmed.length > 0 && trimmed[0].trim() === '') {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
    trimmed.pop();
  }

  const result: string[] = [];
  let previousWasBlank = false;

  for (const line of trimmed) {
    const sanitized = line.replace(/[ \t]+$/g, '');
    const isBlank = sanitized.trim() === '';
    if (isBlank && previousWasBlank) {
      continue;
    }
    result.push(isBlank ? '' : sanitized);
    previousWasBlank = isBlank;
  }

  return result;
}

function normalizeProfileNotebook(content: string): string {
  const normalizedContent = content.replace(/\r\n/g, '\n').trim();
  if (!normalizedContent) {
    return buildDefaultProfileTemplate();
  }

  const sectionMap = new Map<string, string[]>();
  for (const title of PROFILE_SECTION_ORDER) {
    sectionMap.set(title, []);
  }
  sectionMap.set(PROFILE_ADDITIONAL_NOTES, []);

  let currentSection: string | null = null;

  for (const line of normalizedContent.split('\n')) {
    const trimmedLine = line.trim();

    if (/^#\s+/.test(trimmedLine)) {
      continue;
    }

    const sectionMatch = trimmedLine.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      currentSection = canonicalizeProfileSectionTitle(sectionMatch[1]) ?? PROFILE_ADDITIONAL_NOTES;
      continue;
    }

    if (!trimmedLine && currentSection === null) {
      continue;
    }

    const targetSection = currentSection ?? routeLooseProfileLine(line);
    const bucket = sectionMap.get(targetSection) ?? [];
    bucket.push(line);
    sectionMap.set(targetSection, bucket);
  }

  const output: string[] = ['# User Profile', ''];
  const normalizedSections = new Map<string, ParsedProfileEntry[]>();

  for (const title of PROFILE_SECTION_ORDER) {
    normalizedSections.set(title, normalizeProfileSectionEntries(sectionMap.get(title) ?? []));
  }

  const resolvedTopics = new Set<string>();
  for (const title of PROFILE_SECTION_ORDER) {
    if (title === 'Do Not Assume / Open Questions') {
      continue;
    }

    for (const entry of normalizedSections.get(title) ?? []) {
      if (entry.topicKey) {
        resolvedTopics.add(entry.topicKey);
      }
    }
  }

  const openQuestions = normalizedSections.get('Do Not Assume / Open Questions') ?? [];
  normalizedSections.set(
    'Do Not Assume / Open Questions',
    openQuestions.filter((entry) => !entry.topicKey || !resolvedTopics.has(entry.topicKey)),
  );

  for (const title of PROFILE_SECTION_ORDER) {
    output.push(`## ${title}`);
    const sectionLines = (normalizedSections.get(title) ?? []).map((entry) => renderProfileEntry(entry));
    if (sectionLines.length > 0) {
      output.push(...sectionLines);
    }
    output.push('');
  }

  const additionalNotes = tidySectionLines(sectionMap.get(PROFILE_ADDITIONAL_NOTES) ?? []);
  if (additionalNotes.length > 0) {
    output.push(`## ${PROFILE_ADDITIONAL_NOTES}`);
    output.push(...additionalNotes);
    output.push('');
  }

  return output.join('\n').trim();
}

function normalizeNotebookContent(type: NotebookType, content: string): string {
  if (type === 'profile') {
    return normalizeProfileNotebook(content);
  }
  return content;
}

// ============================================================================
// Default Templates
// ============================================================================

/** Default experience notebook — universal AI behavior guidelines */
const DEFAULT_EXPERIENCE = `# Experience Notebook

## Working Principles
- Important information must be written to Notebook immediately. Not writing = guaranteed to forget next time.
- Three means to correct flaws: AXON.md hard rules, Notebook persistent memory, Hooks automated checks.

## Anti-Patterns
- Don't say "I'll improve through self-discipline" — empty promise
- Don't say "You have a good point, but..." — people-pleasing
- Don't "optimize while I'm at it" — over-engineering
- Don't guess implementations — the biggest time waste
- Don't claim "monitoring" when you actually aren't — background tasks don't survive restarts
- Confirm the environment before acting — env vars, whether daemon is running, whether features are actually enabled
- MCP must be disabled immediately after use — enable → use → disable is atomic
- Don't passively report options — proactively use AskUserQuestion
- Don't treat tools as black boxes — when tools are insufficient, don't give up or ask users to do it manually

## Task Execution Discipline
- When user says "start" = start everything, not do one step and report back
- Large tasks must: list complete checklist → Task parallel dispatch → ScheduleTask for continuous tasks
- Test: Can the task continue after the user leaves? If not = you didn't use tools well

## Tool Priority When Capabilities Are Insufficient
1. Check installed Skills
2. Search community Skills/MCP — use \`tool-discovery\` or \`skill-hub\`
3. Search the internet — \`web_search\` for GitHub open source MCP servers
4. Modify source code as last resort — SelfEvolve is the most expensive option

## Self-Evolution Principles
- Flow: Check Skills → Search community → Search internet → Modify source → SelfEvolve
- Three persistence methods: experience.md (short-term) + AXON.md (system) + source improvement (capability)

## Key Lessons
- SelfEvolve restart kills all background Bash tasks
- Basic sensing capabilities should not be guarded by feature flags
`;

/** Default profile notebook — structured user model */
const DEFAULT_PROFILE = buildDefaultProfileTemplate();

// ============================================================================
// NotebookManager
// ============================================================================

export class NotebookManager {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  // --------------------------------------------------------------------------
  // 路径管理
  // --------------------------------------------------------------------------

  /** 获取笔记本文件路径 */
  getPath(type: NotebookType): string {
    const storageDir = getNotebookStorageDir(this.projectPath);
    const projectDir = path.join(storageDir, 'memory', 'projects', sanitizeProjectPath(this.projectPath));

    switch (type) {
      case 'profile':
        return path.join(storageDir, 'memory', 'profile.md');
      case 'experience':
        return path.join(storageDir, 'memory', 'experience.md');
      case 'project':
        return path.join(projectDir, 'project.md');
      case 'identity':
        return path.join(storageDir, 'memory', 'identity.md');
      case 'tools-notes':
        return path.join(storageDir, 'memory', 'tools-notes.md');
    }
  }

  /** 获取旧的项目级 .axon notebook 路径（用于迁移历史数据） */
  private getLegacyProjectLocalPath(type: NotebookType): string {
    const legacyRoot = path.join(this.projectPath, '.axon');
    const legacyProjectDir = path.join(legacyRoot, 'memory', 'projects', sanitizeProjectPath(this.projectPath));

    switch (type) {
      case 'profile':
        return path.join(legacyRoot, 'memory', 'profile.md');
      case 'experience':
        return path.join(legacyRoot, 'memory', 'experience.md');
      case 'project':
        return path.join(legacyProjectDir, 'project.md');
      case 'identity':
        return path.join(legacyRoot, 'memory', 'identity.md');
      case 'tools-notes':
        return path.join(legacyRoot, 'memory', 'tools-notes.md');
    }
  }

  /**
   * 迁移旧的项目级 .axon notebook。
   * 仅在目标文件不存在时迁移，避免覆盖已有的用户级 notebook。
   */
  private migrateLegacyProjectLocalNotebook(type: NotebookType): void {
    const targetPath = this.getPath(type);
    const legacyPath = this.getLegacyProjectLocalPath(type);

    if (path.resolve(targetPath) === path.resolve(legacyPath)) {
      return;
    }

    if (fs.existsSync(targetPath) || !fs.existsSync(legacyPath)) {
      return;
    }

    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(legacyPath, targetPath);
  }

  // --------------------------------------------------------------------------
  // 读写操作
  // --------------------------------------------------------------------------

  /** 读取笔记本内容（experience/profile 不存在时自动初始化默认模板） */
  read(type: NotebookType): string {
    const filePath = this.getPath(type);
    try {
      this.migrateLegacyProjectLocalNotebook(type);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const normalized = normalizeNotebookContent(type, content);
        if (normalized !== content) {
          try {
            ensureDir(path.dirname(filePath));
            fs.writeFileSync(filePath, normalized, 'utf-8');
          } catch {
            // 归一化写回失败时，至少返回归一化后的内容给调用方
          }
        }
        return normalized;
      }
      // Auto-initialize: try bundled default-memory/ first, then fallback to hardcoded template
      const defaultContent = this.getBundledOrDefault(type);
      if (defaultContent) {
        const normalizedDefault = normalizeNotebookContent(type, defaultContent);
        try {
          ensureDir(path.dirname(filePath));
          fs.writeFileSync(filePath, normalizedDefault, 'utf-8');
          return normalizedDefault;
        } catch {
          // Non-fatal: return the template content even if file write fails
          return normalizedDefault;
        }
      }
    } catch (error) {
      console.warn(`[Notebook] Failed to read ${type}:`, error);
    }
    return '';
  }

  /**
   * 获取初始化内容：优先从 Electron 打包的 default-memory/ 目录读取，
   * 回退到硬编码默认模板。仅 experience 和 profile 有默认内容。
   */
  private getBundledOrDefault(type: NotebookType): string | null {
    if (type !== 'experience' && type !== 'profile') return null;

    const filename = `${type}.md`;
    // Electron 打包后 cwd = resources/app/，default-memory/ 在其中
    const bundledPath = path.join(process.cwd(), 'default-memory', filename);
    try {
      if (fs.existsSync(bundledPath)) {
        const content = fs.readFileSync(bundledPath, 'utf-8');
        if (content.trim()) return content;
      }
    } catch {
      // Ignore — fallback to hardcoded default
    }

    return type === 'experience' ? DEFAULT_EXPERIENCE
      : type === 'profile' ? DEFAULT_PROFILE
      : null;
  }

  /** 写入笔记本（带 token 预算检查） */
  write(type: NotebookType, content: string): NotebookWriteResult {
    const filePath = this.getPath(type);
    const maxTokens = MAX_TOKENS[type];
    const normalizedContent = normalizeNotebookContent(type, content);
    const tokens = estimateTokens(normalizedContent);

    this.migrateLegacyProjectLocalNotebook(type);

    if (tokens > maxTokens) {
      return {
        success: false,
        error: `Content exceeds ${type} notebook budget (${tokens}/${maxTokens} tokens). Please condense and retry.`,
        tokens,
        path: filePath,
      };
    }

    try {
      ensureDir(path.dirname(filePath));
      // 原子写入：先写临时文件再 rename，防止进程崩溃导致文件损坏
      const tmpPath = filePath + '.tmp';
      fs.writeFileSync(tmpPath, normalizedContent, 'utf-8');
      fs.renameSync(tmpPath, filePath);
      return { success: true, tokens, path: filePath };
    } catch (error) {
      return {
        success: false,
        error: `Write failed: ${error instanceof Error ? error.message : String(error)}`,
        tokens,
        path: filePath,
      };
    }
  }

  // --------------------------------------------------------------------------
  // System Prompt 集成
  // --------------------------------------------------------------------------

  /** 生成用于注入 system prompt 的笔记本摘要 */
  getNotebookSummaryForPrompt(): string {
    const parts: string[] = [];

    const profile = this.read('profile');
    if (profile.trim()) {
      parts.push(`<notebook type="profile" max-tokens="2000">\n${profile.trim()}\n</notebook>`);
    }

    const experience = this.read('experience');
    if (experience.trim()) {
      parts.push(`<notebook type="experience" max-tokens="4000">\n${experience.trim()}\n</notebook>`);
    }

    const project = this.read('project');
    if (project.trim()) {
      parts.push(`<notebook type="project" max-tokens="8000">\n${project.trim()}\n</notebook>`);
    }

    const identity = this.read('identity');
    if (identity.trim()) {
      parts.push(`<ai-identity>\n${identity.trim()}\n</ai-identity>`);
    }

    const toolsNotes = this.read('tools-notes');
    if (toolsNotes.trim()) {
      parts.push(`<tools-notes>\n${toolsNotes.trim()}\n</tools-notes>`);
    }

    if (parts.length === 0) {
      return '';
    }

    return parts.join('\n\n');
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  /** 获取统计信息 */
  getStats(): NotebookStats {
    const types: NotebookType[] = ['profile', 'experience', 'project', 'identity', 'tools-notes'];
    const stats: any = {};
    let totalTokens = 0;

    for (const type of types) {
      const content = this.read(type);
      const tokens = estimateTokens(content);
      totalTokens += tokens;
      stats[type] = {
        tokens,
        exists: content.trim().length > 0,
        path: this.getPath(type),
      };
    }

    stats.totalTokens = totalTokens;
    return stats as NotebookStats;
  }

  /** 获取项目路径 */
  getProjectPath(): string {
    return this.projectPath;
  }
}

// ============================================================================
// 实例管理（支持多项目并发，Web 服务器模式下按 projectPath 隔离）
// ============================================================================

const GLOBAL_KEY = '__claude_notebook_manager__' as const;
const GLOBAL_MAP_KEY = '__claude_notebook_managers__' as const;

/** 获取 managers Map（按 projectPath 索引） */
function getManagersMap(): Map<string, NotebookManager> {
  if (!(globalThis as any)[GLOBAL_MAP_KEY]) {
    (globalThis as any)[GLOBAL_MAP_KEY] = new Map<string, NotebookManager>();
  }
  return (globalThis as any)[GLOBAL_MAP_KEY];
}

/** 规范化路径用于 Map key（统一分隔符和大小写） */
function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').toLowerCase();
}

/** 初始化并获取 NotebookManager 实例（同时设置为当前活跃实例） */
export function initNotebookManager(projectPath: string): NotebookManager {
  const key = normalizeProjectPath(projectPath);
  const map = getManagersMap();

  let manager = map.get(key);
  if (!manager) {
    manager = new NotebookManager(projectPath);
    map.set(key, manager);
  }

  // 设置为当前活跃实例（CLI 单会话模式 + 兼容旧代码）
  (globalThis as any)[GLOBAL_KEY] = manager;
  return manager;
}

/** 获取当前活跃的 NotebookManager 实例 */
export function getNotebookManager(): NotebookManager | null {
  return (globalThis as any)[GLOBAL_KEY] || null;
}

/** 按项目路径获取 NotebookManager（Web 多会话模式下使用） */
export function getNotebookManagerForProject(projectPath: string): NotebookManager | null {
  const key = normalizeProjectPath(projectPath);
  return getManagersMap().get(key) || null;
}

/** 切换活跃 manager 到指定项目（工具执行前调用，确保全局指针正确） */
export function activateNotebookManager(projectPath: string): NotebookManager | null {
  const key = normalizeProjectPath(projectPath);
  const manager = getManagersMap().get(key);
  if (manager) {
    (globalThis as any)[GLOBAL_KEY] = manager;
  }
  return manager || null;
}

/** 重置所有实例 */
export function resetNotebookManager(): void {
  (globalThis as any)[GLOBAL_KEY] = null;
  (globalThis as any)[GLOBAL_MAP_KEY] = null;
}
