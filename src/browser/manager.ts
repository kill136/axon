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
 * Extension relay mode (anti-detection):
 * - Chrome 137+ removed --load-extension for branded builds
 * - Uses --remote-debugging-pipe + --enable-unsafe-extension-debugging
 * - Loads extension via CDP pipe command Extensions.loadUnpacked
 * - Extension connects to relay server via WebSocket
 * - Playwright connects to relay server, which forwards CDP commands
 *   through extension's chrome.debugger API (bypasses automation detection)
 *
 * This gives us:
 * - Login state sharing (when connecting to user's Chrome)
 * - Stable CDP reconnection (if Playwright disconnects, reconnect transparently)
 * - Clean process lifecycle (we own the Chrome process we launch)
 * - Anti-detection via extension relay (navigator.webdriver stays false)
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
import { ensureChromeExtensionRelayServer, stopChromeExtensionRelayServer } from './extension-relay.js';
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
    if (await isPortAvailable(preferredPort)) return preferredPort;
  }
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available CDP port found in range ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END}.`);
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

interface LaunchChromeOptions {
  /** Enable --remote-debugging-pipe for CDP pipe commands (e.g. Extensions.loadUnpacked) */
  enablePipe?: boolean;
}

async function launchChrome(
  exe: BrowserExecutable,
  cdpPort: number,
  userDataDir: string,
  options?: BrowserStartOptions,
  launchOptions?: LaunchChromeOptions,
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

  // Relay mode: add pipe + extension debugging flags
  // Chrome 137+ requires pipe for Extensions.loadUnpacked CDP command
  if (launchOptions?.enablePipe) {
    args.push('--remote-debugging-pipe');
    args.push('--enable-unsafe-extension-debugging');
  }

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

  // When using pipe, Chrome uses fd 3 (read) and fd 4 (write)
  const stdio = launchOptions?.enablePipe
    ? ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] as const
    : 'pipe' as const;

  const proc = spawn(exe.path, args, {
    stdio: stdio as any,
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

  // Expose pipe streams if available
  if (launchOptions?.enablePipe && (proc as any).stdio) {
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
  private _cdpUrl: string = '';
  private _mode: 'launched' | 'connected' = 'launched';
  private _profileName: string = '';
  private _userDataDir: string = '';
  private _relayServer: any = null;
  private _useExtensionRelay: boolean = false;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Start browser.
   * Supports three modes:
   * 1. Direct mode (no relay): Connect to existing Chrome or launch new one, Playwright connects directly to CDP
   * 2. Pipe mode (relay + pipe): Launch Chrome with pipe, auto-load extension, Playwright connects directly (simple anti-detection)
   * 3. Extension mode (relay + user extension): User manually installed extension, relay proxies CDP, Playwright connects via relay (full anti-detection)
   */
  async start(options?: BrowserStartOptions): Promise<void> {
    if (this._isRunning) return;

    const relayMode = options?.relayMode || 'pipe';
    this._useExtensionRelay = options?.useExtensionRelay || false;

    // Extension mode: User has manually installed extension, relay proxies CDP
    if (this._useExtensionRelay && relayMode === 'extension') {
      console.log('[BrowserManager] Starting in EXTENSION mode (user-installed extension + relay proxy)');

      // Determine relay port (from cdpUrl if provided, otherwise default)
      let relayPort = 18792;
      if (options?.cdpUrl) {
        try {
          const url = new URL(options.cdpUrl);
          relayPort = parseInt(url.port, 10) || relayPort;
        } catch {
          // Invalid URL, use default
        }
      }

      // Start relay server
      const cdpUrl = `http://127.0.0.1:${relayPort}`;
      this._relayServer = await ensureChromeExtensionRelayServer({ cdpUrl });
      this._cdpUrl = cdpUrl;
      this._mode = 'connected';
      this._profileName = 'external-relay';
      this._userDataDir = '';

      console.log(`[BrowserManager] Relay server started on port ${relayPort}`);
      console.log('[BrowserManager] Waiting for extension to connect (user must click toolbar button)...');

      // Wait for extension to connect (up to 60s, since user needs to manually click)
      const maxWait = 60000;
      const pollInterval = 1000;
      let waited = 0;
      while (waited < maxWait) {
        if (this._relayServer.extensionConnected()) break;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waited += pollInterval;
        if (waited % 10000 === 0) {
          console.log(`[BrowserManager] Still waiting for extension... (${waited / 1000}s elapsed)`);
        }
      }

      if (!this._relayServer.extensionConnected()) {
        throw new Error(
          `Extension did not connect within ${maxWait / 1000}s. ` +
          `Please install the extension and click the toolbar button to attach a tab.`
        );
      }

      console.log(`[BrowserManager] Extension connected after ${waited / 1000}s`);

      // Connect Playwright to relay's CDP WebSocket
      const conn = await connectBrowser(this._relayServer.cdpWsUrl);
      this.setupFromConnection(conn);
      return;
    }

    // Direct mode or Pipe mode: Launch Chrome or connect to existing
    if (options?.cdpUrl) {
      // Connect to existing Chrome (direct mode)
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

    const profileName = options?.profileName || 'default';
    
    // Check if profile exists, if not use default settings
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

    // Ensure clean exit before starting
    ensureCleanExit(userDataDir);

    // Pipe mode: Launch Chrome with pipe + auto-load extension
    let extensionPath: string | undefined;
    if (this._useExtensionRelay && relayMode === 'pipe') {
      console.log('[BrowserManager] Starting in PIPE mode (auto-load extension via CDP pipe)');

      // Start relay server on next port
      const relayPort = cdpPort + 1;
      const relayUrl = `http://127.0.0.1:${relayPort}`;
      this._relayServer = await ensureChromeExtensionRelayServer({ cdpUrl: relayUrl });
      
      // Resolve extension directory path (works in both src/ and dist/)
      let srcDir = path.dirname(new URL(import.meta.url).pathname);
      if (process.platform === 'win32' && srcDir.startsWith('/')) {
        srcDir = srcDir.substring(1);
      }
      extensionPath = path.join(srcDir, 'extension');
      
      // If extension dir doesn't exist (e.g. dev mode), try src path
      if (!fs.existsSync(extensionPath)) {
        const altPath = path.resolve(srcDir, '..', '..', 'src', 'browser', 'extension');
        if (fs.existsSync(altPath)) {
          extensionPath = altPath;
        }
      }
      
      // Inject relay-config.json so extension can auto-connect to our relay
      const authToken = resolveRelayAuthToken(relayPort);
      const configPath = path.join(extensionPath, 'relay-config.json');
      fs.writeFileSync(configPath, JSON.stringify({ relayPort, gatewayToken: authToken }, null, 2));
      
      console.log('[BrowserManager] Extension relay mode enabled, relay port:', relayPort);
      console.log('[BrowserManager] Extension path:', extensionPath);
    }

    const chrome = await launchChrome(exe, cdpPort, userDataDir, options,
      this._useExtensionRelay && relayMode === 'pipe' ? { enablePipe: true } : undefined,
    );
    this.running = chrome;
    this._profileName = profileName;
    this._userDataDir = userDataDir;

    // Decorate profile if we have color info
    if (profileColor) {
      decorateProfile(userDataDir, profileName, profileColor);
    }

    chrome.proc.on('exit', () => {
      if (this.running?.pid === chrome.pid) {
        this.running = null;
        this.cleanup();
      }
    });

    // Pipe mode: Load extension and connect
    if (this._useExtensionRelay && relayMode === 'pipe' && this._relayServer && extensionPath) {
      // Load extension via CDP pipe (Chrome 137+ doesn't support --load-extension)
      console.log('[BrowserManager] Loading extension via CDP pipe...');
      const extId = await loadExtensionViaPipe(chrome, extensionPath);
      console.log('[BrowserManager] Extension loaded, ID:', extId);

      // Wait for extension to connect to relay (poll up to 15s)
      const relayServer = this._relayServer;
      const maxWait = 15000;
      const pollInterval = 500;
      let waited = 0;
      while (waited < maxWait) {
        if (relayServer.extensionConnected()) break;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waited += pollInterval;
      }
      if (!relayServer.extensionConnected()) {
        throw new Error(`Extension did not connect to relay within ${maxWait / 1000}s. Extension ID: ${extId}`);
      }
      console.log(`[BrowserManager] Extension connected after ${waited}ms`);

      // For pipe mode, Playwright connects directly to Chrome's CDP port (not relay).
      // The extension relay runs in the background but isn't used for CDP proxying.
      // This is the simple anti-detection mode.
      this._cdpUrl = chrome.cdpUrl;
      this._mode = 'launched';
      
      const conn = await connectBrowser(chrome.cdpUrl);
      this.setupFromConnection(conn);
    } else {
      // Direct mode: No relay, Playwright connects directly
      this._cdpUrl = chrome.cdpUrl;
      this._mode = 'launched';
      
      const conn = await connectBrowser(chrome.cdpUrl);
      this.setupFromConnection(conn);
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

    // Clean up injected relay-config.json from extension source dir (pipe mode)
    try {
      const extSourceDir = this.getExtensionSourcePath();
      const injectedConfig = path.join(extSourceDir, 'relay-config.json');
      if (fs.existsSync(injectedConfig)) {
        fs.unlinkSync(injectedConfig);
      }
    } catch { /* ignore */ }

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

  isExtensionRelayMode(): boolean {
    return this._useExtensionRelay;
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

  /**
   * Install extension to a stable directory with auto-generated config.
   * Returns the install path for the user to load in chrome://extensions.
   */
  installExtension(relayPort: number = 18792): string {
    const installDir = path.join(CONFIG_DIR, 'browser', 'extension');
    const sourcePath = this.getExtensionSourcePath();

    // Copy all extension files
    fs.mkdirSync(installDir, { recursive: true });
    const files = fs.readdirSync(sourcePath);
    for (const file of files) {
      if (file === 'relay-config.json') continue; // Don't copy old config
      const src = path.join(sourcePath, file);
      const dst = path.join(installDir, file);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, dst);
      }
    }

    // Generate relay-config.json with auth token
    const authToken = resolveRelayAuthToken(relayPort);
    const config = { relayPort, gatewayToken: authToken };
    fs.writeFileSync(path.join(installDir, 'relay-config.json'), JSON.stringify(config, null, 2));

    return installDir;
  }
}
