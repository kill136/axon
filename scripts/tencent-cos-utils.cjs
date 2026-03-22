const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OBJECT_KEY = 'Axon-Setup.exe';
const DEFAULT_UPLOAD_FILE = 'Axon-Setup.exe';
const DEFAULT_CACHE_CONTROL = 'no-cache';
const DEFAULT_OBJECT_ACL = 'public-read';
const REQUIRED_ENV_NAMES = [
  'TENCENT_COS_SECRET_ID',
  'TENCENT_COS_SECRET_KEY',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
];

function readEnv(env, name) {
  const value = env?.[name];
  if (value == null) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed || null;
}

function listMissingRequiredEnvNames(env = process.env) {
  return REQUIRED_ENV_NAMES.filter(name => !readEnv(env, name));
}

function normalizeObjectKey(value, fallback = DEFAULT_OBJECT_KEY) {
  const raw = value == null ? fallback : value;
  const normalized = String(raw)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');

  if (!normalized) {
    return fallback;
  }

  return normalized;
}

function encodeObjectKeyForUrl(objectKey) {
  return normalizeObjectKey(objectKey)
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function normalizeRegion(value) {
  const normalized = readEnv({ value }, 'value');
  return normalized ? normalized.toLowerCase() : null;
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function buildDefaultPublicBaseUrl(bucket, region) {
  if (!bucket || !region) {
    throw new Error('Bucket and region are required to build the default Tencent COS URL');
  }

  return `https://${bucket}.cos.${region}.myqcloud.com/`;
}

function normalizePublicBaseUrl(value) {
  try {
    const url = new URL(String(value).trim());
    url.hash = '';
    url.search = '';
    if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    throw new Error('Invalid TENCENT_COS_PUBLIC_BASE_URL');
  }
}

function buildPublicUrl(publicBaseUrl, objectKey) {
  return new URL(
    encodeObjectKeyForUrl(objectKey),
    ensureTrailingSlash(normalizePublicBaseUrl(publicBaseUrl)),
  ).toString();
}

function normalizeCacheControl(value, fallback = DEFAULT_CACHE_CONTROL) {
  const normalized = readEnv({ value }, 'value');
  return normalized || fallback;
}

function normalizeObjectAcl(value, fallback = DEFAULT_OBJECT_ACL) {
  const normalized = readEnv({ value }, 'value');
  return normalized || fallback;
}

function resolveUploadFilePath(value = DEFAULT_UPLOAD_FILE, cwd = process.cwd()) {
  const raw = value == null ? DEFAULT_UPLOAD_FILE : String(value).trim();
  const filePath = raw || DEFAULT_UPLOAD_FILE;
  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(cwd, filePath);
}

function createTencentCosUploadConfig(env = process.env, options = {}) {
  const missingEnvNames = listMissingRequiredEnvNames(env);
  if (missingEnvNames.length > 0) {
    throw new Error(`Missing required Tencent COS env vars: ${missingEnvNames.join(', ')}`);
  }

  const bucket = readEnv(env, 'TENCENT_COS_BUCKET');
  const region = normalizeRegion(readEnv(env, 'TENCENT_COS_REGION'));
  const objectKey = normalizeObjectKey(
    readEnv(env, 'TENCENT_COS_OBJECT_KEY') ?? options.defaultObjectKey ?? DEFAULT_OBJECT_KEY,
    options.defaultObjectKey ?? DEFAULT_OBJECT_KEY,
  );
  const publicBaseUrl = normalizePublicBaseUrl(
    readEnv(env, 'TENCENT_COS_PUBLIC_BASE_URL') ?? buildDefaultPublicBaseUrl(bucket, region),
  );

  return {
    secretId: readEnv(env, 'TENCENT_COS_SECRET_ID'),
    secretKey: readEnv(env, 'TENCENT_COS_SECRET_KEY'),
    bucket,
    region,
    objectKey,
    publicBaseUrl,
    publicUrl: buildPublicUrl(publicBaseUrl, objectKey),
    cacheControl: normalizeCacheControl(readEnv(env, 'TENCENT_COS_CACHE_CONTROL')),
    objectAcl: normalizeObjectAcl(readEnv(env, 'TENCENT_COS_OBJECT_ACL')),
  };
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Installer file not found: ${filePath}`);
  }
}

async function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return hash.digest('hex');
}

function createGitHubOutputBlock(name, value) {
  const stringValue = String(value ?? '');
  if (stringValue.includes('\n') || stringValue.includes('\r')) {
    return `${name}<<__EOF__\n${stringValue}\n__EOF__\n`;
  }

  return `${name}=${stringValue}\n`;
}

function writeGitHubOutputs(entries, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  const content = Object.entries(entries)
    .map(([name, value]) => createGitHubOutputBlock(name, value))
    .join('');

  fs.appendFileSync(outputPath, content, 'utf8');
}

function assertSuccessfulStatus(label, statusCode, details) {
  if (typeof statusCode === 'number' && statusCode >= 200 && statusCode < 300) {
    return;
  }

  const detailText = (() => {
    if (!details) return 'No response body';
    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details);
    } catch {
      return String(details);
    }
  })();

  if (statusCode == null) {
    throw new Error(`${label} failed without a status code: ${detailText}`);
  }

  throw new Error(`${label} failed with status ${statusCode}: ${detailText}`);
}

async function uploadInstallerToTencentCos(options) {
  const {
    cosSdk,
    env = process.env,
    filePath = DEFAULT_UPLOAD_FILE,
    cwd = process.cwd(),
    githubOutputPath = process.env.GITHUB_OUTPUT,
  } = options ?? {};

  if (!cosSdk) {
    throw new Error('cosSdk is required');
  }

  const absoluteFilePath = resolveUploadFilePath(filePath, cwd);
  ensureFileExists(absoluteFilePath);

  const config = createTencentCosUploadConfig(env, {
    defaultObjectKey: path.basename(absoluteFilePath) || DEFAULT_OBJECT_KEY,
  });
  const sha256 = await computeFileSha256(absoluteFilePath);
  const client = new cosSdk({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
  });
  const uploadResult = await client.uploadFile({
    Bucket: config.bucket,
    Region: config.region,
    Key: config.objectKey,
    ACL: config.objectAcl,
    FilePath: absoluteFilePath,
    SliceSize: 1024 * 1024 * 5,
    Headers: {
      'Cache-Control': config.cacheControl,
      'Content-Disposition': `attachment; filename="${path.basename(config.objectKey)}"`,
      'x-cos-meta-sha256': sha256,
    },
  });

  assertSuccessfulStatus('Tencent COS upload', uploadResult?.statusCode, uploadResult);

  const result = {
    publicUrl: config.publicUrl,
    publicBaseUrl: config.publicBaseUrl,
    objectKey: config.objectKey,
    sha256,
    filePath: absoluteFilePath,
    region: config.region,
    bucket: config.bucket,
    cacheControl: config.cacheControl,
    objectAcl: config.objectAcl,
  };

  writeGitHubOutputs({
    public_url: result.publicUrl,
    public_base_url: result.publicBaseUrl,
    object_key: result.objectKey,
    sha256: result.sha256,
    region: result.region,
    bucket: result.bucket,
    object_acl: result.objectAcl,
  }, githubOutputPath);

  return result;
}

module.exports = {
  DEFAULT_CACHE_CONTROL,
  DEFAULT_OBJECT_ACL,
  DEFAULT_OBJECT_KEY,
  DEFAULT_UPLOAD_FILE,
  REQUIRED_ENV_NAMES,
  assertSuccessfulStatus,
  buildDefaultPublicBaseUrl,
  buildPublicUrl,
  computeFileSha256,
  createTencentCosUploadConfig,
  encodeObjectKeyForUrl,
  listMissingRequiredEnvNames,
  normalizeCacheControl,
  normalizeObjectAcl,
  normalizeObjectKey,
  normalizePublicBaseUrl,
  normalizeRegion,
  resolveUploadFilePath,
  uploadInstallerToTencentCos,
  writeGitHubOutputs,
};
