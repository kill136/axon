import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadCronJobs,
  saveCronJobs,
  findCronJobById,
  deleteCronJobById,
  updateCronJob,
  getScheduledJobsDue,
  getJobsByStatus,
  CronJob,
} from './cron-storage.js';

/**
 * Mock the cron-jobs.json location for testing
 */
let testCronPath: string;

beforeEach(() => {
  // Create a temporary directory for tests
  testCronPath = path.join(os.tmpdir(), `axon-cron-test-${Date.now()}`);
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
});

describe('Cron Storage', () => {
  describe('saveCronJobs and loadCronJobs', () => {
    it('should save and load empty job list', () => {
      saveCronJobs([]);
      const jobs = loadCronJobs();
      expect(jobs).toEqual([]);
    });

    it('should save and load single cron job', () => {
      const job: CronJob = {
        id: 'job-001',
        cron: '0 9 * * *',
        prompt: 'Daily standup',
        recurring: true,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
      };

      saveCronJobs([job]);
      const loaded = loadCronJobs();

      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(job);
    });

    it('should save and load multiple cron jobs', () => {
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Daily standup',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
        },
        {
          id: 'job-002',
          cron: '0 17 * * *',
          prompt: 'End of day sync',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
        },
      ];

      saveCronJobs(jobs);
      const loaded = loadCronJobs();

      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('job-001');
      expect(loaded[1].id).toBe('job-002');
    });

    it('should preserve all job fields including optional ones', () => {
      const job: CronJob = {
        id: 'job-001',
        cron: '0 9 * * *',
        prompt: 'Daily standup',
        recurring: false,
        status: 'completed',
        createdAt: '2026-03-27T10:00:00Z',
        nextRunAt: '2026-03-28T09:00:00Z',
        lastRunAt: '2026-03-27T09:00:00Z',
        failureReason: 'Network timeout',
      };

      saveCronJobs([job]);
      const loaded = loadCronJobs();

      expect(loaded[0]).toEqual(job);
    });
  });

  describe('findCronJobById', () => {
    it('should find an existing job', () => {
      const job: CronJob = {
        id: 'job-001',
        cron: '0 9 * * *',
        prompt: 'Task',
        recurring: true,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
      };

      saveCronJobs([job]);
      const found = findCronJobById('job-001');

      expect(found).toEqual(job);
    });

    it('should return undefined for non-existent job', () => {
      const found = findCronJobById('non-existent');
      expect(found).toBeUndefined();
    });
  });

  describe('deleteCronJobById', () => {
    it('should delete an existing job', () => {
      const job: CronJob = {
        id: 'job-001',
        cron: '0 9 * * *',
        prompt: 'Task',
        recurring: true,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
      };

      saveCronJobs([job]);
      const deleted = deleteCronJobById('job-001');

      expect(deleted).toBe(true);
      expect(loadCronJobs()).toHaveLength(0);
    });

    it('should return false for non-existent job', () => {
      const deleted = deleteCronJobById('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('updateCronJob', () => {
    it('should update an existing job', () => {
      const job: CronJob = {
        id: 'job-001',
        cron: '0 9 * * *',
        prompt: 'Task',
        recurring: true,
        status: 'scheduled',
        createdAt: new Date().toISOString(),
        nextRunAt: new Date().toISOString(),
      };

      saveCronJobs([job]);
      const updated = updateCronJob('job-001', { status: 'running' });

      expect(updated).toBe(true);
      const loaded = loadCronJobs();
      expect(loaded[0].status).toBe('running');
    });

    it('should return false for non-existent job', () => {
      const updated = updateCronJob('non-existent', { status: 'running' });
      expect(updated).toBe(false);
    });
  });

  describe('getScheduledJobsDue', () => {
    it('should return jobs that are due to run', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60000); // 1 minute ago
      const future = new Date(now.getTime() + 60000); // 1 minute from now

      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Due task',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: past.toISOString(),
        },
        {
          id: 'job-002',
          cron: '0 17 * * *',
          prompt: 'Future task',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: future.toISOString(),
        },
      ];

      saveCronJobs(jobs);
      const due = getScheduledJobsDue(now);

      expect(due).toHaveLength(1);
      expect(due[0].id).toBe('job-001');
    });

    it('should only return scheduled jobs', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 60000);

      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Running task',
          recurring: true,
          status: 'running',
          createdAt: new Date().toISOString(),
          nextRunAt: past.toISOString(),
        },
        {
          id: 'job-002',
          cron: '0 17 * * *',
          prompt: 'Scheduled task',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: past.toISOString(),
        },
      ];

      saveCronJobs(jobs);
      const due = getScheduledJobsDue(now);

      expect(due).toHaveLength(1);
      expect(due[0].id).toBe('job-002');
    });
  });

  describe('getJobsByStatus', () => {
    it('should filter jobs by status', () => {
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Task 1',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
        },
        {
          id: 'job-002',
          cron: '0 17 * * *',
          prompt: 'Task 2',
          recurring: true,
          status: 'completed',
          createdAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
        },
        {
          id: 'job-003',
          cron: '0 21 * * *',
          prompt: 'Task 3',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
        },
      ];

      saveCronJobs(jobs);
      const scheduled = getJobsByStatus('scheduled');
      const completed = getJobsByStatus('completed');

      expect(scheduled).toHaveLength(2);
      expect(completed).toHaveLength(1);
    });
  });

  describe('atomicity', () => {
    it('should use atomic writes to prevent corruption', () => {
      const jobs: CronJob[] = [
        {
          id: 'job-001',
          cron: '0 9 * * *',
          prompt: 'Task',
          recurring: true,
          status: 'scheduled',
          createdAt: new Date().toISOString(),
          nextRunAt: new Date().toISOString(),
        },
      ];

      // Save job
      saveCronJobs(jobs);

      // Verify it was saved
      let loaded = loadCronJobs();
      expect(loaded).toHaveLength(1);

      // Update job
      updateCronJob('job-001', { status: 'running' });

      // Verify update was atomic
      loaded = loadCronJobs();
      expect(loaded[0].status).toBe('running');

      // Check that temp files were cleaned up
      const cronPath = path.join(testCronPath, '.axon', 'cron-jobs.json');
      const tempPath = cronPath + '.tmp';
      expect(fs.existsSync(tempPath)).toBe(false);
    });
  });
});
