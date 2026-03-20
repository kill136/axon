import { describe, expect, it } from 'vitest';
import { normalizeToolInputForWebRuntime } from '../../../src/web/server/runtime/tool-input-normalizer.js';

describe('normalizeToolInputForWebRuntime', () => {
  it('removes optional empty string fields', () => {
    const normalized = normalizeToolInputForWebRuntime(
      {
        file_path: '/tmp/demo.pdf',
        pages: '',
      },
      {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
          pages: { type: 'string' },
        },
        required: ['file_path'],
      },
    );

    expect(normalized).toEqual({
      file_path: '/tmp/demo.pdf',
    });
  });

  it('keeps required empty string fields unchanged', () => {
    const normalized = normalizeToolInputForWebRuntime(
      {
        file_path: '',
      },
      {
        type: 'object',
        properties: {
          file_path: { type: 'string' },
        },
        required: ['file_path'],
      },
    );

    expect(normalized).toEqual({
      file_path: '',
    });
  });

  it('normalizes nested optional string fields', () => {
    const normalized = normalizeToolInputForWebRuntime(
      {
        settings: {
          query: '',
          mode: 'fast',
        },
      },
      {
        type: 'object',
        properties: {
          settings: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              mode: { type: 'string' },
            },
            required: ['mode'],
          },
        },
      },
    );

    expect(normalized).toEqual({
      settings: {
        mode: 'fast',
      },
    });
  });
});
