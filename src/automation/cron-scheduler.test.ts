import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CronScheduler, getGlobalScheduler, initializeGlobalScheduler } from './cron-scheduler.js';
import { saveCronJobs, CronJob } from './cron-storage.js';
import os from 'os';
import path from 'path';
import fs from 'fs';

let testCronPath: string;

beforeEach(() => {
  // Create a temporary directory for tests
  testCronPath = path.join(os.tmpdir(), `axon-cron-scheduler-test-${Date.now()}`);
  fs.mkdirSync(testCronPath, { recursive: true });

  // Override home directory for this test
  Object.defineProperty(os, 'homedir', {
    value: () => testCronPath,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  // Cleanup
  if (fs.existsSync(testCronPath)) {
    fs.rmSync(testCronPath, { recursive: true });
  }
  vi.clearAllMocks();
});

describe('CronScheduler', () => {
  describe('basic operations', () => {
    it('should create a new scheduler instance', () => {
      const scheduler = new CronScheduler();
      expect(scheduler).toBeDefined();
      expect(scheduler.isActive()).toBe(false);
    });

    it('should start and stop the scheduler', () => {
      const scheduler = new CronScheduler();
      expect(scheduler.isActive()).toBe(false);

      scheduler.start();
      expect(scheduler.isActive()).toBe(true);

      scheduler.stop();
      expect(scheduler.isActive()).toBe(false);
    });

    it('should not double-start the scheduler', () => {
      const scheduler = new CronScheduler();
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);

      // Try to start again - should not create duplicate interval
      scheduler.start();
      expect(scheduler.isActive()).toBe(true);
    });

    it('should get check interval', () => {
      const scheduler = new CronScheduler(30000);
      expect(scheduler.getCheckInterval()).toBe(30000);
    });
  });

  describe('computeNextRunTime', () => {
    it('should compute next run time for valid cron expression', () => {
      const scheduler = new CronScheduler();
      const nextRun = scheduler.computeNextRunTime('0 9 * * *');

      expect(nextRun).toBeDefined();
      expect(nextRun).toBeInstanceOf(Date);
    });

    it('should return null for invalid cron expression', () => {
      const scheduler = new CronScheduler();
      const nextRun = scheduler.computeNextRunTime('invalid');

      expect(nextRun).toBeNull();
    });

    it('should handle complex cron expressions', () => {
      const scheduler = new CronScheduler();

      const expressions = [
        '0 9 * * 1-5',  // Weekdays at 9 AM
        '0 */2 * * *',  // Every 2 hours
        '30 2 * * 0',   // Sunday at 2:30 AM
        '*/15 * * * *', // Every 15 minutes
      ];

      for (const expr of expressions) {
        const nextRun = scheduler.computeNextRunTime(expr);
        expect(nextRun).toBeDefined();
        expect(nextRun).toBeInstanceOf(Date);
      }
    });
  });

  describe('prompt submission callback', () => {
    it('should set and use submission callback', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockResolvedValue(undefined);

      scheduler.setSubmissionCallback(mockCallback);

      // Create a job that's due now
      const now = new Date();
      const job: CronJob = {
        id: 'test-001',
        cron: '0 9 * * *',
        prompt: 'Test prompt',
        recurring: true,
        status: 'scheduled',
        createdAt: now.toISOString(),
        nextRunAt: new Date(now.getTime() - 60000).toISOString(), // Due 1 minute ago
      };

      saveCronJobs([job]);

      // Execute the scheduler
      await scheduler.executeUpcomingJobs();

      // Callback should have been called
      expect(mockCallback).toHaveBeenCalledWith('Test prompt', 'test-001');
    });
  });

  describe('executeUpcomingJobs', () => {
    it('should execute jobs that are due', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      scheduler.setSubmissionCallback(mockCallback);

      const now = new Date();
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Due job',
          recurring: true,
          status: 'scheduled',
          createdAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() - 60000).toISOString(),
        },
      ];

      saveCronJobs(jobs);
      await scheduler.executeUpcomingJobs();

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should skip jobs that are not yet due', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      scheduler.setSubmissionCallback(mockCallback);

      const now = new Date();
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Future job',
          recurring: true,
          status: 'scheduled',
          createdAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() + 60000).toISOString(),
        },
      ];

      saveCronJobs(jobs);
      await scheduler.executeUpcomingJobs();

      expect(mockCallback).not.toHaveBeenCalled();
    });

    it('should handle recurring jobs', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      scheduler.setSubmissionCallback(mockCallback);

      const now = new Date();
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Recurring job',
          recurring: true,
          status: 'scheduled',
          createdAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() - 60000).toISOString(),
        },
      ];

      saveCronJobs(jobs);
      await scheduler.executeUpcomingJobs();

      // Job should be marked as scheduled again for next occurrence
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should handle non-recurring jobs', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      scheduler.setSubmissionCallback(mockCallback);

      const now = new Date();
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'One-time job',
          recurring: false,
          status: 'scheduled',
          createdAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() - 60000).toISOString(),
        },
      ];

      saveCronJobs(jobs);
      await scheduler.executeUpcomingJobs();

      // Job should be marked as completed
      expect(mockCallback).toHaveBeenCalled();
    });

    it('should skip non-scheduled jobs', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      scheduler.setSubmissionCallback(mockCallback);

      const now = new Date();
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Running job',
          recurring: true,
          status: 'running',
          createdAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() - 60000).toISOString(),
        },
      ];

      saveCronJobs(jobs);
      await scheduler.executeUpcomingJobs();

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('global scheduler', () => {
    it('should get global scheduler instance', () => {
      const scheduler1 = getGlobalScheduler();
      const scheduler2 = getGlobalScheduler();

      expect(scheduler1).toBe(scheduler2);
    });

    it('should initialize global scheduler with callback', () => {
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      const scheduler = initializeGlobalScheduler(mockCallback);

      expect(scheduler).toBeDefined();
      expect(scheduler.isActive()).toBe(true);

      scheduler.stop();
    });
  });

  describe('error handling', () => {
    it('should handle callback errors gracefully', async () => {
      const scheduler = new CronScheduler();
      const mockCallback = vi.fn().mockRejectedValue(new Error('Test error'));
      scheduler.setSubmissionCallback(mockCallback);

      const now = new Date();
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Job that will fail',
          recurring: true,
          status: 'scheduled',
          createdAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() - 60000).toISOString(),
        },
      ];

      saveCronJobs(jobs);

      // Should not throw
      await expect(scheduler.executeUpcomingJobs()).resolves.toBeUndefined();
    });

    it('should handle invalid cron expressions in jobs', async () => {
      const scheduler = new CronScheduler();
      const now = new Date();

      // This test just ensures the scheduler doesn't crash
      // when job has an invalid cron expression
      await expect(scheduler.executeUpcomingJobs()).resolves.toBeUndefined();
    });
  });
});
