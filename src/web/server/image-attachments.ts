import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface UploadedImageAttachment {
  name: string;
  data: string;
  mimeType: string;
  type: 'image';
  filePath?: string;
}

interface ImageGenInputLike {
  image_path?: unknown;
  image_base64?: unknown;
  image_mime_type?: unknown;
}

interface ResolvedImageGenSource {
  imagePath?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

const TEMP_UPLOAD_DIR_NAME = 'claude-code-uploads';

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLookupValue(value: string): string {
  return value.replace(/\\/g, '/').trim();
}

export function sanitizeAttachmentFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fff]/g, '_');
}

export function saveBase64AttachmentToTempFile(
  name: string,
  data: string,
  tempDirName: string = TEMP_UPLOAD_DIR_NAME,
): string {
  const tempDir = path.join(os.tmpdir(), tempDirName);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const timestamp = Date.now();
  const safeFileName = sanitizeAttachmentFileName(name);
  const tempFilePath = path.join(tempDir, `${timestamp}_${safeFileName}`);
  const buffer = Buffer.from(data, 'base64');
  fs.writeFileSync(tempFilePath, buffer);

  return path.resolve(tempFilePath);
}

function findMatchingAttachment(
  requestedPath: string,
  attachments: UploadedImageAttachment[],
): UploadedImageAttachment | undefined {
  const normalizedRequested = normalizeLookupValue(requestedPath);
  const requestedBaseName = normalizeLookupValue(path.basename(requestedPath));

  return attachments.find(attachment => {
    const candidates = [
      attachment.name,
      attachment.filePath,
      attachment.filePath ? path.basename(attachment.filePath) : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeLookupValue);

    return candidates.includes(normalizedRequested) || candidates.includes(requestedBaseName);
  });
}

export function resolveImageGenSource(
  input: ImageGenInputLike,
  attachments?: UploadedImageAttachment[],
): ResolvedImageGenSource {
  const imageBase64 = trimString(input.image_base64);
  const imageMimeType = trimString(input.image_mime_type);

  if (imageBase64) {
    return {
      imageBase64,
      imageMimeType,
    };
  }

  const imagePath = trimString(input.image_path);
  if (!imagePath) {
    return { imageMimeType };
  }

  if (fs.existsSync(imagePath)) {
    return {
      imagePath,
      imageMimeType,
    };
  }

  if (!attachments || attachments.length === 0) {
    return {
      imagePath,
      imageMimeType,
    };
  }

  const matchedAttachment = findMatchingAttachment(imagePath, attachments)
    || (attachments.length === 1 ? attachments[0] : undefined);

  if (!matchedAttachment) {
    return {
      imagePath,
      imageMimeType,
    };
  }

  if (matchedAttachment.filePath && fs.existsSync(matchedAttachment.filePath)) {
    return {
      imagePath: matchedAttachment.filePath,
      imageMimeType: matchedAttachment.mimeType || imageMimeType,
    };
  }

  return {
    imageBase64: matchedAttachment.data,
    imageMimeType: matchedAttachment.mimeType || imageMimeType,
  };
}

export function buildImageAttachmentPathHints(attachments: UploadedImageAttachment[]): string[] {
  return attachments
    .filter((attachment): attachment is UploadedImageAttachment & { filePath: string } => Boolean(attachment.filePath))
    .map(attachment => `- ${attachment.name}: local image path = ${attachment.filePath}`);
}
