/**
 * Browser control system type definitions
 */

import type { Locator } from 'playwright-core';

export interface BrowserStartOptions {
  headless?: boolean;
  executablePath?: string;
  cdpUrl?: string;
}

export interface SnapshotNode {
  role: string;
  name?: string;
  ref?: string;
  children?: SnapshotNode[];
  value?: string;
  description?: string;
  checked?: boolean;
  selected?: boolean;
  level?: number;
  url?: string;
}

export interface SnapshotResult {
  title: string;
  url: string;
  content: string;
  refs: Map<string, Locator>;
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

export interface BrowserStatus {
  running: boolean;
  url?: string;
  title?: string;
  tabCount?: number;
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
