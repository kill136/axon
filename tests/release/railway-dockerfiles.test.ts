import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rootDockerfilePath = path.join(process.cwd(), 'Dockerfile.railway');
const landingDockerfilePath = path.join(process.cwd(), 'landing-page', 'Dockerfile');

const rootDockerfile = fs.readFileSync(rootDockerfilePath, 'utf8');
const landingDockerfile = fs.readFileSync(landingDockerfilePath, 'utf8');

describe('Railway Dockerfiles', () => {
  it('skips Electron binary downloads before installing root dependencies', () => {
    const skipBinaryIndex = rootDockerfile.indexOf('ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1');
    const installIndex = rootDockerfile.indexOf('RUN npm ci');

    expect(skipBinaryIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(-1);
    expect(skipBinaryIndex).toBeLessThan(installIndex);
  });

  it('uses lockfile installs for Railway builds', () => {
    expect(rootDockerfile).toContain('RUN npm ci');
    expect(rootDockerfile).toContain('RUN npm --prefix src/web/client ci');
    expect(rootDockerfile).not.toContain('RUN npm install');
    expect(rootDockerfile).not.toContain('npm --prefix src/web/client install');
  });

  it('keeps the landing-page healthcheck self-contained without curl', () => {
    expect(landingDockerfile).toContain("CMD node -e \"const http=require('http');");
    expect(landingDockerfile).not.toContain('CMD curl -f');
  });
});
