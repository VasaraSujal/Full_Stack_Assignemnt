import prisma from '@/lib/prisma';
import { extractTextFromBuffer } from './text-extractor';
import { generateDocumentChunks } from './chunker';
import { DocumentStatus } from '@prisma/client';

export interface ProcessDocumentResult {
  success: boolean;
  documentId: string;
  status: DocumentStatus;
  pagesCount?: number;
  chunksCount?: number;
  error?: string;
}

/**
 * Process a document: update status, extract text, chunk content, and store in database
 */
export async function processDocument(
  documentId: string,
  buffer: Buffer,
  format: 'pdf' | 'docx'
): Promise<ProcessDocumentResult> {
  // 1. Set status to PROCESSING
  await prisma.document.update({
    where: { id: documentId },
    data: {
      status: DocumentStatus.PROCESSING,
      processingError: null,
    },
  });

  try {
    // 2. Extract text
    const extraction = await extractTextFromBuffer(buffer, format);

    if (!extraction.success) {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.FAILED,
          processingError: extraction.error,
        },
      });

      return {
        success: false,
        documentId,
        status: DocumentStatus.FAILED,
        error: extraction.error,
      };
    }

    // 3. Generate chunks
    const chunks = generateDocumentChunks(extraction.pages);

    // 4. Save pages and chunks in a database transaction
    await prisma.$transaction(async (tx) => {
      // Clean up previous pages and chunks if retrying
      await tx.documentChunk.deleteMany({ where: { documentId } });
      await tx.documentPage.deleteMany({ where: { documentId } });

      // Insert pages
      if (extraction.pages.length > 0) {
        await tx.documentPage.createMany({
          data: extraction.pages.map((p) => ({
            documentId,
            pageNumber: p.pageNumber,
            extractedText: p.text,
          })),
        });
      }

      // Insert chunks
      if (chunks.length > 0) {
        await tx.documentChunk.createMany({
          data: chunks.map((c) => ({
            documentId,
            chunkIndex: c.chunkIndex,
            chunkText: c.chunkText,
            pageNumber: c.pageNumber,
            metadata: c.metadata,
          })),
        });
      }

      // Update document to COMPLETED
      await tx.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.COMPLETED,
          processingError: null,
        },
      });
    });

    return {
      success: true,
      documentId,
      status: DocumentStatus.COMPLETED,
      pagesCount: extraction.pages.length,
      chunksCount: chunks.length,
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Document processing failed unexpectedly';

    try {
      await prisma.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.FAILED,
          processingError: errorMessage,
        },
      });
    } catch {
      // Ignore secondary error if db update fails
    }

    return {
      success: false,
      documentId,
      status: DocumentStatus.FAILED,
      error: errorMessage,
    };
  }
}
