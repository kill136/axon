/**
 * Project Probe 测试
 *
 * 测试从工作目录自动推断项目信息的逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { probeProjects } from '../../src/network/project-probe.js';

describe('probeProjects', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should return project name from package.json', () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'my-awesome-project', version: '1.0.0' }),
    );

    const projects = probeProjects(testDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-awesome-project');
  });

  it('should fallback to directory name when no package.json', () => {
    // 没有 package.json 也没有 git
    const projects = probeProjects(testDir);
    expect(projects).toHaveLength(1);
    // 临时目录名是随机的，只要有值就行
    expect(projects[0].name).toBeTruthy();
  });

  it('should handle invalid package.json gracefully', () => {
    fs.writeFileSync(path.join(testDir, 'package.json'), 'not json');

    const projects = probeProjects(testDir);
    // 应该 fallback 到目录名
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBeTruthy();
  });

  it('should handle package.json without name', () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ version: '1.0.0' }),
    );

    const projects = probeProjects(testDir);
    expect(projects).toHaveLength(1);
    // 应该 fallback 到 git remote 或目录名
    expect(projects[0].name).toBeTruthy();
  });

  it('should use directory basename as project name', () => {
    const namedDir = path.join(testDir, 'my-project');
    fs.mkdirSync(namedDir);

    const projects = probeProjects(namedDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-project');
  });

  it('should extract description from package.json', () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({
        name: 'my-project',
        description: 'An awesome AI coding assistant',
        version: '1.0.0',
      }),
    );

    const projects = probeProjects(testDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('my-project');
    expect(projects[0].description).toBe('An awesome AI coding assistant');
  });

  it('should have no description when package.json lacks it', () => {
    fs.writeFileSync(
      path.join(testDir, 'package.json'),
      JSON.stringify({ name: 'no-desc-project', version: '1.0.0' }),
    );

    const projects = probeProjects(testDir);
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('no-desc-project');
    expect(projects[0].description).toBeUndefined();
  });
});
