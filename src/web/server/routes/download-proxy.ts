/**
 * Download Proxy - 代理 GitHub Release 私有仓库的安装包下载
 *
 * 仓库私有化后，GitHub Releases 的下载链接对未登录用户不可用。
 * 此路由通过 GitHub API + token 获取临时下载 URL，302 重定向给用户。
 *
 * 环境变量:
 *   GITHUB_TOKEN - GitHub Personal Access Token（需要 repo 权限）
 *
 * 路由:
 *   GET /download/:filename  - 302 重定向到 GitHub Release 临时 URL
 *   GET /api/download/latest - 返回最新 release 信息
 */

import { createHmac } from 'node:crypto';
import { Router, Request, Response } from 'express';

const router = Router();

const GITHUB_REPO = 'kill136/axon';

const ALLOWED_FILES = [
  /^Axon-Setup\.exe$/,
  /^Axon-Setup\.dmg$/,
  /^Axon-Setup\.AppImage$/,
  /^Axon-Windows-Portable-v[\d.]+\.zip$/,
  /^axon-(windows|linux|macos)-(x64|arm64)-v[\d.]+\.(zip|tar\.gz)$/,
  /^install\.(bat|ps1)$/,
];

const STABLE_MIRROR_FILES = [
  'Axon-Setup.exe',
  'Axon-Setup.dmg',
  'Axon-Setup.AppImage',
  'install.bat',
  'install.ps1',
] as const;

type DownloadRegion = 'auto' | 'cn' | 'global';
type MirrorRegion = Exclude<DownloadRegion, 'auto'>;
type StableMirrorFile = (typeof STABLE_MIRROR_FILES)[number];

function isAllowed(filename: string): boolean {
  return ALLOWED_FILES.some(p => p.test(filename));
}

function normalizeRequestedRegion(value?: unknown): DownloadRegion {
  if (!value) return 'auto';

  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'auto') return 'auto';
  if (['cn', 'china', 'mainland-china', 'mainland_china'].includes(normalized)) {
    return 'cn';
  }
  if (['global', 'intl', 'international', 'default', 'world'].includes(normalized)) {
    return 'global';
  }

  return 'auto';
}

function getHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function detectDownloadRegion(req: Request): MirrorRegion {
  const explicitRegion = normalizeRequestedRegion(
    req.query?.region ?? req.query?.mirror ?? getHeader(req, 'x-download-region'),
  );

  if (explicitRegion !== 'auto') {
    return explicitRegion;
  }

  const country = String(
    getHeader(req, 'x-vercel-ip-country')
      ?? getHeader(req, 'cf-ipcountry')
      ?? getHeader(req, 'x-country-code')
      ?? '',
  ).trim().toUpperCase();

  if (country === 'CN') {
    return 'cn';
  }

  const acceptLanguage = String(getHeader(req, 'accept-language') ?? '').toLowerCase();
  if (
    acceptLanguage.includes('zh-cn')
    || acceptLanguage.includes('zh-hans')
    || (
      acceptLanguage.startsWith('zh')
      && !acceptLanguage.includes('zh-tw')
      && !acceptLanguage.includes('zh-hant')
      && !acceptLanguage.includes('zh-hk')
      && !acceptLanguage.includes('zh-mo')
    )
  ) {
    return 'cn';
  }

  return 'global';
}

function toEnvFileKey(filename: string): string {
  return String(filename)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase();
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  if (value == null) return null;

  const trimmed = String(value).trim();
  return trimmed || null;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function buildMirrorUrl(baseUrl: string, filename: string, envName: string): string {
  try {
    return new URL(filename, ensureTrailingSlash(baseUrl)).toString();
  } catch {
    throw new Error(`Invalid mirror base URL in ${envName}`);
  }
}

function resolveConfiguredUrl(rawUrl: string, envName: string): string {
  try {
    return new URL(rawUrl).toString();
  } catch {
    throw new Error(`Invalid mirror URL in ${envName}`);
  }
}

function isStableMirrorFile(filename: string): filename is StableMirrorFile {
  return (STABLE_MIRROR_FILES as readonly string[]).includes(filename);
}

function base64ToUrlSafe(value: string): string {
  return String(value).replace(/\//g, '_').replace(/\+/g, '-');
}

function normalizeQiniuSignedUrlTtlSeconds(value: string | null, fallback = 300): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function buildQiniuSignedUrl(
  filename: string,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): string | null {
  if (!isStableMirrorFile(filename)) {
    return null;
  }

  const accessKey = readEnv(env, 'QINIU_ACCESS_KEY');
  const secretKey = readEnv(env, 'QINIU_SECRET_KEY');
  const baseUrl = readEnv(env, 'QINIU_PUBLIC_BASE_URL');
  if (!accessKey || !secretKey || !baseUrl) {
    return null;
  }

  const ttlSeconds = normalizeQiniuSignedUrlTtlSeconds(
    readEnv(env, 'QINIU_SIGNED_URL_TTL_SECONDS'),
  );
  const deadline = Math.floor(nowMs / 1000) + ttlSeconds;
  const objectUrl = buildMirrorUrl(baseUrl, filename, 'QINIU_PUBLIC_BASE_URL');
  const separator = objectUrl.includes('?') ? '&' : '?';
  const baseToSign = `${objectUrl}${separator}e=${deadline}`;
  const token = `${accessKey}:${base64ToUrlSafe(
    createHmac('sha1', secretKey).update(baseToSign).digest('base64'),
  )}`;

  return `${baseToSign}&token=${token}`;
}

function resolveMirrorUrl(
  filename: string,
  env: NodeJS.ProcessEnv = process.env,
  region: MirrorRegion = 'global',
): { url: string; source: string; mirrorRegion: MirrorRegion } | null {
  const fileKey = toEnvFileKey(filename);
  const candidates: Array<{
    envName: string;
    type: 'file' | 'base';
    mirrorRegion: MirrorRegion;
  }> = [];

  if (region === 'cn') {
    candidates.push({
      envName: `DOWNLOAD_MIRROR_CN_${fileKey}_URL`,
      type: 'file',
      mirrorRegion: 'cn',
    });
    candidates.push({
      envName: 'DOWNLOAD_MIRROR_CN_BASE_URL',
      type: 'base',
      mirrorRegion: 'cn',
    });
  }

  candidates.push({
    envName: `DOWNLOAD_MIRROR_${fileKey}_URL`,
    type: 'file',
    mirrorRegion: 'global',
  });
  candidates.push({
    envName: 'DOWNLOAD_MIRROR_BASE_URL',
    type: 'base',
    mirrorRegion: 'global',
  });

  for (const candidate of candidates) {
    const value = readEnv(env, candidate.envName);
    if (!value) continue;

    return {
      url: candidate.type === 'base'
        ? buildMirrorUrl(value, filename, candidate.envName)
        : resolveConfiguredUrl(value, candidate.envName),
      source: candidate.envName,
      mirrorRegion: candidate.mirrorRegion,
    };
  }

  return null;
}

function buildDownloadPath(filename: string, region: DownloadRegion = 'auto'): string {
  const normalizedRegion = normalizeRequestedRegion(region);
  const encodedFilename = encodeURIComponent(filename);

  if (normalizedRegion === 'auto') {
    return `/download/${encodedFilename}`;
  }

  return `/download/${encodedFilename}?region=${normalizedRegion}`;
}

function resolveDownloadTarget(input: {
  filename: string;
  req: Request;
  env?: NodeJS.ProcessEnv;
  region?: DownloadRegion;
}): {
  type: 'mirror' | 'github-proxy';
  region: MirrorRegion;
  redirectUrl: string | null;
  source: string;
  mirrorRegion: MirrorRegion | null;
} {
  const normalizedRegion = normalizeRequestedRegion(input.region);
  const preferredRegion = normalizedRegion === 'auto'
    ? detectDownloadRegion(input.req)
    : normalizedRegion;
  const mirror = resolveMirrorUrl(input.filename, input.env, preferredRegion);

  if (mirror) {
    return {
      type: 'mirror',
      region: preferredRegion,
      redirectUrl: mirror.url,
      source: mirror.source,
      mirrorRegion: mirror.mirrorRegion,
    };
  }

  if (preferredRegion === 'cn') {
    const signedUrl = buildQiniuSignedUrl(input.filename, input.env);
    if (signedUrl) {
      return {
        type: 'mirror',
        region: preferredRegion,
        redirectUrl: signedUrl,
        source: 'QINIU_SIGNED_URL',
        mirrorRegion: 'cn',
      };
    }
  }

  return {
    type: 'github-proxy',
    region: preferredRegion,
    redirectUrl: null,
    source: 'github-proxy',
    mirrorRegion: null,
  };
}

function listMirrorOnlyAssets(
  env: NodeJS.ProcessEnv = process.env,
  region: DownloadRegion = 'auto',
): Array<{
  name: string;
  size: null;
  download_count: null;
  url: string;
  direct_url: string;
  source: string;
  region: MirrorRegion;
}> {
  const normalizedRegion = normalizeRequestedRegion(region);
  const preferredRegion = normalizedRegion === 'auto' ? 'global' : normalizedRegion;

  return STABLE_MIRROR_FILES
    .map(name => {
      const target = resolveDownloadTarget({
        filename: name,
        req: {
          headers: {},
          query: {},
        } as Request,
        env,
        region: preferredRegion,
      });

      if (target.type !== 'mirror' || !target.redirectUrl) {
        return null;
      }

      return {
        name,
        size: null,
        download_count: null,
        url: buildDownloadPath(name, preferredRegion),
        direct_url: target.redirectUrl,
        source: target.source,
        region: target.region,
      };
    })
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
}

interface GitHubAsset {
  name: string;
  url: string;
  size: number;
  download_count: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  assets: GitHubAsset[];
}

async function fetchLatestRelease(token: string): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Axon-Download-Proxy',
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<GitHubRelease>;
}

// GET /api/download/latest - 返回最新 release 信息
router.get('/api/download/latest', async (req: Request, res: Response) => {
  const token = process.env.GITHUB_TOKEN;
  const preferredRegion = detectDownloadRegion(req);

  if (!token) {
    const mirrorAssets = listMirrorOnlyAssets(process.env, preferredRegion);
    if (mirrorAssets.length > 0) {
      res.json({
        version: null,
        name: 'mirror-only',
        published_at: null,
        preferred_region: preferredRegion,
        assets: mirrorAssets,
      });
      return;
    }

    res.status(503).json({
      error: 'Download proxy not configured (missing GITHUB_TOKEN)',
      preferred_region: preferredRegion,
    });
    return;
  }

  try {
    const release = await fetchLatestRelease(token);
    res.json({
      version: release.tag_name,
      name: release.name,
      published_at: release.published_at,
      preferred_region: preferredRegion,
      assets: release.assets
        .filter(a => isAllowed(a.name))
        .map(a => {
          const target = resolveDownloadTarget({
            filename: a.name,
            req,
            env: process.env,
            region: preferredRegion,
          });

          return {
            name: a.name,
            size: a.size,
            download_count: a.download_count,
            url: buildDownloadPath(a.name, preferredRegion),
            direct_url: target.type === 'mirror' ? target.redirectUrl : null,
            source: target.source,
          };
        }),
    });
  } catch (err: any) {
    console.error('[download-proxy] Failed to fetch release info:', err);
    res.status(500).json({ error: 'Failed to fetch release info' });
  }
});

// GET /download/:filename - 302 重定向到 GitHub 临时 URL
router.get('/download/:filename', async (req: Request, res: Response) => {
  const { filename } = req.params;
  const token = process.env.GITHUB_TOKEN;

  if (!isAllowed(filename)) {
    res.status(403).json({ error: 'File not in allowed download list' });
    return;
  }

  try {
    const target = resolveDownloadTarget({
      filename,
      req,
      env: process.env,
    });
    if (target.type === 'mirror' && target.redirectUrl) {
      res.redirect(302, target.redirectUrl);
      return;
    }

    if (!token) {
      res.status(503).json({
        error: 'Download proxy not configured (missing GITHUB_TOKEN) and no mirror available',
        preferred_region: target.region,
      });
      return;
    }

    const release = await fetchLatestRelease(token);
    const asset = release.assets.find(a => a.name === filename);

    if (!asset) {
      res.status(404).json({
        error: `File "${filename}" not found in latest release (${release.tag_name})`,
        available: release.assets.filter(a => isAllowed(a.name)).map(a => a.name),
      });
      return;
    }

    // 请求 GitHub API asset URL，拿到 302 → S3 临时签名 URL
    const downloadRes = await fetch(asset.url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream',
        'User-Agent': 'Axon-Download-Proxy',
      },
      redirect: 'manual',
    });

    const location = downloadRes.headers.get('location');
    if (location) {
      res.redirect(302, location);
    } else {
      res.status(502).json({ error: 'GitHub did not return a redirect URL' });
    }
  } catch (err: any) {
    console.error(`[download-proxy] Error downloading ${filename}:`, err);
    res.status(500).json({ error: 'Download failed' });
  }
});

export default router;
