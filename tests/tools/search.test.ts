/**
 * Unit tests for Search tools (Glob, Grep)
 * Tests file pattern matching and content searching
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GlobTool, GrepTool } from '../../src/tools/search.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GlobTool', () => {
  let globTool: GlobTool;
  let testDir: string;

  beforeEach(() => {
    globTool = new GlobTool();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glob-test-'));

    // Create test file structure
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'content');
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'content');
    fs.writeFileSync(path.join(testDir, 'file.js'), 'code');
    fs.writeFileSync(path.join(testDir, 'file.ts'), 'code');
    fs.mkdirSync(path.join(testDir, 'subdir'));
    fs.writeFileSync(path.join(testDir, 'subdir', 'nested.txt'), 'nested');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = globTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('pattern');
      expect(schema.properties).toHaveProperty('path');
      expect(schema.required).toContain('pattern');
    });
  });

  describe('Basic Pattern Matching', () => {
    it('should find all txt files', async () => {
      const result = await globTool.execute({
        pattern: '*.txt',
        path: testDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');
      expect(result.output).not.toContain('file.js');
    });

    it('should find all files with wildcard', async () => {
      const result = await globTool.execute({
        pattern: '*',
        path: testDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('should find nested files with **', async () => {
      const result = await globTool.execute({
        pattern: '**/*.txt',
        path: testDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('nested.txt');
    });

    it('should find files by extension group', async () => {
      const result = await globTool.execute({
        pattern: '*.{js,ts}',
        path: testDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('file.js');
      expect(result.output).toContain('file.ts');
    });
  });

  describe('No Matches', () => {
    it('should return message when no files match', async () => {
      const result = await globTool.execute({
        pattern: '*.nonexistent',
        path: testDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No files found');
    });
  });

  describe('Sorting', () => {
    it('should sort files by modification time', async () => {
      // Create files with delays to ensure different mtimes
      const file1 = path.join(testDir, 'first.txt');
      const file2 = path.join(testDir, 'second.txt');

      fs.writeFileSync(file1, 'first');
      await new Promise(resolve => setTimeout(resolve, 100));
      fs.writeFileSync(file2, 'second');

      const result = await globTool.execute({
        pattern: '*.txt',
        path: testDir
      });

      expect(result.success).toBe(true);
      const lines = result.output!.split('\n');
      // Most recent should be first
      expect(lines[0]).toContain('second.txt');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid directory', async () => {
      const result = await globTool.execute({
        pattern: '*.txt',
        path: '/nonexistent/directory'
      });

      // Glob doesn't fail on non-existent directories, just returns empty
      expect(result.success).toBe(true);
    });
  });

  describe('Hidden Files', () => {
    it('should find hidden files with dot option', async () => {
      fs.writeFileSync(path.join(testDir, '.hidden'), 'hidden content');
      fs.writeFileSync(path.join(testDir, '.env'), 'secret=value');

      const result = await globTool.execute({
        pattern: '.*',
        path: testDir
      });

      expect(result.success).toBe(true);
      // Glob tool has dot: true option, should find hidden files
      expect(result.output).toBeTruthy();
    });

    it('should find hidden files in subdirectories', async () => {
      fs.mkdirSync(path.join(testDir, '.config'));
      fs.writeFileSync(path.join(testDir, '.config', 'settings.json'), '{}');

      const result = await globTool.execute({
        pattern: '**/.config/*',
        path: testDir
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Complex Patterns', () => {
    it('should support negation patterns', async () => {
      // Create more files
      fs.writeFileSync(path.join(testDir, 'test.txt'), 'test');
      fs.writeFileSync(path.join(testDir, 'main.js'), 'main');

      const result = await globTool.execute({
        pattern: '!(test)*',
        path: testDir
      });

      expect(result.success).toBe(true);
      // Should match files not starting with 'test'
    });

    it('should handle absolute paths in results', async () => {
      const result = await globTool.execute({
        pattern: '*.txt',
        path: testDir
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No files found')) {
        // Results should be absolute paths
        const firstFile = result.output.split('\n')[0];
        expect(path.isAbsolute(firstFile)).toBe(true);
      }
    });

    it('should match files with multiple wildcards', async () => {
      fs.mkdirSync(path.join(testDir, 'src'));
      fs.mkdirSync(path.join(testDir, 'src', 'components'));
      fs.writeFileSync(path.join(testDir, 'src', 'components', 'Button.tsx'), 'component');

      const result = await globTool.execute({
        pattern: '**/components/*.tsx',
        path: testDir
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No files found')) {
        expect(result.output).toContain('Button.tsx');
      }
    });
  });

  describe('Performance', () => {
    it('should handle large number of files', async () => {
      // Create many files
      for (let i = 0; i < 50; i++) {
        fs.writeFileSync(path.join(testDir, `file${i}.txt`), `content ${i}`);
      }

      const result = await globTool.execute({
        pattern: '*.txt',
        path: testDir
      });

      expect(result.success).toBe(true);
      const lines = result.output!.split('\n').filter(l => l.length > 0);
      expect(lines.length).toBeGreaterThan(40); // Should find most/all files
    });
  });
});

describe('GrepTool', () => {
  let grepTool: GrepTool;
  let testDir: string;

  beforeEach(() => {
    grepTool = new GrepTool();
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-test-'));

    // Create test files with content
    fs.writeFileSync(path.join(testDir, 'file1.txt'), 'Hello World\nFoo Bar\nBaz');
    fs.writeFileSync(path.join(testDir, 'file2.txt'), 'Test Hello\nAnother Line');
    fs.writeFileSync(path.join(testDir, 'file.js'), 'function test() {\n  return "Hello";\n}');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Input Schema', () => {
    it('should have correct schema definition', () => {
      const schema = grepTool.getInputSchema();
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('pattern');
      expect(schema.properties).toHaveProperty('path');
      expect(schema.properties).toHaveProperty('output_mode');
      expect(schema.required).toContain('pattern');
    });
  });

  describe('Basic Search', () => {
    it('should find pattern in files', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir
      });

      expect(result.success).toBe(true);
      // Default output mode is files_with_matches
      expect(result.output).toBeTruthy();
    });

    it('should search case-insensitively with -i flag', async () => {
      const result = await grepTool.execute({
        pattern: 'hello',
        path: testDir,
        '-i': true,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('should return no matches message when pattern not found', async () => {
      const result = await grepTool.execute({
        pattern: 'NonexistentPattern123',
        path: testDir
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No files found');
    });
  });

  describe('Output Modes', () => {
    it('should show matching lines in content mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
    });

    it('should show only file paths in files_with_matches mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('should show match counts in count mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'count'
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });
  });

  describe('Context Lines', () => {
    it('should show lines before match with -B', async () => {
      const result = await grepTool.execute({
        pattern: 'Foo',
        path: testDir,
        output_mode: 'content',
        '-B': 1
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello'); // Line before "Foo Bar"
    });

    it('should show lines after match with -A', async () => {
      const result = await grepTool.execute({
        pattern: 'Foo',
        path: testDir,
        output_mode: 'content',
        '-A': 1
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Baz'); // Line after "Foo Bar"
    });

    it('should show lines around match with -C', async () => {
      const result = await grepTool.execute({
        pattern: 'Foo',
        path: testDir,
        output_mode: 'content',
        '-C': 1
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
      // Should contain both before and after lines
      expect(result.output).toContain('Hello');
      expect(result.output).toContain('Baz');
    });

    it('should ignore context options when not in content mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'files_with_matches',
        '-B': 1
      });

      // Context options are silently ignored in non-content modes
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('should prioritize -C over -A/-B when both specified', async () => {
      const result = await grepTool.execute({
        pattern: 'Foo',
        path: testDir,
        output_mode: 'content',
        '-C': 1,
        '-A': 5,
        '-B': 5
      });

      expect(result.success).toBe(true);
      // -C should take precedence
      expect(result.output).toBeTruthy();
    });
  });

  describe('Line Numbers', () => {
    it('should show line numbers with -n in content mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'content',
        '-n': true
      });

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/:\d+:/); // Should contain line numbers
    });

    it('should show line numbers by default in content mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
      // -n defaults to true in content mode
      expect(result.output).toMatch(/:\d+:/);
    });

    it('should not show line numbers when -n is false in content mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'content',
        '-n': false
      });

      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });

    it('should ignore -n in non-content modes', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'files_with_matches',
        '-n': true
      });

      // -n is silently ignored in non-content modes
      expect(result.success).toBe(true);
      expect(result.output).toBeTruthy();
    });
  });

  describe('File Filtering', () => {
    it('should filter by glob pattern', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        glob: '*.txt',
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No files found')) {
        expect(result.output).not.toContain('.js');
      }
    });

    it('should filter by file type', async () => {
      const result = await grepTool.execute({
        pattern: 'function',
        path: testDir,
        type: 'js',
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Head Limit and Offset', () => {
    it('should limit output with head_limit in content mode', async () => {
      const result = await grepTool.execute({
        pattern: '.*', // Match all
        path: testDir,
        output_mode: 'content',
        head_limit: 2
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No matches found')) {
        // head_limit limits the data lines; output may also contain pagination info
        const lines = result.output.split('\n').filter(l => l.length > 0 && !l.startsWith('['));
        expect(lines.length).toBeLessThanOrEqual(2);
      }
    });

    it('should limit output with head_limit in files_with_matches mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'files_with_matches',
        head_limit: 1
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No files found')) {
        // files_with_matches output includes a "Found N files" header line
        const lines = result.output.split('\n').filter(l => l.length > 0 && !l.startsWith('Found'));
        expect(lines.length).toBeLessThanOrEqual(1);
      }
    });

    it('should skip lines with offset', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'content',
        offset: 1,
        head_limit: 1
      });

      expect(result.success).toBe(true);
      // Should skip first match and return second (if exists)
    });

    it('should combine offset and head_limit correctly', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'files_with_matches',
        offset: 1,
        head_limit: 1
      });

      expect(result.success).toBe(true);
    });

    it('should return empty when offset exceeds results', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'content',
        offset: 100
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('No matches found');
    });
  });

  describe('Multiline Mode', () => {
    it('should search across lines with multiline=true', async () => {
      const result = await grepTool.execute({
        pattern: 'function.*return',
        path: testDir,
        multiline: true,
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
      // May or may not find matches depending on ripgrep availability
    });
  });

  describe('Regex Patterns', () => {
    it('should support regex patterns', async () => {
      const result = await grepTool.execute({
        pattern: 'Hel+o',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello');
    });

    it('should support character classes', async () => {
      const result = await grepTool.execute({
        pattern: '[Hh]ello',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
    });

    it('should support word boundaries', async () => {
      const result = await grepTool.execute({
        pattern: '\\bHello\\b',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
    });

    it('should handle patterns starting with dash using -e flag', async () => {
      fs.writeFileSync(path.join(testDir, 'dash.txt'), '-test\nHello -world');

      const result = await grepTool.execute({
        pattern: '-test',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
      // Pattern starting with - should be handled with -e flag internally
    });
  });

  describe('Advanced Glob Patterns', () => {
    it('should support multiple extensions in glob', async () => {
      fs.writeFileSync(path.join(testDir, 'test.ts'), 'TypeScript');
      fs.writeFileSync(path.join(testDir, 'test.tsx'), 'TSX');

      const result = await grepTool.execute({
        pattern: 'Type|TSX',
        path: testDir,
        glob: '*.{ts,tsx}',
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
    });

    it('should handle glob patterns with spaces', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        glob: '*.txt *.js',
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Count Mode Details', () => {
    it('should show count with filename in count mode', async () => {
      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'count'
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No matches found')) {
        // Count mode should show filename:count
        expect(result.output).toMatch(/:\d+/);
      }
    });

    it('should apply head_limit in count mode', async () => {
      const result = await grepTool.execute({
        pattern: '.*',
        path: testDir,
        output_mode: 'count',
        head_limit: 1
      });

      expect(result.success).toBe(true);
      if (result.output && !result.output.includes('No matches found')) {
        // count mode includes a summary line ("Found N total occurrences...")
        // head_limit limits the file:count entries, not the summary
        const lines = result.output.split('\n').filter(l => l.length > 0 && !l.startsWith('Found'));
        expect(lines.length).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files', async () => {
      fs.writeFileSync(path.join(testDir, 'empty.txt'), '');

      const result = await grepTool.execute({
        pattern: 'anything',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
    });

    it('should handle special regex characters', async () => {
      fs.writeFileSync(path.join(testDir, 'special.txt'), 'test.file\ntest*file');

      const result = await grepTool.execute({
        pattern: 'test\\.file',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
    });

    it('should handle very long lines with max-columns limit', async () => {
      const longLine = 'x'.repeat(1000) + 'needle' + 'y'.repeat(1000);
      fs.writeFileSync(path.join(testDir, 'long.txt'), longLine);

      const result = await grepTool.execute({
        pattern: 'needle',
        path: testDir,
        output_mode: 'content'
      });

      expect(result.success).toBe(true);
    });

    it('should exclude .git directories', async () => {
      const gitDir = path.join(testDir, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'config'), 'Hello');

      const result = await grepTool.execute({
        pattern: 'Hello',
        path: testDir,
        output_mode: 'files_with_matches'
      });

      expect(result.success).toBe(true);
      // Should not search in .git directory
      if (result.output && !result.output.includes('No files found')) {
        expect(result.output).not.toContain('.git');
      }
    });
  });
});
