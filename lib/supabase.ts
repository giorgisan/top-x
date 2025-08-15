import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

/**
 * Leno ustvari Supabase klient šele, ko ga pokličemo.
 * Če env spremenljivki manjkajo, vrže napako šele v runtime (ne v build fazi).
 */
export function supabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error('Manjkajo env spremenljivke: NEXT_PUBLIC_SUPABASE_URL in NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  _client = createClient(url, anon);
  return _client;
}
