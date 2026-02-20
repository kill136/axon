/**
 * Structured Output 工具
 * v2.1.29: 用于非交互模式 (-p) 的结构化输出验证
 *
 * 对应官方 vH6 函数和 EXA/ZD 工具定义
 */

import AjvModule from 'ajv';
import type { ValidateFunction } from 'ajv';
import * as fs from 'fs';
import * as path from 'path';

// ESM 兼容：处理 default 导出
const Ajv = (AjvModule as any).default || AjvModule;
import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import { t } from '../i18n/index.js';

// 工具名称常量
export const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput';

/**
 * JSON Schema 类型定义
 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JSONSchema;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  allOf?: JSONSchema[];
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  definitions?: Record<string, JSONSchema>;
  [key: string]: any;
}

/**
 * Structured Output 工具输入
 */
export interface StructuredOutputInput {
  [key: string]: any;
}

/**
 * Structured Output 工具配置
 */
export interface StructuredOutputToolConfig {
  /** JSON Schema 定义 */
  schema: JSONSchema;
  /** 工具名称（可选，默认为 StructuredOutput） */
  name?: string;
  /** 工具描述（可选） */
  description?: string;
}

/**
 * v2.1.29: 验证 JSON Schema 并创建 Structured Output 工具
 * 对应官方 vH6 函数
 *
 * @param schema JSON Schema 定义
 * @returns StructuredOutput 工具实例，如果 schema 无效则返回 null
 */
export function createStructuredOutputTool(schema: JSONSchema): StructuredOutputTool | null {
  try {
    const ajv = new Ajv({ allErrors: true });

    // 验证 schema 是否有效
    if (!ajv.validateSchema(schema)) {
      console.error(`Invalid JSON Schema: ${ajv.errorsText(ajv.errors)}`);
      return null;
    }

    // 编译 schema
    const validate = ajv.compile(schema);

    return new StructuredOutputTool(schema, validate);
  } catch (error) {
    console.error('Failed to create StructuredOutput tool:', error);
    return null;
  }
}

/**
 * v2.1.29: Structured Output 工具
 * 对应官方 EXA 工具定义
 *
 * 此工具用于验证 AI 的输出是否符合指定的 JSON Schema
 */
export class StructuredOutputTool extends BaseTool<StructuredOutputInput> {
  name = STRUCTURED_OUTPUT_TOOL_NAME;
  description = 'Provide structured output that matches the required JSON schema. Use this tool to return your response in the required format.';

  private schema: JSONSchema;
  private validate: ValidateFunction;

  constructor(schema: JSONSchema, validate: ValidateFunction) {
    super();
    this.schema = schema;
    this.validate = validate;
  }

  getInputSchema(): ToolDefinition['inputSchema'] {
    // 使用用户提供的 JSON Schema 作为输入 schema
    return this.schema as ToolDefinition['inputSchema'];
  }

  async execute(input: StructuredOutputInput): Promise<ToolResult> {
    // 验证输入是否符合 schema
    if (!this.validate(input)) {
      const errors = this.validate.errors?.map(e =>
        `${e.instancePath || 'root'}: ${e.message}`
      ).join(', ');

      return {
        success: false,
        error: t('structuredOutput.schemaError', { errors }),
      };
    }

    // 验证通过，返回成功结果
    // 官方实现返回 { data: "...", structured_output: z }
    return {
      success: true,
      output: t('structuredOutput.success'),
      // 附加验证后的数据
      data: input,
    };
  }

  /**
   * 获取原始 schema
   */
  getSchema(): JSONSchema {
    return this.schema;
  }
}

/**
 * v2.1.29: 解析 JSON Schema 字符串
 *
 * @param schemaStr JSON Schema 字符串（可以是 JSON 字符串或文件路径）
 * @returns 解析后的 JSON Schema，如果解析失败则返回 null
 */
export function parseJsonSchema(schemaStr: string): JSONSchema | null {
  try {
    // 首先尝试直接解析为 JSON
    return JSON.parse(schemaStr);
  } catch {
    // 如果解析失败，可能是文件路径
    try {
      const resolvedPath = path.resolve(schemaStr);

      if (fs.existsSync(resolvedPath)) {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch {
      // 忽略文件读取错误
    }

    console.error('Failed to parse JSON Schema: invalid JSON string or file path');
    return null;
  }
}

export default StructuredOutputTool;
