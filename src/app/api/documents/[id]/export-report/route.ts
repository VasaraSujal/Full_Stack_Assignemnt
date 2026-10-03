import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  assembleContractReportData,
  generateContractReviewPdf,
  ReportSection,
} from '@/lib/report-generator';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ExportReportSchema = z.object({
  sections: z
    .array(z.enum(['summary', 'risks', 'obligations', 'citations']))
    .min(1, 'Please select at least one report section to include in the export.'),
  language: z.enum(['source', 'en']).optional().default('source'),
});

/**
 * POST /api/documents/[id]/export-report
 * Generate and stream a downloadable Contract Review PDF report with verified citations
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'A valid document ID is required.' },
        { status: 400 }
      );
    }

    // 1. Parse and validate JSON request body
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const validation = ExportReportSchema.safeParse(rawBody);
    if (!validation.success) {
      const issue = validation.error.issues[0];
      return NextResponse.json(
        {
          success: false,
          error: issue ? issue.message : 'Invalid report configuration options.',
        },
        { status: 400 }
      );
    }

    const { sections, language } = validation.data;

    // 2. Assemble report data and re-verify all citations against authoritative text
    const reportData = await assembleContractReportData(id, {
      sections: sections as ReportSection[],
      language,
    });

    // 3. Generate PDF buffer with Arabic/English typography
    const pdfBuffer = await generateContractReviewPdf(reportData);

    // 4. Sanitize filename for Content-Disposition
    const safeBaseName = reportData.originalFilename
      .replace(/\.[^/.]+$/, '') // remove existing extension
      .replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_') // keep letters, numbers, and hyphens
      .slice(0, 50);

    const dateStr = new Date().toISOString().slice(0, 10);
    const downloadFilename = `contract-review-${safeBaseName || 'agreement'}-${dateStr}.pdf`;

    // 5. Return downloadable PDF response with streaming binary headers
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Content-Length': pdfBuffer.length.toString(),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to generate contract report.';
    const isNotFound = errorMessage.includes('not found');
    const isPending = errorMessage.includes('Only COMPLETED documents');

    const status = isNotFound ? 404 : isPending ? 422 : 500;

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status }
    );
  }
}
