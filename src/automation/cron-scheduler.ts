import { CronExpressionParser } from 'cron-parser';
import { CronJob, loadCronJobs, updateCronJob } from './cron-storage.js';

/**
 * Type for the prompt submission callback
 */
export type PromptSubmissionCallback = (prompt: string, jobId: string) => Promise<void>;

/**
 * CronScheduler manages background execution of scheduled cron jobs
 */
export class CronScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private submissionCallback: PromptSubmissionCallback | null = null;
  private isRunning = false;
  private checkIntervalMs: number;

  constructor(checkIntervalMs: number = 60000) {
    // Default: check every minute
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Register the callback function for submitting prompts
   */
  public setSubmissionCallback(callback: PromptSubmissionCallback): void {
    this.submissionCallback = callback;
  }

  /**
   * Start the scheduler (begin background checks)
   */
  public start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    // Perform initial check immediately
    this.executeUpcomingJobs().catch((error) => {
      console.error('Error during initial cron check:', error);
    });

    // Set up recurring checks
    this.intervalId = setInterval(
      () => {
        this.executeUpcomingJobs().catch((error) => {
          console.error('Error during cron execution:', error);
        });
      },
      this.checkIntervalMs
    );
  }

  /**
   * Stop the scheduler
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
  }

  /**
   * Check for and execute any due cron jobs
   */
  public async executeUpcomingJobs(): Promise<void> {
    const now = new Date();
    const jobs = loadCronJobs();

    for (const job of jobs) {
      // Only execute scheduled jobs that are due
      if (job.status !== 'scheduled') {
        continue;
      }

      const nextRunTime = new Date(job.nextRunAt);
      if (nextRunTime > now) {
        continue;
      }

      try {
        // Mark job as running
        updateCronJob(job.id, {
          status: 'running',
        });

        // Submit the prompt if callback is set
        if (this.submissionCallback) {
          await this.submissionCallback(job.prompt, job.id);
        }

        // Calculate next run time
        const nextRun = this.computeNextRunTime(job.cron);

        if (job.recurring && nextRun) {
          // Update for recurring job
          updateCronJob(job.id, {
            status: 'scheduled',
            nextRunAt: nextRun.toISOString(),
            lastRunAt: now.toISOString(),
          });
        } else if (!job.recurring) {
          // Mark non-recurring job as completed
          updateCronJob(job.id, {
            status: 'completed',
            lastRunAt: now.toISOString(),
          });
        }
      } catch (error) {
        // Mark job as failed and record the error
        updateCronJob(job.id, {
          status: 'failed',
          failureReason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Compute the next run time for a cron expression
   */
  public computeNextRunTime(cronExpression: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(cronExpression);
      const nextDate = interval.next();
      return nextDate.toDate();
    } catch (error) {
      console.error(`Invalid cron expression: ${cronExpression}`, error);
      return null;
    }
  }

  /**
   * Check if the scheduler is currently running
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get the current check interval in milliseconds
   */
  public getCheckInterval(): number {
    return this.checkIntervalMs;
  }
}

/**
 * Global singleton instance
 */
let globalScheduler: CronScheduler | null = null;

/**
 * Get or create the global scheduler instance
 */
export function getGlobalScheduler(): CronScheduler {
  if (!globalScheduler) {
    globalScheduler = new CronScheduler();
  }
  return globalScheduler;
}

/**
 * Initialize and start the global scheduler
 */
export function initializeGlobalScheduler(
  submissionCallback?: PromptSubmissionCallback,
  checkIntervalMs?: number
): CronScheduler {
  const scheduler = getGlobalScheduler();

  if (submissionCallback) {
    scheduler.setSubmissionCallback(submissionCallback);
  }

  if (checkIntervalMs) {
    // Re-create scheduler with new interval if needed
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
