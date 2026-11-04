import { enforceConsolePageAccess } from '@/lib/console/guard';
import { BranchLocationsClient, type LocationItem } from '@/components/console/BranchLocationsClient';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface LocationsSettingsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function LocationsSettingsPage({ params }: LocationsSettingsPageProps) {
  const { slug } = await params;
  const { tenantId } = await enforceConsolePageAccess(slug, 'owner');

  const supabase = await createSupabaseServerClient();
  const { data: locationsData } = await supabase
    .from('locations')
    .select('id, name, address, active, card_mode, child_tenant_id, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  const initialLocations = (locationsData ?? []) as LocationItem[];

  return (
    <BranchLocationsClient
      slug={slug}
      initialLocations={initialLocations}
    />
  );
}
