import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('WebSessionManager', () => {
  const originalSessionDir = process.env.AXON_SESSION_DIR;
  let tempDir: string | null = null;

  afterEach(() => {
    if (originalSessionDir === undefined) {
      delete process.env.AXON_SESSION_DIR;
    } else {
      process.env.AXON_SESSION_DIR = originalSessionDir;
    }

    vi.resetModules();

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = null;
  });

  it('should persist runtimeBackend in session metadata', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-web-session-'));
    process.env.AXON_SESSION_DIR = tempDir;
    vi.resetModules();

    const { WebSessionManager } = await import('../../../src/web/server/session-manager.js');
    const manager = new WebSessionManager('f:/claude-code-open');

    const created = manager.createSession({
      model: 'gpt-5.4',
      runtimeBackend: 'codex-subscription',
      name: 'codex session',
    });

    const reloaded = manager.loadSessionById(created.metadata.id);

    expect(reloaded).not.toBeNull();
    expect(reloaded?.metadata.runtimeBackend).toBe('codex-subscription');
    expect(reloaded?.currentModel).toBe('gpt-5.4');
  });

  it('should resolve a persistent session from its temporary session alias after restart', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-web-session-'));
    process.env.AXON_SESSION_DIR = tempDir;
    vi.resetModules();

    const { WebSessionManager } = await import('../../../src/web/server/session-manager.js');
    const manager = new WebSessionManager('f:/claude-code-open');

    const created = manager.createSession({
      model: 'gpt-5.4',
      runtimeBackend: 'codex-subscription',
      name: 'restorable session',
    });

    expect(manager.registerTemporarySessionId(created.metadata.id, 'temp-session-123')).toBe(true);

    const restartedManager = new WebSessionManager('f:/claude-code-open');
    expect(restartedManager.findSessionIdByTemporarySessionId('temp-session-123')).toBe(created.metadata.id);

    const reloaded = restartedManager.loadSessionById(created.metadata.id);
    expect(reloaded?.metadata.temporarySessionIds).toContain('temp-session-123');
  });

  it('should persist pendingContinuationAfterRestore across reloads', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-web-session-'));
    process.env.AXON_SESSION_DIR = tempDir;
    vi.resetModules();

    const { WebSessionManager } = await import('../../../src/web/server/session-manager.js');
    const manager = new WebSessionManager('f:/claude-code-open');

    const created = manager.createSession({
      model: 'gpt-5.4',
      runtimeBackend: 'codex-subscription',
      name: 'continuation session',
    });

    created.pendingContinuationAfterRestore = true;
    expect(manager.saveSession(created.metadata.id)).toBe(true);

    const restartedManager = new WebSessionManager('f:/claude-code-open');
    const reloaded = restartedManager.loadSessionById(created.metadata.id);

    expect(reloaded?.pendingContinuationAfterRestore).toBe(true);
  });
});
