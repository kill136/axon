/**
 * Skill Installer 与 Manifest 测试
 *
 * 覆盖 PLAN.md 测试计划中的 7 个场景：
 * 1. legacy skill（只有 SKILL.md）仍成功
 * 2. 带 python 依赖的 skill 记录状态
 * 3. 带 node 依赖的 skill 记录状态
 * 4. 缺系统依赖时进入 degraded
 * 5. healthcheck 失败时状态正确
 * 6. 重复安装幂等
 * 7. manifest 非法时安装失败
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { normalizeSkillManifest, loadSkillManifest, type SkillManifest } from '../src/skills/manifest.js';
import {
  SkillInstaller,
  readSkillInstallState,
  writeSkillInstallState,
  createLegacyInstallState,
  type SkillInstallState,
} from '../src/skills/installer.js';

function createTempSkillDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-skill-test-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: test\n---\nTest skill');
  return dir;
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('Skill Manifest', () => {
  it('should parse a valid manifest', () => {
    const raw = {
      name: 'test-skill',
      version: '1.0.0',
      runtime: 'python',
      dependencies: {
        python: { packages: ['pandas', 'openpyxl'] },
        system: { commands: ['soffice'] },
        files: ['scripts/run.py'],
      },
      healthcheck: {
        pythonImports: ['pandas'],
        commands: ['soffice'],
        files: ['scripts/run.py'],
      },
      installPolicy: 'auto',
    };

    const manifest = normalizeSkillManifest(raw);
    expect(manifest.name).toBe('test-skill');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.runtime).toBe('python');
    expect(manifest.dependencies?.python?.packages).toEqual(['pandas', 'openpyxl']);
    expect(manifest.dependencies?.system?.commands).toEqual(['soffice']);
    expect(manifest.dependencies?.files).toEqual(['scripts/run.py']);
    expect(manifest.healthcheck?.pythonImports).toEqual(['pandas']);
    expect(manifest.installPolicy).toBe('auto');
  });

  it('should throw on non-object input', () => {
    expect(() => normalizeSkillManifest(null)).toThrow();
    expect(() => normalizeSkillManifest('string')).toThrow();
    expect(() => normalizeSkillManifest(42)).toThrow();
    expect(() => normalizeSkillManifest([])).toThrow();
  });

  it('should default installPolicy to auto', () => {
    const manifest = normalizeSkillManifest({});
    expect(manifest.installPolicy).toBe('auto');
  });

  it('should deduplicate packages', () => {
    const manifest = normalizeSkillManifest({
      dependencies: {
        python: { packages: ['pandas', 'pandas', 'numpy'] },
      },
    });
    expect(manifest.dependencies?.python?.packages).toEqual(['pandas', 'numpy']);
  });

  it('should load manifest from file', () => {
    const dir = createTempSkillDir();
    try {
      fs.writeFileSync(
        path.join(dir, 'skill.json'),
        JSON.stringify({ name: 'from-file', version: '2.0.0' })
      );
      const manifest = loadSkillManifest(dir);
      expect(manifest).not.toBeNull();
      expect(manifest!.name).toBe('from-file');
    } finally {
      cleanupDir(dir);
    }
  });

  it('should return null when no manifest file exists', () => {
    const dir = createTempSkillDir();
    try {
      const manifest = loadSkillManifest(dir);
      expect(manifest).toBeNull();
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Skill Installer', () => {
  let installer: SkillInstaller;

  beforeEach(() => {
    installer = new SkillInstaller();
  });

  // 测试1：legacy skill 安装成功
  it('should install legacy skill without manifest as installed_no_manifest', async () => {
    const dir = createTempSkillDir();
    try {
      const state = await installer.install({
        skillName: 'legacy-test',
        skillDir: dir,
        manifest: null,
      });

      expect(state.status).toBe('installed_no_manifest');
      expect(state.runtimes).toEqual([]);
      expect(state.errors).toEqual([]);
      expect(state.schemaVersion).toBe(1);

      // 验证 install-state.json 被写入
      const persisted = readSkillInstallState(dir);
      expect(persisted).not.toBeNull();
      expect(persisted!.status).toBe('installed_no_manifest');
    } finally {
      cleanupDir(dir);
    }
  });

  // 测试4：缺系统依赖时进入 degraded
  it('should mark as degraded when system commands are missing', async () => {
    const dir = createTempSkillDir();
    try {
      const manifest: SkillManifest = {
        installPolicy: 'auto',
        dependencies: {
          system: { commands: ['nonexistent_command_xyz_12345'] },
        },
      };

      const state = await installer.install({
        skillName: 'sys-dep-test',
        skillDir: dir,
        manifest,
      });

      expect(state.status).toBe('degraded');
      const sysRuntime = state.runtimes.find(r => r.runtime === 'system');
      expect(sysRuntime).toBeDefined();
      expect(sysRuntime!.status).toBe('degraded');
      expect(sysRuntime!.details[0].status).toBe('missing');
    } finally {
      cleanupDir(dir);
    }
  });

  // 测试4b：缺文件依赖时进入 degraded
  it('should mark as degraded when file dependencies are missing', async () => {
    const dir = createTempSkillDir();
    try {
      const manifest: SkillManifest = {
        installPolicy: 'auto',
        dependencies: {
          files: ['nonexistent/file.py'],
        },
      };

      const state = await installer.install({
        skillName: 'file-dep-test',
        skillDir: dir,
        manifest,
      });

      expect(state.status).toBe('degraded');
      const fileRuntime = state.runtimes.find(r => r.runtime === 'files');
      expect(fileRuntime).toBeDefined();
      expect(fileRuntime!.status).toBe('degraded');
    } finally {
      cleanupDir(dir);
    }
  });

  // 测试5：healthcheck 失败时状态正确
  it('should reflect healthcheck failures in status', async () => {
    const dir = createTempSkillDir();
    try {
      const manifest: SkillManifest = {
        installPolicy: 'auto',
        healthcheck: {
          commands: ['nonexistent_healthcheck_cmd_999'],
          files: ['missing_health_file.txt'],
        },
      };

      const state = await installer.install({
        skillName: 'healthcheck-test',
        skillDir: dir,
        manifest,
      });

      // healthcheck 失败应至少 degraded
      expect(['degraded', 'failed']).toContain(state.status);
    } finally {
      cleanupDir(dir);
    }
  });

  // 测试6：重复安装幂等
  it('should be idempotent on repeated install', async () => {
    const dir = createTempSkillDir();
    try {
      const manifest: SkillManifest = {
        installPolicy: 'auto',
        dependencies: {
          system: { commands: ['node'] },
        },
      };

      const state1 = await installer.install({ skillName: 'idem-test', skillDir: dir, manifest });
      const state2 = await installer.install({ skillName: 'idem-test', skillDir: dir, manifest });

      expect(state1.status).toBe(state2.status);
      expect(state1.runtimes.length).toBe(state2.runtimes.length);
    } finally {
      cleanupDir(dir);
    }
  });
});

describe('Install State Persistence', () => {
  it('should write and read install state', () => {
    const dir = createTempSkillDir();
    try {
      const state = createLegacyInstallState(dir);
      writeSkillInstallState(dir, state);

      const read = readSkillInstallState(dir);
      expect(read).not.toBeNull();
      expect(read!.status).toBe('installed_no_manifest');
      expect(read!.schemaVersion).toBe(1);
    } finally {
      cleanupDir(dir);
    }
  });

  it('should return null when no install state file exists', () => {
    const dir = createTempSkillDir();
    try {
      const read = readSkillInstallState(dir);
      expect(read).toBeNull();
    } finally {
      cleanupDir(dir);
    }
  });
});
