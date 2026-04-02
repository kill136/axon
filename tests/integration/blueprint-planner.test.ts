/**
 * Blueprint 核心模块测试
 * 覆盖：ModelSelector、TaskQueue 生命周期
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ModelSelector,
  MODEL_PRICING,
  TaskQueue,
  type QueueTaskExecutor,
} from '../../src/blueprint/index.js';
import type { SmartTask, TaskResult, SwarmConfig, ModelType } from '../../src/blueprint/types.js';

// ============================================================================
// ModelSelector 测试
// ============================================================================

describe('ModelSelector', () => {
  let selector: ModelSelector;
  let baseConfig: SwarmConfig;

  beforeEach(() => {
    selector = new ModelSelector();
    baseConfig = {
      defaultModel: 'sonnet' as ModelType,
      simpleTaskModel: 'haiku' as ModelType,
      complexTaskModel: 'opus' as ModelType,
      maxWorkers: 3,
      maxRetries: 2,
      maxCost: 10,
      costWarningThreshold: 0.8,
    } as SwarmConfig;
  });

  it('should map trivial tasks to simpleTaskModel', () => {
    const task = { complexity: 'trivial', type: 'implement' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('haiku');
  });

  it('should map simple tasks to simpleTaskModel', () => {
    const task = { complexity: 'simple', type: 'implement' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('haiku');
  });

  it('should map moderate tasks to defaultModel', () => {
    const task = { complexity: 'moderate', type: 'implement' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('sonnet');
  });

  it('should map complex tasks to complexTaskModel', () => {
    const task = { complexity: 'complex', type: 'implement' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('opus');
  });

  it('should upgrade haiku to defaultModel for integrate tasks', () => {
    const task = { complexity: 'simple', type: 'integrate' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('sonnet');
  });

  it('should upgrade haiku to defaultModel for refactor tasks', () => {
    const task = { complexity: 'trivial', type: 'refactor' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('sonnet');
  });

  it('should downgrade opus to defaultModel for config tasks', () => {
    const task = { complexity: 'complex', type: 'config' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('sonnet');
  });

  it('should downgrade opus to defaultModel for docs tasks', () => {
    const task = { complexity: 'complex', type: 'docs' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.model).toBe('sonnet');
  });

  it('should include reason in selection', () => {
    const task = { complexity: 'moderate', type: 'implement' } as SmartTask;
    const result = selector.selectModel(task, baseConfig);
    expect(result.reason).toContain('moderate');
    expect(result.reason).toContain('sonnet');
  });

  it('should calculate actual cost correctly', () => {
    const cost = selector.calculateActualCost('sonnet', 1000, 500);
    const expected = (1000 * MODEL_PRICING.sonnet.input + 500 * MODEL_PRICING.sonnet.output) / 1000;
    expect(cost).toBeCloseTo(expected);
  });

  it('should calculate cost for all model types', () => {
    for (const model of ['haiku', 'sonnet', 'opus'] as ModelType[]) {
      const cost = selector.calculateActualCost(model, 1000, 1000);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it('should order model pricing: haiku < sonnet < opus', () => {
    const haikuCost = selector.calculateActualCost('haiku', 1000, 1000);
    const sonnetCost = selector.calculateActualCost('sonnet', 1000, 1000);
    const opusCost = selector.calculateActualCost('opus', 1000, 1000);
    expect(haikuCost).toBeLessThan(sonnetCost);
    expect(sonnetCost).toBeLessThan(opusCost);
  });
});

// ============================================================================
// TaskQueue 测试
// ============================================================================

describe('TaskQueue', () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue('/tmp/test-project');
  });

  function makeMockTask(id: string, name: string): SmartTask {
    return { id, name, complexity: 'simple', type: 'implement' } as SmartTask;
  }

  function makeSuccessExecutor(): QueueTaskExecutor {
    return {
      async execute(task: SmartTask): Promise<TaskResult> {
        return { success: true, changes: [], decisions: [] };
      },
    };
  }

  function makeFailExecutor(): QueueTaskExecutor {
    return {
      async execute(task: SmartTask): Promise<TaskResult> {
        return { success: false, changes: [], decisions: [], error: 'mock error' };
      },
    };
  }

  it('should execute tasks serially and return success', async () => {
    const tasks = [makeMockTask('1', 'Task 1'), makeMockTask('2', 'Task 2')];
    const result = await queue.execute(tasks, makeSuccessExecutor());
    expect(result.success).toBe(true);
    expect(result.completedCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('should stop on first failure', async () => {
    const tasks = [makeMockTask('1', 'Task 1'), makeMockTask('2', 'Task 2')];
    let callCount = 0;
    const executor: QueueTaskExecutor = {
      async execute(): Promise<TaskResult> {
        callCount++;
        if (callCount === 1) return { success: true, changes: [], decisions: [] };
        return { success: false, changes: [], decisions: [], error: 'fail' };
      },
    };
    const result = await queue.execute(tasks, executor);
    expect(result.success).toBe(false);
    expect(result.completedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(callCount).toBe(2);
  });

  it('should handle empty task list', async () => {
    const result = await queue.execute([], makeSuccessExecutor());
    expect(result.success).toBe(true);
    expect(result.completedCount).toBe(0);
  });

  it('should throw when executing while already running', async () => {
    const tasks = [makeMockTask('1', 'Task 1')];
    const slowExecutor: QueueTaskExecutor = {
      async execute(): Promise<TaskResult> {
        await new Promise(r => setTimeout(r, 100));
        return { success: true, changes: [], decisions: [] };
      },
    };
    const p1 = queue.execute(tasks, slowExecutor);
    await expect(queue.execute(tasks, slowExecutor)).rejects.toThrow('already executing');
    await p1;
  });

  it('should support cancellation', async () => {
    const tasks = [makeMockTask('1', 'T1'), makeMockTask('2', 'T2'), makeMockTask('3', 'T3')];
    let callCount = 0;
    const executor: QueueTaskExecutor = {
      async execute(): Promise<TaskResult> {
        callCount++;
        if (callCount === 1) queue.cancel();
        return { success: true, changes: [], decisions: [] };
      },
    };
    const result = await queue.execute(tasks, executor);
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('should emit events during execution', async () => {
    const tasks = [makeMockTask('1', 'Task 1')];
    const events: string[] = [];
    queue.on('queue:started', () => events.push('started'));
    queue.on('task:started', () => events.push('task:started'));
    queue.on('task:completed', () => events.push('task:completed'));
    queue.on('progress:update', () => events.push('progress'));
    queue.on('queue:completed', () => events.push('completed'));

    await queue.execute(tasks, makeSuccessExecutor());
    expect(events).toEqual(['started', 'task:started', 'task:completed', 'progress', 'completed']);
  });

  it('should handle executor throwing exceptions', async () => {
    const tasks = [makeMockTask('1', 'Task 1')];
    const executor: QueueTaskExecutor = {
      async execute(): Promise<TaskResult> {
        throw new Error('unexpected crash');
      },
    };
    const result = await queue.execute(tasks, executor);
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(result.error).toContain('unexpected crash');
  });

  it('should report running state correctly', async () => {
    expect(queue.running).toBe(false);
    const tasks = [makeMockTask('1', 'T1')];
    let wasRunning = false;
    const executor: QueueTaskExecutor = {
      async execute(): Promise<TaskResult> {
        wasRunning = queue.running;
        return { success: true, changes: [], decisions: [] };
      },
    };
    await queue.execute(tasks, executor);
    expect(wasRunning).toBe(true);
    expect(queue.running).toBe(false);
  });
});
