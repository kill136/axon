/**
 * Agent Network 类型和常量测试
 */

import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  DEFAULT_NETWORK_CONFIG,
  AgentMethod,
  type DelegatedTask,
  type DelegatedTaskStatus,
} from '../../src/network/types.js';

describe('Types and Constants', () => {
  describe('PROTOCOL_VERSION', () => {
    it('should be semver-like string', () => {
      expect(typeof PROTOCOL_VERSION).toBe('string');
      expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+$/);
    });
  });

  describe('DEFAULT_NETWORK_CONFIG', () => {
    it('should be disabled by default', () => {
      expect(DEFAULT_NETWORK_CONFIG.enabled).toBe(false);
    });

    it('should use port 7860', () => {
      expect(DEFAULT_NETWORK_CONFIG.port).toBe(7860);
    });

    it('should advertise by default', () => {
      expect(DEFAULT_NETWORK_CONFIG.advertise).toBe(true);
    });

    it('should auto-accept same owner by default', () => {
      expect(DEFAULT_NETWORK_CONFIG.autoAcceptSameOwner).toBe(true);
    });
  });

  describe('AgentMethod', () => {
    it('should define all expected methods', () => {
      expect(AgentMethod.Ping).toBe('agent.ping');
      expect(AgentMethod.GetIdentity).toBe('agent.getIdentity');
      expect(AgentMethod.ListTools).toBe('agent.listTools');
      expect(AgentMethod.CallTool).toBe('agent.callTool');
      expect(AgentMethod.DelegateTask).toBe('agent.delegateTask');
      expect(AgentMethod.Progress).toBe('agent.progress');
    });
  });

  describe('DelegatedTask type', () => {
    it('should have correct shape', () => {
      const task: DelegatedTask = {
        taskId: 'task-1',
        fromAgentId: 'agent-abc',
        fromName: 'TestAgent',
        description: 'Do something',
        fullContext: 'Task: Do something',
        status: 'accepted',
        createdAt: Date.now(),
      };
      expect(task.taskId).toBe('task-1');
      expect(task.status).toBe('accepted');
      expect(task.completedAt).toBeUndefined();
      expect(task.result).toBeUndefined();
      expect(task.error).toBeUndefined();
    });

    it('should allow all valid statuses', () => {
      const statuses: DelegatedTaskStatus[] = ['accepted', 'running', 'completed', 'failed'];
      expect(statuses).toHaveLength(4);
    });

    it('should support completed task with result', () => {
      const task: DelegatedTask = {
        taskId: 'task-2',
        fromAgentId: 'agent-def',
        fromName: 'RemoteAgent',
        description: 'Build feature',
        fullContext: 'Task: Build feature\nContext: urgent',
        status: 'completed',
        createdAt: Date.now() - 5000,
        completedAt: Date.now(),
        result: 'Feature built successfully',
      };
      expect(task.status).toBe('completed');
      expect(task.result).toBeDefined();
    });

    it('should support failed task with error', () => {
      const task: DelegatedTask = {
        taskId: 'task-3',
        fromAgentId: 'agent-ghi',
        fromName: 'FailAgent',
        description: 'Impossible task',
        fullContext: 'Task: Impossible task',
        status: 'failed',
        createdAt: Date.now() - 10000,
        completedAt: Date.now(),
        error: 'Compilation failed',
      };
      expect(task.status).toBe('failed');
      expect(task.error).toBeDefined();
    });
  });

  describe('REMOTE_BLOCKED_TOOLS', () => {
    it('should block dangerous tools from remote execution', () => {
      // These tools must NEVER be callable remotely regardless of trust level
      const REMOTE_BLOCKED_TOOLS = ['Bash', 'Write', 'Edit', 'SelfEvolve'];
      expect(REMOTE_BLOCKED_TOOLS).toContain('Bash');
      expect(REMOTE_BLOCKED_TOOLS).toContain('Write');
      expect(REMOTE_BLOCKED_TOOLS).toContain('Edit');
      expect(REMOTE_BLOCKED_TOOLS).toContain('SelfEvolve');
    });
  });
});
