import 'server-only';

import type { LocationOption } from '@/components/console/ConsoleTagsManager';
import type { TagLeakSignal, TagRow } from '@/lib/contracts';
import { decorateTagWithUrls, getTenantAliasHost } from '@/lib/auth/staff';
import { evaluateTagLeakSignals } from '@/lib/ops/tag-leak';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { TagWithBranch } from '@/app/api/staff/[slug]/tags/route';

export interface TapCardsData {
  tags: TagWithBranch[];
  locations: LocationOption[];
  leakSignals: TagLeakSignal[];
}

/** Everything the Tap Cards screen (and the setup wizard's tap-card step) needs. */
export async function loadTapCardsData(tenantId: string, actorId: string): Promise<TapCardsData> {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const [tagsRes, locsRes, leakRes] = await Promise.all([
    supabase
      .from('tags')
      .select('id, label, active, created_at, deactivated_at, location_id, last_tap_counter, hardware_uid')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('locations')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
    admin.rpc('tag_leak_signals', { p_actor: actorId, p_tenant: tenantId }),
  ]);

  const aliasHost = await getTenantAliasHost(tenantId);
  const tags: TagWithBranch[] = ((tagsRes.data ?? []) as Array<TagRow & { location_id?: string | null }>).map(
    (tag) => ({ ...decorateTagWithUrls(tag, aliasHost), location_id: tag.location_id }),
  );

  const locations: LocationOption[] = ((locsRes.data ?? []) as Array<{ id: string; name: string }>).map((l) => ({
    id: l.id,
    name: l.name,
  }));

  return { tags, locations, leakSignals: evaluateTagLeakSignals(leakRes.data) };
}
