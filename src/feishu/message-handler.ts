/**
 * 飞书消息处理器
 * 负责消息解析、触发检测、响应格式化
 */

import type { FeishuBotConfig } from './config.js';

/** 飞书 @提及信息 */
export interface FeishuMention {
  /** 占位符 key，如 "@_user_1" */
  key: string;
  /** 用户 open_id */
  id: {
    open_id?: string;
    union_id?: string;
    user_id?: string;
  };
  /** 显示名称 */
  name: string;
}

/**
 * 从飞书消息中提取用户实际输入
 * 移除 @提及 占位符，保留用户真正想说的内容
 */
export function extractUserInput(text: string, mentions?: FeishuMention[]): string {
  let cleaned = text;

  if (mentions && mentions.length > 0) {
    for (const mention of mentions) {
      // 移除 @_user_1 等占位符
      cleaned = cleaned.replace(mention.key, '');
    }
  }

  return cleaned.trim();
}

/**
 * 检查消息是否应该触发 Bot 响应
 */
export function shouldRespond(
  isGroup: boolean,
  isPrivate: boolean,
  isMentioned: boolean,
  config: FeishuBotConfig,
): boolean {
  // 私聊
  if (isPrivate) {
    return config.respondToPrivate;
  }

  // 群聊：只有被 @提及 时才响应
  if (isGroup) {
    return config.respondToMention && isMentioned;
  }

  return false;
}

/**
 * 格式化 Claude 响应为飞书友好格式
 * 飞书对 Markdown 支持较好，保留大部分格式
 */
export function formatResponse(text: string): string {
  let formatted = text;

  // 移除 HTML 标签
  formatted = formatted.replace(/<[^>]+>/g, '');

  // 压缩多余空行
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  return formatted.trim();
}

/**
 * 将长文本分割为多条消息
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = maxLength;

    // 优先在段落处分割
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.3) {
      splitIndex = paragraphBreak;
    } else {
      // 其次在换行处分割
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.3) {
        splitIndex = lineBreak;
      } else {
        // 最后在句子结束处分割
        const sentenceEnd = remaining.lastIndexOf('。', maxLength);
        if (sentenceEnd > maxLength * 0.3) {
          splitIndex = sentenceEnd + 1;
        }
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

/**
 * 内置命令处理
 * @returns 命令响应文本，null 表示不是内置命令
 */
export function handleBuiltinCommand(text: string): string | null {
  const cmd = text.trim().toLowerCase();

  if (cmd === '/help' || cmd === '帮助') {
    return [
      'Claude Code 飞书助手',
      '',
      '可用命令:',
      '  /help 或 帮助 - 显示此帮助',
      '  /reset 或 重置 - 清除对话历史',
      '  /status 或 状态 - 查看当前状态',
      '',
      '使用方式:',
      '  群聊中 @我 + 你的问题',
      '  私聊直接发消息即可',
    ].join('\n');
  }

  if (cmd === '/status' || cmd === '状态') {
    return '状态查询已触发';
  }

  if (cmd === '/reset' || cmd === '重置') {
    return '__RESET_SESSION__';
  }

  return null;
}
