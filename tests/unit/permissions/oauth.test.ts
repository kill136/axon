/**
 * OAuth RFC 9728 实现测试 (Subtask 7.5)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import OAuth2Manager, { type OAuthConfig } from '../../../src/permissions/oauth.js';

// Mock fetch
global.fetch = vi.fn();

describe('OAuth2Manager', () => {
  let oauthManager: OAuth2Manager;
  let config: OAuthConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenEndpoint: 'https://oauth.example.com/token',
      authorizationEndpoint: 'https://oauth.example.com/authorize',
      deviceAuthorizationEndpoint: 'https://oauth.example.com/device_authorization',
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['read', 'write'],
    };
    oauthManager = new OAuth2Manager(config);
  });

  describe('constructor and validation', () => {
    it('should create OAuth2Manager with valid config', () => {
      expect(oauthManager).toBeDefined();
    });

    it('should throw error if clientId is missing', () => {
      const invalidConfig = { ...config, clientId: '' };
      expect(() => new OAuth2Manager(invalidConfig)).toThrow('clientId is required');
    });

    it('should throw error if tokenEndpoint is missing', () => {
      const invalidConfig = { ...config, tokenEndpoint: '' };
      expect(() => new OAuth2Manager(invalidConfig)).toThrow('tokenEndpoint is required');
    });

    it('should throw error if scopes is empty', () => {
      const invalidConfig = { ...config, scopes: [] };
      expect(() => new OAuth2Manager(invalidConfig)).toThrow('scopes must be provided');
    });
  });

  describe('buildAuthorizationUrl', () => {
    it('should build authorization URL', () => {
      const url = oauthManager.buildAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read', 'write'],
      });

      expect(url).toContain('https://oauth.example.com/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('response_type=code');
      // 注意：URL 参数会被编码
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback');
      expect(url).toContain('scope=read+write');
    });

    it('should include state parameter', () => {
      const url = oauthManager.buildAuthorizationUrl({
        clientId: 'test-client-id',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read'],
      });

      expect(url).toContain('state=');
    });

    it('should support PKCE', () => {
      const url = oauthManager.buildAuthorizationUrl(
        {
          clientId: 'test-client-id',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['read'],
          codeChallenge: 'test-challenge',
        },
        'test-state'
      );

      expect(url).toContain('code_challenge=test-challenge');
      expect(url).toContain('code_challenge_method=S256');
    });

    it('should throw error if authorizationEndpoint is not configured', () => {
      const noAuthConfig: OAuthConfig = {
        clientId: 'test',
        tokenEndpoint: 'https://example.com/token',
        scopes: ['read'],
      };

      const manager = new OAuth2Manager(noAuthConfig);
      expect(() =>
        manager.buildAuthorizationUrl({
          clientId: 'test',
          redirectUri: 'http://localhost',
          scopes: ['read'],
        })
      ).toThrow('authorizationEndpoint is not configured');
    });
  });

  describe('exchangeAuthorizationCode', () => {
    it('should exchange authorization code for token', async () => {
      const mockResponse = {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await oauthManager.exchangeAuthorizationCode(
        'test-auth-code',
        'http://localhost:3000/callback'
      );

      expect(result.access_token).toBe('test-access-token');
      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBe(3600);
    });

    it('should include code verifier for PKCE', async () => {
      const mockResponse = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await oauthManager.exchangeAuthorizationCode(
        'test-code',
        'http://localhost:3000/callback',
        'test-verifier'
      );

      expect(global.fetch).toHaveBeenCalled();
      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].body).toContain('code_verifier=test-verifier');
    });

    it('should handle error response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'invalid_code' }),
        statusText: 'Bad Request',
      });

      await expect(
        oauthManager.exchangeAuthorizationCode('invalid-code', 'http://localhost:3000/callback')
      ).rejects.toThrow();
    });
  });

  describe('Device Flow', () => {
    it('should initialize device flow', async () => {
      const mockResponse = {
        device_code: 'test-device-code',
        user_code: 'ABC-123',
        verification_uri: 'https://oauth.example.com/device',
        expires_in: 1800,
        interval: 5,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await oauthManager.initializeDeviceFlow();

      expect(result.device_code).toBe('test-device-code');
      expect(result.user_code).toBe('ABC-123');
      expect(result.verification_uri).toBe('https://oauth.example.com/device');
    });

    it('should throw error if deviceAuthorizationEndpoint is not configured', async () => {
      const noDeviceConfig: OAuthConfig = {
        clientId: 'test',
        tokenEndpoint: 'https://example.com/token',
        scopes: ['read'],
      };

      const manager = new OAuth2Manager(noDeviceConfig);
      await expect(manager.initializeDeviceFlow()).rejects.toThrow(
        'deviceAuthorizationEndpoint is not configured'
      );
    });

    it('should poll device flow token', async () => {
      const mockResponse = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await oauthManager.pollDeviceFlowToken('test-device-code', 100, 5);

      expect(result.access_token).toBe('test-token');
    });
  });

  describe('Client Credentials Flow', () => {
    it('should get token with client credentials', async () => {
      const mockResponse = {
        access_token: 'test-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await oauthManager.getTokenWithClientCredentials({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scopes: ['read', 'write'],
      });

      expect(result.access_token).toBe('test-token');
    });

    it('should include grant_type=client_credentials', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      await oauthManager.getTokenWithClientCredentials({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scopes: ['read'],
      });

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].body).toContain('grant_type=client_credentials');
    });
  });

  describe('Refresh Token', () => {
    it('should refresh access token', async () => {
      const mockResponse = {
        access_token: 'new-token',
        token_type: 'Bearer',
        expires_in: 3600,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await oauthManager.refreshAccessToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        refreshToken: 'test-refresh-token',
      });

      expect(result.access_token).toBe('new-token');
    });

    it('should include grant_type=refresh_token', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      });

      await oauthManager.refreshAccessToken({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        refreshToken: 'test-refresh-token',
      });

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].body).toContain('grant_type=refresh_token');
    });
  });

  describe('validateAccessToken', () => {
    it('should validate token format', async () => {
      const valid = await oauthManager.validateAccessToken('valid-token');
      expect(valid).toBe(true);
    });

    it('should reject empty token', async () => {
      const valid = await oauthManager.validateAccessToken('');
      expect(valid).toBe(false);
    });

    it('should accept JWT format', async () => {
      const jwtToken = 'header.payload.signature';
      const valid = await oauthManager.validateAccessToken(jwtToken);
      expect(valid).toBe(true);
    });
  });

  describe('PKCE', () => {
    it('should generate PKCE challenge', () => {
      const { codeVerifier, codeChallenge } = oauthManager.generatePKCEChallenge();

      expect(codeVerifier).toBeDefined();
      expect(codeChallenge).toBeDefined();
      expect(typeof codeVerifier).toBe('string');
      expect(typeof codeChallenge).toBe('string');
      expect(codeVerifier.length).toBeGreaterThan(0);
      expect(codeChallenge.length).toBeGreaterThan(0);
    });

    it('should generate different challenges each time', () => {
      const challenge1 = oauthManager.generatePKCEChallenge();
      const challenge2 = oauthManager.generatePKCEChallenge();

      expect(challenge1.codeVerifier).not.toBe(challenge2.codeVerifier);
      expect(challenge1.codeChallenge).not.toBe(challenge2.codeChallenge);
    });

    it('should support custom verifier', () => {
      const customVerifier = 'my-custom-verifier-string';
      const { codeVerifier, codeChallenge } = oauthManager.generatePKCEChallenge(customVerifier);

      expect(codeVerifier).toBe(customVerifier);
      expect(codeChallenge).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      await expect(
        oauthManager.exchangeAuthorizationCode('code', 'http://localhost:3000/callback')
      ).rejects.toThrow('Failed to fetch token');
    });

    it('should handle malformed responses', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error',
        json: async () => ({}),
      });

      await expect(
        oauthManager.exchangeAuthorizationCode('code', 'http://localhost:3000/callback')
      ).rejects.toThrow();
    });
  });
});
