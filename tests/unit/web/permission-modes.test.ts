/**
 * 权限模式测试
 * 测试 dontAsk 模式、delegate 模式、isAutoReject 方法、updateConfig 行为
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PermissionHandler } from '../../../src/web/server/permission-handler.js';

describe('Permission Modes', () => {
  let handler: PermissionHandler;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    handler?.cancelAll();
  });

  describe('dontAsk 模式', () => {
    beforeEach(() => {
      handler = new PermissionHandler({ mode: 'dontAsk' });
    });

    it('dontAsk 模式：needsPermission 始终返回 false（不走权限弹窗流程）', () => {
      // dontAsk 模式下，needsPermission 返回 false，不弹权限窗口
      // 敏感操作由 isAutoReject 判断是否拒绝执行
      expect(handler.needsPermission('Bash', { command: 'rm -rf /' })).toBe(false);
      expect(handler.needsPermission('Write', { file_path: '/etc/passwd' })).toBe(false);
      expect(handler.needsPermission('Edit', { file_path: '/tmp/test.ts' })).toBe(false);
    });

    it('dontAsk 模式：isAutoReject 对敏感工具返回 true', () => {
      // SENSITIVE_TOOLS 包含 Write, Edit, MultiEdit, Bash, NotebookEdit
      expect(handler.isAutoReject('Write', { file_path: '/tmp/test.ts' })).toBe(true);
      expect(handler.isAutoReject('Edit', { file_path: '/tmp/test.ts' })).toBe(true);
      expect(handler.isAutoReject('MultiEdit', { edits: [] })).toBe(true);
      expect(handler.isAutoReject('Bash', { command: 'rm -rf /' })).toBe(true);
      expect(handler.isAutoReject('NotebookEdit', { notebook_path: '/tmp/nb.ipynb' })).toBe(true);
    });

    it('dontAsk 模式：isAutoReject 对非敏感工具返回 false', () => {
      expect(handler.isAutoReject('Read', { file_path: '/tmp/test.ts' })).toBe(false);
      expect(handler.isAutoReject('Glob', { pattern: '*.ts' })).toBe(false);
      expect(handler.isAutoReject('Grep', { pattern: 'test' })).toBe(false);
    });
  });

  describe('isAutoReject 在非 dontAsk 模式下', () => {
    it('default 模式：isAutoReject 始终返回 false', () => {
      handler = new PermissionHandler({ mode: 'default' });
      expect(handler.isAutoReject('Write', { file_path: '/tmp/test.ts' })).toBe(false);
      expect(handler.isAutoReject('Bash', { command: 'rm -rf /' })).toBe(false);
    });

    it('bypassPermissions 模式：isAutoReject 始终返回 false', () => {
      handler = new PermissionHandler({ mode: 'bypassPermissions' });
      expect(handler.isAutoReject('Write', { file_path: '/tmp/test.ts' })).toBe(false);
    });
  });

  describe('delegate 模式', () => {
    it('delegate 模式应被正确识别', () => {
      handler = new PermissionHandler({ mode: 'delegate' });
      const config = handler.getConfig();
      expect(config.mode).toBe('delegate');
    });

    it('delegate 模式：needsPermission 返回 false（委托给外部系统）', () => {
      handler = new PermissionHandler({ mode: 'delegate' });
      // delegate 模式不走 WebUI 权限弹窗，由外部系统处理
      expect(handler.needsPermission('Write', { file_path: '/tmp/test.ts' })).toBe(false);
    });
  });

  describe('bypassPermissions 模式', () => {
    it('bypassPermissions 模式：所有工具不需要权限', () => {
      handler = new PermissionHandler({ mode: 'bypassPermissions' });
      expect(handler.needsPermission('Write', { file_path: '/tmp/test.ts' })).toBe(false);
      expect(handler.needsPermission('Bash', { command: 'rm -rf /' })).toBe(false);
      expect(handler.needsPermission('Edit', { file_path: '/tmp/test.ts' })).toBe(false);
    });
  });

  describe('plan 模式', () => {
    it('plan 模式：所有操作都需要确认', () => {
      handler = new PermissionHandler({ mode: 'plan' });
      expect(handler.needsPermission('Read', { file_path: '/tmp/test.ts' })).toBe(true);
      expect(handler.needsPermission('Glob', { pattern: '*.ts' })).toBe(true);
    });
  });

  describe('updateConfig 模式切换', () => {
    it('切换到 bypassPermissions 时自动批准待处理请求', async () => {
      handler = new PermissionHandler({ mode: 'default' });

      // 创建待处理的权限请求
      const permissionPromise = handler.requestPermission('Write', { file_path: '/tmp/test.ts' });

      expect(handler.getPendingCount()).toBe(1);

      // 切换到 bypassPermissions — 应自动批准所有待处理请求
      handler.updateConfig({ mode: 'bypassPermissions' });

      // Promise 应被 resolve 为 true
      const result = await permissionPromise;
      expect(result).toBe(true);
      expect(handler.getPendingCount()).toBe(0);
    });

    it('切换到 dontAsk 时自动拒绝待处理请求', async () => {
      handler = new PermissionHandler({ mode: 'default' });

      // 创建待处理的权限请求
      const permissionPromise = handler.requestPermission('Write', { file_path: '/tmp/test.ts' });

      expect(handler.getPendingCount()).toBe(1);

      // 切换到 dontAsk — 应自动拒绝所有待处理请求
      handler.updateConfig({ mode: 'dontAsk' });

      // Promise 应被 resolve 为 false（拒绝）
      const result = await permissionPromise;
      expect(result).toBe(false);
      expect(handler.getPendingCount()).toBe(0);
    });

    it('切换到 bypassPermissions 时没有待处理请求也不报错', () => {
      handler = new PermissionHandler({ mode: 'default' });
      expect(handler.getPendingCount()).toBe(0);

      // 切换到 bypassPermissions — 无请求也不应报错
      expect(() => handler.updateConfig({ mode: 'bypassPermissions' })).not.toThrow();
    });

    it('切换到 dontAsk 时配置被正确更新', () => {
      handler = new PermissionHandler({ mode: 'default' });
      handler.updateConfig({ mode: 'dontAsk' });
      expect(handler.getConfig().mode).toBe('dontAsk');
    });

    it('updateConfig 保留未更新的配置项', () => {
      handler = new PermissionHandler({
        mode: 'default',
        timeout: 30000,
        bypassTools: ['Grep'],
      });

      handler.updateConfig({ mode: 'bypassPermissions' });

      const config = handler.getConfig();
      expect(config.mode).toBe('bypassPermissions');
      expect(config.timeout).toBe(30000);
      expect(config.bypassTools).toEqual(['Grep']);
    });

    it('多次切换模式正确工作', async () => {
      handler = new PermissionHandler({ mode: 'default' });

      // 切换到 plan
      handler.updateConfig({ mode: 'plan' });
      expect(handler.needsPermission('Read', {})).toBe(true);

      // 切换到 bypassPermissions
      handler.updateConfig({ mode: 'bypassPermissions' });
      expect(handler.needsPermission('Write', { file_path: '/tmp/test.ts' })).toBe(false);

      // 切回 default
      handler.updateConfig({ mode: 'default' });
      expect(handler.needsPermission('Write', { file_path: '/tmp/test.ts' })).toBe(true);
    });
  });

  describe('acceptEdits 模式', () => {
    it('acceptEdits 模式自动允许文件编辑工具', () => {
      handler = new PermissionHandler({ mode: 'acceptEdits' });
      expect(handler.needsPermission('Write', { file_path: '/tmp/test.ts' })).toBe(false);
      expect(handler.needsPermission('Edit', { file_path: '/tmp/test.ts' })).toBe(false);
      expect(handler.needsPermission('MultiEdit', { edits: [] })).toBe(false);
    });

    it('acceptEdits 模式不影响 Bash 等其他敏感工具', () => {
      handler = new PermissionHandler({ mode: 'acceptEdits' });
      // Bash 的危险命令仍需权限
      expect(handler.needsPermission('Bash', { command: 'rm -rf /' })).toBe(true);
    });
  });
});
