/**
 * Blueprint system integration tests
 *
 * Note: Previous tests referenced a legacy API (BlueprintManager, TaskTreeManager,
 * TDDExecutor, AgentCoordinator, TimeTravelManager, CodebaseAnalyzer) that no longer
 * exists. The blueprint system was rewritten to use SmartPlanner, AutonomousWorkerExecutor,
 * TaskQueue, RealtimeCoordinator, ModelSelector, and LeadAgent.
 *
 * Tests for the current API should be added as needed.
 */

import { describe, it, expect } from 'vitest';
import {
  SmartPlanner,
  AutonomousWorkerExecutor,
  TaskQueue,
  RealtimeCoordinator,
  ModelSelector,
  LeadAgent,
} from '../../src/blueprint/index.js';

describe('Blueprint System', () => {
  it('should export core modules', () => {
    expect(SmartPlanner).toBeDefined();
    expect(AutonomousWorkerExecutor).toBeDefined();
    expect(TaskQueue).toBeDefined();
    expect(RealtimeCoordinator).toBeDefined();
    expect(ModelSelector).toBeDefined();
    expect(LeadAgent).toBeDefined();
  });
});
