/**
 * 微信消息处理器
 * 负责消息解析、触发检测、响应格式化
 */

import type { WeChatBotConfig } from './config.js';

/**
 * 从群聊消息中提取用户实际输入
 * 移除 @提及 部分，保留用户真正想说的内容
 */
export function extractUserInput(text: string, botName: string): string {
  // 移除 @bot 的提及（微信格式：@BotName 消息内容）
  // 处理各种格式：@BotName\u2005消息、@BotName 消息、@BotName\n消息
  let cleaned = text;

  // 移除 @botName（包含特殊空格字符 \u2005、\u00a0 等）
  const mentionPatterns = [
    new RegExp(`@${escapeRegex(botName)}[\\s\\u2005\\u00a0]*`, 'gi'),
    new RegExp(`@${escapeRegex(botName)}`, 'gi'),
  ];

  for (const pattern of mentionPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  return cleaned.trim();
}

/**
 * 检查消息是否应该触发 Bot 响应
 */
export function shouldRespond(
  text: string,
  isMentioned: boolean,
  isRoom: boolean,
  isPrivate: boolean,
  config: WeChatBotConfig,
): boolean {
  // 私聊
  if (isPrivate && !isRoom) {
    return config.respondToPrivate;
  }

  // 群聊
  if (isRoom) {
    // 关键词触发
    if (config.triggerKeyword && text.startsWith(config.triggerKeyword)) {
      return true;
    }
    // @提及触发
    if (config.respondToMention && isMentioned) {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * 从消息中移除触发关键词
 */
export function removeTriggerKeyword(text: string, keyword: string): string {
  if (keyword && text.startsWith(keyword)) {
    return text.slice(keyword.length).trim();
  }
  return text;
}

/**
 * 格式化 Claude 响应为微信友好格式
 * - 简化 Markdown
 * - 处理代码块
 * - 控制长度
 */
export function formatResponse(text: string): string {
  let formatted = text;

  // 保留代码块但简化标记
  // ```lang\ncode\n``` -> 【代码】\ncode
  formatted = formatted.replace(/```\w*\n([\s\S]*?)```/g, (_match, code: string) => {
    return `「代码」\n${code.trim()}`;
  });

  // 内联代码保留反引号
  // `code` 保持不变

  // 移除 HTML 标签
  formatted = formatted.replace(/<[^>]+>/g, '');

  // 简化标题标记
  // ### Title -> 【Title】
  formatted = formatted.replace(/^#{1,6}\s+(.+)$/gm, '【$1】');

  // 简化粗体
  // **text** -> text
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '$1');

  // 简化斜体
  // *text* -> text
  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');

  // 简化链接
  // [text](url) -> text (url)
  formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // 移除水平线
  formatted = formatted.replace(/^[-*_]{3,}$/gm, '');

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

    // 尝试在自然断点处分割
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
      '🤖 Claude Code 微信助手',
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
    return '状态查询已触发'; // 实际状态由 bot.ts 填充
  }

  if (cmd === '/reset' || cmd === '重置') {
    return '__RESET_SESSION__'; // 特殊标记，由 bot.ts 处理
  }

  return null;
}

// 工具函数
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
