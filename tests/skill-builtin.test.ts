/**
 * Builtin Skills 加载测试
 *
 * 验证内置 skills 从 src/skills/builtin/ 正确加载，
 * 优先级正确（用户级可覆盖内置），且随版本自动更新
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

describe('Builtin Skills', () => {
  describe('getBuiltinSkillsDir', () => {
    it('should locate builtin skills directory relative to source root', () => {
      // 验证 src/skills/builtin/ 目录存在
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const builtinDir = path.join(projectRoot, 'src', 'skills', 'builtin');

      expect(fs.existsSync(builtinDir)).toBe(true);
    });

    it('should contain SKILL.md in each builtin skill directory', () => {
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const builtinDir = path.join(projectRoot, 'src', 'skills', 'builtin');

      const entries = fs.readdirSync(builtinDir, { withFileTypes: true });
      const skillDirs = entries.filter(e => e.isDirectory());

      // 至少应该有 tool-discovery 和 skill-hub
      expect(skillDirs.length).toBeGreaterThanOrEqual(2);

      for (const dir of skillDirs) {
        const skillFile = path.join(builtinDir, dir.name, 'SKILL.md');
        expect(fs.existsSync(skillFile)).toBe(true);
      }
    });

    it('should include core builtin skills', () => {
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const builtinDir = path.join(projectRoot, 'src', 'skills', 'builtin');

      const entries = fs.readdirSync(builtinDir, { withFileTypes: true });
      const skillNames = entries.filter(e => e.isDirectory()).map(e => e.name);

      // 验证核心 skills 存在
      const coreSkills = [
        'tool-discovery',
        'skill-hub',
        'pdf',
        'docx',
        'xlsx',
        'pptx',
        'code-review',
        'frontend-design',
        'skill-creator',
      ];

      for (const name of coreSkills) {
        expect(skillNames).toContain(name);
      }
    });
  });

  describe('SkillSource type includes builtin', () => {
    it('should accept builtin as a valid source', async () => {
      // 通过读取源码验证 SkillSource 包含 'builtin'
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const skillTsPath = path.join(projectRoot, 'src', 'tools', 'skill.ts');

      const content = fs.readFileSync(skillTsPath, 'utf-8');
      expect(content).toContain("'builtin'");
    });
  });

  describe('Builtin skills SKILL.md format', () => {
    it('should have valid frontmatter with name and description', () => {
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const builtinDir = path.join(projectRoot, 'src', 'skills', 'builtin');

      const entries = fs.readdirSync(builtinDir, { withFileTypes: true });
      const skillDirs = entries.filter(e => e.isDirectory());

      for (const dir of skillDirs) {
        const skillFile = path.join(builtinDir, dir.name, 'SKILL.md');
        const content = fs.readFileSync(skillFile, 'utf-8');

        // 验证有 frontmatter
        expect(content.startsWith('---')).toBe(true);

        // 提取 frontmatter
        const endIdx = content.indexOf('---', 3);
        expect(endIdx).toBeGreaterThan(3);

        const frontmatter = content.substring(3, endIdx);

        // 验证有 description 字段（name 可选，目录名作为默认 skillName）
        expect(frontmatter).toMatch(/description:\s*.+/);
      }
    });
  });

  describe('Loading priority', () => {
    it('should load builtin skills before user skills in initializeSkills', async () => {
      // 通过读取源码验证加载顺序
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const skillTsPath = path.join(projectRoot, 'src', 'tools', 'skill.ts');

      const content = fs.readFileSync(skillTsPath, 'utf-8');

      // 验证加载顺序：builtin 在 plugin 之后，user 之前
      const builtinIdx = content.indexOf("loadSkillsFromDirectory(context.builtinSkillsDir, 'builtin')");
      const userIdx = content.indexOf("loadSkillsFromDirectory(context.userSkillsDir, 'userSettings')");
      const projectIdx = content.indexOf("loadSkillsFromDirectory(context.projectSkillsDir, 'projectSettings')");

      expect(builtinIdx).toBeGreaterThan(0);
      expect(userIdx).toBeGreaterThan(builtinIdx);
      expect(projectIdx).toBeGreaterThan(userIdx);
    });
  });

  describe('Build script includes builtin skills', () => {
    it('should copy src/skills/builtin to dist/skills/builtin in build', () => {
      const __filename = fileURLToPath(import.meta.url);
      const testDir = path.dirname(__filename);
      const projectRoot = path.resolve(testDir, '..');
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')
      );

      // 验证 build 脚本包含 skills/builtin 复制
      expect(pkgJson.scripts.build).toContain("skills/builtin");
    });
  });
});
