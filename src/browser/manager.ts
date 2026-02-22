/**
 * Browser lifecycle manager (openclaw architecture)
 *
 * Key design: Chrome process management and Playwright CDP connection are SEPARATED.
 *
 * Chrome process: spawned with --remote-debugging-port, managed by RunningChrome.
 * CDP connection: lazy, cached, auto-reconnects on disconnect.
 *
 * Connection strategy:
 * 1. cdpUrl explicitly provided → connect directly (user's existing Chrome)
 * 2. Launch new Chrome with dedicated user-data-dir + CDP port
 * 3. Connect to it via chromium.connectOverCDP()
 *
 * This gives us:
 * - Login state sharing (when connecting to user's Chrome)
 * - Stable CDP reconnection (if Playwright disconnects, reconnect transparently)
 * - Clean process lifecycle (we own the Chrome process we launch)
 */

import { type ChildProcessWithoutNullStreams, spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { BrowserStartOptions } from './types.js';
import { detectBrowserExecutable, type BrowserExecutable } from './detect.js';

const CONFIG_DIR = path.join(os.homedir(), '.claude');
const CDP_PORT_RANGE_START = 9222;
const CDP_PORT_RANGE_END = 9322;

// --- Chrome process management ---

interface RunningChrome {
  pid: number;
  exe: BrowserExecutable;
  userDataDir: string;
  cdpPort: number;
  cdpUrl: string;
  proc: ChildProcessWithoutNullStreams;
}

// --- CDP connection (Playwright) ---

interface CachedConnection {
  browser: Browser;
  cdpUrl: string;
}

let cachedConnection: CachedConnection | null = null;
let connectingPromise: Promise<CachedConnection> | null = null;

// --- Helpers ---

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findAvailableCdpPort(preferredPort?: number): Promise<number> {
  if (preferredPort) {
    if (await isPortAvailable(preferredPort)) return preferredPort;
  }
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available CDP port found in range ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END}.`);
}

async function fetchCdpVersion(cdpUrl: string, timeoutMs = 1500): Promise<{ webSocketDebuggerUrl?: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${cdpUrl}/json/version`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as { webSocketDebuggerUrl?: string };
  } catch {
    return null;
  }
}

async function isCdpReachable(cdpUrl: string, timeoutMs = 500): Promise<boolean> {
  return (await fetchCdpVersion(cdpUrl, timeoutMs)) !== null;
}

function normalizeCdpWsUrl(wsUrl: string, cdpUrl: string): string {
  try {
    const cdpParsed = new URL(cdpUrl);
    const wsParsed = new URL(wsUrl);
    wsParsed.hostname = cdpParsed.hostname;
    return wsParsed.toString();
  } catch {
    return wsUrl;
  }
}

async function getChromeWebSocketUrl(cdpUrl: string, timeoutMs = 2000): Promise<string | null> {
  const data = await fetchCdpVersion(cdpUrl, timeoutMs);
  const wsUrl = data?.webSocketDebuggerUrl?.trim();
  if (!wsUrl) return null;
  return normalizeCdpWsUrl(wsUrl, cdpUrl);
}

function resolveUserDataDir(profileName: string = 'default'): string {
  return path.join(CONFIG_DIR, 'browser', profileName, 'user-data');
}

// --- connectOverCDP with caching + auto-reconnect ---

async function connectBrowser(cdpUrl: string): Promise<CachedConnection> {
  const normalized = cdpUrl.replace(/\/$/, '');

  // Return cached if same URL
  if (cachedConnection?.cdpUrl === normalized) {
    return cachedConnection;
  }

  // Await in-flight connection
  if (connectingPromise) {
    return await connectingPromise;
  }

  const doConnect = async (): Promise<CachedConnection> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = 5000 + attempt * 2000;
        const wsUrl = await getChromeWebSocketUrl(normalized, timeout).catch(() => null);
        const endpoint = wsUrl ?? normalized;

        const { chromium } = await import('playwright-core');
        const browser = await chromium.connectOverCDP(endpoint, { timeout });

        const conn: CachedConnection = { browser, cdpUrl: normalized };
        cachedConnection = conn;

        browser.on('disconnected', () => {
          if (cachedConnection?.browser === browser) {
            cachedConnection = null;
          }
        });

        return conn;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 250 + attempt * 250));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'CDP connect failed'));
  };

  connectingPromise = doConnect().finally(() => { connectingPromise = null; });
  return await connectingPromise;
}

async function disconnectBrowser(): Promise<void> {
  const cur = cachedConnection;
  cachedConnection = null;
  connectingPromise = null;
  if (cur) {
    await cur.browser.close().catch(() => {});
  }
}

// --- Launch Chrome process ---

async function launchChrome(
  exe: BrowserExecutable,
  cdpPort: number,
  userDataDir: string,
  options?: BrowserStartOptions,
): Promise<RunningChrome> {
  fs.mkdirSync(userDataDir, { recursive: true });

  const args: string[] = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-features=Translate,MediaRouter',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--password-store=basic',
    '--disable-blink-features=AutomationControlled',
  ];

  if (options?.headless) {
    args.push('--headless=new', '--disable-gpu');
  }
  if (options?.noSandbox) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  if (process.platform === 'linux') {
    args.push('--disable-dev-shm-usage');
  }

  args.push('about:blank');

  const proc = spawn(exe.path, args, {
    stdio: 'pipe',
    env: { ...process.env, HOME: os.homedir() },
  });

  const cdpUrl = `http://127.0.0.1:${cdpPort}`;

  // Wait for CDP to come up
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isCdpReachable(cdpUrl, 500)) {
      break;
    }
    // Check if process exited early
    if (proc.exitCode !== null) {
      throw new Error(`Chrome exited with code ${proc.exitCode} before CDP became ready.`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!(await isCdpReachable(cdpUrl, 500))) {
    killProc(proc);
    throw new Error(`Chrome CDP did not become reachable at ${cdpUrl} within 15s.`);
  }

  return {
    pid: proc.pid ?? -1,
    exe,
    userDataDir,
    cdpPort,
    cdpUrl,
    proc,
  };
}

function killProc(proc: ChildProcessWithoutNullStreams): void {
  if (proc.killed) return;
  if (process.platform === 'win32') {
    // Windows: use taskkill for reliable termination
    try {
      if (proc.pid) {
        execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
      }
    } catch {
      proc.kill();
    }
  } else {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 3000);
  }
}

async function stopChrome(running: RunningChrome): Promise<void> {
  killProc(running.proc);
  // Wait for exit
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (running.proc.exitCode !== null) return;
    await new Promise(r => setTimeout(r, 100));
  }
}

// ========================================================================
// BrowserManager — singleton facade
// ========================================================================

export class BrowserManager {
  private static instance: BrowserManager | null = null;

  private running: RunningChrome | null = null;
  private currentPage: Page | null = null;
  private _isRunning: boolean = false;
  private _cdpUrl: string = '';
  private _mode: 'launched' | 'connected' = 'launched';
  private _profileName: string = '';
  private _userDataDir: string = '';

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Start browser.
   * If cdpUrl is provided, connect to existing Chrome (login state shared).
   * Otherwise, launch a new Chrome with dedicated profile.
   */
  async start(options?: BrowserStartOptions): Promise<void> {
    if (this._isRunning) return;

    if (options?.cdpUrl) {
      // Connect to existing Chrome
      this._cdpUrl = options.cdpUrl;
      this._mode = 'connected';
      this._profileName = 'external';
      this._userDataDir = '';

      const conn = await connectBrowser(options.cdpUrl);
      this.setupFromConnection(conn);
      return;
    }

    // Launch new Chrome
    const exe = options?.executablePath
      ? { kind: 'chrome' as const, path: options.executablePath }
      : detectBrowserExecutable();

    if (!exe) {
      throw new Error(
        'No browser found. Please install Chrome, Brave, Edge, or Chromium.'
      );
    }

    const cdpPort = await findAvailableCdpPort(options?.cdpPort);
    const userDataDir = resolveUserDataDir('default');

    const chrome = await launchChrome(exe, cdpPort, userDataDir, options);
    this.running = chrome;
    this._cdpUrl = chrome.cdpUrl;
    this._mode = 'launched';
    this._profileName = 'default';
    this._userDataDir = userDataDir;

    chrome.proc.on('exit', () => {
      if (this.running?.pid === chrome.pid) {
        this.running = null;
        this.cleanup();
      }
    });

    // Connect Playwright via CDP
    const conn = await connectBrowser(chrome.cdpUrl);
    this.setupFromConnection(conn);
  }

  private setupFromConnection(conn: CachedConnection): void {
    const browser = conn.browser;
    const pages = browser.contexts().flatMap(c => c.pages());
    this.currentPage = pages[0] ?? null;
    this._isRunning = true;
  }

  async stop(): Promise<void> {
    // Disconnect Playwright CDP
    await disconnectBrowser();

    // Stop Chrome process if we launched it
    if (this.running) {
      await stopChrome(this.running);
      this.running = null;
    }

    this.cleanup();
  }

  private cleanup(): void {
    this.currentPage = null;
    this._isRunning = false;
  }

  // --- Page access ---

  async getPage(): Promise<Page> {
    if (!this._isRunning) {
      throw new Error('Browser is not running. Please call start() first.');
    }

    // Auto-reconnect if needed
    const conn = await connectBrowser(this._cdpUrl);
    const browser = conn.browser;

    if (!this.currentPage || this.currentPage.isClosed()) {
      const pages = browser.contexts().flatMap(c => c.pages());
      if (pages.length > 0) {
        this.currentPage = pages[0];
      } else {
        throw new Error('No pages available in the connected browser.');
      }
    }
    return this.currentPage;
  }

  getBrowser(): Browser | null {
    return cachedConnection?.browser ?? null;
  }

  getAllPages(): Page[] {
    const browser = cachedConnection?.browser;
    if (!browser) return [];
    return browser.contexts().flatMap(c => c.pages());
  }

  setCurrentPage(page: Page): void {
    this.currentPage = page;
  }

  // --- Getters ---

  isRunning(): boolean {
    return this._isRunning;
  }

  getCdpUrl(): string {
    return this._cdpUrl;
  }

  getMode(): 'launched' | 'connected' {
    return this._mode;
  }

  getProfileName(): string {
    return this._profileName;
  }

  getProfileDir(): string {
    return this._userDataDir;
  }
}
