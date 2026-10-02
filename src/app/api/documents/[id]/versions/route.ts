import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/documents/[id]/versions
 * List version history for a given document or its versionGroup
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const doc = await prisma.document.findUnique({
      where: { id },
      include: {
        versions: true,
      },
    });

    if (!doc) {
      return NextResponse.json(
        { success: false, error: `Document with ID '${id}' not found.` },
        { status: 404 }
      );
    }

    // Find all version records associated with the same versionGroups
    const versionGroups = doc.versions.map((v) => v.versionGroup);
    const relatedVersions = await prisma.documentVersion.findMany({
      where: {
        versionGroup: { in: versionGroups },
      },
      include: {
        document: {
          select: {
            id: true,
            originalFilename: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      success: true,
      documentId: id,
      versions: relatedVersions,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve document versions.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/documents/[id]/versions
 * Assign a version group and label to a document
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (!body || !body.versionGroup || !body.versionLabel) {
      return NextResponse.json(
        {
          success: false,
          error: 'Fields "versionGroup" and "versionLabel" are required.',
        },
        { status: 400 }
      );
    }

    const doc = await prisma.document.findUnique({ where: { id } });
    if (!doc) {
      return NextResponse.json(
        { success: false, error: `Document with ID '${id}' not found.` },
        { status: 404 }
      );
    }

    const version = await prisma.documentVersion.create({
      data: {
        documentId: id,
        versionGroup: String(body.versionGroup).trim(),
        versionLabel: String(body.versionLabel).trim(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        version,
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to register document version.' },
      { status: 500 }
    );
  }
}
