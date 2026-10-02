import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { processDocument } from '@/lib/document-processor';
import { validateDocumentFile } from '@/lib/file-validation';
import { generateStorageKey, isStorageConfigured, uploadContractFile, deleteContractFile } from '@/lib/storage';
import { DocumentStatus } from '@prisma/client';

describe('Document Upload Workflow & Resilience Suite', () => {
  const createdDocIds: string[] = [];

  const samplePdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 70>>stream\nBT /F1 12 Tf 100 700 Td (MASTER SERVICES CONTRACT AGREEMENT) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \n0000000111 00000 n \n0000000212 00000 n \n0000000331 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n406\n%%EOF\n'
  );

  // Minimal valid PK zip signature for DOCX format validation
  const sampleDocx = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);

  afterEach(async () => {
    while (createdDocIds.length > 0) {
      const docId = createdDocIds.pop();
      if (docId) {
        try {
          await prisma.document.delete({ where: { id: docId } });
        } catch {
          // Ignore deletion error in cleanup
        }
      }
    }
  });

  // 1. Successful PDF validation and processing
  it('1. successfully validates and processes a valid PDF document', async () => {
    const validation = validateDocumentFile(samplePdf, 'commercial_contract.pdf');
    expect(validation.isValid).toBe(true);
    if (!validation.isValid) return;

    expect(validation.format).toBe('pdf');
    expect(validation.mimeType).toBe('application/pdf');

    const storageKey = generateStorageKey('pdf');
    expect(storageKey).toContain('contracts/');
    expect(storageKey).toContain('.pdf');

    const doc = await prisma.document.create({
      data: {
        originalFilename: validation.sanitizedFilename,
        mimeType: validation.mimeType,
        storageKey,
        fileSize: validation.fileSize,
        status: DocumentStatus.PENDING,
      },
    });
    createdDocIds.push(doc.id);

    const result = await processDocument(doc.id, samplePdf, 'pdf');
    expect(result.success).toBe(true);
    expect(result.status).toBe(DocumentStatus.COMPLETED);
    expect(result.pagesCount).toBe(1);
    expect(result.chunksCount).toBeGreaterThan(0);

    const savedDoc = await prisma.document.findUnique({
      where: { id: doc.id },
      include: { pages: true, chunks: true },
    });
    expect(savedDoc?.status).toBe(DocumentStatus.COMPLETED);
    expect(savedDoc?.pages.length).toBe(1);
    expect(savedDoc?.chunks.length).toBeGreaterThan(0);
  });

  // 2. Unsupported file type rejection
  it('2. rejects unsupported file types (e.g. plain text or image)', () => {
    const textBuffer = Buffer.from('Just plain text without PDF or DOCX signature');
    const validation = validateDocumentFile(textBuffer, 'notes.txt');
    expect(validation.isValid).toBe(false);
    if (!validation.isValid) {
      expect(validation.error).toContain('Invalid file content');
    }
  });

  // 3. Oversized file rejection
  it('3. rejects files exceeding 20 MB limit', () => {
    const mockBigBuffer = Buffer.alloc(21 * 1024 * 1024);
    // Add PDF magic header
    mockBigBuffer.write('%PDF-1.4', 0);
    const validation = validateDocumentFile(mockBigBuffer, 'huge_contract.pdf');
    expect(validation.isValid).toBe(false);
    if (!validation.isValid) {
      expect(validation.error).toContain('exceeds the maximum allowed limit');
    }
  });

  // 4. Empty file rejection
  it('4. rejects empty 0-byte file buffer', () => {
    const emptyBuffer = Buffer.alloc(0);
    const validation = validateDocumentFile(emptyBuffer, 'empty.pdf');
    expect(validation.isValid).toBe(false);
    if (!validation.isValid) {
      expect(validation.error).toContain('File is empty');
    }
  });

  // 5. Database insert failure and storage cleanup safety
  it('5. handles storage key uniqueness / database constraints safely', async () => {
    const storageKey = `test/duplicate-key-${Date.now()}.pdf`;

    const doc1 = await prisma.document.create({
      data: {
        originalFilename: 'first.pdf',
        mimeType: 'application/pdf',
        storageKey,
        fileSize: 100,
        status: DocumentStatus.PENDING,
      },
    });
    createdDocIds.push(doc1.id);

    // Attempt to insert duplicate storageKey
    await expect(
      prisma.document.create({
        data: {
          originalFilename: 'second.pdf',
          mimeType: 'application/pdf',
          storageKey,
          fileSize: 100,
          status: DocumentStatus.PENDING,
        },
      })
    ).rejects.toThrow();
  });

  // 6. Text extraction failure sets status to FAILED with error message
  it('6. records FAILED status and error detail when document extraction fails', async () => {
    const invalidPdfBuffer = Buffer.from('%PDF-1.4 invalid stream without real pages');

    const doc = await prisma.document.create({
      data: {
        originalFilename: 'corrupt.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/corrupt-${Date.now()}.pdf`,
        fileSize: invalidPdfBuffer.length,
        status: DocumentStatus.PENDING,
      },
    });
    createdDocIds.push(doc.id);

    const result = await processDocument(doc.id, invalidPdfBuffer, 'pdf');
    expect(result.success).toBe(false);
    expect(result.status).toBe(DocumentStatus.FAILED);
    expect(result.error).toBeDefined();

    const failedDoc = await prisma.document.findUnique({
      where: { id: doc.id },
    });
    expect(failedDoc?.status).toBe(DocumentStatus.FAILED);
    expect(failedDoc?.processingError).toBeDefined();
  });

  // 7. Atomic transaction for pages and chunks
  it('7. atomically stores pages and chunks and deletes existing on re-processing', async () => {
    const doc = await prisma.document.create({
      data: {
        originalFilename: 'reprocess_test.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/reprocess-${Date.now()}.pdf`,
        fileSize: samplePdf.length,
        status: DocumentStatus.PENDING,
      },
    });
    createdDocIds.push(doc.id);

    // First process
    await processDocument(doc.id, samplePdf, 'pdf');
    const firstCount = await prisma.documentChunk.count({ where: { documentId: doc.id } });
    expect(firstCount).toBeGreaterThan(0);

    // Re-process (should not duplicate chunks)
    await processDocument(doc.id, samplePdf, 'pdf');
    const secondCount = await prisma.documentChunk.count({ where: { documentId: doc.id } });
    expect(secondCount).toBe(firstCount);
  });
});
