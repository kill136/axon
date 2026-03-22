/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthDialog } from '../../src/web/client/src/components/AuthDialog';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

vi.mock('../../src/web/client/src/components/auth/OAuthLogin', () => ({
  OAuthLogin: ({ onSuccess }: { onSuccess?: () => void }) =>
    ClientReact.createElement('button', { onClick: onSuccess }, 'mock-oauth-login'),
}));

vi.mock('../../src/web/client/src/components/auth/CodexLogin', () => ({
  CodexLogin: ({ onSuccess }: { onSuccess?: () => void }) =>
    ClientReact.createElement('button', { onClick: onSuccess }, 'mock-codex-login'),
}));

vi.mock('../../src/web/client/src/components/AxonCloudAuth', () => ({
  AxonCloudAuth: ({ onSuccess }: { onSuccess?: () => void }) =>
    ClientReact.createElement('button', { onClick: onSuccess }, 'mock-axon-cloud-auth'),
}));

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params?.backend) {
        return `${key}:${params.backend}`;
      }
      return key;
    },
  }),
}));

describe('AuthDialog', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        runtimeBackend: 'codex-subscription',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
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

  const findButton = (text: string) => Array.from(container.querySelectorAll('button')).find(
    button => button.textContent?.includes(text),
  );

  const setInputValue = (input: HTMLInputElement, value: string) => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    expect(valueSetter).toBeTruthy();

    valueSetter!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  it('should toggle open state without changing hook order', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(AuthDialog, { isOpen: false, onClose, onSuccess }));
    });

    expect(container.textContent).not.toContain('auth.title');

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(AuthDialog, { isOpen: true, onClose, onSuccess }));
    });

    expect(container.textContent).toContain('auth.title');
    expect(container.textContent).toContain('auth.layout.managedTitle');
    expect(container.textContent).toContain('auth.layout.apiTitle');
    expect(container.textContent).toContain('auth.layout.currentBadge');

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(AuthDialog, { isOpen: false, onClose, onSuccess }));
    });

    expect(container.textContent).not.toContain('auth.title');
  });

  it('should save api-key auth with the normalized runtime payload', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          authenticated: true,
          runtimeBackend: 'codex-subscription',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
        }),
      });

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(AuthDialog, { isOpen: true, onClose, onSuccess }));
    });

    const openAiBackendButton = findButton('OpenAI-Compatible API');
    expect(openAiBackendButton).toBeTruthy();

    await ClientReact.act(async () => {
      openAiBackendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const inputs = container.querySelectorAll('input');
    const apiKeyInput = inputs.item(1) as HTMLInputElement | null;
    expect(apiKeyInput).not.toBeNull();

    await ClientReact.act(async () => {
      setInputValue(apiKeyInput!, 'sk-openai');
    });

    const saveButton = findButton('auth.provider.saveAndLogin');
    expect(saveButton).toBeTruthy();

    await ClientReact.act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      runtimeBackend: 'openai-compatible-api',
      runtimeProvider: 'codex',
      apiProvider: 'openai-compatible',
      authPriority: 'apiKey',
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
    });
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
