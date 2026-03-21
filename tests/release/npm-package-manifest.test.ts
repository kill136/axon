import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const packageJsonPath = path.join(process.cwd(), 'package.json');
const gitignorePath = path.join(process.cwd(), '.gitignore');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
  files?: string[];
  scripts?: Record<string, string>;
};
const gitignoreContents = fs.readFileSync(gitignorePath, 'utf8');

function runGit(args: string[]) {
  return spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

describe('npm package manifest', () => {
  it('includes the built web client assets in published files', () => {
    expect(packageJson.files).toContain('src/web/client/dist');
  });

  it('builds the web client before publish', () => {
    expect(packageJson.scripts?.['build:web:client']).toBe('npm --prefix src/web/client run build');
    expect(packageJson.scripts?.prepublishOnly).toContain('npm run build:web:client');
  });

  it('does not ignore required runtime source files during release', () => {
    expect(gitignoreContents).toContain('!src/core/max-tokens.ts');

    const trackedResult = runGit(['ls-files', '--error-unmatch', 'src/core/max-tokens.ts']);
    expect(trackedResult.status).toBe(0);
  });
});
