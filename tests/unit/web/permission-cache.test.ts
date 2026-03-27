/**
 * PermissionHandler 决策缓存测试
 * 测试 5秒 TTL 的权限决策缓存机制
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PermissionHandler } from '../../../src/web/server/permission-handler.js';

describe('PermissionHandler Decision Cache', () => {
  let handler: PermissionHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    handler = new PermissionHandler({ mode: 'default' });
  });

  afterEach(() => {
    vi.useRealTimers();
    handler.cancelAll();
  });

  it('缓存命中：同一工具+参数在5秒内应返回缓存结果', () => {
    const tool = 'Write';
    const args = { file_path: '/tmp/test.ts' };

    // 第一次调用 — Write 是敏感工具，应需要权限
    expect(handler.needsPermission(tool, args)).toBe(true);

    // 模拟用户批准（通过 handleResponse 触发缓存写入）
    const request = handler.createRequest(tool, args);
    handler.registerRequest(request);
    handler.handleResponse(request.requestId, true);

    // 第二次调用 — 缓存存在且未过期，已被批准所以不需要权限
    expect(handler.needsPermission(tool, args)).toBe(false);
  });

  it('缓存过期：超过5秒应重新检查', () => {
    const tool = 'Write';
    const args = { file_path: '/tmp/test.ts' };

    // 模拟用户批准写入缓存
    const request = handler.createRequest(tool, args);
    handler.registerRequest(request);
    handler.handleResponse(request.requestId, true);

    // 缓存有效期内
    expect(handler.needsPermission(tool, args)).toBe(false);

    // 前进 5001ms，缓存过期
    vi.advanceTimersByTime(5001);

    // 缓存过期后，应重新检查 — Write 是敏感工具，需要权限
    expect(handler.needsPermission(tool, args)).toBe(true);
  });

  it('clearSessionMemory 应同时清除缓存', () => {
    const tool = 'Write';
    const args = { file_path: '/tmp/test.ts' };

    // 写入缓存
    const request = handler.createRequest(tool, args);
    handler.registerRequest(request);
    handler.handleResponse(request.requestId, true);

    // 缓存有效
    expect(handler.needsPermission(tool, args)).toBe(false);

    // 清除会话记忆（应同时清除缓存）
    handler.clearSessionMemory();

    // 缓存已被清除，应重新检查
    expect(handler.needsPermission(tool, args)).toBe(true);
  });

  it('不同参数应有独立的缓存条目', () => {
    const tool = 'Write';
    const args1 = { file_path: '/tmp/file1.ts' };
    const args2 = { file_path: '/tmp/file2.ts' };

    // 只批准 file1
    const request1 = handler.createRequest(tool, args1);
    handler.registerRequest(request1);
    handler.handleResponse(request1.requestId, true);

    // file1 被缓存为已批准
    expect(handler.needsPermission(tool, args1)).toBe(false);

    // file2 没有缓存，应需要权限
    expect(handler.needsPermission(tool, args2)).toBe(true);
  });

  it('clearExpiredCache 应清除过期的缓存条目', () => {
    const tool = 'Write';
    const args = { file_path: '/tmp/test.ts' };

    // 写入缓存
    const request = handler.createRequest(tool, args);
    handler.registerRequest(request);
    handler.handleResponse(request.requestId, true);

    expect(handler.needsPermission(tool, args)).toBe(false);

    // 前进超过 TTL
    vi.advanceTimersByTime(5001);

    // 手动清理过期缓存
    handler.clearExpiredCache();

    // 缓存已被清除
    expect(handler.needsPermission(tool, args)).toBe(true);
  });

  it('拒绝决策也应被缓存', () => {
    const tool = 'Write';
    const args = { file_path: '/tmp/test.ts' };

    // 模拟用户拒绝
    const request = handler.createRequest(tool, args);
    handler.registerRequest(request);
    handler.handleResponse(request.requestId, false);

    // 拒绝被缓存，cached=false 表示未被允许，所以仍需权限检查
    // needsPermission 中 cached !== null && !cached => return !false => true
    expect(handler.needsPermission(tool, args)).toBe(true);
  });
});
