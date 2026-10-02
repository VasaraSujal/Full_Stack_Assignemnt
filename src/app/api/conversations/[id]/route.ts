import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/conversations/[id]
 * Retrieve conversation details, attached documents, and full chronological message history with citations
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid conversation ID provided.' },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        documents: {
          include: {
            document: {
              select: {
                id: true,
                originalFilename: true,
                mimeType: true,
                fileSize: true,
                status: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            citations: {
              include: {
                document: {
                  select: {
                    id: true,
                    originalFilename: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        {
          success: false,
          error: `Conversation with ID '${id}' was not found.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          documents: conversation.documents.map((cd) => cd.document),
          messages: conversation.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            status: m.status,
            createdAt: m.createdAt.toISOString(),
            citations: m.citations.map((c) => ({
              id: c.id,
              documentId: c.documentId,
              documentName: c.document.originalFilename,
              quotedText: c.quotedText,
              verificationStatus: c.verificationStatus,
              pageNumber: c.pageNumber,
              locationMetadata: c.locationMetadata,
              createdAt: c.createdAt.toISOString(),
            })),
          })),
        },
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve conversation details.',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/conversations/[id]
 * Delete conversation and its messages/citations
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid conversation ID provided.' },
        { status: 400 }
      );
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { success: false, error: `Conversation with ID '${id}' was not found.` },
        { status: 404 }
      );
    }

    await prisma.conversation.delete({
      where: { id },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Conversation successfully deleted.',
        id,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete conversation.',
      },
      { status: 500 }
    );
  }
}
