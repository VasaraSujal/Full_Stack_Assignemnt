import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import {
  assembleContractReportData,
  generateContractReviewPdf,
  verifyQuoteAgainstPages,
  ContractReportData,
} from '@/lib/report-generator';
import { POST as exportReportHandler } from '@/app/api/documents/[id]/export-report/route';
import { NextRequest } from 'next/server';

// Mock pdf-parse for verification of generated output
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require('pdf-parse');

describe('Contract Review Report PDF Export Service & Verification', () => {
  const samplePages = [
    {
      pageNumber: 1,
      extractedText:
        'MASTER SERVICES AGREEMENT\nThis Agreement is entered into on January 15, 2026 by and between Alpha Corp ("Client") and Beta LLC ("Provider"). Provider shall deliver cloud infrastructure management services in accordance with Schedule A.',
    },
    {
      pageNumber: 2,
      extractedText:
        'SECTION 4: FEES AND PAYMENT TERMS\nClient agrees to pay Provider a monthly fee of $25,000 within thirty (30) days of receiving an invoice. Late payments shall accrue interest at 1.5% per month.\n\nSECTION 5: INDEMNIFICATION\nProvider shall indemnify and hold harmless Client from any third-party intellectual property infringement claims.',
    },
    {
      pageNumber: 3,
      extractedText:
        'SECTION 8: CONFIDENTIALITY\nEach party agrees to hold all Confidential Information in strict confidence for a period of five (5) years following the termination of this Agreement.\n\nSECTION 9: TERMINATION\nEither party may terminate this Agreement without cause upon giving sixty (60) days prior written notice.',
    },
  ];

  const arabicPages = [
    {
      pageNumber: 1,
      extractedText:
        'عقد تقديم خدمات تقنية واتفاقية سرية المعلومات\nتم إبرام هذا العقد بين شركة التقنية المتقدمة للحلول الرقمية ومؤسسة الخدمات الاستشارية وتطوير الأعمال.',
    },
    {
      pageNumber: 2,
      extractedText:
        'المادة الثالثة: المقابل المالي وجدول سداد الدفعات\nتبلغ القيمة الإجمالية لهذا العقد مبلغاً وقدره 150,000 ريال سعودي غير شاملة ضريبة القيمة المضافة. يلتزم العميل بسداد كل دفعة خلال مدة لا تتجاوز 15 يوماً من تاريخ استلام الفاتورة.',
    },
    {
      pageNumber: 3,
      extractedText:
        'المادة الخامسة: سرية المعلومات وحماية البيانات\nيلتزم الطرفان بالحفاظ التام على سرية المعلومات التقنية والمالية لمدة خمس (5) سنوات كاملة بعد انتهاء هذا العقد.',
    },
  ];

  // ---------------------------------------------------------------------------
  // 1. Quotation Verification Against Pages
  // ---------------------------------------------------------------------------
  describe('Authoritative Quotation Verification Against Pages', () => {
    it('verifies exact quotation and returns correct page number and character offsets', () => {
      const quote = 'Provider shall deliver cloud infrastructure management services';
      const result = verifyQuoteAgainstPages(samplePages, quote);

      expect(result.status).toBe('VERIFIED');
      expect(result.pageNumber).toBe(1);
      expect(result.startOffset).toBeGreaterThanOrEqual(0);
      expect(result.endOffset).toBeGreaterThan(result.startOffset!);
    });

    it('verifies quote located on later pages (Page 2 payment terms)', () => {
      const quote = 'monthly fee of $25,000 within thirty (30) days';
      const result = verifyQuoteAgainstPages(samplePages, quote);

      expect(result.status).toBe('VERIFIED');
      expect(result.pageNumber).toBe(2);
      expect(result.startOffset).toBeGreaterThanOrEqual(0);
    });

    it('classifies completely fabricated quotation as REFUTED with null pageNumber', () => {
      const fabricatedQuote = 'Client shall forfeit all intellectual property rights to Provider upon default';
      const result = verifyQuoteAgainstPages(samplePages, fabricatedQuote);

      expect(result.status).toBe('REFUTED');
      expect(result.pageNumber).toBeNull();
    });

    it('verifies exact Arabic quotation and identifies correct Arabic page', () => {
      const arabicQuote = 'تبلغ القيمة الإجمالية لهذا العقد مبلغاً وقدره 150,000 ريال سعودي';
      const result = verifyQuoteAgainstPages(arabicPages, arabicQuote);

      expect(result.status).toBe('VERIFIED');
      expect(result.pageNumber).toBe(2);
    });

    it('verifies Arabic confidentiality clause on page 3', () => {
      const arabicConfQuote = 'يلتزم الطرفان بالحفاظ التام على سرية المعلومات التقنية والمالية';
      const result = verifyQuoteAgainstPages(arabicPages, arabicConfQuote);

      expect(result.status).toBe('VERIFIED');
      expect(result.pageNumber).toBe(3);
    });

    it('rejects fabricated Arabic quote as REFUTED', () => {
      const fabricatedArabic = 'يحق للطرف الأول مصادرة كافة أموال الطرف الثاني دون إنذار قضائي';
      const result = verifyQuoteAgainstPages(arabicPages, fabricatedArabic);

      expect(result.status).toBe('REFUTED');
      expect(result.pageNumber).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. PDF Generation Engine with Arabic & English Support
  // ---------------------------------------------------------------------------
  describe('PDF Generation Engine (PDFKit & Bundled Fonts)', () => {
    it('generates a valid binary PDF buffer with %PDF- header for English contract', async () => {
      const reportData: ContractReportData = {
        documentId: 'doc-eng-1',
        originalFilename: 'master-services-agreement.pdf',
        fileSize: 1048576,
        pageCount: 3,
        chunkCount: 12,
        detectedLanguage: 'English',
        isRtl: false,
        generatedAt: new Date().toISOString(),
        requestedSections: ['summary', 'risks', 'obligations', 'citations'],
        languagePreference: 'source',
        summary: {
          text: 'This agreement establishes master technical services between Alpha Corp and Beta LLC.',
          isGenerated: false,
        },
        risks: [
          {
            id: 'r-1',
            title: 'Late Payment Interest Penalty',
            severity: 'MEDIUM',
            explanation: 'Late payments accrue 1.5% interest per month which increases operational cost.',
            clause: 'Section 4',
            supportingQuote: 'Late payments shall accrue interest at 1.5% per month.',
            citationStatus: 'VERIFIED',
            pageNumber: 2,
          },
        ],
        obligations: [
          {
            id: 'o-1',
            title: 'Monthly Invoicing & Payment',
            responsibleParty: 'Client',
            deadline: 'within thirty (30) days',
            clause: 'Section 4',
            supportingQuote: 'Client agrees to pay Provider a monthly fee of $25,000 within thirty (30) days',
            citationStatus: 'VERIFIED',
            pageNumber: 2,
          },
        ],
        citations: [
          {
            id: 'c-1',
            quote: 'Each party agrees to hold all Confidential Information in strict confidence for a period of five (5) years',
            status: 'VERIFIED',
            pageNumber: 3,
            startOffset: 25,
            endOffset: 125,
          },
        ],
      };

      const buffer = await generateContractReviewPdf(reportData);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(5000);
      expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');

      // Verify that the generated PDF contains the required sections and disclaimer
      const PDFParse = pdf.PDFParse || pdf.default?.PDFParse || pdf;
      const parsed = await new PDFParse({ data: buffer }).getText();
      expect(parsed.text).toContain('Contract Review & Intelligence Report');
      expect(parsed.text).toContain('LEGAL NOTICE & HUMAN-REVIEW DISCLAIMER');
      expect(parsed.text).toContain('Document Summary');
      expect(parsed.text).toContain('Identified Risks');
      expect(parsed.text).toContain('Contractual Obligations');
      expect(parsed.text).toContain('Verified Citations');
    });

    it('generates an Arabic PDF with RTL layout and verified Arabic citations', async () => {
      const arabicReportData: ContractReportData = {
        documentId: 'doc-ar-1',
        originalFilename: 'arabic-commercial-agreement.pdf',
        fileSize: 524288,
        pageCount: 3,
        chunkCount: 8,
        detectedLanguage: 'Arabic',
        isRtl: true,
        generatedAt: new Date().toISOString(),
        requestedSections: ['summary', 'risks', 'obligations', 'citations'],
        languagePreference: 'source',
        summary: {
          text: 'عقد تقديم خدمات تقنية واتفاقية سرية المعلومات بين شركة التقنية المتقدمة ومؤسسة الخدمات الاستشارية.',
          isGenerated: false,
        },
        risks: [
          {
            id: 'r-ar-1',
            title: 'شرط سرية ممتد لعدة سنوات',
            severity: 'HIGH',
            explanation: 'التزام السرية ممتد لخمس سنوات بعد انتهاء العقد مما يفرض مسؤولية قانونية طويلة الأجل.',
            clause: 'المادة الخامسة',
            supportingQuote: 'يلتزم الطرفان بالحفاظ التام على سرية المعلومات التقنية والمالية لمدة خمس (5) سنوات',
            citationStatus: 'VERIFIED',
            pageNumber: 3,
          },
        ],
        obligations: [
          {
            id: 'o-ar-1',
            title: 'سداد الدفعات المالية',
            responsibleParty: 'العميل',
            deadline: 'خلال 15 يوماً من استلام الفاتورة',
            clause: 'المادة الثالثة',
            supportingQuote: 'يلتزم العميل بسداد كل دفعة خلال مدة لا تتجاوز 15 يوماً من تاريخ استلام الفاتورة.',
            citationStatus: 'VERIFIED',
            pageNumber: 2,
          },
        ],
        citations: [
          {
            id: 'c-ar-1',
            quote: 'تبلغ القيمة الإجمالية لهذا العقد مبلغاً وقدره 150,000 ريال سعودي',
            status: 'VERIFIED',
            pageNumber: 2,
            startOffset: 40,
            endOffset: 105,
          },
        ],
      };

      const buffer = await generateContractReviewPdf(arabicReportData);

      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(5000);
      expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');

      // Verify that the Arabic text is preserved in the PDF
      const PDFParse = pdf.PDFParse || pdf.default?.PDFParse || pdf;
      const parsed = await new PDFParse({ data: buffer }).getText();
      expect(parsed.text).toContain('LEGAL NOTICE & HUMAN-REVIEW DISCLAIMER');
      expect(parsed.text).toContain('تقرير مراجعة وتحليل العقد القانوني');
    });

    it('generates a PDF when only a subset of sections is requested (e.g. summary only)', async () => {
      const summaryOnlyData: ContractReportData = {
        documentId: 'doc-subset-1',
        originalFilename: 'short-agreement.pdf',
        fileSize: 10240,
        pageCount: 1,
        chunkCount: 2,
        detectedLanguage: 'English',
        isRtl: false,
        generatedAt: new Date().toISOString(),
        requestedSections: ['summary'],
        languagePreference: 'source',
        summary: {
          text: 'This is a single-section summary report for quick executive briefing.',
          isGenerated: false,
        },
      };

      const buffer = await generateContractReviewPdf(summaryOnlyData);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      const PDFParse = pdf.PDFParse || pdf.default?.PDFParse || pdf;
      const parsed = await new PDFParse({ data: buffer }).getText();

      expect(parsed.text).toContain('Document Summary');
      expect(parsed.text).not.toContain('2. Identified Risks');
      expect(parsed.text).not.toContain('3. Contractual Obligations');
      expect(parsed.text).not.toContain('4. Verified Citations');
    });

    it('handles empty risk or obligation sections without fabricating data', async () => {
      const emptySectionsData: ContractReportData = {
        documentId: 'doc-empty-1',
        originalFilename: 'minimal-nda.pdf',
        fileSize: 20480,
        pageCount: 1,
        chunkCount: 1,
        detectedLanguage: 'English',
        isRtl: false,
        generatedAt: new Date().toISOString(),
        requestedSections: ['risks', 'obligations', 'citations'],
        languagePreference: 'source',
        risks: [],
        obligations: [],
        citations: [],
      };

      const buffer = await generateContractReviewPdf(emptySectionsData);
      const PDFParse = pdf.PDFParse || pdf.default?.PDFParse || pdf;
      const parsed = await new PDFParse({ data: buffer }).getText();

      expect(parsed.text).toContain('No saved risk findings are available');
      expect(parsed.text).toContain('No saved obligation findings are available');
      expect(parsed.text).toContain('No verified quotations are available for this contract');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. API Route Handler Contract & Validation Tests
  // ---------------------------------------------------------------------------
  describe('Export Report API Route Handler (POST /api/documents/[id]/export-report)', () => {
    it('returns HTTP 400 when document ID is missing or empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/documents//export-report', {
        method: 'POST',
        body: JSON.stringify({ sections: ['summary'] }),
      });

      const res = await exportReportHandler(req, { params: Promise.resolve({ id: '' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('valid document ID');
    });

    it('returns HTTP 400 when sections array is empty', async () => {
      const req = new NextRequest('http://localhost:3000/api/documents/doc-123/export-report', {
        method: 'POST',
        body: JSON.stringify({ sections: [] }),
      });

      const res = await exportReportHandler(req, { params: Promise.resolve({ id: 'doc-123' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('select at least one report section');
    });

    it('returns HTTP 400 when section name is invalid', async () => {
      const req = new NextRequest('http://localhost:3000/api/documents/doc-123/export-report', {
        method: 'POST',
        body: JSON.stringify({ sections: ['invalid_section_name'] }),
      });

      const res = await exportReportHandler(req, { params: Promise.resolve({ id: 'doc-123' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns HTTP 400 on malformed JSON payload', async () => {
      const req = new NextRequest('http://localhost:3000/api/documents/doc-123/export-report', {
        method: 'POST',
        body: 'invalid json text',
      });

      const res = await exportReportHandler(req, { params: Promise.resolve({ id: 'doc-123' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('Invalid JSON');
    });

    it('returns HTTP 404 when document does not exist in database', async () => {
      const req = new NextRequest('http://localhost:3000/api/documents/non-existent-id/export-report', {
        method: 'POST',
        body: JSON.stringify({ sections: ['summary', 'citations'] }),
      });

      const res = await exportReportHandler(req, { params: Promise.resolve({ id: 'non-existent-id' }) });
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toContain('not found');
    });
  });
});
