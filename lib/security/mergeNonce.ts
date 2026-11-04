import 'server-only';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Whether a merge-intent nonce has already been consumed (`customer_merge_token_used` audit row).
 *
 * This is the one remaining service-role table read. `audit_log` RLS only exposes a shop's rows to its
 * staff, so the customer's session client cannot see merge-nonce rows, and no RPC covers the lookup.
 * It is isolated here so there is a single, reviewed exception to the admin-read lint ban.
 */
export async function isMergeNonceUsed(
  admin: AdminClient,
  nonce: string,
): Promise<{ used: boolean; failed: boolean }> {
  // eslint-disable-next-line no-restricted-syntax -- single-use merge nonce lookup; audit_log is staff-only under RLS (see above)
  const { data, error } = await admin
    .from('audit_log')
    .select('id')
    .eq('action', 'customer_merge_token_used')
    .eq('target', nonce)
    .maybeSingle();

  return { used: Boolean(data), failed: Boolean(error) };
}
