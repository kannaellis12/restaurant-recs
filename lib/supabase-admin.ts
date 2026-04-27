import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the SERVICE ROLE key. Bypasses RLS.
 *
 * Only import this from Server Components, Server Actions, or route handlers
 * — NEVER from a client component, since exporting the service-role key to
 * the browser would let any visitor read/write the entire database.
 */
let _client: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase admin env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).",
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}
