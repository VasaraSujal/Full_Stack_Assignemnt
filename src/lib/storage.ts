import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const DEFAULT_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || 'contract-documents';

let storageClient: SupabaseClient | null = null;

/**
 * Get or initialize server-side Supabase client for private storage operations
 */
export function getStorageClient(): SupabaseClient | null {
  if (storageClient) {
    return storageClient;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://rltxyektxszmaoixwjcs.supabase.co';

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  storageClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return storageClient;
}

/**
 * Check if Supabase Storage credentials are fully configured in the environment
 */
export function isStorageConfigured(): boolean {
  return getStorageClient() !== null;
}

/**
 * Generate a cryptographically secure, collision-free storage key
 */
export function generateStorageKey(format: 'pdf' | 'docx'): string {
  const uuid = crypto.randomUUID();
  const timestamp = Date.now();
  return `contracts/${uuid}-${timestamp}.${format}`;
}

/**
 * Ensure the private storage bucket exists, creating it if required
 */
export async function ensureBucketExists(
  bucketName: string = DEFAULT_STORAGE_BUCKET
): Promise<{ success: boolean; error?: string }> {
  const client = getStorageClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase Storage is not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
    };
  }

  try {
    const { data: bucket, error: getError } = await client.storage.getBucket(bucketName);

    if (bucket && !getError) {
      return { success: true };
    }

    // Attempt to create bucket if not found
    const { error: createError } = await client.storage.createBucket(bucketName, {
      public: false, // Private bucket
      fileSizeLimit: 25 * 1024 * 1024, // 25MB limit
      allowedMimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/docx',
      ],
    });

    if (createError) {
      // If error is bucket already exists or policy restriction
      if (createError.message?.toLowerCase().includes('already exists')) {
        return { success: true };
      }
      return { success: false, error: createError.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown bucket verification error';
    return { success: false, error: message };
  }
}

/**
 * Upload contract file to private Supabase bucket
 */
export async function uploadContractFile(
  storageKey: string,
  buffer: Buffer,
  mimeType: string,
  bucketName: string = DEFAULT_STORAGE_BUCKET
): Promise<{ success: boolean; key?: string; error?: string }> {
  const client = getStorageClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase Storage credentials are not configured.',
    };
  }

  try {
    // Ensure bucket is available
    await ensureBucketExists(bucketName);

    const { error: uploadError } = await client.storage
      .from(bucketName)
      .upload(storageKey, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      return { success: false, error: uploadError.message };
    }

    return { success: true, key: storageKey };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Storage upload failed';
    return { success: false, error: message };
  }
}

/**
 * Download contract file from private Supabase bucket
 */
export async function downloadContractFile(
  storageKey: string,
  bucketName: string = DEFAULT_STORAGE_BUCKET
): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
  const client = getStorageClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase Storage credentials are not configured.',
    };
  }

  try {
    const { data, error } = await client.storage.from(bucketName).download(storageKey);

    if (error || !data) {
      return { success: false, error: error?.message || 'File download failed' };
    }

    const arrayBuffer = await data.arrayBuffer();
    return { success: true, buffer: Buffer.from(arrayBuffer) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Storage download failed';
    return { success: false, error: message };
  }
}

/**
 * Delete contract file from private Supabase bucket
 */
export async function deleteContractFile(
  storageKey: string,
  bucketName: string = DEFAULT_STORAGE_BUCKET
): Promise<{ success: boolean; error?: string }> {
  const client = getStorageClient();
  if (!client) {
    return {
      success: false,
      error: 'Supabase Storage credentials are not configured.',
    };
  }

  try {
    const { error } = await client.storage.from(bucketName).remove([storageKey]);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Storage deletion failed';
    return { success: false, error: message };
  }
}
