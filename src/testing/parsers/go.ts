import type { TestRunResult, TestSuite, TestCase } from '../types.js';

export function parseGoTestOutput(jsonLines: string): TestRunResult {
  // go test -json 每行是独立 JSON
  const lines = jsonLines.split('\n').filter((l) => l.trim());

  // pkg -> test -> TestCase
  const pkgMap = new Map<string, Map<string, TestCase>>();
  const pkgOutput = new Map<string, string[]>();
  const pkgDuration = new Map<string, number>();

  for (const line of lines) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const pkg: string = event.Package || '';
    const test: string = event.Test || '';
    const action: string = event.Action || '';

    if (!pkgMap.has(pkg)) pkgMap.set(pkg, new Map());
    if (!pkgOutput.has(pkg)) pkgOutput.set(pkg, []);

    const tests = pkgMap.get(pkg)!;
    const outputs = pkgOutput.get(pkg)!;

    switch (action) {
      case 'run':
        if (test) {
          tests.set(test, { name: test, status: 'pending', file: pkg });
        }
        break;

      case 'pass':
        if (test) {
          const tc = tests.get(test) || { name: test, status: 'pending', file: pkg };
          tc.status = 'passed';
          if (event.Elapsed != null) tc.duration = event.Elapsed * 1000;
          tests.set(test, tc);
        } else {
          // 包级别 pass
          if (event.Elapsed != null) pkgDuration.set(pkg, event.Elapsed * 1000);
        }
        break;

      case 'fail':
        if (test) {
          const tc = tests.get(test) || { name: test, status: 'pending', file: pkg };
          tc.status = 'failed';
          if (event.Elapsed != null) tc.duration = event.Elapsed * 1000;
          // 收集输出作为错误信息
          const errLines = outputs.filter((o) => o.includes(test) || !o.includes('--- PASS'));
          if (errLines.length > 0) {
            tc.error = { message: errLines.join('') };
          }
          tests.set(test, tc);
        } else {
          if (event.Elapsed != null) pkgDuration.set(pkg, event.Elapsed * 1000);
        }
        break;

      case 'skip':
        if (test) {
          const tc = tests.get(test) || { name: test, status: 'pending', file: pkg };
          tc.status = 'skipped';
          tests.set(test, tc);
        }
        break;

      case 'output':
        if (event.Output) outputs.push(event.Output);
        break;
    }
  }

  const suites: TestSuite[] = [];

  for (const [pkg, tests] of pkgMap) {
    const testCases = Array.from(tests.values());
    // 过滤掉子测试（包含 / 的是子测试）
    const topLevel = testCases.filter((t) => !t.name.includes('/'));

    suites.push({
      name: pkg,
      tests: topLevel,
      passed: topLevel.filter((t) => t.status === 'passed').length,
      failed: topLevel.filter((t) => t.status === 'failed').length,
      skipped: topLevel.filter((t) => t.status === 'skipped').length,
      duration: pkgDuration.get(pkg),
    });
  }

  const passed = suites.reduce((a, s) => a + s.passed, 0);
  const failed = suites.reduce((a, s) => a + s.failed, 0);
  const skipped = suites.reduce((a, s) => a + s.skipped, 0);

  return {
    framework: 'go',
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    suites,
    rawOutput: jsonLines,
  };
}
