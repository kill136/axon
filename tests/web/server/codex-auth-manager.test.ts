import { describe, expect, it } from 'vitest';
import { CODEX_OAUTH_CONFIG, CodexAuthManager } from '../../../src/web/server/codex-auth-manager.js';

describe('CodexAuthManager', () => {
  it('should generate PKCE verifier and challenge', () => {
    const manager = new CodexAuthManager();
    const { codeVerifier, codeChallenge } = manager.generatePkcePair();

    expect(codeVerifier).toBeTruthy();
    expect(codeChallenge).toBeTruthy();
    expect(codeVerifier).not.toBe(codeChallenge);
  });

  it('should build the official Codex authorization URL', () => {
    const manager = new CodexAuthManager();
    const url = new URL(manager.buildAuthorizationUrl('state-123', 'challenge-456'));

    expect(url.origin + url.pathname).toBe(CODEX_OAUTH_CONFIG.authorizationEndpoint);
    expect(url.searchParams.get('client_id')).toBe(CODEX_OAUTH_CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CODEX_OAUTH_CONFIG.redirectUri);
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-456');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
  });
});
