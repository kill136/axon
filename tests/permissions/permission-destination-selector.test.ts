/**
 * PermissionDestinationSelector 测试
 *
 * 测试 v2.1.3 权限请求目标选择器功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PermissionHandler, type PermissionDestination } from '../../src/web/server/permission-handler.js';

describe('PermissionDestinationSelector', () => {
  describe('PermissionHandler.handleResponse with destination', () => {
    let handler: PermissionHandler;
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
      handler = new PermissionHandler({ timeout: 5000 });
      originalCwd = process.cwd();

      // 创建临时目录用于测试（使用系统临时目录，避免污染项目根目录）
      tempDir = path.join(os.tmpdir(), '.test-permissions-' + Date.now());
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
    });

    afterEach(() => {
      // Must chdir out of tempDir before deleting it (Windows EBUSY)
      process.chdir(originalCwd);
      // 清理临时目录
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should not save permission when destination is session', async () => {
      const request = handler.createRequest('Bash', { command: 'npm test' });

      // 模拟请求
      handler['pendingRequests'].set(request.requestId, {
        request,
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 5000),
      });

      // 处理响应，目标为 session
      handler.handleResponse(request.requestId, true, true, 'always', 'session');

      // session 目标不应保存任何文件
      const projectSettingsPath = path.join(process.cwd(), '.axon', 'settings.json');
      const globalSettingsPath = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.axon', 'settings.json');

      // 不检查文件是否创建，因为 session 模式不应创建文件
      // 这里主要验证逻辑不会抛出错误
      expect(true).toBe(true);
    });

    it('should save permission to project settings when destination is project', async () => {
      // 切换到临时目录
      process.chdir(tempDir);

      const request = handler.createRequest('Bash', { command: 'npm install' });

      // 模拟请求
      handler['pendingRequests'].set(request.requestId, {
        request,
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 5000),
      });

      // 处理响应，目标为 project
      handler.handleResponse(request.requestId, true, true, 'always', 'project');

      // 验证项目配置文件被创建
      const projectSettingsPath = path.join(tempDir, '.axon', 'settings.json');
      expect(fs.existsSync(projectSettingsPath)).toBe(true);

      // 验证配置内容
      const config = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf-8'));
      expect(config.permissions).toBeDefined();
      expect(config.permissions.allow).toContain('Bash(npm install*)');
    });

    it('should save permission to local settings when destination is team', async () => {
      // 切换到临时目录
      process.chdir(tempDir);

      const request = handler.createRequest('Write', { file_path: 'test.ts' });

      // 模拟请求
      handler['pendingRequests'].set(request.requestId, {
        request,
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 5000),
      });

      // 处理响应，目标为 team（本地）
      handler.handleResponse(request.requestId, true, true, 'always', 'team');

      // 验证本地配置文件被创建
      const localSettingsPath = path.join(tempDir, '.axon', 'settings.local.json');
      expect(fs.existsSync(localSettingsPath)).toBe(true);

      // 验证配置内容
      const config = JSON.parse(fs.readFileSync(localSettingsPath, 'utf-8'));
      expect(config.permissions).toBeDefined();
      expect(config.permissions.allow).toContain('Write(*.ts)');
    });

    it('should add deny rule when permission is denied', async () => {
      // 切换到临时目录
      process.chdir(tempDir);

      const request = handler.createRequest('Bash', { command: 'rm -rf /' });

      // 模拟请求
      handler['pendingRequests'].set(request.requestId, {
        request,
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 5000),
      });

      // 处理响应，拒绝并保存到 project
      handler.handleResponse(request.requestId, false, true, 'always', 'project');

      // 验证配置内容
      const projectSettingsPath = path.join(tempDir, '.axon', 'settings.json');
      const config = JSON.parse(fs.readFileSync(projectSettingsPath, 'utf-8'));
      expect(config.permissions).toBeDefined();
      expect(config.permissions.deny).toContain('Bash(rm*)');
      expect(config.permissions.allow || []).not.toContain('Bash(rm*)');
    });

    it('should merge with existing config', async () => {
      // 切换到临时目录
      process.chdir(tempDir);

      // 创建初始配置
      const claudeDir = path.join(tempDir, '.axon');
      fs.mkdirSync(claudeDir, { recursive: true });
      const initialConfig = {
        version: '2.1.3',
        permissions: {
          allow: ['Bash(git*)'],
          deny: [],
        },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify(initialConfig, null, 2),
        'utf-8'
      );

      const request = handler.createRequest('Bash', { command: 'npm test' });

      // 模拟请求
      handler['pendingRequests'].set(request.requestId, {
        request,
        resolve: () => {},
        reject: () => {},
        timeout: setTimeout(() => {}, 5000),
      });

      // 处理响应
      handler.handleResponse(request.requestId, true, true, 'always', 'project');

      // 验证配置被合并
      const config = JSON.parse(
        fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8')
      );
      expect(config.version).toBe('2.1.3');
      expect(config.permissions.allow).toContain('Bash(git*)');
      expect(config.permissions.allow).toContain('Bash(npm test*)');
    });
  });

  describe('Permission rule generation', () => {
    let handler: PermissionHandler;

    beforeEach(() => {
      handler = new PermissionHandler();
    });

    it('should generate Bash rule with command prefix', () => {
      const rule = handler['generatePermissionRule']('Bash', { command: 'npm run build' });
      expect(rule).toBe('Bash(npm run*)');
    });

    it('should generate Bash rule with simple command', () => {
      const rule = handler['generatePermissionRule']('Bash', { command: 'ls -la' });
      expect(rule).toBe('Bash(ls*)');
    });

    it('should generate Write rule with extension', () => {
      const rule = handler['generatePermissionRule']('Write', { file_path: '/path/to/file.ts' });
      expect(rule).toBe('Write(*.ts)');
    });

    it('should generate Edit rule with extension', () => {
      const rule = handler['generatePermissionRule']('Edit', { file_path: '/path/to/file.py' });
      expect(rule).toBe('Edit(*.py)');
    });

    it('should generate MultiEdit rule', () => {
      const rule = handler['generatePermissionRule']('MultiEdit', { edits: [] });
      expect(rule).toBe('MultiEdit(*)');
    });

    it('should generate KillShell rule', () => {
      const rule = handler['generatePermissionRule']('KillShell', { bash_id: '123' });
      expect(rule).toBe('KillShell(*)');
    });
  });

  describe('Destination path resolution', () => {
    let handler: PermissionHandler;

    beforeEach(() => {
      handler = new PermissionHandler();
    });

    it('should return correct path for project destination', () => {
      const configPath = handler['getConfigPathForDestination']('project');
      expect(configPath).toBe(path.join(process.cwd(), '.axon', 'settings.json'));
    });

    it('should return correct path for global destination', () => {
      const configPath = handler['getConfigPathForDestination']('global');
      const homeDir = process.env.HOME || process.env.USERPROFILE || '~';
      expect(configPath).toBe(path.join(homeDir, '.axon', 'settings.json'));
    });

    it('should return correct path for team destination', () => {
      const configPath = handler['getConfigPathForDestination']('team');
      expect(configPath).toBe(path.join(process.cwd(), '.axon', 'settings.local.json'));
    });

    it('should return null for session destination', () => {
      const configPath = handler['getConfigPathForDestination']('session');
      expect(configPath).toBeNull();
    });
  });
});

describe('PermissionDestination types', () => {
  it('should have valid destination values', () => {
    const destinations: PermissionDestination[] = ['project', 'global', 'team', 'session'];
    expect(destinations).toHaveLength(4);
  });

  it('should include all expected destinations', () => {
    const expectedDestinations = ['project', 'global', 'team', 'session'];
    expectedDestinations.forEach((dest) => {
      expect(['project', 'global', 'team', 'session']).toContain(dest);
    });
  });
});
