/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { AuthStatus } from '../../src/web/client/src/components/AuthStatus';

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'auth.claudeAi': 'Claude.ai',
        'auth.console': 'Console',
        'auth.login': '登录',
        'auth.logout': '登出',
        'auth.status.account': '当前账号',
        'auth.status.apiKey': 'API Key',
        'auth.status.axonCloud': 'Axon Cloud',
        'auth.status.identity': '身份标识',
        'auth.status.runtime': '当前运行方式',
        'auth.switchAccount': '切换账号',
      };
      return labels[key] ?? key;
    },
  }),
}));

function getCssRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, 'm'));

  expect(match, `${selector} rule should exist`).toBeTruthy();
  return match![1];
}

describe('AuthStatus', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        type: 'oauth',
        provider: 'codex',
        accountType: 'chatgpt',
        runtimeBackend: 'codex-subscription',
        email: 'chatbi19890202@gmail.com',
        displayName: 'BI Chat',
      }),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    ClientReact.act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders codex subscription account metadata in the dropdown', async () => {
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(AuthStatus, { onLoginClick: vi.fn() }));
    });

    expect(container.textContent).toContain('BI Chat');

    const trigger = container.querySelector('.auth-user-trigger') as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();

    await ClientReact.act(async () => {
      trigger!.click();
    });

    expect(container.textContent).toContain('当前账号');
    expect(container.textContent).toContain('身份标识');
    expect(container.textContent).toContain('当前运行方式');
    expect(container.textContent).toContain('ChatGPT / Codex');
    expect(container.textContent).toContain('Codex Subscription');
    expect(container.textContent).toContain('chatbi19890202@gmail.com');
  });

  it('keeps auth metadata labels in a dedicated column and allows long values to wrap', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/web/client/src/components/AuthStatus.css'),
      'utf8',
    );

    const rowRule = getCssRule(css, '.auth-dropdown-meta-row');
    expect(rowRule).toContain('display: grid;');
    expect(rowRule).toContain('grid-template-columns: 7rem minmax(0, 1fr);');
    expect(rowRule).toContain('align-items: start;');

    const dropdownRule = getCssRule(css, '.auth-dropdown');
    expect(dropdownRule).toContain('width: min(26rem, calc(100vw - 24px));');
    expect(dropdownRule).toContain('min-width: min(22rem, calc(100vw - 24px));');

    const labelRule = getCssRule(css, '.auth-dropdown-meta-label');
    expect(labelRule).toContain('word-break: keep-all;');

    const valueRule = getCssRule(css, '.auth-dropdown-meta-value');
    expect(valueRule).toContain('min-width: 0;');
    expect(valueRule).toContain('overflow-wrap: break-word;');
  });
});
