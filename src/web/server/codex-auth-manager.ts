import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { configManager } from '../../config/index.js';

const CODEX_AUTH_DIR = path.join(os.homedir(), '.codex');
const CODEX_AUTH_FILE = path.join(CODEX_AUTH_DIR, 'auth.json');

export const CODEX_OAUTH_CONFIG = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizationEndpoint: 'https://auth.openai.com/oauth/authorize',
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access',
};

export interface CodexAuthConfig {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  email?: string;
  displayName?: string;
  expiresAt?: number;
  authMethod?: 'chatgpt' | 'api_key';
  source?: 'imported' | 'manual' | 'refreshed';
}

interface CodexTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
  account_id?: string;
}

function decodeJwtPayload(token?: string): Record<string, any> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function pickFirstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function extractAccountId(claims: Record<string, any> | null, fallback?: string): string | undefined {
  if (!claims) return fallback;

  const direct = pickFirstString([
    claims.account_id,
    claims.accountId,
    claims.chatgpt_account_id,
    claims.default_account_id,
    claims.defaultAccountId,
    claims.organization_id,
    claims.organizationId,
    claims.org_id,
  ]);
  if (direct) return direct;

  const orgContainers = [
    claims.organizations,
    claims.organization_ids,
    claims.organizationIds,
    claims.workspaces,
  ];

  for (const container of orgContainers) {
    if (!Array.isArray(container)) continue;
    for (const item of container) {
      if (!item) continue;
      if (typeof item === 'string' && item.trim()) return item;
      if (typeof item === 'object') {
        const id = pickFirstString([(item as any).id, (item as any).account_id, (item as any).accountId]);
        if (id) return id;
      }
    }
  }

  return fallback;
}

function extractProfile(idToken?: string, accessToken?: string): Pick<CodexAuthConfig, 'accountId' | 'email' | 'displayName' | 'expiresAt'> {
  const idClaims = decodeJwtPayload(idToken);
  const accessClaims = decodeJwtPayload(accessToken);
  const claims = idClaims || accessClaims;

  const accountId = extractAccountId(claims);
  const email = pickFirstString([claims?.email, claims?.preferred_username]);
  const displayName = pickFirstString([
    claims?.name,
    claims?.display_name,
    claims?.preferred_username,
    claims?.email,
  ]);

  let expiresAt: number | undefined;
  const exp = claims?.exp;
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    expiresAt = exp * 1000;
  }

  return { accountId, email, displayName, expiresAt };
}

function normalizeCodexAuth(raw: Record<string, any>): CodexAuthConfig | null {
  const accessToken = pickFirstString([
    raw.accessToken,
    raw.access_token,
    raw.chatgpt_access_token,
  ]);
  const refreshToken = pickFirstString([
    raw.refreshToken,
    raw.refresh_token,
  ]);
  const idToken = pickFirstString([
    raw.idToken,
    raw.id_token,
  ]);

  if (!accessToken && !pickFirstString([raw.apiKey, raw.api_key])) {
    return null;
  }

  const profile = extractProfile(idToken, accessToken || undefined);
  const expiresAt = typeof raw.expiresAt === 'number'
    ? raw.expiresAt
    : typeof raw.expires_at === 'number'
      ? raw.expires_at
      : profile.expiresAt;

  return {
    accessToken: accessToken || undefined,
    refreshToken: refreshToken || undefined,
    idToken: idToken || undefined,
    accountId: pickFirstString([raw.accountId, raw.account_id, profile.accountId]),
    email: pickFirstString([raw.email, profile.email]),
    displayName: pickFirstString([raw.displayName, raw.display_name, profile.displayName]),
    expiresAt,
    authMethod: (pickFirstString([raw.authMethod, raw.auth_method]) as CodexAuthConfig['authMethod']) || 'chatgpt',
    source: (pickFirstString([raw.source]) as CodexAuthConfig['source']) || 'imported',
  };
}

export class CodexAuthManager {
  getAuthConfig(): CodexAuthConfig | null {
    try {
      const config = configManager.getAll() as any;
      if (!config.codexAccount || typeof config.codexAccount !== 'object') {
        return null;
      }
      return normalizeCodexAuth(config.codexAccount);
    } catch (error) {
      console.error('[CodexAuth] Failed to get Codex auth config:', error);
      return null;
    }
  }

  async saveAuthConfig(config: Partial<CodexAuthConfig>): Promise<void> {
    const current = this.getAuthConfig() || {};
    configManager.set('codexAccount', {
      ...current,
      ...config,
    });
  }

  clearAuthConfig(): void {
    configManager.set('codexAccount', undefined as any);
  }

  isTokenExpired(bufferMs: number = 5 * 60 * 1000): boolean {
    const config = this.getAuthConfig();
    if (!config?.accessToken) return true;
    if (!config.expiresAt) return false;
    return Date.now() + bufferMs >= config.expiresAt;
  }

  async importOfficialAuthFile(): Promise<CodexAuthConfig> {
    if (!fs.existsSync(CODEX_AUTH_FILE)) {
      throw new Error(`Codex auth file not found: ${CODEX_AUTH_FILE}`);
    }

    const raw = JSON.parse(fs.readFileSync(CODEX_AUTH_FILE, 'utf8'));
    const normalized = normalizeCodexAuth({
      ...raw,
      source: 'imported',
    });
    if (!normalized) {
      throw new Error('No usable Codex credentials found in auth.json');
    }

    await this.saveAuthConfig(normalized);
    return this.getAuthConfig()!;
  }

  generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  buildAuthorizationUrl(state: string, codeChallenge: string): string {
    const url = new URL(CODEX_OAUTH_CONFIG.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', CODEX_OAUTH_CONFIG.clientId);
    url.searchParams.set('redirect_uri', CODEX_OAUTH_CONFIG.redirectUri);
    url.searchParams.set('scope', CODEX_OAUTH_CONFIG.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('id_token_add_organizations', 'true');
    url.searchParams.set('codex_cli_simplified_flow', 'true');
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<CodexAuthConfig> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: CODEX_OAUTH_CONFIG.redirectUri,
      client_id: CODEX_OAUTH_CONFIG.clientId,
      code_verifier: codeVerifier,
    });

    const response = await fetch(CODEX_OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Codex token exchange failed: ${text || response.statusText}`);
    }

    const tokenResponse = await response.json() as CodexTokenResponse;
    const profile = extractProfile(tokenResponse.id_token, tokenResponse.access_token);
    const config: CodexAuthConfig = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      idToken: tokenResponse.id_token,
      accountId: tokenResponse.account_id || profile.accountId,
      email: profile.email,
      displayName: profile.displayName,
      expiresAt: tokenResponse.expires_in
        ? Date.now() + tokenResponse.expires_in * 1000
        : profile.expiresAt,
      authMethod: 'chatgpt',
      source: 'manual',
    };

    await this.saveAuthConfig(config);
    return this.getAuthConfig()!;
  }

  async refreshToken(): Promise<CodexAuthConfig> {
    const current = this.getAuthConfig();
    if (!current?.refreshToken) {
      throw new Error('No Codex refresh token available');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: CODEX_OAUTH_CONFIG.clientId,
    });

    const response = await fetch(CODEX_OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Codex token refresh failed: ${text || response.statusText}`);
    }

    const tokenResponse = await response.json() as CodexTokenResponse;
    const profile = extractProfile(tokenResponse.id_token || current.idToken, tokenResponse.access_token);

    await this.saveAuthConfig({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || current.refreshToken,
      idToken: tokenResponse.id_token || current.idToken,
      accountId: tokenResponse.account_id || current.accountId || profile.accountId,
      email: current.email || profile.email,
      displayName: current.displayName || profile.displayName,
      expiresAt: tokenResponse.expires_in
        ? Date.now() + tokenResponse.expires_in * 1000
        : profile.expiresAt || current.expiresAt,
      authMethod: current.authMethod || 'chatgpt',
      source: 'refreshed',
    });

    return this.getAuthConfig()!;
  }
}

export const codexAuthManager = new CodexAuthManager();
