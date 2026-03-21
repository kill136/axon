import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
  files?: string[];
  scripts?: Record<string, string>;
};

describe('npm package manifest', () => {
  it('includes the built web client assets in published files', () => {
    expect(packageJson.files).toContain('src/web/client/dist');
  });

  it('builds the web client before publish', () => {
    expect(packageJson.scripts?.['build:web:client']).toBe('npm --prefix src/web/client run build');
    expect(packageJson.scripts?.prepublishOnly).toContain('npm run build:web:client');
  });
});
