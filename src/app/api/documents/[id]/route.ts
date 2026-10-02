import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deleteContractFile, isStorageConfigured } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/[id]
 * Retrieve document metadata and processing overview
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid document ID provided.',
        },
        { status: 400 }
      );
    }

    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            pages: true,
            chunks: true,
            conversations: true,
          },
        },
        pages: {
          select: {
            id: true,
            pageNumber: true,
            extractedText: true,
          },
          orderBy: { pageNumber: 'asc' },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        {
          success: false,
          error: `Document with ID '${id}' was not found.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          status: document.status,
          processingError: document.processingError,
          createdAt: document.createdAt.toISOString(),
          updatedAt: document.updatedAt.toISOString(),
          counts: {
            pages: document._count.pages,
            chunks: document._count.chunks,
            conversations: document._count.conversations,
          },
          pages: document.pages.map((p) => ({
            id: p.id,
            pageNumber: p.pageNumber,
            characterCount: p.extractedText.length,
            extractedText: p.extractedText,
          })),
        },
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve document details.',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete document, related database records, and stored file with explicit consistency tracking
 */
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid document ID provided.',
        },
        { status: 400 }
      );
    }

    // 1. Check if document exists and retrieve storage key
    const document = await prisma.document.findUnique({
      where: { id },
      select: { id: true, storageKey: true },
    });

    if (!document) {
      return NextResponse.json(
        {
          success: false,
          error: `Document with ID '${id}' was not found.`,
        },
        { status: 404 }
      );
    }

    // 2. Remove stored file from Supabase Storage (if configured)
    let storageError: string | null = null;
    if (isStorageConfigured() && document.storageKey) {
      const storageResult = await deleteContractFile(document.storageKey);
      if (!storageResult.success) {
        storageError = storageResult.error || 'Failed to remove file from storage bucket';
      }
    }

    // 3. Delete database record (cascade deletes related pages, chunks, citations)
    await prisma.document.delete({
      where: { id },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Document and associated database records successfully deleted.',
        id,
        storageCleanup: storageError ? 'warning' : 'completed',
        ...(storageError && { storageWarning: storageError }),
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete document from database.',
      },
      { status: 500 }
    );
  }
}
