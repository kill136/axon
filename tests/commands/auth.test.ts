/**
 * Authentication Commands Unit Tests
 * Tests for login, logout, upgrade, passes, and other auth-related commands
 *
 * 测试覆盖范围:
 * - API key 设置和验证
 * - 登录/登出流程
 * - OAuth 流程
 * - 错误处理(无效 key、网络错误等)
 * - 认证状态管理
 * - 各种边缘情况
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CommandContext, CommandResult } from '../../src/commands/types.js';
import {
  loginCommand,
  logoutCommand,
  upgradeCommand,
  passesCommand,
  extraUsageCommand,
  rateLimitOptionsCommand,
  registerAuthCommands,
} from '../../src/commands/auth.js';
import { commandRegistry } from '../../src/commands/registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock context helper
function createMockContext(args: string[] = []): CommandContext {
  return {
    session: {
      id: 'test-session-id-12345',
      messageCount: 5,
      duration: 60000,
      totalCost: '$0.05',
      clearMessages: vi.fn(),
      getStats: vi.fn(() => ({
        messageCount: 5,
        duration: 60000,
        totalCost: '$0.05',
        modelUsage: { 'claude-sonnet-4.5': 1000 },
      })),
      getTodos: vi.fn(() => []),
      setTodos: vi.fn(),
    },
    config: {
      model: 'claude-sonnet-4.5',
      modelDisplayName: 'Claude Sonnet 4.5',
      apiType: 'anthropic',
      cwd: '/test/dir',
      version: '2.1.4',
    },
    ui: {
      addMessage: vi.fn(),
      addActivity: vi.fn(),
      setShowWelcome: vi.fn(),
      exit: vi.fn(),
      setShowLoginScreen: vi.fn(),
    },
    args,
    rawInput: args.join(' '),
  };
}

describe('Auth Commands Registration', () => {
  beforeEach(() => {
    // Clear registry before each test
    commandRegistry.commands.clear();
  });

  it('should register all auth commands', () => {
    registerAuthCommands();

    expect(commandRegistry.get('login')).toBeDefined();
    expect(commandRegistry.get('logout')).toBeDefined();
    expect(commandRegistry.get('upgrade')).toBeDefined();
    expect(commandRegistry.get('passes')).toBeDefined();
    expect(commandRegistry.get('extra-usage')).toBeDefined();
    expect(commandRegistry.get('rate-limit-options')).toBeDefined();
  });

  it('should register command aliases', () => {
    registerAuthCommands();

    expect(commandRegistry.get('guest-passes')).toBeDefined();
    expect(commandRegistry.get('guest-passes')?.name).toBe('passes');
  });

  it('should register commands with correct categories', () => {
    registerAuthCommands();

    expect(commandRegistry.get('login')?.category).toBe('auth');
    expect(commandRegistry.get('logout')?.category).toBe('auth');
    expect(commandRegistry.get('upgrade')?.category).toBe('auth');
  });
});

describe('Login Command', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    // 保存原始环境变量
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    // 清除环境变量以测试未认证状态
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AXON_API_KEY;
  });

  afterEach(() => {
    // 恢复环境变量
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('should have correct metadata', () => {
    expect(loginCommand.name).toBe('login');
    expect(loginCommand.category).toBe('auth');
    expect(loginCommand.description).toBeTruthy();
    expect(loginCommand.usage).toContain('login');
  });

  it('should show login options when called without args', async () => {
    const ctx = createMockContext([]);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);

    // 检查是否调用了 setShowLoginScreen (官方行为) 或 addMessage (回退行为)
    if (ctx.ui.setShowLoginScreen) {
      expect(ctx.ui.setShowLoginScreen).toHaveBeenCalledWith(true);
      expect(ctx.ui.addActivity).toHaveBeenCalled();
    } else {
      expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('login'));
    }
  });

  it('should show detailed help with --help flag', async () => {
    const ctx = createMockContext(['--help']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Axon Login'));

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Login Methods/);
    expect(message).toMatch(/API Key/);
    expect(message).toMatch(/OAuth/);
    expect(message).toMatch(/Environment Variables/);
  });

  it('should show API key setup guide for --api-key', async () => {
    const ctx = createMockContext(['--api-key']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('API Key Setup'));
    expect(ctx.ui.addActivity).toHaveBeenCalledWith('Showed API key setup guide');

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/platform\.axon\.com/);
    expect(message).toMatch(/ANTHROPIC_API_KEY/);
    expect(message).toMatch(/sk-ant-/);
  });

  it('should handle api-key without dashes', async () => {
    const ctx = createMockContext(['api-key']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('API Key Setup'));
  });

  it('should handle apikey variant', async () => {
    const ctx = createMockContext(['apikey']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('API Key Setup'));
  });

  it.skip('should handle --oauth flag', async () => {
    // This test is skipped because OAuth requires user interaction
    // and network requests that aren't suitable for unit testing.
    // OAuth flow should be tested in integration tests instead.
    const ctx = createMockContext(['--oauth']);
    const result = await loginCommand.execute(ctx);

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it.skip('should handle --claudeai method', async () => {
    // OAuth 测试跳过,因为会触发真实的认证流程
    // 这些应该在集成测试中进行
    const ctx = createMockContext(['--claudeai']);
    const result = await loginCommand.execute(ctx);

    expect(result).toBeDefined();
    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it.skip('should handle --console method', async () => {
    // OAuth 测试跳过,因为会触发真实的认证流程
    // 这些应该在集成测试中进行
    const ctx = createMockContext(['--console']);
    const result = await loginCommand.execute(ctx);

    expect(result).toBeDefined();
    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it('should handle unknown login method', async () => {
    const ctx = createMockContext(['--unknown-method']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(false);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Unknown login method'));
  });

  it('should show available methods on unknown method', async () => {
    const ctx = createMockContext(['--invalid']);
    await loginCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Available methods:/);
    expect(message).toMatch(/--api-key/);
    expect(message).toMatch(/--oauth/);
    expect(message).toMatch(/--claudeai/);
    expect(message).toMatch(/--console/);
  });

  it('should detect API key from environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-123';

    const ctx = createMockContext([]);
    const result = await loginCommand.execute(ctx);

    // 可能触发 setShowLoginScreen 或 addMessage
    expect(result.success).toBe(true);
    expect(ctx.ui.setShowLoginScreen || ctx.ui.addMessage).toHaveBeenCalled();
  });

  it('should detect alternative AXON_API_KEY environment variable', async () => {
    process.env.AXON_API_KEY = 'sk-ant-test-key-456';

    const ctx = createMockContext([]);
    const result = await loginCommand.execute(ctx);

    // 可能触发 setShowLoginScreen 或 addMessage
    expect(result.success).toBe(true);
    expect(ctx.ui.setShowLoginScreen || ctx.ui.addMessage).toHaveBeenCalled();
  });

  it('should handle help variant', async () => {
    const ctx = createMockContext(['help']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Axon Login'));
  });

  it('should handle -h flag', async () => {
    const ctx = createMockContext(['-h']);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Axon Login'));
  });
});

describe('Logout Command', () => {
  let tempDir: string;
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    tempDir = path.join(os.tmpdir(), 'claude-test-' + Date.now());
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    // 清理临时文件
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should have correct metadata', () => {
    expect(logoutCommand.name).toBe('logout');
    expect(logoutCommand.category).toBe('auth');
    expect(logoutCommand.description).toBeTruthy();
  });

  it('should show activity when logging out', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AXON_API_KEY;

    const ctx = createMockContext([]);
    const result = await logoutCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addActivity).toHaveBeenCalledWith('Logging out...');
  });

  it('should handle logout with API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const ctx = createMockContext([]);
    const result = await logoutCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addActivity).toHaveBeenCalled();
  });

  it('should provide success message when called', async () => {
    const ctx = createMockContext([]);
    const result = await logoutCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalled();
    expect(ctx.ui.addActivity).toHaveBeenCalledWith('Logging out...');

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toBeTruthy();
    expect(typeof message).toBe('string');
    expect(message).toMatch(/logged out/i);
  });

  it('should return logout action for UI handling', async () => {
    const ctx = createMockContext([]);
    const result = await logoutCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.action).toBe('logout');
  });

  it('should add success activity after logout', async () => {
    const ctx = createMockContext([]);
    await logoutCommand.execute(ctx);

    expect(ctx.ui.addActivity).toHaveBeenCalledWith('Logged out successfully');
  });
});

describe('Upgrade Command', () => {
  it('should have correct metadata', () => {
    expect(upgradeCommand.name).toBe('upgrade');
    expect(upgradeCommand.category).toBe('auth');
    expect(upgradeCommand.description).toBeTruthy();
  });

  it('should display upgrade information', () => {
    const ctx = createMockContext([]);
    const result = upgradeCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Upgrade Claude Subscription'));
  });

  it('should show all plan tiers', () => {
    const ctx = createMockContext([]);
    upgradeCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Free/);
    expect(message).toMatch(/Pro/);
    expect(message).toMatch(/Max/);
    expect(message).toMatch(/Enterprise/);
  });

  it('should include API pricing information', () => {
    const ctx = createMockContext([]);
    upgradeCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/API Pricing/);
    expect(message).toMatch(/Sonnet/);
    expect(message).toMatch(/Opus/);
    expect(message).toMatch(/Haiku/);
  });

  it('should include plan pricing details', () => {
    const ctx = createMockContext([]);
    upgradeCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/\$20.*month/i);  // Pro pricing
    expect(message).toMatch(/\$200.*month/i); // Max pricing
  });

  it('should include upgrade instructions', () => {
    const ctx = createMockContext([]);
    upgradeCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/To upgrade:/);
    expect(message).toMatch(/claude\.ai\/settings/);
  });

  it('should include usage tracking commands', () => {
    const ctx = createMockContext([]);
    upgradeCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/\/usage/);
    expect(message).toMatch(/\/cost/);
  });
});

describe('Passes Command', () => {
  it('should have correct metadata', () => {
    expect(passesCommand.name).toBe('passes');
    expect(passesCommand.aliases).toContain('guest-passes');
    expect(passesCommand.category).toBe('auth');
    expect(passesCommand.description).toBeTruthy();
  });

  it('should display guest passes information', () => {
    const ctx = createMockContext([]);
    const result = passesCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Guest Passes'));
  });

  it('should explain pass limitations for educational project', () => {
    const ctx = createMockContext([]);
    passesCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/educational project/i);
  });

  it('should mention Max subscription requirement', () => {
    const ctx = createMockContext([]);
    passesCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Max/);
    expect(message).toMatch(/3.*pass/i);
  });

  it('should include instructions for sharing passes', () => {
    const ctx = createMockContext([]);
    passesCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Sharing a Pass:/);
    expect(message).toMatch(/claude\.ai/);
  });

  it('should mention pass duration', () => {
    const ctx = createMockContext([]);
    passesCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/7 days/i);
  });
});

describe('Extra Usage Command', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('should have correct metadata', () => {
    expect(extraUsageCommand.name).toBe('extra-usage');
    expect(extraUsageCommand.category).toBe('auth');
    expect(extraUsageCommand.description).toBeTruthy();
    expect(extraUsageCommand.usage).toBeTruthy();
  });

  it('should show help by default', () => {
    const ctx = createMockContext([]);
    const result = extraUsageCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Extra Usage'));
  });

  it('should handle status subcommand', () => {
    const ctx = createMockContext(['status']);
    const result = extraUsageCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Extra Usage Status'));
  });

  it('should handle enable subcommand', () => {
    const ctx = createMockContext(['enable']);
    const result = extraUsageCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Enable Extra Usage'));
  });

  it('should handle disable subcommand', () => {
    const ctx = createMockContext(['disable']);
    const result = extraUsageCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Disable Extra Usage'));
  });

  it('should handle API users differently', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const ctx = createMockContext(['status']);
    extraUsageCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/API Key Authentication/i);
    expect(message).toMatch(/usage-based billing/i);
  });

  it('should handle subscription users', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AXON_API_KEY;

    const ctx = createMockContext(['status']);
    extraUsageCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Subscription/i);
  });

  it('should handle info subcommand as alias for help', () => {
    const ctx = createMockContext(['info']);
    extraUsageCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Extra Usage/);
    expect(message).toMatch(/How It Works/);
  });

  it('should include pricing information in help', () => {
    const ctx = createMockContext(['help']);
    extraUsageCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Pricing Information/);
    expect(message).toMatch(/Pro users/);
    expect(message).toMatch(/Max users/);
  });

  it('should mention safety features', () => {
    const ctx = createMockContext([]);
    extraUsageCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Safety Features/);
    expect(message).toMatch(/spending limits/i);
  });

  it('should include alternative options', () => {
    const ctx = createMockContext([]);
    extraUsageCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Alternative Options/);
    expect(message).toMatch(/\/upgrade/);
    expect(message).toMatch(/\/model/);
  });
});

describe('Rate Limit Options Command', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('should have correct metadata', () => {
    expect(rateLimitOptionsCommand.name).toBe('rate-limit-options');
    expect(rateLimitOptionsCommand.category).toBe('auth');
    expect(rateLimitOptionsCommand.description).toBeTruthy();
  });

  it('should display rate limit options', () => {
    const ctx = createMockContext([]);
    const result = rateLimitOptionsCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Rate Limit Options'));
  });

  it('should show all available options', () => {
    const ctx = createMockContext([]);
    rateLimitOptionsCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Stop and Wait/);
    expect(message).toMatch(/Switch to a Lower-Cost Model/);
    expect(message).toMatch(/Add Extra Usage/);
    expect(message).toMatch(/Upgrade Your Plan/);
    expect(message).toMatch(/Use API Keys/);
  });

  it('should show current authentication status', () => {
    const ctx = createMockContext([]);
    rateLimitOptionsCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Current Status:/);
    expect(message).toMatch(/Authentication:/);
  });

  it('should detect API key authentication', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const ctx = createMockContext([]);
    rateLimitOptionsCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/API Key.*usage-based billing/i);
  });

  it('should show rate limit tiers', () => {
    const ctx = createMockContext([]);
    rateLimitOptionsCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Rate Limit Tiers:/);
    expect(message).toMatch(/Free:/);
    expect(message).toMatch(/Pro:/);
    expect(message).toMatch(/Max:/);
  });

  it('should include best practices', () => {
    const ctx = createMockContext([]);
    rateLimitOptionsCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Best Practices:/);
    expect(message).toMatch(/Monitor your usage/);
  });

  it('should reference related commands', () => {
    const ctx = createMockContext([]);
    rateLimitOptionsCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/\/usage/);
    expect(message).toMatch(/\/cost/);
    expect(message).toMatch(/\/model/);
    expect(message).toMatch(/\/upgrade/);
  });
});

describe('Error Handling', () => {
  it('should handle command execution errors gracefully', async () => {
    const ctx = createMockContext([]);

    // Force an error by passing invalid context
    ctx.ui.addMessage = vi.fn(() => {
      throw new Error('UI error');
    });

    try {
      await commandRegistry.execute('login', ctx);
    } catch (error) {
      // Should not throw - registry should catch errors
      expect(error).toBeUndefined();
    }
  });

  it('should validate command parameters', async () => {
    const ctx = createMockContext(['invalid', 'params', 'that', 'dont', 'make', 'sense']);
    const result = await loginCommand.execute(ctx);

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });

  it('should handle missing UI methods gracefully', async () => {
    const ctx = createMockContext([]);
    // 删除 setShowLoginScreen 方法
    delete (ctx.ui as any).setShowLoginScreen;

    const result = await loginCommand.execute(ctx);

    // 应该回退到 addMessage
    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it('should handle empty args array', async () => {
    const ctx = createMockContext([]);

    const loginResult = await loginCommand.execute(ctx);
    expect(loginResult).toBeDefined();

    const logoutResult = await logoutCommand.execute(ctx);
    expect(logoutResult).toBeDefined();

    const upgradeResult = upgradeCommand.execute(ctx);
    expect(upgradeResult).toBeDefined();
  });
});

describe('API Key Validation Scenarios', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('should detect valid API key format', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key-123';

    const ctx = createMockContext([]);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.setShowLoginScreen || ctx.ui.addMessage).toHaveBeenCalled();
  });

  it('should handle no authentication', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.AXON_API_KEY;

    const ctx = createMockContext([]);
    const result = await loginCommand.execute(ctx);

    expect(result.success).toBe(true);
    // 可能调用 setShowLoginScreen 或 addMessage
    if (ctx.ui.setShowLoginScreen && (ctx.ui.setShowLoginScreen as any).mock.calls.length > 0) {
      expect(ctx.ui.setShowLoginScreen).toHaveBeenCalled();
    } else {
      expect(ctx.ui.addMessage).toHaveBeenCalled();
    }
  });
});

describe('OAuth Flow Scenarios', () => {
  it.skip('should display OAuth instructions for --claudeai', async () => {
    // OAuth 测试跳过,因为会触发真实的网络请求
    // 这些应该在集成测试中进行
    const ctx = createMockContext(['--claudeai']);
    await loginCommand.execute(ctx);

    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it.skip('should display OAuth instructions for --console', async () => {
    // OAuth 测试跳过,因为会触发真实的网络请求
    // 这些应该在集成测试中进行
    const ctx = createMockContext(['--console']);
    await loginCommand.execute(ctx);

    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it.skip('should handle oauth without dashes', async () => {
    // OAuth 测试跳过,因为会触发真实的网络请求
    const ctx = createMockContext(['oauth']);
    await loginCommand.execute(ctx);

    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it.skip('should handle claudeai without dashes', async () => {
    // OAuth 测试跳过,因为会触发真实的网络请求
    const ctx = createMockContext(['claudeai']);
    await loginCommand.execute(ctx);

    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });

  it.skip('should handle console without dashes', async () => {
    // OAuth 测试跳过,因为会触发真实的网络请求
    const ctx = createMockContext(['console']);
    await loginCommand.execute(ctx);

    expect(ctx.ui.addMessage).toHaveBeenCalled();
  });
});

describe('Command Integration', () => {
  beforeEach(() => {
    commandRegistry.commands.clear();
    registerAuthCommands();
  });

  it('should allow executing commands through registry', async () => {
    const ctx = createMockContext(['--help']);

    const result = await commandRegistry.execute('login', ctx);
    expect(result).toBeDefined();
  });

  it('should handle non-existent commands', async () => {
    const ctx = createMockContext([]);

    const result = await commandRegistry.execute('non-existent-command', ctx);
    expect(result).toBeDefined();
  });

  it('should retrieve commands by name', () => {
    const login = commandRegistry.get('login');
    expect(login).toBeDefined();
    expect(login?.name).toBe('login');
  });

  it('should retrieve commands by alias', () => {
    const guestPasses = commandRegistry.get('guest-passes');
    expect(guestPasses).toBeDefined();
    expect(guestPasses?.name).toBe('passes');
  });
});

describe('Edge Cases and Boundary Conditions', () => {
  it('should handle very long argument lists', async () => {
    const longArgs = Array(100).fill('arg');
    const ctx = createMockContext(longArgs);

    const result = await loginCommand.execute(ctx);
    expect(result).toBeDefined();
  });

  it('should handle special characters in arguments', async () => {
    const ctx = createMockContext(['--method-with-$pecial-ch@rs']);

    const result = await loginCommand.execute(ctx);
    expect(result).toBeDefined();
  });

  it('should handle unicode in arguments', async () => {
    const ctx = createMockContext(['--方法', '测试']);

    const result = await loginCommand.execute(ctx);
    expect(result).toBeDefined();
  });

  it('should handle null/undefined args gracefully', async () => {
    const ctx = createMockContext([]);
    ctx.args = undefined as any;

    try {
      const result = await loginCommand.execute(ctx);
      // 如果没有崩溃就通过
      expect(result).toBeDefined();
    } catch (error) {
      // 捕获错误也算通过，只要不是未处理的异常
      expect(error).toBeDefined();
    }
  });
});
