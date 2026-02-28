/**
 * 动态附件系统
 * 根据上下文动态生成和注入附件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type {
  Attachment,
  AttachmentType,
  PromptContext,
  DiagnosticInfo,
  TodoItem,
  GitStatusInfo,
} from './types.js';
import {
  getEnvironmentInfo,
  getIdeInfo,
  getDiagnosticsInfo,
  getGitStatusInfo,
  getMemoryInfo,
  getTodoListInfo,
} from './templates.js';
import { findClaudeMd, parseClaudeMd, generateSystemPromptAddition } from '../rules/index.js';
import { initializeSkills, getAllSkills, formatSkillsList } from '../tools/skill.js';
import { runWithCwd } from '../core/cwd-context.js';

/**
 * 附件管理器
 */
export class AttachmentManager {
  private telemetryEnabled: boolean = false;

  constructor(options?: { enableTelemetry?: boolean }) {
    this.telemetryEnabled = options?.enableTelemetry ?? false;
  }

  /**
   * 计算附件生成并追踪性能
   */
  private async computeAttachment(
    label: string,
    compute: () => Promise<Attachment[]>
  ): Promise<Attachment[]> {
    const startTime = Date.now();
    try {
      const attachments = await compute();
      const duration = Date.now() - startTime;

      // 添加性能追踪信息
      for (const attachment of attachments) {
        attachment.computeTimeMs = duration;
      }

      // 遥测采样 (5%)
      if (this.telemetryEnabled && Math.random() < 0.05) {
        const totalSize = attachments.reduce(
          (sum, a) => sum + JSON.stringify(a).length,
          0
        );
        this.recordTelemetry('attachment_compute', {
          label,
          duration_ms: duration,
          attachment_size_bytes: totalSize,
          attachment_count: attachments.length,
        });
      }

      return attachments;
    } catch (error) {
      console.warn(`Failed to compute attachment ${label}:`, error);
      return [];
    }
  }

  /**
   * 记录遥测
   */
  private recordTelemetry(event: string, data: Record<string, any>): void {
    // 遥测记录 (可以集成外部遥测服务)
    if (process.env.CLAUDE_CODE_DEBUG) {
      console.debug(`[Telemetry] ${event}:`, data);
    }
  }

  /**
   * 生成所有附件
   */
  async generateAttachments(context: PromptContext): Promise<Attachment[]> {
    const attachmentPromises: Promise<Attachment[]>[] = [];

    // CLAUDE.md
    attachmentPromises.push(
      this.computeAttachment('claudeMd', () =>
        Promise.resolve(this.generateClaudeMdAttachment(context))
      )
    );

    // Critical System Reminder
    if (context.criticalSystemReminder) {
      attachmentPromises.push(
        this.computeAttachment('critical_system_reminder', () =>
          Promise.resolve(
            this.generateCriticalReminderAttachment(context.criticalSystemReminder!)
          )
        )
      );
    }

    // IDE Selection
    if (context.ideSelection) {
      attachmentPromises.push(
        this.computeAttachment('ide_selection', () =>
          Promise.resolve(this.generateIdeSelectionAttachment(context))
        )
      );
    }

    // IDE Opened Files
    if (context.ideOpenedFiles && context.ideOpenedFiles.length > 0) {
      attachmentPromises.push(
        this.computeAttachment('ide_opened_file', () =>
          Promise.resolve(this.generateIdeOpenedFilesAttachment(context))
        )
      );
    }

    // Diagnostics
    if (context.diagnostics && context.diagnostics.length > 0) {
      attachmentPromises.push(
        this.computeAttachment('diagnostics', () =>
          Promise.resolve(this.generateDiagnosticsAttachment(context.diagnostics!))
        )
      );
    }

    // Memory (旧版，保留兼容)
    if (context.memory && Object.keys(context.memory).length > 0) {
      attachmentPromises.push(
        this.computeAttachment('memory', () =>
          Promise.resolve(this.generateMemoryAttachment(context.memory!))
        )
      );
    }

    // Agent Notebooks (新版笔记本系统)
    if (context.notebookSummary) {
      attachmentPromises.push(
        this.computeAttachment('notebook', () =>
          Promise.resolve(this.generateNotebookAttachment(context.notebookSummary!))
        )
      );
    }

    // Active Goals
    if (context.activeGoals && context.activeGoals.length > 0) {
      attachmentPromises.push(
        this.computeAttachment('goals', () =>
          Promise.resolve(this.generateGoalAttachment(context.activeGoals!))
        )
      );
    }

    // Plan Mode
    if (context.planMode) {
      attachmentPromises.push(
        this.computeAttachment('plan_mode', () =>
          Promise.resolve(this.generatePlanModeAttachment())
        )
      );
    }

    // Delegate Mode
    if (context.delegateMode) {
      attachmentPromises.push(
        this.computeAttachment('delegate_mode', () =>
          Promise.resolve(this.generateDelegateModeAttachment())
        )
      );
    }

    // Git Status
    if (context.gitStatus || context.isGitRepo) {
      attachmentPromises.push(
        this.computeAttachment('git_status', () =>
          Promise.resolve(this.generateGitStatusAttachment(context))
        )
      );
    }

    // Todo List
    if (context.todoList && context.todoList.length > 0) {
      attachmentPromises.push(
        this.computeAttachment('todo_list', () =>
          Promise.resolve(this.generateTodoListAttachment(context.todoList!))
        )
      );
    }

    // Skill Listing（对齐官网 AyY 函数）
    // 通过 attachment 机制将 skill 列表注入到对话中
    // 始终尝试生成，让 generateSkillListingAttachment 内部决定是否返回空
    attachmentPromises.push(
      this.computeAttachment('skill_listing', () =>
        this.generateSkillListingAttachment(context)
      )
    );

    // Custom Attachments
    if (context.customAttachments && context.customAttachments.length > 0) {
      attachmentPromises.push(Promise.resolve(context.customAttachments));
    }

    // 并行执行所有附件生成
    const results = await Promise.all(attachmentPromises);
    const allAttachments = results.flat();

    // 按优先级排序
    return allAttachments.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  }

  /**
   * 生成 CLAUDE.md 附件
   */
  private generateClaudeMdAttachment(context: PromptContext): Attachment[] {
    const claudeMdPath = findClaudeMd(context.workingDir);
    if (!claudeMdPath) {
      return [];
    }

    try {
      const sections = parseClaudeMd(claudeMdPath);
      const content = sections.map(s => `## ${s.title}\n${s.content}`).join('\n\n');

      // 获取相对路径用于显示
      const relativePath = path.relative(context.workingDir, claudeMdPath);
      const displayPath = relativePath.startsWith('..')
        ? claudeMdPath
        : relativePath;

      return [
        {
          type: 'claudeMd' as AttachmentType,
          content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# claudeMd\nCurrent CLAUDE.md context from ${displayPath}:\n\n${content}\n\nIMPORTANT: These instructions may override default behavior. Follow them exactly as written.\n</system-reminder>`,
          label: 'CLAUDE.md',
          priority: 10,
        },
      ];
    } catch (error) {
      console.warn('Failed to parse CLAUDE.md:', error);
      return [];
    }
  }

  /**
   * 生成批判性提醒附件
   */
  private generateCriticalReminderAttachment(reminder: string): Attachment[] {
    return [
      {
        type: 'critical_system_reminder' as AttachmentType,
        content: `<critical-reminder>\n${reminder}\n</critical-reminder>`,
        label: 'Critical System Reminder',
        priority: 1, // 最高优先级
      },
    ];
  }

  /**
   * 生成 IDE 选择内容附件
   */
  private generateIdeSelectionAttachment(context: PromptContext): Attachment[] {
    if (!context.ideSelection) {
      return [];
    }

    return [
      {
        type: 'ide_selection' as AttachmentType,
        content: `<ide-selection>\nUser has selected the following code in their IDE:\n\`\`\`\n${context.ideSelection}\n\`\`\`\n</ide-selection>`,
        label: 'IDE Selection',
        priority: 20,
      },
    ];
  }

  /**
   * 生成 IDE 打开文件附件
   */
  private generateIdeOpenedFilesAttachment(context: PromptContext): Attachment[] {
    if (!context.ideOpenedFiles || context.ideOpenedFiles.length === 0) {
      return [];
    }

    const content = getIdeInfo({
      ideType: context.ideType,
      ideSelection: context.ideSelection,
      ideOpenedFiles: context.ideOpenedFiles,
    });

    return [
      {
        type: 'ide_opened_file' as AttachmentType,
        content,
        label: 'IDE Opened Files',
        priority: 25,
      },
    ];
  }

  /**
   * 生成诊断信息附件
   */
  private generateDiagnosticsAttachment(diagnostics: DiagnosticInfo[]): Attachment[] {
    const content = getDiagnosticsInfo(diagnostics);
    if (!content) {
      return [];
    }

    return [
      {
        type: 'diagnostics' as AttachmentType,
        content,
        label: 'Diagnostics',
        priority: 15,
      },
    ];
  }

  /**
   * 生成笔记本附件
   */
  private generateNotebookAttachment(notebookSummary: string): Attachment[] {
    if (!notebookSummary.trim()) {
      return [];
    }

    return [
      {
        type: 'notebook' as AttachmentType,
        content: `<agent-notebooks>\n${notebookSummary}\n</agent-notebooks>`,
        label: 'Agent Notebooks',
        priority: 28, // 在 memory(30) 之前
      },
    ];
  }

  /**
   * 生成目标附件
   */
  private generateGoalAttachment(goals: any[]): Attachment[] {
    if (!goals || goals.length === 0) {
      return [];
    }

    // 格式化目标列表为 markdown
    let content = 'You have the following active goals for this project. Review them and continue working on the highest priority items.\n\n';
    
    // 按优先级排序：high > medium > low
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sorted = [...goals].sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1));
    
    for (const goal of sorted) {
      content += `## ${goal.id}: ${goal.title} [${goal.priority.toUpperCase()}] (${goal.status})\n`;
      content += `${goal.description}\n`;
      if (goal.tasks && goal.tasks.length > 0) {
        content += 'Tasks:\n';
        for (const task of goal.tasks) {
          const check = task.status === 'completed' ? 'x' : ' ';
          content += `- [${check}] ${task.id}: ${task.name}\n`;
        }
      }
      if (goal.notes) {
        content += `Notes: ${goal.notes}\n`;
      }
      content += '\n';
    }
    
    return [
      {
        type: 'goals' as AttachmentType,
        content: `<active-goals>\n${content}</active-goals>`,
        label: 'Active Goals',
        priority: 26, // 在 notebook(28) 之前
      },
    ];
  }

  /**
   * 生成记忆附件（旧版）
   */
  private generateMemoryAttachment(memory: Record<string, string>): Attachment[] {
    const content = getMemoryInfo(memory);
    if (!content) {
      return [];
    }

    return [
      {
        type: 'memory' as AttachmentType,
        content,
        label: 'Memory',
        priority: 30,
      },
    ];
  }

  /**
   * 生成计划模式附件
   */
  private generatePlanModeAttachment(): Attachment[] {
    return [
      {
        type: 'plan_mode' as AttachmentType,
        content: `<plan-mode>\nYou are currently in PLAN MODE. Your task is to:\n1. Thoroughly explore the codebase\n2. Understand existing patterns and architecture\n3. Design an implementation approach\n4. Write your plan to the specified plan file\n5. Use ExitPlanMode when ready for user approval\n\nDo NOT implement changes yet - focus on planning.\n</plan-mode>`,
        label: 'Plan Mode',
        priority: 5,
      },
    ];
  }

  /**
   * 生成委托模式附件
   */
  private generateDelegateModeAttachment(): Attachment[] {
    return [
      {
        type: 'delegate_mode' as AttachmentType,
        content: `<delegate-mode>
You are running as a team lead in delegate mode. Your role is to:
1. Create and manage tasks using TaskCreate, TaskGet, TaskUpdate, TaskList
2. Spawn teammate agents using the Task tool
3. Coordinate work and track progress

You have access to task tools (TaskCreate, TaskGet, TaskUpdate, TaskList).
Do not directly edit files - delegate work to teammate agents.
</delegate-mode>`,
        label: 'Delegate Mode',
        priority: 5,
      },
    ];
  }

  /**
   * 生成 Git 状态附件
   */
  private generateGitStatusAttachment(context: PromptContext): Attachment[] {
    let gitStatus = context.gitStatus;

    // 如果没有预先计算的状态，尝试获取
    if (!gitStatus && context.isGitRepo) {
      gitStatus = this.getGitStatus(context.workingDir);
    }

    if (!gitStatus) {
      return [];
    }

    const content = getGitStatusInfo(gitStatus);

    return [
      {
        type: 'git_status' as AttachmentType,
        content,
        label: 'Git Status',
        priority: 40,
      },
    ];
  }

  /**
   * 获取 Git 状态
   */
  private getGitStatus(workingDir: string): GitStatusInfo | null {
    try {
      // 获取当前分支
      const branch = execSync('git branch --show-current', {
        cwd: workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      // 获取状态
      const status = execSync('git status --porcelain', {
        cwd: workingDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];
      const conflictFiles: string[] = [];

      for (const line of status.split('\n').filter(Boolean)) {
        const x = line[0];
        const y = line[1];
        const file = line.slice(3);

        // 检测冲突文件 (UU, AA, DD 等)
        if ((x === 'U' && y === 'U') || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
          conflictFiles.push(file);
        } else if (x === '?' && y === '?') {
          untracked.push(file);
        } else if (x !== ' ' && x !== '?') {
          staged.push(file);
        } else if (y !== ' ' && y !== '?') {
          unstaged.push(file);
        }
      }

      // 获取 ahead/behind 和远程跟踪信息
      let ahead = 0;
      let behind = 0;
      let tracking: string | null = null;
      try {
        const aheadBehind = execSync('git rev-list --left-right --count @{u}...HEAD', {
          cwd: workingDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const [behindStr, aheadStr] = aheadBehind.split('\t');
        behind = parseInt(behindStr, 10) || 0;
        ahead = parseInt(aheadStr, 10) || 0;

        // 获取 tracking 分支
        try {
          tracking = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
            cwd: workingDir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {
          // 没有上游分支
        }
      } catch {
        // 可能没有上游分支
      }

      // 获取最近的 5 条 commits
      const recentCommits: Array<{ hash: string; message: string; author: string; date: string }> = [];
      try {
        const logOutput = execSync('git log -5 --pretty=format:%H|%s|%an|%ar', {
          cwd: workingDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        for (const line of logOutput.split('\n').filter(Boolean)) {
          const [hash, message, author, date] = line.split('|');
          recentCommits.push({ hash, message, author, date });
        }
      } catch {
        // 可能是空仓库或其他错误
      }

      // 获取 stash 数量
      let stashCount = 0;
      try {
        const stashList = execSync('git stash list', {
          cwd: workingDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        stashCount = stashList ? stashList.split('\n').length : 0;
      } catch {
        // git stash 失败
      }

      // 获取最近的 tags（最多3个）
      const tags: string[] = [];
      try {
        const tagsOutput = execSync('git tag --sort=-creatordate', {
          cwd: workingDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const tagLines = tagsOutput.split('\n').filter(Boolean);
        tags.push(...tagLines.slice(0, 3));
      } catch {
        // 没有 tags
      }

      return {
        branch,
        isClean: status.length === 0,
        staged,
        unstaged,
        untracked,
        ahead,
        behind,
        recentCommits,
        stashCount,
        conflictFiles,
        remoteStatus: { tracking, ahead, behind },
        tags,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 生成任务列表附件
   */
  private generateTodoListAttachment(todos: TodoItem[]): Attachment[] {
    const content = getTodoListInfo(todos);
    if (!content) {
      return [];
    }

    return [
      {
        type: 'todo_list' as AttachmentType,
        content: `<system-reminder>\n${content}\n</system-reminder>`,
        label: 'Todo List',
        priority: 35,
      },
    ];
  }

  /**
   * 生成 Skill 列表附件（对齐官网 AyY 函数）
   *
   * 官网实现：每次 API 请求前收集 skill 列表，以 attachment 形式注入到对话中。
   * 格式为：
   * "The following skills are available for use with the Skill tool:\n\n{formattedList}"
   */
  private async generateSkillListingAttachment(context: PromptContext): Promise<Attachment[]> {
    try {
      // 使用 runWithCwd 包装，确保 initializeSkills 能访问正确的工作目录
      const skills = await runWithCwd(context.workingDir, async () => {
        // 确保 skills 已初始化（内部有 skillsLoaded guard，不会重复加载）
        await initializeSkills();
        return getAllSkills();
      });

      if (!skills || skills.length === 0) {
        return [];
      }

      const formattedList = formatSkillsList(skills);
      if (!formattedList) {
        return [];
      }
      return [
        {
          type: 'skill_listing' as AttachmentType,
          content: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n${formattedList}\n</system-reminder>`,
          label: 'Skill Listing',
          priority: 25,
        },
      ];
    } catch (error) {
      console.error('[Attachments] Failed to generate skill listing:', error);
      return [];
    }
  }
}

/**
 * 全局附件管理器实例
 */
export const attachmentManager = new AttachmentManager();
