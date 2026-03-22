import { describe, expect, it } from 'vitest';

import {
  buildCurrentRuntimeModelListResponse,
  buildRuntimeModelListResponse,
} from '../../../src/web/server/runtime/runtime-model-list.js';

describe('runtime model list response', () => {
  it('should surface dynamic openai-compatible catalogs instead of only static recommendations', () => {
    const response = buildRuntimeModelListResponse({
      provider: 'codex',
      runtimeBackend: 'openai-compatible-api',
      availableModels: ['deepseek-v3', 'qwen-max'],
    });

    expect(response).toEqual({
      provider: 'codex',
      runtimeBackend: 'openai-compatible-api',
      models: [
        {
          id: 'deepseek-v3',
          name: 'OpenAI Compatible Deepseek V3',
          description: 'OpenAI 兼容接口返回的可用模型',
          modelId: 'deepseek-v3',
          provider: 'codex',
        },
        {
          id: 'qwen-max',
          name: 'OpenAI Compatible Qwen Max',
          description: 'OpenAI 兼容接口返回的可用模型',
          modelId: 'qwen-max',
          provider: 'codex',
        },
      ],
    });
  });

  it('should keep the configured current model when the dynamic catalog is unavailable', () => {
    const response = buildRuntimeModelListResponse({
      provider: 'anthropic',
      runtimeBackend: 'claude-compatible-api',
      currentModel: 'sonnet',
    });

    expect(response.models.map(model => model.modelId)).toEqual(['opus', 'sonnet', 'haiku']);
  });

  it('should derive provider and current model from normalized runtime selection for model-routed backends', () => {
    const response = buildCurrentRuntimeModelListResponse({
      runtimeBackend: 'axon-cloud',
      defaultModelByBackend: {
        'axon-cloud': 'opus',
      },
      customModelCatalogByBackend: {
        'axon-cloud': ['gpt-5.4', 'opus'],
      },
      codexModelName: 'gpt-5.4',
      customModelName: 'gpt-5.4',
      availableModels: ['gpt-5.4', 'opus'],
    });

    expect(response.provider).toBe('anthropic');
    expect(response.models.map(model => model.modelId)).toEqual(['opus', 'gpt-5.4']);
    expect(response.models.map(model => model.provider)).toEqual(['anthropic', 'codex']);
  });
});
