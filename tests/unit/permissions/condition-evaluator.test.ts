/**
 * 条件规则引擎测试 (Subtask 7.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import ConditionEvaluator from '../../../src/permissions/condition-evaluator';

describe('ConditionEvaluator', () => {
  let evaluator: ConditionEvaluator;

  beforeEach(() => {
    evaluator = new ConditionEvaluator();
  });

  describe('parseToolMatcher', () => {
    it('should parse simple tool name without pattern', () => {
      const result = evaluator.parseToolMatcher('Bash');
      expect(result).toEqual({ toolName: 'Bash', pattern: undefined });
    });

    it('should parse tool name with pattern', () => {
      const result = evaluator.parseToolMatcher('Bash(git *)');
      expect(result).toEqual({ toolName: 'Bash', pattern: 'git *' });
    });

    it('should parse tool name with glob pattern', () => {
      const result = evaluator.parseToolMatcher('Write(src/*)');
      expect(result).toEqual({ toolName: 'Write', pattern: 'src/*' });
    });

    it('should parse tool name with ** pattern', () => {
      const result = evaluator.parseToolMatcher('Read(src/**)');
      expect(result).toEqual({ toolName: 'Read', pattern: 'src/**' });
    });

    it('should handle whitespace', () => {
      const result = evaluator.parseToolMatcher('  Bash(git *)  ');
      expect(result).toEqual({ toolName: 'Bash', pattern: 'git *' });
    });

    it('should return null for invalid format', () => {
      expect(evaluator.parseToolMatcher('invalid[')).toBeNull();
    });
  });

  describe('matchesPattern', () => {
    it('should match * wildcard to any value', () => {
      expect(evaluator.matchesPattern('*', 'anything')).toBe(true);
    });

    it('should match exact pattern', () => {
      expect(evaluator.matchesPattern('git', 'git')).toBe(true);
    });

    it('should match prefix pattern with *', () => {
      expect(evaluator.matchesPattern('git *', 'git commit')).toBe(true);
    });

    it('should match path patterns with **', () => {
      expect(evaluator.matchesPattern('src/**', 'src/file.ts')).toBe(true);
      expect(evaluator.matchesPattern('src/**', 'src/dir/file.ts')).toBe(true);
    });

    it('should cache compiled regex', () => {
      const pattern = 'src/**/*.ts';
      const initialSize = evaluator.getCacheSize();
      evaluator.matchesPattern(pattern, 'src/file.ts');
      expect(evaluator.getCacheSize()).toBe(initialSize + 1);
      evaluator.matchesPattern(pattern, 'src/dir/file.ts');
      expect(evaluator.getCacheSize()).toBe(initialSize + 1);
    });
  });

  describe('evaluate', () => {
    it('should evaluate Bash(git *)', () => {
      expect(evaluator.evaluate('Bash(git *)', 'Bash', 'git commit')).toBe(true);
      expect(evaluator.evaluate('Bash(git *)', 'Bash', 'npm install')).toBe(false);
    });

    it('should evaluate Write(src/*)', () => {
      expect(evaluator.evaluate('Write(src/*)', 'Write', 'src/file.ts')).toBe(true);
      expect(evaluator.evaluate('Write(src/*)', 'Edit', 'src/file.ts')).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear the regex cache', () => {
      evaluator.matchesPattern('src/**', 'src/file.ts');
      expect(evaluator.getCacheSize()).toBeGreaterThan(0);
      evaluator.clearCache();
      expect(evaluator.getCacheSize()).toBe(0);
    });
  });
});
