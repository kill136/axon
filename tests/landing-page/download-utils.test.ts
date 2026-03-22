import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildDownloadPath,
  detectDownloadRegion,
  isAllowed,
  resolveDownloadTarget,
  resolveMirrorUrl,
} = require('../../landing-page/download-utils.cjs') as {
  buildDownloadPath: (filename: string, region?: string) => string;
  detectDownloadRegion: (req: { query?: Record<string, string>; headers?: Record<string, string> }) => string;
  isAllowed: (filename: string) => boolean;
  resolveDownloadTarget: (input: {
    filename: string;
    env?: Record<string, string>;
    region?: string;
    req?: { query?: Record<string, string>; headers?: Record<string, string> };
  }) => {
    type: string;
    region: string;
    redirectUrl: string | null;
    source: string;
  };
  resolveMirrorUrl: (
    filename: string,
    env: Record<string, string>,
    region?: string,
  ) => {
    url: string;
    source: string;
    mirrorRegion: string;
  } | null;
};

function buildExpectedQiniuSignedUrl(filename: string, nowMs: number, ttlSeconds = 300) {
  const deadline = Math.floor(nowMs / 1000) + ttlSeconds;
  const baseToSign = `http://cdn.chatbi.site/${filename}?e=${deadline}`;
  const token = `test-ak:${String(
    createHmac('sha1', 'test-sk').update(baseToSign).digest('base64'),
  ).replace(/\//g, '_').replace(/\+/g, '-')}`;

  return `${baseToSign}&token=${token}`;
}

describe('landing-page download utils', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows known installer filenames and rejects unknown files', () => {
    expect(isAllowed('Axon-Setup.exe')).toBe(true);
    expect(isAllowed('Axon-Setup.dmg')).toBe(true);
    expect(isAllowed('install.ps1')).toBe(true);
    expect(isAllowed('malware.exe')).toBe(false);
  });

  it('detects cn region from explicit query override', () => {
    expect(detectDownloadRegion({
      query: { region: 'cn' },
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    })).toBe('cn');
  });

  it('detects cn region from country and language headers', () => {
    expect(detectDownloadRegion({
      headers: { 'x-vercel-ip-country': 'CN' },
    })).toBe('cn');

    expect(detectDownloadRegion({
      headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    })).toBe('cn');
  });

  it('does not misclassify traditional Chinese locales as cn mirror traffic', () => {
    expect(detectDownloadRegion({
      headers: { 'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    })).toBe('global');
  });

  it('prefers region-specific file mirror over base mirrors', () => {
    const mirror = resolveMirrorUrl('Axon-Setup.exe', {
      DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL: 'https://download-cn.chatbi.site/custom/Axon-Setup.exe',
      DOWNLOAD_MIRROR_CN_BASE_URL: 'https://download-cn.chatbi.site/base/',
      DOWNLOAD_MIRROR_BASE_URL: 'https://downloads.chatbi.site/base/',
    }, 'cn');

    expect(mirror).toEqual({
      url: 'https://download-cn.chatbi.site/custom/Axon-Setup.exe',
      source: 'DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL',
      mirrorRegion: 'cn',
    });
  });

  it('falls back to global mirror when cn mirror is missing', () => {
    const target = resolveDownloadTarget({
      filename: 'Axon-Setup.exe',
      env: {
        DOWNLOAD_MIRROR_BASE_URL: 'https://downloads.chatbi.site/axon/',
      },
      region: 'cn',
    });

    expect(target).toEqual({
      type: 'mirror',
      region: 'cn',
      redirectUrl: 'https://downloads.chatbi.site/axon/Axon-Setup.exe',
      source: 'DOWNLOAD_MIRROR_BASE_URL',
      mirrorRegion: 'global',
    });
  });

  it('falls back to github proxy when no mirror is configured', () => {
    const target = resolveDownloadTarget({
      filename: 'Axon-Setup.exe',
      env: {},
      region: 'cn',
    });

    expect(target).toEqual({
      type: 'github-proxy',
      region: 'cn',
      redirectUrl: null,
      source: 'github-proxy',
      mirrorRegion: null,
    });
  });

  it('builds a signed qiniu mirror url for cn stable downloads when static mirrors are absent', () => {
    const nowMs = Date.parse('2026-03-22T08:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);

    const target = resolveDownloadTarget({
      filename: 'Axon-Setup.exe',
      env: {
        QINIU_ACCESS_KEY: 'test-ak',
        QINIU_SECRET_KEY: 'test-sk',
        QINIU_PUBLIC_BASE_URL: 'http://cdn.chatbi.site',
      },
      region: 'cn',
    });

    expect(target).toEqual({
      type: 'mirror',
      region: 'cn',
      redirectUrl: buildExpectedQiniuSignedUrl('Axon-Setup.exe', nowMs),
      source: 'QINIU_SIGNED_URL',
      mirrorRegion: 'cn',
    });
  });

  it('does not sign versioned archives through qiniu when only stable aliases should use the mirror', () => {
    const target = resolveDownloadTarget({
      filename: 'axon-windows-x64-v2.5.1.zip',
      env: {
        QINIU_ACCESS_KEY: 'test-ak',
        QINIU_SECRET_KEY: 'test-sk',
        QINIU_PUBLIC_BASE_URL: 'http://cdn.chatbi.site',
      },
      region: 'cn',
    });

    expect(target).toEqual({
      type: 'github-proxy',
      region: 'cn',
      redirectUrl: null,
      source: 'github-proxy',
      mirrorRegion: null,
    });
  });

  it('builds download paths with explicit region hints', () => {
    expect(buildDownloadPath('Axon-Setup.exe', 'cn')).toBe('/download/Axon-Setup.exe?region=cn');
    expect(buildDownloadPath('Axon-Setup.exe')).toBe('/download/Axon-Setup.exe');
  });

  it('throws on invalid mirror base urls so config errors are visible', () => {
    expect(() => resolveMirrorUrl('Axon-Setup.exe', {
      DOWNLOAD_MIRROR_CN_BASE_URL: 'not-a-valid-url',
    }, 'cn')).toThrow('Invalid mirror base URL in DOWNLOAD_MIRROR_CN_BASE_URL');
  });
});
