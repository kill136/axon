/**
 * VerificationService - 验收测试服务
 *
 * 统一管理两种验收测试方式：
 * 1. 传统测试 - 运行 npm test / pytest 等单元/集成测试
 * 2. E2E 浏览器测试 - 启动应用，使用浏览器进行端到端验收
 *
 * 用户可以选择测试方式，或者同时运行两种测试
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { E2ETestAgent, E2ETestResult, E2ETestConfig, E2ETestContext, createE2ETestAgent } from './e2e-test-agent.js';
import { McpToolCaller, McpToolResult } from './browser-test-tools.js';
import type { Blueprint, TechStack, DesignImage } from './types.js';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 验收测试类型
 */
export type VerificationType = 'unit' | 'e2e' | 'both';

/**
 * 验收测试配置
 */
export interface VerificationConfig {
  /** 测试类型 */
  type: VerificationType;
  /** E2E 测试配置 */
  e2eConfig?: E2ETestConfig;
  /** 单元测试超时（毫秒） */
  unitTestTimeout?: number;
  /** 是否自动修复 */
  autoFix?: boolean;
  /** 最大修复轮数 */
  maxFixAttempts?: number;
}

/**
 * 单元测试结果
 */
export interface UnitTestResult {
  success: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  testOutput: string;
  failures: Array<{
    name: string;
    error: string;
  }>;
  duration: number;
}

/**
 * 综合验收结果
 */
export interface VerificationResult {
  /** 整体是否通过 */
  success: boolean;
  /** 验收类型 */
  type: VerificationType;
  /** 单元测试结果（如果执行） */
  unitTest?: UnitTestResult;
  /** E2E 测试结果（如果执行） */
  e2eTest?: E2ETestResult;
  /** 设计图对比总结 */
  designComparison?: {
    total: number;
    passed: number;
    failed: number;
    avgSimilarity: number;
  };
  /** 修复尝试 */
  fixAttempts: Array<{
    round: number;
    type: 'unit' | 'e2e';
    description: string;
    success: boolean;
  }>;
  /** 总耗时 */
  totalDuration: number;
  /** 最终总结 */
  summary: string;
}

/**
 * 验收测试状态
 */
export type VerificationStatus =
  | 'idle'
  | 'checking_env'
  | 'running_unit_tests'
  | 'running_e2e_tests'
  | 'comparing_designs'
  | 'fixing'
  | 'passed'
  | 'failed';

// ============================================================================
// VerificationService 实现
// ============================================================================

export class VerificationService extends EventEmitter {
  private config: VerificationConfig;
  private status: VerificationStatus = 'idle';
  private e2eAgent: E2ETestAgent | null = null;

  constructor(config: VerificationConfig = { type: 'both' }) {
    super();
    this.config = {
      unitTestTimeout: 120000,
      autoFix: true,
      maxFixAttempts: 3,
      ...config,
    };
  }

  /**
   * 获取当前状态
   */
  getStatus(): VerificationStatus {
    return this.status;
  }

  /**
   * 执行验收测试
   */
  async verify(
    blueprint: Blueprint,
    mcpToolCaller?: McpToolCaller
  ): Promise<VerificationResult> {
    const startTime = Date.now();
    const fixAttempts: VerificationResult['fixAttempts'] = [];

    let unitTestResult: UnitTestResult | undefined;
    let e2eTestResult: E2ETestResult | undefined;

    this.log('========== 开始验收测试 ==========');
    this.log(`蓝图: ${blueprint.name}`);
    this.log(`测试类型: ${this.config.type}`);
    this.log(`设计图数量: ${blueprint.designImages?.length || 0}`);

    try {
      // 1. 检查环境
      this.updateStatus('checking_env');
      await this.checkEnvironment(blueprint);

      // 2. 运行单元测试（如果配置了）
      if (this.config.type === 'unit' || this.config.type === 'both') {
        this.updateStatus('running_unit_tests');
        unitTestResult = await this.runUnitTests(blueprint);

        // 单元测试失败时尝试修复
        if (!unitTestResult.success && this.config.autoFix) {
          const fixResult = await this.attemptUnitTestFix(blueprint, unitTestResult, fixAttempts.length);
          fixAttempts.push({
            round: fixAttempts.length + 1,
            type: 'unit',
            description: fixResult.description,
            success: fixResult.success,
          });

          if (fixResult.success) {
            // 重新运行测试
            unitTestResult = await this.runUnitTests(blueprint);
          }
        }
      }

      // 3. 运行 E2E 测试（如果配置了且提供了 MCP 工具调用器）
      if ((this.config.type === 'e2e' || this.config.type === 'both') && mcpToolCaller) {
        this.updateStatus('running_e2e_tests');

        this.e2eAgent = createE2ETestAgent(this.config.e2eConfig);

        // 监听 E2E 测试事件
        this.e2eAgent.on('log', (msg) => this.log(`[E2E] ${msg}`));
        this.e2eAgent.on('step:start', (data) => this.emit('e2e:step:start', data));
        this.e2eAgent.on('step:complete', (data) => this.emit('e2e:step:complete', data));

        const context: E2ETestContext = {
          blueprint,
          projectPath: blueprint.projectPath,
          techStack: blueprint.techStack || { language: 'typescript', packageManager: 'npm' },
          designImages: blueprint.designImages || [],
          appUrl: 'http://localhost:3000',
        };

        e2eTestResult = await this.e2eAgent.execute(context);
      }

      // 4. 汇总设计图对比结果
      let designComparison: VerificationResult['designComparison'];
      if (e2eTestResult) {
        const comparisons = e2eTestResult.steps.filter(s => s.designComparison);
        if (comparisons.length > 0) {
          const totalSimilarity = comparisons.reduce(
            (sum, s) => sum + (s.designComparison?.similarityScore || 0),
            0
          );
          designComparison = {
            total: comparisons.length,
            passed: e2eTestResult.designComparisonsPassed,
            failed: e2eTestResult.designComparisonsFailed,
            avgSimilarity: Math.round(totalSimilarity / comparisons.length),
          };
        }
      }

      // 5. 判断整体结果
      const unitPassed = !unitTestResult || unitTestResult.success;
      const e2ePassed = !e2eTestResult || e2eTestResult.success;
      const success = unitPassed && e2ePassed;

      this.updateStatus(success ? 'passed' : 'failed');

      // 6. 生成总结
      const summary = this.generateSummary(unitTestResult, e2eTestResult, designComparison);

      this.log('\n========== 验收测试完成 ==========');
      this.log(summary);

      return {
        success,
        type: this.config.type,
        unitTest: unitTestResult,
        e2eTest: e2eTestResult,
        designComparison,
        fixAttempts,
        totalDuration: Date.now() - startTime,
        summary,
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`验收测试失败: ${message}`);
      this.updateStatus('failed');

      return {
        success: false,
        type: this.config.type,
        unitTest: unitTestResult,
        e2eTest: e2eTestResult,
        fixAttempts,
        totalDuration: Date.now() - startTime,
        summary: `验收测试执行失败: ${message}`,
      };
    }
  }

  /**
   * 检查测试环境
   */
  private async checkEnvironment(blueprint: Blueprint): Promise<void> {
    this.log('检查测试环境...');

    // 检查项目路径
    const fs = await import('fs');
    if (!fs.existsSync(blueprint.projectPath)) {
      throw new Error(`Project path does not exist: ${blueprint.projectPath}`);
    }

    // 检查 package.json 或其他配置
    const packageJsonPath = path.join(blueprint.projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      this.log('找到 package.json');
    }

    this.log('环境检查完成');
  }

  /**
   * 运行单元测试
   */
  private async runUnitTests(blueprint: Blueprint): Promise<UnitTestResult> {
    this.log('运行单元测试...');

    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const startTime = Date.now();

      // 确定测试命令
      let testCommand = 'npm';
      let testArgs = ['test'];

      if (blueprint.techStack?.language === 'python') {
        testCommand = 'pytest';
        testArgs = ['-v'];
      }

      const proc = spawn(testCommand, testArgs, {
        cwd: blueprint.projectPath,
        shell: true,
        env: { ...process.env, CI: 'true' },
      });

      let output = '';

      proc.stdout?.on('data', (data) => {
        output += data.toString();
        this.emit('unit:output', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        output += data.toString();
        this.emit('unit:output', data.toString());
      });

      proc.on('close', (code) => {
        const success = code === 0;
        const result = this.parseTestOutput(output, success);

        resolve({
          ...result,
          testOutput: output,
          duration: Date.now() - startTime,
        });
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          skippedTests: 0,
          testOutput: error.message,
          failures: [{ name: 'test-execution', error: error.message }],
          duration: Date.now() - startTime,
        });
      });

      // 超时处理
      setTimeout(() => {
        proc.kill('SIGTERM');
      }, this.config.unitTestTimeout);
    });
  }

  /**
   * 解析测试输出
   */
  private parseTestOutput(
    output: string,
    success: boolean
  ): Omit<UnitTestResult, 'testOutput' | 'duration'> {
    // 尝试解析 Jest/Vitest 格式
    const jestMatch = output.match(/Tests:\s+(\d+)\s+passed.*?(\d+)\s+total/i);
    if (jestMatch) {
      const passed = parseInt(jestMatch[1], 10);
      const total = parseInt(jestMatch[2], 10);
      return {
        success,
        totalTests: total,
        passedTests: passed,
        failedTests: total - passed,
        skippedTests: 0,
        failures: [],
      };
    }

    // 尝试解析 pytest 格式
    const pytestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (pytestMatch) {
      const passed = parseInt(pytestMatch[1], 10);
      const failed = parseInt(pytestMatch[2], 10);
      return {
        success,
        totalTests: passed + failed,
        passedTests: passed,
        failedTests: failed,
        skippedTests: 0,
        failures: [],
      };
    }

    // 默认返回
    return {
      success,
      totalTests: success ? 1 : 0,
      passedTests: success ? 1 : 0,
      failedTests: success ? 0 : 1,
      skippedTests: 0,
      failures: success ? [] : [{ name: 'unknown', error: 'Test failed' }],
    };
  }

  /**
   * 尝试修复单元测试失败
   */
  private async attemptUnitTestFix(
    blueprint: Blueprint,
    testResult: UnitTestResult,
    attemptCount: number
  ): Promise<{ success: boolean; description: string }> {
    this.log(`尝试修复单元测试 (第 ${attemptCount + 1} 次)...`);
    this.updateStatus('fixing');

    // 这里可以接入 AI 修复逻辑
    // 暂时返回简单结果
    return {
      success: false,
      description: '自动修复功能待实现',
    };
  }

  /**
   * 生成验收总结
   */
  private generateSummary(
    unitTest?: UnitTestResult,
    e2eTest?: E2ETestResult,
    designComparison?: VerificationResult['designComparison']
  ): string {
    const lines: string[] = [];

    if (unitTest) {
      const unitStatus = unitTest.success ? '✅' : '❌';
      lines.push(`单元测试: ${unitStatus} ${unitTest.passedTests}/${unitTest.totalTests} 通过`);
    }

    if (e2eTest) {
      const e2eStatus = e2eTest.success ? '✅' : '❌';
      lines.push(`E2E 测试: ${e2eStatus} ${e2eTest.passedSteps}/${e2eTest.steps.length} 步骤通过`);
    }

    if (designComparison) {
      const designStatus = designComparison.failed === 0 ? '✅' : '⚠️';
      lines.push(`设计图对比: ${designStatus} ${designComparison.passed}/${designComparison.total} 通过 (平均相似度: ${designComparison.avgSimilarity}%)`);
    }

    return lines.join('\n');
  }

  /**
   * 更新状态
   */
  private updateStatus(status: VerificationStatus): void {
    this.status = status;
    this.emit('status', status);
    this.log(`状态更新: ${status}`);
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    console.log(`[VerificationService] ${message}`);
    this.emit('log', message);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建验收测试服务
 */
export function createVerificationService(config: VerificationConfig = { type: 'both' }): VerificationService {
  return new VerificationService(config);
}

/**
 * 快速运行验收测试
 */
export async function runVerification(
  blueprint: Blueprint,
  mcpToolCaller?: McpToolCaller,
  config: VerificationConfig = { type: 'both' }
): Promise<VerificationResult> {
  const service = createVerificationService(config);
  return service.verify(blueprint, mcpToolCaller);
}
