import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  normalizeTextForComparison,
  findQuoteOffsets,
  verifyCitationCandidates,
} from '@/lib/citation-verifier';
import { CitationVerificationStatus, DocumentStatus } from '@prisma/client';

describe('Citation Verification Service - Hardened Audit', () => {
  let docId: string;
  let foreignDocId: string;
  let chunk1Id: string;
  let chunk2Id: string;
  let conversationId: string;

  const chunk1Content =
    'The Receiving Party agrees to maintain all proprietary technical documentation in strict confidence and shall not disclose it to any third party without prior written consent. The Receiving Party agrees to return all materials upon termination.';

  const chunk2Content =
    'This Agreement shall terminate automatically on December 31, 2028 unless renewed in writing by both executive officers.\n\nSection 9.2: Notices shall be sent via registered mail.';

  beforeAll(async () => {
    // 1. Create primary document and chunks
    const doc = await prisma.document.create({
      data: {
        originalFilename: 'licensing_agreement.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/license-${Date.now()}.pdf`,
        fileSize: 1000,
        status: DocumentStatus.COMPLETED,
      },
    });
    docId = doc.id;

    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        chunkIndex: 0,
        chunkText: chunk1Content,
        pageNumber: 3,
        metadata: { startOffset: 150, endOffset: 150 + chunk1Content.length },
      },
    });
    chunk1Id = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        chunkIndex: 1,
        chunkText: chunk2Content,
        pageNumber: 7,
        metadata: { startOffset: 0, endOffset: chunk2Content.length },
      },
    });
    chunk2Id = c2.id;

    // 2. Create foreign document (not in conversation)
    const foreignDoc = await prisma.document.create({
      data: {
        originalFilename: 'unrelated_foreign.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/foreign-${Date.now()}.pdf`,
        fileSize: 1000,
        status: DocumentStatus.COMPLETED,
      },
    });
    foreignDocId = foreignDoc.id;

    // 3. Create conversation attached ONLY to primary document
    const conv = await prisma.conversation.create({
      data: {
        title: 'Licensing Q&A',
      },
    });
    conversationId = conv.id;

    await prisma.conversationDocument.create({
      data: {
        conversationId,
        documentId: docId,
      },
    });
  });

  afterAll(async () => {
    if (conversationId) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {});
    }
    if (docId) {
      await prisma.document.delete({ where: { id: docId } }).catch(() => {});
    }
    if (foreignDocId) {
      await prisma.document.delete({ where: { id: foreignDocId } }).catch(() => {});
    }
  });

  it('normalizes whitespace, unicode quotes, and case for comparison', () => {
    const raw = '“The  Receiving   Party agrees\n to maintain”';
    const normalized = normalizeTextForComparison(raw);
    expect(normalized).toBe('"the receiving party agrees to maintain"');
  });

  it('finds exact quote offsets in authoritative source text', () => {
    const quote = 'strict confidence';
    const match = findQuoteOffsets(chunk1Content, quote);
    expect(match.found).toBe(true);
    expect(match.matchType).toBe('exact');
    expect(match.startOffset).toBeGreaterThan(0);
    expect(chunk1Content.slice(match.startOffset, match.endOffset)).toBe(quote);
  });

  it('correctly tracks repeated occurrences in a chunk', () => {
    const quote = 'The Receiving Party agrees';
    const match = findQuoteOffsets(chunk1Content, quote);
    expect(match.found).toBe(true);
    expect(match.occurrences.length).toBe(2);
    expect(match.occurrences[0].start).toBe(0);
    expect(match.occurrences[1].start).toBeGreaterThan(50);
  });

  it('verifies a real exact quotation and computes both chunk and page offsets', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId: chunk1Id,
        quotedText: 'prior written consent',
        pageNumber: 999, // Hallucinated page from model
      },
    ];

    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(1);
    expect(result.unverifiedCount).toBe(0);
    expect(result.allVerified).toBe(true);

    const verified = result.citations[0];
    expect(verified.verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
    // MUST use authoritative page from DB (page 3), NOT model-supplied 999
    expect(verified.pageNumber).toBe(3);
    expect(verified.locationMetadata?.chunkOffsets.start).toBeGreaterThan(0);
    expect(verified.locationMetadata?.pageOffsets?.start).toBe(
      150 + (verified.locationMetadata?.chunkOffsets.start || 0)
    );
  });

  it('identifies multi-line quotations across linebreaks using raw index mapping', () => {
    const multiLineQuote = 'officers.\n\nSection 9.2: Notices';
    const match = findQuoteOffsets(chunk2Content, multiLineQuote);
    expect(match.found).toBe(true);
    expect(chunk2Content.slice(match.startOffset, match.endOffset)).toBe(multiLineQuote);
  });

  it('classifies paraphrased quotations as PARTIAL and never as VERIFIED', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId: chunk1Id,
        // Paraphrase of "maintain all proprietary technical documentation in strict confidence"
        quotedText: 'maintain proprietary technical documents in strict confidence and trust',
      },
    ];

    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(0);
    expect(result.citations[0].verificationStatus).toBe(CitationVerificationStatus.PARTIAL);
  });

  it('rejects a completely fabricated quotation as REFUTED', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId: chunk1Id,
        quotedText: 'Party A shall transfer all patent ownership to Party B immediately.',
      },
    ];

    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(0);
    expect(result.citations[0].verificationStatus).toBe(CitationVerificationStatus.REFUTED);
  });

  it('rejects a citation to a foreign document outside the conversation', async () => {
    const candidates = [
      {
        documentId: foreignDocId,
        chunkId: 'some-chunk-id',
        quotedText: 'Some quoted text',
      },
    ];

    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(0);
    expect(result.citations[0].verificationStatus).toBe(CitationVerificationStatus.UNVERIFIED);
  });

  it('rejects a valid chunk ID paired with the wrong document ID', async () => {
    const candidates = [
      {
        documentId: foreignDocId, // Mismatched doc
        chunkId: chunk1Id, // Belongs to docId
        quotedText: 'prior written consent',
      },
    ];

    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(0);
    expect(result.citations[0].verificationStatus).toBe(CitationVerificationStatus.UNVERIFIED);
  });
});
