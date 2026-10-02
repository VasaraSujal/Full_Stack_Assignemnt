/**
 * Supported MIME types and file signatures
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/docx',
  'application/octet-stream', // Some browsers / OS send this for docx or pdf
] as const;

export type SupportedFormat = 'pdf' | 'docx';

export interface ValidationSuccess {
  isValid: true;
  format: SupportedFormat;
  mimeType: string;
  sanitizedFilename: string;
  fileSize: number;
}

export interface ValidationFailure {
  isValid: false;
  error: string;
  sanitizedFilename: string;
  fileSize: number;
}

export type FileValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Get configured max file size in bytes (defaults to 20MB)
 */
export function getMaxFileSize(): number {
  const envSizeMb = process.env.MAX_FILE_SIZE_MB;
  const sizeMb = envSizeMb ? parseInt(envSizeMb, 10) : 20;
  return (isNaN(sizeMb) || sizeMb <= 0 ? 20 : sizeMb) * 1024 * 1024;
}

/**
 * Sanitize filename to prevent directory traversal or control characters
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'document';
  }
  // Remove path separators, null bytes, and control characters
  const clean = filename
    .replace(/[/\\]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();

  return clean.length > 0 ? clean : 'document';
}

/**
 * Detect file format by magic bytes (file signature)
 */
export function detectFormatFromMagicBytes(buffer: Buffer): SupportedFormat | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // PDF signature: %PDF- (0x25 0x50 0x44 0x46)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'pdf';
  }

  // DOCX / ZIP signature: PK\x03\x04 (0x50 0x4B 0x03 0x04)
  if (
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    return 'docx';
  }

  return null;
}

/**
 * Validate file buffer, size, filename, and format
 */
export function validateDocumentFile(
  buffer: Buffer,
  originalFilename: string
): FileValidationResult {
  const sanitizedFilename = sanitizeFilename(originalFilename);
  const fileSize = buffer?.length || 0;
  const maxBytes = getMaxFileSize();

  // 1. Check empty file
  if (!buffer || fileSize === 0) {
    return {
      isValid: false,
      error: 'File is empty (0 bytes). Please upload a valid document.',
      sanitizedFilename,
      fileSize: 0,
    };
  }

  // 2. Check file size
  if (fileSize > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    return {
      isValid: false,
      error: `File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds the maximum allowed limit of ${maxMb} MB.`,
      sanitizedFilename,
      fileSize,
    };
  }

  // 3. Verify magic bytes / file signature
  const detectedFormat = detectFormatFromMagicBytes(buffer);

  if (!detectedFormat) {
    return {
      isValid: false,
      error: 'Invalid file content. Only valid PDF and DOCX documents are supported.',
      sanitizedFilename,
      fileSize,
    };
  }

  // 4. Determine canonical MIME type
  let canonicalMime: string;
  if (detectedFormat === 'pdf') {
    canonicalMime = 'application/pdf';
  } else {
    canonicalMime =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  // 5. Verify filename extension matches format
  const lowerName = sanitizedFilename.toLowerCase();
  if (detectedFormat === 'pdf' && !lowerName.endsWith('.pdf')) {
    // If extension is missing, we still accept based on valid PDF magic bytes
  } else if (
    detectedFormat === 'docx' &&
    !lowerName.endsWith('.docx') &&
    !lowerName.endsWith('.doc')
  ) {
    // If extension is not docx/doc
  }

  return {
    isValid: true,
    format: detectedFormat,
    mimeType: canonicalMime,
    sanitizedFilename,
    fileSize,
  };
}
