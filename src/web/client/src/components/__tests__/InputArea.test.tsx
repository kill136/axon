/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputArea } from '../InputArea';

const useLanguageMock = vi.fn();

vi.mock('../../i18n', () => ({
  useLanguage: () => useLanguageMock(),
}));

vi.mock('../ContextBar', () => ({
  ContextBar: () => <div data-testid="context-bar" />,
}));

vi.mock('../ApiUsageBar', () => ({
  ApiUsageBar: () => <div data-testid="api-usage-bar" />,
}));

vi.mock('../SlashCommandPalette', () => ({
  SlashCommandPalette: () => <div data-testid="slash-command-palette" />,
}));

describe('InputArea thinking controls', () => {
  beforeEach(() => {
    useLanguageMock.mockReturnValue({
      locale: 'zh',
      setLocale: vi.fn(),
      t: (key: string) => key,
    });
  });

  function renderInputArea(overrides: Partial<React.ComponentProps<typeof InputArea>> = {}) {
    const props: React.ComponentProps<typeof InputArea> = {
      input: '',
      onInputChange: vi.fn(),
      onKeyDown: vi.fn(),
      onPaste: vi.fn(),
      inputRef: React.createRef<HTMLTextAreaElement>(),
      fileInputRef: React.createRef<HTMLInputElement>(),
      attachments: [],
      onRemoveAttachment: vi.fn(),
      onImageEditStrengthChange: vi.fn(),
      onFileSelect: vi.fn(),
      showCommandPalette: false,
      onCommandSelect: vi.fn(),
      onCloseCommandPalette: vi.fn(),
      connected: true,
      status: 'idle',
      model: 'gpt-5-codex',
      runtimeProvider: 'codex',
      runtimeBackend: 'codex-subscription',
      onModelChange: vi.fn(),
      thinkingConfig: {
        enabled: true,
        level: 'medium',
      },
      onThinkingEnabledChange: vi.fn(),
      onThinkingLevelChange: vi.fn(),
      permissionMode: 'default' as any,
      activePresetId: 'default',
      onPresetChange: vi.fn(),
      onSend: vi.fn(),
      onCancel: vi.fn(),
      isPinned: false,
      onTogglePin: vi.fn(),
      contextUsage: null,
      compactState: { phase: 'idle' },
      rateLimitInfo: null,
      hasCompactBoundary: false,
      isTranscriptMode: false,
      onToggleTranscriptMode: vi.fn(),
      showTerminal: false,
      onToggleTerminal: vi.fn(),
      onOpenDebugPanel: vi.fn(),
      onOpenGitPanel: vi.fn(),
      onOpenLogsPanel: vi.fn(),
      ...overrides,
    };

    render(<InputArea {...props} />);
    return props;
  }

  it('支持的模型下展示可操作的思考开关和强度选择', () => {
    const props = renderInputArea({
      thinkingConfig: {
        enabled: true,
        level: 'medium',
      },
    });

    const toggle = screen.getByRole('button', { name: 'input.thinkingToggle' }) as HTMLButtonElement;
    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;

    expect(toggle.disabled).toBe(false);
    expect(levelSelect.disabled).toBe(false);
    expect(levelSelect.value).toBe('medium');
    expect(screen.getByRole('option', { name: 'input.thinkingLevel.high' })).toBeTruthy();

    fireEvent.click(toggle);
    expect(props.onThinkingEnabledChange).toHaveBeenCalledWith(false);

    fireEvent.change(levelSelect, { target: { value: 'high' } });
    expect(props.onThinkingLevelChange).toHaveBeenCalledWith('high');
  });

  it('GPT-5.4 下展示 xhigh 档位', () => {
    renderInputArea({
      model: 'gpt-5.4',
      runtimeBackend: 'openai-compatible-api',
      thinkingConfig: {
        enabled: true,
        level: 'xhigh',
      },
    });

    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;
    expect(levelSelect.value).toBe('xhigh');
    expect(screen.getByRole('option', { name: 'input.thinkingLevel.xhigh' })).toBeTruthy();
  });

  it('不支持的模型下禁用思考控件', () => {
    renderInputArea({
      model: 'kimi-k2.5',
      runtimeBackend: 'openai-compatible-api',
      thinkingConfig: {
        enabled: true,
        level: 'high',
      },
    });

    const toggle = screen.getByRole('button', { name: 'input.thinkingToggle' }) as HTMLButtonElement;
    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;

    expect(toggle.disabled).toBe(true);
    expect(levelSelect.disabled).toBe(true);
  });

  it('关闭思考时仍保留强度值但禁用强度选择', () => {
    renderInputArea({
      thinkingConfig: {
        enabled: false,
        level: 'low',
      },
    });

    const toggle = screen.getByRole('button', { name: 'input.thinkingToggle' });
    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(levelSelect.value).toBe('low');
    expect(levelSelect.disabled).toBe(true);
  });

  it('图片附件展示编辑强度选择并响应变更', () => {
    const props = renderInputArea({
      attachments: [
        {
          id: 'img-1',
          name: 'flower.png',
          type: 'image',
          mimeType: 'image/png',
          data: 'data:image/png;base64,abc',
          imageEditStrength: 'medium',
        },
      ],
    });

    const select = screen.getByRole('combobox', { name: 'input.imageEditStrength flower.png' }) as HTMLSelectElement;
    expect(select.value).toBe('medium');

    fireEvent.change(select, { target: { value: 'high' } });
    expect(props.onImageEditStrengthChange).toHaveBeenCalledWith('img-1', 'high');
  });
});
