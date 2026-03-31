/**
 * RealtimeCoordinator 测试
 * 覆盖：状态管理、pause/resume、getStatus、成本追踪
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RealtimeCoordinator,
  createRealtimeCoordinator,
  createMockTaskExecutor,
} from '../../src/blueprint/index.js';
import type {
  SmartTask,
  ExecutionPlan,
  SwarmConfig,
} from '../../src/blueprint/types.js';

function makeTask(id: string, overrides?: Partial<SmartTask>): SmartTask {
  return {
    id,
    name: `Task ${id}`,
    description: `Description for task ${id}`,
    complexity: 'simple',
    type: 'implement',
    files: [`src/file-${id}.ts`],
    estimatedMinutes: 5,
    group: 0,
    needsTest: false,
    dependencies: [],
    ...overrides,
  } as SmartTask;
}

function makePlan(tasks: SmartTask[], overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  return {
    id: 'plan-1',
    blueprintId: 'bp-1',
    tasks,
    groups: [tasks.map(t => t.id)],
    estimatedMinutes: tasks.length * 5,
    estimatedCost: tasks.length * 0.01,
    ...overrides,
  } as ExecutionPlan;
}

describe('RealtimeCoordinator', () => {
  let coordinator: RealtimeCoordinator;

  beforeEach(() => {
    coordinator = createRealtimeCoordinator();
  });

  describe('getStatus', () => {
    it('should return empty status when no plan is set', () => {
      const status = coordinator.getStatus();
      expect(status.totalTasks).toBe(0);
      expect(status.completedTasks).toBe(0);
      expect(status.currentCost).toBe(0);
    });
  });

  describe('configuration', () => {
    it('should use default config values', () => {
      const coord = createRealtimeCoordinator();
      const status = coord.getStatus();
      expect(status.currentCost).toBe(0);
    });

    it('should accept custom config', () => {
      const coord = createRealtimeCoordinator({
        maxWorkers: 2,
        maxCost: 5,
      });
      expect(coord).toBeDefined();
    });
  });

  describe('pause/resume', () => {
    it('should support pause', () => {
      coordinator.pause();
      // pause 后 getStatus 仍然可用
      const status = coordinator.getStatus();
      expect(status).toBeDefined();
    });
  });

  describe('mock task executor', () => {
    it('should create mock executor with default params', () => {
      const executor = createMockTaskExecutor();
      expect(executor).toBeDefined();
      expect(executor.execute).toBeInstanceOf(Function);
    });

    it('should execute mock tasks successfully with 100% success rate', async () => {
      const executor = createMockTaskExecutor(10, 1.0);
      const task = makeTask('1');
      const result = await executor.execute(task, 'worker-1');
      expect(result.success).toBe(true);
      expect(result.changes).toHaveLength(1);
      expect(result.decisions).toHaveLength(1);
    });

    it('should execute mock tasks with 0% success rate', async () => {
      const executor = createMockTaskExecutor(10, 0.0);
      const task = makeTask('1');
      const result = await executor.execute(task, 'worker-1');
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should include file changes matching task files on success', async () => {
      const executor = createMockTaskExecutor(10, 1.0);
      const task = makeTask('1', { files: ['a.ts', 'b.ts'] });
      const result = await executor.execute(task, 'worker-1');
      expect(result.changes).toHaveLength(2);
      expect(result.changes![0].filePath).toBe('a.ts');
      expect(result.changes![1].filePath).toBe('b.ts');
    });
  });
});
