/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as ClientReact from '../../src/web/client/node_modules/react/index.js';
import { createRoot } from '../../src/web/client/node_modules/react-dom/client.js';
import ProjectSelector from '../../src/web/client/src/components/swarm/ProjectSelector/ProjectSelector';

const openFolderMock = vi.fn();
const createAppMock = vi.fn();
const switchProjectMock = vi.fn();
const removeProjectMock = vi.fn();

vi.mock('../../src/web/client/src/i18n', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'projectSelector.noProject': '选择项目',
        'projectSelector.createApp': 'AI 帮我做',
        'projectSelector.openFolder': '打开文件夹...',
        'projectSelector.recentProjects': '最近打开',
        'projectSelector.noRecentProjects': '没有最近打开的项目',
        'projectSelector.noRecentProjectsHint': '先点上方“打开文件夹”，切到你的代码目录。',
        'projectSelector.loading': '加载中...',
        'projectSelector.removeFromList': '从列表移除',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('../../src/web/client/src/contexts/ProjectContext', () => ({
  useProject: () => ({
    state: {
      currentProject: null,
      recentProjects: [],
      loading: false,
    },
    switchProject: switchProjectMock,
    removeProject: removeProjectMock,
  }),
}));

describe('ProjectSelector', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null = null;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      ClientReact.act(() => {
        root.unmount();
      });
      root = null;
    }
    container.remove();
    vi.clearAllMocks();
  });

  it('should surface a clear open-folder path when no project is selected', async () => {
    root = createRoot(container);

    await ClientReact.act(async () => {
      root.render(ClientReact.createElement(ProjectSelector, {
        onOpenFolder: openFolderMock,
        onCreateApp: createAppMock,
      }));
    });

    expect(container.textContent).toContain('选择项目');

    const trigger = container.querySelector('button');
    expect(trigger).toBeTruthy();

    await ClientReact.act(async () => {
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('打开文件夹...');
    expect(container.textContent).toContain('先点上方“打开文件夹”，切到你的代码目录。');

    const openFolderButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('打开文件夹...'),
    );

    expect(openFolderButton).toBeTruthy();

    await ClientReact.act(async () => {
      openFolderButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(openFolderMock).toHaveBeenCalledTimes(1);
  });
});
