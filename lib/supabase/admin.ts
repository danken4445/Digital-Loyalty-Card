import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Creates a privileged Supabase admin client using `SUPABASE_SERVICE_ROLE_KEY`.
 *
 * SECURITY INVARIANTS:
 * 1. Guarded by `import 'server-only'` so bundling in Client Components fails at build time.
 * 2. Never persists sessions or cookies.
 * 3. Callers MUST always pass a user ID obtained from `getVerifiedUser()` (`supabase.auth.getUser()`),
 *    never an unverified ID supplied by the client.
 */
export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on the server.');
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
