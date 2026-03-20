import { describe, expect, it } from 'vitest';

import {
  parseRuntimeModelCatalogMessage,
  supportsDynamicModelCatalog,
} from '../../src/web/client/src/hooks/useRuntimeModelCatalog';

describe('runtime model catalog hook helpers', () => {
  it('should only enable dynamic model catalogs for Axon Cloud', () => {
    expect(supportsDynamicModelCatalog('axon-cloud')).toBe(true);
    expect(supportsDynamicModelCatalog('claude-compatible-api')).toBe(false);
    expect(supportsDynamicModelCatalog('openai-compatible-api')).toBe(false);
  });

  it('should normalize model catalog payloads from api_models_response', () => {
    expect(parseRuntimeModelCatalogMessage({
      type: 'api_models_response',
      payload: {
        models: [' gpt-4o ', 'claude-3-7-sonnet', 'gpt-4o', '', 42],
      },
    })).toEqual(['gpt-4o', 'claude-3-7-sonnet']);
  });

  it('should ignore unrelated websocket messages', () => {
    expect(parseRuntimeModelCatalogMessage({
      type: 'error',
      payload: { message: 'boom' },
    })).toBeNull();
  });
});
