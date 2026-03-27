import { z } from 'zod';
import { BaseTool } from './base';
import { v4 as uuidv4 } from 'uuid';
import cronParser from 'cron-parser';
import {
  loadCronJobs,
  saveCronJobs,
  findCronJobById,
  deleteCronJobById,
  CronJob,
} from '../automation/cron-storage';

/**
 * CronCreate tool: Schedule a cron job
 */
export class CronCreateTool extends BaseTool {
  name = 'CronCreate';
  description = 'Create a new scheduled cron job that will run according to the cron expression';

  inputSchema = z.object({
    cron: z
      .string()
      .describe(
        'Cron expression in standard format (e.g., "0 9 * * 1-5" for 9 AM on weekdays)'
      ),
    prompt: z.string().describe('The prompt or task description to execute when the job runs'),
    recurring: z.boolean().optional().describe('Whether this job should recur (default: true)'),
    maxIterations: z
      .number()
      .optional()
      .describe(
        'Maximum iterations if the job uses ralph-loop (default: 0 meaning no limit)'
      ),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<{
    jobId: string;
    nextRun: string;
    message: string;
  }> {
    const { cron, prompt, recurring = true, maxIterations = 0 } = input;

    // Validate cron expression
    try {
      cronParser.parseExpression(cron);
    } catch (error) {
      throw new Error(
        `Invalid cron expression: "${cron}". Example: "0 9 * * 1-5" for 9 AM on weekdays`
      );
    }

    // Calculate next run time
    const interval = cronParser.parseExpression(cron);
    const nextRunDate = interval.next().toDate();

    // Create job record
    const jobId = `cron-${uuidv4().slice(0, 8)}`;
    const now = new Date();

    const newJob: CronJob = {
      id: jobId,
      cron,
      prompt,
      recurring,
      status: 'scheduled',
      createdAt: now.toISOString(),
      nextRunAt: nextRunDate.toISOString(),
    };

    // Save to storage
    const jobs = loadCronJobs();
    jobs.push(newJob);
    saveCronJobs(jobs);

    return {
      jobId,
      nextRun: nextRunDate.toISOString(),
      message: `✅ Cron job scheduled: ${cron} (Next run: ${nextRunDate.toLocaleString()})`,
    };
  }
}

/**
 * CronDelete tool: Delete a scheduled cron job
 */
export class CronDeleteTool extends BaseTool {
  name = 'CronDelete';
  description = 'Delete a scheduled cron job by its ID';

  inputSchema = z.object({
    jobId: z.string().describe('The ID of the cron job to delete'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<{
    message: string;
    deleted: boolean;
  }> {
    const { jobId } = input;

    // Check if job exists
    const job = findCronJobById(jobId);
    if (!job) {
      return {
        message: `Job ${jobId} not found`,
        deleted: false,
      };
    }

    // Delete the job
    const deleted = deleteCronJobById(jobId);

    return {
      message: deleted ? `✅ Cron job ${jobId} deleted` : `Failed to delete job ${jobId}`,
      deleted,
    };
  }
}

/**
 * CronList tool: List all cron jobs
 */
export class CronListTool extends BaseTool {
  name = 'CronList';
  description = 'List all scheduled cron jobs with their status and next run time';

  inputSchema = z.object({
    status: z
      .enum(['scheduled', 'running', 'completed', 'failed'])
      .optional()
      .describe('Filter by job status (optional)'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<{
    jobs: Array<{
      id: string;
      cron: string;
      status: string;
      nextRun: string;
      recurring: boolean;
    }>;
    total: number;
  }> {
    const { status } = input;

    let jobs = loadCronJobs();

    // Filter by status if provided
    if (status) {
      jobs = jobs.filter((job) => job.status === status);
    }

    const result = jobs.map((job) => ({
      id: job.id,
      cron: job.cron,
      status: job.status,
      nextRun: job.nextRunAt,
      recurring: job.recurring,
    }));

    return {
      jobs: result,
      total: result.length,
    };
  }
}
