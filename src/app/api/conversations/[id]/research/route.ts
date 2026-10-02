import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { performAgenticResearch } from '@/lib/agentic-research-service';
import { MessageRole, GenerationStatus, DocumentStatus, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ResearchRequestBody {
  question: string;
}

/**
 * POST /api/conversations/[id]/research
 * Perform agentic document research with multi-round tool calling, citation verification, SSE streaming, and persistence
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: conversationId } = await params;

  if (!conversationId || typeof conversationId !== 'string') {
    return NextResponse.json(
      { success: false, error: 'Invalid conversation ID.' },
      { status: 400 }
    );
  }

  // 1. Validate request body
  let body: ResearchRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  const { question } = body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Research question cannot be empty.' },
      { status: 400 }
    );
  }

  const cleanQuestion = question.trim();
  if (cleanQuestion.length > 2000) {
    return NextResponse.json(
      {
        success: false,
        error: 'Research question exceeds maximum allowed length of 2,000 characters.',
      },
      { status: 400 }
    );
  }

  // 2. Verify conversation exists and has attached completed documents
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
    return NextResponse.json(
      { success: false, error: `Conversation with ID '${conversationId}' not found.` },
      { status: 404 }
    );
  }

  const completedDocs = conversation.documents.filter(
    (cd) => cd.document.status === DocumentStatus.COMPLETED
  );

  if (completedDocs.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'This conversation has no processed contracts attached. Please attach completed documents.',
      },
      { status: 400 }
    );
  }

  // 3. Persist User Message
  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.USER,
      content: cleanQuestion,
      status: GenerationStatus.COMPLETED,
    },
  });

  const acceptHeader = req.headers.get('accept') || '';
  const isSseRequested = acceptHeader.includes('text/event-stream');

  // 4. Handle Server-Sent Events (SSE) streaming if requested
  if (isSseRequested) {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(event: string, data: unknown) {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        }

        try {
          const researchResult = await performAgenticResearch(
            conversationId,
            cleanQuestion,
            {
              signal: req.signal,
              callbacks: {
                onStatus(stage, message) {
                  sendEvent('status', { stage, message });
                },
                onToolStart(tool, description, args, round) {
                  sendEvent('tool_start', {
                    tool,
                    description,
                    args,
                    round,
                  });
                },
                onToolResult(tool, summary, itemsFound, durationMs) {
                  sendEvent('tool_result', {
                    tool,
                    summary,
                    itemsFound,
                    durationMs,
                  });
                },
              },
            }
          );

          // Persist assistant message and citations atomically
          const assistantMessage = await prisma.$transaction(async (tx) => {
            const msg = await tx.message.create({
              data: {
                conversationId,
                role: MessageRole.ASSISTANT,
                content: researchResult.answer,
                status: GenerationStatus.COMPLETED,
              },
            });

            if (researchResult.citations.length > 0) {
              await tx.citation.createMany({
                data: researchResult.citations.map((c) => ({
                  messageId: msg.id,
                  documentId: c.documentId,
                  quotedText: c.quotedText,
                  verificationStatus: c.verificationStatus,
                  pageNumber: c.pageNumber,
                  locationMetadata: c.locationMetadata
                    ? (c.locationMetadata as unknown as Prisma.InputJsonValue)
                    : undefined,
                })),
              });
            }

            return msg;
          });

          // Send citations event with verification metrics
          sendEvent('citations', {
            citations: researchResult.citations,
            totalCitations: researchResult.citations.length,
            hasSufficientEvidence: researchResult.hasSufficientEvidence,
            verificationSummary: researchResult.verificationSummary,
            limitations: researchResult.limitations,
          });

          sendEvent('verification', researchResult.verificationSummary);

          // Stream answer text in chunks
          const words = researchResult.answer.split(' ');
          for (let i = 0; i < words.length; i += 3) {
            const tokenChunk =
              words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
            sendEvent('token', { token: tokenChunk });
          }

          // Send done event
          sendEvent('done', {
            messageId: assistantMessage.id,
            status: GenerationStatus.COMPLETED,
            createdAt: assistantMessage.createdAt.toISOString(),
            metrics: researchResult.metrics,
          });

          controller.close();
        } catch (err: unknown) {
          const errorMessage =
            err instanceof Error ? err.message : 'Agentic research failed.';

          try {
            await prisma.message.create({
              data: {
                conversationId,
                role: MessageRole.ASSISTANT,
                content: `Research failed: ${errorMessage}`,
                status: GenerationStatus.FAILED,
              },
            });
          } catch {
            // Ignore secondary DB error
          }

          sendEvent('error', {
            error: errorMessage,
            status: GenerationStatus.FAILED,
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  // 5. Handle Standard JSON Response
  try {
    const researchResult = await performAgenticResearch(conversationId, cleanQuestion, {
      signal: req.signal,
    });

    const assistantMessage = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: researchResult.answer,
          status: GenerationStatus.COMPLETED,
        },
      });

      if (researchResult.citations.length > 0) {
        await tx.citation.createMany({
          data: researchResult.citations.map((c) => ({
            messageId: msg.id,
            documentId: c.documentId,
            quotedText: c.quotedText,
            verificationStatus: c.verificationStatus,
            pageNumber: c.pageNumber,
            locationMetadata: c.locationMetadata
              ? (c.locationMetadata as unknown as Prisma.InputJsonValue)
              : undefined,
          })),
        });
      }

      return msg;
    });

    return NextResponse.json(
      {
        success: true,
        message: {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          status: assistantMessage.status,
          createdAt: assistantMessage.createdAt.toISOString(),
          citations: researchResult.citations,
          limitations: researchResult.limitations,
          hasSufficientEvidence: researchResult.hasSufficientEvidence,
          verificationSummary: researchResult.verificationSummary,
          metrics: researchResult.metrics,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Agentic research failed.';

    try {
      await prisma.message.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: `Research failed: ${message}`,
          status: GenerationStatus.FAILED,
        },
      });
    } catch {
      // Ignore secondary error
    }

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
