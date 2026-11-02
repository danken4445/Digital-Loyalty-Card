import 'server-only';

import { STAMP_RULES } from '@/lib/config';
import type { CustomerBalanceView, CustomerCardState } from '@/lib/contracts';
import { logSecurityEvent } from '@/lib/security/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getVerifiedUser } from '@/lib/supabase/server';

/**
 * Idempotently provisions a public.customers row for an authenticated user
 * using a privileged admin client calling the SECURITY DEFINER RPC ensure_customer.
 */
export async function ensureCustomerRecord(userId: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('ensure_customer', { p_customer: userId });

  if (error || !data) {
    throw new Error(
      `Failed to ensure customer record for user "${userId}": ${error?.message ?? 'No data returned'}`,
    );
  }

  return data;
}

/**
 * Resolves the authenticated user's card state.
 *
 * 1. Authoritatively validates the session with getVerifiedUser() (auth.getUser()).
 * 2. Idempotently provisions a public.customers row via ensureCustomerRecord(user.id).
 * 3. Queries public.customer_balances view for the user's current stamp balances.
 * 4. Returns CustomerCardState or null if unauthenticated.
 */
export async function getAuthenticatedCustomerCardState(): Promise<CustomerCardState | null> {
  const user = await getVerifiedUser();
  if (!user) {
    return null;
  }

  await ensureCustomerRecord(user.id);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('customer_balances')
    .select('customer_id, total_stamps, stamps_redeemed, available_stamps, last_stamped_at')
    .eq('customer_id', user.id)
    .maybeSingle<CustomerBalanceView>();

  if (error) {
    throw new Error(`Failed to query customer balance for user "${user.id}": ${error.message}`);
  }

  const { data: upsizeClaim, error: perkError } = await supabase
    .from('perk_claims')
    .select('id')
    .eq('customer_id', user.id)
    .eq('perk', 'instagram_follow_upsize')
    .maybeSingle();

  // A perk lookup failure must not take down the stamp card; the perk is hidden instead
  if (perkError) {
    logSecurityEvent('warn', 'perk_claims_lookup_failed', {
      customerId: user.id,
      error: perkError.message,
    });
  }

  const totalStamps = data?.total_stamps ?? 0;
  const cardsCompleted = Math.max(0, Math.floor(totalStamps / STAMP_RULES.rewardThreshold));

  return {
    customerId: user.id,
    isAnonymous: Boolean(user.is_anonymous),
    email: user.email ?? null,
    totalStamps,
    stampsRedeemed: data?.stamps_redeemed ?? 0,
    availableStamps: data?.available_stamps ?? 0,
    lastStampedAt: data?.last_stamped_at ?? null,
    createdAt: user.created_at ?? null,
    cardsCompleted,
    instagramUpsizeClaimed: perkError ? undefined : Boolean(upsizeClaim),
  };
}
