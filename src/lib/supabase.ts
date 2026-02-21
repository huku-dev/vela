import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Public client — used by the dashboard for unauthenticated reads
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Authenticated client factory — used after Privy login for user-scoped data
export function createAuthenticatedClient(
  accessTokenFn: () => Promise<string | null>
): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: accessTokenFn,
  });
}
