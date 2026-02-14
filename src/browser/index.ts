/**
 * Browser control system
 */

export * from './types.js';
export { detectBrowser, detectBrowserExecutable, type BrowserExecutable } from './detect.js';
export { BrowserManager } from './manager.js';
export { BrowserController } from './controller.js';
