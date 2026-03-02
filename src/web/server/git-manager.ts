/**
 * Git 管理器
 * 封装所有 git 命令操作
 */

import { execSync, execFileSync } from 'child_process';

/**
 * Git 操作统一返回格式
 */
export interface GitResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Git 状态信息
 */
export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  conflicts: string[];
  recentCommits: GitCommit[];
  stashCount: number;
  remoteStatus: {
    ahead: number;
    behind: number;
    remote?: string;
    branch?: string;
  };
  tags: string[];
  currentBranch: string;
}

/**
 * Git Commit 信息
 */
export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  parents: string[];
  refs: string[];
}

/**
 * Git Branch 信息
 */
export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

/**
 * Git Stash 信息
 */
export interface GitStash {
  index: number;
  message: string;
  date: string;
}

/**
 * Git Diff 信息
 */
export interface GitDiff {
  file?: string;
  content: string;
}

/**
 * Git Manager 类
 */
export class GitManager {
  private cwd: string;
  private readonly timeout = 10000; // 10秒超时

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  /**
   * 执行 git 命令（内部方法）
   */
  private execGit(command: string): string {
    try {
      return execSync(`git ${command}`, {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: this.timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (error: any) {
      // 捕获 stderr 并抛出
      const stderr = error.stderr?.toString() || error.message || String(error);
      throw new Error(stderr);
    }
  }

  /**
   * 获取完整 git 状态
   */
  getStatus(): GitResult<GitStatus> {
    try {
      // 获取当前分支
      const currentBranch = this.execGit('branch --show-current');

      // 获取状态（短格式，-uall 展开未跟踪目录中的文件，与 VS Code 一致）
      const statusOutput = this.execGit('status --porcelain -uall');
      
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];
      const conflicts: string[] = [];

      // 解析 status 输出
      // 每个文件以 "状态标记 文件名" 格式存储（如 "M src/foo.ts"、"D bar.ts"）
      // 前端用第一个字符判断状态标记，用 substring(2) 获取文件名
      statusOutput.split('\n').forEach(line => {
        if (!line) return;
        
        const x = line[0]; // index 状态
        const y = line[1]; // working tree 状态
        const file = line.substring(3);

        // 冲突文件
        if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
          conflicts.push(file);
        }
        // 暂存区文件（带状态前缀）
        else if (x !== ' ' && x !== '?') {
          staged.push(`${x} ${file}`);
        }
        // 未暂存修改文件（带状态前缀）
        if (y === 'M' || y === 'D') {
          unstaged.push(`${y} ${file}`);
        }
        // 未跟踪文件（不带前缀，前端统一标记为 U）
        if (x === '?' && y === '?') {
          untracked.push(file);
        }
      });

      // 获取最近5条 commit
      const recentCommits = this.getLog(5).data || [];

      // 获取 stash 数量
      let stashCount = 0;
      try {
        const stashList = this.execGit('stash list');
        stashCount = stashList ? stashList.split('\n').length : 0;
      } catch {
        stashCount = 0;
      }

      // 获取远程状态
      let remoteStatus = {
        ahead: 0,
        behind: 0,
        remote: undefined as string | undefined,
        branch: undefined as string | undefined,
      };

      try {
        const remoteBranch = this.execGit('rev-parse --abbrev-ref @{upstream}');
        const [remote, branch] = remoteBranch.split('/');
        remoteStatus.remote = remote;
        remoteStatus.branch = branch;

        // 获取 ahead/behind
        const revList = this.execGit(`rev-list --left-right --count ${remoteBranch}...HEAD`);
        const [behind, ahead] = revList.split('\t').map(Number);
        remoteStatus.ahead = ahead || 0;
        remoteStatus.behind = behind || 0;
      } catch {
        // 没有远程分支或无法获取，使用默认值
      }

      // 获取 tags
      let tags: string[] = [];
      try {
        const tagsOutput = this.execGit('tag --points-at HEAD');
        tags = tagsOutput ? tagsOutput.split('\n') : [];
      } catch {
        tags = [];
      }

      return {
        success: true,
        data: {
          staged,
          unstaged,
          untracked,
          conflicts,
          recentCommits,
          stashCount,
          remoteStatus,
          tags,
          currentBranch,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取 commit 历史
   */
  getLog(limit: number = 50): GitResult<GitCommit[]> {
    try {
      // 格式：hash, parents, shortHash, author, date, message, refs
      const format = '%H%n%P%n%h%n%an%n%ai%n%s%n%D%n--END--';
      const output = this.execGit(`log -${limit} --format="${format}"`);

      const commits: GitCommit[] = [];
      const entries = output.split('--END--\n').filter(e => e.trim());

      for (const entry of entries) {
        const lines = entry.trim().split('\n');
        if (lines.length >= 7) {
          // 解析 parents（空格分隔的 hash 列表）
          const parents = lines[1].trim() ? lines[1].trim().split(' ') : [];
          // 解析 refs（逗号分隔，可能为空）
          const refsStr = lines[6].trim();
          const refs = refsStr ? refsStr.split(',').map(r => r.trim()) : [];
          
          commits.push({
            hash: lines[0],
            shortHash: lines[2],
            author: lines[3],
            date: lines[4],
            message: lines[5],
            parents,
            refs,
          });
        }
      }

      return {
        success: true,
        data: commits,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取分支列表
   */
  getBranches(): GitResult<GitBranch[]> {
    try {
      // 使用 git branch -a 获取所有分支（兼容 Windows，避免 --format 中 % 被 cmd.exe 解析）
      const output = this.execGit('branch -a');
      const branches: GitBranch[] = [];

      for (const line of output.split('\n')) {
        if (!line.trim()) continue;

        const isCurrent = line.startsWith('*');
        let name = line.replace(/^\*?\s+/, '').trim();

        // 跳过 HEAD -> 指针
        if (name.includes('->')) continue;

        // 判断是否为远程分支
        const isRemote = name.startsWith('remotes/');
        if (isRemote) {
          name = name.replace(/^remotes\//, '');
        }

        branches.push({
          name,
          current: isCurrent,
          remote: isRemote,
        });
      }

      return {
        success: true,
        data: branches,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取 stash 列表
   */
  getStashes(): GitResult<GitStash[]> {
    try {
      // 使用 git stash list 默认格式（兼容 Windows，避免 --format 中 % 被 cmd.exe 解析）
      // 默认格式: stash@{0}: WIP on branch: hash message
      const output = this.execGit('stash list');
      
      if (!output) {
        return {
          success: true,
          data: [],
        };
      }

      const stashes = output.split('\n').filter(Boolean).map(line => {
        // 解析默认格式: "stash@{0}: On branch: message" 或 "stash@{0}: WIP on branch: hash message"
        const indexMatch = line.match(/stash@\{(\d+)\}/);
        const index = indexMatch ? parseInt(indexMatch[1]) : 0;
        
        // 提取冒号后面的消息部分
        const colonIndex = line.indexOf(':');
        const message = colonIndex >= 0 ? line.substring(colonIndex + 1).trim() : line;
        
        return {
          index,
          message,
          date: '', // 默认格式不含日期，留空
        };
      });

      return {
        success: true,
        data: stashes,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 暂存文件
   */
  stage(files: string[]): GitResult {
    try {
      if (files.length === 0) {
        return {
          success: false,
          error: '没有指定要暂存的文件',
        };
      }

      // 使用 -- 分隔符确保文件名安全
      const fileArgs = files.map(f => `"${f}"`).join(' ');
      this.execGit(`add -- ${fileArgs}`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 暂存所有文件（包括新文件和修改）
   */
  stageAll(): GitResult {
    try {
      this.execGit('add -A');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 取消暂存
   */
  unstage(files: string[]): GitResult {
    try {
      if (files.length === 0) {
        return {
          success: false,
          error: '没有指定要取消暂存的文件',
        };
      }

      const fileArgs = files.map(f => `"${f}"`).join(' ');
      this.execGit(`reset HEAD -- ${fileArgs}`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 提交
   */
  commit(message: string): GitResult {
    try {
      if (!message || !message.trim()) {
        return {
          success: false,
          error: '提交信息不能为空',
        };
      }

      // 通过 stdin 传递 commit message（-F -），彻底避免 Windows 命令行对括号、!、& 等特殊字符的转义问题
      execFileSync('git', ['commit', '-F', '-'], {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: this.timeout,
        input: message,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        success: true,
      };
    } catch (error: any) {
      const stderr = error.stderr || '';
      return {
        success: false,
        error: stderr || error.message || String(error),
      };
    }
  }

  /**
   * 推送
   */
  push(): GitResult {
    try {
      // 使用 origin HEAD 避免本地分支名和远程跟踪分支名不匹配的问题
      this.execGit('push origin HEAD');

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 拉取
   */
  pull(): GitResult {
    try {
      this.execGit('pull');

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 切换分支
   */
  checkout(branch: string): GitResult {
    try {
      if (!branch || !branch.trim()) {
        return {
          success: false,
          error: '分支名不能为空',
        };
      }

      this.execGit(`checkout "${branch}"`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 创建分支
   */
  createBranch(name: string): GitResult {
    try {
      if (!name || !name.trim()) {
        return {
          success: false,
          error: '分支名不能为空',
        };
      }

      this.execGit(`branch "${name}"`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 删除分支
   */
  deleteBranch(name: string): GitResult {
    try {
      if (!name || !name.trim()) {
        return {
          success: false,
          error: '分支名不能为空',
        };
      }

      this.execGit(`branch -d "${name}"`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Stash save
   */
  stashSave(message?: string): GitResult {
    try {
      const cmd = message ? `stash push -m "${message.replace(/"/g, '\\"')}"` : 'stash push';
      this.execGit(cmd);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Stash pop
   */
  stashPop(index: number = 0): GitResult {
    try {
      this.execGit(`stash pop stash@{${index}}`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Stash drop
   */
  stashDrop(index: number): GitResult {
    try {
      this.execGit(`stash drop stash@{${index}}`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * Stash apply
   */
  stashApply(index: number): GitResult {
    try {
      this.execGit(`stash apply stash@{${index}}`);

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取 diff
   */
  getDiff(file?: string): GitResult<GitDiff> {
    try {
      const cmd = file ? `diff "${file}"` : 'diff';
      const content = this.execGit(cmd);

      return {
        success: true,
        data: {
          file,
          content,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取单个 commit 详情
   */
  getCommitDetail(hash: string): GitResult<GitCommit & { diff: string }> {
    try {
      if (!hash || !hash.trim()) {
        return {
          success: false,
          error: 'commit hash 不能为空',
        };
      }

      // 获取 commit 信息（包含 parents 和 refs）
      const format = '%H%n%P%n%h%n%an%n%ai%n%s%n%D';
      const infoOutput = this.execGit(`show -s --format="${format}" "${hash}"`);
      const lines = infoOutput.split('\n');

      if (lines.length < 7) {
        return {
          success: false,
          error: '无法获取 commit 信息',
        };
      }

      // 解析 parents 和 refs
      const parents = lines[1].trim() ? lines[1].trim().split(' ') : [];
      const refsStr = lines[6].trim();
      const refs = refsStr ? refsStr.split(',').map(r => r.trim()) : [];

      // 获取 diff
      const diff = this.execGit(`show "${hash}"`);

      return {
        success: true,
        data: {
          hash: lines[0],
          shortHash: lines[2],
          author: lines[3],
          date: lines[4],
          message: lines[5],
          parents,
          refs,
          diff,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取 commit 涉及的文件列表（带状态）
   */
  getCommitFiles(hash: string): GitResult<{ files: { status: string; file: string }[] }> {
    try {
      if (!hash || !hash.trim()) {
        return { success: false, error: 'commit hash 不能为空' };
      }
      const output = this.execGit(`diff-tree --no-commit-id --name-status -r "${hash}"`);
      const files = output.split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        return { status: parts[0] || '?', file: parts.slice(1).join('\t') };
      });
      return { success: true, data: { files } };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 获取某个 commit 中特定文件的 diff
   */
  getCommitFileDiff(hash: string, file: string): GitResult<{ content: string; file: string }> {
    try {
      if (!hash || !hash.trim()) {
        return { success: false, error: 'commit hash 不能为空' };
      }
      if (!file || !file.trim()) {
        return { success: false, error: '文件路径不能为空' };
      }
      const output = this.execGit(`diff "${hash}~1" "${hash}" -- "${file}"`);
      return { success: true, data: { content: output, file } };
    } catch (error: any) {
      // 对于首次 commit（没有 parent），使用 diff-tree
      try {
        const output = this.execGit(`show "${hash}" -- "${file}"`);
        return { success: true, data: { content: output, file } };
      } catch {
        return { success: false, error: error.message || String(error) };
      }
    }
  }

  /**
   * ========== Git Enhanced Features - Core Workflow ==========
   */

  /**
   * Merge 分支合并
   */
  merge(branch: string, strategy?: 'no-ff' | 'squash' | 'ff-only' | 'default'): GitResult {
    try {
      if (!branch || !branch.trim()) {
        return {
          success: false,
          error: '分支名不能为空',
        };
      }

      let cmd = `merge "${branch}"`;
      if (strategy === 'no-ff') {
        cmd = `merge --no-ff "${branch}"`;
      } else if (strategy === 'squash') {
        cmd = `merge --squash "${branch}"`;
      } else if (strategy === 'ff-only') {
        cmd = `merge --ff-only "${branch}"`;
      }

      this.execGit(cmd);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Rebase 变基
   */
  rebase(branch: string, onto?: string): GitResult {
    try {
      if (!branch || !branch.trim()) {
        return {
          success: false,
          error: '分支名不能为空',
        };
      }

      let cmd = `rebase "${branch}"`;
      if (onto) {
        cmd = `rebase --onto "${onto}" "${branch}"`;
      }

      this.execGit(cmd);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Merge 中止
   */
  mergeAbort(): GitResult {
    try {
      this.execGit('merge --abort');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Rebase 继续
   */
  rebaseContinue(): GitResult {
    try {
      this.execGit('rebase --continue');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Rebase 中止
   */
  rebaseAbort(): GitResult {
    try {
      this.execGit('rebase --abort');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Reset 操作
   */
  reset(commit: string, mode: 'soft' | 'mixed' | 'hard'): GitResult {
    try {
      if (!commit || !commit.trim()) {
        return {
          success: false,
          error: 'Commit hash 不能为空',
        };
      }

      this.execGit(`reset --${mode} "${commit}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Discard 单个文件的更改
   */
  discardFile(file: string): GitResult {
    try {
      if (!file || !file.trim()) {
        return {
          success: false,
          error: '文件名不能为空',
        };
      }

      // 使用 checkout -- 丢弃工作区更改
      this.execGit(`checkout -- "${file}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Discard 所有更改
   */
  discardAll(): GitResult {
    try {
      // 丢弃所有工作区和暂存区的更改
      this.execGit('reset --hard HEAD');
      // 清理未跟踪的文件
      this.execGit('clean -fd');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Unstage 所有文件
   */
  unstageAll(): GitResult {
    try {
      this.execGit('reset HEAD');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Amend 修改上次提交
   */
  amendCommit(message: string): GitResult {
    try {
      if (!message || !message.trim()) {
        return {
          success: false,
          error: '提交信息不能为空',
        };
      }

      // 通过 stdin 传递 commit message
      execFileSync('git', ['commit', '--amend', '-F', '-'], {
        cwd: this.cwd,
        encoding: 'utf-8',
        timeout: this.timeout,
        input: message,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return { success: true };
    } catch (error: any) {
      const stderr = error.stderr || '';
      return {
        success: false,
        error: stderr || error.message || String(error),
      };
    }
  }

  /**
   * Revert 撤销某个提交
   */
  revertCommit(hash: string): GitResult {
    try {
      if (!hash || !hash.trim()) {
        return {
          success: false,
          error: 'Commit hash 不能为空',
        };
      }

      this.execGit(`revert --no-edit "${hash}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Cherry-pick 挑选提交
   */
  cherryPick(hash: string): GitResult {
    try {
      if (!hash || !hash.trim()) {
        return {
          success: false,
          error: 'Commit hash 不能为空',
        };
      }

      this.execGit(`cherry-pick "${hash}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 获取冲突文件内容
   */
  getConflicts(file: string): GitResult<{ file: string; ours: string; theirs: string; base?: string }> {
    try {
      if (!file || !file.trim()) {
        return {
          success: false,
          error: '文件名不能为空',
        };
      }

      // 获取 ours (当前分支版本)
      let ours = '';
      try {
        ours = this.execGit(`show :2:"${file}"`);
      } catch {
        ours = '';
      }

      // 获取 theirs (合并分支版本)
      let theirs = '';
      try {
        theirs = this.execGit(`show :3:"${file}"`);
      } catch {
        theirs = '';
      }

      // 获取 base (共同祖先版本)
      let base = '';
      try {
        base = this.execGit(`show :1:"${file}"`);
      } catch {
        base = '';
      }

      return {
        success: true,
        data: {
          file,
          ours,
          theirs,
          base,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取 Merge/Rebase 状态
   */
  getMergeStatus(): GitResult<{ inProgress: boolean; type: 'merge' | 'rebase' | 'cherry-pick' | null; conflicts: string[] }> {
    try {
      // 检查是否在 merge/rebase 中
      let inProgress = false;
      let type: 'merge' | 'rebase' | 'cherry-pick' | null = null;

      // 检查 .git 目录中的标记文件
      const fs = require('fs');
      const path = require('path');
      
      if (fs.existsSync(path.join(this.cwd, '.git', 'MERGE_HEAD'))) {
        inProgress = true;
        type = 'merge';
      } else if (fs.existsSync(path.join(this.cwd, '.git', 'rebase-merge')) || 
                 fs.existsSync(path.join(this.cwd, '.git', 'rebase-apply'))) {
        inProgress = true;
        type = 'rebase';
      } else if (fs.existsSync(path.join(this.cwd, '.git', 'CHERRY_PICK_HEAD'))) {
        inProgress = true;
        type = 'cherry-pick';
      }

      // 获取冲突文件列表
      const conflicts: string[] = [];
      if (inProgress) {
        const statusOutput = this.execGit('status --porcelain');
        statusOutput.split('\n').forEach(line => {
          if (!line) return;
          const x = line[0];
          const y = line[1];
          const file = line.substring(3);
          
          // 冲突标记
          if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
            conflicts.push(file);
          }
        });
      }

      return {
        success: true,
        data: {
          inProgress,
          type,
          conflicts,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * ========== Git Enhanced Features - Query & Analysis ==========
   */

  /**
   * 搜索 Commits
   */
  searchCommits(filter: {
    query?: string;
    author?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): GitResult<GitCommit[]> {
    try {
      const { query, author, since, until, limit = 50 } = filter;
      
      let cmd = `log -${limit} --format="%H%n%P%n%h%n%an%n%ai%n%s%n%D%n--END--"`;
      
      if (query) {
        cmd += ` --grep="${query}"`;
      }
      if (author) {
        cmd += ` --author="${author}"`;
      }
      if (since) {
        cmd += ` --since="${since}"`;
      }
      if (until) {
        cmd += ` --until="${until}"`;
      }

      const output = this.execGit(cmd);
      
      if (!output) {
        return { success: true, data: [] };
      }

      const commits: GitCommit[] = [];
      const entries = output.split('--END--\n').filter(e => e.trim());

      for (const entry of entries) {
        const lines = entry.trim().split('\n');
        if (lines.length >= 7) {
          // 解析 parents（空格分隔的 hash 列表）
          const parents = lines[1].trim() ? lines[1].trim().split(' ') : [];
          // 解析 refs（逗号分隔，可能为空）
          const refsStr = lines[6].trim();
          const refs = refsStr ? refsStr.split(',').map(r => r.trim()) : [];
          
          commits.push({
            hash: lines[0],
            shortHash: lines[2],
            author: lines[3],
            date: lines[4],
            message: lines[5],
            parents,
            refs,
          });
        }
      }

      return { success: true, data: commits };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取文件修改历史
   */
  getFileHistory(file: string, limit: number = 50): GitResult<Array<GitCommit & { diff?: string }>> {
    try {
      if (!file || !file.trim()) {
        return {
          success: false,
          error: '文件名不能为空',
        };
      }

      const format = '%H%n%P%n%h%n%an%n%ai%n%s%n%D%n--END--';
      const output = this.execGit(`log -${limit} --follow --format="${format}" -- "${file}"`);

      if (!output) {
        return { success: true, data: [] };
      }

      const commits: Array<GitCommit & { diff?: string }> = [];
      const entries = output.split('--END--\n').filter(e => e.trim());

      for (const entry of entries) {
        const lines = entry.trim().split('\n');
        if (lines.length >= 7) {
          const hash = lines[0];
          
          // 解析 parents 和 refs
          const parents = lines[1].trim() ? lines[1].trim().split(' ') : [];
          const refsStr = lines[6].trim();
          const refs = refsStr ? refsStr.split(',').map(r => r.trim()) : [];
          
          // 获取该 commit 中文件的 diff
          let diff = '';
          try {
            diff = this.execGit(`show "${hash}" -- "${file}"`);
          } catch {
            diff = '';
          }

          commits.push({
            hash,
            shortHash: lines[2],
            author: lines[3],
            date: lines[4],
            message: lines[5],
            parents,
            refs,
            diff,
          });
        }
      }

      return { success: true, data: commits };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 获取文件 Blame 信息
   */
  getBlame(file: string): GitResult<Array<{
    lineNumber: number;
    commit: string;
    author: string;
    date: string;
    content: string;
  }>> {
    try {
      if (!file || !file.trim()) {
        return {
          success: false,
          error: '文件名不能为空',
        };
      }

      // 使用 --porcelain 格式获取详细信息
      const output = this.execGit(`blame --porcelain "${file}"`);
      
      const lines = output.split('\n');
      const blameLines: Array<{
        lineNumber: number;
        commit: string;
        author: string;
        date: string;
        content: string;
      }> = [];

      let i = 0;
      let lineNumber = 1;

      while (i < lines.length) {
        const line = lines[i];
        
        // 解析 blame 行（格式：hash origLine finalLine [numLines]）
        const match = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
        if (!match) {
          i++;
          continue;
        }

        const commit = match[1];
        lineNumber = parseInt(match[2]);

        // 跳过到 author 行
        let author = '';
        let date = '';
        let content = '';

        i++;
        while (i < lines.length) {
          const infoLine = lines[i];
          
          if (infoLine.startsWith('author ')) {
            author = infoLine.substring(7);
          } else if (infoLine.startsWith('author-time ')) {
            const timestamp = parseInt(infoLine.substring(12));
            date = new Date(timestamp * 1000).toISOString();
          } else if (infoLine.startsWith('\t')) {
            content = infoLine.substring(1);
            i++;
            break;
          }
          
          i++;
        }

        blameLines.push({
          lineNumber,
          commit: commit.substring(0, 8),
          author,
          date,
          content,
        });
      }

      return { success: true, data: blameLines };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 比较两个分支
   */
  compareBranches(base: string, target: string): GitResult<{
    ahead: number;
    behind: number;
    files: Array<{ file: string; status: string }>;
  }> {
    try {
      if (!base || !target) {
        return {
          success: false,
          error: '分支名不能为空',
        };
      }

      // 获取 ahead/behind 数量
      const revList = this.execGit(`rev-list --left-right --count "${base}...${target}"`);
      const [behind, ahead] = revList.split('\t').map(Number);

      // 获取不同的文件列表
      const diffOutput = this.execGit(`diff --name-status "${base}..${target}"`);
      
      const files: Array<{ file: string; status: string }> = [];
      if (diffOutput) {
        diffOutput.split('\n').forEach(line => {
          if (!line) return;
          const parts = line.split('\t');
          if (parts.length >= 2) {
            files.push({
              status: parts[0],
              file: parts[1],
            });
          }
        });
      }

      return {
        success: true,
        data: {
          ahead: ahead || 0,
          behind: behind || 0,
          files,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * ========== Git Enhanced Features - Tags & Remotes ==========
   */

  /**
   * 获取所有 Tags
   */
  getTags(): GitResult<Array<{
    name: string;
    commit: string;
    message?: string;
    tagger?: string;
    date?: string;
    type: 'lightweight' | 'annotated';
  }>> {
    try {
      // 获取所有 tag 列表
      const tagList = this.execGit('tag -l');
      
      if (!tagList) {
        return { success: true, data: [] };
      }

      const tags: Array<{
        name: string;
        commit: string;
        message?: string;
        tagger?: string;
        date?: string;
        type: 'lightweight' | 'annotated';
      }> = [];

      const tagNames = tagList.split('\n').filter(Boolean);

      for (const name of tagNames) {
        try {
          // 获取 tag 指向的 commit
          const commit = this.execGit(`rev-list -n 1 "${name}"`);
          
          // 尝试获取 annotated tag 信息
          try {
            const tagInfo = this.execGit(`tag -l --format="%(taggername)|%(taggerdate:iso)|%(contents:subject)" "${name}"`);
            const parts = tagInfo.split('|');
            
            if (parts[0]) {
              // Annotated tag
              tags.push({
                name,
                commit,
                tagger: parts[0],
                date: parts[1],
                message: parts[2],
                type: 'annotated',
              });
            } else {
              // Lightweight tag
              tags.push({
                name,
                commit,
                type: 'lightweight',
              });
            }
          } catch {
            // Lightweight tag (没有 tagger 信息)
            tags.push({
              name,
              commit,
              type: 'lightweight',
            });
          }
        } catch {
          // 跳过有问题的 tag
          continue;
        }
      }

      return { success: true, data: tags };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 创建 Tag
   */
  createTag(name: string, message?: string, type: 'lightweight' | 'annotated' = 'lightweight'): GitResult {
    try {
      if (!name || !name.trim()) {
        return {
          success: false,
          error: 'Tag 名称不能为空',
        };
      }

      if (type === 'annotated') {
        if (!message) {
          return {
            success: false,
            error: 'Annotated tag 必须提供 message',
          };
        }
        this.execGit(`tag -a "${name}" -m "${message.replace(/"/g, '\\"')}"`);
      } else {
        this.execGit(`tag "${name}"`);
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 删除 Tag
   */
  deleteTag(name: string): GitResult {
    try {
      if (!name || !name.trim()) {
        return {
          success: false,
          error: 'Tag 名称不能为空',
        };
      }

      this.execGit(`tag -d "${name}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 推送所有 Tags
   */
  pushTags(): GitResult {
    try {
      this.execGit('push --tags');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 获取所有 Remotes
   */
  getRemotes(): GitResult<Array<{
    name: string;
    fetchUrl: string;
    pushUrl: string;
  }>> {
    try {
      const output = this.execGit('remote -v');
      
      if (!output) {
        return { success: true, data: [] };
      }

      const remotes = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>();

      output.split('\n').forEach(line => {
        if (!line) return;
        
        // 格式: origin  https://github.com/user/repo.git (fetch)
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        if (!match) return;

        const [, name, url, type] = match;

        if (!remotes.has(name)) {
          remotes.set(name, {
            name,
            fetchUrl: '',
            pushUrl: '',
          });
        }

        const remote = remotes.get(name)!;
        if (type === 'fetch') {
          remote.fetchUrl = url;
        } else if (type === 'push') {
          remote.pushUrl = url;
        }
      });

      return {
        success: true,
        data: Array.from(remotes.values()),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || String(error),
      };
    }
  }

  /**
   * 添加 Remote
   */
  addRemote(name: string, url: string): GitResult {
    try {
      if (!name || !name.trim()) {
        return {
          success: false,
          error: 'Remote 名称不能为空',
        };
      }
      if (!url || !url.trim()) {
        return {
          success: false,
          error: 'Remote URL 不能为空',
        };
      }

      this.execGit(`remote add "${name}" "${url}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * 删除 Remote
   */
  removeRemote(name: string): GitResult {
    try {
      if (!name || !name.trim()) {
        return {
          success: false,
          error: 'Remote 名称不能为空',
        };
      }

      this.execGit(`remote remove "${name}"`);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * Fetch 远程更新
   */
  fetch(remote?: string): GitResult {
    try {
      const cmd = remote ? `fetch "${remote}"` : 'fetch --all';
      this.execGit(cmd);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || String(error) };
    }
  }
}
