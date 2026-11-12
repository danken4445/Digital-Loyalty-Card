import { PlatformDashboardClient } from '@/components/platform/PlatformDashboardClient';
import { PlatformShell } from '@/components/platform/PlatformShell';
import { enforcePlatformPageAccess } from '@/lib/auth/platform';
import { ROUTES } from '@/lib/contracts';
import { loadPlatformDashboardOverview } from '@/lib/platform/dashboard';

export const dynamic = 'force-dynamic';

export default async function PlatformTenantsPage() {
  const admin = await enforcePlatformPageAccess(ROUTES.platform.root);
  const overview = await loadPlatformDashboardOverview(admin.userId);

  return (
    <PlatformShell
      admin={admin}
      currentPath={ROUTES.platform.root}
      title="Super Admin Dashboard"
      description="Cross-tenant KPIs and feature management for the entire multi-tenant ecosystem."
    >
      <PlatformDashboardClient initialOverview={overview} />
    </PlatformShell>
  );
}
