/**
 * 项目主动建议系统
 *
 * 检测项目当前状态（git / 依赖 / 测试 / PR 等），
 * 返回三类信息：
 * 1. suggestions — 基于状态的行动建议（"你可能想做…"）
 * 2. capabilities — 基于项目类型的能力发现（"我能帮你…"）
 * 3. frequentTasks — 从历史会话提取的高频操作
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ConversationManager } from './conversation.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface Suggestion {
  id: string;
  icon: string;
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  prompt: string;        // 点击后发送的 prompt
  priority: number;      // 排序优先级，越高越靠前
  category: 'git' | 'error' | 'review' | 'test' | 'deps' | 'general';
}

export interface Capability {
  icon: string;
  title: string;
  titleZh: string;
  prompt: string;
}

export interface FrequentTask {
  title: string;
  count: number;
  prompt: string;
}

export interface ProjectSuggestionsResult {
  suggestions: Suggestion[];
  capabilities: Capability[];
  frequentTasks: FrequentTask[];
}

// ============================================================================
// 安全执行命令
// ============================================================================

function safeExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      cwd,
      timeout: 500,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

// ============================================================================
// 1. 状态检测 → 建议
// ============================================================================

function detectGitSuggestions(cwd: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // 检测是否是 git 仓库
  const isGit = safeExec('git rev-parse --is-inside-work-tree', cwd);
  if (isGit !== 'true') return suggestions;

  // git status
  const status = safeExec('git status --porcelain', cwd);
  if (status) {
    const lines = status.split('\n').filter(Boolean);
    const modified = lines.filter(l => l.startsWith(' M') || l.startsWith('M '));
    const untracked = lines.filter(l => l.startsWith('??'));
    const staged = lines.filter(l => /^[MADRC]/.test(l));

    if (staged.length > 0) {
      suggestions.push({
        id: 'staged-changes',
        icon: '✅',
        title: `${staged.length} staged changes — ready to commit?`,
        titleZh: `${staged.length} 个已暂存的更改 — 要提交吗？`,
        description: 'Review staged changes and create a commit',
        descriptionZh: '审查暂存的更改并创建提交',
        prompt: 'Review my staged changes and help me write a good commit message',
        priority: 90,
        category: 'git',
      });
    }

    if (modified.length > 0 && staged.length === 0) {
      suggestions.push({
        id: 'uncommitted-changes',
        icon: '📝',
        title: `${modified.length} modified files — review changes?`,
        titleZh: `${modified.length} 个文件已修改 — 要审查一下吗？`,
        description: 'Review what changed since last commit',
        descriptionZh: '看看上次提交后改了什么',
        prompt: 'Review my recent changes and check if everything looks good',
        priority: 80,
        category: 'review',
      });
    }

    if (untracked.length > 3) {
      suggestions.push({
        id: 'untracked-files',
        icon: '📁',
        title: `${untracked.length} untracked files`,
        titleZh: `${untracked.length} 个未跟踪的文件`,
        description: 'Some new files are not tracked by git',
        descriptionZh: '有些新文件还没有被 git 跟踪',
        prompt: 'Check the untracked files and help me decide which ones to add to git',
        priority: 30,
        category: 'git',
      });
    }
  }

  // 检查 remote ahead/behind
  const trackingInfo = safeExec('git rev-list --left-right --count HEAD...@{upstream}', cwd);
  if (trackingInfo) {
    const parts = trackingInfo.split('\t');
    const ahead = parseInt(parts[0]) || 0;
    const behind = parseInt(parts[1]) || 0;

    if (ahead > 0) {
      suggestions.push({
        id: 'unpushed-commits',
        icon: '⬆️',
        title: `${ahead} unpushed commit${ahead > 1 ? 's' : ''}`,
        titleZh: `${ahead} 个提交还没推送`,
        description: 'Your local branch is ahead of remote',
        descriptionZh: '本地分支领先远程分支',
        prompt: `I have ${ahead} unpushed commits. Review them and push if they look good.`,
        priority: 70,
        category: 'git',
      });
    }

    if (behind > 0) {
      suggestions.push({
        id: 'behind-remote',
        icon: '⬇️',
        title: `${behind} commits behind remote`,
        titleZh: `落后远程分支 ${behind} 个提交`,
        description: 'Your branch is behind remote, consider pulling',
        descriptionZh: '你的分支落后了，考虑拉取更新',
        prompt: 'Pull the latest changes from remote and resolve any conflicts',
        priority: 60,
        category: 'git',
      });
    }
  }

  // 检查合并冲突
  const conflicts = safeExec('git diff --name-only --diff-filter=U', cwd);
  if (conflicts) {
    const conflictFiles = conflicts.split('\n').filter(Boolean);
    if (conflictFiles.length > 0) {
      suggestions.push({
        id: 'merge-conflicts',
        icon: '⚠️',
        title: `${conflictFiles.length} merge conflict${conflictFiles.length > 1 ? 's' : ''} to resolve`,
        titleZh: `${conflictFiles.length} 个合并冲突需要解决`,
        description: 'Files with merge conflicts need attention',
        descriptionZh: '有文件存在合并冲突需要处理',
        prompt: 'Help me resolve the merge conflicts in this project',
        priority: 100,
        category: 'git',
      });
    }
  }

  return suggestions;
}

function detectProjectSuggestions(cwd: string): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // 检查 package.json 中的依赖问题
  const packageJsonPath = path.join(cwd, 'package.json');
  const nodeModulesPath = path.join(cwd, 'node_modules');

  if (fs.existsSync(packageJsonPath) && !fs.existsSync(nodeModulesPath)) {
    suggestions.push({
      id: 'missing-deps',
      icon: '📦',
      title: 'Dependencies not installed',
      titleZh: '依赖尚未安装',
      description: 'package.json exists but node_modules is missing',
      descriptionZh: '有 package.json 但没有 node_modules',
      prompt: 'Install project dependencies',
      priority: 95,
      category: 'deps',
    });
  }

  // 检查 TODO/FIXME 密度（快速扫描最近修改的文件）
  const recentTodos = safeExec(
    'git diff HEAD --unified=0 | findstr /I "TODO FIXME HACK XXX"',
    cwd,
  );
  if (!recentTodos) {
    // 在非 Windows 上用 grep
    const recentTodosUnix = safeExec(
      'git diff HEAD --unified=0 | grep -iE "TODO|FIXME|HACK|XXX"',
      cwd,
    );
    if (recentTodosUnix) {
      const count = recentTodosUnix.split('\n').filter(Boolean).length;
      if (count > 0) {
        suggestions.push({
          id: 'todos-in-changes',
          icon: '📌',
          title: `${count} TODO/FIXME in recent changes`,
          titleZh: `最近的改动中有 ${count} 个 TODO/FIXME`,
          description: 'Recent changes contain todo markers',
          descriptionZh: '最近的改动里有待办标记',
          prompt: 'Find all TODO and FIXME comments in my recent changes and help me address them',
          priority: 40,
          category: 'general',
        });
      }
    }
  }

  return suggestions;
}

// ============================================================================
// 2. 能力发现
// ============================================================================

function detectCapabilities(cwd: string): Capability[] {
  const caps: Capability[] = [];

  // 检测项目类型
  const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
  const hasCargoToml = fs.existsSync(path.join(cwd, 'Cargo.toml'));
  const hasPyproject = fs.existsSync(path.join(cwd, 'pyproject.toml')) || fs.existsSync(path.join(cwd, 'setup.py'));
  const hasGoMod = fs.existsSync(path.join(cwd, 'go.mod'));
  const hasDockerfile = fs.existsSync(path.join(cwd, 'Dockerfile'));
  const hasTsConfig = fs.existsSync(path.join(cwd, 'tsconfig.json'));

  // 通用能力
  caps.push({
    icon: '🔍',
    title: 'Explain this codebase',
    titleZh: '帮我理解这个项目',
    prompt: 'Give me an overview of this project — what it does, how it\'s structured, and the key design decisions',
  });

  caps.push({
    icon: '🐛',
    title: 'Debug an issue',
    titleZh: '帮我调试问题',
    prompt: 'Something is not working right. Help me find and fix the issue.',
  });

  caps.push({
    icon: '♻️',
    title: 'Refactor code',
    titleZh: '重构代码',
    prompt: 'Help me identify code that could be improved and refactor it',
  });

  // 项目类型特定能力
  if (hasPackageJson) {
    let pkg: any = {};
    try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8')); } catch {}

    if (pkg.scripts?.test) {
      caps.push({
        icon: '🧪',
        title: 'Run and fix tests',
        titleZh: '运行并修复测试',
        prompt: 'Run the test suite and fix any failing tests',
      });
    }

    if (pkg.scripts?.lint) {
      caps.push({
        icon: '✨',
        title: 'Fix linting issues',
        titleZh: '修复代码风格问题',
        prompt: 'Run the linter and fix all issues',
      });
    }

    const hasReact = pkg.dependencies?.react || pkg.devDependencies?.react;
    if (hasReact) {
      caps.push({
        icon: '⚛️',
        title: 'Build a React component',
        titleZh: '创建 React 组件',
        prompt: 'Help me build a new React component',
      });
    }

    const hasExpress = pkg.dependencies?.express || pkg.dependencies?.fastify || pkg.dependencies?.koa;
    if (hasExpress) {
      caps.push({
        icon: '🌐',
        title: 'Add an API endpoint',
        titleZh: '添加 API 端点',
        prompt: 'Help me add a new API endpoint',
      });
    }
  }

  if (hasTsConfig) {
    caps.push({
      icon: '🔧',
      title: 'Fix TypeScript errors',
      titleZh: '修复 TypeScript 错误',
      prompt: 'Run TypeScript type check and fix all errors',
    });
  }

  if (hasDockerfile) {
    caps.push({
      icon: '🐳',
      title: 'Optimize Docker setup',
      titleZh: '优化 Docker 配置',
      prompt: 'Review and optimize the Dockerfile',
    });
  }

  if (hasCargoToml) {
    caps.push({
      icon: '🦀',
      title: 'Run cargo check',
      titleZh: '运行 cargo check',
      prompt: 'Run cargo check and fix any compilation errors',
    });
  }

  if (hasPyproject) {
    caps.push({
      icon: '🐍',
      title: 'Run Python tests',
      titleZh: '运行 Python 测试',
      prompt: 'Run the Python test suite and fix any failures',
    });
  }

  if (hasGoMod) {
    caps.push({
      icon: '🐹',
      title: 'Run Go tests',
      titleZh: '运行 Go 测试',
      prompt: 'Run go test and fix any failures',
    });
  }

  return caps;
}

// ============================================================================
// 3. 常用任务记忆
// ============================================================================

function extractFrequentTasks(conversationManager: ConversationManager, projectPath: string): FrequentTask[] {
  try {
    // 从 session 列表中提取该项目的历史会话标题
    const sessions = conversationManager.listPersistedSessions({
      limit: 50,
      projectPath,
    });

    if (sessions.length === 0) return [];

    // 统计标题中的高频关键词模式
    const patternCounts = new Map<string, { count: number; prompt: string }>();

    const patterns: Array<{ regex: RegExp; label: string; prompt: string }> = [
      { regex: /fix|bug|error|修复|报错|bug/i, label: 'Fix bugs', prompt: 'Help me find and fix bugs in this project' },
      { regex: /test|测试/i, label: 'Run tests', prompt: 'Run the test suite and fix any failures' },
      { regex: /review|审查|code review/i, label: 'Code review', prompt: 'Review my recent code changes' },
      { regex: /refactor|重构/i, label: 'Refactor', prompt: 'Help me refactor and improve the code' },
      { regex: /add|feature|功能|新增|添加/i, label: 'Add feature', prompt: 'Help me add a new feature' },
      { regex: /deploy|部署|publish|发布/i, label: 'Deploy', prompt: 'Help me deploy or publish this project' },
      { regex: /doc|文档|readme/i, label: 'Documentation', prompt: 'Help me write or update documentation' },
      { regex: /performance|性能|优化|optimize/i, label: 'Optimize', prompt: 'Help me optimize the performance' },
      { regex: /security|安全|vulnerability/i, label: 'Security check', prompt: 'Check for security vulnerabilities' },
      { regex: /style|css|ui|界面|样式/i, label: 'UI/Styling', prompt: 'Help me improve the UI or fix styling issues' },
    ];

    for (const session of sessions) {
      const title = (session as any).title || '';
      for (const p of patterns) {
        if (p.regex.test(title)) {
          const existing = patternCounts.get(p.label);
          patternCounts.set(p.label, {
            count: (existing?.count || 0) + 1,
            prompt: p.prompt,
          });
        }
      }
    }

    // 按频次排序，取 top 5
    const sorted = Array.from(patternCounts.entries())
      .filter(([_, v]) => v.count >= 2) // 至少出现 2 次
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    return sorted.map(([title, { count, prompt }]) => ({
      title,
      count,
      prompt,
    }));
  } catch {
    return [];
  }
}

// ============================================================================
// 主入口
// ============================================================================

export async function getProjectSuggestions(
  projectPath: string,
  conversationManager: ConversationManager,
): Promise<ProjectSuggestionsResult> {
  const suggestions = [
    ...detectGitSuggestions(projectPath),
    ...detectProjectSuggestions(projectPath),
  ].sort((a, b) => b.priority - a.priority);

  const capabilities = detectCapabilities(projectPath);
  const frequentTasks = extractFrequentTasks(conversationManager, projectPath);

  return {
    suggestions: suggestions.slice(0, 5), // 最多 5 条建议
    capabilities: capabilities.slice(0, 8), // 最多 8 个能力
    frequentTasks,
  };
}
