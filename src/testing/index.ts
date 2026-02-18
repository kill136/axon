import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';

import type { TestRunnerInput, TestRunResult } from './types.js';
import { parseVitestOutput } from './parsers/vitest.js';
import { parseJestOutput } from './parsers/jest.js';
import { parsePytestOutput } from './parsers/pytest.js';
import { parseGoTestOutput } from './parsers/go.js';
import { parseCargoTestOutput } from './parsers/cargo.js';

export class TestRunnerManager {
  async detectFramework(cwd: string): Promise<string> {
    // 检测 package.json
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const content = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };
        if (deps['vitest']) return 'vitest';
        if (deps['jest'] || deps['@jest/core']) return 'jest';
      } catch {}
    }

    // 检测 pyproject.toml 或 setup.py 或 pytest.ini
    if (
      existsSync(join(cwd, 'pyproject.toml')) ||
      existsSync(join(cwd, 'setup.py')) ||
      existsSync(join(cwd, 'pytest.ini')) ||
      existsSync(join(cwd, 'setup.cfg'))
    ) {
      return 'pytest';
    }

    // 检测 go.mod
    if (existsSync(join(cwd, 'go.mod'))) {
      return 'go';
    }

    // 检测 Cargo.toml
    if (existsSync(join(cwd, 'Cargo.toml'))) {
      return 'cargo';
    }

    return 'vitest';
  }

  async runTests(input: TestRunnerInput): Promise<TestRunResult> {
    const cwd = input.cwd || process.cwd();
    const timeout = input.timeout ?? 120000;
    const maxLines = input.maxLines ?? 500;

    let framework: TestRunnerInput['framework'] = input.framework || 'auto';
    if (framework === 'auto') {
      framework = await this.detectFramework(cwd) as TestRunnerInput['framework'];
    }

    const { cmd, args } = this.buildCommand(framework!, input);
    const command = [cmd, ...args].join(' ');

    let stdout = '';
    let stderr = '';

    try {
      const output = await this.spawnProcess(cmd, args, cwd, timeout);
      stdout = output.stdout;
      stderr = output.stderr;
    } catch (err: any) {
      // 进程失败（exit code != 0）时仍然解析输出
      stdout = err.stdout || '';
      stderr = err.stderr || '';
    }

    const combined = stdout || stderr;
    const result = this.parseOutput(framework, combined, input);
    result.command = command;

    // 截断 rawOutput
    if (result.rawOutput) {
      const lines = result.rawOutput.split('\n');
      if (lines.length > maxLines) {
        result.rawOutput = lines.slice(0, maxLines).join('\n') + `\n... (输出截断，共 ${lines.length} 行)`;
      }
    }

    // 失败测试置顶
    for (const suite of result.suites) {
      suite.tests.sort((a, b) => {
        const order = { failed: 0, pending: 1, skipped: 2, passed: 3 };
        return (order[a.status] ?? 4) - (order[b.status] ?? 4);
      });
    }
    result.suites.sort((a, b) => b.failed - a.failed);

    return result;
  }

  async listTests(input: TestRunnerInput): Promise<string[]> {
    const cwd = input.cwd || process.cwd();
    const timeout = input.timeout ?? 30000;

    let framework: TestRunnerInput['framework'] = input.framework || 'auto';
    if (framework === 'auto') {
      framework = await this.detectFramework(cwd) as TestRunnerInput['framework'];
    }

    let cmd: string;
    let args: string[];

    switch (framework) {
      case 'vitest':
        cmd = 'npx';
        args = ['vitest', 'list', ...(input.path ? [input.path] : [])];
        break;
      case 'jest':
        cmd = 'npx';
        args = ['jest', '--listTests', ...(input.path ? [input.path] : [])];
        break;
      case 'pytest':
        cmd = 'python';
        args = ['-m', 'pytest', '--collect-only', '-q', ...(input.path ? [input.path] : [])];
        break;
      case 'go':
        cmd = 'go';
        args = ['test', '-list', '.*', input.path || './...'];
        break;
      case 'cargo':
        cmd = 'cargo';
        args = ['test', '--', '--list'];
        break;
      default:
        return [];
    }

    try {
      const output = await this.spawnProcess(cmd, args, cwd, timeout);
      return output.stdout.split('\n').filter((l) => l.trim());
    } catch (err: any) {
      return (err.stdout || '').split('\n').filter((l: string) => l.trim());
    }
  }

  private buildCommand(
    framework: string,
    input: TestRunnerInput
  ): { cmd: string; args: string[] } {
    const extraArgs = input.args || [];

    switch (framework) {
      case 'vitest': {
        const args = ['vitest', 'run', '--reporter=json'];
        if (input.action === 'coverage') args.push('--coverage');
        if (input.path) args.push(input.path);
        if (input.testName) args.push('-t', input.testName);
        args.push(...extraArgs);
        return { cmd: 'npx', args };
      }

      case 'jest': {
        const args = ['jest', '--json'];
        if (input.action === 'coverage') args.push('--coverage');
        if (input.path) args.push(input.path);
        if (input.testName) args.push('-t', input.testName);
        args.push(...extraArgs);
        return { cmd: 'npx', args };
      }

      case 'pytest': {
        const args = ['-m', 'pytest', '--json-report', '--json-report-file=-'];
        if (input.path) args.push(input.path);
        if (input.testName) args.push('-k', input.testName);
        if (input.action === 'coverage') args.push('--cov', '--cov-report=term-missing');
        args.push(...extraArgs);
        return { cmd: 'python', args };
      }

      case 'go': {
        const args = ['test', '-json'];
        if (input.action === 'coverage') args.push('-cover');
        args.push(input.path || './...');
        if (input.testName) args.push('-run', input.testName);
        args.push(...extraArgs);
        return { cmd: 'go', args };
      }

      case 'cargo': {
        const args = ['test'];
        if (input.testName) args.push(input.testName);
        args.push(...extraArgs);
        // cargo test 的 stderr 也有输出，2>&1 通过 shell 处理
        return { cmd: 'cargo', args };
      }

      default:
        return { cmd: 'npx', args: ['vitest', 'run', '--reporter=json'] };
    }
  }

  private parseOutput(framework: string, output: string, _input: TestRunnerInput): TestRunResult {
    switch (framework) {
      case 'vitest':
        return parseVitestOutput(output);
      case 'jest':
        return parseJestOutput(output);
      case 'pytest':
        return parsePytestOutput(output);
      case 'go':
        return parseGoTestOutput(output);
      case 'cargo':
        return parseCargoTestOutput(output);
      default:
        return {
          framework,
          passed: 0,
          failed: 0,
          skipped: 0,
          total: 0,
          suites: [],
          rawOutput: output,
        };
    }
  }

  private spawnProcess(
    cmd: string,
    args: string[],
    cwd: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      // Windows 上 npx/python 等需要通过 shell 执行
      const proc = spawn(cmd, args, {
        cwd,
        shell: isWindows,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        proc.kill();
        reject(Object.assign(new Error(`进程超时（${timeout}ms）`), { stdout, stderr }));
      }, timeout);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          // 非零退出码（测试失败），仍然返回输出供解析
          reject(Object.assign(new Error(`进程退出码 ${code}`), { stdout, stderr }));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(Object.assign(err, { stdout, stderr }));
      });
    });
  }
}
