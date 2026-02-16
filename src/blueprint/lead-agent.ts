/**
 * LeadAgent v9.0 - 持久大脑
 *
 * 蜂群架构的核心改造：用持久 AI 大脑替代代码调度器
 *
 * 核心理念：
 * - LeadAgent 拥有一个贯穿整个项目的 ConversationLoop（不销毁）
 * - 它自己探索代码库、理解需求、制定执行计划
 * - 独立/简单任务 → 通过 DispatchWorker 工具派发给 Worker 并行执行
 * - 关键/复杂/串行任务 → 自己直接用工具完成
 * - Worker 返回完整结果，LeadAgent 在自己上下文中审查
 * - 可以动态调整计划，不需要单独的 Reviewer
 *
 * vs 旧架构：
 * - 旧：Coordinator(代码调度) → 50字摘要 → Worker(各自为战) → Reviewer(孤立审查)
 * - 新：LeadAgent(持久AI大脑) → 详细Brief → Worker(执行手臂) → LeadAgent(上下文审查)
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

import { ConversationLoop } from '../core/loop.js';
import type {
  Blueprint,
  SmartTask,
  ExecutionPlan,
  TaskResult,
  SwarmConfig,
  LeadAgentConfig,
  LeadAgentEvent,
  LeadAgentResult,
  TechStack,
  TaskPlan,
  TaskPlanUpdateInput,
  DEFAULT_SWARM_CONFIG,
} from './types.js';
import { isBlueprint } from './types.js';
import type { BlueprintStatus } from './types.js';
import { AGENT_TOOL_CONFIGS } from '../agents/tools.js';
import { UpdateTaskPlanTool } from '../tools/update-task-plan.js';
import { DispatchWorkerTool } from '../tools/dispatch-worker.js';
import { TriggerE2ETestTool } from '../tools/trigger-e2e-test.js';

// ============================================================================
// LeadAgent 核心类
// ============================================================================

export class LeadAgent extends EventEmitter {
  private loop: ConversationLoop | null = null;
  private config: LeadAgentConfig;
  private swarmConfig: SwarmConfig;
  private blueprint: Blueprint;
  private sourceType: 'blueprint' | 'taskplan';
  private executionPlan: ExecutionPlan | null;
  private projectPath: string;
  private taskResults: Map<string, TaskResult> = new Map();
  private startTime: number = 0;

  constructor(config: LeadAgentConfig) {
    super();
    this.config = config;
    this.sourceType = isBlueprint(config.blueprint) ? 'blueprint' : 'taskplan';

    if (this.sourceType === 'taskplan') {
      const plan = config.blueprint as TaskPlan;
      this.blueprint = {
        id: plan.id,
        name: plan.goal,
        description: plan.context,
        projectPath: plan.projectPath,
        status: 'executing' as BlueprintStatus,
        requirements: plan.acceptanceCriteria || [plan.goal],
        techStack: plan.techStack,
        constraints: plan.constraints,
        createdAt: plan.createdAt,
        updatedAt: new Date(),
      };
    } else {
      this.blueprint = config.blueprint as Blueprint;
    }

    this.executionPlan = config.executionPlan || null;
    this.projectPath = config.projectPath;
    // 使用传入的 swarmConfig 或从 DEFAULT_SWARM_CONFIG import
    this.swarmConfig = config.swarmConfig || {
      maxWorkers: 10,
      workerTimeout: 1800000,
      defaultModel: 'sonnet',
      complexTaskModel: 'opus',
      simpleTaskModel: 'sonnet',
      autoTest: true,
      testTimeout: 60000,
      maxRetries: 3,
      skipOnFailure: true,
      useGitBranches: true,
      autoMerge: true,
      maxCost: 10,
      costWarningThreshold: 0.8,
      enableLeadAgent: true,
      leadAgentModel: 'sonnet',
      leadAgentMaxTurns: 200,
      leadAgentSelfExecuteComplexity: 'complex',
    };
  }

  /**
   * 发射事件并转发给 WebUI
   */
  private emitLeadEvent(type: LeadAgentEvent['type'], data: Record<string, unknown>): void {
    const event: LeadAgentEvent = {
      type,
      data,
      timestamp: new Date(),
    };
    this.emit('lead:event', event);
    this.config.onEvent?.(event);
  }

  /**
   * 构建 LeadAgent 的系统提示词
   * 这是 LeadAgent 的"灵魂"——告诉它它是谁、怎么工作
   */
  private buildSystemPrompt(): string {
    if (this.sourceType === 'taskplan') {
      return this.buildTaskPlanSystemPrompt();
    }

    const platform = os.platform();
    const platformInfo = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
    const shellHint = platform === 'win32'
      ? '\n- Windows 系统：使用 dir 代替 ls，使用 type 代替 cat'
      : '';
    const today = new Date().toISOString().split('T')[0];

    // 获取 Git 信息
    let gitInfo = '';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      gitInfo = `\nGit 分支: ${branch}`;
    } catch { /* ignore */ }

    // 构建技术栈信息
    const tech = this.blueprint.techStack;
    let techStackInfo = '';
    if (tech) {
      const parts: string[] = [];
      if (tech.language) parts.push(`语言: ${tech.language}`);
      if (tech.framework) parts.push(`框架: ${tech.framework}`);
      if (tech.uiFramework && tech.uiFramework !== 'none') parts.push(`UI: ${tech.uiFramework}`);
      if (tech.testFramework) parts.push(`测试: ${tech.testFramework}`);
      if (parts.length > 0) techStackInfo = `\n技术栈: ${parts.join(' | ')}`;
    }

    // 构建需求摘要
    const requirementsSummary = this.blueprint.requirements?.length
      ? this.blueprint.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : this.blueprint.description;

    return `你是 **LeadAgent（首席开发者）**，负责协调整个项目的开发。

## 你的角色
你是这个项目唯一的大脑。你拥有：
- **持续理解力**：你的对话不会被销毁，你记住一切
- **全局视野**：你理解每个任务之间的关系
- **决策权**：你决定哪些任务自己做，哪些派给 Worker
- **审查权**：Worker 的结果由你审查，不需要单独的 Reviewer

## 环境信息
- 平台: ${platformInfo}
- 日期: ${today}
- 项目路径: ${this.projectPath}${gitInfo}${techStackInfo}${shellHint}

## 蓝图（需求锚点）
项目名: ${this.blueprint.name}
描述: ${this.blueprint.description}

### 核心需求
${requirementsSummary}

${this.blueprint.constraints?.length ? `### 约束\n${this.blueprint.constraints.map(c => `- ${c}`).join('\n')}` : ''}

${this.blueprint.brief ? `### 关键上下文（来自需求收集对话）\n${this.blueprint.brief}\n` : ''}
${this.buildAPIContractPrompt()}

## 工作流程

### Phase 1: 探索代码库
使用 Read、Glob、Grep 工具探索现有代码库，理解：
- 目录结构和项目组织
- 现有代码风格和命名规范
- 已有的模块和组件
- 技术栈和依赖

### Phase 2: 制定执行计划
基于蓝图需求和代码探索结果，自己制定任务计划：
1. 分析需求，拆分为具体的开发任务
2. 每个任务通过 \`UpdateTaskPlan({ action: "add_task", taskId: "task_xxx", name: "...", description: "...", complexity: "...", type: "..." })\` 注册到前端
3. 确定任务间的依赖关系和执行顺序
4. 决定执行策略：
   - **基础设施**（数据库schema、项目配置）→ 自己做
   - **独立的**（互不依赖的API、页面）→ 派给Worker并行做
   - **关键的**（集成测试、架构决策）→ 自己做

### Phase 3: 执行任务
对于每个任务：

**自己做的任务**：
1. 调用 \`UpdateTaskPlan({ action: "start_task", taskId: "xxx", executionMode: "lead-agent" })\`
2. 使用 Read/Write/Edit/Bash 等工具完成任务
3. 完成后调用 \`UpdateTaskPlan({ action: "complete_task", taskId: "xxx", summary: "..." })\`
4. 用 Bash 提交 Git

**派给 Worker 的任务**：
1. 调用 \`DispatchWorker({ taskId: "xxx", brief: "详细简报...", targetFiles: [...] })\`
   - DispatchWorker **自动**更新任务状态（start → complete/fail），无需手动调用 UpdateTaskPlan
2. Worker 完成后，审查结果：
   - 如果满意 → 继续下一个任务
   - 如果不满意 → 你自己修复，或重新派发（附加更详细的说明）

### Phase 4: 集成检查
所有任务完成后：
- 检查代码一致性（命名、风格、接口）
- 运行构建和测试
- 修复发现的集成问题

### Phase 5: E2E 端到端测试
集成检查通过后：
1. 调用 \`TriggerE2ETest({ appUrl: "http://localhost:3000" })\` 启动 E2E 浏览器测试
2. E2E Agent 会自动启动应用、打开浏览器、按业务流程验收、对比设计图
3. 审查 E2E 测试结果：
   - 如果通过 → 项目完成
   - 如果失败 → 根据报告修复代码，然后再次调用 TriggerE2ETest 验证（最多 3 轮）
4. 最终汇报执行结果

## UpdateTaskPlan 工具用法（任务状态管理）
**重要**：每次开始/完成自己做的任务时，必须调用此工具同步状态到前端。
\`\`\`
开始任务:   { "action": "start_task",    "taskId": "xxx", "executionMode": "lead-agent" }
完成任务:   { "action": "complete_task", "taskId": "xxx", "summary": "完成了..." }
失败任务:   { "action": "fail_task",     "taskId": "xxx", "error": "原因..." }
跳过任务:   { "action": "skip_task",     "taskId": "xxx", "reason": "此功能已存在" }
新增任务:   { "action": "add_task",      "taskId": "task_new_xxx", "name": "...", "description": "..." }
\`\`\`

## 失败重试策略（关键！）
**你必须主动处理失败的任务，不要等待用户干预。**

**自己执行的任务失败时**：
1. 分析错误原因（Read 相关文件、检查日志）
2. 修复问题后，重新 start_task → 执行 → complete_task
3. 最多重试 ${this.swarmConfig.maxRetries || 3} 次，仍然失败才标记 fail_task

**Worker 执行的任务失败时**：
1. 审查 Worker 返回的错误信息
2. 决定策略：
   - 简单问题 → 自己用 Read/Edit 直接修复，然后 complete_task
   - 需要重做 → 重新调用 DispatchWorker，提供更详细的 brief 和错误上下文
   - 确实无法完成 → 才标记 fail_task
3. **绝不直接放弃** - 先尝试至少一次修复或重试

**注意**：fail_task 是最后手段，不是默认选项。遇到错误先分析、修复、重试。

## DispatchWorker 工具用法（派发给Worker）
\`\`\`json
{
  "taskId": "task_xxx",
  "brief": "详细的上下文简报...",
  "targetFiles": ["src/xxx.ts", "src/yyy.ts"],
  "constraints": ["使用camelCase命名", "错误处理用AppError类"]
}
\`\`\`
**taskId 必须使用你在 Phase 2 中通过 add_task 创建的 ID**。

**Brief 写作指南**：
- ✅ "数据库schema在schema.prisma，User模型有id/email/name字段。路由入口在src/routes/index.ts，按authRoutes的模式添加。"
- ❌ "实现用户管理API"（太泛泛，Worker要浪费时间探索）

## TriggerE2ETest 工具用法（端到端测试）
\`\`\`json
{
  "appUrl": "http://localhost:3000",
  "similarityThreshold": 80,
  "model": "opus"
}
\`\`\`
**注意**：仅在 Phase 4 集成检查通过后使用。E2E Agent 会自动执行浏览器测试并返回结果。

## Git 提交规则
完成代码后必须提交：
\`\`\`bash
git add -A && git commit -m "[LeadAgent] 任务描述"
\`\`\`

## 重要原则
1. **先探索再动手** - 不理解代码就不写代码
2. **状态同步** - 自己做的任务必须用 UpdateTaskPlan 更新状态，让用户看到进度
3. **Brief 是灵魂** - 派给 Worker 的 brief 越详细，Worker 效率越高
4. **自己做关键任务** - 涉及全局决策的任务不要派给 Worker
5. **动态调整** - 发现计划有问题就用 UpdateTaskPlan 跳过/新增，不执行明知错误的计划
6. **保持一致性** - 你是唯一的大脑，确保所有代码风格和设计决策一致
7. **永不轻易放弃** - 任务失败时必须分析原因并尝试修复/重试，fail_task 是最后手段而非默认选项`;
  }

  /**
   * 构建 API 契约提示词（如果蓝图中有 API 契约，嵌入到系统提示词中）
   */
  private buildAPIContractPrompt(): string {
    const contract = this.blueprint.apiContract;
    if (!contract || !contract.endpoints || contract.endpoints.length === 0) {
      return '';
    }

    const endpointLines = contract.endpoints.map(ep =>
      `| ${ep.method} | ${contract.apiPrefix}${ep.path} | ${ep.description} | ${ep.requestBody || '-'} | ${ep.responseType || '-'} |`
    );

    return `### API 契约（前后端统一标准）
以下 API 设计已在需求收集阶段确认，开发时**必须遵循**这些路径和接口定义：

API 前缀: \`${contract.apiPrefix}\`

| 方法 | 路径 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
${endpointLines.join('\n')}

**重要**：前端和后端任务都必须使用上述 API 路径，不要自行发明新路径。`;
  }

  /**
   * TaskPlan 模式的系统提示词（精简版，聚焦任务执行）
   */
  private buildTaskPlanSystemPrompt(): string {
    const platform = os.platform();
    const platformInfo = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
    const shellHint = platform === 'win32'
      ? '\n- Windows 系统：使用 dir 代替 ls，使用 type 代替 cat'
      : '';
    const today = new Date().toISOString().split('T')[0];

    let gitInfo = '';
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.projectPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      gitInfo = `\nGit 分支: ${branch}`;
    } catch { /* ignore */ }

    const tech = this.blueprint.techStack;
    let techStackInfo = '';
    if (tech) {
      const parts: string[] = [];
      if (tech.language) parts.push(`语言: ${tech.language}`);
      if (tech.framework) parts.push(`框架: ${tech.framework}`);
      if (tech.uiFramework && tech.uiFramework !== 'none') parts.push(`UI: ${tech.uiFramework}`);
      if (tech.testFramework) parts.push(`测试: ${tech.testFramework}`);
      if (parts.length > 0) techStackInfo = `\n技术栈: ${parts.join(' | ')}`;
    }

    const originalPlan = this.config.blueprint as TaskPlan;
    const taskList = originalPlan.tasks
      .map((t, i) => `${i + 1}. [${t.id}] ${t.name}: ${t.description}${t.files?.length ? ` (文件: ${t.files.join(', ')})` : ''}`)
      .join('\n');

    return `你是 **LeadAgent（首席开发者）**，正在执行一组指定任务。

## 环境信息
- 平台: ${platformInfo}
- 日期: ${today}
- 项目路径: ${this.projectPath}${gitInfo}${techStackInfo}${shellHint}

## 任务目标
${originalPlan.goal}

## 上下文
${originalPlan.context}

## 任务列表
${taskList}

${originalPlan.constraints?.length ? `## 约束\n${originalPlan.constraints.map(c => `- ${c}`).join('\n')}\n` : ''}
${originalPlan.acceptanceCriteria?.length ? `## 验收标准\n${originalPlan.acceptanceCriteria.map(c => `- ${c}`).join('\n')}\n` : ''}
## 工作流程

### Phase 1: 探索代码库
使用 Read、Glob、Grep 工具探索现有代码库，理解当前状态。

### Phase 2: 注册任务
用 UpdateTaskPlan(add_task) 注册上面列出的每个任务。

### Phase 3: 执行任务
对于每个任务：
- **简单/自己做的任务**：UpdateTaskPlan(start_task) → 使用工具完成 → UpdateTaskPlan(complete_task)
- **独立/可并行的任务**：DispatchWorker(brief) → 自动更新状态

### Phase 4: 集成检查
所有任务完成后检查代码一致性，运行构建和测试。

## UpdateTaskPlan 工具用法
\`\`\`
开始任务:   { "action": "start_task",    "taskId": "xxx", "executionMode": "lead-agent" }
完成任务:   { "action": "complete_task", "taskId": "xxx", "summary": "完成了..." }
失败任务:   { "action": "fail_task",     "taskId": "xxx", "error": "原因..." }
跳过任务:   { "action": "skip_task",     "taskId": "xxx", "reason": "此功能已存在" }
新增任务:   { "action": "add_task",      "taskId": "task_new_xxx", "name": "...", "description": "..." }
\`\`\`

## DispatchWorker 工具用法
\`\`\`json
{ "taskId": "task_xxx", "brief": "详细的上下文简报...", "targetFiles": [...] }
\`\`\`

## 失败重试策略
- 自己做的任务失败 → 分析原因、修复、重试（最多 ${this.swarmConfig.maxRetries || 3} 次）
- Worker 任务失败 → 审查错误、自己修复或用更详细的 brief 重新派发
- fail_task 是最后手段，不是默认选项

## 重要原则
1. **先探索再动手** - 不理解代码就不写代码
2. **状态同步** - 自己做的任务必须用 UpdateTaskPlan 更新状态
3. **Brief 是灵魂** - 派给 Worker 的 brief 越详细，Worker 效率越高
4. **永不轻易放弃** - 任务失败时必须分析原因并尝试修复/重试

## Git 提交规则
完成代码后必须提交：
\`\`\`bash
git add -A && git commit -m "[LeadAgent] 任务描述"
\`\`\``;
  }

  /**
   * 构建初始用户提示词
   */
  private buildInitialPrompt(): string {
    if (this.sourceType === 'taskplan') {
      const plan = this.config.blueprint as TaskPlan;
      return `开始执行任务: ${plan.goal}

请按步骤进行：
1. 探索项目代码结构
2. 用 UpdateTaskPlan add_task 注册任务列表中的每个任务
3. 按顺序执行每个任务
4. 完成后做集成检查

开始吧！`;
    }

    return `现在开始执行项目: ${this.blueprint.name}

请按以下步骤进行：
1. 先用 Read/Glob 工具探索项目目录结构和关键文件
2. 基于需求和代码理解，制定任务计划（每个任务用 UpdateTaskPlan add_task 注册）
3. 按计划执行每个任务：
   - 自己做的任务：用 UpdateTaskPlan 标记 start_task/complete_task
   - 派给 Worker 的任务：用 DispatchWorker（自动更新状态）
4. 所有任务完成后进行集成检查

开始吧！`;
  }

  /**
   * 构建恢复模式的用户提示词
   * 告诉 LeadAgent 之前已有的任务树和进度，让它从中断位置继续
   */
  private buildResumePrompt(): string {
    const tasks = this.executionPlan?.tasks || [];
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const failedTasks = tasks.filter(t => t.status === 'failed');
    const skippedTasks = tasks.filter(t => t.status === 'skipped');
    const pendingTasks = tasks.filter(t => t.status === 'pending');
    const runningTasks = tasks.filter(t => t.status === 'running');

    let taskSummary = '## 当前任务计划状态\n\n';

    if (completedTasks.length > 0) {
      taskSummary += `### ✅ 已完成的任务 (${completedTasks.length}个)\n`;
      completedTasks.forEach(t => {
        taskSummary += `- [${t.id}] ${t.name}: ${t.description || ''}\n`;
      });
      taskSummary += '\n';
    }

    if (failedTasks.length > 0) {
      taskSummary += `### ❌ 失败的任务 (${failedTasks.length}个)\n`;
      failedTasks.forEach(t => {
        taskSummary += `- [${t.id}] ${t.name}: ${t.description || ''}\n`;
      });
      taskSummary += '\n';
    }

    if (skippedTasks.length > 0) {
      taskSummary += `### ⏭️ 跳过的任务 (${skippedTasks.length}个)\n`;
      skippedTasks.forEach(t => {
        taskSummary += `- [${t.id}] ${t.name}\n`;
      });
      taskSummary += '\n';
    }

    if (runningTasks.length > 0) {
      taskSummary += `### 🔄 中断时正在执行的任务 (${runningTasks.length}个)\n`;
      runningTasks.forEach(t => {
        taskSummary += `- [${t.id}] ${t.name}: ${t.description || ''}\n`;
      });
      taskSummary += '\n';
    }

    if (pendingTasks.length > 0) {
      taskSummary += `### ⏳ 待执行的任务 (${pendingTasks.length}个)\n`;
      pendingTasks.forEach(t => {
        taskSummary += `- [${t.id}] ${t.name}: ${t.description || ''}\n`;
      });
      taskSummary += '\n';
    }

    return `你正在恢复执行项目: ${this.blueprint.name}

**重要**：这是一次恢复执行，不是全新开始。之前的执行被中断了，现在需要从中断位置继续。

${taskSummary}

## 恢复执行要求
1. **不要重新生成任务计划** - 任务计划已经存在，不需要再次调用 add_task 来创建已有的任务
2. **不要重复执行已完成的任务** - 已完成的任务不需要重做
3. **从中断处继续** - 优先处理之前中断的"正在执行"的任务，然后继续剩余的"待执行"任务
4. **失败的任务** - 可以尝试重新执行失败的任务（先用 start_task 标记开始）
5. 对于每个任务：
   - 自己做的任务：用 UpdateTaskPlan 标记 start_task/complete_task
   - 派给 Worker 的任务：用 DispatchWorker（自动更新状态）
6. 所有任务完成后进行集成检查

请从${runningTasks.length > 0 ? '中断的任务' : '待执行的任务'}开始继续执行！`;
  }

  /**
   * 运行 LeadAgent
   * 这是核心方法 - 创建持久 ConversationLoop 并驱动整个执行
   */
  async run(): Promise<LeadAgentResult> {
    this.startTime = Date.now();

    this.emitLeadEvent('lead:started', {
      blueprintId: this.blueprint.id,
      projectPath: this.projectPath,
      model: this.config.model || this.swarmConfig.leadAgentModel || 'sonnet',
    });

    // 设置 UpdateTaskPlan 工具的上下文
    // 即使 executionPlan 为空壳（tasks=[]），也需要设置上下文
    // LeadAgent 会通过 add_task 动态填充任务
    if (!this.executionPlan) {
      this.executionPlan = {
        id: `plan-${Date.now()}`,
        blueprintId: this.blueprint.id,
        tasks: [],
        parallelGroups: [],
        estimatedMinutes: 0,
        estimatedCost: 0,
        autoDecisions: [],
        status: 'ready',
        createdAt: new Date(),
      };
    }
    // 设置 UpdateTaskPlan 工具的静态上下文
    // 回调链路: UpdateTaskPlan.execute() → onPlanUpdate → LeadAgent.emit('task:plan_update') → Coordinator
    UpdateTaskPlanTool.setContext({
      executionPlan: this.executionPlan,
      blueprintId: this.blueprint.id,
      onPlanUpdate: (update: TaskPlanUpdateInput) => {
        this.emit('task:plan_update', update);
      },
    });

    // 设置 DispatchWorker 工具的静态上下文
    DispatchWorkerTool.setLeadAgentContext({
      blueprint: this.blueprint,
      projectPath: this.projectPath,
      swarmConfig: this.swarmConfig,
      techStack: this.blueprint.techStack as any || { language: 'unknown', packageManager: 'npm' },
      onTaskEvent: (event) => {
        // 转发 Worker 事件给 Coordinator/WebSocket
        this.emit(event.type, event.data);
      },
      onTaskResult: (taskId: string, result: TaskResult) => {
        this.taskResults.set(taskId, result);
      },
    });

    // 设置 TriggerE2ETest 工具的静态上下文
    TriggerE2ETestTool.setContext({
      blueprint: this.blueprint,
      projectPath: this.projectPath,
      techStack: this.blueprint.techStack as any || { language: 'unknown', packageManager: 'npm' },
      onEvent: (event) => {
        this.emit(event.type, event.data);
      },
      onComplete: (result) => {
        this.emit('lead:e2e_completed', result);
      },
    });

    // 创建持久的 ConversationLoop
    const model = this.config.model || this.swarmConfig.leadAgentModel || 'sonnet';
    const maxTurns = this.config.maxTurns || this.swarmConfig.leadAgentMaxTurns || 200;

    const systemPrompt = this.buildSystemPrompt();

    // 从 AGENT_TOOL_CONFIGS 获取 LeadAgent 的工具白名单，避免注入全量工具浪费 token
    const leadToolConfig = AGENT_TOOL_CONFIGS['lead-agent'];
    const allowedTools = leadToolConfig?.allowedTools !== '*'
      ? leadToolConfig?.allowedTools
      : undefined;

    this.loop = new ConversationLoop({
      model,
      maxTurns,
      verbose: false,
      permissionMode: 'bypassPermissions',
      workingDir: this.projectPath,
      systemPrompt,
      isSubAgent: true,
      askUserHandler: this.config.askUserHandler as any,
      allowedTools,
    });

    // 发射 LeadAgent 的 system_prompt 事件，供前端查看
    this.emit('lead:system_prompt', { systemPrompt });

    // v9.2: 自愈循环 - 当 LeadAgent 因网络错误死亡但仍有未完成任务时，自动重启
    const maxSelfHealRetries = this.swarmConfig.maxRetries || 3;
    let selfHealAttempts = 0;
    let isResumeRun = this.config.isResume || false;
    let lastResponse = '';

    while (true) {
      // 构建提示词：首次使用初始/恢复提示词，自愈重启使用恢复提示词
      const prompt = isResumeRun
        ? this.buildResumePrompt()
        : this.buildInitialPrompt();
      const messageStream = this.loop!.processMessageStream(prompt);

      let loopDiedFromError = false;

      try {
        for await (const event of messageStream) {
          switch (event.type) {
            case 'text':
              if (event.content) {
                lastResponse += event.content;
                this.emit('lead:stream', {
                  type: 'text',
                  content: event.content,
                });
              }
              break;

            case 'tool_start':
              this.emit('lead:stream', {
                type: 'tool_start',
                toolName: event.toolName,
                toolInput: event.toolInput,
              });

              // 检测关键阶段
              if (event.toolName === 'Glob' || event.toolName === 'Read' || event.toolName === 'Grep') {
                this.emitLeadEvent('lead:exploring', {
                  tool: event.toolName,
                  input: event.toolInput,
                });
              } else if (event.toolName === 'DispatchWorker') {
                this.emitLeadEvent('lead:dispatch', {
                  taskId: (event.toolInput as any)?.taskId,
                  brief: (event.toolInput as any)?.brief?.substring(0, 200),
                });
              } else if (event.toolName === 'Write' || event.toolName === 'Edit') {
                this.emitLeadEvent('lead:executing', {
                  tool: event.toolName,
                  file: (event.toolInput as any)?.file_path || (event.toolInput as any)?.filePath,
                });
              }
              break;

            case 'tool_end':
              this.emit('lead:stream', {
                type: 'tool_end',
                toolName: event.toolName,
                toolResult: event.toolResult,
                toolError: event.toolError,
              });
              break;

            case 'done':
            case 'interrupted':
              break;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        loopDiedFromError = true;
        console.error(`[LeadAgent] Loop 异常退出: ${errorMsg}`);

        this.emit('lead:stream', {
          type: 'text',
          content: `\n⚠️ [LeadAgent] 遇到错误: ${errorMsg}，检查是否需要自愈重启...\n`,
        });
      }

      // v9.2: 检查是否需要自愈重启
      // 条件：Loop 异常退出 + 还有未完成的任务 + 未超过重试次数
      const hasPendingTasks = this.executionPlan?.tasks.some(
        t => t.status === 'pending' || t.status === 'running'
      );

      if (loopDiedFromError && hasPendingTasks && selfHealAttempts < maxSelfHealRetries) {
        selfHealAttempts++;
        const delay = 2000 * Math.pow(2, selfHealAttempts - 1); // 2s, 4s, 8s
        console.log(`[LeadAgent] 自愈重启 (${selfHealAttempts}/${maxSelfHealRetries}): 还有未完成的任务，${delay}ms 后以 resume 模式重启...`);

        this.emit('lead:stream', {
          type: 'text',
          content: `\n🔄 [LeadAgent] 自愈重启 (${selfHealAttempts}/${maxSelfHealRetries})...\n`,
        });

        await new Promise(r => setTimeout(r, delay));

        // 将卡在 running 的任务重置为 pending（直接修改共享的 executionPlan 对象）
        // 不需要 emit 事件，LeadAgent 恢复后会通过 UpdateTaskPlan(start_task) 重新通知前端
        if (this.executionPlan) {
          for (const task of this.executionPlan.tasks) {
            if (task.status === 'running') {
              task.status = 'pending';
              task.startedAt = undefined;
            }
          }
        }

        // 重建 ConversationLoop（旧的可能状态已损坏）
        this.loop = new ConversationLoop({
          model: this.config.model || this.swarmConfig.leadAgentModel || 'sonnet',
          maxTurns: this.config.maxTurns || this.swarmConfig.leadAgentMaxTurns || 200,
          verbose: false,
          permissionMode: 'bypassPermissions',
          workingDir: this.projectPath,
          systemPrompt: this.buildSystemPrompt(),
          isSubAgent: true,
          askUserHandler: this.config.askUserHandler as any,
          allowedTools,
        });

        isResumeRun = true; // 下一轮使用恢复提示词
        continue; // 重新进入 while 循环
      }

      // 正常退出或重试耗尽，跳出循环
      if (loopDiedFromError && selfHealAttempts >= maxSelfHealRetries) {
        console.error(`[LeadAgent] 自愈重试耗尽 (${maxSelfHealRetries} 次)，放弃重启`);
        this.emit('lead:stream', {
          type: 'text',
          content: `\n❌ [LeadAgent] 自愈重试耗尽，无法继续执行\n`,
        });
      }
      break;
    }

    // 执行完成
    const durationMs = Date.now() - this.startTime;
    const completedTasks: string[] = [];
    const failedTasks: string[] = [];

    for (const [taskId, result] of this.taskResults) {
      if (result.success) {
        completedTasks.push(taskId);
      } else {
        failedTasks.push(taskId);
      }
    }

    this.emitLeadEvent('lead:completed', {
      success: failedTasks.length === 0,
      completedTasks: completedTasks.length,
      failedTasks: failedTasks.length,
      durationMs,
    });

    return {
      success: failedTasks.length === 0,
      completedTasks,
      failedTasks,
      estimatedTokens: 0, // TODO: 从 loop 获取
      estimatedCost: 0,
      durationMs,
      summary: lastResponse.substring(0, 1000),
      rawResponse: lastResponse,  // v10.0: 完整输出给 Planner Agent
      taskResults: this.taskResults,
    };
  }

  /**
   * 停止 LeadAgent
   * 调用 ConversationLoop.abort() 中断当前 API 请求和执行循环
   */
  stop(): void {
    // 清理工具静态上下文
    UpdateTaskPlanTool.clearContext();
    DispatchWorkerTool.clearContext();
    TriggerE2ETestTool.clearContext();
    if (this.loop) {
      this.loop.abort();
      this.loop = null;
    }
  }

  /**
   * 获取当前 Loop（用于插嘴功能）
   */
  getLoop(): ConversationLoop | null {
    return this.loop;
  }

  /**
   * 获取调试信息（探针功能）
   * 返回 LeadAgent 当前的系统提示词、消息体、工具列表等
   */
  getDebugInfo(): { systemPrompt: string; messages: unknown[]; tools: unknown[]; model: string; messageCount: number; agentType: string } | null {
    if (!this.loop) {
      return null;
    }
    const info = this.loop.getDebugInfo();
    return {
      ...info,
      agentType: 'lead-agent',
    };
  }

  /**
   * 用户插嘴 - 向正在执行的 LeadAgent 发送消息
   * 将用户消息注入到当前对话的 Session 中，
   * ConversationLoop 在下一轮 API 调用时会自动包含这条消息
   */
  interject(message: string): boolean {
    if (!this.loop) {
      console.warn('[LeadAgent] 插嘴失败：当前没有正在执行的 Loop');
      return false;
    }

    try {
      const session = this.loop.getSession();
      session.addMessage({
        role: 'user',
        content: `[用户插嘴] ${message}`,
      });

      console.log(`[LeadAgent] 用户插嘴: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);

      // 发射流式事件通知前端显示插嘴消息
      this.emit('lead:stream', {
        blueprintId: this.blueprint.id,
        streamType: 'text',
        content: `\n💬 [用户插嘴] ${message}\n`,
      });

      return true;
    } catch (err) {
      console.error('[LeadAgent] 插嘴失败:', err);
      return false;
    }
  }
}
