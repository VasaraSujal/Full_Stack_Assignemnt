import { describe, it, expect } from 'vitest';
import {
  extractTextFromBuffer,
  extractTextFromPdf,
  extractTextFromDocx,
} from '@/lib/text-extractor';

describe('Text Extractor Service', () => {
  // Synthetic valid multi-sentence legal contract
  const validPdfWithText = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 70>>stream\nBT /F1 12 Tf 100 700 Td (MASTER SERVICES AGREEMENT AND CONFIDENTIALITY TERMS) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000212 00000 n \n0000000331 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n406\n%%EOF\n'
  );

  // Short, concise legal contract (e.g., 2-line NDA)
  const shortValidPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td (Mutual NDA Agreement) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000212 00000 n \n0000000305 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n380\n%%EOF\n'
  );

  // Synthetic PDF with NO text stream (simulating a scanned image-only PDF)
  const scannedEmptyPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n'
  );

  it('extracts text page-by-page from a standard PDF contract', async () => {
    const result = await extractTextFromPdf(validPdfWithText);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.pages.length).toBeGreaterThan(0);
      expect(result.pages[0].pageNumber).toBe(1);
      expect(result.pages[0].text).toContain('MASTER SERVICES AGREEMENT');
    }
  });

  it('successfully extracts short concise contract agreements without misflagging them as scanned', async () => {
    const result = await extractTextFromPdf(shortValidPdf);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.pages[0].text).toContain('Mutual NDA Agreement');
    }
  });

  it('detects scanned / image-only PDFs with no extractable text layer', async () => {
    const result = await extractTextFromPdf(scannedEmptyPdf);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.isScannedOrEmpty).toBe(true);
      expect(result.error).toContain('scanned');
    }
  });

  it('handles unified extractTextFromBuffer for PDF', async () => {
    const result = await extractTextFromBuffer(validPdfWithText, 'pdf');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.format).toBe('pdf');
      expect(result.pages[0].text).toContain('CONFIDENTIALITY');
    }
  });

  it('handles invalid DOCX buffer error gracefully', async () => {
    const corruptedDocxBuffer = Buffer.from('corrupted docx content');
    const result = await extractTextFromDocx(corruptedDocxBuffer);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});
