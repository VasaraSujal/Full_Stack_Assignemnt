import { getGeminiClient, DEFAULT_GEMINI_MODEL, isGeminiConfigured, executeWithModelFallback, extractGeminiResponseText } from './gemini';
import { retrieveRelevantChunks } from './retrieval';
import {
  CONTRACT_QA_SYSTEM_INSTRUCTION,
  formatRetrievedContext,
  GeminiStructuredResponse,
} from './gemini-prompt';
import { verifyCitationCandidates, VerifiedCitation } from './citation-verifier';

export interface ContractAnswerResult {
  answer: string;
  citations: VerifiedCitation[];
  hasSufficientEvidence: boolean;
  retrievedChunksCount: number;
  retrievalSuccess: boolean;
  model: string;
  verificationSummary: {
    totalCandidates: number;
    verifiedCount: number;
    partialCount: number;
    unverifiedCount: number;
    allVerified: boolean;
  };
}

/**
 * Safely parse JSON response from Gemini, stripping any surrounding markdown code fences
 */
export function parseGeminiJson(rawText: string): GeminiStructuredResponse {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty response received from Gemini.');
  }

  // Strip markdown code fences if present
  let clean = rawText.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  try {
    const parsed = JSON.parse(clean.trim());
    return {
      answer: parsed.answer || clean,
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      hasSufficientEvidence: parsed.hasSufficientEvidence ?? true,
      notes: parsed.notes,
    };
  } catch {
    // If strict JSON parsing fails, fallback to raw text response
    return {
      answer: clean,
      citations: [],
      hasSufficientEvidence: true,
    };
  }
}

/**
 * Orchestrate contract question answering with retrieval, Gemini generation, and citation verification
 */
export async function generateContractAnswer(
  conversationId: string,
  userQuestion: string,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<ContractAnswerResult> {
  // 1. Retrieve relevant evidence from attached documents
  const retrieval = await retrieveRelevantChunks(conversationId, userQuestion);

  if (!retrieval.success) {
    throw new Error(retrieval.error || 'Failed to retrieve document evidence.');
  }

  // 2. Check if evidence is available
  if (!retrieval.hasRelevantEvidence || retrieval.chunks.length === 0) {
    return {
      answer:
        'Based on the provided contract excerpts, there is insufficient evidence to answer your question. No matching contract clauses or terms were found in the attached documents.',
      citations: [],
      hasSufficientEvidence: false,
      retrievedChunksCount: 0,
      retrievalSuccess: true,
      model: modelName,
      verificationSummary: {
        totalCandidates: 0,
        verifiedCount: 0,
        partialCount: 0,
        unverifiedCount: 0,
        allVerified: true,
      },
    };
  }

  // 3. Verify Gemini is configured
  if (!isGeminiConfigured()) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  // 4. Format prompt and context
  const contextXml = formatRetrievedContext(retrieval.chunks);
  const prompt = `${contextXml}\n\nUSER QUESTION: ${userQuestion}\n\nProvide your analysis strictly adhering to the JSON schema.`;

  // 5. Call Gemini with automatic model fallback on 503 high-demand or 429 quota spikes
  const ai = getGeminiClient();
  const { result: response, usedModel } = await executeWithModelFallback(
    modelName,
    (m) =>
      ai.models.generateContent({
        model: m,
        contents: prompt,
        config: {
          systemInstruction: CONTRACT_QA_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.1, // Low temperature for factual precision and grounded citations
        },
      })
  );

  const responseText = extractGeminiResponseText(response);
  const parsedResponse = parseGeminiJson(responseText);

  // 6. Verify citation candidates against authoritative database records
  const verificationResult = await verifyCitationCandidates(
    conversationId,
    parsedResponse.citations
  );

  return {
    answer: parsedResponse.answer,
    citations: verificationResult.citations,
    hasSufficientEvidence: parsedResponse.hasSufficientEvidence,
    retrievedChunksCount: retrieval.chunks.length,
    retrievalSuccess: true,
    model: usedModel,
    verificationSummary: {
      totalCandidates: verificationResult.totalCandidates,
      verifiedCount: verificationResult.verifiedCount,
      partialCount: verificationResult.partialCount,
      unverifiedCount: verificationResult.unverifiedCount,
      allVerified: verificationResult.allVerified,
    },
  };
}
