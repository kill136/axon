/**
 * PostCompact Hook 集成测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PostCompactExecutor,
  createDefaultPostCompactExecutor,
  type PostCompactInput,
  type HookExecutor,
} from './post-compact-integration.js';
import type { HookInput, HookResult } from '../hooks/index.js';

describe('PostCompactExecutor', () => {
  let executor: PostCompactExecutor;
  let mockHookExecutor: HookExecutor;

  beforeEach(() => {
    // Mock Hook 执行器
    mockHookExecutor = {
      executeHook: vi.fn(async (input: HookInput): Promise<HookResult> => ({
        success: true,
        output: JSON.stringify({
          event: input.event,
          status: 'executed',
        }),
      })),
    };

    executor = new PostCompactExecutor(mockHookExecutor);
  });

  describe('基本功能', () => {
    it('应该执行 PostCompact 事件并返回结果', async () => {
      const input: PostCompactInput = {
        originalTokens: 10000,
        compressedTokens: 5000,
      };

      const result = await executor.execute(input);

      expect(result.success).toBe(true);
      expect(result.hookSuccess).toBe(true);
      expect(result.originalTokens).toBe(10000);
      expect(result.compressedTokens).toBe(5000);
      expect(result.compressionRatio).toBeCloseTo(0.5);
      expect(result.savedTokens).toBe(5000);
      expect(result.timestamp).toBeDefined();
    });

    it('应该计算正确的压缩比', async () => {
      const input: PostCompactInput = {
        originalTokens: 100,
        compressedTokens: 75,
      };

      const result = await executor.execute(input);

      expect(result.compressionRatio).toBeCloseTo(0.75);
      expect(result.savedTokens).toBe(25);
    });

    it('应该使用提供的 compressionRatio', async () => {
      const input: PostCompactInput = {
        originalTokens: 100,
        compressedTokens: 50,
        compressionRatio: 0.6, // 显式提供的值（与计算值不同）
      };

      const result = await executor.execute(input);

      expect(result.compressionRatio).toBe(0.6);
    });

    it('应该处理零压缩', async () => {
      const input: PostCompactInput = {
        originalTokens: 100,
        compressedTokens: 100,
      };

      const result = await executor.execute(input);

      expect(result.compressionRatio).toBe(1);
      expect(result.savedTokens).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe('Hook 执行', () => {
    it('应该调用 Hook 执行器', async () => {
      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      await executor.execute(input);

      expect(mockHookExecutor.executeHook).toHaveBeenCalled();
      const callArgs = (mockHookExecutor.executeHook as any).mock.calls[0];
      expect(callArgs[0].event).toBe('PostCompact');
      expect(callArgs[0].originalTokens).toBe(1000);
      expect(callArgs[0].compressedTokens).toBe(500);
    });

    it('应该在 Hook 失败时记录错误', async () => {
      const errorExecutor = {
        executeHook: vi.fn(async (): Promise<HookResult> => ({
          success: false,
          error: 'Hook execution failed',
        })),
      };

      const executor2 = new PostCompactExecutor(errorExecutor);

      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      const result = await executor2.execute(input);

      expect(result.hookSuccess).toBe(false);
      expect(result.hookError).toBe('Hook execution failed');
      expect(result.success).toBe(true); // 主流程不受影响
    });

    it('应该捕获 Hook 执行异常', async () => {
      const errorExecutor = {
        executeHook: vi.fn(async (): Promise<HookResult> => {
          throw new Error('Hook crashed');
        }),
      };

      const executor2 = new PostCompactExecutor(errorExecutor);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      const result = await executor2.execute(input);

      expect(result.hookSuccess).toBe(false);
      expect(result.hookError).toBe('Hook crashed');

      consoleSpy.mockRestore();
    });
  });

  describe('压缩阈值', () => {
    it('应该检查压缩阈值并跳过不足的压缩', async () => {
      const executor2 = new PostCompactExecutor(mockHookExecutor, { compressionThreshold: 0.3 });

      const input: PostCompactInput = {
        originalTokens: 100,
        compressedTokens: 90, // 压缩率 0.9，大于阈值 0.3，所以会跳过
      };

      const result = await executor2.execute(input);

      // 注意：compressionThreshold 表示跳过的比例
      // 如果 ratio > threshold 则跳过（压缩不足）
      // 90/100 = 0.9 > 0.3，所以跳过 Hook 触发
      expect(mockHookExecutor.executeHook).not.toHaveBeenCalled();
      expect(result.hookSuccess).toBe(true);
      expect(result.hookOutput).toBeUndefined();
    });

    it('应该在压缩充足时执行 Hook', async () => {
      const executor2 = new PostCompactExecutor(mockHookExecutor, { compressionThreshold: 0.3 });

      const input: PostCompactInput = {
        originalTokens: 100,
        compressedTokens: 20, // 压缩率 0.2，小于等于阈值 0.3，所以执行 Hook
      };

      const result = await executor2.execute(input);

      // 压缩充足，执行 Hook
      expect(mockHookExecutor.executeHook).toHaveBeenCalled();
      expect(result.hookSuccess).toBe(true);
    });
  });

  describe('日志功能', () => {
    it('应该在启用日志时记录统计信息', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const executor2 = new PostCompactExecutor(mockHookExecutor, { logStats: true });

      const input: PostCompactInput = {
        originalTokens: 10000,
        compressedTokens: 5000,
      };

      await executor2.execute(input);

      expect(consoleSpy).toHaveBeenCalled();
      // 检查第一个参数（可能是字符串或对象）
      const calls = consoleSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toContain('PostCompact');

      consoleSpy.mockRestore();
    });

    it('应该在禁用日志时不记录', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const executor2 = new PostCompactExecutor(mockHookExecutor, { logStats: false });

      const input: PostCompactInput = {
        originalTokens: 10000,
        compressedTokens: 5000,
      };

      await executor2.execute(input);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('配置管理', () => {
    it('应该支持动态配置更新', () => {
      const initialConfig = executor.getConfig();
      expect(initialConfig.logStats).toBe(true);

      executor.updateConfig({ logStats: false });

      const updatedConfig = executor.getConfig();
      expect(updatedConfig.logStats).toBe(false);
    });

    it('应该保留未指定的配置', () => {
      executor.updateConfig({ logStats: false });

      const config = executor.getConfig();

      expect(config.logStats).toBe(false);
      expect(config.enabled).toBe(true); // 保留其他配置
      expect(config.timeout).toBe(30000);
    });

    it('应该获取当前配置副本', () => {
      executor.updateConfig({ logStats: false });
      const config1 = executor.getConfig();

      config1.logStats = true; // 修改副本

      const config2 = executor.getConfig();
      expect(config2.logStats).toBe(false); // 原配置未改变
    });
  });

  describe('延迟初始化', () => {
    it('应该支持延迟设置 Hook 执行器', async () => {
      const executor2 = new PostCompactExecutor(undefined, { logStats: false });

      executor2.setHookExecutor(mockHookExecutor);

      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      const result = await executor2.execute(input);

      expect(result.hookSuccess).toBe(true);
      expect(mockHookExecutor.executeHook).toHaveBeenCalled();
    });

    it('没有 Hook 执行器时应该仍能执行', async () => {
      const executor2 = new PostCompactExecutor(undefined, { logStats: false });

      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      const result = await executor2.execute(input);

      expect(result.success).toBe(true);
      expect(result.hookSuccess).toBe(true);
    });
  });

  describe('工厂函数', () => {
    it('createDefaultPostCompactExecutor 应该创建默认配置的执行器', () => {
      const executor2 = createDefaultPostCompactExecutor();

      const config = executor2.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.logStats).toBe(true);
      expect(config.timeout).toBe(30000);
    });

    it('应该接受可选的 Hook 执行器', () => {
      const executor2 = createDefaultPostCompactExecutor(mockHookExecutor);

      expect(executor2).toBeDefined();
    });
  });

  describe('会话 ID 处理', () => {
    it('应该在 Hook 输入中包含会话 ID', async () => {
      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
        sessionId: 'session-123',
      };

      await executor.execute(input);

      const callArgs = (mockHookExecutor.executeHook as any).mock.calls[0];
      expect(callArgs[0].sessionId).toBe('session-123');
    });

    it('应该处理缺失的会话 ID', async () => {
      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      const result = await executor.execute(input);

      expect(result.success).toBe(true);
    });
  });

  describe('摘要处理', () => {
    it('应该在 Hook 输入中包含摘要', async () => {
      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
        summary: 'Compression summary',
      };

      await executor.execute(input);

      const callArgs = (mockHookExecutor.executeHook as any).mock.calls[0];
      expect(callArgs[0].summary).toBe('Compression summary');
    });
  });

  describe('时间戳处理', () => {
    it('应该使用提供的时间戳', async () => {
      const customTime = new Date('2026-01-01T00:00:00Z');

      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
        timestamp: customTime,
      };

      const result = await executor.execute(input);

      expect(result.timestamp.getTime()).toBe(customTime.getTime());
    });

    it('应该在未提供时使用当前时间', async () => {
      const beforeTime = Date.now();

      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 500,
      };

      const result = await executor.execute(input);

      const afterTime = Date.now();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime);
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('边界情况', () => {
    it('应该处理非常小的压缩比', async () => {
      const input: PostCompactInput = {
        originalTokens: 1000000,
        compressedTokens: 1,
      };

      const result = await executor.execute(input);

      expect(result.compressionRatio).toBeCloseTo(0.000001);
      expect(result.savedTokens).toBe(999999);
      expect(result.success).toBe(true);
    });

    it('应该处理相同的 original 和 compressed 值', async () => {
      const input: PostCompactInput = {
        originalTokens: 1000,
        compressedTokens: 1000,
      };

      const result = await executor.execute(input);

      expect(result.compressionRatio).toBe(1);
      expect(result.savedTokens).toBe(0);
    });

    it('应该处理零 token 输入', async () => {
      const input: PostCompactInput = {
        originalTokens: 0,
        compressedTokens: 0,
      };

      const result = await executor.execute(input);

      expect(result.compressionRatio).toBe(1); // 0/0 时默认为 1
      expect(result.savedTokens).toBe(0);
    });
  });
});
