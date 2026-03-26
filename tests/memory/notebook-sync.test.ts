import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { LongTermStore } from '../../src/memory/long-term-store.js';
import { MemorySyncEngine } from '../../src/memory/memory-sync.js';
import { NotebookManager } from '../../src/memory/notebook.js';
import { initMemorySearchManager, resetMemorySearchManager } from '../../src/memory/memory-search.js';

describe('Notebook memory sync', () => {
  let tmpDir: string;
  let projectDir: string;
  let notebookManager: NotebookManager;

  const getNotebookPaths = () => ({
    profile: notebookManager.getPath('profile'),
    experience: notebookManager.getPath('experience'),
    project: notebookManager.getPath('project'),
    identity: notebookManager.getPath('identity'),
    'tools-notes': notebookManager.getPath('tools-notes'),
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-notebook-sync-'));
    projectDir = path.join(tmpDir, 'workspace', 'demo-project');
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.AXON_CONFIG_DIR = tmpDir;
    process.env.AXON_DISABLE_BUILTIN_EMBEDDING = '1';
    notebookManager = new NotebookManager(projectDir);
  });

  afterEach(() => {
    resetMemorySearchManager();
    delete process.env.AXON_CONFIG_DIR;
    delete process.env.AXON_DISABLE_BUILTIN_EMBEDDING;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('indexes notebook files under the notebook source with virtual paths', async () => {
    const store = await LongTermStore.create(path.join(tmpDir, 'sync.sqlite'));
    const syncEngine = new MemorySyncEngine(store);

    try {
      notebookManager.write('profile', '# User Profile\n- Preferred stack: TypeScript');
      notebookManager.write('project', '# Project Notebook\n- Key theme: memory retrieval');

      const result = await syncEngine.syncNotebookFiles(getNotebookPaths());

      expect(result.added).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(0);

      const profileResults = store.search('TypeScript', { source: 'notebook' });
      expect(profileResults.some(result => result.path === 'notebook:profile.md')).toBe(true);
      expect(profileResults.every(result => result.source === 'notebook')).toBe(true);

      const projectResults = store.search('retrieval', { source: 'notebook' });
      expect(projectResults.some(result => result.path === 'notebook:project.md')).toBe(true);
    } finally {
      store.close();
    }
  });

  it('updates and removes notebook entries incrementally', async () => {
    const store = await LongTermStore.create(path.join(tmpDir, 'sync.sqlite'));
    const syncEngine = new MemorySyncEngine(store);

    try {
      notebookManager.write('profile', '# User Profile\n- Preferred editor: Vim');
      notebookManager.write('project', '# Project Notebook\n- Current milestone: beta');
      await syncEngine.syncNotebookFiles(getNotebookPaths());

      notebookManager.write('profile', '# User Profile\n- Preferred editor: VS Code');
      fs.rmSync(notebookManager.getPath('project'));

      const result = await syncEngine.syncNotebookFiles(getNotebookPaths());

      expect(result.updated).toBe(1);
      expect(result.removed).toBe(1);
      expect(store.hasFile('notebook:project.md')).toBe(false);
      expect(store.search('VS Code', { source: 'notebook' }).some(result => result.path === 'notebook:profile.md')).toBe(true);
      expect(store.search('Vim', { source: 'notebook' })).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('syncs notebook content through MemorySearchManager and supports notebook filtering', async () => {
    notebookManager.write('experience', '# Experience Notebook\n- Release cadence: every Friday');

    const projectHash = crypto.createHash('md5').update(projectDir).digest('hex').slice(0, 12);
    const manager = await initMemorySearchManager(projectDir, projectHash);

    await manager.sync('test');
    const results = await manager.hybridSearch('Friday', {
      source: 'notebook',
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(result => result.source === 'notebook')).toBe(true);
    expect(results.some(result => result.path === 'notebook:experience.md')).toBe(true);
  });

  it('supports notebook-only keyword recall for prompt injection', async () => {
    notebookManager.write('profile', '# User Profile\n- Prefers release summaries every Friday afternoon');

    const projectHash = crypto.createHash('md5').update(projectDir).digest('hex').slice(0, 12);
    const manager = await initMemorySearchManager(projectDir, projectHash);

    await manager.sync('test');
    const recall = await manager.recall('Friday', 3, {
      source: 'notebook',
      mode: 'keyword',
    });

    expect(recall).toBeTruthy();
    expect(recall).toContain('(notebook,');
    expect(recall).toContain('Friday afternoon');
  });
});
