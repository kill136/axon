import { z } from 'zod';
import { BaseTool } from './base';
import fs from 'fs';
import path from 'path';

export class RalphLoopTool extends BaseTool {
  name = 'RalphLoop';
  description =
    'Create a self-iterating task that automatically re-runs until a completion promise is output or max iterations reached';

  inputSchema = z.object({
    prompt: z.string().describe('The prompt that will be repeatedly submitted'),
    maxIterations: z
      .number()
      .optional()
      .describe('Maximum number of iterations (default: 10)'),
    completionPromise: z
      .string()
      .optional()
      .describe('Completion marker text that signals when to stop (default: "✅ TASK COMPLETE")'),
  });

  async execute(input: z.infer<typeof this.inputSchema>): Promise<{
    message: string;
    stateFile: string;
    prompt: string;
  }> {
    const {
      prompt,
      maxIterations = 10,
      completionPromise = '✅ TASK COMPLETE',
    } = input;

    if (maxIterations < 1 || maxIterations > 100) {
      throw new Error('maxIterations must be between 1 and 100');
    }

    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt cannot be empty');
    }

    const stateFile = path.join(process.cwd(), '.claude', 'ralph-loop.local.md');
    const stateDir = path.dirname(stateFile);

    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    const yaml = `---
iteration: 1
max_iterations: ${maxIterations}
completion_promise: "${completionPromise}"
---
`;

    const content = yaml + prompt;
    fs.writeFileSync(stateFile, content, 'utf-8');

    return {
      message: `🔄 Ralph loop started (max ${maxIterations} iterations). Looking for: <promise>${completionPromise}</promise>`,
      stateFile,
      prompt,
    };
  }
}

export interface RalphLoopState {
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  prompt: string;
}

export function parseRalphLoopState(filePath: string): RalphLoopState | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!matches) {
      return null;
    }

    const yamlContent = matches[1];
    const prompt = matches[2];

    const iteration = parseInt(extractYamlField(yamlContent, 'iteration') || '1', 10);
    const max_iterations = parseInt(
      extractYamlField(yamlContent, 'max_iterations') || '10',
      10
    );
    const completion_promise =
      extractYamlField(yamlContent, 'completion_promise') || '✅ TASK COMPLETE';

    return {
      iteration,
      max_iterations,
      completion_promise,
      prompt: prompt.trim(),
    };
  } catch (error) {
    console.error('Error parsing ralph-loop state file:', error);
    return null;
  }
}

export function updateRalphLoopIteration(filePath: string, iteration: number): void {
  const state = parseRalphLoopState(filePath);
  if (!state) {
    throw new Error('Could not parse ralph-loop state file');
  }

  const yaml = `---
iteration: ${iteration}
max_iterations: ${state.max_iterations}
completion_promise: "${state.completion_promise}"
---
`;

  const content = yaml + state.prompt;
  fs.writeFileSync(filePath, content, 'utf-8');
}

function extractYamlField(yamlContent: string, fieldName: string): string | null {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = yamlContent.match(regex);
  if (match) {
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

export function hasCompletionPromise(
  output: string,
  completionPromise: string
): boolean {
  const promiseTag = `<promise>${completionPromise}</promise>`;
  return output.includes(promiseTag);
}
