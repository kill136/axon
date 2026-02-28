#!/usr/bin/env node

/**
 * postinstall script for axon
 * Creates desktop shortcut on Windows / .desktop entry on Linux
 * Only runs during `npm install -g` (global install)
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Detect global install via npm environment variables
// npm sets npm_config_global when -g flag is used
const isGlobal = process.env.npm_config_global === 'true' ||
  process.env.npm_config_global === '';

if (!isGlobal) {
  process.exit(0);
}

console.log('[postinstall] Global install detected, creating desktop shortcut...');

if (process.platform === 'win32') {
  createWindowsShortcut();
} else {
  createLinuxDesktopEntry();
}

function createWindowsShortcut() {
  try {
    const desktop = execSync(
      'powershell -NoProfile -Command "[Environment]::GetFolderPath(\'Desktop\')"',
      { encoding: 'utf8' }
    ).trim();

    if (!desktop || !existsSync(desktop)) {
      console.log('[postinstall] Desktop path not found, skipping.');
      return;
    }

    // Create launcher bat
    const launcherDir = join(process.env.USERPROFILE || '', '.local', 'bin');
    if (!existsSync(launcherDir)) {
      mkdirSync(launcherDir, { recursive: true });
    }

    const launcherPath = join(launcherDir, 'claude-web-start.bat');
    writeFileSync(launcherPath, [
      '@echo off',
      'chcp 65001 >nul 2>&1',
      'echo.',
      'echo   Starting Axon WebUI...',
      'echo.',
      'claude-web -H 0.0.0.0',
      'pause',
      ''
    ].join('\r\n'), 'ascii');

    // Create .lnk via PowerShell
    const shortcutPath = join(desktop, 'Axon WebUI.lnk');
    const esc = s => s.replace(/'/g, "''");
    const psScript = [
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${esc(shortcutPath)}')`,
      `$s.TargetPath = '${esc(launcherPath)}'`,
      `$s.Description = 'Launch Axon Web Interface'`,
      `$s.WorkingDirectory = $env:USERPROFILE`,
      `$s.Save()`
    ].join('; ');

    execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { stdio: 'ignore' });
    console.log(`[postinstall] Desktop shortcut created: ${shortcutPath}`);
  } catch (e) {
    console.log(`[postinstall] Failed to create shortcut: ${e.message}`);
  }
}

function createLinuxDesktopEntry() {
  try {
    const home = process.env.HOME || '';
    const entry = [
      '[Desktop Entry]',
      'Name=Axon WebUI',
      'Comment=Launch Axon Web Interface',
      'Exec=claude-web -H 0.0.0.0',
      'Terminal=true',
      'Type=Application',
      'Categories=Development;',
      ''
    ].join('\n');

    // ~/.local/share/applications (app menu)
    const appDir = join(home, '.local', 'share', 'applications');
    if (existsSync(appDir)) {
      writeFileSync(join(appDir, 'claude-code-webui.desktop'), entry);
      console.log(`[postinstall] App menu entry created.`);
    }

    // ~/Desktop
    const desktopDir = join(home, 'Desktop');
    if (existsSync(desktopDir)) {
      const p = join(desktopDir, 'claude-code-webui.desktop');
      writeFileSync(p, entry);
      try { execSync(`chmod +x "${p}"`); } catch {}
      console.log(`[postinstall] Desktop shortcut created: ${p}`);
    }
  } catch (e) {
    console.log(`[postinstall] Failed to create desktop entry: ${e.message}`);
  }
}
