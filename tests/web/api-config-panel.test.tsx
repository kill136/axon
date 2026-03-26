/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiConfigPanel } from '../../src/web/client/src/components/config/ApiConfigPanel';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

function createJsonResponse(data: any) {
  return {
    json: async () => data,
  };
}

describe('ApiConfigPanel', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
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

  it('renders saved model context window overrides as formatted JSON', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({
      success: true,
      data: {
        modelContextWindowById: {
          'gpt-5.4': 280000,
          'gpt-5.4-mini': 400000,
        },
      },
    }));

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ApiConfigPanel));
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain('"gpt-5.4": 280000');
    expect(textarea?.value).toContain('"gpt-5.4-mini": 400000');
  });

  it('parses model context window overrides before saving', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ success: true, data: {} }))
      .mockResolvedValueOnce(createJsonResponse({ success: true }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          modelContextWindowById: {
            'gpt-5.4': 280000,
          },
        },
      }));

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ApiConfigPanel));
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    expect(textarea).not.toBeNull();
    expect(valueSetter).toBeTruthy();

    await ClientReact.act(async () => {
      valueSetter!.call(textarea, '{\n  "gpt-5.4": 280000,\n  "custom-model": 262144\n}');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      textarea!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveButton = findButton('apiConfig.save');
    expect(saveButton).toBeTruthy();

    await ClientReact.act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();

    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.modelContextWindowById).toEqual({
      'gpt-5.4': 1000000,
      'custom-model': 262144,
    });
  });

  it('shows a validation error for invalid override JSON and skips saving', async () => {
    fetchMock.mockResolvedValueOnce(createJsonResponse({ success: true, data: {} }));

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ApiConfigPanel));
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    expect(textarea).not.toBeNull();
    expect(valueSetter).toBeTruthy();

    await ClientReact.act(async () => {
      valueSetter!.call(textarea, '{"gpt-5.4": "not-a-number"}');
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      textarea!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveButton = findButton('apiConfig.save');
    expect(saveButton).toBeTruthy();

    await ClientReact.act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('apiConfig.modelContextWindowById.error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hydrates dynamic model catalogs from /api/models for openai-compatible backends', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          runtimeBackend: 'openai-compatible-api',
          defaultModelByBackend: {
            'openai-compatible-api': 'gpt-5.4',
          },
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        runtimeBackend: 'openai-compatible-api',
        models: [
          { modelId: 'deepseek-v3' },
          { modelId: 'qwen-max' },
        ],
      }));

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ApiConfigPanel));
    });

    const selects = container.querySelectorAll('select');
    const modelSelect = selects.item(1) as HTMLSelectElement | null;
    expect(modelSelect).not.toBeNull();

    const optionValues = Array.from(modelSelect?.querySelectorAll('option') || []).map(option => option.value);
    expect(optionValues).toContain('deepseek-v3');
    expect(optionValues).toContain('qwen-max');
  });

  it('persists discovered runtime model catalogs after a successful connection test', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          runtimeBackend: 'openai-compatible-api',
          apiKey: 'sk-open...1234',
          apiBaseUrl: 'https://openrouter.ai/api/v1',
          apiProvider: 'openai-compatible',
          defaultModelByBackend: {
            'openai-compatible-api': 'gpt-5.4',
          },
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        runtimeBackend: 'openai-compatible-api',
        models: [],
      }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          model: 'deepseek-v3',
          baseUrl: 'https://openrouter.ai/api/v1',
          availableModels: ['deepseek-v3', 'qwen-max'],
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({ success: true }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          runtimeBackend: 'openai-compatible-api',
          defaultModelByBackend: {
            'openai-compatible-api': 'gpt-5.4',
          },
          customModelCatalogByBackend: {
            'openai-compatible-api': ['deepseek-v3', 'qwen-max'],
          },
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({
        runtimeBackend: 'openai-compatible-api',
        models: [
          { modelId: 'deepseek-v3' },
          { modelId: 'qwen-max' },
        ],
      }));

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ApiConfigPanel));
    });

    const testButton = findButton('apiConfig.testConnection');
    expect(testButton).toBeTruthy();

    await ClientReact.act(async () => {
      testButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const saveButton = findButton('apiConfig.save');
    expect(saveButton).toBeTruthy();

    await ClientReact.act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();

    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.customModelCatalogByBackend).toEqual({
      'openai-compatible-api': ['deepseek-v3', 'qwen-max'],
    });
  });

  it('preserves claude-compatible provider variants when syncing models', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          runtimeBackend: 'claude-compatible-api',
          runtimeProvider: 'anthropic',
          apiProvider: 'bedrock',
          authPriority: 'apiKey',
          customModelName: 'haiku',
          defaultModelByBackend: {
            'claude-compatible-api': 'sonnet',
          },
        },
      }))
      .mockResolvedValueOnce(createJsonResponse({ success: true }))
      .mockResolvedValueOnce(createJsonResponse({
        success: true,
        data: {
          runtimeBackend: 'claude-compatible-api',
          runtimeProvider: 'anthropic',
          apiProvider: 'bedrock',
          authPriority: 'apiKey',
          customModelName: 'haiku',
          defaultModelByBackend: {
            'claude-compatible-api': 'haiku',
          },
        },
      }));

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ApiConfigPanel));
    });

    const selects = container.querySelectorAll('select');
    const modelSelect = selects.item(1) as HTMLSelectElement | null;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    expect(modelSelect).not.toBeNull();
    expect(valueSetter).toBeTruthy();

    await ClientReact.act(async () => {
      valueSetter!.call(modelSelect, 'haiku');
      modelSelect!.dispatchEvent(new Event('input', { bubbles: true }));
      modelSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const saveButton = findButton('apiConfig.save');
    expect(saveButton).toBeTruthy();

    await ClientReact.act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(putCall).toBeDefined();

    const payload = JSON.parse(String(putCall?.[1]?.body));
    expect(payload.runtimeBackend).toBe('claude-compatible-api');
    expect(payload.runtimeProvider).toBe('anthropic');
    expect(payload.apiProvider).toBe('bedrock');
    expect(payload.authPriority).toBe('apiKey');
    expect(payload.customModelName).toBe('haiku');
    expect(payload.defaultModelByBackend).toEqual({
      'claude-compatible-api': 'haiku',
    });
  });
});
