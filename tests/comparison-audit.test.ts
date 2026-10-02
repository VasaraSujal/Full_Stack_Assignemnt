import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  verifyComparisonCandidates,
  verifyDocumentQuote,
} from '@/lib/comparison-verifier';
import { compareContracts } from '@/lib/comparison-service';
import {
  CitationVerificationStatus,
  DocumentStatus,
} from '@prisma/client';
import { GeminiComparisonChangeCandidate } from '@/lib/comparison-types';

describe('Phase 4.1 — Comparison Correctness & Security Audit Tests', () => {
  let docA_Id: string;
  let docB_Id: string;
  let docC_ForeignId: string;
  let conversationId: string;

  const docA_Page1 =
    'Article 1: Payment Terms. Client shall pay all invoices within thirty (30) days of receipt via electronic bank transfer.\n\nArticle 2: Environmental Compliance. The supplier shall recycle 50% of packaging materials.';
  const docA_Page2 =
    'Article 3: Governing Law. This contract is governed by the laws of the State of New York.\n\nArticle 4: Cross-page quotation test segment alpha begins here and continues onto the next paragraph seamlessly.';

  const docB_Page1 =
    'Section 1: Payment Terms. Invoices shall be paid within sixty (60) days of receipt via electronic wire.\n\nSection 2: Intellectual Property. Licensor retains all worldwide copyright ownership.';

  beforeAll(async () => {
    // 1. Create Document A (2 pages)
    const docA = await prisma.document.create({
      data: {
        originalFilename: 'Audit_Agreement_A.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-compA-${Date.now()}.pdf`,
        fileSize: 4000,
        status: DocumentStatus.COMPLETED,
      },
    });
    docA_Id = docA.id;

    await prisma.documentPage.createMany({
      data: [
        { documentId: docA_Id, pageNumber: 1, extractedText: docA_Page1 },
        { documentId: docA_Id, pageNumber: 2, extractedText: docA_Page2 },
      ],
    });

    await prisma.documentChunk.createMany({
      data: [
        {
          documentId: docA_Id,
          chunkIndex: 0,
          chunkText: docA_Page1,
          pageNumber: 1,
          metadata: { startOffset: 0, endOffset: docA_Page1.length },
        },
        {
          documentId: docA_Id,
          chunkIndex: 1,
          chunkText: docA_Page2,
          pageNumber: 2,
          metadata: { startOffset: 0, endOffset: docA_Page2.length },
        },
      ],
    });

    // 2. Create Document B (1 page)
    const docB = await prisma.document.create({
      data: {
        originalFilename: 'Audit_Agreement_B.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-compB-${Date.now()}.pdf`,
        fileSize: 3000,
        status: DocumentStatus.COMPLETED,
      },
    });
    docB_Id = docB.id;

    await prisma.documentPage.create({
      data: { documentId: docB_Id, pageNumber: 1, extractedText: docB_Page1 },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: docB_Id,
        chunkIndex: 0,
        chunkText: docB_Page1,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: docB_Page1.length },
      },
    });

    // 3. Create Foreign Document C
    const docC = await prisma.document.create({
      data: {
        originalFilename: 'Foreign_Doc_C.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-compC-${Date.now()}.pdf`,
        fileSize: 2000,
        status: DocumentStatus.COMPLETED,
      },
    });
    docC_ForeignId = docC.id;

    // 4. Create Conversation containing only Doc A
    const conv = await prisma.conversation.create({
      data: { title: 'Audit Scope Conversation' },
    });
    conversationId = conv.id;

    await prisma.conversationDocument.create({
      data: { conversationId, documentId: docA_Id },
    });
  });

  afterAll(async () => {
    if (conversationId) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {});
    }
    if (docA_Id) {
      await prisma.document.delete({ where: { id: docA_Id } }).catch(() => {});
    }
    if (docB_Id) {
      await prisma.document.delete({ where: { id: docB_Id } }).catch(() => {});
    }
    if (docC_ForeignId) {
      await prisma.document.delete({ where: { id: docC_ForeignId } }).catch(() => {});
    }
  });

  // Test 1: Genuine textual change with both supporting quotes verified
  it('1. verifies genuine textual change with both supporting quotes confirmed', async () => {
    const candidates: GeminiComparisonChangeCandidate[] = [
      {
        category: 'PAYMENT',
        description: 'Payment terms changed from 30 days to 60 days.',
        significance: 'HIGH',
        documentA: {
          documentId: docA_Id,
          quote: 'thirty (30) days of receipt via electronic bank transfer',
        },
        documentB: {
          documentId: docB_Id,
          quote: 'sixty (60) days of receipt via electronic wire',
        },
        confidence: 0.95,
      },
    ];

    const result = await verifyComparisonCandidates(docA_Id, docB_Id, candidates);
    expect(result.summary.verifiedCount).toBe(1);
    expect(result.summary.allVerified).toBe(true);

    const change = result.changes[0];
    expect(change.verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
    expect(change.documentA.pageNumber).toBe(1);
    expect(change.documentB.pageNumber).toBe(1);
  });

  // Test 2: Equivalent wording incorrectly described as a material change (identical quotes)
  it('2. flags textually identical quotes as PARTIAL rather than VERIFIED change', async () => {
    const candidates: GeminiComparisonChangeCandidate[] = [
      {
        category: 'PAYMENT',
        description: 'Material difference claimed in electronic payment method.',
        significance: 'HIGH',
        documentA: {
          documentId: docA_Id,
          quote: 'Payment Terms',
        },
        documentB: {
          documentId: docB_Id,
          quote: 'Payment Terms', // Identical text present in both documents
        },
        confidence: 0.9,
      },
    ];

    const result = await verifyComparisonCandidates(docA_Id, docB_Id, candidates);
    expect(result.summary.verifiedCount).toBe(0);
    expect(result.summary.partialCount).toBe(1);
    expect(result.summary.allVerified).toBe(false);

    const change = result.changes[0];
    expect(change.verificationStatus).toBe(CitationVerificationStatus.PARTIAL);
    expect(change.description).toContain('textually identical');
  });

  // Test 3: Quotes from completely unrelated clauses (e.g. Environmental vs IP)
  it('3. flags unrelated clauses compared against each other as PARTIAL', async () => {
    const candidates: GeminiComparisonChangeCandidate[] = [
      {
        category: 'OTHER',
        description: 'Environmental terms replaced by intellectual property terms.',
        significance: 'MEDIUM',
        documentA: {
          documentId: docA_Id,
          quote: 'supplier shall recycle 50% of packaging materials', // Environmental
        },
        documentB: {
          documentId: docB_Id,
          quote: 'Licensor retains all worldwide copyright ownership', // IP
        },
        confidence: 0.8,
      },
    ];

    const result = await verifyComparisonCandidates(docA_Id, docB_Id, candidates);
    expect(result.summary.verifiedCount).toBe(0);
    expect(result.summary.partialCount).toBe(1);
    expect(result.changes[0].verificationStatus).toBe(CitationVerificationStatus.PARTIAL);
    expect(result.changes[0].description).toContain('unrelated subjects');
  });

  // Test 4: Missing passage incorrectly described as a deleted clause (empty Doc B quote)
  it('4. marks one-sided claim with missing quote as UNVERIFIED/PARTIAL, never VERIFIED', async () => {
    const candidates: GeminiComparisonChangeCandidate[] = [
      {
        category: 'OBLIGATIONS',
        description: 'Recycling clause was completely deleted in Doc B.',
        significance: 'HIGH',
        documentA: {
          documentId: docA_Id,
          quote: 'supplier shall recycle 50% of packaging materials',
        },
        documentB: {
          documentId: docB_Id,
          quote: '', // No quote in Doc B
        },
        confidence: 0.7,
      },
    ];

    const result = await verifyComparisonCandidates(docA_Id, docB_Id, candidates);
    expect(result.summary.verifiedCount).toBe(0);
    expect(result.summary.allVerified).toBe(false);
    expect(result.changes[0].verificationStatus).not.toBe(CitationVerificationStatus.VERIFIED);
  });

  // Test 5: Multi-page cross-boundary quotation verification
  it('5. identifies multi-page quotations across page boundaries and sets isMultiPage: true', async () => {
    const crossPageQuote =
      'Article 2: Environmental Compliance. The supplier shall recycle 50% of packaging materials.\n\nArticle 3: Governing Law. This contract is governed by the laws of the State of New York.';

    const evidence = await verifyDocumentQuote(docA_Id, crossPageQuote);
    expect(evidence.verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
    expect(evidence.locationMetadata?.isMultiPage).toBe(true);
    expect(evidence.pageNumber).toBe(1); // Anchored on starting page
    expect(evidence.locationMetadata?.startPage).toBe(1);
    expect(evidence.locationMetadata?.endPage).toBe(2);
  });

  // Test 6: Security - Rejects comparison when conversation does not contain both documents
  it('6. enforces conversation-document isolation rejecting unattached documents', async () => {
    await expect(
      compareContracts([docA_Id, docB_Id], 'Compare contracts', {
        conversationId, // Only contains docA_Id, NOT docB_Id
      })
    ).rejects.toThrow(/not attached to conversation/);
  });

  // Test 7: Rejects comparison with less than 2 valid documents
  it('7. rejects comparison request with fewer than 2 documents', async () => {
    await expect(compareContracts([docA_Id])).rejects.toThrow(
      'At least two distinct document IDs are required for contract comparison.'
    );
  });

  // Test 8: Rejects foreign document ID not in the database
  it('8. rejects comparison request with non-existent document ID', async () => {
    await expect(compareContracts([docA_Id, 'non-existent-doc-id'])).rejects.toThrow(
      'The following documents were not found: non-existent-doc-id'
    );
  });

  // Test 9: Whitespace at page boundary does not disrupt multi-page match
  it('9. handles multi-space and consecutive newlines across page boundary correctly', async () => {
    const quoteWithExtraSpacing =
      'The supplier shall recycle 50% of packaging materials.   Article 3: Governing Law.';
    const evidence = await verifyDocumentQuote(docA_Id, quoteWithExtraSpacing);
    expect(evidence.verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
    expect(evidence.locationMetadata?.isMultiPage).toBe(true);
    expect(evidence.locationMetadata?.startPage).toBe(1);
    expect(evidence.locationMetadata?.endPage).toBe(2);
  });

  // Test 10: Repeated phrase across different pages resolves to the earliest occurrence
  it('10. resolves repeated phrase appearing across multiple pages deterministically', async () => {
    const evidence = await verifyDocumentQuote(docA_Id, 'Article');
    expect(evidence.verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
    expect(evidence.pageNumber).toBe(1);
    expect(evidence.locationMetadata?.chunkOffsets.start).toBe(0);
  });

  // Test 11: Identical phrase in different context is flagged as PARTIAL
  it('11. flags identical phrase used in different surrounding context as PARTIAL difference', async () => {
    const candidates: GeminiComparisonChangeCandidate[] = [
      {
        category: 'GOVERNING_LAW',
        description: 'Governing jurisdiction claims identical governing law text.',
        significance: 'LOW',
        documentA: {
          documentId: docA_Id,
          quote: 'electronic',
        },
        documentB: {
          documentId: docB_Id,
          quote: 'electronic', // Same word in both
        },
        confidence: 0.8,
      },
    ];

    const result = await verifyComparisonCandidates(docA_Id, docB_Id, candidates);
    expect(result.summary.verifiedCount).toBe(0);
    expect(result.summary.partialCount).toBe(1);
    expect(result.changes[0].verificationStatus).toBe(CitationVerificationStatus.PARTIAL);
    expect(result.changes[0].description).toContain('textually identical');
  });
});
