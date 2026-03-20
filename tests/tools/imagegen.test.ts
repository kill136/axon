import { describe, expect, it } from 'vitest';
import { ImageGenTool } from '../../src/tools/generate-design.js';

describe('ImageGenTool', () => {
  it('should expose base64 image inputs in schema', () => {
    const tool = new ImageGenTool();
    const schema = tool.getInputSchema();

    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('image_path');
    expect(schema.properties).toHaveProperty('image_base64');
    expect(schema.properties).toHaveProperty('image_mime_type');
    expect(schema.required).toEqual(['prompt']);
  });
});
