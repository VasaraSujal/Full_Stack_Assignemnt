import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { DocumentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CreateConversationBody {
  documentIds: string[];
  title?: string;
}

/**
 * POST /api/conversations
 * Create a new conversation attached to one or more completed contract documents
 */
export async function POST(req: NextRequest) {
  try {
    let body: CreateConversationBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const { documentIds, title } = body;

    // 1. Validate document IDs
    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least one document ID must be provided in "documentIds".',
        },
        { status: 400 }
      );
    }

    // Remove duplicates
    const uniqueDocIds = Array.from(new Set(documentIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));

    if (uniqueDocIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid document IDs provided.' },
        { status: 400 }
      );
    }

    if (uniqueDocIds.length > 10) {
      return NextResponse.json(
        { success: false, error: 'Cannot attach more than 10 documents to a single conversation.' },
        { status: 400 }
      );
    }

    // 2. Fetch documents and ensure all exist and are COMPLETED
    const existingDocs = await prisma.document.findMany({
      where: { id: { in: uniqueDocIds } },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        fileSize: true,
        status: true,
      },
    });

    if (existingDocs.length !== uniqueDocIds.length) {
      const foundIds = new Set(existingDocs.map((d) => d.id));
      const missingIds = uniqueDocIds.filter((id) => !foundIds.has(id));
      return NextResponse.json(
        {
          success: false,
          error: `The following document IDs were not found: ${missingIds.join(', ')}`,
        },
        { status: 404 }
      );
    }

    const uncompletedDocs = existingDocs.filter((d) => d.status !== DocumentStatus.COMPLETED);
    if (uncompletedDocs.length > 0) {
      const uncompletedNames = uncompletedDocs.map((d) => `${d.originalFilename} (${d.status})`).join(', ');
      return NextResponse.json(
        {
          success: false,
          error: `Cannot create conversation with unprocessed documents. Uncompleted: ${uncompletedNames}`,
        },
        { status: 400 }
      );
    }

    // 3. Auto-generate title if omitted
    const conversationTitle =
      title && typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : existingDocs.length === 1
        ? `Analysis: ${existingDocs[0].originalFilename}`
        : `Analysis: ${existingDocs[0].originalFilename} (+${existingDocs.length - 1} more)`;

    // 4. Create conversation and attachments in a transaction
    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
        data: {
          title: conversationTitle,
        },
      });

      await tx.conversationDocument.createMany({
        data: uniqueDocIds.map((docId) => ({
          conversationId: conv.id,
          documentId: docId,
        })),
      });

      return conv;
    });

    return NextResponse.json(
      {
        success: true,
        conversation: {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt.toISOString(),
          documents: existingDocs.map((d) => ({
            id: d.id,
            originalFilename: d.originalFilename,
            mimeType: d.mimeType,
            fileSize: d.fileSize,
            status: d.status,
          })),
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create conversation.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/conversations
 * List all conversations with metadata and attached documents
 */
export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            messages: true,
            documents: true,
          },
        },
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
      },
    });

    return NextResponse.json(
      {
        success: true,
        conversations: conversations.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
          messageCount: c._count.messages,
          documentCount: c._count.documents,
          documents: c.documents.map((cd) => cd.document),
        })),
        total: conversations.length,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown database error';
    console.error('[GET /api/conversations] Error querying database:', message);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve conversations list.',
        detail: !process.env.DATABASE_URL ? 'DATABASE_URL is not set in environment variables.' : message,
      },
      { status: 500 }
    );
  }
}
