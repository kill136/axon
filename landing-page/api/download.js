/**
 * Vercel Serverless Function - 下载代理
 * 
 * 仓库私有化后，GitHub Releases 下载链接对未登录用户不可用。
 * 此函数通过 GitHub API 获取 asset 的临时下载 URL（S3 签名链接），
 * 然后 302 重定向，用户浏览器直接从 S3 下载，不经过 Vercel。
 * 
 * 路由:
 *   GET /api/download?file=Axon-Setup.exe  → 302 重定向到临时下载 URL
 *   GET /api/download?info=1               → 返回最新 release 信息
 * 
 * 环境变量 (Vercel Dashboard 中配置):
 *   GITHUB_TOKEN - GitHub Personal Access Token (需要 repo 权限)
 */

const GITHUB_REPO = 'kill136/axon';

const ALLOWED_FILES = [
  /^Axon-Setup\.exe$/,
  /^Axon-Setup\.dmg$/,
  /^Axon-Setup\.AppImage$/,
  /^Axon-Windows-Portable-v[\d.]+\.zip$/,
  /^axon-(windows|linux|macos)-(x64|arm64)-v[\d.]+\.(zip|tar\.gz)$/,
  /^install\.(bat|ps1)$/,
];

function isAllowed(filename) {
  return ALLOWED_FILES.some(p => p.test(filename));
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'Download proxy not configured' });
    return;
  }

  const { file, info } = req.query;

  // GET /api/download?info=1 → 返回 release 信息
  if (info) {
    try {
      const release = await fetchLatestRelease(token);
      res.status(200).json({
        version: release.tag_name,
        name: release.name,
        published_at: release.published_at,
        assets: release.assets
          .filter(a => isAllowed(a.name))
          .map(a => ({
            name: a.name,
            size: a.size,
            download_count: a.download_count,
            url: `/api/download?file=${encodeURIComponent(a.name)}`,
          })),
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch release info', detail: err.message });
    }
    return;
  }

  // GET /api/download?file=Axon-Setup.exe → 302 重定向
  if (!file) {
    res.status(400).json({
      error: 'Missing "file" parameter',
      usage: '/api/download?file=Axon-Setup.exe',
      info_usage: '/api/download?info=1',
    });
    return;
  }

  if (!isAllowed(file)) {
    res.status(403).json({ error: 'File not in allowed download list' });
    return;
  }

  try {
    const release = await fetchLatestRelease(token);
    const asset = release.assets.find(a => a.name === file);

    if (!asset) {
      res.status(404).json({
        error: `File "${file}" not found in latest release (${release.tag_name})`,
        available: release.assets.filter(a => isAllowed(a.name)).map(a => a.name),
      });
      return;
    }

    // 用 GitHub API 获取 asset → 拿到 302 重定向的 S3 临时 URL
    const downloadRes = await fetch(asset.url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/octet-stream',
        'User-Agent': 'Axon-Download-Proxy',
      },
      redirect: 'manual', // 不自动跟随重定向，拿到 S3 URL
    });

    const location = downloadRes.headers.get('location');
    if (location) {
      // GitHub 返回 302 → S3 临时签名 URL，直接转给用户
      res.redirect(302, location);
    } else if (downloadRes.ok) {
      // 某些情况 GitHub 直接返回文件内容（不太常见）
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
      if (asset.size) res.setHeader('Content-Length', String(asset.size));

      const buffer = await downloadRes.arrayBuffer();
      res.send(Buffer.from(buffer));
    } else {
      res.status(downloadRes.status).json({ error: `GitHub API error: ${downloadRes.statusText}` });
    }
  } catch (err) {
    res.status(500).json({ error: 'Download failed', detail: err.message });
  }
};

async function fetchLatestRelease(token) {
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

  return res.json();
}
