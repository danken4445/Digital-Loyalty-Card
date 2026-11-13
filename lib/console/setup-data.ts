import 'server-only';

import type { TenantContext } from '@/lib/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  computeSetupProgress,
  startOfTodayInZone,
  type SetupProgress,
} from '@/lib/console/setup-progress';

export interface ShopToday {
  stampsToday: number;
  rewardsToday: number;
}

export interface ShopHomeData {
  progress: SetupProgress;
  today: ShopToday;
}

/**
 * Counts that drive the Home checklist and today's numbers. Uses the signed-in staff client, so
 * RLS limits every count to this shop. A failed count reads as 0 rather than breaking Home.
 */
export async function loadShopHomeData(tenant: TenantContext): Promise<ShopHomeData> {
  const supabase = await createSupabaseServerClient();
  const since = startOfTodayInZone(tenant.settings.timezone || 'Asia/Manila').toISOString();

  const head = { count: 'exact' as const, head: true };
  const [tags, members, invites, rulesSaved, stamps, stampsToday, rewardsToday] =
    await Promise.all([
      supabase.from('tags').select('id', head).eq('tenant_id', tenant.id).eq('active', true),
      supabase.from('tenant_members').select('user_id', head).eq('tenant_id', tenant.id).eq('active', true),
      supabase
        .from('tenant_invites')
        .select('id', head)
        .eq('tenant_id', tenant.id)
        .is('accepted_at', null),
      supabase
        .from('audit_log')
        .select('id', head)
        .eq('tenant_id', tenant.id)
        .eq('action', 'update_tenant_rules'),
      supabase.from('stamps').select('id', head).eq('tenant_id', tenant.id),
      supabase.from('stamps').select('id', head).eq('tenant_id', tenant.id).gte('created_at', since),
      supabase
        .from('redemptions')
        .select('id', head)
        .eq('tenant_id', tenant.id)
        .gte('created_at', since),
    ]);

  const n = (res: { count: number | null }) => res.count ?? 0;

  return {
    progress: computeSetupProgress(tenant.slug, {
      brand: tenant.settings.brand ?? {},
      rewardSaved: n(rulesSaved) > 0,
      activeTapCards: n(tags),
      teamSize: n(members) + n(invites),
      totalStamps: n(stamps),
    }),
    today: {
      stampsToday: n(stampsToday),
      rewardsToday: n(rewardsToday),
    },
  };
}
