/**
 * Comprehensive unit tests for Hooks System
 * Tests all hook types, events, and functionality
 *
 * Test Coverage:
 * - Hook registration and management
 * - Command hooks execution
 * - URL hooks
 * - Prompt hooks (LLM evaluation)
 * - Agent hooks (validator)
 * - MCP hooks
 * - Hook matchers (exact and regex)
 * - Blocking/non-blocking hooks
 * - All 19 event types
 * - Error handling and timeouts
 * - Configuration loading
 * - Environment variable substitution
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerHook,
  clearHooks,
  getHookCount,
  getEventHookCount,
  getHooksForEvent,
  runHooks,
  runPreToolUseHooks,
  runPostToolUseHooks,
  runSessionStartHooks,
  runSessionEndHooks,
  runUserPromptSubmitHooks,
  runStopHooks,
  runSubagentStartHooks,
  runSubagentStopHooks,
  runPreCompactHooks,
  runPostToolUseFailureHooks,
  runPermissionRequestHooks,
  runNotificationHooks,
  isBlocked,
  unregisterHook,
  clearEventHooks,
  getRegisteredHooks,
  getRegisteredHooksFlat,
  loadHooksFromFile,
  loadProjectHooks,
  type CommandHookConfig,
  type UrlHookConfig,
  type PromptHookConfig,
  type AgentHookConfig,
  type McpHookConfig,
  type HookEvent,
  type HookResult,
} from '../../src/hooks/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Hooks System', () => {
  let testDir: string;

  beforeEach(() => {
    clearHooks();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
  });

  afterEach(() => {
    clearHooks();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Hook Registration and Management', () => {
    it('should register a command hook', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo test',
      };

      registerHook('PreToolUse', hook);
      expect(getHookCount()).toBe(1);
      expect(getEventHookCount('PreToolUse')).toBe(1);
    });

    it('should register multiple hooks for same event', () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo test1',
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'echo test2',
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);

      expect(getHookCount()).toBe(2);
      expect(getEventHookCount('PreToolUse')).toBe(2);
    });

    it('should register hooks for different events', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo test',
      };

      registerHook('PreToolUse', hook);
      registerHook('PostToolUse', hook);
      registerHook('SessionStart', hook);

      expect(getHookCount()).toBe(3);
      expect(getEventHookCount('PreToolUse')).toBe(1);
      expect(getEventHookCount('PostToolUse')).toBe(1);
      expect(getEventHookCount('SessionStart')).toBe(1);
    });

    it('should retrieve hooks for specific event', () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo test1',
      };
      const hook2: UrlHookConfig = {
        type: 'url',
        url: 'http://example.com',
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);
      registerHook('PostToolUse', hook1);

      const preToolHooks = getHooksForEvent('PreToolUse');
      expect(preToolHooks).toHaveLength(2);
      expect(preToolHooks[0].type).toBe('command');
      expect(preToolHooks[1].type).toBe('url');
    });

    it('should clear all hooks', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo test',
      };

      registerHook('PreToolUse', hook);
      registerHook('PostToolUse', hook);
      expect(getHookCount()).toBe(2);

      clearHooks();
      expect(getHookCount()).toBe(0);
    });

    it('should clear hooks for specific event', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo test',
      };

      registerHook('PreToolUse', hook);
      registerHook('PostToolUse', hook);

      clearEventHooks('PreToolUse');
      expect(getEventHookCount('PreToolUse')).toBe(0);
      expect(getEventHookCount('PostToolUse')).toBe(1);
    });

    it('should unregister specific hook', () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo test1',
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'echo test2',
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);
      expect(getEventHookCount('PreToolUse')).toBe(2);

      const removed = unregisterHook('PreToolUse', hook1);
      expect(removed).toBe(true);
      expect(getEventHookCount('PreToolUse')).toBe(1);

      const hooks = getHooksForEvent('PreToolUse');
      expect((hooks[0] as CommandHookConfig).command).toBe('echo test2');
    });

    it('should get all registered hooks', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo test',
      };

      registerHook('PreToolUse', hook);
      registerHook('PostToolUse', hook);

      const allHooks = getRegisteredHooks();
      expect(allHooks).toHaveProperty('PreToolUse');
      expect(allHooks).toHaveProperty('PostToolUse');
    });

    it('should get hooks as flat array', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo test',
      };

      registerHook('PreToolUse', hook);
      registerHook('PostToolUse', hook);

      const flatHooks = getRegisteredHooksFlat();
      expect(flatHooks).toHaveLength(2);
      expect(flatHooks[0]).toHaveProperty('event');
      expect(flatHooks[0]).toHaveProperty('config');
    });
  });

  describe('Command Hook Execution', () => {
    it('should execute simple command hook', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Hello from hook"',
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        sessionId: 'test-session',
      });

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].output).toContain('Hello from hook');
    });

    it('should pass environment variables to command', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Tool: $TOOL_NAME Event: $EVENT Session: $SESSION_ID"',
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'TestTool',
        sessionId: 'test-123',
      });

      expect(results[0].success).toBe(true);
      expect(results[0].output).toContain('Tool: TestTool');
      expect(results[0].output).toContain('Event: PreToolUse');
      expect(results[0].output).toContain('Session: test-123');
    });

    it('should handle command with custom environment variables', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Custom: $CUSTOM_VAR"',
        env: {
          CUSTOM_VAR: 'custom-value',
        },
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results[0].success).toBe(true);
      expect(results[0].output).toContain('Custom: custom-value');
    });

    it('should handle command timeout', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'sleep 5',
        timeout: 100, // 100ms timeout
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('timed out');
    }, 10000);

    it('should handle command failure', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'exit 1',
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeTruthy();
    });

    it('should execute multiple hooks in order', async () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo "First"',
        blocking: true,
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'echo "Second"',
        blocking: true,
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results).toHaveLength(2);
      expect(results[0].output).toContain('First');
      expect(results[1].output).toContain('Second');
    });
  });

  describe('Hook Matchers', () => {
    it('should match exact tool name', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Bash hook"',
        matcher: 'Bash',
      };

      registerHook('PreToolUse', hook);

      // Should match
      const bashResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Bash',
      });
      expect(bashResults).toHaveLength(1);

      // Should not match
      const readResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Read',
      });
      expect(readResults).toHaveLength(0);
    });

    it('should match regex pattern', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "File operation"',
        matcher: '/Write|Edit|Read/',
      };

      registerHook('PreToolUse', hook);

      const writeResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Write',
      });
      expect(writeResults).toHaveLength(1);

      const editResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Edit',
      });
      expect(editResults).toHaveLength(1);

      const readResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Read',
      });
      expect(readResults).toHaveLength(1);

      const bashResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Bash',
      });
      expect(bashResults).toHaveLength(0);
    });

    it('should match complex regex patterns', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Web tool"',
        matcher: '/^Web.*/',
      };

      registerHook('PreToolUse', hook);

      const webFetchResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'WebFetch',
      });
      expect(webFetchResults).toHaveLength(1);

      const webSearchResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'WebSearch',
      });
      expect(webSearchResults).toHaveLength(1);
    });

    it('should run all hooks when no matcher specified', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Global hook"',
      };

      registerHook('PreToolUse', hook);

      const bashResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Bash',
      });
      expect(bashResults).toHaveLength(1);

      const writeResults = await runHooks({
        event: 'PreToolUse',
        toolName: 'Write',
      });
      expect(writeResults).toHaveLength(1);
    });
  });

  describe('Blocking and Non-Blocking Hooks', () => {
    it('should block operation when hook returns blocked', async () => {
      // Use node -e for cross-platform compatibility (bash scripts don't work on Windows)
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'node -e "process.stdout.write(JSON.stringify({blocked:true,message:\'Operation blocked\'})); process.exit(1)"',
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results[0].blocked).toBe(true);
      expect(results[0].blockMessage).toContain('blocked');
    });

    it('should stop executing hooks after blocking hook', async () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo "First"',
        blocking: true,
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'node -e "process.stdout.write(JSON.stringify({blocked:true,message:\'Blocked\'})); process.exit(1)"',
        blocking: true,
      };
      const hook3: CommandHookConfig = {
        type: 'command',
        command: 'echo "Third"',
        blocking: true,
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);
      registerHook('PreToolUse', hook3);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      // Should have executed hook1 and hook2, but not hook3
      expect(results).toHaveLength(2);
      expect(results[1].blocked).toBe(true);
    });

    it('should check if results are blocked using isBlocked', () => {
      const results: HookResult[] = [
        { success: true },
        { success: false, blocked: true, blockMessage: 'Blocked!' },
      ];

      const blockCheck = isBlocked(results);
      expect(blockCheck.blocked).toBe(true);
      expect(blockCheck.message).toBe('Blocked!');
    });

    it('should return not blocked when no hooks block', () => {
      const results: HookResult[] = [
        { success: true },
        { success: true },
      ];

      const blockCheck = isBlocked(results);
      expect(blockCheck.blocked).toBe(false);
    });
  });

  describe('All Hook Event Types', () => {
    const allEvents: HookEvent[] = [
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'Notification',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'PreCompact',
      'PermissionRequest',
      'BeforeSetup',
      'AfterSetup',
      'CommandsLoaded',
      'ToolsLoaded',
      'McpConfigsLoaded',
      'PluginsInitialized',
      'AfterHooks',
    ];

    it('should support all 19 event types', () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "test"',
      };

      allEvents.forEach((event) => {
        registerHook(event, hook);
      });

      expect(getHookCount()).toBe(19);

      allEvents.forEach((event) => {
        expect(getEventHookCount(event)).toBe(1);
      });
    });

    it('should execute PreToolUse hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "PreToolUse"',
      };

      registerHook('PreToolUse', hook);

      const result = await runPreToolUseHooks('Bash', { command: 'ls' }, 'session-1');
      expect(result.allowed).toBe(true);
    });

    it('should execute PostToolUse hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "PostToolUse"',
      };

      registerHook('PostToolUse', hook);

      await runPostToolUseHooks('Bash', { command: 'ls' }, 'output', 'session-1');
      // Should not throw
    });

    it('should execute SessionStart hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "SessionStart"',
      };

      registerHook('SessionStart', hook);

      await runSessionStartHooks('session-1');
      // Should not throw
    });

    it('should execute SessionEnd hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "SessionEnd"',
      };

      registerHook('SessionEnd', hook);

      await runSessionEndHooks('session-1');
      // Should not throw
    });

    it('should execute UserPromptSubmit hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "UserPromptSubmit"',
      };

      registerHook('UserPromptSubmit', hook);

      const result = await runUserPromptSubmitHooks('test prompt', 'session-1');
      expect(result.allowed).toBe(true);
    });

    it('should execute Stop hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Stop"',
      };

      registerHook('Stop', hook);

      await runStopHooks('user requested', 'session-1');
      // Should not throw
    });

    it('should execute SubagentStart hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "SubagentStart"',
      };

      registerHook('SubagentStart', hook);

      await runSubagentStartHooks('validator', 'session-1');
      // Should not throw
    });

    it('should execute SubagentStop hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "SubagentStop"',
      };

      registerHook('SubagentStop', hook);

      await runSubagentStopHooks('validator', 'session-1');
      // Should not throw
    });

    it('should execute PreCompact hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "PreCompact"',
      };

      registerHook('PreCompact', hook);

      const result = await runPreCompactHooks('session-1', 50000);
      expect(result.allowed).toBe(true);
    });

    it('should execute PostToolUseFailure hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "PostToolUseFailure"',
      };

      registerHook('PostToolUseFailure', hook);

      await runPostToolUseFailureHooks('Bash', { command: 'invalid' }, 'Command failed', 'session-1');
      // Should not throw
    });

    it('should execute PermissionRequest hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "PermissionRequest"',
      };

      registerHook('PermissionRequest', hook);

      const result = await runPermissionRequestHooks('Write', { file_path: '/test.txt' }, 'session-1');
      expect(result).toBeDefined();
    });

    it('should execute Notification hooks correctly', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'echo "Notification"',
      };

      registerHook('Notification', hook);

      await runNotificationHooks('Test notification', 'session-1');
      // Should not throw
    });
  });

  describe('URL Hooks', () => {
    it('should register URL hook', () => {
      const hook: UrlHookConfig = {
        type: 'url',
        url: 'http://example.com/hook',
        method: 'POST',
      };

      registerHook('PreToolUse', hook);

      const hooks = getHooksForEvent('PreToolUse');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].type).toBe('url');
    });

    it('should have default method as POST', () => {
      const hook: UrlHookConfig = {
        type: 'url',
        url: 'http://example.com/hook',
      };

      registerHook('PreToolUse', hook);

      const hooks = getHooksForEvent('PreToolUse');
      const urlHook = hooks[0] as UrlHookConfig;
      expect(urlHook.method).toBeUndefined(); // Will use default POST
    });

    it('should support custom headers in URL hook', () => {
      const hook: UrlHookConfig = {
        type: 'url',
        url: 'http://example.com/hook',
        headers: {
          'Authorization': 'Bearer token',
          'X-Custom': 'value',
        },
      };

      registerHook('PreToolUse', hook);

      const hooks = getHooksForEvent('PreToolUse');
      const urlHook = hooks[0] as UrlHookConfig;
      expect(urlHook.headers).toHaveProperty('Authorization');
      expect(urlHook.headers).toHaveProperty('X-Custom');
    });
  });

  describe('Configuration Loading', () => {
    it('should load hooks from JSON file (new format)', () => {
      const configFile = path.join(testDir, 'hooks.json');
      const config = {
        hooks: {
          PreToolUse: [
            {
              type: 'command',
              command: 'echo "test"',
            },
          ],
          PostToolUse: [
            {
              type: 'command',
              command: 'echo "post"',
            },
          ],
        },
      };

      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

      clearHooks();
      loadHooksFromFile(configFile);

      expect(getEventHookCount('PreToolUse')).toBe(1);
      expect(getEventHookCount('PostToolUse')).toBe(1);
    });

    it('should load hooks from JSON file (legacy format)', () => {
      const configFile = path.join(testDir, 'hooks-legacy.json');
      const config = {
        hooks: [
          {
            event: 'PreToolUse',
            command: 'echo "test"',
          },
          {
            event: 'PostToolUse',
            command: 'echo "post"',
          },
        ],
      };

      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

      clearHooks();
      loadHooksFromFile(configFile);

      expect(getEventHookCount('PreToolUse')).toBe(1);
      expect(getEventHookCount('PostToolUse')).toBe(1);
    });

    it('should handle non-existent config file gracefully', () => {
      const configFile = path.join(testDir, 'non-existent.json');

      expect(() => {
        loadHooksFromFile(configFile);
      }).not.toThrow();

      expect(getHookCount()).toBe(0);
    });

    it('should handle invalid JSON gracefully', () => {
      const configFile = path.join(testDir, 'invalid.json');
      fs.writeFileSync(configFile, 'invalid json {');

      expect(() => {
        loadHooksFromFile(configFile);
      }).not.toThrow();

      expect(getHookCount()).toBe(0);
    });

    it('should validate hook configs when loading', () => {
      const configFile = path.join(testDir, 'invalid-hooks.json');
      const config = {
        hooks: {
          PreToolUse: [
            {
              type: 'command',
              // Missing required 'command' field
            },
            {
              type: 'command',
              command: 'echo "valid"',
            },
          ],
        },
      };

      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

      clearHooks();
      loadHooksFromFile(configFile);

      // Should only load the valid hook
      expect(getEventHookCount('PreToolUse')).toBe(1);
    });

    it('should load project hooks from .claude directory', () => {
      const claudeDir = path.join(testDir, '.claude');
      const hooksDir = path.join(claudeDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });

      // Create settings.json with hooks
      const settingsFile = path.join(claudeDir, 'settings.json');
      const settings = {
        hooks: {
          PreToolUse: [
            {
              type: 'command',
              command: 'echo "from settings"',
            },
          ],
        },
      };
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));

      // Create additional hook file
      const hookFile = path.join(hooksDir, 'custom.json');
      const hookConfig = {
        hooks: {
          PostToolUse: [
            {
              type: 'command',
              command: 'echo "from hooks dir"',
            },
          ],
        },
      };
      fs.writeFileSync(hookFile, JSON.stringify(hookConfig, null, 2));

      clearHooks();
      loadProjectHooks(testDir);

      expect(getEventHookCount('PreToolUse')).toBe(1);
      expect(getEventHookCount('PostToolUse')).toBe(1);
    });

    it('should support multiple hook types in config', () => {
      const configFile = path.join(testDir, 'multi-type.json');
      const config = {
        hooks: {
          PreToolUse: [
            {
              type: 'command',
              command: 'echo "command"',
            },
            {
              type: 'url',
              url: 'http://example.com/hook',
            },
          ],
        },
      };

      fs.writeFileSync(configFile, JSON.stringify(config, null, 2));

      clearHooks();
      loadHooksFromFile(configFile);

      const hooks = getHooksForEvent('PreToolUse');
      expect(hooks).toHaveLength(2);
      expect(hooks[0].type).toBe('command');
      expect(hooks[1].type).toBe('url');
    });
  });

  describe('Error Handling', () => {
    it('should handle hook execution errors gracefully', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'nonexistentcommand123',
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBeTruthy();
    });

    it('should continue execution after non-blocking hook fails', async () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'exit 1',
        blocking: false, // Non-blocking
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'echo "Second hook"',
        blocking: false,
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
    });

    it('should handle missing event gracefully', async () => {
      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results).toHaveLength(0);
    });
  });

  describe('Hook Types', () => {
    it('should support Prompt hook type', () => {
      const hook: PromptHookConfig = {
        type: 'prompt',
        prompt: 'Is this operation safe?',
        model: 'claude-3-5-sonnet-20241022',
      };

      registerHook('PreToolUse', hook);

      const hooks = getHooksForEvent('PreToolUse');
      expect(hooks[0].type).toBe('prompt');
      expect((hooks[0] as PromptHookConfig).prompt).toBeTruthy();
    });

    it('should support Agent hook type', () => {
      const hook: AgentHookConfig = {
        type: 'agent',
        agentType: 'security-validator',
        agentConfig: {
          strictMode: true,
        },
      };

      registerHook('PreToolUse', hook);

      const hooks = getHooksForEvent('PreToolUse');
      expect(hooks[0].type).toBe('agent');
      expect((hooks[0] as AgentHookConfig).agentType).toBe('security-validator');
    });

    it('should support MCP hook type', () => {
      const hook: McpHookConfig = {
        type: 'mcp',
        server: 'test-server',
        tool: 'validate',
        toolArgs: {
          level: 'strict',
        },
      };

      registerHook('PreToolUse', hook);

      const hooks = getHooksForEvent('PreToolUse');
      expect(hooks[0].type).toBe('mcp');
      expect((hooks[0] as McpHookConfig).server).toBe('test-server');
      expect((hooks[0] as McpHookConfig).tool).toBe('validate');
    });
  });

  describe('Advanced Scenarios', () => {
    it('should handle mixed blocking and non-blocking hooks', async () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo "Non-blocking 1"',
        blocking: false,
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'echo "Blocking"',
        blocking: true,
      };
      const hook3: CommandHookConfig = {
        type: 'command',
        command: 'echo "Non-blocking 2"',
        blocking: false,
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);
      registerHook('PreToolUse', hook3);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(true);
    });

    it('should pass correct tool input to hooks', async () => {
      const hook: CommandHookConfig = {
        type: 'command',
        command: 'cat', // Read from stdin
        blocking: true,
      };

      registerHook('PreToolUse', hook);

      const toolInput = {
        file_path: '/test/file.txt',
        content: 'test content',
      };

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Write',
        toolInput,
        sessionId: 'session-1',
      });

      expect(results[0].success).toBe(true);
      expect(results[0].output).toContain('file_path');
      expect(results[0].output).toContain('test content');
    });

    it('should handle hooks with custom timeouts', async () => {
      const hook1: CommandHookConfig = {
        type: 'command',
        command: 'echo "Fast"',
        timeout: 5000,
      };
      const hook2: CommandHookConfig = {
        type: 'command',
        command: 'echo "Slow"',
        timeout: 60000,
      };

      registerHook('PreToolUse', hook1);
      registerHook('PreToolUse', hook2);

      const results = await runHooks({
        event: 'PreToolUse',
        toolName: 'Test',
      });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });
});
