/**
 * Browser executable detection
 * Cross-platform Chrome/Edge/Brave/Chromium auto-detection
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

export interface BrowserExecutable {
  kind: 'chrome' | 'edge' | 'brave' | 'chromium';
  path: string;
}

const WINDOWS_CANDIDATES: { kind: BrowserExecutable['kind']; paths: string[] }[] = [
  {
    kind: 'chrome',
    paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  },
  {
    kind: 'edge',
    paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ],
  },
  {
    kind: 'brave',
    paths: [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    ],
  },
  {
    kind: 'chromium',
    paths: [
      'C:\\Program Files\\Chromium\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
    ],
  },
];

const DARWIN_CANDIDATES: { kind: BrowserExecutable['kind']; paths: string[] }[] = [
  { kind: 'chrome', paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] },
  { kind: 'edge', paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'] },
  { kind: 'brave', paths: ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'] },
  { kind: 'chromium', paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'] },
];

const LINUX_COMMANDS: { kind: BrowserExecutable['kind']; commands: string[] }[] = [
  { kind: 'chrome', commands: ['google-chrome', 'google-chrome-stable'] },
  { kind: 'edge', commands: ['microsoft-edge', 'microsoft-edge-stable'] },
  { kind: 'brave', commands: ['brave-browser'] },
  { kind: 'chromium', commands: ['chromium-browser', 'chromium'] },
];

function whichSync(command: string): string | null {
  try {
    return execSync(`which ${command}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

export function detectBrowserExecutable(): BrowserExecutable | null {
  const plat = platform();

  if (plat === 'win32') {
    for (const candidate of WINDOWS_CANDIDATES) {
      for (const p of candidate.paths) {
        if (existsSync(p)) return { kind: candidate.kind, path: p };
      }
    }
  } else if (plat === 'darwin') {
    for (const candidate of DARWIN_CANDIDATES) {
      for (const p of candidate.paths) {
        if (existsSync(p)) return { kind: candidate.kind, path: p };
      }
    }
  } else if (plat === 'linux') {
    for (const candidate of LINUX_COMMANDS) {
      for (const cmd of candidate.commands) {
        const found = whichSync(cmd);
        if (found) return { kind: candidate.kind, path: found };
      }
    }
  }

  return null;
}

/**
 * Legacy API — returns path string or null.
 */
export async function detectBrowser(): Promise<string | null> {
  return detectBrowserExecutable()?.path ?? null;
}
