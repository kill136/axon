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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
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
    button => button.textContent === text,
  );

  const clickButton = async (text: string) => {
    const button = findButton(text);

    expect(button).toBeTruthy();

    await ClientReact.act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  const clickModeCard = async (text: string) => {
    const card = Array.from(container.querySelectorAll('.setup-wizard-mode-card')).find(
      element => element.textContent?.includes(text),
    );

    expect(card).toBeTruthy();

    await ClientReact.act(async () => {
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  const enterApiKey = async (value = 'sk-test') => {
    const input = container.querySelector('input[type="password"]') as HTMLInputElement | null;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

    expect(input).not.toBeNull();
    expect(valueSetter).toBeTruthy();

    await ClientReact.act(async () => {
      valueSetter!.call(input, value);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
      input!.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

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

  it('should enter usage onboarding after api key setup and finish only on final confirmation', async () => {
    const onComplete = vi.fn();
    fetchMock.mockResolvedValue({
      json: async () => ({ success: true }),
    });

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(SetupWizard, { onComplete }));
    });

    await clickButton('setupWizard.next');
    await clickModeCard('OpenAI-Compatible API');
    await clickButton('setupWizard.next');
    await enterApiKey();
    await clickButton('setupWizard.finish');

    expect(container.textContent).toContain('setupWizard.usage.title');
    expect(localStorage.getItem('axon_setup_done')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await clickButton('setupWizard.startUsing');

    expect(localStorage.getItem('axon_setup_done')).toBe('true');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('should show project state in usage onboarding and trigger folder selection CTA', async () => {
    const onOpenFolder = vi.fn().mockResolvedValue(null);
    fetchMock.mockResolvedValue({
      json: async () => ({ success: true }),
    });

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(SetupWizard, {
        onComplete: vi.fn(),
        onOpenFolder,
        currentProjectName: 'demo-app',
      }));
    });

    await clickButton('setupWizard.next');
    await clickModeCard('OpenAI-Compatible API');
    await clickButton('setupWizard.next');
    await enterApiKey();
    await clickButton('setupWizard.finish');

    expect(container.textContent).toContain('demo-app');
    expect(container.textContent).toContain('setupWizard.usage.projectReadyLabel');
    expect(findButton('setupWizard.usage.changeFolder')).toBeTruthy();

    await clickButton('setupWizard.usage.changeFolder');

    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });

  it('should save normalized anthropic api payloads for claude-compatible setup', async () => {
    const onComplete = vi.fn();
    fetchMock.mockResolvedValue({
      json: async () => ({ success: true }),
    });

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(SetupWizard, { onComplete }));
    });

    await clickButton('setupWizard.next');
    await clickModeCard('Claude-Compatible API');
    await clickButton('setupWizard.next');
    await enterApiKey('sk-anthropic');
    await clickButton('setupWizard.finish');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      runtimeBackend: 'claude-compatible-api',
      runtimeProvider: 'anthropic',
      apiProvider: 'anthropic',
      authPriority: 'apiKey',
      apiBaseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-anthropic',
    });
    expect(container.textContent).toContain('setupWizard.usage.title');
    expect(onComplete).not.toHaveBeenCalled();
  });
});
