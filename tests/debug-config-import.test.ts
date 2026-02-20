import { describe, it, expect } from 'vitest';

describe('debug config import', () => {
  it('check all exports', async () => {
    const config = await import('../src/config/index.js');
    const keys = Object.keys(config);
    console.log('Total keys:', keys.length);
    console.log('All keys:', keys);
    console.log('ConfigManager:', typeof config.ConfigManager);
    console.log('configManager:', typeof config.configManager);
  });
});
