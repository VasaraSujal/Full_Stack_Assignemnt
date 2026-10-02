import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import { processDocument } from '@/lib/document-processor';
import { DocumentStatus } from '@prisma/client';

describe('Document Processing & Persistence Pipeline', () => {
  let createdDocId: string | null = null;

  const samplePdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 70>>stream\nBT /F1 12 Tf 100 700 Td (NON-DISCLOSURE AND CONFIDENTIALITY CONTRACT AGREEMENT) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000212 00000 n \n0000000331 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n406\n%%EOF\n'
  );

  afterAll(async () => {
    // Cleanup any test documents
    if (createdDocId) {
      try {
        await prisma.document.delete({ where: { id: createdDocId } });
      } catch {
        // Ignore if already deleted
      }
    }
  });

  it('processes a valid PDF document and creates DocumentPage and DocumentChunk records', async () => {
    // 1. Create test document in PostgreSQL
    const doc = await prisma.document.create({
      data: {
        originalFilename: 'test_nda_contract.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/test-${Date.now()}.pdf`,
        fileSize: samplePdf.length,
        status: DocumentStatus.PENDING,
      },
    });
    createdDocId = doc.id;

    // 2. Run processor
    const result = await processDocument(doc.id, samplePdf, 'pdf');
    expect(result.success).toBe(true);
    expect(result.status).toBe(DocumentStatus.COMPLETED);
    expect(result.pagesCount).toBe(1);
    expect(result.chunksCount).toBeGreaterThan(0);

    // 3. Verify in database
    const updatedDoc = await prisma.document.findUnique({
      where: { id: doc.id },
      include: {
        pages: true,
        chunks: true,
      },
    });

    expect(updatedDoc).not.toBeNull();
    expect(updatedDoc?.status).toBe(DocumentStatus.COMPLETED);
    expect(updatedDoc?.pages.length).toBe(1);
    expect(updatedDoc?.pages[0].extractedText).toContain('NON-DISCLOSURE');
    expect(updatedDoc?.chunks.length).toBeGreaterThan(0);
    expect(updatedDoc?.chunks[0].chunkText).toContain('NON-DISCLOSURE');
  });

  it('handles scanned PDF with no extractable text by marking status as FAILED', async () => {
    const scannedPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n'
    );

    const doc = await prisma.document.create({
      data: {
        originalFilename: 'scanned_image_contract.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/scanned-${Date.now()}.pdf`,
        fileSize: scannedPdf.length,
        status: DocumentStatus.PENDING,
      },
    });

    const result = await processDocument(doc.id, scannedPdf, 'pdf');
    expect(result.success).toBe(false);
    expect(result.status).toBe(DocumentStatus.FAILED);
    expect(result.error).toContain('scanned');

    // Verify status in DB
    const failedDoc = await prisma.document.findUnique({
      where: { id: doc.id },
    });
    expect(failedDoc?.status).toBe(DocumentStatus.FAILED);
    expect(failedDoc?.processingError).toContain('scanned');

    // Cleanup
    await prisma.document.delete({ where: { id: doc.id } });
  });
});
