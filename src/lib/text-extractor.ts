import mammoth from 'mammoth';

// Polyfill web APIs missing in Node.js runtime required by pdfjs-dist / pdf-parse
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).DOMMatrix === 'undefined') {
  class DOMMatrixPolyfill {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true;
    isIdentity = true;

    constructor(init?: number[] | string | DOMMatrixPolyfill) {
      if (Array.isArray(init)) {
        if (init.length === 6) {
          this.a = this.m11 = init[0];
          this.b = this.m12 = init[1];
          this.c = this.m21 = init[2];
          this.d = this.m22 = init[3];
          this.e = this.m41 = init[4];
          this.f = this.m42 = init[5];
          this.is2D = true;
          this.isIdentity =
            init[0] === 1 && init[1] === 0 && init[2] === 0 && init[3] === 1 && init[4] === 0 && init[5] === 0;
        } else if (init.length === 16) {
          this.m11 = init[0]; this.m12 = init[1]; this.m13 = init[2]; this.m14 = init[3];
          this.m21 = init[4]; this.m22 = init[5]; this.m23 = init[6]; this.m24 = init[7];
          this.m31 = init[8]; this.m32 = init[9]; this.m33 = init[10]; this.m34 = init[11];
          this.m41 = init[12]; this.m42 = init[13]; this.m43 = init[14]; this.m44 = init[15];
          this.a = this.m11; this.b = this.m12; this.c = this.m21; this.d = this.m22;
          this.e = this.m41; this.f = this.m42;
          this.is2D = false;
          this.isIdentity = false;
        }
      }
    }

    translate(tx = 0, ty = 0) {
      const copy = new DOMMatrixPolyfill();
      Object.assign(copy, this);
      copy.e += tx; copy.m41 += tx;
      copy.f += ty; copy.m42 += ty;
      return copy;
    }

    scale(sx = 1, sy = sx) {
      const copy = new DOMMatrixPolyfill();
      Object.assign(copy, this);
      copy.a *= sx; copy.m11 *= sx;
      copy.d *= sy; copy.m22 *= sy;
      return copy;
    }

    multiply() {
      const copy = new DOMMatrixPolyfill();
      Object.assign(copy, this);
      return copy;
    }

    inverse() {
      const copy = new DOMMatrixPolyfill();
      Object.assign(copy, this);
      return copy;
    }

    transformPoint(point: { x: number; y: number; z?: number; w?: number }) {
      return {
        x: point.x * this.a + point.y * this.c + this.e,
        y: point.x * this.b + point.y * this.d + this.f,
        z: point.z ?? 0,
        w: point.w ?? 1,
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMMatrixReadOnly = DOMMatrixPolyfill;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (globalThis as any).DOMPoint === 'undefined') {
  class DOMPointPolyfill {
    x = 0; y = 0; z = 0; w = 1;
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x; this.y = y; this.z = z; this.w = w;
    }
    static fromPoint(other?: { x?: number; y?: number; z?: number; w?: number }) {
      return new DOMPointPolyfill(other?.x ?? 0, other?.y ?? 0, other?.z ?? 0, other?.w ?? 1);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMPoint = DOMPointPolyfill;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DOMPointReadOnly = DOMPointPolyfill;
}

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
