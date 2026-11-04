import Link from 'next/link';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { enforcePlatformPageAccess } from '@/lib/auth/platform';
import { ROUTES, type TenantStatus } from '@/lib/contracts';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface PlatformTenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  created_at: string;
  suspended_at: string | null;
}

function getStatusBadge(status: TenantStatus) {
  switch (status) {
    case 'active':
      return (
        <span className="inline-flex items-center rounded border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          Active
        </span>
      );
    case 'trial':
      return (
        <span className="inline-flex items-center rounded border border-amber-800 bg-amber-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
          Trial
        </span>
      );
    case 'suspended':
      return (
        <span className="inline-flex items-center rounded border border-rose-800 bg-rose-950/60 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-rose-400">
          Suspended
        </span>
      );
    case 'closed':
    default:
      return (
        <span className="inline-flex items-center rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Closed
        </span>
      );
  }
}

export default async function PlatformTenantsPage() {
  const admin = await enforcePlatformPageAccess(ROUTES.platform.root);

  const supabase = await createSupabaseServerClient();
  const { data: rawTenants } = await supabase
    .from('tenants')
    .select('id, slug, name, status, created_at, suspended_at')
    .order('created_at', { ascending: false });

  const tenantList = (rawTenants as unknown as PlatformTenantRow[] | null) ?? [];

  return (
    <PlatformShell
      admin={admin}
      currentPath={ROUTES.platform.root}
      title="Tenant Management"
      description="Manage all merchant tenant workspaces, monitor operational statuses, or provision a new shop."
    >
      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-plug-muted">
          Showing <span className="font-semibold text-white">{tenantList.length}</span> shops
        </p>
        <Link
          href={ROUTES.platform.newTenant}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white bg-white px-5 py-2.5 text-sm font-bold text-plug-black transition-colors hover:bg-neutral-200"
        >
          + Create New Tenant
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-plug-border bg-plug-surface">
        {tenantList.length === 0 ? (
          <div className="p-12 text-center text-sm text-plug-muted">
            No merchant tenants provisioned yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-plug-border bg-plug-elevated text-xs uppercase tracking-wider text-plug-muted">
                <tr>
                  <th scope="col" className="px-6 py-4 font-semibold">
                    Shop Name
                  </th>
                  <th scope="col" className="px-6 py-4 font-semibold">
                    Slug
                  </th>
                  <th scope="col" className="px-6 py-4 font-semibold">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-4 font-semibold">
                    Created
                  </th>
                  <th scope="col" className="px-6 py-4 text-right font-semibold">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-plug-border">
                {tenantList.map((tenant) => (
                  <tr key={tenant.id} className="transition-colors hover:bg-plug-elevated/40">
                    <td className="px-6 py-4 font-semibold text-white">{tenant.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-neutral-300">{tenant.slug}</td>
                    <td className="px-6 py-4">
                      {getStatusBadge(tenant.status)}
                    </td>
                    <td className="px-6 py-4 text-xs text-plug-muted">
                      {new Date(tenant.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={ROUTES.platform.tenant(tenant.slug)}
                        className="inline-flex min-h-9 items-center rounded-lg border border-plug-border bg-plug-elevated px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PlatformShell>
  );
}
