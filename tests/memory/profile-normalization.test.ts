import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotebookManager, resetNotebookManager } from '../../src/memory/notebook.js';

describe('Profile notebook normalization', () => {
  let configDir: string;
  let projectDir: string;
  const originalConfigDir = process.env.AXON_CONFIG_DIR;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-profile-notebook-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-profile-project-'));
    process.env.AXON_CONFIG_DIR = configDir;
    resetNotebookManager();
  });

  afterEach(() => {
    if (originalConfigDir) {
      process.env.AXON_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.AXON_CONFIG_DIR;
    }

    resetNotebookManager();

    for (const dir of [configDir, projectDir]) {
      try {
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch {}
    }
  });

  it('initializes profile with the canonical section layout', () => {
    const manager = new NotebookManager(projectDir);
    const profile = manager.read('profile');

    expect(profile).toContain('# User Profile');
    expect(profile).toContain('## Basic Info');
    expect(profile).toContain('## Stable Preferences');
    expect(profile).toContain('## Communication Style');
    expect(profile).toContain('## Working Style');
    expect(profile).toContain('## Decision Signals');
    expect(profile).toContain('## Values & Motivations');
    expect(profile).toContain('## Do Not Assume / Open Questions');
  });

  it('normalizes legacy flat profile content into structured sections on write', () => {
    const manager = new NotebookManager(projectDir);
    manager.write(
      'profile',
      `# User Profile
- Language: Chinese
- Prefers direct, concise answers
- Gets frustrated when explicit corrections are ignored`,
    );

    const profile = manager.read('profile');

    expect(profile).toContain('## Basic Info\n- Language: Chinese');
    expect(profile).toContain('## Communication Style\n- Prefers direct, concise answers');
    expect(profile).toContain('## Decision Signals\n- Gets frustrated when explicit corrections are ignored');
  });

  it('migrates existing unstructured profile files when read', () => {
    const manager = new NotebookManager(projectDir);
    const profilePath = manager.getPath('profile');
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(
      profilePath,
      `# User Profile
- Role: Product engineer
- Prefers proactive suggestions`,
      'utf-8',
    );

    const profile = manager.read('profile');
    const persisted = fs.readFileSync(profilePath, 'utf-8');

    expect(profile).toContain('## Basic Info\n- Role: Product engineer');
    expect(profile).toContain('## Stable Preferences\n- Prefers proactive suggestions');
    expect(persisted).toContain('## Basic Info');
    expect(persisted).toContain('## Stable Preferences');
  });

  it('normalizes metadata blocks into a single deduplicated bullet', () => {
    const manager = new NotebookManager(projectDir);
    manager.write(
      'profile',
      `# User Profile

## Communication Style
- Prefers direct, concise replies
  - Updated: 2026-03-18
  - Evidence: user stated directly
- Prefers direct, concise replies [updated: 2026-03-21; evidence: user reiterated preference]`,
    );

    const profile = manager.read('profile');

    expect(profile).toContain(
      '- Prefers direct, concise replies [updated: 2026-03-21; evidence: user reiterated preference]',
    );
    expect(profile.match(/Prefers direct, concise replies/g)?.length).toBe(1);
  });

  it('replaces contradicted bullets and prunes resolved open questions', () => {
    const manager = new NotebookManager(projectDir);
    manager.write(
      'profile',
      `# User Profile

## Communication Style
- Wants long, detailed explanations [updated: 2026-03-10; evidence: earlier assumption]
- Does not want long-winded explanations; prefers concise replies [updated: 2026-03-21; evidence: explicit correction]

## Do Not Assume / Open Questions
- Confirm whether the user prefers concise replies or detailed explanations [updated: 2026-03-20; evidence: prior uncertainty]`,
    );

    const profile = manager.read('profile');

    expect(profile).not.toContain('Wants long, detailed explanations');
    expect(profile).toContain('Does not want long-winded explanations; prefers concise replies');
    expect(profile).not.toContain('Confirm whether the user prefers concise replies or detailed explanations');
  });
});
