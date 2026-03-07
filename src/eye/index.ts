/**
 * Perception Daemon Manager
 *
 * Manages the perception daemon — a single Python process that keeps the
 * camera open in memory and serves frames on demand via local HTTP API.
 *
 * Design: devices stay open, frames stay in memory, disk writes only on demand.
 * The AI calls GET /eye → daemon writes latest frame → returns path → AI sees it.
 */

import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface EyeConfig {
  /** Camera index (0 = default, auto-skips virtual cameras) */
  camera?: number;
  /** Capture interval in seconds (default: 0.5) */
  interval?: number;
  /** Whether to auto-start the eye daemon (default: false, user must opt-in) */
  autoStart?: boolean;
  /** HTTP port for the perception daemon (default: 7890) */
  port?: number;
}

export const EYE_DIR = join(homedir(), '.axon', 'eye');
export const LATEST_IMAGE = join(EYE_DIR, 'latest.png');
const PID_FILE = join(EYE_DIR, 'eye.pid');
const PORT_FILE = join(EYE_DIR, 'eye.port');
const DEFAULT_PORT = 7890;

/**
 * Find the camera.py script path.
 */
function findScript(): string | null {
  const candidates = [
    join(__dirname, 'camera.py'),                          // same dir (dist/eye/ or src/eye/)
    join(__dirname, '..', 'eye', 'camera.py'),             // sibling
    join(__dirname, '..', '..', 'src', 'eye', 'camera.py'), // project root from dist/eye/
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read the daemon port from the port file.
 */
function readPort(): number {
  if (!existsSync(PORT_FILE)) return DEFAULT_PORT;
  try {
    return parseInt(readFileSync(PORT_FILE, 'utf-8').trim(), 10) || DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Read PID from file.
 */
function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check if the daemon process is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const output = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf-8', stdio: 'pipe' });
      return output.includes(String(pid));
    } else {
      process.kill(pid, 0);
      return true;
    }
  } catch {
    return false;
  }
}

/**
 * Check if the daemon process exists (PID file + process alive).
 * This is a fast, synchronous check — does NOT verify HTTP readiness.
 */
export function isEyeProcessAlive(): boolean {
  const pid = readPid();
  if (pid === null) return false;
  return isProcessAlive(pid);
}

/**
 * Check if the daemon is fully running (process alive + HTTP responding).
 * This is async because it probes the HTTP endpoint.
 */
export async function isEyeReady(): Promise<boolean> {
  if (!isEyeProcessAlive()) return false;
  try {
    const data = await daemonRequest('/status');
    return data.daemon === 'running';
  } catch {
    return false;
  }
}

/**
 * Synchronous check — kept for backward compatibility but only checks process.
 * Prefer isEyeReady() for accurate readiness checks.
 */
export function isEyeRunning(): boolean {
  return isEyeProcessAlive();
}

/**
 * Get the daemon's HTTP base URL.
 */
export function getDaemonUrl(): string {
  return `http://127.0.0.1:${readPort()}`;
}

/**
 * Call the daemon's HTTP API.
 */
async function daemonRequest(path: string, method: 'GET' | 'POST' = 'GET'): Promise<any> {
  const url = `${getDaemonUrl()}${path}`;
  const response = await fetch(url, { method, signal: AbortSignal.timeout(5000) });
  return response.json();
}

/**
 * Request a frame from the daemon. Returns the path to latest.png.
 */
export async function captureFrame(): Promise<{
  success: boolean;
  path?: string;
  resolution?: string;
  timestamp?: string;
  error?: string;
}> {
  try {
    const data = await daemonRequest('/eye');
    if (data.error) {
      return { success: false, error: data.error };
    }
    return {
      success: true,
      path: data.path,
      resolution: data.resolution,
      timestamp: data.timestamp,
    };
  } catch (e: any) {
    return { success: false, error: `Daemon not responding: ${e.message}` };
  }
}

/**
 * Start the perception daemon.
 */
export async function startEye(config: EyeConfig = {}): Promise<{ success: boolean; message: string; pid?: number }> {
  // If process is alive, check if HTTP is also ready
  if (isEyeProcessAlive()) {
    if (await isEyeReady()) {
      const pid = readPid()!;
      return { success: true, message: 'Perception daemon already running', pid };
    }
    // Process alive but HTTP not ready — wait for it instead of spawning a new one
    const ready = await waitForDaemonReady(6000);
    if (ready) {
      const pid = readPid()!;
      return { success: true, message: 'Perception daemon is now ready', pid };
    }
    // Still not ready after waiting — kill the stale process and restart
    const stalePid = readPid();
    if (stalePid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${stalePid}`, { stdio: 'pipe' });
        } else {
          process.kill(stalePid, 'SIGKILL');
        }
      } catch { /* ignore */ }
    }
  }

  // Clean up stale files
  for (const f of [PID_FILE, PORT_FILE]) {
    if (existsSync(f)) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }

  const script = findScript();
  if (!script) {
    return { success: false, message: 'camera.py not found' };
  }

  mkdirSync(EYE_DIR, { recursive: true });

  const port = config.port ?? DEFAULT_PORT;
  const camera = config.camera ?? 0;
  const interval = config.interval ?? 0.5;

  const python = findPython();
  if (!python) {
    return { success: false, message: 'Python not found. Install Python 3.x with opencv-python' };
  }

  return new Promise((resolve) => {
    const child = spawn(python, [
      script,
      '--port', String(port),
      '--camera', String(camera),
      '--interval', String(interval),
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();

    // Wait for daemon to be ready (PID file + HTTP responding)
    const startTime = Date.now();
    const check = setInterval(async () => {
      if (Date.now() - startTime > 8000) {
        clearInterval(check);
        resolve({ success: false, message: 'Daemon failed to start within 8 seconds. Check ~/.axon/eye/eye.log' });
        return;
      }

      if (!existsSync(PID_FILE)) return;

      try {
        const data = await daemonRequest('/status');
        if (data.daemon === 'running') {
          clearInterval(check);
          resolve({
            success: true,
            message: `Perception daemon started (port=${port}, camera=${camera})`,
            pid: data.pid,
          });
        }
      } catch {
        // Not ready yet
      }
    }, 500);
  });
}

/**
 * Stop the perception daemon.
 */
export async function stopEye(): Promise<{ success: boolean; message: string }> {
  if (!isEyeRunning()) {
    // Clean up stale files
    for (const f of [PID_FILE, PORT_FILE]) {
      if (existsSync(f)) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
    return { success: true, message: 'Daemon not running' };
  }

  try {
    // Try graceful HTTP shutdown first
    await daemonRequest('/stop', 'POST');
    // Wait for process to exit
    const pid = readPid();
    if (pid) {
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        if (!isProcessAlive(pid)) break;
      }
      // Force kill if still alive
      if (isProcessAlive(pid)) {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      }
    }
    return { success: true, message: 'Daemon stopped' };
  } catch {
    // HTTP failed, try force kill via PID
    const pid = readPid();
    if (pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch { /* ignore */ }
    }
    // Clean up files
    for (const f of [PID_FILE, PORT_FILE]) {
      if (existsSync(f)) {
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
    return { success: true, message: 'Daemon force-killed' };
  }
}

/**
 * Get daemon status.
 */
export async function getEyeStatus(): Promise<Record<string, unknown>> {
  if (!isEyeRunning()) {
    return { running: false, eyeDir: EYE_DIR };
  }
  try {
    const data = await daemonRequest('/status');
    return { ...data, eyeDir: EYE_DIR, daemonUrl: getDaemonUrl() };
  } catch (e: any) {
    return { running: false, error: e.message, eyeDir: EYE_DIR };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function findPython(): string | null {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch { continue; }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for the daemon HTTP endpoint to become ready.
 */
async function waitForDaemonReady(timeoutMs: number): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      const data = await daemonRequest('/status');
      if (data.daemon === 'running') return true;
    } catch {
      // Not ready yet
    }
    await sleep(500);
  }
  return false;
}
