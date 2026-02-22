/**
 * SelfEvolveTool - 自我进化工具
 *
 * 让 AI 在修改自身源码后，触发可控的进程重启使修改生效。
 *
 * 工作流程：
 * 1. AI 用 Edit/Write 工具修改 .ts 源码
 * 2. AI 调用 SelfEvolveTool 触发重启
 * 3. tsc --noEmit 编译检查（失败则中止，不重启）
 * 4. 持久化所有活跃会话
 * 5. 以退出码 42 退出进程
 * 6. 外层 --evolve 监控进程检测到 42，自动重启
 * 7. 前端 WebSocket 自动重连，session 自动恢复
 *
 * 安全机制：
 * - 仅在 CLAUDE_EVOLVE_ENABLED=1 时可用（--evolve 标志设置）
 * - tsc 编译检查通过才允许重启
 * - dryRun 模式只检查不重启
 * - 重启日志追加到 ~/.claude/evolve-log.jsonl
 */

import { BaseTool } from './base.js';
import type { ToolDefinition, ToolResult } from '../types/index.js';
import { t } from '../i18n/index.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { requestEvolveRestart, isEvolveEnabled } from '../web/server/evolve-state.js';

export interface SelfEvolveInput {
  /** 重启原因（记录到日志） */
  reason: string;
  /** 只做编译检查，不实际重启 */
  dryRun?: boolean;
}

/** 进化日志条目 */
interface EvolveLogEntry {
  timestamp: string;
  reason: string;
  dryRun: boolean;
  tscResult: 'pass' | 'fail';
  tscErrors?: string;
  restarted: boolean;
}

export class SelfEvolveTool extends BaseTool<SelfEvolveInput, ToolResult> {
  name = 'SelfEvolve';
  description = 'Trigger a controlled process restart after modifying source code. Only available when running with --evolve flag (CLAUDE_EVOLVE_ENABLED=1). Runs TypeScript compilation check before restarting to prevent broken restarts.';

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the restart is needed (e.g., "Added new feature X", "Fixed bug in Y"). This is logged for audit trail.',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only run TypeScript compilation check without actually restarting. Use this to verify code changes compile before committing to a restart.',
        },
      },
      required: ['reason'],
    };
  }

  async execute(input: SelfEvolveInput): Promise<ToolResult> {
    const { reason, dryRun = false } = input;

    // 1. 检查进化模式是否启用
    if (!isEvolveEnabled()) {
      return this.error(
        'Self-evolve is not enabled. Start the server with --evolve flag to enable this feature.\n' +
        'Usage: claude-web --evolve -H 0.0.0.0'
      );
    }

    // 2. 获取项目根目录
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) {
      return this.error(t('selfEvolve.noProjectRoot'));
    }

    // 3. TypeScript 编译检查（后端）
    console.log('[SelfEvolve] Running backend TypeScript compilation check...');
    const tscResult = this.runTypeCheck(projectRoot);

    if (!tscResult.success) {
      const logEntry: EvolveLogEntry = {
        timestamp: new Date().toISOString(),
        reason,
        dryRun,
        tscResult: 'fail',
        tscErrors: tscResult.errors || undefined,
        restarted: false,
      };
      this.appendLog(logEntry);
      return this.error(
        `Backend TypeScript compilation failed. Restart aborted.\n\n` +
        `Errors:\n${tscResult.errors}\n\n` +
        `Fix the errors and try again.`
      );
    }

    // 4. 前端构建检查
    const webClientDir = path.join(projectRoot, 'src', 'web', 'client');
    if (fs.existsSync(webClientDir)) {
      console.log('[SelfEvolve] Running web client build check...');
      const webResult = this.runWebClientCheck(webClientDir);
      if (!webResult.success) {
        const logEntry: EvolveLogEntry = {
          timestamp: new Date().toISOString(),
          reason,
          dryRun,
          tscResult: 'fail',
          tscErrors: `[Web Client Build Failed]\n${webResult.errors}`,
          restarted: false,
        };
        this.appendLog(logEntry);
        return this.error(
          `Web client build check failed. Restart aborted.\n\n` +
          `Errors:\n${webResult.errors}\n\n` +
          `Fix the frontend errors and try again.`
        );
      }
      console.log('[SelfEvolve] Web client build check passed.');
    }

    // 5. 记录日志
    const logEntry: EvolveLogEntry = {
      timestamp: new Date().toISOString(),
      reason,
      dryRun,
      tscResult: 'pass',
      restarted: false,
    };

    if (dryRun) {
      this.appendLog(logEntry);
      return this.success(
        `Dry run complete. All checks passed (backend tsc + web client build).\n` +
        `The code changes are valid and safe to restart.\n` +
        `Call SelfEvolve again without dryRun to actually restart.`
      );
    }

    // 6. 实际重启流程
    console.log(`[SelfEvolve] All checks passed. Initiating restart...`);
    console.log(`[SelfEvolve] Reason: ${reason}`);

    logEntry.restarted = true;
    this.appendLog(logEntry);

    // 6. 请求进化重启（设置退出码 42 标志）
    // 注意：不再在这里 setTimeout 触发 gracefulShutdown，
    // 而是让对话循环检测到此标志后，完成持久化再触发关闭。
    // 这样可以确保 SelfEvolve 工具的返回结果和最后一条 assistant 回复不丢失。
    requestEvolveRestart();

    return this.success(
      `Self-evolve restart initiated.\n` +
      `Reason: ${reason}\n` +
      `The server will restart in a few seconds with the new code.\n` +
      `WebSocket will auto-reconnect and session will be restored.`
    );
  }

  /**
   * 运行 tsc --noEmit 编译检查
   */
  private runTypeCheck(projectRoot: string): { success: boolean; errors?: string } {
    try {
      execSync('npx tsc --noEmit', {
        cwd: projectRoot,
        timeout: 60000, // 60 秒超时
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return { success: true };
    } catch (err: any) {
      const stderr = err.stderr || '';
      const stdout = err.stdout || '';
      const errors = (stderr + '\n' + stdout).trim();
      return { success: false, errors: errors || 'Unknown compilation error' };
    }
  }

  /**
   * 运行前端构建检查（tsc + vite build）
   */
  private runWebClientCheck(webClientDir: string): { success: boolean; errors?: string } {
    // 检查 node_modules 是否存在，不存在则跳过（未安装依赖时不阻塞）
    const nodeModulesDir = path.join(webClientDir, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
      console.log('[SelfEvolve] Web client node_modules not found, skipping web check.');
      return { success: true };
    }

    try {
      // 执行 npm run build（内部是 tsc && vite build）
      execSync('npm run build', {
        cwd: webClientDir,
        timeout: 120000, // 前端构建可能较慢，给 120 秒
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      return { success: true };
    } catch (err: any) {
      const stderr = err.stderr || '';
      const stdout = err.stdout || '';
      const errors = (stderr + '\n' + stdout).trim();
      return { success: false, errors: errors || 'Unknown web client build error' };
    }
  }

  /**
   * 追加进化日志
   */
  private appendLog(entry: EvolveLogEntry): void {
    try {
      const logDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logPath = path.join(logDir, 'evolve-log.jsonl');
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // 日志写入失败不影响主流程
    }
  }

  /**
   * 获取项目根目录（通过查找 package.json）
   */
  private getProjectRoot(): string | null {
    // 从当前文件位置向上查找
    let dir = path.dirname(new URL(import.meta.url).pathname);
    // Windows 路径修正：移除开头的 /
    if (process.platform === 'win32' && dir.startsWith('/')) {
      dir = dir.slice(1);
    }

    // 向上最多找 5 层
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          if (pkg.name === 'claude-code-open') {
            return dir;
          }
        } catch {
          // 继续向上找
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break; // 到达根目录
      dir = parent;
    }

    return null;
  }
}
