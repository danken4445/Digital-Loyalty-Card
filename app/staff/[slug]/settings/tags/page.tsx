import { enforceConsolePageAccess } from '@/lib/console/guard';
import { ConsoleTagsManager, type LocationOption } from '@/components/console/ConsoleTagsManager';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { decorateTagWithUrls, getTenantAliasHost } from '@/lib/auth/staff';
import { evaluateTagLeakSignals } from '@/lib/ops/tag-leak';
import type { TagRow } from '@/lib/contracts';
import type { TagWithBranch } from '@/app/api/staff/[slug]/tags/route';

export const dynamic = 'force-dynamic';

interface TagsSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function TagsSettingsPage({ params }: TagsSettingsPageProps) {
  const { slug } = await params;
  const { staff, tenantId } = await enforceConsolePageAccess(slug, 'manager');

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  const [tagsRes, locsRes, leakRes] = await Promise.all([
    supabase
      .from('tags')
      .select('id, label, active, created_at, deactivated_at, location_id')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('locations')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true }),
    admin.rpc('tag_leak_signals', {
      p_actor: staff.userId,
      p_tenant: tenantId,
    }),
  ]);

  const aliasHost = await getTenantAliasHost(tenantId);
  const initialTags: TagWithBranch[] = ((tagsRes.data ?? []) as Array<TagRow & { location_id?: string | null }>).map(
    (tag) => ({
      ...decorateTagWithUrls(tag, aliasHost),
      location_id: tag.location_id,
    }),
  );

  const locations: LocationOption[] = ((locsRes.data ?? []) as Array<{ id: string; name: string }>).map((l) => ({
    id: l.id,
    name: l.name,
  }));

  const leakSignals = evaluateTagLeakSignals(leakRes.data);
  const canManage = staff.role === 'owner' || staff.role === 'manager';

  return (
    <ConsoleTagsManager
      slug={slug}
      initialTags={initialTags}
      locations={locations}
      canManage={canManage}
      leakSignals={leakSignals}
    />
  );
}
