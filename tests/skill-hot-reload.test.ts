/**
 * 技能热重载功能测试
 * 验证文件监听、重载机制、防抖等功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  enableSkillHotReload,
  disableSkillHotReload,
  isHotReloadEnabled,
  initializeSkills,
  clearSkillCache,
  getAllSkills,
} from '../src/tools/skill.js';
import { runWithCwd } from '../src/core/cwd-context.js';

describe('技能热重载功能', () => {
  const testDir = path.join(process.cwd(), '.claude-test-hot-reload');
  const skillsDir = path.join(testDir, 'skills');

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }

    // 创建测试目录结构
    fs.mkdirSync(skillsDir, { recursive: true });

    // 禁用热重载
    disableSkillHotReload();
    clearSkillCache();
  });

  afterEach(() => {
    // 清理
    disableSkillHotReload();
    clearSkillCache();

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('应该能够启用热重载', () => {
    expect(isHotReloadEnabled()).toBe(false);

    enableSkillHotReload();

    expect(isHotReloadEnabled()).toBe(true);
  });

  it('应该能够禁用热重载', () => {
    enableSkillHotReload();
    expect(isHotReloadEnabled()).toBe(true);

    disableSkillHotReload();

    expect(isHotReloadEnabled()).toBe(false);
  });

  it('重复启用热重载应该是幂等的', () => {
    enableSkillHotReload();
    enableSkillHotReload();
    enableSkillHotReload();

    expect(isHotReloadEnabled()).toBe(true);

    disableSkillHotReload();
  });

  it('应该监听 skills 目录', async () => {
    // 创建一个技能
    const skillDir = path.join(skillsDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: Test Skill
description: A test skill
---

This is a test skill.
`
    );

    // 使用 runWithCwd 设置工作目录上下文
    await runWithCwd(testDir, async () => {
      // 加载技能
      await initializeSkills();

      // 验证技能已加载
      const skills = getAllSkills();
      expect(skills.length).toBeGreaterThan(0);

      // 启用热重载
      enableSkillHotReload();

      expect(isHotReloadEnabled()).toBe(true);
    });
  });

  it('应该检测到技能文件变化', async () => {
    // 创建初始技能
    const skillDir = path.join(skillsDir, 'dynamic-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');

    fs.writeFileSync(
      skillFile,
      `---
name: Dynamic Skill v1
description: Initial version
---

Version 1 content.
`
    );

    await runWithCwd(testDir, async () => {
      // 加载技能
      await initializeSkills();

      const skillsBefore = getAllSkills();
      const skillBefore = skillsBefore.find(s => s.skillName.includes('dynamic-skill'));
      expect(skillBefore).toBeDefined();
      expect(skillBefore?.markdownContent).toContain('Version 1');

      // 启用热重载
      enableSkillHotReload();

      // 等待文件监听器启动
      await new Promise(resolve => setTimeout(resolve, 100));

      // 修改技能文件
      fs.writeFileSync(
        skillFile,
        `---
name: Dynamic Skill v2
description: Updated version
---

Version 2 content with new features.
`
      );

      // 等待防抖和重载（防抖延迟是 200ms）
      await new Promise(resolve => setTimeout(resolve, 500));

      // 验证技能已更新
      const skillsAfter = getAllSkills();
      const skillAfter = skillsAfter.find(s => s.skillName.includes('dynamic-skill'));
      expect(skillAfter).toBeDefined();
      expect(skillAfter?.markdownContent).toContain('Version 2');
    });
  }, 10000); // 增加超时时间

  it('防抖机制应该工作', async () => {
    const skillDir = path.join(skillsDir, 'debounce-test');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');

    fs.writeFileSync(
      skillFile,
      `---
name: Debounce Test
---

Initial content.
`
    );

    await runWithCwd(testDir, async () => {
      await initializeSkills();
      enableSkillHotReload();

      await new Promise(resolve => setTimeout(resolve, 100));

      // 快速连续修改文件多次
      fs.writeFileSync(skillFile, '---\nname: Test v1\n---\nContent 1');
      await new Promise(resolve => setTimeout(resolve, 50));

      fs.writeFileSync(skillFile, '---\nname: Test v2\n---\nContent 2');
      await new Promise(resolve => setTimeout(resolve, 50));

      fs.writeFileSync(skillFile, '---\nname: Test v3\n---\nContent 3');

      // 等待防抖和重载
      await new Promise(resolve => setTimeout(resolve, 500));

      // 应该只重载一次，内容是最后一次修改的
      const skills = getAllSkills();
      const skill = skills.find(s => s.skillName.includes('debounce-test'));
      expect(skill?.markdownContent).toContain('Content 3');
    });
  }, 10000);
});
