/**
 * E2ETestAgent - 纯 Agent 版本
 *
 * 设计理念：
 * - 只给 Agent 背景信息和目标
 * - 让 Agent 自主决定测试流程
 * - 通过 SubmitE2EResult 工具返回结果
 *
 * Agent 自己负责：
 * - 环境准备（启动服务、安装依赖）
 * - 测试执行（按蓝图业务流程）
 * - 问题修复（发现问题自己解决）
 * - 结果汇报
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ConversationLoop, LoopOptions } from '../core/loop.js';
import { CHROME_MCP_TOOLS, getToolNamesWithPrefix } from '../chrome-mcp/tools.js';
import { setupChromeNativeHost } from '../chrome-mcp/native-host.js';
import { registerMcpServer, registerMcpToolsToRegistry } from '../tools/mcp.js';
import { toolRegistry } from '../tools/index.js';
import { SubmitE2EResultTool, SubmitE2EResultInput, E2EStepResult } from '../tools/submit-e2e-result.js';
import type {
  Blueprint,
  DesignImage,
  TechStack,
  ModelType,
} from './types.js';

// ============================================================================
// 类型定义（简化版）
// ============================================================================

export interface E2ETestConfig {
  /** 最大测试时间（毫秒），默认 30 分钟 */
  maxTestDuration?: number;
  /** 使用的模型，默认 sonnet */
  model?: ModelType;
  /** 截图保存目录 */
  screenshotDir?: string;
  /** 设计图对比相似度阈值 (0-100) */
  similarityThreshold?: number;
}

export interface E2ETestContext {
  blueprint: Blueprint;
  projectPath: string;
  techStack: TechStack;
  designImages: DesignImage[];
  appUrl?: string;
}

export interface E2ETestResult {
  success: boolean;
  totalDuration: number;
  steps: E2EStepResult[];
  passedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  designComparisonsPassed: number;
  designComparisonsFailed: number;
  fixAttempts: Array<{ round: number; description: string; success: boolean }>;
  summary: string;
  /** v10.1: E2E Agent 的完整文本输出（对齐 TaskTool 模式） */
  rawResponse?: string;
}

// AskUserQuestion 事件类型
export interface AskUserRequestEvent {
  requestId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

export interface AskUserResponseData {
  answers: Record<string, string>;
  cancelled?: boolean;
}

// ============================================================================
// E2ETestAgent 实现（纯 Agent 版本）
// ============================================================================

export class E2ETestAgent extends EventEmitter {
  private config: E2ETestConfig;
  private conversationLoop: ConversationLoop | null = null;
  private chromeMcpRegistered = false;

  // AskUserQuestion 支持
  private pendingAskUserResolvers: Map<string, {
    resolve: (data: AskUserResponseData) => void;
    reject: (error: Error) => void;
  }> = new Map();

  constructor(config: E2ETestConfig = {}) {
    super();
    this.config = {
      maxTestDuration: 1800000,  // 30 分钟
      model: 'sonnet',
      screenshotDir: '.e2e-screenshots',
      similarityThreshold: 80,
      ...config,
    };
  }

  /**
   * 响应 AskUserQuestion 请求
   */
  resolveAskUser(requestId: string, response: AskUserResponseData): void {
    const resolver = this.pendingAskUserResolvers.get(requestId);
    if (resolver) {
      resolver.resolve(response);
      this.pendingAskUserResolvers.delete(requestId);
    }
  }

  /**
   * 创建 askUserHandler 回调
   */
  private createAskUserHandler(): (input: { questions: AskUserRequestEvent['questions'] }) => Promise<AskUserResponseData> {
    return async (input) => {
      const requestId = `ask-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      return new Promise<AskUserResponseData>((resolve, reject) => {
        this.pendingAskUserResolvers.set(requestId, { resolve, reject });
        this.emit('ask:request', { requestId, questions: input.questions });
        setTimeout(() => {
          if (this.pendingAskUserResolvers.has(requestId)) {
            this.pendingAskUserResolvers.delete(requestId);
            reject(new Error('AskUserQuestion timeout: 5 minutes'));
          }
        }, 5 * 60 * 1000);
      });
    };
  }

  /**
   * 确保 Chrome MCP 工具已注册
   */
  private async ensureChromeMcpRegistered(): Promise<void> {
    if (this.chromeMcpRegistered) return;
    try {
      const chromeConfig = await setupChromeNativeHost();
      for (const [name, config] of Object.entries(chromeConfig.mcpConfig)) {
        registerMcpServer(name, config as any, CHROME_MCP_TOOLS as any);
        registerMcpToolsToRegistry(name, CHROME_MCP_TOOLS as any, toolRegistry);
      }
      this.chromeMcpRegistered = true;
      this.log('Chrome MCP 工具已注册');
    } catch (error) {
      this.log(`Chrome MCP 注册: ${error instanceof Error ? error.message : '可能已注册'}`);
      this.chromeMcpRegistered = true;
    }
  }

  /**
   * 执行端到端测试（纯 Agent 版本）
   *
   * 核心改变：不再手动管理测试步骤，让 Agent 自主决定
   */
  async execute(context: E2ETestContext): Promise<E2ETestResult> {
    const startTime = Date.now();

    this.log('========== E2E 测试开始 ==========');
    this.log(`蓝图: ${context.blueprint.name}`);
    this.log(`设计图数量: ${context.designImages.length}`);

    try {
      // 1. 注册 Chrome MCP 工具
      await this.ensureChromeMcpRegistered();

      // 2. 确保截图目录存在
      const screenshotDir = path.join(context.projectPath, this.config.screenshotDir!);
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      // 3. 清除之前的结果
      SubmitE2EResultTool.clearE2EResult();

      // 4. 创建 Agent
      this.conversationLoop = this.createConversationLoop(context);

      // 5. 构建任务 Prompt
      const taskPrompt = this.buildTaskPrompt(context);

      // 6. 执行 Agent（让它自己完成所有事情）
      // v10.1: 收集 raw text（对齐 TaskTool 模式）
      this.log('🤖 启动 E2E 测试 Agent...');
      let rawResponse = '';
      for await (const event of this.conversationLoop.processMessageStream(taskPrompt)) {
        if (event.type === 'text' && event.content) {
          rawResponse += event.content;
        }
        this.handleStreamEvent(event);
      }

      // 7. 从工具调用获取结果
      const toolResult = SubmitE2EResultTool.getLastE2EResult();
      if (toolResult) {
        const result = this.convertToE2ETestResult(toolResult, Date.now() - startTime);
        result.rawResponse = rawResponse;
        return result;
      }

      // Agent 没有调用 SubmitE2EResult，返回失败
      this.log('❌ Agent 未调用 SubmitE2EResult 工具');
      const failedResult = this.createFailedResult('Agent 未完成测试流程', Date.now() - startTime);
      failedResult.rawResponse = rawResponse;
      return failedResult;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`测试执行出错: ${message}`);
      return this.createFailedResult(message, Date.now() - startTime);
    } finally {
      this.conversationLoop = null;
    }
  }

  /**
   * 创建 Agent 对话循环
   */
  private createConversationLoop(context: E2ETestContext): ConversationLoop {
    const chromeMcpToolNames = getToolNamesWithPrefix();

    // v4.6: 构建并保存 systemPrompt，用于透明展示
    const systemPrompt = this.buildSystemPrompt(context);

    const loopOptions: LoopOptions = {
      model: this.config.model,
      maxTurns: 100,  // E2E 测试可能需要很多轮
      verbose: false,
      permissionMode: 'bypassPermissions',
      workingDir: context.projectPath,
      systemPrompt,
      isSubAgent: true,
      allowedTools: [
        // 基础工具
        'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'AskUserQuestion',
        // Chrome MCP 工具
        ...chromeMcpToolNames,
        // 结果提交工具
        'SubmitE2EResult',
      ],
      askUserHandler: this.createAskUserHandler(),
    };

    // v4.6: 发射 system_prompt 事件，让前端可以查看 Agent 的指令
    this.emit('stream:system_prompt', {
      agentType: 'e2e',
      systemPrompt,
      blueprintId: context.blueprint.id,
      blueprintName: context.blueprint.name,
    });

    return new ConversationLoop(loopOptions);
  }

  /**
   * 格式化技术栈信息
   * 从 TechStack 和 Blueprint 中提取完整的技术信息
   */
  private formatTechStackInfo(context: E2ETestContext): string {
    const ts = context.techStack;
    const bp = context.blueprint;
    const lines: string[] = [];

    // 基础语言和框架
    let techLine = `- 技术栈: ${ts.language}`;
    if (ts.framework) {
      techLine += ` + ${ts.framework}`;
    }
    lines.push(techLine);

    // UI 框架
    if (ts.uiFramework && ts.uiFramework !== 'none') {
      lines.push(`- UI 组件库: ${ts.uiFramework}`);
    }

    // CSS 方案
    if (ts.cssFramework && ts.cssFramework !== 'none') {
      lines.push(`- CSS 方案: ${ts.cssFramework}`);
    }

    // API 风格
    if (ts.apiStyle) {
      lines.push(`- API 风格: ${ts.apiStyle.toUpperCase()}`);
    }

    // 包管理器
    if (ts.packageManager) {
      lines.push(`- 包管理器: ${ts.packageManager}`);
    }

    // 测试框架
    if (ts.testFramework) {
      lines.push(`- 测试框架: ${ts.testFramework}`);
    }

    // API 契约信息
    if (bp.apiContract) {
      lines.push(`- API 前缀: ${bp.apiContract.apiPrefix}`);
      if (bp.apiContract.endpoints?.length) {
        lines.push(`- API 端点数: ${bp.apiContract.endpoints.length} 个`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 格式化模块信息
   * 展示项目的前后端分离结构
   */
  private formatModulesInfo(context: E2ETestContext): string {
    const modules = context.blueprint.modules;
    if (!modules || modules.length === 0) {
      return '';
    }

    const lines: string[] = ['', '## 项目结构'];

    // 检测项目类型
    const hasTypeField = modules.some((m: any) => m.type);

    if (hasTypeField) {
      // 完整模块定义 (BlueprintModule)
      const frontendModules = modules.filter((m: any) => m.type === 'frontend');
      const backendModules = modules.filter((m: any) => m.type === 'backend');
      const databaseModules = modules.filter((m: any) => m.type === 'database');
      const otherModules = modules.filter((m: any) =>
        !['frontend', 'backend', 'database'].includes(m.type)
      );

      if (frontendModules.length > 0 && backendModules.length > 0) {
        lines.push('- **架构**: 前后端分离');
      }

      if (frontendModules.length > 0) {
        lines.push('- **前端模块**:');
        for (const mod of frontendModules) {
          const m = mod as any;
          lines.push(`  - ${m.name}: ${m.description || ''}${m.rootPath ? ` (${m.rootPath})` : ''}`);
        }
      }

      if (backendModules.length > 0) {
        lines.push('- **后端模块**:');
        for (const mod of backendModules) {
          const m = mod as any;
          lines.push(`  - ${m.name}: ${m.description || ''}${m.rootPath ? ` (${m.rootPath})` : ''}`);
        }
      }

      if (databaseModules.length > 0) {
        lines.push('- **数据库模块**:');
        for (const mod of databaseModules) {
          const m = mod as any;
          lines.push(`  - ${m.name}: ${m.description || ''}`);
        }
      }

      if (otherModules.length > 0) {
        lines.push('- **其他模块**:');
        for (const mod of otherModules) {
          const m = mod as any;
          lines.push(`  - ${m.name}: ${m.description || ''}`);
        }
      }
    } else {
      // 简化模块定义 (SimpleModule)
      lines.push('- **模块列表**:');
      for (const mod of modules) {
        const m = mod as any;
        lines.push(`  - ${m.name}: ${m.description || ''}${m.path ? ` (${m.path})` : ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 构建 System Prompt
   *
   * 核心：告诉 Agent 它是谁、有什么工具、要完成什么目标
   */
  private buildSystemPrompt(context: E2ETestContext): string {
    const platform = os.platform();
    const platformInfo = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';
    const appUrl = context.appUrl || 'http://localhost:3000';

    // 构建详细的技术栈信息
    const techStackInfo = this.formatTechStackInfo(context);

    // 构建模块信息
    const modulesInfo = this.formatModulesInfo(context);

    return `你是专业的端到端测试 Agent，负责验收项目是否符合设计要求。

## 你的能力
你拥有完整的开发和测试能力：
- **代码工具**: Read, Write, Edit, Glob, Grep, Bash
- **浏览器工具**: Chrome MCP 工具（导航、交互、截图、读取控制台）
- **沟通工具**: AskUserQuestion（需要用户帮助时）
- **结果提交**: SubmitE2EResult（测试完成后必须调用）

## 环境信息
- 平台: ${platformInfo}
- 项目路径: ${context.projectPath}
- 预期 URL: ${appUrl}
${techStackInfo}
${modulesInfo}

## 核心原则

### 1. 你没有解决不了的问题
- 缺少依赖 → npm install / pip install
- 缺少配置 → 复制 .env.example 或创建
- 服务未启动 → 用 Bash 启动
- 软件未安装 → 直接安装（winget/brew/apt）
- 需要用户信息 → 用 AskUserQuestion 询问

### 2. 先探索后行动
- 用 Read/Glob/Grep 了解项目结构
- 用 Bash 检查环境状态（node -v, docker -v 等）
- 理解启动命令（查看 package.json scripts）

### 3. 测试要全面但高效
- 按业务流程测试，不是随机点击
- 发现问题先尝试修复
- 与设计图对比时关注关键视觉元素

## Chrome MCP 浏览器工具

### 标签页管理
- mcp__claude-in-chrome__tabs_context_mcp: 获取浏览器状态（**首先调用**）
- mcp__claude-in-chrome__tabs_create_mcp: 创建新标签页

### 页面操作
- mcp__claude-in-chrome__navigate: 导航到 URL
- mcp__claude-in-chrome__read_page: 读取页面元素（获取 ref_id）
- mcp__claude-in-chrome__find: 自然语言查找元素
- mcp__claude-in-chrome__get_page_text: 获取页面文本

### 表单和交互
- mcp__claude-in-chrome__form_input: 填写表单
- mcp__claude-in-chrome__computer: 鼠标/键盘操作

### 调试
- mcp__claude-in-chrome__read_console_messages: 读取控制台
- mcp__claude-in-chrome__read_network_requests: 读取网络请求

## ⚠️ 最重要：完成后必须调用 SubmitE2EResult

测试完成后，你**必须**调用 SubmitE2EResult 工具提交结果：

\`\`\`
SubmitE2EResult({
  "success": true,
  "summary": "所有测试步骤通过，页面与设计图一致",
  "steps": [
    { "name": "环境准备", "status": "passed" },
    { "name": "首页加载", "status": "passed" },
    { "name": "用户登录", "status": "passed" }
  ],
  "totalDuration": 45000
})
\`\`\`

如果测试失败：
\`\`\`
SubmitE2EResult({
  "success": false,
  "summary": "登录功能测试失败",
  "steps": [
    { "name": "环境准备", "status": "passed" },
    { "name": "首页加载", "status": "passed" },
    { "name": "用户登录", "status": "failed", "error": "登录按钮点击无响应" }
  ],
  "fixAttempts": [
    { "description": "检查 onClick 事件绑定", "success": false }
  ]
})
\`\`\``;
  }

  /**
   * 构建任务 Prompt
   *
   * 核心：给 Agent 所有背景信息，让它自己决定如何测试
   */
  private buildTaskPrompt(context: E2ETestContext): string {
    const appUrl = context.appUrl || 'http://localhost:3000';

    let prompt = `# E2E 测试任务

## 项目信息
- **名称**: ${context.blueprint.name}
- **描述**: ${context.blueprint.description}
- **路径**: ${context.projectPath}
- **预期 URL**: ${appUrl}

`;

    // 添加需求列表
    if (context.blueprint.requirements?.length) {
      prompt += `## 核心需求
${context.blueprint.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

`;
    }

    // 添加业务流程
    if (context.blueprint.businessProcesses?.length) {
      prompt += `## 业务流程（按此顺序测试）
`;
      for (const process of context.blueprint.businessProcesses) {
        prompt += `### ${process.name}
${process.description}

步骤：
${process.steps.map((s, i) => `${i + 1}. **${s.name}** - ${s.description}
   - 执行者: ${s.actor}
   - 输入: ${s.inputs?.join(', ') || '无'}
   - 预期输出: ${s.outputs?.join(', ') || '操作成功'}`).join('\n')}

`;
      }
    }

    // 添加设计图信息
    if (context.designImages?.length) {
      prompt += `## UI 设计图
以下是设计图文件，请用 Read 工具读取并作为界面验收参考：
${context.designImages.map(img => `- **${img.name}** (${img.style}): \`${img.filePath}\`${img.description ? ` - ${img.description}` : ''}`).join('\n')}

`;
    }

    // 添加约束
    if (context.blueprint.constraints?.length) {
      prompt += `## 约束条件
${context.blueprint.constraints.map(c => `- ${c}`).join('\n')}

`;
    }

    prompt += `## 你的任务

请完成以下测试流程：

### 1. 环境准备
- 检查项目依赖是否安装
- 检查服务是否已启动（curl ${appUrl} 或类似方法）
- 如果服务未启动，启动它（查看 package.json 找到启动命令）
- 确保可以访问 ${appUrl}

### 2. 执行测试
- 按照上述业务流程依次测试
- 每个步骤：
  1. 使用 Chrome MCP 工具操作页面
  2. 验证预期结果
  3. 检查控制台是否有错误
  4. 如果有设计图，对比页面效果

### 3. 问题处理
- 发现问题时，先尝试自己修复（改代码、改配置）
- 修复后重新测试
- 无法解决的问题，用 AskUserQuestion 询问用户

### 4. 提交结果
- **测试完成后必须调用 SubmitE2EResult 工具**
- 记录所有测试步骤和结果
- 包含任何修复尝试的记录

现在开始测试！首先获取浏览器状态（tabs_context_mcp）。`;

    return prompt;
  }

  /**
   * 处理流式事件（转发给外部监听器）
   */
  private handleStreamEvent(event: any): void {
    switch (event.type) {
      case 'text':
        if (event.content) {
          this.emit('stream:text', { content: event.content });
        }
        break;
      case 'tool_start':
        if (event.toolName) {
          this.emit('stream:tool_start', {
            toolName: event.toolName,
            toolInput: event.toolInput,
          });
        }
        break;
      case 'tool_end':
        if (event.toolName) {
          this.emit('stream:tool_end', {
            toolName: event.toolName,
            toolResult: event.toolResult,
            toolError: event.toolError,
          });
        }
        break;
    }
  }

  /**
   * 将工具结果转换为 E2ETestResult
   */
  private convertToE2ETestResult(toolResult: SubmitE2EResultInput, totalDuration: number): E2ETestResult {
    const passedSteps = toolResult.steps.filter(s => s.status === 'passed').length;
    const failedSteps = toolResult.steps.filter(s => s.status === 'failed').length;
    const skippedSteps = toolResult.steps.filter(s => s.status === 'skipped').length;

    const designComparisons = toolResult.steps.filter(s => s.designComparison);
    const designComparisonsPassed = designComparisons.filter(s => s.designComparison?.passed).length;
    const designComparisonsFailed = designComparisons.filter(s => !s.designComparison?.passed).length;

    const fixAttempts = (toolResult.fixAttempts || []).map((f, i) => ({
      round: i + 1,
      description: f.description,
      success: f.success,
    }));

    this.log('\n========== E2E 测试完成 ==========');
    this.log(`总耗时: ${totalDuration}ms`);
    this.log(`通过: ${passedSteps}, 失败: ${failedSteps}`);
    this.log(`结果: ${toolResult.success ? '成功' : '失败'}`);

    return {
      success: toolResult.success,
      totalDuration: toolResult.totalDuration || totalDuration,
      steps: toolResult.steps,
      passedSteps,
      failedSteps,
      skippedSteps,
      designComparisonsPassed,
      designComparisonsFailed,
      fixAttempts,
      summary: toolResult.summary,
    };
  }

  /**
   * 创建失败结果
   */
  private createFailedResult(error: string, totalDuration: number): E2ETestResult {
    return {
      success: false,
      totalDuration,
      steps: [],
      passedSteps: 0,
      failedSteps: 1,
      skippedSteps: 0,
      designComparisonsPassed: 0,
      designComparisonsFailed: 0,
      fixAttempts: [],
      summary: `测试执行失败: ${error}`,
    };
  }

  /**
   * 获取调试信息（探针功能）
   * 返回 E2E Agent 当前的系统提示词、消息体、工具列表等
   */
  getDebugInfo(): { systemPrompt: string; messages: unknown[]; tools: unknown[]; model: string; messageCount: number; agentType: string } | null {
    if (!this.conversationLoop) {
      return null;
    }
    const info = this.conversationLoop.getDebugInfo();
    return {
      ...info,
      agentType: 'e2e',
    };
  }

  /**
   * 用户插嘴
   */
  interject(message: string): boolean {
    if (!this.conversationLoop) {
      this.log('插嘴失败：当前没有正在执行的测试');
      return false;
    }
    try {
      const session = this.conversationLoop.getSession();
      session.addMessage({
        role: 'user',
        content: `[用户插嘴] ${message}`,
      });
      this.log(`用户插嘴: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
      this.emit('stream:text', { content: `\n[用户插嘴] ${message}\n` });
      return true;
    } catch (error) {
      this.log(`插嘴失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private log(message: string): void {
    console.log(`[E2ETestAgent] ${message}`);
    this.emit('log', message);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

export function createE2ETestAgent(config: E2ETestConfig = {}): E2ETestAgent {
  return new E2ETestAgent(config);
}

export async function runE2ETest(
  blueprint: Blueprint,
  config: E2ETestConfig = {}
): Promise<E2ETestResult> {
  const agent = createE2ETestAgent(config);

  const context: E2ETestContext = {
    blueprint,
    projectPath: blueprint.projectPath,
    techStack: blueprint.techStack || {
      language: 'typescript',
      packageManager: 'npm',
    },
    designImages: blueprint.designImages || [],
    appUrl: 'http://localhost:3000',
  };

  return agent.execute(context);
}
