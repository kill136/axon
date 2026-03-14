/**
 * NetworkTool 测试
 *
 * 测试 AI 通过 NetworkTool 操作 Agent Network 的各个 action
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkTool } from '../../src/tools/network-agent.js';

describe('NetworkTool', () => {
  let tool: NetworkTool;

  beforeEach(() => {
    tool = new NetworkTool();
  });

  describe('metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('AgentNetwork');
    });

    it('should be deferred', () => {
      expect(tool.shouldDefer).toBe(true);
    });

    it('should have searchHint', () => {
      expect(tool.searchHint).toBeTruthy();
      expect(tool.searchHint).toContain('agent');
    });

    it('should have valid input schema', () => {
      const schema = tool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('action');
      expect(schema.required).toContain('action');
      // action 应该有 enum
      expect((schema.properties as any).action.enum).toContain('discover');
      expect((schema.properties as any).action.enum).toContain('send');
      expect((schema.properties as any).action.enum).toContain('call_tool');
      expect((schema.properties as any).action.enum).toContain('delegate');
      expect((schema.properties as any).action.enum).toContain('status');
      expect((schema.properties as any).action.enum).toContain('trust');
      expect((schema.properties as any).action.enum).toContain('audit_log');
    });
  });

  describe('execute without AgentNetwork', () => {
    it('should return error when network not enabled for status', async () => {
      const result = await tool.execute({ action: 'status' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('should return error when network not enabled for discover', async () => {
      const result = await tool.execute({ action: 'discover' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('should return error when network not enabled for send', async () => {
      const result = await tool.execute({ action: 'send', agentId: 'test', method: 'ping' });
      expect(result.success).toBe(false);
    });

    it('should return error when network not enabled for call_tool', async () => {
      const result = await tool.execute({ action: 'call_tool', agentId: 'test', toolName: 'Read' });
      expect(result.success).toBe(false);
    });

    it('should return error when network not enabled for delegate', async () => {
      const result = await tool.execute({ action: 'delegate', agentId: 'test', description: 'do something' });
      expect(result.success).toBe(false);
    });

    it('should return error when network not enabled for audit_log', async () => {
      const result = await tool.execute({ action: 'audit_log' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });

    it('should return error when network not enabled for trust', async () => {
      const result = await tool.execute({ action: 'trust', agentId: 'test', trust: true });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not enabled');
    });
  });

  describe('parameter validation (without network)', () => {
    it('should validate agentId for send action', async () => {
      // Even without network, missing agentId should fail
      const result = await tool.execute({ action: 'send' } as any);
      expect(result.success).toBe(false);
    });

    it('should validate agentId for call_tool action', async () => {
      const result = await tool.execute({ action: 'call_tool' } as any);
      expect(result.success).toBe(false);
    });

    it('should validate description for delegate action', async () => {
      const result = await tool.execute({ action: 'delegate', agentId: 'test' } as any);
      expect(result.success).toBe(false);
    });
  });
});
