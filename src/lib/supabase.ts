import { createClient } from '@supabase/supabase-js';

// These environment variables will be set in your Vercel dashboard and local .env file.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function isNonPlaceholderString(value: unknown, placeholderHints: string[]): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !placeholderHints.some((hint) => trimmed.toLowerCase().includes(hint.toLowerCase()));
}

const isSupabaseConfigured =
  isNonPlaceholderString(supabaseUrl, ['your-project', 'example', 'changeme']) &&
  isNonPlaceholderString(supabaseAnonKey, ['your-anon-key', 'example', 'changeme']);

// Only create the client if real values are present
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
