/**
 * 管理员权限命令模块
 *
 * 设计理念：
 * - 利用现有的权限弹框机制
 * - Worker 调用 Bash 时，自动检测是否需要管理员权限
 * - 如果需要，触发权限请求，让用户确认
 * - 用户确认后，以提升权限执行命令
 *
 * 这不是一个新工具，而是 Bash 工具的增强功能
 */

import { execSync, spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// 命令检测
// ============================================================================

/**
 * 需要管理员权限的命令模式
 */
const ELEVATED_COMMAND_PATTERNS = {
  windows: [
    // 软件安装
    /^winget\s+install/i,
    /^choco\s+install/i,
    /^scoop\s+install/i,
    // 服务管理
    /^net\s+start/i,
    /^net\s+stop/i,
    /^sc\s+(start|stop|config)/i,
    // 系统配置
    /^setx\s+.*\/m/i,
    /^reg\s+(add|delete)/i,
    // Docker（可能需要管理员）
    /^docker\s+service/i,
  ],
  darwin: [
    // 软件安装
    /^brew\s+install.*--cask/i,
    /^sudo\s+/i,
    // 服务管理
    /^launchctl\s+(start|stop|load|unload)/i,
    // 系统配置
    /^defaults\s+write/i,
  ],
  linux: [
    // 软件安装
    /^(sudo\s+)?(apt|apt-get|yum|dnf|pacman)\s+install/i,
    /^sudo\s+/i,
    // 服务管理
    /^(sudo\s+)?systemctl\s+(start|stop|enable|disable)/i,
    /^(sudo\s+)?service\s+\w+\s+(start|stop|restart)/i,
    // Docker（可能需要管理员）
    /^(sudo\s+)?docker\s+/i,
  ],
};

/**
 * 检测命令是否需要管理员权限
 */
export function needsElevation(command: string): boolean {
  const platform = os.platform();
  const patterns = ELEVATED_COMMAND_PATTERNS[
    platform === 'win32' ? 'windows' :
    platform === 'darwin' ? 'darwin' : 'linux'
  ];

  return patterns.some(pattern => pattern.test(command));
}

/**
 * 获取命令需要管理员权限的原因
 */
export function getElevationReason(command: string): string {
  if (/install/i.test(command)) {
    return 'Installing software requires administrator privileges';
  }
  if (/start|stop|restart|enable|disable/i.test(command)) {
    return 'Managing system services requires administrator privileges';
  }
  if (/docker/i.test(command)) {
    return 'Docker operations may require administrator privileges';
  }
  if (/sudo/i.test(command)) {
    return 'Command contains sudo, requires administrator privileges';
  }
  return 'This command may require administrator privileges';
}

// ============================================================================
// 权限提升执行
// ============================================================================

export interface ElevatedExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

/**
 * 以提升权限执行命令
 * 这个函数只在用户通过权限弹框确认后调用
 */
export async function executeElevated(
  command: string,
  workingDir?: string,
  timeout: number = 300000
): Promise<ElevatedExecutionResult> {
  const platform = os.platform();

  try {
    if (platform === 'win32') {
      return await executeElevatedWindows(command, workingDir, timeout);
    } else if (platform === 'darwin') {
      return await executeElevatedMac(command, workingDir, timeout);
    } else {
      return await executeElevatedLinux(command, workingDir, timeout);
    }
  } catch (error) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      exitCode: -1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Windows: 使用 PowerShell 提升权限（会弹出 UAC 对话框）
 */
async function executeElevatedWindows(
  command: string,
  workingDir?: string,
  timeout: number = 300000
): Promise<ElevatedExecutionResult> {
  // 创建临时脚本
  const tempScript = path.join(os.tmpdir(), `elevated-${Date.now()}.ps1`);
  const outputFile = path.join(os.tmpdir(), `elevated-stdout-${Date.now()}.txt`);
  const errorFile = path.join(os.tmpdir(), `elevated-stderr-${Date.now()}.txt`);
  const exitCodeFile = path.join(os.tmpdir(), `elevated-exitcode-${Date.now()}.txt`);

  // 如果命令已经是 PowerShell 格式，直接执行；否则通过 cmd 执行
  const isPowerShellCommand = command.startsWith('powershell') || command.startsWith('pwsh');
  const actualCommand = isPowerShellCommand ? command : `cmd /c "${command.replace(/"/g, '\\"')}"`;

  const scriptContent = `
$ErrorActionPreference = "Continue"
${workingDir ? `Set-Location "${workingDir}"` : ''}
try {
    $output = ${actualCommand} 2>&1
    $stdout = $output | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } | Out-String
    $stderr = $output | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] } | Out-String
    $stdout | Out-File -FilePath "${outputFile.replace(/\\/g, '\\\\')}" -Encoding UTF8
    $stderr | Out-File -FilePath "${errorFile.replace(/\\/g, '\\\\')}" -Encoding UTF8
    $LASTEXITCODE | Out-File -FilePath "${exitCodeFile.replace(/\\/g, '\\\\')}" -Encoding UTF8
} catch {
    $_.Exception.Message | Out-File -FilePath "${errorFile.replace(/\\/g, '\\\\')}" -Encoding UTF8
    "1" | Out-File -FilePath "${exitCodeFile.replace(/\\/g, '\\\\')}" -Encoding UTF8
}
`;

  fs.writeFileSync(tempScript, scriptContent, 'utf-8');

  try {
    // 使用 Start-Process 以管理员权限运行（会弹出 UAC）
    execSync(
      `powershell -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -File \\"${tempScript}\\"' -Verb RunAs -Wait"`,
      { timeout, stdio: 'pipe' }
    );

    // 读取输出
    const stdout = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf-8').trim() : '';
    const stderr = fs.existsSync(errorFile) ? fs.readFileSync(errorFile, 'utf-8').trim() : '';
    const exitCode = fs.existsSync(exitCodeFile) ? parseInt(fs.readFileSync(exitCodeFile, 'utf-8').trim()) || 0 : 0;

    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
    };
  } finally {
    // 清理临时文件
    try {
      if (fs.existsSync(tempScript)) fs.unlinkSync(tempScript);
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      if (fs.existsSync(errorFile)) fs.unlinkSync(errorFile);
      if (fs.existsSync(exitCodeFile)) fs.unlinkSync(exitCodeFile);
    } catch {
      // 忽略清理错误
    }
  }
}

/**
 * macOS: 使用 osascript 请求管理员权限（会弹出密码对话框）
 */
async function executeElevatedMac(
  command: string,
  workingDir?: string,
  timeout: number = 300000
): Promise<ElevatedExecutionResult> {
  const fullCommand = workingDir ? `cd "${workingDir}" && ${command}` : command;

  // 移除已有的 sudo 前缀（osascript 会处理权限）
  const cleanCommand = fullCommand.replace(/^sudo\s+/, '');

  // 使用 osascript 弹出密码对话框
  const script = `do shell script "${cleanCommand.replace(/"/g, '\\"')}" with administrator privileges`;

  try {
    const stdout = execSync(`osascript -e '${script}'`, {
      timeout,
      encoding: 'utf-8',
    });

    return {
      success: true,
      stdout,
      stderr: '',
      exitCode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      stdout: '',
      stderr: error.stderr || '',
      exitCode: error.status || 1,
      error: error.message,
    };
  }
}

/**
 * Linux: 使用 pkexec（图形化）或 sudo（终端）
 */
async function executeElevatedLinux(
  command: string,
  workingDir?: string,
  timeout: number = 300000
): Promise<ElevatedExecutionResult> {
  const fullCommand = workingDir ? `cd "${workingDir}" && ${command}` : command;

  // 移除已有的 sudo 前缀
  const cleanCommand = fullCommand.replace(/^sudo\s+/, '');

  // 优先尝试 pkexec（图形化密码提示）
  try {
    const stdout = execSync(`pkexec sh -c '${cleanCommand}'`, {
      timeout,
      encoding: 'utf-8',
    });

    return {
      success: true,
      stdout,
      stderr: '',
      exitCode: 0,
    };
  } catch (pkexecError) {
    // 如果 pkexec 失败，尝试 sudo
    try {
      const stdout = execSync(`sudo sh -c '${cleanCommand}'`, {
        timeout,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      return {
        success: true,
        stdout,
        stderr: '',
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        success: false,
        stdout: '',
        stderr: error.stderr || '',
        exitCode: error.status || 1,
        error: `Elevated execution failed: ${error.message}`,
      };
    }
  }
}

// ============================================================================
// 导出
// ============================================================================

export default {
  needsElevation,
  getElevationReason,
  executeElevated,
};
