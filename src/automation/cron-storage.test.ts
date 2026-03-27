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
} from './cron-storage';

let testCronPath: string;

beforeEach(() => {
  testCronPath = path.join(os.tmpdir(), `axon-cron-test-${Date.now()}`);
  fs.mkdirSync(testCronPath, { recursive: true });

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
  });
});
