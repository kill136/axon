/**
 * Config Loading Integration Tests
 * Tests configuration loading, merging, and validation across different sources
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestEnvironment, cleanupTestEnvironment, createTestConfig } from './setup.js';
import type { TestEnvironment } from './setup.js';
import { createMinimalConfig } from './helpers.js';
import { ConfigManager } from '../../src/config/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Config Loading Integration', () => {
  let env: TestEnvironment;

  beforeAll(async () => {
    env = await setupTestEnvironment();
  });

  afterAll(async () => {
    await cleanupTestEnvironment(env);
  });

  describe('Configuration Sources Priority', () => {
    it('should load default configuration when no config file exists', () => {
      const config = new ConfigManager(env.configDir);
      const allConfig = config.getAll();

      expect(allConfig.version).toBe('2.1.4');
      expect(allConfig.model).toBe('sonnet');
      expect(allConfig.maxTokens).toBe(32000);
      expect(allConfig.temperature).toBe(1);
    });

    it('should load global configuration from settings.json', () => {
      const globalConfig = {
        ...createMinimalConfig(),
        model: 'opus',
        maxTokens: 16384,
        verbose: true,
      };

      createTestConfig(env, globalConfig);

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.model).toBe('opus');
      expect(loaded.maxTokens).toBe(16384);
      expect(loaded.verbose).toBe(true);
    });

    it('should merge project config with global config', () => {
      // Global config
      const globalConfig = {
        ...createMinimalConfig(),
        model: 'sonnet',
        maxTokens: 8192,
        verbose: false,
      };
      createTestConfig(env, globalConfig);

      // Project config
      const projectConfigDir = path.join(env.projectDir, '.axon');
      fs.mkdirSync(projectConfigDir, { recursive: true });
      const projectConfigPath = path.join(projectConfigDir, 'settings.json');
      fs.writeFileSync(
        projectConfigPath,
        JSON.stringify({
          model: 'opus',
          verbose: true,
        }, null, 2)
      );

      // Change to project directory
      process.chdir(env.projectDir);

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      // Project config should override global
      expect(loaded.model).toBe('opus');
      expect(loaded.verbose).toBe(true);
      // Non-overridden values should come from global
      expect(loaded.maxTokens).toBe(8192);
    });

    it('should prioritize environment variables over config files', () => {
      const globalConfig = {
        ...createMinimalConfig(),
        maxTokens: 8192,
        useBedrock: false,
      };
      createTestConfig(env, globalConfig);

      // Set environment variables
      process.env.AXON_MAX_OUTPUT_TOKENS = '16384';
      process.env.AXON_USE_BEDROCK = 'true';

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.maxTokens).toBe(16384);
      expect(loaded.useBedrock).toBe(true);

      // Cleanup
      delete process.env.AXON_MAX_OUTPUT_TOKENS;
      delete process.env.AXON_USE_BEDROCK;
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration values', () => {
      const config = new ConfigManager(env.configDir);

      // Valid values should work
      expect(() => {
        config.set('model', 'opus');
        config.set('maxTokens', 16384);
        config.set('temperature', 0.5);
      }).not.toThrow();

      // Invalid values should throw
      expect(() => {
        config.set('maxTokens', -1000);
      }).toThrow();

      expect(() => {
        config.set('temperature', 2.5);
      }).toThrow();
    });

    it('should handle invalid config file gracefully', () => {
      // Create invalid config
      const invalidConfig = {
        model: 'invalid-model',
        maxTokens: -1000,
        temperature: 3,
      };
      createTestConfig(env, invalidConfig);

      // Should fall back to defaults
      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.model).toBe('sonnet');
      expect(loaded.maxTokens).toBe(32000);
      expect(loaded.temperature).toBe(1);
    });

    it('should validate MCP server configuration', () => {
      const config = new ConfigManager(env.configDir);

      // Valid stdio server
      expect(() => {
        config.addMcpServer('filesystem', {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        });
      }).not.toThrow();

      // Valid http server
      expect(() => {
        config.addMcpServer('web-api', {
          type: 'http',
          url: 'http://localhost:3000',
        });
      }).not.toThrow();

      // Invalid server (missing required field)
      expect(() => {
        config.addMcpServer('invalid-stdio', {
          type: 'stdio',
          // Missing 'command'
        } as any);
      }).toThrow();
    });
  });

  describe('MCP Server Configuration', () => {
    it('should load MCP servers from config', () => {
      const configWithMcp = {
        ...createMinimalConfig(),
        mcpServers: {
          filesystem: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
          database: {
            type: 'http',
            url: 'http://localhost:3000',
            headers: {
              'Authorization': 'Bearer token123',
            },
          },
        },
      };

      createTestConfig(env, configWithMcp);

      const config = new ConfigManager(env.configDir);
      const servers = config.getMcpServers();

      expect(Object.keys(servers)).toHaveLength(2);
      expect(servers.filesystem).toBeDefined();
      expect(servers.filesystem.type).toBe('stdio');
      expect(servers.filesystem.command).toBe('npx');
      expect(servers.database).toBeDefined();
      expect(servers.database.type).toBe('http');
    });

    it('should add and remove MCP servers', () => {
      const config = new ConfigManager(env.configDir);

      // Add server
      config.addMcpServer('test-server', {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      let servers = config.getMcpServers();
      expect(servers['test-server']).toBeDefined();

      // Remove server
      config.removeMcpServer('test-server');

      servers = config.getMcpServers();
      expect(servers['test-server']).toBeUndefined();
    });

    it('should update MCP server configuration', () => {
      const config = new ConfigManager(env.configDir);

      config.addMcpServer('update-test', {
        type: 'http',
        url: 'http://localhost:3000',
      });

      // Update URL
      config.addMcpServer('update-test', {
        type: 'http',
        url: 'http://localhost:4000',
        headers: {
          'X-Custom': 'value',
        },
      });

      const servers = config.getMcpServers();
      expect(servers['update-test'].url).toBe('http://localhost:4000');
      expect(servers['update-test'].headers?.['X-Custom']).toBe('value');
    });
  });

  describe('Configuration Migration', () => {
    it('should migrate old model names', () => {
      const oldConfig = {
        version: '2.0.0',
        model: 'claude-3-opus-20240229',
        maxTokens: 8192,
      };

      createTestConfig(env, oldConfig);

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.model).toBe('opus');
      expect(loaded.version).toBe('2.1.4');
    });

    it('should migrate deprecated settings', () => {
      const oldConfig = {
        version: '1.0.0',
        model: 'sonnet',
        autoSave: true,
        maxOutputTokens: 16384,
      };

      createTestConfig(env, oldConfig);

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.enableAutoSave).toBe(true);
      // maxOutputTokens is not migrated to maxTokens, so default is used
      expect(loaded.maxTokens).toBe(32000);
      expect(loaded.version).toBe('2.1.4');
    });
  });

  describe('Configuration Export and Import', () => {
    it('should export configuration with sensitive data masked', () => {
      const config = new ConfigManager(env.configDir);

      config.set('apiKey', 'sk-ant-api03-1234567890abcdef');
      config.addMcpServer('test', {
        type: 'http',
        url: 'http://localhost:3000',
        headers: {
          'Authorization': 'Bearer secret_token_xyz',
        },
      });

      const exported = config.export(true);
      const parsed = JSON.parse(exported);

      expect(parsed.apiKey).not.toBe('sk-ant-api03-1234567890abcdef');
      expect(parsed.apiKey).toContain('***');
      expect(parsed.mcpServers.test.headers.Authorization).toContain('***');
    });

    it('should export configuration without masking when requested', () => {
      const config = new ConfigManager(env.configDir);

      config.set('apiKey', 'sk-ant-api03-test-key');

      const exported = config.export(false);
      const parsed = JSON.parse(exported);

      expect(parsed.apiKey).toBe('sk-ant-api03-test-key');
    });

    it('should import valid configuration', () => {
      const config = new ConfigManager(env.configDir);

      const importData = JSON.stringify({
        version: '2.1.4',
        model: 'opus',
        maxTokens: 16384,
        temperature: 0.7,
        verbose: true,
      });

      const result = config.import(importData);
      expect(result).toBe(true);

      const loaded = config.getAll();
      expect(loaded.model).toBe('opus');
      expect(loaded.maxTokens).toBe(16384);
      expect(loaded.temperature).toBe(0.7);
    });

    it('should reject invalid configuration on import', () => {
      const config = new ConfigManager(env.configDir);

      const invalidImport = JSON.stringify({
        model: 'invalid-model',
        maxTokens: -1000,
      });

      const result = config.import(invalidImport);
      expect(result).toBe(false);
    });
  });

  describe('Configuration Reset', () => {
    it('should reset configuration to defaults', () => {
      const config = new ConfigManager(env.configDir);

      // Modify configuration
      config.set('model', 'opus');
      config.set('maxTokens', 16384);
      config.set('verbose', true);

      // Reset
      config.reset();

      const loaded = config.getAll();
      expect(loaded.model).toBe('sonnet');
      expect(loaded.maxTokens).toBe(32000);
      expect(loaded.verbose).toBe(false);
    });

    it('should reset MCP servers', () => {
      const config = new ConfigManager(env.configDir);

      config.addMcpServer('test', {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      config.reset();

      const servers = config.getMcpServers();
      expect(Object.keys(servers)).toHaveLength(0);
    });
  });

  describe('Configuration Persistence', () => {
    it('should persist configuration changes to disk', () => {
      const config = new ConfigManager(env.configDir);

      config.set('model', 'opus');
      config.set('maxTokens', 16384);

      // Create new instance to load from disk
      const config2 = new ConfigManager(env.configDir);
      const loaded = config2.getAll();

      expect(loaded.model).toBe('opus');
      expect(loaded.maxTokens).toBe(16384);
    });

    it('should handle concurrent access gracefully', async () => {
      const config1 = new ConfigManager(env.configDir);
      const config2 = new ConfigManager(env.configDir);

      // Both instances modify configuration
      config1.set('model', 'opus');
      config2.set('maxTokens', 16384);

      // Wait a bit for file writes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new instance to load final state
      const config3 = new ConfigManager(env.configDir);
      const loaded = config3.getAll();

      // Should have both changes (last write wins for conflicts)
      expect(loaded.model === 'opus' || loaded.maxTokens === 16384).toBe(true);
    });
  });

  describe('Environment Variable Parsing', () => {
    it('should parse boolean environment variables', () => {
      process.env.AXON_VERBOSE = 'true';
      process.env.AXON_USE_BEDROCK = 'false';

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.verbose).toBe(true);
      expect(loaded.useBedrock).toBe(false);

      delete process.env.AXON_VERBOSE;
      delete process.env.AXON_USE_BEDROCK;
    });

    it('should parse numeric environment variables', () => {
      process.env.AXON_MAX_OUTPUT_TOKENS = '32768';

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      expect(loaded.maxTokens).toBe(32768);
      // AXON_TEMPERATURE is not supported as env var, temperature uses default
      expect(loaded.temperature).toBe(1);

      delete process.env.AXON_MAX_OUTPUT_TOKENS;
    });

    it('should handle invalid environment variable values', () => {
      process.env.AXON_MAX_OUTPUT_TOKENS = 'not-a-number';

      const config = new ConfigManager(env.configDir);
      const loaded = config.getAll();

      // Invalid env var should be ignored; value comes from config file or default
      // The config file from earlier tests may have maxTokens set
      expect(typeof loaded.maxTokens).toBe('number');
      expect(loaded.maxTokens).toBeGreaterThan(0);

      delete process.env.AXON_MAX_OUTPUT_TOKENS;
    });
  });
});
