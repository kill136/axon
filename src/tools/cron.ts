import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';
import {
  loadCronJobs,
  saveCronJobs,
  findCronJobById,
  deleteCronJobById,
  CronJob,
} from '../automation/cron-storage.js';

interface CronCreateInput {
  cron: string;
  prompt: string;
  recurring?: boolean;
  maxIterations?: number;
}

/**
 * CronCreate tool: Schedule a cron job
 */
export class CronCreateTool extends BaseTool<CronCreateInput, ToolResult> {
  name = 'CronCreate';
  description = 'Create a new scheduled cron job that will run according to the cron expression';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        cron: {
          type: 'string',
          description:
            'Cron expression in standard format (e.g., "0 9 * * 1-5" for 9 AM on weekdays)',
        },
        prompt: {
          type: 'string',
          description: 'The prompt or task description to execute when the job runs',
        },
        recurring: {
          type: 'boolean',
          description: 'Whether this job should recur (default: true)',
        },
        maxIterations: {
          type: 'number',
          description: 'Maximum iterations if the job uses ralph-loop (default: 0 meaning no limit)',
        },
      },
      required: ['cron', 'prompt'],
    };
  }

  async execute(input: CronCreateInput): Promise<ToolResult> {
    const { cron, prompt, recurring = true, maxIterations = 0 } = input;

    // Validate cron expression
    let interval;
    try {
      interval = CronExpressionParser.parse(cron);
    } catch (error) {
      return {
        success: false,
        error: `Invalid cron expression: "${cron}". Example: "0 9 * * 1-5" for 9 AM on weekdays`,
      };
    }

    // Calculate next run time
    let nextRunDate: Date;
    try {
      nextRunDate = interval.next().toDate();
    } catch (error) {
      return {
        success: false,
        error: `Failed to calculate next run time: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

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
      success: true,
      output: `✅ Cron job scheduled: ${cron} (Job ID: ${jobId}, Next run: ${nextRunDate.toLocaleString()})`,
      data: {
        jobId,
        nextRun: nextRunDate.toISOString(),
      },
    };
  }
}

interface CronDeleteInput {
  jobId: string;
}

/**
 * CronDelete tool: Delete a scheduled cron job
 */
export class CronDeleteTool extends BaseTool<CronDeleteInput, ToolResult> {
  name = 'CronDelete';
  description = 'Delete a scheduled cron job by its ID';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        jobId: {
          type: 'string',
          description: 'The ID of the cron job to delete',
        },
      },
      required: ['jobId'],
    };
  }

  async execute(input: CronDeleteInput): Promise<ToolResult> {
    const { jobId } = input;

    // Check if job exists
    const job = findCronJobById(jobId);
    if (!job) {
      return {
        success: false,
        error: `Job ${jobId} not found`,
      };
    }

    // Delete the job
    const deleted = deleteCronJobById(jobId);

    if (!deleted) {
      return {
        success: false,
        error: `Failed to delete job ${jobId}`,
      };
    }

    return {
      success: true,
      output: `✅ Cron job ${jobId} deleted`,
    };
  }
}

interface CronListInput {
  status?: 'scheduled' | 'running' | 'completed' | 'failed';
}

/**
 * CronList tool: List all cron jobs
 */
export class CronListTool extends BaseTool<CronListInput, ToolResult> {
  name = 'CronList';
  description = 'List all scheduled cron jobs with their status and next run time';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['scheduled', 'running', 'completed', 'failed'],
          description: 'Filter by job status (optional)',
        },
      },
    };
  }

  async execute(input: CronListInput): Promise<ToolResult> {
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

    const output = result.length > 0
      ? result
          .map(
            (job) =>
              `- [${job.status.toUpperCase()}] ${job.id}: ${job.cron} (Next: ${job.nextRun})`
          )
          .join('\n')
      : 'No cron jobs found';

    return {
      success: true,
      output,
      data: {
        jobs: result,
        total: result.length,
      },
    };
  }
}
