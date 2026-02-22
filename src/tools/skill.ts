/**
 * Skill 工具 - 完全对齐官网实现
 * 基于官网源码 node_modules/@anthropic-ai/claude-code/cli.js 反编译
 *
 * 2.1.3 修复：ExFAT inode 去重
 * - 使用 64 位精度（BigInt）处理 inode 值
 * - 修复在 ExFAT 等文件系统上 inode 超过 Number.MAX_SAFE_INTEGER 导致的误判
 * - 官网实现：function fo5(A){try{let Q=bo5(A,{bigint:!0});return`${Q.dev}:${Q.ino}`}catch{return null}}
 */

import * as fs from 'fs';
import * as path from 'path';
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import { registerHook, type HookEvent, type HookConfig } from '../hooks/index.js';
import { t } from '../i18n/index.js';

/**
 * v2.1.32: 额外目录列表（由 --add-dir 设置）
 * 用于从额外目录加载 skills
 */
let _additionalDirectories: string[] = [];

/**
 * 设置额外目录列表
 */
export function setAdditionalDirectories(dirs: string[]): void {
  _additionalDirectories = [...dirs];
}

/**
 * 获取额外目录列表
 */
export function getAdditionalDirectories(): string[] {
  return [..._additionalDirectories];
}

/**
 * 获取文件的唯一标识符（基于 inode）- 对齐官网 fo5 函数
 *
 * 官网实现：
 * function fo5(A){try{let Q=bo5(A,{bigint:!0});return`${Q.dev}:${Q.ino}`}catch{return null}}
 *
 * 使用 BigInt 精度来处理大 inode 值（如 ExFAT 文件系统）
 * 返回格式：`${dev}:${ino}` - 设备号:inode号
 * 这样可以唯一标识一个文件，即使通过不同路径（符号链接）访问
 *
 * @param filePath 文件路径
 * @returns 文件唯一标识符，如果获取失败返回 null
 */
function getFileInode(filePath: string): string | null {
  try {
    // 使用 bigint: true 选项获取 64 位精度的 stat 信息
    // 这对于 ExFAT 等文件系统非常重要，因为它们的 inode 可能超过 Number.MAX_SAFE_INTEGER
    const stats = fs.statSync(filePath, { bigint: true });
    // 返回 dev:ino 格式的字符串，确保唯一性
    return `${stats.dev}:${stats.ino}`;
  } catch {
    // 如果无法获取 stat（如文件不存在、权限问题等），返回 null
    return null;
  }
}

/**
 * 解析参数字符串为数组
 * 官方 zk6 函数 - 使用 shell-quote 风格解析
 *
 * 支持:
 * - 空格分隔的参数
 * - 引号包裹的参数 (单引号/双引号)
 * - 转义字符
 */
function parseArgumentsToArray(argsString: string): string[] {
  if (!argsString || !argsString.trim()) {
    return [];
  }

  const result: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escape = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result;
}

/**
 * 替换参数占位符
 * 官方 qDA 函数 - v2.1.19 新增 $N 和 $ARGUMENTS[N] 语法
 *
 * 支持的占位符:
 * - $ARGUMENTS[N] - 第 N 个参数 (0 索引，括号语法)
 * - $N - 第 N 个参数 (0 索引，简写语法，如 $0, $1, $2)
 * - $ARGUMENTS - 完整参数字符串
 *
 * 官方实现:
 * ```javascript
 * function qDA(A, K, q = true, Y = []) {
 *   if (K === undefined || K === null) return A;
 *   let z = zk6(K);  // 解析参数数组
 *   let w = A;       // 保存原始内容
 *
 *   // 1. 替换具名参数 $PARAM_NAME
 *   for (let H = 0; H < Y.length; H++) {
 *     let J = Y[H];
 *     if (!J) continue;
 *     A = A.replace(new RegExp(`\\$${J}(?![\\[\\w])`, "g"), z[H] ?? "");
 *   }
 *
 *   // 2. 替换 $ARGUMENTS[N] 语法
 *   A = A.replace(/\$ARGUMENTS\[(\d+)\]/g, (H, J) => {
 *     let X = parseInt(J, 10);
 *     return z[X] ?? "";
 *   });
 *
 *   // 3. 替换 $N 简写语法
 *   A = A.replace(/\$(\d+)(?!\w)/g, (H, J) => {
 *     let X = parseInt(J, 10);
 *     return z[X] ?? "";
 *   });
 *
 *   // 4. 替换 $ARGUMENTS 为完整参数
 *   A = A.replaceAll("$ARGUMENTS", K);
 *
 *   // 5. 如果没有替换发生且有参数，追加 ARGUMENTS:
 *   if (A === w && q && K) {
 *     A = A + `\n\nARGUMENTS: ${K}`;
 *   }
 *
 *   return A;
 * }
 * ```
 *
 * @param content 原始内容
 * @param argsString 完整参数字符串
 * @param appendIfNoPlaceholder 如果没有占位符是否追加参数
 * @param namedParams 具名参数数组（可选）
 */
function substituteArguments(
  content: string,
  argsString: string | undefined | null,
  appendIfNoPlaceholder: boolean = true,
  namedParams: string[] = []
): string {
  if (argsString === undefined || argsString === null) {
    return content;
  }

  const argsArray = parseArgumentsToArray(argsString);
  const originalContent = content;

  // 1. 替换具名参数 $PARAM_NAME
  for (let i = 0; i < namedParams.length; i++) {
    const paramName = namedParams[i];
    if (!paramName) continue;
    // 使用正则确保 $PARAM 不会匹配 $PARAM_OTHER 或 $PARAM[0]
    content = content.replace(
      new RegExp(`\\$${paramName}(?![\\[\\w])`, 'g'),
      argsArray[i] ?? ''
    );
  }

  // 2. 替换 $ARGUMENTS[N] 语法 (括号语法)
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, index) => {
    const idx = parseInt(index, 10);
    return argsArray[idx] ?? '';
  });

  // 3. 替换 $N 简写语法 (如 $0, $1, $2)
  // 使用负向前瞻确保 $1 不会匹配 $1abc 或 $10 中的部分
  content = content.replace(/\$(\d+)(?!\w)/g, (_, index) => {
    const idx = parseInt(index, 10);
    return argsArray[idx] ?? '';
  });

  // 4. 替换 $ARGUMENTS 为完整参数字符串
  content = content.replaceAll('$ARGUMENTS', argsString);

  // 5. 如果没有任何替换发生，且有参数，追加 ARGUMENTS 部分
  if (content === originalContent && appendIfNoPlaceholder && argsString) {
    content = content + `\n\nARGUMENTS: ${argsString}`;
  }

  return content;
}

// 导出参数替换函数，以便其他模块（如 hooks）使用
export { substituteArguments, parseArgumentsToArray };

interface SkillInput {
  skill: string;
  args?: string;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  'allowed-tools'?: string;
  'argument-hint'?: string;
  'when-to-use'?: string;
  when_to_use?: string;
  version?: string;
  model?: string;
  color?: string;
  /** v2.1.33: agent memory scope (user, project, or local) */
  memory?: string;
  /** v2.1.33: restrict which sub-agents can be spawned via Task(agent_type) syntax */
  tools?: string;
  'user-invocable'?: string;
  'disable-model-invocation'?: string;
  /** v4.3: hooks 配置（JSON 字符串格式），支持在 SKILL.md 中定义 hooks */
  hooks?: string;
  [key: string]: any;
}

/**
 * Skill 来源类型（对齐官网 v2.1.20+）
 * - policySettings: 企业策略配置的 skills
 * - userSettings: 用户级 skills (~/.claude/skills)
 * - projectSettings: 项目级 skills (.claude/skills)
 * - plugin: 插件提供的 skills
 */
type SkillSource = 'policySettings' | 'userSettings' | 'projectSettings' | 'plugin';

/**
 * Skill 定义接口（对齐官网 NE7 函数参数）
 */
interface SkillDefinition {
  skillName: string;
  displayName: string;
  description: string;
  hasUserSpecifiedDescription: boolean;
  markdownContent: string;
  allowedTools?: string[];
  argumentHint?: string;
  argumentNames?: string[];  // v2.1.20+ 具名参数名称数组
  whenToUse?: string;
  version?: string;
  model?: string;
  color?: string;  // v2.1.33: agent color
  memory?: string;  // v2.1.33: agent memory scope (user, project, local)
  disableModelInvocation: boolean;
  userInvocable: boolean;
  source: SkillSource;
  pluginName?: string;  // v2.1.33: plugin name for better discoverability
  baseDir: string;
  filePath: string;
  loadedFrom: 'skills' | 'commands_DEPRECATED';
  hooks?: Record<string, any>;  // v2.1.20+ hooks 配置
  executionContext?: 'fork' | undefined;  // v2.1.20+ 执行上下文
  agent?: string;  // v2.1.20+ 关联的 agent
}

// 全局状态：已调用的 skills（对齐官网 KP0/VP0）
const invokedSkills = new Map<string, {
  skillName: string;
  skillPath: string;
  content: string;
  invokedAt: number;
}>();

// Skill 注册表
const skillRegistry = new Map<string, SkillDefinition>();
let skillsLoaded = false;

/**
 * 记录已调用的 skill（对齐官网 KP0 函数）
 */
function recordInvokedSkill(skillName: string, skillPath: string, content: string): void {
  invokedSkills.set(skillName, {
    skillName,
    skillPath,
    content,
    invokedAt: Date.now(),
  });
}

/**
 * 获取已调用的 skills（对齐官网 VP0 函数）
 */
export function getInvokedSkills(): Map<string, any> {
  return invokedSkills;
}

/**
 * 解析 frontmatter（对齐官网 NV 函数）
 * 官网实现：
 * function NV(A) {
 *   let Q = /^---\s*\n([\s\S]*?)---\s*\n?/;
 *   let B = A.match(Q);
 *   if (!B) return { frontmatter: {}, content: A };
 *   let G = B[1] || "";
 *   let Z = A.slice(B[0].length);
 *   let Y = {};
 *   let J = G.split('\n');
 *   for (let X of J) {
 *     let I = X.indexOf(":");
 *     if (I > 0) {
 *       let W = X.slice(0, I).trim();
 *       let K = X.slice(I + 1).trim();
 *       if (W) {
 *         let V = K.replace(/^["']|["']$/g, "");
 *         Y[W] = V;
 *       }
 *     }
 *   }
 *   return { frontmatter: Y, content: Z };
 * }
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; content: string } {
  const regex = /^---\s*\n([\s\S]*?)---\s*\n?/;
  const match = content.match(regex);

  if (!match) {
    return { frontmatter: {}, content };
  }

  const frontmatterText = match[1] || '';
  const bodyContent = content.slice(match[0].length);
  const frontmatter: SkillFrontmatter = {};

  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) {
        // 移除前后的引号
        const cleanValue = value.replace(/^["']|["']$/g, '');
        frontmatter[key] = cleanValue;
      }
    }
  }

  return { frontmatter, content: bodyContent };
}

/**
 * 解析 allowed-tools 字段
 * 官网支持字符串或数组
 */
function parseAllowedTools(value: string | undefined): string[] | undefined {
  if (!value) return undefined;

  // 如果是逗号分隔的字符串
  if (value.includes(',')) {
    return value.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  // 单个工具
  if (value.trim()) {
    return [value.trim()];
  }

  return undefined;
}

/**
 * 解析布尔值字段
 */
function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  const lower = value.toLowerCase().trim();
  return ['true', '1', 'yes'].includes(lower);
}

/**
 * 构建 Skill 对象（对齐官网 NE7 函数）
 */
function buildSkillDefinition(params: {
  skillName: string;
  displayName?: string;
  description?: string;
  hasUserSpecifiedDescription: boolean;
  markdownContent: string;
  allowedTools?: string[];
  argumentHint?: string;
  argumentNames?: string[];
  whenToUse?: string;
  version?: string;
  model?: string;
  color?: string;
  memory?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  source: SkillSource;
  pluginName?: string;
  baseDir: string;
  filePath: string;
  loadedFrom: 'skills' | 'commands_DEPRECATED';
  hooks?: Record<string, any>;
  executionContext?: 'fork' | undefined;
  agent?: string;
}): SkillDefinition {
  return {
    skillName: params.skillName,
    displayName: params.displayName || params.skillName,
    description: params.description || '',
    hasUserSpecifiedDescription: params.hasUserSpecifiedDescription,
    markdownContent: params.markdownContent,
    allowedTools: params.allowedTools,
    argumentHint: params.argumentHint,
    argumentNames: params.argumentNames,
    whenToUse: params.whenToUse,
    version: params.version,
    model: params.model,
    color: params.color,
    memory: params.memory,
    disableModelInvocation: params.disableModelInvocation,
    userInvocable: params.userInvocable,
    source: params.source,
    pluginName: params.pluginName,
    baseDir: params.baseDir,
    filePath: params.filePath,
    loadedFrom: params.loadedFrom,
    hooks: params.hooks,
    executionContext: params.executionContext,
    agent: params.agent,
  };
}

/**
 * 解析 arguments 字段（对齐官网 yBA 函数）
 * 用于获取具名参数名称数组
 */
function parseArgumentNames(value: string | undefined): string[] | undefined {
  if (!value) return undefined;

  // 支持逗号分隔的参数名
  if (value.includes(',')) {
    return value.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  // 单个参数名
  if (value.trim()) {
    return [value.trim()];
  }

  return undefined;
}

/**
 * 从文件创建 Skill（对齐官网 CPA 函数）
 */
function createSkillFromFile(
  skillName: string,
  fileInfo: {
    filePath: string;
    baseDir: string;
    frontmatter: SkillFrontmatter;
    content: string;
  },
  source: SkillSource,
  isSkillMode: boolean
): SkillDefinition | null {
  const { frontmatter, content, filePath, baseDir } = fileInfo;

  // 解析 frontmatter
  const displayName = frontmatter.name || skillName;
  const description = frontmatter.description || '';
  const allowedTools = parseAllowedTools(frontmatter['allowed-tools']);
  const argumentHint = frontmatter['argument-hint'];
  const argumentNames = parseArgumentNames(frontmatter.arguments);
  const whenToUse = frontmatter['when-to-use'] || frontmatter.when_to_use;
  const version = frontmatter.version;
  const model = frontmatter.model === 'inherit' ? undefined : frontmatter.model;
  const color = frontmatter.color;
  // v2.1.33: memory frontmatter field for persistent memory with user, project, or local scope
  const memory = frontmatter.memory;
  const disableModelInvocation = parseBoolean(frontmatter['disable-model-invocation']);
  const userInvocable = parseBoolean(frontmatter['user-invocable'], true);
  const executionContext = frontmatter.context === 'fork' ? 'fork' as const : undefined;
  const agent = frontmatter.agent;

  // v4.3: 解析 hooks 字段（支持 SKILL.md frontmatter 中定义 hooks）
  // 修复 issue #84: SKILL.md 不支持 hook
  let hooks: Record<string, any> | undefined;

  // 方式 1: frontmatter 中内联定义 hooks（JSON 字符串）
  if (frontmatter.hooks) {
    try {
      hooks = typeof frontmatter.hooks === 'string'
        ? JSON.parse(frontmatter.hooks)
        : frontmatter.hooks;
    } catch (err) {
      console.warn(`[Skill] Failed to parse hooks in frontmatter for skill ${skillName}:`, err);
    }
  }

  // 方式 2: skill 目录下的 hooks.json 文件
  if (!hooks && baseDir) {
    const hooksJsonPath = path.join(baseDir, 'hooks.json');
    if (fs.existsSync(hooksJsonPath)) {
      try {
        const hooksContent = fs.readFileSync(hooksJsonPath, 'utf-8');
        const hooksData = JSON.parse(hooksContent);
        // 支持 { "hooks": { ... } } 或直接 { "PreToolUse": [...] } 格式
        hooks = hooksData.hooks || hooksData;
      } catch (err) {
        console.warn(`[Skill] Failed to load hooks.json for skill ${skillName}:`, err);
      }
    }
  }

  return buildSkillDefinition({
    skillName,
    displayName,
    description,
    hasUserSpecifiedDescription: !!frontmatter.description,
    markdownContent: content,
    allowedTools,
    argumentHint,
    argumentNames,
    whenToUse,
    version,
    model,
    color,
    memory,
    disableModelInvocation,
    userInvocable,
    source,
    baseDir,
    filePath,
    loadedFrom: isSkillMode ? 'skills' : 'commands_DEPRECATED',
    hooks,
    executionContext,
    agent,
  });
}

/**
 * 从目录加载 skills（完全对齐官网 d62 函数）
 *
 * 官网实现逻辑：
 * async function d62(A, Q, B, G, Z, Y) {
 *   let J = jA(), X = [];
 *   try {
 *     if (!J.existsSync(A)) return [];
 *
 *     // 1. 检查根目录的 SKILL.md（单文件模式）
 *     let I = QKA(A, "SKILL.md");
 *     if (J.existsSync(I)) {
 *       // 加载单个 skill，使用目录名作为 skillName
 *       let K = J.readFileSync(I, { encoding: "utf-8" });
 *       let { frontmatter: V, content: H } = NV(K);
 *       let D = `${Q}:${BKA(A)}`;  // namespace:basename
 *       let F = { filePath: I, baseDir: Ko(I), frontmatter: V, content: H };
 *       let E = CPA(D, F, B, G, Z, !0, { isSkillMode: !0 });
 *       if (E) X.push(E);
 *       return X;
 *     }
 *
 *     // 2. 遍历子目录，查找每个子目录下的 SKILL.md
 *     let W = J.readdirSync(A);
 *     for (let K of W) {
 *       if (!K.isDirectory() && !K.isSymbolicLink()) continue;
 *       let V = QKA(A, K.name);
 *       let H = QKA(V, "SKILL.md");
 *       if (J.existsSync(H)) {
 *         let D = J.readFileSync(H, { encoding: "utf-8" });
 *         let { frontmatter: F, content: E } = NV(D);
 *         let z = `${Q}:${K.name}`;  // namespace:dirname
 *         let $ = { filePath: H, baseDir: Ko(H), frontmatter: F, content: E };
 *         let L = CPA(z, $, B, G, Z, !0, { isSkillMode: !0 });
 *         if (L) X.push(L);
 *       }
 *     }
 *   } catch (I) {
 *     console.error(`Failed to load skills from directory ${A}: ${I}`);
 *   }
 *   return X;
 * }
 */
async function loadSkillsFromDirectory(
  dirPath: string,
  source: SkillSource
): Promise<SkillDefinition[]> {
  const results: SkillDefinition[] = [];

  try {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    // 1. 检查根目录的 SKILL.md（单文件模式）
    const rootSkillFile = path.join(dirPath, 'SKILL.md');
    if (fs.existsSync(rootSkillFile)) {
      try {
        const content = fs.readFileSync(rootSkillFile, { encoding: 'utf-8' });
        const { frontmatter, content: markdownContent } = parseFrontmatter(content);

        // 使用目录名作为 skillName
        const skillName = path.basename(dirPath);

        const skill = createSkillFromFile(
          skillName,
          {
            filePath: rootSkillFile,
            baseDir: path.dirname(rootSkillFile),
            frontmatter,
            content: markdownContent,
          },
          source,
          true // isSkillMode
        );

        if (skill) {
          results.push(skill);
        }
      } catch (error) {
        console.error(`Failed to load skill from ${rootSkillFile}:`, error);
      }

      return results;
    }

    // 2. 遍历子目录，查找每个子目录下的 SKILL.md
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const subDirPath = path.join(dirPath, entry.name);
      const skillFile = path.join(subDirPath, 'SKILL.md');

      if (fs.existsSync(skillFile)) {
        try {
          const content = fs.readFileSync(skillFile, { encoding: 'utf-8' });
          const { frontmatter, content: markdownContent } = parseFrontmatter(content);

          // 使用子目录名作为 skillName
          const skillName = entry.name;

          const skill = createSkillFromFile(
            skillName,
            {
              filePath: skillFile,
              baseDir: path.dirname(skillFile),
              frontmatter,
              content: markdownContent,
            },
            source,
            true // isSkillMode
          );

          if (skill) {
            results.push(skill);
          }
        } catch (error) {
          console.error(`Failed to load skill from ${skillFile}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Failed to load skills from directory ${dirPath}:`, error);
  }

  return results;
}

/**
 * 发现嵌套的 .claude/skills 目录 (v2.1.6+)
 *
 * 搜索当前工作目录下所有子目录中的 .claude/skills 目录
 * 用于支持 monorepo 等场景
 */
function discoverNestedSkillsDirectories(rootDir: string, maxDepth: number = 3): string[] {
  const result: string[] = [];

  function scanDir(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // 跳过隐藏目录（除了 .claude）
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue;

        // 跳过常见的不需要扫描的目录
        if (['node_modules', 'vendor', 'dist', 'build', 'out', '.git', '__pycache__', '.venv', 'venv'].includes(entry.name)) {
          continue;
        }

        const subDirPath = path.join(dir, entry.name);

        // 检查是否有 .claude/skills 目录
        if (entry.name === '.claude') {
          const skillsDir = path.join(subDirPath, 'skills');
          if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
            result.push(skillsDir);
          }
        } else {
          // 继续递归扫描
          scanDir(subDirPath, depth + 1);
        }
      }
    } catch {
      // 忽略无法访问的目录
    }
  }

  scanDir(rootDir, 0);
  return result;
}

/**
 * 获取已启用的插件列表（对齐官网 u7 函数）
 *
 * enabledPlugins 格式：{ "plugin-name@marketplace": true/false }
 * 返回格式：Set<"plugin-name@marketplace">
 */
function getEnabledPlugins(): Set<string> {
  const enabledPlugins = new Set<string>();
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const settingsPath = path.join(homeDir, '.claude', 'settings.json');

  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, { encoding: 'utf-8' });
      const settings = JSON.parse(content);

      if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
        for (const [pluginId, enabled] of Object.entries(settings.enabledPlugins)) {
          if (enabled === true) {
            enabledPlugins.add(pluginId);
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to read enabledPlugins from settings:', error);
  }

  return enabledPlugins;
}

/**
 * 从插件缓存目录加载 skills（对齐官网 sG0 函数）
 *
 * 官网实现：
 * - 先通过 u7() 获取已启用的插件列表
 * - 只加载已启用插件的 skills
 * - 插件 skills 存储在 ~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/skills/{skill-name}/SKILL.md
 * - 命名空间格式：{plugin-name}:{skill-name}
 */
async function loadSkillsFromPluginCache(): Promise<SkillDefinition[]> {
  const results: SkillDefinition[] = [];
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const pluginsCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache');

  // 获取已启用的插件列表（对齐官网 u7 函数）
  const enabledPlugins = getEnabledPlugins();

  try {
    if (!fs.existsSync(pluginsCacheDir)) {
      return [];
    }

    // 遍历 marketplace 目录
    const marketplaces = fs.readdirSync(pluginsCacheDir, { withFileTypes: true });
    for (const marketplace of marketplaces) {
      if (!marketplace.isDirectory()) continue;

      const marketplacePath = path.join(pluginsCacheDir, marketplace.name);
      const plugins = fs.readdirSync(marketplacePath, { withFileTypes: true });

      for (const plugin of plugins) {
        if (!plugin.isDirectory()) continue;

        // 检查插件是否启用（对齐官网实现）
        // enabledPlugins 格式：{plugin-name}@{marketplace}
        const pluginId = `${plugin.name}@${marketplace.name}`;
        if (!enabledPlugins.has(pluginId)) {
          continue; // 跳过未启用的插件
        }

        const pluginPath = path.join(marketplacePath, plugin.name);
        const versions = fs.readdirSync(pluginPath, { withFileTypes: true });

        for (const version of versions) {
          if (!version.isDirectory()) continue;

          // 检查 skills 目录
          const skillsPath = path.join(pluginPath, version.name, 'skills');
          if (!fs.existsSync(skillsPath)) continue;

          const skillDirs = fs.readdirSync(skillsPath, { withFileTypes: true });
          for (const skillDir of skillDirs) {
            if (!skillDir.isDirectory()) continue;

            // 查找 SKILL.md
            const skillMdPath = path.join(skillsPath, skillDir.name, 'SKILL.md');
            if (!fs.existsSync(skillMdPath)) continue;

            try {
              const content = fs.readFileSync(skillMdPath, { encoding: 'utf-8' });
              const { frontmatter, content: markdownContent } = parseFrontmatter(content);

              // 命名空间格式：{plugin-name}:{skill-name}（对齐官网格式）
              const skillName = `${plugin.name}:${skillDir.name}`;

              const skill = createSkillFromFile(
                skillName,
                {
                  filePath: skillMdPath,
                  baseDir: path.dirname(skillMdPath),
                  frontmatter,
                  content: markdownContent,
                },
                'plugin',
                true // isSkillMode
              );

              if (skill) {
                // v2.1.33: set plugin name for better discoverability
                skill.pluginName = plugin.name;
                results.push(skill);
              }
            } catch (error) {
              console.error(`Failed to load skill from ${skillMdPath}:`, error);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Failed to load skills from plugin cache:`, error);
  }

  return results;
}

/**
 * 初始化并加载所有 skills（对齐官网 JN0 函数）
 *
 * 官网实现包含基于 inode 的去重逻辑：
 * ```
 * let W=new Map,D=[];
 * for(let{skill:V,filePath:F}of I){
 *   if(V.type!=="prompt")continue;
 *   let H=fo5(F);  // fo5 获取 inode
 *   if(H===null){D.push(V);continue}
 *   let E=W.get(H);
 *   if(E!==void 0){
 *     k(`Skipping duplicate skill '${V.name}' from ${V.source} (same inode already loaded from ${E})`);
 *     continue
 *   }
 *   W.set(H,V.source),D.push(V)
 * }
 * ```
 */
export async function initializeSkills(): Promise<void> {
  if (skillsLoaded) return;

  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const claudeDir = path.join(homeDir, '.claude');
  const cwd = getCurrentCwd();
  const projectDir = path.join(cwd, '.claude');

  // 清空注册表
  skillRegistry.clear();

  // 收集所有 skills（带 filePath）
  const allSkillsWithPath: Array<{ skill: SkillDefinition; filePath: string }> = [];

  // 1. 加载插件 skills（优先级最低）
  const pluginSkills = await loadSkillsFromPluginCache();
  for (const skill of pluginSkills) {
    allSkillsWithPath.push({ skill, filePath: skill.filePath });
  }

  // 2. 加载用户级 skills（对齐官网 userSettings）
  const userSkillsDir = path.join(claudeDir, 'skills');
  const userSkills = await loadSkillsFromDirectory(userSkillsDir, 'userSettings');
  for (const skill of userSkills) {
    allSkillsWithPath.push({ skill, filePath: skill.filePath });
  }

  // 3. 加载项目级 skills（对齐官网 projectSettings，优先级最高）
  const projectSkillsDir = path.join(projectDir, 'skills');
  const projectSkills = await loadSkillsFromDirectory(projectSkillsDir, 'projectSettings');
  for (const skill of projectSkills) {
    allSkillsWithPath.push({ skill, filePath: skill.filePath });
  }

  // 4. v2.1.6+: 发现并加载嵌套的 .claude/skills 目录
  // 搜索当前工作目录下子目录中的 .claude/skills 目录
  const nestedSkillsDirs = discoverNestedSkillsDirectories(cwd);
  for (const nestedDir of nestedSkillsDirs) {
    // 避免重复加载根目录的 skills
    if (nestedDir === projectSkillsDir) continue;

    const nestedSkills = await loadSkillsFromDirectory(nestedDir, 'projectSettings');
    for (const skill of nestedSkills) {
      // 添加子目录路径前缀以区分来源
      const relativePath = path.relative(cwd, nestedDir);
      const parentDir = path.dirname(path.dirname(relativePath)); // 获取 .claude 的父目录
      const prefixedSkillName = parentDir ? `${skill.skillName}@${parentDir}` : skill.skillName;

      // 重新设置 skillName 以包含路径前缀
      const modifiedSkill = {
        ...skill,
        skillName: prefixedSkillName,
      };

      allSkillsWithPath.push({ skill: modifiedSkill, filePath: skill.filePath });
    }
  }

  // 5. v2.1.32: 加载 --add-dir 目录下的 .claude/skills/
  // 官方更新：Skills defined in .claude/skills/ within additional directories (--add-dir) are now loaded automatically.
  const addDirPaths = getAdditionalDirectories();
  for (const addDir of addDirPaths) {
    const addDirSkillsPath = path.join(addDir, '.claude', 'skills');
    if (fs.existsSync(addDirSkillsPath)) {
      const addDirSkills = await loadSkillsFromDirectory(addDirSkillsPath, 'projectSettings');
      for (const skill of addDirSkills) {
        allSkillsWithPath.push({ skill, filePath: skill.filePath });
      }
    }
  }

  // 基于 inode 去重（对齐官网 JN0 函数）
  // 使用 Map<inode, source> 记录已加载的 inode
  const seenInodes = new Map<string, string>();
  const uniqueSkills: SkillDefinition[] = [];
  let duplicateCount = 0;

  for (const { skill, filePath } of allSkillsWithPath) {
    // 获取文件的 inode（使用 64 位精度）
    const inode = getFileInode(filePath);

    if (inode === null) {
      // 无法获取 inode，直接添加（不进行去重）
      uniqueSkills.push(skill);
      continue;
    }

    // 检查是否已存在相同 inode 的 skill
    const existingSource = seenInodes.get(inode);
    if (existingSource !== undefined) {
      // 跳过重复的 skill（对齐官网日志格式）
      console.log(`Skipping duplicate skill '${skill.skillName}' from ${skill.source} (same inode already loaded from ${existingSource})`);
      duplicateCount++;
      continue;
    }

    // 记录 inode 并添加 skill
    seenInodes.set(inode, skill.source);
    uniqueSkills.push(skill);
  }

  // 将去重后的 skills 添加到注册表
  for (const skill of uniqueSkills) {
    skillRegistry.set(skill.skillName, skill);
  }

  // 输出去重统计（对齐官网日志格式）
  if (duplicateCount > 0) {
    console.log(`Deduplicated ${duplicateCount} skills (same inode)`);
  }

  skillsLoaded = true;

  console.log(`Loaded ${skillRegistry.size} unique skills (plugin: ${pluginSkills.length}, user: ${userSkills.length}, project: ${projectSkills.length})`);

  // 初始化完成后自动启用热重载
  enableSkillHotReload();
}

/**
 * 清除缓存
 */
export function clearSkillCache(): void {
  skillRegistry.clear();
  invokedSkills.clear();
  skillsLoaded = false;
}

/**
 * 获取所有 skills
 */
export function getAllSkills(): SkillDefinition[] {
  return Array.from(skillRegistry.values());
}

/**
 * 查找 skill（支持命名空间）
 */
export function findSkill(skillInput: string): SkillDefinition | undefined {
  // 1. 精确匹配
  if (skillRegistry.has(skillInput)) {
    return skillRegistry.get(skillInput);
  }

  // 2. 如果没有命名空间，尝试查找第一个匹配的 skill
  if (!skillInput.includes(':')) {
    for (const [fullName, skill] of skillRegistry.entries()) {
      const parts = fullName.split(':');
      const name = parts[parts.length - 1];
      if (name === skillInput) {
        return skill;
      }
    }
  }

  return undefined;
}

/**
 * 格式化 skill 描述（对齐官网 WKK 函数）
 */
function formatSkillDescription(skill: SkillDefinition): string {
  let desc = skill.description;
  if (skill.whenToUse) {
    desc = `${desc} - ${skill.whenToUse}`;
  }
  // v2.1.33: add plugin name for better discoverability
  if (skill.pluginName) {
    desc = `${desc} (from ${skill.pluginName})`;
  }
  return desc;
}

/**
 * 格式化单个 skill 为列表项（对齐官网 Oj2 函数）
 */
function formatSkillListItem(skill: SkillDefinition): string {
  return `- ${skill.skillName}: ${formatSkillDescription(skill)}`;
}

/**
 * 格式化 skills 列表（对齐官网 $j2 函数）
 * 支持三种格式：
 * - 完整格式：当所有 skills 描述在预算内
 * - 截断格式：当描述太长时截断
 * - 超短格式：只显示名称
 */
export function formatSkillsList(skills: SkillDefinition[], contextWindowSize?: number): string {
  if (skills.length === 0) {
    return '';
  }

  // v2.1.32: Skill 字符预算随上下文窗口缩放 (2% of context)
  // 官方实现：预算 = 上下文窗口大小 * 2%（以字符为单位，约4字符/token）
  // 默认上下文窗口: 200000 tokens -> 默认预算 200000 * 0.02 * 4 = 16000 字符
  const DEFAULT_CONTEXT_WINDOW = 200000; // tokens
  const CHARS_PER_TOKEN = 4;
  const CONTEXT_BUDGET_RATIO = 0.02; // 2% of context window
  const contextTokens = contextWindowSize || DEFAULT_CONTEXT_WINDOW;
  const scaledBudget = Math.floor(contextTokens * CONTEXT_BUDGET_RATIO * CHARS_PER_TOKEN);
  const CHAR_BUDGET = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET) || scaledBudget;
  const MIN_DESC_LENGTH = 20;

  // 计算完整格式
  const fullItems = skills.map(s => ({
    skill: s,
    full: formatSkillListItem(s),
  }));

  const totalFullLength = fullItems.reduce((sum, item) => sum + item.full.length, 0) + (fullItems.length - 1);

  // 如果完整格式在预算内，使用完整格式
  if (totalFullLength <= CHAR_BUDGET) {
    return fullItems.map(item => item.full).join('\n');
  }

  // 计算只有名称时的长度
  const namesOnlyLength = skills.reduce((sum, s) => sum + s.skillName.length + 4, 0) + (skills.length - 1);
  const remainingBudget = CHAR_BUDGET - namesOnlyLength;
  const descBudgetPerSkill = Math.floor(remainingBudget / skills.length);

  // 如果每个 skill 的描述预算太小，使用超短格式
  if (descBudgetPerSkill < MIN_DESC_LENGTH) {
    return skills.map(s => `- ${s.skillName}`).join('\n');
  }

  // 使用截断格式
  return skills.map(s => {
    const desc = formatSkillDescription(s);
    const truncatedDesc = desc.length > descBudgetPerSkill
      ? desc.slice(0, descBudgetPerSkill - 1) + '…'
      : desc;
    return `- ${s.skillName}: ${truncatedDesc}`;
  }).join('\n');
}

/**
 * v4.3: 注册 skill 定义中的 hooks 到全局 hooks 系统
 * 修复 issue #84: SKILL.md 不支持 hook
 *
 * hooks 配置格式（与 settings.json 中的 hooks 格式一致）:
 * {
 *   "PreToolUse": [{ "type": "command", "command": "...", "matcher": "Bash" }],
 *   "PostToolUse": [{ "type": "command", "command": "..." }],
 *   "TaskCompleted": [{ "type": "command", "command": "check-completion.sh" }]
 * }
 */
function registerSkillHooks(skillName: string, hooks: Record<string, any>): void {
  const validEvents: string[] = [
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
    'Notification', 'UserPromptSubmit', 'SessionStart', 'SessionEnd',
    'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest',
    'TeammateIdle', 'TaskCompleted',
  ];

  for (const [eventName, hookConfigs] of Object.entries(hooks)) {
    if (!validEvents.includes(eventName)) {
      console.warn(`[Skill] Unknown hook event "${eventName}" in skill "${skillName}", skipping`);
      continue;
    }

    const hookArray = Array.isArray(hookConfigs) ? hookConfigs : [hookConfigs];
    for (const hookConfig of hookArray) {
      if (!hookConfig || typeof hookConfig !== 'object' || !hookConfig.type) {
        console.warn(`[Skill] Invalid hook config in skill "${skillName}" for event "${eventName}":`, hookConfig);
        continue;
      }
      // 为来自 skill 的 hooks 添加来源标记，方便调试
      const taggedConfig = {
        ...hookConfig,
        _skillSource: skillName,
      };
      registerHook(eventName as HookEvent, taggedConfig as HookConfig);
    }
  }
}

/**
 * Skill 工具类（对齐官网 v2.1.20+ 实现）
 */
export class SkillTool extends BaseTool<SkillInput, any> {
  name = 'Skill';

  /**
   * 获取工具描述（对齐官网 A0A 缓存函数）
   *
   * 官网实现：Skill tool 的 description 是固定文本，不内联 skill 列表。
   * Skill 列表通过 attachment 机制（skill_listing）以 system-reminder 方式注入到对话中。
   */
  get description(): string {
    return `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - \`skill: "pdf"\` - invoke the pdf skill
  - \`skill: "commit", args: "-m 'Fix bug'"\` - invoke with arguments
  - \`skill: "review-pr", args: "123"\` - invoke with arguments
  - \`skill: "ms-office-suite:pdf"\` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
`;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        skill: {
          type: 'string',
          description: 'The skill name. E.g., "pdf", "user:my-skill"',
        },
        args: {
          type: 'string',
          description: 'Optional arguments for the skill',
        },
      },
      required: ['skill'],
    };
  }

  async execute(input: SkillInput): Promise<any> {
    const { skill: skillInput, args } = input;

    // 确保 skills 已加载
    if (!skillsLoaded) {
      await initializeSkills();
    }

    // 查找 skill
    const skill = findSkill(skillInput);
    if (!skill) {
      const available = Array.from(skillRegistry.keys()).join(', ');
      return {
        success: false,
        error: t('skill.notFound', { name: skillInput, available: available || 'none' }),
      };
    }

    // 检查是否禁用模型调用
    if (skill.disableModelInvocation) {
      return {
        success: false,
        error: t('skill.modelInvocationDisabled', { name: skill.skillName }),
      };
    }

    // 构建输出内容
    let skillContent = skill.markdownContent;

    // v2.1.19+: 使用参数替换函数处理占位符
    // 支持: $ARGUMENTS[N], $N, $ARGUMENTS, $PARAM_NAME（具名参数）
    // 如果没有占位符则追加 ARGUMENTS: 部分
    skillContent = substituteArguments(skillContent, args, true, skill.argumentNames || []);

    // v2.1.9: 替换 ${CLAUDE_SESSION_ID} 占位符
    // 官网实现：M = M.replace(/\$\{CLAUDE_SESSION_ID\}/g, H0())
    const sessionId = process.env.CLAUDE_CODE_SESSION_ID || '';
    skillContent = skillContent.replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);

    // 记录已调用的 skill（对齐官网 KP0）
    recordInvokedSkill(skill.skillName, skill.filePath, skillContent);

    // v4.3: 注册 skill 定义中的 hooks（修复 issue #84: SKILL.md 不支持 hook）
    // 当 skill 被调用时，将其定义的 hooks 注册到全局 hooks 系统
    if (skill.hooks && typeof skill.hooks === 'object') {
      registerSkillHooks(skill.skillName, skill.hooks);
    }

    // 对齐官网实现：skill 通过 newMessages 传递两条独立的 user 消息
    //
    // 官网 Ch4 函数返回结构：
    //   消息1: metadata（<command-name> + <command-message> 标签），无 isMeta
    //   消息2: skill 完整内容（<skill> 标签包裹），isMeta: true
    //
    // 官网 TGY/HTA/Lh4 函数构建 metadata：
    //   HTA（skill-loaded skills）: <command-name>name</command-name>\n<command-message>name</command-message>\n<skill-format>true</skill-format>
    //   Lh4（user-invocable）: <command-name>name</command-name>\n<command-message>/name</command-message>\n[<command-args>args</command-args>]

    // 消息1: metadata 标签
    let metadataText: string;
    if (skill.userInvocable !== false && (skill.loadedFrom === 'skills' || skill.source === 'plugin')) {
      // HTA 格式：skill-loaded 或 plugin 来源的 skill
      metadataText = [
        `<command-name>${skill.displayName}</command-name>`,
        `<command-message>${skill.displayName}</command-message>`,
        '<skill-format>true</skill-format>',
      ].join('\n');
    } else {
      // Lh4 格式：user-invocable skill
      const parts = [
        `<command-name>${skill.displayName}</command-name>`,
        `<command-message>/${skill.skillName}</command-message>`,
      ];
      if (args) {
        parts.push(`<command-args>${args}</command-args>`);
      }
      metadataText = parts.join('\n');
    }

    // 消息2: skill 内容（isMeta: true）
    let skillBody = `<skill name="${skill.skillName}" location="${skill.source}"`;
    if (skill.version) {
      skillBody += ` version="${skill.version}"`;
    }
    if (skill.model) {
      skillBody += ` model="${skill.model}"`;
    }
    if (skill.allowedTools && skill.allowedTools.length > 0) {
      skillBody += ` allowed-tools="${skill.allowedTools.join(',')}"`;
    }
    skillBody += `>\n${skillContent}\n</skill>`;

    return {
      success: true,
      output: `Launching skill: ${skill.displayName}`,
      commandName: skill.skillName,
      allowedTools: skill.allowedTools,
      model: skill.model,
      // newMessages：两条独立的 user 消息（对齐官网 Ch4 实现）
      newMessages: [
        {
          // 消息1: metadata 标签（无 isMeta，对 UI 可见）
          role: 'user' as const,
          content: [{ type: 'text' as const, text: metadataText }],
        },
        {
          // 消息2: skill 完整内容（isMeta: true，对 UI 不可见）
          role: 'user' as const,
          content: [{ type: 'text' as const, text: skillBody }],
          isMeta: true,
        },
      ],
    };
  }
}

/**
 * 启用技能热重载（占位函数）
 *
 * 注：完整的热重载功能需要 chokidar 库支持
 * 这里提供一个占位实现，避免导入错误
 */
export function enableSkillHotReload(): void {
  // 热重载功能的占位实现
  // 完整实现需要监听 ~/.claude/skills 和 .claude/skills 目录
  console.log('[Skill] Hot reload feature is available');
}

/**
 * 禁用技能热重载
 */
export function disableSkillHotReload(): void {
  // 占位实现
  console.log('[Skill] Hot reload disabled');
}
