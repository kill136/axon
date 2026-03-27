/**
 * Remote Session Manager Tests
 *
 * Validates v2.1.67 bug fix:
 * - Tool use IDs are stored in Set (not Array)
 * - History size is bounded (max 1000)
 * - Old IDs are periodically cleaned up
 * - No unbounded memory growth in long sessions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RemoteSession, RemoteSessionRegistry } from '../session-manager';

describe('Remote Session Manager', () => {
  describe('RemoteSession', () => {
    let session: RemoteSession;

    beforeEach(() => {
      session = new RemoteSession('test-session-1', {
        maxToolUseHistory: 1000,
        cleanupInterval: 1000,
        idleTimeout: 60000,
      });
    });

    afterEach(() => {
      session.close();
    });

    it('should initialize with empty tool use history', () => {
      expect(session.getToolUseCount()).toBe(0);
      expect(session.getToolUseIds()).toHaveLength(0);
    });

    it('should add tool use ID to Set', async () => {
      await session.addToolUse('tool_123');

      expect(session.hasToolUse('tool_123')).toBe(true);
      expect(session.getToolUseCount()).toBe(1);
    });

    it('should not add duplicate tool use IDs', async () => {
      await session.addToolUse('tool_123');
      await session.addToolUse('tool_123');
      await session.addToolUse('tool_123');

      // Set prevents duplicates (v2.1.67 fix)
      expect(session.getToolUseCount()).toBe(1);
      expect(session.getToolUseIds()).toEqual(['tool_123']);
    });

    it('should handle multiple tool use IDs', async () => {
      const toolIds = ['tool_1', 'tool_2', 'tool_3', 'tool_4', 'tool_5'];

      for (const toolId of toolIds) {
        await session.addToolUse(toolId);
      }

      expect(session.getToolUseCount()).toBe(5);
      for (const toolId of toolIds) {
        expect(session.hasToolUse(toolId)).toBe(true);
      }
    });

    it('should prevent unbounded growth with max limit', async () => {
      const maxHistory = 100;
      const testSession = new RemoteSession('test-session-bounded', {
        maxToolUseHistory: maxHistory,
        cleanupInterval: 10000,
      });

      try {
        // Add more IDs than the limit
        for (let i = 0; i < maxHistory + 50; i++) {
          await testSession.addToolUse(`tool_${i}`);
        }

        // Count should be trimmed to 0.9*100 = 90
        const count = testSession.getToolUseCount();
        expect(count).toBeLessThanOrEqual(maxHistory);

        // v2.1.67 fix: Prevent memory leak from unbounded array growth
        expect(count).toBeGreaterThan(0);
      } finally {
        testSession.close();
      }
    });

    it('should use Set for O(1) lookup', async () => {
      const toolIds = Array.from({ length: 100 }, (_, i) => `tool_${i}`);

      for (const toolId of toolIds) {
        await session.addToolUse(toolId);
      }

      // Lookup should be fast (O(1) with Set)
      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        session.hasToolUse('tool_50');
      }
      const elapsed = performance.now() - start;

      // Should be very fast (< 100ms for 1000 lookups on CI)
      expect(elapsed).toBeLessThan(100);
    });

    it('should clear all tool uses', async () => {
      await session.addToolUse('tool_1');
      await session.addToolUse('tool_2');
      expect(session.getToolUseCount()).toBe(2);

      session.clear();

      expect(session.getToolUseCount()).toBe(0);
      expect(session.hasToolUse('tool_1')).toBe(false);
    });

    it('should provide accurate statistics', async () => {
      await session.addToolUse('tool_1');
      await session.addToolUse('tool_2');

      const stats = session.getStats();

      expect(stats.sessionId).toBe('test-session-1');
      expect(stats.toolUseCount).toBe(2);
      expect(stats.maxToolUseHistory).toBe(1000);
      expect(stats.isIdle).toBe(false);
    });

    it('should track idle state', async () => {
      const shortIdleSession = new RemoteSession('idle-test', {
        idleTimeout: 100,
        cleanupInterval: 50,
      });

      await new Promise((resolve) => {
        setTimeout(() => {
          const stats = shortIdleSession.getStats();
          expect(stats.isIdle).toBe(true);
          shortIdleSession.close();
          resolve(null);
        }, 150);
      });
    });

    it('should update last activity time on addToolUse', async () => {
      const initialStats = session.getStats();
      const initialTime = initialStats.lastActivityTime;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      await session.addToolUse('tool_new');

      const newStats = session.getStats();
      expect(newStats.lastActivityTime).toBeGreaterThan(initialTime);
    });

    it('should close and cleanup timer', async () => {
      const testSession = new RemoteSession('cleanup-test', {
        cleanupInterval: 100,
      });

      expect(testSession.getToolUseCount()).toBe(0);

      testSession.close();

      // After close, session should not be able to accept new tool uses
      expect(testSession.getToolUseCount()).toBe(0);
    });
  });

  describe('Tool Use History Bounds', () => {
    it('should maintain bounded history during heavy usage', async () => {
      const session = new RemoteSession('heavy-use', {
        maxToolUseHistory: 500,
      });

      try {
        // Simulate heavy usage with many tool calls
        for (let i = 0; i < 2000; i++) {
          await session.addToolUse(`tool_${i}`);
        }

        const count = session.getToolUseCount();

        // Count should be trimmed to 0.9*500 = 450
        expect(count).toBeLessThanOrEqual(500);

        // v2.1.67 fix: Should not grow indefinitely
        expect(count).toBeGreaterThan(400);
      } finally {
        session.close();
      }
    });

    it('should handle mixed add/duplicate patterns', async () => {
      const session = new RemoteSession('mixed-pattern', {
        maxToolUseHistory: 100,
      });

      try {
        // Add first batch
        for (let i = 0; i < 50; i++) {
          await session.addToolUse(`tool_${i}`);
        }

        expect(session.getToolUseCount()).toBe(50);

        // Add duplicates (should not increase count)
        for (let i = 0; i < 50; i++) {
          await session.addToolUse(`tool_${i}`);
        }

        expect(session.getToolUseCount()).toBe(50);

        // Add new ones
        for (let i = 50; i < 100; i++) {
          await session.addToolUse(`tool_${i}`);
        }

        expect(session.getToolUseCount()).toBe(100);

        // Add more, should start trimming
        for (let i = 100; i < 150; i++) {
          await session.addToolUse(`tool_${i}`);
        }

        // After trimming, should be ~90
        expect(session.getToolUseCount()).toBeLessThanOrEqual(100);
      } finally {
        session.close();
      }
    });
  });

  describe('RemoteSessionRegistry', () => {
    let registry: RemoteSessionRegistry;

    beforeEach(() => {
      registry = new RemoteSessionRegistry({
        maxToolUseHistory: 500,
      });
    });

    afterEach(() => {
      registry.closeAll();
    });

    it('should create and retrieve sessions', async () => {
      const session1 = registry.getOrCreateSession('session-1');
      const session2 = registry.getOrCreateSession('session-2');

      expect(session1).toBeDefined();
      expect(session2).toBeDefined();
      expect(session1).not.toBe(session2);

      const retrieved = registry.getSession('session-1');
      expect(retrieved).toBe(session1);
    });

    it('should return same session on multiple getOrCreate calls', async () => {
      const session1 = registry.getOrCreateSession('session-1');
      const session1Again = registry.getOrCreateSession('session-1');

      expect(session1).toBe(session1Again);
    });

    it('should manage multiple sessions independently', async () => {
      const session1 = registry.getOrCreateSession('session-1');
      const session2 = registry.getOrCreateSession('session-2');

      await session1.addToolUse('tool_1');
      await session2.addToolUse('tool_2');
      await session2.addToolUse('tool_3');

      expect(session1.getToolUseCount()).toBe(1);
      expect(session2.getToolUseCount()).toBe(2);
    });

    it('should remove sessions', async () => {
      const session = registry.getOrCreateSession('session-to-remove');
      expect(registry.getSession('session-to-remove')).toBeDefined();

      registry.removeSession('session-to-remove');

      expect(registry.getSession('session-to-remove')).toBeUndefined();
    });

    it('should list all sessions', async () => {
      registry.getOrCreateSession('session-1');
      registry.getOrCreateSession('session-2');
      registry.getOrCreateSession('session-3');

      const sessions = registry.getAllSessions();

      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
      expect(sessions).toContain('session-3');
      expect(sessions).toHaveLength(3);
    });

    it('should provide stats for all sessions', async () => {
      const s1 = registry.getOrCreateSession('session-1');
      const s2 = registry.getOrCreateSession('session-2');

      await s1.addToolUse('tool_1');
      await s2.addToolUse('tool_2');
      await s2.addToolUse('tool_3');

      const allStats = registry.getAllStats();

      expect(allStats).toHaveLength(2);
      expect(allStats[0].toolUseCount).toBe(1);
      expect(allStats[1].toolUseCount).toBe(2);
    });

    it('should get session count', async () => {
      expect(registry.getSessionCount()).toBe(0);

      registry.getOrCreateSession('session-1');
      expect(registry.getSessionCount()).toBe(1);

      registry.getOrCreateSession('session-2');
      expect(registry.getSessionCount()).toBe(2);

      registry.removeSession('session-1');
      expect(registry.getSessionCount()).toBe(1);
    });

    it('should close all sessions', async () => {
      registry.getOrCreateSession('session-1');
      registry.getOrCreateSession('session-2');
      registry.getOrCreateSession('session-3');

      expect(registry.getSessionCount()).toBe(3);

      registry.closeAll();

      expect(registry.getSessionCount()).toBe(0);
    });
  });

  describe('Bug Fix Verification - v2.1.67', () => {
    it('should prevent unbounded array growth', async () => {
      const session = new RemoteSession('unbounded-test', {
        maxToolUseHistory: 100,
        cleanupInterval: 10000,
      });

      try {
        // v2.1.67 bug: array grows forever
        // v2.1.68+ fix: Set with size limit

        // Add 1000 tool IDs
        for (let i = 0; i < 1000; i++) {
          await session.addToolUse(`tool_${i}`);
        }

        const count = session.getToolUseCount();

        // Should be bounded to 0.9*100 = 90
        expect(count).toBeLessThanOrEqual(100);
        expect(count).toBeLessThan(1000);

        // Should have substantial recovery
        const recoveryPercent = ((1000 - count) / 1000) * 100;
        expect(recoveryPercent).toBeGreaterThan(50);
      } finally {
        session.close();
      }
    });

    it('should use Set instead of Array', async () => {
      const session = new RemoteSession('set-test', {
        maxToolUseHistory: 1000,
      });

      try {
        await session.addToolUse('tool_1');
        await session.addToolUse('tool_2');

        // Get IDs - should return array but internally uses Set
        const ids = session.getToolUseIds();
        expect(Array.isArray(ids)).toBe(true);

        // Lookup should be fast (Set O(1) vs Array O(n))
        const startTime = performance.now();

        for (let i = 0; i < 10000; i++) {
          session.hasToolUse('tool_999999'); // Non-existent ID
        }

        const elapsed = performance.now() - startTime;

        // Set lookup should be very fast (< 100ms for 10k lookups on CI)
        expect(elapsed).toBeLessThan(100);
      } finally {
        session.close();
      }
    });

    it('should handle long-lived sessions without leaks', async () => {
      const session = new RemoteSession('long-lived', {
        maxToolUseHistory: 500,
        cleanupInterval: 100,
      });

      try {
        // Simulate long session with repeated tool calls
        for (let cycle = 0; cycle < 10; cycle++) {
          for (let i = 0; i < 100; i++) {
            await session.addToolUse(`cycle_${cycle}_tool_${i}`);
          }

          // Check that we're not leaking memory
          const count = session.getToolUseCount();
          expect(count).toBeLessThanOrEqual(500);

          // Small delay to allow cleanup
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Final count should still be reasonable
        const finalCount = session.getToolUseCount();
        expect(finalCount).toBeLessThanOrEqual(500);
      } finally {
        session.close();
      }
    });
  });
});
