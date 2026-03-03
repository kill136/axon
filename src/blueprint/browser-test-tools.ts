/**
 * BrowserTestTools - 端到端测试专用浏览器工具
 *
 * 封装 Chrome MCP 工具，提供更高级的测试 API：
 * - 应用启动/停止
 * - 截图与设计图对比
 * - 表单操作与断言
 * - 等待与超时处理
 *
 * 设计理念：让 E2E 测试 Agent 能够像人一样操作浏览器验收功能
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 浏览器测试配置
 */
export interface BrowserTestConfig {
  /** 项目路径 */
  projectPath: string;
  /** 前端启动命令 */
  frontendCommand?: string;
  /** 后端启动命令 */
  backendCommand?: string;
  /** 前端端口 */
  frontendPort?: number;
  /** 后端端口 */
  backendPort?: number;
  /** 启动超时（毫秒） */
  startupTimeout?: number;
  /** MCP 工具调用器 */
  mcpToolCaller: McpToolCaller;
}

/**
 * MCP 工具调用器接口
 */
export interface McpToolCaller {
  call(toolName: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

/**
 * MCP 工具调用结果
 */
export interface McpToolResult {
  success: boolean;
  content?: string;
  error?: string;
  image?: {
    data: string;  // base64
    mimeType: string;
  };
}

/**
 * 页面元素
 */
export interface PageElement {
  refId: string;
  role: string;
  name?: string;
  text?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}

/**
 * 截图对比结果
 */
export interface ScreenshotCompareResult {
  /** 是否匹配 */
  matches: boolean;
  /** 相似度分数 (0-100) */
  similarityScore: number;
  /** 差异描述 */
  differences: string[];
  /** 截图路径 */
  screenshotPath: string;
  /** 设计图路径 */
  designPath: string;
}

/**
 * 测试步骤结果
 */
export interface TestStepResult {
  step: string;
  success: boolean;
  duration: number;
  error?: string;
  screenshot?: string;
  comparison?: ScreenshotCompareResult;
}

/**
 * 应用进程信息
 */
interface AppProcess {
  name: string;
  process: ChildProcess;
  port: number;
  ready: boolean;
}

// ============================================================================
// BrowserTestTools 实现
// ============================================================================

export class BrowserTestTools extends EventEmitter {
  private config: BrowserTestConfig;
  private processes: AppProcess[] = [];
  private tabId: number | null = null;
  private isRunning = false;

  constructor(config: BrowserTestConfig) {
    super();
    this.config = {
      frontendPort: 3000,
      backendPort: 3001,
      startupTimeout: 60000,
      ...config,
    };
  }

  // ==========================================================================
  // 应用启动/停止
  // ==========================================================================

  /**
   * 启动应用（前端+后端）
   */
  async startApp(): Promise<{ success: boolean; error?: string }> {
    this.log('启动应用...');

    try {
      // 检测项目类型并确定启动命令
      const commands = await this.detectStartCommands();

      // 启动后端（如果有）
      if (commands.backend) {
        await this.startProcess('backend', commands.backend, this.config.backendPort!);
      }

      // 启动前端
      if (commands.frontend) {
        await this.startProcess('frontend', commands.frontend, this.config.frontendPort!);
      }

      // 等待服务就绪
      await this.waitForServices();

      this.isRunning = true;
      this.log('应用启动成功');
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`应用启动失败: ${message}`);
      await this.stopApp();
      return { success: false, error: message };
    }
  }

  /**
   * 停止应用
   */
  async stopApp(): Promise<void> {
    this.log('停止应用...');

    for (const proc of this.processes) {
      try {
        proc.process.kill('SIGTERM');
        // 给进程时间优雅退出
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (!proc.process.killed) {
          proc.process.kill('SIGKILL');
        }
      } catch (e) {
        // 忽略已退出的进程
      }
    }

    this.processes = [];
    this.isRunning = false;
    this.log('应用已停止');
  }

  /**
   * 检测项目启动命令
   */
  private async detectStartCommands(): Promise<{ frontend?: string; backend?: string }> {
    const packageJsonPath = path.join(this.config.projectPath, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const scripts = packageJson.scripts || {};

      // 检测常见的启动脚本
      let frontend: string | undefined;
      let backend: string | undefined;

      // 前端
      if (scripts['dev:client']) {
        frontend = 'npm run dev:client';
      } else if (scripts['dev:frontend']) {
        frontend = 'npm run dev:frontend';
      } else if (scripts['start:client']) {
        frontend = 'npm run start:client';
      } else if (scripts.dev) {
        frontend = 'npm run dev';
      } else if (scripts.start) {
        frontend = 'npm start';
      }

      // 后端
      if (scripts['dev:server']) {
        backend = 'npm run dev:server';
      } else if (scripts['dev:backend']) {
        backend = 'npm run dev:backend';
      } else if (scripts['start:server']) {
        backend = 'npm run start:server';
      }

      // 使用配置中指定的命令覆盖
      if (this.config.frontendCommand) {
        frontend = this.config.frontendCommand;
      }
      if (this.config.backendCommand) {
        backend = this.config.backendCommand;
      }

      return { frontend, backend };
    }

    // Python 项目
    const pyprojectPath = path.join(this.config.projectPath, 'pyproject.toml');
    if (fs.existsSync(pyprojectPath)) {
      return {
        backend: 'python -m uvicorn main:app --reload',
      };
    }

    throw new Error('Unable to detect project type and start commands');
  }

  /**
   * 启动单个进程
   */
  private async startProcess(name: string, command: string, port: number): Promise<void> {
    this.log(`启动 ${name}: ${command}`);

    const [cmd, ...args] = command.split(' ');
    const proc = spawn(cmd, args, {
      cwd: this.config.projectPath,
      shell: true,
      env: { ...process.env, PORT: String(port) },
    });

    const appProcess: AppProcess = {
      name,
      process: proc,
      port,
      ready: false,
    };

    proc.stdout?.on('data', (data) => {
      const output = data.toString();
      this.emit('process:stdout', { name, output });

      // 检测服务就绪
      if (this.isServiceReady(output)) {
        appProcess.ready = true;
      }
    });

    proc.stderr?.on('data', (data) => {
      const output = data.toString();
      this.emit('process:stderr', { name, output });

      // 某些框架用 stderr 输出启动信息
      if (this.isServiceReady(output)) {
        appProcess.ready = true;
      }
    });

    proc.on('error', (error) => {
      this.emit('process:error', { name, error });
    });

    proc.on('exit', (code) => {
      this.emit('process:exit', { name, code });
    });

    this.processes.push(appProcess);
  }

  /**
   * 检测服务是否就绪
   */
  private isServiceReady(output: string): boolean {
    const readyPatterns = [
      /ready/i,
      /listening on/i,
      /started server/i,
      /server running/i,
      /localhost:\d+/i,
      /Local:\s+http/i,
      /compiled successfully/i,
    ];

    return readyPatterns.some(pattern => pattern.test(output));
  }

  /**
   * 等待服务就绪
   */
  private async waitForServices(): Promise<void> {
    const timeout = this.config.startupTimeout!;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const allReady = this.processes.every(p => p.ready);
      if (allReady && this.processes.length > 0) {
        // 额外等待一下确保服务完全就绪
        await new Promise(resolve => setTimeout(resolve, 2000));
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error(`Service startup timeout (${timeout}ms)`);
  }

  // ==========================================================================
  // 浏览器操作
  // ==========================================================================

  /**
   * 打开浏览器访问应用
   */
  async openBrowser(url?: string): Promise<{ success: boolean; tabId?: number; error?: string }> {
    const targetUrl = url || `http://localhost:${this.config.frontendPort}`;
    this.log(`打开浏览器: ${targetUrl}`);

    try {
      // 创建新标签页
      const createResult = await this.config.mcpToolCaller.call('tabs_create_mcp', {
        url: targetUrl,
      });

      if (!createResult.success) {
        return { success: false, error: createResult.error || 'Failed to create tab' };
      }

      // 获取标签页信息
      const contextResult = await this.config.mcpToolCaller.call('tabs_context_mcp', {});

      if (contextResult.success && contextResult.content) {
        // 解析 tabId
        const match = contextResult.content.match(/tabId[:\s]+(\d+)/i);
        if (match) {
          this.tabId = parseInt(match[1], 10);
        }
      }

      // 等待页面加载
      await this.waitForPageLoad();

      return { success: true, tabId: this.tabId || undefined };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  /**
   * 导航到指定 URL
   */
  async navigate(url: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    this.log(`导航到: ${url}`);

    const result = await this.config.mcpToolCaller.call('navigate', {
      tabId: this.tabId,
      url,
      action: 'goto',
    });

    if (result.success) {
      await this.waitForPageLoad();
    }

    return { success: result.success, error: result.error };
  }

  /**
   * 等待页面加载完成
   */
  private async waitForPageLoad(timeout = 10000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // 简单地等待一段时间，让页面加载
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 可以通过 JavaScript 检查 document.readyState
      if (this.tabId) {
        const result = await this.config.mcpToolCaller.call('javascript_tool', {
          action: 'javascript_exec',
          tabId: this.tabId,
          text: 'document.readyState',
        });

        if (result.success && result.content?.includes('complete')) {
          return;
        }
      }
    }
  }

  /**
   * 查找元素
   */
  async findElement(query: string): Promise<PageElement | null> {
    if (!this.tabId) return null;

    const result = await this.config.mcpToolCaller.call('find', {
      tabId: this.tabId,
      query,
    });

    if (result.success && result.content) {
      // 解析返回的元素信息
      const match = result.content.match(/ref_id[:\s]+"?([^"\s,]+)"?/i);
      if (match) {
        return {
          refId: match[1],
          role: 'element',
          text: query,
        };
      }
    }

    return null;
  }

  /**
   * 等待元素出现
   */
  async waitForElement(query: string, timeout = 10000): Promise<PageElement | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const element = await this.findElement(query);
      if (element) return element;
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return null;
  }

  /**
   * 点击元素
   */
  async click(refIdOrQuery: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    let refId = refIdOrQuery;

    // 如果不是 refId 格式，尝试查找元素
    if (!refIdOrQuery.match(/^[a-z0-9-]+$/i)) {
      const element = await this.findElement(refIdOrQuery);
      if (!element) {
        return { success: false, error: `Element not found: ${refIdOrQuery}` };
      }
      refId = element.refId;
    }

    this.log(`点击元素: ${refIdOrQuery}`);

    const result = await this.config.mcpToolCaller.call('computer', {
      action: 'click',
      tabId: this.tabId,
      ref_id: refId,
    });

    return { success: result.success, error: result.error };
  }

  /**
   * 输入文本
   */
  async type(text: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    this.log(`输入文本: ${text.substring(0, 50)}...`);

    const result = await this.config.mcpToolCaller.call('computer', {
      action: 'type',
      tabId: this.tabId,
      text,
    });

    return { success: result.success, error: result.error };
  }

  /**
   * 填写表单字段
   */
  async fillField(refIdOrQuery: string, value: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    let refId = refIdOrQuery;

    if (!refIdOrQuery.match(/^[a-z0-9-]+$/i)) {
      const element = await this.findElement(refIdOrQuery);
      if (!element) {
        return { success: false, error: `Element not found: ${refIdOrQuery}` };
      }
      refId = element.refId;
    }

    this.log(`填写字段: ${refIdOrQuery} = ${value.substring(0, 20)}...`);

    const result = await this.config.mcpToolCaller.call('form_input', {
      tabId: this.tabId,
      ref_id: refId,
      value,
    });

    return { success: result.success, error: result.error };
  }

  /**
   * 按键
   */
  async pressKey(key: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    this.log(`按键: ${key}`);

    const result = await this.config.mcpToolCaller.call('computer', {
      action: 'key',
      tabId: this.tabId,
      text: key,
    });

    return { success: result.success, error: result.error };
  }

  /**
   * 滚动页面
   */
  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount = 300): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    const result = await this.config.mcpToolCaller.call('computer', {
      action: 'scroll',
      tabId: this.tabId,
      direction,
      amount,
    });

    return { success: result.success, error: result.error };
  }

  // ==========================================================================
  // 截图与对比
  // ==========================================================================

  /**
   * 截取当前页面截图
   */
  async takeScreenshot(savePath?: string): Promise<{ success: boolean; path?: string; base64?: string; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    this.log('截取页面截图...');

    // 使用 read_page 获取页面内容（包含截图）
    // 或者使用 gif_creator capture 功能
    const result = await this.config.mcpToolCaller.call('gif_creator', {
      action: 'capture',
      tabId: this.tabId,
    });

    if (result.success && result.image) {
      const base64 = result.image.data;

      if (savePath) {
        const buffer = Buffer.from(base64, 'base64');
        fs.writeFileSync(savePath, buffer);
        return { success: true, path: savePath, base64 };
      }

      return { success: true, base64 };
    }

    return { success: false, error: result.error || 'Screenshot failed' };
  }

  /**
   * 与设计图对比（供 AI Agent 调用）
   *
   * 返回对比提示，让 AI 分析差异
   */
  async prepareScreenshotComparison(
    screenshotBase64: string,
    designImagePath: string
  ): Promise<{ prompt: string; images: Array<{ type: 'base64'; data: string; mediaType: string }> }> {
    // 读取设计图
    let designBase64: string;

    if (fs.existsSync(designImagePath)) {
      const designBuffer = fs.readFileSync(designImagePath);
      designBase64 = designBuffer.toString('base64');
    } else {
      throw new Error(`Design image not found: ${designImagePath}`);
    }

    return {
      prompt: `请对比以下两张图片：

**图1**: 当前页面截图（实际效果）
**图2**: 设计图（预期效果）

请分析：
1. 布局是否一致？（元素位置、大小、间距）
2. 颜色是否一致？（背景色、文字色、按钮色）
3. 文字是否正确？（内容、字体、大小）
4. 是否有遗漏或多余的元素？
5. 整体视觉效果如何？

请给出：
- 相似度评分 (0-100)
- 具体差异列表
- 是否通过验收（相似度 >= 80 为通过）`,
      images: [
        { type: 'base64', data: screenshotBase64, mediaType: 'image/png' },
        { type: 'base64', data: designBase64, mediaType: 'image/png' },
      ],
    };
  }

  // ==========================================================================
  // 断言
  // ==========================================================================

  /**
   * 断言元素存在
   */
  async assertElementExists(query: string): Promise<{ success: boolean; error?: string }> {
    const element = await this.waitForElement(query, 5000);

    if (element) {
      return { success: true };
    }

    return { success: false, error: `Element not found: ${query}` };
  }

  /**
   * 断言页面包含文本
   */
  async assertTextExists(text: string): Promise<{ success: boolean; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    const result = await this.config.mcpToolCaller.call('get_page_text', {
      tabId: this.tabId,
    });

    if (result.success && result.content?.includes(text)) {
      return { success: true };
    }

    return { success: false, error: `Page does not contain text: ${text}` };
  }

  /**
   * 断言 URL
   */
  async assertUrl(expectedUrl: string | RegExp): Promise<{ success: boolean; actualUrl?: string; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    const result = await this.config.mcpToolCaller.call('javascript_tool', {
      action: 'javascript_exec',
      tabId: this.tabId,
      text: 'window.location.href',
    });

    if (result.success && result.content) {
      const actualUrl = result.content.replace(/^["']|["']$/g, '');

      if (typeof expectedUrl === 'string') {
        if (actualUrl === expectedUrl || actualUrl.includes(expectedUrl)) {
          return { success: true, actualUrl };
        }
      } else if (expectedUrl.test(actualUrl)) {
        return { success: true, actualUrl };
      }

      return { success: false, actualUrl, error: `URL mismatch: expected ${expectedUrl}, actual ${actualUrl}` };
    }

    return { success: false, error: 'Failed to get URL' };
  }

  /**
   * 检查控制台错误
   */
  async checkConsoleErrors(): Promise<{ hasErrors: boolean; errors: string[] }> {
    if (!this.tabId) {
      return { hasErrors: false, errors: [] };
    }

    const result = await this.config.mcpToolCaller.call('read_console_messages', {
      tabId: this.tabId,
      pattern: 'error|Error|ERROR',
    });

    if (result.success && result.content) {
      const errors = result.content.split('\n').filter(line => line.trim());
      return { hasErrors: errors.length > 0, errors };
    }

    return { hasErrors: false, errors: [] };
  }

  /**
   * 检查网络错误
   */
  async checkNetworkErrors(): Promise<{ hasErrors: boolean; errors: string[] }> {
    if (!this.tabId) {
      return { hasErrors: false, errors: [] };
    }

    const result = await this.config.mcpToolCaller.call('read_network_requests', {
      tabId: this.tabId,
    });

    if (result.success && result.content) {
      // 查找 4xx 和 5xx 状态码
      const errorPattern = /status[:\s]+(4\d{2}|5\d{2})/gi;
      const matches = result.content.match(errorPattern) || [];

      return { hasErrors: matches.length > 0, errors: matches };
    }

    return { hasErrors: false, errors: [] };
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  /**
   * 获取页面文本内容
   */
  async getPageText(): Promise<string> {
    if (!this.tabId) return '';

    const result = await this.config.mcpToolCaller.call('get_page_text', {
      tabId: this.tabId,
    });

    return result.content || '';
  }

  /**
   * 执行 JavaScript
   */
  async executeScript(script: string): Promise<{ success: boolean; result?: string; error?: string }> {
    if (!this.tabId) {
      return { success: false, error: 'Browser not open' };
    }

    const result = await this.config.mcpToolCaller.call('javascript_tool', {
      action: 'javascript_exec',
      tabId: this.tabId,
      text: script,
    });

    return {
      success: result.success,
      result: result.content,
      error: result.error,
    };
  }

  /**
   * 读取页面结构（accessibility tree）
   */
  async readPageStructure(filter: 'all' | 'interactive' = 'interactive'): Promise<string> {
    if (!this.tabId) return '';

    const result = await this.config.mcpToolCaller.call('read_page', {
      tabId: this.tabId,
      filter,
    });

    return result.content || '';
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    console.log(`[BrowserTestTools] ${message}`);
    this.emit('log', message);
  }

  /**
   * 获取运行状态
   */
  isAppRunning(): boolean {
    return this.isRunning;
  }

  /**
   * 获取当前 Tab ID
   */
  getTabId(): number | null {
    return this.tabId;
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建浏览器测试工具实例
 */
export function createBrowserTestTools(config: BrowserTestConfig): BrowserTestTools {
  return new BrowserTestTools(config);
}
