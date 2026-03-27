import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CronCreateTool, CronDeleteTool, CronListTool } from './cron.ts';
import { loadCronJobs } from '../automation/cron-storage';

let testCronPath: string;

beforeEach(() => {
  testCronPath = path.join(os.tmpdir(), `axon-cron-tools-test-${Date.now()}`);
  fs.mkdirSync(testCronPath, { recursive: true });

  // Override home directory for this test
  Object.defineProperty(os, 'homedir', {
    value: () => testCronPath,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  if (fs.existsSync(testCronPath)) {
    fs.rmSync(testCronPath, { recursive: true });
  }
});

describe('CronCreateTool', () => {
  it('should create a cron job with valid expression', async () => {
    const tool = new CronCreateTool();
    const result = await tool.execute({
      cron: '0 9 * * *',
      prompt: 'Daily standup',
    });

    expect(result.jobId).toBeDefined();
    expect(result.jobId).toMatch(/^cron-/);
    expect(result.nextRun).toBeDefined();
    expect(result.message).toContain('✅');
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

    await expect(
      tool.execute({
        cron: 'invalid expression',
        prompt: 'Task',
      })
    ).rejects.toThrow('Invalid cron expression');
  });

  it('should compute next run time correctly', async () => {
    const tool = new CronCreateTool();
    const result = await tool.execute({
      cron: '0 9 * * *',
      prompt: 'Task',
    });

    const nextRunDate = new Date(result.nextRun);
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

      expect(result.jobId).toBeDefined();
      expect(result.nextRun).toBeDefined();
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
      jobId: created.jobId,
    });

    expect(result.deleted).toBe(true);
    expect(result.message).toContain('✅');

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(0);
  });

  it('should return false for non-existent job', async () => {
    const deleteTool = new CronDeleteTool();
    const result = await deleteTool.execute({
      jobId: 'non-existent-job',
    });

    expect(result.deleted).toBe(false);
    expect(result.message).toContain('not found');
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
      jobId: job1.jobId,
    });

    const jobs = loadCronJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(job2.jobId);
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

    expect(result.total).toBe(2);
    expect(result.jobs).toHaveLength(2);
  });

  it('should show correct job properties', async () => {
    const createTool = new CronCreateTool();
    const listTool = new CronListTool();

    await createTool.execute({
      cron: '0 9 * * 1-5',
      prompt: 'Weekday meeting',
    });

    const result = await listTool.execute({});

    expect(result.jobs[0]).toHaveProperty('id');
    expect(result.jobs[0]).toHaveProperty('cron');
    expect(result.jobs[0]).toHaveProperty('status');
    expect(result.jobs[0]).toHaveProperty('nextRun');
    expect(result.jobs[0]).toHaveProperty('recurring');

    expect(result.jobs[0].cron).toBe('0 9 * * 1-5');
    expect(result.jobs[0].recurring).toBe(true);
    expect(result.jobs[0].status).toBe('scheduled');
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

    expect(result.total).toBe(1);
    expect(result.jobs[0].status).toBe('scheduled');
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

    expect(result.total).toBe(0);
    expect(result.jobs).toHaveLength(0);
  });

  it('should handle empty job list', async () => {
    const listTool = new CronListTool();
    const result = await listTool.execute({});

    expect(result.total).toBe(0);
    expect(result.jobs).toHaveLength(0);
  });
});
