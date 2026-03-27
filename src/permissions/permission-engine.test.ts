/**
 * 权限决策引擎测试 (Subtask 7.3)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import PermissionEngine, { type PermissionContext } from './permission-engine';

describe('PermissionEngine', () => {
  let engine: PermissionEngine;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-engine-'));
    engine = new PermissionEngine(undefined, path.join(tempDir, 'project.json'), path.join(tempDir, 'user.json'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('addRule and setRules', () => {
    it('should add single rule', () => {
      engine.addRule('allow', 'Bash(git *)');
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'git commit' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('allow');
    });

    it('should set multiple rules', () => {
      engine.setRules([
        { type: 'deny', rule: 'Bash(rm *)' },
        { type: 'allow', rule: 'Bash(git *)' },
      ]);

      const allowContext: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'git commit' },
      };
      expect(engine.decide(allowContext).decision).toBe('allow');

      const denyContext: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /' },
      };
      expect(engine.decide(denyContext).decision).toBe('deny');
    });
  });

  describe('decide - basic functionality', () => {
    it('should allow by default when no rules', () => {
      const context: PermissionContext = {
        toolName: 'Read',
        toolInput: { file_path: '/etc/passwd' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('allow');
    });

    it('should deny when deny rule matches', () => {
      engine.addRule('deny', 'Bash(rm *)');
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'rm -rf /' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('Denied by rule');
    });

    it('should ask when ask rule matches', () => {
      engine.addRule('ask', 'Bash(sudo *)');
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'sudo reboot' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('ask');
      expect(result.reason).toContain('Requires approval');
    });

    it('should allow when allow rule matches', () => {
      engine.addRule('allow', 'Bash(git *)');
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'git push' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('allow');
    });
  });

  describe('decide - priority (deny > ask > allow)', () => {
    it('should prioritize deny over ask and allow', () => {
      engine.setRules([
        { type: 'allow', rule: 'Bash(*)' },
        { type: 'ask', rule: 'Bash(ls *)' },
        { type: 'deny', rule: 'Bash(ls *)' },
      ]);
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'ls /' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('deny');
    });

    it('should prioritize ask over allow', () => {
      engine.setRules([
        { type: 'allow', rule: 'Bash(*)' },
        { type: 'ask', rule: 'Bash(ls *)' },
      ]);
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'ls /' },
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('ask');
    });
  });

  describe('decide - different tool types', () => {
    it('should evaluate Read tool rules', () => {
      engine.addRule('allow', 'Read(src/**)');
      const context: PermissionContext = {
        toolName: 'Read',
        toolInput: { file_path: 'src/main.ts' },
      };
      expect(engine.decide(context).decision).toBe('allow');

      const denyContext: PermissionContext = {
        toolName: 'Read',
        toolInput: { file_path: '/etc/passwd' },
      };
      expect(engine.decide(denyContext).decision).toBe('allow'); // No matching deny rule
    });

    it('should evaluate Write tool rules', () => {
      engine.addRule('deny', 'Write(/etc/*)');
      const context: PermissionContext = {
        toolName: 'Write',
        toolInput: { file_path: '/etc/config' },
      };
      expect(engine.decide(context).decision).toBe('deny');
    });

    it('should evaluate WebFetch tool rules', () => {
      engine.addRule('allow', 'WebFetch(https://*)');
      const httpContext: PermissionContext = {
        toolName: 'WebFetch',
        toolInput: { url: 'http://example.com' },
      };
      expect(engine.decide(httpContext).decision).toBe('allow'); // No matching rule, default allow

      const httpsContext: PermissionContext = {
        toolName: 'WebFetch',
        toolInput: { url: 'https://example.com' },
      };
      expect(engine.decide(httpsContext).decision).toBe('allow');
    });
  });

  describe('managed policies integration', () => {
    it('should deny hook execution when policy enforces managed-only', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      fs.writeFileSync(projPolicyPath, JSON.stringify({ allowManagedHooksOnly: true }));

      engine = new PermissionEngine(undefined, projPolicyPath, path.join(tempDir, 'user.json'));

      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'echo test' },
        sourceType: 'hook',
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('managed-only');
    });

    it('should deny MCP server in blacklist', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      fs.writeFileSync(projPolicyPath, JSON.stringify({ deniedMcpServers: ['dangerous-mcp'] }));

      engine = new PermissionEngine(undefined, projPolicyPath, path.join(tempDir, 'user.json'));

      const context: PermissionContext = {
        toolName: 'dangerous-mcp/tool',
        sourceType: 'mcp',
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('blocked by policy');
    });

    it('should deny MCP server not in whitelist', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      fs.writeFileSync(projPolicyPath, JSON.stringify({ allowedMcpServers: ['trusted-mcp'] }));

      engine = new PermissionEngine(undefined, projPolicyPath, path.join(tempDir, 'user.json'));

      const context: PermissionContext = {
        toolName: 'unknown-mcp/tool',
        sourceType: 'mcp',
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('not in whitelist');
    });

    it('should allow MCP server in whitelist', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      fs.writeFileSync(projPolicyPath, JSON.stringify({ allowedMcpServers: ['trusted-mcp'] }));

      engine = new PermissionEngine(undefined, projPolicyPath, path.join(tempDir, 'user.json'));

      const context: PermissionContext = {
        toolName: 'trusted-mcp/tool',
        sourceType: 'mcp',
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('allow');
    });

    it('should deny blocked plugin', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      fs.writeFileSync(projPolicyPath, JSON.stringify({ blockedPlugins: ['evil-plugin'] }));

      engine = new PermissionEngine(undefined, projPolicyPath, path.join(tempDir, 'user.json'));

      const context: PermissionContext = {
        toolName: 'evil-plugin/action',
        sourceType: 'plugin',
      };
      const result = engine.decide(context);
      expect(result.decision).toBe('deny');
      expect(result.reason).toContain('blocked by policy');
    });
  });

  describe('audit log', () => {
    it('should record decisions in audit log', () => {
      engine.addRule('allow', 'Bash(git *)');
      const context: PermissionContext = {
        toolName: 'Bash',
        toolInput: { command: 'git commit' },
        user: 'testuser',
      };
      engine.decide(context);

      const logs = engine.getAuditLog();
      expect(logs).toHaveLength(1);
      expect(logs[0].decision).toBe('allow');
      expect(logs[0].source).toBe('condition');
    });

    it('should generate ISO8601 timestamp', () => {
      const context: PermissionContext = {
        toolName: 'Read',
        toolInput: { file_path: 'test.txt' },
      };
      engine.decide(context);

      const logs = engine.getAuditLog();
      expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('should clear audit log', () => {
      const context: PermissionContext = {
        toolName: 'Read',
        toolInput: { file_path: 'test.txt' },
      };
      engine.decide(context);
      expect(engine.getAuditLog()).toHaveLength(1);

      engine.clearAuditLog();
      expect(engine.getAuditLog()).toHaveLength(0);
    });

    it('should track decision source', () => {
      engine.addRule('deny', 'Write(/etc/*)');
      const context: PermissionContext = {
        toolName: 'Write',
        toolInput: { file_path: '/etc/config' },
      };
      engine.decide(context);

      const logs = engine.getAuditLog();
      expect(logs[0].source).toBe('condition');
    });
  });

  describe('complex scenarios', () => {
    it('should handle mixed rules and policies', () => {
      engine.setRules([
        { type: 'deny', rule: 'Bash(rm *)' },
        { type: 'allow', rule: 'Bash(git *)' },
        { type: 'ask', rule: 'Bash(sudo *)' },
      ]);

      const projPolicyPath = path.join(tempDir, 'project.json');
      fs.writeFileSync(
        projPolicyPath,
        JSON.stringify({
          deniedMcpServers: ['evil-mcp'],
        })
      );

      engine = new PermissionEngine(undefined, projPolicyPath, path.join(tempDir, 'user.json'));
      engine.setRules([
        { type: 'deny', rule: 'Bash(rm *)' },
        { type: 'allow', rule: 'Bash(git *)' },
      ]);

      // Allowed by rule
      expect(
        engine.decide({
          toolName: 'Bash',
          toolInput: { command: 'git push' },
        }).decision
      ).toBe('allow');

      // Denied by rule
      expect(
        engine.decide({
          toolName: 'Bash',
          toolInput: { command: 'rm -rf /' },
        }).decision
      ).toBe('deny');

      // Denied by policy
      expect(
        engine.decide({
          toolName: 'evil-mcp/tool',
          sourceType: 'mcp',
        }).decision
      ).toBe('deny');
    });
  });
});
