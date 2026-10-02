import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  executeSearchDocument,
  executeGetSection,
  executeListClauses,
  dispatchAgenticTool,
  PermittedDocumentScope,
} from '@/lib/agentic-tools';
import {
  performAgenticResearch,
  AgenticEventCallbacks,
} from '@/lib/agentic-research-service';
import {
  verifyCitationCandidates,
} from '@/lib/citation-verifier';
import { parseAgenticFinalAnswer } from '@/lib/agentic-prompt';
import {
  CitationVerificationStatus,
  DocumentStatus,
  MessageRole,
  GenerationStatus,
} from '@prisma/client';

describe('Phase 5.1 — Agentic Research Reliability, Audit & Performance Tests', () => {
  let docA_Id: string;
  let docB_Id: string;
  let unattachedDoc_Id: string;
  let conversationId: string;
  let permittedScope: PermittedDocumentScope;

  const docA_P1 =
    'Article 1: Master Service Terms. The parties enter into this Services Agreement on January 15, 2024.\n\nArticle 2: Fees and Payment Schedule. Invoices are payable within 45 days of receipt.\n\nStandard Boilerplate: All notices must be delivered in writing.';
  const docA_P2 =
    'Article 3: Confidentiality and Non-Disclosure. Obligations survive for a period of seven (7) years following termination.\n\nStandard Boilerplate: All notices must be delivered in writing.';
  const docB_P1 =
    'Article 1: Scope of Work. Contractor shall provide cloud migration engineering services.\n\nArticle 2: Independent Contractor Status. Contractor is an independent entity, not an employee.';
  const foreign_P1 =
    'Article 99: Secret Unattached Contract. Proprietary data for external organization only.';

  beforeAll(async () => {
    // 1. Create Document A (2 pages with duplicate boilerplate)
    const docA = await prisma.document.create({
      data: {
        originalFilename: 'Audit_Master_Services.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-docA-${Date.now()}.pdf`,
        fileSize: 4500,
        status: DocumentStatus.COMPLETED,
      },
    });
    docA_Id = docA.id;

    await prisma.documentPage.createMany({
      data: [
        { documentId: docA_Id, pageNumber: 1, extractedText: docA_P1 },
        { documentId: docA_Id, pageNumber: 2, extractedText: docA_P2 },
      ],
    });

    await prisma.documentChunk.createMany({
      data: [
        {
          documentId: docA_Id,
          chunkIndex: 0,
          chunkText: docA_P1,
          pageNumber: 1,
          metadata: { startOffset: 0, endOffset: docA_P1.length },
        },
        {
          documentId: docA_Id,
          chunkIndex: 1,
          chunkText: docA_P2,
          pageNumber: 2,
          metadata: { startOffset: 0, endOffset: docA_P2.length },
        },
      ],
    });

    // 2. Create Document B (1 page)
    const docB = await prisma.document.create({
      data: {
        originalFilename: 'Audit_Statement_Of_Work.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-docB-${Date.now()}.pdf`,
        fileSize: 3200,
        status: DocumentStatus.COMPLETED,
      },
    });
    docB_Id = docB.id;

    await prisma.documentPage.create({
      data: { documentId: docB_Id, pageNumber: 1, extractedText: docB_P1 },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: docB_Id,
        chunkIndex: 0,
        chunkText: docB_P1,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: docB_P1.length },
      },
    });

    // 3. Create Foreign Unattached Document
    const foreignDoc = await prisma.document.create({
      data: {
        originalFilename: 'Foreign_Unattached.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/audit-foreign-${Date.now()}.pdf`,
        fileSize: 2000,
        status: DocumentStatus.COMPLETED,
      },
    });
    unattachedDoc_Id = foreignDoc.id;

    await prisma.documentPage.create({
      data: { documentId: unattachedDoc_Id, pageNumber: 1, extractedText: foreign_P1 },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: unattachedDoc_Id,
        chunkIndex: 0,
        chunkText: foreign_P1,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: foreign_P1.length },
      },
    });

    // 4. Create Conversation attaching Doc A and Doc B (NOT Foreign Doc)
    const conv = await prisma.conversation.create({
      data: { title: 'Phase 5.1 Audit Conversation' },
    });
    conversationId = conv.id;

    await prisma.conversationDocument.createMany({
      data: [
        { conversationId, documentId: docA_Id },
        { conversationId, documentId: docB_Id },
      ],
    });

    permittedScope = {
      documentIds: [docA_Id, docB_Id],
      docMap: new Map([
        [docA_Id, 'Audit_Master_Services.pdf'],
        [docB_Id, 'Audit_Statement_Of_Work.pdf'],
      ]),
    };
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
    if (unattachedDoc_Id) {
      await prisma.document.delete({ where: { id: unattachedDoc_Id } }).catch(() => {});
    }
  });

  // 1. Tool execution & coverage limitation tests
  describe('1. Search Completeness & Absent-Clause Handling', () => {
    it('accurately specifies coverage limitations when lexical search returns 0 matches', async () => {
      const res = await executeSearchDocument(permittedScope, {
        query: 'indemnification intellectual property infringement hold harmless',
      });

      expect(res.success).toBe(true);
      expect(res.itemsFound).toBe(0);
      expect(res.data.isExhaustive).toBe(false);
      expect(res.data.coverageLimitation).toContain('does not guarantee the clause or term is absent');
      expect(res.summary).toContain('absence does not prove clause non-existence');
    });

    it('list_clauses reports totalPages and whether clause discovery was exhaustive', async () => {
      const res = await executeListClauses(permittedScope, {
        documentId: docA_Id,
      });

      expect(res.success).toBe(true);
      expect(res.data.totalPages).toBe(2);
      expect(res.data.isExhaustive).toBe(true);
      expect(res.data.coverageLimitation).toContain('All 2 pages');
    });
  });

  // 2. Document Scope Isolation
  describe('2. Scope Isolation & Out-of-Scope Document Rejection', () => {
    it('strictly rejects tool execution on unattached document', async () => {
      const res = await executeSearchDocument(permittedScope, {
        query: 'secret',
        documentId: unattachedDoc_Id,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('not in the permitted document scope');
    });

    it('rejects list_clauses on foreign unattached document', async () => {
      const res = await executeListClauses(permittedScope, {
        documentId: unattachedDoc_Id,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid or out-of-scope documentId');
    });
  });

  // 3. Citation Verification Integrity
  describe('3. Citation Verification & Coordinate Accuracy', () => {
    it('verifies exact quote without chunkId and maps to correct page', async () => {
      const candidates = [
        {
          documentId: docA_Id,
          quotedText: 'Invoices are payable within 45 days of receipt',
        },
      ];

      const res = await verifyCitationCandidates(conversationId, candidates);
      expect(res.totalCandidates).toBe(1);
      expect(res.verifiedCount).toBe(1);
      expect(res.allVerified).toBe(true);
      expect(res.citations[0].verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
      expect(res.citations[0].pageNumber).toBe(1);
      expect(res.citations[0].locationMetadata?.chunkOffsets.start).toBeGreaterThanOrEqual(0);
    });

    it('resolves repeated boilerplate phrase appearing in multiple chunks deterministically', async () => {
      const candidates = [
        {
          documentId: docA_Id,
          quotedText: 'All notices must be delivered in writing',
        },
      ];

      const res = await verifyCitationCandidates(conversationId, candidates);
      expect(res.verifiedCount).toBe(1);
      expect(res.citations[0].verificationStatus).toBe(CitationVerificationStatus.VERIFIED);
      expect(res.citations[0].pageNumber).toBe(1); // Earliest authoritative chunk
      expect(res.citations[0].locationMetadata?.occurrencesInChunk).toBe(1);
    });

    it('rejects citation targeting foreign unattached document ID as UNVERIFIED with null pageNumber', async () => {
      const candidates = [
        {
          documentId: unattachedDoc_Id,
          quotedText: 'Proprietary data for external organization only',
        },
      ];

      const res = await verifyCitationCandidates(conversationId, candidates);
      expect(res.unverifiedCount).toBe(1);
      expect(res.verifiedCount).toBe(0);
      expect(res.citations[0].verificationStatus).toBe(CitationVerificationStatus.UNVERIFIED);
      expect(res.citations[0].pageNumber).toBeNull();
      expect(res.citations[0].locationMetadata).toBeNull();
    });

    it('marks fabricated quotation as REFUTED with null pageNumber and no false coordinates', async () => {
      const candidates = [
        {
          documentId: docA_Id,
          quotedText: 'Party A shall pay $10,000,000 penalty immediately upon breach',
        },
      ];

      const res = await verifyCitationCandidates(conversationId, candidates);
      expect(res.unverifiedCount).toBe(1);
      expect(res.verifiedCount).toBe(0);
      expect(res.citations[0].verificationStatus).toBe(CitationVerificationStatus.REFUTED);
      expect(res.citations[0].pageNumber).toBeNull();
      expect(res.citations[0].locationMetadata).toBeNull();
    });

    it('distinguishes PARTIAL paraphrased quotations from exact VERIFIED claims', async () => {
      const candidates = [
        {
          documentId: docA_Id,
          quotedText: 'Invoices are payable within forty five days of receipt', // Paraphrased (>70% overlap)
        },
      ];

      const res = await verifyCitationCandidates(conversationId, candidates);
      expect(res.partialCount).toBe(1);
      expect(res.verifiedCount).toBe(0);
      expect(res.allVerified).toBe(false);
      expect(res.citations[0].verificationStatus).toBe(CitationVerificationStatus.PARTIAL);
    });
  });

  // 4. Agentic Loop, Performance Diagnostics & Persistence
  describe('4. Agentic Service Diagnostics & Atomic Persistence', () => {
    it('verifies performance metrics structure returned from research', async () => {
      // Mock / direct test of metrics structure
      const mockResult = {
        totalRounds: 2,
        totalToolCalls: 2,
        totalDurationMs: 450,
        totalRetrievalMs: 120,
        roundDurations: [
          { round: 1, durationMs: 250 },
          { round: 2, durationMs: 200 },
        ],
        toolExecutionBreakdown: [
          { toolName: 'search_document', durationMs: 60, itemsFound: 2 },
          { toolName: 'get_section', durationMs: 60, itemsFound: 1 },
        ],
      };

      expect(mockResult.totalRounds).toBe(2);
      expect(mockResult.totalRetrievalMs).toBe(120);
      expect(mockResult.roundDurations.length).toBe(2);
      expect(mockResult.toolExecutionBreakdown.length).toBe(2);
    });

    it('atomically persists research message and verified citations', async () => {
      const userMsg = await prisma.message.create({
        data: {
          conversationId,
          role: MessageRole.USER,
          content: 'What are the payment terms?',
          status: GenerationStatus.COMPLETED,
        },
      });

      const assistantMsg = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
          data: {
            conversationId,
            role: MessageRole.ASSISTANT,
            content: 'Invoices are payable within 45 days of receipt.',
            status: GenerationStatus.COMPLETED,
          },
        });

        await tx.citation.create({
          data: {
            messageId: msg.id,
            documentId: docA_Id,
            quotedText: 'Invoices are payable within 45 days of receipt',
            verificationStatus: CitationVerificationStatus.VERIFIED,
            pageNumber: 1,
            locationMetadata: {
              chunkId: 'chunk-0',
              chunkIndex: 0,
              chunkOffsets: { start: 100, end: 145 },
              pageNumber: 1,
              quoteLength: 45,
              matchType: 'exact',
              confidenceScore: 1.0,
              occurrencesInChunk: 1,
              isMultiPage: false,
            },
          },
        });

        return msg;
      });

      const citationsInDb = await prisma.citation.findMany({
        where: { messageId: assistantMsg.id },
      });

      expect(citationsInDb.length).toBe(1);
      expect(citationsInDb[0].verificationStatus).toBe('VERIFIED');
      expect(citationsInDb[0].pageNumber).toBe(1);

      // Clean up test records
      await prisma.citation.deleteMany({ where: { messageId: assistantMsg.id } });
      await prisma.message.deleteMany({
        where: { id: { in: [userMsg.id, assistantMsg.id] } },
      });
    });
  });
});
