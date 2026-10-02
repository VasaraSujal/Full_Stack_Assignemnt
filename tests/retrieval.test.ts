import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  extractSearchTerms,
  scoreChunk,
  retrieveRelevantChunks,
} from '@/lib/retrieval';
import { DocumentStatus } from '@prisma/client';

describe('Document Retrieval Service', () => {
  let doc1Id: string;
  let doc2Id: string;
  let conversationId: string;

  beforeAll(async () => {
    // 1. Create Document 1 (NDA)
    const doc1 = await prisma.document.create({
      data: {
        originalFilename: 'master_services_nda.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/doc1-${Date.now()}.pdf`,
        fileSize: 1000,
        status: DocumentStatus.COMPLETED,
      },
    });
    doc1Id = doc1.id;

    // Create chunks for Document 1
    await prisma.documentChunk.createMany({
      data: [
        {
          documentId: doc1Id,
          chunkIndex: 0,
          chunkText:
            'This Mutual Non-Disclosure Agreement defines Confidential Information and governs the exchange of proprietary trade secrets between the parties.',
          pageNumber: 1,
        },
        {
          documentId: doc1Id,
          chunkIndex: 1,
          chunkText:
            'The Receiving Party agrees to pay liquidated damages of $50,000 for any unauthorized breach of confidential disclosures.',
          pageNumber: 2,
        },
      ],
    });

    // 2. Create Document 2 (Unrelated Employment Contract)
    const doc2 = await prisma.document.create({
      data: {
        originalFilename: 'employment_handbook.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/doc2-${Date.now()}.pdf`,
        fileSize: 1000,
        status: DocumentStatus.COMPLETED,
      },
    });
    doc2Id = doc2.id;

    await prisma.documentChunk.create({
      data: {
        documentId: doc2Id,
        chunkIndex: 0,
        chunkText:
          'Standard employee working hours are Monday through Friday from 9:00 AM to 5:00 PM with one hour lunch break.',
        pageNumber: 1,
      },
    });

    // 3. Create Conversation attached ONLY to Document 1
    const conv = await prisma.conversation.create({
      data: {
        title: 'Test NDA Conversation',
      },
    });
    conversationId = conv.id;

    await prisma.conversationDocument.create({
      data: {
        conversationId,
        documentId: doc1Id,
      },
    });
  });

  afterAll(async () => {
    // Cascade cleanup
    if (conversationId) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {});
    }
    if (doc1Id) {
      await prisma.document.delete({ where: { id: doc1Id } }).catch(() => {});
    }
    if (doc2Id) {
      await prisma.document.delete({ where: { id: doc2Id } }).catch(() => {});
    }
  });

  it('extracts search terms and handles stopwords and exact phrases', () => {
    const { terms, phrases } = extractSearchTerms('What is the "liquidated damages" penalty for breach?');
    expect(terms).toContain('liquidated');
    expect(terms).toContain('damages');
    expect(terms).toContain('penalty');
    expect(terms).toContain('breach');
    expect(terms).not.toContain('what');
    expect(terms).not.toContain('is');
    expect(terms).not.toContain('the');
    expect(phrases).toContain('liquidated damages');
  });

  it('ranks relevant chunks higher than irrelevant chunks', () => {
    const chunkA = 'The Receiving Party agrees to pay liquidated damages of $50,000 for any unauthorized breach.';
    const chunkB = 'Standard employee working hours are Monday through Friday from 9:00 AM to 5:00 PM.';

    const { terms, phrases } = extractSearchTerms('liquidated damages breach penalty');
    const scoreA = scoreChunk(chunkA, terms, phrases, 'liquidated damages breach penalty');
    const scoreB = scoreChunk(chunkB, terms, phrases, 'liquidated damages breach penalty');

    expect(scoreA).toBeGreaterThan(scoreB);
    expect(scoreB).toBe(0);
  });

  it('retrieves relevant chunks strictly from documents attached to the conversation', async () => {
    const result = await retrieveRelevantChunks(conversationId, 'liquidated damages breach penalty');
    expect(result.success).toBe(true);
    expect(result.hasRelevantEvidence).toBe(true);
    expect(result.chunks.length).toBeGreaterThan(0);

    // Verify all chunks belong to doc1Id
    result.chunks.forEach((chunk) => {
      expect(chunk.documentId).toBe(doc1Id);
      expect(chunk.documentId).not.toBe(doc2Id);
    });

    expect(result.chunks[0].chunkText).toContain('liquidated damages of $50,000');
  });

  it('does not retrieve chunks from unattached documents even if query matches their content', async () => {
    // Querying for employee working hours (which is in doc2, but doc2 is NOT in this conversation)
    const result = await retrieveRelevantChunks(conversationId, 'employee working hours Monday lunch break');
    expect(result.success).toBe(true);
    // Should NOT find doc2 chunks because doc2 is not attached
    result.chunks.forEach((chunk) => {
      expect(chunk.documentId).not.toBe(doc2Id);
    });
  });

  it('handles empty query and non-existent conversation gracefully', async () => {
    const emptyResult = await retrieveRelevantChunks(conversationId, '');
    expect(emptyResult.success).toBe(false);
    expect(emptyResult.error).toContain('empty');

    const notFoundResult = await retrieveRelevantChunks('non-existent-conv-id', 'test query');
    expect(notFoundResult.success).toBe(false);
    expect(notFoundResult.error).toContain('not found');
  });
});
