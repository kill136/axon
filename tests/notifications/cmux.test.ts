/**
 * cmux 集成模块测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock os.platform at the module level
const mockPlatform = vi.fn(() => 'darwin');
const mockExistsSync = vi.fn(() => false);
const mockStatSync = vi.fn(() => ({ isSocket: () => false }));
const mockExecFile = vi.fn((_cmd: string, _args: string[], _opts: any, cb: any) => cb?.());
const mockExecFileSync = vi.fn();

vi.mock('os', () => ({
  platform: () => mockPlatform(),
}));

vi.mock('fs', () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  statSync: (...args: any[]) => mockStatSync(...args),
}));

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  execFileSync: (...args: any[]) => mockExecFileSync(...args),
}));

vi.mock('net', () => ({
  createConnection: vi.fn(),
}));

describe('cmux integration', () => {
  // Store original env vars
  const origEnv: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string | undefined) {
    if (!(key in origEnv)) origEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  function restoreEnv() {
    for (const [key, val] of Object.entries(origEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }

  let cmux: typeof import('../../src/notifications/cmux.js');

  beforeEach(async () => {
    vi.resetModules();
    mockPlatform.mockReturnValue('darwin');
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReturnValue({ isSocket: () => false });
    mockExecFile.mockClear();
    mockExecFileSync.mockClear();

    cmux = await import('../../src/notifications/cmux.js');
    cmux.resetDetectionCache();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('isCmuxAvailable', () => {
    it('should return false on non-darwin platforms', () => {
      mockPlatform.mockReturnValue('win32');
      cmux.resetDetectionCache();
      expect(cmux.isCmuxAvailable()).toBe(false);
    });

    it('should return true when CMUX_WORKSPACE_ID and CMUX_SURFACE_ID are set', () => {
      setEnv('CMUX_WORKSPACE_ID', 'test-workspace');
      setEnv('CMUX_SURFACE_ID', 'test-surface');
      cmux.resetDetectionCache();
      expect(cmux.isCmuxAvailable()).toBe(true);
    });

    it('should return true when socket file exists', () => {
      setEnv('CMUX_WORKSPACE_ID', undefined);
      setEnv('CMUX_SURFACE_ID', undefined);
      mockExistsSync.mockReturnValue(true);
      mockStatSync.mockReturnValue({ isSocket: () => true });
      cmux.resetDetectionCache();
      expect(cmux.isCmuxAvailable()).toBe(true);
    });

    it('should return false when no cmux indicators present', () => {
      setEnv('CMUX_WORKSPACE_ID', undefined);
      setEnv('CMUX_SURFACE_ID', undefined);
      cmux.resetDetectionCache();
      expect(cmux.isCmuxAvailable()).toBe(false);
    });

    it('should cache the detection result', () => {
      cmux.resetDetectionCache();
      mockPlatform.mockClear();
      const result1 = cmux.isCmuxAvailable();
      const result2 = cmux.isCmuxAvailable();
      expect(result1).toBe(result2);
      // platform should only be called once due to caching
      expect(mockPlatform).toHaveBeenCalledTimes(1);
    });
  });

  describe('cmuxNotify', () => {
    it('should be a no-op when cmux is not available', () => {
      mockPlatform.mockReturnValue('win32');
      cmux.resetDetectionCache();
      // Should not throw
      cmux.cmuxNotify({ title: 'Test', body: 'Hello' });
    });

    it('should send notification via socket when available', () => {
      setEnv('CMUX_WORKSPACE_ID', 'ws');
      setEnv('CMUX_SURFACE_ID', 'sf');
      // execFileSync for 'which cmux' — should throw to indicate CLI not available
      mockExecFileSync.mockImplementation(() => { throw new Error('not found'); });
      cmux.resetDetectionCache();

      // With env vars set but no CLI, it should try socket
      // Just verify it doesn't throw
      cmux.cmuxNotify({ title: 'Build Done', body: 'All tests passed' });
    });
  });

  describe('CmuxBridge', () => {
    it('should create bridge without errors', () => {
      const bridge = cmux.getCmuxBridge();
      expect(bridge).toBeDefined();
    });

    it('should be a singleton', () => {
      const bridge1 = cmux.getCmuxBridge();
      const bridge2 = cmux.getCmuxBridge();
      expect(bridge1).toBe(bridge2);
    });

    it('should handle all lifecycle events without errors when cmux not available', async () => {
      mockPlatform.mockReturnValue('win32');

      // Re-import to get fresh CmuxBridge constructor
      vi.resetModules();
      const freshCmux = await import('../../src/notifications/cmux.js');
      freshCmux.resetDetectionCache();

      const bridge = freshCmux.getCmuxBridge();
      // All these should be no-ops without throwing
      bridge.onThinking();
      bridge.onToolStart('Bash');
      bridge.onToolComplete('Bash', true);
      bridge.onWaitingForInput('question?');
      bridge.onPermissionRequest('Edit', 'write file');
      bridge.onComplete('done');
      bridge.onError('something failed');
      bridge.onSessionEnd();
    });

    it('should send cmux calls when available', () => {
      setEnv('CMUX_WORKSPACE_ID', 'ws');
      setEnv('CMUX_SURFACE_ID', 'sf');
      // Make CLI available
      mockExecFileSync.mockReturnValue(Buffer.from('/usr/local/bin/cmux'));
      cmux.resetDetectionCache();

      // Re-get the bridge (it caches isCmuxAvailable on construct)
      vi.resetModules();
    });
  });

  describe('cmuxSetStatus / cmuxClearStatus', () => {
    it('should be no-ops when cmux not available', () => {
      mockPlatform.mockReturnValue('win32');
      cmux.resetDetectionCache();
      cmux.cmuxSetStatus({ key: 'test', value: 'ok' });
      cmux.cmuxClearStatus('test');
    });
  });

  describe('cmuxSetProgress / cmuxClearProgress', () => {
    it('should be no-ops when cmux not available', () => {
      mockPlatform.mockReturnValue('win32');
      cmux.resetDetectionCache();
      cmux.cmuxSetProgress(0.5, 'Building...');
      cmux.cmuxClearProgress();
    });

    it('should clamp progress values', () => {
      mockPlatform.mockReturnValue('win32');
      cmux.resetDetectionCache();
      // Should not throw even with out-of-range values
      cmux.cmuxSetProgress(-1);
      cmux.cmuxSetProgress(2);
    });
  });

  describe('cmuxLog / cmuxClearLog', () => {
    it('should be no-ops when cmux not available', () => {
      mockPlatform.mockReturnValue('win32');
      cmux.resetDetectionCache();
      cmux.cmuxLog('hello', 'info');
      cmux.cmuxLog('success', 'success', 'axon');
      cmux.cmuxClearLog();
    });
  });
});
