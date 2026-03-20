/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SetupWizard } from '../../src/web/client/src/components/SetupWizard';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

vi.mock('../../src/web/client/src/components/auth/OAuthLogin', () => ({
  OAuthLogin: () => ClientReact.createElement('div', null, 'mock-oauth-login'),
}));

vi.mock('../../src/web/client/src/components/auth/CodexLogin', () => ({
  CodexLogin: () => ClientReact.createElement('div', null, 'mock-codex-login'),
}));

vi.mock('../../src/web/client/src/components/AxonCloudAuth', () => ({
  AxonCloudAuth: () => ClientReact.createElement('div', null, 'mock-axon-cloud-auth'),
}));

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    locale: 'zh',
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

describe('SetupWizard', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    ClientReact.act(() => {
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
  });

  it('should use wide layouts for runtime selection and oauth auth steps', async () => {
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(SetupWizard, { onComplete: vi.fn() }));
    });

    expect(container.querySelector('.setup-wizard-modal.runtime-step')).toBeNull();

    const nextButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'setupWizard.next',
    );

    expect(nextButton).toBeTruthy();

    await ClientReact.act(async () => {
      nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const runtimeModal = container.querySelector('.setup-wizard-modal.runtime-step');
    expect(runtimeModal).not.toBeNull();

    const runtimeGrid = container.querySelector('.setup-wizard-provider-grid.runtime-grid');
    expect(runtimeGrid).not.toBeNull();
    expect(runtimeGrid?.querySelectorAll('.setup-wizard-mode-card')).toHaveLength(5);

    const claudeCard = Array.from(container.querySelectorAll('.setup-wizard-mode-card')).find(
      card => card.textContent?.includes('Claude Subscription'),
    );

    expect(claudeCard).toBeTruthy();

    await ClientReact.act(async () => {
      claudeCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const runtimeNextButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'setupWizard.next',
    );

    await ClientReact.act(async () => {
      runtimeNextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.setup-wizard-modal.runtime-step')).toBeNull();
    expect(container.querySelector('.setup-wizard-modal.oauth-auth-step')).not.toBeNull();
    expect(container.textContent).toContain('mock-oauth-login');
  });

  it('should use the api auth layout for openai-compatible setup', async () => {
    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(SetupWizard, { onComplete: vi.fn() }));
    });

    const nextButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'setupWizard.next',
    );

    await ClientReact.act(async () => {
      nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const openaiApiCard = Array.from(container.querySelectorAll('.setup-wizard-mode-card')).find(
      card => card.textContent?.includes('OpenAI-Compatible API'),
    );

    expect(openaiApiCard).toBeTruthy();

    await ClientReact.act(async () => {
      openaiApiCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const runtimeNextButton = Array.from(container.querySelectorAll('button')).find(
      button => button.textContent === 'setupWizard.next',
    );

    await ClientReact.act(async () => {
      runtimeNextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('.setup-wizard-modal.api-auth-step')).not.toBeNull();

    const apiGrid = container.querySelector('.setup-wizard-provider-grid.api-grid');
    expect(apiGrid).not.toBeNull();
    expect(apiGrid?.querySelectorAll('.setup-wizard-provider-card')).toHaveLength(3);
    expect(container.textContent).toContain('setupWizard.config.openaiCompatibleHint');
    expect(container.textContent).not.toContain('setupWizard.testUnsupported');
  });
});
