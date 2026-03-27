/**
 * CreateTool - 创建自定义外挂工具
 *
 * 通过在 ~/.axon/custom-tools/ 写入 JS 文件来扩展能力。
 * 工具以标准 ES Module 格式导出，启动时自动加载，运行时可热重载。
 *
 * 与 Skill 的区别：
 * - Skill：Markdown 文件，模型读取后自行解释执行，需要通过 Bash node -e 运行
 * - CustomTool：JS 文件，直接注册为 ToolRegistry 中的工具，模型可直接调用
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import {
  getCustomToolsDir,
  reloadCustomTools,
  listCustomToolFiles,
} from './custom-tool-loader.js';
import * as fs from 'fs';
import * as path from 'path';

export interface CreateToolInput {
  /** 工具名称（英文，PascalCase 推荐） */
  name: string;
  /** 工具描述（告诉模型何时使用、做什么） */
  description?: string;
  /** JavaScript async 函数体，接收 input 参数 */
  executeCode?: string;
  /** JSON Schema 定义工具的输入参数 */
  inputSchema?: Record<string, any>;
  /** 操作类型 */
  action?: 'create' | 'delete' | 'list' | 'reload';
}

/**
 * CreateTool - 创建/管理自定义外挂工具
 */
export class CreateToolTool extends BaseTool<CreateToolInput, ToolResult> {
  name = 'CreateTool';
  shouldDefer = true;
  searchHint = 'create new tool, extend capabilities, custom automation, add new command';
  description = `Create, delete, list, or reload custom tools at runtime. Custom tools are persisted to ~/.axon/custom-tools/ as JS files and auto-loaded on startup.

Use this to create new tools that extend your capabilities:
- Shell command wrappers
- API integrations
- Data processing utilities
- Custom automation scripts

The executeCode is a JavaScript async function body that receives 'input' and should return { success: boolean, output?: string, error?: string } or a plain string.
Available in executeCode: import() for any Node.js module, process, Buffer, console, fetch, setTimeout.

Actions:
- create: Write a new tool JS file and register it immediately
- delete: Remove a tool file and unregister it
- list: Show all custom tools
- reload: Reload all custom tools from disk`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'delete', 'list', 'reload'],
          description: 'Action to perform. Defaults to "create".',
        },
        name: {
          type: 'string',
          description: 'Tool name (English, PascalCase recommended). Required for create/delete.',
        },
        description: {
          type: 'string',
          description: 'Tool description shown to the model. Required for create.',
        },
        inputSchema: {
          type: 'object',
          description: 'JSON Schema defining the tool\'s input parameters. Required for create.',
        },
        executeCode: {
          type: 'string',
          description: 'JavaScript async function body. Receives "input" parameter. Can use import() for Node.js modules. Must return { success, output?, error? } or a string. Required for create.',
        },
      },
      required: ['name'],
    };
  }

  async execute(input: CreateToolInput): Promise<ToolResult> {
    const action = input.action || 'create';

    switch (action) {
      case 'list':
        return this.listTools();
      case 'delete':
        return this.deleteTool(input.name);
      case 'reload':
        return this.reloadTools();
      case 'create':
        return this.createTool(input);
      default:
        return this.error(`Unknown action: ${action}. Use 'create', 'delete', 'list', or 'reload'.`);
    }
  }

  /**
   * 列出所有自定义工具
   */
  private listTools(): ToolResult {
    const tools = listCustomToolFiles();

    if (tools.length === 0) {
      const dir = getCustomToolsDir();
      return this.success(`No custom tools found.\nDirectory: ${dir}\n\nUse CreateTool with action="create" to add new tools.`);
    }

    const lines = tools.map(t => {
      const status = t.loaded ? '✓' : '✗';
      const name = t.name || '(parse error)';
      const desc = t.description || '(no description)';
      return `  ${status} ${name} — ${desc} [${t.file}]`;
    });

    return this.success(
      `Custom tools (${tools.length}):\n\n${lines.join('\n')}\n\nDirectory: ${getCustomToolsDir()}`
    );
  }

  /**
   * 删除自定义工具
   */
  private async deleteTool(name: string): Promise<ToolResult> {
    if (!name) {
      return this.error('Tool name is required for delete action.');
    }

    const dir = getCustomToolsDir();
    // 查找匹配的文件
    const fileName = this.toFileName(name);
    const filePath = path.join(dir, fileName);

    if (!fs.existsSync(filePath)) {
      return this.error(`Tool file not found: ${filePath}`);
    }

    try {
      fs.unlinkSync(filePath);
      // 重新加载以更新注册表
      await reloadCustomTools();
      return this.success(`Deleted tool "${name}".\nFile: ${filePath}`);
    } catch (err: any) {
      return this.error(`Failed to delete tool: ${err.message}`);
    }
  }

  /**
   * 重新加载所有自定义工具
   */
  private async reloadTools(): Promise<ToolResult> {
    const { loaded, errors } = await reloadCustomTools();

    const parts: string[] = [];
    if (loaded.length > 0) {
      parts.push(`Loaded ${loaded.length} tool(s): ${loaded.join(', ')}`);
    } else {
      parts.push('No custom tools loaded.');
    }
    if (errors.length > 0) {
      parts.push(`\nErrors:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    }
    parts.push(`\nDirectory: ${getCustomToolsDir()}`);

    return this.success(parts.join('\n'));
  }

  /**
   * 创建自定义工具
   */
  private async createTool(input: CreateToolInput): Promise<ToolResult> {
    const { name, description, executeCode, inputSchema } = input;

    // 验证
    if (!name) return this.error('Tool name is required.');
    if (!description) return this.error('Tool description is required.');
    if (!executeCode) return this.error('executeCode is required.');

    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
      return this.error(`Invalid tool name "${name}". Must start with a letter, contain only letters, digits, _ or -.`);
    }

    // 构建 JS 文件内容
    const jsContent = this.buildToolFile(name, description, executeCode, inputSchema);

    // 写入文件
    const dir = getCustomToolsDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const fileName = this.toFileName(name);
    const filePath = path.join(dir, fileName);
    const isUpdate = fs.existsSync(filePath);

    fs.writeFileSync(filePath, jsContent, 'utf-8');

    // 重新加载使其立即生效
    const { loaded, errors } = await reloadCustomTools();

    const actionWord = isUpdate ? 'Updated' : 'Created';
    const parts = [
      `${actionWord} custom tool "${name}".`,
      `File: ${filePath}`,
    ];

    if (loaded.includes(name)) {
      parts.push(`Status: Registered and ready to use.`);
      parts.push(`The tool "${name}" is now available and can be called directly.`);
    } else {
      parts.push(`Status: File saved but registration failed.`);
      if (errors.length > 0) {
        parts.push(`Errors: ${errors.join('; ')}`);
      }
    }

    return this.success(parts.join('\n'));
  }

  /**
   * 将工具名转换为文件名
   * PascalCase → kebab-case.js
   */
  private toFileName(name: string): string {
    const kebab = name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
      .toLowerCase();
    return `${kebab}.js`;
  }

  /**
   * 构建工具 JS 文件内容
   */
  private buildToolFile(
    name: string,
    description: string,
    executeCode: string,
    inputSchema?: Record<string, any>,
  ): string {
    const schema = inputSchema || { type: 'object', properties: {} };
    const schemaStr = JSON.stringify(schema, null, 2)
      .split('\n')
      .map((line, i) => i === 0 ? line : '  ' + line)
      .join('\n');

    // 转义 description 中的反引号
    const escapedDesc = description.replace(/`/g, '\\`');

    return `/**
 * Custom Tool: ${name}
 * ${description}
 *
 * Auto-generated by CreateTool. Feel free to edit.
 */

export default {
  name: "${name}",
  description: \`${escapedDesc}\`,
  inputSchema: ${schemaStr},
  async execute(input) {
    ${executeCode}
  },
};
`;
  }
}
