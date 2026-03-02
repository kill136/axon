/**
 * Task Reviewer Agent - 任务审查代理
 *
 * 设计理念：
 * - 分权制衡：执行者(Worker) ≠ 审核者(Reviewer)
 * - 自然语言理解：用 AI 判断任务是否完成，而不是机械规则
 * - 使用 ConversationLoop，与 Worker 使用相同的认证方式
 *
 * 工作流程：
 * Worker 执行 → 收集材料 → Reviewer 审查 → 返回结论
 */

import { SmartTask, ModelType, Blueprint, TechStack } from './types.js';
import { ConversationLoop } from '../core/loop.js';
import { getAgentDecisionMaker } from './agent-decision-maker.js';
import { SubmitReviewTool } from '../tools/submit-review.js';

// ============== 审查上下文 ==============

/**
 * v4.0: 审查上下文 - Reviewer 拥有的全局视角
 */
export interface ReviewContext {
  projectPath?: string;
  isRetry?: boolean;
  previousAttempts?: number;
  /** v6.1: 上次失败的审查反馈（让 Reviewer 知道之前失败的原因） */
  lastReviewFeedback?: {
    verdict: 'failed' | 'needs_revision';
    reasoning: string;
    issues?: string[];
    suggestions?: string[];
  };

  // v4.0: 全局上下文（类似 Queen 的视角）
  /** v6.1: 使用 Pick 引用 Blueprint 类型，避免内联重复定义 */
  blueprint?: Pick<Blueprint, 'id' | 'name' | 'description' | 'requirements' | 'techStack' | 'constraints'>;

  // 相关任务（上下文）
  relatedTasks?: Array<{
    id: string;
    name: string;
    status: string;
  }>;
}

// ============== 类型定义 ==============

/**
 * 审查结论
 */
export type ReviewVerdict = 'passed' | 'failed' | 'needs_revision';

/**
 * 工具调用记录（用于审查）
 */
export interface ToolCallRecord {
  name: string;
  input?: Record<string, any>;
  output?: string;
  error?: string;
  timestamp?: number;
}

/**
 * 文件变更记录
 */
export interface FileChangeRecord {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  contentPreview?: string;  // 变更内容预览（前 500 字符）
}

/**
 * Worker 执行结果（传给 Reviewer 的材料）
 */
export interface WorkerExecutionSummary {
  // Worker 自我汇报
  selfReported: {
    completed: boolean;
    message?: string;
  };

  // 工具调用摘要
  toolCalls: ToolCallRecord[];

  // 文件变更
  fileChanges: FileChangeRecord[];

  // 测试状态（如果有）
  testStatus?: {
    ran: boolean;
    passed: boolean;
    output?: string;
  };

  // 执行耗时
  durationMs: number;

  // 错误信息（如果有）
  error?: string;
}

/**
 * 审查结果
 */
export interface ReviewResult {
  verdict: ReviewVerdict;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;

  // v4.0: Reviewer 实际验证过的内容
  verified?: string[];

  // 如果失败，具体问题
  issues?: string[];

  // 如果需要修改，建议
  suggestions?: string[];

  // 审查耗时
  durationMs: number;

  // 使用的 token 数
  tokensUsed?: {
    input: number;
    output: number;
  };
}

/**
 * Reviewer 进度回调
 * v5.0: 新增进度反馈，让用户知道 Reviewer 在做什么
 */
export type ReviewProgressCallback = (step: {
  stage: 'checking_git' | 'verifying_files' | 'analyzing_quality' | 'completing';
  message: string;
  details?: any;
}) => void;

/**
 * Reviewer 配置
 */
export interface ReviewerConfig {
  // 是否启用（默认 true）
  enabled: boolean;

  // 模型选择（默认 haiku）
  model: 'haiku' | 'sonnet' | 'opus';

  // 审查严格程度
  strictness: 'lenient' | 'normal' | 'strict';

  // 最大重试次数
  maxRetries: number;

  // 超时时间（毫秒）
  timeoutMs: number;
}

const DEFAULT_CONFIG: ReviewerConfig = {
  enabled: true,
  model: 'opus',  // v4.0: Reviewer 和 Queen 必须用 opus（最强推理能力）
  strictness: 'normal',
  maxRetries: 2,
  timeoutMs: 60000,  // opus 需要更长时间
};

// ============== 核心实现 ==============

export class TaskReviewer {
  private config: ReviewerConfig;

  constructor(config: Partial<ReviewerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 审查 Worker 的工作成果
   * v4.0: 支持全局上下文（Blueprint 信息）
   * v5.0: 新增进度回调参数
   */
  async review(
    task: SmartTask,
    workerSummary: WorkerExecutionSummary,
    context?: ReviewContext,
    onProgress?: ReviewProgressCallback
  ): Promise<ReviewResult> {
    if (!this.config.enabled) {
      // 审查被禁用，直接通过
      return {
        verdict: 'passed',
        confidence: 'low',
        reasoning: 'Reviewer 已禁用，自动通过',
        durationMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      // v5.0: 发送进度 - 开始审查
      onProgress?.({
        stage: 'checking_git',
        message: '正在验证 Git 提交状态...',
        details: { taskId: task.id },
      });

      const prompt = this.buildReviewPrompt(task, workerSummary, context);
      const result = await this.callReviewer(prompt, context?.projectPath, onProgress);

      // v5.0: 发送进度 - 完成审查
      onProgress?.({
        stage: 'completing',
        message: `审查完成: ${result.verdict}`,
        details: { verdict: result.verdict, confidence: result.confidence },
      });

      return {
        ...result,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      // 根据项目规则：禁止降级方案，直接抛出错误
      console.error('[TaskReviewer] Review failed:', error);
      throw new Error(`Reviewer 审查过程出错: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * v4.0: 构建 Reviewer 的 System Prompt
   * v5.0: 优化 - 减少不必要的工具调用，聚焦改动验证
   * v6.0: 强制只返回 JSON，不要任何中间输出
   */
  private buildReviewerSystemPrompt(projectPath?: string): string {
    return `你是一个高级任务审查员（Reviewer），负责审查 Worker 的工作成果。

## 你的能力
- 你可以使用 Read、Glob、Grep、Bash 工具来**主动验证** Worker 的工作
- 你能看到整个项目，可以检查代码是否真的被修改
- 你是独立的第三方，不受 Worker 报告的影响

## 工作目录
${projectPath || '未指定'}

## 审查原则（v5.0 优化）
1. **优先验证 Git 提交**：最快最准确的方式是检查 git log 和 git status
2. **聚焦文件改动**：只验证 Worker 报告的改动文件，不要全量扫描
3. **按需深入**：只在发现问题时才深入检查文件内容
4. **理解意图**：理解任务的真正目标，而不是死板检查步骤

## 审查流程（精简版）
1. **第一步（必须）**：用 Bash 运行 \`git log -1 --oneline\` 验证最新提交
   - 如果有包含 "[Task]" 的新提交 → 继续第 2 步
   - 如果没有新提交 → 用 \`git status\` 检查是否有未提交改动
2. **第二步（按需）**：如果报告了文件改动，抽查 1-2 个关键文件验证代码质量
   - 优先验证核心业务逻辑文件
   - 不需要验证所有文件
3. **第三步（必须）**：返回 JSON 格式的审查结果

## 特殊情况
- "无文件变更"不等于"任务失败"，可能现有代码已满足要求
- 如果 Worker 说"已存在，无需修改"，验证文件是否确实满足要求
- 重新执行的任务，检查之前的问题是否已解决

## ⚠️ 关键输出要求（v6.0 - 工具调用）
**完成验证后，必须调用 SubmitReview 工具提交审查结果！**
- ✅ 使用 SubmitReview 工具提交结论（100% 可靠的结构化输出）
- ❌ 不要返回 JSON 文本（已废弃，容易解析出错）
- 📝 你可以在调用工具前输出验证过程的文字说明（方便调试）`;
  }

  /**
   * 构建审查 Prompt
   * v4.0: 包含 Blueprint 全局上下文
   */
  private buildReviewPrompt(
    task: SmartTask,
    summary: WorkerExecutionSummary,
    context?: ReviewContext
  ): string {
    const strictnessGuide = {
      lenient: '倾向于通过，只要核心目标达成即可',
      normal: '平衡判断，任务目标应该基本完成',
      strict: '严格审查，所有要求都必须满足',
    };

    // v4.0: 构建 Blueprint 全局上下文
    const blueprintContext = context?.blueprint ? `
## 全局上下文（Blueprint - 你的全局视角）

### 项目信息
- **蓝图ID**: ${context.blueprint.id}
- **项目名称**: ${context.blueprint.name}
- **项目描述**: ${context.blueprint.description}

${context.blueprint.requirements?.length ? `### 核心需求
${context.blueprint.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}
` : ''}
${context.blueprint.techStack ? `### 技术栈
- **语言**: ${context.blueprint.techStack.language}
${context.blueprint.techStack.framework ? `- **框架**: ${context.blueprint.techStack.framework}` : ''}
` : ''}
${context.blueprint.constraints?.length ? `### 约束条件
${context.blueprint.constraints.map(c => `- ${c}`).join('\n')}
` : ''}
` : '';

    // v4.0: 相关任务上下文
    const relatedTasksContext = context?.relatedTasks?.length ? `
### 相关任务状态
${context.relatedTasks.map(t => `- ${t.name}: ${t.status}`).join('\n')}
` : '';

    return `# 任务审查请求

你是一个独立的任务审查员（Reviewer）。你的职责是审查另一个 AI Agent（Worker）的工作成果，判断任务是否真正完成。
${blueprintContext}
## 审查原则
- ${strictnessGuide[this.config.strictness]}
- 理解任务的**意图**，而不是死板地检查每个步骤
- 考虑上下文：如果是重新执行的任务，"无需修改"可能是正确的结论
- 关注**结果**，而不是**过程**
- **结合全局上下文判断**：任务是否符合项目整体需求

## ⚠️ 环境问题判断规则（严格执行）

### 核心原则
**Worker 没有解决不了的问题！** Worker 遇到问题应该：
1. 先尝试自己解决
2. 自己解决不了的，使用 AskUserQuestion 请求用户帮助
3. 只有用户明确拒绝帮助时，才能标记为失败

### Worker 应该自己解决的问题
- 缺少 npm/pip 包 → 运行 install 命令
- 缺少配置文件 → 复制 .env.example 或创建配置
- 需要构建 → 运行 build 命令
- Docker 容器未启动 → docker-compose up -d
如果 Worker 没有尝试解决这些问题就放弃 → **needs_revision**

### Worker 应该请求用户帮助的问题
- 软件未安装 → 应使用 AskUserQuestion 询问用户
- 需要 API 密钥 → 应使用 AskUserQuestion 询问用户
- 需要数据库配置 → 应使用 AskUserQuestion 询问用户
- 权限不足 → 应使用 AskUserQuestion 询问用户
如果 Worker 没有请求用户帮助就放弃 → **needs_revision**
如果 Worker 请求了用户帮助，用户拒绝 → 可以 **passed**（在 issues 中注明）

### 判断标准
- 模糊的"环境问题"不可接受 → **failed**
- 必须有具体的错误信息和尝试记录
- 检查 Worker 是否调用了 AskUserQuestion 请求用户帮助
- 检查 Worker 的工具调用：是否真的运行了 npm install / docker-compose 等

## 任务信息
${relatedTasksContext}

### 任务描述
- **ID**: ${task.id}
- **名称**: ${task.name}
- **类型**: ${task.type || 'feature'}
- **详细描述**:
${task.description}

### 执行上下文
- **项目路径**: ${context?.projectPath || '未知'}
- **是否重新执行**: ${context?.isRetry ? '是' : '否'}
${context?.previousAttempts ? `- **之前尝试次数**: ${context.previousAttempts}` : ''}

## Worker 执行报告

### Worker 自我汇报
- **声称完成**: ${summary.selfReported.completed ? '是' : '否'}
${summary.selfReported.message ? `- **汇报信息**: ${summary.selfReported.message}` : ''}

### 文件变更 (共 ${summary.fileChanges.length} 个)
${this.formatFileChanges(summary.fileChanges)}

### 测试状态
${this.formatTestStatus(summary.testStatus)}

### 执行耗时
${Math.round(summary.durationMs / 1000)} 秒

${summary.error ? `### 错误信息\n${summary.error}` : ''}

## 你的任务

**v5.0 优化：聚焦改动验证，减少不必要的工具调用**

### 验证步骤（精简版）
1. **【最优先】检查 Git 提交**：用 Bash 运行 \`git log -1 --oneline\` 和 \`git status\`
   - 有 "[Task]" 提交 → Worker 已完成并提交，继续验证质量
   - 无新提交但有改动 → **needs_revision**（Worker 写了代码但没提交）
   - 无提交也无改动 → 检查现有代码是否已满足要求
2. **【按需执行】验证改动文件**（仅当报告了文件改动时）：
   - **重点**：只验证上面"文件变更"列表中的文件
   - 抽查 1-2 个核心文件，用 Read 查看代码质量
   - 不需要验证所有文件，信任 Worker 的基本能力
3. **【可选】深入检查**（仅当发现明显问题时）：
   - 用 Grep 搜索特定代码模式
   - 用 Glob 检查是否有遗漏的文件

### 判断标准
- **【最重要】验证 Git 提交**：
  1. \`git log -1\` 显示包含 "[Task]" 的提交消息 → Worker 已完成提交，继续验证代码质量
  2. \`git status\` 显示有未提交改动 → **needs_revision**（Worker 写了代码但没提交）
  3. 没有代码改动也没有新提交 → 检查现有代码是否满足要求
- 如果 Worker 说完成了但你验证发现代码不存在 → **failed**
- 如果 Worker 没修改文件但现有代码已满足要求 → **passed**
- 如果代码存在但有明显问题需要修复 → **needs_revision**

**关于 Git 提交失败**：
Worker 会自己用 Bash 提交 Git。如果提交失败，Worker 应该自己诊断并修复问题（如配置 user.email）。
如果 Reviewer 发现有未提交的改动，判定 **needs_revision** 并建议 Worker 完成 Git 提交。

## ⚠️ 最终输出要求（v6.0 - 工具调用）

**完成验证后，必须调用 SubmitReview 工具提交审查结果！**

### 工具调用示例（passed）

\`\`\`
SubmitReview({
  "verdict": "passed",
  "confidence": "high",
  "reasoning": "Git 提交已验证，健康检查服务实现正确",
  "verified": ["Git 提交状态", "src/services/health.ts 代码质量"],
  "issues": [],
  "suggestions": []
})
\`\`\`

### 工具调用示例（needs_revision）

\`\`\`
SubmitReview({
  "verdict": "needs_revision",
  "confidence": "high",
  "reasoning": "代码已修改但未提交到 Git",
  "verified": ["Git 提交状态", "文件改动检查"],
  "issues": ["未提交 Git 改动"],
  "suggestions": ["运行 git add . && git commit -m '[Task] 完成任务'"]
})
\`\`\`

**关键提醒**：
- ✅ 必须调用 SubmitReview 工具提交结论
- 📝 你可以在调用工具前输出验证过程（如"正在检查 Git 提交..."）
- ❌ 不要返回 JSON 文本（已废弃）
- 不要只看 Worker 的报告，必须自己验证
- "无文件变更"不等于"任务失败"，可能现有代码已满足要求`;
  }

  /**
   * 格式化文件变更
   */
  private formatFileChanges(changes: FileChangeRecord[]): string {
    if (changes.length === 0) {
      return '（无文件变更）';
    }

    return changes.slice(0, 10).map(change => {
      const icon = change.type === 'created' ? '➕' :
                   change.type === 'modified' ? '📝' : '🗑️';
      return `- ${icon} ${change.path}`;
    }).join('\n') + (changes.length > 10 ? `\n... 还有 ${changes.length - 10} 个文件` : '');
  }

  /**
   * 格式化测试状态
   */
  private formatTestStatus(status?: WorkerExecutionSummary['testStatus']): string {
    if (!status) {
      return '（未运行测试）';
    }
    if (!status.ran) {
      return '未运行测试';
    }
    if (status.passed) {
      return '✅ 测试通过';
    }
    return `❌ 测试失败${status.output ? `: ${status.output.substring(0, 200)}` : ''}`;
  }

  /**
   * 调用 Reviewer 模型（使用 ConversationLoop，与 Worker 相同的认证方式）
   * v4.0: 支持只读工具，让 Reviewer 能主动验证代码
   * v5.0: 优化 - 降低 maxTurns，添加进度回调
   * v6.0: 添加 SubmitReview 工具，使用工具调用而非文本解析
   */
  private async callReviewer(
    prompt: string,
    projectPath?: string,
    onProgress?: ReviewProgressCallback
  ): Promise<Omit<ReviewResult, 'durationMs'>> {
    // v4.0: Reviewer 现在拥有只读工具，可以主动验证 Worker 的工作
    // v5.5: 增加 Bash 工具，用于验证 Git 提交状态（git log, git status）
    // v6.0: 添加 SubmitReview 工具，用于提交审查结果
    const REVIEWER_READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'LS', 'Bash', 'SubmitReview'];

    // v6.0: 清除之前的审查结果
    SubmitReviewTool.clearReviewResult();

    // 使用 ConversationLoop，自动处理认证（支持 OAuth 和 API Key）
    const loop = new ConversationLoop({
      model: this.config.model as ModelType,
      maxTurns: 12,  // v5.0: 优化 - 从 20 降低到 12（精简验证步骤后不需要这么多轮次）
      verbose: false,
      permissionMode: 'bypassPermissions',
      workingDir: projectPath,  // v4.0: 传递项目路径，让工具知道在哪里读文件
      isSubAgent: true,
      systemPrompt: this.buildReviewerSystemPrompt(projectPath),
      // 禁用 Extended Thinking，Reviewer 只需要简单的 JSON 输出
      thinking: { enabled: false },
      // v4.0: 允许只读工具，让 Reviewer 能主动验证
      allowedTools: REVIEWER_READ_ONLY_TOOLS,
    });

    let hasSeenBashTool = false;  // v5.0: 追踪是否已执行 Git 验证
    let hasSeenReadTool = false;  // v5.0: 追踪是否已开始读取文件
    let hasCalledSubmitReview = false;  // v6.0: 追踪是否已调用 SubmitReview

    console.log(`[TaskReviewer] Starting model call: ${this.config.model}`);

    // 收集响应
    try {
      for await (const event of loop.processMessageStream(prompt)) {
        // v5.0: 根据工具调用发送进度反馈
        if (event.type === 'tool_start') {
          const toolName = (event as any).toolName;
          console.log(`[TaskReviewer] Using tool: ${toolName}`);

          // 发送不同的进度
          if (toolName === 'Bash' && !hasSeenBashTool) {
            hasSeenBashTool = true;
            onProgress?.({
              stage: 'checking_git',
              message: '正在验证 Git 提交和文件状态...',
              details: { tool: 'Bash' },
            });
          } else if ((toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') && !hasSeenReadTool) {
            hasSeenReadTool = true;
            onProgress?.({
              stage: 'verifying_files',
              message: '正在验证文件内容和代码质量...',
              details: { tool: toolName },
            });
          } else if (toolName === 'SubmitReview') {
            hasCalledSubmitReview = true;
            onProgress?.({
              stage: 'analyzing_quality',
              message: '正在提交审查结果...',
              details: { tool: 'SubmitReview' },
            });
          }
        }
      }
    } catch (streamError) {
      console.error('[TaskReviewer] Stream processing error:', streamError);
      throw streamError;  // 重新抛出，让上层处理
    }

    // v6.0: 从工具调用中读取审查结果
    const toolResult = SubmitReviewTool.getLastReviewResult();

    if (toolResult) {
      console.log(`[TaskReviewer] Retrieved result from SubmitReview tool: ${toolResult.verdict}`);
      return {
        verdict: toolResult.verdict,
        confidence: toolResult.confidence,
        reasoning: toolResult.reasoning,
        verified: toolResult.verified,
        issues: toolResult.issues,
        suggestions: toolResult.suggestions,
      };
    }

    // 如果没有调用 SubmitReview 工具，直接抛出异常（禁止降级）
    console.error('[TaskReviewer] Reviewer did not call SubmitReview tool');
    throw new Error('Reviewer 未调用 SubmitReview 工具，无法完成审查');
  }

  /**
   * 解析 Reviewer 的响应
   * v4.1: 查找最后一个 JSON 块（因为 Reviewer 可能在验证过程中输出多段文本）
   * v5.0: 当 JSON 解析失败时，使用 AI 重新解析，而不是脆弱的关键词匹配
   *
   * @deprecated v6.0: 已废弃，现在使用 SubmitReview 工具调用，不再需要解析文本
   */
  private async parseReviewResponse(text: string): Promise<Omit<ReviewResult, 'durationMs' | 'tokensUsed'>> {
    // v4.1: 查找所有 JSON 块，使用最后一个（Reviewer 验证过程中可能输出多段文本）
    const jsonMatches = text.match(/```json\s*([\s\S]*?)\s*```/g);
    if (jsonMatches && jsonMatches.length > 0) {
      // 从最后一个开始尝试解析
      for (let i = jsonMatches.length - 1; i >= 0; i--) {
        const match = jsonMatches[i].match(/```json\s*([\s\S]*?)\s*```/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            // 验证必须有 verdict 字段
            if (parsed.verdict) {
              console.log(`[TaskReviewer] Parse successful, using JSON block ${i + 1}/${jsonMatches.length}`);
              return {
                verdict: this.normalizeVerdict(parsed.verdict),
                confidence: parsed.confidence || 'medium',
                reasoning: parsed.reasoning || '无理由',
                verified: parsed.verified,
                issues: parsed.issues,
                suggestions: parsed.suggestions,
              };
            }
          } catch (e) {
            // 继续尝试上一个
          }
        }
      }
    }

    // 尝试直接解析整个文本为 JSON（没有代码块）
    try {
      const parsed = JSON.parse(text);
      if (parsed.verdict) {
        return {
          verdict: this.normalizeVerdict(parsed.verdict),
          confidence: parsed.confidence || 'medium',
          reasoning: parsed.reasoning || '无理由',
          verified: parsed.verified,
          issues: parsed.issues,
          suggestions: parsed.suggestions,
        };
      }
    } catch (e) {
      // 继续尝试
    }

    // v4.1: 尝试从文本中提取裸 JSON 对象（可能没有代码块包裹）
    const bareJsonMatch = text.match(/\{[\s\S]*?"verdict"[\s\S]*?\}/);
    if (bareJsonMatch) {
      try {
        const parsed = JSON.parse(bareJsonMatch[0]);
        if (parsed.verdict) {
          console.log('[TaskReviewer] Parse successful, using bare JSON object');
          return {
            verdict: this.normalizeVerdict(parsed.verdict),
            confidence: parsed.confidence || 'medium',
            reasoning: parsed.reasoning || '无理由',
            verified: parsed.verified,
            issues: parsed.issues,
            suggestions: parsed.suggestions,
          };
        }
      } catch (e) {
        // 继续尝试
      }
    }

    // v5.0: 无法解析 JSON 时，使用 AI 重新理解响应内容
    // 不再使用脆弱的关键词匹配（如 includes('passed')），而是让 AI 真正理解文本含义
    console.log('[TaskReviewer] JSON parsing failed, using AI to re-parse response...');

    try {
      const agentDecision = getAgentDecisionMaker();
      // 构造一个虚拟任务用于 AI 解析
      const parseResult = await agentDecision.askAgentForVerdict(text);

      if (parseResult) {
        console.log('[TaskReviewer] AI re-parsing successful:', parseResult.verdict);
        return {
          verdict: parseResult.verdict,
          confidence: parseResult.confidence,
          reasoning: parseResult.reasoning,
          issues: parseResult.issues,
          suggestions: parseResult.suggestions,
        };
      }
    } catch (aiError) {
      console.error('[TaskReviewer] AI re-parsing failed:', aiError);
    }

    // v5.7: AI 也无法解析时，抛出异常让上层降级为信任 Worker
    // 不再返回 needs_revision + "需要人工审核"，因为系统设计为全自动化
    throw new Error(`无法解析审查结果，原始响应: ${text.substring(0, 200)}`);
  }

  /**
   * 标准化 verdict
   */
  private normalizeVerdict(verdict: string): ReviewVerdict {
    const v = verdict?.toLowerCase();
    if (v === 'passed' || v === 'pass' || v === '通过') return 'passed';
    if (v === 'failed' || v === 'fail' || v === '失败') return 'failed';
    return 'needs_revision';
  }
}

// ============== 辅助函数 ==============

/**
 * 从 Worker 事件流中收集执行摘要
 */
export function collectWorkerSummary(
  events: Array<{
    type: string;
    toolName?: string;
    toolInput?: any;
    toolOutput?: string;
    toolError?: string;
  }>,
  fileChanges: FileChangeRecord[],
  durationMs: number,
  error?: string
): WorkerExecutionSummary {
  const toolCalls: ToolCallRecord[] = [];
  let selfReportedCompleted = false;
  let selfReportedMessage: string | undefined;
  let testRan = false;
  let testPassed = false;
  let testOutput: string | undefined;

  for (const event of events) {
    if (event.type === 'tool_end' && event.toolName) {
      toolCalls.push({
        name: event.toolName,
        input: event.toolInput,
        output: event.toolOutput?.substring(0, 500),
        error: event.toolError,
      });

      // 检测自我汇报
      if (event.toolName === 'UpdateTaskStatus') {
        const input = event.toolInput as { status?: string; summary?: string; error?: string } | undefined;
        if (input?.status === 'completed') {
          selfReportedCompleted = true;
          selfReportedMessage = input.summary;
        } else if (input?.status === 'failed') {
          selfReportedMessage = input.error;
        }
      }

      // 检测测试
      if (event.toolName === 'Bash') {
        const input = event.toolInput as { command?: string } | undefined;
        const command = input?.command || '';
        if (/\b(npm\s+test|vitest|jest|pytest|go\s+test|cargo\s+test)\b/i.test(command)) {
          testRan = true;
          testPassed = !event.toolError;
          testOutput = event.toolOutput?.substring(0, 500);
        }
      }
    }
  }

  return {
    selfReported: {
      completed: selfReportedCompleted,
      message: selfReportedMessage,
    },
    toolCalls,
    fileChanges,
    testStatus: testRan ? {
      ran: true,
      passed: testPassed,
      output: testOutput,
    } : undefined,
    durationMs,
    error,
  };
}
