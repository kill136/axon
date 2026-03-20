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

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        runtimeBackend: 'codex-subscription',
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
});
