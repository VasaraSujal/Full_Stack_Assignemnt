import prisma from '@/lib/prisma';
import { DocumentStatus } from '@prisma/client';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  chunkIndex: number;
  chunkText: string;
  score: number;
  metadata: Record<string, unknown> | null;
  startOffset?: number;
  endOffset?: number;
}

export interface RetrievedDocumentContext {
  documentId: string;
  documentName: string;
  chunks: RetrievedChunk[];
}

export interface RetrievalOptions {
  maxChunks?: number; // Default 6 (or total across docs)
  maxChunksPerDoc?: number; // Default 4 for multi-doc
  maxContextChars?: number; // Default 12,000 characters (~3,000 tokens)
  minScoreThreshold?: number; // Default 0.5
}

export interface RetrievalResult {
  success: boolean;
  chunks: RetrievedChunk[];
  attachedDocumentIds: string[];
  totalAttachedDocuments: number;
  totalExaminedChunks: number;
  hasRelevantEvidence: boolean;
  error?: string;
}

export interface MultiDocumentRetrievalResult {
  success: boolean;
  documentContexts: RetrievedDocumentContext[];
  allChunks: RetrievedChunk[];
  queriedDocumentIds: string[];
  totalExaminedChunks: number;
  hasRelevantEvidence: boolean;
  error?: string;
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'what', 'which', 'who', 'when',
  'where', 'why', 'how', 'does', 'did', 'do', 'can', 'could', 'should',
  'would', 'tell', 'me', 'about', 'explain', 'show', 'give'
]);

/**
 * Extract normalized keywords and phrases from user question
 */
export function extractSearchTerms(query: string): { terms: string[]; phrases: string[] } {
  if (!query || typeof query !== 'string') {
    return { terms: [], phrases: [] };
  }

  const cleanQuery = query.toLowerCase().trim();

  // Extract quoted exact phrases
  const phraseMatches = cleanQuery.match(/"([^"]+)"/g) || [];
  const phrases = phraseMatches.map((p) => p.replace(/"/g, '').trim()).filter((p) => p.length > 2);

  // Extract individual words
  const words = cleanQuery
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  return {
    terms: Array.from(new Set(words)),
    phrases,
  };
}

/**
 * Score a document chunk based on search terms, exact phrases, and position
 */
export function scoreChunk(
  chunkText: string,
  terms: string[],
  phrases: string[],
  rawQuery: string
): number {
  if (!chunkText || typeof chunkText !== 'string') return 0;
  const lowerText = chunkText.toLowerCase();
  let score = 0;

  // 1. Exact query match (high boost)
  const cleanRawQuery = rawQuery.toLowerCase().trim();
  if (cleanRawQuery.length > 5 && lowerText.includes(cleanRawQuery)) {
    score += 25;
  }

  // 2. Exact phrase matches (quotes)
  for (const phrase of phrases) {
    if (lowerText.includes(phrase)) {
      score += 15;
    }
  }

  // 3. Keyword matches with term frequency
  for (const term of terms) {
    if (term.length < 2) continue;
    // Word boundary match
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    const matches = lowerText.match(regex);
    if (matches && matches.length > 0) {
      // Frequency score with diminishing returns (logarithmic)
      score += Math.min(matches.length, 5) * 3;
    } else if (lowerText.includes(term)) {
      score += 1.5;
    }
  }

  return score;
}

/**
 * Retrieve balanced candidate chunks independently per document for a list of document IDs
 */
export async function retrieveMultiDocumentChunks(
  documentIds: string[],
  query: string,
  options: RetrievalOptions = {}
): Promise<MultiDocumentRetrievalResult> {
  const maxChunksPerDoc = options.maxChunksPerDoc || 4;
  const maxTotalChunks = options.maxChunks || 10;
  const maxContextChars = options.maxContextChars || 16000;
  const minScoreThreshold = options.minScoreThreshold || 0.5;

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      documentContexts: [],
      allChunks: [],
      queriedDocumentIds: documentIds,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'Question cannot be empty.',
    };
  }

  if (query.length > 2000) {
    return {
      success: false,
      documentContexts: [],
      allChunks: [],
      queriedDocumentIds: documentIds,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'Question is too long (maximum 2,000 characters).',
    };
  }

  const uniqueDocIds = Array.from(new Set(documentIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));

  if (uniqueDocIds.length === 0) {
    return {
      success: false,
      documentContexts: [],
      allChunks: [],
      queriedDocumentIds: [],
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'No document IDs provided.',
    };
  }

  // Fetch only COMPLETED documents from the provided list
  const existingDocs = await prisma.document.findMany({
    where: {
      id: { in: uniqueDocIds },
      status: DocumentStatus.COMPLETED,
    },
    select: {
      id: true,
      originalFilename: true,
    },
  });

  if (existingDocs.length === 0) {
    return {
      success: true,
      documentContexts: [],
      allChunks: [],
      queriedDocumentIds: uniqueDocIds,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'No processed documents found for the requested IDs.',
    };
  }

  const docMap = new Map(existingDocs.map((d) => [d.id, d.originalFilename]));
  const { terms, phrases } = extractSearchTerms(query);

  const documentContexts: RetrievedDocumentContext[] = [];
  const allSelectedChunks: RetrievedChunk[] = [];
  let totalExaminedChunks = 0;
  let runningCharCount = 0;

  // Retrieve and score independently for each document
  for (const doc of existingDocs) {
    const docChunks = await prisma.documentChunk.findMany({
      where: { documentId: doc.id },
      select: {
        id: true,
        documentId: true,
        chunkIndex: true,
        chunkText: true,
        pageNumber: true,
        metadata: true,
      },
      orderBy: { chunkIndex: 'asc' },
    });

    totalExaminedChunks += docChunks.length;

    const scoredDocChunks: RetrievedChunk[] = [];
    for (const chunk of docChunks) {
      const score = scoreChunk(chunk.chunkText, terms, phrases, query);
      if (score >= minScoreThreshold) {
        const meta = (chunk.metadata as Record<string, unknown>) || null;
        scoredDocChunks.push({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: doc.originalFilename,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          chunkText: chunk.chunkText,
          score,
          metadata: meta,
          startOffset: typeof meta?.startOffset === 'number' ? meta.startOffset : undefined,
          endOffset: typeof meta?.endOffset === 'number' ? meta.endOffset : undefined,
        });
      }
    }

    // Sort descending by score for this document
    scoredDocChunks.sort((a, b) => b.score - a.score);

    // Select up to maxChunksPerDoc for this document
    const selectedForDoc = scoredDocChunks.slice(0, maxChunksPerDoc);

    documentContexts.push({
      documentId: doc.id,
      documentName: doc.originalFilename,
      chunks: selectedForDoc,
    });

    for (const c of selectedForDoc) {
      if (allSelectedChunks.length < maxTotalChunks && runningCharCount + c.chunkText.length <= maxContextChars) {
        allSelectedChunks.push(c);
        runningCharCount += c.chunkText.length;
      }
    }
  }

  return {
    success: true,
    documentContexts,
    allChunks: allSelectedChunks,
    queriedDocumentIds: Array.from(docMap.keys()),
    totalExaminedChunks,
    hasRelevantEvidence: allSelectedChunks.length > 0,
  };
}

/**
 * Retrieve ranked chunks for a conversation from attached completed documents
 * Supports both single-document and balanced multi-document conversations
 */
export async function retrieveRelevantChunks(
  conversationId: string,
  query: string,
  options: RetrievalOptions = {}
): Promise<RetrievalResult> {
  const maxChunks = options.maxChunks || 6;
  const maxContextChars = options.maxContextChars || 12000;
  const minScoreThreshold = options.minScoreThreshold || 0.5;

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      chunks: [],
      attachedDocumentIds: [],
      totalAttachedDocuments: 0,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'Question cannot be empty.',
    };
  }

  if (query.length > 2000) {
    return {
      success: false,
      chunks: [],
      attachedDocumentIds: [],
      totalAttachedDocuments: 0,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'Question is too long (maximum 2,000 characters).',
    };
  }

  // 1. Verify conversation exists and get attached completed documents
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      documents: {
        include: {
          document: {
            select: {
              id: true,
              originalFilename: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!conversation) {
    return {
      success: false,
      chunks: [],
      attachedDocumentIds: [],
      totalAttachedDocuments: 0,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: `Conversation with ID '${conversationId}' not found.`,
    };
  }

  const completedDocs = conversation.documents
    .map((cd) => cd.document)
    .filter((doc) => doc.status === DocumentStatus.COMPLETED);

  if (completedDocs.length === 0) {
    return {
      success: true,
      chunks: [],
      attachedDocumentIds: [],
      totalAttachedDocuments: conversation.documents.length,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
      error: 'No processed documents are attached to this conversation.',
    };
  }

  const docMap = new Map(completedDocs.map((d) => [d.id, d.originalFilename]));
  const documentIds = Array.from(docMap.keys());

  // If multiple documents are attached, use balanced multi-document retrieval
  if (documentIds.length > 1) {
    const multiResult = await retrieveMultiDocumentChunks(documentIds, query, {
      maxChunks,
      maxChunksPerDoc: Math.max(2, Math.floor(maxChunks / documentIds.length)),
      maxContextChars,
      minScoreThreshold,
    });

    return {
      success: multiResult.success,
      chunks: multiResult.allChunks,
      attachedDocumentIds: documentIds,
      totalAttachedDocuments: documentIds.length,
      totalExaminedChunks: multiResult.totalExaminedChunks,
      hasRelevantEvidence: multiResult.hasRelevantEvidence,
      error: multiResult.error,
    };
  }

  // Single document path
  const allChunks = await prisma.documentChunk.findMany({
    where: {
      documentId: { in: documentIds },
    },
    select: {
      id: true,
      documentId: true,
      chunkIndex: true,
      chunkText: true,
      pageNumber: true,
      metadata: true,
    },
    orderBy: [
      { documentId: 'asc' },
      { chunkIndex: 'asc' },
    ],
  });

  if (allChunks.length === 0) {
    return {
      success: true,
      chunks: [],
      attachedDocumentIds: documentIds,
      totalAttachedDocuments: documentIds.length,
      totalExaminedChunks: 0,
      hasRelevantEvidence: false,
    };
  }

  const { terms, phrases } = extractSearchTerms(query);
  const scoredChunks: RetrievedChunk[] = [];

  for (const chunk of allChunks) {
    const score = scoreChunk(chunk.chunkText, terms, phrases, query);
    if (score >= minScoreThreshold) {
      const meta = (chunk.metadata as Record<string, unknown>) || null;
      scoredChunks.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: docMap.get(chunk.documentId) || 'Contract Document',
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        chunkText: chunk.chunkText,
        score,
        metadata: meta,
        startOffset: typeof meta?.startOffset === 'number' ? meta.startOffset : undefined,
        endOffset: typeof meta?.endOffset === 'number' ? meta.endOffset : undefined,
      });
    }
  }

  // Sort by score descending
  scoredChunks.sort((a, b) => b.score - a.score);

  // Select top chunks within character and count limits
  const selectedChunks: RetrievedChunk[] = [];
  let totalChars = 0;

  for (const chunk of scoredChunks) {
    if (selectedChunks.length >= maxChunks) break;
    if (totalChars + chunk.chunkText.length > maxContextChars && selectedChunks.length > 0) {
      break;
    }
    selectedChunks.push(chunk);
    totalChars += chunk.chunkText.length;
  }

  return {
    success: true,
    chunks: selectedChunks,
    attachedDocumentIds: documentIds,
    totalAttachedDocuments: documentIds.length,
    totalExaminedChunks: allChunks.length,
    hasRelevantEvidence: selectedChunks.length > 0,
  };
}
