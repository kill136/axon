import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type SkillModule = typeof import('../src/tools/skill.js');

async function waitFor(condition: () => boolean, timeoutMs: number = 5000): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (condition()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('Skill Hot Reload', () => {
  const originalCwd = process.cwd();
  let tempRoot = '';
  let tempHome = '';
  let skillModule: SkillModule | null = null;

  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-skill-hot-reload-'));
    tempHome = path.join(tempRoot, 'home');
    fs.mkdirSync(tempHome, { recursive: true });
    vi.stubEnv('HOME', tempHome);
    vi.stubEnv('USERPROFILE', tempHome);
    vi.resetModules();
    skillModule = await import('../src/tools/skill.js');
  });

  afterEach(() => {
    skillModule?.disableSkillHotReload();
    skillModule?.clearSkillCache();
    skillModule = null;
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('hot reloads created, updated, and deleted user skills without restarting the session', async () => {
    const projectDir = path.join(tempRoot, 'project');
    fs.mkdirSync(path.join(tempHome, '.axon', 'skills'), { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    process.chdir(projectDir);

    await skillModule!.initializeSkills();
    await new Promise(resolve => setTimeout(resolve, 100));

    const skillDir = path.join(tempHome, '.axon', 'skills', 'live-reload');
    const skillFile = path.join(skillDir, 'SKILL.md');

    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      skillFile,
      `---
name: Live Reload V1
description: First version
---

# V1

Initial body.
`,
      'utf-8'
    );

    await waitFor(() => {
      const skill = skillModule!.findSkill('live-reload');
      return skill?.displayName === 'Live Reload V1' && skill.description === 'First version';
    });

    fs.writeFileSync(
      skillFile,
      `---
name: Live Reload V2
description: Second version
---

# V2

Updated body.
`,
      'utf-8'
    );

    await waitFor(() => {
      const skill = skillModule!.findSkill('live-reload');
      return (
        skill?.displayName === 'Live Reload V2' &&
        skill.description === 'Second version' &&
        skill.markdownContent.includes('# V2')
      );
    });

    fs.rmSync(skillDir, { recursive: true, force: true });

    await waitFor(() => !skillModule!.findSkill('live-reload'));
  }, 15000);

  it('reloads project skills when the working directory changes', async () => {
    const projectA = path.join(tempRoot, 'project-a');
    const projectB = path.join(tempRoot, 'project-b');
    const skillAFile = path.join(projectA, '.axon', 'skills', 'only-a', 'SKILL.md');
    const skillBFile = path.join(projectB, '.axon', 'skills', 'only-b', 'SKILL.md');

    fs.mkdirSync(path.dirname(skillAFile), { recursive: true });
    fs.mkdirSync(path.dirname(skillBFile), { recursive: true });

    fs.writeFileSync(
      skillAFile,
      `---
description: Project A only
---

# A
`,
      'utf-8'
    );

    fs.writeFileSync(
      skillBFile,
      `---
description: Project B only
---

# B
`,
      'utf-8'
    );

    process.chdir(projectA);
    await skillModule!.initializeSkills();
    expect(skillModule!.findSkill('only-a')).toBeDefined();
    expect(skillModule!.findSkill('only-b')).toBeUndefined();

    process.chdir(projectB);
    await skillModule!.initializeSkills();
    expect(skillModule!.findSkill('only-b')).toBeDefined();
    expect(skillModule!.findSkill('only-a')).toBeUndefined();
  });
});
