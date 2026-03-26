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
];

function isAllowed(filename) {
  return ALLOWED_FILES.some(pattern => pattern.test(filename));
}

function normalizeRequestedRegion(value) {
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

function getHeader(req, name) {
  const value = req?.headers?.[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function detectDownloadRegion(req) {
  const explicitRegion = normalizeRequestedRegion(
    req?.query?.region ?? req?.query?.mirror ?? getHeader(req, 'x-download-region')
  );

  if (explicitRegion !== 'auto') {
    return explicitRegion;
  }

  const country = String(
    getHeader(req, 'x-vercel-ip-country')
      ?? getHeader(req, 'cf-ipcountry')
      ?? getHeader(req, 'x-country-code')
      ?? ''
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

function toEnvFileKey(filename) {
  return String(filename)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase();
}

function readEnv(env, name) {
  const value = env?.[name];
  if (value == null) return null;

  const trimmed = String(value).trim();
  return trimmed || null;
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function buildMirrorUrl(baseUrl, filename, envName) {
  try {
    return new URL(filename, ensureTrailingSlash(baseUrl)).toString();
  } catch {
    throw new Error(`Invalid mirror base URL in ${envName}`);
  }
}

function resolveConfiguredUrl(rawUrl, envName) {
  try {
    return new URL(rawUrl).toString();
  } catch {
    throw new Error(`Invalid mirror URL in ${envName}`);
  }
}

function resolveMirrorUrl(filename, env = process.env, region = 'global') {
  const fileKey = toEnvFileKey(filename);
  const candidates = [];

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

function buildDownloadPath(filename, region = 'auto') {
  const normalizedRegion = normalizeRequestedRegion(region);
  const encodedFilename = encodeURIComponent(filename);

  if (normalizedRegion === 'auto') {
    return `/download/${encodedFilename}`;
  }

  return `/download/${encodedFilename}?region=${normalizedRegion}`;
}

function resolveDownloadTarget({ filename, req, env = process.env, region = 'auto' }) {
  const normalizedRegion = normalizeRequestedRegion(region);
  const preferredRegion = normalizedRegion === 'auto'
    ? detectDownloadRegion(req)
    : normalizedRegion;
  const mirror = resolveMirrorUrl(filename, env, preferredRegion);

  if (mirror) {
    return {
      type: 'mirror',
      region: preferredRegion,
      redirectUrl: mirror.url,
      source: mirror.source,
      mirrorRegion: mirror.mirrorRegion,
    };
  }

  return {
    type: 'github-proxy',
    region: preferredRegion,
    redirectUrl: null,
    source: 'github-proxy',
    mirrorRegion: null,
  };
}

function listMirrorOnlyAssets(env = process.env, region = 'auto') {
  const normalizedRegion = normalizeRequestedRegion(region);
  const preferredRegion = normalizedRegion === 'auto' ? 'global' : normalizedRegion;

  return STABLE_MIRROR_FILES
    .map(name => {
      const target = resolveDownloadTarget({
        filename: name,
        env,
        region: preferredRegion,
      });

      if (target.type !== 'mirror') {
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
    .filter(Boolean);
}

module.exports = {
  ALLOWED_FILES,
  STABLE_MIRROR_FILES,
  buildDownloadPath,
  detectDownloadRegion,
  isAllowed,
  listMirrorOnlyAssets,
  normalizeRequestedRegion,
  resolveDownloadTarget,
  resolveMirrorUrl,
  toEnvFileKey,
};
