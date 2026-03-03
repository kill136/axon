/**
 * tRPC Coordinator Router
 *
 * 协调器相关 API - 类型安全版本
 */

import { z } from 'zod';
import { router, publicProcedure } from '../index.js';
import { TRPCError } from '@trpc/server';

// ============================================================================
// Schema 定义
// ============================================================================

const WorkerStatusSchema = z.enum(['idle', 'running', 'paused', 'completed', 'error']);

const WorkerSchema = z.object({
  id: z.string(),
  status: WorkerStatusSchema,
  currentTaskId: z.string().optional(),
  currentTaskName: z.string().optional(),
  branchName: z.string().optional(),
  progress: z.number(),
  errorCount: z.number(),
  createdAt: z.string(),
  lastActiveAt: z.string(),
});

const DashboardSchema = z.object({
  workers: z.object({
    total: z.number(),
    active: z.number(),
    idle: z.number(),
    error: z.number(),
  }),
  tasks: z.object({
    total: z.number(),
    pending: z.number(),
    running: z.number(),
    completed: z.number(),
    failed: z.number(),
  }),
});

// ============================================================================
// Coordinator Router
// ============================================================================

export const coordinatorRouter = router({
  /**
   * 获取所有 Worker 状态
   * GET /coordinator/workers -> trpc.coordinator.getWorkers
   */
  getWorkers: publicProcedure.query(async () => {
    const { workerTracker } = await import('../../routes/blueprint-api.js');
    return workerTracker.getAll();
  }),

  /**
   * 获取 Worker 日志
   * GET /coordinator/workers/:workerId/logs -> trpc.coordinator.getWorkerLogs
   */
  getWorkerLogs: publicProcedure
    .input(z.object({
      workerId: z.string(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const { workerTracker } = await import('../../routes/blueprint-api.js');
      return workerTracker.getLogs(input.workerId, input.limit);
    }),

  /**
   * 通过任务 ID 获取关联的 Worker 执行日志
   * GET /coordinator/tasks/:taskId/logs -> trpc.coordinator.getTaskLogs
   */
  getTaskLogs: publicProcedure
    .input(z.object({
      taskId: z.string(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const { workerTracker } = await import('../../routes/blueprint-api.js');
      const workerId = workerTracker.getWorkerByTaskId(input.taskId);

      if (!workerId) {
        return {
          logs: [],
          workerId: null,
          message: 'No Worker assigned to this task yet',
        };
      }

      // v4.1: 使用 getLogsByTaskId 按任务ID过滤日志，而不是返回整个 Worker 的日志
      return {
        logs: workerTracker.getLogsByTaskId(input.taskId, input.limit),
        workerId,
      };
    }),

  /**
   * 获取仪表盘数据
   * GET /coordinator/dashboard -> trpc.coordinator.getDashboard
   */
  getDashboard: publicProcedure.query(async () => {
    const { workerTracker, executionManager } = await import('../../routes/blueprint-api.js');

    const workerStats = workerTracker.getStats();

    // 统计任务信息（从所有活跃会话中收集）
    let taskStats = {
      total: 0,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };

    // 遍历所有执行会话统计任务
    const sessions = Array.from((executionManager as any).sessions?.values() || []);
    for (const session of sessions) {
      const status = (session as any).coordinator?.getStatus?.();
      if (status?.stats) {
        taskStats.total += status.stats.totalTasks || 0;
        taskStats.pending += status.stats.pendingTasks || 0;
        taskStats.running += status.stats.runningTasks || 0;
        taskStats.completed += status.stats.completedTasks || 0;
        taskStats.failed += status.stats.failedTasks || 0;
      }
    }

    return {
      workers: workerStats,
      tasks: taskStats,
    };
  }),

  /**
   * 停止/暂停协调器
   * POST /coordinator/stop -> trpc.coordinator.stop
   */
  stop: publicProcedure.mutation(async () => {
    const { executionManager } = await import('../../routes/blueprint-api.js');

    const sessions = Array.from((executionManager as any).sessions?.values() || []);
    let pausedCount = 0;
    for (const session of sessions) {
      if (!(session as any).completedAt) {
        (session as any).coordinator?.pause?.();
        pausedCount++;
      }
    }

    return { pausedSessions: pausedCount };
  }),

  /**
   * 启动/恢复协调器
   * POST /coordinator/start -> trpc.coordinator.start
   */
  start: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { executionManager, blueprintStore } = await import('../../routes/blueprint-api.js');

      const { blueprintId } = input;
      console.log('[coordinator/start] Received request:', { blueprintId });

      // 检查是否有现有会话
      const existingSession = executionManager.getSessionByBlueprint(blueprintId);

      if (existingSession) {
        // 如果会话已完成，返回提示
        if ((existingSession as any).completedAt) {
          return {
            resumed: false,
            blueprintId,
            executionId: existingSession.id,
            message: 'Execution completed, please create a new blueprint',
          };
        }

        // 恢复暂停的会话
        (existingSession as any).coordinator?.resume?.();
        console.log('[coordinator/start] Resuming session:', existingSession.id);

        return {
          resumed: true,
          blueprintId,
          executionId: existingSession.id,
          planId: (existingSession as any).plan?.id,
          message: 'Execution resumed',
        };
      }

      // 检查是否有可恢复的状态
      if (executionManager.hasRecoverableState(blueprintId)) {
        try {
          const recoveredSession = await executionManager.restoreSessionFromState(blueprintId);
          if (recoveredSession) {
            console.log('[coordinator/start] Recovered session from state:', recoveredSession.id);
            return {
              recovered: true,
              blueprintId,
              executionId: recoveredSession.id,
              planId: (recoveredSession as any).plan?.id,
              message: 'Execution recovered from interrupted state',
            };
          }
        } catch (recoverError: any) {
          console.warn('[coordinator/start] Recovery failed, creating new execution:', recoverError.message);
        }
      }

      // 获取蓝图
      const blueprint = blueprintStore.get(blueprintId);
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blueprint not found',
        });
      }

      // 创建新执行
      const session = await executionManager.startExecution(blueprint);
      console.log('[coordinator/start] Created new execution:', session.id);

      return {
        started: true,
        blueprintId,
        executionId: session.id,
        planId: (session as any).plan?.id,
        totalTasks: (session as any).plan?.tasks?.length || 0,
        parallelGroups: (session as any).plan?.parallelGroups?.length || 0,
        estimatedMinutes: (session as any).plan?.estimatedMinutes,
        estimatedCost: (session as any).plan?.estimatedCost,
        message: 'New execution started',
      };
    }),

  /**
   * 获取执行计划
   * GET /coordinator/plan/:blueprintId -> trpc.coordinator.getPlan
   */
  getPlan: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
    }))
    .query(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const session = executionManager.getSessionByBlueprint(input.blueprintId);
      if (!session) {
        return null;
      }

      const plan = (session as any).plan;
      if (!plan) {
        return null;
      }

      // 获取最新的任务状态
      const currentStatus = (session as any).coordinator?.getStatus?.();
      const taskStatusMap = new Map<string, string>();
      if (currentStatus?.taskStatuses) {
        for (const [taskId, status] of Object.entries(currentStatus.taskStatuses)) {
          taskStatusMap.set(taskId, status as string);
        }
      }

      // 内联序列化
      const serializeTask = (task: any) => ({
        id: task.id,
        name: task.name,
        description: task.description,
        type: task.type,
        complexity: task.complexity,
        blueprintId: task.blueprintId,
        moduleId: task.moduleId,
        files: task.files,
        dependencies: task.dependencies,
        needsTest: task.needsTest,
        estimatedMinutes: task.estimatedMinutes,
        status: taskStatusMap.get(task.id) || task.status,
        workerId: task.workerId,
        startedAt: task.startedAt instanceof Date ? task.startedAt.toISOString() : task.startedAt,
        completedAt: task.completedAt instanceof Date ? task.completedAt.toISOString() : task.completedAt,
      });

      const serializedPlan = {
        id: plan.id,
        blueprintId: plan.blueprintId,
        tasks: plan.tasks.map(serializeTask),
        parallelGroups: plan.parallelGroups,
        estimatedCost: plan.estimatedCost,
        estimatedMinutes: plan.estimatedMinutes,
        autoDecisions: plan.autoDecisions,
        status: plan.status,
        createdAt: plan.createdAt instanceof Date ? plan.createdAt.toISOString() : plan.createdAt,
        startedAt: plan.startedAt instanceof Date ? plan.startedAt.toISOString() : plan.startedAt,
        completedAt: plan.completedAt instanceof Date ? plan.completedAt.toISOString() : plan.completedAt,
      };

      return serializedPlan;
    }),

  /**
   * 获取可恢复状态
   * GET /coordinator/recoverable/:blueprintId -> trpc.coordinator.getRecoverableState
   */
  getRecoverableState: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
    }))
    .query(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');
      return executionManager.getRecoverableState(input.blueprintId);
    }),

  /**
   * 恢复执行
   * POST /coordinator/recover/:blueprintId -> trpc.coordinator.recover
   */
  recover: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { executionManager, blueprintStore } = await import('../../routes/blueprint-api.js');

      // 检查是否已有活跃会话
      const existingSession = executionManager.getSessionByBlueprint(input.blueprintId);
      if (existingSession) {
        // 恢复会话
        (existingSession as any).coordinator?.resume?.();
        return {
          executionId: existingSession.id,
          blueprintId: input.blueprintId,
          message: 'Session recovered',
        };
      }

      // 检查是否有可恢复的状态
      if (executionManager.hasRecoverableState(input.blueprintId)) {
        const recoveredSession = await executionManager.restoreSessionFromState(input.blueprintId);
        if (recoveredSession) {
          return {
            executionId: recoveredSession.id,
            blueprintId: input.blueprintId,
            message: 'Successfully recovered execution from interrupted state',
          };
        }
      }

      // 没有可恢复的状态，尝试启动新执行
      const blueprint = blueprintStore.get(input.blueprintId);
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blueprint not found',
        });
      }

      const session = await executionManager.startExecution(blueprint);
      return {
        executionId: session.id,
        blueprintId: input.blueprintId,
        message: 'New execution created',
      };
    }),

  /**
   * 获取成本估算
   * GET /coordinator/cost/:blueprintId -> trpc.coordinator.getCost
   */
  getCost: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
    }))
    .query(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const session = executionManager.getSessionByBlueprint(input.blueprintId);
      if (!session) {
        return {
          totalEstimated: 0,
          currentSpent: 0,
          remainingEstimated: 0,
          breakdown: [],
        };
      }

      const status = (session as any).coordinator?.getStatus?.();
      const plan = (session as any).plan;

      return {
        totalEstimated: plan?.estimatedCost || 0,
        currentSpent: status?.stats?.currentCost || 0,
        remainingEstimated: Math.max(0, (plan?.estimatedCost || 0) - (status?.stats?.currentCost || 0)),
        breakdown: [
          { model: 'sonnet', tasks: plan?.tasks?.length || 0, cost: plan?.estimatedCost || 0 },
        ],
      };
    }),
});

export type CoordinatorRouter = typeof coordinatorRouter;
