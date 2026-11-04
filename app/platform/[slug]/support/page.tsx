import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { SupportDashboard } from '@/components/platform/SupportDashboard';
import { enforcePlatformPageAccess } from '@/lib/auth/platform';
import { ROUTES, type TenantStatus } from '@/lib/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface SupportPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session?: string }>;
}

interface SupportTenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

export default async function PlatformSupportPage({ params, searchParams }: SupportPageProps) {
  const { slug } = await params;
  const { session: sessionId } = await searchParams;
  const admin = await enforcePlatformPageAccess(ROUTES.platform.support(slug));

  const supabase = await createSupabaseServerClient();
  const { data: rawTenant, error } = await supabase
    .from('tenants')
    .select('id, slug, name, status')
    .eq('slug', slug)
    .maybeSingle();

  const tenant = rawTenant as unknown as SupportTenantRow | null;

  if (error || !tenant) {
    notFound();
  }

  return (
    <PlatformShell
      admin={admin}
      currentPath={ROUTES.platform.support(slug)}
      title={`Support Session: ${tenant.name}`}
      description={`Workspace: ${tenant.slug}. Time-boxed, read-only diagnostic session.`}
      backHref={ROUTES.platform.tenant(slug)}
      backLabel={tenant.name}
    >
      <SupportDashboard slug={tenant.slug} initialSessionId={sessionId} />
    </PlatformShell>
  );
}
