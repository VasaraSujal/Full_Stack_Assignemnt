import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import prisma from '@/lib/prisma';
import { isArabicText } from '@/lib/arabic-support';
import { findQuoteOffsets } from '@/lib/citation-verifier';
import { getGeminiClient, DEFAULT_GEMINI_MODEL, isGeminiConfigured } from '@/lib/gemini';
import { CitationVerificationStatus } from '@prisma/client';

export type ReportSection = 'summary' | 'risks' | 'obligations' | 'citations';

export interface ReportRiskItem {
  id: string;
  title: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation: string;
  clause?: string;
  supportingQuote?: string;
  citationStatus?: CitationVerificationStatus;
  pageNumber?: number | null;
}

export interface ReportObligationItem {
  id: string;
  title: string;
  responsibleParty?: string;
  deadline?: string;
  clause?: string;
  supportingQuote?: string;
  citationStatus?: CitationVerificationStatus;
  pageNumber?: number | null;
}

export interface ReportCitationItem {
  id: string;
  quote: string;
  status: CitationVerificationStatus;
  pageNumber: number | null;
  startOffset?: number;
  endOffset?: number;
  claim?: string;
}

export interface ContractReportData {
  documentId: string;
  originalFilename: string;
  fileSize: number | null;
  pageCount: number;
  chunkCount: number;
  detectedLanguage: 'Arabic' | 'English';
  isRtl: boolean;
  generatedAt: string;
  requestedSections: ReportSection[];
  languagePreference: 'source' | 'en';
  summary?: {
    text: string;
    isGenerated: boolean;
  };
  risks?: ReportRiskItem[];
  obligations?: ReportObligationItem[];
  citations?: ReportCitationItem[];
}

export interface AssembleReportOptions {
  sections: ReportSection[];
  language?: 'source' | 'en';
}

/**
 * Verify a candidate quote against all document pages and find the exact matching page and offsets
 */
export function verifyQuoteAgainstPages(
  pages: Array<{ pageNumber: number; extractedText: string }>,
  quote: string
): {
  status: CitationVerificationStatus;
  pageNumber: number | null;
  startOffset?: number;
  endOffset?: number;
} {
  if (!quote || quote.trim().length === 0) {
    return { status: CitationVerificationStatus.UNVERIFIED, pageNumber: null };
  }

  for (const page of pages) {
    const res = findQuoteOffsets(page.extractedText, quote);
    if (res.found) {
      const status =
        res.matchType === 'exact' || res.matchType === 'normalized'
          ? CitationVerificationStatus.VERIFIED
          : CitationVerificationStatus.PARTIAL;
      return {
        status,
        pageNumber: page.pageNumber,
        startOffset: res.startOffset,
        endOffset: res.endOffset,
      };
    }
  }

  return { status: CitationVerificationStatus.REFUTED, pageNumber: null };
}

/**
 * Retrieve saved document analysis or generate missing sections on demand
 */
export async function assembleContractReportData(
  documentId: string,
  options: AssembleReportOptions
): Promise<ContractReportData> {
  const { sections, language = 'source' } = options;

  // 1. Fetch document with all authoritative pages, chunks, and conversation history
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: { id: true, pageNumber: true, extractedText: true },
      },
      chunks: {
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, chunkIndex: true, chunkText: true, pageNumber: true },
      },
      conversations: {
        include: {
          conversation: {
            include: {
              messages: {
                orderBy: { createdAt: 'asc' },
                include: {
                  citations: {
                    where: { documentId },
                    select: {
                      id: true,
                      quotedText: true,
                      verificationStatus: true,
                      pageNumber: true,
                      locationMetadata: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      sourceComparisons: {
        select: {
          id: true,
          significance: true,
          plainLanguageSummary: true,
          oldText: true,
          newText: true,
        },
      },
      targetComparisons: {
        select: {
          id: true,
          significance: true,
          plainLanguageSummary: true,
          oldText: true,
          newText: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error(`Document with ID '${documentId}' was not found.`);
  }

  if (document.status !== 'COMPLETED') {
    throw new Error(`Document is in status '${document.status}'. Only COMPLETED documents can be exported.`);
  }

  const allPagesText = document.pages.map((p) => p.extractedText).join('\n\n');
  const isArabic = isArabicText(allPagesText);
  const detectedLanguage: 'Arabic' | 'English' = isArabic ? 'Arabic' : 'English';

  const reportData: ContractReportData = {
    documentId: document.id,
    originalFilename: document.originalFilename,
    fileSize: document.fileSize,
    pageCount: document.pages.length,
    chunkCount: document.chunks.length,
    detectedLanguage,
    isRtl: isArabic,
    generatedAt: new Date().toISOString(),
    requestedSections: sections,
    languagePreference: language,
  };

  // Collect all existing assistant messages and citations from conversation history
  const assistantMessages: Array<{ content: string; citations: typeof document.conversations[0]['conversation']['messages'][0]['citations'] }> = [];
  const rawSavedCitations: Array<{ quotedText: string; pageNumber: number | null }> = [];

  for (const cd of document.conversations) {
    for (const msg of cd.conversation.messages) {
      if (msg.role === 'ASSISTANT' && msg.content) {
        assistantMessages.push({ content: msg.content, citations: msg.citations });
        for (const cit of msg.citations) {
          rawSavedCitations.push({ quotedText: cit.quotedText, pageNumber: cit.pageNumber });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // A. INITIALIZE & HARVEST SAVED DATA
  // ---------------------------------------------------------------------------
  let summaryText = '';
  let isGenerated = false;

  if (sections.includes('summary')) {
    for (const msg of assistantMessages) {
      const lower = msg.content.toLowerCase();
      if (
        lower.includes('summary') ||
        lower.includes('overview') ||
        lower.includes('ملخص') ||
        lower.includes('نبذة')
      ) {
        summaryText = msg.content;
        break;
      }
    }
  }

  const risks: ReportRiskItem[] = [];
  if (sections.includes('risks')) {
    const allComparisons = [...document.sourceComparisons, ...document.targetComparisons];
    for (const comp of allComparisons) {
      const sev = comp.significance === 'CRITICAL' || comp.significance === 'HIGH' ? 'HIGH' : comp.significance === 'MEDIUM' ? 'MEDIUM' : 'LOW';
      const quote = comp.oldText || comp.newText || undefined;
      let verification = undefined;
      if (quote) {
        const v = verifyQuoteAgainstPages(document.pages, quote);
        verification = v;
      }
      risks.push({
        id: comp.id,
        title: `Contract Difference / Alteration (${sev} Risk)`,
        severity: sev,
        explanation: comp.plainLanguageSummary,
        supportingQuote: quote,
        citationStatus: verification?.status,
        pageNumber: verification?.pageNumber,
      });
    }
  }

  const obligations: ReportObligationItem[] = [];

  // ---------------------------------------------------------------------------
  // B. CONSOLIDATED AI GENERATION (Fast single prompt with timeout protection)
  // ---------------------------------------------------------------------------
  const needSummary = sections.includes('summary') && !summaryText;
  const needRisks = sections.includes('risks') && risks.length === 0;
  const needObligations = sections.includes('obligations') && obligations.length === 0;

  if ((needSummary || needRisks || needObligations) && isGeminiConfigured() && document.pages.length > 0) {
    try {
      const gemini = getGeminiClient();
      const excerpt = document.pages
        .slice(0, 4)
        .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.extractedText.slice(0, 1200)}`)
        .join('\n\n');

      const promptParts: string[] = [];
      if (needSummary) {
        promptParts.push(
          isArabic
            ? `"summary": "ملخص تنفيذي موضوعي وموجز يحدد أطراف العقد والغرض الأساسي ونطاق الالتزامات"`
            : `"summary": "Objective, concise executive summary identifying the contracting parties, primary purpose, and general scope"`
        );
      }
      if (needRisks) {
        promptParts.push(
          isArabic
            ? `"risks": [ { "title": "عنوان المخاطرة", "severity": "HIGH" | "MEDIUM" | "LOW", "explanation": "شرح المخاطرة القانونية", "clause": "المادة أو البند", "supportingQuote": "اقتباس نصي حرفي دقيق من العقد يدعم هذا التحليل" } ]`
            : `"risks": [ { "title": "Risk Title", "severity": "HIGH" | "MEDIUM" | "LOW", "explanation": "Explanation of potential legal issue or exposure", "clause": "Clause or Section heading", "supportingQuote": "Exact verbatim quotation from the text supporting this finding" } ]`
        );
      }
      if (needObligations) {
        promptParts.push(
          isArabic
            ? `"obligations": [ { "title": "الالتزام التعاقدي", "responsibleParty": "الطرف المسؤول", "deadline": "الموعد أو المدة الزمنية إن وجدت", "clause": "المادة أو البند", "supportingQuote": "اقتباس نصي حرفي دقيق من العقد يثبت هذا الالتزام" } ]`
            : `"obligations": [ { "title": "Obligation or requirement", "responsibleParty": "Party responsible (if identified in source)", "deadline": "Deadline, frequency, or condition (if stated in source)", "clause": "Clause or Section heading", "supportingQuote": "Exact verbatim quotation confirming this obligation" } ]`
        );
      }

      const prompt = isArabic
        ? `أنت مساعد قانوني ذكي متخصص في فحص العقود القانونية.
حلل مقتطفات العقد التالية وأجب بصيغة JSON فقط متضمناً الحقول المطلوبة التالية:
{
  ${promptParts.join(',\n  ')}
}
قواعد صارمة:
1. أي supportingQuote يجب أن يكون اقتباساً نصياً حرفياً وموجوداً بالفعل في النص المرفق.
2. أجب بصيغة JSON فقط دون أي شروح إضافية.

<retrieved_evidence>
${excerpt}
</retrieved_evidence>`
        : `You are an enterprise legal AI assistant analyzing a contract.
Analyze the following contract excerpts and respond ONLY with a JSON object containing the requested fields:
{
  ${promptParts.join(',\n  ')}
}
Strict rules:
1. Every supportingQuote MUST be an exact verbatim quotation present in the provided text.
2. Respond with valid JSON only without markdown or extra explanation.

<retrieved_evidence>
${excerpt}
</retrieved_evidence>`;

      const aiPromise = gemini.models.generateContent({
        model: DEFAULT_GEMINI_MODEL,
        contents: prompt,
      });

      // Strict 6500ms timeout guard to prevent serverless function gateway timeouts (status 504)
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI generation timed out')), 6500)
      );

      const response = await Promise.race([aiPromise, timeoutPromise]);
      let jsonText = response.text || '';
      if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json\s*/, '').replace(/```\s*$/, '');
      else if (jsonText.startsWith('```')) jsonText = jsonText.replace(/^```\s*/, '').replace(/```\s*$/, '');

      const parsed = JSON.parse(jsonText.trim());

      if (needSummary && typeof parsed.summary === 'string' && parsed.summary.trim().length > 0) {
        summaryText = parsed.summary.trim();
        isGenerated = true;
      }

      if (needRisks && Array.isArray(parsed.risks)) {
        for (let i = 0; i < parsed.risks.length; i++) {
          const item = parsed.risks[i];
          const quote = typeof item.supportingQuote === 'string' ? item.supportingQuote.trim() : '';
          const verification = quote ? verifyQuoteAgainstPages(document.pages, quote) : null;
          risks.push({
            id: `risk-ai-${i + 1}`,
            title: item.title || `Risk Finding ${i + 1}`,
            severity: item.severity === 'HIGH' ? 'HIGH' : item.severity === 'LOW' ? 'LOW' : 'MEDIUM',
            explanation: item.explanation || '',
            clause: item.clause,
            supportingQuote: quote || undefined,
            citationStatus: verification?.status,
            pageNumber: verification?.pageNumber,
          });
        }
      }

      if (needObligations && Array.isArray(parsed.obligations)) {
        for (let i = 0; i < parsed.obligations.length; i++) {
          const item = parsed.obligations[i];
          const quote = typeof item.supportingQuote === 'string' ? item.supportingQuote.trim() : '';
          const verification = quote ? verifyQuoteAgainstPages(document.pages, quote) : null;
          obligations.push({
            id: `oblg-${i + 1}`,
            title: item.title || `Obligation ${i + 1}`,
            responsibleParty: item.responsibleParty,
            deadline: item.deadline,
            clause: item.clause,
            supportingQuote: quote || undefined,
            citationStatus: verification?.status,
            pageNumber: verification?.pageNumber,
          });
        }
      }
    } catch {
      // Deterministic fallbacks handled below
    }
  }

  // ---------------------------------------------------------------------------
  // C. DETERMINISTIC FALLBACKS
  // ---------------------------------------------------------------------------
  if (sections.includes('summary')) {
    if (!summaryText) {
      const page1 = document.pages[0]?.extractedText || '';
      summaryText = isArabic
        ? `ملخص مستند العقد: يغطي هذا المستند اتفاقية تجارية قانونية مؤلفة من ${document.pages.length} صفحات و${document.chunks.length} مقطع مفهرس.
مقدمة الوثيقة: ${page1.slice(0, 350).replace(/\s+/g, ' ')}...`
        : `Contract Overview: This agreement comprises ${document.pages.length} pages and ${document.chunks.length} indexed chunks.
Preamble excerpt: ${page1.slice(0, 350).replace(/\s+/g, ' ')}...`;
      isGenerated = false;
    }
    reportData.summary = { text: summaryText, isGenerated };
  }

  if (sections.includes('risks')) {
    reportData.risks = risks;
  }

  if (sections.includes('obligations')) {
    reportData.obligations = obligations;
  }

  // ---------------------------------------------------------------------------
  // D. VERIFIED CITATIONS & SOURCE EVIDENCE
  // ---------------------------------------------------------------------------
  if (sections.includes('citations')) {
    const verifiedCitations: ReportCitationItem[] = [];
    const seenQuotes = new Set<string>();

    // 1. Gather quotes from saved database citations
    for (const raw of rawSavedCitations) {
      const q = raw.quotedText.trim();
      if (!q || seenQuotes.has(q)) continue;
      seenQuotes.add(q);

      // Re-verify strictly against authoritative pages
      const v = verifyQuoteAgainstPages(document.pages, q);
      verifiedCitations.push({
        id: `cit-saved-${verifiedCitations.length + 1}`,
        quote: q,
        status: v.status,
        pageNumber: v.pageNumber,
        startOffset: v.startOffset,
        endOffset: v.endOffset,
      });
    }

    // 2. Also include supporting quotes from risks and obligations if present
    const candidateQuotes: string[] = [];
    reportData.risks?.forEach((r) => {
      if (r.supportingQuote) candidateQuotes.push(r.supportingQuote);
    });
    reportData.obligations?.forEach((o) => {
      if (o.supportingQuote) candidateQuotes.push(o.supportingQuote);
    });

    for (const cq of candidateQuotes) {
      const q = cq.trim();
      if (!q || seenQuotes.has(q)) continue;
      seenQuotes.add(q);

      const v = verifyQuoteAgainstPages(document.pages, q);
      verifiedCitations.push({
        id: `cit-section-${verifiedCitations.length + 1}`,
        quote: q,
        status: v.status,
        pageNumber: v.pageNumber,
        startOffset: v.startOffset,
        endOffset: v.endOffset,
      });
    }

    reportData.citations = verifiedCitations;
  }

  return reportData;
}

/**
 * Generate a downloadable, professional PDF buffer with Arabic font support and dynamic pagination
 */
export async function generateContractReviewPdf(data: ContractReportData): Promise<Buffer> {
  const regularFontPath = path.join(process.cwd(), 'src', 'assets', 'fonts', 'Amiri-Regular.ttf');
  const boldFontPath = path.join(process.cwd(), 'src', 'assets', 'fonts', 'Amiri-Bold.ttf');

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 45,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Safely register universal Amiri font if present on disk, otherwise gracefully fallback to Helvetica
      const hasAmiriFonts = fs.existsSync(regularFontPath) && fs.existsSync(boldFontPath);
      if (hasAmiriFonts) {
        doc.registerFont('Amiri', regularFontPath);
        doc.registerFont('Amiri-Bold', boldFontPath);
      }

      const isRtl = data.isRtl;
      const primaryFont = hasAmiriFonts ? 'Amiri' : 'Helvetica';
      const boldFont = hasAmiriFonts ? 'Amiri-Bold' : 'Helvetica-Bold';
      const textAlign = isRtl ? 'right' : 'left';
      const textFeatures: PDFKit.Mixins.OpenTypeFeatures[] = hasAmiriFonts ? ['liga', 'init', 'medi', 'fina'] : [];

      const pageWidth = doc.page.width;
      const margin = 45;
      const contentWidth = pageWidth - margin * 2;

      // -----------------------------------------------------------------------
      // 1. BRAND HEADER & REPORT TITLE
      // -----------------------------------------------------------------------
      // Brand top pill
      doc.rect(margin, 40, contentWidth, 24).fill('#EFF6FF');
      doc.font(boldFont).fontSize(9).fillColor('#1D4ED8').text(
        '§ LEXICON AI  ·  ENTERPRISE LEGAL CONTRACT INTELLIGENCE',
        margin + 12,
        47,
        { width: contentWidth - 24, align: 'left' }
      );

      doc.moveDown(1.5);
      doc.font(boldFont).fontSize(20).fillColor('#0F172A').text(
        isRtl ? 'تقرير مراجعة وتحليل العقد القانوني' : 'Contract Review & Intelligence Report',
        margin,
        78,
        { width: contentWidth, align: textAlign, features: textFeatures }
      );

      doc.font(primaryFont).fontSize(10).fillColor('#64748B').text(
        isRtl
          ? 'تحليل قانوني مدعوم بالذكاء الاصطناعي مع توثيق الاقتباسات النصية الحرفية'
          : 'AI-assisted legal analysis featuring deterministic character-offset citation verification',
        margin,
        105,
        { width: contentWidth, align: textAlign, features: textFeatures }
      );

      // -----------------------------------------------------------------------
      // 2. METADATA SUMMARY GRID
      // -----------------------------------------------------------------------
      const metaY = 130;
      doc.rect(margin, metaY, contentWidth, 68).lineWidth(1).strokeColor('#E2E8F0').fillAndStroke('#F8FAFC', '#E2E8F0');

      const colW = contentWidth / 3;

      // Col 1: Contract Filename
      doc.font(boldFont).fontSize(8).fillColor('#64748B').text('ORIGINAL CONTRACT', margin + 12, metaY + 10);
      doc.font(boldFont).fontSize(10).fillColor('#0F172A').text(
        data.originalFilename,
        margin + 12,
        metaY + 24,
        { width: colW - 20, ellipsis: true }
      );
      doc.font(primaryFont).fontSize(8).fillColor('#94A3B8').text(
        `${data.pageCount} pages · ${data.chunkCount} chunks`,
        margin + 12,
        metaY + 44
      );

      // Col 2: Generation Date & Language
      doc.font(boldFont).fontSize(8).fillColor('#64748B').text('REPORT METADATA', margin + colW + 10, metaY + 10);
      doc.font(boldFont).fontSize(10).fillColor('#0F172A').text(
        new Date(data.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
        margin + colW + 10,
        metaY + 24
      );
      doc.font(primaryFont).fontSize(8).fillColor('#94A3B8').text(
        `Language: ${data.detectedLanguage} (${isRtl ? 'RTL' : 'LTR'})`,
        margin + colW + 10,
        metaY + 44
      );

      // Col 3: Included Sections
      doc.font(boldFont).fontSize(8).fillColor('#64748B').text('SECTIONS INCLUDED', margin + colW * 2 + 10, metaY + 10);
      doc.font(primaryFont).fontSize(8.5).fillColor('#334155').text(
        data.requestedSections.map((s) => s.toUpperCase()).join(' · '),
        margin + colW * 2 + 10,
        metaY + 24,
        { width: colW - 20 }
      );

      // -----------------------------------------------------------------------
      // 3. MANDATORY HUMAN-REVIEW DISCLAIMER BOX
      // -----------------------------------------------------------------------
      const discY = metaY + 80;
      doc.rect(margin, discY, contentWidth, 48).fillAndStroke('#FFFBEB', '#FDE68A');

      doc.font(boldFont).fontSize(8).fillColor('#92400E').text(
        '⚠  LEGAL NOTICE & HUMAN-REVIEW DISCLAIMER',
        margin + 12,
        discY + 8
      );
      doc.font(primaryFont).fontSize(7.5).fillColor('#78350F').text(
        'AI-generated analysis is provided for informational and document-review purposes only. It may contain errors or omissions and does not constitute legal advice. Supporting quotations should be checked in context, and all findings require review by a qualified human reviewer.',
        margin + 12,
        discY + 20,
        { width: contentWidth - 24 }
      );

      doc.y = discY + 60;

      // Helper function to check if page break is needed
      const ensureSpace = (neededHeight: number) => {
        if (doc.y + neededHeight > doc.page.height - 65) {
          doc.addPage();
          doc.y = 55;
        }
      };

      // Helper to render section title banner
      const renderSectionHeading = (title: string, badge?: string) => {
        ensureSpace(45);
        doc.moveDown(0.8);
        const y = doc.y;
        doc.rect(margin, y, 4, 18).fill('#2563EB');
        doc.font(boldFont).fontSize(13).fillColor('#0F172A').text(
          title,
          margin + 12,
          y + 1,
          { width: contentWidth - 120, align: textAlign, features: textFeatures }
        );

        if (badge) {
          doc.font(boldFont).fontSize(7.5).fillColor('#64748B').text(
            badge,
            margin,
            y + 3,
            { width: contentWidth, align: isRtl ? 'left' : 'right' }
          );
        }
        doc.y = y + 26;
      };

      // -----------------------------------------------------------------------
      // SECTION 1: DOCUMENT SUMMARY
      // -----------------------------------------------------------------------
      if (data.requestedSections.includes('summary') && data.summary) {
        renderSectionHeading(
          isRtl ? '١. ملخص العقد التنفيذي' : '1. Document Summary',
          data.summary.isGenerated ? '[ AI-Generated Summary · Informational Only ]' : '[ Saved Analysis Summary ]'
        );

        ensureSpace(60);
        doc.rect(margin, doc.y, contentWidth, 0.5).fill('#E2E8F0');
        doc.y += 8;

        doc.font(primaryFont).fontSize(9.5).lineGap(4).fillColor('#1E293B').text(
          data.summary.text,
          margin,
          doc.y,
          { width: contentWidth, align: textAlign, features: textFeatures }
        );
        doc.moveDown(0.8);
      }

      // -----------------------------------------------------------------------
      // SECTION 2: IDENTIFIED RISKS
      // -----------------------------------------------------------------------
      if (data.requestedSections.includes('risks')) {
        renderSectionHeading(
          isRtl ? '٢. المخاطر والبنود الحساسة' : '2. Identified Risks',
          '[ Risk Assessment · Requires Counsel Verification ]'
        );

        const risks = data.risks || [];
        if (risks.length === 0) {
          ensureSpace(35);
          doc.font(primaryFont).fontSize(9).fillColor('#64748B').text(
            isRtl
              ? 'لا توجد مخاطر محفوظة في التحليل المحدد لهذا العقد.'
              : 'No saved risk findings are available in the selected analysis for this contract.',
            margin,
            doc.y,
            { width: contentWidth, align: textAlign, features: textFeatures }
          );
          doc.moveDown(0.8);
        } else {
          for (let i = 0; i < risks.length; i++) {
            const risk = risks[i];
            ensureSpace(85);

            const sevColor = risk.severity === 'HIGH' ? '#DC2626' : risk.severity === 'MEDIUM' ? '#D97706' : '#2563EB';
            const sevBg = risk.severity === 'HIGH' ? '#FEF2F2' : risk.severity === 'MEDIUM' ? '#FFFBEB' : '#EFF6FF';

            const cardY = doc.y;
            doc.rect(margin, cardY, contentWidth, 24).fill(sevBg);

            // Severity Badge
            doc.font(boldFont).fontSize(8).fillColor(sevColor).text(
              `[ ${risk.severity} SEVERITY ]`,
              margin + 8,
              cardY + 7
            );

            // Title
            doc.font(boldFont).fontSize(10).fillColor('#0F172A').text(
              risk.title,
              margin + 90,
              cardY + 6,
              { width: contentWidth - 100, align: textAlign, features: textFeatures }
            );

            doc.y = cardY + 30;

            // Explanation
            doc.font(primaryFont).fontSize(9).lineGap(3).fillColor('#334155').text(
              risk.explanation,
              margin + 8,
              doc.y,
              { width: contentWidth - 16, align: textAlign, features: textFeatures }
            );

            // Supporting Quote
            if (risk.supportingQuote) {
              ensureSpace(40);
              doc.moveDown(0.3);
              const quoteBoxY = doc.y;
              doc.rect(margin + 8, quoteBoxY, contentWidth - 16, 26).fill('#F8FAFC');

              const statusColor =
                risk.citationStatus === 'VERIFIED' ? '#16A34A' : risk.citationStatus === 'PARTIAL' ? '#D97706' : '#DC2626';
              const statusText =
                risk.citationStatus === 'VERIFIED'
                  ? `✓ VERIFIED (Page ${risk.pageNumber ?? 1})`
                  : risk.citationStatus === 'PARTIAL'
                  ? '⚠ PARTIAL'
                  : '✕ UNCONFIRMED';

              doc.font(boldFont).fontSize(7).fillColor(statusColor).text(
                statusText,
                margin + 14,
                quoteBoxY + 4
              );

              doc.font(primaryFont).fontSize(8).fillColor('#475569').text(
                `"${risk.supportingQuote}"`,
                margin + 14,
                quoteBoxY + 14,
                { width: contentWidth - 32, ellipsis: true, align: textAlign, features: textFeatures }
              );
              doc.y = quoteBoxY + 32;
            }

            doc.moveDown(0.6);
          }
        }
      }

      // -----------------------------------------------------------------------
      // SECTION 3: OBLIGATIONS
      // -----------------------------------------------------------------------
      if (data.requestedSections.includes('obligations')) {
        renderSectionHeading(
          isRtl ? '٣. الالتزامات والمسؤوليات التعاقدية' : '3. Contractual Obligations',
          '[ Operational & Legal Requirements ]'
        );

        const obligations = data.obligations || [];
        if (obligations.length === 0) {
          ensureSpace(35);
          doc.font(primaryFont).fontSize(9).fillColor('#64748B').text(
            isRtl
              ? 'لا توجد التزامات محفوظة في التحليل المحدد لهذا العقد.'
              : 'No saved obligation findings are available in the selected analysis for this contract.',
            margin,
            doc.y,
            { width: contentWidth, align: textAlign, features: textFeatures }
          );
          doc.moveDown(0.8);
        } else {
          for (let i = 0; i < obligations.length; i++) {
            const oblg = obligations[i];
            ensureSpace(70);

            const cardY = doc.y;
            doc.rect(margin, cardY, contentWidth, 22).fill('#F1F5F9');

            doc.font(boldFont).fontSize(9.5).fillColor('#0F172A').text(
              `${i + 1}. ${oblg.title}`,
              margin + 8,
              cardY + 5,
              { width: contentWidth - 16, align: textAlign, features: textFeatures }
            );

            doc.y = cardY + 28;

            if (oblg.responsibleParty || oblg.deadline) {
              const details = [
                oblg.responsibleParty ? `Responsible Party: ${oblg.responsibleParty}` : null,
                oblg.deadline ? `Timeline / Condition: ${oblg.deadline}` : null,
                oblg.clause ? `Clause: ${oblg.clause}` : null,
              ]
                .filter(Boolean)
                .join('   |   ');

              doc.font(primaryFont).fontSize(8).fillColor('#64748B').text(
                details,
                margin + 8,
                doc.y,
                { width: contentWidth - 16, align: textAlign, features: textFeatures }
              );
              doc.moveDown(0.3);
            }

            if (oblg.supportingQuote) {
              ensureSpace(36);
              const qY = doc.y;
              doc.rect(margin + 8, qY, contentWidth - 16, 24).fill('#F8FAFC');

              const statusColor = oblg.citationStatus === 'VERIFIED' ? '#16A34A' : '#D97706';
              const statusText =
                oblg.citationStatus === 'VERIFIED'
                  ? `✓ VERIFIED (Page ${oblg.pageNumber ?? 1})`
                  : '⚠ UNVERIFIED';

              doc.font(boldFont).fontSize(7).fillColor(statusColor).text(
                statusText,
                margin + 12,
                qY + 3
              );
              doc.font(primaryFont).fontSize(8).fillColor('#475569').text(
                `"${oblg.supportingQuote}"`,
                margin + 12,
                qY + 12,
                { width: contentWidth - 28, ellipsis: true, align: textAlign, features: textFeatures }
              );
              doc.y = qY + 28;
            }

            doc.moveDown(0.5);
          }
        }
      }

      // -----------------------------------------------------------------------
      // SECTION 4: VERIFIED CITATIONS & SOURCE EVIDENCE
      // -----------------------------------------------------------------------
      if (data.requestedSections.includes('citations')) {
        renderSectionHeading(
          isRtl ? '٤. الاقتباسات الموثقة والأدلة النصية' : '4. Verified Citations & Source Evidence',
          '[ Authoritative Character-Offset Verification ]'
        );

        const citations = data.citations || [];
        if (citations.length === 0) {
          ensureSpace(35);
          doc.font(primaryFont).fontSize(9).fillColor('#64748B').text(
            isRtl
              ? 'لا توجد اقتباسات موثقة متوفرة لهذا العقد حالياً.'
              : 'No verified quotations are available for this contract. Run AI Research or Grounded Q&A to analyze specific clauses.',
            margin,
            doc.y,
            { width: contentWidth, align: textAlign, features: textFeatures }
          );
          doc.moveDown(0.8);
        } else {
          for (let i = 0; i < citations.length; i++) {
            const cit = citations[i];
            ensureSpace(55);

            const isVer = cit.status === 'VERIFIED';
            const isPart = cit.status === 'PARTIAL';
            const badgeColor = isVer ? '#16A34A' : isPart ? '#D97706' : '#DC2626';
            const badgeBg = isVer ? '#F0FDF4' : isPart ? '#FFFBEB' : '#FEF2F2';
            const borderCol = isVer ? '#BBF7D0' : isPart ? '#FDE68A' : '#FECACA';

            const quoteY = doc.y;
            doc.rect(margin, quoteY, contentWidth, 42).fillAndStroke(badgeBg, borderCol);

            // Left decorative indicator bar
            doc.rect(margin, quoteY, 4, 42).fill(badgeColor);

            const statusLabel = isVer
              ? `✓ VERIFIED  ·  Page ${cit.pageNumber ?? 1}${
                  cit.startOffset !== undefined && cit.endOffset !== undefined
                    ? `  [Offsets: ${cit.startOffset}–${cit.endOffset}]`
                    : ''
                }`
              : isPart
              ? `⚠ PARTIAL MATCH  ·  Page ${cit.pageNumber ?? '—'}`
              : `✕ REFUTED / UNCONFIRMED`;

            doc.font(boldFont).fontSize(7.5).fillColor(badgeColor).text(
              statusLabel,
              margin + 12,
              quoteY + 6
            );

            doc.font(primaryFont).fontSize(8.5).fillColor('#1E293B').text(
              `"${cit.quote}"`,
              margin + 12,
              quoteY + 18,
              { width: contentWidth - 24, ellipsis: true, align: textAlign, features: textFeatures }
            );

            doc.y = quoteY + 48;
          }
        }
      }

      // -----------------------------------------------------------------------
      // 5. RUNNING HEADERS & FOOTERS (DYNAMIC MULTI-PAGE NUMBERING)
      // -----------------------------------------------------------------------
      const range = doc.bufferedPageRange();
      const totalPages = range.count;

      for (let i = range.start; i < range.start + totalPages; i++) {
        doc.switchToPage(i);

        // Header on pages > 1
        if (i > 0) {
          doc.rect(margin, 25, contentWidth, 0.5).fill('#E2E8F0');
          doc.font(primaryFont).fontSize(7.5).fillColor('#94A3B8').text(
            `Lexicon AI  ·  ${data.originalFilename}`,
            margin,
            15,
            { width: contentWidth, align: 'left' }
          );
        }

        // Footer on all pages
        const footerY = doc.page.height - 35;
        doc.rect(margin, footerY, contentWidth, 0.5).fill('#E2E8F0');

        doc.font(primaryFont).fontSize(7.5).fillColor('#94A3B8').text(
          'AI-generated analysis requires qualified human review. Lexicon AI Legal Intelligence.',
          margin,
          footerY + 8,
          { width: contentWidth - 100, align: 'left' }
        );

        doc.font(boldFont).fontSize(7.5).fillColor('#64748B').text(
          `Page ${i + 1} of ${totalPages}`,
          margin,
          footerY + 8,
          { width: contentWidth, align: 'right' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
