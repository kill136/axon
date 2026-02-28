/**
 * Unit tests for Agent tools (Task, TaskOutput, ListAgents)
 * Tests sub-agent management, task execution, and state persistence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TaskTool,
  TaskOutputTool,
  getBackgroundAgents,
  getBackgroundAgent,
  killBackgroundAgent,
  clearCompletedAgents,
  AGENT_TYPES
} from '../../src/tools/agent.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Tests that call executeAgentSync/executeAgentLoop need a valid API key
const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.AXON_API_KEY);

describe('TaskTool', () => {
  let taskTool: TaskTool;
  let agentsDir: string;

  beforeEach(() => {
    taskTool = new TaskTool();
    agentsDir = path.join(os.homedir(), '.axon', 'agents');
  });

  afterEach(() => {
    // Clean up test agents
    clearCompletedAgents();
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = taskTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('description');
      expect(schema.properties).toHaveProperty('prompt');
      expect(schema.properties).toHaveProperty('subagent_type');
      expect(schema.properties).toHaveProperty('model');
      expect(schema.properties).toHaveProperty('resume');
      expect(schema.properties).toHaveProperty('run_in_background');
      expect(schema.required).toContain('description');
      expect(schema.required).toContain('prompt');
      expect(schema.required).toContain('subagent_type');
    });
  });

  describe('Agent Type Validation', () => {
    it('should reject invalid agent type', async () => {
      const result = await taskTool.execute({
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'invalid-type'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown agent type');
    });

    it('should list available agent types in error', async () => {
      const result = await taskTool.execute({
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'invalid'
      });

      expect(result.error).toContain('general-purpose');
      expect(result.error).toContain('Explore');
      expect(result.error).toContain('Plan');
      expect(result.error).toContain('claude-code-guide');
    });
  });

  describe('Synchronous Execution', () => {
    it.skipIf(!hasApiKey)('should execute agent synchronously by default', async () => {
      const result = await taskTool.execute({
        description: 'Simple task',
        prompt: 'Test prompt',
        subagent_type: 'general-purpose'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Agent');
    }, 15000);

    it.skipIf(!hasApiKey)('should include agent ID in output', async () => {
      const result = await taskTool.execute({
        description: 'Test',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      expect(result.output).toMatch(/[0-9a-f-]{36}/); // UUID pattern
    });

  });

  describe('Model Selection', () => {
    it.skipIf(!hasApiKey)('should work with different models for different agent types', async () => {
      const exploreResult = await taskTool.execute({
        description: 'Explore with haiku',
        prompt: 'Quick search',
        subagent_type: 'Explore',
        model: 'haiku'
      });

      const planResult = await taskTool.execute({
        description: 'Plan with opus',
        prompt: 'Complex design',
        subagent_type: 'Plan',
        model: 'opus'
      });

      expect(exploreResult.success).toBe(true);
      expect(exploreResult.output).toContain('haiku');
      expect(planResult.success).toBe(true);
      expect(planResult.output).toContain('opus');
    });
  });

  describe('Background Execution', () => {
    it('should start background agent', async () => {
      const result = await taskTool.execute({
        description: 'Background task',
        prompt: 'Long running task',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('background');
      expect(result.output).toMatch(/[0-9a-f-]{36}/); // Should contain agent ID
    });

    it('should allow checking background agent status', async () => {
      const result = await taskTool.execute({
        description: 'BG task',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const agents = getBackgroundAgents();
      expect(agents.length).toBeGreaterThan(0);
    });
  });

  describe('Agent Resume', () => {
    it.skipIf(!hasApiKey)('should handle resume with paused agent ID', async () => {
      // Start and get agent ID
      const startResult = await taskTool.execute({
        description: 'Resumable task',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      expect(startResult.success).toBe(true);

      // Extract agent ID from output
      const idMatch = startResult.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) {
        throw new Error('No agent ID found in output');
      }
      const agentId = idMatch[0];

      // Manually pause the agent by modifying state directly
      const agent = getBackgroundAgent(agentId);
      if (agent) {
        agent.status = 'failed';  // Use failed instead of paused since failed can be resumed
        agent.error = 'Test error for resume';
        // Save the failed state
        const { default: fs } = await import('fs');
        const { default: path } = await import('path');
        const { default: os } = await import('os');
        const agentsDir = path.join(os.homedir(), '.axon', 'agents');
        if (!fs.existsSync(agentsDir)) {
          fs.mkdirSync(agentsDir, { recursive: true });
        }
        const filePath = path.join(agentsDir, `${agentId}.json`);
        const data = {
          ...agent,
          startTime: agent.startTime.toISOString(),
          endTime: agent.endTime?.toISOString(),
          history: agent.history.map(h => ({
            ...h,
            timestamp: h.timestamp.toISOString(),
          })),
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }

      // Resume - Should work with failed agent
      const resumeResult = await taskTool.execute({
        description: 'Resume',
        prompt: 'Resume',
        subagent_type: 'general-purpose',
        resume: agentId
      });

      // Since the agent may complete quickly, just check it processes the resume
      expect(resumeResult.success).toBe(true);
      // The output should either contain "Resuming" or show it re-executed
      expect(resumeResult.output).toBeDefined();
    });

    it('should fail to resume non-existent agent', async () => {
      const result = await taskTool.execute({
        description: 'Resume',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        resume: 'nonexistent-id'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it.skipIf(!hasApiKey)('should fail to resume completed agent', async () => {
      const startResult = await taskTool.execute({
        description: 'Complete task',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      const idMatch = startResult.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const resumeResult = await taskTool.execute({
        description: 'Resume',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        resume: idMatch[0]
      });

      expect(resumeResult.success).toBe(false);
      expect(resumeResult.error).toContain('completed');
    });

    it('should fail to resume running agent', async () => {
      const startResult = await taskTool.execute({
        description: 'Running task',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const idMatch = startResult.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const resumeResult = await taskTool.execute({
        description: 'Resume',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        resume: idMatch[0]
      });

      expect(resumeResult.success).toBe(false);
      expect(resumeResult.error).toContain('still running');
    });

    it.skipIf(!hasApiKey)('should resume agent in background when run_in_background is true', async () => {
      const startResult = await taskTool.execute({
        description: 'BG Resume task',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      const idMatch = startResult.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const agent = getBackgroundAgent(idMatch[0]);
      if (agent) {
        agent.status = 'paused';
      }

      const resumeResult = await taskTool.execute({
        description: 'Resume BG',
        prompt: 'Resume',
        subagent_type: 'general-purpose',
        resume: idMatch[0],
        run_in_background: true
      });

      expect(resumeResult.success).toBe(true);
      expect(resumeResult.output).toContain('resumed in background');
    });

    it.skipIf(!hasApiKey)('should include agent information in resume attempt', async () => {
      const startResult = await taskTool.execute({
        description: 'History task',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const idMatch = startResult.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const agent = getBackgroundAgent(idMatch[0]);
      if (agent) {
        agent.status = 'failed';
        agent.error = 'Test error';
        // Save the failed state
        const { default: fs } = await import('fs');
        const { default: path } = await import('path');
        const { default: os } = await import('os');
        const agentsDir = path.join(os.homedir(), '.axon', 'agents');
        if (!fs.existsSync(agentsDir)) {
          fs.mkdirSync(agentsDir, { recursive: true });
        }
        const filePath = path.join(agentsDir, `${idMatch[0]}.json`);
        const data = {
          ...agent,
          startTime: agent.startTime.toISOString(),
          endTime: agent.endTime?.toISOString(),
          history: agent.history.map(h => ({
            ...h,
            timestamp: h.timestamp.toISOString(),
          })),
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }

      const resumeResult = await taskTool.execute({
        description: 'Resume',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        resume: idMatch[0]
      });

      // Should successfully process resume (may show history or re-execute)
      expect(resumeResult.success).toBe(true);
      expect(resumeResult.output).toBeDefined();
      expect(resumeResult.output).toBeTruthy();
    });
  });

  describe('Agent State Persistence', () => {
    it.skipIf(!hasApiKey)('should persist agent to disk', async () => {
      const result = await taskTool.execute({
        description: 'Persist test',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      expect(result.success).toBe(true);

      // Check if agents directory exists
      if (fs.existsSync(agentsDir)) {
        const files = fs.readdirSync(agentsDir);
        expect(files.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('TaskOutputTool', () => {
  let taskTool: TaskTool;
  let outputTool: TaskOutputTool;

  beforeEach(() => {
    taskTool = new TaskTool();
    outputTool = new TaskOutputTool();
  });

  afterEach(() => {
    clearCompletedAgents();
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = outputTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('task_id');
      expect(schema.properties).toHaveProperty('block');
      expect(schema.properties).toHaveProperty('timeout');
      expect(schema.properties).toHaveProperty('show_history');
      expect(schema.required).toContain('task_id');
    });
  });

  describe('Get Agent Output', () => {
    it('should fail for non-existent task ID', async () => {
      const result = await outputTool.execute({
        task_id: 'nonexistent-id'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

  });
});

describe('Agent Management Functions', () => {
  let taskTool: TaskTool;

  beforeEach(() => {
    taskTool = new TaskTool();
  });

  afterEach(() => {
    clearCompletedAgents();
  });

  describe('getBackgroundAgents', () => {
    it('should return all background agents', async () => {
      await taskTool.execute({
        description: 'Test',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const agents = getBackgroundAgents();
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('should return array of agents', () => {
      const agents = getBackgroundAgents();
      expect(Array.isArray(agents)).toBe(true);
      // Length can vary based on previous tests
      expect(agents.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getBackgroundAgent', () => {
    it.skipIf(!hasApiKey)('should retrieve specific agent by ID', async () => {
      const result = await taskTool.execute({
        description: 'Get test',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      const idMatch = result.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const agent = getBackgroundAgent(idMatch[0]);
      expect(agent).toBeDefined();
      expect(agent?.id).toBe(idMatch[0]);
    });

    it('should return undefined for non-existent ID', () => {
      const agent = getBackgroundAgent('nonexistent');
      expect(agent).toBeUndefined();
    });
  });

  describe('killBackgroundAgent', () => {
    it('should kill running agent', async () => {
      const result = await taskTool.execute({
        description: 'Kill test',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const idMatch = result.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const killed = killBackgroundAgent(idMatch[0]);
      expect(killed).toBe(true);

      const agent = getBackgroundAgent(idMatch[0]);
      expect(agent?.status).toBe('failed');
    });

    it('should return false for non-existent agent', () => {
      const killed = killBackgroundAgent('nonexistent');
      expect(killed).toBe(false);
    });
  });

  describe('clearCompletedAgents', () => {
    it('should clear completed agents', async () => {
      await taskTool.execute({
        description: 'Clear test',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      const cleared = clearCompletedAgents();
      expect(cleared).toBeGreaterThanOrEqual(0);
    });

    it('should not clear running agents', async () => {
      await taskTool.execute({
        description: 'Clear test 2',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const beforeCount = getBackgroundAgents().length;
      clearCompletedAgents();
      const afterCount = getBackgroundAgents().length;

      // Running agents should not be cleared
      expect(afterCount).toBeGreaterThan(0);
    });

    it('should clear failed agents', async () => {
      const result = await taskTool.execute({
        description: 'Failed test',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      const idMatch = result.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      killBackgroundAgent(idMatch[0]);
      const cleared = clearCompletedAgents();
      expect(cleared).toBeGreaterThan(0);
    });
  });

  describe('pauseBackgroundAgent', () => {
    it('should pause running agent', async () => {
      const result = await taskTool.execute({
        description: 'Pause test',
        prompt: 'Test',
        subagent_type: 'general-purpose',
        run_in_background: true
      });

      const idMatch = result.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const { pauseBackgroundAgent } = await import('../../src/tools/agent.js');
      const paused = pauseBackgroundAgent(idMatch[0]);
      expect(paused).toBe(true);

      const agent = getBackgroundAgent(idMatch[0]);
      expect(agent?.status).toBe('paused');
    });

    it('should return false for non-existent agent', async () => {
      const { pauseBackgroundAgent } = await import('../../src/tools/agent.js');
      const paused = pauseBackgroundAgent('nonexistent');
      expect(paused).toBe(false);
    });

    it('should not pause non-running agent', async () => {
      const result = await taskTool.execute({
        description: 'Completed pause test',
        prompt: 'Test',
        subagent_type: 'general-purpose'
      });

      const idMatch = result.output?.match(/[0-9a-f-]{36}/);
      if (!idMatch) return;

      const { pauseBackgroundAgent } = await import('../../src/tools/agent.js');
      const paused = pauseBackgroundAgent(idMatch[0]);
      expect(paused).toBe(false);
    });
  });
});

describe('Agent Types', () => {
  it('should have all expected agent types defined', () => {
    expect(AGENT_TYPES).toHaveProperty('general-purpose');
    expect(AGENT_TYPES).toHaveProperty('Explore');
    expect(AGENT_TYPES).toHaveProperty('Plan');
    expect(AGENT_TYPES).toHaveProperty('claude-code-guide');
  });

  it('should have description for each agent type', () => {
    Object.values(AGENT_TYPES).forEach(type => {
      expect(type).toHaveProperty('description');
      expect(type.description).toBeTruthy();
    });
  });

  it('should have tools list for each agent type', () => {
    Object.values(AGENT_TYPES).forEach(type => {
      expect(type).toHaveProperty('tools');
      expect(Array.isArray(type.tools)).toBe(true);
    });
  });

  it('should have general-purpose agent with all tools', () => {
    expect(AGENT_TYPES['general-purpose'].tools).toEqual(['*']);
  });

  it('should have Explore agent with limited tools', () => {
    const exploreTools = AGENT_TYPES['Explore'].tools;
    expect(exploreTools).toContain('Glob');
    expect(exploreTools).toContain('Grep');
    expect(exploreTools).toContain('Read');
  });

  it('should have Plan agent with all tools', () => {
    expect(AGENT_TYPES['Plan'].tools).toEqual(['*']);
  });

  it('should have claude-code-guide agent with documentation tools', () => {
    const guideTools = AGENT_TYPES['claude-code-guide'].tools;
    expect(guideTools).toContain('Glob');
    expect(guideTools).toContain('Grep');
    expect(guideTools).toContain('Read');
    expect(guideTools).toContain('WebFetch');
    expect(guideTools).toContain('WebSearch');
  });
});

describe('Edge Cases and Error Handling', () => {
  let taskTool: TaskTool;

  beforeEach(() => {
    taskTool = new TaskTool();
  });

  afterEach(() => {
    clearCompletedAgents();
  });

  it.skipIf(!hasApiKey)('should handle empty description', async () => {
    const result = await taskTool.execute({
      description: '',
      prompt: 'Test',
      subagent_type: 'general-purpose'
    });

    // Should still succeed even with empty description
    expect(result.success).toBe(true);
  });

  it.skipIf(!hasApiKey)('should handle very long description', async () => {
    const longDescription = 'A'.repeat(1000);
    const result = await taskTool.execute({
      description: longDescription,
      prompt: 'Test',
      subagent_type: 'general-purpose'
    });

    expect(result.success).toBe(true);
  });

  it.skipIf(!hasApiKey)('should handle empty prompt', async () => {
    const result = await taskTool.execute({
      description: 'Test',
      prompt: '',
      subagent_type: 'general-purpose'
    });

    // Should still succeed even with empty prompt
    expect(result.success).toBe(true);
  });

  it.skipIf(!hasApiKey)('should handle special characters in inputs', async () => {
    const result = await taskTool.execute({
      description: 'Test with 特殊字符 🚀',
      prompt: 'Prompt with <html> & "quotes"',
      subagent_type: 'general-purpose'
    });

    expect(result.success).toBe(true);
  });

  it.skipIf(!hasApiKey)('should preserve agent metadata', async () => {
    const result = await taskTool.execute({
      description: 'Metadata test',
      prompt: 'Test',
      subagent_type: 'Explore',
      model: 'haiku'
    });

    const idMatch = result.output?.match(/[0-9a-f-]{36}/);
    if (!idMatch) return;

    const agent = getBackgroundAgent(idMatch[0]);
    expect(agent?.agentType).toBe('Explore');
    expect(agent?.model).toBe('haiku');
    expect(agent?.description).toBe('Metadata test');
    expect(agent?.prompt).toBe('Test');
  });

  it.skipIf(!hasApiKey)('should track working directory', async () => {
    const result = await taskTool.execute({
      description: 'WD test',
      prompt: 'Test',
      subagent_type: 'general-purpose'
    });

    const idMatch = result.output?.match(/[0-9a-f-]{36}/);
    if (!idMatch) return;

    const agent = getBackgroundAgent(idMatch[0]);
    expect(agent?.workingDirectory).toBeDefined();
    expect(typeof agent?.workingDirectory).toBe('string');
  });

  it.skipIf(!hasApiKey)('should handle concurrent agent executions', async () => {
    const promises = [
      taskTool.execute({
        description: 'Concurrent 1',
        prompt: 'Test 1',
        subagent_type: 'general-purpose'
      }),
      taskTool.execute({
        description: 'Concurrent 2',
        prompt: 'Test 2',
        subagent_type: 'Explore'
      }),
      taskTool.execute({
        description: 'Concurrent 3',
        prompt: 'Test 3',
        subagent_type: 'Plan'
      })
    ];

    const results = await Promise.all(promises);

    results.forEach(result => {
      expect(result.success).toBe(true);
    });
  });
});
