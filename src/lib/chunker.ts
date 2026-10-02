import { ExtractedPage } from './text-extractor';

export interface ChunkItem {
  chunkIndex: number;
  chunkText: string;
  pageNumber: number;
  metadata: {
    pageNumber: number;
    startOffset: number;
    endOffset: number;
    charCount: number;
  };
}

export interface ChunkingOptions {
  chunkSize?: number; // Target chunk size in characters (default 1000)
  chunkOverlap?: number; // Target overlap between consecutive chunks (default 200)
  minChunkSize?: number; // Minimum meaningful chunk size (default 50)
}

/**
 * Find the optimal breaking point near targetOffset (preferring paragraphs, newlines, and sentences)
 */
function findOptimalBreak(text: string, targetOffset: number, maxLookback: number = 100): number {
  if (targetOffset >= text.length) {
    return text.length;
  }

  const start = Math.max(0, targetOffset - maxLookback);
  const searchSlice = text.slice(start, targetOffset);

  // 1. Check for paragraph boundary (\n\n)
  const paragraphBreak = searchSlice.lastIndexOf('\n\n');
  if (paragraphBreak !== -1 && paragraphBreak >= maxLookback / 3) {
    return start + paragraphBreak + 2;
  }

  // 2. Check for sentence boundary (. / ! / ? followed by space or newline)
  const sentenceMatches = Array.from(searchSlice.matchAll(/[.!?][\s\n]/g));
  if (sentenceMatches.length > 0) {
    const lastMatch = sentenceMatches[sentenceMatches.length - 1];
    if (typeof lastMatch.index === 'number') {
      return start + lastMatch.index + 2;
    }
  }

  // 3. Check for single newline
  const lineBreak = searchSlice.lastIndexOf('\n');
  if (lineBreak !== -1) {
    return start + lineBreak + 1;
  }

  // 4. Check for whitespace / word boundary
  const spaceBreak = searchSlice.lastIndexOf(' ');
  if (spaceBreak !== -1) {
    return start + spaceBreak + 1;
  }

  // Fallback to exact target
  return targetOffset;
}

/**
 * Generate deterministic document chunks with overlap across pages.
 * Offsets in metadata are strictly 0-based character indices relative to the authoritative DocumentPage.extractedText.
 */
export function generateDocumentChunks(
  pages: ExtractedPage[],
  options: ChunkingOptions = {}
): ChunkItem[] {
  const chunkSize = options.chunkSize || 1000;
  const chunkOverlap = options.chunkOverlap || 200;
  const minChunkSize = options.minChunkSize || 50;

  const chunks: ChunkItem[] = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    const text = (page.text || '').trim();
    if (!text || text.length < minChunkSize) {
      if (text.length > 0) {
        chunks.push({
          chunkIndex: globalChunkIndex++,
          chunkText: text,
          pageNumber: page.pageNumber,
          metadata: {
            pageNumber: page.pageNumber,
            startOffset: 0,
            endOffset: text.length,
            charCount: text.length,
          },
        });
      }
      continue;
    }

    // If page text fits within chunk size, keep as single chunk
    if (text.length <= chunkSize) {
      chunks.push({
        chunkIndex: globalChunkIndex++,
        chunkText: text,
        pageNumber: page.pageNumber,
        metadata: {
          pageNumber: page.pageNumber,
          startOffset: 0,
          endOffset: text.length,
          charCount: text.length,
        },
      });
      continue;
    }

    // Sliding window chunking
    let startOffset = 0;
    while (startOffset < text.length) {
      const targetEnd = startOffset + chunkSize;
      let actualEnd = findOptimalBreak(text, targetEnd, Math.min(chunkOverlap, 100));

      // Guarantee forward progress
      if (actualEnd <= startOffset) {
        actualEnd = Math.min(text.length, startOffset + chunkSize);
      }

      const rawSlice = text.slice(startOffset, actualEnd);
      const leadingTrim = rawSlice.length - rawSlice.trimStart().length;
      const chunkText = rawSlice.trim();
      const chunkStartOffset = startOffset + leadingTrim;
      const chunkEndOffset = chunkStartOffset + chunkText.length;

      if (chunkText.length >= minChunkSize || chunks.length === 0) {
        chunks.push({
          chunkIndex: globalChunkIndex++,
          chunkText,
          pageNumber: page.pageNumber,
          metadata: {
            pageNumber: page.pageNumber,
            startOffset: chunkStartOffset,
            endOffset: chunkEndOffset,
            charCount: chunkText.length,
          },
        });
      }

      if (actualEnd >= text.length) {
        break;
      }

      // Step forward with overlap
      const step = Math.max(1, actualEnd - startOffset - chunkOverlap);
      startOffset += step;
    }
  }

  return chunks;
}
