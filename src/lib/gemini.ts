import { GoogleGenAI } from '@google/genai';

let geminiClient: GoogleGenAI | null = null;

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

/**
 * Ordered list of candidate models for automatic fallback on 503 high-demand or 429 quota spikes.
 */
export const GEMINI_FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
];

/**
 * Detect transient upstream Gemini errors such as 503 (model overloaded / high demand) or 429 (rate-limit / quota).
 */
export function isTransientGeminiError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('quota')
  );
}

/**
 * Execute a Gemini operation with automatic fallback across healthy models if a 503 or 429 spike occurs.
 */
export async function executeWithModelFallback<T>(
  preferredModel: string,
  fn: (modelName: string) => Promise<T>
): Promise<{ result: T; usedModel: string }> {
  const modelsToTry = [
    preferredModel,
    ...GEMINI_FALLBACK_MODELS.filter((m) => m !== preferredModel),
  ];

  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      const result = await fn(model);
      return { result, usedModel: model };
    } catch (err) {
      lastError = err;
      if (isTransientGeminiError(err)) {
        console.warn(`[Gemini Fallback] Model "${model}" returned transient 503/429 error. Falling back to next available model...`);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

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
