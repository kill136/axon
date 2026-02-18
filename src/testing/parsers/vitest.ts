import type { TestRunResult, TestSuite, TestCase } from '../types.js';

export function parseVitestOutput(jsonStr: string): TestRunResult {
  let data: any;
  try {
    // vitest 可能输出多行，JSON 在最后一个大括号结束的块
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('未找到 JSON');
    data = JSON.parse(match[0]);
  } catch {
    return {
      framework: 'vitest',
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      suites: [],
      rawOutput: jsonStr,
    };
  }

  const suites: TestSuite[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalDuration = 0;

  const testResults: any[] = data.testResults || data.files || [];

  for (const fileResult of testResults) {
    const tests: TestCase[] = [];
    const assertionResults: any[] = fileResult.assertionResults || fileResult.tests || [];

    for (const assertion of assertionResults) {
      const status = mapVitestStatus(assertion.status);
      const testCase: TestCase = {
        name: assertion.fullName || assertion.title || assertion.name || '',
        status,
        duration: assertion.duration,
        file: fileResult.testFilePath || fileResult.name,
      };

      if (assertion.failureMessages?.length > 0 || assertion.errors?.length > 0) {
        const msg = (assertion.failureMessages || assertion.errors || []).join('\n');
        testCase.error = {
          message: msg,
          stack: assertion.stack,
        };
      }

      if (status === 'passed') totalPassed++;
      else if (status === 'failed') totalFailed++;
      else if (status === 'skipped' || status === 'pending') totalSkipped++;

      tests.push(testCase);
    }

    const suiteDuration =
      fileResult.endTime != null && fileResult.startTime != null
        ? fileResult.endTime - fileResult.startTime
        : fileResult.duration;

    if (suiteDuration) totalDuration += suiteDuration;

    suites.push({
      name: fileResult.testFilePath || fileResult.name || '',
      file: fileResult.testFilePath || fileResult.name,
      tests,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      skipped: tests.filter((t) => t.status === 'skipped' || t.status === 'pending').length,
      duration: suiteDuration,
    });
  }

  return {
    framework: 'vitest',
    passed: totalPassed,
    failed: totalFailed,
    skipped: totalSkipped,
    total: totalPassed + totalFailed + totalSkipped,
    duration: totalDuration || data.testDuration,
    suites,
    rawOutput: jsonStr,
  };
}

function mapVitestStatus(status: string): TestCase['status'] {
  switch (status) {
    case 'passed':
    case 'pass':
      return 'passed';
    case 'failed':
    case 'fail':
      return 'failed';
    case 'skipped':
    case 'skip':
      return 'skipped';
    case 'pending':
    case 'todo':
      return 'pending';
    default:
      return 'pending';
  }
}
