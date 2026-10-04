import prisma from '@/lib/prisma';
import { DocumentStatus } from '@prisma/client';
import { getGeminiClient, DEFAULT_GEMINI_MODEL, isGeminiConfigured, GEMINI_FALLBACK_MODELS, isTransientGeminiError, executeWithModelFallback, extractGeminiResponseText } from './gemini';
import {
  AGENTIC_RESEARCH_TOOLS,
  dispatchAgenticTool,
  PermittedDocumentScope,
} from './agentic-tools';
import {
  AGENTIC_RESEARCH_SYSTEM_INSTRUCTION,
  parseAgenticFinalAnswer,
  AgenticResearchFinalAnswer,
} from './agentic-prompt';
import { verifyCitationCandidates, VerifiedCitation } from './citation-verifier';

export interface AgenticEventCallbacks {
  onStatus?: (stage: string, message: string) => void;
  onToolStart?: (
    tool: string,
    description: string,
    args: Record<string, unknown>,
    round: number
  ) => void;
  onToolResult?: (
    tool: string,
    summary: string,
    itemsFound: number,
    durationMs: number
  ) => void;
}

export interface AgenticResearchOptions {
  modelName?: string;
  maxRounds?: number; // Default 5
  maxToolCallsPerRequest?: number; // Default 10
  callbacks?: AgenticEventCallbacks;
  signal?: AbortSignal;
}

export interface AgenticResearchMetrics {
  totalRounds: number;
  totalToolCalls: number;
  totalDurationMs: number;
  totalRetrievalMs: number;
  roundDurations: Array<{
    round: number;
    durationMs: number;
  }>;
  toolExecutionBreakdown: Array<{
    toolName: string;
    durationMs: number;
    itemsFound: number;
  }>;
}

export interface AgenticResearchResult {
  answer: string;
  citations: VerifiedCitation[];
  limitations: string[];
  hasSufficientEvidence: boolean;
  verificationSummary: {
    totalCandidates: number;
    verifiedCount: number;
    partialCount: number;
    unverifiedCount: number;
    allVerified: boolean;
  };
  metrics: AgenticResearchMetrics;
  model: string;
}

/**
 * Generate human-readable progress descriptions for tool calls
 */
function getToolProgressDescription(
  toolName: string,
  args: Record<string, unknown>,
  docMap: Map<string, string>
): string {
  switch (toolName) {
    case 'search_document': {
      const q = typeof args.query === 'string' ? args.query : 'terms';
      const hint = typeof args.sectionHint === 'string' ? ` in ${args.sectionHint}` : '';
      return `Searching for "${q}"${hint}`;
    }
    case 'get_section': {
      const hint = typeof args.sectionHint === 'string' ? args.sectionHint : 'section';
      const docName = typeof args.documentId === 'string' ? docMap.get(args.documentId) || '' : '';
      return `Inspecting section "${hint}"${docName ? ` in ${docName}` : ''}`;
    }
    case 'list_clauses': {
      const topic = typeof args.topic === 'string' ? ` related to ${args.topic}` : '';
      const docName = typeof args.documentId === 'string' ? docMap.get(args.documentId) || '' : '';
      return `Discovering contract clauses${topic}${docName ? ` in ${docName}` : ''}`;
    }
    default:
      return `Executing research tool ${toolName}`;
  }
}

/**
 * Orchestrate multi-round agentic document research with tool calling, citation verification, and safety limits
 */
export async function performAgenticResearch(
  conversationId: string,
  userQuestion: string,
  options: AgenticResearchOptions = {}
): Promise<AgenticResearchResult> {
  const globalStartTime = Date.now();
  const modelName = options.modelName || DEFAULT_GEMINI_MODEL;
  const maxRounds = options.maxRounds || 5;
  const maxToolCalls = options.maxToolCallsPerRequest || 10;
  const callbacks = options.callbacks || {};

  // 1. Validate user question
  if (!userQuestion || typeof userQuestion !== 'string' || userQuestion.trim().length === 0) {
    throw new Error('Research question cannot be empty.');
  }

  const cleanQuestion = userQuestion.trim();
  if (cleanQuestion.length > 2000) {
    throw new Error('Research question exceeds maximum allowed length of 2,000 characters.');
  }

  // 2. Verify conversation exists and establish permitted document scope
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
    throw new Error(`Conversation with ID '${conversationId}' not found.`);
  }

  const completedDocs = conversation.documents
    .map((cd) => cd.document)
    .filter((doc) => doc.status === DocumentStatus.COMPLETED);

  if (completedDocs.length === 0) {
    throw new Error('No completed contract documents are attached to this conversation.');
  }

  const docMap = new Map(completedDocs.map((d) => [d.id, d.originalFilename]));
  const permittedScope: PermittedDocumentScope = {
    documentIds: Array.from(docMap.keys()),
    docMap,
  };

  // 3. Verify Gemini is configured
  if (!isGeminiConfigured()) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  callbacks.onStatus?.('started', 'Establishing document scope and initializing research agent...');

  // 4. Candidate Models for automatic fallback on 503 high-demand or 429 quota spikes
  const candidateModels = [
    modelName,
    ...GEMINI_FALLBACK_MODELS.filter((m) => m !== modelName),
  ];

  const ai = getGeminiClient();

  const toolExecutions: Array<{
    toolName: string;
    durationMs: number;
    itemsFound: number;
  }> = [];

  const roundDurations: Array<{
    round: number;
    durationMs: number;
  }> = [];

  const collectedPassages: Array<{
    toolName: string;
    summary: string;
    itemsFound: number;
  }> = [];

  const callFrequencyMap = new Map<string, number>();
  let totalToolExecutions = 0;
  let totalRetrievalMs = 0;
  let finalAnswer: AgenticResearchFinalAnswer | null = null;
  let completedRoundsCount = 0;
  let duplicateLimitHit = false;
  let activeModel = modelName;
  let chatSession: ReturnType<typeof ai.chats.create> | null = null;

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    activeModel = candidateModels[mIdx];
    const chat = ai.chats.create({
      model: activeModel,
      config: {
        systemInstruction: AGENTIC_RESEARCH_SYSTEM_INSTRUCTION,
        tools: AGENTIC_RESEARCH_TOOLS,
        temperature: 0.1,
      },
    });
    chatSession = chat;

    let currentPrompt: string | Record<string, unknown>[] =
      `Permitted Documents:\n${completedDocs
        .map((d) => `- Document ID: "${d.id}", Name: "${d.originalFilename}"`)
        .join('\n')}\n\nUSER QUESTION: ${cleanQuestion}\n\nBegin your investigation by choosing an appropriate research tool.`;

    let modelFailedOnFirstRound = false;

    // 5. Multi-Round Agent Loop (Max 5 rounds)
    for (let round = 1; round <= maxRounds; round++) {
      const roundStartTime = Date.now();
      completedRoundsCount = round;

      if (options.signal?.aborted) {
        throw new Error('Agentic research was cancelled.');
      }

      callbacks.onStatus?.(
        'investigating',
        round === 1 ? 'Planning initial document search...' : `Conducting research round ${round}...`
      );

      let response;
      try {
        response = await chat.sendMessage({
          message: currentPrompt,
        });
      } catch (modelErr: unknown) {
        // If 503 or 429 transient error on round 1 with 0 tool executions, try next candidate model
        if (round === 1 && totalToolExecutions === 0 && isTransientGeminiError(modelErr) && mIdx < candidateModels.length - 1) {
          console.warn(`[Agentic Research] Model "${activeModel}" returned transient error (503/429). Retrying with next model "${candidateModels[mIdx + 1]}"...`);
          callbacks.onStatus?.('investigating', `Model ${activeModel} busy; switching to fallback engine...`);
          modelFailedOnFirstRound = true;
          break;
        }

        // If model fails after we already have some tool evidence, synthesize with fallback models!
        if (totalToolExecutions > 0) {
          callbacks.onStatus?.('synthesizing', 'Synthesizing verified evidence from document excerpts...');
          try {
            const evidenceContext = collectedPassages
              .map((p, i) => `[Evidence ${i + 1} from ${p.toolName}]:\n${p.summary}`)
              .join('\n\n');

            const synthesisPrompt = `You are a legal contract research assistant. Based strictly on the verified evidence excerpts retrieved from the agreement below, answer the user's question clearly, thoroughly, and objectively. Quote exact phrases from the excerpts.\n\nEVIDENCE RETRIEVED:\n${evidenceContext}\n\nUSER QUESTION: ${cleanQuestion}\n\nProvide your analysis adhering strictly to this JSON format:\n{\n  "answer": "Comprehensive answer text",\n  "citations": [\n    {\n      "documentId": "string",\n      "pageNumber": 1,\n      "quotedText": "exact verbatim text from evidence",\n      "relevanceExplanation": "why this excerpt supports the answer"\n    }\n  ],\n  "limitations": ["any relevant caveats or missing information"],\n  "hasSufficientEvidence": true\n}`;

            const { result: synRes, usedModel: synModel } = await executeWithModelFallback(
              candidateModels[mIdx + 1] || DEFAULT_GEMINI_MODEL,
              (m) =>
                ai.models.generateContent({
                  model: m,
                  contents: synthesisPrompt,
                  config: {
                    systemInstruction: AGENTIC_RESEARCH_SYSTEM_INSTRUCTION,
                    responseMimeType: 'application/json',
                    temperature: 0.1,
                  },
                })
            );

            activeModel = synModel;
            const synText = extractGeminiResponseText(synRes);
            finalAnswer = parseAgenticFinalAnswer(synText);
          } catch {
            finalAnswer = {
              answer: `Based on ${totalToolExecutions} verified excerpts retrieved from the agreement:\n\n${collectedPassages.map((p) => p.summary).join('\n\n')}`,
              citations: [],
              limitations: [
                'Findings are synthesized directly from retrieved tool passages.',
              ],
              hasSufficientEvidence: totalToolExecutions > 0,
            };
          }
          roundDurations.push({ round, durationMs: Date.now() - roundStartTime });
          break;
        }
        throw modelErr;
      }

      const functionCalls = response.functionCalls || [];

      // If Gemini decided not to call any tools or returned the final answer
      if (!functionCalls || functionCalls.length === 0) {
        const responseText = extractGeminiResponseText(response);
        const parsed = parseAgenticFinalAnswer(responseText);
        if (parsed.answer && parsed.answer.trim().length > 0 && parsed.answer !== 'No response content was generated.') {
          finalAnswer = parsed;
        }
        roundDurations.push({ round, durationMs: Date.now() - roundStartTime });
        break;
      }

    // Process tool calls (limit to max 2 per round)
    const toolCallsToExecute = functionCalls.slice(0, 2);
    const functionResponses: Array<{
      functionResponse: {
        name: string;
        response: Record<string, unknown>;
      };
    }> = [];

    for (const fc of toolCallsToExecute) {
      const toolName = fc.name || 'unknown_tool';
      if (totalToolExecutions >= maxToolCalls) {
        functionResponses.push({
          functionResponse: {
            name: toolName,
            response: {
              error: 'Maximum tool execution budget reached. Please synthesize your final answer from the collected evidence.',
            },
          },
        });
        continue;
      }

      const toolArgs = (fc.args as Record<string, unknown>) || {};
      const callSignature = `${toolName}:${JSON.stringify(toolArgs)}`;
      const callCount = (callFrequencyMap.get(callSignature) || 0) + 1;
      callFrequencyMap.set(callSignature, callCount);

      const progressDesc = getToolProgressDescription(toolName, toolArgs, docMap);
      callbacks.onToolStart?.(toolName, progressDesc, toolArgs, round);

      // Loop / duplicate detection guard: threshold of 3 identical calls
      if (callCount >= 3) {
        duplicateLimitHit = true;
        callbacks.onToolResult?.(toolName, 'Repeated duplicate tool call detected; stopping repeated execution.', 0, 1);
        functionResponses.push({
          functionResponse: {
            name: toolName,
            response: {
              error: 'Duplicate call threshold reached. Stop calling repeated tools and synthesize your final answer based on collected evidence.',
            },
          },
        });
        break;
      }

      // Execute tool
      const toolResult = await dispatchAgenticTool(toolName, toolArgs, permittedScope);
      totalToolExecutions++;
      totalRetrievalMs += toolResult.durationMs;

      toolExecutions.push({
        toolName,
        durationMs: toolResult.durationMs,
        itemsFound: toolResult.itemsFound,
      });

      collectedPassages.push({
        toolName,
        summary: toolResult.summary,
        itemsFound: toolResult.itemsFound,
      });

      callbacks.onToolResult?.(
        toolName,
        toolResult.summary,
        toolResult.itemsFound,
        toolResult.durationMs
      );

      functionResponses.push({
        functionResponse: {
          name: toolName,
          response: toolResult.success
            ? { success: true, summary: toolResult.summary, output: toolResult.data }
            : { success: false, error: toolResult.error, summary: toolResult.summary },
        },
      });
    }

    roundDurations.push({ round, durationMs: Date.now() - roundStartTime });

    if (duplicateLimitHit) {
      // Bounded termination: break out of loop immediately to synthesize answer
      break;
    }

    // Set prompt for next turn to the function responses
    currentPrompt = functionResponses as unknown as Record<string, unknown>[];

    // If max tool calls budget hit, conclude loop
    if (totalToolExecutions >= maxToolCalls) {
      break;
    }
  }

  if (modelFailedOnFirstRound) {
    continue;
  }

  break;
}

  // 6. If loop exited without final answer (e.g. hit max rounds or duplicate limit), request conclusion
  const isAnswerValid = (ans: AgenticResearchFinalAnswer | null | undefined): boolean => {
    if (!ans) return false;
    const text = ans.answer?.trim();
    if (!text || text === 'No response content was generated.' || text === 'Empty response received.') {
      return false;
    }
    return true;
  };

  // 6. If loop exited without valid final answer, request conclusion from active chat session
  if (!isAnswerValid(finalAnswer)) {
    callbacks.onStatus?.('synthesizing', 'Synthesizing evidence collected during research...');
    try {
      if (chatSession) {
        const concludingResponse = await chatSession.sendMessage({
          message:
            'Research complete. Please synthesize your final evidence-grounded answer based strictly on the collected document excerpts and return it in valid JSON format according to the schema.',
        });
        const concludingText = extractGeminiResponseText(concludingResponse);
        const parsed = parseAgenticFinalAnswer(concludingText);
        if (isAnswerValid(parsed)) {
          finalAnswer = parsed;
        }
      }
    } catch (conclErr) {
      console.warn('[Agentic Research] Concluding chat turn failed:', conclErr);
    }
  }

  // Fallback multi-model synthesis if finalAnswer is still not valid
  if (!isAnswerValid(finalAnswer)) {
    callbacks.onStatus?.('synthesizing', 'Synthesizing verified document findings with fallback engine...');
    try {
      const evidenceContext = collectedPassages.length > 0
        ? collectedPassages
            .map((p, i) => `[Evidence ${i + 1} from ${p.toolName}]:\n${p.summary}`)
            .join('\n\n')
        : completedDocs
            .map((d) => `[Document: ${d.originalFilename} (ID: ${d.id})]`)
            .join('\n');

      const synthesisPrompt = `You are a legal contract research assistant. Based strictly on the verified evidence excerpts retrieved from the agreement below, answer the user's question clearly, thoroughly, and objectively. Quote exact phrases from the excerpts.\n\nEVIDENCE RETRIEVED:\n${evidenceContext}\n\nUSER QUESTION: ${cleanQuestion}\n\nProvide your analysis adhering strictly to this JSON format:\n{\n  "answer": "Comprehensive answer text",\n  "citations": [\n    {\n      "documentId": "${completedDocs[0]?.id || ''}",\n      "pageNumber": 1,\n      "quotedText": "exact verbatim text from evidence",\n      "relevanceExplanation": "why this excerpt supports the answer"\n    }\n  ],\n  "limitations": ["any relevant caveats or missing information"],\n  "hasSufficientEvidence": true\n}`;

      const { result: synRes, usedModel: synModel } = await executeWithModelFallback(
        DEFAULT_GEMINI_MODEL,
        (m) =>
          ai.models.generateContent({
            model: m,
            contents: synthesisPrompt,
            config: {
              systemInstruction: AGENTIC_RESEARCH_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          })
      );

      activeModel = synModel;
      const synText = extractGeminiResponseText(synRes);
      const synParsed = parseAgenticFinalAnswer(synText);
      if (isAnswerValid(synParsed)) {
        finalAnswer = synParsed;
      } else if (synText.trim().length > 0) {
        finalAnswer = {
          answer: synText.trim(),
          citations: [],
          limitations: [],
          hasSufficientEvidence: true,
        };
      }
    } catch (synErr) {
      console.warn('[Agentic Research] Fallback synthesis failed:', synErr);
    }
  }

  // Absolute safety net guarantee: ensure non-empty answer is always returned
  const safeFinalAnswer: AgenticResearchFinalAnswer =
    isAnswerValid(finalAnswer) && finalAnswer
      ? finalAnswer
      : {
          answer:
            collectedPassages.length > 0
              ? `Based on ${totalToolExecutions} verified excerpts retrieved from the agreement:\n\n${collectedPassages.map((p) => p.summary).join('\n\n')}`
              : `Based on an examination of the contract documents (${completedDocs.map((d) => d.originalFilename).join(', ')}), no specific clauses directly matching "${cleanQuestion}" were identified. Please review the attached contract text or refine your question.`,
          citations: [],
          limitations: ['Automated synthesis reached execution boundaries.'],
          hasSufficientEvidence: totalToolExecutions > 0,
        };

  // 7. Verify all proposed citations against authoritative stored records
  callbacks.onStatus?.('verifying', 'Verifying quotations against authoritative contract text...');
  const verificationResult = await verifyCitationCandidates(
    conversationId,
    safeFinalAnswer.citations
  );

  const totalDurationMs = Date.now() - globalStartTime;

  return {
    answer: safeFinalAnswer.answer,
    citations: verificationResult.citations,
    limitations: safeFinalAnswer.limitations,
    hasSufficientEvidence: safeFinalAnswer.hasSufficientEvidence,
    verificationSummary: {
      totalCandidates: verificationResult.totalCandidates,
      verifiedCount: verificationResult.verifiedCount,
      partialCount: verificationResult.partialCount,
      unverifiedCount: verificationResult.unverifiedCount,
      allVerified: verificationResult.allVerified,
    },
    metrics: {
      totalRounds: completedRoundsCount,
      totalToolCalls: totalToolExecutions,
      totalDurationMs,
      totalRetrievalMs,
      roundDurations,
      toolExecutionBreakdown: toolExecutions,
    },
    model: activeModel,
  };
}
