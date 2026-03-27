import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  RalphLoopTool,
  parseRalphLoopState,
  updateRalphLoopIteration,
  hasCompletionPromise,
} from './ralph-loop';

let testDir: string;
let originalCwd: string;

beforeEach(() => {
  testDir = path.join(os.tmpdir(), `axon-ralph-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  originalCwd = process.cwd();
  process.chdir(testDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
});

describe('RalphLoopTool', () => {
  describe('execute', () => {
    it('should create ralph-loop state file', async () => {
      const tool = new RalphLoopTool();
      const result = await tool.execute({
        prompt: 'Test prompt',
      });

      expect(result.message).toContain('Ralph loop started');
      expect(result.stateFile).toContain('ralph-loop.local.md');
      expect(fs.existsSync(result.stateFile)).toBe(true);
    });

    it('should create state file with default values', async () => {
      const tool = new RalphLoopTool();
      await tool.execute({
        prompt: 'Test prompt',
      });

      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      const content = fs.readFileSync(stateFile, 'utf-8');

      expect(content).toContain('iteration: 1');
      expect(content).toContain('max_iterations: 10');
      expect(content).toContain('completion_promise: "✅ TASK COMPLETE"');
      expect(content).toContain('Test prompt');
    });

    it('should use custom max iterations', async () => {
      const tool = new RalphLoopTool();
      await tool.execute({
        prompt: 'Test prompt',
        maxIterations: 20,
      });

      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      const content = fs.readFileSync(stateFile, 'utf-8');

      expect(content).toContain('max_iterations: 20');
    });

    it('should use custom completion promise', async () => {
      const tool = new RalphLoopTool();
      await tool.execute({
        prompt: 'Test prompt',
        completionPromise: '✅ DONE',
      });

      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      const content = fs.readFileSync(stateFile, 'utf-8');

      expect(content).toContain('completion_promise: "✅ DONE"');
    });

    it('should reject empty prompt', async () => {
      const tool = new RalphLoopTool();

      await expect(
        tool.execute({
          prompt: '',
        })
      ).rejects.toThrow('Prompt cannot be empty');
    });

    it('should reject invalid max iterations', async () => {
      const tool = new RalphLoopTool();

      await expect(
        tool.execute({
          prompt: 'Test',
          maxIterations: 0,
        })
      ).rejects.toThrow('maxIterations must be between 1 and 100');

      await expect(
        tool.execute({
          prompt: 'Test',
          maxIterations: 101,
        })
      ).rejects.toThrow('maxIterations must be between 1 and 100');
    });

    it('should preserve prompt in state file', async () => {
      const tool = new RalphLoopTool();
      const testPrompt = 'This is a longer test prompt\nwith multiple lines\nand special characters: @#$%';

      await tool.execute({
        prompt: testPrompt,
      });

      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      const content = fs.readFileSync(stateFile, 'utf-8');

      expect(content).toContain(testPrompt);
    });
  });

  describe('parseRalphLoopState', () => {
    it('should parse valid state file', () => {
      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });

      const content = `---
iteration: 2
max_iterations: 10
completion_promise: "✅ TASK COMPLETE"
---
Test prompt here`;

      fs.writeFileSync(stateFile, content, 'utf-8');

      const state = parseRalphLoopState(stateFile);
      expect(state).toBeDefined();
      expect(state?.iteration).toBe(2);
      expect(state?.max_iterations).toBe(10);
      expect(state?.completion_promise).toBe('✅ TASK COMPLETE');
      expect(state?.prompt).toBe('Test prompt here');
    });

    it('should return null for non-existent file', () => {
      const state = parseRalphLoopState('/non/existent/file.md');
      expect(state).toBeNull();
    });

    it('should return null for invalid format', () => {
      const stateFile = path.join(testDir, 'invalid.md');
      fs.writeFileSync(stateFile, 'This is not a valid state file', 'utf-8');

      const state = parseRalphLoopState(stateFile);
      expect(state).toBeNull();
    });

    it('should handle multiline prompts', () => {
      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });

      const content = `---
iteration: 1
max_iterations: 5
completion_promise: "✅ COMPLETE"
---
Line 1
Line 2
Line 3
Output <promise>✅ COMPLETE</promise> when done`;

      fs.writeFileSync(stateFile, content, 'utf-8');

      const state = parseRalphLoopState(stateFile);
      expect(state?.prompt).toContain('Line 1');
      expect(state?.prompt).toContain('Line 2');
      expect(state?.prompt).toContain('Line 3');
    });

    it('should handle quoted values with spaces', () => {
      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });

      const content = `---
iteration: 1
max_iterations: 10
completion_promise: "✅ Task is completely done"
---
Prompt`;

      fs.writeFileSync(stateFile, content, 'utf-8');

      const state = parseRalphLoopState(stateFile);
      expect(state?.completion_promise).toBe('✅ Task is completely done');
    });
  });

  describe('updateRalphLoopIteration', () => {
    it('should update iteration number', () => {
      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });

      const content = `---
iteration: 1
max_iterations: 10
completion_promise: "✅ TASK COMPLETE"
---
Test prompt`;

      fs.writeFileSync(stateFile, content, 'utf-8');

      updateRalphLoopIteration(stateFile, 2);

      const updated = parseRalphLoopState(stateFile);
      expect(updated?.iteration).toBe(2);
      expect(updated?.max_iterations).toBe(10);
      expect(updated?.completion_promise).toBe('✅ TASK COMPLETE');
      expect(updated?.prompt).toBe('Test prompt');
    });

    it('should preserve other fields when updating iteration', () => {
      const stateFile = path.join(testDir, '.claude', 'ralph-loop.local.md');
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });

      const originalPrompt = 'Original prompt with special chars @#$%';
      const content = `---
iteration: 1
max_iterations: 15
completion_promise: "✅ Custom Promise"
---
${originalPrompt}`;

      fs.writeFileSync(stateFile, content, 'utf-8');

      updateRalphLoopIteration(stateFile, 5);

      const updated = parseRalphLoopState(stateFile);
      expect(updated?.iteration).toBe(5);
      expect(updated?.max_iterations).toBe(15);
      expect(updated?.completion_promise).toBe('✅ Custom Promise');
      expect(updated?.prompt).toBe(originalPrompt);
    });

    it('should throw if state file is invalid', () => {
      const stateFile = path.join(testDir, 'invalid.md');
      fs.writeFileSync(stateFile, 'Invalid content', 'utf-8');

      expect(() => updateRalphLoopIteration(stateFile, 2)).toThrow();
    });
  });

  describe('hasCompletionPromise', () => {
    it('should detect completion promise in output', () => {
      const output = 'Some task output\n<promise>✅ TASK COMPLETE</promise>\nMore output';
      const result = hasCompletionPromise(output, '✅ TASK COMPLETE');

      expect(result).toBe(true);
    });

    it('should not match without promise tags', () => {
      const output = 'Some output with ✅ TASK COMPLETE but no tags';
      const result = hasCompletionPromise(output, '✅ TASK COMPLETE');

      expect(result).toBe(false);
    });

    it('should be case-sensitive', () => {
      const output = '<promise>✅ task complete</promise>';
      const result = hasCompletionPromise(output, '✅ TASK COMPLETE');

      expect(result).toBe(false);
    });

    it('should require exact match', () => {
      const output = '<promise>✅ TASK COMPLETE</promise>';
      const result1 = hasCompletionPromise(output, '✅ TASK COMPLETE');
      const result2 = hasCompletionPromise(output, '✅ TASK');

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    it('should detect multiple promises', () => {
      const output = '<promise>✅ PART 1</promise> and later <promise>✅ PART 1</promise>';
      const result = hasCompletionPromise(output, '✅ PART 1');

      expect(result).toBe(true);
    });
  });
});
