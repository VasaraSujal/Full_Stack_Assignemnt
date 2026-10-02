import prisma from '@/lib/prisma';
import {
  CitationVerificationStatus,
  ChangeCategory,
  SignificanceCategory,
} from '@prisma/client';
import {
  findQuoteOffsets,
  normalizeTextForComparison,
  CitationLocationMetadata,
} from './citation-verifier';
import {
  ComparisonCategory,
  ComparisonSignificance,
  GeminiComparisonChangeCandidate,
  VerifiedComparisonChange,
  VerifiedDocumentQuoteEvidence,
  ComparisonVerificationSummary,
} from './comparison-types';

const VALID_CATEGORIES = new Set<ComparisonCategory>([
  'PAYMENT',
  'TERM',
  'TERMINATION',
  'LIABILITY',
  'INDEMNIFICATION',
  'CONFIDENTIALITY',
  'INTELLECTUAL_PROPERTY',
  'OBLIGATIONS',
  'WARRANTIES',
  'GOVERNING_LAW',
  'DISPUTE_RESOLUTION',
  'DATA_PROTECTION',
  'NOTICE',
  'OTHER',
]);

/**
 * Normalize and validate legal comparison category
 */
export function normalizeComparisonCategory(categoryRaw?: string): ComparisonCategory {
  if (!categoryRaw || typeof categoryRaw !== 'string') return 'OTHER';
  const clean = categoryRaw.toUpperCase().trim().replace(/[\s-]+/g, '_') as ComparisonCategory;
  if (VALID_CATEGORIES.has(clean)) {
    return clean;
  }
  return 'OTHER';
}

/**
 * Map comparison category to Prisma ChangeCategory enum
 */
export function mapToChangeCategoryEnum(category: ComparisonCategory): ChangeCategory {
  switch (category) {
    case 'PAYMENT':
    case 'TERM':
      return ChangeCategory.TERM_CHANGED;
    case 'LIABILITY':
    case 'INDEMNIFICATION':
    case 'WARRANTIES':
      return ChangeCategory.RISK_ALTERATION;
    case 'TERMINATION':
    case 'CONFIDENTIALITY':
    case 'INTELLECTUAL_PROPERTY':
    case 'GOVERNING_LAW':
    case 'DISPUTE_RESOLUTION':
    case 'DATA_PROTECTION':
    case 'NOTICE':
    case 'OBLIGATIONS':
      return ChangeCategory.CLAUSE_MODIFIED;
    default:
      return ChangeCategory.MODIFICATION;
  }
}

/**
 * Normalize and validate significance
 */
export function normalizeSignificance(significanceRaw?: string): ComparisonSignificance {
  if (!significanceRaw || typeof significanceRaw !== 'string') return 'MEDIUM';
  const clean = significanceRaw.toUpperCase().trim();
  if (clean === 'HIGH' || clean === 'CRITICAL') return 'HIGH';
  if (clean === 'LOW') return 'LOW';
  return 'MEDIUM';
}

/**
 * Map to Prisma SignificanceCategory enum
 */
export function mapToSignificanceCategoryEnum(
  significance: ComparisonSignificance
): SignificanceCategory {
  switch (significance) {
    case 'HIGH':
      return SignificanceCategory.HIGH;
    case 'LOW':
      return SignificanceCategory.LOW;
    case 'MEDIUM':
    default:
      return SignificanceCategory.MEDIUM;
  }
}

/**
 * Deterministic significance sorting weight
 */
const SIGNIFICANCE_WEIGHT: Record<ComparisonSignificance, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * Sort verified comparison changes deterministically by significance, category, and page order
 */
export function sortComparisonChanges(
  changes: VerifiedComparisonChange[]
): VerifiedComparisonChange[] {
  return [...changes].sort((a, b) => {
    // 1. Sort by significance descending (HIGH > MEDIUM > LOW)
    const weightDiff = SIGNIFICANCE_WEIGHT[b.significance] - SIGNIFICANCE_WEIGHT[a.significance];
    if (weightDiff !== 0) return weightDiff;

    // 2. Sort by verification status (VERIFIED first, then PARTIAL, then UNVERIFIED, then REFUTED)
    const statusWeight: Record<CitationVerificationStatus, number> = {
      VERIFIED: 4,
      PARTIAL: 3,
      UNVERIFIED: 2,
      REFUTED: 1,
    };
    const statusDiff = statusWeight[b.verificationStatus] - statusWeight[a.verificationStatus];
    if (statusDiff !== 0) return statusDiff;

    // 3. Sort by category alphabetically
    const catDiff = a.category.localeCompare(b.category);
    if (catDiff !== 0) return catDiff;

    // 4. Sort by Document A page number
    const pageA_1 = a.documentA.pageNumber || 9999;
    const pageA_2 = b.documentA.pageNumber || 9999;
    if (pageA_1 !== pageA_2) return pageA_1 - pageA_2;

    // 5. Sort by Document A offset
    const offsetA_1 = a.documentA.locationMetadata?.chunkOffsets.start || 0;
    const offsetA_2 = b.documentA.locationMetadata?.chunkOffsets.start || 0;
    if (offsetA_1 !== offsetA_2) return offsetA_1 - offsetA_2;

    // 6. Stable fallback
    return a.description.localeCompare(b.description);
  });
}

/**
 * Verify a single side's quotation against authoritative stored chunks and pages
 */
export async function verifyDocumentQuote(
  documentId: string,
  quote: string,
  expectedDocId?: string
): Promise<VerifiedDocumentQuoteEvidence> {
  const cleanQuote = quote ? quote.trim() : '';

  if (!cleanQuote || cleanQuote.length < 3) {
    return {
      documentId,
      quote: cleanQuote,
      pageNumber: null,
      verificationStatus: CitationVerificationStatus.UNVERIFIED,
      locationMetadata: null,
    };
  }

  // Validate document ID match if expected
  if (expectedDocId && documentId !== expectedDocId) {
    return {
      documentId,
      quote: cleanQuote,
      pageNumber: null,
      verificationStatus: CitationVerificationStatus.UNVERIFIED,
      locationMetadata: null,
    };
  }

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      originalFilename: true,
      chunks: {
        select: {
          id: true,
          chunkIndex: true,
          chunkText: true,
          pageNumber: true,
          metadata: true,
        },
        orderBy: { chunkIndex: 'asc' },
      },
      pages: {
        select: {
          id: true,
          pageNumber: true,
          extractedText: true,
        },
        orderBy: { pageNumber: 'asc' },
      },
    },
  });

  if (!doc) {
    return {
      documentId,
      quote: cleanQuote,
      pageNumber: null,
      verificationStatus: CitationVerificationStatus.UNVERIFIED,
      locationMetadata: null,
    };
  }

  // 1. Search across document chunks
  for (const chunk of doc.chunks) {
    const match = findQuoteOffsets(chunk.chunkText, cleanQuote);
    if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
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
        quoteLength: cleanQuote.length,
        matchType: match.matchType,
        isMultiPage: false,
        confidenceScore: match.confidence,
        occurrencesInChunk: match.occurrences.length,
      };

      return {
        documentId: doc.id,
        documentName: doc.originalFilename,
        quote: cleanQuote,
        pageNumber: chunk.pageNumber,
        verificationStatus: CitationVerificationStatus.VERIFIED,
        locationMetadata,
      };
    }
  }

  // 2. Search across full document pages (single page)
  for (const page of doc.pages) {
    const match = findQuoteOffsets(page.extractedText, cleanQuote);
    if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
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
        quoteLength: cleanQuote.length,
        matchType: match.matchType,
        isMultiPage: false,
        confidenceScore: match.confidence,
        occurrencesInChunk: match.occurrences.length,
      };

      return {
        documentId: doc.id,
        documentName: doc.originalFilename,
        quote: cleanQuote,
        pageNumber: page.pageNumber,
        verificationStatus: CitationVerificationStatus.VERIFIED,
        locationMetadata,
      };
    }
  }

  // 3. Search across consecutive page boundaries (multi-page quotes)
  for (let i = 0; i < doc.pages.length - 1; i++) {
    const page1 = doc.pages[i];
    const page2 = doc.pages[i + 1];
    const combinedPagesText = `${page1.extractedText}\n\n${page2.extractedText}`;
    const match = findQuoteOffsets(combinedPagesText, cleanQuote);

    if (match.found && (match.matchType === 'exact' || match.matchType === 'normalized')) {
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
        pageNumber: page1.pageNumber,
        startPage: page1.pageNumber,
        endPage: page2.pageNumber,
        quoteLength: cleanQuote.length,
        matchType: match.matchType,
        isMultiPage: true, // Accurately flagged as multi-page
        confidenceScore: match.confidence,
        occurrencesInChunk: match.occurrences.length,
      };

      return {
        documentId: doc.id,
        documentName: doc.originalFilename,
        quote: cleanQuote,
        pageNumber: page1.pageNumber,
        verificationStatus: CitationVerificationStatus.VERIFIED,
        locationMetadata,
      };
    }
  }

  // 4. Check for partial word overlap
  for (const chunk of doc.chunks) {
    const match = findQuoteOffsets(chunk.chunkText, cleanQuote);
    if (match.matchType === 'partial') {
      const locationMetadata: CitationLocationMetadata = {
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        chunkOffsets: { start: -1, end: -1 },
        pageNumber: chunk.pageNumber,
        quoteLength: cleanQuote.length,
        matchType: 'partial',
        isMultiPage: false,
        confidenceScore: match.confidence,
        occurrencesInChunk: 0,
      };

      return {
        documentId: doc.id,
        documentName: doc.originalFilename,
        quote: cleanQuote,
        pageNumber: chunk.pageNumber,
        verificationStatus: CitationVerificationStatus.PARTIAL,
        locationMetadata,
      };
    }
  }

  // 5. Quote is refuted (not found in document)
  return {
    documentId: doc.id,
    documentName: doc.originalFilename,
    quote: cleanQuote,
    pageNumber: null,
    verificationStatus: CitationVerificationStatus.REFUTED,
    locationMetadata: null,
  };
}

/**
 * Verify full list of candidate comparison changes against authoritative database documents
 */
export async function verifyComparisonCandidates(
  docA_Id: string,
  docB_Id: string,
  candidates: GeminiComparisonChangeCandidate[]
): Promise<{
  changes: VerifiedComparisonChange[];
  summary: ComparisonVerificationSummary;
}> {
  if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
    return {
      changes: [],
      summary: {
        totalChanges: 0,
        verifiedCount: 0,
        partialCount: 0,
        unverifiedCount: 0,
        refutedCount: 0,
        allVerified: false,
      },
    };
  }

  const verifiedChanges: VerifiedComparisonChange[] = [];
  let verifiedCount = 0;
  let partialCount = 0;
  let unverifiedCount = 0;
  let refutedCount = 0;

  for (const candidate of candidates) {
    const category = normalizeComparisonCategory(candidate.category);
    const significance = normalizeSignificance(candidate.significance);
    let description = candidate.description || 'Contractual difference identified.';

    // Verify both sides independently
    const evidenceA = await verifyDocumentQuote(
      candidate.documentA?.documentId || docA_Id,
      candidate.documentA?.quote || '',
      docA_Id
    );

    const evidenceB = await verifyDocumentQuote(
      candidate.documentB?.documentId || docB_Id,
      candidate.documentB?.quote || '',
      docB_Id
    );

    // Evaluate overall change verification status
    let changeStatus: CitationVerificationStatus;

    if (
      evidenceA.verificationStatus === CitationVerificationStatus.REFUTED ||
      evidenceB.verificationStatus === CitationVerificationStatus.REFUTED
    ) {
      // Fabricated or contradicted quotation
      changeStatus = CitationVerificationStatus.REFUTED;
      refutedCount++;
    } else if (
      evidenceA.verificationStatus === CitationVerificationStatus.VERIFIED &&
      evidenceB.verificationStatus === CitationVerificationStatus.VERIFIED
    ) {
      // Both quotes verified in source text. Check for semantic and identical quote defects:
      const normA = normalizeTextForComparison(evidenceA.quote);
      const normB = normalizeTextForComparison(evidenceB.quote);

      if (normA.length > 0 && normA === normB) {
        // Both quotes are identical — this is NOT a material textual difference!
        changeStatus = CitationVerificationStatus.PARTIAL;
        description = `${description} (Note: Quoted passages are textually identical in both contracts).`;
        partialCount++;
      } else {
        // Check for topical connection (prevent comparing completely unrelated clauses)
        const extractWords = (s: string) =>
          s
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 3);

        const wordsA = new Set(extractWords(evidenceA.quote));
        const wordsB = extractWords(evidenceB.quote);
        const sharedWords = wordsB.filter((w) => wordsA.has(w));
        const descWords = extractWords(description);
        const descOverlapA = descWords.filter((w) => wordsA.has(w));
        const descOverlapB = descWords.filter((w) => wordsB.includes(w));

        // If neither quotes share any keywords nor does description match both quotes
        if (sharedWords.length === 0 && (descOverlapA.length === 0 || descOverlapB.length === 0)) {
          changeStatus = CitationVerificationStatus.PARTIAL;
          description = `${description} (Note: Quoted clauses address unrelated subjects).`;
          partialCount++;
        } else {
          changeStatus = CitationVerificationStatus.VERIFIED;
          verifiedCount++;
        }
      }
    } else if (
      (evidenceA.verificationStatus === CitationVerificationStatus.VERIFIED ||
        evidenceA.verificationStatus === CitationVerificationStatus.PARTIAL) &&
      (evidenceB.verificationStatus === CitationVerificationStatus.VERIFIED ||
        evidenceB.verificationStatus === CitationVerificationStatus.PARTIAL)
    ) {
      changeStatus = CitationVerificationStatus.PARTIAL;
      partialCount++;
    } else {
      changeStatus = CitationVerificationStatus.UNVERIFIED;
      unverifiedCount++;
    }

    const confidence =
      typeof candidate.confidence === 'number' && candidate.confidence >= 0 && candidate.confidence <= 1
        ? candidate.confidence
        : changeStatus === CitationVerificationStatus.VERIFIED
        ? 0.95
        : changeStatus === CitationVerificationStatus.PARTIAL
        ? 0.6
        : 0.1;

    verifiedChanges.push({
      category,
      changeCategoryEnum: mapToChangeCategoryEnum(category),
      description,
      significance,
      significanceEnum: mapToSignificanceCategoryEnum(significance),
      verificationStatus: changeStatus,
      documentA: evidenceA,
      documentB: evidenceB,
      confidence,
    });
  }

  // Sort changes by significance (HIGH -> MEDIUM -> LOW) and deterministic page coordinates
  const sortedChanges = sortComparisonChanges(verifiedChanges);

  return {
    changes: sortedChanges,
    summary: {
      totalChanges: candidates.length,
      verifiedCount,
      partialCount,
      unverifiedCount,
      refutedCount,
      allVerified: unverifiedCount === 0 && partialCount === 0 && refutedCount === 0 && verifiedCount > 0,
    },
  };
}

