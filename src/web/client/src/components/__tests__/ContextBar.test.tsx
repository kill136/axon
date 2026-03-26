/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBar } from '../ContextBar';

const useLanguageMock = vi.fn();

vi.mock('../../i18n', () => ({
  useLanguage: () => useLanguageMock(),
}));

describe('ContextBar', () => {
  beforeEach(() => {
    useLanguageMock.mockReturnValue({
      locale: 'zh',
      setLocale: vi.fn(),
      t: (key: string, params?: Record<string, string | number>) => {
        if (key === 'context.savedTokens' && params?.tokens !== undefined) {
          return `已节省 ${params.tokens} tokens`;
        }
        return key;
      },
    });
  });

  it('在 idle 且还未收到 usage 时仍显示 ctx 占位', () => {
    const { container } = render(
      <ContextBar usage={null} compactState={{ phase: 'idle' }} />
    );

    expect(screen.getByText('ctx')).toBeTruthy();
    expect(container.querySelector('.context-bar--placeholder')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('有 usage 时显示百分比和 token 详情', () => {
    render(
      <ContextBar
        usage={{
          usedTokens: 12500,
          maxTokens: 200000,
          percentage: 63,
          model: 'gpt-5.4',
        }}
        compactState={{ phase: 'idle' }}
      />
    );

    expect(screen.getByText('ctx')).toBeTruthy();
    expect(screen.getByText('63%')).toBeTruthy();
    expect(screen.getByText('13k/200k')).toBeTruthy();
  });
});
