/**
 * 系统提示词模块
 * 实现动态生成、模块化组装、缓存优化
 */

export { SystemPromptBuilder, systemPromptBuilder } from './builder.js';
export { AttachmentManager, attachmentManager } from './attachments.js';
export {
  PromptTemplates,
  CORE_IDENTITY,
  PERMISSION_MODES,
  SECURITY_RULES,
  EXECUTING_WITH_CARE,
  PROACTIVE_SKILL_CREATION,
  getSystemSection,
  getCodingGuidelines,
  getToolGuidelines,
  getToneAndStyle,
  getMcpInstructions,
  getMcpCliInstructions,
  getOutputStylePrompt,
  getPastSessionsPrompt,
  getEnvironmentInfo,
} from './templates.js';
export { PromptCache, promptCache } from './cache.js';
export type {
  PromptContext,
  Attachment,
  AttachmentType,
  SystemPromptOptions,
  PromptHashInfo,
} from './types.js';
