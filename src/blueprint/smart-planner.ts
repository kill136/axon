/**
 * 智能规划器 - 蜂群架构 v2.0 的核心组件
 *
 * 职责：
 * 1. 需求对话（快速2-3轮收集核心需求）
 * 2. 蓝图生成（作为"需求锚点"，所有Worker参照执行）
 * 3. 任务分解（智能划分可并行任务，粒度控制在5分钟内）
 *
 * 设计理念：
 * - 对话简洁高效，不拖泥带水
 * - 蓝图是"需求锚点"，一旦确认不轻易修改
 * - 任务自动判断是否需要测试
 * - 任务依赖分析，最大化并行度
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import type {
  Blueprint,
  DialogState,
  DialogMessage,
  DialogPhase,
  TechStack,
  SimpleModule,
  BlueprintModule,
  ModuleInterface,
  BusinessProcess,
  ProcessStep,
  NFR,
  SmartTask,
  TaskType,
  TaskComplexity,
  ExecutionPlan,
  PlanDecision,
  ProjectLanguage,
  PackageManagerType,
  TestFrameworkType,
  CodebaseExploration,
  SwarmConfig,
  DEFAULT_SWARM_CONFIG,
  // v4.0: API 契约类型
  APIEndpoint,
  APIContract,
} from './types.js';
import { ClaudeClient, getDefaultClient } from '../core/client.js';
import { ConversationLoop } from '../core/loop.js';
import { PlannerSession, type SessionStreamEvent } from './planner-session.js';

// ============================================================================
// 配置和常量
// ============================================================================

/**
 * 规划器配置
 */
export interface SmartPlannerConfig {
  /** 最大对话轮数（默认3轮） */
  maxDialogRounds: number;
  /** 任务最大执行时间（分钟，默认5） */
  maxTaskMinutes: number;
  /** 是否自动判断测试需求 */
  autoTestDecision: boolean;
  /** 默认模型 */
  model: 'opus' | 'sonnet' | 'haiku';

  // v2.0 新增：Agent 模式配置
  /** 规划前是否先用 Agent 探索代码库（默认true） */
  exploreBeforeDecompose: boolean;
  /** 探索阶段最大轮次（默认5） */
  exploreMaxTurns: number;
}

const DEFAULT_CONFIG: SmartPlannerConfig = {
  maxDialogRounds: 3,
  maxTaskMinutes: 5,
  autoTestDecision: true,
  model: 'sonnet',
  // v2.0 新增：Agent 模式配置
  exploreBeforeDecompose: true,
  exploreMaxTurns: 5,
};

// 持久化目录
const getPlannersDir = (): string => {
  const dir = path.join(os.homedir(), '.axon', 'planners');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

// ============================================================================
// 对话阶段提示词（精简版，快速收集核心需求）
// ============================================================================

const DIALOG_PROMPTS: Record<DialogPhase, string> = {
  greeting: `你好！我是智能规划助手。请用一两句话描述你想要构建的功能或项目。

例如：
- "我想给这个项目添加用户认证功能"
- "创建一个待办事项管理的 API"
- "重构购物车模块，支持优惠券"`,

  requirements: `好的，我需要再确认几个关键点：

1. **核心功能**：最重要的2-3个功能是什么？
2. **技术约束**：有什么必须使用或避免的技术吗？
3. **时间预期**：大概想在多长时间内完成？

请简要回答，我们会在后续细化。`,

  clarification: `我还需要澄清一些细节：

{{clarificationQuestions}}

请回答上述问题，然后我们就可以生成蓝图了。`,

  tech_choice: `根据你的需求，我建议使用以下技术栈：

{{techSuggestion}}

你可以：
1. **确认** - 使用建议的技术栈
2. **调整** - 告诉我你想修改的部分

请选择或提供修改意见。`,

  confirmation: `蓝图草案已生成：

{{blueprintSummary}}

请确认：
- 输入"确认"开始执行
- 输入"修改 [内容]"调整蓝图
- 输入"重来"重新开始`,

  done: `蓝图已确认并保存！

蓝图 ID: {{blueprintId}}
包含 {{taskCount}} 个任务，预计执行时间 {{estimatedMinutes}} 分钟

你可以开始执行任务了。`,
};

// ============================================================================
// 智能规划器核心类
// ============================================================================

export class SmartPlanner extends EventEmitter {
  private config: SmartPlannerConfig;
  private client: ClaudeClient | null = null;
  private sessions: Map<string, DialogState> = new Map();
  private projectPath: string | null = null;
  /** Multi-turn AI 会话（替代分散的 extractWithAI 调用） */
  private aiSession: PlannerSession | null = null;

  constructor(config?: Partial<SmartPlannerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadSessions();
  }

  /**
   * 获取或创建 AI 会话
   */
  private getAISession(): PlannerSession {
    if (!this.aiSession) {
      this.aiSession = new PlannerSession(this.getClient(), {
        debug: false,
        maxHistoryLength: 20,
      });
    }
    return this.aiSession;
  }

  /**
   * 重置 AI 会话（新对话时调用）
   */
  private resetAISession(): void {
    if (this.aiSession) {
      this.aiSession.clear();
    }
    this.aiSession = null;
  }

  // --------------------------------------------------------------------------
  // 需求对话
  // --------------------------------------------------------------------------

  /**
   * 开始需求对话
   *
   * @param projectPath 项目路径
   * @returns 初始对话状态
   */
  async startDialog(projectPath: string): Promise<DialogState> {
    this.projectPath = projectPath;

    // 检查是否有未完成的对话
    const existing = this.findDialogByProject(projectPath);
    if (existing && !existing.isComplete) {
      return existing;
    }

    // v3.0: 重置 AI 会话（确保新对话有干净的上下文）
    this.resetAISession();

    // 创建新对话
    const state: DialogState = {
      phase: 'greeting',
      messages: [],
      collectedRequirements: [],
      collectedConstraints: [],
      isComplete: false,
    };

    // 添加问候消息
    const greetingMessage: DialogMessage = {
      role: 'assistant',
      content: DIALOG_PROMPTS.greeting,
      timestamp: new Date(),
    };
    state.messages.push(greetingMessage);

    // 保存对话状态
    const sessionId = uuidv4();
    this.sessions.set(sessionId, state);
    this.saveSession(sessionId, state);

    this.emit('dialog:started', { sessionId, state, projectPath });

    return state;
  }

  /**
   * 处理用户输入
   *
   * @param input 用户输入
   * @param state 当前对话状态
   * @returns 更新后的对话状态
   */
  async processUserInput(input: string, state: DialogState): Promise<DialogState> {
    // 记录用户消息
    const userMessage: DialogMessage = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    };
    state.messages.push(userMessage);

    // 根据当前阶段处理
    let response: string;
    let nextPhase: DialogPhase = state.phase;

    switch (state.phase) {
      case 'greeting':
        const greetingResult = await this.processGreetingInput(state, input);
        response = greetingResult.response;
        nextPhase = greetingResult.nextPhase;
        break;

      case 'requirements':
        const reqResult = await this.processRequirementsInput(state, input);
        response = reqResult.response;
        nextPhase = reqResult.nextPhase;
        break;

      case 'clarification':
        const clarResult = await this.processClarificationInput(state, input);
        response = clarResult.response;
        nextPhase = clarResult.nextPhase;
        break;

      case 'tech_choice':
        const techResult = await this.processTechChoiceInput(state, input);
        response = techResult.response;
        nextPhase = techResult.nextPhase;
        break;

      case 'confirmation':
        const confirmResult = await this.processConfirmationInput(state, input);
        response = confirmResult.response;
        nextPhase = confirmResult.nextPhase;
        if (confirmResult.isComplete) {
          state.isComplete = true;
          // 保存生成的蓝图，避免在 confirm API 中重复生成
          if (confirmResult.generatedBlueprint) {
            state.generatedBlueprint = confirmResult.generatedBlueprint;
          }
        }
        break;

      default:
        response = '对话已完成。';
        nextPhase = 'done';
        state.isComplete = true;
    }

    // 更新阶段
    state.phase = nextPhase;

    // 记录助手回复
    const assistantMessage: DialogMessage = {
      role: 'assistant',
      content: response,
      timestamp: new Date(),
    };
    state.messages.push(assistantMessage);

    // 保存状态
    this.saveSessionByState(state);

    this.emit('dialog:message', { state, userMessage, assistantMessage });

    return state;
  }

  /**
   * 处理问候阶段输入 - v3.0 Multi-turn 版本
   *
   * 改进：
   * 1. 使用 PlannerSession 维护对话上下文
   * 2. 合并"提取关键词"和"生成问题"为一次 API 调用
   * 3. 支持流式渲染
   */
  private async processGreetingInput(
    state: DialogState,
    input: string
  ): Promise<{ response: string; nextPhase: DialogPhase }> {
    const session = this.getAISession();

    // Step 1: 一次性分析用户输入（合并原来的2次调用）
    // 同时提取：关键词、功能、复杂度、追问问题
    let extracted = {
      projectGoal: input,
      coreFeatures: [] as string[],
      keywords: [] as string[],
      complexity: 'moderate' as 'simple' | 'moderate' | 'complex',
      questions: ['确认以上理解正确吗？'] as string[],
    };

    // 流式处理 AI 响应
    for await (const event of session.analyzeUserInput(input)) {
      // 发送流式事件供 UI 渲染
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        extracted = { ...extracted, ...event.result };
      } else if (event.type === 'error') {
        console.error('[SmartPlanner] AI analysis failed:', event.error);
      }
    }

    // 保存提取的需求
    state.collectedRequirements.push(extracted.projectGoal);
    if (extracted.coreFeatures.length > 0) {
      state.collectedRequirements.push(...extracted.coreFeatures);
    }

    // Step 2: 根据需求关键词针对性探索代码库
    let codebaseContext = '';
    if (this.projectPath && extracted.keywords.length > 0) {
      this.emit('dialog:exploring', { keywords: extracted.keywords });
      const exploration = await this.exploreForRequirement(
        this.projectPath,
        extracted.keywords,
        extracted.projectGoal
      );
      codebaseContext = exploration;

      // 将代码库上下文添加到 AI 会话中（让后续对话有上下文）
      if (codebaseContext) {
        session.addContext(`代码库分析结果:\n${codebaseContext}`);
      }
    }

    // 构建响应（使用 AI 返回的问题，不需要再调用 generateSmartQuestions）
    const response = this.buildSmartResponse(
      extracted.projectGoal,
      extracted.coreFeatures,
      codebaseContext,
      extracted.questions
    );

    // 根据复杂度决定下一阶段
    const nextPhase: DialogPhase = extracted.complexity === 'simple'
      ? 'tech_choice'
      : 'requirements';

    return { response, nextPhase };
  }

  /**
   * 根据需求关键词探索代码库
   * 不是盲目全量扫描，而是针对性搜索
   */
  private async exploreForRequirement(
    projectPath: string,
    keywords: string[],
    goal: string
  ): Promise<string> {
    const findings: string[] = [];

    // 记录探索目标，用于后续分析
    this.emit('dialog:explore_goal', { goal, keywords });

    try {
      // 1. 检测项目基本信息
      const techStack = this.detectExistingTechStack();
      if (techStack.language) {
        findings.push(`**项目类型**: ${techStack.language}${techStack.framework ? ` + ${techStack.framework}` : ''}`);
      }
      if (techStack.testFramework) {
        findings.push(`**测试框架**: ${techStack.testFramework}`);
      }

      // 2. 搜索与需求相关的现有代码
      const searchPattern = keywords.join('|');
      const relatedFiles = await this.searchRelatedCode(projectPath, searchPattern);

      if (relatedFiles.length > 0) {
        findings.push(`\n**发现相关代码** (${relatedFiles.length} 个文件):`);
        for (const file of relatedFiles.slice(0, 5)) {
          findings.push(`  · \`${file.path}\` - ${file.summary}`);
        }
        if (relatedFiles.length > 5) {
          findings.push(`  · ... 还有 ${relatedFiles.length - 5} 个文件`);
        }
      } else {
        findings.push(`\n**未发现相关代码**: 这将是一个新功能模块`);
      }

      // 3. 检查项目结构
      const structure = await this.getProjectStructure(projectPath);
      if (structure) {
        findings.push(`\n**项目结构**: ${structure}`);
      }

      // 4. 检查依赖中是否有相关库
      const relatedDeps = await this.checkRelatedDependencies(projectPath, keywords);
      if (relatedDeps.length > 0) {
        findings.push(`\n**相关依赖**: ${relatedDeps.join(', ')}`);
      }

    } catch (error) {
      // 探索失败不阻塞流程
      console.warn('[SmartPlanner] Codebase exploration failed:', error);
    }

    return findings.length > 0 ? findings.join('\n') : '';
  }

  /**
   * 搜索与需求相关的代码
   */
  private async searchRelatedCode(
    projectPath: string,
    pattern: string
  ): Promise<Array<{ path: string; summary: string }>> {
    const results: Array<{ path: string; summary: string }> = [];

    try {
      // 使用 Agent 模式搜索
      const loop = new ConversationLoop({
        model: this.getClient().getModel(),
        maxTurns: 2,
        verbose: false,
        permissionMode: 'bypassPermissions',
        workingDir: projectPath,
        systemPrompt: `你是代码搜索助手。使用 Grep 和 Glob 工具搜索代码，返回简洁结果。
只返回 JSON 数组，格式：[{"path": "文件路径", "summary": "文件摘要"}]`,
        isSubAgent: true,
      });

      const searchResult = await loop.processMessage(
        `搜索包含 "${pattern}" 的代码文件，返回最相关的5个文件及其摘要（10字以内）。
只返回 JSON 数组，不要其他内容。`
      );

      if (searchResult) {
        try {
          const jsonMatch = searchResult.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.slice(0, 5);
          }
        } catch {
          // 解析失败，返回空
        }
      }
    } catch (error) {
      console.warn('[SmartPlanner] Code search failed:', error);
    }

    return results;
  }

  /**
   * 获取项目结构概要
   */
  private async getProjectStructure(projectPath: string): Promise<string> {
    try {
      const dirs: string[] = [];
      const entries = fs.readdirSync(projectPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          dirs.push(entry.name);
        }
      }

      if (dirs.length > 0) {
        return dirs.slice(0, 8).join(', ') + (dirs.length > 8 ? '...' : '');
      }
    } catch {
      // 忽略错误
    }
    return '';
  }

  /**
   * 检查相关依赖
   */
  private async checkRelatedDependencies(
    projectPath: string,
    keywords: string[]
  ): Promise<string[]> {
    const related: string[] = [];

    try {
      const pkgPath = path.join(projectPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        for (const [dep] of Object.entries(allDeps)) {
          for (const keyword of keywords) {
            if (dep.toLowerCase().includes(keyword.toLowerCase())) {
              related.push(dep);
              break;
            }
          }
        }
      }
    } catch {
      // 忽略错误
    }

    return related.slice(0, 5);
  }

  // v3.0: generateSmartQuestions 已被移除
  // 问题生成现在由 PlannerSession.analyzeUserInput 一次性完成

  /**
   * 构建智能响应
   */
  private buildSmartResponse(
    goal: string,
    features: string[],
    codebaseContext: string,
    questions: string[]
  ): string {
    const lines: string[] = [];

    // 1. 确认理解
    lines.push(`好的，我理解你想要：**${goal}**`);
    lines.push('');

    // 2. 展示检测到的功能
    if (features.length > 0) {
      lines.push('**可能涉及的功能点：**');
      features.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
      lines.push('');
    }

    // 3. 展示代码库分析结果（这是关键差异点！）
    if (codebaseContext) {
      lines.push('---');
      lines.push('📂 **代码库分析：**');
      lines.push(codebaseContext);
      lines.push('---');
      lines.push('');
    }

    // 4. 智能追问
    if (questions.length > 0) {
      lines.push('**我需要确认几个问题：**');
      questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
    }

    return lines.join('\n');
  }

  /**
   * 处理需求收集阶段输入 - v3.0 Multi-turn 版本
   * 使用 PlannerSession 保持上下文，AI 已记住之前的对话
   */
  private async processRequirementsInput(
    state: DialogState,
    input: string
  ): Promise<{ response: string; nextPhase: DialogPhase }> {
    const session = this.getAISession();

    // 使用 session 提取需求（AI 已有上下文，不需要重发 collectedRequirements）
    let extracted = {
      newFeatures: [] as string[],
      constraints: [] as string[],
      needsClarification: false,
      clarificationQuestions: [] as string[],
    };

    for await (const event of session.extractRequirements(input)) {
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        extracted = { ...extracted, ...event.result };
      } else if (event.type === 'error') {
        console.error('[SmartPlanner] Requirement extraction failed:', event.error);
      }
    }

    // 更新收集的信息
    if (extracted.newFeatures.length > 0) {
      state.collectedRequirements.push(...extracted.newFeatures);
    }
    if (extracted.constraints.length > 0) {
      state.collectedConstraints.push(...extracted.constraints);
    }

    // 判断是否需要继续澄清
    if (extracted.needsClarification && extracted.clarificationQuestions.length > 0) {
      const clarificationPrompt = DIALOG_PROMPTS.clarification.replace(
        '{{clarificationQuestions}}',
        extracted.clarificationQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
      );
      return { response: clarificationPrompt, nextPhase: 'clarification' };
    }

    // 直接进入技术选择
    const techSuggestion = await this.generateTechSuggestion(state);
    const response = DIALOG_PROMPTS.tech_choice.replace(
      '{{techSuggestion}}',
      this.formatTechStack(techSuggestion)
    );
    state.techStack = techSuggestion;

    return { response, nextPhase: 'tech_choice' };
  }

  /**
   * 处理澄清阶段输入 - v3.0 Multi-turn 版本
   * 复用 extractRequirements，AI 已有完整上下文
   */
  private async processClarificationInput(
    state: DialogState,
    input: string
  ): Promise<{ response: string; nextPhase: DialogPhase }> {
    const session = this.getAISession();

    // 复用 extractRequirements（AI 记得之前的澄清问题）
    let extracted = {
      newFeatures: [] as string[],
      constraints: [] as string[],
      needsClarification: false,
      clarificationQuestions: [] as string[],
    };

    for await (const event of session.extractRequirements(input)) {
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        extracted = { ...extracted, ...event.result };
      }
    }

    if (extracted.newFeatures.length > 0) {
      state.collectedRequirements.push(...extracted.newFeatures);
    }
    if (extracted.constraints.length > 0) {
      state.collectedConstraints.push(...extracted.constraints);
    }

    // 进入技术选择
    const techSuggestion = await this.generateTechSuggestion(state);
    const response = DIALOG_PROMPTS.tech_choice.replace(
      '{{techSuggestion}}',
      this.formatTechStack(techSuggestion)
    );
    state.techStack = techSuggestion;

    return { response, nextPhase: 'tech_choice' };
  }

  /**
   * 处理技术选择阶段输入 - v3.0 Multi-turn 版本
   */
  private async processTechChoiceInput(
    state: DialogState,
    input: string
  ): Promise<{ response: string; nextPhase: DialogPhase }> {
    const normalizedInput = input.trim().toLowerCase();

    if (normalizedInput === '确认' || normalizedInput === 'confirm' || normalizedInput === 'yes') {
      // 生成蓝图摘要进入确认阶段（蓝图在用户最终确认后才生成）
      const summary = this.generateBlueprintSummary(state);
      const response = DIALOG_PROMPTS.confirmation.replace('{{blueprintSummary}}', summary);
      return { response, nextPhase: 'confirmation' };
    }

    // 处理技术栈修改（使用 session，AI 已知当前技术栈上下文）
    const session = this.getAISession();
    let modResult = {
      type: 'modify_tech' as const,
      target: '',
      newValue: '',
      message: '已更新',
    };

    for await (const event of session.parseModification(input)) {
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        modResult = { ...modResult, ...event.result };
      }
    }

    // 如果是技术修改，尝试解析 newValue 为技术栈字段
    if (modResult.type === 'modify_tech' && modResult.newValue) {
      try {
        const techMod = JSON.parse(modResult.newValue);
        state.techStack = { ...state.techStack, ...techMod };
      } catch {
        // 如果不是 JSON，尝试作为单字段修改
        if (modResult.target && state.techStack) {
          (state.techStack as any)[modResult.target] = modResult.newValue;
        }
      }
    }

    // 再次显示技术选择
    const response = `${modResult.message}\n\n${this.formatTechStack(state.techStack as TechStack)}\n\n确认使用此技术栈吗？输入"确认"继续。`;
    return { response, nextPhase: 'tech_choice' };
  }

  /**
   * 处理确认阶段输入
   *
   * v3.1: 不在这里生成蓝图，只标记状态为完成。
   * 蓝图生成将在 /confirm/stream API 中通过 StreamingBlueprintGenerator 进行，
   * 以支持流式渲染。
   */
  private async processConfirmationInput(
    state: DialogState,
    input: string
  ): Promise<{ response: string; nextPhase: DialogPhase; isComplete?: boolean; generatedBlueprint?: Blueprint }> {
    const normalizedInput = input.trim().toLowerCase();

    if (normalizedInput === '确认' || normalizedInput === 'confirm' || normalizedInput === 'yes') {
      // 用户最终确认，标记对话完成
      // 注意：不在这里生成蓝图，而是让 /confirm/stream API 进行流式生成
      state.isComplete = true;

      // 返回提示信息，告诉前端可以开始流式生成蓝图
      const response = '✅ 需求已确认！正在为您生成项目蓝图，请稍候...';
      return { response, nextPhase: 'done', isComplete: true };
    }

    if (normalizedInput === '重来' || normalizedInput === 'restart') {
      // 重新开始
      state.collectedRequirements = [];
      state.collectedConstraints = [];
      state.techStack = undefined;
      const response = DIALOG_PROMPTS.greeting;
      return { response, nextPhase: 'greeting' };
    }

    if (normalizedInput.startsWith('修改')) {
      // 处理修改请求
      const modification = input.slice(2).trim();
      const result = await this.processModification(state, modification);
      const summary = this.generateBlueprintSummary(state);
      const response = `${result.message}\n\n${DIALOG_PROMPTS.confirmation.replace('{{blueprintSummary}}', summary)}`;
      return { response, nextPhase: 'confirmation' };
    }

    // 默认当作修改请求
    const result = await this.processModification(state, input);
    const summary = this.generateBlueprintSummary(state);
    const response = `${result.message}\n\n${DIALOG_PROMPTS.confirmation.replace('{{blueprintSummary}}', summary)}`;
    return { response, nextPhase: 'confirmation' };
  }

  /**
   * 处理修改请求 - v3.0 Multi-turn 版本
   * AI 已有完整上下文（需求、约束、技术栈），不需要重复发送
   */
  private async processModification(
    state: DialogState,
    modification: string
  ): Promise<{ message: string }> {
    const session = this.getAISession();

    let result = {
      type: 'other' as 'add_feature' | 'remove_feature' | 'modify_tech' | 'add_constraint' | 'other',
      target: '',
      newValue: '',
      message: '已记录修改意见',
    };

    for await (const event of session.parseModification(modification)) {
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        result = { ...result, ...event.result };
      }
    }

    // 应用修改
    switch (result.type) {
      case 'add_feature':
        if (result.newValue) {
          state.collectedRequirements.push(result.newValue);
        }
        break;
      case 'remove_feature':
        if (result.target) {
          state.collectedRequirements = state.collectedRequirements.filter(
            (r) => !r.includes(result.target!)
          );
        }
        break;
      case 'add_constraint':
        if (result.newValue) {
          state.collectedConstraints.push(result.newValue);
        }
        break;
      case 'modify_tech':
        if (result.newValue && state.techStack) {
          try {
            const techMod = JSON.parse(result.newValue);
            state.techStack = { ...state.techStack, ...techMod };
          } catch {
            // 忽略解析错误
          }
        }
        break;
    }

    return { message: result.message || '已应用修改。' };
  }

  // --------------------------------------------------------------------------
  // 蓝图生成
  // --------------------------------------------------------------------------

  /**
   * 从对话状态生成蓝图（完整格式，包含业务流程、模块、NFR）
   * v3.0: 使用 PlannerSession 的 multi-turn 上下文，AI 已有完整的需求理解
   *
   * @param state 完成的对话状态
   * @returns 生成的蓝图
   */
  async generateBlueprint(state: DialogState): Promise<Blueprint> {
    if (!state.isComplete) {
      throw new Error('对话未完成，无法生成蓝图');
    }

    if (!this.projectPath) {
      throw new Error('项目路径未设置');
    }

    // 发送进度事件：开始分析需求
    this.emit('blueprint:progress', { step: 1, total: 5, message: '正在分析需求...' });

    // v3.0: 使用 PlannerSession（AI 已有完整对话上下文）
    this.emit('blueprint:progress', { step: 2, total: 5, message: '正在设计项目结构...' });
    const session = this.getAISession();

    // 定义蓝图 schema（用于 AI tool use）
    const blueprintSchema = {
      name: { type: 'string', description: '项目名称' },
      description: { type: 'string', description: '项目描述' },
      version: { type: 'string', description: '版本号' },
      businessProcesses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['as-is', 'to-be'] },
            steps: { type: 'array', items: { type: 'object' } },
            actors: { type: 'array', items: { type: 'string' } },
            inputs: { type: 'array', items: { type: 'string' } },
            outputs: { type: 'array', items: { type: 'string' } },
          },
        },
        description: '业务流程列表',
      },
      modules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            type: { type: 'string', enum: ['frontend', 'backend', 'database', 'service', 'shared', 'other'] },
            responsibilities: { type: 'array', items: { type: 'string' } },
            techStack: { type: 'array', items: { type: 'string' } },
            interfaces: { type: 'array', items: { type: 'object' } },
            dependencies: { type: 'array', items: { type: 'string' } },
            rootPath: { type: 'string' },
            source: { type: 'string', enum: ['requirement', 'existing', 'ai_generated'] },
            files: { type: 'array', items: { type: 'string' } },
          },
        },
        description: '模块列表',
      },
      nfrs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            category: { type: 'string', enum: ['performance', 'security', 'reliability', 'scalability', 'maintainability', 'usability', 'other'] },
            name: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            metrics: { type: 'array', items: { type: 'string' } },
          },
        },
        description: '非功能需求列表',
      },
    };

    // 使用 session.interact 进行流式蓝图生成
    // AI 已有完整对话上下文（需求、约束、技术栈），指令可以很简洁
    const instruction = `基于我们整个对话中收集的需求信息，请生成完整的项目蓝图。

包括：
1. 项目名称和描述
2. 业务流程（每个流程包含步骤、参与者、输入输出）
3. 模块划分（前端、后端、数据库等，每个模块有职责和接口）
4. 非功能需求（性能、安全、可靠性等）

注意：
- 业务流程要清晰描述系统要做什么
- 模块划分要合理，有明确的职责边界
- 文件路径使用相对于项目根目录的路径`;

    // 默认值
    let blueprintData: any = {
      name: '新项目',
      description: state.collectedRequirements[0] || '项目描述',
      version: '1.0.0',
      businessProcesses: [],
      modules: [],
      nfrs: [],
    };

    // 流式调用
    for await (const event of session.interact(instruction, blueprintSchema)) {
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        blueprintData = { ...blueprintData, ...event.result };
      } else if (event.type === 'error') {
        console.error('[SmartPlanner] Blueprint generation failed:', event.error);
      }
    }

    // 发送进度事件：AI 响应完成，开始构建蓝图
    this.emit('blueprint:progress', { step: 3, total: 5, message: '正在构建蓝图结构...' });

    // 调试日志：检查 AI 返回的数据
    console.log('[SmartPlanner] Blueprint data returned by AI:');
    console.log('  - businessProcesses:', blueprintData.businessProcesses?.length || 0);
    console.log('  - modules:', blueprintData.modules?.length || 0);
    console.log('  - nfrs:', blueprintData.nfrs?.length || 0);
    if (!blueprintData.businessProcesses?.length && !blueprintData.modules?.length && !blueprintData.nfrs?.length) {
      console.warn('[SmartPlanner] ⚠️ AI returned empty data! May be AI call failed or structure not generated correctly.');
      console.log('[SmartPlanner] blueprintData:', JSON.stringify(blueprintData, null, 2).slice(0, 500));
    }

    // 构建完整的蓝图对象（添加空数组防护，防止 AI 返回不完整数据）
    const blueprint: Blueprint = {
      id: uuidv4(),
      name: blueprintData.name || '新项目',
      description: blueprintData.description || '',
      version: blueprintData.version || '1.0.0',
      projectPath: this.projectPath,
      status: 'confirmed',

      // 业务流程（防护空数组）
      businessProcesses: (blueprintData.businessProcesses || []).map((bp) => ({
        id: bp.id || uuidv4(),
        name: bp.name || '',
        description: bp.description || '',
        type: bp.type || 'to-be',
        steps: (bp.steps || []).map((step) => ({
          id: step.id || uuidv4(),
          order: step.order || 0,
          name: step.name || '',
          description: step.description || '',
          actor: step.actor || '',
          inputs: step.inputs || [],
          outputs: step.outputs || [],
        })),
        actors: bp.actors || [],
        inputs: bp.inputs || [],
        outputs: bp.outputs || [],
      })) as BusinessProcess[],

      // 模块（完整格式，防护空数组）
      modules: (blueprintData.modules || []).map((m) => ({
        id: m.id || uuidv4(),
        name: m.name,
        description: m.description,
        type: m.type,
        responsibilities: m.responsibilities || [],
        techStack: m.techStack || [],
        interfaces: (m.interfaces || []).map((iface) => ({
          name: iface.name,
          type: iface.type,
          description: iface.description,
          signature: iface.signature,
        })) as ModuleInterface[],
        dependencies: m.dependencies || [],
        rootPath: m.rootPath || '',
        source: m.source || 'ai_generated',
        files: m.files || [],
      })) as BlueprintModule[],

      // 非功能需求（防护空数组）
      nfrs: (blueprintData.nfrs || []).map((nfr) => ({
        id: nfr.id || uuidv4(),
        category: nfr.category || 'other',
        name: nfr.name || '',
        description: nfr.description || '',
        priority: nfr.priority || 'medium',
        metrics: nfr.metrics || [],
      })) as NFR[],

      // 兼容字段（从对话收集的原始信息）
      requirements: state.collectedRequirements,
      techStack: this.ensureCompleteTechStack(state.techStack),
      constraints: state.collectedConstraints,

      // v2.2: UI 设计图（作为端到端验收标准）
      designImages: state.designImages || [],

      // 时间戳
      createdAt: new Date(),
      updatedAt: new Date(),
      confirmedAt: new Date(),
    };

    // 发送进度事件：保存蓝图
    this.emit('blueprint:progress', { step: 4, total: 5, message: '正在保存蓝图...' });

    // 保存蓝图
    this.saveBlueprint(blueprint);

    // 发送进度事件：完成
    this.emit('blueprint:progress', { step: 5, total: 5, message: '蓝图生成完成！' });

    this.emit('blueprint:created', blueprint);

    return blueprint;
  }

  // --------------------------------------------------------------------------
  // 任务分解
  // --------------------------------------------------------------------------

  /**
   * 创建执行计划
   *
   * @param blueprint 已确认的蓝图
   * @returns 执行计划（包含智能任务列表和并行分组）
   */
  async createExecutionPlan(blueprint: Blueprint): Promise<ExecutionPlan> {
    // v2.0 新增：先用 Agent 探索代码库
    const exploration = await this.exploreCodebase(
      blueprint.projectPath,
      blueprint.requirements || []
    );
    const explorationContext = this.formatExplorationContext(exploration);

    // v4.0 新增：生成 API 契约（事前约束）
    // 在任务分解之前定义 API 契约，确保前后端一致
    this.emit('planner:generating_api_contract', { blueprintId: blueprint.id });
    const apiContract = await this.generateAPIContract(blueprint, explorationContext);
    if (apiContract) {
      // 将契约写入蓝图（持久化）
      blueprint.apiContract = apiContract;
      blueprint.updatedAt = new Date();

      this.emit('planner:api_contract_generated', {
        blueprintId: blueprint.id,
        endpoints: apiContract.endpoints?.length || 0,
        apiPrefix: apiContract.apiPrefix,
      });

      console.log(`[SmartPlanner] API contract written to blueprint: ${apiContract.endpoints.length} endpoints, prefix: ${apiContract.apiPrefix}`);
    }

    this.emit('planner:decomposing', { blueprintId: blueprint.id });

    // 格式化模块信息（支持完整格式和简化格式）
    const formatModules = () => {
      if (!blueprint.modules || blueprint.modules.length === 0) {
        return '无模块定义';
      }
      return blueprint.modules.map((m: any) => {
        const lines: string[] = [];
        lines.push(`- **${m.name}** (${m.type}): ${m.description}`);
        if (m.responsibilities && m.responsibilities.length > 0) {
          lines.push(`  职责: ${m.responsibilities.join(', ')}`);
        }
        if (m.interfaces && m.interfaces.length > 0) {
          lines.push(`  接口: ${m.interfaces.map((i: any) => i.name).join(', ')}`);
        }
        if (m.rootPath) {
          lines.push(`  路径: ${m.rootPath}`);
        }
        return lines.join('\n');
      }).join('\n');
    };

    // 格式化业务流程信息
    const formatProcesses = () => {
      if (!blueprint.businessProcesses || blueprint.businessProcesses.length === 0) {
        return '';
      }
      return `\n业务流程：\n${blueprint.businessProcesses.map((bp) => {
        const lines: string[] = [];
        lines.push(`- **${bp.name}**: ${bp.description}`);
        if (bp.steps && bp.steps.length > 0) {
          lines.push(`  步骤: ${bp.steps.map((s) => s.name).join(' → ')}`);
        }
        return lines.join('\n');
      }).join('\n')}`;
    };

    // 格式化NFR信息
    const formatNFRs = () => {
      if (!blueprint.nfrs || blueprint.nfrs.length === 0) {
        return '';
      }
      return `\n非功能需求：\n${blueprint.nfrs.map((nfr) =>
        `- [${nfr.priority}] ${nfr.name}: ${nfr.description}`
      ).join('\n')}`;
    };

    // 使用专门的任务分解方法（不依赖 extractWithAI）
    // v4.0: 传入 API 契约，让任务分解时考虑 API 路径规范
    const taskData = await this.decomposeTasksWithAI(
      blueprint,
      explorationContext,
      formatModules(),
      formatProcesses(),
      formatNFRs(),
      apiContract
    );

    // 验证 AI 返回的数据结构
    if (!taskData || !Array.isArray(taskData.tasks)) {
      console.error('[SmartPlanner] AI returned invalid data, missing tasks array');
      console.error('[SmartPlanner] taskData:', JSON.stringify(taskData, null, 2));
      throw new Error('任务分解失败：AI 未能返回有效的任务列表。请检查蓝图描述是否足够详细，或稍后重试。');
    }

    // 构建智能任务列表（过滤掉无效任务）
    const tasks: SmartTask[] = taskData.tasks
      .filter((t) => {
        if (!t.name || typeof t.name !== 'string') {
          console.warn('[SmartPlanner] Filtered out invalid task (missing name):', JSON.stringify(t));
          return false;
        }
        return true;
      })
      .map((t) => ({
        id: t.id || uuidv4(),
        name: t.name,
        description: t.description || t.name,
        type: t.type || 'code',
        complexity: t.complexity || 'simple',
        // v3.5: 任务领域，由 AI 直接标记，Worker 无需猜测
        category: t.category || 'other',
        blueprintId: blueprint.id,
        moduleId: t.moduleId,
        files: Array.isArray(t.files) ? t.files : [],
        dependencies: t.dependencies || [],
        needsTest: this.config.autoTestDecision ? t.needsTest : true,
        // v3.3: 测试策略，默认使用 unit
        testStrategy: (t as any).testStrategy || (t.needsTest === false ? 'skip' : 'unit'),
        estimatedMinutes: Math.min(t.estimatedMinutes || 5, this.config.maxTaskMinutes),
        status: 'pending' as const,
      }));

    // 计算预估（任务已按顺序排列，直接累加）
    const estimatedMinutes = this.calculateEstimatedTime(tasks);
    const estimatedCost = this.calculateEstimatedCost(tasks);

    // 使用 Agent 返回的 parallelGroups
    const parallelGroups: string[][] = taskData.parallelGroups || [tasks.map(t => t.id)];

    // 构建执行计划
    const plan: ExecutionPlan = {
      id: uuidv4(),
      blueprintId: blueprint.id,
      tasks,
      parallelGroups,
      estimatedMinutes,
      estimatedCost,
      autoDecisions: taskData.decisions.map((d) => ({
        type: d.type,
        description: d.description,
        reasoning: d.reasoning,
      })),
      status: 'ready',
      createdAt: new Date(),
    };

    // 保存执行计划
    this.saveExecutionPlan(plan);

    this.emit('plan:created', plan);

    return plan;
  }

  /**
   * 计算预估执行时间
   * 简化版：假设有一定并行度（约 50%），实际时间 ≈ 总时间 / 2
   */
  private calculateEstimatedTime(tasks: SmartTask[]): number {
    const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 5), 0);
    // 假设平均并行度 50%
    return Math.ceil(totalMinutes * 0.5);
  }

  /**
   * 计算预估成本（基于任务复杂度）
   */
  private calculateEstimatedCost(tasks: SmartTask[]): number {
    // 基础成本系数（每分钟的 API 调用成本估算）
    const costPerMinute: Record<TaskComplexity, number> = {
      trivial: 0.001,
      simple: 0.002,
      moderate: 0.005,
      complex: 0.01,
    };

    return tasks.reduce((total, task) => {
      const rate = costPerMinute[task.complexity] || 0.002;
      return total + task.estimatedMinutes * rate;
    }, 0);
  }

  // --------------------------------------------------------------------------
  // 辅助方法
  // --------------------------------------------------------------------------

  /**
   * 获取 Claude 客户端
   */
  private getClient(): ClaudeClient {
    if (!this.client) {
      this.client = getDefaultClient();
    }
    return this.client;
  }

  /**
   * 使用 Tool Use 提取结构化信息（比让AI输出JSON文本更可靠）
   *
   * @param prompt 提示词，描述需要提取什么
   * @param schema JSON Schema，定义返回数据的结构
   * @param defaultValue 默认值（当提取失败时返回）
   */
  private async extractWithAI<T>(
    prompt: string,
    defaultValue: T,
    schema?: Record<string, any>,
    customSystemPrompt?: string
  ): Promise<T> {
    try {
      const client = this.getClient();

      // 从 defaultValue 推断 schema（如果没有提供）
      const inferredSchema = schema || this.inferSchemaFromValue(defaultValue);

      // 定义提取工具
      const extractTool = {
        name: 'submit_extracted_data',
        description: '提交提取的结构化数据',
        inputSchema: {
          type: 'object' as const,
          properties: inferredSchema,
          required: Object.keys(inferredSchema),
        },
      };

      // 默认 system prompt
      const defaultSystemPrompt = '你是一个数据提取助手。分析用户的输入，使用 submit_extracted_data 工具返回结构化数据。不要输出任何文本，直接调用工具提交数据。';
      const systemPrompt = customSystemPrompt || defaultSystemPrompt;

      console.log('[SmartPlanner] extractWithAI starting streaming call...');
      console.log('[SmartPlanner] Inferred schema keys:', Object.keys(inferredSchema));
      console.log('[SmartPlanner] Prompt length:', prompt.length, 'characters');
      console.log('[SmartPlanner] Prompt being sent (first 1000 chars):\n', prompt.slice(0, 1000));

      // 使用流式 API 以便打印完整输出
      let fullText = '';
      let toolInputJson = '';
      let currentToolName = '';
      let hasToolUse = false;

      for await (const event of client.createMessageStream(
        [{ role: 'user', content: prompt }],
        [extractTool],
        systemPrompt,
        {
          enableThinking: false,
          // 强制 AI 必须调用 submit_extracted_data 工具
          toolChoice: { type: 'tool', name: 'submit_extracted_data' },
        }
      )) {
        // 打印每个流式事件
        if (event.type === 'text' && event.text) {
          fullText += event.text;
          console.log('[SmartPlanner][Stream] Text:', event.text);
        } else if (event.type === 'thinking' && event.thinking) {
          console.log('[SmartPlanner][Stream] Thinking:', event.thinking);
        } else if (event.type === 'tool_use_start') {
          hasToolUse = true;
          currentToolName = event.name || '';
          console.log('[SmartPlanner][Stream] Tool call started:', currentToolName);
        } else if (event.type === 'tool_use_delta' && event.input) {
          toolInputJson += event.input;
          // 每收到增量就打印（但不打印换行，避免日志过多）
          process.stdout.write(event.input);
        } else if (event.type === 'stop') {
          console.log('\n[SmartPlanner][Stream] Stream ended, reason:', event.stopReason);
        } else if (event.type === 'error') {
          console.error('[SmartPlanner][Stream] Error:', event.error);
        } else if (event.type === 'usage') {
          console.log('[SmartPlanner][Stream] Token usage:', JSON.stringify(event.usage));
        }
      }

      console.log('[SmartPlanner] Streaming call completed');
      console.log('[SmartPlanner] Received text length:', fullText.length);
      console.log('[SmartPlanner] Received tool input length:', toolInputJson.length);

      // 如果有工具调用，解析工具输入
      if (hasToolUse && toolInputJson) {
        console.log('[SmartPlanner] extractWithAI succeeded, AI called tool:', currentToolName);
        console.log('[SmartPlanner] Tool input JSON (complete):\n', toolInputJson);

        try {
          const inputData = JSON.parse(toolInputJson) as T;
          console.log('[SmartPlanner] Tool returned data keys:', Object.keys(inputData || {}));
          return inputData;
        } catch (parseError) {
          console.error('[SmartPlanner] Tool input JSON parsing failed:', parseError);
          console.error('[SmartPlanner] Raw JSON:', toolInputJson);
        }
      }

      // 如果AI没有调用工具，尝试从文本中解析（降级方案）
      if (fullText) {
        console.log('[SmartPlanner] AI returned text, attempting to parse JSON...');
        console.log('[SmartPlanner] Text content (complete):\n', fullText);
        const parsed = this.tryParseJSON<T>(fullText);
        if (parsed !== null) {
          console.log('[SmartPlanner] JSON parsing succeeded');
          return parsed;
        }
        console.warn('[SmartPlanner] JSON parsing failed');
      }

      console.warn('[SmartPlanner] AI did not call tool and text parsing failed, using default values');
      return defaultValue;
    } catch (error) {
      console.error('[SmartPlanner] AI extraction failed:', error);
      return defaultValue;
    }
  }

  /**
   * 从默认值推断 JSON Schema
   */
  private inferSchemaFromValue(value: any): Record<string, any> {
    if (value === null || value === undefined) {
      return {};
    }

    const schema: Record<string, any> = {};

    for (const [key, val] of Object.entries(value)) {
      if (Array.isArray(val)) {
        schema[key] = {
          type: 'array',
          items: val.length > 0 ? this.inferTypeSchema(val[0]) : { type: 'string' },
        };
      } else {
        schema[key] = this.inferTypeSchema(val);
      }
    }

    return schema;
  }

  /**
   * 推断单个值的类型 schema
   *
   * 关键改进：
   * - 对于对象类型，添加 required 字段，确保 AI 必须填充所有属性
   * - 对于数组类型，设置 description 提示 AI 生成内容
   */
  private inferTypeSchema(val: any): Record<string, any> {
    if (val === null || val === undefined) {
      return { type: 'string' };
    }
    if (typeof val === 'string') {
      return { type: 'string' };
    }
    if (typeof val === 'number') {
      return { type: 'number' };
    }
    if (typeof val === 'boolean') {
      return { type: 'boolean' };
    }
    if (Array.isArray(val)) {
      return {
        type: 'array',
        items: val.length > 0 ? this.inferTypeSchema(val[0]) : { type: 'string' },
        // 提示 AI 这个数组应该有元素
        description: '请根据需求生成完整的数组内容',
      };
    }
    if (typeof val === 'object') {
      const properties = this.inferSchemaFromValue(val);
      return {
        type: 'object',
        properties,
        // 关键修复：添加 required 字段，确保 AI 必须填充所有属性
        required: Object.keys(properties),
      };
    }
    return { type: 'string' };
  }

  /**
   * 尝试从文本解析 JSON（降级方案）
   */
  private tryParseJSON<T>(text: string): T | null {
    // 清理 markdown 代码块
    const cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // 尝试提取 {...} 部分
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // v4.0 新增：API 契约生成（事前约束）
  // --------------------------------------------------------------------------

  /**
   * 生成 API 契约
   * 在任务分解之前，根据需求生成 API 契约，确保前后端一致
   *
   * @param blueprint 蓝图
   * @param explorationContext 代码库探索上下文
   * @returns API 契约
   */
  private async generateAPIContract(
    blueprint: Blueprint,
    explorationContext: string
  ): Promise<APIContract | null> {
    // 让 AI 自己判断是否需要 API 契约，而不是用脆弱的正则匹配
    console.log('[SmartPlanner] Analyzing whether project needs API contract...');

    try {
      const loop = new ConversationLoop({
        model: this.getClient().getModel(),
        maxTurns: 5,
        verbose: false,
        permissionMode: 'bypassPermissions',
        workingDir: blueprint.projectPath,
        systemPrompt: `你是 API 契约设计专家。你需要先判断项目是否需要 API 契约，然后根据需求设计契约。

## 判断标准
以下项目类型**需要** API 契约：
- 前后端分离项目（前端通过 HTTP/REST 调用后端）
- 提供 API 给第三方调用的服务
- 微服务架构中的服务间通信

以下项目类型**不需要** API 契约：
- 纯前端项目（静态网站、SPA 无后端）
- 纯后端项目（CLI 工具、脚本、库）
- 单体全栈项目（模板渲染，无 API 层）
- 移动端 App（除非有自建后端）

## 输出格式
如果**不需要**契约：
\`\`\`json
{ "needsContract": false, "reason": "简述原因" }
\`\`\`

如果**需要**契约，设计完整的 API：
\`\`\`json
{
  "needsContract": true,
  "apiPrefix": "/api/v1",
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/v1/auth/login",
      "description": "用户登录",
      "requestBody": "{ username, password }",
      "responseType": "{ token, user }"
    }
  ]
}
\`\`\`

设计原则（仅当需要契约时）：
1. 使用统一的 API 前缀
2. 遵循 RESTful 规范
3. 路径命名使用小写和连字符`,
        isSubAgent: true,
      });

      const prompt = `分析以下项目，判断是否需要 API 契约，如需要则设计完整契约：

## 项目需求
${blueprint.requirements?.join('\n') || blueprint.description}

## 技术栈
${JSON.stringify(blueprint.techStack, null, 2)}

${explorationContext ? `## 现有代码结构\n${explorationContext}` : ''}

请先判断是否需要 API 契约，然后按要求输出 JSON。`;

      const result = await loop.processMessage(prompt);

      if (result) {
        const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1]);

          // AI 判断不需要契约
          if (parsed.needsContract === false) {
            console.log('[SmartPlanner] AI determined project does not need API contract:', parsed.reason);
            return null;
          }

          console.log('[SmartPlanner] API contract generated successfully:', parsed.endpoints?.length, 'endpoints');
          return {
            apiPrefix: parsed.apiPrefix || '/api/v1',
            endpoints: parsed.endpoints || [],
            generatedAt: new Date(),
          };
        }
      }

      console.warn('[SmartPlanner] Cannot parse API contract response');
      return null;

    } catch (error: any) {
      console.error('[SmartPlanner] API contract generation failed:', error.message);
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // v2.0 新增：Agent 模式探索代码库
  // --------------------------------------------------------------------------

  /**
   * 使用 Agent 模式探索代码库
   * 在任务分解前先了解代码库结构，以便更准确地分解任务
   *
   * @param projectPath 项目路径
   * @param requirements 需求列表
   * @returns 探索结果
   */
  private async exploreCodebase(
    projectPath: string,
    requirements: string[]
  ): Promise<CodebaseExploration | null> {
    if (!this.config.exploreBeforeDecompose) {
      return null;
    }

    this.emit('planner:exploring', { projectPath });

    const systemPrompt = `你是一个代码库探索助手。你的任务是探索代码库结构，为后续的任务分解提供上下文。

你可以使用以下工具：
- Glob: 搜索文件
- Grep: 搜索代码内容
- Read: 读取文件内容

请探索代码库并收集以下信息：
1. 目录结构概要
2. 主要模块/组件
3. 技术栈（语言、框架、测试框架等）
4. 代码风格/约定
5. 关键配置文件

探索完成后，请用以下 JSON 格式总结你的发现：
\`\`\`json
{
  "directoryStructure": "目录结构概要",
  "discoveredModules": [
    {"name": "模块名", "path": "路径", "description": "描述", "files": ["文件列表"]}
  ],
  "detectedTechStack": {
    "language": "typescript/javascript/python/go/rust/java/unknown",
    "framework": "框架名称",
    "testFramework": "测试框架",
    "packageManager": "包管理器"
  },
  "codeConventions": {
    "namingStyle": "camelCase/snake_case/PascalCase",
    "hasTypescript": true/false,
    "hasTests": true/false,
    "testPattern": "测试文件模式"
  },
  "keyFiles": {
    "entryPoint": "入口文件",
    "config": ["配置文件列表"],
    "tests": ["测试目录"]
  },
  "observations": ["观察1", "观察2"]
}
\`\`\`

【重要】你的最终响应必须包含上述 JSON 代码块，这是探索结果的输出格式要求，不能省略。`;

    const userPrompt = `请探索以下项目的代码库结构：

项目路径: ${projectPath}

需求上下文（用于了解需要关注哪些部分）：
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

请使用工具探索代码库，然后总结你的发现。`;

    try {
      const loop = new ConversationLoop({
        model: this.getClient().getModel(),
        maxTurns: this.config.exploreMaxTurns,
        verbose: false,
        permissionMode: 'bypassPermissions',
        workingDir: projectPath,
        systemPrompt,
        isSubAgent: true,
      });

      const result = await loop.processMessage(userPrompt);

      // 从结果中提取 JSON
      let explorationData: CodebaseExploration | null = null;
      if (result) {
        const extractJson = (text: string): CodebaseExploration | null => {
          // 尝试匹配 ```json ... ``` 格式
          const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
          if (jsonMatch) {
            try {
              return JSON.parse(jsonMatch[1]);
            } catch (e) {
              console.error('[SmartPlanner] JSON parsing failed (code block):', e);
            }
          }
          // 尝试直接匹配 JSON 对象
          const directMatch = text.match(/\{[\s\S]*\}/);
          if (directMatch) {
            try {
              return JSON.parse(directMatch[0]);
            } catch (e) {
              console.error('[SmartPlanner] JSON parsing failed (direct match):', e);
            }
          }
          return null;
        };

        explorationData = extractJson(result);

        if (!explorationData) {
          // 输出详细日志帮助诊断
          const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
          console.warn('[SmartPlanner] Codebase exploration: Cannot extract JSON from response');
          console.warn(`[SmartPlanner]   Response length: ${result.length}`);
          console.warn(`[SmartPlanner]   Response preview: ${preview.replace(/\n/g, '\\n')}`);
        }
      } else {
        console.warn('[SmartPlanner] Codebase exploration: AI response is empty');
      }

      this.emit('planner:explored', { projectPath, exploration: explorationData });
      return explorationData;
    } catch (error: any) {
      console.error('[SmartPlanner] Codebase exploration failed:', error);
      this.emit('planner:explored', { projectPath, error: error.message });
      return null;
    }
  }

  /**
   * 专用的任务分解方法 - 使用 Agent 分解任务
   * 不依赖 extractWithAI，有独立的实现逻辑
   * v4.0: 添加 apiContract 参数，确保任务遵循 API 契约
   */
  private async decomposeTasksWithAI(
    blueprint: Blueprint,
    explorationContext: string,
    modulesText: string,
    processesText: string,
    nfrsText: string,
    apiContract?: APIContract | null
  ): Promise<{
    tasks: Array<{
      id: string;
      name: string;
      description: string;
      type: TaskType;
      category: 'frontend' | 'backend' | 'database' | 'shared' | 'other';
      moduleId?: string;
      files: string[];
      dependencies: string[];
      needsTest: boolean;
      testStrategy?: 'unit' | 'integration' | 'e2e' | 'mock' | 'vcr' | 'skip';
      estimatedMinutes: number;
      complexity: TaskComplexity;
    }>;
    parallelGroups?: string[][];
    decisions: Array<{
      type: 'task_split' | 'parallel' | 'dependency' | 'tech_choice' | 'other';
      description: string;
      reasoning?: string;
    }>;
  }> {
    // v4.0: 如果有 API 契约，添加到 system prompt 中
    const apiContractSection = apiContract ? `

## ⚠️ API 契约（必须遵循）
以下是已定义的 API 契约，所有前后端任务必须严格遵循：
- API 前缀: ${apiContract.apiPrefix}
- 端点列表:
${apiContract.endpoints.map(ep => `  - ${ep.method} ${ep.path} (${ep.description})`).join('\n')}

**重要**：
- 后端任务必须按契约路径实现路由
- 前端任务必须按契约路径调用 API
- 不要自行修改 API 路径` : '';

    const systemPrompt = `你是一个专业的任务分解专家。你的职责是将软件项目蓝图分解为具体可执行的开发任务。

分解原则：
1. 每个任务应该能在5分钟内完成
2. 任务要有明确的输入和输出
3. 任务可以独立验证
4. 配置类/文档类任务不需要测试
5. 核心业务逻辑必须有测试
6. **前后端任务必须遵循 API 契约**（如果提供）

⚠️ 任务分组与并行执行：
- 把可以**同时执行**的任务放进同一组（parallelGroups）
- 组与组之间是**串行**的：第一组全部完成后，才执行第二组
- 例如：[[数据库模型], [后端API-A, 后端API-B], [前端组件A, 前端组件B]]
- dependencies 字段填写前置任务的 ID（用于失败时跳过依赖链）

任务类型：code(功能代码), config(配置), test(测试), refactor(重构), docs(文档), integrate(集成)
任务领域：frontend(前端), backend(后端), database(数据库), shared(共享代码), other(其他)
测试策略：unit(单元测试), integration(集成测试), e2e(端到端), mock(Mock), vcr(录制回放), skip(跳过)
复杂度：trivial, simple, moderate, complex
${apiContractSection}

完成分析后，你必须输出一个 JSON 代码块，不要包含其他说明文字，格式如下：
\`\`\`json
{
  "tasks": [
    {
      "id": "task-1",
      "name": "任务名称",
      "description": "详细描述（如果是 API 相关任务，请明确写出完整的 API 路径）",
      "type": "code",
      "category": "backend",
      "moduleId": "模块ID",
      "files": ["src/example.ts"],
      "dependencies": [],
      "needsTest": true,
      "testStrategy": "unit",
      "estimatedMinutes": 5,
      "complexity": "simple"
    }
  ],
  "parallelGroups": [
    ["task-1", "task-2"],
    ["task-3"],
    ["task-4", "task-5"]
  ],
  "decisions": [
    {
      "type": "task_split",
      "description": "决策描述",
      "reasoning": "决策理由"
    }
  ]
}
\`\`\`

⚠️ parallelGroups 必填！每个任务ID必须出现在某一组中。

【重要】你的响应必须包含上述格式的 JSON 代码块。`;

    const userPrompt = `请分解以下项目蓝图为具体的执行任务：

## 蓝图信息
- 名称：${blueprint.name}
- 描述：${blueprint.description}
${blueprint.version ? `- 版本：${blueprint.version}` : ''}

## 需求列表
${(blueprint.requirements || []).map((r, i) => `${i + 1}. ${r}`).join('\n') || '无'}

## 模块划分
${modulesText}
${processesText}
${nfrsText}

## 技术栈
${JSON.stringify(blueprint.techStack, null, 2)}

## 约束条件
${(blueprint.constraints || []).length > 0 ? blueprint.constraints!.join('\n') : '无'}
${explorationContext ? `\n## 代码库探索结果\n${explorationContext}` : ''}

请分析以上信息，将需求分解为具体的开发任务，并以 JSON 格式输出。`;

    console.log('[SmartPlanner] Starting task decomposition Agent...');
    console.log('[SmartPlanner] Prompt length:', userPrompt.length, 'characters');

    try {
      // 使用 ConversationLoop 作为 Agent 进行任务分解
      const loop = new ConversationLoop({
        model: this.getClient().getModel(),
        maxTurns: 9, // 任务分解不需要太多轮次
        verbose: false,
        permissionMode: 'bypassPermissions',
        workingDir: blueprint.projectPath,
        systemPrompt,
        isSubAgent: true,
      });

      const result = await loop.processMessage(userPrompt);

      console.log('[SmartPlanner] Agent response length:', result?.length || 0);
      console.log('[SmartPlanner] Agent response preview:', result?.slice(0, 500));

      if (!result) {
        throw new Error('Agent 返回空响应');
      }

      // 从响应中提取 JSON
      const jsonMatch = result.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        console.log('[SmartPlanner] Successfully parsed JSON, tasks count:', parsed.tasks?.length || 0);
        return parsed;
      }

      // 尝试直接匹配 JSON 对象
      const directMatch = result.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
      if (directMatch) {
        const parsed = JSON.parse(directMatch[0]);
        console.log('[SmartPlanner] Direct JSON match, tasks count:', parsed.tasks?.length || 0);
        return parsed;
      }

      console.error('[SmartPlanner] Cannot extract JSON from response');
      console.error('[SmartPlanner] Full response:', result);
      throw new Error('无法从 Agent 响应中提取任务数据');

    } catch (error: any) {
      console.error('[SmartPlanner] Task decomposition Agent failed:', error.message);
      throw new Error(`任务分解失败: ${error.message}`);
    }
  }

  /**
   * 格式化探索结果为上下文字符串
   */
  private formatExplorationContext(exploration: CodebaseExploration | null): string {
    if (!exploration) {
      return '';
    }

    const lines: string[] = [];
    lines.push('## 代码库探索结果\n');

    if (exploration.directoryStructure) {
      lines.push('### 目录结构');
      lines.push(exploration.directoryStructure);
      lines.push('');
    }

    if (exploration.discoveredModules && exploration.discoveredModules.length > 0) {
      lines.push('### 发现的模块');
      for (const mod of exploration.discoveredModules) {
        lines.push(`- **${mod.name}** (${mod.path}): ${mod.description}`);
        if (mod.files && mod.files.length > 0) {
          lines.push(`  文件: ${mod.files.slice(0, 5).join(', ')}${mod.files.length > 5 ? '...' : ''}`);
        }
      }
      lines.push('');
    }

    if (exploration.detectedTechStack) {
      lines.push('### 检测到的技术栈');
      const tech = exploration.detectedTechStack;
      if (tech.language) lines.push(`- 语言: ${tech.language}`);
      if (tech.framework) lines.push(`- 框架: ${tech.framework}`);
      if (tech.testFramework) lines.push(`- 测试框架: ${tech.testFramework}`);
      if (tech.packageManager) lines.push(`- 包管理器: ${tech.packageManager}`);
      lines.push('');
    }

    if (exploration.codeConventions) {
      lines.push('### 代码约定');
      const conv = exploration.codeConventions;
      if (conv.namingStyle) lines.push(`- 命名风格: ${conv.namingStyle}`);
      if (conv.hasTypescript !== undefined) lines.push(`- 使用 TypeScript: ${conv.hasTypescript ? '是' : '否'}`);
      if (conv.hasTests !== undefined) lines.push(`- 有测试: ${conv.hasTests ? '是' : '否'}`);
      if (conv.testPattern) lines.push(`- 测试文件模式: ${conv.testPattern}`);
      lines.push('');
    }

    if (exploration.keyFiles) {
      lines.push('### 关键文件');
      const kf = exploration.keyFiles;
      if (kf.entryPoint) lines.push(`- 入口: ${kf.entryPoint}`);
      if (kf.config && kf.config.length > 0) lines.push(`- 配置: ${kf.config.join(', ')}`);
      if (kf.tests && kf.tests.length > 0) lines.push(`- 测试: ${kf.tests.join(', ')}`);
      lines.push('');
    }

    if (exploration.observations && exploration.observations.length > 0) {
      lines.push('### 观察');
      for (const obs of exploration.observations) {
        lines.push(`- ${obs}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 生成技术栈建议 - v3.0 Multi-turn 版本
   */
  private async generateTechSuggestion(state: DialogState): Promise<TechStack> {
    // 检测项目现有技术栈
    const existingTech = this.detectExistingTechStack();

    if (existingTech.language) {
      // 使用现有技术栈，确保完整
      return this.ensureCompleteTechStack(existingTech);
    }

    // 使用 AI 推荐技术栈（AI 已有需求上下文，不需要重发）
    const session = this.getAISession();
    let aiSuggestion: Partial<TechStack> = {
      language: 'typescript' as ProjectLanguage,
      packageManager: 'npm' as PackageManagerType,
      testFramework: 'vitest' as TestFrameworkType,
    };

    for await (const event of session.suggestTechStack(existingTech)) {
      if (event.type === 'text' || event.type === 'thinking') {
        this.emit('dialog:ai_streaming', { type: event.type, content: event.text || event.thinking });
      } else if (event.type === 'tool_delta') {
        this.emit('dialog:ai_streaming', { type: 'tool_input', content: event.toolInput });
      } else if (event.type === 'tool_result' && event.result) {
        // 映射返回结果到 TechStack 格式
        const result = event.result;
        aiSuggestion = {
          language: result.language as ProjectLanguage,
          framework: result.framework,
          packageManager: result.packageManager as PackageManagerType,
          testFramework: result.testFramework as TestFrameworkType,
          buildTool: result.buildTool,
          additionalTools: result.additionalTools,
        };
      }
    }

    // 确保返回完整的技术栈
    return this.ensureCompleteTechStack(aiSuggestion);
  }

  /**
   * 检测现有技术栈
   */
  private detectExistingTechStack(): Partial<TechStack> {
    if (!this.projectPath) return {};

    const result: Partial<TechStack> = {};

    // 检测 package.json
    const packageJsonPath = path.join(this.projectPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // 检测语言
        if (fs.existsSync(path.join(this.projectPath, 'tsconfig.json'))) {
          result.language = 'typescript';
        } else {
          result.language = 'javascript';
        }

        // 检测包管理器
        if (fs.existsSync(path.join(this.projectPath, 'pnpm-lock.yaml'))) {
          result.packageManager = 'pnpm';
        } else if (fs.existsSync(path.join(this.projectPath, 'yarn.lock'))) {
          result.packageManager = 'yarn';
        } else if (fs.existsSync(path.join(this.projectPath, 'bun.lockb'))) {
          result.packageManager = 'bun';
        } else {
          result.packageManager = 'npm';
        }

        // 检测测试框架
        if (deps.vitest) {
          result.testFramework = 'vitest';
        } else if (deps.jest) {
          result.testFramework = 'jest';
        } else if (deps.mocha) {
          result.testFramework = 'mocha';
        }

        // 检测框架
        if (deps.react) result.framework = 'React';
        else if (deps.vue) result.framework = 'Vue';
        else if (deps.express) result.framework = 'Express';
        else if (deps.fastify) result.framework = 'Fastify';
        else if (deps['@nestjs/core']) result.framework = 'NestJS';
      } catch {
        // 忽略解析错误
      }
    }

    // 检测 Python
    if (fs.existsSync(path.join(this.projectPath, 'requirements.txt')) ||
        fs.existsSync(path.join(this.projectPath, 'pyproject.toml'))) {
      result.language = 'python';
      result.packageManager = 'pip';
      result.testFramework = 'pytest';
    }

    // 检测 Go
    if (fs.existsSync(path.join(this.projectPath, 'go.mod'))) {
      result.language = 'go';
      result.packageManager = 'go_mod';
      result.testFramework = 'go_test';
    }

    return result;
  }

  /**
   * 格式化技术栈显示
   */
  private formatTechStack(tech: Partial<TechStack>): string {
    const lines: string[] = [];

    if (tech.language) lines.push(`- **语言**: ${tech.language}`);
    if (tech.framework) lines.push(`- **框架**: ${tech.framework}`);
    if (tech.packageManager) lines.push(`- **包管理器**: ${tech.packageManager}`);
    if (tech.testFramework) lines.push(`- **测试框架**: ${tech.testFramework}`);
    if (tech.buildTool) lines.push(`- **构建工具**: ${tech.buildTool}`);
    if (tech.additionalTools && tech.additionalTools.length > 0) {
      lines.push(`- **其他工具**: ${tech.additionalTools.join(', ')}`);
    }

    return lines.join('\n');
  }

  /**
   * 确保技术栈完整
   */
  private ensureCompleteTechStack(partial?: Partial<TechStack>): TechStack {
    return {
      language: partial?.language || 'typescript',
      framework: partial?.framework,
      packageManager: partial?.packageManager || 'npm',
      testFramework: partial?.testFramework || 'vitest',
      buildTool: partial?.buildTool,
      additionalTools: partial?.additionalTools,
    };
  }

  /**
   * 生成蓝图摘要
   */
  private generateBlueprintSummary(state: DialogState): string {
    const lines: string[] = [];

    lines.push('## 需求清单');
    state.collectedRequirements.forEach((r, i) => {
      lines.push(`${i + 1}. ${r}`);
    });
    lines.push('');

    if (state.collectedConstraints.length > 0) {
      lines.push('## 约束条件');
      state.collectedConstraints.forEach((c) => {
        lines.push(`- ${c}`);
      });
      lines.push('');
    }

    if (state.techStack) {
      lines.push('## 技术栈');
      lines.push(this.formatTechStack(state.techStack));
    }

    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // 持久化
  // --------------------------------------------------------------------------

  /**
   * 保存会话状态
   */
  private saveSession(sessionId: string, state: DialogState): void {
    try {
      const filePath = path.join(getPlannersDir(), `session-${sessionId}.json`);
      const data = {
        sessionId,
        projectPath: this.projectPath,
        state: {
          ...state,
          messages: state.messages.map((m) => ({
            ...m,
            timestamp: m.timestamp.toISOString(),
          })),
        },
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[SmartPlanner] Failed to save session:', error);
    }
  }

  /**
   * 通过状态保存会话
   */
  private saveSessionByState(state: DialogState): void {
    for (const [sessionId, s] of this.sessions) {
      if (s === state) {
        this.saveSession(sessionId, state);
        return;
      }
    }
  }

  /**
   * 加载所有会话
   */
  private loadSessions(): void {
    try {
      const dir = getPlannersDir();
      const files = fs.readdirSync(dir);

      for (const file of files) {
        if (file.startsWith('session-') && file.endsWith('.json')) {
          const filePath = path.join(dir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const state: DialogState = {
            ...data.state,
            messages: data.state.messages.map((m: any) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            })),
          };
          this.sessions.set(data.sessionId, state);
        }
      }
    } catch (error) {
      // 忽略加载错误
    }
  }

  /**
   * 根据项目路径查找对话
   */
  private findDialogByProject(projectPath: string): DialogState | null {
    // 这里简化实现，实际可以在保存时记录项目路径映射
    return null;
  }

  /**
   * 保存蓝图
   */
  private saveBlueprint(blueprint: Blueprint): void {
    try {
      const dir = path.join(blueprint.projectPath, '.blueprint');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `${blueprint.id}.json`);
      // 辅助函数：将日期转为 ISO 字符串
      const toISO = (d: Date | string | undefined) => {
        if (!d) return undefined;
        return d instanceof Date ? d.toISOString() : d;
      };
      // 处理 designImages：只保存 filePath，不保存 imageData（base64 太大）
      let designImages = blueprint.designImages;
      if (designImages && Array.isArray(designImages)) {
        designImages = designImages.map(img => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { imageData, ...rest } = img;
          return rest;
        });
      }
      const data = {
        ...blueprint,
        designImages,
        createdAt: toISO(blueprint.createdAt),
        updatedAt: toISO(blueprint.updatedAt),
        confirmedAt: toISO(blueprint.confirmedAt),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[SmartPlanner] Failed to save blueprint:', error);
    }
  }

  /**
   * 保存执行计划
   */
  private saveExecutionPlan(plan: ExecutionPlan): void {
    try {
      // 从蓝图获取项目路径
      const blueprintDir = path.join(getPlannersDir(), 'plans');
      if (!fs.existsSync(blueprintDir)) {
        fs.mkdirSync(blueprintDir, { recursive: true });
      }
      const filePath = path.join(blueprintDir, `${plan.id}.json`);
      const data = {
        ...plan,
        createdAt: plan.createdAt.toISOString(),
        startedAt: plan.startedAt?.toISOString(),
        completedAt: plan.completedAt?.toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[SmartPlanner] Failed to save execution plan:', error);
    }
  }

  /**
   * 加载执行计划（按 plan ID）
   */
  loadExecutionPlan(planId: string): ExecutionPlan | null {
    try {
      const blueprintDir = path.join(getPlannersDir(), 'plans');
      const filePath = path.join(blueprintDir, `${planId}.json`);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      // 恢复 Date 对象
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      } as ExecutionPlan;
    } catch (error) {
      console.error('[SmartPlanner] Failed to load execution plan:', error);
      return null;
    }
  }

  /**
   * 加载执行计划（按 blueprint ID）
   */
  loadExecutionPlanByBlueprint(blueprintId: string): ExecutionPlan | null {
    try {
      const plans = this.getAllExecutionPlans();
      return plans.find(p => p.blueprintId === blueprintId) || null;
    } catch (error) {
      console.error('[SmartPlanner] Failed to load execution plan by blueprint:', error);
      return null;
    }
  }

  /**
   * 获取所有执行计划
   */
  getAllExecutionPlans(): ExecutionPlan[] {
    try {
      const blueprintDir = path.join(getPlannersDir(), 'plans');
      if (!fs.existsSync(blueprintDir)) {
        return [];
      }

      const files = fs.readdirSync(blueprintDir).filter(f => f.endsWith('.json'));
      return files.map(file => {
        const filePath = path.join(blueprintDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
          ...data,
          createdAt: new Date(data.createdAt),
          startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
          completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
        } as ExecutionPlan;
      });
    } catch (error) {
      console.error('[SmartPlanner] Failed to get all execution plans:', error);
      return [];
    }
  }

  /**
   * 检查执行计划是否存在
   */
  hasExecutionPlan(planId: string): boolean {
    const blueprintDir = path.join(getPlannersDir(), 'plans');
    const filePath = path.join(blueprintDir, `${planId}.json`);
    return fs.existsSync(filePath);
  }

  /**
   * 删除执行计划
   */
  deleteExecutionPlan(planId: string): void {
    try {
      const blueprintDir = path.join(getPlannersDir(), 'plans');
      const filePath = path.join(blueprintDir, `${planId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[SmartPlanner] Execution plan deleted: ${planId}`);
      }
    } catch (error) {
      console.error('[SmartPlanner] Failed to delete execution plan:', error);
    }
  }

  // --------------------------------------------------------------------------
  // 公共查询方法
  // --------------------------------------------------------------------------

  /**
   * 获取对话状态
   */
  getDialogState(sessionId: string): DialogState | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * 获取所有活跃对话
   */
  getAllActiveDialogs(): Array<{ sessionId: string; state: DialogState }> {
    const result: Array<{ sessionId: string; state: DialogState }> = [];
    for (const [sessionId, state] of this.sessions) {
      if (!state.isComplete) {
        result.push({ sessionId, state });
      }
    }
    return result;
  }

  /**
   * 结束对话
   */
  endDialog(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.isComplete = true;
      this.saveSession(sessionId, state);
    }
    this.emit('dialog:ended', sessionId);
  }

  /**
   * 删除对话
   */
  deleteDialog(sessionId: string): void {
    this.sessions.delete(sessionId);
    try {
      const filePath = path.join(getPlannersDir(), `session-${sessionId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // 忽略删除错误
    }
    this.emit('dialog:deleted', sessionId);
  }
}

// ============================================================================
// 导出单例和工厂函数
// ============================================================================

/**
 * 默认智能规划器实例
 */
export const smartPlanner = new SmartPlanner();

/**
 * 创建自定义配置的智能规划器
 */
export function createSmartPlanner(config?: Partial<SmartPlannerConfig>): SmartPlanner {
  return new SmartPlanner(config);
}

// ============================================================================
// 流式蓝图生成支持 (Chat 模式)
// ============================================================================

/**
 * 流式事件类型
 */
export interface StreamingEvent {
  type: 'text' | 'thinking' | 'progress' | 'complete' | 'error';
  /** 流式文本片段 */
  text?: string;
  /** AI 思考内容 */
  thinking?: string;
  /** 进度信息 */
  step?: number;
  total?: number;
  message?: string;
  /** 完成时的蓝图 */
  blueprint?: Blueprint;
  /** 错误信息 */
  error?: string;
}

/**
 * 流式蓝图生成器
 *
 * 用于在 UI 中以 chat 模式流式渲染 AI 的思考和生成过程
 */
export class StreamingBlueprintGenerator extends EventEmitter {
  private planner: SmartPlanner;
  private client: ClaudeClient;

  constructor(planner: SmartPlanner) {
    super();
    this.planner = planner;
    this.client = getDefaultClient();
  }

  /**
   * 流式生成蓝图
   *
   * @param state 完成的对话状态
   * @param projectPath 项目路径
   * @yields StreamingEvent 流式事件
   */
  async *generateBlueprintStreaming(
    state: DialogState,
    projectPath: string
  ): AsyncGenerator<StreamingEvent> {
    console.log('[StreamingBlueprintGenerator] Starting streaming blueprint generation...');

    if (!state.isComplete) {
      console.log('[StreamingBlueprintGenerator] Error: dialog not completed');
      yield { type: 'error', error: '对话未完成，无法生成蓝图' };
      return;
    }

    // Step 1: 发送开始信号
    console.log('[StreamingBlueprintGenerator] Step 1: Sending start signal');
    yield { type: 'progress', step: 1, total: 5, message: '正在分析需求...' };
    yield { type: 'text', text: '🔍 **开始分析需求...**\n\n' };

    // 构建蓝图生成的提示词
    console.log('[StreamingBlueprintGenerator] Building prompt...');
    const prompt = this.buildBlueprintPrompt(state);
    console.log('[StreamingBlueprintGenerator] Prompt length:', prompt.length);

    // Step 2: 流式调用 AI
    console.log('[StreamingBlueprintGenerator] Step 2: Starting AI API call...');
    yield { type: 'progress', step: 2, total: 5, message: 'AI 正在设计项目结构...' };

    let fullResponse = '';
    let blueprintData: any = null;

    try {
      // 使用流式 API
      console.log('[StreamingBlueprintGenerator] Calling createMessageStream...');
      for await (const event of this.client.createMessageStream(
        [{ role: 'user', content: prompt }],
        [],
        '你是一个专业的软件架构师。请根据用户的需求设计完整的项目蓝图。先用中文描述你的设计思路，然后输出 JSON 格式的蓝图数据。',
        { enableThinking: false }
      )) {
        if (event.type === 'text' && event.text) {
          fullResponse += event.text;
          // 流式发送文本片段
          console.log('[StreamingBlueprintGenerator] Received AI text fragment, length:', event.text.length);
          yield { type: 'text', text: event.text };
        } else if (event.type === 'thinking' && event.thinking) {
          console.log('[StreamingBlueprintGenerator] Received AI thinking content');
          yield { type: 'thinking', thinking: event.thinking };
        } else if (event.type === 'error') {
          console.error('[StreamingBlueprintGenerator] AI returned error:', event.error);
          yield { type: 'error', error: event.error };
          return;
        } else if (event.type === 'stop') {
          console.log('[StreamingBlueprintGenerator] AI stream ended, reason:', event.stopReason);
        }
      }
      console.log('[StreamingBlueprintGenerator] AI response completed, total length:', fullResponse.length);

      // Step 3: 解析 JSON
      yield { type: 'progress', step: 3, total: 5, message: '正在构建蓝图结构...' };
      yield { type: 'text', text: '\n\n📋 **正在解析蓝图数据...**\n' };

      blueprintData = this.extractBlueprintFromResponse(fullResponse);

      if (!blueprintData) {
        yield { type: 'error', error: '无法从 AI 响应中解析蓝图数据' };
        return;
      }

      // Step 4: 构建蓝图对象
      yield { type: 'progress', step: 4, total: 5, message: '正在保存蓝图...' };
      yield { type: 'text', text: '💾 **正在保存蓝图...**\n' };

      const blueprint = this.buildBlueprint(blueprintData, state, projectPath);

      // 保存蓝图
      this.saveBlueprint(blueprint);

      // Step 5: 完成
      yield { type: 'progress', step: 5, total: 5, message: '蓝图生成完成！' };
      yield { type: 'text', text: `\n✅ **蓝图生成完成！**\n\n蓝图 ID: \`${blueprint.id}\`\n` };
      yield { type: 'complete', blueprint };

    } catch (error: any) {
      yield { type: 'error', error: error.message || '蓝图生成失败' };
    }
  }

  /**
   * 构建蓝图生成的提示词
   */
  private buildBlueprintPrompt(state: DialogState): string {
    return `基于以下需求生成完整的项目蓝图：

需求列表：
${state.collectedRequirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

约束条件：
${state.collectedConstraints.length > 0 ? state.collectedConstraints.join('\n') : '无'}

技术栈：
${JSON.stringify(state.techStack, null, 2)}

请先用中文简要描述你的设计思路（2-3段），然后输出 JSON 格式的蓝图数据。

JSON 格式要求：
\`\`\`json
{
  "name": "项目名称",
  "description": "项目描述（2-3句话）",
  "version": "1.0.0",
  "businessProcesses": [
    {
      "id": "bp-1",
      "name": "业务流程名称",
      "description": "流程描述",
      "type": "to-be",
      "steps": [
        {
          "id": "step-1",
          "order": 1,
          "name": "步骤名称",
          "description": "步骤描述",
          "actor": "执行角色",
          "inputs": ["输入"],
          "outputs": ["输出"]
        }
      ],
      "actors": ["参与者列表"],
      "inputs": ["流程输入"],
      "outputs": ["流程输出"]
    }
  ],
  "modules": [
    {
      "id": "mod-1",
      "name": "模块名称",
      "description": "模块描述",
      "type": "frontend/backend/database/service/shared/other",
      "responsibilities": ["职责1", "职责2"],
      "techStack": ["React", "TypeScript"],
      "interfaces": [
        {
          "name": "接口名称",
          "type": "api/event/function/class",
          "description": "接口描述",
          "signature": "方法签名（可选）"
        }
      ],
      "dependencies": ["依赖的模块ID"],
      "rootPath": "src/modules/xxx",
      "source": "ai_generated",
      "files": ["涉及的文件路径"]
    }
  ],
  "nfrs": [
    {
      "id": "nfr-1",
      "category": "performance/security/reliability/scalability/maintainability/usability/other",
      "name": "需求名称",
      "description": "需求描述",
      "priority": "high/medium/low",
      "metrics": ["可量化指标"]
    }
  ]
}
\`\`\`

注意：
- 业务流程要清晰描述系统要做什么，每个步骤要有明确的输入输出
- 模块划分要合理，每个模块有明确的职责边界和接口定义
- 非功能需求要考虑性能、安全、可靠性等方面`;
  }

  /**
   * 从 AI 响应中提取蓝图数据
   */
  private extractBlueprintFromResponse(response: string): any {
    // 尝试匹配 ```json ... ``` 格式
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.error('[StreamingBlueprintGenerator] JSON 解析失败 (代码块):', e);
      }
    }

    // 尝试直接匹配 JSON 对象
    const directMatch = response.match(/\{[\s\S]*\}/);
    if (directMatch) {
      try {
        return JSON.parse(directMatch[0]);
      } catch (e) {
        console.error('[StreamingBlueprintGenerator] JSON 解析失败 (直接匹配):', e);
      }
    }

    return null;
  }

  /**
   * 构建蓝图对象
   */
  private buildBlueprint(
    data: any,
    state: DialogState,
    projectPath: string
  ): Blueprint {
    return {
      id: uuidv4(),
      name: data.name || '新项目',
      description: data.description || '',
      version: data.version || '1.0.0',
      projectPath,
      status: 'confirmed',

      businessProcesses: (data.businessProcesses || []).map((bp: any) => ({
        id: bp.id || uuidv4(),
        name: bp.name || '',
        description: bp.description || '',
        type: bp.type || 'to-be',
        steps: (bp.steps || []).map((step: any) => ({
          id: step.id || uuidv4(),
          order: step.order || 0,
          name: step.name || '',
          description: step.description || '',
          actor: step.actor || '',
          inputs: step.inputs || [],
          outputs: step.outputs || [],
        })),
        actors: bp.actors || [],
        inputs: bp.inputs || [],
        outputs: bp.outputs || [],
      })) as BusinessProcess[],

      modules: (data.modules || []).map((m: any) => ({
        id: m.id || uuidv4(),
        name: m.name,
        description: m.description,
        type: m.type,
        responsibilities: m.responsibilities || [],
        techStack: m.techStack || [],
        interfaces: (m.interfaces || []).map((iface: any) => ({
          name: iface.name,
          type: iface.type,
          description: iface.description,
          signature: iface.signature,
        })) as ModuleInterface[],
        dependencies: m.dependencies || [],
        rootPath: m.rootPath || '',
        source: m.source || 'ai_generated',
        files: m.files || [],
      })) as BlueprintModule[],

      nfrs: (data.nfrs || []).map((nfr: any) => ({
        id: nfr.id || uuidv4(),
        category: nfr.category || 'other',
        name: nfr.name || '',
        description: nfr.description || '',
        priority: nfr.priority || 'medium',
        metrics: nfr.metrics || [],
      })) as NFR[],

      requirements: state.collectedRequirements,
      techStack: state.techStack as TechStack,
      constraints: state.collectedConstraints,
      designImages: state.designImages || [],

      createdAt: new Date(),
      updatedAt: new Date(),
      confirmedAt: new Date(),
    };
  }

  /**
   * 保存蓝图
   */
  private saveBlueprint(blueprint: Blueprint): void {
    try {
      const dir = path.join(blueprint.projectPath, '.blueprint');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const filePath = path.join(dir, `${blueprint.id}.json`);
      const toISO = (d: Date | string | undefined) => {
        if (!d) return undefined;
        return d instanceof Date ? d.toISOString() : d;
      };
      // 处理 designImages：只保存 filePath，不保存 imageData（base64 太大）
      let designImages = blueprint.designImages;
      if (designImages && Array.isArray(designImages)) {
        designImages = designImages.map(img => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { imageData, ...rest } = img;
          return rest;
        });
      }
      const data = {
        ...blueprint,
        designImages,
        createdAt: toISO(blueprint.createdAt),
        updatedAt: toISO(blueprint.updatedAt),
        confirmedAt: toISO(blueprint.confirmedAt),
      };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('[StreamingBlueprintGenerator] Failed to save blueprint:', error);
    }
  }
}
