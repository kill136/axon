import type { TestRunResult, TestSuite, TestCase } from '../types.js';

export function parseCargoTestOutput(output: string): TestRunResult {
  // cargo test 输出格式：
  // test path::to::test_name ... ok
  // test path::to::test_name ... FAILED
  // test path::to::test_name ... ignored
  const lines = output.split('\n');

  // 按测试二进制分组（running X tests 行之间）
  const suites: TestSuite[] = [];
  let currentSuiteName = '';
  let currentTests: TestCase[] = [];
  let failureOutput: string[] = [];
  let inFailures = false;

  for (const line of lines) {
    // 新的测试套件开始
    const runningMatch = line.match(/^running\s+\d+\s+tests?\s*(?:in\s+(.+))?/);
    if (runningMatch) {
      if (currentTests.length > 0) {
        suites.push(buildSuite(currentSuiteName, currentTests));
        currentTests = [];
      }
      currentSuiteName = runningMatch[1]?.trim() || '';
      inFailures = false;
      failureOutput = [];
      continue;
    }

    // 测试结果行
    const testMatch = line.match(/^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored|bench)/);
    if (testMatch) {
      const name = testMatch[1].trim();
      const resultStr = testMatch[2];
      const status = mapCargoStatus(resultStr);
      currentTests.push({ name, status, file: currentSuiteName });
      continue;
    }

    // failures: 块
    if (/^failures:/.test(line)) {
      inFailures = true;
      continue;
    }

    // 收集失败输出
    if (inFailures) {
      failureOutput.push(line);
    }
  }

  // 最后一个 suite
  if (currentTests.length > 0) {
    suites.push(buildSuite(currentSuiteName, currentTests));
  }

  // 如果没解析到 suite，尝试从整体输出构建
  if (suites.length === 0) {
    const allTests: TestCase[] = [];
    for (const line of lines) {
      const m = line.match(/^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)/);
      if (m) {
        allTests.push({ name: m[1].trim(), status: mapCargoStatus(m[2]) });
      }
    }
    if (allTests.length > 0) {
      suites.push(buildSuite('', allTests));
    }
  }

  // 解析汇总行：test result: ok. 5 passed; 2 failed; 0 ignored
  let passed = 0, failed = 0, skipped = 0;
  const summaryMatch = output.match(/test result:.+?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/);
  if (summaryMatch) {
    passed = parseInt(summaryMatch[1], 10);
    failed = parseInt(summaryMatch[2], 10);
    skipped = parseInt(summaryMatch[3], 10);
  } else {
    passed = suites.reduce((a, s) => a + s.passed, 0);
    failed = suites.reduce((a, s) => a + s.failed, 0);
    skipped = suites.reduce((a, s) => a + s.skipped, 0);
  }

  // 将失败信息附加到对应测试
  if (failureOutput.length > 0) {
    attachFailureInfo(suites, failureOutput);
  }

  return {
    framework: 'cargo',
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    suites,
    rawOutput: output,
  };
}

function buildSuite(name: string, tests: TestCase[]): TestSuite {
  return {
    name,
    tests,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
  };
}

function mapCargoStatus(result: string): TestCase['status'] {
  switch (result) {
    case 'ok':
      return 'passed';
    case 'FAILED':
      return 'failed';
    case 'ignored':
      return 'skipped';
    default:
      return 'pending';
  }
}

function attachFailureInfo(suites: TestSuite[], failureOutput: string[]): void {
  // failures: 块格式：
  // ---- test_name stdout ----
  // thread 'test_name' panicked at ...
  let currentTest = '';
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentTest) return;
    for (const suite of suites) {
      const tc = suite.tests.find((t) => t.name === currentTest || currentTest.includes(t.name));
      if (tc && tc.status === 'failed') {
        tc.error = { message: currentLines.join('\n').trim() };
        break;
      }
    }
    currentLines = [];
  };

  for (const line of failureOutput) {
    const headerMatch = line.match(/^----\s+(.+?)\s+stdout\s+----/);
    if (headerMatch) {
      flush();
      currentTest = headerMatch[1].trim();
    } else if (currentTest) {
      currentLines.push(line);
    }
  }
  flush();
}
