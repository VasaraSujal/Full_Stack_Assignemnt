import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import { verifyCitationCandidates } from '@/lib/citation-verifier';
import {
  executeSearchDocument,
  executeListClauses,
  executeGetSection,
  PermittedDocumentScope,
} from '@/lib/agentic-tools';
import { verifyComparisonCandidates } from '@/lib/comparison-verifier';

describe('Phase 6.3 — Critical Reliability Audit & Acceptance Testing Suite', () => {
  let docAId: string;
  let docBId: string;
  let docForeignId: string;
  let convId: string;
  let permittedScope: PermittedDocumentScope;

  beforeAll(async () => {
    // 1. Create Document A (Service Agreement)
    const docA = await prisma.document.create({
      data: {
        originalFilename: 'Reliability_Audit_Service_Agreement_v1.pdf',
        storageKey: `test_rel_audit_doc_a_${Date.now()}`,
        fileSize: 1024 * 50,
        mimeType: 'application/pdf',
        status: 'COMPLETED',
        pages: {
          create: [
            {
              pageNumber: 1,
              extractedText:
                'MASTER SERVICES AGREEMENT\n\nSection 1: Scope of Work.\nProvider shall perform consulting services.\n\nSection 2: Fees and Payment.\nCustomer agrees to pay $15,000 USD within thirty (30) days of invoice.\n\nConfidentiality obligations apply.',
            },
            {
              pageNumber: 2,
              extractedText:
                'Section 3: Limitation of Liability.\nIN NO EVENT SHALL EITHER PARTY BE LIABLE FOR CONSEQUENTIAL DAMAGES.\nTotal aggregate liability shall not exceed the fees paid in the preceding twelve (12) months.\n\nConfidentiality obligations apply.',
            },
          ],
        },
      },
    });
    docAId = docA.id;

    // Create chunks for Doc A
    await prisma.documentChunk.createMany({
      data: [
        {
          documentId: docAId,
          chunkIndex: 0,
          chunkText:
            'MASTER SERVICES AGREEMENT\n\nSection 1: Scope of Work.\nProvider shall perform consulting services.\n\nSection 2: Fees and Payment.\nCustomer agrees to pay $15,000 USD within thirty (30) days of invoice.',
          pageNumber: 1,
          metadata: { startOffset: 0, endOffset: 180 },
        },
        {
          documentId: docAId,
          chunkIndex: 1,
          chunkText:
            'Section 3: Limitation of Liability.\nIN NO EVENT SHALL EITHER PARTY BE LIABLE FOR CONSEQUENTIAL DAMAGES.\nTotal aggregate liability shall not exceed the fees paid in the preceding twelve (12) months.',
          pageNumber: 2,
          metadata: { startOffset: 0, endOffset: 185 },
        },
      ],
    });

    // 2. Create Document B (Service Agreement v2)
    const docB = await prisma.document.create({
      data: {
        originalFilename: 'Reliability_Audit_Service_Agreement_v2.pdf',
        storageKey: `test_rel_audit_doc_b_${Date.now()}`,
        fileSize: 1024 * 60,
        mimeType: 'application/pdf',
        status: 'COMPLETED',
        pages: {
          create: [
            {
              pageNumber: 1,
              extractedText:
                'MASTER SERVICES AGREEMENT (AMENDED 2024)\n\nSection 1: Scope of Work.\nProvider shall deliver cloud architectural consulting services.\n\nSection 2: Fees and Payment.\nCustomer agrees to pay $25,000 USD within fifteen (15) days of invoice.',
            },
            {
              pageNumber: 2,
              extractedText:
                'Section 3: Limitation of Liability.\nTotal aggregate liability shall not exceed $1,000,000 USD.\n\nSection 4: Governing Law.\nGoverned by the laws of the State of New York.',
            },
          ],
        },
      },
    });
    docBId = docB.id;

    await prisma.documentChunk.createMany({
      data: [
        {
          documentId: docBId,
          chunkIndex: 0,
          chunkText:
            'MASTER SERVICES AGREEMENT (AMENDED 2024)\n\nSection 1: Scope of Work.\nProvider shall deliver cloud architectural consulting services.\n\nSection 2: Fees and Payment.\nCustomer agrees to pay $25,000 USD within fifteen (15) days of invoice.',
          pageNumber: 1,
          metadata: { startOffset: 0, endOffset: 215 },
        },
        {
          documentId: docBId,
          chunkIndex: 1,
          chunkText:
            'Section 3: Limitation of Liability.\nTotal aggregate liability shall not exceed $1,000,000 USD.\n\nSection 4: Governing Law.\nGoverned by the laws of the State of New York.',
          pageNumber: 2,
          metadata: { startOffset: 0, endOffset: 165 },
        },
      ],
    });

    // 3. Create Unattached Foreign Document
    const foreignDoc = await prisma.document.create({
      data: {
        originalFilename: 'Foreign_Secret_Lease.pdf',
        storageKey: `test_rel_foreign_${Date.now()}`,
        fileSize: 1024 * 30,
        mimeType: 'application/pdf',
        status: 'COMPLETED',
        pages: {
          create: [
            {
              pageNumber: 1,
              extractedText: 'Commercial Real Estate Lease. Monthly rent is $50,000 USD payable to Landlord LLC.',
            },
          ],
        },
      },
    });
    docForeignId = foreignDoc.id;

    // 4. Create Conversation attaching only Doc A and Doc B
    const conv = await prisma.conversation.create({
      data: {
        title: 'Reliability Audit Conversation',
        documents: {
          create: [{ documentId: docAId }, { documentId: docBId }],
        },
      },
    });
    convId = conv.id;

    permittedScope = {
      documentIds: [docAId, docBId],
      docMap: new Map([
        [docAId, 'Reliability_Audit_Service_Agreement_v1.pdf'],
        [docBId, 'Reliability_Audit_Service_Agreement_v2.pdf'],
      ]),
    };
  });

  afterAll(async () => {
    // Cleanup
    if (convId) {
      await prisma.citation.deleteMany({ where: { message: { conversationId: convId } } });
      await prisma.message.deleteMany({ where: { conversationId: convId } });
      await prisma.conversationDocument.deleteMany({ where: { conversationId: convId } });
      await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
    }

    const testDocIds = [docAId, docBId, docForeignId].filter(Boolean);
    for (const dId of testDocIds) {
      await prisma.comparisonChange.deleteMany({ where: { OR: [{ sourceDocumentId: dId }, { targetDocumentId: dId }] } });
      await prisma.citation.deleteMany({ where: { documentId: dId } });
      await prisma.documentChunk.deleteMany({ where: { documentId: dId } });
      await prisma.documentPage.deleteMany({ where: { documentId: dId } });
      await prisma.document.delete({ where: { id: dId } }).catch(() => {});
    }
  });

  // ==========================================
  // SECTION 2: CITATION VERIFICATION ACCEPTANCE
  // ==========================================
  describe('2. Citation Verification Acceptance Tests', () => {
    it('verifies exact quotation in correct document with authoritative page coordinates', async () => {
      const candidateQuote = 'Customer agrees to pay $15,000 USD within thirty (30) days of invoice.';
      const res = await verifyCitationCandidates(convId, [
        {
          documentId: docAId,
          quotedText: candidateQuote,
          claim: 'Payment terms are $15,000 within 30 days',
        },
      ]);

      expect(res.totalCandidates).toBe(1);
      expect(res.verifiedCount).toBe(1);
      expect(res.allVerified).toBe(true);
      expect(res.citations[0].verificationStatus).toBe('VERIFIED');
      expect(res.citations[0].pageNumber).toBe(1);
      expect(res.citations[0].locationMetadata?.pageOffsets?.start).toBeGreaterThanOrEqual(0);
      expect(res.citations[0].locationMetadata?.matchType).toBe('exact');
    });

    it('handles normalized whitespace and line breaks without false rejections', async () => {
      const multilineQuote = 'Section 3: Limitation of Liability.\nIN NO EVENT SHALL EITHER PARTY BE LIABLE';
      const res = await verifyCitationCandidates(convId, [
        {
          documentId: docAId,
          quotedText: multilineQuote,
          claim: 'Liability clause title and disclaimer',
        },
      ]);

      expect(res.verifiedCount).toBe(1);
      expect(res.citations[0].verificationStatus).toBe('VERIFIED');
      expect(res.citations[0].pageNumber).toBe(2);
    });

    it('resolves repeated boilerplate quotation deterministically to the first or indicated page', async () => {
      const repeatedQuote = 'Confidentiality obligations apply.';
      const res = await verifyCitationCandidates(convId, [
        {
          documentId: docAId,
          quotedText: repeatedQuote,
        },
      ]);

      expect(res.verifiedCount).toBe(1);
      expect(res.citations[0].verificationStatus).toBe('VERIFIED');
      expect(res.citations[0].pageNumber).toBe(1); // Resolves deterministically to first occurrence
    });

    it('rejects a completely fabricated quotation as REFUTED with null coordinates (no false coordinates)', async () => {
      const fakeQuote = 'Provider shall indemnify Customer for $500,000,000 in statutory damages.';
      const res = await verifyCitationCandidates(convId, [
        {
          documentId: docAId,
          quotedText: fakeQuote,
          claim: 'Indemnification cap claim',
        },
      ]);

      expect(res.verifiedCount).toBe(0);
      expect(res.citations[0].verificationStatus).toBe('REFUTED');
      expect(res.citations[0].pageNumber).toBeNull();
      expect(res.citations[0].locationMetadata).toBeNull();
    });

    it('rejects a quotation present in a foreign unattached document as UNVERIFIED', async () => {
      const foreignQuote = 'Commercial Real Estate Lease. Monthly rent is $50,000 USD';
      const res = await verifyCitationCandidates(convId, [
        {
          documentId: docForeignId,
          quotedText: foreignQuote,
          claim: 'Rent obligations',
        },
      ]);

      expect(res.verifiedCount).toBe(0);
      expect(res.citations[0].verificationStatus).toBe('UNVERIFIED');
      expect(res.citations[0].pageNumber).toBeNull();
    });

    it('rejects a quotation that exists in Doc B when falsely cited as belonging to Doc A', async () => {
      const docBQuote = 'Governed by the laws of the State of New York.';
      const res = await verifyCitationCandidates(convId, [
        {
          documentId: docAId, // Wrong document!
          quotedText: docBQuote,
          claim: 'Governing law claim',
        },
      ]);

      expect(res.verifiedCount).toBe(0);
      expect(res.citations[0].verificationStatus).toBe('REFUTED');
    });

    it('distinguishes mixed verified and refuted claims and marks allVerified=false', async () => {
      const validQuote = 'Customer agrees to pay $15,000 USD within thirty (30) days of invoice.';
      const fakeQuote = 'Customer may terminate for convenience with 2 hours notice.';

      const res = await verifyCitationCandidates(convId, [
        { documentId: docAId, quotedText: validQuote },
        { documentId: docAId, quotedText: fakeQuote },
      ]);

      expect(res.totalCandidates).toBe(2);
      expect(res.verifiedCount).toBe(1);
      expect(res.allVerified).toBe(false);
      expect(res.citations[0].verificationStatus).toBe('VERIFIED');
      expect(res.citations[1].verificationStatus).toBe('REFUTED');
    });
  });

  // ==========================================
  // SECTION 3: RETRIEVAL & AGENTIC TOOLS RELIABILITY
  // ==========================================
  describe('3. Retrieval Coverage & Agentic Tool Boundary Tests', () => {
    it('search_document respects attached document scope and ignores foreign documents', async () => {
      const toolRes = await executeSearchDocument(permittedScope, {
        query: 'Commercial Real Estate Lease rent',
      });

      expect(toolRes.success).toBe(true);
      // Should not find the foreign document content
      const searchData = toolRes.data as { passages: Array<{ documentId: string }> };
      const containsForeign = searchData.passages?.some((r) => r.documentId === docForeignId);
      expect(containsForeign).toBe(false);
    });

    it('list_clauses accurately reports totalPages and scope coverage', async () => {
      const toolRes = await executeListClauses(permittedScope, {
        documentId: docAId,
      });

      expect(toolRes.success).toBe(true);
      const data = toolRes.data as { totalPages: number; detectedClauses: unknown[] };
      expect(data.totalPages).toBe(2);
      expect(data.detectedClauses.length).toBeGreaterThan(0);
    });

    it('get_section retrieves section content bounded to requested page', async () => {
      const toolRes = await executeGetSection(permittedScope, {
        documentId: docAId,
        sectionHint: 'Limitation of Liability',
        startPage: 2,
      });

      expect(toolRes.success).toBe(true);
      const data = toolRes.data as { sections: Array<{ pageNumber: number; matchedText: string }> };
      expect(data.sections.length).toBeGreaterThan(0);
      expect(data.sections[0].pageNumber).toBe(2);
      expect(data.sections[0].matchedText).toContain('Limitation of Liability');
    });
  });

  // ==========================================
  // SECTION 4: CONTRACT COMPARISON CORRECTNESS
  // ==========================================
  describe('4. Contract Comparison Correctness & Dual Verification', () => {
    it('verifies genuine textual difference between Doc A ($15k / 30 days) and Doc B ($25k / 15 days)', async () => {
      const res = await verifyComparisonCandidates(docAId, docBId, [
        {
          category: 'PAYMENT',
          significance: 'HIGH',
          description: 'Payment amount increased from $15,000 to $25,000 and due date shortened from 30 to 15 days.',
          documentA: {
            documentId: docAId,
            quote: 'Customer agrees to pay $15,000 USD within thirty (30) days of invoice.',
          },
          documentB: {
            documentId: docBId,
            quote: 'Customer agrees to pay $25,000 USD within fifteen (15) days of invoice.',
          },
        },
      ]);

      expect(res.summary.verifiedCount).toBe(1);
      expect(res.changes[0].verificationStatus).toBe('VERIFIED');
      expect(res.changes[0].documentA.verificationStatus).toBe('VERIFIED');
      expect(res.changes[0].documentB.verificationStatus).toBe('VERIFIED');
      expect(res.changes[0].documentA.pageNumber).toBe(1);
      expect(res.changes[0].documentB.pageNumber).toBe(1);
    });

    it('flags textually identical clauses as PARTIAL rather than genuine difference', async () => {
      const quote = 'Provider shall perform consulting services.';
      const res = await verifyComparisonCandidates(docAId, docAId, [
        {
          category: 'OBLIGATIONS',
          significance: 'LOW',
          description: 'Identical consulting services description.',
          documentA: { documentId: docAId, quote },
          documentB: { documentId: docAId, quote },
        },
      ]);

      expect(res.changes[0].verificationStatus).toBe('PARTIAL');
    });

    it('classifies change as REFUTED if one side claims a fabricated quote', async () => {
      const res = await verifyComparisonCandidates(docAId, docBId, [
        {
          category: 'TERMINATION',
          significance: 'HIGH',
          description: 'Fabricated penalty clause claim.',
          documentA: {
            documentId: docAId,
            quote: 'Customer agrees to pay $15,000 USD within thirty (30) days of invoice.',
          },
          documentB: {
            documentId: docBId,
            quote: 'Late fees shall accrue at 95% compounding daily interest rate.', // Fabricated!
          },
        },
      ]);

      expect(res.changes[0].verificationStatus).toBe('REFUTED');
      expect(res.changes[0].documentB.verificationStatus).toBe('REFUTED');
    });
  });
});
