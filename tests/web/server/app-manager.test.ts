/**
 * AppManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock fs 和 child_process
vi.mock('fs');
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter();
    proc.pid = 12345;
    proc.killed = false;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }),
}));

describe('AppManager', () => {
  let AppManager: any;
  let manager: any;
  const appsDir = path.join(os.homedir(), '.axon', 'apps');

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock fs operations
    const mockFs = vi.mocked(fs);
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([] as any);
    mockFs.mkdirSync.mockReturnValue(undefined as any);
    mockFs.writeFileSync.mockReturnValue(undefined);
    mockFs.unlinkSync.mockReturnValue(undefined);
    mockFs.readFileSync.mockReturnValue('{}');

    // Dynamic import to get fresh module
    const mod = await import('../../../src/web/server/app-manager.js');
    AppManager = mod.AppManager;
    manager = new AppManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('register', () => {
    it('should register a new app with all required fields', () => {
      const app = manager.register({
        name: 'Test App',
        description: 'A test application',
        directory: '/tmp/test-app',
        startCommand: 'npm run dev',
        port: 3000,
      });

      expect(app).toBeDefined();
      expect(app.id).toBeDefined();
      expect(app.name).toBe('Test App');
      expect(app.description).toBe('A test application');
      expect(app.directory).toBe('/tmp/test-app');
      expect(app.startCommand).toBe('npm run dev');
      expect(app.port).toBe(3000);
      expect(app.icon).toBe('📦');
      expect(app.createdAt).toBeGreaterThan(0);
      expect(app.updatedAt).toBeGreaterThan(0);
    });

    it('should register with minimal fields', () => {
      const app = manager.register({
        name: 'Minimal',
        directory: '/tmp/minimal',
        startCommand: 'node server.js',
      });

      expect(app.name).toBe('Minimal');
      expect(app.description).toBe('');
      expect(app.port).toBeUndefined();
      expect(app.entryPath).toBeUndefined();
    });

    it('should register with entryPath', () => {
      const app = manager.register({
        name: 'With Entry',
        directory: '/tmp/entry',
        startCommand: 'npx serve',
        port: 3000,
        entryPath: '/snake.html',
      });

      expect(app.entryPath).toBe('/snake.html');
      expect(app.port).toBe(3000);
    });

    it('should persist app to disk', () => {
      const app = manager.register({
        name: 'Persist Test',
        directory: '/tmp/persist',
        startCommand: 'npm start',
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(appsDir, `${app.id}.json`),
        expect.any(String),
        'utf-8'
      );
    });

    it('should emit registered event', () => {
      const handler = vi.fn();
      manager.on('registered', handler);

      const app = manager.register({
        name: 'Event Test',
        directory: '/tmp/event',
        startCommand: 'npm start',
      });

      expect(handler).toHaveBeenCalledWith(app);
    });
  });

  describe('list', () => {
    it('should return empty list initially', () => {
      const apps = manager.list();
      expect(apps).toEqual([]);
    });

    it('should return registered apps with runtime info', () => {
      manager.register({ name: 'App 1', directory: '/tmp/a1', startCommand: 'npm start' });
      manager.register({ name: 'App 2', directory: '/tmp/a2', startCommand: 'npm start' });

      const apps = manager.list();
      expect(apps).toHaveLength(2);
      expect(apps[0].status).toBe('stopped');
      expect(apps[0].pid).toBeNull();
      expect(apps[0].tunnelUrl).toBeNull();
    });

    it('should sort by updatedAt descending', () => {
      const now = Date.now();
      const spy = vi.spyOn(Date, 'now');
      spy.mockReturnValueOnce(now - 1000); // Old: register calls Date.now() once
      manager.register({ name: 'Old', directory: '/tmp/old', startCommand: 'npm start' });
      spy.mockReturnValueOnce(now); // New: register calls Date.now() once
      manager.register({ name: 'New', directory: '/tmp/new', startCommand: 'npm start' });
      spy.mockRestore();

      const apps = manager.list();
      expect(apps[0].name).toBe('New');
    });
  });

  describe('get', () => {
    it('should return null for non-existent id', () => {
      expect(manager.get('non-existent')).toBeNull();
    });

    it('should return app runtime for existing id', () => {
      const app = manager.register({ name: 'Get Test', directory: '/tmp/get', startCommand: 'npm start' });
      const result = manager.get(app.id);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Get Test');
      expect(result!.status).toBe('stopped');
    });
  });

  describe('update', () => {
    it('should update app fields', () => {
      const app = manager.register({ name: 'Before', directory: '/tmp/update', startCommand: 'npm start' });
      const updated = manager.update(app.id, { name: 'After', port: 8080 });

      expect(updated.name).toBe('After');
      expect(updated.port).toBe(8080);
      expect(updated.id).toBe(app.id); // id 不可变
      expect(updated.createdAt).toBe(app.createdAt); // createdAt 不可变
      expect(updated.updatedAt).toBeGreaterThanOrEqual(app.updatedAt);
    });

    it('should throw for non-existent app', () => {
      expect(() => manager.update('non-existent', { name: 'X' })).toThrow('App not found');
    });
  });

  describe('remove', () => {
    it('should remove app and delete file', async () => {
      const app = manager.register({ name: 'Remove Me', directory: '/tmp/remove', startCommand: 'npm start' });
      await manager.remove(app.id);

      expect(manager.get(app.id)).toBeNull();
      expect(manager.list()).toHaveLength(0);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it('should emit removed event', async () => {
      const handler = vi.fn();
      manager.on('removed', handler);

      const app = manager.register({ name: 'Event Remove', directory: '/tmp/er', startCommand: 'npm start' });
      await manager.remove(app.id);

      expect(handler).toHaveBeenCalledWith(app.id);
    });
  });

  describe('start', () => {
    it('should throw for non-existent app', async () => {
      await expect(manager.start('non-existent')).rejects.toThrow('App not found');
    });

    it('should start a process and update status', async () => {
      const app = manager.register({ name: 'Start Test', directory: '/tmp/start', startCommand: 'npm start' });
      const result = await manager.start(app.id);

      expect(result.status).toBe('running');
      expect(result.pid).toBe(12345);
    });

    it('should throw for non-existent directory', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const app = manager.register({ name: 'No Dir', directory: '/tmp/nodir', startCommand: 'npm start' });

      const result = await manager.start(app.id);
      expect(result.status).toBe('error');
    });
  });

  describe('stop', () => {
    it('should stop a running process', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const app = manager.register({ name: 'Stop Test', directory: '/tmp/stop', startCommand: 'npm start' });
      await manager.start(app.id);

      const result = await manager.stop(app.id);
      expect(result.status).toBe('stopped');
    });

    it('should be idempotent for stopped app', async () => {
      const app = manager.register({ name: 'Already Stopped', directory: '/tmp/as', startCommand: 'npm start' });
      const result = await manager.stop(app.id);
      expect(result.status).toBe('stopped');
    });
  });

  describe('getLogs', () => {
    it('should return empty array for app without process', () => {
      const app = manager.register({ name: 'No Logs', directory: '/tmp/nl', startCommand: 'npm start' });
      expect(manager.getLogs(app.id)).toEqual([]);
    });
  });

  describe('shutdown', () => {
    it('should stop all processes', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const app1 = manager.register({ name: 'S1', directory: '/tmp/s1', startCommand: 'npm start' });
      const app2 = manager.register({ name: 'S2', directory: '/tmp/s2', startCommand: 'npm start' });
      await manager.start(app1.id);
      await manager.start(app2.id);

      await manager.shutdown();

      expect(manager.get(app1.id)!.status).toBe('stopped');
      expect(manager.get(app2.id)!.status).toBe('stopped');
    });
  });
});
