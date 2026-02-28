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
  /** Index into page.frames() — 0 = main frame, >0 = iframe */
  frameIndex?: number;
  /** CSS selector for non-standard clickable elements (optional) */
  selector?: string;
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

export interface DownloadInfo {
  suggestedFilename: string;
  url: string;
  savedPath?: string;
}

export interface DialogInfo {
  type: string; // 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string;
  handled: boolean;
  response?: string;
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
  | 'upload_file'
  | 'scroll'
  | 'dblclick'
  | 'rightclick'
  | 'drag'
  | 'wait_for_selector'
  | 'wait_for_url'
  | 'wait_for_load_state'
  | 'wait_for_timeout'
  | 'dialog_handle'
  | 'download_start'
  | 'download_list'
  | 'mouse_move'
  | 'mouse_down'
  | 'mouse_up'
  | 'mouse_wheel'
  | 'set_viewport'
  | 'network_intercept'
  | 'network_abort'
  | 'storage_get'
  | 'storage_set'
  | 'storage_clear'
  | 'pdf'
  | 'frame_list'
  | 'frame_select'
  | 'wait_for_stable';

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
  selector?: string;
  timeout?: number;
  deltaX?: number;
  deltaY?: number;
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  sourceRef?: string;
  targetRef?: string;
  dialogAction?: 'accept' | 'dismiss';
  dialogText?: string;
  width?: number;
  height?: number;
  loadState?: 'load' | 'domcontentloaded' | 'networkidle';
  storageType?: 'local' | 'session';
  storageKey?: string;
  storageValue?: string;
  routePattern?: string;
  routeAction?: 'block' | 'continue' | 'fulfill';
  routeBody?: string;
  routeStatus?: number;
  savePath?: string;
  frameIndex?: number;
  stableMs?: number;
}
