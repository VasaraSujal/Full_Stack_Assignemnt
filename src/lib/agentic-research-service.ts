import prisma from '@/lib/prisma';
import { DocumentStatus } from '@prisma/client';
import { getGeminiClient, DEFAULT_GEMINI_MODEL, isGeminiConfigured } from './gemini';
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

  // 4. Initialize Gemini Chat Session with Tools
  const ai = getGeminiClient();
  const chat = ai.chats.create({
    model: modelName,
    config: {
      systemInstruction: AGENTIC_RESEARCH_SYSTEM_INSTRUCTION,
      tools: AGENTIC_RESEARCH_TOOLS,
      temperature: 0.1,
    },
  });

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

  let currentPrompt: string | Record<string, unknown>[] =
    `Permitted Documents:\n${completedDocs
      .map((d) => `- Document ID: "${d.id}", Name: "${d.originalFilename}"`)
      .join('\n')}\n\nUSER QUESTION: ${cleanQuestion}\n\nBegin your investigation by choosing an appropriate research tool.`;

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
      // If model fails after we already have some tool evidence, exit to synthesis fallback
      if (totalToolExecutions > 0) {
        callbacks.onStatus?.('synthesizing', 'Model encountered an error; synthesizing collected evidence...');
        finalAnswer = {
          answer: `Research concluded with partial evidence collected (${totalToolExecutions} tool executions). Due to a temporary processing interruption, review the collected excerpts directly.`,
          citations: [],
          limitations: [
            'Investigation ended early due to model response interruption.',
            'Findings are bounded strictly to retrieved tool passages.',
          ],
          hasSufficientEvidence: false,
        };
        roundDurations.push({ round, durationMs: Date.now() - roundStartTime });
        break;
      }
      throw modelErr;
    }

    const functionCalls = response.functionCalls || [];

    // If Gemini decided not to call any tools or returned the final answer
    if (!functionCalls || functionCalls.length === 0) {
      const responseText = response.text || '';
      finalAnswer = parseAgenticFinalAnswer(responseText);
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

  // 6. If loop exited without final answer (e.g. hit max rounds or duplicate limit), request conclusion
  if (!finalAnswer) {
    callbacks.onStatus?.('synthesizing', 'Synthesizing evidence collected during research...');
    try {
      const concludingResponse = await chat.sendMessage({
        message:
          'Research complete. Please synthesize your final evidence-grounded answer based strictly on the collected document excerpts and return it in valid JSON format according to the schema.',
      });
      finalAnswer = parseAgenticFinalAnswer(concludingResponse.text || '');
    } catch {
      // Graceful fallback synthesis if model synthesis fails
      finalAnswer = {
        answer: `Research concluded with ${totalToolExecutions} tool executions. Evidence was collected across ${completedDocs.length} contract document(s).`,
        citations: [],
        limitations: [
          'Automated synthesis reached execution boundaries.',
          'Please inspect the referenced sections directly for verified clause terms.',
        ],
        hasSufficientEvidence: totalToolExecutions > 0,
      };
    }
  }

  // 7. Verify all proposed citations against authoritative stored records
  callbacks.onStatus?.('verifying', 'Verifying quotations against authoritative contract text...');
  const verificationResult = await verifyCitationCandidates(
    conversationId,
    finalAnswer.citations
  );

  const totalDurationMs = Date.now() - globalStartTime;

  return {
    answer: finalAnswer.answer,
    citations: verificationResult.citations,
    limitations: finalAnswer.limitations,
    hasSufficientEvidence: finalAnswer.hasSufficientEvidence,
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
    model: modelName,
  };
}
