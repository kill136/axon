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

ADVANCED FEATURES:
  - scroll: Scroll page or scroll element into view
  - dblclick/rightclick: Double-click and right-click support
  - drag: Drag and drop between elements
  - wait_for_selector/wait_for_url/wait_for_load_state: Wait for dynamic content
  - dialog_handle: View and control browser dialogs (alert/confirm/prompt)
  - download_start/download_list: Capture and save file downloads
  - mouse_move/mouse_down/mouse_up/mouse_wheel: Precise mouse control
  - set_viewport: Change browser viewport size
  - network_intercept/network_abort: Intercept and modify network requests
  - storage_get/storage_set/storage_clear: Access localStorage/sessionStorage
  - pdf: Generate PDF from current page
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
            'scroll',
            'dblclick',
            'rightclick',
            'drag',
            'wait_for_selector',
            'wait_for_url',
            'wait_for_load_state',
            'wait_for_timeout',
            'dialog_handle',
            'download_start',
            'download_list',
            'mouse_move',
            'mouse_down',
            'mouse_up',
            'mouse_wheel',
            'set_viewport',
            'network_intercept',
            'network_abort',
            'storage_get',
            'storage_set',
            'storage_clear',
            'pdf',
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
          description: 'Absolute file path for upload_file action. If ref is provided, sets file on that element; if ref is omitted, auto-detects the <input type="file"> on the page (click the upload button first to trigger it).',
        },
        selector: { type: 'string', description: 'CSS selector for wait_for_selector' },
        timeout: { type: 'number', description: 'Timeout in ms for wait operations' },
        deltaX: { type: 'number', description: 'Horizontal scroll/mouse delta' },
        deltaY: { type: 'number', description: 'Vertical scroll/mouse delta (positive = down)' },
        x: { type: 'number', description: 'Mouse X coordinate for mouse_move' },
        y: { type: 'number', description: 'Mouse Y coordinate for mouse_move' },
        button: { type: 'string', enum: ['left', 'middle', 'right'], description: 'Mouse button (default: left)' },
        sourceRef: { type: 'string', description: 'Source element ref for drag action' },
        targetRef: { type: 'string', description: 'Target element ref for drag action' },
        dialogAction: { type: 'string', enum: ['accept', 'dismiss'], description: 'How to handle dialog' },
        dialogText: { type: 'string', description: 'Text to enter in prompt dialog' },
        width: { type: 'number', description: 'Viewport width for set_viewport' },
        height: { type: 'number', description: 'Viewport height for set_viewport' },
        loadState: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Load state to wait for' },
        storageType: { type: 'string', enum: ['local', 'session'], description: 'Storage type (localStorage or sessionStorage)' },
        storageKey: { type: 'string', description: 'Storage key' },
        storageValue: { type: 'string', description: 'Storage value to set' },
        routePattern: { type: 'string', description: 'URL pattern for network interception (glob)' },
        routeAction: { type: 'string', enum: ['block', 'continue', 'fulfill'], description: 'Action for intercepted requests' },
        routeBody: { type: 'string', description: 'Response body for fulfill action' },
        routeStatus: { type: 'number', description: 'HTTP status code for fulfill action' },
        savePath: { type: 'string', description: 'File save path for download_start and pdf actions' },
      },
      required: ['action'],
    };
  }

  // 按 sessionId 隔离的 controller 实例
  // 每个会话有自己的专属 tab 和 refs/console 状态
  private controllers: Map<string, any> = new Map();
  private chromeExitListenerRegistered = false;

  private async getController(): Promise<any> {
    const sessionId = getSessionId();
    let controller = this.controllers.get(sessionId);
    if (!controller) {
      const { BrowserManager } = await import('../browser/manager.js');
      const { BrowserController } = await import('../browser/controller.js');
      const manager = BrowserManager.getInstance();
      controller = new BrowserController(manager);
      this.controllers.set(sessionId, controller);

      // Register Chrome exit listener once to clean up all controllers
      if (!this.chromeExitListenerRegistered) {
        this.chromeExitListenerRegistered = true;
        manager.onChromeExit(() => {
          this.controllers.clear();
          this.chromeExitListenerRegistered = false;
        });
      }
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

      switch (input.action) {
        case 'start': {
          // Clean up orphaned controllers from previous sessions
          // This prevents "All tabs are claimed" errors when reusing browser process
          const currentSessionId = getSessionId();
          const orphanedSessions = Array.from(this.controllers.keys()).filter(
            id => id !== currentSessionId
          );
          for (const sessionId of orphanedSessions) {
            await this.removeController(sessionId);
          }

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
          // 关闭当前会话的专属 tab
          const stopSessionId = getSessionId();
          await this.removeController(stopSessionId);

          // 如果没有更多活跃 session，彻底关闭浏览器和 relay
          if (this.controllers.size === 0) {
            await manager.stop();
            return this.success('Browser fully stopped. All sessions closed, Chrome and relay shut down.');
          }
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
      }

      // For all other actions, get controller on demand
      const controller = await this.getController();

      switch (input.action) {
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
          const rawBuffer = await controller.screenshot({ 
            fullPage: input.fullPage,
            timeout: input.timeout
          });
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
          const result = await controller.screenshotWithLabels({ 
            fullPage: input.fullPage,
            timeout: input.timeout
          });
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
          // 支持 ref 模式或坐标模式
          if (input.ref) {
            await controller.click(input.ref);
            return this.success(`Clicked element: ${input.ref}`);
          } else if (input.x !== undefined && input.y !== undefined) {
            await controller.click(undefined, { x: input.x, y: input.y });
            return this.success(`Clicked at coordinates (${input.x}, ${input.y})`);
          } else {
            return this.error('Either ref or x/y coordinates must be provided for click');
          }
        }

        case 'fill': {
          if (!input.value) {
            return this.error('value is required for fill');
          }
          
          // 支持 ref 模式或坐标模式
          if (input.ref) {
            await controller.fill(input.ref, input.value);
            return this.success(`Filled element ${input.ref} with: ${input.value}`);
          } else if (input.x !== undefined && input.y !== undefined) {
            await controller.fill(undefined, input.value, { x: input.x, y: input.y });
            return this.success(`Filled at coordinates (${input.x}, ${input.y}) with: ${input.value}`);
          } else {
            return this.error('Either ref or x/y coordinates must be provided for fill');
          }
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
          if (!input.filePath) {
            return this.error('upload_file requires filePath (absolute path to file). ref is optional — if omitted, auto-detects <input type="file"> on the page.');
          }
          await controller.uploadFile(input.ref, input.filePath);
          const target = input.ref ? `ref ${input.ref}` : 'auto-detected file input';
          return this.success(`Uploaded file via ${target}: ${input.filePath}`);
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

        case 'frame_list': {
          const frames = await controller.frameList();
          const output = frames.map(f => 
            `[${f.index}] ${f.name ? `"${f.name}" ` : ''}${f.url}${f.parentFrame !== null ? ` (parent: ${f.parentFrame})` : ''}`
          ).join('\n');
          return this.success(`Frames:\n${output}`);
        }

        case 'frame_select': {
          const frameIndex = input.frameIndex ?? 0;
          controller.frameSelect(frameIndex);
          return this.success(
            frameIndex === 0 
              ? 'Selected main frame (index 0)' 
              : `Selected frame ${frameIndex}. All subsequent operations will target this frame.`
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

        case 'scroll': {
          await controller.scroll({
            ref: input.ref,
            deltaX: input.deltaX,
            deltaY: input.deltaY,
          });
          if (input.ref) {
            return this.success(`Scrolled element ${input.ref} into view.`);
          }
          return this.success(`Scrolled page by (${input.deltaX ?? 0}, ${input.deltaY ?? 300}).`);
        }

        case 'dblclick': {
          // 支持 ref 模式或坐标模式
          if (input.ref) {
            await controller.dblclick(input.ref);
            return this.success(`Double-clicked element: ${input.ref}`);
          } else if (input.x !== undefined && input.y !== undefined) {
            await controller.dblclick(undefined, { x: input.x, y: input.y });
            return this.success(`Double-clicked at coordinates (${input.x}, ${input.y})`);
          } else {
            return this.error('Either ref or x/y coordinates must be provided for dblclick');
          }
        }

        case 'rightclick': {
          // 支持 ref 模式或坐标模式
          if (input.ref) {
            await controller.rightclick(input.ref);
            return this.success(`Right-clicked element: ${input.ref}`);
          } else if (input.x !== undefined && input.y !== undefined) {
            await controller.rightclick(undefined, { x: input.x, y: input.y });
            return this.success(`Right-clicked at coordinates (${input.x}, ${input.y})`);
          } else {
            return this.error('Either ref or x/y coordinates must be provided for rightclick');
          }
        }

        case 'drag': {
          if (!input.sourceRef || !input.targetRef) {
            return this.error('drag requires sourceRef and targetRef parameters.');
          }
          await controller.dragAndDrop(input.sourceRef, input.targetRef);
          return this.success(`Dragged ${input.sourceRef} to ${input.targetRef}`);
        }

        case 'wait_for_selector': {
          if (!input.selector) return this.error('wait_for_selector requires selector parameter.');
          await controller.waitForSelector(input.selector, { timeout: input.timeout });
          return this.success(`Selector "${input.selector}" is now visible.`);
        }

        case 'wait_for_url': {
          if (!input.url) return this.error('wait_for_url requires url parameter.');
          await controller.waitForUrl(input.url, { timeout: input.timeout });
          return this.success(`URL now matches: ${input.url}`);
        }

        case 'wait_for_load_state': {
          const state = input.loadState ?? 'networkidle';
          await controller.waitForLoadState(state, { timeout: input.timeout });
          return this.success(`Page reached load state: ${state}`);
        }

        case 'wait_for_timeout': {
          const ms = input.timeout ?? 1000;
          await controller.waitForTimeout(ms);
          return this.success(`Waited ${ms}ms.`);
        }

        case 'wait_for_stable': {
          const timeout = input.timeout ?? 10000;
          const stableMs = input.stableMs ?? 500;
          await controller.waitForStable({ timeout, stableMs });
          return this.success(
            `Page became stable (no DOM changes for ${stableMs}ms, timeout: ${timeout}ms).`
          );
        }

        case 'dialog_handle': {
          const info = controller.getDialogHistory();
          if (input.dialogAction) {
            controller.setAutoAcceptDialogs(input.dialogAction === 'accept');
            return this.success(
              `Dialog auto-${input.dialogAction} mode enabled.\n` +
              `Recent dialogs (${info.length}):\n` +
              info.map((d: any) => `  [${d.type}] "${d.message}" → ${d.handled ? d.response : 'pending'}`).join('\n')
            );
          }
          if (info.length === 0) {
            return this.success('No dialogs detected. Dialogs are auto-accepted by default to prevent page hanging.');
          }
          return this.success(
            `Dialog history (${info.length}):\n` +
            info.map((d: any) => `  [${d.type}] "${d.message}" → ${d.handled ? d.response : 'pending'}`).join('\n')
          );
        }

        case 'download_start': {
          await controller.setupDownloadListener(input.savePath);
          return this.success(`Download listener active. Files will be saved to: ${input.savePath || 'default download path'}`);
        }

        case 'download_list': {
          const downloads = controller.getDownloads();
          if (downloads.length === 0) {
            return this.success('No downloads captured. Use download_start first, then trigger a download.');
          }
          return this.success(
            `Downloads (${downloads.length}):\n` +
            downloads.map((d: any) => `  ${d.suggestedFilename} (${d.url})\n    → ${d.savedPath || 'pending'}`).join('\n')
          );
        }

        case 'mouse_move': {
          if (input.x === undefined || input.y === undefined) {
            return this.error('mouse_move requires x and y coordinates.');
          }
          await controller.mouseMove(input.x, input.y);
          return this.success(`Mouse moved to (${input.x}, ${input.y})`);
        }

        case 'mouse_down': {
          await controller.mouseDown({ button: input.button as any });
          return this.success(`Mouse button ${input.button ?? 'left'} pressed down.`);
        }

        case 'mouse_up': {
          await controller.mouseUp({ button: input.button as any });
          return this.success(`Mouse button ${input.button ?? 'left'} released.`);
        }

        case 'mouse_wheel': {
          await controller.mouseWheel(input.deltaX ?? 0, input.deltaY ?? 0);
          return this.success(`Mouse wheel scrolled (${input.deltaX ?? 0}, ${input.deltaY ?? 0}).`);
        }

        case 'set_viewport': {
          if (!input.width || !input.height) {
            return this.error('set_viewport requires width and height parameters.');
          }
          await controller.setViewport(input.width, input.height);
          return this.success(`Viewport set to ${input.width}x${input.height}`);
        }

        case 'network_intercept': {
          if (!input.routePattern || !input.routeAction) {
            return this.error('network_intercept requires routePattern and routeAction parameters.');
          }
          await controller.networkIntercept(
            input.routePattern,
            input.routeAction as any,
            { body: input.routeBody, status: input.routeStatus }
          );
          return this.success(`Network route set: ${input.routePattern} → ${input.routeAction}`);
        }

        case 'network_abort': {
          if (!input.routePattern) {
            return this.error('network_abort requires routePattern parameter.');
          }
          await controller.networkAbort(input.routePattern);
          return this.success(`Network route removed: ${input.routePattern}`);
        }

        case 'storage_get': {
          const sType = input.storageType ?? 'local';
          const result = await controller.storageGet(sType, input.storageKey);
          if (input.storageKey) {
            return this.success(`${sType}Storage["${input.storageKey}"] = ${JSON.stringify(result)}`);
          }
          return this.success(`${sType}Storage contents:\n${JSON.stringify(result, null, 2)}`);
        }

        case 'storage_set': {
          if (!input.storageKey || input.storageValue === undefined) {
            return this.error('storage_set requires storageKey and storageValue parameters.');
          }
          const sTypeSet = input.storageType ?? 'local';
          await controller.storageSet(sTypeSet, input.storageKey, input.storageValue);
          return this.success(`${sTypeSet}Storage["${input.storageKey}"] = ${JSON.stringify(input.storageValue)}`);
        }

        case 'storage_clear': {
          const sTypeClear = input.storageType ?? 'local';
          await controller.storageClear(sTypeClear);
          return this.success(`${sTypeClear}Storage cleared.`);
        }

        case 'pdf': {
          if (!input.savePath) {
            return this.error('pdf requires savePath parameter.');
          }
          const pdfPath = await controller.generatePdf(input.savePath);
          return this.success(`PDF saved to: ${pdfPath}`);
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
          'Browser is not running (Chrome process may have crashed or been closed). ' +
          'Please use "start" action to relaunch the browser. Previous page state will be lost.'
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
