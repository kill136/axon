/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';

const useLanguageMock = vi.fn();
const useNotificationSoundMock = vi.fn();
const getWebModelOptionsMock = vi.fn();
const getWebModelOptionsForBackendMock = vi.fn();
const normalizeWebRuntimeModelMock = vi.fn();
const normalizeWebRuntimeModelForBackendMock = vi.fn();
const getRuntimeBackendLabelMock = vi.fn();
const supportsDynamicModelCatalogForBackendMock = vi.fn();
const resolveBackendDefaultModelMock = vi.fn();
const upsertBackendDefaultModelMock = vi.fn();
const getSetupRuntimeOptionsMock = vi.fn();

vi.mock('../../i18n', () => ({
  useLanguage: () => useLanguageMock(),
}));

vi.mock('../../hooks/useNotificationSound', () => ({
  useNotificationSound: () => useNotificationSoundMock(),
}));

vi.mock('../../../../shared/model-catalog', () => ({
  getRuntimeBackendLabel: (...args: unknown[]) => getRuntimeBackendLabelMock(...args),
  getWebModelOptions: (...args: unknown[]) => getWebModelOptionsMock(...args),
  getWebModelOptionsForBackend: (...args: unknown[]) => getWebModelOptionsForBackendMock(...args),
  normalizeWebRuntimeModelForBackend: (...args: unknown[]) => normalizeWebRuntimeModelForBackendMock(...args),
  normalizeWebRuntimeModel: (...args: unknown[]) => normalizeWebRuntimeModelMock(...args),
  supportsDynamicModelCatalogForBackend: (...args: unknown[]) => supportsDynamicModelCatalogForBackendMock(...args),
}));

vi.mock('../../../../shared/model-preferences', () => ({
  resolveBackendDefaultModel: (...args: unknown[]) => resolveBackendDefaultModelMock(...args),
  upsertBackendDefaultModel: (...args: unknown[]) => upsertBackendDefaultModelMock(...args),
}));

vi.mock('../../../../shared/setup-runtime', () => ({
  getSetupRuntimeOptions: (...args: unknown[]) => getSetupRuntimeOptionsMock(...args),
}));

describe('SettingsPanel', () => {
  beforeEach(() => {
    useLanguageMock.mockReturnValue({
      locale: 'zh',
      setLocale: vi.fn(),
      t: (key: string) => key,
    });
    useNotificationSoundMock.mockReturnValue({
      play: vi.fn(),
      isEnabled: () => true,
      setEnabled: vi.fn(),
      getVolume: () => 0.5,
      setVolume: vi.fn(),
    });
    getWebModelOptionsMock.mockReturnValue([
      { value: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'Codex model' },
    ]);
    getWebModelOptionsForBackendMock.mockReturnValue([
      { value: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'Codex model' },
    ]);
    normalizeWebRuntimeModelMock.mockImplementation((_provider: string, model: string) => model);
    normalizeWebRuntimeModelForBackendMock.mockImplementation((_backend: string, model: string) => model);
    getRuntimeBackendLabelMock.mockImplementation((backend: string) => backend);
    supportsDynamicModelCatalogForBackendMock.mockImplementation((backend: string) => (
      backend === 'axon-cloud' || backend === 'openai-compatible-api'
    ));
    resolveBackendDefaultModelMock.mockImplementation((backend: string, map?: Record<string, string>, fallback?: string) => (
      map?.[backend] || fallback || 'gpt-5-codex'
    ));
    upsertBackendDefaultModelMock.mockImplementation((map: Record<string, string> = {}, backend: string, model: string) => ({
      ...map,
      [backend]: model,
    }));
    getSetupRuntimeOptionsMock.mockReturnValue([
      { backend: 'axon-cloud', icon: '☁️', recommended: true },
      { backend: 'claude-subscription', icon: '🔐' },
      { backend: 'claude-compatible-api', icon: '🔑' },
      { backend: 'codex-subscription', icon: '🧠' },
      { backend: 'openai-compatible-api', icon: '🌐' },
    ]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runtimeBackend: 'codex-subscription',
          defaultModelByBackend: {},
          customModelCatalogByBackend: {},
        },
      }),
    }) as unknown as typeof fetch;
  });

  it('在关闭时不渲染内容且不会调用内部 hooks', () => {
    render(
      <SettingsPanel
        isOpen={false}
        onClose={vi.fn()}
        model="gpt-5-codex"
        runtimeProvider="codex"
        runtimeBackend="codex-subscription"
        onModelChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('settings.title')).toBeNull();
    expect(useLanguageMock).not.toHaveBeenCalled();
    expect(useNotificationSoundMock).not.toHaveBeenCalled();
  });

  it('从关闭切换到打开时保持稳定并调用内部 hooks', async () => {
    const { rerender } = render(
      <SettingsPanel
        isOpen={false}
        onClose={vi.fn()}
        model="gpt-5-codex"
        runtimeProvider="codex"
        runtimeBackend="codex-subscription"
        onModelChange={vi.fn()}
      />,
    );

    await act(async () => {
      rerender(
        <SettingsPanel
          isOpen={true}
          onClose={vi.fn()}
          model="gpt-5-codex"
          runtimeProvider="codex"
          runtimeBackend="codex-subscription"
          onModelChange={vi.fn()}
        />,
      );
    });

    expect(screen.getByText('settings.title')).toBeTruthy();
    expect(useLanguageMock.mock.calls.length).toBeGreaterThan(0);
    expect(useNotificationSoundMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('使用共享 setup runtime 选项渲染默认模型 backend 列表', async () => {
    const { container } = render(
      <SettingsPanel
        isOpen={true}
        onClose={vi.fn()}
        model="gpt-5-codex"
        runtimeProvider="codex"
        runtimeBackend="codex-subscription"
        onModelChange={vi.fn()}
      />,
    );

    await act(async () => {
      screen.getByText('settings.tab.model').click();
    });

    const selects = container.querySelectorAll('select');
    const managedBackendSelect = selects.item(1) as HTMLSelectElement | null;
    expect(managedBackendSelect).not.toBeNull();

    const optionValues = Array.from(managedBackendSelect?.querySelectorAll('option') || []).map(option => option.value);
    expect(optionValues).toEqual([
      'axon-cloud',
      'claude-subscription',
      'claude-compatible-api',
      'codex-subscription',
      'openai-compatible-api',
    ]);
  });

  it('为已保存的 backend 动态模型目录复用共享模型选项规则', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runtimeBackend: 'codex-subscription',
          defaultModelByBackend: {
            'axon-cloud': 'gpt-4o',
          },
          customModelCatalogByBackend: {
            'axon-cloud': ['gpt-4o', 'deepseek-v3'],
          },
        },
      }),
    });

    const { container } = render(
      <SettingsPanel
        isOpen={true}
        onClose={vi.fn()}
        model="gpt-5-codex"
        runtimeProvider="codex"
        runtimeBackend="codex-subscription"
        onModelChange={vi.fn()}
      />,
    );

    await act(async () => {
      screen.getByText('settings.tab.model').click();
    });

    const selects = container.querySelectorAll('select');
    const managedBackendSelect = selects.item(1) as HTMLSelectElement | null;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    expect(managedBackendSelect).not.toBeNull();
    expect(valueSetter).toBeTruthy();

    await act(async () => {
      valueSetter!.call(managedBackendSelect, 'axon-cloud');
      managedBackendSelect!.dispatchEvent(new Event('input', { bubbles: true }));
      managedBackendSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await waitFor(() => {
      expect(getWebModelOptionsForBackendMock).toHaveBeenCalledWith(
        'axon-cloud',
        'gpt-4o',
        'gpt-4o',
        ['gpt-4o', 'deepseek-v3'],
      );
    });
  });

  it('对动态 backend 即使当前 provider 是 anthropic 也展示 runtime 模型卡片', async () => {
    getWebModelOptionsForBackendMock.mockReturnValue([
      { value: 'opus', label: 'Opus', description: 'Axon Claude runtime' },
      { value: 'gpt-5.4', label: 'GPT-5.4', description: 'Axon GPT runtime' },
    ]);

    render(
      <SettingsPanel
        isOpen={true}
        onClose={vi.fn()}
        model="opus"
        runtimeProvider="anthropic"
        runtimeBackend="axon-cloud"
        onModelChange={vi.fn()}
      />,
    );

    await act(async () => {
      screen.getByText('settings.tab.model').click();
    });

    expect(screen.getByText('Axon Claude runtime')).toBeTruthy();
    expect(screen.getByText('Axon GPT runtime')).toBeTruthy();
    expect(screen.queryByText('settings.model.opus.title')).toBeNull();
  });
});
