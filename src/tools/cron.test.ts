import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// 必须用 vi.mock 而非 vi.spyOn，因为 cron-storage.ts 使用 `import * as os`
// 与本文件的 `import os` 是不同引用，spyOn 无法跨模块生效
const realTmpdir = os.tmpdir();
let testCronPath: string = '';

vi.mock('os', async (importOriginal) => {
  const orig = await importOriginal<typeof import('os')>();
  return {
    ...orig,
    default: {
      ...orig,
      homedir: () => testCronPath || orig.homedir(),
    },
    homedir: () => testCronPath || orig.homedir(),
  };
});

// 延迟导入，确保 mock 生效
const { CronCreateTool, CronDeleteTool, CronListTool } = await import('./cron.js');
const { loadCronJobs } = await import('../automation/cron-storage.js');

beforeEach(() => {
  testCronPath = path.join(realTmpdir, `axon-cron-tools-test-${Date.now()}`);
  fs.mkdirSync(testCronPath, { recursive: true });
});

afterEach(() => {
  if (testCronPath && fs.existsSync(testCronPath)) {
    fs.rmSync(testCronPath, { recursive: true });
  }
  testCronPath = '';
});

describe('CronCreateTool', () => {
  it('should create a cron job with valid expression', async () => {
    const tool = new CronCreateTool();
    const result = await tool.execute({
      cron: '0 9 * * *',
      prompt: 'Daily standup',
    });

    expect(result.success).toBe(true);
    expect(result.data?.jobId).toBeDefined();
    expect(result.data?.jobId).toMatch(/^cron-/);
    expect(result.data?.nextRun).toBeDefined();
    expect(result.output).toContain('✅');
  });

  it('should create recurring job by default', async () => {
    const tool = new CronCreateTool();
    await tool.execute({
      cron: '0 9 * * 1-5',
      prompt: 'Weekday meeting',
    });

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].recurring).toBe(true);
  });

  it('should create non-recurring job', async () => {
    const tool = new CronCreateTool();
    await tool.execute({
      cron: '0 9 * * *',
      prompt: 'One-time task',
      recurring: false,
    });

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].recurring).toBe(false);
  });

  it('should reject invalid cron expression', async () => {
    const tool = new CronCreateTool();
    const result = await tool.execute({
      cron: 'invalid expression',
      prompt: 'Task',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid cron expression');
  });

  it('should compute next run time correctly', async () => {
    const tool = new CronCreateTool();
    const result = await tool.execute({
      cron: '0 9 * * *',
      prompt: 'Task',
    });

    expect(result.success).toBe(true);
    const nextRunDate = new Date(result.data?.nextRun!);
    expect(nextRunDate).toBeInstanceOf(Date);
    expect(nextRunDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('should support complex cron expressions', async () => {
    const tool = new CronCreateTool();

    const expressions = [
      '0 9 * * 1-5',    // Weekdays at 9 AM
      '0 */2 * * *',    // Every 2 hours
      '30 2 * * 0',     // Sunday at 2:30 AM
      '*/15 * * * *',   // Every 15 minutes
    ];

    for (const expr of expressions) {
      const result = await tool.execute({
        cron: expr,
        prompt: `Task for ${expr}`,
      });

      expect(result.success).toBe(true);
      expect(result.data?.jobId).toBeDefined();
      expect(result.data?.nextRun).toBeDefined();
    }

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(expressions.length);
  });

  it('should store max iterations if provided', async () => {
    const tool = new CronCreateTool();
    await tool.execute({
      cron: '0 9 * * *',
      prompt: 'Task',
      maxIterations: 5,
    });

    // Note: maxIterations is not currently stored in CronJob interface
    // This test documents the current behavior
    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(1);
  });
});

describe('CronDeleteTool', () => {
  it('should delete an existing job', async () => {
    const createTool = new CronCreateTool();
    const deleteTool = new CronDeleteTool();

    const created = await createTool.execute({
      cron: '0 9 * * *',
      prompt: 'Task to delete',
    });

    const result = await deleteTool.execute({
      jobId: created.data!.jobId,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('✅');

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(0);
  });

  it('should return false for non-existent job', async () => {
    const deleteTool = new CronDeleteTool();
    const result = await deleteTool.execute({
      jobId: 'non-existent-job',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should only delete the specified job', async () => {
    const createTool = new CronCreateTool();
    const deleteTool = new CronDeleteTool();

    const job1 = await createTool.execute({
      cron: '0 9 * * *',
      prompt: 'Task 1',
    });

    const job2 = await createTool.execute({
      cron: '0 17 * * *',
      prompt: 'Task 2',
    });

    await deleteTool.execute({
      jobId: job1.data!.jobId,
    });

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job2.data!.jobId);
  });
});

describe('CronListTool', () => {
  it('should list all jobs', async () => {
    const createTool = new CronCreateTool();
    const listTool = new CronListTool();

    await createTool.execute({
      cron: '0 9 * * *',
      prompt: 'Morning task',
    });

    await createTool.execute({
      cron: '0 17 * * *',
      prompt: 'Evening task',
    });

    const result = await listTool.execute({});

    expect(result.success).toBe(true);
    expect(result.data?.total).toBe(2);
    expect(result.data?.jobs).toHaveLength(2);
  });

  it('should show correct job properties', async () => {
    const createTool = new CronCreateTool();
    const listTool = new CronListTool();

    await createTool.execute({
      cron: '0 9 * * 1-5',
      prompt: 'Weekday meeting',
    });

    const result = await listTool.execute({});

    expect(result.success).toBe(true);
    expect(result.data?.jobs[0]).toHaveProperty('id');
    expect(result.data?.jobs[0]).toHaveProperty('cron');
    expect(result.data?.jobs[0]).toHaveProperty('status');
    expect(result.data?.jobs[0]).toHaveProperty('nextRun');
    expect(result.data?.jobs[0]).toHaveProperty('recurring');

    expect(result.data?.jobs[0].cron).toBe('0 9 * * 1-5');
    expect(result.data?.jobs[0].recurring).toBe(true);
    expect(result.data?.jobs[0].status).toBe('scheduled');
  });

  it('should filter by status', async () => {
    const createTool = new CronCreateTool();
    const listTool = new CronListTool();

    await createTool.execute({
      cron: '0 9 * * *',
      prompt: 'Task 1',
    });

    const result = await listTool.execute({
      status: 'scheduled',
    });

    expect(result.success).toBe(true);
    expect(result.data?.total).toBe(1);
    expect(result.data?.jobs[0].status).toBe('scheduled');
  });

  it('should return empty list for non-existent status', async () => {
    const createTool = new CronCreateTool();
    const listTool = new CronListTool();

    await createTool.execute({
      cron: '0 9 * * *',
      prompt: 'Task',
    });

    const result = await listTool.execute({
      status: 'completed',
    });

    expect(result.success).toBe(true);
    expect(result.data?.total).toBe(0);
    expect(result.data?.jobs).toHaveLength(0);
  });

  it('should handle empty job list', async () => {
    const listTool = new CronListTool();
    const result = await listTool.execute({});

    expect(result.success).toBe(true);
    expect(result.data?.total).toBe(0);
    expect(result.data?.jobs).toHaveLength(0);
  });
});
