/**
 * Browser control system type definitions
 */

export interface BrowserStartOptions {
  headless?: boolean;
  executablePath?: string;
  /** CDP debugging port (default: auto-find available port starting from 9222) */
  cdpPort?: number;
  /** Don't use sandbox (needed in some Linux environments) */
  noSandbox?: boolean;
  /** Profile name to use (default: 'default') */
  profileName?: string;
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
  | 'screenshot_labeled'
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
  | 'cookie_clear'
  | 'console_log'
  | 'profile_list'
  | 'profile_create'
  | 'profile_delete'
  | 'upload_file';

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
  profileName?: string;
  filePath?: string;
}
