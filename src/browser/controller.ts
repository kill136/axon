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
import type { SnapshotResult, TabInfo, CookieOptions, RefEntry } from './types.js';
import { isNavigationAllowed } from './navigation-guard.js';
import { toAIFriendlyError, normalizeTimeoutMs } from './errors.js';
import WebSocket from 'ws';

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
  
  // 页面状态追踪
  private consoleMessages: string[] = [];
  private pageErrors: string[] = [];
  private listenersAttached = false;

  constructor(manager: BrowserManager) {
    this.manager = manager;
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

    this.listenersAttached = true;
  }

  // --- Page Health Check ---

  /**
   * Check if page is responsive
   */
  private async isPageResponsive(timeoutMs: number = 3000): Promise<boolean> {
    try {
      const page = await this.manager.getPage();
      
      // Race a simple evaluation against timeout
      const result = await Promise.race([
        page.evaluate(() => 1 + 1).then(() => true),
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

  async snapshot(options?: { interactive?: boolean }): Promise<SnapshotResult> {
    // Health check: recover from hung page
    const isResponsive = await this.isPageResponsive();
    if (!isResponsive) {
      try {
        await this.terminateExecution();
        // Wait a bit for recovery
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        throw new Error('Page is unresponsive and recovery failed. Please reload the page.');
      }
    }

    const page = await this.manager.getPage();
    
    // 绑定页面事件监听器（如果还没有绑定）
    this.attachPageListeners(page);
    
    this.refsMap.clear();
    this.refCounter = 0;

    const ariaYaml = await page.locator('body').ariaSnapshot({ timeout: 10000 });

    if (!ariaYaml) {
      return {
        title: await page.title(),
        url: page.url(),
        content: 'No accessibility tree available',
        refs: this.refsMap,
      };
    }

    // Parse ariaSnapshot YAML and assign ref IDs
    // Format: "  - role "name" [extra]" or "  - role [extra]"
    const roleNameCount = new Map<string, number>();
    const lines = ariaYaml.split('\n');
    const outputLines: string[] = [];

    for (const line of lines) {
      // Match: indent + "- " + role + optional ' "name"' + optional rest
      const match = line.match(/^(\s*- )(\w+)(?:\s+"([^"]*)")?(.*)$/);

      if (match) {
        const [, prefix, role, name, rest] = match;
        const isInteractive = INTERACTIVE_ROLES.has(role);

        if (options?.interactive && !isInteractive) {
          continue; // Skip non-interactive in interactive mode
        }

        if (name !== undefined) {
          const key = `${role}:${name}`;
          const count = roleNameCount.get(key) || 0;
          roleNameCount.set(key, count + 1);

          this.refCounter++;
          const refId = `e${this.refCounter}`;
          this.refsMap.set(refId, { role, name, nth: count });

          outputLines.push(`${prefix}${role} "${name}" [ref=${refId}]${rest}`);
        } else {
          outputLines.push(line);
        }
      } else {
        if (!options?.interactive) {
          outputLines.push(line);
        }
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
    
    const page = await this.manager.getPage();
    
    // 绑定页面事件监听器（如果还没有绑定）
    this.attachPageListeners(page);
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);
    return this.snapshot();
  }

  async goBack(): Promise<void> {
    const page = await this.manager.getPage();
    await page.goBack({ waitUntil: 'domcontentloaded' });
  }

  async goForward(): Promise<void> {
    const page = await this.manager.getPage();
    await page.goForward({ waitUntil: 'domcontentloaded' });
  }

  async reload(): Promise<void> {
    const page = await this.manager.getPage();
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

    const page = await this.manager.getPage();
    let locator = page.getByRole(entry.role as any, {
      name: entry.name,
      exact: true,
    });

    if (entry.nth > 0) {
      locator = locator.nth(entry.nth);
    }

    return locator;
  }

  // --- Interactions ---

  async click(ref: string): Promise<void> {
    try {
      const locator = await this.resolveLocator(ref);
      await locator.click({ timeout: 5000 });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async fill(ref: string, value: string): Promise<void> {
    try {
      const locator = await this.resolveLocator(ref);
      await locator.fill(value, { timeout: 5000 });
    } catch (error) {
      throw toAIFriendlyError(error);
    }
  }

  async type(text: string): Promise<void> {
    const page = await this.manager.getPage();
    await page.keyboard.type(text);
  }

  async press(key: string): Promise<void> {
    const page = await this.manager.getPage();
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

  // --- Screenshot ---

  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    const page = await this.manager.getPage();
    return await page.screenshot({ fullPage: options?.fullPage ?? false });
  }

  /**
   * Take screenshot with labeled overlays for each ref (Set-of-Mark style)
   */
  async screenshotWithLabels(options?: { fullPage?: boolean }): Promise<{ 
    buffer: Buffer; 
    labelCount: number; 
    skippedCount: number;
  }> {
    const page = await this.manager.getPage();
    const refs = Array.from(this.refsMap.entries());
    
    if (refs.length === 0) {
      const buffer = await page.screenshot({ fullPage: options?.fullPage ?? false });
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
    const buffer = await page.screenshot({ fullPage: options?.fullPage ?? false });

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
    const currentPage = await this.manager.getPage();

    return Promise.all(
      pages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title(),
        active: page === currentPage,
      }))
    );
  }

  async tabNew(url?: string): Promise<void> {
    const browser = this.manager.getBrowser();
    if (!browser) throw new Error('Browser is not running.');

    const context = browser.contexts()[0];
    if (!context) throw new Error('No browser context available.');

    const newPage = await context.newPage();
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
    this.manager.setCurrentPage(page);
    await page.bringToFront();
  }

  async tabClose(index?: number): Promise<void> {
    const pages = this.manager.getAllPages();

    if (index === undefined) {
      const currentPage = await this.manager.getPage();
      await currentPage.close();
      const remaining = this.manager.getAllPages();
      if (remaining.length > 0) {
        this.manager.setCurrentPage(remaining[0]);
      }
    } else {
      if (index < 0 || index >= pages.length) {
        throw new Error(`Invalid tab index ${index}. Valid range: 0-${pages.length - 1}`);
      }
      const pageToClose = pages[index];
      const currentPage = await this.manager.getPage();
      await pageToClose.close();

      if (pageToClose === currentPage) {
        const remaining = this.manager.getAllPages();
        if (remaining.length > 0) {
          this.manager.setCurrentPage(remaining[0]);
        }
      }
    }
  }

  // --- Cookies ---

  async getCookies(domain?: string): Promise<any[]> {
    const page = await this.manager.getPage();
    const cookies = await page.context().cookies();
    if (domain) {
      return cookies.filter(c => c.domain.includes(domain));
    }
    return cookies;
  }

  async setCookie(name: string, value: string, options?: CookieOptions): Promise<void> {
    const page = await this.manager.getPage();
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
    const page = await this.manager.getPage();
    await page.context().clearCookies();
  }

  // --- Evaluate ---

  async evaluate(expression: string, timeoutMs?: number): Promise<any> {
    const page = await this.manager.getPage();
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
}
