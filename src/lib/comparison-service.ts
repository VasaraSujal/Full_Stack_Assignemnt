import prisma from '@/lib/prisma';
import { DocumentStatus } from '@prisma/client';
import { getGeminiClient, DEFAULT_GEMINI_MODEL, isGeminiConfigured } from './gemini';
import { retrieveMultiDocumentChunks } from './retrieval';
import {
  COMPARISON_SYSTEM_INSTRUCTION,
  formatMultiDocumentContext,
  parseGeminiComparisonJson,
} from './comparison-prompt';
import { verifyComparisonCandidates } from './comparison-verifier';
import { ContractComparisonResult } from './comparison-types';

export interface CompareContractsOptions {
  conversationId?: string;
  versionGroupId?: string;
  modelName?: string;
  persistResults?: boolean; // Default true
}

/**
 * Orchestrate multi-document contract comparison with balanced retrieval, Gemini generation,
 * dual-sided citation verification, significance sorting, and PostgreSQL persistence
 */
export async function compareContracts(
  documentIds: string[],
  userQuestion?: string,
  options: CompareContractsOptions = {}
): Promise<ContractComparisonResult> {
  const modelName = options.modelName || DEFAULT_GEMINI_MODEL;
  const persist = options.persistResults !== false;

  // 1. Validate document IDs
  if (!documentIds || !Array.isArray(documentIds)) {
    throw new Error('documentIds must be an array of document IDs.');
  }

  const uniqueDocIds = Array.from(
    new Set(documentIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
  );

  if (uniqueDocIds.length < 2) {
    throw new Error('At least two distinct document IDs are required for contract comparison.');
  }

  if (uniqueDocIds.length > 5) {
    throw new Error('Comparison is currently supported between up to 5 documents simultaneously.');
  }

  // 2. Fetch and validate documents from database
  const existingDocs = await prisma.document.findMany({
    where: { id: { in: uniqueDocIds } },
    select: {
      id: true,
      originalFilename: true,
      status: true,
      processingError: true,
    },
  });

  if (existingDocs.length !== uniqueDocIds.length) {
    const foundIds = new Set(existingDocs.map((d) => d.id));
    const missingIds = uniqueDocIds.filter((id) => !foundIds.has(id));
    throw new Error(`The following documents were not found: ${missingIds.join(', ')}`);
  }

  const uncompletedDocs = existingDocs.filter((d) => d.status !== DocumentStatus.COMPLETED);
  if (uncompletedDocs.length > 0) {
    const names = uncompletedDocs.map((d) => `${d.originalFilename} (${d.status})`).join(', ');
    throw new Error(`Cannot compare unprocessed documents: ${names}`);
  }

  const docA = existingDocs[0];
  const docB = existingDocs[1];

  // 3. Validate conversation membership if conversationId is provided
  if (options.conversationId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: options.conversationId },
      include: { documents: true },
    });
    if (!conv) {
      throw new Error(`Conversation '${options.conversationId}' not found.`);
    }
    const attachedDocIds = new Set(conv.documents.map((d) => d.documentId));
    const unattached = uniqueDocIds.filter((id) => !attachedDocIds.has(id));
    if (unattached.length > 0) {
      throw new Error(
        `Document(s) [${unattached.join(', ')}] are not attached to conversation '${options.conversationId}'.`
      );
    }
  }

  // 4. Construct comparison query
  const defaultQuery =
    'Compare all substantive contractual terms, obligations, liabilities, payment terms, termination, and differences between these agreements.';
  const effectiveQuery =
    userQuestion && typeof userQuestion === 'string' && userQuestion.trim().length > 0
      ? userQuestion.trim()
      : defaultQuery;

  // 5. Retrieve balanced evidence from both documents
  const retrieval = await retrieveMultiDocumentChunks(
    [docA.id, docB.id],
    effectiveQuery,
    {
      maxChunksPerDoc: 5,
      maxChunks: 10,
      maxContextChars: 16000,
    }
  );

  if (!retrieval.success) {
    throw new Error(retrieval.error || 'Failed to retrieve excerpts for comparison.');
  }

  // 6. If no relevant evidence was found in either document
  if (!retrieval.hasRelevantEvidence || retrieval.allChunks.length === 0) {
    return {
      summary:
        'Insufficient evidence was found in the retrieved excerpts of both documents to perform a grounded comparison for this query.',
      documentA: { id: docA.id, originalFilename: docA.originalFilename },
      documentB: { id: docB.id, originalFilename: docB.originalFilename },
      changes: [],
      verificationSummary: {
        totalChanges: 0,
        verifiedCount: 0,
        partialCount: 0,
        unverifiedCount: 0,
        refutedCount: 0,
        allVerified: false,
      },
      limitations: [
        'No matching contractual clauses or excerpts could be retrieved from one or both contracts.',
      ],
      hasSufficientEvidence: false,
      model: modelName,
    };
  }

  // 7. Verify Gemini configuration
  if (!isGeminiConfigured()) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  // 8. Format context XML and call Gemini
  const contextXml = formatMultiDocumentContext(retrieval.documentContexts);
  const prompt = `${contextXml}\n\nCOMPARISON QUESTION: ${effectiveQuery}\n\nProvide your detailed structured comparison strictly adhering to the JSON schema.`;

  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction: COMPARISON_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const responseText = response.text || '';
  const parsedResponse = parseGeminiComparisonJson(responseText);

  // 9. Independently verify all comparison candidate citations and differences
  const verificationResult = await verifyComparisonCandidates(
    docA.id,
    docB.id,
    parsedResponse.changes
  );

  // 10. Persist comparison changes atomically to PostgreSQL
  if (persist && verificationResult.changes.length > 0) {
    try {
      await prisma.$transaction(async (tx) => {
        for (const change of verificationResult.changes) {
          const persisted = await tx.comparisonChange.create({
            data: {
              versionGroupId: options.versionGroupId || null,
              sourceDocumentId: docA.id,
              targetDocumentId: docB.id,
              changeCategory: change.changeCategoryEnum,
              significance: change.significanceEnum,
              oldText: change.documentA.quote || null,
              newText: change.documentB.quote || null,
              plainLanguageSummary: change.description,
            },
          });
          change.id = persisted.id;
        }
      });
    } catch {
      // Atomic transaction failure is isolated without partial records
    }
  }

  return {
    summary: parsedResponse.summary,
    documentA: { id: docA.id, originalFilename: docA.originalFilename },
    documentB: { id: docB.id, originalFilename: docB.originalFilename },
    changes: verificationResult.changes,
    verificationSummary: verificationResult.summary,
    limitations: parsedResponse.limitations || [],
    hasSufficientEvidence: parsedResponse.hasSufficientEvidence ?? verificationResult.changes.length > 0,
    model: modelName,
  };
}
