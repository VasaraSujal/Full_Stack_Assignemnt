import prisma from '@/lib/prisma';
import { FunctionDeclaration } from '@google/genai';
import { scoreChunk, extractSearchTerms } from './retrieval';

export interface PermittedDocumentScope {
  documentIds: string[];
  docMap: Map<string, string>; // documentId -> originalFilename
}

export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  data: Record<string, unknown>;
  summary: string;
  itemsFound: number;
  error?: string;
  durationMs: number;
}

// 1. Tool Declaration: search_document
export const searchDocumentDeclaration: FunctionDeclaration = {
  name: 'search_document',
  description:
    'Search the permitted contract document(s) for relevant passages matching a query and optional section hint.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query or keyword phrase to find in the contract.',
      },
      documentId: {
        type: 'string',
        description: 'Optional specific document ID to search within. Must be from permitted documents.',
      },
      sectionHint: {
        type: 'string',
        description: 'Optional section topic or clause hint, e.g. "termination", "indemnification", "payment".',
      },
    },
    required: ['query'],
  },
};

// 2. Tool Declaration: get_section
export const getSectionDeclaration: FunctionDeclaration = {
  name: 'get_section',
  description:
    'Retrieve a specific section, clause heading, or page range from a contract document for detailed inspection.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string',
        description: 'The required document ID to inspect.',
      },
      sectionHint: {
        type: 'string',
        description: 'The section heading or descriptive title to locate, e.g. "Section 8: Limitation of Liability" or "Term and Termination".',
      },
      startPage: {
        type: 'integer',
        description: 'Optional starting page number (positive integer, 1-indexed).',
      },
      endPage: {
        type: 'integer',
        description: 'Optional ending page number (positive integer, 1-indexed).',
      },
    },
    required: ['documentId', 'sectionHint'],
  },
};

// 3. Tool Declaration: list_clauses
export const listClausesDeclaration: FunctionDeclaration = {
  name: 'list_clauses',
  description:
    'Discover and list likely contract clauses, headings, and section titles in a document to guide further targeted research.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      documentId: {
        type: 'string',
        description: 'The required document ID to inspect for clauses.',
      },
      topic: {
        type: 'string',
        description: 'Optional topic to filter clause headings, e.g. "termination", "payment", "confidentiality", "liability".',
      },
    },
    required: ['documentId'],
  },
};

export const AGENTIC_RESEARCH_TOOLS = [
  {
    functionDeclarations: [
      searchDocumentDeclaration,
      getSectionDeclaration,
      listClausesDeclaration,
    ],
  },
];

/**
 * Execute search_document tool
 */
export async function executeSearchDocument(
  scope: PermittedDocumentScope,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : undefined;
  const sectionHint = typeof args.sectionHint === 'string' ? args.sectionHint.trim() : undefined;

  if (!query || query.length === 0) {
    return {
      success: false,
      toolName: 'search_document',
      data: {},
      summary: 'Query parameter is required and cannot be empty.',
      itemsFound: 0,
      error: 'Query parameter is required and cannot be empty.',
      durationMs: Date.now() - startTime,
    };
  }

  if (query.length > 300) {
    return {
      success: false,
      toolName: 'search_document',
      data: {},
      summary: 'Query is too long (maximum 300 characters).',
      itemsFound: 0,
      error: 'Query is too long (maximum 300 characters).',
      durationMs: Date.now() - startTime,
    };
  }

  // Validate target document scope
  let targetDocIds: string[] = [];
  if (documentId) {
    if (!scope.docMap.has(documentId)) {
      return {
        success: false,
        toolName: 'search_document',
        data: {},
        summary: `Document ID '${documentId}' is not in the permitted document scope.`,
        itemsFound: 0,
        error: `Document ID '${documentId}' is not in the permitted document scope.`,
        durationMs: Date.now() - startTime,
      };
    }
    targetDocIds = [documentId];
  } else {
    targetDocIds = scope.documentIds;
  }

  const effectiveQuery = sectionHint ? `${sectionHint} ${query}` : query;
  const { terms, phrases } = extractSearchTerms(effectiveQuery);

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: { in: targetDocIds } },
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

  const scoredChunks: Array<{
    chunkId: string;
    documentId: string;
    documentName: string;
    pageNumber: number | null;
    text: string;
    score: number;
  }> = [];

  for (const c of chunks) {
    const score = scoreChunk(c.chunkText, terms, phrases, effectiveQuery);
    if (score >= 0.5) {
      scoredChunks.push({
        chunkId: c.id,
        documentId: c.documentId,
        documentName: scope.docMap.get(c.documentId) || 'Document',
        pageNumber: c.pageNumber,
        text: c.chunkText,
        score,
      });
    }
  }

  scoredChunks.sort((a, b) => b.score - a.score);
  const topPassages = scoredChunks.slice(0, 4);

  const isExhaustive = false;
  const coverageLimitation =
    topPassages.length > 0
      ? 'Lexical search retrieved top candidate passages based on keyword matching. Negative findings do not prove absence from unretrieved portions.'
      : 'Lexical search yielded 0 matching passages for the specified terms. This indicates lack of keyword match in the indexed chunks, but does not guarantee the clause or term is absent from the entire contract.';

  return {
    success: true,
    toolName: 'search_document',
    data: {
      query,
      sectionHint: sectionHint || null,
      passages: topPassages.map((p) => ({
        chunkId: p.chunkId,
        documentId: p.documentId,
        documentName: p.documentName,
        pageNumber: p.pageNumber,
        content: p.text,
      })),
      totalMatches: scoredChunks.length,
      isExhaustive,
      coverageLimitation,
    },
    summary:
      topPassages.length > 0
        ? `Found ${topPassages.length} relevant excerpt(s) for query "${query}".`
        : `No matching excerpts found for query "${query}". Note: lexical search absence does not prove clause non-existence.`,
    itemsFound: topPassages.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Execute get_section tool
 */
export async function executeGetSection(
  scope: PermittedDocumentScope,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
  const sectionHint = typeof args.sectionHint === 'string' ? args.sectionHint.trim() : '';
  const startPage = typeof args.startPage === 'number' && args.startPage > 0 ? Math.floor(args.startPage) : undefined;
  const endPage = typeof args.endPage === 'number' && args.endPage > 0 ? Math.floor(args.endPage) : undefined;

  if (!documentId || !scope.docMap.has(documentId)) {
    return {
      success: false,
      toolName: 'get_section',
      data: {},
      summary: `Invalid or out-of-scope documentId: '${documentId}'.`,
      itemsFound: 0,
      error: `Invalid or out-of-scope documentId: '${documentId}'.`,
      durationMs: Date.now() - startTime,
    };
  }

  if (!sectionHint || sectionHint.length === 0) {
    return {
      success: false,
      toolName: 'get_section',
      data: {},
      summary: 'Field "sectionHint" is required.',
      itemsFound: 0,
      error: 'Field "sectionHint" is required.',
      durationMs: Date.now() - startTime,
    };
  }

  if (startPage !== undefined && endPage !== undefined && startPage > endPage) {
    return {
      success: false,
      toolName: 'get_section',
      data: {},
      summary: `Invalid page range: startPage (${startPage}) cannot be greater than endPage (${endPage}).`,
      itemsFound: 0,
      error: `Invalid page range: startPage (${startPage}) cannot be greater than endPage (${endPage}).`,
      durationMs: Date.now() - startTime,
    };
  }

  // Bound page range to max 3 pages per call
  const effectiveEndPage =
    startPage !== undefined && endPage !== undefined
      ? Math.min(endPage, startPage + 2)
      : endPage;

  const pageWhere: Record<string, unknown> = { documentId };
  if (startPage !== undefined && effectiveEndPage !== undefined) {
    pageWhere.pageNumber = { gte: startPage, lte: effectiveEndPage };
  } else if (startPage !== undefined) {
    pageWhere.pageNumber = startPage;
  }

  const pages = await prisma.documentPage.findMany({
    where: pageWhere,
    select: {
      id: true,
      pageNumber: true,
      extractedText: true,
    },
    orderBy: { pageNumber: 'asc' },
    take: 3,
  });

  if (pages.length === 0) {
    return {
      success: true,
      toolName: 'get_section',
      data: {
        documentId,
        documentName: scope.docMap.get(documentId),
        sectionHint,
        found: false,
        sections: [],
        isExhaustive: false,
        coverageLimitation: `No pages found in requested range for document '${scope.docMap.get(documentId)}'. Clause may reside on other pages.`,
      },
      summary: `No pages found matching requested page range for document '${scope.docMap.get(documentId)}'.`,
      itemsFound: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Search for section heading or relevant passage across extracted pages
  const lowerHint = sectionHint.toLowerCase();
  const matchingSections: Array<{
    pageNumber: number;
    matchedText: string;
  }> = [];

  for (const page of pages) {
    const text = page.extractedText;
    const lowerText = text.toLowerCase();
    const hintIdx = lowerText.indexOf(lowerHint);

    if (hintIdx !== -1) {
      // Extract window around the section heading (up to 1,500 chars)
      const windowStart = Math.max(0, hintIdx - 50);
      const windowEnd = Math.min(text.length, hintIdx + 1500);
      matchingSections.push({
        pageNumber: page.pageNumber,
        matchedText: text.slice(windowStart, windowEnd),
      });
    } else {
      // Check if page contains keywords of the section hint
      const keywords = lowerHint.split(/\s+/).filter((w) => w.length > 3);
      const keywordMatches = keywords.filter((k) => lowerText.includes(k));
      if (keywordMatches.length >= Math.min(2, keywords.length) && keywords.length > 0) {
        matchingSections.push({
          pageNumber: page.pageNumber,
          matchedText: text.slice(0, 1500),
        });
      }
    }
  }

  const foundDirect = matchingSections.length > 0;
  if (!foundDirect) {
    // If no direct heading found, return the first requested page text (bounded)
    matchingSections.push({
      pageNumber: pages[0].pageNumber,
      matchedText: pages[0].extractedText.slice(0, 1500),
    });
  }

  return {
    success: true,
    toolName: 'get_section',
    data: {
      documentId,
      documentName: scope.docMap.get(documentId),
      sectionHint,
      found: foundDirect,
      sections: matchingSections,
      isExhaustive: false,
      coverageLimitation: foundDirect
        ? 'Inspection is bounded to the specified pages and heading vicinity (max 1,500 characters).'
        : `Section heading "${sectionHint}" was not found directly on inspected pages (${pages.map((p) => p.pageNumber).join(', ')}). First page text returned as context.`,
    },
    summary: `Retrieved section text from page ${matchingSections.map((s) => s.pageNumber).join(', ')} of ${scope.docMap.get(documentId)}.`,
    itemsFound: matchingSections.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Execute list_clauses tool
 */
export async function executeListClauses(
  scope: PermittedDocumentScope,
  args: Record<string, unknown>
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
  const topic = typeof args.topic === 'string' ? args.topic.trim().toLowerCase() : undefined;

  if (!documentId || !scope.docMap.has(documentId)) {
    return {
      success: false,
      toolName: 'list_clauses',
      data: {},
      summary: `Invalid or out-of-scope documentId: '${documentId}'.`,
      itemsFound: 0,
      error: `Invalid or out-of-scope documentId: '${documentId}'.`,
      durationMs: Date.now() - startTime,
    };
  }

  const totalPagesCount = await prisma.documentPage.count({
    where: { documentId },
  });

  const pages = await prisma.documentPage.findMany({
    where: { documentId },
    select: {
      pageNumber: true,
      extractedText: true,
    },
    orderBy: { pageNumber: 'asc' },
    take: 10, // Bound page scan
  });

  const detectedClauses: Array<{
    heading: string;
    pageNumber: number;
    snippet: string;
  }> = [];

  const clauseHeadingRegex =
    /^(?:(?:Article|Section|Clause)\s+\d+(?:\.\d+)*[:\.\-\s]+[^\n]+|(?:[A-Z\s]{4,40}:))/im;

  for (const page of pages) {
    const lines = page.extractedText.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length > 3 && line.length < 120) {
        if (clauseHeadingRegex.test(line) || /^(?:\d+\.|\([a-z]\))\s+[A-Z]/.test(line)) {
          // If topic filter provided, check if heading matches topic
          if (!topic || line.toLowerCase().includes(topic)) {
            const nextSnippet = lines.slice(i, i + 3).join(' ').trim();
            detectedClauses.push({
              heading: line,
              pageNumber: page.pageNumber,
              snippet: nextSnippet.slice(0, 200),
            });
          }
        }
      }
    }
  }

  const boundedClauses = detectedClauses.slice(0, 8);
  const isExhaustive = totalPagesCount <= 10;
  const coverageLimitation = isExhaustive
    ? `All ${totalPagesCount} pages of '${scope.docMap.get(documentId)}' were inspected for clause headings.`
    : `Clause discovery was limited to the first 10 of ${totalPagesCount} total pages. Subsequent pages may contain additional unlisted clauses.`;

  return {
    success: true,
    toolName: 'list_clauses',
    data: {
      documentId,
      documentName: scope.docMap.get(documentId),
      topicFilter: topic || null,
      detectedClauses: boundedClauses,
      totalDetected: detectedClauses.length,
      totalPages: totalPagesCount,
      pagesScanned: pages.length,
      isExhaustive,
      coverageLimitation,
      note: 'Clause headings are structural document markers, not formal legal interpretations.',
    },
    summary:
      boundedClauses.length > 0
        ? `Identified ${boundedClauses.length} clause heading(s) in '${scope.docMap.get(documentId)}' (${isExhaustive ? 'exhaustive' : 'first 10 pages'}).`
        : `No clause headings matching topic "${topic || 'all'}" found in inspected pages of '${scope.docMap.get(documentId)}'. Note: uninspected pages may contain relevant clauses.`,
    itemsFound: boundedClauses.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Dispatch and execute any agentic tool by name with strict validation
 */
export async function dispatchAgenticTool(
  toolName: string,
  args: Record<string, unknown>,
  scope: PermittedDocumentScope
): Promise<ToolExecutionResult> {
  const startTime = Date.now();

  switch (toolName) {
    case 'search_document':
      return executeSearchDocument(scope, args);
    case 'get_section':
      return executeGetSection(scope, args);
    case 'list_clauses':
      return executeListClauses(scope, args);
    default:
      return {
        success: false,
        toolName,
        data: {},
        summary: `Unknown tool '${toolName}'. Supported tools: search_document, get_section, list_clauses.`,
        itemsFound: 0,
        error: `Unknown tool '${toolName}'. Supported tools: search_document, get_section, list_clauses.`,
        durationMs: Date.now() - startTime,
      };
  }
}
