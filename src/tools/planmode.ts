/**
 * 计划模式工具
 * EnterPlanMode 和 ExitPlanMode
 */

import { BaseTool, type PermissionCheckResult } from './base.js';
import type { ToolResult, ToolDefinition, ExitPlanModeInput } from '../types/index.js';
import { PlanPersistenceManager } from '../plan/persistence.js';
import type { SavedPlan } from '../plan/types.js';
import { getCurrentCwd } from '../core/cwd-context.js';
import { t } from '../i18n/index.js';

/**
 * AppState 接口（简化版本，用于权限管理）
 */
export interface AppState {
  toolPermissionContext: ToolPermissionContext;
  planMode?: {
    active: boolean;
    planFile: string;
    planId: string;
  };
}

/**
 * 工具权限上下文
 */
export interface ToolPermissionContext {
  mode: 'normal' | 'plan' | 'delegate';
}

// ============ 全局状态管理（临时解决方案） ============
// 注意：这是一个简化的实现，真实的官方实现使用更复杂的状态管理系统

let globalAppState: AppState = {
  toolPermissionContext: {
    mode: 'normal',
  },
};

export function getGlobalAppState(): AppState {
  return globalAppState;
}

export function setGlobalAppState(updater: (state: AppState) => AppState): void {
  globalAppState = updater(globalAppState);
}

// ============ 兼容性函数（保留旧的 API） ============

export function isPlanModeActive(): boolean {
  return globalAppState.toolPermissionContext.mode === 'plan';
}

export function getPlanFile(): string | null {
  return globalAppState.planMode?.planFile || null;
}

export function getCurrentPlanId(): string | null {
  return globalAppState.planMode?.planId || null;
}

export function setPlanMode(active: boolean, planFile?: string, planId?: string): void {
  if (active) {
    // v2.1.31: 防御性检查 - 确保 getCurrentCwd() 返回有效值
    // 修复当 ~/.claude.json 缺少默认字段时进入 plan mode 的崩溃
    let safeCwd: string;
    try {
      safeCwd = getCurrentCwd() || process.cwd();
    } catch {
      safeCwd = process.cwd();
    }

    let safePlanId: string;
    try {
      safePlanId = planId || PlanPersistenceManager.generatePlanId();
    } catch {
      safePlanId = planId || `plan-${Date.now()}`;
    }

    setGlobalAppState((state) => ({
      ...state,
      toolPermissionContext: { mode: 'plan' },
      planMode: {
        active: true,
        planFile: planFile || safeCwd + '/PLAN.md',
        planId: safePlanId,
      },
    }));
  } else {
    setGlobalAppState((state) => ({
      ...state,
      toolPermissionContext: { mode: 'normal' },
      planMode: undefined,
    }));
  }
}

export class EnterPlanModeTool extends BaseTool<Record<string, unknown>, ToolResult> {
  name = 'EnterPlanMode';
  description = `Use this tool when you encounter a complex task that requires careful planning and exploration before implementation.

## When to Use This Tool

**Prefer using EnterPlanMode** for implementation tasks unless they're simple. Use it when ANY of these conditions apply:

1. **New Feature Implementation**: Adding meaningful new functionality
   - Example: "Add a logout button" - where should it go? What should happen on click?
   - Example: "Add form validation" - what rules? What error messages?

2. **Multiple Valid Approaches**: The task can be solved in several different ways
   - Example: "Add caching to the API" - could use Redis, in-memory, file-based, etc.
   - Example: "Improve performance" - many optimization strategies possible

3. **Code Modifications**: Changes that affect existing behavior or structure
   - Example: "Update the login flow" - what exactly should change?
   - Example: "Refactor this component" - what's the target architecture?

4. **Architectural Decisions**: The task requires choosing between patterns or technologies
   - Example: "Add real-time updates" - WebSockets vs SSE vs polling
   - Example: "Implement state management" - Redux vs Context vs custom solution

5. **Multi-File Changes**: The task will likely touch more than 2-3 files
   - Example: "Refactor the authentication system"
   - Example: "Add a new API endpoint with tests"

6. **Unclear Requirements**: You need to explore before understanding the full scope
   - Example: "Make the app faster" - need to profile and identify bottlenecks
   - Example: "Fix the bug in checkout" - need to investigate root cause

7. **User Preferences Matter**: The implementation could reasonably go multiple ways
   - If you would use AskUserQuestion to clarify the approach, use EnterPlanMode instead
   - Plan mode lets you explore first, then present options with context

## When NOT to Use This Tool

Only skip EnterPlanMode for simple tasks:
- Single-line or few-line fixes (typos, obvious bugs, small tweaks)
- Adding a single function with clear requirements
- Tasks where the user has given very specific, detailed instructions
- Pure research/exploration tasks (use the Task tool with explore agent instead)

## What Happens in Plan Mode

In plan mode, you'll:
1. Thoroughly explore the codebase using Glob, Grep, and Read tools
2. Understand existing patterns and architecture
3. Design an implementation approach
4. Present your plan to the user for approval
5. Use AskUserQuestion if you need to clarify approaches
6. Exit plan mode with ExitPlanMode when ready to implement

## Examples

### GOOD - Use EnterPlanMode:
User: "Add user authentication to the app"
- Requires architectural decisions (session vs JWT, where to store tokens, middleware structure)

User: "Optimize the database queries"
- Multiple approaches possible, need to profile first, significant impact

User: "Implement dark mode"
- Architectural decision on theme system, affects many components

User: "Add a delete button to the user profile"
- Seems simple but involves: where to place it, confirmation dialog, API call, error handling, state updates

User: "Update the error handling in the API"
- Affects multiple files, user should approve the approach

### BAD - Don't use EnterPlanMode:
User: "Fix the typo in the README"
- Straightforward, no planning needed

User: "Add a console.log to debug this function"
- Simple, obvious implementation

User: "What files handle routing?"
- Research task, not implementation planning

## Important Notes

- This tool REQUIRES user approval - they must consent to entering plan mode
- If unsure whether to use it, err on the side of planning - it's better to get alignment upfront than to redo work
- Users appreciate being consulted before significant changes are made to their codebase`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  /**
   * 权限检查方法（官方实现）
   * 此方法在工具执行前被调用，用于请求用户批准进入计划模式
   */
  async checkPermissions(input: Record<string, unknown>): Promise<PermissionCheckResult<Record<string, unknown>>> {
    return {
      behavior: 'ask',
      message: 'Enter plan mode?',
      updatedInput: input,
    };
  }

  /**
   * 执行工具（使用 AppState 系统）
   */
  async execute(_input: Record<string, unknown>): Promise<ToolResult> {
    try {
      // 获取当前状态
      const appState = getGlobalAppState();

      // 检查是否已经在计划模式中
      if (appState.toolPermissionContext.mode === 'plan') {
        return {
          success: false,
          error: 'Already in plan mode. Use ExitPlanMode to exit first.',
        };
      }

      // Generate plan ID and file path
      const planId = PlanPersistenceManager.generatePlanId();
      const planPath = getCurrentCwd() + '/PLAN.md';

      // 创建初始计划到持久化存储
      const now = Date.now();
      const initialPlan: SavedPlan = {
        metadata: {
          id: planId,
          title: 'Untitled Plan',
          description: 'Plan created in plan mode',
          status: 'draft',
          createdAt: now,
          updatedAt: now,
          workingDirectory: getCurrentCwd(),
          version: 1,
          priority: 'medium',
        },
        summary: 'Plan in progress',
        requirementsAnalysis: {
          functionalRequirements: [],
          nonFunctionalRequirements: [],
          technicalConstraints: [],
          successCriteria: [],
        },
        architecturalDecisions: [],
        steps: [],
        criticalFiles: [],
        risks: [],
        alternatives: [],
        estimatedComplexity: 'moderate',
        content: '# Implementation Plan\n\n(Building plan...)',
      };

      // 保存到持久化存储
      await PlanPersistenceManager.savePlan(initialPlan);

      // 更新 Session 状态
      try {
        const { sessionManager } = await import('../session/index.js');
        const currentSession = sessionManager.getCurrent();

        if (currentSession) {
          currentSession.metadata.hasExitedPlanMode = false;
          currentSession.metadata.needsPlanModeExitAttachment = false;
          currentSession.metadata.activePlanId = planId;

          if (!currentSession.metadata.planHistory) {
            currentSession.metadata.planHistory = [];
          }
          currentSession.metadata.planHistory.push(planId);

          sessionManager.save();
        }
      } catch (error) {
        // Session update is optional, continue if it fails
        console.warn('Failed to update session metadata:', error);
      }

      // 更新 AppState：设置计划模式
      setGlobalAppState((state) => ({
        ...state,
        toolPermissionContext: { mode: 'plan' },
        planMode: {
          active: true,
          planFile: planPath,
          planId,
        },
      }));

      return {
        success: true,
        output: `Entered plan mode.

Plan ID: ${planId}

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind) EXCEPT the plan file
- Modifying existing files (no Edit operations) EXCEPT the plan file
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.

## Plan File Info:
No plan file exists yet. You should create your plan at ${planPath} using the Write tool.
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

The plan will be automatically saved to the persistent storage (~/.claude/plans/${planId}.json) when you exit plan mode.

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Focus on understanding the problem before proposing solutions.`,
      };
    } catch (error) {
      return {
        success: false,
        error: t('planmode.enterFailed', { error: error instanceof Error ? error.message : String(error) }),
      };
    }
  }
}

export class ExitPlanModeTool extends BaseTool<ExitPlanModeInput, ToolResult> {
  name = 'ExitPlanMode';
  description = `Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval.

## How This Tool Works
- You should have already written your plan to the plan file specified in the plan mode system message
- This tool does NOT take the plan content as a parameter - it will read the plan from the file you wrote
- This tool simply signals that you're done planning and ready for the user to review and approve
- The user will see the contents of your plan file when they review it

## When to Use This Tool
IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you're gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.

## Handling Ambiguity in Plans
Before using this tool, ensure your plan is clear and unambiguous. If there are multiple valid approaches or unclear requirements:
1. Use the AskUserQuestion tool to clarify with the user
2. Ask about specific implementation choices (e.g., architectural patterns, which library to use)
3. Clarify any assumptions that could affect the implementation
4. Edit your plan file to incorporate user feedback
5. Only proceed with ExitPlanMode after resolving ambiguities and updating the plan file

## Examples

1. Initial task: "Search for and understand the implementation of vim mode in the codebase" - Do not use the exit plan mode tool because you are not planning the implementation steps of a task.
2. Initial task: "Help me implement yank mode for vim" - Use the exit plan mode tool after you have finished planning the implementation steps of the task.
3. Initial task: "Add a new feature to handle user authentication" - If unsure about auth method (OAuth, JWT, etc.), use AskUserQuestion first, then use exit plan mode tool after clarifying the approach.`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {},
      required: [],
    };
  }

  /**
   * 权限检查方法（官方实现）
   * ExitPlanMode 需要用户确认，以便用户可以查看计划内容
   */
  async checkPermissions(input: ExitPlanModeInput): Promise<PermissionCheckResult<ExitPlanModeInput>> {
    return {
      behavior: 'ask',
      message: 'Exit plan mode?',
      updatedInput: input,
    };
  }

  /**
   * 执行工具（使用 AppState 系统）
   */
  async execute(_input: ExitPlanModeInput): Promise<ToolResult> {
    try {
      // 获取当前状态
      const appState = getGlobalAppState();

      // 检查是否在计划模式中
      if (appState.toolPermissionContext.mode !== 'plan') {
        return {
          success: false,
          error: 'Not in plan mode. Use EnterPlanMode first.',
        };
      }

      // 获取计划文件信息
      const planFile = appState.planMode?.planFile || null;
      const planId = appState.planMode?.planId || null;

      let planContent = '';
      if (planFile) {
        try {
          const fs = await import('fs');
          if (fs.existsSync(planFile)) {
            planContent = fs.readFileSync(planFile, 'utf-8');
          }
        } catch (error) {
          // Ignore read errors
        }
      }

      // Parse and save plan to persistence
      let savedPlanPath: string | undefined;
      if (planId && planContent) {
        try {
          const plan = this.parsePlanContent(planId, planContent);
          // 更新计划状态为 pending（等待用户批准）
          plan.metadata.status = 'pending';
          const saved = await PlanPersistenceManager.savePlan(plan);
          if (saved) {
            savedPlanPath = `~/.claude/plans/${planId}.json`;
          }
        } catch (error) {
          console.error('Failed to save plan to persistence:', error);
        }
      }

      // 更新 Session 状态
      try {
        const { sessionManager } = await import('../session/index.js');
        const currentSession = sessionManager.getCurrent();

        if (currentSession) {
          currentSession.metadata.hasExitedPlanMode = true;
          currentSession.metadata.needsPlanModeExitAttachment = true;
          currentSession.metadata.activePlanId = undefined; // 清除活跃计划 ID

          sessionManager.save();
        }
      } catch (error) {
        // Session update is optional, continue if it fails
        console.warn('Failed to update session metadata:', error);
      }

      // 更新 AppState：退出计划模式
      setGlobalAppState((state) => ({
        ...state,
        toolPermissionContext: { mode: 'normal' },
        planMode: undefined,
      }));

      const output = planFile
        ? `Exited plan mode.

Your plan has been saved to:
- Working file: ${planFile}${savedPlanPath ? `\n- Persistent storage: ${savedPlanPath}` : ''}
${planId ? `\nPlan ID: ${planId}` : ''}

You can refer back to this plan using:
- List all plans: Use the session or plan list commands
- Load plan: Use plan ID ${planId}
- Compare plans: Compare this with other saved plans

## Approved Plan:
${planContent}

Awaiting user approval to proceed with implementation.`
        : `Exited plan mode. Awaiting user approval to proceed with implementation.`;

      return {
        success: true,
        output,
      };
    } catch (error) {
      return {
        success: false,
        error: t('planmode.exitFailed', { error: error instanceof Error ? error.message : String(error) }),
      };
    }
  }

  /**
   * Parse plan content into SavedPlan structure
   * This is a simplified parser - in a real implementation,
   * you might use more sophisticated parsing or ask Claude to structure it
   */
  private parsePlanContent(planId: string, content: string): SavedPlan {
    const now = Date.now();

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : 'Untitled Plan';

    // Create basic plan structure
    const plan: SavedPlan = {
      metadata: {
        id: planId,
        title,
        description: title,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        workingDirectory: getCurrentCwd(),
        version: 1,
        priority: 'medium',
      },
      summary: this.extractSummary(content),
      requirementsAnalysis: {
        functionalRequirements: this.extractRequirements(content, 'Functional Requirements'),
        nonFunctionalRequirements: this.extractRequirements(content, 'Non-Functional Requirements'),
        technicalConstraints: this.extractRequirements(content, 'Technical Constraints'),
        successCriteria: this.extractRequirements(content, 'Success Criteria'),
      },
      architecturalDecisions: [],
      steps: this.extractSteps(content),
      criticalFiles: this.extractCriticalFiles(content),
      risks: this.extractRisks(content),
      alternatives: [],
      estimatedComplexity: 'moderate',
      content,
    };

    return plan;
  }

  private extractSummary(content: string): string {
    const summaryMatch = content.match(/##\s+Summary\s*\n\n([\s\S]*?)(?=\n##|$)/i);
    return summaryMatch ? summaryMatch[1].trim() : 'No summary provided';
  }

  private extractRequirements(content: string, section: string): string[] {
    const regex = new RegExp(`###\\s+${section}\\s*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`, 'i');
    const match = content.match(regex);
    if (!match) return [];

    const lines = match[1].split('\n');
    return lines
      .filter((line) => line.trim().startsWith('-'))
      .map((line) => line.trim().substring(1).trim())
      .filter((line) => line.length > 0);
  }

  private extractSteps(content: string): import('../plan/types.js').PlanStep[] {
    const steps: import('../plan/types.js').PlanStep[] = [];
    const stepRegex = /###\s+Step\s+(\d+):\s+(.+?)\n/g;
    let match;

    while ((match = stepRegex.exec(content)) !== null) {
      const stepNumber = parseInt(match[1], 10);
      const description = match[2];

      steps.push({
        step: stepNumber,
        description,
        files: [],
        complexity: 'medium',
        dependencies: [],
      });
    }

    return steps;
  }

  private extractCriticalFiles(content: string): import('../plan/types.js').CriticalFile[] {
    const files: import('../plan/types.js').CriticalFile[] = [];
    const filesSection = content.match(/###\s+Critical Files.*?\n([\s\S]*?)(?=\n##|$)/i);

    if (filesSection) {
      const lines = filesSection[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^-\s+(.+?)\s+-\s+(.+)$/);
        if (match) {
          files.push({
            path: match[1],
            reason: match[2],
            importance: 3,
          });
        }
      }
    }

    return files;
  }

  private extractRisks(content: string): import('../plan/types.js').Risk[] {
    const risks: import('../plan/types.js').Risk[] = [];
    const risksSection = content.match(/##\s+Risks.*?\n([\s\S]*?)(?=\n##|$)/i);

    if (risksSection) {
      const riskBlocks = risksSection[1].split(/###\s+\d+\.\s+/);
      for (const block of riskBlocks) {
        if (!block.trim()) continue;

        const lines = block.split('\n');
        const description = lines[0].trim();

        risks.push({
          category: 'technical',
          level: 'medium',
          description,
        });
      }
    }

    return risks;
  }
}
