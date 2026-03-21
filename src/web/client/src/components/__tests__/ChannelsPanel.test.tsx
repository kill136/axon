/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChannelsPanel from '../ChannelsPanel';

const useLanguageMock = vi.fn();

vi.mock('../../i18n', () => ({
  useLanguage: () => useLanguageMock(),
}));

describe('ChannelsPanel', () => {
  beforeEach(() => {
    useLanguageMock.mockReturnValue({
      locale: 'zh',
      setLocale: vi.fn(),
      t: (key: string) => key,
    });
  });

  function renderPanel() {
    const onSendMessage = vi.fn();
    const handlers: Array<(msg: any) => void> = [];
    const addMessageHandler = vi.fn((handler: (msg: any) => void) => {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    });

    render(
      <ChannelsPanel
        onSendMessage={onSendMessage}
        addMessageHandler={addMessageHandler}
        webUiSessionId="web-session-123"
      />,
    );

    const emit = (msg: any) => {
      act(() => {
        handlers.forEach(handler => handler(msg));
      });
    };

    return { onSendMessage, emit };
  }

  it('已配置通道支持禁用和重新启用', () => {
    const { onSendMessage, emit } = renderPanel();

    emit({
      type: 'channel:list',
      payload: {
        channels: [
          {
            id: 'telegram',
            name: 'Telegram',
            status: 'disconnected',
            enabled: true,
            configured: true,
          },
        ],
      },
    });

    onSendMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));

    expect(onSendMessage).toHaveBeenLastCalledWith({
      type: 'channel:config_update',
      payload: {
        channelId: 'telegram',
        config: { enabled: false },
      },
    });

    emit({
      type: 'channel:list',
      payload: {
        channels: [
          {
            id: 'telegram',
            name: 'Telegram',
            status: 'disconnected',
            enabled: false,
            configured: true,
          },
        ],
      },
    });

    expect(screen.getByText('Disabled')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(onSendMessage).toHaveBeenLastCalledWith({
      type: 'channel:config_update',
      payload: {
        channelId: 'telegram',
        config: { enabled: true },
      },
    });
  });

  it('禁用状态下保存配置不会偷偷重新启用', () => {
    const { onSendMessage, emit } = renderPanel();

    emit({
      type: 'channel:list',
      payload: {
        channels: [
          {
            id: 'telegram',
            name: 'Telegram',
            status: 'disconnected',
            enabled: false,
            configured: true,
            savedConfig: {
              credentials: {
                botToken: '1234...',
              },
              allowList: ['user-1'],
              dmPolicy: 'allowlist',
              allowGroups: false,
              groupTrigger: 'mention',
            },
          },
        ],
      },
    });

    onSendMessage.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'channel:config_update',
      payload: expect.objectContaining({
        channelId: 'telegram',
        config: expect.objectContaining({
          enabled: false,
        }),
      }),
    }));
  });
});
