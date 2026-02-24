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
import { t } from '../i18n/index.js';
import { getSessionId } from '../core/session-context.js';

export class BrowserTool extends BaseTool<BrowserToolInput, ToolResult> {
  name = 'Browser';
  description = `Control a Chromium browser through Chrome DevTools Protocol (CDP) and Playwright.
Supports persistent profiles, snapshot/ref/action interaction pattern.

WORKFLOW:
1. Start browser: Use "start" action to launch browser
2. Get page structure: Use "snapshot" action to get accessibility tree with ref IDs (e1, e2, e3...)
3. Interact with page: Use ref IDs with actions like "click", "fill", "type"
4. Capture results: Use "screenshot" to capture visual output

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
            'screenshot_labeled',
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
            'console_log',
            'profile_list',
            'profile_create',
            'profile_delete',
            'upload_file',
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
        profileName: {
          type: 'string',
          description: 'Profile name for start, profile_create, profile_delete actions',
        },
        filePath: {
          type: 'string',
          description: 'Absolute file path for upload_file action (sets file on an <input type="file"> element)',
        },
      },
      required: ['action'],
    };
  }

  // 按 sessionId 隔离的 controller 实例
  // 每个会话有自己的专属 tab 和 refs/console 状态
  private controllers: Map<string, any> = new Map();

  private async getController(): Promise<any> {
    const sessionId = getSessionId();
    let controller = this.controllers.get(sessionId);
    if (!controller) {
      const { BrowserManager } = await import('../browser/manager.js');
      const { BrowserController } = await import('../browser/controller.js');
      const manager = BrowserManager.getInstance();
      controller = new BrowserController(manager);
      this.controllers.set(sessionId, controller);
    }
    return controller;
  }

  /**
   * 清理指定会话的 controller（关闭专属 tab）
   */
  private async removeController(sessionId: string): Promise<void> {
    const controller = this.controllers.get(sessionId);
    if (controller) {
      await controller.closeDedicatedTab();
      this.controllers.delete(sessionId);
    }
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
          await manager.start({ 
            headless: false,
            profileName: input.profileName,
          });
          const profileName = manager.getProfileName();
          const profileDir = manager.getProfileDir();
          const extensionOk = manager.isExtensionConnected();
          return this.success(
            `Browser started (profile: ${profileName}, dir: ${profileDir}).\n` +
            `Anti-detection: ACTIVE (Playwright → Relay → Extension → chrome.debugger)\n` +
            `Extension connected: ${extensionOk ? 'YES' : 'NO'}\n` +
            `A dedicated tab will be created for this session.\n` +
            `Use "snapshot" action to get page structure.`
          );
        }

        case 'stop': {
          // 只关闭当前会话的专属 tab，不关闭整个浏览器
          // 浏览器是共享资源，其他会话和用户可能仍在使用
          const stopSessionId = getSessionId();
          await this.removeController(stopSessionId);
          return this.success('Session browser tab closed. Browser process remains running for other sessions.');
        }

        case 'status': {
          if (!manager.isRunning()) {
            return this.success(t('browser.notRunning'));
          }

          const pages = manager.getAllPages();
          const extensionConnected = manager.isExtensionConnected();

          // 获取当前会话的专属 tab 状态（不触发创建新 controller/tab）
          const statusSessionId = getSessionId();
          const sessionController = this.controllers.get(statusSessionId);
          let sessionTabInfo = '(no dedicated tab)';
          if (sessionController) {
            try {
              const dedicatedPage = sessionController.getDedicatedPage?.();
              if (dedicatedPage && !dedicatedPage.isClosed()) {
                sessionTabInfo = `${dedicatedPage.url()} - ${await dedicatedPage.title()}`;
              } else {
                sessionTabInfo = '(tab closed)';
              }
            } catch {
              sessionTabInfo = '(tab unavailable)';
            }
          }

          let statusStr = `Browser Status:\n- Running: true\n- CDP: ${manager.getCdpUrl()}\n- Anti-detection: ACTIVE\n- Extension Connected: ${extensionConnected ? 'YES' : 'NO'}\n- Total Tabs: ${pages.length}\n- Session Tab: ${sessionTabInfo}\n- Session ID: ${statusSessionId}\n- Active Sessions: ${this.controllers.size}`;

          return this.success(statusStr);
        }

        case 'goto': {
          if (!input.url) {
            return this.error(t('browser.missingUrl'));
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
          const rawBuffer = await controller.screenshot({ fullPage: input.fullPage });
          // Anthropic API 多图请求要求每张图片任意维度不超过 2000px
          const MAX_DIM = 2000;
          let finalBuffer = rawBuffer;
          let mediaType: 'image/png' | 'image/jpeg' = 'image/png';
          try {
            const sharpMod = await import('sharp');
            const sharpFn = sharpMod.default;
            const metadata = await sharpFn(rawBuffer).metadata();
            const w = metadata.width || 0;
            const h = metadata.height || 0;
            if (w > MAX_DIM || h > MAX_DIM) {
              finalBuffer = await sharpFn(rawBuffer)
                .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();
            }
          } catch {
            // sharp 处理失败或不可用时用原始 buffer
          }
          const base64 = finalBuffer.toString('base64');
          return {
            success: true,
            output: t('browser.screenshotCaptured'),
            images: [{
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: mediaType,
                data: base64,
              },
            }],
          } as any;
        }

        case 'screenshot_labeled': {
          const result = await controller.screenshotWithLabels({ fullPage: input.fullPage });
          // Resize if needed
          const MAX_DIM = 2000;
          let finalBuffer = result.buffer;
          let mediaType: 'image/png' | 'image/jpeg' = 'image/png';
          try {
            const sharpMod = await import('sharp');
            const sharpFn = sharpMod.default;
            const metadata = await sharpFn(result.buffer).metadata();
            const w = metadata.width || 0;
            const h = metadata.height || 0;
            if (w > MAX_DIM || h > MAX_DIM) {
              finalBuffer = await sharpFn(result.buffer)
                .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
                .png()
                .toBuffer();
            }
          } catch {
            // sharp 处理失败或不可用时用原始 buffer
          }
          const base64 = finalBuffer.toString('base64');
          return {
            success: true,
            output: `Screenshot with labels captured. ${result.labelCount} elements labeled, ${result.skippedCount} elements skipped (off-screen or not visible).`,
            images: [{
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: mediaType,
                data: base64,
              },
            }],
          } as any;
        }

        case 'click': {
          if (!input.ref) {
            return this.error(t('browser.missingRef'));
          }
          await controller.click(input.ref);
          return this.success(`Clicked element: ${input.ref}`);
        }

        case 'fill': {
          if (!input.ref || !input.value) {
            return this.error(t('browser.missingRefValue'));
          }
          await controller.fill(input.ref, input.value);
          return this.success(`Filled element ${input.ref} with: ${input.value}`);
        }

        case 'type': {
          if (!input.text) {
            return this.error(t('browser.missingText'));
          }
          await controller.type(input.text);
          return this.success(`Typed: ${input.text}`);
        }

        case 'press': {
          if (!input.key) {
            return this.error(t('browser.missingKey'));
          }
          await controller.press(input.key);
          return this.success(`Pressed key: ${input.key}`);
        }

        case 'hover': {
          if (!input.ref) {
            return this.error(t('browser.missingRef'));
          }
          await controller.hover(input.ref);
          return this.success(`Hovered over element: ${input.ref}`);
        }

        case 'select': {
          if (!input.ref || !input.value) {
            return this.error(t('browser.missingRefValue'));
          }
          const values = input.value.split(',').map((v) => v.trim());
          await controller.select(input.ref, values);
          return this.success(`Selected option(s) in ${input.ref}: ${values.join(', ')}`);
        }

        case 'upload_file': {
          if (!input.ref || !input.filePath) {
            return this.error('upload_file requires both ref (file input element) and filePath (absolute path to file)');
          }
          await controller.uploadFile(input.ref, input.filePath);
          return this.success(`Uploaded file to ${input.ref}: ${input.filePath}`);
        }

        case 'go_back': {
          await controller.goBack();
          return this.success(t('browser.navigatedBack'));
        }

        case 'go_forward': {
          await controller.goForward();
          return this.success(t('browser.navigatedForward'));
        }

        case 'reload': {
          await controller.reload();
          return this.success(t('browser.pageReloaded'));
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
            return this.error(t('browser.missingIndex'));
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
            return this.error(t('browser.missingExpression'));
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
            return this.error(t('browser.missingNameValue'));
          }
          await controller.setCookie(input.name, input.value, {
            domain: input.domain,
          });
          return this.success(`Cookie set: ${input.name}=${input.value}`);
        }

        case 'cookie_clear': {
          await controller.clearCookies();
          return this.success(t('browser.cookiesCleared'));
        }

        case 'console_log': {
          const logs = controller.getConsoleLog();
          let output = '=== Console Messages (errors/warnings) ===\n';
          if (logs.consoleMessages.length > 0) {
            output += logs.consoleMessages.join('\n');
          } else {
            output += '(no console messages)\n';
          }
          
          output += '\n\n=== Page Errors ===\n';
          if (logs.pageErrors.length > 0) {
            output += logs.pageErrors.join('\n---\n');
          } else {
            output += '(no page errors)';
          }
          
          return this.success(output);
        }

        case 'profile_list': {
          const { listProfiles } = await import('../browser/profiles.js');
          const profiles = listProfiles();
          const profileNames = Object.keys(profiles);
          
          if (profileNames.length === 0) {
            return this.success('No profiles found. Use profile_create to create one.');
          }

          let output = 'Browser Profiles:\n';
          for (const name of profileNames) {
            const profile = profiles[name];
            output += `\n[${name}]\n`;
            output += `  CDP Port: ${profile.cdpPort}\n`;
            output += `  Color: ${profile.color}\n`;
            output += `  User Data: ${profile.userDataDir}\n`;
            output += `  Created: ${profile.createdAt}\n`;
          }
          
          return this.success(output);
        }

        case 'profile_create': {
          if (!input.profileName) {
            return this.error('profileName is required for profile_create action');
          }

          const { createProfile } = await import('../browser/profiles.js');
          const profile = createProfile(input.profileName);
          
          return this.success(
            `Profile "${input.profileName}" created successfully.\n` +
            `CDP Port: ${profile.cdpPort}\n` +
            `Color: ${profile.color}\n` +
            `User Data: ${profile.userDataDir}`
          );
        }

        case 'profile_delete': {
          if (!input.profileName) {
            return this.error('profileName is required for profile_delete action');
          }

          const { deleteProfile } = await import('../browser/profiles.js');
          deleteProfile(input.profileName);
          
          return this.success(`Profile "${input.profileName}" deleted successfully.`);
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

      if (error.message?.includes('Navigation blocked')) {
        return this.error(
          `${error.message}\nThis URL is blocked by security policy (SSRF protection).`
        );
      }

      return this.error(`Browser error: ${error.message || String(error)}`);
    }
  }
}
