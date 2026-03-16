/**
 * 项目探测
 *
 * 从工作目录自动推断项目信息。
 * 优先级：package.json name → git remote origin → 目录名
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { ProjectInfo } from './types.js';

/**
 * 从 git remote URL 提取仓库名
 * "https://github.com/user/repo.git" → "repo"
 * "git@github.com:user/repo.git" → "repo"
 */
function extractRepoName(url: string): string {
  // 去掉 .git 后缀
  const clean = url.replace(/\.git$/, '');
  // 取最后一段
  const parts = clean.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * 探测工作目录的项目信息
 */
export function probeProjects(cwd: string): ProjectInfo[] {
  const projects: ProjectInfo[] = [];

  // 尝试方法1：package.json
  let name: string | undefined;
  let description: string | undefined;
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') {
        name = pkg.name;
      }
      if (pkg.description && typeof pkg.description === 'string') {
        description = pkg.description;
      }
    }
  } catch {
    // ignore
  }

  // 尝试方法2：git remote
  let gitRemote: string | undefined;
  try {
    gitRemote = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();

    if (!name) {
      name = extractRepoName(gitRemote);
    }
  } catch {
    // 不是 git 仓库或没有 remote
  }

  // 尝试方法3：目录名
  if (!name) {
    name = path.basename(cwd);
  }

  if (name) {
    projects.push({
      name,
      description,
      gitRemote,
    });
  }

  return projects;
}
