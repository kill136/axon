/**
 * Notebook 项目隔离测试
 * 
 * 验证不同项目路径对应不同的 project.md，
 * 而 profile.md 和 experience.md 是全局共享的。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NotebookManager, initNotebookManager, getNotebookManagerForProject, resetNotebookManager } from '../../src/memory/notebook.js';

describe('Notebook project isolation', () => {
  let configDir: string;
  let projectA: string;
  let projectB: string;
  const originalConfigDir = process.env.AXON_CONFIG_DIR;

  beforeEach(() => {
    // 创建临时配置目录和项目目录
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notebook-test-'));
    projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'project-a-'));
    projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'project-b-'));
    process.env.AXON_CONFIG_DIR = configDir;
    resetNotebookManager();
  });

  afterEach(() => {
    // 恢复环境
    if (originalConfigDir) {
      process.env.AXON_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.AXON_CONFIG_DIR;
    }
    resetNotebookManager();

    // 清理临时目录
    for (const dir of [configDir, projectA, projectB]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('different projects get different project.md paths', () => {
    const mgrA = new NotebookManager(projectA);
    const mgrB = new NotebookManager(projectB);

    const pathA = mgrA.getPath('project');
    const pathB = mgrB.getPath('project');

    expect(pathA).not.toBe(pathB);
    // Both should be under the config dir
    expect(pathA).toContain(configDir.replace(/\\/g, path.sep));
    expect(pathB).toContain(configDir.replace(/\\/g, path.sep));
  });

  it('different projects share profile.md and experience.md', () => {
    const mgrA = new NotebookManager(projectA);
    const mgrB = new NotebookManager(projectB);

    expect(mgrA.getPath('profile')).toBe(mgrB.getPath('profile'));
    expect(mgrA.getPath('experience')).toBe(mgrB.getPath('experience'));
  });

  it('writing project.md in one project does not affect another', () => {
    const mgrA = initNotebookManager(projectA);
    const mgrB = initNotebookManager(projectB);

    mgrA.write('project', '# Project A Knowledge');
    mgrB.write('project', '# Project B Knowledge');

    expect(mgrA.read('project')).toBe('# Project A Knowledge');
    expect(mgrB.read('project')).toBe('# Project B Knowledge');
  });

  it('getNotebookManagerForProject returns correct manager', () => {
    initNotebookManager(projectA);
    initNotebookManager(projectB);

    const mgrA = getNotebookManagerForProject(projectA);
    const mgrB = getNotebookManagerForProject(projectB);

    expect(mgrA).not.toBeNull();
    expect(mgrB).not.toBeNull();
    expect(mgrA!.getProjectPath()).toBe(projectA);
    expect(mgrB!.getProjectPath()).toBe(projectB);
  });

  it('getNotebookManagerForProject returns null for unknown project', () => {
    const mgr = getNotebookManagerForProject('/nonexistent/project');
    expect(mgr).toBeNull();
  });

  it('notebook API getProjectPath logic: project param takes priority over cwd', () => {
    // Simulate the backend getProjectPath logic
    function getProjectPath(query: Record<string, string>, body: Record<string, string>) {
      return query.project || body.project || process.cwd();
    }

    // With project param
    expect(getProjectPath({ project: projectA }, {})).toBe(projectA);
    // With body param
    expect(getProjectPath({}, { project: projectB })).toBe(projectB);
    // Without param, falls back to cwd
    expect(getProjectPath({}, {})).toBe(process.cwd());
  });
});
