import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { SkillManifest } from './manifest.js';

export type SkillInstallStatus = 'installed' | 'degraded' | 'failed' | 'installed_no_manifest';

export interface SkillDependencyCheck {
  name: string;
  status: 'ok' | 'missing' | 'error';
  detail?: string;
}

export interface SkillRuntimeInstallState {
  runtime: 'python' | 'node' | 'system' | 'files';
  status: 'installed' | 'degraded' | 'failed' | 'skipped';
  details: SkillDependencyCheck[];
}

export interface SkillInstallState {
  schemaVersion: 1;
  status: SkillInstallStatus;
  installedAt: string;
  updatedAt: string;
  manifestVersion?: string;
  runtimes: SkillRuntimeInstallState[];
  errors: string[];
}

export interface SkillInstallerOptions {
  skillName: string;
  skillDir: string;
  manifest: SkillManifest | null;
}

const INSTALL_STATE_FILE = 'install-state.json';

function commandExists(command: string): boolean {
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checker, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function runCommand(command: string, args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function detectPythonCommand(): string | null {
  for (const candidate of ['python3', 'python']) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function detectNodePackageManager(): string | null {
  for (const candidate of ['npm']) {
    if (commandExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getPythonPaths(skillDir: string): { runtimeDir: string; venvDir: string; pythonPath: string; pipPath: string } {
  const runtimeDir = path.join(skillDir, 'runtime', 'python');
  const venvDir = path.join(runtimeDir, 'venv');
  const binDir = process.platform === 'win32' ? path.join(venvDir, 'Scripts') : path.join(venvDir, 'bin');
  return {
    runtimeDir,
    venvDir,
    pythonPath: path.join(binDir, process.platform === 'win32' ? 'python.exe' : 'python'),
    pipPath: path.join(binDir, process.platform === 'win32' ? 'pip.exe' : 'pip'),
  };
}

function getNodePaths(skillDir: string): { runtimeDir: string; packageJsonPath: string } {
  const runtimeDir = path.join(skillDir, 'runtime', 'node');
  return {
    runtimeDir,
    packageJsonPath: path.join(runtimeDir, 'package.json'),
  };
}

function installPythonDependencies(skillDir: string, packages: string[]): SkillRuntimeInstallState {
  const details: SkillDependencyCheck[] = [];
  const python = detectPythonCommand();

  if (!python) {
    for (const pkg of packages) {
      details.push({ name: pkg, status: 'missing', detail: 'python3/python not found' });
    }
    return { runtime: 'python', status: 'failed', details };
  }

  const { runtimeDir, venvDir, pythonPath, pipPath } = getPythonPaths(skillDir);
  ensureDir(runtimeDir);

  if (!fs.existsSync(pythonPath)) {
    const venvResult = runCommand(python, ['-m', 'venv', venvDir]);
    if (venvResult.status !== 0) {
      for (const pkg of packages) {
        details.push({ name: pkg, status: 'error', detail: venvResult.stderr || 'failed to create venv' });
      }
      return { runtime: 'python', status: 'failed', details };
    }
  }

  const upgradePip = runCommand(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip'], runtimeDir);
  if (upgradePip.status !== 0) {
    details.push({ name: 'pip', status: 'error', detail: upgradePip.stderr || 'failed to upgrade pip' });
  } else {
    details.push({ name: 'pip', status: 'ok', detail: 'upgraded' });
  }

  for (const pkg of packages) {
    const result = runCommand(pythonPath, ['-m', 'pip', 'install', pkg], runtimeDir);
    if (result.status === 0) {
      details.push({ name: pkg, status: 'ok' });
    } else {
      details.push({ name: pkg, status: 'error', detail: result.stderr || result.stdout || 'pip install failed' });
    }
  }

  if (!fs.existsSync(pipPath)) {
    details.push({ name: 'pip-binary', status: 'missing', detail: 'pip executable not found after setup' });
  }

  const status = details.some(item => item.status === 'error' || item.status === 'missing') ? 'failed' : 'installed';
  return { runtime: 'python', status, details };
}

function installNodeDependencies(skillDir: string, packages: string[]): SkillRuntimeInstallState {
  const details: SkillDependencyCheck[] = [];
  const npm = detectNodePackageManager();

  if (!commandExists('node') || !npm) {
    for (const pkg of packages) {
      details.push({ name: pkg, status: 'missing', detail: 'node/npm not found' });
    }
    return { runtime: 'node', status: 'failed', details };
  }

  const { runtimeDir, packageJsonPath } = getNodePaths(skillDir);
  ensureDir(runtimeDir);

  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({
        name: `axon-skill-${path.basename(skillDir)}-runtime`,
        private: true,
        version: '1.0.0',
      }, null, 2),
      'utf-8'
    );
  }

  const installArgs = ['install', '--no-audit', '--no-fund', '--save-exact', ...packages];
  const result = runCommand(npm, installArgs, runtimeDir);
  if (result.status !== 0) {
    for (const pkg of packages) {
      details.push({ name: pkg, status: 'error', detail: result.stderr || result.stdout || 'npm install failed' });
    }
    return { runtime: 'node', status: 'failed', details };
  }

  for (const pkg of packages) {
    details.push({ name: pkg, status: 'ok' });
  }

  return { runtime: 'node', status: 'installed', details };
}

function checkCommands(commands: string[]): SkillRuntimeInstallState {
  const details = commands.map(command => ({
    name: command,
    status: commandExists(command) ? 'ok' as const : 'missing' as const,
    detail: commandExists(command) ? undefined : 'command not found on PATH',
  }));

  const status = details.some(item => item.status !== 'ok') ? 'degraded' : 'installed';
  return { runtime: 'system', status, details };
}

function checkFiles(skillDir: string, files: string[]): SkillRuntimeInstallState {
  const details = files.map(file => {
    const resolved = path.resolve(skillDir, file);
    const exists = fs.existsSync(resolved);
    return {
      name: file,
      status: exists ? 'ok' as const : 'missing' as const,
      detail: exists ? resolved : `missing file: ${resolved}`,
    };
  });

  const status = details.some(item => item.status !== 'ok') ? 'degraded' : 'installed';
  return { runtime: 'files', status, details };
}

function runHealthchecks(skillDir: string, manifest: SkillManifest, runtimes: SkillRuntimeInstallState[]): void {
  const healthcheck = manifest.healthcheck;
  if (!healthcheck) {
    return;
  }

  const getRuntime = (runtime: SkillRuntimeInstallState['runtime']) => runtimes.find(item => item.runtime === runtime);

  if (healthcheck.pythonImports && healthcheck.pythonImports.length > 0) {
    let runtime = getRuntime('python');
    if (!runtime) {
      runtime = { runtime: 'python', status: 'skipped', details: [] };
      runtimes.push(runtime);
    }

    const { pythonPath } = getPythonPaths(skillDir);
    if (!fs.existsSync(pythonPath)) {
      for (const moduleName of healthcheck.pythonImports) {
        runtime.details.push({ name: `import:${moduleName}`, status: 'missing', detail: 'python runtime not installed' });
      }
      if (runtime.status === 'installed') {
        runtime.status = 'degraded';
      }
    } else {
      for (const moduleName of healthcheck.pythonImports) {
        const result = runCommand(pythonPath, ['-c', `import ${moduleName}`], skillDir);
        runtime.details.push({
          name: `import:${moduleName}`,
          status: result.status === 0 ? 'ok' : 'error',
          detail: result.status === 0 ? undefined : result.stderr || result.stdout || 'python import failed',
        });
      }
      if (runtime.details.some(item => item.status === 'error' || item.status === 'missing')) {
        runtime.status = runtime.status === 'failed' ? 'failed' : 'degraded';
      }
    }
  }

  if (healthcheck.nodeImports && healthcheck.nodeImports.length > 0) {
    let runtime = getRuntime('node');
    if (!runtime) {
      runtime = { runtime: 'node', status: 'skipped', details: [] };
      runtimes.push(runtime);
    }

    const { runtimeDir } = getNodePaths(skillDir);
    if (!fs.existsSync(path.join(runtimeDir, 'node_modules'))) {
      for (const moduleName of healthcheck.nodeImports) {
        runtime.details.push({ name: `require:${moduleName}`, status: 'missing', detail: 'node runtime not installed' });
      }
      if (runtime.status === 'installed') {
        runtime.status = 'degraded';
      }
    } else {
      for (const moduleName of healthcheck.nodeImports) {
        const result = runCommand('node', ['-e', `require(${JSON.stringify(moduleName)})`], runtimeDir);
        runtime.details.push({
          name: `require:${moduleName}`,
          status: result.status === 0 ? 'ok' : 'error',
          detail: result.status === 0 ? undefined : result.stderr || result.stdout || 'node require failed',
        });
      }
      if (runtime.details.some(item => item.status === 'error' || item.status === 'missing')) {
        runtime.status = runtime.status === 'failed' ? 'failed' : 'degraded';
      }
    }
  }

  if (healthcheck.commands && healthcheck.commands.length > 0) {
    const runtime = getRuntime('system') || { runtime: 'system', status: 'installed', details: [] };
    if (!getRuntime('system')) {
      runtimes.push(runtime);
    }
    for (const command of healthcheck.commands) {
      runtime.details.push({
        name: `command:${command}`,
        status: commandExists(command) ? 'ok' : 'missing',
        detail: commandExists(command) ? undefined : 'command not found on PATH',
      });
    }
    if (runtime.details.some(item => item.status !== 'ok')) {
      runtime.status = 'degraded';
    }
  }

  if (healthcheck.files && healthcheck.files.length > 0) {
    const runtime = getRuntime('files') || { runtime: 'files', status: 'installed', details: [] };
    if (!getRuntime('files')) {
      runtimes.push(runtime);
    }
    for (const file of healthcheck.files) {
      const resolved = path.resolve(skillDir, file);
      const exists = fs.existsSync(resolved);
      runtime.details.push({
        name: `file:${file}`,
        status: exists ? 'ok' : 'missing',
        detail: exists ? resolved : `missing file: ${resolved}`,
      });
    }
    if (runtime.details.some(item => item.status !== 'ok')) {
      runtime.status = 'degraded';
    }
  }
}

function deriveOverallStatus(runtimes: SkillRuntimeInstallState[]): SkillInstallStatus {
  if (runtimes.some(runtime => runtime.status === 'failed')) {
    return 'failed';
  }

  if (runtimes.some(runtime => runtime.status === 'degraded')) {
    return 'degraded';
  }

  return 'installed';
}

export function getSkillInstallStatePath(skillDir: string): string {
  return path.join(skillDir, INSTALL_STATE_FILE);
}

export function readSkillInstallState(skillDir: string): SkillInstallState | null {
  const filePath = getSkillInstallStatePath(skillDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SkillInstallState;
  } catch {
    return null;
  }
}

export function writeSkillInstallState(skillDir: string, state: SkillInstallState): void {
  fs.writeFileSync(getSkillInstallStatePath(skillDir), JSON.stringify(state, null, 2), 'utf-8');
}

export function createLegacyInstallState(skillDir: string): SkillInstallState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    status: 'installed_no_manifest',
    installedAt: now,
    updatedAt: now,
    runtimes: [],
    errors: [],
  };
}

export class SkillInstaller {
  async install(options: SkillInstallerOptions): Promise<SkillInstallState> {
    const now = new Date().toISOString();

    if (!options.manifest) {
      const legacy = createLegacyInstallState(options.skillDir);
      writeSkillInstallState(options.skillDir, legacy);
      return legacy;
    }

    const runtimes: SkillRuntimeInstallState[] = [];
    const errors: string[] = [];
    const dependencies = options.manifest.dependencies;

    if (dependencies?.python?.packages?.length) {
      const runtime = installPythonDependencies(options.skillDir, dependencies.python.packages);
      runtimes.push(runtime);
      if (runtime.status === 'failed') {
        errors.push('Python dependencies installation failed');
      }
    }

    if (dependencies?.node?.packages?.length) {
      const runtime = installNodeDependencies(options.skillDir, dependencies.node.packages);
      runtimes.push(runtime);
      if (runtime.status === 'failed') {
        errors.push('Node dependencies installation failed');
      }
    }

    if (dependencies?.system?.commands?.length) {
      runtimes.push(checkCommands(dependencies.system.commands));
    }

    if (dependencies?.files?.length) {
      runtimes.push(checkFiles(options.skillDir, dependencies.files));
    }

    runHealthchecks(options.skillDir, options.manifest, runtimes);

    const state: SkillInstallState = {
      schemaVersion: 1,
      status: deriveOverallStatus(runtimes),
      installedAt: now,
      updatedAt: now,
      manifestVersion: options.manifest.version,
      runtimes,
      errors,
    };

    writeSkillInstallState(options.skillDir, state);
    return state;
  }
}
