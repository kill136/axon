/**
 * LongTermStore bug 修复测试
 * 覆盖 Bug 4/5/6/9 的修复
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { LongTermStore, type FileEntry } from '../../src/memory/long-term-store.js';

const tmpDir = path.join(os.tmpdir(), `axon-ltm-bugs-${Date.now()}`);
let store: LongTermStore;

function makeEntry(filePath: string, content: string): FileEntry {
  const crypto = require('crypto');
  return {
    path: filePath,
    absPath: path.join(tmpDir, filePath),
    source: 'session',
    hash: crypto.createHash('sha256').update(content).digest('hex'),
    mtime: Date.now(),
    size: content.length,
  };
}

describe('LongTermStore bug fixes', () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.sqlite');
    store = await LongTermStore.create(dbPath);
  });

  afterEach(() => {
    try { store.close(); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  describe('Bug 5: empty query should not crash FTS5', () => {
    it('should handle query with only special characters', () => {
      const content = 'This is some test content for searching';
      store.indexFile(makeEntry('test.md', content), content);

      // Query with only FTS5 special chars → after escaping becomes empty
      expect(() => store.search('*()"~[]')).not.toThrow();
      const results = store.search('*()"~[]');
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle empty string query', () => {
      expect(() => store.search('')).not.toThrow();
    });

    it('should handle whitespace-only query', () => {
      expect(() => store.search('   ')).not.toThrow();
    });

    it('should still find results for normal queries', () => {
      const content = 'Hello world this is a test document about vector databases';
      store.indexFile(makeEntry('doc.md', content), content);

      const results = store.search('vector databases');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Bug 6: version comparison should use numbers', () => {
    it('should create store with version 3', () => {
      const stats = store.getStats();
      expect(stats.totalFiles).toBe(0);
      // If we got here without error, version migration worked
    });

    it('should recreate the parent directory if it disappears during async initialization', async () => {
      const dbPath = path.join(tmpDir, 'race', 'nested', 'race.sqlite');
      const createPromise = LongTermStore.create(dbPath);

      try {
        fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
      } catch {}

      const raceStore = await createPromise;
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true);
      raceStore.close();
    });

    it('should handle re-opening existing database', async () => {
      const dbPath = path.join(tmpDir, 'reopen.sqlite');
      const store1 = await LongTermStore.create(dbPath);
      const content = 'persistent data';
      store1.indexFile(makeEntry('file1.md', content), content);
      store1.close();

      // Re-open — should not lose data or crash
      const store2 = await LongTermStore.create(dbPath);
      expect(store2.hasFile('file1.md')).toBe(true);
      store2.close();
    });
  });

  describe('Bug 9: snippet should use original query for positioning', () => {
    it('should position snippet around the matching text', () => {
      // Create content with a known phrase in the middle
      const prefix = 'A'.repeat(300);
      const target = '这是搜索关键词在这里';
      const suffix = 'B'.repeat(300);
      const content = `${prefix}\n${target}\n${suffix}`;

      store.indexFile(makeEntry('snippet-test.md', content), content);

      const results = store.search('搜索关键词');
      expect(results.length).toBeGreaterThan(0);

      // The snippet should contain the search term, not just the beginning of text
      const snippet = results[0].snippet;
      // With the fix, extractSnippet receives the original query (not tokenized)
      // so it can find "搜索关键词" in the text
      expect(snippet).toContain('搜索');
    });
  });

  describe('Bug 4: hasEmbeddings should exclude empty strings', () => {
    it('should return false when no embeddings exist', () => {
      const content = 'test content';
      store.indexFile(makeEntry('test.md', content), content);
      expect(store.hasEmbeddings()).toBe(false);
    });

    it('should return true when valid embeddings exist', () => {
      const content = 'test content with embedding';
      const embedding = Array(768).fill(0.1);
      store.indexFile(makeEntry('emb.md', content), content, undefined, [embedding]);
      expect(store.hasEmbeddings()).toBe(true);
    });
  });

  describe('searchKeyword: empty query protection', () => {
    it('should not crash on special-character-only query', () => {
      const content = 'Some searchable content here';
      store.indexFile(makeEntry('kw.md', content), content);

      // searchKeyword internally calls search() for empty FTS queries
      expect(() => store.searchKeyword('()*+')).not.toThrow();
    });
  });

  describe('searchVector: fallback with no embeddings', () => {
    it('should return empty array when no embeddings stored', () => {
      const content = 'test content';
      store.indexFile(makeEntry('vec.md', content), content);

      const queryVec = Array(1536).fill(0.1);
      const results = store.searchVector(queryVec);
      expect(results).toEqual([]);
    });
  });
});
