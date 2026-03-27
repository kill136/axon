import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * CronJob interface represents a scheduled task
 */
export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  status: 'scheduled' | 'running' | 'completed' | 'failed';
  createdAt: string; // ISO8601 format
  nextRunAt: string; // ISO8601 format
  lastRunAt?: string; // ISO8601 format
  failureReason?: string;
}

/**
 * CronJobsContainer represents the structure of cron-jobs.json
 */
interface CronJobsContainer {
  jobs: CronJob[];
  version?: string;
}

/**
 * Get the path to the cron-jobs.json file
 */
function getCronJobsPath(): string {
  const axonDir = path.join(os.homedir(), '.axon');
  return path.join(axonDir, 'cron-jobs.json');
}

/**
 * Ensure the .axon directory exists
 */
function ensureAxonDir(): void {
  const axonDir = path.join(os.homedir(), '.axon');
  if (!fs.existsSync(axonDir)) {
    fs.mkdirSync(axonDir, { recursive: true });
  }
}

/**
 * Load all cron jobs from storage
 */
export function loadCronJobs(): CronJob[] {
  const cronPath = getCronJobsPath();

  if (!fs.existsSync(cronPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(cronPath, 'utf-8');
    const container: CronJobsContainer = JSON.parse(content);
    return container.jobs || [];
  } catch (error) {
    console.error(`Failed to load cron jobs from ${cronPath}:`, error);
    return [];
  }
}

/**
 * Save cron jobs to storage (atomic operation with temp file)
 */
export function saveCronJobs(jobs: CronJob[]): void {
  ensureAxonDir();
  const cronPath = getCronJobsPath();
  const tempPath = cronPath + '.tmp';

  const container: CronJobsContainer = {
    jobs,
    version: '1.0',
  };

  try {
    fs.writeFileSync(tempPath, JSON.stringify(container, null, 2), 'utf-8');
    fs.renameSync(tempPath, cronPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
    throw new Error(`Failed to save cron jobs: ${error}`);
  }
}

/**
 * Find a cron job by ID
 */
export function findCronJobById(jobId: string): CronJob | undefined {
  const jobs = loadCronJobs();
  return jobs.find((job) => job.id === jobId);
}

/**
 * Delete a cron job by ID
 */
export function deleteCronJobById(jobId: string): boolean {
  const jobs = loadCronJobs();
  const initialLength = jobs.length;
  const filtered = jobs.filter((job) => job.id !== jobId);

  if (filtered.length < initialLength) {
    saveCronJobs(filtered);
    return true;
  }

  return false;
}

/**
 * Update a cron job
 */
export function updateCronJob(jobId: string, updates: Partial<CronJob>): boolean {
  const jobs = loadCronJobs();
  const job = jobs.find((j) => j.id === jobId);

  if (!job) {
    return false;
  }

  Object.assign(job, updates);
  saveCronJobs(jobs);
  return true;
}

/**
 * Get all scheduled jobs that are due to run
 */
export function getScheduledJobsDue(now: Date): CronJob[] {
  const jobs = loadCronJobs();
  return jobs.filter(
    (job) =>
      job.status === 'scheduled' &&
      new Date(job.nextRunAt) <= now
  );
}

/**
 * Get all jobs with a specific status
 */
export function getJobsByStatus(status: CronJob['status']): CronJob[] {
  const jobs = loadCronJobs();
  return jobs.filter((job) => job.status === status);
}
