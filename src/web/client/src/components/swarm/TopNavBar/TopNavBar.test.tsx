/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TopNavBar from './index';

const useLanguageMock = vi.fn();

vi.mock('../../../i18n', () => ({
  useLanguage: () => useLanguageMock(),
}));

vi.mock('../ProjectSelector/ProjectSelector', () => ({
  default: ({ className }: { className?: string }) => (
    <div className={className} data-testid="project-selector">project-selector</div>
  ),
}));

vi.mock('../../AuthStatus', () => ({
  AuthStatus: () => <div data-testid="auth-status">auth-status</div>,
}));

describe('TopNavBar header collapse', () => {
  beforeEach(() => {
    localStorage.clear();
    useLanguageMock.mockReturnValue({
      locale: 'zh',
      setLocale: vi.fn(),
      t: (key: string, params?: Record<string, any>) => {
        const dict: Record<string, string> = {
          'nav.chat': '聊天',
          'nav.code': '文件',
          'nav.blueprint': '蓝图',
          'nav.swarm': '蜂群',
          'nav.customize': '工具箱',
          'nav.myApps': '应用',
          'nav.activity': '活动',
          'nav.newSession': '新对话',
          'nav.startNewChat': '开始新对话',
          'nav.recentSessions': '最近会话',
          'nav.noSessions': '暂无会话记录',
          'nav.rename': '重命名',
          'nav.deleteSession': '删除会话',
          'nav.connected': '已连接',
          'nav.disconnected': '未连接',
          'nav.settings': '设置',
          'nav.hideHeader': '隐藏顶部栏',
          'nav.minimize': '最小化',
          'nav.maximize': '最大化',
          'nav.close': '关闭',
          'nav.collapseHeader': '收起顶部栏',
          'nav.expandHeader': '展开顶部栏',
          'nav.showHeader': '显示顶部栏',
          'sessionSearch.placeholder': '搜索会话',
        };

        if (key === 'nav.messageCount') {
          return `${params?.count ?? 0} 条`;
        }
        return dict[key] ?? key;
      },
    });
  });

  function renderTopNavBar(overrides: Partial<React.ComponentProps<typeof TopNavBar>> = {}) {
    const props: React.ComponentProps<typeof TopNavBar> = {
      currentPage: 'chat',
      onPageChange: vi.fn(),
      onSettingsClick: vi.fn(),
      connected: true,
      onLoginClick: vi.fn(),
      authRefreshKey: 1,
      onOpenFolder: vi.fn(),
      sessions: [
        {
          id: 'session-1',
          name: '这个输入框太丑了，你设计一下',
          updatedAt: Date.now(),
          messageCount: 3,
        },
      ],
      sessionStatusMap: new Map(),
      currentSessionId: 'session-1',
      onSessionSelect: vi.fn(),
      onNewSession: vi.fn(),
      onSessionDelete: vi.fn(),
      onSessionRename: vi.fn(),
      onOpenSessionSearch: vi.fn(),
      ...overrides,
    };

    render(<TopNavBar {...props} />);
    return props;
  }

  it('默认展示完整两行顶部栏', () => {
    renderTopNavBar();

    expect(screen.getByRole('button', { name: '聊天' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '文件' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '蓝图' })).toBeTruthy();
    expect(screen.getByTitle('搜索会话 (Ctrl+K)')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏顶部栏' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: '显示顶部栏' })).toBeNull();
  });

  it('点击隐藏后两行整体消失，只剩悬浮恢复按钮', () => {
    renderTopNavBar({ currentPage: 'swarm' });

    fireEvent.click(screen.getByRole('button', { name: '隐藏顶部栏' }));

    expect(screen.queryByRole('button', { name: '聊天' })).toBeNull();
    expect(screen.queryByTitle('搜索会话 (Ctrl+K)')).toBeNull();
    expect(screen.getByRole('button', { name: '显示顶部栏' }).getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('axon.topNavBar.hidden.v1')).toBe('true');
  });

  it('会从 localStorage 恢复隐藏态，并允许再次显示', () => {
    localStorage.setItem('axon.topNavBar.hidden.v1', 'true');

    renderTopNavBar({ currentPage: 'blueprint' });

    expect(screen.getByRole('button', { name: '显示顶部栏' })).toBeTruthy();
    expect(screen.queryByText('蓝图')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '显示顶部栏' }));

    expect(screen.getByRole('button', { name: '隐藏顶部栏' })).toBeTruthy();
    expect(screen.getByText('蓝图')).toBeTruthy();
  });
});
