/**
 * Axon 官网 Express 服务器
 * - 静态文件服务（landing page HTML/CSS/JS/资源）
 * - 下载分流（国内镜像优先，GitHub Release 代理兜底）
 */

const express = require('express');
const path = require('path');
const {
  buildDownloadPath,
  detectDownloadRegion,
  isAllowed,
  listMirrorOnlyAssets,
  resolveDownloadTarget,
} = require('./download-utils.cjs');

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_REPO = 'kill136/axon';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// ============ 下载代理 ============

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Axon-Download-Proxy',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  return res.json();
}

// GET /api/download/latest - 返回最新 release 信息
app.get('/api/download/latest', async (req, res) => {
  const preferredRegion = detectDownloadRegion(req);

  if (!GITHUB_TOKEN) {
    const mirrorAssets = listMirrorOnlyAssets(process.env, preferredRegion);
    if (mirrorAssets.length > 0) {
      return res.json({
        version: null,
        name: 'mirror-only',
        published_at: null,
        preferred_region: preferredRegion,
        assets: mirrorAssets,
      });
    }

    return res.status(503).json({ error: 'GITHUB_TOKEN not configured' });
  }

  try {
    const release = await fetchLatestRelease();
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /download/:filename - 优先 302 到镜像，否则再走 GitHub 临时 URL
app.get('/download/:filename', async (req, res) => {
  const { filename } = req.params;
  if (!isAllowed(filename)) return res.status(403).json({ error: 'File not allowed' });

  try {
    const target = resolveDownloadTarget({ filename, req, env: process.env });
    if (target.type === 'mirror') {
      return res.redirect(302, target.redirectUrl);
    }

    if (!GITHUB_TOKEN) {
      return res.status(503).json({
        error: 'GITHUB_TOKEN not configured and no mirror available',
        preferred_region: target.region,
      });
    }

    const release = await fetchLatestRelease();
    const asset = release.assets.find(a => a.name === filename);
    if (!asset) {
      return res.status(404).json({
        error: `"${filename}" not found in ${release.tag_name}`,
        available: release.assets.filter(a => isAllowed(a.name)).map(a => a.name),
      });
    }

    // GitHub API asset URL → 302 → S3 临时签名 URL
    const downloadRes = await fetch(asset.url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/octet-stream',
        'User-Agent': 'Axon-Download-Proxy',
      },
      redirect: 'manual',
    });

    const location = downloadRes.headers.get('location');
    if (location) {
      res.redirect(302, location);
    } else {
      res.status(502).json({ error: 'GitHub did not return redirect URL' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health - 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'axon-website' });
});

// ============ 静态文件 ============

app.use(express.static(path.join(__dirname), {
  index: ['index.html'],
  extensions: ['html'],
}));

// SPA fallback 不需要，官网是多页面，404 就 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Axon Website running on port ${PORT}`);
  console.log(`  Download mirror: ${process.env.DOWNLOAD_MIRROR_CN_BASE_URL || process.env.DOWNLOAD_MIRROR_BASE_URL ? 'configured' : 'not configured'}`);
  console.log(`  GitHub proxy: ${GITHUB_TOKEN ? 'enabled' : 'DISABLED (no GITHUB_TOKEN)'}`);
});
