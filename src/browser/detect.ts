/**
 * Browser executable detection
 * Cross-platform browser auto-detection
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { platform } from 'os';

export interface BrowserCandidate {
  name: string;
  paths: string[];
  command?: string;
}

export const BROWSER_CANDIDATES: BrowserCandidate[] = [
  {
    name: 'Chrome',
    paths:
      platform() === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          ]
        : platform() === 'darwin'
          ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
          : [],
    command: platform() === 'linux' ? 'google-chrome' : undefined,
  },
  {
    name: 'Brave',
    paths:
      platform() === 'win32'
        ? [
            'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
          ]
        : platform() === 'darwin'
          ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
          : [],
    command: platform() === 'linux' ? 'brave-browser' : undefined,
  },
  {
    name: 'Edge',
    paths:
      platform() === 'win32'
        ? [
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          ]
        : platform() === 'darwin'
          ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
          : [],
    command: platform() === 'linux' ? 'microsoft-edge' : undefined,
  },
  {
    name: 'Chromium',
    paths:
      platform() === 'win32'
        ? [
            'C:\\Program Files\\Chromium\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe',
          ]
        : platform() === 'darwin'
          ? ['/Applications/Chromium.app/Contents/MacOS/Chromium']
          : [],
    command: platform() === 'linux' ? 'chromium-browser' : 'chromium',
  },
];

export async function detectBrowser(): Promise<string | null> {
  const currentPlatform = platform();

  for (const candidate of BROWSER_CANDIDATES) {
    if (currentPlatform === 'linux' && candidate.command) {
      try {
        const result = execSync(`which ${candidate.command}`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        if (result) {
          return result;
        }
      } catch {
        continue;
      }
    } else {
      for (const path of candidate.paths) {
        if (existsSync(path)) {
          return path;
        }
      }
    }
  }

  return null;
}
