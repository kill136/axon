/**
 * Browser page controller
 * Provides high-level page control and interaction methods
 */

import type { Locator } from 'playwright-core';
import type { BrowserManager } from './manager.js';
import type { SnapshotResult, TabInfo, CookieOptions } from './types.js';

export class BrowserController {
  private manager: BrowserManager;
  private refsMap: Map<string, Locator> = new Map();
  private refCounter: number = 0;

  constructor(manager: BrowserManager) {
    this.manager = manager;
  }

  async snapshot(options?: { interactive?: boolean }): Promise<SnapshotResult> {
    const page = await this.manager.getPage();
    this.refsMap.clear();
    this.refCounter = 0;

    const tree = await page.accessibility.snapshot({ interestingOnly: true });
    if (!tree) {
      return {
        title: await page.title(),
        url: page.url(),
        content: 'No accessibility tree available',
        refs: this.refsMap,
      };
    }

    const interactiveRoles = new Set([
      'button',
      'link',
      'textbox',
      'checkbox',
      'radio',
      'combobox',
      'listbox',
      'menuitem',
      'tab',
      'searchbox',
      'slider',
      'spinbutton',
      'switch',
    ]);

    const formatNode = (node: any, depth: number): string => {
      const shouldInclude = !options?.interactive || interactiveRoles.has(node.role);

      if (!shouldInclude) {
        const childrenText = node.children
          ? node.children.map((child: any) => formatNode(child, depth)).filter(Boolean).join('\n')
          : '';
        return childrenText;
      }

      const indent = '  '.repeat(depth);
      let refId = '';

      if (node.role && node.name) {
        this.refCounter++;
        refId = `e${this.refCounter}`;

        try {
          const locator = page.getByRole(node.role as any, { name: node.name });
          this.refsMap.set(refId, locator);
        } catch {
          // Fallback: try to create a locator by text
          try {
            const locator = page.getByText(node.name, { exact: true });
            this.refsMap.set(refId, locator);
          } catch {
            // If all fails, skip ref
            refId = '';
            this.refCounter--;
          }
        }
      }

      const parts: string[] = [];
      parts.push(`${indent}- ${node.role}`);

      if (node.name) {
        parts.push(`"${node.name}"`);
      }

      if (refId) {
        parts.push(`[ref=${refId}]`);
      }

      if (node.value) {
        parts.push(`value="${node.value}"`);
      }

      if (node.description) {
        parts.push(`description="${node.description}"`);
      }

      if (node.checked !== undefined) {
        parts.push(`checked=${node.checked}`);
      }

      if (node.selected !== undefined) {
        parts.push(`selected=${node.selected}`);
      }

      let result = parts.join(' ');

      if (node.children && node.children.length > 0) {
        const childrenText = node.children
          .map((child: any) => formatNode(child, depth + 1))
          .filter(Boolean)
          .join('\n');
        if (childrenText) {
          result += '\n' + childrenText;
        }
      }

      return result;
    };

    const content = formatNode(tree, 0);

    return {
      title: await page.title(),
      url: page.url(),
      content,
      refs: this.refsMap,
    };
  }

  async goto(url: string): Promise<SnapshotResult> {
    const page = await this.manager.getPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
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

  private resolveRef(ref: string): Locator {
    const locator = this.refsMap.get(ref);
    if (!locator) {
      throw new Error(
        `Invalid ref "${ref}". Please run snapshot action first to get valid refs.`
      );
    }
    return locator;
  }

  async click(ref: string): Promise<void> {
    const locator = this.resolveRef(ref);
    await locator.click();
  }

  async fill(ref: string, value: string): Promise<void> {
    const locator = this.resolveRef(ref);
    await locator.fill(value);
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
    const locator = this.resolveRef(ref);
    await locator.hover();
  }

  async select(ref: string, values: string[]): Promise<void> {
    const locator = this.resolveRef(ref);
    await locator.selectOption(values);
  }

  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    const page = await this.manager.getPage();
    return await page.screenshot({ fullPage: options?.fullPage ?? false });
  }

  async tabList(): Promise<TabInfo[]> {
    const context = await this.manager.getContext();
    const currentPage = await this.manager.getPage();
    const pages = context.pages();

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
    const context = await this.manager.getContext();
    const newPage = await context.newPage();
    this.manager.setCurrentPage(newPage);

    if (url) {
      await newPage.goto(url, { waitUntil: 'domcontentloaded' });
    }
  }

  async tabSelect(index: number): Promise<void> {
    const context = await this.manager.getContext();
    const pages = context.pages();

    if (index < 0 || index >= pages.length) {
      throw new Error(`Invalid tab index ${index}. Valid range: 0-${pages.length - 1}`);
    }

    const page = pages[index];
    this.manager.setCurrentPage(page);
    await page.bringToFront();
  }

  async tabClose(index?: number): Promise<void> {
    const context = await this.manager.getContext();
    const pages = context.pages();

    if (index === undefined) {
      const currentPage = await this.manager.getPage();
      await currentPage.close();

      if (pages.length > 1) {
        const remainingPages = context.pages();
        this.manager.setCurrentPage(remainingPages[0]);
      }
    } else {
      if (index < 0 || index >= pages.length) {
        throw new Error(`Invalid tab index ${index}. Valid range: 0-${pages.length - 1}`);
      }

      const pageToClose = pages[index];
      const currentPage = await this.manager.getPage();
      await pageToClose.close();

      if (pageToClose === currentPage) {
        const remainingPages = context.pages();
        if (remainingPages.length > 0) {
          this.manager.setCurrentPage(remainingPages[0]);
        }
      }
    }
  }

  async getCookies(domain?: string): Promise<any[]> {
    const context = await this.manager.getContext();
    const cookies = await context.cookies();

    if (domain) {
      return cookies.filter((cookie) => cookie.domain.includes(domain));
    }

    return cookies;
  }

  async setCookie(name: string, value: string, options?: CookieOptions): Promise<void> {
    const context = await this.manager.getContext();
    const page = await this.manager.getPage();
    const url = page.url();

    await context.addCookies([
      {
        name,
        value,
        domain: options?.domain,
        path: options?.path ?? '/',
        httpOnly: options?.httpOnly,
        secure: options?.secure,
        expires: options?.expires,
        url,
      },
    ]);
  }

  async clearCookies(): Promise<void> {
    const context = await this.manager.getContext();
    await context.clearCookies();
  }

  async evaluate(expression: string): Promise<any> {
    const page = await this.manager.getPage();
    return await page.evaluate(expression);
  }
}
