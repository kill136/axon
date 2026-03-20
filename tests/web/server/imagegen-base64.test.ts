import { describe, expect, it } from 'vitest';
import { parseImageBase64Input } from '../../../src/web/server/services/gemini-image-service.js';

describe('parseImageBase64Input', () => {
  it('should parse data urls and prefer embedded mime type', () => {
    const result = parseImageBase64Input('data:image/jpeg;base64,abcd1234', 'image/png');

    expect(result).toEqual({
      mimeType: 'image/jpeg',
      data: 'abcd1234',
    });
  });

  it('should accept raw base64 and fallback to provided mime type', () => {
    const result = parseImageBase64Input('abcd1234', 'image/webp');

    expect(result).toEqual({
      mimeType: 'image/webp',
      data: 'abcd1234',
    });
  });

  it('should default raw base64 mime type to image/png', () => {
    const result = parseImageBase64Input('  abcd1234  ');

    expect(result).toEqual({
      mimeType: 'image/png',
      data: 'abcd1234',
    });
  });
});
