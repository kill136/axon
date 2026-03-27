/**
 * Elicitation Hook Handler
 * MCP 服务器请求用户输入前触发
 */

import { HookInput, HookResult } from '../index.js';
import { BaseHookHandler, HandlerConfig } from './base-handler.js';

/**
 * Elicitation Handler 配置
 */
export interface ElicitationHandlerConfig extends HandlerConfig {
  /** 是否使用浏览器表单 */
  useBrowser?: boolean;
  /** 表单超时（毫秒） */
  formTimeout?: number;
}

/**
 * Elicitation Hook Handler
 * 处理 MCP 服务器请求用户输入前的准备
 */
export class ElicitationHandler extends BaseHookHandler {
  private config: ElicitationHandlerConfig;

  constructor(config: ElicitationHandlerConfig = {}) {
    super({
      name: 'ElicitationHandler',
      timeout: 60000, // 60 seconds
      silent: true,
      ...config,
    });
    this.config = config;
  }

  async execute(input: HookInput): Promise<HookResult> {
    // 验证必要字段
    if (!input.mcpServer) {
      return {
        success: false,
        error: 'Elicitation requires mcpServer',
      };
    }

    // 收集输入字段信息
    const requiredFields = input.requiredFields || {};
    const fieldCount = Object.keys(requiredFields).length;

    // 如果有表单 URL，返回浏览器操作
    if (input.formUrl && this.config.useBrowser !== false) {
      return {
        success: true,
        output: JSON.stringify({
          action: 'open_browser',
          url: input.formUrl,
          fields: Object.keys(requiredFields),
          timeout: this.config.formTimeout || 600000,
        }),
      };
    }

    // 否则准备命令行表单
    return {
      success: true,
      output: JSON.stringify({
        action: 'show_form',
        mcp_server: input.mcpServer,
        required_fields: Object.keys(requiredFields),
        field_count: fieldCount,
        field_definitions: requiredFields,
      }),
    };
  }
}
