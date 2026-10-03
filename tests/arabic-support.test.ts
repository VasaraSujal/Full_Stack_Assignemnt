import { describe, it, expect } from 'vitest';
import { isArabicText, normalizeArabicText, getTextDirection } from '@/lib/arabic-support';
import { findQuoteOffsets } from '@/lib/citation-verifier';

describe('Phase Extra — Arabic Contract Support & RTL Processing', () => {
  const sampleArabicContract = `
عقد تقديم خدمات استشارية
تم إبرام هذه الاتفاقية في يوم الأحد الموافق الأول من شهر أكتوبر.
البند الأول: نطاق العمل
يلتزم الطرف الثاني بتقديم كافة الخدمات الاستشارية الفنية والتقنية للطرف الأول وفق أعلى معايير الجودة المعمول بها في دولة الإمارات العربية المتحدة.
البند الثاني: المقابل المالي وشروط الدفع
يلتزم الطرف الأول بدفع أتعاب إجمالية قدرها 50,000 درهم إماراتي تُسدد خلال ثلاثين (30) يوماً من تاريخ استلام الفاتورة الرسمية.
البند الثالث: القانون الواجب التطبيق والاختصاص القضائي
يخضع هذا العقد ويفسر وفقاً للقوانين واللوائح السارية في دولة الإمارات العربية المتحدة وتختص محاكم دبي بفض أي نزاع.
`.trim();

  describe('1. Arabic Language & Script Detection', () => {
    it('detects pure Arabic legal text accurately', () => {
      const text = 'يلتزم الطرف الثاني بتقديم كافة الخدمات الاستشارية';
      expect(isArabicText(text)).toBe(true);
      expect(getTextDirection(text)).toBe('rtl');
    });

    it('returns false and ltr for English text', () => {
      const englishText = 'This Agreement is governed by the laws of the State of Delaware.';
      expect(isArabicText(englishText)).toBe(false);
      expect(getTextDirection(englishText)).toBe('ltr');
    });

    it('handles mixed strings with dominant Arabic text', () => {
      const mixed = 'المبلغ الإجمالي هو 50,000 AED يُدفع خلال 30 days.';
      expect(isArabicText(mixed)).toBe(true);
      expect(getTextDirection(mixed)).toBe('rtl');
    });
  });

  describe('2. Arabic Tashkeel & Diacritics Normalization', () => {
    it('strips Arabic diacritics (tashkeel/harakat) and tatweel', () => {
      // With Fatha, Damma, Kasra, Shadda, Sukun
      const withTashkeel = 'يَلْتَزِمُ الطَّرَفُ الأَوَّلُ بِدَفْعِ أَتْعَابٍ';
      const normalized = normalizeArabicText(withTashkeel);

      expect(normalized).not.toContain('\u064E'); // fatha
      expect(normalized).not.toContain('\u064F'); // damma
      expect(normalized).not.toContain('\u0650'); // kasra
      expect(normalized).not.toContain('\u0651'); // shadda
      expect(normalized).toContain('يلتزم الطرف الاول بدفع اتعاب');
    });

    it('normalizes Alef variants (أ, إ, آ -> ا)', () => {
      const alefVariants = 'الإمارات العربية المتحدة';
      const normalized = normalizeArabicText(alefVariants);
      expect(normalized).toBe('الامارات العربيه المتحده');
    });
  });

  describe('3. Authoritative Citation Verification for Arabic Contracts', () => {
    it('verifies exact verbatim Arabic quote and derives correct offsets', () => {
      const quote = 'يلتزم الطرف الأول بدفع أتعاب إجمالية قدرها 50,000 درهم إماراتي';
      const result = findQuoteOffsets(sampleArabicContract, quote);

      expect(result.found).toBe(true);
      expect(result.startOffset).toBeGreaterThanOrEqual(0);
      expect(result.endOffset).toBeGreaterThan(result.startOffset);
      expect(sampleArabicContract.slice(result.startOffset, result.endOffset)).toBe(quote);
    });

    it('verifies Arabic quote across whitespace variations and linebreaks', () => {
      const quoteWithSpaces = 'يلتزم   الطرف الأول   بدفع أتعاب إجمالية';
      const result = findQuoteOffsets(sampleArabicContract, quoteWithSpaces);

      expect(result.found).toBe(true);
      expect(result.matchType).toBe('normalized');
      expect(result.startOffset).toBeGreaterThanOrEqual(0);
    });

    it('verifies Arabic quote when source text has Tashkeel but query does not', () => {
      const textWithTashkeel = 'يَلْتَزِمُ الطَّرَفُ الثَّانِي بِتَقْدِيمِ خَدَمَاتٍ اسْتِشَارِيَّةٍ.';
      const quoteBare = 'يلتزم الطرف الثاني بتقديم خدمات استشارية';

      const result = findQuoteOffsets(textWithTashkeel, quoteBare);
      expect(result.found).toBe(true);
      expect(result.startOffset).toBeGreaterThanOrEqual(0);
      expect(result.endOffset).toBeGreaterThan(result.startOffset);
    });

    it('rejects completely fabricated Arabic clause as unmatched', () => {
      const fabricatedQuote = 'يحق للطرف الأول إنهاء هذا العقد فوراً دون أي إشعار مسبق أو تعويض مالي.';
      const result = findQuoteOffsets(sampleArabicContract, fabricatedQuote);

      expect(result.found).toBe(false);
      expect(result.startOffset).toBe(-1);
      expect(result.endOffset).toBe(-1);
    });

    it('extracts all 4 pages from the real sample Arabic PDF contract', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const { extractTextFromPdf } = await import('@/lib/text-extractor');

      const samplePdfPath = path.resolve(process.cwd(), 'sample-contracts', 'arabic-commercial-agreement.pdf');
      if (fs.existsSync(samplePdfPath)) {
        const buffer = fs.readFileSync(samplePdfPath);
        const result = await extractTextFromPdf(buffer);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.totalPages).toBe(4);
          expect(result.pages.length).toBe(4);
          expect(isArabicText(result.pages[0].text)).toBe(true);
          expect(isArabicText(result.pages[1].text)).toBe(true);
          expect(isArabicText(result.pages[2].text)).toBe(true);
          expect(isArabicText(result.pages[3].text)).toBe(true);
        }
      }
    });
  });
});
