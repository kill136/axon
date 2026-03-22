import { describe, expect, it } from 'vitest';

import {
  buildRuntimeModelCatalogEndpoint,
  extractRuntimeModelIds,
} from '../../../src/web/server/runtime/runtime-model-catalog.js';

describe('runtime model catalog helpers', () => {
  it('should normalize standard OpenAI-compatible base urls when building model catalog endpoints', () => {
    expect(buildRuntimeModelCatalogEndpoint('https://api.openai.com/v1')).toBe('https://api.openai.com/v1/models');
    expect(buildRuntimeModelCatalogEndpoint('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1/models');
    expect(buildRuntimeModelCatalogEndpoint('https://newapi.example.com')).toBe('https://newapi.example.com/v1/models');
  });

  it('should extract unique model ids from common model catalog payload shapes', () => {
    expect(extractRuntimeModelIds({
      data: [
        { id: 'gpt-4o' },
        { name: 'deepseek-v3' },
        { model: 'qwen-max' },
        { id: 'gpt-4o' },
      ],
    })).toEqual(['gpt-4o', 'deepseek-v3', 'qwen-max']);
  });
});
