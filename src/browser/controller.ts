/**
 * Browser page controller
 *
 * Provides high-level page interaction methods.
 * Uses role-based ref system from ariaSnapshot (like openclaw).
 *
 * Ref resolution: ariaSnapshot YAML → parse role+name → getByRole(role, { name, exact }).nth(n)
 */

import type { Locator, Page } from 'playwright-core';
import type { BrowserManager } from './manager.js';
import type { SnapshotResult, TabInfo, CookieOptions, RefEntry, DownloadInfo, DialogInfo } from './types.js';
import { isNavigationAllowed } from './navigation-guard.js';
import { toAIFriendlyError, normalizeTimeoutMs } from './errors.js';
import WebSocket from 'ws';
import * as path from 'node:path';

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'listbox', 'menuitem', 'tab', 'searchbox', 'slider',
  'spinbutton', 'switch', 'option', 'menuitemcheckbox',
  'menuitemradio', 'treeitem',
]);

export class BrowserController {
  private manager: BrowserManager;
  private refsMap: Map<string, RefEntry> = new Map();
  private refCounter: number = 0;
  private selectedFrameIndex: number = 0; // 0 = main frame, >0 = iframe
  
  // 页面状态追踪
  private consoleMessages: string[] = [];
  private pageErrors: string[] = [];
  private listenersAttached = false;
  
  // Dialog 自动处理
  private lastDialog: DialogInfo | null = null;
  private dialogQueue: DialogInfo[] = [];
  private autoAcceptDialogs: boolean = true; // 默认自动接受弹窗避免卡死
  
  // Download 处理
  private downloads: DownloadInfo[] = [];
  private downloadListenerAttached = false;

  // 会话专属 tab：每个 controller 实例拥有独立的 tab，不与用户冲突
  private dedicatedPage: Page | null = null;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  /**
   * 获取会话专属 tab。
   * 首次调用时创建新 tab（避免多会话抢用同一个 tab），后续复用。
   * 如果专属 tab 已被关闭，自动重新创建。
   */
  private async ensureDedicatedTab(): Promise<Page> {
    // 检查专属 tab 是否仍然可用
    if (this.dedicatedPage && !this.dedicatedPage.isClosed()) {
      return this.dedicatedPage;
    }

    // 旧的 dedicatedPage 已关闭，释放其 claim
    if (this.dedicatedPage) {
      this.manager.releasePage(this.dedicatedPage);
      this.dedicatedPage = null;
    }

    const browser = this.manager.getBrowser();
    if (!browser) {
      throw new Error('Browser is not running.');
    }

    const context = browser.contexts()[0];
    if (!context) {
      throw new Error('No browser context available.');
    }

    let page: Page | undefined;

    // 策略1: 优先复用未被占用的空白页（避免产生多余空 tab）
    const pages = browser.contexts().flatMap(c => c.pages());
    page = pages.find(p => !p.isClosed() && !this.manager.isPageClaimed(p) &&
      (p.url() === 'about:blank' || p.url() === ''));

    // 策略2: 没有空白页，创建新 tab
    let isNewlyCreated = false;
    if (!page) {
      try {
        page = await context.newPage();
        isNewlyCreated = true;
      } catch {
        // 创建失败时回退到策略3
      }
    }

    // 策略3: 回退 — 找一个未被占用的任意 page
    if (!page) {
      page = pages.find(p => !p.isClosed() && !this.manager.isPageClaimed(p));
    }

    if (!page) {
      throw new Error('Cannot create or find an available tab. All tabs are claimed by other sessions.');
    }

    // 新创建的 tab 需要等待 extension auto-attach（extension 有 500ms 延迟）
    // 否则 Playwright 发的 CDP 命令和事件监听无法到达 extension
    if (isNewlyCreated && this.manager.isExtensionConnected()) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    this.dedicatedPage = page;
    this.listenersAttached = false;
    this.manager.claimPage(page);
    this.manager.setCurrentPage(page);
    
    return page;
  }

  /**
   * 获取当前会话应该操作的 page。
   * 如果已有专属 tab 则使用它，否则创建一个。
   */
  private async getSessionPage(): Promise<Page> {
    return this.ensureDedicatedTab();
  }

  /**
   * 获取当前活动的 frame（用于支持 iframe 操作）
   */
  private async getActiveFrame(): Promise<Page> {
    const page = await this.getSessionPage();
    if (this.selectedFrameIndex === 0) {
      return page;
    }
    const frames = page.frames();
    if (this.selectedFrameIndex >= frames.length) {
      throw new Error(`Frame index ${this.selectedFrameIndex} out of bounds (total: ${frames.length})`);
    }
    // 注意：Frame 类型与 Page 类型兼容大部分操作
    return frames[this.selectedFrameIndex] as any as Page;
  }

  /**
   * 获取当前专属 tab 的 Page 引用（只读，不触发创建）
   */
  getDedicatedPage(): Page | null {
    return this.dedicatedPage;
  }

  /**
   * 释放专属 tab 引用（不关闭 tab，用户可能想继续查看）
   */
  releaseDedicatedTab(): void {
    if (this.dedicatedPage) {
      this.manager.releasePage(this.dedicatedPage);
    }
    this.dedicatedPage = null;
    this.listenersAttached = false;
  }

  /**
   * 关闭专属 tab 并释放引用
   */
  async closeDedicatedTab(): Promise<void> {
    if (this.dedicatedPage) {
      this.manager.releasePage(this.dedicatedPage);
      if (!this.dedicatedPage.isClosed()) {
        // Timeout protection: page.close() sends CDP command through relay to
        // extension. If extension is disconnected or page is broken, this hangs.
        const closePromise = this.dedicatedPage.close().catch(() => {});
        const timeoutPromise = new Promise<void>(r => setTimeout(r, 3000));
        await Promise.race([closePromise, timeoutPromise]);
      }
    }
    this.dedicatedPage = null;
    this.listenersAttached = false;
    this.refsMap.clear();
    this.consoleMessages = [];
    this.pageErrors = [];
  }

  /**
   * 绑定页面事件监听器（console 和 pageerror）
   */
  private attachPageListeners(page: Page): void {
    if (this.listenersAttached) return;

    // 监听 console 消息
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      
      // 只记录 error 和 warning
      if (type === 'error' || type === 'warning') {
        const entry = `[${type.toUpperCase()}] ${text}`;
        this.consoleMessages.push(entry);
        
        // 保留最近 50 条
        if (this.consoleMessages.length > 50) {
          this.consoleMessages.shift();
        }
      }
    });

    // 监听页面错误
    page.on('pageerror', (error) => {
      const entry = `${error.message}\n${error.stack || ''}`;
      this.pageErrors.push(entry);
      
      // 保留最近 20 条
      if (this.pageErrors.length > 20) {
        this.pageErrors.shift();
      }
    });

    // 监听 dialog 事件（alert/confirm/prompt/beforeunload）
    page.on('dialog', async (dialog) => {
      const info: DialogInfo = {
        type: dialog.type(),
        message: dialog.message(),
        handled: false,
      };
      this.dialogQueue.push(info);
      this.lastDialog = info;
      
      // 保留最近 10 条
      if (this.dialogQueue.length > 10) {
        this.dialogQueue.shift();
      }
      
      // 自动处理模式：立即接受弹窗避免页面挂死
      if (this.autoAcceptDialogs) {
        try {
          if (dialog.type() === 'prompt') {
            await dialog.accept('');
          } else {
            await dialog.accept();
          }
          info.handled = true;
          info.response = 'auto-accepted';
        } catch {
          // dialog 可能已被处理
        }
      }
    });

    this.listenersAttached = true;
  }

  // --- Page Health Check ---

  /**
   * Check if page is responsive
   */
  private async isPageResponsive(timeoutMs: number = 5000): Promise<boolean> {
    try {
      // 检查专属 tab 是否响应（如果还没有专属 tab，视为响应正常）
      if (!this.dedicatedPage || this.dedicatedPage.isClosed()) {
        return true;
      }
      
      // Race a simple evaluation against timeout
      const result = await Promise.race([
        this.dedicatedPage.evaluate(() => 1 + 1).then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), timeoutMs)),
      ]);
      
      return result;
    } catch {
      return false;
    }
  }

  /**
   * Terminate stuck script execution via CDP
   */
  private async terminateExecution(): Promise<void> {
    const cdpUrl = this.manager.getCdpUrl();
    if (!cdpUrl) {
      throw new Error('CDP URL not available');
    }

    // Get WebSocket URL from CDP endpoint
    const versionUrl = `${cdpUrl}/json/version`;
    const versionResp = await fetch(versionUrl).catch(() => null);
    if (!versionResp || !versionResp.ok) {
      throw new Error('Failed to fetch CDP version endpoint');
    }

    const versionData = await versionResp.json();
    const wsUrl = versionData.webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new Error('No WebSocket debugger URL available');
    }

    // Connect to CDP and send Runtime.terminateExecution
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Timeout waiting for CDP connection'));
      }, 5000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.terminateExecution',
        }));
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === 1) {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch {
          // Ignore parse errors
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // --- Snapshot ---

  async snapshot(options?: { interactive?: boolean; skipHealthCheck?: boolean }): Promise<SnapshotResult> {
    // Health check: recover from hung page (skip when caller already verified, e.g. after goto)
    const isResponsive = options?.skipHealthCheck ? true : await this.isPageResponsive();
    if (!isResponsive) {
      try {
        await this.terminateExecution();
        // Wait a bit for recovery
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch {
        // Recovery failed, but don't give up — let ariaSnapshot below
        // determine if the page is truly unusable.
      }
    }

    const page = await this.getSessionPage();
    
    // 绑定页面事件监听器（如果还没有绑定）
    this.attachPageListeners(page);
    
    // 当选中了 frame 时，只对该 frame 做 snapshot
    const targetFrame = this.selectedFrameIndex > 0 
      ? page.frames()[this.selectedFrameIndex] 
      : null;
    
    this.refsMap.clear();
    this.refCounter = 0;

    // Parse ariaSnapshot YAML for a single frame, assigning ref IDs
    const roleNameCount = new Map<string, number>();
    const parseAriaYaml = (ariaYaml: string, frameIndex: number, interactive?: boolean): string[] => {
      const lines = ariaYaml.split('\n');
      const outputLines: string[] = [];
      for (const line of lines) {
        const match = line.match(/^(\s*- )(\w+)(?:\s+"([^"]*)")?(.*)$/);
        if (match) {
          const [, prefix, role, name, rest] = match;
          const isInteractive = INTERACTIVE_ROLES.has(role);
          if (interactive && !isInteractive) continue;
          if (name !== undefined) {
            const key = `${frameIndex}:${role}:${name}`;
            const count = roleNameCount.get(key) || 0;
            roleNameCount.set(key, count + 1);
            this.refCounter++;
            const refId = `e${this.refCounter}`;
            this.refsMap.set(refId, { role, name, nth: count, frameIndex });
            outputLines.push(`${prefix}${role} "${name}" [ref=${refId}]${rest}`);
          } else {
            outputLines.push(line);
          }
        } else {
          if (!interactive) outputLines.push(line);
        }
      }
      return outputLines;
    };

    // 如果选中了特定 frame，只扫描该 frame
    let outputLines: string[];
    if (targetFrame) {
      const frameAriaYaml = await targetFrame.locator('body').ariaSnapshot({ timeout: 10000 });
      if (!frameAriaYaml) {
        return {
          title: await page.title(),
          url: targetFrame.url(),
          content: 'No accessibility tree available in selected frame',
          refs: this.refsMap,
        };
      }
      outputLines = parseAriaYaml(frameAriaYaml, this.selectedFrameIndex, options?.interactive);
    } else {
      // --- Main frame ---
      const mainAriaYaml = await page.locator('body').ariaSnapshot({ timeout: 10000 });
      if (!mainAriaYaml) {
        return {
          title: await page.title(),
          url: page.url(),
          content: 'No accessibility tree available',
          refs: this.refsMap,
        };
      }
      outputLines = parseAriaYaml(mainAriaYaml, 0, options?.interactive);

      // --- Iframes (cross-origin included) ---
      const frames = page.frames();
      for (let i = 1; i < frames.length; i++) {
        try {
          const frame = frames[i];
          const frameUrl = frame.url();
          // Skip blank/about frames
          if (!frameUrl || frameUrl === 'about:blank' || frameUrl === 'about:srcdoc') continue;
          const frameAriaYaml = await frame.locator('body').ariaSnapshot({ timeout: 3000 });
          if (frameAriaYaml) {
            // Extract domain for labeling
            let frameDomain = '';
            try { frameDomain = new URL(frameUrl).hostname; } catch {}
            outputLines.push('');
            outputLines.push(`=== iframe [${frameDomain || frameUrl}] ===`);
            outputLines.push(...parseAriaYaml(frameAriaYaml, i, options?.interactive));
          }
        } catch {
          // Skip frames that are not accessible (detached, navigating, etc.)
        }
      }
    }

    // 在 interactive 模式下，扫描 cursor:pointer 的 clickable 元素
    if (options?.interactive) {
      try {
        const activeFrame = targetFrame || page;
        // @ts-ignore - runs in browser context, DOM APIs not available in Node types
        const clickableElements: Array<{ text: string; tag: string; selector: string }> = await activeFrame.evaluate(() => {
          const elements: any[] = [];
          const standardTags = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA']);
          
          const allElements = (globalThis as any).document.querySelectorAll('*');
          let idx = 0;
          allElements.forEach((el: any) => {
            idx++;
            // 跳过标准交互元素
            if (standardTags.has(el.tagName)) return;
            
            // 检查 cursor:pointer
            const computedStyle = (globalThis as any).getComputedStyle(el);
            if (computedStyle.cursor !== 'pointer') return;
            
            // 检查可见性和尺寸
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 10) return;
            if (rect.top > (globalThis as any).innerHeight || rect.bottom < 0) return;
            
            // 获取文本内容
            let text = el.innerText || el.textContent || '';
            text = text.trim().slice(0, 50); // 限制长度
            if (!text) return;
            
            // 生成唯一的 selector
            const selector = `${el.tagName.toLowerCase()}:nth-of-type(${idx})`;
            
            elements.push({ text, tag: el.tagName, selector });
          });
          
          return elements;
        });
        
        if (clickableElements.length > 0) {
          outputLines.push('');
          outputLines.push('=== Clickable Elements ===');
          for (const el of clickableElements) {
            this.refCounter++;
            const refId = `e${this.refCounter}`;
            const frameIndex = targetFrame ? this.selectedFrameIndex : 0;
            this.refsMap.set(refId, {
              role: 'clickable',
              name: el.text,
              nth: 0,
              frameIndex,
              selector: el.selector,
            });
            outputLines.push(`- ${el.tag.toLowerCase()} "${el.text}" [ref=${refId}]`);
          }
        }
      } catch (error) {
        // 扫描失败不影响主流程
      }
    }
    
    // 追加页面错误和 console 信息（如果有的话）
    let finalContent = outputLines.join('\n');
    
    if (this.pageErrors.length > 0) {
      finalContent += '\n\n=== Page Errors ===\n';
      finalContent += this.pageErrors.slice(-5).join('\n---\n'); // 最近 5 条
    }
    
    if (this.consoleMessages.length > 0) {
      const errorMessages = this.consoleMessages.filter(msg => msg.startsWith('[ERROR]'));
      if (errorMessages.length > 0) {
        finalContent += '\n\n=== Console Errors ===\n';
        finalContent += errorMessages.slice(-5).join('\n'); // 最近 5 条
      }
    }

    return {
      title: await page.title(),
      url: page.url(),
      content: finalContent,
      refs: this.refsMap,
    };
  }

  // --- Navigation ---

  async goto(url: string): Promise<SnapshotResult> {
    // Health check: recover from hung page before navigation
    const isResponsive = await this.isPageResponsive();
    if (!isResponsive) {
      try {
        await this.terminateExecution();
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        // Continue with navigation even if recovery fails
      }
    }

    // 导航守卫检查（SSRF 防护）
    const guardResult = isNavigationAllowed(url);
    if (!guardResult.allowed) {
      throw new Error(`Navigation blocked: ${guardResult.reason}`);
    }
    
    const page = await this.getSessionPage();
    
    // 绑定页面事件监听器（如果还没有绑定）
    this.attachPageListeners(page);
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);
    return this.snapshot({ skipHealthCheck: true });
  }

  async goBack(): Promise<void> {
    const page = await this.getSessionPage();
    await page.goBack({ waitUntil: 'domcontentloaded' });
  }

  async goForward(): Promise<void> {
    const page = await this.getSessionPage();
    await page.goForward({ waitUntil: 'domcontentloaded' });
  }

  async reload(): Promise<void> {
    const page = await this.getSessionPage();
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  // --- Ref resolution ---

  private async resolveLocator(ref: string): Promise<Locator> {
    const entry = this.refsMap.get(ref);
    if (!entry) {
      throw new Error(
        `Unknown ref "${ref}". Run a new snapshot and use a ref from that snapshot.`
      );
    }

    const page = await this.getSessionPage();

    // Resolve the correct frame (main frame or iframe)
    let owner: Page | import('playwright-core').Frame = page;
    if (entry.frameIndex && entry.frameIndex > 0) {
      const frames = page.frames();
      if (entry.frameIndex < frames.length) {
        owner = frames[entry.frameIndex];
      }
    }

    // 如果有 selector，使用 selector 定位（用于非标准 clickable 元素）
    if (entry.selector) {
      return owner.locator(entry.selector);
    }

    // 否则使用 role-based 定位
    let locator = owner.getByRole(entry.role as any, {
      name: entry.name,
      exact: true,
    });

    if (entry.nth > 0) {
      locator = locator.nth(entry.nth);
    }

    return locator;
  }

  // --- Interactions ---

  async click(ref?: string, options?: { x?: number; y?: number }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      
      // 坐标模式：直接点击指定坐标
      if (!ref && options?.x !== undefined && options?.y !== undefined) {
        await page.mouse.click(options.x, options.y, {
          delay: 50,
        });
        return;
      }
      
      // ref 模式：使用 locator 点击
      if (ref) {
        const locator = await this.resolveLocator(ref);
        await locator.click({ timeout: 5000 });
        return;
      }
      
      throw new Error('Either ref or x/y coordinates must be provided for click');
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async fill(ref?: string, value?: string, options?: { x?: number; y?: number }): Promise<void> {
    try {
      if (!value) {
        throw new Error('value is required for fill');
      }
      
      const page = await this.getSessionPage();
      
      // 坐标模式：先点击聚焦，然后输入
      if (!ref && options?.x !== undefined && options?.y !== undefined) {
        await page.mouse.click(options.x, options.y);
        await page.waitForTimeout(100); // 等待聚焦
        await page.keyboard.type(value);
        return;
      }
      
      // ref 模式：使用 locator fill
      if (ref) {
        const locator = await this.resolveLocator(ref);
        await locator.fill(value, { timeout: 5000 });
        return;
      }
      
      throw new Error('Either ref or x/y coordinates must be provided for fill');
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async type(text: string): Promise<void> {
    const page = await this.getSessionPage();
    await page.keyboard.type(text);
  }

  async press(key: string): Promise<void> {
    const page = await this.getSessionPage();
    await page.keyboard.press(key);
  }

  async hover(ref: string): Promise<void> {
    try {
      const locator = await this.resolveLocator(ref);
      await locator.hover({ timeout: 5000 });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async select(ref: string, values: string[]): Promise<void> {
    try {
      const locator = await this.resolveLocator(ref);
      await locator.selectOption(values, { timeout: 5000 });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  // --- Enhanced Interactions ---

  async dblclick(ref?: string, options?: { x?: number; y?: number }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      
      // 坐标模式：直接双击指定坐标
      if (!ref && options?.x !== undefined && options?.y !== undefined) {
        await page.mouse.dblclick(options.x, options.y, {
          delay: 50,
        });
        return;
      }
      
      // ref 模式：使用 locator 双击
      if (ref) {
        const locator = await this.resolveLocator(ref);
        await locator.dblclick({ timeout: 5000 });
        return;
      }
      
      throw new Error('Either ref or x/y coordinates must be provided for dblclick');
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async rightclick(ref?: string, options?: { x?: number; y?: number }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      
      // 坐标模式：直接右击指定坐标
      if (!ref && options?.x !== undefined && options?.y !== undefined) {
        await page.mouse.click(options.x, options.y, {
          button: 'right',
          delay: 50,
        });
        return;
      }
      
      // ref 模式：使用 locator 右击
      if (ref) {
        const locator = await this.resolveLocator(ref);
        await locator.click({ button: 'right', timeout: 5000 });
        return;
      }
      
      throw new Error('Either ref or x/y coordinates must be provided for rightclick');
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async dragAndDrop(sourceRef: string, targetRef: string): Promise<void> {
    try {
      const source = await this.resolveLocator(sourceRef);
      const target = await this.resolveLocator(targetRef);
      await source.dragTo(target, { timeout: 10000 });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async scroll(options: { ref?: string; deltaX?: number; deltaY?: number }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      if (options.ref) {
        // 先滚动到指定元素可见
        const locator = await this.resolveLocator(options.ref);
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 });
      } else {
        // 滚动页面（使用 mouse.wheel）
        const dx = options.deltaX ?? 0;
        const dy = options.deltaY ?? 300; // 默认向下滚动 300px
        await page.mouse.wheel(dx, dy);
      }
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  // --- Wait mechanisms ---

  async waitForSelector(selector: string, options?: { timeout?: number; state?: 'attached' | 'detached' | 'visible' | 'hidden' }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      await page.waitForSelector(selector, {
        timeout: options?.timeout ?? 10000,
        state: options?.state ?? 'visible',
      });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async waitForUrl(urlPattern: string, options?: { timeout?: number }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      // 支持字符串匹配和正则
      await page.waitForURL(urlPattern, {
        timeout: options?.timeout ?? 30000,
      });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle', options?: { timeout?: number }): Promise<void> {
    try {
      const page = await this.getSessionPage();
      await page.waitForLoadState(state, {
        timeout: options?.timeout ?? 30000,
      });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async waitForTimeout(ms: number): Promise<void> {
    const page = await this.getSessionPage();
    await page.waitForTimeout(Math.min(ms, 30000)); // 最多 30s
  }

  /**
   * Wait for DOM to become stable (no mutations for stableMs milliseconds)
   */
  async waitForStable(options?: { timeout?: number; stableMs?: number }): Promise<void> {
    const page = await this.getActiveFrame();
    const timeout = options?.timeout ?? 10000;
    const stableMs = options?.stableMs ?? 500;
    
    try {
      // @ts-ignore - runs in browser context, MutationObserver/document not available in Node types
      await page.evaluate(
        ({ timeoutMs, stableMsParam }: { timeoutMs: number; stableMsParam: number }) => {
          return new Promise<void>((resolve) => {
            let timer: any = setTimeout(() => resolve(), stableMsParam);
            
            const observer = new (globalThis as any).MutationObserver(() => {
              clearTimeout(timer);
              timer = setTimeout(() => {
                if (observer) {
                  observer.disconnect();
                }
                resolve();
              }, stableMsParam);
            });
            
            observer.observe((globalThis as any).document.body, {
              childList: true,
              subtree: true,
              attributes: true,
            });
            
            // 超时后停止观察并 resolve
            setTimeout(() => {
              if (observer) {
                observer.disconnect();
              }
              resolve();
            }, timeoutMs);
          });
        },
        { timeoutMs: timeout, stableMsParam: stableMs }
      );
    } catch (error) {
      // 超时或其他错误，不抛出，因为这只是一个等待操作
    }
  }

  // --- Mouse precise operations ---

  async mouseMove(x: number, y: number): Promise<void> {
    const page = await this.getSessionPage();
    await page.mouse.move(x, y);
  }

  async mouseDown(options?: { button?: 'left' | 'middle' | 'right' }): Promise<void> {
    const page = await this.getSessionPage();
    await page.mouse.down({ button: options?.button ?? 'left' });
  }

  async mouseUp(options?: { button?: 'left' | 'middle' | 'right' }): Promise<void> {
    const page = await this.getSessionPage();
    await page.mouse.up({ button: options?.button ?? 'left' });
  }

  async mouseWheel(deltaX: number, deltaY: number): Promise<void> {
    const page = await this.getSessionPage();
    await page.mouse.wheel(deltaX, deltaY);
  }

  // --- File Upload ---

  async uploadFile(ref: string | undefined, filePath: string): Promise<void> {
    try {
      const page = await this.getSessionPage();

      if (ref) {
        // Explicit ref: use it directly (original path)
        const locator = await this.resolveLocator(ref);
        await locator.setInputFiles(filePath, { timeout: 10000 });
      } else {
        // No ref: auto-detect <input type="file"> on the page.
        // Most sites hide file inputs and create them dynamically on button click,
        // so they never appear in the accessibility snapshot / refsMap.
        // Strategy: find all file inputs, prefer the last one (most recently added).
        const fileInputs = page.locator('input[type="file"]');
        const count = await fileInputs.count();
        if (count === 0) {
          throw new Error(
            'No <input type="file"> found on the page. ' +
            'Click the upload button first to trigger the file input, then call upload_file again.'
          );
        }
        const target = fileInputs.nth(count - 1); // last = most recently created
        await target.setInputFiles(filePath, { timeout: 10000 });
      }
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  // --- Screenshot ---

  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    const page = await this.getSessionPage();
    return await page.screenshot({ 
      fullPage: options?.fullPage ?? false,
      scale: 'css',
      timeout: 30000,
    });
  }

  /**
   * Take screenshot with labeled overlays for each ref (Set-of-Mark style)
   */
  async screenshotWithLabels(options?: { fullPage?: boolean }): Promise<{ 
    buffer: Buffer; 
    labelCount: number; 
    skippedCount: number;
  }> {
    const page = await this.getSessionPage();
    const refs = Array.from(this.refsMap.entries());
    
    if (refs.length === 0) {
      const buffer = await page.screenshot({ 
        fullPage: options?.fullPage ?? false,
        scale: 'css',
        timeout: 15000,
      });
      return { buffer, labelCount: 0, skippedCount: 0 };
    }

    let labelCount = 0;
    let skippedCount = 0;

    // Inject DOM overlays for each ref
    const labelData: Array<{ ref: string; box: { x: number; y: number; width: number; height: number } }> = [];

    for (const [refId, entry] of refs) {
      try {
        const locator = await this.resolveLocator(refId);
        const box = await locator.boundingBox({ timeout: 1000 });
        
        if (!box) {
          skippedCount++;
          continue;
        }

        // Check if element is in viewport
        const viewport = page.viewportSize();
        if (viewport) {
          if (box.x + box.width < 0 || box.y + box.height < 0 || 
              box.x > viewport.width || box.y > viewport.height) {
            skippedCount++;
            continue;
          }
        }

        labelData.push({ ref: refId, box });
      } catch {
        skippedCount++;
      }
    }

    // Inject visual overlays
    // @ts-ignore - This code runs in browser context
    await page.evaluate((labels: any) => {
      // @ts-ignore
      const container = document.createElement('div');
      container.setAttribute('data-claude-labels', 'true');
      container.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483647;';
      
      labels.forEach(({ ref, box }: any) => {
        // Border
        // @ts-ignore
        const border = document.createElement('div');
        border.style.cssText = `
          position: absolute;
          left: ${box.x}px;
          top: ${box.y}px;
          width: ${box.width}px;
          height: ${box.height}px;
          border: 2px solid #ffb020;
          box-sizing: border-box;
        `;
        container.appendChild(border);

        // Label
        // @ts-ignore
        const label = document.createElement('div');
        label.style.cssText = `
          position: absolute;
          left: ${box.x}px;
          top: ${box.y - 20}px;
          background: #ffb020;
          color: #1a1a1a;
          font: 12px monospace;
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
        `;
        label.textContent = ref;
        container.appendChild(label);
      });

      // @ts-ignore
      document.body.appendChild(container);
    }, labelData);

    labelCount = labelData.length;

    // Take screenshot
    const buffer = await page.screenshot({ 
      fullPage: options?.fullPage ?? false,
      scale: 'css',
      timeout: 15000,
    });

    // Remove overlays
    // @ts-ignore - This code runs in browser context
    await page.evaluate(() => {
      // @ts-ignore
      const overlay = document.querySelector('[data-claude-labels]');
      if (overlay) {
        overlay.remove();
      }
    });

    return { buffer, labelCount, skippedCount };
  }

  // --- Tab management ---

  async tabList(): Promise<TabInfo[]> {
    const pages = this.manager.getAllPages();
    const sessionPage = this.dedicatedPage;

    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title(),
        active: page === sessionPage,
      }))
    );
  }

  /**
   * List all frames (including iframes) in the current page
   */
  async frameList(): Promise<Array<{ index: number; url: string; name: string; parentFrame: number | null }>> {
    const page = await this.getSessionPage();
    const frames = page.frames();
    
    return frames.map((frame, index) => {
      const parentFrame = frame.parentFrame();
      const parentIndex = parentFrame ? frames.indexOf(parentFrame) : null;
      
      return {
        index,
        url: frame.url(),
        name: frame.name(),
        parentFrame: parentIndex,
      };
    });
  }

  /**
   * Select a frame to operate on (0 = main frame, >0 = iframe)
   */
  frameSelect(frameIndex: number): void {
    this.selectedFrameIndex = frameIndex;
  }

  async tabNew(url?: string): Promise<void> {
    const browser = this.manager.getBrowser();
    if (!browser) throw new Error('Browser is not running.');

    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context available.');

    // 释放旧的专属 tab claim
    if (this.dedicatedPage) {
      this.manager.releasePage(this.dedicatedPage);
    }

    const newPage = await context.newPage();

    // 等待 extension auto-attach 新 tab（extension 有 500ms 延迟）
    if (this.manager.isExtensionConnected()) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    // 新建的 tab 成为新的专属 tab
    this.dedicatedPage = newPage;
    this.listenersAttached = false;
    this.manager.claimPage(newPage);
    this.manager.setCurrentPage(newPage);

    if (url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  }

  async tabSelect(index: number): Promise<void> {
    const pages = this.manager.getAllPages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Invalid tab index ${index}. Valid range: 0-${pages.length - 1}`);
    }

    const page = pages[index];

    // 释放旧的专属 tab claim
    if (this.dedicatedPage && this.dedicatedPage !== page) {
      this.manager.releasePage(this.dedicatedPage);
    }

    // 切换专属 tab 到选中的 tab
    this.dedicatedPage = page;
    this.listenersAttached = false;
    this.manager.claimPage(page);
    this.manager.setCurrentPage(page);
    await page.bringToFront();
  }

  async tabClose(index?: number): Promise<void> {
    const pages = this.manager.getAllPages();
    const sessionPage = this.dedicatedPage;

    if (index === undefined) {
      // 关闭当前专属 tab
      if (sessionPage) {
        this.manager.releasePage(sessionPage);
        if (!sessionPage.isClosed()) {
          await sessionPage.close();
        }
      }
      this.dedicatedPage = null;
      this.listenersAttached = false;
      const remaining = this.manager.getAllPages();
      if (remaining.length > 0) {
        this.manager.setCurrentPage(remaining[0]);
      }
    } else {
      if (index < 0 || index >= pages.length) {
        throw new Error(`Invalid tab index ${index}. Valid range: 0-${pages.length - 1}`);
      }
      const pageToClose = pages[index];
      this.manager.releasePage(pageToClose);
      await pageToClose.close();

      // 如果关闭的是专属 tab，清理引用
      if (pageToClose === sessionPage) {
        this.dedicatedPage = null;
        this.listenersAttached = false;
        const remaining = this.manager.getAllPages();
        if (remaining.length > 0) {
          this.manager.setCurrentPage(remaining[0]);
        }
      }
    }
  }

  // --- Cookies ---

  async getCookies(domain?: string): Promise<any[]> {
    const page = await this.getSessionPage();
    const cookies = await page.context().cookies();
    if (domain) {
      return cookies.filter(c => c.domain.includes(domain));
    }
    return cookies;
  }

  async setCookie(name: string, value: string, options?: CookieOptions): Promise<void> {
    const page = await this.getSessionPage();
    await page.context().addCookies([{
      name,
      value,
      domain: options?.domain,
      path: options?.path ?? '/',
      httpOnly: options?.httpOnly,
      secure: options?.secure,
      expires: options?.expires,
      url: page.url(),
    }]);
  }

  async clearCookies(): Promise<void> {
    const page = await this.getSessionPage();
    await page.context().clearCookies();
  }

  // --- Evaluate ---

  async evaluate(expression: string, timeoutMs?: number): Promise<any> {
    const page = await this.getActiveFrame();
    const timeout = normalizeTimeoutMs(timeoutMs);
    
    try {
      // Node-side Promise.race: if evaluate exceeds timeout, we terminate it
      // via CDP Runtime.terminateExecution and reject with a clear error.
      // This is the only reliable way to enforce timeouts because:
      // - Playwright's evaluate { timeout } only controls function installation, not execution
      // - Browser-side setTimeout can't interrupt synchronous code
      // - new Function gets serialized by Playwright, losing our wrapper
      const evalPromise = page.evaluate(expression);
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(async () => {
          // Attempt to terminate the running JS in the page
          try {
            await this.terminateExecution();
          } catch {
            // Best effort - page may recover on its own
          }
          reject(new Error(`evaluate timed out after ${timeout}ms. The expression took too long to complete.`));
        }, timeout);
      });

      const result = await Promise.race([evalPromise, timeoutPromise]);
      return result;
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  // --- Console Log ---

  /**
   * 获取最近的 console 消息和页面错误
   */
  getConsoleLog(): { consoleMessages: string[]; pageErrors: string[] } {
    return {
      consoleMessages: [...this.consoleMessages],
      pageErrors: [...this.pageErrors],
    };
  }

  // --- Dialog Handling ---

  async handleDialog(action: 'accept' | 'dismiss', text?: string): Promise<DialogInfo | null> {
    // 临时禁用自动处理，等待下一个弹窗
    // 此方法用于 AI 主动控制弹窗行为
    const info = this.lastDialog;
    if (!info) {
      return null;
    }
    // 返回最后一个弹窗的信息
    return info;
  }

  getDialogHistory(): DialogInfo[] {
    return [...this.dialogQueue];
  }

  setAutoAcceptDialogs(enabled: boolean): void {
    this.autoAcceptDialogs = enabled;
  }

  // --- Download Handling ---

  async setupDownloadListener(savePath?: string): Promise<void> {
    if (this.downloadListenerAttached) return;
    
    const page = await this.getSessionPage();
    
    page.on('download', async (download) => {
      const info: DownloadInfo = {
        suggestedFilename: download.suggestedFilename(),
        url: download.url(),
      };
      
      try {
        if (savePath) {
          const fullPath = savePath.endsWith(download.suggestedFilename())
            ? savePath
            : path.join(savePath, download.suggestedFilename());
          await download.saveAs(fullPath);
          info.savedPath = fullPath;
        } else {
          // 保存到默认下载路径
          const downloadPath = await download.path();
          info.savedPath = downloadPath || undefined;
        }
      } catch (err: any) {
        info.savedPath = `FAILED: ${err.message}`;
      }
      
      this.downloads.push(info);
      if (this.downloads.length > 50) {
        this.downloads.shift();
      }
    });
    
    this.downloadListenerAttached = true;
  }

  getDownloads(): DownloadInfo[] {
    return [...this.downloads];
  }

  // --- Viewport ---

  async setViewport(width: number, height: number): Promise<void> {
    const page = await this.getSessionPage();
    await page.setViewportSize({ width, height });
  }

  // --- Storage (localStorage / sessionStorage) ---

  async storageGet(type: 'local' | 'session', key?: string): Promise<any> {
    const page = await this.getSessionPage();
    const storageType = type === 'local' ? 'localStorage' : 'sessionStorage';
    if (key) {
      // @ts-ignore - runs in browser context
      return await page.evaluate(([st, k]) => {
        return (globalThis as any)[st].getItem(k);
      }, [storageType, key] as const);
    } else {
      // @ts-ignore - runs in browser context
      return await page.evaluate((st) => {
        const storage = (globalThis as any)[st];
        const result: Record<string, string> = {};
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k) result[k] = storage.getItem(k);
        }
        return result;
      }, storageType);
    }
  }

  async storageSet(type: 'local' | 'session', key: string, value: string): Promise<void> {
    const page = await this.getSessionPage();
    const storageType = type === 'local' ? 'localStorage' : 'sessionStorage';
    // @ts-ignore - runs in browser context
    await page.evaluate(([st, k, v]) => {
      (globalThis as any)[st].setItem(k, v);
    }, [storageType, key, value] as const);
  }

  async storageClear(type: 'local' | 'session'): Promise<void> {
    const page = await this.getSessionPage();
    const storageType = type === 'local' ? 'localStorage' : 'sessionStorage';
    // @ts-ignore - runs in browser context
    await page.evaluate((st) => {
      (globalThis as any)[st].clear();
    }, storageType);
  }

  // --- PDF ---

  async generatePdf(savePath: string): Promise<string> {
    try {
      const page = await this.getSessionPage();
      await page.pdf({ path: savePath });
      return savePath;
    } catch (error: any) {
      if (error.message?.includes('pdf') || error.message?.includes('headless')) {
        throw new Error('PDF generation requires headless mode. Current browser is running in headed mode.');
      }
      throw toAIFriendlyError(error);
    }
  }

  // --- Network Interception ---

  private activeRoutes: Map<string, () => Promise<void>> = new Map();

  async networkIntercept(pattern: string, action: 'block' | 'continue' | 'fulfill', options?: { body?: string; status?: number }): Promise<void> {
    const page = await this.getSessionPage();
    
    // 移除已有的同 pattern 路由
    if (this.activeRoutes.has(pattern)) {
      await this.activeRoutes.get(pattern)!();
      this.activeRoutes.delete(pattern);
    }
    
    await page.route(pattern, async (route) => {
      switch (action) {
        case 'block':
          await route.abort();
          break;
        case 'continue':
          await route.continue();
          break;
        case 'fulfill':
          await route.fulfill({
            status: options?.status ?? 200,
            body: options?.body ?? '',
          });
          break;
      }
    });
    
    // 记录卸载函数
    this.activeRoutes.set(pattern, async () => {
      await page.unroute(pattern);
    });
  }

  async networkAbort(pattern: string): Promise<void> {
    if (this.activeRoutes.has(pattern)) {
      await this.activeRoutes.get(pattern)!();
      this.activeRoutes.delete(pattern);
    }
  }
}
