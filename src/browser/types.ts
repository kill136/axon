/**
 * Browser control system type definitions
 */

export interface BrowserStartOptions {
  headless?: boolean;
  executablePath?: string;
  /** Connect to existing Chrome CDP endpoint instead of launching */
  cdpUrl?: string;
  /** CDP debugging port (default: auto-find available port starting from 9222) */
  cdpPort?: number;
  /** Don't use sandbox (needed in some Linux environments) */
  noSandbox?: boolean;
}

export interface RefEntry {
  role: string;
  name: string;
  nth: number;
}

export interface SnapshotResult {
  title: string;
  url: string;
  content: string;
  refs: Map<string, RefEntry>;
}

export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface CookieOptions {
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  expires?: number;
}

export type BrowserAction =
  | 'start'
  | 'stop'
  | 'status'
  | 'goto'
  | 'snapshot'
  | 'screenshot'
  | 'click'
  | 'fill'
  | 'type'
  | 'press'
  | 'hover'
  | 'select'
  | 'tab_list'
  | 'tab_new'
  | 'tab_select'
  | 'tab_close'
  | 'go_back'
  | 'go_forward'
  | 'reload'
  | 'evaluate'
  | 'cookies'
  | 'cookie_set'
  | 'cookie_clear';

export interface BrowserToolInput {
  action: BrowserAction;
  url?: string;
  ref?: string;
  value?: string;
  text?: string;
  key?: string;
  index?: number;
  fullPage?: boolean;
  expression?: string;
  domain?: string;
  name?: string;
  interactive?: boolean;
}
