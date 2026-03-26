import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskExecutor } from '../../src/daemon/executor.js';
import { NotebookManager } from '../../src/memory/notebook.js';

describe('TaskExecutor memory injection', () => {
  let configDir: string;
  let projectDir: string;
  const originalConfigDir = process.env.AXON_CONFIG_DIR;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-daemon-memory-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-daemon-project-'));
    process.env.AXON_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (originalConfigDir) {
      process.env.AXON_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.AXON_CONFIG_DIR;
    }

    for (const dir of [configDir, projectDir]) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('injects profile, experience, and project notebooks into daemon prompts', () => {
    const notebookMgr = new NotebookManager(projectDir);
    notebookMgr.write('profile', '# User Profile\n- Language: Chinese\n- Prefers concise answers');
    notebookMgr.write('experience', '# Experience Notebook\n- Avoid TODO placeholders');
    notebookMgr.write('project', '# Project Notebook\n- Update tests together with feature changes');

    const executor = new TaskExecutor({
      maxConcurrent: 1,
      notifier: { send: vi.fn().mockResolvedValue(undefined) } as any,
      logFile: path.join(configDir, 'daemon.log'),
      defaultModel: 'sonnet',
      defaultPermissionMode: 'acceptEdits',
      defaultWorkingDir: projectDir,
    });

    const prompt = (executor as any).buildEnrichedPrompt(
      {
        name: 'Daily report',
        prompt: 'Summarize the latest project state',
        notify: ['desktop'],
        workingDir: projectDir,
      },
      'Summarize the latest project state',
      projectDir,
    );

    expect(prompt).toContain('## User Profile');
    expect(prompt).toContain('Prefers concise answers');
    expect(prompt).toContain('## User Experience');
    expect(prompt).toContain('Avoid TODO placeholders');
    expect(prompt).toContain('## Project Information');
    expect(prompt).toContain('Update tests together with feature changes');
  });
});
