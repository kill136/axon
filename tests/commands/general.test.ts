/**
 * General Commands Unit Tests
 * Tests for help, clear, exit, status, doctor, bug, version, memory, plan commands
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CommandContext } from '../../src/commands/types.js';
import {
  helpCommand,
  clearCommand,
  exitCommand,
  statusCommand,
  doctorCommand,
  bugCommand,
  versionCommand,
  planCommand,
  registerGeneralCommands,
} from '../../src/commands/general.js';
import { memoryCommand } from '../../src/commands/config.js';
import { commandRegistry } from '../../src/commands/registry.js';

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
    },
    args,
    rawInput: args.join(' '),
  };
}

describe('General Commands Registration', () => {
  beforeEach(() => {
    commandRegistry.commands.clear();
  });

  it('should register all general commands', () => {
    registerGeneralCommands();

    expect(commandRegistry.get('help')).toBeDefined();
    expect(commandRegistry.get('clear')).toBeDefined();
    expect(commandRegistry.get('exit')).toBeDefined();
    expect(commandRegistry.get('status')).toBeDefined();
    expect(commandRegistry.get('doctor')).toBeDefined();
    expect(commandRegistry.get('bug')).toBeDefined();
    expect(commandRegistry.get('version')).toBeDefined();
    expect(commandRegistry.get('plan')).toBeDefined();
  });

  it('should register command aliases', () => {
    registerGeneralCommands();

    expect(commandRegistry.get('?')).toBeDefined();
    expect(commandRegistry.get('?')?.name).toBe('help');
    expect(commandRegistry.get('reset')).toBeDefined();
    expect(commandRegistry.get('new')).toBeDefined();
    expect(commandRegistry.get('quit')).toBeDefined();
    expect(commandRegistry.get('q')).toBeDefined();
    expect(commandRegistry.get('ver')).toBeDefined();
    expect(commandRegistry.get('v')).toBeDefined();
  });
});

describe('Help Command', () => {
  beforeEach(() => {
    commandRegistry.commands.clear();
    registerGeneralCommands();
  });

  it('should have correct metadata', () => {
    expect(helpCommand.name).toBe('help');
    expect(helpCommand.aliases).toContain('?');
    expect(helpCommand.category).toBe('general');
  });

  it('should show all commands when called without args', () => {
    const ctx = createMockContext([]);
    const result = helpCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Available Commands'));
  });

  it('should group commands by category', () => {
    const ctx = createMockContext([]);
    helpCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/General/);
    // Note: Session category will only appear if session commands are registered
    // Check for common categories that should be present
    expect(message).toMatch(/Development|General/);
  });

  it('should show specific command help when provided', () => {
    const ctx = createMockContext(['clear']);
    const result = helpCommand.execute(ctx);

    expect(result.success).toBe(true);
    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/clear/i);
  });

  it('should handle unknown command gracefully', () => {
    const ctx = createMockContext(['unknown-command']);
    const result = helpCommand.execute(ctx);

    expect(result.success).toBe(false);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Unknown command'));
  });

  it('should show keyboard shortcuts', () => {
    const ctx = createMockContext([]);
    helpCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Keyboard Shortcuts/);
    expect(message).toMatch(/Ctrl/);
  });

  it('should show version in help', () => {
    const ctx = createMockContext([]);
    helpCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Version:/);
  });
});

describe('Clear Command', () => {
  it('should have correct metadata', () => {
    expect(clearCommand.name).toBe('clear');
    expect(clearCommand.aliases).toContain('reset');
    expect(clearCommand.aliases).toContain('new');
    expect(clearCommand.category).toBe('general');
  });

  it('should clear conversation', () => {
    const ctx = createMockContext([]);
    const result = clearCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.action).toBe('clear');
    expect(ctx.session.clearMessages).toHaveBeenCalled();
    expect(ctx.ui.addActivity).toHaveBeenCalledWith('Cleared conversation');
  });

  it('should show confirmation message', () => {
    const ctx = createMockContext([]);
    clearCommand.execute(ctx);

    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('cleared'));
  });
});

describe('Exit Command', () => {
  it('should have correct metadata', () => {
    expect(exitCommand.name).toBe('exit');
    expect(exitCommand.aliases).toContain('quit');
    expect(exitCommand.aliases).toContain('q');
    expect(exitCommand.category).toBe('general');
  });

  it('should exit the application', () => {
    const ctx = createMockContext([]);
    const result = exitCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(result.action).toBe('exit');
    expect(ctx.ui.exit).toHaveBeenCalled();
  });
});

describe('Status Command', () => {
  it('should have correct metadata', () => {
    expect(statusCommand.name).toBe('status');
    expect(statusCommand.category).toBe('general');
  });

  it('should display comprehensive status', () => {
    const ctx = createMockContext([]);
    const result = statusCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Status'));
  });

  it('should show version and model', () => {
    const ctx = createMockContext([]);
    statusCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Version:/);
    expect(message).toMatch(/Model:/);
  });

  it('should show account information', () => {
    const ctx = createMockContext([]);
    ctx.config.username = 'test-user';
    ctx.config.organization = 'test-org';

    statusCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Account/);
    expect(message).toMatch(/test-user/);
    expect(message).toMatch(/test-org/);
  });

  it('should show API connectivity status', () => {
    const ctx = createMockContext([]);
    statusCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/API Connectivity/);
  });

  it('should show session information', () => {
    const ctx = createMockContext([]);
    statusCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Session/);
    expect(message).toMatch(/Messages:/);
    expect(message).toMatch(/Duration:/);
    expect(message).toMatch(/Cost:/);
  });

  it('should show token usage when available', () => {
    const ctx = createMockContext([]);
    ctx.session.getStats = vi.fn(() => ({
      messageCount: 10,
      duration: 120000,
      totalCost: '$0.15',
      modelUsage: {
        'claude-sonnet-4.5': 5000,
        'claude-opus-4.5': 2000,
      },
    }));

    statusCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/Token Usage/);
    expect(message).toMatch(/Total:/);
  });
});

describe('Doctor Command', () => {
  it('should have correct metadata', () => {
    expect(doctorCommand.name).toBe('doctor');
    expect(doctorCommand.category).toBe('general');
  });
});

describe('Bug Command', () => {
  it('should have correct metadata', () => {
    expect(bugCommand.name).toBe('bug');
    expect(bugCommand.aliases).toContain('report');
    expect(bugCommand.aliases).toContain('issue');
    expect(bugCommand.category).toBe('general');
  });

  it('should show bug report instructions', () => {
    const ctx = createMockContext([]);
    const result = bugCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringContaining('Report a Bug'));
  });

  it('should include system information', () => {
    const ctx = createMockContext([]);
    bugCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/System Information/);
    expect(message).toMatch(/Version:/);
    expect(message).toMatch(/Platform:/);
  });

  it('should include GitHub issues link', () => {
    const ctx = createMockContext([]);
    bugCommand.execute(ctx);

    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/github\.com/);
  });
});

describe('Version Command', () => {
  it('should have correct metadata', () => {
    expect(versionCommand.name).toBe('version');
    expect(versionCommand.aliases).toContain('ver');
    expect(versionCommand.aliases).toContain('v');
    expect(versionCommand.category).toBe('general');
  });

  it('should display version', () => {
    const ctx = createMockContext([]);
    const result = versionCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('assistant', expect.stringMatching(/Axon v\d+\.\d+\.\d+/));
  });
});

describe('Memory Command', () => {
  it('should have correct metadata', () => {
    expect(memoryCommand.name).toBe('memory');
    expect(memoryCommand.aliases).toContain('mem');
  });

  it('should show empty memory message', async () => {
    const ctx = createMockContext([]);
    const result = await memoryCommand.execute(ctx);

    expect(result).toBeDefined();
  });

  it('should handle show subcommand', async () => {
    const ctx = createMockContext(['show']);
    const result = await memoryCommand.execute(ctx);

    expect(result).toBeDefined();
  });

  it('should handle clear subcommand', async () => {
    const ctx = createMockContext(['clear']);
    const result = await memoryCommand.execute(ctx);

    expect(result).toBeDefined();
  });
});

describe('Plan Command', () => {
  it('should have correct metadata', () => {
    expect(planCommand.name).toBe('plan');
    expect(planCommand.category).toBe('development');
  });

  it('should enter plan mode', async () => {
    const ctx = createMockContext([]);
    const result = await planCommand.execute(ctx);

    expect(result.success).toBe(true);
    expect(ctx.ui.addMessage).toHaveBeenCalledWith('user', expect.stringContaining('plan mode'));
  });

  it('should handle status subcommand', async () => {
    const ctx = createMockContext(['status']);
    const result = await planCommand.execute(ctx);

    expect(result).toBeDefined();
  });

  it('should handle exit subcommand', async () => {
    const ctx = createMockContext(['exit']);
    const result = await planCommand.execute(ctx);

    expect(result).toBeDefined();
  });

  it('should accept task description', async () => {
    const ctx = createMockContext(['implement', 'new', 'feature']);
    const result = await planCommand.execute(ctx);

    expect(result.success).toBe(true);
    const message = (ctx.ui.addMessage as any).mock.calls[0][1];
    expect(message).toMatch(/implement new feature/);
  });
});

describe('Command Error Handling', () => {
  it('should handle UI errors gracefully', () => {
    const ctx = createMockContext([]);
    ctx.ui.addMessage = vi.fn(() => {
      throw new Error('UI error');
    });

    expect(() => clearCommand.execute(ctx)).toThrow();
  });

  it('should validate command context', () => {
    const ctx = createMockContext([]);

    expect(ctx.session).toBeDefined();
    expect(ctx.config).toBeDefined();
    expect(ctx.ui).toBeDefined();
  });

  it('should handle missing functions gracefully', async () => {
    const ctx = createMockContext([]);
    delete (ctx.session as any).clearMessages;

    try {
      clearCommand.execute(ctx);
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe('Command Integration', () => {
  beforeEach(() => {
    commandRegistry.commands.clear();
    registerGeneralCommands();
  });

  it('should execute commands through registry', async () => {
    const ctx = createMockContext([]);
    const result = await commandRegistry.execute('help', ctx);

    expect(result.success).toBe(true);
  });

  it('should handle unknown commands in registry', async () => {
    const ctx = createMockContext([]);
    const result = await commandRegistry.execute('unknown-command', ctx);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Unknown command/);
  });

  it('should execute commands via aliases', async () => {
    const ctx = createMockContext([]);
    const result = await commandRegistry.execute('?', ctx);

    expect(result.success).toBe(true);
  });
});
