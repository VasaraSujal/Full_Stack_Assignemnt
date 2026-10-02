import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { validateDocumentFile } from '@/lib/file-validation';
import { generateStorageKey, uploadContractFile, deleteContractFile, isStorageConfigured } from '@/lib/storage';
import { processDocument } from '@/lib/document-processor';
import { DocumentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/documents
 * Secure document upload endpoint (PDF and DOCX)
 */
export async function POST(req: NextRequest) {
  let uploadedKey: string | null = null;
  let createdDocumentId: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: 'No file provided. Please attach a PDF or DOCX file in the "file" field.',
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Validate file content signature, size, and format
    const validation = validateDocumentFile(buffer, file.name);
    if (!validation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error,
        },
        { status: 400 }
      );
    }

    // 2. Generate unique storage key
    const storageKey = generateStorageKey(validation.format);

    // 3. Upload to private Supabase Storage (if configured)
    if (isStorageConfigured()) {
      const storageResult = await uploadContractFile(
        storageKey,
        buffer,
        validation.mimeType
      );

      if (!storageResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: 'Failed to upload document to private storage.',
          },
          { status: 500 }
        );
      }
      uploadedKey = storageResult.key || storageKey;
    } else {
      uploadedKey = storageKey;
    }

    // 4. Create Document record in database
    let document;
    try {
      document = await prisma.document.create({
        data: {
          originalFilename: validation.sanitizedFilename,
          mimeType: validation.mimeType,
          storageKey: uploadedKey,
          fileSize: validation.fileSize,
          status: DocumentStatus.PENDING,
        },
      });
      createdDocumentId = document.id;
    } catch (dbErr: unknown) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[POST /api/documents] Database record creation failed:', dbErr);
      }

      // Safely prevent orphaned storage object if database insertion fails
      if (isStorageConfigured() && uploadedKey) {
        try {
          await deleteContractFile(uploadedKey);
        } catch (storageCleanupErr) {
          if (process.env.NODE_ENV === 'development') {
            console.error('[POST /api/documents] Failed to rollback storage object:', storageCleanupErr);
          }
        }
      }

      const dbErrMsg = dbErr instanceof Error ? dbErr.message : 'Unknown database error';
      return NextResponse.json(
        {
          success: false,
          error: process.env.NODE_ENV === 'development'
            ? `Failed to create document record in database: ${dbErrMsg}`
            : 'Failed to create document record in database.',
        },
        { status: 500 }
      );
    }

    // 5. Process document: extract text, chunk content, and update status
    const processResult = await processDocument(
      document.id,
      buffer,
      validation.format
    );

    if (!processResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: processResult.error || 'Failed to process document content.',
          document: {
            id: document.id,
            originalFilename: document.originalFilename,
            mimeType: document.mimeType,
            fileSize: document.fileSize,
            status: processResult.status,
            processingError: processResult.error || null,
            pagesCount: 0,
            chunksCount: 0,
            createdAt: document.createdAt.toISOString(),
          },
        },
        { status: 422 }
      );
    }

    // 6. Return response
    return NextResponse.json(
      {
        success: true,
        document: {
          id: document.id,
          originalFilename: document.originalFilename,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          status: processResult.status,
          processingError: null,
          pagesCount: processResult.pagesCount || 0,
          chunksCount: processResult.chunksCount || 0,
          createdAt: document.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[POST /api/documents] Unexpected top-level upload exception:', err);
    }

    // If unexpected top-level exception occurs after database insert, mark as FAILED
    if (createdDocumentId) {
      try {
        const errorMsg = err instanceof Error ? err.message : 'Unexpected upload error';
        await prisma.document.update({
          where: { id: createdDocumentId },
          data: {
            status: DocumentStatus.FAILED,
            processingError: errorMsg,
          },
        });
      } catch {
        // Ignore secondary error
      }
    }

    const errMessage = err instanceof Error ? err.message : 'An unexpected error occurred while processing the document upload.';
    return NextResponse.json(
      {
        success: false,
        error: process.env.NODE_ENV === 'development' ? errMessage : 'An unexpected error occurred while processing the document upload.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/documents
 * List documents with metadata, status, and page/chunk counts
 */
export async function GET() {
  try {
    const documents = await prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        fileSize: true,
        status: true,
        processingError: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            pages: true,
            chunks: true,
          },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        documents: documents.map((doc) => ({
          ...doc,
          pagesCount: doc._count?.pages || 0,
          chunksCount: doc._count?.chunks || 0,
          conversationsCount: 0,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
        })),
        total: documents.length,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve documents list.',
      },
      { status: 500 }
    );
  }
}
