import { describe, it, expect } from 'vitest';
import {
  validateDocumentFile,
  detectFormatFromMagicBytes,
  sanitizeFilename,
} from '@/lib/file-validation';

describe('File Validation Service', () => {
  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Test Contract) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000212 00000 n \n0000000305 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n380\n%%EOF\n'
  );

  const validDocxBuffer = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // PK\x03\x04 signature
    Buffer.from('test docx payload content here for testing purposes'),
  ]);

  it('detects PDF format correctly from magic bytes', () => {
    const format = detectFormatFromMagicBytes(validPdfBuffer);
    expect(format).toBe('pdf');
  });

  it('detects DOCX format correctly from magic bytes', () => {
    const format = detectFormatFromMagicBytes(validDocxBuffer);
    expect(format).toBe('docx');
  });

  it('validates a correct PDF document file', () => {
    const result = validateDocumentFile(validPdfBuffer, 'Employment_Agreement.pdf');
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.format).toBe('pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.sanitizedFilename).toBe('Employment_Agreement.pdf');
    }
  });

  it('validates a correct DOCX document file', () => {
    const result = validateDocumentFile(
      validDocxBuffer,
      'Vendor_Contract.docx'
    );
    expect(result.isValid).toBe(true);
    if (result.isValid) {
      expect(result.format).toBe('docx');
      expect(result.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
    }
  });

  it('rejects empty (0 byte) files', () => {
    const emptyBuffer = Buffer.alloc(0);
    const result = validateDocumentFile(emptyBuffer, 'empty.pdf');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.error).toContain('empty');
    }
  });

  it('rejects files with invalid magic bytes (e.g. plain text or exe)', () => {
    const fakeBuffer = Buffer.from('This is just plain text, not a PDF');
    const result = validateDocumentFile(fakeBuffer, 'fake.pdf');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.error).toContain('Invalid file content');
    }
  });

  it('rejects oversized files exceeding maximum allowed size', () => {
    // 21 MB buffer
    const largeBuffer = Buffer.concat([
      Buffer.from([0x25, 0x50, 0x44, 0x46]),
      Buffer.alloc(21 * 1024 * 1024),
    ]);
    const result = validateDocumentFile(largeBuffer, 'huge.pdf');
    expect(result.isValid).toBe(false);
    if (!result.isValid) {
      expect(result.error).toContain('exceeds the maximum allowed limit');
    }
  });

  it('sanitizes malicious filenames with directory traversal or null bytes', () => {
    expect(sanitizeFilename('../../../etc/passwd.pdf')).toBe('.._.._.._etc_passwd.pdf');
    expect(sanitizeFilename('contract\x00malicious.pdf')).toBe('contractmalicious.pdf');
    expect(sanitizeFilename('C:\\Windows\\System32\\file.docx')).toBe('C:_Windows_System32_file.docx');
  });
});
