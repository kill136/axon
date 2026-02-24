/**
 * Browser control system
 */

export * from './types.js';
export { detectBrowser, detectBrowserExecutable, type BrowserExecutable } from './detect.js';
export { BrowserManager } from './manager.js';
export { BrowserController } from './controller.js';
export { toAIFriendlyError, normalizeTimeoutMs } from './errors.js';
export { ensureChromeExtensionRelayServer } from './extension-relay.js';
export { listProfiles, createProfile, deleteProfile, getProfile } from './profiles.js';
