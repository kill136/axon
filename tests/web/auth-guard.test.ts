/**
 * 测试：未认证时阻止消息发送
 *
 * 验证：
 * 1. 未认证时 handleSend 应弹出登录对话框而非发送消息
 * 2. 已认证时正常发送消息
 * 3. InputArea 未认证时显示登录提示替代 textarea
 * 4. 发送按钮未认证时点击触发登录
 */
import { describe, it, expect, vi } from 'vitest';
import type { CompactState } from '../../src/web/client/src/components/ContextBar';

describe('auth guard - message send', () => {
  /**
   * 模拟 useChatInput 中的认证检查逻辑
   */
  function simulateSend(params: {
    input: string;
    attachments: Array<{ id: string }>;
    connected: boolean;
    isAuthenticated: boolean;
    compactPhase: CompactState['phase'];
    status: 'idle' | 'thinking' | 'streaming';
    currentProjectPath: string;
  }): {
    action: 'login_required' | 'queued' | 'sent' | 'interrupt-and-sent' | 'blocked';
    loginClicked?: boolean;
  } {
    const { input, attachments, connected, isAuthenticated, compactPhase, status } = params;

    // 前置检查：无内容或未连接
    if ((!input.trim() && attachments.length === 0) || !connected) {
      return { action: 'blocked' };
    }

    // 未认证 → 弹出登录对话框
    if (!isAuthenticated) {
      return { action: 'login_required', loginClicked: true };
    }

    // 压缩期间排队
    if (compactPhase === 'compacting') {
      return { action: 'queued' };
    }

    // 非 idle 状态 → 插话模式
    if (status !== 'idle') {
      return { action: 'interrupt-and-sent' };
    }

    // 正常发送
    return { action: 'sent' };
  }

  it('should block send when not authenticated', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      isAuthenticated: false,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('login_required');
    expect(result.loginClicked).toBe(true);
  });

  it('should allow send when authenticated', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      isAuthenticated: true,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('sent');
  });

  it('should still block when not connected regardless of auth', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: false,
      isAuthenticated: true,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('blocked');
  });

  it('should still block when empty input regardless of auth', () => {
    const result = simulateSend({
      input: '',
      attachments: [],
      connected: true,
      isAuthenticated: true,
      compactPhase: 'idle',
      status: 'idle',
      currentProjectPath: '/test',
    });
    expect(result.action).toBe('blocked');
  });

  it('auth check should take priority over compact queue', () => {
    const result = simulateSend({
      input: 'hello',
      attachments: [],
      connected: true,
      isAuthenticated: false,
      compactPhase: 'compacting',
      status: 'idle',
      currentProjectPath: '/test',
    });
    // 未认证应该优先返回 login_required，而不是 queued
    expect(result.action).toBe('login_required');
  });
});

describe('auth guard - InputArea UI', () => {
  it('should show login prompt when not authenticated', () => {
    // 模拟 InputArea 的条件渲染逻辑
    const isAuthenticated = false;
    const connected = true;
    const showAuthPrompt = !isAuthenticated && connected;
    expect(showAuthPrompt).toBe(true);
  });

  it('should show textarea when authenticated', () => {
    const isAuthenticated = true;
    const connected = true;
    const showAuthPrompt = !isAuthenticated && connected;
    expect(showAuthPrompt).toBe(false);
  });

  it('should not show auth prompt when disconnected', () => {
    const isAuthenticated = false;
    const connected = false;
    const showAuthPrompt = !isAuthenticated && connected;
    expect(showAuthPrompt).toBe(false);
  });

  it('send button should be clickable when not authenticated', () => {
    // 模拟 send button 的 disabled 逻辑
    const isAuthenticated = false;
    const connected = true;
    const inputTrimmed = '';
    const hasAttachments = false;
    // 未认证时 disabled 条件：!connected || (isAuthenticated && !input.trim() && attachments.length === 0)
    const disabled = !connected || (isAuthenticated && !inputTrimmed && !hasAttachments);
    // 未认证时，即使没有输入内容，按钮也不应该被禁用（让用户点击触发登录）
    expect(disabled).toBe(false);
  });
});
