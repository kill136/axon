/**
 * tRPC Execution Router
 *
 * 执行控制相关 API - 类型安全版本
 */

import { z } from 'zod';
import { router, publicProcedure } from '../index.js';
import { TRPCError } from '@trpc/server';

// ============================================================================
// Schema 定义
// ============================================================================

const ExecutionStatusSchema = z.object({
  planId: z.string(),
  blueprintId: z.string(),
  totalTasks: z.number(),
  completedTasks: z.number(),
  failedTasks: z.number(),
  runningTasks: z.number(),
  activeWorkers: z.number(),
  startedAt: z.string(),
  estimatedCompletion: z.string().optional(),
  currentCost: z.number(),
  estimatedTotalCost: z.number(),
  isCompleted: z.boolean(),
});

const VerificationStatusSchema = z.object({
  status: z.enum(['idle', 'checking_env', 'running_tests', 'fixing', 'passed', 'failed']),
  result: z.object({
    status: z.string(),
    totalTests: z.number(),
    passedTests: z.number(),
    failedTests: z.number(),
    skippedTests: z.number(),
    duration: z.number(),
    output: z.string(),
    error: z.string().optional(),
  }).optional(),
});

// ============================================================================
// Execution Router
// ============================================================================

export const executionRouter = router({
  /**
   * 获取执行状态
   * GET /execution/:id/status -> trpc.execution.getStatus
   */
  getStatus: publicProcedure
    .input(z.object({
      executionId: z.string(),
    }))
    .query(async ({ input }) => {
      // 直接导入已 export 的单例
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const status = executionManager.getStatus(input.executionId);
      if (!status) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Execution session not found',
        });
      }

      const session = executionManager.getSession(input.executionId);

      return {
        ...status,
        isCompleted: !!session?.completedAt,
        result: session?.result,
      };
    }),

  /**
   * 暂停执行
   * POST /execution/:id/pause -> trpc.execution.pause
   */
  pause: publicProcedure
    .input(z.object({
      executionId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const success = executionManager.pause(input.executionId);
      if (!success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot pause execution (may be completed or not found)',
        });
      }

      return { message: 'Execution paused' };
    }),

  /**
   * 恢复执行
   * POST /execution/:id/resume -> trpc.execution.resume
   */
  resume: publicProcedure
    .input(z.object({
      executionId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const success = executionManager.resume(input.executionId);
      if (!success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot resume execution (may be completed or not found)',
        });
      }

      return { message: 'Execution resumed' };
    }),

  /**
   * 取消执行
   * POST /execution/:id/cancel -> trpc.execution.cancel
   */
  cancel: publicProcedure
    .input(z.object({
      executionId: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const success = executionManager.cancel(input.executionId);
      if (!success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot cancel execution (may be completed or not found)',
        });
      }

      return { message: 'Execution cancelled' };
    }),

  /**
   * 获取验收测试状态
   * GET /execution/:blueprintId/verification -> trpc.execution.getVerificationStatus
   */
  getVerificationStatus: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
    }))
    .query(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const status = executionManager.getVerificationStatus(input.blueprintId);
      return status || { status: 'idle' as const };
    }),

  /**
   * 启动 E2E 端到端验收测试
   * POST /execution/:blueprintId/verify-e2e -> trpc.execution.startE2EVerification
   */
  startE2EVerification: publicProcedure
    .input(z.object({
      blueprintId: z.string(),
      config: z.object({
        similarityThreshold: z.number().default(80),
        autoFix: z.boolean().default(true),
        maxFixAttempts: z.number().default(3),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { executionEventEmitter, blueprintStore } = await import('../../routes/blueprint-api.js');

      const blueprint = blueprintStore.get(input.blueprintId);

      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blueprint not found',
        });
      }

      // E2E 测试通过事件触发
      executionEventEmitter.emit('e2e:start_request', {
        blueprintId: input.blueprintId,
        blueprint,
        config: input.config || {
          similarityThreshold: 80,
          autoFix: true,
          maxFixAttempts: 3,
        },
      });

      return {
        message: 'E2E test request submitted, please ensure the browser MCP extension is connected',
        hint: 'E2E test will launch the app, open a browser, run acceptance tests by business flow, and compare with design images',
      };
    }),
});

export type ExecutionRouter = typeof executionRouter;
