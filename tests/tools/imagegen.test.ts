import { describe, expect, it } from 'vitest';
import { ImageGenTool } from '../../src/tools/generate-design.js';

describe('ImageGenTool', () => {
  it('should expose image editing controls in schema', () => {
    const tool = new ImageGenTool();
    const schema = tool.getInputSchema();

    expect(schema.type).toBe('object');
    expect(schema.properties).toHaveProperty('image_path');
    expect(schema.properties).toHaveProperty('image_base64');
    expect(schema.properties).toHaveProperty('image_mime_type');
    expect(schema.properties).toHaveProperty('edit_strength');
    expect((schema.properties as any).edit_strength.enum).toEqual(['low', 'medium', 'high']);
    expect(schema.required).toEqual(['prompt']);
  });
});
