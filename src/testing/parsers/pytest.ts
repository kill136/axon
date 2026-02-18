import type { TestRunResult, TestSuite, TestCase } from '../types.js';

export function parsePytestOutput(jsonStr: string): TestRunResult {
  // 尝试解析 pytest-json-report 的 JSON 格式
  let data: any;
  try {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('未找到 JSON');
    data = JSON.parse(match[0]);
    return parsePytestJson(data, jsonStr);
  } catch {
    // fallback：解析 pytest 标准文本输出
    return parsePytestText(jsonStr);
  }
}

function parsePytestJson(data: any, rawOutput: string): TestRunResult {
  const tests: any[] = data.tests || [];
  const suiteMap = new Map<string, TestCase[]>();

  for (const t of tests) {
    const nodeid: string = t.nodeid || '';
    // nodeid 格式: path/to/test_file.py::TestClass::test_method
    const parts = nodeid.split('::');
    const file = parts[0] || '';
    const name = parts.slice(1).join('::') || nodeid;

    const status = mapPytestStatus(t.outcome || t.status);
    const testCase: TestCase = {
      name,
      status,
      duration: t.call?.duration != null ? t.call.duration * 1000 : undefined,
      file,
    };

    if (t.call?.longrepr || t.longrepr) {
      testCase.error = {
        message: String(t.call?.longrepr || t.longrepr),
      };
    }

    if (!suiteMap.has(file)) suiteMap.set(file, []);
    suiteMap.get(file)!.push(testCase);
  }

  const suites: TestSuite[] = [];
  for (const [file, testCases] of suiteMap) {
    suites.push({
      name: file,
      file,
      tests: testCases,
      passed: testCases.filter((t) => t.status === 'passed').length,
      failed: testCases.filter((t) => t.status === 'failed').length,
      skipped: testCases.filter((t) => t.status === 'skipped' || t.status === 'pending').length,
    });
  }

  const summary = data.summary || {};
  const passed = summary.passed ?? suites.reduce((a, s) => a + s.passed, 0);
  const failed = (summary.failed ?? 0) + (summary.error ?? 0);
  const skipped = (summary.skipped ?? 0) + (summary.xfailed ?? 0) + (summary.xpassed ?? 0);

  return {
    framework: 'pytest',
    passed,
    failed,
    skipped,
    total: summary.total ?? passed + failed + skipped,
    duration: data.duration != null ? data.duration * 1000 : undefined,
    suites,
    rawOutput,
  };
}

function parsePytestText(output: string): TestRunResult {
  // 解析类似：PASSED test_foo.py::test_bar
  // 或：test_foo.py::test_bar PASSED
  const suiteMap = new Map<string, TestCase[]>();
  const lines = output.split('\n');

  for (const line of lines) {
    const m =
      line.match(/^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(.+)/) ||
      line.match(/^(.+?)\s+(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)/);
    if (!m) continue;

    let status: string, nodeid: string;
    if (/^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)/.test(line)) {
      status = m[1];
      nodeid = m[2];
    } else {
      nodeid = m[1];
      status = m[2];
    }

    const parts = nodeid.trim().split('::');
    const file = parts[0] || '';
    const name = parts.slice(1).join('::') || nodeid;

    const testCase: TestCase = {
      name,
      status: mapPytestStatus(status.toLowerCase()),
      file,
    };

    if (!suiteMap.has(file)) suiteMap.set(file, []);
    suiteMap.get(file)!.push(testCase);
  }

  // 解析汇总行：5 passed, 2 failed, 1 skipped
  let passed = 0, failed = 0, skipped = 0;
  const summaryMatch = output.match(/(\d+)\s+passed/);
  const failedMatch = output.match(/(\d+)\s+failed/);
  const skippedMatch = output.match(/(\d+)\s+skipped/);
  if (summaryMatch) passed = parseInt(summaryMatch[1], 10);
  if (failedMatch) failed = parseInt(failedMatch[1], 10);
  if (skippedMatch) skipped = parseInt(skippedMatch[1], 10);

  const suites: TestSuite[] = [];
  for (const [file, tests] of suiteMap) {
    suites.push({
      name: file,
      file,
      tests,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      skipped: tests.filter((t) => t.status === 'skipped' || t.status === 'pending').length,
    });
  }

  // 如果文本解析到了测试但汇总没解析到，从 suites 累加
  if (!summaryMatch) {
    passed = suites.reduce((a, s) => a + s.passed, 0);
    failed = suites.reduce((a, s) => a + s.failed, 0);
    skipped = suites.reduce((a, s) => a + s.skipped, 0);
  }

  return {
    framework: 'pytest',
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    suites,
    rawOutput: output,
  };
}

function mapPytestStatus(status: string): TestCase['status'] {
  switch (status?.toLowerCase()) {
    case 'passed':
    case 'pass':
      return 'passed';
    case 'failed':
    case 'fail':
    case 'error':
      return 'failed';
    case 'skipped':
    case 'skip':
    case 'xfail':
    case 'xpass':
      return 'skipped';
    default:
      return 'pending';
  }
}
