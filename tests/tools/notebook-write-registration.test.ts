import { describe, it, expect } from 'vitest';
import { toolRegistry } from '../../src/tools/index.js';

describe('NotebookWrite tool registration', () => {
  it('registers NotebookWrite in the core tool registry', () => {
    expect(toolRegistry.get('NotebookWrite')).toBeDefined();
    expect(toolRegistry.getDefinitions().some(tool => tool.name === 'NotebookWrite')).toBe(true);
  });
});
