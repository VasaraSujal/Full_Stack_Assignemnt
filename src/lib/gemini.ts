import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

/**
 * Check if Gemini API key is configured
 */
export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

/**
 * Get singleton GoogleGenAI client
 */
export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }

  return geminiClient;
}

/**
 * Reset singleton client (useful for tests)
 */
export function resetGeminiClient(): void {
  geminiClient = null;
}
