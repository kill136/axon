/**
 * Tests for TaskStop → TaskOutput merge
 * Verifies that TaskOutputTool now supports action=stop parameter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskOutputTool } from '../../src/tools/agent.js';

describe('TaskOutputTool - TaskStop merge', () => {
  let tool: TaskOutputTool;

  beforeEach(() => {
    tool = new TaskOutputTool();
  });

  it('should have action property in input schema', () => {
    const schema = tool.getInputSchema();
    expect(schema.properties).toHaveProperty('action');
    expect(schema.properties.action.enum).toEqual(['stop']);
  });

  it('should still require task_id', () => {
    const schema = tool.getInputSchema();
    expect(schema.required).toContain('task_id');
  });

  it('should handle action=stop for non-existent task', async () => {
    const result = await tool.execute({
      task_id: 'non-existent-id',
      action: 'stop',
    });
    expect(result.success).toBe(false);
    // Should get a "not found" error from killBackgroundTask
    expect(result.error).toBeDefined();
  });

  it('should handle normal get output for non-existent task', async () => {
    const result = await tool.execute({
      task_id: 'non-existent-id',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('description should mention stop functionality', () => {
    expect(tool.description).toContain('stop');
    expect(tool.description).toContain('action="stop"');
  });

  it('searchHint should include stop-related keywords', () => {
    expect(tool.searchHint).toContain('stop process');
    expect(tool.searchHint).toContain('kill background task');
    expect(tool.searchHint).toContain('terminate shell');
  });

  it('name should still be TaskOutput', () => {
    expect(tool.name).toBe('TaskOutput');
  });
});
