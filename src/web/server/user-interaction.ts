/**
 * 用户交互处理器
 * 处理 AI 向用户提问并等待回答
 */

import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import type { QuestionOption, UserQuestionPayload } from '../shared/types.js';
import { getCmuxBridge } from '../../notifications/cmux.js';

/**
 * 待处理的问题
 */
interface PendingQuestion {
  requestId: string;
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeoutId?: NodeJS.Timeout;
  payload: UserQuestionPayload; // 保存原始 payload，用于会话切换时重发
}

/**
 * 问题配置
 */
export interface QuestionConfig {
  question: string;
  header: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  timeout?: number; // 超时时间（毫秒）
}

/**
 * 用户交互处理器
 */
export class UserInteractionHandler {
  private pendingQuestions = new Map<string, PendingQuestion>();
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;

  /**
   * 设置 WebSocket 连接
   */
  setWebSocket(ws: WebSocket): void {
    this.ws = ws;
  }

  /**
   * 设置会话 ID（用于消息中携带 sessionId，让前端正确做跨会话隔离）
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * 发送问题给用户并等待回答
   */
  async askQuestion(config: QuestionConfig): Promise<string> {
    if (!this.ws || this.ws.readyState !== 1 /* WebSocket.OPEN */) {
      throw new Error('WebSocket connection unavailable');
    }

    const requestId = randomUUID();

    return new Promise<string>((resolve, reject) => {
      // 构造 payload
      const payload: UserQuestionPayload = {
        requestId,
        question: config.question,
        header: config.header,
        options: config.options,
        multiSelect: config.multiSelect,
        timeout: config.timeout,
      };

      const pending: PendingQuestion = {
        requestId,
        resolve,
        reject,
        payload,
      };

      // 设置超时
      if (config.timeout && config.timeout > 0) {
        pending.timeoutId = setTimeout(() => {
          this.handleTimeout(requestId);
        }, config.timeout);
      }

      this.pendingQuestions.set(requestId, pending);

      try {
        this.ws!.send(JSON.stringify({
          type: 'user_question',
          payload: { ...payload, sessionId: this.sessionId },
        }));
        console.log(`[UserInteraction] Sending question: ${config.header} (${requestId}), session: ${this.sessionId}`);
        // cmux 集成：Agent 等待用户输入时通知 cmux 终端
        getCmuxBridge().onWaitingForInput(config.question);
      } catch (error) {
        this.cleanup(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * 处理用户回答
   */
  handleAnswer(requestId: string, answer: string): void {
    const pending = this.pendingQuestions.get(requestId);

    if (!pending) {
      console.warn(`[UserInteraction] Pending question not found: ${requestId}`);
      return;
    }

    console.log(`[UserInteraction] Received answer: ${requestId} -> ${answer}`);

    // 清理超时定时器
    this.cleanup(requestId);

    // 解析 Promise
    pending.resolve(answer);
  }

  /**
   * 处理超时
   */
  handleTimeout(requestId: string): void {
    const pending = this.pendingQuestions.get(requestId);

    if (!pending) {
      return;
    }

    console.warn(`[UserInteraction] Question timed out: ${requestId}`);

    // 清理
    this.cleanup(requestId);

    // 拒绝 Promise
    pending.reject(new Error('User answer timed out'));
  }

  /**
   * 清理待处理的问题
   */
  private cleanup(requestId: string): void {
    const pending = this.pendingQuestions.get(requestId);

    if (pending?.timeoutId) {
      clearTimeout(pending.timeoutId);
    }

    this.pendingQuestions.delete(requestId);
  }

  /**
   * 取消所有待处理的问题
   */
  cancelAll(): void {
    for (const [requestId, pending] of this.pendingQuestions) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error('Operation cancelled'));
    }
    this.pendingQuestions.clear();
  }

  /**
   * 获取待处理问题数量
   */
  getPendingCount(): number {
    return this.pendingQuestions.size;
  }

  /**
   * 获取所有待处理问题的 payload（用于会话切换时重发到前端）
   */
  getPendingPayloads(): UserQuestionPayload[] {
    return Array.from(this.pendingQuestions.values()).map(p => p.payload);
  }
}
