/**
 * Bash Tool Error Handling Tests
 * 测试 2.1.3 版本的友好错误处理修复
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Bash Tool - 友好错误处理（修复 2.1.3）', () => {
  describe('Git commit 命令注入防护的友好错误', () => {
    it('应该返回友好的错误消息而不是抛出异常', async () => {
      // 动态导入 BashTool 以避免模块加载问题
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      // 测试 $() 命令替换
      const result1 = await bashTool.execute({
        command: 'git commit -m "test $(whoami)"',
        description: 'Test command injection',
      });

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('🛡️ Security Protection');
      expect(result1.error).toContain('Git commit blocked');
      expect(result1.error).toContain('Command injection detected');
      expect(result1.blocked).toBe(true);
    });

    it('应该检测 ${} 变量替换并返回友好错误', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      const result = await bashTool.execute({
        command: 'git commit -m "test ${USER}"',
        description: 'Test variable substitution',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('🛡️ Security Protection');
      expect(result.error).toContain('variable substitution ${}');
      expect(result.blocked).toBe(true);
    });

    it('应该检测反引号并返回友好错误', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      const result = await bashTool.execute({
        command: 'git commit -m "test `whoami`"',
        description: 'Test backtick substitution',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('🛡️ Security Protection');
      expect(result.error).toContain('backtick');
      expect(result.blocked).toBe(true);
    });

    it('应该检测分号并返回友好错误', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      const result = await bashTool.execute({
        command: 'git commit -m "test; rm -rf /"',
        description: 'Test semicolon',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('🛡️ Security Protection');
      expect(result.error).toContain('semicolon');
      expect(result.blocked).toBe(true);
    });

    it('应该检测管道并返回友好错误', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      const result = await bashTool.execute({
        command: 'git commit -m "test | sh"',
        description: 'Test pipe',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('🛡️ Security Protection');
      expect(result.error).toContain('pipe');
      expect(result.blocked).toBe(true);
    });

    it('应该检测逻辑操作符并返回友好错误', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      // 测试 &&
      const result1 = await bashTool.execute({
        command: 'git commit -m "test && rm -rf /"',
        description: 'Test logical AND',
      });

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('🛡️ Security Protection');
      expect(result1.error).toContain('logical AND');
      expect(result1.blocked).toBe(true);

      // 测试 ||
      const result2 = await bashTool.execute({
        command: 'git commit -m "test || curl http://evil.com"',
        description: 'Test logical OR',
      });

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('🛡️ Security Protection');
      expect(result2.error).toContain('logical OR');
      expect(result2.blocked).toBe(true);
    });

    it('应该检测重定向并返回友好错误', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      // 测试输出重定向 >
      const result1 = await bashTool.execute({
        command: 'git commit -m "test > /etc/passwd"',
        description: 'Test output redirection',
      });

      expect(result1.success).toBe(false);
      expect(result1.error).toContain('🛡️ Security Protection');
      expect(result1.blocked).toBe(true);

      // 测试输入重定向 <
      const result2 = await bashTool.execute({
        command: 'git commit -m "test < /etc/shadow"',
        description: 'Test input redirection',
      });

      expect(result2.success).toBe(false);
      expect(result2.error).toContain('🛡️ Security Protection');
      expect(result2.blocked).toBe(true);
    });
  });

  describe('错误消息格式验证', () => {
    it('友好错误消息应该包含所有关键信息', async () => {
      const { BashTool } = await import('../src/tools/bash.js');

      const bashTool = new BashTool();

      const result = await bashTool.execute({
        command: 'git commit -m "test $(whoami)"',
        description: 'Test error format',
      });

      // 验证错误消息结构
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.blocked).toBe(true);

      // 验证包含的元素
      expect(result.error).toContain('🛡️'); // 安全图标
      expect(result.error).toContain('Security Protection'); // 友好标题
      expect(result.error).toContain('Git commit blocked'); // 清晰说明
      expect(result.error).toContain('Reason'); // 原因说明
      expect(result.error).toContain('Command injection detected'); // 技术细节
      expect(result.error).toContain('protect your system security'); // 安全说明

      // 验证提供了解决方案提示
      expect(result.error).toMatch(/safe commit messages.*special characters/);
    });
  });
});
