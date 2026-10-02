import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '@/lib/prisma';
import {
  executeSearchDocument,
  executeGetSection,
  executeListClauses,
  dispatchAgenticTool,
  PermittedDocumentScope,
} from '@/lib/agentic-tools';
import { DocumentStatus } from '@prisma/client';

describe('Phase 5 — Agentic Document Research Tools Unit Tests', () => {
  let docA_Id: string;
  let docB_Id: string;
  let permittedScope: PermittedDocumentScope;

  const docA_Page1 =
    'Article 1: Scope & Purpose. This Agreement establishes the licensing relationship.\n\nArticle 2: Payment and Fees. Invoices must be paid within thirty (30) days of receipt.\n\nArticle 3: Term & Termination. The initial term is two (2) years with thirty (30) days termination notice.';
  const docA_Page2 =
    'Article 4: Limitation of Liability. Total liability shall not exceed $1,000,000.\n\nArticle 5: Governing Law. This Agreement is governed by Delaware law.';

  const docB_Page1 =
    'Section 1: Confidentiality Obligations. The Receiving Party agrees to maintain strict secrecy for five (5) years.\n\nSection 2: Intellectual Property. Licensor retains all worldwide patents.';

  beforeAll(async () => {
    // 1. Create Document A (2 pages)
    const docA = await prisma.document.create({
      data: {
        originalFilename: 'Agentic_Test_License.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/agentic-docA-${Date.now()}.pdf`,
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
        originalFilename: 'Agentic_Test_NDA.pdf',
        mimeType: 'application/pdf',
        storageKey: `test/agentic-docB-${Date.now()}.pdf`,
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

    permittedScope = {
      documentIds: [docA_Id, docB_Id],
      docMap: new Map([
        [docA_Id, 'Agentic_Test_License.pdf'],
        [docB_Id, 'Agentic_Test_NDA.pdf'],
      ]),
    };
  });

  afterAll(async () => {
    if (docA_Id) {
      await prisma.document.delete({ where: { id: docA_Id } }).catch(() => {});
    }
    if (docB_Id) {
      await prisma.document.delete({ where: { id: docB_Id } }).catch(() => {});
    }
  });

  // Tool 1: search_document tests
  describe('Tool 1: search_document', () => {
    it('1. successfully searches across permitted documents for payment query', async () => {
      const res = await executeSearchDocument(permittedScope, {
        query: 'payment and invoice fees',
      });

      expect(res.success).toBe(true);
      expect(res.itemsFound).toBeGreaterThan(0);
      expect(res.data.passages).toBeDefined();
      const passages = res.data.passages as any[];
      expect(passages[0].content).toContain('Payment and Fees');
    });

    it('2. restricts search to specific documentId when provided', async () => {
      const res = await executeSearchDocument(permittedScope, {
        query: 'confidentiality obligations secrecy',
        documentId: docB_Id,
      });

      expect(res.success).toBe(true);
      const passages = res.data.passages as any[];
      expect(passages.every((p) => p.documentId === docB_Id)).toBe(true);
    });

    it('3. rejects search with out-of-scope documentId', async () => {
      const res = await executeSearchDocument(permittedScope, {
        query: 'payment',
        documentId: 'unauthorized-doc-id',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('not in the permitted document scope');
    });

    it('4. rejects empty search query', async () => {
      const res = await executeSearchDocument(permittedScope, {
        query: '   ',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Query parameter is required');
    });
  });

  // Tool 2: get_section tests
  describe('Tool 2: get_section', () => {
    it('5. retrieves specific section heading with exact page number', async () => {
      const res = await executeGetSection(permittedScope, {
        documentId: docA_Id,
        sectionHint: 'Limitation of Liability',
      });

      expect(res.success).toBe(true);
      expect(res.itemsFound).toBeGreaterThan(0);
      const sections = res.data.sections as any[];
      expect(sections[0].pageNumber).toBe(2);
      expect(sections[0].matchedText).toContain('Total liability shall not exceed $1,000,000');
    });

    it('6. validates and rejects invalid page ranges where startPage > endPage', async () => {
      const res = await executeGetSection(permittedScope, {
        documentId: docA_Id,
        sectionHint: 'Payment',
        startPage: 5,
        endPage: 2,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('cannot be greater than endPage');
    });

    it('7. rejects get_section with missing or out-of-scope documentId', async () => {
      const res = await executeGetSection(permittedScope, {
        documentId: 'fake-doc-id',
        sectionHint: 'Payment',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid or out-of-scope documentId');
    });

    it('8. rejects get_section with missing sectionHint', async () => {
      const res = await executeGetSection(permittedScope, {
        documentId: docA_Id,
        sectionHint: '',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Field "sectionHint" is required');
    });
  });

  // Tool 3: list_clauses tests
  describe('Tool 3: list_clauses', () => {
    it('9. discovers and lists contract clause headings in a document', async () => {
      const res = await executeListClauses(permittedScope, {
        documentId: docA_Id,
      });

      expect(res.success).toBe(true);
      expect(res.itemsFound).toBeGreaterThan(0);
      const detected = res.data.detectedClauses as any[];
      expect(detected.some((d) => d.heading.includes('Scope & Purpose'))).toBe(true);
      expect(detected.some((d) => d.heading.includes('Payment and Fees'))).toBe(true);
    });

    it('10. filters clause headings by topic when provided', async () => {
      const res = await executeListClauses(permittedScope, {
        documentId: docA_Id,
        topic: 'liability',
      });

      expect(res.success).toBe(true);
      const detected = res.data.detectedClauses as any[];
      expect(detected.length).toBe(1);
      expect(detected[0].heading).toContain('Limitation of Liability');
    });

    it('11. rejects list_clauses for out-of-scope document', async () => {
      const res = await executeListClauses(permittedScope, {
        documentId: 'foreign-id',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('Invalid or out-of-scope documentId');
    });
  });

  // Dispatcher tests
  describe('Tool Dispatcher', () => {
    it('12. rejects execution of unknown tool name', async () => {
      const res = await dispatchAgenticTool('execute_sql_query', {}, permittedScope);
      expect(res.success).toBe(false);
      expect(res.error).toContain('Unknown tool');
    });
  });
});
