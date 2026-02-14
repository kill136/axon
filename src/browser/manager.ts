/**
 * Browser lifecycle manager
 * Singleton pattern for browser instance management
 */

import * as path from 'path';
import * as os from 'os';
import type { BrowserContext, Page } from 'playwright-core';
import type { BrowserStartOptions } from './types.js';
import { detectBrowser } from './detect.js';

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private context: BrowserContext | null = null;
  private currentPage: Page | null = null;
  private _isRunning: boolean = false;
  private profileDir: string;

  private constructor() {
    this.profileDir = path.join(os.homedir(), '.claude', 'browser-data', 'default');
  }

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async start(options?: BrowserStartOptions): Promise<void> {
    if (this._isRunning && this.context) {
      return;
    }

    try {
      const { chromium } = await import('playwright-core');

      let executablePath = options?.executablePath;
      if (!executablePath) {
        const detected = await detectBrowser();
        if (!detected) {
          throw new Error(
            'No browser found. Please install Chrome, Brave, Edge, or Chromium, or specify executablePath in options.'
          );
        }
        executablePath = detected;
      }

      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: options?.headless ?? false,
        executablePath,
        viewport: { width: 1280, height: 720 },
        args: ['--no-first-run', '--no-default-browser-check'],
      });

      const pages = this.context.pages();
      if (pages.length > 0) {
        this.currentPage = pages[0];
      } else {
        this.currentPage = await this.context.newPage();
      }

      this._isRunning = true;

      this.context.on('close', () => {
        this.context = null;
        this.currentPage = null;
        this._isRunning = false;
      });
    } catch (error) {
      this.context = null;
      this.currentPage = null;
      this._isRunning = false;
      throw error;
    }
  }

  async connect(cdpUrl: string): Promise<void> {
    if (this._isRunning && this.context) {
      return;
    }

    try {
      const { chromium } = await import('playwright-core');

      const browser = await chromium.connectOverCDP(cdpUrl);
      this.context = browser.contexts()[0] || (await browser.newContext());

      const pages = this.context.pages();
      if (pages.length > 0) {
        this.currentPage = pages[0];
      } else {
        this.currentPage = await this.context.newPage();
      }

      this._isRunning = true;

      this.context.on('close', () => {
        this.context = null;
        this.currentPage = null;
        this._isRunning = false;
      });
    } catch (error) {
      this.context = null;
      this.currentPage = null;
      this._isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.context) {
      await this.context.close();
    }
    this.context = null;
    this.currentPage = null;
    this._isRunning = false;
  }

  async getPage(): Promise<Page> {
    if (!this.currentPage || !this._isRunning) {
      throw new Error('Browser is not running. Please call start() first.');
    }
    return this.currentPage;
  }

  async getContext(): Promise<BrowserContext> {
    if (!this.context || !this._isRunning) {
      throw new Error('Browser is not running. Please call start() first.');
    }
    return this.context;
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  getProfileDir(): string {
    return this.profileDir;
  }

  setCurrentPage(page: Page): void {
    this.currentPage = page;
  }
}
