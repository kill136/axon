/**
 * CreateTool - 创建自定义 Skill
 *
 * 通过在 ~/.axon/skills/<name>/SKILL.md 写入 skill 文件来扩展能力。
 * 利用现有 Skill 系统：
 * - system-reminder 中只占一行描述（低上下文开销）
 * - 通过 Skill 工具按需调用（加载完整内容）
 * - 支持 frontmatter 元数据（description, allowed-tools, when-to-use 等）
 * - 下次启动自动发现加载
 *
 * 与注册 Tool 的区别：
 * - Tool：每个都要把 name + description + inputSchema 塞进 API tools 列表，token 开销大
 * - Skill：只在 system-reminder 占一行，按需通过 Skill 工具调用，上下文开销极小
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { clearSkillCache, initializeSkills } from './skill.js';
import { t } from '../i18n/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CreateToolInput {
  /** skill 名称（英文，kebab-case 或 camelCase，会作为目录名和调用名） */
  name: string;
  /** skill 描述（显示在 system-reminder 中，告诉模型何时使用） */
  description?: string;
  /** skill 执行代码（JavaScript async 函数体，接收 input 参数） */
  executeCode?: string;
  /** JSON Schema 定义 skill 的输入参数 */
  inputSchema?: Record<string, any>;
  /** 操作类型 */
  action?: 'create' | 'delete' | 'list';
}

/**
 * 获取用户级 skills 目录
 */
function getUserSkillsDir(): string {
  return path.join(os.homedir(), '.axon', 'skills');
}

/**
 * CreateTool - 创建/管理自定义 Skills
 */
export class CreateToolTool extends BaseTool<CreateToolInput, ToolResult> {
  name = 'CreateTool';
  description = `Create, cancel, or list custom tools at runtime. Custom tools are persisted to ~/.axon/custom-tools/ and auto-loaded on startup.

Use this to create new tools that extend your capabilities:
- Shell command wrappers
- API integrations
- Data processing utilities
- Custom automation scripts

The executeCode is a JavaScript async function body that receives 'input' and should return { success: boolean, output?: string, error?: string }.
Available in executeCode: require (Node.js modules), process, Buffer, console, fetch, setTimeout.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'delete', 'list'],
          description: 'Action to perform. Defaults to "create".',
        },
        name: {
          type: 'string',
          description: 'Tool name (English, PascalCase recommended). Required for create/delete.',
        },
        description: {
          type: 'string',
          description: 'Tool description shown in system prompt. Required for create.',
        },
        inputSchema: {
          type: 'object',
          description: 'JSON Schema defining the tool\'s input parameters. Required for create.',
        },
        executeCode: {
          type: 'string',
          description: 'JavaScript async function body. Receives "input" parameter. Available globals: require, process, Buffer, console, fetch, setTimeout. Must return { success, output?, error? } or a string. Required for create.',
        },
      },
      required: ['name'],
    };
  }

  async execute(input: CreateToolInput): Promise<ToolResult> {
    const action = input.action || 'create';

    switch (action) {
      case 'list':
        return this.listSkills();
      case 'delete':
        return this.deleteSkill(input.name);
      case 'create':
        return this.createSkill(input);
      default:
        return this.error(`Unknown action: ${action}. Use 'create', 'delete', or 'list'.`);
    }
  }

  /**
   * 列出所有用户自定义 skills
   */
  private listSkills(): ToolResult {
    const dir = getUserSkillsDir();
    if (!fs.existsSync(dir)) {
      return this.success(t('createTool.noSkills'));
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory());

    if (skillDirs.length === 0) {
      return this.success(t('createTool.noSkills'));
    }

    const skills: string[] = [];
    for (const entry of skillDirs) {
      const skillMd = path.join(dir, entry.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        const content = fs.readFileSync(skillMd, 'utf-8');
        // 提取 description
        const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
        const desc = descMatch ? descMatch[1] : '(no description)';
        skills.push(`- ${entry.name}: ${desc}`);
      } else {
        skills.push(`- ${entry.name}: (missing SKILL.md)`);
      }
    }

    return this.success(`User skills (${skills.length}):\n\n${skills.join('\n')}\n\nPath: ${dir}`);
  }

  /**
   * 删除自定义 skill
   */
  private deleteSkill(name: string): ToolResult {
    if (!name) {
      return this.error(t('createTool.nameRequiredDelete'));
    }

    const dir = getUserSkillsDir();
    const skillDir = path.join(dir, name);

    if (!fs.existsSync(skillDir)) {
      return this.error(`Skill '${name}' not found at ${skillDir}`);
    }

    try {
      fs.rmSync(skillDir, { recursive: true, force: true });

      // 刷新 skill 缓存
      clearSkillCache();
      initializeSkills().catch(() => {});

      return this.success(`Skill '${name}' deleted.\nPath: ${skillDir}`);
    } catch (err: any) {
      return this.error(`Failed to delete skill: ${err.message}`);
    }
  }

  /**
   * 创建或更新自定义 skill
   */
  private createSkill(input: CreateToolInput): ToolResult {
    const { name, description, executeCode, inputSchema } = input;

    // 验证
    if (!name) return this.error(t('createTool.nameRequired'));
    if (!description) return this.error(t('createTool.descRequired'));
    if (!executeCode) return this.error(t('createTool.codeRequired'));

    // 名称格式验证（允许 kebab-case, camelCase, PascalCase, snake_case）
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      return this.error(t('createTool.invalidName'));
    }

    // 构建 SKILL.md 内容
    const skillContent = this.buildSkillMd(name, description, executeCode, inputSchema);

    // 写入文件
    const dir = getUserSkillsDir();
    const skillDir = path.join(dir, name);
    const skillMd = path.join(skillDir, 'SKILL.md');
    const isUpdate = fs.existsSync(skillMd);

    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    fs.writeFileSync(skillMd, skillContent, 'utf-8');

    // 刷新 skill 缓存使其立即生效
    clearSkillCache();
    initializeSkills().catch(() => {});

    const action = isUpdate ? 'Updated' : 'Created';
    return this.success(
      `${action} skill '${name}'.\n\n` +
      `Path: ${skillMd}\n` +
      `Invoke: Use the Skill tool with skill="${name}"\n\n` +
      `The skill is now available in the system-reminder and can be invoked immediately.`
    );
  }

  /**
   * 构建 SKILL.md 文件内容
   *
   * 生成一个带 frontmatter 的 markdown 文件，body 部分包含：
   * - 说明文字
   * - executeCode 嵌入在 ```javascript 代码块中
   * - 输入参数的 schema 说明
   *
   * 调用时由 Skill 工具加载完整内容注入对话，模型读取后用 Bash 执行 node -e
   */
  private buildSkillMd(
    name: string,
    description: string,
    executeCode: string,
    inputSchema?: Record<string, any>
  ): string {
    const lines: string[] = [];

    // Frontmatter
    lines.push('---');
    lines.push(`description: "${description.replace(/"/g, '\\"')}"`);
    lines.push(`when-to-use: "${description.replace(/"/g, '\\"')}"`);
    lines.push(`allowed-tools: "Bash"`);
    lines.push('---');
    lines.push('');

    // Body: 执行说明
    lines.push(`# ${name}`);
    lines.push('');
    lines.push(`${description}`);
    lines.push('');
    lines.push('## How to Execute');
    lines.push('');
    lines.push('Run the following code using the Bash tool with `node -e`:');
    lines.push('');

    // 如果有 inputSchema，生成参数说明
    if (inputSchema && inputSchema.properties) {
      lines.push('### Parameters');
      lines.push('');
      lines.push('Pass arguments via `$ARGUMENTS` substitution or parse from the user\'s request:');
      lines.push('');
      for (const [key, prop] of Object.entries(inputSchema.properties) as [string, any][]) {
        const desc = prop.description || '';
        const type = prop.type || 'any';
        const required = inputSchema.required?.includes(key) ? ' (required)' : '';
        lines.push(`- \`${key}\` (${type})${required}: ${desc}`);
      }
      lines.push('');
    }

    // 嵌入执行代码
    lines.push('### Code');
    lines.push('');
    lines.push('```javascript');
    lines.push(executeCode);
    lines.push('```');
    lines.push('');
    lines.push('### Usage');
    lines.push('');
    lines.push('Wrap the code above in `node -e \'...\'` via the Bash tool. Substitute parameter values from the user\'s input into the code.');
    lines.push('');

    return lines.join('\n');
  }
}
