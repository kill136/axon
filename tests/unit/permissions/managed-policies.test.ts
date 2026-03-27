/**
 * 托管策略系统测试 (Subtask 7.2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import ManagedPoliciesManager, { type ManagedPolicy } from '../../../src/permissions/managed-policies';

describe('ManagedPoliciesManager', () => {
  let tempDir: string;
  let manager: ManagedPoliciesManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-policies-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('loadPolicies', () => {
    it('should load empty policies when no files exist', () => {
      manager = new ManagedPoliciesManager(undefined, path.join(tempDir, 'project.json'), path.join(tempDir, 'user.json'));
      const policy = manager.loadPolicies();
      expect(policy).toEqual({});
    });

    it('should load user-level policy', () => {
      const userPolicyPath = path.join(tempDir, 'user.json');
      const userPolicy: ManagedPolicy = { allowManagedHooksOnly: true };
      fs.writeFileSync(userPolicyPath, JSON.stringify(userPolicy));

      manager = new ManagedPoliciesManager(undefined, path.join(tempDir, 'project.json'), userPolicyPath);
      const loaded = manager.loadPolicies();
      expect(loaded.allowManagedHooksOnly).toBe(true);
    });

    it('should load project-level policy', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      const projPolicy: ManagedPolicy = { allowManagedPermissionRulesOnly: true };
      fs.writeFileSync(projPolicyPath, JSON.stringify(projPolicy));

      manager = new ManagedPoliciesManager(undefined, projPolicyPath, path.join(tempDir, 'user.json'));
      const loaded = manager.loadPolicies();
      expect(loaded.allowManagedPermissionRulesOnly).toBe(true);
    });

    it('should load policies from .d directory', () => {
      const projPolicyDir = path.join(tempDir, 'project.d');
      fs.mkdirSync(projPolicyDir);
      fs.writeFileSync(path.join(projPolicyDir, '01-hooks.json'), JSON.stringify({ allowManagedHooksOnly: true }));
      fs.writeFileSync(path.join(projPolicyDir, '02-rules.json'), JSON.stringify({ allowManagedPermissionRulesOnly: true }));

      manager = new ManagedPoliciesManager(undefined, path.join(tempDir, 'project.json'), path.join(tempDir, 'user.json'));
      const loaded = manager.loadPolicies();
      expect(loaded.allowManagedHooksOnly).toBe(true);
      expect(loaded.allowManagedPermissionRulesOnly).toBe(true);
    });

    it('should cache policy results', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      const projPolicy: ManagedPolicy = { allowManagedHooksOnly: true };
      fs.writeFileSync(projPolicyPath, JSON.stringify(projPolicy));

      manager = new ManagedPoliciesManager(undefined, projPolicyPath, path.join(tempDir, 'user.json'));
      const first = manager.loadPolicies();
      const second = manager.loadPolicies();
      expect(first).toBe(second);
    });
  });

  describe('mergePolicies', () => {
    it('should merge empty policies', () => {
      manager = new ManagedPoliciesManager();
      const merged = manager.mergePolicies({}, {}, {});
      expect(merged).toEqual({});
    });

    it('should merge whitelist arrays - union', () => {
      manager = new ManagedPoliciesManager();
      const policy1: ManagedPolicy = { allowedMcpServers: ['server1', 'server2'] };
      const policy2: ManagedPolicy = { allowedMcpServers: ['server2', 'server3'] };
      const merged = manager.mergePolicies(policy1, policy2);
      expect(new Set(merged.allowedMcpServers)).toEqual(new Set(['server1', 'server2', 'server3']));
    });

    it('should merge blacklist arrays - union', () => {
      manager = new ManagedPoliciesManager();
      const policy1: ManagedPolicy = { deniedMcpServers: ['bad1', 'bad2'] };
      const policy2: ManagedPolicy = { deniedMcpServers: ['bad2', 'bad3'] };
      const merged = manager.mergePolicies(policy1, policy2);
      expect(new Set(merged.deniedMcpServers)).toEqual(new Set(['bad1', 'bad2', 'bad3']));
    });

    it('should merge blocked plugins - union', () => {
      manager = new ManagedPoliciesManager();
      const policy1: ManagedPolicy = { blockedPlugins: ['plugin1'] };
      const policy2: ManagedPolicy = { blockedPlugins: ['plugin2'] };
      const merged = manager.mergePolicies(policy1, policy2);
      expect(new Set(merged.blockedPlugins)).toEqual(new Set(['plugin1', 'plugin2']));
    });
  });

  describe('validatePolicy', () => {
    it('should validate empty policy', () => {
      manager = new ManagedPoliciesManager();
      const result = manager.validatePolicy({});
      expect(result.valid).toBe(true);
    });

    it('should reject invalid field types', () => {
      manager = new ManagedPoliciesManager();
      const policy: any = {
        allowManagedHooksOnly: 'yes',
      };
      const result = manager.validatePolicy(policy);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('allowManagedHooksOnly must be boolean');
    });

    it('should warn about overlapping allow/deny MCP servers', () => {
      manager = new ManagedPoliciesManager();
      const policy: ManagedPolicy = {
        allowedMcpServers: ['server1', 'server2'],
        deniedMcpServers: ['server2', 'server3'],
      };
      const result = manager.validatePolicy(policy);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('isPolicyEnforced', () => {
    it('should return true for enforced policy', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      const projPolicy: ManagedPolicy = { allowManagedHooksOnly: true };
      fs.writeFileSync(projPolicyPath, JSON.stringify(projPolicy));

      manager = new ManagedPoliciesManager(undefined, projPolicyPath, path.join(tempDir, 'user.json'));
      expect(manager.isPolicyEnforced('allowManagedHooksOnly')).toBe(true);
    });

    it('should return false for unenforced policy', () => {
      manager = new ManagedPoliciesManager(undefined, path.join(tempDir, 'project.json'), path.join(tempDir, 'user.json'));
      expect(manager.isPolicyEnforced('allowManagedHooksOnly')).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear cached policy', () => {
      const projPolicyPath = path.join(tempDir, 'project.json');
      const projPolicy: ManagedPolicy = { allowManagedHooksOnly: true };
      fs.writeFileSync(projPolicyPath, JSON.stringify(projPolicy));

      manager = new ManagedPoliciesManager(undefined, projPolicyPath, path.join(tempDir, 'user.json'));
      const first = manager.loadPolicies();
      manager.clearCache();
      const second = manager.loadPolicies();
      expect(first).not.toBe(second);
    });
  });
});
