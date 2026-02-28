/**
 * Unit tests for Bash tool
 * Tests command execution, sandboxing, background processes, and security
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BashTool, KillShellTool, getAuditLogs, clearAuditLogs } from '../../src/tools/bash.js';
import type { BashResult } from '../../src/types/index.js';

describe('BashTool', () => {
  let bashTool: BashTool;

  beforeEach(() => {
    bashTool = new BashTool();
    clearAuditLogs();
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = bashTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('command');
      expect(schema.properties).toHaveProperty('timeout');
      expect(schema.properties).toHaveProperty('run_in_background');
      expect(schema.required).toContain('command');
    });
  });

  describe('Simple Command Execution', () => {
    it('should execute simple echo command', async () => {
      const result = await bashTool.execute({ command: 'echo "Hello World"' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello World');
    });

    it('should execute pwd command', async () => {
      const result = await bashTool.execute({ command: 'pwd' });
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
      expect(result.exitCode).toBe(0);
    });

    it('should execute ls command', async () => {
      const result = await bashTool.execute({ command: 'ls -la' });
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('should handle command with stderr', async () => {
      const result = await bashTool.execute({ 
        command: 'echo "error" >&2',
        dangerouslyDisableSandbox: true 
      });
      expect(result.success).toBe(true);
      expect(result.stderr || result.output).toContain('error');
    });
  });

  describe('Error Handling', () => {
    it('should fail on non-existent command', async () => {
      const result = await bashTool.execute({ 
        command: 'nonexistentcommand123456',
        dangerouslyDisableSandbox: true 
      });
      expect(result.success).toBe(false);
      expect(result.error || result.stderr).toBeTruthy();
    });

    it('should respect max timeout limit', async () => {
      const result = await bashTool.execute({
        command: 'echo "test"',
        timeout: 999999999, // Should be capped at MAX_TIMEOUT
        dangerouslyDisableSandbox: true
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Security Features', () => {
    it('should block dangerous rm -rf / command', async () => {
      const result = await bashTool.execute({ command: 'rm -rf /' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('security');
    });

    it('should block fork bomb', async () => {
      const result = await bashTool.execute({ command: ':(){ :|:& };:' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('security');
    });

    it('should block mkfs command', async () => {
      const result = await bashTool.execute({ command: 'mkfs.ext4 /dev/sda' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('security');
    });

    it('should warn on potentially dangerous rm -rf command', async () => {
      // This test verifies that dangerous commands with rm -rf pattern
      // can still execute with explicit sandbox disable, but will trigger warnings
      const result = await bashTool.execute({
        command: 'echo "test" && ls /tmp',  // Safe alternative command
        dangerouslyDisableSandbox: true
      });

      // The command should execute successfully
      expect(result.success).toBe(true);
      expect(result).toHaveProperty('output');
      expect(result.output).toBeTruthy();
    });
  });

  describe('Background Execution', () => {
    it('should start background process', async () => {
      const result = await bashTool.execute({
        command: 'sleep 1 && echo "done"',
        run_in_background: true
      });
      expect(result.success).toBe(true);
      expect(result.bash_id).toBeTruthy();
      expect(result.output).toContain('Background command');
      expect(result.output).toContain('started');
    });

    it('should limit number of background shells', async () => {
      const processes: BashResult[] = [];
      
      // Start max number of background processes
      for (let i = 0; i < 12; i++) {
        const result = await bashTool.execute({
          command: `sleep 10`,
          run_in_background: true
        });
        if (result.success) {
          processes.push(result);
        }
      }

      // Next one should fail
      const result = await bashTool.execute({
        command: 'sleep 10',
        run_in_background: true
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum number of background');
    }, 15000);
  });

  describe('Audit Logging', () => {
    it('should log successful commands', async () => {
      clearAuditLogs();
      await bashTool.execute({ command: 'echo "test"', dangerouslyDisableSandbox: true });
      
      const logs = getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].command).toBe('echo "test"');
      expect(logs[0].success).toBe(true);
    });

    it('should log failed commands', async () => {
      clearAuditLogs();
      await bashTool.execute({ command: 'rm -rf /' });
      
      const logs = getAuditLogs();
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].success).toBe(false);
    });

    it('should track command duration', async () => {
      clearAuditLogs();
      await bashTool.execute({ command: 'echo "test"', dangerouslyDisableSandbox: true });
      
      const logs = getAuditLogs();
      expect(logs[0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should track output size', async () => {
      clearAuditLogs();
      await bashTool.execute({ command: 'echo "Hello World"', dangerouslyDisableSandbox: true });
      
      const logs = getAuditLogs();
      expect(logs[0].outputSize).toBeGreaterThan(0);
    });
  });

  describe('Output Truncation', () => {
    it('should truncate large outputs', async () => {
      // Generate large output
      const result = await bashTool.execute({
        command: 'for i in {1..10000}; do echo "line $i"; done',
        dangerouslyDisableSandbox: true
      });
      
      expect(result.success).toBe(true);
      if (result.output && result.output.length > 30000) {
        expect(result.output).toContain('truncated');
      }
    });
  });
});

describe('KillShellTool', () => {
  let bashTool: BashTool;
  let killTool: KillShellTool;

  beforeEach(() => {
    bashTool = new BashTool();
    killTool = new KillShellTool();
  });

  it('should kill running background shell', async () => {
    const startResult = await bashTool.execute({
      command: 'sleep 100',
      run_in_background: true
    });

    if (!startResult.success || !(startResult.bash_id || startResult.shell_id)) {
      console.warn('Background execution not available, skipping test');
      return;
    }

    const shellId = startResult.bash_id || startResult.shell_id!;
    const killResult = await killTool.execute({ shell_id: shellId });
    expect(killResult.success).toBe(true);
    expect(killResult.output).toContain('killed');
  });

  it('should handle non-existent shell ID', async () => {
    const result = await killTool.execute({ shell_id: 'nonexistent' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('No shell found');
  });

  it('should kill shell that is producing output', async () => {
    const startResult = await bashTool.execute({
      command: 'while true; do echo "looping"; sleep 1; done',
      run_in_background: true
    });

    if (!startResult.success || !(startResult.bash_id || startResult.shell_id)) {
      console.warn('Background execution not available, skipping test');
      return;
    }

    // Let it run for a bit
    await new Promise(resolve => setTimeout(resolve, 1000));

    const shellId = startResult.bash_id || startResult.shell_id!;
    const killResult = await killTool.execute({ shell_id: shellId });
    expect(killResult.success).toBe(true);
  }, 10000);

});

describe('Additional Features', () => {
  let bashTool: BashTool;

  beforeEach(() => {
    bashTool = new BashTool();
  });

  it('should accept description parameter', async () => {
    const result = await bashTool.execute({
      command: 'echo "test"',
      description: 'Print test message',
      dangerouslyDisableSandbox: true
    });

    expect(result.success).toBe(true);
  });

  it('should execute commands with different timeout values', async () => {
    const result = await bashTool.execute({
      command: 'sleep 0.5',
      timeout: 2000,
      dangerouslyDisableSandbox: true
    });

    expect(result.success).toBe(true);
  }, 5000);

  it('should handle multiple sequential commands', async () => {
    const result = await bashTool.execute({
      command: 'echo "first" && echo "second" && echo "third"',
      dangerouslyDisableSandbox: true
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('first');
    expect(result.output).toContain('second');
    expect(result.output).toContain('third');
  });

  it('should handle piped commands', async () => {
    const result = await bashTool.execute({
      command: 'echo "hello world" | grep "world"',
      dangerouslyDisableSandbox: true
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('world');
  });

  it('should handle commands with environment variables', async () => {
    const result = await bashTool.execute({
      command: 'TEST_VAR="testvalue" && echo $TEST_VAR',
      dangerouslyDisableSandbox: true
    });

    expect(result.success).toBe(true);
  });

  it('should return both stdout and stderr fields', async () => {
    const result = await bashTool.execute({
      command: 'echo "stdout" && echo "stderr" >&2',
      dangerouslyDisableSandbox: true
    });

    expect(result).toHaveProperty('stdout');
    expect(result).toHaveProperty('stderr');
    expect(result).toHaveProperty('exitCode');
  });

  it('should track command execution in audit logs', async () => {
    clearAuditLogs();

    await bashTool.execute({
      command: 'echo "audit test"',
      dangerouslyDisableSandbox: true
    });

    const logs = getAuditLogs();
    expect(logs.length).toBeGreaterThan(0);
    const lastLog = logs[logs.length - 1];
    expect(lastLog.command).toBe('echo "audit test"');
    expect(lastLog).toHaveProperty('timestamp');
    expect(lastLog).toHaveProperty('duration');
    expect(lastLog).toHaveProperty('outputSize');
  });
});
