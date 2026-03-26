/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import { OAuthLogin } from '../../src/web/client/src/components/auth/OAuthLogin';

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'auth.oauth.title': 'OAuth 登录',
        'auth.oauth.selectMethod': '选择认证方式',
        'auth.oauth.claudeAi': 'Claude.ai 账号',
        'auth.oauth.claudeAiDesc': '适用于 Claude Pro/Max/Team 订阅用户',
        'auth.oauth.console': 'Console 账号',
        'auth.oauth.consoleDesc': '适用于 Anthropic Console 用户（API 计费）',
        'auth.oauth.importLocal': '导入本机登录',
        'auth.oauth.importLocalDesc': '复用当前机器上已有的 Claude Code 登录态',
        'auth.oauth.importingLocal': '正在导入本机 Claude Code 登录...',
        'auth.oauth.importLocalSuccess': '本机 Claude Code 登录已成功导入！',
        'auth.oauth.error': '错误',
        'auth.apiKey.title': '使用 API Key',
        'auth.apiKey.desc': '直接输入您的 Anthropic API Key',
        'auth.oauth.noAccount': '还没有账号？',
        'auth.oauth.signUpClaudeAi': '注册 Claude.ai',
        'auth.oauth.needApiKey': '需要 API Key？',
        'auth.oauth.getFromConsole': '从 Console 获取',
      };
      return labels[key] ?? key;
    },
  }),
}));

describe('OAuthLogin', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/auth/oauth/import-local') {
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      }

      throw new Error(`Unexpected fetch request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      ClientReact.act(() => {
        root.unmount();
      });
    }
    container?.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('imports the local Claude Code login from the selection screen', async () => {
    const onSuccess = vi.fn();

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(OAuthLogin, { onSuccess }));
    });

    const importButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('导入本机登录'),
    );
    expect(importButton).toBeTruthy();

    await ClientReact.act(async () => {
      importButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/oauth/import-local', {
      method: 'POST',
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('本机 Claude Code 登录已成功导入！');
  });
});
