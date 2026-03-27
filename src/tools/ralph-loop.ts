import { z } from 'zod';
import { BaseTool } from './base';
import fs from 'fs';
import path from 'path';

/**
 * Ralph Loop Tool: Create self-iterating tasks
 */
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

    // Validate prompt is not empty
    if (!prompt || prompt.trim().length === 0) {
      throw new Error('Prompt cannot be empty');
    }

    // Create state file path
    const stateFile = path.join(process.cwd(), '.claude', 'ralph-loop.local.md');
    const stateDir = path.dirname(stateFile);

    // Ensure directory exists
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }

    // Create YAML frontmatter
    const yaml = `---
iteration: 1
max_iterations: ${maxIterations}
completion_promise: "${completionPromise}"
---
`;

    // Combine YAML frontmatter with the prompt
    const content = yaml + prompt;

    // Write state file
    fs.writeFileSync(stateFile, content, 'utf-8');

    return {
      message: `🔄 Ralph loop started (max ${maxIterations} iterations). Looking for: <promise>${completionPromise}</promise>`,
      stateFile,
      prompt,
    };
  }
}

/**
 * Helper function to parse the ralph-loop state file
 */
export interface RalphLoopState {
  iteration: number;
  max_iterations: number;
  completion_promise: string;
  prompt: string;
}

/**
 * Parse the ralph-loop state file
 */
export function parseRalphLoopState(filePath: string): RalphLoopState | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract YAML frontmatter
    const matches = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!matches) {
      return null;
    }

    const yamlContent = matches[1];
    const prompt = matches[2];

    // Parse YAML fields
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

/**
 * Update the iteration counter in the ralph-loop state file
 */
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

/**
 * Helper function to extract a field from YAML content
 */
function extractYamlField(yamlContent: string, fieldName: string): string | null {
  const regex = new RegExp(`^${fieldName}:\\s*(.+)$`, 'm');
  const match = yamlContent.match(regex);
  if (match) {
    let value = match[1].trim();
    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * Check if a completion promise appears in the output
 */
export function hasCompletionPromise(
  output: string,
  completionPromise: string
): boolean {
  // Look for the promise wrapped in tags
  const promiseTag = `<promise>${completionPromise}</promise>`;
  return output.includes(promiseTag);
}
