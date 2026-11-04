import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { TenantStatusForm } from '@/components/platform/TenantStatusForm';
import { enforcePlatformPageAccess } from '@/lib/auth/platform';
import { ROUTES, type TenantStatus } from '@/lib/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface TenantPageProps {
  params: Promise<{ slug: string }>;
}

interface PlatformTenantDetailRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: string;
  suspended_at: string | null;
}

export default async function PlatformTenantDetailPage({ params }: TenantPageProps) {
  const { slug } = await params;
  const admin = await enforcePlatformPageAccess(ROUTES.platform.tenant(slug));

  const supabase = await createSupabaseServerClient();
  const { data: rawTenant, error } = await supabase
    .from('tenants')
    .select('id, slug, name, status, created_at, suspended_at')
    .eq('slug', slug)
    .maybeSingle();

  const tenant = rawTenant as unknown as PlatformTenantDetailRow | null;

  if (error || !tenant) {
    notFound();
  }

  const isSuspended = tenant.status === 'suspended';

  return (
    <PlatformShell
      admin={admin}
      currentPath={ROUTES.platform.tenant(slug)}
      title={tenant.name}
      description={`Workspace: ${tenant.slug}`}
      backHref={ROUTES.platform.root}
      backLabel="All Tenants"
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Overview & Details */}
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-2xl border border-plug-border bg-plug-surface p-6">
            <h2 className="font-display text-lg font-bold uppercase tracking-wider text-white">
              Overview
            </h2>

            <dl className="mt-4 space-y-4 text-sm">
              <div>
                <dt className="text-xs text-plug-muted">Tenant ID</dt>
                <dd className="break-all font-mono text-xs text-neutral-300">{tenant.id}</dd>
              </div>

              <div>
                <dt className="text-xs text-plug-muted">Status</dt>
                <dd className="mt-1">
                  <span
                    className={`inline-flex items-center rounded border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                      tenant.status === 'active'
                        ? 'border-emerald-800 bg-emerald-950/60 text-emerald-400'
                        : tenant.status === 'trial'
                          ? 'border-amber-800 bg-amber-950/60 text-amber-400'
                          : tenant.status === 'suspended'
                            ? 'border-rose-800 bg-rose-950/60 text-rose-400'
                            : 'border-neutral-700 bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {tenant.status}
                  </span>
                </dd>
              </div>

              {isSuspended && tenant.suspended_at && (
                <div>
                  <dt className="text-xs text-rose-400">Suspended On</dt>
                  <dd className="text-xs text-rose-200">
                    {new Date(tenant.suspended_at).toLocaleString()}
                  </dd>
                  <p className="mt-1 text-xs text-plug-muted">
                    Customers can continue redeeming existing rewards for 30 days from suspension.
                  </p>
                </div>
              )}

              <div>
                <dt className="text-xs text-plug-muted">Created At</dt>
                <dd className="text-xs text-neutral-300">
                  {new Date(tenant.created_at).toLocaleString()}
                </dd>
              </div>
            </dl>

            <div className="mt-6 border-t border-plug-border pt-4">
              <Link
                href={ROUTES.platform.support(tenant.slug)}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-plug-border bg-plug-elevated px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-neutral-800"
              >
                Launch Support Session →
              </Link>
            </div>
          </div>
        </div>

        {/* Right column: Status Management */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-plug-border bg-plug-surface p-6 sm:p-8">
            <h2 className="font-display text-xl font-bold uppercase tracking-wide text-white">
              Status Management
            </h2>
            <p className="mt-1 text-sm text-plug-muted">
              Alter tenant operational mode. All changes require an audit justification and are
              logged in the immutable audit ledger.
            </p>

            <div className="mt-6">
              <TenantStatusForm slug={tenant.slug} currentStatus={tenant.status} />
            </div>
          </div>
        </div>
      </div>
    </PlatformShell>
  );
}
