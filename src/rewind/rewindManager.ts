/**
 * Rewind 管理器
 *
 * 协调文件历史和对话状态的回退
 */

import type { Message } from '../types/index.js';
import { FileHistoryManager, getFileHistoryManager, type RewindResult } from './fileHistory.js';

// Rewind 选项
export type RewindOption = 'code' | 'conversation' | 'both' | 'nevermind';

// 可回退的消息信息
export interface RewindableMessage {
  uuid: string;
  index: number;
  role: 'user' | 'assistant';
  preview: string;
  timestamp?: number;
  hasFileChanges: boolean;
}

// Rewind 操作结果
export interface RewindOperationResult {
  success: boolean;
  option: RewindOption;
  codeResult?: RewindResult;
  conversationResult?: {
    messagesRemoved: number;
    newMessageCount: number;
  };
  error?: string;
}

/**
 * Rewind 管理器
 */
export class RewindManager {
  private fileHistoryManager: FileHistoryManager;
  private messages: Message[] = [];
  private onMessagesChange?: (messages: Message[]) => void;

  constructor(sessionId: string) {
    this.fileHistoryManager = getFileHistoryManager(sessionId);
  }

  /**
   * 设置消息数组和变更回调
   */
  setMessages(messages: Message[], onChange?: (messages: Message[]) => void): void {
    this.messages = messages;
    this.onMessagesChange = onChange;
  }

  /**
   * 获取文件历史管理器
   */
  getFileHistoryManager(): FileHistoryManager {
    return this.fileHistoryManager;
  }

  /**
   * 记录用户消息（创建快照点）
   */
  recordUserMessage(messageId: string): void {
    this.fileHistoryManager.createSnapshot(messageId);
  }

  /**
   * 记录文件修改（在工具执行前调用）
   */
  recordFileChange(filePath: string): void {
    this.fileHistoryManager.backupFileBeforeChange(filePath);
    this.fileHistoryManager.trackFile(filePath);
  }

  /**
   * 获取可回退的消息列表
   */
  getRewindableMessages(): RewindableMessage[] {
    const rewindable: RewindableMessage[] = [];

    for (let i = 0; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg.role !== 'user') continue;

      // 获取消息预览
      const preview = this.getMessagePreview(msg);

      // 检查是否有关联的文件快照
      const uuid = (msg as any).uuid || `msg-${i}`;
      const hasFileChanges = this.fileHistoryManager.hasSnapshot(uuid);

      rewindable.push({
        uuid,
        index: i,
        role: 'user',
        preview,
        timestamp: (msg as any).timestamp,
        hasFileChanges,
      });
    }

    return rewindable;
  }

  /**
   * 执行回退操作
   */
  async rewind(messageId: string, option: RewindOption): Promise<RewindOperationResult> {
    if (option === 'nevermind') {
      return { success: true, option };
    }

    const result: RewindOperationResult = { success: true, option };

    // 回退代码
    if (option === 'code' || option === 'both') {
      const codeResult = this.rewindCode(messageId);
      result.codeResult = codeResult;
      if (!codeResult.success) {
        result.success = false;
        result.error = codeResult.error;
      }
    }

    // 回退对话
    if (option === 'conversation' || option === 'both') {
      const convResult = this.rewindConversation(messageId);
      result.conversationResult = convResult;
      if (convResult.messagesRemoved < 0) {
        result.success = false;
        result.error = 'Failed to rewind conversation';
      }
    }

    return result;
  }

  /**
   * 回退代码到指定消息状态
   */
  private rewindCode(messageId: string): RewindResult {
    return this.fileHistoryManager.rewindToMessage(messageId);
  }

  /**
   * 回退对话到指定消息状态
   * 注意：会删除包括指定消息在内的所有后续消息（回到该消息发送之前的状态）
   */
  private rewindConversation(messageId: string): { messagesRemoved: number; newMessageCount: number } {
    // 找到消息索引（兼容 uuid 和 id 两种字段）
    const index = this.messages.findIndex(m => (m as any).uuid === messageId || (m as any).id === messageId);
    if (index < 0) {
      return { messagesRemoved: -1, newMessageCount: this.messages.length };
    }

    // 保留该消息之前的所有消息（不包括该消息本身）
    // 这样用户可以"撤回"刚发送的消息
    const originalCount = this.messages.length;
    const newMessages = this.messages.slice(0, index);
    const messagesRemoved = originalCount - newMessages.length;

    // 更新消息数组
    this.messages = newMessages;

    // 触发回调
    if (this.onMessagesChange) {
      this.onMessagesChange(newMessages);
    }

    return {
      messagesRemoved,
      newMessageCount: newMessages.length,
    };
  }

  /**
   * 预览回退操作（不实际执行）
   */
  previewRewind(messageId: string, option: RewindOption): {
    filesWillChange: string[];
    messagesWillRemove: number;
    insertions: number;
    deletions: number;
  } {
    let filesWillChange: string[] = [];
    let insertions = 0;
    let deletions = 0;
    let messagesWillRemove = 0;

    // 预览代码回退
    if (option === 'code' || option === 'both') {
      const codeResult = this.fileHistoryManager.rewindToMessage(messageId, true);
      filesWillChange = codeResult.filesChanged;
      insertions = codeResult.insertions;
      deletions = codeResult.deletions;
    }

    // 预览对话回退
    if (option === 'conversation' || option === 'both') {
      const index = this.messages.findIndex(m => (m as any).uuid === messageId || (m as any).id === messageId);
      if (index >= 0) {
        messagesWillRemove = this.messages.length - index;
      }
    }

    return { filesWillChange, messagesWillRemove, insertions, deletions };
  }

  /**
   * 获取消息预览文本
   */
  private getMessagePreview(msg: Message): string {
    if (typeof msg.content === 'string') {
      return msg.content.slice(0, 60) + (msg.content.length > 60 ? '...' : '');
    }

    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          return block.text.slice(0, 60) + (block.text.length > 60 ? '...' : '');
        }
      }
    }

    return '(No preview available)';
  }

  /**
   * 检查是否可以回退
   */
  canRewind(): boolean {
    return this.messages.length > 0 && this.getRewindableMessages().length > 0;
  }

  /**
   * 获取最后一个可回退点
   */
  getLastRewindPoint(): RewindableMessage | null {
    const rewindable = this.getRewindableMessages();
    return rewindable.length > 0 ? rewindable[rewindable.length - 1] : null;
  }
}

// 全局实例缓存
const managers = new Map<string, RewindManager>();

/**
 * 获取或创建 Rewind 管理器
 */
export function getRewindManager(sessionId: string): RewindManager {
  if (!managers.has(sessionId)) {
    managers.set(sessionId, new RewindManager(sessionId));
  }
  return managers.get(sessionId)!;
}

/**
 * 清理指定会话的 Rewind 管理器
 */
export function cleanupRewindManager(sessionId: string): void {
  managers.delete(sessionId);
}
