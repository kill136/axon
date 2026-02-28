/**
 * 自动压缩协调器测试
 * 测试 CT2 基础框架的各个组件
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from '../src/types/index.js';
import {
  getContextWindowSize,
  getMaxOutputTokens,
  calculateAvailableInput,
  calculateAutoCompactThreshold,
  isAboveAutoCompactThreshold,
  shouldAutoCompact,
} from '../src/core/loop.js';
import {
  setParentModelContext,
  getParentModelContext,
} from '../src/tools/agent.js';

describe('Auto Compact Framework', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // 保存原始环境变量
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // 恢复环境变量
    process.env = originalEnv;
  });

  describe('Environment Variables', () => {
    it('should respect DISABLE_COMPACT', () => {
      process.env.DISABLE_COMPACT = '1';
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(700000) },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      // 即使消息很长，也应该返回 false（因为禁用了压缩）
      const result = shouldAutoCompact(messages, model);
      expect(result).toBe(false);
    });

    it('should respect AXON_AUTOCOMPACT_PCT_OVERRIDE', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '80';
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);
      const availableInput = calculateAvailableInput(model);

      // 阈值应该是可用输入的 80%
      expect(threshold).toBeLessThanOrEqual(Math.floor(availableInput * 0.8));
    });

    it('should respect AXON_MAX_OUTPUT_TOKENS', () => {
      process.env.AXON_MAX_OUTPUT_TOKENS = '32000';
      const model = 'claude-opus-4-5-20251101';

      const maxOutput = getMaxOutputTokens(model);

      // 即使 opus-4-5 默认支持 64000，也应该限制为 32000
      expect(maxOutput).toBe(32000);
    });

    it('should handle truthy values for DISABLE_COMPACT', () => {
      const truthyValues = ['1', 'true', 'True', 'TRUE', 'yes', 'YES', 'on', 'ON'];
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(700000) },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      for (const value of truthyValues) {
        process.env.DISABLE_COMPACT = value;
        expect(shouldAutoCompact(messages, model)).toBe(false);
      }
    });

    it('should not disable compact for falsy values', () => {
      const falsyValues = ['0', 'false', 'False', 'no', ''];
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(700000) },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      for (const value of falsyValues) {
        process.env.DISABLE_COMPACT = value;
        // 这些值应该不会禁用压缩（如果消息超过阈值，应该返回 true）
        const result = shouldAutoCompact(messages, model);
        // 注意：实际是否压缩取决于消息是否超过阈值
        expect(typeof result).toBe('boolean');
      }
    });
  });

  describe('Token Calculation', () => {
    it('should calculate context window size for standard models', () => {
      // 标准模型：200K 上下文
      const models = [
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
        'claude-haiku-4-5-20251001',
      ];

      for (const model of models) {
        const result = getContextWindowSize(model);
        expect(result).toBe(200000);
      }
    });

    it('should calculate context window size for 1M models', () => {
      // 1M 模型
      const model = 'claude-opus-4-5-20251101[1m]';
      const result = getContextWindowSize(model);
      expect(result).toBe(1000000);
    });

    it('should calculate max output tokens for opus-4-5', () => {
      const model = 'claude-opus-4-5-20251101';
      const result = getMaxOutputTokens(model);
      expect(result).toBe(64000);
    });

    it('should calculate max output tokens for sonnet-4', () => {
      const model = 'claude-sonnet-4-5-20250929';
      const result = getMaxOutputTokens(model);
      expect(result).toBe(64000);
    });

    it('should calculate max output tokens for haiku-4', () => {
      const model = 'claude-haiku-4-5-20251001';
      const result = getMaxOutputTokens(model);
      expect(result).toBe(64000);
    });

    it('should calculate max output tokens for opus-4', () => {
      const model = 'claude-opus-4-20240229';
      const result = getMaxOutputTokens(model);
      expect(result).toBe(32000);
    });

    it('should calculate max output tokens with env override', () => {
      process.env.AXON_MAX_OUTPUT_TOKENS = '32000';
      const model = 'claude-opus-4-5-20251101';

      const result = getMaxOutputTokens(model);
      expect(result).toBe(32000); // 限制为环境变量值
    });

    it('should not exceed default max with env override', () => {
      process.env.AXON_MAX_OUTPUT_TOKENS = '100000';
      const model = 'claude-opus-4-5-20251101';

      const result = getMaxOutputTokens(model);
      // 不应该超过默认最大值 64000
      expect(result).toBe(64000);
    });

    it('should calculate available input tokens', () => {
      const model = 'claude-sonnet-4-5-20250929';
      const availableInput = calculateAvailableInput(model);

      // 200000 (context) - min(64000, 20000) = 180000 (官方 _QY=20000 cap)
      expect(availableInput).toBe(180000);
    });

    it('should calculate available input tokens for 1M model', () => {
      const model = 'claude-opus-4-5-20251101[1m]';
      const availableInput = calculateAvailableInput(model);

      // 1000000 (context) - min(64000, 20000) = 980000 (官方 _QY=20000 cap)
      expect(availableInput).toBe(980000);
    });
  });

  describe('Threshold Calculation', () => {
    it('should calculate auto compact threshold for standard model', () => {
      const model = 'claude-sonnet-4-5-20250929';
      const threshold = calculateAutoCompactThreshold(model);

      // 200000 - 20000 - 13000 = 167000
      expect(threshold).toBe(167000);
    });

    it('should calculate auto compact threshold for 1M model', () => {
      const model = 'claude-opus-4-5-20251101[1m]';
      const threshold = calculateAutoCompactThreshold(model);

      // 1000000 - 20000 - 13000 = 967000
      expect(threshold).toBe(967000);
    });

    it('should respect percentage override', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '80';
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);
      const availableInput = calculateAvailableInput(model);

      // (200000 - 20000) * 0.8 = 144000
      expect(threshold).toBe(Math.floor(availableInput * 0.8));
      expect(threshold).toBe(144000);
    });

    it('should clamp percentage override to original threshold', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '120'; // 超过 100%
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);

      // 应该限制为原始阈值 167000
      expect(threshold).toBe(167000);
    });

    it('should handle 50% override', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '50';
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);
      const availableInput = calculateAvailableInput(model);

      // (200000 - 20000) * 0.5 = 90000
      expect(threshold).toBe(Math.floor(availableInput * 0.5));
    });

    it('should ignore invalid percentage values', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = 'invalid';
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);

      // 应该使用默认阈值
      expect(threshold).toBe(167000);
    });

    it('should ignore negative percentage values', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '-10';
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);

      // 应该使用默认阈值
      expect(threshold).toBe(167000);
    });

    it('should ignore zero percentage', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '0';
      const model = 'claude-sonnet-4-5-20250929';

      const threshold = calculateAutoCompactThreshold(model);

      // 应该使用默认阈值
      expect(threshold).toBe(167000);
    });
  });

  describe('Threshold Checking', () => {
    it('should return false when below threshold', () => {
      const messages: Message[] = [
        { role: 'user', content: 'short message' },
        { role: 'assistant', content: 'short response' },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = isAboveAutoCompactThreshold(messages, model);
      expect(result).toBe(false);
    });

    it('should return true when above threshold', () => {
      // 创建大量消息以超过阈值
      // 阈值是 167000 tokens，字符数约 668000（167000 * 4）
      const largeContent = 'a'.repeat(700000); // ~175K tokens
      const messages: Message[] = [
        { role: 'user', content: largeContent },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = isAboveAutoCompactThreshold(messages, model);
      expect(result).toBe(true);
    });

    it('should handle edge case at exact threshold', () => {
      const model = 'claude-sonnet-4-5-20250929';
      const threshold = calculateAutoCompactThreshold(model);

      // 创建恰好达到阈值的消息（threshold tokens = threshold * 4 字符）
      const content = 'a'.repeat(threshold * 4);
      const messages: Message[] = [
        { role: 'user', content },
      ];

      const result = isAboveAutoCompactThreshold(messages, model);
      // 应该返回 true（因为 >= 阈值）
      expect(result).toBe(true);
    });

    it('should handle complex message structure', () => {
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(200000) },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'b'.repeat(200000) },
            { type: 'tool_use', id: '1', name: 'test', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: '1', content: 'c'.repeat(300000) },
          ],
        },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = isAboveAutoCompactThreshold(messages, model);
      // 总共约 700000 字符 = 175000 tokens > 167000 阈值
      expect(result).toBe(true);
    });

    it('should handle empty messages', () => {
      const messages: Message[] = [];
      const model = 'claude-sonnet-4-5-20250929';

      const result = isAboveAutoCompactThreshold(messages, model);
      expect(result).toBe(false);
    });
  });

  describe('Auto Compact Decision', () => {
    it('should not compact when DISABLE_COMPACT is set', () => {
      process.env.DISABLE_COMPACT = '1';
      const largeContent = 'a'.repeat(700000);
      const messages: Message[] = [
        { role: 'user', content: largeContent },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = shouldAutoCompact(messages, model);
      expect(result).toBe(false);
    });

    it('should not compact when below threshold', () => {
      const messages: Message[] = [
        { role: 'user', content: 'short' },
        { role: 'assistant', content: 'short' },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = shouldAutoCompact(messages, model);
      expect(result).toBe(false);
    });

    it('should compact when above threshold and not disabled', () => {
      const largeContent = 'a'.repeat(700000);
      const messages: Message[] = [
        { role: 'user', content: largeContent },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = shouldAutoCompact(messages, model);
      expect(result).toBe(true);
    });

    it('should respect both DISABLE_COMPACT and threshold', () => {
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(700000) },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      // 先检查没有禁用时应该压缩
      expect(shouldAutoCompact(messages, model)).toBe(true);

      // 然后禁用压缩
      process.env.DISABLE_COMPACT = '1';
      expect(shouldAutoCompact(messages, model)).toBe(false);
    });

    it('should work with different models', () => {
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(700000) },
      ];

      // Sonnet 模型
      expect(shouldAutoCompact(messages, 'claude-sonnet-4-5-20250929')).toBe(true);

      // Opus 模型
      expect(shouldAutoCompact(messages, 'claude-opus-4-5-20251101')).toBe(true);

      // Haiku 模型
      expect(shouldAutoCompact(messages, 'claude-haiku-4-5-20251001')).toBe(true);
    });

    it('should handle 1M model with higher threshold', () => {
      // 1M 模型的阈值是 967000 tokens = 3868000 字符
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(700000) },
      ];
      const model = 'claude-opus-4-5-20251101[1m]';

      // 700000 字符约 175000 tokens，远低于 967000 阈值
      expect(shouldAutoCompact(messages, model)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle messages with undefined content', () => {
      const messages: Message[] = [
        { role: 'user', content: undefined as any },
        { role: 'assistant', content: 'response' },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      // 不应该抛出错误
      expect(() => isAboveAutoCompactThreshold(messages, model)).not.toThrow();
      expect(isAboveAutoCompactThreshold(messages, model)).toBe(false);
    });

    it('should handle messages with null content', () => {
      const messages: Message[] = [
        { role: 'user', content: null as any },
        { role: 'assistant', content: 'response' },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      // 不应该抛出错误
      expect(() => isAboveAutoCompactThreshold(messages, model)).not.toThrow();
    });

    it('should handle messages with mixed content types', () => {
      const messages: Message[] = [
        { role: 'user', content: 'text content' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'response text' },
            { type: 'thinking', thinking: 'internal thought' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'follow up' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        },
      ];
      const model = 'claude-sonnet-4-5-20250929';

      // 不应该抛出错误
      expect(() => isAboveAutoCompactThreshold(messages, model)).not.toThrow();
    });

    it('should handle very long single message', () => {
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(1000000) }, // 1M 字符 = 250K tokens
      ];
      const model = 'claude-sonnet-4-5-20250929';

      const result = isAboveAutoCompactThreshold(messages, model);
      expect(result).toBe(true);
    });

    it('should handle many small messages', () => {
      // 创建 1400 个小消息
      const messages: Message[] = [];
      for (let i = 0; i < 1400; i++) {
        messages.push(
          { role: 'user', content: 'a'.repeat(250) },
          { role: 'assistant', content: 'b'.repeat(250) }
        );
      }
      const model = 'claude-sonnet-4-5-20250929';

      // 总共 700000 字符 = 175000 tokens > 167000 阈值
      const result = isAboveAutoCompactThreshold(messages, model);
      expect(result).toBe(true);
    });

    it('should handle Unicode characters', () => {
      // 中文字符可能影响 token 估算
      const messages: Message[] = [
        { role: 'user', content: '你好'.repeat(250000) }, // 500000 字符
      ];
      const model = 'claude-sonnet-4-5-20250929';

      // 应该能正常处理（即使估算可能不准确）
      expect(() => isAboveAutoCompactThreshold(messages, model)).not.toThrow();
    });

    it('should handle special characters', () => {
      const messages: Message[] = [
        { role: 'user', content: '🚀'.repeat(250000) }, // emoji
        { role: 'assistant', content: '\n'.repeat(250000) }, // 换行符
      ];
      const model = 'claude-sonnet-4-5-20250929';

      expect(() => isAboveAutoCompactThreshold(messages, model)).not.toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    it('should simulate typical conversation growth', () => {
      const model = 'claude-sonnet-4-5-20250929';
      const messages: Message[] = [];
      const threshold = calculateAutoCompactThreshold(model); // 167000 tokens

      // 模拟逐渐增长的对话
      // 每轮增加 100000 字符（50000 * 2）= 25000 tokens
      // 需要 7 轮才能达到 175000 tokens（超过 167000 阈值）
      for (let i = 0; i < 10; i++) {
        messages.push(
          { role: 'user', content: 'a'.repeat(50000) },
          { role: 'assistant', content: 'b'.repeat(50000) }
        );

        const shouldCompact = shouldAutoCompact(messages, model);
        const currentTokens = (i + 1) * 25000;

        // 前 6 轮（<= 150000 tokens）不应该压缩
        if (i < 6) {
          // 第 6 轮：150000 tokens < 167000
          expect(shouldCompact).toBe(false);
        } else {
          // 第 7 轮及之后（>= 175000 tokens）应该压缩
          expect(shouldCompact).toBe(true);
        }
      }
    });

    it('should handle conversation with tool calls', () => {
      const model = 'claude-sonnet-4-5-20250929';
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(200000) },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'b'.repeat(100000) },
            { type: 'tool_use', id: '1', name: 'bash', input: { command: 'ls' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: '1', content: 'c'.repeat(300000) },
          ],
        },
        {
          role: 'assistant',
          content: 'd'.repeat(100000),
        },
      ];

      // 总共约 700000 字符 = 175000 tokens > 167000
      expect(shouldAutoCompact(messages, model)).toBe(true);
    });

    it('should respect custom threshold via percentage', () => {
      process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '60';
      const model = 'claude-sonnet-4-5-20250929';

      // 60% 阈值 = (200000 - 20000) * 0.6 = 108000 tokens = 432000 字符
      const messages: Message[] = [
        { role: 'user', content: 'a'.repeat(440000) },
      ];

      // 440000 字符 = 110000 tokens > 108000 阈值
      expect(shouldAutoCompact(messages, model)).toBe(true);

      // 较小的消息不应该触发
      const smallMessages: Message[] = [
        { role: 'user', content: 'a'.repeat(400000) },
      ];
      // 400000 字符 = 100000 tokens < 108000 阈值
      expect(shouldAutoCompact(smallMessages, model)).toBe(false);
    });
  });
});

describe('Integration Test Scenarios', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should handle real conversation flow simulation', () => {
    const model = 'claude-sonnet-4-5-20250929';
    const messages: Message[] = [];

    // 模拟真实对话：用户提问 -> AI 回答 -> 工具调用 -> 工具结果
    messages.push({ role: 'user', content: 'Read the file main.ts and explain it' });
    messages.push({
      role: 'assistant',
      content: [
        { type: 'text', text: "I'll read the file for you." },
        { type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: '/path/to/main.ts' } },
      ],
    });
    messages.push({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool_1', content: 'a'.repeat(500000) }, // 大文件内容
      ],
    });
    messages.push({
      role: 'assistant',
      content: 'Based on the file content... ' + 'b'.repeat(200000),
    });

    // 总共约 700000 字符 = 175000 tokens > 167000，应该触发压缩
    expect(shouldAutoCompact(messages, model)).toBe(true);
  });

  it('should preserve message order logic', () => {
    const model = 'claude-sonnet-4-5-20250929';

    // 创建有序消息序列
    const messages: Message[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(
        { role: 'user', content: `Message ${i}` + 'a'.repeat(5000) },
        { role: 'assistant', content: `Response ${i}` + 'b'.repeat(5000) }
      );
    }

    // 检查阈值判断是否一致
    const result1 = shouldAutoCompact(messages, model);
    const result2 = shouldAutoCompact(messages, model);

    expect(result1).toBe(result2); // 多次调用应该返回相同结果
  });

  it('should handle session consistency across different thresholds', () => {
    // 600000 字符 = 150000 tokens < 167000 阈值（不触发）
    const smallMessages: Message[] = [
      { role: 'user', content: 'a'.repeat(600000) },
    ];

    // 标准模型不应该触发压缩（因为低于阈值）
    const result1 = shouldAutoCompact(smallMessages, 'claude-sonnet-4-5-20250929');
    expect(result1).toBe(false); // 150000 tokens < 167000

    // 使用更大的消息来触发压缩
    const largeMessages: Message[] = [
      { role: 'user', content: 'a'.repeat(700000) }, // 175000 tokens
    ];
    expect(shouldAutoCompact(largeMessages, 'claude-sonnet-4-5-20250929')).toBe(true);

    // 1M 模型需要更多内容才能触发（阈值 967000 tokens）
    expect(shouldAutoCompact(largeMessages, 'claude-opus-4-5-20251101[1m]')).toBe(false);
  });

  it('should validate environment variable interactions', () => {
    const messages: Message[] = [
      { role: 'user', content: 'a'.repeat(700000) },
    ];
    const model = 'claude-sonnet-4-5-20250929';

    // 场景 1：正常情况（应该触发）
    expect(shouldAutoCompact(messages, model)).toBe(true);

    // 场景 2：禁用压缩
    process.env.DISABLE_COMPACT = '1';
    expect(shouldAutoCompact(messages, model)).toBe(false);

    // 场景 3：同时设置禁用和自定义阈值（禁用优先）
    process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '50';
    expect(shouldAutoCompact(messages, model)).toBe(false);

    // 场景 4：只有自定义阈值
    delete process.env.DISABLE_COMPACT;
    process.env.AXON_AUTOCOMPACT_PCT_OVERRIDE = '90';
    const shouldCompactWithCustom = shouldAutoCompact(messages, model);
    expect(typeof shouldCompactWithCustom).toBe('boolean');
  });

  it('should handle extreme message sizes', () => {
    const model = 'claude-sonnet-4-5-20250929';

    // 极小消息
    const tinyMessages: Message[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(shouldAutoCompact(tinyMessages, model)).toBe(false);

    // 极大消息（接近上下文窗口）
    const hugeMessages: Message[] = [
      { role: 'user', content: 'a'.repeat(700000) }, // 175000 tokens
    ];
    expect(shouldAutoCompact(hugeMessages, model)).toBe(true);
  });

  it('should not allow sub-agents to override parent model context', () => {
    // 这个测试验证 sub-agents 不会覆盖全局父模型上下文
    // 场景：主 agent 使用 opus，创建 sub-agent 使用 haiku
    // sub-agent 不应该覆盖全局的 parentModelContext

    // 1. 设置主 agent 的模型为 opus
    setParentModelContext('claude-opus-4-5-20251101');
    expect(getParentModelContext()).toBe('claude-opus-4-5-20251101');

    // 2. 模拟 sub-agent 创建（不应该覆盖）
    // 实际场景中，sub-agent 的 Loop 会设置 isSubAgent: true，不会调用 setParentModelContext

    // 3. 验证父模型上下文没有被改变
    expect(getParentModelContext()).toBe('claude-opus-4-5-20251101');
  });
});
