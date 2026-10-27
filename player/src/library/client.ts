import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
let client: SupabaseClient | null = null;

export function isLibraryConfigured(): boolean {
  if (!supabaseUrl || !supabaseKey) return false;
  try {
    return ['http:', 'https:'].includes(new URL(supabaseUrl).protocol);
  } catch {
    return false;
  }
}

export function getSupabase(): SupabaseClient | null {
  if (!isLibraryConfigured()) return null;
  client ??= createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function getAccessToken(): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new ApiRequestError('The library is not connected.', 503, 'not_configured');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new ApiRequestError('Sign in to open your library.', 401, 'unauthorized');
  return data.session.access_token;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBase}${path}`, { ...options, headers, cache: 'no-store' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message =
      data?.error?.message ??
      (response.status === 401
        ? 'Your session expired. Sign in again.'
        : `The request failed (${response.status}). Try again.`);
    throw new ApiRequestError(message, response.status, data?.error?.code ?? 'request_failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function storageUploadEndpoint(): string {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith('.supabase.co'))
    url.hostname = url.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co');
  return `${url.origin}/storage/v1/upload/resumable`;
}
