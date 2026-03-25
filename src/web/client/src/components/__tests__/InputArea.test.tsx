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

describe('InputArea compact composer', () => {
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

  function openMorePanel() {
    fireEvent.click(screen.getByLabelText('toggle input more panel'));
  }

  it('支持的模型下展示可操作的思考档位选择', () => {
    const props = renderInputArea({
      thinkingConfig: {
        enabled: true,
        level: 'medium',
      },
    });

    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;

    expect(levelSelect.disabled).toBe(false);
    expect(levelSelect.value).toBe('medium');
    expect(screen.getByRole('option', { name: 'input.thinkingLevel.high' })).toBeTruthy();

    fireEvent.change(levelSelect, { target: { value: 'high' } });
    expect(props.onThinkingLevelChange).toHaveBeenCalledWith('high');

    fireEvent.change(levelSelect, { target: { value: 'off' } });
    expect(props.onThinkingEnabledChange).toHaveBeenCalledWith(false);
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

  it('不支持的模型下禁用思考选择器', () => {
    renderInputArea({
      model: 'kimi-k2.5',
      runtimeBackend: 'openai-compatible-api',
      thinkingConfig: {
        enabled: true,
        level: 'high',
      },
    });

    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;
    expect(levelSelect.disabled).toBe(true);
  });

  it('关闭思考时首层选择器回到 off', () => {
    renderInputArea({
      thinkingConfig: {
        enabled: false,
        level: 'low',
      },
    });

    const levelSelect = screen.getByRole('combobox', { name: 'input.thinkingLevel' }) as HTMLSelectElement;
    expect(levelSelect.value).toBe('off');
  });

  it('默认只展示首层控制，更多抽屉折叠', () => {
    renderInputArea({
      input: 'hello',
    });

    expect(screen.getByLabelText('toggle input more panel').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTitle('input.attach')).toBeTruthy();
    expect(screen.getByTitle('input.send')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'input.switchModel' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'input.thinkingLevel' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'input.permissionMode' })).toBeTruthy();
    expect(screen.queryByTitle('input.pinLock')).toBeNull();
    expect(screen.queryByTitle('input.debugProbe')).toBeNull();
    expect(screen.queryByTitle('input.logs')).toBeNull();
  });

  it('展开更多后显示次级工具和状态信息', () => {
    renderInputArea({
      hasCompactBoundary: true,
      hasMessages: true,
      onNewSession: vi.fn(),
    });

    openMorePanel();

    const controlStrip = screen.getByLabelText('input primary controls');
    expect(screen.queryByLabelText('input more panel')).toBeNull();
    expect(controlStrip.contains(screen.getByTitle('input.pinLock'))).toBe(true);
    expect(controlStrip.contains(screen.getByTitle('input.debugProbe'))).toBe(true);
    expect(controlStrip.contains(screen.getByTitle('input.logs'))).toBe(true);
    expect(screen.getByText('input.gitShort')).toBeTruthy();
    expect(screen.getByText('input.terminalShort')).toBeTruthy();
    expect(screen.getByText('nav.startNewChat')).toBeTruthy();
    expect(controlStrip.contains(screen.getByTestId('context-bar'))).toBe(true);
    expect(controlStrip.contains(screen.getByTestId('api-usage-bar'))).toBe(true);
  });
});
