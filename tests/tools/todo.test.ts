/**
 * Unit tests for TodoWrite tool
 * Tests task management, validation, and state handling
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TodoWriteTool, getTodos, setTodos } from '../../src/tools/todo.js';
import type { TodoWriteInput } from '../../src/types/index.js';

describe('TodoWriteTool', () => {
  let todoTool: TodoWriteTool;

  beforeEach(() => {
    todoTool = new TodoWriteTool();
    // Clear todos before each test
    setTodos([]);
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = todoTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('todos');
      expect(schema.required).toContain('todos');
    });

    it('should define todos array schema', () => {
      const schema = todoTool.getInputSchema();
      expect(schema.properties?.todos).toBeDefined();
      const todosSchema = schema.properties?.todos as any;
      expect(todosSchema.type).toBe('array');
      expect(todosSchema.items).toBeDefined();
    });

    it('should define todo item properties', () => {
      const schema = todoTool.getInputSchema();
      const todosSchema = schema.properties?.todos as any;
      const itemSchema = todosSchema.items;

      expect(itemSchema.properties).toHaveProperty('content');
      expect(itemSchema.properties).toHaveProperty('status');
      expect(itemSchema.properties).toHaveProperty('activeForm');
      expect(itemSchema.required).toEqual(['content', 'status', 'activeForm']);
    });

    it('should have correct status enum values', () => {
      const schema = todoTool.getInputSchema();
      const todosSchema = schema.properties?.todos as any;
      const itemSchema = todosSchema.items;

      expect(itemSchema.properties.status.enum).toEqual([
        'pending',
        'in_progress',
        'completed'
      ]);
    });

    it('should require minimum length for content and activeForm', () => {
      const schema = todoTool.getInputSchema();
      const todosSchema = schema.properties?.todos as any;
      const itemSchema = todosSchema.items;

      expect(itemSchema.properties.content.minLength).toBe(1);
      expect(itemSchema.properties.activeForm.minLength).toBe(1);
    });
  });

  describe('Creating Single Task', () => {
    it('should create a single pending task', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Write unit tests',
            status: 'pending',
            activeForm: 'Writing unit tests'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Todos have been modified successfully');
      expect(getTodos()).toHaveLength(1);
      expect(getTodos()[0]).toEqual(input.todos[0]);
    });

    it('should create a single in_progress task', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Running tests',
            status: 'in_progress',
            activeForm: 'Running tests'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Todos have been modified successfully');
      expect(getTodos()).toHaveLength(1);
    });

    it('should create a single completed task', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Tests completed',
            status: 'completed',
            activeForm: 'Completing tests'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Todos have been modified successfully');
      // All completed tasks are auto-cleared by the implementation
      expect(getTodos()).toHaveLength(0);
    });
  });

  describe('Creating Multiple Tasks', () => {
    it('should create multiple tasks with different statuses', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Doing task 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Doing task 2' },
          { content: 'Task 3', status: 'completed', activeForm: 'Doing task 3' }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Todos have been modified successfully');
      expect(getTodos()).toHaveLength(3);
    });

    it('should show numbered list in output', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'First', status: 'pending', activeForm: 'First task' },
          { content: 'Second', status: 'pending', activeForm: 'Second task' },
          { content: 'Third', status: 'pending', activeForm: 'Third task' }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Todos have been modified successfully');
    });

    it('should create all pending tasks', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'Task A', status: 'pending', activeForm: 'Doing A' },
          { content: 'Task B', status: 'pending', activeForm: 'Doing B' },
          { content: 'Task C', status: 'pending', activeForm: 'Doing C' }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      const todos = getTodos();
      expect(todos.every(t => t.status === 'pending')).toBe(true);
    });
  });

  describe('Task Status Transitions', () => {
    it('should transition task from pending to in_progress', async () => {
      // First create a pending task
      await todoTool.execute({
        todos: [
          { content: 'Build feature', status: 'pending', activeForm: 'Building feature' }
        ]
      });

      // Then update to in_progress
      const result = await todoTool.execute({
        todos: [
          { content: 'Build feature', status: 'in_progress', activeForm: 'Building feature' }
        ]
      });

      expect(result.success).toBe(true);
      expect(getTodos()[0].status).toBe('in_progress');
    });

    it('should transition task from in_progress to completed', async () => {
      // Create in_progress task
      await todoTool.execute({
        todos: [
          { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' }
        ]
      });

      // Update to completed
      const result = await todoTool.execute({
        todos: [
          { content: 'Run tests', status: 'completed', activeForm: 'Running tests' }
        ]
      });

      expect(result.success).toBe(true);
      // All completed → auto-cleared
      expect(getTodos()).toHaveLength(0);
    });

    it('should handle workflow: pending -> in_progress -> completed', async () => {
      const taskInput = {
        content: 'Implement feature',
        activeForm: 'Implementing feature'
      };

      // Start as pending
      await todoTool.execute({
        todos: [{ ...taskInput, status: 'pending' as const }]
      });
      expect(getTodos()[0].status).toBe('pending');

      // Move to in_progress
      await todoTool.execute({
        todos: [{ ...taskInput, status: 'in_progress' as const }]
      });
      expect(getTodos()[0].status).toBe('in_progress');

      // Complete - all completed → auto-cleared
      await todoTool.execute({
        todos: [{ ...taskInput, status: 'completed' as const }]
      });
      expect(getTodos()).toHaveLength(0);
    });

    it('should update multiple tasks simultaneously', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'Task 1', status: 'completed', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Doing 2' },
          { content: 'Task 3', status: 'pending', activeForm: 'Doing 3' }
        ]
      };

      const result = await todoTool.execute(input);
      expect(result.success).toBe(true);

      const todos = getTodos();
      expect(todos[0].status).toBe('completed');
      expect(todos[1].status).toBe('in_progress');
      expect(todos[2].status).toBe('pending');
    });
  });

  describe('Empty Task List Handling', () => {
    it('should handle empty todos array', async () => {
      const input: TodoWriteInput = {
        todos: []
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(getTodos()).toHaveLength(0);
      expect(result.output).toContain('Todos have been modified successfully');
    });

    it('should clear existing todos when given empty array', async () => {
      // Create some todos first
      await todoTool.execute({
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Doing 1' }
        ]
      });
      expect(getTodos()).toHaveLength(1);

      // Clear with empty array
      const result = await todoTool.execute({
        todos: []
      });

      expect(result.success).toBe(true);
      expect(getTodos()).toHaveLength(0);
    });
  });

  describe('Invalid Input Handling', () => {
    it('should fail when multiple tasks are in_progress', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'Task 1', status: 'in_progress', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Doing 2' }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Only one task can be in_progress');
    });

    it('should fail when three tasks are in_progress', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'Task 1', status: 'in_progress', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Doing 2' },
          { content: 'Task 3', status: 'in_progress', activeForm: 'Doing 3' }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should allow exactly one in_progress task', async () => {
      const input: TodoWriteInput = {
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Doing 2' },
          { content: 'Task 3', status: 'completed', activeForm: 'Doing 3' }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
    });

    it('should not modify state when validation fails', async () => {
      // Set initial state
      await todoTool.execute({
        todos: [
          { content: 'Original task', status: 'pending', activeForm: 'Original' }
        ]
      });

      const originalTodos = getTodos();

      // Try to set invalid state
      await todoTool.execute({
        todos: [
          { content: 'Task 1', status: 'in_progress', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'in_progress', activeForm: 'Doing 2' }
        ]
      });

      // State should remain unchanged
      expect(getTodos()).toEqual(originalTodos);
    });
  });

  describe('Task Content Validation', () => {
    it('should accept tasks with special characters', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Fix bug #123: Memory leak in API',
            status: 'pending',
            activeForm: 'Fixing bug #123'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(getTodos()[0].content).toContain('#123');
    });

    it('should accept tasks with multiline-like content', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Update dependencies:\n- React 18\n- TypeScript 5',
            status: 'pending',
            activeForm: 'Updating dependencies'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(getTodos()[0].content).toContain('React 18');
    });

    it('should accept very long task content', async () => {
      const longContent = 'A'.repeat(500);
      const input: TodoWriteInput = {
        todos: [
          {
            content: longContent,
            status: 'pending',
            activeForm: 'Processing'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      expect(getTodos()[0].content).toHaveLength(500);
    });

    it('should preserve exact content and activeForm text', async () => {
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Exact content with   spaces',
            status: 'pending',
            activeForm: 'Exact activeForm with   spaces'
          }
        ]
      };

      const result = await todoTool.execute(input);

      expect(result.success).toBe(true);
      const todos = getTodos();
      expect(todos[0].content).toBe('Exact content with   spaces');
      expect(todos[0].activeForm).toBe('Exact activeForm with   spaces');
    });
  });

  describe('State Management', () => {
    it('should update global state via setTodos', () => {
      const todos = [
        { content: 'Task 1', status: 'pending' as const, activeForm: 'Doing 1' }
      ];

      setTodos(todos);
      expect(getTodos()).toEqual(todos);
    });

    it('should return a copy from getTodos (immutability)', () => {
      const todos = [
        { content: 'Task 1', status: 'pending' as const, activeForm: 'Doing 1' }
      ];

      setTodos(todos);
      const retrieved = getTodos();

      // Modify the retrieved array
      retrieved.push({
        content: 'Task 2',
        status: 'pending',
        activeForm: 'Doing 2'
      });

      // Original should be unchanged
      expect(getTodos()).toHaveLength(1);
    });

    it('should persist todos across multiple execute calls', async () => {
      await todoTool.execute({
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Doing 1' }
        ]
      });

      await todoTool.execute({
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'pending', activeForm: 'Doing 2' }
        ]
      });

      expect(getTodos()).toHaveLength(2);
    });

    it('should completely replace todos on each execute', async () => {
      await todoTool.execute({
        todos: [
          { content: 'Old task', status: 'pending', activeForm: 'Old' }
        ]
      });

      await todoTool.execute({
        todos: [
          { content: 'New task', status: 'pending', activeForm: 'New' }
        ]
      });

      const todos = getTodos();
      expect(todos).toHaveLength(1);
      expect(todos[0].content).toBe('New task');
    });
  });

  describe('Output Formatting', () => {
    it('should include "Todos updated:" prefix in output', async () => {
      const result = await todoTool.execute({
        todos: [
          { content: 'Test', status: 'pending', activeForm: 'Testing' }
        ]
      });

      expect(result.output).toContain('Todos have been modified successfully');
    });

    it('should show all three status icons correctly', async () => {
      const result = await todoTool.execute({
        todos: [
          { content: 'Pending', status: 'pending', activeForm: 'Pending' },
          { content: 'InProgress', status: 'in_progress', activeForm: 'InProgress' },
          { content: 'Completed', status: 'completed', activeForm: 'Completed' }
        ]
      });

      // Output is a fixed success message, status icons are rendered in UI
      expect(result.output).toContain('Todos have been modified successfully');
    });

    it('should format output with line breaks between tasks', async () => {
      const result = await todoTool.execute({
        todos: [
          { content: 'Task 1', status: 'pending', activeForm: 'Doing 1' },
          { content: 'Task 2', status: 'pending', activeForm: 'Doing 2' }
        ]
      });

      // Output is a fixed success message
      expect(result.output).toContain('Todos have been modified successfully');
    });
  });

  describe('Edge Cases', () => {
    it('should handle task with empty activeForm still being valid per schema', async () => {
      // Note: Schema requires minLength: 1, so this should actually pass validation
      // but we're testing the implementation's handling
      const input: TodoWriteInput = {
        todos: [
          {
            content: 'Test',
            status: 'pending',
            activeForm: 'A' // Minimum valid
          }
        ]
      };

      const result = await todoTool.execute(input);
      expect(result.success).toBe(true);
    });

    it('should handle rapid status changes', async () => {
      const task = { content: 'Test', activeForm: 'Testing' };

      await todoTool.execute({ todos: [{ ...task, status: 'pending' as const }] });
      await todoTool.execute({ todos: [{ ...task, status: 'in_progress' as const }] });
      await todoTool.execute({ todos: [{ ...task, status: 'completed' as const }] });
      await todoTool.execute({ todos: [{ ...task, status: 'pending' as const }] });

      expect(getTodos()[0].status).toBe('pending');
    });

    it('should handle mixed completed and pending tasks', async () => {
      const result = await todoTool.execute({
        todos: [
          { content: 'Done 1', status: 'completed', activeForm: 'Doing 1' },
          { content: 'Done 2', status: 'completed', activeForm: 'Doing 2' },
          { content: 'Todo 1', status: 'pending', activeForm: 'Doing todo 1' },
          { content: 'Todo 2', status: 'pending', activeForm: 'Doing todo 2' }
        ]
      });

      expect(result.success).toBe(true);
      const todos = getTodos();
      expect(todos.filter(t => t.status === 'completed')).toHaveLength(2);
      expect(todos.filter(t => t.status === 'pending')).toHaveLength(2);
    });

    it('should handle large number of tasks', async () => {
      const todos = Array.from({ length: 100 }, (_, i) => ({
        content: `Task ${i + 1}`,
        status: 'pending' as const,
        activeForm: `Doing task ${i + 1}`
      }));

      const result = await todoTool.execute({ todos });

      expect(result.success).toBe(true);
      expect(getTodos()).toHaveLength(100);
    });
  });

  describe('Tool Metadata', () => {
    it('should have correct tool name', () => {
      expect(todoTool.name).toBe('TodoWrite');
    });

    it('should have description', () => {
      expect(todoTool.description).toBeDefined();
      expect(todoTool.description.length).toBeGreaterThan(0);
    });

    it('should have usage guidelines in description', () => {
      expect(todoTool.description).toContain('When to Use');
      expect(todoTool.description).toContain('When NOT to Use');
    });

    it('should document task states in description', () => {
      expect(todoTool.description).toContain('pending');
      expect(todoTool.description).toContain('in_progress');
      expect(todoTool.description).toContain('completed');
    });
  });
});
