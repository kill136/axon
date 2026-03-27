/**
 * Hook 条件解析器单元测试
 */

import * as assert from 'assert';
import {
  parseConditionRule,
  matchesCondition,
  clearConditionCache,
  getConditionCacheSize,
  type ConditionRule,
  type HookContext,
} from './condition-parser.js';

/**
 * 测试条件规则解析
 */
export async function testParseConditionRule(): Promise<void> {
  clearConditionCache();

  // 解析有效的规则
  const rule1 = parseConditionRule('Bash(git *)');
  assert.strictEqual(rule1?.toolName, 'Bash');
  assert.strictEqual(rule1?.pattern, 'git *');

  const rule2 = parseConditionRule('Write(src/*)');
  assert.strictEqual(rule2?.toolName, 'Write');
  assert.strictEqual(rule2?.pattern, 'src/*');

  // 无条件规则
  const rule3 = parseConditionRule('*');
  assert.strictEqual(rule3, null);

  // 缓存检查
  assert.strictEqual(getConditionCacheSize(), 3);

  console.log('✓ parseConditionRule test passed');
}

/**
 * 测试条件缓存
 */
export async function testConditionCaching(): Promise<void> {
  clearConditionCache();

  parseConditionRule('Edit(*.ts)');
  assert.strictEqual(getConditionCacheSize(), 1);

  // 再次解析相同规则，应该从缓存返回
  parseConditionRule('Edit(*.ts)');
  assert.strictEqual(getConditionCacheSize(), 1);

  console.log('✓ Condition caching test passed');
}

/**
 * 测试 Bash 命令匹配
 */
export async function testBashCommandMatching(): Promise<void> {
  clearConditionCache();

  const condition = parseConditionRule('Bash(git *)') as ConditionRule;

  // 匹配 git 命令
  let context: HookContext = {
    toolName: 'Bash',
    toolInput: { command: 'git clone https://example.com/repo' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  // 不匹配其他命令
  context = {
    toolName: 'Bash',
    toolInput: { command: 'npm install' },
  };
  assert.strictEqual(matchesCondition(condition, context), false);

  // 错误的工具名
  context = {
    toolName: 'Write',
    toolInput: { command: 'git clone https://example.com/repo' },
  };
  assert.strictEqual(matchesCondition(condition, context), false);

  console.log('✓ Bash command matching test passed');
}

/**
 * 测试文件路径匹配
 */
export async function testFilePathMatching(): Promise<void> {
  clearConditionCache();

  const condition = parseConditionRule('Write(src/*)') as ConditionRule;

  // 匹配 src 目录的文件
  let context: HookContext = {
    toolName: 'Write',
    toolInput: { filePath: 'src/index.ts' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  context = {
    toolName: 'Write',
    toolInput: { file_path: 'src/components/Button.tsx' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  // 不匹配其他目录的文件
  context = {
    toolName: 'Write',
    toolInput: { filePath: 'test/index.test.ts' },
  };
  assert.strictEqual(matchesCondition(condition, context), false);

  console.log('✓ File path matching test passed');
}

/**
 * 测试 glob 模式的多种形式
 */
export async function testGlobPatterns(): Promise<void> {
  clearConditionCache();

  // 测试通配符 *
  let condition = parseConditionRule('Edit(*.ts)') as ConditionRule;
  let context: HookContext = {
    toolName: 'Edit',
    toolInput: { filePath: 'index.ts' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  context = {
    toolName: 'Edit',
    toolInput: { filePath: 'config.js' },
  };
  assert.strictEqual(matchesCondition(condition, context), false);

  // 测试多级路径
  condition = parseConditionRule('Write(src/**/*.tsx)') as ConditionRule;
  context = {
    toolName: 'Write',
    toolInput: { filePath: 'src/components/Button.tsx' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  // 测试字符类
  condition = parseConditionRule('Bash(test[0-9]*)') as ConditionRule;
  context = {
    toolName: 'Bash',
    toolInput: { command: 'test123' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  console.log('✓ Glob patterns test passed');
}

/**
 * 测试无条件执行
 */
export async function testUnconditionalExecution(): Promise<void> {
  clearConditionCache();

  const context: HookContext = {
    toolName: 'AnyTool',
    toolInput: { any: 'data' },
  };

  // 无条件规则应该总是匹配
  assert.strictEqual(matchesCondition(null, context), true);
  assert.strictEqual(matchesCondition(undefined, context), true);

  console.log('✓ Unconditional execution test passed');
}

/**
 * 测试工具名称不匹配
 */
export async function testToolNameMismatch(): Promise<void> {
  clearConditionCache();

  const condition = parseConditionRule('Bash(ls *)') as ConditionRule;

  const context: HookContext = {
    toolName: 'Read',
    toolInput: { filePath: 'ls /tmp' },
  };

  assert.strictEqual(matchesCondition(condition, context), false);

  console.log('✓ Tool name mismatch test passed');
}

/**
 * 测试无效的条件规则格式
 */
export async function testInvalidRuleFormat(): Promise<void> {
  clearConditionCache();

  // 无效的格式应该返回 null（作为无条件）
  const rule = parseConditionRule('invalid format');
  assert.strictEqual(rule, null);

  console.log('✓ Invalid rule format test passed');
}

/**
 * 测试条件规则中的特殊文件名
 */
export async function testSpecialFileNames(): Promise<void> {
  clearConditionCache();

  const condition = parseConditionRule('Write(config.*.json)') as ConditionRule;

  let context: HookContext = {
    toolName: 'Write',
    toolInput: { filePath: 'config.dev.json' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  context = {
    toolName: 'Write',
    toolInput: { filePath: 'config.prod.json' },
  };
  assert.strictEqual(matchesCondition(condition, context), true);

  context = {
    toolName: 'Write',
    toolInput: { filePath: 'data.json' },
  };
  assert.strictEqual(matchesCondition(condition, context), false);

  console.log('✓ Special file names test passed');
}
