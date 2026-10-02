import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import { parseGeminiJson } from '@/lib/gemini-service';
import { formatRetrievedContext } from '@/lib/gemini-prompt';
import { DocumentStatus } from '@prisma/client';

describe('Conversation Management & Gemini QA Flow - Hardened Audit', () => {
  let docId: string;
  let uncompletedDocId: string;
  let convId: string;

  beforeAll(async () => {
    // 1. Create a completed document
    const doc = await prisma.document.create({
      data: {
        originalFilename: 'consulting_agreement.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/consult-${Date.now()}.pdf`,
        fileSize: 2000,
        status: DocumentStatus.COMPLETED,
      },
    });
    docId = doc.id;

    // 2. Create an uncompleted document
    const uncompletedDoc = await prisma.document.create({
      data: {
        originalFilename: 'processing_draft.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/draft-${Date.now()}.pdf`,
        fileSize: 2000,
        status: DocumentStatus.PROCESSING,
      },
    });
    uncompletedDocId = uncompletedDoc.id;
  });

  afterAll(async () => {
    if (convId) {
      await prisma.conversation.delete({ where: { id: convId } }).catch(() => {});
    }
    if (docId) {
      await prisma.document.delete({ where: { id: docId } }).catch(() => {});
    }
    if (uncompletedDocId) {
      await prisma.document.delete({ where: { id: uncompletedDocId } }).catch(() => {});
    }
  });

  it('correctly parses JSON from Gemini even with surrounding markdown fences', () => {
    const rawJsonWithFences =
      '```json\n{\n  "answer": "Payment is due net 30 days.",\n  "hasSufficientEvidence": true,\n  "citations": [\n    {\n      "documentId": "doc1",\n      "chunkId": "chunk1",\n      "quotedText": "net 30 days"\n    }\n  ]\n}\n```';

    const parsed = parseGeminiJson(rawJsonWithFences);
    expect(parsed.answer).toBe('Payment is due net 30 days.');
    expect(parsed.hasSufficientEvidence).toBe(true);
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0].quotedText).toBe('net 30 days');
  });

  it('handles malformed or non-JSON Gemini output by falling back safely to raw text without throwing', () => {
    const rawNonJson = 'I could not find the exact clause in the provided excerpts.';
    const parsed = parseGeminiJson(rawNonJson);
    expect(parsed.answer).toBe(rawNonJson);
    expect(parsed.citations).toEqual([]);
    expect(parsed.hasSufficientEvidence).toBe(true);
  });

  it('formats retrieved chunks into structured XML context safely', () => {
    const chunks = [
      {
        chunkId: 'chk_1',
        documentId: 'doc_1',
        documentName: 'Service_Contract.pdf',
        pageNumber: 2,
        chunkIndex: 0,
        chunkText: 'Section 4: Termination for Convenience requires 60 days written notice.',
        score: 10,
        metadata: null,
      },
    ];

    const xml = formatRetrievedContext(chunks);
    expect(xml).toContain('<retrieved_evidence>');
    expect(xml).toContain('documentId="doc_1"');
    expect(xml).toContain('chunkId="chk_1"');
    expect(xml).toContain('page="2"');
    expect(xml).toContain('60 days written notice');
  });

  it('persists conversation with completed document and associates with database records', async () => {
    const conv = await prisma.conversation.create({
      data: {
        title: 'Consulting Q&A',
      },
    });
    convId = conv.id;

    await prisma.conversationDocument.create({
      data: {
        conversationId: convId,
        documentId: docId,
      },
    });

    const retrieved = await prisma.conversation.findUnique({
      where: { id: convId },
      include: { documents: true },
    });

    expect(retrieved).not.toBeNull();
    expect(retrieved?.documents).toHaveLength(1);
    expect(retrieved?.documents[0].documentId).toBe(docId);
  });
});
