/**
 * Browser lifecycle manager
 *
 * Architecture: Launch Chrome with CDP pipe → auto-load extension → relay server → Playwright
 *
 * CDP chain: Playwright → Relay Server → Extension (chrome.debugger API) → Chrome
 *
 * This architecture provides:
 * - Full anti-detection: Playwright never directly connects to Chrome's CDP port.
 *   All commands go through the extension's chrome.debugger API, so navigator.webdriver
 *   stays false and automation cannot be detected by websites.
 * - Zero user interaction: Extension is loaded automatically via CDP pipe command
 *   (Extensions.loadUnpacked), no manual install or toolbar click needed.
 * - Clean process lifecycle: We own the Chrome process and relay server.
 * - Stable reconnection: If Playwright disconnects from relay, it reconnects transparently.
 */

import { type ChildProcessWithoutNullStreams, spawn, execSync } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import type { BrowserStartOptions } from './types.js';
import { detectBrowserExecutable, type BrowserExecutable } from './detect.js';
import { getProfile, ensureCleanExit, decorateProfile } from './profiles.js';
import { ensureChromeExtensionRelayServer } from './extension-relay.js';
import { resolveRelayAuthToken } from './extension-relay-auth.js';

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
  /** CDP pipe for sending commands (e.g. Extensions.loadUnpacked). Only available when launched with --remote-debugging-pipe. */
  cdpPipeIn?: Writable;
  cdpPipeOut?: Readable;
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
    // Must check both CDP port AND relay port (cdpPort+1)
    if (await isPortAvailable(preferredPort) && await isPortAvailable(preferredPort + 1)) {
      return preferredPort;
    }
  }
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    // Both CDP port and relay port (port+1) must be free
    if (await isPortAvailable(port) && await isPortAvailable(port + 1)) {
      return port;
    }
  }
  throw new Error(`No available CDP+relay port pair found in range ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END}.`);
}

/**
 * Kill orphan Chrome processes from previous interrupted sessions.
 * Looks for chrome.exe processes with --user-data-dir pointing to .claude/browser.
 */
async function killOrphanChromes(): Promise<void> {
  try {
    const browserDir = path.join(os.homedir(), '.claude', 'browser').replace(/\\/g, '\\\\');
    let pids: number[] = [];

    if (process.platform === 'win32') {
      const output = execSync(
        `wmic process where "name='chrome.exe'" get commandline,processid /format:csv`,
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      );
      for (const line of output.split('\n')) {
        if (line.includes('.claude') && line.includes('browser') && line.includes('--remote-debugging-')) {
          const pidMatch = line.match(/,(\d+)\s*$/);
          if (pidMatch) pids.push(parseInt(pidMatch[1], 10));
        }
      }
      for (const pid of pids) {
        console.log(`[BrowserManager] Killing orphan Chrome PID ${pid}`);
        try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true, timeout: 3000 }); } catch { /* best effort */ }
      }
    } else {
      // Unix: pgrep + ps
      try {
        const output = execSync(
          `ps aux | grep -E 'chrome.*\\.claude.browser.*--remote-debugging-' | grep -v grep`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        for (const line of output.trim().split('\n')) {
          if (!line) continue;
          const parts = line.trim().split(/\s+/);
          if (parts[1]) pids.push(parseInt(parts[1], 10));
        }
      } catch { /* no matches */ }
      for (const pid of pids) {
        console.log(`[BrowserManager] Killing orphan Chrome PID ${pid}`);
        try { process.kill(pid, 'SIGKILL'); } catch { /* best effort */ }
      }
    }

    if (pids.length > 0) {
      console.log(`[BrowserManager] Cleaned up ${pids.length} orphan Chrome process(es)`);
      // Wait briefly for ports to be released
      await new Promise(r => setTimeout(r, 500));
    }
  } catch {
    // Best effort — don't block browser start
  }
}

/** Get auth headers for relay server (no-op for direct Chrome CDP) */
function getRelayAuthHeaders(cdpUrl: string): Record<string, string> {
  try {
    const parsed = new URL(cdpUrl);
    const host = parsed.hostname;
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return {};
    const port = parseInt(parsed.port, 10);
    if (!port || port < 1 || port > 65535) return {};
    // Check if this is a known relay server
    // The relay uses resolveRelayAuthToken(port) — if we can compute it, send it
    const token = resolveRelayAuthToken(port);
    return { 'x-claude-relay-token': token };
  } catch {
    return {};
  }
}

async function fetchCdpVersion(cdpUrl: string, timeoutMs = 1500, extraHeaders?: Record<string, string>): Promise<{ webSocketDebuggerUrl?: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers = extraHeaders || {};
    const res = await fetch(`${cdpUrl}/json/version`, { signal: ctrl.signal, headers });
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
  const headers = getRelayAuthHeaders(cdpUrl);
  const data = await fetchCdpVersion(cdpUrl, timeoutMs, Object.keys(headers).length > 0 ? headers : undefined);
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
    const authHeaders = getRelayAuthHeaders(normalized);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeout = 5000 + attempt * 2000;
        const wsUrl = await getChromeWebSocketUrl(normalized, timeout).catch(() => null);
        const endpoint = wsUrl ?? normalized;

        const { chromium } = await import('playwright-core');
        const connectOpts: { timeout: number; headers?: Record<string, string> } = { timeout };
        if (Object.keys(authHeaders).length > 0) {
          connectOpts.headers = authHeaders;
        }
        const browser = await chromium.connectOverCDP(endpoint, connectOpts);

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
    // CDP pipe for loading extension via Extensions.loadUnpacked
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
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

  // Chrome uses fd 3 (read) and fd 4 (write) for CDP pipe
  const proc = spawn(exe.path, args, {
    stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] as any,
    env: { ...process.env, HOME: os.homedir() },
  });

  const cdpUrl = `http://127.0.0.1:${cdpPort}`;

  // Wait for CDP HTTP endpoint to come up
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await isCdpReachable(cdpUrl, 500)) {
      break;
    }
    if (proc.exitCode !== null) {
      throw new Error(`Chrome exited with code ${proc.exitCode} before CDP became ready.`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!(await isCdpReachable(cdpUrl, 500))) {
    killProc(proc);
    throw new Error(`Chrome CDP did not become reachable at ${cdpUrl} within 15s.`);
  }

  const result: RunningChrome = {
    pid: proc.pid ?? -1,
    exe,
    userDataDir,
    cdpPort,
    cdpUrl,
    proc,
  };

  // Expose CDP pipe streams (fd 3 = write to Chrome, fd 4 = read from Chrome)
  if ((proc as any).stdio) {
    result.cdpPipeIn = (proc as any).stdio[3] as Writable;
    result.cdpPipeOut = (proc as any).stdio[4] as Readable;

    // Start consuming pipe data immediately to prevent buffer backpressure.
    // Without this, Chrome's pipe output can fill up and block.
    result.cdpPipeOut.on('data', () => {
      // Data is processed by sendCdpViaPipe listeners
    });
  }

  return result;
}

// --- CDP over pipe helpers ---

let pipeMessageId = 1;

/** Send a CDP command via pipe and wait for response */
async function sendCdpViaPipe(
  chrome: RunningChrome,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15000,
): Promise<unknown> {
  if (!chrome.cdpPipeIn || !chrome.cdpPipeOut) {
    throw new Error('CDP pipe not available. Chrome was not launched with enablePipe.');
  }

  return new Promise((resolve, reject) => {
    const id = pipeMessageId++;
    const timer = setTimeout(() => {
      chrome.cdpPipeOut!.removeListener('data', onData);
      reject(new Error(`CDP pipe timeout: ${method}`));
    }, timeoutMs);

    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\0')) !== -1) {
        const msgStr = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const msg = JSON.parse(msgStr);
          if (msg.id === id) {
            clearTimeout(timer);
            chrome.cdpPipeOut!.removeListener('data', onData);
            if (msg.error) {
              reject(new Error(`CDP ${method}: ${msg.error.message}`));
            } else {
              resolve(msg.result);
            }
          }
        } catch {
          // ignore parse errors for other messages
        }
      }
    };

    chrome.cdpPipeOut!.on('data', onData);
    chrome.cdpPipeIn!.write(JSON.stringify({ id, method, params }) + '\0');
  });
}

/** Load an unpacked extension via CDP pipe (Chrome 137+ branded builds) */
async function loadExtensionViaPipe(chrome: RunningChrome, extensionPath: string): Promise<string> {
  const result = await sendCdpViaPipe(chrome, 'Extensions.loadUnpacked', { path: extensionPath }) as { id: string };
  return result.id;
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
  /** Pages claimed by session controllers — other sessions must not reuse them */
  private claimedPages: Set<Page> = new Set();
  private _cdpUrl: string = '';
  private _profileName: string = '';
  private _userDataDir: string = '';
  private _relayServer: any = null;
  private _extensionPath: string = '';
  private _starting: boolean = false;

  private constructor() {
    // 注册进程退出清理：确保 Chrome 子进程不会成为孤儿进程
    const cleanup = () => {
      if (this.running) {
        try {
          killProc(this.running.proc);
        } catch { /* best effort */ }
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Start browser with full anti-detection via extension relay.
   *
   * Flow:
   * 1. Start relay server on cdpPort + 1
   * 2. Inject relay config into extension's background.js
   * 3. Launch Chrome with --remote-debugging-pipe
   * 4. Load extension via CDP pipe command (Extensions.loadUnpacked)
   * 5. Extension auto-connects to relay, auto-attaches all tabs
   * 6. Playwright connects to relay's CDP WebSocket (not Chrome directly)
   *
   * Result: Playwright → Relay → Extension → chrome.debugger API → Chrome
   * Websites cannot detect automation.
   */
  async start(options?: BrowserStartOptions): Promise<void> {
    if (this._isRunning) {
      // Verify extension is still connected; if not, force restart
      if (this._relayServer && !this._relayServer.extensionConnected()) {
        console.warn('[BrowserManager] Extension disconnected. Restarting browser...');
        await this.stop();
        // Fall through to full start
      } else {
        return;
      }
    }
    if (this._starting) throw new Error('Browser is already starting. Please wait.');
    this._starting = true;

    try {
    // Kill orphan Chrome processes from previous crashed sessions
    await killOrphanChromes();

    // Clean up any orphaned Chrome from a previous interrupted start
    if (this.running) {
      try { killProc(this.running.proc); } catch { /* best effort */ }
      this.running = null;
    }
    if (this._relayServer) {
      try { await this._relayServer.stop(); } catch { /* best effort */ }
      this._relayServer = null;
    }

    // --- Resolve browser executable ---
    const exe = options?.executablePath
      ? { kind: 'chrome' as const, path: options.executablePath }
      : detectBrowserExecutable();

    if (!exe) {
      throw new Error(
        'No browser found. Please install Chrome, Brave, Edge, or Chromium.'
      );
    }

    // --- Resolve profile ---
    const profileName = options?.profileName || 'default';
    const profile = getProfile(profileName);
    let cdpPort: number;
    let userDataDir: string;
    let profileColor: string | undefined;

    if (profile) {
      cdpPort = profile.cdpPort;
      userDataDir = profile.userDataDir;
      profileColor = profile.color;
    } else {
      cdpPort = await findAvailableCdpPort(options?.cdpPort);
      userDataDir = resolveUserDataDir(profileName);
    }

    ensureCleanExit(userDataDir);

    // --- Remove stale lockfile to prevent Chrome startup issues ---
    const lockfile = path.join(userDataDir, 'lockfile');
    if (fs.existsSync(lockfile)) {
      try {
        fs.unlinkSync(lockfile);
        console.log('[BrowserManager] Removed stale lockfile');
      } catch {
        // Chrome may still be holding it; ignore
      }
    }

    // --- Start relay server ---
    const relayPort = cdpPort + 1;
    const relayUrl = `http://127.0.0.1:${relayPort}`;
    this._relayServer = await ensureChromeExtensionRelayServer({ cdpUrl: relayUrl });
    console.log('[BrowserManager] Relay server started on port', relayPort);

    // --- Resolve extension path ---
    let srcDir = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === 'win32' && srcDir.startsWith('/')) {
      srcDir = srcDir.substring(1);
    }
    let extensionPath = path.join(srcDir, 'extension');
    if (!fs.existsSync(extensionPath)) {
      const altPath = path.resolve(srcDir, '..', '..', 'src', 'browser', 'extension');
      if (fs.existsSync(altPath)) {
        extensionPath = altPath;
      }
    }
    this._extensionPath = extensionPath;

    // --- Inject relay config into extension ---
    const authToken = resolveRelayAuthToken(relayPort);
    const bgPath = path.join(extensionPath, 'background.js');
    let bgContent = fs.readFileSync(bgPath, 'utf-8');
    bgContent = bgContent.replace(
      /\/\/ __RELAY_CONFIG_START__[\s\S]*?\/\/ __RELAY_CONFIG_END__/,
      `// __RELAY_CONFIG_START__ (do not edit - replaced by installExtension)\n` +
      `const INJECTED_RELAY_PORT = ${relayPort};\n` +
      `const INJECTED_GATEWAY_TOKEN = ${JSON.stringify(authToken)};\n` +
      `// __RELAY_CONFIG_END__`
    );
    fs.writeFileSync(bgPath, bgContent);
    console.log('[BrowserManager] Extension config injected, path:', extensionPath);

    // --- Launch Chrome ---
    const chrome = await launchChrome(exe, cdpPort, userDataDir, options);
    this.running = chrome;
    this._profileName = profileName;
    this._userDataDir = userDataDir;

    if (profileColor) {
      decorateProfile(userDataDir, profileName, profileColor);
    }

    chrome.proc.on('exit', () => {
      if (this.running?.pid === chrome.pid) {
        this.running = null;
        this.cleanup();
      }
    });

    // --- Load extension via CDP pipe ---
    console.log('[BrowserManager] Loading extension via CDP pipe...');
    const extId = await loadExtensionViaPipe(chrome, extensionPath);
    console.log('[BrowserManager] Extension loaded, ID:', extId);

    // --- Wait for extension service worker to start and connect to relay ---
    const maxWait = 15000;
    const pollInterval = 500;
    let waited = 0;
    let reloadAttempted = false;

    while (waited < maxWait) {
      if (this._relayServer.extensionConnected()) break;
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      waited += pollInterval;

      // At 5s mark: check if service worker is running; if not, reload extension
      if (waited >= 5000 && !reloadAttempted) {
        reloadAttempted = true;
        try {
          const targets = await sendCdpViaPipe(chrome, 'Target.getTargets') as {
            targetInfos: Array<{ targetId: string; type: string; url: string }>;
          };
          const swTargets = targets.targetInfos?.filter(
            (t: any) => t.type === 'service_worker' && t.url?.includes(extId),
          ) || [];

          if (swTargets.length === 0) {
            console.warn('[BrowserManager] No extension SW found after 5s, reloading extension...');
            try {
              await loadExtensionViaPipe(chrome, extensionPath);
              console.log('[BrowserManager] Extension reloaded');
            } catch (reloadErr: any) {
              console.warn('[BrowserManager] Extension reload failed:', reloadErr.message);
            }
          } else {
            console.log(`[BrowserManager] SW running but not connected to relay yet (url: ${swTargets[0].url})`);
          }
        } catch { /* ignore diagnostic errors */ }
      }

      if (waited % 5000 === 0 && waited > 0) {
        console.log(`[BrowserManager] Waiting for extension connection... ${waited / 1000}s`);
      }
    }

    if (!this._relayServer.extensionConnected()) {
      // Final diagnostic
      try {
        const targets = await sendCdpViaPipe(chrome, 'Target.getTargets') as {
          targetInfos: Array<{ type: string; url: string }>;
        };
        const types = targets.targetInfos?.map((t: any) => `${t.type}:${t.url?.substring(0, 60)}`).join(' | ') || 'none';
        console.error(`[BrowserManager] Extension connection timeout. Chrome targets: ${types}`);
      } catch { /* ignore */ }
      throw new Error(`Extension did not connect to relay within ${maxWait / 1000}s. Extension ID: ${extId}`);
    }
    console.log(`[BrowserManager] Extension connected to relay after ${waited}ms`);

    // --- Wait for at least one tab to be attached ---
    const targetMaxWait = 10000;
    let targetWaited = 0;
    while (targetWaited < targetMaxWait) {
      if (this._relayServer.targetCount() > 0) break;
      await new Promise(resolve => setTimeout(resolve, 500));
      targetWaited += 500;
    }
    if (this._relayServer.targetCount() > 0) {
      console.log(`[BrowserManager] ${this._relayServer.targetCount()} tab(s) attached via extension`);
    } else {
      console.warn('[BrowserManager] No tabs attached yet, Playwright will wait for first tab');
    }

    // --- Connect Playwright to relay (NOT directly to Chrome) ---
    this._cdpUrl = this._relayServer.cdpWsUrl;
    const conn = await connectBrowser(this._relayServer.cdpWsUrl);
    this.setupFromConnection(conn);
    console.log('[BrowserManager] Playwright connected to relay. Anti-detection active.');
    } finally {
      this._starting = false;
    }
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

    // Stop relay server if running
    if (this._relayServer) {
      await this._relayServer.stop();
      this._relayServer = null;
    }

    // NOTE: We intentionally do NOT reset background.js to port=0 on stop.
    // Chrome may cache the service worker, so leaving the last valid config
    // prevents a stale SW from running with port=0. start() always re-injects
    // the correct config before launching Chrome.

    this.cleanup();
  }

  private cleanup(): void {
    this.currentPage = null;
    this.claimedPages.clear();
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

  /** Mark a page as claimed by a session controller */
  claimPage(page: Page): void {
    this.claimedPages.add(page);
  }

  /** Release a page claim (when session stops or tab closes) */
  releasePage(page: Page): void {
    this.claimedPages.delete(page);
  }

  /** Check if a page is already claimed by another session */
  isPageClaimed(page: Page): boolean {
    return this.claimedPages.has(page);
  }

  // --- Getters ---

  isRunning(): boolean {
    return this._isRunning;
  }

  getCdpUrl(): string {
    return this._cdpUrl;
  }

  getProfileName(): string {
    return this._profileName;
  }

  getProfileDir(): string {
    return this._userDataDir;
  }

  isExtensionConnected(): boolean {
    if (!this._relayServer) return false;
    return this._relayServer.extensionConnected();
  }

  // --- Extension install helpers ---

  /** Get the source extension directory path (in dist/ or src/) */
  getExtensionSourcePath(): string {
    let srcDir = path.dirname(new URL(import.meta.url).pathname);
    if (process.platform === 'win32' && srcDir.startsWith('/')) {
      srcDir = srcDir.substring(1);
    }
    const distPath = path.join(srcDir, 'extension');
    if (fs.existsSync(distPath)) return distPath;

    const altPath = path.resolve(srcDir, '..', '..', 'src', 'browser', 'extension');
    if (fs.existsSync(altPath)) return altPath;

    throw new Error('Extension source directory not found.');
  }

}
