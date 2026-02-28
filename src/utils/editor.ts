/**
 * 编辑器工具函数
 * 用于在外部编辑器中打开文件
 */

import { spawn } from 'child_process';
import * as path from 'path';

/**
 * 获取默认编辑器
 */
export function getDefaultEditor(): string {
  // 优先使用环境变量
  if (process.env.VISUAL) return process.env.VISUAL;
  if (process.env.EDITOR) return process.env.EDITOR;

  // 根据平台选择默认编辑器
  switch (process.platform) {
    case 'win32':
      return 'notepad';
    case 'darwin':
      return 'open -t'; // 使用系统默认文本编辑器
    default:
      // Linux: 尝试常见编辑器
      return 'nano';
  }
}

/**
 * 在编辑器中打开文件
 * @param filePath 文件路径
 * @param editor 编辑器命令（可选，默认使用系统编辑器）
 */
export async function openInEditor(filePath: string, editor?: string): Promise<void> {
  const editorCmd = editor || getDefaultEditor();
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  return new Promise((resolve, reject) => {
    // 解析编辑器命令
    const parts = editorCmd.split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), absolutePath];

    // 对于 macOS 的 open 命令，需要特殊处理
    if (process.platform === 'darwin' && cmd === 'open') {
      // open -t 会用默认文本编辑器打开
      // open -e 会用 TextEdit 打开
      const openArgs = args.includes('-t') || args.includes('-e')
        ? args
        : ['-t', ...args];

      const child = spawn('open', openArgs, {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();
      resolve();
      return;
    }

    // 对于 Windows 的 notepad 或 code
    if (process.platform === 'win32') {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
        shell: true,
        windowsHide: true,
      });

      child.unref();
      resolve();
      return;
    }

    // 对于 GUI 编辑器 (code, cursor, sublime 等)，不等待退出
    const guiEditors = ['code', 'cursor', 'subl', 'sublime', 'atom', 'gedit', 'kate', 'windsurf'];
    if (guiEditors.some(e => cmd.toLowerCase().includes(e))) {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to open editor: ${err.message}`));
      });

      child.unref();
      resolve();
      return;
    }

    // 对于终端编辑器 (vim, nano, emacs 等)，等待退出
    const child = spawn(cmd, args, {
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to open editor: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });
  });
}

/**
 * 检查编辑器是否可用
 */
export async function isEditorAvailable(editor: string): Promise<boolean> {
  const cmd = editor.split(/\s+/)[0];

  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'ignore',
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}
