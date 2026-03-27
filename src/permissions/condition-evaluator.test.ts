/**
 * 条件规则引擎测试 (Subtask 7.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import ConditionEvaluator from './condition-evaluator';

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

    it('should parse tool name with complex pattern', () => {
      const result = evaluator.parseToolMatcher('Edit(*.ts)');
      expect(result).toEqual({ toolName: 'Edit', pattern: '*.ts' });
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
      expect(evaluator.parseToolMatcher('(missing)')).toBeNull();
    });

    it('should handle empty pattern', () => {
      const result = evaluator.parseToolMatcher('Bash()');
      expect(result).toEqual({ toolName: 'Bash', pattern: '' });
    });
  });

  describe('matchesTool', () => {
    it('should match exact tool name', () => {
      expect(evaluator.matchesTool('Bash', 'Bash')).toBe(true);
      expect(evaluator.matchesTool('Write', 'Write')).toBe(true);
    });

    it('should not match different tool names', () => {
      expect(evaluator.matchesTool('Bash', 'Read')).toBe(false);
      expect(evaluator.matchesTool('Write', 'Edit')).toBe(false);
    });

    it('should match * wildcard to any tool', () => {
      expect(evaluator.matchesTool('*', 'Bash')).toBe(true);
      expect(evaluator.matchesTool('*', 'Read')).toBe(true);
      expect(evaluator.matchesTool('*', 'Write')).toBe(true);
    });

    it('should be case sensitive', () => {
      expect(evaluator.matchesTool('bash', 'Bash')).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('should match * wildcard to any value', () => {
      expect(evaluator.matchesPattern('*', 'anything')).toBe(true);
      expect(evaluator.matchesPattern('*', 'git commit')).toBe(true);
    });

    it('should match exact pattern', () => {
      expect(evaluator.matchesPattern('git', 'git')).toBe(true);
      expect(evaluator.matchesPattern('npm install', 'npm install')).toBe(true);
    });

    it('should match prefix pattern with *', () => {
      expect(evaluator.matchesPattern('git *', 'git commit')).toBe(true);
      expect(evaluator.matchesPattern('git *', 'git push origin')).toBe(true);
      expect(evaluator.matchesPattern('git *', 'npm install')).toBe(false);
    });

    it('should match npm: prefix pattern', () => {
      expect(evaluator.matchesPattern('npm:*', 'npm:install')).toBe(true);
      expect(evaluator.matchesPattern('npm:*', 'npm:test')).toBe(true);
      expect(evaluator.matchesPattern('npm:*', 'git:push')).toBe(false);
    });

    it('should match path patterns with **', () => {
      expect(evaluator.matchesPattern('src/**', 'src/file.ts')).toBe(true);
      expect(evaluator.matchesPattern('src/**', 'src/dir/file.ts')).toBe(true);
      expect(evaluator.matchesPattern('src/**', 'test/file.ts')).toBe(false);
    });

    it('should match file extension patterns', () => {
      expect(evaluator.matchesPattern('*.ts', 'file.ts')).toBe(true);
      expect(evaluator.matchesPattern('*.ts', 'dir/file.ts')).toBe(false); // * doesn't cross /
      expect(evaluator.matchesPattern('**/*.ts', 'dir/file.ts')).toBe(true);
    });

    it('should match ? wildcard for single character', () => {
      expect(evaluator.matchesPattern('file?.ts', 'file1.ts')).toBe(true);
      expect(evaluator.matchesPattern('file?.ts', 'fileA.ts')).toBe(true);
      expect(evaluator.matchesPattern('file?.ts', 'file12.ts')).toBe(false);
    });

    it('should cache compiled regex', () => {
      const pattern = 'src/**/*.ts';
      const initialSize = evaluator.getCacheSize();
      evaluator.matchesPattern(pattern, 'src/file.ts');
      expect(evaluator.getCacheSize()).toBe(initialSize + 1);
      // Second call should use cache
      evaluator.matchesPattern(pattern, 'src/dir/file.ts');
      expect(evaluator.getCacheSize()).toBe(initialSize + 1);
    });

    it('should handle special regex characters in pattern', () => {
      expect(evaluator.matchesPattern('file[1].ts', 'file[1].ts')).toBe(true);
      expect(evaluator.matchesPattern('file.ts', 'file.ts')).toBe(true);
      expect(evaluator.matchesPattern('file.ts', 'filexts')).toBe(false);
    });
  });

  describe('evaluate', () => {
    it('should evaluate Bash(git *)', () => {
      expect(evaluator.evaluate('Bash(git *)', 'Bash', 'git commit')).toBe(true);
      expect(evaluator.evaluate('Bash(git *)', 'Bash', 'git push')).toBe(true);
      expect(evaluator.evaluate('Bash(git *)', 'Bash', 'npm install')).toBe(false);
      expect(evaluator.evaluate('Bash(git *)', 'Read', 'git commit')).toBe(false);
    });

    it('should evaluate Write(src/*)', () => {
      expect(evaluator.evaluate('Write(src/*)', 'Write', 'src/file.ts')).toBe(true);
      expect(evaluator.evaluate('Write(src/*)', 'Write', 'src/dir/file.ts')).toBe(false);
      expect(evaluator.evaluate('Write(src/*)', 'Edit', 'src/file.ts')).toBe(false);
    });

    it('should evaluate Edit(*.ts)', () => {
      expect(evaluator.evaluate('Edit(*.ts)', 'Edit', 'file.ts')).toBe(true);
      expect(evaluator.evaluate('Edit(*.ts)', 'Edit', 'dir/file.ts')).toBe(false);
      expect(evaluator.evaluate('Edit(*.ts)', 'Edit', 'file.js')).toBe(false);
    });

    it('should evaluate WebFetch(https://)*', () => {
      expect(evaluator.evaluate('WebFetch(https://*)', 'WebFetch', 'https://example.com')).toBe(true);
      expect(evaluator.evaluate('WebFetch(https://*)', 'WebFetch', 'http://example.com')).toBe(false);
    });

    it('should evaluate Read(*)', () => {
      expect(evaluator.evaluate('Read(*)', 'Read', '/any/path')).toBe(true);
      expect(evaluator.evaluate('Read(*)', 'Read')).toBe(true); // No value
    });

    it('should evaluate without pattern', () => {
      expect(evaluator.evaluate('Bash', 'Bash')).toBe(true);
      expect(evaluator.evaluate('Bash', 'Read')).toBe(false);
    });

    it('should evaluate wildcard tool matcher', () => {
      expect(evaluator.evaluate('*(git *)', 'Bash', 'git commit')).toBe(true);
      expect(evaluator.evaluate('*(git *)', 'Read', 'git push')).toBe(true);
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

  describe('edge cases for bash commands', () => {
    it('should handle piped commands', () => {
      const cmd = 'rg | wc -l';
      expect(evaluator.matchesPattern('rg *', cmd)).toBe(true);
    });

    it('should handle heredoc notation', () => {
      const cmd = 'git commit -m "message" <<EOF';
      expect(evaluator.matchesPattern('git *', cmd)).toBe(true);
    });

    it('should handle quoted strings with special chars', () => {
      const cmd = 'bash -c \'echo "URL: https://example.com#anchor"\'';
      expect(evaluator.matchesPattern('bash *', cmd)).toBe(true);
    });

    it('should handle commands with escaped special chars', () => {
      const cmd = 'jq \'select(.x != .y)\'';
      expect(evaluator.matchesPattern('jq *', cmd)).toBe(true);
    });
  });

  describe('LRU cache behavior', () => {
    it('should evict oldest entries when cache exceeds max size', () => {
      const evaluatorWithSmallCache = new ConditionEvaluator();
      // Fill cache with more than default size would allow
      // This is implicitly tested by the cache implementation
      for (let i = 0; i < 150; i++) {
        evaluatorWithSmallCache.matchesPattern(`pattern${i}/*`, `value${i}`);
      }
      // Cache size should not exceed max
      expect(evaluatorWithSmallCache.getCacheSize()).toBeLessThanOrEqual(128);
    });

    it('should reuse cache entries', () => {
      const pattern = 'src/**/*.ts';
      evaluator.matchesPattern(pattern, 'src/file.ts');
      const sizeAfterFirst = evaluator.getCacheSize();

      evaluator.matchesPattern(pattern, 'src/dir/file.ts');
      const sizeAfterSecond = evaluator.getCacheSize();

      expect(sizeAfterFirst).toBe(sizeAfterSecond);
    });
  });
});
