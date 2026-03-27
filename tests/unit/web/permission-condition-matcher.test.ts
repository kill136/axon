/**
 * 权限条件匹配器测试
 * 测试 parseConditionRule / matchesCondition / matchesAnyCondition
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseConditionRule,
  matchesCondition,
  matchesAnyCondition,
  clearConditionMatcherCache,
} from '../../../src/web/server/permission-condition-matcher.js';

describe('Permission Condition Matcher', () => {
  beforeEach(() => {
    clearConditionMatcherCache();
  });

  describe('parseConditionRule', () => {
    it('解析 Bash(git *) → { toolName: "Bash", pattern: "git *" }', () => {
      const result = parseConditionRule('Bash(git *)');
      expect(result).toEqual({ toolName: 'Bash', pattern: 'git *' });
    });

    it('解析 Write(src/*.ts) → { toolName: "Write", pattern: "src/*.ts" }', () => {
      const result = parseConditionRule('Write(src/*.ts)');
      expect(result).toEqual({ toolName: 'Write', pattern: 'src/*.ts' });
    });

    it('解析 * → null（无条件通配）', () => {
      const result = parseConditionRule('*');
      expect(result).toBeNull();
    });

    it('解析纯工具名 Bash → { toolName: "Bash", pattern: null }', () => {
      const result = parseConditionRule('Bash');
      expect(result).toEqual({ toolName: 'Bash', pattern: null });
    });

    it('解析 Edit(*.json) → { toolName: "Edit", pattern: "*.json" }', () => {
      const result = parseConditionRule('Edit(*.json)');
      expect(result).toEqual({ toolName: 'Edit', pattern: '*.json' });
    });

    it('无效格式返回 null', () => {
      const result = parseConditionRule('invalid[');
      expect(result).toBeNull();
    });

    it('处理空格', () => {
      const result = parseConditionRule('  Bash(git *)  ');
      expect(result).toEqual({ toolName: 'Bash', pattern: 'git *' });
    });
  });

  describe('matchesCondition', () => {
    it('Bash(git *) 匹配 Bash 工具 + git push 命令', () => {
      const rule = parseConditionRule('Bash(git *)')!;
      expect(matchesCondition(rule, 'Bash', { command: 'git push' })).toBe(true);
    });

    it('Bash(git *) 不匹配 Bash 工具 + npm test 命令', () => {
      const rule = parseConditionRule('Bash(git *)')!;
      expect(matchesCondition(rule, 'Bash', { command: 'npm test' })).toBe(false);
    });

    it('Write(*.ts) 匹配 Write 工具 + file.ts', () => {
      const rule = parseConditionRule('Write(*.ts)')!;
      expect(matchesCondition(rule, 'Write', { file_path: 'file.ts' })).toBe(true);
    });

    it('Write(*.ts) 不匹配 Write 工具 + file.js', () => {
      const rule = parseConditionRule('Write(*.ts)')!;
      expect(matchesCondition(rule, 'Write', { file_path: 'file.js' })).toBe(false);
    });

    it('工具名称不匹配时返回 false', () => {
      const rule = parseConditionRule('Bash(git *)')!;
      expect(matchesCondition(rule, 'Write', { command: 'git push' })).toBe(false);
    });

    it('pattern 为 null 匹配该工具的所有调用', () => {
      const rule = parseConditionRule('Bash')!;
      expect(rule.pattern).toBeNull();
      expect(matchesCondition(rule, 'Bash', { command: 'anything' })).toBe(true);
    });

    it('Edit(*.json) 匹配 Edit 工具 + config.json', () => {
      const rule = parseConditionRule('Edit(*.json)')!;
      expect(matchesCondition(rule, 'Edit', { file_path: 'config.json' })).toBe(true);
    });

    it('Edit(*.json) 不匹配 Edit 工具 + config.yaml', () => {
      const rule = parseConditionRule('Edit(*.json)')!;
      expect(matchesCondition(rule, 'Edit', { file_path: 'config.yaml' })).toBe(false);
    });

    it('Write(src/**) 匹配深层路径', () => {
      const rule = parseConditionRule('Write(src/**)')!;
      expect(matchesCondition(rule, 'Write', { file_path: 'src/deep/nested/file.ts' })).toBe(true);
    });
  });

  describe('matchesAnyCondition', () => {
    it('规则列表中有匹配项时返回 true', () => {
      const rules = ['Bash(git *)', 'Write(src/*.ts)'];
      expect(matchesAnyCondition(rules, 'Bash', { command: 'git push' })).toBe(true);
    });

    it('规则列表中无匹配项时返回 false', () => {
      const rules = ['Bash(git *)', 'Write(src/*.ts)'];
      expect(matchesAnyCondition(rules, 'Bash', { command: 'npm test' })).toBe(false);
    });

    it('通配符 * 匹配一切', () => {
      const rules = ['*'];
      expect(matchesAnyCondition(rules, 'Bash', { command: 'anything' })).toBe(true);
      expect(matchesAnyCondition(rules, 'Write', { file_path: 'any.ts' })).toBe(true);
    });

    it('空规则列表返回 false', () => {
      expect(matchesAnyCondition([], 'Bash', { command: 'git push' })).toBe(false);
    });

    it('多个规则只需匹配一个', () => {
      const rules = ['Bash(npm *)', 'Write(*.ts)', 'Edit(*.json)'];
      expect(matchesAnyCondition(rules, 'Edit', { file_path: 'package.json' })).toBe(true);
    });

    it('无效规则被跳过', () => {
      const rules = ['invalid[', 'Bash(git *)'];
      expect(matchesAnyCondition(rules, 'Bash', { command: 'git push' })).toBe(true);
    });
  });
});
