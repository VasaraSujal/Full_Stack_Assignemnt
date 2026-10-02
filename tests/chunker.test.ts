import { describe, it, expect } from 'vitest';
import { generateDocumentChunks } from '@/lib/chunker';

describe('Document Chunker Service', () => {
  it('generates a single chunk for short text within chunkSize', () => {
    const pages = [
      {
        pageNumber: 1,
        text: 'This is a short NDA contract agreement between Party A and Party B.',
      },
    ];

    const chunks = generateDocumentChunks(pages, { chunkSize: 500, chunkOverlap: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[0].chunkText).toBe(pages[0].text);
    expect(chunks[0].metadata.charCount).toBe(pages[0].text.length);
  });

  it('splits long text into multiple chunks with overlap', () => {
    const sentence =
      'The Receiving Party shall hold and maintain the Confidential Information in strictest confidence. ';
    const longText = sentence.repeat(20); // ~2000 characters

    const pages = [{ pageNumber: 1, text: longText }];
    const chunkSize = 400;
    const chunkOverlap = 100;

    const chunks = generateDocumentChunks(pages, { chunkSize, chunkOverlap });
    expect(chunks.length).toBeGreaterThan(1);

    // Verify sequential indexing
    chunks.forEach((c, idx) => {
      expect(c.chunkIndex).toBe(idx);
      expect(c.pageNumber).toBe(1);
      expect(c.chunkText.length).toBeGreaterThan(0);
    });

    // Verify overlap: end of chunk 0 should overlap with beginning of chunk 1
    const chunk0End = chunks[0].chunkText.slice(-50);
    expect(chunks[1].chunkText).toContain(chunk0End.slice(0, 30));
  });

  it('handles multi-page documents and preserves page number attribution', () => {
    const pages = [
      { pageNumber: 1, text: 'Page 1: Scope of Work and Deliverables definitions.' },
      { pageNumber: 2, text: 'Page 2: Payment Terms and Invoicing Schedule details.' },
      { pageNumber: 3, text: 'Page 3: Indemnification and Limitation of Liability.' },
    ];

    const chunks = generateDocumentChunks(pages, { chunkSize: 500, chunkOverlap: 100 });
    expect(chunks).toHaveLength(3);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[1].pageNumber).toBe(2);
    expect(chunks[2].pageNumber).toBe(3);
  });
});
