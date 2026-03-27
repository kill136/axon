import cronParser from 'cron-parser';
import { CronJob, loadCronJobs, updateCronJob } from './cron-storage';

export type PromptSubmissionCallback = (prompt: string, jobId: string) => Promise<void>;

export class CronScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private submissionCallback: PromptSubmissionCallback | null = null;
  private isRunning = false;
  private checkIntervalMs: number;

  constructor(checkIntervalMs: number = 60000) {
    this.checkIntervalMs = checkIntervalMs;
  }

  public setSubmissionCallback(callback: PromptSubmissionCallback): void {
    this.submissionCallback = callback;
  }

  public start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    this.executeUpcomingJobs().catch((error) => {
      console.error('Error during initial cron check:', error);
    });

    this.intervalId = setInterval(
      () => {
        this.executeUpcomingJobs().catch((error) => {
          console.error('Error during cron execution:', error);
        });
      },
      this.checkIntervalMs
    );
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  public async executeUpcomingJobs(): Promise<void> {
    const now = new Date();
    const jobs = loadCronJobs();

    for (const job of jobs) {
      if (job.status !== 'scheduled') {
        continue;
      }

      const nextRunTime = new Date(job.nextRunAt);
      if (nextRunTime > now) {
        continue;
      }

      try {
        updateCronJob(job.id, {
          status: 'running',
        });

        if (this.submissionCallback) {
          await this.submissionCallback(job.prompt, job.id);
        }

        const nextRun = this.computeNextRunTime(job.cron);

        if (job.recurring && nextRun) {
          updateCronJob(job.id, {
            status: 'scheduled',
            nextRunAt: nextRun.toISOString(),
            lastRunAt: now.toISOString(),
          });
        } else if (!job.recurring) {
          updateCronJob(job.id, {
            status: 'completed',
            lastRunAt: now.toISOString(),
          });
        }
      } catch (error) {
        updateCronJob(job.id, {
          status: 'failed',
          failureReason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  public computeNextRunTime(cronExpression: string): Date | null {
    try {
      const interval = cronParser.parseExpression(cronExpression);
      const nextDate = interval.next();
      return nextDate.toDate();
    } catch (error) {
      console.error(`Invalid cron expression: ${cronExpression}`, error);
      return null;
    }
  }

  public isActive(): boolean {
    return this.isRunning;
  }

  public getCheckInterval(): number {
    return this.checkIntervalMs;
  }
}

let globalScheduler: CronScheduler | null = null;

export function getGlobalScheduler(): CronScheduler {
  if (!globalScheduler) {
    globalScheduler = new CronScheduler();
  }
  return globalScheduler;
}

export function initializeGlobalScheduler(
  submissionCallback?: PromptSubmissionCallback,
  checkIntervalMs?: number
): CronScheduler {
  const scheduler = getGlobalScheduler();

  if (submissionCallback) {
    scheduler.setSubmissionCallback(submissionCallback);
  }

  if (checkIntervalMs) {
    if (scheduler.isActive()) {
      scheduler.stop();
    }
    globalScheduler = new CronScheduler(checkIntervalMs);
    if (submissionCallback) {
      globalScheduler.setSubmissionCallback(submissionCallback);
    }
  }

  if (!scheduler.isActive()) {
    scheduler.start();
  }

  return scheduler;
}
