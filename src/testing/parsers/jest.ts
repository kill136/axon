import type { TestRunResult, TestSuite, TestCase } from '../types.js';

export function parseJestOutput(jsonStr: string): TestRunResult {
  let data: any;
  try {
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('未找到 JSON');
    data = JSON.parse(match[0]);
  } catch {
    return {
      framework: 'jest',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      suites: [],
      rawOutput: jsonStr,
    };
  }

  const suites: TestSuite[] = [];
  let totalPassed = data.numPassedTests ?? 0;
  let totalFailed = data.numFailedTests ?? 0;
  let totalSkipped = data.numPendingTests ?? 0;
  const totalDuration = data.testResults
    ? data.testResults.reduce(
        (acc: number, r: any) =>
          acc + ((r.endTime ?? 0) - (r.startTime ?? 0)),
        0
      )
    : undefined;

  const testResults: any[] = data.testResults || [];

  for (const fileResult of testResults) {
    const tests: TestCase[] = [];
    const assertionResults: any[] = fileResult.testResults || fileResult.assertionResults || [];

    for (const assertion of assertionResults) {
      const status = mapJestStatus(assertion.status);
      const testCase: TestCase = {
        name: assertion.fullName || assertion.title || '',
        status,
        duration: assertion.duration,
        file: fileResult.testFilePath,
      };

      if (assertion.failureMessages?.length > 0) {
        testCase.error = {
          message: assertion.failureMessages.join('\n'),
        };
      }

      tests.push(testCase);
    }

    const suiteDuration =
      fileResult.endTime != null && fileResult.startTime != null
        ? fileResult.endTime - fileResult.startTime
        : undefined;

    suites.push({
      name: fileResult.testFilePath || '',
      file: fileResult.testFilePath,
      tests,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      skipped: tests.filter((t) => t.status === 'skipped' || t.status === 'pending').length,
      duration: suiteDuration,
    });
  }

  // 如果 data 顶层没有统计，从 suites 累加
  if (!data.numPassedTests) {
    totalPassed = suites.reduce((a, s) => a + s.passed, 0);
    totalFailed = suites.reduce((a, s) => a + s.failed, 0);
    totalSkipped = suites.reduce((a, s) => a + s.skipped, 0);
  }

  return {
    framework: 'jest',
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
    total: (data.numTotalTests ?? totalPassed + totalFailed + totalSkipped),
    duration: totalDuration,
    suites,
    rawOutput: jsonStr,
  };
}

function mapJestStatus(status: string): TestCase['status'] {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'pending':
    case 'todo':
      return 'pending';
    case 'skipped':
      return 'skipped';
    default:
      return 'pending';
  }
}
