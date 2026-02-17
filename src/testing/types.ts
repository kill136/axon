export interface TestRunnerInput {
  action: 'run' | 'run_file' | 'run_test' | 'list' | 'coverage';
  framework?: 'vitest' | 'jest' | 'pytest' | 'go' | 'cargo' | 'auto';
  path?: string;
  testName?: string;
  args?: string[];
  timeout?: number;
  coverageFormat?: 'summary' | 'detailed';
  cwd?: string;
  maxLines?: number;
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration?: number;
  error?: {
    message: string;
    stack?: string;
    expected?: string;
    actual?: string;
    diff?: string;
  };
  file?: string;
  line?: number;
}

export interface TestSuite {
  name: string;
  file?: string;
  tests: TestCase[];
  passed: number;
  failed: number;
  skipped: number;
  duration?: number;
}

export interface FileCoverage {
  file: string;
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

export interface CoverageReport {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  files: FileCoverage[];
}

export interface TestRunResult {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration?: number;
  suites: TestSuite[];
  coverage?: CoverageReport;
  rawOutput?: string;
  command?: string;
}
