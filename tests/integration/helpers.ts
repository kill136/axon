/**
 * Integration Test Helper Functions
 * Provides reusable utilities for integration tests
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TestEnvironment } from './setup.js';
import type { Session, Message } from '../../src/session/index.js';
import type { UserConfig } from '../../src/config/index.js';

/**
 * Create a minimal valid config for testing
 */
export function createMinimalConfig(): Partial<UserConfig> {
  return {
    version: '2.1.18',
    model: 'sonnet',
    maxTokens: 8192,
    temperature: 1,
    verbose: false,
    enableAutoSave: true,
    theme: 'auto',
  };
}

/**
 * Create a session object for testing
 */
export function createTestSessionObject(overrides?: Partial<Session>): Session {
  return {
    id: overrides?.id || 'test-session-123',
    model: overrides?.model || 'claude-sonnet-4-5-20250929',
    messages: overrides?.messages || [],
    cwd: overrides?.cwd || process.cwd(),
    createdAt: overrides?.createdAt || Date.now(),
    updatedAt: overrides?.updatedAt || Date.now(),
    metadata: overrides?.metadata || {},
    cost: overrides?.cost || {
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
    },
    ...overrides,
  };
}

/**
 * Create a message object for testing
 */
export function createTestMessage(
  role: 'user' | 'assistant',
  content: string | any[]
): Message {
  return {
    role,
    content: typeof content === 'string' ? content : content,
  };
}

/**
 * Mock tool result
 */
export interface MockToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Create a mock tool execution result
 */
export function createMockToolResult(
  toolName: string,
  success: boolean,
  output?: string,
  error?: string
): MockToolResult {
  return {
    success,
    output,
    error,
  };
}

/**
 * Assert that a file contains expected content
 */
export function assertFileContains(
  env: TestEnvironment,
  relativePath: string,
  expectedContent: string
): void {
  const filePath = path.join(env.projectDir, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${relativePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  if (!content.includes(expectedContent)) {
    throw new Error(
      `File ${relativePath} does not contain expected content.\nExpected: ${expectedContent}\nActual: ${content}`
    );
  }
}

/**
 * Assert that a file matches exactly
 */
export function assertFileEquals(
  env: TestEnvironment,
  relativePath: string,
  expectedContent: string
): void {
  const filePath = path.join(env.projectDir, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${relativePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  if (content !== expectedContent) {
    throw new Error(
      `File ${relativePath} content mismatch.\nExpected:\n${expectedContent}\n\nActual:\n${content}`
    );
  }
}

/**
 * Assert that a directory contains specific files
 */
export function assertDirectoryContains(
  env: TestEnvironment,
  relativePath: string,
  expectedFiles: string[]
): void {
  const dirPath = path.join(env.projectDir, relativePath);

  if (!fs.existsSync(dirPath)) {
    throw new Error(`Directory does not exist: ${relativePath}`);
  }

  const files = fs.readdirSync(dirPath);

  for (const expectedFile of expectedFiles) {
    if (!files.includes(expectedFile)) {
      throw new Error(
        `Directory ${relativePath} does not contain file: ${expectedFile}\nActual files: ${files.join(', ')}`
      );
    }
  }
}

/**
 * Count files matching a pattern in a directory
 */
export function countFilesInDirectory(
  env: TestEnvironment,
  relativePath: string,
  pattern?: RegExp
): number {
  const dirPath = path.join(env.projectDir, relativePath);

  if (!fs.existsSync(dirPath)) {
    return 0;
  }

  const files = fs.readdirSync(dirPath);

  if (!pattern) {
    return files.length;
  }

  return files.filter(file => pattern.test(file)).length;
}

/**
 * Create a complex directory structure for testing
 */
export function createProjectStructure(env: TestEnvironment): void {
  const files = {
    'package.json': JSON.stringify({
      name: 'test-project',
      version: '1.0.0',
      scripts: {
        test: 'vitest',
        build: 'tsc',
      },
    }, null, 2),
    'src/index.ts': 'export function main() {\n  console.log("Hello, World!");\n}\n',
    'src/utils.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    'src/types.ts': 'export interface User {\n  id: string;\n  name: string;\n}\n',
    'tests/utils.test.ts': 'import { add } from "../src/utils";\n\ntest("add", () => {\n  expect(add(1, 2)).toBe(3);\n});\n',
    'README.md': '# Test Project\n\nThis is a test project.\n',
    '.gitignore': 'node_modules/\ndist/\n.env\n',
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(env.projectDir, relativePath);
    const dirPath = path.dirname(filePath);

    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

/**
 * Mock API client for testing
 */
export class MockApiClient {
  private responses: any[] = [];
  private callCount: number = 0;

  /**
   * Add a mock response
   */
  addResponse(response: any): void {
    this.responses.push(response);
  }

  /**
   * Get the next mock response
   */
  getNextResponse(): any {
    if (this.callCount >= this.responses.length) {
      throw new Error('No more mock responses available');
    }
    return this.responses[this.callCount++];
  }

  /**
   * Get the number of API calls made
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset the mock client
   */
  reset(): void {
    this.responses = [];
    this.callCount = 0;
  }
}

/**
 * Simulate user input for interactive tests
 */
export class MockInput {
  private inputs: string[] = [];
  private currentIndex: number = 0;

  /**
   * Add input to the queue
   */
  addInput(input: string): void {
    this.inputs.push(input);
  }

  /**
   * Get the next input
   */
  getNextInput(): string {
    if (this.currentIndex >= this.inputs.length) {
      throw new Error('No more mock inputs available');
    }
    return this.inputs[this.currentIndex++];
  }

  /**
   * Check if there are more inputs
   */
  hasMoreInputs(): boolean {
    return this.currentIndex < this.inputs.length;
  }

  /**
   * Reset the mock input
   */
  reset(): void {
    this.inputs = [];
    this.currentIndex = 0;
  }
}

/**
 * Parse tool use from message content
 */
export function parseToolUse(content: any[]): { name: string; input: any }[] {
  return content
    .filter((item: any) => item.type === 'tool_use')
    .map((item: any) => ({
      name: item.name,
      input: item.input,
    }));
}

/**
 * Create a tool result message
 */
export function createToolResultMessage(toolUseId: string, result: string): any {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: result,
  };
}
