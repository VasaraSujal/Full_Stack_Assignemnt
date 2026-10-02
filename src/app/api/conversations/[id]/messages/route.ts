import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { generateContractAnswer } from '@/lib/gemini-service';
import { MessageRole, GenerationStatus, DocumentStatus, Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface MessageRequestBody {
  content: string;
}

/**
 * POST /api/conversations/[id]/messages
 * Process user question, retrieve contract excerpts, generate Gemini answer, verify citations, and persist
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
  let body: MessageRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON request body.' },
      { status: 400 }
    );
  }

  const { content } = body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Message content cannot be empty.' },
      { status: 400 }
    );
  }

  const userQuery = content.trim();
  if (userQuery.length > 2000) {
    return NextResponse.json(
      { success: false, error: 'Message content exceeds maximum allowed length of 2,000 characters.' },
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
      content: userQuery,
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
          sendEvent('status', { stage: 'retrieving', message: 'Searching contract excerpts...' });

          sendEvent('status', { stage: 'generating', message: 'Analyzing legal terms with Gemini...' });

          const qaResult = await generateContractAnswer(conversationId, userQuery);

          sendEvent('status', { stage: 'verifying', message: 'Verifying citation quotes against authoritative records...' });

          // Persist assistant message and citations atomically
          const assistantMessage = await prisma.$transaction(async (tx) => {
            const msg = await tx.message.create({
              data: {
                conversationId,
                role: MessageRole.ASSISTANT,
                content: qaResult.answer,
                status: GenerationStatus.COMPLETED,
              },
            });

            if (qaResult.citations.length > 0) {
              await tx.citation.createMany({
                data: qaResult.citations.map((c) => ({
                  messageId: msg.id,
                  documentId: c.documentId,
                  quotedText: c.quotedText,
                  verificationStatus: c.verificationStatus,
                  pageNumber: c.pageNumber,
                  locationMetadata: c.locationMetadata ? (c.locationMetadata as unknown as Prisma.InputJsonValue) : undefined,
                })),
              });
            }

            return msg;
          });

          // Send citations event with verification metrics
          sendEvent('citations', {
            citations: qaResult.citations,
            totalCitations: qaResult.citations.length,
            hasSufficientEvidence: qaResult.hasSufficientEvidence,
            verificationSummary: qaResult.verificationSummary,
          });

          // Stream response text tokens in chunks
          const words = qaResult.answer.split(' ');
          for (let i = 0; i < words.length; i += 3) {
            const tokenChunk = words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
            sendEvent('token', { token: tokenChunk });
          }

          // Send done event
          sendEvent('done', {
            messageId: assistantMessage.id,
            status: GenerationStatus.COMPLETED,
            createdAt: assistantMessage.createdAt.toISOString(),
          });

          controller.close();
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Generation failed';

          try {
            await prisma.message.create({
              data: {
                conversationId,
                role: MessageRole.ASSISTANT,
                content: `Generation failed: ${errorMessage}`,
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
    const qaResult = await generateContractAnswer(conversationId, userQuery);

    const assistantMessage = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: qaResult.answer,
          status: GenerationStatus.COMPLETED,
        },
      });

      if (qaResult.citations.length > 0) {
        await tx.citation.createMany({
          data: qaResult.citations.map((c) => ({
            messageId: msg.id,
            documentId: c.documentId,
            quotedText: c.quotedText,
            verificationStatus: c.verificationStatus,
            pageNumber: c.pageNumber,
            locationMetadata: c.locationMetadata ? (c.locationMetadata as unknown as Prisma.InputJsonValue) : undefined,
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
          citations: qaResult.citations,
          hasSufficientEvidence: qaResult.hasSufficientEvidence,
          retrievedChunksCount: qaResult.retrievedChunksCount,
          verificationSummary: qaResult.verificationSummary,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to generate contract answer.';

    try {
      await prisma.message.create({
        data: {
          conversationId,
          role: MessageRole.ASSISTANT,
          content: `Generation failed: ${errorMessage}`,
          status: GenerationStatus.FAILED,
        },
      });
    } catch {
      // Ignore secondary DB error
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
