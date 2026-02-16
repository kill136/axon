/**
 * 自治 Worker Executor v3.1
 *
 * 蜂群架构核心组件 - 真正自治的 Worker
 * AI 通过 UpdateTaskStatus 工具自主汇报状态
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

import type {
  SmartTask,
  TaskResult,
  FileChange,
  WorkerDecision,
  ModelType,
  SwarmConfig,
  TechStack,
  DesignImage,
  Blueprint,
} from './types.js';
import { ConversationLoop } from '../core/loop.js';
import { AGENT_TOOL_CONFIGS } from '../agents/tools.js';
import { findClaudeMd } from '../rules/index.js';
// v10.0: collectWorkerSummary 不再需要 — Worker 的 raw text 直接返回给 LeadAgent

// ============================================================================
// 类型定义
// ============================================================================

/** 依赖任务的产出信息 */
export interface DependencyOutput {
  taskId: string;
  taskName: string;
  /** 产出的文件路径列表 */
  files: string[];
  /** 任务完成的简要描述（帮助后续任务理解语义） */
  summary?: string;
}

export interface WorkerContext {
  projectPath: string;
  techStack: TechStack;
  config: SwarmConfig;
  constraints?: string[];
  /** 依赖任务的产出（前置任务创建/修改的文件） */
  dependencyOutputs?: DependencyOutput[];
  /** UI 设计图（只含文件路径，Worker 用 Read 工具按需读取） */
  designImages?: DesignImage[];
  /** 共享的 System Prompt（跨 Worker 复用） */
  sharedSystemPromptBase?: string;
  /** Blueprint 信息（用于全局上下文） */
  blueprint?: Pick<Blueprint, 'id' | 'name' | 'description' | 'requirements' | 'techStack' | 'constraints'>;
  /** 相关任务状态（用于上下文判断） */
  relatedTasks?: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  /** v5.0: 蜂群共享记忆文本（精简版，直接注入 Prompt） */
  swarmMemoryText?: string;
  /** v5.0: 蓝图文件路径（Worker 可用 Read 工具查看详情） */
  blueprintPath?: string;
}

export type WorkerEventType =
  | 'stream:text'
  | 'stream:thinking'
  | 'stream:tool_start'
  | 'stream:tool_end'
  | 'stream:system_prompt'  // v4.6: Agent System Prompt（透明展示）
  | 'task:completed'
  | 'task:failed'
  | 'ask:request';  // v4.2: AskUserQuestion 请求

/**
 * v4.2: AskUserQuestion 请求事件数据
 */
export interface WorkerAskUserRequestEvent {
  workerId: string;
  taskId: string;
  requestId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
}

/**
 * v4.2: AskUserQuestion 响应数据
 */
export interface WorkerAskUserResponseData {
  answers: Record<string, string>;
  cancelled?: boolean;
}

// ============================================================================
// 自治 Worker Executor
// ============================================================================

export class AutonomousWorkerExecutor extends EventEmitter {
  public workerId: string;
  private defaultModel: ModelType;
  private maxTurns: number;
  // v4.2: 等待用户响应的 Promise 回调
  private pendingAskUserResolvers: Map<string, {
    resolve: (data: WorkerAskUserResponseData) => void;
    reject: (error: Error) => void;
  }> = new Map();
  // v4.2: 当前正在执行的任务 ID（用于 ask:request 事件）
  private currentTaskId: string | null = null;
  // v4.5: 当前执行的 ConversationLoop 实例（用于插嘴功能）
  private currentLoop: ConversationLoop | null = null;

  /**
   * v5.0: 构建共享的 System Prompt 基础部分
   * 在 RealTaskExecutor 中调用一次，然后复用给所有 Worker
   * 节省 ~3000 tokens × (N-1) Workers
   * v5.6: 简化为串行模式，移除并行模式相关代码
   */
  static buildSharedSystemPromptBase(techStack: TechStack, projectPath?: string): string {
    // v5.6: 串行模式 - Worker 用 Bash 提交 Git
    const gitCommitRule = `## ⚠️ 最重要规则 - Git 提交（必须遵守！）

**任务完成流程（顺序不能变）：**
1. 用 Write/Edit 工具完成代码编写
2. 用 Bash 提交 Git：
   \`\`\`bash
   git add -A && git commit -m "[Task] 你的任务名称: 简要描述"
   \`\`\`
3. Git 提交成功后，输出一段总结说明你做了什么

💡 **Git 问题自己修复**：
- user.email 未配置 → \`git config user.email "worker@local"\`
- index.lock 存在 → \`rm -f .git/index.lock\`（Windows: \`del .git\\index.lock\`）
- 其他问题 → 根据错误信息自己诊断修复`;

    // v5.1: 添加完整环境信息，与官方 CLI 保持一致
    const platform = os.platform();
    const platformInfo = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
    const shellHint = platform === 'win32'
      ? '\n- Windows 系统：使用 dir 代替 ls，使用 cd 代替 pwd，使用 type 代替 cat'
      : '';

    // 检查是否是 git 仓库
    const isGitRepo = projectPath ? fs.existsSync(path.join(projectPath, '.git')) : false;

    // v5.6: 获取 Git 状态信息，注入到环境中让 Worker 知道当前状态
    let gitStatusInfo = '';
    let gitBranch = '';
    if (isGitRepo && projectPath) {
      try {
        // 获取当前分支
        gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();

        // 获取简短的 Git 状态（只显示修改的文件）
        const status = execSync('git status --short', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim();

        if (status) {
          // 限制显示的文件数量
          const lines = status.split('\n');
          const displayLines = lines.slice(0, 10);
          const moreCount = lines.length > 10 ? lines.length - 10 : 0;
          gitStatusInfo = `\nGit status (uncommitted changes):\n${displayLines.join('\n')}${moreCount > 0 ? `\n... and ${moreCount} more files` : ''}`;
        } else {
          gitStatusInfo = '\nGit status: Clean (no uncommitted changes)';
        }
      } catch {
        // Git 命令失败，忽略
        gitStatusInfo = '\nGit status: Unable to retrieve';
      }
    }

    // 获取今天的日期
    const today = new Date().toISOString().split('T')[0];

    return `你是自治开发 Worker，直接用工具执行任务。

${gitCommitRule}

## 基本规则
- 直接执行，不讨论${shellHint}

## 蜂群协作
你在一个多 Worker 团队中工作。执行过程中可能收到 **[蜂群更新]** 或 **[用户插嘴]** 消息：

**处理原则**：
- **不要被打断** - 收到更新后继续当前工作，不要停下来讨论
- **记住信息** - 更新中的 API 路径、完成的任务等信息，在需要时使用
- **不主动询问** - 不要问"我看到了更新，需要我做什么吗？"

**示例**：
- 收到 "[蜂群更新] 用户管理后端 已完成, 新 API: POST /api/users"
- 正确做法：记住这个 API，继续你的前端任务，需要调用时直接用
- 错误做法：停下来说"我注意到后端完成了，请问..."

## 环境问题处理
**你没有解决不了的问题！** 你能力很强，可以解决几乎所有问题。

### 自己直接解决
1. **缺少 npm/pip 包** → npm install xxx / pip install xxx
2. **缺少配置文件** → 复制 .env.example 为 .env
3. **需要构建** → npm run build / cargo build
4. **程序未启动** → 用系统命令启动
5. **docker-compose 服务** → docker-compose up -d
6. **本地数据库** → 检查 sqlite 选项或内存模式

### 安装软件（你可以做到！）
软件未安装？直接安装它！

**Windows:** \`winget install Docker.DockerDesktop\` / \`winget install OpenJS.NodeJS.LTS\`
**macOS:** \`brew install node\` / \`brew install --cask docker\`
**Linux:** \`sudo apt-get install -y nodejs npm\` / \`sudo apt-get install -y docker.io\`

安装后记得验证：\`node --version\`、\`docker --version\`

### 请求用户帮助（使用 AskUserQuestion）
只有以下情况才需要询问用户：
- **需要 API 密钥/敏感信息** → 询问用户提供
- **安装失败需要手动操作** → 询问用户处理
- **有多种方案不确定选哪个** → 询问用户选择
- **需要付费服务** → 询问用户是否愿意

**原则**：
- 先尝试自己解决，包括安装软件
- 只有真正需要用户输入信息时才询问
- 不要含糊地说"环境问题"，要说清楚具体问题
- 遇到问题先用 Bash 探索（\`where docker\`、\`which python\`）

<env>
Working directory: ${projectPath || process.cwd()}
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}${gitBranch ? `\nCurrent branch: ${gitBranch}` : ''}${gitStatusInfo}
Platform: ${platformInfo}
Today's date: ${today}
</env>

## 技术栈
${techStack.language}${techStack.framework ? ' + ' + techStack.framework : ''}`;
  }

  constructor(config?: Partial<SwarmConfig>) {
    super();
    this.workerId = `worker-${uuidv4().slice(0, 8)}`;
    this.defaultModel = config?.defaultModel ?? 'sonnet';
    this.maxTurns = 50;
  }

  /**
   * 获取 Worker ID
   */
  getWorkerId(): string {
    return this.workerId;
  }

  /**
   * v4.5: 获取当前正在执行的任务 ID
   * 用于 WebSocket 处理器查找执行特定任务的 Worker
   */
  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  /**
   * v4.2: 响应用户的 AskUserQuestion 请求
   * 由外部调用（如 WebSocket handler）来提供用户的答案
   */
  resolveAskUser(requestId: string, response: WorkerAskUserResponseData): void {
    const resolver = this.pendingAskUserResolvers.get(requestId);
    if (resolver) {
      resolver.resolve(response);
      this.pendingAskUserResolvers.delete(requestId);
    }
  }

  /**
   * 获取调试信息（探针功能）
   * 返回 Worker 当前的系统提示词、消息体、工具列表等
   */
  getDebugInfo(): { systemPrompt: string; messages: unknown[]; tools: unknown[]; model: string; messageCount: number; agentType: string; workerId: string; taskId: string | null } | null {
    if (!this.currentLoop) {
      return null;
    }
    const info = this.currentLoop.getDebugInfo();
    return {
      ...info,
      agentType: 'worker',
      workerId: this.workerId,
      taskId: this.currentTaskId,
    };
  }

  /**
   * v4.5: 用户插嘴 - 在任务执行期间注入用户消息
   *
   * 工作原理：
   * 1. 将用户消息添加到当前对话的 Session 中
   * 2. ConversationLoop 在下一轮 API 调用时会自动包含这条消息
   * 3. AI 会看到并响应用户的插嘴内容
   *
   * @param message 用户要发送给 Worker 的消息
   * @returns 是否成功注入消息
   */
  interject(message: string): boolean {
    if (!this.currentLoop) {
      this.log('插嘴失败：当前没有正在执行的任务');
      return false;
    }

    try {
      const session = this.currentLoop.getSession();
      session.addMessage({
        role: 'user',
        content: `[用户插嘴] ${message}`,
      });

      this.log(`用户插嘴: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);

      // 发射事件通知前端
      this.emit('stream:text', {
        workerId: this.workerId,
        task: { id: this.currentTaskId },
        content: `\n[用户插嘴] ${message}\n`,
      });

      return true;
    } catch (error) {
      this.log(`插嘴失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * v5.7: 中止当前执行的任务
   * 用于超时或用户取消时立即停止 Worker
   *
   * 工作原理：
   * 1. 调用 ConversationLoop.abort() 中止 API 请求
   * 2. 清理待处理的 AskUser 请求
   * 3. 重置当前任务状态
   *
   * @returns 是否成功中止
   */
  abort(): boolean {
    const hadActiveTask = this.currentLoop !== null;

    // 中止 ConversationLoop（会取消正在进行的 API 请求）
    if (this.currentLoop) {
      this.log('正在中止任务执行...');
      this.currentLoop.abort();
      this.currentLoop = null;
    }

    // 拒绝所有待处理的 AskUser 请求
    this.pendingAskUserResolvers.forEach((resolver, requestId) => {
      resolver.reject(new Error('Task execution aborted'));
    });
    this.pendingAskUserResolvers.clear();

    // 清理当前任务 ID
    const taskId = this.currentTaskId;
    this.currentTaskId = null;

    if (hadActiveTask) {
      this.log(`任务已中止: ${taskId || 'unknown'}`);
      this.emit('task:aborted', {
        workerId: this.workerId,
        taskId,
      });
    }

    return hadActiveTask;
  }

  /**
   * v5.7: 检查是否有正在执行的任务
   */
  isExecuting(): boolean {
    return this.currentLoop !== null && this.currentTaskId !== null;
  }

  /**
   * v4.2: 创建 askUserHandler 回调
   * 发射事件并等待响应
   */
  private createAskUserHandler(taskId: string): (input: { questions: WorkerAskUserRequestEvent['questions'] }) => Promise<WorkerAskUserResponseData> {
    return async (input) => {
      const requestId = `worker-ask-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      return new Promise<WorkerAskUserResponseData>((resolve, reject) => {
        // 保存 resolver
        this.pendingAskUserResolvers.set(requestId, { resolve, reject });

        // 发射事件
        const event: WorkerAskUserRequestEvent = {
          workerId: this.workerId,
          taskId,
          requestId,
          questions: input.questions,
        };
        this.emit('ask:request', event);

        // 设置超时（5 分钟）
        setTimeout(() => {
          if (this.pendingAskUserResolvers.has(requestId)) {
            this.pendingAskUserResolvers.delete(requestId);
            reject(new Error('AskUserQuestion timeout: User did not respond within 5 minutes'));
          }
        }, 5 * 60 * 1000);
      });
    };
  }

  async execute(task: SmartTask, context: WorkerContext): Promise<TaskResult> {
    const decisions: WorkerDecision[] = [];
    const writtenFiles: FileChange[] = [];
    // v3.2: 追踪工具调用
    let toolCallCount = 0;
    // v3.3: 追踪测试运行
    let testsRan = false;
    let testsPassed = false;
    // v10.0: 收集 Worker 完整文本输出（对齐 TaskTool 模式）
    let rawResponse = '';

    this.log(`开始执行任务: ${task.name}`);

    const model = this.selectModel(task);
    decisions.push({
      type: 'strategy',
      description: `模型: ${model}（${task.complexity}）`,
      timestamp: new Date(),
    });

    // v4.2: 记录当前任务 ID（用于 ask:request 事件）
    this.currentTaskId = task.id;

    try {
      // v4.6: 构建并保存 systemPrompt，用于透明展示
      const systemPrompt = this.buildSystemPrompt(task, context);

      // 从 AGENT_TOOL_CONFIGS 获取 Worker 的工具白名单，避免注入全量工具浪费 token
      const workerToolConfig = AGENT_TOOL_CONFIGS['worker'];
      const allowedTools = workerToolConfig?.allowedTools !== '*'
        ? workerToolConfig?.allowedTools as string[]
        : undefined;

      const loop = new ConversationLoop({
        model,
        maxTurns: this.maxTurns,
        verbose: false,
        permissionMode: 'bypassPermissions',
        workingDir: context.projectPath,
        systemPrompt,
        isSubAgent: true,
        // v4.2: 使用自定义 askUserHandler 支持 WebUI 交互
        askUserHandler: this.createAskUserHandler(task.id),
        allowedTools,
      });

      // v4.5: 保存 loop 引用以支持插嘴功能
      this.currentLoop = loop;

      // v4.6: 发射 system_prompt 事件，让前端可以查看 Agent 的指令
      this.emit('stream:system_prompt', {
        workerId: this.workerId,
        task,
        systemPrompt,
        agentType: 'worker',
      });

      // v3.5: 使用多模态任务提示（当是 UI 任务且有设计图时）
      const taskPrompt = this.buildMultimodalTaskPrompt(task, context);

      // 记录是否使用了设计图
      if (Array.isArray(taskPrompt) && context.designImages?.length) {
        this.log(`使用设计图参考: ${context.designImages.length} 张`);
        decisions.push({
          type: 'strategy',
          description: `使用 ${context.designImages.length} 张 UI 设计图作为参考`,
          timestamp: new Date(),
        });
      }

      // v10.0: 对齐 TaskTool 模式 — 收集完整文本输出，让 LeadAgent 获得完整上下文
      const messageStream = loop.processMessageStream(taskPrompt);

      for await (const event of messageStream) {
        // v10.0: 收集 raw text（对齐 TaskTool 的 response += event.content）
        if (event.type === 'text' && event.content) {
          rawResponse += event.content;
        }

        // v3.2: 统计工具调用
        if (event.type === 'tool_end' && event.toolName) {
          toolCallCount++;
          // v3.3: 检测测试运行
          if (event.toolName === 'Bash' && event.toolInput) {
            const input = event.toolInput as { command?: string };
            const command = input.command || '';
            if (/\b(npm\s+test|npm\s+run\s+test|vitest|jest|pytest|go\s+test|cargo\s+test)\b/i.test(command)) {
              testsRan = true;
              if (!event.toolError) {
                testsPassed = true;
              }
            }
          }
        }
        this.handleStreamEvent(event, task, writtenFiles, context);
      }

      // v10.0: 对齐 TaskTool — 直接返回 Worker 的完整文本输出
      // LeadAgent 从 raw text 中判断成功/失败，不再依赖 UpdateTaskStatus
      this.emit('task:completed', { workerId: this.workerId, task });

      return {
        success: true,
        changes: writtenFiles,
        testsRan,
        testsPassed,
        decisions,
        summary: rawResponse,
        fullSummary: rawResponse,
        rawResponse,
        reviewedBy: 'none' as const,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`任务执行失败: ${errorMsg}`);

      this.emit('task:failed', { workerId: this.workerId, task, error });

      return {
        success: false,
        changes: writtenFiles,
        error: errorMsg,
        decisions,
      };
    } finally {
      // v4.5: 清理 loop 引用
      this.currentLoop = null;
      this.currentTaskId = null;
    }
  }

  /**
   * 根据任务复杂度选择模型
   * 任务分解时已确定 complexity，直接映射即可，不需要 AI 再"选择"
   */
  private selectModel(task: SmartTask): ModelType {
    switch (task.complexity) {
      case 'complex': return 'opus';
      case 'moderate': return 'sonnet';
      case 'simple': return this.defaultModel;
      case 'trivial': return 'haiku';
      default: return this.defaultModel;
    }
  }

  private buildSystemPrompt(task: SmartTask, context: WorkerContext): string {
    // v4.0 Token 优化：精简 System Prompt，移除重复信息
    // 如果有共享的基础 Prompt，直接使用
    let base: string;
    if (context.sharedSystemPromptBase) {
      base = context.sharedSystemPromptBase;
    } else {
      // v5.6: 复用静态方法构建基础 Prompt
      base = AutonomousWorkerExecutor.buildSharedSystemPromptBase(
        context.techStack,
        context.projectPath
      );
    }

    const taskSpecific = this.buildTaskSpecificPrompt(task, context);

    // 注入 CLAUDE.md 项目规则，让 Worker 知道项目特定的命令、约束等
    const claudeMdSection = this.loadClaudeMdSection(context.projectPath);

    return base + taskSpecific + claudeMdSection;
  }

  /**
   * 读取项目 CLAUDE.md，返回可附加到系统提示词的摘要
   * Worker 需要这些信息来了解项目特定的构建命令、约束等
   */
  private loadClaudeMdSection(projectPath?: string): string {
    try {
      const claudeMdPath = findClaudeMd(projectPath);
      if (!claudeMdPath) return '';

      const content = fs.readFileSync(claudeMdPath, 'utf-8').trim();
      if (!content) return '';

      // 限制大小，避免过长的 CLAUDE.md 撑爆 token
      const maxLen = 4000;
      const truncated = content.length > maxLen
        ? content.slice(0, maxLen) + '\n... (truncated)'
        : content;

      return `\n\n## 项目规则 (CLAUDE.md)
${truncated}`;
    } catch {
      return '';
    }
  }

  /**
   * v4.0: 构建任务特定的额外提示
   * 注意：与 buildSystemPrompt 的后半部分逻辑保持一致
   */
  private buildTaskSpecificPrompt(task: SmartTask, context: WorkerContext): string {
    let extra = '';

    // 只在需要时添加测试指导
    if (task.type === 'test' || task.needsTest) {
      extra += `\n\n## 测试
运行 ${context.techStack.testFramework || 'npm test'} 验证`;
    }

    // 只在 UI 任务且有设计图时添加指导
    if (this.isUITask(task) && context.designImages?.length) {
      extra += `\n\n## UI
严格按设计图还原，注意布局颜色间距`;
    }

    return extra;
  }

  private buildTaskPrompt(task: SmartTask, context: WorkerContext): string {
    // v9.0: 如果有 LeadAgent 提供的 brief，优先使用
    // brief 包含了 LeadAgent 基于完整上下文写的详细说明
    if (task.brief) {
      let prompt = `# 任务：${task.name}

## 任务 ID
${task.id}

## LeadAgent 上下文简报
${task.brief}

## 目标文件
${task.files.length > 0 ? task.files.map(f => `- ${f}`).join('\n') : '（自行确定）'}
`;

      // 仍然附加技术栈、约束等基础信息
      const tech = context.techStack;
      const techInfo: string[] = [];
      if (tech.framework) techInfo.push(`框架: ${tech.framework}`);
      if (tech.uiFramework && tech.uiFramework !== 'none') techInfo.push(`UI库: ${tech.uiFramework}`);
      if (tech.cssFramework && tech.cssFramework !== 'none') techInfo.push(`CSS: ${tech.cssFramework}`);
      if (tech.testFramework) techInfo.push(`测试: ${tech.testFramework}`);
      if (techInfo.length > 0) {
        prompt += `\n## 技术栈\n${techInfo.join(' | ')}\n`;
      }

      if (context.constraints?.length) {
        prompt += `\n## 约束\n${context.constraints.map(c => `- ${c}`).join('\n')}\n`;
      }

      // 重试信息（如果有）
      if (task.lastReviewFeedback) {
        const feedback = task.lastReviewFeedback;
        prompt += `\n## ⚠️ 重试提醒（第 ${task.attemptCount || 1} 次尝试）\n上次失败原因: ${feedback.reasoning}\n`;
        if (feedback.issues?.length) {
          prompt += `问题: ${feedback.issues.join('; ')}\n`;
        }
        if (feedback.suggestions?.length) {
          prompt += `建议: ${feedback.suggestions.join('; ')}\n`;
        }
      }

      prompt += `\n## 执行要求
1. 首先用 Read 工具查看相关文件，理解现有代码
2. 使用 Write/Edit 工具完成代码编写
3. 完成后，输出一段文本总结你做了什么和关键的设计决策`;

      return prompt;
    }

    // 原始模式：没有 brief，使用泛泛描述
    let prompt = `# 任务：${task.name}

## 任务 ID
${task.id}

## 描述
${task.description}

## 类型
${task.type} (复杂度: ${task.complexity})

## 目标文件
${task.files.length > 0 ? task.files.map(f => `- ${f}`).join('\n') : '（自行确定）'}
`;

    // 技术栈信息
    const tech = context.techStack;
    const techInfo: string[] = [];
    if (tech.framework) techInfo.push(`框架: ${tech.framework}`);
    if (tech.uiFramework && tech.uiFramework !== 'none') techInfo.push(`UI库: ${tech.uiFramework}`);
    if (tech.cssFramework && tech.cssFramework !== 'none') techInfo.push(`CSS: ${tech.cssFramework}`);
    if (tech.testFramework) techInfo.push(`测试: ${tech.testFramework}`);
    if (tech.apiStyle) techInfo.push(`API: ${tech.apiStyle}`);
    if (techInfo.length > 0) {
      prompt += `\n## 技术栈\n${techInfo.join(' | ')}\n`;
    }

    if (context.constraints?.length) {
      prompt += `\n## 约束\n${context.constraints.map(c => `- ${c}`).join('\n')}\n`;
    }

    // v5.2: 精简依赖产出 - 只给相对路径，Worker 可以直接在当前工作目录中读取
    // 注意：这些路径是相对于项目根目录的，前置任务的代码已合并到主分支
    if (context.dependencyOutputs?.length) {
      prompt += `\n## 前置任务文件（相对路径，已合并到当前分支）\n`;
      for (const dep of context.dependencyOutputs) {
        // 单行紧凑格式，最多 3 个文件
        const files = dep.files.slice(0, 3).map(f => `\`${f}\``).join(', ');
        const extra = dep.files.length > 3 ? ` (+${dep.files.length - 3})` : '';
        prompt += `- ${dep.taskName}: ${files}${extra}\n`;
      }
    }

    // v8.1: 团队协作提示（乐观并发策略）
    // 不让 Worker 等待，直接开工。冲突在所有任务完成后由 Coordinator 检测并处理。
    if (task.files.length > 0) {
      prompt += `\n## 团队协作说明

你正在一个并行团队中工作。同组可能有其他 Worker 同时执行任务。

**规则很简单**：
- 直接开始执行你的任务，**不需要等待**其他 Worker
- 开始前读取你需要修改的文件，了解当前状态
- 完成后正常提交你的变更
- 如果发现文件内容不对或者有意外变化，正常执行即可，冲突会在事后自动检测和处理

**冲突处理**：
- 如果 Edit 工具返回 "File has been modified since it was read" 错误，说明另一个 Worker 刚修改了同一文件
- 这是正常的，**重新 Read 该文件，然后再 Edit 即可**

**不要做的事**：
- 不要用 sleep 或循环轮询等待其他任务
- 不要因为担心冲突而停止执行
`;
    }

    // v3.7: 如果有上次的 Review 反馈，添加到 prompt 中
    if (task.lastReviewFeedback) {
      const feedback = task.lastReviewFeedback;
      prompt += `\n## ⚠️ 重试提醒（第 ${task.attemptCount || 1} 次尝试）

上次执行被标记为 **${feedback.verdict === 'failed' ? '失败' : '需要修改'}**。

### 上次失败原因
${feedback.reasoning}

${feedback.issues?.length ? `### 具体问题\n${feedback.issues.map(i => `- ❌ ${i}`).join('\n')}\n` : ''}
${feedback.suggestions?.length ? `### 修改建议\n${feedback.suggestions.map(s => `- 💡 ${s}`).join('\n')}\n` : ''}
### 本次要求
请务必针对上述问题进行修复，确保：
1. 解决所有列出的具体问题
2. 按照建议进行修改
3. 不要重复同样的错误
`;
    }

    // v5.0: 注入蜂群共享记忆
    if (context.swarmMemoryText) {
      prompt += `\n${context.swarmMemoryText}\n`;
    }

    // v5.0: 根据任务类型给出 summary 引导
    const summaryGuide = this.getSummaryGuide(task);

    prompt += `\n## 执行要求
1. 首先用 Read 工具查看相关文件，理解现有代码
2. 使用 Write/Edit 工具完成代码编写
3. 创建新文件时使用具体名称（如 \`userValidation.ts\`），避免通用名称（如 \`helper.ts\`）
4. 完成后，输出一段文本总结你做了什么和关键设计决策
   ${summaryGuide}
5. 如果遇到无法解决的问题，输出详细的错误描述

## 开始
直接使用工具执行任务。`;

    return prompt;
  }

  /**
   * v5.0: 根据任务类型返回 summary 引导
   * 帮助 Worker 输出对后续任务有价值的 summary
   */
  private getSummaryGuide(task: SmartTask): string {
    switch (task.category) {
      case 'backend':
        return `**后端任务 summary 格式**: 列出 API 路径，如 "API: POST /api/users (创建), GET /api/users/:id (查询)"`;
      case 'frontend':
        return `**前端任务 summary 格式**: 列出组件和调用的 API，如 "组件: UserForm, UserList | 调用: POST /api/users"`;
      case 'shared':
        return `**共享任务 summary 格式**: 列出导出内容，如 "导出: User (类型), formatDate (函数)"`;
      case 'database':
        return `**数据库任务 summary 格式**: 列出表/模型，如 "创建: users 表 (id, name, email)"`;
      default:
        return `**summary 格式**: 简要描述完成的内容（供后续任务参考）`;
    }
  }

  /**
   * v3.5: 判断任务是否是 UI/前端任务
   * 直接读取 task.category，SmartPlanner 拆分任务时已标记好
   */
  private isUITask(task: SmartTask): boolean {
    // 直接使用 SmartPlanner 标记的 category，不再用关键词猜测
    return task.category === 'frontend';
  }

  /**
   * v5.0: 构建包含设计图引用的任务提示
   * 不再发送 base64 图片数据，而是告诉 Worker 设计图文件路径，让它用 Read 工具自己读取
   */
  private buildMultimodalTaskPrompt(
    task: SmartTask,
    context: WorkerContext
  ): string {
    const textPrompt = this.buildTaskPrompt(task, context);

    // 如果不是 UI 任务或没有设计图，直接返回文本提示
    if (!this.isUITask(task) || !context.designImages?.length) {
      return textPrompt;
    }

    // 获取已接受的设计图，如果没有则使用所有设计图
    const acceptedImages = context.designImages.filter(img => img.isAccepted);
    const imagesToUse = acceptedImages.length > 0 ? acceptedImages : context.designImages;

    // 只有带 filePath 的设计图才有意义
    const imagesWithPath = imagesToUse.filter(img => img.filePath);
    if (imagesWithPath.length === 0) {
      return textPrompt;
    }

    // 在提示中告诉 Worker 设计图位置，让它自己用 Read 工具读取
    const designRef = imagesWithPath.map(img => {
      const desc = img.description ? ` - ${img.description}` : '';
      return `- ${img.name} (${img.style}): \`${img.filePath}\`${desc}`;
    }).join('\n');

    return textPrompt + `

## UI 设计图

以下是 UI 设计图文件，请使用 Read 工具读取图片文件作为界面实现的参考，如果你的任务和UI样式无关可以不看：
${designRef}

请按照设计图的布局、颜色、间距实现界面。`;
  }

  private handleStreamEvent(
    event: any,
    task: SmartTask,
    writtenFiles: FileChange[],
    context: WorkerContext
  ): void {
    if (event.type === 'text' && event.content) {
      if (event.content.startsWith('[Thinking:')) {
        const content = event.content.replace(/^\[Thinking:\s*/, '').replace(/\]$/, '');
        this.emit('stream:thinking', { workerId: this.workerId, task, content });
      } else {
        this.emit('stream:text', { workerId: this.workerId, task, content: event.content });
      }
    } else if (event.type === 'tool_start' && event.toolName) {
      this.emit('stream:tool_start', {
        workerId: this.workerId,
        task,
        toolName: event.toolName,
        toolInput: event.toolInput,
      });
    } else if (event.type === 'tool_end' && event.toolName) {
      this.emit('stream:tool_end', {
        workerId: this.workerId,
        task,
        toolName: event.toolName,
        toolInput: event.toolInput,
        toolResult: event.toolResult,
        toolError: event.toolError,
      });

      // 追踪文件写入
      if ((event.toolName === 'Write' || event.toolName === 'Edit') && event.toolInput) {
        const input = event.toolInput as { file_path?: string; filePath?: string };
        const filePath = input.file_path || input.filePath;
        if (filePath && !event.toolError) {
          this.trackFileChange(filePath, event.toolName, writtenFiles, context.projectPath);
        }
      }

      // v10.0: UpdateTaskStatus 已移除 — Worker 的状态由 LeadAgent 从 raw text 判断
    }
  }

  private trackFileChange(
    filePath: string,
    toolName: string,
    writtenFiles: FileChange[],
    projectPath: string
  ): void {
    try {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectPath, filePath);

      if (fs.existsSync(absolutePath)) {
        const content = fs.readFileSync(absolutePath, 'utf-8');
        const existingIndex = writtenFiles.findIndex(f => f.filePath === absolutePath);
        if (existingIndex >= 0) {
          writtenFiles[existingIndex].content = content;
        } else {
          writtenFiles.push({
            filePath: absolutePath,
            type: toolName === 'Write' ? 'create' : 'modify',
            content,
          });
        }
      }
    } catch {
      // 忽略
    }
  }

  private log(message: string): void {
    console.log(`[${this.workerId}] ${message}`);
  }
}

export function createAutonomousWorker(config?: Partial<SwarmConfig>): AutonomousWorkerExecutor {
  return new AutonomousWorkerExecutor(config);
}

export default AutonomousWorkerExecutor;
