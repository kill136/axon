/**
 * tRPC Blueprint Router
 *
 * 蓝图相关 API - 类型安全版本
 * 替代原来 blueprint-api.ts 中的手工封装
 */

import { z } from 'zod';
import { router, publicProcedure } from '../index.js';
import { TRPCError } from '@trpc/server';
import { blueprintStore } from '../../routes/blueprint-api.js';

// ============================================================================
// Schema 定义
// ============================================================================

const TechStackSchema = z.object({
  language: z.string().optional(),
  framework: z.string().optional(),
  packageManager: z.string().optional(),
  testFramework: z.string().optional(),
  buildTool: z.string().optional(),
});

const ModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: z.string(),
  files: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
});

const BlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  projectPath: z.string(),
  requirements: z.array(z.string()),
  techStack: TechStackSchema,
  modules: z.array(ModuleSchema),
  constraints: z.array(z.string()),
  status: z.enum(['draft', 'confirmed', 'executing', 'completed', 'paused', 'failed']),
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedAt: z.string().optional(),
});

const CreateBlueprintInputSchema = z.object({
  name: z.string().min(1, 'Blueprint name cannot be empty'),
  description: z.string().optional(),
  projectPath: z.string().min(1, 'Project path cannot be empty'),
  requirements: z.array(z.string()).optional(),
  techStack: TechStackSchema.optional(),
  constraints: z.array(z.string()).optional(),
});

// ============================================================================
// Blueprint Router
// ============================================================================

export const blueprintRouter = router({
  /**
   * 获取所有蓝图
   * GET /blueprints -> trpc.blueprint.list
   */
  list: publicProcedure
    .input(z.object({
      projectPath: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      const filterPath = input?.projectPath;
      const blueprints = blueprintStore.getAll(filterPath);

      return blueprints.map(b => ({
        ...b,
        moduleCount: b.modules?.length || 0,
        processCount: (b as any).businessProcesses?.length || 0,
        nfrCount: (b as any).nfrs?.length || 0,
        // 转换日期为字符串
        createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
        updatedAt: b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
        confirmedAt: b.confirmedAt instanceof Date ? b.confirmedAt.toISOString() : b.confirmedAt,
      }));
    }),

  /**
   * 获取单个蓝图详情
   * GET /blueprints/:id -> trpc.blueprint.get
   */
  get: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .query(async ({ input }) => {
      const blueprint = blueprintStore.get(input.id);
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blueprint not found',
        });
      }

      return {
        ...blueprint,
        createdAt: blueprint.createdAt instanceof Date ? blueprint.createdAt.toISOString() : blueprint.createdAt,
        updatedAt: blueprint.updatedAt instanceof Date ? blueprint.updatedAt.toISOString() : blueprint.updatedAt,
        confirmedAt: blueprint.confirmedAt instanceof Date ? blueprint.confirmedAt.toISOString() : blueprint.confirmedAt,
      };
    }),

  /**
   * 创建蓝图
   * POST /blueprints -> trpc.blueprint.create
   */
  create: publicProcedure
    .input(CreateBlueprintInputSchema)
    .mutation(async ({ input }) => {
      const { createSmartPlanner } = await import('../../../../blueprint/index.js');
      type Blueprint = import('../../../../blueprint/index.js').Blueprint;
      const { v4: uuidv4 } = await import('uuid');

      // 检查该项目路径是否已存在蓝图
      const existingBlueprint = blueprintStore.getByProjectPath(input.projectPath);
      if (existingBlueprint) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A blueprint already exists for this project path: "${existingBlueprint.name}" (ID: ${existingBlueprint.id})`,
        });
      }

      // 如果提供了完整需求，直接创建蓝图
      if (input.requirements && input.requirements.length > 0) {
        const blueprint = {
          id: uuidv4(),
          name: input.name,
          description: input.description || input.requirements[0],
          projectPath: input.projectPath,
          requirements: input.requirements,
          techStack: input.techStack || {
            language: 'typescript',
            packageManager: 'npm',
            testFramework: 'vitest',
          },
          modules: [],
          constraints: input.constraints || [],
          status: 'confirmed' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          confirmedAt: new Date(),
        };

        blueprintStore.save(blueprint as any);

        return {
          blueprint: {
            ...blueprint,
            createdAt: blueprint.createdAt.toISOString(),
            updatedAt: blueprint.updatedAt.toISOString(),
            confirmedAt: blueprint.confirmedAt.toISOString(),
          },
          message: 'Blueprint created successfully',
        };
      }

      // 否则开始对话流程
      const planner = createSmartPlanner();
      const dialogState = await planner.startDialog(input.projectPath);

      return {
        dialogState,
        message: 'Dialog started, please continue providing requirements',
      };
    }),

  /**
   * 删除蓝图
   * DELETE /blueprints/:id -> trpc.blueprint.delete
   */
  delete: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ input }) => {
      const blueprint = blueprintStore.get(input.id);
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blueprint not found',
        });
      }

      // 检查是否正在执行
      if (blueprint.status === 'executing') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Cannot delete a blueprint that is currently executing',
        });
      }

      blueprintStore.delete(input.id);

      return {
        message: 'Blueprint deleted',
      };
    }),

  /**
   * 执行蓝图
   * POST /blueprints/:id/execute -> trpc.blueprint.execute
   */
  execute: publicProcedure
    .input(z.object({
      id: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { executionManager } = await import('../../routes/blueprint-api.js');

      const blueprint = blueprintStore.get(input.id);
      if (!blueprint) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blueprint not found',
        });
      }

      // 检查蓝图状态
      if (blueprint.status === 'executing') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Blueprint is currently executing',
        });
      }

      if (blueprint.status !== 'confirmed' && blueprint.status !== 'paused' && blueprint.status !== 'failed') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Blueprint status does not allow execution, please confirm the blueprint first',
        });
      }

      // 使用 executionManager 开始执行
      const session = await executionManager.startExecution(blueprint);

      return {
        executionId: session.id,
        planId: (session as any).plan?.id,
        totalTasks: (session as any).plan?.tasks?.length || 0,
        estimatedMinutes: (session as any).plan?.estimatedMinutes,
        estimatedCost: (session as any).plan?.estimatedCost,
      };
    }),
});

export type BlueprintRouter = typeof blueprintRouter;
