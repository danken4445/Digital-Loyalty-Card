import 'server-only';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Whether a merge-intent nonce has already been consumed (`customer_merge_token_used` audit row).
 *
 * `audit_log` RLS only exposes a shop's rows to its staff, so the lookup goes through the
 * service-role-only `merge_nonce_used` RPC. Callers must fail closed when `failed` is true.
 */
export async function isMergeNonceUsed(
  admin: AdminClient,
  nonce: string,
): Promise<{ used: boolean; failed: boolean }> {
  const { data, error } = await admin.rpc('merge_nonce_used', { p_nonce: nonce });

  return { used: data === true, failed: Boolean(error) };
}
