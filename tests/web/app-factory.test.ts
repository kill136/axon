/**
 * Tests for AppFactory — AI 应用工厂核心模块
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AppFactory, getAppGeneratorSystemPrompt } from '../../src/web/server/app-factory.js';

describe('AppFactory', () => {
  let factory: AppFactory;
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'appfactory-test-'));
    factory = new AppFactory(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('构造函数', () => {
    it('应该创建 apps 目录', () => {
      const appsDir = path.join(testDir, 'apps');
      expect(fs.existsSync(appsDir)).toBe(true);
    });

    it('初始应用列表应为空', () => {
      expect(factory.listApps()).toEqual([]);
    });

    it('应该在指定目录下创建 manifest', () => {
      factory.createApp('test', 'test desc', 'session-1');
      const manifestPath = path.join(testDir, 'apps', 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
    });
  });

  describe('createApp', () => {
    it('应该创建新应用并返回正确结构', () => {
      const app = factory.createApp('测试应用', '做一个记账本', 'session-1');
      
      expect(app.id).toBeTruthy();
      expect(app.name).toBe('测试应用');
      expect(app.description).toBe('做一个记账本');
      expect(app.status).toBe('creating');
      expect(app.sessionId).toBe('session-1');
      expect(app.previewUrl).toBe(`/apps/${app.id}/index.html`);
      expect(app.createdAt).toBeTruthy();
      expect(app.updatedAt).toBeTruthy();
    });

    it('应该为应用创建独立目录', () => {
      const app = factory.createApp('测试', '描述', 'session-1');
      const appDir = path.join(testDir, 'apps', app.id);
      expect(fs.existsSync(appDir)).toBe(true);
    });

    it('默认 workingDirectory 应该是 ~/.axon/apps/{id}', () => {
      const app = factory.createApp('测试', '描述', 'session-1');
      expect(app.workingDirectory).toBe(path.join(testDir, 'apps', app.id));
    });

    it('应该支持自定义 workingDirectory', () => {
      const customDir = path.join(os.tmpdir(), 'custom-app-dir-' + Date.now());
      try {
        const app = factory.createApp('测试', '描述', 'session-1', undefined, customDir);
        expect(app.workingDirectory).toBe(customDir);
        expect(fs.existsSync(customDir)).toBe(true);
        // 元数据目录也应该创建
        expect(fs.existsSync(path.join(testDir, 'apps', app.id))).toBe(true);
      } finally {
        if (fs.existsSync(customDir)) {
          fs.rmSync(customDir, { recursive: true, force: true });
        }
      }
    });

    it('应该自动匹配图标', () => {
      const game = factory.createApp('贪吃蛇', '做一个贪吃蛇游戏', 'session-1');
      expect(game.icon).toBe('🎮');

      const note = factory.createApp('笔记', '做一个笔记本', 'session-2');
      expect(note.icon).toBe('📝');

      const generic = factory.createApp('something', 'xyz', 'session-3');
      expect(generic.icon).toBe('✨');
    });

    it('应该支持自定义图标', () => {
      const app = factory.createApp('测试', '描述', 'session-1', '🚀');
      expect(app.icon).toBe('🚀');
    });
  });

  describe('listApps', () => {
    it('应该返回所有应用', () => {
      factory.createApp('App 1', 'desc 1', 's1');
      factory.createApp('App 2', 'desc 2', 's2');
      factory.createApp('App 3', 'desc 3', 's3');

      const list = factory.listApps();
      expect(list).toHaveLength(3);
      const names = list.map(a => a.name);
      expect(names).toContain('App 1');
      expect(names).toContain('App 2');
      expect(names).toContain('App 3');
    });

    it('更新后的应用应排在前面', () => {
      const app1 = factory.createApp('App 1', 'desc 1', 's1');
      factory.createApp('App 2', 'desc 2', 's2');

      // 手动更新 app1 让它的 updatedAt 最新
      factory.updateAppMeta(app1.id, { name: 'App 1 Updated' });

      const list = factory.listApps();
      expect(list[0].name).toBe('App 1 Updated');
    });
  });

  describe('getApp', () => {
    it('应该返回指定 ID 的应用', () => {
      const app = factory.createApp('测试', '描述', 's1');
      const found = factory.getApp(app.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('测试');
    });

    it('不存在的 ID 应返回 undefined', () => {
      expect(factory.getApp('nonexistent')).toBeUndefined();
    });
  });

  describe('updateAppMeta', () => {
    it('应该更新应用名称', () => {
      const app = factory.createApp('旧名称', '描述', 's1');
      const updated = factory.updateAppMeta(app.id, { name: '新名称' });
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('新名称');
    });

    it('应该更新状态', () => {
      const app = factory.createApp('测试', '描述', 's1');
      expect(app.status).toBe('creating');

      factory.updateAppMeta(app.id, { status: 'ready' });
      const updated = factory.getApp(app.id);
      expect(updated!.status).toBe('ready');
    });

    it('应该更新 updatedAt', () => {
      const app = factory.createApp('测试', '描述', 's1');
      const originalUpdatedAt = app.updatedAt;

      // 确保时间差
      const updated = factory.updateAppMeta(app.id, { name: '新' });
      expect(updated!.updatedAt).toBeTruthy();
    });

    it('不存在的 ID 应返回 undefined', () => {
      expect(factory.updateAppMeta('nonexistent', { name: 'x' })).toBeUndefined();
    });
  });

  describe('writeAppFile', () => {
    it('应该成功写入文件', () => {
      const app = factory.createApp('测试', '描述', 's1');
      const success = factory.writeAppFile(app.id, 'index.html', '<h1>Hello</h1>');
      expect(success).toBe(true);

      const filePath = path.join(testDir, 'apps', app.id, 'index.html');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('<h1>Hello</h1>');
    });

    it('写入 index.html 应将状态更新为 ready', () => {
      const app = factory.createApp('测试', '描述', 's1');
      expect(app.status).toBe('creating');

      factory.writeAppFile(app.id, 'index.html', '<h1>Done</h1>');
      const updated = factory.getApp(app.id);
      expect(updated!.status).toBe('ready');
    });

    it('写入非 index.html 文件不应改变状态', () => {
      const app = factory.createApp('测试', '描述', 's1');
      factory.writeAppFile(app.id, 'style.css', 'body {}');
      const updated = factory.getApp(app.id);
      expect(updated!.status).toBe('creating');
    });

    it('应该阻止路径穿越攻击', () => {
      const app = factory.createApp('测试', '描述', 's1');
      const success = factory.writeAppFile(app.id, '../../../evil.txt', 'malicious');
      expect(success).toBe(false);
    });

    it('不存在的应用应返回 false', () => {
      expect(factory.writeAppFile('nonexistent', 'index.html', 'x')).toBe(false);
    });

    it('应该支持子目录', () => {
      const app = factory.createApp('测试', '描述', 's1');
      const success = factory.writeAppFile(app.id, 'assets/logo.svg', '<svg></svg>');
      expect(success).toBe(true);

      const filePath = path.join(testDir, 'apps', app.id, 'assets', 'logo.svg');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('readAppFile', () => {
    it('应该读取已写入的文件', () => {
      const app = factory.createApp('测试', '描述', 's1');
      factory.writeAppFile(app.id, 'index.html', '<h1>Test</h1>');
      
      const content = factory.readAppFile(app.id, 'index.html');
      expect(content).toBe('<h1>Test</h1>');
    });

    it('不存在的文件应返回 null', () => {
      const app = factory.createApp('测试', '描述', 's1');
      expect(factory.readAppFile(app.id, 'nonexistent.html')).toBeNull();
    });

    it('应该阻止路径穿越', () => {
      const app = factory.createApp('测试', '描述', 's1');
      expect(factory.readAppFile(app.id, '../../../etc/passwd')).toBeNull();
    });
  });

  describe('deleteApp', () => {
    it('应该删除应用和文件', () => {
      const app = factory.createApp('测试', '描述', 's1');
      factory.writeAppFile(app.id, 'index.html', '<h1>Gone</h1>');

      const success = factory.deleteApp(app.id);
      expect(success).toBe(true);
      expect(factory.getApp(app.id)).toBeUndefined();
      expect(factory.listApps()).toHaveLength(0);

      const appDir = path.join(testDir, 'apps', app.id);
      expect(fs.existsSync(appDir)).toBe(false);
    });

    it('不存在的 ID 应返回 false', () => {
      expect(factory.deleteApp('nonexistent')).toBe(false);
    });
  });

  describe('getAppDir / getAppsDir', () => {
    it('getAppsDir 应返回 apps 根目录', () => {
      expect(factory.getAppsDir()).toBe(path.join(testDir, 'apps'));
    });

    it('getAppDir 默认应返回 apps/{id} 目录', () => {
      const app = factory.createApp('测试', '描述', 's1');
      expect(factory.getAppDir(app.id)).toBe(path.join(testDir, 'apps', app.id));
    });

    it('getAppDir 有自定义目录时应返回自定义目录', () => {
      const customDir = path.join(os.tmpdir(), 'custom-getappdir-' + Date.now());
      try {
        const app = factory.createApp('测试', '描述', 's1', undefined, customDir);
        expect(factory.getAppDir(app.id)).toBe(customDir);
      } finally {
        if (fs.existsSync(customDir)) {
          fs.rmSync(customDir, { recursive: true, force: true });
        }
      }
    });
  });

  describe('持久化', () => {
    it('重新加载应保留已创建的应用', () => {
      factory.createApp('App 1', 'desc 1', 's1');
      factory.createApp('App 2', 'desc 2', 's2');

      // 创建新实例（模拟进程重启）
      const factory2 = new AppFactory(testDir);
      const apps = factory2.listApps();
      expect(apps).toHaveLength(2);
      expect(apps.find(a => a.name === 'App 1')).toBeDefined();
      expect(apps.find(a => a.name === 'App 2')).toBeDefined();
    });

    it('损坏的 manifest 应重置为空', () => {
      const manifestPath = path.join(testDir, 'apps', 'manifest.json');
      fs.writeFileSync(manifestPath, '{ invalid json', 'utf-8');

      const factory2 = new AppFactory(testDir);
      expect(factory2.listApps()).toEqual([]);
    });
  });
});

describe('getAppGeneratorSystemPrompt', () => {
  it('应该包含应用名称和目录', () => {
    const prompt = getAppGeneratorSystemPrompt('/path/to/app', '我的应用');
    expect(prompt).toContain('我的应用');
    expect(prompt).toContain('/path/to/app');
    expect(prompt).toContain('index.html');
    expect(prompt).toContain('Tailwind CSS');
  });

  it('应该要求使用 Write 工具', () => {
    const prompt = getAppGeneratorSystemPrompt('/tmp/app', 'Test');
    expect(prompt).toContain('Write');
  });
});
