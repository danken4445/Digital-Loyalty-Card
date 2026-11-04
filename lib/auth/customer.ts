import 'server-only';

import type {
  CustomerCardState,
  TenantBrand,
  TenantContext,
  WalletCardSummary,
} from '@/lib/contracts';
import { calculateCardsCompleted } from '@/lib/rules/display';
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

interface CustomerCardRow {
  added_at: string;
}

interface CardBalanceRow {
  tenant_id: string;
  total_stamps: number | null;
  stamps_redeemed: number | null;
  available_stamps: number | null;
  last_stamped_at: string | null;
}

/**
 * Resolves the authenticated user's card at one shop.
 *
 * 1. Authoritatively validates the session with getVerifiedUser() (auth.getUser()).
 * 2. Idempotently provisions a public.customers row via ensureCustomerRecord(user.id).
 * 3. Returns 'no-card' when the user has no public.customer_cards row for the shop.
 * 4. Otherwise reads the shop's public.card_balances row and instagram perk claim (session client, RLS).
 *
 * Returns null when signed out.
 */
export async function getCustomerCardState(
  tenant: TenantContext,
): Promise<CustomerCardState | null | 'no-card'> {
  const user = await getVerifiedUser();
  if (!user) {
    return null;
  }

  await ensureCustomerRecord(user.id);

  const supabase = await createSupabaseServerClient();
  const { data: card, error: cardError } = await supabase
    .from('customer_cards')
    .select('added_at')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', user.id)
    .maybeSingle<CustomerCardRow>();

  if (cardError) {
    throw new Error(`Failed to query customer card for user "${user.id}": ${cardError.message}`);
  }
  if (!card) {
    return 'no-card';
  }

  const { data: balance, error: balanceError } = await supabase
    .from('card_balances')
    .select('tenant_id, total_stamps, stamps_redeemed, available_stamps, last_stamped_at')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', user.id)
    .maybeSingle<CardBalanceRow>();

  if (balanceError) {
    throw new Error(`Failed to query customer balance for user "${user.id}": ${balanceError.message}`);
  }

  const { data: upsizeClaim, error: perkError } = await supabase
    .from('perk_claims')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('customer_id', user.id)
    .eq('perk', 'instagram_follow_upsize')
    .maybeSingle();

  // A perk lookup failure must not take down the stamp card; the perk is hidden instead
  if (perkError) {
    logSecurityEvent('warn', 'perk_claims_lookup_failed', {
      customerId: user.id,
      tenantId: tenant.id,
      error: perkError.message,
    });
  }

  const totalStamps = balance?.total_stamps ?? 0;

  return {
    customerId: user.id,
    tenant,
    isAnonymous: Boolean(user.is_anonymous),
    email: user.email ?? null,
    totalStamps,
    stampsRedeemed: balance?.stamps_redeemed ?? 0,
    availableStamps: balance?.available_stamps ?? 0,
    lastStampedAt: balance?.last_stamped_at ?? null,
    createdAt: card.added_at ?? null,
    cardsCompleted: calculateCardsCompleted(totalStamps, tenant.settings.rewardThreshold),
    instagramUpsizeClaimed: perkError ? undefined : Boolean(upsizeClaim),
  };
}

interface WalletTenantEmbed {
  id: string;
  slug: string;
  name: string;
  status: string;
  tenant_settings: { reward_threshold: number; reward_label: string; brand: unknown } | null;
}

interface WalletCardRow {
  tenant_id: string;
  added_at: string;
  tenants: WalletTenantEmbed | null;
}

/**
 * Lists the signed-in user's cards, one per shop (closed shops are left out).
 * Ordered by most recent stamp first (never-stamped cards last), then newest card first.
 * Returns null when signed out.
 */
export async function listWalletCards(): Promise<WalletCardSummary[] | null> {
  const user = await getVerifiedUser();
  if (!user) {
    return null;
  }

  const supabase = await createSupabaseServerClient();
  const { data: cards, error: cardsError } = await supabase
    .from('customer_cards')
    .select('tenant_id, added_at, tenants(id, slug, name, status, tenant_settings(reward_threshold, reward_label, brand))')
    .eq('customer_id', user.id);

  if (cardsError) {
    throw new Error(`Failed to list wallet cards for user "${user.id}": ${cardsError.message}`);
  }

  const { data: balances, error: balancesError } = await supabase
    .from('card_balances')
    .select('tenant_id, total_stamps, available_stamps, last_stamped_at')
    .eq('customer_id', user.id);

  if (balancesError) {
    throw new Error(`Failed to list card balances for user "${user.id}": ${balancesError.message}`);
  }

  const balanceByTenant = new Map(
    ((balances ?? []) as unknown as CardBalanceRow[]).map((row) => [row.tenant_id, row]),
  );

  const summaries: WalletCardSummary[] = [];
  for (const row of (cards ?? []) as unknown as WalletCardRow[]) {
    const tenant = row.tenants;
    if (!tenant || !tenant.tenant_settings || tenant.status === 'closed') {
      continue;
    }
    const balance = balanceByTenant.get(row.tenant_id);
    summaries.push({
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      brand: (tenant.tenant_settings.brand ?? {}) as TenantBrand,
      rewardThreshold: tenant.tenant_settings.reward_threshold,
      rewardLabel: tenant.tenant_settings.reward_label,
      availableStamps: balance?.available_stamps ?? 0,
      totalStamps: balance?.total_stamps ?? 0,
      lastStampedAt: balance?.last_stamped_at ?? null,
      addedAt: row.added_at,
      cardsCompleted: calculateCardsCompleted(
        balance?.total_stamps ?? 0,
        tenant.tenant_settings.reward_threshold,
      ),
    });
  }

  summaries.sort((a, b) => {
    if (a.lastStampedAt && b.lastStampedAt) {
      const byStamp = Date.parse(b.lastStampedAt) - Date.parse(a.lastStampedAt);
      if (byStamp !== 0) return byStamp;
    } else if (a.lastStampedAt) {
      return -1;
    } else if (b.lastStampedAt) {
      return 1;
    }
    return Date.parse(b.addedAt) - Date.parse(a.addedAt);
  });

  return summaries;
}
