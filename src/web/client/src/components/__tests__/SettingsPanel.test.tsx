/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { SettingsPanel } from '../SettingsPanel';

const useLanguageMock = vi.fn();
const useNotificationSoundMock = vi.fn();
const getWebModelOptionsMock = vi.fn();
const getWebModelOptionsForBackendMock = vi.fn();
const normalizeWebRuntimeModelMock = vi.fn();
const normalizeWebRuntimeModelForBackendMock = vi.fn();
const getRuntimeBackendLabelMock = vi.fn();
const resolveBackendDefaultModelMock = vi.fn();
const upsertBackendDefaultModelMock = vi.fn();

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
}));

vi.mock('../../../../shared/model-preferences', () => ({
  resolveBackendDefaultModel: (...args: unknown[]) => resolveBackendDefaultModelMock(...args),
  upsertBackendDefaultModel: (...args: unknown[]) => upsertBackendDefaultModelMock(...args),
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
    resolveBackendDefaultModelMock.mockImplementation((_backend: string, _map: unknown, fallback?: string) => fallback || 'gpt-5-codex');
    upsertBackendDefaultModelMock.mockImplementation((map: Record<string, string> = {}, backend: string, model: string) => ({
      ...map,
      [backend]: model,
    }));
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          runtimeBackend: 'codex-subscription',
          defaultModelByBackend: {},
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
});
