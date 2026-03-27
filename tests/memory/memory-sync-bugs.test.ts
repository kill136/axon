/**
 * MemorySyncEngine bug 修复测试
 * 覆盖 Bug 3: syncSessionFiles 不应删除 transcript 索引
 * 覆盖 Bug 7: initMemorySearchManager 应关闭旧实例
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { LongTermStore, type FileEntry } from '../../src/memory/long-term-store.js';
import { MemorySyncEngine } from '../../src/memory/memory-sync.js';
import { initMemorySearchManager, getMemorySearchManager, resetMemorySearchManager } from '../../src/memory/memory-search.js';

const tmpDir = path.join(os.tmpdir(), `axon-sync-bugs-${Date.now()}`);

describe('MemorySyncEngine bug fixes', () => {
  let store: LongTermStore;
  let syncEngine: MemorySyncEngine;

  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'sync-test.sqlite');
    store = await LongTermStore.create(dbPath);
    syncEngine = new MemorySyncEngine(store);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('Bug 3: syncSessionFiles should NOT delete transcript entries', () => {
    it('should index session summary files found on disk', async () => {
      const sessionsDir = path.join(tmpDir, 'projects', 'demo-project');
      const summaryDir = path.join(sessionsDir, 'session-1', 'session-memory');
      fs.mkdirSync(summaryDir, { recursive: true });
      fs.writeFileSync(path.join(summaryDir, 'summary.md'), '# Current State\nWorking on layered recall', 'utf-8');

      const result = await syncEngine.syncSessionFiles(sessionsDir);

      expect(result.added).toBe(1);
      expect(store.hasFile('session-1/session-memory/summary.md')).toBe(true);
      const matches = store.search('layered recall', { source: 'session', maxResults: 5 });
      expect(matches.some(match => match.path === 'session-1/session-memory/summary.md')).toBe(true);
    });

    it('should index transcript files only for the current project', async () => {
      const transcriptsDir = path.join(tmpDir, 'sessions');
      const projectDir = path.join(tmpDir, 'project-a');
      const otherProjectDir = path.join(tmpDir, 'project-b');
      fs.mkdirSync(transcriptsDir, { recursive: true });

      const sameProjectTranscript = path.join(transcriptsDir, 'same-project.json');
      fs.writeFileSync(sameProjectTranscript, JSON.stringify({
        metadata: {
          id: 'same-project',
          workingDirectory: projectDir,
          projectPath: projectDir,
          model: 'sonnet',
          createdAt: Date.now(),
        },
        messages: [
          { role: 'user', content: 'same project transcript evidence' },
          { role: 'assistant', content: 'useful fix from same project' },
        ],
      }), 'utf-8');

      const otherProjectTranscript = path.join(transcriptsDir, 'other-project.json');
      fs.writeFileSync(otherProjectTranscript, JSON.stringify({
        metadata: {
          id: 'other-project',
          workingDirectory: otherProjectDir,
          projectPath: otherProjectDir,
          model: 'sonnet',
          createdAt: Date.now(),
        },
        messages: [
          { role: 'user', content: 'other project transcript evidence' },
          { role: 'assistant', content: 'should not leak across projects' },
        ],
      }), 'utf-8');

      syncEngine = new MemorySyncEngine(store, { projectDir });
      const result = await syncEngine.syncTranscriptFiles(transcriptsDir);

      expect(result.added).toBe(1);
      expect(store.hasFile('transcript:same-project.json')).toBe(true);
      expect(store.hasFile('transcript:other-project.json')).toBe(false);
    });

    it('should preserve transcript: entries when syncing session files', async () => {
      // Pre-populate store with a transcript entry (as if syncTranscriptFiles ran before)
      const crypto = require('crypto');
      const transcriptPath = 'transcript:session123.json';
      const transcriptContent = '# Session\n## User\nHello\n## Assistant\nHi';
      const entry: FileEntry = {
        path: transcriptPath,
        absPath: '/fake/path/session123.json',
        source: 'session',
        hash: crypto.createHash('sha256').update(transcriptContent).digest('hex'),
        mtime: Date.now(),
        size: transcriptContent.length,
      };
      store.indexFile(entry, transcriptContent);

      // Verify it's indexed
      expect(store.hasFile(transcriptPath)).toBe(true);
      const statsBefore = store.getStats();
      expect(statsBefore.totalFiles).toBe(1);

      // Create an empty sessions dir (no summary.md files)
      const sessionsDir = path.join(tmpDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Run syncSessionFiles — this used to delete all transcript: entries
      const result = await syncEngine.syncSessionFiles(sessionsDir);

      // The transcript entry should still exist
      expect(store.hasFile(transcriptPath)).toBe(true);
      expect(result.removed).toBe(0);

      const statsAfter = store.getStats();
      expect(statsAfter.totalFiles).toBe(1);
    });

    it('should still remove non-transcript session entries when files are deleted', async () => {
      const crypto = require('crypto');
      // Index a summary.md entry
      const summaryPath = 'session1/session-memory/summary.md';
      const content = '# Summary\nSome session data';
      const entry: FileEntry = {
        path: summaryPath,
        absPath: path.join(tmpDir, 'sessions', summaryPath),
        source: 'session',
        hash: crypto.createHash('sha256').update(content).digest('hex'),
        mtime: Date.now(),
        size: content.length,
      };
      store.indexFile(entry, content);
      expect(store.hasFile(summaryPath)).toBe(true);

      // Create sessions dir without the summary.md file
      const sessionsDir = path.join(tmpDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // Sync — the summary entry should be removed
      const result = await syncEngine.syncSessionFiles(sessionsDir);
      expect(store.hasFile(summaryPath)).toBe(false);
      expect(result.removed).toBe(1);
    });
  });
});

describe('Bug 7: initMemorySearchManager should close old instance', () => {
  const msrTmpDir = path.join(os.tmpdir(), `axon-msr-leak-${Date.now()}`);

  beforeEach(() => {
    process.env.AXON_CONFIG_DIR = msrTmpDir;
    process.env.AXON_DISABLE_BUILTIN_EMBEDDING = '1';
    fs.mkdirSync(msrTmpDir, { recursive: true });
  });

  afterEach(() => {
    resetMemorySearchManager();
    delete process.env.AXON_CONFIG_DIR;
    delete process.env.AXON_DISABLE_BUILTIN_EMBEDDING;
    try { fs.rmSync(msrTmpDir, { recursive: true, force: true }); } catch {}
  });

  it('should not throw when re-initializing', async () => {
    const manager1 = await initMemorySearchManager('/proj/a', 'hash1');
    expect(getMemorySearchManager()).toBe(manager1);

    // Re-init should close old instance and create new
    const manager2 = await initMemorySearchManager('/proj/b', 'hash2');
    expect(getMemorySearchManager()).toBe(manager2);
    expect(manager2).not.toBe(manager1);
  });

  it('should allow status() on new instance after re-init', async () => {
    await initMemorySearchManager('/proj/a', 'hash1');
    const manager2 = await initMemorySearchManager('/proj/b', 'hash2');

    // Should not throw — if old instance leaked, this might error
    const status = manager2.status();
    expect(status.totalFiles).toBe(0);
  });
});
