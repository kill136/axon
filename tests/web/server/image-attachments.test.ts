import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildImageAttachmentPathHints,
  resolveImageGenSource,
  saveBase64AttachmentToTempFile,
  type UploadedImageAttachment,
} from '../../../src/web/server/image-attachments.js';

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const tempDirs = new Set<string>();

function registerTempDir(filePath: string): void {
  tempDirs.add(path.dirname(filePath));
}

afterEach(() => {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('image attachment helpers', () => {
  it('saves uploaded image base64 to an absolute temp file', () => {
    const filePath = saveBase64AttachmentToTempFile(
      'avatar.png',
      TINY_PNG_BASE64,
      `image-attachment-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    registerTempDir(filePath);

    expect(path.isAbsolute(filePath)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(path.basename(filePath)).toMatch(/avatar\.png$/);
  });

  it('remaps a missing relative image_path to the uploaded temp file', () => {
    const filePath = saveBase64AttachmentToTempFile(
      'avatar.png',
      TINY_PNG_BASE64,
      `image-attachment-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    registerTempDir(filePath);

    const attachments: UploadedImageAttachment[] = [
      {
        name: 'avatar.png',
        data: TINY_PNG_BASE64,
        mimeType: 'image/png',
        type: 'image',
        filePath,
      },
    ];

    const resolved = resolveImageGenSource(
      { image_path: 'avatar.png' },
      attachments,
    );

    expect(resolved).toEqual({
      imagePath: filePath,
      imageMimeType: 'image/png',
    });
    expect(buildImageAttachmentPathHints(attachments)).toEqual([
      `- avatar.png: local image path = ${filePath}`,
    ]);
  });

  it('falls back to the only uploaded image when the model invents a bad path', () => {
    const filePath = saveBase64AttachmentToTempFile(
      'portrait.jpg',
      TINY_PNG_BASE64,
      `image-attachment-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    registerTempDir(filePath);

    const resolved = resolveImageGenSource(
      { image_path: 'missing-upload-name.jpg' },
      [
        {
          name: 'portrait.jpg',
          data: TINY_PNG_BASE64,
          mimeType: 'image/jpeg',
          type: 'image',
          filePath,
        },
      ],
    );

    expect(resolved).toEqual({
      imagePath: filePath,
      imageMimeType: 'image/jpeg',
    });
  });

  it('falls back to uploaded base64 when no temp file path is available', () => {
    const resolved = resolveImageGenSource(
      { image_path: 'avatar.png' },
      [
        {
          name: 'avatar.png',
          data: TINY_PNG_BASE64,
          mimeType: 'image/png',
          type: 'image',
        },
      ],
    );

    expect(resolved).toEqual({
      imageBase64: TINY_PNG_BASE64,
      imageMimeType: 'image/png',
    });
  });

  it('keeps explicit image_base64 instead of remapping uploads', () => {
    const resolved = resolveImageGenSource(
      {
        image_path: 'avatar.png',
        image_base64: 'abcd1234',
        image_mime_type: 'image/webp',
      },
      [
        {
          name: 'avatar.png',
          data: TINY_PNG_BASE64,
          mimeType: 'image/png',
          type: 'image',
        },
      ],
    );

    expect(resolved).toEqual({
      imageBase64: 'abcd1234',
      imageMimeType: 'image/webp',
    });
  });
});
