import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildDefaultPublicBaseUrl,
  buildPublicUrl,
  createTencentCosUploadConfig,
  normalizeRegion,
  uploadInstallerToTencentCos,
} = require('../../scripts/tencent-cos-utils.cjs') as {
  buildDefaultPublicBaseUrl: (bucket: string, region: string) => string;
  buildPublicUrl: (publicBaseUrl: string, objectKey: string) => string;
  createTencentCosUploadConfig: (
    env?: Record<string, string>,
    options?: { defaultObjectKey?: string },
  ) => {
    secretId: string;
    secretKey: string;
    bucket: string;
    region: string;
    objectKey: string;
    publicBaseUrl: string;
    publicUrl: string;
    cacheControl: string;
    objectAcl: string;
  };
  normalizeRegion: (value?: string | null) => string | null;
  uploadInstallerToTencentCos: (options: {
    cosSdk: any;
    env: Record<string, string>;
    filePath: string;
    cwd?: string;
    githubOutputPath?: string;
  }) => Promise<{
    publicUrl: string;
    publicBaseUrl: string;
    objectKey: string;
    sha256: string;
    filePath: string;
    region: string;
    bucket: string;
    cacheControl: string;
    objectAcl: string;
  }>;
};

const tempDirs: string[] = [];

function createTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'axon-cos-'));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe('tencent cos utils', () => {
  it('builds the default myqcloud public base url', () => {
    expect(buildDefaultPublicBaseUrl('axon-1250000000', 'ap-guangzhou')).toBe(
      'https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/',
    );
  });

  it('builds a normalized upload config from env vars', () => {
    const config = createTencentCosUploadConfig({
      TENCENT_COS_SECRET_ID: ' sid ',
      TENCENT_COS_SECRET_KEY: ' sk ',
      TENCENT_COS_BUCKET: ' axon-1250000000 ',
      TENCENT_COS_REGION: ' AP-GUANGZHOU ',
      TENCENT_COS_OBJECT_KEY: ' releases\\Axon Setup.exe ',
      TENCENT_COS_PUBLIC_BASE_URL: 'https://downloads.example.com/base',
      TENCENT_COS_CACHE_CONTROL: ' public, max-age=600 ',
    });

    expect(config).toEqual({
      secretId: 'sid',
      secretKey: 'sk',
      bucket: 'axon-1250000000',
      region: 'ap-guangzhou',
      objectKey: 'releases/Axon Setup.exe',
      publicBaseUrl: 'https://downloads.example.com/base/',
      publicUrl: 'https://downloads.example.com/base/releases/Axon%20Setup.exe',
      cacheControl: 'public, max-age=600',
      objectAcl: 'public-read',
    });
  });

  it('falls back to the official default domain when no public base url is provided', () => {
    const config = createTencentCosUploadConfig({
      TENCENT_COS_SECRET_ID: 'sid',
      TENCENT_COS_SECRET_KEY: 'sk',
      TENCENT_COS_BUCKET: 'axon-1250000000',
      TENCENT_COS_REGION: 'ap-guangzhou',
    });

    expect(config.publicBaseUrl).toBe('https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/');
    expect(config.publicUrl).toBe('https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/Axon-Setup.exe');
    expect(config.cacheControl).toBe('no-cache');
    expect(config.objectAcl).toBe('public-read');
  });

  it('throws a clear error when required env vars are missing', () => {
    expect(() => createTencentCosUploadConfig({
      TENCENT_COS_SECRET_ID: 'sid',
    })).toThrow(
      'Missing required Tencent COS env vars: TENCENT_COS_SECRET_KEY, TENCENT_COS_BUCKET, TENCENT_COS_REGION',
    );
  });

  it('encodes nested object keys into a stable public url', () => {
    expect(
      buildPublicUrl('https://downloads.example.com/base/', 'releases/Axon Setup.exe'),
    ).toBe('https://downloads.example.com/base/releases/Axon%20Setup.exe');
  });

  it('normalizes COS region identifiers', () => {
    expect(normalizeRegion(' AP-SHANGHAI ')).toBe('ap-shanghai');
    expect(normalizeRegion('')).toBeNull();
    expect(normalizeRegion(undefined)).toBeNull();
  });

  it('uploads the installer and writes github outputs', async () => {
    const tempDir = createTempDir();
    const filePath = path.join(tempDir, 'Axon-Setup.exe');
    const outputPath = path.join(tempDir, 'github-output.txt');
    fs.writeFileSync(filePath, 'axon-installer-binary', 'utf8');

    class FakeCos {
      options: Record<string, unknown>;

      constructor(options: Record<string, unknown>) {
        this.options = options;
      }

      async uploadFile(params: Record<string, unknown>) {
        expect(this.options).toEqual({
          SecretId: 'sid',
          SecretKey: 'sk',
        });
        expect(params).toMatchObject({
          Bucket: 'axon-1250000000',
          Region: 'ap-guangzhou',
          Key: 'Axon-Setup.exe',
          ACL: 'public-read',
          FilePath: filePath,
          SliceSize: 1024 * 1024 * 5,
          Headers: expect.objectContaining({
            'Cache-Control': 'no-cache',
            'Content-Disposition': 'attachment; filename="Axon-Setup.exe"',
          }),
        });

        return {
          statusCode: 200,
          ETag: '"etag-123"',
        };
      }
    }

    const result = await uploadInstallerToTencentCos({
      cosSdk: FakeCos,
      env: {
        TENCENT_COS_SECRET_ID: 'sid',
        TENCENT_COS_SECRET_KEY: 'sk',
        TENCENT_COS_BUCKET: 'axon-1250000000',
        TENCENT_COS_REGION: 'ap-guangzhou',
      },
      filePath,
      githubOutputPath: outputPath,
    });

    expect(result).toMatchObject({
      publicUrl: 'https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/Axon-Setup.exe',
      publicBaseUrl: 'https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/',
      objectKey: 'Axon-Setup.exe',
      filePath,
      region: 'ap-guangzhou',
      bucket: 'axon-1250000000',
      cacheControl: 'no-cache',
      objectAcl: 'public-read',
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);

    const outputContent = fs.readFileSync(outputPath, 'utf8');
    expect(outputContent).toContain(
      'public_url=https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/Axon-Setup.exe',
    );
    expect(outputContent).toContain(
      'public_base_url=https://axon-1250000000.cos.ap-guangzhou.myqcloud.com/',
    );
    expect(outputContent).toContain('object_key=Axon-Setup.exe');
    expect(outputContent).toContain('region=ap-guangzhou');
    expect(outputContent).toContain('bucket=axon-1250000000');
    expect(outputContent).toContain('object_acl=public-read');
    expect(outputContent).toContain(`sha256=${result.sha256}`);
  });
});
