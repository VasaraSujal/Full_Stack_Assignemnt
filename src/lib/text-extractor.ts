import mammoth from 'mammoth';

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionSuccess {
  success: true;
  pages: ExtractedPage[];
  totalPages: number;
  format: 'pdf' | 'docx';
}

export interface ExtractionFailure {
  success: false;
  error: string;
  isScannedOrEmpty?: boolean;
  format: 'pdf' | 'docx';
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

/**
 * Check if the extracted text contains meaningful alphanumeric content.
 * Distinguishes scanned / image-only PDFs (which yield 0 extractable words or only whitespace artifacts)
 * from valid short contracts with concise legal clauses.
 */
function isMeaningfulText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;

  // Count alphanumeric characters
  const alphanumericCount = (trimmed.match(/[\p{L}\p{N}]/gu) || []).length;
  // A scanned/image-only PDF yields 0 text or only stray artifacts (< 6 letters).
  // Any real short contract (e.g. "Mutual NDA between Party A and B") easily exceeds 6 alphanumeric characters.
  return alphanumericCount >= 6;
}

/**
 * Extract readable text from a PDF buffer page by page
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  let parserInstance: { destroy?: () => Promise<void> } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfModule = require('pdf-parse');
    const PDFParseClass = pdfModule.PDFParse || pdfModule.default?.PDFParse || pdfModule;

    let parsedText: { text?: string; pages?: Array<{ text?: string; num?: number }> } | null = null;

    if (typeof PDFParseClass === 'function') {
      try {
        // Try constructor instantiation first (pdf-parse v2)
        const instance = new PDFParseClass({ data: buffer });
        parserInstance = instance;
        parsedText = await instance.getText();
      } catch (classErr) {
        // If constructor fails with TypeError regarding 'new' or options, try function invocation (pdf-parse v1)
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsedText = await (PDFParseClass as any)(buffer);
        } catch {
          // Re-throw original extraction error
          throw classErr;
        }
      }
    } else if (typeof pdfModule === 'function') {
      parsedText = await pdfModule(buffer);
    } else {
      throw new Error('pdf-parse library does not provide a valid parser function or class.');
    }

    const pages: ExtractedPage[] = [];

    if (parsedText && Array.isArray(parsedText.pages) && parsedText.pages.length > 0) {
      parsedText.pages.forEach((p: { text?: string; num?: number }, idx: number) => {
        const pageText = (p.text || '').trim();
        pages.push({
          pageNumber: p.num || idx + 1,
          text: pageText,
        });
      });
    } else if (parsedText && typeof parsedText.text === 'string') {
      const fullText = parsedText.text.trim();
      pages.push({
        pageNumber: 1,
        text: fullText,
      });
    }

    // Check for scanned / image-only PDF with no embedded text layer
    const combinedText = pages.map((p) => p.text).join(' ');
    if (!isMeaningfulText(combinedText)) {
      return {
        success: false,
        error:
          'No readable text extracted. The PDF appears to be scanned, image-only, or contains no extractable text layer.',
        isScannedOrEmpty: true,
        format: 'pdf',
      };
    }

    return {
      success: true,
      pages,
      totalPages: pages.length,
      format: 'pdf',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'PDF parsing failed';
    return {
      success: false,
      error: `Failed to parse PDF document: ${message}`,
      format: 'pdf',
    };
  } finally {
    if (parserInstance && typeof parserInstance.destroy === 'function') {
      try {
        await parserInstance.destroy();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Extract readable text from a DOCX buffer
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const rawText = (result.value || '').trim();

    if (!isMeaningfulText(rawText)) {
      return {
        success: false,
        error: 'DOCX document contains no readable text or is empty.',
        isScannedOrEmpty: true,
        format: 'docx',
      };
    }

    // Preserve paragraph structure
    const normalizedText = rawText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');

    return {
      success: true,
      pages: [
        {
          pageNumber: 1,
          text: normalizedText,
        },
      ],
      totalPages: 1,
      format: 'docx',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'DOCX parsing failed';
    return {
      success: false,
      error: `Failed to parse DOCX document: ${message}`,
      format: 'docx',
    };
  }
}

/**
 * Unified text extractor for supported formats
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  format: 'pdf' | 'docx'
): Promise<ExtractionResult> {
  if (format === 'pdf') {
    return extractTextFromPdf(buffer);
  } else if (format === 'docx') {
    return extractTextFromDocx(buffer);
  } else {
    return {
      success: false,
      error: `Unsupported file format '${format}'. Only PDF and DOCX are supported.`,
      format,
    };
  }
}
