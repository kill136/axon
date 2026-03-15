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

function isAllowed(filename: string): boolean {
  return ALLOWED_FILES.some(p => p.test(filename));
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
router.get('/api/download/latest', async (_req: Request, res: Response) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'Download proxy not configured (missing GITHUB_TOKEN)' });
    return;
  }
  try {
    const release = await fetchLatestRelease(token);
    res.json({
      version: release.tag_name,
      name: release.name,
      published_at: release.published_at,
      assets: release.assets
        .filter(a => isAllowed(a.name))
        .map(a => ({
          name: a.name,
          size: a.size,
          download_count: a.download_count,
          url: `/download/${a.name}`,
        })),
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

  if (!token) {
    res.status(503).json({ error: 'Download proxy not configured (missing GITHUB_TOKEN)' });
    return;
  }
  if (!isAllowed(filename)) {
    res.status(403).json({ error: 'File not in allowed download list' });
    return;
  }

  try {
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
