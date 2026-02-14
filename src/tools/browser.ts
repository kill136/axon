/**
 * Browser control tool for AI agents
 *
 * Architecture: spawn Chrome + connectOverCDP
 * Supports two modes:
 * - Launch mode (default): spawns a new Chrome with dedicated profile
 * - Connect mode: connects to user's existing Chrome (shares login state)
 */

import { BaseTool } from './base.js';
import type { ToolResult, ToolDefinition } from '../types/index.js';
import type { BrowserToolInput } from '../browser/types.js';

export class BrowserTool extends BaseTool<BrowserToolInput, ToolResult> {
  name = 'Browser';
  description = `
Control a Chromium browser through Chrome DevTools Protocol (CDP) and Playwright.
Supports persistent profiles, snapshot/ref/action interaction pattern.

WORKFLOW:
1. Start browser: Use "start" action to launch browser
2. Get page structure: Use "snapshot" action to get accessibility tree with ref IDs (e1, e2, e3...)
3. Interact with page: Use ref IDs with actions like "click", "fill", "type"
4. Capture results: Use "screenshot" to capture visual output

AVAILABLE ACTIONS:

Browser Lifecycle:
  - start: Launch browser with persistent profile (~/.claude/browser-data/default)
  - stop: Close browser
  - status: Get browser status (running, url, title, tabs)

Navigation:
  - goto: Navigate to URL (returns snapshot automatically)
  - go_back: Navigate back
  - go_forward: Navigate forward
  - reload: Reload current page

Page Inspection:
  - snapshot: Get accessibility tree with ref IDs
    - Set interactive=true to show only interactive elements
    - Returns page structure like:
      - button "Submit" [ref=e1]
      - textbox "Email" [ref=e2]
      - link "Sign up" [ref=e3]
  - screenshot: Capture page screenshot (set fullPage=true for full page)

Interaction (requires ref from snapshot):
  - click: Click element by ref
  - fill: Fill input element by ref with value
  - hover: Hover over element by ref
  - select: Select option(s) by ref with value (comma-separated for multiple)

Keyboard:
  - type: Type text at current focus
  - press: Press key (e.g., "Enter", "Escape", "Tab")

Tab Management:
  - tab_list: List all tabs with index/url/title
  - tab_new: Create new tab (optional url)
  - tab_select: Switch to tab by index
  - tab_close: Close tab by index (or current if no index)

Advanced:
  - evaluate: Execute JavaScript expression
  - cookies: Get cookies (optional domain filter)
  - cookie_set: Set cookie (requires name, value, optional domain/path/etc)
  - cookie_clear: Clear all cookies

USAGE NOTES:
  - Always call "start" before other actions
  - Use "snapshot" to get current page structure and ref IDs
  - Ref IDs (e1, e2, ...) are reassigned on each snapshot
  - If ref is invalid, you'll be prompted to run snapshot again
  - Screenshots are returned as base64-encoded PNG images
  - Browser uses persistent profile for login state persistence
  - If playwright-core is not installed, you'll see installation instructions
`;

  getInputSchema(): ToolDefinition['inputSchema'] {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'start',
            'stop',
            'status',
            'goto',
            'snapshot',
            'screenshot',
            'click',
            'fill',
            'type',
            'press',
            'hover',
            'select',
            'tab_list',
            'tab_new',
            'tab_select',
            'tab_close',
            'go_back',
            'go_forward',
            'reload',
            'evaluate',
            'cookies',
            'cookie_set',
            'cookie_clear',
          ],
          description: 'The browser action to perform',
        },
        url: {
          type: 'string',
          description: 'URL for goto, tab_new actions',
        },
        ref: {
          type: 'string',
          description: 'Element reference ID from snapshot (e.g., e1, e2) for click, fill, hover, select',
        },
        value: {
          type: 'string',
          description: 'Value for fill, select, cookie_set actions',
        },
        text: {
          type: 'string',
          description: 'Text to type for type action',
        },
        key: {
          type: 'string',
          description: 'Key to press for press action (e.g., Enter, Escape, Tab)',
        },
        index: {
          type: 'number',
          description: 'Tab index for tab_select, tab_close actions',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full page for screenshot action (default: false)',
        },
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate',
        },
        domain: {
          type: 'string',
          description: 'Domain filter for cookies action, domain for cookie_set',
        },
        name: {
          type: 'string',
          description: 'Cookie name for cookie_set action',
        },
        interactive: {
          type: 'boolean',
          description: 'Show only interactive elements in snapshot (default: false)',
        },
      },
      required: ['action'],
    };
  }

  private controller: any = null;

  private async getController(): Promise<any> {
    if (!this.controller) {
      const { BrowserManager } = await import('../browser/manager.js');
      const { BrowserController } = await import('../browser/controller.js');
      const manager = BrowserManager.getInstance();
      this.controller = new BrowserController(manager);
    }
    return this.controller;
  }

  private async getManager(): Promise<any> {
    const { BrowserManager } = await import('../browser/manager.js');
    return BrowserManager.getInstance();
  }

  async execute(input: BrowserToolInput): Promise<ToolResult> {
    try {
      const manager = await this.getManager();
      const controller = await this.getController();

      switch (input.action) {
        case 'start': {
          await manager.start({ headless: false });
          const mode = manager.getMode();
          const cdpUrl = manager.getCdpUrl();
          const profileDir = manager.getProfileDir();
          const info = mode === 'connected'
            ? `Connected to existing Chrome at ${cdpUrl}`
            : `Launched Chrome (profile: ${profileDir})`;
          return this.success(
            `Browser started successfully. ${info}\n` +
            `Use "snapshot" action to get page structure.`
          );
        }

        case 'stop': {
          await manager.stop();
          this.controller = null;
          return this.success('Browser stopped successfully.');
        }

        case 'status': {
          if (!manager.isRunning()) {
            return this.success('Browser is not running. Use "start" action to launch browser.');
          }

          const page = await manager.getPage();
          const pages = manager.getAllPages();
          const status = {
            running: true,
            url: page.url(),
            title: await page.title(),
            tabCount: pages.length,
            mode: manager.getMode(),
            cdpUrl: manager.getCdpUrl(),
          };

          return this.success(
            `Browser Status:\n- Running: ${status.running}\n- Mode: ${status.mode}\n- CDP: ${status.cdpUrl}\n- URL: ${status.url}\n- Title: ${status.title}\n- Tabs: ${status.tabCount}`
          );
        }

        case 'goto': {
          if (!input.url) {
            return this.error('Missing required parameter: url');
          }
          const result = await controller.goto(input.url);
          return this.success(
            `Navigated to: ${result.url}\nTitle: ${result.title}\n\n=== Page Structure ===\n${result.content}\n\nUse ref IDs (e1, e2, ...) for interaction.`
          );
        }

        case 'snapshot': {
          const result = await controller.snapshot({ interactive: input.interactive });
          return this.success(
            `URL: ${result.url}\nTitle: ${result.title}\n\n=== Page Structure ===\n${result.content}\n\nUse ref IDs (e1, e2, ...) for interaction.`
          );
        }

        case 'screenshot': {
          const buffer = await controller.screenshot({ fullPage: input.fullPage });
          const base64 = buffer.toString('base64');
          return this.success(`[image]\ndata:image/png;base64,${base64}`);
        }

        case 'click': {
          if (!input.ref) {
            return this.error('Missing required parameter: ref');
          }
          await controller.click(input.ref);
          return this.success(`Clicked element: ${input.ref}`);
        }

        case 'fill': {
          if (!input.ref || !input.value) {
            return this.error('Missing required parameters: ref, value');
          }
          await controller.fill(input.ref, input.value);
          return this.success(`Filled element ${input.ref} with: ${input.value}`);
        }

        case 'type': {
          if (!input.text) {
            return this.error('Missing required parameter: text');
          }
          await controller.type(input.text);
          return this.success(`Typed: ${input.text}`);
        }

        case 'press': {
          if (!input.key) {
            return this.error('Missing required parameter: key');
          }
          await controller.press(input.key);
          return this.success(`Pressed key: ${input.key}`);
        }

        case 'hover': {
          if (!input.ref) {
            return this.error('Missing required parameter: ref');
          }
          await controller.hover(input.ref);
          return this.success(`Hovered over element: ${input.ref}`);
        }

        case 'select': {
          if (!input.ref || !input.value) {
            return this.error('Missing required parameters: ref, value');
          }
          const values = input.value.split(',').map((v) => v.trim());
          await controller.select(input.ref, values);
          return this.success(`Selected option(s) in ${input.ref}: ${values.join(', ')}`);
        }

        case 'go_back': {
          await controller.goBack();
          return this.success('Navigated back');
        }

        case 'go_forward': {
          await controller.goForward();
          return this.success('Navigated forward');
        }

        case 'reload': {
          await controller.reload();
          return this.success('Page reloaded');
        }

        case 'tab_list': {
          const tabs = await controller.tabList();
          const tabList = tabs
            .map(
              (tab: any) =>
                `[${tab.index}]${tab.active ? ' *' : '  '} ${tab.title}\n    ${tab.url}`
            )
            .join('\n');
          return this.success(`Tabs:\n${tabList}\n\n* = active tab`);
        }

        case 'tab_new': {
          await controller.tabNew(input.url);
          return this.success(`New tab created${input.url ? `: ${input.url}` : ''}`);
        }

        case 'tab_select': {
          if (input.index === undefined) {
            return this.error('Missing required parameter: index');
          }
          await controller.tabSelect(input.index);
          return this.success(`Switched to tab ${input.index}`);
        }

        case 'tab_close': {
          await controller.tabClose(input.index);
          return this.success(
            `Closed tab${input.index !== undefined ? ` ${input.index}` : ''}`
          );
        }

        case 'evaluate': {
          if (!input.expression) {
            return this.error('Missing required parameter: expression');
          }
          const result = await controller.evaluate(input.expression);
          return this.success(`Result: ${JSON.stringify(result, null, 2)}`);
        }

        case 'cookies': {
          const cookies = await controller.getCookies(input.domain);
          return this.success(
            `Cookies${input.domain ? ` for ${input.domain}` : ''}:\n${JSON.stringify(cookies, null, 2)}`
          );
        }

        case 'cookie_set': {
          if (!input.name || !input.value) {
            return this.error('Missing required parameters: name, value');
          }
          await controller.setCookie(input.name, input.value, {
            domain: input.domain,
          });
          return this.success(`Cookie set: ${input.name}=${input.value}`);
        }

        case 'cookie_clear': {
          await controller.clearCookies();
          return this.success('All cookies cleared');
        }

        default:
          return this.error(`Unknown action: ${input.action}`);
      }
    } catch (error: any) {
      if (error.message?.includes('Cannot find module') && error.message?.includes('playwright-core')) {
        return this.error(
          'playwright-core is not installed. Please run: npm install playwright-core'
        );
      }

      if (error.message?.includes('Browser is not running')) {
        return this.error(
          'Browser is not running. Please use "start" action first to launch the browser.'
        );
      }

      if (error.message?.includes('Unknown ref')) {
        return this.error(
          `${error.message}\nPlease use "snapshot" action to get current page structure and valid ref IDs.`
        );
      }

      return this.error(`Browser error: ${error.message || String(error)}`);
    }
  }
}
