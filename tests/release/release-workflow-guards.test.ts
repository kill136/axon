import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'release.yml');
const workflowContents = fs.readFileSync(workflowPath, 'utf8');

describe('release workflow guards', () => {
  it('does not reference secrets directly in if conditions', () => {
    const ifLines = workflowContents
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith('if:'));

    expect(ifLines.some(line => line.includes('secrets.'))).toBe(false);
  });

  it('exposes Tencent COS secrets through job env before using them in conditions', () => {
    expect(workflowContents).toContain('build-electron-windows:');
    expect(workflowContents).toContain('TENCENT_COS_SECRET_ID: ${{ secrets.TENCENT_COS_SECRET_ID }}');
    expect(workflowContents).toContain("if: ${{ env.TENCENT_COS_SECRET_ID != '' && env.TENCENT_COS_SECRET_KEY != '' && env.TENCENT_COS_BUCKET != '' && env.TENCENT_COS_REGION != '' }}");
  });
});
