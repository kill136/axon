/**
 * 工具 Schema 深度对比器
 *
 * 对比官方 sdk-tools.d.ts 中的类型定义与项目中的实现
 */

import * as fs from 'fs';
import * as path from 'path';

interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

interface ToolSchema {
  name: string;
  fields: SchemaField[];
}

class SchemaComparator {
  private projectRoot: string;
  private officialTypes: string = '';
  private officialCode: string = '';

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async run() {
    console.log('🔍 工具 Schema 深度对比器\n');
    console.log('='.repeat(60));

    // 加载官方类型定义
    const typesPath = path.join(this.projectRoot, 'node_modules/@anthropic-ai/claude-code/sdk-tools.d.ts');
    this.officialTypes = fs.readFileSync(typesPath, 'utf8');

    // 加载官方源码
    const codePath = path.join(this.projectRoot, 'node_modules/@anthropic-ai/claude-code/cli.js');
    this.officialCode = fs.readFileSync(codePath, 'utf8');

    // 解析官方 Schema
    console.log('\n📋 解析官方工具 Schema...\n');
    const officialSchemas = this.parseOfficialSchemas();

    for (const schema of officialSchemas) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`🔧 ${schema.name}`);
      console.log('='.repeat(50));

      // 打印官方 Schema
      console.log('\n📌 官方参数:');
      for (const field of schema.fields) {
        const reqMarker = field.required ? '*' : '?';
        console.log(`   ${field.name}${reqMarker}: ${field.type}`);
        if (field.description) {
          console.log(`      └─ ${field.description.substring(0, 60)}...`);
        }
      }

      // 查找项目中的实现
      const projectSchema = await this.findProjectSchema(schema.name);
      if (projectSchema) {
        console.log('\n📌 项目参数:');
        for (const field of projectSchema.fields) {
          const reqMarker = field.required ? '*' : '?';
          console.log(`   ${field.name}${reqMarker}: ${field.type}`);
        }

        // 对比差异
        this.compareSchemas(schema, projectSchema);
      } else {
        console.log('\n❌ 项目中未找到对应实现');
      }
    }

    // 生成对比报告
    await this.generateReport(officialSchemas);
  }

  private parseOfficialSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    // 从类型定义中提取接口
    const interfacePattern = /export interface (\w+Input)\s*\{([^}]+)\}/g;
    let match;

    while ((match = interfacePattern.exec(this.officialTypes)) !== null) {
      const interfaceName = match[1];
      const interfaceBody = match[2];

      const toolName = interfaceName.replace('Input', '');
      const fields = this.parseInterfaceFields(interfaceBody);

      schemas.push({
        name: toolName,
        fields,
      });
    }

    return schemas;
  }

  private parseInterfaceFields(body: string): SchemaField[] {
    const fields: SchemaField[] = [];
    const lines = body.split('\n');

    let currentDescription = '';

    for (const line of lines) {
      // 检查注释
      const commentMatch = line.match(/\/\*\*?\s*\n?\s*\*?\s*(.+)\s*\*?\s*\*?\//);
      if (commentMatch) {
        currentDescription = commentMatch[1].trim();
        continue;
      }

      // 单行注释
      const singleComment = line.match(/\/\/\s*(.+)/);
      if (singleComment) {
        currentDescription = singleComment[1].trim();
        continue;
      }

      // 解析字段
      const fieldMatch = line.match(/^\s*(\w+)(\?)?:\s*(.+?);?\s*$/);
      if (fieldMatch) {
        fields.push({
          name: fieldMatch[1],
          required: !fieldMatch[2],
          type: fieldMatch[3].replace(/;$/, '').trim(),
          description: currentDescription || undefined,
        });
        currentDescription = '';
      }
    }

    return fields;
  }

  private async findProjectSchema(toolName: string): Promise<ToolSchema | null> {
    // 工具名称到文件的映射
    const toolFileMap: Record<string, string> = {
      'Agent': 'src/tools/agent.ts',
      'Bash': 'src/tools/bash.ts',
      'TaskOutput': 'src/tools/agent.ts',
      'ExitPlanMode': 'src/tools/planmode.ts',
      'FileEdit': 'src/tools/file.ts',
      'FileRead': 'src/tools/file.ts',
      'FileWrite': 'src/tools/file.ts',
      'Glob': 'src/tools/search.ts',
      'Grep': 'src/tools/search.ts',
      'TaskStop': 'src/tools/bash.ts',
      'ListMcpResources': 'src/tools/mcp.ts',
      'Mcp': 'src/tools/mcp.ts',
      'NotebookEdit': 'src/tools/notebook.ts',
      'ReadMcpResource': 'src/tools/mcp.ts',
      'TodoWrite': 'src/tools/todo.ts',
      'WebFetch': 'src/tools/web.ts',
      'WebSearch': 'src/tools/web.ts',
      'AskUserQuestion': 'src/tools/ask.ts',
    };

    const filePath = toolFileMap[toolName];
    if (!filePath) return null;

    const fullPath = path.join(this.projectRoot, filePath);
    if (!fs.existsSync(fullPath)) return null;

    const content = fs.readFileSync(fullPath, 'utf8');

    // 尝试从 Zod schema 中提取
    const zodSchema = this.extractZodSchema(content, toolName);
    if (zodSchema) return zodSchema;

    // 尝试从 inputSchema 对象中提取
    const inputSchema = this.extractInputSchema(content, toolName);
    if (inputSchema) return inputSchema;

    return null;
  }

  private extractZodSchema(content: string, toolName: string): ToolSchema | null {
    // 查找 z.object({ ... }) 模式
    const patterns = [
      new RegExp(`${toolName}.*?=\\s*z\\.object\\(\\{([^}]+)\\}\\)`, 's'),
      /inputSchema\s*=\s*z\.object\(\{([^}]+)\}\)/s,
      /schema\s*=\s*z\.object\(\{([^}]+)\}\)/s,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        const schemaBody = match[1];
        const fields = this.parseZodFields(schemaBody);
        if (fields.length > 0) {
          return { name: toolName, fields };
        }
      }
    }

    return null;
  }

  private parseZodFields(body: string): SchemaField[] {
    const fields: SchemaField[] = [];

    // 匹配 field: z.type() 模式
    const fieldPattern = /(\w+):\s*z\.(\w+)\(\)/g;
    let match;

    while ((match = fieldPattern.exec(body)) !== null) {
      fields.push({
        name: match[1],
        type: match[2],
        required: !body.includes(`${match[1]}: z.${match[2]}().optional()`),
      });
    }

    return fields;
  }

  private extractInputSchema(content: string, toolName: string): ToolSchema | null {
    // 查找 inputSchema: { properties: { ... } } 模式
    const pattern = /inputSchema\s*[:=]\s*\{[^}]*properties\s*:\s*\{([^}]+)\}/s;
    const match = content.match(pattern);

    if (!match) return null;

    const propertiesBody = match[1];
    const fields: SchemaField[] = [];

    // 匹配 field: { type: "..." } 模式
    const fieldPattern = /(\w+)\s*:\s*\{[^}]*type\s*:\s*["'](\w+)["']/g;
    let fieldMatch;

    while ((fieldMatch = fieldPattern.exec(propertiesBody)) !== null) {
      fields.push({
        name: fieldMatch[1],
        type: fieldMatch[2],
        required: true, // 简化处理
      });
    }

    return fields.length > 0 ? { name: toolName, fields } : null;
  }

  private compareSchemas(official: ToolSchema, project: ToolSchema) {
    const officialFields = new Map(official.fields.map(f => [f.name, f]));
    const projectFields = new Map(project.fields.map(f => [f.name, f]));

    const missing: string[] = [];
    const extra: string[] = [];
    const typeMismatch: string[] = [];

    // 查找缺失的字段
    for (const [name, field] of officialFields) {
      if (!projectFields.has(name)) {
        missing.push(name);
      } else {
        const pField = projectFields.get(name)!;
        // 简单的类型比较（可以更精确）
        if (field.type.toLowerCase() !== pField.type.toLowerCase() &&
            !field.type.includes(pField.type) &&
            !pField.type.includes(field.type)) {
          typeMismatch.push(`${name}: 官方=${field.type}, 项目=${pField.type}`);
        }
      }
    }

    // 查找额外的字段
    for (const [name] of projectFields) {
      if (!officialFields.has(name)) {
        extra.push(name);
      }
    }

    if (missing.length > 0 || extra.length > 0 || typeMismatch.length > 0) {
      console.log('\n⚠️ 差异:');
      if (missing.length > 0) {
        console.log(`   缺失字段: ${missing.join(', ')}`);
      }
      if (extra.length > 0) {
        console.log(`   额外字段: ${extra.join(', ')}`);
      }
      if (typeMismatch.length > 0) {
        console.log(`   类型不匹配: ${typeMismatch.join(', ')}`);
      }
    } else {
      console.log('\n✅ Schema 一致');
    }
  }

  private async generateReport(schemas: ToolSchema[]) {
    const reportPath = path.join(this.projectRoot, 'SCHEMA_COMPARISON.md');

    let content = `# 工具 Schema 对比报告

**生成时间**: ${new Date().toISOString()}

## 官方工具 Schema

`;

    for (const schema of schemas) {
      content += `### ${schema.name}\n\n`;
      content += '| 字段 | 类型 | 必填 | 描述 |\n';
      content += '|------|------|------|------|\n';

      for (const field of schema.fields) {
        const desc = field.description ? field.description.substring(0, 50) + '...' : '-';
        content += `| ${field.name} | \`${field.type}\` | ${field.required ? '✓' : '✗'} | ${desc} |\n`;
      }

      content += '\n';
    }

    fs.writeFileSync(reportPath, content);
    console.log(`\n💾 Schema 对比报告已保存: ${reportPath}`);
  }
}

// 运行
const comparator = new SchemaComparator(process.cwd());
comparator.run().catch(console.error);
