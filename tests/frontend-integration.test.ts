import { describe, it, expect } from 'vitest';
import { validateDocumentFile, getMaxFileSize } from '@/lib/file-validation';
import { findQuoteOffsets, normalizeTextForComparison } from '@/lib/citation-verifier';

describe('Phase 6.1 — Frontend Integration & Product Audit Tests', () => {
  // 1. Upload & Validation
  describe('1. File Upload Validation Consistency', () => {
    it('enforces configured 20 MB size limit consistently', () => {
      const maxBytes = getMaxFileSize();
      expect(maxBytes).toBe(20 * 1024 * 1024);

      // Oversized buffer simulation
      const largeBuffer = Buffer.alloc(21 * 1024 * 1024);
      const res = validateDocumentFile(largeBuffer, 'large_contract.pdf');
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.error).toContain('exceeds the maximum allowed limit of 20 MB');
      }
    });

    it('rejects empty (0 byte) file', () => {
      const emptyBuffer = Buffer.alloc(0);
      const res = validateDocumentFile(emptyBuffer, 'empty_doc.pdf');
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.error).toContain('File is empty (0 bytes)');
      }
    });

    it('rejects unsupported executable or image file formats', () => {
      const exeBuffer = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
      const res = validateDocumentFile(exeBuffer, 'contract.exe');
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.error).toContain('Only valid PDF and DOCX documents are supported');
      }
    });

    it('accepts valid PDF magic bytes header', () => {
      const pdfBuffer = Buffer.from('%PDF-1.4\n%test content\n');
      const res = validateDocumentFile(pdfBuffer, 'Master_Agreement.pdf');
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.format).toBe('pdf');
        expect(res.mimeType).toBe('application/pdf');
      }
    });

    it('accepts valid DOCX zip header', () => {
      const docxBuffer = Buffer.from('PK\x03\x04\x14\x00\x06\x00');
      const res = validateDocumentFile(docxBuffer, 'Vendor_Agreement.docx');
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.format).toBe('docx');
        expect(res.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      }
    });
  });

  // 2. Citation Coordinates & Highlighting Precision
  describe('2. Citation Coordinate Accuracy & Highlighting Tolerances', () => {
    const samplePageText =
      'Article 8: Limitation of Liability.\nTotal aggregate liability of either party under this Agreement shall not exceed $1,000,000.\n\nArticle 9: Term and Termination.';

    it('locates exact quotation and computes character offsets', () => {
      const quote = 'Total aggregate liability of either party under this Agreement shall not exceed $1,000,000.';
      const match = findQuoteOffsets(samplePageText, quote);

      expect(match.found).toBe(true);
      expect(match.matchType).toBe('exact');
      expect(match.startOffset).toBeGreaterThan(0);
      expect(samplePageText.slice(match.startOffset, match.endOffset)).toBe(quote);
    });

    it('locates multiline quotation spanning newline characters with normalized index mapping', () => {
      const quote = 'Limitation of Liability. Total aggregate liability';
      const match = findQuoteOffsets(samplePageText, quote);

      expect(match.found).toBe(true);
      expect(match.matchType).toBe('normalized');
      expect(match.startOffset).toBeGreaterThan(0);
      expect(samplePageText.slice(match.startOffset, match.endOffset)).toContain('Limitation of Liability.\nTotal aggregate liability');
    });

    it('normalizes typographic quotes and excessive whitespace', () => {
      const normalized = normalizeTextForComparison('“The   Licensor”\n\nshall   provide   services.');
      expect(normalized).toBe('"the licensor" shall provide services.');
    });

    it('rejects fabricated quote without returning false coordinates', () => {
      const fakeQuote = 'Party B shall forfeit all equity immediately upon termination';
      const match = findQuoteOffsets(samplePageText, fakeQuote);

      expect(match.found).toBe(false);
      expect(match.startOffset).toBe(-1);
      expect(match.endOffset).toBe(-1);
      expect(match.matchType).toBe('unmatched');
    });
  });
});
