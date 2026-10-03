import prisma from '@/lib/prisma';
import { CitationVerificationStatus } from '@prisma/client';
import { GeminiCitationCandidate } from './gemini-prompt';

export interface CitationLocationMetadata {
  chunkId: string;
  chunkIndex: number;
  /**
   * Character offsets relative to the authoritative DocumentChunk.chunkText
   */
  chunkOffsets: {
    start: number;
    end: number;
  };
  /**
   * Character offsets relative to the authoritative DocumentPage.extractedText (when pageNumber & chunk page offset are available)
   */
  pageOffsets?: {
    start: number;
    end: number;
  };
  pageNumber: number | null;
  startPage?: number;
  endPage?: number;
  quoteLength: number;
  matchType: 'exact' | 'normalized' | 'partial' | 'unmatched';
  isMultiPage: boolean;
  confidenceScore: number;
  occurrencesInChunk: number;
}

export interface VerifiedCitation {
  documentId: string;
  documentName?: string;
  chunkId: string;
  quotedText: string;
  verificationStatus: CitationVerificationStatus;
  pageNumber: number | null;
  locationMetadata: CitationLocationMetadata | null;
  claim?: string;
}

export interface CitationVerificationResult {
  citations: VerifiedCitation[];
  totalCandidates: number;
  verifiedCount: number;
  partialCount: number;
  unverifiedCount: number;
  allVerified: boolean;
}

import { ARABIC_DIACRITIC_CHAR_REGEX, normalizeArabicText } from './arabic-support';

/**
 * Normalize whitespace, newlines, quotes, and Arabic diacritics for comparison
 */
export function normalizeTextForComparison(text: string): string {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Normalize Arabic diacritics (tashkeel), tatweel, and letter forms
  cleaned = normalizeArabicText(cleaned);
  return cleaned;
}

/**
 * Build a normalized string with a 1-to-1 character index map back to raw source text
 * Resiliently handles whitespace, quotes, and Arabic diacritics/tashkeel
 */
export function buildNormalizedIndexMap(rawText: string): { normalizedText: string; indexMap: number[] } {
  let normalizedText = '';
  const indexMap: number[] = [];
  let inWhitespace = false;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];

    // Skip Arabic diacritics (tashkeel) and tatweel during normalized comparison
    if (ARABIC_DIACRITIC_CHAR_REGEX.test(ch)) {
      continue;
    }

    if (/\s/.test(ch)) {
      if (!inWhitespace && normalizedText.length > 0) {
        normalizedText += ' ';
        indexMap.push(i);
        inWhitespace = true;
      }
    } else {
      inWhitespace = false;
      let cleanChar = ch.toLowerCase();
      if (cleanChar === '\u2018' || cleanChar === '\u2019') cleanChar = "'";
      if (cleanChar === '\u201C' || cleanChar === '\u201D') cleanChar = '"';
      // Normalize Arabic Alef variants to bare Alef for robust matching
      if (/[أإآٱ]/.test(cleanChar)) cleanChar = 'ا';
      if (cleanChar === 'ة') cleanChar = 'ه';
      if (cleanChar === 'ى') cleanChar = 'ي';

      normalizedText += cleanChar;
      indexMap.push(i);
    }
  }

  return { normalizedText, indexMap };
}

/**
 * Locate quotation substring, track all occurrences, and calculate exact character offsets within authoritative source text
 */
export function findQuoteOffsets(
  sourceText: string,
  quote: string
): {
  found: boolean;
  startOffset: number;
  endOffset: number;
  matchType: 'exact' | 'normalized' | 'partial' | 'unmatched';
  occurrences: Array<{ start: number; end: number }>;
  confidence: number;
} {
  if (!sourceText || !quote || typeof sourceText !== 'string' || typeof quote !== 'string') {
    return {
      found: false,
      startOffset: -1,
      endOffset: -1,
      matchType: 'unmatched',
      occurrences: [],
      confidence: 0,
    };
  }

  const cleanQuote = quote.trim();
  if (cleanQuote.length === 0) {
    return {
      found: false,
      startOffset: -1,
      endOffset: -1,
      matchType: 'unmatched',
      occurrences: [],
      confidence: 0,
    };
  }

  // 1. Direct exact match (case-sensitive)
  const exactOccurrences: Array<{ start: number; end: number }> = [];
  let searchPos = 0;
  while (searchPos < sourceText.length) {
    const idx = sourceText.indexOf(cleanQuote, searchPos);
    if (idx === -1) break;
    exactOccurrences.push({ start: idx, end: idx + cleanQuote.length });
    searchPos = idx + Math.max(1, cleanQuote.length);
  }

  if (exactOccurrences.length > 0) {
    return {
      found: true,
      startOffset: exactOccurrences[0].start,
      endOffset: exactOccurrences[0].end,
      matchType: 'exact',
      occurrences: exactOccurrences,
      confidence: 1.0,
    };
  }

  // 2. Case-insensitive exact match
  const lowerSource = sourceText.toLowerCase();
  const lowerQuote = cleanQuote.toLowerCase();
  const caseOccurrences: Array<{ start: number; end: number }> = [];
  searchPos = 0;
  while (searchPos < lowerSource.length) {
    const idx = lowerSource.indexOf(lowerQuote, searchPos);
    if (idx === -1) break;
    caseOccurrences.push({ start: idx, end: idx + cleanQuote.length });
    searchPos = idx + Math.max(1, cleanQuote.length);
  }

  if (caseOccurrences.length > 0) {
    return {
      found: true,
      startOffset: caseOccurrences[0].start,
      endOffset: caseOccurrences[0].end,
      matchType: 'exact',
      occurrences: caseOccurrences,
      confidence: 0.98,
    };
  }

  // 3. Normalized whitespace & newline match with exact raw index mapping
  const { normalizedText: normSource, indexMap } = buildNormalizedIndexMap(sourceText);
  const normQuote = normalizeTextForComparison(cleanQuote);

  if (normQuote.length > 3 && normSource.includes(normQuote)) {
    const normalizedOccurrences: Array<{ start: number; end: number }> = [];
    let normSearchPos = 0;

    while (normSearchPos < normSource.length) {
      const matchIdx = normSource.indexOf(normQuote, normSearchPos);
      if (matchIdx === -1) break;

      const rawStart = indexMap[matchIdx];
      const rawEndIdx = Math.min(indexMap.length - 1, matchIdx + normQuote.length - 1);
      const rawEnd = indexMap[rawEndIdx] + 1;

      if (rawStart >= 0 && rawEnd > rawStart) {
        normalizedOccurrences.push({ start: rawStart, end: rawEnd });
      }

      normSearchPos = matchIdx + Math.max(1, normQuote.length);
    }

    if (normalizedOccurrences.length > 0) {
      return {
        found: true,
        startOffset: normalizedOccurrences[0].start,
        endOffset: normalizedOccurrences[0].end,
        matchType: 'normalized',
        occurrences: normalizedOccurrences,
        confidence: 0.95,
      };
    }
  }

  // 4. Check for partial overlap (e.g. 70%+ matching words, strictly tagged as partial)
  const extractWords = (str: string) =>
    str
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2);

  const normChunkWords = new Set(extractWords(normSource));
  const quoteWords = extractWords(normQuote);

  if (quoteWords.length >= 3) {
    const matchedWords = quoteWords.filter((w) => normChunkWords.has(w));
    const matchRatio = matchedWords.length / quoteWords.length;

    if (matchRatio >= 0.70) {
      return {
        found: false,
        startOffset: -1,
        endOffset: -1,
        matchType: 'partial',
        occurrences: [],
        confidence: Number((matchRatio * 0.7).toFixed(2)),
      };
    }
  }

  return {
    found: false,
    startOffset: -1,
    endOffset: -1,
    matchType: 'unmatched',
    occurrences: [],
    confidence: 0,
  };
}

/**
 * Verify candidate citations against authoritative database records
 */
export async function verifyCitationCandidates(
  conversationId: string,
  candidates: GeminiCitationCandidate[]
): Promise<CitationVerificationResult> {
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return {
      citations: [],
      totalCandidates: 0,
      verifiedCount: 0,
      partialCount: 0,
      unverifiedCount: 0,
      allVerified: true,
    };
  }

  // 1. Fetch attached documents for this conversation to prevent foreign document citations
  const convDocs = await prisma.conversationDocument.findMany({
    where: { conversationId },
    include: {
      document: {
        select: {
          id: true,
          originalFilename: true,
        },
      },
    },
  });

  const attachedDocMap = new Map(convDocs.map((cd) => [cd.documentId, cd.document.originalFilename]));

  // 2. Fetch authoritative chunks and pages for attached documents
  const attachedDocIds = Array.from(attachedDocMap.keys());
  const [chunks, pages] = await Promise.all([
    prisma.documentChunk.findMany({
      where: { documentId: { in: attachedDocIds } },
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        chunkText: true,
        pageNumber: true,
        metadata: true,
      },
      orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }],
    }),
    prisma.documentPage.findMany({
      where: { documentId: { in: attachedDocIds } },
      select: {
        id: true,
        documentId: true,
        pageNumber: true,
        extractedText: true,
      },
      orderBy: [{ documentId: 'asc' }, { pageNumber: 'asc' }],
    }),
  ]);

  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  // 3. Verify each candidate
  const verifiedCitations: VerifiedCitation[] = [];
  let verifiedCount = 0;
  let partialCount = 0;
  let unverifiedCount = 0;

  for (const candidate of candidates) {
    const docId = candidate.documentId;
    const chunkId = candidate.chunkId ? candidate.chunkId.trim() : '';
    const quote = (candidate.quotedText || '').trim();

    // Check 1: Does document belong to the conversation?
    if (!attachedDocMap.has(docId)) {
      unverifiedCount++;
      verifiedCitations.push({
        documentId: docId,
        chunkId: chunkId || '',
        quotedText: quote,
        verificationStatus: CitationVerificationStatus.UNVERIFIED,
        pageNumber: null,
        locationMetadata: null,
        claim: candidate.claim,
      });
      continue;
    }

    const docName = attachedDocMap.get(docId);
    const docChunks = chunks.filter((c) => c.documentId === docId);
    const docPages = pages.filter((p) => p.documentId === docId);

    // Check 2: Invalid or trivial quote
    if (!quote || quote.length < 3) {
      unverifiedCount++;
      verifiedCitations.push({
        documentId: docId,
        documentName: docName,
        chunkId: chunkId || '',
        quotedText: quote,
        verificationStatus: CitationVerificationStatus.UNVERIFIED,
        pageNumber: null,
        locationMetadata: null,
        claim: candidate.claim,
      });
      continue;
    }

    // Check 3: If specific chunkId provided, validate and check that chunk first
    if (chunkId) {
      const specifiedChunk = chunkMap.get(chunkId);
      if (!specifiedChunk || specifiedChunk.documentId !== docId) {
        unverifiedCount++;
        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId,
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.UNVERIFIED,
          pageNumber: null,
          locationMetadata: null,
          claim: candidate.claim,
        });
        continue;
      }

      const match = findQuoteOffsets(specifiedChunk.chunkText, quote);
      if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
        verifiedCount++;
        const chunkMeta = specifiedChunk.metadata as { startOffset?: number; endOffset?: number } | null;
        const pageStartOffset =
          typeof chunkMeta?.startOffset === 'number'
            ? chunkMeta.startOffset + match.startOffset
            : undefined;
        const pageEndOffset =
          typeof chunkMeta?.startOffset === 'number'
            ? chunkMeta.startOffset + match.endOffset
            : undefined;

        const locationMetadata: CitationLocationMetadata = {
          chunkId: specifiedChunk.id,
          chunkIndex: specifiedChunk.chunkIndex,
          chunkOffsets: {
            start: match.startOffset,
            end: match.endOffset,
          },
          ...(pageStartOffset !== undefined &&
            pageEndOffset !== undefined && {
              pageOffsets: {
                start: pageStartOffset,
                end: pageEndOffset,
              },
            }),
          pageNumber: specifiedChunk.pageNumber,
          quoteLength: quote.length,
          matchType: match.matchType,
          isMultiPage: false,
          confidenceScore: match.confidence,
          occurrencesInChunk: match.occurrences.length,
        };

        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: specifiedChunk.id,
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.VERIFIED,
          pageNumber: specifiedChunk.pageNumber,
          locationMetadata,
          claim: candidate.claim,
        });
        continue;
      } else if (match.matchType === 'partial') {
        partialCount++;
        const locationMetadata: CitationLocationMetadata = {
          chunkId: specifiedChunk.id,
          chunkIndex: specifiedChunk.chunkIndex,
          chunkOffsets: { start: -1, end: -1 },
          pageNumber: specifiedChunk.pageNumber,
          quoteLength: quote.length,
          matchType: 'partial',
          isMultiPage: false,
          confidenceScore: match.confidence,
          occurrencesInChunk: 0,
        };

        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: specifiedChunk.id,
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.PARTIAL,
          pageNumber: specifiedChunk.pageNumber,
          locationMetadata,
          claim: candidate.claim,
        });
        continue;
      } else {
        // Specified chunk does not match quote
        unverifiedCount++;
        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: specifiedChunk.id,
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.REFUTED,
          pageNumber: specifiedChunk.pageNumber,
          locationMetadata: null,
          claim: candidate.claim,
        });
        continue;
      }
    }

    // Check 4: No chunkId specified -> Auto-resolve across all chunks of the document
    let foundInChunk = false;
    for (const chunk of docChunks) {
      const match = findQuoteOffsets(chunk.chunkText, quote);
      if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
        verifiedCount++;
        foundInChunk = true;

        const chunkMeta = chunk.metadata as { startOffset?: number; endOffset?: number } | null;
        const pageStartOffset =
          typeof chunkMeta?.startOffset === 'number'
            ? chunkMeta.startOffset + match.startOffset
            : undefined;
        const pageEndOffset =
          typeof chunkMeta?.startOffset === 'number'
            ? chunkMeta.startOffset + match.endOffset
            : undefined;

        const locationMetadata: CitationLocationMetadata = {
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          chunkOffsets: {
            start: match.startOffset,
            end: match.endOffset,
          },
          ...(pageStartOffset !== undefined &&
            pageEndOffset !== undefined && {
              pageOffsets: {
                start: pageStartOffset,
                end: pageEndOffset,
              },
            }),
          pageNumber: chunk.pageNumber,
          quoteLength: quote.length,
          matchType: match.matchType,
          isMultiPage: false,
          confidenceScore: match.confidence,
          occurrencesInChunk: match.occurrences.length,
        };

        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: chunk.id,
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.VERIFIED,
          pageNumber: chunk.pageNumber,
          locationMetadata,
          claim: candidate.claim,
        });
        break;
      }
    }

    if (foundInChunk) continue;

    // Check 5: Search single page extracted text
    let foundInPage = false;
    for (const page of docPages) {
      const match = findQuoteOffsets(page.extractedText, quote);
      if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
        verifiedCount++;
        foundInPage = true;

        const locationMetadata: CitationLocationMetadata = {
          chunkId: '',
          chunkIndex: 0,
          chunkOffsets: {
            start: match.startOffset,
            end: match.endOffset,
          },
          pageOffsets: {
            start: match.startOffset,
            end: match.endOffset,
          },
          pageNumber: page.pageNumber,
          quoteLength: quote.length,
          matchType: match.matchType,
          isMultiPage: false,
          confidenceScore: match.confidence,
          occurrencesInChunk: match.occurrences.length,
        };

        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: '',
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.VERIFIED,
          pageNumber: page.pageNumber,
          locationMetadata,
          claim: candidate.claim,
        });
        break;
      }
    }

    if (foundInPage) continue;

    // Check 6: Search consecutive pages for cross-page quotation
    let foundMultiPage = false;
    for (let i = 0; i < docPages.length - 1; i++) {
      const p1 = docPages[i];
      const p2 = docPages[i + 1];
      const combined = `${p1.extractedText}\n\n${p2.extractedText}`;
      const match = findQuoteOffsets(combined, quote);

      if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
        verifiedCount++;
        foundMultiPage = true;

        const locationMetadata: CitationLocationMetadata = {
          chunkId: '',
          chunkIndex: 0,
          chunkOffsets: {
            start: match.startOffset,
            end: match.endOffset,
          },
          pageOffsets: {
            start: match.startOffset,
            end: match.endOffset,
          },
          pageNumber: p1.pageNumber,
          startPage: p1.pageNumber,
          endPage: p2.pageNumber,
          quoteLength: quote.length,
          matchType: match.matchType,
          isMultiPage: true,
          confidenceScore: match.confidence,
          occurrencesInChunk: match.occurrences.length,
        };

        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: '',
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.VERIFIED,
          pageNumber: p1.pageNumber,
          locationMetadata,
          claim: candidate.claim,
        });
        break;
      }
    }

    if (foundMultiPage) continue;

    // Check 7: Partial match check across document chunks
    let foundPartial = false;
    for (const chunk of docChunks) {
      const match = findQuoteOffsets(chunk.chunkText, quote);
      if (match.matchType === 'partial') {
        partialCount++;
        foundPartial = true;

        const locationMetadata: CitationLocationMetadata = {
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          chunkOffsets: { start: -1, end: -1 },
          pageNumber: chunk.pageNumber,
          quoteLength: quote.length,
          matchType: 'partial',
          isMultiPage: false,
          confidenceScore: match.confidence,
          occurrencesInChunk: 0,
        };

        verifiedCitations.push({
          documentId: docId,
          documentName: docName,
          chunkId: chunk.id,
          quotedText: quote,
          verificationStatus: CitationVerificationStatus.PARTIAL,
          pageNumber: chunk.pageNumber,
          locationMetadata,
          claim: candidate.claim,
        });
        break;
      }
    }

    if (foundPartial) continue;

    // Check 8: Not found anywhere in document -> REFUTED with no false page number
    unverifiedCount++;
    verifiedCitations.push({
      documentId: docId,
      documentName: docName,
      chunkId: '',
      quotedText: quote,
      verificationStatus: CitationVerificationStatus.REFUTED,
      pageNumber: null,
      locationMetadata: null,
      claim: candidate.claim,
    });
  }

  return {
    citations: verifiedCitations,
    totalCandidates: candidates.length,
    verifiedCount,
    partialCount,
    unverifiedCount,
    allVerified: unverifiedCount === 0 && partialCount === 0 && verifiedCount > 0,
  };
}
