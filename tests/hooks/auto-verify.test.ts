/**
 * Auto-Verify 系统测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  ChangeTracker,
  detectTestFramework,
  findRelatedTests,
  getChangeTracker,
  removeChangeTracker,
  clearFrameworkCache,
} from '../../src/hooks/auto-verify.js';

// ============================================================================
// ChangeTracker 核心逻辑
// ============================================================================

describe('ChangeTracker', () => {
  let tracker: ChangeTracker;

  beforeEach(() => {
    tracker = new ChangeTracker();
  });

  describe('trackChange', () => {
    it('should track code file changes', () => {
      tracker.trackChange('/project/src/foo.ts', 'Edit');
      tracker.trackChange('/project/src/bar.js', 'Write');
      expect(tracker.getUnverifiedChanges()).toHaveLength(2);
    });

    it('should ignore non-code files', () => {
      tracker.trackChange('/project/README.md', 'Edit');
      tracker.trackChange('/project/config.json', 'Write');
      tracker.trackChange('/project/.env', 'Write');
      tracker.trackChange('/project/data.yml', 'Edit');
      expect(tracker.getUnverifiedChanges()).toHaveLength(0);
    });

    it('should track various code extensions', () => {
      const codeFiles = [
        '/p/a.ts', '/p/b.tsx', '/p/c.js', '/p/d.jsx',
        '/p/e.py', '/p/f.go', '/p/g.rs', '/p/h.java',
        '/p/i.vue', '/p/j.svelte', '/p/k.cpp', '/p/l.swift',
      ];
      for (const f of codeFiles) {
        tracker.trackChange(f, 'Edit');
      }
      expect(tracker.getUnverifiedChanges()).toHaveLength(codeFiles.length);
    });

    it('should deduplicate same file changes', () => {
      tracker.trackChange('/project/src/foo.ts', 'Edit');
      tracker.trackChange('/project/src/foo.ts', 'Edit');
      expect(tracker.getUnverifiedChanges()).toHaveLength(1);
    });
  });

  describe('trackVerification', () => {
    it('should mark all changes as verified when test command detected', () => {
      tracker.trackChange('/project/src/foo.ts', 'Edit');
      tracker.trackChange('/project/src/bar.ts', 'Write');

      tracker.trackVerification('npx vitest tests/foo.test.ts --run');

      expect(tracker.getUnverifiedChanges()).toHaveLength(0);
    });

    it('should detect various test commands', () => {
      const testCommands = [
        'npm test',
        'npm run test',
        'npx vitest',
        'npx jest',
        'pytest tests/',
        'go test ./...',
        'cargo test',
      ];

      for (const cmd of testCommands) {
        const t = new ChangeTracker();
        t.trackChange('/p/foo.ts', 'Edit');
        t.trackChange('/p/bar.ts', 'Edit');
        t.trackVerification(cmd);
        expect(t.getUnverifiedChanges()).toHaveLength(0);
      }
    });

    it('should not mark as verified for non-test commands', () => {
      tracker.trackChange('/project/src/foo.ts', 'Edit');
      tracker.trackVerification('npm run build');
      tracker.trackVerification('tsc --noEmit');
      tracker.trackVerification('ls -la');
      expect(tracker.getUnverifiedChanges()).toHaveLength(1);
    });
  });

  describe('generateHint', () => {
    it('should return null when less than 2 unverified files', () => {
      tracker.trackChange('/project/src/foo.ts', 'Edit');
      expect(tracker.generateHint('/project')).toBeNull();
    });

    it('should return null when no test framework detected', () => {
      tracker.trackChange('/tmp/no-project/a.ts', 'Edit');
      tracker.trackChange('/tmp/no-project/b.ts', 'Edit');
      expect(tracker.generateHint('/tmp/no-project')).toBeNull();
    });

    it('should only inject once per turn', () => {
      // Use a temp dir with a package.json
      const tmpDir = path.join(process.env.TEMP || '/tmp', 'auto-verify-test-' + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        scripts: { test: 'vitest' },
        devDependencies: { vitest: '^2.0.0' },
      }));
      clearFrameworkCache();

      tracker.trackChange(path.join(tmpDir, 'a.ts'), 'Edit');
      tracker.trackChange(path.join(tmpDir, 'b.ts'), 'Edit');

      const first = tracker.generateHint(tmpDir);
      expect(first).not.toBeNull();
      expect(first).toContain('unverified code changes');

      const second = tracker.generateHint(tmpDir);
      expect(second).toBeNull(); // 同一轮不重复

      // cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should reset turn flag correctly', () => {
      const tmpDir = path.join(process.env.TEMP || '/tmp', 'auto-verify-test2-' + Date.now());
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
        scripts: { test: 'vitest' },
        devDependencies: { vitest: '^2.0.0' },
      }));
      clearFrameworkCache();

      tracker.trackChange(path.join(tmpDir, 'a.ts'), 'Edit');
      tracker.trackChange(path.join(tmpDir, 'b.ts'), 'Edit');

      const first = tracker.generateHint(tmpDir);
      expect(first).not.toBeNull();

      tracker.resetTurnFlag();
      const afterReset = tracker.generateHint(tmpDir);
      expect(afterReset).not.toBeNull(); // 重置后可以再次注入

      // cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe('reset', () => {
    it('should clear all state', () => {
      tracker.trackChange('/p/a.ts', 'Edit');
      tracker.trackChange('/p/b.ts', 'Write');
      tracker.trackVerification('npm test');

      tracker.reset();

      expect(tracker.getUnverifiedChanges()).toHaveLength(0);
      expect(tracker.getStats()).toEqual({
        modified: 0,
        verified: 0,
        unverified: 0,
      });
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      tracker.trackChange('/p/a.ts', 'Edit');
      tracker.trackChange('/p/b.ts', 'Write');
      tracker.trackChange('/p/c.js', 'Edit');

      expect(tracker.getStats()).toEqual({
        modified: 3,
        verified: 0,
        unverified: 3,
      });

      tracker.trackVerification('npm test');

      expect(tracker.getStats()).toEqual({
        modified: 3,
        verified: 3,
        unverified: 0,
      });
    });
  });
});

// ============================================================================
// detectTestFramework
// ============================================================================

describe('detectTestFramework', () => {
  afterEach(() => {
    clearFrameworkCache();
  });

  it('should detect vitest from package.json', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-1-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^2.0.0' },
    }));

    const result = detectTestFramework(tmpDir);
    expect(result).toEqual({ command: 'npx vitest', framework: 'vitest' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect jest from package.json', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-2-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { jest: '^29.0.0' },
    }));

    const result = detectTestFramework(tmpDir);
    expect(result).toEqual({ command: 'npx jest', framework: 'jest' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect npm test as fallback', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-3-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      scripts: { test: 'mocha' },
    }));

    const result = detectTestFramework(tmpDir);
    expect(result).toEqual({ command: 'npm test', framework: 'npm' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect pytest', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-4-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'pytest.ini'), '[pytest]\n');

    const result = detectTestFramework(tmpDir);
    expect(result).toEqual({ command: 'pytest', framework: 'pytest' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect go test', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-5-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module example.com/test\n');

    const result = detectTestFramework(tmpDir);
    expect(result).toEqual({ command: 'go test ./...', framework: 'go' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect cargo test', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-6-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "test"\n');

    const result = detectTestFramework(tmpDir);
    expect(result).toEqual({ command: 'cargo test', framework: 'cargo' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null when no framework detected', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-7-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = detectTestFramework(tmpDir);
    expect(result).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should cache results', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'detect-fw-8-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^2.0.0' },
    }));

    const result1 = detectTestFramework(tmpDir);
    // Delete the package.json — cached result should still return
    fs.rmSync(path.join(tmpDir, 'package.json'));
    const result2 = detectTestFramework(tmpDir);

    expect(result1).toEqual(result2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ============================================================================
// findRelatedTests
// ============================================================================

describe('findRelatedTests', () => {
  it('should find co-located test files', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'find-tests-1-' + Date.now());
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });

    // Create source and test files
    fs.writeFileSync(path.join(srcDir, 'foo.ts'), '');
    fs.writeFileSync(path.join(srcDir, 'foo.test.ts'), '');

    const result = findRelatedTests(path.join(srcDir, 'foo.ts'), tmpDir);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.includes('foo.test.ts'))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should find __tests__ directory tests', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'find-tests-2-' + Date.now());
    const srcDir = path.join(tmpDir, 'src');
    const testsDir = path.join(srcDir, '__tests__');
    fs.mkdirSync(testsDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'bar.ts'), '');
    fs.writeFileSync(path.join(testsDir, 'bar.test.ts'), '');

    const result = findRelatedTests(path.join(srcDir, 'bar.ts'), tmpDir);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.includes('bar.test.ts'))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should find mirror directory tests (src/ → tests/)', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'find-tests-3-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'tests', 'utils'), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'src', 'utils', 'helper.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'tests', 'utils', 'helper.test.ts'), '');

    const result = findRelatedTests(path.join(tmpDir, 'src', 'utils', 'helper.ts'), tmpDir);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(r => r.includes('helper.test.ts'))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return self for test files', () => {
    const result = findRelatedTests('/project/src/foo.test.ts', '/project');
    expect(result).toEqual(['/project/src/foo.test.ts']);
  });

  it('should return empty for files with no tests', () => {
    const tmpDir = path.join(process.env.TEMP || '/tmp', 'find-tests-4-' + Date.now());
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'orphan.ts'), '');

    const result = findRelatedTests(path.join(tmpDir, 'src', 'orphan.ts'), tmpDir);
    expect(result).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ============================================================================
// 会话级单例
// ============================================================================

describe('Session-level singleton', () => {
  it('should return same tracker for same session', () => {
    const t1 = getChangeTracker('session-1');
    const t2 = getChangeTracker('session-1');
    expect(t1).toBe(t2);
  });

  it('should return different trackers for different sessions', () => {
    const t1 = getChangeTracker('session-a');
    const t2 = getChangeTracker('session-b');
    expect(t1).not.toBe(t2);

    // cleanup
    removeChangeTracker('session-a');
    removeChangeTracker('session-b');
  });

  it('should clean up tracker on remove', () => {
    const t1 = getChangeTracker('session-cleanup');
    t1.trackChange('/p/foo.ts', 'Edit');

    removeChangeTracker('session-cleanup');

    const t2 = getChangeTracker('session-cleanup');
    expect(t2.getUnverifiedChanges()).toHaveLength(0);

    removeChangeTracker('session-cleanup');
  });
});
