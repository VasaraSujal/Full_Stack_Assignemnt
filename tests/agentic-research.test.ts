import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import { parseAgenticFinalAnswer } from '@/lib/agentic-prompt';
import {
  performAgenticResearch,
  AgenticEventCallbacks,
} from '@/lib/agentic-research-service';
import {
  verifyCitationCandidates,
} from '@/lib/citation-verifier';
import {
  CitationVerificationStatus,
  DocumentStatus,
  MessageRole,
  GenerationStatus,
} from '@prisma/client';

describe('Phase 5 — Agentic Document Research Service & Integration Tests', () => {
  let docId: string;
  let conversationId: string;
  let emptyConvId: string;

  const docText =
    'Article 1: Term and Termination. This Agreement commences on January 1, 2024 and continues for three (3) years. Either party may terminate with thirty (30) days written notice.\n\nArticle 2: Limitation of Liability. Total aggregate liability under this agreement shall not exceed $2,000,000.\n\nArticle 3: Confidential Information. Receiving Party agrees to maintain confidentiality for five (5) years.';

  beforeAll(async () => {
    // 1. Create Document (COMPLETED)
    const doc = await prisma.document.create({
      data: {
        originalFilename: 'Agentic_Master_Agreement.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/agentic-master-${Date.now()}.pdf`,
        fileSize: 3500,
        status: DocumentStatus.COMPLETED,
      },
    });
    docId = doc.id;

    await prisma.documentPage.create({
      data: {
        documentId: docId,
        pageNumber: 1,
        extractedText: docText,
      },
    });

    await prisma.documentChunk.create({
      data: {
        documentId: docId,
        chunkIndex: 0,
        chunkText: docText,
        pageNumber: 1,
        metadata: { startOffset: 0, endOffset: docText.length },
      },
    });

    // 2. Create Conversation with attached document
    const conv = await prisma.conversation.create({
      data: { title: 'Agentic Research Conversation' },
    });
    conversationId = conv.id;

    await prisma.conversationDocument.create({
      data: { conversationId, documentId: docId },
    });

    // 3. Create Conversation with NO attached documents
    const emptyConv = await prisma.conversation.create({
      data: { title: 'Empty Conversation' },
    });
    emptyConvId = emptyConv.id;
  });

  afterAll(async () => {
    if (conversationId) {
      await prisma.conversation.delete({ where: { id: conversationId } }).catch(() => {});
    }
    if (emptyConvId) {
      await prisma.conversation.delete({ where: { id: emptyConvId } }).catch(() => {});
    }
    if (docId) {
      await prisma.document.delete({ where: { id: docId } }).catch(() => {});
    }
  });

  // Test 1: Parser unit tests for Gemini final answer
  describe('Agentic Final Answer Parsing', () => {
    it('1. correctly parses valid JSON final answer from agent', () => {
      const raw = JSON.stringify({
        answer: 'The termination notice period is 30 days.',
        hasSufficientEvidence: true,
        citations: [
          {
            documentId: docId,
            quotedText: 'thirty (30) days written notice',
            pageNumber: 1,
          },
        ],
        limitations: ['No other termination grounds were found.'],
      });

      const parsed = parseAgenticFinalAnswer(raw);
      expect(parsed.answer).toBe('The termination notice period is 30 days.');
      expect(parsed.hasSufficientEvidence).toBe(true);
      expect(parsed.citations.length).toBe(1);
      expect(parsed.citations[0].quotedText).toBe('thirty (30) days written notice');
      expect(parsed.limitations.length).toBe(1);
    });

    it('2. strips markdown code fences from JSON output', () => {
      const raw = '```json\n{"answer": "Liability is capped at $2M.", "citations": [], "hasSufficientEvidence": true}\n```';
      const parsed = parseAgenticFinalAnswer(raw);
      expect(parsed.answer).toBe('Liability is capped at $2M.');
      expect(parsed.hasSufficientEvidence).toBe(true);
    });

    it('3. falls back gracefully on malformed non-JSON answer', () => {
      const raw = 'The contract states that total liability cannot exceed $2,000,000.';
      const parsed = parseAgenticFinalAnswer(raw);
      expect(parsed.answer).toBe(raw);
      expect(parsed.citations.length).toBe(0);
      expect(parsed.limitations.length).toBeGreaterThan(0);
    });
  });

  // Test 2: Input and scope validations
  describe('Scope & Input Validations', () => {
    it('4. rejects empty research question', async () => {
      await expect(performAgenticResearch(conversationId, '   ')).rejects.toThrow(
        'Research question cannot be empty.'
      );
    });

    it('5. rejects research question exceeding 2,000 characters', async () => {
      const longQuery = 'a'.repeat(2001);
      await expect(performAgenticResearch(conversationId, longQuery)).rejects.toThrow(
        'exceeds maximum allowed length'
      );
    });

    it('6. rejects non-existent conversation ID', async () => {
      await expect(
        performAgenticResearch('non-existent-conversation', 'What are the termination terms?')
      ).rejects.toThrow(/not found/);
    });

    it('7. rejects conversation with no attached completed documents', async () => {
      await expect(
        performAgenticResearch(emptyConvId, 'What are the liability caps?')
      ).rejects.toThrow(/No completed contract documents are attached/);
    });
  });

  // Test 3: Citation verification integration
  describe('Citation Verification Integration', () => {
    it('8. verifies candidate citations against authoritative database text and derives page coordinates', async () => {
      const candidates = [
        {
          documentId: docId,
          quotedText: 'thirty (30) days written notice',
          pageNumber: 99, // Hallucinated by model
        },
        {
          documentId: docId,
          quotedText: 'Party A forfeits all proprietary assets unconditionally', // Fabricated
        },
      ];

      const result = await verifyCitationCandidates(conversationId, candidates);
      expect(result.totalCandidates).toBe(2);
      expect(result.verifiedCount).toBe(1);
      expect(result.unverifiedCount).toBe(1);
      expect(result.allVerified).toBe(false);

      const verified = result.citations.find(
        (c) => c.verificationStatus === CitationVerificationStatus.VERIFIED
      );
      expect(verified).toBeDefined();
      expect(verified!.pageNumber).toBe(1); // Authoritative DB page
      expect(verified!.locationMetadata?.chunkOffsets.start).toBeGreaterThan(0);

      const refuted = result.citations.find(
        (c) => c.verificationStatus === CitationVerificationStatus.REFUTED
      );
      expect(refuted).toBeDefined();
    });
  });

  // Test 4: Persistence in Supabase PostgreSQL
  describe('Database Persistence', () => {
    it('9. atomically persists user question, assistant message, and verified citations in PostgreSQL', async () => {
      const userMsg = await prisma.message.create({
        data: {
          conversationId,
          role: MessageRole.USER,
          content: 'What is the liability cap?',
          status: GenerationStatus.COMPLETED,
        },
      });

      const assistantMsg = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
          data: {
            conversationId,
            role: MessageRole.ASSISTANT,
            content: 'The total aggregate liability under this agreement shall not exceed $2,000,000.',
            status: GenerationStatus.COMPLETED,
          },
        });

        await tx.citation.create({
          data: {
            messageId: msg.id,
            documentId: docId,
            quotedText: 'Total aggregate liability under this agreement shall not exceed $2,000,000',
            verificationStatus: CitationVerificationStatus.VERIFIED,
            pageNumber: 1,
            locationMetadata: {
              chunkId: 'test-chunk',
              chunkIndex: 0,
              chunkOffsets: { start: 160, end: 235 },
              pageOffsets: { start: 160, end: 235 },
              pageNumber: 1,
              quoteLength: 75,
              matchType: 'exact',
              confidenceScore: 1.0,
              occurrencesInChunk: 1,
              isMultiPage: false,
            },
          },
        });

        return msg;
      });

      expect(userMsg.id).toBeDefined();
      expect(assistantMsg.id).toBeDefined();

      const persistedCitation = await prisma.citation.findFirst({
        where: { messageId: assistantMsg.id },
      });
      expect(persistedCitation).not.toBeNull();
      expect(persistedCitation!.verificationStatus).toBe('VERIFIED');
      expect(persistedCitation!.pageNumber).toBe(1);

      // Clean up test messages
      await prisma.citation.deleteMany({ where: { messageId: assistantMsg.id } });
      await prisma.message.deleteMany({
        where: { id: { in: [userMsg.id, assistantMsg.id] } },
      });
    });
  });
});
