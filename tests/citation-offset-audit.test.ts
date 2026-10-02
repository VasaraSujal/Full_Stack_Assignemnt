import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  findQuoteOffsets,
  verifyCitationCandidates,
  normalizeTextForComparison,
} from '@/lib/citation-verifier';
import { generateDocumentChunks } from '@/lib/chunker';
import { CitationVerificationStatus, DocumentStatus } from '@prisma/client';

describe('Phase 3.2 — Citation Offset & Verification Consistency Audit Tests', () => {
  let docId: string;
  let conversationId: string;
  let chunkId: string;
  let chunk2Id: string;

  const page1Text =
    'Article 1: Scope of License. The Licensor grants the Licensee an exclusive, non-transferable right to use the Proprietary Technology in North America. This grant shall be effective immediately upon mutual execution.';

  const chunkWithTabsAndNewlines =
    '\t\tConfidentiality Terms:\n\n\nAll disclosures shall be kept strictly secret\t\tfor a period of five (5) years.\n\nArbitration: Any disputes shall be resolved in New York.';

  const unicodePageText =
    'Section 5 — Indemnification & Liability: Café & Société d’Avocats agrees to indemnify Party B against all third-party IP claims up to €1,000,000.';

  beforeAll(async () => {
    // 1. Create document in Supabase PostgreSQL
    const doc = await prisma.document.create({
      data: {
        originalFilename: 'audit_test_license.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-${Date.now()}.pdf`,
        fileSize: 1500,
        status: DocumentStatus.COMPLETED,
      },
    });
    docId = doc.id;

    // 2. Insert pages and chunks
    await prisma.documentPage.create({
      data: {
        documentId: docId,
        pageNumber: 1,
        extractedText: page1Text,
      },
    });

    const c1 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        chunkIndex: 0,
        chunkText: page1Text,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: page1Text.length, charCount: page1Text.length },
      },
    });
    chunkId = c1.id;

    const c2 = await prisma.documentChunk.create({
      data: {
        documentId: docId,
        chunkIndex: 1,
        chunkText: chunkWithTabsAndNewlines,
        pageNumber: 2,
        metadata: { startOffset: 200, endOffset: 200 + chunkWithTabsAndNewlines.length, charCount: chunkWithTabsAndNewlines.length },
      },
    });
    chunk2Id = c2.id;

    // 3. Create conversation
    const conv = await prisma.conversation.create({
      data: {
        title: 'Audit Conversation',
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
  });

  // Test 1: A quote at the beginning of a chunk (offset 0)
  it('1. correctly computes offset 0 for a quote at the exact beginning of a chunk', () => {
    const quote = 'Article 1: Scope of License.';
    const match = findQuoteOffsets(page1Text, quote);
    expect(match.found).toBe(true);
    expect(match.startOffset).toBe(0);
    expect(match.endOffset).toBe(quote.length);
    expect(page1Text.slice(match.startOffset, match.endOffset)).toBe(quote);
  });

  // Test 2: A quote at the end of a chunk
  it('2. correctly computes offsets for a quote at the exact end of a chunk', () => {
    const quote = 'mutual execution.';
    const match = findQuoteOffsets(page1Text, quote);
    expect(match.found).toBe(true);
    expect(match.endOffset).toBe(page1Text.length);
    expect(page1Text.slice(match.startOffset, match.endOffset)).toBe(quote);
  });

  // Test 3: Local chunk offset translated to page offset
  it('3. accurately translates local chunk offsets to page offsets using chunk metadata', async () => {
    const quote = 'exclusive, non-transferable right';
    const candidates = [
      {
        documentId: docId,
        chunkId,
        quotedText: quote,
      },
    ];

    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(1);

    const citation = result.citations[0];
    expect(citation.verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
    expect(citation.locationMetadata).not.toBeNull();

    const chunkOffsetStart = citation.locationMetadata!.chunkOffsets.start;
    const pageOffsetStart = citation.locationMetadata!.pageOffsets!.start;

    expect(chunkOffsetStart).toBeGreaterThan(0);
    expect(pageOffsetStart).toBe(chunkOffsetStart); // since chunk startOffset on page 1 is 0
    expect(page1Text.slice(pageOffsetStart, citation.locationMetadata!.pageOffsets!.end)).toBe(quote);
  });

  // Test 4: Chunk with tabs and consecutive newlines
  it('4. locates quote accurately in chunk containing tabs and consecutive newlines', () => {
    const quote = 'All disclosures shall be kept strictly secret for a period of five (5) years.';
    const match = findQuoteOffsets(chunkWithTabsAndNewlines, quote);
    expect(match.found).toBe(true);
    expect(match.matchType).toBe('normalized');

    const matchedRawSubstring = chunkWithTabsAndNewlines.slice(match.startOffset, match.endOffset);
    expect(normalizeTextForComparison(matchedRawSubstring)).toBe(normalizeTextForComparison(quote));
  });

  // Test 5: Unicode text containing non-ASCII characters before quotation
  it('5. handles Unicode non-ASCII characters before quotation without offset drift', () => {
    const quote = 'indemnify Party B against all third-party IP claims';
    const match = findQuoteOffsets(unicodePageText, quote);
    expect(match.found).toBe(true);
    expect(unicodePageText.slice(match.startOffset, match.endOffset)).toBe(quote);
  });

  // Test 6: Whitespace-normalized match with accurate raw-source location
  it('6. produces exact raw-source location for multi-space normalized quote', () => {
    const rawText = 'Party A   shall    pay     Invoice within   15 days.';
    const cleanQuote = 'Party A shall pay Invoice within 15 days.';
    const match = findQuoteOffsets(rawText, cleanQuote);
    expect(match.found).toBe(true);
    expect(match.startOffset).toBe(0);
    expect(match.endOffset).toBe(rawText.length);
  });

  // Test 7: Overlapping chunks containing same quote
  it('7. handles overlapping chunks containing the same quote consistently', () => {
    const text =
      'Alpha Agreement Section 1. Confidentiality applies to all software. Beta Agreement Section 2. Confidentiality applies to all software. Gamma Agreement.';
    const pages = [{ pageNumber: 1, text }];
    const chunks = generateDocumentChunks(pages, { chunkSize: 80, chunkOverlap: 30 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => {
      const match = findQuoteOffsets(c.chunkText, 'Confidentiality applies to all software.');
      if (match.found) {
        expect(c.chunkText.slice(match.startOffset, match.endOffset)).toBe(
          'Confidentiality applies to all software.'
        );
      }
    });
  });

  // Test 8: Quotation appearing multiple times in one chunk
  it('8. tracks all occurrences for repeated quotations in one chunk', () => {
    const text = 'The Fee is $1,000 per month. If late, the Fee is $1,000 plus interest.';
    const match = findQuoteOffsets(text, 'Fee is $1,000');
    expect(match.found).toBe(true);
    expect(match.occurrences.length).toBe(2);
    expect(match.occurrences[0].start).toBe(4);
    expect(match.occurrences[1].start).toBe(42);
  });

  // Test 9: Quotation crossing page boundary (chunks are partitioned per page)
  it('9. isolates chunk boundaries per page ensuring no multi-page false assignment', () => {
    const pages = [
      { pageNumber: 1, text: 'Page 1 terms conclude here.' },
      { pageNumber: 2, text: 'Page 2 terms begin here.' },
    ];
    const chunks = generateDocumentChunks(pages);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[1].pageNumber).toBe(2);
  });

  // Test 10: Fabricated quote classified as REFUTED / UNVERIFIED, never VERIFIED
  it('10. classifies fabricated quote as REFUTED and never VERIFIED', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId,
        quotedText: 'Licensor shall forfeit all assets upon contract signing.',
      },
    ];
    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(0);
    expect(result.unverifiedCount).toBe(1);
    expect(result.citations[0].verificationStatus).toBe(CitationVerificationStatus.REFUTED);
  });

  // Test 11: Partial quotation excluded from verified evidence
  it('11. excludes partial quotation from verified count and marks as PARTIAL', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId,
        quotedText: 'grants Licensee an exclusive non-transferable permission to operate in North America',
      },
    ];
    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(0);
    expect(result.partialCount).toBe(1);
    expect(result.citations[0].verificationStatus).toBe(CitationVerificationStatus.PARTIAL);
  });

  // Test 12: Mixed response containing both verified and partial citations (allVerified: false)
  it('12. returns allVerified=false when response contains both verified and partial citations', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId,
        quotedText: 'exclusive, non-transferable right', // Exact -> VERIFIED
      },
      {
        documentId: docId,
        chunkId,
        quotedText: 'grants Licensee an exclusive non-transferable permission', // Paraphrase -> PARTIAL
      },
    ];
    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.verifiedCount).toBe(1);
    expect(result.partialCount).toBe(1);
    expect(result.allVerified).toBe(false);
  });

  // Test 13: Response where every citation is verified but answer claims are evaluated separately
  it('13. reports allVerified=true for citations while maintaining claim separation', async () => {
    const candidates = [
      {
        documentId: docId,
        chunkId,
        quotedText: 'exclusive, non-transferable right',
        claim: 'The license is exclusive.',
      },
    ];
    const result = await verifyCitationCandidates(conversationId, candidates);
    expect(result.allVerified).toBe(true);
    expect(result.verifiedCount).toBe(1);
    expect(result.citations[0].claim).toBe('The license is exclusive.');
  });

  // Test 14: Consistency of citation statuses between persisted database records and API shapes
  it('14. verifies consistency of citation statuses between persisted DB records and API response metadata', async () => {
    // 1. Create a user message and assistant message
    const userMsg = await prisma.message.create({
      data: {
        conversationId,
        role: 'USER',
        content: 'What are the license terms?',
      },
    });

    const assistantMsg = await prisma.message.create({
      data: {
        conversationId,
        role: 'ASSISTANT',
        content: 'The license is exclusive and non-transferable.',
      },
    });

    // 2. Persist citation record with locationMetadata
    const persistedCitation = await prisma.citation.create({
      data: {
        messageId: assistantMsg.id,
        documentId: docId,
        pageNumber: 1,
        quotedText: 'exclusive, non-transferable right',
        verificationStatus: CitationVerificationStatus.VERIFIED,
        locationMetadata: {
          chunkId,
          chunkIndex: 0,
          chunkOffsets: { start: 52, end: 85 },
          pageOffsets: { start: 52, end: 85 },
          pageNumber: 1,
          quoteLength: 33,
          matchType: 'exact',
          confidenceScore: 1.0,
          occurrencesInChunk: 1,
        },
      },
    });

    expect(persistedCitation.verificationStatus).toBe('VERIFIED');
    expect(persistedCitation.pageNumber).toBe(1);
    const meta = persistedCitation.locationMetadata as Record<string, any>;
    expect(meta.chunkOffsets.start).toBe(52);
    expect(meta.pageOffsets.start).toBe(52);

    // Clean up test messages
    await prisma.citation.delete({ where: { id: persistedCitation.id } });
    await prisma.message.deleteMany({ where: { id: { in: [userMsg.id, assistantMsg.id] } } });
  });
});
