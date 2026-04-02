import * as fs from 'fs';
import * as path from 'path';

export type SkillInstallPolicy = 'auto' | 'check-only';

export interface SkillPythonManifest {
  packages?: string[];
}

export interface SkillNodeManifest {
  packages?: string[];
}

export interface SkillSystemManifest {
  commands?: string[];
}

export interface SkillDependenciesManifest {
  python?: SkillPythonManifest;
  node?: SkillNodeManifest;
  system?: SkillSystemManifest;
  files?: string[];
}

export interface SkillHealthcheckManifest {
  pythonImports?: string[];
  nodeImports?: string[];
  commands?: string[];
  files?: string[];
}

export interface SkillManifest {
  name?: string;
  version?: string;
  runtime?: string;
  installPolicy?: SkillInstallPolicy;
  dependencies?: SkillDependenciesManifest;
  healthcheck?: SkillHealthcheckManifest;
  resources?: string[];
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
}

function normalizeDependencies(value: unknown): SkillDependenciesManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const dependencies: SkillDependenciesManifest = {};

  if (record.python && typeof record.python === 'object' && !Array.isArray(record.python)) {
    const packages = normalizeStringArray((record.python as Record<string, unknown>).packages);
    if (packages) {
      dependencies.python = { packages };
    }
  }

  if (record.node && typeof record.node === 'object' && !Array.isArray(record.node)) {
    const packages = normalizeStringArray((record.node as Record<string, unknown>).packages);
    if (packages) {
      dependencies.node = { packages };
    }
  }

  if (record.system && typeof record.system === 'object' && !Array.isArray(record.system)) {
    const commands = normalizeStringArray((record.system as Record<string, unknown>).commands);
    if (commands) {
      dependencies.system = { commands };
    }
  }

  const files = normalizeStringArray(record.files);
  if (files) {
    dependencies.files = files;
  }

  return Object.keys(dependencies).length > 0 ? dependencies : undefined;
}

function normalizeHealthcheck(value: unknown): SkillHealthcheckManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const healthcheck: SkillHealthcheckManifest = {};

  const pythonImports = normalizeStringArray(record.pythonImports);
  if (pythonImports) {
    healthcheck.pythonImports = pythonImports;
  }

  const nodeImports = normalizeStringArray(record.nodeImports);
  if (nodeImports) {
    healthcheck.nodeImports = nodeImports;
  }

  const commands = normalizeStringArray(record.commands);
  if (commands) {
    healthcheck.commands = commands;
  }

  const files = normalizeStringArray(record.files);
  if (files) {
    healthcheck.files = files;
  }

  return Object.keys(healthcheck).length > 0 ? healthcheck : undefined;
}

export function normalizeSkillManifest(value: unknown): SkillManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Skill manifest must be a JSON object');
  }

  const record = value as Record<string, unknown>;
  const installPolicy = record.installPolicy === 'check-only' ? 'check-only' : 'auto';

  const manifest: SkillManifest = {
    installPolicy,
  };

  if (typeof record.name === 'string' && record.name.trim()) {
    manifest.name = record.name.trim();
  }

  if (typeof record.version === 'string' && record.version.trim()) {
    manifest.version = record.version.trim();
  }

  if (typeof record.runtime === 'string' && record.runtime.trim()) {
    manifest.runtime = record.runtime.trim();
  }

  const dependencies = normalizeDependencies(record.dependencies);
  if (dependencies) {
    manifest.dependencies = dependencies;
  }

  const healthcheck = normalizeHealthcheck(record.healthcheck);
  if (healthcheck) {
    manifest.healthcheck = healthcheck;
  }

  const resources = normalizeStringArray(record.resources);
  if (resources) {
    manifest.resources = resources;
  }

  return manifest;
}

export function getSkillManifestPath(skillDir: string): string {
  return path.join(skillDir, 'skill.json');
}

export function readSkillManifestFile(skillDir: string): { manifest: SkillManifest; raw: string } | null {
  const manifestPath = getSkillManifestPath(skillDir);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    manifest: normalizeSkillManifest(parsed),
    raw,
  };
}

export function loadSkillManifest(skillDir: string): SkillManifest | null {
  const result = readSkillManifestFile(skillDir);
  return result?.manifest ?? null;
}
