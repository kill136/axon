import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { TestRunnerInput, TestRunResult, TestCase } from '../testing/types.js';
import { TestRunnerManager } from '../testing/index.js';

export class TestRunnerTool extends BaseTool<TestRunnerInput, ToolResult> {
  name = 'TestRunner';
  description = `Run tests and report results for various test frameworks.

Supports vitest, jest, pytest, go test, and cargo test.

ACTIONS:
  - run: Run all tests (auto-detects framework)
  - run_file: Run tests in a specific file or directory
  - run_test: Run a specific test by name
  - list: List available tests
  - coverage: Run tests with coverage report

FRAMEWORKS:
  - vitest: Uses npx vitest run --reporter=json
  - jest: Uses npx jest --json
  - pytest: Uses python -m pytest --json-report
  - go: Uses go test -json
  - cargo: Uses cargo test
  - auto: Auto-detect from project files (default)

EXAMPLES:
  Run all tests: { action: "run" }
  Run specific file: { action: "run_file", path: "src/auth.test.ts" }
  Run specific test: { action: "run_test", testName: "should login" }
  Coverage report: { action: "coverage", framework: "vitest" }
`;

  private manager = new TestRunnerManager();

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'run_file', 'run_test', 'list', 'coverage'],
          description: 'The action to perform',
        },
        framework: {
          type: 'string',
          enum: ['vitest', 'jest', 'pytest', 'go', 'cargo', 'auto'],
          description: 'Test framework to use (default: auto-detect)',
        },
        path: {
          type: 'string',
          description: 'File path or directory for run_file action',
        },
        testName: {
          type: 'string',
          description: 'Specific test name or pattern for run_test action',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional arguments to pass to the test command',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
        coverageFormat: {
          type: 'string',
          enum: ['summary', 'detailed'],
          description: 'Coverage report format (default: summary)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory to run tests in',
        },
        maxLines: {
          type: 'number',
          description: 'Maximum output lines (default: 500)',
        },
      },
      required: ['action'],
    };
  }

  async execute(input: TestRunnerInput): Promise<ToolResult> {
    try {
      if (input.action === 'list') {
        const tests = await this.manager.listTests(input);
        if (tests.length === 0) {
          return this.success('未找到测试');
        }
        return this.success(`找到 ${tests.length} 个测试:\n${tests.join('\n')}`);
      }

      const result = await this.manager.runTests(input);
      return this.success(this.formatResult(result, input));
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.includes('Cannot find module') ||
        msg.includes('not found') ||
        msg.includes('command not found') ||
        msg.includes('不是内部或外部命令') ||
        msg.includes('ENOENT')
      ) {
        return this.error(
          `测试框架未安装或未找到: ${msg}\n` +
            `请根据框架安装依赖:\n` +
            `  vitest/jest: npm install -D vitest  或  npm install -D jest\n` +
            `  pytest: pip install pytest pytest-json-report\n` +
            `  go test: 确保已安装 Go\n` +
            `  cargo test: 确保已安装 Rust/Cargo`
        );
      }
      return this.error(`运行测试失败: ${msg}`);
    }
  }

  private formatResult(result: TestRunResult, input: TestRunnerInput): string {
    const duration = result.duration != null ? `${Math.round(result.duration)}ms` : '-';
    const lines: string[] = [];

    // 标题行
    lines.push(
      `Framework: ${result.framework} | ` +
        `Passed: ${result.passed} | ` +
        `Failed: ${result.failed} | ` +
        `Skipped: ${result.skipped} | ` +
        `Total: ${result.total} | ` +
        `Duration: ${duration}`
    );

    if (result.command) {
      lines.push(`Command: ${result.command}`);
    }

    lines.push('');

    // 失败测试
    const failedTests: Array<{ suite: string; tc: TestCase }> = [];
    for (const suite of result.suites) {
      for (const tc of suite.tests) {
        if (tc.status === 'failed') {
          failedTests.push({ suite: suite.name, tc });
        }
      }
    }

    if (failedTests.length > 0) {
      lines.push('❌ FAILED TESTS:');
      for (const { suite, tc } of failedTests) {
        const suiteName = suite || tc.file || '';
        lines.push(`  [${suiteName}] ${tc.name}`);
        if (tc.error) {
          if (tc.error.message) {
            const errLines = tc.error.message.split('\n').slice(0, 5);
            for (const el of errLines) {
              lines.push(`    Error: ${el}`);
            }
          }
          if (tc.error.expected) lines.push(`    Expected: ${tc.error.expected}`);
          if (tc.error.actual) lines.push(`    Actual: ${tc.error.actual}`);
          if (tc.error.diff) lines.push(`    Diff:\n${tc.error.diff}`);
        }
      }
      lines.push('');
    }

    // 通过/跳过汇总
    lines.push(`✅ PASSED: ${result.passed}`);
    if (result.skipped > 0) lines.push(`⏭️ SKIPPED: ${result.skipped}`);

    // 覆盖率报告
    if (result.coverage) {
      lines.push('');
      lines.push('Coverage:');
      lines.push(`  Lines:     ${result.coverage.lines.toFixed(1)}%`);
      lines.push(`  Branches:  ${result.coverage.branches.toFixed(1)}%`);
      lines.push(`  Functions: ${result.coverage.functions.toFixed(1)}%`);
      lines.push(`  Statements:${result.coverage.statements.toFixed(1)}%`);

      const fmt = input.coverageFormat ?? 'summary';
      if (fmt === 'detailed' && result.coverage.files.length > 0) {
        lines.push('');
        lines.push('File Coverage:');
        for (const fc of result.coverage.files) {
          lines.push(
            `  ${fc.file}: Lines ${fc.lines.toFixed(1)}% | Branches ${fc.branches.toFixed(1)}% | Functions ${fc.functions.toFixed(1)}%`
          );
        }
      }
    }

    // 原始输出（仅在有问题时追加）
    if (result.failed > 0 && result.rawOutput && failedTests.length === 0) {
      lines.push('');
      lines.push('Raw Output:');
      lines.push(result.rawOutput);
    }

    return lines.join('\n');
  }
}
