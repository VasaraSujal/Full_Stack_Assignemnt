/**
 * Arabic Language & Right-To-Left (RTL) Processing Utility
 * Supports Arabic text detection, diacritics/tashkeel normalization, tatweel removal, and RTL layout helpers.
 */

// Arabic Unicode ranges including basic Arabic, Arabic supplement, presentation forms
export const ARABIC_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const ARABIC_GLOBAL_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

// Arabic Tashkeel (harakat / diacritics) and Tatweel (kashida)
// Fatha, Damma, Kasra, Sukun, Shadda, Tanwin, Super-alef, Tatweel
export const ARABIC_DIACRITICS_REGEX = /[\u0617-\u061A\u064B-\u0652\u0670\u0640]/g;
export const ARABIC_DIACRITIC_CHAR_REGEX = /[\u0617-\u061A\u064B-\u0652\u0670\u0640]/;

/**
 * Check if a text snippet contains significant Arabic characters (for RTL triggering)
 */
export function isArabicText(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  const matches = text.match(ARABIC_GLOBAL_REGEX);
  if (!matches) return false;
  // If text contains at least 3 Arabic characters or >15% of non-whitespace is Arabic
  const nonWhitespaceLength = text.replace(/\s+/g, '').length;
  if (nonWhitespaceLength === 0) return false;
  return matches.length >= 3 && matches.length / nonWhitespaceLength > 0.15;
}

/**
 * Normalize Arabic text for resilient citation matching:
 * 1. Strips Tashkeel (diacritics: fatha, damma, kasra, sukun, shadda, tanwin)
 * 2. Strips Tatweel (kashida: ـ)
 * 3. Normalizes Alef variants (أ, إ, آ, ٱ -> ا)
 * 4. Normalizes Taa Marbuta (ة -> ه) and Yaa (ى -> ي)
 */
export function normalizeArabicText(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(ARABIC_DIACRITICS_REGEX, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();
}

/**
 * Determine text direction ('rtl' or 'ltr') based on language detection
 */
export function getTextDirection(text: string): 'rtl' | 'ltr' {
  return isArabicText(text) ? 'rtl' : 'ltr';
}
