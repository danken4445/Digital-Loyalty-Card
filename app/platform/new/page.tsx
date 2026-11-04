import { CreateTenantForm } from '@/components/platform/CreateTenantForm';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { enforcePlatformPageAccess } from '@/lib/auth/platform';
import { ROUTES } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

export default async function NewTenantPage() {
  const admin = await enforcePlatformPageAccess(ROUTES.platform.newTenant);

  return (
    <PlatformShell
      admin={admin}
      currentPath={ROUTES.platform.newTenant}
      title="Create New Tenant"
      description="Provision a new merchant workspace with default settings and send an owner invite."
      backHref={ROUTES.platform.root}
      backLabel="All Tenants"
    >
      <div className="mx-auto max-w-xl rounded-2xl border border-plug-border bg-plug-surface p-6 sm:p-8">
        <CreateTenantForm />
      </div>
    </PlatformShell>
  );
}
