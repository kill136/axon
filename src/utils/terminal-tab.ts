/**
 * 跨平台终端 tab 打开工具
 * 用于在新终端 tab/窗口中显示后台任务的实时输出
 */

import { spawn, spawnSync } from 'child_process';
import * as os from 'os';

export interface TerminalTabOptions {
  taskId: string;
  command: string;    // 原始命令（用于标题）
  logFile: string;    // 输出文件路径
}

type TerminalType = 'windows-terminal' | 'tmux' | 'macos-terminal' | 'macos-iterm' | 'none';

/**
 * 检测当前终端环境
 */
function detectTerminal(): TerminalType {
  // tmux 优先（跨平台）
  if (process.env.TMUX) {
    return 'tmux';
  }

  if (os.platform() === 'win32') {
    // 检测 Windows Terminal 是否可用
    try {
      const result = spawnSync('where', ['wt.exe'], {
        encoding: 'utf-8',
        timeout: 3000,
        windowsHide: true,
      });
      if (result.status === 0 && result.stdout?.trim()) {
        return 'windows-terminal';
      }
    } catch {
      // wt.exe 不可用
    }
  }

  if (os.platform() === 'darwin') {
    const termProgram = process.env.TERM_PROGRAM;
    if (termProgram === 'iTerm.app') {
      return 'macos-iterm';
    }
    // 默认 Terminal.app
    return 'macos-terminal';
  }

  return 'none';
}

/**
 * 截断命令文字用于终端标题
 */
function truncateTitle(command: string, maxLen: number = 40): string {
  const cleaned = command.replace(/[\r\n]+/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.substring(0, maxLen) + '...';
}

/**
 * 在新终端 tab 中打开后台任务的输出查看器
 * 返回 true 表示成功打开，false 表示无法打开
 */
export function openTerminalForTask(options: TerminalTabOptions): boolean {
  const { taskId, command, logFile } = options;
  const title = `BG: ${truncateTitle(command)}`;
  const terminal = detectTerminal();

  try {
    switch (terminal) {
      case 'windows-terminal':
        return openWindowsTerminalTab(title, logFile);
      case 'tmux':
        return openTmuxWindow(title, logFile);
      case 'macos-terminal':
        return openMacTerminalTab(title, logFile);
      case 'macos-iterm':
        return openItermTab(title, logFile);
      case 'none':
        return false;
    }
  } catch (err) {
    if (process.env.DEBUG) {
      console.error(`[terminal-tab] Failed to open terminal for task ${taskId}:`, err);
    }
    return false;
  }
}

/**
 * Windows Terminal: wt.exe -w 0 nt
 */
function openWindowsTerminalTab(title: string, logFile: string): boolean {
  // PowerShell 命令：用 Get-Content -Wait 实时跟踪文件
  // 加 -ErrorAction SilentlyContinue 避免文件还没创建时报错
  const psCommand = `$Host.UI.RawUI.WindowTitle = '${title.replace(/'/g, "''")}'; Write-Host 'Waiting for output from background task...' -ForegroundColor Cyan; Write-Host 'Log: ${logFile.replace(/'/g, "''")}' -ForegroundColor DarkGray; Write-Host ''; while (!(Test-Path '${logFile.replace(/'/g, "''")}')) { Start-Sleep -Milliseconds 200 }; Get-Content -Path '${logFile.replace(/'/g, "''")}' -Wait -Tail 0`;

  const proc = spawn('wt.exe', [
    '-w', '0',
    'nt',
    '--title', title,
    'powershell', '-NoProfile', '-Command', psCommand,
  ], {
    stdio: 'ignore',
    detached: true,
    windowsHide: false,
  });

  proc.unref();
  return true;
}

/**
 * tmux: new-window with tail -f
 */
function openTmuxWindow(title: string, logFile: string): boolean {
  const proc = spawn('tmux', [
    'new-window',
    '-n', title,
    `echo "Waiting for output from background task..." && echo "Log: ${logFile}" && echo "" && while [ ! -f "${logFile}" ]; do sleep 0.2; done && tail -f "${logFile}"`,
  ], {
    stdio: 'ignore',
    detached: true,
  });

  proc.unref();
  return true;
}

/**
 * macOS Terminal.app: osascript
 */
function openMacTerminalTab(title: string, logFile: string): boolean {
  const script = `
    tell application "Terminal"
      activate
      do script "echo 'Waiting for output from background task...' && echo 'Log: ${logFile}' && echo '' && while [ ! -f '${logFile}' ]; do sleep 0.2; done && tail -f '${logFile}'"
      set custom title of front window to "${title.replace(/"/g, '\\"')}"
    end tell
  `;

  const proc = spawn('osascript', ['-e', script], {
    stdio: 'ignore',
    detached: true,
  });

  proc.unref();
  return true;
}

/**
 * macOS iTerm2: osascript
 */
function openItermTab(title: string, logFile: string): boolean {
  const script = `
    tell application "iTerm2"
      tell current window
        create tab with default profile
        tell current session
          set name to "${title.replace(/"/g, '\\"')}"
          write text "echo 'Waiting for output from background task...' && echo 'Log: ${logFile}' && echo '' && while [ ! -f '${logFile}' ]; do sleep 0.2; done && tail -f '${logFile}'"
        end tell
      end tell
    end tell
  `;

  const proc = spawn('osascript', ['-e', script], {
    stdio: 'ignore',
    detached: true,
  });

  proc.unref();
  return true;
}
