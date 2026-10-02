import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  retrieveMultiDocumentChunks,
  retrieveRelevantChunks,
  extractSearchTerms,
  scoreChunk,
} from '@/lib/retrieval';
import { DocumentStatus } from '@prisma/client';

describe('Phase 4 — Multi-Document Retrieval & Isolation Tests', () => {
  let docA_Id: string;
  let docB_Id: string;
  let docC_UnrelatedId: string;
  let conversationId: string;

  const docA_Text =
    'Article 4: Payment Terms. The Client shall pay all invoices within thirty (30) days of receipt via electronic bank transfer. Failure to pay on time incurs 1.5% interest monthly.';
  const docB_Text =
    'Section 6: Invoicing and Payment. Invoices must be settled within sixty (60) days of receipt through wire transfer. Late fees of 2.0% per month shall apply to past due balances.';
  const docC_Text =
    'Clause 10: Environmental Compliance. The supplier shall adhere to ISO 14001 environmental standards and reduce carbon emissions by 25% annually.';

  beforeAll(async () => {
    // 1. Create Document A (COMPLETED)
    const docA = await prisma.document.create({
      data: {
        originalFilename: 'Master_Services_Agreement_2024.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/docA-${Date.now()}.pdf`,
        fileSize: 2000,
        status: DocumentStatus.COMPLETED,
      },
    });
    docA_Id = docA.id;

    await prisma.documentPage.create({
      data: {
        documentId: docA_Id,
        pageNumber: 1,
        extractedText: docA_Text,
      },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: docA_Id,
        chunkIndex: 0,
        chunkText: docA_Text,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: docA_Text.length },
      },
    });

    // 2. Create Document B (COMPLETED)
    const docB = await prisma.document.create({
      data: {
        originalFilename: 'Master_Services_Agreement_2025_v2.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/docB-${Date.now()}.pdf`,
        fileSize: 2100,
        status: DocumentStatus.COMPLETED,
      },
    });
    docB_Id = docB.id;

    await prisma.documentPage.create({
      data: {
        documentId: docB_Id,
        pageNumber: 1,
        extractedText: docB_Text,
      },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: docB_Id,
        chunkIndex: 0,
        chunkText: docB_Text,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: docB_Text.length },
      },
    });

    // 3. Create Document C (COMPLETED, but Unrelated / Unselected)
    const docC = await prisma.document.create({
      data: {
        originalFilename: 'Environmental_Policy_2024.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/docC-${Date.now()}.pdf`,
        fileSize: 1800,
        status: DocumentStatus.COMPLETED,
      },
    });
    docC_UnrelatedId = docC.id;

    await prisma.documentPage.create({
      data: {
        documentId: docC_UnrelatedId,
        pageNumber: 1,
        extractedText: docC_Text,
      },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: docC_UnrelatedId,
        chunkIndex: 0,
        chunkText: docC_Text,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: docC_Text.length },
      },
    });

    // 4. Create conversation attached ONLY to Doc A and Doc B
    const conv = await prisma.conversation.create({
      data: {
        title: 'MSA Comparison Conversation',
      },
    });
    conversationId = conv.id;

    await prisma.conversationDocument.createMany({
      data: [
        { conversationId, documentId: docA_Id },
        { conversationId, documentId: docB_Id },
      ],
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
    if (docC_UnrelatedId) {
      await prisma.document.delete({ where: { id: docC_UnrelatedId } }).catch(() => {});
    }
  });

  it('1. extracts relevant search terms excluding common stop words', () => {
    const { terms, phrases } = extractSearchTerms('What are the "payment terms" and wire transfer fees?');
    expect(phrases).toContain('payment terms');
    expect(terms).toContain('payment');
    expect(terms).toContain('wire');
    expect(terms).toContain('transfer');
    expect(terms).toContain('fees');
    expect(terms).not.toContain('what');
    expect(terms).not.toContain('are');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('and');
  });

  it('2. scores chunks accurately with phrase matches and term frequencies', () => {
    const { terms, phrases } = extractSearchTerms('What are the "payment terms"?');
    const scoreA = scoreChunk(docA_Text, terms, phrases, 'What are the "payment terms"?');
    const scoreC = scoreChunk(docC_Text, terms, phrases, 'What are the "payment terms"?');

    expect(scoreA).toBeGreaterThan(15);
    expect(scoreC).toBe(0);
  });

  it('3. performs balanced multi-document retrieval retrieving from both Doc A and Doc B', async () => {
    const result = await retrieveMultiDocumentChunks(
      [docA_Id, docB_Id],
      'What are the payment terms and invoice timelines?'
    );

    expect(result.success).toBe(true);
    expect(result.hasRelevantEvidence).toBe(true);
    expect(result.documentContexts.length).toBe(2);

    const docA_Context = result.documentContexts.find((d) => d.documentId === docA_Id);
    const docB_Context = result.documentContexts.find((d) => d.documentId === docB_Id);

    expect(docA_Context).toBeDefined();
    expect(docB_Context).toBeDefined();
    expect(docA_Context!.chunks.length).toBeGreaterThan(0);
    expect(docB_Context!.chunks.length).toBeGreaterThan(0);

    // Verify chunk preserves offsets and page numbers
    const chunkA = docA_Context!.chunks[0];
    expect(chunkA.pageNumber).toBe(1);
    expect(chunkA.startOffset).toBe(0);
    expect(chunkA.endOffset).toBe(docA_Text.length);
  });

  it('4. strictly preserves document isolation and never retrieves unselected Doc C', async () => {
    const result = await retrieveMultiDocumentChunks(
      [docA_Id, docB_Id],
      'environmental compliance ISO 14001 payment terms'
    );

    expect(result.success).toBe(true);
    const foundDocC = result.allChunks.some((c) => c.documentId === docC_UnrelatedId);
    expect(foundDocC).toBe(false);

    const docC_InContexts = result.documentContexts.some((d) => d.documentId === docC_UnrelatedId);
    expect(docC_InContexts).toBe(false);
  });

  it('5. handles duplicate document IDs deterministically', async () => {
    const result = await retrieveMultiDocumentChunks(
      [docA_Id, docA_Id, docB_Id],
      'payment terms'
    );

    expect(result.success).toBe(true);
    expect(result.documentContexts.length).toBe(2);
    expect(result.queriedDocumentIds.length).toBe(2);
  });

  it('6. retrieves balanced context in multi-document conversations via retrieveRelevantChunks', async () => {
    const result = await retrieveRelevantChunks(
      conversationId,
      'Compare payment terms and invoice due dates'
    );

    expect(result.success).toBe(true);
    expect(result.hasRelevantEvidence).toBe(true);
    expect(result.attachedDocumentIds.length).toBe(2);

    const hasDocA = result.chunks.some((c) => c.documentId === docA_Id);
    const hasDocB = result.chunks.some((c) => c.documentId === docB_Id);
    const hasDocC = result.chunks.some((c) => c.documentId === docC_UnrelatedId);

    expect(hasDocA).toBe(true);
    expect(hasDocB).toBe(true);
    expect(hasDocC).toBe(false); // Isolated!
  });
});
