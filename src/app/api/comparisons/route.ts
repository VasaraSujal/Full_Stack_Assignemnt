import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { compareContracts } from '@/lib/comparison-service';
import { DocumentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface CompareRequestBody {
  documentIds: string[];
  question?: string;
  conversationId?: string;
  versionGroupId?: string;
}

/**
 * POST /api/comparisons
 * Compare two or more legal contracts with balanced retrieval and citation verification
 */
export async function POST(req: NextRequest) {
  try {
    let body: CompareRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const { documentIds, question, conversationId, versionGroupId } = body;

    // 1. Validate documentIds input
    if (!documentIds || !Array.isArray(documentIds)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Field "documentIds" must be an array of document IDs.',
        },
        { status: 400 }
      );
    }

    const uniqueDocIds = Array.from(
      new Set(
        documentIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
      )
    );

    if (uniqueDocIds.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'At least two distinct document IDs are required to perform a contract comparison.',
        },
        { status: 400 }
      );
    }

    if (uniqueDocIds.length > 5) {
      return NextResponse.json(
        {
          success: false,
          error: 'A maximum of 5 documents can be compared simultaneously.',
        },
        { status: 400 }
      );
    }

    // 2. Validate question length if provided
    if (question && typeof question === 'string' && question.length > 2000) {
      return NextResponse.json(
        {
          success: false,
          error: 'Question is too long (maximum 2,000 characters).',
        },
        { status: 400 }
      );
    }

    // 3. Verify documents exist and are COMPLETED
    const existingDocs = await prisma.document.findMany({
      where: { id: { in: uniqueDocIds } },
      select: {
        id: true,
        originalFilename: true,
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

    const uncompletedDocs = existingDocs.filter(
      (d) => d.status !== DocumentStatus.COMPLETED
    );
    if (uncompletedDocs.length > 0) {
      const names = uncompletedDocs
        .map((d) => `${d.originalFilename} (${d.status})`)
        .join(', ');
      return NextResponse.json(
        {
          success: false,
          error: `Cannot compare unprocessed documents: ${names}`,
        },
        { status: 400 }
      );
    }

    // 4. Run comparison service
    const comparisonResult = await compareContracts(uniqueDocIds, question, {
      conversationId,
      versionGroupId,
    });

    return NextResponse.json(
      {
        success: true,
        comparison: comparisonResult,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Contract comparison failed.';
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/comparisons
 * Query persisted comparisons between documents or by version group
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sourceDocId = searchParams.get('sourceDocumentId');
    const targetDocId = searchParams.get('targetDocumentId');
    const versionGroupId = searchParams.get('versionGroupId');

    const where: Record<string, unknown> = {};
    if (sourceDocId) {
      const exists = await prisma.document.findUnique({ where: { id: sourceDocId } });
      if (!exists) {
        return NextResponse.json(
          { success: false, error: `Source document with ID '${sourceDocId}' not found.` },
          { status: 404 }
        );
      }
      where.sourceDocumentId = sourceDocId;
    }
    if (targetDocId) {
      const exists = await prisma.document.findUnique({ where: { id: targetDocId } });
      if (!exists) {
        return NextResponse.json(
          { success: false, error: `Target document with ID '${targetDocId}' not found.` },
          { status: 404 }
        );
      }
      where.targetDocumentId = targetDocId;
    }
    if (versionGroupId) where.versionGroupId = versionGroupId;

    const changes = await prisma.comparisonChange.findMany({
      where,
      include: {
        sourceDocument: {
          select: { id: true, originalFilename: true },
        },
        targetDocument: {
          select: { id: true, originalFilename: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      success: true,
      changes: changes.map((c) => ({
        id: c.id,
        versionGroupId: c.versionGroupId,
        sourceDocument: c.sourceDocument,
        targetDocument: c.targetDocument,
        changeCategory: c.changeCategory,
        significance: c.significance,
        oldText: c.oldText,
        newText: c.newText,
        plainLanguageSummary: c.plainLanguageSummary,
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve comparison changes.' },
      { status: 500 }
    );
  }
}
