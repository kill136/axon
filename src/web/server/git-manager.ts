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
      const format = '%H%n%h%n%an%n%ai%n%s%n--END--';
      const output = this.execGit(`log -${limit} --format="${format}"`);

      const commits: GitCommit[] = [];
      const entries = output.split('--END--\n').filter(e => e.trim());

      for (const entry of entries) {
        const lines = entry.trim().split('\n');
        if (lines.length >= 5) {
          commits.push({
            hash: lines[0],
            shortHash: lines[1],
            author: lines[2],
            date: lines[3],
            message: lines[4],
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
      this.execGit('push');

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

      // 获取 commit 信息
      const format = '%H%n%h%n%an%n%ai%n%s';
      const infoOutput = this.execGit(`show -s --format="${format}" "${hash}"`);
      const lines = infoOutput.split('\n');

      if (lines.length < 5) {
        return {
          success: false,
          error: '无法获取 commit 信息',
        };
      }

      // 获取 diff
      const diff = this.execGit(`show "${hash}"`);

      return {
        success: true,
        data: {
          hash: lines[0],
          shortHash: lines[1],
          author: lines[2],
          date: lines[3],
          message: lines[4],
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
}
